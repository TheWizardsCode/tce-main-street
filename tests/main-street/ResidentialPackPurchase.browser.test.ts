/**
 * Residential pack — purchase → unlock → enable (browser verification).
 *
 * Verification child of the Main Street DLC work item `MS-0MV0M5BHH0020WFY`.
 * Boots the real Main Street scene, materialises the **production** residential
 * pack content into the discovery seam, and proves the Card Packs listing moves
 * the pack locked → purchase → unlocked → enable-able, with the pack's card
 * merging into the playable pool.
 *
 * The focused verification suite (`MS-0MV53CF6O007J2UY`) additionally drives
 * the flow through the **real** `localStorage`-backed content-unlock client and
 * the build-time bundled pack source (no `window.tce` bridges, no test double),
 * asserting reload persistence, rule-scoping against the itch.io golf reward,
 * save/load round-tripping and missing/disabled-pack degradation.
 *
 * @see src/scenes/MainStreetOverlayContent.ts (showCardPacksDialog)
 * @see src/MainStreetBrowserContentUnlockClient.ts (real browser client)
 * @see tests/main-street/helpers/residentialPack.ts
 */

import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';
import { waitForScene } from '@core-tests/helpers/waitForScene';

// @ts-ignore: Vite ?raw import — intentional
import packManifestRaw from '../../packs/manifest.json?raw';
// @ts-ignore: Vite ?raw import — intentional
import residentialCsvRaw from '../../packs/main-street/main-street-residential-pack/cards.csv?raw';

import {
  bootstrapMainStreetCardPacks,
  getActiveMainStreetPacks,
  getAvailableTemplateIds,
  resetMainStreetCardPacks,
} from '../../src/MainStreetCardPacks';
import {
  BROWSER_CONTENT_UNLOCKS_KEY,
  resolveMainStreetContentUnlockClient,
} from '../../src/MainStreetBrowserContentUnlockClient';
import { PackSourceRegistry } from '../../src/MainStreetPackSources';
import {
  deserializeMainStreetState,
  serializeMainStreetState,
  setupMainStreetGame,
} from '../../src/MainStreetState';
import { getEnabledCardPackIds, type StorageLike } from '../../src/MainStreetPrefs';
import type { CardPackStatusRef, PackEntitlementStatusLike } from '@ui/card-pack-client';
import type { ContentUnlockClient } from '@ui/content-unlock-client';

const ENABLED_KEY = 'tce-main-street-enabled-card-packs';
const PACK_ID = 'main-street-residential-pack';
const PACK_CARD_ID = 'biz-ms-residential-property-mgmt';
const DLC_KEY = `dlc:main-street:${PACK_ID}`;
const PURCHASE_RULE_ID = 'main-street-residential-pack-purchase';
const PACK_VERSION = '1.0.0';
const ITCHIO_FOLLOW_RULE_ID = 'itchio-follow';
const GOLF_TARGET = { kind: 'game', gameId: 'golf' } as const;
const SILENT_LOGGER = { warn: (): void => {} };

const FREE_STEAM = {
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

/** A mutable content-unlock client whose refresh performs the scoped purchase. */
function mutableContentUnlocks(): ContentUnlockClient {
  const unlocked = new Set<string>();
  return {
    async isUnlocked(target) {
      if (target.kind !== 'dlc') return false;
      return unlocked.has(`dlc:${target.gameId}:${target.dlcId}`);
    },
    async getUnlocks() {
      return [];
    },
    async refresh(options) {
      if (
        options?.simulatePurchase === true &&
        options.ruleIds?.includes(PURCHASE_RULE_ID)
      ) {
        unlocked.add(DLC_KEY);
        return [{ ruleId: PURCHASE_RULE_ID, key: DLC_KEY, outcome: 'unlocked' }];
      }
      return [];
    },
  };
}

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();
  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: Phaser.CANVAS, parent: 'game-container' });
  await waitForScene(game, 'MainStreetScene');
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

function waitFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = n;
    const tick = () => {
      remaining--;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Poll *predicate* until it is true or *timeoutMs* elapses. */
async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 10_000,
  pollMs = 25,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
}

/**
 * Discover the packs through the build-time bundled source exactly as the
 * plain-browser boot does (no launcher content directory, no bridges).
 */
function bootstrapBundledPack() {
  return bootstrapMainStreetCardPacks({ contentDir: null, logger: SILENT_LOGGER });
}

/** The overlay listing's visible text labels. */
function listingTexts(scene: any): string[] {
  return collectTexts(listingContainer(scene)).map((text) => text.text);
}

