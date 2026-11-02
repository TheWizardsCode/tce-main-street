/**
 * Mid-game loan selector dialog — browser overlay tests
 * (MS-0MVXYCJVU000QBK1 + MS-0MVXYCKFE000VF76, parent MS-0MVPWSQMG004198C)
 *
 * Verifies, in a real Phaser scene, that pressing the Turn Summary dialog's
 * enabled `[ Bank Loan ]` opens the mid-game loan selector — the same
 * renderer as the bankruptcy bailout dialog, in its `select` mode — and that
 * confirming a row takes the loan through the command surface:
 *
 * 1. The selector lists every configured `config.loanOptions` entry with its
 *    per-turn and total repayment, plus a Cancel action (parent AC2).
 * 2. Cancel dismisses the selector and re-presents the Turn Summary dialog
 *    with **no** state change (`turn`, `resourceBank`, `loans` and
 *    `actionsRemaining` untouched — the day never advances without
 *    `[ Next Turn ]`) (parent AC2).
 * 3. Option-row rendering is genuinely shared: for the same menu the
 *    selector's rows carry exactly the bailout dialog's labels, depths and
 *    HUD parenting, and the selector's alternative action is the benign
 *    `[ Cancel ]` rather than the bailout's `[ Decline — end the run ]`
 *    (parent AC4).
 * 4. The selector is driven by the configured menu only — a lingering
 *    `state.pendingLoanOffer` never leaks into it.
 * 5. Overlay conventions hold: backdrop 199 / box 200 / elements 201, every
 *    element parented into `s.hudContainer` and tracked in `s.overlayObjects`,
 *    instant appearance, and no UI at all in `replayMode` (parent AC5).
 * 6. Confirming an option dispatches `takeLoanCommand` for the acting seat —
 *    the principal is credited and the loan recorded even though the scene is
 *    parked in the deferred-closing window (the closing-window opt-in) — with
 *    `actionsRemaining`/`bankedActions` untouched and no day advance
 *    (MS-0MVXYCKFE000VF76).
 * 7. The Turn Summary dialog is re-rendered in place from the **same**
 *    `TurnResult` with the post-take state: the button is disabled with the
 *    outstanding-obligation hint, `[ Next Turn ]` still resumes the closing,
 *    and exactly one `[ Next Turn ]` / `[ Bank Loan ]` pair remains
 *    (no overlay-object leak).
 * 8. An engine refusal (a race into an active loan) is surfaced as the
 *    engine's own reason in the dialog, which stays open, with no state
 *    change.
 *
 * The selector's content model is unit-tested Phaser-free in
 * `turn-summary-bank-loan.test.ts`; this suite covers the rendering path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import type { EventCard } from '../../src/MainStreetCards';
import type { TurnLedger } from '../../src/MainStreetEngineTypes';
import {
  DEFAULT_LOAN_OPTIONS,
  canTakeLoan,
  formatLoanObligation,
  loanOwnerId,
  loanPerTurnRepayment,
  loanTotalRepayment,
} from '../../src/MainStreetLoans';
import { buildLoanOfferModel } from '../../src/scenes/MainStreetLoanOverlayModel';
import { resolveLoanInterestRate } from '../../src/scenes/MainStreetLoanRowModel';
import {
  LOAN_SELECTOR_CANCEL_LABEL,
  LOAN_SELECTOR_TITLE,
  buildLoanSelectorModel,
  buildTurnSummaryLoanDescriptor,
} from '../../src/scenes/MainStreetLoanSelectorModel';
import { buildTurnSummary } from '../../src/scenes/MainStreetTurnSummary';

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

/** All overlay-created text objects. */
function overlayTexts(s: SceneWithHud): Phaser.GameObjects.Text[] {
  const objects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
  return objects.filter(
    (o) => o instanceof Phaser.GameObjects.Text,
  ) as Phaser.GameObjects.Text[];
}

/**
 * A hand-built, internally consistent ledger (mirrors the Turn Summary
 * dialog suite) — only its presence matters here: the selector must never
 * mutate the state the summary was built from.
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

/** Builds the closed turn's result — the object the closing gate hands over. */
function makeResult() {
  return {
    turnLedger: makeLedger(),
    incident: { name: 'Test Incident' } as EventCard,
  };
}

