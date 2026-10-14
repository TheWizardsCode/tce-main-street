/**
 * Main Street: Per-Seat Competitive Scoring Tests
 *
 * Unit tests for `updateCompetitiveScores` — verifying that each seat receives
 * challenge bonus points only for challenges it personally completed
 * (MS-0MUWNTJIK009O6BZ, Q2 = A).
 *
 * Coverage:
 *  1. `updateCompetitiveScores` awards `challengeBonusPoints` only for
 *     challenges where the seat's ID matches the `completedBySeatId`.
 *  2. A seat with no completed challenges receives no challenge bonus.
 *  3. A seat that completed N challenges receives N × challengeBonusPoints.
 *  4. Single-player scoring remains unchanged (global
 *     challengesCompleted.length × challengeBonusPoints).
 *  5. Per-seat scoring is consistent with attribution records from the
 *     challenge evaluation path.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import {
  createCompetitiveState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  computeScore,
  updateCompetitiveScores,
} from '../../src/MainStreetEngineScoring';
import {
  CHALLENGE_TEMPLATES,
  evaluateChallenges,
  type ActiveChallenge,
} from '../../src/MainStreetChallenges';

// ── Helpers ─────────────────────────────────────────────────

/** Finds a challenge template by ID (throws if missing). */
function template(id: string): ActiveChallenge['challenge'] {
  const t = CHALLENGE_TEMPLATES.find(c => c.id === id);
  if (!t) throw new Error(`Challenge template '${id}' not found`);
  return t;
}

/**
 * Activates a set of challenges (all incomplete, no attribution) for the
 * given competitive state.
 */
function activate(state: MainStreetState, ...ids: string[]): void {
  state.activeChallenges = ids.map(id => ({
    challenge: template(id),
    completed: false,
  }));
}

/** A 2-seat competitive state: seat 0 is human, seat 1 is AI. */
function competitiveState(seed: string): MainStreetState {
  return createCompetitiveState({ seed, playerCount: 2 });
}

/**
 * Finds the ActiveChallenge record for a challenge id (throws if missing).
 */
function record(state: MainStreetState, id: string): ActiveChallenge {
  const ac = state.activeChallenges.find(c => c.challenge.id === id);
  if (!ac) throw new Error(`Active challenge '${id}' not found`);
  return ac;
}

// ── AC1: awards bonus only for seat's own completions ───────

describe('AC1 · per-seat bonus attribution', () => {
  it('seat 0 gets bonus only for challenges it completed, not seat 1', () => {
    const s = competitiveState('ac1-own-completions');
    activate(s, 'ch-deep-pockets', 'ch-beloved-mayor');
    // Seat 0 completes deep-pockets
    record(s, 'ch-deep-pockets').completed = true;
    record(s, 'ch-deep-pockets').completedBySeatId = 0;
    // Seat 1 completes beloved-mayor
    record(s, 'ch-beloved-mayor').completed = true;
    record(s, 'ch-beloved-mayor').completedBySeatId = 1;

    s.players![0].coins = 100;
    s.players![0].reputation = 10;
    s.players![1].coins = 200;
    s.players![1].reputation = 20;

    updateCompetitiveScores(s);

    const bonus = s.config.challengeBonusPoints;
    expect(s.players![0].score).toBe(100 + 10 + bonus); // 1 own
    expect(s.players![1].score).toBe(200 + 20 + bonus); // 1 own
  });
});

// ── AC2: seat with no completions gets no bonus ──────────────

describe('AC2 · no completions → no bonus', () => {
  it('seat with zero attributed completions receives no challenge bonus', () => {
    const s = competitiveState('ac2-zero');
    activate(s, 'ch-deep-pockets');
    // Only seat 1 completes it
    record(s, 'ch-deep-pockets').completed = true;
    record(s, 'ch-deep-pockets').completedBySeatId = 1;

    s.players![0].coins = 50;
    s.players![0].reputation = 5;
    s.players![1].coins = 50;
    s.players![1].reputation = 5;

    updateCompetitiveScores(s);

    expect(s.players![0].score).toBe(50 + 5 + 0); // no bonus
    expect(s.players![1].score).toBe(50 + 5 + s.config.challengeBonusPoints);
  });

  it('seat that never completed anything gets score = coins + rep', () => {
    const s = competitiveState('ac2-nothing');
    // No active challenges at all
    activate(s);

    s.players![0].coins = 100;
    s.players![0].reputation = 0;
    s.players![1].coins = 100;
    s.players![1].reputation = 0;

    updateCompetitiveScores(s);

    expect(s.players![0].score).toBe(100 + 0 + 0);
    expect(s.players![1].score).toBe(100 + 0 + 0);
  });
});

// ── AC3: N completions → N × bonus ──────────────────────────

