/**
 * Main Street: Effective income/reputation helper tests
 * (MS-0MW6H9A47001B1QT, child MS-0MW84013K0020ACZ)
 *
 * Pins the read-only `computeEffectiveCardValues()` contract: for ANY card
 * instance, wherever it is displayed, it returns the per-turn income and
 * reputation the engine actually credits — plus a component breakdown whose
 * additive parts sum exactly to the total.
 *
 * Covered scenarios:
 *   - plain card
 *   - card with a synergy neighbour
 *   - employed staff bonus (own business + adjacent business)
 *   - duplicate-saturated card
 *   - street instance vs hand/market instance of the same card
 *   - read-only (adjacency caches never mutated)
 *   - sold / empty slots return zero
 *
 * The helper's income total is asserted to equal `applyIncome()`'s per-slot
 * credited total, and its reputation total to equal the cached
 * `currentReputationPerTurn` for a no-staff card, so display can never
 * disagree with credit.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import {
  applyIncome,
  computeEffectiveCardValues,
  computeSingleCardReputation,
  recalculateCard,
  syncCardCurrentRepPerTurn,
  syncCardCurrentIncome,
} from '../../src/MainStreetAdjacencyScoring';
import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import { createStaffDeck, GRID_SIZE, type BusinessCard, type StaffCard } from '../../src/MainStreetCards';

// ── Fixtures ─────────────────────────────────────────────────

function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: overrides.id ?? 'biz-bakery-0',
    name: overrides.name ?? 'Bakery',
    cost: overrides.cost ?? 3,
    baseIncome: overrides.baseIncome ?? 12,
    synergyTypes: overrides.synergyTypes ?? ['Food'],
    maxLevel: overrides.maxLevel ?? 1,
    description: overrides.description ?? 'A test business',
    level: overrides.level ?? 0,
    incomeBonus: overrides.incomeBonus ?? 0,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    reputationBonus: overrides.reputationBonus ?? 0,
    reputationPerTurn: overrides.reputationPerTurn ?? 0,
    ongoingCost: overrides.ongoingCost ?? 0,
    ...overrides,
  };
}

/** A staff member (base template) with the given overrides. */
function makeStaff(overrides: Partial<StaffCard>): StaffCard {
  const base = createStaffDeck(1)[0];
  return { ...base, id: `${base.id}-tpl`, ...overrides };
}

function game(seed: string): MainStreetState {
  return setupMainStreetGame({ seed, difficulty: 'Easy' });
}

/** Recalculate a slot's cached income + reputation from the current grid. */
function recalc(state: MainStreetState, slot: number): void {
  recalculateCard(state, slot);
}

/** The engine's per-slot credited income for a slot (pre-multiplier total). */
function engineSlotTotal(state: MainStreetState, slot: number): number {
  const entry = applyIncome(state, { apply: false }).breakdown.find((s) => s.slotIndex === slot);
  // applyIncome excludes sold / empty slots, so a missing entry is 0.
  return entry ? entry.total : 0;
}

// ── Broken-down parts sum to the total ───────────────────────

describe('breakdown invariants', () => {
  it('income parts sum exactly to the total', () => {
    const state = game('parts-income');
    const biz = makeBiz({ id: 'biz-bakery-0', baseIncome: 12, incomeBonus: 3 });
    state.streetGrid[0] = biz;
    recalc(state, 0);

    const { income } = computeEffectiveCardValues(state, biz, 0);
    expect(income.base + income.upgradeBonus + income.synergy + income.staffFlat)
      .toBeCloseTo(income.total, 10);
  });

  it('reputation parts sum exactly to the total', () => {
    const state = game('parts-rep');
    const biz = makeBiz({ id: 'biz-clinic-0', baseIncome: 10, reputationPerTurn: 2, reputationBonus: 1 });
    state.streetGrid[0] = biz;
    recalc(state, 0);

    const { reputation } = computeEffectiveCardValues(state, biz, 0);
    expect(reputation.base + reputation.upgradeBonus + reputation.synergy + reputation.staffFlat)
      .toBeCloseTo(reputation.total, 10);
  });
});

