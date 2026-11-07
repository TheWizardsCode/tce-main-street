/**
 * Main Street: two-type staff redesign deltas (MS-0MW3JXF6U00753LB).
 *
 * Implements the GDD Appendix D.4.3/D.4.4 "Redesign delta" columns so the
 * shipped cards match the two-type model
 * (`docs/game/the-build-gdd.md` §D.4.3, §D.4.4, §D.4.8):
 *
 *  - **Value changes** — Assistant +2 hand slots, Executive +2 actions/turn
 *    (no hand slot), Baker +25 coins/turn to its OWN business.
 *  - **Scope tightenings** — Chef, Marketing Consultant, PR Officer,
 *    Health & Safety Inspector to their own business; Security Guard and
 *    Maintenance Worker to their own business + 8-way neighbours; Delivery
 *    Driver to businesses placed adjacent to its own; IT Specialist from a
 *    street-wide refresh discount to +1 synergy range for its own business.
 *  - **Enforcement (D.4.8)** — staff type is assignment: management-company
 *    staff never carry `employedAtSlot`, so `placeStaffOnBusiness` rejects
 *    them, and business staff never set player-scope fields.
 *
 * Every assertion goes through the public card-data / buff / income /
 * incident / purchase APIs; no test restates the production logic.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import { executeWeekStart } from '../../src/MainStreetEngine';
import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import { applyIncome } from '../../src/MainStreetAdjacency';
import {
  getEventTemplates,
  getStaffCardTemplates,
  createStaffDeck,
  type BusinessCard,
  type EventCard,
  type StaffCard,
} from '../../src/MainStreetCards';
import { resolveEvent } from '../../src/MainStreetEngineEvents';
import { resolveIncident } from '../../src/MainStreetEngineTurnClosing';
import { canPlaceStaffOnBusiness, placeStaffOnBusiness } from '../../src/MainStreetEngine';
import { purchaseStaffCard } from '../../src/MainStreetMarket';
import {
  computeAdjacentPurchaseDiscount,
  computeBusinessIncidentMitigation,
  computeBusinessStaffBuffs,
  computeEffectiveBusinessPurchaseCost,
  computePurchaseCostDiscount,
} from '../../src/MainStreetStaffBuffs';

// ── Fixtures ────────────────────────────────────────────────

/** Places a business fixture at a slot (no cache sync needed: income reads it). */
function placeBusiness(
  state: MainStreetState,
  slot: number,
  name: string,
  synergy: string[],
  baseIncome = 2,
): BusinessCard {
  const biz: BusinessCard = {
    family: 'business',
    id: `biz-${name.toLowerCase().replace(/\s+/g, '-')}-${slot}`,
    name,
    cost: 300,
    baseIncome,
    synergyTypes: [...synergy] as BusinessCard['synergyTypes'],
    maxLevel: 0,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    description: 'Two-type redesign fixture.',
    ongoingCost: 0,
    employedStaff: [],
  };
  // Seat the income/reputation caches the income phase reads, so a fixture's
  // numbers are exactly its declared base values (no cache recomputation, no
  // synergy surprise from neighbouring fixture businesses).
  biz.currentIncome = baseIncome;
  biz.currentReputationPerTurn = 0;
  state.streetGrid[slot] = biz;
  return biz;
}

/** A shipped staff template instance (id keeps the shipped prefix). */
function staffTemplate(id: string): StaffCard {
  const card = createStaffDeck(1).find(c => c.id.startsWith(id));
  if (!card) throw new Error(`staff template ${id} not found`);
  return card;
}

/** Employs a shipped staff template at a slot (both employment sources). */
function employ(state: MainStreetState, slot: number, id: string): StaffCard {
  const member: StaffCard = { ...staffTemplate(id), id: `${id}-${slot}` };
  member.employedAtSlot = slot;
  state.staffCards.push(member);
  const biz = state.streetGrid[slot]!;
  if (!Array.isArray(biz.employedStaff)) biz.employedStaff = [];
  biz.employedStaff.push(member);
  return member;
}

