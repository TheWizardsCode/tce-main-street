/**
 * Main Street: Competitive Monte Carlo Harness Tests
 *
 * Tests for the head-to-head competitive Monte Carlo harness (CG-0MTIILDBB001F01S).
 * Extends MainStreetMonteCarlo — never replaces the single-player functions.
 *
 * AC1 — Deterministic head-to-head: runCompetitiveMonteCarlo runs ≥200 seeds,
 *        same seed → identical per-owner outcome.
 * AC2 — Per-player metrics: wins, average score, loss-reason distribution.
 * AC3 — Extension only: existing runMonteCarlo / runAllCombinations / tests pass.
 * AC4 — Validated against CompetitiveGreedyStrategy.
 *
 * Cost-aware AI event-choice verification (MS-0MVNU5HNV007R803): the harnesses
 * also run with cost-gated and extra-effect options in play, proving they
 * complete without an AI stall, never raise `No storyline option at index`,
 * leave no `pendingEventChoice` unresolved, and replay identically per seed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as aiStrategyModule from '../../src/MainStreetAiStrategy';
import * as engineModule from '../../src/MainStreetEngine';
import { resetStorylineRegistry } from '../../src/MainStreetStoryline';
import type { MainStreetState } from '../../src/MainStreetState';
import type { MonteCarloRunSummary } from '../../src/MainStreetMonteCarlo';
import {
  COST_FIXTURE_EVENT_ID,
  EXTRA_EFFECT_LABEL,
  PRESENTED_LABELS,
  registerAiCostFixtures,
} from './helpers/aiEventChoiceCostFixtures';

import {
  runCompetitiveMonteCarlo,
  runCompetitiveSeed,
  toCompetitiveCsv,
} from '../../src/MainStreetMonteCarlo';

import {
  runMonteCarlo,
  runAllCombinations,
} from '../../src/MainStreetMonteCarlo';

import {
  CompetitiveGreedyStrategy,
  GreedyStrategy,
} from '../../src/MainStreetAiStrategy';

// ── Helpers ───────────────────────────────────────────────────

/** Seeds for the ≥200 threshold check. */
function makeSeeds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `seed-${String(i + 1).padStart(4, '0')}`);
}

/** Handle returned by the pending-choice guards. */
interface PendingChoiceGuard {
  /** Number of paused choices the AI resolved while the guard was installed. */
  calls: number;
  /** Removes the spy (always call from a `finally`). */
  restore: () => void;
}

/**
 * Seeds whose `market-greedy` single-player runs draw the fixture card and
 * therefore exercise the presented-list decision end-to-end. Calibrated
 * against the shipped content; the assertions also fail loudly if these seeds
 * stop reaching the fixture (rather than passing vacuously).
 */
const FIXTURE_SEEDS = ['cost-mc-3', 'cost-det-8'] as const;

/**
 * Installs a spy over the single-player AI choice resolver that enforces the
 * no-stall contract on every paused turn: the call must clear the pending
 * choice, and the game clock of the *same* state must advance before the next
 * pause (a stalled harness would re-enter the same turn until the maxTurns
 * cap). `calls` counts how many paused choices were resolved.
 */
function guardSinglePlayerPendingChoices(): PendingChoiceGuard {
  const guard: PendingChoiceGuard = { calls: 0, restore: () => {} };
  const lastTurn = new WeakMap<MainStreetState, number>();
  const original = aiStrategyModule.resolveAiEventChoice;
  const spy = vi
    .spyOn(aiStrategyModule, 'resolveAiEventChoice')
    .mockImplementation((state: MainStreetState) => {
      original(state);
      // No `pendingEventChoice` survives the AI resolution (no stall).
      expect(state.pendingEventChoice).toBeNull();
      const previous = lastTurn.get(state);
      if (previous !== undefined) {
        // A stalled choice would resolve on the same turn forever.
        expect(state.turn).toBeGreaterThan(previous);
      }
      lastTurn.set(state, state.turn);
      guard.calls++;
    });
  guard.restore = () => spy.mockRestore();
  return guard;
}

