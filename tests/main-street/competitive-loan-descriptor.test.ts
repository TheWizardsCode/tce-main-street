/**
 * Main Street: competitive Turn Summary `[ Bank Loan ]` button state is driven
 * by the **human seat's loan descriptor** — MS-0MW4YPWYN000SY9X
 * (parent MS-0MW4XQXY6005YG72).
 *
 * The competitive Turn Summary panel used to ship a static
 * "not available in competitive play yet" hint with a permanently disabled
 * button. The panel now keys the button to
 * `CompetitiveTurnSummary.loanDescriptor`, built for the human seat by the
 * **same** single-player descriptor
 * (`buildTurnSummaryLoanDescriptor`) that single-player uses
 * (MS-0MW4YUHOU00474HZ). This suite pins the model half of that contract, so
 * the enable/disable matrix can never drift from the single-player rules:
 *
 *   AC1  — in competitive play (N ≥ 2) with `config.loansEnabled`, the
 *          descriptor for the **human seat** drives the button, and equals the
 *          single-player descriptor for that seat (one source of truth);
 *   AC4d — loans disabled  → disabled with the `loans-disabled` hint;
 *   AC4d — empty menu      → disabled with the `no-options` hint;
 *   AC4c — human seat owes → disabled with that seat's obligation hint
 *          (partial: the full active-loan flow is covered by its own item);
 *   the panel no longer presents the retired static competitive copy.
 *
 * The overlay half (muted colour, inert input, hint text drawn in the HUD) is
 * covered by `turn-summary-competitive.browser.test.ts`; the single-player
 * descriptor rules by `turn-summary-bank-loan.test.ts`. This suite therefore
 * asserts the **competitive wiring** only — which seat is evaluated, and that
 * the button's inputs are the descriptor's own values.
 *
 * @module tests/main-street/competitive-loan-descriptor
 */

import { describe, expect, it } from 'vitest';

import { createCompetitiveState, type MainStreetState } from '../../src/MainStreetState';
import type { CompetitiveRoundLedger, TurnResult } from '../../src/MainStreetEngineTypes';
import type { EventCard } from '../../src/MainStreetCards';
import type { ActiveLoan } from '../../src/MainStreetStateTypes';
import { formatLoanObligation } from '../../src/MainStreetLoans';
import {
  LOANS_DISABLED_HINT,
  NO_LOAN_OPTIONS_HINT,
  buildTurnSummaryLoanDescriptor,
} from '../../src/scenes/MainStreetLoanSelectorModel';
import { buildCompetitiveTurnSummary } from '../../src/scenes/MainStreetTurnSummary';

// ── Fixtures ─────────────────────────────────────────────────

/** The copy the competitive panel shipped before the button was wired. */
const RETIRED_STATIC_HINT = 'Bank loans are not available in competitive play yet.';

/** A competitive state with `playerCount` seats and loans optionally enabled. */
function competitiveState(
  seed: string,
  playerCount = 2,
  loansEnabled = true,
): MainStreetState {
  return createCompetitiveState({
    seed,
    playerCount,
    difficulty: 'Easy',
    loansEnabled,
  });
}

/** A hand-built competitive round ledger: one quiet seat per player. */
function makeLedger(playerCount: number): CompetitiveRoundLedger {
  return {
    turn: 7,
    seats: Array.from({ length: playerCount }, (_, ownerId) => ({
      ownerId,
      businessesOwned: 1,
      incomeByPhase: { base: 10, synergy: 0, reputation: 0, events: 0 },
      incomeTotal: 10,
      netCoinChange: 10,
    })),
  };
}

/** The model's input: the closed round's result carrying the ledger. */
function closingInput(
  playerCount: number,
): Pick<TurnResult, 'playerRoundLedger' | 'incident'> {
  return { playerRoundLedger: makeLedger(playerCount), incident: null as EventCard | null };
}

/** An active loan for one seat, as `takeLoan` records it. */
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

/** Builds the competitive summary for a state, failing loudly if it is absent. */
function summaryFor(state: MainStreetState) {
  const summary = buildCompetitiveTurnSummary(state, closingInput(state.players!.length));
  expect(summary).not.toBeNull();
  return summary!;
}

// ── AC1: the human seat's descriptor drives the button ───────

