/**
 * Turn Summary dialog — browser overlay tests (MS-0MVP46AMO002SZUT)
 *
 * Verifies the turn summary overlay in a real Phaser scene (child 3 of the
 * end-of-turn-summary epic MS-0MVL6HMDP004WI41):
 *
 * 1. Every surfaced value renders — businesses owned, per-phase income,
 *    per-category ongoing expenses, incident and one-off deltas, the net
 *    change and the closing balances (parent AC2).
 * 2. Overlay pattern compliance — backdrop 199 / box 200 / elements 201,
 *    ALL elements parented into `hudContainer` and pushed into
 *    `s.overlayObjects` for dismissal (AC1/AC2).
 * 3. `[ Next Turn ]` is the primary, interactive button and invokes
 *    `onNextTurn` when pressed (AC3).
 * 4. `[ Bank Loan ]` follows the loans descriptor (MS-0MVXYCJCK006UE62):
 *    interactive (normal colour, `UI_CLICK` SFX, one seam call per press)
 *    exactly when enabled and then with **no** hint line; otherwise muted,
 *    inert and explained by the descriptor's reason-specific hint (loans
 *    disabled / no configured options / the seat's outstanding obligation)
 *    (AC4). An enabled press opens the mid-game loan selector
 *    (MS-0MVXYCJVU000QBK1), whose Cancel re-presents this dialog with no state
 *    change; the selector's own rendering is covered by
 *    `turn-summary-bank-loan.browser.test.ts`.
 * 5. The dialog appears instantly — no fade-in choreography, so it is
 *    reduced-motion safe (AC5).
 * 6. A reduced-motion end-of-turn really does present it
 *    (MS-0MW20KSEG001DH1X): the closing is deferred and gated, the day holds
 *    until `[ Next Turn ]`, and the HUD then shows the post-delta values.
 *
 * The model values themselves are unit-tested Phaser-free in
 * `turn-summary-model.test.ts`; this suite covers the overlay rendering path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { findTurnSummaryNextTurnButton } from './helpers/turn-summary-dialog';
import {
  getBusinessTemplates,
  type BusinessCard,
  type EventCard,
} from '../../src/MainStreetCards';
import type { TurnLedger } from '../../src/MainStreetEngineTypes';
import type { ActiveLoan } from '../../src/MainStreetStateTypes';
import { buildTurnSummary } from '../../src/scenes/MainStreetTurnSummary';
import {
  LOAN_SELECTOR_CANCEL_LABEL,
  LOAN_SELECTOR_TITLE,
  LOANS_DISABLED_HINT,
  NO_LOAN_OPTIONS_HINT,
  buildTurnSummaryLoanDescriptor,
} from '../../src/scenes/MainStreetLoanSelectorModel';
import { formatLoanObligation, loanOwnerId } from '../../src/MainStreetLoans';

/** Muted text colour the unavailable `[ Bank Loan ]` button renders in. */
const MUTED_BUTTON_COLOUR = '#6b6459';

// ── Boot helpers (mirrors event-choice-dialog.browser.test.ts) ──

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

function hudText(s: SceneWithHud, label: string): Phaser.GameObjects.Text | undefined {
  return hudTexts(s).find((t) => t.text === label);
}

/**
 * Finds a text element created by the overlay itself (present in
 * `s.overlayObjects`), so an assertion can never be satisfied by an unrelated
 * HUD label that happens to share the same string.
 */
function overlayText(s: SceneWithHud, label: string): Phaser.GameObjects.Text | undefined {
  const objects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
  return objects.find(
    (o) => o instanceof Phaser.GameObjects.Text && (o as Phaser.GameObjects.Text).text === label,
  ) as Phaser.GameObjects.Text | undefined;
}

/**
 * A hand-built, internally consistent ledger. Income (+140) + expenses (−80)
 * + incident (−40) + one-off (−30) balances the net coin change (−10).
 */
function makeLedger(): TurnLedger {
  return {
    incomeByPhase: { base: 120, synergy: 30, reputation: 10, events: -20 },
    ongoingCosts: { staff: -50, community: -20, business: -10 },
    incidentCoinChange: -40,
    incidentRepChange: -2,
    oneOffDeltas: { coins: -30, reputation: 4 },
    netCoinChange: -10,
    netRepChange: 2,
    netScoreChange: 14,
    businessesOwned: { '0': 3 },
  };
}

