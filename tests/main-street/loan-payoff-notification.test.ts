/**
 * Main Street: loan payoff notification — reporting, copy model and gating
 * (parent MS-0MW1ZJDVE000MUID, this slice MS-0MW3SMRRB007CRNZ).
 *
 * The unit half of parent AC 9, written test-first as the executable
 * specification for the engine slice (MS-0MW3SMTRO006M86W) and the model
 * slice (MS-0MW3SMVVP006ZD4V). It is Phaser-free (imports no Phaser symbol)
 * so it runs in the unit group.
 *
 * Agreed API shape pinned here (the siblings implement to this contract):
 *   - `applyLoanRepayments(state, { retiredOut })` — an optional out-channel
 *     collecting one entry per loan retired by its final scheduled payment;
 *     the numeric coin return stays exactly as the current implementation
 *     returns it. Each entry carries
 *     `ownerId`, `perTurnRepayment`, `totalRepayment` and `termTurns` (the
 *     shape the engine slice names `LoanPayoff` in `src/MainStreetLoans.ts`).
 *   - `TurnResult.loanPayoffs` — a new optional seat-tagged array populated
 *     by the single-player/shared closing and the competitive closing;
 *     empty/absent when nothing retired; never duplicated across a
 *     resumed/deferred closing; never persisted (parent AC 8).
 *   - `src/scenes/MainStreetLoanPayoffModel.ts` — a Phaser-free module
 *     exporting `shouldPresentLoanPayoff(ctx): boolean` (the gating
 *     predicate: replayMode off, human seat only, run still playing) and
 *     `buildLoanPayoffContent(payoff, ctx)` returning the dialog copy
 *     (headline, body lines, dismiss label) or `null` when not presentable.
 *
 * Red-by-design note (parent AC 9 test-first chain): this file is the repo's
 * **red-phase** convention (`it.fails`), exactly as
 * `tests/main-street/hud-total-counting.test.ts` and
 * `tests/main-street/panel-opacity.browser.test.ts` document. Against the
 * current tree the payoff-reporting cases fail because `TurnResult.loanPayoffs`
 * and the `retiredOut` channel do not exist yet, and the copy-model cases fail
 * because `MainStreetLoanPayoffModel` does not exist yet — the intended
 * missing-field / missing-model reasons (this slice AC 1), never a syntax error
 * in this file. The engine sibling (MS-0MW3SMTRO006M86W) and the model sibling
 * (MS-0MW3SMVVP006ZD4V) flip each `it.fails` to a plain `it` once their code
 * lands; leaving one as `it.fails` afterwards is itself a failure, so the pin
 * cannot go stale.
 *
 * Cases whose contract already holds on the current tree ("nothing retired",
 * loans-disabled / no-loan no-ops, and the `isHumanSeatCredit` seam) are plain
 * `it` so the unchanged behaviour keeps being protected through the red phase.
 *
 * @module tests/main-street/loan-payoff-notification
 */

import { describe, it, expect } from 'vitest';

