/**
 * Main Street: Pending piggyback decision state machine
 *
 * F3 leaf MS-0MV8BFYAL008M356 of epic MS-0MUYC47EL005Z69H. Covers:
 *
 *  AC1 — an eligible organiser event played via any dispatch path
 *        (`play-event`, `play-event-from-hand`, `playHeldEvent`) in N>=2 raises
 *        one pending decision per OTHER active seat and surfaces a pause;
 *        N=1 and non-eligible events never raise/pause.
 *  AC2 — `resolvePendingPiggyback` applies the automatic 50% free-ride, or the
 *        join-fully upgrade (F2) when chosen and affordable; seats resolve
 *        independently in seat order.
 *  AC3 — the acting player's reward and all shared decks are byte-for-byte
 *        unchanged by piggyback resolutions, and no extra RNG is consumed
 *        (replay/equality check).
 *  AC5 — eliminated seats are skipped; the human-vs-AI and N>2 orderings are
 *        covered.
 *
 * Fixtures set owner reputation to 0 so the reputation coin multiplier is 1
 * and expected credits are exact integer values (deterministic math checks).
 */
import { describe, it, expect } from 'vitest';

import {
  createCompetitiveState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import { bindCompetitiveSeat } from '../../src/MainStreetAiStrategy';
import type { EventCard } from '../../src/MainStreetCards';
import {
  executeAction,
  hasPendingPiggyback,
  getNextPendingPiggybackSeat,
  getPiggybackSeatIds,
  isPiggybackEligible,
  playHeldEvent,
  raisePiggybackDecisions,
  resolveAllPendingPiggybacks,
  resolveCompetitiveClosingPhases,
  resolvePendingPiggyback,
  piggybackJoinFullyCost,
} from '../../src/MainStreetEngine';

// ── Helpers ───────────────────────────────────────────────────────

function makeEvent(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event' as const,
    id: overrides.id ?? 'evt-test',
    name: overrides.name ?? 'Test Event',
    trigger: overrides.trigger ?? 'Investment',
    cost: overrides.cost ?? 300,
    effect: overrides.effect ?? 'Test effect',
    target: overrides.target ?? 'All',
    coinDelta: overrides.coinDelta ?? 0,
    reputationDelta: overrides.reputationDelta ?? 0,
    ...overrides,
  } as EventCard;
}

/** A flat `All` organiser event — exact independent of board composition. */
function eligibleAllEvent(overrides: Partial<EventCard> = {}): EventCard {
  return makeEvent({
    id: 'evt-eligible-all',
    name: 'Eligible Gathering',
    trigger: 'Investment',
    target: 'All',
    coinDelta: 100,
    reputationDelta: 200,
    cost: 300,
    piggybackable: true,
    ...overrides,
  });
}

/** A `SpecificSynergy` organiser event (own-board matching businesses). */
function eligibleSynergyEvent(overrides: Partial<EventCard> = {}): EventCard {
  return makeEvent({
    id: 'evt-eligible-synergy',
    name: 'Eligible Festival',
    trigger: 'Investment',
    target: 'SpecificSynergy',
    targetSynergy: 'Culture',
    coinDelta: 200,
    reputationDelta: 100,
    cost: 300,
    piggybackable: true,
    ...overrides,
  });
}

/** The same event shape but NOT piggyback-eligible (no flag). */
function ineligibleEvent(): EventCard {
  return makeEvent({
    id: 'evt-ineligible',
    name: 'Private Promotion',
    trigger: 'Investment',
    target: 'All',
    coinDelta: 100,
    reputationDelta: 200,
    cost: 300,
  });
}

/**
 * Creates a competitive state with clean wallets: players start at 1000
 * coins / 0 reputation (multiplier = 1); the shared host wallet is padded so
 * host-loss checks never fire during fixtures. Phase is MarketPhase with a
 * fresh action budget so dispatch paths are legal.
 */
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

