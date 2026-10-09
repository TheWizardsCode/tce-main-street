/**
 * Main Street content-unlock pack entitlement gate (unit).
 *
 * Child of the Main Street DLC work item `MS-0MV0M5BHH0020WFY`. Verifies the
 * composed entitlement resolver that adds the launcher's unified content-unlock
 * store on top of the Steam-DLC status:
 *
 *   - a declared gated pack is locked with no `dlc:<gameId>:<packId>` unlock
 *     and unlocked once the unlock exists;
 *   - only declared packs are affected (data-driven gating);
 *   - the composition is total (missing/throwing/malformed bridges degrade);
 *   - `loadMainStreetCardPacks` keeps a locked pack's rows out of the pool and
 *     merges them once unlocked.
 *
 * @see src/MainStreetContentUnlockGate.ts
 * @see src/MainStreetCardPacks.ts
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  CONTENT_UNLOCK_LOCK_REASON,
  MAIN_STREET_CONTENT_UNLOCK_GATED_PACKS,
  composeContentUnlockEntitlement,
  contentUnlockKeyFor,
  findContentUnlockGatedPack,
  isContentUnlockGatedPack,
} from '../../src/MainStreetContentUnlockGate';
import {
  MAIN_STREET_GAME_ID,
  loadMainStreetCardPacks,
  resetMainStreetCardPacks,
} from '../../src/MainStreetCardPacks';
import { CARD_DATA_RAW } from '../../src/MainStreetCards';
import type { CardPackStatusRef, PackEntitlementStatusLike } from '@ui/card-pack-client';
import type { ContentUnlockClient } from '@ui/content-unlock-client';
import type { CardPackEntitlementResolver } from '@ui/CardPackLoader';

const PACK_ID = 'main-street-residential-pack';
const PACK_CARD_ID = 'biz-ms-residential-property-mgmt';
const DLC_KEY = `dlc:${MAIN_STREET_GAME_ID}:${PACK_ID}`;

const BASE_HEADER = CARD_DATA_RAW.split('\n')[0];
const BASE_COLUMNS = BASE_HEADER.split(',');

/** A one-row pack CSV fragment matching the base header exactly. */
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

/** A total content-unlock client backed by a set of unlocked target keys. */
function fakeContentUnlocks(unlockedKeys: readonly string[] = []): {
  client: ContentUnlockClient;
  calls: { kind: string; gameId?: string; dlcId?: string }[];
} {
  const keys = new Set(unlockedKeys);
  const calls: { kind: string; gameId?: string; dlcId?: string }[] = [];
  return {
    calls,
    client: {
      async isUnlocked(target): Promise<boolean> {
        calls.push({ ...target });
        if (target.kind !== 'dlc') return false;
        return keys.has(`dlc:${target.gameId}:${target.dlcId}`);
      },
      async getUnlocks() {
        return [];
      },
      async refresh() {
        return [];
      },
    },
  };
}

/** A Steam resolver returning one status per ref. */
function steamResolver(
  statuses: Record<string, PackEntitlementStatusLike>,
): CardPackEntitlementResolver {
  return async (refs) =>
    refs.map(
      (ref) =>
        statuses[ref.id] ?? {
          packId: ref.id,
          gameId: ref.gameId ?? null,
          state: 'free',
          steamAppId: null,
          reason: null,
        },
    );
}

const residentialRef: CardPackStatusRef = {
  id: PACK_ID,
  gameId: MAIN_STREET_GAME_ID,
  steamAppId: null,
};

/** A Steam resolver that reports the residential pack free (no Steam gate). */
const freeSteam = steamResolver({
  [PACK_ID]: {
    packId: PACK_ID,
    gameId: MAIN_STREET_GAME_ID,
    state: 'free',
    steamAppId: null,
    reason: null,
  },
});

afterEach(() => {
  resetMainStreetCardPacks();
});

describe('content-unlock gating declaration', () => {
  it('declares the residential pack and derives its unlock key', () => {
    const declaration = findContentUnlockGatedPack(MAIN_STREET_GAME_ID, PACK_ID);
    expect(declaration).not.toBeNull();
    expect(declaration?.dlcId ?? PACK_ID).toBe(PACK_ID);
    expect(contentUnlockKeyFor(declaration!)).toBe(DLC_KEY);
    expect(isContentUnlockGatedPack(MAIN_STREET_GAME_ID, PACK_ID)).toBe(true);
  });

  it('does not gate an undeclared pack or a different game', () => {
    expect(isContentUnlockGatedPack(MAIN_STREET_GAME_ID, 'main-street-foundations')).toBe(
      false,
    );
    expect(isContentUnlockGatedPack('other-game', PACK_ID)).toBe(false);
    expect(MAIN_STREET_CONTENT_UNLOCK_GATED_PACKS).toHaveLength(1);
  });
});

