/**
 * Storyline journal & choice-clarity helpers (MS-0MUMP97LQ006PP1D)
 *
 * Pure, Phaser-free helpers backing the storyline journal overlay and the
 * choice-clarity labels. Keeping the logic here makes both unit-testable
 * without a browser.
 *
 * - {@link parseStoryUpdate} / {@link buildJournal} / {@link journalIsEmpty} —
 *   the journal's rows, derived from the activity log's "story update" lines
 *   (written by C7), most recent first.
 * - {@link choiceClarityLabels} — the Accept/Reject explanatory labels. These
 *   describe the consequence semantics (apply vs skip) and MUST NOT reveal the
 *   escalation card id (asserted by tests).
 *
 * @module
 */

import type { EventCard } from './MainStreetCardsTypes';
import type { MainStreetState } from './MainStreetStateTypes';
import { compileStorylineFromEvent } from './MainStreetStoryline';
import { storylineName } from './MainStreetStorylineUi';

/** Prefix of the narrative lines written when a storyline choice resolves. */
export const STORY_UPDATE_PREFIX = 'Story update — ';

/** A single journal row: a past storyline choice outcome. */
export interface JournalEntry {
  /** Turn the choice resolved on. */
  readonly turn: number;
  /** Storyline display name. */
  readonly storyline: string;
  /** The outcome summary (text after the storyline name). */
  readonly outcome: string;
  /** The original log line. */
  readonly text: string;
}

/**
 * Parses a story-update log line into `{ storyline, outcome }`, or null when
 * the text is not a story update.
 */
export function parseStoryUpdate(text: string): { storyline: string; outcome: string } | null {
  if (!text.startsWith(STORY_UPDATE_PREFIX)) return null;
  const rest = text.slice(STORY_UPDATE_PREFIX.length);
  const sep = rest.indexOf(': ');
  if (sep < 0) return null;
  return {
    storyline: rest.slice(0, sep),
    outcome: rest.slice(sep + 2),
  };
}

/**
 * Builds the journal from the activity log's story-update lines, most recent
 * first. Only entries produced by storyline choices are included.
 */
export function buildJournal(state: MainStreetState): JournalEntry[] {
  const entries: JournalEntry[] = [];
  for (const log of state.activityLog) {
    const parsed = parseStoryUpdate(log.text);
    if (!parsed) continue;
    entries.push({
      turn: log.turn,
      storyline: parsed.storyline,
      outcome: parsed.outcome,
      text: log.text,
    });
  }
  // Most recent first (a stable reverse — the log is append-only).
  return entries.reverse();
}

/** True when the journal has no entries yet (empty-state). */
export function journalIsEmpty(state: MainStreetState): boolean {
  return buildJournal(state).length === 0;
}

/** The explanatory labels for the two option buttons. */
export interface ChoiceClarityLabels {
  readonly accept: string;
  readonly reject: string;
}

/**
 * Builds the choice-clarity labels for a pending choice card.
 *
 * The labels explain what each option *does* (apply vs skip the incident's
 * effect) without revealing which card the chain escalates to. For the legacy
 * two-option model the labels are Accept/Reject; the text is derived from the
 * compiled options' effect policies.
 */
export function choiceClarityLabels(event: EventCard): ChoiceClarityLabels {
  const options = compileStorylineFromEvent(event).compiledOptions;
  const acceptOption = options[0];
  const rejectOption = options[1];

  const accept = acceptOption?.effectPolicy === 'apply'
    ? `Accept: apply “${event.effect}”.`
    : 'Accept: continue without applying an effect.';

  // Never name the escalation: only the semantic (skip + a different incident).
  const reject = rejectOption?.effectPolicy === 'skip'
    ? 'Reject: refuse this consequence; a different incident will follow.'
    : 'Reject: refuse this consequence.';

  return { accept, reject };
}

/** Journal title: names the active storyline(s) when available. */
export function journalTitle(state: MainStreetState): string {
  const entries = buildJournal(state);
  const names = [...new Set(entries.map((e) => e.storyline))];
  if (names.length === 0) return 'Storyline Journal';
  return `Storyline Journal — ${names.join(', ')}`;
}

/** A one-line summary of a storyline card for the journal tooltip/intro. */
export function storylineSummary(event: EventCard): string {
  const name = storylineName(event) ?? event.name;
  return `Storyline: ${name}`;
}
