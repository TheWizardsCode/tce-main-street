/**
 * Main Street simulated card-pack purchase helper (unit).
 *
 * Child of the Main Street DLC work item `MS-0MV0M5BHH0020WFY`. Verifies that
 * {@link purchaseMainStreetCardPack} performs the scoped simulated purchase
 * through the content-unlock client, re-discovers the packs with the same
 * transports, and applies the newly unlocked pack's rows — all while leaving
 * non-gated packs and plain-browser (bridge-less) environments untouched.
 *
 * @see src/MainStreetCardPacks.ts (purchaseMainStreetCardPack)
 * @see src/MainStreetContentUnlockGate.ts
 */

import { afterEach, describe, expect, it } from 'vitest';

import { CARD_DATA_RAW } from '../../src/MainStreetCards';
import {
  applyEnabledMainStreetPacks,
  bootstrapMainStreetCardPacks,
  getAvailableTemplateIds,
  getMainStreetPurchasablePackIds,
  purchaseMainStreetCardPack,
  resetMainStreetCardPacks,
} from '../../src/MainStreetCardPacks';
import { createBrowserContentUnlockClient } from '../../src/MainStreetBrowserContentUnlockClient';
import {
  getEnabledCardPackIds,
  setEnabledCardPackIds,
  type StorageLike,
} from '../../src/MainStreetPrefs';
import type { CardPackStatusRef, PackEntitlementStatusLike } from '@ui/card-pack-client';
import type { ContentUnlockClient } from '@ui/content-unlock-client';

const PACK_ID = 'main-street-residential-pack';
const PACK_CARD_ID = 'biz-ms-residential-property-mgmt';
const DLC_KEY = `dlc:main-street:${PACK_ID}`;
const PURCHASE_RULE_ID = 'main-street-residential-pack-purchase';

const BASE_HEADER = CARD_DATA_RAW.split('\n')[0];
const BASE_COLUMNS = BASE_HEADER.split(',');

/** A one-row residential pack CSV fragment matching the base header exactly. */
function residentialPackCsv(): string {
  const row = BASE_COLUMNS.map((column) => {
    switch (column) {
      case 'family':
        return 'business';
      case 'id':
        return PACK_CARD_ID;
      case 'name':
        return 'Neighbourhood Property Group';
      case 'cost':
        return '500';
      case 'baseIncome':
        return '120';
      case 'synergyTypes':
        return 'Commerce';
      case 'upgradePath':
        return 'Neighbourhood Property Group';
      case 'maxLevel':
        return '3';
      case 'reputationPerTurn':
        return '30';
      case 'description':
        return 'A residential property business.';
      case 'tier':
        return '2';
      default:
        return '';
    }
  }).join(',');
  return [BASE_HEADER, row].join('\n');
}

const MANIFEST = JSON.stringify({
  version: 1,
  packs: [
    {
      id: PACK_ID,
      gameId: 'main-street',
      title: 'Main Street Residential',
      description: 'Residential pack',
      version: '1.0.0',
      coreEngineVersion: '^0.1.0',
      cards: 'cards.csv',
    },
  ],
});

const silentLogger = { warn: (): void => {} };

/** A Steam-DLC client that reports the residential pack free (no Steam gate). */
const freeSteamClient = {
  listStatus: async (refs: readonly CardPackStatusRef[]): Promise<PackEntitlementStatusLike[]> =>
    refs.map((ref) => ({
      packId: ref.id,
      gameId: ref.gameId ?? null,
      state: 'free' as const,
      steamAppId: null,
      reason: null,
    })),
} as never;

/**
 * A mutable content-unlock client whose `refresh` performs the scoped simulated
 * purchase (and records the options it was called with).
 */
