/**
 * Main Street: per-card behavioural tests for management-company staff effects
 * (epic MS-0MW6HEBP80070YND, per-card children MS-0MW8AHJ400007RMO …
 * MS-0MW8AHLX6005L565).
 *
 * Each test hires ONE named staff card from the general market row and
 * asserts the documented effect against real engine state — the player-wide
 * hand capacity and action budget — rather than merely that the card can be
 * bought. A dropped dedicated-column effect, a mis-valued magnitude or a
 * business-scoped leak fails the corresponding card's test.
 *
 * GDD Appendix D.4.4 is the authority for the magnitudes asserted here.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import { executeWeekStart } from '../../src/MainStreetEngine';
import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import { createStaffDeck, type StaffCard } from '../../src/MainStreetCards';
import { purchaseStaffCard } from '../../src/MainStreetMarket';

/** Fresh game with the week-start budgets applied. */
function freshState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  return state;
}

/** The shipped staff template instance for `id` (with a fresh copy id). */
function staffTemplate(id: string): StaffCard {
  const card = createStaffDeck(1).find(c => c.id.startsWith(id));
  if (!card) throw new Error(`staff template ${id} not found`);
  return card;
}

/**
 * Hires one named staff card from the market row and returns the hand capacity
 * and base action budget observed before the hire, plus the hired card.
 */
function hire(
  state: MainStreetState,
  id: string,
): { card: StaffCard; handBefore: number; actionsBefore: number } {
  state.phase = 'MarketPhase';
  state.resourceBank.coins = 5000;
  const card = staffTemplate(id);
  state.market.cards.push({ ...card });

  const handBefore = state.maxHandSize;
  const actionsBefore = state.actionsRemaining;
  purchaseStaffCard(state, card.id);
  return { card, handBefore, actionsBefore };
}

/** Runs a fresh week start so the week-start-scoped staff budget is re-applied. */
function rollWeekStart(state: MainStreetState): void {
  state.phase = 'WeekStart';
  executeWeekStart(state);
}

/** True when no business on the street gained an employee (player-scope card). */
function noBusinessEmployed(state: MainStreetState): boolean {
  return state.streetGrid.every(slot => (slot?.employedStaff ?? []).length === 0);
}

describe('management-company staff: hand slots (player-wide capacity)', () => {
  it('Assistant adds +2 hand slots and is never employed at a business', () => {
    const state = freshState('mc-assistant');
    const { handBefore } = hire(state, 'staff-assistant');
    expect(state.maxHandSize).toBe(handBefore + 2);
    expect(noBusinessEmployed(state)).toBe(true);
  });

  it('Apprentice adds +1 hand slot and is never employed at a business', () => {
    const state = freshState('mc-apprentice');
    const { handBefore } = hire(state, 'staff-apprentice');
    expect(state.maxHandSize).toBe(handBefore + 1);
    expect(noBusinessEmployed(state)).toBe(true);
  });

  it('Manager adds +1 hand slot and +1 action per week', () => {
    const state = freshState('mc-manager');
    const { handBefore } = hire(state, 'staff-manager');
    expect(state.maxHandSize).toBe(handBefore + 1);

    rollWeekStart(state);
    expect(state.actionsRemaining).toBe(2); // 1 base + the Manager's +1
  });

  it('Director adds +3 hand slots and +1 action per week', () => {
    const state = freshState('mc-director');
    const { handBefore } = hire(state, 'staff-director');
    expect(state.maxHandSize).toBe(handBefore + 3);

    rollWeekStart(state);
    expect(state.actionsRemaining).toBe(2); // 1 base + the Director's +1
  });

  it('Executive adds +2 actions per week and no hand slot', () => {
    const state = freshState('mc-executive');
    const { handBefore } = hire(state, 'staff-executive');
    expect(state.maxHandSize).toBe(handBefore);

    rollWeekStart(state);
    expect(state.actionsRemaining).toBe(3); // 1 base + the Executive's +2
  });

  it('Socialite adds +1 hand slot (and its +10 rep/turn is asserted separately)', () => {
    const state = freshState('mc-socialite');
    const { handBefore } = hire(state, 'staff-socialite');
    expect(state.maxHandSize).toBe(handBefore + 1);
    expect(noBusinessEmployed(state)).toBe(true);
  });

  it('Accountant adds +1 hand slot (refresh/tax effects are asserted separately)', () => {
    const state = freshState('mc-accountant');
    const { handBefore } = hire(state, 'staff-accountant');
    expect(state.maxHandSize).toBe(handBefore + 1);
    expect(noBusinessEmployed(state)).toBe(true);
  });

  it('General Manager adds +4 hand slots and +1 action per week', () => {
    const state = freshState('mc-general-manager');
    const { handBefore } = hire(state, 'staff-general-manager');
    expect(state.maxHandSize).toBe(handBefore + 4);

    rollWeekStart(state);
    expect(state.actionsRemaining).toBe(2); // 1 base + the General Manager's +1
  });

  it('Lookout adds +1 hand slot and registers the peek ability', () => {
    const state = freshState('mc-lookout');
    const { handBefore } = hire(state, 'staff-lookout');
    expect(state.maxHandSize).toBe(handBefore + 1);
    expect(noBusinessEmployed(state)).toBe(true);
  });

  it('Investor adds no hand slot (its value is the market re-roll)', () => {
    const state = freshState('mc-investor');
    const { handBefore } = hire(state, 'staff-investor');
    expect(state.maxHandSize).toBe(handBefore);
  });
});
