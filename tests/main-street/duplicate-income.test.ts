/**
 * Main Street: Duplicate-Business Income Factor Tests
 *
 * Pins the **market-saturation** contract (MS-0MW0UAHEV0059517): when several
 * businesses of the same base type stand on the same street they compete for
 * the same customers, so each earns a reduced share of its usual coin income.
 *
 *   copies of a type on one street:  1  → 1
 *                                    2  → 2/3
 *                                    3  → 1/2
 *                                    4+ → 1/3
 *
 * The factor multiplies the business's *usual total coin income* (base after the
 * adjacent same-type 60% penalty, plus adjacency synergy) and the product is
 * rounded with `roundInt`, so these tests assert the reduced income a player
 * actually receives rather than a bare ratio.
 *
 * Counting rules (parent MS-0MVYG50V1007W8BP, producer-confirmed):
 *   - "same type" is the same base template id (`getBaseTypeId`);
 *   - every business on the street counts, **sold businesses included** — a
 *     sold card earns no income itself, but it still saturates its type;
 *   - community-space cards are excluded from both the count and the factor;
 *   - the street is one 5×2 cell, so duplicates on different streets do not
 *     interact; the default 1×1 board is a single street.
 *
 * Reputation is deliberately untouched by this mechanic — the factor is a coin
 * income rule only.
 */
import { describe, it, expect } from 'vitest';

import {
  duplicateIncomeFactor,
} from '../../src/MainStreetAdjacencyScoring';
import { sameStreetCell, streetSlotToWorldIndex } from '../../src/MainStreetAdjacencyGeometry';
import {
  DUPLICATE_FACTOR_TABLE,
  GRID_SIZE,
  worldSlotCount,
  type BusinessCard,
  type CommunitySpaceCard,
} from '../../src/MainStreetCards';
import { roundInt } from '../../src/MainStreetDifficulty';

// ── Fixtures ────────────────────────────────────────────────

/** A business of the given template (`biz-bakery-0`, `biz-bakery-1`, …). */
function makeBiz(id: string, overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id,
    name: overrides.name ?? 'Test Biz',
    cost: overrides.cost ?? 3,
    baseIncome: overrides.baseIncome ?? 12,
    synergyTypes: overrides.synergyTypes ?? ['Food'],
    maxLevel: overrides.maxLevel ?? 1,
    description: overrides.description ?? 'A test business',
    level: overrides.level ?? 0,
    incomeBonus: overrides.incomeBonus ?? 0,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    reputationBonus: overrides.reputationBonus ?? 0,
    ongoingCost: overrides.ongoingCost ?? 0,
    ...overrides,
  };
}

/** A community-space card; `id` is supplied so exclusion can be asserted. */
function makeCommunitySpace(id: string): CommunitySpaceCard {
  return {
    family: 'community-space',
    id,
    name: 'Test Park',
    cost: 3,
    baseIncome: 12,
    ongoingCost: 0,
    synergyTypes: ['Culture'],
    maxLevel: 1,
    description: 'A test community space',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
  };
}

type GridCard = BusinessCard | CommunitySpaceCard | null;

function emptyGrid(size: number = GRID_SIZE): GridCard[] {
  return new Array<GridCard>(size).fill(null);
}

/** The reduced income a player receives: `roundInt(usualCoinIncome × factor)`. */
function reducedIncome(usualCoinIncome: number, factor: number): number {
  return roundInt(usualCoinIncome * factor);
}

/** Places `copies` businesses of one template on consecutive slots. */
function placeCopies(grid: GridCard[], copies: number, baseId: string = 'biz-bakery', from: number = 0): void {
  for (let i = 0; i < copies; i++) {
    grid[from + i] = makeBiz(`${baseId}-${i}`);
  }
}

// ── Factor table ────────────────────────────────────────────

