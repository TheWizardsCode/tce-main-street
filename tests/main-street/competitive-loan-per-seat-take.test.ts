/**
 * Main Street: a competitive Turn Summary take is booked to the **human seat**
 * and the panel survives a re-render of the same `TurnResult`
 * (MS-0MW4Z2R040096ZZV, parent MS-0MW4XQXY6005YG72).
 *
 * The sibling suites pin the descriptor matrix
 * (`competitive-loan-descriptor.test.ts`), the active-obligation flow
 * (`competitive-loan-active-obligation.test.ts`), the disabled states
 * (`competitive-loan-disabled-states.test.ts`) and persistence
 * (`competitive-loan-save-load.test.ts`). This suite covers the remaining
 * slice of parent AC4b — the **accepted take itself**:
 *
 *   AC4b — an accepted take from the competitive panel credits the human seat
 *          only, with exactly the principal, log row and ledger credit the
 *          single-player take produces, and it survives a re-render of the
 *          **same** `TurnResult` (the panel's `returnToSummary` rebuild);
 *   AC2  — the take is booked through `takeLoanCommand` with the seat
 *          forwarded explicitly (never the transient `activePlayerId`), is
 *          AP-neutral and is undoable through the command surface.
 *
 * The overlay half (button colours, selector wiring, the dialog hand-off) is
 * covered by `turn-summary-competitive.browser.test.ts`; this suite is the
 * Phaser-free model + command contract behind it, so a regression in either
 * half fails loudly without the other masking it.
 *
 * @module tests/main-street/competitive-loan-per-seat-take
 */

import { describe, expect, it } from 'vitest';

import {
  createCompetitiveState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import { executeWeekStart } from '../../src/MainStreetEngine';
import { takeLoanCommand } from '../../src/MainStreetCommands';
import { activeLoanFor, formatLoanObligation } from '../../src/MainStreetLoans';
import { startCompetitiveDay } from '../../src/scenes/MainStreetTurnControllerCompetitive';
import { buildCompetitiveTurnSummary } from '../../src/scenes/MainStreetTurnSummary';
import { buildTurnSummaryLoanDescriptor } from '../../src/scenes/MainStreetLoanSelectorModel';
import type { CompetitiveRoundLedger, TurnResult } from '../../src/MainStreetEngineTypes';
import { UndoRedoManager } from '@core-engine/UndoRedoManager';

// ── Fixtures ─────────────────────────────────────────────────

/** Human seat id in every fixture: seat 0 is the player-controlled seat. */
const HUMAN_SEAT_ID = 0;

/** The shared day the competitive fixtures sit at (mid-game: past the grace). */
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

/** A fresh single-player game in `MarketPhase` — the parity reference. */
function singlePlayerMarketState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state, true);
  state.turn = MID_GAME_TURN;
  return state;
}

/** A hand-built competitive round ledger: one quiet seat per player. */
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

/** The panel's input: the closed round's result carrying the ledger. */
function closingFor(ledger: CompetitiveRoundLedger): Pick<TurnResult, 'playerRoundLedger'> {
  return { playerRoundLedger: ledger };
}

/** Builds the competitive panel, failing loudly when the model is absent. */
function panelFor(
  state: MainStreetState,
  closing: Pick<TurnResult, 'playerRoundLedger'>,
) {
  const summary = buildCompetitiveTurnSummary(state, closing);
  expect(summary, 'the competitive panel must be buildable').not.toBeNull();
  return summary!;
}

/** Each seat's wallet, in seat order. */
function seatCoins(state: MainStreetState): number[] {
  return state.players!.map((seat) => seat.coins);
}

/** The activity log's most recent entry. */
function lastLog(state: MainStreetState) {
  const entry = state.activityLog[state.activityLog.length - 1];
  expect(entry, 'the take must write an activity-log row').toBeDefined();
  return entry;
}

// ── AC4b: the credit matches the single-player take exactly ──

