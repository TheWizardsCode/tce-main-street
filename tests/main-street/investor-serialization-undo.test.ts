/**
 * Main Street: Investor serialization + undo/redo coverage
 * (MS-0MUOSULA8005MUCY, parent MS-0MTISBYLS009936W).
 *
 * Covers the save/load and undo slice of the Investor feature (parent AC6):
 *   - the per-turn free-re-roll gate and the shared escalation counter it
 *     advances participate in `snapshotAction` undo/redo (`freeMarketRerollCommand`);
 *   - `MainStreetStateSerialize` round-trips the gate, the escalation counter
 *     and the Investor's location (`staffCards` + per-business `employedStaff`);
 *   - a mid-turn reload preserves both availability and the escalated next price;
 *   - the biased draw stays seeded-deterministic across save/load.
 *
 * The engine-level behaviour (cost, bias, WeekStart reset) is covered by
 * `investor-free-reroll-engine.test.ts`; this file asserts only the
 * serialization/undo contract of the new state fields.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import { UndoRedoManager } from '@core-engine/UndoRedoManager';

import {
  setupMainStreetGame,
  serializeMainStreetState,
  deserializeMainStreetState,
  type MainStreetState,
} from '../../src/MainStreetState';
import { freeMarketRerollCommand } from '../../src/MainStreetCommands';
import {
  canUseFreeMarketReroll,
  getEmployedInvestorReroll,
  refreshMarketCost,
  useFreeMarketReroll,
} from '../../src/MainStreetMarket';
import {
  REFRESH_MARKET_COST,
  REFRESH_MARKET_COST_STEP,
  createStaffDeck,
  type BusinessCard,
  type StaffCard,
  type SynergyType,
} from '../../src/MainStreetCards';
import { executeWeekStart, placeStaffOnBusiness } from '../../src/MainStreetEngine';

// ── Fixtures ────────────────────────────────────────────────

/** Places a minimal business card fixture at a slot. */
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
    description: 'Investor serialization fixture.',
    ongoingCost: 0,
    employedStaff: [],
  };
  state.streetGrid[slot] = biz;
  return biz;
}

/** Hires an Investor template into `staffCards` with a unique id. */
let staffSerial = 0;
function hireInvestor(state: MainStreetState): StaffCard {
  const tpl = createStaffDeck(1).find(c => c.id.startsWith('staff-investor'))!;
  const card = { ...tpl, id: `${tpl.id}-fixture-${staffSerial++}` };
  state.staffCards.push(card);
  return card;
}

/** Builds a MarketPhase state with an Investor employed at `slot`. */
function marketPhaseWithInvestor(seed: string, slot = 0): {
  state: MainStreetState;
  investor: StaffCard;
} {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  state.phase = 'MarketPhase';
  placeBusinessAt(state, slot, 'Bakery', ['Food']);
  const investor = hireInvestor(state);
  placeStaffOnBusiness(state, investor.id, slot);
  return { state, investor };
}

const rowIds = (state: MainStreetState): string[] => state.market.cards.map(c => c.id);

// ── Undo / redo ─────────────────────────────────────────────

describe('Investor free re-roll undo/redo (MS-0MUOSULA8005MUCY)', () => {
  it('snapshotAction captures the gate, the escalation counter and the row', () => {
    const { state } = marketPhaseWithInvestor('investor-undo');
    const before = rowIds(state);
    expect(canUseFreeMarketReroll(state).legal).toBe(true);

    const manager = new UndoRedoManager();
    manager.execute(freeMarketRerollCommand(state));

    // Forward: free re-roll consumed and the paid price escalated.
    expect(state.investorFreeRerollUsedThisTurn).toBe(true);
    expect(state.marketRefreshesThisTurn).toBe(1);
    expect(canUseFreeMarketReroll(state).legal).toBe(false);
    expect(refreshMarketCost(state)).toBe(REFRESH_MARKET_COST + REFRESH_MARKET_COST_STEP);

    // Undo: availability, escalation counter and the visible row are restored.
    manager.undo();
    expect(state.investorFreeRerollUsedThisTurn).toBe(false);
    expect(state.marketRefreshesThisTurn).toBe(0);
    expect(rowIds(state)).toEqual(before);
    expect(canUseFreeMarketReroll(state).legal).toBe(true);
    expect(refreshMarketCost(state)).toBe(REFRESH_MARKET_COST);

    // Redo: the gate and counter advance again (the draw re-runs).
    manager.redo();
    expect(state.investorFreeRerollUsedThisTurn).toBe(true);
    expect(state.marketRefreshesThisTurn).toBe(1);
    expect(canUseFreeMarketReroll(state).legal).toBe(false);
  });
});

// ── Save / load ─────────────────────────────────────────────

describe('Investor state serialization (MS-0MUOSULA8005MUCY)', () => {
  it('round-trips the Investor location (staffCards + per-business employedStaff)', () => {
    const { state, investor } = marketPhaseWithInvestor('investor-location', 3);

    const restored = deserializeMainStreetState(serializeMainStreetState(state));

    const restoredInvestor = restored.staffCards.find(c => c.id === investor.id)!;
    expect(restoredInvestor).toBeDefined();
    expect(restoredInvestor.employedAtSlot).toBe(3);
    expect(
      restored.streetGrid[3]?.employedStaff?.some(m => m.id === investor.id),
    ).toBe(true);

    // The relevance key (hosting business synergy types) survives the reload.
    const descriptor = getEmployedInvestorReroll(restored)!;
    expect(descriptor.slotIndex).toBe(3);
    expect(descriptor.synergyTypes).toEqual(['Food']);

    restored.phase = 'MarketPhase';
    expect(canUseFreeMarketReroll(restored).legal).toBe(true);
  });

  it('reloading mid-turn preserves availability and the escalated next price', () => {
    const { state } = marketPhaseWithInvestor('investor-save-escalation');
    useFreeMarketReroll(state);
    expect(state.investorFreeRerollUsedThisTurn).toBe(true);
    expect(state.marketRefreshesThisTurn).toBe(1);

    const restored = deserializeMainStreetState(serializeMainStreetState(state));
    restored.phase = 'MarketPhase';

    expect(restored.investorFreeRerollUsedThisTurn).toBe(true);
    expect(restored.marketRefreshesThisTurn).toBe(1);
    expect(canUseFreeMarketReroll(restored).legal).toBe(false);
    expect(refreshMarketCost(restored)).toBe(REFRESH_MARKET_COST + REFRESH_MARKET_COST_STEP);
  });

  it('backfills missing Investor fields to safe defaults for legacy saves', () => {
    const { state } = marketPhaseWithInvestor('investor-legacy');
    const saved = serializeMainStreetState(state) as unknown as Record<string, unknown>;
    delete saved.investorFreeRerollUsedThisTurn;
    delete saved.marketRefreshesThisTurn;

    const restored = deserializeMainStreetState(saved as never);
    expect(restored.investorFreeRerollUsedThisTurn).toBe(false);
    expect(restored.marketRefreshesThisTurn).toBe(0);
    expect(refreshMarketCost(restored)).toBe(REFRESH_MARKET_COST);
  });

  it('keeps the biased draw deterministic across a save/load boundary', () => {
    const { state } = marketPhaseWithInvestor('investor-save-determinism');
    const restored = deserializeMainStreetState(serializeMainStreetState(state));

    const original = useFreeMarketReroll(state);
    const reloaded = useFreeMarketReroll(restored);

    expect(reloaded.replaced.map(c => c.id)).toEqual(original.replaced.map(c => c.id));
    expect(rowIds(restored)).toEqual(rowIds(state));
  });
});
