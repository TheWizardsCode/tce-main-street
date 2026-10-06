/**
 * Main Street: community-space and investment-event re-pricing guardrails
 * (MS-0MUR9IN7L0004TO5).
 *
 * After the five-turn business-payback rebalance (MS-0MUQ50I1Y000B6L3),
 * community spaces and investment events were re-priced relative to the
 * ~4.87-turn business payback. The full analysis lives in
 * `docs/main-street/analysis/community-space-event-repricing.md`.
 *
 * This suite encodes the durable design invariants that motivated the change
 * (not the individual price points, which the family contract tests pin):
 *
 * - **Fair-value floor:** every one-shot investment event (a player purchase,
 *   excluding duration/multiplier effects) must return at least 70 % of its
 *   cost in coin-equivalent value, where 1 reputation = 1.5 coins (the
 *   Community Favour rep→coin conversion rate). Over-priced events are a
 *   material imbalance.
 * - **Integer economy:** all coin values are whole integers.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';

import { getCsvRows } from '../../src/MainStreetCards';

/** 1 reputation = 1.5 coins (Community Favour rep→coin conversion). */
const REPS_TO_COINS = 1.5;

/** Minimum acceptable one-shot investment-event return on cost. */
const MIN_INVESTMENT_ROI = 0.7;

interface InvestmentEventRow {
  id: string;
  name: string;
  cost: number;
  coinDelta: number;
  reputationDelta: number;
}

/**
 * One-shot investment events: positive-cost `Investment` events without a
 * duration or `effectType` (duration/multiplier events have sustained value
 * that simple ROI does not capture and are excluded by design).
 */
function oneShotInvestmentEvents(): InvestmentEventRow[] {
  return getCsvRows()
    .filter(
      row =>
        row.family === 'event' &&
        row.trigger === 'Investment' &&
        Number(row.cost) > 0 &&
        !Number(row.duration) &&
        !row.effectType,
    )
    .map(row => ({
      id: row.id,
      name: row.name,
      cost: Number(row.cost),
      coinDelta: Number(row.coinDelta) || 0,
      reputationDelta: Number(row.reputationDelta) || 0,
    }));
}

describe('MS-0MUR9IN7L0004TO5: investment-event fair-value floor', () => {
  it('finds the one-shot investment events (guards against an empty sample)', () => {
    // A silent regression in the filter would make the ROI assertion vacuous.
    expect(oneShotInvestmentEvents().length).toBeGreaterThanOrEqual(15);
  });

  it('every one-shot investment event returns at least 70% of its cost in value', () => {
    const events = oneShotInvestmentEvents();
    const underpriced = events
      .map(event => {
        const totalValue = event.coinDelta + event.reputationDelta * REPS_TO_COINS;
        return { ...event, roi: totalValue / event.cost };
      })
      .filter(event => event.roi < MIN_INVESTMENT_ROI);

    expect(
      underpriced,
      `Under-priced investment events (< ${MIN_INVESTMENT_ROI}x): ` +
        underpriced
          .map(e => `${e.name} (${e.id}) cost=${e.cost} roi=${e.roi.toFixed(2)}x`)
          .join(', '),
    ).toEqual([]);
  });
});

describe('MS-0MUR9IN7L0004TO5: integer economy', () => {
  it('prices every community space and event as a whole number of coins', () => {
    const nonInteger = getCsvRows()
      .filter(row => row.family === 'community-space' || row.family === 'event')
      .filter(row => {
        const cost = row.cost;
        return cost !== '' && !/^\d+$/.test(cost);
      });

    expect(
      nonInteger.map(row => `${row.name} (${row.id}) cost=${row.cost}`),
    ).toEqual([]);
  });
});
