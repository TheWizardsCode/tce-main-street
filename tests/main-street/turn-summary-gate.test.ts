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

import {
  endTurn,
  finishTurnPresentation,
  shouldGateTurnSummary,
} from '../../src/scenes/MainStreetTurnControllerTurnFlow';
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
      // Loans config + state the Turn Summary descriptor is built from
      // (MS-0MVXYCICT0051LU7). The acting seat defaults to `activePlayerId`.
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

    const result = makeResult();
    finishTurnPresentation(tcCtx, result, false);

    // The dialog appears once, after the closing presentation.
    expect(scene.showTurnSummaryDialog).toHaveBeenCalledTimes(1);
    const [summary, onNextTurn, , , forwardedResult] =
      scene.showTurnSummaryDialog.mock.calls[0];
    // The summary flows through the real model (wired content, not a stub).
    expect(summary.turn).toBe(7);
    expect(summary.net.coins).toBe(-10);
    expect(summary.closing.coins).toBe(990);
    expect(summary.humanOwner?.businessesOwned).toBe(3);
    // MS-0MVXYCKFE000VF76: the same committed result is forwarded, so a
    // mid-game loan taken from the dialog can re-render the panel from it.
    expect(forwardedResult).toBe(result);

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

  it('AC1 (MS-0MW20KSEG001DH1X) — reduced motion presents the dialog and holds the next day until [ Next Turn ]', () => {
    const { scene, tcCtx } = makeHarness({
      settingsPanel: { reducedMotion: true },
    });

    finishTurnPresentation(tcCtx, makeResult(), false);

    // The dialog is instant-appearance, so reduced motion is no reason to
    // suppress it: the player gets the summary instead of a silent advance.
    expect(scene.showTurnSummaryDialog).toHaveBeenCalledTimes(1);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();

    const [, onNextTurn] = scene.showTurnSummaryDialog.mock.calls[0];
    onNextTurn();
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

/**
 * The gate builds one Phaser-free loans descriptor from the live `s.state`
 * (`config` + acting seat) and hands it to the dialog as the third argument, so
 * the overlay never reaches into scene state (MS-0MVXYCICT0051LU7).
 */
describe('Turn Summary loans descriptor forwarding (MS-0MVXYCICT0051LU7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards a descriptor built from the live config (loans enabled, no active loan)', () => {
    const { scene, tcCtx } = makeHarness();

    finishTurnPresentation(tcCtx, makeResult(), false);

    const [, , descriptor] = scene.showTurnSummaryDialog.mock.calls[0];
    expect(descriptor).toBeDefined();
    expect(descriptor.enabled).toBe(true);
    expect(descriptor.reason).toBeNull();
    expect(descriptor.activeLoan).toBeNull();
    expect(descriptor.hint).toBeNull();
    // The menu is the configured table, not a hard-coded copy.
    expect(descriptor.options).toEqual(scene.state.config.loanOptions);
  });

  it('forwards `enabled: false` / `loans-disabled` when config.loansEnabled is false', () => {
    const { scene, tcCtx } = makeHarness();
    scene.state.config = { ...scene.state.config, loansEnabled: false };

    finishTurnPresentation(tcCtx, makeResult(), false);

    const [, , descriptor] = scene.showTurnSummaryDialog.mock.calls[0];
    expect(descriptor.enabled).toBe(false);
    expect(descriptor.reason).toBe('loans-disabled');
    expect(descriptor.options).toEqual([]);
  });

  it('evaluates the acting seat, not seat 0 (the live active-player id)', () => {
    const { scene, tcCtx } = makeHarness();
    scene.state.activePlayerId = 1;
    scene.state.loans = [
      { ownerId: 1, perTurnRepayment: 110, turnsRemaining: 4 },
    ];

    finishTurnPresentation(tcCtx, makeResult(), false);

    const [, , descriptor] = scene.showTurnSummaryDialog.mock.calls[0];
    // Seat 1 owes 110/week for 4 more weeks, so its affordance is blocked.
    expect(descriptor.enabled).toBe(false);
    expect(descriptor.reason).toBe('active-loan');
    expect(descriptor.activeLoan).toEqual({ perTurnRepayment: 110, turnsRemaining: 4 });
  });

  it('still presents the dialog when the descriptor cannot be built (never strands)', () => {
    const { scene, tcCtx } = makeHarness();
    // A hand-built/legacy state with no config: the descriptor build throws, the
    // dialog must still appear rather than stalling the deferred closing.
    delete (scene.state as { config?: unknown }).config;

    finishTurnPresentation(tcCtx, makeResult(), false);

    expect(scene.showTurnSummaryDialog).toHaveBeenCalledTimes(1);
    const [, onNextTurn, descriptor] = scene.showTurnSummaryDialog.mock.calls[0];
    expect(descriptor).toBeUndefined();
    onNextTurn();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });
});

