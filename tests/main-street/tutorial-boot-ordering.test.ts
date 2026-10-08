/**
 * Boot-ordering decision tests (MS-0MV0319CV005O5OM).
 *
 * Test-first slice of MS-0MV02N2F40069LPY ("Ask about the tutorial before the
 * single-player/competitive choice"). At boot the tutorial offer must be the
 * first blocking modal: the Single-player/Competitive selector is presented
 * only once the offer is answered (skipped) or when the offer is ineligible.
 *
 * The reorder landed in the dependent item MS-0MV0319OC002H15F; the
 * ordering assertions below are now plain `it` (they were red-phase
 * `it.fails` while the reorder was in flight). All of them must hold.
 * Assertions that hold before and after the reorder are also plain `it`,
 * guarding against regressions.
 *
 * Mirrors the fake-scene pattern in
 * `tests/main-street/competitive-new-game-restart.test.ts`: no Phaser is
 * required — `showTutorialOfferOrDeferredBanner` only touches the scene's
 * overlay/modal seams and the lifecycle context's `applyNewGameSelection`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@ui', () => ({
  createOverlayButton: () => ({}),
  createOverlayDialog: () => ({
    contentX: 0,
    contentY: 0,
    boxY: 0,
    boxHeight: 0,
    depthBase: 0,
    close: () => {},
  }),
}));

import { resetNewGameSelectionFlag } from '../../src/scenes/MainStreetNewGameOverlay';
import { showTutorialOfferOrDeferredBanner } from '../../src/scenes/MainStreetLifecycleManagerTutorial';

interface FakeScene {
  replayMode: boolean;
  newGameOverlay?: { show: ReturnType<typeof vi.fn> };
  tutorialOfferModal?: { showIfEligible: ReturnType<typeof vi.fn> };
  playDeferredWeekBanner: ReturnType<typeof vi.fn>;
  newGameSelectionMade?: boolean;
}

interface Harness {
  scene: FakeScene;
  lmCtx: any;
  applyNewGameSelection: ReturnType<typeof vi.fn>;
}

/**
 * Builds a fake scene whose tutorial-offer modal eligibility is controlled by
 * `offerEligible`, mirroring the production seams consumed by
 * `showTutorialOfferOrDeferredBanner`.
 */
function makeHarness(offerEligible = true): Harness {
  const applyNewGameSelection = vi.fn();
  const scene: FakeScene = {
    replayMode: false,
    newGameOverlay: { show: vi.fn() },
    tutorialOfferModal: { showIfEligible: vi.fn(() => offerEligible) },
    playDeferredWeekBanner: vi.fn(),
  };
  return {
    scene,
    lmCtx: { scene, applyNewGameSelection },
    applyNewGameSelection,
  };
}

