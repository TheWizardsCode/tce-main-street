/**
 * Browser test: the Card Packs listing wired into Main Street
 * (F9 / CG-0MUZIS4KZ003R1HP).
 *
 * Boots the real Main Street scene, injects a discovery result (one entitled
 * pack, one locked pack), opens the listing from the in-game entry point, and
 * asserts the installed/unlocked/locked render states and the toggle gating —
 * a locked pack cannot be enabled, an entitled pack can be disabled. Also
 * asserts the enabled set is persisted so the card pool stays consistent.
 *
 * @see src/scenes/MainStreetOverlayContent.ts (showCardPacksDialog)
 */
import { describe, it, expect, afterEach } from 'vitest';
import Phaser from 'phaser';
import { waitForScene } from '@core-tests/helpers/waitForScene';

import { CARD_DATA_RAW } from '../../src/MainStreetCards';
import {
  applyEnabledMainStreetPacks,
  getAvailableTemplateIds,
  resetMainStreetCardPacks,
  setMainStreetCardPackLoadResult,
} from '../../src/MainStreetCardPacks';
import { getEnabledCardPackIds, type StorageLike } from '../../src/MainStreetPrefs';

const ENABLED_KEY = 'tce-main-street-enabled-card-packs';
const BASE_HEADER = CARD_DATA_RAW.split('\n')[0];
const BASE_COLUMNS = BASE_HEADER.split(',');
const PACK_ID = 'uitest-pack';
const PACK_CARD_ID = 'biz-pack-uitest';

function packRow(fields: Record<string, string>): string {
  return BASE_COLUMNS.map((column) => fields[column] ?? '').join(',');
}

function packCsv(): string {
  return [
    BASE_HEADER,
    packRow({
      family: 'business',
      id: PACK_CARD_ID,
      name: 'UI Test Tea House',
      cost: '300',
      baseIncome: '161',
      synergyTypes: 'Food',
      maxLevel: '2',
      description: 'A pack business card for the browser test.',
    }),
  ].join('\n');
}

function packLoadResult() {
  return {
    pool: {},
    loaded: [
      {
        manifest: {
          id: PACK_ID,
          gameId: 'main-street',
          title: 'UI Test Pack',
          description: 'An entitled pack.',
          version: '1.0.0',
          coreEngineVersion: '^0.1.0',
          cards: 'cards.csv',
        },
        csv: packCsv(),
        assetUrls: [],
        status: {
          packId: PACK_ID,
          gameId: 'main-street',
          state: 'free',
          steamAppId: null,
          reason: null,
        },
        enabled: true,
      },
    ],
    locked: [
      {
        manifest: {
          id: 'locked-uitest-pack',
          gameId: 'main-street',
          title: 'Locked UI Test Pack',
          description: 'A locked pack.',
          version: '2.0.0',
          coreEngineVersion: '^0.1.0',
          cards: 'cards.csv',
        },
        status: {
          packId: 'locked-uitest-pack',
          gameId: 'main-street',
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

describe('Main Street Card Packs listing (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
    try {
      localStorage.removeItem(ENABLED_KEY);
    } catch {
      /* ignore */
    }
    setMainStreetCardPackLoadResult(null);
    resetMainStreetCardPacks();
  });

  it('renders entitled and locked rows from the in-game entry point', async () => {
    localStorage.removeItem(ENABLED_KEY);
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    setMainStreetCardPackLoadResult(packLoadResult());
    scene.showCardPacks();
    await waitFrames(6);

    const texts = collectTexts(listingContainer(scene)).map((text) => text.text);
    expect(texts).toContain('Card Packs');
    expect(texts.some((text) => text.includes('UI Test Pack'))).toBe(true);
    expect(texts).toContain('[ Disable ]');
    // The locked pack renders read-only with its reason and no toggle control.
    expect(texts.some((text) => text.includes('Locked UI Test Pack'))).toBe(true);
    expect(texts.some((text) => text.startsWith('Locked —'))).toBe(true);
    expect(texts).toContain('[ Locked ]');
  });

  it('disables an entitled pack and persists the enabled set', async () => {
    localStorage.removeItem(ENABLED_KEY);
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    setMainStreetCardPackLoadResult(packLoadResult());
    // Mirror what boot does: apply the merged pool before the listing opens.
    applyEnabledMainStreetPacks(packLoadResult(), [PACK_ID], {
      storage: globalThis.localStorage,
    });
    expect(getAvailableTemplateIds()).toContain(PACK_CARD_ID);

    scene.showCardPacks();
    await waitFrames(6);

    const disable = collectTexts(listingContainer(scene)).find(
      (text) => text.text === '[ Disable ]',
    );
    expect(disable).toBeDefined();
    disable!.emit('pointerdown');
    await waitFrames(6);

    const texts = collectTexts(listingContainer(scene)).map((text) => text.text);
    expect(texts).toContain('[ Enable ]');
    expect(getAvailableTemplateIds()).not.toContain(PACK_CARD_ID);

    const storage = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    expect(getEnabledCardPackIds(storage)).toEqual([]);
  });

  it('never offers an enable control for a locked pack', async () => {
    localStorage.removeItem(ENABLED_KEY);
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    setMainStreetCardPackLoadResult(packLoadResult());
    scene.showCardPacks();
    await waitFrames(6);

    const texts = collectTexts(listingContainer(scene)).map((text) => text.text);
    // Exactly one toggle control — the entitled pack's — and it is a Disable.
    expect(texts.filter((text) => text === '[ Enable ]').length).toBe(0);
    expect(texts.filter((text) => text === '[ Disable ]').length).toBe(1);
    expect(texts.filter((text) => text === '[ Locked ]').length).toBe(1);
  });
});
