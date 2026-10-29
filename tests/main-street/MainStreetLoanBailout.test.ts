/**
 * Main Street: Bank Loans — per-turn repayment in the closing sequence
 * (Bank Loans epic MS-0MVL6DZI0000F6CG, slice MS-0MVPWS885006O5QR).
 *
 * This is the home of the loan repayment and bailout integration tests.
 * The repayment half landed with MS-0MVPWS885006O5QR; the bailout
 * offer/accept/decline/AI/headless cases landed with MS-0MVPWS9L9001PVXG.
 *
 * AC coverage (repayment slice):
 *   AC1 — at the end of every turn in which a seat holds an active loan,
 *         exactly `perTurnRepayment` coins leave that seat's wallet and the
 *         deduction is recorded in the turn's net summary as a one-off
 *         expense (turn ledger `oneOffDeltas`, plus one activity-log row).
 *   AC2 — the loan is retired after `termTurns` payments and no further
 *         deductions occur (no seventh payment).
 *   AC3 — repayment is deducted unconditionally: a payment that exceeds the
 *         seat's balance leaves `coins < 0` and triggers the ordinary
 *         bankruptcy path (an existing loan means no bailout offer).
 *
 * AC coverage (bailout slice):
 *   AC1 — a single-player seat at `coins < 0` with no active loan is offered
 *         a loan instead of losing; accepting credits the principal and play
 *         continues, declining preserves bankruptcy.
 *   AC2 — at most one offer per seat per turn (no loop), and a seat that
 *         already holds an active loan goes bankrupt without an offer.
 *   AC3 — the AI/headless policy auto-accepts the largest option and the seat
 *         survives; no proactive loans exist.
 *   AC4 — headless turn execution never stalls on a pending offer and resolves
 *         deterministically.
 *   AC5 — the opening-day solvency grace is respected.
 *
 * Fixtures: a "quiet" game in which nothing except the loan moves coins (no
 * street cards, staff, challenges, active effects or incident cards), so every
 * coin delta in a turn is unambiguously attributable to repayment.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import {
  createCompetitiveState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import { bindCompetitiveSeat, restoreCompetitiveSeat } from '../../src/MainStreetAiStrategy';
import {
  acceptLoanOffer,
  applyEndOfTurnDeltas,
  declineLoanOffer,
  endTurnHeadless,
  executeCompetitiveTurn,
  executeWeekStart,
  finishDeferredTurnClosing,
  maybeOfferBailout,
  processEndOfTurn,
  takeLoan,
  type TurnResult,
} from '../../src/MainStreetEngine';
import {
  DEFAULT_LOAN_OPTIONS,
  applyLoanRepayments,
  largestBailoutOption,
} from '../../src/MainStreetLoans';
import { syncResourceBankToLedger } from '../../src/MainStreetStateLog';

// ── Fixtures ─────────────────────────────────────────────────

/** The per-turn repayment of every default option at the default 10% rate. */
const PER_TURN = 110;

/**
 * Fresh single-player game armed in MarketPhase with nothing that moves
 * coins: no placed cards, staff, challenges, active effects or incidents.
 */
function quietMarketState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state, true);
  quietTurnEconomy(state);
  return state;
}

/** Strips every coin-moving element except the loan from a state. */
function quietTurnEconomy(state: MainStreetState): void {
  state.streetGrid = state.streetGrid.map(() => null);
  state.staffCards = [];
  state.hand = [];
  state.activeChallenges = [];
  state.activeEffects = [];
  state.incidentDeck = [];
  state.decks.event = [];
  state.discards.event = [];
}

/** Advances to MarketPhase when the previous turn left the game at WeekStart. */
function armTurn(state: MainStreetState): void {
  if (state.phase === 'WeekStart') executeWeekStart(state, true);
}

/**
 * Re-bases the day-start snapshots onto the current wallet, so a fixture's
 * only ledger movement for the turn is the repayment.
 */
function rebaseDaySnapshot(state: MainStreetState): void {
  state.weekStartCoins = state.resourceBank.coins;
  state.weekStartRep = state.resourceBank.reputation;
  state.weekStartScore = state.finalScore;
}

/** All activity-log rows recording a loan repayment. */
function repaymentRows(state: MainStreetState) {
  return state.activityLog.filter((entry) => entry.text.includes('Loan repayment'));
}