describe('competitive Turn Summary — descriptor-gated [ Bank Loan ] (AC1)', () => {
  it('keys the panel to the human seat and exposes that seat’s enabled descriptor', () => {
    const state = competitiveState('competitive-descriptor-enabled');
    const summary = summaryFor(state);

    // The panel is keyed to seat 0 (the human), never `activePlayerId`.
    expect(summary.humanSeatId).toBe(0);
    // The button's enable flag is the human seat's own affordance…
    expect(summary.loanDescriptor.enabled).toBe(true);
    expect(summary.loanDescriptor.reason).toBeNull();
    // …so the panel renders no disabled hint at all.
    expect(summary.loanDescriptor.hint).toBeNull();
    // The menu the press hands to the selector is the configured one.
    expect(summary.loanDescriptor.options).toEqual(state.config.loanOptions);
    expect(summary.loanDescriptor.options.length).toBeGreaterThan(0);
  });

  it('is the single-player descriptor for that seat — one source of truth, not a copy', () => {
    const state = competitiveState('competitive-descriptor-source');

    // Same builder, same seat, same rules: the competitive panel cannot drift
    // from the single-player enable/disable matrix.
    expect(summaryFor(state).loanDescriptor).toEqual(
      buildTurnSummaryLoanDescriptor(state, 0),
    );
  });

  it('holds for three seats too (N ≥ 2, human seat is always the button’s seat)', () => {
    const state = competitiveState('competitive-descriptor-three-seats', 3);
    const summary = summaryFor(state);

    expect(summary.rows.map((row) => row.ownerId)).toEqual([0, 1, 2]);
    expect(summary.humanSeatId).toBe(0);
    expect(summary.loanDescriptor.enabled).toBe(true);
  });

  it('evaluates the human seat, not the transient acting seat', () => {
    const state = competitiveState('competitive-descriptor-acting-seat');
    // The AI seat is acting (round-robin turn) and owes a loan; the human seat
    // owes nothing, so the human's button stays available.
    state.activePlayerId = 1;
    state.loans = [activeLoan(1)];

    const summary = summaryFor(state);

    expect(summary.humanSeatId).toBe(0);
    expect(summary.loanDescriptor.enabled).toBe(true);
    expect(summary.loanDescriptor.activeLoan).toBeNull();
  });

  it('disables the button for the human seat’s own obligation even while an AI seat is acting', () => {
    const state = competitiveState('competitive-descriptor-human-owes');
    state.activePlayerId = 1;
    state.loans = [activeLoan(0, { perTurnRepayment: 110, turnsRemaining: 4 })];

    const summary = summaryFor(state);

    expect(summary.humanSeatId).toBe(0);
    expect(summary.loanDescriptor.enabled).toBe(false);
    expect(summary.loanDescriptor.reason).toBe('active-loan');
  });

  it('disables the button with no hint when the roster has no human seat', () => {
    const state = competitiveState('competitive-descriptor-no-human', 2);
    // A headless / hand-driven roster: every seat is AI-controlled, so the
    // panel has no seat to key the button to (`humanSeatId === -1` is the
    // overlay's disable condition).
    for (const player of state.players!) player.controller = 'ai';

    const summary = summaryFor(state);

    expect(summary.humanSeatId).toBe(-1);
    expect(summary.loanDescriptor.enabled).toBe(false);
    expect(summary.loanDescriptor.hint).toBeNull();
  });
});

// ── AC4d: loans disabled / empty menu ───────────────────────

describe('competitive Turn Summary — disabled reasons (AC4d)', () => {
  it('disables the button with the loans-disabled hint when the run has loans off', () => {
    const state = competitiveState('competitive-descriptor-loans-off', 2, false);

    const descriptor = summaryFor(state).loanDescriptor;

    expect(descriptor.enabled).toBe(false);
    expect(descriptor.reason).toBe('loans-disabled');
    expect(descriptor.options).toEqual([]);
    expect(descriptor.hint).toBe(LOANS_DISABLED_HINT);
    // The retired competitive-only copy is gone: the panel now explains with
    // the same wording single-player uses.
    expect(descriptor.hint).not.toBe(RETIRED_STATIC_HINT);
  });

  it('disables the button with the no-options hint when the loan menu is empty', () => {
    const state = competitiveState('competitive-descriptor-no-options');
    state.config = { ...state.config, loanOptions: [] };

    const descriptor = summaryFor(state).loanDescriptor;

    expect(descriptor.enabled).toBe(false);
    expect(descriptor.reason).toBe('no-options');
    expect(descriptor.options).toEqual([]);
    expect(descriptor.hint).toBe(NO_LOAN_OPTIONS_HINT);
  });
});

// ── AC4c (partial): the human seat's outstanding obligation ──

describe('competitive Turn Summary — active loan on the human seat (AC4c, partial)', () => {
  it('disables the button with that seat’s obligation hint', () => {
    const state = competitiveState('competitive-descriptor-active-loan');
    const loan = activeLoan(0, { perTurnRepayment: 110, turnsRemaining: 3 });
    state.loans = [loan];

    const descriptor = summaryFor(state).loanDescriptor;

    expect(descriptor.enabled).toBe(false);
    expect(descriptor.reason).toBe('active-loan');
    // The hint carries the button's own seat's obligation, worded exactly like
    // the HUD readout (producer Q3 = A).
    expect(descriptor.activeLoan).toEqual({ perTurnRepayment: 110, turnsRemaining: 3 });
    expect(descriptor.hint).toBe(formatLoanObligation(loan));
    expect(descriptor.hint).toBe('Loan: 110 coins/turn, 3 turns left');
  });
});

// ── Read-only rendering ─────────────────────────────────────

describe('competitive Turn Summary — descriptor build is read-only', () => {
  it('mutates no state while deciding the button’s state', () => {
    const state = competitiveState('competitive-descriptor-read-only');
    state.loans = [activeLoan(0)];
    const before = JSON.stringify(state);

    summaryFor(state);
    summaryFor(state);

    // Rendering a panel (and its loan affordance) is a pure read: no wallet,
    // ledger, loan or config field may change.
    expect(JSON.stringify(state)).toBe(before);
  });
});
