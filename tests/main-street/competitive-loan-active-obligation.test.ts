/**
 * Main Street: a competitive human seat already repaying a loan
 * (MS-0MW4YUFH6005M7UJ, parent MS-0MW4XQXY6005YG72).
 *
 * The sibling suite `competitive-loan-descriptor.test.ts` pins which seat the
 * competitive Turn Summary button is keyed to and the descriptor's
 * enable/disable matrix; this suite covers the **full active-obligation flow**
 * that item deliberately left partial:
 *
 *   AC2  — a human seat already repaying a loan cannot take a second one (the
 *          one-active-loan rule, unmodified), and the refused take leaves the
 *          seat's wallet, loans, turn and action budget untouched;
 *   AC4c — the button's disabled state is explained by that seat's own
 *          outstanding obligation — the same wording as the HUD readout — and
 *          never by the retired static competitive copy.
 *
 * The overlay half (muted colour, inert input, the hint itself drawn on the
 * panel) is covered by `competitive-loan-active-obligation.browser.test.ts`;
 * this suite is the Phaser-free model + command contract behind it, so a
 * regression in either half fails loudly without the other masking it.
 *
 * @module tests/main-street/competitive-loan-active-obligation
 */

import { describe, expect, it } from 'vitest';

import { createCompetitiveState, type MainStreetState } from '../../src/MainStreetState';
import type { CompetitiveRoundLedger, TurnResult } from '../../src/MainStreetEngineTypes';
import type { EventCard } from '../../src/MainStreetCards';
import type { ActiveLoan } from '../../src/MainStreetStateTypes';
import {
  applyLoanPayment,
  canTakeLoan,
  formatLoanObligation,
  hudLoanReadout,
} from '../../src/MainStreetLoans';
import { takeLoanCommand } from '../../src/MainStreetCommands';
import {
  LOANS_DISABLED_HINT,
  NO_LOAN_OPTIONS_HINT,
} from '../../src/scenes/MainStreetLoanSelectorModel';
import { buildCompetitiveTurnSummary } from '../../src/scenes/MainStreetTurnSummary';

// ── Fixtures ─────────────────────────────────────────────────

/** The copy the competitive panel shipped while the button was unwired. */
const RETIRED_STATIC_HINT = 'Bank loans are not available in competitive play yet.';

/** Human seat id in every fixture: seat 0 is the player-controlled seat. */
const HUMAN_SEAT_ID = 0;

