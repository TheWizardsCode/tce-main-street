/**
 * Main Street: unassigned business-staff classification
 * (MS-0MWEWICJY004TT47, parent MS-0MWE64C6B002V3SO).
 *
 * Deterministic test-first spec for the display classification correction
 * (Q3-A): a hired-but-unassigned business-staff member (business card type,
 * **no** `employedAtSlot`) is **never** presented as management-company
 * staff. The management-company roster and Staff Pile list management-company
 * staff only; unassigned business staff surface in an explicit *unassigned
 * business staff* group (with the assign affordance); employed business staff
 * keep appearing on their business exactly as today. Effect semantics stay
 * keyed on `employedAtSlot`, so the classification change is display-only:
 * an unassigned member still receives no business-scope benefit while its
 * salary is charged (Q2-B — pinned here as the unchanged guard).
 *
 * ## Red → green phase (repo tracer-bullet convention)
 *
 * See `income-owner-flight-routing.test.ts` / `hud-total-counting.test.ts`.
 * `isBusinessStaffCard` remains keyed on `employedAtSlot` for **effect**
 * aggregation, but every display surface (roster, Staff Pile, tooltip) now
 * classifies by **card type** (`staffCardScope`) — the flip this child
 * (MS-0MWEWIJGU005FWYI) landed, turning the formerly-red classification
 * cases below into plain guards. The management-company roster and Staff
 * Pile list management-company staff only, unassigned business staff surface
 * in the roster's explicit group, employed business staff stay on their
 * business, and leaving one of these guards red (or removing it) fails the
 * suite.
 *
 * @module tests/main-street/staff-unassigned-classification
 */

import { describe, it, expect } from 'vitest';

import {
  setupMainStreetGame,
  serializeMainStreetState,
  deserializeMainStreetState,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  executeWeekStart,
  canPlaceStaffOnBusiness,
  getEmployedStaffCountAt,
  applyStaffOngoingCosts,
} from '../../src/MainStreetEngine';
import { applyIncome } from '../../src/MainStreetAdjacency';
import { createStaffDeck, type StaffCard, type BusinessCard } from '../../src/MainStreetCards';
import { staffCardScope } from '../../src/MainStreetStaffSkills';
import { selectManagementCompanyStaff } from '../../src/MainStreetStaffBuffs';
import { buildCompanyRoster, companyRosterIsEmpty } from '../../src/MainStreetRoster';
import { buildStaffPileTooltip } from '../../src/scenes/MainStreetHudTooltips';
import { buildBusinessStaffRows } from '../../src/MainStreetBusinessStaff';

// ── Fixtures ────────────────────────────────────────────────

let serial = 0;

/**
 * A staff member built from a shipped template: `idPrefix` selects the
 * template (`staff-chef` = business, `staff-assistant` = management-company);
 * `extra` can carry an assignment (e.g. `{ employedAtSlot: 0 }`).
 */
function member(idPrefix: string, extra: Partial<StaffCard> = {}): StaffCard {
  const tpl = createStaffDeck(1).find(c => c.id.startsWith(idPrefix));
  if (!tpl) throw new Error(`staff template ${idPrefix} not found`);
  return {
    ...tpl,
    id: `${tpl.id}-c${serial++}`,
    specializationSkillIds: [],
    ...extra,
  };
}

/** Minimal roster carrier — the classification model reads only `staffCards`. */
function stateWith(...cards: StaffCard[]): MainStreetState {
  return { staffCards: cards } as unknown as MainStreetState;
}

/** Places a business fixture at a slot (income caches resolved manually). */
function placeBusinessAt(
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
    description: 'Classification fixture.',
    ongoingCost: 0,
    employedStaff: [],
  };
  biz.currentIncome = baseIncome;
  biz.currentReputationPerTurn = 0;
  state.streetGrid[slot] = biz;
  return biz;
}

/** Fresh single-player state with the day started. */
function freshState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  return state;
}

// ── The card-type rule (already holds — plain guards) ───────

