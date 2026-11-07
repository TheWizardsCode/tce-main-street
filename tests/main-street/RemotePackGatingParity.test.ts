/**
 * Remote pack gating & behaviour parity (`MS-0MVSFWFKR005WY43`).
 *
 * Parent AC 2/4 (parity, gating) of `MS-0MV26X8T200852AC`. Content-unlock
 * gating is data-driven: `MAIN_STREET_CONTENT_UNLOCK_GATED_PACKS` declares which
 * packs are gated and `composeContentUnlockEntitlement` plugs into the loader's
 * `resolveEntitlement` seam. This file proves a **remote** pack flows through
 * that same resolver unchanged — the remote source contributes *content*, never
 * *entitlement* — by driving the whole interactive flow through the public API:
 *
 *   - an entitled remote pack loads and its cards merge into the pool, and an
 *     unentitled one is reported `locked` and contributes zero rows (AC2, AC3);
 *   - the scoped simulated purchase unlocks a **declared** remote pack, is
 *     rule-scoped (no collateral unlocks), and re-discovers it (AC4, AC5);
 *   - a save/load round-trip preserves the remote pack's active set and merged
 *     checksum (AC6);
 *   - enabling/disabling re-merges the pool, and disabling is refused while one
 *     of the pack's cards is live in state (AC7);
 *   - gating stays owned by the declaration table: neither the remote catalogue
 *     nor a wide-open unlock client can free an undeclared remote pack (AC8);
 *   - the full lock → purchase → enable → deal flow is covered end to end
 *     (AC9, parent AC2).
 *
 * The fixture catalogue publishes the **declared** gated pack id
 * (`main-street-residential-pack`), because a remote pack's entitlement key is
 * its pack id exactly as for a bundled pack (`dlc:<gameId>:<packId>`). The
 * bundled source is composed with empty module maps so the pack can only come
 * from the remote catalogue — bundled content would otherwise win precedence,
 * which is itself the `MS-0MVSFWDFW002C1MD` guarantee.
 *
 * @see src/MainStreetCardPacks.ts — loader, purchase, enable/disable.
 * @see src/MainStreetContentUnlockGate.ts — the gating declaration + resolver.
 * @see src/MainStreetPackSources.ts — the remote (signed) pack source.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyEnabledMainStreetPacks,
  applyMainStreetCardPool,
  bootstrapMainStreetCardPacks,
  collectLiveCardIds,
  findMissingLiveTemplateIds,
  getActiveMainStreetPacks,
  getAvailableTemplateIds,
  getMainStreetPurchasablePackIds,
  loadMainStreetCardPacks,
  purchaseMainStreetCardPack,
  resetMainStreetCardPacks,
} from '../../src/MainStreetCardPacks';
import {
  CARD_DATA_RAW,
  CSV_CHECKSUM,
  getActiveCsvChecksum,
  getActiveCsvData,
  getBusinessTemplates,
  type BusinessCard,
} from '../../src/MainStreetCards';
import {
  deserializeMainStreetState,
  serializeMainStreetState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  createConfiguredPackSourceRegistry,
  type PackSourceRegistry,
} from '../../src/MainStreetPackSources';
import {
  getEnabledCardPackIds,
  setEnabledCardPackIds,
  type StorageLike,
} from '../../src/MainStreetPrefs';
import { createBrowserContentUnlockClient } from '../../src/MainStreetBrowserContentUnlockClient';
import type { CardPackClient, CardPackStatusRef, PackEntitlementStatusLike } from '@ui/card-pack-client';
import type { ContentUnlockClient } from '@ui/content-unlock-client';
import {
  BASE_HEADER,
  REMOTE_BASE_URL,
  createFakeRemoteTransport,
  createRemotePackSigningKey,
  remotePackEnv,
  remotePackManifest,
  remotePackManifestEntry,
  remotePackRow,
  type FakeRemoteTransport,
  type RemotePackSigningKey,
} from './fixtures/remotePackFixtures';

/** The content-unlock gated pack the fixture catalogue publishes remotely. */
const GATED_PACK_ID = 'main-street-residential-pack';
/** A card the gated remote pack contributes. */
const GATED_CARD_ID = 'biz-ms-residential-property-mgmt';
/** The declared purchase rule for {@link GATED_PACK_ID}. */
const GATED_PURCHASE_RULE_ID = 'main-street-residential-pack-purchase';
/** The unlock target key the declaration gates the pack on. */
const GATED_DLC_KEY = `dlc:main-street:${GATED_PACK_ID}`;
/** A remote pack the gating table does **not** declare. */
const UNDECLARED_PACK_ID = 'main-street-remote-undeclared';
/** A card the undeclared remote pack contributes. */
const UNDECLARED_CARD_ID = 'biz-ms-remote-undeclared-depot';

