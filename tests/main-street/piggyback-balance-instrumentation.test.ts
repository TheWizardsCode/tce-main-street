/**
 * Main Street: competitive piggyback balance instrumentation (F7).
 *
 * F7 leaf MS-0MV8BKEGT002T2H2 of epic MS-0MUYC47EL005Z69H. The competitive
 * Monte Carlo harness tallies the piggyback trade per seat
 * (`CompetitivePiggybackStats`: decisions / joins / free-rides / coins spent
 * and earned) so the before/after balance evidence can attribute win-rate and
 * coin drift to the mechanic (`docs/dev/monte-carlo-piggyback-evidence.md`).
 *
 * These tests pin the instrumentation contract:
 *
 *  1. Determinism — identical seeds produce identical tallies (the tally is
 *     additive and consumes no RNG).
 *  2. Internal consistency — `decisions === joins + freeRides`, every field is
 *     a non-negative count/sum, and joins always imply a non-zero charge.
 *  3. Exercise — the canonical competitive seed set actually triggers the
 *     mechanic and pays rewards (otherwise a "no drift" result would be an
 *     artefact of the mechanic never firing).
 */
import { describe, it, expect } from 'vitest';

import {
  emptyCompetitivePiggybackStats,
  runCompetitiveSeed,
  runCompetitiveMonteCarlo,
  type CompetitivePiggybackStats,
} from '../../src/MainStreetMonteCarlo';

const CANONICAL_PREFIX = 'mc-competitive';

function canonicalSeeds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${CANONICAL_PREFIX}-${i}`);
}

function assertConsistent(stats: CompetitivePiggybackStats): void {
  expect(stats.decisions).toBe(stats.joins + stats.freeRides);
  for (const value of [
    stats.decisions,
    stats.joins,
    stats.freeRides,
    stats.coinsSpent,
    stats.coinsEarned,
    stats.reputationEarned,
    stats.paidCostTotal,
  ]) {
    expect(value).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(value)).toBe(true);
  }
  // A join always pays the 150% charge; the charge is at most 2× the sum of
  // event costs it was based on (paidCostTotal) for any non-negative cost.
  if (stats.joins > 0) expect(stats.coinsSpent).toBeGreaterThan(0);
  expect(stats.coinsSpent).toBeLessThanOrEqual(2 * stats.paidCostTotal);
}

describe('emptyCompetitivePiggybackStats', () => {
  it('returns a zeroed, consistent tally', () => {
    const stats = emptyCompetitivePiggybackStats();
    expect(stats).toEqual({
      decisions: 0,
      joins: 0,
      freeRides: 0,
      coinsSpent: 0,
      coinsEarned: 0,
      reputationEarned: 0,
      paidCostTotal: 0,
    });
    assertConsistent(stats);
  });
});

describe('competitive piggyback harness tally', () => {
  it('is deterministic across identical seeds', () => {
    const seed = `${CANONICAL_PREFIX}-0`;
    const a = runCompetitiveSeed(seed, 40);
    const b = runCompetitiveSeed(seed, 40);
    for (let pid = 0; pid < a.players.length; pid++) {
      expect(a.players[pid].piggybackStats).toEqual(b.players[pid].piggybackStats);
    }
  });

  it('keeps every per-seat tally internally consistent', () => {
    const result = runCompetitiveMonteCarlo({ seeds: canonicalSeeds(30), maxTurns: 40 });
    for (const run of result.runs) {
      for (const player of run.players) {
        expect(player.piggybackStats).toBeDefined();
        assertConsistent(player.piggybackStats!);
      }
    }
  });

  it('exercises the mechanic and pays piggyback rewards on the canonical seed set', () => {
    const result = runCompetitiveMonteCarlo({ seeds: canonicalSeeds(30), maxTurns: 40 });

    const totals = result.runs
      .flatMap(run => run.players.map(p => p.piggybackStats!))
      .reduce<CompetitivePiggybackStats>((acc, s) => {
        acc.decisions += s.decisions;
        acc.joins += s.joins;
        acc.freeRides += s.freeRides;
        acc.coinsSpent += s.coinsSpent;
        acc.coinsEarned += s.coinsEarned;
        acc.reputationEarned += s.reputationEarned;
        acc.paidCostTotal += s.paidCostTotal;
        return acc;
      }, emptyCompetitivePiggybackStats());

    // The canonical competitive profile must actually reach the mechanic —
    // otherwise the before/after "no drift" finding would be vacuous.
    expect(totals.decisions).toBeGreaterThan(0);
    expect(totals.decisions).toBe(totals.joins + totals.freeRides);

    // Every decision pays a free-ride or full-tier reward, so at least one
    // reward currency must have flowed to a piggybacker.
    expect(totals.coinsEarned + totals.reputationEarned).toBeGreaterThan(0);

    // The free-ride-only profile (no affordable/worthwhile joins) never spends
    // coins — the tally must reflect the F4 affordability/liquidity gate.
    if (totals.joins === 0) expect(totals.coinsSpent).toBe(0);
  });
});
