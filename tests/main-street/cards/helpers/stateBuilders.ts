/**
 * Main Street: Card Test Framework — controlled-state builders.
 *
 * Thin wrappers around the production setup so every card definition starts
 * from a deterministic, applicant-free game state and can install a
 * controlled market/deck without long scripted play.
 *
 * @module
 */

import { setupMainStreetGame } from '../../../../src/MainStreetState';
import type { MainStreetState } from '../../../../src/MainStreetState';
import type { AnyCard } from '../../../../src/MainStreetCards';

/**
 * Creates a deterministic game state with the staff-applicant trigger
 * suppressed, so card outcomes are not perturbed by incidental applicants.
 *
 * @param seed Seed string (deterministic per definition).
 */
export function newGame(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  // Applicant resolution is orthogonal to card behaviour and would consume
  // RNG / add staff unexpectedly; suppress it for controlled card tests.
  (state as unknown as { suppressApplicant?: boolean }).suppressApplicant = true;
  return state;
}

/** Replaces the market row with exactly the given cards. */
export function setMarket(state: MainStreetState, cards: AnyCard[]): void {
  state.market.cards = cards.map(card => ({ ...card }));
}

/**
 * Raises the coin balance so affordability never masks a behaviour check.
 *
 * The amount is deliberately below the 12,000-point win threshold and above
 * every card's listed cost (max 2,000), so it neither lets a run end early
 * nor blocks a purchase.
 */
export function fundCoins(state: MainStreetState, amount = 5_000): void {
  state.resourceBank.coins = amount;
}

/** Clears the incident deck so end-of-turn progression is incident-free. */
export function clearIncidents(state: MainStreetState): void {
  state.incidentDeck = [];
  state.discards.event = state.discards.event.filter(() => false);
}