/** No warnings reach the console; each test asserts what it needs explicitly. */
const SILENT_LOGGER = { warn: (): void => {} };

/** The itch.io golf reward target a remote purchase must never touch. */
const ITCH_GOLF_TARGET = {
  kind: 'dlc' as const,
  gameId: 'itch-io',
  dlcId: 'golf-reward',
};

/** The gated pack's unlock target. */
const GATED_TARGET = {
  kind: 'dlc' as const,
  gameId: 'main-street',
  dlcId: GATED_PACK_ID,
};

/** A one-row pack CSV fragment in the base column order. */
function packCsv(cardId: string, name: string): string {
  return [
    BASE_HEADER,
    remotePackRow({
      family: 'business',
      id: cardId,
      name,
      cost: '500',
      baseIncome: '120',
      synergyTypes: 'Commerce',
      description: `A card served by a signed remote pack (${name}).`,
    }),
  ].join('\n');
}

/** The packs-relative path of a catalogue pack's CSV. */
function csvPath(packId: string): string {
  return `main-street/${packId}/cards.csv`;
}

/** Options for {@link remoteCatalogue}. */
interface RemoteCatalogueOptions {
  /** Also publish {@link UNDECLARED_PACK_ID} in the same catalogue. */
  readonly includeUndeclaredPack?: boolean;
  /** Version the gated pack publishes; defaults to `1.0.0`. */
  readonly gatedVersion?: string;
}

/**
 * The files a healthy remote catalogue serves: one declared gated pack (and,
 * optionally, an undeclared sibling) plus their card CSVs.
 *
 * Assets are deliberately empty: pack **art** parity is a separate slice
 * (`MS-0MVSFW6HZ003JBFL`), and an empty list keeps every request on the
 * injected text transport.
 */
async function remoteCatalogue(
  key: RemotePackSigningKey,
  options: RemoteCatalogueOptions = {},
): Promise<Record<string, string>> {
  const packs: Record<string, unknown>[] = [
    remotePackManifestEntry({
      id: GATED_PACK_ID,
      version: options.gatedVersion ?? '1.0.0',
      title: 'Main Street Residential (remote)',
      assets: [],
    }),
  ];
  const files: Record<string, string> = {
    [csvPath(GATED_PACK_ID)]: packCsv(GATED_CARD_ID, 'Neighbourhood Property Group'),
  };

  if (options.includeUndeclaredPack) {
    packs.push(
      remotePackManifestEntry({
        id: UNDECLARED_PACK_ID,
        version: '1.0.0',
        title: 'Main Street Remote Depot',
        assets: [],
      }),
    );
    files[csvPath(UNDECLARED_PACK_ID)] = packCsv(
      UNDECLARED_CARD_ID,
      'Remote Depot',
    );
  }

  files['manifest.json'] = await key.signEnvelope(
    remotePackManifest({ packs }),
  );
  return files;
}

/**
 * Compose the registry the browser boot path would use, with an **empty**
 * bundled source so the fixture pack can only arrive remotely.
 */
function remoteOnlyRegistry(
  key: RemotePackSigningKey,
  transport: FakeRemoteTransport,
): PackSourceRegistry {
  return createConfiguredPackSourceRegistry({
    env: remotePackEnv(key.publicKeyBase64),
    fetchImpl: transport.fetch,
    logger: SILENT_LOGGER,
    bundledModules: { text: {}, urls: {} },
  });
}

