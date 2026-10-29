/**
 * Main Street: Bank Loans — competitive seat bailout parity
 * (Bank Loans epic MS-0MVL6DZI0000F6CG, child MS-0MVPWSAMH005LV9R).
 *
 * AC coverage:
 *   AC1 — a competitive seat at `coins < 0` holding no active loan is **not**
 *         eliminated / does not end the run: a loan offer is raised instead,
 *         accepting credits the principal to that seat's own wallet and play
 *         continues (apply → resume → next week).
 *   AC2 — a seat that already holds an active loan is eliminated exactly as
 *         today, and declining the offer preserves today's bankruptcy
 *         behaviour for a human seat.
 *   AC3 — the bailout runs **before** the elimination and last-standing
 *         checks (an AI bailout keeps the game playing and no last-standing
 *         win is declared), and the offer is attributed to the failing seat
 *         (`ownerId`), not the acting seat.
 *
 * Fixtures keep the economy quiet (no street cards, staff, challenges,
 * effects or incident cards) so the only coin movement in a turn is the loan.
 *
 * @module tests/main-street/MainStreetLoanCompetitive
 */

import { describe, it, expect } from 'vitest';

import { createCompetitiveState, type MainStreetState } from '../../src/MainStreetState';
import { bindCompetitiveSeat } from '../../src/MainStreetAiStrategy';
import {
  checkCompetitiveEndConditions,
  declineLoanOffer,
  endCompetitiveMarketTurn,
  executeCompetitiveWeekStart,
  maybeOfferBailoutForSeat,
  resolveCompetitiveClosingPhases,
  resolveCompetitiveLoanOffer,
  resolveCompetitiveSeatFailures,
} from '../../src/MainStreetEngine';
import { activeLoanFor } from '../../src/MainStreetLoans';
import type { ActiveLoan } from '../../src/MainStreetStateTypes';

// ── Fixtures ─────────────────────────────────────────────────

type Wallet = [coins: number, reputation: number];

/**
 * Builds a competitive state for a closing test: loans enabled (the preset
 * default), per-seat wallets applied, turn advanced past the opening-day
 * grace, and every coin-moving element stripped except loans.
 */
function buildClosingState(
  seed: string,
  wallets: Wallet[],
  opts?: { loansEnabled?: boolean; turn?: number },
): MainStreetState {
  const state = createCompetitiveState({
    seed,
    playerCount: wallets.length,
    loansEnabled: opts?.loansEnabled ?? true,
  });
  wallets.forEach(([coins, reputation], playerId) => {
    state.players![playerId].coins = coins;
    state.players![playerId].reputation = reputation;
  });
  state.turn = opts?.turn ?? 2;

  // Quiet economy: nothing except loans may move coins in the closing.
  state.streetGrid = state.streetGrid.map(() => null);
  state.ownerTaggedGrid = state.ownerTaggedGrid!.map(() => ({ card: null, ownerId: null }));
  state.staffCards = [];
  state.hand = [];
  state.activeChallenges = [];
  state.activeEffects = [];
  state.incidentDeck = [];
  state.decks.event = [];
  state.discards.event = [];

  return state;
}

/**
 * Drives the shared day from WeekStart to InvestmentResolution so the shared
 * closing can run, leaving the last-acting seat mirrored into the shared
 * `resourceBank` (as the real flow's `restoreCompetitiveSeat` does).
 */
function driveToClosing(state: MainStreetState): void {
  executeCompetitiveWeekStart(state);
  const n = state.players!.length;
  for (let i = 0; i < n; i++) {
    endCompetitiveMarketTurn(state);
  }
  bindCompetitiveSeat(state, n - 1);
}

/** An already-active loan owned by `ownerId` (the Q6 = A ineligible seat). */
function existingLoan(ownerId: number): ActiveLoan {
  return {
    ownerId,
    principal: 600,
    totalRepayment: 660,
    perTurnRepayment: 110,
    turnsRemaining: 6,
    termTurns: 6,
    takenOnTurn: 1,
  };
}

