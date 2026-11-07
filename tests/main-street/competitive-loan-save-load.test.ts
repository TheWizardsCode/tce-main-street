/**
 * Main Street: competitive bank loans — save/load round-trip with a mid-game
 * take (MS-0MW4YUG7D004Z5L5, parent MS-0MW4XQXY6005YG72).
 *
 * The competitive mid-game `[ Bank Loan ]` entry point (MS-0MW4YUHOU00474HZ)
 * is wired and its descriptor/one-active-loan rules are pinned by
 * `competitive-loan-descriptor.test.ts` and
 * `competitive-loan-active-obligation.test.ts`. This suite pins the
 * **persistence** half of that flow:
 *
 *   AC4e — a mid-game take survives a save/load round-trip and the loaded day
 *          keeps playing (repayments resume, a later take still works);
 *   AC3  — the loan's principal, obligation and remaining repayment schedule
 *          persist verbatim, per seat, with no wallet credited or charged by
 *          the load itself;
 *   the competitive Turn Summary built from the loaded state reflects the
 *   loaded obligation without resurrecting eliminated seats or emitting ghost
 *   rows (the panel's own row/elimination invariants).
 *
 * Single-player persistence is covered by `MainStreetLoanSaveLoad.test.ts`;
 * this file asserts only the competitive (per-seat) round-trip contract.
 *
 * @module tests/main-street/competitive-loan-save-load
 */

import { describe, expect, it } from 'vitest';

import {
  createCompetitiveState,
  deserializeMainStreetState,
  serializeMainStreetState,
  type MainStreetState,
} from '../../src/MainStreetState';
import { startCompetitiveDay } from '../../src/scenes/MainStreetTurnControllerCompetitive';
import { takeLoanCommand } from '../../src/MainStreetCommands';
import {
  activeLoanFor,
  applyLoanRepayments,
  formatLoanObligation,
} from '../../src/MainStreetLoans';
import { buildCompetitiveTurnSummary } from '../../src/scenes/MainStreetTurnSummary';
import { buildTurnSummaryLoanDescriptor } from '../../src/scenes/MainStreetLoanSelectorModel';
import type { ActiveLoan } from '../../src/MainStreetStateTypes';
import type { CompetitiveRoundLedger, TurnResult } from '../../src/MainStreetEngineTypes';

// ── Fixtures ─────────────────────────────────────────────────

/** Human seat id in every fixture: seat 0 is the player-controlled seat. */
const HUMAN_SEAT_ID = 0;

/** The shared day this suite saves from (mid-game: past the opening grace). */
const MID_GAME_TURN = 4;

/** A competitive game mid-day, with bank loans enabled (the shipped default). */
function midGameState(seed: string, playerCount = 3): MainStreetState {
  const state = createCompetitiveState({
    seed,
    playerCount,
    difficulty: 'Easy',
    loansEnabled: true,
  });
  startCompetitiveDay(state);
  state.turn = MID_GAME_TURN;
  return state;
}

/**
 * Takes a loan through the command surface — exactly the call the competitive
 * Turn Summary's confirm path makes (explicit seat, deferred-closing opt-in) —
 * and returns the recorded loan.
 */
function takeLoanMidGame(
  state: MainStreetState,
  optionIndex: number,
  ownerId: number = HUMAN_SEAT_ID,
): ActiveLoan {
  const before = (state.loans ?? []).length;
  takeLoanCommand(state, optionIndex, { allowDuringClosing: true }, ownerId).execute();
  const loans = state.loans ?? [];
  expect(loans, 'the take must record exactly one loan').toHaveLength(before + 1);
  return loans[loans.length - 1];
}

/** Round-trips a state through the real serializer. */
function roundTrip(state: MainStreetState): MainStreetState {
  return deserializeMainStreetState(serializeMainStreetState(state));
}

/** Each seat's wallet, in seat order. */
function seatCoins(state: MainStreetState): number[] {
  return state.players!.map((seat) => seat.coins);
}

