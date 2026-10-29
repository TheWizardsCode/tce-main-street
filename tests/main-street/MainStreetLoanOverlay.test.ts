/**
 * Main Street: Bailout loan offer overlay — model and deferred-closing flow
 * (MS-0MVPWSBLG006YMBA, parent MS-0MVL6DZI0000F6CG).
 *
 * AC coverage:
 *   AC1 — the overlay is rendered whenever a pending loan offer exists,
 *         listing each loan option with its per-turn and total repayment plus
 *         a Decline choice (model rows + the turn-flow presentation).
 *   AC2 — accepting or declining resumes the deferred closing exactly once,
 *         and the game-over summary is not shown while an offer is open.
 *   AC3 — the overlay is presented once per offer, the resume completes the
 *         closing exactly once, and no replay / duplicate-offer loop occurs.
 *
 * The Phaser rendering itself is covered in
 * `MainStreetLoanOverlay.browser.test.ts`; this suite exercises the
 * Phaser-free model and the turn-flow wiring against the real engine.
 *
 * Fixtures: a "quiet" single-player game in which nothing except the loan
 * moves coins (no street cards, staff, challenges, active effects or incident
 * cards), mirroring `MainStreetLoanBailout.test.ts`.
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest';

import {
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  processEndOfTurn,
  executeWeekStart,
  type TurnResult,
} from '../../src/MainStreetEngine';
import { DEFAULT_LOAN_OPTIONS } from '../../src/MainStreetLoans';
import { buildLoanOfferModel } from '../../src/scenes/MainStreetLoanOverlayModel';
import { hasOpenBailoutOffer } from '../../src/scenes/MainStreetGameOverSummary';
import {
  finishTurnPresentation,
  presentLoanOfferDialog,
} from '../../src/scenes/MainStreetTurnControllerTurnFlow';

// ── Fixtures ─────────────────────────────────────────────────

/** Fresh single-player game armed in MarketPhase with a coin-quiet economy. */
function quietMarketState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state, true);
  state.streetGrid = state.streetGrid.map(() => null);
  state.staffCards = [];
  state.hand = [];
  state.activeChallenges = [];
  state.activeEffects = [];
  state.incidentDeck = [];
  state.decks.event = [];
  state.discards.event = [];
  return state;
}

/** Raises a bailout offer through the real engine on a negative balance. */
function pausedOffer(seed: string): { state: MainStreetState; paused: TurnResult } {
  const state = quietMarketState(seed);
  state.resourceBank.coins = -50;
  const paused = processEndOfTurn(state, { deferResourceApplication: true });
  expect(paused.pendingLoanOffer).toBe(true);
  expect(state.pendingLoanOffer).not.toBeNull();
  return { state, paused };
}

/**
 * Minimal scene + turn-controller surface for `finishTurnPresentation` (the
 * same shape as `turn-summary-gate.test.ts`), extended with the loan dialog
 * capture. The real engine state is supplied by the caller.
 */
function makeHarness(state: MainStreetState) {
  const dialog = {
    shown: 0,
    model: null as ReturnType<typeof buildLoanOfferModel>,
    onAccept: null as ((index: number) => void) | null,
    onDecline: null as (() => void) | null,
  };

  const scene: any = {
    state,
    replayMode: false,
    settingsPanel: { reducedMotion: false },
    tutorialController: { isActive: false },
    incomeCollectionActive: false,
    endOfTurnDeltasApplied: false,
    previousCoins: null,
    previousReputation: null,
    displayedCoins: null,
    displayedReputation: null,
    displayedIncomeCounted: false,
    incidentRevealActive: false,
    logDeferredUntilPhaseComplete: false,
    refreshAll: vi.fn(),
    refreshLog: vi.fn(),
    msRenderer: { refreshAllExceptStreet: vi.fn() },
    msLifecycleManager: { onTutorialActionComplete: vi.fn() },
    tutorialOverlay: { showBankingHint: vi.fn() },
    // Complete the closing presentation synchronously so the deferred tail
    // runs in the same call (mirrors a real animator completion).
    msAnimator: {
      animateIncidentReveal: vi.fn((opts: { onComplete?: () => void }) => {
        opts?.onComplete?.();
      }),
    },
    time: {
      now: 0,
      delayedCall: vi.fn((_ms: number, cb: () => void) => {
        cb();
        return {};
      }),
    },
    // The Turn Summary gate runs before the deferred tail; continue at once.
    showTurnSummaryDialog: vi.fn((_summary: unknown, onNextTurn: () => void) => {
      onNextTurn();
    }),
    showLoanOfferDialog: vi.fn(
      (
        model: ReturnType<typeof buildLoanOfferModel>,
        onAccept: (index: number) => void,
        onDecline: () => void,
      ) => {
        dialog.shown += 1;
        dialog.model = model;
        dialog.onAccept = onAccept;
        dialog.onDecline = onDecline;
      },
    ),
  };

  const tcCtx: any = {
    scene,
    startTurnPhase: vi.fn(),
    handleGameOver: vi.fn(),
    presentEventChoiceDialog: vi.fn(),
    onSaveCheckpoint: vi.fn(),
  };
  // The pre-income resume path re-enters the presentation for the resumed
  // closing; wire it to the real implementation (the paused-offer branch is
  // not re-entered because the offer is resolved).
  tcCtx.finishTurnPresentation = (result: TurnResult, hint: boolean) =>
    finishTurnPresentation(tcCtx, result, hint);

  return { scene, tcCtx, dialog };
}

