/**
 * Main Street card packs: merge, template accessors, save/load persistence and
 * missing-pack degradation (unit).
 *
 * Cross-repo child CG-0MUZIS410002Z8EH / Main Street MS-0MV07GNUU005E536.
 * @see src/MainStreetCardPacks.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CARD_DATA_RAW,
  CSV_CHECKSUM,
  getBusinessTemplates,
  getActiveCsvChecksum,
  getActiveCsvData,
  resetTemplatesToDefault,
} from '../../src/MainStreetCards';
import {
  MAIN_STREET_GAME_ID,
  MissingCardPackTemplateError,
  applyMainStreetCardPool,
  assertLiveTemplatesResolvable,
  collectLiveCardIds,
  findMissingLiveTemplateIds,
  getActiveMainStreetPacks,
  getAvailableTemplateIds,
  loadMainStreetCardPacks,
  mergeMainStreetCardPool,
  resetMainStreetCardPacks,
  setActiveMainStreetPacks,
} from '../../src/MainStreetCardPacks';
import {
  deserializeMainStreetState,
  serializeMainStreetState,
  setupMainStreetGame,
} from '../../src/MainStreetState';
import type { MainStreetState } from '../../src/MainStreetState';
import type { CardPackLoadResult, LoadedCardPack } from '@ui/CardPackLoader';

const BASE_HEADER = CARD_DATA_RAW.split('\n')[0];
const BASE_COLUMNS = BASE_HEADER.split(',');

const PACK_BUSINESS_ID = 'biz-pack-teahouse';
const PACK_EVENT_ID = 'evt-pack-fair';

/** Build a pack CSV row with the base column order. */
function packRow(fields: Record<string, string>): string {
  return BASE_COLUMNS.map((column) => fields[column] ?? '').join(',');
}

/** A pack CSV fragment with two additive rows (business + event). */
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
    packRow({
      family: 'event',
      id: PACK_EVENT_ID,
      name: 'Pack Fair',
      cost: '300',
      trigger: 'Investment',
      effect: 'Grants 200 coins.',
      target: 'SpecificSynergy',
      targetSynergy: 'Culture',
      coinDelta: '200',
      description: 'A pack event card.',
    }),
  ].join('\n');
}

/** A loaded pack as the core loader would return it. */
function loadedPack(overrides: Partial<LoadedCardPack> = {}): LoadedCardPack {
  return {
    manifest: {
      id: 'main-street-foundations',
      gameId: MAIN_STREET_GAME_ID,
      title: 'Test Pack',
      description: 'Test package',
      version: '1.0.0',
      coreEngineVersion: '^0.1.0',
      cards: 'cards.csv',
    },
    csv: packCsv(),
    assetUrls: [],
    status: { packId: 'main-street-foundations', gameId: MAIN_STREET_GAME_ID, state: 'free', steamAppId: null, reason: null },
    enabled: true,
    ...overrides,
  };
}

function emptyLoadResult(overrides: Partial<CardPackLoadResult> = {}): CardPackLoadResult {
  return { packs: [], incompatible: [], locked: [], errors: [], ...overrides };
}

afterEach(() => {
  resetMainStreetCardPacks();
  vi.restoreAllMocks();
});

describe('mergeMainStreetCardPool', () => {
  it('merges additive pack rows into the base pool and records the active pack', () => {
    const pool = mergeMainStreetCardPool(CARD_DATA_RAW, [loadedPack()]);

    expect(pool.baseOnly).toBe(false);
    expect(pool.activePacks).toEqual([{ id: 'main-street-foundations', version: '1.0.0' }]);
    expect(pool.checksum).not.toBe(CSV_CHECKSUM);
    expect(pool.csv).toContain(PACK_BUSINESS_ID);
    expect(pool.csv).toContain(PACK_EVENT_ID);
    // Base rows are preserved, pack rows appended.
    expect(pool.csv).toContain('biz-bakery');
    expect(pool.csv.split('\n')[0]).toBe(BASE_HEADER);
  });

  it('returns a base-only pool when no eligible pack is supplied', () => {
    const pool = mergeMainStreetCardPool(CARD_DATA_RAW, []);
    expect(pool.baseOnly).toBe(true);
    expect(pool.activePacks).toEqual([]);
    expect(pool.checksum).toBe(CSV_CHECKSUM);
  });

  it('rejects a whole pack that contributes a duplicate card id and reports the conflict', () => {
    const duplicateCsv = [
      BASE_HEADER,
      packRow({ family: 'business', id: 'biz-bakery', name: 'Duplicate Bakery', cost: '1', description: 'dup' }),
    ].join('\n');
    const pool = mergeMainStreetCardPool(CARD_DATA_RAW, [loadedPack({ csv: duplicateCsv })]);

    expect(pool.activePacks).toEqual([]);
    expect(pool.baseOnly).toBe(true);
    expect(pool.conflicts).toHaveLength(1);
    expect(pool.conflicts[0].id).toBe('biz-bakery');
    expect(pool.conflicts[0].sources).toContain('main-street-foundations');
    // The dropped pack's rows never enter the merged pool.
    expect(pool.csv).not.toContain('Duplicate Bakery');
  });

  it('respects the enabled pack-id filter', () => {
    const pool = mergeMainStreetCardPool(CARD_DATA_RAW, [loadedPack()], {
      enabledPackIds: ['some-other-pack'],
    });
    expect(pool.baseOnly).toBe(true);
    expect(pool.activePacks).toEqual([]);
  });
});

