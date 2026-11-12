// The PDF editor (EmbedPDF) is bundled with the app instead of being loaded
// from snippet.embedpdf.com, and every asset it would otherwise fetch from a
// CDN is either served from this app or switched off.
import EmbedPDF from '@embedpdf/snippet';
import pdfiumWasmUrl from '@embedpdf/snippet/dist/pdfium.wasm?url';

export function openPdfEditor(target: HTMLElement, src: string) {
    return EmbedPDF.init({
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
}