/** Fresh game with week-start executed (deterministic action/hand budgets). */
function freshState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  return state;
}

/** Per-slot income totals from one income phase. */
function incomeBySlot(state: MainStreetState): Map<number, number> {
  const income = applyIncome(state);
  return new Map(income.breakdown.map(slot => [slot.slotIndex, slot.total]));
}

/** A shipped event template instance (by id). */
function eventTemplate(id: string): EventCard {
  const card = getEventTemplates().find(e => e.id === id);
  if (!card) throw new Error(`event template ${id} not found`);
  return { ...card };
}

const staffTemplateById = (id: string): StaffCard =>
  getStaffCardTemplates().find(c => c.id === id)!;

// ── AC1: card data & parsed templates ───────────────────────

describe('AC1: card-data values and parsed templates', () => {
  it('Assistant grants +2 hand slots; Executive grants +2 actions and no hand slot', () => {
    const assistant = staffTemplateById('staff-assistant');
    expect(assistant.handSlotsAdded).toBe(2);
    expect(assistant.actionsPerTurn ?? 0).toBe(0);

    const executive = staffTemplateById('staff-executive');
    expect(executive.handSlotsAdded).toBe(0);
    expect(executive.actionsPerTurn).toBe(2);
  });

  it('business staff never set a management-company-scope field (D.4.8 §4)', () => {
    const businessStaff = getStaffCardTemplates().filter(
      t => t.handSlotsAdded === 0 && (t.actionsPerTurn ?? 0) === 0,
    );
    expect(businessStaff).toHaveLength(17);
    for (const card of businessStaff) {
      expect(card.handSlotsAdded, `${card.id} hand slots`).toBe(0);
      expect(card.actionsPerTurn, `${card.id} actions`).toBeUndefined();
      expect(card.peekOncePerTurn, `${card.id} peek`).toBeUndefined();
      expect(card.refreshCostDiscount, `${card.id} refresh discount`).toBeUndefined();
      expect(card.taxAuditRate, `${card.id} tax rate`).toBeUndefined();
      expect(card.reputationPerTurn, `${card.id} street-wide reputation`).toBeUndefined();
    }
  });

  it('Baker adds +25 coins/turn to its own business', () => {
    const baker = staffTemplateById('staff-baker');
    expect(baker.incomeBonus).toBe(25);
    expect(baker.incomeBonusTarget ?? 'own').toBe('own');
  });

  it('Chef boosts its own business income by 20%', () => {
    expect(staffTemplateById('staff-chef').incomePercent).toBeCloseTo(0.2);
  });

  it('adjacency coin roles target the right neighbour types', () => {
    const barista = staffTemplateById('staff-barista');
    expect([barista.incomeBonus, barista.incomeBonusTarget, barista.incomeBonusTypes])
      .toEqual([20, 'adjacent', ['Food']]);

    const florist = staffTemplateById('staff-florist');
    expect([florist.incomeBonus, florist.incomeBonusTarget, florist.incomeBonusTypes])
      .toEqual([30, 'adjacent', ['Commerce', 'Culture']]);

    const planner = staffTemplateById('staff-event-planner');
    expect([planner.incomeBonus, planner.incomeBonusTarget, planner.incomeBonusTypes])
      .toEqual([100, 'adjacent', ['Entertainment']]);

    expect(staffTemplateById('staff-mechanic').incomeBonus).toBe(30);
  });

  it('PR Officer and Marketing Consultant scope reputation to their own business', () => {
    const pr = staffTemplateById('staff-pr');
    expect(pr.reputationPerTurn).toBeUndefined();
    expect([pr.reputationBonus, pr.reputationBonusTarget ?? 'own']).toEqual([15, 'own']);

    expect(staffTemplateById('staff-marketing').reputationPercent).toBeCloseTo(0.1);
    expect(staffTemplateById('staff-customer-rep').reputationBonusTarget).toBe('adjacent');
  });

  it('IT Specialist grants +1 synergy range instead of a street-wide refresh discount', () => {
    const it = staffTemplateById('staff-it');
    expect(it.refreshCostDiscount).toBeUndefined();
    expect(it.synergyRangeBonus).toBe(1);
    expect(it.description).toMatch(/its own business/i);
  });

  it('Delivery Driver discounts adjacent placements instead of every purchase', () => {
    const delivery = staffTemplateById('staff-delivery');
    expect(delivery.purchaseCostDiscount).toBeUndefined();
    expect(delivery.adjacencyPurchaseDiscount).toBe(50);
    expect(delivery.description).toMatch(/adjacent/i);
  });

  it('incident roles carry their scoped mitigation effect', () => {
    expect(staffTemplateById('staff-security').incidentEffect)
      .toEqual({ kind: 'coin', amount: 0.1, target: 'cluster' });
    expect(staffTemplateById('staff-maintenance').incidentEffect)
      .toEqual({ kind: 'reputation', amount: 50, target: 'cluster' });
    expect(staffTemplateById('staff-health-safety').incidentEffect)
      .toEqual({ kind: 'frequency', amount: 0.1, target: 'own' });
  });
});