/** Binds a seat and plays `event` through `executeAction` with the given action. */
function playViaExecuteAction(
  state: MainStreetState,
  seatId: number,
  event: EventCard,
  actionType: 'play-event' | 'play-event-from-hand',
): void {
  state.activePlayerId = seatId;
  state.phase = 'MarketPhase';
  state.actionsRemaining = 5;
  if ((state.players?.length ?? 0) > 0) bindCompetitiveSeat(state, seatId);
  state.hand.push(event);
  executeAction(state, { type: actionType, handIndex: state.hand.length - 1 });
}

/** Plays `event` via the `playHeldEvent` dispatch path. */
function playViaHeldEvent(state: MainStreetState, seatId: number, event: EventCard): void {
  state.activePlayerId = seatId;
  if ((state.players?.length ?? 0) > 0) bindCompetitiveSeat(state, seatId);
  state.hand.push(event);
  playHeldEvent(state, state.hand.length - 1);
}

// ── AC1: eligibility, raise + pause gate ─────────────────────────

describe('AC1 — eligible events raise one pending decision per other active seat', () => {
  it('raises via play-event-from-hand for every other active seat, in seat order', () => {
    const state = compState('pb-raise-from-hand', 3);
    playViaExecuteAction(state, 0, eligibleAllEvent(), 'play-event-from-hand');

    const pending = state.pendingPiggyback;
    expect(pending).not.toBeNull();
    expect(pending!.actingSeatId).toBe(0);
    expect(pending!.paidCost).toBe(300);
    expect(pending!.event.id).toBe('evt-eligible-all');
    expect(pending!.decisions.map((d) => d.seatId)).toEqual([1, 2]);
    for (const decision of pending!.decisions) {
      expect(decision.chosenJoin).toBeNull();
      expect(decision.resolved).toBe(false);
      expect(decision.paidCost).toBe(300);
    }
    expect(hasPendingPiggyback(state)).toBe(true);
  });

  it('raises via play-event', () => {
    const state = compState('pb-raise-play-event', 2);
    playViaExecuteAction(state, 0, eligibleAllEvent(), 'play-event');
    expect(getPiggybackSeatIds(state, 0)).toEqual([1]);
    expect(state.pendingPiggyback!.decisions.map((d) => d.seatId)).toEqual([1]);
  });

  it('raises via playHeldEvent', () => {
    const state = compState('pb-raise-held', 2);
    playViaHeldEvent(state, 0, eligibleSynergyEvent());
    expect(state.pendingPiggyback).not.toBeNull();
    expect(state.pendingPiggyback!.decisions.map((d) => d.seatId)).toEqual([1]);
    expect(state.pendingPiggyback!.event.id).toBe('evt-eligible-synergy');
  });

  it('surfaces a pause through the shared closing while a decision is pending', () => {
    const state = compState('pb-pause-closing', 2);
    playViaExecuteAction(state, 0, eligibleAllEvent(), 'play-event-from-hand');

    const paused = resolveCompetitiveClosingPhases(state);
    expect(paused.piggybackPending).toBe(true);
    expect(paused.choicePending).toBe(false);
    // Nothing was applied / advanced while paused.
    expect(state.phase).toBe('MarketPhase');
  });

  it('never raises in N=1 (single-player) for an eligible-looking event', () => {
    const state = setupMainStreetGame({ seed: 'pb-single-player' });
    state.phase = 'MarketPhase';
    state.actionsRemaining = 5;
    state.hand.push(eligibleAllEvent());

    executeAction(state, { type: 'play-event-from-hand', handIndex: state.hand.length - 1 });

    expect(state.pendingPiggyback ?? null).toBeNull();
    expect(hasPendingPiggyback(state)).toBe(false);
    // No pause is surfaced either.
    expect(resolveCompetitiveClosingPhasesWouldPause(state)).toBe(false);
  });

  it('never raises for a non-eligible event in N>=2', () => {
    const state = compState('pb-ineligible', 2);
    playViaExecuteAction(state, 0, ineligibleEvent(), 'play-event-from-hand');
    expect(state.pendingPiggyback ?? null).toBeNull();
    expect(hasPendingPiggyback(state)).toBe(false);
  });

  it('never raises when every other seat is eliminated (N>=2)', () => {
    const state = compState('pb-all-eliminated', 3);
    state.players![1].eliminated = true;
    state.players![2].eliminated = true;

    playViaExecuteAction(state, 0, eligibleAllEvent(), 'play-event-from-hand');

    expect(getPiggybackSeatIds(state, 0)).toEqual([]);
    expect(state.pendingPiggyback ?? null).toBeNull();
  });

  it('isPiggybackEligible gates on the flag, trigger, count and duration', () => {
    const state = compState('pb-eligible-predicate', 2);
    expect(isPiggybackEligible(state, eligibleAllEvent(), 0)).toBe(true);
    expect(isPiggybackEligible(state, ineligibleEvent(), 0)).toBe(false);
    expect(isPiggybackEligible(state, eligibleAllEvent({ trigger: 'Incident' }), 0)).toBe(false);
    expect(isPiggybackEligible(state, eligibleAllEvent({ duration: 2 } as Partial<EventCard>), 0)).toBe(false);
  });
});