/**
 * The guard matrix itself (MS-0MW20KSEG001DH1X): reduced motion must NOT
 * suppress the dialog, while replay, the tutorial and competitive closings
 * still do — in every combination.
 */
describe('shouldGateTurnSummary guard matrix (MS-0MW20KSEG001DH1X)', () => {
  const COMPETITIVE_STATE = {
    turn: 7,
    players: [
      { playerId: 0, controller: 'human', coins: 100, reputation: 10, score: 5 },
      { playerId: 1, controller: 'ai', coins: 90, reputation: 9, score: 4 },
    ],
  };

  function gate(
    sceneOverrides: Record<string, unknown>,
    result: TurnResult = makeResult(),
  ): boolean {
    const { tcCtx } = makeHarness(sceneOverrides);
    return shouldGateTurnSummary(tcCtx, result);
  }

  it('gates a deferred single-player closing with reduced motion ON or OFF', () => {
    expect(gate({ settingsPanel: { reducedMotion: false } })).toBe(true);
    // The regression this suite pins: the display gate used to return false
    // here, so the dialog never appeared for reduced-motion players.
    expect(gate({ settingsPanel: { reducedMotion: true } })).toBe(true);
    // A scene with no settings panel (hand-built / headless) behaves as
    // reduced motion off.
    expect(gate({ settingsPanel: undefined })).toBe(true);
  });

  it('never gates replay, tutorial or competitive closings, with reduced motion ON or OFF', () => {
    for (const reducedMotion of [false, true]) {
      const settingsPanel = { reducedMotion };
      expect(gate({ settingsPanel, replayMode: true })).toBe(false);
      expect(gate({ settingsPanel, tutorialController: { isActive: true } })).toBe(false);
      expect(gate({ settingsPanel, state: COMPETITIVE_STATE })).toBe(false);
    }
  });

  it('never gates a closing that is not deferred (nothing to gate)', () => {
    for (const reducedMotion of [false, true]) {
      expect(
        gate(
          { settingsPanel: { reducedMotion } },
          makeResult({ requiresDeferredClosing: false }),
        ),
      ).toBe(false);
    }
  });
});

/**
 * The other half of the fix (MS-0MW20KSEG001DH1X): removing the display gate
 * alone would change nothing, because a reduced-motion closing never took the
 * deferred path — `shouldGateTurnSummary`'s first guard (`requiresDeferredClosing`)
 * short-circuited. These cases pin the `endTurn` closing-path selection.
 */
