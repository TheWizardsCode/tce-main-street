/**
 * Main Street: Game-Over Win Celebration / Loss Sting Browser Tests
 *
 * Verifies the game-over feedback trigger end to end in a real Phaser scene:
 *
 * 1. A win (`showGameOverOverlay` with `gameResult: 'win'`) triggers
 *    `MainStreetAnimator.animateGameOver({ win: true, ... })` and the
 *    victory fanfare SFX (`sfx-game-win`), and the 'You Win!' panel shows.
 * 2. A loss triggers `animateGameOver({ win: false, ... })` + the low sting
 *    SFX (`sfx-game-lost`), and the 'Game Over' panel shows.
 *
 * The animator's internal visuals (24 confetti pieces / dim pulse) are
 * covered deterministically by the unit tests; here we assert the wiring.
 *
 * @module tests/main-street/game-over.browser
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';
import type { TurnResult } from '../../src/MainStreetEngine';
import { SFX_KEYS } from '../../src/scenes/MainStreetConstants';

// ── Boot helpers (mirrors MainStreetOverlay.browser.test.ts) ──

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();
  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: Phaser.CANVAS });
  await waitForCondition(
    () => {
      const scene = game.scene.getScene('MainStreetScene');
      return Boolean(scene && (scene as any).state && (scene as any).msAnimator);
    },
    { timeoutMs: 20_000, label: 'MainStreetScene boot' },
  );
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

async function waitForCondition(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 25;
  const label = options.label ?? 'condition';
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

/** Build a minimal TurnResult for a forced game-over. */
function gameOverResult(isWin: boolean): TurnResult {
  return {
    income: { total: 0, breakdown: [], handSynergyTotal: 0, phaseBreakdown: { perSlotBreakdown: [], handSynergyTotal: 0 } },
    incident: null,
    incidentCoinChange: 0,
    incidentRepChange: 0,
    finalScore: isWin ? 100 : 0,
    gameResult: isWin ? 'win' : 'loss',
    newlyCompletedChallenges: [],
    choicePending: false,
  };
}

interface GameOverCall {
  win: boolean;
  width: number;
  height: number;
}

/** Spy on the animator's game-over feedback (call-through so visuals run). */
function spyOnGameOver(scene: Phaser.Scene & Record<string, unknown>): { calls: GameOverCall[] } {
  const animator = scene.msAnimator as unknown as {
    animateGameOver: (params: GameOverCall) => void;
  };
  const original = animator.animateGameOver.bind(animator);
  const calls: GameOverCall[] = [];
  vi.spyOn(animator, 'animateGameOver').mockImplementation((params) => {
    calls.push(params);
    original(params); // run the real implementation so confetti/dim run
  });
  return { calls };
}

/**
 * Locates the overlay text objects whose content includes `text`.
 *
 * The Game Over overlay parents every text object into
 * `scene.hudContainer`, so this is the canonical content lookup reused by
 * the two-column layout assertions added by later children.
 */
function findOverlayText(
  scene: Phaser.Scene & Record<string, unknown>,
  text: string,
): Phaser.GameObjects.Text[] {
  const hud = scene.hudContainer as unknown as { list?: unknown[] } | null;
  if (!hud?.list) return [];
  return hud.list.filter((child: unknown): child is Phaser.GameObjects.Text => {
    const t = child as { text?: string };
    return typeof t.text === 'string' && t.text.includes(text);
  });
}

/** Whether the overlay contains a text object whose content includes `text`. */
function overlayHasText(
  scene: Phaser.Scene & Record<string, unknown>,
  text: string,
): boolean {
  return findOverlayText(scene, text).length > 0;
}

/**
 * Asserts the Game Over overlay is present: it has pushed objects into
 * `scene.overlayObjects` (background, box, texts and buttons).
 */
function expectOverlayPresent(scene: Phaser.Scene & Record<string, unknown>): void {
  const objects = scene.overlayObjects as unknown[] | undefined;
  expect(Array.isArray(objects)).toBe(true);
  expect(objects!.length).toBeGreaterThan(0);
}

/** Whether the game-over panel title with the given text is visible. */
function hasOverlayTitle(scene: Phaser.Scene & Record<string, unknown>, title: string): boolean {
  return overlayHasText(scene, title);
}

describe('MainStreet game-over feedback', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    const moduleUrl = (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE_URL__;
    if (typeof moduleUrl === 'string' && moduleUrl.startsWith('blob:')) {
      URL.revokeObjectURL(moduleUrl);
    }

    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE__;
    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE_URL__;
    delete (globalThis as unknown as Record<string, unknown>).__TF_PLAY_COUNT__;
    destroyGame(game);
    game = null;
  });

  it('a win triggers the confetti celebration + victory fanfare and shows the You Win! panel', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;
    const s = scene as any;

    s.state.endReason = 'all_businesses_placed';
    const { calls } = spyOnGameOver(scene);

    const soundSpy = vi.spyOn(s.soundManager, 'play').mockClear();
    s.showGameOverOverlay(gameOverResult(true), []);

    await waitForCondition(() => calls.length >= 1, { timeoutMs: 5000, label: 'win game-over trigger' });
    expect(calls).toHaveLength(1);
    expect(calls[0].win).toBe(true);
    expect(calls[0].width).toBeGreaterThan(0);
    expect(calls[0].height).toBeGreaterThan(0);

    // Victory fanfare SFX played through the SoundManager.
    expect(soundSpy).toHaveBeenCalledWith(SFX_KEYS.GAME_WIN);

    // The 'You Win!' panel is up.
    expect(s.uiPhase).toBe('game-over');
    expectOverlayPresent(scene);
    expect(hasOverlayTitle(scene, 'You Win!')).toBe(true);
  }, 30_000);

  it('a loss triggers the sting + board dim and shows the Game Over panel', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;
    const s = scene as any;

    s.state.endReason = 'no_coins';
    const { calls } = spyOnGameOver(scene);

    const soundSpy = vi.spyOn(s.soundManager, 'play').mockClear();
    s.showGameOverOverlay(gameOverResult(false), []);

    await waitForCondition(() => calls.length >= 1, { timeoutMs: 5000, label: 'loss game-over trigger' });
    expect(calls).toHaveLength(1);
    expect(calls[0].win).toBe(false);

    // Low sting SFX played through the SoundManager.
    expect(soundSpy).toHaveBeenCalledWith(SFX_KEYS.GAME_LOST);

    // The 'Game Over' panel is up.
    expect(s.uiPhase).toBe('game-over');
    expectOverlayPresent(scene);
    expect(hasOverlayTitle(scene, 'Game Over')).toBe(true);
  }, 30_000);
});