/** Emit `pointerdown` on the listing control labelled *label*. */
function clickListingControl(scene: any, label: string): void {
  const control = collectTexts(listingContainer(scene)).find(
    (text) => text.text === label,
  );
  if (!control) throw new Error(`Listing control ${label} not found`);
  control.emit('pointerdown');
}

/** Recursively collect every Text object under *root*. */
function collectTexts(root: Phaser.GameObjects.GameObject): Phaser.GameObjects.Text[] {
  const out: Phaser.GameObjects.Text[] = [];
  const visit = (object: Phaser.GameObjects.GameObject) => {
    if (object instanceof Phaser.GameObjects.Text) out.push(object);
    const children = (object as Phaser.GameObjects.Container).list;
    if (Array.isArray(children)) children.forEach(visit);
  };
  visit(root);
  return out;
}

function listingContainer(scene: any): Phaser.GameObjects.Container {
  const container = (scene.overlayObjects as Phaser.GameObjects.GameObject[]).find(
    (object) => object instanceof Phaser.GameObjects.Container,
  );
  if (!container) throw new Error('Card Packs listing container not found');
  return container as Phaser.GameObjects.Container;
}

describe('residential pack purchase (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
    try {
      localStorage.removeItem(ENABLED_KEY);
      localStorage.removeItem(BROWSER_CONTENT_UNLOCKS_KEY);
    } catch {
      /* ignore */
    }
    resetMainStreetCardPacks();
  });

  it('shows the pack locked, purchases it, and makes it enable-able', async () => {
    // No pack enabled yet: the purchase unlocks the pack but leaves it disabled
    // so the test exercises the explicit enable step.
    localStorage.setItem(ENABLED_KEY, JSON.stringify([]));
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    const contentUnlocks = mutableContentUnlocks();
    await bootstrapMainStreetCardPacks({
      contentDir: 'file:///content/',
      fetchManifest: async () => packManifestRaw,
      fetchCsv: async () => residentialCsvRaw,
      client: FREE_STEAM,
      contentUnlocks,
      storage: globalThis.localStorage,
      logger: { warn: () => {} },
    });

    scene.showCardPacks();
    await waitFrames(6);

    // Locked, with a purchase affordance and no pack card in play.
    let texts = collectTexts(listingContainer(scene)).map((text) => text.text);
    expect(texts.some((text) => text.includes('Main Street Residential'))).toBe(true);
    expect(texts).toContain('[ Purchase ]');
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);

    // Activate the simulated purchase; the async re-discovery re-renders.
    collectTexts(listingContainer(scene))
      .find((text) => text.text === '[ Purchase ]')!
      .emit('pointerdown');
    await waitFrames(24);

    texts = collectTexts(listingContainer(scene)).map((text) => text.text);
    expect(texts).not.toContain('[ Purchase ]');
    expect(texts).toContain('[ Enable ]');

    // Enable the newly unlocked pack: its card merges and persists.
    collectTexts(listingContainer(scene))
      .find((text) => text.text === '[ Enable ]')!
      .emit('pointerdown');
    await waitFrames(6);

    expect(getAvailableTemplateIds()).toContain(PACK_CARD_ID);
    const storage = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    expect(getEnabledCardPackIds(storage)).toEqual([PACK_ID]);
  });

  it('purchases, enables and deals the bundled pack through the real browser unlock client', async () => {
    // Explicit empty enabled set: the pack must be enabled by hand after the
    // purchase, exercising the full lock → purchase → enable → deal path.
    localStorage.setItem(ENABLED_KEY, JSON.stringify([]));
    await bootstrapBundledPack();
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    scene.showCardPacks();
    await waitForCondition(() => listingTexts(scene).includes('[ Purchase ]'));
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);

    clickListingControl(scene, '[ Purchase ]');
    await waitForCondition(() => listingTexts(scene).includes('[ Enable ]'));
    // Unlocked by the scoped purchase but not enabled yet: still out of play.
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);

    // The real localStorage-backed client persisted exactly the scoped unlock,
    // and the itch.io golf reward was never collateral-unlocked.
    const client = resolveMainStreetContentUnlockClient();
    expect((await client.getUnlocks()).map((record) => record.key)).toEqual([DLC_KEY]);
    expect(await client.isUnlocked(GOLF_TARGET)).toBe(false);
    expect(
      await client.refresh({ ruleIds: [ITCHIO_FOLLOW_RULE_ID], simulatePurchase: true }),
    ).toEqual([]);
    expect(await client.isUnlocked(GOLF_TARGET)).toBe(false);

    clickListingControl(scene, '[ Enable ]');
    await waitForCondition(() => getAvailableTemplateIds().includes(PACK_CARD_ID));

    expect(getActiveMainStreetPacks()).toEqual([
      { id: PACK_ID, version: PACK_VERSION },
    ]);
    const storage = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    expect(getEnabledCardPackIds(storage)).toEqual([PACK_ID]);
  });

  it('keeps the unlock and the enabled-pack preference across a reload', async () => {
    localStorage.setItem(ENABLED_KEY, JSON.stringify([]));
    await bootstrapBundledPack();
    game = await bootGame();
    let scene = game.scene.getScene('MainStreetScene') as any;

    scene.showCardPacks();
    await waitForCondition(() => listingTexts(scene).includes('[ Purchase ]'));
    clickListingControl(scene, '[ Purchase ]');
    await waitForCondition(() => listingTexts(scene).includes('[ Enable ]'));
    clickListingControl(scene, '[ Enable ]');
    await waitForCondition(() => getAvailableTemplateIds().includes(PACK_CARD_ID));
    expect(getEnabledCardPackIds(globalThis.localStorage)).toEqual([PACK_ID]);

    // Simulate a page reload: drop the in-memory pool, then re-discover from the
    // persisted localStorage unlock + enabled-pack preference.
    destroyGame(game);
    game = null;
    resetMainStreetCardPacks();
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);

    const reloaded = await bootstrapBundledPack();
    expect(reloaded!.loaded.map((pack) => pack.manifest.id)).toContain(PACK_ID);
    expect(getAvailableTemplateIds()).toContain(PACK_CARD_ID);
    expect(getActiveMainStreetPacks()).toEqual([
      { id: PACK_ID, version: PACK_VERSION },
    ]);

    // The reopened listing shows the pack unlocked and enabled, not purchasable.
    game = await bootGame();
    scene = game.scene.getScene('MainStreetScene') as any;
    scene.showCardPacks();
    await waitForCondition(() => listingTexts(scene).includes('[ Disable ]'));
    expect(listingTexts(scene)).not.toContain('[ Purchase ]');
  });

  it('round-trips the browser-enabled pack pool through save/load', async () => {
    localStorage.setItem(ENABLED_KEY, JSON.stringify([]));
    await bootstrapBundledPack();
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    scene.showCardPacks();
    await waitForCondition(() => listingTexts(scene).includes('[ Purchase ]'));
    clickListingControl(scene, '[ Purchase ]');
    await waitForCondition(() => listingTexts(scene).includes('[ Enable ]'));
    clickListingControl(scene, '[ Enable ]');
    await waitForCondition(() => getAvailableTemplateIds().includes(PACK_CARD_ID));

    const state = setupMainStreetGame({ seed: 'browser-pack-save-load' });
    const serialized = serializeMainStreetState(state);
    expect(serialized.activePacks).toEqual([{ id: PACK_ID, version: PACK_VERSION }]);
    expect(serialized.csvData).toContain(PACK_CARD_ID);

    resetMainStreetCardPacks();
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);

    deserializeMainStreetState(structuredClone(serialized));
    expect(getAvailableTemplateIds()).toContain(PACK_CARD_ID);
    expect(getActiveMainStreetPacks()).toEqual([
      { id: PACK_ID, version: PACK_VERSION },
    ]);
  });

  it('degrades to base content with a warning when the bundled pack is missing or disabled', async () => {
    // Missing: the bundled source carries no pack at all.
    const missing = await bootstrapMainStreetCardPacks({
      contentDir: null,
      packSources: new PackSourceRegistry(),
      requestedPacks: [{ id: PACK_ID, version: PACK_VERSION }],
      logger: SILENT_LOGGER,
    });
    expect(missing!.pool.baseOnly).toBe(true);
    expect(missing!.warnings.some((warning) => warning.includes('missing'))).toBe(true);
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);

    // Disabled: the pack is installed but the unlock is absent, so it stays
    // locked and its cards never merge.
    localStorage.setItem(ENABLED_KEY, JSON.stringify([PACK_ID]));
    localStorage.removeItem(BROWSER_CONTENT_UNLOCKS_KEY);
    const disabled = await bootstrapMainStreetCardPacks({
      contentDir: null,
      requestedPacks: [{ id: PACK_ID, version: PACK_VERSION }],
      logger: SILENT_LOGGER,
    });
    expect(disabled!.pool.baseOnly).toBe(true);
    expect(disabled!.locked.map((pack) => pack.manifest.id)).toContain(PACK_ID);
    expect(disabled!.warnings.some((warning) => warning.includes('disabled'))).toBe(true);
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);
  });
});
