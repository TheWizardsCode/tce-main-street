/**
 * Main Street card-pack boot + listing-wiring unit tests
 * (F9 / CG-0MUZIS4KZ003R1HP, cross-repo child CG-0MUZIS4KZ003R1HP).
 *
 * Covers the Main Street side of the card-pack channel that the core tests do
 * not: boot discovery before scene setup with a base-content fallback, the
 * enabled-set preference, the toggle re-merge (including the "refuse to strand
 * a live card" policy), and the shape handed to the reusable core
 * `CardPackListing`.
 *
 * @see src/MainStreetCardPacks.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CARD_DATA_RAW,
  CSV_CHECKSUM,
  getActiveCsvData,
  getBusinessTemplates,
  resetTemplatesToDefault,
} from '../../src/MainStreetCards';
import {
  MAIN_STREET_GAME_ID,
  applyEnabledMainStreetPacks,
  bootstrapMainStreetCardPacks,
  findMissingLiveTemplateIds,
  getActiveMainStreetPacks,
  getAvailableTemplateIds,
  getMainStreetCardPackLoadResult,
  isMainStreetCardPacksBootstrapped,
  resetMainStreetCardPacks,
  resolveBundledContentDir,
  resolveEnabledPackIds,
  setMainStreetCardPackLoadResult,
  toCardPackListingInput,
} from '../../src/MainStreetCardPacks';
import {
  PackSourceRegistry,
  createBundledPackSource,
} from '../../src/MainStreetPackSources';
import {
  getEnabledCardPackIds,
  setEnabledCardPackIds,
  type StorageLike,
} from '../../src/MainStreetPrefs';
import { setupMainStreetGame } from '../../src/MainStreetState';
import type { MainStreetState } from '../../src/MainStreetState';
import type { CardPackLoadResult, LoadedCardPack } from '@ui/CardPackLoader';
import {
  getPackArtDataUri,
  hasPackArt,
  registerPackArt,
} from '../../src/MainStreetCardPackArt';
import { getCardArtDataUriForCard } from '../../src/MainStreetCardArt';
import { generateCardSvgFromCsvRow } from '../../src/scenes/MainStreetCardSvgGenerator';

const BASE_HEADER = CARD_DATA_RAW.split('\n')[0];
const BASE_COLUMNS = BASE_HEADER.split(',');

const PACK_ID = 'main-street-foundations';
const PACK_BUSINESS_ID = 'biz-pack-teahouse';

/** Build a pack CSV row with the base column order. */
function packRow(fields: Record<string, string>): string {
  return BASE_COLUMNS.map((column) => fields[column] ?? '').join(',');
}

/** A one-row pack CSV fragment (an additive business card). */
function packCsv(): string {
  return [
    BASE_HEADER,
    packRow({
      family: 'business',
      id: PACK_BUSINESS_ID,
      name: 'Pack Tea House',
      cost: '300',
      baseIncome: '161',
      synergyTypes: 'Food',
      upgradePath: 'Pack Tea House',
      maxLevel: '2',
      reputationPerTurn: '20',
      description: 'A pack business card.',
    }),
  ].join('\n');
}

/** A loaded pack as the core loader would return it. */
function loadedPack(overrides: Partial<LoadedCardPack> = {}): LoadedCardPack {
  return {
    manifest: {
      id: PACK_ID,
      gameId: MAIN_STREET_GAME_ID,
      title: 'Foundations',
      description: 'The first Main Street pack.',
      version: '1.0.0',
      coreEngineVersion: '^0.1.0',
      cards: 'cards.csv',
    },
    csv: packCsv(),
    assetUrls: [],
    assetDataUris: {},
    status: {
      packId: PACK_ID,
      gameId: MAIN_STREET_GAME_ID,
      state: 'free',
      steamAppId: null,
      reason: null,
    },
    enabled: true,
    ...overrides,
  };
}

/** A minimal in-memory storage backend. */
function fakeStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

afterEach(() => {
  setMainStreetCardPackLoadResult(null);
  resetMainStreetCardPacks();
  vi.restoreAllMocks();
});

