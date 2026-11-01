/**
 * Turn Summary Model — Pure Node Tests (MS-0MVP45WBA001GAVY)
 *
 * Verifies the Phaser-free {@link buildTurnSummary} model renders the whole
 * Turn Summary dialog content from the committed `TurnResult.turnLedger` plus
 * `MainStreetState` — one test per surfaced value:
 *
 *  - businesses owned (owner-keyed; human seat rendered)
 *  - income subtotals per phase (base / synergy / reputation / events) + total
 *  - ongoing expenses per category (staff / community / business) + total
 *  - incident coin/reputation deltas + incident name
 *  - one-off deltas (coins / reputation)
 *  - net coin/reputation/score change
 *  - closing coin/reputation/score balances (day-start snapshot + net)
 *  - owner-keyed multi-owner shape (future per-player rows)
 *  - `null` when the result carries no ledger (competitive / hand-built)
 *
 * Fixtures are hand-built ledgers that reconcile exactly (rows sum to the net;
 * closing = day-start + net) plus one real-engine integration test asserting
 * the model reflects actual `processEndOfTurn` output.
 */
import { describe, expect, it } from 'vitest';

import type { MainStreetState } from '../../src/MainStreetState';
import { createCompetitiveState, setupMainStreetGame } from '../../src/MainStreetState';
import type { TurnLedger, TurnResult } from '../../src/MainStreetEngineTypes';
import { processEndOfTurn } from '../../src/MainStreetEngine';
import type { BusinessCard, EventCard } from '../../src/MainStreetCards';
import { recalculateCard } from '../../src/MainStreetAdjacency';
import { buildTurnSummary } from '../../src/scenes/MainStreetTurnSummary';

// ── Fixtures ─────────────────────────────────────────────────

/** A single-player state whose wallet equals the closing balances below. */
function singlePlayerState(turn = 7): MainStreetState {
  const state = setupMainStreetGame({ seed: 'turn-summary-model', difficulty: 'Easy' });
  state.turn = turn;
  state.players = [];
  // Good-faith pre-turn balances:
  state.weekStartCoins = 1000;
  state.weekStartRep = 10;
  state.weekStartScore = 20;
  // Closing balances = snapshot + net (net from the fixture ledger):
  state.resourceBank.coins = 990;
  state.resourceBank.reputation = 12;
  state.finalScore = 34;
  return state;
}

/**
 * An internally consistent ledger: income (+140) + expenses (−80) +
 * incident (−40) + one-off (−30) balances the net coin change (−10), and the
 * state above closes at the snapshot + net values.
 */
function makeLedger(overrides: Partial<TurnLedger> = {}): TurnLedger {
  return {
    incomeByPhase: { base: 120, synergy: 30, reputation: 10, events: -20 },
    ongoingCosts: { staff: -50, community: -20, business: -10 },
    incidentCoinChange: -40,
    incidentRepChange: -2,
    oneOffDeltas: { coins: -30, reputation: 4 },
    netCoinChange: -10,
    netRepChange: 2,
    netScoreChange: 14,
    businessesOwned: { '0': 3 },
    ...overrides,
  };
}

/** The model's input: a result carrying an optional ledger + incident. */
function summaryInput(
  ledger: TurnLedger | undefined,
  incidentName: string | null = 'Test Incident',
): Pick<TurnResult, 'turnLedger' | 'incident'> {
  return {
    turnLedger: ledger,
    incident: incidentName == null ? null : ({ name: incidentName } as EventCard),
  };
}

/** Places a business card and refreshes its income caches. */
function place(state: MainStreetState, slot: number, card: BusinessCard): void {
  state.streetGrid[slot] = card;
  recalculateCard(state, slot);
}

// ── No ledger → no summary ───────────────────────────────────

describe('buildTurnSummary — ledger presence', () => {
  it('returns null when the result carries no ledger (competitive / hand-built)', () => {
    const state = singlePlayerState();
    const input = summaryInput(undefined, null);
    expect(buildTurnSummary(state, input)).toBeNull();
  });

  it('surfaces the closing turn number and the resolved incident name', () => {
    const summary = buildTurnSummary(singlePlayerState(7), summaryInput(makeLedger()));
    expect(summary).not.toBeNull();
    expect(summary!.turn).toBe(7);
    expect(summary!.incidentName).toBe('Test Incident');

    const noIncident = buildTurnSummary(singlePlayerState(3), summaryInput(makeLedger(), null));
    expect(noIncident!.incidentName).toBeNull();
  });
});

