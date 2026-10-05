/**
 * Main Street: Human-collapse loss + single-player regression.
 *
 * Parent: MS-0MUVBH589001L7NL (Competitive game ends on AI seat failure)
 *
 * AC1 — human `reputation <= 0` (turn > 1) ends the game with
 *       `reputation_collapse`.
 * AC2 — human `coins < 0` ends the game with `bankruptcy`.
 * AC3 — a human collapse is not converted into elimination and an AI
 *       elimination in the same step does not mask/defer the human loss.
 * AC4 — single-player `checkImmediateLoss` / `checkEndConditions` unchanged.
 * AC5 — no `coins == 0` end condition in either mode.
 * AC6 — uses the shared competitive fixture harness + single-player helpers.
 *
 * @module tests/main-street/competitive-human-collapse
 */
import { describe, it, expect } from 'vitest';

import {
  buildCompetitiveState,
  buildHumanVsAis,
} from './helpers/competitive-fixtures';
import { bindCompetitiveSeat } from '../../src/MainStreetAiStrategy';
import {
  checkCompetitiveEndConditions,
  checkCompetitiveSeatFailure,
  resolveCompetitiveSeatFailures,
  eliminateCompetitiveSeat,
  executeCompetitiveWeekStart,
  endCompetitiveMarketTurn,
  resolveCompetitiveClosingPhases,
} from '../../src/MainStreetEngine';
import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';

// ── Helpers ─────────────────────────────────────────────────

/**
 * Drives a competitive state from WeekStart to InvestmentResolution and
 * mirrors the last-acting (AI) seat into the shared scratch bank, matching
 * the real shared-day flow.
 */
function driveToClosing(state: MainStreetState): void {
  executeCompetitiveWeekStart(state);
  const n = state.players!.length;
  for (let i = 0; i < n; i++) {
    endCompetitiveMarketTurn(state);
  }
  bindCompetitiveSeat(state, n - 1);
}

// ── AC1: human reputation collapse ──────────────────────────

describe('AC1 — human reputation collapse ends the game', () => {
  it('through the shared closing: loss + reputation_collapse', () => {
    const state = buildHumanVsAis('human-rep-close', 1, [[500, 0], [500, 5]]);
    state.turn = 2;
    driveToClosing(state);

    const result = resolveCompetitiveClosingPhases(state);
    expect(result.gameResult).toBe('loss');
    expect(state.endReason).toBe('reputation_collapse');
    expect(state.competitiveWinnerId).toBeNull();
  });

  it('is detected by the per-seat evaluation before income/incident run', () => {
    const state = buildHumanVsAis('human-rep-eval', 1, [[500, 0], [500, 5]]);
    state.turn = 2;
    expect(checkCompetitiveSeatFailure(state)).toEqual([
      { playerId: 0, reason: 'reputation_collapse' },
    ]);
  });

  it('does not fire on turn 1 (starting reputation guard)', () => {
    const state = buildHumanVsAis('human-rep-t1', 1, [[500, 0], [500, 5]]);
    state.turn = 1;
    expect(checkCompetitiveSeatFailure(state)).toEqual([]);
  });
});

// ── AC2: human bankruptcy ───────────────────────────────────

