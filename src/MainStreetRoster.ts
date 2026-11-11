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
 * isolation. Data comes from `state.staffCards`; membership is the canonical
 * `!isBusinessStaffCard()` test, never a card-name list. Salaries resolve
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
  isBusinessStaffCard,
} from './MainStreetStaffBuffs';
import { formatStaffRoleSummary } from './MainStreetFormatting';

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

/** The derived company roster: its rows plus the footer totals. */
export interface CompanyRoster {
  /** Management-company members, oldest hire first. */
  rows: CompanyRosterRow[];
  /** `rows.length` — the roster footer member count. */
  count: number;
  /** Sum of every row's salary — the roster footer per-turn salary total. */
  totalSalary: number;
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
 * Builds the company roster from game state: every management-company staff
 * member (`!isBusinessStaffCard`) exactly once, in staff-hire order (oldest
 * first), with the exact salary and lay-off costs the engine will charge.
 *
 * `totalSalary` is the sum of the row salaries (not re-derived), so the footer
 * can never disagree with the rows.
 *
 * @param state Current game state (read-only).
 * @returns The roster rows plus the footer count and salary total.
 */
export function buildCompanyRoster(state: MainStreetState): CompanyRoster {
  const rows: CompanyRosterRow[] = [];
  state.staffCards.forEach((member, staffIndex) => {
    if (isBusinessStaffCard(member)) return;
    const salary = resolveSalary(member);
    rows.push({
      memberId: member.id,
      staffIndex,
      name: member.name,
      roleSummary: formatStaffRoleSummary(member),
      salary,
      layOffCoins: salary,
      layOffReputation: layOffReputationCost(salary),
    });
  });
  const totalSalary = rows.reduce((sum, row) => sum + row.salary, 0);
  return { rows, count: rows.length, totalSalary };
}

/**
 * Reports whether the management-company team is empty (no management-company
 * members in `state.staffCards`, regardless of business staff).
 *
 * @param state Current game state (read-only).
 */
export function companyRosterIsEmpty(state: MainStreetState): boolean {
  return !state.staffCards.some((card) => !isBusinessStaffCard(card));
}
