/**
 * Main Street: Competitive-mode end-of-game stats
 * (MS-0MVAMU6OM008GJPV parent, MS-0MVSHZ20P001MK2J child).
 *
 * Verifies the competitive-scope assumptions of the end-of-game stats:
 *  - the competitive closing records exactly one `turnStatsHistory` entry per
 *    turn, taken from the **human seat's** closing wallet (never an AI seat's);
 *  - the rendered series mirror that history, so no AI wallet leaks into the
 *    graphs;
 *  - replay mode creates no chart DOM layer.
 *
 * @module tests/main-street/competitive-game-over-stats
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createCompetitiveState,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  executeCompetitiveTurn,
  recordTurnStats,
} from '../../src/MainStreetEngine';
import { buildGameOverStatSeries } from '../../src/scenes/MainStreetGameOverSummary';

const chartMock = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../src/scenes/MainStreetStatsChart', () => ({
  createStatsChart: vi.fn(() => {
    chartMock.count += 1;
    return Promise.resolve({ canvas: {}, destroy: vi.fn() });
  }),
  destroyStatsChart: vi.fn(),
}));

// `@ui` pulls in Phaser (which needs `window`); mock it so this stays a plain
// Node unit test.
vi.mock('@ui', () => ({
  FONT_FAMILY: 'Arial',
  createOverlayBackground: vi.fn(() => ({ objects: [], box: {} })),
  createOverlayButton: vi.fn(() => ({ on: () => undefined })),
  dismissOverlay: vi.fn(),
}));

import { MainStreetOverlayContent } from '../../src/scenes/MainStreetOverlayContent';
import type { TurnResult } from '../../src/MainStreetEngine';

function competitive(seed: string): MainStreetState {
  return createCompetitiveState({ seed, playerCount: 2 });
}

function winResult(finalScore = 100): TurnResult {
  return {
    income: { total: 0, breakdown: [], handSynergyTotal: 0, phaseBreakdown: { perSlotBreakdown: [], handSynergyTotal: 0 } },
    incident: null,
    incidentCoinChange: 0,
    incidentRepChange: 0,
    finalScore,
    gameResult: 'win',
    newlyCompletedChallenges: [],
    choicePending: false,
  };
}

describe('competitive turnStatsHistory recording', () => {
  it('records exactly one entry per turn from the human seat wallet', () => {
    const state = competitive('comp-stats-record');
    // Give the AI seat a distinctive wallet so an AI leak is unmistakable.
    state.players![1]!.coins = 999;
    state.players![1]!.reputation = 88;

    executeCompetitiveTurn(state, [[], []]);

    // Exactly one entry for the completed turn.
    expect(state.turnStatsHistory).toHaveLength(1);
    const snapshot = state.turnStatsHistory[0]!;
    // Values come from the human seat (index 0), not the AI seat.
    expect(snapshot.coins).toBe(state.players![0]!.coins);
    expect(snapshot.reputation).toBe(state.players![0]!.reputation);
    expect(snapshot.coins).not.toBe(999);
    expect(snapshot.reputation).not.toBe(88);
    expect(snapshot.staff).toBe(state.players![0]!.staffCards.length);
  });

  it('never records one entry per AI seat', () => {
    const state = createCompetitiveState({ seed: 'comp-stats-count', playerCount: 3 });
    executeCompetitiveTurn(state, [[], [], []]);
    // One shared day = one turn = one entry despite three seats.
    expect(state.turnStatsHistory).toHaveLength(1);
  });

  it('reads the human seat even when the shared scratch bank differs', () => {
    const state = competitive('comp-stats-scratch');
    state.players![0]!.coins = 321;
    state.players![0]!.reputation = 12;
    state.players![1]!.coins = 654;
    state.players![1]!.reputation = 34;
    // The shared `resourceBank` is the last-bound seat's scratch wallet.
    state.resourceBank.coins = 654;
    state.resourceBank.reputation = 34;

    const snapshot = recordTurnStats(state, 7);

    expect(snapshot.coins).toBe(321);
    expect(snapshot.reputation).toBe(12);
  });
});

describe('competitive stat series', () => {
  it('mirrors the recorded human history without leaking an AI wallet', () => {
    const state = competitive('comp-stats-series');
    state.turnStatsHistory = [
      { turn: 1, coins: 120, reputation: 5, score: 10, profit: 20, businesses: 2, staff: 1 },
      { turn: 2, coins: 160, reputation: 7, score: 25, profit: 40, businesses: 3, staff: 2 },
    ];
    // An AI seat with a wildly different wallet must not affect the series.
    state.players![1]!.coins = 9999;

    const series = buildGameOverStatSeries(state);

    expect(series.cash.points).toEqual([
      { turn: 1, value: 120 },
      { turn: 2, value: 160 },
    ]);
    expect(series.profit.points).toEqual([
      { turn: 1, value: 20 },
      { turn: 2, value: 40 },
    ]);
    expect(series.finalCash).toBe(160);
    expect(series.cash.points.some((p) => p.value === 9999)).toBe(false);
  });
});

describe('replay-mode guard', () => {
  it('creates no chart DOM layer and no overlay in replay mode', () => {
    chartMock.count = 0;
    const state = competitive('comp-stats-replay');
    const scene: Record<string, unknown> = {
      layout: { gameW: 1280, gameH: 720 },
      overlayObjects: [],
      uiPhase: 'market',
      replayMode: true,
      campaign: undefined,
      refreshAll: vi.fn(),
      msAnimator: { animateGameOver: vi.fn() },
      hudContainer: { add: vi.fn() },
      add: {
        text: vi.fn(),
        rectangle: vi.fn(),
      },
      state,
    };

    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    expect(chartMock.count).toBe(0);
    expect((scene.overlayObjects as unknown[])).toHaveLength(0);
    expect((scene.add as { text: ReturnType<typeof vi.fn> }).text).not.toHaveBeenCalled();
  });
});
