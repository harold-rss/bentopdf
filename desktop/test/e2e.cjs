// End-to-end test of the desktop app.
//
//   npm run build            (in the repository root)
//   npm test                 (in desktop/; on Linux: xvfb-run -a npm test)
//
// Launches the real program with a PDF, as a double-click would, and checks
// that it opens in the editor, tracks unsaved changes, saves back to the same
// file, opens further files in their own window, and never touches the
// network. Needs Playwright (not a dependency; `npm i --no-save playwright`).
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument, StandardFonts, PDFName } = require('pdf-lib');

let electronLauncher;
try {
    electronLauncher = require('playwright')._electron;
} catch {
    console.error('Playwright is not installed. See the note at the top of desktop/test/e2e.cjs.');
    process.exit(2);
}

const desktopDir = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bentopdf-desktop-'));
const shotsDir = process.env.E2E_SCREENSHOTS;
const failures = [];

// A small red-and-white PNG.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAHgAAAA8CAIAAAAiz+n/AAAAzElEQVR42u3cwQmDQBRAwRisQ8tI/7ekDDtJBYpEfJJk5rosLI9/WZQdntN043z3qw/wL4SOCB0ROiJ0ROiI0BGhI0JHxu3lx7JcfcJv8prntSUTHRE6InRE6IjQEaEjQkeEjggdGY9s3rgI/aqPr8omOiJ0ROiI0BGhI0JHhI4IHRE6InRE6IjQEaEjQkeEjggdEToidEToiNCRQx9n/dS7n4mOCB0ROiJ0ROiI0BGhI0JHhI4MnvppmOiI0BGhI0JHhI4IHRE6InTkDSxfCn5PvP5OAAAAAElFTkSuQmCC',
    'base64'
);

async function makePdf(name, text) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    doc.addPage([595, 842]).drawText(text, { x: 60, y: 600, size: 34, font });
    const file = path.join(work, name);
    fs.writeFileSync(file, await doc.save());
    return file;
}

async function annotationCount(file) {
    const doc = await PDFDocument.load(fs.readFileSync(file));
    const annots = doc.getPage(0).node.Annots();
    return annots ? annots.size() : 0;
}

async function check(name, fn) {
    try {
        await fn();
        console.log(`  ok    ${name}`);
    } catch (err) {
        const message = String(err && err.message ? err.message : err).split('\n')[0];
        failures.push(`${name}: ${message}`);
        console.log(`  FAIL  ${name}: ${message}`);
    }
}

async function until(fn, what, timeout = 45000) {
    const start = Date.now();
    for (;;) {
        const value = await fn();
        if (value) return value;
        if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 200));
    }
}

// Draws a rectangle on the page with the editor's Shapes tool.
async function drawRectangle(page, area) {
    await page.getByText('Shapes', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Rectangle' }).first().click();
    await page.waitForTimeout(500);
    const box = await area.boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.75, { steps: 12 });
    await page.waitForTimeout(100);
    await page.mouse.up();
}

