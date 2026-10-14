/**
 * Residential pack — unlock → purchase → deal → save/load pipeline
 * (verification).
 *
 * Verification child of the Main Street DLC work item `MS-0MV0M5BHH0020WFY`.
 * Drives the **production** residential pack (materialised from `packs/`) and
 * the **real core** action-reward service (in-memory store, no Electron)
 * through the whole channel:
 *
 *   locked → scoped simulated purchase → unlocked → merged → dealt →
 *   serialized → reset → restored, plus missing-pack degradation.
 *
 * It proves the scoping the parent requires: the purchase unlocks only the
 * residential DLC and never the configured itch.io golf reward, and a global
 * self-attest refresh never unlocks the residential pack.
 *
 * @see tests/main-street/helpers/residentialPack.ts
 * @see core/electron/action-rewards.ts
 */

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ActionRewardService,
  MemoryContentUnlockStore,
} from '../../core/electron/action-rewards';
import { createActionRewardHandlers } from '../../core/electron/action-rewards-ipc';
import { createContentUnlockVerifierRegistry } from '../../core/electron/action-verifiers';
import { loadActionRewardsConfig } from '../../core/electron/action-rewards-config';
import { createContentUnlockClient } from '../../core/src/ui/content-unlock-client';

import {
  CARD_DATA_RAW,
  CSV_CHECKSUM,
  getActiveCsvChecksum,
  getBusinessTemplates,
} from '../../src/MainStreetCards';
import {
  applyMainStreetCardPool,
  getActiveMainStreetPacks,
  getAvailableTemplateIds,
  loadMainStreetCardPacks,
  purchaseMainStreetCardPack,
  resetMainStreetCardPacks,
  type MainStreetPackLoadResult,
} from '../../src/MainStreetCardPacks';
import {
  deserializeMainStreetState,
  serializeMainStreetState,
  setupMainStreetGame,
} from '../../src/MainStreetState';
import type { BusinessCard } from '../../src/MainStreetCards';
import type { ContentUnlockClient } from '@ui/content-unlock-client';
import type { CardPackStatusRef, PackEntitlementStatusLike } from '@ui/card-pack-client';

import {
  REPO_ROOT,
  RESIDENTIAL_PACK_GAME_ID,
  RESIDENTIAL_PACK_ID,
} from './helpers/residentialPack';
import { getCardArtDataUriForCard } from '../../src/MainStreetCardArt';
import { hasPackArt } from '../../src/MainStreetCardPackArt';
import { generateCardSvgFromCsvRow } from '../../src/scenes/MainStreetCardSvgGenerator';

const CONFIG_PATH = path.join(REPO_ROOT, 'core', 'electron', 'action-rewards.json');
const PACK_ROOT = path.join(REPO_ROOT, 'packs');
const PACK_VERSION = '1.0.0';

const GOLF_TARGET = { kind: 'game', gameId: 'golf' } as const;

/** A card id contributed by the production residential pack. */
const PACK_CARD_ID = 'biz-ms-residential-property-mgmt';

/** The display name of {@link PACK_CARD_ID} in the production pack. */
const PACK_CARD_NAME = 'Neighbourhood Property Group';

const silentLogger = { warn: (): void => {} };

/** A Steam client that reports every pack free (no Steam gate). */
const freeSteamClient = {
  listStatus: async (
    refs: readonly CardPackStatusRef[],
  ): Promise<PackEntitlementStatusLike[]> =>
    refs.map((ref) => ({
      packId: ref.id,
      gameId: ref.gameId ?? null,
      state: 'free' as const,
      steamAppId: null,
      reason: null,
    })),
} as never;

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Materialise the production pack into a fresh `<contentDir>/packs/` tree. */
function makeContentDir(): string {
  const dir = tempDir('ms-residential-e2e-');
  cpSync(PACK_ROOT, path.join(dir, 'packs'), { recursive: true });
  return dir;
}

/** An empty content directory (no packs installed). */
function makeEmptyContentDir(): string {
  const dir = tempDir('ms-residential-empty-');
  const packsDir = path.join(dir, 'packs');
  mkdirSync(packsDir, { recursive: true });
  writeFileSync(
    path.join(packsDir, 'manifest.json'),
    JSON.stringify({ version: 1, packs: [] }),
    'utf-8',
  );
  return dir;
}

