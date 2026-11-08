/**
 * Main Street: unified tabbed Turn Summary overlay (parent MS-0MW4XULA90002OEY,
 * child MS-0MW5ER6HC000HVQ8).
 *
 * One **tabbed profit/loss statement** replaces the previous flat single-player
 * dialog (`showTurnSummaryDialog`) and the competitive per-seat panel
 * (`showCompetitiveTurnSummaryDialog`). Both entry points below render through
 * the same panel: a tab strip (one tab per player, human `You` tab selected by
 * default, a single non-interactive `You` tab in single-player) plus the
 * selected player's management-company P&L statement.
 *
 * The statement body is the Phaser-free projection from
 * {@link module:scenes/MainStreetTurnSummary}: an **Income** section (base /
 * synergy / reputation / events) with its total, a **Less: Operating expenses**
 * section (staff / community / business) with its total, the **Incident** and
 * **One-off** adjustments, and an emphasised **Net profit/loss** bottom line.
 * The non-monetary figures (reputation/score change, closing coins/reputation/
 * score and businesses owned) are rendered as **supplementary context** below
 * the statement, never as P&L lines (producer answers Q1=A, Q2=A, Q3=A).
 *
 * Behaviour preserved from the two dialogs it replaces:
 *
 * - `[ Next Turn ]` is the only way to resume the deferred closing.
 * - `[ Bank Loan ]` follows the pre-computed loans descriptor: interactive in
 *   normal colour (with `UI_CLICK` SFX and exactly one seam call per press)
 *   exactly when the acting seat may borrow, otherwise muted and inert with the
 *   descriptor's reason-specific hint. An enabled press swaps the panel for the
 *   mid-game loan selector, and confirming an option takes the loan through the
 *   command surface (`takeLoanCommand`, AP-neutral and reversible) before
 *   re-presenting the panel from the **same** result against the post-take
 *   state — **preserving the selected tab**.
 *
 * Overlay pattern compliance (AGENTS.md UI Best Practices):
 * `createOverlayBackground` + `createOverlayButton` from `@ui`; every element is
 * parented into `s.hudContainer`; depths 199 (backdrop) / 200 (box) / 201
 * (elements); everything is pushed into `s.overlayObjects` for dismissal;
 * instant appearance (no fade-in — reduced-motion safe); button/tab SFX play
 * through `safePlaySound`. Tabs are operable by pointer **and** keyboard
 * (Left/Right arrows cycle the players' tabs in competitive play).
 *
 * @module src/scenes/MainStreetTurnSummaryOverlay
 */

import {
  FONT_FAMILY,
  createOverlayBackground,
  createOverlayButton,
  dismissOverlay,
} from '@ui';
import { COMMON_SFX_KEYS, safePlaySound } from '@core-engine/SoundManager';

import { takeLoanCommand } from '../MainStreetCommands';
import type { TurnResult } from '../MainStreetEngine';
import {
  buildCompetitiveTurnSummary,
  buildPLFromCompetitiveRow,
  buildPLFromTurnSummary,
  buildPLTabsFromCompetitiveSummary,
  buildPLTabsFromTurnSummary,
  buildTurnSummary,
  type CompetitiveTurnSummary,
  type PLTab,
  type PLProjection,
  type TurnSummary,
  type TurnSummaryClosing,
} from './MainStreetTurnSummary';
import {
  buildLoanSelectorModel,
  buildTurnSummaryLoanDescriptor,
  type LoanSelectorModel,
  type TurnSummaryLoanDescriptor,
} from './MainStreetLoanSelectorModel';
import { showLoanSelectorDialog } from './MainStreetLoanOverlay';

/** Panel geometry (fits the 1280×720 scene with the action row and hint). */
const PANEL_WIDTH = 680;
const PANEL_HEIGHT = 640;

/** Muted text colour for the unavailable `[ Bank Loan ]` affordance. */
const UNAVAILABLE_ACTION_COLOUR = '#6b6459';

/** Selected tab colour for panels with no seat colour (single-player). */
const SELECTED_TAB_COLOUR = '#ffcc44';
const TAB_COLOUR = '#bbaa88';

/** Hover colour for every tab: a clear, seat-independent pointer affordance. */
const TAB_HOVER_COLOUR = '#ffffff';