describe('tutorial-offer boot ordering (MS-0MV0319CV005O5OM)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Offer eligible: the offer is the first blocking modal ─────────────

  it('presents the tutorial offer first and never shows the mode selector', () => {
    const { scene, lmCtx } = makeHarness(true);

    const shown = showTutorialOfferOrDeferredBanner(lmCtx, {}, undefined);

    expect(shown).toBe(true);
    expect(scene.tutorialOfferModal!.showIfEligible).toHaveBeenCalledTimes(1);
    expect(scene.newGameOverlay!.show).not.toHaveBeenCalled();
  });

  it('does not show the mode selector when the player starts the tutorial', () => {
    const { scene, lmCtx } = makeHarness(true);

    // Starting the tutorial leaves the offer eligible (`not_seen`) and starts
    // the scripted single-player flow; the reordered boot flow must not fall
    // through to the mode selector for that boot.
    showTutorialOfferOrDeferredBanner(lmCtx, {}, undefined);
    showTutorialOfferOrDeferredBanner(lmCtx, {}, undefined);

    expect(scene.newGameOverlay!.show).not.toHaveBeenCalled();
  });

  it('does not play the deferred week banner while the offer is waiting', () => {
    const { scene, lmCtx } = makeHarness(true);

    showTutorialOfferOrDeferredBanner(lmCtx, {}, undefined);

    expect(scene.playDeferredWeekBanner).not.toHaveBeenCalled();
  });

  // ── Skip / ineligible: the selector is presented next ─────────────────

  it('presents the mode selector next after the offer is skipped', () => {
    const { scene, lmCtx } = makeHarness(true);

    // First boot decision: the offer is the blocking modal.
    showTutorialOfferOrDeferredBanner(lmCtx, {}, undefined);
    expect(scene.newGameOverlay!.show).not.toHaveBeenCalled();

    // "Skip for now" persists `skipped`, so the offer is no longer eligible
    // and the boot flow continues to the mode selector.
    scene.tutorialOfferModal!.showIfEligible.mockReturnValue(false);
    showTutorialOfferOrDeferredBanner(lmCtx, {}, undefined);

    expect(scene.newGameOverlay!.show).toHaveBeenCalledTimes(1);
  });

  it('shows the mode selector first when the offer is ineligible', () => {
    // Ineligible covers completed / already-skipped / replay / disabled. The
    // eligibility decision itself is pinned by
    // `tests/main-street/tutorial-offer-modal.test.ts`; here the modal is
    // simply reported ineligible and the ordering is asserted.
    const { scene, lmCtx } = makeHarness(false);

    showTutorialOfferOrDeferredBanner(lmCtx, {}, undefined);

    expect(scene.tutorialOfferModal!.showIfEligible).toHaveBeenCalledTimes(1);
    expect(scene.newGameOverlay!.show).toHaveBeenCalledTimes(1);
    expect(
      scene.tutorialOfferModal!.showIfEligible.mock.invocationCallOrder[0],
    ).toBeLessThan(scene.newGameOverlay!.show.mock.invocationCallOrder[0]);
  });

  // ── Mode confirmation: selection applied, banner deferred ─────────────

  it('applies the selection and plays the deferred banner when the mode is confirmed', () => {
    const { scene, lmCtx, applyNewGameSelection } = makeHarness(false);

    showTutorialOfferOrDeferredBanner(lmCtx, {}, undefined);
    expect(scene.playDeferredWeekBanner).not.toHaveBeenCalled();

    const { onConfirm } = scene.newGameOverlay!.show.mock.calls[0][0];
    onConfirm({
      mode: 'competitive',
      opponents: [{ strategy: 'Random', difficulty: 'Easy' }],
    });

    expect(applyNewGameSelection).toHaveBeenCalledTimes(1);
    expect(scene.playDeferredWeekBanner).toHaveBeenCalledTimes(1);
  });

  // ── Scene-restart / menu round-trip regression guard ──────────────────

  it('presents the mode selector once per boot and again after a scene restart', () => {
    const { scene, lmCtx } = makeHarness(false);

    showTutorialOfferOrDeferredBanner(lmCtx, {}, undefined);
    expect(scene.newGameOverlay!.show).toHaveBeenCalledTimes(1);
    expect(scene.newGameSelectionMade).toBe(true);

    // A second decision during the same boot must not re-present the selector.
    showTutorialOfferOrDeferredBanner(lmCtx, {}, undefined);
    expect(scene.newGameOverlay!.show).toHaveBeenCalledTimes(1);

    // `create()` resets the guard on `scene.restart()` / `scene.start()`.
    resetNewGameSelectionFlag(scene);
    expect(scene.newGameSelectionMade).toBe(false);

    showTutorialOfferOrDeferredBanner(lmCtx, {}, undefined);
    expect(scene.newGameOverlay!.show).toHaveBeenCalledTimes(2);
  });

  it('re-presents the tutorial offer after a scene restart', () => {
    const { scene, lmCtx } = makeHarness(true);

    showTutorialOfferOrDeferredBanner(lmCtx, {}, undefined);
    expect(scene.tutorialOfferModal!.showIfEligible).toHaveBeenCalledTimes(1);

    resetNewGameSelectionFlag(scene);

    showTutorialOfferOrDeferredBanner(lmCtx, {}, undefined);
    expect(scene.tutorialOfferModal!.showIfEligible).toHaveBeenCalledTimes(2);
  });
});
