// Desktop shell for BentoPDF.
//
// Runs the built web app (../dist) as a standalone program:
//   - the app is served from disk through a private app:// scheme, so there is
//     no web server and no open port;
//   - every network request that is not to the app itself is cancelled, and the
//     session is put in offline mode, on top of the app's own security policy;
//   - a PDF passed on the command line (double-click / "Open with") opens
//     straight in the PDF Editor, and can be saved back to the same file.
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, netLog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const APP_HOST = 'bentopdf';
const APP_ORIGIN = `app://${APP_HOST}`;
const webRoot = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.resolve(__dirname, '..', 'dist');

// Test hooks: a separate profile folder, and a log of all network activity.
if (process.env.BENTOPDF_USER_DATA) app.setPath('userData', process.env.BENTOPDF_USER_DATA);

// The program itself must never use the network, not only the page.
//
// 1. No host name can be resolved, and system proxy settings are ignored, so
//    nothing in the browser engine can open a connection to another machine.
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
app.commandLine.appendSwitch('no-proxy-server');

// 2. The engine's spell-checker asks a Google server for a dictionary when it
//    starts. Rule 1 already stops that request from going anywhere (the test
//    in test/e2e.cjs checks this); starting each profile with spell-checking
//    off keeps it from being retried.
function seedPreferences() {
    const file = path.join(app.getPath('userData'), 'Preferences');
    let prefs = {};
    try {
        prefs = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        /* new profile */
    }
    const languages = prefs.spellcheck && prefs.spellcheck.dictionaries;
    const off = prefs.browser && prefs.browser.enable_spellchecking === false;
    if (off && Array.isArray(languages) && languages.length === 0) return;
    prefs.browser = { ...(prefs.browser || {}), enable_spellchecking: false };
    prefs.spellcheck = { ...(prefs.spellcheck || {}), dictionaries: [], dictionary: '', use_spelling_service: false };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(prefs));
}
seedPreferences();

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.pdf': 'application/pdf',
    '.gz': 'application/gzip',
    '.txt': 'text/plain; charset=utf-8',
};

// Must run before the app is ready. "standard" + "secure" make app:// behave
// like https for the page: relative URLs, workers, WebAssembly, IndexedDB.
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// windowId -> { docPath: string | null, launchFile, dirty: boolean, approved: Set<string> }
const windows = new Map();

const isPdfPath = (p) => typeof p === 'string' && /\.pdf$/i.test(p) && fs.existsSync(p) && fs.statSync(p).isFile();

function pdfPathsFromArgv(argv, cwd) {
    // argv[0] is the program; in development argv[1] is this folder.
    return argv
        .slice(app.isPackaged ? 1 : 2)
        .filter((arg) => !arg.startsWith('-'))
        .map((arg) => path.resolve(cwd || process.cwd(), arg))
        .filter(isPdfPath);
}

async function readDocument(filePath) {
    const data = await fsp.readFile(filePath);
    return { path: filePath, name: path.basename(filePath), data: new Uint8Array(data) };
}

function setDocument(win, filePath) {
    const entry = windows.get(win.id);
    if (!entry) return;
    entry.docPath = filePath;
    entry.dirty = false;
    if (filePath) {
        entry.approved.add(filePath);
        app.addRecentDocument(filePath);
    }
    updateTitle(win);
}

function updateTitle(win) {
    const entry = windows.get(win.id);
    if (!entry) return;
    const name = entry.docPath ? path.basename(entry.docPath) : null;
    win.setTitle(name ? `${entry.dirty ? '• ' : ''}${name} - BentoPDF` : 'BentoPDF');
}

async function createWindow(filePath) {
    const win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 720,
        minHeight: 520,
        backgroundColor: '#111827',
        title: 'BentoPDF',
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            // Chromium would otherwise download spelling dictionaries from Google.
            spellcheck: false,
        },
    });
    const entry = { docPath: null, launchFile: null, dirty: false, approved: new Set() };
    windows.set(win.id, entry);
    const id = win.id;

    if (filePath) {
        try {
            entry.launchFile = await readDocument(filePath);
            setDocument(win, filePath);
        } catch (err) {
            dialog.showErrorBox('Could not open file', `${filePath}\n\n${err.message}`);
        }
    }

    // The page sets its own <title>; keep ours.
    win.on('page-title-updated', (event) => event.preventDefault());

    win.on('close', (event) => {
        const state = windows.get(id);
        if (!state || !state.dirty || state.closing) return;
        const choice = dialog.showMessageBoxSync(win, {
            type: 'warning',
            buttons: ['Save', "Don't Save", 'Cancel'],
            defaultId: 0,
            cancelId: 2,
            message: `Save changes to ${state.docPath ? path.basename(state.docPath) : 'this document'}?`,
            detail: 'Your changes will be lost if you close without saving.',
        });
        if (choice === 2) {
            event.preventDefault();
        } else if (choice === 0) {
            event.preventDefault();
            state.closeAfterSave = true;
            win.webContents.send('menu', 'save');
        }
    });
    win.on('closed', () => windows.delete(id));

    await win.loadURL(`${APP_ORIGIN}/index.html`);
    updateTitle(win);
    return win;
}

