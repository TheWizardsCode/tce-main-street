/**
 * Turn Summary — profit/loss (P&L) projection model — MS-0MW5EPEXW000AZKO
 *
 * Parent MS-0MW4XULA90002OEY turns the end-of-turn Turn Summary into a
 * per-player **profit/loss statement for the management company**. This suite
 * pins the Phaser-free projection the tabbed dialog renders (producer answers
 * Q1=A, Q2=A, Q3=A):
 *
 *  - Income section (base / synergy / reputation / events) with a total;
 *  - Less: Operating expenses section (staff / community / business) with a
 *    total;
 *  - Incident and One-off adjustment lines;
 *  - the emphasised Net profit/loss bottom line;
 *  - non-monetary figures (reputation/score change, closing coins, businesses
 *    owned) as **supplementary context**, never as P&L lines;
 *  - the reconciliation identity
 *    `incomeTotal + expensesTotal + incident.coins + oneOff.coins === net.coins`;
 *  - the per-player tab model (id / label / colour / isHuman, human default),
 *    for both the single-player (`TurnLedger`) and competitive
 *    (`CompetitiveRoundLedger`) ledger shapes.
 *
 * Fixtures are hand-built ledgers that reconcile exactly, plus one real-engine
 * integration test asserting the projection reconciles an actual
 * `processEndOfTurn` result.
 *
 * @module tests/main-street/turn-summary-pl-model
 */
import { describe, expect, it } from 'vitest';

import type { MainStreetState } from '../../src/MainStreetState';
import { createCompetitiveState, setupMainStreetGame } from '../../src/MainStreetState';
import type {
  BusinessCard,
  EventCard,
} from '../../src/MainStreetCards';
import type {
  CompetitiveRoundLedger,
  TurnLedger,
  TurnResult,
} from '../../src/MainStreetEngineTypes';
import { processEndOfTurn } from '../../src/MainStreetEngine';
import { recalculateCard } from '../../src/MainStreetAdjacency';
import {
  buildPLProjection,
  buildPLTabs,
} from '../../src/scenes/MainStreetTurnSummary';

// ── Fixtures ─────────────────────────────────────────────────

/** A single-player state whose wallet equals the closing balances below. */
function singlePlayerState(turn = 7): MainStreetState {
  const state = setupMainStreetGame({ seed: 'turn-summary-pl-model', difficulty: 'Easy' });
  state.turn = turn;
  state.players = [];
  state.weekStartCoins = 1000;
  state.weekStartRep = 10;
  state.weekStartScore = 20;
  state.resourceBank.coins = 990;
  state.resourceBank.reputation = 12;
  state.finalScore = 34;
  return state;
}

/**
 * An internally consistent loss-making ledger: income 140 + expenses −80 +
 * incident −40 + one-off −30 = net −10.
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

/** The model's single-player input. */
function plInput(
  ledger: TurnLedger | undefined,
  incidentName: string | null = 'Test Incident',
): Pick<TurnResult, 'turnLedger' | 'incident'> {
  return {
    turnLedger: ledger,
    incident: incidentName == null ? null : ({ name: incidentName } as EventCard),
  };
}

/** A two-seat competitive state with seat colours assigned. */
function twoSeatState(): MainStreetState {
  return createCompetitiveState({
    seed: 'turn-summary-pl-model-cmp',
    playerCount: 2,
    difficulty: 'Easy',
    loansEnabled: false,
  });
}

/**
 * A hand-built competitive round ledger whose seats reconcile exactly
 * (income + expenses + incident + one-off === net, per seat).
 */
function makeCompetitiveLedger(
  overrides: Partial<CompetitiveRoundLedger> = {},
): CompetitiveRoundLedger {
  return {
    turn: 7,
    seats: [
      {
        ownerId: 0,
        businessesOwned: 3,
        incomeByPhase: { base: 12, synergy: 4, reputation: 2, events: -1 },
        incomeTotal: 17,
        ongoingCosts: { staff: -3, community: -1, business: -2 },
        dayStart: { coins: 40, reputation: 2, score: 10 },
        closing: { coins: 49, reputation: 3, score: 13 },
        netCoinChange: 9,
        netRepChange: 1,
        netScoreChange: 3,
        incidentCoinChange: -2,
        incidentRepChange: -1,
        oneOffDeltas: { coins: 0, reputation: 1 },
      },
      {
        ownerId: 1,
        businessesOwned: 2,
        incomeByPhase: { base: 8, synergy: 0, reputation: 1, events: 0 },
        incomeTotal: 9,
        ongoingCosts: { staff: 0, community: 0, business: 0 },
        dayStart: { coins: 18, reputation: 0, score: 0 },
        closing: { coins: 23, reputation: 0, score: 5 },
        netCoinChange: 5,
        netRepChange: 0,
        netScoreChange: 5,
        incidentCoinChange: 0,
        incidentRepChange: 0,
        oneOffDeltas: { coins: -4, reputation: 0 },
      },
    ],
    ...overrides,
  };
}

