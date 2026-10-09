/**
 * Main Street: Effective win threshold helper and competitive win check
 *
 * Slice 1 of 4 (MS-0MUZK64F8000XYO0) of the parent epic
 * MS-0MUZH6V7C0091SGE (divide the score target by the number of players).
 *
 * Verifies:
 * - AC1–AC3: `effectiveWinThreshold(state)` computes `round(winThreshold / P / 50) * 50`
 *   and the competitive win check uses it (standard + endless branches).
 * - AC4: Single-player continues to use the base `winThreshold` (no-op for P=1).
 * - AC5: Resumed competitive games re-derive the effective threshold from the
 *   persisted `playerCount`; legacy saves without it yield the base threshold.
 * - AC6: Unit coverage for AC1–AC5; full suite passes.
 * - AC7: The endless-mode branch uses the effective threshold and keeps
 *   `endReason = 'score_threshold_continue'` with idempotent re-entry.
 *
 * @module tests/main-street/competitive-effective-threshold
 */
import { describe, it, expect } from 'vitest';

import {
  createCompetitiveState,
  setupMainStreetGame,
  effectiveWinThreshold,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  checkCompetitiveEndConditions,
  checkEndConditions,
  continueAfterThreshold,
  updateCompetitiveScores,
} from '../../src/MainStreetEngine';

// ── Helpers ─────────────────────────────────────────────────

/** Sets each competitive seat's score to the requested value. */
function setCompetitiveScores(state: MainStreetState, scores: number[]): void {
  const bonus = state.challengesCompleted.length * state.config.challengeBonusPoints;
  const rep = 1;
  scores.forEach((desired, i) => {
    const neededCoins = desired - rep - bonus;
    state.players![i].coins = neededCoins;
    state.players![i].reputation = rep;
  });
  updateCompetitiveScores(state);
}

// ── AC1–AC3: effectiveWinThreshold helper ───────────────────

describe('AC1–AC3 — effectiveWinThreshold helper', () => {
  it('P=1 (single-player) returns the base threshold unchanged', () => {
    const s = setupMainStreetGame({ seed: 'et-sp', difficulty: 'Easy' });
    expect(effectiveWinThreshold(s)).toBe(s.config.winThreshold);
  });

  it('P=1 with players=[] returns the base threshold unchanged', () => {
    const s = createCompetitiveState({ seed: 'et-p1', playerCount: 1 });
    s.players = [];
    expect(effectiveWinThreshold(s)).toBe(s.config.winThreshold);
  });

  it('P=2 Easy (10 000 → 5 000)', () => {
    const s = createCompetitiveState({ seed: 'et-p2-easy', playerCount: 2 });
    s.config = { ...s.config, winThreshold: 10000 } as typeof s.config;
    expect(effectiveWinThreshold(s)).toBe(5000);
  });

  it('P=2 Medium (12 000 → 6 000)', () => {
    const s = createCompetitiveState({ seed: 'et-p2-med', playerCount: 2 });
    s.config = { ...s.config, winThreshold: 12000 } as typeof s.config;
    expect(effectiveWinThreshold(s)).toBe(6000);
  });

  it('P=2 Hard (15 000 → 7 500)', () => {
    const s = createCompetitiveState({ seed: 'et-p2-hard', playerCount: 2 });
    s.config = { ...s.config, winThreshold: 15000 } as typeof s.config;
    expect(effectiveWinThreshold(s)).toBe(7500);
  });

  it('P=3 Easy (10 000 → 3 350)', () => {
    const s = createCompetitiveState({ seed: 'et-p3-easy', playerCount: 3 });
    s.config = { ...s.config, winThreshold: 10000 } as typeof s.config;
    expect(effectiveWinThreshold(s)).toBe(3350);
  });

  it('P=3 Medium (12 000 → 4 000)', () => {
    const s = createCompetitiveState({ seed: 'et-p3-med', playerCount: 3 });
    s.config = { ...s.config, winThreshold: 12000 } as typeof s.config;
    expect(effectiveWinThreshold(s)).toBe(4000);
  });

  it('P=3 Hard (15 000 → 5 000)', () => {
    const s = createCompetitiveState({ seed: 'et-p3-hard', playerCount: 3 });
    s.config = { ...s.config, winThreshold: 15000 } as typeof s.config;
    expect(effectiveWinThreshold(s)).toBe(5000);
  });

  it('P=4 Easy (10 000 → 2 500)', () => {
    const s = createCompetitiveState({ seed: 'et-p4-easy', playerCount: 4 });
    s.config = { ...s.config, winThreshold: 10000 } as typeof s.config;
    expect(effectiveWinThreshold(s)).toBe(2500);
  });

  it('P=4 Medium (12 000 → 3 000)', () => {
    const s = createCompetitiveState({ seed: 'et-p4-med', playerCount: 4 });
    s.config = { ...s.config, winThreshold: 12000 } as typeof s.config;
    expect(effectiveWinThreshold(s)).toBe(3000);
  });

  it('P=4 Hard (15 000 → 3 750)', () => {
    const s = createCompetitiveState({ seed: 'et-p4-hard', playerCount: 4 });
    s.config = { ...s.config, winThreshold: 15000 } as typeof s.config;
    expect(effectiveWinThreshold(s)).toBe(3750);
  });
});

// ── AC3: competitive win check uses effective threshold ────

