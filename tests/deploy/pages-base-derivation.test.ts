/**
 * Production Pages build correctness tests (parent MS-0MUQ1KXAS003FJ42,
 * child MS-0MUQZH53F004ZKAN).
 *
 * Verifies the observable production-build behaviour that makes the GitHub
 * Pages deployment addressable at its project path:
 *  - the production base is derived generically from `package.json` `name`
 *    (last path segment) — the real build emits `/tce-main-street/assets/...`;
 *  - a `PAGES_BASE` environment override replaces the derived base;
 *  - the page title is Main Street-specific;
 *  - the client-side 404 guard resolves its target under the production base.
 *
 * Each build runs against the real `vite.config.ts` into a temp outDir so the
 * repo `dist/` is never touched.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { build } from 'vite';

const REPO_ROOT = process.cwd();
const DEFAULT_BASE = '/tce-main-street/';

/** Build the production app into a temp dir, optionally overriding PAGES_BASE. */
async function buildToTemp(pagesBase?: string): Promise<string> {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-pages-derive-'));
  const prevGames = process.env.GAMES_CONFIG;
  const prevPages = process.env.PAGES_BASE;
  process.env.GAMES_CONFIG = 'game';
  if (pagesBase === undefined) delete process.env.PAGES_BASE;
  else process.env.PAGES_BASE = pagesBase;
  try {
    await build({
      mode: 'production',
      root: REPO_ROOT,
      configFile: path.join(REPO_ROOT, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true, sourcemap: false },
    });
    return outDir;
  } catch (e) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw e;
  } finally {
    if (prevGames === undefined) delete process.env.GAMES_CONFIG;
    else process.env.GAMES_CONFIG = prevGames;
    if (prevPages === undefined) delete process.env.PAGES_BASE;
    else process.env.PAGES_BASE = prevPages;
  }
}

/** Concatenate the emitted JS bundle so we can assert built-in constants. */
function bundledJs(outDir: string): string {
  const assetsDir = path.join(outDir, 'assets');
  return fs
    .readdirSync(assetsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf-8'))
    .join('\n');
}

describe('production pages base derivation', () => {
  it('derives /tce-main-street/ from package.json and gives the page a Main Street title', async () => {
    const outDir = await buildToTemp();
    try {
      const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf-8');
      // Derived from the package name — the real build emits the Pages base.
      expect(html).toMatch(
        new RegExp(`src="${DEFAULT_BASE}assets/index-[^"]+\\.js"`),
      );
      expect(html).not.toMatch(/src="\/assets\//);
      // Main Street-specific identity.
      expect(html).toMatch(/<title>[^<]*Main Street[^<]*<\/title>/);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('honours the PAGES_BASE override for forks and custom domains', async () => {
    const outDir = await buildToTemp('/custom-base/');
    try {
      const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf-8');
      expect(html).toMatch(/src="\/custom-base\/assets\/index-[^"]+\.js"/);
      expect(html).not.toContain(`src="${DEFAULT_BASE}assets/`);
      expect(html).not.toMatch(/src="\/assets\//);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('the bundled 404 guard targets the production Pages base', async () => {
    const outDir = await buildToTemp();
    try {
      // The inline guard is bundled; Vite resolves import.meta.env.BASE_URL at
      // build time, so the emitted base must be the Pages path, not '/'.
      const bundle = bundledJs(outDir);
      expect(bundle).toContain('404.html');
      expect(bundle).toContain(DEFAULT_BASE);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);
});
