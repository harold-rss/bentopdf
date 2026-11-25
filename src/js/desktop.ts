// Integration with the desktop shell (see desktop/). In a browser
// `window.desktop` does not exist and none of this runs.
import { setupToolInterface } from './handlers/toolSelectionHandler.js';
import { showAlert, switchView } from './ui.js';
import { state } from './state.js';

interface DesktopFile {
    path: string;
    name: string;
    data: Uint8Array;
}

interface SaveResult {
    ok: boolean;
    reason?: string;
    path?: string;
    name?: string;
}

interface DesktopBridge {
    takeLaunchFile(): Promise<DesktopFile | null>;
    onOpenFile(callback: (file: DesktopFile) => void): void;
    onMenu(callback: (action: string) => void): void;
    save(data: ArrayBuffer): Promise<SaveResult>;
    saveAs(data: ArrayBuffer, suggestedName: string): Promise<SaveResult>;
    setDirty(dirty: boolean): void;
    documentClosed(): void;
    saveAbandoned(): void;
    adoptFile(file: File): void;
    openDialog(): void;
}

declare global {
    interface Window {
        desktop?: DesktopBridge;
    }
}

let documentName = 'document.pdf';
let dirty = false;
let saving = false;

function setDirty(value: boolean) {
    if (dirty === value) return;
    dirty = value;
    window.desktop?.setDirty(value);
}

function editorIsOpen() {
    return state.activeTool === 'edit' && document.documentElement.classList.contains('editor-open');
}

/** Opens a PDF handed over by the shell (double-click, File > Open) in the editor. */
export function openInEditor(file: { name: string; data: Uint8Array }) {
    setupToolInterface('edit');
    const input = document.getElementById('file-input') as HTMLInputElement | null;
    if (!input) return;
    const transfer = new DataTransfer();
    transfer.items.add(new File([file.data as BlobPart], file.name, { type: 'application/pdf' }));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function save(saveAs: boolean) {
    const desktop = window.desktop;
    if (!desktop || saving) return;
    if (!editorIsOpen()) {
        desktop.saveAbandoned();
        showAlert('Nothing to save', 'Save works when a PDF is open in the editor. The other tools save their result with their own button.');
        return;
    }
    saving = true;
    try {
        const { getEditorPdfBytes } = await import('./utils/pdf-editor.js');
        const bytes = await getEditorPdfBytes();
        if (!bytes) throw new Error('The editor returned no document.');
        let result = saveAs ? await desktop.saveAs(bytes, documentName) : await desktop.save(bytes);
        // No file on disk yet (for example a dropped file): ask where to save.
        if (!result.ok && result.reason === 'no-document') result = await desktop.saveAs(bytes, documentName);
        if (result.ok) {
            if (result.name) documentName = result.name;
            setDirty(false);
        }
    } catch (err) {
        console.error(err);
        desktop.saveAbandoned();
        showAlert('Could not save', 'The document could not be saved. Your changes are still open in the editor.');
    } finally {
        saving = false;
    }
}

function goHome() {
    if (dirty && !window.confirm('This document has unsaved changes. Close it without saving?')) return;
    switchView('grid');
    // Leaving the editor the normal way fires this from the back button's
    // handler; File > All Tools bypasses the button.
    window.dispatchEvent(new CustomEvent('pdf-editor:closed'));
}

export async function initDesktop() {
    const desktop = window.desktop;
    if (!desktop) return;
    const root = document.documentElement;
    root.classList.add('is-desktop', 'is-app');

    window.addEventListener('pdf-editor:opening', (event) => {
        documentName = (event as CustomEvent).detail?.name || 'document.pdf';
        dirty = false;
        root.classList.add('editor-open');
    });
    window.addEventListener('pdf-editor:changed', () => setDirty(true));
    window.addEventListener('pdf-editor:closed', () => {
        if (!root.classList.contains('editor-open')) return;
        root.classList.remove('editor-open');
        dirty = false;
        desktop.documentClosed();
        import('./utils/pdf-editor.js').then(({ closePdfEditor }) => closePdfEditor());
    });

    // Leaving the editor with unsaved changes asks first.
    document.getElementById('back-to-grid')?.addEventListener(
        'click',
        (event) => {
            if (editorIsOpen() && dirty && !window.confirm('This document has unsaved changes. Close it without saving?')) {
                event.stopImmediatePropagation();
                event.preventDefault();
            }
        },
        true
    );

    desktop.onMenu((action) => {
        if (action === 'save') save(false);
        else if (action === 'save-as') save(true);
        else if (action === 'home') goHome();
    });
    desktop.onOpenFile(openInEditor);

    const launchFile = await desktop.takeLaunchFile();
    if (launchFile) openInEditor(launchFile);
}
