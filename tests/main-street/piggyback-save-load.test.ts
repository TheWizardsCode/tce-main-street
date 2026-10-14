/**
 * Main Street: Pending piggyback decision save/load
 *
 * F3 leaf MS-0MV8BFYAL008M356 of epic MS-0MUYC47EL005Z69H. Covers AC4:
 * a pending piggyback decision set serializes/deserializes (with a null
 * default for older saves), and a serialize → deserialize → resolve round-trip
 * completes the shared day without stalling.
 */
import { describe, it, expect } from 'vitest';

import {
  createCompetitiveState,
  deserializeMainStreetState,
  serializeMainStreetState,
  type MainStreetState,
} from '../../src/MainStreetState';
import { bindCompetitiveSeat } from '../../src/MainStreetAiStrategy';
import type { EventCard } from '../../src/MainStreetCards';
import {
  executeAction,
  hasPendingPiggyback,
  resolveAllPendingPiggybacks,
  resolveCompetitiveClosingPhases,
  resolvePendingPiggyback,
} from '../../src/MainStreetEngine';

function eligibleEvent(): EventCard {
  return {
    family: 'event',
    id: 'evt-save-eligible',
    name: 'Save-Load Gathering',
    trigger: 'Investment',
    target: 'All',
    effect: 'Test effect',
    cost: 300,
    coinDelta: 100,
    reputationDelta: 200,
    piggybackable: true,
  } as EventCard;
}

function compState(seed: string, playerCount: number): MainStreetState {
  const state = createCompetitiveState({ seed, playerCount });
  state.resourceBank.coins = 100000;
  state.resourceBank.reputation = 1000;
  for (const p of state.players!) {
    p.coins = 1000;
    p.reputation = 0;
  }
  state.phase = 'MarketPhase';
  state.actionsRemaining = 5;
  state.activePlayerId = 0;
  return state;
}

/** Plays an eligible event for seat 0, leaving a pending piggyback set. */
function raisePending(state: MainStreetState): void {
  state.activePlayerId = 0;
  state.phase = 'MarketPhase';
  state.actionsRemaining = 5;
  bindCompetitiveSeat(state, 0);
  state.hand.push(eligibleEvent());
  executeAction(state, { type: 'play-event-from-hand', handIndex: state.hand.length - 1 });
}

function roundTrip(state: MainStreetState): MainStreetState {
  return deserializeMainStreetState(serializeMainStreetState(state));
}

describe('AC4 — pending piggyback survives a save/load round-trip', () => {
  it('round-trips the pending set (event, paid cost, seats, unresolved flags)', () => {
    const state = compState('pb-save-roundtrip', 3);
    raisePending(state);
    expect(hasPendingPiggyback(state)).toBe(true);

    const restored = roundTrip(state);

    const pending = restored.pendingPiggyback;
    expect(pending).not.toBeNull();
    expect(pending!.actingSeatId).toBe(0);
    expect(pending!.event.id).toBe('evt-save-eligible');
    expect(pending!.paidCost).toBe(300);
    expect(pending!.decisions.map((d) => d.seatId)).toEqual([1, 2]);
    for (const decision of pending!.decisions) {
      expect(decision.chosenJoin).toBeNull();
      expect(decision.resolved).toBe(false);
      expect(decision.event.id).toBe('evt-save-eligible');
      expect(decision.paidCost).toBe(300);
    }
    expect(hasPendingPiggyback(restored)).toBe(true);
  });

  it('preserves a partially-resolved set (chosen join / resolved flags)', () => {
    const state = compState('pb-save-partial', 3);
    raisePending(state);
    resolvePendingPiggyback(state, 1, true); // seat 1 joined, seat 2 still pending

    const restored = roundTrip(state);

    const decisions = restored.pendingPiggyback!.decisions;
    expect(decisions.map((d) => d.seatId)).toEqual([1, 2]);
    expect(decisions[0].resolved).toBe(true);
    expect(decisions[0].chosenJoin).toBe(true);
    expect(decisions[1].resolved).toBe(false);
    expect(decisions[1].chosenJoin).toBeNull();
    // Seat 1's wallet reflects the applied join.
    expect(restored.players![1].coins).toBe(650);
  });

  it('defaults to null for older saves without the pendingPiggyback field', () => {
    const state = compState('pb-save-legacy', 2);
    const saved = JSON.parse(JSON.stringify(serializeMainStreetState(state))) as Record<string, unknown>;
    delete saved.pendingPiggyback;

    const restored = deserializeMainStreetState(saved as never);
    expect(restored.pendingPiggyback).toBeNull();
    expect(hasPendingPiggyback(restored)).toBe(false);
  });

  it('serializes a null pending set for a state with no pending decision', () => {
    const state = compState('pb-save-null', 2);
    expect(serializeMainStreetState(state).pendingPiggyback).toBeNull();
  });
});

describe('AC4 — deserialize → resolve completes the day without stalling', () => {
  it('resolves pending decisions after load and runs the shared closing', () => {
    const state = compState('pb-save-complete-day', 3);
    raisePending(state);
    // The acting seat has finished their MarketPhase; the shared day is ready
    // to close but paused on the pending piggyback decision.
    state.phase = 'InvestmentResolution';

    const restored = roundTrip(state);
    expect(restored.phase).toBe('InvestmentResolution');

    // Still paused on load.
    const paused = resolveCompetitiveClosingPhases(restored);
    expect(paused.piggybackPending).toBe(true);

    // Resolve every seat (free-ride default) then re-run the closing.
    const resolutions = resolveAllPendingPiggybacks(restored);
    expect(resolutions.map((r) => r.seatId)).toEqual([1, 2]);
    expect(restored.pendingPiggyback).toBeNull();

    const closed = resolveCompetitiveClosingPhases(restored);
    expect(closed.piggybackPending).toBeFalsy();
    expect(restored.pendingPiggyback).toBeNull();
    // The day advanced (or a pre-existing dual-choice incident paused it) —
    // it never stalled on the piggyback decision.
    if (restored.gameResult === 'playing' && !closed.choicePending) {
      expect(restored.phase).toBe('WeekStart');
    }
  });
});
