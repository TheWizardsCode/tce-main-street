/**
 * End-of-Turn Ledger — Engine Tests (MS-0MVP45KZV006TMUK)
 *
 * Verifies that `processEndOfTurn` populates `TurnResult.turnLedger` for the
 * legacy and deferred paths, and that every ledger value is testable from the
 * public engine API:
 *
 *  - incomeByPhase (base / synergy / reputation / events)
 *  - ongoingCosts (staff / community / business)
 *  - incidentCoinChange / incidentRepChange
 *  - oneOffDeltas (coins / reputation)
 *  - netCoinChange / netRepChange / netScoreChange (day-start baseline)
 *  - businessesOwned (owner-keyed; sold cards excluded)
 *  - deferred vs legacy parity, and competitive closings stay unaffected
 *
 * Fixture: an Easy game whose resource bank is raised far above the day-start
 * snapshot so the ledger's net rows are measurable; the street grid is cleared
 * and rebuilt with synthetic cards whose numbers are exact and known.
 */
import { describe, it, expect } from 'vitest';

import {
  acceptLoanOffer,
  applyEndOfTurnDeltas,
  buyAndPlaceBusiness,
  endCompetitiveMarketTurn,
  executeCommunityFavour,
  executeCompetitiveTurn,
  executeCompetitiveWeekStart,
  executeWeekStart,
  finishDeferredTurnClosing,
  playHeldEvent,
  processEndOfTurn,
  resolveCompetitiveClosingPhases,
  takeLoan,
} from '../../src/MainStreetEngine';
import {
  setupMainStreetGame,
  createCompetitiveState,
  serializeMainStreetState,
  deserializeMainStreetState,
  type MainStreetState,
} from '../../src/MainStreetState';
import type {
  BusinessCard,
  CommunitySpaceCard,
  EventCard,
  StaffCard,
} from '../../src/MainStreetCards';
import type { TurnLedger } from '../../src/MainStreetEngineTypes';
import { sellBusiness } from '../../src/MainStreetMarketSell';
import { playEventFromHand } from '../../src/MainStreetMarket';
import { bindCompetitiveSeat, restoreCompetitiveSeat } from '../../src/MainStreetAiStrategy';
import { recalculateCard } from '../../src/MainStreetAdjacency';
import { createActiveEffect } from '@core-engine';

// ── Fixture ─────────────────────────────────────────────────

const DAY_START_COINS = 3000;

function makeBusiness(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: 'biz-test-bakery',
    name: 'Test Bakery',
    cost: 0,
    baseIncome: 0,
    synergyTypes: ['Food'],
    maxLevel: 1,
    description: 'Synthetic test business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    ...overrides,
  } as BusinessCard;
}

function makeCommunitySpace(overrides: Partial<CommunitySpaceCard> = {}): CommunitySpaceCard {
  return {
    family: 'community-space',
    id: 'cs-test-park',
    name: 'Test Park',
    cost: 0,
    baseIncome: 0,
    ongoingCost: 0,
    synergyTypes: ['Culture'],
    maxLevel: 1,
    description: 'Synthetic test community space',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    reputationPerTurn: 0,
    ...overrides,
  } as CommunitySpaceCard;
}

function makeStaff(overrides: Partial<StaffCard> = {}): StaffCard {
  return {
    family: 'staff',
    id: 'stf-test-clerk',
    name: 'Test Clerk',
    cost: 0,
    ongoingCost: 100,
    handSlotsAdded: 0,
    description: 'Synthetic test staff',
    ...overrides,
  } as StaffCard;
}

function makeIncident(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event',
    id: 'evt-test-incident',
    name: 'Test Incident',
    trigger: 'Incident',
    cost: 0,
    effect: 'Test effect',
    target: 'All',
    coinDelta: -300,
    reputationDelta: 5,
    ...overrides,
  } as EventCard;
}

function makeInvestmentEvent(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event',
    id: 'evt-test-investment',
    name: 'Test Investment',
    trigger: 'Investment',
    cost: 0,
    effect: 'Test effect',
    target: 'All',
    coinDelta: 0,
    reputationDelta: 0,
    ...overrides,
  } as EventCard;
}

