/**
 * Asserts the game entry declares the core app-icon links and every referenced
 * `public/` file exists (CG-0MUUFZSE90061KKL).
 *
 * The icon set is composed from the `./core` submodule by the scaffold's
 * `sharedPublicRoot` linkage; this test guards against a game entry drifting
 * from that convention (a missing link, a leading-slash href that would 404
 * under a GitHub Pages sub-path, or a missing composed file).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..');

/** The three declared links, in `<head>` order, with their base-relative hrefs. */
const ICON_LINKS: Array<{ rel: string; type?: string; href: string }> = [
  { rel: 'icon', type: 'image/svg+xml', href: 'favicon.svg' },
  { rel: 'apple-touch-icon', href: 'apple-touch-icon.png' },
  { rel: 'manifest', href: 'site.webmanifest' },
];

/** Every core root icon file the scaffold composes into `public/`. */
const ROOT_ICON_FILES = [
  'favicon.svg',
  'apple-touch-icon.png',
  'icon-32.png',
  'icon-192.png',
  'icon-512.png',
  'site.webmanifest',
] as const;

function readIndexHtml(): string {
  return fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf-8');
}

describe('game entry app icons', () => {
  it('declares the three base-relative icon links', () => {
    const html = readIndexHtml();
    for (const { rel, type, href } of ICON_LINKS) {
      const typeAttr = type ? ` type="${type}"` : '';
      expect(html).toContain(`<link rel="${rel}"${typeAttr} href="${href}" />`);
    }
  });

  it('never uses a leading-slash or dot-slash icon href', () => {
    const html = readIndexHtml();
    for (const { href } of ICON_LINKS) {
      expect(html).not.toContain(`href="/${href}"`);
      expect(html).not.toContain(`href="./${href}"`);
    }
  });

  it('ships every referenced icon file in public/', () => {
    for (const { href } of ICON_LINKS) {
      expect(
        fs.existsSync(path.join(REPO_ROOT, 'public', href)),
        `${href} is missing from public/`,
      ).toBe(true);
    }
  });

  it('composes all six core root icon files into public/', () => {
    for (const file of ROOT_ICON_FILES) {
      expect(
        fs.existsSync(path.join(REPO_ROOT, 'public', file)),
        `${file} is missing from public/`,
      ).toBe(true);
    }
  });
});