/** Builds the summary through the real model (model → overlay path). */
function makeSummary(s: SceneWithHud) {
  const summary = buildTurnSummary(s.state, {
    turnLedger: makeLedger(),
    incident: { name: 'Test Incident' } as EventCard,
  });
  expect(summary).not.toBeNull();
  return summary!;
}

/**
 * Every reason-specific `[ Bank Loan ]` hint currently rendered by the dialog:
 * the two fixed copies plus the active-loan obligation line (which the model
 * builds with `formatLoanObligation()`), so "no hint when enabled" can be
 * asserted without knowing the seat's numbers.
 */
function bankLoanHints(s: SceneWithHud): Phaser.GameObjects.Text[] {
  const objects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
  return objects.filter(
    (o): o is Phaser.GameObjects.Text =>
      o instanceof Phaser.GameObjects.Text &&
      (o.text === LOANS_DISABLED_HINT ||
        o.text === NO_LOAN_OPTIONS_HINT ||
        /^Loan: \d+ coins\/turn, \d+ turns? left$/.test(o.text)),
  );
}

/** An active loan for the acting seat, as `takeLoan` would record it. */
function actingSeatLoan(s: SceneWithHud): ActiveLoan {
  return {
    ownerId: loanOwnerId(s.state),
    principal: 600,
    totalRepayment: 660,
    perTurnRepayment: 110,
    turnsRemaining: 4,
    termTurns: 6,
    takenOnTurn: 1,
  };
}

// ── End-of-turn harness (mirrors income-collection.browser.test.ts) ──

/** A full business card built from the first template, placed on a slot. */
function makeProducingBiz(id: string): BusinessCard {
  const tpl = getBusinessTemplates()[0];
  if (!tpl) throw new Error('No business templates loaded');
  return {
    ...tpl,
    id,
    family: 'business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    appliedUpgrades: [],
    // `applyIncome()` reads the cached per-turn income, which template cards
    // only carry after `syncCardCurrentIncome()` runs.
    currentIncome: 2,
    currentReputationPerTurn: 0,
  };
}

/** Blank the incident deck so no incident (and no reveal hold) resolves. */
function makeIncidentsNone(game: Phaser.Game): void {
  const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
  (s.state as { incidentDeck: unknown[] }).incidentDeck.length = 0;
}

/**
 * Waits until the street container stops being re-rendered (boot-time SVG
 * prewarm rebuilds it). A mid-show re-render would destroy the coin grids.
 */
async function waitForStableStreet(s: SceneWithHud): Promise<void> {
  const street = s.streetContainer as Phaser.GameObjects.Container | undefined;
  let prevRefs: readonly Phaser.GameObjects.GameObject[] = street?.list ?? [];
  let stableSamples = 0;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const cur = street?.list ?? [];
    let same = cur.length === prevRefs.length;
    if (same) {
      for (let j = 0; j < cur.length; j++) {
        if (cur[j] !== prevRefs[j]) {
          same = false;
          break;
        }
      }
    }
    prevRefs = cur;
    stableSamples = same ? stableSamples + 1 : 0;
    if (stableSamples >= 2) return;
  }
}

