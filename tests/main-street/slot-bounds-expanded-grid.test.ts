/**
 * Main Street: expanded-grid slot-bounds fix tests
 *
 * Verifies that the slot-bounds validation in
 * `MainStreetEngineCommands` uses `state.streetGrid.length` rather than the
 * legacy hard-coded `10`, so that expanded lattices (2×2, 3×2, etc.) accept
 * slot indices beyond 9.
 *
 * Regression fix for MS-0MV1HALJ20003VK6.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import { setupMainStreetGame } from '../../src/MainStreetState';
import {
  placeFromHand,
  canPlaceFromHand,
  sellFromTableau,
  canSellFromTableau,
} from '../../src/MainStreetEngine';
import type { MainStreetState } from '../../src/MainStreetState';

// ── Helpers ─────────────────────────────────────────────────

/** Create a business card with a known cost. */
function makeBiz(id: string, name: string, cost: number): any {
  return {
    family: 'business' as const,
    id,
    name,
    cost,
    baseIncome: 0.5,
    synergyTypes: [],
    maxLevel: 1,
    description: 'test',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    appliedUpgrades: [],
  };
}

/**
 * Expand `state.streetGrid` to `targetLength` by filling the extra slots
 * with null (empty). Leaves existing cards untouched.
 */
function expandGrid(state: MainStreetState, targetLength: number): void {
  const existing = state.streetGrid.length;
  if (targetLength <= existing) return;
  for (let i = existing; i < targetLength; i++) {
    state.streetGrid.push(null);
  }
}

/**
 * Set up a minimal state with a business card in hand, enough coins, and
 * an expanded grid of the requested length.
 */
function setupExpandedState(gridLength: number): {
  state: MainStreetState;
  handIndex: number;
} {
  const state = setupMainStreetGame();
  const card = makeBiz('test-biz', 'Test Bakery', 3);
  state.hand!.push(card);
  const handIndex = state.hand!.length - 1;
  state.resourceBank.coins = card.cost * 10;
  expandGrid(state, gridLength);
  return { state, handIndex };
}

// ── Tests ──────────────────────────────────────────────────

describe('slot bounds use state.streetGrid.length (not hard-coded 10)', () => {
  it('canPlaceFromHand accepts slot index 13 on a 40-slot 2×2 lattice', () => {
    const { state, handIndex } = setupExpandedState(40);
    const result = canPlaceFromHand(state, handIndex, 13);
    expect(result.legal).toBe(true);
  });

  it('canPlaceFromHand rejects slot index 40 (out of bounds) on a 40-slot lattice', () => {
    const { state, handIndex } = setupExpandedState(40);
    const result = canPlaceFromHand(state, handIndex, 40);
    expect(result.legal).toBe(false);
  });

  it('placeFromHand places at slot 13 on a 40-slot lattice without throwing', () => {
    const { state, handIndex } = setupExpandedState(40);
    expect(() => placeFromHand(state, handIndex, 13)).not.toThrow();
    expect(state.streetGrid[13]).toBeTruthy();
  });

  it('canSellFromTableau accepts slot index 13 on a 40-slot lattice', () => {
    const { state, handIndex } = setupExpandedState(40);
    // First place a card at slot 13
    placeFromHand(state, handIndex, 13);
    const result = canSellFromTableau(state, 13);
    expect(result.legal).toBe(true);
  });

  it('sellFromTableau sells from slot 13 on a 40-slot lattice without throwing', () => {
    const { state, handIndex } = setupExpandedState(40);
    placeFromHand(state, handIndex, 13);
    expect(() => sellFromTableau(state, 13)).not.toThrow();
  });

  it('error messages reflect actual grid length', () => {
    const { state, handIndex } = setupExpandedState(40);
    const result = canPlaceFromHand(state, handIndex, 40);
    expect(result.reason).toContain('0-39');
  });
});
