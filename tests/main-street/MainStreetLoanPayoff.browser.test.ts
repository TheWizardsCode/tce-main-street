/**
 * Loan payoff dialog — browser overlay tests (MS-0MW3SN0IT008TQU3)
 *
 * The browser half of parent AC 9 (parent `Notify when loan is paid off`,
 * MS-0MW1ZJDVE000MUID): it pins the **rendered** congratulation and its
 * dismissal, so depth, parenting and dismissal behaviour are fixed before the
 * renderer is written. It mirrors the bootstrap of
 * `tests/main-street/MainStreetLoanOverlay.browser.test.ts` and
 * `tests/main-street/turn-summary-bank-loan.browser.test.ts`.
 *
 * Agreed seam pinned here (the renderer sibling MS-0MW3SN2LK00537GN implements
 * to this contract):
 *
 * - `MainStreetScene.showLoanPayoffDialog(payoff, onDismiss)` — the public
 *   overlay method, matching `showLoanOfferDialog` / `showPiggybackDialog`.
 *   It accepts one {@link LoanPayoff} entry (as reported on
 *   `TurnResult.loanPayoffs`) and a single continuation.
 * - The renderer **derives its presentation context from the scene** —
 *   `replayMode`, the payoff's own `ownerId` as the seat, `state.players` and
 *   `state.gameResult` — and builds the copy through
 *   `buildLoanPayoffContent(payoff, ctx)` (`src/scenes/MainStreetLoanPayoffModel.ts`).
 *   No copy string is invented by the renderer, and the model's
 *   `shouldPresentLoanPayoff` gate decides suppression (never in replayMode,
 *   never for a non-human seat, never when the closing ended the run).
 * - Overlay conventions: `createOverlayBackground` / `createOverlayButton` from
 *   `@ui`, every element parented into `s.hudContainer`, depths 199 (backdrop)
 *   / 200 (box) / 201 (elements), every object tracked in `s.overlayObjects`,
 *   and instant appearance (no fade-in — reduced-motion safe).
 *
 * **Flipped from the red phase (landed).** The cases were authored `it.fails`
 * by the browser-test slice (MS-0MW3SN0IT008TQU3) while
 * `showLoanPayoffDialog` did not exist, and the renderer slice
 * (MS-0MW3SN2LK00537GN) flipped every one to a plain `it` now that the dialog
 * renders — leaving one as `it.fails` is itself a failure, so the pin cannot go
 * stale. This is the repo's documented red-phase convention
 * (`tests/main-street/hud-total-counting.test.ts`,
 * `tests/main-street/panel-opacity.browser.test.ts`).
 *
 * @module tests/main-street/MainStreetLoanPayoff.browser
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import type { LoanPayoff } from '../../src/MainStreetLoans';
import {
  buildLoanPayoffContent,
  type LoanPayoffContent,
} from '../../src/scenes/MainStreetLoanPayoffModel';

// ── Boot helpers (mirrors MainStreetLoanOverlay.browser.test.ts) ──

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

// ── The modelled payoff under test ──────────────────────────

/**
 * The payoff the engine reports for a €660 loan repaid at €110/week over six
 * weeks — the same figures the HUD loan line showed before the loan vanished.
 * Coins are whole numbers (integer economy), so no rounding is involved.
 */
const PAYOFF: LoanPayoff = Object.freeze({
  ownerId: 0,
  perTurnRepayment: 110,
  totalRepayment: 660,
  termTurns: 6,
});

/** The copy the single-player scene must render for {@link PAYOFF}. */
function expectedContent(): LoanPayoffContent {
  const content = buildLoanPayoffContent(PAYOFF, { seatId: PAYOFF.ownerId });
  expect(content).not.toBeNull();
  return content!;
}

/**
 * Fails with an explicit "renderer not written yet" reason during the red
 * phase, instead of an opaque `TypeError` from an absent method.
 */
function expectPayoffDialogSeam(s: SceneWithHud): void {
  expect(typeof s.showLoanPayoffDialog).toBe('function');
}

// ── Overlay inspection helpers ──────────────────────────────

