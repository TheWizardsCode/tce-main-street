/**
 * Main Street: staff-type scope gate in the buff aggregation functions
 * (MS-0MW4MSNWR00123OZ, parent MS-0MW3LTMHT001PRDT).
 *
 * The two-type model (GDD D.4.2/D.4.8, `docs/game/specialization-skills.md`)
 * says a specialization skill takes effect only from a member whose type
 * matches the skill's scope:
 *   - business staff (an `employedAtSlot` link) realise **business-scope**
 *     skills, scoped to the employing business;
 *   - management-company staff (no `employedAtSlot`) realise
 *     **management-company-scope** skills, scoped to the player/street.
 *
 * The gate lives at the aggregation site, so every consumer inherits it with
 * no per-consumer special-casing:
 *   AC1  `getEmployedSpecializationSkills` contributes only
 *        management-company-scope skills held by management-company members.
 *   AC2  `getEmployedSpecializationSkillsForBusiness` contributes only
 *        business-scope skills of members employed at that slot.
 *   AC3  The Operations Manager salary discount is a business-staff effect.
 *   AC4  Hand-built fixtures / saves carrying cross-type skills are inert in
 *        every consumer (engine events, market refill, staff costs).
 *   AC5  No new persisted field — the type is derived from `employedAtSlot`.
 *   AC6  Both leak directions are covered here.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';

import { setupMainStreetGame, serializeMainStreetState, deserializeMainStreetState, type MainStreetState } from '../../src/MainStreetState';
import { executeWeekStart } from '../../src/MainStreetEngine';
import { createStaffDeck, type BusinessCard, type EventCard, type StaffCard } from '../../src/MainStreetCards';
import {
  computeIncidentSkillBuffs,
  computePerBusinessSkillBuffs,
  computeRefreshCostDiscount,
  computeReputationGainMultiplier,
  computeStreetOngoingCostReductionPct,
  getEmployedSpecializationSkills,
  getEmployedSpecializationSkillsForBusiness,
} from '../../src/MainStreetStaffBuffs';
import { hasPeekCapableStaff } from '../../src/MainStreetStaffSkills';
import { applyStaffOngoingCosts, letGoStaffMember } from '../../src/MainStreetEngineCommands';
import { refreshMarketCost } from '../../src/MainStreetMarket';
import { computeEventDeltas } from '../../src/MainStreetEngineEvents';
import { applyIncome, syncCardCurrentIncome } from '../../src/MainStreetAdjacency';

// ── Fixtures ────────────────────────────────────────────────

/** Every management-company-scope skill class (one per effect family + baseline). */
const MANAGEMENT_COMPANY_SKILLS = [
  'skill-cost-cutter', // cost reduction (street-wide ongoing)
  'skill-negotiator', // cost reduction (refresh discount)
  'skill-brand-ambassador', // reputation multiplier
  'skill-quality-inspector', // incident mitigation
  'skill-risk-manager',
  'skill-security-consultant',
  'skill-compliance',
  'skill-town-gossip', // baseline (peek)
] as const;

/** Every business-scope skill class (income + reputation + salary cost). */
const BUSINESS_SKILLS = [
  'skill-chef', // income boost (Food)
  'skill-community-builder', // reputation boost
  'skill-operations-manager', // salary cost
] as const;

/**
 * A staff member with a forced skill roster. `employedAtSlot` present = business
 * staff; absent = management-company staff (the two-type model's runtime
 * determinant).
 */
function staffMember(
  name: string,
  skillIds: readonly string[],
  opts: { employedAtSlot?: number; ongoingCost?: number } = {},
): StaffCard {
  const base = createStaffDeck(1).find(c => c.id.startsWith('staff-assistant'))!;
  return {
    ...base,
    id: `${base.id}-${name}`,
    name,
    specializationSkillIds: [...skillIds],
    ongoingCost: opts.ongoingCost ?? base.ongoingCost,
    ...(opts.employedAtSlot === undefined ? {} : { employedAtSlot: opts.employedAtSlot }),
  };
}