// ── AC1/AC3: AI bailout before elimination / last standing ───

describe('AC1/AC3 — a failing AI seat is bailed out instead of eliminated', () => {
  it('accepts the largest option, credits the seat and keeps the game playing', () => {
    const state = buildClosingState('comp-ai-bail', [[100, 5], [-50, 3]]);

    const ended = resolveCompetitiveSeatFailures(state);

    expect(ended).toBe(false);
    expect(state.gameResult).toBe('playing');
    expect(state.endReason).toBeNull();
    expect(state.players![1].eliminated ?? false).toBe(false);
    expect(state.pendingLoanOffer ?? null).toBeNull();

    const loan = activeLoanFor(state, 1);
    expect(loan).toBeDefined();
    expect(loan!.principal).toBe(1000); // largest default option (Q5 = A)
    expect(state.players![1].coins).toBe(-50 + 1000);
    expect(state.players![0].coins).toBe(100); // other seats untouched
  });

  it('runs before the last-standing check: no win is declared for the surviving human', () => {
    const state = buildClosingState('comp-ai-last-standing', [[100, 5], [-50, 3]]);

    const ended = checkCompetitiveEndConditions(state);

    expect(ended).toBe(false);
    expect(state.gameResult).toBe('playing');
    expect(state.endReason).toBeNull();
    expect(state.competitiveWinnerId ?? null).toBeNull();
    expect(state.players![1].eliminated ?? false).toBe(false);
  });

  it('does not bail out on the opening day (solvency grace wins)', () => {
    const state = buildClosingState('comp-ai-turn1', [[100, 5], [-50, 3]], { turn: 1 });

    resolveCompetitiveSeatFailures(state);

    expect(state.pendingLoanOffer ?? null).toBeNull();
    expect(activeLoanFor(state, 1)).toBeUndefined();
    expect(state.players![1].coins).toBe(0); // grace wrote the debt off
    expect(state.players![1].eliminated ?? false).toBe(false);
  });
});

// ── AC2: ineligible seats keep today's behaviour ─────────────

