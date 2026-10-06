/**
 * Main Street: Financial Advisor per-business upgrade discount
 * (CG-0MTKMGL66004I0PC).
 *
 * The Financial Advisor's advertised "reduces this business upgrade cost by
 * 100" ability is a per-business cost reduction: it applies only to upgrades
 * bought for the business where the advisor is employed, through every
 * acquisition path, and never leaks to a business that employs no advisor.
 *
 * Covered here:
 *   - `computeUpgradeCostDiscount` aggregation / scoping / floor semantics.
 *   - Market purchase (`canPurchaseUpgrade` / `purchaseUpgrade`).
 *   - Hand play (`playUpgradeFromHand`).
 *   - Drag-drop buy-and-place (`canBuyAndPlaceUpgrade` / `buyAndPlaceUpgrade`)
 *     with the documented discount-then-premium ordering.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import { computeUpgradeCostDiscount } from '../../src/MainStreetStaffBuffs';
import {
  canPurchaseUpgrade,
  purchaseUpgrade,
  playUpgradeFromHand,
  canBuyAndPlaceUpgrade,
  buyAndPlaceUpgrade,
} from '../../src/MainStreetMarket';
import type { BusinessCard, UpgradeCard, StaffCard } from '../../src/MainStreetCards';

// ── Fixtures ────────────────────────────────────────────────

const LISTED_COST = 400;
const ADVISOR_DISCOUNT = 100;

function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: 'biz-bakery-test',
    name: 'Bakery',
    cost: 300,
    baseIncome: 230,
    synergyTypes: ['Food'],
    upgradePath: 'Bakery',
    maxLevel: 2,
    description: 'Test bakery.',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    appliedUpgrades: [],
    ...overrides,
  };
}

function makeUpg(overrides: Partial<UpgradeCard> = {}): UpgradeCard {
  return {
    family: 'upgrade',
    id: 'upg-patisserie-test',
    name: 'Upgrade to Patisserie',
    targetBusiness: 'Bakery',
    cost: LISTED_COST,
    incomeBonus: 100,
    synergyRangeBonus: 1,
    requiredLevel: 0,
    description: 'Test upgrade.',
    ...overrides,
  };
}

function makeAdvisor(overrides: Partial<StaffCard> = {}): StaffCard {
  return {
    family: 'staff',
    id: 'staff-financial-test',
    name: 'Financial Advisor',
    cost: 1000,
    ongoingCost: 150,
    handSlotsAdded: 0,
    description: 'Reduces this business upgrade cost by 100.',
    upgradeCostDiscount: ADVISOR_DISCOUNT,
    ...overrides,
  };
}

/** Creates a state with an injected upgrade in the market and no pre-existing upgrades. */
function stateWithUpgrade(seed: string, upgrade: UpgradeCard = makeUpg()): MainStreetState {
  const state = setupMainStreetGame({ seed });
  state.market.cards = state.market.cards.filter(c => c.family !== 'upgrade');
  state.market.cards.push(upgrade);
  return state;
}

/** Places a Bakery at `slot` and returns it. */
function placeBakery(state: MainStreetState, slot: number): BusinessCard {
  const biz = makeBiz();
  state.streetGrid[slot] = biz;
  return biz;
}

/** Employs a staff member at the business occupying `slot`. */
function employAt(state: MainStreetState, slot: number, staff: StaffCard): void {
  const biz = state.streetGrid[slot]!;
  biz.employedStaff = [...(biz.employedStaff ?? []), staff];
  state.staffCards.push(staff);
}

// ── computeUpgradeCostDiscount ───────────────────────────────

describe('computeUpgradeCostDiscount', () => {
  it('is 0 for a business employing no staff', () => {
    const state = setupMainStreetGame({ seed: 'fa-simple' });
    placeBakery(state, 0);
    expect(computeUpgradeCostDiscount(state, 0)).toBe(0);
  });

  it('sums the upgradeCostDiscount of staff employed at the business', () => {
    const state = setupMainStreetGame({ seed: 'fa-scope' });
    placeBakery(state, 0);
    placeBakery(state, 1);
    employAt(state, 0, makeAdvisor());
    expect(computeUpgradeCostDiscount(state, 0)).toBe(ADVISOR_DISCOUNT);
    // Per-business scoping: the discount never leaks to another slot.
    expect(computeUpgradeCostDiscount(state, 1)).toBe(0);
  });

  it('stacks additively across multiple staff at the same business', () => {
    const state = setupMainStreetGame({ seed: 'fa-stack' });
    placeBakery(state, 0);
    employAt(state, 0, makeAdvisor());
    employAt(state, 0, makeAdvisor({ id: 'staff-financial-test-2' }));
    expect(computeUpgradeCostDiscount(state, 0)).toBe(ADVISOR_DISCOUNT * 2);
  });

  it('reads legacy `employedAtSlot` links when `employedStaff` is absent', () => {
    const state = setupMainStreetGame({ seed: 'fa-legacy' });
    placeBakery(state, 0);
    state.staffCards.push(makeAdvisor({ employedAtSlot: 0 }));
    expect(computeUpgradeCostDiscount(state, 0)).toBe(ADVISOR_DISCOUNT);
  });

  it('floors a negative aggregate at 0', () => {
    const state = setupMainStreetGame({ seed: 'fa-floor' });
    placeBakery(state, 0);
    employAt(state, 0, makeAdvisor({ upgradeCostDiscount: -50 }));
    expect(computeUpgradeCostDiscount(state, 0)).toBe(0);
  });
});

// ── Market purchase ──────────────────────────────────────────