describe('applyMainStreetCardPool / template accessors', () => {
  it('applies pack cards to the live templates and exposes the merged CSV', () => {
    const pool = mergeMainStreetCardPool(CARD_DATA_RAW, [loadedPack()]);
    applyMainStreetCardPool(pool);

    expect(getBusinessTemplates().some((template) => template.id === PACK_BUSINESS_ID)).toBe(true);
    expect(getAvailableTemplateIds()).toContain(PACK_BUSINESS_ID);
    expect(getActiveCsvData()).toBe(pool.csv);
    expect(getActiveCsvChecksum()).toBe(pool.checksum);
    expect(getActiveMainStreetPacks()).toEqual([{ id: 'main-street-foundations', version: '1.0.0' }]);
  });

  it('reset restores the bundled base pool and clears the active set', () => {
    applyMainStreetCardPool(mergeMainStreetCardPool(CARD_DATA_RAW, [loadedPack()]));
    resetMainStreetCardPacks();

    expect(getBusinessTemplates().some((template) => template.id === PACK_BUSINESS_ID)).toBe(false);
    expect(getActiveCsvData()).toBe(CARD_DATA_RAW);
    expect(getActiveCsvChecksum()).toBe(CSV_CHECKSUM);
    expect(getActiveMainStreetPacks()).toEqual([]);
  });
});

describe('loadMainStreetCardPacks', () => {
  it('discovers packs through the injected loader and merges them', async () => {
    const loader = vi.fn(async () => emptyLoadResult({ packs: [loadedPack()] }));
    const result = await loadMainStreetCardPacks({ contentDir: '/content', loader });

    expect(loader).toHaveBeenCalledOnce();
    expect(loader).toHaveBeenCalledWith(expect.objectContaining({ gameId: MAIN_STREET_GAME_ID }));
    expect(result.pool.activePacks).toEqual([{ id: 'main-street-foundations', version: '1.0.0' }]);
    expect(result.warnings).toEqual([]);
  });

  it('warns about a requested pack that is missing and continues with base content', async () => {
    const loader = vi.fn(async () => emptyLoadResult());
    const result = await loadMainStreetCardPacks({
      contentDir: '/content',
      loader,
      requestedPacks: [{ id: 'vanished-pack', version: '2.0.0' }],
      logger: { warn: () => {} },
    });

    expect(result.pool.baseOnly).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('vanished-pack');
    expect(result.warnings[0]).toContain('missing');
  });

  it('warns about a requested pack that is installed but disabled/locked', async () => {
    const loader = vi.fn(async () =>
      emptyLoadResult({
        locked: [
          {
            manifest: {
              id: 'locked-pack',
              gameId: MAIN_STREET_GAME_ID,
              title: 'Locked',
              description: 'Locked pack',
              version: '1.0.0',
              coreEngineVersion: '^0.1.0',
              cards: 'cards.csv',
            },
            status: { packId: 'locked-pack', gameId: MAIN_STREET_GAME_ID, state: 'locked', steamAppId: 1, reason: 'Steam is unavailable.' },
            reason: 'Steam is unavailable.',
          },
        ],
      }),
    );
    const result = await loadMainStreetCardPacks({
      contentDir: '/content',
      loader,
      requestedPacks: [{ id: 'locked-pack', version: '1.0.0' }],
      logger: { warn: () => {} },
    });

    expect(result.pool.baseOnly).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('disabled'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('locked'))).toBe(true);
  });

  it('degrades to base content when the loader throws', async () => {
    const loader = vi.fn(async () => {
      throw new Error('boom');
    });
    const result = await loadMainStreetCardPacks({
      contentDir: '/content',
      loader,
      logger: { warn: () => {} },
    });

    expect(result.pool.baseOnly).toBe(true);
    expect(result.pool.csv).toBe(CARD_DATA_RAW);
    expect(result.warnings[0]).toContain('boom');
  });

  it('reads a real content directory through injected manifest/CSV transports', async () => {
    const manifest = JSON.stringify({
      version: 1,
      packs: [
        {
          id: 'main-street-foundations',
          gameId: MAIN_STREET_GAME_ID,
          title: 'Foundations',
          description: 'Test pack',
          version: '1.0.0',
          coreEngineVersion: '^0.1.0',
          cards: 'cards.csv',
          assets: [],
        },
      ],
    });
    const result = await loadMainStreetCardPacks({
      contentDir: 'file:///content/',
      fetchManifest: async (url) => {
        expect(url).toContain('packs/manifest.json');
        return manifest;
      },
      fetchCsv: async (url) => {
        expect(url).toContain('main-street-foundations');
        return packCsv();
      },
      client: { listStatus: async () => [] } as never,
      logger: { warn: () => {} },
    });

    expect(result.pool.activePacks).toEqual([{ id: 'main-street-foundations', version: '1.0.0' }]);
    expect(result.pool.csv).toContain(PACK_BUSINESS_ID);
  });
});