/** Polls `predicate` until it is true, or throws after `timeoutMs`. */
async function waitForCondition(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 50;
  const label = options.label ?? 'condition';
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

/** Waits (bounded) for the Turn Summary dialog to be presented. */
async function waitForTurnSummaryButton(
  s: SceneWithHud,
  timeoutMs = 30_000,
): Promise<Phaser.GameObjects.Text> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const button = findTurnSummaryNextTurnButton(s);
    if (button) return button;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for the Turn Summary dialog after ${timeoutMs}ms`);
}

describe('Main Street turn-summary dialog overlay (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('renders every surfaced value with 199/200/201 depths and HUD parenting, instantly', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    const summary = makeSummary(s);
    // The live state's descriptor (loans on, no loan, configured menu) — the
    // exact object the Turn Summary gate hands over.
    const descriptor = buildTurnSummaryLoanDescriptor(s.state);
    expect(descriptor.enabled).toBe(true);
    s.showTurnSummaryDialog(summary, () => {}, descriptor);

    // AC5: appears instantly — the dialog is present synchronously after the
    // call (no fade-in tween to await).
    const title = overlayText(s, 'Turn Summary');
    expect(title).toBeDefined();
    expect(title!.depth).toBe(201);
    expect(overlayText(s, `Day ${summary.turn}`)).toBeDefined();

    // ── Income per phase + total ──────────────────────────────
    expect(overlayText(s, 'Income')).toBeDefined();
    expect(overlayText(s, 'Base income: +120')).toBeDefined();
    expect(overlayText(s, 'Synergy income: +30')).toBeDefined();
    expect(overlayText(s, 'Reputation income: +10')).toBeDefined();
    expect(overlayText(s, 'Event income: -20')).toBeDefined();
    expect(overlayText(s, 'Income total: +140')).toBeDefined();

    // ── Ongoing expenses per category + total ─────────────────
    expect(overlayText(s, 'Expenses')).toBeDefined();
    expect(overlayText(s, 'Staff wages: -50')).toBeDefined();
    expect(overlayText(s, 'Community spaces: -20')).toBeDefined();
    expect(overlayText(s, 'Business costs: -10')).toBeDefined();
    expect(overlayText(s, 'Expenses total: -80')).toBeDefined();

    // ── Businesses owned (human seat) ─────────────────────────
    expect(overlayText(s, 'Businesses owned: 3')).toBeDefined();

    // ── Incident delta + resolved incident name ───────────────
    expect(overlayText(s, 'Incident')).toBeDefined();
    expect(overlayText(s, 'Test Incident — Coins -40, Rep -2')).toBeDefined();

    // ── One-off event deltas ──────────────────────────────────
    expect(overlayText(s, 'One-off changes')).toBeDefined();
    expect(overlayText(s, 'Coins -30, Rep +4')).toBeDefined();

    // ── Net change ────────────────────────────────────────────
    expect(overlayText(s, 'Net change')).toBeDefined();
    expect(overlayText(s, 'Coins -10, Rep +2, Score +14')).toBeDefined();

    // ── Closing balances (derived by the model) ───────────────
    expect(overlayText(s, 'Closing balances')).toBeDefined();
    expect(
      overlayText(
        s,
        `Coins ${summary.closing.coins}, Rep ${summary.closing.reputation}, Score ${summary.closing.score}`,
      ),
    ).toBeDefined();

    // ── Buttons: both interactive; enabled Bank Loan carries no hint ──
    const nextTurnBtn = overlayText(s, '[ Next Turn ]');
    const bankLoanBtn = overlayText(s, '[ Bank Loan ]');
    expect(nextTurnBtn).toBeDefined();
    expect(bankLoanBtn).toBeDefined();
    expect(nextTurnBtn!.depth).toBe(201);
    expect(bankLoanBtn!.depth).toBe(201);
    expect(nextTurnBtn!.input?.enabled).toBe(true);
    expect(bankLoanBtn!.input?.enabled).toBe(true);
    // AC5: no hint line at all while the button is enabled.
    expect(bankLoanHints(s)).toHaveLength(0);

    // ── AC2: backdrop 199 / box 200 exist; all text lives in the HUD ──
    const overlayObjects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
    const depths = overlayObjects.map((o) => (o as any).depth);
    expect(depths).toContain(199);
    expect(depths).toContain(200);

    const allHudTexts = hudTexts(s);
    const overlayTexts = overlayObjects.filter(
      (o) => o instanceof Phaser.GameObjects.Text,
    ) as Phaser.GameObjects.Text[];
    // Non-vacuous: the dialog really did create text elements.
    expect(overlayTexts.length).toBeGreaterThan(0);
    for (const text of overlayTexts) {
      expect(allHudTexts).toContain(text);
    }
  }, 30_000);

  it('applies the loans descriptor matrix: enabled fires the seam once per press, every disabled reason stays muted and inert with its hint', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const summary = makeSummary(s);

    let nextTurnCalls = 0;
    let bankLoanCalls = 0;
    const onNextTurn = () => { nextTurnCalls += 1; };
    const onBankLoan = () => { bankLoanCalls += 1; };

    /**
     * Renders a fresh dialog, asserts its hint line (exactly one reason-specific
     * copy, or none), then dismisses it through [ Next Turn ].
     */
    const renderAndDismiss = (
      descriptor: ReturnType<typeof buildTurnSummaryLoanDescriptor> | undefined,
      expectedHint: string | null,
    ): Phaser.GameObjects.Text => {
      s.showTurnSummaryDialog(summary, onNextTurn, descriptor, onBankLoan);
      const btn = overlayText(s, '[ Bank Loan ]')!;
      const hints = bankLoanHints(s);
      if (expectedHint === null) {
        expect(hints).toHaveLength(0);
      } else {
        expect(hints.map((t) => t.text)).toEqual([expectedHint]);
        // Overlay-pattern compliance: a depth-201 element parented in the HUD.
        expect(hints[0].depth).toBe(201);
        expect(hudText(s, expectedHint)).toBe(hints[0]);
      }
      overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
      expect(overlayText(s, 'Turn Summary')).toBeUndefined();
      return btn;
    };

    // ── Enabled: interactive, UI click SFX, exactly one call per press ──
    const playSpy = vi.spyOn(s.sound, 'play');
    s.showTurnSummaryDialog(summary, onNextTurn, buildTurnSummaryLoanDescriptor(s.state), onBankLoan);
    const enabledBtn = overlayText(s, '[ Bank Loan ]')!;
    expect(enabledBtn.input?.enabled).toBe(true);
    expect(enabledBtn.style.color).not.toBe(MUTED_BUTTON_COLOUR);
    // AC5: no hint line at all while the button is enabled.
    expect(bankLoanHints(s)).toHaveLength(0);

    enabledBtn.emit('pointerdown');
    expect(bankLoanCalls).toBe(1);
    expect(playSpy).toHaveBeenCalledWith('sfx-ui-click');
    // The press swaps the panel for the mid-game loan selector
    // (MS-0MVXYCJVU000QBK1): one modal at a time, so the summary's own actions
    // are gone until the selector closes.
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeDefined();
    expect(overlayText(s, '[ Next Turn ]')).toBeUndefined();
    // AC3 still holds: the seam never resumes the closing by itself.
    expect(nextTurnCalls).toBe(0);

    // Cancelling re-presents the summary with no state change, so the button
    // can be pressed again — the seam still fires exactly once per press.
    overlayText(s, LOAN_SELECTOR_CANCEL_LABEL)!.emit('pointerdown');
    expect(overlayText(s, '[ Next Turn ]')).toBeDefined();
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeUndefined();
    overlayText(s, '[ Bank Loan ]')!.emit('pointerdown');
    expect(bankLoanCalls).toBe(2);
    playSpy.mockRestore();
    overlayText(s, LOAN_SELECTOR_CANCEL_LABEL)!.emit('pointerdown');

    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect(nextTurnCalls).toBe(1);
    expect(bankLoanCalls).toBe(2);
    expect((s.overlayObjects ?? []).length).toBe(0);

    // ── Loans disabled in the config: muted, inert, explains the config ──
    (s.state.config as unknown as { loansEnabled: boolean }).loansEnabled = false;
    let btn = renderAndDismiss(buildTurnSummaryLoanDescriptor(s.state), LOANS_DISABLED_HINT);
    expect(btn.input?.enabled).toBeFalsy();
    expect(btn.style.color).toBe(MUTED_BUTTON_COLOUR);
    btn.emit('pointerdown');
    expect(bankLoanCalls).toBe(2); // inert: never fires the seam

    // ── Loans on, but the seat already owes: the obligation is the hint ──
    (s.state.config as unknown as { loansEnabled: boolean }).loansEnabled = true;
    const loan = actingSeatLoan(s);
    s.state.loans = [loan];
    const obligation = formatLoanObligation(loan);
    expect(obligation).toBe('Loan: 110 coins/turn, 4 turns left');
    btn = renderAndDismiss(buildTurnSummaryLoanDescriptor(s.state), obligation);
    expect(btn.input?.enabled).toBeFalsy();
    expect(btn.style.color).toBe(MUTED_BUTTON_COLOUR);
    btn.emit('pointerdown');
    expect(bankLoanCalls).toBe(2);

    // ── No configured menu: nothing to offer ──
    s.state.loans = [];
    (s.state.config as unknown as { loanOptions: readonly never[] }).loanOptions = [];
    btn = renderAndDismiss(buildTurnSummaryLoanDescriptor(s.state), NO_LOAN_OPTIONS_HINT);
    expect(btn.input?.enabled).toBeFalsy();
    expect(btn.style.color).toBe(MUTED_BUTTON_COLOUR);
    btn.emit('pointerdown');
    expect(bankLoanCalls).toBe(2);

    // ── No descriptor (legacy/hand-built state): disabled, no known reason ──
    btn = renderAndDismiss(undefined, null);
    expect(btn.input?.enabled).toBeFalsy();
    expect(btn.style.color).toBe(MUTED_BUTTON_COLOUR);
    btn.emit('pointerdown');
    expect(bankLoanCalls).toBe(2);

    // One dismissal per rendered dialog, never more.
    expect(nextTurnCalls).toBe(5);
  }, 30_000);

  it('forwards the loans descriptor to the overlay manager unchanged, and the headless branch advances once with no UI', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    const summary = makeSummary(s);
    // Built from the live scene state — exactly what the gate hands over.
    const descriptor = buildTurnSummaryLoanDescriptor(s.state);
    const manager = s.msOverlayManager;
    let nextTurnCalls = 0;

    // ── Delegation: the descriptor reaches the overlay manager by identity ──
    // The spy stubs the render so the scene stays UI-free for the headless
    // half of this case (no stale dialog to confuse the "creates no UI" check).
    const spy = vi
      .spyOn(manager, 'showTurnSummaryDialog')
      .mockImplementation(() => {});
    s.showTurnSummaryDialog(summary, () => { nextTurnCalls += 1; }, descriptor);
    expect(spy).toHaveBeenCalledTimes(1);
    const [forwardedSummary, , forwardedDescriptor] = spy.mock.calls[0];
    expect(forwardedSummary).toBe(summary);
    expect(forwardedDescriptor).toBe(descriptor);
    // The dialog holds the day until [ Next Turn ] — the delegation itself
    // never resumes the closing.
    expect(nextTurnCalls).toBe(0);
    spy.mockRestore();

    // ── Headless (no overlay manager): advance exactly once, create no UI ──
    s.msOverlayManager = undefined;
    const overlayObjectsBefore = (s.overlayObjects ?? []).length;
    const hudChildrenBefore = s.hudContainer.list.length;
    s.showTurnSummaryDialog(summary, () => { nextTurnCalls += 1; }, descriptor);
    expect(nextTurnCalls).toBe(1);
    expect((s.overlayObjects ?? []).length).toBe(overlayObjectsBefore);
    expect(s.hudContainer.list.length).toBe(hudChildrenBefore);
    expect(overlayText(s, 'Turn Summary')).toBeUndefined();

    s.msOverlayManager = manager;
  }, 30_000);

  /**
   * MS-0MW20KSEG001DH1X: reduced motion used to suppress the dialog twice over
   * — the display gate returned early for it, and `endTurn` never took the
   * deferred path it gates on. Both are fixed, so a reduced-motion end-of-turn
   * now presents the summary and the day waits for `[ Next Turn ]`.
   */
  it('presents the dialog after a reduced-motion end-of-turn and advances once on [ Next Turn ]', async () => {
    game = await bootGame();
    makeIncidentsNone(game);
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    // The real preference (the panel's private backing field, as the other
    // reduced-motion browser suites set it).
    (s.settingsPanel as { _reducedMotion: boolean })._reducedMotion = true;

    // Let the boot-time SVG prewarm's deferred refreshAll() settle — a
    // mid-show re-render would destroy the coin grids.
    await (s as unknown as { prewarmVisibleCardTextures: () => Promise<unknown> })
      .prewarmVisibleCardTextures();
    await waitForStableStreet(s);

    const state = s.state as unknown as {
      streetGrid: Array<BusinessCard | null>;
      turn: number;
      phase: string;
      resourceBank: { coins: number };
    };
    state.streetGrid[0] = makeProducingBiz('biz-reduced-motion-summary');
    s.refreshAll();

    const turnBefore = state.turn;
    const coinsBefore = state.resourceBank.coins;

    (s.msTurnController as unknown as { endTurn: () => void }).endTurn();

    // The closing is deferred (the phased show started and the resource
    // deltas have NOT landed yet), which is what gives the gate something to
    // gate — the bug was that reduced motion took the immediate path here.
    expect(s.incomeCollectionActive).toBe(true);
    expect(state.resourceBank.coins).toBe(coinsBefore);

    // The dialog is presented once the closing completes, and the day has
    // not advanced while it is up.
    const button = await waitForTurnSummaryButton(s);
    expect(state.turn).toBe(turnBefore);

    button.emit('pointerdown');
    expect(findTurnSummaryNextTurnButton(s)).toBeNull();

    // [ Next Turn ] resumes the deferred closing exactly once: the day
    // advances and the HUD renders the post-delta values.
    await waitForCondition(
      () => state.turn === turnBefore + 1 && state.phase === 'MarketPhase',
      { timeoutMs: 20_000, label: 'the day to start after [ Next Turn ]' },
    );
    expect(state.turn).toBe(turnBefore + 1);
    expect(state.phase).toBe('MarketPhase');
    expect(state.resourceBank.coins).toBeGreaterThan(coinsBefore);

    const hudCoins = hudTexts(s).find((t) => t.text.startsWith('Coins: '));
    expect(hudCoins?.text).toBe(`Coins: ${state.resourceBank.coins}`);
  }, 60_000);
});