/** Net-profit colour: green for a profit, red for a loss. */
const PROFIT_COLOUR = '#88ff88';
const LOSS_COLOUR = '#ff8888';

/**
 * Formats a signed integer for dialog rows as `+N` / `-N` / `0`. Coins are
 * whole numbers (integer economy, CG-0MTIO1M15001E9Y6).
 */
function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * Re-sizes a tab's input hit area to its current rendered size.
 *
 * `createOverlayButton` derives the hit area from the text size at creation,
 * so a later `setFontStyle('bold')` would leave the (wider) selected label
 * partly outside its own clickable rectangle. Tabs whose hit area is a simple
 * rectangle are refreshed here; anything else is left untouched.
 */
function syncHitArea(tab: Phaser.GameObjects.Text): void {
  const hitArea = (tab.input as { hitArea?: { setSize?: (w: number, h: number) => void } } | null)
    ?.hitArea;
  if (hitArea && typeof hitArea.setSize === 'function') {
    hitArea.setSize(tab.width, tab.height);
  }
}

/** One player's tab in the presented panel. */
export interface TurnSummaryOverlayTab {
  /** The player's tab model (id / label / colour / human / default). */
  tab: PLTab;
  /** The player's management-company P&L statement. */
  projection: PLProjection;
  /** The player's closing coin / reputation / score balances (context). */
  closing: TurnSummaryClosing;
  /**
   * Resolved incident name shown as supplementary context, or `null` when the
   * panel carries none (the competitive ledger does not name the incident).
   */
  incidentName: string | null;
}

/** Everything the unified panel renders for one closing. */
export interface TurnSummaryOverlayModel {
  /** Shared day / turn the closing belongs to. */
  turn: number;
  /** One tab per player, in seat order. */
  tabs: TurnSummaryOverlayTab[];
  /** The tab whose statement body is shown. */
  selectedTabId: string;
  /** False in single-player: the sole `You` tab is not interactive. */
  tabsInteractive: boolean;
  /** Loans availability for the acting seat (absent → disabled, no hint). */
  loanDescriptor?: TurnSummaryLoanDescriptor;
  /**
   * The seat a mid-game take books to, forwarded as `ownerId` to
   * `takeLoanCommand` (MS-0MW5X3AYS0072ED3). Competitive panels key to the
   * human seat — never the transient round-robin `activePlayerId`, which can
   * point at an AI seat when the shared day closed. Absent in single-player,
   * which keeps the acting-seat default.
   */
  loanOwnerId?: number;
}

/** The seams the panel calls back into. */
export interface TurnSummaryOverlayHandlers {
  /** Called once when `[ Next Turn ]` is pressed. */
  onNextTurn: () => void;
  /** Called once per press of the enabled `[ Bank Loan ]`. */
  onBankLoanAction?: () => void;
  /** Builds the mid-game loan selector for the acting seat (or `null`). */
  buildLoanSelector?: () => LoanSelectorModel | null;
  /**
   * Rebuilds the panel from the live state after a loan take, preserving the
   * selected tab. Returns `null` when the rebuild failed (the panel then keeps
   * the values it already has rather than stranding the closing).
   */
  refresh?: (selectedTabId: string) => TurnSummaryOverlayModel | null;
}

/**
 * Shows the unified tabbed P&L Turn Summary panel for a single-player closing.
 *
 * @param s                The Main Street scene.
 * @param summary          The single-player Turn Summary model.
 * @param onNextTurn       Called when the player presses `[ Next Turn ]`.
 * @param loanDescriptor   Loans availability for the acting seat.
 * @param onBankLoanAction Called once per press of the enabled `[ Bank Loan ]`.
 * @param result           The closed turn's result, so a mid-game loan take can
 *                         re-present the panel from the same result against the
 *                         post-take state.
 */