/** Builds the summary through the real model (model → overlay path). */
function makeSummary(s: SceneWithHud, result = makeResult()) {
  const summary = buildTurnSummary(s.state, result);
  expect(summary).not.toBeNull();
  return summary!;
}

/**
 * The state the player must not lose by opening/cancelling the selector:
 * the day, the wallet, the loan book and the action budget.
 */
function stateFingerprint(s: SceneWithHud): string {
  return JSON.stringify({
    turn: s.state.turn,
    resourceBank: s.state.resourceBank,
    loans: s.state.loans,
    actionsRemaining: s.state.actionsRemaining,
  });
}

/**
 * Renders the Turn Summary dialog the way the closing gate does — including the
 * committed `TurnResult`, so a post-take refresh can rebuild from it.
 */
function showSummary(
  s: SceneWithHud,
  onNextTurn: () => void = () => {},
  result = makeResult(),
): void {
  const descriptor = buildTurnSummaryLoanDescriptor(s.state);
  expect(descriptor.enabled).toBe(true);
  s.showTurnSummaryDialog(
    buildTurnSummary(s.state, result)!,
    onNextTurn,
    descriptor,
    undefined,
    result,
  );
}

/** Presses the Turn Summary dialog's `[ Bank Loan ]` and returns the selector model used. */
function openSelector(s: SceneWithHud) {
  const expected = buildLoanSelectorModel(s.state);
  const btn = overlayText(s, '[ Bank Loan ]');
  expect(btn).toBeDefined();
  expect(btn!.input?.enabled).toBe(true);
  btn!.emit('pointerdown');
  return expected;
}

/** How many elements carrying exactly `label` live in `pool`. */
function countLabel(pool: Phaser.GameObjects.Text[], label: string): number {
  return pool.filter((text) => text.text === label).length;
}

