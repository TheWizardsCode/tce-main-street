/**
 * Main Street: Staff Pile membership and tooltip content
 * (MS-0MWBWKZ1G006IBH2).
 *
 * Unit coverage for the two halves of the Staff Pile's derived state:
 *
 *  - **Membership** — `selectManagementCompanyStaff()` is the pile's only
 *    membership rule, and it must agree with the two-type model's canonical
 *    test (`!isBusinessStaffCard`): business staff (an `employedAtSlot` link)
 *    never reach the pile.
 *  - **Tooltip content** — `buildStaffPileTooltip()` summarises the
 *    management company (name, served types, effect, salary) with a member
 *    count and a total weekly salary, and returns `null` so the caller hides
 *    the tooltip when the company employs none.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import { buildStaffPileTooltip } from '../../src/scenes/MainStreetHudTooltips';
import { selectManagementCompanyStaff } from '../../src/MainStreetStaffBuffs';
import { createStaffDeck, type StaffCard } from '../../src/MainStreetCards';
import type { MainStreetState } from '../../src/MainStreetState';

/** A staff fixture: name, salary and (when given) an employer slot. */
function staff(
  name: string,
  ongoingCost: number,
  options: {
    employedAtSlot?: number;
    description?: string;
    types?: readonly string[];
  } = {},
): StaffCard {
  const base = createStaffDeck(1)[0]!;
  return {
    ...base,
    id: `staff-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    ongoingCost,
    description: options.description ?? `${name} effect text.`,
    allowedBusinessTypes: options.types,
    ...(options.employedAtSlot === undefined
      ? { employedAtSlot: undefined }
      : { employedAtSlot: options.employedAtSlot }),
  };
}

/** Minimal state carrier — the builder only reads `staffCards`. */
function stateWith(staffCards: StaffCard[]): MainStreetState {
  return { staffCards } as unknown as MainStreetState;
}

describe('selectManagementCompanyStaff (membership)', () => {
  it('keeps members with no employer slot and drops business staff', () => {
    const manager = staff('Manager', 120);
    const chef = staff('Chef', 90, { employedAtSlot: 2 });
    const accountant = staff('Accountant', 60);

    const selected = selectManagementCompanyStaff([manager, chef, accountant]);

    expect(selected.map(member => member.name)).toEqual(['Manager', 'Accountant']);
  });

  it('returns an empty list for an empty roster', () => {
    expect(selectManagementCompanyStaff([])).toEqual([]);
  });

  it('returns an empty list when every member is business staff', () => {
    const roster = [
      staff('Chef', 90, { employedAtSlot: 0 }),
      staff('Barista', 70, { employedAtSlot: 1 }),
    ];

    expect(selectManagementCompanyStaff(roster)).toEqual([]);
  });
});

describe('buildStaffPileTooltip (management-company summary)', () => {
  it('returns null when the company employs no management-company staff', () => {
    expect(buildStaffPileTooltip(stateWith([]))).toBeNull();
  });

  it('returns null when every hired member is business staff', () => {
    const state = stateWith([staff('Chef', 90, { employedAtSlot: 3 })]);
    expect(buildStaffPileTooltip(state)).toBeNull();
  });

  it('summarises a single member with name, effect, salary and total', () => {
    const state = stateWith([staff('Manager', 120)]);

    const tooltip = buildStaffPileTooltip(state);

    expect(tooltip).not.toBeNull();
    expect(tooltip!).toContain('Management Company Staff');
    expect(tooltip!).toContain('1 on the company payroll');
    expect(tooltip!).toContain('• Manager (Generalist) — Manager effect text.');
    expect(tooltip!).toContain('salary 120');
    expect(tooltip!).toContain('Total salary: 120 per turn');
  });

  it('shows the business types a member serves', () => {
    const state = stateWith([staff('Chef', 90, { types: ['Cafe', 'Food'] })]);

    expect(buildStaffPileTooltip(state)!).toContain('• Chef (Cafe/Food) — Chef effect text.');
  });

  it('lists every member and sums their salaries', () => {
    const state = stateWith([
      staff('Manager', 120),
      staff('Accountant', 60),
      staff('Socialite', 45),
    ]);

    const tooltip = buildStaffPileTooltip(state)!;

    expect(tooltip).toContain('3 on the company payroll');
    for (const name of ['Manager', 'Accountant', 'Socialite']) {
      expect(tooltip).toContain(`• ${name} `);
    }
    expect(tooltip).toContain('Total salary: 225 per turn');
  });

  it('excludes business staff from a mixed roster', () => {
    const state = stateWith([
      staff('Manager', 120),
      staff('Chef', 90, { employedAtSlot: 1 }),
      staff('Accountant', 60),
    ]);

    const tooltip = buildStaffPileTooltip(state)!;

    expect(tooltip).toContain('2 on the company payroll');
    expect(tooltip).toContain('• Manager ');
    expect(tooltip).toContain('• Accountant ');
    expect(tooltip).not.toContain('Chef');
    // Business staff salaries are charged against their business, not the
    // company payroll.
    expect(tooltip).toContain('Total salary: 180 per turn');
  });

  it('reuses the shared member formatter, including the Investor re-roll note', () => {
    const investorBase = createStaffDeck(1).find(
      (card): card is StaffCard => card.name === 'Investor',
    );
    if (!investorBase) return; // deck without an Investor — nothing to assert
    const investor: StaffCard = {
      ...investorBase,
      id: 'staff-investor-0',
      ongoingCost: 150,
      freeMarketRerollPerTurn: true,
    };

    const tooltip = buildStaffPileTooltip(stateWith([investor]))!;

    expect(tooltip).toContain('free re-roll available this turn');
    expect(tooltip).toContain('75% relevance bias');
  });
});