describe('missing-pack degradation (live instances)', () => {
  it('collects live card ids from card-bearing state', () => {
    const state = setupMainStreetGame({ seed: 'collect-live' });
    const ids = collectLiveCardIds(state);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => typeof id === 'string')).toBe(true);
  });

  it('flags a live instance whose template is unavailable and refuses only then', () => {
    const baseTemplateIds = getAvailableTemplateIds();
    const state = { hand: [{ id: PACK_BUSINESS_ID, family: 'business' }] } as unknown as MainStreetState;

    expect(findMissingLiveTemplateIds(state, baseTemplateIds)).toEqual([PACK_BUSINESS_ID]);
    expect(() => assertLiveTemplatesResolvable(state, baseTemplateIds)).toThrow(MissingCardPackTemplateError);

    // With the pack pool applied, the live instance resolves.
    applyMainStreetCardPool(mergeMainStreetCardPool(CARD_DATA_RAW, [loadedPack()]));
    expect(findMissingLiveTemplateIds(state)).toEqual([]);
    expect(() => assertLiveTemplatesResolvable(state)).not.toThrow();
  });
});

describe('save/load round-trip', () => {
  it('persists the merged pool + active packs and restores the same pool', () => {
    applyMainStreetCardPool(mergeMainStreetCardPool(CARD_DATA_RAW, [loadedPack()]));
    // A fresh game must deal from the active pack pool.
    const state = setupMainStreetGame({ seed: 'pack-save-load' });
    expect(getBusinessTemplates().some((template) => template.id === PACK_BUSINESS_ID)).toBe(true);

    const serialized = serializeMainStreetState(state);
    expect(serialized.activePacks).toEqual([{ id: 'main-street-foundations', version: '1.0.0' }]);
    expect(serialized.csvChecksum).not.toBe(CSV_CHECKSUM);
    expect(serialized.csvData).toContain(PACK_BUSINESS_ID);

    // Simulate a fresh process: drop the active pool, then load the save.
    resetMainStreetCardPacks();
    expect(getBusinessTemplates().some((template) => template.id === PACK_BUSINESS_ID)).toBe(false);

    const restored = deserializeMainStreetState(structuredClone(serialized));
    expect(restored).toBeDefined();
    expect(getBusinessTemplates().some((template) => template.id === PACK_BUSINESS_ID)).toBe(true);
    expect(getActiveCsvChecksum()).toBe(serialized.csvChecksum);
    expect(getActiveMainStreetPacks()).toEqual([{ id: 'main-street-foundations', version: '1.0.0' }]);
  });

  it('backfills an empty active-pack set for legacy saves', () => {
    const state = setupMainStreetGame({ seed: 'legacy-pack-migration' });
    const serialized = serializeMainStreetState(state);
    // Simulate a legacy save created before the card-pack feature.
    const legacy = structuredClone(serialized) as unknown as Record<string, unknown>;
    delete legacy.activePacks;

    resetTemplatesToDefault();
    const restored = deserializeMainStreetState(legacy as never);
    expect(restored).toBeDefined();
    expect(getActiveMainStreetPacks()).toEqual([]);
  });

  it('does not leak a previously-applied pack pool into a base-only save', () => {
    // Base-only save produced without any pack active.
    resetMainStreetCardPacks();
    const baseState = setupMainStreetGame({ seed: 'base-only-save' });
    const baseSerialized = serializeMainStreetState(baseState);

    // A pack pool is now active in this process...
    applyMainStreetCardPool(mergeMainStreetCardPool(CARD_DATA_RAW, [loadedPack()]));
    expect(getBusinessTemplates().some((template) => template.id === PACK_BUSINESS_ID)).toBe(true);

    // ...loading the base-only save must restore base content, not the pack.
    deserializeMainStreetState(structuredClone(baseSerialized));
    expect(getBusinessTemplates().some((template) => template.id === PACK_BUSINESS_ID)).toBe(false);
    expect(getActiveMainStreetPacks()).toEqual([]);
  });
});

describe('setActiveMainStreetPacks', () => {
  it('filters malformed entries and defensively copies', () => {
    setActiveMainStreetPacks([
      { id: 'ok', version: '1.0.0' },
      { id: '', version: '1.0.0' } as never,
      { id: 'no-version' } as never,
    ]);
    expect(getActiveMainStreetPacks()).toEqual([{ id: 'ok', version: '1.0.0' }, { id: 'no-version', version: '' }]);
  });
});
