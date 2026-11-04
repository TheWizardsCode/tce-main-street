/**
 * Main Street: Turn Summary loans descriptor and mid-game loan selector —
 * Phaser-free contract (MS-0MVXYCHCJ002ER7L, parent MS-0MVPWSQMG004198C).
 *
 * Pins the executable contract of the two models landed by
 * MS-0MVXYCHV2000ST0C (`src/scenes/MainStreetLoanSelectorModel.ts`), so the
 * Turn Summary dialog's enable/disable decision and the selector's rows can
 * never drift silently:
 *
 *   AC1 — `buildTurnSummaryLoanDescriptor()` is disabled with a
 *         `loans-disabled` reason when `config.loansEnabled === false`.
 *   AC2 — it is disabled with an `active-loan` reason and carries the seat's
 *         `perTurnRepayment`/`turnsRemaining` when the seat already owes.
 *   AC3 — it is disabled with a `no-options` reason for an empty menu, and
 *         enabled with the configured options when loans are on, no loan is
 *         active and the menu is non-empty.
 *   AC4 — `buildLoanSelectorModel()` lists one row per `config.loanOptions`
 *         entry, priced with the shipped `loanPerTurnRepayment()` /
 *         `loanTotalRepayment()` arithmetic, and never reads
 *         `state.pendingLoanOffer`.
 *   AC5 — the selector supplies a back-out label distinct from the bailout
 *         `[ Decline — end the run ]`.
 *   AC6 — these tests run against the already-landed models with no
 *         production change.
 *
 * Pure Node (`unit` project): importing the models here already proves they
 * need no Phaser, and every assertion goes through their public API.
 *
 * @module
 */

import { describe, expect, it } from 'vitest';

import { setupMainStreetGame } from '../../src/MainStreetState';
import type { MainStreetState } from '../../src/MainStreetState';
import { executeWeekStart } from '../../src/MainStreetEngine';
import {
  DEFAULT_LOAN_OPTIONS,
  formatLoanObligation,
  loanPerTurnRepayment,
  loanTotalRepayment,
} from '../../src/MainStreetLoans';
import type { ActiveLoan } from '../../src/MainStreetStateTypes';
import { buildLoanOfferModel } from '../../src/scenes/MainStreetLoanOverlayModel';
import {
  LOAN_SELECTOR_CANCEL_LABEL,
  LOAN_SELECTOR_TITLE,
  LOANS_DISABLED_HINT,
  NO_LOAN_OPTIONS_HINT,
  buildLoanSelectorModel,
  buildTurnSummaryLoanDescriptor,
} from '../../src/scenes/MainStreetLoanSelectorModel';

// ── Fixtures ─────────────────────────────────────────────────

/** Fresh single-player game armed in MarketPhase with the preset loans config. */
function loansState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state, true);
  return state;
}

/** An active loan for one seat, as `takeLoan` would record it. */
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

/** Deep snapshot used to prove the models are read-only. */
function snapshot(state: MainStreetState): string {
  return JSON.stringify(state);
}

// ── Descriptor ──────────────────────────────────────────────

