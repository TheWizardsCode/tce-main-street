/**
 * Main Street: Deferred Activity Log Rendering Timing Tests
 *
 * Verifies that log entries added during the end-of-turn closing are not
 * rendered until AFTER the upcoming/phase UI has been displayed to the
 * player (MS-0MURBOD2E009SOM2).
 *
 * The end-of-turn flow (`finishTurnPresentation` → `advanceTurn` →
 * `finalizeTurn` → `startTurnPhase`) is exercised with a mocked scene so
 * the render-deferral timing is asserted directly:
 *
 *  - the `logDeferredUntilPhaseComplete` flag is set before the post-turn
 *    refreshes (so `refreshLog` suppresses the new entries);
 *  - `startTurnPhase` (which displays the upcoming cards) runs while the
 *    flag is still set;
 *  - only after `startTurnPhase` returns is the flag cleared and the log
 *    refreshed, so all accumulated entries appear together — after the
 *    phase UI, never before it.
 *
 * The Phaser-dependent renderer itself is covered by the browser test in
 * `activity-log-rendering.browser.test.ts`; the timing contract that drives
 * it is asserted here, in the node unit suite.
 *
 * AC2: entry content/order is untouched — only the timing of appearance.
 * AC3: the reduced-motion (legacy, non-deferred) path defers identically.
 * AC6: this file is the new coverage for the deferred-mutation path timing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
}));

import { finishTurnPresentation } from '../../src/scenes/MainStreetTurnControllerTurnFlow';
import type { TurnResult } from '../../src/MainStreetEngine';
import * as Engine from '../../src/MainStreetEngine';

// ── Fixtures ────────────────────────────────────────────────

interface SceneObserver {
  /** The `logDeferredUntilPhaseComplete` value observed on each post-turn refresh. */
  refreshFlags: boolean[];
  /** The value observed when `startTurnPhase` was entered. */
  startTurnPhaseFlag: boolean | null;
  /** The value observed on each post-`startTurnPhase` `refreshLog`. */
  refreshLogFlags: boolean[];
}

function makeResult(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    income: { total: 5 } as TurnResult['income'],
    incident: null,
    incidentCoinChange: 0,
    incidentRepChange: 0,
    gameResult: 'playing',
    finalScore: 0,
    newlyCompletedChallenges: [],
    choicePending: false,
    requiresDeferredClosing: false,
    ...overrides,
  } as TurnResult;
}

/**
 * Build a scene + controller-context pair whose refresh methods record the
 * deferral flag at call time, and whose `time.delayedCall` runs callbacks
 * synchronously so the turn flow completes within the test.
 */
function makeHarness() {
  const observer: SceneObserver = {
    refreshFlags: [],
    startTurnPhaseFlag: null,
    refreshLogFlags: [],
  };

  const scene: any = {
    state: { resourceBank: { coins: 0, reputation: 0 } },
    instructionText: { setText: vi.fn() },
    // The behaviour under test:
    logDeferredUntilPhaseComplete: false,
    // Force the non-animated path so `advanceTurn` schedules `finalizeTurn`
    // directly (the animator loop is irrelevant to the render timing).
    incomeCollectionActive: false,
    endOfTurnDeltasApplied: false,
    previousCoins: null,
    previousReputation: null,
    incidentRevealActive: false,
    tutorialController: { isActive: false },
    msRenderer: {
      refreshAllExceptStreet: vi.fn(() => {
        observer.refreshFlags.push(scene.logDeferredUntilPhaseComplete);
      }),
    },
    refreshAll: vi.fn(() => {
      observer.refreshFlags.push(scene.logDeferredUntilPhaseComplete);
    }),
    refreshLog: vi.fn(() => {
      observer.refreshLogFlags.push(scene.logDeferredUntilPhaseComplete);
    }),
    msLifecycleManager: { onTutorialActionComplete: vi.fn() },
    msAnimator: { animateIncidentReveal: vi.fn() },
    time: {
      now: 0,
      delayedCall: vi.fn((_ms: number, cb: () => void) => {
        cb();
        return {};
      }),
    },
  };

  const tcCtx: any = {
    scene,
    startTurnPhase: vi.fn(() => {
      observer.startTurnPhaseFlag = scene.logDeferredUntilPhaseComplete;
    }),
    handleGameOver: vi.fn(),
    presentEventChoiceDialog: vi.fn(),
    onSaveCheckpoint: vi.fn(),
  };

  return { scene, tcCtx, observer };
}

// ── Tests ───────────────────────────────────────────────────

