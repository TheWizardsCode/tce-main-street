/**
 * MainStreetPedestrians — pure helper for pedestrian population.
 *
 * Derives the on-street pedestrian figure count from the player's reputation
 * using a simple ratio.  This module is **pure**: it imports nothing from the
 * animator, scene, game state, or economy layers so it can never mutate state
 * or consume RNG.
 *
 * @module
 */

// ── Named constants ────────────────────────────────────────────────

/**
 * Reputation points required per pedestrian figure.
 *
 * The count is `floor(reputation / PEDESTRIAN_REP_RATIO)`, floored at 0 and
 * uncapped (producer decision: no hard cap on crowd density).
 */
export const PEDESTRIAN_REP_RATIO = 50;

/**
 * Reputation blue — the solid-colour used for pedestrian silhouettes on the
 * street, matching the existing reputation visual language.
 */
export const PEDESTRIAN_COLOR = '#88bbff';

// ── Pure helper ────────────────────────────────────────────────────

/**
 * Derive the pedestrian figure count from reputation.
 *
 * @param reputation — the player's current reputation score.
 * @returns `floor(reputation / 50)` floored at 0; returns 0 for negative,
 *          NaN, or non-finite inputs.
 */
export function pedestrianCount(reputation: number): number {
  if (!Number.isFinite(reputation) || reputation < 0) {
    return 0;
  }
  return Math.floor(reputation / PEDESTRIAN_REP_RATIO);
}
