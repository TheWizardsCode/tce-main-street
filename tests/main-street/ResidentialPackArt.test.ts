/**
 * Residential pack art — self-contained pack-asset resolution (F3/F6).
 *
 * Verification child of the Main Street DLC work item `MS-0MV26K321003MWO0`.
 * Proves the production residential pack's bespoke art is **self-contained**:
 * every card resolves through the pack's own declared `assets/<cardId>.png`
 * (inlined into the pack-art registry), and the base
 * `src/card-art-map.json` is no longer a hidden dependency of the pack.
 *
 * The pack-asset assertions here are the positive half of the contract; the
 * self-containment and degradation halves live in
 * `ResidentialPackArtGenerator.test.ts` / F7.
 *
 * @see src/MainStreetCardPackArt.ts
 * @see src/MainStreetCardArt.ts
 * @see src/scripts/generate-main-street-card-art.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  CARD_ART_FALLBACK,
  CARD_ART_RESOLUTION,
  getCardArtDataUri,
  getCardArtDataUriForCard,
  hasDedicatedCardArt,
} from '../../src/MainStreetCardArt';
import {
  getPackArtDataUri,
  registerPackArtAssets,
  resetPackArt,
} from '../../src/MainStreetCardPackArt';
// @ts-ignore: no declaration file for .mjs script — intentional
import { buildAliasesFromCsv, listSpriteNames } from '../../src/scripts/generate-main-street-card-art.mjs';
import artMapJson from '../../src/card-art-map.json';

import {
  BASE_CARD_CSV_PATH,
  RESIDENTIAL_PACK_DIR,
  parseCsvFragment,
  readResidentialPackCsv,
  residentialPackCardIdToAsset,
} from './helpers/residentialPack';

const ART_MAP = artMapJson as {
  version: number;
  aliases: Record<string, string>;
  art: Record<string, string>;
  fallback: string;
};

const PNG_DATA_URI = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const UNKNOWN_NAME = '__no_such_card__';

/** card id → { name, sprite } derived from the production pack CSV. */
function packCards(): Array<{ id: string; name: string; sprite: string }> {
  const { rows } = parseCsvFragment(readResidentialPackCsv());
  return rows
    .filter((row) => row.id)
    .map((row) => ({
      id: row.id,
      name: row.name,
      sprite: (row.newDisplayName || '').trim() || row.name,
    }));
}

/**
 * Register the production pack's real `assets/<cardId>.png` bytes as inlined
 * `data:` URIs — exactly what `bootstrapMainStreetCardPacks` does at boot.
 */
function registerProductionPackArt(): Record<string, string> {
  const assets: Record<string, string> = {};
  for (const [cardId, assetPath] of residentialPackCardIdToAsset()) {
    const bytes = readFileSync(path.join(RESIDENTIAL_PACK_DIR, assetPath));
    assets[cardId] = `data:image/png;base64,${bytes.toString('base64')}`;
  }
  registerPackArtAssets(assets);
  return assets;
}

/** The generic fallback data URI (what an art-less card renders). */
function fallbackDataUri(): string {
  return getCardArtDataUri(UNKNOWN_NAME);
}

afterEach(() => {
  resetPackArt();
});

describe('residential pack art — self-contained assets', () => {
  it('declares exactly one asset per card id', () => {
    const mapping = residentialPackCardIdToAsset();
    const cards = packCards();
    expect(cards.length).toBe(10);
    expect(mapping.size).toBe(cards.length);
    for (const card of cards) {
      expect(mapping.has(card.id), `${card.id} is declared`).toBe(true);
    }
  });

  it('carries real 256×256 non-placeholder PNG art for every card', async () => {
    for (const [cardId, assetPath] of residentialPackCardIdToAsset()) {
      const bytes = readFileSync(path.join(RESIDENTIAL_PACK_DIR, assetPath));
      const meta = await sharp(bytes).metadata();
      expect(meta.format, `${cardId} format`).toBe('png');
      expect(meta.width, `${cardId} width`).toBe(CARD_ART_RESOLUTION);
      expect(meta.height, `${cardId} height`).toBe(CARD_ART_RESOLUTION);

      const stats = await sharp(bytes).stats();
      for (const [index, channel] of stats.channels.slice(0, 3).entries()) {
        expect(
          channel.stdev,
          `${cardId} colour channel ${index} varies (non-placeholder)`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('resolves every pack card through the pack registry, not the base map', () => {
    const assets = registerProductionPackArt();

    for (const card of packCards()) {
      expect(getPackArtDataUri(card.id), `${card.id} registered`).toBe(
        assets[card.id],
      );

      const uri = getCardArtDataUriForCard(card.id, card.name);
      expect(uri, `${card.id} resolves to its pack asset`).toBe(assets[card.id]);
      expect(uri, `${card.id} is an inlined PNG data URI`).toMatch(PNG_DATA_URI);
      expect(uri, `${card.id} is not base-map art`).not.toBe(
        getCardArtDataUri(card.name),
      );
    }
  });

  it('does not bake pack art into the base map (decoupled)', () => {
    for (const card of packCards()) {
      expect(
        hasDedicatedCardArt(card.name),
        `${card.name} must not be a base-map key`,
      ).toBe(false);
      expect(getCardArtDataUri(card.name), `${card.name} base art`).toBe(
        fallbackDataUri(),
      );
    }
  });

  it('renders Fallback when the pack is not registered (self-containment)', () => {
    // No registry populated → the pack id is unknown → Fallback, never blank.
    for (const card of packCards()) {
      const uri = getCardArtDataUriForCard(card.id, card.name);
      expect(uri, `${card.id} falls back`).toBe(fallbackDataUri());
      expect(uri).toMatch(/^data:/);
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

  it('keeps an art-map entry for every base source sprite (and Fallback)', () => {
    const knownSprites = new Set(listSpriteNames());
    const baseAliases = buildAliasesFromCsv(
      BASE_CARD_CSV_PATH,
      knownSprites,
    ) as Record<string, string>;
    const baseSprites = new Set<string>([
      ...Object.values(baseAliases),
      CARD_ART_FALLBACK,
    ]);

    for (const sprite of baseSprites) {
      if (!knownSprites.has(sprite)) continue;
      expect(
        ART_MAP.art[sprite],
        `card-art-map.json is missing base art for sprite "${sprite}"`,
      ).toBeDefined();
    }
  });
});
