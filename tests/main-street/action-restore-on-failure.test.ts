/**
 * Main Street: Action restore on failure (CG-0MTW1KAD4003XGLU)
 *
 * Ensures that a daily action is NOT consumed when the underlying operation
 * throws an error. Two layers are covered:
 *
 * 1. the engine `executeAction` path (already correct), and
 * 2. the command layer's `snapshotAction.do()` restore-on-throw
 *    (CG-0MUUDWIXG009IB0W / MS-0MUUYAZPN0064AW5) — this is the path the UI
 *    click/drag handlers use, so a failed command must remove the spent action
 *    exactly as the engine path does.
 */
import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import { executeAction } from '../../src/MainStreetEngine';
import { type BusinessCard, type StaffCard } from '../../src/MainStreetCards';
import {
  playBusinessFromHandCommand,
  playUpgradeFromHandCommand,
  buyAndPlaceBusinessCommand,
  buyAndPlaceUpgradeCommand,
  moveToHandCommand,
  hireStaffCardCommand,
  closeBusinessCommand,
  sellBusinessCommand,
  discardFromHandCommand,
  resolveEventChoiceCommand,
  refreshMarketCommand,
} from '../../src/MainStreetCommands';
import { UndoRedoManager } from '@core-engine/UndoRedoManager';

// ── Helpers ────────────────────────────────────────────────────────

function createState(seed = 'action-restore-test'): MainStreetState {
  return setupMainStreetGame({ seed });
}

/** New undo manager per test (the command layer's restore path). */
function makeManager(): UndoRedoManager {
  return new UndoRedoManager();
}

function placeBusiness(state: MainStreetState, slotIndex: number): BusinessCard {
  const card = state.decks.business[0]!;
  state.streetGrid[slotIndex] = { ...card, level: 0 };
  return state.streetGrid[slotIndex]!;
}

// ── move-to-hand ───────────────────────────────────────────────────

describe('move-to-hand', () => {
  it('restores action when card is not found in market', () => {
    const state = createState('mth-nofound');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;

    expect(() =>
      executeAction(state, { type: 'move-to-hand', cardId: 'nonexistent' }),
    ).toThrow('not found');

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
  });

  it('restores action when trying to move a staff card to hand', () => {
    const state = createState('mth-staff');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;

    // Place a staff card in the market
    const staff = { ...state.decks.staff[0]!, family: 'staff' as const } as StaffCard;
    state.market.cards = [staff];

    expect(() =>
      executeAction(state, { type: 'move-to-hand', cardId: staff.id }),
    ).toThrow('cannot be moved to hand');

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
  });
});

// ── buy-business ───────────────────────────────────────────────────

describe('buy-business', () => {
  it('restores action when card is not found in market', () => {
    const state = createState('bb-nofound');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1000;
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;

    expect(() =>
      executeAction(state, { type: 'buy-business', cardId: 'nonexistent', slotIndex: 0 }),
    ).toThrow('not found');

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
  });

  it('restores action when slot is occupied', () => {
    const state = createState('bb-occupied');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1000;
    // Provide enough coins for the business (cost 1400 at start)
    state.resourceBank.coins = 1400;
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;

    // Pre-fill a slot
    placeBusiness(state, 0);
    const card = state.market.cards[0]!;

    expect(() =>
      executeAction(state, { type: 'buy-business', cardId: card.id, slotIndex: 0 }),
    ).toThrow('occupied');

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
  });

  it('restores action when insufficient funds', () => {
    const state = createState('bb-insufficient');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;

    const card = state.market.cards[0]!;

    expect(() =>
      executeAction(state, { type: 'buy-business', cardId: card.id, slotIndex: 1 }),
    ).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
  });
});

// ── play-business-from-hand ────────────────────────────────────────

describe('play-business-from-hand', () => {
  it('restores action when hand index is out of bounds', () => {
    const state = createState('pbh-index');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;

    expect(() =>
      executeAction(state, { type: 'play-business-from-hand', handIndex: 99, slotIndex: 1 }),
    ).toThrow('No card at hand index');

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
  });

  it('restores action when slot is occupied', () => {
    const state = createState('pbh-occupied');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1000;
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;

    // Put a business card in hand
    const biz = state.decks.business[0]!;
    state.hand = [{ ...biz }];
    // Pre-fill the slot
    placeBusiness(state, 0);

    expect(() =>
      executeAction(state, { type: 'play-business-from-hand', handIndex: 0, slotIndex: 0 }),
    ).toThrow('occupied');

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
  });
});

// ── buy-and-place ──────────────────────────────────────────────────

