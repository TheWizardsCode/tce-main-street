/**
 * Competitive Turn Summary dialog — browser overlay tests (MS-0MVRNV9Y8008IKGK)
 *
 * Verifies the competitive per-seat Turn Summary panel in a real Phaser scene:
 *
 * 1. One tab per seat, in seat order, rendering the panel model's own labels
 *    and seat colours (the competitive scoreboard's `You` / `AI n` +
 *    `resolveSeatColour` values) with the human ("You") tab selected by
 *    default; selecting another seat's tab switches the whole statement body
 *    to that seat's P&L — income and expenses with their totals, the incident
 *    / one-off adjustments, the net profit/loss and the supplementary context
 *    (reputation/score change, closing balances, businesses owned).
 * 2. Overlay pattern compliance — backdrop 199 / box 200 / elements 201, every
 *    element parented into `hudContainer` and pushed into `s.overlayObjects`
 *    for dismissal.
 * 3. `[ Next Turn ]` is the primary, interactive button and invokes
 *    `onNextTurn` exactly once; it is the only way the day advances.
 * 4. `[ Bank Loan ]` is **always disabled** in competitive play, muted and
 *    inert with its explanatory hint — the `onBankLoanAction` seam is shaped
 *    for per-seat enablement (MS-0MVL6DZI0000F6CG) but never wired here.
 * 5. The panel appears instantly (no fade-in), so reduced-motion safety is
 *    inherited rather than re-implemented.
 *
 * The panel model is unit-tested Phaser-free in
 * `turn-summary-competitive-model.test.ts`, and the closing gate in
 * `competitive-turn-summary-gate.test.ts`; this suite covers the overlay.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import {
  buildCompetitiveTurnSummary,
  type CompetitiveTurnSummary,
} from '../../src/scenes/MainStreetTurnSummary';
import {
  LOAN_SELECTOR_TITLE,
  LOANS_DISABLED_HINT,
  buildLoanSelectorModel,
} from '../../src/scenes/MainStreetLoanSelectorModel';
import type { CompetitiveRoundLedger } from '../../src/MainStreetEngineTypes';
import { createCompetitiveState } from '../../src/MainStreetState';

/** Muted text colour the unavailable `[ Bank Loan ]` button renders in. */
const MUTED_BUTTON_COLOUR = '#6b6459';

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

/** A text element created by the overlay itself (present in `overlayObjects`). */
function overlayText(s: SceneWithHud, label: string): Phaser.GameObjects.Text | undefined {
  const objects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
  return objects.find(
    (o) => o instanceof Phaser.GameObjects.Text && (o as Phaser.GameObjects.Text).text === label,
  ) as Phaser.GameObjects.Text | undefined;
}

/** A hand-built, internally consistent competitive round ledger. */
function makeLedger(): CompetitiveRoundLedger {
  return {
    turn: 7,
    seats: [
      {
        ownerId: 0,
        businessesOwned: 3,
        incomeByPhase: { base: 12, synergy: 4, reputation: 2, events: -1 },
        incomeTotal: 17,
        ongoingCosts: { staff: -3, community: -1, business: -2 },
        dayStart: { coins: 40, reputation: 2, score: 10 },
        closing: { coins: 49, reputation: 3, score: 13 },
        netCoinChange: 9,
        netRepChange: 1,
        netScoreChange: 3,
        incidentCoinChange: -2,
        incidentRepChange: -1,
        oneOffDeltas: { coins: 0, reputation: 1 },
      },
      {
        ownerId: 1,
        businessesOwned: 2,
        incomeByPhase: { base: 8, synergy: 0, reputation: 1, events: 0 },
        incomeTotal: 9,
        // A seat that spent nothing still shows all three expense rows at 0.
        ongoingCosts: { staff: 0, community: 0, business: 0 },
        dayStart: { coins: 18, reputation: 0, score: 0 },
        closing: { coins: 23, reputation: 0, score: 5 },
        netCoinChange: 5,
        netRepChange: 0,
        netScoreChange: 5,
        incidentCoinChange: 0,
        incidentRepChange: 0,
        oneOffDeltas: { coins: -4, reputation: 0 },
      },
    ],
  };
}