describe('market upgrade purchase applies the per-business discount', () => {
  it('makes an upgrade affordable only because of the advisor', () => {
    const state = stateWithUpgrade('fa-afford');
    placeBakery(state, 0);
    employAt(state, 0, makeAdvisor());
    const upg = state.market.cards.find(c => c.family === 'upgrade') as UpgradeCard;

    // 400 = listed cost, 300 = discounted cost.
    state.resourceBank.coins = LISTED_COST - ADVISOR_DISCOUNT;

    expect(canPurchaseUpgrade(state, upg.id, 0).legal).toBe(true);
  });

  it('charges the listed cost at a business with no advisor', () => {
    const state = stateWithUpgrade('fa-full-price');
    placeBakery(state, 0); // employs advisor
    placeBakery(state, 1); // no advisor
    employAt(state, 0, makeAdvisor());
    const upg = state.market.cards.find(c => c.family === 'upgrade') as UpgradeCard;
    state.resourceBank.coins = 1000;

    purchaseUpgrade(state, upg.id, 1);

    expect(state.resourceBank.coins).toBe(1000 - LISTED_COST);
  });

  it('charges the discounted cost when upgrading the employing business', () => {
    const state = stateWithUpgrade('fa-discounted-price');
    placeBakery(state, 0);
    employAt(state, 0, makeAdvisor());
    const upg = state.market.cards.find(c => c.family === 'upgrade') as UpgradeCard;
    state.resourceBank.coins = 1000;

    const result = purchaseUpgrade(state, upg.id, 0);

    expect(result.cost).toBe(LISTED_COST - ADVISOR_DISCOUNT);
    expect(state.resourceBank.coins).toBe(1000 - (LISTED_COST - ADVISOR_DISCOUNT));
  });

  it('floors the effective cost at 0 when the discount exceeds the listed cost', () => {
    const cheap = makeUpg({ id: 'upg-cheap-test', cost: 50 });
    const state = stateWithUpgrade('fa-floor-cost', cheap);
    placeBakery(state, 0);
    employAt(state, 0, makeAdvisor());
    state.resourceBank.coins = 0;

    expect(canPurchaseUpgrade(state, cheap.id, 0).legal).toBe(true);

    const result = purchaseUpgrade(state, cheap.id, 0);
    expect(result.cost).toBe(0);
    expect(state.resourceBank.coins).toBe(0);
  });
});

// ── Hand play ────────────────────────────────────────────────

describe('playing an upgrade from hand applies the per-business discount', () => {
  it('charges the discounted cost for the employing business', () => {
    const state = stateWithUpgrade('fa-hand');
    placeBakery(state, 0);
    employAt(state, 0, makeAdvisor());
    const upg = state.market.cards.find(c => c.family === 'upgrade') as UpgradeCard;
    // Move the upgrade to hand for the play-from-hand path.
    state.market.cards = state.market.cards.filter(c => c.id !== upg.id);
    state.hand = [upg];
    state.phase = 'MarketPhase';
    state.resourceBank.coins = LISTED_COST - ADVISOR_DISCOUNT;

    const result = playUpgradeFromHand(state, 0, 0);

    expect(result.cost).toBe(LISTED_COST - ADVISOR_DISCOUNT);
    expect(state.resourceBank.coins).toBe(0);
    expect(state.streetGrid[0]!.level).toBe(1);
  });
});

// ── Drag-drop buy-and-place (discount-then-premium) ──────────

describe('drag-drop buy-and-place applies the discount before the +50% premium', () => {
  const discountedBase = LISTED_COST - ADVISOR_DISCOUNT; // 300
  const expectedDragPrice = Math.ceil(discountedBase * 1.5 * 2) / 2; // 450
  const undiscountedDragPrice = Math.ceil(LISTED_COST * 1.5 * 2) / 2; // 600

  it('prices the drag path from the discounted base (not the listed base)', () => {
    const state = stateWithUpgrade('fa-drag');
    placeBakery(state, 0);
    employAt(state, 0, makeAdvisor());
    const upg = state.market.cards.find(c => c.family === 'upgrade') as UpgradeCard;

    state.resourceBank.coins = expectedDragPrice - 1;
    expect(canBuyAndPlaceUpgrade(state, upg.id, 0).legal).toBe(false);

    state.resourceBank.coins = expectedDragPrice;
    expect(canBuyAndPlaceUpgrade(state, upg.id, 0).legal).toBe(true);

    const result = buyAndPlaceUpgrade(state, upg.id, 0);
    expect(result.cost).toBe(expectedDragPrice);
    // Sanity: the premium is applied AFTER the discount, so the price is not
    // the undiscounted premium minus a flat 100.
    expect(result.cost).not.toBe(undiscountedDragPrice - ADVISOR_DISCOUNT);
    expect(state.resourceBank.coins).toBe(0);
  });

  it('click and drag use the same discounted base (parity)', () => {
    const state = stateWithUpgrade('fa-parity');
    placeBakery(state, 0);
    employAt(state, 0, makeAdvisor());
    const upg = state.market.cards.find(c => c.family === 'upgrade') as UpgradeCard;
    state.resourceBank.coins = 1000;

    const clicked = purchaseUpgrade(state, upg.id, 0);

    // A fresh upgrade at a fresh bakery for the drag comparison.
    const state2 = stateWithUpgrade('fa-parity-drag');
    placeBakery(state2, 0);
    employAt(state2, 0, makeAdvisor());
    const upg2 = state2.market.cards.find(c => c.family === 'upgrade') as UpgradeCard;
    state2.resourceBank.coins = 1000;
    const dragged = buyAndPlaceUpgrade(state2, upg2.id, 0);

    // Both paths price from the same discounted base; drag adds the +50%
    // premium on that base (CG-0MT3IYSRL001VVUP).
    expect(clicked.cost).toBe(discountedBase);
    expect(dragged.cost).toBe(Math.ceil(clicked.cost * 1.5 * 2) / 2);
  });
});
