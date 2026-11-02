/**
 * Main Street: Bailout Loan Offer overlay (Phaser)
 *
 * Renders the bankruptcy bailout dialog (MS-0MVPWSBLG006YMBA, parent
 * MS-0MVL6DZI0000F6CG): one button per presented loan option — each showing
 * its per-turn and total repayment — plus a Decline action. The content comes
 * from the Phaser-free {@link buildLoanOfferModel} so it stays testable
 * without a browser; this module owns only the presentation.
 *
 * The dialog states the shortfall the offer was raised with and, when no
 * presented option closes that gap, an extra warning line
 * (MS-0MVZC1DAS001C8LF) — the panel chrome grows by one block for it so the
 * rows never collide.
 *
 * Overlay conventions (AGENTS.md UI Best Practices), matching
 * `showEventChoiceDialog` / `showTurnSummaryDialog`:
 *
 * - `createOverlayBackground` / `createOverlayButton` from `@ui`;
 * - every element parented into `s.hudContainer`;
 * - depths 199 (backdrop) / 200 (box) / 201 (interactive elements);
 * - every created object pushed into `s.overlayObjects` for dismissal;
 * - SFX through `safePlaySound` (mute/volume respected);
 * - instant appearance (no fade-in), so the overlay is reduced-motion safe;
 * - `replayMode` (headless/replay) never presents UI.
 *
 * @module src/scenes/MainStreetLoanOverlay
 */

import {
  FONT_FAMILY,
  createOverlayBackground,
  createOverlayButton,
  dismissOverlay,
} from '@ui';
import { COMMON_SFX_KEYS, safePlaySound } from '@core-engine/SoundManager';
import type { LoanOfferModel } from './MainStreetLoanOverlayModel';

/**
 * Callbacks the dialog invokes when the seat decides. The handlers resolve the
 * offer and resume the paused closing (see
 * `MainStreetTurnControllerTurnFlow.onLoanOfferChoice`).
 */
export interface LoanOfferDialogHandlers {
  /** Called with the chosen row's index when an option button is pressed. */
  onAccept: (optionIndex: number) => void;
  /** Called when the Decline button is pressed. */
  onDecline: () => void;
}

// ── Layout constants ────────────────────────────────────────

/** Dialog width; wide enough for the self-contained option labels. */
const PANEL_WIDTH = 640;
/** Vertical space reserved for the title, intro and footer. */
const PANEL_CHROME_HEIGHT = 200;
/**
 * Extra chrome height reserved for the shortfall warning line when no
 * presented option closes the gap (MS-0MVZC1DAS001C8LF), so the extra line
 * never collides with the option rows.
 */
const WARNING_BLOCK_HEIGHT = 46;
/** Height of one option row (button + spacing). */
const ROW_HEIGHT = 40;

/**
 * Shows the bailout loan offer dialog.
 *
 * The dialog is a single modal: the seat must choose one option or decline.
 * Every button dismisses the overlay before invoking its handler, so a second
 * press can never resolve the same offer twice (and the handler itself is
 * idempotent — the resolving command clears `state.pendingLoanOffer`).
 *
 * @param s        The Main Street scene.
 * @param model    The presentation model from {@link buildLoanOfferModel}.
 * @param handlers Resolution callbacks.
 */
export function showLoanOfferDialog(
  s: any,
  model: LoanOfferModel,
  handlers: LoanOfferDialogHandlers,
): void {
  if (s.replayMode) return; // headless/replay: never present UI

  const optionCount = model.rows.length;
  const rowCount = Math.max(optionCount, 1);
  // The intro states the shortfall; when no option covers it an extra warning
  // line is drawn below the intro and the chrome grows to make room.
  const warningOffset = model.warning ? WARNING_BLOCK_HEIGHT : 0;
  const panelH = PANEL_CHROME_HEIGHT + warningOffset + rowCount * ROW_HEIGHT;
  const panelY = s.layout.gameH / 2 - panelH / 2;
  const centerX = s.layout.gameW / 2;

  // Overlay background with semi-transparent backdrop (199 / 200 / 201).
  const overlay = createOverlayBackground(
    s,
    { depth: 199, alpha: 0.6 },
    { width: PANEL_WIDTH, height: panelH, color: 0x000000, alpha: 1.0, depth: 200 },
  );
  s.overlayObjects.push(...overlay.objects);

  /** Adds a centred, HUD-parented, tracked text element. */
  const addText = (
    y: number,
    text: string,
    style: { fontSize: string; fontStyle?: string; color: string; lineSpacing?: number },
  ): any => {
    const obj = s.add
      .text(centerX, y, text, {
        ...style,
        fontFamily: FONT_FAMILY,
        align: 'center',
        wordWrap: { width: PANEL_WIDTH - 70 },
      })
      .setOrigin(0.5, 0)
      .setDepth(201);
    if (s.hudContainer) s.hudContainer.add(obj);
    s.overlayObjects.push(obj);
    return obj;
  };

  addText(panelY + 22, model.title, {
    fontSize: '21px',
    fontStyle: 'bold',
    color: '#ffcc44',
  });

  addText(panelY + 56, model.intro, {
    fontSize: '13px',
    color: '#ddccbb',
    lineSpacing: 4,
  });

  // "None of these loans is enough" warning, only when every presented option
  // still leaves the seat below zero (the run ends regardless of the choice).
  if (model.warning) {
    addText(panelY + 100, model.warning, {
      fontSize: '13px',
      color: '#ff8888',
      lineSpacing: 4,
    });
  }

  /** Dismisses the whole overlay and releases the tracked objects. */
  const dismiss = (): void => {
    dismissOverlay(s.overlayObjects);
    s.overlayObjects = [];
  };

  // One button per presented option. Each label carries the principal, the
  // per-turn repayment, the total repayment and the term — plus, when the
  // shortfall is known, whether that option closes the gap or how short it
  // still leaves the seat.
  model.rows.forEach((row, index) => {
    const btn = createOverlayButton(
      s,
      centerX,
      panelY + 110 + warningOffset + index * ROW_HEIGHT,
      row.label,
      201,
      { fontSize: '14px', color: '#aaddff', hoverColor: '#cceeff' },
    );
    if (s.hudContainer) s.hudContainer.add(btn);
    btn.on('pointerdown', () => {
      // Button SFX always plays (reduced motion keeps sound).
      safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
      dismiss();
      handlers.onAccept(index);
    });
    s.overlayObjects.push(btn);
  });

  // Decline is the single alternative to borrowing.
  const declineBtn = createOverlayButton(
    s,
    centerX,
    panelY + 110 + warningOffset + rowCount * ROW_HEIGHT,
    model.declineLabel,
    201,
    { fontSize: '14px', color: '#ff8888', hoverColor: '#ffaaaa' },
  );
  if (s.hudContainer) s.hudContainer.add(declineBtn);
  declineBtn.on('pointerdown', () => {
    safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
    dismiss();
    handlers.onDecline();
  });
  s.overlayObjects.push(declineBtn);

  addText(panelY + 126 + warningOffset + rowCount * ROW_HEIGHT, model.footer, {
    fontSize: '12px',
    color: '#999988',
  });
}
