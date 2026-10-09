/**
 * Browser smoke test: tutorial-offer boot ordering
 * (MS-0MV031A0B0026UL2, child of MS-0MV02N2F40069LPY).
 *
 * Boots a real Phaser `MainStreetScene` with a clean tutorial state and
 * asserts the reordered boot flow end to end:
 *
 *   1. The tutorial offer modal is the **first** blocking modal — it is
 *      visible while the New Game mode selector (Single-player vs
 *      Competitive) is not.
 *   2. After the player skips the offer, the offer dismisses and the New Game
 *      mode selector becomes the visible blocking modal.
 *
 * The ordering decision itself is pinned by the Node-level fake-scene tests in
 * `tests/main-street/tutorial-boot-ordering.test.ts`; this file exercises the
 * same guarantee through the real modal/scene seams.
 *
 * Browser tests are excluded from the unit project. Run explicitly:
 *   npx vitest run --project browser tests/main-street/tutorial-offer-ordering.browser.test.ts
 *
 * @module tests/main-street/tutorial-offer-ordering.browser
 */

import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

/** Key used by TutorialState for the tutorial-offer eligibility flag. */
const TUTORIAL_STATE_KEY = 'tce-main-street-tutorial-state';

/** Minimal shape of the scene seams this smoke test inspects. */
interface MainStreetSceneSeams extends Phaser.Scene {
  state?: { turn: number };
  tutorialOfferModal?: { isVisible: boolean; dismiss: () => void };
  newGameOverlay?: { isVisible: boolean };
  newGameSelectionMade?: boolean;
  displayList?: { getAll?: () => Phaser.GameObjects.GameObject[] };
  children?: { getAll?: () => Phaser.GameObjects.GameObject[] };
  hudContainer?: { list?: Phaser.GameObjects.GameObject[] };
}

/** Clears persisted tutorial state so the boot flow shows the offer modal. */
function resetTutorialState(): void {
  try {
    (window as any).localStorage?.removeItem(TUTORIAL_STATE_KEY);
  } catch (_) {
    // ignore in constrained environments
  }
}

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();

  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: Phaser.CANVAS });
  await waitForCondition(() => {
    const scene = game.scene.getScene('MainStreetScene') as MainStreetSceneSeams | undefined;
    return Boolean(scene && scene.state && scene.tutorialOfferModal && scene.newGameOverlay);
  }, 20_000, 'MainStreetScene seams');
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

/**
 * Clears persisted run checkpoints/campaign progress. The SaveLoadStore lives
 * in IndexedDB, which is origin-scoped and shared across browser test files;
 * without this a booted game can suppress the tutorial offer (via a saved
 * checkpoint) in a later file.
 */
async function clearSaveStore(scene: MainStreetSceneSeams | undefined): Promise<void> {
  try {
    await (scene as any)?.saveStore?.clear?.();
  } catch (_) {
    // ignore in constrained environments
  }
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 10_000,
  label = 'condition',
  pollMs = 25,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

/**
 * Finds a Phaser.Text overlay button by its label. Overlay buttons live on the
 * scene display list and/or inside the HUD container, so search all three
 * locations (mirrors the week-banner browser test).
 */
function findTextButton(
  scene: MainStreetSceneSeams,
  matcher: (text: string) => boolean,
): Phaser.GameObjects.Text | undefined {
  const allTexts: Phaser.GameObjects.Text[] = [];
  const displayList = scene.displayList?.getAll?.() ?? [];
  const children = scene.children?.getAll?.() ?? [];
  const hud = scene.hudContainer?.list ?? [];
  for (const obj of [...displayList, ...children, ...hud]) {
    if (obj instanceof Phaser.GameObjects.Text) allTexts.push(obj);
  }
  return allTexts.find((text) => matcher(text.text ?? ''));
}

describe('tutorial offer boot ordering (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(async () => {
    const scene = game?.scene.getScene('MainStreetScene') as MainStreetSceneSeams | undefined;
    await clearSaveStore(scene);
    resetTutorialState();
    try {
      (window as any).localStorage?.clear();
    } catch (_) {
      // ignore
    }
    destroyGame(game);
    game = null;
  });

  it('shows the tutorial offer first and the mode selector only after skipping', async () => {
    resetTutorialState();
    try {
      (window as any).localStorage?.clear();
    } catch (_) {
      // ignore
    }

    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as MainStreetSceneSeams;

    // 1. The offer is the first blocking modal: visible while the mode
    //    selector is not.
    await waitForCondition(
      () => scene.tutorialOfferModal?.isVisible === true,
      5_000,
      'tutorial offer modal visible',
    );
    expect(scene.tutorialOfferModal?.isVisible).toBe(true);
    expect(scene.newGameOverlay?.isVisible).toBe(false);

    // 2. Skip the offer through the modal's real pointer wiring.
    const skipBtn = findTextButton(scene, (text) => text.toLowerCase().includes('skip'));
    expect(skipBtn).toBeTruthy();
    if (!skipBtn) return;
    skipBtn.emit('pointerdown');

    // 3. The offer dismisses and the mode selector becomes the visible
    //    blocking modal.
    await waitForCondition(
      () => scene.newGameOverlay?.isVisible === true,
      5_000,
      'new game selector visible after skip',
    );
    expect(scene.newGameOverlay?.isVisible).toBe(true);
    expect(scene.tutorialOfferModal?.isVisible).toBe(false);
    // The selector guard is set once it is presented for this boot.
    expect(scene.newGameSelectionMade).toBe(true);
  }, 30_000);
});
