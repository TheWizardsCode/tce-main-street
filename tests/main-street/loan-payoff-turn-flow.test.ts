/**
 * Main Street: loan payoff dialog in the turn flow (MS-0MW3SN58E009HC84)
 *
 * The turn-flow half of parent AC 9 (parent `Notify when loan is paid off`,
 * MS-0MW1ZJDVE000MUID). The engine, the copy model and the overlay are pinned
 * by their own slices; this file pins **where the dialog sits in the closing
 * sequence** and **how the flow resumes**, through the real turn-flow code
 * (`finishTurnPresentation` for single-player, `presentCompetitiveDayTail` for
 * competitive play):
 *
 *   AC1 one congratulation per retired loan — never one per turn, never
 *       duplicated when a closing is paused and resumed;
 *   AC2 presented after the closing animations and ahead of the End of Turn
 *       summary (or of the next-week flow where that gate is skipped), and
 *       dismissing it continues into exactly that flow;
 *   AC3 suppressed in `replayMode` and for a non-human seat (through
 *       `isHumanSeatCredit`), presented for the human seat in competitive play;
 *   AC4 a closing that ends the run presents the game-over overlay instead;
 *   AC5 no more than one modal is ever active — the summary is only presented
 *       once the congratulation has been dismissed.
 *
 * The engine is mocked exactly like the sibling `turn-summary-gate.test.ts`
 * (real engine spread in, only the closing primitives replaced), so the
 * turn-flow timing can be exercised with a minimal scene surface while the
 * dialog gate and its continuation stay the real implementations.
 *
 * @module tests/main-street/loan-payoff-turn-flow
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/MainStreetEngine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/MainStreetEngine')>();
  return {
    ...actual,
    applyEndOfTurnDeltas: vi.fn(),
    acceptLoanOffer: vi.fn(),
    declineLoanOffer: vi.fn(),
    // Faithful stand-in: the deferred closing keeps the reported payoffs and
    // converges to a continuing run (the game-over cases below use the
    // non-deferred path, where the result is already final).
    finishDeferredTurnClosing: vi.fn((_state: unknown, result: unknown) => ({
      ...(result as Record<string, unknown>),
      gameResult: 'playing',
      finalScore: 0,
      newlyCompletedChallenges: [],
      choicePending: false,
    })),
    finishDeferredEndOfTurn: vi.fn(),
    processEndOfTurn: vi.fn(),
  };
});

vi.mock('../../src/MainStreetEngineCompetitiveTurn', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/MainStreetEngineCompetitiveTurn')>();
  return {
    ...actual,
    resolveCompetitiveLoanOffer: vi.fn(),
  };
});

// The event-choice resume resolves through the snapshot command; the engine
// closing it feeds is mocked above, so the command only needs to be a no-op
// that the scene's (absent) undo manager executes.
vi.mock('../../src/MainStreetCommands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/MainStreetCommands')>();
  return {
    ...actual,
    resolveEventChoiceCommand: vi.fn(() => ({ execute: vi.fn(), description: 'test' })),
  };
});

import {
  finishDeferredEndOfTurn,
  finishDeferredTurnClosing,
} from '../../src/MainStreetEngine';
import { resolveCompetitiveLoanOffer } from '../../src/MainStreetEngineCompetitiveTurn';
import {
  finishTurnPresentation,
  onEventChoice,
  onLoanOfferChoice,
} from '../../src/scenes/MainStreetTurnControllerTurnFlow';
import { presentCompetitiveDayTail } from '../../src/scenes/MainStreetTurnControllerCompetitive';
import type { TurnResult } from '../../src/MainStreetEngine';
import type { LoanPayoff } from '../../src/MainStreetLoans';
import type { TurnLedger } from '../../src/MainStreetEngineTypes';

// ── Fixtures ────────────────────────────────────────────────

/** One retired loan, as the closing reports it on `TurnResult.loanPayoffs`. */
const PAYOFF: LoanPayoff = Object.freeze({
  ownerId: 0,
  perTurnRepayment: 110,
  totalRepayment: 660,
  termTurns: 6,
});

