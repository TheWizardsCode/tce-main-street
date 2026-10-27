/**
 * Main Street: loan headless determinism baseline (test support).
 *
 * Golden-record harness for the pre-loan headless simulation behaviour
 * (work item MS-0MVPWS45N008PR0X, child of the Bank Loans epic
 * MS-0MVL6DZI0000F6CG).
 *
 * The loan feature must not change any simulation that does not opt in
 * (parent AC8: "simulations without loans enabled are byte-identical to
 * today's results"). That comparison needs a snapshot of *today's* aggregates
 * captured before any loan code touches the closing sequence — which is what
 * this module provides.
 *
 * Two headless entry points are exercised with the same seeds:
 *
 * - a plain `endTurnHeadless` loop (the raw turn-closing entry point), and
 * - the Monte Carlo batch runner (`runMonteCarlo`), which drives actions
 *   through the seeded AI/market-greedy planner.
 *
 * Both are reduced through the same {@link summariseHeadlessResults} helper,
 * so the later loans-off comparison test reuses the loop + aggregation rather
 * than duplicating them.
 *
 * Determinism: every run is seeded (`setupMainStreetGame({ seed })` /
 * `runMonteCarlo({ seeds })`). No wall-clock time, no unseeded RNG, no
 * environment-dependent input is used, so the aggregates below are stable
 * across runs and machines.
 *
 * Loans-disabled precondition: `loansEnabled` does not exist yet, so every
 * run here is loans-off by construction. When the flag lands (parent AC8
 * config default `false` for headless/simulation configs) the comparison test
 * asserts it is false for these configs instead of changing this baseline.
 *
 * @module tests/main-street/helpers/loanHeadlessBaseline
 */

import { setupMainStreetGame } from '../../../src/MainStreetState';
import { endTurnHeadless, executeWeekStart } from '../../../src/MainStreetEngine';
import {
  runMonteCarlo,
  type MonteCarloStrategy,
} from '../../../src/MainStreetMonteCarlo';

/** Fixed seeds used by the golden baseline and the later loans-off comparison. */
export const LOAN_HEADLESS_BASELINE_SEEDS: readonly string[] = [
  'loan-baseline-0',
  'loan-baseline-1',
  'loan-baseline-2',
  'loan-baseline-3',
  'loan-baseline-4',
];

/**
 * Harness turn cap, matching the Monte Carlo default. It only bounds the loop;
 * games normally reach a terminal result well before it.
 */
export const LOAN_HEADLESS_BASELINE_MAX_TURNS = 60;

/** Strategy used by the Monte Carlo half of the baseline. */
export const LOAN_HEADLESS_BASELINE_STRATEGY: MonteCarloStrategy = 'market-greedy';

/** One finished headless game, reduced to the fields the baseline aggregates. */
export interface HeadlessBaselineSample {
  seed: string;
  result: 'win' | 'loss';
  endReason: string;
  /** Number of turns actually played. */
  turns: number;
  finalScore: number;
}

/** Golden aggregates captured from the pre-loan headless simulations. */
export interface HeadlessBaselineAggregates {
  /** Number of simulated games. */
  gamesPlayed: number;
  wins: number;
  losses: number;
  /** Games that ended on `endReason === 'bankruptcy'`. */
  bankruptcies: number;
  meanTurns: number;
  meanFinalScore: number;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Reduces finished headless games to the golden aggregates.
 *
 * Shared by both entry points so the loans-off comparison measures the same
 * quantities as the recorded baseline.
 */
export function summariseHeadlessResults(
  samples: readonly HeadlessBaselineSample[],
): HeadlessBaselineAggregates {
  const wins = samples.filter(sample => sample.result === 'win').length;
  const losses = samples.length - wins;
  return {
    gamesPlayed: samples.length,
    wins,
    losses,
    bankruptcies: samples.filter(sample => sample.endReason === 'bankruptcy').length,
    meanTurns: mean(samples.map(sample => sample.turns)),
    meanFinalScore: mean(samples.map(sample => sample.finalScore)),
  };
}

/**
 * Runs a plain `endTurnHeadless` loop per seed — no planned actions, only the
 * seeded week start and turn closing.
 */
export function runEndTurnHeadlessBaseline(
  seeds: readonly string[] = LOAN_HEADLESS_BASELINE_SEEDS,
  maxTurns: number = LOAN_HEADLESS_BASELINE_MAX_TURNS,
): HeadlessBaselineAggregates {
  const samples: HeadlessBaselineSample[] = seeds.map(seed => {
    const state = setupMainStreetGame({ seed });
    let turns = 0;
    while (state.gameResult === 'playing' && turns < maxTurns) {
      executeWeekStart(state);
      endTurnHeadless(state);
      turns++;
    }
    const playing = state.gameResult === 'playing';
    return {
      seed,
      result: state.gameResult === 'win' ? 'win' : 'loss',
      endReason: playing ? 'max_turns_cap' : (state.endReason ?? 'unknown'),
      turns,
      finalScore: state.finalScore,
    };
  });
  return summariseHeadlessResults(samples);
}

/**
 * Runs the Monte Carlo batch runner for the supplied seeds and reduces its
 * run summaries through the same aggregation.
 */
export function runMonteCarloHeadlessBaseline(
  seeds: readonly string[] = LOAN_HEADLESS_BASELINE_SEEDS,
  maxTurns: number = LOAN_HEADLESS_BASELINE_MAX_TURNS,
  strategy: MonteCarloStrategy = LOAN_HEADLESS_BASELINE_STRATEGY,
): HeadlessBaselineAggregates {
  const { runs } = runMonteCarlo({ seeds, maxTurns, strategy });
  return summariseHeadlessResults(
    runs.map(run => ({
      seed: run.seed,
      result: run.result,
      endReason: run.endReason,
      turns: run.turns,
      finalScore: run.finalScore,
    })),
  );
}
