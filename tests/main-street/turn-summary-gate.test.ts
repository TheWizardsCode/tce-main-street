/**
 * Main Street: Turn Summary Gate Tests (MS-0MVP46Q8X003419R)
 *
 * Verifies that the deferred single-player closing presents the Turn Summary
 * dialog only after the end-of-turn animations complete, and that the next
 * day does not start until the player clicks [ Next Turn ].
 *
 * AC1 — normal single-player play (deferred/closing path): dialog appears
 *       after the closing presentation; the next day starts only on the
 *       dialog's `onNextTurn` callback. Reduced-motion, tutorial and replay
 *       skip the dialog and keep the existing auto-advance pacing.
 * AC2 — the dialog continues the deferred flow via `onNextTurn` (banking
 *       hint, income-wait, `finalizeTurn`).
 * AC3 — deltas are applied idempotently (`endOfTurnDeltasApplied` guard)
 *       before the panel renders.
 * AC4 — the dialog is never presented in competitive mode.
 * AC5 — a pending banking hint presents after the dialog is dismissed.
 * AC6 — this file exercises the gate on the `finishTurnPresentation` flow.
 *
 * The engine module is mocked exactly like the sibling
 * `activity-log-deferred-rendering.test.ts`, so the turn-flow module can be
 * exercised with a minimal scene surface; the summary content itself flows
 * through the real Phaser-free {@link buildTurnSummary} model.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the engine so the turn-flow timing can be exercised without a full
// game state. Only the symbols the turn-flow module imports are provided.
vi.mock('../../src/MainStreetEngine', () => ({
  applyEndOfTurnDeltas: vi.fn(),
  finishDeferredTurnClosing: vi.fn((_state: unknown, result: unknown) => ({
    ...(result as Record<string, unknown>),
    gameResult: 'playing',
    finalScore: 0,
    newlyCompletedChallenges: [],
    choicePending: false,
  })),
  executeWeekStart: vi.fn(),
  finishDeferredEndOfTurn: vi.fn(),
  processEndOfTurn: vi.fn(),
  canAffordPiggybackJoinFully: vi.fn(),
  findHumanSeatId: vi.fn(),
  piggybackJoinFullyCost: vi.fn(),
  projectPiggybackEventReward: vi.fn(),
  resolvePendingPiggyback: vi.fn(),
}));

import { finishTurnPresentation } from '../../src/scenes/MainStreetTurnControllerTurnFlow';
import type { TurnResult } from '../../src/MainStreetEngine';
import * as Engine from '../../src/MainStreetEngine';
import type { TurnLedger } from '../../src/MainStreetEngineTypes';

// ── Fixtures ────────────────────────────────────────────────

/**
 * An internally consistent ledger: income (+140) + expenses (−80) +
 * incident (−40) + one-off (−30) balances the net coin change (−10).
 * Closing = day-start snapshot + net.
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
    // deferred-closing marker.
    requiresDeferredClosing: true,
    turnLedger: makeLedger(),
    ...overrides,
  } as TurnResult;
}

function makeHarness(overrides: Record<string, unknown> = {}) {
  const scene: any = {
    // Turn-summary-relevant state (matches the sibling model-test fixtures:
    // closing = snapshot + net).
    state: {
      turn: 7,
      players: [] as unknown[],
      resourceBank: { coins: 990, reputation: 12 },
      finalScore: 34,
      weekStartCoins: 1000,
      weekStartRep: 10,
      weekStartScore: 20,
    },
    instructionText: { setText: vi.fn() },
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
    showTurnSummaryDialog: vi.fn(),
    tutorialOverlay: { showBankingHint: vi.fn() },
    msRenderer: { refreshAllExceptStreet: vi.fn() },
    refreshAll: vi.fn(),
    refreshLog: vi.fn(),
    msLifecycleManager: { onTutorialActionComplete: vi.fn() },
    // Complete the incident reveal synchronously so the closing presentation
    // reaches the advance/gate callback (mirrors a real animator completion).
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
    ...overrides,
  };

  const tcCtx: any = {
    scene,
    startTurnPhase: vi.fn(),
    handleGameOver: vi.fn(),
    presentEventChoiceDialog: vi.fn(),
    onSaveCheckpoint: vi.fn(),
  };

  return { scene, tcCtx };
}

// ── Tests ───────────────────────────────────────────────────

describe('Turn Summary gate in finishTurnPresentation (MS-0MVP46Q8X003419R)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC1 — deferred single-player presents the dialog and holds the next day until [ Next Turn ]', () => {
    const { scene, tcCtx } = makeHarness();

    finishTurnPresentation(tcCtx, makeResult(), false);

    // The dialog appears once, after the closing presentation.
    expect(scene.showTurnSummaryDialog).toHaveBeenCalledTimes(1);
    const [summary, onNextTurn] = scene.showTurnSummaryDialog.mock.calls[0];
    // The summary flows through the real model (wired content, not a stub).
    expect(summary.turn).toBe(7);
    expect(summary.net.coins).toBe(-10);
    expect(summary.closing.coins).toBe(990);
    expect(summary.humanOwner?.businessesOwned).toBe(3);

    // The next day must NOT have started yet.
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();

    // Only the player's [ Next Turn ] click advances the day.
    onNextTurn();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('AC2 — the dialog resumes the deferred flow via onNextTurn (checkpoint + phase UI)', () => {
    const { scene, tcCtx } = makeHarness();

    finishTurnPresentation(tcCtx, makeResult(), false);
    const [, onNextTurn] = scene.showTurnSummaryDialog.mock.calls[0];

    onNextTurn();

    // The deferred closing tail runs: checkpoint persisted and the next week
    // started (income-wait is vacuous — no choreography in this harness).
    expect(tcCtx.onSaveCheckpoint).toHaveBeenCalledTimes(1);
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
    expect(scene.logDeferredUntilPhaseComplete).toBe(false);
  });

  it('AC3 — deferred deltas are applied (with the endOfTurnDeltasApplied guard) before the panel renders', () => {
    const { scene, tcCtx } = makeHarness();
    const order: string[] = [];
    vi.mocked(Engine.applyEndOfTurnDeltas).mockImplementation(() => {
      order.push('apply');
    });
    scene.showTurnSummaryDialog = vi.fn(() => {
      order.push('dialog');
    });

    // Un-applied deltas: applied exactly once, then the panel renders.
    finishTurnPresentation(tcCtx, makeResult(), false);
    expect(order).toEqual(['apply', 'dialog']);
    expect(scene.endOfTurnDeltasApplied).toBe(true);
    expect(Engine.applyEndOfTurnDeltas).toHaveBeenCalledTimes(1);

    // Idempotence: a fresh turn whose deltas were already applied (e.g. the
    // income animation's completion applied them) must not apply them again.
    vi.clearAllMocks();
    scene.endOfTurnDeltasApplied = true;
    order.length = 0;
    finishTurnPresentation(tcCtx, makeResult(), false);
    expect(order).toEqual(['dialog']);
    expect(Engine.applyEndOfTurnDeltas).not.toHaveBeenCalled();
  });

  it('AC3 — deltas land after the income choreography completes (dialog waits)', () => {
    const { scene, tcCtx } = makeHarness();
    const order: string[] = [];
    vi.mocked(Engine.applyEndOfTurnDeltas).mockImplementation(() => {
      order.push('apply');
    });
    scene.showTurnSummaryDialog = vi.fn(() => {
      order.push('dialog');
    });
    // The phased income show is still collecting when the closing completes.
    scene.incomeCollectionActive = true;
    // The collection completes on the next poll tick.
    scene.time.delayedCall = vi.fn((_ms: number, cb: () => void) => {
      scene.incomeCollectionActive = false;
      cb();
      return {};
    });

    finishTurnPresentation(tcCtx, makeResult(), false);

    // Ordering: animations complete first, then the panel renders.
    expect(order).toEqual(['apply', 'dialog']);
    expect(scene.incomeCollectionActive).toBe(false);
  });

  it('AC1 — reduced motion keeps the existing auto-advance pacing (no dialog)', () => {
    const { scene, tcCtx } = makeHarness({
      settingsPanel: { reducedMotion: true },
    });

    finishTurnPresentation(tcCtx, makeResult(), false);

    expect(scene.showTurnSummaryDialog).not.toHaveBeenCalled();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('AC1 — the tutorial keeps its existing pacing (no dialog)', () => {
    const { scene, tcCtx } = makeHarness({
      tutorialController: { isActive: true },
    });

    finishTurnPresentation(tcCtx, makeResult(), false);

    expect(scene.showTurnSummaryDialog).not.toHaveBeenCalled();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('AC1 — replay keeps its existing pacing (no dialog)', () => {
    const { scene, tcCtx } = makeHarness({
      replayMode: true,
    });

    finishTurnPresentation(tcCtx, makeResult(), false);

    expect(scene.showTurnSummaryDialog).not.toHaveBeenCalled();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('AC4 — the dialog is never presented in competitive mode', () => {
    const { scene, tcCtx } = makeHarness({
      state: {
        turn: 7,
        players: [
          { playerId: 0, controller: 'human', coins: 100, reputation: 10, score: 5 },
          { playerId: 1, controller: 'ai', coins: 90, reputation: 9, score: 4 },
        ],
      },
    });

    // Even a result marked for deferred closing must not gate the dialog.
    finishTurnPresentation(tcCtx, makeResult(), false);

    expect(scene.showTurnSummaryDialog).not.toHaveBeenCalled();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('legacy (non-deferred) closings keep the existing pacing — no dialog', () => {
    const { scene, tcCtx } = makeHarness();

    finishTurnPresentation(
      tcCtx,
      makeResult({ requiresDeferredClosing: false }),
      false,
    );

    expect(scene.showTurnSummaryDialog).not.toHaveBeenCalled();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('a deferred result without a ledger advances without showing the dialog (never stalls)', () => {
    const { scene, tcCtx } = makeHarness();

    finishTurnPresentation(
      tcCtx,
      makeResult({ requiresDeferredClosing: true, turnLedger: undefined }),
      false,
    );

    expect(scene.showTurnSummaryDialog).not.toHaveBeenCalled();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('AC5 — a pending banking hint presents only after the dialog is dismissed', () => {
    const { scene, tcCtx } = makeHarness();

    finishTurnPresentation(tcCtx, makeResult(), true);
    const [, onNextTurn] = scene.showTurnSummaryDialog.mock.calls[0];

    // The hint must not compete with the dialog — it fires on dismiss.
    expect(scene.tutorialOverlay.showBankingHint).not.toHaveBeenCalled();

    onNextTurn();
    expect(scene.tutorialOverlay.showBankingHint).toHaveBeenCalledTimes(1);
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });
});
