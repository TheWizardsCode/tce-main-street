/**
 * MainStreetScene new-game selector browser smoke test
 * (child MS-0MUTU8INS009MRR1 of epic MS-0MUTTVR5K002ZDUP).
 *
 * Boots a real Phaser game, asserts the blocking "New Game" overlay appears at
 * boot, then applies a Competitive selection through the lifecycle manager and
 * asserts the resulting state is competitive with the chosen seats.
 *
 * The tutorial offer is now the first blocking boot modal
 * (MS-0MV0319OC002H15F); the selector is presented first only when the offer is
 * ineligible. Each test seeds the tutorial state as already seen so it exercises
 * the selector-first path.
 *
 * Runs inside Chromium via Vitest browser mode + Playwright.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

/** Key used by TutorialState for the tutorial-offer eligibility flag. */
const TUTORIAL_STATE_KEY = 'tce-main-street-tutorial-state';

/**
 * Seeds the persisted tutorial state as "skipped" so the boot flow skips the
 * tutorial offer and presents the New Game mode selector first.
 */
function markTutorialSeen(): void {
  try {
    (window as any).localStorage?.setItem(
      TUTORIAL_STATE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        status: 'skipped',
        completedAt: null,
        lastStepId: null,
        bankingHintShownAt: null,
      }),
    );
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
    const scene = game.scene.getScene('MainStreetScene') as any;
    return Boolean(scene && scene.state && scene.newGameOverlay);
  }, 20_000);
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
 * without this a confirmed game in one test suppresses the tutorial offer (via
 * a saved checkpoint) in a later file.
 */
async function clearSaveStore(scene: any): Promise<void> {
  try {
    await scene?.saveStore?.clear?.();
  } catch (_) {
    // ignore in constrained environments
  }
}

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

describe('New Game overlay (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(async () => {
    const scene = game?.scene.getScene('MainStreetScene') as any;
    await clearSaveStore(scene);
    try { (window as any).localStorage?.clear(); } catch (_) { /* ignore */ }
    destroyGame(game);
    game = null;
  });

  it('presents the blocking selector at boot and starts a competitive game on confirm', async () => {
    markTutorialSeen();
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    // Blocking selector is visible before the first interactive day (the
    // tutorial offer is ineligible because the state is already "skipped").
    await waitForCondition(() => scene.newGameOverlay?.isVisible === true);
    expect(scene.newGameOverlay.isVisible).toBe(true);
    expect(scene.newGameOverlay.getSelection().mode).toBe('single-player');

    // Confirm Competitive with one Random/Easy opponent through the boot path.
    scene.msLifecycleManager.applyNewGameSelection({
      mode: 'competitive',
      opponents: [{ strategy: 'Random', difficulty: 'Easy' }],
    });

    await waitForCondition(() => (scene.state?.players?.length ?? 0) === 2);

    expect(scene.state.playerCount).toBe(2);
    expect(scene.state.players[0].controller).toBe('human');
    expect(scene.state.players[1].controller).toBe('ai');
    expect(scene.state.players[1].aiStrategy).toBe('Random');
    expect(scene.state.players[1].aiDifficulty).toBe('Easy');
  });

  it('presents the selector again after a scene restart (Play Again)', async () => {
    markTutorialSeen();
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    // The selector is presented first because the tutorial offer is ineligible.
    await waitForCondition(() => scene.newGameOverlay?.isVisible === true);

    // Complete a boot: confirm a selection, which sets the guard flag.
    scene.msLifecycleManager.applyNewGameSelection({
      mode: 'competitive',
      opponents: [{ strategy: 'Random', difficulty: 'Easy' }],
    });
    await waitForCondition(() => (scene.state?.players?.length ?? 0) === 2);
    expect(scene.newGameSelectionMade).toBe(true);

    // Restart the scene the way the game-over `[ Play Again ]` button does.
    scene.scene.restart();

    // The guard must be reset in create(), so the selector is offered again.
    await waitForCondition(() => scene.newGameSelectionMade === false);
    await waitForCondition(() => scene.newGameOverlay?.isVisible === true);
  });
});