/**
 * A hand-built competitive round ledger for `ownerIds`.
 *
 * Deliberately allowed to carry a seat the roster has since eliminated: a
 * legacy or hand-built ledger can, and the panel must still filter it out
 * (no ghost rows).
 */
function roundLedger(turn: number, ownerIds: number[]): CompetitiveRoundLedger {
  return {
    turn,
    seats: ownerIds.map((ownerId) => ({
      ownerId,
      businessesOwned: 1,
      incomeByPhase: { base: 10, synergy: 0, reputation: 0, events: 0 },
      incomeTotal: 10,
      netCoinChange: 10,
    })),
  };
}

/** Builds the competitive summary for a state, failing loudly if it is absent. */
function summaryFor(state: MainStreetState, ledger: CompetitiveRoundLedger) {
  const input: Pick<TurnResult, 'playerRoundLedger'> = { playerRoundLedger: ledger };
  const summary = buildCompetitiveTurnSummary(state, input);
  expect(summary).not.toBeNull();
  return summary!;
}

// ── AC4e: the mid-game take itself ───────────────────────────

describe('competitive mid-game take before the round-trip (AC4e)', () => {
  it('books the take to the human seat, not the transient acting seat', () => {
    const state = midGameState('competitive-loan-save-take');
    // The shared day's close can leave an AI seat acting; the panel's take is
    // keyed to the human seat regardless.
    state.activePlayerId = 1;
    const coinsBefore = seatCoins(state);
    const actionsBefore = state.actionsRemaining;

    const loan = takeLoanMidGame(state, 1);

    expect(loan).toMatchObject({
      ownerId: HUMAN_SEAT_ID,
      principal: 600,
      totalRepayment: 660,
      perTurnRepayment: 110,
      turnsRemaining: 6,
      termTurns: 6,
      takenOnTurn: MID_GAME_TURN,
    });
    // Per seat: only the borrowing seat's wallet is credited.
    expect(seatCoins(state)).toEqual([
      coinsBefore[0] + 600,
      coinsBefore[1],
      coinsBefore[2],
    ]);
    // The take stays AP-neutral (parent constraint) and is the seat's loan.
    expect(state.actionsRemaining).toBe(actionsBefore);
    expect(activeLoanFor(state, HUMAN_SEAT_ID)).toEqual(loan);
  });

  it('writes the loan into the save payload the checkpoint persists', () => {
    const state = midGameState('competitive-loan-save-payload');
    const loan = takeLoanMidGame(state, 1);

    expect(serializeMainStreetState(state).loans).toEqual([loan]);
  });
});

// ── AC3: the loan record round-trips ────────────────────────