// ── AC1: scenario coverage ───────────────────────────────────

describe('AC1 — plain card', () => {
  it('effective income equals the engine credit and the cached currentIncome', () => {
    const state = game('ac1-plain');
    const biz = makeBiz({ id: 'biz-bakery-0', baseIncome: 12 });
    state.streetGrid[0] = biz;
    recalc(state, 0);

    const { income } = computeEffectiveCardValues(state, biz, 0);
    expect(income.total).toBe(engineSlotTotal(state, 0));
    expect(income.total).toBe(biz.currentIncome);
    expect(income.duplicateFactor).toBe(1);
    expect(income.synergy).toBe(0);
  });

  it('effective reputation equals the engine per-slot reputation', () => {
    const state = game('ac1-plain-rep');
    const biz = makeBiz({ id: 'biz-clinic-0', baseIncome: 10, reputationPerTurn: 3 });
    state.streetGrid[0] = biz;
    recalc(state, 0);

    const { reputation } = computeEffectiveCardValues(state, biz, 0);
    expect(reputation.total).toBe(biz.currentReputationPerTurn);
    expect(reputation.synergy).toBe(0);
  });
});

describe('AC1 — card with a synergy neighbour', () => {
  it('includes the adjacency synergy and equals the engine credit', () => {
    const state = game('ac1-synergy');
    const main = makeBiz({ id: 'biz-bakery-0', baseIncome: 12, synergyTypes: ['Food'] });
    const neighbour = makeBiz({ id: 'biz-diner-0', baseIncome: 14, synergyTypes: ['Food'] });
    state.streetGrid[0] = main;
    state.streetGrid[1] = neighbour;
    recalc(state, 0);
    recalc(state, 1);

    const { income } = computeEffectiveCardValues(state, main, 0);
    expect(income.synergy).toBeGreaterThan(0);
    expect(income.total).toBe(engineSlotTotal(state, 0));
    expect(income.total).toBeGreaterThan(main.baseIncome);
  });
});

describe('AC1 — employed staff bonus (own business)', () => {
  it('folds a Chef skill (+20% Food) and a flat card bonus into the total', () => {
    const state = game('ac1-staff-own');
    const chef = makeStaff({
      specializationSkillIds: ['skill-chef'],
      incomeBonus: 5,
      incomeBonusTarget: 'own',
      employedAtSlot: 0,
    });
    const biz = makeBiz({
      id: 'biz-bakery-0',
      baseIncome: 10,
      synergyTypes: ['Food'],
      employedStaff: [chef],
    });
    state.streetGrid[0] = biz;
    state.staffCards = [chef];
    recalc(state, 0);

    const { income } = computeEffectiveCardValues(state, biz, 0);
    // base 10 + flat 5, then +20% → (10 + 0 synergy + 0 upgrade) × 1.2 + 5.
    expect(income.staffFlat).toBe(5);
    expect(income.staffPercent).toBeCloseTo(0.2, 10);
    expect(income.total).toBeCloseTo(10 * 1.2 + 5, 10);
    expect(income.total).toBeCloseTo(engineSlotTotal(state, 0), 10);
  });
});

describe('AC1 — employed staff bonus (adjacent business)', () => {
  it('includes an adjacent Barista-style flat bonus that targets the neighbour', () => {
    const state = game('ac1-staff-adjacent');
    const barista = makeStaff({
      specializationSkillIds: ['skill-town-gossip'],
      incomeBonus: 7,
      incomeBonusTarget: 'adjacent',
      incomeBonusTypes: ['Food'],
      employedAtSlot: 1,
    });
    const main = makeBiz({ id: 'biz-bakery-0', baseIncome: 10, synergyTypes: ['Food'] });
    const neighbour = makeBiz({
      id: 'biz-diner-0',
      baseIncome: 10,
      synergyTypes: ['Food'],
      employedStaff: [barista],
    });
    state.streetGrid[0] = main;
    state.streetGrid[1] = neighbour;
    state.staffCards = [barista];
    recalc(state, 0);
    recalc(state, 1);

    const { income } = computeEffectiveCardValues(state, main, 0);
    expect(income.staffFlat).toBe(7);
    expect(income.total).toBeCloseTo(engineSlotTotal(state, 0), 10);
  });
});

