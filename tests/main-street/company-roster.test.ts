/**
 * Main Street: Company Roster — lay-off reputation economics
 * (MS-0MWC1T8K2000DWZA).
 *
 * Pins the salary-scaled lay-off reputation rule
 * `max(100, ceil(salary / 100) × 100)` at its boundaries, and asserts the
 * quoted cost equals what `letGoStaffMember()` actually charges (quoted ==
 * charged), so the roster overlay cannot quote a figure the engine does not
 * deduct.
 *
 * Reputation ships in ×100 display units, so the GDD D.4.2 §5 pre-scale
 * "1 reputation" is the 100-unit floor of the rule.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import { letGoStaffMember } from '../../src/MainStreetEngine';
import { layOffReputationCost } from '../../src/MainStreetRoster';
import {
  computeStaffSalaryCost,
  getSalaryScopeSkills,
} from '../../src/MainStreetStaffBuffs';
import { createStaffDeck, type StaffCard } from '../../src/MainStreetCards';

// ── Fixtures ────────────────────────────────────────────────

/** A management-company member (no `employedAtSlot`) with a given salary. */
function managementMember(id: string, ongoingCost: number): StaffCard {
  const template = createStaffDeck(1)[0]!;
  return {
    ...template,
    id,
    name: id,
    specializationSkillIds: [],
    ongoingCost,
  };
}

/** Reputation actually charged for a member, measured through the engine. */
function chargeLayOff(state: MainStreetState, member: StaffCard): number {
  state.staffCards.push(member);
  const before = state.resourceBank.reputation;
  letGoStaffMember(state, state.staffCards.length - 1);
  return before - state.resourceBank.reputation;
}

// ── Formula boundaries ─────────────────────────────────────

describe('layOffReputationCost: max(100, ceil(salary / 100) × 100)', () => {
  it.each([
    [0, 100],
    [50, 100],
    [100, 100],
    [150, 200],
    [250, 300],
    [400, 400],
    [500, 500],
  ] as const)('salary %i → %i reputation', (salary, expected) => {
    expect(layOffReputationCost(salary)).toBe(expected);
  });

  it('rounds fractional salaries up to the next 100-unit band', () => {
    expect(layOffReputationCost(1.5)).toBe(100);
    expect(layOffReputationCost(100.5)).toBe(200);
    expect(layOffReputationCost(250.1)).toBe(300);
  });

  it('treats a negative (already-clamped) salary as the 100-unit floor', () => {
    expect(layOffReputationCost(-50)).toBe(100);
  });

  it('never returns less than 100 reputation', () => {
    for (const salary of [0, 0.01, 50, 99.99, 100]) {
      expect(layOffReputationCost(salary)).toBeGreaterThanOrEqual(100);
    }
  });
});

// ── Quoted == charged ──────────────────────────────────────

describe('letGoStaffMember charges exactly the quoted lay-off cost', () => {
  it('a salary-0 member is charged the 100-unit floor', () => {
    const state = setupMainStreetGame({ seed: 'roster-quote-zero' });
    state.resourceBank.reputation = 1000;
    const member = managementMember('staff-zero-salary', 0);

    const salary = computeStaffSalaryCost(getSalaryScopeSkills(member), member.ongoingCost);
    const quoted = layOffReputationCost(salary);
    expect(salary).toBe(0);

    expect(chargeLayOff(state, member)).toBe(quoted);
    expect(quoted).toBe(100);
  });

  it('a high-salary member (≥250) is charged the salary-scaled figure', () => {
    const state = setupMainStreetGame({ seed: 'roster-quote-high' });
    state.resourceBank.reputation = 1000;
    const member = managementMember('staff-high-salary', 500);

    const salary = computeStaffSalaryCost(getSalaryScopeSkills(member), member.ongoingCost);
    const quoted = layOffReputationCost(salary);
    expect(salary).toBeGreaterThanOrEqual(250);

    expect(chargeLayOff(state, member)).toBe(quoted);
    expect(quoted).toBe(500);
  });

  it('quoted cost is inert to a cross-type Operations Manager (scope gate)', () => {
    const state = setupMainStreetGame({ seed: 'roster-quote-discount' });
    state.resourceBank.reputation = 1000;
    // The Operations Manager discount is business-scoped, so it stays inert for
    // a management-company member: salary stays 300 → 300 reputation.
    const member: StaffCard = {
      ...managementMember('staff-cross-type-ops', 300),
      specializationSkillIds: ['skill-operations-manager'],
    };

    const salary = computeStaffSalaryCost(getSalaryScopeSkills(member), member.ongoingCost);
    expect(salary).toBe(300);
    expect(chargeLayOff(state, member)).toBe(layOffReputationCost(salary));
    expect(layOffReputationCost(salary)).toBe(300);
  });

  it('clamps the reputation deduction at 0', () => {
    const state = setupMainStreetGame({ seed: 'roster-clamp-zero' });
    state.resourceBank.reputation = 50;
    const member = managementMember('staff-clamp', 500);

    chargeLayOff(state, member);
    expect(state.resourceBank.reputation).toBe(0);
  });
});
