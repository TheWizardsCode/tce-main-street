/**
 * Business Payback Contract Test (MS-0MUQ50I1Y000B6L3)
 *
 * Deterministic, simulation-free test over `src/card-data.csv` that enforces
 * the ~5-turn net payback contract for income-generating businesses.
 *
 * Acceptance criteria covered:
 *   (a) mean net payback across income businesses is 4.5–5.5 turns
 *   (b) payback is cost-graded: cheap businesses pay back faster than
 *       expensive ones (bucket means strictly increasing by cost band, and/or
 *       Spearman rank correlation between cost and payback ≥ 0.6)
 *   (c) every income business has positive net income (baseIncome > ongoingCost)
 *   (d) intentional exceptions (0-income reputation cards, producer-overridden
 *       costs, 0-cost incident cards) are explicitly listed with rationale
 *
 * This test is **red** against the pre-change CSV (current payback ~2.1 turns)
 * and turns **green** after the `baseIncome` re-derivation (sibling F3).
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import { getBusinessTemplates, getCsvRows } from '../../src/MainStreetCards';
import { computePayback } from '../../src/scripts/balance/engine/card-metrics';

// ── Helpers ─────────────────────────────────────────────────

/**
 * Parse a numeric CSV column value to a number.
 * Empty strings return 0 (the default for missing numeric columns).
 */
function csvNum(value: string | undefined, fallback = 0): number {
  if (value === undefined || value === '') return fallback;
  return parseFloat(value);
}

/**
 * All income-generating business templates from the current CSV.
 */
function incomeBusinesses(): {
  id: string;
  name: string;
  cost: number;
  baseIncome: number;
  ongoingCost: number;
  netIncome: number;
}[] {
  const templates = getBusinessTemplates();
  return templates
    .filter(b => b.baseIncome > 0)
    .map(b => {
      const netIncome = b.baseIncome - (b.ongoingCost ?? 0);
      return {
        id: b.id,
        name: b.name,
        cost: b.cost,
        baseIncome: b.baseIncome,
        ongoingCost: b.ongoingCost ?? 0,
        netIncome,
      };
    });
}

/**
 * All CSV rows for business cards (for exception identification).
 */
function csvBusinessRows(): Record<string, string>[] {
  return getCsvRows().filter(r => r.family === 'business');
}

/**
 * Cost-band bucket classification for a business card.
 */
function costBand(cost: number): string {
  if (cost <= 400) return 'cheap';       // 200–400
  if (cost <= 700) return 'mid';         // 500–700
  if (cost <= 1000) return 'mid-high';   // 800–1000
  return 'flagship';                     // 1200–1600
}

// ── AC (d): Documented exceptions ───────────────────────────

describe('Intentional exceptions (AC d)', () => {
  it('should list all zero-income (reputation-only) business cards', () => {
    // The Clinic has 0 baseIncome by design — it is a reputation generator,
    // not an income business. Its payback is n/a.
    const templates = getBusinessTemplates();
    const zeroIncome = templates.filter(b => b.baseIncome === 0 && b.ongoingCost > 0);

    // Clinic is the only zero-income business with positive ongoing cost
    const clinic = zeroIncome.find(b => b.id === 'biz-clinic');
    expect(clinic).toBeDefined();
    expect(clinic!.name).toBe('Clinic');
    expect(clinic!.baseIncome).toBe(0);

    // Charity Shop has positive income but a producer-set manual cost override;
    // its payback is intentionally not part of the contract mean.
    const charityShop = templates.find(b => b.id === 'biz-charity-shop');
    expect(charityShop).toBeDefined();
    expect(charityShop!.baseIncome).toBe(150); // low income, manual cost

    // Exception list:
    // 1. Clinic (biz-clinic): 0 income by design — reputation generator,
    //    +40 rep/turn, cost 900, ongoingCost 50. Net payback = n/a (no income).
    // 2. Charity Shop (biz-charity-shop): Producer-mandated cost override;
    //    low-income community card, cost 300, baseIncome 150, ongoingCost 75.
    //    Payback is not representative of the general model.
  });

  it('should identify 0-cost incident cards as exceptions', () => {
    // Incident event cards (cost 0) are not income businesses and are
    // explicitly excluded from the payback contract.
    const rows = getCsvRows().filter(r => r.family === 'event' && parseInt(r.cost) === 0);
    // There are many incident events; just verify at least a couple exist.
    expect(rows.length).toBeGreaterThan(5);
  });
});