describe('competitive loan save/load round-trip (AC3)', () => {
  it('preserves the principal, obligation and schedule across a reload', () => {
    const state = midGameState('competitive-loan-save-roundtrip');
    const loan = takeLoanMidGame(state, 1);
    const coinsAtSave = seatCoins(state);

    const restored = roundTrip(state);

    expect(restored.loans).toEqual([loan]);
    expect(activeLoanFor(restored, HUMAN_SEAT_ID)).toMatchObject({
      ownerId: HUMAN_SEAT_ID,
      principal: 600,
      totalRepayment: 660,
      perTurnRepayment: 110,
      turnsRemaining: 6,
      termTurns: 6,
      takenOnTurn: MID_GAME_TURN,
    });
    // The load neither re-credits the principal nor charges an instalment.
    expect(seatCoins(restored)).toEqual(coinsAtSave);
    // The obligation the HUD and the panel's hint show is derived from the
    // loaded record, not captured at take time.
    expect(formatLoanObligation(restored.loans[0])).toBe(
      'Loan: 110 coins/turn, 6 turns left',
    );
  });

  it('resumes a mid-term save with exactly the payments the human seat had left', () => {
    const state = midGameState('competitive-loan-save-midterm');
    takeLoanMidGame(state, 0); // 300 principal / 3 turns → 110 per turn
    expect(applyLoanRepayments(state)).toBe(-110); // 2 turns left at the save
    const coinsAtSave = seatCoins(state);

    const restored = roundTrip(state);
    expect(restored.loans[0]).toMatchObject({
      principal: 300,
      totalRepayment: 330,
      perTurnRepayment: 110,
      turnsRemaining: 2,
      termTurns: 3,
    });

    // Exactly the two remaining instalments, at the same fixed amount, billed
    // to the borrowing seat — then the loan retires and nothing further is
    // charged.
    expect(applyLoanRepayments(restored)).toBe(-110);
    expect(applyLoanRepayments(restored)).toBe(-110);
    expect(restored.loans).toEqual([]);
    expect(applyLoanRepayments(restored)).toBe(0);

    expect(seatCoins(restored)).toEqual([
      coinsAtSave[0] - 2 * 110,
      coinsAtSave[1],
      coinsAtSave[2],
    ]);
  });

  it('keeps each seat’s loan on its own seat and schedule across the reload', () => {
    const state = midGameState('competitive-loan-save-per-seat');
    const humanLoan = takeLoanMidGame(state, 0, HUMAN_SEAT_ID); // 3 turns
    const otherSeatLoan = takeLoanMidGame(state, 2, 1); // 10 turns

    const restored = roundTrip(state);

    expect(restored.loans).toEqual([humanLoan, otherSeatLoan]);
    expect(activeLoanFor(restored, HUMAN_SEAT_ID)).toEqual(humanLoan);
    expect(activeLoanFor(restored, 1)).toEqual(otherSeatLoan);

    // The standing repayment pass bills each borrowing seat its own instalment
    // and leaves the seat that borrowed nothing alone.
    const coinsBefore = seatCoins(restored);
    expect(applyLoanRepayments(restored)).toBe(
      -(humanLoan.perTurnRepayment + otherSeatLoan.perTurnRepayment),
    );
    expect(seatCoins(restored)).toEqual([
      coinsBefore[0] - humanLoan.perTurnRepayment,
      coinsBefore[1] - otherSeatLoan.perTurnRepayment,
      coinsBefore[2],
    ]);
  });
});

// ── AC4e: the loaded day keeps playing ──────────────────────

describe('the loaded competitive day keeps playing (AC4e)', () => {
  it('still takes a mid-game loan after a reload, and the next save keeps it', () => {
    const state = midGameState('competitive-loan-save-take-after-load');
    const restored = roundTrip(state);
    expect(restored.loans).toEqual([]);
    const coinsBefore = seatCoins(restored);

    const loan = takeLoanMidGame(restored, 0);

    expect(loan.ownerId).toBe(HUMAN_SEAT_ID);
    expect(seatCoins(restored)).toEqual([
      coinsBefore[0] + loan.principal,
      coinsBefore[1],
      coinsBefore[2],
    ]);
    // The take made after a load is itself persisted by the next checkpoint.
    expect(roundTrip(restored).loans).toEqual([loan]);
  });

  it('keeps the one-active-loan rule after the reload', () => {
    const state = midGameState('competitive-loan-save-one-loan');
    const loan = takeLoanMidGame(state, 1, HUMAN_SEAT_ID);
    const restored = roundTrip(state);
    const before = {
      coins: seatCoins(restored),
      loans: restored.loans.map((entry) => ({ ...entry })),
      turn: restored.turn,
      actionsRemaining: restored.actionsRemaining,
    };

    // The loaded obligation still blocks a second loan for that seat ...
    expect(() =>
      takeLoanCommand(restored, 0, { allowDuringClosing: true }, HUMAN_SEAT_ID).execute(),
    ).toThrow(/one loan at a time/i);

    // ... and the refusal mutated nothing (the engine refuses before it acts).
    expect(seatCoins(restored)).toEqual(before.coins);
    expect(restored.loans).toEqual(before.loans);
    expect(restored.loans).toEqual([loan]);
    expect(restored.turn).toBe(before.turn);
    expect(restored.actionsRemaining).toBe(before.actionsRemaining);
  });
});

// ── Constraint: the Turn Summary after the load ─────────────

