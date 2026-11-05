/**
 * Main Street: Competitive round ledger (engine) — MS-0MVRNV9Y8008IKGK
 *
 * The competitive shared closing already applies per-seat income and ongoing
 * costs to each `PlayerRecord`; this suite pins the **reporting-only** ledger
 * that surfaces those already-applied values so a per-seat Turn Summary can be
 * rendered without a browser:
 *
 *  - one owner-keyed entry per non-eliminated seat, in seat order;
 *  - `businessesOwned` at closing (sold slots excluded);
 *  - the per-phase income subtotals (base / synergy / reputation / events) and
 *    their total;
 *  - `netCoinChange` for the seat across the closing.
 *
 * Invariants:
 *  - the ledger reconciles exactly with the committed wallet (no double-apply,
 *    no wallet movement of its own);
 *  - the identical seeded run produces the identical ledger and wallets
 *    (no RNG consumption);
 *  - the ledger survives the deferred dual-choice resume;
 *  - single-player and N=1 closings never carry it (absent-safe).
 *
 * @module tests/main-street/competitive-turn-ledger
 */
import { describe, expect, it } from 'vitest';

import {
  createCompetitiveState,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  resolveCompetitiveClosingPhases,
  resolveCompetitivePendingChoice,
} from '../../src/MainStreetEngineCompetitiveTurn';
import { processEndOfTurn, executeWeekStart } from '../../src/MainStreetEngine';
import { recalculateCard } from '../../src/MainStreetAdjacency';
import type { BusinessCard } from '../../src/MainStreetCards';
import type { TurnResult } from '../../src/MainStreetEngineTypes';

// ── Fixtures ─────────────────────────────────────────────────

/** A plain business card: exact base income, exact ongoing cost. */
function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: overrides.id ?? 'test-biz',
    name: overrides.name ?? 'Test Biz',
    cost: overrides.cost ?? 5,
    baseIncome: overrides.baseIncome ?? 4,
    synergyTypes: overrides.synergyTypes ?? ['Food'],
    maxLevel: overrides.maxLevel ?? 1,
    description: overrides.description ?? 'A test business',
    level: overrides.level ?? 0,
    incomeBonus: overrides.incomeBonus ?? 0,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    reputationBonus: overrides.reputationBonus ?? 0,
    ongoingCost: overrides.ongoingCost ?? 0,
  } as BusinessCard;
}

/** Places a card on a slot and tags its owner (the competitive placement). */
function place(
  state: MainStreetState,
  slotIndex: number,
  card: BusinessCard,
  ownerId: number,
): void {
  state.streetGrid[slotIndex] = card;
  state.ownerTaggedGrid![slotIndex] = { card, ownerId };
  recalculateCard(state, slotIndex);
}

/**
 * A competitive state ready for a shared closing: loans disabled (so no
 * bailout pause), no incident deck (deterministic closing), and one business
 * per seat placed on well-separated slots so synergy never couples the seats.
 */
function closingState(seed: string, playerCount: number): MainStreetState {
  const state = createCompetitiveState({
    seed,
    playerCount,
    difficulty: 'Easy',
    loansEnabled: false,
  });
  state.incidentDeck = [];
  // Seat 0 owns two businesses (base income 4 + 3); seat 1 owns one (base 6).
  place(state, 0, makeBiz({ id: 'b0', baseIncome: 4, ongoingCost: 2 }), 0);
  place(state, 20, makeBiz({ id: 'b1', baseIncome: 3, ongoingCost: 0 }), 0);
  place(state, 10, makeBiz({ id: 'b2', baseIncome: 6, ongoingCost: 1 }), 1);
  if (playerCount >= 3) {
    place(state, 30, makeBiz({ id: 'b3', baseIncome: 2, ongoingCost: 0 }), 2);
  }
  return state;
}

/** Runs the shared closing from a controlled phase, returning its result. */
function runClosing(state: MainStreetState): {
  result: TurnResult;
  coinsBefore: number[];
  dayClosed: number;
} {
  state.phase = 'InvestmentResolution';
  state.activePlayerId = 0;
  const coinsBefore = (state.players ?? []).map((seat) => seat.coins);
  const dayClosed = state.turn;
  const result = resolveCompetitiveClosingPhases(state);
  return { result, coinsBefore, dayClosed };
}

// ── Per-seat ledger ──────────────────────────────────────────