describe('AC1 — duplicate-saturated card', () => {
  it('applies the duplicate factor and equals the engine credit', () => {
    const state = game('ac1-duplicate');
    // Three copies of the same base type on the street → factor 1/2.
    for (let i = 0; i < 3; i++) {
      state.streetGrid[i] = makeBiz({ id: `biz-bakery-${i}`, baseIncome: 12, synergyTypes: ['Food'] });
    }
    recalc(state, 0);
    recalc(state, 1);
    recalc(state, 2);

    const card0 = state.streetGrid[0]!;
    const { income } = computeEffectiveCardValues(state, card0, 0);
    expect(income.duplicateFactor).toBeCloseTo(1 / 2, 10);
    expect(income.total).toBeLessThan(card0.baseIncome);
    expect(income.total).toBe(engineSlotTotal(state, 0));
  });
});

// ── AC2: location coverage (street vs hand/market) ──────────

describe('AC2 — location coverage', () => {
  it('a placed instance resolves from its grid position', () => {
    const state = game('ac2-placed');
    const biz = makeBiz({ id: 'biz-bakery-0', baseIncome: 12, incomeBonus: 4 });
    state.streetGrid[0] = biz;
    recalc(state, 0);

    const { income } = computeEffectiveCardValues(state, biz, 0);
    expect(income.total).toBe(engineSlotTotal(state, 0));
    // base 12 + upgrade 4, no synergy / duplicates / staff.
    expect(income.duplicateFactor).toBe(1);
    expect(income.synergy).toBe(0);
    expect(income.staffFlat).toBe(0);
  });

  it('a hand/market instance has no position-dependent modifiers but keeps its upgrade bonus', () => {
    const state = game('ac2-unplaced');
    const biz = makeBiz({ id: 'biz-bakery-0', baseIncome: 10, incomeBonus: 3 });

    const { income } = computeEffectiveCardValues(state, biz, null);
    expect(income.synergy).toBe(0);
    expect(income.staffFlat).toBe(0);
    expect(income.staffPercent).toBe(0);
    expect(income.base + income.upgradeBonus).toBeCloseTo(income.total, 10);
    expect(income.total).toBe(biz.baseIncome + biz.incomeBonus);
  });

  it('the same card in hand vs on the street differ only by position-dependent modifiers', () => {
    const state = game('ac2-compare');
    const main = makeBiz({ id: 'biz-bakery-0', baseIncome: 10, incomeBonus: 2, synergyTypes: ['Food'] });
    const neighbour = makeBiz({ id: 'biz-diner-0', baseIncome: 14, synergyTypes: ['Food'] });
    state.streetGrid[0] = main;
    state.streetGrid[1] = neighbour;
    recalc(state, 0);
    recalc(state, 1);

    const placed = computeEffectiveCardValues(state, main, 0);
    const inHand = computeEffectiveCardValues(state, main, null);

    // The street instance earns synergy; the hand instance does not.
    expect(placed.income.synergy).toBeGreaterThan(0);
    expect(inHand.income.synergy).toBe(0);
    expect(placed.income.total).toBeGreaterThan(inHand.income.total);
  });

  it('does not double-count the instance when deriving a hand instance saturation factor', () => {
    const state = game('ac2-double-count');
    // Two bakery copies already on the street.
    state.streetGrid[0] = makeBiz({ id: 'biz-bakery-0', baseIncome: 12 });
    state.streetGrid[1] = makeBiz({ id: 'biz-bakery-1', baseIncome: 12 });
    recalc(state, 0);
    recalc(state, 1);

    const handCard = makeBiz({ id: 'biz-bakery-2', baseIncome: 12 });
    const { income } = computeEffectiveCardValues(state, handCard, null);
    // Two on the street + this instance once = 3 copies → 1/2, not 1/3.
    expect(income.duplicateFactor).toBeCloseTo(1 / 2, 10);
  });
});