function mutableContentUnlocks(): {
  client: ContentUnlockClient;
  refreshCalls: { ruleIds?: string[]; simulatePurchase?: boolean }[];
} {
  const unlocked = new Set<string>();
  const refreshCalls: { ruleIds?: string[]; simulatePurchase?: boolean }[] = [];
  return {
    refreshCalls,
    client: {
      async isUnlocked(target) {
        if (target.kind !== 'dlc') return false;
        return unlocked.has(`dlc:${target.gameId}:${target.dlcId}`);
      },
      async getUnlocks() {
        return [];
      },
      async refresh(options) {
        refreshCalls.push({
          ruleIds: options?.ruleIds,
          simulatePurchase: options?.simulatePurchase,
        });
        if (
          options?.simulatePurchase === true &&
          options.ruleIds?.includes(PURCHASE_RULE_ID)
        ) {
          unlocked.add(DLC_KEY);
          return [{ ruleId: PURCHASE_RULE_ID, key: DLC_KEY, outcome: 'unlocked' }];
        }
        return [];
      },
    },
  };
}

/** Boot discovery with the injected transports and content-unlock client. */
function boot(contentUnlocks: ContentUnlockClient) {
  return bootstrapMainStreetCardPacks({
    contentDir: 'file:///content/',
    fetchManifest: async () => MANIFEST,
    fetchCsv: async () => residentialPackCsv(),
    client: freeSteamClient,
    contentUnlocks,
    storage: null,
    logger: silentLogger,
  });
}

afterEach(() => {
  resetMainStreetCardPacks();
});

/** An in-memory {@link StorageLike} modelling a browser `localStorage`. */
interface MockStorage extends StorageLike {
  readonly map: Map<string, string>;
}

function createMockStorage(): MockStorage {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

/** The itch.io golf reward target a browser purchase must never touch. */
const ITCH_GOLF_TARGET = {
  kind: 'dlc' as const,
  gameId: 'itch-io',
  dlcId: 'golf-reward',
};

/** The residential pack's unlock target. */
const RESIDENTIAL_TARGET = {
  kind: 'dlc' as const,
  gameId: 'main-street',
  dlcId: PACK_ID,
};

describe('purchaseMainStreetCardPack', () => {
  it('scopes the purchase to the pack rule, re-discovers and applies the pack', async () => {
    const { client, refreshCalls } = mutableContentUnlocks();

    const before = await boot(client);
    expect(before?.locked.map((pack) => pack.manifest.id)).toContain(PACK_ID);
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);

    const outcome = await purchaseMainStreetCardPack(PACK_ID, { contentUnlocks: client });

    // The scoped, explicit simulated-purchase signal reached the client.
    expect(refreshCalls).toEqual([
      { ruleIds: [PURCHASE_RULE_ID], simulatePurchase: true },
    ]);
    expect(outcome.purchased).toBe(true);
    expect(outcome.load?.loaded.map((pack) => pack.manifest.id)).toContain(PACK_ID);
    // The pool now contains the pack's card.
    expect(getAvailableTemplateIds()).toContain(PACK_CARD_ID);
  });

  it('refuses a pack that is not content-unlock gated', async () => {
    const { client, refreshCalls } = mutableContentUnlocks();

    const outcome = await purchaseMainStreetCardPack('some-other-pack', {
      contentUnlocks: client,
    });

    expect(outcome.purchased).toBe(false);
    expect(outcome.reason).toMatch(/not available for purchase/i);
    // No refresh was attempted for an undeclared pack.
    expect(refreshCalls).toEqual([]);
  });

  it('degrades safely when the content-unlock bridge cannot refresh', async () => {
    const noopClient: ContentUnlockClient = {
      async isUnlocked() {
        return false;
      },
      async getUnlocks() {
        return [];
      },
      async refresh() {
        return [];
      },
    };

    const outcome = await purchaseMainStreetCardPack(PACK_ID, {
      contentUnlocks: noopClient,
    });

    expect(outcome.purchased).toBe(false);
    expect(outcome.reason).toMatch(/could not|did not unlock/i);
  });
});

/**
 * End-to-end browser-source path: the **real** `localStorage` client (not a
 * test double) drives the listing's scoped purchase and re-discovery, then the
 * explicit enable step merges the pack's rows so its card deals. Covers the
 * work-item ACs lock → purchase → enable → deal, persistence across a reload,
 * and no collateral unlock of another configured reward.
 */
