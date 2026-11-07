/**
 * Main Street: competitive Turn Summary `[ Bank Loan ]` with an active
 * obligation — overlay (MS-0MW4YUFH6005M7UJ, parent MS-0MW4XQXY6005YG72).
 *
 * When the human seat is **already repaying a loan** as the competitive panel
 * is presented, the button must be muted and inert and must explain itself
 * with that seat's own obligation — not the retired static
 * "not available in competitive play yet" copy, and not a generic note:
 *
 *   AC4c — the obligation hint (the HUD readout's wording) is what the player
 *          sees on the panel, derived from live state at presentation time;
 *   AC2  — the one-active-loan rule is unmodified: an inert button cannot
 *          dispatch a second take at all, so the seat's wallet, loans, turn
 *          and action budget are exactly as they were, and the shared day
 *          still resumes on `[ Next Turn ]` (never stranded).
 *
 * The post-take re-render (`turn-summary-competitive.browser.test.ts`) starts
 * from an enabled button and takes a loan; this suite starts from the state a
 * take leaves behind, so the two halves pin opposite ends of the same flow.
 * The Phaser-free half is `competitive-loan-active-obligation.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { buildCompetitiveTurnSummary } from '../../src/scenes/MainStreetTurnSummary';
import { LOAN_SELECTOR_TITLE } from '../../src/scenes/MainStreetLoanSelectorModel';
import type { CompetitiveRoundLedger } from '../../src/MainStreetEngineTypes';
import type { ActiveLoan } from '../../src/MainStreetStateTypes';
import { createCompetitiveState } from '../../src/MainStreetState';

/** Muted text colour an unavailable `[ Bank Loan ]` button renders in. */
const MUTED_BUTTON_COLOUR = '#6b6459';

/** The copy the panel shipped while the competitive button was unwired. */
const RETIRED_STATIC_HINT = 'Bank loans are not available in competitive play yet.';

/** The obligation hint a two-seat fixture with this loan must render. */
const OBLIGATION_HINT = 'Loan: 110 coins/turn, 3 turns left';

// ── Boot helpers (mirrors turn-summary-competitive.browser.test.ts) ──

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

/** The human seat's outstanding obligation, as a completed take records it. */
function humanSeatLoan(): ActiveLoan {
  return {
    ownerId: 0,
    principal: 600,
    totalRepayment: 660,
    perTurnRepayment: 110,
    turnsRemaining: 3,
    termTurns: 3,
    takenOnTurn: 1,
  };
}

/**
 * The live scene state for this suite: a two-seat competitive run with loans
 * on, the human seat already owing, parked on the advanced day's WeekStart
 * (the competitive panel's deferred-closing pause).
 */
function humanSeatOwingState(seed: string) {
  const state = createCompetitiveState({
    seed,
    playerCount: 2,
    difficulty: 'Easy',
    loansEnabled: true,
  });
  state.loans = [humanSeatLoan()];
  state.phase = 'WeekStart';
  return state;
}

describe('competitive [ Bank Loan ] with an active obligation (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('renders the disabled button with the seat’s obligation hint instead of the static copy', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const state = humanSeatOwingState('competitive-obligation-overlay');
    s.state = state;

    const summary = buildCompetitiveTurnSummary(state, {
      playerRoundLedger: makeLedger(),
      incident: null,
    });
    expect(summary).not.toBeNull();
    // The panel is presented with the obligation already in place.
    expect(summary!.loanDescriptor.enabled).toBe(false);
    expect(summary!.loanDescriptor.reason).toBe('active-loan');

    s.showCompetitiveTurnSummaryDialog(summary!, () => {});

    const bankLoanBtn = overlayText(s, '[ Bank Loan ]');
    expect(bankLoanBtn).toBeDefined();
    // Muted and inert: the descriptor says the human seat may not borrow.
    expect(bankLoanBtn!.style.color).toBe(MUTED_BUTTON_COLOUR);
    expect(bankLoanBtn!.input?.enabled).toBeFalsy();
    // Its own seat's obligation explains the state…
    expect(overlayText(s, OBLIGATION_HINT)).toBeDefined();
    // …and the retired competitive-only copy is gone for good.
    expect(overlayText(s, RETIRED_STATIC_HINT)).toBeUndefined();
    // The panel is still a Turn Summary: the primary action is available.
    expect(overlayText(s, '[ Next Turn ]')!.input?.enabled).toBe(true);
  }, 30_000);

  it('never dispatches a second take or strands the day while the seat owes', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const state = humanSeatOwingState('competitive-obligation-inert');
    s.state = state;

    const summary = buildCompetitiveTurnSummary(state, {
      playerRoundLedger: makeLedger(),
      incident: null,
    });
    expect(summary).not.toBeNull();

    let nextTurnCalls = 0;
    const onBankLoanAction = vi.fn();
    const coinsBefore = state.players![0].coins;
    const loansBefore = state.loans.length;
    const actionsBefore = state.actionsRemaining;
    const turnBefore = state.turn;

    s.showCompetitiveTurnSummaryDialog(
      summary!,
      () => { nextTurnCalls += 1; },
      onBankLoanAction,
      { playerRoundLedger: makeLedger() } as any,
    );

    // Pressing the inert button does nothing: no seam call, no selector, no
    // state change — the one-active-loan rule cannot even be reached by the UI.
    overlayText(s, '[ Bank Loan ]')!.emit('pointerdown');
    expect(onBankLoanAction).not.toHaveBeenCalled();
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeUndefined();
    expect(overlayText(s, 'Turn Summary')).toBeDefined();
    expect(nextTurnCalls).toBe(0);
    expect(state.loans).toHaveLength(loansBefore);
    expect(state.players![0].coins).toBe(coinsBefore);
    expect(state.actionsRemaining).toBe(actionsBefore);
    expect(state.turn).toBe(turnBefore);

    // The shared day is resumed the ordinary way, exactly once.
    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect(nextTurnCalls).toBe(1);
    expect(overlayText(s, 'Turn Summary')).toBeUndefined();
    expect((s.overlayObjects ?? []).length).toBe(0);
  }, 30_000);
});