// ── AC3: staff bonuses are read-only ────────────────────────

describe('AC3 — staff bonuses are read-only', () => {
  it('computing effective values never mutates currentIncome / currentReputationPerTurn', () => {
    const state = game('ac3-readonly');
    const chef = makeStaff({
      specializationSkillIds: ['skill-chef'],
      employedAtSlot: 0,
    });
    const biz = makeBiz({
      id: 'biz-bakery-0',
      baseIncome: 10,
      reputationPerTurn: 2,
      synergyTypes: ['Food'],
      employedStaff: [chef],
    });
    state.streetGrid[0] = biz;
    state.staffCards = [chef];
    recalc(state, 0);

    const incomeBefore = biz.currentIncome;
    const repBefore = biz.currentReputationPerTurn;

    computeEffectiveCardValues(state, biz, 0);
    computeEffectiveCardValues(state, biz, 0);

    expect(biz.currentIncome).toBe(incomeBefore);
    expect(biz.currentReputationPerTurn).toBe(repBefore);
  });
});

// ── AC5: sold and empty slots ───────────────────────────────

describe('AC5 — sold and empty slots return zero', () => {
  it('empty slot returns zero totals', () => {
    const state = game('ac5-empty');
    const empty = makeBiz({ id: 'biz-nowhere-0' });
    const { income, reputation } = computeEffectiveCardValues(state, empty, 0);
    expect(income.total).toBe(0);
    expect(income.duplicateFactor).toBe(1);
    expect(reputation.total).toBe(0);
  });

  it('sold slot returns zero totals', () => {
    const state = game('ac5-sold');
    const biz = makeBiz({ id: 'biz-bakery-0', baseIncome: 12 });
    state.streetGrid[0] = biz;
    state.soldSlots = state.streetGrid.map((_, i) => i === 0);
    // Cache a non-zero income first so we can prove the sold guard wins.
    syncCardCurrentIncome(state.streetGrid, 0, state.config.synergyBonusPerNeighbor, []);
    syncCardCurrentRepPerTurn(state.streetGrid, 0, []);

    const { income, reputation } = computeEffectiveCardValues(state, biz, 0);
    expect(income.total).toBe(0);
    expect(income.duplicateFactor).toBe(1);
    expect(reputation.total).toBe(0);
  });
});

// ── Equality with the engine across a mixed board ───────────

describe('effective totals equal the engine credits across a mixed board', () => {
  it('every occupied slot matches applyIncome and computeSingleCardReputation', () => {
    const state = game('engine-equality');
    const cards: BusinessCard[] = [
      makeBiz({ id: 'biz-bakery-0', baseIncome: 12, synergyTypes: ['Food'], reputationPerTurn: 1 }),
      makeBiz({ id: 'biz-diner-0', baseIncome: 14, synergyTypes: ['Food'], reputationBonus: 2 }),
      makeBiz({ id: 'biz-shop-0', baseIncome: 8, synergyTypes: ['Commerce'] }),
      makeBiz({ id: 'biz-bakery-1', baseIncome: 12, synergyTypes: ['Food'] }),
    ];
    cards.forEach((c, i) => {
      state.streetGrid[i] = c;
    });
    cards.forEach((_, i) => recalc(state, i));

    const gridDims = state.streetGridCols && state.streetGridRows
      ? { cols: state.streetGridCols, rows: state.streetGridRows }
      : undefined;

    cards.forEach((card, slot) => {
      const values = computeEffectiveCardValues(state, card, slot);
      expect(values.income.total).toBeCloseTo(engineSlotTotal(state, slot), 10);
      expect(values.reputation.total).toBeCloseTo(
        computeSingleCardReputation(state.streetGrid, slot, state.soldSlots ?? [], gridDims),
        10,
      );
    });
  });

  it('covers the whole grid (no stray slots above GRID_SIZE)', () => {
    expect(GRID_SIZE).toBe(10);
  });
});
