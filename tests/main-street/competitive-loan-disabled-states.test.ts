/**
 * Main Street: competitive Turn Summary `[ Bank Loan ]` disabled states —
 * loans off and an empty configured menu
 * (MS-0MW4YUGX4006OINT, parent MS-0MW4XQXY6005YG72).
 *
 * The competitive panel is keyed to the human seat's loan descriptor
 * (MS-0MW4YPWYN000SY9X) and its active-obligation half is pinned by
 * `competitive-loan-active-obligation.test.ts`. This suite covers the two
 * **configuration** reasons the button must stay disabled:
 *
 *   AC4d — `config.loansEnabled === false` keeps the button disabled with the
 *          `loans-disabled` hint, and the configured menu is never offered;
 *   AC1  — an empty configured menu keeps the button disabled with the
 *          `no-options` hint (nothing to offer), never opening an empty
 *          selector;
 *   AC3  — the disabled state is the correct **no-op**: the engine refuses the
 *          take with the same reason the button shows, no wallet/loan/turn/AP
 *          field changes, and building the panel never throws.
 *
 * The rendered half (muted colour, inert input, the hint on the panel, the
 * unaffected `[ Next Turn ]`) is covered by
 * `competitive-loan-disabled-states.browser.test.ts`; this suite is the
 * Phaser-free model + engine contract behind it.
 *
 * @module tests/main-street/competitive-loan-disabled-states
 */

import { describe, expect, it } from 'vitest';

import { createCompetitiveState, type MainStreetState } from '../../src/MainStreetState';
import type { CompetitiveRoundLedger, TurnResult } from '../../src/MainStreetEngineTypes';
import type { EventCard } from '../../src/MainStreetCards';
import type { ActiveLoan } from '../../src/MainStreetStateTypes';
import { canTakeLoan } from '../../src/MainStreetLoans';
import { takeLoanCommand } from '../../src/MainStreetCommands';
import {
  LOANS_DISABLED_HINT,
  NO_LOAN_OPTIONS_HINT,
  buildLoanSelectorModel,
  buildTurnSummaryLoanDescriptor,
} from '../../src/scenes/MainStreetLoanSelectorModel';
import { buildCompetitiveTurnSummary } from '../../src/scenes/MainStreetTurnSummary';

// ── Fixtures ─────────────────────────────────────────────────

/** The copy the competitive panel shipped while the button was unwired. */
const RETIRED_STATIC_HINT = 'Bank loans are not available in competitive play yet.';

/** Human seat id in every fixture: seat 0 is the player-controlled seat. */
const HUMAN_SEAT_ID = 0;

/** A two-seat competitive state, with the loan mechanic optionally enabled. */
function competitiveState(seed: string, loansEnabled = true): MainStreetState {
  return createCompetitiveState({
    seed,
    playerCount: 2,
    difficulty: 'Easy',
    loansEnabled,
  });
}

/** A hand-built competitive round ledger: one quiet seat per player. */
const LEDGER: CompetitiveRoundLedger = {
  turn: 7,
  seats: [0, 1].map((ownerId) => ({
    ownerId,
    businessesOwned: 1,
    incomeByPhase: { base: 10, synergy: 0, reputation: 0, events: 0 },
    incomeTotal: 10,
    netCoinChange: 10,
  })),
};

/** The model's input: the closed round's result carrying the ledger. */
const CLOSING: Pick<TurnResult, 'playerRoundLedger' | 'incident'> = {
  playerRoundLedger: LEDGER,
  incident: null as EventCard | null,
};

/** An active loan for one seat, as a completed `takeLoan` records it. */
function activeLoan(ownerId: number, overrides: Partial<ActiveLoan> = {}): ActiveLoan {
  return {
    ownerId,
    principal: 600,
    totalRepayment: 660,
    perTurnRepayment: 110,
    turnsRemaining: 6,
    termTurns: 6,
    takenOnTurn: 1,
    ...overrides,
  };
}

/** The loan descriptor the competitive panel's `[ Bank Loan ]` button renders. */
function competitiveLoanDescriptor(state: MainStreetState) {
  const summary = buildCompetitiveTurnSummary(state, CLOSING);
  expect(summary).not.toBeNull();
  return summary!.loanDescriptor;
}

/**
 * The competitive Turn Summary gate parks the shared day on the advanced day's
 * `WeekStart` — the deferred-closing window a mid-game take opts into.
 */
function atCompetitiveSummaryGate(state: MainStreetState): MainStreetState {
  state.phase = 'WeekStart';
  return state;
}

/** Everything a refused take must leave exactly as it found it. */
function snapshot(state: MainStreetState) {
  return {
    coins: state.players!.map((player) => player.coins),
    loans: state.loans.map((loan) => ({ ...loan })),
    turn: state.turn,
    actionsRemaining: state.actionsRemaining,
  };
}

// ── AC4d: loans are disabled for the whole run ───────────────