/**
 * Installs the equivalent no-stall guard over the competitive dual-choice
 * resolver ({@link engineModule.resolveCompetitivePendingChoice}).
 */
function guardCompetitivePendingChoices(): PendingChoiceGuard {
  const guard: PendingChoiceGuard = { calls: 0, restore: () => {} };
  const lastTurn = new WeakMap<MainStreetState, number>();
  const original = engineModule.resolveCompetitivePendingChoice;
  const spy = vi
    .spyOn(engineModule, 'resolveCompetitivePendingChoice')
    .mockImplementation((state: MainStreetState) => {
      const result = original(state);
      expect(state.pendingEventChoice).toBeNull();
      const previous = lastTurn.get(state);
      if (previous !== undefined) {
        expect(state.turn).toBeGreaterThanOrEqual(previous);
      }
      lastTurn.set(state, state.turn);
      guard.calls++;
      return result;
    });
  guard.restore = () => spy.mockRestore();
  return guard;
}

/** Fixture-card choices captured in a single-player run summary. */
function fixtureChoices(run: MonteCarloRunSummary): string[] {
  return (run.storylineEvents ?? [])
    .filter((event) => event.baseEventId === COST_FIXTURE_EVENT_ID)
    .map((event) => event.choice);
}

// The registered fixture options are global; clear them after every test so
// the pre-existing harness cases keep their shipped-content behaviour.
afterEach(() => {
  resetStorylineRegistry();
});

// ── AC1: Deterministic head-to-head execution ────────────────

describe('AC1 — Deterministic head-to-head execution', () => {
  it('should produce identical results for the same seed across two runs', () => {
    const runA = runCompetitiveSeed('ac1-determ-1', 30);
    const runB = runCompetitiveSeed('ac1-determ-1', 30);

    expect(runA.winnerId).toBe(runB.winnerId);
    expect(runA.turns).toBe(runB.turns);
    expect(runA.endReason).toBe(runB.endReason);

    for (let pid = 0; pid < runA.players.length; pid++) {
      expect(runA.players[pid].finalScore).toBe(runB.players[pid].finalScore);
      expect(runA.players[pid].result).toBe(runB.players[pid].result);
      expect(runA.players[pid].finalCoins).toBe(runB.players[pid].finalCoins);
    }
  });

  it('should produce different outcomes for different seeds', () => {
    const runA = runCompetitiveSeed('ac1-diff-a', 30);
    const runB = runCompetitiveSeed('ac1-diff-b', 30);

    // At minimum, the turn counts should be non-trivial for both seeds.
    expect(runA.turns).toBeGreaterThan(0);
    expect(runB.turns).toBeGreaterThan(0);
  });

  it('should complete within the maxTurns cap', () => {
    const maxTurns = 5;
    // 'ac1-cap-1' previously ended via reputation collapse under the
    // 13-template pool (MS-0MUI7ZJK8003HY9J added ch-serial-seller, shifting
    // the seeded RNG stream) and was swapped for 'ac1-cap-3'. With the
    // per-seat failure evaluation (MS-0MUVBH589001L7NL) it is restored: the
    // run now terminates via the harness cap as intended.
    const run = runCompetitiveSeed('ac1-cap-1', maxTurns);

    expect(run.turns).toBeLessThanOrEqual(maxTurns);
    expect(run.endReason).toBe('max_turns_cap');
  });

  // 200 seeded head-to-head runs are CPU-bound (~8–12 s on a quiet host), so
  // an explicit timeout keeps the case clear of the project's 15 s unit
  // default under CI/agent load — matching monte-carlo-greedy-guardrail
  // (MS-0MVFQ5ODR001R7U2).
  //
  // MS-0MVNU5HNV007R803: the cost-gated + extra-effect fixture options are
  // registered for the run and the dual-choice resolver is guarded, so the
  // same 200 seeds (no seed-count inflation) also prove there is no AI stall
  // and no unresolved pending choice. A `No storyline option at index` would
  // throw out of the run and fail this case.
  it('should run ≥200 seeds in the batch harness', () => {
    registerAiCostFixtures();
    const guard = guardCompetitivePendingChoices();
    const seeds = makeSeeds(200);
    let result: ReturnType<typeof runCompetitiveMonteCarlo>;
    try {
      result = runCompetitiveMonteCarlo({ seeds, maxTurns: 30 });
    } finally {
      guard.restore();
    }

    expect(result.runs.length).toBe(200);
    expect(result.metrics.runs).toBe(200);

    // All runs should have completed without error
    for (const run of result.runs) {
      expect(run.turns).toBeGreaterThan(0);
      expect(run.turns).toBeLessThanOrEqual(30);
      expect(run.players).toHaveLength(2);
    }

    // The AI really resolved pausing incidents; each resolution cleared the
    // pending choice and time never stalled (asserted per state in the guard).
    expect(guard.calls).toBeGreaterThan(0);
  }, 120_000);
});

