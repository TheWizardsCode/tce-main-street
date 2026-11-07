/**
 * Main Street: competitive Turn Summary `[ Bank Loan ]` disabled states —
 * overlay (MS-0MW4YUGX4006OINT, parent MS-0MW4XQXY6005YG72).
 *
 * When the run has the loan mechanic switched off, or no loan menu is
 * configured, the competitive panel's button must be muted and inert and must
 * explain itself with the descriptor's reason-specific hint — never the
 * retired static "not available in competitive play yet" copy:
 *
 *   AC4d — `loansEnabled: false` renders the `loans-disabled` hint;
 *   AC1  — an empty configured menu renders the `no-options` hint;
 *   AC3  — the disabled state is the correct no-op: pressing it dispatches
 *          nothing and opens no (empty) selector, and the shared day still
 *          resumes on `[ Next Turn ]` (never stranded).
 *
 * The Phaser-free half is `competitive-loan-disabled-states.test.ts`; the
 * enabled / post-take halves are `turn-summary-competitive.browser.test.ts`
 * and `competitive-loan-active-obligation.browser.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { buildCompetitiveTurnSummary } from '../../src/scenes/MainStreetTurnSummary';
import {
  LOANS_DISABLED_HINT,
  NO_LOAN_OPTIONS_HINT,
  LOAN_SELECTOR_TITLE,
} from '../../src/scenes/MainStreetLoanSelectorModel';
import type { CompetitiveRoundLedger } from '../../src/MainStreetEngineTypes';
import { createCompetitiveState, type MainStreetState } from '../../src/MainStreetState';

/** Muted text colour an unavailable `[ Bank Loan ]` button renders in. */
const MUTED_BUTTON_COLOUR = '#6b6459';

/** The copy the panel shipped while the competitive button was unwired. */
const RETIRED_STATIC_HINT = 'Bank loans are not available in competitive play yet.';

// ── Boot helpers (mirrors competitive-loan-active-obligation.browser.test.ts) ──

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
    seats: [0, 1].map((ownerId) => ({
      ownerId,
      businessesOwned: 1,
      incomeByPhase: { base: 10, synergy: 0, reputation: 0, events: 0 },
      incomeTotal: 10,
      netCoinChange: 10,
    })),
  };
}

/** A two-seat competitive run parked on the advanced day's WeekStart. */
function competitiveState(seed: string, loansEnabled = true): MainStreetState {
  const state = createCompetitiveState({
    seed,
    playerCount: 2,
    difficulty: 'Easy',
    loansEnabled,
  });
  state.phase = 'WeekStart';
  return state;
}

/** The competitive summary for a live state, failing loudly if it is absent. */
function summaryFor(state: MainStreetState) {
  const summary = buildCompetitiveTurnSummary(state, {
    playerRoundLedger: makeLedger(),
    incident: null,
  });
  expect(summary).not.toBeNull();
  return summary!;
}

/** Asserts the panel's disabled button: muted, inert, explained, not stranded. */
function expectDisabledPanel(
  s: SceneWithHud,
  hint: string,
): void {
  const bankLoanBtn = overlayText(s, '[ Bank Loan ]');
  expect(bankLoanBtn).toBeDefined();
  // Muted and inert: the descriptor says the human seat may not borrow.
  expect(bankLoanBtn!.style.color).toBe(MUTED_BUTTON_COLOUR);
  expect(bankLoanBtn!.input?.enabled).toBeFalsy();
  // The reason-specific hint explains the state…
  expect(overlayText(s, hint)).toBeDefined();
  // …and the retired competitive-only copy is gone for good.
  expect(overlayText(s, RETIRED_STATIC_HINT)).toBeUndefined();
  // The panel is still a Turn Summary: the primary action stays available.
  expect(overlayText(s, '[ Next Turn ]')!.input?.enabled).toBe(true);
  expect(overlayText(s, 'Turn Summary')).toBeDefined();
}

describe('competitive [ Bank Loan ] disabled states (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('renders loans-off as a disabled button with the loans-disabled hint', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const state = competitiveState('competitive-disabled-overlay-loans-off', false);
    s.state = state;

    const summary = summaryFor(state);
    expect(summary.loanDescriptor.enabled).toBe(false);
    expect(summary.loanDescriptor.reason).toBe('loans-disabled');

    s.showCompetitiveTurnSummaryDialog(summary, () => {});

    expectDisabledPanel(s, LOANS_DISABLED_HINT);
  }, 30_000);

  it('renders an empty menu disabled, and an inert press neither opens a selector nor strands the day', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const state = competitiveState('competitive-disabled-overlay-empty-menu');
    state.config = { ...state.config, loanOptions: [] };
    s.state = state;

    const summary = summaryFor(state);
    expect(summary.loanDescriptor.enabled).toBe(false);
    expect(summary.loanDescriptor.reason).toBe('no-options');

    let nextTurnCalls = 0;
    const onBankLoanAction = vi.fn();
    const coinsBefore = state.players!.map((player) => player.coins);
    const actionsBefore = state.actionsRemaining;
    const turnBefore = state.turn;

    s.showCompetitiveTurnSummaryDialog(
      summary,
      () => { nextTurnCalls += 1; },
      onBankLoanAction,
      { playerRoundLedger: makeLedger() } as any,
    );

    expectDisabledPanel(s, NO_LOAN_OPTIONS_HINT);

    // Pressing the inert button does nothing: no seam call, no empty selector,
    // no state change.
    overlayText(s, '[ Bank Loan ]')!.emit('pointerdown');
    expect(onBankLoanAction).not.toHaveBeenCalled();
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeUndefined();
    expect(overlayText(s, 'Turn Summary')).toBeDefined();
    expect(nextTurnCalls).toBe(0);
    expect(state.players!.map((player) => player.coins)).toEqual(coinsBefore);
    expect(state.actionsRemaining).toBe(actionsBefore);
    expect(state.turn).toBe(turnBefore);

    // The shared day is resumed the ordinary way, exactly once.
    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect(nextTurnCalls).toBe(1);
    expect(overlayText(s, 'Turn Summary')).toBeUndefined();
    expect((s.overlayObjects ?? []).length).toBe(0);
  }, 30_000);
});
