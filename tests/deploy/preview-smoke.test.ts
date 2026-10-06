/**
 * Preview smoke test — verifies the production build serves correctly
 * under the GitHub Pages base path (parent MS-0MUQ1KXAS003FJ42, AC #1–#2).
 *
 * Uses `vite preview` to serve the production build and asserts that the
 * entry HTML and its JS/CSS entry points resolve without 404s.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { build, preview } from 'vite';
import type { PreviewServer } from 'vite';

const REPO_ROOT = process.cwd();
const PAGES_PATH = '/tce-main-street/';

/**
 * Build the project into a temporary directory and start a `vite preview`
 * server (random free port) against that directory.
 */
async function buildAndPreview(
  mode: 'production' | 'electron',
): Promise<{ server: PreviewServer; outDir: string; origin: string }> {
  const outDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `main-street-preview-${mode}-`),
  );
  const previousPreset = process.env.GAMES_CONFIG;
  process.env.GAMES_CONFIG = 'game';
  try {
    await build({
      mode,
      root: REPO_ROOT,
      configFile: path.join(REPO_ROOT, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true, sourcemap: false },
    });
    const server = await preview({
      root: REPO_ROOT,
      configFile: path.join(REPO_ROOT, 'vite.config.ts'),
      mode,
      logLevel: 'silent',
      preview: { port: 0, open: false, strictPort: false },
      build: { outDir },
    });
    const address = server.httpServer.address();
    const port =
      address && typeof address === 'object' ? address.port : 4173;
    return { server, outDir, origin: `http://localhost:${port}` };
  } catch (e) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw e;
  } finally {
    if (previousPreset === undefined) delete process.env.GAMES_CONFIG;
    else process.env.GAMES_CONFIG = previousPreset;
  }
}

async function fetchStatus(url: string): Promise<number> {
  const resp = await fetch(url, { redirect: 'manual' });
  return resp.status;
}

describe('preview smoke (GitHub Pages base path)', () => {
  it('serves index.html and the entry bundle under /tce-main-street/ with no 404s', async () => {
    const { server, outDir, origin } = await buildAndPreview('production');
    try {
      // The Pages entry point must be served at the base path.
      const indexResp = await fetch(`${origin}${PAGES_PATH}`);
      expect(indexResp.status).toBe(200);
      const html = await indexResp.text();

      // Entry JS must be under the Pages base.
      const jsMatch = html.match(
        new RegExp(`(?:src|href)="(${PAGES_PATH}assets/[^"]+)"`),
      );
      expect(jsMatch).not.toBeNull();
      const entryUrl = new URL(jsMatch![1], origin).toString();
      expect(entryUrl).toContain(PAGES_PATH);

      // Every referenced asset resolves (no 404s).
      const entryStatus = await fetchStatus(entryUrl);
      expect(entryStatus).toBe(200);

      // A root-absolute (un-prefixed) entry must NOT be what the page uses.
      expect(html).not.toMatch(/src="\/assets\//);
      expect(html).not.toMatch(/href="\/assets\//);
    } finally {
      await server.close();
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('electron build serves relative asset URLs at root with no Pages-path references', async () => {
    const { server, outDir, origin } = await buildAndPreview('electron');
    try {
      const indexResp = await fetch(`${origin}/`);
      expect(indexResp.status).toBe(200);
      const html = await indexResp.text();

      const jsMatch = html.match(/src="(\.\/assets\/[^"]+)"/);
      expect(jsMatch).not.toBeNull();
      const entryUrl = new URL(jsMatch![1], `${origin}/`).toString();
      expect(await fetchStatus(entryUrl)).toBe(200);

      expect(html).not.toContain(PAGES_PATH);
      expect(html).not.toMatch(/src="\/assets\//);
    } finally {
      await server.close();
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);
});
