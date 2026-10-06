/**
 * Storyline extraction seam — game-agnostic interface for the storyline
 * mechanic.
 *
 * This module exposes pure functions that operate on the storyline data
 * model (`CompiledStoryline`, `StorylineOption`) without reaching into
 * Main-Street-specific internals. The functions are designed to be portable
 * to the core engine in a future migration.
 *
 * Migration notes (handoff to C6):
 * - The compiled option list is a linear, ordered sequence — no branching
 *   graph traversal beyond the single-choice resolution.
 * - `compileStorylineFromEvent` is the sole entry point for creating a
 *   `CompiledStoryline` from an `EventCard`.
 * - `resolveStorylineOption` applies the chosen option's effect policy and
 *   returns the successor card ID.
 * - The caller is responsible for pushing the successor to the deck.
 * - All functions are side-effect-free except for the effect policy
 *   evaluation (which delegates to `resolveEvent`).
 *
 * @module
 */

import type { EventCard, StorylineOption, CompiledStoryline } from './MainStreetCardsTypes';
import { getEventTemplates, getBaseTypeId } from './MainStreetCards';
import type { MainStreetState, PendingEventChoice } from './MainStreetStateTypes';
import { resolveEvent } from './MainStreetEngineEvents';
import { addLog } from './MainStreetState';
import { recordMainStreetEvent } from './MainStreetTranscript';

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
  if (!templateId) return null; // chain ends — nothing added (AC4/AC9)
  const template = getEventTemplates().find((t) => t.id === templateId);
  if (!template) {
    addLog(state, `Chain card ${templateId} not found in card data.`, 'neutral');
    return null;
  }
  const base = getBaseTypeId(template.id);
  let maxSerial = -1;
  const scan = (cards: readonly EventCard[]): void => {
    for (const c of cards) {
      if (getBaseTypeId(c.id) !== base) continue;
      const m = c.id.match(/-(\d+)$/);
      const n = m ? Number(m[1]) : -1;
      if (n > maxSerial) maxSerial = n;
    }
  };
  scan(state.incidentDeck);
  scan(state.decks.event);
  scan(state.discards.event);
  const card: EventCard = { ...template, id: `${base}-${maxSerial + 1}` };
  state.incidentDeck.push(card);
  return card;
}

// ── Compilation: legacy fields → generalised model ───────────

/**
 * Optional explicit option registry — maps a base event id to an arbitrary
 * ordered option list. When a card id is present here it takes precedence
 * over the legacy-field compilation, allowing multi-way storylines without
 * new CSV columns. Keyed by base type id (without the instance serial).
 */
const storylineOptionRegistry = new Map<string, StorylineOption[]>();

/**
 * Registers an explicit ordered option list for an event card.
 *
 * Explicit options take precedence over legacy `hasChoices` compilation, so
 * a card can declare an arbitrary number of labelled options. Callers that
 * register options are responsible for resetting the registry (see
 * {@link resetStorylineRegistry}) — typically in test teardown.
 *
 * @param eventId Base event id (e.g. `evt-tax`, not `evt-tax-0`).
 * @param options Ordered option list (at least one option).
 */
export function registerStorylineOptions(eventId: string, options: readonly StorylineOption[]): void {
  storylineOptionRegistry.set(
    eventId,
    options.map((o) => ({ ...o })),
  );
}

/** Clears all explicitly registered storyline options (test isolation). */
export function resetStorylineRegistry(): void {
  storylineOptionRegistry.clear();
}

/** Returns true when an explicit option list is registered for the event id. */
export function hasRegisteredStorylineOptions(eventId: string): boolean {
  return storylineOptionRegistry.has(getBaseTypeId(eventId));
}

/**
 * Compiles a card's storyline into the generalised option model.
 *
 * Explicit registry options take precedence. Otherwise the legacy choice
 * fields are compiled:
 *
 * - Non-choice cards (no `hasChoices`) → empty option list.
 * - Choice cards → two options:
 *   1. "Accept" (effectPolicy="apply", successorId=acceptNextCardId)
 *   2. "Reject" (effectPolicy="skip", successorId=rejectNextCardId)
 *
 * When `state` is provided, options whose `condition` callback returns
 * `false` are omitted from the result (draw-time filtering).
 */
export function compileStorylineFromEvent(
  event: EventCard,
  state?: MainStreetState,
): CompiledStoryline {
  const storylineId = event.storylineId ?? null;
  const registered = storylineOptionRegistry.get(getBaseTypeId(event.id));
  if (registered) {
    const options = registered.map((o) => ({ ...o }));
    if (state) {
      // Filter by condition at draw time: omit options whose condition
      // callback returns false.  Options without a condition (or whose
      // condition returns true) are included unchanged.
      return {
        storylineId,
        compiledOptions: options.filter(
          (o) => o.condition == null || o.condition(state),
        ),
      };
    }
    return { storylineId, compiledOptions: options };
  }

  if (!event.hasChoices) {
    return { storylineId, compiledOptions: [] };
  }

  return {
    storylineId,
    compiledOptions: [
      {
        label: 'Accept',
        successorId: event.acceptNextCardId ?? undefined,
        effectPolicy: 'apply',
      },
      {
        label: 'Reject',
        successorId: event.rejectNextCardId ?? undefined,
        effectPolicy: 'skip',
      },
    ],
  };
}

