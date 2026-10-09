/**
 * Main Street Tutorial E2E test — T22 banking day → T23 Triggering Events →
 * T26 Tutorial Complete.
 *
 * Walks the finale of the 26-step two-turn tutorial (CG-0MT53NXGZ004H5AE
 * + MS-0MT3JK16W006A66P): after building the Library (T20), the player ends
 * the day (T21), then ends the deliberate banking day (T22 — a week with
 * nothing to build, so the spare action banks and the banking hint fires),
 * plays the held Local Festival from the hand (T23, play-event gate), then
 * confirms Success and Failure (T24), Challenges (T25), and completes (T26)
 * with the "Let's play!" button.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Phaser from 'phaser';
import {
  bootGameWithTutorial,
  destroyGame,
  findPhaserTextByLabel,
  waitForTutorialOverlay,
  clickOverlayButtonByText,
  waitForOverlayVisible,
  getStepIndex,
  clickRequiredBusinessCard,
  clickRequiredEventCard,
  clickStreetSlot,
  clickEndTurn,
  clickEndTurnBankingHint,
  clickCommunityFavour,
  clickPlayHeldEvent,
  saveScreenshot,
  getOverlay,
} from '../main-street/helpers/main-street-tutorial-e2e';

let game: Phaser.Game | null = null;

async function waitForStartButton(scene: Phaser.Scene, timeoutMs = 8_000): Promise<Phaser.GameObjects.Text | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const btn = findPhaserTextByLabel(scene, '[ Start Tutorial ]');
    if (btn) return btn;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/**
 * Walk from T1 to the end of T21 (arrives on T22, the banking end-turn).
 * Covers the full 26-step flow including the end-turns (T6/T8/T11/T14/T17/
 * T19/T21).
 */
async function walkToT22(scene: Phaser.Scene): Promise<void> {
  await clickOverlayButtonByText('Next >'); // T1 -> T2
  await clickOverlayButtonByText('Next >'); // T2 -> T3
  await clickRequiredBusinessCard(scene);  // T3 move Laundromat -> T4
  await waitForOverlayVisible(5_000);
  await clickOverlayButtonByText('Next >'); // T4 -> T5
  await waitForOverlayVisible(5_000);
  await clickOverlayButtonByText('Next >'); // T5 -> T6
  await waitForOverlayVisible(5_000);
  await clickEndTurn(scene);               // T6 end -> T7
  await waitForOverlayVisible(10_000);
  await clickStreetSlot(scene, 0);        // T7 place Laundromat -> T8
  await new Promise((r) => setTimeout(r, 500));
  await waitForOverlayVisible(5_000);
  await clickEndTurn(scene);              // T8 (inserted end-turn) -> T9
  await waitForOverlayVisible(10_000);
  await clickOverlayButtonByText('Next >'); // T9 -> T10
  await waitForOverlayVisible(5_000);
  await clickRequiredEventCard(scene);   // T10 buy Local Festival -> T11
  await waitForOverlayVisible(5_000);
  await clickEndTurn(scene);              // T11 end -> T12
  await waitForOverlayVisible(10_000);
  await clickRequiredBusinessCard(scene); // T12 move Bookshop -> T13
  await waitForOverlayVisible(5_000);
  await clickOverlayButtonByText('Next >'); // T13 Costs -> T14
  await waitForOverlayVisible(5_000);
  await clickEndTurn(scene);              // T14 (inserted end-turn) -> T15
  await waitForOverlayVisible(10_000);
  await clickCommunityFavour(scene);       // T15 -> T16
  await waitForOverlayVisible(5_000);
  await clickStreetSlot(scene, 1);         // T16 place Bookshop -> T17
  await waitForOverlayVisible(5_000);
  await clickEndTurn(scene);               // T17 -> T18
  await waitForOverlayVisible(10_000);
  await clickRequiredBusinessCard(scene);  // T18 move Library -> T19
  await waitForOverlayVisible(5_000);
  await clickEndTurn(scene);               // T19 -> T20
  await waitForOverlayVisible(10_000);
  await clickStreetSlot(scene, 2);         // T20 place Library (next to Bookshop) -> T21
  await waitForOverlayVisible(5_000);
  await clickEndTurn(scene, false);         // T21 end -> T22 (banking day); do NOT auto-advance past T22
  await waitForOverlayVisible(10_000);
}

describe('Main Street Tutorial E2E — T22-T26', () => {
  beforeEach(async () => {
    game = await bootGameWithTutorial();
    const scene = game!.scene.getScene('MainStreetScene') as Phaser.Scene;
    const startBtn = await waitForStartButton(scene, 10_000);
    expect(startBtn).toBeTruthy();
    startBtn!.emit('pointerdown', {
      x: startBtn!.x, y: startBtn!.y, worldX: startBtn!.x, worldY: startBtn!.y,
    });
    await waitForTutorialOverlay(15_000);
  });

  afterEach(async () => {
    await destroyGame(game);
    game = null;
  });

  it('T22: banking day — ending the turn with a spare action shows the banking hint', async () => {
    const scene = game!.scene.getScene('MainStreetScene') as Phaser.Scene;
    await walkToT22(scene);
    expect(getStepIndex(scene)).toBe(21); // T22 banking end-turn

    // Ending T22 with the day's action unspent banks it and fires the hint;
    // dismissing the hint completes the step and advances to T23.
    await clickEndTurnBankingHint(scene);
    expect(getStepIndex(scene)).toBe(22); // T23 Triggering Events
    await saveScreenshot('t22-t23');
  }, 60_000);

  it('T23-T26: Triggering Events, Success and Failure, Challenges, and Tutorial Complete ("Let\'s play!")', async () => {
    const scene = game!.scene.getScene('MainStreetScene') as Phaser.Scene;
    await walkToT22(scene);
    await clickEndTurnBankingHint(scene);       // T22 -> T23
    await waitForOverlayVisible(5_000);
    expect(getStepIndex(scene)).toBe(22); // T23 Triggering Events

    // The held event (Local Festival) is in the hand
    const s = scene as any;
    const heldEvent = s.state.hand.find((c: any) => c.family === 'event');
    expect(heldEvent).toBeTruthy();

    await clickPlayHeldEvent(scene);            // T23 -> T24
    await waitForOverlayVisible(5_000);
    expect(getStepIndex(scene)).toBe(23); // T24 Success and Failure
    await clickOverlayButtonByText('Next >'); // T24 -> T25 Challenges
    await waitForOverlayVisible(5_000);
    expect(getStepIndex(scene)).toBe(24); // T25 Challenges
    await clickOverlayButtonByText('Next >'); // T25 -> T26 Tutorial Complete
    await waitForOverlayVisible(5_000);
    expect(getStepIndex(scene)).toBe(25); // T26 Tutorial Complete
    await saveScreenshot('t25-t26');
    // The completion button is now "Let's play!"
    await clickOverlayButtonByText('Let\'s play!');
    await new Promise((r) => setTimeout(r, 500));
    const finalOverlay = getOverlay();
    expect(finalOverlay).toBeFalsy();
    await saveScreenshot('tutorial-complete');
  }, 60_000);
});