/** Filesystem transports standing in for the `tce-packs://` protocol. */
function diskFetchers(contentDir: string) {
  const packsDir = path.join(contentDir, 'packs');
  return {
    fetchManifest: async (): Promise<string> =>
      readFileSync(path.join(packsDir, 'manifest.json'), 'utf-8'),
    fetchCsv: async (url: string): Promise<string> => {
      const parsed = new URL(url);
      const [packId, ...rest] = decodeURIComponent(parsed.pathname)
        .split('/')
        .filter(Boolean);
      return readFileSync(
        path.join(packsDir, parsed.hostname, packId, rest.join('/')),
        'utf-8',
      );
    },
    fetchAsset: async (url: string): Promise<Uint8Array> => {
      const parsed = new URL(url);
      const [packId, ...rest] = decodeURIComponent(parsed.pathname)
        .split('/')
        .filter(Boolean);
      return new Uint8Array(
        readFileSync(
          path.join(packsDir, parsed.hostname, packId, rest.join('/')),
        ),
      );
    },
  };
}

/**
 * The real core service wired exactly as `main.ts` does, exposed through the
 * renderer `ContentUnlockClient` so the pipeline uses the production write path.
 */
function makeServiceBackedContentUnlocks(): {
  service: ActionRewardService;
  client: ContentUnlockClient;
} {
  const config = loadActionRewardsConfig({ configPath: CONFIG_PATH });
  expect(config, 'shipped action-rewards.json must load').not.toBeNull();
  const service = new ActionRewardService({
    rules: { version: config!.version, rules: config!.rules },
    store: new MemoryContentUnlockStore(),
    verifiers: createContentUnlockVerifierRegistry(),
    verifierConfig: config!.verifiers,
  });
  const handlers = createActionRewardHandlers(service);
  const client = createContentUnlockClient({
    isUnlocked: (target) => handlers.isUnlocked(target),
    getUnlocks: () => handlers.getUnlocks(),
    refresh: (options) => handlers.refresh(options),
  });
  return { service, client };
}

/** Load the production pack from *contentDir* through the real loader. */
function load(contentDir: string, contentUnlocks: ContentUnlockClient) {
  return loadMainStreetCardPacks({
    contentDir,
    ...diskFetchers(contentDir),
    client: freeSteamClient,
    contentUnlocks,
    logger: silentLogger,
  });
}

/** A live business instance built from a pack template. */
function packBusinessCard(): BusinessCard {
  const template = getBusinessTemplates().find((card) => card.id === PACK_CARD_ID);
  expect(template, `pack template ${PACK_CARD_ID}`).toBeDefined();
  return {
    ...template!,
    family: 'business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
  };
}