describe('buy-and-place', () => {
  it('restores action when slot is occupied', () => {
    const state = createState('bap-occupied');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1000;
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;

    // Pre-fill the slot
    placeBusiness(state, 0);
    const card = state.market.cards[0]!;

    expect(() =>
      executeAction(state, { type: 'buy-and-place', cardId: card.id, slotIndex: 0 }),
    ).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
  });
});

// ── hire-staff ─────────────────────────────────────────────────────

describe('hire-staff', () => {
  it('restores action when card not found', () => {
    const state = createState('hs-nofound');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;

    expect(() =>
      executeAction(state, { type: 'hire-staff', cardId: 'nonexistent' }),
    ).toThrow('not found');

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
  });

  it('restores action when insufficient funds', () => {
    const state = createState('hs-insufficient');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;

    const staff = state.market.cards.find(c => c.family === 'staff');
    if (staff) {
      expect(() =>
        executeAction(state, { type: 'hire-staff', cardId: staff.id }),
      ).toThrow();

      expect(state.actionsRemaining).toBe(beforeActions);
      expect(state.bankedActions).toBe(beforeBanked);
    }
  });
});

// ── buy-event ──────────────────────────────────────────────────────

describe('buy-event', () => {
  it('restores action when card not found', () => {
    const state = createState('be-nofound');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;

    expect(() =>
      executeAction(state, { type: 'buy-event', cardId: 'nonexistent' }),
    ).toThrow('not found');

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
  });
});

// ── play-upgrade-from-hand (same-week composite) ────────────────────

describe('play-upgrade-from-hand', () => {
  it('restores action when target business not found on street', () => {
    const state = createState('puh-target');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1000;
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;

    // Put an upgrade in hand
    const upgrade = state.decks.upgrade[0]!;
    state.hand = [{ ...upgrade }];
    // No businesses on the street — target will not be found

    expect(() =>
      executeAction(state, { type: 'play-upgrade-from-hand', handIndex: 0, targetSlot: 0 }),
    ).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
  });
});

// ── Action budget is NOT incremented on success ────────────────────

describe('action budget integrity on success', () => {
  it('does NOT restore actions on successful move-to-hand', () => {
    const state = createState('success-mth');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;

    const card = state.market.cards[0]!;
    executeAction(state, { type: 'move-to-hand', cardId: card.id });

    expect(state.actionsRemaining).toBe(beforeActions - 1);
  });

  it('does NOT restore actions on successful buy-business', () => {
    const state = createState('success-bb');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1600;
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;

    const card = state.market.cards[0]!;
    const result = executeAction(state, {
      type: 'buy-business', cardId: card.id, slotIndex: 1,
    });

    expect(result).not.toBeNull();
    expect(state.actionsRemaining).toBe(beforeActions - 1);
    expect(state.bankedActions).toBe(Math.max(0, beforeBanked - 1));
  });
});

// ── Command-layer restore-on-throw (MS-0MUUYAZPN0064AW5) ───────────
//
// All action-consuming command factories now wrap their forward mutation in
// `snapshotAction`, which restores the pre-snapshot action budget when the
// operation throws. These tests drive the commands through an UndoRedoManager
// (the exact code path UI handlers use) and assert nothing is spent.