/** The model's competitive input. */
function competitiveInput(
  ledger: CompetitiveRoundLedger | undefined,
): Pick<TurnResult, 'playerRoundLedger' | 'incident'> {
  return {
    playerRoundLedger: ledger,
    incident: null as EventCard | null,
  };
}

// ── Ledger presence and player selection ─────────────────────

describe('buildPLProjection — player selection', () => {
  it('returns null when the result carries no ledger of either shape', () => {
    expect(buildPLProjection(singlePlayerState(), plInput(undefined, null))).toBeNull();
    expect(buildPLProjection(twoSeatState(), competitiveInput(undefined))).toBeNull();
  });

  it('returns null for a player the statement does not carry', () => {
    const projection = buildPLProjection(
      twoSeatState(),
      competitiveInput(makeCompetitiveLedger()),
      '9',
    );
    expect(projection).toBeNull();
  });

  it('defaults to the human tab when no player is named', () => {
    const projection = buildPLProjection(
      twoSeatState(),
      competitiveInput(makeCompetitiveLedger()),
    );
    expect(projection?.playerKey).toBe('0');
    expect(projection?.isHuman).toBe(true);
  });

  it('accepts the numeric seat id as well as its string key', () => {
    const byNumber = buildPLProjection(
      twoSeatState(),
      competitiveInput(makeCompetitiveLedger()),
      1,
    );
    const byString = buildPLProjection(
      twoSeatState(),
      competitiveInput(makeCompetitiveLedger()),
      '1',
    );
    expect(byNumber).toEqual(byString);
    expect(byNumber?.playerKey).toBe('1');
  });
});

// ── Income section ───────────────────────────────────────────

describe('buildPLProjection — income section', () => {
  it('reports the four income phases in fixed order, with labels and coins', () => {
    const projection = buildPLProjection(singlePlayerState(), plInput(makeLedger()))!;
    expect(projection.income.key).toBe('income');
    expect(projection.income.label).toBe('Income');
    expect(projection.income.totalLabel).toBe('Total income');
    expect(projection.income.lines).toEqual([
      { key: 'base', label: 'Base income', coins: 120 },
      { key: 'synergy', label: 'Synergy income', coins: 30 },
      { key: 'reputation', label: 'Reputation income', coins: 10 },
      { key: 'events', label: 'Event income', coins: -20 },
    ]);
  });

  it('totals the income phases from the committed ledger', () => {
    const projection = buildPLProjection(singlePlayerState(), plInput(makeLedger()))!;
    expect(projection.income.total).toBe(140);
  });
});

// ── Operating expenses section ───────────────────────────────

describe('buildPLProjection — operating expenses section', () => {
  it('reports the three expense categories in fixed order, signed', () => {
    const projection = buildPLProjection(singlePlayerState(), plInput(makeLedger()))!;
    expect(projection.expenses.key).toBe('expenses');
    expect(projection.expenses.label).toBe('Less: Operating expenses');
    expect(projection.expenses.totalLabel).toBe('Total operating expenses');
    expect(projection.expenses.lines).toEqual([
      { key: 'staff', label: 'Staff wages', coins: -50 },
      { key: 'community', label: 'Community spaces', coins: -20 },
      { key: 'business', label: 'Business costs', coins: -10 },
    ]);
  });

  it('totals the operating expenses from the committed ledger', () => {
    const projection = buildPLProjection(singlePlayerState(), plInput(makeLedger()))!;
    expect(projection.expenses.total).toBe(-80);
  });
});

// ── Adjustments and the bottom line ──────────────────────────