export function showTurnSummaryDialog(
  s: any,
  summary: TurnSummary,
  onNextTurn: () => void,
  loanDescriptor?: TurnSummaryLoanDescriptor,
  onBankLoanAction?: () => void,
  result?: Pick<TurnResult, 'turnLedger' | 'incident'>,
): void {
  if (s.replayMode) return; // headless/replay: never present UI

  let current = summary;
  let descriptor = loanDescriptor;

  const build = (selectedTabId?: string): TurnSummaryOverlayModel =>
    singlePlayerPanelModel(current, descriptor, selectedTabId);

  presentTurnSummaryPanel(s, build(), {
    onNextTurn,
    onBankLoanAction,
    buildLoanSelector: () => buildLoanSelectorModel(s.state),
    refresh: (selectedTabId) => {
      // Presentation-only: a failed rebuild keeps the values we were given
      // rather than stranding the closing.
      if (result) {
        try {
          current = buildTurnSummary(s.state, result) ?? current;
        } catch { /* presentation-only — keep the summary we were given */ }
        try {
          descriptor = buildTurnSummaryLoanDescriptor(s.state);
        } catch { /* presentation-only — keep the pre-take descriptor */ }
      }
      return build(selectedTabId);
    },
  });
}

/**
 * Shows the unified tabbed P&L Turn Summary panel for a competitive closing.
 *
 * @param s                The Main Street scene.
 * @param summary          The competitive (per-seat) Turn Summary model.
 * @param onNextTurn       Called when the player presses `[ Next Turn ]`.
 * @param onBankLoanAction Per-seat loans seam, invoked with the human seat id
 *                         once per press of the enabled `[ Bank Loan ]`.
 * @param result           The closed round's result, so a loan take can
 *                         re-present the panel from the same result.
 */
export function showCompetitiveTurnSummaryDialog(
  s: any,
  summary: CompetitiveTurnSummary,
  onNextTurn: () => void,
  onBankLoanAction?: (seatId?: number) => void,
  result?: Pick<TurnResult, 'playerRoundLedger'>,
): void {
  if (s.replayMode) return; // headless/replay: never present UI

  let current = summary;

  const build = (selectedTabId?: string): TurnSummaryOverlayModel =>
    competitivePanelModel(current, selectedTabId);

  presentTurnSummaryPanel(s, build(), {
    onNextTurn,
    onBankLoanAction: onBankLoanAction
      ? () => onBankLoanAction(current.humanSeatId)
      : undefined,
    buildLoanSelector: () => buildLoanSelectorModel(s.state, current.humanSeatId),
    refresh: (selectedTabId) => {
      if (result) {
        try {
          current = buildCompetitiveTurnSummary(s.state, result) ?? current;
        } catch { /* presentation-only — keep the panel we were given */ }
      }
      return build(selectedTabId);
    },
  });
}

// ── Panel models ──────────────────────────────────────────────

/** Builds the panel model for a single-player closing. */
function singlePlayerPanelModel(
  summary: TurnSummary,
  loanDescriptor: TurnSummaryLoanDescriptor | undefined,
  selectedTabId?: string,
): TurnSummaryOverlayModel {
  const tabs = buildPLTabsFromTurnSummary(summary);
  const views: TurnSummaryOverlayTab[] = [];
  for (const tab of tabs) {
    const projection = buildPLFromTurnSummary(summary, tab.id);
    if (!projection) continue;
    const owner = summary.owners.find((row) => row.ownerId === tab.id);
    views.push({
      tab,
      projection,
      closing: owner
        ? { coins: owner.coins, reputation: owner.reputation, score: owner.score }
        : { ...summary.closing },
      incidentName: summary.incidentName ?? 'No incident',
    });
  }
  return {
    turn: summary.turn,
    tabs: views,
    selectedTabId: resolveSelectedTabId(views, selectedTabId),
    tabsInteractive: views.length > 1,
    loanDescriptor,
  };
}

/** Builds the panel model for a competitive closing. */
function competitivePanelModel(
  summary: CompetitiveTurnSummary,
  selectedTabId?: string,
): TurnSummaryOverlayModel {
  const tabs = buildPLTabsFromCompetitiveSummary(summary);
  const views: TurnSummaryOverlayTab[] = [];
  for (const tab of tabs) {
    const row = summary.rows.find((candidate) => String(candidate.ownerId) === tab.id);
    if (!row) continue;
    views.push({
      tab,
      projection: buildPLFromCompetitiveRow(row),
      closing: { ...row.closing },
      incidentName: null,
    });
  }
  return {
    turn: summary.turn,
    tabs: views,
    selectedTabId: resolveSelectedTabId(views, selectedTabId),
    tabsInteractive: views.length > 1,
    loanDescriptor: summary.humanSeatId >= 0 ? summary.loanDescriptor : undefined,
    loanOwnerId: summary.humanSeatId >= 0 ? summary.humanSeatId : undefined,
  };
}