/** Refreshes every occupied slot's income/rep cache (mirrors a real placement). */
function refreshCaches(state: MainStreetState): void {
  for (let slotIndex = 0; slotIndex < state.streetGrid.length; slotIndex++) {
    if (state.streetGrid[slotIndex]) recalculateCard(state, slotIndex);
  }
}

/** Places a card at a grid slot and refreshes the caches of every card. */
function place(state: MainStreetState, slotIndex: number, card: BusinessCard | CommunitySpaceCard): void {
  state.streetGrid[slotIndex] = card;
  refreshCaches(state);
}

/**
 * Baseline fixture: coins raised to `DAY_START_COINS`, reputation zeroed, the
 * incident deck emptied, and the day-start snapshots aligned so ledger net
 * rows measure exactly this constructed turn. Incidents are added per-test.
 */
function createLedgerState(seed = 'end-of-turn-ledger'): MainStreetState {
  const state = setupMainStreetGame({ seed, difficulty: 'Easy' });
  state.streetGrid = state.streetGrid.map(() => null);
  state.soldSlots = state.soldSlots.map(() => false);
  state.staffCards = [];
  state.activeEffects = [];
  state.activeChallenges = [];
  state.hand = [];
  state.incidentDeck = [];
  state.phase = 'MarketPhase';
  state.resourceBank.coins = DAY_START_COINS;
  state.resourceBank.reputation = 0;
  state.weekStartCoins = DAY_START_COINS;
  state.weekStartRep = 0;
  state.weekStartScore = state.finalScore;
  return state;
}

/**
 * The full deterministic scenario used by the reconciliation test:
 *   - Bakery (100 base income, +30 rep/turn, Food, 40 ongoing)
 *   - Cafe (0 base income, Food — supplies 25 synergy to the Bakery)
 *   - Park community space (50 ongoing, Culture — no synergy with Food)
 *   - Clerk staff (100 ongoing)
 *   - Flu Outbreak income-multiplier (0.8×)
 *   - incident −300 coins / +5 rep drawn at closing
 *   - investment event −500 coins / +15 rep played during the MarketPhase
 */
function buildFullScenario(state: MainStreetState): void {
  place(state, 0, makeBusiness({
    id: 'biz-test-bakery', name: 'Test Bakery',
    baseIncome: 100, reputationPerTurn: 30, ongoingCost: 40,
  }));
  place(state, 1, makeBusiness({
    id: 'biz-test-cafe', name: 'Test Cafe', baseIncome: 0,
  }));
  place(state, 2, makeCommunitySpace({ ongoingCost: 50 }));
  state.staffCards.push(makeStaff());
  state.activeEffects.push(createActiveEffect('income-multiplier', 0.8, 3, 'evt-flu', 'Flu Outbreak'));
  state.incidentDeck.push(makeIncident());
  state.hand.push(makeInvestmentEvent({ coinDelta: -500, reputationDelta: 15 }));
  playHeldEvent(state);
}

// ── incomeByPhase ───────────────────────────────────────────

