/**
 * Main Street: Per-seat failure evaluation in competitive closing.
 *
 * Regression coverage for the defect where a failing AI seat ended the
 * whole human game because the closing tail read the shared
 * `state.resourceBank` scratch mirror (which, after driving the AI seats,
 * still held the last-acting AI's wallet).
 *
 * Parent: MS-0MUVBH589001L7NL (Competitive game ends on AI seat failure)
 *
 * AC1 — per-seat evaluation reads each PlayerRecord's coins/reputation.
 * AC2 — `checkImmediateLoss` unchanged for single-player.
 * AC3 — competitive closing tail uses the per-seat evaluation.
 * AC4 — regression: human healthy + AI reputation = 0 → not a loss.
 * AC5 — AI `coins < 0` (bankruptcy) is attributed per-seat.
 * AC6 — multi-AI: only the failing seat(s) are flagged.
 * AC7 — single-player tests remain green.
 *
 * @module tests/main-street/competitive-seat-failure
 */
import { describe, it, expect } from 'vitest';

import {
  buildCompetitiveState,
  buildHumanVsAis,
} from './helpers/competitive-fixtures';
import {
  bindCompetitiveSeat,
} from '../../src/MainStreetAiStrategy';
import {
  checkCompetitiveSeatFailure,
  resolveCompetitiveSeatFailures,
  checkImmediateLoss,
  executeCompetitiveWeekStart,
  endCompetitiveMarketTurn,
  resolveCompetitiveClosingPhases,
} from '../../src/MainStreetEngine';
import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';

// ── Helpers ─────────────────────────────────────────────────

/**
 * Drives a competitive state from WeekStart to InvestmentResolution so the
 * shared closing can run. The last seat is bound (mirroring the real
 * shared-day flow where the AI seats act last), which leaves the shared
 * `resourceBank` holding the last-acting seat's wallet.
 */
function driveToClosing(state: MainStreetState): void {
  executeCompetitiveWeekStart(state);
  const n = state.players!.length;
  for (let i = 0; i < n; i++) {
    endCompetitiveMarketTurn(state);
  }
  // Mirror the last-acting (AI) seat into the shared scratch bank, exactly
  // as `restoreCompetitiveSeat` leaves it after the AI seats have acted.
  bindCompetitiveSeat(state, n - 1);
}

// ── AC1: per-seat evaluation reads PlayerRecord ──────────────

describe('AC1 — checkCompetitiveSeatFailure reads each PlayerRecord', () => {
  it('returns no failures when every seat is solvent', () => {
    const state = buildCompetitiveState({
      seed: 'seat-ok',
      playerCount: 3,
      seatWallets: [
        { playerId: 0, coins: 100, reputation: 5 },
        { playerId: 1, coins: 50, reputation: 3 },
        { playerId: 2, coins: 10, reputation: 1 },
      ],
    });
    state.turn = 2;
    expect(checkCompetitiveSeatFailure(state)).toEqual([]);
  });

  it('flags an AI seat with reputation <= 0 after turn 1', () => {
    const state = buildHumanVsAis('seat-rep', 1, [[100, 5], [50, 0]]);
    state.turn = 2;
    const failures = checkCompetitiveSeatFailure(state);
    expect(failures).toEqual([{ playerId: 1, reason: 'reputation_collapse' }]);
  });

  it('does NOT flag reputation <= 0 on turn 1 (starting reputation)', () => {
    const state = buildHumanVsAis('seat-rep-t1', 1, [[100, 5], [50, 0]]);
    state.turn = 1;
    expect(checkCompetitiveSeatFailure(state)).toEqual([]);
  });

  it('flags an AI seat with coins < 0 (bankruptcy, any turn)', () => {
    const state = buildHumanVsAis('seat-bankrupt', 1, [[100, 5], [-1, 3]]);
    state.turn = 2;
    const failures = checkCompetitiveSeatFailure(state);
    expect(failures).toEqual([{ playerId: 1, reason: 'bankruptcy' }]);
  });

  it('does NOT flag coins == 0 (no coin-exhaustion end condition)', () => {
    const state = buildHumanVsAis('seat-zero-coins', 1, [[100, 5], [0, 3]]);
    state.turn = 2;
    expect(checkCompetitiveSeatFailure(state)).toEqual([]);
  });

  it('bankruptcy takes precedence over reputation collapse for the same seat', () => {
    const state = buildHumanVsAis('seat-both', 1, [[100, 5], [-1, 0]]);
    state.turn = 2;
    const failures = checkCompetitiveSeatFailure(state);
    expect(failures).toEqual([{ playerId: 1, reason: 'bankruptcy' }]);
  });

  it('returns empty for single-player state (no players[])', () => {
    const state = setupMainStreetGame({ seed: 'seat-single' });
    expect(checkCompetitiveSeatFailure(state)).toEqual([]);
  });
});

// ── AC6: multi-AI attribution ────────────────────────────────

