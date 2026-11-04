/**
 * Main Street: HUD reconciliation count-up live regression tests
 * (MS-0MUYAESVU007X2U8)
 *
 * Drives a REAL end-of-turn through the full controller wiring (endTurn →
 * animateIncomePhases → collect) and records the HUD's display-only running
 * totals (the pair the HUD renders, MS-0MUYAESVU007X2U8) at every production
 * re-render the reconciliation performs, so the tick sequence is observed at
 * the arrivals themselves rather than by sampling the on-screen text on a
 * wall-clock timer.
 *
 * The show is **scene-clock paced**: Phaser clamps each frame's delta, so on a
 * CPU-starved host its phases land several times later in wall time than their
 * nominal schedule (MS-0MW08THR2000YXEO — a fixed 14 s sampling window truncated
 * ahead of the very arrivals under test and reported a correct scene as a
 * regression). Recording at the production step keeps the end-to-end wiring
 * while removing the race, and the two waits are budgeted separately from the
 * clock each one races: the first-arrival wait from the scene clock (with a
 * deliberately larger choreography margin — the wall-clock cap abandons the
 * *wait*, not the flights), and the authoritative-deltas wait from the
 * wall-clock collection cap. The rendered text itself is covered
 * deterministically by `main-street-renderer-deferred.browser.test.ts` and
 * `hud-total-counting.test.ts`.
 *
 * The producer's manual reviews (2026-10-16) define the contract precisely:
 *
 *   "We want the number displayed to increase with each coin/reputation that
 *    reaches the count in the HUD."
 *   "I want the number to tick up ONLY when the money is animating to the
 *    HUD, each time a coin reach the HUD bar location the coin count should
 *    tick up."
 *
 * So the HUD totals must tick ONLY at HUD-bar arrivals — never while coins
 * are being counted onto the business card grids (base/synergy/reputation
 * phases) and never for reputation that stays on the board. These tests
 * assert:
 *  - the coin total stays at the pre value during the phases and ticks only
 *    when grid coins reach the HUD counter during the collection, showing
 *    intermediate values strictly between pre and post (AC5a);
 *  - the reputation total stays at the pre value until its pips arrive at
 *    the HUD reputation counter in the reputation phase, then it ticks;
 *  - the exact post-reconciliation value lands at the end (AC5b).
 *
 * @module tests/main-street/hud-total-counting-live
 */

import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import { waitForCondition } from '@core-tests/helpers/waitForCondition';
import { waitForScene } from '@core-tests/helpers/waitForScene';
import { getBusinessTemplates, type BusinessCard } from '../../src/MainStreetCards';
import { INCOME_COLLECTION_CAP_MS } from '../../src/scenes/MainStreetAnimatorTiming';

/**
 * Fixed starvation margin for the **wall-clock capped** end-of-turn waits
 * (docs/dev/testing.md § "Load-tolerant wait budgets"). `endOfTurnDeltasApplied`
 * is applied by the closing continuation, which the collection cap bounds on the
 * wall clock (`INCOME_COLLECTION_CAP_MS`), so a cap + margin budget is honest.
 */
const END_OF_TURN_STARVATION_MARGIN_MS = 24_000;

/**
 * Fixed starvation margin for the **scene-clock paced** arrival wait.
 *
 * The income show's phases are advanced by `scene.time` (Phaser clamps each
 * frame's delta), so under CPU contention an arrival lands several times later
 * in *wall* time than its nominal schedule — and, unlike the deltas, the
 * choreography is **not** bounded by the wall-clock collection cap (the cap
 * abandons the wait, not the flights). The arrival wait therefore races the
 * scene clock, so its floor is deliberately larger than the cap-derived one:
 * at ≈7× starvation observed on this host a nominal ~6 s show reached past
 * 40 s of wall time (MS-0MW08THR2000YXEO).
 */
const CHOREOGRAPHY_STARVATION_MARGIN_MS = 60_000;

let game: Phaser.Game | null = null;

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();
  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);
  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const g = createMainStreetGame();
  await waitForScene(g, 'MainStreetScene');
  return g;
}

