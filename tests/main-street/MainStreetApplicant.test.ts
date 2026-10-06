/**
 * Main Street: Staff applicant trigger, hire/decline, let-go economics, and
 * employment capacity (CG-0MSTOATDU006UGAX).
 *
 * Behavioural specification against the real engine exports. Type-gating and
 * the chance-formula details are covered by
 * `walk-on-applicant-gating.test.ts`; this file focuses on seeding
 * determinism, the hire/decline/let-go flows, and capacity enforcement.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import {
  resolveStaffApplicant,
  hireStaffApplicant,
  declineStaffApplicant,
  letGoStaffMember,
  getEmploymentCapacity,
  getEmployedStaffCountAt,
  canHireStaffApplicant,
} from '../../src/MainStreetEngine';
import {
  createStaffDeck,
  type BusinessCard,
  type StaffCard,
} from '../../src/MainStreetCards';

// ── Fixtures ────────────────────────────────────────────────

function createTestState(seed = 'applicant-test'): MainStreetState {
  return setupMainStreetGame({ seed });
}

/** Places a business at the given slot and marks it fully deployed. */
function placeBusiness(
  state: MainStreetState,
  slotIndex = 0,
  overrides: Partial<BusinessCard> = {},
): BusinessCard {
  const base: BusinessCard = {
    family: 'business',
    id: `biz-${slotIndex}`,
    name: `Biz ${slotIndex}`,
    cost: 3,
    baseIncome: 2,
    synergyTypes: ['Food'],
    maxLevel: 4,
    description: 'A test business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    employedStaff: [],
    ...overrides,
  };
  state.streetGrid[slotIndex] = base;
  return base;
}

/**
 * Employs a synthetic staff member at the given slot (no market purchase):
 * pushes onto `state.staffCards` and onto the business's `employedStaff`
 * list (the per-business source of truth read by the capacity helpers).
 */
function employSynthetic(
  state: MainStreetState,
  slotIndex: number,
  {
    skillIds = ['skill-town-gossip'],
    ongoingCost = 0.5,
  }: { skillIds?: string[]; ongoingCost?: number } = {},
): StaffCard {
  const template = createStaffDeck(1)[0]!;
  const member: StaffCard = {
    ...template,
    id: `${template.id}-${slotIndex}-${state.staffCards.length}`,
    specializationSkillIds: [...skillIds],
    employedAtSlot: slotIndex,
    ongoingCost,
  };
  state.staffCards.push(member);
  const business = state.streetGrid[slotIndex];
  if (business) {
    business.employedStaff = [...(business.employedStaff ?? []), member];
  }
  return member;
}

// ── Determinism ─────────────────────────────────────────────

describe('applicant trigger: deterministic under seeded RNG (CG-0MSTOATDU006UGAX)', () => {
  it('the same seed yields the same applicant outcome across independent runs', () => {
    function run(seed: string): { id: string; slot: number } | null {
      const state = createTestState(seed);
      placeBusiness(state, 0, { baseIncome: 5 });
      state.resourceBank.reputation = 5;
      resolveStaffApplicant(state);
      return state.pendingApplicant
        ? { id: state.pendingApplicant.card.id, slot: state.pendingApplicant.targetSlotIndex }
        : null;
    }

    expect(run('applicant-determinism-seed')).toEqual(run('applicant-determinism-seed'));
  });

  it('a roll below the chance triggers; a roll at or above it does not', () => {
    const triggering = createTestState('roll-below');
    placeBusiness(triggering, 0, { baseIncome: 5 }); // chance = 5%
    triggering.rng = () => 0; // roll 0 < 5
    resolveStaffApplicant(triggering);
    expect(triggering.pendingApplicant).not.toBeNull();

    const suppressed = createTestState('roll-above');
    placeBusiness(suppressed, 0, { baseIncome: 5 }); // chance = 5%
    suppressed.rng = () => 0.5; // roll 50 >= 5
    resolveStaffApplicant(suppressed);
    expect(suppressed.pendingApplicant).toBeNull();
  });
});

// ── No eligible business ────────────────────────────────────

describe('applicant trigger: no eligible business → no pending applicant', () => {
  it('an empty street never produces an applicant, even when the trigger is forced', () => {
    const state = createTestState('empty-street');
    state.forcedStaffApplicant = true; // bypasses the roll, not the eligibility guard
    resolveStaffApplicant(state);
    expect(state.pendingApplicant).toBeNull();
  });

  it('businesses at full employment capacity suppress the applicant', () => {
    const state = createTestState('full-capacity');
    placeBusiness(state, 0, { level: 0 }); // capacity 1
    employSynthetic(state, 0);
    expect(getEmployedStaffCountAt(state, 0)).toBe(1);

    state.forcedStaffApplicant = true;
    resolveStaffApplicant(state);
    expect(state.pendingApplicant).toBeNull();
  });
});

// ── Hire flow ───────────────────────────────────────────────

