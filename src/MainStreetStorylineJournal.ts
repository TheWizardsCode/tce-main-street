/**
 * Storyline journal & choice-clarity helpers — Main Street adapter over the
 * generic core story-line module (`@story-line`).
 *
 * The journal derivation, story-update parsing and choice-clarity labels now
 * live in core as game-agnostic helpers; this module keeps Main Street's
 * historical API surface and the shipped wording (via the Main Street UI
 * adapter).
 *
 * - {@link parseStoryUpdate} / {@link buildJournal} / {@link journalIsEmpty} —
 *   journal rows derived from the activity log's "story update" lines, most
 *   recent first.
 * - {@link choiceClarityLabels} — the Accept/Reject explanatory labels. These
 *   describe the consequence semantics (apply vs skip) and MUST NOT reveal the
 *   escalation card id (asserted by tests).
 *
 * @module
 */

import type { EventCard, StorylineOption } from './MainStreetCardsTypes';
import type { MainStreetState } from './MainStreetStateTypes';
import type { ChoiceClarityLabels, StorylineJournalEntry } from '@story-line';
import { getMainStreetStorylineSystem } from './MainStreetStorylineAdapter';

/** Prefix of the narrative lines written when a storyline choice resolves. */
export { STORY_UPDATE_PREFIX } from '@story-line';

/** A single journal row: a past storyline choice outcome. */
export type JournalEntry = StorylineJournalEntry;

/** The explanatory labels for the two option buttons. */
export type { ChoiceClarityLabels };

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

/**
 * Builds the choice-clarity labels for a pending choice card.
 *
 * The labels explain what each option *does* (apply vs skip the incident's
 * effect) without revealing which card the chain escalates to.
 */
export function choiceClarityLabels(event: EventCard): ChoiceClarityLabels {
  const system = getMainStreetStorylineSystem();
  const options: StorylineOption[] = system.compileStorylineFromEvent(event).compiledOptions;
  return system.ui.choiceClarityLabels(event, options);
}

/** Journal title: names the active storyline(s) when available. */
export function journalTitle(state: MainStreetState): string {
  return getMainStreetStorylineSystem().journalTitle(state);
}

/** A one-line summary of a storyline card for the journal tooltip/intro. */
export function storylineSummary(event: EventCard): string {
  return getMainStreetStorylineSystem().ui.storylineSummary(event);
}