describe('buildTurnSummaryLoanDescriptor', () => {
  it('enables borrowing when loans are on, the seat owes nothing and the menu is non-empty', () => {
    const state = loansState('turn-summary-loan-enabled');

    const descriptor = buildTurnSummaryLoanDescriptor(state);

    // AC3: the happy path — button interactive, nothing to explain.
    expect(descriptor.enabled).toBe(true);
    expect(descriptor.reason).toBeNull();
    expect(descriptor.hint).toBeNull();
    expect(descriptor.activeLoan).toBeNull();
    // The rows come from the configured menu, in menu order.
    expect(descriptor.options).toEqual(state.config.loanOptions);
    expect(descriptor.options.length).toBeGreaterThan(0);
  });

  it('reports `loans-disabled` and offers no menu when the run has loans turned off', () => {
    const state = loansState('turn-summary-loan-disabled');
    state.config = { ...state.config, loansEnabled: false };

    const descriptor = buildTurnSummaryLoanDescriptor(state);

    // AC1: a run with the mechanic off can never present a loan menu.
    expect(descriptor.enabled).toBe(false);
    expect(descriptor.reason).toBe('loans-disabled');
    expect(descriptor.options).toEqual([]);
    expect(descriptor.activeLoan).toBeNull();
    expect(descriptor.hint).toBe(LOANS_DISABLED_HINT);
  });

  it('reports `no-options` when the configured menu is empty', () => {
    const state = loansState('turn-summary-loan-no-options');
    state.config = { ...state.config, loanOptions: [] };

    const descriptor = buildTurnSummaryLoanDescriptor(state);

    // AC3: nothing to offer — disabled for a different, named reason.
    expect(descriptor.enabled).toBe(false);
    expect(descriptor.reason).toBe('no-options');
    expect(descriptor.options).toEqual([]);
    expect(descriptor.activeLoan).toBeNull();
    expect(descriptor.hint).toBe(NO_LOAN_OPTIONS_HINT);
  });

  it('reports `active-loan` with the seat obligation and the HUD wording', () => {
    const state = loansState('turn-summary-loan-active');
    const loan = activeLoan(0, { perTurnRepayment: 110, turnsRemaining: 4 });
    state.loans = [loan];

    const descriptor = buildTurnSummaryLoanDescriptor(state);

    // AC2: the button is disabled and carries the outstanding obligation so
    // the hint can say why (producer Q3 = A).
    expect(descriptor.enabled).toBe(false);
    expect(descriptor.reason).toBe('active-loan');
    expect(descriptor.activeLoan).toEqual({
      perTurnRepayment: 110,
      turnsRemaining: 4,
    });
    expect(descriptor.hint).toBe(formatLoanObligation(loan));
    expect(descriptor.hint).toBe('Loan: 110 coins/turn, 4 turns left');
    // The menu is still described (the dialog may show what a future loan
    // would cost), and the obligation is the only block.
    expect(descriptor.options).toEqual(state.config.loanOptions);
  });

  it('names the most fundamental block: loans off wins over an active loan', () => {
    const state = loansState('turn-summary-loan-precedence');
    state.config = { ...state.config, loansEnabled: false };
    state.loans = [activeLoan(0)];

    const descriptor = buildTurnSummaryLoanDescriptor(state);

    // A run without the mechanic must never blame the seat's obligation.
    expect(descriptor.reason).toBe('loans-disabled');
    expect(descriptor.activeLoan).toBeNull();
  });

  it('evaluates the seat it is asked about, not just the acting seat', () => {
    const state = loansState('turn-summary-loan-seat');
    state.activePlayerId = 0;
    state.loans = [activeLoan(0)];

    // The acting seat owes, so it is blocked…
    expect(buildTurnSummaryLoanDescriptor(state).reason).toBe('active-loan');
    // …while the other seat has no loan and may borrow.
    const otherSeat = buildTurnSummaryLoanDescriptor(state, 1);
    expect(otherSeat.enabled).toBe(true);
    expect(otherSeat.activeLoan).toBeNull();
  });

  it('returns a copy of the menu so a caller cannot mutate the run config', () => {
    const state = loansState('turn-summary-loan-copy');
    const descriptor = buildTurnSummaryLoanDescriptor(state);

    (descriptor.options[0] as { principal: number }).principal = 999_999;

    expect(state.config.loanOptions[0].principal).not.toBe(999_999);
  });

  it('never mutates the state it reads', () => {
    const state = loansState('turn-summary-loan-read-only');
    state.loans = [activeLoan(0)];
    const before = snapshot(state);

    buildTurnSummaryLoanDescriptor(state);
    buildTurnSummaryLoanDescriptor(state, 1);

    expect(snapshot(state)).toBe(before);
  });
});

// ── Selector ────────────────────────────────────────────────