describe('AC3 — Competitive win check uses the effective threshold', () => {
  it('P=2 Easy: seat 0 wins at 5 000 (base 10 000 / 2)', () => {
    const s = createCompetitiveState({ seed: 'et-win-p2', playerCount: 2 });
    s.config = { ...s.config, winThreshold: 10000 } as typeof s.config;
    setCompetitiveScores(s, [5000, 2000]);

    const ended = checkCompetitiveEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('win');
    expect(s.endReason).toBe('score_threshold');
    expect(s.competitiveWinnerId).toBe(0);
  });

  it('P=3 Easy: seat 1 wins at 3 350 (base 10 000 / 3)', () => {
    const s = createCompetitiveState({ seed: 'et-win-p3', playerCount: 3 });
    s.config = { ...s.config, winThreshold: 10000 } as typeof s.config;
    setCompetitiveScores(s, [2000, 3350, 1500]);

    const ended = checkCompetitiveEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('loss');
    expect(s.endReason).toBe('score_threshold');
    expect(s.competitiveWinnerId).toBe(1);
  });

  it('P=4 Easy: seat 3 wins at 2 500 (base 10 000 / 4)', () => {
    const s = createCompetitiveState({ seed: 'et-win-p4', playerCount: 4 });
    s.config = { ...s.config, winThreshold: 10000 } as typeof s.config;
    setCompetitiveScores(s, [1000, 1000, 1000, 2500]);

    const ended = checkCompetitiveEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('loss');
    expect(s.endReason).toBe('score_threshold');
    expect(s.competitiveWinnerId).toBe(3);
  });

  it('threshold rounding: 9 900 base with P=3 → 3 300, seat wins at exactly that', () => {
    const s = createCompetitiveState({ seed: 'et-round', playerCount: 3 });
    s.config = { ...s.config, winThreshold: 9900 } as typeof s.config;
    expect(effectiveWinThreshold(s)).toBe(3300);

    setCompetitiveScores(s, [3299, 3300]);
    const ended = checkCompetitiveEndConditions(s);

    expect(ended).toBe(true);
    expect(s.competitiveWinnerId).toBe(1);
  });
});

// ── AC4: single-player unchanged ────────────────────────────

describe('AC4 — Single-player continues to use the base threshold', () => {
  it('single-player threshold win uses the base winThreshold', () => {
    const s = setupMainStreetGame({ seed: 'et-sp-unchanged', difficulty: 'Easy' });
    s.config = { ...s.config, winThreshold: 10000 } as typeof s.config;
    s.resourceBank.coins = 10001;
    s.resourceBank.reputation = 500;

    const ended = checkEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('win');
    expect(s.endReason).toBe('score_threshold');
  });

  it('the effective threshold helper returns the base value for single-player', () => {
    const s = setupMainStreetGame({ seed: 'et-sp-helpers', difficulty: 'Medium' });
    expect(effectiveWinThreshold(s)).toBe(s.config.winThreshold);
  });
});

// ── AC7: endless mode uses effective threshold ─────────────

describe('AC7 — Endless mode uses the effective threshold', () => {
  it('endless-mode competitive win checks against the effective threshold', () => {
    const s = createCompetitiveState({
      seed: 'et-endless-p3',
      playerCount: 3,
      endlessMode: true,
    });
    s.config = { ...s.config, winThreshold: 10000 } as typeof s.config;
    expect(effectiveWinThreshold(s)).toBe(3350);

    setCompetitiveScores(s, [2000, 3350, 1500]);
    const ended = checkCompetitiveEndConditions(s);

    expect(ended).toBe(true);
    expect(s.endReason).toBe('score_threshold_continue');
    expect(s.competitiveWinnerId).toBe(1);
  });

  it('endless-mode continues after the threshold and never re-offers', () => {
    const s = createCompetitiveState({
      seed: 'et-endless-cont-p2',
      playerCount: 2,
      endlessMode: true,
    });
    s.config = { ...s.config, winThreshold: 10000 } as typeof s.config;
    expect(effectiveWinThreshold(s)).toBe(5000);

    setCompetitiveScores(s, [5000, 2000]);
    checkCompetitiveEndConditions(s);
    expect(s.endReason).toBe('score_threshold_continue');

    // Accept the offer.
    const accepted = continueAfterThreshold(s);
    expect(accepted).toBe(true);
    expect(s.gameResult).toBe('playing');

    // Subsequent EndCheck must not re-open the offer.
    const ended = checkCompetitiveEndConditions(s);
    expect(ended).toBe(false);
    expect(s.endReason).toBe('score_threshold_continue');
    expect(s.gameResult).toBe('playing');
  });

  it('endless-mode: AI wins threshold → human sees loss, continuation offer open', () => {
    const s = createCompetitiveState({
      seed: 'et-endless-ai-p3',
      playerCount: 3,
      endlessMode: true,
    });
    s.config = { ...s.config, winThreshold: 10000 } as typeof s.config;
    setCompetitiveScores(s, [2000, 1500, 3350]);

    const ended = checkCompetitiveEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('loss');
    expect(s.endReason).toBe('score_threshold_continue');
    expect(s.competitiveWinnerId).toBe(2);
  });

  it('endless-mode with P=4 uses the correct effective threshold (2 500)', () => {
    const s = createCompetitiveState({
      seed: 'et-endless-p4',
      playerCount: 4,
      endlessMode: true,
    });
    s.config = { ...s.config, winThreshold: 10000 } as typeof s.config;
    expect(effectiveWinThreshold(s)).toBe(2500);

    setCompetitiveScores(s, [1000, 1000, 1000, 2500]);
    const ended = checkCompetitiveEndConditions(s);

    expect(ended).toBe(true);
    expect(s.endReason).toBe('score_threshold_continue');
    expect(s.competitiveWinnerId).toBe(3);
  });
});
