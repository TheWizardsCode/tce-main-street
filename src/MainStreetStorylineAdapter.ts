/**
 * Main Street adapters for the generic core story-line system.
 *
 * The generic mechanics (compilation, resolution, pending-choice lifecycle,
 * journal helpers) now live in `@story-line` (Tableau-Card-Engine core). This
 * module is the single place that maps Main Street state and presentation onto
 * the core seams:
 *
 * - {@link mainStreetStorylineEngineAdapter} — state access (seeded `rng()`,
 *   event-effect application, activity log, chain-card sink).
 * - {@link mainStreetStorylineUiAdapter} — presentation (story-line names,
 *   dialog labels, story-update lines, journal formatting). It is the core
 *   default implementation, which was extracted from Main Street and keeps the
 *   exact shipped wording.
 * - {@link getMainStreetStorylineSystem} — the composed system, created lazily
 *   so module import order cannot observe a partially initialised instance.
 *
 * The three Main Street story-line modules (`MainStreetStoryline`,
 * `MainStreetStorylineJournal`, `MainStreetStorylineUi`) are thin wrappers over
 * this system; their exported API is unchanged.
 *
 * @module
 */

import {
  createDefaultStorylineUiAdapter,
  createStorylineSystem,
  type StorylineEngineAdapter,
  type StorylineSystem,
  type StorylineUiAdapter,
} from '@story-line';
import type { EventCard } from './MainStreetCardsTypes';
import type { MainStreetState } from './MainStreetStateTypes';
import { getBaseTypeId, getEventTemplates } from './MainStreetCards';
import { resolveEvent } from './MainStreetEngineEvents';
import { addLog } from './MainStreetState';

/**
 * Maps the core engine seam onto `MainStreetState`.
 *
 * Semantics are identical to the previous Main Street implementation:
 * - `rng` is the seeded `state.rng()` (one draw per candidate selection).
 * - `applyEffect` is `resolveEvent` (the shipped effect application).
 * - the chain-card sink pushes onto the incident deck, and the serial scan
 *   covers the incident deck, event deck and event discard — the same
 *   locations the old `pushChainCard` scanned.
 */
export const mainStreetStorylineEngineAdapter: StorylineEngineAdapter<
  MainStreetState,
  EventCard
> = {
  rng: (state) => state.rng(),
  applyEffect: (state, card) => resolveEvent(state, card),
  getResources: (state) => ({
    coins: state.resourceBank.coins,
    reputation: state.resourceBank.reputation,
  }),
  appendLog: (state, text) => addLog(state, text, 'neutral'),
  getActivityLog: (state) => state.activityLog,
  getTemplate: (id) => getEventTemplates().find((t) => t.id === id) ?? null,
  getBaseTypeId: (id) => getBaseTypeId(id),
  getChainScanCards: (state) => [
    ...state.incidentDeck,
    ...state.decks.event,
    ...state.discards.event,
  ],
  pushChainCard: (state, card) => {
    state.incidentDeck.push(card);
  },
};

/**
 * Main Street presentation adapter.
 *
 * The core default implementation was extracted from Main Street, so it
 * reproduces the shipped names, labels and story-update lines byte-for-byte
 * (guarded by the behaviour-preservation parity gate). A game that wants
 * different wording can spread this object and override individual methods.
 */
export const mainStreetStorylineUiAdapter: StorylineUiAdapter<MainStreetState, EventCard> =
  createDefaultStorylineUiAdapter<MainStreetState, EventCard>();

let _system: StorylineSystem<MainStreetState, EventCard> | undefined;

/**
 * Returns the composed Main Street story-line system (lazily created).
 *
 * The registered-option registry is scoped to this instance, so
 * `resetStorylineRegistry()` clears exactly Main Street's registrations.
 */
export function getMainStreetStorylineSystem(): StorylineSystem<
  MainStreetState,
  EventCard
> {
  if (!_system) {
    _system = createStorylineSystem({
      engine: mainStreetStorylineEngineAdapter,
      ui: mainStreetStorylineUiAdapter,
    });
  }
  return _system;
}