describe('competitive round ledger (MS-0MVRNV9Y8008IKGK)', () => {
  it('exposes one owner-keyed entry per seat, in seat order, for the closed day', () => {
    const state = closingState('competitive-round-ledger', 2);
    const { result, dayClosed } = runClosing(state);

    const ledger = result.playerRoundLedger;
    expect(ledger).toBeDefined();
    expect(ledger!.turn).toBe(dayClosed);
    expect(ledger!.seats.map((seat) => seat.ownerId)).toEqual([0, 1]);
  });

  it('reports businesses owned, per-phase income subtotals and the net coin change per seat', () => {
    const state = closingState('competitive-round-ledger', 2);
    const { result } = runClosing(state);

    const [human, ai] = result.playerRoundLedger!.seats;
    expect(human).toMatchObject({
      ownerId: 0,
      businessesOwned: 2,
      incomeByPhase: { base: 7, synergy: 0, reputation: 0, events: 0 },
      incomeTotal: 7,
      netCoinChange: 5, // income 7 − ongoing costs 2
    });
    expect(ai).toMatchObject({
      ownerId: 1,
      businessesOwned: 1,
      incomeByPhase: { base: 6, synergy: 0, reputation: 0, events: 0 },
      incomeTotal: 6,
      netCoinChange: 5, // income 6 − ongoing costs 1
    });
  });

  it('reconciles each seat’s net change with its committed wallet', () => {
    const state = closingState('competitive-round-ledger', 2);
    const { result, coinsBefore } = runClosing(state);

    const seats = result.playerRoundLedger!.seats;
    const income = result.playerIncome ?? [];
    for (const seat of seats) {
      const player = state.players![seat.ownerId];
      // Reporting-only: the net row is exactly the wallet movement.
      expect(seat.netCoinChange).toBe(player.coins - coinsBefore[seat.ownerId]);
      // The per-phase rows sum to the reported total.
      const total = Object.values(seat.incomeByPhase).reduce((sum, v) => sum + v, 0);
      expect(seat.incomeTotal).toBe(total);
      // The income already presented per seat agrees with the ledger.
      const presented = income.find((entry) => entry.ownerId === seat.ownerId);
      expect(presented).toBeDefined();
      const presentedTotal = presented!.income.phaseBreakdown.perSlotBreakdown
        .reduce(
          (sum, slot) =>
            sum + slot.baseIncome + slot.synergyBonus + slot.repBonus
              + slot.eventDeltas.reduce((d, e) => d + e.delta, 0),
          0,
        );
      expect(seat.incomeTotal).toBe(presentedTotal);
    }
  });

  it('surfaces one entry per seat for a three-seat game', () => {
    const state = closingState('competitive-round-ledger-3', 3);
    const { result } = runClosing(state);

    const seats = result.playerRoundLedger!.seats;
    expect(seats.map((seat) => seat.ownerId)).toEqual([0, 1, 2]);
    expect(seats.map((seat) => seat.businessesOwned)).toEqual([2, 1, 1]);
    expect(seats[2].incomeTotal).toBe(2);
    expect(seats[2].netCoinChange).toBe(2);
  });

  it('omits an eliminated seat from the ledger', () => {
    // Three seats so eliminating one cannot trigger last-standing (which
    // would end the game before the closing's income phase runs).
    const state = closingState('competitive-round-ledger', 3);
    state.players![1].eliminated = true;
    const { result } = runClosing(state);

    expect(result.playerRoundLedger!.seats.map((seat) => seat.ownerId)).toEqual([0, 2]);
    // The closing itself already omits the eliminated seat from its income.
    expect((result.playerIncome ?? []).map((entry) => entry.ownerId)).toEqual([0, 2]);
  });

  it('is deterministic: an identical seeded run yields identical ledgers and wallets', () => {
    const first = closingState('competitive-round-ledger', 2);
    const second = closingState('competitive-round-ledger', 2);
    const a = runClosing(first);
    const b = runClosing(second);

    expect(a.result.playerRoundLedger).toEqual(b.result.playerRoundLedger);
    expect(first.players!.map((seat) => seat.coins))
      .toEqual(second.players!.map((seat) => seat.coins));
    expect(first.players!.map((seat) => seat.score))
      .toEqual(second.players!.map((seat) => seat.score));
  });

  // ── Deferred dual-choice resume ────────────────────────────

  it('is threaded through the deferred dual-choice resume (final net, measured from before the closing)', () => {
    const state = createCompetitiveState({
      seed: 'pause-4',
      playerCount: 2,
      difficulty: 'Easy',
      loansEnabled: false,
    });
    place(state, 0, makeBiz({ id: 'b0', baseIncome: 4, ongoingCost: 0 }), 0);
    place(state, 10, makeBiz({ id: 'b1', baseIncome: 6, ongoingCost: 0 }), 1);

    const { result, coinsBefore } = runClosing(state);
    // The seeded closing pauses on a dual-choice incident (this is the pause
    // the resume path exists for; if it ever stops pausing this test must be
    // re-pinned to another seed rather than silently lose the coverage).
    expect(result.choicePending).toBe(true);
    // The paused result already carries the seats the closing surfaced.
    expect(result.playerRoundLedger!.seats.map((seat) => seat.ownerId)).toEqual([0, 1]);

    const resumed = resolveCompetitivePendingChoice(state);
    expect(resumed).not.toBeNull();
    const seats = resumed!.playerRoundLedger!.seats;
    expect(seats.map((seat) => seat.ownerId)).toEqual([0, 1]);
    for (const seat of seats) {
      expect(seat.netCoinChange).toBe(state.players![seat.ownerId].coins - coinsBefore[seat.ownerId]);
    }
  });

  // ── Absent-safe ────────────────────────────────────────────

  it('is absent for an N=1 competitive closing (legacy shared path)', () => {
    const state = createCompetitiveState({
      seed: 'competitive-round-ledger-n1',
      playerCount: 1,
      difficulty: 'Easy',
      loansEnabled: false,
    });
    state.incidentDeck = [];
    const { result } = runClosing(state);

    expect(result.playerRoundLedger).toBeUndefined();
  });

  it('is absent for a single-player closing', () => {
    const state = createCompetitiveState({
      seed: 'competitive-round-ledger-sp',
      playerCount: 1,
      difficulty: 'Easy',
      loansEnabled: false,
    });
    state.players = [];
    state.ownerTaggedGrid = undefined;
    state.incidentDeck = [];
    executeWeekStart(state);
    const result = processEndOfTurn(state);

    expect(result.turnLedger).toBeDefined();
    expect(result.playerRoundLedger).toBeUndefined();
  });
});