/** A later, separate payoff — a new loan taken and repaid again. */
const LATER_PAYOFF: LoanPayoff = Object.freeze({
  ownerId: 0,
  perTurnRepayment: 55,
  totalRepayment: 165,
  termTurns: 3,
});

/** The AI seat's payoff in the competitive fixtures. */
const AI_PAYOFF: LoanPayoff = Object.freeze({
  ownerId: 1,
  perTurnRepayment: 110,
  totalRepayment: 660,
  termTurns: 6,
});

/**
 * An internally consistent ledger: income (+140) + expenses (−80) +
 * incident (−40) + one-off (−30) balances the net coin change (−10).
 * Needed because the End of Turn summary gate only presents with a ledger.
 */
function makeLedger(): TurnLedger {
  return {
    incomeByPhase: { base: 120, synergy: 30, reputation: 10, events: -20 },
    ongoingCosts: { staff: -50, community: -20, business: -10 },
    incidentCoinChange: -40,
    incidentRepChange: -2,
    oneOffDeltas: { coins: -30, reputation: 4 },
    netCoinChange: -10,
    netRepChange: 2,
    netScoreChange: 14,
    businessesOwned: { '0': 3 },
  };
}

function makeResult(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    income: { total: 5 } as TurnResult['income'],
    incident: { id: 'inc', name: 'Test Incident' } as TurnResult['incident'],
    incidentCoinChange: -40,
    incidentRepChange: -2,
    gameResult: 'playing',
    finalScore: 0,
    newlyCompletedChallenges: [],
    choicePending: false,
    // Only the deferred single-player result carries the ledger and the
    // deferred-closing marker (the summary gate's subject).
    requiresDeferredClosing: true,
    turnLedger: makeLedger(),
    ...overrides,
  } as TurnResult;
}

/** One dialog the scene was asked to draw, with its continuation. */
interface DialogRecord {
  payoff: LoanPayoff;
  dismiss: () => void;
}

/** A scene whose every presentation call is recorded in `order`. */
function makeSinglePlayerHarness(sceneOverrides: Record<string, unknown> = {}) {
  const dialogs: DialogRecord[] = [];
  const order: string[] = [];

  const scene: any = {
    state: {
      turn: 7,
      players: [] as unknown[],
      gameResult: 'playing',
      resourceBank: { coins: 990, reputation: 12 },
      finalScore: 34,
      weekStartCoins: 1000,
      weekStartRep: 10,
      weekStartScore: 20,
      activePlayerId: 0,
      loans: [] as unknown[],
      config: {
        loansEnabled: true,
        loanOptions: [
          { principal: 300, termTurns: 3 },
          { principal: 600, termTurns: 6 },
        ],
      },
    },
    incomeCollectionActive: false,
    endOfTurnDeltasApplied: false,
    previousCoins: null,
    previousReputation: null,
    displayedCoins: null,
    displayedReputation: null,
    displayedIncomeCounted: false,
    incidentRevealActive: false,
    logDeferredUntilPhaseComplete: false,
    replayMode: false,
    settingsPanel: { reducedMotion: false },
    tutorialController: { isActive: false },
    showLoanPayoffDialog: vi.fn((payoff: LoanPayoff, onDismiss: () => void) => {
      order.push(`payoff:${payoff.termTurns}`);
      dialogs.push({ payoff, dismiss: onDismiss });
      return true;
    }),
    showTurnSummaryDialog: vi.fn(() => {
      order.push('summary');
    }),
    tutorialOverlay: { showBankingHint: vi.fn() },
    msRenderer: {
      refreshAllExceptStreet: vi.fn(),
      getFrontIncidentCardCenter: vi.fn(() => ({ x: 0, y: 0 })),
    },
    refreshAll: vi.fn(),
    refreshLog: vi.fn(),
    msLifecycleManager: { onTutorialActionComplete: vi.fn() },
    refreshUndoRedoButtons: vi.fn(),
    // Complete the incident reveal synchronously so the closing presentation
    // reaches the payoff/summary/advance callbacks (mirrors a real animator).
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
    ...sceneOverrides,
  };

  const tcCtx: any = {
    scene,
    startTurnPhase: vi.fn(),
    handleGameOver: vi.fn(),
    presentEventChoiceDialog: vi.fn(),
    onSaveCheckpoint: vi.fn(),
    // `onEventChoice` resumes through the real closing presenter.
    finishTurnPresentation: (result: TurnResult, hint: boolean) =>
      finishTurnPresentation(tcCtx, result, hint),
  };

  return { scene, tcCtx, dialogs, order };
}