describe('duplicate income factor — factor table', () => {
  it('reduces income to 2/3 when two copies of a type share the street', () => {
    const grid = emptyGrid();
    placeCopies(grid, 2);

    expect(duplicateIncomeFactor(grid, 0)).toBe(DUPLICATE_FACTOR_TABLE[2]);
    expect(reducedIncome(12, duplicateIncomeFactor(grid, 0))).toBe(8);
    expect(reducedIncome(12, duplicateIncomeFactor(grid, 1))).toBe(8);
  });

  it('reduces income to 1/2 when three copies share the street', () => {
    const grid = emptyGrid();
    placeCopies(grid, 3);

    for (const index of [0, 1, 2]) {
      expect(duplicateIncomeFactor(grid, index)).toBe(DUPLICATE_FACTOR_TABLE[3]);
      expect(reducedIncome(12, duplicateIncomeFactor(grid, index))).toBe(6);
    }
  });

  it('reduces income to 1/3 for four copies, and keeps 1/3 for five or more', () => {
    const four = emptyGrid();
    placeCopies(four, 4);
    expect(duplicateIncomeFactor(four, 0)).toBe(DUPLICATE_FACTOR_TABLE[4]);
    expect(reducedIncome(12, duplicateIncomeFactor(four, 3))).toBe(4);

    const six = emptyGrid();
    placeCopies(six, 6);
    expect(duplicateIncomeFactor(six, 0)).toBe(DUPLICATE_FACTOR_TABLE[4]);
    expect(duplicateIncomeFactor(six, 5)).toBe(DUPLICATE_FACTOR_TABLE[4]);
    expect(reducedIncome(12, duplicateIncomeFactor(six, 5))).toBe(4);
  });

  it('rounds the reduced income with roundInt', () => {
    const grid = emptyGrid();
    placeCopies(grid, 2);

    // 5 × 2/3 = 3.33… → 3;  7 × 2/3 = 4.66… → 5;  5 × 1/3 = 1.66… → 2.
    expect(reducedIncome(5, duplicateIncomeFactor(grid, 0))).toBe(3);
    expect(reducedIncome(7, duplicateIncomeFactor(grid, 0))).toBe(5);

    const thirds = emptyGrid();
    placeCopies(thirds, 3);
    expect(reducedIncome(5, duplicateIncomeFactor(thirds, 0))).toBe(3); // 2.5 → 3 (half-up)
  });

  it('returns 1 (no factor) when only one business of the type exists', () => {
    const grid = emptyGrid();
    grid[4] = makeBiz('biz-bakery-0');

    expect(duplicateIncomeFactor(grid, 4)).toBe(1);
    expect(reducedIncome(12, duplicateIncomeFactor(grid, 4))).toBe(12);
  });

  it('returns 1 for an empty slot', () => {
    expect(duplicateIncomeFactor(emptyGrid(), 0)).toBe(1);
  });
});

// ── Counting rules ──────────────────────────────────────────

describe('duplicate income factor — counting rules', () => {
  it('counts sold businesses towards their type saturation', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz('biz-bakery-0');
    grid[5] = makeBiz('biz-bakery-1');
    const soldSlots = new Array<boolean>(GRID_SIZE).fill(false);
    soldSlots[5] = true;

    // The live bakery competes with the sold one: 2 copies → 2/3.
    expect(duplicateIncomeFactor(grid, 0, soldSlots)).toBe(DUPLICATE_FACTOR_TABLE[2]);
  });

  it('returns 1 for a sold business itself (it earns no income)', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz('biz-bakery-0');
    grid[5] = makeBiz('biz-bakery-1');
    const soldSlots = new Array<boolean>(GRID_SIZE).fill(false);
    soldSlots[5] = true;

    expect(duplicateIncomeFactor(grid, 5, soldSlots)).toBe(1);
  });

  it('excludes community-space cards from the count and the factor', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz('biz-bakery-0');
    // Same base id, but a community space is not a competitor.
    grid[1] = makeCommunitySpace('biz-bakery-1');

    expect(duplicateIncomeFactor(grid, 0)).toBe(1);
    expect(duplicateIncomeFactor(grid, 1)).toBe(1);
  });

  it('does not count businesses of a different base type', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz('biz-bakery-0');
    grid[1] = makeBiz('biz-cafe-0');
    grid[2] = makeBiz('biz-cafe-1');

    expect(duplicateIncomeFactor(grid, 0)).toBe(1);
    expect(duplicateIncomeFactor(grid, 1)).toBe(DUPLICATE_FACTOR_TABLE[2]);
  });

  it('groups upgraded copies of the same template by base type id', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz('biz-bakery-0');
    grid[1] = makeBiz('biz-bakery-1', { level: 2, incomeBonus: 4 });

    expect(duplicateIncomeFactor(grid, 0)).toBe(DUPLICATE_FACTOR_TABLE[2]);
    expect(duplicateIncomeFactor(grid, 1)).toBe(DUPLICATE_FACTOR_TABLE[2]);
  });
});

