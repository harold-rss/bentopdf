import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Offline / privacy hardening
// ---------------------------------------------------------------------------

// The browser enforces this policy: the app may only load scripts, styles,
// fonts and images from itself, and may only connect to itself. Anything that
// tries to reach another website is blocked, including code in third-party
// libraries. `blob:` and `data:` are in-memory URLs, not network addresses.
const cspDirectives = (extraConnectSrc = '') => [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' data: blob:${extraConnectSrc}`,
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export const contentSecurityPolicy = cspDirectives();

// Vite's dev server needs a websocket for hot reload.
const devContentSecurityPolicy = cspDirectives(' ws://localhost:* ws://127.0.0.1:*');

// Builds get the policy as a <meta> tag so it applies however the files are
// hosted. The dev and preview servers send it as a header instead.
const contentSecurityPolicyPlugin = (): Plugin => ({
  name: 'content-security-policy',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: { 'http-equiv': 'Content-Security-Policy', content: contentSecurityPolicy },
      injectTo: 'head-prepend',
    },
  ],
});

// OCR language data comes from @tesseract.js-data/<code> packages, bundled
// with the app. To add a language: `npm install @tesseract.js-data/<code>`.
const ocrDataDir = resolve(__dirname, 'node_modules/@tesseract.js-data');
const ocrLanguages = existsSync(ocrDataDir)
  ? readdirSync(ocrDataDir).filter((lang) =>
      existsSync(resolve(ocrDataDir, lang, '4.0.0_best_int', `${lang}.traineddata.gz`))
    )
  : [];

export default defineConfig({
  define: {
    __OCR_LANGS__: JSON.stringify(ocrLanguages),
  },
  server: {
    headers: { 'Content-Security-Policy': devContentSecurityPolicy },
  },
  preview: {
    headers: { 'Content-Security-Policy': contentSecurityPolicy },
  },
  plugins: [
    contentSecurityPolicyPlugin(),
    // Serve the OCR worker, engine and language data from the app itself.
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/tesseract.js/dist/worker.min.js',
          dest: 'ocr',
          rename: { stripBase: true },
        },
        {
          src: 'node_modules/tesseract.js-core/tesseract-core*.wasm.js',
          dest: 'ocr/core',
          rename: { stripBase: true },
        },
        {
          src: 'node_modules/@tesseract.js-data/*/4.0.0_best_int/*.traineddata.gz',
          dest: 'ocr/lang',
          rename: { stripBase: true },
        },
      ],
    }),
    tailwindcss(),
    nodePolyfills({
      include: ['buffer', 'stream', 'util', 'zlib', 'process'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  resolve: {
    alias: {
      stream: 'stream-browserify',
      zlib: 'browserify-zlib',
    },
  },
  optimizeDeps: {
    include: ['pdfkit', 'blob-stream'],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        about: resolve(__dirname, 'about.html'),
        contact: resolve(__dirname, 'contact.html'),
        faq: resolve(__dirname, 'faq.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        terms: resolve(__dirname, 'terms.html'),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/tests/',
        '*.config.ts',
        '**/*.d.ts',
        'dist/',
      ],
    },
  },
});