// ── AC2: income / reputation buff wiring ────────────────────

describe('AC2: own-business income buffs', () => {
  it('Baker adds +25 to its own business only', () => {
    const state = freshState('baker-own');
    placeBusiness(state, 0, 'Bakery', ['Food']);
    placeBusiness(state, 2, 'Diner', ['Food']); // distance 2: not adjacent
    employ(state, 0, 'staff-baker');

    const income = incomeBySlot(state);
    expect(income.get(0)).toBeCloseTo(27); // 2 base + 25
    expect(income.get(2)).toBeCloseTo(2);
  });

  it('Chef adds +20% to its own business only', () => {
    const state = freshState('chef-own');
    placeBusiness(state, 0, 'Cafe', ['Food'], 10);
    placeBusiness(state, 2, 'Diner', ['Food'], 10);
    employ(state, 0, 'staff-chef');

    const income = incomeBySlot(state);
    expect(income.get(0)).toBeCloseTo(12);
    expect(income.get(2)).toBeCloseTo(10);
  });

  it('Mechanic adds +30 to its own Service business only', () => {
    const state = freshState('mechanic-own');
    placeBusiness(state, 0, 'Hardware Store', ['Service'], 5);
    placeBusiness(state, 2, 'Auto Shop', ['Service'], 5);
    employ(state, 0, 'staff-mechanic');

    const income = incomeBySlot(state);
    expect(income.get(0)).toBeCloseTo(35);
    expect(income.get(2)).toBeCloseTo(5);
  });
});

