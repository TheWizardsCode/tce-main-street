/**
 * Main Street: Company Roster
 *
 * Pure, engine-facing helpers for the company-roster overlay
 * (MS-0MWC1T8K2000DWZA). The roster lists the player's management-company
 * staff and quotes the exact cost of letting one go, so this module owns the
 * lay-off economics the overlay and the engine must agree on.
 *
 * This module has **no Phaser imports** — the model is unit-testable in
 * isolation. The row/`buildCompanyRoster()` model lands in the sibling item;
 * this file currently exports only the lay-off reputation rule.
 *
 * @module
 */

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
