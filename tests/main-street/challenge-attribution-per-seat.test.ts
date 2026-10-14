/**
 * Main Street: Per-Seat Challenge Completion Attribution
 *
 * Unit tests for attributing each challenge completion to the seat that
 * performed the completing action (`ActiveChallenge.completedBySeatId`),
 * as decided by the parent intake (MS-0MUWNTJIK009O6BZ, Q1 = B: one shared
 * challenge pool, each completion credited to the completing seat).
 *
 * Coverage:
 *  1. An AI seat's evaluation records the AI seat id.
 *  2. The human seat's evaluation records the human seat id.
 *  3. First-write wins: a completed challenge is never re-credited to
 *     another seat (idempotent, `completed` remains the source of truth).
 *  4. Single-player / legacy runs (no seat context) default to `null`/absent.
 *  5. Only the challenge(s) actually completed by a call gain an attribution.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import {
  setupMainStreetGame,
  createCompetitiveState,
  type MainStreetState,
} from '../../src/MainStreetState';
import { findHumanSeatId } from '../../src/MainStreetEngine';
import {
  CHALLENGE_TEMPLATES,
  evaluateChallenges,
  evaluateChallengesAfterAction,
  type ActiveChallenge,
} from '../../src/MainStreetChallenges';

// ── Helpers ─────────────────────────────────────────────────

/** Finds a challenge template by ID (throws if missing). */
function template(id: string): ActiveChallenge['challenge'] {
  const t = CHALLENGE_TEMPLATES.find(c => c.id === id);
  if (!t) throw new Error(`Challenge template '${id}' not found`);
  return t;
}

/** Replaces the active challenges with the given IDs (all incomplete). */
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

/** The `ActiveChallenge` record for a challenge id (throws if missing). */
function record(state: MainStreetState, id: string): ActiveChallenge {
  const ac = state.activeChallenges.find(c => c.challenge.id === id);
  if (!ac) throw new Error(`Active challenge '${id}' not found`);
  return ac;
}

// ── AC1 · AI seat attribution ───────────────────────────────

describe('per-seat attribution · AI seat', () => {
  it('records the AI seat id when an AI evaluation completes a resource challenge', () => {
    const state = competitiveState('attribution-ai');
    const aiSeatId = 1;
    expect(state.players![aiSeatId].controller).toBe('ai');

    activate(state, 'ch-deep-pockets');
    state.resourceBank.coins = 3000;

    const newlyCompleted = evaluateChallenges(
      state.activeChallenges,
      state,
      aiSeatId,
    );

    expect(newlyCompleted).toEqual(['ch-deep-pockets']);
    expect(record(state, 'ch-deep-pockets').completed).toBe(true);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(aiSeatId);
  });

  it('attributes the active seat through the per-action evaluation path', () => {
    const state = competitiveState('attribution-ai-action');
    const aiSeatId = 1;
    state.activePlayerId = aiSeatId;
    activate(state, 'ch-deep-pockets');
    state.resourceBank.coins = 3000;

    const newlyCompleted = evaluateChallengesAfterAction(state);

    expect(newlyCompleted).toEqual(['ch-deep-pockets']);
    expect(state._newlyCompletedThisAction).toEqual(['ch-deep-pockets']);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(aiSeatId);
  });
});

// ── AC2 · Human seat attribution ────────────────────────────

describe('per-seat attribution · human seat', () => {
  it('records the human seat id when the human evaluation completes a challenge', () => {
    const state = competitiveState('attribution-human');
    const humanSeatId = findHumanSeatId(state);
    expect(humanSeatId).toBe(0);

    activate(state, 'ch-beloved-mayor');
    state.resourceBank.reputation = 1000;

    const newlyCompleted = evaluateChallenges(
      state.activeChallenges,
      state,
      humanSeatId,
    );

    expect(newlyCompleted).toEqual(['ch-beloved-mayor']);
    expect(record(state, 'ch-beloved-mayor').completedBySeatId).toBe(humanSeatId);
  });

  it('attributes the human active seat through the per-action evaluation path', () => {
    const state = competitiveState('attribution-human-action');
    const humanSeatId = findHumanSeatId(state);
    state.activePlayerId = humanSeatId;
    activate(state, 'ch-beloved-mayor');
    state.resourceBank.reputation = 1000;

    const newlyCompleted = evaluateChallengesAfterAction(state);

    expect(newlyCompleted).toEqual(['ch-beloved-mayor']);
    expect(record(state, 'ch-beloved-mayor').completedBySeatId).toBe(humanSeatId);
  });
});