// `resolveCompetitiveClosingPhases` requires InvestmentResolution to fully run;
// the pause guard sits before the phase check, so a single-player state would
// throw. This helper asserts no pending piggyback WITHOUT invoking the closing.
function resolveCompetitiveClosingPhasesWouldPause(state: MainStreetState): boolean {
  return hasPendingPiggyback(state);
}

// ── AC2: resolution tiers ────────────────────────────────────────

describe('AC2 — resolvePendingPiggyback applies the free-ride / join-fully tiers', () => {
  it('applies the automatic 50% free-ride with no charge and no action spent', () => {
    const state = compState('pb-resolve-ride', 2);
    playViaExecuteAction(state, 0, eligibleAllEvent(), 'play-event-from-hand');
    const budgetBefore = state.players![1].actionBudget;
    const actionsBefore = state.actionsRemaining;

    const resolution = resolvePendingPiggyback(state, 1, false);

    expect(resolution).not.toBeNull();
    expect(resolution!.freeRide).toBe(true);
    expect(resolution!.joined).toBe(false);
    expect(resolution!.charge).toBe(0);
    expect(resolution!.reward.scale).toBe(0.5);
    expect(resolution!.reward.coins).toBe(50); // 100 × 0.5
    expect(resolution!.reward.reputation).toBe(100); // 200 × 0.5
    expect(state.players![1].coins).toBe(1050);
    expect(state.players![1].reputation).toBe(100);
    expect(state.players![1].actionBudget).toBe(budgetBefore);
    expect(state.actionsRemaining).toBe(actionsBefore);
    // Sole decision resolved → the pending set is cleared.
    expect(state.pendingPiggyback ?? null).toBeNull();
  });

  it('applies the join-fully tier when chosen and affordable (no action spent)', () => {
    const state = compState('pb-resolve-join', 2);
    playViaExecuteAction(state, 0, eligibleAllEvent(), 'play-event-from-hand');
    const budgetBefore = state.players![1].actionBudget;

    const resolution = resolvePendingPiggyback(state, 1, true);

    expect(resolution!.joined).toBe(true);
    expect(resolution!.freeRide).toBe(false);
    expect(resolution!.charge).toBe(piggybackJoinFullyCost(300)); // 450
    expect(resolution!.charge).toBe(450);
    expect(resolution!.reward.scale).toBe(1.0);
    expect(resolution!.reward.coins).toBe(100);
    expect(resolution!.reward.reputation).toBe(200);
    expect(state.players![1].coins).toBe(1000 - 450 + 100); // 650
    expect(state.players![1].reputation).toBe(200);
    expect(state.players![1].actionBudget).toBe(budgetBefore);
  });

  it('falls back to the free-ride (no partial charge) when join-fully is unaffordable', () => {
    const state = compState('pb-resolve-unaffordable', 2);
    state.players![1].coins = 100; // < 450
    playViaExecuteAction(state, 0, eligibleAllEvent(), 'play-event-from-hand');

    const resolution = resolvePendingPiggyback(state, 1, true);

    expect(resolution!.joined).toBe(false);
    expect(resolution!.freeRide).toBe(true);
    expect(resolution!.charge).toBe(0);
    expect(resolution!.reward.coins).toBe(50); // free-ride applied
    expect(state.players![1].coins).toBe(100 + 50); // never partially charged
    expect(state.players![1].reputation).toBe(100);
  });

  it('resolves seats independently, in seat order, and clears only on the last', () => {
    const state = compState('pb-resolve-order', 4);
    playViaExecuteAction(state, 0, eligibleAllEvent(), 'play-event-from-hand');
    expect(getNextPendingPiggybackSeat(state)).toBe(1);

    // Resolve out of seat order deliberately — each seat is independent.
    resolvePendingPiggyback(state, 2, false);
    expect(hasPendingPiggyback(state)).toBe(true);
    expect(getNextPendingPiggybackSeat(state)).toBe(1);
    resolvePendingPiggyback(state, 1, true);
    expect(getNextPendingPiggybackSeat(state)).toBe(3);
    resolvePendingPiggyback(state, 3, false);

    expect(hasPendingPiggyback(state)).toBe(false);
    expect(state.pendingPiggyback ?? null).toBeNull();
    // Seat 2 and 3 got the 50% free-ride; seat 1 joined fully.
    expect(state.players![1].coins).toBe(1000 - 450 + 100);
    expect(state.players![2].coins).toBe(1050);
    expect(state.players![3].coins).toBe(1050);
  });

  it('returns null for an unknown / already-resolved seat', () => {
    const state = compState('pb-resolve-null', 2);
    playViaExecuteAction(state, 0, eligibleAllEvent(), 'play-event-from-hand');

    expect(resolvePendingPiggyback(state, 9, false)).toBeNull();
    resolvePendingPiggyback(state, 1, false);
    expect(resolvePendingPiggyback(state, 1, false)).toBeNull();
  });

  it('resolveAllPendingPiggybacks settles every seat via the policy seam', () => {
    const state = compState('pb-resolve-all', 3);
    playViaExecuteAction(state, 0, eligibleAllEvent(), 'play-event-from-hand');

    // Policy: seat 1 joins, seat 2 keeps the free-ride.
    const resolutions = resolveAllPendingPiggybacks(state, (decision) => decision.seatId === 1);

    expect(resolutions.map((r) => r.seatId)).toEqual([1, 2]);
    expect(resolutions[0].joined).toBe(true);
    expect(resolutions[1].freeRide).toBe(true);
    expect(state.pendingPiggyback ?? null).toBeNull();
  });
});

