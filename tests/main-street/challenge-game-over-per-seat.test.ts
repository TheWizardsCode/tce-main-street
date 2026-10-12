/**
 * Main Street: Per-Seat Game Over Challenge Breakdown
 *
 * Unit tests for the Game Over summary's per-seat challenge breakdown
 * (MS-0MUWNTJIK009O6BZ, Q1 = B / Q3 = A): in competitive mode
 * `buildGameOverChallengeSummary` attributes each completed challenge to the
 * seat recorded on `ActiveChallenge.completedBySeatId`, while single-player
 * retains the run-global single-list format.
 *
 * Coverage:
 *  1. Competitive mode returns one breakdown entry per seat (human + AIs),
 *     labelled and flagged by `buildCompetitiveScoreboard`.
 *  2. Each seat's breakdown lists only the challenges that seat completed.
 *  3. `completedChallengeIds` is exposed per seat in competitive mode.
 *  4. The run-global `items` / `completedCount` / `totalCount` /
 *     `completedChallengeIds` remain the union across seats.
 *  5. Incomplete and unattributed (legacy) completions are credited to no
 *     seat.
 *  6. Single-player mode retains the existing single-list format (`seats`
 *     absent).
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
  CHALLENGE_TEMPLATES,
  type ActiveChallenge,
} from '../../src/MainStreetChallenges';
import { buildGameOverChallengeSummary } from '../../src/scenes/MainStreetGameOverSummary';

// ── Helpers ─────────────────────────────────────────────────

/** Finds a challenge template by ID (throws if missing). */
function template(id: string): ActiveChallenge['challenge'] {
  const t = CHALLENGE_TEMPLATES.find(c => c.id === id);
  if (!t) throw new Error(`Challenge template '${id}' not found`);
  return t;
}

/**
 * Builds an `ActiveChallenge` record for a template id.
 *
 * `seatId` is only written when supplied, so omitting it models a legacy /
 * unattributed completion (`completedBySeatId` absent).
 */
function active(
  id: string,
  completed: boolean,
  seatId?: number | null,
): ActiveChallenge {
  const record: ActiveChallenge = { challenge: template(id), completed };
  if (seatId !== undefined) record.completedBySeatId = seatId;
  return record;
}

/** A competitive state with `playerCount` seats (seat 0 is human). */
function competitiveState(seed: string, playerCount = 2): MainStreetState {
  return createCompetitiveState({ seed, playerCount });
}

// ── AC1/AC2 · Competitive per-seat breakdown ────────────────

describe('buildGameOverChallengeSummary · competitive per-seat breakdown', () => {
  it('returns one breakdown entry per seat, labelled human vs AI', () => {
    const state = competitiveState('go-per-seat-layout');
    state.activeChallenges = [
      active('ch-deep-pockets', true, 1),
      active('ch-beloved-mayor', true, 0),
    ];
    state.challengesCompleted = ['ch-deep-pockets', 'ch-beloved-mayor'];

    const summary = buildGameOverChallengeSummary(state);

    expect(summary.seats).toBeDefined();
    expect(summary.seats!.map(seat => seat.playerId)).toEqual([0, 1]);
    const [human, ai] = summary.seats!;
    expect(human.isHuman).toBe(true);
    expect(human.label).toBe('You');
    expect(ai.isHuman).toBe(false);
    expect(ai.label).toBe('AI 1');
  });

  it('lists only the challenges each seat completed', () => {
    const state = competitiveState('go-per-seat-only-own');
    state.activeChallenges = [
      active('ch-deep-pockets', true, 1),
      active('ch-beloved-mayor', true, 0),
    ];
    state.challengesCompleted = ['ch-deep-pockets', 'ch-beloved-mayor'];

    const [human, ai] = buildGameOverChallengeSummary(state).seats!;

    expect(human.completedChallengeIds).toEqual(['ch-beloved-mayor']);
    expect(human.completedTitles).toEqual(['Beloved Mayor']);
    expect(ai.completedChallengeIds).toEqual(['ch-deep-pockets']);
    expect(ai.completedTitles).toEqual(['Deep Pockets']);
  });

  it('exposes completedChallengeIds per seat across three seats', () => {
    const state = competitiveState('go-per-seat-three', 3);
    state.activeChallenges = [
      active('ch-beloved-mayor', true, 0),
      active('ch-deep-pockets', true, 2),
    ];
    state.challengesCompleted = ['ch-beloved-mayor', 'ch-deep-pockets'];

    const { seats } = buildGameOverChallengeSummary(state);

    expect(seats!.map(seat => [seat.playerId, seat.completedChallengeIds])).toEqual([
      [0, ['ch-beloved-mayor']],
      [1, []],
      [2, ['ch-deep-pockets']],
    ]);
  });

  it('keeps the run-global totals as the union across seats', () => {
    const state = competitiveState('go-per-seat-union');
    state.activeChallenges = [
      active('ch-deep-pockets', true, 1),
      active('ch-beloved-mayor', true, 0),
      active('ch-foodie-row', false),
    ];
    state.challengesCompleted = ['ch-deep-pockets', 'ch-beloved-mayor'];

    const summary = buildGameOverChallengeSummary(state);

    expect(summary.items).toEqual([
      { title: 'Deep Pockets', completed: true },
      { title: 'Beloved Mayor', completed: true },
      { title: 'Foodie Row', completed: false },
    ]);
    expect(summary.completedCount).toBe(2);
    expect(summary.totalCount).toBe(3);
    expect(summary.completedChallengeIds).toEqual([
      'ch-deep-pockets',
      'ch-beloved-mayor',
    ]);
  });
});

