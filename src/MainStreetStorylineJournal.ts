/**
 * Storyline journal helpers — Main Street adapter over the generic core
 * story-line module (`@story-line`).
 *
 * The journal derivation and story-update parsing live in core as
 * game-agnostic helpers; this module keeps Main Street's historical API
 * surface and the shipped wording (via the Main Street UI adapter).
 *
 * - {@link parseStoryUpdate} / {@link buildJournal} / {@link journalIsEmpty} —
 *   journal rows derived from the activity log's "story update" lines, most
 *   recent first.
 *
 * Storyline presentation is options-only: a choice card pauses resolution and
 * presents its compiled option list (the CSV `options` encoding or a
 * registered option list), and the chosen option's label is the token the
 * transcript records. The event-choice dialog renders those labels directly,
 * so this module derives journal rows only and adapts no choice-presentation
 * helper — the legacy two-way model's presentation seam is fully retired.
 *
 * @module
 */

import type { EventCard } from './MainStreetCardsTypes';
import type { MainStreetState } from './MainStreetStateTypes';
import type { StorylineJournalEntry } from '@story-line';
import { getMainStreetStorylineSystem } from './MainStreetStorylineAdapter';

/** Prefix of the narrative lines written when a storyline choice resolves. */
export { STORY_UPDATE_PREFIX } from '@story-line';

/** A single journal row: a past storyline choice outcome. */
export type JournalEntry = StorylineJournalEntry;

/**
 * Parses a story-update log line into `{ storyline, outcome }`, or null when
 * the text is not a story update.
 */
export function parseStoryUpdate(
  text: string,
): { storyline: string; outcome: string } | null {
  return getMainStreetStorylineSystem().parseStoryUpdate(text);
}

/**
 * Builds the journal from the activity log's story-update lines, most recent
 * first. Only entries produced by storyline choices are included.
 */
export function buildJournal(state: MainStreetState): JournalEntry[] {
  return getMainStreetStorylineSystem().buildJournal(state);
}

/** True when the journal has no entries yet (empty-state). */
export function journalIsEmpty(state: MainStreetState): boolean {
  return getMainStreetStorylineSystem().journalIsEmpty(state);
}

/** Journal title: names the active storyline(s) when available. */
export function journalTitle(state: MainStreetState): string {
  return getMainStreetStorylineSystem().journalTitle(state);
}

/** A one-line summary of a storyline card for the journal tooltip/intro. */
export function storylineSummary(event: EventCard): string {
  return getMainStreetStorylineSystem().ui.storylineSummary(event);
}