/**
 * Builds the panel model through the real Phaser-free builder for a two-seat
 * competitive state (so labels and colours are the shipped conventions).
 */
function makeSummary(): { summary: CompetitiveTurnSummary; colours: string[] } {
  const state = createCompetitiveState({
    seed: 'competitive-summary-overlay',
    playerCount: 2,
    difficulty: 'Easy',
    loansEnabled: false,
  });
  const summary = buildCompetitiveTurnSummary(state, {
    playerRoundLedger: makeLedger(),
    incident: null,
  });
  expect(summary).not.toBeNull();
  const colours = (state.players ?? []).map((player) => player.colour ?? '');
  return { summary: summary!, colours };
}

/**
 * Enables loans on the scene's live state for the mid-game selector flow and
 * parks it in the deferred-closing pause, exactly like the single-player
 * browser suite does before a take.
 */
function enableLoansForTake(s: SceneWithHud): void {
  (s.state as any).config = { ...(s.state as any).config, loansEnabled: true };
  s.state.phase = 'IncidentPhase';
}

describe('Main Street competitive turn-summary dialog overlay (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('renders one row per seat with the panel model values, 199/200/201 depths and HUD parenting, instantly', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const { summary, colours } = makeSummary();

    s.showCompetitiveTurnSummaryDialog(summary, () => {});

    // Instant appearance (AC5): present synchronously, no fade-in.
    const title = overlayText(s, 'Turn Summary');
    expect(title).toBeDefined();
    expect(title!.depth).toBe(201);
    expect(overlayText(s, `Day ${summary.turn}`)).toBeDefined();

    // ── Tab strip: one tab per seat, human ("You") tab selected by default ──
    const humanTab = overlayText(s, '[ You ]');
    const aiTab = overlayText(s, 'AI 1');
    expect(humanTab).toBeDefined();
    expect(aiTab).toBeDefined();
    expect(humanTab!.depth).toBe(201);
    expect(aiTab!.depth).toBe(201);
    // Reused seat colours, not an ad-hoc palette.
    expect(humanTab!.style.color).toBe(colours[0]);
    expect(aiTab!.style.color).toBe(colours[1]);
    expect(humanTab!.style.color).not.toBe(aiTab!.style.color);

    // ── The default statement is the human seat's own P&L ────────
    expect(overlayText(s, 'Businesses owned: 3')).toBeDefined();
    expect(overlayText(s, 'Base income: +12')).toBeDefined();
    expect(overlayText(s, 'Total income: +17')).toBeDefined();
    expect(overlayText(s, 'Staff wages: -3')).toBeDefined();
    expect(overlayText(s, 'Total operating expenses: -6')).toBeDefined();
    expect(overlayText(s, 'Incident: Coins -2, Rep -1')).toBeDefined();
    expect(overlayText(s, 'One-off: Coins 0, Rep +1')).toBeDefined();
    expect(overlayText(s, 'Net profit/loss: +9')).toBeDefined();
    expect(overlayText(s, 'Reputation change: +1 · Score change: +3')).toBeDefined();
    expect(overlayText(s, 'Closing coins: 49 · Closing Rep 3 · Score 13')).toBeDefined();

    // ── Selecting the AI tab switches the whole statement body ───
    aiTab!.emit('pointerdown');
    expect(overlayText(s, '[ AI 1 ]')).toBeDefined();
    // A seat that spent nothing still renders all three expense rows at 0
    // (MS-0MVRNVHJ50095N9Y), in the single-player panel's signed formatting.
    expect(overlayText(s, 'Businesses owned: 2')).toBeDefined();
    expect(overlayText(s, 'Base income: +8')).toBeDefined();
    expect(overlayText(s, 'Total income: +9')).toBeDefined();
    expect(overlayText(s, 'Staff wages: 0')).toBeDefined();
    expect(overlayText(s, 'Community spaces: 0')).toBeDefined();
    expect(overlayText(s, 'Business costs: 0')).toBeDefined();
    expect(overlayText(s, 'Total operating expenses: 0')).toBeDefined();
    expect(overlayText(s, 'Incident: Coins 0, Rep 0')).toBeDefined();
    expect(overlayText(s, 'One-off: Coins -4, Rep 0')).toBeDefined();
    expect(overlayText(s, 'Net profit/loss: +5')).toBeDefined();
    expect(overlayText(s, 'Reputation change: 0 · Score change: +5')).toBeDefined();
    expect(overlayText(s, 'Closing coins: 23 · Closing Rep 0 · Score 5')).toBeDefined();
    // The human seat's figures are gone — the body really switched.
    expect(overlayText(s, 'Businesses owned: 3')).toBeUndefined();
    expect(overlayText(s, 'Net profit/loss: +9')).toBeUndefined();

    // ── Buttons ───────────────────────────────────────────────
    const nextTurnBtn = overlayText(s, '[ Next Turn ]');
    const bankLoanBtn = overlayText(s, '[ Bank Loan ]');
    expect(nextTurnBtn).toBeDefined();
    expect(bankLoanBtn).toBeDefined();
    expect(nextTurnBtn!.depth).toBe(201);
    expect(bankLoanBtn!.depth).toBe(201);
    expect(nextTurnBtn!.input?.enabled).toBe(true);
    // The fixture runs with `loansEnabled: false`, so the descriptor-driven
    // button is disabled, muted and inert with the loans-disabled hint
    // (MS-0MW4YUHOU00474HZ AC1: same rules as single-player).
    expect(bankLoanBtn!.input?.enabled).toBeFalsy();
    expect(bankLoanBtn!.style.color).toBe(MUTED_BUTTON_COLOUR);
    expect(overlayText(s, LOANS_DISABLED_HINT)).toBeDefined();

    // ── Backdrop 199 / box 200; every text parented in the HUD ──
    const overlayObjects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
    const depths = overlayObjects.map((o) => (o as any).depth);
    expect(depths).toContain(199);
    expect(depths).toContain(200);

    const allHudTexts = hudTexts(s);
    const overlayTexts = overlayObjects.filter(
      (o) => o instanceof Phaser.GameObjects.Text,
    ) as Phaser.GameObjects.Text[];
    expect(overlayTexts.length).toBeGreaterThan(0);
    for (const text of overlayTexts) {
      expect(allHudTexts).toContain(text);
    }
  }, 30_000);

  it('advances only on [ Next Turn ] and never wires the disabled [ Bank Loan ] seam', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const { summary } = makeSummary();

    let nextTurnCalls = 0;
    const onBankLoanAction = vi.fn();
    s.showCompetitiveTurnSummaryDialog(summary, () => { nextTurnCalls += 1; }, onBankLoanAction);

    // A disabled button is inert — pressing it neither fires the seam nor
    // advances the day (the loans-disabled descriptor disables it).
    overlayText(s, '[ Bank Loan ]')!.emit('pointerdown');
    expect(onBankLoanAction).not.toHaveBeenCalled();
    expect(nextTurnCalls).toBe(0);
    expect(overlayText(s, 'Turn Summary')).toBeDefined();

    // The seam keeps its per-seat shape for MS-0MVL6DZI0000F6CG.
    expect(typeof onBankLoanAction).toBe('function');
    onBankLoanAction(1);
    expect(onBankLoanAction).toHaveBeenCalledWith(1);

    // [ Next Turn ] dismisses the panel and advances exactly once.
    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect(nextTurnCalls).toBe(1);
    expect(overlayText(s, 'Turn Summary')).toBeUndefined();
    expect((s.overlayObjects ?? []).length).toBe(0);
  }, 30_000);

  it('pressing the enabled [ Bank Loan ] opens the per-seat selector, books the take to the human seat and re-renders with the obligation hint', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const summaryState = createCompetitiveState({
      seed: 'competitive-summary-loan-take',
      playerCount: 2,
      difficulty: 'Easy',
      loansEnabled: true,
    });
    const summary = buildCompetitiveTurnSummary(summaryState, {
      playerRoundLedger: makeLedger(),
      incident: null,
    });
    expect(summary).not.toBeNull();
    expect(summary!.loanDescriptor.enabled).toBe(true);
    const bankLoanBtn = (): Phaser.GameObjects.Text | undefined => overlayText(s, '[ Bank Loan ]');

    // The panel's selector/take and the post-take re-render all read the
    // scene's LIVE state, so drive the live scene with the same competitive
    // state the summary was built from (the take books to `players[0]`). Park
    // it in the deferred-closing pause, exactly like the single-player suite.
    s.state = summaryState;
    enableLoansForTake(s);
    const coinsBefore = s.state.players![0].coins;
    const actionsBefore = s.state.actionsRemaining;
    const turnBefore = s.state.turn;

    let nextTurnCalls = 0;
    s.showCompetitiveTurnSummaryDialog(
      summary!,
      () => { nextTurnCalls += 1; },
      undefined,
      { playerRoundLedger: makeLedger() } as any,
    );

    // AC1: the button is enabled exactly when the human seat may borrow.
    expect(bankLoanBtn()!.input?.enabled).toBe(true);
    bankLoanBtn()!.emit('pointerdown');

    // Pressing it swaps the panel for the mid-game loan selector, driven by
    // the configured menu (one row per option, built by the shared builder).
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeDefined();
    const model = buildLoanSelectorModel(s.state);
    expect(model.rows.length).toBeGreaterThan(0);
    const optionRow = overlayText(s, model.rows[0].label);
    expect(optionRow).toBeDefined();
    optionRow!.emit('pointerdown');

    // AC2: booked to the human seat (ownerId 0), AP-neutral, day not advanced.
    expect(s.state.loans?.[0]?.ownerId).toBe(0);
    expect(s.state.players![0].coins).toBe(coinsBefore + 300);
    expect(s.state.actionsRemaining).toBe(actionsBefore);
    expect(s.state.turn).toBe(turnBefore);
    expect(nextTurnCalls).toBe(0);

    // Undoable through the shared undo manager (second half of AC2).
    s.undoManager.undo();
    expect(s.state.loans ?? []).toHaveLength(0);
    expect(s.state.players![0].coins).toBe(coinsBefore);
    s.undoManager.redo();

    // Re-rendered panel: the fresh obligation disables the button with the
    // descriptor's own hint, exactly one button pair remains, and
    // [ Next Turn ] still resumes the shared day.
    expect(overlayText(s, 'Turn Summary')).toBeDefined();
    const refreshed = bankLoanBtn()!;
    expect(refreshed.input?.enabled).toBe(false);
    expect(overlayText(s, 'Loan: 110 coins/turn, 3 turns left')).toBeDefined();
    const texts = (s.overlayObjects ?? []).filter(
      (o: unknown) => o instanceof Phaser.GameObjects.Text,
    ) as Phaser.GameObjects.Text[];
    expect(texts.filter((t) => t.text === '[ Next Turn ]')).toHaveLength(1);
    expect(texts.filter((t) => t.text === '[ Bank Loan ]')).toHaveLength(1);
    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect(nextTurnCalls).toBe(1);
  }, 30_000);

  it('delegates from the scene to the overlay manager, and the headless branch advances once', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const { summary } = makeSummary();
    const manager = s.msOverlayManager;

    const spy = vi
      .spyOn(manager, 'showCompetitiveTurnSummaryDialog')
      .mockImplementation(() => {});
    const onNextTurn = vi.fn();
    s.showCompetitiveTurnSummaryDialog(summary, onNextTurn);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(summary);
    spy.mockRestore();

    // Headless (no overlay manager): continue the closing rather than strand.
    const savedManager = s.msOverlayManager;
    s.msOverlayManager = undefined;
    try {
      s.showCompetitiveTurnSummaryDialog(summary, onNextTurn);
      expect(onNextTurn).toHaveBeenCalledTimes(1);
      expect((s.overlayObjects ?? []).length).toBe(0);
    } finally {
      s.msOverlayManager = savedManager;
    }
  }, 30_000);
});
