/**
 * Main Street: Staff movement (1-action-point relocation)
 * (MS-0MUOSUKUC004G2VO, parent MS-0MTISBYLS009936W — "Add Investor staff
 * members"; parent AC4 "All staff relocation costs an action point").
 *
 * The action gate for relocation already lives in
 * `placeStaffOnBusinessCommand` (MS-0MUOSUNYR0073SI1). This file covers the
 * explicit movement API added by this item:
 *   - `canMoveStaffOnBusiness` / `moveStaffOnBusiness` relocate an employed
 *     member to another business, enforcing `allowedBusinessTypes` and
 *     employment-slot capacity through the shared placement engine;
 *   - `moveStaffCommand` charges exactly 1 action point, is undoable/redoable
 *     (restoring employment and the spent action) and refuses an illegal move
 *     without spending an action;
 *   - a relocation survives a serialize/deserialize round-trip.
 *
 * The initial placement of a newly-hired member stays action-free and is
 * covered by `staff-placement-commands.test.ts`.
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
  createStaffDeck,
  type StaffCard,
  type BusinessCard,
  type SynergyType,
} from '../../src/MainStreetCards';
import {
  canMoveStaffOnBusiness,
  canPlaceStaffOnBusiness,
  placeStaffOnBusiness,
  moveStaffOnBusiness,
  getEmployedStaffCountAt,
  executeWeekStart,
} from '../../src/MainStreetEngine';
import { moveStaffCommand } from '../../src/MainStreetCommands';

// ── Fixtures ────────────────────────────────────────────────

/** Places a business card fixture at a given slot. */
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
    description: 'Movement fixture.',
    ongoingCost: 0,
    employedStaff: [],
  };
  state.streetGrid[slot] = biz;
  return biz;
}

/** Hires a staff template into the state's staffCards with a unique id. */
let staffSerial = 0;
function hire(state: MainStreetState, idPrefix: string): StaffCard {
  const tpl = createStaffDeck(1).find(c => c.id.startsWith(idPrefix))!;
  const card = { ...tpl, id: `${tpl.id}-move-${staffSerial++}` };
  state.staffCards.push(card);
  return card;
}

function freshState(seed = 'staff-move'): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  return state;
}

const employedAt = (state: MainStreetState, staffId: string): number | undefined =>
  state.staffCards.find(c => c.id === staffId)?.employedAtSlot;

const employedIdsAt = (state: MainStreetState, slot: number): string[] =>
  ((state.streetGrid[slot] as BusinessCard | undefined)?.employedStaff ?? []).map(m => m.id);

// ── Engine: canMoveStaffOnBusiness / moveStaffOnBusiness ────

describe('moveStaffOnBusiness relocates an employed member', () => {
  it('deregisters from the source business and registers at the destination', () => {
    const state = freshState();
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 2, 'Diner', ['Food']);
    const chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, chef.id, 0);

    expect(canMoveStaffOnBusiness(state, chef.id, 2).legal).toBe(true);
    moveStaffOnBusiness(state, chef.id, 2);

    expect(employedAt(state, chef.id)).toBe(2);
    expect(employedIdsAt(state, 0)).not.toContain(chef.id);
    expect(employedIdsAt(state, 2)).toContain(chef.id);
    expect(getEmployedStaffCountAt(state, 0)).toBe(0);
    expect(getEmployedStaffCountAt(state, 2)).toBe(1);
  });

  it('rejects a member that is not currently employed (that is a placement, not a move)', () => {
    const state = freshState();
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const chef = hire(state, 'staff-chef');

    // Initial placement is still legal via the action-free placement path...
    expect(canPlaceStaffOnBusiness(state, chef.id, 0).legal).toBe(true);
    // ...but it is not a move.
    const legality = canMoveStaffOnBusiness(state, chef.id, 0);
    expect(legality.legal).toBe(false);
    expect((legality as { reason?: string }).reason ?? '').toMatch(/not currently employed/i);
    expect(() => moveStaffOnBusiness(state, chef.id, 0)).toThrow(/not currently employed/i);
    expect(employedAt(state, chef.id)).toBeUndefined();
  });

  it('rejects a move to the business the member already works at', () => {
    const state = freshState();
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, chef.id, 0);

    const legality = canMoveStaffOnBusiness(state, chef.id, 0);
    expect(legality.legal).toBe(false);
    expect((legality as { reason?: string }).reason ?? '').toMatch(/already employed/i);
  });

  it('respects allowedBusinessTypes (no state change on rejection)', () => {
    const state = freshState();
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 1, 'Hardware Store', ['Service']);
    const chef = hire(state, 'staff-chef'); // Cafe|Diner|Food|Delicatessen
    placeStaffOnBusiness(state, chef.id, 0);

    const legality = canMoveStaffOnBusiness(state, chef.id, 1);
    expect(legality.legal).toBe(false);
    expect((legality as { reason?: string }).reason ?? '').toMatch(/type does not match/i);
    expect(() => moveStaffOnBusiness(state, chef.id, 1)).toThrow(/type does not match/i);
    expect(employedAt(state, chef.id)).toBe(0);
    expect(employedIdsAt(state, 1)).toHaveLength(0);
  });

  it('respects employment-slot capacity at the destination', () => {
    const state = freshState();
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 1, 'Diner', ['Food']);
    const chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, chef.id, 0);

    // Fill the destination to its level-0 capacity (1).
    const assistant = hire(state, 'staff-assistant'); // generalist
    placeStaffOnBusiness(state, assistant.id, 1);

    const legality = canMoveStaffOnBusiness(state, chef.id, 1);
    expect(legality.legal).toBe(false);
    expect((legality as { reason?: string }).reason ?? '').toMatch(/no free employment slots/i);
    expect(() => moveStaffOnBusiness(state, chef.id, 1)).toThrow(/no free employment slots/i);
    expect(employedAt(state, chef.id)).toBe(0);
  });

  it('rejects an empty destination slot', () => {
    const state = freshState();
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, chef.id, 0);

    expect(() => moveStaffOnBusiness(state, chef.id, 3)).toThrow(/empty slot/i);
    expect(employedAt(state, chef.id)).toBe(0);
  });
});