describe('AC2: adjacency income buffs (employing business + 8-way neighbours)', () => {
  it('Barista adds +20 to each adjacent Food business, never to itself', () => {
    const state = freshState('barista-adjacent');
    placeBusiness(state, 0, 'Cafe', ['Food']); // employer
    placeBusiness(state, 1, 'Diner', ['Food']); // adjacent
    placeBusiness(state, 5, 'Juice Bar', ['Food']); // below slot 0 (adjacent on the 5-wide grid)
    placeBusiness(state, 3, 'Food Truck', ['Food']); // distance 3: not adjacent
    employ(state, 0, 'staff-barista');

    const income = incomeBySlot(state);
    // 5-wide grid: slot 5 is directly below slot 0 → adjacent (8-way).
    expect(income.get(1)).toBeCloseTo(22);
    expect(income.get(5)).toBeCloseTo(22);
    expect(income.get(3)).toBeCloseTo(2);
  });

  it('Florist adds +30 only to adjacent Commerce/Culture businesses', () => {
    const state = freshState('florist-adjacent');
    placeBusiness(state, 0, 'Flower Shop', ['Commerce', 'Culture']);
    placeBusiness(state, 1, 'Bookshop', ['Culture']);
    placeBusiness(state, 2, 'Gym', ['Health']);
    employ(state, 0, 'staff-florist');

    const income = incomeBySlot(state);
    expect(income.get(1)).toBeCloseTo(32);
    expect(income.get(2)).toBeCloseTo(2);
  });

  it('Event Planner adds +100 from each adjacent Entertainment business', () => {
    const state = freshState('planner-adjacent');
    placeBusiness(state, 0, 'Comedy Club', ['Entertainment']);
    placeBusiness(state, 1, 'Cinema', ['Entertainment']);
    placeBusiness(state, 2, 'Arcade', ['Entertainment']);
    employ(state, 0, 'staff-event-planner');

    const income = incomeBySlot(state);
    expect(income.get(1)).toBeCloseTo(102);
    expect(income.get(2)).toBeCloseTo(2);
  });

  it('Customer Service Rep adds +10 reputation per adjacent business', () => {
    const state = freshState('csr-adjacent');
    placeBusiness(state, 0, 'Bakery', ['Food']);
    placeBusiness(state, 1, 'Diner', ['Food']);   // right of slot 0
    placeBusiness(state, 5, 'Food Truck', ['Food']); // directly below slot 0
    employ(state, 0, 'staff-customer-rep');

    const repBefore = state.resourceBank.reputation;
    applyIncome(state);
    // Two adjacent businesses (+20). Own-business rep is unchanged (the
    // business cards themselves carry no reputation).
    expect(state.resourceBank.reputation - repBefore).toBe(20);
  });
});

describe('AC2: own-business reputation buffs', () => {
  it('PR Officer adds +15 reputation once, to its own business only', () => {
    const state = freshState('pr-own');
    placeBusiness(state, 0, 'Bakery', ['Food']);
    placeBusiness(state, 1, 'Diner', ['Food']);
    placeBusiness(state, 2, 'Food Truck', ['Food']);
    employ(state, 0, 'staff-pr');

    const repBefore = state.resourceBank.reputation;
    applyIncome(state);
    // Street-wide (pre-redesign) behaviour would have added +15 per business.
    expect(state.resourceBank.reputation - repBefore).toBe(15);
  });

  it('Marketing Consultant adds +10% reputation to its own business only', () => {
    const state = freshState('marketing-own');
    const own = placeBusiness(state, 0, 'Boutique', ['Commerce']);
    own.currentReputationPerTurn = 100;
    const other = placeBusiness(state, 1, 'Bookshop', ['Culture']);
    other.currentReputationPerTurn = 100;
    employ(state, 0, 'staff-marketing');

    const repBefore = state.resourceBank.reputation;
    applyIncome(state);
    // Own business: 100 + 10% = 110; the neighbouring business stays at 100.
    expect(state.resourceBank.reputation - repBefore).toBe(210);
  });
});

describe('AC2: IT Specialist synergy range', () => {
  it('links its own business with a business 2 slots away', () => {
    // A base income high enough that one extra synergy link survives the
    // integer rounding of the difficulty's per-neighbour rate (0.35).
    const state = freshState('it-range');
    placeBusiness(state, 0, 'Boutique', ['Commerce'], 10);
    placeBusiness(state, 2, 'Tailor', ['Commerce'], 10); // two slots away
    const withoutIt = incomeBySlot(state).get(0)!;

    const withIt = freshState('it-range-it');
    placeBusiness(withIt, 0, 'Boutique', ['Commerce'], 10);
    placeBusiness(withIt, 2, 'Tailor', ['Commerce'], 10);
    employ(withIt, 0, 'staff-it');
    const withItIncome = incomeBySlot(withIt).get(0)!;

    expect(withItIncome).toBeGreaterThan(withoutIt);
  });
});