describe('competitive [ Bank Loan ] — loansEnabled: false (AC4d)', () => {
  it('disables the button with the loans-disabled hint and offers no menu', () => {
    const state = competitiveState('competitive-disabled-loans-off', false);
    // A configured menu is present but irrelevant: the mechanic is off.
    expect(state.config.loanOptions.length).toBeGreaterThan(0);

    const descriptor = competitiveLoanDescriptor(state);

    expect(descriptor.enabled).toBe(false);
    expect(descriptor.reason).toBe('loans-disabled');
    // No options are offered, so the panel cannot open a selector.
    expect(descriptor.options).toEqual([]);
    // The same wording single-player uses — not the retired static copy.
    expect(descriptor.hint).toBe(LOANS_DISABLED_HINT);
    expect(descriptor.hint).not.toBe(RETIRED_STATIC_HINT);
  });

  it('names loans-off as the block even when the human seat also owes a loan', () => {
    const state = competitiveState('competitive-disabled-loans-off-precedence', false);
    state.loans = [activeLoan(HUMAN_SEAT_ID)];

    const descriptor = competitiveLoanDescriptor(state);

    // The more fundamental block wins: a run without the mechanic must never
    // blame (or even report) the seat's outstanding obligation.
    expect(descriptor.enabled).toBe(false);
    expect(descriptor.reason).toBe('loans-disabled');
    expect(descriptor.activeLoan).toBeNull();
    expect(descriptor.hint).toBe(LOANS_DISABLED_HINT);
  });

  it('refuses the take at the engine with the very reason the button shows', () => {
    const state = atCompetitiveSummaryGate(
      competitiveState('competitive-disabled-loans-off-engine', false),
    );
    const before = snapshot(state);

    // The button's hint and the engine's refusal are one contract: the player
    // is never told one thing and refused for another.
    const verdict = canTakeLoan(state, 0, HUMAN_SEAT_ID, { allowDuringClosing: true });
    expect(verdict.legal).toBe(false);
    expect(verdict.legal === false && verdict.reason).toBe(LOANS_DISABLED_HINT);

    // The command the competitive confirm path would dispatch books nothing.
    expect(() =>
      takeLoanCommand(state, 0, { allowDuringClosing: true }, HUMAN_SEAT_ID).execute(),
    ).toThrow(LOANS_DISABLED_HINT);
    expect(snapshot(state)).toEqual(before);
    expect(state.loans).toHaveLength(0);
  });
});

// ── AC1: an empty configured menu ────────────────────────────

describe('competitive [ Bank Loan ] — empty loan menu (AC1)', () => {
  it('disables the button with the no-options hint and no selector rows', () => {
    const state = competitiveState('competitive-disabled-empty-menu');
    state.config = { ...state.config, loanOptions: [] };

    const descriptor = competitiveLoanDescriptor(state);

    expect(descriptor.enabled).toBe(false);
    expect(descriptor.reason).toBe('no-options');
    expect(descriptor.options).toEqual([]);
    expect(descriptor.hint).toBe(NO_LOAN_OPTIONS_HINT);
    expect(descriptor.activeLoan).toBeNull();
    // Even if the panel reached for the selector, there is nothing to show:
    // an empty menu can never present an empty modal.
    expect(buildLoanSelectorModel(state, HUMAN_SEAT_ID).rows).toEqual([]);
  });

  it('refuses the take at the engine — an empty menu books nothing', () => {
    const state = atCompetitiveSummaryGate(
      competitiveState('competitive-disabled-empty-menu-engine'),
    );
    state.config = { ...state.config, loanOptions: [] };
    const before = snapshot(state);

    const verdict = canTakeLoan(state, 0, HUMAN_SEAT_ID, { allowDuringClosing: true });
    expect(verdict.legal).toBe(false);
    expect(verdict.legal === false && verdict.reason).toMatch(/unknown loan option/i);

    expect(() =>
      takeLoanCommand(state, 0, { allowDuringClosing: true }, HUMAN_SEAT_ID).execute(),
    ).toThrow(/unknown loan option/i);
    expect(snapshot(state)).toEqual(before);
    expect(state.loans).toHaveLength(0);
  });
});

// ── AC3: disabled is a no-op, never a crash ─────────────────

describe('competitive [ Bank Loan ] — disabled states are a safe no-op (AC3)', () => {
  it('still builds a complete panel for every disabled reason, mutating nothing', () => {
    const cases: Array<[string, MainStreetState]> = [
      ['loans-off', competitiveState('competitive-disabled-panel-loans-off', false)],
      [
        'empty-menu',
        (() => {
          const state = competitiveState('competitive-disabled-panel-empty-menu');
          state.config = { ...state.config, loanOptions: [] };
          return state;
        })(),
      ],
    ];

    for (const [label, state] of cases) {
      const before = JSON.stringify(state);

      // Building the panel twice proves the disabled path is a pure read and
      // never throws (a presentation failure would strand the shared day).
      const first = buildCompetitiveTurnSummary(state, CLOSING);
      const second = buildCompetitiveTurnSummary(state, CLOSING);

      expect(first, label).not.toBeNull();
      expect(second, label).not.toBeNull();
      // The panel is otherwise complete: both seats, keyed to the human seat.
      expect(first!.humanSeatId, label).toBe(HUMAN_SEAT_ID);
      expect(first!.rows.map((row) => row.ownerId), label).toEqual([0, 1]);
      expect(first!.loanDescriptor.enabled, label).toBe(false);
      expect(JSON.stringify(state), label).toBe(before);
    }
  });

  it('matches the descriptor built directly for the human seat', () => {
    for (const loansEnabled of [false, true]) {
      const state = competitiveState(
        `competitive-disabled-single-source-${loansEnabled}`,
        loansEnabled,
      );
      if (loansEnabled) state.config = { ...state.config, loanOptions: [] };

      // The panel never re-implements the rules: it exposes the seat's own
      // descriptor, disabled reason and hint included.
      expect(competitiveLoanDescriptor(state)).toEqual(
        buildTurnSummaryLoanDescriptor(state, HUMAN_SEAT_ID),
      );
    }
  });
});