/** A competitive scene: a human seat 0 and an AI seat 1. */
function makeCompetitiveHarness(stateOverrides: Record<string, unknown> = {}) {
  const dialogs: DialogRecord[] = [];
  const order: string[] = [];

  const scene: any = {
    state: {
      turn: 7,
      players: [
        { playerId: 0, controller: 'human', coins: 500, reputation: 5, score: 1 },
        { playerId: 1, controller: 'ai', coins: 500, reputation: 5, score: 1 },
      ],
      gameResult: 'playing',
      ...stateOverrides,
    },
    replayMode: false,
    settingsPanel: { reducedMotion: false },
    // Complete the incident reveal synchronously so the closing presentation
    // reaches the payoff/day-advance callbacks (mirrors a real animator).
    msAnimator: {
      animateIncidentReveal: vi.fn((opts: { onComplete?: () => void }) => {
        opts?.onComplete?.();
      }),
    },
    msRenderer: { getFrontIncidentCardCenter: vi.fn(() => ({ x: 0, y: 0 })) },
    showLoanPayoffDialog: vi.fn((payoff: LoanPayoff, onDismiss: () => void) => {
      order.push(`payoff:${payoff.ownerId}`);
      dialogs.push({ payoff, dismiss: onDismiss });
      return true;
    }),
  };
  // No competitive summary panel in this harness: the next day is the
  // continuation, so the payoff dialog's chaining into it is directly
  // observable. (The panel's own gate is covered by
  // `competitive-turn-summary-gate.test.ts`.)

  const tcCtx: any = {
    scene,
    startTurnPhase: vi.fn(),
    handleGameOver: vi.fn(),
    onSaveCheckpoint: vi.fn(),
  };

  return { scene, tcCtx, dialogs, order };
}

/** A scene whose every presentation call is recorded, with an undo surface. */
function makeEventChoiceHarness() {
  const harness = makeSinglePlayerHarness();
  harness.scene.refreshUndoRedoButtons = vi.fn();
  harness.scene.state.pendingEventChoice = {
    event: { id: 'ev-choice', name: 'Choice Event' },
    resolved: false,
  };
  harness.scene.state.incidentDeck = [];
  return harness;
}

// ── Single-player sequencing (AC1/AC2/AC5) ──────────────────

