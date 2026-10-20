/**
 * Storyline player-agency helpers — Main Street adapter over the generic core
 * story-line module (`@story-line`).
 *
 * The naming and outcome-feedback text now come from the pluggable core UI
 * adapter (`mainStreetStorylineUiAdapter`), which reproduces the shipped Main
 * Street wording byte-for-byte. This module keeps the historical API surface.
 *
 * - {@link choiceDialogTitle} / {@link choiceDialogSubtitle} — name the
 *   storyline in the choice dialog (fallback: card name).
 * - {@link storyUpdateLine} — the concise narrative "story update" emitted when
 *   a choice resolves (null for cards without a storyline).
 *
 * The transient top-left HUD continuity indicator that previously consumed the
 * active-storyline state was removed in MS-0MUYAF2AD0066XO9.
 *
 * @module
 */

import type { EventCard } from './MainStreetCardsTypes';
import { getMainStreetStorylineSystem } from './MainStreetStorylineAdapter';

/** Human-readable storyline name: explicit title, else the storyline id. */
export function storylineName(event: EventCard): string | null {
  return getMainStreetStorylineSystem().ui.storylineName(event);
}

/**
 * Dialog title for a pending choice. Prefers the storyline name so the player
 * sees which arc they are in; falls back to the card name.
 */
export function choiceDialogTitle(event: EventCard): string {
  return getMainStreetStorylineSystem().ui.choiceDialogTitle(event);
}

/**
 * Dialog subtitle: the specific incident within the storyline (empty when the
 * card has no storyline, so the dialog stays unchanged for legacy choice
 * cards).
 */
export function choiceDialogSubtitle(event: EventCard): string {
  return getMainStreetStorylineSystem().ui.choiceDialogSubtitle(event);
}

/**
 * The concise narrative "story update" line emitted when a choice resolves.
 * Returns null for cards without a `storylineId` (no storyline, no update).
 *
 * @param event      The resolved storyline card.
 * @param option     The chosen option label ('accept' | 'reject' | custom).
 * @param coinChange Applied coin delta (0 for skip options).
 * @param repChange  Applied reputation delta (0 for skip options).
 */
export function storyUpdateLine(
  event: EventCard,
  option: string,
  coinChange: number,
  repChange: number,
): string | null {
  return getMainStreetStorylineSystem().ui.storyUpdateLine(
    event,
    option,
    coinChange,
    repChange,
  );
}