describe('card type is the classification rule (staffCardScope)', () => {
  it('an unassigned business-staff member is business staff', () => {
    expect(staffCardScope(member('staff-chef'))).toBe('business');
    expect(staffCardScope(member('staff-delivery'))).toBe('business');
  });

  it('an unassigned management-company member is management-company staff', () => {
    expect(staffCardScope(member('staff-assistant'))).toBe('management-company');
  });

  it('an employed member is business staff by its slot', () => {
    expect(staffCardScope(member('staff-chef', { employedAtSlot: 2 }))).toBe('business');
  });
});

// ── Management-company surfaces never present unassigned business staff (red-phase) ──

describe('management-company surfaces list management-company staff only (MS-0MWEWIJGU005FWYI)', () => {
  it('selectManagementCompanyStaff excludes an unassigned business-staff member', () => {
    const chef = member('staff-chef');
    expect(selectManagementCompanyStaff([chef])).toEqual([]);
  });

  it('buildCompanyRoster lists management-company staff only', () => {
    const chef = member('staff-chef'); // unassigned business staff
    const assistant = member('staff-assistant'); // management-company

    const roster = buildCompanyRoster(stateWith(chef, assistant));

    expect(roster.rows.map(r => r.memberId)).toEqual([assistant.id]);
    expect(roster.count).toBe(1);
  });

  it('buildStaffPileTooltip shows no payroll when only unassigned business staff are hired', () => {
    expect(buildStaffPileTooltip(stateWith(member('staff-chef')))).toBeNull();
  });

  it('buildStaffPileTooltip counts management-company staff only', () => {
    const chef = member('staff-chef');
    const assistant = member('staff-assistant');

    const tooltip = buildStaffPileTooltip(stateWith(chef, assistant))!;

    expect(tooltip).toContain('1 on the company payroll');
    expect(tooltip).not.toContain('Chef');
  });

  it('companyRosterIsEmpty is true when only unassigned business staff are hired', () => {
    expect(companyRosterIsEmpty(stateWith(member('staff-chef')))).toBe(true);
  });

  it('an unassigned Investor (business card type, GDD D.4.2) never reaches the management-company surfaces', () => {
    // The Investor is one of the 17 business-staff cards (handSlotsAdded = 0);
    // hired but never placed, it must not appear on the company roster or the
    // Staff Pile — the format-level re-roll note is a business-slot concern.
    const investor = member('staff-investor');
    const assistant = member('staff-assistant');

    expect(staffCardScope(investor)).toBe('business');
    expect(selectManagementCompanyStaff([investor, assistant]).map(c => c.id)).toEqual([assistant.id]);
    const roster = buildCompanyRoster(stateWith(investor, assistant));
    expect(roster.rows.map(r => r.memberId)).toEqual([assistant.id]);
    expect(roster.unassignedBusinessStaff.map(r => r.memberId)).toEqual([investor.id]);
    expect(buildStaffPileTooltip(stateWith(investor))).toBeNull();
  });
});

// ── The explicit unassigned business staff group ────────────

