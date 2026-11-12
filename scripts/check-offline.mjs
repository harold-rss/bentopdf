// Verifies that the built app works with no access to any other website.
//
//   npm run build
//   npm run check:offline
//
// It serves dist/ locally, opens every page and the tools that used to load
// code or data from other sites, and fails if anything tries to contact a
// host other than this machine, or if the browser reports a security-policy
// violation.
//
// Needs Playwright with a Chromium browser. It is not a project dependency;
// install it once with `npm i --no-save playwright && npx playwright install chromium`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const require = createRequire(import.meta.url);
let chromium;
try {
    ({ chromium } = require('playwright'));
} catch {
    console.error('Playwright is not installed. See the note at the top of scripts/check-offline.mjs.');
    process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4179;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const shotsDir = process.env.CHECK_OFFLINE_SCREENSHOTS;
const failures = [];
const outsideRequests = new Set();
const policyViolations = new Set();
const pageErrors = new Set();

const isLocal = (url) => {
    if (/^(data|blob|about):/.test(url)) return true;
    try {
        return ['127.0.0.1', 'localhost'].includes(new URL(url).hostname);
    } catch {
        return false;
    }
};

async function makeSamplePdf() {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    for (const line of ['PRIVATE CONTRACT TEST', 'SECOND PAGE']) {
        const page = doc.addPage([595, 842]);
        page.drawText(line, { x: 60, y: 600, size: 34, font });
    }
    const file = join(mkdtempSync(join(tmpdir(), 'bentopdf-check-')), 'sample.pdf');
    writeFileSync(file, await doc.save());
    return file;
}

async function startServer() {
    const server = spawn(
        process.execPath,
        [join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
        { cwd: root, stdio: 'ignore' }
    );
    for (let i = 0; i < 60; i++) {
        try {
            if ((await fetch(ORIGIN)).ok) return server;
        } catch {
            /* not up yet */
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    server.kill();
    throw new Error('Preview server did not start. Run `npm run build` first.');
}

async function check(name, fn) {
    try {
        await fn();
        console.log(`  ok    ${name}`);
    } catch (err) {
        failures.push(`${name}: ${err.message.split('\n')[0]}`);
        console.log(`  FAIL  ${name}: ${err.message.split('\n')[0]}`);
    }
}

const server = await startServer();
const browser = await chromium.launch();
try {
    const samplePdf = await makeSamplePdf();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    // Block and record anything addressed to another host.
    await context.route('**/*', (route) => {
        const url = route.request().url();
        if (isLocal(url)) return route.continue();
        outsideRequests.add(url);
        return route.abort();
    });
    context.on('request', (req) => {
        if (!isLocal(req.url())) outsideRequests.add(req.url());
    });
    await context.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
            console.error(`CSP-VIOLATION ${e.violatedDirective} ${e.blockedURI}`);
        });
    });

    const watch = (page) => {
        page.on('console', (msg) => {
            const text = msg.text();
            if (/CSP-VIOLATION|Content Security Policy|Refused to/i.test(text)) policyViolations.add(text.slice(0, 300));
        });
        page.on('pageerror', (err) => pageErrors.add(err.message.split('\n')[0]));
        return page;
    };
    const shot = async (page, name) => {
        if (!shotsDir) return;
        mkdirSync(shotsDir, { recursive: true });
        await page.screenshot({ path: join(shotsDir, `${name}.png`) });
    };
    const openTool = async (toolId) => {
        const page = watch(await context.newPage());
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle' });
        await page.click(`.tool-card[data-tool-id="${toolId}"]`);
        await page.setInputFiles('#file-input', samplePdf);
        return page;
    };

    console.log('Pages');
    for (const name of ['index', 'about', 'contact', 'faq', 'privacy', 'terms']) {
        await check(`${name}.html loads with icons, fonts and a security policy`, async () => {
            const page = watch(await context.newPage());
            await page.goto(`${ORIGIN}/${name}.html`, { waitUntil: 'networkidle' });
            await page.evaluate(() => document.fonts.ready);
            const state = await page.evaluate(() => ({
                unrenderedIcons: document.querySelectorAll('i[data-lucide]').length,
                font: document.fonts.check("16px 'DM Sans'"),
                policy: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
            }));
            if (state.unrenderedIcons) throw new Error(`${state.unrenderedIcons} icon(s) not rendered`);
            if (!state.font) throw new Error('DM Sans did not load');
            if (!state.policy) throw new Error('no Content-Security-Policy meta tag');
            await shot(page, `page-${name}`);
            await page.close();
        });
    }

    console.log('Tools');
    await check('Sign PDF: typed signature uses bundled fonts', async () => {
        const page = await openTool('sign-pdf');
        await page.waitForFunction(() => !!document.getElementById('type-tab-btn')?.onclick, null, { timeout: 20000 });
        await page.click('#type-tab-btn');
        await page.fill('#signature-text-input', 'Test Signer');
        await page.evaluate(() => document.fonts.load("32px 'Great Vibes'"));
        if (!(await page.evaluate(() => document.fonts.check("32px 'Great Vibes'")))) throw new Error('signature font did not load');
        await page.click('#save-type-btn');
        await page.waitForSelector('#saved-signatures-container img', { timeout: 15000 });
        await shot(page, 'tool-sign');
        await page.close();
    });

    await check('Crop PDF: cropper styles are bundled', async () => {
        const page = await openTool('cropper');
        await page.waitForSelector('.cropper-container', { timeout: 20000 });
        const position = await page.evaluate(() => getComputedStyle(document.querySelector('.cropper-container')).position);
        if (position !== 'relative') throw new Error(`cropper stylesheet missing (position: ${position})`);
        await shot(page, 'tool-crop');
        await page.close();
    });

    await check('PDF Editor: loads from the app and renders the document', async () => {
        const page = await openTool('edit');
        await page.waitForFunction(
            () => {
                const host = document.querySelector('#embed-pdf-container')?.firstElementChild;
                const scope = host?.shadowRoot ?? host;
                return !!scope && scope.querySelectorAll('canvas, img').length > 0;
            },
            null,
            { timeout: 30000 }
        );
        await page.waitForTimeout(1500);
        await shot(page, 'tool-editor');
        await page.close();
    });

    await check('OCR: recognises text with bundled engine and language data', async () => {
        const page = await openTool('ocr-pdf');
        await page.waitForSelector('#ocr-options:not(.hidden)', { timeout: 15000 });
        const languages = await page.$$eval('.lang-checkbox', (els) => els.map((el) => el.value));
        if (!languages.includes('eng')) throw new Error(`English is not bundled (found: ${languages.join(', ')})`);
        await page.check('.lang-checkbox[value="eng"]');
        await page.click('#process-btn');
        await page.waitForSelector('#ocr-results:not(.hidden)', { timeout: 120000 });
        const text = await page.inputValue('#ocr-text-output');
        if (!/PRIVATE\s+CONTRACT\s+TEST/i.test(text)) throw new Error(`unexpected OCR text: ${JSON.stringify(text.slice(0, 80))}`);
        await shot(page, 'tool-ocr');
        await page.close();
    });

    await check('HEIC to PDF: converts without eval()', async () => {
        const page = watch(await context.newPage());
        await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'networkidle' });
        await page.click('.tool-card[data-tool-id="heic-to-pdf"]');
        await page.setInputFiles('#file-input', join(root, 'scripts/fixtures/sample.heic'));
        const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 60000 }),
            page.click('#process-btn'),
        ]);
        if (!download.suggestedFilename().endsWith('.pdf')) throw new Error('no PDF produced');
        await page.close();
    });

    console.log('Network');
    await check('no request to any other website', async () => {
        if (outsideRequests.size) throw new Error([...outsideRequests].join(', '));
    });
    await check('no security-policy violations', async () => {
        if (policyViolations.size) throw new Error([...policyViolations].join(' | '));
    });
    await check('no script errors', async () => {
        if (pageErrors.size) throw new Error([...pageErrors].join(' | '));
    });
} finally {
    await browser.close();
    server.kill();
}

if (failures.length) {
    console.error(`\n${failures.length} problem(s) found.`);
    process.exit(1);
}
console.log('\nAll offline checks passed.');