// ── AC2: delivery adjacency purchase discount ───────────────

describe('AC2: Delivery Driver purchase discount is placement-scoped', () => {
  it('discounts a placement adjacent to its own business but not a distant one', () => {
    const state = freshState('delivery-adjacent');
    placeBusiness(state, 2, 'Grocery', ['Food']);
    employ(state, 2, 'staff-delivery');

    expect(computeAdjacentPurchaseDiscount(state, 1)).toBe(50); // adjacent
    expect(computeAdjacentPurchaseDiscount(state, 2)).toBe(0); // its own slot
    expect(computeAdjacentPurchaseDiscount(state, 9)).toBe(0); // far

    expect(computePurchaseCostDiscount(state, 1)).toBe(50);
    expect(computePurchaseCostDiscount(state, 9)).toBe(0);
    expect(computeEffectiveBusinessPurchaseCost(state, 300, 1)).toBe(250);
    expect(computeEffectiveBusinessPurchaseCost(state, 300, 9)).toBe(300);
  });

  it('never leaks street-wide without a destination slot', () => {
    const state = freshState('delivery-no-slot');
    placeBusiness(state, 2, 'Grocery', ['Food']);
    employ(state, 2, 'staff-delivery');

    expect(computePurchaseCostDiscount(state)).toBe(0);
  });
});

// ── AC2: incident mitigation scoping ────────────────────────

describe('AC2: incident mitigation resolves per business cluster', () => {
  it('Security Guard reduces coin damage for its own business and neighbours', () => {
    const guarded = freshState('security-guarded');
    placeBusiness(guarded, 0, 'Bakery', ['Food']);
    placeBusiness(guarded, 1, 'Diner', ['Food']);
    employ(guarded, 0, 'staff-security');
    const coinsBefore = guarded.resourceBank.coins;
    resolveEvent(guarded, eventTemplate('evt-rainy')); // -100 per Food business
    const loss = coinsBefore - guarded.resourceBank.coins;

    const plain = freshState('security-plain');
    placeBusiness(plain, 0, 'Bakery', ['Food']);
    placeBusiness(plain, 1, 'Diner', ['Food']);
    const plainBefore = plain.resourceBank.coins;
    resolveEvent(plain, eventTemplate('evt-rainy'));
    const plainLoss = plainBefore - plain.resourceBank.coins;

    // Two matching businesses, both inside the guarded cluster: -10% each.
    expect(plainLoss).toBe(200);
    expect(loss).toBe(180);
  });

  it('Security Guard does not protect a business outside its cluster', () => {
    const state = freshState('security-outside');
    placeBusiness(state, 0, 'Bakery', ['Food']);
    placeBusiness(state, 7, 'Food Truck', ['Food']); // far from slot 0
    employ(state, 0, 'staff-security');
    const coinsBefore = state.resourceBank.coins;
    resolveEvent(state, eventTemplate('evt-rainy'));
    // Only the guarded business is mitigated: -90 + -100.
    expect(coinsBefore - state.resourceBank.coins).toBe(190);
  });

  it('Maintenance Worker reduces incident reputation damage for its cluster', () => {
    const state = freshState('maintenance-cluster');
    placeBusiness(state, 0, 'Arcade', ['Entertainment']);
    employ(state, 0, 'staff-maintenance');
    const repBefore = state.resourceBank.reputation;
    resolveEvent(state, eventTemplate('evt-noise-complaint')); // -100 rep
    expect(repBefore - state.resourceBank.reputation).toBe(50);
  });

  it('Health & Safety Inspector protects only its own business', () => {
    const state = freshState('hse-own');
    placeBusiness(state, 0, 'Clinic', ['Health']);
    placeBusiness(state, 6, 'Pharmacy', ['Health']); // far, unguarded
    employ(state, 0, 'staff-health-safety');

    expect(computeBusinessIncidentMitigation(state, 0).frequencyReductionPct).toBeCloseTo(0.1);
    expect(computeBusinessIncidentMitigation(state, 6).frequencyReductionPct).toBe(0);
  });

  it('avertss an incident that can hit the inspector business', () => {
    const state = freshState('hse-avert');
    placeBusiness(state, 0, 'Clinic', ['Health']);
    employ(state, 0, 'staff-health-safety');
    state.incidentDeck = [eventTemplate('evt-street-cleaning')];
    // A deterministic roll of 0 is below the 10% avert chance.
    state.rng = () => 0;

    const resolved = resolveIncident(state);
    expect(resolved).toBeNull();
    // The card returns to the deck untouched so it resolves next turn.
    expect(state.incidentDeck.map(e => e.id)).toEqual(['evt-street-cleaning']);
  });
});

