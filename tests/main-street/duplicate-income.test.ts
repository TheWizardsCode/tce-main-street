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
  applyDuplicateIncomeFactor,
  applyIncome,
  computeBusinessIncome,
  computeIncome,
  computeSingleCardReputation,
  computeSynergyRepBonus,
  duplicateIncomeFactor,
  recalculateCard,
  syncCardCurrentIncome,
} from '../../src/MainStreetAdjacencyScoring';
import { setupMainStreetGame } from '../../src/MainStreetState';
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

// ── Factor application ─────────────────────────────────────

describe('duplicate income factor — applying the factor to income', () => {
  it('rounds the reduced income with roundInt (half-up)', () => {
    // 5 × 2/3 = 3.33… → 3;  7 × 2/3 = 4.66… → 5;  5 × 1/2 = 2.5 → 3.
    expect(applyDuplicateIncomeFactor(5, DUPLICATE_FACTOR_TABLE[2])).toBe(3);
    expect(applyDuplicateIncomeFactor(7, DUPLICATE_FACTOR_TABLE[2])).toBe(5);
    expect(applyDuplicateIncomeFactor(5, DUPLICATE_FACTOR_TABLE[3])).toBe(3);
  });

  it('leaves income untouched at a factor of 1', () => {
    expect(applyDuplicateIncomeFactor(12, 1)).toBe(12);
    expect(applyDuplicateIncomeFactor(0, 1)).toBe(0);
  });

  it('composes with duplicateIncomeFactor for a saturated street', () => {
    const grid = emptyGrid();
    placeCopies(grid, 4);

    // Six copies of a 12-coin business on one street: 1/3 each → 4.
    expect(applyDuplicateIncomeFactor(12, duplicateIncomeFactor(grid, 0))).toBe(4);
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

// ── Single-player income integration ───────────────────────
// MS-0MW0UCMF9004H9NT wires the factor into the income computation itself, so
// these tests assert the coin amounts a player is actually credited rather
// than the bare factor.

describe('duplicate income factor — single-player income integration', () => {
  it('reduces computeBusinessIncome to 2/3 for two non-adjacent copies', () => {
    const grid = emptyGrid();
    // Opposite corners of the single street: not adjacent, but the same type,
    // so they still compete for the same customers.
    grid[0] = makeBiz('biz-bakery-0', { baseIncome: 12 });
    grid[GRID_SIZE - 1] = makeBiz('biz-bakery-1', { baseIncome: 12 });

    expect(computeBusinessIncome(grid, 0)).toBe(8); // 12 × 2/3
    expect(computeBusinessIncome(grid, GRID_SIZE - 1)).toBe(8);
  });

  it('reduces computeBusinessIncome to 1/2 for three copies', () => {
    const grid = emptyGrid();
    for (const index of [0, 2, GRID_SIZE - 1]) {
      grid[index] = makeBiz(`biz-bakery-${index}`, { baseIncome: 12 });
    }

    for (const index of [0, 2, GRID_SIZE - 1]) {
      expect(computeBusinessIncome(grid, index)).toBe(6); // 12 × 1/2
    }
  });

  it('reduces computeBusinessIncome to 1/3 for four or more copies', () => {
    // A 5×2 street holds at most three mutually non-adjacent kings, so four
    // copies must touch; the 60% adjacency penalty (30 → 18) and the 1/3
    // duplicate factor then compose multiplicatively: 18 × 1/3 = 6.
    const four = emptyGrid();
    for (const index of [0, 1, 2, 3]) {
      four[index] = makeBiz(`biz-bakery-${index}`, { baseIncome: 30 });
    }
    for (const index of [0, 1, 2, 3]) {
      expect(computeBusinessIncome(four, index)).toBe(6);
    }

    const five = emptyGrid();
    for (const index of [0, 1, 2, 3, 5]) {
      five[index] = makeBiz(`biz-bakery-${index}`, { baseIncome: 30 });
    }
    expect(computeBusinessIncome(five, 0)).toBe(6);
    expect(computeBusinessIncome(five, 5)).toBe(6);
  });

  it('applies the factor to computeIncome per slot and to the total', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz('biz-bakery-0', { baseIncome: 12 });
    grid[GRID_SIZE - 1] = makeBiz('biz-bakery-1', { baseIncome: 12 });

    const result = computeIncome(grid);

    expect(result.total).toBe(16); // 8 + 8
    expect(result.breakdown).toHaveLength(2);
    for (const slot of result.breakdown) {
      expect(slot.baseIncome).toBe(8);
      expect(slot.synergyBonus).toBe(0);
      expect(slot.total).toBe(8);
    }
  });

  it('splits the reduced total between base and synergy without breaking the phase sum', () => {
    const grid = emptyGrid();
    // Two bakeries (duplicate factor 2/3) plus an adjacent diner that grants
    // slot 0 synergy. Slot 0 is not adjacent to another bakery, so its usual
    // income is base 12 + synergy 6 = 18, reduced to 12; the reduced base is
    // round(12 × 2/3) = 8 and the synergy takes the remaining 4.
    grid[0] = makeBiz('biz-bakery-0', { baseIncome: 12 });
    grid[GRID_SIZE - 1] = makeBiz('biz-bakery-1', { baseIncome: 12 });
    grid[1] = makeBiz('biz-diner-0', { baseIncome: 12 });

    const result = computeIncome(grid);
    const slot0 = result.breakdown.find((b) => b.slotIndex === 0)!;
    const diner = result.breakdown.find((b) => b.slotIndex === 1)!;

    expect(slot0.baseIncome).toBe(8);
    expect(slot0.synergyBonus).toBe(4);
    expect(slot0.total).toBe(12);
    expect(diner.baseIncome).toBe(12); // unique type: factor 1
    expect(diner.synergyBonus).toBe(6);
    expect(diner.total).toBe(18);

    // Phase-sum invariant: base + synergy equals the credited total per slot
    // and across the whole income phase.
    let phaseSum = 0;
    for (const slot of result.breakdown) {
      expect(slot.baseIncome + slot.synergyBonus).toBe(slot.total);
    }
    for (const slot of result.phaseBreakdown.perSlotBreakdown) {
      expect(slot.baseIncome + slot.synergyBonus).toBe(
        result.breakdown.find((b) => b.slotIndex === slot.slotIndex)!.total,
      );
      phaseSum += slot.baseIncome + slot.synergyBonus;
    }
    expect(phaseSum).toBe(result.total);
  });

  it('syncs the reduced income into card.currentIncome', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz('biz-bakery-0', { baseIncome: 12 });
    grid[GRID_SIZE - 1] = makeBiz('biz-bakery-1', { baseIncome: 12 });

    syncCardCurrentIncome(grid, 0);
    syncCardCurrentIncome(grid, GRID_SIZE - 1);

    expect((grid[0] as BusinessCard).currentIncome).toBe(8);
    expect((grid[GRID_SIZE - 1] as BusinessCard).currentIncome).toBe(8);
  });

  it('recalculateCard includes the factor in currentIncome but leaves reputation alone', () => {
    const state = setupMainStreetGame({ seed: 'duplicate-recalc' });
    const bakery = (id: string) =>
      makeBiz(id, { baseIncome: 12, reputationPerTurn: 0.5, reputationBonus: 0.25 });
    state.streetGrid[0] = bakery('biz-bakery-0');
    state.streetGrid[GRID_SIZE - 1] = bakery('biz-bakery-1');

    recalculateCard(state, 0);

    expect(state.streetGrid[0]!.currentIncome).toBe(8); // 12 × 2/3
    // Reputation is not reduced: 0.5 + 0.25, same-type synergy nullified.
    expect(state.streetGrid[0]!.currentReputationPerTurn).toBeCloseTo(0.75, 10);
  });

  it('leaves reputation unchanged while reducing coin income', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz('biz-bakery-0', { baseIncome: 12, reputationPerTurn: 0.5, reputationBonus: 0.25 });
    grid[GRID_SIZE - 1] = makeBiz('biz-bakery-1', { baseIncome: 12 });
    grid[1] = makeBiz('biz-diner-0', { baseIncome: 12, synergyRepBonus: 0.1 });

    // Coins are reduced (factor 2/3) ...
    expect(duplicateIncomeFactor(grid, 0)).toBe(DUPLICATE_FACTOR_TABLE[2]);
    // ... but reputation is untouched: own rep plus the diner's synergy rep.
    expect(computeSynergyRepBonus(grid, 0)).toBeCloseTo(0.1, 10);
    expect(computeSingleCardReputation(grid, 0)).toBeCloseTo(0.5 + 0.25 + 0.1, 10);
  });

  it('credits no income to a sold business while it still saturates its type', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz('biz-bakery-0', { baseIncome: 12 });
    grid[GRID_SIZE - 1] = makeBiz('biz-bakery-1', { baseIncome: 12 });
    const soldSlots = new Array<boolean>(GRID_SIZE).fill(false);
    soldSlots[GRID_SIZE - 1] = true;

    expect(computeBusinessIncome(grid, GRID_SIZE - 1, 1, soldSlots)).toBe(0);
    // The living bakery still competes with the sold one: 2 copies → 2/3.
    expect(computeBusinessIncome(grid, 0, 1, soldSlots)).toBe(8);

    const result = computeIncome(grid, 1, undefined, soldSlots);
    expect(result.breakdown).toHaveLength(1);
    expect(result.total).toBe(8);
  });

  it('excludes community-space cards from the count and the factor', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz('biz-bakery-0', { baseIncome: 12 });
    grid[GRID_SIZE - 1] = makeCommunitySpace('biz-bakery-1');

    expect(duplicateIncomeFactor(grid, 0)).toBe(1);
    expect(computeBusinessIncome(grid, 0)).toBe(12);
  });

  it('reflects the reduced income in the applyIncome breakdown and phase split', () => {
    const state = setupMainStreetGame({ seed: 'duplicate-apply' });
    state.streetGrid[0] = makeBiz('biz-bakery-0', { baseIncome: 12 });
    state.streetGrid[GRID_SIZE - 1] = makeBiz('biz-bakery-1', { baseIncome: 12 });
    recalculateCard(state, 0);
    recalculateCard(state, GRID_SIZE - 1);

    const result = applyIncome(state);
    const slot0 = result.breakdown.find((b) => b.slotIndex === 0)!;
    const phase0 = result.phaseBreakdown.perSlotBreakdown.find((pd) => pd.slotIndex === 0)!;

    expect(slot0.total).toBe(8); // pre-multiplier income is factor-reduced
    expect(slot0.baseIncome).toBe(8);
    expect(slot0.synergyBonus).toBe(0);
    expect(phase0.baseIncome).toBe(8);
    expect(phase0.synergyBonus).toBe(0);
  });
});