/** A Steam-DLC client reporting every pack in *state*. */
function steamClient(state: 'free' | 'locked'): CardPackClient {
  const status = (ref: CardPackStatusRef): PackEntitlementStatusLike => ({
    packId: ref.id,
    gameId: ref.gameId ?? null,
    state,
    steamAppId: null,
    reason: state === 'locked' ? 'Not entitled.' : null,
  });
  return {
    isAvailable: async () => true,
    hasCatalog: async () => true,
    supportsDlcCheck: async () => true,
    getCatalog: async () => null,
    getStatus: async (ref) => status(ref),
    listStatus: async (refs) => refs.map(status),
  };
}

/**
 * A content-unlock client reporting `true` only for the listed target keys
 * (`[]` = nothing unlocked, `'*'` = every target unlocked).
 */
function contentUnlocks(unlocked: readonly string[] | '*'): ContentUnlockClient {
  return {
    async isUnlocked(target) {
      if (unlocked === '*') return true;
      if (target.kind !== 'dlc') return false;
      return unlocked.includes(`dlc:${target.gameId}:${target.dlcId}`);
    },
    async getUnlocks() {
      return [];
    },
    async refresh() {
      return [];
    },
  };
}

/** An in-memory {@link StorageLike} modelling a browser `localStorage`. */
interface MemoryStorage extends StorageLike {
  readonly map: Map<string, string>;
}

function createMemoryStorage(): MemoryStorage {
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

/**
 * A mutable content-unlock client whose `refresh` performs the scoped simulated
 * purchase for {@link GATED_PURCHASE_RULE_ID} and records every call.
 */
function mutablePurchaseClient(): {
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
          options.ruleIds?.includes(GATED_PURCHASE_RULE_ID)
        ) {
          unlocked.add(GATED_DLC_KEY);
          return [
            { ruleId: GATED_PURCHASE_RULE_ID, key: GATED_DLC_KEY, outcome: 'unlocked' },
          ];
        }
        return [];
      },
    },
  };
}

/**
 * A live business card instance built from the currently applied templates.
 * Fails the test when the remote pack's template is not merged.
 */
function livePackCard(): BusinessCard {
  const template = getBusinessTemplates().find((card) => card.id === GATED_CARD_ID);
  expect(template, `remote pack business template ${GATED_CARD_ID}`).toBeDefined();
  return {
    ...template!,
    family: 'business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
  };
}

/** Boot the browser path on the remote-only registry. */
function bootRemote(options: {
  key: RemotePackSigningKey;
  transport: FakeRemoteTransport;
  contentUnlocks: ContentUnlockClient;
  client?: CardPackClient;
  storage?: StorageLike | null;
}) {
  return bootstrapMainStreetCardPacks({
    contentDir: null,
    packSources: remoteOnlyRegistry(options.key, options.transport),
    client: options.client ?? steamClient('free'),
    contentUnlocks: options.contentUnlocks,
    storage: options.storage ?? null,
    logger: SILENT_LOGGER,
  });
}

afterEach(() => {
  resetMainStreetCardPacks();
});

