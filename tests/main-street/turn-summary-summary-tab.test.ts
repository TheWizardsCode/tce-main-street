/**
 * Turn Summary — Summary-tab model (MS-0MWBWRITL0089GGJ)
 *
 * Pins the Phaser-free Summary-tab model the Turn Summary overlay renders as
 * its first, default-selected tab:
 *
 *  - the confirmed section order **Major actions → Events →
 *    Income/Reputation/Score** (producer answer Q1 = A);
 *  - per-seat action attribution (player and AI) by the structural
 *    `LogEntry.actionType` marker, with turn headers and the per-turn monetary
 *    summary rows excluded (producer answer Q2);
 *  - one row per metric, each carrying every seat's change and closing balance
 *    (producer answer Q3 = A);
 *  - signed figures that reconcile with each seat's `PLProjection`;
 *  - absent-safe degradation when the turn record omits actions/events.
 *
 * The overlay rendering path is covered separately in
 * `turn-summary-summary-tab.browser.test.ts`.
 *
 * @module tests/main-street/turn-summary-summary-tab
 */
import { describe, expect, it } from 'vitest';

import type { MainStreetState } from '../../src/MainStreetState';
import { addLog, addLogShared, createCompetitiveState, setupMainStreetGame } from '../../src/MainStreetState';
import type { EventCard } from '../../src/MainStreetCards';
import type {
  CompetitiveRoundLedger,
  TurnLedger,
  TurnResult,
} from '../../src/MainStreetEngineTypes';
import {
  buildSummaryTab,
  buildSummaryTabModel,
  SUMMARY_TAB_ID,
  SUMMARY_TAB_LABEL,
} from '../../src/scenes/MainStreetTurnSummary';
import { buildSummaryMetricTooltip } from '../../src/scenes/MainStreetTurnSummaryTooltips';

// ── Fixtures ─────────────────────────────────────────────────

/** A single-player state whose wallet equals the closing balances below. */
function singlePlayerState(turn = 7): MainStreetState {
  const state = setupMainStreetGame({ seed: 'turn-summary-summary-tab', difficulty: 'Easy' });
  state.turn = turn;
  state.players = [];
  state.activityLog = [];
  state.weekStartCoins = 1000;
  state.weekStartRep = 10;
  state.weekStartScore = 20;
  state.resourceBank.coins = 990;
  state.resourceBank.reputation = 12;
  state.finalScore = 34;
  return state;
}

/** An internally consistent loss-making ledger: income 140 − expenses 80 − incident 40 − one-off 30 = −10. */
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
  const state = createCompetitiveState({
    seed: 'turn-summary-summary-tab-cmp',
    playerCount: 2,
    difficulty: 'Easy',
    loansEnabled: false,
  });
  state.turn = 7;
  state.activityLog = [];
  return state;
}

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

function competitiveInput(
  ledger: CompetitiveRoundLedger | undefined,
): Pick<TurnResult, 'playerRoundLedger' | 'incident'> {
  return {
    playerRoundLedger: ledger,
    incident: null as EventCard | null,
  };
}

/** Appends one action entry to the activity log (the model reads it verbatim). */
function pushAction(
  state: MainStreetState,
  turn: number,
  actionType: NonNullable<import('../../src/MainStreetStateTypes').LogEntry['actionType']>,
  text: string,
  seatId?: number,
): void {
  state.activityLog.push({
    turn,
    text,
    type: 'neutral',
    actionType,
    ...(seatId != null ? { seatId } : {}),
  });
}

// ── Tab descriptor ───────────────────────────────────────────

describe('buildSummaryTab', () => {
  it('is the first tab, labelled Summary and selected by default', () => {
    const tab = buildSummaryTab();
    expect(tab.id).toBe(SUMMARY_TAB_ID);
    expect(tab.label).toBe(SUMMARY_TAB_LABEL);
    expect(tab.isDefault).toBe(true);
    expect(tab.isHuman).toBe(false);
  });
});

// ── Section order ────────────────────────────────────────────

describe('buildSummaryTabModel — section order', () => {
  it('exposes actions, events and metrics in the confirmed order', () => {
    const model = buildSummaryTabModel(singlePlayerState(), plInput(makeLedger()))!;
    // The model's own key order is the rendered order (Major actions → Events
    // → Income/Reputation/Score).
    const keys = Object.keys(model).filter((key) => key !== 'turn' && key !== 'tab');
    expect(keys).toEqual(['actions', 'events', 'metrics']);
    expect(model.metrics.map((row) => row.key)).toEqual(['income', 'reputation', 'score']);
    expect(model.metrics.map((row) => row.label)).toEqual(['Income', 'Reputation', 'Score']);
  });
});

// ── Actions ─────────────────────────────────────────────────