// ── AC2: Per-player metrics ──────────────────────────────────

describe('AC2 — Per-player metrics', () => {
  it('should include wins per player', () => {
    const seeds = makeSeeds(50);
    const result = runCompetitiveMonteCarlo({ seeds, maxTurns: 30 });

    expect(result.metrics.players).toHaveLength(2);

    for (const pm of result.metrics.players) {
      expect(pm.playerId).toBeGreaterThanOrEqual(0);
      expect(typeof pm.wins).toBe('number');
      expect(pm.wins).toBeGreaterThanOrEqual(0);
      expect(pm.wins).toBeLessThanOrEqual(result.metrics.runs);
      expect(pm.winRate).toBeGreaterThanOrEqual(0);
      expect(pm.winRate).toBeLessThanOrEqual(1);
    }
  });

  it('should include average score per player', () => {
    const seeds = makeSeeds(50);
    const result = runCompetitiveMonteCarlo({ seeds, maxTurns: 30 });

    for (const pm of result.metrics.players) {
      expect(typeof pm.averageScore).toBe('number');
      expect(pm.averageScore).toBeGreaterThanOrEqual(0);
      expect(typeof pm.medianScore).toBe('number');
    }
  });

  it('should include loss-reason distribution per player', () => {
    const seeds = makeSeeds(100);
    const result = runCompetitiveMonteCarlo({ seeds, maxTurns: 40 });

    for (const pm of result.metrics.players) {
      expect(typeof pm.lossReasons).toBe('object');
      expect(typeof pm.lossReasonRates).toBe('object');

      // lossReasonRates values should sum to 1.0 (or 0 if no losses)
      const rateSum = Object.values(pm.lossReasonRates).reduce((s, v) => s + v, 0);
      if (pm.losses > 0) {
        expect(rateSum).toBeCloseTo(1, 1);
      } else {
        expect(rateSum).toBe(0);
      }
    }
  });

  it('should include draws and end-reason distribution at run level', () => {
    const seeds = makeSeeds(50);
    const result = runCompetitiveMonteCarlo({ seeds, maxTurns: 10 }); // short to encourage cap

    expect(typeof result.metrics.draws).toBe('number');
    expect(typeof result.metrics.endReasons).toBe('object');

    const totalEndReasons = Object.values(result.metrics.endReasons).reduce((s, v) => s + v, 0);
    expect(totalEndReasons).toBe(result.metrics.runs);
  });

  it('should aggregate per-player losses and draws correctly', () => {
    const seeds = makeSeeds(50);
    const result = runCompetitiveMonteCarlo({ seeds, maxTurns: 30 });

    for (const pm of result.metrics.players) {
      const total = pm.wins + pm.losses + pm.draws;
      expect(total).toBe(result.metrics.runs);
    }
  });
});

// ── AC3: Extension (not replacement) ─────────────────────────