// ── Model ────────────────────────────────────────────────────

describe('buildLoanOfferModel', () => {
  it('turns the pending offer into one row per option with per-turn and total repayment', () => {
    const state = quietMarketState('loan-overlay-model');
    state.pendingLoanOffer = {
      ownerId: 0,
      reason: 'bankruptcy',
      options: DEFAULT_LOAN_OPTIONS.map((option) => ({ ...option })),
    };

    const model = buildLoanOfferModel(state);

    expect(model).not.toBeNull();
    expect(model!.ownerId).toBe(0);
    expect(model!.reason).toBe('bankruptcy');
    expect(model!.title).toBe('Bank Loan Offer');
    expect(model!.declineLabel).toContain('Decline');
    // Default 10% flat interest: 300/3 → 330 total → 110/turn, etc.
    expect(model!.rows).toEqual([
      {
        index: 0,
        principal: 300,
        termTurns: 3,
        totalRepayment: 330,
        perTurnRepayment: 110,
        label: '[ Borrow €300 — €110/turn, €330 total over 3 turns ]',
      },
      {
        index: 1,
        principal: 600,
        termTurns: 6,
        totalRepayment: 660,
        perTurnRepayment: 110,
        label: '[ Borrow €600 — €110/turn, €660 total over 6 turns ]',
      },
      {
        index: 2,
        principal: 1000,
        termTurns: 10,
        totalRepayment: 1100,
        perTurnRepayment: 110,
        label: '[ Borrow €1000 — €110/turn, €1100 total over 10 turns ]',
      },
    ]);
  });

  it('reads the configured menu and interest rate the offer was raised with', () => {
    const state = quietMarketState('loan-overlay-model-custom');
    state.config = {
      ...state.config,
      loanInterestRate: 0.2,
      loanOptions: [{ principal: 100, termTurns: 2 }],
    };
    state.pendingLoanOffer = {
      ownerId: 1,
      reason: 'bankruptcy',
      options: [{ principal: 100, termTurns: 2 }],
    };

    const model = buildLoanOfferModel(state);

    expect(model!.ownerId).toBe(1);
    expect(model!.rows).toHaveLength(1);
    // 20% flat: 100 → 120 total → 60/turn over 2 turns.
    expect(model!.rows[0]).toMatchObject({
      principal: 100,
      termTurns: 2,
      totalRepayment: 120,
      perTurnRepayment: 60,
    });
    expect(model!.rows[0].label).toContain('€120 total over 2 turns');
  });

  it('recommends the deterministic default (largest principal) for the headless fallback', () => {
    const state = quietMarketState('loan-overlay-model-recommended');
    state.pendingLoanOffer = {
      ownerId: 0,
      reason: 'bankruptcy',
      options: DEFAULT_LOAN_OPTIONS.map((option) => ({ ...option })),
    };

    const model = buildLoanOfferModel(state);

    expect(model!.recommendedIndex).toBe(2); // 1000 / 10
    expect(model!.rows[model!.recommendedIndex].principal).toBe(1000);
  });

  it('returns null when no offer is pending', () => {
    const state = quietMarketState('loan-overlay-model-none');
    expect(buildLoanOfferModel(state)).toBeNull();
  });
});

describe('hasOpenBailoutOffer', () => {
  it('is true exactly while an unresolved offer is open', () => {
    const state = quietMarketState('loan-overlay-predicate');
    expect(hasOpenBailoutOffer(state)).toBe(false);

    state.pendingLoanOffer = {
      ownerId: 0,
      reason: 'bankruptcy',
      options: DEFAULT_LOAN_OPTIONS.map((option) => ({ ...option })),
    };
    expect(hasOpenBailoutOffer(state)).toBe(true);
  });
});

// ── Turn-flow presentation and resume ────────────────────────