function makeEndTurnHarness(overrides: Record<string, unknown> = {}) {
  const scene: any = {
    state: {
      turn: 7,
      phase: 'MarketPhase',
      players: [] as unknown[],
      actionsRemaining: 0,
      resourceBank: { coins: 990, reputation: 12 },
      streetGrid: [] as unknown[],
    },
    uiPhase: 'market',
    pendingApplicant: null,
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
    msLifecycleManager: { isTutorialActionAllowed: () => ({ allowed: true }) },
    msAnimator: { animateIncomePhases: vi.fn() },
    msPedestrians: { beginEndOfTurn: vi.fn() },
    undoManager: { clear: vi.fn() },
    refreshActionButtons: vi.fn(),
    refreshUndoRedoButtons: vi.fn(),
    ...overrides,
  };
  // `finishTurnPresentation` is stubbed: this suite is about which closing
  // path `endTurn` selects, and the gate/presentation behaviour is covered
  // above against the real implementation.
  const tcCtx: any = {
    scene,
    finishTurnPresentation: vi.fn(),
    onSaveCheckpoint: vi.fn(),
  };
  return { scene, tcCtx };
}

/**
 * Faithful stand-in for the real engine: it only marks the closing deferred
 * when the controller asked for it, exactly like `processEndOfTurn`.
 */
function mockEngineClosingPath(): void {
  vi.mocked(Engine.processEndOfTurn).mockImplementation(
    (_state: unknown, opts?: { deferResourceApplication?: boolean }) =>
      makeResult({ requiresDeferredClosing: opts?.deferResourceApplication === true }),
  );
}

describe('endTurn closing-path selection under reduced motion (MS-0MW20KSEG001DH1X)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEngineClosingPath();
  });

  it('AC1 — reduced motion requests the deferred closing (so the summary has something to gate)', () => {
    const { scene, tcCtx } = makeEndTurnHarness({
      settingsPanel: { reducedMotion: true },
    });

    endTurn(tcCtx);

    // The engine only sets `requiresDeferredClosing` when the flag is passed.
    expect(Engine.processEndOfTurn).toHaveBeenCalledWith(scene.state, {
      deferResourceApplication: true,
    });
    // The deferred HUD window opens at the pre-turn values, so the HUD keeps
    // showing them while the (instant) phases progress.
    expect(scene.previousCoins).toBe(990);
    expect(scene.displayedCoins).toBe(990);
    expect(scene.displayedReputation).toBe(12);
    // The checkpoint is written in the deferred closing tail, not at endTurn.
    expect(tcCtx.onSaveCheckpoint).not.toHaveBeenCalled();
    // The deferred result reaches the presentation, where the gate applies.
    expect(tcCtx.finishTurnPresentation).toHaveBeenCalledWith(
      expect.objectContaining({ requiresDeferredClosing: true }),
      false,
    );
  });

  it('reduced motion OFF keeps the deferred path (unchanged)', () => {
    const { scene, tcCtx } = makeEndTurnHarness();

    endTurn(tcCtx);

    expect(Engine.processEndOfTurn).toHaveBeenCalledWith(scene.state, {
      deferResourceApplication: true,
    });
    expect(tcCtx.onSaveCheckpoint).not.toHaveBeenCalled();
  });

  it('the tutorial and replay keep the immediate path — with reduced motion ON or OFF', () => {
    for (const reducedMotion of [false, true]) {
      vi.clearAllMocks();
      mockEngineClosingPath();

      const tutorial = makeEndTurnHarness({
        settingsPanel: { reducedMotion },
        tutorialController: { isActive: true },
      });
      endTurn(tutorial.tcCtx);
      expect(Engine.processEndOfTurn).toHaveBeenCalledWith(tutorial.scene.state, undefined);
      // The display-only counters stay closed on the legacy immediate path.
      expect(tutorial.scene.displayedCoins).toBeNull();
      // The immediate path saves the checkpoint at endTurn as it always did.
      expect(tutorial.tcCtx.onSaveCheckpoint).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();
      mockEngineClosingPath();

      const replay = makeEndTurnHarness({
        settingsPanel: { reducedMotion },
        replayMode: true,
      });
      endTurn(replay.tcCtx);
      expect(Engine.processEndOfTurn).toHaveBeenCalledWith(replay.scene.state, undefined);
      expect(replay.scene.displayedCoins).toBeNull();
      expect(replay.tcCtx.onSaveCheckpoint).toHaveBeenCalledTimes(1);
    }
  });
});
