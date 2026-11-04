/**
 * Main Street: End-of-game stats acceptance (epic MS-0MVAMU6OM008GJPV)
 *
 * End-to-end acceptance for the whole story — capture → persist → model →
 * render inputs — in both game modes (child MS-0MVSHZ2XB008URM7).
 *
 * Single-player drives a scripted multi-turn run through the real engine
 * (`executeFullTurn`) and asserts one history entry per closed turn, the
 * `profit` definition, a serialize/deserialize round-trip and the five-series
 * model. Competitive drives a scripted shared-day run and asserts one entry per
 * turn taken from the human seat, plus a matching series model.
 *
 * @module tests/main-street/end-of-game-stats-acceptance
 */

import { describe, expect, it } from 'vitest';

import {
  createCompetitiveState,
  deserializeMainStreetState,
  serializeMainStreetState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import { executeCompetitiveTurn, executeFullTurn } from '../../src/MainStreetEngine';
import { buildGameOverStatSeries } from '../../src/scenes/MainStreetGameOverSummary';

const TURNS = 3;

function assertFiveSeriesMatchHistory(state: MainStreetState): void {
  const history = state.turnStatsHistory;
  const series = buildGameOverStatSeries(state);
  const all = [
    series.profit,
    series.cash,
    series.businesses,
    series.staff,
    series.reputation,
  ];
  for (const s of all) {
    expect(s.points).toHaveLength(history.length);
  }
  // Point values map to the recorded snapshots.
  expect(series.cash.points).toEqual(history.map((h) => ({ turn: h.turn, value: h.coins })));
  expect(series.profit.points).toEqual(history.map((h) => ({ turn: h.turn, value: h.profit })));
  // finalCash is the last recorded turn's coins.
  expect(series.finalCash).toBe(history[history.length - 1]!.coins);
}

describe('end-of-game stats acceptance — single-player', () => {
  it('captures, persists and models a scripted multi-turn run', () => {
    const state = setupMainStreetGame({ seed: 'acceptance-single-player' });

    for (let turn = 1; turn <= TURNS && state.gameResult === 'playing'; turn += 1) {
      executeFullTurn(state, [{ type: 'end-turn' }]);

      // Exactly one entry per completed turn.
      expect(state.turnStatsHistory).toHaveLength(turn);
      const snapshot = state.turnStatsHistory[turn - 1]!;
      expect(snapshot.turn).toBe(turn);

      // `profit` is the coin delta against this turn's day-start snapshot
      // (`weekStartCoins` is not advanced again until the next WeekStart).
      expect(snapshot.profit).toBe(snapshot.coins - state.weekStartCoins);
      expect(snapshot.coins).toBe(state.resourceBank.coins);
    }

    expect(state.turnStatsHistory.length).toBeGreaterThan(0);

    // Serialise → deserialise preserves the series exactly.
    const restored = deserializeMainStreetState(serializeMainStreetState(state));
    expect(restored.turnStatsHistory).toEqual(state.turnStatsHistory);

    // The pure model yields five series matching the recorded history.
    assertFiveSeriesMatchHistory(restored);
  });
});

describe('end-of-game stats acceptance — competitive', () => {
  it('records one entry per turn from the human seat and models it', () => {
    const state = createCompetitiveState({ seed: 'acceptance-competitive', playerCount: 2 });

    for (let turn = 1; turn <= TURNS && state.gameResult === 'playing'; turn += 1) {
      executeCompetitiveTurn(state, [[], []]);

      expect(state.turnStatsHistory).toHaveLength(turn);
      const snapshot = state.turnStatsHistory[turn - 1]!;
      // The human seat's closing wallet, never the AI seat's.
      expect(snapshot.coins).toBe(state.players![0]!.coins);
      expect(snapshot.reputation).toBe(state.players![0]!.reputation);
    }

    expect(state.turnStatsHistory.length).toBeGreaterThan(0);

    const restored = deserializeMainStreetState(serializeMainStreetState(state));
    expect(restored.turnStatsHistory).toEqual(state.turnStatsHistory);
    assertFiveSeriesMatchHistory(restored);
  });
});