describe('competitive take — credit parity with the single-player take (AC4b)', () => {
  it('books the same record and the same log row, and credits the same amount', () => {
    // The single-player reference: the very same menu row (600 principal,
    // 6 turns) taken through the same command surface.
    const single = singlePlayerMarketState('competitive-per-seat-parity');
    const singleCoinsBefore = single.resourceBank.coins;
    takeLoanCommand(single, 1).execute();
    const singleLoan = single.loans[0];
    const singleLog = lastLog(single);

    // The competitive take: the shared day's close can leave an AI seat acting,
    // so the panel forwards the human seat explicitly.
    const competitive = midGameState('competitive-per-seat-parity');
    competitive.activePlayerId = 1;
    const competitiveCoinsBefore = seatCoins(competitive);
    const ledgerCoinsBefore = competitive.ledger.get('coins');
    const bankCoinsBefore = competitive.resourceBank.coins;
    takeLoanCommand(competitive, 1, { allowDuringClosing: true }, HUMAN_SEAT_ID).execute();
    const competitiveLoan = activeLoanFor(competitive, HUMAN_SEAT_ID)!;
    const competitiveLog = lastLog(competitive);

    // The recorded loan is identical — principal, obligation, schedule, seat.
    expect(competitiveLoan).toEqual(singleLoan);
    expect(competitiveLoan.principal).toBe(600);

    // The wallet credit is the principal, to the coin, in both modes.
    expect(single.resourceBank.coins - singleCoinsBefore).toBe(singleLoan.principal);
    expect(seatCoins(competitive)).toEqual([
      competitiveCoinsBefore[0] + competitiveLoan.principal,
      competitiveCoinsBefore[1],
      competitiveCoinsBefore[2],
    ]);

    // The shared-wallet/ledger path moved by exactly the same amount: the
    // principal is credited through `EconomyLedger`, never by an ad-hoc
    // wallet mutation that would leave the two views disagreeing.
    expect(competitive.resourceBank.coins - bankCoinsBefore).toBe(
      competitive.ledger.get('coins') - ledgerCoinsBefore,
    );
    expect(competitive.ledger.get('coins') - ledgerCoinsBefore).toBe(
      competitiveLoan.principal,
    );

    // The log row is worded and classified exactly like single-player's; the
    // competitive row additionally carries the seat attribution the panel and
    // the feed need.
    expect(competitiveLog.text).toBe(singleLog.text);
    expect(competitiveLog.type).toBe('gain');
    expect(singleLog.seatId).toBeUndefined();
    expect(competitiveLog.seatId).toBe(HUMAN_SEAT_ID);
  });
});

// ── AC2/AC4b: the human seat only ───────────────────────────

describe('competitive take — booked to the human seat only (AC2)', () => {
  it('credits the forwarded seat, never the transient acting seat, and spends no action', () => {
    const state = midGameState('competitive-per-seat-human-only');
    // The shared day is mid-round on an AI seat: the panel's take must ignore it.
    state.activePlayerId = 1;
    const coinsBefore = seatCoins(state);
    const actionsBefore = state.actionsRemaining;
    const bankedBefore = state.bankedActions;

    takeLoanCommand(state, 1, { allowDuringClosing: true }, HUMAN_SEAT_ID).execute();

    // Exactly one loan, held by the human seat; the AI seats stay debt-free.
    expect(state.loans.map((loan) => loan.ownerId)).toEqual([HUMAN_SEAT_ID]);
    expect(activeLoanFor(state, 1)).toBeUndefined();
    expect(activeLoanFor(state, 2)).toBeUndefined();
    // Only the human seat's wallet is credited — the AI seats keep their coins.
    expect(seatCoins(state)).toEqual([
      coinsBefore[0] + 600,
      coinsBefore[1],
      coinsBefore[2],
    ]);
    // AP-neutral (parent constraint): the take never eats the seat's action, and
    // the shared day does not move on.
    expect(state.actionsRemaining).toBe(actionsBefore);
    expect(state.bankedActions).toBe(bankedBefore);
    expect(state.turn).toBe(MID_GAME_TURN);
  });
});