// ── AC3 · Attribution is the source of truth ────────────────

describe('buildGameOverChallengeSummary · attribution gating', () => {
  it('credits neither seat for incomplete or unattributed completions', () => {
    const state = competitiveState('go-per-seat-unattributed');
    state.activeChallenges = [
      active('ch-deep-pockets', true, 1),
      active('ch-beloved-mayor', false),
      // Completed but legacy / unattributed: no seat may claim it.
      active('ch-foodie-row', true),
    ];
    state.challengesCompleted = ['ch-deep-pockets', 'ch-foodie-row'];

    const [human, ai] = buildGameOverChallengeSummary(state).seats!;

    expect(human.completedChallengeIds).toEqual([]);
    expect(ai.completedChallengeIds).toEqual(['ch-deep-pockets']);
  });

  it('does not credit a seat from challengesCompleted without attribution', () => {
    const state = competitiveState('go-per-seat-no-inference');
    // `challengesCompleted` claims two completions, but no active challenge
    // carries a `completedBySeatId`, so no seat is credited.
    state.challengesCompleted = ['ch-deep-pockets', 'ch-beloved-mayor'];
    state.activeChallenges = [
      { challenge: template('ch-deep-pockets'), completed: true },
      { challenge: template('ch-beloved-mayor'), completed: true },
    ];

    const { seats } = buildGameOverChallengeSummary(state);

    expect(seats!.flatMap(seat => seat.completedChallengeIds)).toEqual([]);
    expect(seats!.every(seat => seat.completedTitles.length === 0)).toBe(true);
  });
});

// ── AC2 · Single-player retains the single-list format ──────

describe('buildGameOverChallengeSummary · single-player format', () => {
  it('retains the run-global single list with no per-seat breakdown', () => {
    const state = setupMainStreetGame({ seed: 'go-per-seat-single' });
    state.activeChallenges = [
      { challenge: template('ch-deep-pockets'), completed: true },
      { challenge: template('ch-beloved-mayor'), completed: false },
    ];
    state.challengesCompleted = ['ch-deep-pockets'];

    const summary = buildGameOverChallengeSummary(state);

    expect(summary.seats).toBeUndefined();
    expect(summary.items).toEqual([
      { title: 'Deep Pockets', completed: true },
      { title: 'Beloved Mayor', completed: false },
    ]);
    expect(summary.completedCount).toBe(1);
    expect(summary.totalCount).toBe(2);
    expect(summary.completedChallengeIds).toEqual(['ch-deep-pockets']);
  });

  it('ignores a null seat attribution in single-player (no seat context)', () => {
    const state = setupMainStreetGame({ seed: 'go-per-seat-single-null' });
    state.activeChallenges = [active('ch-deep-pockets', true, null)];
    state.challengesCompleted = ['ch-deep-pockets'];

    const summary = buildGameOverChallengeSummary(state);

    expect(summary.seats).toBeUndefined();
    expect(summary.completedChallengeIds).toEqual(['ch-deep-pockets']);
  });
});