describe('Main Street mid-game loan selector (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('pressing the enabled [ Bank Loan ] opens the selector with every configured option, its repayments and a Cancel action', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    showSummary(s);
    const model = openSelector(s);

    // The selector replaced the Turn Summary dialog (single modal, no stack):
    // nothing beneath it can be pressed while it is open.
    expect(overlayText(s, 'Turn Summary')).toBeUndefined();
    expect(overlayText(s, '[ Next Turn ]')).toBeUndefined();

    // AC1: one row per configured option, priced with the shipped arithmetic.
    const state = s.state as {
      config: { loanOptions: typeof DEFAULT_LOAN_OPTIONS; loanInterestRate: number };
    };
    expect(model.rows).toHaveLength(state.config.loanOptions.length);
    expect(model.rows.length).toBeGreaterThan(0);
    const rate = resolveLoanInterestRate(state.config);
    model.rows.forEach((row, index) => {
      const option = state.config.loanOptions[index];
      const total = loanTotalRepayment(option.principal, rate);
      expect(row.principal).toBe(option.principal);
      expect(row.termTurns).toBe(option.termTurns);
      expect(row.totalRepayment).toBe(total);
      expect(row.perTurnRepayment).toBe(loanPerTurnRepayment(total, option.termTurns));
      // The row's self-contained label carries the per-turn and total figures.
      expect(row.label).toContain(`€${row.perTurnRepayment}/turn`);
      expect(row.label).toContain(`€${row.totalRepayment} total`);
      const text = overlayText(s, row.label);
      expect(text).toBeDefined();
      expect(text!.depth).toBe(201);
    });

    // The selector's own title/intro and the benign back-out action.
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeDefined();
    expect(overlayText(s, LOAN_SELECTOR_CANCEL_LABEL)).toBeDefined();
    // AC4: the bailout's run-ending Decline never appears in select mode.
    expect(overlayText(s, '[ Decline — end the run ]')).toBeUndefined();

    // AC5: instant appearance (no fade-in), backdrop 199 / box 200 / elements
    // 201, and every element parented into the HUD.
    const overlayObjects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
    const depths = overlayObjects.map((o) => (o as any).depth);
    expect(depths).toContain(199);
    expect(depths).toContain(200);
    const allHudTexts = hudTexts(s);
    const texts = overlayTexts(s);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(allHudTexts).toContain(text);
    }

    // One interactive button per option, plus Cancel.
    const interactive = texts.filter((t) => t.input?.enabled === true);
    expect(interactive).toHaveLength(model.rows.length + 1);
  }, 30_000);

  it('Cancel dismisses the selector and re-presents the Turn Summary dialog with no state change', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    const before = stateFingerprint(s);
    const dayBefore = s.state.turn;

    showSummary(s);
    openSelector(s);

    // Back out: exactly one Cancel control closes the selector.
    overlayText(s, LOAN_SELECTOR_CANCEL_LABEL)!.emit('pointerdown');

    // The selector is gone and the Turn Summary dialog is presented again.
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeUndefined();
    expect(overlayText(s, LOAN_SELECTOR_CANCEL_LABEL)).toBeUndefined();
    expect(overlayText(s, 'Turn Summary')).toBeDefined();
    expect(overlayText(s, '[ Next Turn ]')).toBeDefined();
    expect(overlayText(s, '[ Bank Loan ]')).toBeDefined();

    // No leak: exactly one [ Next Turn ] / [ Bank Loan ] pair after the swap.
    expect(overlayTexts(s).filter((t) => t.text === '[ Next Turn ]')).toHaveLength(1);
    expect(overlayTexts(s).filter((t) => t.text === '[ Bank Loan ]')).toHaveLength(1);

    // No state change at all: nothing taken, nothing spent, no day advance.
    expect(stateFingerprint(s)).toBe(before);
    expect(s.state.turn).toBe(dayBefore);

    // The re-presented dialog works: the button still opens the selector.
    openSelector(s);
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeDefined();
  }, 30_000);

  it('shares the bailout dialog row rendering: identical labels, depths and HUD parenting for the same menu', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    showSummary(s);
    const selectorModel = openSelector(s);
    const selectorRows = selectorModel.rows.map((row) => overlayText(s, row.label)!);
    const selectorDepths = selectorRows.map((row) => row.depth);
    const hudAfterSelector = hudTexts(s);
    for (const row of selectorRows) expect(hudAfterSelector).toContain(row);
    overlayText(s, LOAN_SELECTOR_CANCEL_LABEL)!.emit('pointerdown');

    // The bailout dialog presenting the same menu: its rows must be the same
    // labels (one shared row builder + one shared row renderer), which a
    // duplicated loop would drift from.
    const bailoutModel = buildLoanOfferModel({
      pendingLoanOffer: {
        ownerId: 0,
        reason: 'bankruptcy',
        options: (s.state as any).config.loanOptions.map((option: any) => ({ ...option })),
      },
      config: { loanInterestRate: (s.state as any).config.loanInterestRate },
    } as any);
    expect(bailoutModel).not.toBeNull();
    // Dismiss the re-presented Turn Summary dialog so only the bailout dialog
    // is on screen.
    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    s.showLoanOfferDialog(bailoutModel!, () => {}, () => {});

    const bailoutRows = bailoutModel!.rows.map((row) => overlayText(s, row.label)!);
    expect(bailoutRows.map((row) => row.text)).toEqual(selectorRows.map((row) => row.text));
    expect(bailoutRows.map((row) => row.depth)).toEqual(selectorDepths);
    const hudAfterBailout = hudTexts(s);
    for (const row of bailoutRows) expect(hudAfterBailout).toContain(row);
    // The bailout keeps its own alternative action (AC3: unchanged).
    expect(overlayText(s, bailoutModel!.declineLabel)).toBeDefined();
  }, 30_000);

  it('is driven by the configured menu only — a lingering pendingLoanOffer never leaks in', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    const menu = (s.state as any).config.loanOptions as typeof DEFAULT_LOAN_OPTIONS;
    // A stale/foreign bailout offer with a different, single option.
    (s.state as any).pendingLoanOffer = {
      ownerId: 0,
      reason: 'bankruptcy',
      options: [{ principal: 750, termTurns: 5 }],
      shortfall: 900,
    };

    showSummary(s);
    const model = openSelector(s);

    // Still one row per configured option — never the pending offer's menu.
    expect(model.rows).toHaveLength(menu.length);
    model.rows.forEach((row, index) => {
      expect(row.principal).toBe(menu[index].principal);
      expect(overlayText(s, row.label)).toBeDefined();
    });
    expect(overlayTexts(s).some((t) => t.text.includes('€750'))).toBe(false);
    expect(overlayTexts(s).some((t) => t.text.includes('covers the gap'))).toBe(false);

    (s.state as any).pendingLoanOffer = undefined;
  }, 30_000);

  it('presents no UI at all in replayMode', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    const before = (s.overlayObjects ?? []).length;
    s.replayMode = true;
    try {
      // The Turn Summary dialog never presents in replay/headless, so the
      // selector cannot be reached through it — and its own renderer refuses
      // even when invoked directly.
      s.showTurnSummaryDialog(makeSummary(s), () => {}, buildTurnSummaryLoanDescriptor(s.state));
      expect(overlayText(s, 'Turn Summary')).toBeUndefined();
      expect(overlayText(s, '[ Bank Loan ]')).toBeUndefined();

      s.msOverlayManager.showLoanSelectorDialog(buildLoanSelectorModel(s.state), {
        onAccept: () => {},
        onCancel: () => {},
      });
      expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeUndefined();
      expect(overlayText(s, LOAN_SELECTOR_CANCEL_LABEL)).toBeUndefined();
    } finally {
      s.replayMode = false;
    }
    expect((s.overlayObjects ?? []).length).toBe(before);
  }, 30_000);

  it('confirming an option dispatches takeLoanCommand for the acting seat: principal credited, loan recorded, no action spent, no day advance', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    // Emulate the real window: the Turn Summary gate runs while the closing is
    // parked outside `MarketPhase`, so the take only succeeds through the
    // command's closing-window opt-in (MS-0MVXYCIU00053HL1).
    s.state.phase = 'IncidentPhase';

    const seat = loanOwnerId(s.state);
    const coinsBefore = s.state.resourceBank.coins;
    const actionsBefore = s.state.actionsRemaining;
    const bankedBefore = s.state.bankedActions;
    const dayBefore = s.state.turn;
    expect(s.state.loans ?? []).toHaveLength(0);

    let nextTurnCalls = 0;
    showSummary(s, () => { nextTurnCalls += 1; });
    const model = openSelector(s);
    const option = (s.state as any).config.loanOptions[0] as { principal: number };

    const playSpy = vi.spyOn(s.sound, 'play');
    overlayText(s, model.rows[0].label)!.emit('pointerdown');
    expect(playSpy).toHaveBeenCalledWith('sfx-ui-click');
    playSpy.mockRestore();

    // The command surface ran: the principal landed on the acting seat's wallet
    // and the obligation is on the loan book.
    expect(s.state.resourceBank.coins).toBe(coinsBefore + option.principal);
    expect(s.state.loans).toHaveLength(1);
    expect(s.state.loans![0]).toMatchObject({
      ownerId: seat,
      principal: option.principal,
    });
    // AP-neutral (parent AC3) and the day never advances on a take.
    expect(s.state.actionsRemaining).toBe(actionsBefore);
    expect(s.state.bankedActions).toBe(bankedBefore);
    expect(s.state.turn).toBe(dayBefore);
    expect(nextTurnCalls).toBe(0);

    // Dispatched through the command surface (reversible), never an inline
    // mutation: undoing the last command removes the loan and restores the
    // wallet to its pre-take balance.
    s.undoManager.undo();
    expect(s.state.loans ?? []).toHaveLength(0);
    expect(s.state.resourceBank.coins).toBe(coinsBefore);
  }, 30_000);

  it('re-renders the Turn Summary dialog in place from the same TurnResult: obligation hint, one [ Next Turn ] pair, closing resumed only by [ Next Turn ]', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    s.state.phase = 'IncidentPhase';
    const dayBefore = s.state.turn;
    let nextTurnCalls = 0;
    showSummary(s, () => { nextTurnCalls += 1; });
    const model = openSelector(s);
    overlayText(s, model.rows[0].label)!.emit('pointerdown');

    // Back to the summary, rebuilt from the post-take state: the selector and
    // its rows are gone.
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeUndefined();
    expect(overlayText(s, LOAN_SELECTOR_CANCEL_LABEL)).toBeUndefined();
    expect(model.rows.every((row) => overlayText(s, row.label) === undefined)).toBe(true);
    expect(overlayText(s, 'Turn Summary')).toBeDefined();
    expect(overlayText(s, `Day ${dayBefore}`)).toBeDefined();

    // AC5: the refreshed panel shows the new obligation and the one-active-loan
    // rule now disables the button with the descriptor's own hint.
    const expectedHint = formatLoanObligation(s.state.loans![0]);
    const bankLoanBtn = overlayText(s, '[ Bank Loan ]')!;
    expect(bankLoanBtn).toBeDefined();
    expect(bankLoanBtn.input?.enabled).toBeFalsy();
    expect(overlayText(s, expectedHint)).toBeDefined();

    // The refreshed dialog is inert for borrowing, so pressing it cannot open
    // the selector a second time (nothing to take anyway).
    bankLoanBtn.emit('pointerdown');
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeUndefined();

    // Leak check: exactly one [ Next Turn ] / [ Bank Loan ] pair survives the
    // selector → summary swap, tracked in `overlayObjects` and parented in the
    // HUD container.
    const overlayTextsNow = overlayTexts(s);
    expect(countLabel(overlayTextsNow, '[ Next Turn ]')).toBe(1);
    expect(countLabel(overlayTextsNow, '[ Bank Loan ]')).toBe(1);
    expect(countLabel(hudTexts(s), '[ Next Turn ]')).toBe(1);
    expect(countLabel(hudTexts(s), '[ Bank Loan ]')).toBe(1);

    // The take still never resumed the closing; [ Next Turn ] does, exactly once.
    expect(nextTurnCalls).toBe(0);
    expect(s.state.turn).toBe(dayBefore);
    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect(nextTurnCalls).toBe(1);
    expect((s.overlayObjects ?? []).length).toBe(0);
  }, 30_000);

  it('surfaces an engine refusal as the engine\'s own reason in the dialog, which stays open with no state change', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    s.state.phase = 'IncidentPhase';
    let nextTurnCalls = 0;
    showSummary(s, () => { nextTurnCalls += 1; });
    const model = openSelector(s);

    // The race the AC names: another path books a loan for this seat after the
    // button was enabled and before the confirm lands.
    s.state.loans = [{
      ownerId: loanOwnerId(s.state),
      principal: 600,
      totalRepayment: 660,
      perTurnRepayment: 110,
      turnsRemaining: 4,
      termTurns: 6,
      takenOnTurn: 1,
    }];
    const before = stateFingerprint(s);
    const reason = canTakeLoan(s.state, 0, undefined, { allowDuringClosing: true });
    expect(reason.legal).toBe(false);
    const engineReason = (reason as { reason: string }).reason;

    overlayText(s, model.rows[0].label)!.emit('pointerdown');

    // The engine's reason is shown inside the still-open dialog — not a generic
    // message, and not a silent dismissal.
    expect(overlayText(s, engineReason)).toBeDefined();
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeDefined();
    expect(overlayText(s, LOAN_SELECTOR_CANCEL_LABEL)).toBeDefined();
    model.rows.forEach((row) => {
      expect(overlayText(s, row.label)).toBeDefined();
    });

    // Refused before any mutation: nothing credited, nothing booked, no action
    // spent, no day advance, and the closing is not resumed.
    expect(stateFingerprint(s)).toBe(before);
    expect(s.state.loans).toHaveLength(1);
    expect(nextTurnCalls).toBe(0);

    // Backing out still works from the refusal state, with no state change.
    overlayText(s, LOAN_SELECTOR_CANCEL_LABEL)!.emit('pointerdown');
    expect(overlayText(s, 'Turn Summary')).toBeDefined();
    expect(stateFingerprint(s)).toBe(before);
  }, 30_000);
});
