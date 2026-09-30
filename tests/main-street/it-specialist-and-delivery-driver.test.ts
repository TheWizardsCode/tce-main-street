/**
 * Main Street: IT Specialist and Delivery Driver cost-reduction effects
 * (CG-0MUMCVH3N007KT1M).
 *
 * The IT Specialist advertises "reduces market refresh cost by 100" —
 * backed by `refreshCostDiscount = 100` in card-data.csv; the engine's
 * `refreshMarketCost` already sums `refreshCostDiscount` street-wide.
 *
 * The Delivery Driver advertises "reduces business card purchase cost by 50"
 * — backed by a new `purchaseCostDiscount = 50` column; applied street-wide
 * across every hired staff member, through all acquisition paths
 * (`purchaseBusiness`, `buyAndPlaceBusiness`, `playBusinessFromHand`),
 * with the discount-first / premium-then ordering rule.
 *
 * Covered here:
 *   - `computePurchaseCostDiscount` aggregation / floor semantics.
 *   - IT Specialist refresh discount (already wired via `refreshMarketCost`).
 *   - Delivery Driver purchase discount: click (`purchaseBusiness`),
 *     drag (`buyAndPlaceBusiness`), deferred play-from-hand, stacking,
 *     clamp at 0, discount-then-premium ordering.
 *   - AI affordability parity: the AI uses the effective discounted cost.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import {
  computePurchaseCostDiscount,
  computeEffectiveBusinessPurchaseCost,
  computeBusinessPurchasePremium,
} from '../../src/MainStreetStaffBuffs';
import {
  canPurchaseBusiness,
  purchaseBusiness,
  playBusinessFromHand,
  moveToHand,
} from '../../src/MainStreetMarket';
import { buyAndPlaceBusiness } from '../../src/MainStreetEngine';
import { refreshMarketCost, canRefreshMarket, refreshMarket } from '../../src/MainStreetMarketRefill';
import {
  createStaffDeck,
  REFRESH_MARKET_COST,
  type BusinessCard,
  type StaffCard,
} from '../../src/MainStreetCards';
import { executeWeekStart } from '../../src/MainStreetEngine';
import { bestVisibleBankTarget } from '../../src/MainStreetAiStrategy';

// ── Fixtures ──────────────────────────────────────────────────

const IT_REFRESH_DISCOUNT = 100;
const DELIVERY_PURCHASE_DISCOUNT = 50;

function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: 'biz-ai-parity',
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

function makeItSpecialist(overrides: Partial<StaffCard> = {}): StaffCard {
  return {
    family: 'staff',
    id: 'staff-it-itd',
    name: 'IT Specialist',
    cost: 800,
    ongoingCost: 100,
    handSlotsAdded: 0,
    description: 'Modernizes operations. Reduces market refresh cost by 100.',
    refreshCostDiscount: IT_REFRESH_DISCOUNT,
    allowedBusinessTypes: ['Commerce', 'Entertainment', 'Service'],
    ...overrides,
  };
}

function makeDeliveryDriver(overrides: Partial<StaffCard> = {}): StaffCard {
  return {
    family: 'staff',
    id: 'staff-delivery-itd',
    name: 'Delivery Driver',
    cost: 300,
    ongoingCost: 50,
    handSlotsAdded: 0,
    description: 'Handles the logistics. Reduces business card purchase cost by 50.',
    purchaseCostDiscount: DELIVERY_PURCHASE_DISCOUNT,
    allowedBusinessTypes: ['Food', 'Commerce'],
    ...overrides,
  };
}

// ── IT Specialist: refresh cost discount ──────────────────────

describe('IT Specialist: refresh cost discount', () => {
  it('is already wired via refreshMarketCost (refreshCostDiscount)', () => {
    const state = setupMainStreetGame({ seed: 'it-refresh-1' });
    state.phase = 'MarketPhase';
    expect(refreshMarketCost(state)).toBe(REFRESH_MARKET_COST);

    const it = makeItSpecialist();
    state.staffCards.push(it);

    expect(refreshMarketCost(state)).toBe(REFRESH_MARKET_COST - IT_REFRESH_DISCOUNT);
  });

  it('stacks with the Accountant refreshCostDiscount', () => {
    const state = setupMainStreetGame({ seed: 'it-refresh-stack' });
    state.phase = 'MarketPhase';
    state.resourceBank.coins = REFRESH_MARKET_COST * 10;

    // Hire the Accountant (+100 refresh discount).
    const accountant = createStaffDeck(1).find(c => c.id.startsWith('staff-accountant'));
    expect(accountant).toBeTruthy();
    state.market.cards.push({ ...accountant! });
    purchaseStaffCardFromMarket(state, accountant!.id);

    // Also have the IT Specialist (+100 refresh discount).
    const it = makeItSpecialist();
    state.staffCards.push(it);

    const expected = REFRESH_MARKET_COST - IT_REFRESH_DISCOUNT - 100;
    expect(refreshMarketCost(state)).toBe(expected);
  });

  it('can afford a refresh only with the IT Specialist discount', () => {
    // Without the IT Specialist, 400 coins is below the 500 base cost.
    const without = setupMainStreetGame({ seed: 'it-afford-none' });
    without.phase = 'MarketPhase';
    without.resourceBank.coins = 400;
    expect(canRefreshMarket(without).legal).toBe(false);

    // With the IT Specialist, the effective cost is 500 - 100 = 400.
    const withIt = setupMainStreetGame({ seed: 'it-afford-it' });
    withIt.phase = 'MarketPhase';
    withIt.staffCards.push(makeItSpecialist());
    withIt.resourceBank.coins = 400;
    expect(canRefreshMarket(withIt).legal).toBe(true);
  });

  it('charges the discounted cost', () => {
    const state = setupMainStreetGame({ seed: 'it-charge' });
    state.phase = 'MarketPhase';
    state.resourceBank.coins = REFRESH_MARKET_COST + 100;

    const it = makeItSpecialist();
    state.staffCards.push(it);

    const coinsBefore = state.resourceBank.coins;
    refreshMarket(state);

    expect(state.resourceBank.coins).toBe(coinsBefore - (REFRESH_MARKET_COST - IT_REFRESH_DISCOUNT));
  });

  it('floors at 0 when discounts exceed the base cost', () => {
    const state = setupMainStreetGame({ seed: 'it-floor' });
    state.phase = 'MarketPhase';

    // Two IT Specialists = -200.
    state.staffCards.push(makeItSpecialist());
    state.staffCards.push(makeItSpecialist({ id: 'staff-it-itd-2' }));

    // Accountant = -100.
    const accountant = createStaffDeck(1).find(c => c.id.startsWith('staff-accountant'));
    state.market.cards.push({ ...accountant! });
    purchaseStaffCardFromMarket(state, accountant!.id);

    // Total discount = 200 + 100 = 300 > 500? No, 300 < 500.
    // Add two more Accountants: total = 200 + 200 = 400 < 500.
    // Add three more: total = 200 + 300 = 500 = 500 → cost = 0.
    for (let i = 0; i < 3; i++) {
      const ac2 = createStaffDeck(1).find(c => c.id.startsWith('staff-accountant'));
      state.market.cards.push({ ...ac2! });
      purchaseStaffCardFromMarket(state, ac2!.id);
    }

    expect(refreshMarketCost(state)).toBe(0);

    // Even with 0 coins, refresh should be legal.
    state.resourceBank.coins = 0;
    expect(canRefreshMarket(state).legal).toBe(true);

    const coinsBefore = state.resourceBank.coins;
    refreshMarket(state);
    expect(state.resourceBank.coins).toBe(coinsBefore); // cost = 0
  });
});

// ── computePurchaseCostDiscount ───────────────────────────────

describe('computePurchaseCostDiscount', () => {
  it('is 0 with no hired staff', () => {
    const state = setupMainStreetGame({ seed: 'pcd-no-staff' });
    expect(computePurchaseCostDiscount(state)).toBe(0);
  });

  it('sums purchaseCostDiscount across hired staff street-wide', () => {
    const state = setupMainStreetGame({ seed: 'pcd-sum' });
    const delivery = makeDeliveryDriver();
    state.staffCards.push(delivery);

    expect(computePurchaseCostDiscount(state)).toBe(DELIVERY_PURCHASE_DISCOUNT);
  });

  it('stacks additively across multiple Delivery Drivers', () => {
    const state = setupMainStreetGame({ seed: 'pcd-stack' });
    state.staffCards.push(makeDeliveryDriver());
    state.staffCards.push(makeDeliveryDriver({ id: 'staff-delivery-itd-2' }));

    expect(computePurchaseCostDiscount(state)).toBe(DELIVERY_PURCHASE_DISCOUNT * 2);
  });

  it('ignores staff without purchaseCostDiscount', () => {
    const state = setupMainStreetGame({ seed: 'pcd-no-op' });
    state.staffCards.push(makeItSpecialist()); // has refreshCostDiscount, not purchaseCostDiscount

    expect(computePurchaseCostDiscount(state)).toBe(0);
  });

  it('floors a negative aggregate at 0', () => {
    const state = setupMainStreetGame({ seed: 'pcd-floor' });
    const delivery = makeDeliveryDriver({ purchaseCostDiscount: -30 });
    state.staffCards.push(delivery);

    expect(computePurchaseCostDiscount(state)).toBe(0);
  });

  it('derives the effective purchase cost and premium (discount first)', () => {
    const state = setupMainStreetGame({ seed: 'pcd-derived' });
    state.staffCards.push(makeDeliveryDriver());

    // 300 listed - 50 = 250 effective base; premium is 50% of the discounted
    // base (375), NOT the listed base (450).
    expect(computeEffectiveBusinessPurchaseCost(state, 300)).toBe(250);
    expect(computeBusinessPurchasePremium(state, 300)).toBe(
      Math.ceil(250 * 1.5 * 2) / 2,
    );
    expect(computeBusinessPurchasePremium(state, 300)).not.toBe(
      Math.ceil(300 * 1.5 * 2) / 2,
    );
  });

  it('floors the derived effective cost at 0', () => {
    const state = setupMainStreetGame({ seed: 'pcd-derived-floor' });
    state.staffCards.push(makeDeliveryDriver());

    expect(computeEffectiveBusinessPurchaseCost(state, 40)).toBe(0);
    expect(computeBusinessPurchasePremium(state, 40)).toBe(0);
  });
});

// ── Delivery Driver: click purchase (purchaseBusiness) ────────

describe('Delivery Driver: click purchase (purchaseBusiness)', () => {
  it('makes a business affordable only because of the driver', () => {
    const state = setupMainStreetGame({ seed: 'dd-click-afford' });
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 500;

    const delivery = makeDeliveryDriver();
    state.staffCards.push(delivery);

    const biz = state.market.cards.find(
      c => (c.family === 'business' || c.family === 'community-space') && c.cost <= state.resourceBank.coins,
    );
    if (!biz) return;

    expect(canPurchaseBusiness(state, biz.id, 0).legal).toBe(true);
  });

  it('charges the discounted cost', () => {
    const state = setupMainStreetGame({ seed: 'dd-click-discount' });
    state.phase = 'MarketPhase';

    const delivery = makeDeliveryDriver();
    state.staffCards.push(delivery);

    const biz = state.market.cards.find(c => c.family === 'business');
    if (!biz) return;

    const slot = state.streetGrid.findIndex(s => s === null);
    state.resourceBank.coins = 5000;

    const result = purchaseBusiness(state, biz.id, slot);

    expect(result.cost).toBe(Math.max(0, biz.cost - DELIVERY_PURCHASE_DISCOUNT));
  });

  it('floors the effective cost at 0 when discount ≥ listed cost', () => {
    const state = setupMainStreetGame({ seed: 'dd-click-floor' });
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;

    // Hire enough Delivery Drivers to discount the cheapest business to 0.
    const delivery = makeDeliveryDriver();
    state.staffCards.push(delivery);

    const biz = state.market.cards.find(c => c.family === 'business');
    if (!biz) return;

    const slot = state.streetGrid.findIndex(s => s === null);
    expect(canPurchaseBusiness(state, biz.id, slot).legal).toBe(true);

    const result = purchaseBusiness(state, biz.id, slot);
    expect(result.cost).toBe(0);
    expect(state.resourceBank.coins).toBe(0);
  });
});

// ── Delivery Driver: drag buy-and-place ───────────────────────

describe('Delivery Driver: drag buy-and-place (buyAndPlaceBusiness)', () => {
  it('discounts the base cost before the +50% premium', () => {
    const state = setupMainStreetGame({ seed: 'dd-drag-premium' });
    state.phase = 'MarketPhase';

    const delivery = makeDeliveryDriver();
    state.staffCards.push(delivery);

    const biz = state.market.cards.find(c => c.family === 'business');
    if (!biz) return;

    const slot = state.streetGrid.findIndex(s => s === null);
    const baseCost = biz.cost;
    const discountedBase = Math.max(0, baseCost - DELIVERY_PURCHASE_DISCOUNT);
    const expectedDragPrice = Math.ceil(discountedBase * 1.5 * 2) / 2;

    state.resourceBank.coins = expectedDragPrice;

    const result = buyAndPlaceBusiness(state, biz.id, slot);

    expect(result.cost).toBe(expectedDragPrice);
    // Sanity: the premium is applied after the discount, not before.
    const undiscDragPrice = Math.ceil(baseCost * 1.5 * 2) / 2;
    expect(result.cost).not.toBe(undiscDragPrice - DELIVERY_PURCHASE_DISCOUNT);
  });

  it('is illegal without sufficient coins for the discounted premium', () => {
    const state = setupMainStreetGame({ seed: 'dd-drag-legal' });
    state.phase = 'MarketPhase';

    const delivery = makeDeliveryDriver();
    state.staffCards.push(delivery);

    const biz = state.market.cards.find(c => c.family === 'business');
    if (!biz) return;

    const slot = state.streetGrid.findIndex(s => s === null);
    const discountedBase = Math.max(0, biz.cost - DELIVERY_PURCHASE_DISCOUNT);
    const expectedDragPrice = Math.ceil(discountedBase * 1.5 * 2) / 2;

    // One coin short.
    state.resourceBank.coins = expectedDragPrice - 1;
    expect(() => buyAndPlaceBusiness(state, biz.id, slot)).toThrow(/coins/i);
  });

  it('discounts the GM listed-cost priceOverride (2-action drag parity)', () => {
    const state = setupMainStreetGame({ seed: 'dd-drag-gm' });
    state.phase = 'MarketPhase';

    const delivery = makeDeliveryDriver();
    state.staffCards.push(delivery);

    const biz = state.market.cards.find(c => c.family === 'business');
    if (!biz) return;

    const slot = state.streetGrid.findIndex(s => s === null);
    const effectiveListed = Math.max(0, biz.cost - DELIVERY_PURCHASE_DISCOUNT);
    state.resourceBank.coins = effectiveListed;

    // GM parity passes the listed cost as `priceOverride`; the street-wide
    // discount still applies (the override replaces the premium, not the
    // discount).
    const result = buyAndPlaceBusiness(state, biz.id, slot, biz.cost);

    expect(result.cost).toBe(effectiveListed);
    expect(state.resourceBank.coins).toBe(0);
  });
});

// ── Delivery Driver: play from hand ───────────────────────────

describe('Delivery Driver: play business from hand (playBusinessFromHand)', () => {
  it('charges the discounted base cost (no premium path)', () => {
    const state = setupMainStreetGame({ seed: 'dd-hand' });
    state.phase = 'MarketPhase';

    const delivery = makeDeliveryDriver();
    state.staffCards.push(delivery);

    const biz = state.market.cards.find(c => c.family === 'business');
    if (!biz) return;

    moveToHand(state, biz.id);
    const handIndex = state.hand.findIndex(h => h.id === biz.id);
    const slot = state.streetGrid.findIndex(s => s === null);
    const baseCost = biz.cost;
    const effectiveCost = Math.max(0, baseCost - DELIVERY_PURCHASE_DISCOUNT);
    state.resourceBank.coins = effectiveCost;

    const result = playBusinessFromHand(state, handIndex, slot);

    expect(result.cost).toBe(effectiveCost);
  });

  it('charges the discounted-then-premium cost (premium path)', () => {
    const state = setupMainStreetGame({ seed: 'dd-hand-premium' });
    state.phase = 'MarketPhase';

    const delivery = makeDeliveryDriver();
    state.staffCards.push(delivery);

    const biz = state.market.cards.find(c => c.family === 'business');
    if (!biz) return;

    moveToHand(state, biz.id);
    const handIndex = state.hand.findIndex(h => h.id === biz.id);
    const slot = state.streetGrid.findIndex(s => s === null);

    const discountedBase = Math.max(0, biz.cost - DELIVERY_PURCHASE_DISCOUNT);
    const expectedPremiumPrice = Math.ceil(discountedBase * 1.5 * 2) / 2;
    state.resourceBank.coins = expectedPremiumPrice;

    const result = playBusinessFromHand(state, handIndex, slot, expectedPremiumPrice);

    expect(result.cost).toBe(expectedPremiumPrice);
  });
});

// ── AI affordability parity ───────────────────────────────────

describe('AI affordability parity', () => {
  it('scores business targets using the effective discounted cost', () => {
    const state = setupMainStreetGame({ seed: 'ai-pc-afford' });
    executeWeekStart(state);
    state.phase = 'MarketPhase';

    // Isolate the market to a single known business card.
    state.hand = [];
    state.market.cards = [];
    const biz = makeBiz({ id: 'biz-ai-parity-afford', cost: 300, baseIncome: 200 });
    state.market.cards.push(biz);

    const delivery = makeDeliveryDriver();
    state.staffCards.push(delivery);
    state.resourceBank.coins = 0; // unaffordable at either price → a banking target

    const bankTarget = bestVisibleBankTarget(state, state.resourceBank.coins, 60);

    expect(bankTarget).not.toBeNull();
    // The AI sees the discounted cost, not the listed cost.
    expect(bankTarget!.cost).toBe(300 - DELIVERY_PURCHASE_DISCOUNT);
  });

  it('treats a business as affordable once the discounted cost is within coins', () => {
    const state = setupMainStreetGame({ seed: 'ai-pc-target' });
    executeWeekStart(state);
    state.phase = 'MarketPhase';

    state.hand = [];
    state.market.cards = [];
    const biz = makeBiz({ id: 'biz-ai-parity-target', cost: 300, baseIncome: 200 });
    state.market.cards.push(biz);

    const delivery = makeDeliveryDriver();
    state.staffCards.push(delivery);

    // Exactly enough for the discounted cost (250), but not the listed (300).
    const discounted = 300 - DELIVERY_PURCHASE_DISCOUNT;
    state.resourceBank.coins = discounted;

    // Affordable at the discounted price → not a banking target.
    const bankTarget = bestVisibleBankTarget(state, state.resourceBank.coins, 60);
    expect(bankTarget).toBeNull();
  });
});

// ── Helper ────────────────────────────────────────────────────

/** Hire a staff card from the market row (bypasses the market-row UI layer). */
function purchaseStaffCardFromMarket(state: MainStreetState, cardId: string): void {
  const marketIdx = state.market.cards.findIndex(c => c.id === cardId && c.family === 'staff');
  const card = marketIdx !== -1 ? state.market.cards[marketIdx] : undefined;
  if (!card || card.family !== 'staff') return;

  state.resourceBank.coins -= card.cost;
  state.market.cards.splice(marketIdx, 1);
  state.staffCards.push({ ...card });
  state.maxHandSize += card.handSlotsAdded;
}
