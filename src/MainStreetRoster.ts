/**
 * Main Street: Company Roster
 *
 * Pure, engine-facing model for the company-roster overlay
 * (MS-0MWC1T8K2000DWZA). The roster lists the player's management-company
 * staff and quotes the exact cost of letting one go, so this module owns the
 * lay-off economics and the row/total derivation the overlay and the engine
 * must agree on.
 *
 * This module has **no Phaser imports** — the model is unit-testable in
 * isolation. Data comes from `state.staffCards`; membership is the
 * card-type rule (`staffCardScope`), never a card-name list or an
 * `employedAtSlot`-presence test — a hired-but-unassigned business-staff
 * member (business template, no `employedAtSlot`) is never presented as
 * management-company staff and surfaces in the explicit *unassigned
 * business staff* group instead (MS-0MWEWIJGU005FWYI). Salaries resolve
 * through `computeStaffSalaryCost(getSalaryScopeSkills(member), …)` so a row
 * can never quote a UI-invented figure.
 *
 * @module
 */

import type { StaffCard } from './MainStreetCards';
import type { MainStreetState } from './MainStreetState';
import {
  computeStaffSalaryCost,
  getSalaryScopeSkills,
} from './MainStreetStaffBuffs';
import { staffCardScope } from './MainStreetStaffSkills';
import { formatStaffRoleSummary } from './MainStreetFormatting';
import { formatCoins } from './scenes/MainStreetLoanRowModel';

/**
 * One row of the company roster: a management-company staff member and the
 * exact figures for describing and releasing them.
 */
export interface CompanyRosterRow {
  /** The member's card id (stable across a lay-off re-index). */
  memberId: string;
  /** The member's live index in `state.staffCards` (handed to `letGoStaffCommand`). */
  staffIndex: number;
  /** The member's display name. */
  name: string;
  /** Role/benefit summary — shared with the tooltip formatters so text cannot drift. */
  roleSummary: string;
  /** Effective per-turn salary (skill discounts applied), clamped at 0. */
  salary: number;
  /** Coins charged to let the member go: one turn's salary, clamped at 0. */
  layOffCoins: number;
  /** Reputation charged to let the member go (see {@link layOffReputationCost}). */
  layOffReputation: number;
}

/**
 * One row of the explicit *unassigned business staff* group: a business-staff
 * member (business card type) hired but never assigned (no `employedAtSlot`).
 *
 * Carries the same name/role/salary/lay-off figures as a `CompanyRosterRow`
 * plus the member identity the assign affordance needs: the overlay hands the
 * `memberId` to the shared `buildMoveStaffAffordance` (which accepts unplaced
 * members) to derive the legal destinations and runs the free initial
 * assignment through `placeStaffOnBusinessCommand` (MS-0MWEWIJGU005FWYI).
 */
export interface UnassignedBusinessStaffRow {
  /** The member's card id (stable across a lay-off re-index). */
  memberId: string;
  /** The member's live index in `state.staffCards` (handed to `letGoStaffCommand`). */
  staffIndex: number;
  /** The member's display name. */
  name: string;
  /** Role/benefit summary — shared with the tooltip formatters so text cannot drift. */
  roleSummary: string;
  /** Effective per-turn salary (skill discounts applied), clamped at 0. */
  salary: number;
  /** Coins charged to let the member go: one turn's salary, clamped at 0. */
  layOffCoins: number;
  /** Reputation charged to let the member go (see {@link layOffReputationCost}). */
  layOffReputation: number;
}

/** The derived company roster: its rows plus the footer totals and the unassigned group. */
export interface CompanyRoster {
  /** Management-company members, oldest hire first. */
  rows: CompanyRosterRow[];
  /** `rows.length` — the roster footer member count. */
  count: number;
  /** Sum of every row's salary — the roster footer per-turn salary total. */
  totalSalary: number;
  /**
   * The explicit *unassigned business staff* group: hired business-staff
   * members never placed (no `employedAtSlot`), oldest hire first. Never part
   * of `rows`, so they are never presented as management-company staff.
   */
  unassignedBusinessStaff: UnassignedBusinessStaffRow[];
}

/**
 * Reputation charged for letting a staff member go, scaled to their per-turn
 * salary (MS-0MWC1T8K2000DWZA).
 *
 * GDD D.4.2 §5 states that a lay-off costs "1 reputation". Reputation ships
 * in ×100 display units — starting pools are 200/300/500 by difficulty and
 * hand discard already deducts the card's coin `cost` from reputation — so
 * that pre-scale "1" is the **100-unit floor** of this formula. Each further
 * 100 coins of salary adds another 100 reputation:
 *
 * ```
 * max(100, ceil(salary / 100) × 100)
 * ```
 *
 * Boundary values: salary 0–100 → 100, 150 → 200, 250 → 300, 400 → 400,
 * 500 → 500. The same rule applies to every lay-off door, because every door
 * funnels through `letGoStaffMember()`.
 *
 * @param salary Effective per-turn salary, already resolved through
 *               `computeStaffSalaryCost` (so skill discounts apply).
 * @returns Reputation to deduct; always at least 100.
 */