describe('bootstrapMainStreetCardPacks', () => {
  it('discovers the bundled pack when no content directory is available', async () => {
    resetTemplatesToDefault();

    const result = await bootstrapMainStreetCardPacks({
      contentDir: null,
      logger: { warn: () => {} },
    });

    // The browser fallback now discovers the build-time bundled residential
    // pack instead of bailing to base content.
    expect(result).not.toBeNull();
    expect(isMainStreetCardPacksBootstrapped()).toBe(true);
    expect(getMainStreetCardPackLoadResult()).toBe(result);
    // With no content unlock it stays gated: listed as locked, cards out of play.
    expect(result!.locked.map((pack) => pack.manifest.id)).toContain(
      'main-street-residential-pack',
    );
    expect(result!.pool.baseOnly).toBe(true);
    expect(getActiveCsvData()).toBe(CARD_DATA_RAW);
    expect(getAvailableTemplateIds()).not.toContain('biz-ms-residential-property-mgmt');
  });

  it('degrades to base content when the bundled source carries no pack', async () => {
    const result = await bootstrapMainStreetCardPacks({
      contentDir: null,
      packSources: new PackSourceRegistry(),
      storage: null,
      logger: { warn: () => {} },
    });

    // A missing bundled manifest must never throw and leaves base content.
    expect(result).not.toBeNull();
    expect(result!.pool.baseOnly).toBe(true);
    expect(getActiveCsvData()).toBe(CARD_DATA_RAW);
  });

  it('discovers, merges and applies installed packs before scene setup', async () => {
    const loader = vi.fn(async () => ({
      packs: [loadedPack()],
      incompatible: [],
      locked: [],
      errors: [],
    }));

    const result = await bootstrapMainStreetCardPacks({
      contentDir: '/content',
      loader,
    });

    expect(loader).toHaveBeenCalledOnce();
    expect(result).not.toBeNull();
    expect(getActiveCsvData()).toContain(PACK_BUSINESS_ID);
    expect(getAvailableTemplateIds()).toContain(PACK_BUSINESS_ID);
    expect(getActiveMainStreetPacks()).toEqual([{ id: PACK_ID, version: '1.0.0' }]);
    expect(getMainStreetCardPackLoadResult()).toBe(result);
  });

  it('seeds the active set from the stored enabled-pack preference', async () => {
    const storage = fakeStorage();
    setEnabledCardPackIds([], storage);
    const loader = vi.fn(async () => ({
      packs: [loadedPack()],
      incompatible: [],
      locked: [],
      errors: [],
    }));

    await bootstrapMainStreetCardPacks({ contentDir: '/content', loader, storage });

    // Preference is an explicit empty set: the pack is discovered but disabled.
    expect(getActiveMainStreetPacks()).toEqual([]);
    expect(getActiveCsvData()).toBe(CARD_DATA_RAW);
  });

  it('degrades to base content when the loader throws', async () => {
    const loader = vi.fn(async () => {
      throw new Error('manifest exploded');
    });

    const result = await bootstrapMainStreetCardPacks({
      contentDir: '/content',
      loader,
    });

    expect(result).not.toBeNull();
    expect(getActiveCsvData()).toBe(CARD_DATA_RAW);
    expect(getActiveMainStreetPacks()).toEqual([]);
  });
});

describe('resolveBundledContentDir', () => {
  it('derives the bundled content base from the web base path', () => {
    // The GitHub Pages project base must be preserved, not flattened to `/`.
    expect(resolveBundledContentDir('/tce-main-street/')).toBe('/tce-main-street/');
    expect(resolveBundledContentDir('/')).toBe('/');
  });

  it('defaults to the build-time web base and tolerates a blank value', () => {
    expect(resolveBundledContentDir()).toBe(import.meta.env.BASE_URL);
    expect(resolveBundledContentDir('')).toBe('/');
  });
});

describe('bundled pack-source boot transports', () => {
  const RESIDENTIAL_ID = 'main-street-residential-pack';
  const RESIDENTIAL_CARD_ID = 'biz-ms-residential-property-mgmt';
  const MANIFEST = JSON.stringify({
    version: 1,
    packs: [
      {
        id: RESIDENTIAL_ID,
        gameId: MAIN_STREET_GAME_ID,
        title: 'Main Street Residential',
        description: 'Residential pack',
        version: '1.0.0',
        coreEngineVersion: '^0.1.0',
        cards: 'cards.csv',
        assets: [`assets/${RESIDENTIAL_CARD_ID}.png`],
      },
    ],
  });

  function residentialCsv(): string {
    return [
      BASE_HEADER,
      packRow({
        family: 'business',
        id: RESIDENTIAL_CARD_ID,
        name: 'Neighbourhood Property Group',
        cost: '500',
        baseIncome: '120',
        description: 'A residential property business.',
      }),
    ].join('\n');
  }

  it('resolves bundled CSV and asset URLs through the registry with no tce-packs request', async () => {
    const emittedAssetUrl = '/tce-main-street/assets/biz-ms-residential-property-mgmt-abc.png';
    const registry = new PackSourceRegistry([
      createBundledPackSource({
        text: {
          'manifest.json': async () => MANIFEST,
          [`${MAIN_STREET_GAME_ID}/${RESIDENTIAL_ID}/cards.csv`]: async () => residentialCsv(),
        },
        urls: {
          [`${MAIN_STREET_GAME_ID}/${RESIDENTIAL_ID}/assets/${RESIDENTIAL_CARD_ID}.png`]:
            async () => emittedAssetUrl,
        },
      }),
    ]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
    } as never);

    const result = await bootstrapMainStreetCardPacks({
      contentDir: null,
      packSources: registry,
      client: {
        listStatus: async (refs: readonly { id: string; gameId: string | null }[]) =>
          refs.map((ref) => ({
            packId: ref.id,
            gameId: ref.gameId,
            state: 'free' as const,
            steamAppId: null,
            reason: null,
          })),
      } as never,
      contentUnlocks: {
        isUnlocked: async () => true,
        getUnlocks: async () => [],
        refresh: async () => [],
      },
      storage: null,
      logger: { warn: () => {} },
    });

    expect(result!.pool.activePacks).toEqual([{ id: RESIDENTIAL_ID, version: '1.0.0' }]);
    // The asset is read from the registry's same-origin (`?url`) resolution, so
    // no request ever targets the Electron-only `tce-packs://` scheme.
    expect(fetchSpy).toHaveBeenCalledWith(emittedAssetUrl);
    expect(
      fetchSpy.mock.calls.every(([url]) => !String(url).startsWith('tce-packs://')),
    ).toBe(true);
  });
});