describe('buildPLProjection — adjustments and net', () => {
  it('reports the incident adjustment with its coin and reputation deltas', () => {
    const projection = buildPLProjection(singlePlayerState(), plInput(makeLedger()))!;
    expect(projection.incident).toEqual({
      key: 'incident',
      label: 'Incident',
      coins: -40,
      reputation: -2,
    });
  });

  it('reports the one-off adjustment with its coin and reputation deltas', () => {
    const projection = buildPLProjection(singlePlayerState(), plInput(makeLedger()))!;
    expect(projection.oneOff).toEqual({
      key: 'oneOff',
      label: 'One-off',
      coins: -30,
      reputation: 4,
    });
  });

  it('reports the emphasised net profit/loss bottom line', () => {
    const projection = buildPLProjection(singlePlayerState(), plInput(makeLedger()))!;
    expect(projection.net).toEqual({
      label: 'Net profit/loss',
      coins: -10,
      reputation: 2,
      score: 14,
    });
  });
});

// ── Reconciliation ───────────────────────────────────────────

describe('buildPLProjection — reconciliation', () => {
  /** incomeTotal + expensesTotal + incident.coins + oneOff.coins === net.coins */
  function expectReconciled(projection: ReturnType<typeof buildPLProjection>): void {
    expect(projection).not.toBeNull();
    const pl = projection!;
    expect(pl.income.total + pl.expenses.total + pl.incident.coins + pl.oneOff.coins)
      .toBe(pl.net.coins);
    expect(pl.income.lines.reduce((total, line) => total + line.coins, 0))
      .toBe(pl.income.total);
    expect(pl.expenses.lines.reduce((total, line) => total + line.coins, 0))
      .toBe(pl.expenses.total);
  }

  it('reconciles a loss-making ledger', () => {
    expectReconciled(buildPLProjection(singlePlayerState(), plInput(makeLedger())));
  });

  it('reconciles a profitable ledger', () => {
    const profitable = makeLedger({
      incomeByPhase: { base: 200, synergy: 0, reputation: 20, events: 0 },
      ongoingCosts: { staff: -100, community: 0, business: -20 },
      incidentCoinChange: 0,
      incidentRepChange: 0,
      oneOffDeltas: { coins: 50, reputation: 0 },
      netCoinChange: 150,
      netRepChange: 0,
      netScoreChange: 0,
    });
    expectReconciled(buildPLProjection(singlePlayerState(), plInput(profitable)));
  });

  it('reconciles an all-zero ledger', () => {
    const zero = makeLedger({
      incomeByPhase: { base: 0, synergy: 0, reputation: 0, events: 0 },
      ongoingCosts: { staff: 0, community: 0, business: 0 },
      incidentCoinChange: 0,
      incidentRepChange: 0,
      oneOffDeltas: { coins: 0, reputation: 0 },
      netCoinChange: 0,
      netRepChange: 0,
      netScoreChange: 0,
    });
    expectReconciled(buildPLProjection(singlePlayerState(), plInput(zero)));
  });

  it('reconciles every seat of a competitive round ledger', () => {
    const state = twoSeatState();
    const input = competitiveInput(makeCompetitiveLedger());
    for (const tab of buildPLTabs(state, input)) {
      expectReconciled(buildPLProjection(state, input, tab.id));
    }
  });
});

// ── Supplementary context ────────────────────────────────────

describe('buildPLProjection — supplementary context', () => {
  it('attaches the non-monetary figures as context', () => {
    const projection = buildPLProjection(singlePlayerState(), plInput(makeLedger()))!;
    expect(projection.context).toEqual({
      reputationChange: 2,
      scoreChange: 14,
      closingCoins: 990,
      businessesOwned: 3,
    });
  });

  it('keeps the non-monetary figures out of the P&L lines', () => {
    const projection = buildPLProjection(singlePlayerState(), plInput(makeLedger()))!;
    // Every P&L line is monetary only — no reputation/score/closing figures.
    for (const line of [...projection.income.lines, ...projection.expenses.lines]) {
      expect(Object.keys(line).sort()).toEqual(['coins', 'key', 'label']);
    }
    // The two monetary adjustment lines are the only place reputation rides.
    expect(Object.keys(projection.incident).sort()).toEqual(['coins', 'key', 'label', 'reputation']);
    expect(Object.keys(projection.oneOff).sort()).toEqual(['coins', 'key', 'label', 'reputation']);
    // The context carries exactly the supplementary figures.
    expect(Object.keys(projection.context).sort()).toEqual([
      'businessesOwned',
      'closingCoins',
      'reputationChange',
      'scoreChange',
    ]);
  });

  it('projects a statement for a player who owns no businesses', () => {
    const projection = buildPLProjection(
      singlePlayerState(),
      plInput(makeLedger({ businessesOwned: {} })),
    )!;
    expect(projection).not.toBeNull();
    expect(projection.playerKey).toBe('0');
    expect(projection.context.businessesOwned).toBe(0);
    expect(projection.context.closingCoins).toBe(990);
    expect(projection.income.total).toBe(140);
    expect(projection.net.coins).toBe(-10);
  });
});

