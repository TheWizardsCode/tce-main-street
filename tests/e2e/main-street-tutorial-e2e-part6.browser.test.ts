/**
 * Main Street Tutorial E2E test — T22 Triggering Events → T25 Tutorial
 * Complete.
 *
 * Walks the finale of the 25-step two-turn tutorial (CG-0MT53NXGZ004H5AE
 * + MS-0MT3JK16W006A66P): after building the Library (T20), the player ends
 * the day (T21), plays the held Local Festival from the hand (T22,
 * play-event gate), then confirms Success and Failure (T23), Challenges
 * (T24), and completes (T25) with the "Let's play!" button.
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
 * Walk from T1 to the end of T21 (arrives on T22 Triggering Events).
 * Covers the full 25-step flow including the end-turns (T6/T8/T11/T14/T17/
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
  await clickEndTurn(scene);               // T21 end -> T22
  await waitForOverlayVisible(10_000);
}

describe('Main Street Tutorial E2E — T22-T25', () => {
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

  it('T22: Triggering Events — play the held Local Festival from the hand', async () => {
    const scene = game!.scene.getScene('MainStreetScene') as Phaser.Scene;
    await walkToT22(scene);
    expect(getStepIndex(scene)).toBe(21); // T22

    // The held event (Local Festival) is in the hand
    const s = scene as any;
    const heldEvent = s.state.hand.find((c: any) => c.family === 'event');
    expect(heldEvent).toBeTruthy();

    await clickPlayHeldEvent(scene);
    await waitForOverlayVisible(5_000);
    expect(getStepIndex(scene)).toBe(22); // T23 Success and Failure
    await saveScreenshot('t22-t23');
  }, 60_000);

  it('T23-T25: Success and Failure, Challenges, and Tutorial Complete ("Let\'s play!")', async () => {
    const scene = game!.scene.getScene('MainStreetScene') as Phaser.Scene;
    await walkToT22(scene);
    await clickPlayHeldEvent(scene);             // T22 -> T23
    await waitForOverlayVisible(5_000);
    expect(getStepIndex(scene)).toBe(22);
    await clickOverlayButtonByText('Next >'); // T23 -> T24
    await waitForOverlayVisible(5_000);
    expect(getStepIndex(scene)).toBe(23);
    await clickOverlayButtonByText('Next >'); // T24 -> T25
    await waitForOverlayVisible(5_000);
    expect(getStepIndex(scene)).toBe(24);
    await saveScreenshot('t24-t25');
    // The completion button is now "Let's play!"
    await clickOverlayButtonByText('Let\'s play!');
    await new Promise((r) => setTimeout(r, 500));
    const finalOverlay = getOverlay();
    expect(finalOverlay).toBeFalsy();
    await saveScreenshot('tutorial-complete');
  }, 60_000);
});