// ── Street scoping ──────────────────────────────────────────

describe('duplicate income factor — street scoping', () => {
  const TWO_BY_ONE = { cols: 2, rows: 1 };

  it('treats the whole default 1×1 board as one street', () => {
    const grid = emptyGrid();
    // Opposite corners of the single street: not adjacent, but same street.
    grid[0] = makeBiz('biz-bakery-0');
    grid[GRID_SIZE - 1] = makeBiz('biz-bakery-1');

    expect(duplicateIncomeFactor(grid, 0)).toBe(DUPLICATE_FACTOR_TABLE[2]);
  });

  it('treats an explicit 1×1 lattice the same as the default', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz('biz-bakery-0');
    grid[GRID_SIZE - 1] = makeBiz('biz-bakery-1');

    expect(duplicateIncomeFactor(grid, 0, [], { cols: 1, rows: 1 })).toBe(DUPLICATE_FACTOR_TABLE[2]);
  });

  it('does not let duplicates on different streets interact', () => {
    const grid = emptyGrid(worldSlotCount(TWO_BY_ONE.cols, TWO_BY_ONE.rows));
    const streetZeroFirst = streetSlotToWorldIndex(0, 0, 0, TWO_BY_ONE)!;
    const streetZeroLast = streetSlotToWorldIndex(0, 0, 9, TWO_BY_ONE)!;
    const streetOneFirst = streetSlotToWorldIndex(1, 0, 0, TWO_BY_ONE)!;
    grid[streetZeroFirst] = makeBiz('biz-bakery-0');
    grid[streetOneFirst] = makeBiz('biz-bakery-1');

    // Two bookshops, but on separate streets: no competition, no factor.
    expect(duplicateIncomeFactor(grid, streetZeroFirst, [], TWO_BY_ONE)).toBe(1);
    expect(duplicateIncomeFactor(grid, streetOneFirst, [], TWO_BY_ONE)).toBe(1);

    // A second copy on street (0,0) — the far corner — does apply the factor.
    grid[streetZeroLast] = makeBiz('biz-bakery-2');
    expect(duplicateIncomeFactor(grid, streetZeroFirst, [], TWO_BY_ONE)).toBe(DUPLICATE_FACTOR_TABLE[2]);
    expect(duplicateIncomeFactor(grid, streetZeroLast, [], TWO_BY_ONE)).toBe(2 / 3);
    expect(duplicateIncomeFactor(grid, streetOneFirst, [], TWO_BY_ONE)).toBe(1);
  });

  it('resolves street membership from world coordinates', () => {
    const lastOfStreetZero = streetSlotToWorldIndex(0, 0, 9, TWO_BY_ONE)!;
    const firstOfStreetOne = streetSlotToWorldIndex(1, 0, 0, TWO_BY_ONE)!;
    const lowerStreet = streetSlotToWorldIndex(0, 1, 0, { cols: 1, rows: 2 })!;

    expect(sameStreetCell(0, GRID_SIZE - 1)).toBe(true);
    expect(sameStreetCell(0, lastOfStreetZero, TWO_BY_ONE)).toBe(true);
    expect(sameStreetCell(lastOfStreetZero, firstOfStreetOne, TWO_BY_ONE)).toBe(false);
    expect(sameStreetCell(0, streetSlotToWorldIndex(0, 0, 9, { cols: 1, rows: 2 })!)).toBe(true);
    expect(sameStreetCell(0, lowerStreet, { cols: 1, rows: 2 })).toBe(false);
    // Out-of-range slots never share a street.
    expect(sameStreetCell(0, 999, TWO_BY_ONE)).toBe(false);
  });
});