// ── Tab model ───────────────────────────────────────────────

describe('buildPLTabs', () => {
  it('single-player: one non-interactive "You" tab, selected by default', () => {
    const tabs = buildPLTabs(singlePlayerState(), plInput(makeLedger()));
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toEqual({
      id: '0',
      label: 'You',
      colour: undefined,
      isHuman: true,
      isDefault: true,
    });
  });

  it('single-player: still offers the "You" tab when the player owns nothing', () => {
    const tabs = buildPLTabs(
      singlePlayerState(),
      plInput(makeLedger({ businessesOwned: {} })),
    );
    expect(tabs).toHaveLength(1);
    expect(tabs[0].label).toBe('You');
    expect(tabs[0].isDefault).toBe(true);
  });

  it('competitive: one tab per seat with the shared label and colour', () => {
    const state = twoSeatState();
    const tabs = buildPLTabs(state, competitiveInput(makeCompetitiveLedger()));
    expect(tabs.map((tab) => tab.id)).toEqual(['0', '1']);
    expect(tabs.map((tab) => tab.label)).toEqual(['You', 'AI 1']);
    expect(tabs.map((tab) => tab.isHuman)).toEqual([true, false]);
    for (const tab of tabs) {
      const seat = state.players!.find((player) => String(player.playerId) === tab.id)!;
      expect(tab.colour).toBe(seat.colour);
      expect(tab.colour).toBeDefined();
    }
    expect(tabs[0].colour).not.toBe(tabs[1].colour);
  });

  it('competitive: exactly one tab is the default and it is the human seat', () => {
    const tabs = buildPLTabs(twoSeatState(), competitiveInput(makeCompetitiveLedger()));
    expect(tabs.filter((tab) => tab.isDefault)).toHaveLength(1);
    expect(tabs.find((tab) => tab.isDefault)?.isHuman).toBe(true);
  });

  it('competitive: defaults to the human seat even when it is not the first tab', () => {
    const ledger = makeCompetitiveLedger();
    const reversed: CompetitiveRoundLedger = { turn: ledger.turn, seats: [...ledger.seats].reverse() };
    const tabs = buildPLTabs(twoSeatState(), competitiveInput(reversed));
    expect(tabs.map((tab) => tab.id)).toEqual(['1', '0']);
    expect(tabs.find((tab) => tab.isDefault)?.id).toBe('0');
  });

  it('competitive: eliminated seats get no tab', () => {
    const state = createCompetitiveState({
      seed: 'turn-summary-pl-model-cmp3',
      playerCount: 3,
      difficulty: 'Easy',
      loansEnabled: false,
    });
    state.players![2].eliminated = true;
    const ledger = makeCompetitiveLedger({
      seats: [
        ...makeCompetitiveLedger().seats,
        {
          ownerId: 2,
          businessesOwned: 0,
          incomeByPhase: { base: 0, synergy: 0, reputation: 0, events: 0 },
          incomeTotal: 0,
          ongoingCosts: { staff: 0, community: 0, business: 0 },
          netCoinChange: 0,
          netRepChange: 0,
          netScoreChange: 0,
          incidentCoinChange: 0,
          incidentRepChange: 0,
          oneOffDeltas: { coins: 0, reputation: 0 },
        },
      ],
    });
    const tabs = buildPLTabs(state, competitiveInput(ledger));
    expect(tabs.map((tab) => tab.id)).toEqual(['0', '1']);
  });

  it('offers no tabs when the competitive ledger carries no seats', () => {
    const state = twoSeatState();
    const input = competitiveInput(makeCompetitiveLedger({ seats: [] }));
    expect(buildPLTabs(state, input)).toEqual([]);
    expect(buildPLProjection(state, input)).toBeNull();
  });
});

