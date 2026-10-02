/**
 * Vite base-path gating tests for the GitHub Pages deployment
 * (parent MS-0MUQ1KXAS003FJ42, AC #1–#3).
 *
 * Proves the observable build behaviour:
 *   - `production` mode emits `/tce-main-street/assets/`-prefixed URLs so that
 *     the built artefact is addressable under the project Pages path.
 *   - `--mode electron` emits relative `./assets/...` URLs (file://-safe for
 *     the Electron launcher), with no Pages-path bleed.
 *   - The `public/assets/` tree is copied wholesale into the output directory.
 *
 * Each build runs against the real app (real vite.config.ts) into a temp
 * outDir so the repo `dist/` is never touched.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { build } from 'vite';

const REPO_ROOT = process.cwd();
const PAGES_PATH = '/tce-main-street/';

/**
 * Build the project into a temporary directory for the given mode,
 * restoring the previous GAMES_CONFIG afterwards.
 */
async function buildToTemp(
  mode: 'electron' | 'production',
): Promise<{ html: string; outDir: string }> {
  const outDir = fs.mkdtempSync(
    path.join(os.tmpdir(), `main-street-vite-${mode}-`),
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
    const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf-8');
    return { html, outDir };
  } catch (e) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw e;
  } finally {
    if (previousPreset === undefined) delete process.env.GAMES_CONFIG;
    else process.env.GAMES_CONFIG = previousPreset;
  }
}

describe('vite base-path gating (GitHub Pages)', () => {
  it('production build emits /tce-main-street/ prefixed asset URLs and no relative asset paths', async () => {
    const { html, outDir } = await buildToTemp('production');
    try {
      // The entry JS bundle must live under the Pages base path.
      expect(html).toMatch(
        new RegExp(`src="${PAGES_PATH}assets/index-[^"]+\\.js"`),
      );
      // No absolute '/assets/...' — everything goes through the base.
      expect(html).not.toMatch(/src="\/assets\//);
      expect(html).not.toMatch(/href="\/assets\//);
      // No relative paths that would break under a subdirectory URL.
      expect(html).not.toMatch(/src="\.\/assets\//);
      expect(html).not.toMatch(/href="\.\/assets\//);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('electron build mode emits relative ./ asset URLs and no absolute asset paths', async () => {
    const { html, outDir } = await buildToTemp('electron');
    try {
      // Electron uses file:// so all assets must be relative.
      expect(html).toMatch(/src="\.\/assets\//);
      expect(html).toMatch(/src="\.\/assets\/index-[^"]+\.js"/);
      // No Pages-path bleed.
      expect(html).not.toContain(PAGES_PATH);
      // No absolute '/assets/...' — relative is required for file://.
      expect(html).not.toMatch(/src="\/assets\//);
      expect(html).not.toMatch(/href="\/assets\//);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);

  it('production build copies the full public/assets tree into outDir', async () => {
    const { outDir } = await buildToTemp('production');
    try {
      // Verify at least one card SVG and one audio file landed in the output.
      const cardsDir = path.join(outDir, 'assets', 'cards');
      const audioDir = path.join(outDir, 'assets', 'audio');
      expect(fs.existsSync(cardsDir)).toBe(true);
      expect(fs.existsSync(audioDir)).toBe(true);
      // At least one SVG card file.
      const svgFiles = fs
        .readdirSync(cardsDir)
        .filter((f) => f.endsWith('.svg'));
      expect(svgFiles.length).toBeGreaterThan(0);
      // At least one audio file (any extension).
      const audioFiles = fs.readdirSync(audioDir);
      expect(audioFiles.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }, 120_000);
});
