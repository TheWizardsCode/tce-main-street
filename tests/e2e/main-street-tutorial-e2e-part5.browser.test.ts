/**
 * Main Street Tutorial E2E test — T15: Community Favour → T16: Place the
 * Bookshop (listed cost) → T17: End this turn → T18: Move the Library to
 * hand → T19: End this turn → T20: Build a Library next to the Bookshop
 * (synergy, listed cost).
 *
 * Walks the second half of the two-turn plan-ahead flow
 * (CG-0MT53NXGZ004H5AE). MS-0MT3JK16W006A66P merged the former standalone
 * Community-Favour day into the Bookshop-placement day: the favour is FREE
 * (CG-0MSTOATDQ005XDET), so the Bookshop is placed BEFORE the day ends
 * instead of closing a day without spending its action.
 * Step IDs follow the 25-step tutorial (T17/T19/T21 are the remaining
 * end-turns after T6/T8/T11/T14).
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
  clickStreetSlotExpectRejected,
  clickEndTurn,
  clickCommunityFavour,
  saveScreenshot,
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

/** Walk from T1 to the end of T14 (arrives on T15 Community Favour). */
async function walkToT15(scene: Phaser.Scene): Promise<void> {
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
}

/**
 * Walk from T1 to the end of T19 (arrives on T20 — place the Library next
 * to the Bookshop). Bookshop sits at slot 1 (placed at T16).
 */
async function walkToT20(scene: Phaser.Scene): Promise<void> {
  await walkToT15(scene);
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
}

describe('Main Street Tutorial E2E — T15-T20', () => {
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

  it('T15: Community Favour rep→coins exchange advances to T16', async () => {
    const scene = game!.scene.getScene('MainStreetScene') as Phaser.Scene;
    const s = scene as any;
    await walkToT15(scene);
    expect(getStepIndex(scene)).toBe(14); // T15 Community Favour

    const coinsBefore = s.state.resourceBank.coins;
    const repBefore = s.state.resourceBank.reputation;
    await clickCommunityFavour(scene);
    await waitForOverlayVisible(5_000);

    // The exchange spent 2 rep and gained 3 coins; the gate is spent.
    expect(s.state.favourUsedThisTurn).toBe(true);
    expect(s.state.resourceBank.coins).toBe(coinsBefore + 300);
    expect(s.state.resourceBank.reputation).toBe(repBefore - 200);
    expect(getStepIndex(scene)).toBe(15); // T16 Place the Bookshop
    await saveScreenshot('t15-favour-t16');
  }, 30_000);

  it('T16→T17: the Bookshop is placed for its listed cost, then the day ends', async () => {
    const scene = game!.scene.getScene('MainStreetScene') as Phaser.Scene;
    const s = scene as any;
    await walkToT15(scene);
    expect(getStepIndex(scene)).toBe(14);
    await clickCommunityFavour(scene); // T15 -> T16
    await waitForOverlayVisible(5_000);
    expect(getStepIndex(scene)).toBe(15); // T16 Place the Bookshop

    // T16: place the held Bookshop at LISTED 300 (×100, plan-ahead, not premium),
    // using the day's action the free favour left available.
    const coinsBeforeB = s.state.resourceBank.coins;
    await clickStreetSlot(scene, 1);
    await waitForOverlayVisible(5_000);
    expect(getStepIndex(scene)).toBe(16); // T17 End this turn
    expect(s.state.streetGrid[1]?.id.startsWith('biz-bookshop')).toBe(true);
    expect(s.state.resourceBank.coins).toBe(coinsBeforeB - 300);
    await saveScreenshot('t16-place-bookshop');

    // T17 closes the day now that its action has been spent.
    await clickEndTurn(scene);
    await waitForOverlayVisible(10_000);
    expect(getStepIndex(scene)).toBe(17); // T18 Move the Library to hand
  }, 30_000);

  it('T20: Build a Library — place next to the Bookshop advances to T21', async () => {
    const scene = game!.scene.getScene('MainStreetScene') as Phaser.Scene;
    const s = scene as any;
    await walkToT20(scene);
    expect(getStepIndex(scene)).toBe(19); // T20 Build a Library

    const library = s.state.market.cards.find((c: any) => c.id.startsWith('cs-library'))
      ?? s.state.hand.find((c: any) => c.id.startsWith('cs-library'));
    expect(library).toBeTruthy();

    // Place the Library next to the Bookshop (slot 1 → slot 2 orthogonal;
    // 8-way adjacency). Listed cost 400 (×100).
    const coinsBeforeL = s.state.resourceBank.coins;
    await clickStreetSlot(scene, 2);
    await waitForOverlayVisible(5_000);
    expect(getStepIndex(scene)).toBe(20); // T21 End this turn
    expect(s.state.streetGrid[2]?.id.startsWith('cs-library')).toBe(true);
    expect(s.state.resourceBank.coins).toBe(coinsBeforeL - 400);
    await saveScreenshot('t20-t21');
  }, 30_000);

  it('T20: diagonal placement next to the Bookshop is accepted (8-way adjacency)', async () => {
    const scene = game!.scene.getScene('MainStreetScene') as Phaser.Scene;
    await walkToT20(scene);
    expect(getStepIndex(scene)).toBe(19);

    // Bookshop is at slot 1 (from T16). Slot 5 is diagonal (row 1, col 0) —
    // Chebyshev distance 1, so the 8-way "next to" rule accepts it.
    await clickStreetSlot(scene, 5);
    await waitForOverlayVisible(5_000);
    expect(getStepIndex(scene)).toBe(20); // T21 End this turn
    const s = scene as any;
    expect(s.state.streetGrid[5]?.id.startsWith('cs-library')).toBe(true);
    await saveScreenshot('t20-diagonal-t21');
  }, 30_000);

  it('T20: non-adjacent placement is rejected with feedback and does not soft-lock', async () => {
    const scene = game!.scene.getScene('MainStreetScene') as Phaser.Scene;
    await walkToT20(scene);
    expect(getStepIndex(scene)).toBe(19);

    const s = scene as any;
    // Bookshop is at slot 1 (from T16). Slot 4 is EMPTY but neither
    // orthogonally nor diagonally adjacent (Chebyshev distance 3) — the
    // click must be rejected with the synergy-partner instruction message
    // (blocked-move feedback, CG-0MSP26K6U001PXT8 AC-2).
    expect(s.state.streetGrid[4]).toBeNull();
    await clickStreetSlotExpectRejected(scene, 4);

    // User-facing blocked-move feedback names the synergy partner card.
    const start = Date.now();
    while (
      Date.now() - start < 5_000 &&
      !String(s.instructionText?.text ?? '').includes('next to')
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(String(s.instructionText?.text ?? '')).toContain('next to');

    // No soft-lock regression: the slot stays empty, the Library stays in
    // hand, and the tutorial is still on T20 so the player can retry.
    expect(s.state.streetGrid[4]).toBeNull();
    expect(s.state.hand.some((c: any) => c.id.startsWith('cs-library'))).toBe(true);
    expect(getStepIndex(scene)).toBe(19);

    // Retry on a valid DIAGONAL slot (7, Chebyshev neighbour of slot 1)
    // completes T20 — proving the rejection did not break the flow.
    await clickStreetSlot(scene, 7);
    await waitForOverlayVisible(5_000);
    expect(getStepIndex(scene)).toBe(20); // T21 End this turn
    expect(s.state.streetGrid[7]?.id.startsWith('cs-library')).toBe(true);
    await saveScreenshot('t20-reject-retry');
  }, 30_000);
});
