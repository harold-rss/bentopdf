// The PDF editor (EmbedPDF) is bundled with the app instead of being loaded
// from snippet.embedpdf.com, and every asset it would otherwise fetch from a
// CDN is either served from this app or switched off.
import EmbedPDF from '@embedpdf/snippet';
import pdfiumWasmUrl from '@embedpdf/snippet/dist/pdfium.wasm?url';

// The editor that is currently open, if any.
let current: any = null;

const capability = (registry: any, id: string) => registry?.getCapabilityProvider?.(id)?.provides?.() ?? null;

export function openPdfEditor(target: HTMLElement, src: string) {
    const container = EmbedPDF.init({
        type: 'container',
        target,
        src,
        theme: { preference: 'dark' },
        // The engine runs in a blob: worker, which cannot resolve relative URLs.
        wasmUrl: new URL(pdfiumWasmUrl, window.location.href).toString(),
        // Default is a set of font packages on jsDelivr.
        fontFallback: null,
        // Default is a stamp library on jsDelivr.
        stamp: { manifests: [] },
        // Defaults are Google Fonts stylesheets. These families are already
        // loaded by the app's own stylesheet.
        fonts: {
            ui: { family: "'DM Sans', system-ui, sans-serif" },
            signature: {
                fonts: [
                    { name: 'Signature', family: "'Great Vibes', cursive" },
                    { name: 'Script', family: "'Dancing Script', cursive" },
                    { name: 'Handwritten', family: "'Kalam', cursive" },
                ],
            },
        },
    });
    current = container ?? null;
    if (container) watchForChanges(container);
    return container;
}

// Lets the desktop shell know when the document has unsaved changes.
async function watchForChanges(container: any) {
    try {
        const registry = await container.registry;
        if (current !== container) return;
        const changed = () => {
            if (current === container) window.dispatchEvent(new CustomEvent('pdf-editor:changed'));
        };
        capability(registry, 'history')?.onHistoryChange?.(changed);
        capability(registry, 'annotation')?.onAnnotationEvent?.((event: any) => {
            // "loaded" fires when the document's existing annotations are read.
            if (event?.type !== 'loaded') changed();
        });
        capability(registry, 'form')?.onFieldValueChange?.(changed);
        window.dispatchEvent(new CustomEvent('pdf-editor:ready'));
    } catch (err) {
        console.error(err);
    }
}

export function closePdfEditor() {
    current = null;
}

/** The open document, including any edits, as PDF bytes. */
export async function getEditorPdfBytes(): Promise<ArrayBuffer | null> {
    if (!current) return null;
    const registry = await current.registry;
    const annotations = capability(registry, 'annotation');
    // Write pending annotation changes into the document first.
    if (annotations?.commit) await annotations.commit().toPromise();
    const exporter = capability(registry, 'export');
    if (!exporter) return null;
    return exporter.saveAsCopy().toPromise();
}