/** Places a Food business with a synced income cache at `slot`. */
function placeFood(state: MainStreetState, slot = 0, baseIncome = 2): BusinessCard {
  const biz: BusinessCard = {
    family: 'business',
    id: `biz-scope-gate-${slot}`,
    name: `Scope Gate Bistro ${slot}`,
    cost: 3,
    baseIncome,
    synergyTypes: ['Food'],
    maxLevel: 0,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    description: 'Scope-gate fixture business.',
    ongoingCost: 1,
  };
  state.streetGrid[slot] = biz;
  syncCardCurrentIncome(state.streetGrid, slot);
  return biz;
}

/** An incident that costs 10 coins, for incident-mitigation assertions. */
function coinIncident(): EventCard {
  return {
    family: 'event',
    id: 'evt-scope-gate-incident',
    name: 'Scope Gate Incident',
    trigger: 'Incident',
    cost: 0,
    effect: '-10 coins',
    coinDelta: -10,
    reputationDelta: 0,
    target: 'All',
  };
}

/** An investment that grants 100 reputation, for multiplier assertions. */
function repInvestment(): EventCard {
  return {
    family: 'event',
    id: 'evt-scope-gate-investment',
    name: 'Scope Gate Investment',
    trigger: 'Investment',
    cost: 0,
    effect: '+100 reputation',
    coinDelta: 0,
    reputationDelta: 100,
    target: 'All',
  };
}

// ── AC1: street-wide aggregation gated ──────────────────────

describe('AC1: street-wide aggregation is management-company scope only', () => {
  it('a business-staff member holding every management-company skill class contributes nothing street-wide', () => {
    const state = setupMainStreetGame({ seed: 'scope-gate-street-inert' });
    state.staffCards.push(staffMember('biz-mgr', MANAGEMENT_COMPANY_SKILLS, { employedAtSlot: 0 }));

    const street = getEmployedSpecializationSkills(state);
    expect(street).toHaveLength(0);
    expect(computeIncidentSkillBuffs(street)).toEqual({
      coinDamageReductionPct: 0,
      reputationDamageReductionFlat: 0,
      probabilityReductionPct: 0,
      immuneToTheftLoss: false,
    });
    expect(computeStreetOngoingCostReductionPct(street)).toBe(0);
    expect(computeRefreshCostDiscount(street)).toBe(0);
    expect(computeReputationGainMultiplier(street)).toBe(1);
  });

  it('a management-company member holding the same skills does contribute street-wide', () => {
    const state = setupMainStreetGame({ seed: 'scope-gate-street-live' });
    state.staffCards.push(staffMember('company-mgr', MANAGEMENT_COMPANY_SKILLS));

    const street = getEmployedSpecializationSkills(state);
    expect(street.map(s => s.id).sort()).toEqual([...MANAGEMENT_COMPANY_SKILLS].sort());
    expect(computeIncidentSkillBuffs(street).coinDamageReductionPct).toBeCloseTo(0.3);
    expect(computeStreetOngoingCostReductionPct(street)).toBeCloseTo(0.15);
    expect(computeRefreshCostDiscount(street)).toBe(100);
    expect(computeReputationGainMultiplier(street)).toBeCloseTo(1.5);
  });

  it('a management-company member holding a business-scope skill contributes nothing street-wide', () => {
    const state = setupMainStreetGame({ seed: 'scope-gate-street-biz-skill' });
    state.staffCards.push(staffMember('company-chef', BUSINESS_SKILLS));

    expect(getEmployedSpecializationSkills(state)).toHaveLength(0);
  });
});

// ── AC2: per-business aggregation gated ─────────────────────

