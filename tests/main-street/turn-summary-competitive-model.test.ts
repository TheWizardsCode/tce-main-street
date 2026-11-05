/**
 * Main Street: Competitive Turn Summary model — MS-0MVRNV9Y8008IKGK
 *
 * The Phaser-free `buildCompetitiveTurnSummary` turns the competitive round
 * ledger (`TurnResult.playerRoundLedger`) plus the committed `MainStreetState`
 * into the per-seat rows the competitive Turn Summary panel renders:
 *
 *  - one row per non-eliminated seat, in seat order;
 *  - the competitive scoreboard's `You` / `AI n` labels and `resolveSeatColour`
 *    seat colours (one shared seat-identity source);
 *  - per-row businesses owned, per-phase income subtotals + total, and the net
 *    coin change;
 *  - `null` when the result carries no competitive ledger (single-player /
 *    N=1 / hand-built), so browser and single-player callers are unaffected.
 *
 * The engine ledger itself is covered by `competitive-turn-ledger.test.ts`;
 * this suite covers the model the dialog renders.
 *
 * @module tests/main-street/turn-summary-competitive-model
 */
import { describe, expect, it } from 'vitest';

import {
  createCompetitiveState,
  type MainStreetState,
} from '../../src/MainStreetState';
import type { CompetitiveRoundLedger, TurnResult } from '../../src/MainStreetEngineTypes';
import type { EventCard } from '../../src/MainStreetCards';
import { buildCompetitiveTurnSummary, buildTurnSummary } from '../../src/scenes/MainStreetTurnSummary';

// ── Fixtures ─────────────────────────────────────────────────

/** A two-seat competitive state with seat colours assigned. */
function twoSeatState(): MainStreetState {
  return createCompetitiveState({
    seed: 'competitive-summary-model',
    playerCount: 2,
    difficulty: 'Easy',
    loansEnabled: false,
  });
}

/** A hand-built ledger with one entry per seat (as the engine emits it). */
function makeLedger(overrides: Partial<CompetitiveRoundLedger> = {}): CompetitiveRoundLedger {
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

/** The model's input: a result carrying the optional competitive ledger. */
function summaryInput(
  ledger: CompetitiveRoundLedger | undefined,
): Pick<TurnResult, 'playerRoundLedger' | 'incident'> {
  return {
    playerRoundLedger: ledger,
    incident: null as EventCard | null,
  };
}

// ── Ledger presence ──────────────────────────────────────────

describe('buildCompetitiveTurnSummary — ledger presence', () => {
  it('returns null when the result carries no competitive ledger', () => {
    const state = twoSeatState();
    expect(buildCompetitiveTurnSummary(state, summaryInput(undefined))).toBeNull();
  });

  it('returns null for an empty seat list (nothing to render)', () => {
    const state = twoSeatState();
    const summary = buildCompetitiveTurnSummary(
      state,
      summaryInput(makeLedger({ seats: [] })),
    );
    expect(summary).toBeNull();
  });

  it('surfaces the closed day as the panel title', () => {
    const state = twoSeatState();
    const summary = buildCompetitiveTurnSummary(state, summaryInput(makeLedger()))!;
    expect(summary.turn).toBe(7);
  });
});

// ── Rows ─────────────────────────────────────────────────────

describe('buildCompetitiveTurnSummary — owner rows', () => {
  it('renders one row per seat, in seat order', () => {
    const summary = buildCompetitiveTurnSummary(
      twoSeatState(),
      summaryInput(makeLedger()),
    )!;
    expect(summary.rows.map((row) => row.ownerId)).toEqual([0, 1]);
  });

  it('labels the seats with the competitive scoreboard convention (You / AI n)', () => {
    const summary = buildCompetitiveTurnSummary(
      twoSeatState(),
      summaryInput(makeLedger()),
    )!;
    expect(summary.rows.map((row) => row.label)).toEqual(['You', 'AI 1']);
    expect(summary.rows.map((row) => row.isHuman)).toEqual([true, false]);
  });

  it('carries each seat’s colour from the shared seat-colour lookup', () => {
    const state = twoSeatState();
    const summary = buildCompetitiveTurnSummary(state, summaryInput(makeLedger()))!;
    for (const row of summary.rows) {
      const seat = state.players!.find((player) => player.playerId === row.ownerId)!;
      expect(row.colour).toBeDefined();
      expect(row.colour).toBe(seat.colour);
    }
    // The two seats are visually distinguishable.
    expect(summary.rows[0].colour).not.toBe(summary.rows[1].colour);
  });

  it('exposes businesses owned, the per-phase income rows + total, and the net change per row', () => {
    const summary = buildCompetitiveTurnSummary(
      twoSeatState(),
      summaryInput(makeLedger()),
    )!;
    const [human, ai] = summary.rows;

    expect(human.businessesOwned).toBe(3);
    expect(human.income).toEqual([
      { phase: 'base', label: 'Base income', coins: 12 },
      { phase: 'synergy', label: 'Synergy income', coins: 4 },
      { phase: 'reputation', label: 'Reputation income', coins: 2 },
      { phase: 'events', label: 'Event income', coins: -1 },
    ]);
    expect(human.incomeTotal).toBe(17);
    expect(human.netCoinChange).toBe(9);

    expect(ai.businessesOwned).toBe(2);
    expect(ai.incomeTotal).toBe(9);
    expect(ai.netCoinChange).toBe(5);
  });

  it('keeps a seat row for an owner the roster does not know (never drops data)', () => {
    const summary = buildCompetitiveTurnSummary(
      twoSeatState(),
      summaryInput(
        makeLedger({
          seats: [
            {
              ownerId: 4,
              businessesOwned: 1,
              incomeByPhase: { base: 3, synergy: 0, reputation: 0, events: 0 },
              incomeTotal: 3,
              netCoinChange: 3,
            },
          ],
        }),
      ),
    )!;
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].ownerId).toBe(4);
    expect(summary.rows[0].label).toBe('AI 4');
    expect(summary.rows[0].colour).toBeUndefined();
  });

  it('is read-only: building the summary mutates no state and consumes no RNG', () => {
    const state = twoSeatState();
    const before = JSON.stringify(state.players);
    buildCompetitiveTurnSummary(state, summaryInput(makeLedger()));
    expect(JSON.stringify(state.players)).toBe(before);
  });
});

