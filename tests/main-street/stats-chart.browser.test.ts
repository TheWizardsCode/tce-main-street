/**
 * Main Street: Stats chart DOM layer — browser test
 * (MS-0MVSHZ131002ZF3O AC2/AC5)
 *
 * Boots the real Phaser scene with the real Chart.js integration and proves:
 * - opening the Game Over overlay creates a dedicated DOM `<canvas>` layered
 *   above the Phaser overlay panel at 1280×720;
 * - closing the overlay removes it (no leftover chart canvases) across 20
 *   open/close cycles, with no `console.error` output.
 *
 * @module tests/main-street/stats-chart.browser
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';
import { dismissOverlay } from '@ui';
import type { TurnResult } from '../../src/MainStreetEngine';

const CHART_SELECTOR = 'canvas[data-main-street-stats-chart]';

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

/** The overlay's own teardown path (what the Menu / Play Again buttons call). */
function closeOverlay(scene: Phaser.Scene & Record<string, unknown>): void {
  const s = scene as any;
  dismissOverlay(s.overlayObjects ?? []);
  s.overlayObjects = [];
}

describe('MainStreet stats chart DOM layer', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
    for (const node of Array.from(document.querySelectorAll(CHART_SELECTOR))) node.remove();
    vi.restoreAllMocks();
  });

  it('renders a chart canvas above the overlay panel and removes it on close', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;
    const s = scene as any;

    s.showGameOverOverlay(gameOverResult(true), []);

    await waitForCondition(
      () => document.querySelectorAll(CHART_SELECTOR).length === 1,
      { timeoutMs: 5_000, label: 'chart canvas' },
    );

    const canvas = document.querySelector(CHART_SELECTOR) as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    // Positioned inside the 1280×720 viewport over the overlay panel.
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth + 1);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight + 1);

    closeOverlay(scene);
    await waitForCondition(
      () => document.querySelectorAll(CHART_SELECTOR).length === 0,
      { timeoutMs: 5_000, label: 'chart canvas teardown' },
    );
  });

  it('leaves no chart canvases after 20 open/close cycles, with no console errors', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;
    const s = scene as any;

    const consoleErrors: unknown[][] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args);
    });

    for (let cycle = 0; cycle < 20; cycle += 1) {
      s.showGameOverOverlay(gameOverResult(true), []);
      // Let the lazy import resolve and the chart mount.
      await waitForCondition(
        () => document.querySelectorAll(CHART_SELECTOR).length === 1,
        { timeoutMs: 5_000, label: `chart canvas (cycle ${cycle})` },
      );
      closeOverlay(scene);
      await waitForCondition(
        () => document.querySelectorAll(CHART_SELECTOR).length === 0,
        { timeoutMs: 5_000, label: `chart teardown (cycle ${cycle})` },
      );
    }

    expect(document.querySelectorAll(CHART_SELECTOR).length).toBe(0);
    expect(consoleErrors).toEqual([]);
    errorSpy.mockRestore();
  });
});
