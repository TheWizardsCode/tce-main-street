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
  executeCompetitiveTurn,
  resolveCompetitiveClosingPhases,
  resolveCompetitivePendingChoice,
} from '../../src/MainStreetEngineCompetitiveTurn';
import {
  applyCompetitiveOngoingCosts,
  executeAction,
  executeCompetitiveWeekStart,
  executeWeekStart,
  processEndOfTurn,
} from '../../src/MainStreetEngine';
import { bindCompetitiveSeat, restoreCompetitiveSeat } from '../../src/MainStreetAiStrategy';
import { recalculateCard } from '../../src/MainStreetAdjacency';
import type {
  BusinessCard,
  CommunitySpaceCard,
  EventCard,
  StaffCard,
} from '../../src/MainStreetCards';
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

/** A community-space card with an exact ongoing cost (per-owner charging). */
function makeSpace(overrides: Partial<CommunitySpaceCard> = {}): CommunitySpaceCard {
  return {
    family: 'community-space',
    id: overrides.id ?? 'test-space',
    name: overrides.name ?? 'Test Space',
    cost: overrides.cost ?? 5,
    baseIncome: overrides.baseIncome ?? 0,
    synergyTypes: overrides.synergyTypes ?? [],
    description: overrides.description ?? 'A test community space',
    level: overrides.level ?? 0,
    incomeBonus: overrides.incomeBonus ?? 0,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    reputationBonus: overrides.reputationBonus ?? 0,
    ongoingCost: overrides.ongoingCost ?? 0,
  } as CommunitySpaceCard;
}

/** A staff card with an exact salary and optional specialization skills. */
function makeStaff(overrides: Partial<StaffCard> = {}): StaffCard {
  return {
    family: 'staff',
    id: overrides.id ?? 'test-staff',
    name: overrides.name ?? 'Test Staff',
    cost: overrides.cost ?? 10,
    ongoingCost: overrides.ongoingCost ?? 0,
    actionsPerTurn: overrides.actionsPerTurn ?? 0,
    handSlotsAdded: overrides.handSlotsAdded ?? 0,
    reputationPerTurn: overrides.reputationPerTurn ?? 0,
    specializationSkillIds: overrides.specializationSkillIds ?? [],
    description: overrides.description ?? 'A test staff member',
  } as unknown as StaffCard;
}