describe('bootstrapMainStreetCardPacks — pack-art registry', () => {
  const PACK_ART_URI =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  function loaderWithPackArt() {
    return vi.fn(async () => ({
      packs: [
        loadedPack({ assetDataUris: { [PACK_BUSINESS_ID]: PACK_ART_URI } }),
      ],
      incompatible: [],
      locked: [],
      errors: [],
    }));
  }

  it('registers every loaded pack\'s inlined assets before scene setup', async () => {
    await bootstrapMainStreetCardPacks({
      contentDir: '/content',
      loader: loaderWithPackArt(),
    });

    expect(hasPackArt(PACK_BUSINESS_ID)).toBe(true);
    expect(getPackArtDataUri(PACK_BUSINESS_ID)).toBe(PACK_ART_URI);
    expect(getCardArtDataUriForCard(PACK_BUSINESS_ID, 'Pack Tea House')).toBe(
      PACK_ART_URI,
    );
  });

  it('clears the registry on reset', async () => {
    await bootstrapMainStreetCardPacks({
      contentDir: '/content',
      loader: loaderWithPackArt(),
    });
    expect(hasPackArt(PACK_BUSINESS_ID)).toBe(true);

    resetMainStreetCardPacks();

    expect(hasPackArt(PACK_BUSINESS_ID)).toBe(false);
  });

  it('leaves the registry base-only when the loader fails', async () => {
    registerPackArt(PACK_BUSINESS_ID, PACK_ART_URI);
    const loader = vi.fn(async () => ({
      packs: [],
      incompatible: [],
      locked: [],
      errors: [{ id: PACK_ID, reason: 'boom' }],
    }));

    await bootstrapMainStreetCardPacks({ contentDir: '/content', loader });

    expect(hasPackArt(PACK_BUSINESS_ID)).toBe(false);
  });

  it('populates the registry before the SVG generator draws a pack card (ordering)', async () => {
    await bootstrapMainStreetCardPacks({
      contentDir: '/content',
      loader: loaderWithPackArt(),
    });

    const svg = generateCardSvgFromCsvRow({
      id: PACK_BUSINESS_ID,
      name: 'Pack Tea House',
      family: 'business',
    });

    expect(svg).toContain(PACK_ART_URI);
  });
});

describe('resolveEnabledPackIds', () => {
  it('enables every loaded pack when no preference is stored', () => {
    const load = { loaded: [loadedPack()] } as never;
    expect(resolveEnabledPackIds(load, null)).toEqual([PACK_ID]);
  });

  it('honours an explicit empty preference (all packs disabled)', () => {
    const storage = fakeStorage();
    setEnabledCardPackIds([], storage);
    const load = { loaded: [loadedPack()] } as never;
    expect(resolveEnabledPackIds(load, storage)).toEqual([]);
  });

  it('returns the stored ids when present', () => {
    const storage = fakeStorage();
    setEnabledCardPackIds([PACK_ID], storage);
    const load = { loaded: [loadedPack()] } as never;
    expect(resolveEnabledPackIds(load, storage)).toEqual([PACK_ID]);
  });
});

