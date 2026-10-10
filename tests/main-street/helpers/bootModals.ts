/**
 * Shared browser-test helper: dismiss the blocking pre-game boot modals.
 *
 * Main Street's boot flow presents up to two full-screen input-blocking
 * modals after the scene is created:
 *
 * 1. the tutorial offer (`TutorialOfferModal`), and
 * 2. the "New Game" mode selector (`MainStreetNewGameOverlay`).
 *
 * A test that seeds the tutorial state as `skipped` answers the offer, so the
 * boot flow proceeds to the New Game selector. That selector is a full-screen
 * interactive backdrop: until it is dismissed, every synthetic pointer event
 * dispatched at the market row is hit-tested to the backdrop instead of the
 * card beneath, so a drag gesture never engages and the drag helpers exhaust
 * their retry deadline (MS-0MV1HABBG003CKXE / MS-0MV1HAOC8006SCON).
 *
 * The modal decision runs after the asynchronous campaign/checkpoint load, so
 * this polls rather than assuming the overlay is already visible when the
 * scene becomes active. When no modal is presented (replay boot or a resume
 * path) the helper returns without dismissing anything.
 *
 * @module tests/main-street/helpers/bootModals
 */

/** Minimal structural view of the New Game selector needed for dismissal. */
interface NewGameOverlayLike {
  readonly isVisible?: boolean;
  hide?: () => void;
}

/** Minimal structural view of the scene properties the helper touches. */
interface BootModalScene {
  newGameOverlay?: NewGameOverlayLike;
  newGameSelectionMade?: boolean;
}

/**
 * Dismiss the blocking boot modals so scene interactions reach their targets.
 *
 * @param scene - The live `MainStreetScene` (or a test double exposing the
 *   same properties).
 * @param timeoutMs - How long to wait for a modal to be presented before
 *   concluding none is due (default 5 000 ms).
 */
export async function dismissBootModals(scene: unknown, timeoutMs = 5_000): Promise<void> {
  const s = scene as BootModalScene;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (s.newGameOverlay?.isVisible) {
      // Mark the boot selector as answered so a late boot step cannot re-show
      // it, then dismiss it (the overlay's own confirm path does the same).
      s.newGameSelectionMade = true;
      s.newGameOverlay.hide?.();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
