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
 * Main Street transcript shape (a game-specific concern), plus a small
 * **legacy two-way compatibility bridge** (see {@link legacyOptionList}): the
 * core dev tip `4975f6ff` (CG-0MVZFVZK1003F8HY) removed the legacy
 * `hasChoices` / `acceptNextCardId` / `rejectNextCardId` compilation from the
 * generic module, but Main Street's card format still declares those columns
 * and its public API (`compileStorylineFromEvent` / `eventHasStoryline` /
 * `createPendingStorylineChoice`) must keep working. The bridge synthesises
 * the same two options (Accept `apply`, Reject `skip`, no RNG draw) only when
 * core finds no explicit options or registered list, so explicit and CSV
 * options keep precedence unchanged.
 *
 * @module
 */

import type { EventCard, StorylineOption, CompiledStoryline } from './MainStreetCardsTypes';
import type { MainStreetState, PendingEventChoice } from './MainStreetStateTypes';
import { recordMainStreetEvent } from './MainStreetTranscript';
import { getMainStreetStorylineSystem } from './MainStreetStorylineAdapter';

/**
 * True when the card declares a legacy two-way choice and no explicit option
 * source, i.e. the case the game-side compatibility bridge covers.
 *
 * A non-empty CSV `options` encoding always wins (core compiles it), and
 * registered options are found by core before this predicate is consulted, so
 * the bridge can never shadow an authored option list.
 */
function isLegacyChoiceCard(event: EventCard): boolean {
  if (event.hasChoices !== true) return false;
  return !(event.options && event.options.trim() !== '');
}

/**
 * The legacy two-way option list, as the pre-`4975f6ff` core compiled it:
 * Accept applies the incident effect, Reject skips it, and each names its
 * single successor directly (`successorId`, so no seeded draw is consumed).
 *
 * Kept game-side because Main Street's card format still declares the legacy
 * columns; see the module docblock.
 */
function legacyOptionList(event: EventCard): StorylineOption[] {
  return [
    event.acceptNextCardId
      ? { label: 'Accept', effectPolicy: 'apply', successorId: event.acceptNextCardId }
      : { label: 'Accept', effectPolicy: 'apply' },
    event.rejectNextCardId
      ? { label: 'Reject', effectPolicy: 'skip', successorId: event.rejectNextCardId }
      : { label: 'Reject', effectPolicy: 'skip' },
  ];
}

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
 * two-way choice fields (the game-side compatibility bridge). When `state` is
 * provided, registry options whose `condition` callback returns `false` are
 * omitted (draw-time filtering).
 */
export function compileStorylineFromEvent(
  event: EventCard,
  state?: MainStreetState,
): CompiledStoryline {
  const compiled = getMainStreetStorylineSystem().compileStorylineFromEvent(event, state);
  if (compiled.compiledOptions.length > 0) return compiled;
  if (!isLegacyChoiceCard(event)) return compiled;
  return { storylineId: compiled.storylineId, compiledOptions: legacyOptionList(event) };
}

/**
 * Returns true if the event presents a story-driven choice at resolution time
 * — legacy `hasChoices`, a non-empty CSV `options` encoding, or a registered
 * option list. A bare `storylineId` is descriptive metadata, not a choice.
 */
export function eventHasStoryline(event: EventCard): boolean {
  return getMainStreetStorylineSystem().eventHasStoryline(event) || isLegacyChoiceCard(event);
}

/**
 * Returns the ordered option list for an event (empty when non-choice).
 * When `state` is provided, condition-filtered options are omitted.
 */
export function getStorylineOptions(
  event: EventCard,
  state?: MainStreetState,
): StorylineOption[] {
  return compileStorylineFromEvent(event, state).compiledOptions;
}

/**
 * Returns the number of options for a storyline event (0 for non-choice).
 */
export function storylineOptionCount(
  event: EventCard,
  state?: MainStreetState,
): number {
  return getStorylineOptions(event, state).length;
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
  const pending = getMainStreetStorylineSystem().createPendingStorylineChoice(
    event,
    state,
  ) as PendingEventChoice | null;
  if (pending) return pending;
  // Game-side legacy bridge: core no longer recognises `hasChoices` cards, so
  // build the pending state the pre-`4975f6ff` module produced.
  if (!isLegacyChoiceCard(event)) return null;
  const legacyPending: PendingEventChoice = {
    event,
    chosenOption: null,
    resolved: false,
  };
  if (state) legacyPending.options = legacyOptionList(event);
  return legacyPending;
}

/**
 * Returns the option list presented for a pending choice (snapshot preferred;
 * falls back to recompiling for legacy pending choices).
 */
export function getPendingStorylineOptions(
  pending: PendingEventChoice,
  state?: MainStreetState,
): StorylineOption[] {
  const options = getMainStreetStorylineSystem().getPendingStorylineOptions(pending, state);
  if (options.length > 0) return options;
  return isLegacyChoiceCard(pending.event) ? legacyOptionList(pending.event) : options;
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
