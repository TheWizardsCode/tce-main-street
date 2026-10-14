/**
 * Browser verification: Main Street boot discovers the bundled card pack
 * (`MS-0MV53CG6L001A56B`).
 *
 * Boots the **real** Main Street scene through {@link createMainStreetGame}
 * — i.e. the scene lifecycle boot gate, not `bootstrapMainStreetCardPacks` —
 * with no `window.tce.contentDir` and no Electron bridges. The boot must fall
 * back to the build-time bundled pack source, discover the committed
 * residential pack, and list it as a **gated** row (locked + `[ Purchase ]`)
 * without ever issuing a `tce-packs://` request and without leaking its cards
 * into the playable pool.
 *
 * Kept in its own file because the boot gate runs at most once per module
 * instance (a later `setMainStreetCardPackLoadResult` marks discovery as
 * bootstrapped); a file-level fresh module registry is required to exercise it.
 *
 * @see src/scenes/MainStreetLifecycleManagerLifecycle.ts (shouldBootstrapPacks)
 * @see src/MainStreetCardPacks.ts (bootstrapMainStreetCardPacks)
 * @see src/MainStreetPackSources.ts (bundled source + transports)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';
import { waitForScene } from '@core-tests/helpers/waitForScene';

import {
  getAvailableTemplateIds,
  getMainStreetCardPackLoadResult,
  resetMainStreetCardPacks,
} from '../../src/MainStreetCardPacks';

const RESIDENTIAL_PACK_ID = 'main-street-residential-pack';
const RESIDENTIAL_CARD_ID = 'biz-ms-residential-property-mgmt';
const CONTENT_UNLOCKS_KEY = 'tce-main-street-content-unlocks';
const ENABLED_PACKS_KEY = 'tce-main-street-enabled-card-packs';

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

describe('Main Street boot discovers the bundled card pack (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
    try {
      localStorage.removeItem(CONTENT_UNLOCKS_KEY);
      localStorage.removeItem(ENABLED_PACKS_KEY);
    } catch {
      /* ignore */
    }
    resetMainStreetCardPacks();
    vi.restoreAllMocks();
  });

  it('discovers the bundled residential pack as a locked, purchasable row', async () => {
    localStorage.removeItem(CONTENT_UNLOCKS_KEY);
    localStorage.removeItem(ENABLED_PACKS_KEY);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    // The scene lifecycle boot gate discovers the bundled pack in the
    // background (settling after scene setup), so poll for the result.
    await waitForCondition(() => getMainStreetCardPackLoadResult() !== null);
    const load = getMainStreetCardPackLoadResult();
    expect(load).not.toBeNull();
    expect(load!.locked.map((pack) => pack.manifest.id)).toContain(RESIDENTIAL_PACK_ID);
    // Gated: its cards stay out of play while locked.
    expect(getAvailableTemplateIds()).not.toContain(RESIDENTIAL_CARD_ID);

    scene.showCardPacks();
    await waitFrames(6);

    const texts = collectTexts(listingContainer(scene)).map((text) => text.text);
    expect(texts.some((text) => text.includes('Main Street Residential'))).toBe(true);
    // A gated locked row offers the purchase control instead of a plain
    // `[ Locked ]`, with its lock reason shown as detail text.
    expect(texts.some((text) => text.startsWith('Locked —'))).toBe(true);
    expect(texts).toContain('[ Purchase ]');
    expect(texts).not.toContain('No card packs installed.');

    // The browser path resolves the CSV/asset URLs through the bundled source,
    // never the Electron-only `tce-packs://` scheme.
    expect(
      fetchSpy.mock.calls.every(([url]) => !String(url).startsWith('tce-packs://')),
    ).toBe(true);
  });
});