describe('AC2 — human bankruptcy ends the game', () => {
  it('through the shared closing: loss + bankruptcy', () => {
    const state = buildHumanVsAis('human-bankrupt-close', 1, [[-5, 5], [500, 5]]);
    state.turn = 2;
    driveToClosing(state);

    const result = resolveCompetitiveClosingPhases(state);
    expect(result.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
  });

  it('bankruptcy takes precedence over reputation collapse', () => {
    const state = buildHumanVsAis('human-bankrupt-precedence', 1, [[-5, 0], [500, 5]]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);
    expect(state.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
  });
});

// ── AC3: not masked by AI elimination ───────────────────────

describe('AC3 — human collapse is not converted to elimination / masked', () => {
  it('a collapsing human is never marked eliminated', () => {
    const state = buildHumanVsAis('human-not-elim', 1, [[500, 0], [500, 5]]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);
    expect(state.gameResult).toBe('loss');
    expect(state.players![0].eliminated ?? false).toBe(false);
  });

  it('an AI eliminated in an earlier step does not mask a later human loss', () => {
    const state = buildHumanVsAis('human-after-ai-elim', 1, [[500, 5], [500, 0]]);
    state.turn = 2;
    // Step 1: the AI collapses and is eliminated.
    resolveCompetitiveSeatFailures(state);
    expect(state.players![1].eliminated).toBe(true);
    expect(state.gameResult).toBe('playing');

    // Step 2: the human now collapses — the loss must still fire.
    state.players![0].reputation = 0;
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(true);
    expect(state.gameResult).toBe('loss');
    expect(state.endReason).toBe('reputation_collapse');
  });

  it('a simultaneous AI collapse does not defer the human loss', () => {
    const state = buildHumanVsAis('human-and-ai-collapse', 1, [[500, 0], [500, 0]]);
    state.turn = 2;
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(true);
    expect(state.gameResult).toBe('loss');
    expect(state.endReason).toBe('reputation_collapse');
    // The human failure short-circuits before AI elimination.
    expect(state.players![1].eliminated ?? false).toBe(false);
  });

  it('eliminating the human directly is rejected by the elimination helper? (human seats end the game instead)', () => {
    // `eliminateCompetitiveSeat` is only invoked for AI failures; a human
    // failure is routed to the loss path. Verify the routing here.
    const state = buildHumanVsAis('human-route', 1, [[-1, 5], [500, 5]]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);
    expect(state.players![0].eliminated ?? false).toBe(false);
    expect(state.gameResult).toBe('loss');
  });
});

// ── AC5: no coins == 0 end condition ────────────────────────

describe('AC5 — no coins == 0 end condition', () => {
  it('competitive human at exactly 0 coins is not a loss', () => {
    const state = buildHumanVsAis('human-zero-coins', 1, [[0, 5], [500, 5]]);
    state.turn = 2;
    expect(checkCompetitiveSeatFailure(state)).toEqual([]);
    expect(resolveCompetitiveSeatFailures(state)).toBe(false);
    expect(state.gameResult).toBe('playing');
  });

  it('single-player at exactly 0 coins is not a loss', () => {
    const state = setupMainStreetGame({ seed: 'sp-zero-coins' });
    state.turn = 2;
    state.resourceBank.coins = 0;
    state.resourceBank.reputation = 5;
    const ended = checkCompetitiveEndConditions(state);
    expect(ended).toBe(false);
    expect(state.gameResult).toBe('playing');
  });
});

// ── AC4: single-player regression ───────────────────────────

describe('AC4 — single-player end conditions unchanged', () => {
  it('checkCompetitiveEndConditions delegates to checkEndConditions for no players[]', () => {
    const state = setupMainStreetGame({ seed: 'sp-delegate-bankrupt' });
    state.resourceBank.coins = -1;
    const ended = checkCompetitiveEndConditions(state);
    expect(ended).toBe(true);
    expect(state.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
  });

  it('single-player reputation collapse after turn 1 still fires', () => {
    const state = setupMainStreetGame({ seed: 'sp-delegate-rep' });
    state.turn = 2;
    state.resourceBank.reputation = 0;
    const ended = checkCompetitiveEndConditions(state);
    expect(ended).toBe(true);
    expect(state.endReason).toBe('reputation_collapse');
  });

  it('single-player win via score threshold is unchanged', () => {
    const state = setupMainStreetGame({ seed: 'sp-delegate-win' });
    state.config = { ...state.config, winThreshold: 5 };
    state.resourceBank.coins = 10;
    state.resourceBank.reputation = 10;
    const ended = checkCompetitiveEndConditions(state);
    expect(ended).toBe(true);
    expect(state.gameResult).toBe('win');
    expect(state.endReason).toBe('score_threshold');
  });
});

// ── AI-only collapse does not end the human game ────────────

describe('AI collapse does not end the human game (contrast)', () => {
  it('human healthy + AI collapse → game continues, AI eliminated', () => {
    const state = buildCompetitiveState({
      seed: 'contrast-ai',
      playerCount: 2,
      seatWallets: [
        { playerId: 0, coins: 500, reputation: 5 },
        { playerId: 1, coins: 500, reputation: 0 },
      ],
    });
    state.turn = 2;
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(false);
    expect(state.gameResult).toBe('playing');
    expect(state.players![1].eliminated).toBe(true);
  });

  it('eliminateCompetitiveSeat is a no-op on an already-eliminated seat', () => {
    const state = buildHumanVsAis('noop-elim', 1, [[500, 5], [500, 0]]);
    eliminateCompetitiveSeat(state, 1);
    const closed = eliminateCompetitiveSeat(state, 1);
    expect(closed).toBe(0);
  });
});
