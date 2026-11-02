/**
 * Main Street: loan dialogs (Phaser) — bailout offer + mid-game selector
 *
 * One renderer, two modes (MS-0MVXYCJVU000QBK1, parent MS-0MVPWSQMG004198C):
 *
 * - **`'bailout'`** — the bankruptcy bailout dialog (MS-0MVPWSBLG006YMBA, parent
 *   MS-0MVL6DZI0000F6CG): one button per presented loan option — each showing
 *   its per-turn and total repayment — plus a Decline action. The content comes
 *   from the Phaser-free {@link buildLoanOfferModel} so it stays testable
 *   without a browser; this module owns only the presentation.
 * - **`'select'`** — the mid-game loan selector opened from the Turn Summary
 *   dialog's `[ Bank Loan ]`: the same rows for the same menu, but driven by
 *   the configured `config.loanOptions` (via the Phaser-free
 *   {@link buildLoanSelectorModel}) and with a Cancel action that only closes
 *   the dialog.
 *
 * The row loop — button construction, label text, depths, HUD parenting and
 * SFX — exists **once**, in {@link renderLoanDialog}: the two modes differ only
 * in their model content, the alternative action's label and the handler it
 * calls (and, because declining ends the run while cancelling does not, the
 * alternative action's colour). A duplicated bailout dialog would leave two
 * loan selectors to maintain (parent AC4).
 *
 * The dialog states the shortfall the offer was raised with and, when no
 * presented option closes that gap, an extra warning line
 * (MS-0MVZC1DAS001C8LF) — the panel chrome grows by one block for it so the
 * rows never collide. That warning is bailout-only: a mid-game selection is not
 * raised against any closing shortfall. The selector uses the same extra-line
 * slot for the engine's refusal reason when a confirm is rejected
 * (MS-0MVXYCKFE000VF76), so the dialog can stay open and say why.
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
import type { LoanOfferRow } from './MainStreetLoanRowModel';
import type { LoanSelectorModel } from './MainStreetLoanSelectorModel';

/**
 * Which dialog the shared renderer draws. The mode carries the dialog's
 * semantics — the alternative action's meaning and therefore its styling —
 * and is not expected to grow with every model field.
 */
export type LoanDialogMode = 'bailout' | 'select';

/**
 * Callbacks the bailout dialog invokes when the seat decides. The handlers
 * resolve the offer and resume the paused closing (see
 * `MainStreetTurnControllerTurnFlow.onLoanOfferChoice`).
 */
export interface LoanOfferDialogHandlers {
  /** Called with the chosen row's index when an option button is pressed. */
  onAccept: (optionIndex: number) => void;
  /** Called when the Decline button is pressed. */
  onDecline: () => void;
}

/**
 * Callbacks the mid-game selector invokes when the seat decides. Confirming a
 * row takes the loan (MS-0MVXYCKFE000VF76); cancelling only closes the dialog —
 * it never takes a loan, spends an action or advances the day.
 */
export interface LoanSelectorDialogHandlers {
  /** Called with the chosen row's index when an option button is pressed. */
  onAccept: (optionIndex: number) => void;
  /** Called when the Cancel button is pressed. */
  onCancel: () => void;
}

/**
 * The presentation-only union of both models: everything the shared renderer
 * needs, with the alternative action reduced to its label.
 */
interface LoanDialogContent {
  readonly title: string;
  readonly intro: string;
  /** Bailout-only shortfall warning, or absent when there is nothing to warn. */
  readonly warning?: string | null;
  /**
   * The engine's own refusal reason for a rejected confirm, or absent. Present
   * only when a mid-game confirm was refused (MS-0MVXYCKFE000VF76), so the
   * dialog can stay open and say *why* instead of failing silently.
   */
  readonly error?: string | null;
  readonly rows: readonly LoanOfferRow[];
  /** Label for the single non-borrowing action (Decline / Cancel). */
  readonly alternativeLabel: string;
  readonly footer: string;
}

/** Mode-neutral handlers the shared renderer drives. */
interface LoanDialogHandlers {
  onAccept: (optionIndex: number) => void;
  onAlternative: () => void;
}

// ── Layout constants ────────────────────────────────────────

/** Dialog width; wide enough for the self-contained option labels. */
const PANEL_WIDTH = 640;
/** Vertical space reserved for the title, intro and footer. */
const PANEL_CHROME_HEIGHT = 200;
/**
 * Extra chrome height reserved for each extra line under the intro — the
 * shortfall warning when no presented option closes the gap
 * (MS-0MVZC1DAS001C8LF) and the engine's refusal reason after a rejected
 * confirm (MS-0MVXYCKFE000VF76) — so an extra line never collides with the
 * option rows.
 */
const EXTRA_LINE_HEIGHT = 46;
/** Height of one option row (button + spacing). */
const ROW_HEIGHT = 40;

/**
 * Styling of the alternative action per mode.
 *
 * The bailout's `[ Decline — end the run ]` ends the run, so it stays red. The
 * selector's `[ Cancel ]` merely closes the dialog, so it is rendered in a
 * neutral colour and can never be mistaken for a destructive choice.
 */
const ALTERNATIVE_ACTION_STYLE: Record<
  LoanDialogMode,
  { color: string; hoverColor: string }
> = {
  bailout: { color: '#ff8888', hoverColor: '#ffaaaa' },
  select: { color: '#ddccbb', hoverColor: '#eeddcc' },
};