describe('payoff dialog ahead of the End of Turn summary (AC1/AC2/AC5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('presents the congratulation after the closing and holds the summary until it is dismissed', () => {
    const { scene, tcCtx, dialogs, order } = makeSinglePlayerHarness();

    finishTurnPresentation(tcCtx, makeResult({ loanPayoffs: [PAYOFF] }), false);

    // Exactly one dialog, for the reported payoff, and the closing animations
    // had already completed (`animateIncidentReveal` ran first).
    expect(scene.msAnimator.animateIncidentReveal).toHaveBeenCalledTimes(1);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].payoff).toBe(PAYOFF);
    // AC5: nothing else is on screen yet — the summary comes second.
    expect(order).toEqual(['payoff:6']);
    expect(scene.showTurnSummaryDialog).not.toHaveBeenCalled();
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();

    dialogs[0].dismiss();

    // AC2: dismissing continues into the summary, exactly as it ran before.
    expect(order).toEqual(['payoff:6', 'summary']);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();

    // …and the summary's [ Next Turn ] still advances the deferred closing.
    const [, onNextTurn] = scene.showTurnSummaryDialog.mock.calls[0];
    onNextTurn();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('presents one dialog per payoff, sequentially, before the summary', () => {
    const { scene, tcCtx, dialogs, order } = makeSinglePlayerHarness();

    finishTurnPresentation(tcCtx, makeResult({ loanPayoffs: [PAYOFF, LATER_PAYOFF] }), false);

    // Sequential: the second dialog is held until the first is dismissed.
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].payoff).toBe(PAYOFF);

    dialogs[0].dismiss();
    expect(dialogs).toHaveLength(2);
    expect(dialogs[1].payoff).toBe(LATER_PAYOFF);
    expect(scene.showTurnSummaryDialog).not.toHaveBeenCalled();

    dialogs[1].dismiss();
    expect(order).toEqual(['payoff:6', 'payoff:3', 'summary']);
  });

  it('presents nothing before a pause and exactly one dialog for the resumed closing', () => {
    const { tcCtx, dialogs, order } = makeSinglePlayerHarness();

    // The closing pauses on the choice dialog before the presentation slot, so
    // the interruption wins and no congratulation is drawn yet (one modal at a
    // time).
    finishTurnPresentation(
      tcCtx,
      makeResult({ choicePending: true, loanPayoffs: [PAYOFF] }),
      false,
    );
    expect(dialogs).toHaveLength(0);
    expect(tcCtx.presentEventChoiceDialog).toHaveBeenCalledTimes(1);

    // The resumed closing presents the payoff it carries exactly once — the
    // pause/resume cycle can never stack a second dialog for the same turn.
    finishTurnPresentation(
      tcCtx,
      makeResult({ choicePending: false, requiresDeferredClosing: false, loanPayoffs: [PAYOFF] }),
      false,
    );
    expect(dialogs).toHaveLength(1);
    expect(order).toEqual(['payoff:6']);
  });

  it('presents nothing when the closing retired no loan (unchanged flow)', () => {
    const { scene, tcCtx, dialogs, order } = makeSinglePlayerHarness();

    finishTurnPresentation(tcCtx, makeResult(), false);

    expect(dialogs).toHaveLength(0);
    expect(scene.showLoanPayoffDialog).not.toHaveBeenCalled();
    expect(order).toEqual(['summary']);
  });

  it('continues into the next-week flow when the summary gate is skipped (AC2)', () => {
    const { scene, tcCtx, dialogs, order } = makeSinglePlayerHarness();

    finishTurnPresentation(
      tcCtx,
      makeResult({ requiresDeferredClosing: false, loanPayoffs: [PAYOFF] }),
      false,
    );

    expect(dialogs).toHaveLength(1);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();

    dialogs[0].dismiss();

    // The legacy closing advances the day itself; no summary was involved.
    expect(order).toEqual(['payoff:6']);
    expect(scene.showTurnSummaryDialog).not.toHaveBeenCalled();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('does not stall the closing when the dialog surface suppresses the payoff', () => {
    const { tcCtx, dialogs, order } = makeSinglePlayerHarness({
      showLoanPayoffDialog: vi.fn(() => false),
    });

    finishTurnPresentation(tcCtx, makeResult({ loanPayoffs: [PAYOFF] }), false);

    // The renderer reported "nothing drawn", so the flow continues untouched.
    expect(dialogs).toHaveLength(0);
    expect(order).toEqual(['summary']);
  });
});

// ── Replay / seat gating (AC3) ──────────────────────────────

describe('payoff dialog suppression (AC3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never presents in replayMode', () => {
    const { scene, tcCtx, dialogs } = makeSinglePlayerHarness({ replayMode: true });

    finishTurnPresentation(tcCtx, makeResult({ loanPayoffs: [PAYOFF] }), false);

    expect(dialogs).toHaveLength(0);
    expect(scene.showLoanPayoffDialog).not.toHaveBeenCalled();
    // The replay pacing is untouched: no summary, the day advances.
    expect(scene.showTurnSummaryDialog).not.toHaveBeenCalled();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('suppresses an AI seat payoff in competitive play', () => {
    const { scene, tcCtx, dialogs } = makeCompetitiveHarness();

    presentCompetitiveDayTail(tcCtx, makeResult({ loanPayoffs: [AI_PAYOFF] }));

    expect(dialogs).toHaveLength(0);
    expect(scene.showLoanPayoffDialog).not.toHaveBeenCalled();
    // An AI seat's payoff changes nothing visible: the shared day advances.
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });
});