describe('Deferred activity log rendering timing (MS-0MURBOD2E009SOM2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defers log rendering across the deferred-mutation closing until after startTurnPhase', () => {
    const { scene, tcCtx, observer } = makeHarness();

    finishTurnPresentation(tcCtx, makeResult({ requiresDeferredClosing: true }), false);

    // Every post-turn refresh happened while deferral was active, so the
    // newly-added end-of-turn entries were suppressed.
    expect(observer.refreshFlags.length).toBeGreaterThan(0);
    expect(observer.refreshFlags.every((flag) => flag === true)).toBe(true);

    // The upcoming/phase UI is displayed while the log is still deferred.
    expect(observer.startTurnPhaseFlag).toBe(true);

    // Only after the phase UI has been shown is the log rendered — and it is
    // rendered exactly once, with deferral already lifted.
    expect(observer.refreshLogFlags).toEqual([false]);
    expect(scene.logDeferredUntilPhaseComplete).toBe(false);
  });

  it('renders the accumulated log only once at the end of the deferred flow', () => {
    const { tcCtx, observer } = makeHarness();

    finishTurnPresentation(tcCtx, makeResult({ requiresDeferredClosing: true }), false);

    // No render happened before the phase UI (all suppressed); exactly one
    // render happens after it, so entries appear as a single batch.
    expect(observer.refreshFlags.filter((f) => f === false)).toHaveLength(0);
    expect(observer.refreshLogFlags.filter((f) => f === false)).toHaveLength(1);
  });

  it('defers log rendering on the legacy/reduced-motion path too', () => {
    const { scene, tcCtx, observer } = makeHarness();

    // requiresDeferredClosing: false mirrors the reduced-motion / tutorial /
    // replay legacy branch, where the closing already ran synchronously.
    finishTurnPresentation(tcCtx, makeResult({ requiresDeferredClosing: false }), false);

    expect(observer.refreshFlags.length).toBeGreaterThan(0);
    expect(observer.refreshFlags.every((flag) => flag === true)).toBe(true);
    expect(observer.startTurnPhaseFlag).toBe(true);
    expect(observer.refreshLogFlags).toEqual([false]);
    expect(scene.logDeferredUntilPhaseComplete).toBe(false);
  });

  it('does not defer when the turn ends the game before the phase UI is shown', () => {
    const { scene, tcCtx } = makeHarness();

    // A final (non-deferred) game-over result routes to handleGameOver and
    // returns before any of the deferral bookkeeping runs.
    finishTurnPresentation(
      tcCtx,
      makeResult({ requiresDeferredClosing: false, gameResult: 'win' }),
      false,
    );

    expect(tcCtx.handleGameOver).toHaveBeenCalledTimes(1);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();
    // The flag was never set, so the game-over overlay's own refresh renders
    // the closing log entries immediately (unchanged behaviour).
    expect(scene.logDeferredUntilPhaseComplete).toBe(false);
  });

  it('clears the deferral flag on the deferred game-over path (no stuck suppression)', () => {
    const { scene, tcCtx } = makeHarness();

    // Deferred closing that resolves the game as a win — no upcoming phase
    // follows, so the accumulated log must be flushed before the overlay.
    vi.mocked(Engine.finishDeferredTurnClosing).mockReturnValueOnce({
      ...makeResult({ requiresDeferredClosing: true }),
      gameResult: 'win',
      finalScore: 0,
      newlyCompletedChallenges: [],
      choicePending: false,
    });

    finishTurnPresentation(tcCtx, makeResult({ requiresDeferredClosing: true }), false);

    expect(tcCtx.handleGameOver).toHaveBeenCalledTimes(1);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();
    // The flag must not be left set — otherwise every later log refresh is
    // silently suppressed for the rest of the session.
    expect(scene.logDeferredUntilPhaseComplete).toBe(false);
    expect(scene.refreshLog).toHaveBeenCalled();
  });

  it('leaves deferral unset when the end-of-turn pauses on a pending event choice', () => {
    const { scene, tcCtx } = makeHarness();

    finishTurnPresentation(
      tcCtx,
      makeResult({ choicePending: true, requiresDeferredClosing: true }),
      false,
    );

    // The choice dialog blocks the closing; `startTurnPhase` is never reached,
    // so the deferral flag must not be left set (otherwise every later log
    // refresh would be suppressed).
    expect(tcCtx.presentEventChoiceDialog).toHaveBeenCalledTimes(1);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();
    expect(scene.logDeferredUntilPhaseComplete).toBe(false);
  });
});