/**
 * Draws a loan dialog: title, intro, optional warning, one button per option
 * row, the single alternative action and the footer.
 *
 * The only place the loan-dialog rows are built — both modes go through here,
 * so their buttons, labels, depths, HUD parenting and SFX cannot drift apart.
 *
 * Every button dismisses the overlay before invoking its handler, so a second
 * press can never resolve the same dialog twice.
 *
 * @param s        The Main Street scene.
 * @param mode     Which dialog is being drawn (alternative-action semantics).
 * @param content  Presentation content, already built by the Phaser-free model.
 * @param handlers Resolution callbacks.
 */
function renderLoanDialog(
  s: any,
  mode: LoanDialogMode,
  content: LoanDialogContent,
  handlers: LoanDialogHandlers,
): void {
  if (s.replayMode) return; // headless/replay: never present UI

  const optionCount = content.rows.length;
  const rowCount = Math.max(optionCount, 1);
  // Extra lines under the intro: the bailout's "none of these loans is enough"
  // warning and the selector's engine-refusal reason. Each grows the chrome by
  // one block so no line collides with the option rows.
  const extraLines = [content.warning, content.error].filter(
    (line): line is string => typeof line === 'string' && line.length > 0,
  );
  const extraOffset = extraLines.length * EXTRA_LINE_HEIGHT;
  const panelH = PANEL_CHROME_HEIGHT + extraOffset + rowCount * ROW_HEIGHT;
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

  addText(panelY + 22, content.title, {
    fontSize: '21px',
    fontStyle: 'bold',
    color: '#ffcc44',
  });

  addText(panelY + 56, content.intro, {
    fontSize: '13px',
    color: '#ddccbb',
    lineSpacing: 4,
  });

  // The extra lines, in red: the "none of these loans is enough" warning (only
  // when every presented option still leaves the seat below zero) and the
  // engine's refusal reason for a rejected mid-game confirm.
  extraLines.forEach((line, index) => {
    addText(panelY + 100 + index * EXTRA_LINE_HEIGHT, line, {
      fontSize: '13px',
      color: '#ff8888',
      lineSpacing: 4,
    });
  });

  /** Dismisses the whole overlay and releases the tracked objects. */
  const dismiss = (): void => {
    dismissOverlay(s.overlayObjects);
    s.overlayObjects = [];
  };

  // One button per presented option. Each label carries the principal, the
  // per-turn repayment, the total repayment and the term — plus, when the
  // shortfall is known, whether that option closes the gap or how short it
  // still leaves the seat.
  content.rows.forEach((row, index) => {
    const btn = createOverlayButton(
      s,
      centerX,
      panelY + 110 + extraOffset + index * ROW_HEIGHT,
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

  // The single non-borrowing action: Decline ends the run, Cancel only closes
  // the selector — the mode supplies the wording and the styling.
  const alternativeStyle = ALTERNATIVE_ACTION_STYLE[mode];
  const alternativeBtn = createOverlayButton(
    s,
    centerX,
    panelY + 110 + extraOffset + rowCount * ROW_HEIGHT,
    content.alternativeLabel,
    201,
    { fontSize: '14px', ...alternativeStyle },
  );
  if (s.hudContainer) s.hudContainer.add(alternativeBtn);
  alternativeBtn.on('pointerdown', () => {
    safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
    dismiss();
    handlers.onAlternative();
  });
  s.overlayObjects.push(alternativeBtn);

  addText(panelY + 126 + extraOffset + rowCount * ROW_HEIGHT, content.footer, {
    fontSize: '12px',
    color: '#999988',
  });
}

/**
 * Shows the bailout loan offer dialog (`mode: 'bailout'`).
 *
 * The dialog is a single modal: the seat must choose one option or decline.
 * Behaviours are unchanged from MS-0MVPWSBLG006YMBA — only the row loop moved
 * into the shared renderer.
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
  renderLoanDialog(
    s,
    'bailout',
    {
      title: model.title,
      intro: model.intro,
      warning: model.warning,
      rows: model.rows,
      alternativeLabel: model.declineLabel,
      footer: model.footer,
    },
    { onAccept: handlers.onAccept, onAlternative: handlers.onDecline },
  );
}

/**
 * Shows the mid-game loan selector dialog (`mode: 'select'`).
 *
 * Same rows as the bailout dialog for the same menu, driven by the configured
 * `config.loanOptions` rather than `state.pendingLoanOffer`, with Cancel as the
 * only alternative: it closes the selector and returns to the Turn Summary
 * dialog without taking a loan, spending an action or advancing the day.
 *
 * @param s        The Main Street scene.
 * @param model    The presentation model from {@link buildLoanSelectorModel}.
 * @param handlers Resolution callbacks (confirm / cancel).
 * @param error    The engine's refusal reason when a confirm was rejected
 *                 (MS-0MVXYCKFE000VF76): drawn as an extra red line so the
 *                 re-presented dialog says why it did not take the loan.
 */
export function showLoanSelectorDialog(
  s: any,
  model: LoanSelectorModel,
  handlers: LoanSelectorDialogHandlers,
  error?: string | null,
): void {
  renderLoanDialog(
    s,
    'select',
    {
      title: model.title,
      intro: model.intro,
      error: error ?? null,
      rows: model.rows,
      alternativeLabel: model.cancelLabel,
      footer: model.footer,
    },
    { onAccept: handlers.onAccept, onAlternative: handlers.onCancel },
  );
}