// ── Per-seat expenses ────────────────────────────────────────

/**
 * Per-seat ongoing-expense rows (MS-0MVRNVHJ50095N9Y).
 *
 * The competitive panel shows what each seat actually spent in the round, per
 * category, so the engine's per-owner breakdown must reach the row model with
 * the single-player panel's labels, order and signed convention.
 */
describe('buildCompetitiveTurnSummary — per-seat expenses', () => {
  it('exposes the per-category expense rows and their total for each seat', () => {
    const summary = buildCompetitiveTurnSummary(
      twoSeatState(),
      summaryInput(makeLedger()),
    )!;
    const [human, ai] = summary.rows;

    expect(human.expenses).toEqual([
      { category: 'staff', label: 'Staff wages', coins: -3 },
      { category: 'community', label: 'Community spaces', coins: -1 },
      { category: 'business', label: 'Business costs', coins: -2 },
    ]);
    expect(human.expensesTotal).toBe(-6);

    // A seat that spent nothing keeps all three rows at 0 (never dropped).
    expect(ai.expenses.map((row) => row.coins)).toEqual([0, 0, 0]);
    expect(ai.expensesTotal).toBe(0);
  });

  it('renders three zero rows when the ledger carries no breakdown (absent-safe)', () => {
    const summary = buildCompetitiveTurnSummary(
      twoSeatState(),
      summaryInput(
        makeLedger({
          seats: [
            {
              ownerId: 0,
              businessesOwned: 1,
              incomeByPhase: { base: 2, synergy: 0, reputation: 0, events: 0 },
              incomeTotal: 2,
              netCoinChange: 2,
            },
          ],
        }),
      ),
    )!;
    expect(summary.rows[0].expenses.map((row) => [row.category, row.coins])).toEqual([
      ['staff', 0],
      ['community', 0],
      ['business', 0],
    ]);
    expect(summary.rows[0].expensesTotal).toBe(0);
  });

  it('uses the single-player panel’s expense labels, order and sign convention', () => {
    const state = twoSeatState();
    const competitive = buildCompetitiveTurnSummary(state, summaryInput(makeLedger()))!;
    const single = buildTurnSummary(state, {
      turnLedger: {
        incomeByPhase: { base: 0, synergy: 0, reputation: 0, events: 0 },
        ongoingCosts: { staff: -3, community: -1, business: -2 },
        incidentCoinChange: 0,
        incidentRepChange: 0,
        oneOffDeltas: { coins: 0, reputation: 0 },
        netCoinChange: -6,
        netRepChange: 0,
        netScoreChange: 0,
        businessesOwned: { '0': 3 },
      },
      incident: null,
    })!;

    expect(competitive.rows[0].expenses.map((row) => [row.category, row.label, row.coins]))
      .toEqual(single.expenses.map((row) => [row.category, row.label, row.coins]));
    expect(competitive.rows[0].expensesTotal).toBe(single.expensesTotal);
  });
});