describe('command-layer restore-on-throw', () => {
  // ── The two cases named by AC5 ────────────────────────────────────

  it('playBusinessFromHandCommand with insufficient coins leaves action/coins/hand unchanged', () => {
    const state = createState('cmd-pbh-icoins');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;
    const beforeCoins = state.resourceBank.coins;
    const card = state.decks.business[0]!;
    state.hand = [{ ...card }];

    expect(() => makeManager().execute(playBusinessFromHandCommand(state, 0, 1))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
    expect(state.resourceBank.coins).toBe(beforeCoins);
    expect(state.hand).toHaveLength(1); // card still in hand
  });

  it('playUpgradeFromHandCommand with insufficient coins leaves action/coins/hand unchanged', () => {
    const state = createState('cmd-puh-icoins');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;
    const beforeCoins = state.resourceBank.coins;
    const upgrade = state.decks.upgrade[0]!;
    state.hand = [{ ...upgrade }];
    // A matching business must exist for the target check to pass, so the
    // failure is specifically affordability (not target eligibility).
    const biz = state.decks.business.find(b => b.name === upgrade.targetBusiness) ?? state.decks.business[0]!;
    state.streetGrid[0] = { ...biz, level: upgrade.requiredLevel ?? 0 } as BusinessCard;

    expect(() => makeManager().execute(playUpgradeFromHandCommand(state, 0, 0))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
    expect(state.resourceBank.coins).toBe(beforeCoins);
    expect(state.hand).toHaveLength(1);
  });

  // ── Other action-consuming commands ──────────────────────────────

  it('playBusinessFromHandCommand restores actions on occupied slot', () => {
    const state = createState('cmd-pbh-occupied');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1600;
    const beforeActions = state.actionsRemaining;
    const card = state.decks.business[0]!;
    state.hand = [{ ...card }];
    state.streetGrid[0] = { ...card, level: 0 } as BusinessCard;

    expect(() => makeManager().execute(playBusinessFromHandCommand(state, 0, 0))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  it('buyAndPlaceBusinessCommand restores actions on occupied slot', () => {
    const state = createState('cmd-bap-occupied');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1600;
    const beforeActions = state.actionsRemaining;
    const card = state.market.cards[0]!;
    state.streetGrid[0] = { ...card, level: 0 } as BusinessCard;

    expect(() => makeManager().execute(buyAndPlaceBusinessCommand(state, card.id, 0))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  it('buyAndPlaceUpgradeCommand restores actions on insufficient coins', () => {
    const state = createState('cmd-bapu-icoins');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;
    const beforeActions = state.actionsRemaining;
    const upgrade = state.market.cards.find(c => c.family === 'upgrade');
    if (!upgrade) return;
    const biz = state.decks.business.find(b => b.name === (upgrade as any).targetBusiness) ?? state.decks.business[0]!;
    state.streetGrid[0] = { ...biz, level: (upgrade as any).requiredLevel ?? 0 } as BusinessCard;

    expect(() => makeManager().execute(buyAndPlaceUpgradeCommand(state, upgrade.id, 0))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  it('moveToHandCommand restores actions when card not found', () => {
    const state = createState('cmd-mth-nofound');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;

    expect(() => makeManager().execute(moveToHandCommand(state, 'nonexistent'))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  it('hireStaffCardCommand restores actions on insufficient coins', () => {
    const state = createState('cmd-hsc-icoins');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;
    const beforeActions = state.actionsRemaining;
    const staff = state.market.cards.find(c => c.family === 'staff');
    if (!staff) return;

    expect(() => makeManager().execute(hireStaffCardCommand(state, staff.id))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  it('closeBusinessCommand restores actions on invalid slot', () => {
    const state = createState('cmd-cb-invalid');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;

    expect(() => makeManager().execute(closeBusinessCommand(state, 99))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  it('sellBusinessCommand restores actions on invalid slot', () => {
    const state = createState('cmd-sb-invalid');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;

    expect(() => makeManager().execute(sellBusinessCommand(state, 99))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  it('discardFromHandCommand restores actions on invalid hand index', () => {
    const state = createState('cmd-dfh-invalid');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;

    expect(() => makeManager().execute(discardFromHandCommand(state, 99))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  it('resolveEventChoiceCommand restores actions when no pending event', () => {
    const state = createState('cmd-rec-nopending');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;

    expect(() => makeManager().execute(resolveEventChoiceCommand(state, 'accept'))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  it('refreshMarketCommand restores actions on insufficient coins', () => {
    const state = createState('cmd-rm-icoins');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;
    const beforeActions = state.actionsRemaining;

    expect(() => makeManager().execute(refreshMarketCommand(state))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  // ── Success paths: exactly one action, undo restores exactly ──────

  it('successful playBusinessFromHandCommand consumes the action exactly once', () => {
    const state = createState('cmd-pbh-ok');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1600;
    const beforeActions = state.actionsRemaining;
    const card = state.decks.business[0]!;
    state.hand = [{ ...card }];

    expect(() => makeManager().execute(playBusinessFromHandCommand(state, 0, 1))).not.toThrow();

    expect(state.actionsRemaining).toBe(beforeActions - 1);
    expect(state.hand).toHaveLength(0); // card moved to the street
  });

  it('undo of a successful command restores the action and hand exactly', () => {
    const state = createState('cmd-pbh-undo');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1600;
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;
    const card = state.decks.business[0]!;
    state.hand = [{ ...card }];

    const manager = makeManager();
    manager.execute(playBusinessFromHandCommand(state, 0, 1));
    expect(state.actionsRemaining).toBe(beforeActions - 1);

    manager.undo();
    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
    expect(state.hand).toHaveLength(1); // card back in hand
  });

  it('redo of a successful command re-consumes the action exactly once', () => {
    const state = createState('cmd-pbh-redo');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1600;
    const beforeActions = state.actionsRemaining;
    const card = state.decks.business[0]!;
    state.hand = [{ ...card }];

    const manager = makeManager();
    manager.execute(playBusinessFromHandCommand(state, 0, 1));
    manager.undo();
    expect(state.actionsRemaining).toBe(beforeActions);

    manager.redo();
    expect(state.actionsRemaining).toBe(beforeActions - 1);
    expect(state.hand).toHaveLength(0);
  });
});
