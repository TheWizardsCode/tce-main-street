/**
 * Main Street: Per-Seat Challenge Attribution Save/Load
 *
 * Child MS-0MV344T1C000ENRH of epic MS-0MUWNTJIK009O6BZ. Implements and
 * verifies persistence of per-seat challenge attribution
 * (`ActiveChallenge.completedBySeatId`) through the real state serializer,
 * with a legacy fallback that treats pre-attribution saves as global /
 * single-player.
 *
 * Coverage:
 *  1. Save files carry `completedBySeatId` on each active challenge.
 *  2. Loading attribution restores the correct per-seat completion state.
 *  3. A legacy save (no attribution field) loads without error and treats
 *     completions as global (`null`) while leaving incomplete challenges
 *     unattributed (`undefined`).
 *  4. Round-trip preserves attribution faithfully (byte-identical re-save).
 *  5. A completion that happens *after* a load is still attributed (guards
 *     against collapsing incomplete `undefined` to `null` on load).
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import {
  setupMainStreetGame,
  createCompetitiveState,
  serializeMainStreetState,
  deserializeMainStreetState,
  type MainStreetState,
  type MainStreetSerializedState,
} from '../../src/MainStreetState';
import { findHumanSeatId } from '../../src/MainStreetEngine';
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

/** Replaces the active challenges with the given IDs (all incomplete). */
function activate(state: MainStreetState, ...ids: string[]): void {
  state.activeChallenges = ids.map(id => ({
    challenge: template(id),
    completed: false,
  }));
}

/** The `ActiveChallenge` record for a challenge id (throws if missing). */
function record(state: MainStreetState, id: string): ActiveChallenge {
  const ac = state.activeChallenges.find(c => c.challenge.id === id);
  if (!ac) throw new Error(`Active challenge '${id}' not found`);
  return ac;
}

/** A 2-seat competitive state: seat 0 is human, seat 1 is AI. */
function competitiveState(seed: string): MainStreetState {
  return createCompetitiveState({ seed, playerCount: 2 });
}

/** Round-trips a state through the real serializer, via JSON. */
function roundTrip(state: MainStreetState): MainStreetState {
  return deserializeMainStreetState(
    JSON.parse(JSON.stringify(serializeMainStreetState(state))),
  );
}

/** The serialized active-challenge entry for a challenge id (throws if missing). */
function serializedRecord(
  saved: MainStreetSerializedState,
  id: string,
): MainStreetSerializedState['activeChallenges'][number] {
  const ac = saved.activeChallenges.find(c => c.challengeId === id);
  if (!ac) throw new Error(`Serialized active challenge '${id}' not found`);
  return ac;
}

// ── AC1 · Save includes attribution ─────────────────────────

describe('save/load attribution · save includes completedBySeatId', () => {
  it('writes the completing seat id onto each completed challenge', () => {
    const state = competitiveState('save-attribution-write');
    activate(state, 'ch-deep-pockets', 'ch-beloved-mayor');

    state.resourceBank.coins = 3000;
    evaluateChallenges(state.activeChallenges, state, 1);

    const saved = serializeMainStreetState(state);

    expect(serializedRecord(saved, 'ch-deep-pockets')).toMatchObject({
      challengeId: 'ch-deep-pockets',
      completed: true,
      completedBySeatId: 1,
    });
    // An incomplete challenge serializes with no attribution (`null`).
    expect(serializedRecord(saved, 'ch-beloved-mayor')).toMatchObject({
      completed: false,
      completedBySeatId: null,
    });
  });

  it('writes null for a single-player completion (no seat context)', () => {
    const state = setupMainStreetGame({ seed: 'save-attribution-single' });
    activate(state, 'ch-deep-pockets');
    state.resourceBank.coins = 3000;
    evaluateChallenges(state.activeChallenges, state);

    const saved = serializeMainStreetState(state);
    expect(serializedRecord(saved, 'ch-deep-pockets').completedBySeatId).toBeNull();
  });
});

// ── AC2 · Load restores attribution ─────────────────────────

