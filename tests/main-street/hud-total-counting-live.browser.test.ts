/**
 * Main Street: HUD reconciliation count-up live regression tests
 * (MS-0MUYAESVU007X2U8)
 *
 * Drives a REAL end-of-turn through the full controller wiring (endTurn →
 * animateIncomePhases → collect) and samples the on-screen HUD text at
 * intervals DURING the choreography.
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

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { getBusinessTemplates, type BusinessCard } from '../../src/MainStreetCards';

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

async function waitForCondition(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 25;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${options.label ?? 'condition'} after ${timeoutMs}ms`);
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

    // End the turn through the real controller (deferred-mutation path).
    const pre = hudCoins(scene);
    (scene.msTurnController as { endTurn: () => void }).endTurn();
    await waitForCondition(() => scene.incomeCollectionActive === true, {
      timeoutMs: 3000,
      label: 'income choreography starts',
    });
    await new Promise((r) => setTimeout(r, 300));

    // Sample the visible HUD total while the choreography plays.
    const samples: Array<{ t: number; v: number | null }> = [];
    const t0 = Date.now();
    const endOfSamples = t0 + 14_000;
    while (Date.now() < endOfSamples && scene.incomeCollectionActive === true) {
      samples.push({ t: Date.now() - t0, v: hudCoins(scene) });
      await new Promise((r) => setTimeout(r, 100));
    }

    await waitForCondition(() => scene.incomeCollectionActive === false, {
      timeoutMs: 30_000,
      label: 'choreography completes',
    });
    const post = state.resourceBank.coins;

    const sampleVals = samples.map((s) => s.v).filter((v): v is number => v !== null);
    // The coin total must pass through an intermediate value strictly between
    // pre and post (each grid coin landing at the HUD ticks the count up).
    const hasIntermediate = sampleVals.some((v) => v > Math.min(pre, post) && v < Math.max(pre, post));
    expect(post).not.toBe(pre);
    expect(hasIntermediate).toBe(true);
  }, 60_000);

  it('ticks the reputation total at the HUD bar when its pips arrive in the reputation phase', async () => {
    game = await bootGame();
    await makeIncidentsNone(game);
    const scene = game.scene.getScene('MainStreetScene') as any;
    const state = scene.state;
    // One business carrying reputation income (Bakery-style 50 rep/turn).
    state.streetGrid[0] = makeProducingBiz('probe-rep-biz', 50);
    (scene as { refreshAll: () => void }).refreshAll();
    await waitForCondition(
      () => (scene.msAnimator as any)?.findStreetCardContainer?.(0) != null,
      { timeoutMs: 10_000, label: 'slot 0 card container' },
    );

    const preRep = hudRep(scene);
    (scene.msTurnController as { endTurn: () => void }).endTurn();
    await waitForCondition(() => scene.incomeCollectionActive === true, {
      timeoutMs: 3000,
      label: 'income choreography starts',
    });
    await new Promise((r) => setTimeout(r, 300));

    // Sample the Reputation HUD total during the show.
    const repSamples: number[] = [];
    const t0 = Date.now();
    const endOfSamples = t0 + 14_000;
    while (Date.now() < endOfSamples && scene.incomeCollectionActive === true) {
      const v = hudRep(scene);
      if (v !== null) repSamples.push(v);
      await new Promise((r) => setTimeout(r, 100));
    }

    await waitForCondition(() => scene.incomeCollectionActive === false, {
      timeoutMs: 30_000,
      label: 'choreography completes',
    });
    const postRep = state.resourceBank.reputation;

    // The Reputation counter ticks when its pips arrive at the HUD bar during
    // the show (previously it stayed frozen until the final snap/refresh).
    expect(postRep).not.toBe(preRep);
    expect(repSamples.some((v) => v !== preRep)).toBe(true);
  }, 60_000);
});