// ── AC4b: the re-render of the same TurnResult ──────────────

describe('competitive take — the panel re-renders from the same TurnResult (AC4b)', () => {
  it('shows the take as the human seat’s obligation with the same seats and no ghost rows', () => {
    const state = midGameState('competitive-per-seat-rerender');
    state.activePlayerId = 2;
    // The exact object the panel is handed (and re-rendered from after a take).
    const closing = closingFor(roundLedger(MID_GAME_TURN, [0, 1, 2]));

    const before = panelFor(state, closing);
    expect(before.humanSeatId).toBe(HUMAN_SEAT_ID);
    expect(before.loanDescriptor.enabled).toBe(true);
    const coinsBefore = seatCoins(state);

    takeLoanCommand(state, 1, { allowDuringClosing: true }, HUMAN_SEAT_ID).execute();

    // The panel's `returnToSummary` rebuild: same `TurnResult`, post-take state.
    const after = panelFor(state, closing);

    // The credited loan is now the human seat's own obligation, worded exactly
    // as the HUD readout (one source of truth: the single-player descriptor).
    expect(after.loanDescriptor.enabled).toBe(false);
    expect(after.loanDescriptor.reason).toBe('active-loan');
    expect(after.loanDescriptor.hint).toBe(
      formatLoanObligation(activeLoanFor(state, HUMAN_SEAT_ID)!),
    );
    expect(after.loanDescriptor).toEqual(
      buildTurnSummaryLoanDescriptor(state, HUMAN_SEAT_ID),
    );

    // The re-render keeps the panel's shape: same human seat, same seats in the
    // same order, nothing resurrected or duplicated.
    expect(after.humanSeatId).toBe(HUMAN_SEAT_ID);
    expect(after.rows.map((row) => row.ownerId)).toEqual(
      before.rows.map((row) => row.ownerId),
    );
    expect(after.rows.map((row) => row.label)).toEqual(
      before.rows.map((row) => row.label),
    );

    // Re-rendering the same result again is stable and read-only: the take is
    // booked once, no second/ghost loan or row appears and the credit is
    // neither lost nor re-applied by the re-render.
    expect(panelFor(state, closing)).toEqual(after);
    expect(state.loans).toHaveLength(1);
    expect(seatCoins(state)).toEqual([
      coinsBefore[0] + 600,
      coinsBefore[1],
      coinsBefore[2],
    ]);
  });
});

// ── AC2: undoable through the command surface ───────────────

describe('competitive take — undoable through the command surface (AC2)', () => {
  it('restores the wallet, the loan and the log, and re-enables the button', () => {
    const state = midGameState('competitive-per-seat-undo');
    state.activePlayerId = 1;
    const closing = closingFor(roundLedger(MID_GAME_TURN, [0, 1, 2]));
    const coinsBefore = seatCoins(state);
    const logLengthBefore = state.activityLog.length;
    const actionsBefore = state.actionsRemaining;

    // The dialog's confirm path: the take goes through the shared undo manager,
    // never a direct state mutation.
    const undoManager = new UndoRedoManager();
    undoManager.execute(
      takeLoanCommand(state, 0, { allowDuringClosing: true }, HUMAN_SEAT_ID),
    );
    expect(state.loans).toHaveLength(1);
    expect(undoManager.canUndo()).toBe(true);

    undoManager.undo();

    // The undo is complete: wallet, loan, log row and action budget all back.
    expect(seatCoins(state)).toEqual(coinsBefore);
    expect(state.loans).toEqual([]);
    expect(state.activityLog).toHaveLength(logLengthBefore);
    expect(state.actionsRemaining).toBe(actionsBefore);
    // … and the panel's button is borrowable again, so the undo restored the
    // seat rather than only the wallet.
    expect(panelFor(state, closing).loanDescriptor.enabled).toBe(true);
  });
});