// ── Game-over precedence (AC4) ──────────────────────────────

describe('a closing that ends the run (AC4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('presents the game-over overlay instead of the congratulation', () => {
    const { scene, tcCtx, dialogs } = makeSinglePlayerHarness();

    finishTurnPresentation(
      tcCtx,
      makeResult({ gameResult: 'loss', requiresDeferredClosing: false, loanPayoffs: [PAYOFF] }),
      false,
    );

    expect(dialogs).toHaveLength(0);
    expect(scene.showLoanPayoffDialog).not.toHaveBeenCalled();
    expect(scene.showTurnSummaryDialog).not.toHaveBeenCalled();
    expect(tcCtx.handleGameOver).toHaveBeenCalledTimes(1);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();
  });

  it('presents the game-over overlay for a competitive closing that ended the run', () => {
    const { tcCtx, dialogs } = makeCompetitiveHarness({ gameResult: 'loss' });

    presentCompetitiveDayTail(tcCtx, makeResult({ loanPayoffs: [PAYOFF] }));

    expect(dialogs).toHaveLength(0);
    expect(tcCtx.handleGameOver).toHaveBeenCalledTimes(1);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();
  });
});

// ── Competitive public path (AC3) ───────────────────────────

describe('competitive closing presents the human seat payoff (AC3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('presents the human seat congratulation and holds the next day until dismissed', () => {
    const { scene, tcCtx, dialogs } = makeCompetitiveHarness();

    presentCompetitiveDayTail(tcCtx, makeResult({ loanPayoffs: [PAYOFF] }));

    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].payoff).toBe(PAYOFF);
    // One modal at a time: the shared day has not restarted yet.
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();

    dialogs[0].dismiss();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
    // The closing presentation was the only other presenter.
    expect(scene.showLoanPayoffDialog).toHaveBeenCalledTimes(1);
  });

  it('presents the human seat payoff even when an AI seat also retired a loan', () => {
    const { tcCtx, dialogs } = makeCompetitiveHarness();

    presentCompetitiveDayTail(tcCtx, makeResult({ loanPayoffs: [PAYOFF, AI_PAYOFF] }));

    // Only the human seat's payoff is presented; the AI seat's is skipped
    // without consuming a second dialog.
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].payoff).toBe(PAYOFF);

    dialogs[0].dismiss();
    expect(dialogs).toHaveLength(1);
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });
});

// ── Paused closing carry (MS-0MW4887R4007XPGJ) ──────────────
//
// The payoff presentation slot lives *after* the event-choice and bailout
// pauses, so a closing that pauses there never reaches it on the first pass.
// The paused closing's `loanPayoffs` must be carried across the pause and
// presented once on the continuing resume — never on a resume that ends the
// run, and never twice.