describe('purchaseMainStreetCardPack with the browser localStorage client', () => {
  it('lists the pack as purchasable and gates it out of play while locked', async () => {
    const storage = createMockStorage();
    const client = createBrowserContentUnlockClient({ storage });

    // No pack enabled: the listing starts from a locked, unmerged pack.
    setEnabledCardPackIds([], storage);
    const load = await bootstrapMainStreetCardPacks({
      contentDir: 'file:///content/',
      fetchManifest: async () => MANIFEST,
      fetchCsv: async () => residentialPackCsv(),
      client: freeSteamClient,
      contentUnlocks: client,
      storage,
      logger: silentLogger,
    });

    expect(getMainStreetPurchasablePackIds()).toContain(PACK_ID);
    expect(load?.locked.map((pack) => pack.manifest.id)).toContain(PACK_ID);
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);
  });

  it('purchases, enables and deals through the real browser client, persisting across a reload', async () => {
    const storage = createMockStorage();
    setEnabledCardPackIds([], storage);

    const bootOptions = {
      contentDir: 'file:///content/',
      fetchManifest: async (): Promise<string> => MANIFEST,
      fetchCsv: async (): Promise<string> => residentialPackCsv(),
      client: freeSteamClient,
      storage,
      logger: silentLogger,
    };

    // Boot locked with the real localStorage-backed browser client.
    const before = await bootstrapMainStreetCardPacks({
      ...bootOptions,
      contentUnlocks: createBrowserContentUnlockClient({ storage }),
    });
    expect(before?.locked.map((pack) => pack.manifest.id)).toContain(PACK_ID);
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);

    // Purchase through a fresh client over the same storage: the scoped
    // simulated purchase persists the unlock and re-discovers the pool.
    const outcome = await purchaseMainStreetCardPack(PACK_ID, {
      contentUnlocks: createBrowserContentUnlockClient({ storage }),
    });
    expect(outcome.purchased).toBe(true);
    const load = outcome.load!;
    expect(load.loaded.map((pack) => pack.manifest.id)).toContain(PACK_ID);
    // Still not enabled: the enabled-pack preference was explicitly emptied.
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);

    // Enable it: its rows merge into the live pool so its card deals.
    const enabled = applyEnabledMainStreetPacks(load, [PACK_ID], { storage });
    expect(enabled.applied).toBe(true);
    expect(getAvailableTemplateIds()).toContain(PACK_CARD_ID);

    // A reload (fresh client over the same storage) keeps both the unlock and
    // the enabled-pack preference.
    const reloaded = createBrowserContentUnlockClient({ storage });
    await expect(reloaded.isUnlocked(RESIDENTIAL_TARGET)).resolves.toBe(true);
    expect(getEnabledCardPackIds(storage)).toEqual([PACK_ID]);
  });

  it('is rule-scoped: no collateral unlock and no unlock without simulatePurchase', async () => {
    const storage = createMockStorage();
    const client = createBrowserContentUnlockClient({ storage });

    // A global self-attested refresh never unlocks.
    await expect(client.refresh({ attested: true })).resolves.toEqual([]);
    expect(await client.isUnlocked(RESIDENTIAL_TARGET)).toBe(false);

    // A different reward rule (itch.io golf) is neither evaluated nor unlocked.
    await expect(
      client.refresh({ ruleIds: ['itch-io-golf-reward'], simulatePurchase: true }),
    ).resolves.toEqual([]);
    expect(await client.isUnlocked(ITCH_GOLF_TARGET)).toBe(false);

    // Only the requested residential rule unlocks, and only its target.
    await expect(
      client.refresh({
        ruleIds: [PURCHASE_RULE_ID],
        simulatePurchase: true,
      }),
    ).resolves.toEqual([
      { ruleId: PURCHASE_RULE_ID, key: DLC_KEY, outcome: 'unlocked' },
    ]);
    expect(await client.isUnlocked(RESIDENTIAL_TARGET)).toBe(true);
    expect(await client.isUnlocked(ITCH_GOLF_TARGET)).toBe(false);
  });
});