describe('buildSummaryTabModel — major actions', () => {
  it('lists player- and AI-initiated actions per seat (competitive)', () => {
    const state = twoSeatState();
    pushAction(state, 7, 'place-business', 'Placed Bakery in slot 0', 0);
    pushAction(state, 7, 'sell', 'Sold Cafe from slot 1', 1);
    pushAction(state, 7, 'take-loan', 'Took a bank loan', 1);

    const model = buildSummaryTabModel(state, competitiveInput(makeCompetitiveLedger()))!;
    expect(model.actions).toHaveLength(3);
    expect(model.actions.map((row) => row.label)).toEqual(['You', 'AI 1', 'AI 1']);
    expect(model.actions.map((row) => row.actionType)).toEqual([
      'place-business',
      'sell',
      'take-loan',
    ]);
    expect(model.actions.map((row) => row.text)).toEqual([
      'Placed Bakery in slot 0',
      'Sold Cafe from slot 1',
      'Took a bank loan',
    ]);
  });

  it('credits single-player actions (no seat id) to the human seat', () => {
    const state = singlePlayerState();
    pushAction(state, 7, 'place-business', 'Placed Bakery in slot 0');

    const model = buildSummaryTabModel(state, plInput(makeLedger()))!;
    expect(model.actions).toHaveLength(1);
    expect(model.actions[0].label).toBe('You');
    expect(model.actions[0].isHuman).toBe(true);
  });

  it('excludes turn headers and the per-turn monetary summary rows', () => {
    const state = singlePlayerState();
    // Turn header and monetary summary rows carry no actionType.
    state.activityLog.push({ turn: 7, text: 'Turn 7', type: 'turn-header' });
    state.activityLog.push({ turn: 7, text: 'Income: +120 coins', type: 'gain' });
    state.activityLog.push({ turn: 7, text: 'Reputation from cards: +10', type: 'gain' });
    pushAction(state, 7, 'place-business', 'Placed Bakery in slot 0');

    const model = buildSummaryTabModel(state, plInput(makeLedger()))!;
    expect(model.actions).toHaveLength(1);
    expect(model.actions[0].text).toBe('Placed Bakery in slot 0');
  });

  it('ignores actions from a different turn', () => {
    const state = singlePlayerState(7);
    pushAction(state, 6, 'place-business', 'Last turn action');
    pushAction(state, 7, 'place-business', 'This turn action');

    const model = buildSummaryTabModel(state, plInput(makeLedger()))!;
    expect(model.actions.map((row) => row.text)).toEqual(['This turn action']);
  });
});

// ── Events ──────────────────────────────────────────────────

describe('buildSummaryTabModel — events', () => {
  it('names the resolved incident and lists its per-seat effect', () => {
    const state = singlePlayerState();
    const model = buildSummaryTabModel(state, plInput(makeLedger(), 'Bin Strike'))!;
    expect(model.events).toHaveLength(1);
    expect(model.events[0].name).toBe('Bin Strike');
    expect(model.events[0].seats).toHaveLength(1);
    expect(model.events[0].seats[0].coins).toBe(-40);
    expect(model.events[0].seats[0].reputation).toBe(-2);
  });

  it('is empty when no incident was resolved and no seat moved', () => {
    const state = singlePlayerState();
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
    const model = buildSummaryTabModel(state, plInput(zero, null))!;
    expect(model.events).toEqual([]);
  });
});

// ── Metrics ─────────────────────────────────────────────────

describe('buildSummaryTabModel — metrics', () => {
  it('renders one row per metric with a change and a balance per seat', () => {
    const state = twoSeatState();
    const model = buildSummaryTabModel(state, competitiveInput(makeCompetitiveLedger()))!;

    expect(model.metrics).toHaveLength(3);
    for (const metric of model.metrics) {
      expect(metric.figures).toHaveLength(2);
      for (const figure of metric.figures) {
        expect(typeof figure.change).toBe('number');
        expect(typeof figure.balance).toBe('number');
        expect(figure.projection).toBeDefined();
      }
    }

    const income = model.metrics.find((row) => row.key === 'income')!;
    expect(income.figures.map((figure) => figure.label)).toEqual(['You', 'AI 1']);
    expect(income.figures.map((figure) => figure.change)).toEqual([9, 5]);
    expect(income.figures.map((figure) => figure.balance)).toEqual([49, 23]);

    const reputation = model.metrics.find((row) => row.key === 'reputation')!;
    expect(reputation.figures.map((figure) => figure.change)).toEqual([1, 0]);
    expect(reputation.figures.map((figure) => figure.balance)).toEqual([3, 0]);

    const score = model.metrics.find((row) => row.key === 'score')!;
    expect(score.figures.map((figure) => figure.change)).toEqual([3, 5]);
    expect(score.figures.map((figure) => figure.balance)).toEqual([13, 5]);
  });

  it('keeps signed changes (positive, negative and zero) as numbers', () => {
    const state = singlePlayerState();
    const model = buildSummaryTabModel(state, plInput(makeLedger()))!;
    const income = model.metrics.find((row) => row.key === 'income')!;
    expect(income.figures[0].change).toBe(-10); // loss
    expect(income.figures[0].balance).toBe(990);
    const reputation = model.metrics.find((row) => row.key === 'reputation')!;
    expect(reputation.figures[0].change).toBe(2);
    const score = model.metrics.find((row) => row.key === 'score')!;
    expect(score.figures[0].change).toBe(14);
  });

  it('reconciles every figure with its seat’s P&L projection', () => {
    const state = twoSeatState();
    const model = buildSummaryTabModel(state, competitiveInput(makeCompetitiveLedger()))!;
    for (const metric of model.metrics) {
      for (const figure of metric.figures) {
        const pl = figure.projection;
        // The statement's own identity.
        expect(pl.income.total + pl.expenses.total + pl.incident.coins + pl.oneOff.coins)
          .toBe(pl.net.coins);
        // The metric change is the projection's matching figure.
        if (metric.key === 'income') {
          expect(figure.change).toBe(pl.net.coins);
          expect(figure.balance).toBe(pl.context.closingCoins);
        } else if (metric.key === 'reputation') {
          expect(figure.change).toBe(pl.context.reputationChange);
        } else {
          expect(figure.change).toBe(pl.context.scoreChange);
        }
      }
    }
  });
});