describe('turnLedger — incomeByPhase', () => {
  it('base: reports the base income subtotal for the income phase', () => {
    const state = createLedgerState('ledger-base');
    place(state, 0, makeBusiness({ baseIncome: 100 }));
    const result = processEndOfTurn(state);

    expect(result.turnLedger).toBeDefined();
    expect(result.turnLedger!.incomeByPhase.base).toBe(100);
    expect(result.turnLedger!.incomeByPhase.synergy).toBe(0);
  });

  it('synergy: reports the board-adjacency synergy subtotal', () => {
    const state = createLedgerState('ledger-synergy');
    place(state, 0, makeBusiness({ baseIncome: 100 }));
    // A different base-type Food neighbour shares the synergy type, so the
    // Bakery earns 100 × 0.5 (card rate) × 0.5 (Easy global rate) = 25 synergy;
    // the Cafe itself earns none.
    place(state, 1, makeBusiness({ id: 'biz-test-cafe', baseIncome: 0 }));
    const result = processEndOfTurn(state);

    expect(result.turnLedger).toBeDefined();
    expect(result.turnLedger!.incomeByPhase.base).toBe(100);
    expect(result.turnLedger!.incomeByPhase.synergy).toBe(25);
  });

  it('reputation: reports the reputation coin-multiplier bonus', () => {
    const state = createLedgerState('ledger-reputation');
    place(state, 0, makeBusiness({ baseIncome: 100 }));
    place(state, 1, makeBusiness({ id: 'biz-test-cafe', baseIncome: 0 }));
    // 800/8000 → 1.1× multiplier on the 125 base+synergy = 138 credited.
    state.resourceBank.reputation = 800;
    state.weekStartRep = 800;
    const result = processEndOfTurn(state);

    expect(result.turnLedger).toBeDefined();
    expect(result.turnLedger!.incomeByPhase.reputation).toBe(13);
    // The four phase subtotals equal the coins the income phase credited.
    const incomeCoins =
      result.turnLedger!.incomeByPhase.base +
      result.turnLedger!.incomeByPhase.synergy +
      result.turnLedger!.incomeByPhase.reputation +
      result.turnLedger!.incomeByPhase.events;
    expect(incomeCoins).toBe(138);
  });

  it('events: reports income-multiplier event deltas (negative for reductions)', () => {
    const state = createLedgerState('ledger-events');
    place(state, 0, makeBusiness({ baseIncome: 100 }));
    place(state, 1, makeBusiness({ id: 'biz-test-cafe', baseIncome: 0 }));
    state.activeEffects.push(createActiveEffect('income-multiplier', 0.8, 3, 'evt-flu', 'Flu Outbreak'));
    const result = processEndOfTurn(state);

    expect(result.turnLedger).toBeDefined();
    // 125 income × 0.8 = 100 credited, i.e. a −25 event delta.
    expect(result.turnLedger!.incomeByPhase.events).toBe(-25);
    expect(result.turnLedger!.incomeByPhase.base + result.turnLedger!.incomeByPhase.synergy
      + result.turnLedger!.incomeByPhase.events).toBe(100);
  });
});

// ── ongoingCosts ────────────────────────────────────────────

describe('turnLedger — ongoingCosts', () => {
  it('breaks expenses down per category (staff / community / business)', () => {
    const state = createLedgerState('ledger-ongoing');
    place(state, 0, makeBusiness({ baseIncome: 0, ongoingCost: 40 }));
    place(state, 2, makeCommunitySpace({ ongoingCost: 50 }));
    state.staffCards.push(makeStaff({ ongoingCost: 100 }));
    const result = processEndOfTurn(state);

    expect(result.turnLedger).toBeDefined();
    expect(result.turnLedger!.ongoingCosts.staff).toBe(-100);
    expect(result.turnLedger!.ongoingCosts.community).toBe(-50);
    expect(result.turnLedger!.ongoingCosts.business).toBe(-40);
  });
});

// ── incidents, one-off deltas, net rows, businessesOwned ────