// ── AC3/AC5 · First-write wins (idempotent completion) ──────

describe('per-seat attribution · first completion wins', () => {
  it('never re-credits a challenge already completed by another seat', () => {
    const state = competitiveState('attribution-idempotent');
    activate(state, 'ch-deep-pockets');
    state.resourceBank.coins = 3000;

    const aiSeatId = 1;
    const humanSeatId = findHumanSeatId(state);

    // AI seat completes it first.
    expect(evaluateChallenges(state.activeChallenges, state, aiSeatId)).toEqual([
      'ch-deep-pockets',
    ]);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(aiSeatId);

    // The human's later evaluation must not re-complete or re-credit it.
    expect(evaluateChallenges(state.activeChallenges, state, humanSeatId)).toEqual([]);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(aiSeatId);
    expect(
      state.challengesCompleted.filter(id => id === 'ch-deep-pockets'),
    ).toHaveLength(1);
  });

  it('keeps the attribution when the condition later stops being satisfied (no revocation)', () => {
    const state = competitiveState('attribution-no-revoke');
    activate(state, 'ch-deep-pockets');
    state.resourceBank.coins = 3000;

    const aiSeatId = 1;
    evaluateChallenges(state.activeChallenges, state, aiSeatId);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(aiSeatId);

    // Drop below the threshold; a re-evaluation must not revoke nor reassign.
    state.resourceBank.coins = 5;
    expect(
      evaluateChallenges(state.activeChallenges, state, findHumanSeatId(state)),
    ).toEqual([]);
    expect(record(state, 'ch-deep-pockets').completed).toBe(true);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(aiSeatId);
  });

  it('relies on the completed flag: a pre-completed record is never attributed', () => {
    const state = competitiveState('attribution-flag-truth');
    state.activeChallenges = [
      { challenge: template('ch-deep-pockets'), completed: true },
    ];
    state.resourceBank.coins = 3000;

    // Even though the condition holds and a seat is supplied, the record is
    // already flagged completed, so evaluation does not run or attribute it.
    expect(evaluateChallenges(state.activeChallenges, state, 1)).toEqual([]);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBeUndefined();
  });
});

// ── AC4 · Single-player / legacy default ────────────────────

describe('per-seat attribution · single-player default', () => {
  it('leaves attribution absent before completion and null when no seat context exists', () => {
    const state = setupMainStreetGame({ seed: 'attribution-single-player' });
    activate(state, 'ch-deep-pockets');

    // Absent while incomplete.
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBeUndefined();

    state.resourceBank.coins = 3000;
    const newlyCompleted = evaluateChallenges(state.activeChallenges, state);

    expect(newlyCompleted).toEqual(['ch-deep-pockets']);
    expect(record(state, 'ch-deep-pockets').completed).toBe(true);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBeNull();
  });

  it('defaults the per-action path to null when the state has no seat context', () => {
    const state = setupMainStreetGame({ seed: 'attribution-single-player-action' });
    activate(state, 'ch-beloved-mayor');
    state.resourceBank.reputation = 1000;

    expect(evaluateChallengesAfterAction(state)).toEqual(['ch-beloved-mayor']);
    expect(record(state, 'ch-beloved-mayor').completedBySeatId).toBeNull();
  });
});

// ── AC1/AC2 · Independent per-seat credit ───────────────────

describe('per-seat attribution · independent credit', () => {
  it('attributes only the challenge each seat actually completes', () => {
    const state = competitiveState('attribution-independent');
    const aiSeatId = 1;
    const humanSeatId = findHumanSeatId(state);
    activate(state, 'ch-deep-pockets', 'ch-beloved-mayor');

    // AI seat satisfies Deep Pockets first (coins high, reputation low).
    state.resourceBank.coins = 3000;
    state.resourceBank.reputation = 0;
    expect(evaluateChallenges(state.activeChallenges, state, aiSeatId)).toEqual([
      'ch-deep-pockets',
    ]);

    // Human seat then satisfies Beloved Mayor.
    state.resourceBank.reputation = 1000;
    expect(evaluateChallenges(state.activeChallenges, state, humanSeatId)).toEqual([
      'ch-beloved-mayor',
    ]);

    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(aiSeatId);
    expect(record(state, 'ch-beloved-mayor').completedBySeatId).toBe(humanSeatId);
    // Nothing else in the pool was touched.
    expect(state.challengesCompleted).toEqual([
      'ch-deep-pockets',
      'ch-beloved-mayor',
    ]);
  });
});
