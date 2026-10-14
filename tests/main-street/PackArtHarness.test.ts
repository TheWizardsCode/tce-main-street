/**
 * Pack-art test harness self-test.
 *
 * Child of the Main Street DLC work item `MS-0MV26K321003MWO0` (feature F1).
 * Proves the harness in `tests/main-street/helpers/packArt.ts` works on its
 * own: the committed fixtures decode, the fake transport serves their bytes
 * without network access, and the `LoadedCardPack` builder inlines
 * `data:image/png;base64,…` URIs keyed by card id.
 *
 * @see tests/main-street/helpers/packArt.ts
 * @see tests/main-street/helpers/residentialPack.ts
 */

import { existsSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import {
  PACK_ART_FIXTURES_DIR,
  buildLoadedCardPack,
  bytesToDataUri,
  createFakeAssetTransport,
  loadPackArtFixtures,
  loadResidentialPackArtFixtures,
  packArtFixturePath,
  packAssetStem,
  pngBytesToDataUri,
  readPackArtFixture,
} from './helpers/packArt';
import {
  RESIDENTIAL_PACK_ID,
  residentialPackAssetPaths,
  residentialPackCardIdToAsset,
} from './helpers/residentialPack';

/** The exact `data:` URI shape the SVG rasteriser consumes. */
const PNG_DATA_URI = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/** Fixture side length (px). */
const FIXTURE_SIZE = 256;

const CARD_ID_TO_ASSET = residentialPackCardIdToAsset();
const CARD_IDS = [...CARD_ID_TO_ASSET.keys()];

/** Decode the base64 payload of a `data:` URI. */
function decodeDataUri(dataUri: string): Uint8Array {
  return Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
}

describe('residential pack declared assets', () => {
  it('declares exactly one asset per card id with the id as filename stem', () => {
    const assetPaths = residentialPackAssetPaths();

    expect(assetPaths.length).toBeGreaterThanOrEqual(10);
    expect(new Set(assetPaths).size).toBe(assetPaths.length);
    expect(CARD_ID_TO_ASSET.size).toBe(assetPaths.length);

    for (const [cardId, assetPath] of CARD_ID_TO_ASSET) {
      expect(packAssetStem(assetPath), `${cardId} asset stem`).toBe(cardId);
      expect(assetPaths, `${cardId} is declared`).toContain(assetPath);
    }
  });
});

describe('pack-art fixtures', () => {
  it('has a committed PNG fixture for every declared card id', () => {
    expect(existsSync(PACK_ART_FIXTURES_DIR)).toBe(true);

    const fixtures = loadPackArtFixtures();
    expect(fixtures.size).toBe(CARD_IDS.length);

    for (const cardId of CARD_IDS) {
      expect(existsSync(packArtFixturePath(cardId)), `${cardId} fixture`).toBe(true);
      expect(fixtures.has(cardId), `${cardId} loads`).toBe(true);
    }
  });

  it('decodes every declared fixture as a 256×256 PNG with non-uniform pixels', async () => {
    const fixtures = loadResidentialPackArtFixtures();
    expect(fixtures.size).toBe(CARD_IDS.length);

    for (const cardId of CARD_IDS) {
      const bytes = fixtures.get(cardId) as Uint8Array;
      const meta = await sharp(bytes).metadata();
      expect(meta.format, `${cardId} format`).toBe('png');
      expect(meta.width, `${cardId} width`).toBe(FIXTURE_SIZE);
      expect(meta.height, `${cardId} height`).toBe(FIXTURE_SIZE);

      const stats = await sharp(bytes).stats();
      for (const [index, channel] of stats.channels.slice(0, 3).entries()) {
        expect(channel.stdev, `${cardId} colour channel ${index} varies`).toBeGreaterThan(0);
      }
    }
  });

  it('commits a distinct fixture per card id', () => {
    const fixtures = loadPackArtFixtures();
    const encoded = [...fixtures.values()].map((bytes) =>
      Buffer.from(bytes).toString('base64'),
    );
    expect(new Set(encoded).size).toBe(fixtures.size);
  });
});

describe('fake asset transport', () => {
  it('serves the fixture bytes for every resolved pack asset URL', async () => {
    const fixtures = loadPackArtFixtures();
    const transport = createFakeAssetTransport(fixtures);
    const pack = buildLoadedCardPack({ assets: fixtures });

    expect(pack.assetUrls.length).toBe(CARD_IDS.length);
    for (const url of pack.assetUrls) {
      const cardId = packAssetStem(url);
      const fixture = fixtures.get(cardId) as Uint8Array;
      const served = await transport(url);
      expect(
        Buffer.from(served).equals(Buffer.from(fixture)),
        `${url} serves its fixture bytes`,
      ).toBe(true);
    }
  });

  it('matches an exact URL key and falls back to the filename stem', async () => {
    const cardId = CARD_IDS[0];
    const bytes = readPackArtFixture(cardId);
    const url = `tce-packs://main-street/main-street-residential-pack/assets/${cardId}.png`;

    const byUrl = createFakeAssetTransport(new Map<string, Uint8Array>([[url, bytes]]));
    expect(Buffer.from(await byUrl(url)).equals(Buffer.from(bytes))).toBe(true);

    const byStem = createFakeAssetTransport({ [cardId]: bytes });
    expect(Buffer.from(await byStem(url)).equals(Buffer.from(bytes))).toBe(true);
  });

  it('rejects an unknown asset URL with an actionable error', async () => {
    const transport = createFakeAssetTransport(loadPackArtFixtures());
    await expect(
      transport(
        'tce-packs://main-street/main-street-residential-pack/assets/does-not-exist.png',
      ),
    ).rejects.toThrow(/no bytes/);
  });
});

describe('LoadedCardPack builder', () => {
  it('inlines every fixture as a data:image/png;base64 URI keyed by card id', () => {
    const fixtures = loadResidentialPackArtFixtures();
    const pack = buildLoadedCardPack({ assets: fixtures });

    expect(Object.keys(pack.assetDataUris).sort()).toEqual([...CARD_IDS].sort());
    for (const cardId of CARD_IDS) {
      const uri = pack.assetDataUris[cardId];
      expect(uri, `${cardId} data URI`).toMatch(PNG_DATA_URI);
      expect(
        Buffer.from(decodeDataUri(uri)).equals(
          Buffer.from(fixtures.get(cardId) as Uint8Array),
        ),
        `${cardId} inlined bytes round-trip`,
      ).toBe(true);
    }
  });

  it('derives the manifest asset list and resolved URLs from the card ids', () => {
    const fixtures = loadResidentialPackArtFixtures();
    const pack = buildLoadedCardPack({ assets: fixtures });

    expect(pack.enabled).toBe(true);
    expect(pack.manifest.id).toBe(RESIDENTIAL_PACK_ID);
    expect(pack.manifest.assets?.length).toBe(CARD_IDS.length);
    expect(pack.assetUrls.length).toBe(CARD_IDS.length);

    for (const url of pack.assetUrls) {
      expect(url.startsWith('tce-packs://')).toBe(true);
      expect(CARD_IDS, `${url} maps to a declared card`).toContain(packAssetStem(url));
    }
  });

  it('round-trips arbitrary bytes through the data-URI helpers', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);

    const pngUri = pngBytesToDataUri(bytes);
    expect(pngUri).toMatch(PNG_DATA_URI);
    expect([...decodeDataUri(pngUri)]).toEqual([...bytes]);

    const webpUri = bytesToDataUri(bytes, 'image/webp');
    expect(webpUri.startsWith('data:image/webp;base64,')).toBe(true);
    expect([...decodeDataUri(webpUri)]).toEqual([...bytes]);
  });
});