describe('buildLoanSelectorModel', () => {
  it('lists one row per configured option, priced with the shipped arithmetic', () => {
    const state = loansState('loan-selector-rows');
    // A re-balanced menu and rate: the rows must follow the config, not a
    // hard-coded table (parent assumption A3).
    state.config = {
      ...state.config,
      loanInterestRate: 0.2,
      loanOptions: [
        { principal: 250, termTurns: 5 },
        { principal: 750, termTurns: 3 },
      ],
    };

    const model = buildLoanSelectorModel(state);

    expect(model.title).toBe(LOAN_SELECTOR_TITLE);
    expect(model.rows).toHaveLength(2);
    expect(model.rows.map((row) => row.index)).toEqual([0, 1]);

    for (const [position, option] of state.config.loanOptions.entries()) {
      const row = model.rows[position];
      const expectedTotal = loanTotalRepayment(option.principal, 0.2);
      const expectedPerTurn = loanPerTurnRepayment(expectedTotal, option.termTurns);

      // AC4: per-turn and total repayment are the shipped arithmetic.
      expect(row.totalRepayment).toBe(expectedTotal);
      expect(row.perTurnRepayment).toBe(expectedPerTurn);
      expect(row.principal).toBe(option.principal);
      expect(row.termTurns).toBe(option.termTurns);
      // A mid-game menu is not raised against a closing shortfall, so no row
      // states any coverage.
      expect(row.coversShortfall).toBeNull();
      expect(row.stillShort).toBeNull();
      // The row is self-contained: the label names the price and the term.
      expect(row.label).toContain(`€${option.principal}`);
      expect(row.label).toContain(`€${expectedPerTurn}/turn`);
      expect(row.label).toContain(`€${expectedTotal} total over ${option.termTurns} turns`);
    }

    // Sanity: 20% flat — 250 → 300 total → 60/turn over 5 turns.
    expect(model.rows[0]).toMatchObject({ totalRepayment: 300, perTurnRepayment: 60 });
  });

  it('builds its rows from `config.loanOptions`, never from a pending bailout offer', () => {
    const state = loansState('loan-selector-not-bailout');
    // A bailout offer sits unresolved with a menu the config does not contain.
    state.pendingLoanOffer = {
      ownerId: 0,
      reason: 'bankruptcy',
      options: [{ principal: 9_999, termTurns: 1 }],
    };

    const selector = buildLoanSelectorModel(state, 0);
    // The bailout dialog still reads the offer — proving the fixture is live.
    const bailout = buildLoanOfferModel(state)!;
    expect(bailout.rows.map((row) => row.principal)).toEqual([9_999]);

    // AC4: the mid-game selector is driven by the configured menu only.
    expect(selector.rows.map((row) => row.principal)).toEqual(
      DEFAULT_LOAN_OPTIONS.map((option) => option.principal),
    );
    expect(selector.rows.map((row) => row.principal)).not.toContain(9_999);
  });

  it('supplies a back-out label distinct from the bailout decline label', () => {
    const state = loansState('loan-selector-cancel');
    state.pendingLoanOffer = {
      ownerId: 0,
      reason: 'bankruptcy',
      options: DEFAULT_LOAN_OPTIONS.map((option) => ({ ...option })),
    };

    const selector = buildLoanSelectorModel(state);
    const bailout = buildLoanOfferModel(state)!;

    // AC5: cancelling the mid-game selector only closes the dialog — it must
    // never read as the bailout's run-ending decline.
    expect(selector.cancelLabel).toBe(LOAN_SELECTOR_CANCEL_LABEL);
    expect(selector.cancelLabel).toContain('Cancel');
    expect(selector.cancelLabel).not.toBe(bailout.declineLabel);
    expect(selector.cancelLabel).not.toContain('Decline');
  });

  it('never mutates the state it reads', () => {
    const state = loansState('loan-selector-read-only');
    state.pendingLoanOffer = {
      ownerId: 0,
      reason: 'bankruptcy',
      options: DEFAULT_LOAN_OPTIONS.map((option) => ({ ...option })),
    };
    const before = snapshot(state);

    buildLoanSelectorModel(state);

    expect(snapshot(state)).toBe(before);
  });
});
