/**
 * Residential pack — purchase → unlock → enable (browser verification).
 *
 * Verification child of the Main Street DLC work item `MS-0MV0M5BHH0020WFY`.
 * Boots the real Main Street scene, materialises the **production** residential
 * pack content into the discovery seam, and proves the Card Packs listing moves
 * the pack locked → purchase → unlocked → enable-able, with the pack's card
 * merging into the playable pool.
 *
 * @see src/scenes/MainStreetOverlayContent.ts (showCardPacksDialog)
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
  getAvailableTemplateIds,
  resetMainStreetCardPacks,
} from '../../src/MainStreetCardPacks';
import { getEnabledCardPackIds, type StorageLike } from '../../src/MainStreetPrefs';
import type { CardPackStatusRef, PackEntitlementStatusLike } from '@ui/card-pack-client';
import type { ContentUnlockClient } from '@ui/content-unlock-client';

const ENABLED_KEY = 'tce-main-street-enabled-card-packs';
const PACK_ID = 'main-street-residential-pack';
const PACK_CARD_ID = 'biz-ms-residential-property-mgmt';
const DLC_KEY = `dlc:main-street:${PACK_ID}`;
const PURCHASE_RULE_ID = 'main-street-residential-pack-purchase';

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
});