describe('turnLedger — incidents, one-off deltas, net rows, businessesOwned', () => {
  it('incidentCoinChange / incidentRepChange carry the resolved incident deltas', () => {
    const state = createLedgerState('ledger-incident');
    state.incidentDeck.push(makeIncident({ coinDelta: -300, reputationDelta: 5 }));
    const result = processEndOfTurn(state);

    expect(result.turnLedger).toBeDefined();
    expect(result.turnLedger!.incidentCoinChange).toBe(-300);
    expect(result.turnLedger!.incidentRepChange).toBe(5);
  });

  it('oneOffDeltas capture MarketPhase spending/earning outside the closing phases', () => {
    const state = createLedgerState('ledger-one-off');
    place(state, 0, makeBusiness({ baseIncome: 100 }));
    // A −500 coin / +15 rep investment played during the MarketPhase is a
    // one-off: it is not income, ongoing cost or incident.
    state.hand.push(makeInvestmentEvent({ coinDelta: -500, reputationDelta: 15 }));
    playHeldEvent(state);
    const result = processEndOfTurn(state);

    expect(result.turnLedger).toBeDefined();
    expect(result.turnLedger!.oneOffDeltas.coins).toBe(-500);
    expect(result.turnLedger!.oneOffDeltas.reputation).toBe(15);
    // Net rep = income rep (0) + incident rep (0) + the event's one-off rep.
    expect(result.turnLedger!.netRepChange).toBe(15);
  });

  it('net rows reconcile against the day-start snapshot for a full turn', () => {
    const state = createLedgerState('ledger-reconcile');
    const coinsBefore = state.resourceBank.coins;
    const repBefore = state.resourceBank.reputation;
    const scoreBefore = state.weekStartScore;
    buildFullScenario(state);
    const result = processEndOfTurn(state);
    const ledger = result.turnLedger!;

    // Net rows mirror the authoritative state deltas (day start → closing).
    expect(ledger.netCoinChange).toBe(state.resourceBank.coins - coinsBefore);
    expect(ledger.netRepChange).toBe(state.resourceBank.reputation - repBefore);
    expect(ledger.netScoreChange).toBe(state.finalScore - scoreBefore);

    // Exact expectation for the constructed scenario:
    // income 100 base + 25 synergy + 0 rep + (−25 events) − 190 ongoing − 300 incident − 500 one-off.
    expect(ledger.netCoinChange).toBe(100 + 25 - 25 - 190 - 300 - 500);
    expect(ledger.netRepChange).toBe(30 + 5 + 15);

    // Reconciliation invariant: the ledger always balances.
    const incomeCoins =
      ledger.incomeByPhase.base + ledger.incomeByPhase.synergy
      + ledger.incomeByPhase.reputation + ledger.incomeByPhase.events;
    const ongoingCoins =
      ledger.ongoingCosts.staff + ledger.ongoingCosts.community + ledger.ongoingCosts.business;
    expect(incomeCoins + ongoingCoins + ledger.incidentCoinChange + ledger.oneOffDeltas.coins)
      .toBe(ledger.netCoinChange);
  });

  it('businessesOwned counts standing businesses per owner, excluding sold slots', () => {
    const state = createLedgerState('ledger-owned');
    place(state, 0, makeBusiness({ id: 'biz-test-bakery' }));
    place(state, 1, makeBusiness({ id: 'biz-test-cafe' }));
    place(state, 2, makeBusiness({ id: 'biz-test-gallery', baseIncome: 0 }));
    state.soldSlots[1] = true; // sold — no longer owned
    const result = processEndOfTurn(state);

    expect(result.turnLedger).toBeDefined();
    expect(result.turnLedger!.businessesOwned).toEqual({ '0': 2 });
  });
});

// ── Deferred path & competitive untouched ───────────────────

describe('turnLedger — deferred path and competitive', () => {
  it('deferred closing populates the same ledger as the legacy path', () => {
    // Two identical fixtures (same seed): one closes in-process (legacy), the
    // other uses the deferred-mutation path.
    const legacy = createLedgerState('ledger-parity');
    buildFullScenario(legacy);
    const legacyResult = processEndOfTurn(legacy);
    expect(legacyResult.turnLedger).toBeDefined();

    const deferred = createLedgerState('ledger-parity');
    buildFullScenario(deferred);
    const deferredResult = processEndOfTurn(deferred, { deferResourceApplication: true });
    // processEndOfTurn populates a ledger at pause time (projected balances).
    expect(deferredResult.turnLedger).toBeDefined();
    applyEndOfTurnDeltas(deferred, deferredResult);
    const closed = finishDeferredTurnClosing(deferred, deferredResult);
    expect(closed.turnLedger).toBeDefined();

    // Post-closing ledgers agree on every field.
    expect(closed.turnLedger).toEqual(legacyResult.turnLedger);
    // And each reconciles.
    expect(closed.turnLedger!.netCoinChange)
      .toBe(deferred.resourceBank.coins - deferred.weekStartCoins);
    expect(closed.turnLedger!.netScoreChange)
      .toBe(deferred.finalScore - deferred.weekStartScore);
  });

  it('competitive closings are unaffected: no turnLedger is attached', () => {
    const state = createCompetitiveState({
      seed: 'ledger-competitive',
      playerCount: 2,
    });
    const result = executeCompetitiveTurn(state, [[], []]);
    expect(result.turnLedger).toBeUndefined();
  });
});