async function openDocument(filePath, preferredWindow) {
    // Already open? Bring that window forward.
    for (const [id, entry] of windows) {
        if (entry.docPath === filePath) {
            const existing = BrowserWindow.fromId(id);
            if (existing) {
                if (existing.isMinimized()) existing.restore();
                existing.focus();
                return existing;
            }
        }
    }
    // Reuse a window that has no document; otherwise open a new one, so an
    // open document is never replaced.
    const candidates = preferredWindow ? [preferredWindow, ...BrowserWindow.getAllWindows()] : BrowserWindow.getAllWindows();
    const empty = candidates.find((w) => windows.get(w.id) && !windows.get(w.id).docPath && !w.webContents.isLoading());
    if (empty) {
        try {
            const doc = await readDocument(filePath);
            setDocument(empty, filePath);
            empty.webContents.send('open-file', doc);
            if (empty.isMinimized()) empty.restore();
            empty.focus();
        } catch (err) {
            dialog.showErrorBox('Could not open file', `${filePath}\n\n${err.message}`);
        }
        return empty;
    }
    return createWindow(filePath);
}

async function showOpenDialog(win) {
    const result = await dialog.showOpenDialog(win, {
        title: 'Open PDF',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });
    if (result.canceled) return;
    for (const filePath of result.filePaths) await openDocument(filePath, win);
}