describe('remote pack gating parity — load', () => {
  it('loads an entitled remote pack and merges its cards into the pool', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remoteCatalogue(key));

    const result = await loadMainStreetCardPacks({
      contentDir: REMOTE_BASE_URL,
      packSources: remoteOnlyRegistry(key, transport),
      client: steamClient('free'),
      contentUnlocks: contentUnlocks([GATED_DLC_KEY]),
      logger: SILENT_LOGGER,
    });

    // Same shape as a bundled pack: loaded, active, rows merged.
    expect(result.locked).toEqual([]);
    expect(result.loaded.map((pack) => pack.manifest.id)).toEqual([GATED_PACK_ID]);
    expect(result.pool.baseOnly).toBe(false);
    expect(result.pool.activePacks).toEqual([{ id: GATED_PACK_ID, version: '1.0.0' }]);
    expect(result.pool.csv).toContain(GATED_CARD_ID);
    expect(result.pool.checksum).not.toBe(CSV_CHECKSUM);

    applyMainStreetCardPool(result.pool);
    expect(getAvailableTemplateIds()).toContain(GATED_CARD_ID);
    expect(getActiveMainStreetPacks()).toEqual([{ id: GATED_PACK_ID, version: '1.0.0' }]);
  });

  it('reports an unentitled remote pack as locked and merges no rows', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remoteCatalogue(key));

    const result = await loadMainStreetCardPacks({
      contentDir: REMOTE_BASE_URL,
      packSources: remoteOnlyRegistry(key, transport),
      client: steamClient('free'),
      contentUnlocks: contentUnlocks([]),
      logger: SILENT_LOGGER,
    });

    expect(result.locked.map((pack) => pack.manifest.id)).toEqual([GATED_PACK_ID]);
    expect(result.loaded).toEqual([]);
    // A locked pack contributes zero rows: the pool is byte-identical to base.
    expect(result.pool.baseOnly).toBe(true);
    expect(result.pool.csv).toBe(CARD_DATA_RAW);
    expect(result.pool.checksum).toBe(CSV_CHECKSUM);
    expect(result.pool.activePacks).toEqual([]);
    expect(result.pool.csv).not.toContain(GATED_CARD_ID);
    // The locked pack's content was never even fetched (only the manifest was),
    // which is the same refusal a bundled locked pack gets.
    expect(transport.calls).toEqual([`${REMOTE_BASE_URL}/packs/manifest.json`]);
  });
});

describe('remote pack gating parity — purchase', () => {
  it('unlocks a declared remote pack through the scoped simulated purchase and re-discovers it', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remoteCatalogue(key));
    const { client, refreshCalls } = mutablePurchaseClient();

    const before = await bootRemote({ key, transport, contentUnlocks: client });
    expect(before?.locked.map((pack) => pack.manifest.id)).toContain(GATED_PACK_ID);
    expect(getAvailableTemplateIds()).not.toContain(GATED_CARD_ID);

    const outcome = await purchaseMainStreetCardPack(GATED_PACK_ID, {
      contentUnlocks: client,
    });

    // The scoped, explicit simulated-purchase signal reached the client.
    expect(refreshCalls).toEqual([
      { ruleIds: [GATED_PURCHASE_RULE_ID], simulatePurchase: true },
    ]);
    expect(outcome.purchased).toBe(true);
    expect(outcome.load?.loaded.map((pack) => pack.manifest.id)).toContain(
      GATED_PACK_ID,
    );
    // The re-discovery used the same remote transports, and the pack's cards
    // are merged into the live pool afterwards.
    expect(
      transport.calls.some((url) => url === `${REMOTE_BASE_URL}/packs/${csvPath(GATED_PACK_ID)}`),
    ).toBe(true);
    expect(getAvailableTemplateIds()).toContain(GATED_CARD_ID);
  });

  it('evaluates only the declared pack purchase rule — no collateral unlocks', async () => {
    const storage = createMemoryStorage();
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remoteCatalogue(key));

    const before = await bootRemote({
      key,
      transport,
      contentUnlocks: createBrowserContentUnlockClient({ storage }),
      storage,
    });
    expect(before?.locked.map((pack) => pack.manifest.id)).toContain(GATED_PACK_ID);
    // The declared remote pack offers the purchasable affordance, exactly as
    // the bundled residential pack does.
    expect(getMainStreetPurchasablePackIds()).toContain(GATED_PACK_ID);

    const scoped = createBrowserContentUnlockClient({ storage });
    // A different reward rule is neither evaluated nor unlocked.
    await expect(
      scoped.refresh({ ruleIds: ['itch-io-golf-reward'], simulatePurchase: true }),
    ).resolves.toEqual([]);
    expect(await scoped.isUnlocked(ITCH_GOLF_TARGET)).toBe(false);
    // A global self-attested refresh never unlocks.
    await expect(scoped.refresh({ attested: true })).resolves.toEqual([]);

    // Only the remote pack's declared rule unlocks, and only its own target.
    await expect(
      scoped.refresh({ ruleIds: [GATED_PURCHASE_RULE_ID], simulatePurchase: true }),
    ).resolves.toEqual([
      { ruleId: GATED_PURCHASE_RULE_ID, key: GATED_DLC_KEY, outcome: 'unlocked' },
    ]);
    expect(await scoped.isUnlocked(GATED_TARGET)).toBe(true);
    expect(await scoped.isUnlocked(ITCH_GOLF_TARGET)).toBe(false);

    const outcome = await purchaseMainStreetCardPack(GATED_PACK_ID, {
      contentUnlocks: createBrowserContentUnlockClient({ storage }),
    });
    expect(outcome.purchased).toBe(true);
    expect(await createBrowserContentUnlockClient({ storage }).isUnlocked(ITCH_GOLF_TARGET)).toBe(
      false,
    );
  });
});

