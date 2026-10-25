/**
 * Main Street: Completing all challenges is not a win condition
 * (MS-0MVAZH5OD000Q6E4).
 *
 * Regression net for the retired all-challenges win path. Completing every
 * active challenge must never end the game in either mode — it remains a
 * scoring bonus only (`challengeBonusPoints`), and play continues until the
 * score threshold (or an opt-in turn limit / loss condition).
 *
 * Coverage:
 * - AC1: single-player `checkEndConditions()` has no all-challenges win.
 * - AC2: competitive `checkCompetitiveEndConditions()` has no all-completed
 *   winner and never sets `competitiveWinnerId`.
 * - AC4: completed challenges still award the bonus and count toward score.
 * - The score threshold remains the win path once it is reached.
 *
 * @module tests/main-street/all-challenges-not-a-win
 */

import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import {
  checkEndConditions,
  checkCompetitiveEndConditions,
  updateScore,
} from '../../src/MainStreetEngine';
import { CHALLENGE_BONUS_POINTS } from '../../src/MainStreetCards';
import { CHALLENGE_TEMPLATES } from '../../src/MainStreetChallenges';
import { buildHumanVsAis, evaluateEndConditions } from './helpers/competitive-fixtures';

// ── Helpers ─────────────────────────────────────────────────

/** Two challenge ids guaranteed to exist in the catalogue. */
const CHALLENGE_IDS = ['ch-deep-pockets', 'ch-beloved-mayor'] as const;

/**
 * Marks the named challenges complete on the state (and records them in
 * `challengesCompleted`), optionally attributing each to a seat.
 */
function completeChallenges(
  state: MainStreetState,
  ids: readonly string[] = CHALLENGE_IDS,
  seatId?: number,
): void {
  state.activeChallenges = ids.map((id) => {
    const challenge = CHALLENGE_TEMPLATES.find((c) => c.id === id);
    if (!challenge) throw new Error(`Unknown challenge template: ${id}`);
    return seatId === undefined
      ? { challenge, completed: true }
      : { challenge, completed: true, completedBySeatId: seatId };
  });
  state.challengesCompleted = [...ids];
}

// ── AC1: single-player ──────────────────────────────────────

describe('single-player: all challenges complete is not a win (AC1)', () => {
  it('does not end the game when every active challenge is completed', () => {
    const state = setupMainStreetGame({ seed: 'no-win-single' });
    completeChallenges(state);
    // Keep score well below the threshold so only a challenge win could end it.
    state.resourceBank.coins = 10;
    state.resourceBank.reputation = 5;

    const ended = checkEndConditions(state);

    expect(ended).toBe(false);
    expect(state.gameResult).toBe('playing');
    expect(state.endReason).toBeNull();
  });

  it('still ends via the score threshold once it is reached after completion', () => {
    const state = setupMainStreetGame({ seed: 'no-win-then-threshold' });
    completeChallenges(state);
    state.resourceBank.coins = 10;
    state.resourceBank.reputation = 5;

    expect(checkEndConditions(state)).toBe(false);

    // Subsequent scoring crosses the threshold — the game then ends via the
    // score path, proving play continued past the completed challenge pool.
    state.resourceBank.coins = state.config.winThreshold;
    expect(checkEndConditions(state)).toBe(true);
    expect(state.gameResult).toBe('win');
    expect(state.endReason).toBe('score_threshold');
  });

  it('keeps awarding the challenge bonus toward the score (AC4)', () => {
    const state = setupMainStreetGame({ seed: 'no-win-bonus' });
    completeChallenges(state);
    state.resourceBank.coins = 10;
    state.resourceBank.reputation = 5;

    checkEndConditions(state);

    expect(state.finalScore).toBe(
      10 + 5 + CHALLENGE_IDS.length * CHALLENGE_BONUS_POINTS,
    );
  });
});

// ── AC2: competitive ────────────────────────────────────────

describe('competitive: all shared challenges complete is not a win (AC2)', () => {
  it('does not declare a winner when the shared pool empties', () => {
    // Large threshold keeps every seat far from the score race.
    const state = buildHumanVsAis('no-win-competitive', 1, [[10, 5], [10, 5]], 100000);
    completeChallenges(state, CHALLENGE_IDS, 0);

    const result = evaluateEndConditions(state);

    expect(result.ended).toBe(false);
    expect(result.gameResult).toBe('playing');
    expect(result.competitiveWinnerId).toBeNull();
  });

  it('leaves the score race as the win path once a seat reaches the threshold', () => {
    // base 100 / 2 seats → effective 50; the human at 60 coins wins.
    const state = buildHumanVsAis('no-win-then-race', 1, [[60, 5], [10, 5]], 100);
    completeChallenges(state, CHALLENGE_IDS, 0);

    const result = evaluateEndConditions(state);

    expect(result.ended).toBe(true);
    expect(result.gameResult).toBe('win');
    expect(result.endReason).toBe('score_threshold');
    expect(result.competitiveWinnerId).toBe(0);
  });

  it('credits the challenge bonus to the completing seat (AC4)', () => {
    const state = buildHumanVsAis('no-win-seat-bonus', 1, [[10, 5], [10, 5]], 100000);
    completeChallenges(state, ['ch-deep-pockets'], 1);

    checkCompetitiveEndConditions(state);
    updateScore(state);

    // Seat 1 completed the challenge; only it receives the bonus.
    expect(state.players![1].score).toBe(10 + 5 + CHALLENGE_BONUS_POINTS);
    expect(state.players![0].score).toBe(10 + 5);
  });
});