// ── Per-seat net change, closing balances, incident / one-off ────

/**
 * Per-seat net change, closing balances and incident / one-off deltas
 * (MS-0MVRNW26W0070CP0).
 *
 * The panel row carries the same figures as the single-player row: the day's
 * net coin / reputation / score change, the closing balances, and the seat's
 * share of the incident and one-off deltas. Every value is surfaced on the
 * Phaser-free row so the panel is testable without a browser, and absent
 * ledger data degrades to the existing row shape instead of throwing.
 */
describe('buildCompetitiveTurnSummary — net change, closing balances and incident/one-off', () => {
  it('exposes the net change, closing balances, incident and one-off deltas per row', () => {
    const summary = buildCompetitiveTurnSummary(
      twoSeatState(),
      summaryInput(makeLedger()),
    )!;
    const [human, ai] = summary.rows;

    expect(human.netCoinChange).toBe(9);
    expect(human.netRepChange).toBe(1);
    expect(human.netScoreChange).toBe(3);
    expect(human.closing).toEqual({ coins: 49, reputation: 3, score: 13 });
    expect(human.incident).toEqual({ coins: -2, reputation: -1 });
    expect(human.oneOff).toEqual({ coins: 0, reputation: 1 });

    expect(ai.netCoinChange).toBe(5);
    expect(ai.netRepChange).toBe(0);
    expect(ai.netScoreChange).toBe(5);
    expect(ai.closing).toEqual({ coins: 23, reputation: 0, score: 5 });
    expect(ai.incident).toEqual({ coins: 0, reputation: 0 });
    expect(ai.oneOff).toEqual({ coins: -4, reputation: 0 });
  });

  it('derives the closing balances from day-start + net when the closing snapshot is absent', () => {
    const summary = buildCompetitiveTurnSummary(
      twoSeatState(),
      summaryInput(
        makeLedger({
          seats: [
            {
              ownerId: 0,
              businessesOwned: 1,
              incomeByPhase: { base: 4, synergy: 0, reputation: 0, events: 0 },
              incomeTotal: 4,
              dayStart: { coins: 10, reputation: 2, score: 5 },
              netCoinChange: 3,
              netRepChange: 1,
              netScoreChange: 2,
            },
          ],
        }),
      ),
    )!;

    expect(summary.rows[0].closing).toEqual({ coins: 13, reputation: 3, score: 7 });
  });

  it('degrades to the existing row shape for a hand-built ledger without the new fields', () => {
    const state = twoSeatState();
    const legacySeat = {
      ownerId: 1,
      businessesOwned: 2,
      incomeByPhase: { base: 8, synergy: 0, reputation: 1, events: 0 },
      incomeTotal: 9,
      ongoingCosts: { staff: 0, community: 0, business: 0 },
      netCoinChange: 5,
    };

    const summary = buildCompetitiveTurnSummary(
      state,
      summaryInput(makeLedger({ seats: [legacySeat] })),
    )!;
    const [row] = summary.rows;

    // Net reputation / score and the incident / one-off rows default to zero.
    expect(row.netCoinChange).toBe(5);
    expect(row.netRepChange).toBe(0);
    expect(row.netScoreChange).toBe(0);
    expect(row.incident).toEqual({ coins: 0, reputation: 0 });
    expect(row.oneOff).toEqual({ coins: 0, reputation: 0 });
    // Closing balances fall back to the committed seat wallet, not zeros.
    const seat = state.players![1];
    expect(row.closing).toEqual({
      coins: seat.coins,
      reputation: seat.reputation,
      score: seat.score,
    });
  });

  it('does not throw when no ledger is present at all', () => {
    expect(() => buildCompetitiveTurnSummary(twoSeatState(), summaryInput(undefined)))
      .not.toThrow();
    expect(buildCompetitiveTurnSummary(twoSeatState(), summaryInput(undefined))).toBeNull();
  });
});
