/**
 * Main Street browser `localStorage` content-unlock client (unit).
 *
 * Child of `MS-0MV1O7EGG004MWGD` (Make card packs available in the browser
 * distribution). Verifies the total, `localStorage`-backed
 * {@link ContentUnlockClient} that gives a bridge-less browser the full
 * lock → purchase → enable flow:
 *
 *   - persistence and reload through the `StorageLike` seam;
 *   - coexistence with the enabled-pack preference (distinct keys);
 *   - explicit Electron-bridge precedence;
 *   - total degradation on missing/throwing/malformed storage;
 *   - rule-scoped `refresh({ ruleIds, simulatePurchase })` that persists only
 *     the requested target and never collateral-unlocks.
 *
 * @see src/MainStreetBrowserContentUnlockClient.ts
 * @see src/MainStreetPrefs.ts
 * @see @ui/content-unlock-client — the core interface and total contract.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  BROWSER_CONTENT_UNLOCKS_KEY,
  MAIN_STREET_BROWSER_CONTENT_UNLOCK_RULES,
  contentUnlockTargetKey,
  createBrowserContentUnlockClient,
  resolveMainStreetContentUnlockClient,
} from '../../src/MainStreetBrowserContentUnlockClient';
import {
  ENABLED_CARD_PACKS_KEY,
  getEnabledCardPackIds,
  setEnabledCardPackIds,
  type StorageLike,
} from '../../src/MainStreetPrefs';
import type {
  ContentUnlockBridge,
  UnlockTargetLike,
} from '@ui/content-unlock-client';

const PACK_ID = 'main-street-residential-pack';
const PURCHASE_RULE_ID = 'main-street-residential-pack-purchase';
const PACK_KEY = `dlc:main-street:${PACK_ID}`;
const PACK_TARGET: UnlockTargetLike = {
  kind: 'dlc',
  gameId: 'main-street',
  dlcId: PACK_ID,
};

/** An in-memory {@link StorageLike} whose contents are inspectable. */
interface MockStorage extends StorageLike {
  readonly map: Map<string, string>;
}