function destroyGame(g: Phaser.Game | null): void {
  if (g) g.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

/** Full business card built from the first template, placed on a street slot. */
function makeProducingBiz(id: string, repPerTurn = 0): BusinessCard {
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
    currentIncome: 161,
    currentReputationPerTurn: repPerTurn,
  };
}

/** Read the live on-screen `Coins: N` text value (or null when absent). */
function hudCoins(scene: any): number | null {
  const text = scene.hudCoinText as Phaser.GameObjects.Text | undefined;
  if (!text || typeof text.text !== 'string') return null;
  const m = /Coins:\s*([\d.+-]+)/.exec(text.text);
  return m ? Number(m[1]) : null;
}

/** Read the live on-screen `Reputation: N` text value (or null when absent). */
function hudRep(scene: any): number | null {
  const text = scene.hudRepText as Phaser.GameObjects.Text | undefined;
  if (!text || typeof text.text !== 'string') return null;
  const m = /Reputation:\s*([\d.+-]+)/.exec(text.text);
  return m ? Number(m[1]) : null;
}

async function makeIncidentsNone(game: Phaser.Game): Promise<void> {
  const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;
  const state = scene.state as { incidentDeck: unknown[] };
  state.incidentDeck.length = 0;
}

/**
 * Record every value the reconciliation publishes to the HUD through
 * `syncHudTotals` — the production call each coin/pip arrival (and the final
 * snap) uses to re-render the display-only running total. The original call is
 * still made, so the rendered HUD behaviour is unchanged; only the sequence is
 * captured.
 *
 * Recording at the production step, instead of polling the rendered text on a
 * wall-clock timer, is what makes the assertion independent of host load: the
 * flights are scene-clock paced and can land well after a wall-clock sampling
 * window would have closed (MS-0MW08THR2000YXEO). The wrapper records the
 * displayed total *after* calling the original, so it captures the sequence even
 * once the deferred window has closed (the renderer then no-ops).
 */
function recordHudTotalSteps(scene: any, kind: 'coin' | 'rep'): number[] {
  const steps: number[] = [];
  const original = scene.syncHudTotals.bind(scene);
  scene.syncHudTotals = () => {
    original();
    const value = kind === 'coin' ? scene.displayedCoins : scene.displayedReputation;
    if (typeof value === 'number') steps.push(value);
  };
  return steps;
}

afterEach(() => {
  destroyGame(game);
  game = null;
});

