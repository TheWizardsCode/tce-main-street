/**
 * Pack-art registry and pack-aware resolution (F3, `MS-0MV26K321003MWO0`).
 *
 * Proves the resolution contract of `src/MainStreetCardPackArt.ts` and
 * `getCardArtDataUriForCard`:
 *
 *   1. a card supplied by a pack resolves its rendered art from the pack's
 *      declared asset (Option A: asset filename stem = card id);
 *   2. a base card is never shadowed when the pack registry is populated;
 *   3. a card with no pack asset falls back to the base name-keyed map and
 *      then the generic `Fallback` sprite.
 *
 * @see src/MainStreetCardPackArt.ts
 * @see src/MainStreetCardArt.ts
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  getCardArtDataUri,
  getCardArtDataUriForCard,
} from '../../src/MainStreetCardArt';
import {
  getPackArtDataUri,
  hasPackArt,
  packArtCount,
  registerPackArt,
  registerPackArtAssets,
  resetPackArt,
} from '../../src/MainStreetCardPackArt';
import { buildLoadedCardPack } from './helpers/packArt';
import artMapJson from '../../src/card-art-map.json';

const PACK_CARD_ID = 'biz-ms-residential-solar';
const PACK_CARD_NAME = 'Residential Solar Co-op';
const PACK_ART_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** A base sprite name guaranteed to have dedicated art in the base map. */
const BASE_SPRITE_NAME = Object.keys(
  (artMapJson as { art: Record<string, string> }).art,
)[0];

afterEach(() => {
  resetPackArt();
});

describe('pack-art registry', () => {
  it('registers, looks up and clears pack art by card id', () => {
    expect(hasPackArt(PACK_CARD_ID)).toBe(false);
    expect(getPackArtDataUri(PACK_CARD_ID)).toBeUndefined();

    registerPackArt(PACK_CARD_ID, PACK_ART_URI);

    expect(hasPackArt(PACK_CARD_ID)).toBe(true);
    expect(getPackArtDataUri(PACK_CARD_ID)).toBe(PACK_ART_URI);
    expect(packArtCount()).toBe(1);

    resetPackArt();

    expect(hasPackArt(PACK_CARD_ID)).toBe(false);
    expect(getPackArtDataUri(PACK_CARD_ID)).toBeUndefined();
    expect(packArtCount()).toBe(0);
  });

  it('ignores blank ids/URIs and registers whole asset maps', () => {
    registerPackArt('', PACK_ART_URI);
    registerPackArt(PACK_CARD_ID, '');
    expect(packArtCount()).toBe(0);

    registerPackArtAssets({ [PACK_CARD_ID]: PACK_ART_URI, '': PACK_ART_URI });
    expect(packArtCount()).toBe(1);
    expect(getPackArtDataUri(PACK_CARD_ID)).toBe(PACK_ART_URI);
  });
});

describe('pack-aware art resolution', () => {
  it('resolves a pack card to its pack asset by card id', () => {
    registerPackArt(PACK_CARD_ID, PACK_ART_URI);

    expect(getCardArtDataUriForCard(PACK_CARD_ID, PACK_CARD_NAME)).toBe(
      PACK_ART_URI,
    );
  });

  it('is id-keyed: the pack asset follows the card id, not the display name', () => {
    registerPackArt(PACK_CARD_ID, PACK_ART_URI);

    // Same name, different (unregistered) id → base map.
    expect(getCardArtDataUriForCard('some-other-id', PACK_CARD_NAME)).toBe(
      getCardArtDataUri(PACK_CARD_NAME),
    );
    // Registered id with any name → the pack asset.
    expect(getCardArtDataUriForCard(PACK_CARD_ID, 'Renamed Card')).toBe(
      PACK_ART_URI,
    );
  });

  it('does not shadow base card art when a pack registry is populated', () => {
    registerPackArt(PACK_CARD_ID, PACK_ART_URI);

    const baseArt = getCardArtDataUri(BASE_SPRITE_NAME);
    expect(baseArt).toMatch(/^data:/);
    expect(getCardArtDataUriForCard('base-card-id', BASE_SPRITE_NAME)).toBe(
      baseArt,
    );
  });

  it('falls back to the base map, then Fallback, when no pack asset exists', () => {
    // 1. Pack asset wins for a registered id.
    registerPackArt(PACK_CARD_ID, PACK_ART_URI);
    expect(getCardArtDataUriForCard(PACK_CARD_ID, 'anything')).toBe(PACK_ART_URI);
    resetPackArt();

    // 2. Base map for an unregistered id with dedicated base art.
    expect(getCardArtDataUriForCard('base-id', BASE_SPRITE_NAME)).toBe(
      getCardArtDataUri(BASE_SPRITE_NAME),
    );

    // 3. Fallback for an unknown id and unknown name.
    const unknown = getCardArtDataUriForCard('no-such-id', '__no_such_card__');
    expect(unknown).toMatch(/^data:/);
    expect(unknown).toBe(getCardArtDataUri('__no_such_card__'));
  });

  it('resolves a loaded pack through registerPackArtAssets', () => {
    const pack = buildLoadedCardPack({
      assets: { [PACK_CARD_ID]: new Uint8Array([1, 2, 3]) },
    });
    registerPackArtAssets(pack.assetDataUris);

    expect(getCardArtDataUriForCard(PACK_CARD_ID, PACK_CARD_NAME)).toBe(
      pack.assetDataUris[PACK_CARD_ID],
    );
  });
});
