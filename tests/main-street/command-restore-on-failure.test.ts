/**
 * Main Street: Command-layer restore-on-throw (child of MS-0MUUYAZPN0064AW5)
 *
 * Ensures that snapshotAction.do() restores actionsRemaining / bankedActions
 * when the wrapped doFn throws — i.e. the command layer is now as robust as
 * the engine's executeAction path.
 *
 * Tests exercise the command construction + UndoRedoManager.execute() path
 * (the exact code path used by UI handlers), asserting that:
 *   - Insufficient-coin placement throws AND leaves budget/coins/hand unchanged
 *   - Insufficient-coin upgrade throws AND leaves budget/coins/business unchanged
 *   - Successful execution consumes the action exactly once (no double-decrement)
 *   - Undo of a successful execution restores the action exactly
 */
import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
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
import { type BusinessCard } from '../../src/MainStreetCards';

// ── Helpers ────────────────────────────────────────────────────────

function createState(seed = 'cmd-restore-test'): MainStreetState {
  return setupMainStreetGame({ seed });
}

function makeManager(): UndoRedoManager {
  return new UndoRedoManager();
}

// ── snapshotAction restore on throw ────────────────────────────────

describe('snapshotAction restore-on-throw', () => {
  // -- playBusinessFromHandCommand --

  it('playBusinessFromHandCommand restores actions on insufficient coins', () => {
    const state = createState('pbh-icoins');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0; // not enough for any business
    const beforeActions = state.actionsRemaining;
    const beforeBanked = state.bankedActions;
    const beforeCoins = state.resourceBank.coins;
    const card = state.decks.business[0]!;
    state.hand = [{ ...card }];

    const manager = makeManager();
    expect(() => manager.execute(playBusinessFromHandCommand(state, 0, 1))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.bankedActions).toBe(beforeBanked);
    expect(state.resourceBank.coins).toBe(beforeCoins);
    expect(state.hand).toHaveLength(1); // card still in hand
  });

  it('playBusinessFromHandCommand restores actions on occupied slot', () => {
    const state = createState('pbh-occupied');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1600; // enough
    const beforeActions = state.actionsRemaining;
    const card = state.decks.business[0]!;
    state.hand = [{ ...card }];

    // Fill slot 0
    const placed: BusinessCard = { ...card, level: 0 } as BusinessCard;
    state.streetGrid[0] = placed;

    const manager = makeManager();
    expect(() => manager.execute(playBusinessFromHandCommand(state, 0, 0))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  // -- playUpgradeFromHandCommand --

  it('playUpgradeFromHandCommand restores actions on insufficient coins', () => {
    const state = createState('puh-icoins');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;
    const beforeActions = state.actionsRemaining;
    const beforeCoins = state.resourceBank.coins;
    const upgrade = state.decks.upgrade[0]!;
    state.hand = [{ ...upgrade }];

    // Put a business on the street to be the upgrade target
    const biz = state.decks.business[0]!;
    state.streetGrid[0] = { ...biz, level: 0 } as BusinessCard;

    const manager = makeManager();
    expect(() => manager.execute(playUpgradeFromHandCommand(state, 0, 0))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.resourceBank.coins).toBe(beforeCoins);
    expect(state.hand).toHaveLength(1);
  });

  // -- buyAndPlaceBusinessCommand --

  it('buyAndPlaceBusinessCommand restores actions on occupied slot', () => {
    const state = createState('bap-occupied');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1600;
    const beforeActions = state.actionsRemaining;
    const card = state.market.cards[0]!;

    // Fill slot 0
    const placed: BusinessCard = { ...card, level: 0 } as BusinessCard;
    state.streetGrid[0] = placed;

    const manager = makeManager();
    expect(() => manager.execute(buyAndPlaceBusinessCommand(state, card.id, 0))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  // -- buyAndPlaceUpgradeCommand --

  it('buyAndPlaceUpgradeCommand restores actions on insufficient coins', () => {
    const state = createState('bapu-icoins');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;
    const beforeActions = state.actionsRemaining;
    const upgrade = state.market.cards.find(c => c.family === 'upgrade');
    if (!upgrade) return;

    // Put a business on the street as target
    const biz = state.decks.business[0]!;
    state.streetGrid[0] = { ...biz, level: 0 } as BusinessCard;

    const manager = makeManager();
    expect(() =>
      manager.execute(buyAndPlaceUpgradeCommand(state, upgrade.id, 0)),
    ).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  // -- moveToHandCommand --

  it('moveToHandCommand restores actions when card not found', () => {
    const state = createState('mth-nofound');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;

    const manager = makeManager();
    expect(() => manager.execute(moveToHandCommand(state, 'nonexistent'))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  // -- hireStaffCardCommand --

  it('hireStaffCardCommand restores actions on insufficient coins', () => {
    const state = createState('hsc-icoins');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;
    const beforeActions = state.actionsRemaining;
    const staff = state.market.cards.find(c => c.family === 'staff');
    if (!staff) return;

    const manager = makeManager();
    expect(() => manager.execute(hireStaffCardCommand(state, staff.id))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  // -- closeBusinessCommand --

  it('closeBusinessCommand restores actions on invalid slot', () => {
    const state = createState('cb-invalid');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;

    const manager = makeManager();
    expect(() => manager.execute(closeBusinessCommand(state, 99))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  // -- sellBusinessCommand --

  it('sellBusinessCommand restores actions on invalid slot', () => {
    const state = createState('sb-invalid');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;

    const manager = makeManager();
    expect(() => manager.execute(sellBusinessCommand(state, 99))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  // -- discardFromHandCommand --

  it('discardFromHandCommand restores actions on invalid hand index', () => {
    const state = createState('dfh-invalid');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;

    const manager = makeManager();
    expect(() => manager.execute(discardFromHandCommand(state, 99))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  // -- resolveEventChoiceCommand --

  it('resolveEventChoiceCommand restores actions when no pending event', () => {
    const state = createState('rec-nopending');
    state.phase = 'MarketPhase';
    const beforeActions = state.actionsRemaining;

    const manager = makeManager();
    expect(() => manager.execute(resolveEventChoiceCommand(state, 'accept'))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  // -- refreshMarketCommand --

  it('refreshMarketCommand restores actions on insufficient coins', () => {
    const state = createState('rm-icoins');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;
    const beforeActions = state.actionsRemaining;

    const manager = makeManager();
    expect(() => manager.execute(refreshMarketCommand(state))).toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  it('refreshMarketCommand succeeds without consuming action when coins are available', () => {
    // refreshMarket costs coins but does NOT consume a daily action.
    const state = createState('rm-ok');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 500;
    const beforeActions = state.actionsRemaining;

    const manager = makeManager();
    expect(() => manager.execute(refreshMarketCommand(state))).not.toThrow();

    expect(state.actionsRemaining).toBe(beforeActions);
  });

  // -- Successful execution: single action consumption --

  it('successful playBusinessFromHandCommand consumes action exactly once', () => {
    const state = createState('pbh-ok');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1600;
    const beforeActions = state.actionsRemaining;
    const card = state.decks.business[0]!;
    state.hand = [{ ...card }];

    const manager = makeManager();
    expect(() => manager.execute(playBusinessFromHandCommand(state, 0, 1))).not.toThrow();

    expect(state.actionsRemaining).toBe(beforeActions - 1);
    expect(state.hand).toHaveLength(0); // card moved to street
  });

  // -- Undo restores action --

  it('undo of successful playBusinessFromHandCommand restores action', () => {
    const state = createState('pbh-undo');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1600;
    const beforeActions = state.actionsRemaining;
    const card = state.decks.business[0]!;
    state.hand = [{ ...card }];

    const manager = makeManager();
    manager.execute(playBusinessFromHandCommand(state, 0, 1));
    expect(state.actionsRemaining).toBe(beforeActions - 1);

    manager.undo();
    expect(state.actionsRemaining).toBe(beforeActions);
    expect(state.hand).toHaveLength(1); // card back in hand
  });
});