describe('the explicit *unassigned business staff* group', () => {
  it('derives exactly the unassigned business-scope members (disjoint from the roster)', () => {
    const chef = member('staff-chef'); // business, unassigned
    const baker = member('staff-baker', { employedAtSlot: 1 }); // business, employed
    const assistant = member('staff-assistant'); // management-company

    const group = [chef, baker, assistant].filter(
      c => staffCardScope(c) === 'business' && c.employedAtSlot === undefined,
    );

    expect(group.map(c => c.id)).toEqual([chef.id]);
  });

  it('buildCompanyRoster surfaces the group, disjoint from the management-company rows', () => {
    const state = freshState('classify-model-group');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const chef = member('staff-chef'); // business, unassigned
    const baker = member('staff-baker', { employedAtSlot: 0 }); // business, employed
    const assistant = member('staff-assistant'); // management-company
    state.staffCards = [chef, baker, assistant];

    const roster = buildCompanyRoster(state);

    // The group is exactly the unassigned business staff; the management-company
    // rows hold exactly the management-company member.
    expect(roster.rows.map(r => r.memberId)).toEqual([assistant.id]);
    expect(roster.unassignedBusinessStaff.map(r => r.memberId)).toEqual([chef.id]);
    // The group rows carry the lay-off / role data the assign affordance needs.
    const [row] = roster.unassignedBusinessStaff;
    expect(row.staffIndex).toBe(0);
    expect(row.name).toBe(chef.name);
    expect(row.layOffCoins).toBe(row.salary);
    expect(row.salary).toBeGreaterThan(0);
    expect(row.roleSummary.length).toBeGreaterThan(0);
    // The management-company footer totals stay management-company only.
    expect(roster.count).toBe(1);
    expect(roster.totalSalary).toBe(roster.rows[0].salary);
  });

  it('an employed business member never appears in the group', () => {
    const state = freshState('classify-model-employed');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const baker = member('staff-baker', { employedAtSlot: 0 });
    state.staffCards = [baker];

    const roster = buildCompanyRoster(state);

    expect(roster.unassignedBusinessStaff).toEqual([]);
    expect(roster.rows).toEqual([]);
  });

  it('every unassigned member in the group is assignable through the shared predicate', () => {
    const state = freshState('classify-group-assignable');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const chef = member('staff-chef');
    state.staffCards = [chef];

    // Unassigned (no slot yet) — and assignable to the matching business.
    expect(state.staffCards[0].employedAtSlot).toBeUndefined();
    expect(canPlaceStaffOnBusiness(state, chef.id, 0).legal).toBe(true);
  });

  it('unassigned members never appear as employed rows on any business (Manage Card is employment-keyed)', () => {
    const state = freshState('classify-rows');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const chef = member('staff-chef'); // unassigned
    const baker = member('staff-baker', { employedAtSlot: 0 }); // employed at slot 0
    state.staffCards = [chef, baker];

    const rows = buildBusinessStaffRows(state, 0).map(r => r.memberId);
    expect(rows).toEqual([baker.id]);
    expect(rows).not.toContain(chef.id);
  });
});

// ── Q2-B: no benefits while unassigned, salary still charged ──

describe('an unassigned business-staff member: no benefits, salary still charged (Q2-B)', () => {
  function incomeBySlot(state: MainStreetState): Map<number, number> {
    const income = applyIncome(state);
    return new Map(income.breakdown.map(slot => [slot.slotIndex, slot.total]));
  }

  it('receives no business-scope income buff while unassigned', () => {
    const state = freshState('classify-no-buff');
    placeBusinessAt(state, 0, 'Cafe', ['Food'], 10);
    const chef = member('staff-chef'); // +20% own-business income when employed
    state.staffCards = [chef];

    expect(incomeBySlot(state).get(0)).toBeCloseTo(10);
  });

  it('is still charged its salary (ongoing cost) while unassigned', () => {
    const state = freshState('classify-salary');
    const chef = member('staff-chef'); // ongoing cost 100
    state.staffCards = [chef];
    const coinsBefore = state.resourceBank.coins;

    const delta = applyStaffOngoingCosts(state);

    expect(delta).toBe(-100);
    expect(state.resourceBank.coins).toBe(coinsBefore - 100);
  });
});

// ── Backward-compatible loads (red-phase surface half) ──────

describe('legacy saves with unassigned business staff (backward compatibility)', () => {
  it('load unchanged, stay assignable, and are never reclassified as management-company', () => {
    const state = freshState('classify-legacy-load');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const chef = member('staff-chef');
    state.staffCards = [chef];

    const payload = serializeMainStreetState(state) as unknown as Record<string, unknown>;
    // A pre-assign-later save never carried `employedAtSlot` on the member.
    for (const card of payload.staffCards as Array<Record<string, unknown>>) {
      delete card.employedAtSlot;
    }

    const restored = deserializeMainStreetState(
      payload as unknown as ReturnType<typeof serializeMainStreetState>,
    );
    const loaded = restored.staffCards.find(c => c.id === chef.id)!;

    // Loads unchanged — never silently placed, cleared or deleted…
    expect(loaded.employedAtSlot).toBeUndefined();
    expect(getEmployedStaffCountAt(restored, 0)).toBe(0);
    // …stays assignable…
    expect(canPlaceStaffOnBusiness(restored, loaded.id, 0).legal).toBe(true);
    // …and is never reclassified: the roster must not list it as
    // management-company staff, and the explicit group must carry it instead.
    expect(buildCompanyRoster(restored).rows.map(r => r.memberId)).not.toContain(loaded.id);
    expect(buildCompanyRoster(restored).unassignedBusinessStaff.map(r => r.memberId)).toEqual([loaded.id]);
  });
});
