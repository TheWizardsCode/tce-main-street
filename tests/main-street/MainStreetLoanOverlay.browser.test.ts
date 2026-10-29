/**
 * Bailout loan offer dialog — browser overlay tests (MS-0MVPWSBLG006YMBA)
 *
 * Verifies the loan offer overlay in a real Phaser scene (parent
 * MS-0MVL6DZI0000F6CG, Bank Loans):
 *
 * 1. The dialog renders every loan option with its per-turn and total
 *    repayment plus a Decline choice, instantly (AC1).
 * 2. Overlay pattern compliance — backdrop 199 / box 200 / elements 201, ALL
 *    elements parented into `hudContainer` and pushed into `s.overlayObjects`
 *    for dismissal, reduced-motion safe (instant, no fade-in).
 * 3. One interactive button per option plus the Decline button; pressing a
 *    button dismisses the dialog and invokes its handler exactly once (AC2).
 *
 * The option-row content itself is unit-tested Phaser-free in
 * `MainStreetLoanOverlay.test.ts`; this suite covers the rendering path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { DEFAULT_LOAN_OPTIONS } from '../../src/MainStreetLoans';
import { buildLoanOfferModel } from '../../src/scenes/MainStreetLoanOverlayModel';

// ── Boot helpers (mirrors turn-summary-dialog.browser.test.ts) ──

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();

  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: Phaser.CANVAS });
  await waitForScene(game, 'MainStreetScene');
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

type SceneWithHud = Phaser.Scene & Record<string, any>;

function hudTexts(s: SceneWithHud): Phaser.GameObjects.Text[] {
  const list = s.hudContainer?.list;
  if (!list) return [];
  return list.filter(
    (c: Phaser.GameObjects.GameObject) => c instanceof Phaser.GameObjects.Text,
  ) as Phaser.GameObjects.Text[];
}

/** Finds a text element created by the overlay itself (in `overlayObjects`). */
function overlayText(s: SceneWithHud, label: string): Phaser.GameObjects.Text | undefined {
  const objects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
  return objects.find(
    (o) => o instanceof Phaser.GameObjects.Text && (o as Phaser.GameObjects.Text).text === label,
  ) as Phaser.GameObjects.Text | undefined;
}

/** All overlay-created text objects whose label contains `fragment`. */
function overlayTextContaining(s: SceneWithHud, fragment: string): Phaser.GameObjects.Text[] {
  const objects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
  return objects.filter(
    (o) => o instanceof Phaser.GameObjects.Text && (o as Phaser.GameObjects.Text).text.includes(fragment),
  ) as Phaser.GameObjects.Text[];
}

/** The default bailout offer (300/3, 600/6, 1000/10 at 10% flat interest). */
function makeModel() {
  const model = buildLoanOfferModel({
    pendingLoanOffer: {
      ownerId: 0,
      reason: 'bankruptcy',
      options: DEFAULT_LOAN_OPTIONS.map((option) => ({ ...option })),
    },
    config: { loanInterestRate: 0.1 },
  } as any);
  expect(model).not.toBeNull();
  return model!;
}

describe('Main Street bailout loan offer dialog overlay (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('renders one button per option (per-turn + total repayment) plus Decline, with 199/200/201 depths and HUD parenting', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    const model = makeModel();
    s.showLoanOfferDialog(model, () => {}, () => {});

    // Appears instantly (no fade-in): the dialog is present synchronously.
    const title = overlayText(s, 'Bank Loan Offer');
    expect(title).toBeDefined();
    expect(title!.depth).toBe(201);
    expect(overlayTextContaining(s, "You cannot cover this turn's costs").length).toBeGreaterThan(0);
    expect(overlayTextContaining(s, 'deducted at the end of each turn').length).toBeGreaterThan(0);

    // Every option row is rendered with its per-turn and total repayment.
    expect(overlayText(s, model.rows[0].label)).toBeDefined();
    expect(overlayText(s, model.rows[1].label)).toBeDefined();
    expect(overlayText(s, model.rows[2].label)).toBeDefined();
    expect(model.rows[0].label).toContain('€110/turn');
    expect(model.rows[0].label).toContain('€330 total');
    expect(model.rows[0].label).toContain('3 turns');

    // A Decline choice is always offered.
    expect(overlayText(s, model.declineLabel)).toBeDefined();

    // Backdrop 199 / box 200 exist; every element lives in the HUD.
    const overlayObjects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
    const depths = overlayObjects.map((o) => (o as any).depth);
    expect(depths).toContain(199);
    expect(depths).toContain(200);

    const overlayTexts = overlayObjects.filter(
      (o) => o instanceof Phaser.GameObjects.Text,
    ) as Phaser.GameObjects.Text[];
    expect(overlayTexts.length).toBeGreaterThan(0);
    const allHudTexts = hudTexts(s);
    for (const text of overlayTexts) {
      expect(allHudTexts).toContain(text);
    }

    // One interactive button per option, plus Decline (AC1: a chosen button
    // per option and a Decline choice).
    const interactiveTexts = overlayTexts.filter((t) => t.input?.enabled === true);
    expect(interactiveTexts).toHaveLength(model.rows.length + 1);
  }, 30_000);

  it('pressing an option accepts that row once and dismisses the dialog', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    const model = makeModel();
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    s.showLoanOfferDialog(model, onAccept, onDecline);

    const optionBtn = overlayText(s, model.rows[1].label)!;
    expect(optionBtn.depth).toBe(201);
    optionBtn.emit('pointerdown');

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(1);
    expect(onDecline).not.toHaveBeenCalled();

    // Dismissed for good: the overlay is released and its elements destroyed.
    expect((s.overlayObjects ?? []).length).toBe(0);
    expect(overlayText(s, model.rows[0].label)).toBeUndefined();
    expect(overlayText(s, model.declineLabel)).toBeUndefined();
  }, 30_000);

  it('pressing Decline invokes only the decline handler and dismisses', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    const model = makeModel();
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    s.showLoanOfferDialog(model, onAccept, onDecline);

    overlayText(s, model.declineLabel)!.emit('pointerdown');

    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
    expect((s.overlayObjects ?? []).length).toBe(0);
    expect(overlayText(s, model.declineLabel)).toBeUndefined();
  }, 30_000);
});