afterEach(() => {
  resetMainStreetCardPacks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('residential pack — locked until purchased', () => {
  it('keeps the pack out of the pool and templates with no content unlock', async () => {
    const { client } = makeServiceBackedContentUnlocks();
    const contentDir = makeContentDir();

    const result = await load(contentDir, client);

    expect(result.errors).toEqual([]);
    expect(result.incompatible).toEqual([]);
    expect(result.locked.map((pack) => pack.manifest.id)).toEqual([RESIDENTIAL_PACK_ID]);
    expect(result.pool.baseOnly).toBe(true);
    expect(result.pool.csv).toBe(CARD_DATA_RAW);
    expect(result.pool.checksum).toBe(CSV_CHECKSUM);
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);
  });
});

describe('residential pack — scoped simulated purchase', () => {
  it('unlocks only the residential pack and merges its cards', async () => {
    const { service, client } = makeServiceBackedContentUnlocks();
    const contentDir = makeContentDir();
    const fetchers = diskFetchers(contentDir);

    // Start locked.
    const before = await load(contentDir, client);
    expect(before.pool.baseOnly).toBe(true);

    // Scoped dev/QA purchase through the real service.
    const outcome = await purchaseMainStreetCardPack(RESIDENTIAL_PACK_ID, {
      contentUnlocks: client,
      bootstrapOptions: {
        contentDir,
        ...fetchers,
        client: freeSteamClient,
        contentUnlocks: client,
        storage: null,
        logger: silentLogger,
      },
    });

    expect(outcome.purchased).toBe(true);
    const loadResult = outcome.load as MainStreetPackLoadResult;
    expect(loadResult.locked).toEqual([]);
    expect(loadResult.pool.baseOnly).toBe(false);
    expect(loadResult.pool.activePacks).toEqual([
      { id: RESIDENTIAL_PACK_ID, version: PACK_VERSION },
    ]);
    expect(loadResult.pool.csv).toContain(PACK_CARD_ID);
    expect(getAvailableTemplateIds()).toContain(PACK_CARD_ID);

    // The scoped purchase did not collateral-unlock the itch.io golf reward.
    expect(await service.isUnlocked(GOLF_TARGET)).toBe(false);
  });

  it('never unlocks the residential pack on a global self-attest refresh', async () => {
    const { service } = makeServiceBackedContentUnlocks();

    await service.refresh({ attested: true });

    // The honour-system golf reward unlocks …
    expect(await service.isUnlocked(GOLF_TARGET)).toBe(true);
    // … but the simulated-purchase pack does not.
    expect(
      await service.isUnlocked({
        kind: 'dlc',
        gameId: RESIDENTIAL_PACK_GAME_ID,
        dlcId: RESIDENTIAL_PACK_ID,
      }),
    ).toBe(false);
  });
});

describe('residential pack — deal, save and load', () => {
  it('round-trips the active pack, merged checksum and cards in play', async () => {
    const { client } = makeServiceBackedContentUnlocks();
    const contentDir = makeContentDir();
    const fetchers = diskFetchers(contentDir);

    const outcome = await purchaseMainStreetCardPack(RESIDENTIAL_PACK_ID, {
      contentUnlocks: client,
      bootstrapOptions: {
        contentDir,
        ...fetchers,
        client: freeSteamClient,
        contentUnlocks: client,
        storage: null,
        logger: silentLogger,
      },
    });
    expect(outcome.purchased).toBe(true);
    applyMainStreetCardPool(outcome.load!.pool);

    // Deal a pack card into play.
    const state = setupMainStreetGame({ seed: 'residential-save-load' });
    state.streetGrid[0] = packBusinessCard();

    const saved = serializeMainStreetState(state);
    expect(saved.activePacks).toEqual([
      { id: RESIDENTIAL_PACK_ID, version: PACK_VERSION },
    ]);
    expect(saved.csvChecksum).toBe(outcome.load!.pool.checksum);
    expect(saved.csvData).toContain(PACK_CARD_ID);

    // Fresh process: drop the pool, then restore the save.
    resetMainStreetCardPacks();
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);

    const restored = deserializeMainStreetState(structuredClone(saved));
    expect(getActiveMainStreetPacks()).toEqual([
      { id: RESIDENTIAL_PACK_ID, version: PACK_VERSION },
    ]);
    expect(getActiveCsvChecksum()).toBe(saved.csvChecksum);
    expect(getAvailableTemplateIds()).toContain(PACK_CARD_ID);
    expect((restored.streetGrid[0] as { id: string }).id).toBe(PACK_CARD_ID);
  });

  it('degrades to base content when a saved pack is not installed', async () => {
    const { client } = makeServiceBackedContentUnlocks();
    const contentDir = makeEmptyContentDir();

    const result = await loadMainStreetCardPacks({
      contentDir,
      ...diskFetchers(contentDir),
      requestedPacks: [{ id: RESIDENTIAL_PACK_ID, version: PACK_VERSION }],
      client: freeSteamClient,
      contentUnlocks: client,
      logger: silentLogger,
    });

    expect(result.pool.baseOnly).toBe(true);
    expect(result.pool.csv).toBe(CARD_DATA_RAW);
    expect(result.pool.checksum).toBe(CSV_CHECKSUM);
    expect(result.warnings.some((warning) => warning.includes(RESIDENTIAL_PACK_ID))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('missing'))).toBe(true);
  });
});