describe('AC2 — ineligible seats keep today’s failure behaviour', () => {
  it('eliminates an AI seat that already holds an active loan', () => {
    // 1 human + 2 AI: eliminating one AI leaves another alive, so the
    // elimination is observable without a last-standing win ending the run.
    const state = buildClosingState('comp-ai-loan', [[100, 5], [-50, 3], [100, 3]]);
    state.loans = [existingLoan(1)];

    const ended = resolveCompetitiveSeatFailures(state);

    expect(ended).toBe(false);
    expect(state.gameResult).toBe('playing');
    expect(state.pendingLoanOffer ?? null).toBeNull();
    expect(state.players![1].eliminated).toBe(true);
    expect(state.players![0].eliminated ?? false).toBe(false);
    expect(state.players![2].eliminated ?? false).toBe(false);
  });

  it('eliminates an AI seat when loans are disabled', () => {
    const state = buildClosingState('comp-ai-loans-off', [[100, 5], [-50, 3]], {
      loansEnabled: false,
    });

    resolveCompetitiveSeatFailures(state);

    expect(state.pendingLoanOffer ?? null).toBeNull();
    expect(state.players![1].eliminated).toBe(true);
  });

  it('ends the run when a human seat is bankrupt and holds an active loan', () => {
    const state = buildClosingState('comp-human-loan', [[-50, 5], [100, 5]]);
    state.loans = [existingLoan(0)];

    const ended = resolveCompetitiveSeatFailures(state);

    expect(ended).toBe(true);
    expect(state.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
    expect(state.pendingLoanOffer ?? null).toBeNull();
  });
});

// ── AC1/AC3: human seat offer pauses the closing ─────────────

describe('AC1/AC3 — human seat offer pauses the competitive closing', () => {
  it('pauses with the offer attributed to the failing seat, not the acting seat', () => {
    const state = buildClosingState('comp-human-pause', [[-50, 5], [100, 5]]);
    driveToClosing(state);
    // The last actor (AI seat 1) is mirrored into the shared bank.
    expect(state.activePlayerId).toBe(1);

    const paused = resolveCompetitiveClosingPhases(state);

    expect(paused.pendingLoanOffer).toBe(true);
    expect(state.pendingLoanOffer).not.toBeNull();
    expect(state.pendingLoanOffer!.ownerId).toBe(0); // the failing human
    expect(state.pendingLoanOffer!.reason).toBe('bankruptcy');
    expect(state.gameResult).toBe('playing');
    expect(state.endReason).toBeNull();
    expect(state.players![0].eliminated ?? false).toBe(false);
    expect(state.phase).toBe('InvestmentResolution'); // pre-income pause
  });

  it('accepting credits the non-active seat wallet, leaves the mirror alone and continues play', () => {
    const state = buildClosingState('comp-human-accept', [[-50, 5], [100, 5]]);
    driveToClosing(state);
    const paused = resolveCompetitiveClosingPhases(state);
    const mirroredBank = state.resourceBank.coins;

    const resumed = resolveCompetitiveLoanOffer(state, paused, 2); // 1000 / 10 turns

    expect(resumed.pendingLoanOffer).toBeFalsy();
    expect(state.pendingLoanOffer).toBeNull();
    expect(state.gameResult).toBe('playing');
    expect(activeLoanFor(state, 0)!.principal).toBe(1000);
    // Credit lands on the failing seat's own wallet; the first instalment
    // belongs to next turn (mirrors the single-player resume).
    expect(state.players![0].coins).toBe(-50 + 1000);
    expect(state.players![1].coins).toBe(100);
    expect(state.resourceBank.coins).toBe(mirroredBank); // other seat's mirror untouched
    // Play continued into the next shared day.
    expect(state.turn).toBe(3);
    expect(state.phase).toBe('WeekStart');
  });

  it('declining preserves today’s bankruptcy behaviour for the human seat', () => {
    const state = buildClosingState('comp-human-decline', [[-50, 5], [100, 5]]);
    driveToClosing(state);
    const paused = resolveCompetitiveClosingPhases(state);

    const resumed = resolveCompetitiveLoanOffer(state, paused, null);

    expect(resumed.pendingLoanOffer).toBeFalsy();
    expect(state.pendingLoanOffer).toBeNull();
    expect(state.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
    expect(state.loans ?? []).toEqual([]);
  });
});

// ── AC2: one offer per seat per turn ─────────────────────────

describe('AC2 — at most one offer per seat per turn', () => {
  it('does not re-offer the same seat in the same turn after a decline', () => {
    const state = buildClosingState('comp-one-offer', [[-50, 5], [100, 5]]);
    state.phase = 'MarketPhase';

    expect(maybeOfferBailoutForSeat(state, 0)).toBe(true);
    declineLoanOffer(state);
    expect(maybeOfferBailoutForSeat(state, 0)).toBe(false);
    expect(state.pendingLoanOffer).toBeNull();
  });

  it('converges to the bankruptcy loss on the resume instead of looping', () => {
    const state = buildClosingState('comp-no-loop', [[-50, 5], [100, 5]]);
    driveToClosing(state);

    const paused = resolveCompetitiveClosingPhases(state);
    expect(paused.pendingLoanOffer).toBe(true);

    // The resumed closing declares the loss once, with no second offer.
    resolveCompetitiveLoanOffer(state, paused, null);
    const ended = resolveCompetitiveSeatFailures(state);

    expect(ended).toBe(true);
    expect(state.pendingLoanOffer).toBeNull();
    expect(state.endReason).toBe('bankruptcy');
  });
});