// ── Competitive projections ─────────────────────────────────

describe('buildPLProjection — competitive seats', () => {
  it('projects the human seat’s statement from its own ledger row', () => {
    const projection = buildPLProjection(
      twoSeatState(),
      competitiveInput(makeCompetitiveLedger()),
      '0',
    )!;
    expect(projection.label).toBe('You');
    expect(projection.isHuman).toBe(true);
    expect(projection.income.lines.map((line) => line.coins)).toEqual([12, 4, 2, -1]);
    expect(projection.income.total).toBe(17);
    expect(projection.expenses.lines.map((line) => line.coins)).toEqual([-3, -1, -2]);
    expect(projection.expenses.total).toBe(-6);
    expect(projection.incident.coins).toBe(-2);
    expect(projection.oneOff.coins).toBe(0);
    expect(projection.net.coins).toBe(9);
    expect(projection.context).toEqual({
      reputationChange: 1,
      scoreChange: 3,
      closingCoins: 49,
      businessesOwned: 3,
    });
  });

  it('switching player switches the whole statement body', () => {
    const state = twoSeatState();
    const input = competitiveInput(makeCompetitiveLedger());
    const human = buildPLProjection(state, input, '0')!;
    const ai = buildPLProjection(state, input, '1')!;

    expect(ai.label).toBe('AI 1');
    expect(ai.isHuman).toBe(false);
    expect(ai.income.total).toBe(9);
    expect(ai.expenses.total).toBe(0);
    expect(ai.oneOff.coins).toBe(-4);
    expect(ai.net.coins).toBe(5);
    expect(ai.context).toEqual({
      reputationChange: 0,
      scoreChange: 5,
      closingCoins: 23,
      businessesOwned: 2,
    });
    // The two statements are genuinely different, not a shared object.
    expect(ai.income.lines).not.toEqual(human.income.lines);
    expect(ai.net.coins).not.toBe(human.net.coins);
  });

  it('is read-only: building the statement mutates no state and consumes no RNG', () => {
    const state = twoSeatState();
    const before = JSON.stringify(state.players);
    const rngCallsBefore = state.rngCalls;
    const input = competitiveInput(makeCompetitiveLedger());
    buildPLTabs(state, input);
    buildPLProjection(state, input, '0');
    buildPLProjection(state, input, '1');
    expect(JSON.stringify(state.players)).toBe(before);
    expect(state.rngCalls).toBe(rngCallsBefore);
  });
});

// ── Real-engine integration ─────────────────────────────────

describe('buildPLProjection — committed engine data', () => {
  it('reconciles an actual processEndOfTurn result from committed state', () => {
    const state = setupMainStreetGame({ seed: 'turn-summary-pl-integration', difficulty: 'Easy' });
    state.phase = 'MarketPhase';
    state.streetGrid = state.streetGrid.map(() => null);
    state.soldSlots = state.soldSlots.map(() => false);
    state.incidentDeck = []; // no incident this turn
    state.staffCards = [];
    state.activeEffects = [];
    state.activeChallenges = [];
    state.hand = [];
    state.resourceBank.reputation = 0;
    state.weekStartCoins = state.resourceBank.coins;
    state.weekStartRep = state.resourceBank.reputation;
    state.weekStartScore = state.finalScore;

    // One standing business: 150 base income, no ongoing cost.
    state.streetGrid[0] = {
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
    } as BusinessCard;
    recalculateCard(state, 0);

    const result = processEndOfTurn(state); // legacy path: deltas applied
    const ledger = result.turnLedger!;
    const projection = buildPLProjection(state, result)!;

    expect(projection).not.toBeNull();
    expect(projection.income.total).toBe(150);
    expect(projection.expenses.total).toBe(0);
    expect(projection.net.coins).toBe(150);
    // The displayed lines reconcile to the committed ledger.
    expect(projection.income.total + projection.expenses.total
      + projection.incident.coins + projection.oneOff.coins).toBe(ledger.netCoinChange);
    expect(projection.net.coins).toBe(ledger.netCoinChange);
    // Closing coins are the committed post-turn wallet.
    expect(projection.context.closingCoins).toBe(state.resourceBank.coins);
    expect(projection.context.businessesOwned).toBe(1);
  });
});