// ── Command: moveStaffCommand action economy + undo/redo ────

describe('moveStaffCommand costs 1 action point', () => {
  it('charges exactly 1 action and is undoable/redoable', () => {
    const state = freshState();
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 2, 'Diner', ['Food']);
    const chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, chef.id, 0);
    state.actionsRemaining = 2;

    const mgr = new UndoRedoManager();
    mgr.execute(moveStaffCommand(state, chef.id, 2));

    expect(employedAt(state, chef.id)).toBe(2);
    expect(state.actionsRemaining).toBe(1);

    mgr.undo();
    expect(employedAt(state, chef.id)).toBe(0);
    expect(employedIdsAt(state, 0)).toContain(chef.id);
    expect(employedIdsAt(state, 2)).not.toContain(chef.id);
    expect(state.actionsRemaining).toBe(2);

    mgr.redo();
    expect(employedAt(state, chef.id)).toBe(2);
    expect(state.actionsRemaining).toBe(1);
  });

  it('does not charge an action for an illegal move', () => {
    const state = freshState();
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 1, 'Hardware Store', ['Service']);
    const chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, chef.id, 0);
    state.actionsRemaining = 1;

    expect(() => new UndoRedoManager().execute(moveStaffCommand(state, chef.id, 1)))
      .toThrow(/type does not match/i);
    expect(state.actionsRemaining).toBe(1);
    expect(employedAt(state, chef.id)).toBe(0);
  });

  it('rejects a relocation with no actions remaining (employment unchanged)', () => {
    const state = freshState();
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 2, 'Diner', ['Food']);
    const chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, chef.id, 0);
    state.actionsRemaining = 0;

    expect(() => new UndoRedoManager().execute(moveStaffCommand(state, chef.id, 2)))
      .toThrow(/No actions remaining/);
    expect(state.actionsRemaining).toBe(0);
    expect(employedAt(state, chef.id)).toBe(0);
    expect(employedAt(state, chef.id)).not.toBe(2);
  });
});

// ── Persistence ─────────────────────────────────────────────

describe('staff relocation is persisted', () => {
  it('serialize/deserialize round-trips the new employment only', () => {
    const state = freshState('staff-move-save');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 2, 'Diner', ['Food']);
    const chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, chef.id, 0);

    moveStaffOnBusiness(state, chef.id, 2);
    expect(employedAt(state, chef.id)).toBe(2);

    const restored = deserializeMainStreetState(serializeMainStreetState(state));

    expect(restored.staffCards.find(c => c.id === chef.id)!.employedAtSlot).toBe(2);
    expect(employedIdsAt(restored, 2)).toContain(chef.id);
    expect(employedIdsAt(restored, 0)).not.toContain(chef.id);
    expect(getEmployedStaffCountAt(restored, 2)).toBe(1);
    expect(getEmployedStaffCountAt(restored, 0)).toBe(0);
  });
});