describe('AC2: per-business aggregation is business scope only', () => {
  it('a business-staff member holding business-scope skills still buffs its own business', () => {
    const state = setupMainStreetGame({ seed: 'scope-gate-biz-live' });
    placeFood(state, 0);
    state.staffCards.push(staffMember('biz-chef', ['skill-chef', 'skill-community-builder'], { employedAtSlot: 0 }));

    const pool = getEmployedSpecializationSkillsForBusiness(state, 0).map(s => s.id).sort();
    expect(pool).toEqual(['skill-chef', 'skill-community-builder']);

    const buffs = computePerBusinessSkillBuffs(getEmployedSpecializationSkillsForBusiness(state, 0), {
      synergyTypes: ['Food'],
      baseIncome: 2,
      ongoingCost: 1,
    });
    expect(buffs.income.percent).toBeCloseTo(0.2);
    expect(buffs.reputation.flat).toBe(10);
  });

  it('a business-staff member holding management-company skills gets no per-business buff', () => {
    const state = setupMainStreetGame({ seed: 'scope-gate-biz-inert' });
    placeFood(state, 0);
    state.staffCards.push(staffMember('biz-mgr', MANAGEMENT_COMPANY_SKILLS, { employedAtSlot: 0 }));

    expect(getEmployedSpecializationSkillsForBusiness(state, 0)).toHaveLength(0);

    const buffs = computePerBusinessSkillBuffs(getEmployedSpecializationSkillsForBusiness(state, 0), {
      synergyTypes: ['Food'],
      baseIncome: 2,
      ongoingCost: 1,
    });
    expect(buffs.income.percent).toBe(0);
    expect(buffs.income.flat).toBe(0);
    expect(buffs.reputation.flat).toBe(0);
    expect(buffs.ongoingCosts.reductionPct).toBe(0);
    expect(buffs.incidents.coinDamageReductionPct).toBe(0);

    // Income phase inherits the gate: no buff reaches the business.
    const result = applyIncome(state);
    expect(result.breakdown.find(s => s.slotIndex === 0)?.total).toBeCloseTo(2);
  });

  it('a management-company member holding a business-scope skill gets no per-business buff', () => {
    const state = setupMainStreetGame({ seed: 'scope-gate-biz-company-holder' });
    placeFood(state, 0);
    state.staffCards.push(staffMember('company-chef', BUSINESS_SKILLS));

    expect(getEmployedSpecializationSkillsForBusiness(state, 0)).toHaveLength(0);
    const result = applyIncome(state);
    expect(result.breakdown.find(s => s.slotIndex === 0)?.total).toBeCloseTo(2);
  });
});

// ── AC3: Operations Manager is a business-staff effect ──────

describe('AC3: Operations Manager salary discount requires business staff', () => {
  it('discounts the salary of a business-staff member', () => {
    const state = setupMainStreetGame({ seed: 'scope-gate-ops-business' });
    state.staffCards.push(staffMember('biz-ops', ['skill-operations-manager'], { employedAtSlot: 0, ongoingCost: 100 }));

    // 100 salary − 50 Operations Manager discount.
    expect(applyStaffOngoingCosts(state, { apply: false })).toBe(-50);
  });

  it('never discounts a management-company member salary', () => {
    const state = setupMainStreetGame({ seed: 'scope-gate-ops-company' });
    state.staffCards.push(staffMember('company-ops', ['skill-operations-manager'], { ongoingCost: 100 }));

    // Full salary: the cross-type skill is inert.
    expect(applyStaffOngoingCosts(state, { apply: false })).toBe(-100);
  });

  it('the let-go salary charge follows the same gate', () => {
    const businessStaff = setupMainStreetGame({ seed: 'scope-gate-letgo-business' });
    businessStaff.staffCards.push(staffMember('biz-ops', ['skill-operations-manager'], { employedAtSlot: 0, ongoingCost: 100 }));
    businessStaff.resourceBank.coins = 1000;
    // Salary 50 (100 − 50 discount) → 100-unit lay-off reputation floor.
    businessStaff.resourceBank.reputation = 200;
    letGoStaffMember(businessStaff, 0);
    expect(businessStaff.resourceBank.coins).toBe(950);
    expect(businessStaff.resourceBank.reputation).toBe(100);

    const companyStaff = setupMainStreetGame({ seed: 'scope-gate-letgo-company' });
    companyStaff.staffCards.push(staffMember('company-ops', ['skill-operations-manager'], { ongoingCost: 100 }));
    companyStaff.resourceBank.coins = 1000;
    // Salary 100 (cross-type discount inert) → 100-unit lay-off reputation floor.
    companyStaff.resourceBank.reputation = 200;
    letGoStaffMember(companyStaff, 0);
    expect(companyStaff.resourceBank.coins).toBe(900);
    expect(companyStaff.resourceBank.reputation).toBe(100);
  });
});

// ── AC4: every consumer inherits the gate ───────────────────

