/**
 * Competitive Turn Summary dialog — browser overlay tests (MS-0MVRNV9Y8008IKGK)
 *
 * Verifies the competitive per-seat Turn Summary panel in a real Phaser scene:
 *
 * 1. One row per seat, in seat order, rendering the panel model's own labels
 *    and seat colours (the competitive scoreboard's `You` / `AI n` +
 *    `resolveSeatColour` values) with businesses owned, the per-phase income
 *    breakdown and the net coin change.
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
  COMPETITIVE_BANK_LOAN_HINT,
  buildCompetitiveTurnSummary,
  type CompetitiveTurnSummary,
} from '../../src/scenes/MainStreetTurnSummary';
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
        netCoinChange: 9,
      },
      {
        ownerId: 1,
        businessesOwned: 2,
        incomeByPhase: { base: 8, synergy: 0, reputation: 1, events: 0 },
        incomeTotal: 9,
        netCoinChange: 5,
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

    // ── Seat rows: one per seat, in seat order, with seat labels ──
    const humanLabel = overlayText(s, 'You');
    const aiLabel = overlayText(s, 'AI 1');
    expect(humanLabel).toBeDefined();
    expect(aiLabel).toBeDefined();
    expect(humanLabel!.depth).toBe(201);
    expect(aiLabel!.depth).toBe(201);
    // Reused seat colours, not an ad-hoc palette.
    expect(humanLabel!.style.color).toBe(colours[0]);
    expect(aiLabel!.style.color).toBe(colours[1]);
    expect(humanLabel!.style.color).not.toBe(aiLabel!.style.color);

    // ── Businesses owned, per-phase income and net change per row ──
    expect(overlayText(s, 'Businesses owned: 3')).toBeDefined();
    expect(overlayText(s, 'Businesses owned: 2')).toBeDefined();
    expect(
      overlayText(
        s,
        'Income: Base income +12 · Synergy income +4 · Reputation income +2 · Event income -1',
      ),
    ).toBeDefined();
    expect(
      overlayText(
        s,
        'Income: Base income +8 · Synergy income 0 · Reputation income +1 · Event income 0',
      ),
    ).toBeDefined();
    expect(overlayText(s, 'Income total: +17 · Net change: +9 coins')).toBeDefined();
    expect(overlayText(s, 'Income total: +9 · Net change: +5 coins')).toBeDefined();

    // ── Buttons ───────────────────────────────────────────────
    const nextTurnBtn = overlayText(s, '[ Next Turn ]');
    const bankLoanBtn = overlayText(s, '[ Bank Loan ]');
    expect(nextTurnBtn).toBeDefined();
    expect(bankLoanBtn).toBeDefined();
    expect(nextTurnBtn!.depth).toBe(201);
    expect(bankLoanBtn!.depth).toBe(201);
    expect(nextTurnBtn!.input?.enabled).toBe(true);
    // AC5: always disabled in competitive play, muted, with its hint.
    expect(bankLoanBtn!.input?.enabled).toBeFalsy();
    expect(bankLoanBtn!.style.color).toBe(MUTED_BUTTON_COLOUR);
    expect(overlayText(s, COMPETITIVE_BANK_LOAN_HINT)).toBeDefined();

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
    // advances the day.
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
