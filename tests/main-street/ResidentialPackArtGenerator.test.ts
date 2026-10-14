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
import { RESIDENTIAL_PACK_ART, SOURCE_SUFFIX, generateResidentialPackArt, generateResidentialPackAssets, renderCardArtSvg, PACK_ASSET_SIZE } from '../../src/scripts/generate-residential-pack-art.mjs';
import artMapJson from '../../src/card-art-map.json';
import { residentialPackCardNames } from './helpers/residentialPack';

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

describe('base art map — production pack decoupled (F6)', () => {
  const ART_MAP = artMapJson as {
    art: Record<string, string>;
    aliases: Record<string, string>;
  };

  it('does not embed any residential pack source sprite', () => {
    for (const card of RESIDENTIAL_PACK_ART) {
      expect(
        ART_MAP.art[card.sprite],
        `${card.sprite} must not be baked into the base map`,
      ).toBeUndefined();
    }
  });

  it('does not alias any residential pack card name', () => {
    const names = residentialPackCardNames();
    expect(names.length).toBe(10);
    for (const name of names) {
      expect(
        ART_MAP.aliases[name],
        `${name} must not be aliased in the base map`,
      ).toBeUndefined();
    }
  });
});

describe('residential pack asset emission (assets/<cardId>.png)', () => {
  const COMMITTED_ASSETS_DIR = path.join(
    REPO_ROOT,
    'packs',
    'main-street',
    'main-street-residential-pack',
    'assets',
  );

  it('emits one deterministic 256×256 PNG per declared card id', async () => {
    const first = tempDir('ms-pack-assets-a-');
    const second = tempDir('ms-pack-assets-b-');

    const a = await generateResidentialPackAssets({
      packDir: first,
      csvPath: PACK_CSV,
      spritesDir: SPRITES_DIR,
    });
    const b = await generateResidentialPackAssets({
      packDir: second,
      csvPath: PACK_CSV,
      spritesDir: SPRITES_DIR,
    });

    expect(a.count).toBe(10);
    expect(b.count).toBe(10);
    expect([...a.assets].sort()).toEqual([...b.assets].sort());

    for (const cardId of a.assets) {
      const file = `${cardId}.png`;
      const bytesA = readFileSync(path.join(first, 'assets', file));
      const bytesB = readFileSync(path.join(second, 'assets', file));
      expect(bytesA.equals(bytesB), `${file} is byte-identical across runs`).toBe(
        true,
      );

      const meta = await sharp(bytesA).metadata();
      expect(meta.format, `${file} format`).toBe('png');
      expect(meta.width, `${file} width`).toBe(PACK_ASSET_SIZE);
      expect(meta.height, `${file} height`).toBe(PACK_ASSET_SIZE);

      const stats = await sharp(bytesA).stats();
      for (const [index, channel] of stats.channels.slice(0, 3).entries()) {
        expect(
          channel.stdev,
          `${file} colour channel ${index} varies (non-placeholder)`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('committed pack assets reproduce byte-identically from the sources', async () => {
    const out = tempDir('ms-pack-assets-committed-');
    await generateResidentialPackAssets({
      packDir: out,
      csvPath: PACK_CSV,
      spritesDir: SPRITES_DIR,
    });

    for (const cardId of [
      'biz-ms-residential-solar',
      'upg-ms-residential-smart-home',
      'evt-ms-residential-block-party',
    ]) {
      const committed = readFileSync(path.join(COMMITTED_ASSETS_DIR, `${cardId}.png`));
      const regenerated = readFileSync(path.join(out, 'assets', `${cardId}.png`));
      expect(regenerated.equals(committed), `${cardId} is reproducible`).toBe(true);
      // The committed asset must not be the old 1×1 placeholder.
      expect(committed.byteLength, `${cardId} is not a placeholder`).toBeGreaterThan(
        1000,
      );
    }
  });
});