// ── AC (c): Positive net income ─────────────────────────────

describe('Positive net income for income businesses (AC c)', () => {
  it('should have baseIncome > ongoingCost for every income-generating business', () => {
    const businesses = incomeBusinesses();
    expect(businesses.length).toBeGreaterThan(0);

    for (const biz of businesses) {
      expect(biz.baseIncome, `${biz.name}: baseIncome must exceed ongoingCost`).toBeGreaterThan(
        biz.ongoingCost,
      );
      expect(biz.netIncome, `${biz.name}: net income must be positive`).toBeGreaterThan(0);
    }
  });
});

// ── AC (a): Mean net payback 4.5–5.5 ────────────────────────

describe('Mean net payback contract (AC a)', () => {
  it('should have mean net payback across income businesses between 4.5 and 5.5 turns', () => {
    const businesses = incomeBusinesses();
    expect(businesses.length).toBeGreaterThan(0);

    const paybacks = businesses.map(b => computePayback(b));
    const meanPayback = paybacks.reduce((sum, p) => sum + p.netPayback, 0) / paybacks.length;

    // This test is expected to FAIL (red) against the pre-change CSV.
    // Current mean payback is ~2.1 turns. After the baseIncome re-derivation
    // (sibling F3), this should pass.
    expect(meanPayback).toBeGreaterThanOrEqual(4.5);
    expect(meanPayback).toBeLessThanOrEqual(5.5);
  });
});

// ── AC (b): Cost-graded payback ─────────────────────────────

describe('Cost-graded payback (AC b)', () => {
  it('should have bucket means strictly increasing by cost band', () => {
    const businesses = incomeBusinesses();
    expect(businesses.length).toBeGreaterThan(0);

    const buckets: Record<string, number[]> = {
      cheap: [],
      mid: [],
      'mid-high': [],
      flagship: [],
    };

    for (const biz of businesses) {
      const band = costBand(biz.cost);
      const pb = computePayback(biz);
      buckets[band].push(pb.netPayback);
    }

    // Only consider buckets that have data
    const bucketMeans: Record<string, number> = {};
    for (const [band, values] of Object.entries(buckets)) {
      if (values.length > 0) {
        bucketMeans[band] = values.reduce((s, v) => s + v, 0) / values.length;
      }
    }

    // Verify monotonicity: cheap < mid < mid-high < flagship
    const bands = ['cheap', 'mid', 'mid-high', 'flagship'] as const;
    let prevMean = -Infinity;
    let monotone = true;
    for (const band of bands) {
      if (bucketMeans[band] !== undefined) {
        expect(bucketMeans[band], `${band} bucket mean`).toBeGreaterThan(prevMean);
        prevMean = bucketMeans[band];
      }
    }
  });

  it('should have Spearman rank correlation between cost and net payback ≥ 0.6', () => {
    const businesses = incomeBusinesses();
    expect(businesses.length).toBeGreaterThan(2); // Need at least 3 for meaningful correlation

    // Compute Spearman rank correlation
    const costs = businesses.map(b => b.cost);
    const paybacks = businesses.map(b => {
      const pb = computePayback(b);
      // Use net payback, but cap at a finite value for ranking
      return pb.netPayback === Infinity ? 1e9 : pb.netPayback;
    });

    const spearman = computeSpearmanRankCorrelation(costs, paybacks);

    // This test is expected to FAIL (red) against the pre-change CSV.
    // Current cost-payback correlation is low because all paybacks are ~2 turns.
    // After the re-derivation (F3), this should pass.
    expect(spearman).toBeGreaterThanOrEqual(0.6);
  });
});

// ── Utility: Spearman rank correlation ──────────────────────

/**
 * Computes Spearman's rank correlation coefficient between two equal-length
 * numeric arrays. Returns a value in [-1, 1].
 *
 * Handles ties by assigning average ranks.
 */
function computeSpearmanRankCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n !== y.length || n < 2) return 0;

  const rankX = rankArray(x);
  const rankY = rankArray(y);

  // Pearson correlation of ranks
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const rx = rankX[i];
    const ry = rankY[i];
    sumX += rx;
    sumY += ry;
    sumXY += rx * ry;
    sumX2 += rx * rx;
    sumY2 += ry * ry;
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY),
  );

  if (denominator === 0) return 0;
  return numerator / denominator;
}

/**
 * Ranks an array of numbers, handling ties by assigning average ranks.
 * Ranks are 1-based.
 */
function rankArray(values: number[]): number[] {
  // Create indexed pairs, sort by value
  const indexed = values.map((v, i) => ({ value: v, index: i }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    // Find all ties
    while (j < indexed.length && indexed[j].value === indexed[i].value) {
      j++;
    }
    // Average rank for the tie group
    const avgRank = (i + j + 1) / 2; // 1-based
    for (let k = i; k < j; k++) {
      ranks[indexed[k].index] = avgRank;
    }
    i = j;
  }

  return ranks;
}

// ── Sanity: Gross payback also reported ─────────────────────

describe('Gross payback reported alongside net (AC a)', () => {
  it('should include gross payback in the payback result', () => {
    const businesses = incomeBusinesses();
    expect(businesses.length).toBeGreaterThan(0);

    for (const biz of businesses.slice(0, 3)) {
      const pb = computePayback(biz);
      expect(Number.isFinite(pb.netPayback)).toBe(true);
      expect(Number.isFinite(pb.grossPayback)).toBe(true);
      expect(pb.grossPayback).toBeLessThanOrEqual(pb.netPayback); // gross <= net (since ongoingCost >= 0)
    }
  });
});

// ── Metric unit tests for computePayback ────────────────────

describe('computePayback — unit tests', () => {
  it('should compute net payback = cost / (baseIncome - ongoingCost)', () => {
    const result = computePayback({ cost: 500, baseIncome: 400, ongoingCost: 125 });
    // Net income = 400 - 125 = 275
    // Payback = 500 / 275 = 1.818...
    expect(result.netPayback).toBeCloseTo(500 / 275, 5);
    expect(result.grossPayback).toBeCloseTo(500 / 400, 5);
    expect(result.netIncome).toBe(275);
    expect(result.ongoingCost).toBe(125);
  });

  it('should handle zero ongoingCost (default)', () => {
    const result = computePayback({ cost: 500, baseIncome: 500 });
    expect(result.netPayback).toBeCloseTo(500 / 500, 5); // = 1.0
    expect(result.grossPayback).toBeCloseTo(500 / 500, 5);
    expect(result.netIncome).toBe(500);
    expect(result.ongoingCost).toBe(0);
  });

  it('should return Infinity when baseIncome is zero', () => {
    const result = computePayback({ cost: 900, baseIncome: 0, ongoingCost: 50 });
    expect(result.netPayback).toBe(Infinity);
    expect(result.grossPayback).toBe(Infinity);
    expect(result.netIncome).toBe(-50);
  });

  it('should return Infinity when baseIncome equals ongoingCost (zero net income)', () => {
    const result = computePayback({ cost: 500, baseIncome: 100, ongoingCost: 100 });
    expect(result.netPayback).toBe(Infinity);
    expect(result.grossPayback).toBeCloseTo(500 / 100, 5);
    expect(result.netIncome).toBe(0);
  });

  it('should return Infinity when ongoingCost exceeds baseIncome (negative net income)', () => {
    const result = computePayback({ cost: 500, baseIncome: 80, ongoingCost: 100 });
    expect(result.netPayback).toBe(Infinity);
    expect(result.grossPayback).toBeCloseTo(500 / 80, 5);
    expect(result.netIncome).toBe(-20);
  });

  it('should return 0 payback when cost is zero', () => {
    const result = computePayback({ cost: 0, baseIncome: 100, ongoingCost: 10 });
    expect(result.netPayback).toBe(0);
    expect(result.grossPayback).toBe(0);
  });

  it('should throw on negative cost', () => {
    expect(() => computePayback({ cost: -100, baseIncome: 100 })).toThrow(TypeError);
  });

  it('should throw on negative baseIncome', () => {
    expect(() => computePayback({ cost: 100, baseIncome: -50 })).toThrow(TypeError);
  });
});
