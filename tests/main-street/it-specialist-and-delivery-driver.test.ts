/**
 * Main Street: Delivery Driver and IT Specialist under the two-type staff
 * model (MS-0MW3JXF6U00753LB, superseding CG-0MUMCVH3N007KT1M's street-wide
 * wiring).
 *
 * GDD D.4.3 scopes both cards to the business they are employed at:
 *  - the **Delivery Driver** discounts businesses placed 8-way ADJACENT to its
 *    own business (never a street-wide purchase discount), and
 *  - the **IT Specialist** grants **+1 synergy range to its own business**
 *    (its shipped street-wide refresh discount is gone).
 *
 * The discount is resolved against the destination slot through every
 * acquisition path (`purchaseBusiness`, `buyAndPlaceBusiness`,
 * `playBusinessFromHand`, drag-drop pre-gates), keeping the discount-first /
 * premium-then ordering rule (CG-0MTKMGL66004I0PC).
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import {
  computeAdjacentPurchaseDiscount,
  computeBusinessPurchasePremium,
  computeBusinessStaffBuffs,
  computeEffectiveBusinessPurchaseCost,
  computePurchaseCostDiscount,
} from '../../src/MainStreetStaffBuffs';
import {
  canPurchaseBusiness,
  purchaseBusiness,
  playBusinessFromHand,
  moveToHand,
} from '../../src/MainStreetMarket';
import { buyAndPlaceBusiness } from '../../src/MainStreetEngine';
import { refreshMarketCost, canRefreshMarket } from '../../src/MainStreetMarketRefill';
import { REFRESH_MARKET_COST, type BusinessCard, type StaffCard } from '../../src/MainStreetCards';
import { executeWeekStart } from '../../src/MainStreetEngine';
import {
  bestVisibleBankTarget,
  enumerateLegalActions,
} from '../../src/MainStreetAiStrategy';

// ── Fixtures ──────────────────────────────────────────────────

const DELIVERY_PURCHASE_DISCOUNT = 50;

/** A minimal business card fixture. */
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

/** A hired Delivery Driver employed at `employedAtSlot`. */
function employedDriver(employedAtSlot: number, overrides: Partial<StaffCard> = {}): StaffCard {
  return {
    family: 'staff',
    id: 'staff-delivery-itd',
    name: 'Delivery Driver',
    cost: 300,
    ongoingCost: 50,
    handSlotsAdded: 0,
    description: 'Handles the logistics. Reduces the purchase cost of any business placed adjacent to its own business by 50.',
    adjacencyPurchaseDiscount: DELIVERY_PURCHASE_DISCOUNT,
    allowedBusinessTypes: ['Food', 'Commerce'],
    employedAtSlot,
    ...overrides,
  };
}

/** A hired IT Specialist employed at `employedAtSlot`. */
function employedItSpecialist(employedAtSlot: number): StaffCard {
  return {
    family: 'staff',
    id: 'staff-it-itd',
    name: 'IT Specialist',
    cost: 800,
    ongoingCost: 100,
    handSlotsAdded: 0,
    description: 'Modernizes operations. Links its own business with businesses up to 2 slots away (+1 synergy range).',
    synergyRangeBonus: 1,
    allowedBusinessTypes: ['Commerce', 'Entertainment', 'Service'],
    employedAtSlot,
  };
}

/**
 * Places the driver's own business at slot 2 (the employer) and returns the
 * state. On the 5-wide grid, slots 1, 3, 6, 7, 8 are adjacent; slot 4 and 9
 * are not.
 */
function stateWithDriver(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  state.phase = 'MarketPhase';
  state.resourceBank.coins = 100000;
  const employer = makeBiz({ id: 'biz-driver-employer', name: 'Grocery', synergyTypes: ['Food'] });
  state.streetGrid[2] = employer;
  const driver = employedDriver(2);
  state.staffCards.push(driver);
  employer.employedStaff = [driver];
  return state;
}

const ADJACENT_SLOT = 1;
const DISTANT_SLOT = 9;

// ── Adjacency-scoped discount aggregation ─────────────────────

