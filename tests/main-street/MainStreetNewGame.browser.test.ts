/**
 * MainStreetScene new-game selector browser smoke test
 * (child MS-0MUTU8INS009MRR1 of epic MS-0MUTTVR5K002ZDUP).
 *
 * Boots a real Phaser game, asserts the blocking "New Game" overlay appears at
 * boot, then applies a Competitive selection through the lifecycle manager and
 * asserts the resulting state is competitive with the chosen seats.
 *
 * Runs inside Chromium via Vitest browser mode + Playwright.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

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

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('presents the blocking selector at boot and starts a competitive game on confirm', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    // Blocking selector is visible before the first interactive day.
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
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

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
