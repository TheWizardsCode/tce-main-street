/**
 * Main Street: Investor staff end-to-end integration tests
 * (MS-0MUOSUN3O003MA1B, parent MS-0MTISBYLS009936W).
 *
 * Cross-cutting lifecycle coverage that ties the per-slice tests together:
 *   - hire + employ the Investor, then take the once-per-turn free market
 *     re-roll end to end (coin-free, action-free, escalation counter advanced);
 *   - relocate the employed Investor to another business for exactly 1 action,
 *     with undo restoring both the action and the previous employment;
 *   - serialize mid-turn and deserialize, asserting the per-turn gate, the
 *     escalated next price and the Investor's location all survive.
 *
 * Detailed per-area assertions live in `investor-free-reroll-engine.test.ts`
 * (relevance/bias/refill), `investor-serialization-undo.test.ts`
 * (save/load/undo) and `staff-placement-commands.test.ts` (movement action
 * gate); this file asserts those slices compose into the intended
 * player-facing loop.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';
import { UndoRedoManager } from '@core-engine';

import {
  setupMainStreetGame,
  serializeMainStreetState,
  deserializeMainStreetState,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  canUseFreeMarketReroll,
  useFreeMarketReroll,
  refreshMarketCost,
  getEmployedInvestorReroll,
} from '../../src/MainStreetMarket';
import {
  createStaffDeck,
  REFRESH_MARKET_COST_STEP,
  MARKET_TOTAL_SLOTS,
  type BusinessCard,
  type StaffCard,
  type SynergyType,
} from '../../src/MainStreetCards';
import { executeWeekStart, placeStaffOnBusiness } from '../../src/MainStreetEngine';
import { placeStaffOnBusinessCommand } from '../../src/MainStreetCommands';

let staffSerial = 0;

/** Builds a business card fixture at a given slot. */
function placeBusinessAt(
  state: MainStreetState,
  slot: number,
  name: string,
  synergy: SynergyType[],
): BusinessCard {
  const biz: BusinessCard = {
    family: 'business',
    id: `biz-${slot}`,
    name,
    cost: 3,
    baseIncome: 2,
    synergyTypes: [...synergy],
    maxLevel: 0,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    description: 'Integration fixture.',
    ongoingCost: 0,
    employedStaff: [],
  };
  state.streetGrid[slot] = biz;
  return biz;
}

/** Hires an Investor card instance into `staffCards` (unplaced). */
function hireInvestor(state: MainStreetState): StaffCard {
  const tpl = createStaffDeck(1).find(c => c.id.startsWith('staff-investor'))!;
  const card = { ...tpl, id: `${tpl.id}-fixture-${staffSerial++}` };
  state.staffCards.push(card);
  return card;
}

function marketPhaseState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  state.phase = 'MarketPhase';
  return state;
}

describe('Investor end-to-end lifecycle (MS-0MUOSUN3O003MA1B)', () => {
  it('hires, employs, re-rolls for free and escalates the next paid price', () => {
    const state = marketPhaseState('investor-e2e');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const investor = hireInvestor(state);
    placeStaffOnBusiness(state, investor.id, 0);

    // The hosting business synergy types and the 75% bias are reported.
    const descriptor = getEmployedInvestorReroll(state);
    expect(descriptor).not.toBeNull();
    expect(descriptor!.synergyTypes).toContain('Food');
    expect(descriptor!.bias).toBe(0.75);

    state.resourceBank.coins = 5000;
    state.actionsRemaining = 2;
    const costBefore = refreshMarketCost(state);

    expect(canUseFreeMarketReroll(state).legal).toBe(true);
    const result = useFreeMarketReroll(state);

    expect(result.cost).toBe(0);
    expect(state.resourceBank.coins).toBe(5000); // coin-free
    expect(state.actionsRemaining).toBe(2); // action-free
    expect(state.investorFreeRerollUsedThisTurn).toBe(true);
    expect(state.market.cards).toHaveLength(MARKET_TOTAL_SLOTS);
    expect(refreshMarketCost(state)).toBe(costBefore + REFRESH_MARKET_COST_STEP);
    expect(canUseFreeMarketReroll(state).legal).toBe(false); // once per turn
  });

  it('relocates the employed Investor for 1 action and undo restores action + location', () => {
    const state = marketPhaseState('investor-move');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 1, 'Gym', ['Health']);
    const investor = hireInvestor(state);
    placeStaffOnBusiness(state, investor.id, 0);
    state.actionsRemaining = 1;

    const mgr = new UndoRedoManager();
    mgr.execute(placeStaffOnBusinessCommand(state, investor.id, 1));

    expect(state.staffCards.find(c => c.id === investor.id)!.employedAtSlot).toBe(1);
    expect(state.actionsRemaining).toBe(0);

    mgr.undo();
    expect(state.actionsRemaining).toBe(1);
    expect(state.staffCards.find(c => c.id === investor.id)!.employedAtSlot).toBe(0);
  });

  it('round-trips the free-reroll gate, escalated price and Investor location through save/load', () => {
    const state = marketPhaseState('investor-save');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const investor = hireInvestor(state);
    placeStaffOnBusiness(state, investor.id, 0);
    state.resourceBank.coins = 5000;

    useFreeMarketReroll(state);
    const escalated = refreshMarketCost(state);
    expect(state.investorFreeRerollUsedThisTurn).toBe(true);

    const restored = deserializeMainStreetState(serializeMainStreetState(state));
    restored.phase = 'MarketPhase';

    expect(restored.investorFreeRerollUsedThisTurn).toBe(true);
    expect(restored.marketRefreshesThisTurn).toBe(state.marketRefreshesThisTurn);
    expect(refreshMarketCost(restored)).toBe(escalated);
    const restoredInvestor = restored.staffCards.find(c => c.id === investor.id);
    expect(restoredInvestor!.employedAtSlot).toBe(0);
    // Availability survives the reload: the free re-roll stays spent.
    expect(canUseFreeMarketReroll(restored).legal).toBe(false);
  });
});