/** Places a card on a slot and tags its owner (the competitive placement). */
function place(
  state: MainStreetState,
  slotIndex: number,
  card: BusinessCard | CommunitySpaceCard,
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

// ── Per-seat ongoing-expense breakdown ───────────────────────

/**
 * Per-seat ongoing-expense breakdown (MS-0MVRNVHJ50095N9Y).
 *
 * `applyCompetitiveOngoingCosts` charges each seat's own wallet but used to
 * discard the split; it now returns it, so the panel can show what each seat
 * actually spent per category. These tests pin the values **and** the
 * unchanged economy: the wallets move exactly as before, and the breakdown
 * always reconciles with the coins actually deducted.
 */
describe('per-seat ongoing expense breakdown (MS-0MVRNVHJ50095N9Y)', () => {
  /** Two clean-wallet seats with no incident deck — the breakdown fixture. */
  function costState(seed: string): MainStreetState {
    const state = createCompetitiveState({
      seed,
      playerCount: 2,
      difficulty: 'Easy',
      loansEnabled: false,
    });
    state.incidentDeck = [];
    for (const seat of state.players!) seat.coins = 1000;
    return state;
  }

  it('splits each seat’s ongoing costs into staff / community / business', () => {
    const state = costState('ongoing-breakdown-mixed');
    // Seat 0: business 10 + community space 4 + staff salary 20.
    place(state, 0, makeBiz({ id: 'b0', ongoingCost: 10 }), 0);
    place(state, 1, makeSpace({ id: 'c0', ongoingCost: 4 }), 0);
    state.players![0].staffCards = [makeStaff({ id: 's0', ongoingCost: 20 })];
    // Seat 1: one business, no staff, no community spaces.
    place(state, 10, makeBiz({ id: 'b1', ongoingCost: 6 }), 1);

    const coinsBefore = state.players!.map((seat) => seat.coins);
    const breakdown = applyCompetitiveOngoingCosts(state);

    expect(breakdown.get(0)).toEqual({ staff: -20, community: -4, business: -10 });
    // A seat with no staff or community spaces still records zero rows.
    expect(breakdown.get(1)).toEqual({ staff: 0, community: 0, business: -6 });

    // Reporting-only: each seat's wallet moves exactly as it did before this
    // value was surfaced, and the breakdown sums to that movement.
    for (const seat of state.players!) {
      const charged = breakdown.get(seat.playerId)!;
      expect(seat.coins).toBe(coinsBefore[seat.playerId] + charged.staff + charged.community + charged.business);
    }
    expect(state.players![0].coins).toBe(1000 - 34);
    expect(state.players![1].coins).toBe(1000 - 6);
  });

  it('applies the Cost Cutter reduction to every category', () => {
    const state = costState('ongoing-breakdown-cutter');
    // The host staff set carries the street-wide Cost Cutter for the slot
    // families (the shared reduction source, unchanged by this slice).
    state.staffCards = [
      makeStaff({ id: 'host-cutter', ongoingCost: 0, specializationSkillIds: ['skill-cost-cutter'] }),
    ];
    place(state, 0, makeBiz({ id: 'b0', ongoingCost: 100 }), 0);
    place(state, 1, makeSpace({ id: 'c0', ongoingCost: 100 }), 0);
    // The seat's own Cost Cutter reduces its staff salaries.
    state.players![0].staffCards = [
      makeStaff({ id: 's0', ongoingCost: 100, specializationSkillIds: ['skill-cost-cutter'] }),
    ];

    const breakdown = applyCompetitiveOngoingCosts(state);

    // -15% of 100 → 85 charged in each category.
    expect(breakdown.get(0)).toEqual({ staff: -85, community: -85, business: -85 });
    expect(state.players![0].coins).toBe(1000 - 255);
  });

  it('excludes sold slots from the breakdown (and charges nothing for them)', () => {
    const state = costState('ongoing-breakdown-sold');
    place(state, 0, makeBiz({ id: 'sold', ongoingCost: 100 }), 0);
    state.soldSlots[0] = true;
    place(state, 10, makeBiz({ id: 'live', ongoingCost: 7 }), 1);

    const breakdown = applyCompetitiveOngoingCosts(state);

    // The sold card's owner has no entry at all — nothing was charged.
    expect(breakdown.get(0)).toBeUndefined();
    expect(breakdown.get(1)).toEqual({ staff: 0, community: 0, business: -7 });
    expect(state.players![0].coins).toBe(1000);
  });

  it('clamps the breakdown to the coins actually deducted when a seat runs short', () => {
    const state = costState('ongoing-breakdown-clamp');
    // 20 business + 20 community owed; only 30 coins available.
    place(state, 0, makeBiz({ id: 'b0', ongoingCost: 20 }), 0);
    place(state, 1, makeSpace({ id: 'c0', ongoingCost: 20 }), 0);
    state.players![0].coins = 30;

    const breakdown = applyCompetitiveOngoingCosts(state);

    // Insufficiency handling is unchanged: the single combined charge still
    // clamps at the wallet, and the reporting split sums to exactly that 30
    // (allocated by the two families' equal raw shares).
    expect(state.players![0].coins).toBe(0);
    expect(breakdown.get(0)).toEqual({ staff: 0, community: -15, business: -15 });
  });

  it('threads each seat’s breakdown onto the round ledger of the closing', () => {
    const state = closingState('competitive-round-ledger-costs', 2);
    // Seat 0 also pays a staff salary on top of its two businesses' costs.
    state.players![0].staffCards = [makeStaff({ id: 's0', ongoingCost: 5 })];

    const { result } = runClosing(state);

    const [human, ai] = result.playerRoundLedger!.seats;
    // closingState: seat 0 owns b0 (cost 2) + b1 (cost 0); seat 1 owns b2 (cost 1).
    expect(human.ongoingCosts).toEqual({ staff: -5, community: 0, business: -2 });
    expect(ai.ongoingCosts).toEqual({ staff: 0, community: 0, business: -1 });

    // The ledger reconciles: with no incident drawn and no loans, a seat's net
    // change is its income plus the expenses reported in the breakdown.
    for (const seat of result.playerRoundLedger!.seats) {
      const costs = seat.ongoingCosts!;
      expect(seat.netCoinChange).toBe(
        seat.incomeTotal + costs.staff + costs.community + costs.business,
      );
    }
  });
});

// ── Per-seat net, closing balances and incident/one-off parity ───

/**
 * Per-seat net change, closing balances and incident/one-off parity
 * (MS-0MVRNW26W0070CP0).
 *
 * The competitive round ledger already reported income, ongoing costs and a
 * closing-baseline net coin change. This slice rounds each seat row out with
 * the figures the single-player ledger reports: the day's net coin /
 * reputation / score change against a **day-start** snapshot, the closing
 * coin / reputation / score balances (the seat's committed `PlayerRecord`),
 * and the seat's own share of the resolved incident and one-off deltas.
 *
 * The values are engine-computed and reporting-only: they mirror wallet
 * movements the closing already applied, so a real engine run must reconcile
 * exactly (`day-start + net == closing`) without the ledger moving a wallet.
 */
describe('per-seat net, closing balances and incident/one-off deltas (MS-0MVRNW26W0070CP0)', () => {
  /** A deterministic shared incident routed to every seat (target `All`). */
  function makeIncident(overrides: Partial<EventCard> = {}): EventCard {
    return {
      family: 'event',
      id: overrides.id ?? 'incident-test',
      name: overrides.name ?? 'Test Incident',
      trigger: overrides.trigger ?? 'Incident',
      cost: overrides.cost ?? 0,
      effect: overrides.effect ?? 'A test incident',
      target: overrides.target ?? 'All',
      coinDelta: overrides.coinDelta ?? -5,
      reputationDelta: overrides.reputationDelta ?? -2,
      ...overrides,
    } as EventCard;
  }

  it('reconciles day-start + net to each seat’s committed wallet across two seeds', () => {
    for (const seed of ['seat-net-closing-a', 'seat-net-closing-b']) {
      const state = closingState(seed, 2);
      // A real day start: the per-seat day-start snapshot is taken at WeekStart.
      executeCompetitiveWeekStart(state, true);
      const dayStart = state.players!.map((seat) => ({
        coins: seat.coins,
        reputation: seat.reputation,
        score: seat.score,
      }));

      const { result } = runClosing(state);
      const seats = result.playerRoundLedger!.seats;
      expect(seats.map((seat) => seat.ownerId)).toEqual([0, 1]);

      for (const seat of seats) {
        const player = state.players![seat.ownerId];
        // The ledger reports the day-start snapshot it measured against…
        expect(seat.dayStart).toEqual(dayStart[seat.ownerId]);
        // …and the closing balances are the committed wallet, not a projection.
        expect(seat.closing).toEqual({
          coins: player.coins,
          reputation: player.reputation,
          score: player.score,
        });
        // The reconciliation identity holds per seat, for all three resources.
        expect(seat.dayStart!.coins + seat.netCoinChange).toBe(seat.closing!.coins);
        expect(seat.dayStart!.reputation + seat.netRepChange!).toBe(seat.closing!.reputation);
        expect(seat.dayStart!.score + seat.netScoreChange!).toBe(seat.closing!.score);
        // Every reported row reconciles with the net coin change.
        const costs = seat.ongoingCosts ?? { staff: 0, community: 0, business: 0 };
        expect(seat.netCoinChange).toBe(
          seat.incomeTotal
            + costs.staff + costs.community + costs.business
            + (seat.incidentCoinChange ?? 0)
            + (seat.oneOffDeltas?.coins ?? 0),
        );
      }
    }
  });

  it('is exercised end-to-end through the real full-day engine run', () => {
    const state = closingState('seat-net-full-day', 2);
    // `executeCompetitiveTurn` starts the shared day itself (so the day-start
    // snapshot is the engine's own) and runs the whole closing.
    const startWallets = state.players!.map((seat) => ({
      coins: seat.coins,
      reputation: seat.reputation,
      score: seat.score,
    }));
    const result = executeCompetitiveTurn(state, [[], []]);

    const seats = result.playerRoundLedger!.seats;
    expect(seats.map((seat) => seat.ownerId)).toEqual([0, 1]);
    for (const seat of seats) {
      const player = state.players![seat.ownerId];
      expect(seat.closing).toEqual({
        coins: player.coins,
        reputation: player.reputation,
        score: player.score,
      });
      // No MarketPhase actions were taken, so the day-start snapshot equals
      // the pre-day wallets and the identity still reconciles.
      expect(seat.dayStart!.coins + seat.netCoinChange).toBe(seat.closing!.coins);
      expect(seat.dayStart!.reputation + seat.netRepChange!).toBe(seat.closing!.reputation);
      expect(seat.dayStart!.score + seat.netScoreChange!).toBe(seat.closing!.score);
      // A seat that did nothing reports no incident / one-off movement.
      expect(seat.incidentCoinChange).toBe(0);
      expect(seat.incidentRepChange).toBe(0);
      expect(seat.oneOffDeltas).toEqual({ coins: 0, reputation: 0 });
      expect(seat.dayStart!.coins).toBe(startWallets[seat.ownerId].coins);
    }
  });

  it('includes the seat’s own MarketPhase spending in the net and the one-off row', () => {
    const state = closingState('seat-net-oneoff', 2);
    executeCompetitiveWeekStart(state, true);

    // A real MarketPhase action, bound to the seat exactly as the engine and
    // Monte-Carlo day loops do (the shared wallet *is* the acting seat).
    state.phase = 'MarketPhase';
    state.activePlayerId = 0;
    bindCompetitiveSeat(state, 0);
    const beforeCoins = state.players![0].coins;
    const beforeRep = state.players![0].reputation;
    executeAction(state, { type: 'community-favour', direction: 'coins-to-rep' });
    restoreCompetitiveSeat(state, 0);

    const spentCoins = state.players![0].coins - beforeCoins;
    const gainedRep = state.players![0].reputation - beforeRep;
    expect(spentCoins).toBeLessThan(0);
    expect(gainedRep).toBeGreaterThan(0);

    const { result } = runClosing(state);
    const human = result.playerRoundLedger!.seats.find((seat) => seat.ownerId === 0)!;
    const ai = result.playerRoundLedger!.seats.find((seat) => seat.ownerId === 1)!;

    // The day-start baseline predates the MarketPhase spend, so the net change
    // covers the whole day (matching the single-player ledger)…
    expect(human.dayStart!.coins).toBe(beforeCoins);
    expect(human.dayStart!.coins + human.netCoinChange).toBe(human.closing!.coins);
    // …and the spend is attributed to the one-off row, not to income or costs.
    expect(human.incidentCoinChange).toBe(0);
    expect(human.oneOffDeltas!.coins).toBe(spentCoins);
    expect(human.oneOffDeltas!.reputation).toBe(gainedRep);
    expect(human.dayStart!.reputation + human.netRepChange!).toBe(human.closing!.reputation);

    // The idle seat keeps a zero one-off row.
    expect(ai.oneOffDeltas).toEqual({ coins: 0, reputation: 0 });
  });

  it('reports each seat’s share of the resolved incident', () => {
    const state = closingState('seat-incident-share', 2);
    state.incidentDeck = [
      makeIncident({ id: 'incident-flat', name: 'Flat Incident', coinDelta: -5, reputationDelta: -2 }),
    ];
    executeCompetitiveWeekStart(state, true);

    const { result } = runClosing(state);
    const seats = result.playerRoundLedger!.seats;
    expect(seats.map((seat) => seat.ownerId)).toEqual([0, 1]);

    for (const seat of seats) {
      // Every seat is routed the same flat incident (no staff mitigation).
      expect(seat.incidentCoinChange).toBe(-5);
      expect(seat.incidentRepChange).toBe(-2);
      // The reported share is part of the net and reconciles with it.
      const costs = seat.ongoingCosts ?? { staff: 0, community: 0, business: 0 };
      expect(seat.netCoinChange).toBe(
        seat.incomeTotal + costs.staff + costs.community + costs.business - 5
          + (seat.oneOffDeltas?.coins ?? 0),
      );
      expect(seat.dayStart!.reputation + seat.netRepChange!).toBe(seat.closing!.reputation);
      // The seats have no reputation income and no MarketPhase reputation
      // movement, so the whole reputation change is the incident share.
      expect(seat.netRepChange).toBe(-2);
      expect(seat.oneOffDeltas!.reputation).toBe(0);
    }
  });

  it('keeps the day-start and incident values through the deferred dual-choice resume', () => {
    const state = createCompetitiveState({
      seed: 'pause-4',
      playerCount: 2,
      difficulty: 'Easy',
      loansEnabled: false,
    });
    place(state, 0, makeBiz({ id: 'b0', baseIncome: 4, ongoingCost: 0 }), 0);
    place(state, 10, makeBiz({ id: 'b1', baseIncome: 6, ongoingCost: 0 }), 1);

    // No day start here: the ledger falls back to the pre-closing snapshot,
    // which must survive the pause exactly as the accumulator does.
    const walletsBefore = state.players!.map((seat) => ({
      coins: seat.coins,
      reputation: seat.reputation,
      score: seat.score,
    }));
    const { result } = runClosing(state);
    expect(result.choicePending).toBe(true);
    expect(result.playerRoundLedger!.seats.map((seat) => seat.ownerId)).toEqual([0, 1]);

    const resumed = resolveCompetitivePendingChoice(state);
    expect(resumed).not.toBeNull();
    const seats = resumed!.playerRoundLedger!.seats;
    for (const seat of seats) {
      const player = state.players![seat.ownerId];
      expect(seat.dayStart).toEqual(walletsBefore[seat.ownerId]);
      expect(seat.closing).toEqual({
        coins: player.coins,
        reputation: player.reputation,
        score: player.score,
      });
      expect(seat.dayStart!.coins + seat.netCoinChange).toBe(seat.closing!.coins);
      expect(seat.dayStart!.reputation + seat.netRepChange!).toBe(seat.closing!.reputation);
      expect(seat.dayStart!.score + seat.netScoreChange!).toBe(seat.closing!.score);
      const costs = seat.ongoingCosts ?? { staff: 0, community: 0, business: 0 };
      expect(seat.netCoinChange).toBe(
        seat.incomeTotal + costs.staff + costs.community + costs.business
          + (seat.incidentCoinChange ?? 0)
          + (seat.oneOffDeltas?.coins ?? 0),
      );
    }
  });
});