// ── AC3: isolation + determinism ─────────────────────────────────

describe('AC3 — acting player and shared decks are unchanged; no extra RNG', () => {
  it('resolving piggybacks leaves the acting player and shared decks untouched', () => {
    const state = compState('pb-isolation', 3);
    playViaExecuteAction(state, 0, eligibleSynergyEvent(), 'play-event-from-hand');

    const actingCoins = state.players![0].coins;
    const actingRep = state.players![0].reputation;
    const market = JSON.stringify(state.market);
    const decks = JSON.stringify(state.decks);
    const incidentDeck = JSON.stringify(state.incidentDeck);
    const discardPile = JSON.stringify(state.discardPile);
    const rngBefore = state.rngCalls;

    resolveAllPendingPiggybacks(state);

    expect(state.players![0].coins).toBe(actingCoins);
    expect(state.players![0].reputation).toBe(actingRep);
    expect(JSON.stringify(state.market)).toBe(market);
    expect(JSON.stringify(state.decks)).toBe(decks);
    expect(JSON.stringify(state.incidentDeck)).toBe(incidentDeck);
    expect(JSON.stringify(state.discardPile)).toBe(discardPile);
    expect(state.rngCalls).toBe(rngBefore);
  });

  it('a full raise+resolve replay is byte-identical and consumes zero RNG', () => {
    const build = (seed: string) => {
      const state = compState(seed, 3);
      playViaExecuteAction(state, 0, eligibleSynergyEvent(), 'play-event-from-hand');
      return state;
    };
    const a = build('pb-replay');
    const b = build('pb-replay');
    const rngBefore = a.rngCalls;

    const ra = resolveAllPendingPiggybacks(a);
    const rb = resolveAllPendingPiggybacks(b);

    expect(ra).toEqual(rb);
    expect(a.rngCalls).toBe(rngBefore);
    expect(b.rngCalls).toBe(rngBefore);
    expect(a.players![1].coins).toBe(b.players![1].coins);
    expect(a.players![2].coins).toBe(b.players![2].coins);
  });
});

