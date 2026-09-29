/**
 * Storyline player-agency helpers (MS-0MUMP96XH002SJ89)
 *
 * Pure, Phaser-free helpers that surface named storylines, outcome feedback
 * and the active-thread continuity state to the UI. Keeping the logic here
 * (rather than in the scene) makes it unit-testable without a browser.
 *
 * - {@link choiceDialogTitle} / {@link choiceDialogSubtitle} — name the
 *   storyline in the choice dialog (fallback: card name).
 * - {@link storyUpdateLine} — the concise narrative "story update" emitted when
 *   a choice resolves (null for cards without a storyline).
 * - {@link getActiveStorylines} — the storylines currently in play (a card of
 *   the storyline is pending or queued), used by the HUD indicator. Persists
 *   through cycles and clears when the thread ends.
 *
 * @module
 */

import type { EventCard } from './MainStreetCardsTypes';
import type { MainStreetState } from './MainStreetStateTypes';
import { getBaseTypeId } from './MainStreetCards';

/** Human-readable storyline name: explicit title, else the storyline id. */
export function storylineName(event: EventCard): string | null {
  if (!event.storylineId) return null;
  return event.storylineTitle ?? event.storylineId;
}

/**
 * Dialog title for a pending choice. Prefers the storyline name so the player
 * sees which arc they are in; falls back to the card name.
 */
export function choiceDialogTitle(event: EventCard): string {
  return storylineName(event) ?? event.name;
}

/**
 * Dialog subtitle: the specific incident within the storyline (empty when the
 * card has no storyline, so the dialog stays unchanged for legacy choice
 * cards).
 */
export function choiceDialogSubtitle(event: EventCard): string {
  return event.storylineId ? event.name : '';
}

/** Formats a delta summary for the story-update line. */
function describeDelta(coinChange: number, repChange: number): string {
  const parts: string[] = [];
  if (coinChange !== 0) parts.push(`${coinChange > 0 ? '+' : ''}${Math.round(coinChange)} coins`);
  if (repChange !== 0) parts.push(`${repChange > 0 ? '+' : ''}${Math.round(repChange)} rep`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
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
  const name = storylineName(event);
  if (!name) return null;
  const accepted = option.toLowerCase() === 'accept';
  if (accepted) {
    return `Story update — ${name}: you accepted the consequence${describeDelta(coinChange, repChange)}.`;
  }
  if (option.toLowerCase() === 'reject') {
    return `Story update — ${name}: you refused the consequence; the thread continues.`;
  }
  // Generalised multi-way option: name the option.
  return `Story update — ${name}: you chose "${option}"${describeDelta(coinChange, repChange)}.`;
}

/** A storyline that is currently in play. */
export interface ActiveStoryline {
  /** Storyline id. */
  readonly storylineId: string;
  /** Display name (title, falling back to the id). */
  readonly storylineTitle: string;
  /** Base card ids of this storyline currently pending or queued. */
  readonly cardIds: readonly string[];
}

/**
 * Returns the storylines currently in play: a card belonging to the storyline
 * is either the pending choice or still queued in the incident deck.
 *
 * - While a choice awaits a decision, its storyline is active.
 * - When a chosen option queues a successor of the same storyline (including a
 *   cycle), the storyline stays active.
 * - When the chain ends (no successor of that storyline remains anywhere), the
 *   storyline is cleared.
 *
 * Deterministic: the result is sorted by storyline id.
 */
export function getActiveStorylines(state: MainStreetState): ActiveStoryline[] {
  const byId = new Map<string, { title: string; cardIds: Set<string> }>();

  const consider = (card: EventCard | null | undefined): void => {
    if (!card || !card.storylineId) return;
    const entry = byId.get(card.storylineId) ?? {
      title: card.storylineTitle ?? card.storylineId,
      cardIds: new Set<string>(),
    };
    // Prefer an explicit title if a later card supplies one.
    if (card.storylineTitle) entry.title = card.storylineTitle;
    entry.cardIds.add(getBaseTypeId(card.id));
    byId.set(card.storylineId, entry);
  };

  // The pending choice counts only while unresolved; once resolved it is
  // consumed (its successor, if any, is now in the incident deck).
  const pending = state.pendingEventChoice;
  if (pending && !pending.resolved) consider(pending.event);
  for (const card of state.incidentDeck) consider(card);

  return [...byId.entries()]
    .map(([storylineId, v]) => ({
      storylineId,
      storylineTitle: v.title,
      cardIds: [...v.cardIds].sort(),
    }))
    .sort((a, b) => (a.storylineId < b.storylineId ? -1 : a.storylineId > b.storylineId ? 1 : 0));
}

/**
 * The HUD continuity indicator label, or null when no storyline is in play.
 * Names up to two active storylines, then summarises the rest.
 */
export function continuityIndicatorLabel(state: MainStreetState): string | null {
  const active = getActiveStorylines(state);
  if (active.length === 0) return null;
  const names = active.map((a) => a.storylineTitle);
  if (names.length <= 2) return `Storyline: ${names.join(', ')}`;
  return `Storyline: ${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}