describe('remote pack gating parity — persistence', () => {
  it('preserves the remote pack active set and merged checksum across save/load', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remoteCatalogue(key));

    const load = await bootRemote({
      key,
      transport,
      contentUnlocks: contentUnlocks([GATED_DLC_KEY]),
    });
    expect(load?.pool.activePacks).toEqual([{ id: GATED_PACK_ID, version: '1.0.0' }]);

    const state: MainStreetState = setupMainStreetGame({ seed: 'remote-pack-parity' });
    state.streetGrid[0] = livePackCard();

    const saved = serializeMainStreetState(state);
    expect(saved.activePacks).toEqual([{ id: GATED_PACK_ID, version: '1.0.0' }]);
    expect(saved.csvChecksum).toBe(load!.pool.checksum);
    expect(saved.csvData).toContain(GATED_CARD_ID);

    // A fresh process: drop the applied pool, then restore the save.
    resetMainStreetCardPacks();
    expect(getAvailableTemplateIds()).not.toContain(GATED_CARD_ID);
    expect(getActiveCsvChecksum()).toBe(CSV_CHECKSUM);

    const restored = deserializeMainStreetState(structuredClone(saved));

    expect(getActiveMainStreetPacks()).toEqual([
      { id: GATED_PACK_ID, version: '1.0.0' },
    ]);
    expect(getActiveCsvChecksum()).toBe(saved.csvChecksum);
    expect(getActiveCsvData()).toBe(load!.pool.csv);
    expect(getAvailableTemplateIds()).toContain(GATED_CARD_ID);
    // The live pack card still resolves against the restored pool.
    expect(collectLiveCardIds(restored)).toContain(GATED_CARD_ID);
    expect(findMissingLiveTemplateIds(restored)).toEqual([]);
  });
});

describe('remote pack gating parity — enable/disable', () => {
  it('re-merges the pool when a remote pack is disabled and enabled again', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remoteCatalogue(key));

    const load = await bootRemote({
      key,
      transport,
      contentUnlocks: contentUnlocks([GATED_DLC_KEY]),
    });
    expect(getAvailableTemplateIds()).toContain(GATED_CARD_ID);

    const disabled = applyEnabledMainStreetPacks(load, [], { storage: null });
    expect(disabled.applied).toBe(true);
    expect(disabled.enabledPackIds).toEqual([]);
    expect(getAvailableTemplateIds()).not.toContain(GATED_CARD_ID);
    expect(getActiveCsvChecksum()).toBe(CSV_CHECKSUM);

    const enabled = applyEnabledMainStreetPacks(load, [GATED_PACK_ID], {
      storage: null,
    });
    expect(enabled.applied).toBe(true);
    expect(enabled.enabledPackIds).toEqual([GATED_PACK_ID]);
    expect(getAvailableTemplateIds()).toContain(GATED_CARD_ID);
    expect(getActiveCsvChecksum()).toBe(load!.pool.checksum);
  });

  it('refuses to disable a remote pack whose cards are live in state', async () => {
    const storage = createMemoryStorage();
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remoteCatalogue(key));

    const load = await bootRemote({
      key,
      transport,
      contentUnlocks: contentUnlocks([GATED_DLC_KEY]),
      storage,
    });
    const enabled = applyEnabledMainStreetPacks(load, [GATED_PACK_ID], { storage });
    expect(enabled.applied).toBe(true);

    const state = setupMainStreetGame({ seed: 'remote-pack-refusal' });
    state.streetGrid[0] = livePackCard();

    const refused = applyEnabledMainStreetPacks(load, [], { state, storage });

    expect(refused.applied).toBe(false);
    expect(refused.reason).toMatch(/in play/i);
    // The previous pool and enabled set were restored: no card was stranded.
    expect(refused.enabledPackIds).toEqual([GATED_PACK_ID]);
    expect(getEnabledCardPackIds(storage)).toEqual([GATED_PACK_ID]);
    expect(getAvailableTemplateIds()).toContain(GATED_CARD_ID);
    expect(findMissingLiveTemplateIds(state)).toEqual([]);
  });
});