describe('hire: applicant joins staffCards at the target slot, 0 cost, no hand slot', () => {
  it('hires the pending applicant onto the eligible business', () => {
    const state = createTestState('hire-flow');
    placeBusiness(state, 2, { baseIncome: 3 });
    state.resourceBank.coins = 10;
    state.forcedStaffApplicant = true;
    resolveStaffApplicant(state);

    expect(state.pendingApplicant).not.toBeNull();
    expect(state.pendingApplicant!.targetSlotIndex).toBe(2);
    const cardId = state.pendingApplicant!.card.id;
    const coinsBefore = state.resourceBank.coins;
    const maxHandBefore = state.maxHandSize;
    const staffBefore = state.staffCards.length;

    hireStaffApplicant(state);

    expect(state.pendingApplicant).toBeNull();
    expect(state.staffCards).toHaveLength(staffBefore + 1);
    const hired = state.staffCards[state.staffCards.length - 1];
    expect(hired.id).toBe(cardId);
    expect(hired.employedAtSlot).toBe(2);
    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.maxHandSize).toBe(maxHandBefore);
    // Registered on the business's employed-staff list.
    expect(getEmployedStaffCountAt(state, 2)).toBe(1);
  });

  it('rejects hiring when the target slot is already at capacity', () => {
    const state = createTestState('over-capacity');
    placeBusiness(state, 0, { level: 0 }); // capacity 1
    employSynthetic(state, 0);
    state.pendingApplicant = {
      card: { ...createStaffDeck(1)[0]! },
      targetSlotIndex: 0,
    };

    expect(canHireStaffApplicant(state)).toBe(false);
    expect(() => hireStaffApplicant(state)).toThrow(/capacity/i);
  });
});

// ── Decline flow ────────────────────────────────────────────

describe('decline: pending applicant cleared, no state changes', () => {
  it('clears the applicant without touching coins, reputation, or staff', () => {
    const state = createTestState('decline-flow');
    placeBusiness(state, 0, { baseIncome: 3 });
    state.resourceBank.coins = 9;
    state.resourceBank.reputation = 5;
    state.forcedStaffApplicant = true;
    resolveStaffApplicant(state);
    expect(state.pendingApplicant).not.toBeNull();

    const coinsBefore = state.resourceBank.coins;
    const reputationBefore = state.resourceBank.reputation;
    const staffBefore = state.staffCards.length;
    const maxHandBefore = state.maxHandSize;

    declineStaffApplicant(state);

    expect(state.pendingApplicant).toBeNull();
    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.resourceBank.reputation).toBe(reputationBefore);
    expect(state.staffCards).toHaveLength(staffBefore);
    expect(state.maxHandSize).toBe(maxHandBefore);
  });
});

// ── Let-go economics ────────────────────────────────────────

describe('let-go: removes member, deducts 1 salary + 1 reputation', () => {
  it('deducts one turn of salary and 1 reputation and removes the member', () => {
    const state = createTestState('let-go-penalties');
    placeBusiness(state, 0, { baseIncome: 2 });
    // Town Gossip carries no Operations Manager salary discount, so the cost
    // equals the member's ongoingCost exactly.
    employSynthetic(state, 0, { skillIds: ['skill-town-gossip'], ongoingCost: 1.5 });
    state.resourceBank.coins = 5;
    state.resourceBank.reputation = 4;

    letGoStaffMember(state, 0);

    expect(state.staffCards).toHaveLength(0);
    expect(state.resourceBank.coins).toBe(3.5);
    expect(state.resourceBank.reputation).toBe(3);
    expect(getEmployedStaffCountAt(state, 0)).toBe(0);
  });

  it('clamps the salary deduction at 0 coins', () => {
    const state = createTestState('let-go-clamped');
    placeBusiness(state, 0, { baseIncome: 2 });
    employSynthetic(state, 0, { skillIds: ['skill-town-gossip'], ongoingCost: 2 });
    state.resourceBank.coins = 0;
    state.resourceBank.reputation = 2;

    letGoStaffMember(state, 0);

    expect(state.staffCards).toHaveLength(0);
    expect(state.resourceBank.coins).toBe(0);
    expect(state.resourceBank.reputation).toBe(1);
  });
});

// ── Employment capacity ─────────────────────────────────────

describe('employment capacity: max(1, level + 1) per business', () => {
  it('a level-0 business has one slot and each level adds one', () => {
    const state = createTestState('capacity-math');
    placeBusiness(state, 0, { level: 0 });
    placeBusiness(state, 1, { level: 2 });

    expect(getEmploymentCapacity(state, 0)).toBe(1);
    expect(getEmploymentCapacity(state, 1)).toBe(3);

    (state.streetGrid[1] as BusinessCard).level = 3;
    expect(getEmploymentCapacity(state, 1)).toBe(4);
  });

  it('reports the employed count for a business', () => {
    const state = createTestState('employed-count');
    placeBusiness(state, 0, { level: 2 });
    expect(getEmployedStaffCountAt(state, 0)).toBe(0);
    employSynthetic(state, 0, { skillIds: ['skill-chef'] });
    expect(getEmployedStaffCountAt(state, 0)).toBe(1);
  });
});