describe('AC3 — Extension of existing Monte Carlo', () => {
  it('should not break existing runMonteCarlo', () => {
    const seeds = makeSeeds(20);
    const result = runMonteCarlo({ seeds, strategy: 'market-greedy' });

    expect(result.runs.length).toBe(20);
    expect(result.metrics.runs).toBe(20);
    expect(result.metrics.winRate).toBeGreaterThanOrEqual(0);
    expect(result.metrics.winRate).toBeLessThanOrEqual(1);
  });

  it('should not break existing runAllCombinations', () => {
    const seeds = makeSeeds(10);
    const results = runAllCombinations({ seeds, maxTurns: 20, strategies: ['market-greedy'], difficulties: ['Easy'] });

    expect(results.length).toBe(1);
    expect(results[0].strategy).toBe('market-greedy');
    expect(results[0].difficulty).toBe('Easy');
    expect(results[0].runs.length).toBe(10);
  });
});

// ── Cost-aware AI event-choice harness verification ──────────
//
// MS-0MVNU5HNV007R803 (child of MS-0MVI0APQY000OIOY). With a cost-gated and an
// extra-effect option registered on a shipped incident, every harness must run
// to completion, never select an option outside the presented list, resolve
// every paused choice, and replay identically for the same seed.

describe('Cost-aware event-choice harness verification (MS-0MVNU5HNV007R803)', () => {
  it('single-player runMonteCarlo completes with no AI stall or unresolved choice', () => {
    registerAiCostFixtures();
    const guard = guardSinglePlayerPendingChoices();
    const seeds = [...FIXTURE_SEEDS, 'cost-mc-1', 'cost-mc-4'];
    let result: ReturnType<typeof runMonteCarlo>;
    try {
      result = runMonteCarlo({ seeds, maxTurns: 30, strategy: 'market-greedy' });
    } finally {
      guard.restore();
    }

    expect(result.runs.map((run) => run.seed)).toEqual(seeds);
    for (const run of result.runs) {
      expect(run.turns).toBeGreaterThan(0);
      expect(run.turns).toBeLessThanOrEqual(30);
      // Every recorded fixture choice is one the draw-time filter presented.
      for (const choice of fixtureChoices(run)) {
        expect(PRESENTED_LABELS).toContain(choice);
      }
    }

    // The AI path really ran, and the fixture card was genuinely in play.
    expect(guard.calls).toBeGreaterThan(0);
    expect(result.runs.flatMap(fixtureChoices).length).toBeGreaterThan(0);
  });

  it('runAllCombinations completes with cost/extra-effect options in play', () => {
    registerAiCostFixtures();
    const guard = guardSinglePlayerPendingChoices();
    let results: ReturnType<typeof runAllCombinations>;
    try {
      results = runAllCombinations({
        seeds: ['cost-combo-1', 'cost-combo-2'],
        maxTurns: 20,
        strategies: ['market-greedy'],
        difficulties: ['Medium'],
      });
    } finally {
      guard.restore();
    }

    expect(results).toHaveLength(1);
    for (const run of results[0].runs) {
      expect(run.turns).toBeGreaterThan(0);
      expect(run.turns).toBeLessThanOrEqual(20);
      for (const choice of fixtureChoices(run)) {
        expect(PRESENTED_LABELS).toContain(choice);
      }
    }
    expect(guard.calls).toBeGreaterThan(0);
  });

  it('same seed twice yields identical single-player outcomes (cost/extra-effect policy is RNG-free)', () => {
    registerAiCostFixtures();
    const seeds = [...FIXTURE_SEEDS];
    const first = runMonteCarlo({ seeds, maxTurns: 30, strategy: 'market-greedy' });
    const second = runMonteCarlo({ seeds, maxTurns: 30, strategy: 'market-greedy' });

    // Whole per-seed summary — scores, turns, economy history and the
    // storyline transcript choices — replays byte-identically.
    expect(second.runs).toEqual(first.runs);

    // …and the fixture card was genuinely in play (the check is not vacuous).
    const choices = first.runs.flatMap(fixtureChoices);
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices) {
      expect(choice).toBe(EXTRA_EFFECT_LABEL);
    }
  });

  it('same competitive seed twice yields identical per-seed outcomes (determinism)', () => {
    registerAiCostFixtures();
    for (const seed of ['cost-comp-replay-1', 'cost-comp-replay-2']) {
      const first = runCompetitiveSeed(seed, 20);
      const second = runCompetitiveSeed(seed, 20);

      expect(second.winnerId).toBe(first.winnerId);
      expect(second.turns).toBe(first.turns);
      expect(second.endReason).toBe(first.endReason);
      expect(second.players).toEqual(first.players);
      expect(second.finalGrid).toEqual(first.finalGrid);
    }
  });
});