describe('AC3 · N completions → N × bonus', () => {
  it('seat with 2 completed challenges gets 2 × bonus', () => {
    const s = competitiveState('ac3-two');
    activate(s, 'ch-deep-pockets', 'ch-beloved-mayor');
    // Both completed by seat 0
    record(s, 'ch-deep-pockets').completed = true;
    record(s, 'ch-deep-pockets').completedBySeatId = 0;
    record(s, 'ch-beloved-mayor').completed = true;
    record(s, 'ch-beloved-mayor').completedBySeatId = 0;

    s.players![0].coins = 0;
    s.players![0].reputation = 0;
    s.players![1].coins = 0;
    s.players![1].reputation = 0;

    updateCompetitiveScores(s);

    const bonus = s.config.challengeBonusPoints;
    expect(s.players![0].score).toBe(bonus * 2); // 2 completions
    expect(s.players![1].score).toBe(0); // no completions
  });

  it('each seat counts only its own completions across multiple challenges', () => {
    const s = competitiveState('ac3-mixed');
    activate(s, 'ch-deep-pockets', 'ch-beloved-mayor', 'ch-foodie-row');
    // Seat 0: 2 completions; Seat 1: 1 completion
    record(s, 'ch-deep-pockets').completed = true;
    record(s, 'ch-deep-pockets').completedBySeatId = 0;
    record(s, 'ch-beloved-mayor').completed = true;
    record(s, 'ch-beloved-mayor').completedBySeatId = 0;
    record(s, 'ch-foodie-row').completed = true;
    record(s, 'ch-foodie-row').completedBySeatId = 1;

    s.players![0].coins = 0;
    s.players![0].reputation = 0;
    s.players![1].coins = 0;
    s.players![1].reputation = 0;

    updateCompetitiveScores(s);

    const bonus = s.config.challengeBonusPoints;
    expect(s.players![0].score).toBe(bonus * 2);
    expect(s.players![1].score).toBe(bonus * 1);
  });
});

// ── AC4: single-player unchanged ────────────────────────────

describe('AC4 · single-player unchanged', () => {
  it('computeScore uses challengesCompleted.length × bonus for single-player', () => {
    const s = setupMainStreetGame({ seed: 'ac4-single' });
    s.challengesCompleted = ['c1', 'c2', 'c3'];

    const score = computeScore(s);
    const bonus = s.config.challengeBonusPoints;
    expect(score).toBe(s.ledger.get('coins') + s.ledger.get('reputation') + 3 * bonus);
  });

  it('updateCompetitiveScores delegates to updateScore when no players[]', () => {
    const s = setupMainStreetGame({ seed: 'ac4-delegate' });
    s.challengesCompleted = ['x1', 'x2'];
    s.resourceBank.coins = 100;
    s.resourceBank.reputation = 50;

    updateCompetitiveScores(s);

    expect(s.finalScore).toBe(computeScore(s));
    expect(s.finalScore).toBe(100 + 50 + 2 * s.config.challengeBonusPoints);
  });
});

// ── AC5: consistency with attribution records ────────────────

describe('AC5 · consistency with attribution', () => {
  it('scores match the attribution set by evaluateChallenges', () => {
    const s = competitiveState('ac5-consistency');
    activate(s, 'ch-deep-pockets');
    s.resourceBank.coins = 3000;

    // Have the engine attribute the completion
    const newlyCompleted = evaluateChallenges(
      s.activeChallenges,
      s,
      0, // seat 0
    );

    expect(newlyCompleted).toEqual(['ch-deep-pockets']);
    expect(record(s, 'ch-deep-pockets').completedBySeatId).toBe(0);

    s.players![0].coins = 100;
    s.players![0].reputation = 50;
    s.players![1].coins = 200;
    s.players![1].reputation = 30;

    updateCompetitiveScores(s);

    const bonus = s.config.challengeBonusPoints;
    expect(s.players![0].score).toBe(100 + 50 + bonus); // own completion
    expect(s.players![1].score).toBe(200 + 30 + 0); // no completion
  });

  it('mixed completions via evaluation path produce consistent scores', () => {
    const s = competitiveState('ac5-mixed-eval');
    activate(s, 'ch-deep-pockets', 'ch-beloved-mayor');

    // Seat 0 completes deep-pockets (coins threshold)
    s.resourceBank.coins = 3000;
    s.resourceBank.reputation = 0;
    evaluateChallenges(s.activeChallenges, s, 0);
    expect(record(s, 'ch-deep-pockets').completedBySeatId).toBe(0);

    // Seat 1 completes beloved-mayor (reputation threshold)
    s.resourceBank.coins = 0;
    s.resourceBank.reputation = 1000;
    evaluateChallenges(s.activeChallenges, s, 1);
    expect(record(s, 'ch-beloved-mayor').completedBySeatId).toBe(1);

    s.players![0].coins = 0;
    s.players![0].reputation = 0;
    s.players![1].coins = 0;
    s.players![1].reputation = 0;

    updateCompetitiveScores(s);

    const bonus = s.config.challengeBonusPoints;
    expect(s.players![0].score).toBe(bonus); // 1 own completion (deep-pockets)
    expect(s.players![1].score).toBe(bonus); // 1 own completion (beloved-mayor)
  });
});
