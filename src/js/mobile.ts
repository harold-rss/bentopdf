// Integration with the Android app (see android/). In a browser or the
// desktop app none of this runs.
//
// - Files the tools "download" go to Android's own Save dialog instead.
// - A PDF opened with "Open with BentoPDF" or shared to the app opens in
//   the editor.
// - The Back button returns to the tool list; a small bar above the editor
//   has Back and Save.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { openInEditor } from './desktop.js';
import { showAlert, switchView } from './ui.js';

interface PdfFilesPlugin {
    save(options: { name: string; data: string; mimeType?: string }): Promise<{ saved: boolean; name?: string }>;
    addListener(event: 'openFile', callback: (file: { name: string; data: string }) => void): Promise<PluginListenerHandle>;
    addListener(event: 'openFileError', callback: (error: { message: string }) => void): Promise<PluginListenerHandle>;
}

const PdfFiles = registerPlugin<PdfFilesPlugin>('PdfFiles');

let documentName = 'document.pdf';
let dirty = false;

function toast(message: string) {
    let el = document.getElementById('app-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'app-toast';
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.hidden = false;
    clearTimeout((el as any)._timer);
    (el as any)._timer = setTimeout(() => (el.hidden = true), 3000);
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

function base64ToBytes(data: string): Uint8Array {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

async function saveToDevice(blob: Blob, name: string): Promise<boolean> {
    try {
        const result = await PdfFiles.save({
            name: name || 'document.pdf',
            data: await blobToBase64(blob),
            mimeType: blob.type || undefined,
        });
        if (result.saved) toast(`Saved ${result.name || name}`);
        return result.saved;
    } catch (err) {
        console.error(err);
        showAlert('Could not save', String((err as Error)?.message || err));
        return false;
    }
}

/**
 * The tools (and the editor) save results by clicking a hidden
 * <a download href="blob:..."> link, which an Android web view ignores.
 * Remember each blob behind a blob: URL, and turn those clicks into
 * Android's Save dialog.
 */
function routeDownloadsToSaveDialog() {
    const blobs = new Map<string, Blob>();
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);

    URL.createObjectURL = (obj: Blob | MediaSource) => {
        const url = create(obj);
        if (obj instanceof Blob) blobs.set(url, obj);
        return url;
    };
    // The tools revoke the URL right after the click; keep the blob a while.
    URL.revokeObjectURL = (url: string) => {
        setTimeout(() => {
            blobs.delete(url);
            revoke(url);
        }, 60_000);
    };

    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        const blob = this.hasAttribute('download') ? blobs.get(this.href) : undefined;
        if (!blob) return originalClick.call(this);
        const name = this.getAttribute('download') || 'download';
        saveToDevice(blob, name);
    };
}

function editorOpen() {
    return document.documentElement.classList.contains('editor-open');
}

function goHome() {
    if (editorOpen() && dirty && !window.confirm('This document has unsaved changes. Close it without saving?')) return;
    switchView('grid');
    window.dispatchEvent(new CustomEvent('pdf-editor:closed'));
}

async function saveEditorDocument() {
    try {
        const { getEditorPdfBytes } = await import('./utils/pdf-editor.js');
        const bytes = await getEditorPdfBytes();
        if (!bytes) throw new Error('The editor returned no document.');
        const saved = await saveToDevice(new Blob([bytes], { type: 'application/pdf' }), documentName);
        if (saved) dirty = false;
    } catch (err) {
        console.error(err);
        showAlert('Could not save', 'The document could not be saved. Your changes are still open in the editor.');
    }
}

function addEditorBar() {
    const toolInterface = document.getElementById('tool-interface');
    if (!toolInterface || document.getElementById('app-editor-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'app-editor-bar';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn text-indigo-300 font-semibold px-3 py-2 rounded-lg hover:bg-gray-700';
    back.textContent = '← Tools';
    back.addEventListener('click', goHome);

    const name = document.createElement('span');
    name.id = 'app-editor-name';
    name.className = 'flex-1 truncate text-sm text-gray-300';

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded-lg';
    save.textContent = 'Save';
    save.addEventListener('click', saveEditorDocument);

    bar.append(back, name, save);
    toolInterface.prepend(bar);
}

export async function initMobile() {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    const root = document.documentElement;
    root.classList.add('is-app', 'is-android');

    routeDownloadsToSaveDialog();
    addEditorBar();

    window.addEventListener('pdf-editor:opening', (event) => {
        documentName = (event as CustomEvent).detail?.name || 'document.pdf';
        dirty = false;
        root.classList.add('editor-open');
        const label = document.getElementById('app-editor-name');
        if (label) label.textContent = documentName;
    });
    window.addEventListener('pdf-editor:changed', () => (dirty = true));
    window.addEventListener('pdf-editor:closed', () => {
        if (!root.classList.contains('editor-open')) return;
        root.classList.remove('editor-open');
        dirty = false;
        import('./utils/pdf-editor.js').then(({ closePdfEditor }) => closePdfEditor());
    });

    // Android Back: leave the current tool; on the tool list, leave the app.
    App.addListener('backButton', () => {
        const toolOpen = !document.getElementById('tool-interface')?.classList.contains('hidden');
        if (toolOpen) goHome();
        else App.minimizeApp();
    });

    PdfFiles.addListener('openFile', (file) => {
        if (editorOpen() && dirty && !window.confirm('Open the new PDF? Unsaved changes to the current one will be lost.')) return;
        if (editorOpen()) goHome();
        openInEditor({ name: file.name, data: base64ToBytes(file.data) });
    });
    PdfFiles.addListener('openFileError', (error) => showAlert('Could not open the file', error.message));
}
