/**
 * Main Street: Card-display effective-values integration tests
 * (MS-0MW6H9A47001B1QT, child MS-0MW843CTF001WOCH)
 *
 * Proves the card FACE (`buildUpgradeOverlaySpec`) and every hover TOOLTIP
 * (`buildCardTooltipInfo` / the street inline lines) show the same effective
 * income and reputation the engine credits, for an instance in every location
 * (street slot, hand, market).
 *
 * The effective totals are asserted against `applyIncome()`'s per-slot
 * breakdown (income) and the card's cached `currentReputationPerTurn`
 * (reputation), so the displayed text can never disagree with credit.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import {
  applyIncome,
  computeEffectiveCardValues,
  recalculateCard,
} from '../../src/MainStreetAdjacencyScoring';
import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import { buildCardTooltipInfo } from '../../src/MainStreetFormatting';
import { buildUpgradeOverlaySpec } from '../../src/scenes/UpgradeOverlaySpec';
import { createStaffDeck, type BusinessCard, type CommunitySpaceCard, type StaffCard } from '../../src/MainStreetCards';

const WIDTH = 120;
const HEIGHT = 160;

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

function makeCommunitySpace(overrides: Partial<CommunitySpaceCard> = {}): CommunitySpaceCard {
  return {
    family: 'community-space',
    id: overrides.id ?? 'biz-park-0',
    name: overrides.name ?? 'Park',
    cost: overrides.cost ?? 3,
    baseIncome: overrides.baseIncome ?? 8,
    ongoingCost: overrides.ongoingCost ?? 0,
    synergyTypes: overrides.synergyTypes ?? ['Culture'],
    maxLevel: overrides.maxLevel ?? 1,
    description: overrides.description ?? 'A test community space',
    level: overrides.level ?? 0,
    incomeBonus: overrides.incomeBonus ?? 0,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    reputationBonus: overrides.reputationBonus ?? 0,
    reputationPerTurn: overrides.reputationPerTurn ?? 0,
    ...overrides,
  };
}

function makeStaff(overrides: Partial<StaffCard>): StaffCard {
  const base = createStaffDeck(1)[0];
  return { ...base, id: `${base.id}-tpl`, ...overrides };
}

function game(seed: string): MainStreetState {
  return setupMainStreetGame({ seed, difficulty: 'Easy' });
}

function engineSlotTotal(state: MainStreetState, slot: number): number {
  const entry = applyIncome(state, { apply: false }).breakdown.find((s) => s.slotIndex === slot);
  return entry ? entry.total : 0;
}

// ── Card face shows the effective total ─────────────────────

describe('card face (overlay) shows the effective totals', () => {
  it('cash line shows base + synergy, not base + upgrade', () => {
    const state = game('face-synergy');
    const main = makeBiz({ id: 'biz-bakery-0', baseIncome: 12, synergyTypes: ['Food'] });
    const neighbour = makeBiz({ id: 'biz-diner-0', baseIncome: 14, synergyTypes: ['Food'] });
    state.streetGrid[0] = main;
    state.streetGrid[1] = neighbour;
    recalculateCard(state, 0);
    recalculateCard(state, 1);

    const values = computeEffectiveCardValues(state, main, 0);
    const spec = buildUpgradeOverlaySpec(main, WIDTH, HEIGHT, values);

    // 12 base + 3 synergy = 15; the old base-only formula would show +12.
    expect(values.income.total).toBe(15);
    expect(spec.cashLine!.text).toBe('+15');
    expect(spec.cashLine!.text).not.toBe(`+${main.baseIncome}`);
    expect(values.income.total).toBe(engineSlotTotal(state, 0));
  });

  it('reputation line shows the effective total (base + upgrade + synergy)', () => {
    const state = game('face-rep');
    const biz = makeBiz({
      id: 'biz-clinic-0',
      baseIncome: 10,
      reputationPerTurn: 2,
      reputationBonus: 1,
    });
    state.streetGrid[0] = biz;
    recalculateCard(state, 0);

    const values = computeEffectiveCardValues(state, biz, 0);
    const spec = buildUpgradeOverlaySpec(biz, WIDTH, HEIGHT, values);
    expect(values.reputation.total).toBe(3);
    expect(spec.reputationText!.text).toBe('+3/turn');
  });

  it('cash line keeps the ongoing-cost segment alongside the effective income', () => {
    const state = game('face-cost');
    const biz = makeBiz({ id: 'biz-shop-0', baseIncome: 10, ongoingCost: 4 });
    state.streetGrid[0] = biz;
    recalculateCard(state, 0);

    const spec = buildUpgradeOverlaySpec(
      biz,
      WIDTH,
      HEIGHT,
      computeEffectiveCardValues(state, biz, 0),
    );
    expect(spec.cashLine!.text).toBe('+10 / -4');
  });

  it('includes staff bonuses in the card-face total', () => {
    const state = game('face-staff');
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
    recalculateCard(state, 0);

    const values = computeEffectiveCardValues(state, biz, 0);
    const spec = buildUpgradeOverlaySpec(biz, WIDTH, HEIGHT, values);
    // 10 × 1.2 (Chef) + 5 flat = 17.
    expect(values.income.total).toBeCloseTo(17, 10);
    expect(spec.cashLine!.text).toBe('+17');
    expect(values.income.total).toBeCloseTo(engineSlotTotal(state, 0), 10);
  });

  it('community-space card shows its effective total', () => {
    const state = game('face-cs');
    const park = makeCommunitySpace({ id: 'biz-park-0', baseIncome: 8 });
    state.streetGrid[0] = park;
    recalculateCard(state, 0);

    const values = computeEffectiveCardValues(state, park, 0);
    const spec = buildUpgradeOverlaySpec(park, WIDTH, HEIGHT, values);
    expect(spec.cashLine!.text).toBe('+8');
  });
});

// ── Tooltips show the effective total + breakdown ───────────

describe('tooltips show the effective total and breakdown', () => {
  it('placed business tooltip breaks the income into base + synergy', () => {
    const state = game('tip-synergy');
    const main = makeBiz({ id: 'biz-bakery-0', baseIncome: 12, synergyTypes: ['Food'] });
    const neighbour = makeBiz({ id: 'biz-diner-0', baseIncome: 14, synergyTypes: ['Food'] });
    state.streetGrid[0] = main;
    state.streetGrid[1] = neighbour;
    recalculateCard(state, 0);
    recalculateCard(state, 1);

    const tip = buildCardTooltipInfo(main, state.config, {}, { state, slotIndex: 0 });
    expect(tip).toContain('Income: +15/turn');
    expect(tip).toContain('base +12');
    expect(tip).toContain('synergy +3');
    // It must not emit the old base-only figure.
    expect(tip).not.toContain('Income: +12/turn');
  });

  it('tooltip includes the upgrade component when present', () => {
    const state = game('tip-upgrade');
    const biz = makeBiz({ id: 'biz-bakery-0', baseIncome: 12, incomeBonus: 3 });
    state.streetGrid[0] = biz;
    recalculateCard(state, 0);

    const tip = buildCardTooltipInfo(biz, state.config, {}, { state, slotIndex: 0 });
    expect(tip).toContain('Income: +15/turn');
    expect(tip).toContain('base +12');
    expect(tip).toContain('upgrade +3');
  });

  it('tooltip includes the duplicate factor when the type is saturated', () => {
    const state = game('tip-duplicate');
    for (let i = 0; i < 3; i++) {
      state.streetGrid[i] = makeBiz({ id: `biz-bakery-${i}`, baseIncome: 12, synergyTypes: ['Food'] });
    }
    recalculateCard(state, 0);
    recalculateCard(state, 1);
    recalculateCard(state, 2);

    const card0 = state.streetGrid[0]!;
    const values = computeEffectiveCardValues(state, card0, 0);
    const tip = buildCardTooltipInfo(card0, state.config, {}, { state, slotIndex: 0 });
    expect(values.income.duplicateFactor).toBeCloseTo(1 / 2, 10);
    expect(tip).toContain(`Income: +${values.income.total}/turn`);
    expect(tip).toContain('duplicate ×1/2');
  });

  it('tooltip shows the effective reputation total with breakdown', () => {
    const state = game('tip-rep');
    const biz = makeBiz({
      id: 'biz-clinic-0',
      baseIncome: 10,
      reputationPerTurn: 2,
      reputationBonus: 1,
    });
    state.streetGrid[0] = biz;
    recalculateCard(state, 0);

    const tip = buildCardTooltipInfo(biz, state.config, {}, { state, slotIndex: 0 });
    expect(tip).toContain('Reputation: +3/turn');
    expect(tip).toContain('base +2');
    expect(tip).toContain('upgrade +1');
  });
});

// ── Every location: street, hand, market ────────────────────

describe('no location shows base-only figures', () => {
  it('a hand instance shows its modified (duplicate-adjusted) value, not base + upgrade', () => {
    const state = game('loc-hand');
    // Two bakery copies already on the street → a third (the hand card) is 1/2.
    state.streetGrid[0] = makeBiz({ id: 'biz-bakery-0', baseIncome: 12 });
    state.streetGrid[1] = makeBiz({ id: 'biz-bakery-1', baseIncome: 12 });
    recalculateCard(state, 0);
    recalculateCard(state, 1);

    const handCard = makeBiz({ id: 'biz-bakery-2', baseIncome: 12, incomeBonus: 3 });
    const values = computeEffectiveCardValues(state, handCard, null);
    // (12 + 3) × 1/2 = 8, not the base-only 15.
    expect(values.income.duplicateFactor).toBeCloseTo(1 / 2, 10);
    expect(values.income.total).toBe(8);

    const tip = buildCardTooltipInfo(handCard, state.config, {}, { state });
    expect(tip).toContain('Income: +8/turn');
    expect(tip).not.toContain('Income: +15/turn');
    expect(tip).toContain('duplicate ×1/2');

    const spec = buildUpgradeOverlaySpec(handCard, WIDTH, HEIGHT, values);
    expect(spec.cashLine!.text).toBe('+8');
  });

  it('a market instance shows the same modified value as the hand instance', () => {
    const state = game('loc-market');
    state.streetGrid[0] = makeBiz({ id: 'biz-bakery-0', baseIncome: 12 });
    state.streetGrid[1] = makeBiz({ id: 'biz-bakery-1', baseIncome: 12 });
    recalculateCard(state, 0);
    recalculateCard(state, 1);

    const marketCard = makeBiz({ id: 'biz-bakery-2', baseIncome: 12, incomeBonus: 3 });
    const values = computeEffectiveCardValues(state, marketCard, null);
    expect(values.income.total).toBe(8);

    const tip = buildCardTooltipInfo(marketCard, state.config, { includeEventDetail: true }, { state });
    expect(tip).toContain('Income: +8/turn');
    expect(tip).not.toContain('Income: +15/turn');
  });

  it('the same card on the street and in hand both show effective, not base-only, values', () => {
    const state = game('loc-both');
    const biz = makeBiz({ id: 'biz-bakery-0', baseIncome: 10, incomeBonus: 2, synergyTypes: ['Food'] });
    const neighbour = makeBiz({ id: 'biz-diner-0', baseIncome: 14, synergyTypes: ['Food'] });
    state.streetGrid[0] = biz;
    state.streetGrid[1] = neighbour;
    recalculateCard(state, 0);
    recalculateCard(state, 1);

    const placed = computeEffectiveCardValues(state, biz, 0);
    const inHand = computeEffectiveCardValues(state, biz, null);

    const streetSpec = buildUpgradeOverlaySpec(biz, WIDTH, HEIGHT, placed);
    const handSpec = buildUpgradeOverlaySpec(biz, WIDTH, HEIGHT, inHand);

    // Base-only would be +12 in both locations; effective values differ.
    expect(streetSpec.cashLine!.text).not.toBe('+12');
    expect(handSpec.cashLine!.text).not.toBe('+12');
    expect(placed.income.total).toBe(engineSlotTotal(state, 0));
    expect(handSpec.cashLine!.text).toBe(`+${inHand.income.total}`);
  });
});

// ── Read-only + end-to-end equality ─────────────────────────

describe('display is read-only and matches the engine', () => {
  it('rendering the overlay and tooltip never mutates the adjacency caches', () => {
    const state = game('ro');
    const biz = makeBiz({ id: 'biz-bakery-0', baseIncome: 10, reputationPerTurn: 2 });
    state.streetGrid[0] = biz;
    recalculateCard(state, 0);
    const incomeBefore = biz.currentIncome;
    const repBefore = biz.currentReputationPerTurn;

    const values = computeEffectiveCardValues(state, biz, 0);
    buildUpgradeOverlaySpec(biz, WIDTH, HEIGHT, values);
    buildCardTooltipInfo(biz, state.config, {}, { state, slotIndex: 0 });

    expect(biz.currentIncome).toBe(incomeBefore);
    expect(biz.currentReputationPerTurn).toBe(repBefore);
  });

  it('card-face income equals the engine per-slot credit across a mixed board', () => {
    const state = game('e2e');
    const cards = [
      makeBiz({ id: 'biz-bakery-0', baseIncome: 12, synergyTypes: ['Food'] }),
      makeBiz({ id: 'biz-diner-0', baseIncome: 14, synergyTypes: ['Food'] }),
      makeBiz({ id: 'biz-shop-0', baseIncome: 8, synergyTypes: ['Commerce'], incomeBonus: 3 }),
      makeBiz({ id: 'biz-bakery-1', baseIncome: 12, synergyTypes: ['Food'] }),
    ];
    cards.forEach((c, i) => {
      state.streetGrid[i] = c;
    });
    cards.forEach((_, i) => recalculateCard(state, i));

    cards.forEach((card, slot) => {
      const values = computeEffectiveCardValues(state, card, slot);
      const spec = buildUpgradeOverlaySpec(card, WIDTH, HEIGHT, values);
      const cash = spec.cashLine!.text;
      // cash line is "+{income}" (no ongoing cost on these fixtures).
      expect(cash).toBe(`+${values.income.total}`);
      expect(values.income.total).toBeCloseTo(engineSlotTotal(state, slot), 10);
    });
  });
});