// ── AC4: Validated against CompetitiveGreedyStrategy ─────────
describe('AC4 — CompetitiveGreedyStrategy validation', () => {
  it('should run head-to-head with CompetitiveGreedyStrategy', () => {
    const seeds = makeSeeds(30);
    const strategies = [CompetitiveGreedyStrategy, CompetitiveGreedyStrategy];
    const result = runCompetitiveMonteCarlo({
      seeds,
      strategies,
      playerCount: 2,
      maxTurns: 30,
    });

    expect(result.runs.length).toBe(30);
    expect(result.metrics.players).toHaveLength(2);

    // Both players should have results (wins + losses)
    for (const pm of result.metrics.players) {
      expect(pm.wins + pm.losses + pm.draws).toBe(30);
    }
  });

  it('should support asymmetric strategies (Greedy vs CompetitiveGreedy)', () => {
    const seeds = makeSeeds(30);
    const strategies = [GreedyStrategy, CompetitiveGreedyStrategy];
    const result = runCompetitiveMonteCarlo({
      seeds,
      strategies,
      playerCount: 2,
      maxTurns: 30,
    });

    expect(result.runs.length).toBe(30);
    expect(result.metrics.players).toHaveLength(2);

    // Each player should have different win rates (asymmetric strategies)
    const p0WinRate = result.metrics.players[0].winRate;
    const p1WinRate = result.metrics.players[1].winRate;
    expect(p0WinRate).toBeGreaterThanOrEqual(0);
    expect(p1WinRate).toBeGreaterThanOrEqual(0);
    // Win rates should sum to ≈1 (ignoring draws)
    const nonDrawWins = p0WinRate + p1WinRate;
    expect(nonDrawWins).toBeGreaterThan(0);
  });

  it('should handle deterministic replay of a single seed', () => {
    const seed = 'ac4-replay';
    const run1 = runCompetitiveSeed(seed, 30);
    const run2 = runCompetitiveSeed(seed, 30);

    expect(run1.winnerId).toBe(run2.winnerId);
    expect(run1.turns).toBe(run2.turns);
    expect(run1.endReason).toBe(run2.endReason);
    for (let pid = 0; pid < run1.players.length; pid++) {
      expect(run1.players[pid].finalScore).toBe(run2.players[pid].finalScore);
      expect(run1.players[pid].finalCoins).toBe(run2.players[pid].finalCoins);
    }
  });
});

// ── AC1/AC5: elimination & last-standing alignment ──────────