describe('Delivery Driver: adjacency-scoped purchase discount', () => {
  it('is 0 with no hired staff', () => {
    const state = setupMainStreetGame({ seed: 'pcd-no-staff' });
    expect(computePurchaseCostDiscount(state, ADJACENT_SLOT)).toBe(0);
    expect(computeAdjacentPurchaseDiscount(state, ADJACENT_SLOT)).toBe(0);
  });

  it('discounts only slots adjacent to the employing business', () => {
    const state = stateWithDriver('pcd-adjacent');

    expect(computeAdjacentPurchaseDiscount(state, ADJACENT_SLOT)).toBe(DELIVERY_PURCHASE_DISCOUNT);
    expect(computePurchaseCostDiscount(state, ADJACENT_SLOT)).toBe(DELIVERY_PURCHASE_DISCOUNT);
    // Its own slot and far slots are not discounted.
    expect(computePurchaseCostDiscount(state, 2)).toBe(0);
    expect(computePurchaseCostDiscount(state, DISTANT_SLOT)).toBe(0);
  });

  it('never leaks street-wide when no destination slot is known', () => {
    const state = stateWithDriver('pcd-no-slot');
    expect(computePurchaseCostDiscount(state)).toBe(0);
  });

  it('stacks additively across drivers employed around the target slot', () => {
    const state = stateWithDriver('pcd-stack');
    state.streetGrid[0] = makeBiz({ id: 'biz-second-employer', name: 'Diner', synergyTypes: ['Food'] });
    const second = employedDriver(0);
    state.staffCards.push(second);
    state.streetGrid[0]!.employedStaff = [second];

    // Slot 1 neighbours the employer at slot 2 AND the second at slot 0.
    expect(computeAdjacentPurchaseDiscount(state, ADJACENT_SLOT)).toBe(DELIVERY_PURCHASE_DISCOUNT * 2);
  });

  it('derives the effective cost and premium per placement slot (discount first)', () => {
    const state = stateWithDriver('pcd-derived');

    expect(computeEffectiveBusinessPurchaseCost(state, 300, ADJACENT_SLOT)).toBe(250);
    expect(computeBusinessPurchasePremium(state, 300, ADJACENT_SLOT)).toBe(Math.ceil(250 * 1.5 * 2) / 2);
    expect(computeBusinessPurchasePremium(state, 300, ADJACENT_SLOT)).not.toBe(Math.ceil(300 * 1.5 * 2) / 2);

    expect(computeEffectiveBusinessPurchaseCost(state, 300, DISTANT_SLOT)).toBe(300);
    expect(computeBusinessPurchasePremium(state, 300, DISTANT_SLOT)).toBe(Math.ceil(300 * 1.5 * 2) / 2);
  });

  it('floors the derived effective cost at 0', () => {
    const state = stateWithDriver('pcd-derived-floor');
    expect(computeEffectiveBusinessPurchaseCost(state, 40, ADJACENT_SLOT)).toBe(0);
    expect(computeBusinessPurchasePremium(state, 40, ADJACENT_SLOT)).toBe(0);
  });
});

// ── Click purchase (purchaseBusiness) ─────────────────────────

describe('Delivery Driver: click purchase', () => {
  it('charges the discounted cost for an adjacent slot', () => {
    const state = stateWithDriver('dd-click-adjacent');
    const biz = makeBiz({ id: 'biz-click-adjacent', cost: 300, synergyTypes: ['Commerce'] });
    state.market.cards = [biz];

    expect(canPurchaseBusiness(state, biz.id, ADJACENT_SLOT).legal).toBe(true);
    const result = purchaseBusiness(state, biz.id, ADJACENT_SLOT);
    expect(result.cost).toBe(300 - DELIVERY_PURCHASE_DISCOUNT);
  });

  it('charges the full listed cost for a distant slot', () => {
    const state = stateWithDriver('dd-click-distant');
    const biz = makeBiz({ id: 'biz-click-distant', cost: 300, synergyTypes: ['Commerce'] });
    state.market.cards = [biz];

    const result = purchaseBusiness(state, biz.id, DISTANT_SLOT);
    expect(result.cost).toBe(300);
  });

  it('floors the effective cost at 0 when discount ≥ listed cost', () => {
    const state = stateWithDriver('dd-click-floor');
    const biz = makeBiz({ id: 'biz-dd-floor', cost: DELIVERY_PURCHASE_DISCOUNT - 10, synergyTypes: ['Commerce'] });
    state.market.cards = [biz];
    state.resourceBank.coins = 0;

    expect(canPurchaseBusiness(state, biz.id, ADJACENT_SLOT).legal).toBe(true);
    const result = purchaseBusiness(state, biz.id, ADJACENT_SLOT);
    expect(result.cost).toBe(0);
    expect(state.resourceBank.coins).toBe(0);
  });
});

// ── Drag buy-and-place ────────────────────────────────────────

describe('Delivery Driver: drag buy-and-place', () => {
  it('discounts the base cost before the +50% premium', () => {
    const state = stateWithDriver('dd-drag-premium');
    const biz = makeBiz({ id: 'biz-drag', cost: 300, synergyTypes: ['Commerce'] });
    state.market.cards = [biz];
    state.resourceBank.coins = Math.ceil(250 * 1.5 * 2) / 2;

    const result = buyAndPlaceBusiness(state, biz.id, ADJACENT_SLOT);
    expect(result.cost).toBe(Math.ceil(250 * 1.5 * 2) / 2);
  });

  it('is illegal one coin short of the discounted premium', () => {
    const state = stateWithDriver('dd-drag-legal');
    const biz = makeBiz({ id: 'biz-drag-legal', cost: 300, synergyTypes: ['Commerce'] });
    state.market.cards = [biz];
    state.resourceBank.coins = Math.ceil(250 * 1.5 * 2) / 2 - 1;

    expect(() => buyAndPlaceBusiness(state, biz.id, ADJACENT_SLOT)).toThrow(/coins/i);
  });

  it('discounts the GM listed-cost priceOverride', () => {
    const state = stateWithDriver('dd-drag-gm');
    const biz = makeBiz({ id: 'biz-drag-gm', cost: 300, synergyTypes: ['Commerce'] });
    state.market.cards = [biz];
    state.resourceBank.coins = 250;

    const result = buyAndPlaceBusiness(state, biz.id, ADJACENT_SLOT, 300);
    expect(result.cost).toBe(250);
    expect(state.resourceBank.coins).toBe(0);
  });

  it('charges the undiscounted premium for a distant placement', () => {
    const state = stateWithDriver('dd-drag-distant');
    const biz = makeBiz({ id: 'biz-drag-distant', cost: 300, synergyTypes: ['Commerce'] });
    state.market.cards = [biz];

    const result = buyAndPlaceBusiness(state, biz.id, DISTANT_SLOT);
    expect(result.cost).toBe(Math.ceil(300 * 1.5 * 2) / 2);
  });
});