describe('bailout overlay in the deferred closing (turn flow)', () => {
  it('presents the dialog instead of the game-over summary while the offer is open', () => {
    const { state, paused } = pausedOffer('loan-overlay-present');
    const { tcCtx, dialog } = makeHarness(state);

    finishTurnPresentation(tcCtx, paused, false);

    // AC1: the dialog is presented once, with every option and a Decline.
    expect(dialog.shown).toBe(1);
    expect(state.pendingLoanOffer).not.toBeNull();
    expect(dialog.model!.rows).toHaveLength(DEFAULT_LOAN_OPTIONS.length);

    // AC2: the run is not declared over — no game-over summary, no next day.
    expect(tcCtx.handleGameOver).not.toHaveBeenCalled();
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();
    expect(state.endReason ?? '').not.toBe('bankruptcy');
  });

  it('is presented once per offer even when a resumed closing re-enters the flow', () => {
    const { state, paused } = pausedOffer('loan-overlay-once');
    const { tcCtx, dialog } = makeHarness(state);

    expect(presentLoanOfferDialog(tcCtx, paused)).toBe(true);
    // A second (re-entrant) presentation call is a no-op for the same offer.
    expect(presentLoanOfferDialog(tcCtx, paused)).toBe(true);
    expect(dialog.shown).toBe(1);
  });

  it('accepting resumes the closing exactly once and advances the turn', () => {
    const { state, paused } = pausedOffer('loan-overlay-accept');
    const { tcCtx, dialog } = makeHarness(state);
    const turnBefore = state.turn;

    finishTurnPresentation(tcCtx, paused, false);
    const onAccept = dialog.onAccept!;

    onAccept(2); // borrow €1000 over 10 turns

    // The loan is recorded and the offer cleared.
    expect(state.pendingLoanOffer).toBeNull();
    expect(state.loans).toHaveLength(1);
    expect(state.loans[0]).toMatchObject({ ownerId: 0, principal: 1000, termTurns: 10 });
    expect(state.resourceBank.coins).toBe(-50 + 1000);

    // The deferred closing completed exactly once: the turn advanced, the
    // checkpoint persisted and the dialog was not re-presented.
    expect(state.turn).toBe(turnBefore + 1);
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
    expect(tcCtx.onSaveCheckpoint).toHaveBeenCalledTimes(1);
    expect(tcCtx.handleGameOver).not.toHaveBeenCalled();
    expect(dialog.shown).toBe(1);

    // AC3: a duplicate press (double click) cannot replay the closing tail.
    onAccept(2);
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
    expect(tcCtx.onSaveCheckpoint).toHaveBeenCalledTimes(1);
    expect(state.loans).toHaveLength(1);
  });

  it('declining ends the run once and presents the bankruptcy summary', () => {
    const { state, paused } = pausedOffer('loan-overlay-decline');
    const { tcCtx, dialog } = makeHarness(state);

    finishTurnPresentation(tcCtx, paused, false);
    const onDecline = dialog.onDecline!;

    onDecline();

    // AC2: the decline preserves the bankruptcy and the normal summary is
    // presented (the offer is no longer open, so it is not suppressed).
    expect(state.pendingLoanOffer).toBeNull();
    expect(state.gameResult).toBe('loss');
    expect(state.endReason).toBe('bankruptcy');
    expect(tcCtx.handleGameOver).toHaveBeenCalledTimes(1);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();
    expect(dialog.shown).toBe(1);

    // AC3: no duplicate-offer loop — a second decline resolves nothing.
    onDecline();
    expect(tcCtx.handleGameOver).toHaveBeenCalledTimes(1);
    expect(state.pendingLoanOffer).toBeNull();
  });

  it('resumes a post-closing pause (offer raised after the economy) exactly once', () => {
    const state = quietMarketState('loan-overlay-post-closing');
    // The closing's economy resolves to a negative balance only after the
    // deferred deltas land (simulated: a cost outside the ledger's net).
    const deferred = processEndOfTurn(state, { deferResourceApplication: true });
    expect(deferred.requiresDeferredClosing).toBe(true);
    expect(deferred.pendingLoanOffer).toBeFalsy();
    state.resourceBank.coins = -50;

    const { tcCtx, dialog } = makeHarness(state);
    const turnBefore = state.turn;

    finishTurnPresentation(tcCtx, deferred, false);

    // The offer was raised inside `finishDeferredTurnClosing`, after the
    // summary gate and the closing presentation.
    expect(dialog.shown).toBe(1);
    expect(state.pendingLoanOffer).not.toBeNull();
    expect(tcCtx.handleGameOver).not.toHaveBeenCalled();
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();

    dialog.onAccept!(1); // borrow €600 over 6 turns

    expect(state.pendingLoanOffer).toBeNull();
    expect(state.loans).toHaveLength(1);
    expect(state.resourceBank.coins).toBe(-50 + 600);
    expect(state.turn).toBe(turnBefore + 1);
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
    expect(tcCtx.onSaveCheckpoint).toHaveBeenCalledTimes(1);
    expect(dialog.shown).toBe(1);
  });
});