// ── applyLoanRepayments — the direct pass ────────────────────

describe('applyLoanRepayments — direct pass', () => {
  it('debits the fixed per-turn amount, decrements the term and logs one expense row', () => {
    const state = quietMarketState('loan-repay-direct');
    takeLoan(state, 1); // 600 / 6 → 110 per turn
    const coinsBefore = state.resourceBank.coins;
    const logBefore = state.activityLog.length;

    const total = applyLoanRepayments(state);

    expect(total).toBe(-PER_TURN);
    expect(state.resourceBank.coins).toBe(coinsBefore - PER_TURN);
    expect(state.loans).toHaveLength(1);
    expect(state.loans[0].turnsRemaining).toBe(5);

    expect(repaymentRows(state)).toHaveLength(1);
    const row = repaymentRows(state)[0];
    expect(row.type).toBe('loss');
    expect(row.text).toContain(`-${PER_TURN}`);
    expect(row.text).toContain('5 turns left');
    // One row only — no parallel per-turn notification channel.
    expect(state.activityLog).toHaveLength(logBefore + 1);
  });

  it('is a no-op when the seat holds no loan', () => {
    const state = quietMarketState('loan-repay-none');
    const coinsBefore = state.resourceBank.coins;
    const logBefore = state.activityLog.length;

    expect(applyLoanRepayments(state)).toBe(0);

    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.activityLog).toHaveLength(logBefore);
    expect(state.loans).toEqual([]);
  });

  it('treats loansEnabled:false as a hard no-op, even with a loan recorded', () => {
    const state = quietMarketState('loan-repay-disabled');
    takeLoan(state, 0);
    // Simulate a disabled config on a state that (for whatever reason) still
    // carries a loan: the pass must not debit, log or advance the term.
    state.config = { ...state.config, loansEnabled: false };
    const coinsBefore = state.resourceBank.coins;
    const logBefore = state.activityLog.length;
    const loanBefore = { ...state.loans[0] };

    expect(applyLoanRepayments(state)).toBe(0);

    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.activityLog).toHaveLength(logBefore);
    expect(state.loans).toEqual([loanBefore]);
  });

  it('deducts unconditionally, leaving a negative balance on a shortfall', () => {
    const state = quietMarketState('loan-repay-shortfall');
    takeLoan(state, 2); // 1000 / 10
    state.resourceBank.coins = 50;
    syncResourceBankToLedger(state);
    state.weekStartCoins = 50;

    expect(applyLoanRepayments(state)).toBe(-PER_TURN);

    // Producer Q6 = A: never clamped to the available balance.
    expect(state.resourceBank.coins).toBe(50 - PER_TURN);
    expect(state.resourceBank.coins).toBeLessThan(0);
  });

  it('retires the loan on its final payment and never debits it again', () => {
    const state = quietMarketState('loan-repay-retire');
    takeLoan(state, 0); // 300 / 3

    for (let payment = 1; payment <= 3; payment++) {
      expect(state.loans[0].turnsRemaining).toBe(4 - payment);
      applyLoanRepayments(state);
    }

    expect(state.loans).toEqual([]);
    const coinsAfterTerm = state.resourceBank.coins;
    const logAfterTerm = state.activityLog.length;

    // No further deductions, rows or loan bookkeeping.
    expect(applyLoanRepayments(state)).toBe(0);
    expect(state.resourceBank.coins).toBe(coinsAfterTerm);
    expect(state.activityLog).toHaveLength(logAfterTerm);
    expect(repaymentRows(state).at(-1)!.text).toContain('loan repaid in full');
  });
});

// ── Closing-sequence integration: single-player ─────────────