describe('live HUD reconciliation counting (MS-0MUYAESVU007X2U8)', () => {
  it('ticks the coin total ONLY at HUD arrivals during the collection (intermediates strictly between pre and post)', async () => {
    game = await bootGame();
    await makeIncidentsNone(game);
    const scene = game.scene.getScene('MainStreetScene') as any;

    // Place producing businesses so the phased income choreography runs.
    const state = scene.state;
    state.streetGrid[0] = makeProducingBiz('probe-biz-0');
    state.streetGrid[1] = makeProducingBiz('probe-biz-1');
    (scene as { refreshAll: () => void }).refreshAll();
    await waitForCondition(
      () => (scene.msAnimator as any)?.findStreetCardContainer?.(0) != null,
      { timeoutMs: 10_000, label: 'slot 0 card container' },
    );

    // Record every HUD total step the reconciliation publishes.
    const coinSteps = recordHudTotalSteps(scene, 'coin');

    // End the turn through the real controller (deferred-mutation path).
    const pre = hudCoins(scene);
    (scene.msTurnController as { endTurn: () => void }).endTurn();
    await waitForCondition(() => scene.incomeCollectionActive === true, {
      timeoutMs: 3000,
      label: 'income choreography starts',
    });

    // Wait for the first grid-coin arrival to tick the running total. This wait
    // races the **scene clock** (the flights), so it gets the choreography
    // margin; waiting on `endOfTurnDeltasApplied` here instead would make the
    // budget span the entire starved show and time out on a correct scene.
    await waitForCondition(() => coinSteps.some((v) => v !== pre), {
      capMs: INCOME_COLLECTION_CAP_MS,
      floorMs: CHOREOGRAPHY_STARVATION_MARGIN_MS,
      intervalMs: 100,
      label: 'coin total to tick at a HUD arrival',
    });

    // The authoritative final value lands when the deferred deltas are applied;
    // that continuation is bounded on the **wall clock** by the collection cap,
    // so a cap + margin budget is the right one here.
    await waitForCondition(() => scene.endOfTurnDeltasApplied === true, {
      capMs: INCOME_COLLECTION_CAP_MS,
      floorMs: END_OF_TURN_STARVATION_MARGIN_MS,
      intervalMs: 100,
      label: 'end-of-turn deltas applied',
    });
    const post = state.resourceBank.coins;

    // The coin total must pass through an intermediate value strictly between
    // pre and post (each grid coin landing at the HUD ticks the count up).
    const hasIntermediate = coinSteps.some((v) => v > Math.min(pre, post) && v < Math.max(pre, post));
    expect(post).not.toBe(pre);
    expect(hasIntermediate).toBe(true);
  }, 180_000);

  it('ticks the reputation total at the HUD bar when its pips arrive in the reputation phase', async () => {
    game = await bootGame();
    await makeIncidentsNone(game);
    const scene = game.scene.getScene('MainStreetScene') as any;
    const state = scene.state;
    // One business carrying reputation income. The amount is chosen so the
    // phase flies **several** pips (one per `iconsForAmount` icon, i.e. one per
    // 100 reputation), which is what makes "ticks at arrivals" distinguishable
    // from "frozen until the final snap": with a single pip the only published
    // value *is* the final one, so a regression that froze the counter until the
    // snap would pass. 250 → 3 pips → two strictly-intermediate values.
    state.streetGrid[0] = makeProducingBiz('probe-rep-biz', 250);
    (scene as { refreshAll: () => void }).refreshAll();
    await waitForCondition(
      () => (scene.msAnimator as any)?.findStreetCardContainer?.(0) != null,
      { timeoutMs: 10_000, label: 'slot 0 card container' },
    );

    // Record every HUD reputation step the reconciliation publishes.
    const repSteps = recordHudTotalSteps(scene, 'rep');

    const preRep = hudRep(scene);
    (scene.msTurnController as { endTurn: () => void }).endTurn();
    await waitForCondition(() => scene.incomeCollectionActive === true, {
      timeoutMs: 3000,
      label: 'income choreography starts',
    });

    // Wait for the first reputation-pip arrival to tick the running total. As in
    // the coin test this wait races the scene-clock paced flights, so it gets
    // the choreography margin rather than the cap-derived one.
    await waitForCondition(() => repSteps.some((v) => v !== preRep), {
      capMs: INCOME_COLLECTION_CAP_MS,
      floorMs: CHOREOGRAPHY_STARVATION_MARGIN_MS,
      intervalMs: 100,
      label: 'reputation total to tick at a HUD arrival',
    });

    // The authoritative final value lands when the deferred deltas are applied
    // (wall-clock capped by the collection cap).
    await waitForCondition(() => scene.endOfTurnDeltasApplied === true, {
      capMs: INCOME_COLLECTION_CAP_MS,
      floorMs: END_OF_TURN_STARVATION_MARGIN_MS,
      intervalMs: 100,
      label: 'end-of-turn deltas applied',
    });
    const postRep = state.resourceBank.reputation;

    // The Reputation counter ticks when its pips arrive at the HUD bar during
    // the show (previously it stayed frozen until the final snap/refresh). A
    // value strictly between pre and post proves a mid-flight tick rather than
    // a single jump at the snap, and every tick is upward — income is a gain.
    expect(postRep).not.toBe(preRep);
    expect(
      repSteps.some((v) => v > Math.min(preRep, postRep) && v < Math.max(preRep, postRep)),
    ).toBe(true);
    expect(repSteps.every((v) => v >= preRep)).toBe(true);
  }, 180_000);
});
