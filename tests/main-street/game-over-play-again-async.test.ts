/**
 * MS-0MW6H5R340033GJJ — late game-over presentation after a Play Again restart.
 *
 * `handleGameOver` persists campaign progress asynchronously and only presents
 * the game-over overlay from the `updateCampaignProgress().then(...)` callback.
 * If the scene restarts while that write is still in flight, the callback used
 * to run against the freshly restarted scene and re-present the finished run's
 * game-over overlay on it — exactly the "text from the Play Again dialog
 * remained" symptom.
 *
 * The fix captures the scene's monotonic `sceneRestartGeneration` before the
 * async write and discards the presentation when the generation changed. These
 * tests drive the real `handleGameOver` with a deferred promise: the deferred
 * case is RED before the fix (the overlay is presented after the restart) and
 * GREEN after it; the control case pins that a normal game over still presents.
 *
 * @module tests/main-street/game-over-play-again-async
 */

import { describe, expect, it, vi } from 'vitest';

import { handleGameOver } from '../../src/scenes/MainStreetTurnControllerTurnFlow';
import type { TurnResult } from '../../src/MainStreetEngine';

/** Minimal game-over `TurnResult` (a competitive-style loss). */
function lossResult(): TurnResult {
  return {
    income: {
      total: 0,
      breakdown: [],
      handSynergyTotal: 0,
      phaseBreakdown: { perSlotBreakdown: [], handSynergyTotal: 0 },
    },
    incident: null,
    incidentCoinChange: 0,
    incidentRepChange: 0,
    finalScore: 0,
    gameResult: 'loss',
    newlyCompletedChallenges: [],
    choicePending: false,
  };
}

/**
 * Minimal scene/context surface consumed by `handleGameOver`. No Phaser and no
 * recorder: `finalizeMainStreetTranscript` returns null, so the transcript
 * branch is skipped, and the bailout check only reads `state.pendingLoanOffer`.
 */
function makeContext(updateCampaignProgress: () => Promise<void>) {
  let generation = 1;
  const showGameOverOverlay = vi.fn();
  const scene: any = {
    state: { pendingLoanOffer: null },
    campaign: { unlockedTiers: [] },
    updateStats: vi.fn(),
    updateCampaignProgress: vi.fn(updateCampaignProgress),
    showGameOverOverlay,
    get sceneRestartGeneration() {
      return generation;
    },
    set sceneRestartGeneration(next: number) {
      generation = next;
    },
  };
  const tcCtx: any = {
    scene,
    onGameEnd: vi.fn(),
  };
  return { scene, tcCtx, showGameOverOverlay };
}

/** Flush pending microtasks and zero-delay timers. */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('handleGameOver — late presentation after a Play Again restart', () => {
  it('does not present the game-over overlay when the scene restarts while campaign progress persists', async () => {
    let resolveProgress!: () => void;
    const progress = new Promise<void>((resolve) => {
      resolveProgress = resolve;
    });
    const { scene, tcCtx, showGameOverOverlay } = makeContext(() => progress);

    handleGameOver(tcCtx, lossResult());

    // A Play Again restart happens while the campaign write is still pending:
    // createScene bumps the generation before clearing the overlay bookkeeping.
    scene.sceneRestartGeneration = 2;
    resolveProgress();
    await flushAsync();

    expect(showGameOverOverlay).not.toHaveBeenCalled();
  });

  it('presents the game-over overlay once when no restart happened (control)', async () => {
    let resolveProgress!: () => void;
    const progress = new Promise<void>((resolve) => {
      resolveProgress = resolve;
    });
    const { tcCtx, showGameOverOverlay } = makeContext(() => progress);

    handleGameOver(tcCtx, lossResult());
    resolveProgress();
    await flushAsync();

    expect(showGameOverOverlay).toHaveBeenCalledTimes(1);
    expect(showGameOverOverlay).toHaveBeenCalledWith(lossResult(), []);
  });
});