describe('paused closing carries the payoff into the resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('event-choice pause presents nothing and resumes with exactly one congratulation', () => {
    const { scene, tcCtx, dialogs, order } = makeEventChoiceHarness();

    // The closing pauses on the choice dialog before the presentation slot.
    finishTurnPresentation(
      tcCtx,
      makeResult({ choicePending: true, loanPayoffs: [PAYOFF] }),
      false,
    );

    // One modal at a time: the pause wins and nothing is drawn yet, but the
    // payoff is carried on the scene (mirroring `pendingBankingHint`).
    expect(dialogs).toHaveLength(0);
    expect(scene.showLoanPayoffDialog).not.toHaveBeenCalled();
    expect(tcCtx.presentEventChoiceDialog).toHaveBeenCalledTimes(1);
    expect((scene as any).pausedLoanPayoffs).toEqual([PAYOFF]);

    // The resumed closing (`finishDeferredEndOfTurn`) does NOT carry the
    // payoffs itself — the carry re-attaches them on the resume seam.
    vi.mocked(finishDeferredEndOfTurn).mockReturnValueOnce(
      makeResult({
        choicePending: false,
        requiresDeferredClosing: false,
        income: null,
        incident: null,
        loanPayoffs: undefined,
      }),
    );

    onEventChoice(tcCtx, 'accept');

    // Exactly one congratulation, and the carry is cleared once consumed.
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].payoff).toBe(PAYOFF);
    expect((scene as any).pausedLoanPayoffs).toBeNull();

    dialogs[0].dismiss();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['payoff:6']);
  });

  it('never presents two congratulations across an event-choice pause and its resume', () => {
    const { scene, tcCtx, dialogs } = makeEventChoiceHarness();

    finishTurnPresentation(
      tcCtx,
      makeResult({ choicePending: true, loanPayoffs: [PAYOFF] }),
      false,
    );
    vi.mocked(finishDeferredEndOfTurn).mockReturnValueOnce(
      makeResult({
        choicePending: false,
        requiresDeferredClosing: false,
        income: null,
        incident: null,
        loanPayoffs: undefined,
      }),
    );

    onEventChoice(tcCtx, 'accept');
    // A double callback: the engine consumes the pending choice on the first
    // resume, so the re-entrant call is a no-op and cannot replay the dialog.
    scene.state.pendingEventChoice = null;
    onEventChoice(tcCtx, 'accept');

    expect(dialogs).toHaveLength(1);
    expect(scene.showLoanPayoffDialog).toHaveBeenCalledTimes(1);
  });

  it('bailout accept continues the run with exactly one congratulation', () => {
    const { scene, tcCtx, dialogs } = makeSinglePlayerHarness();
    scene.state.pendingLoanOffer = { options: [{ principal: 300, termTurns: 3 }] };
    const paused = makeResult({
      pendingLoanOffer: true,
      requiresDeferredClosing: true,
      loanPayoffs: [PAYOFF],
    });
    // The real `finishDeferredTurnClosing` spreads the paused result: the offer
    // is resolved and the carried payoffs survive into the resumed tail.
    vi.mocked(finishDeferredTurnClosing).mockReturnValueOnce({
      ...paused,
      pendingLoanOffer: false,
      gameResult: 'playing',
      newlyCompletedChallenges: [],
      choicePending: false,
    });

    onLoanOfferChoice(tcCtx, paused, 0);

    // The congratulation holds the next week (one modal at a time).
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].payoff).toBe(PAYOFF);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();

    dialogs[0].dismiss();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
    expect(scene.showLoanPayoffDialog).toHaveBeenCalledTimes(1);
  });

  it('bailout decline ends the run: game over wins and no congratulation', () => {
    const { scene, tcCtx, dialogs } = makeSinglePlayerHarness();
    scene.state.pendingLoanOffer = { options: [{ principal: 300, termTurns: 3 }] };
    const paused = makeResult({
      pendingLoanOffer: true,
      requiresDeferredClosing: true,
      loanPayoffs: [PAYOFF],
    });
    vi.mocked(finishDeferredTurnClosing).mockReturnValueOnce({
      ...paused,
      pendingLoanOffer: false,
      gameResult: 'loss',
      newlyCompletedChallenges: [],
      choicePending: false,
    });

    onLoanOfferChoice(tcCtx, paused, null);

    expect(dialogs).toHaveLength(0);
    expect(scene.showLoanPayoffDialog).not.toHaveBeenCalled();
    expect(tcCtx.handleGameOver).toHaveBeenCalledTimes(1);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();
  });

  it('does not replay the congratulation when an offer pauses the deferred tail after the slot', () => {
    const { scene, tcCtx, dialogs } = makeSinglePlayerHarness();

    finishTurnPresentation(tcCtx, makeResult({ loanPayoffs: [PAYOFF] }), false);
    // The presentation slot handled the payoff exactly once.
    expect(dialogs).toHaveLength(1);

    // Dismiss into the summary, then [ Next Turn ] runs the deferred tail.
    dialogs[0].dismiss();
    const [, onNextTurn] = scene.showTurnSummaryDialog.mock.calls[0];
    onNextTurn();

    // The tail is handed the closing result with the payoff already consumed,
    // so a bailout raised there (and its later resume) can never replay it.
    const [, tailResult] = vi.mocked(finishDeferredTurnClosing).mock.calls[0];
    expect((tailResult as TurnResult).loanPayoffs).toBeUndefined();
    expect(scene.showLoanPayoffDialog).toHaveBeenCalledTimes(1);
  });
});