import {
  createCompetitiveState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import { bindCompetitiveSeat } from '../../src/MainStreetAiStrategy';
import {
  applyEndOfTurnDeltas,
  endCompetitiveMarketTurn,
  executeCompetitiveWeekStart,
  executeWeekStart,
  finishDeferredTurnClosing,
  processEndOfTurn,
  resolveCompetitiveClosingPhases,
  takeLoan,
  type TurnResult,
} from '../../src/MainStreetEngine';
import { isHumanSeatCredit } from '../../src/MainStreetChallenges';
import { applyLoanRepayments } from '../../src/MainStreetLoans';
import type { ActiveLoan } from '../../src/MainStreetStateTypes';
import { syncResourceBankToLedger } from '../../src/MainStreetStateLog';

// ── Agreed API surface (forward references) ─────────────────

/**
 * The payoff entry shape the engine slice exports as `LoanPayoff`
 * (`src/MainStreetLoans.ts`). Declared locally so the pin does not depend on
 * the export existing yet; the sibling imports the engine's type.
 */
interface PayoffShape {
  /** Seat whose loan was retired by its final scheduled payment. */
  ownerId: number;
  /** Fixed per-turn repayment that stopped being deducted. */
  perTurnRepayment: number;
  /** Total repaid over the whole term. */
  totalRepayment: number;
  /** Term the loan was repaid over. */
  termTurns: number;
}

/** `TurnResult` with the new optional payoff field (engine slice AC 3). */
type TurnResultWithPayoffs = TurnResult & { loanPayoffs?: PayoffShape[] };

/** `applyLoanRepayments` options with the new out-channel (engine slice AC 1). */
type RepaymentOptionsWithOut = NonNullable<Parameters<typeof applyLoanRepayments>[1]> & {
  retiredOut?: PayoffShape[];
};

/**
 * The copy-model result (`LoanPayoffContent` in `src/scenes/MainStreetLoanPayoffModel.ts`):
 * headline, body lines and the single dismiss label.
 */
interface LoanPayoffContent {
  /** Debt-free congratulation (producer Q2 = B). */
  headline: string;
  /** Body lines: weekly amount no longer deducted, total repaid over term. */
  body: readonly string[];
  /** Label of the single dismiss action. */
  dismissLabel: string;
}

/**
 * The context object the model takes as a pure input (model slice AC 5):
 * the scene's `replayMode`, the payoff's own seat, the competitive seat
 * records (for `isHumanSeatCredit`) and the closing's `gameResult`.
 */
interface LoanPayoffContext {
  /** True for headless/replay runs: never present UI (parent AC 5). */
  replayMode?: boolean;
  /** The seat whose payoff this is (the entry's `ownerId`). */
  seatId?: number | null;
  /** Competitive seat records; single-player carries none. */
  players?: ReadonlyArray<{ playerId?: number; controller?: string }> | null;
  /** The closing's result: a congratulation never hides a loss/win. */
  gameResult?: 'playing' | 'win' | 'loss';
}

/** The model module surface the tests consume (imported dynamically). */
interface LoanPayoffModel {
  shouldPresentLoanPayoff(ctx: LoanPayoffContext): boolean;
  buildLoanPayoffContent(payoff: PayoffShape, ctx: LoanPayoffContext): LoanPayoffContent | null;
}

/** The agreed module path of the copy model (lands with the model slice). */
const LOAN_PAYOFF_MODEL_PATH = '../../src/scenes/MainStreetLoanPayoffModel';

/**
 * Resolves the copy model at runtime, so the module-load failure surfaces as
 * each case's own intended missing-model failure instead of a collection
 * error for the whole file.
 */
async function loadLoanPayoffModel(): Promise<LoanPayoffModel> {
  return (await import(LOAN_PAYOFF_MODEL_PATH)) as LoanPayoffModel;
}

// ── Fixtures ─────────────────────────────────────────────────

/** The per-turn repayment of every default option at the default 10% rate. */
const PER_TURN = 110;

/**
 * Fresh single-player game armed in MarketPhase with nothing that moves
 * coins: no placed cards, staff, challenges, active effects or incidents
 * (mirrors `MainStreetLoanBailout.test.ts`'s quiet fixture).
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

/** A 600/6 loan as the engine records it, with the given turns remaining. */
function existingLoan(ownerId: number, turnsRemaining: number): ActiveLoan {
  return {
    ownerId,
    principal: 600,
    totalRepayment: 660,
    perTurnRepayment: 110,
    turnsRemaining,
    termTurns: 6,
    takenOnTurn: 1,
  };
}

/**
 * Builds a competitive state for a closing test: loans enabled, per-seat
 * wallets applied, turn advanced past the opening-day grace, and every
 * coin-moving element stripped except loans (mirrors
 * `MainStreetLoanCompetitive.test.ts`).
 */
function buildCompetitiveClosingState(
  seed: string,
  wallets: Array<[coins: number, reputation: number]>,
): MainStreetState {
  const state = createCompetitiveState({
    seed,
    playerCount: wallets.length,
    loansEnabled: true,
  });
  wallets.forEach(([coins, reputation], playerId) => {
    state.players![playerId].coins = coins;
    state.players![playerId].reputation = reputation;
  });
  state.turn = 2;

  quietTurnEconomy(state);
  state.ownerTaggedGrid = state.ownerTaggedGrid!.map(() => ({ card: null, ownerId: null }));
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

/** The out-channel under test, emptied per case. */
function freshRetiredOut(): RepaymentOptionsWithOut['retiredOut'] {
  return [];
}

/**
 * Runs the repayment pass with the not-yet-widened out-channel option.
 *
 * Red phase only: `applyLoanRepayments`'s option type gains `retiredOut` with
 * the engine sibling (MS-0MW3SMTRO006M86W), at which point this helper's cast
 * becomes a plain call. Keeping the single cast here means the test bodies read
 * exactly like the shipping API.
 */
function repayWithRetiredOut(
  state: MainStreetState,
  opts: RepaymentOptionsWithOut,
): number {
  return applyLoanRepayments(state, opts as Parameters<typeof applyLoanRepayments>[1]);
}

// ── applyLoanRepayments: the retire-report out-channel (AC 2) ─

describe('applyLoanRepayments — retired-loan reporting (AC 2)', () => {
  // Red phase: the `retiredOut` out-channel lands with MS-0MW3SMTRO006M86W.
  it.fails('reports the retired loan with owner id, per-turn, total and term, and keeps the numeric return', () => {
    const state = quietMarketState('payoff-retire-report');
    takeLoan(state, 0); // 300 / 3 → 110 per turn, 330 total
    applyLoanRepayments(state);
    applyLoanRepayments(state); // two payments leave one turn
    const retiredOut = freshRetiredOut();
    const coinsBefore = state.resourceBank.coins;
    const logBefore = state.activityLog.length;

    const total = repayWithRetiredOut(state, { retiredOut });

    // Numeric coin total is exactly what the pass always returned.
    expect(total).toBe(-PER_TURN);
    expect(state.resourceBank.coins).toBe(coinsBefore - PER_TURN);
    expect(state.loans).toEqual([]);
    expect(state.activityLog).toHaveLength(logBefore + 1);
    // The out-channel names the retirement data — the same figures the HUD
    // loan line used before the debt disappeared.
    expect(retiredOut).toEqual([
      { ownerId: 0, perTurnRepayment: 110, totalRepayment: 330, termTurns: 3 },
    ]);
  });

  it('reports nothing while the loan is still being repaid', () => {
    const state = quietMarketState('payoff-no-retire');
    takeLoan(state, 1); // 600 / 6
    const retiredOut = freshRetiredOut();

    const total = repayWithRetiredOut(state, { retiredOut });

    expect(total).toBe(-PER_TURN);
    expect(state.loans[0].turnsRemaining).toBe(5);
    expect(retiredOut).toEqual([]);
  });

  it.fails('reports a retirement on the apply:false path but still leaves the wallet untouched', () => {
    const state = quietMarketState('payoff-deferred-out');
    takeLoan(state, 1);
    applyLoanRepayments(state);
    applyLoanRepayments(state);
    applyLoanRepayments(state);
    applyLoanRepayments(state);
    applyLoanRepayments(state); // five payments: one turn left
    const retiredOut = freshRetiredOut();
    const coinsBefore = state.resourceBank.coins;
    const loansBefore = state.loans.length;

    const total = repayWithRetiredOut(state, { apply: false, retiredOut });

    // The bookkeeping (term decrement, retirement) is committed…
    expect(total).toBe(-PER_TURN);
    expect(state.loans).toEqual([]);
    expect(state.loans.length).toBe(loansBefore - 1);
    expect(retiredOut).toEqual([
      { ownerId: 0, perTurnRepayment: 110, totalRepayment: 660, termTurns: 6 },
    ]);
    // …but the wallet debit is left to the caller (no wallet change here).
    expect(state.resourceBank.coins).toBe(coinsBefore);
  });

  it.fails('withholds an excluded owner and reports only the other seats retirements', () => {
    const state = quietMarketState('payoff-exclude-owner');
    // Two loans: seat 0 retiring this pass, seat 1 with one payment left.
    state.loans = [existingLoan(0, 1), existingLoan(1, 1)];
    const retiredOut = freshRetiredOut();

    const total = repayWithRetiredOut(state, {
      excludeOwnerIds: [0],
      retiredOut,
    });

    // Seat 0's loan is skipped entirely (no debit, no term decrement)…
    expect(total).toBe(-PER_TURN); // only seat 1 paid
    expect(state.loans).toEqual([existingLoan(0, 1)]);
    // …while seat 1's retirement is still reported.
    expect(retiredOut).toEqual([
      { ownerId: 1, perTurnRepayment: 110, totalRepayment: 660, termTurns: 6 },
    ]);
  });

  it('reports nothing for a loans-disabled call or a call with no loans', () => {
    const disabled = quietMarketState('payoff-loans-off');
    takeLoan(disabled, 0);
    disabled.config = { ...disabled.config, loansEnabled: false };
    const disabledOut = freshRetiredOut();

    expect(repayWithRetiredOut(disabled, { retiredOut: disabledOut })).toBe(0);
    expect(disabledOut).toEqual([]);
    expect(disabled.loans).toHaveLength(1); // untouched

    const none = quietMarketState('payoff-no-loans');
    const noneOut = freshRetiredOut();
    const noneLogBefore = none.activityLog.length;
    const noneCoinsBefore = none.resourceBank.coins;

    expect(repayWithRetiredOut(none, { retiredOut: noneOut })).toBe(0);
    expect(noneOut).toEqual([]);
    // No loans: no debit and no log row of any kind.
    expect(none.activityLog).toHaveLength(noneLogBefore);
    expect(none.resourceBank.coins).toBe(noneCoinsBefore);
  });
});

// ── TurnResult.loanPayoffs: closing population (AC 4) ────────

describe('TurnResult.loanPayoffs — closing population (AC 4)', () => {
  // Red phase: the `TurnResult.loanPayoffs` field lands with
  // MS-0MW3SMTRO006M86W (threaded through both closings).
  it.fails('reports the retired loan from the single-player closing', () => {
    const state = quietMarketState('payoff-single-close');
    takeLoan(state, 0); // 300 / 3
    state.loans[0].turnsRemaining = 1; // this closing's payment retires it
    armTurn(state);

    const result = processEndOfTurn(state);

    expect((result as TurnResultWithPayoffs).loanPayoffs).toEqual([
      { ownerId: 0, perTurnRepayment: 110, totalRepayment: 330, termTurns: 3 },
    ]);
    expect(state.loans).toEqual([]);
  });

  it('leaves the field empty/absent when nothing retired this closing', () => {
    const state = quietMarketState('payoff-nothing-retired');
    takeLoan(state, 1); // 600 / 6 mid-term
    state.loans[0].turnsRemaining = 4;
    armTurn(state);

    const result = processEndOfTurn(state);

    expect(((result as TurnResultWithPayoffs).loanPayoffs ?? [])).toEqual([]);
    expect((result as TurnResultWithPayoffs).loanPayoffs).toBeUndefined();

    const noLoan = quietMarketState('payoff-no-loan-close');
    armTurn(noLoan);
    const resultNoLoan = processEndOfTurn(noLoan);
    expect(((resultNoLoan as TurnResultWithPayoffs).loanPayoffs ?? [])).toEqual([]);
  });

  it.fails('never duplicates a payoff across the deferred closing resume', () => {
    const state = quietMarketState('payoff-deferred-close');
    takeLoan(state, 1); // 600 / 6
    state.loans[0].turnsRemaining = 1;
    rebaseDaySnapshot(state);
    armTurn(state);
    const before = state.resourceBank.coins;

    // Deferred path: the closing bookkeeping (retirement) commits now, the
    // wallet debit is applied by the scene before the tail resumes.
    const paused = processEndOfTurn(state, { deferResourceApplication: true });
    expect(((paused as TurnResultWithPayoffs).loanPayoffs ?? [])).toEqual([
      { ownerId: 0, perTurnRepayment: 110, totalRepayment: 660, termTurns: 6 },
    ]);
    expect(state.resourceBank.coins).toBe(before);

    applyEndOfTurnDeltas(state, paused);
    const closed: TurnResult = finishDeferredTurnClosing(state, paused);

    // Exactly one payoff across the whole deferred lifecycle — the resumed
    // closing never re-reports the loan it already retired.
    expect((closed as TurnResultWithPayoffs).loanPayoffs).toHaveLength(1);
    expect((closed as TurnResultWithPayoffs).loanPayoffs).toEqual(
      (paused as TurnResultWithPayoffs).loanPayoffs,
    );
  });

  it.fails('reports the seat-tagged payoff from the competitive closing', () => {
    const state = buildCompetitiveClosingState('payoff-competitive', [
      [500, 5],
      [500, 5],
    ]);
    driveToClosing(state);
    // Seat 1's loan is retired by this shared closing; seat 0 has none.
    state.loans = [existingLoan(1, 1)];

    const result = resolveCompetitiveClosingPhases(state);

    expect((result as TurnResultWithPayoffs).loanPayoffs).toEqual([
      { ownerId: 1, perTurnRepayment: 110, totalRepayment: 660, termTurns: 6 },
    ]);
    expect(state.players![1].coins).toBe(500 - PER_TURN);
    // Seat 0's wallet is untouched by seat 1's retirement.
    expect(state.players![0].coins).toBe(500);
  });

  it.fails('reports the payoff even when the same closing ends the run', () => {
    const state = quietMarketState('payoff-game-over');
    takeLoan(state, 1); // 110 per turn
    state.loans[0].turnsRemaining = 1;
    state.resourceBank.coins = 50; // the final instalment bankrupts the run
    syncResourceBankToLedger(state);
    state.weekStartCoins = 50;
    armTurn(state);

    const result = processEndOfTurn(state);

    // The structured data still tells presentation a loan was retired…
    expect((result as TurnResultWithPayoffs).loanPayoffs).toEqual([
      { ownerId: 0, perTurnRepayment: 110, totalRepayment: 660, termTurns: 6 },
    ]);
    // …and the run ended, so presentation must show game over instead of a
    // congratulation (parent AC 7 — pinned at the model gate below).
    expect(result.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
  });
});

// ── The copy model (AC 5) ────────────────────────────────────

describe('loan payoff copy model (AC 5)', () => {
  // Red phase: `src/scenes/MainStreetLoanPayoffModel.ts` lands with
  // MS-0MW3SMVVP006ZD4V.
  it.fails('produces the debt-free headline, the weekly amount no longer deducted and the total repaid over the term', async () => {
    const model = await loadLoanPayoffModel();

    const content = model.buildLoanPayoffContent(
      { ownerId: 0, perTurnRepayment: 110, totalRepayment: 660, termTurns: 6 },
      { seatId: 0, gameResult: 'playing' },
    );

    expect(content?.headline).toBe('You are debt free!');
    expect(content?.body).toEqual([
      '110 coins/week is no longer deducted.',
      '660 coins repaid over 6 weeks.',
    ]);
    expect(content?.dismissLabel).toBe('Continue');
  });

  it.fails('derives the copy from the payoff entry figures, not hard-coded amounts', async () => {
    const model = await loadLoanPayoffModel();

    const content = model.buildLoanPayoffContent(
      { ownerId: 0, perTurnRepayment: 110, totalRepayment: 330, termTurns: 3 },
      { seatId: 0, gameResult: 'playing' },
    );

    expect(content?.body).toEqual([
      '110 coins/week is no longer deducted.',
      '330 coins repaid over 3 weeks.',
    ]);
  });

  it.fails('returns no content when the payoff is not presentable', async () => {
    const model = await loadLoanPayoffModel();

    const suppressed = model.buildLoanPayoffContent(
      { ownerId: 0, perTurnRepayment: 110, totalRepayment: 660, termTurns: 6 },
      { replayMode: true, seatId: 0, gameResult: 'playing' },
    );

    expect(suppressed).toBeNull();
  });
});

// ── Seat / replay / game-over gating (AC 6) ──────────────────

describe('loan payoff gating (AC 6)', () => {
  // The engine seam the model gate consumes — pinned directly so the
  // human-seat rule stays executable even before the model lands.
  it('isHumanSeatCredit allows single-player and the competitive human seat, never an AI seat', () => {
    const state = buildCompetitiveClosingState('payoff-gate-seats', [
      [500, 5],
      [500, 5],
    ]);
    // Seat 0 is the default human, seat 1 is AI (controller-less fallback:
    // seat 0 = human).
    expect(isHumanSeatCredit(state, 0)).toBe(true);
    expect(isHumanSeatCredit(state, 1)).toBe(false);
    expect(isHumanSeatCredit(state, 99)).toBe(false);
    expect(isHumanSeatCredit(state, null)).toBe(false);

    const single = quietMarketState('payoff-gate-single');
    expect(isHumanSeatCredit(single, 0)).toBe(true);
    expect(isHumanSeatCredit(single, null)).toBe(true);
  });

  it.fails('suppresses in replayMode, suppresses AI seats, allows the human seat and suppresses a run-ended closing', async () => {
    const model = await loadLoanPayoffModel();

    // Headless/replay runs never present UI (parent AC 5).
    expect(model.shouldPresentLoanPayoff({ replayMode: true, seatId: 0, gameResult: 'playing' })).toBe(false);
    // Competitive: an AI seat's payoff changes nothing visible (parent AC 6).
    expect(
      model.shouldPresentLoanPayoff({
        seatId: 1,
        players: [{ playerId: 0, controller: 'human' }, { playerId: 1, controller: 'ai' }],
        gameResult: 'playing',
      }),
    ).toBe(false);
    // The human seat in competitive play is allowed.
    expect(
      model.shouldPresentLoanPayoff({
        seatId: 0,
        players: [{ playerId: 0, controller: 'human' }, { playerId: 1, controller: 'ai' }],
        gameResult: 'playing',
      }),
    ).toBe(true);
    // Single-player (no seat records) is the primary user — allowed.
    expect(model.shouldPresentLoanPayoff({ seatId: 0, gameResult: 'playing' })).toBe(true);
    // A closing that ended the run presents game over instead (parent AC 7).
    expect(model.shouldPresentLoanPayoff({ seatId: 0, gameResult: 'loss' })).toBe(false);
    expect(model.shouldPresentLoanPayoff({ seatId: 0, gameResult: 'win' })).toBe(false);
  });

  // Pins the same game-over precedence through the closing's own result, so
  // the data channel and the gate agree on the same turn (parent AC 7).
  it.fails('the closing data and the game-over gate agree on a run-ending retirement', () => {
    const gate = async () => {
      const model = await loadLoanPayoffModel();
      const result = await runEndingClosing();
      const payoffs = (result as TurnResultWithPayoffs).loanPayoffs ?? [];
      expect(payoffs).toHaveLength(1);
      expect(result.gameResult).toBe('loss');
      expect(
        model.shouldPresentLoanPayoff({ seatId: payoffs[0].ownerId, gameResult: result.gameResult }),
      ).toBe(false);
    };
    return gate();
  });
});

// ── Helper for the game-over agreement case ──────────────────

/** Runs one closing that retires a loan and ends the run; returns its result. */
async function runEndingClosing(): Promise<TurnResult> {
  const state = quietMarketState('payoff-gate-agree');
  takeLoan(state, 1);
  state.loans[0].turnsRemaining = 1;
  state.resourceBank.coins = 50;
  syncResourceBankToLedger(state);
  state.weekStartCoins = 50;
  armTurn(state);
  return processEndOfTurn(state);
}

/** Re-bases the day-start snapshots onto the current wallet. */
function rebaseDaySnapshot(state: MainStreetState): void {
  state.weekStartCoins = state.resourceBank.coins;
  state.weekStartRep = state.resourceBank.reputation;
  state.weekStartScore = state.finalScore;
}