// ── Income ───────────────────────────────────────────────────

describe('buildTurnSummary — income', () => {
  it('reports the per-phase income subtotals with labels', () => {
    const summary = buildTurnSummary(singlePlayerState(), summaryInput(makeLedger()))!;
    expect(summary.income).toEqual([
      { phase: 'base', label: 'Base income', coins: 120 },
      { phase: 'synergy', label: 'Synergy income', coins: 30 },
      { phase: 'reputation', label: 'Reputation income', coins: 10 },
      { phase: 'events', label: 'Event income', coins: -20 },
    ]);
  });

  it('totals the income phases', () => {
    const summary = buildTurnSummary(singlePlayerState(), summaryInput(makeLedger()))!;
    expect(summary.incomeTotal).toBe(140);
  });
});

// ── Ongoing expenses ─────────────────────────────────────────

describe('buildTurnSummary — ongoing expenses', () => {
  it('reports the per-category expense subtotals with labels', () => {
    const summary = buildTurnSummary(singlePlayerState(), summaryInput(makeLedger()))!;
    expect(summary.expenses).toEqual([
      { category: 'staff', label: 'Staff wages', coins: -50 },
      { category: 'community', label: 'Community spaces', coins: -20 },
      { category: 'business', label: 'Business costs', coins: -10 },
    ]);
  });

  it('totals the expense categories', () => {
    const summary = buildTurnSummary(singlePlayerState(), summaryInput(makeLedger()))!;
    expect(summary.expensesTotal).toBe(-80);
  });
});

// ── Incident & one-off deltas ────────────────────────────────

describe('buildTurnSummary — incident and one-off deltas', () => {
  it('reports the incident coin and reputation deltas', () => {
    const summary = buildTurnSummary(singlePlayerState(), summaryInput(makeLedger()))!;
    expect(summary.incident).toEqual({ coins: -40, reputation: -2 });
  });

  it('reports the one-off coin and reputation deltas', () => {
    const summary = buildTurnSummary(singlePlayerState(), summaryInput(makeLedger()))!;
    expect(summary.oneOff).toEqual({ coins: -30, reputation: 4 });
  });
});

// ── Net change & closing balances ────────────────────────────

describe('buildTurnSummary — net and closing', () => {
  it('reports the net coin/reputation/score change', () => {
    const summary = buildTurnSummary(singlePlayerState(), summaryInput(makeLedger()))!;
    expect(summary.net).toEqual({ coins: -10, reputation: 2, score: 14 });
  });

  it('derives closing balances from the day-start snapshot plus the net change', () => {
    const summary = buildTurnSummary(singlePlayerState(), summaryInput(makeLedger()))!;
    expect(summary.closing).toEqual({ coins: 990, reputation: 12, score: 34 });
  });

  it('falls back to the live wallet when the day-start snapshot is unset', () => {
    const state = singlePlayerState();
    // Legacy/hand-built state without snapshots: the engine ledger nets to 0,
    // so the closing balances are the live wallet.
    delete (state as Partial<MainStreetState>).weekStartCoins;
    delete (state as Partial<MainStreetState>).weekStartRep;
    delete (state as Partial<MainStreetState>).weekStartScore;
    const ledger = makeLedger({ netCoinChange: 0, netRepChange: 0, netScoreChange: 0 });
    const summary = buildTurnSummary(state, summaryInput(ledger))!;
    expect(summary.closing).toEqual({ coins: 990, reputation: 12, score: 34 });
  });
});

// ── Businesses owned (owner-keyed) ───────────────────────────