describe('AC6 — multi-AI: only failing seats flagged', () => {
  it('flags only the collapsing AI in a 1H + 3AI game', () => {
    const state = buildHumanVsAis('seat-multi', 3, [
      [100, 5], // human healthy
      [100, 3], // AI healthy
      [100, 0], // AI collapsed
      [100, 2], // AI healthy
    ]);
    state.turn = 2;
    const failures = checkCompetitiveSeatFailure(state);
    expect(failures).toEqual([{ playerId: 2, reason: 'reputation_collapse' }]);
  });

  it('flags multiple failing AI seats independently', () => {
    const state = buildHumanVsAis('seat-multi-2', 3, [
      [100, 5],
      [100, 0],
      [-5, 3],
      [100, 2],
    ]);
    state.turn = 2;
    const failures = checkCompetitiveSeatFailure(state);
    expect(failures).toEqual([
      { playerId: 1, reason: 'reputation_collapse' },
      { playerId: 2, reason: 'bankruptcy' },
    ]);
  });

  it('flags the human seat too when it fails', () => {
    const state = buildHumanVsAis('seat-human-fail', 1, [[100, 0], [100, 5]]);
    state.turn = 2;
    const failures = checkCompetitiveSeatFailure(state);
    expect(failures).toEqual([{ playerId: 0, reason: 'reputation_collapse' }]);
  });
});

// ── resolveCompetitiveSeatFailures: human loss ───────────────

describe('resolveCompetitiveSeatFailures — human vs AI attribution', () => {
  it('ends the game when the human seat fails (reputation collapse)', () => {
    const state = buildHumanVsAis('resolve-human-rep', 1, [[100, 0], [100, 5]]);
    state.turn = 2;
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(true);
    expect(state.gameResult).toBe('loss');
    expect(state.endReason).toBe('reputation_collapse');
  });

  it('ends the game when the human seat goes bankrupt', () => {
    const state = buildHumanVsAis('resolve-human-bankrupt', 1, [[-3, 5], [100, 5]]);
    state.turn = 2;
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(true);
    expect(state.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
  });

  it('does NOT end the game when only an AI seat fails', () => {
    const state = buildHumanVsAis('resolve-ai-only', 1, [[100, 5], [100, 0]]);
    state.turn = 2;
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(false);
    expect(state.gameResult).toBe('playing');
    expect(state.endReason).toBeNull();
  });

  it('does NOT end the game when an AI is bankrupt but the human is solvent', () => {
    const state = buildHumanVsAis('resolve-ai-bankrupt', 1, [[100, 5], [-2, 3]]);
    state.turn = 2;
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(false);
    expect(state.gameResult).toBe('playing');
  });

  it('human failure wins over an AI failure in the same step', () => {
    const state = buildHumanVsAis('resolve-both-fail', 1, [[100, 0], [100, 0]]);
    state.turn = 2;
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(true);
    expect(state.gameResult).toBe('loss');
    expect(state.endReason).toBe('reputation_collapse');
  });
});

// ── AC4/AC5: regression through the shared closing ───────────

describe('AC4/AC5 — regression: AI failure does not end the human game', () => {
  it('human healthy + AI reputation = 0 → closing does NOT end in loss', () => {
    const state = buildHumanVsAis('regression-rep', 1, [[500, 5], [300, 0]]);
    state.turn = 2;
    driveToClosing(state);

    // The shared scratch bank mirrors the AI's collapsing wallet.
    expect(state.resourceBank.reputation).toBe(0);

    const result = resolveCompetitiveClosingPhases(state);
    expect(result.gameResult).not.toBe('loss');
    expect(state.endReason).not.toBe('reputation_collapse');
  });

  it('human healthy + AI coins < 0 → closing does NOT end in loss', () => {
    const state = buildHumanVsAis('regression-bankrupt', 1, [[500, 5], [-1, 3]]);
    state.turn = 2;
    driveToClosing(state);

    // The shared scratch bank mirrors the AI's bankrupt wallet.
    expect(state.resourceBank.coins).toBeLessThan(0);

    const result = resolveCompetitiveClosingPhases(state);
    expect(result.gameResult).not.toBe('loss');
    expect(state.endReason).not.toBe('bankruptcy');
  });

  it('human reputation = 0 → closing ends in loss (human collapse not swallowed)', () => {
    const state = buildHumanVsAis('regression-human', 1, [[500, 0], [300, 5]]);
    state.turn = 2;
    driveToClosing(state);

    const result = resolveCompetitiveClosingPhases(state);
    expect(result.gameResult).toBe('loss');
    expect(state.endReason).toBe('reputation_collapse');
  });
});

// ── AC2/AC7: single-player unchanged ─────────────────────────

describe('AC2/AC7 — single-player checkImmediateLoss unchanged', () => {
  it('flags bankruptcy for a single-player state with coins < 0', () => {
    const state = setupMainStreetGame({ seed: 'sp-bankrupt' });
    state.resourceBank.coins = -1;
    expect(checkImmediateLoss(state)).toBe(true);
    expect(state.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
  });

  it('flags reputation collapse for a single-player state after turn 1', () => {
    const state = setupMainStreetGame({ seed: 'sp-rep' });
    state.turn = 2;
    state.resourceBank.reputation = 0;
    expect(checkImmediateLoss(state)).toBe(true);
    expect(state.endReason).toBe('reputation_collapse');
  });

  it('does not flag reputation collapse on turn 1', () => {
    const state = setupMainStreetGame({ seed: 'sp-rep-t1' });
    state.turn = 1;
    state.resourceBank.reputation = 0;
    expect(checkImmediateLoss(state)).toBe(false);
  });

  it('does not flag coins == 0', () => {
    const state = setupMainStreetGame({ seed: 'sp-zero' });
    state.resourceBank.coins = 0;
    state.resourceBank.reputation = 5;
    state.turn = 2;
    expect(checkImmediateLoss(state)).toBe(false);
  });
});