describe('per-turn repayment in the closing sequence (single-player)', () => {
  it.each([
    { optionIndex: 0, principal: 300, termTurns: 3 },
    { optionIndex: 1, principal: 600, termTurns: 6 },
  ])(
    'pays $principal over $termTurns turns at 110 per turn, then retires the loan',
    ({ optionIndex, principal, termTurns }) => {
      const state = quietMarketState(`loan-repay-schedule-${principal}`);
      takeLoan(state, optionIndex);
      const coinsAfterLoan = state.resourceBank.coins;
      const deltas: number[] = [];

      for (let turn = 0; turn < termTurns; turn++) {
        armTurn(state);
        const before = state.resourceBank.coins;
        processEndOfTurn(state);
        deltas.push(state.resourceBank.coins - before);
        // The term counts down one payment per closing.
        if (turn < termTurns - 1) {
          expect(state.loans[0].turnsRemaining).toBe(termTurns - 1 - turn);
        }
      }

      expect(deltas).toEqual(Array(termTurns).fill(-PER_TURN));
      // 300/3 → 330, 600/6 → 660 total repaid.
      expect(deltas.reduce((sum, delta) => sum + delta, 0)).toBe(-PER_TURN * termTurns);
      expect(state.resourceBank.coins).toBe(coinsAfterLoan - PER_TURN * termTurns);
      expect(state.loans).toEqual([]);

      // There is no seventh (or fourth) deduction: a further turn is free of
      // loan effects.
      armTurn(state);
      const beforeExtra = state.resourceBank.coins;
      const extra = processEndOfTurn(state);
      expect(state.resourceBank.coins).toBe(beforeExtra);
      expect(extra.turnLedger!.oneOffDeltas.coins).toBe(0);
    },
  );

  it('records the closing deduction as a one-off expense in the ledger and net row', () => {
    const state = quietMarketState('loan-repay-ledger');
    takeLoan(state, 1);
    // Snapshot the day AFTER the principal landed, so the only one-off in the
    // closing ledger is the repayment itself (the +600 principal, were it
    // captured, would legitimately appear as a pre-closing one-off too).
    rebaseDaySnapshot(state);
    armTurn(state);
    const before = state.resourceBank.coins;

    const result = processEndOfTurn(state);

    // The wallet moved by exactly one payment…
    expect(state.resourceBank.coins).toBe(before - PER_TURN);
    // …and the committed ledger attributes it as a one-off expense (the
    // residual outside income / ongoing costs / incident), reconciling exactly.
    const ledger = result.turnLedger!;
    expect(ledger.oneOffDeltas.coins).toBe(-PER_TURN);
    expect(ledger.netCoinChange).toBe(-PER_TURN);
    expect(ledger.incidentCoinChange).toBe(0);
    const incomeCoins =
      ledger.incomeByPhase.base + ledger.incomeByPhase.synergy
      + ledger.incomeByPhase.reputation + ledger.incomeByPhase.events;
    const ongoingCoins =
      ledger.ongoingCosts.staff + ledger.ongoingCosts.community + ledger.ongoingCosts.business;
    expect(
      incomeCoins + ongoingCoins + ledger.incidentCoinChange + ledger.oneOffDeltas.coins,
    ).toBe(ledger.netCoinChange);

    // The turn's net summary row reflects the repayment.
    const netRow = state.activityLog.find((entry) => entry.text.startsWith(`Turn ${state.turn - 1} net:`));
    expect(netRow).toBeDefined();
    expect(netRow!.text).toContain(`-${PER_TURN} coins`);
    // And one explicit expense row names the loan payment.
    expect(repaymentRows(state)).toHaveLength(1);
  });

  it('defers exactly one debit on the deferred-mutation path', () => {
    const state = quietMarketState('loan-repay-deferred');
    takeLoan(state, 1);
    rebaseDaySnapshot(state);
    armTurn(state);
    const before = state.resourceBank.coins;

    const deferred = processEndOfTurn(state, { deferResourceApplication: true });

    // The wallet is untouched until the scene applies the pending deltas…
    expect(state.resourceBank.coins).toBe(before);
    expect(deferred.pendingCoinDelta).toBe(-PER_TURN);
    // …but the loan bookkeeping and the expense row are committed once.
    expect(state.loans[0].turnsRemaining).toBe(5);
    expect(repaymentRows(state)).toHaveLength(1);
    // The paused ledger projects the payment as a one-off expense.
    expect(deferred.turnLedger!.oneOffDeltas.coins).toBe(-PER_TURN);

    applyEndOfTurnDeltas(state, deferred);
    expect(state.resourceBank.coins).toBe(before - PER_TURN);

    const closed: TurnResult = finishDeferredTurnClosing(state, deferred);
    // Exactly one debit across the whole deferred lifecycle.
    expect(state.resourceBank.coins).toBe(before - PER_TURN);
    expect(state.loans[0].turnsRemaining).toBe(5);
    expect(repaymentRows(state)).toHaveLength(1);
    expect(closed.turnLedger!.oneOffDeltas.coins).toBe(-PER_TURN);
  });

  it('leaves coins negative and triggers the ordinary bankruptcy path on a shortfall', () => {
    const state = quietMarketState('loan-repay-bankruptcy');
    takeLoan(state, 1); // 110 per turn
    state.resourceBank.coins = 50;
    syncResourceBankToLedger(state);
    state.weekStartCoins = 50;
    armTurn(state);

    const result = processEndOfTurn(state);

    expect(state.resourceBank.coins).toBe(50 - PER_TURN);
    expect(state.resourceBank.coins).toBeLessThan(0);
    // The seat already holds the loan it is repaying, so no bailout offer is
    // available (parent Q6 = A) and the ordinary bankruptcy path decides.
    expect(result.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
    expect(state.pendingLoanOffer).toBeNull();
  });

  it('keeps loansEnabled:false a hard no-op (no debit, no row, no term change)', () => {
    const state = quietMarketState('loan-repay-noop');
    takeLoan(state, 1);
    // Simulate a disabled config on a state that still carries a loan: the
    // closing sequence must ignore it completely (parent AC8 — the headless
    // baseline stays byte-identical, with no log rows or ledger entries).
    state.config = { ...state.config, loansEnabled: false };
    armTurn(state);
    // Day-start snapshot taken after the principal landed, so the only possible
    // ledger movement is a repayment.
    state.weekStartCoins = state.resourceBank.coins;
    state.weekStartRep = state.resourceBank.reputation;
    state.weekStartScore = state.finalScore;
    const coinsBefore = state.resourceBank.coins;
    const loanBefore = { ...state.loans[0] };

    const result = processEndOfTurn(state);

    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.loans).toEqual([loanBefore]);
    expect(repaymentRows(state)).toHaveLength(0);
    expect(result.turnLedger!.oneOffDeltas.coins).toBe(0);
    expect(result.turnLedger!.netCoinChange).toBe(0);
  });
});

