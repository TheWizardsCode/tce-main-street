/**
 * Main Street: Per-turn stat history capture and persistence
 * (MS-0MVAMU6OM008GJPV parent, MS-0MVSHYY1900266X3 child).
 *
 * Verifies AC1–AC4 of the per-turn stat history child:
 *  - one `TurnStatSnapshot` is recorded per completed turn on the legacy and
 *    deferred closing paths, keyed by `turn` so it is never double-recorded;
 *  - the snapshot shape mirrors the per-turn net row (`profit` = net coin
 *    delta vs `weekStartCoins`, `businesses` = non-null street-grid entries,
 *    `staff` = `staffCards.length`);
 *  - `turnStatsHistory` serialises/restores faithfully;
 *  - a legacy save without the field loads with an empty history (and a
 *    malformed entry is dropped rather than fabricating data).
 *
 * @module tests/main-street/turn-stats-history
 */

import { describe, expect, it } from 'vitest';

import {
  setupMainStreetGame,
  serializeMainStreetState,
  deserializeMainStreetState,
  type MainStreetSerializedState,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  applyEndOfTurnDeltas,
  executeWeekStart,
  finishDeferredTurnClosing,
  processEndOfTurn,
  recordTurnStats,
} from '../../src/MainStreetEngine';
import { recalculateCard } from '../../src/MainStreetAdjacency';
import type { BusinessCard } from '../../src/MainStreetCards';

// ── Helpers ────────────────────────────────────────────────────

/** A deterministic, incident-free state with one placed business. */
function createMidTurnState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  const bakery: BusinessCard = {
    family: 'business',
    id: 'bakery-1',
    name: 'Bakery',
    cost: 3,
    baseIncome: 2,
    synergyTypes: ['Food'],
    maxLevel: 1,
    description: 'A test bakery',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
  };
  state.streetGrid[0] = bakery;
  state.incidentDeck = []; // force resolveIncident to return null
  recalculateCard(state, 0);
  return state;
}

/** Runs a full legacy (in-process) closing. */
function closeLegacy(state: MainStreetState): void {
  processEndOfTurn(state);
}

/** Runs a full deferred-mutation closing (scene-style). */
function closeDeferred(state: MainStreetState): void {
  const result = processEndOfTurn(state, { deferResourceApplication: true });
  applyEndOfTurnDeltas(state, result);
  finishDeferredTurnClosing(state, result);
}

// ── Capture ────────────────────────────────────────────────────

describe('turnStatsHistory capture', () => {
  it('initialises an empty history in setup', () => {
    const state = setupMainStreetGame({ seed: 'stats-init' });
    expect(state.turnStatsHistory).toEqual([]);
  });

  it('records exactly one snapshot per completed turn on the legacy path', () => {
    const state = createMidTurnState('stats-legacy');
    const weekStartCoins = state.weekStartCoins;

    closeLegacy(state);

    expect(state.turnStatsHistory).toHaveLength(1);
    const snapshot = state.turnStatsHistory[0]!;
    expect(snapshot.turn).toBe(1);
    expect(snapshot.coins).toBe(state.resourceBank.coins);
    expect(snapshot.reputation).toBe(state.resourceBank.reputation);
    expect(snapshot.score).toBe(state.finalScore);
    expect(snapshot.profit).toBe(state.resourceBank.coins - weekStartCoins);
    expect(snapshot.businesses).toBe(1);
    expect(snapshot.staff).toBe(state.staffCards.length);
  });

  it('records exactly one snapshot per completed turn on the deferred path', () => {
    const state = createMidTurnState('stats-deferred');
    const weekStartCoins = state.weekStartCoins;

    closeDeferred(state);

    expect(state.turnStatsHistory).toHaveLength(1);
    const snapshot = state.turnStatsHistory[0]!;
    expect(snapshot.turn).toBe(1);
    expect(snapshot.profit).toBe(state.resourceBank.coins - weekStartCoins);
    expect(snapshot.businesses).toBe(1);
  });

  it('records one snapshot per turn across consecutive turns', () => {
    const state = createMidTurnState('stats-multi');
    closeLegacy(state);

    // New turn: re-run WeekStart and close again.
    executeWeekStart(state);
    state.incidentDeck = [];
    closeLegacy(state);

    expect(state.turnStatsHistory.map((entry) => entry.turn)).toEqual([1, 2]);
  });

  it('does not record the same turn twice when the tail runs again', () => {
    const state = createMidTurnState('stats-no-double');
    closeLegacy(state);
    const first = state.turnStatsHistory[0]!;

    // A repeat low-level capture for the same turn appends nothing.
    const returned = recordTurnStats(state, 1);
    expect(state.turnStatsHistory).toHaveLength(1);
    expect(returned).toBe(first);
  });

  it('records profit against the weekStartCoins snapshot, not the turn-end balance', () => {
    const state = createMidTurnState('stats-profit');
    const startCoins = state.weekStartCoins;
    closeLegacy(state);
    const endCoins = state.resourceBank.coins;
    // The turn earned income, so the delta is a non-trivial positive number
    // and the snapshot records it as profit rather than the end balance.
    expect(endCoins).not.toBe(startCoins);
    expect(state.turnStatsHistory[0]!.profit).toBe(endCoins - startCoins);
    expect(state.turnStatsHistory[0]!.coins).toBe(endCoins);
  });
});

// ── Persistence ────────────────────────────────────────────────

describe('turnStatsHistory persistence', () => {
  it('round-trips the series through serialize/deserialize', () => {
    const state = createMidTurnState('stats-roundtrip');
    closeLegacy(state);
    executeWeekStart(state);
    state.incidentDeck = [];
    closeLegacy(state);

    const restored = deserializeMainStreetState(serializeMainStreetState(state));

    expect(restored.turnStatsHistory).toEqual(state.turnStatsHistory);
    expect(restored.turnStatsHistory).toHaveLength(2);
  });

  it('loads a legacy save without the field as an empty history', () => {
    const state = createMidTurnState('stats-legacy-save');
    closeLegacy(state);

    // Simulate a pre-feature save: strip the new field entirely.
    const saved = JSON.parse(JSON.stringify(serializeMainStreetState(state))) as Record<string, unknown>;
    delete saved.turnStatsHistory;

    const restored = deserializeMainStreetState(saved as unknown as MainStreetSerializedState);
    expect(restored.turnStatsHistory).toEqual([]);
  });

  it('drops malformed entries instead of fabricating data', () => {
    const state = createMidTurnState('stats-malformed');
    closeLegacy(state);

    const saved = JSON.parse(JSON.stringify(serializeMainStreetState(state))) as Record<string, unknown>;
    saved.turnStatsHistory = [
      { turn: 1, coins: 10, reputation: 2, score: 5, profit: 3, businesses: 1, staff: 0 },
      { turn: 'not-a-number', coins: 'oops' },
      null,
    ];

    const restored = deserializeMainStreetState(saved as unknown as MainStreetSerializedState);
    expect(restored.turnStatsHistory).toHaveLength(1);
    expect(restored.turnStatsHistory[0]).toEqual({
      turn: 1, coins: 10, reputation: 2, score: 5, profit: 3, businesses: 1, staff: 0,
    });
  });
});