// ── Competitive bailout pause carry (MS-0MW8FXE3D0041KEG) ────
//
// The competitive tail pauses on a seat's bailout offer *after* the day's
// repayments already ran, so the paused closing carries this day's
// retirements on `loanPayoffs`. `resolveCompetitiveLoanOffer` re-runs only the
// failure/end-check tail with `skipLoanRepayments: true`, so the resumed
// result carries none. The paused list must be carried across the pause and
// presented exactly once on the continuing resume — never on a decline that
// ends the run, and never twice.

describe('competitive bailout pause carries the payoff into the resume (MS-0MW8FXE3D0041KEG)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * A competitive scene primed with an open human-seat bailout offer and a
   * recorded offer dialog surface. Resolving through the recorded callbacks
   * runs the real `onLoanOfferChoice` resume seam.
   */
  function makeCompetitiveBailoutHarness() {
    const { scene, tcCtx, dialogs } = makeCompetitiveHarness();
    scene.state.pendingLoanOffer = {
      ownerId: 0,
      options: [{ principal: 300, termTurns: 3 }],
      shortfall: 100,
      reason: 'bankruptcy',
    };
    const offers: Array<() => void> = [];
    tcCtx.presentLoanOfferDialog = vi.fn((result: TurnResult) => {
      offers.push(() => onLoanOfferChoice(tcCtx, result, 0));
      return true;
    });
    return { scene, tcCtx, dialogs, offers };
  }

  it('accept continues the day and presents exactly one congratulation', () => {
    const { scene, tcCtx, dialogs, offers } = makeCompetitiveBailoutHarness();
    const paused = makeResult({
      pendingLoanOffer: true,
      playerIncome: undefined,
      loanPayoffs: [PAYOFF],
    });

    // The closing pauses on the offer: nothing is drawn yet, but the payoff
    // is carried on the scene (mirroring the single-player carry).
    presentCompetitiveDayTail(tcCtx, paused);
    expect(dialogs).toHaveLength(0);
    expect(offers).toHaveLength(1);
    expect((scene as any).pausedCompetitiveLoanPayoffs).toEqual([PAYOFF]);

    // The resumed closing re-runs only the failure tail — it carries no
    // payoffs itself, and the engine clears the offer on resolution.
    vi.mocked(resolveCompetitiveLoanOffer).mockImplementationOnce((state) => {
      state.pendingLoanOffer = null;
      return makeResult({ pendingLoanOffer: false, loanPayoffs: undefined });
    });

    offers[0]();

    // Exactly one congratulation, and the carry is cleared once consumed.
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].payoff).toBe(PAYOFF);
    expect((scene as any).pausedCompetitiveLoanPayoffs).toBeNull();

    // One modal at a time: the next day starts only once it is dismissed.
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();
    dialogs[0].dismiss();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
    expect(scene.showLoanPayoffDialog).toHaveBeenCalledTimes(1);
  });

  it('decline ends the run: game over wins and no congratulation', () => {
    const { scene, tcCtx, dialogs, offers } = makeCompetitiveBailoutHarness();
    const paused = makeResult({
      pendingLoanOffer: true,
      playerIncome: undefined,
      loanPayoffs: [PAYOFF],
    });

    presentCompetitiveDayTail(tcCtx, paused);
    expect(dialogs).toHaveLength(0);
    expect(offers).toHaveLength(1);

    vi.mocked(resolveCompetitiveLoanOffer).mockImplementationOnce((state) => {
      state.pendingLoanOffer = null;
      state.gameResult = 'loss';
      return makeResult({
        pendingLoanOffer: false,
        gameResult: 'loss',
        loanPayoffs: undefined,
      });
    });

    // The dialog's decline resolves with `null` (the real engine tail ends the
    // run); a run that is no longer `playing` presents the game-over overlay.
    onLoanOfferChoice(tcCtx, paused, null);

    expect(dialogs).toHaveLength(0);
    expect(scene.showLoanPayoffDialog).not.toHaveBeenCalled();
    expect(tcCtx.handleGameOver).toHaveBeenCalledTimes(1);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();
    // The carry must not survive the ended run.
    expect((scene as any).pausedCompetitiveLoanPayoffs).toBeNull();
  });

  it('never presents two congratulations across the pause and a double callback', () => {
    const { scene, tcCtx, dialogs, offers } = makeCompetitiveBailoutHarness();
    const paused = makeResult({
      pendingLoanOffer: true,
      playerIncome: undefined,
      loanPayoffs: [PAYOFF],
    });

    presentCompetitiveDayTail(tcCtx, paused);
    vi.mocked(resolveCompetitiveLoanOffer).mockImplementationOnce((state) => {
      state.pendingLoanOffer = null;
      return makeResult({ pendingLoanOffer: false, loanPayoffs: undefined });
    });

    offers[0]();
    // A double callback: the engine consumed the pending offer on the first
    // resume, so the re-entrant call is a no-op and cannot replay the dialog.
    scene.state.pendingLoanOffer = null;
    offers[0]();

    expect(dialogs).toHaveLength(1);
    expect(scene.showLoanPayoffDialog).toHaveBeenCalledTimes(1);
  });

  it('headless resume (no offer surface) still presents exactly one congratulation', () => {
    const { scene, tcCtx, dialogs } = makeCompetitiveHarness();
    scene.state.pendingLoanOffer = {
      ownerId: 0,
      options: [{ principal: 300, termTurns: 3 }],
      shortfall: 100,
      reason: 'bankruptcy',
    };
    // No `presentLoanOfferDialog` on the context: the tail resolves the offer
    // deterministically and recurses with the resumed closing.
    const paused = makeResult({
      pendingLoanOffer: true,
      playerIncome: undefined,
      loanPayoffs: [PAYOFF],
    });
    vi.mocked(resolveCompetitiveLoanOffer).mockImplementationOnce((state) => {
      state.pendingLoanOffer = null;
      return makeResult({ pendingLoanOffer: false, loanPayoffs: undefined });
    });

    presentCompetitiveDayTail(tcCtx, paused);

    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].payoff).toBe(PAYOFF);
    // The carry was consumed by the recursive resume.
    expect((scene as any).pausedCompetitiveLoanPayoffs).toBeNull();
  });

  it('does not replay when the resumed tail is entered again (F5 continuation)', () => {
    const { scene, tcCtx, dialogs, offers } = makeCompetitiveBailoutHarness();
    const paused = makeResult({
      pendingLoanOffer: true,
      playerIncome: undefined,
      loanPayoffs: [PAYOFF],
    });

    presentCompetitiveDayTail(tcCtx, paused);
    vi.mocked(resolveCompetitiveLoanOffer).mockImplementationOnce((state) => {
      state.pendingLoanOffer = null;
      return makeResult({ pendingLoanOffer: false, loanPayoffs: undefined });
    });
    offers[0]();
    expect(dialogs).toHaveLength(1);

    // A piggyback continuation re-enters the tail with another resumed closing
    // that (like the real resumed closing) carries no payoffs. The carry was
    // consumed once, so nothing is replayed.
    presentCompetitiveDayTail(
      tcCtx,
      makeResult({ pendingLoanOffer: false, loanPayoffs: undefined }),
    );

    expect(dialogs).toHaveLength(1);
    expect(scene.showLoanPayoffDialog).toHaveBeenCalledTimes(1);
  });
});