function createMockStorage(initial: Record<string, string> = {}): MockStorage {
  const map = new Map<string, string>(Object.entries(initial));
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

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('MainStreetBrowserContentUnlockClient — persistence', () => {
  it('exposes the residential pack purchase rule for scoped simulated purchase', () => {
    expect(MAIN_STREET_BROWSER_CONTENT_UNLOCK_RULES).toContainEqual({
      ruleId: PURCHASE_RULE_ID,
      target: PACK_TARGET,
    });
  });

  it('persists a scoped simulated purchase and reports it unlocked', async () => {
    const storage = createMockStorage();
    const client = createBrowserContentUnlockClient({
      storage,
      now: () => new Date('2026-01-02T03:04:05.000Z'),
    });

    const results = await client.refresh({
      ruleIds: [PURCHASE_RULE_ID],
      simulatePurchase: true,
    });

    expect(results).toEqual([
      { ruleId: PURCHASE_RULE_ID, key: PACK_KEY, outcome: 'unlocked' },
    ]);
    expect(await client.isUnlocked(PACK_TARGET)).toBe(true);

    const records = await client.getUnlocks();
    expect(records).toEqual([
      {
        key: PACK_KEY,
        target: PACK_TARGET,
        unlockedAt: '2026-01-02T03:04:05.000Z',
      },
    ]);
    expect(storage.map.has(BROWSER_CONTENT_UNLOCKS_KEY)).toBe(true);
  });

  it('survives a reload through the same storage', async () => {
    const storage = createMockStorage();
    const first = createBrowserContentUnlockClient({ storage });
    await first.refresh({ ruleIds: [PURCHASE_RULE_ID], simulatePurchase: true });

    // A new client instance models a fresh page load over the same storage.
    const reloaded = createBrowserContentUnlockClient({ storage });
    expect(await reloaded.isUnlocked(PACK_TARGET)).toBe(true);
    expect((await reloaded.getUnlocks()).map((record) => record.key)).toEqual([
      PACK_KEY,
    ]);
  });

  it('keeps the enabled-pack preference and unlock state in separate keys', async () => {
    const storage = createMockStorage();
    setEnabledCardPackIds([PACK_ID], storage);

    const client = createBrowserContentUnlockClient({ storage });
    await client.refresh({ ruleIds: [PURCHASE_RULE_ID], simulatePurchase: true });

    expect(getEnabledCardPackIds(storage)).toEqual([PACK_ID]);
    expect(await client.isUnlocked(PACK_TARGET)).toBe(true);
    expect([...storage.map.keys()].sort()).toEqual(
      [BROWSER_CONTENT_UNLOCKS_KEY, ENABLED_CARD_PACKS_KEY].sort(),
    );
  });
});

describe('MainStreetBrowserContentUnlockClient — degradation', () => {
  it('degrades to a no-op when storage is unavailable', async () => {
    const client = createBrowserContentUnlockClient({ storage: null });

    await expect(client.isUnlocked(PACK_TARGET)).resolves.toBe(false);
    await expect(client.getUnlocks()).resolves.toEqual([]);
    await expect(
      client.refresh({ ruleIds: [PURCHASE_RULE_ID], simulatePurchase: true }),
    ).resolves.toEqual([]);
  });

  it('never throws and degrades totally when storage throws', async () => {
    const throwing: StorageLike = {
      getItem() {
        throw new Error('boom');
      },
      setItem() {
        throw new Error('boom');
      },
    };
    const client = createBrowserContentUnlockClient({ storage: throwing });

    await expect(client.isUnlocked(PACK_TARGET)).resolves.toBe(false);
    await expect(client.getUnlocks()).resolves.toEqual([]);
    await expect(
      client.refresh({ ruleIds: [PURCHASE_RULE_ID], simulatePurchase: true }),
    ).resolves.toEqual([]);
  });

  it('degrades malformed, non-array storage to no unlocks', async () => {
    for (const raw of ['{not json', '"a string"', '{"not":"an array"}', '42']) {
      const storage = createMockStorage({ [BROWSER_CONTENT_UNLOCKS_KEY]: raw });
      const client = createBrowserContentUnlockClient({ storage });

      await expect(client.getUnlocks()).resolves.toEqual([]);
      await expect(client.isUnlocked(PACK_TARGET)).resolves.toBe(false);
    }
  });

  it('drops malformed records while keeping valid ones', async () => {
    const valid = {
      key: PACK_KEY,
      target: PACK_TARGET,
      unlockedAt: '2026-01-01T00:00:00.000Z',
    };
    const storage = createMockStorage({
      [BROWSER_CONTENT_UNLOCKS_KEY]: JSON.stringify([
        valid,
        { junk: true },
        42,
        null,
        { key: '', target: PACK_TARGET, unlockedAt: 'x' },
      ]),
    });
    const client = createBrowserContentUnlockClient({ storage });

    await expect(client.getUnlocks()).resolves.toEqual([valid]);
    await expect(client.isUnlocked(PACK_TARGET)).resolves.toBe(true);
  });

  it('reports false for a malformed unlock target', async () => {
    const storage = createMockStorage();
    const client = createBrowserContentUnlockClient({ storage });
    await client.refresh({ ruleIds: [PURCHASE_RULE_ID], simulatePurchase: true });

    const malformed = { kind: 'dlc', gameId: 'main-street' } as UnlockTargetLike;
    await expect(client.isUnlocked(malformed)).resolves.toBe(false);
  });

  it('is a pure key derivation for game and DLC targets', () => {
    expect(contentUnlockTargetKey({ kind: 'game', gameId: 'g' })).toBe('game:g');
    expect(contentUnlockTargetKey(PACK_TARGET)).toBe(PACK_KEY);
  });
});

describe('MainStreetBrowserContentUnlockClient — refresh scope', () => {
  const RULE_A = {
    ruleId: 'rule-a',
    target: { kind: 'dlc', gameId: 'g', dlcId: 'a' },
  } as const;
  const RULE_B = {
    ruleId: 'rule-b',
    target: { kind: 'dlc', gameId: 'g', dlcId: 'b' },
  } as const;

  it('persists only the requested rule target', async () => {
    const storage = createMockStorage();
    const client = createBrowserContentUnlockClient({
      storage,
      rules: [RULE_A, RULE_B],
    });

    const results = await client.refresh({
      ruleIds: ['rule-a'],
      simulatePurchase: true,
    });

    expect(results).toEqual([
      { ruleId: 'rule-a', key: 'dlc:g:a', outcome: 'unlocked' },
    ]);
    expect(await client.isUnlocked(RULE_A.target)).toBe(true);
    expect(await client.isUnlocked(RULE_B.target)).toBe(false);
  });

  it('never unlocks without an explicit simulatePurchase signal', async () => {
    const storage = createMockStorage();
    const client = createBrowserContentUnlockClient({ storage });

    await expect(
      client.refresh({ ruleIds: [PURCHASE_RULE_ID] }),
    ).resolves.toEqual([]);
    await expect(client.refresh({ attested: true })).resolves.toEqual([]);
    await expect(client.refresh()).resolves.toEqual([]);
    expect(await client.isUnlocked(PACK_TARGET)).toBe(false);
  });

  it('never collateral-unlocks an unknown rule', async () => {
    const storage = createMockStorage();
    const client = createBrowserContentUnlockClient({ storage });

    await expect(
      client.refresh({ ruleIds: ['itch-io-golf-reward'], simulatePurchase: true }),
    ).resolves.toEqual([]);
    expect(await client.isUnlocked(PACK_TARGET)).toBe(false);
  });

  it('reports already-unlocked on a repeat scoped purchase', async () => {
    const storage = createMockStorage();
    const client = createBrowserContentUnlockClient({ storage });

    await client.refresh({ ruleIds: [PURCHASE_RULE_ID], simulatePurchase: true });
    const repeat = await client.refresh({
      ruleIds: [PURCHASE_RULE_ID],
      simulatePurchase: true,
    });

    expect(repeat).toEqual([
      { ruleId: PURCHASE_RULE_ID, key: PACK_KEY, outcome: 'already-unlocked' },
    ]);
    expect(await client.getUnlocks()).toHaveLength(1);
  });
});

describe('MainStreetBrowserContentUnlockClient — precedence', () => {
  it('falls back to the localStorage client when no bridge is present', async () => {
    const storage = createMockStorage();
    const client = resolveMainStreetContentUnlockClient({ storage });

    expect(await client.isUnlocked(PACK_TARGET)).toBe(false);
    const results = await client.refresh({
      ruleIds: [PURCHASE_RULE_ID],
      simulatePurchase: true,
    });
    expect(results.map((result) => result.outcome)).toEqual(['unlocked']);
    expect(storage.map.has(BROWSER_CONTENT_UNLOCKS_KEY)).toBe(true);
  });

  it('keeps the Electron bridge precedence even over a conflicting local unlock', async () => {
    const storage = createMockStorage();
    const browserClient = createBrowserContentUnlockClient({ storage });
    await browserClient.refresh({
      ruleIds: [PURCHASE_RULE_ID],
      simulatePurchase: true,
    });
    // The local store says unlocked...
    expect(await browserClient.isUnlocked(PACK_TARGET)).toBe(true);

    let bridgeCalls = 0;
    const bridge: ContentUnlockBridge = {
      async isUnlocked() {
        bridgeCalls += 1;
        return false;
      },
      async getUnlocks() {
        return [];
      },
    };
    (globalThis as { window?: unknown }).window = {
      tce: { contentUnlocks: bridge },
    };

    // ...but the bridge is present, so it wins and reports "not unlocked".
    const resolved = resolveMainStreetContentUnlockClient({ storage });
    await expect(resolved.isUnlocked(PACK_TARGET)).resolves.toBe(false);
    await expect(resolved.getUnlocks()).resolves.toEqual([]);
    expect(bridgeCalls).toBe(1);
  });

  it('ignores a malformed window bridge and uses the localStorage client', async () => {
    (globalThis as { window?: unknown }).window = {
      tce: { contentUnlocks: { isUnlocked: true } },
    };
    const storage = createMockStorage();
    const client = resolveMainStreetContentUnlockClient({ storage });

    await client.refresh({ ruleIds: [PURCHASE_RULE_ID], simulatePurchase: true });
    expect(storage.map.has(BROWSER_CONTENT_UNLOCKS_KEY)).toBe(true);
  });
});