// ── oneOffBreakdown per-source attribution (MS-0MWBZDNH3006DXV7) ──

describe('turnLedger — oneOffBreakdown per-source attribution (MS-0MWBZDNH3006DXV7)', () => {
  /** Maps a ledger's breakdown entries by their stable source label. */
  const bySource = (ledger: TurnLedger): Map<string, { label: string; coins: number; reputation: number }> =>
    new Map((ledger.oneOffBreakdown ?? []).map((entry) => [entry.label, entry]));

  it('attributes market purchase, market sale, event play and Community Favour, reconciling to the residual', () => {
    const state = createLedgerState('ledger-one-off-sources');

    // Market purchase: buy-and-place a 120-coin business (180 with the +50% premium).
    state.market.cards.push(makeBusiness({ id: 'biz-test-purchase', name: 'Test Purchase', cost: 120 }));
    const purchased = buyAndPlaceBusiness(state, 'biz-test-purchase', 0);
    expect(purchased.cost).toBe(180);

    // Market sale: a card placed directly on the grid is sold for its 1.5× refund.
    place(state, 1, makeBusiness({ id: 'biz-test-sell', name: 'Test Sell', cost: 100 }));
    const sold = sellBusiness(state, 1);
    expect(sold.refund).toBe(150);

    // Community Favour: 200 coins → 1 reputation (Easy rates).
    executeCommunityFavour(state, 'coins-to-rep');

    // Event play: a -500-coin / +15-rep Investment with a 50-coin play cost.
    state.hand.push(makeInvestmentEvent({ cost: 50, coinDelta: -500, reputationDelta: 15 }));
    playEventFromHand(state, 0);

    const result = processEndOfTurn(state);
    const ledger = result.turnLedger!;
    expect(ledger.oneOffBreakdown).toBeDefined();

    const entries = bySource(ledger);
    expect(entries.get('market-purchase')!.coins).toBe(-180);
    expect(entries.get('market-sale')!.coins).toBe(150);
    expect(entries.get('event-play')!.coins).toBe(-550); // -50 play cost + -500 effect
    expect(entries.get('event-play')!.reputation).toBe(15);
    expect(entries.get('community-favour')!.coins).toBe(-200);
    expect(entries.get('community-favour')!.reputation).toBe(1);

    // The breakdown reconciles exactly to the authoritative residual.
    const sum = ledger.oneOffBreakdown!.reduce((total, entry) => total + entry.coins, 0);
    expect(sum).toBe(ledger.oneOffDeltas.coins);
    expect(ledger.oneOffDeltas.coins).toBe(-180 + 150 - 200 - 550);
  });

  it('attributes a MarketPhase bank loan (principal) and its closing repayment', () => {
    const state = createLedgerState('ledger-one-off-loan');
    takeLoan(state, 0); // Easy menu option 0: 300 principal / 3 turns
    const loan = state.loans![0];
    expect(loan.principal).toBe(300);

    const result = processEndOfTurn(state);
    const ledger = result.turnLedger!;
    expect(ledger.oneOffBreakdown).toBeDefined();

    const entries = bySource(ledger);
    expect(entries.get('loan-taken')!.coins).toBe(300);
    expect(entries.get('loan-repayment')!.coins).toBe(-loan.perTurnRepayment);

    const sum = ledger.oneOffBreakdown!.reduce((total, entry) => total + entry.coins, 0);
    expect(sum).toBe(ledger.oneOffDeltas.coins);
  });

  it('attributes an accepted bailout loan (positive) and its closing repayment', () => {
    const state = createLedgerState('ledger-one-off-bailout');
    // The day "started" at −1 so every later coin movement is attributable:
    // the closing sees an insolvent wallet and pauses with a bailout offer.
    state.weekStartCoins = -1;
    state.resourceBank.coins = -1;

    const paused = processEndOfTurn(state);
    expect(paused.pendingLoanOffer).toBe(true);
    expect(state.pendingLoanOffer).toBeTruthy();

    acceptLoanOffer(state); // deterministic policy: the largest option (1000/10)
    const loan = state.loans![0];
    expect(loan.principal).toBe(1000);

    const result = processEndOfTurn(state);
    const ledger = result.turnLedger!;
    expect(ledger.oneOffBreakdown).toBeDefined();

    const entries = bySource(ledger);
    expect(entries.get('loan-bailout')!.coins).toBe(1000);
    expect(entries.get('loan-repayment')!.coins).toBe(-loan.perTurnRepayment);

    const sum = ledger.oneOffBreakdown!.reduce((total, entry) => total + entry.coins, 0);
    expect(sum).toBe(ledger.oneOffDeltas.coins);
  });

  it('omits the breakdown when nothing was attributed (absent-safe fallback)', () => {
    const state = createLedgerState('ledger-one-off-absent');
    const result = processEndOfTurn(state);
    const ledger = result.turnLedger!;
    expect(ledger.oneOffBreakdown).toBeUndefined();
    expect(ledger.oneOffDeltas).toEqual({ coins: 0, reputation: 0 });
  });

  it('per-source attribution round-trips through a mid-turn save/load (checkpoint-safe)', () => {
    const state = createLedgerState('ledger-one-off-saveload');
    state.market.cards.push(makeBusiness({ id: 'biz-test-purchase', name: 'Test Purchase', cost: 120 }));
    buyAndPlaceBusiness(state, 'biz-test-purchase', 0);

    const saved = serializeMainStreetState(state);
    const restored = deserializeMainStreetState(saved);
    expect(restored._oneOffAttribution?.get(0)?.marketPurchaseCost).toBe(-180);

    // The closing after load attributes the same source as a never-saved run.
    const ledger = processEndOfTurn(restored).turnLedger!;
    const entries = bySource(ledger);
    expect(entries.get('market-purchase')!.coins).toBe(-180);
    const sum = ledger.oneOffBreakdown!.reduce((total, entry) => total + entry.coins, 0);
    expect(sum).toBe(ledger.oneOffDeltas.coins);
  });

  it('reset at WeekStart: a new day starts with an empty per-source accumulator', () => {
    const state = createLedgerState('ledger-one-off-reset');
    state.market.cards.push(makeBusiness({ id: 'biz-test-purchase', name: 'Test Purchase', cost: 120 }));
    buyAndPlaceBusiness(state, 'biz-test-purchase', 0);
    expect(state._oneOffAttribution?.get(0)?.marketPurchaseCost).toBe(-180);

    state.phase = 'WeekStart';
    executeWeekStart(state);
    expect(state._oneOffAttribution ?? null).toBeNull();
  });

  it('attributes each competitive seat’s own one-off sources (competitive parity)', () => {
    const state = createCompetitiveState({
      seed: 'ledger-one-off-cmp',
      playerCount: 2,
      difficulty: 'Easy',
      loansEnabled: false,
    });
    executeCompetitiveWeekStart(state);
    // Seat 0's MarketPhase, bound exactly as the scene binds it: a 120-coin
    // business bought and placed for the +50% premium (180).
    bindCompetitiveSeat(state, 0);
    state.market.cards.push(makeBusiness({ id: 'biz-test-purchase', name: 'Test Purchase', cost: 120 }));
    buyAndPlaceBusiness(state, 'biz-test-purchase', 0);
    restoreCompetitiveSeat(state, 0);
    endCompetitiveMarketTurn(state); // advance to seat 1 (does nothing)
    endCompetitiveMarketTurn(state); // last seat: phase → InvestmentResolution

    const result = resolveCompetitiveClosingPhases(state);
    const seats = result.playerRoundLedger!.seats;
    const seat0 = seats.find((seat) => seat.ownerId === 0)!;
    expect(seat0.oneOffBreakdown).toEqual([
      { label: 'market-purchase', coins: -180, reputation: 0 },
    ]);
    expect(seat0.oneOffBreakdown!.reduce((total, entry) => total + entry.coins, 0))
      .toBe(seat0.oneOffDeltas!.coins);

    // Seat 1 did nothing: no attribution, formula-only fallback.
    const seat1 = seats.find((seat) => seat.ownerId === 1)!;
    expect(seat1.oneOffBreakdown).toBeUndefined();
  });
});
