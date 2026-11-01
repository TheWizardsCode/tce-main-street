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
 * 4. `[ Bank Loan ]` is always rendered disabled with an explanatory hint
 *    behind the `onBankLoanAction` seam, which is never invoked by this item
 *    (AC4).
 * 5. The dialog appears instantly — no fade-in choreography, so it is
 *    reduced-motion safe (AC5).
 *
 * The model values themselves are unit-tested Phaser-free in
 * `turn-summary-model.test.ts`; this suite covers the overlay rendering path.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import type { EventCard } from '../../src/MainStreetCards';
import type { TurnLedger } from '../../src/MainStreetEngineTypes';
import { buildTurnSummary } from '../../src/scenes/MainStreetTurnSummary';

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

const BANK_LOAN_HINT = 'Bank loans are not available yet — coming in a future update.';

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
    s.showTurnSummaryDialog(summary, () => {});

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

    // ── Buttons: primary Next Turn interactive; Bank Loan disabled ──
    const nextTurnBtn = overlayText(s, '[ Next Turn ]');
    const bankLoanBtn = overlayText(s, '[ Bank Loan ]');
    expect(nextTurnBtn).toBeDefined();
    expect(bankLoanBtn).toBeDefined();
    expect(nextTurnBtn!.depth).toBe(201);
    expect(bankLoanBtn!.depth).toBe(201);
    expect(nextTurnBtn!.input?.enabled).toBe(true);
    expect(bankLoanBtn!.input?.enabled).toBeFalsy();
    expect(overlayText(s, BANK_LOAN_HINT)).toBeDefined();

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

  it('invokes onNextTurn and dismisses, while the disabled Bank Loan seam is never invoked', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    const summary = makeSummary(s);
    let nextTurnCalls = 0;
    let bankLoanCalls = 0;
    s.showTurnSummaryDialog(
      summary,
      () => { nextTurnCalls += 1; },
      () => { bankLoanCalls += 1; },
    );

    // AC4: the sealed Bank Loan seam is never invoked, even on a press.
    hudText(s, '[ Bank Loan ]')!.emit('pointerdown');
    expect(bankLoanCalls).toBe(0);
    expect(nextTurnCalls).toBe(0);

    // AC3: the primary button resumes the closing flow exactly once.
    hudText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect(nextTurnCalls).toBe(1);

    // Dismissed for good: overlay released and buttons destroyed.
    expect((s.overlayObjects ?? []).length).toBe(0);
    expect(hudText(s, '[ Next Turn ]')).toBeUndefined();
    expect(hudText(s, '[ Bank Loan ]')).toBeUndefined();
  }, 30_000);
});
