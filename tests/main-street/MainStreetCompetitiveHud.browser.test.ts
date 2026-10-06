/**
 * MainStreetScene competitive scoreboard browser test
 * (child MS-0MUTU8J9T0034OT7 of epic MS-0MUTTVR5K002ZDUP).
 *
 * Boots a real Phaser game, starts a competitive game, and asserts the HUD
 * renders one scoreboard cell per seat reading each seat's own state, that the
 * active-seat indicator moves on control hand-back, and that the human seat is
 * visually distinct from the AI seats.
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
    return Boolean(scene && scene.state && scene.hudContainer);
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

/** Scoreboard text objects currently rendered in the HUD container. */
function scoreboardRows(scene: any): any[] {
  return (scene.hudContainer?.list ?? []).filter(
    (child: any) => typeof child?.name === 'string' && child.name === 'competitive-scoreboard-row',
  );
}

describe('Competitive HUD scoreboard (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('renders per-seat values and moves the active-seat indicator on hand-back', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    // Boot straight into a competitive game (2 seats: human + 1 AI).
    scene.msLifecycleManager.applyNewGameSelection({
      mode: 'competitive',
      opponents: [{ strategy: 'Greedy', difficulty: 'Medium' }],
    });
    await waitForCondition(() => (scene.state?.players?.length ?? 0) === 2);

    // Give the AI seat distinct values so the scoreboard proves per-seat reads.
    scene.state.players[0].coins = 1234;
    scene.state.players[1].coins = 5678;
    scene.state.activePlayerId = 1;
    scene.refreshAll();
    await waitForCondition(() => scoreboardRows(scene).length === 2);

    const rows = scoreboardRows(scene);
    expect(rows).toHaveLength(2);

    const byPlayer = new Map<number, any>(rows.map((r: any) => [r.getData('playerId'), r]));
    expect(byPlayer.get(0).text).toContain('1234c');
    expect(byPlayer.get(1).text).toContain('5678c');

    // AI seat 1 is active; human seat 0 is distinct.
    expect(byPlayer.get(1).getData('active')).toBe(true);
    expect(byPlayer.get(0).getData('active')).toBe(false);
    expect(byPlayer.get(0).getData('human')).toBe(true);
    expect(byPlayer.get(1).getData('human')).toBe(false);

    // Hand control back: the indicator moves to the human seat.
    scene.state.activePlayerId = 0;
    scene.refreshAll();
    await waitForCondition(() => {
      const current = new Map<number, any>(
        scoreboardRows(scene).map((r: any) => [r.getData('playerId'), r]),
      );
      return current.get(0)?.getData('active') === true;
    });

    const afterHandBack = new Map<number, any>(
      scoreboardRows(scene).map((r: any) => [r.getData('playerId'), r]),
    );
    expect(afterHandBack.get(0).getData('active')).toBe(true);
    expect(afterHandBack.get(1).getData('active')).toBe(false);
  });
});
