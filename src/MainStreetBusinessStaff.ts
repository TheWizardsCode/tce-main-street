/**
 * Main Street: Business Staff Rows (pure model)
 *
 * The single home of the Manage Card's per-member rows for one business slot
 * (MS-0MWC952QU000HQ11 / MS-0MWCB2Z20006R9FA): slot membership, hire-order
 * rows, salary/role text, lay-off figures and mobility — built here once, so
 * what the Manage Card shows is the engine's own arithmetic and never a
 * UI-invented figure.
 *
 * This module has **no Phaser imports** — the model is unit-testable in
 * isolation. Data comes from `state.staffCards`; membership is the canonical
 * `employedAtSlot` link (the two-type model's runtime determinant — a present
 * slot means business staff), never a card-name list. Salaries resolve
 * through `computeStaffSalaryCost(getSalaryScopeSkills(member), …)` so a row
 * can never quote a UI-invented figure, lay-off figures come from the shared
 * roster economics (`layOffReputationCost`), and mobility is read from the
 * shared `buildMoveStaffAffordance` — nothing is re-derived here.
 *
 * @module
 */

import type { MainStreetState } from './MainStreetState';
import type { StaffCard } from './MainStreetCards';
import {
  computeStaffSalaryCost,
  getSalaryScopeSkills,
} from './MainStreetStaffBuffs';
import { formatStaffRoleSummary } from './MainStreetFormatting';
import { layOffReputationCost } from './MainStreetRoster';
import { buildMoveStaffAffordance } from './scenes/MainStreetHudTooltips';

/**
 * One row of a business's staff: an employed member and the exact figures
 * for describing, moving and releasing them.
 *
 * The row's layout mirrors `CompanyRosterRow` (the Company Roster's row
 * shape) and adds the move affordance fields the Manage Card needs; the
 * role/salary/lay-off figures come from the same shared helpers, so the two
 * rosters can never disagree with the engine or with each other.
 */
export interface BusinessStaffRow {
  /** The member's card id (stable across a lay-off / move re-index). */
  readonly memberId: string;
  /** The member's display name. */
  readonly name: string;
  /** Role/benefit summary — shared with the tooltip formatter. */
  readonly roleSummary: string;
  /** Effective per-turn salary (skill discounts applied), clamped at 0. */
  readonly salary: number;
  /** Coins charged to let the member go: one turn's salary, clamped at 0. */
  readonly layOffCoins: number;
  /** Reputation charged to let the member go (see `layOffReputationCost`). */
  readonly layOffReputation: number;
  /** True when the member can be relocated right now (shared affordance). */
  readonly moveEnabled: boolean;
  /** Legal destination street-grid slots for a relocation (shared affordance). */
  readonly moveDestinations: readonly number[];
}

/** Resolves a member's effective per-turn salary through the engine helpers. */
function resolveSalary(member: StaffCard): number {
  return computeStaffSalaryCost(getSalaryScopeSkills(member), member.ongoingCost);
}

/**
 * Builds the business staff rows for one street-grid slot: every member
 * employed at that slot (`employedAtSlot === slotIndex`) exactly once, in
 * hire order (oldest first — `state.staffCards` order), with the exact salary
 * and lay-off costs the engine will charge and the move affordance the Manage
 * Card presents.
 *
 * Management-company staff (no `employedAtSlot`) and members employed at a
 * different slot never appear — membership is the slot link itself, so the
 * row list can never drift from the engine's employment model.
 *
 * @param state     Current game state (read-only).
 * @param slotIndex The street-grid slot whose staff rows to build.
 * @returns One row per member employed at the slot, in hire order.
 */
export function buildBusinessStaffRows(
  state: MainStreetState,
  slotIndex: number,
): BusinessStaffRow[] {
  const rows: BusinessStaffRow[] = [];
  (state.staffCards ?? []).forEach((member) => {
    if (member.employedAtSlot !== slotIndex) return;
    const salary = resolveSalary(member);
    const affordance = buildMoveStaffAffordance(state, member.id);
    rows.push({
      memberId: member.id,
      name: member.name,
      roleSummary: formatStaffRoleSummary(member),
      salary,
      layOffCoins: Math.max(0, salary),
      layOffReputation: layOffReputationCost(salary),
      moveEnabled: affordance.enabled,
      moveDestinations: affordance.destinationSlots,
    });
  });
  return rows;
}

/**
 * Reports whether the given business slot employs nobody (no member has
 * `employedAtSlot === slotIndex`), regardless of other staff.
 *
 * @param state     Current game state (read-only).
 * @param slotIndex The street-grid slot to test.
 */
export function businessStaffIsEmpty(state: MainStreetState, slotIndex: number): boolean {
  return !(state.staffCards ?? []).some((member) => member.employedAtSlot === slotIndex);
}

/**
 * The confirm step's copy for letting a business-staff member go — shared
 * with the Company Roster's confirm step via {@link module:MainStreetRoster}.
 *
 * @param row The member's business-staff row (name + exact lay-off figures).
 */
export { buildLayOffConfirmContent } from './MainStreetRoster';