export function layOffReputationCost(salary: number): number {
  return Math.max(100, Math.ceil(salary / 100) * 100);
}

/** Resolves a member's effective per-turn salary through the engine helpers. */
function resolveSalary(member: StaffCard): number {
  return computeStaffSalaryCost(getSalaryScopeSkills(member), member.ongoingCost);
}

/**
 * Builds one roster row (management-company member or unassigned business
 * staff) with the exact salary and lay-off costs the engine will charge.
 */
function buildRosterRow(member: StaffCard, staffIndex: number): CompanyRosterRow {
  const salary = resolveSalary(member);
  return {
    memberId: member.id,
    staffIndex,
    name: member.name,
    roleSummary: formatStaffRoleSummary(member),
    salary,
    layOffCoins: salary,
    layOffReputation: layOffReputationCost(salary),
  };
}

/**
 * Builds the company roster from game state.
 *
 * Two sections, both classified by **card type** (`staffCardScope`), never by
 * `employedAtSlot` presence (MS-0MWEWIJGU005FWYI):
 *
 * - `rows` — every management-company member exactly once, in staff-hire
 *   order (oldest first). A hired-but-unassigned business-staff member never
 *   reaches this list, so the management-company roster can never present one
 *   as company staff.
 * - `unassignedBusinessStaff` — the explicit *unassigned business staff*
 *   group: business-template members with no `employedAtSlot`, oldest hire
 *   first, carrying the lay-off figures and the member identity the assign
 *   affordance needs.
 *
 * `totalSalary` is the sum of the management-company row salaries (not
 * re-derived), so the footer can never disagree with the rows; the unassigned
 * group's salaries are quoted per row and kept out of the company payroll
 * total.
 *
 * @param state Current game state (read-only).
 * @returns The roster rows plus the footer count, salary total and the
 *          unassigned-business-staff group.
 */
export function buildCompanyRoster(state: MainStreetState): CompanyRoster {
  const rows: CompanyRosterRow[] = [];
  const unassignedBusinessStaff: UnassignedBusinessStaffRow[] = [];
  state.staffCards.forEach((member, staffIndex) => {
    if (staffCardScope(member) === 'management-company') {
      rows.push(buildRosterRow(member, staffIndex));
    } else if (member.employedAtSlot == null) {
      // Business card type, never placed → the explicit unassigned group.
      unassignedBusinessStaff.push(buildRosterRow(member, staffIndex));
    }
  });
  const totalSalary = rows.reduce((sum, row) => sum + row.salary, 0);
  return { rows, count: rows.length, totalSalary, unassignedBusinessStaff };
}

/**
 * Reports whether the management-company team is empty (no management-company
 * members in `state.staffCards`, regardless of business staff — including
 * hired-but-unassigned business staff, who belong to the explicit unassigned
 * group, not the company).
 *
 * @param state Current game state (read-only).
 */
export function companyRosterIsEmpty(state: MainStreetState): boolean {
  return !state.staffCards.some((card) => staffCardScope(card) === 'management-company');
}

/**
 * The confirm step's copy for letting a staff member go: a title quoting the
 * member's name and a body quoting one turn's salary (coins) and the exact
 * reputation cost.
 *
 * Shared by both lay-off doors — the business-staff rows
 * ({@link module:MainStreetBusinessStaff}) and the Company Roster — so the
 * quoted figures and the copy are never duplicated, and the arithmetic always
 * comes from the row the engine will actually charge against
 * (MS-0MWCB2Z20006R9FA).
 */
export interface LayOffConfirmContent {
  /** Confirm step title, e.g. `Lay off Jane?`. */
  readonly title: string;
  /** Body lines quoting one turn's salary in coins and its reputation cost. */
  readonly body: string;
}

/**
 * Builds the confirm step's title and body quoting the member's name, one
 * turn's salary in coins (already clamped at 0 in the row) and the reputation
 * cost — read from the row itself, never recomputed here. Both lay-off doors
 * funnel through this one implementation so their copy cannot drift.
 *
 * @param row The member's row (name + exact lay-off figures).
 * @returns The confirm step's title and body lines.
 */
export function buildLayOffConfirmContent(row: {
  readonly name: string;
  readonly layOffCoins: number;
  readonly layOffReputation: number;
}): LayOffConfirmContent {
  return {
    title: `Lay off ${row.name}?`,
    body: `One turn's salary: ${formatCoins(row.layOffCoins)}\nReputation: −${row.layOffReputation}`,
  };
}
