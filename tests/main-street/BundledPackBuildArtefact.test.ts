/**
 * Bundled pack build artefact (unit).
 *
 * Verification child of `MS-0MV1O7EGG004MWGD` ("Make card packs available in
 * the browser distribution"): independent proof of the bundled-pack claim made
 * by `MS-0MV53CFUS004DFX1` ("Pack-source registry and bundled source").
 *
 * The production web build must embed the committed residential pack with **no
 * manual `<contentDir>/packs/` copy step**. This suite drives Vite's production
 * build (the `vite build` half of `npm run build`) into a fresh temp `outDir`
 * and scans the emitted bundle text for the pack manifest, its `cards.csv` and
 * every declared asset. Because the `outDir` starts empty and nothing copies
 * `packs/` into it, a green run proves the `import.meta.glob` bundled source
 * (`createBundledPackSource`) baked the pack into the bundle.
 *
 * Building into a temp `outDir` mirrors `tests/deploy/vite-base-gating.test.ts`
 * and leaves the repo `dist/` untouched.
 *
 * @see src/MainStreetPackSources.ts — `createBundledPackSource` globs.
 * @see tests/main-street/PackSourceRegistry.test.ts — the registry contract.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';

const REPO_ROOT = process.cwd();
const PACKS_ROOT = path.join(REPO_ROOT, 'packs');
const GAME_ID = 'main-street';
const PACK_ID = 'main-street-residential-pack';
const PACK_ROOT = path.join(PACKS_ROOT, GAME_ID, PACK_ID);

/** Every emitted output file, relative to its root (POSIX separators). */
function listEmittedFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) found.push(rel);
    }
  };
  walk(root, '');
  return found;
}

/**
 * Run the real production Vite build into *outDir* (a `vite build`, the same
 * step `npm run build` runs after `tsc --noEmit`), restoring `GAMES_CONFIG`.
 */
async function buildWebBundle(outDir: string): Promise<void> {
  const previousPreset = process.env.GAMES_CONFIG;
  process.env.GAMES_CONFIG = 'game';
  try {
    await build({
      mode: 'production',
      root: REPO_ROOT,
      configFile: path.join(REPO_ROOT, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true, sourcemap: false },
    });
  } finally {
    if (previousPreset === undefined) delete process.env.GAMES_CONFIG;
    else process.env.GAMES_CONFIG = previousPreset;
  }
}

let outDir = '';
let emittedFiles: string[] = [];
let emittedText = '';

beforeAll(async () => {
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-pack-bundle-'));
  await buildWebBundle(outDir);
  emittedFiles = listEmittedFiles(outDir);
  // Only the emitted JavaScript carries the bundled pack content; source maps
  // are disabled for this build.
  emittedText = emittedFiles
    .filter((rel) => rel.endsWith('.js'))
    .map((rel) => fs.readFileSync(path.join(outDir, rel), 'utf-8'))
    .join('\n');
}, 180_000);

afterAll(() => {
  if (outDir !== '') fs.rmSync(outDir, { recursive: true, force: true });
});

describe('bundled residential pack in the production web build', () => {
  it('reaches the emitted output with no manual `packs/` copy into the build root', () => {
    // The temp outDir was empty before the build and nothing copied `packs/`
    // in, so any pack content below can only come from the bundle itself.
    expect(fs.existsSync(path.join(outDir, 'packs'))).toBe(false);
    expect(emittedFiles.length).toBeGreaterThan(0);
  });

  it('embeds the residential pack manifest verbatim', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PACKS_ROOT, 'manifest.json'), 'utf-8'),
    ) as { packs: Array<{ id: string; cards: string; assets: string[] }> };
    const pack = manifest.packs.find((candidate) => candidate.id === PACK_ID);
    expect(pack, 'committed manifest must declare the residential pack').toBeDefined();

    // The `?raw` glob inlines the committed file verbatim into an emitted JS
    // chunk, so the whole manifest text is present byte-for-byte.
    expect(emittedText).toContain(`"id": "${PACK_ID}"`);
    expect(emittedText).toContain(`"cards": "${pack!.cards}"`);
    expect(emittedText).toContain(`"gameId": "${GAME_ID}"`);
  });

  it('embeds the residential pack `cards.csv` verbatim', () => {
    const csv = fs.readFileSync(path.join(PACK_ROOT, 'cards.csv'), 'utf-8');
    // The CSV header and the first residential card id prove the real pack
    // rows (not a stub) made it into the bundle.
    expect(csv.length).toBeGreaterThan(0);
    expect(emittedText).toContain(csv);
    expect(emittedText).toContain('biz-ms-residential-property-mgmt');
  });

  it('emits or inlines every asset the manifest declares', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PACKS_ROOT, 'manifest.json'), 'utf-8'),
    ) as { packs: Array<{ id: string; assets: string[] }> };
    const assets = manifest.packs.find((candidate) => candidate.id === PACK_ID)!.assets;
    expect(assets.length).toBeGreaterThan(0);

    for (const assetPath of assets) {
      const basename = path.basename(assetPath, path.extname(assetPath));
      const chunk = emittedFiles.find(
        (rel) => rel.startsWith(`assets/${basename}-`) && rel.endsWith('.js'),
      );
      expect(chunk, `no emitted bundle chunk for ${assetPath}`).toBeDefined();

      const chunkText = fs.readFileSync(path.join(outDir, chunk!), 'utf-8');
      // A tiny placeholder asset is inlined as a data URI; a larger one is
      // emitted as a standalone file next to its chunk. Either proves the
      // `?url` glob resolved the committed asset into the build.
      const standalone = emittedFiles.find(
        (rel) =>
          rel.startsWith(`assets/${basename}-`) &&
          rel !== chunk &&
          !rel.endsWith('.js'),
      );
      const inlined = chunkText.includes('data:');
      expect(
        inlined || standalone !== undefined,
        `${assetPath} was neither inlined nor emitted as a file`,
      ).toBe(true);

      // The browser-usable URL never uses the Electron-only scheme.
      expect(chunkText).not.toContain('tce-packs://');
    }
  });
});