function overlayObjects(s: SceneWithHud): Phaser.GameObjects.GameObject[] {
  return (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
}

function overlayTexts(s: SceneWithHud): Phaser.GameObjects.Text[] {
  return overlayObjects(s).filter(
    (o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text,
  );
}

/** All overlay-created text, joined for copy assertions. */
function renderedCopy(s: SceneWithHud): string {
  return overlayTexts(s)
    .map((t) => t.text)
    .join('\n');
}

/** The single interactive (button) overlay text, if any. */
function overlayButtons(s: SceneWithHud): Phaser.GameObjects.Text[] {
  return overlayTexts(s).filter((t) => t.input?.enabled === true);
}

/** Every overlay object parented into the HUD container. */
function hudList(s: SceneWithHud): Phaser.GameObjects.GameObject[] {
  return (s.hudContainer?.list ?? []) as Phaser.GameObjects.GameObject[];
}

// ── Tests ───────────────────────────────────────────────────

describe('Main Street loan payoff dialog overlay (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it(
    'renders the modelled copy instantly, parented into the HUD at depths 199/200/201 and tracked for dismissal',
    async () => {
      game = await bootGame();
      const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
      expectPayoffDialogSeam(s);

      const content = expectedContent();
      const createdBefore = overlayObjects(s).length;

      expect(s.showLoanPayoffDialog(PAYOFF, () => {})).toBe(true);

      // AC2: the rendered copy is the copy model's output — debt free, the
      // weekly amount no longer deducted, and the total repaid over the term.
      const copy = renderedCopy(s);
      expect(copy).toContain(content.headline);
      expect(copy).toContain('You are debt free!');
      content.body.forEach((line) => expect(copy).toContain(line));
      expect(copy).toContain('110 coins/week is no longer deducted.');
      expect(copy).toContain('660 coins repaid over 6 weeks.');

      // AC3: everything is created synchronously (no fade-in) and tracked.
      const created = overlayObjects(s).slice(createdBefore);
      expect(created.length).toBeGreaterThan(0);
      const createdTexts = created.filter(
        (o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text,
      );
      expect(createdTexts.length).toBeGreaterThan(0);

      // … parented into the HUD container …
      const hud = hudList(s);
      created.forEach((o) => expect(hud).toContain(o));

      // … at the agreed 199 / 200 / 201 depths only.
      const depths = created.map((o) => (o as { depth?: number }).depth);
      expect(depths).toContain(199);
      expect(depths).toContain(200);
      expect(depths).toContain(201);
      depths.forEach((depth) => expect([199, 200, 201]).toContain(depth));

      // Instant appearance (no fade-in): nothing animates the new elements and
      // every text is fully opaque on the very first frame — reduced-motion
      // safe by construction.
      created.forEach((o) => expect(s.tweens.getTweensOf(o)).toHaveLength(0));
      createdTexts.forEach((t) => expect(t.alpha).toBe(1));

      // AC4: a single dismiss action — no other button exists.
      const buttons = overlayButtons(s);
      expect(buttons).toHaveLength(1);
      expect(buttons[0].text).toBe(content.dismissLabel);
      expect(buttons[0].text).toBe('Continue');
      expect(buttons[0].depth).toBe(201);
    },
    30_000,
  );

  it(
    'a single dismiss action removes the overlay, clears the tracked objects and calls the continuation exactly once',
    async () => {
      game = await bootGame();
      const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
      expectPayoffDialogSeam(s);

      const content = expectedContent();
      const onDismiss = vi.fn();
      expect(s.showLoanPayoffDialog(PAYOFF, onDismiss)).toBe(true);

      const dismiss = overlayButtons(s).find((t) => t.text === content.dismissLabel);
      expect(dismiss).toBeDefined();
      expect(overlayTexts(s).some((t) => t.text === content.headline)).toBe(true);

      // AC4: one press dismisses and resumes the interrupted flow once.
      dismiss!.emit('pointerdown');
      expect(onDismiss).toHaveBeenCalledTimes(1);

      // The overlay is gone: nothing tracked, nothing left in the HUD and no
      // dialog text remains findable through the overlay bookkeeping.
      expect(overlayObjects(s)).toHaveLength(0);
      expect(overlayTexts(s)).toHaveLength(0);
      expect(hudList(s).some((o) => o === dismiss)).toBe(false);
    },
    30_000,
  );

  it(
    'presents no overlay when the payoff is suppressed in replayMode',
    async () => {
      game = await bootGame();
      const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
      expectPayoffDialogSeam(s);

      const before = overlayObjects(s).length;
      s.replayMode = true;
      try {
        expect(s.showLoanPayoffDialog(PAYOFF, () => {})).toBe(false);
        expect(renderedCopy(s)).not.toContain('debt free');
      } finally {
        s.replayMode = false;
      }
      expect(overlayObjects(s)).toHaveLength(before);
    },
    30_000,
  );

  it(
    'presents no overlay when the payoff belongs to a non-human seat',
    async () => {
      game = await bootGame();
      const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
      expectPayoffDialogSeam(s);

      const before = overlayObjects(s).length;
      const savedPlayers = s.state.players;
      // Two seats, the human at index 0 and an AI opponent at index 1: the AI
      // seat's payoff must change nothing visible for the player (parent AC6).
      s.state.players = [
        { playerId: 0, coins: 0, reputation: 0, hand: [], staffCards: [], actionBudget: 1, controller: 'human' },
        { playerId: 1, coins: 0, reputation: 0, hand: [], staffCards: [], actionBudget: 1, controller: 'ai' },
      ];
      try {
        expect(s.showLoanPayoffDialog({ ...PAYOFF, ownerId: 1 }, () => {})).toBe(false);
        expect(renderedCopy(s)).not.toContain('debt free');
      } finally {
        s.state.players = savedPlayers;
      }
      expect(overlayObjects(s)).toHaveLength(before);
    },
    30_000,
  );

  it(
    'reports nothing presented and never invokes the continuation without an overlay surface (headless)',
    async () => {
      game = await bootGame();
      const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
      expectPayoffDialogSeam(s);

      const before = overlayObjects(s).length;
      const onDismiss = vi.fn();
      const manager = s.msOverlayManager;
      s.msOverlayManager = undefined;
      try {
        // AC4 delegation contract: with no overlay manager there is nothing to
        // draw, so the caller — not a phantom dismissal — resumes the flow.
        expect(s.showLoanPayoffDialog(PAYOFF, onDismiss)).toBe(false);
      } finally {
        s.msOverlayManager = manager;
      }
      expect(onDismiss).not.toHaveBeenCalled();
      expect(overlayObjects(s)).toHaveLength(before);
      expect(renderedCopy(s)).not.toContain('debt free');
    },
    30_000,
  );
});