describe('applyEnabledMainStreetPacks', () => {
  it('re-merges and applies the pool for a new enabled set, persisting it', () => {
    const storage = fakeStorage();
    const load = {
      pool: null,
      loaded: [loadedPack()],
      locked: [],
      incompatible: [],
      warnings: [],
      errors: [],
    } as never;

    const outcome = applyEnabledMainStreetPacks(load, [PACK_ID], { storage });

    expect(outcome.applied).toBe(true);
    expect(getAvailableTemplateIds()).toContain(PACK_BUSINESS_ID);
    expect(getEnabledCardPackIds(storage)).toEqual([PACK_ID]);
  });

  it('disables a pack and reverts the merged pool', () => {
    const storage = fakeStorage();
    const load = {
      pool: null,
      loaded: [loadedPack()],
      locked: [],
      incompatible: [],
      warnings: [],
      errors: [],
    } as never;

    applyEnabledMainStreetPacks(load, [PACK_ID], { storage });
    const outcome = applyEnabledMainStreetPacks(load, [], { storage });

    expect(outcome.applied).toBe(true);
    expect(getAvailableTemplateIds()).not.toContain(PACK_BUSINESS_ID);
    expect(getActiveCsvData()).toBe(CARD_DATA_RAW);
    expect(getEnabledCardPackIds(storage)).toEqual([]);
  });

  it('refuses to disable a pack whose card is still live and restores the pool', () => {
    const storage = fakeStorage();
    const load = {
      pool: null,
      loaded: [loadedPack()],
      locked: [],
      incompatible: [],
      warnings: [],
      errors: [],
    } as never;
    applyEnabledMainStreetPacks(load, [PACK_ID], { storage });

    const state = setupMainStreetGame() as MainStreetState;
    // A live instance that only the pack supplies (hand is scanned by the
    // live-template resolver).
    (state.hand as unknown[]).push({ id: PACK_BUSINESS_ID, name: 'Pack Tea House' });

    const outcome = applyEnabledMainStreetPacks(load, [], { storage, state });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toMatch(/in play/);
    // Pool restored — the live card still resolves.
    expect(getAvailableTemplateIds()).toContain(PACK_BUSINESS_ID);
    expect(getActiveMainStreetPacks()).toEqual([{ id: PACK_ID, version: '1.0.0' }]);
  });

  it('reports a refusal when no packs were discovered', () => {
    const outcome = applyEnabledMainStreetPacks(null, []);
    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toMatch(/No card packs/);
  });
});

describe('toCardPackListingInput', () => {
  it('shapes the discovery result and marks only the enabled packs enabled', () => {
    const load = {
      pool: null,
      loaded: [loadedPack()],
      locked: [
        {
          manifest: {
            id: 'locked-pack',
            gameId: MAIN_STREET_GAME_ID,
            title: 'Locked',
            description: '',
            version: '1.0.0',
            coreEngineVersion: '^0.1.0',
            cards: 'cards.csv',
          },
          status: {
            packId: 'locked-pack',
            gameId: MAIN_STREET_GAME_ID,
            state: 'locked',
            steamAppId: 7,
            reason: 'Steam is unavailable.',
          },
          reason: 'Steam is unavailable.',
        },
      ],
      incompatible: [],
      warnings: [],
      errors: [],
    } as never;

    const input: CardPackLoadResult = toCardPackListingInput(load, []);
    expect(input.packs).toHaveLength(1);
    expect(input.packs[0].enabled).toBe(false);
    expect(input.locked).toHaveLength(1);
    expect(input.locked[0].reason).toBe('Steam is unavailable.');
  });

  it('returns an empty result when nothing was discovered', () => {
    const input = toCardPackListingInput(null, []);
    expect(input.packs).toEqual([]);
    expect(input.locked).toEqual([]);
    expect(input.incompatible).toEqual([]);
    expect(input.errors).toEqual([]);
  });
});

describe('enabled-pack preference', () => {
  it('round-trips a de-duplicated id list', () => {
    const storage = fakeStorage();
    setEnabledCardPackIds(['a', 'b', 'a'], storage);
    expect(getEnabledCardPackIds(storage)).toEqual(['a', 'b']);
  });

  it('returns null when the preference was never written', () => {
    expect(getEnabledCardPackIds(fakeStorage())).toBeNull();
  });

  it('returns null for a malformed stored value rather than throwing', () => {
    const storage = fakeStorage();
    storage.setItem('tce-main-street-enabled-card-packs', '{not json');
    expect(getEnabledCardPackIds(storage)).toBeNull();
  });
});

describe('live-template resolution (copy-suffix safe)', () => {
  it('treats a suffixed live instance as its base template', () => {
    // Live deck instances carry a copy suffix (`biz-bakery-1`) while templates
    // are keyed by the base id — the resolver must not report them missing.
    const state = { hand: [{ id: 'biz-bakery-1' }] } as unknown as MainStreetState;
    expect(findMissingLiveTemplateIds(state)).toEqual([]);
  });
});

describe('main-street base pool invariants', () => {
  it('keeps the base template set available at all times', () => {
    // Guard against the boot path ever clearing base content.
    expect(getBusinessTemplates().length).toBeGreaterThan(0);
    expect(CSV_CHECKSUM).toBeTruthy();
  });
});