describe('AC4: consumers inherit the gate without special-casing', () => {
  it('market refresh discount ignores a business-staff Negotiator', () => {
    const base = setupMainStreetGame({ seed: 'scope-gate-refresh-base' });
    const baseCost = refreshMarketCost(base);

    const inert = setupMainStreetGame({ seed: 'scope-gate-refresh-inert' });
    inert.staffCards.push(staffMember('biz-neg', ['skill-negotiator'], { employedAtSlot: 0 }));
    expect(refreshMarketCost(inert)).toBe(baseCost);

    const live = setupMainStreetGame({ seed: 'scope-gate-refresh-live' });
    live.staffCards.push(staffMember('company-neg', ['skill-negotiator']));
    expect(refreshMarketCost(live)).toBe(baseCost - 100);
  });

  it('staff ongoing costs ignore a business-staff Cost Cutter', () => {
    const inert = setupMainStreetGame({ seed: 'scope-gate-cutter-inert' });
    inert.staffCards.push(staffMember('biz-cutter', ['skill-cost-cutter'], { employedAtSlot: 0, ongoingCost: 100 }));
    expect(applyStaffOngoingCosts(inert, { apply: false })).toBe(-100);

    const live = setupMainStreetGame({ seed: 'scope-gate-cutter-live' });
    live.staffCards.push(staffMember('company-cutter', ['skill-cost-cutter'], { ongoingCost: 100 }));
    // 100 salary − 15% street-wide ongoing reduction.
    expect(applyStaffOngoingCosts(live, { apply: false })).toBe(-85);
  });

  it('incident mitigation ignores business-staff incident skills', () => {
    const inert = setupMainStreetGame({ seed: 'scope-gate-incident-inert' });
    inert.staffCards.push(staffMember('biz-inspector', ['skill-quality-inspector'], { employedAtSlot: 0 }));
    expect(computeEventDeltas(inert, coinIncident()).coinDelta).toBe(-10);

    const live = setupMainStreetGame({ seed: 'scope-gate-incident-live' });
    live.staffCards.push(staffMember('company-inspector', ['skill-quality-inspector']));
    expect(computeEventDeltas(live, coinIncident()).coinDelta).toBe(-7); // -30%
  });

  it('the Brand Ambassador reputation multiplier ignores business staff', () => {
    const inert = setupMainStreetGame({ seed: 'scope-gate-brand-inert' });
    inert.staffCards.push(staffMember('biz-brand', ['skill-brand-ambassador'], { employedAtSlot: 0 }));
    expect(computeEventDeltas(inert, repInvestment()).repDelta).toBe(100);

    const live = setupMainStreetGame({ seed: 'scope-gate-brand-live' });
    live.staffCards.push(staffMember('company-brand', ['skill-brand-ambassador']));
    expect(computeEventDeltas(live, repInvestment()).repDelta).toBe(150);
  });

  it('the Town Gossip baseline peek is inert when held by business staff', () => {
    const inert = setupMainStreetGame({ seed: 'scope-gate-peek-inert' });
    inert.staffCards.push(staffMember('biz-gossip', ['skill-town-gossip'], { employedAtSlot: 0 }));
    expect(hasPeekCapableStaff(inert)).toBe(false);

    const live = setupMainStreetGame({ seed: 'scope-gate-peek-live' });
    live.staffCards.push(staffMember('company-gossip', ['skill-town-gossip']));
    expect(hasPeekCapableStaff(live)).toBe(true);
  });
});

// ── AC5: no new persisted field ─────────────────────────────

describe('AC5: the gate survives a save round-trip without a stored type field', () => {
  it('restored cross-type skills stay inert; same-type skills keep working', () => {
    const state = setupMainStreetGame({ seed: 'scope-gate-save' });
    executeWeekStart(state);
    placeFood(state, 0);
    state.staffCards.push(staffMember('biz-mgr', MANAGEMENT_COMPANY_SKILLS, { employedAtSlot: 0 }));
    state.staffCards.push(staffMember('biz-chef', ['skill-chef'], { employedAtSlot: 0 }));

    const restored = deserializeMainStreetState(serializeMainStreetState(state));

    // The business-staff member's management-company skills are still inert…
    expect(getEmployedSpecializationSkills(restored)).toHaveLength(0);
    // …while its business-scope skills still buff its own business.
    expect(getEmployedSpecializationSkillsForBusiness(restored, 0).map(s => s.id)).toEqual(['skill-chef']);
    expect(applyIncome(restored).breakdown.find(s => s.slotIndex === 0)?.total).toBeCloseTo(2.4);
  });
});
