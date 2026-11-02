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
 * The former `choiceClarityLabels` helper was removed with the core dev tip
 * `4975f6ff` (CG-0MVZFVZK1003F8HY), which deleted the choice-clarity seam from
 * `StorylineUiAdapter` along with the legacy two-way choice model. The labels
 * were never rendered by the game (the event-choice dialog shows the compiled
 * option labels), so nothing presentation-side changed.
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