// ── Absent-safe ─────────────────────────────────────────────

describe('buildSummaryTabModel — absent-safe', () => {
  it('returns null when the result carries no ledger of either shape', () => {
    expect(buildSummaryTabModel(singlePlayerState(), plInput(undefined))).toBeNull();
    expect(buildSummaryTabModel(twoSeatState(), competitiveInput(undefined))).toBeNull();
  });

  it('renders empty actions and events (but keeps the metrics) when the record omits them', () => {
    const state = singlePlayerState();
    state.activityLog = [];
    // A ledger with no incident delta and no name carries no event row.
    const quiet = makeLedger({
      incidentCoinChange: 0,
      incidentRepChange: 0,
      netCoinChange: 90,
      oneOffDeltas: { coins: 30, reputation: 4 },
    });
    const model = buildSummaryTabModel(state, plInput(quiet, null))!;
    expect(model.actions).toEqual([]);
    expect(model.events).toEqual([]);
    expect(model.metrics).toHaveLength(3);
    expect(model.metrics.every((row) => row.figures.length === 1)).toBe(true);
  });

  it('is read-only: building the summary mutates no state and consumes no RNG', () => {
    const state = twoSeatState();
    pushAction(state, 7, 'place-business', 'Placed Bakery', 0);
    const before = JSON.stringify(state.players);
    const rngCallsBefore = state.rngCalls;
    buildSummaryTabModel(state, competitiveInput(makeCompetitiveLedger()));
    expect(JSON.stringify(state.players)).toBe(before);
    expect(state.rngCalls).toBe(rngCallsBefore);
  });
});

// ── Structural action marker ─────────────────────────────────

describe('LogEntry action marker', () => {
  it('addLog stamps the optional actionType marker', () => {
    const state = singlePlayerState();
    addLog(state, 'Placed Bakery in slot 0', 'neutral', 'place-business');
    expect(state.activityLog.at(-1)?.actionType).toBe('place-business');
  });

  it('addLogShared stamps the optional actionType marker', () => {
    const state = singlePlayerState();
    addLogShared(state, 'Challenge completed', 'gain', 'complete-challenge');
    expect(state.activityLog.at(-1)?.actionType).toBe('complete-challenge');
  });

  it('addLog without a marker leaves it unset (turn headers / monetary rows)', () => {
    const state = singlePlayerState();
    addLog(state, 'Income: +120 coins', 'gain');
    expect(state.activityLog.at(-1)?.actionType).toBeUndefined();
  });
});

// ── Tooltip builders ─────────────────────────────────────────

describe('buildSummaryMetricTooltip', () => {
  it('income tooltip reconciles the headline figure to the full statement', () => {
    const model = buildSummaryTabModel(singlePlayerState(), plInput(makeLedger()))!;
    const income = model.metrics.find((row) => row.key === 'income')!;
    const figure = income.figures[0];
    const text = buildSummaryMetricTooltip('income', figure.projection, 'Bin Strike');
    // The headline net and the per-business / per-card breakdown are present.
    expect(text).toContain('= -10');
    expect(text).toContain('Total income: +140');
    expect(text).toContain('Total operating expenses: -80');
    expect(text).toContain('Bin Strike');
  });

  it('reputation tooltip shows the signed reconciliation', () => {
    const model = buildSummaryTabModel(singlePlayerState(), plInput(makeLedger()))!;
    const reputation = model.metrics.find((row) => row.key === 'reputation')!;
    const text = buildSummaryMetricTooltip('reputation', reputation.figures[0].projection);
    expect(text).toContain('Reputation');
    expect(text).toContain('= +2');
  });

  it('score tooltip explains the score change', () => {
    const model = buildSummaryTabModel(singlePlayerState(), plInput(makeLedger()))!;
    const score = model.metrics.find((row) => row.key === 'score')!;
    const text = buildSummaryMetricTooltip('score', score.figures[0].projection);
    expect(text).toContain('Score change');
  });
});
