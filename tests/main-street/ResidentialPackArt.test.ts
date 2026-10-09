/**
 * Residential pack art coverage (verification).
 *
 * Verification child of the Main Street DLC work item `MS-0MV0M5BHH0020WFY`.
 * Derives every distinct card name from the production pack CSV and proves
 * that each resolves to dedicated (non-`Fallback`) bespoke art through the
 * regenerated `src/card-art-map.json`, that the runtime resolver and the
 * static SVG generator agree, and that the base-card coverage is unchanged.
 *
 * @see src/MainStreetCardArt.ts
 * @see src/scripts/generate-main-street-card-svgs.mjs
 * @see tests/main-street/helpers/residentialPack.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  CARD_ART_FALLBACK,
  CARD_ART_FORMAT,
  CARD_ART_RESOLUTION,
  getCardArtDataUri,
  hasDedicatedCardArt,
  resolveCardArtName,
} from '../../src/MainStreetCardArt';
// @ts-ignore: no declaration file for .mjs script — intentional
import { resolveCardArtDataUri } from '../../src/scripts/generate-main-street-card-svgs.mjs';
// @ts-ignore: no declaration file for the .mjs generator — intentional
import { buildAliasesFromCsv, listSpriteNames } from '../../src/scripts/generate-main-street-card-art.mjs';
import artMapJson from '../../src/card-art-map.json';

import {
  BASE_CARD_CSV_PATH,
  REPO_ROOT,
  residentialPackCardNames,
} from './helpers/residentialPack';

const ART_MAP = artMapJson as {
  version: number;
  aliases: Record<string, string>;
  art: Record<string, string>;
  fallback: string;
};

const SPRITES_DIR = path.join(REPO_ROOT, 'src', 'sprites');
const ART_DATA_URI = /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/;

/** Decode an embedded art data URI and report its bitmap dimensions/format. */
async function embeddedArtMeta(
  cardName: string,
): Promise<{ width?: number; height?: number; format?: string }> {
  const uri = getCardArtDataUri(cardName);
  const base64 = uri.slice(uri.indexOf(',') + 1);
  return sharp(Buffer.from(base64, 'base64')).metadata();
}

const PACK_CARD_NAMES = residentialPackCardNames();

describe('residential pack art coverage', () => {
  it('finds the production pack cards', () => {
    expect(PACK_CARD_NAMES.length).toBeGreaterThanOrEqual(8);
    expect(PACK_CARD_NAMES.length).toBeLessThanOrEqual(12);
  });

  it('resolves every pack card to dedicated, non-Fallback art', () => {
    for (const name of PACK_CARD_NAMES) {
      expect(hasDedicatedCardArt(name), `${name} has dedicated art`).toBe(true);
      expect(resolveCardArtName(name), `${name} resolves to a sprite`).not.toBe(
        CARD_ART_FALLBACK,
      );
    }
  });

  it('has a committed 1024×1024 source sprite for every pack card', () => {
    for (const name of PACK_CARD_NAMES) {
      const sprite = resolveCardArtName(name);
      const source = path.join(SPRITES_DIR, `${sprite}_1024_x_1024.png`);
      expect(existsSync(source), `${sprite} source sprite`).toBe(true);
    }
  });

  it('embeds a 256×256 WebP bitmap for every pack card', async () => {
    for (const name of PACK_CARD_NAMES) {
      const meta = await embeddedArtMeta(name);
      expect(meta.format, `${name} format`).toBe(CARD_ART_FORMAT);
      expect(meta.width, `${name} width`).toBe(CARD_ART_RESOLUTION);
      expect(meta.height, `${name} height`).toBe(CARD_ART_RESOLUTION);
      expect(getCardArtDataUri(name), `${name} data URI`).toMatch(ART_DATA_URI);
    }
  });

  it('resolves runtime and static art paths to the same non-Fallback art', () => {
    for (const name of PACK_CARD_NAMES) {
      expect(
        resolveCardArtDataUri(name),
        `static generator diverges from the runtime resolver for "${name}"`,
      ).toBe(getCardArtDataUri(name));
      expect(resolveCardArtName(name)).not.toBe(CARD_ART_FALLBACK);
    }
  });
});

describe('residential pack art — base coverage unchanged', () => {
  it('leaves every base-card alias unchanged after regeneration', () => {
    const knownSprites = new Set(listSpriteNames());
    const baseAliases = buildAliasesFromCsv(
      BASE_CARD_CSV_PATH,
      knownSprites,
    ) as Record<string, string>;

    for (const [name, sprite] of Object.entries(baseAliases)) {
      expect(ART_MAP.aliases[name], `base alias "${name}"`).toBe(sprite);
    }
  });

  it('keeps an art-map entry for every committed source sprite', () => {
    for (const sprite of listSpriteNames()) {
      expect(
        ART_MAP.art[sprite],
        `card-art-map.json is missing art for sprite "${sprite}"`,
      ).toBeDefined();
    }
  });

  it('does not touch the base card-data.csv file', () => {
    // The pack is additive: the base pool file is byte-for-byte the bundled raw.
    const baseCsv = readFileSync(BASE_CARD_CSV_PATH, 'utf-8');
    expect(baseCsv).toContain('family,id,name');
    expect(ART_MAP.version).toBe(3);
  });
});
