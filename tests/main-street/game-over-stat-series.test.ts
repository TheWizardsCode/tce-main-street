/**
 * Main Street: Game-Over stat series model (pure)
 * (MS-0MVAMU6OM008GJPV parent, MS-0MVSHYY1900266X3 child).
 *
 * Verifies AC5 of the per-turn stat history child:
 *  - `buildGameOverStatSeries(state)` returns the five end-of-game series
 *    (profit, cash, businesses, staff, reputation) as labelled point arrays;
 *  - `finalCash` is the last recorded turn's coins, falling back to the live
 *    wallet for an empty history;
 *  - an empty history yields empty series with a valid `finalCash`;
 *  - the model never mutates committed state and imports no Phaser.
 *
 * @module tests/main-street/game-over-stat-series
 */

import { describe, expect, it } from 'vitest';

import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import type { TurnStatSnapshot } from '../../src/MainStreetState';
import { buildGameOverStatSeries } from '../../src/scenes/MainStreetGameOverSummary';

function snapshot(overrides: Partial<TurnStatSnapshot> & { turn: number }): TurnStatSnapshot {
  return {
    coins: 0,
    reputation: 0,
    score: 0,
    profit: 0,
    businesses: 0,
    staff: 0,
    ...overrides,
  };
}

function withHistory(seed: string, history: TurnStatSnapshot[]): MainStreetState {
  const state = setupMainStreetGame({ seed });
  state.turnStatsHistory = history;
  return state;
}

describe('buildGameOverStatSeries', () => {
  it('maps a populated history into the five labelled series', () => {
    const state = withHistory('series-populated', [
      snapshot({ turn: 1, coins: 100, reputation: 3, profit: 10, businesses: 1, staff: 0 }),
      snapshot({ turn: 2, coins: 130, reputation: 5, profit: 30, businesses: 2, staff: 1 }),
    ]);

    const series = buildGameOverStatSeries(state);

    expect(series.profit.label).toBe('Profit per turn');
    expect(series.profit.points).toEqual([
      { turn: 1, value: 10 },
      { turn: 2, value: 30 },
    ]);
    expect(series.cash.points).toEqual([
      { turn: 1, value: 100 },
      { turn: 2, value: 130 },
    ]);
    expect(series.businesses.points).toEqual([
      { turn: 1, value: 1 },
      { turn: 2, value: 2 },
    ]);
    expect(series.staff.points).toEqual([
      { turn: 1, value: 0 },
      { turn: 2, value: 1 },
    ]);
    expect(series.reputation.points).toEqual([
      { turn: 1, value: 3 },
      { turn: 2, value: 5 },
    ]);
    expect(series.finalCash).toBe(130);
  });

  it('gives every series its own label and key', () => {
    const state = withHistory('series-keys', [snapshot({ turn: 1, coins: 5 })]);
    const series = buildGameOverStatSeries(state);

    const all = [series.profit, series.cash, series.businesses, series.staff, series.reputation];
    expect(all.map((s) => s.key)).toEqual(['profit', 'cash', 'businesses', 'staff', 'reputation']);
    expect(new Set(all.map((s) => s.label)).size).toBe(5);
  });

  it('returns empty series and a valid finalCash for an empty history', () => {
    const state = setupMainStreetGame({ seed: 'series-empty' });
    state.resourceBank.coins = 77;
    state.turnStatsHistory = [];

    const series = buildGameOverStatSeries(state);

    for (const s of [series.profit, series.cash, series.businesses, series.staff, series.reputation]) {
      expect(s.points).toEqual([]);
    }
    expect(series.finalCash).toBe(77);
  });

  it('does not mutate committed state', () => {
    const state = withHistory('series-readonly', [
      snapshot({ turn: 1, coins: 40, profit: 4 }),
    ]);
    const before = JSON.parse(JSON.stringify(state.turnStatsHistory));

    buildGameOverStatSeries(state);

    expect(state.turnStatsHistory).toEqual(before);
  });
});
