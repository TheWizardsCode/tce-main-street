/**
 * Main Street: Three-column Game Over overlay with stats column
 * (MS-0MVSHZ1JU0083ASL AC8)
 *
 * Boots the real Phaser scene and asserts, at the 1280×720 design size:
 * - the three column headers `Game State`, `Summary` and `Stats` render;
 * - five chart canvases render in the Stats column;
 * - dismissing the overlay removes every chart canvas.
 *
 * @module tests/main-street/game-over-stats-column.browser
 */

import { afterEach, describe, expect, it } from 'vitest';
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

/** 12-turn history so the stats column is exercised with a rich series. */
function richHistory() {
  return Array.from({ length: 12 }, (_, i) => ({
    turn: i + 1,
    coins: 100 + i * 10,
    reputation: 2 + i,
    score: i * 5,
    profit: 10,
    businesses: 1 + (i % 3),
    staff: i % 2,
  }));
}

function overlayTexts(scene: Phaser.Scene & Record<string, unknown>): string[] {
  const hud = scene.hudContainer as unknown as { list?: unknown[] } | null;
  if (!hud?.list) return [];
  return hud.list
    .map((child: unknown) => (child as { text?: string }).text)
    .filter((text): text is string => typeof text === 'string');
}

/** Minimal competitive roster for the overlay's per-seat presentation. */
function competitivePlayers() {
  return [
    { playerId: 0, coins: 220, reputation: 13, score: 55, hand: [], staffCards: [], actionBudget: 1, controller: 'human', eliminated: false },
    { playerId: 1, coins: 90, reputation: 4, score: 30, hand: [], staffCards: [], actionBudget: 1, controller: 'ai', eliminated: false },
  ];
}

/**
 * Asserts the three column headers, the five chart canvases, the cash line and
 * that every canvas is visible inside the viewport — then dismisses the
 * overlay and asserts the chart canvases are gone.
 */
async function assertThreeColumnOverlay(
  scene: Phaser.Scene & Record<string, unknown>,
): Promise<void> {
  const s = scene as any;
  await waitForCondition(
    () => document.querySelectorAll(CHART_SELECTOR).length === 5,
    { timeoutMs: 8_000, label: 'five chart canvases' },
  );

  const texts = overlayTexts(scene);
  expect(texts).toContain('Game State');
  expect(texts).toContain('Summary');
  expect(texts).toContain('Stats');
  expect(texts).toContain('[ View detailed stats ]');
  expect(texts.some((t) => t.startsWith('Cash at end of turn:'))).toBe(true);

  for (const canvas of Array.from(document.querySelectorAll(CHART_SELECTOR)) as HTMLCanvasElement[]) {
    const rect = canvas.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.top).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth + 1);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
  }

  dismissOverlay(s.overlayObjects ?? []);
  s.overlayObjects = [];
  await waitForCondition(
    () => document.querySelectorAll(CHART_SELECTOR).length === 0,
    { timeoutMs: 5_000, label: 'chart teardown' },
  );
}

describe('MainStreet three-column Game Over overlay', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
    for (const node of Array.from(document.querySelectorAll(CHART_SELECTOR))) node.remove();
  });

  it('renders the three columns with five charts in single-player', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;
    const s = scene as any;
    s.state.turnStatsHistory = richHistory();

    s.showGameOverOverlay(gameOverResult(true), []);
    await assertThreeColumnOverlay(scene);
  });

  it('renders the three columns with five charts in competitive mode', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;
    const s = scene as any;
    s.state.players = competitivePlayers();
    s.state.playerCount = 2;
    s.state.activePlayerId = 0;
    s.state.turnStatsHistory = richHistory();
    s.state.endReason = 'score_threshold';

    s.showGameOverOverlay(gameOverResult(true), []);
    await assertThreeColumnOverlay(scene);
  });
});
