/**
 * Main Street: Visible obligation — HUD readout browser test
 * (Bank Loans epic MS-0MVL6DZI0000F6CG, child MS-0MVPWSCRD004A6Z4).
 *
 * Boots a real Phaser game and asserts the loan obligation is surfaced in the
 * HUD itself:
 *
 *  - single-player: the readout (`Loan: 110 coins/turn, 6 turns left`) renders
 *    in the HUD strip beside the coin/reputation readouts, without overlapping
 *    those existing anchors or the right-aligned Score label;
 *  - the readout is hidden when no loan is active and when loans are disabled;
 *  - competitive: every scoreboard row whose seat holds a loan carries the
 *    obligation, and rows without a loan stay unchanged.
 *
 * Runs inside Chromium via Vitest browser mode + Playwright.
 *
 * @module tests/main-street/MainStreetLoanHud.browser
 */

import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import { buildActiveLoan } from '../../src/MainStreetLoans';

const TUTORIAL_STATE_KEY = 'tce-main-street-tutorial-state';
const LOAN_READOUT_NAME = 'loan-hud-readout';

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();

  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame();
  // Wait for the boot flow to settle on the first MarketPhase: the campaign
  // load resolves asynchronously and may re-create `state`, so injecting a
  // loan before it lands would be silently discarded.
  await waitForCondition(() => {
    const scene = game.scene.getScene('MainStreetScene') as any;
    return Boolean(scene && scene.state && scene.hudContainer)
      && scene.state.phase === 'MarketPhase';
  }, 20_000);
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 10_000,
  pollMs = 25,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
}

/** Every text object currently parented into the HUD container. */
function hudTexts(scene: any): Phaser.GameObjects.Text[] {
  const list = scene.hudContainer?.list ?? [];
  return list.filter((child: any) => child instanceof Phaser.GameObjects.Text);
}

/** The rendered loan obligation readout, or undefined when it is hidden. */
function loanReadout(scene: any): Phaser.GameObjects.Text | undefined {
  return hudTexts(scene).find((text) => text.name === LOAN_READOUT_NAME);
}

/** Finds the HUD counter label starting with `prefix` (e.g. `Coins: `). */
function hudLabel(scene: any, prefix: string): Phaser.GameObjects.Text | undefined {
  return hudTexts(scene).find((text) => text.text?.startsWith(prefix));
}

/** Scoreboard row text objects, keyed by seat id. */
function scoreboardRows(scene: any): Map<number, Phaser.GameObjects.Text> {
  const rows = (scene.hudContainer?.list ?? []).filter(
    (child: any) => child?.name === 'competitive-scoreboard-row',
  ) as Phaser.GameObjects.Text[];
  return new Map(rows.map((row) => [row.getData('playerId') as number, row]));
}

describe('Single-player loan HUD readout (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    try { (window as any).localStorage?.clear(); } catch (_) { /* ignore */ }
    destroyGame(game);
    game = null;
  });

  it('renders the remaining obligation beside coins/reputation without overlap, and hides without a loan', async () => {
    try { (window as any).localStorage?.removeItem(TUTORIAL_STATE_KEY); } catch (_) { /* ignore */ }
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    // No loan yet: the readout must not render at all.
    scene.refreshAll();
    expect(loanReadout(scene)).toBeUndefined();

    // Give the human seat an active loan (600 principal / 6 turns → 110/turn).
    scene.state.config.loansEnabled = true;
    scene.state.loans = [buildActiveLoan(scene.state, { principal: 600, termTurns: 6 })];
    scene.refreshAll();

    await waitForCondition(() => Boolean(loanReadout(scene)), 5_000);
    const readout = loanReadout(scene)!;
    expect(readout.text).toBe('Loan: 110 coins/turn, 6 turns left');

    // Positioned beside the coin/reputation readouts: to the right of the
    // reputation label, and clear of the right-aligned Score label.
    const rep = hudLabel(scene, 'Reputation: ');
    const score = hudLabel(scene, 'Score: ');
    expect(rep).toBeDefined();
    expect(score).toBeDefined();

    const readoutLeft = readout.x - readout.width;
    const readoutRight = readout.x;
    const repRight = rep!.x + rep!.width;
    const scoreLeft = score!.x - score!.width;

    expect(readoutLeft).toBeGreaterThanOrEqual(repRight);
    expect(readoutRight).toBeLessThanOrEqual(scoreLeft);

    // Clearing the loan hides the readout again.
    scene.state.loans = [];
    scene.refreshAll();
    expect(loanReadout(scene)).toBeUndefined();
  }, 40_000);

  it('hides the readout when loans are disabled', async () => {
    try { (window as any).localStorage?.removeItem(TUTORIAL_STATE_KEY); } catch (_) { /* ignore */ }
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    // A stale loan record plus loans-off must still stay hidden.
    scene.state.loans = [buildActiveLoan(scene.state, { principal: 600, termTurns: 6 })];
    scene.state.config.loansEnabled = false;
    scene.refreshAll();

    expect(loanReadout(scene)).toBeUndefined();
  }, 40_000);
});

describe('Competitive loan obligation on the scoreboard (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    try { (window as any).localStorage?.clear(); } catch (_) { /* ignore */ }
    destroyGame(game);
    game = null;
  });

  it('shows the obligation only on the seat holding a loan', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    scene.msLifecycleManager.applyNewGameSelection({
      mode: 'competitive',
      opponents: [{ strategy: 'Greedy', difficulty: 'Medium' }],
    });
    await waitForCondition(() => (scene.state?.players?.length ?? 0) === 2);

    // Seat 1 (AI) holds the loan; the human seat holds none.
    scene.state.config.loansEnabled = true;
    scene.state.loans = [buildActiveLoan(scene.state, { principal: 300, termTurns: 3 }, 1)];
    scene.state.activePlayerId = 1;
    scene.refreshAll();

    await waitForCondition(() => scoreboardRows(scene).size === 2);
    let rows = scoreboardRows(scene);
    expect(rows.get(1)!.text).toContain('Loan: 110/turn, 3 left');
    expect(rows.get(0)!.text).not.toContain('Loan:');

    // The obligation is per seat: handing control to the human seat keeps the
    // AI's scoreboard marker intact while the shared-strip readout (which
    // follows the bound seat) disappears.
    scene.state.activePlayerId = 0;
    scene.refreshAll();
    await waitForCondition(() => Boolean(scoreboardRows(scene).get(0)));
    rows = scoreboardRows(scene);
    expect(rows.get(1)!.text).toContain('Loan: 110/turn, 3 left');
    expect(rows.get(0)!.text).not.toContain('Loan:');
    expect(loanReadout(scene)).toBeUndefined();
  }, 40_000);
});
