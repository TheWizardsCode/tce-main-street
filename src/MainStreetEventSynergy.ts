/**
 * Main Street: Resolution-time event synergy targeting
 *
 * Single source of truth for the synergy a `SpecificSynergy` event matches
 * at resolution time (MS-0MVCS8A0L0000H7X). The live payout
 * ({@link resolveEvent} / `applyCompetitiveEventEffects`), the deferred path,
 * the AI/projection paths (`projectEventCoinDelta`,
 * `computeCompetitiveEventValue`, `scoreEventAction`), the piggyback reward
 * projection and the income-animation attribution
 * (`attachUpcomingDeltas`) all resolve their targets through
 * {@link eventSynergyTargets}, so a projection can never diverge from the
 * payout.
 *
 * This module is a **leaf**: it imports only types, so every consumer can
 * depend on it without introducing an import cycle.
 *
 * @module
 */

import type { EventCard, SynergyType } from './MainStreetCards';
import type { MainStreetState } from './MainStreetState';

/**
 * The synergy targets a `SpecificSynergy` event matches at resolution time.
 *
 * Grand Opening Sale (`evt-grand-opening`) is the one DYNAMIC-synergy event
 * (Feature 2, MS-0MVCS7LIA003J2SM): it pays out against the synergy of the
 * card placed THIS turn — `placedSynergiesThisTurn` (Feature 1 state model,
 * MS-0MVCS1NOH0074YY2) — instead of its static CSV `targetSynergy: Commerce`
 * (which remains in card-data.csv; the override is a resolution-time id
 * check, AC5).
 *
 * Union semantics (AC2): a placed `Food|Culture` card makes the event match
 * ANY grid card sharing Food OR Culture, once each — mirroring the per-card
 * `synergyTypes.includes(...)` check the existing code applies to the static
 * target. Community-space placements populate the same driving field as
 * business placements, so they select the payout synergy symmetrically (AC3).
 *
 * All OTHER `SpecificSynergy` events (festival, rainy, …) keep their static
 * single `targetSynergy` — zero behaviour change (AC6). Falls back to the
 * static target if the override is armed but no placement synergy was
 * recorded (defensive; the same-turn placement gate normally guarantees one).
 *
 * @param state Current game state (read-only).
 * @param event The `SpecificSynergy` event being resolved / projected.
 * @returns The synergy list to match grid cards against at this resolution.
 */
export function eventSynergyTargets(
  state: MainStreetState,
  event: EventCard,
): readonly SynergyType[] {
  if (String(event.id).startsWith('evt-grand-opening')) {
    const placed = state.placedSynergiesThisTurn;
    if (placed && placed.length > 0) return placed;
  }
  const staticTarget = event.targetSynergy;
  return staticTarget ? [staticTarget] : [];
}

/**
 * Whether a grid card shares ANY of the event's resolution-time synergy
 * targets. Centralises the per-card match predicate so every consumer
 * (payout, projection, attribution) applies identical union semantics.
 *
 * @param card    The business/community-space card to test (may be null).
 * @param targets The event's resolution-time synergy targets.
 * @returns True when the card has at least one matching synergy type.
 */
export function matchesEventSynergyTargets(
  card: { synergyTypes?: readonly SynergyType[] } | null | undefined,
  targets: readonly SynergyType[],
): boolean {
  if (!card || !card.synergyTypes) return false;
  return card.synergyTypes.some((s) => targets.includes(s));
}
