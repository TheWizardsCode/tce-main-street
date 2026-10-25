/**
 * Storyline model — Main Street adapter over the generic core story-line
 * module (`@story-line`).
 *
 * The branching-narrative mechanics (compilation, the registered-option
 * registry, pending-choice lifecycle and resolution) live in core so any TCE
 * game can reuse them. This module keeps Main Street's historical API surface
 * as thin wrappers, so callers and tests are unchanged:
 *
 * - {@link pushChainCard} — deterministic chain-card push.
 * - {@link registerStorylineOptions} / {@link resetStorylineRegistry} /
 *   {@link hasRegisteredStorylineOptions} — the programmatic option registry.
 * - {@link parseStorylineOptionsEncoding} — CSV `options` parsing.
 * - {@link compileStorylineFromEvent} / {@link getStorylineOptions} /
 *   {@link storylineOptionCount} / {@link eventHasStoryline} — compilation.
 * - {@link resolveStorylineOption} — effect policy, successor precedence and
 *   the one-seeded-draw candidate selection.
 * - {@link createPendingStorylineChoice} / {@link getPendingStorylineOptions} /
 *   {@link markChoiceResolved} — pending-choice lifecycle.
 *
 * Main Street owns only {@link recordStorylineResolution}, which writes the
 * Main Street transcript shape (a game-specific concern).
 *
 * @module
 */

import type { EventCard, StorylineOption, CompiledStoryline } from './MainStreetCardsTypes';
import type { MainStreetState, PendingEventChoice } from './MainStreetStateTypes';
import { recordMainStreetEvent } from './MainStreetTranscript';
import { getMainStreetStorylineSystem } from './MainStreetStorylineAdapter';

/**
 * Pushes a chain successor card onto the incident deck.
 *
 * Deterministic serial: highest existing suffix for the base template across
 * every event-card location, +1. Replay-safe (no RNG / wall clock).
 *
 * @param state      Current game state (mutated — incidentDeck may grow).
 * @param templateId The card template ID to add (successorId).
 * @returns The pushed card instance, or null when no chain card was requested
 *          or the template does not exist.
 */
export function pushChainCard(
  state: MainStreetState,
  templateId: string | null | undefined,
): EventCard | null {
  return getMainStreetStorylineSystem().pushChainCard(state, templateId);
}

// ── Compilation: registry + legacy/CSV → generalised model ──

/**
 * Registers an explicit ordered option list for an event card.
 *
 * Explicit options take precedence over legacy `hasChoices` compilation and the
 * CSV `options` encoding. Callers that register options are responsible for
 * resetting the registry (see {@link resetStorylineRegistry}).
 *
 * @param eventId Base event id (e.g. `evt-tax`, not `evt-tax-0`).
 * @param options Ordered option list (at least one option).
 */
export function registerStorylineOptions(
  eventId: string,
  options: readonly StorylineOption[],
): void {
  getMainStreetStorylineSystem().registerStorylineOptions(eventId, options);
}

/** Clears all explicitly registered storyline options (test isolation). */
export function resetStorylineRegistry(): void {
  getMainStreetStorylineSystem().resetStorylineRegistry();
}

/** Returns true when an explicit option list is registered for the event id. */
export function hasRegisteredStorylineOptions(eventId: string): boolean {
  return getMainStreetStorylineSystem().hasRegisteredStorylineOptions(eventId);
}

/**
 * Parses a CSV `options` encoding into the generalised option model.
 *
 * Encoding: `label|cardA,cardB;label2|cardC` — see the core module for the
 * full contract (whitespace trimming, terminal options, malformed rejection).
 *
 * @param encoding Raw `options` cell from `src/card-data.csv`.
 * @returns Ordered option list (empty for a blank encoding).
 * @throws Error when the encoding is non-empty but malformed / yields no option.
 */
export function parseStorylineOptionsEncoding(encoding: string): StorylineOption[] {
  return getMainStreetStorylineSystem().parseStorylineOptionsEncoding(encoding);
}

