// End-to-end test of the Android app on an emulator or a phone with USB
// debugging. Needs adb on PATH, an installed debug build, and Playwright
// (`npm i --no-save playwright`). Run from the repository root:
//
//   node android/test/e2e.cjs path/to/app-debug.apk
//
// It installs the APK, opens a PDF the way "Open with" does, edits and saves
// it through Android's Save dialog, runs OCR, uses the Back button, and
// watches the kernel's socket tables for any connection by the app.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PKG = 'app.bentopdf.offline';
const apk = process.argv[2];
const root = path.resolve(__dirname, '..', '..');
const shotsDir = process.env.E2E_SCREENSHOTS;
const failures = [];
const notes = [];

let android;
try {
    ({ _android: android } = require('playwright'));
} catch {
    console.error('Playwright is not installed: npm i --no-save playwright');
    process.exit(2);
}

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const shell = (cmd) => adb('shell', cmd);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, what, timeout = 45000) {
    const start = Date.now();
    let last;
    for (;;) {
        try {
            last = await fn();
            if (last) return last;
        } catch (err) {
            last = err;
        }
        if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}${last instanceof Error ? ` (${last.message.split('\n')[0]})` : ''}`);
        await sleep(400);
    }
}

async function check(name, fn) {
    try {
        await fn();
        console.log(`  ok    ${name}`);
    } catch (err) {
        const message = String(err && err.message ? err.message : err).split('\n')[0];
        failures.push(`${name}: ${message}`);
        console.log(`  FAIL  ${name}: ${message}`);
        await dumpDiagnostics(name);
    }
}

function screenshot(name) {
    if (!shotsDir) return;
    fs.mkdirSync(shotsDir, { recursive: true });
    const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
    fs.writeFileSync(path.join(shotsDir, `${name}.png`), png);
}

// Set once the app page is attached; prints what the page shows.
let pageState = async () => {};

// On failure: what Android logged about the app and its web view.
async function dumpDiagnostics(label) {
    await pageState();
    try {
        const pidNow = spawnSync('adb', ['shell', `pidof ${PKG}`], { encoding: 'utf8' }).stdout.trim();
        console.log(`\n--- diagnostics (${label}) - app pid now: ${pidNow || 'not running'} ---`);
        const log = execFileSync('adb', ['logcat', '-d', '-v', 'brief'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const interesting = log
            .split('\n')
            .filter((l) => /bentopdf|Capacitor|chromium|AndroidRuntime|FATAL/i.test(l) && !/AppsFilter|NamespaceManager|velour|gsa/i.test(l))
            .slice(-120);
        console.log(interesting.join('\n'));
        if (shotsDir) {
            fs.mkdirSync(shotsDir, { recursive: true });
            fs.writeFileSync(path.join(shotsDir, 'logcat.txt'), log);
        }
        screenshot(`failure-${label.replace(/\W+/g, '-')}`);
    } catch (err) {
        console.log(`(could not collect diagnostics: ${err.message})`);
    }
}

// --- Socket watcher: reads /proc/net/{tcp,tcp6,udp,udp6} for the app's uid.
let appUid = null;
const sockets = new Map();
let socketWatch = null;
let procNetReadable = true;

// /proc/net addresses are hex. Anything that is not loopback (127.x, ::1,
// IPv4-mapped 127.x) or unspecified (all zeros: listening / not connected)
// would be another computer.
const isLocalHex = (hex) => {
    const h = hex.toUpperCase();
    if (/^0+$/.test(h)) return true;
    if (h.length === 8) return h.endsWith('7F'); // little-endian IPv4
    if (h === '00000000000000000000000001000000') return true; // ::1
    return h.startsWith('0000000000000000FFFF0000') && (h.endsWith('7F') || h.endsWith('00000000'));
};

function pollSockets() {
    for (const table of ['tcp', 'tcp6', 'udp', 'udp6']) {
        const r = spawnSync('adb', ['shell', `cat /proc/net/${table}`], { encoding: 'utf8' });
        if (r.status !== 0 || !r.stdout) {
            procNetReadable = false;
            continue;
        }
        for (const line of r.stdout.split('\n').slice(1)) {
            const cols = line.trim().split(/\s+/);
            if (cols.length < 8 || Number(cols[7]) !== appUid) continue;
            const [localHex] = cols[1].split(':');
            const [remoteHex, remotePortHex] = cols[2].split(':');
            const key = `${table} ${cols[1]} -> ${cols[2]}`;
            if (!sockets.has(key)) sockets.set(key, { table, local: localHex, remote: remoteHex, remotePort: parseInt(remotePortHex, 16) });
        }
    }
}

(async () => {
    if (!apk || !fs.existsSync(apk)) throw new Error('Usage: node android/test/e2e.cjs path/to/app-debug.apk');

    console.log('Install');
    await check('the APK installs', async () => {
        spawnSync('adb', ['uninstall', PKG]);
        adb('install', '-r', apk);
    });
    await check('the app has no network permission at all', async () => {
        const dump = shell(`dumpsys package ${PKG}`);
        if (/android\.permission\.INTERNET/.test(dump)) throw new Error('INTERNET permission is present');
        if (/ACCESS_NETWORK_STATE/.test(dump)) throw new Error('ACCESS_NETWORK_STATE permission is present');
    });
    // "package:app.bentopdf.offline uid:10123"
    appUid = Number((shell(`pm list packages -U ${PKG}`).match(/uid:(\d+)/) || [])[1]) ||
        Number((shell(`dumpsys package ${PKG}`).match(/(?:userId|appId)=(\d+)/) || [])[1]);
    if (appUid) socketWatch = setInterval(pollSockets, 500);
    else notes.push('Could not find the app uid, so the socket check was skipped.');

    // Make the sample PDF readable by the app the way "Open with" provides it.
    const sample = path.join(root, 'desktop', 'verify', 'sample-contract.pdf');
    adb('push', sample, '/data/local/tmp/sample-contract.pdf');
    shell('chmod 644 /data/local/tmp/sample-contract.pdf');
    shell('rm -f "/sdcard/Download/sample-contract.pdf"');

    spawnSync('adb', ['logcat', '-c']);
    console.log('Opening');
    await check('"Open with" starts the app with the PDF', async () => {
        shell(`am start -W -a android.intent.action.VIEW -d file:///data/local/tmp/sample-contract.pdf -t application/pdf -n ${PKG}/.MainActivity`);
    });

    // Playwright's Android mode talks to the app's web view through adb.
    const [device] = await android.devices();
    if (!device) throw new Error('no Android device found by Playwright');
    const webView = await device.webView({ pkg: PKG }, { timeout: 45000 });
    const page = await webView.page();
    const consoleLines = [];
    page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`));
    pageState = async () => {
        try {
            const state = await page.evaluate(() => ({
                ua: navigator.userAgent,
                classes: document.documentElement.className,
                tool: document.querySelector('#tool-content h2')?.textContent,
                alert: document.querySelector('#alert-modal:not(.hidden)') ? document.getElementById('alert-message')?.textContent : null,
                editorChildren: document.getElementById('embed-pdf-container')?.childElementCount ?? null,
            }));
            console.log('page state:', JSON.stringify(state));
        } catch (err) {
            console.log(`(page state unavailable: ${err.message.split('\n')[0]})`);
        }
        console.log('last console messages:\n' + consoleLines.slice(-40).join('\n'));
    };
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message.split('\n')[0]));
    const policy = [];
    page.on('console', (msg) => {
        if (/Content Security Policy|Refused to/i.test(msg.text())) policy.push(msg.text().slice(0, 200));
    });

    await check('the app loads its own files with no internet permission', async () => {
        await page.waitForSelector('.tool-card', { state: 'attached', timeout: 30000 });
        const cls = await page.evaluate(() => document.documentElement.className);
        if (!/is-android/.test(cls)) throw new Error(`classes: ${cls}`);
    });

    let openedViaIntent = false;
    await check('the PDF opens in the editor', async () => {
        const opened = await until(
            () => page.evaluate(() => {
                if (document.querySelector('#alert-modal:not(.hidden)')) return `alert: ${document.getElementById('alert-message')?.textContent}`;
                return document.documentElement.classList.contains('editor-open') && !!document.querySelector('#embed-pdf-container canvas, #embed-pdf-container img');
            }),
            'the editor to show the PDF',
            45000
        );
        if (typeof opened === 'string') throw new Error(opened);
        openedViaIntent = true;
        await sleep(2000);
        screenshot('1-opened');
    });
    if (!openedViaIntent) {
        console.error(`\n${failures.length} problem(s) found. Stopping: the rest of the test needs the PDF open.`);
        process.exit(1);
    }

    console.log('Privacy');
    await check('the page cannot reach another website', async () => {
        const result = await page.evaluate(() => fetch('https://example.com/').then(() => 'reached', () => 'blocked'));
        if (result !== 'blocked') throw new Error(result);
    });

    console.log('Editing and saving');
    await check('Save opens Android\'s Save dialog and writes the file', async () => {
        // Make a change first: a rectangle.
        await page.getByText('Shapes', { exact: true }).first().click();
        await page.getByRole('button', { name: 'Rectangle' }).first().click();
        const area = page.locator('#embed-pdf-container canvas, #embed-pdf-container img').first();
        const box = await area.boundingBox();
        await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.65, { steps: 10 });
        await page.mouse.up();
        await sleep(800);

        await page.click('#app-editor-bar button:last-child');
        await until(() => /documentsui/i.test(shell('dumpsys activity activities | grep -i -E "topResumedActivity|mResumedActivity"')), 'the Save dialog', 20000);
        await sleep(1500);
        screenshot('2-save-dialog');

        // Tap the dialog's Save button.
        const tapSave = () => {
            shell('uiautomator dump /sdcard/ui.xml >/dev/null');
            const xml = shell('cat /sdcard/ui.xml');
            const node = [...xml.matchAll(/<node [^>]*>/g)].map((m) => m[0]).find((n) => /text="save"/i.test(n) && /clickable="true"|class="android.widget.Button"/.test(n));
            if (!node) return false;
            const [, x1, y1, x2, y2] = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).map(Number);
            shell(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
            return true;
        };
        await until(tapSave, 'the Save button in the dialog', 20000);
        const saved = await until(() => {
            const list = shell('ls /sdcard/Download/ 2>/dev/null');
            return list.split('\n').find((f) => /^sample-contract.*\.pdf$/.test(f.trim()));
        }, 'the saved file in Downloads', 20000);
        const local = path.join(require('node:os').tmpdir(), 'bentopdf-saved.pdf');
        adb('pull', `/sdcard/Download/${saved.trim()}`, local);
        const bytes = fs.readFileSync(local);
        if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('saved file is not a PDF');
        if (!/\/Annots/.test(bytes.toString('latin1'))) throw new Error('saved PDF has no annotation');
        await sleep(1000);
        screenshot('3-saved');
    });

    console.log('Tools');
    await check('Back returns to the tool list', async () => {
        shell('input keyevent KEYCODE_BACK');
        await sleep(500);
        // Discard-changes prompt, if any, is answered by Playwright below.
        await until(() => page.evaluate(() => !document.getElementById('grid-view').classList.contains('hidden')), 'the tool list', 15000);
        screenshot('4-tools');
    });
    page.on('dialog', (d) => d.accept());

    await check('OCR works offline (engine and language data bundled)', async () => {
        await page.click('.tool-card[data-tool-id="ocr-pdf"]');
        const b64 = fs.readFileSync(sample).toString('base64');
        await page.evaluate((data) => {
            const dt = new DataTransfer();
            dt.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], 'sample-contract.pdf', { type: 'application/pdf' }));
            const input = document.getElementById('file-input');
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }, b64);
        await page.waitForSelector('#ocr-options:not(.hidden)', { timeout: 20000 });
        await page.check('.lang-checkbox[value="eng"]');
        await page.click('#process-btn');
        await page.waitForSelector('#ocr-results:not(.hidden)', { timeout: 180000 });
        const text = await page.inputValue('#ocr-text-output');
        if (!/SAMPLE\s+SERVICE\s+AGREEMENT/i.test(text)) throw new Error(`unexpected OCR text: ${JSON.stringify(text.slice(0, 80))}`);
        screenshot('5-ocr');
    });

    await check('the app does not use Google Play Services\' font provider', async () => {
        const log = execFileSync('adb', ['logcat', '-d', '-v', 'brief'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        const hits = log.split('\n').filter((l) => /bentopdf.*FontsProvider|FontsProvider.*bentopdf|EmojiCompat/i.test(l));
        if (hits.length) throw new Error(hits.slice(0, 3).join(' | '));
    });
    await check('no script errors or security-policy violations', async () => {
        const all = [...pageErrors, ...policy];
        if (all.length) throw new Error(all.join(' | '));
    });

    if (socketWatch) clearInterval(socketWatch);
    if (appUid) pollSockets();
    console.log('Network');
    await check('the app opened no network connection', async () => {
        if (!appUid) return;
        if (!procNetReadable) {
            notes.push('/proc/net was not readable on this device, so the socket check relied on the missing permission alone.');
            return;
        }
        const outside = [...sockets.values()].filter((s) => !isLocalHex(s.remote));
        if (outside.length) throw new Error(outside.map((s) => `${s.table} remote ${s.remote}:${s.remotePort}`).join(', '));
    });
    console.log(`  info  sockets owned by the app during the test: ${sockets.size}`);

    await device.close().catch(() => {});
    for (const note of notes) console.log(`  note  ${note}`);
    if (failures.length) {
        console.error(`\n${failures.length} problem(s) found.`);
        process.exit(1);
    }
    console.log('\nAll Android checks passed.');
})().catch(async (err) => {
    console.error(err);
    if (socketWatch) clearInterval(socketWatch);
    await dumpDiagnostics('unexpected error');
    process.exit(1);
});
