import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

// Guards the offline/privacy hardening: the app must not load anything from
// another website. `npm run check:offline` tests the same thing in a real
// browser against the built app.

const root = resolve(__dirname, '../..');
const pages = readdirSync(root).filter((f) => f.endsWith('.html'));

const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === 'tests' ? [] : sourceFiles(path);
        return /\.(ts|js|css)$/.test(name) ? [path] : [];
    });

describe('offline hardening', () => {
    it('finds the HTML pages', () => {
        expect(pages).toContain('index.html');
    });

    it.each(pages)('%s loads no script, style, font, image or frame from another site', (page) => {
        const html = readFileSync(join(root, page), 'utf8');
        const tags = html.match(/<(script|link|img|iframe|source|video|audio|embed|object)\b[^>]*>/gi) ?? [];
        const external = tags.filter((tag) => /\b(src|href|data)\s*=\s*["']?\s*(https?:)?\/\//i.test(tag));
        expect(external).toEqual([]);
    });

    it.each(pages)('%s has no inline script (blocked by the security policy)', (page) => {
        const html = readFileSync(join(root, page), 'utf8');
        const inline = (html.match(/<script\b[^>]*>/gi) ?? []).filter((tag) => !/\bsrc\s*=/.test(tag));
        expect(inline).toEqual([]);
    });

    it('source code references no CDN or remote module', () => {
        const offenders = sourceFiles(join(root, 'src')).filter((file) => {
            const code = readFileSync(file, 'utf8');
            return (
                /cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|simpleanalytics/i.test(code) ||
                /\b(from|import)\s*\(?\s*["'`]https?:\/\//.test(code) ||
                /\b(fetch|importScripts)\(\s*["'`]https?:\/\//.test(code)
            );
        });
        expect(offenders).toEqual([]);
    });
});