// ── AC5: elimination + ordering ──────────────────────────────────

describe('AC5 — eliminated seats skipped; human-vs-AI and N>2 ordering', () => {
  it('skips eliminated seats in the raised decision set', () => {
    const state = compState('pb-skip-eliminated', 4);
    state.players![1].eliminated = true;

    playViaExecuteAction(state, 0, eligibleAllEvent(), 'play-event-from-hand');

    expect(state.pendingPiggyback!.decisions.map((d) => d.seatId)).toEqual([2, 3]);
  });

  it('raises for the human seat when an AI seat organises the event', () => {
    const state = compState('pb-human-vs-ai', 3);
    // Seat 1 (AI) plays; seats 0 (human) and 2 (AI) are invited.
    playViaExecuteAction(state, 1, eligibleAllEvent(), 'play-event-from-hand');

    expect(state.pendingPiggyback!.actingSeatId).toBe(1);
    expect(state.pendingPiggyback!.decisions.map((d) => d.seatId)).toEqual([0, 2]);
    expect(state.players![0].controller).toBe('human');

    // The human seat resolves its own decision independently.
    const resolution = resolvePendingPiggyback(state, 0, false);
    expect(resolution!.freeRide).toBe(true);
    expect(state.players![0].coins).toBe(1050);
  });

  it('preserves seat order for N>2 with the acting seat in the middle', () => {
    const state = compState('pb-n-order', 5);
    playViaExecuteAction(state, 2, eligibleAllEvent(), 'play-event-from-hand');
    expect(state.pendingPiggyback!.decisions.map((d) => d.seatId)).toEqual([0, 1, 3, 4]);
  });

  it('raisePiggybackDecisions is idempotent-safe: an unresolved prior set is settled first', () => {
    const state = compState('pb-two-events', 2);
    playViaExecuteAction(state, 0, eligibleAllEvent(), 'play-event-from-hand');
    // A second eligible play before resolving: the prior set is auto-settled
    // (free-ride) so its share is never dropped.
    playViaExecuteAction(state, 0, eligibleAllEvent({ id: 'evt-second' }), 'play-event-from-hand');

    expect(getPiggybackSeatIds(state, 0)).toEqual([1]);
    expect(state.pendingPiggyback!.event.id).toBe('evt-second');
    expect(state.players![1].coins).toBe(1050); // first event's free-ride applied
  });

  it('raisePiggybackDecisions rejects N=1 / ineligible / no-target calls', () => {
    const single = setupMainStreetGame({ seed: 'pb-raise-direct-sp' });
    expect(raisePiggybackDecisions(single, eligibleAllEvent(), 0, 300)).toBe(false);
    expect(single.pendingPiggyback ?? null).toBeNull();

    const state = compState('pb-raise-direct', 2);
    expect(raisePiggybackDecisions(state, ineligibleEvent(), 0, 300)).toBe(false);
    expect(state.pendingPiggyback ?? null).toBeNull();
  });
});