// ── Closing-sequence integration: competitive seats ─────────

describe('per-turn repayment in the competitive shared closing', () => {
  it('debits only the borrowing seat and leaves the other seat wallets untouched', () => {
    const state = createCompetitiveState({
      seed: 'loan-repay-competitive',
      playerCount: 2,
    });
    executeWeekStart(state);
    // Seat 0 takes the loan while its record is the active wallet.
    state.activePlayerId = 0;
    bindCompetitiveSeat(state, 0);
    takeLoan(state, 1); // 600 / 6 → 110 per turn
    restoreCompetitiveSeat(state, 0);

    quietTurnEconomy(state);
    for (const player of state.players ?? []) {
      player.staffCards = [];
      player.hand = [];
    }

    const seat0Before = state.players![0].coins;
    const seat1Before = state.players![1].coins;

    // executeCompetitiveTurn re-arms the shared day from WeekStart.
    state.phase = 'WeekStart';
    executeCompetitiveTurn(state, [[], []]);

    expect(state.loans).toHaveLength(1);
    expect(state.loans[0]).toMatchObject({ ownerId: 0, turnsRemaining: 5 });
    expect(state.players![0].coins).toBe(seat0Before - PER_TURN);
    expect(state.players![1].coins).toBe(seat1Before);
    // The expense is logged against the borrowing seat.
    expect(repaymentRows(state)).toHaveLength(1);
    expect(repaymentRows(state)[0].seatId).toBe(0);
  });

  it('applies the repayment before seat failure resolution, so a shortfall is bankruptcy', () => {
    const state = createCompetitiveState({
      seed: 'loan-repay-competitive-shortfall',
      playerCount: 2,
    });
    executeWeekStart(state);
    state.activePlayerId = 0;
    bindCompetitiveSeat(state, 0);
    takeLoan(state, 1); // 110 per turn
    // Leave seat 0 unable to pay: the unconditional debit must push it negative.
    state.resourceBank.coins = 50;
    syncResourceBankToLedger(state);
    restoreCompetitiveSeat(state, 0);
    quietTurnEconomy(state);
    for (const player of state.players ?? []) {
      player.staffCards = [];
      player.hand = [];
    }
    // Skip past the opening-day solvency grace (turn 1) so the negative
    // balance is evaluated for real bankruptcy semantics.
    state.turn = 3;

    // executeCompetitiveTurn re-arms the shared day from WeekStart.
    state.phase = 'WeekStart';
    executeCompetitiveTurn(state, [[], []]);

    expect(state.players![0].coins).toBeLessThan(0);
    // The seat already holds the loan it is repaying, so no bailout offer is
    // available (parent Q6 = A) and the ordinary bankruptcy path decides.
    expect(state.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
    expect(state.pendingLoanOffer).toBeNull();
  });
});

// ── Bankruptcy bailout: offer / accept / decline ────────────
// (Bank Loans epic MS-0MVL6DZI0000F6CG, slice MS-0MVPWS9L9001PVXG)

describe('bankruptcy bailout offer (single-player)', () => {
  it('offers a loan instead of declaring bankruptcy when the seat is at coins < 0', () => {
    const state = quietMarketState('bailout-offer');
    state.resourceBank.coins = -50;
    syncResourceBankToLedger(state);
    rebaseDaySnapshot(state);
    const turnBefore = state.turn;

    const result = processEndOfTurn(state);

    // The closing paused BEFORE `checkImmediateLoss`: the run is still alive.
    expect(result.pendingLoanOffer).toBe(true);
    expect(result.requiresDeferredClosing).toBe(true);
    expect(result.gameResult).toBe('playing');
    expect(state.gameResult).toBe('playing');
    expect(state.endReason ?? '').not.toBe('bankruptcy');
    expect(state.pendingLoanOffer).toMatchObject({ ownerId: 0, reason: 'bankruptcy' });
    expect(state.pendingLoanOffer!.options).toEqual([...DEFAULT_LOAN_OPTIONS]);
    // The paused turn has not advanced yet — resolving the offer completes it.
    expect(state.turn).toBe(turnBefore);
  });

  it('does not offer when loans are disabled and bankruptcy stands', () => {
    const state = quietMarketState('bailout-disabled');
    state.config = { ...state.config, loansEnabled: false };
    state.resourceBank.coins = -50;
    syncResourceBankToLedger(state);

    const result = processEndOfTurn(state);

    expect(result.pendingLoanOffer).toBeFalsy();
    expect(result.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
    expect(state.pendingLoanOffer).toBeNull();
  });

  it('does not offer when the seat already holds an active loan', () => {
    const state = quietMarketState('bailout-active-loan');
    takeLoan(state, 1);
    state.resourceBank.coins = -50;
    syncResourceBankToLedger(state);

    const result = processEndOfTurn(state);

    // Parent Q6 = A: a seat already repaying a loan goes bankrupt.
    expect(result.pendingLoanOffer).toBeFalsy();
    expect(result.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
    expect(state.pendingLoanOffer).toBeNull();
  });
});

describe('accepting a bailout offer', () => {
  it('credits the principal and play continues (headless largest-option policy)', () => {
    const state = quietMarketState('bailout-accept');
    state.resourceBank.coins = -250;
    syncResourceBankToLedger(state);
    const turnBefore = state.turn;

    const result = endTurnHeadless(state);

    expect(result.pendingLoanOffer).toBeFalsy();
    expect(result.choicePending).toBe(false);
    expect(result.gameResult).toBe('playing');
    expect(state.gameResult).toBe('playing');
    expect(state.endReason ?? '').not.toBe('bankruptcy');
    expect(state.pendingLoanOffer).toBeNull();

    // Parent Q5 = A: the largest option (1000 / 10) is auto-accepted.
    expect(state.loans).toHaveLength(1);
    expect(state.loans[0]).toMatchObject({ ownerId: 0, principal: 1000, termTurns: 10 });
    // The principal is credited and the turn completes (quiet economy = 0 income).
    expect(state.resourceBank.coins).toBe(-250 + 1000);
    expect(state.turn).toBe(turnBefore + 1);
  });

  it('accepts a specific offered option while the closing is paused', () => {
    const state = quietMarketState('bailout-accept-specific');
    state.resourceBank.coins = -100;
    syncResourceBankToLedger(state);
    const paused = processEndOfTurn(state);
    expect(paused.pendingLoanOffer).toBe(true);

    const loan = acceptLoanOffer(state, 1); // 600 / 6

    expect(loan).toMatchObject({ ownerId: 0, principal: 600, termTurns: 6 });
    expect(state.pendingLoanOffer).toBeNull();
    expect(state.resourceBank.coins).toBe(-100 + 600);

    const closed = finishDeferredTurnClosing(state, paused);
    expect(closed.gameResult).toBe('playing');
    expect(closed.pendingLoanOffer).toBeFalsy();
    expect(state.pendingLoanOffer).toBeNull();
  });

  it('refuses to accept without a pending offer', () => {
    const state = quietMarketState('bailout-accept-none');
    expect(() => acceptLoanOffer(state, 0)).toThrow(/no pending loan offer/i);
  });
});

describe('declining a bailout offer', () => {
  it('clears the offer and converges to bankruptcy in one pass', () => {
    const state = quietMarketState('bailout-decline');
    state.resourceBank.coins = -50;
    syncResourceBankToLedger(state);
    const paused = processEndOfTurn(state);
    expect(paused.pendingLoanOffer).toBe(true);

    expect(declineLoanOffer(state)).toBe(true);
    expect(state.pendingLoanOffer).toBeNull();

    // The phase never advanced (pre-income pause), so re-running the closing
    // is the resume path; the guard prevents a second offer.
    const closed = processEndOfTurn(state);

    expect(closed.pendingLoanOffer).toBeFalsy();
    expect(closed.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
  });

  it('does not re-offer in the same turn after a decline (per-turn guard)', () => {
    const state = quietMarketState('bailout-no-loop');
    state.resourceBank.coins = -50;
    syncResourceBankToLedger(state);

    expect(maybeOfferBailout(state)).toBe(true);
    expect(maybeOfferBailout(state)).toBe(false); // an offer is already open
    expect(declineLoanOffer(state)).toBe(true);
    expect(maybeOfferBailout(state)).toBe(false); // per-turn guard
    expect(declineLoanOffer(state)).toBe(false); // nothing left to decline
  });
});

describe('AI bailout policy', () => {
  it('chooses the largest principal, then the longest term as tie-break', () => {
    expect(largestBailoutOption(DEFAULT_LOAN_OPTIONS)).toEqual({
      principal: 1000,
      termTurns: 10,
    });
    expect(
      largestBailoutOption([
        { principal: 600, termTurns: 3 },
        { principal: 600, termTurns: 6 },
        { principal: 300, termTurns: 10 },
      ]),
    ).toEqual({ principal: 600, termTurns: 6 });
  });

  it('resolves a pending offer deterministically on the headless path', () => {
    const first = quietMarketState('bailout-determinism');
    first.resourceBank.coins = -50;
    syncResourceBankToLedger(first);
    const second = quietMarketState('bailout-determinism');
    second.resourceBank.coins = -50;
    syncResourceBankToLedger(second);

    const a = endTurnHeadless(first);
    const b = endTurnHeadless(second);

    // No stalled decision survives, and both runs took the same option.
    expect(a.pendingLoanOffer ?? false).toBe(false);
    expect(b.pendingLoanOffer ?? false).toBe(false);
    expect(first.pendingLoanOffer).toBeNull();
    expect(second.pendingLoanOffer).toBeNull();
    expect(first.loans[0]).toMatchObject({
      principal: second.loans[0].principal,
      termTurns: second.loans[0].termTurns,
    });
    expect(a.gameResult).toBe(b.gameResult);
  });
});

describe('opening-day solvency grace', () => {
  it('does not raise a competitive turn-1 bailout (grace resolves the debt)', () => {
    const state = createCompetitiveState({ seed: 'bailout-grace', playerCount: 2 });
    executeWeekStart(state);
    state.activePlayerId = 0;
    // The seat's own wallet is authoritative at failure-evaluation time; the
    // shared bank is only its working mirror (MS-0MVPWSAMH005LV9R).
    state.players![0].coins = -50;
    state.resourceBank.coins = -50;
    expect(state.turn).toBe(1);

    expect(maybeOfferBailout(state)).toBe(false);
    expect(state.pendingLoanOffer).toBeNull();

    // From turn 2 the grace is gone, so a negative seat gets the offer.
    state.turn = 2;
    expect(maybeOfferBailout(state)).toBe(true);
    expect(state.pendingLoanOffer).toMatchObject({ ownerId: 0, reason: 'bankruptcy' });
  });
});