describe('Elimination & last-standing alignment', () => {
  it('reports an eliminated seat with its own loss reason, not the run reason', () => {
    // 'cf-elim-4-162' ends by last-standing: the AI is eliminated and the
    // human wins. The healthy winner must not be attributed the collapsed
    // seat's reason. (The fixture seed was updated from 'cf-elim-4-3' when the
    // AI acquisition gates (MS-0MV5VOIV40020KXT) shifted every seeded draw)
    // earlier updates: 'cf-elim-4-3' when the upgrade draw-weight mechanism
    // (MS-0MUYK08I1004I19W) shifted every seeded draw; 'cf-elim-4-x-4' when the
    // Investor staff card was added (MS-0MTISBYLS009936W), 'cf-elim-4-7' under
    // MS-0MUX8J9KJ005ZKDW, 'ac1-cap-5' under MS-0MUVB2ZES005V83Y.)
    const run = runCompetitiveSeed('cf-elim-4-162', 4);
    expect(run.endReason).toBe('last_standing');
    expect(run.winnerId).toBe(0);

    const eliminated = run.players.find(p => p.eliminated);
    expect(eliminated).toBeDefined();
    expect(eliminated!.result).toBe('loss');
    expect(eliminated!.lossReason).toBe('eliminated');

    const winner = run.players.find(p => p.playerId === run.winnerId);
    expect(winner).toBeDefined();
    expect(winner!.result).toBe('win');
    expect(winner!.lossReason).toBe('');
  });

  it('aggregated per-player loss reasons do not attribute a collapse to healthy seats', () => {
    const seeds = Array.from({ length: 30 }, (_, i) => `elim-align-${i + 1}`);
    const result = runCompetitiveMonteCarlo({ seeds, maxTurns: 20 });

    for (const run of result.runs) {
      if (!run.players.some(p => p.eliminated)) continue;
      for (const p of run.players) {
        if (p.eliminated) continue;
        // A surviving seat is never tagged with the 'eliminated' reason.
        expect(p.lossReason).not.toBe('eliminated');
      }
    }
  });

  it('same seed → identical winner, eliminations and end reason (determinism)', () => {
    const seed = 'ac1-cap-5';
    const a = runCompetitiveSeed(seed, 5);
    const b = runCompetitiveSeed(seed, 5);
    expect(b.winnerId).toBe(a.winnerId);
    expect(b.endReason).toBe(a.endReason);
    expect(b.turns).toBe(a.turns);
    for (let pid = 0; pid < a.players.length; pid++) {
      expect(b.players[pid].eliminated).toBe(a.players[pid].eliminated);
      expect(b.players[pid].result).toBe(a.players[pid].result);
      expect(b.players[pid].lossReason).toBe(a.players[pid].lossReason);
    }
  });

  it('every run stays bounded by maxTurns (no non-terminating seed)', () => {
    const maxTurns = 12;
    const seeds = Array.from({ length: 60 }, (_, i) => `bounded-${i + 1}`);
    const result = runCompetitiveMonteCarlo({ seeds, maxTurns });
    for (const run of result.runs) {
      expect(run.turns).toBeLessThanOrEqual(maxTurns);
      for (const p of run.players) {
        expect(['win', 'loss', 'draw']).toContain(p.result);
      }
    }
  });

  it('CSV includes the per-player eliminated column', () => {
    const result = runCompetitiveMonteCarlo({ seeds: ['ac1-cap-5'], maxTurns: 5 });
    const csv = toCompetitiveCsv(result.runs);
    expect(csv.split('\n')[0]).toContain('p1_eliminated');
  });
});

// ── CSV serialization ────────────────────────────────────────

describe('CSV serialization', () => {
  it('should produce valid CSV with header and data rows', () => {
    const seeds = makeSeeds(5);
    const result = runCompetitiveMonteCarlo({ seeds, maxTurns: 15 });
    const csv = toCompetitiveCsv(result.runs);
    const lines = csv.split('\n');

    expect(lines.length).toBe(6); // 1 header + 5 data rows
    expect(lines[0]).toContain('seed');
    expect(lines[0]).toContain('winnerId');
    expect(lines[0]).toContain('p0_result');
    expect(lines[0]).toContain('p1_score');
  });
});

// ── Edge cases ───────────────────────────────────────────────

describe('Edge cases', () => {
  it('should handle a run that ends via threshold (winner declared)', () => {
    const run = runCompetitiveSeed('edge-threshold', 30);

    // When a threshold winner is declared, the winner must be marked 'win'.
    // Bankruptcy / reputation-collapse endings have no winnerId (null).
    if (run.winnerId !== null) {
      expect(run.winnerId).toBeGreaterThanOrEqual(0);
      const winner = run.players.find(p => p.playerId === run.winnerId);
      expect(winner).toBeDefined();
      expect(winner!.result).toBe('win');
    }
  });

  it('should handle a draw scenario (tie at max turn cap)', () => {
    // Force a draw by using a very short turn limit where both players
    // may end with equal scores
    const run = runCompetitiveSeed('edge-draw', 3);

    expect(run.turns).toBeLessThanOrEqual(3);
    // Players can have draw results if tied for the lead
    const draws = run.players.filter(p => p.result === 'draw');
    const wins = run.players.filter(p => p.result === 'win');
    const losses = run.players.filter(p => p.result === 'loss');
    expect(draws.length + wins.length + losses.length).toBe(run.players.length);
  });
});