describe('buildTurnSummary — businesses owned', () => {
  it('single-player: one owner row with the human label and closing wallet', () => {
    const summary = buildTurnSummary(singlePlayerState(), summaryInput(makeLedger()))!;
    expect(summary.owners).toHaveLength(1);
    expect(summary.owners[0]).toMatchObject({
      ownerId: '0',
      playerId: 0,
      label: 'You',
      isHuman: true,
      businessesOwned: 3,
      coins: 990,
      reputation: 12,
      score: 34,
    });
    expect(summary.humanOwner).toEqual(summary.owners[0]);
  });

  it('owner-keyed: one row per owner with that owner’s wallet (future per-player rows)', () => {
    const state = createCompetitiveState({ seed: 'turn-summary-model-cmp', playerCount: 2 });
    state.turn = 5;
    state.weekStartCoins = 1000;
    state.weekStartRep = 10;
    state.weekStartScore = 0;
    state.resourceBank.coins = 1000;
    state.resourceBank.reputation = 10;
    state.finalScore = 0;
    state.players![0].coins = 600;
    state.players![0].reputation = 30;
    state.players![0].score = 45;
    state.players![1].coins = 250;
    state.players![1].reputation = 8;
    state.players![1].score = 40;

    const ledger = makeLedger({ businessesOwned: { '0': 2, '1': 1 } });
    const summary = buildTurnSummary(state, summaryInput(ledger, null))!;

    expect(summary.owners).toHaveLength(2);
    expect(summary.owners[0]).toMatchObject({
      ownerId: '0', label: 'You', isHuman: true, businessesOwned: 2, coins: 600, reputation: 30, score: 45,
    });
    expect(summary.owners[1]).toMatchObject({
      ownerId: '1', label: 'AI 1', isHuman: false, businessesOwned: 1, coins: 250, reputation: 8, score: 40,
    });
    // The dialog renders the single human seat:
    expect(summary.humanOwner?.ownerId).toBe('0');
  });

  it('an empty street yields no owner rows but still reports the turn figures', () => {
    const ledger = makeLedger({ businessesOwned: {} });
    const summary = buildTurnSummary(singlePlayerState(), summaryInput(ledger, null))!;
    expect(summary.owners).toEqual([]);
    expect(summary.humanOwner).toBeNull();
    expect(summary.closing).toEqual({ coins: 990, reputation: 12, score: 34 });
    expect(summary.incomeTotal).toBe(140);
  });
});

// ── Real-engine integration ──────────────────────────────────

describe('buildTurnSummary — committed engine data', () => {
  it('renders an actual processEndOfTurn result from committed state', () => {
    const state = setupMainStreetGame({ seed: 'turn-summary-integration', difficulty: 'Easy' });
    state.phase = 'MarketPhase';
    state.streetGrid = state.streetGrid.map(() => null);
    state.soldSlots = state.soldSlots.map(() => false);
    state.incidentDeck = []; // no incident this turn
    state.staffCards = [];
    state.activeEffects = [];
    state.activeChallenges = [];
    state.hand = [];
    // Zero reputation so no reputation coin multiplier distorts the income
    // subtotals (the engine's ledger tests do the same).
    state.resourceBank.reputation = 0;
    state.weekStartCoins = state.resourceBank.coins;
    state.weekStartRep = 0;
    state.weekStartRep = state.resourceBank.reputation;
    state.weekStartScore = state.finalScore;

    place(state, 0, {
      family: 'business',
      id: 'biz-test-bakery',
      name: 'Test Bakery',
      cost: 0,
      baseIncome: 150,
      synergyTypes: ['Food'],
      maxLevel: 1,
      description: 'Synthetic test business',
      level: 0,
      incomeBonus: 0,
      synergyRangeBonus: 0,
      reputationBonus: 0,
      ongoingCost: 0,
    } as BusinessCard);

    const result = processEndOfTurn(state); // legacy path: deltas applied
    const summary = buildTurnSummary(state, result)!;

    expect(summary).not.toBeNull();
    // Income phase claims the business' base income:
    expect(summary.income.find((row) => row.phase === 'base')!.coins).toBe(150);
    expect(summary.incomeTotal).toBe(150);
    // No costs, incident or one-offs: net = income.
    expect(summary.expensesTotal).toBe(0);
    expect(summary.incident).toEqual({ coins: 0, reputation: 0 });
    expect(summary.oneOff).toEqual({ coins: 0, reputation: 0 });
    expect(summary.net.coins).toBe(150);
    expect(summary.net.reputation).toBe(0);
    // Closing balances match the committed post-turn wallet.
    expect(summary.closing.coins).toBe(state.resourceBank.coins);
    expect(summary.closing.reputation).toBe(state.resourceBank.reputation);
    expect(summary.closing.score).toBe(state.finalScore);
    // One human owner with the standing business.
    expect(summary.owners).toHaveLength(1);
    expect(summary.owners[0].businessesOwned).toBe(1);
    expect(summary.humanOwner?.label).toBe('You');
    expect(summary.incidentName).toBeNull();
  });
});
