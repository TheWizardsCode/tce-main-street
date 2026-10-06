/**
 * Regression coverage for MS-0MUTTVR5K002ZDUP.
 *
 * The producer audit rejected the epic because, after playing a competitive
 * game and returning to the menu / replaying, the boot-time "New Game"
 * selector was not offered again. Phaser reuses the scene instance across
 * `scene.restart()` (the game-over `[ Play Again ]` button) and
 * `scene.start()` (menu round-trip), so the `newGameSelectionMade` guard
 * survived and blocked the selector on every subsequent boot.
 *
 * These tests pin the two halves of the fix:
 *  - `showTutorialOfferOrDeferredBanner` shows the selector once per boot and
 *    suppresses repeat calls while the flag is set;
 *  - `resetNewGameSelectionFlag` (invoked from the scene's `create()`) clears
 *    that guard so the next boot presents the selector again.
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

function makeContext(): { scene: FakeScene; applyNewGameSelection: ReturnType<typeof vi.fn> } {
  const scene: FakeScene = {
    replayMode: false,
    newGameOverlay: { show: vi.fn() },
    // No tutorial modal: `showTutorialOfferOnly` returns false and plays the
    // deferred banner, which is irrelevant to the selector guard.
    playDeferredWeekBanner: vi.fn(),
  };
  return { scene, applyNewGameSelection: vi.fn() };
}

describe('New Game selector boot guard (MS-0MUTTVR5K002ZDUP)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the selector once per boot and suppresses it while the flag is set', () => {
    const { scene } = makeContext();

    expect(showTutorialOfferOrDeferredBanner({ scene } as any, {} as any)).toBe(true);
    expect(scene.newGameOverlay?.show).toHaveBeenCalledTimes(1);
    expect(scene.newGameSelectionMade).toBe(true);

    // A second call during the same boot must not re-present the selector.
    showTutorialOfferOrDeferredBanner({ scene } as any, {} as any);
    expect(scene.newGameOverlay?.show).toHaveBeenCalledTimes(1);
  });

  it('presents the selector again after resetNewGameSelectionFlag (scene restart)', () => {
    const { scene } = makeContext();

    showTutorialOfferOrDeferredBanner({ scene } as any, {} as any);
    expect(scene.newGameOverlay?.show).toHaveBeenCalledTimes(1);

    // `create()` calls this on every scene boot (Play Again / menu round-trip).
    resetNewGameSelectionFlag(scene);
    expect(scene.newGameSelectionMade).toBe(false);

    expect(showTutorialOfferOrDeferredBanner({ scene } as any, {} as any)).toBe(true);
    expect(scene.newGameOverlay?.show).toHaveBeenCalledTimes(2);
  });

  it('never presents the selector in replay mode', () => {
    const { scene } = makeContext();
    scene.replayMode = true;

    showTutorialOfferOrDeferredBanner({ scene } as any, {} as any);
    expect(scene.newGameOverlay?.show).not.toHaveBeenCalled();
    expect(scene.newGameSelectionMade).toBeUndefined();
  });
});
