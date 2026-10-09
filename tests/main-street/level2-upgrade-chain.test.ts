/**
 * Main Street: Level-2 upgrade chain invariant (MS-0MUXAL8HC005P9E4).
 *
 * Protects the two-step, level-gated upgrade chain described in
 * `docs/main-street/card-catalog.md` (PRD milestone 2, US-19) and pins the
 * M1/M5 metric computation used for the level-2 reachability evidence:
 *
 *  - every level-2 capstone upgrade keeps `requiredLevel: 1` in the shipped
 *    `src/card-data.csv` (the gate must not be weakened to lift adoption);
 *  - each capstone has a matching level-0 prerequisite for the same
 *    business, so the chain remains reachable by design;
 *  - the shipped upgrade deck carries all chain cards at the intended level;
 *  - the canonical M1 (pick rate) and M5 (upgrade adoption) metrics compute
 *    the expected values, tying the balancing evidence to the shared
 *    balance-analysis API (`src/scripts/balance/engine`).
 *
 * The metric functions themselves are unit-tested in
 * `tests/main-street/balance/card-metrics.test.ts`; this file asserts the
 * *product* invariant (the shipped chain + its measured metrics), which is
 * distinct from those generic edge-case tests.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';

import { getCsvRows, createUpgradeDeck } from '../../src/MainStreetCards';
import type { MonteCarloRunSummary } from '../../src/MainStreetMonteCarlo';
import {
  computePickRate,
  computeUpgradeAdoption,
} from '../../src/scripts/balance/engine';

/**
 * The four level-2 capstones, their level-0 prerequisite branch, and the
 * business both target. The prerequisite is the branching path the canonical
 * greedy strategy favours; the standard path (`upg-patisserie`,
 * `upg-bistro`, `upg-imax`, `upg-resort-spa`) is asserted separately.
 */
const LEVEL2_CHAINS = [
  { capstone: 'upg-grand-bakehouse', prerequisite: 'upg-bread-factory', business: 'Bakery' },
  { capstone: 'upg-restaurant', prerequisite: 'upg-fast-food', business: 'Diner' },
  { capstone: 'upg-multiplex', prerequisite: 'upg-drive-in', business: 'Cinema' },
  { capstone: 'upg-luxury-retreat', prerequisite: 'upg-wellness-center', business: 'Day Spa' },
] as const;

/** The standard (non-branching) level-0 upgrade for each chain business. */
const STANDARD_PREREQUISITES = [
  'upg-patisserie',
  'upg-bistro',
  'upg-imax',
  'upg-resort-spa',
] as const;

// ── Card-data invariant (US-19 AC2/AC3) ───────────────────────────────

describe('level-2 upgrade chain: card-data invariant', () => {
  const rows = getCsvRows().filter(r => r.family === 'upgrade');

  it.each(LEVEL2_CHAINS)(
    '$capstone keeps requiredLevel: 1 (gate preserved)',
    ({ capstone }) => {
      const row = rows.find(r => r.id === capstone);
      expect(row, `${capstone} missing from card-data.csv`).toBeDefined();
      expect(Number(row!.requiredLevel)).toBe(1);
    },
  );

  it.each(LEVEL2_CHAINS)(
    '$capstone has a level-0 prerequisite for the same business',
    ({ capstone, prerequisite, business }) => {
      const capstoneRow = rows.find(r => r.id === capstone);
      const prerequisiteRow = rows.find(r => r.id === prerequisite);
      expect(prerequisiteRow, `${prerequisite} missing from card-data.csv`).toBeDefined();
      expect(Number(prerequisiteRow!.requiredLevel)).toBe(0);
      expect(prerequisiteRow!.targetBusiness).toBe(capstoneRow!.targetBusiness);
      expect(capstoneRow!.targetBusiness).toBe(business);
    },
  );

  it.each(STANDARD_PREREQUISITES)(
    '%s is a level-0 alternative for a chain business',
    (prerequisite) => {
      const row = rows.find(r => r.id === prerequisite);
      expect(row, `${prerequisite} missing from card-data.csv`).toBeDefined();
      expect(Number(row!.requiredLevel)).toBe(0);
    },
  );

  it('exposes all eight chain cards in the generated upgrade deck', () => {
    const deck = createUpgradeDeck(1);
    for (const { capstone, prerequisite } of LEVEL2_CHAINS) {
      expect(deck.some(c => c.id.startsWith(capstone)), `${capstone} absent`).toBe(true);
      expect(deck.some(c => c.id.startsWith(prerequisite)), `${prerequisite} absent`).toBe(true);
    }
  });

  it('the deck preserves the level gate for every capstone', () => {
    const deck = createUpgradeDeck(1);
    for (const { capstone } of LEVEL2_CHAINS) {
      const card = deck.find(c => c.id.startsWith(capstone));
      expect(card, `${capstone} absent from deck`).toBeDefined();
      expect(card!.requiredLevel).toBe(1);
    }
  });
});

// ── M1/M5 metric computation on the canonical chain ───────────────────

/** Minimal run summary factory for the metric assertions. */
function run(
  seed: string,
  cardsOwned: string[],
  marketOffers: string[],
): MonteCarloRunSummary {
  return { seed, cardsOwned, marketOffers } as unknown as MonteCarloRunSummary;
}

describe('level-2 upgrade chain: M1/M5 metrics', () => {
  // Realistic run summaries: owning an upgrade always implies owning its
  // parent business. Across four runs the Bakery is held three times, the
  // level-1 Bread Factory prerequisite twice, and the Grand Bakehouse
  // capstone once. The capstone is offered in all four markets.
  const runs: MonteCarloRunSummary[] = [
    run(
      'r1',
      ['biz-bakery-0', 'upg-bread-factory-0', 'upg-grand-bakehouse-0'],
      ['upg-grand-bakehouse-0'],
    ),
    run('r2', ['biz-bakery-0', 'upg-bread-factory-0'], ['upg-grand-bakehouse-0']),
    run('r3', ['biz-bakery-0'], ['upg-grand-bakehouse-0', 'upg-grand-bakehouse-1']),
    run('r4', [], ['upg-grand-bakehouse-0']),
  ];

  it('M1 = capstone purchases / market appearances', () => {
    const result = computePickRate('upg-grand-bakehouse', runs);
    expect(result).not.toBeNull();
    expect(result!.purchases).toBe(1);
    expect(result!.appearances).toBe(4);
    expect(result!.value).toBeCloseTo(0.25, 10);
  });

  it('M5 = level-1 prerequisite adoption / parent business purchases', () => {
    // Canonical M5 semantics: the parent is the business the upgrade targets.
    const result = computeUpgradeAdoption('upg-bread-factory', 'biz-bakery', runs);
    expect(result).not.toBeNull();
    expect(result!.parentPurchases).toBe(3);
    expect(result!.upgrades).toBe(2);
    expect(result!.value).toBeCloseTo(2 / 3, 10);
  });

  it('M5 = capstone adoption conditional on the level-1 prerequisite', () => {
    const result = computeUpgradeAdoption('upg-grand-bakehouse', 'upg-bread-factory', runs);
    expect(result).not.toBeNull();
    expect(result!.parentPurchases).toBe(2);
    expect(result!.upgrades).toBe(1);
    expect(result!.value).toBeCloseTo(0.5, 10);
  });

  it('M5 is zero when the parent business never sold', () => {
    const result = computeUpgradeAdoption('upg-grand-bakehouse', 'biz-spa', runs);
    expect(result).not.toBeNull();
    expect(result!.parentPurchases).toBe(0);
    expect(result!.upgrades).toBe(1);
    expect(result!.value).toBe(0);
  });
});