/**
 * Keeps the selected tab across a re-render when it still exists, otherwise
 * falls back to the model's default tab (the human seat).
 */
function resolveSelectedTabId(
  views: readonly TurnSummaryOverlayTab[],
  requested?: string,
): string {
  if (requested && views.some((view) => view.tab.id === requested)) return requested;
  const fallback = views.find((view) => view.tab.isDefault) ?? views[0];
  return fallback?.tab.id ?? '';
}

// ── Renderer ──────────────────────────────────────────────────

/**
 * Renders one tabbed P&L panel and owns its lifecycle: tab switching re-draws
 * the panel, a loan take re-presents it through {@link TurnSummaryOverlayHandlers.refresh},
 * and dismissal destroys every tracked object and detaches the keyboard
 * handler.
 *
 * @param s        The Main Street scene.
 * @param initial  The panel model to present.
 * @param handlers Callbacks into the closing flow.
 */
export function presentTurnSummaryPanel(
  s: any,
  initial: TurnSummaryOverlayModel,
  handlers: TurnSummaryOverlayHandlers,
): void {
  if (s.replayMode) return;
  if (initial.tabs.length === 0) {
    // Nothing to show (no ledger of either shape): never strand the closing.
    handlers.onNextTurn();
    return;
  }

  let model = initial;
  let detachKeyboard: (() => void) | null = null;

  /**
   * Places an invisible, interactive blocker that absorbs pointerup events
   * after the overlay's backdrop has been destroyed.
   *
   * MS-0MW6GPRL6001DFCF — clicking [ Next Turn ] (which sits directly over the
   * middle hand card) must never select a hand card.  `dismissPanel()` removes
   * the backdrop, so the pointer's release falls through to the card beneath.
   * A depth-9999 transparent rectangle soaks the release; it is destroyed by
   * the release it absorbs (with a safety timeout for a release that never
   * arrives, e.g. the pointer leaving the canvas).
   *
   * The rectangle is anchored top-left at (0, 0): Phaser derives an
   * interactive rectangle's hit area as `Rectangle(0, 0, w, h)` in the
   * object's origin space, so a centre-origin full-screen rectangle would only
   * be hit-testable in its bottom-right quadrant.
   */
  function placePointerBlocker(): void {
    const w = s.layout.gameW;
    const h = s.layout.gameH;
    const blocker = s.add.rectangle(0, 0, w, h, 0x000000, 0)
      .setOrigin(0, 0)
      .setDepth(9999);
    blocker.setInteractive();
    if (s.hudContainer) s.hudContainer.add(blocker);
    // The release this blocker exists for destroys it; the safety timeout
    // covers a release that never arrives.
    blocker.once('pointerup', () => { try { blocker.destroy(); } catch { /* gone */ } });
    s.time.delayedCall(1500, () => { try { blocker.destroy(); } catch { /* gone */ } });
  }

  /** Destroys everything this panel owns and releases the tracked objects. */
  function dismissPanel(): void {
    if (detachKeyboard) {
      detachKeyboard();
      detachKeyboard = null;
    }
    dismissOverlay(s.overlayObjects ?? []);
    s.overlayObjects = [];
  }

  /** Selects a tab and redraws the whole statement body for it. */
  function selectTab(tabId: string): void {
    if (tabId === model.selectedTabId) return;
    if (!model.tabs.some((view) => view.tab.id === tabId)) return;
    model = { ...model, selectedTabId: tabId };
    safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
    draw();
  }

  /** Cycles the selected tab by `step` (keyboard navigation, wraps around). */
  function selectTabByOffset(step: number): void {
    const ids = model.tabs.map((view) => view.tab.id);
    if (ids.length < 2) return;
    const index = Math.max(0, ids.indexOf(model.selectedTabId));
    selectTab(ids[(index + step + ids.length) % ids.length]);
  }

  /** Redraws the panel from the current model, re-arming keyboard navigation. */
  function redraw(): void {
    draw();
    if (!detachKeyboard) attachKeyboard();
  }

  /** Redraws the panel from the current model. */
  function draw(): void {
    dismissOverlay(s.overlayObjects ?? []);
    s.overlayObjects = [];

    const centerX = s.layout.gameW / 2;
    const panelW = PANEL_WIDTH;
    const panelH = PANEL_HEIGHT;
    const panelX = centerX - panelW / 2;
    const panelY = s.layout.gameH / 2 - panelH / 2;
    const leftX = panelX + 40;

    // Backdrop 199 / box 200 (createOverlayBackground), elements 201 below.
    const overlay = createOverlayBackground(
      s,
      { depth: 199, alpha: 0.6 },
      { width: panelW, height: panelH, color: 0x000000, alpha: 1.0, depth: 200 },
    );
    s.overlayObjects.push(...overlay.objects);

    /** Adds a depth-201 element, parenting it into the HUD container. */
    const addText = (
      x: number,
      y: number,
      text: string,
      style: Record<string, unknown>,
      originX = 0,
      originY = 0,
    ): Phaser.GameObjects.Text => {
      const obj = s.add.text(x, y, text, style)
        .setOrigin(originX, originY)
        .setDepth(201);
      if (s.hudContainer) s.hudContainer.add(obj);
      s.overlayObjects.push(obj);
      return obj;
    };

    // ── Title band ──────────────────────────────────────────────
    addText(centerX, panelY + 30, 'Turn Summary', {
      fontSize: '24px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    }, 0.5);
    addText(centerX, panelY + 58, `Day ${model.turn}`, {
      fontSize: '15px', color: '#bbaa88', fontFamily: FONT_FAMILY,
    }, 0.5);

    // ── Tab strip: one button per player, selected tab in bold ───
    // Every tab is drawn in the dialog's **button** form — `[ Label ]` — in
    // every state, so the player always sees a control for each management
    // company and can switch **back** to their own tab (the gap the producer
    // rejected the parent for: the selected tab was the only bracketed one, so
    // the other tabs read as plain labels rather than buttons). Selection is
    // signalled by weight, and hovering any tab brightens it.
    const tabY = panelY + 100;
    const tabsClickable = model.tabsInteractive && model.tabs.length > 1;
    let cursor = leftX;
    for (const view of model.tabs) {
      const selected = view.tab.id === model.selectedTabId;
      // Each tab keeps its seat's own colour (the shared `resolveSeatColour`
      // value); selection is signalled by the bold weight. A panel with no seat
      // colour (single-player) uses the dialog's gold.
      const tabColour = view.tab.colour
        ?? (selected ? SELECTED_TAB_COLOUR : TAB_COLOUR);
      const tab = createOverlayButton(
        s, 0, tabY,
        `[ ${view.tab.label} ]`,
        201,
        { fontSize: '15px', color: tabColour, hoverColor: TAB_HOVER_COLOUR },
      );
      if (selected) tab.setFontStyle('bold');
      // Measure, then lay the tab out in the strip (buttons are centre-origin).
      tab.setX(cursor + tab.width / 2);
      syncHitArea(tab);
      if (s.hudContainer) s.hudContainer.add(tab);
      s.overlayObjects.push(tab);
      if (tabsClickable) {
        tab.on('pointerdown', () => selectTab(view.tab.id));
      } else {
        // Single-player (and any single-tab panel): shown, never interactive.
        tab.disableInteractive();
      }
      cursor += tab.width + 18;
    }

    // ── Statement body for the selected tab ─────────────────────
    const view = model.tabs.find((candidate) => candidate.tab.id === model.selectedTabId)
      ?? model.tabs[0];
    const pl = view.projection;
    let y = panelY + 136;

    /** One monetary statement line. */
    const addLine = (
      text: string,
      style: Record<string, unknown> = {},
    ): void => {
      addText(leftX, y, text, {
        fontSize: '13px', color: '#ddccbb', fontFamily: FONT_FAMILY, ...style,
      });
      y += 20;
    };

    /** One section heading (`Income` / `Less: Operating expenses`). */
    const addHeading = (text: string): void => {
      y += 6;
      addText(leftX, y, text, {
        fontSize: '15px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
      });
      y += 24;
    };

    addHeading(pl.income.label);
    for (const line of pl.income.lines) {
      addLine(`${line.label}: ${formatSigned(line.coins)}`, {
        color: line.coins < 0 ? LOSS_COLOUR : '#ddccbb',
      });
    }
    addLine(`${pl.income.totalLabel}: ${formatSigned(pl.income.total)}`, {
      fontStyle: 'bold',
    });

    addHeading(pl.expenses.label);
    for (const line of pl.expenses.lines) {
      // Ongoing costs are signed (zero or negative) — render them as-is.
      addLine(`${line.label}: ${formatSigned(line.coins)}`, { color: LOSS_COLOUR });
    }
    addLine(`${pl.expenses.totalLabel}: ${formatSigned(pl.expenses.total)}`, {
      fontStyle: 'bold',
    });

    y += 8;
    addLine(`${pl.incident.label}: Coins ${formatSigned(pl.incident.coins)}, Rep ${formatSigned(pl.incident.reputation)}`);
    addLine(`${pl.oneOff.label}: Coins ${formatSigned(pl.oneOff.coins)}, Rep ${formatSigned(pl.oneOff.reputation)}`);

    // ── Emphasised bottom line ──────────────────────────────────
    y += 10;
    addText(leftX, y, `${pl.net.label}: ${formatSigned(pl.net.coins)}`, {
      fontSize: '18px',
      fontStyle: 'bold',
      color: pl.net.coins < 0 ? LOSS_COLOUR : PROFIT_COLOUR,
      fontFamily: FONT_FAMILY,
    });
    y += 32;

    // ── Supplementary context (never P&L lines) ─────────────────
    addLine(
      `Reputation change: ${formatSigned(pl.context.reputationChange)} · Score change: ${formatSigned(pl.context.scoreChange)}`,
      { fontSize: '12px' },
    );
    addLine(
      `Closing coins: ${view.closing.coins} · Closing Rep ${view.closing.reputation} · Score ${view.closing.score}`,
      { fontSize: '12px' },
    );
    addLine(`Businesses owned: ${pl.context.businessesOwned}`, { fontSize: '12px' });
    if (view.incidentName !== null) {
      addLine(`Incident drawn: ${view.incidentName}`, { fontSize: '12px' });
    }

    // ── Actions ─────────────────────────────────────────────────
    const btnY = panelY + panelH - 62;

    // Primary action: resumes the deferred closing flow via onNextTurn.
    // MS-0MW6GPRL6001DFCF: the button sits directly over the middle hand card.
    // After `dismissPanel()` destroys the backdrop, the pointerup event can
    // fall through to that card.  We place an invisible, interactive blocker
    // at a very high depth to absorb the release, then remove it once the next
    // turn's rendering starts.
    const nextTurnBtn = createOverlayButton(s, centerX - 120, btnY, '[ Next Turn ]', 201);
    if (s.hudContainer) s.hudContainer.add(nextTurnBtn);
    nextTurnBtn.on('pointerdown', () => {
      safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
      dismissPanel();
      placePointerBlocker();
      handlers.onNextTurn();
    });
    s.overlayObjects.push(nextTurnBtn);

    // ── [ Bank Loan ] ───────────────────────────────────────────
    // Interactive exactly when the descriptor says the acting seat may borrow:
    // normal colour, `UI_CLICK` SFX and exactly one seam call per press. Every
    // other case (loans off, no configured menu, an active loan, or no
    // descriptor at all) is muted and inert with the descriptor's hint.
    const loanEnabled = model.loanDescriptor?.enabled === true;
    const bankLoanBtn = createOverlayButton(
      s, centerX + 120, btnY,
      '[ Bank Loan ]', 201,
      loanEnabled
        ? undefined
        : { color: UNAVAILABLE_ACTION_COLOUR, hoverColor: UNAVAILABLE_ACTION_COLOUR },
    );
    if (loanEnabled) {
      bankLoanBtn.on('pointerdown', () => {
        safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
        handlers.onBankLoanAction?.();

        // Mid-game loan selector, driven by the configured menu rather than a
        // pending offer. Built before the swap, so a menu that cannot be built
        // (or is empty) leaves this panel on screen instead of opening an
        // empty modal.
        let selector: LoanSelectorModel | null = null;
        try {
          selector = handlers.buildLoanSelector?.() ?? null;
        } catch {
          selector = null;
        }
        if (!selector || selector.rows.length === 0) return;

        // The selected tab survives the post-take re-render (producer Q3=A).
        const selectedTabId = model.selectedTabId;

        /**
         * Re-presents this panel from the **same** result against the live
         * state, keeping the selected tab, so a loan taken in the selector
         * shows up immediately as the disabled `[ Bank Loan ]` with its
         * outstanding-obligation hint.
         */
        const returnToSummary = (): void => {
          const next = handlers.refresh?.(selectedTabId) ?? null;
          if (next && next.tabs.length > 0) model = next;
          redraw();
        };

        /** Draws the selector; `error` is the engine's refusal reason. */
        const openSelector = (error?: string): void => {
          showLoanSelectorDialog(
            s,
            selector!,
            {
              // Confirming takes the loan through the command surface — never
              // by mutating state inline — with the deferred-closing opt-in
              // (the dialog lives in that window).
              onAccept: (optionIndex) => confirmSelection(optionIndex),
              // Cancel closes the selector and re-presents this panel with no
              // state change.
              onCancel: returnToSummary,
            },
            error,
          );
        };

        /**
         * Dispatches `takeLoanCommand` for one menu row, then refreshes in
         * place. AP-neutral and reversible, so no action point is spent and the
         * day never advances. On refusal the engine's reason is shown in the
         * still-open selector and nothing in `s.state` changes.
         */
        const confirmSelection = (optionIndex: number): void => {
          let refusal: string | null = null;
          try {
            // Competitive panels key the take to the human seat (the model's
            // `loanOwnerId`); single-player leaves it undefined so the command
            // keeps its acting-seat default (MS-0MW5X3AYS0072ED3).
            const cmd = takeLoanCommand(
              s.state,
              optionIndex,
              { allowDuringClosing: true },
              model.loanOwnerId,
            );
            if (s.undoManager) {
              s.undoManager.execute(cmd);
            } else {
              cmd.execute();
            }
          } catch (e) {
            console.error('[BankLoan] Failed:', e);
            refusal = (e as Error).message;
          }

          if (refusal !== null) {
            // Public API contract: the engine refuses before any mutation, so
            // there is nothing to roll back — only the reason to surface.
            openSelector(refusal);
            return;
          }

          // The take changed the wallet and booked an obligation: re-render the
          // street/HUD from the post-take state and enable Undo, since the take
          // pushed a reversible command.
          s.refreshAll();
          if (s.undoManager) {
            s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
          }

          returnToSummary();
        };

        // One modal at a time: dismiss this panel before the selector appears,
        // so no Turn Summary control can be pressed behind its backdrop.
        // MS-0MW6GPRL6001DFCF: also place a pointer blocker so pointerup
        // after dismissal never reaches a hand card.
        dismissPanel();
        placePointerBlocker();
        openSelector();
      });
    } else {
      // The muted colour already signals unavailability; disabling input keeps
      // the button inert (no hover, no press, no seam call).
      bankLoanBtn.disableInteractive();
    }
    if (s.hudContainer) s.hudContainer.add(bankLoanBtn);
    s.overlayObjects.push(bankLoanBtn);

    // Reason-specific hint: the descriptor's own copy (loans disabled, no
    // configured options, or the seat's outstanding obligation). Nothing is
    // rendered when the button is enabled, and nothing when there is no
    // descriptor to supply a reason.
    if (!loanEnabled && model.loanDescriptor?.hint) {
      addText(centerX, panelY + panelH - 26, model.loanDescriptor.hint, {
        fontSize: '12px', color: '#998877', fontFamily: FONT_FAMILY, align: 'center',
        wordWrap: { width: panelW - 60 },
      }, 0.5);
    }
  }

  /** Keyboard navigation: Left/Right arrows cycle the players' tabs. */
  function attachKeyboard(): void {
    if (!model.tabsInteractive || model.tabs.length < 2) return;
    const handler = (ev: KeyboardEvent): void => {
      if (!ev) return;
      if (ev.key === 'ArrowRight') selectTabByOffset(1);
      else if (ev.key === 'ArrowLeft') selectTabByOffset(-1);
    };
    if (s.input?.keyboard) {
      s.input.keyboard.on('keydown', handler);
      detachKeyboard = () => {
        try { s.input.keyboard.off('keydown', handler); } catch { /* scene torn down */ }
      };
      return;
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handler as EventListener);
      detachKeyboard = () => window.removeEventListener('keydown', handler as EventListener);
    }
  }

  draw();
  attachKeyboard();
}