// ── Play from hand ───────────────────────────────────────────

describe('Delivery Driver: play business from hand', () => {
  it('charges the discounted base cost for an adjacent slot', () => {
    const state = stateWithDriver('dd-hand-adjacent');
    const biz = makeBiz({ id: 'biz-hand-adjacent', cost: 300, synergyTypes: ['Commerce'] });
    state.market.cards = [biz];
    moveToHand(state, biz.id);
    const handIndex = state.hand.findIndex(h => h.id === biz.id);
    state.resourceBank.coins = 250;

    const result = playBusinessFromHand(state, handIndex, ADJACENT_SLOT);
    expect(result.cost).toBe(250);
  });

  it('charges the full listed cost for a distant slot', () => {
    const state = stateWithDriver('dd-hand-distant');
    const biz = makeBiz({ id: 'biz-hand-distant', cost: 300, synergyTypes: ['Commerce'] });
    state.market.cards = [biz];
    moveToHand(state, biz.id);
    const handIndex = state.hand.findIndex(h => h.id === biz.id);
    state.resourceBank.coins = 300;

    const result = playBusinessFromHand(state, handIndex, DISTANT_SLOT);
    expect(result.cost).toBe(300);
  });
});

// ── AI affordability parity (no assumed street-wide discount) ─

describe('AI affordability parity', () => {
  it('banks towards the listed cost when no placement slot is known', () => {
    const state = setupMainStreetGame({ seed: 'ai-pc-afford' });
    executeWeekStart(state);
    state.phase = 'MarketPhase';

    state.hand = [];
    state.market.cards = [];
    const biz = makeBiz({ id: 'biz-ai-parity-afford', cost: 300, baseIncome: 200 });
    state.market.cards.push(biz);
    state.staffCards.push(employedDriver(2));
    state.resourceBank.coins = 0;

    const bankTarget = bestVisibleBankTarget(state, state.resourceBank.coins, 60);

    expect(bankTarget).not.toBeNull();
    // The adjacency discount cannot be claimed without a destination slot.
    expect(bankTarget!.cost).toBe(300);
  });

  it('does not enumerate a play-from-hand action the placement cannot afford', () => {
    const state = setupMainStreetGame({ seed: 'ai-pc-enumerate' });
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.actionsRemaining = 1;
    state.market.cards = [];
    state.staffCards.push(employedDriver(2));

    const biz = makeBiz({ id: 'biz-ai-enum', cost: 300, baseIncome: 200 });
    state.hand = [biz];
    // Enough for a discounted adjacent placement only: the enumerated actions
    // must not claim affordability for a full-price slot.
    state.resourceBank.coins = 300 - DELIVERY_PURCHASE_DISCOUNT;

    const actions = enumerateLegalActions(state);
    expect(actions.some(a => a.type === 'play-business-from-hand')).toBe(false);
  });
});

// ── IT Specialist: no street-wide refresh discount ───────────

describe('IT Specialist: refresh discount removed, synergy range added', () => {
  it('does not change the market refresh cost', () => {
    const state = setupMainStreetGame({ seed: 'it-refresh' });
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = REFRESH_MARKET_COST * 10;

    const before = refreshMarketCost(state);
    state.staffCards.push(employedItSpecialist(2));

    expect(refreshMarketCost(state)).toBe(before);
    expect(canRefreshMarket(state).legal).toBe(true);
  });

  it('reports a +1 synergy range buff for its own business only', () => {
    const state = setupMainStreetGame({ seed: 'it-range-buff' });
    executeWeekStart(state);
    state.streetGrid[2] = makeBiz({ id: 'biz-it-employer', synergyTypes: ['Commerce'] });
    state.streetGrid[3] = makeBiz({ id: 'biz-it-neighbour', synergyTypes: ['Commerce'] });
    const it = employedItSpecialist(2);
    state.staffCards.push(it);
    state.streetGrid[2]!.employedStaff = [it];

    expect(computeBusinessStaffBuffs(state, 2).synergyRangeBonus).toBe(1);
    expect(computeBusinessStaffBuffs(state, 3).synergyRangeBonus).toBe(0);
  });
});