// ── AC3: assignment enforcement ────────────────────────────

describe('AC3: type = assignment', () => {
  it('rejects placing a management-company member at a business', () => {
    const state = freshState('assign-mc');
    placeBusiness(state, 0, 'Bakery', ['Food']);
    const assistant: StaffCard = { ...staffTemplate('staff-assistant'), id: 'staff-assistant-1' };
    state.staffCards.push(assistant);

    const legality = canPlaceStaffOnBusiness(state, assistant.id, 0);
    expect(legality.legal).toBe(false);
    expect((legality as { reason?: string }).reason ?? '').toMatch(/management-company/i);
    expect(() => placeStaffOnBusiness(state, assistant.id, 0)).toThrow(/management-company/i);
    expect(assistant.employedAtSlot).toBeUndefined();
    expect(state.streetGrid[0]!.employedStaff ?? []).toHaveLength(0);
  });

  it('still places business staff at a matching business', () => {
    const state = freshState('assign-business');
    placeBusiness(state, 0, 'Bakery', ['Food']);
    const baker: StaffCard = { ...staffTemplate('staff-baker'), id: 'staff-baker-1' };
    state.staffCards.push(baker);

    expect(canPlaceStaffOnBusiness(state, baker.id, 0).legal).toBe(true);
    placeStaffOnBusiness(state, baker.id, 0);
    expect(baker.employedAtSlot).toBe(0);
  });

  it('hiring a management-company member never assigns a destination', () => {
    const state = freshState('assign-hire');
    state.phase = 'MarketPhase';
    const assistant = staffTemplate('staff-assistant');
    state.market.cards = [{ ...assistant }];

    purchaseStaffCard(state, assistant.id);

    const hired = state.staffCards.find(c => c.id === assistant.id)!;
    expect(hired).toBeDefined();
    expect(hired.employedAtSlot).toBeUndefined();
    // No business gained an employee as a side effect of hiring.
    expect(state.streetGrid.every(slot => (slot?.employedStaff ?? []).length === 0)).toBe(true);
  });
});

// ── AC2/AC3: buff aggregation model ───────────────────────

describe('buff aggregation reads only the local cluster', () => {
  it('reports zero buffs for a business with no business staff nearby', () => {
    const state = freshState('buffs-empty');
    placeBusiness(state, 0, 'Bakery', ['Food']);
    expect(computeBusinessStaffBuffs(state, 0)).toEqual({
      incomeFlat: 0,
      incomePercent: 0,
      reputationFlat: 0,
      reputationPercent: 0,
      synergyRangeBonus: 0,
    });
  });

  it('combines own and adjacent contributions for one business', () => {
    const state = freshState('buffs-combined');
    placeBusiness(state, 0, 'Bakery', ['Food']);
    placeBusiness(state, 1, 'Diner', ['Food']);
    employ(state, 0, 'staff-chef'); // own +20%
    employ(state, 1, 'staff-barista'); // +20 to adjacent Food (this slot)

    const buffs = computeBusinessStaffBuffs(state, 0);
    expect(buffs.incomePercent).toBeCloseTo(0.2);
    expect(buffs.incomeFlat).toBe(20);
  });
});