describe('save/load attribution · load restores per-seat state', () => {
  it('restores distinct per-seat attributions for each completed challenge', () => {
    const state = competitiveState('save-attribution-load');
    const humanSeatId = findHumanSeatId(state);
    activate(state, 'ch-deep-pockets', 'ch-beloved-mayor');

    // The AI seat completes Deep Pockets; the human completes Beloved Mayor.
    state.resourceBank.coins = 3000;
    state.resourceBank.reputation = 0;
    evaluateChallenges(state.activeChallenges, state, 1);
    state.resourceBank.reputation = 1000;
    evaluateChallenges(state.activeChallenges, state, humanSeatId);

    const restored = roundTrip(state);

    expect(record(restored, 'ch-deep-pockets').completed).toBe(true);
    expect(record(restored, 'ch-deep-pockets').completedBySeatId).toBe(1);
    expect(record(restored, 'ch-beloved-mayor').completed).toBe(true);
    expect(record(restored, 'ch-beloved-mayor').completedBySeatId).toBe(humanSeatId);
    // `challenge` references are re-bound to the templates on load.
    expect(record(restored, 'ch-deep-pockets').challenge).toBe(template('ch-deep-pockets'));
  });

  it('leaves an incomplete challenge unattributed after load', () => {
    const state = competitiveState('save-attribution-incomplete');
    activate(state, 'ch-deep-pockets', 'ch-beloved-mayor');
    state.resourceBank.coins = 3000;
    evaluateChallenges(state.activeChallenges, state, 1);

    const restored = roundTrip(state);

    expect(record(restored, 'ch-beloved-mayor').completed).toBe(false);
    expect(record(restored, 'ch-beloved-mayor').completedBySeatId).toBeUndefined();
  });
});

// ── AC3 · Legacy save fallback ──────────────────────────────

describe('save/load attribution · legacy fallback', () => {
  /** Strips the attribution field from every serialized challenge. */
  function toLegacySave(state: MainStreetState): MainStreetSerializedState {
    const saved = JSON.parse(
      JSON.stringify(serializeMainStreetState(state)),
    ) as MainStreetSerializedState;
    for (const ac of saved.activeChallenges) {
      delete (ac as { completedBySeatId?: number | null }).completedBySeatId;
    }
    return saved;
  }

  it('loads a legacy save without error and treats completions as global', () => {
    const state = competitiveState('save-attribution-legacy');
    activate(state, 'ch-deep-pockets', 'ch-beloved-mayor');
    state.resourceBank.coins = 3000;
    evaluateChallenges(state.activeChallenges, state, 1);

    const legacy = toLegacySave(state);
    // Sanity: the legacy shape really has no attribution field.
    expect(serializedRecord(legacy, 'ch-deep-pockets')).not.toHaveProperty(
      'completedBySeatId',
    );

    const restored = deserializeMainStreetState(legacy);

    expect(record(restored, 'ch-deep-pockets').completed).toBe(true);
    // Legacy completion → global / no attribution.
    expect(record(restored, 'ch-deep-pockets').completedBySeatId).toBeNull();
    // Legacy incomplete challenge stays unattributed (not `null`).
    expect(record(restored, 'ch-beloved-mayor').completed).toBe(false);
    expect(record(restored, 'ch-beloved-mayor').completedBySeatId).toBeUndefined();
  });
});

// ── AC4 · Faithful round-trip ───────────────────────────────

describe('save/load attribution · faithful round-trip', () => {
  it('re-serialises a loaded competitive state byte-for-byte', () => {
    const state = competitiveState('save-attribution-roundtrip');
    activate(state, 'ch-deep-pockets', 'ch-beloved-mayor', 'ch-renovator');
    state.resourceBank.coins = 3000;
    evaluateChallenges(state.activeChallenges, state, 1);
    state.resourceBank.reputation = 1000;
    evaluateChallenges(state.activeChallenges, state, findHumanSeatId(state));

    const restored = roundTrip(state);

    expect(JSON.stringify(serializeMainStreetState(restored))).toBe(
      JSON.stringify(serializeMainStreetState(state)),
    );
  });

  it('re-serialises a loaded single-player state byte-for-byte', () => {
    const state = setupMainStreetGame({ seed: 'save-attribution-sp-roundtrip' });
    activate(state, 'ch-deep-pockets');
    state.resourceBank.coins = 3000;
    evaluateChallenges(state.activeChallenges, state);

    const restored = roundTrip(state);

    expect(record(restored, 'ch-deep-pockets').completedBySeatId).toBeNull();
    expect(JSON.stringify(serializeMainStreetState(restored))).toBe(
      JSON.stringify(serializeMainStreetState(state)),
    );
  });
});

// ── Regression · post-load completion attribution ───────────

describe('save/load attribution · completion after load', () => {
  it('attributes a challenge completed after loading a save', () => {
    const state = competitiveState('save-attribution-after-load');
    activate(state, 'ch-deep-pockets');
    // Round-trip while the challenge is still incomplete.
    const restored = roundTrip(state);
    expect(record(restored, 'ch-deep-pockets').completedBySeatId).toBeUndefined();

    restored.resourceBank.coins = 3000;
    evaluateChallenges(restored.activeChallenges, restored, 1);

    expect(record(restored, 'ch-deep-pockets').completed).toBe(true);
    expect(record(restored, 'ch-deep-pockets').completedBySeatId).toBe(1);
  });
});