describe('competitive Turn Summary reflects the loaded loan (Constraint)', () => {
  it('shows the loaded loan as the human seat’s obligation, exactly as before the save', () => {
    const state = midGameState('competitive-loan-save-summary');
    const loan = takeLoanMidGame(state, 1);
    const ledger = roundLedger(MID_GAME_TURN, [0, 1, 2]);

    const before = summaryFor(state, ledger);
    expect(before.loanDescriptor.enabled).toBe(false);
    expect(before.loanDescriptor.reason).toBe('active-loan');

    const restored = roundTrip(state);
    const after = summaryFor(restored, ledger);

    // The whole panel is unchanged by the round-trip — same rows, same
    // descriptor — so a reload can never reshape the competitive summary.
    expect(after).toEqual(before);
    expect(after.humanSeatId).toBe(HUMAN_SEAT_ID);
    expect(after.rows.map((row) => row.ownerId)).toEqual([0, 1, 2]);
    // The button's disabled state is the loaded seat's own obligation, worded
    // exactly like the HUD readout and derived by the single-player builder.
    expect(after.loanDescriptor.activeLoan).toEqual({
      perTurnRepayment: loan.perTurnRepayment,
      turnsRemaining: loan.turnsRemaining,
    });
    expect(after.loanDescriptor.hint).toBe(formatLoanObligation(loan));
    expect(after.loanDescriptor).toEqual(
      buildTurnSummaryLoanDescriptor(restored, HUMAN_SEAT_ID),
    );
  });

  it('keeps the panel in step with the loaded repayment schedule as it is paid down', () => {
    const state = midGameState('competitive-loan-save-summary-schedule');
    takeLoanMidGame(state, 0); // 300 principal / 3 turns
    const ledger = roundLedger(MID_GAME_TURN, [0, 1, 2]);
    const restored = roundTrip(state);

    // The hint is derived from the loaded record, so a payment made after the
    // reload shortens it — it is never a snapshot captured at save time.
    applyLoanRepayments(restored);
    expect(summaryFor(restored, ledger).loanDescriptor.hint).toBe(
      'Loan: 110 coins/turn, 2 turns left',
    );

    // Paying the loaded loan off re-enables the human seat's button.
    applyLoanRepayments(restored);
    applyLoanRepayments(restored);
    const retired = summaryFor(restored, ledger);
    expect(restored.loans).toEqual([]);
    expect(retired.loanDescriptor.enabled).toBe(true);
    expect(retired.loanDescriptor.activeLoan).toBeNull();
    expect(retired.loanDescriptor.hint).toBeNull();
  });

  it('never resurrects an eliminated seat or emits a ghost row', () => {
    const state = midGameState('competitive-loan-save-eliminated', 3);
    takeLoanMidGame(state, 1);
    state.players![2].eliminated = true;
    // A legacy/hand-built ledger may still carry the eliminated seat's entry.
    const ledger = roundLedger(MID_GAME_TURN, [0, 1, 2]);

    const restored = roundTrip(state);

    // The elimination itself persists ...
    expect(restored.players![2].eliminated).toBe(true);
    const summary = summaryFor(restored, ledger);
    // ... and the panel lists exactly the seats still playing: seat 2 is never
    // resurrected as a row.
    expect(summary.rows.map((row) => row.ownerId)).toEqual([0, 1]);
    expect(summary.rows.some((row) => row.ownerId === 2)).toBe(false);
    // The loan's obligation still drives the human seat's button.
    expect(summary.loanDescriptor.reason).toBe('active-loan');
    expect(summary.humanSeatId).toBe(HUMAN_SEAT_ID);
  });

  it('does not disable the human button for a loan held by another seat', () => {
    const state = midGameState('competitive-loan-save-other-seat', 3);
    takeLoanMidGame(state, 1, 1); // another seat owes; the human seat owes nothing

    const summary = summaryFor(roundTrip(state), roundLedger(MID_GAME_TURN, [0, 1, 2]));

    expect(summary.loanDescriptor.enabled).toBe(true);
    expect(summary.loanDescriptor.activeLoan).toBeNull();
    expect(summary.loanDescriptor.hint).toBeNull();
    expect(summary.rows.map((row) => row.ownerId)).toEqual([0, 1, 2]);
  });
});