describe('composeContentUnlockEntitlement', () => {
  it('locks a declared pack with no content unlock and reports an actionable reason', async () => {
    const { client, calls } = fakeContentUnlocks();
    const resolve = composeContentUnlockEntitlement({ steam: freeSteam, contentUnlocks: client });

    const [status] = await resolve([residentialRef]);

    expect(status.state).toBe('locked');
    expect(status.reason).toBe(CONTENT_UNLOCK_LOCK_REASON);
    // The exact unified-store target key was queried.
    expect(calls).toEqual([
      { kind: 'dlc', gameId: MAIN_STREET_GAME_ID, dlcId: PACK_ID },
    ]);
  });

  it('unlocks a declared pack once the dlc:<gameId>:<packId> unlock exists', async () => {
    const { client } = fakeContentUnlocks([DLC_KEY]);
    const resolve = composeContentUnlockEntitlement({ steam: freeSteam, contentUnlocks: client });

    const [status] = await resolve([residentialRef]);

    expect(status.state).toBe('unlocked');
    expect(status.reason).toBeNull();
  });

  it('leaves an undeclared pack exactly as the Steam resolver reported it', async () => {
    const otherRef: CardPackStatusRef = {
      id: 'main-street-foundations',
      gameId: MAIN_STREET_GAME_ID,
      steamAppId: null,
    };
    const steam = steamResolver({
      'main-street-foundations': {
        packId: 'main-street-foundations',
        gameId: MAIN_STREET_GAME_ID,
        state: 'free',
        steamAppId: null,
        reason: null,
      },
    });
    const { client, calls } = fakeContentUnlocks([DLC_KEY]);
    const resolve = composeContentUnlockEntitlement({ steam, contentUnlocks: client });

    const statuses = await resolve([otherRef]);

    expect(statuses[0].state).toBe('free');
    // The undeclared pack was never queried against the content-unlock store.
    expect(calls).toEqual([]);
  });

  it('never demotes a pack Steam already reports unlocked', async () => {
    const steam = steamResolver({
      [PACK_ID]: {
        packId: PACK_ID,
        gameId: MAIN_STREET_GAME_ID,
        state: 'unlocked',
        steamAppId: 480,
        reason: null,
      },
    });
    const { client, calls } = fakeContentUnlocks();
    const resolve = composeContentUnlockEntitlement({ steam, contentUnlocks: client });

    const [status] = await resolve([residentialRef]);

    expect(status.state).toBe('unlocked');
    expect(calls).toEqual([]);
  });

  it('stays locked when the content-unlock client is missing or malformed', async () => {
    for (const contentUnlocks of [null, undefined, {} as ContentUnlockClient]) {
      const resolve = composeContentUnlockEntitlement({
        steam: freeSteam,
        contentUnlocks,
      });
      const [status] = await resolve([residentialRef]);
      expect(status.state).toBe('locked');
      expect(status.reason).toBe(CONTENT_UNLOCK_LOCK_REASON);
    }
  });

  it('degrades to the Steam status when the content-unlock reader throws', async () => {
    const throwing: ContentUnlockClient = {
      async isUnlocked() {
        throw new Error('bridge boom');
      },
      async getUnlocks() {
        return [];
      },
      async refresh() {
        return [];
      },
    };
    const resolve = composeContentUnlockEntitlement({
      steam: freeSteam,
      contentUnlocks: throwing,
    });

    const [status] = await resolve([residentialRef]);

    // The throwing bridge is caught by the gate → not unlocked → locked.
    expect(status.state).toBe('locked');
  });

  it('degrades to locked statuses when the Steam resolver throws', async () => {
    const throwingSteam: CardPackEntitlementResolver = async () => {
      throw new Error('steam boom');
    };
    const { client } = fakeContentUnlocks([DLC_KEY]);
    const resolve = composeContentUnlockEntitlement({
      steam: throwingSteam,
      contentUnlocks: client,
    });

    const [status] = await resolve([residentialRef]);

    // A content unlock still entitles the pack even when Steam is unavailable.
    expect(status.state).toBe('unlocked');
  });
});

describe('loadMainStreetCardPacks — content-unlock gate end to end', () => {
  const manifest = JSON.stringify({
    version: 1,
    packs: [
      {
        id: PACK_ID,
        gameId: MAIN_STREET_GAME_ID,
        title: 'Main Street Residential',
        description: 'Residential pack',
        version: '1.0.0',
        coreEngineVersion: '^0.1.0',
        cards: 'cards.csv',
      },
    ],
  });

  function load(contentUnlocks: ContentUnlockClient | null) {
    return loadMainStreetCardPacks({
      contentDir: 'file:///content/',
      fetchManifest: async () => manifest,
      fetchCsv: async () => residentialPackCsv(),
      client: { listStatus: freeSteam } as never,
      contentUnlocks,
      logger: { warn: () => {} },
    });
  }

  it('keeps a locked pack out of the merged pool and warns', async () => {
    const { client } = fakeContentUnlocks();
    const result = await load(client);

    expect(result.pool.baseOnly).toBe(true);
    expect(result.pool.csv).toBe(CARD_DATA_RAW);
    expect(result.pool.csv).not.toContain(PACK_CARD_ID);
    expect(result.locked.map((item) => item.manifest.id)).toEqual([PACK_ID]);
    expect(result.locked[0].reason).toBe(CONTENT_UNLOCK_LOCK_REASON);
    expect(result.warnings.some((w) => w.includes('locked'))).toBe(true);
  });

  it('merges a pack once its content unlock exists', async () => {
    const { client } = fakeContentUnlocks([DLC_KEY]);
    const result = await load(client);

    expect(result.locked).toEqual([]);
    expect(result.pool.baseOnly).toBe(false);
    expect(result.pool.csv).toContain(PACK_CARD_ID);
    expect(result.pool.activePacks).toEqual([{ id: PACK_ID, version: '1.0.0' }]);
  });
});
