/**
 * Residential pack art — deterministic source-sprite generator.
 *
 * Child of the Main Street DLC work item `MS-0MV0M5BHH0020WFY`. Covers the
 * additions this child owns: the deterministic generator that produces the
 * pack's `src/sprites/<Name>_1024_x_1024.png` source art, and the art-map
 * generator's extension to read the production pack CSV fragments. The full
 * resolver/agreement verification lives in `ResidentialPackArt.test.ts`.
 *
 * @see src/scripts/generate-residential-pack-art.mjs
 * @see src/scripts/generate-main-street-card-art.mjs
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';

// @ts-ignore: no declaration file for the .mjs generator — intentional
import { RESIDENTIAL_PACK_ART, SOURCE_SUFFIX, generateResidentialPackArt, renderCardArtSvg } from '../../src/scripts/generate-residential-pack-art.mjs';
// @ts-ignore: no declaration file for the .mjs generator — intentional
import { buildMappingsFromCsv, listPackCsvPaths, listSpriteNames } from '../../src/scripts/generate-main-street-card-art.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const SPRITES_DIR = path.join(REPO_ROOT, 'src/sprites');
const PACK_CSV = path.join(
  REPO_ROOT,
  'packs',
  'main-street',
  'main-street-residential-pack',
  'cards.csv',
);

const tempRoots: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('residential pack art generator — determinism', () => {
  it('renders byte-identical PNGs for identical input', async () => {
    const first = tempDir('ms-residential-art-a-');
    const second = tempDir('ms-residential-art-b-');

    const a = await generateResidentialPackArt({ spritesDir: first });
    const b = await generateResidentialPackArt({ spritesDir: second });

    expect(a.count).toBe(RESIDENTIAL_PACK_ART.length);
    expect(b.count).toBe(RESIDENTIAL_PACK_ART.length);

    for (const sprite of a.sprites) {
      const file = `${sprite}${SOURCE_SUFFIX}`;
      expect(
        readFileSync(path.join(first, file)).equals(readFileSync(path.join(second, file))),
        `${file} should be byte-identical across runs`,
      ).toBe(true);
    }
  });

  it('renders each committed pack sprite byte-identically to a fresh generation', async () => {
    const outDir = tempDir('ms-residential-art-committed-');
    const { sprites } = await generateResidentialPackArt({ spritesDir: outDir });

    for (const sprite of sprites) {
      const file = `${sprite}${SOURCE_SUFFIX}`;
      const committed = readFileSync(path.join(SPRITES_DIR, file));
      const regenerated = readFileSync(path.join(outDir, file));
      expect(regenerated.equals(committed), `${file} is reproducible`).toBe(true);
    }
  });

  it('produces 1024×1024 PNG source sprites', async () => {
    const outDir = tempDir('ms-residential-art-size-');
    const { sprites } = await generateResidentialPackArt({ spritesDir: outDir });

    for (const sprite of sprites) {
      const meta = await sharp(
        readFileSync(path.join(outDir, `${sprite}${SOURCE_SUFFIX}`)),
      ).metadata();
      expect(meta.format, `${sprite} format`).toBe('png');
      expect(meta.width, `${sprite} width`).toBe(1024);
      expect(meta.height, `${sprite} height`).toBe(1024);
    }
  });

  it('produces a distinct SVG motif for every card', () => {
    const svgs = RESIDENTIAL_PACK_ART.map((card: { motif: string }) => renderCardArtSvg(card));
    expect(new Set(svgs).size).toBe(svgs.length);
  });
});

describe('art-map generator — pack CSV coverage', () => {
  it('discovers the production residential pack CSV fragment', () => {
    const paths = listPackCsvPaths();
    expect(paths).toContain(PACK_CSV);
  });

  it('maps every pack card name to a sprite that exists on disk', () => {
    const knownSprites = new Set(listSpriteNames());
    const mappings = buildMappingsFromCsv(
      [path.join(REPO_ROOT, 'src/card-data.csv'), ...listPackCsvPaths()],
      knownSprites,
    ) as Record<string, string>;

    // Every card in the pack CSV resolves to a committed sprite.
    const packCsv = readFileSync(PACK_CSV, 'utf-8');
    const names = packCsv
      .split('\n')
      .slice(1)
      .map((line) => line.split(',')[2])
      .filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const target = mappings[name];
      expect(target, `${name} is mapped`).toBeTruthy();
      expect(knownSprites.has(target), `${name} → ${target} has committed art`).toBe(true);
    }
  });
});