describe('residential pack — end-to-end rendered SVG embeds pack art', () => {
  it('materialises the pack, loads it through the real loader and embeds the inlined pack data URI', async () => {
    const { client } = makeServiceBackedContentUnlocks();
    const contentDir = makeContentDir();

    const outcome = await purchaseMainStreetCardPack(RESIDENTIAL_PACK_ID, {
      contentUnlocks: client,
      bootstrapOptions: {
        contentDir,
        ...diskFetchers(contentDir),
        client: freeSteamClient,
        contentUnlocks: client,
        storage: null,
        logger: silentLogger,
      },
    });
    expect(outcome.purchased).toBe(true);

    const load = outcome.load as MainStreetPackLoadResult;
    const pack = load.loaded.find((entry) => entry.manifest.id === RESIDENTIAL_PACK_ID);
    expect(pack, 'residential pack loaded').toBeDefined();

    const dataUri = pack!.assetDataUris[PACK_CARD_ID];
    expect(dataUri, 'pack asset inlined').toMatch(/^data:image\/png;base64,/);
    expect(hasPackArt(PACK_CARD_ID)).toBe(true);

    const svg = generateCardSvgFromCsvRow({
      id: PACK_CARD_ID,
      name: PACK_CARD_NAME,
      family: 'business',
    });
    expect(svg).toContain(dataUri);
    expect(getCardArtDataUriForCard(PACK_CARD_ID, PACK_CARD_NAME)).toBe(dataUri);
  });
});

describe('residential pack — asset degradation', () => {
  it('degrades a missing pack asset to Fallback with a logged warning', async () => {
    const { client } = makeServiceBackedContentUnlocks();
    const contentDir = makeContentDir();

    // Remove one declared asset from the materialised content directory.
    rmSync(
      path.join(
        contentDir,
        'packs',
        RESIDENTIAL_PACK_GAME_ID,
        RESIDENTIAL_PACK_ID,
        'assets',
        `${PACK_CARD_ID}.png`,
      ),
    );

    const warnings: string[] = [];
    const outcome = await purchaseMainStreetCardPack(RESIDENTIAL_PACK_ID, {
      contentUnlocks: client,
      bootstrapOptions: {
        contentDir,
        ...diskFetchers(contentDir),
        client: freeSteamClient,
        contentUnlocks: client,
        storage: null,
        logger: { warn: (message: string) => warnings.push(message) },
      },
    });
    expect(outcome.purchased).toBe(true);

    const load = outcome.load as MainStreetPackLoadResult;
    // Reported structurally — never thrown, never crashing the load.
    expect(
      load.errors.some((error) => error.reason.includes(`${PACK_CARD_ID}.png`)),
      'missing asset reported structurally',
    ).toBe(true);
    expect(
      warnings.some((warning) => warning.includes(PACK_CARD_ID)),
      'missing asset warned',
    ).toBe(true);

    // The card degrades: no pack art registered → base map (none) → Fallback.
    expect(hasPackArt(PACK_CARD_ID)).toBe(false);
    const uri = getCardArtDataUriForCard(PACK_CARD_ID, PACK_CARD_NAME);
    expect(uri).toMatch(/^data:/);
    expect(uri).not.toMatch(/^data:image\/png;base64,/);

    // The rendered SVG is never blank — it embeds the Fallback art.
    const svg = generateCardSvgFromCsvRow({
      id: PACK_CARD_ID,
      name: PACK_CARD_NAME,
      family: 'business',
    });
    expect(svg).toContain(uri);
    expect(svg).toMatch(/<image /);
  });

  it('renders Fallback for pack cards when the pack is not installed', async () => {
    const { client } = makeServiceBackedContentUnlocks();
    const contentDir = makeEmptyContentDir();

    const result = await loadMainStreetCardPacks({
      contentDir,
      ...diskFetchers(contentDir),
      client: freeSteamClient,
      contentUnlocks: client,
      logger: silentLogger,
    });
    expect(result.pool.baseOnly).toBe(true);

    expect(hasPackArt(PACK_CARD_ID)).toBe(false);
    const uri = getCardArtDataUriForCard(PACK_CARD_ID, PACK_CARD_NAME);
    expect(uri).toMatch(/^data:/);
    expect(uri).not.toMatch(/^data:image\/png;base64,/);
  });
});
