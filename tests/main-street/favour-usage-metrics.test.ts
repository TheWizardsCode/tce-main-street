/**
 * Monte Carlo Community Favour usage counters (MS-0MUVB2ZES005V83Y, AC1).
 *
 * `MonteCarloRunSummary` records how many Community Favour exchanges the AI
 * took (`favourRepToCoinsUses` / `favourCoinsToRepUses`) so the baseline and
 * after measurements in `docs/main-street/favour-ai-baseline.json` are
 * reproducible. These tests pin that instrumentation on the canonical greedy
 * profile:
 *  - both counters are present, integral and non-negative on every run;
 *  - the greedy AI's rep→coins exchange is actually observed (the counter is
 *    wired to executed actions, not just declared);
 *  - the result is deterministic for a given seed.
 */
import { describe, expect, it } from 'vitest';

import { runMonteCarlo } from '../../src/MainStreetMonteCarlo';

const SEEDS = Array.from({ length: 200 }, (_, i) => `mc-balance-${i}`);
const MAX_TURNS = 60;

describe('MonteCarloRunSummary — Community Favour usage counters', () => {
  it('records integral, non-negative counters on every canonical greedy run', () => {
    const { runs } = runMonteCarlo({ seeds: SEEDS, maxTurns: MAX_TURNS, strategy: 'greedy' });
    expect(runs).toHaveLength(SEEDS.length);

    for (const run of runs) {
      expect(Number.isInteger(run.favourRepToCoinsUses)).toBe(true);
      expect(run.favourRepToCoinsUses ?? -1).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(run.favourCoinsToRepUses)).toBe(true);
      expect(run.favourCoinsToRepUses ?? -1).toBeGreaterThanOrEqual(0);
    }
  });

  it('observes the greedy AI taking the rep→coins exchange', () => {
    const { runs } = runMonteCarlo({ seeds: SEEDS, maxTurns: MAX_TURNS, strategy: 'greedy' });
    const repToCoins = runs.reduce((sum, r) => sum + (r.favourRepToCoinsUses ?? 0), 0);
    // Baseline behaviour (AC1): the stalled-turn fallback is used several
    // times per run, so the canonical 200-seed profile must record many uses.
    expect(repToCoins).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    const first = runMonteCarlo({ seeds: ['mc-balance-0'], maxTurns: MAX_TURNS, strategy: 'greedy' }).runs[0];
    const second = runMonteCarlo({ seeds: ['mc-balance-0'], maxTurns: MAX_TURNS, strategy: 'greedy' }).runs[0];
    expect(second.favourRepToCoinsUses).toBe(first.favourRepToCoinsUses);
    expect(second.favourCoinsToRepUses).toBe(first.favourCoinsToRepUses);
  });
});