describe('remote source never owns entitlement', () => {
  it('gates declared and undeclared remote packs by the declaration table alone', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(
      await remoteCatalogue(key, { includeUndeclaredPack: true }),
    );

    const result = await loadMainStreetCardPacks({
      contentDir: REMOTE_BASE_URL,
      packSources: remoteOnlyRegistry(key, transport),
      // Steam reports both packs locked, and the unlock client reports *every*
      // target unlocked: the catalogue still cannot free the undeclared pack.
      client: steamClient('locked'),
      contentUnlocks: contentUnlocks('*'),
      logger: SILENT_LOGGER,
    });

    // The declared pack is promoted by `composeContentUnlockEntitlement`…
    expect(result.loaded.map((pack) => pack.manifest.id)).toEqual([GATED_PACK_ID]);
    expect(result.pool.csv).toContain(GATED_CARD_ID);
    // …while the undeclared pack stays locked: gating is owned by the
    // declaration, never by the remote source or a wide-open unlock store.
    expect(result.locked.map((pack) => pack.manifest.id)).toEqual([
      UNDECLARED_PACK_ID,
    ]);
    expect(result.pool.csv).not.toContain(UNDECLARED_CARD_ID);
    expect(result.pool.activePacks).toEqual([{ id: GATED_PACK_ID, version: '1.0.0' }]);
  });
});

describe('remote pack full flow', () => {
  it('locks, purchases, enables and deals a remote pack exactly like a bundled pack', async () => {
    const storage = createMemoryStorage();
    // No pack enabled yet: the game starts locked and unmerged.
    setEnabledCardPackIds([], storage);
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remoteCatalogue(key));

    // 1. Lock: the remote pack is listed but contributes no cards.
    const boot = await bootRemote({
      key,
      transport,
      contentUnlocks: createBrowserContentUnlockClient({ storage }),
      storage,
    });
    expect(boot?.locked.map((pack) => pack.manifest.id)).toEqual([GATED_PACK_ID]);
    expect(getMainStreetPurchasablePackIds()).toContain(GATED_PACK_ID);
    expect(getAvailableTemplateIds()).not.toContain(GATED_CARD_ID);

    // 2. Purchase: the scoped simulated purchase unlocks and re-discovers.
    const outcome = await purchaseMainStreetCardPack(GATED_PACK_ID, {
      contentUnlocks: createBrowserContentUnlockClient({ storage }),
    });
    expect(outcome.purchased).toBe(true);
    const load = outcome.load!;
    expect(load.loaded.map((pack) => pack.manifest.id)).toContain(GATED_PACK_ID);
    // Still not enabled: the enabled-pack preference remains empty.
    expect(getAvailableTemplateIds()).not.toContain(GATED_CARD_ID);

    // 3. Enable: the remote pack's rows merge into the live pool.
    const enabled = applyEnabledMainStreetPacks(load, [GATED_PACK_ID], { storage });
    expect(enabled.applied).toBe(true);
    expect(getAvailableTemplateIds()).toContain(GATED_CARD_ID);

    // 4. Deal: a fresh game holds and resolves a card from the remote pack.
    const state = setupMainStreetGame({ seed: 'remote-pack-full-flow' });
    state.streetGrid[0] = livePackCard();
    expect(collectLiveCardIds(state)).toContain(GATED_CARD_ID);
    expect(findMissingLiveTemplateIds(state)).toEqual([]);

    // A reload keeps both the unlock and the enabled preference, exactly as
    // for a bundled pack.
    const reloaded = createBrowserContentUnlockClient({ storage });
    await expect(reloaded.isUnlocked(GATED_TARGET)).resolves.toBe(true);
    expect(getEnabledCardPackIds(storage)).toEqual([GATED_PACK_ID]);
  });
});