async function writeFileSafely(filePath, data) {
    // Write next to the target and rename, so a failed write cannot leave a
    // half-written contract behind.
    const tmp = `${filePath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, Buffer.from(data));
    try {
        await fsp.rename(tmp, filePath);
    } catch (err) {
        await fsp.rm(tmp, { force: true });
        throw err;
    }
}

function buildMenu() {
    const send = (action) => (_item, win) => win && win.webContents.send('menu', action);
    const template = [
        {
            label: '&File',
            submenu: [
                { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: (_item, win) => showOpenDialog(win) },
                { type: 'separator' },
                { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
                { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
                { type: 'separator' },
                { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow(null) },
                { type: 'separator' },
                { role: 'close' },
                { role: 'quit' },
            ],
        },
        {
            label: '&Edit',
            submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
        },
        {
            label: '&Tools',
            submenu: [{ label: 'All Tools', accelerator: 'CmdOrCtrl+T', click: send('home') }],
        },
        {
            label: '&View',
            submenu: [
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { role: 'resetZoom' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
                { type: 'separator' },
                { role: 'toggleDevTools' },
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function lockDownNetwork() {
    const ses = session.defaultSession;

    // Only the app's own files, and in-memory blob:/data: URLs, may be loaded.
    const allowed = (url) =>
        url.startsWith(`${APP_ORIGIN}/`) ||
        url.startsWith(`blob:${APP_ORIGIN}/`) ||
        url.startsWith('data:') ||
        (!app.isPackaged && url.startsWith('devtools://'));
    ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowed(details.url) }));

    // Spell-checking stays off (see seedPreferences above).
    ses.setSpellCheckerEnabled(false);
    ses.setSpellCheckerLanguages([]);

    // Belt and braces: the session's network stack itself is offline.
    ses.enableNetworkEmulation({ offline: true });

    // No camera, microphone, location, notifications and so on.
    const harmless = new Set(['clipboard-sanitized-write', 'fullscreen']);
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(harmless.has(permission)));
    ses.setPermissionCheckHandler((_wc, permission) => harmless.has(permission));

    // Downloads from the tools get a normal "Save As" dialog, starting in the
    // folder of the open document.
    ses.on('will-download', (_event, item, webContents) => {
        const win = BrowserWindow.fromWebContents(webContents);
        const entry = win && windows.get(win.id);
        const dir = entry && entry.docPath ? path.dirname(entry.docPath) : app.getPath('documents');
        item.setSaveDialogOptions({ defaultPath: path.join(dir, item.getFilename()) });
    });
}

function serveApp() {
    protocol.handle('app', async (request) => {
        const url = new URL(request.url);
        if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });
        let relative = decodeURIComponent(url.pathname);
        if (relative.endsWith('/')) relative += 'index.html';
        const file = path.normalize(path.join(webRoot, relative));
        if (file !== webRoot && !file.startsWith(webRoot + path.sep)) return new Response('Forbidden', { status: 403 });
        try {
            const data = await fsp.readFile(file);
            return new Response(data, {
                headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' },
            });
        } catch {
            return new Response('Not found', { status: 404 });
        }
    });
}

// ---------------------------------------------------------------------------
// Messages from the page (see preload.cjs)
// ---------------------------------------------------------------------------
const windowOf = (event) => BrowserWindow.fromWebContents(event.sender);

ipcMain.handle('desktop:take-launch-file', (event) => {
    const entry = windows.get(windowOf(event)?.id);
    if (!entry) return null;
    const file = entry.launchFile;
    entry.launchFile = null;
    return file;
});

ipcMain.handle('desktop:save', async (event, data) => {
    const win = windowOf(event);
    const entry = windows.get(win?.id);
    if (!entry || !entry.docPath || !entry.approved.has(entry.docPath)) return { ok: false, reason: 'no-document' };
    try {
        await writeFileSafely(entry.docPath, data);
    } catch (err) {
        dialog.showErrorBox('Could not save', `${entry.docPath}\n\n${err.message}`);
        return { ok: false, reason: 'write-failed' };
    }
    entry.dirty = false;
    updateTitle(win);
    if (entry.closeAfterSave) {
        entry.closing = true;
        win.close();
    }
    return { ok: true, path: entry.docPath, name: path.basename(entry.docPath) };
});

ipcMain.handle('desktop:save-as', async (event, data, suggestedName) => {
    const win = windowOf(event);
    const entry = windows.get(win?.id);
    if (!entry) return { ok: false, reason: 'no-window' };
    const dir = entry.docPath ? path.dirname(entry.docPath) : app.getPath('documents');
    const result = await dialog.showSaveDialog(win, {
        title: 'Save PDF As',
        defaultPath: path.join(dir, path.basename(String(suggestedName || 'document.pdf'))),
        filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) {
        entry.closeAfterSave = false;
        return { ok: false, reason: 'cancelled' };
    }
    try {
        await writeFileSafely(result.filePath, data);
    } catch (err) {
        dialog.showErrorBox('Could not save', `${result.filePath}\n\n${err.message}`);
        return { ok: false, reason: 'write-failed' };
    }
    setDocument(win, result.filePath);
    if (entry.closeAfterSave) {
        entry.closing = true;
        win.close();
    }
    return { ok: true, path: result.filePath, name: path.basename(result.filePath) };
});

ipcMain.on('desktop:set-dirty', (event, dirty) => {
    const win = windowOf(event);
    const entry = windows.get(win?.id);
    if (!entry) return;
    entry.dirty = !!dirty;
    updateTitle(win);
});

ipcMain.on('desktop:document-closed', (event) => {
    const win = windowOf(event);
    if (win) setDocument(win, null);
});

ipcMain.on('desktop:adopt-file', (event, filePath) => {
    const win = windowOf(event);
    if (win && isPdfPath(filePath)) setDocument(win, filePath);
});

ipcMain.on('desktop:save-abandoned', (event) => {
    const entry = windows.get(windowOf(event)?.id);
    if (entry) entry.closeAfterSave = false;
});

ipcMain.on('desktop:open-dialog', (event) => showOpenDialog(windowOf(event)));

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    // Double-clicking another PDF while the program is running lands here.
    app.on('second-instance', async (_event, argv, cwd) => {
        const files = pdfPathsFromArgv(argv, cwd);
        if (files.length === 0) {
            const win = BrowserWindow.getAllWindows()[0];
            if (win) {
                if (win.isMinimized()) win.restore();
                win.focus();
            }
            return;
        }
        for (const file of files) await openDocument(file);
    });

    // macOS delivers opened files as events instead of arguments.
    const pendingMacFiles = [];
    app.on('open-file', (event, filePath) => {
        event.preventDefault();
        if (app.isReady()) openDocument(filePath);
        else pendingMacFiles.push(filePath);
    });

    app.on('web-contents-created', (_event, contents) => {
        // No pop-ups, no navigating away from the app, no embedded webviews.
        contents.setWindowOpenHandler(() => ({ action: 'deny' }));
        contents.on('will-navigate', (event, url) => {
            if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
        });
        contents.on('will-attach-webview', (event) => event.preventDefault());
    });

    app.whenReady().then(async () => {
        if (process.env.BENTOPDF_NETLOG) await netLog.startLogging(process.env.BENTOPDF_NETLOG, { captureMode: 'default' });
        if (!fs.existsSync(path.join(webRoot, 'index.html'))) {
            dialog.showErrorBox('BentoPDF', `The app files are missing:\n${webRoot}\n\nRun "npm run build" first.`);
            app.quit();
            return;
        }
        serveApp();
        lockDownNetwork();
        buildMenu();

        const files = [...pdfPathsFromArgv(process.argv), ...pendingMacFiles.filter(isPdfPath)];
        if (files.length === 0) await createWindow(null);
        for (const file of files) await createWindow(file);
    });

    app.on('window-all-closed', async () => {
        if (netLog.currentlyLogging) await netLog.stopLogging();
        app.quit();
    });
}
