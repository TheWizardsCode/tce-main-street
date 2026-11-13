/**
 * Main Street: One-off Attribution Accumulator
 *
 * Per-source one-off deltas captured during the turn
 * (MS-0MWBZDNH3006DXV7). Every MarketPhase / closing source that moves coins
 * or reputation outside the income, ongoing-cost and incident categories
 * records its own signed delta here, so {@link buildTurnLedger} (and the
 * competitive closing) can explain the one-off row source-by-source instead
 * of presenting a bare residual.
 *
 * Design rules:
 *
 * - **Presentation data only.** The accumulator is never read by the economy:
 *   no legality check, no RNG consumption, no wallet writes. Removing every
 *   call site leaves the game byte-identical.
 * - **Per-seat.** Keyed by owner id: single-player uses `activePlayerId ?? 0`
 *   (the shared wallet's seat), competitive seats accumulate under their own
 *   id while their MarketPhase runs and when their loans are billed at the
 *   closing.
 * - **Checkpoint-safe.** The accumulator is serialised with the save (a
 *   plain-object projection in `MainStreetSerializedState`), so a mid-turn
 *   save/load round-trip preserves the captured sources for the closing.
 * - **Reset at WeekStart.** {@link resetOneOffAttribution} clears the map in
 *   `executeWeekStart`, so each day measures only that day's sources. A
 *   topped-out accumulator can never leak into a later turn's one-off row.
 *
 * @module
 */

import type { MainStreetState } from './MainStreetState';
import type { TurnOneOffAttribution } from './MainStreetEngineTypes';

/** Zero-valued per-source accumulator (the default for every seat). */
export function emptyOneOffAttribution(): TurnOneOffAttribution {
  return {
    marketPurchaseCost: 0,
    marketSaleProceeds: 0,
    eventPlayCoinEffect: 0,
    eventPlayRepEffect: 0,
    communityFavourCoins: 0,
    communityFavourRep: 0,
    loanRepaid: 0,
    loanTaken: 0,
    loanBailout: 0,
  };
}

const ATTRIBUTION_FIELDS = Object.keys(emptyOneOffAttribution()) as (keyof TurnOneOffAttribution)[];

/**
 * Reads one seat's per-source accumulator (zero-filled when the seat has
 * recorded nothing this turn).
 *
 * @param state   Current game state (read-only).
 * @param ownerId Seat to read (defaults to `state.activePlayerId ?? 0`).
 * @returns The seat's captured per-source deltas.
 */
export function attributionFor(state: MainStreetState, ownerId?: number): TurnOneOffAttribution {
  const seat = ownerId ?? state.activePlayerId ?? 0;
  return state._oneOffAttribution?.get(seat) ?? emptyOneOffAttribution();
}

/**
 * Adds signed per-source deltas to the acting seat's accumulator.
 *
 * Callers pass exactly the sources they moved, e.g.
 * `recordOneOffAttribution(state, { marketPurchaseCost: -price })` after a
 * purchase. Fields not present in `delta` are left untouched; the values
 * ACCUMULATE across the turn (repeated purchases sum into
 * `marketPurchaseCost`).
 *
 * @param state   Current game state (mutated in-place: the accumulator).
 * @param delta   Signed per-source deltas to add to the seat's totals.
 * @param ownerId Seat to attribute to (defaults to the acting seat).
 */
export function recordOneOffAttribution(
  state: MainStreetState,
  delta: Partial<TurnOneOffAttribution>,
  ownerId?: number,
): void {
  if (!state._oneOffAttribution) state._oneOffAttribution = new Map();
  const seat = ownerId ?? state.activePlayerId ?? 0;
  const acc = state._oneOffAttribution.get(seat) ?? emptyOneOffAttribution();
  for (const field of ATTRIBUTION_FIELDS) {
    const value = delta[field];
    if (value === undefined) continue;
    acc[field] += value;
  }
  state._oneOffAttribution.set(seat, acc);
}

/**
 * Clears the per-source accumulator for every seat (new day).
 *
 * Called by `executeWeekStart` alongside the other per-turn gate resets, so a
 * new MarketPhase starts measuring fresh — a stale accumulator can never bleed
 * into the next day's one-off row.
 *
 * @param state Current game state (mutated in-place).
 */
export function resetOneOffAttribution(state: MainStreetState): void {
  state._oneOffAttribution = null;
}
