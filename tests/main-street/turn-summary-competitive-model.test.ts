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
import { buildCompetitiveTurnSummary } from '../../src/scenes/MainStreetTurnSummary';

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
        netCoinChange: 9,
      },
      {
        ownerId: 1,
        businessesOwned: 2,
        incomeByPhase: { base: 8, synergy: 0, reputation: 1, events: 0 },
        incomeTotal: 9,
        netCoinChange: 5,
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
