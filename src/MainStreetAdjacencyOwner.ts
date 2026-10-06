/**
 * Main Street: Competitive Slot Ownership
 *
 * Owner tagging and lookup for competitive (per-player) slot ownership.
 *
 * Import graph: depends on `MainStreetState` only.
 *
 * @module
 */

import type { LegalityResult } from '@rule-engine';
import type { MainStreetState } from './MainStreetState';

/**
 * Resolves the owner of a street slot in competitive mode.
 *
 * Reads the owner-tagged grid (state-model sibling) and falls back to the
 * active player (0 in single-player) when a slot is not yet tagged — this
 * keeps headless flows that place cards through the shared single-wallet
 * path deterministic even before ownership tagging lands at every site.
 *
 * @param state      Current game state.
 * @param slotIndex  Street grid slot index.
 * @returns The owning player index (always an integer).
 */
export function getSlotOwnerId(state: MainStreetState, slotIndex: number): number {
  const tag = state.ownerTaggedGrid?.[slotIndex];
  if (tag && tag.ownerId !== null) return tag.ownerId;
  return state.activePlayerId ?? 0;
}

/**
 * Tags a street slot with its owner when the state is competitive
 * (`ownerTaggedGrid` present). No-op in single-player state. The card
 * reference is kept in sync with `streetGrid` so the tag never drifts.
 *
 * @param state      Current game state (mutated in-place when competitive).
 * @param slotIndex  Street grid slot index just occupied.
 * @param ownerId    Owner index (defaults to the active player / 0).
 * @returns True when the tag was written (competitive state).
 */
export function tagSlotOwnerIfCompetitive(
  state: MainStreetState,
  slotIndex: number,
  ownerId: number = state.activePlayerId ?? 0,
): boolean {
  if (!state.ownerTaggedGrid) return false;
  state.ownerTaggedGrid[slotIndex] = {
    card: state.streetGrid[slotIndex] ?? null,
    ownerId,
  };
  return true;
}

/**
 * Human-readable label for a seat, used in ownership-rejection messages.
 *
 * Seat 0 is the human player in the current competitive model; every other
 * seat is an AI opponent (`AI 1`, `AI 2`, ...). The label is deliberately
 * kept in this leaf module so the legality layer, the scene feedback and the
 * tests all produce the same phrasing.
 *
 * @param ownerId Owning player index.
 * @returns `"the player"` for seat 0, otherwise `"AI <ownerId>"`.
 */
export function getSeatLabel(ownerId: number): string {
  return ownerId === 0 ? 'the player' : `AI ${ownerId}`;
}

/**
 * Access-control predicate for mutating a street slot (sell / close / upgrade
 * and any future cross-owner action).
 *
 * In competitive mode (`ownerTaggedGrid` present) the acting seat
 * (`state.activePlayerId`) may mutate a slot only when it owns it
 * (`getSlotOwnerId`). Single-player states carry no `ownerTaggedGrid`, so the
 * gate is a no-op and behaviour is unchanged.
 *
 * This is the single source of truth for the ownership gate: the market
 * legality helpers, the execution paths and the scene feedback all call it,
 * so UI, AI and headless flows can never diverge.
 *
 * @param state     Current game state (read-only).
 * @param slotIndex Street grid slot index being acted upon.
 * @returns `{ legal: true }` when the acting seat owns the slot (or the state
 *          is single-player); otherwise `{ legal: false, reason }` naming the
 *          real owner.
 */
export function canActiveSeatActOnSlot(
  state: MainStreetState,
  slotIndex: number,
): LegalityResult {
  // Single-player (no owner-tagged grid) is never gated by ownership.
  if (!state.ownerTaggedGrid) return { legal: true };

  const ownerId = getSlotOwnerId(state, slotIndex);
  const actingId = state.activePlayerId ?? 0;
  if (ownerId !== actingId) {
    return {
      legal: false,
      reason: `That business belongs to ${getSeatLabel(ownerId)}.`,
    };
  }
  return { legal: true };
}
