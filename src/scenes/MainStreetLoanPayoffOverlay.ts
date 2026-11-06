/**
 * Main Street: loan payoff congratulation dialog (Phaser)
 *
 * Presentation half of the loan payoff notification (MS-0MW3SN2LK00537GN,
 * parent MS-0MW1ZJDVE000MUID): when the seat makes its final scheduled
 * repayment the engine reports a {@link LoanPayoff} entry, and this module
 * congratulates the player on clearing the debt — so the milestone is noticed
 * and the stopped weekly deduction is explained.
 *
 * The renderer owns **no copy**: every string comes from the Phaser-free
 * {@link buildLoanPayoffContent} model (MS-0MW3SMVVP006ZD4V), which is also
 * the single home of the presentation gate ({@link shouldPresentLoanPayoff}:
 * never in `replayMode`, never for a non-human seat, never when the same
 * closing ended the run). This module derives the context from the scene and
 * draws whatever the model returns — a suppressed payoff draws nothing.
 *
 * Overlay conventions (AGENTS.md UI Best Practices), matching the sibling loan
 * dialogs in `MainStreetLoanOverlay` and `showTurnSummaryDialog`:
 *
 * - `createOverlayBackground` / `createOverlayButton` from `@ui`;
 * - every element parented into `s.hudContainer`;
 * - depths 199 (backdrop) / 200 (box) / 201 (elements);
 * - every created object pushed into `s.overlayObjects` for dismissal;
 * - SFX through `safePlaySound` (mute/volume respected);
 * - instant appearance (no fade-in), so the overlay is reduced-motion safe;
 * - exactly one dismiss action, which resumes the interrupted flow once.
 *
 * @module src/scenes/MainStreetLoanPayoffOverlay
 */

import {
  FONT_FAMILY,
  createOverlayBackground,
  createOverlayButton,
  dismissOverlay,
} from '@ui';
import { COMMON_SFX_KEYS, safePlaySound } from '@core-engine/SoundManager';
import type { LoanPayoff } from '../MainStreetLoans';
import {
  buildLoanPayoffContent,
  deriveLoanPayoffContext,
} from './MainStreetLoanPayoffModel';

// ── Layout constants ────────────────────────────────────────

/** Dialog width; wide enough for the repayment lines without wrapping. */
const PANEL_WIDTH = 520;
/** Dialog height: headline, two body lines and the dismiss button. */
const PANEL_HEIGHT = 240;

/**
 * Draws the debt-free congratulation dialog.
 *
 * The single dismiss action dismisses the overlay before invoking
 * {@link onDismiss}, and a guard makes that continuation run at most once even
 * if the button is pressed again before it is destroyed — so the interrupted
 * flow can never be resumed twice.
 *
 * @param s        The Main Street scene.
 * @param payoff   The retired loan, as reported on `TurnResult.loanPayoffs`.
 * @param onDismiss Called exactly once when the player dismisses the dialog;
 *                  resumes the flow the dialog interrupted.
 * @returns Whether a dialog was presented — `false` when the model's gate
 *          suppressed it (replay/headless, non-human seat, run ended), in which
 *          case the caller continues the flow itself and nothing is drawn.
 */
export function showLoanPayoffDialog(
  s: any,
  payoff: LoanPayoff,
  onDismiss: () => void,
): boolean {
  const content = buildLoanPayoffContent(payoff, deriveLoanPayoffContext(s, payoff));
  if (!content) return false; // suppressed: replay/headless, AI seat or run over

  const centerX = s.layout.gameW / 2;
  const panelY = s.layout.gameH / 2 - PANEL_HEIGHT / 2;

  // Backdrop 199 / box 200 (createOverlayBackground parents both into the HUD).
  const overlay = createOverlayBackground(
    s,
    { depth: 199, alpha: 0.6 },
    {
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      color: 0x000000,
      alpha: 1.0,
      depth: 200,
    },
  );
  s.overlayObjects.push(...overlay.objects);

  /** Adds a centred, HUD-parented, tracked depth-201 text element. */
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

  addText(panelY + 28, content.headline, {
    fontSize: '22px',
    fontStyle: 'bold',
    color: '#ffcc44',
  });

  addText(panelY + 76, content.body.join('\n'), {
    fontSize: '14px',
    color: '#ddccbb',
    lineSpacing: 6,
  });

  // The only action: continue exactly where the interrupted flow left off.
  const dismissBtn = createOverlayButton(
    s,
    centerX,
    panelY + PANEL_HEIGHT - 46,
    content.dismissLabel,
    201,
  );
  if (s.hudContainer) s.hudContainer.add(dismissBtn);
  s.overlayObjects.push(dismissBtn);

  // Exactly-once dismissal: a second press (or a stray emit) can never resume
  // the interrupted flow twice.
  let dismissed = false;
  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
    dismissOverlay(s.overlayObjects);
    s.overlayObjects = [];
    onDismiss();
  };
  dismissBtn.on('pointerdown', dismiss);

  return true;
}
