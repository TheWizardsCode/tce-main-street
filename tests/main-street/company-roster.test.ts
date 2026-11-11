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

// ── Roster model ───────────────────────────────────────────

import { buildCompanyRoster, companyRosterIsEmpty } from '../../src/MainStreetRoster';

/** A business-staff member (employed at a slot) with a given salary. */
function businessMember(id: string, ongoingCost: number, slot = 0): StaffCard {
  return {
    ...managementMember(id, ongoingCost),
    employedAtSlot: slot,
  };
}

describe('buildCompanyRoster: membership and ordering', () => {
  it('includes every management-company member once and excludes business staff', () => {
    const state = setupMainStreetGame({ seed: 'roster-membership' });
    state.staffCards = [
      managementMember('mgmt-a', 100),
      businessMember('biz-b', 200),
      managementMember('mgmt-c', 250),
    ];

    const roster = buildCompanyRoster(state);

    expect(roster.rows.map((r) => r.memberId)).toEqual(['mgmt-a', 'mgmt-c']);
    expect(roster.rows.some((r) => r.memberId === 'biz-b')).toBe(false);
    expect(roster.count).toBe(2);
  });

  it('keeps staff-hire order (oldest first) stable after a mid-list lay-off', () => {
    const state = setupMainStreetGame({ seed: 'roster-order' });
    state.staffCards = [
      managementMember('mgmt-a', 100),
      businessMember('biz-b', 200),
      managementMember('mgmt-c', 250),
      managementMember('mgmt-d', 500),
    ];
    expect(buildCompanyRoster(state).rows.map((r) => r.memberId)).toEqual([
      'mgmt-a',
      'mgmt-c',
      'mgmt-d',
    ]);

    // Lay off the middle management member (live index 2).
    letGoStaffMember(state, 2);

    const reordered = buildCompanyRoster(state);
    expect(reordered.rows.map((r) => r.memberId)).toEqual(['mgmt-a', 'mgmt-d']);
    // staffIndex stays the member's live index in state.staffCards.
    expect(reordered.rows.map((r) => r.staffIndex)).toEqual([0, 2]);
  });
});

describe('buildCompanyRoster: salaries, costs and totals', () => {
  it('resolves each row salary through the engine helpers (cross-type skill inert)', () => {
    const state = setupMainStreetGame({ seed: 'roster-salary' });
    state.staffCards = [
      // The Operations Manager discount is business-scoped, so it stays inert
      // for a management-company member: salary = ongoingCost = 300.
      { ...managementMember('mgmt-ops', 300), specializationSkillIds: ['skill-operations-manager'] },
      managementMember('mgmt-cheap', 50),
    ];

    const [first] = buildCompanyRoster(state).rows;
    expect(first.salary).toBe(300);
    expect(first.layOffCoins).toBe(300);
    expect(first.layOffReputation).toBe(300);
  });

  it('quotes layOffCoins as the salary and layOffReputation from the formula', () => {
    const state = setupMainStreetGame({ seed: 'roster-costs' });
    state.staffCards = [
      managementMember('mgmt-zero', 0),
      managementMember('mgmt-mid', 150),
      managementMember('mgmt-high', 500),
    ];

    const rows = buildCompanyRoster(state).rows;
    for (const row of rows) {
      expect(row.layOffCoins).toBe(row.salary);
      expect(row.layOffReputation).toBe(layOffReputationCost(row.salary));
    }
    expect(rows.map((r) => r.layOffReputation)).toEqual([100, 200, 500]);
  });

  it('footer count and totalSalary agree with the rows', () => {
    const state = setupMainStreetGame({ seed: 'roster-totals' });
    state.staffCards = [
      managementMember('mgmt-a', 100),
      businessMember('biz-b', 999),
      managementMember('mgmt-c', 250.5),
    ];

    const roster = buildCompanyRoster(state);
    expect(roster.count).toBe(roster.rows.length);
    expect(roster.totalSalary).toBe(350.5);
  });

  it('shows the shared role/benefit summary in each row', () => {
    const state = setupMainStreetGame({ seed: 'roster-role' });
    const member: StaffCard = {
      ...managementMember('mgmt-role', 100),
      // A description the shared formatter must surface verbatim.
      description: 'Adds +2 hand slots.',
    };
    state.staffCards = [member];

    const [row] = buildCompanyRoster(state).rows;
    expect(row.roleSummary).toContain('Adds +2 hand slots.');
    expect(row.name).toBe('mgmt-role');
  });
});

describe('companyRosterIsEmpty', () => {
  it('is true with no staff at all', () => {
    const state = setupMainStreetGame({ seed: 'roster-empty-none' });
    state.staffCards = [];
    expect(companyRosterIsEmpty(state)).toBe(true);
    expect(buildCompanyRoster(state)).toMatchObject({ rows: [], count: 0, totalSalary: 0 });
  });

  it('is true when only business staff are employed', () => {
    const state = setupMainStreetGame({ seed: 'roster-empty-business' });
    state.staffCards = [businessMember('biz-only', 200)];
    expect(companyRosterIsEmpty(state)).toBe(true);
    expect(buildCompanyRoster(state).count).toBe(0);
  });

  it('is false when a management-company member is employed', () => {
    const state = setupMainStreetGame({ seed: 'roster-empty-mgmt' });
    state.staffCards = [managementMember('mgmt-only', 100)];
    expect(companyRosterIsEmpty(state)).toBe(false);
  });
});