/**
 * Compiles a card's storyline into the generalised option model.
 *
 * Precedence: explicit registry options > CSV `options` encoding > legacy
 * two-way choice fields. When `state` is provided, registry options whose
 * `condition` callback returns `false` are omitted (draw-time filtering).
 */
export function compileStorylineFromEvent(
  event: EventCard,
  state?: MainStreetState,
): CompiledStoryline {
  return getMainStreetStorylineSystem().compileStorylineFromEvent(event, state);
}

/**
 * Returns true if the event presents a story-driven choice at resolution time
 * — legacy `hasChoices`, a non-empty CSV `options` encoding, or a registered
 * option list. A bare `storylineId` is descriptive metadata, not a choice.
 */
export function eventHasStoryline(event: EventCard): boolean {
  return getMainStreetStorylineSystem().eventHasStoryline(event);
}

/**
 * Returns the ordered option list for an event (empty when non-choice).
 * When `state` is provided, condition-filtered options are omitted.
 */
export function getStorylineOptions(
  event: EventCard,
  state?: MainStreetState,
): StorylineOption[] {
  return getMainStreetStorylineSystem().getStorylineOptions(event, state);
}

/**
 * Returns the number of options for a storyline event (0 for non-choice).
 */
export function storylineOptionCount(
  event: EventCard,
  state?: MainStreetState,
): number {
  return getMainStreetStorylineSystem().storylineOptionCount(event, state);
}

// ── Resolution: apply a storyline option ─────────────────────

/**
 * Result of resolving a storyline option.
 */
export type StorylineResolution = import('@story-line').StorylineResolution<EventCard>;

/**
 * Resolves a storyline option by applying its effect policy and pushing the
 * successor card. Successor precedence: resolver → seeded candidate draw →
 * legacy id; a candidate draw consumes exactly one `state.rng()` call.
 */
export function resolveStorylineOption(
  state: MainStreetState,
  event: EventCard,
  option: StorylineOption,
): StorylineResolution {
  return getMainStreetStorylineSystem().resolveStorylineOption(state, event, option);
}

// ── State management: pending choice lifecycle ───────────────

/**
 * Creates a new pending storyline choice from a drawn event. With `state`
 * supplied, the condition-filtered option list is snapshotted at draw time.
 */
export function createPendingStorylineChoice(
  event: EventCard,
  state?: MainStreetState,
): PendingEventChoice | null {
  // The core pending choice is structurally identical to `PendingEventChoice`;
  // its snapshot array is mutable in practice, so the widened readonly type is
  // safe to present as Main Street's mutable `options` field.
  return getMainStreetStorylineSystem().createPendingStorylineChoice(
    event,
    state,
  ) as PendingEventChoice | null;
}

/**
 * Returns the option list presented for a pending choice (snapshot preferred;
 * falls back to recompiling for legacy pending choices).
 */
export function getPendingStorylineOptions(
  pending: PendingEventChoice,
  state?: MainStreetState,
): StorylineOption[] {
  return getMainStreetStorylineSystem().getPendingStorylineOptions(pending, state);
}

/**
 * Records the resolution in the Main Street transcript.
 *
 * Main Street-specific: the generic core module has no transcript concept.
 */
export function recordStorylineResolution(
  state: MainStreetState,
  event: EventCard,
  option: string,
  acceptNext: string | null,
  rejectNext: string | null,
): void {
  recordMainStreetEvent({
    type: 'event-choice',
    turn: state.turn,
    eventId: event.id,
    cardName: event.name,
    // The chosen option's label, recorded as a stable token.
    option,
    acceptNextCardId: acceptNext,
    rejectNextCardId: rejectNext,
  });
}

/** Marks the pending choice as resolved with the chosen option label. */
export function markChoiceResolved(
  pending: PendingEventChoice,
  option: string,
): void {
  getMainStreetStorylineSystem().markChoiceResolved(pending, option);
}