/**
 * Returns true if the event presents a story-driven choice at resolution
 * time — i.e. it has legacy `hasChoices`, or an explicit registered option
 * list.
 *
 * NOTE: a bare `storylineId` is descriptive metadata (grouping cards into a
 * named arc) and does NOT by itself make a card a choice. Terminal
 * escalation cards (e.g. `evt-depression`, `evt-pandemic`) carry a
 * `storylineId` for grouping/journal purposes but must still resolve as plain
 * incidents. Only `hasChoices` / registered options intercept resolution.
 */
export function eventHasStoryline(event: EventCard): boolean {
  return Boolean(event.hasChoices) || hasRegisteredStorylineOptions(event.id);
}

/**
 * Returns the ordered option list for an event (empty when non-choice).
 * Registry-aware; the generalised accessor used by callers and the engine.
 *
 * When `state` is provided, options whose `condition` callback returns
 * `false` are omitted (draw-time filtering).
 */
export function getStorylineOptions(
  event: EventCard,
  state?: MainStreetState,
): StorylineOption[] {
  return compileStorylineFromEvent(event, state).compiledOptions;
}

/**
 * Returns the number of options for a storyline event (0 for non-choice).
 * When `state` is provided, options whose `condition` callback returns
 * `false` are excluded from the count.
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
export interface StorylineResolution {
  /** The card pushed as a consequence, or null if the chain ends. */
  readonly pushedCard: EventCard | null;
  /** The coin change from applying the effect (if any). */
  readonly coinChange: number;
  /** The reputation change from applying the effect (if any). */
  readonly repChange: number;
}

/**
 * Resolves a storyline option by applying its effect policy and pushing the
 * successor card.
 *
 * If the option has a `successorResolver` callback, it is invoked at
 * resolution time to determine the pushed successor (replacing
 * `option.successorId`).  A `null` / `undefined` return value ends the
 * chain.
 *
 * @param state  Current game state (mutated by effect application).
 * @param event  The storyline event card.
 * @param option The chosen storyline option.
 * @returns The resolution result (pushed card, deltas).
 */
export function resolveStorylineOption(
  state: MainStreetState,
  event: EventCard,
  option: StorylineOption,
): StorylineResolution {
  const coinsBefore = state.resourceBank.coins;
  const repBefore = state.resourceBank.reputation;

  // Apply effect if the option's policy says so.
  if (option.effectPolicy === 'apply') {
    resolveEvent(state, event);
  }

  const coinChange = state.resourceBank.coins - coinsBefore;
  const repChange = state.resourceBank.reputation - repBefore;

  // Determine the successor ID: callback resolver takes priority.
  const resolvedSuccessor =
    option.successorResolver != null
      ? option.successorResolver(state)
      : option.successorId;

  // Push successor card if one exists.
  const pushedCard = pushChainCard(state, resolvedSuccessor);

  return { pushedCard, coinChange, repChange };
}

// ── State management: pending choice lifecycle ───────────────

/**
 * Creates a new pending storyline choice from a drawn event.
 * Called by `resolveIncident` when a storyline event is drawn.
 *
 * When `state` is supplied, the compiled option list is filtered by each
 * option's `condition` callback and **snapshotted** onto the pending choice
 * (draw-time evaluation).  Resolution then reads the frozen snapshot, so
 * mutating state between draw and resolution cannot change the presented
 * options (AC3).  Omitting `state` retains the legacy behaviour of an
 * unfrozen pending choice (used by callers/tests that only need the event).
 *
 * @param event The drawn event card.
 * @param state Optional current game state; when present, freezes the
 *              condition-filtered option list onto the pending choice.
 * @returns The pending choice, or null if the event has no storyline.
 */
export function createPendingStorylineChoice(
  event: EventCard,
  state?: MainStreetState,
): PendingEventChoice | null {
  if (!eventHasStoryline(event)) {
    return null;
  }
  const pending: PendingEventChoice = {
    event,
    chosenOption: null,
    resolved: false,
  };
  if (state) {
    // Freeze the presented option list at draw time (AC3): condition
    // callbacks are evaluated here and never again during resolution.
    pending.options = getStorylineOptions(event, state);
  }
  return pending;
}

/**
 * Returns the option list presented for a pending choice.
 *
 * Prefers the draw-time snapshot captured by
 * {@link createPendingStorylineChoice} (which freezes callback conditions);
 * falls back to recompiling when no snapshot exists (legacy pending choices
 * or an unsupplied state) so behaviour remains backward compatible.
 *
 * @param pending The pending choice.
 * @param state   Current game state, used only for the fallback recompile.
 */
export function getPendingStorylineOptions(
  pending: PendingEventChoice,
  state?: MainStreetState,
): StorylineOption[] {
  if (pending.options) return pending.options;
  return getStorylineOptions(pending.event, state);
}

/**
 * Records the resolution in the transcript.
 *
 * @param state  Current game state (for turn number).
 * @param event  The resolved event card.
 * @param option The chosen option label.
 * @param acceptNext The legacy acceptNextCardId for backward compat.
 * @param rejectNext The legacy rejectNextCardId for backward compat.
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
    option: option as 'accept' | 'reject',
    acceptNextCardId: acceptNext,
    rejectNextCardId: rejectNext,
  });
}

/**
 * Marks the pending choice as resolved with the chosen option label.
 *
 * @param pending  The pending choice to resolve.
 * @param option   The chosen option label (e.g. 'Accept' | 'Reject').
 */
export function markChoiceResolved(pending: PendingEventChoice, option: string): void {
  pending.chosenOption = option as PendingEventChoice['chosenOption'];
  pending.resolved = true;
}
