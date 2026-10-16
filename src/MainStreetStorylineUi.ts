/**
 * Storyline player-agency helpers (MS-0MUMP96XH002SJ89)
 *
 * Pure, Phaser-free helpers that surface named storylines and outcome feedback
 * to the UI. Keeping the logic here (rather than in the scene) makes it
 * unit-testable without a browser.
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