(async () => {
    const contract = await makePdf('contract.pdf', 'PRIVATE CONTRACT TEST');
    const second = await makePdf('second.pdf', 'SECOND DOCUMENT');
    const logo = path.join(work, 'logo.png');
    fs.writeFileSync(logo, PNG);
    const netlog = path.join(work, 'netlog.json');
    const original = fs.readFileSync(contract);

    // By default the test runs the source with the development Electron. Set
    // E2E_EXECUTABLE to test a packaged build (for example the unpacked
    // program electron-builder produces) exactly as a user would start it.
    const packaged = process.env.E2E_EXECUTABLE;
    const app = await electronLauncher.launch({
        executablePath: packaged || require(path.join(desktopDir, 'node_modules', 'electron')),
        // --no-sandbox only so the test can run as root in a container.
        args: packaged ? ['--no-sandbox', contract] : ['--no-sandbox', desktopDir, contract],
        env: { ...process.env, BENTOPDF_USER_DATA: path.join(work, 'profile'), BENTOPDF_NETLOG: netlog },
    });
    const titleOf = (index = 0) =>
        app.evaluate(({ BrowserWindow }, i) => {
            const wins = BrowserWindow.getAllWindows().sort((a, b) => a.id - b.id);
            return wins[i] ? wins[i].getTitle() : null;
        }, index);
    const sendMenu = (action, index = 0) =>
        app.evaluate(
            ({ BrowserWindow }, [a, i]) => {
                const wins = BrowserWindow.getAllWindows().sort((x, y) => x.id - y.id);
                wins[i].webContents.send('menu', a);
            },
            [action, index]
        );
    const shot = async (page, name) => {
        if (!shotsDir) return;
        fs.mkdirSync(shotsDir, { recursive: true });
        await page.screenshot({ path: path.join(shotsDir, `${name}.png`) });
    };

    const pageErrors = [];
    const win = await app.firstWindow();
    win.on('pageerror', (err) => pageErrors.push(err.message.split('\n')[0]));
    // The page inside the editor that shows the document.
    const pageArea = () => win.locator('#embed-pdf-container canvas, #embed-pdf-container img').first();

    try {
        console.log('Opening');
        await check('a PDF passed to the program opens in the editor', async () => {
            await until(async () => (await titleOf()) === 'contract.pdf - BentoPDF', 'window title');
            await pageArea().waitFor({ state: 'visible', timeout: 60000 });
            const classes = await win.evaluate(() => document.documentElement.className);
            if (!/is-desktop/.test(classes) || !/editor-open/.test(classes)) throw new Error(`classes: ${classes}`);
            await win.waitForTimeout(1500);
            await shot(win, '1-opened');
        });

        console.log('Privacy');
        await check('the page cannot reach another website', async () => {
            const results = await win.evaluate(async () => {
                const viaFetch = await fetch('https://example.com/').then(() => 'reached', () => 'blocked');
                const viaImage = await new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => resolve('reached');
                    img.onerror = () => resolve('blocked');
                    img.src = 'https://example.com/pixel.png';
                });
                return { viaFetch, viaImage };
            });
            if (results.viaFetch !== 'blocked' || results.viaImage !== 'blocked') throw new Error(JSON.stringify(results));
        });
        await check('the page has no access to Node.js', async () => {
            const leaked = await win.evaluate(() => typeof window.require !== 'undefined' || typeof window.process !== 'undefined');
            if (leaked) throw new Error('require/process are exposed to the page');
        });

        console.log('Editing and saving');
        await check('drawing on the page marks the document as changed', async () => {
            await drawRectangle(win, pageArea());
            await until(async () => (await titleOf()).startsWith('• '), 'unsaved-changes marker in the title');
            await shot(win, '2-rectangle');
        });
        await check('Save writes the change back to the same file', async () => {
            await sendMenu('save');
            await until(async () => !fs.readFileSync(contract).equals(original), 'the file on disk to change');
            await until(async () => (await titleOf()) === 'contract.pdf - BentoPDF', 'title without the marker');
            if ((await annotationCount(contract)) < 1) throw new Error('saved file has no annotation');
            const leftovers = fs.readdirSync(work).filter((f) => f.endsWith('.tmp'));
            if (leftovers.length) throw new Error(`temporary file left behind: ${leftovers}`);
        });
        await check('an image can be placed on the page', async () => {
            const before = await annotationCount(contract);
            // Insert > Image, click where it should go, then pick the file.
            await win.getByText('Insert', { exact: true }).first().click();
            await win.getByRole('button', { name: 'Image' }).first().click();
            await win.waitForTimeout(500);
            const box = await pageArea().boundingBox();
            const [chooser] = await Promise.all([
                win.waitForEvent('filechooser', { timeout: 15000 }),
                win.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.25),
            ]);
            await chooser.setFiles(logo);
            await until(async () => (await titleOf()).startsWith('• '), 'unsaved-changes marker after placing the image');
            await win.waitForTimeout(500);
            await shot(win, '3-image');
            await sendMenu('save');
            await until(async () => (await annotationCount(contract)) > before, 'the saved file to contain the image');
            await until(async () => (await titleOf()) === 'contract.pdf - BentoPDF', 'title without the marker');
        });

        console.log('Windows');
        await check('opening another PDF uses a new window and keeps the first', async () => {
            await app.evaluate(({ app: a }, file) => a.emit('second-instance', {}, [process.execPath, '.', file], process.cwd()), second);
            await until(async () => (await app.windows()).length === 2, 'second window');
            await until(async () => (await titleOf(1)) === 'second.pdf - BentoPDF', 'second window title');
            if ((await titleOf(0)) !== 'contract.pdf - BentoPDF') throw new Error('first window lost its document');
        });
        await check('All Tools returns to the tool grid without the website chrome', async () => {
            await sendMenu('home');
            await win.locator('#grid-view').waitFor({ state: 'visible', timeout: 10000 });
            await until(async () => (await titleOf(0)) === 'BentoPDF', 'title reset');
            const visible = await win.evaluate(() =>
                ['#hero-section', 'body > nav', 'body > footer', '#support-section'].filter((sel) => {
                    const el = document.querySelector(sel);
                    return el && getComputedStyle(el).display !== 'none';
                })
            );
            if (visible.length) throw new Error(`still visible: ${visible}`);
            if ((await win.locator('.tool-card').count()) < 10) throw new Error('tool grid is empty');
            await shot(win, '4-tools');
        });
        await check('closing with unsaved changes offers to save, and saves', async () => {
            const page2 = (await app.windows()).find((w) => w !== win);
            const area = page2.locator('#embed-pdf-container canvas, #embed-pdf-container img').first();
            await area.waitFor({ state: 'visible', timeout: 60000 });
            await drawRectangle(page2, area);
            await until(async () => (await titleOf(1)).startsWith('• '), 'unsaved-changes marker');
            // Answer the "Save changes?" prompt with "Save".
            await app.evaluate(({ dialog, BrowserWindow }) => {
                dialog.showMessageBoxSync = () => 0;
                BrowserWindow.getAllWindows()
                    .sort((a, b) => a.id - b.id)[1]
                    .close();
            });
            await until(async () => (await app.windows()).length === 1, 'second window to close');
            if ((await annotationCount(second)) < 1) throw new Error('changes were not saved before closing');
        });
        await check('no script errors', async () => {
            if (pageErrors.length) throw new Error(pageErrors.join(' | '));
        });
    } finally {
        await app.close().catch(() => {});
    }

    console.log('Network log');
    await check('the program never resolved a host name or opened a connection', async () => {
        const text = fs.readFileSync(netlog, 'utf8');
        let log;
        try {
            log = JSON.parse(text);
        } catch {
            log = JSON.parse(`${text.trim().replace(/,$/, '')}]}`); // log was not closed cleanly
        }
        const typeName = Object.fromEntries(Object.entries(log.constants.logEventTypes).map(([k, v]) => [v, k]));
        const events = log.events.map((e) => ({ type: typeName[e.type], params: e.params || {} }));

        // Anything that reaches the network needs a DNS lookup or a socket,
        // and sends bytes. (A "connect job" that fails at name resolution
        // never gets as far as any of these.)
        const lookups = events.filter((e) => /^HOST_RESOLVER_(DNS|SYSTEM)_TASK$|^DNS_TRANSACTION/.test(e.type));
        const sockets = events.filter((e) => /^(TCP_CONNECT|TCP_CONNECT_ATTEMPT|SSL_CONNECT|SOCKS_CONNECT|UDP_CONNECT|QUIC_SESSION)$/.test(e.type));
        const sent = events.filter((e) => /(BYTES|PACKET)_SENT$/.test(e.type));
        if (lookups.length || sockets.length || sent.length) {
            throw new Error(`${lookups.length} DNS lookup(s), ${sockets.length} socket(s), ${sent.length} send(s)`);
        }
        // Every connection job must have failed with "name not resolved" (-105).
        const jobs = events.filter((e) => /_CONNECT_JOB_CONNECT$/.test(e.type) && 'net_error' in e.params);
        const succeeded = events.filter((e) => /_CONNECT_JOB_CONNECT$/.test(e.type)).length / 2 - jobs.filter((e) => e.params.net_error === -105).length;
        if (succeeded > 0) throw new Error(`${succeeded} connection job(s) did not fail at name resolution`);
        // Every name the engine asked for must have been turned away.
        const resolved = events.filter((e) => e.type === 'HOST_RESOLVER_MANAGER_REQUEST' && e.params.host && !/~notfound/i.test(e.params.host));
        if (resolved.length) throw new Error(`resolver was asked for: ${resolved.map((e) => e.params.host).join(', ')}`);
    });
    await check('the only outside address even attempted is the blocked spell-check dictionary', async () => {
        const text = fs.readFileSync(netlog, 'utf8');
        const urls = new Set(text.match(/\b(?:https?|wss?|ftp):\/\/[^"\\\s]+/g) || []);
        const unexpected = [...urls].filter(
            (u) =>
                !u.startsWith('https://example.com/') && // this test's own probes
                !/^https:\/\/(redirector\.)?gvt1\.com(\/edgedl\/chrome\/dict\/|$)/.test(u) && // Chromium spell-check dictionary
                !/^https:\/\/~notfound/i.test(u)
        );
        if (unexpected.length) throw new Error(unexpected.slice(0, 5).join(', '));
    });

    if (failures.length) {
        console.error(`\n${failures.length} problem(s) found.`);
        process.exit(1);
    }
    console.log('\nAll desktop checks passed.');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