/** A two-seat competitive state with loans on (the shipped default). */
function competitiveState(seed: string): MainStreetState {
  return createCompetitiveState({
    seed,
    playerCount: 2,
    difficulty: 'Easy',
    loansEnabled: true,
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

/** A competitive state whose human seat is already repaying a loan. */
function humanSeatOwing(seed: string, overrides: Partial<ActiveLoan> = {}): MainStreetState {
  const state = competitiveState(seed);
  state.loans = [activeLoan(HUMAN_SEAT_ID, overrides)];
  return state;
}

/** The loan descriptor the competitive panel's `[ Bank Loan ]` button renders. */
function competitiveLoanDescriptor(state: MainStreetState) {
  const summary = buildCompetitiveTurnSummary(state, CLOSING);
  expect(summary).not.toBeNull();
  return summary!.loanDescriptor;
}

/** Everything a refused take must leave exactly as it found it. */
function snapshot(state: MainStreetState) {
  return {
    coins: state.players![HUMAN_SEAT_ID].coins,
    loans: state.loans.map((loan) => ({ ...loan })),
    turn: state.turn,
    actionsRemaining: state.actionsRemaining,
  };
}

// ── AC4c: the obligation hint, not the static competitive copy ─

describe('competitive [ Bank Loan ] — the human seat’s obligation hint (AC4c)', () => {
  it('explains the disabled button with that seat’s own outstanding obligation', () => {
    const state = humanSeatOwing('competitive-obligation-hint', {
      perTurnRepayment: 110,
      turnsRemaining: 4,
    });

    const descriptor = competitiveLoanDescriptor(state);

    expect(descriptor.enabled).toBe(false);
    expect(descriptor.reason).toBe('active-loan');
    // The button says *why* with the seat's own obligation — the same copy the
    // HUD readout uses, so the two surfaces can never drift.
    expect(descriptor.hint).toBe('Loan: 110 coins/turn, 4 turns left');
    expect(descriptor.hint).toBe(hudLoanReadout(state, HUMAN_SEAT_ID));
    expect(descriptor.hint).not.toBe(RETIRED_STATIC_HINT);
    // And not one of the other disabled reasons' copy (the hint is
    // reason-specific, never a generic note).
    expect(descriptor.hint).not.toBe(LOANS_DISABLED_HINT);
    expect(descriptor.hint).not.toBe(NO_LOAN_OPTIONS_HINT);
  });

  it('names the obligation even when the loan menu happens to be empty', () => {
    const state = humanSeatOwing('competitive-obligation-empty-menu');
    state.config = { ...state.config, loanOptions: [] };

    const descriptor = competitiveLoanDescriptor(state);

    // Rule precedence: an existing obligation is the more fundamental block,
    // so the player is told to repay rather than that nothing is on offer.
    expect(descriptor.enabled).toBe(false);
    expect(descriptor.reason).toBe('active-loan');
    expect(descriptor.hint).toBe(formatLoanObligation(activeLoan(HUMAN_SEAT_ID)));
    expect(descriptor.hint).not.toBe(NO_LOAN_OPTIONS_HINT);
  });

  it('keeps the hint in step with the seat’s live repayment schedule', () => {
    const state = humanSeatOwing('competitive-obligation-live-schedule', {
      perTurnRepayment: 110,
      turnsRemaining: 2,
    });
    expect(competitiveLoanDescriptor(state).hint).toBe(
      'Loan: 110 coins/turn, 2 turns left',
    );

    // One payment later the panel's own hint shortens — it is derived from the
    // live loan record, not captured when the loan was taken.
    state.loans = [applyLoanPayment(state.loans[0])!];
    expect(competitiveLoanDescriptor(state).hint).toBe(
      'Loan: 110 coins/turn, 1 turn left',
    );
  });
});

// ── AC2: one active loan per seat, unmodified ───────────────

describe('competitive mid-game take — one active loan per human seat (AC2)', () => {
  it('refuses a second loan for the human seat with the one-active-loan reason', () => {
    const state = humanSeatOwing('competitive-obligation-refusal');
    // The competitive Turn Summary gate holds the shared day on the advanced
    // day's WeekStart — the deferred-closing window a mid-game take opts into.
    state.phase = 'WeekStart';

    const verdict = canTakeLoan(state, 0, HUMAN_SEAT_ID, { allowDuringClosing: true });

    expect(verdict.legal).toBe(false);
    expect(verdict.legal === false && verdict.reason).toMatch(/one loan at a time/i);
  });

  it('books nothing when the refused take is dispatched through the command surface', () => {
    const state = humanSeatOwing('competitive-obligation-command-refusal');
    state.phase = 'WeekStart';
    const before = snapshot(state);

    // Exactly the call the competitive panel's confirm path makes — explicit
    // `ownerId` = the human seat, deferred-closing opt-in — and it is refused
    // before any mutation (nothing to roll back).
    const command = takeLoanCommand(
      state,
      1,
      { allowDuringClosing: true },
      HUMAN_SEAT_ID,
    );

    expect(() => command.execute()).toThrow(/one loan at a time/i);
    expect(snapshot(state)).toEqual(before);
    expect(state.loans).toHaveLength(1);
  });

  it('still lets an unindebted seat borrow — the rule is per seat, not global', () => {
    const state = humanSeatOwing('competitive-obligation-per-seat');
    state.phase = 'WeekStart';
    const aiCoinsBefore = state.players![1].coins;

    // Seat 1 owes nothing, so the same command with its own ownerId succeeds
    // while the human seat's loan stands: the rule was never made global to
    // block the competitive flow.
    takeLoanCommand(state, 0, { allowDuringClosing: true }, 1).execute();

    expect(state.loans.map((loan) => loan.ownerId).sort()).toEqual([0, 1]);
    expect(state.players![1].coins).toBe(aiCoinsBefore + state.config.loanOptions[0].principal);
  });
});
