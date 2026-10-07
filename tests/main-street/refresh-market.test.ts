/**
 * Main Street: Single-Row Market & From-Hand Contract Tests
 *
 * Defines the single-row marketplace contract (CG-0MSTOATDT009BRX2):
 *   AC1: exactly 3 visible cards, always ≥1 business card, drawn randomly
 *        within "1–2 business, 0–1 upgrade, 0–1 event" (2B+1U / 2B+1E /
 *        1B+1U+1E). Community-space cards count as business.
 *   AC2: one re-roll: `refreshMarket` costs `REFRESH_MARKET_COST` (500) on the
 *        first re-roll of a turn, then 750, then 1000, +250 each time
 *        (MS-0MTR6ZRF5007PWNZ); the escalation resets at WeekStart; Accountant
 *        `refreshCostDiscount` applies to the escalated base; discards all
 *        currently-visible cards and refills the whole line.
 *   AC3: `moveToHand` is free of coins (bounded only by `maxHandSize`);
 *        direct buy-and-place still pays immediately.
 *   AC4: cost-at-play — business pays on placement; upgrade/event pays when
 *        played/triggered.
 *   AC5: `discardFromHand` is free any time during the player's turn and
 *        sends the card to its corresponding discard pile.
 *   AC6: `maxHandSize` base is 3, growable via staff `handSlotsAdded`.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, serializeMainStreetState, deserializeMainStreetState, type MainStreetState } from '../../src/MainStreetState';
import { UndoRedoManager } from '@core-engine/UndoRedoManager';
import { refreshMarketCommand } from '../../src/MainStreetCommands';
import {
  MARKET_TOTAL_SLOTS,
  MARKET_BUSINESS_MIN,
  MARKET_BUSINESS_MAX,
  MARKET_UPGRADE_MAX,
  MARKET_EVENT_MAX,
  REFRESH_MARKET_COST,
  REFRESH_MARKET_COST_STEP,
  createStaffDeck,
  createEventDeck,
  createBusinessDeck,
} from '../../src/MainStreetCards';
import {
  canRefreshMarket,
  refreshMarket,
  refreshMarketCost,
  moveToHand,
  canAddToHand,
  playBusinessFromHand,
  playUpgradeFromHand,
  playEventFromHand,
  discardFromHand,
  purchaseBusiness,
  canPurchaseBusiness,
  purchaseStaffCard,
} from '../../src/MainStreetMarket';
import { executeWeekStart } from '../../src/MainStreetEngine';

function createTestState(seed = 'single-row-market-test'): MainStreetState {
  return setupMainStreetGame({ seed });
}

function countInRow(state: MainStreetState, family: string): number {
  return state.market.cards.filter(c => c.family === family).length;
}

function countBusinessInRow(state: MainStreetState): number {
  return state.market.cards.filter(
    c => c.family === 'business' || c.family === 'community-space',
  ).length;
}

// ── AC1: single-row composition ───────────────────────────────

describe('AC1: single-row market composition', () => {
  it('shows exactly MARKET_TOTAL_SLOTS (3) cards per day', () => {
    const state = createTestState('composition-count');
    expect(state.market.cards).toHaveLength(MARKET_TOTAL_SLOTS);
    expect(MARKET_TOTAL_SLOTS).toBe(3);
  });

  it('always includes at least 1 business card (community-space counts)', () => {
    const state = createTestState('composition-business');
    expect(countBusinessInRow(state)).toBeGreaterThanOrEqual(MARKET_BUSINESS_MIN);
  });

  it('stays within the 1–2 business / 0–1 upgrade / 0–1 event bounds', () => {
    // Multiple seeds exercise the random composition paths deterministically.
    const seeds = ['comp-a', 'comp-b', 'comp-c', 'comp-d', 'comp-e', 'comp-f'];
    for (const seed of seeds) {
      const state = createTestState(seed);
      const business = countBusinessInRow(state);
      const upgrades = countInRow(state, 'upgrade');
      const events = countInRow(state, 'event');
      expect(business, seed).toBeGreaterThanOrEqual(MARKET_BUSINESS_MIN);
      expect(business, seed).toBeLessThanOrEqual(MARKET_BUSINESS_MAX);
      expect(upgrades, seed).toBeLessThanOrEqual(MARKET_UPGRADE_MAX);
      expect(events, seed).toBeLessThanOrEqual(MARKET_EVENT_MAX);
      expect(state.market.cards, seed).toHaveLength(MARKET_TOTAL_SLOTS);
    }
  });

  it('is deterministic for the same seed', () => {
    const a = createTestState('composition-determinism');
    const b = createTestState('composition-determinism');
    expect(a.market.cards.map(c => c.id)).toEqual(b.market.cards.map(c => c.id));
  });
});

// ── AC2: single €5 re-roll ────────────────────────────────────

describe('AC2: refreshMarket re-roll', () => {
  it('costs REFRESH_MARKET_COST (500) on the first re-roll with no staff discounts', () => {
    expect(REFRESH_MARKET_COST).toBe(500);
    expect(REFRESH_MARKET_COST_STEP).toBe(250);
    const state = createTestState('refresh-cost');
    state.phase = 'MarketPhase';
    expect(state.marketRefreshesThisTurn).toBe(0);
    expect(refreshMarketCost(state)).toBe(REFRESH_MARKET_COST);
  });

  it('is legal during MarketPhase with sufficient coins, illegal otherwise', () => {
    const state = createTestState('refresh-legal');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = REFRESH_MARKET_COST;
    expect(canRefreshMarket(state).legal).toBe(true);

    state.phase = 'WeekStart';
    expect(canRefreshMarket(state).legal).toBe(false);

    state.phase = 'MarketPhase';
    state.resourceBank.coins = REFRESH_MARKET_COST - 1;
    expect(canRefreshMarket(state).legal).toBe(false);
  });

  it('deducts coins, discards visible cards, and refills to full composition', () => {
    const state = createTestState('refresh-exec');
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = REFRESH_MARKET_COST * 2;

    const visibleBefore = state.market.cards.map(c => c.id);
    expect(visibleBefore.length).toBeGreaterThan(0);
    const coinsBefore = state.resourceBank.coins;

    const result = refreshMarket(state);

    expect(state.resourceBank.coins).toBe(coinsBefore - REFRESH_MARKET_COST);
    expect(result.cost).toBe(REFRESH_MARKET_COST);

    // Removed cards were discarded to their corresponding piles.
    const discarded = [
      ...state.discards.business.map(c => c.id),
      ...state.discards.communitySpace.map(c => c.id),
      ...state.discards.upgrade.map(c => c.id),
      ...state.discards.event.map(c => c.id),
      ...state.discards.staff.map(c => c.id),
    ];
    for (const id of result.replaced.map(c => c.id)) {
      expect(discarded).toContain(id);
    }

    // Refilled to the full composition.
    expect(state.market.cards).toHaveLength(MARKET_TOTAL_SLOTS);
    expect(countBusinessInRow(state)).toBeGreaterThanOrEqual(MARKET_BUSINESS_MIN);
  });

  it('applies the Accountant refreshCostDiscount to the re-roll cost', () => {
    const state = createTestState('refresh-accountant');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = REFRESH_MARKET_COST * 10;
    expect(refreshMarketCost(state)).toBe(REFRESH_MARKET_COST);

    const accountant = createStaffDeck(1).find(c => c.id.startsWith('staff-accountant'));
    expect(accountant).toBeTruthy();
    // Staff cards are hired from the general market row (CG-0MT3KZOBZ005IRYE)
    state.market.cards.push({ ...accountant! });
    state.resourceBank.coins = 5000;
    purchaseStaffCard(state, accountant!.id);

    expect(refreshMarketCost(state)).toBe(REFRESH_MARKET_COST - 100);
    // 400 coins is enough with the discount (500 - 100), but not without.
    state.resourceBank.coins = REFRESH_MARKET_COST - 100;
    expect(canRefreshMarket(state).legal).toBe(true);
    const coinsBefore = state.resourceBank.coins;
    refreshMarket(state);
    expect(state.resourceBank.coins).toBe(coinsBefore - (REFRESH_MARKET_COST - 100));
  });

  it('escalates 500 → 750 → 1000 across re-rolls in the same turn', () => {
    const state = createTestState('refresh-escalation');
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 100000;

    const coinsBefore = state.resourceBank.coins;
    expect(refreshMarket(state).cost).toBe(500);
    expect(refreshMarketCost(state)).toBe(750);
    expect(refreshMarket(state).cost).toBe(750);
    expect(refreshMarketCost(state)).toBe(1000);
    expect(refreshMarket(state).cost).toBe(1000);
    expect(state.marketRefreshesThisTurn).toBe(3);
    expect(refreshMarketCost(state)).toBe(1250);

    // Total charged is the sum of the escalating costs, not 3× the base.
    expect(state.resourceBank.coins).toBe(coinsBefore - (500 + 750 + 1000));
    expect(state.market.cards).toHaveLength(MARKET_TOTAL_SLOTS);
  });

  it('resets the escalation to the 500 base at WeekStart', () => {
    const state = createTestState('refresh-reset');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 100000;
    refreshMarket(state);
    refreshMarket(state);
    expect(state.marketRefreshesThisTurn).toBe(2);
    expect(refreshMarketCost(state)).toBe(1000);

    state.phase = 'WeekStart';
    executeWeekStart(state);

    expect(state.marketRefreshesThisTurn).toBe(0);
    expect(refreshMarketCost(state)).toBe(REFRESH_MARKET_COST);
    expect(refreshMarket(state).cost).toBe(REFRESH_MARKET_COST);
  });

  it('applies staff discounts to the escalated base', () => {
    const state = createTestState('refresh-escalation-discount');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 100000;

    const accountant = createStaffDeck(1).find(c => c.id.startsWith('staff-accountant'))!;
    state.market.cards.push({ ...accountant });
    purchaseStaffCard(state, accountant.id);

    // First re-roll: 500 - 100 = 400.
    expect(refreshMarket(state).cost).toBe(REFRESH_MARKET_COST - 100);
    // Second re-roll: 750 - 100 = 650 (the discount applies to the escalated base).
    expect(refreshMarketCost(state)).toBe(REFRESH_MARKET_COST + REFRESH_MARKET_COST_STEP - 100);
    expect(refreshMarket(state).cost).toBe(REFRESH_MARKET_COST + REFRESH_MARKET_COST_STEP - 100);
  });

  it('undoes a re-roll, restoring both the coins and the escalation counter', () => {
    const state = createTestState('refresh-undo');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 100000;

    const coinsBefore = state.resourceBank.coins;
    const manager = new UndoRedoManager();
    manager.execute(refreshMarketCommand(state));

    expect(state.marketRefreshesThisTurn).toBe(1);
    expect(state.resourceBank.coins).toBe(coinsBefore - REFRESH_MARKET_COST);
    expect(refreshMarketCost(state)).toBe(REFRESH_MARKET_COST + REFRESH_MARKET_COST_STEP);

    manager.undo();

    expect(state.marketRefreshesThisTurn).toBe(0);
    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(refreshMarketCost(state)).toBe(REFRESH_MARKET_COST);
  });

  it('persists the escalation across save/load (reloading mid-turn keeps the price)', () => {
    const state = createTestState('refresh-save-load');
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 100000;
    refreshMarket(state);
    refreshMarket(state);
    expect(state.marketRefreshesThisTurn).toBe(2);

    const restored = deserializeMainStreetState(serializeMainStreetState(state));
    expect(restored.marketRefreshesThisTurn).toBe(2);
    restored.phase = 'MarketPhase';
    expect(refreshMarketCost(restored)).toBe(
      REFRESH_MARKET_COST + 2 * REFRESH_MARKET_COST_STEP,
    );
  });

  it('backfills the counter to 0 for legacy saves (no NaN cost)', () => {
    const state = createTestState('refresh-legacy');
    state.phase = 'MarketPhase';
    const saved = serializeMainStreetState(state) as unknown as Record<string, unknown>;
    delete saved.marketRefreshesThisTurn;

    const restored = deserializeMainStreetState(saved as never);
    expect(restored.marketRefreshesThisTurn).toBe(0);
    expect(refreshMarketCost(restored)).toBe(REFRESH_MARKET_COST);
  });
});

// ── AC3: free move-to-hand + preserved direct buy-and-place ───

describe('AC3: moveToHand is free; direct buy-and-place pays immediately', () => {
  it('moves a market card to hand without charging coins', () => {
    const state = createTestState('move-free');
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0; // no money needed to move

    const card = state.market.cards[0];
    const coinsBefore = state.resourceBank.coins;

    const result = moveToHand(state, card.id);

    expect(result.cost).toBe(0);
    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.hand.some(h => h.id === card.id)).toBe(true);
    expect(state.market.cards.some(c => c.id === card.id)).toBe(false);
    // Market is not refilled mid-turn after moves.
    expect(state.market.cards.length).toBe(MARKET_TOTAL_SLOTS - 1);
  });

  it('is bounded only by maxHandSize', () => {
    const state = createTestState('move-bound');
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;

    // Move all movable (non-staff) cards into the hand (hand holds up to 3).
    // Staff cards are hired directly and never enter the hand (CG-0MT3KZNQB0053K55),
    // so when a staff card occupies a row slot, top up the row with a business
    // card to prove the hand-capacity bound still holds.
    while (canAddToHand(state).legal) {
      const idx = state.market.cards.findIndex(c => c.family !== 'staff');
      if (idx === -1) {
        const topup = createBusinessDeck(1, ['biz-bakery']).find(c => c.id.startsWith('biz-bakery'))!;
        state.market.cards.push(topup);
        continue;
      }
      moveToHand(state, state.market.cards[idx].id);
    }
    expect(state.hand.length).toBeLessThanOrEqual(state.maxHandSize);
    expect(canAddToHand(state).legal).toBe(false);
  });

  it('rejects a move when the hand is full', () => {
    const state = createTestState('move-full');
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;

    while (canAddToHand(state).legal) {
      const idx = state.market.cards.findIndex(c => c.family !== 'staff');
      if (idx === -1) {
        const topup = createBusinessDeck(1, ['biz-bakery']).find(c => c.id.startsWith('biz-bakery'))!;
        state.market.cards.push(topup);
        continue;
      }
      moveToHand(state, state.market.cards[idx].id);
    }
    expect(state.hand.length).toBe(state.maxHandSize);
    // Re-seed the (now full) row with one card to exercise the rejection path.
    const extra = createBusinessDeck(1, ['biz-bakery']).find(c => c.id.startsWith('biz-bakery'))!;
    state.market.cards.push(extra);
    expect(() => moveToHand(state, extra.id)).toThrow(/full/i);
  });

  it('direct buy-and-place still pays immediately', () => {
    const state = createTestState('direct-buy');
    executeWeekStart(state);
    state.phase = 'MarketPhase';

    const card = state.market.cards.find(
      c => (c.family === 'business' || c.family === 'community-space') && c.cost <= state.resourceBank.coins,
    );
    if (!card) return;

    const coinsBefore = state.resourceBank.coins;
    const slot = state.streetGrid.findIndex(s => s === null);
    const result = purchaseBusiness(state, card.id, slot);

    expect(result.cost).toBe(card.cost);
    expect(state.resourceBank.coins).toBe(coinsBefore - card.cost);
    expect(state.streetGrid[slot]?.id).toBe(card.id);
    expect(state.hand.length).toBe(0);
  });

  it('direct buy-and-place is still legality-checked', () => {
    const state = createTestState('direct-buy-legal');
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 1; // below most card costs

    const card = state.market.cards.find(c => c.family === 'business' || c.family === 'community-space');
    if (!card) return;
    const slot = state.streetGrid.findIndex(s => s === null);
    const result = canPurchaseBusiness(state, card.id, slot);
    // If the cheapest visible card is unaffordable, the purchase is illegal.
    expect(result.legal).toBe(state.resourceBank.coins >= card.cost);
  });
});

// ── AC4: cost-at-play ─────────────────────────────────────────

describe('AC4: cost-at-play from hand', () => {
  it('charges a business card only when placed from hand', () => {
    const state = createTestState('pay-on-place');
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 5000;

    const card = state.market.cards.find(c => c.family === 'business' || c.family === 'community-space')!;
    moveToHand(state, card.id);
    // Moving is free — no deduction yet.
    expect(state.resourceBank.coins).toBe(5000);

    const coinsBefore = state.resourceBank.coins;
    const slot = state.streetGrid.findIndex(s => s === null);
    const result = playBusinessFromHand(state, state.hand.findIndex(h => h.id === card.id), slot);

    expect(result.cost).toBe(card.cost);
    expect(state.resourceBank.coins).toBe(coinsBefore - card.cost);
    expect(state.streetGrid[slot]?.id).toBe(card.id);
    expect(state.hand.some(h => h.id === card.id)).toBe(false);
  });

  it('rejects placing from hand when the player cannot afford the cost', () => {
    const state = createTestState('pay-on-place-broke');
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;

    const card = state.market.cards.find(c => c.family === 'business' || c.family === 'community-space');
    if (!card) return;
    moveToHand(state, card.id);
    const handIndex = state.hand.findIndex(h => h.id === card.id);
    const slot = state.streetGrid.findIndex(s => s === null);

    expect(() => playBusinessFromHand(state, handIndex, slot)).toThrow(/coins/i);
    expect(state.hand.length).toBe(1); // card not lost
  });

  it('charges an upgrade card when played from hand onto a business', () => {
    const state = createTestState('pay-upgrade');
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 5000;

    // Place a business first so an upgrade has a target.
    const biz = state.market.cards.find(c => c.family === 'business' || c.family === 'community-space');
    if (!biz) return;
    const upgrade = state.market.cards.find(c => c.family === 'upgrade' && c.targetBusiness === biz.name);
    if (!upgrade) return; // row may not contain a matching upgrade this seed

    // Buy-and-place the business, move the upgrade to hand.
    purchaseBusiness(state, biz.id, 0);
    moveToHand(state, upgrade.id);
    const handIndex = state.hand.findIndex(h => h.id === upgrade.id);

    const coinsBefore = state.resourceBank.coins;
    const result = playUpgradeFromHand(state, handIndex, 0);

    expect(result.cost).toBe(upgrade.cost);
    expect(state.resourceBank.coins).toBe(coinsBefore - upgrade.cost);
    expect(state.streetGrid[0]!.appliedUpgrades).toContain(upgrade.id);
  });

  it('charges an event card when played from hand (cost-at-play)', () => {
    const state = createTestState('pay-event');
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 5000;

    // Deterministic SpecificSynergy event (Local Festival): with an empty
    // street grid its resolution grants 0 coins, so the exact cost is charged.
    const fest = createEventDeck(1, ['evt-festival'], () => 0)
      .find(c => c.id.startsWith('evt-festival'))!;
    expect(fest.trigger).toBe('Investment');
    expect(fest.target).toBe('SpecificSynergy');
    state.market.cards = [fest];

    moveToHand(state, fest.id);
    const handIndex = state.hand.findIndex(h => h.id === fest.id);
    const coinsBefore = state.resourceBank.coins;

    const result = playEventFromHand(state, handIndex);

    expect(result.cost).toBe(fest.cost);
    expect(state.resourceBank.coins).toBe(coinsBefore - fest.cost);
    expect(state.hand.some(h => h.id === fest.id)).toBe(false);
    // Played events are consumed (resolved) — they do not return to any
    // discard pile (same semantics as the legacy playHeldEvent).
    expect(state.discards.event.some(c => c.id === fest.id)).toBe(false);
  });
});

// ── AC5: free discard-from-hand ───────────────────────────────

describe('AC5: discardFromHand', () => {
  it('is free and sends the card to its corresponding discard pile', () => {
    const state = createTestState('discard-free');
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;

    const card = state.market.cards[0];
    moveToHand(state, card.id);
    const handIndex = state.hand.findIndex(h => h.id === card.id);
    const coinsBefore = state.resourceBank.coins;

    discardFromHand(state, handIndex);

    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.hand.length).toBe(0);
    if (card.family === 'business') {
      expect(state.discards.business.some(c => c.id === card.id)).toBe(true);
    } else if (card.family === 'community-space') {
      expect(state.discards.communitySpace.some(c => c.id === card.id)).toBe(true);
    } else if (card.family === 'upgrade') {
      expect(state.discards.upgrade.some(c => c.id === card.id)).toBe(true);
    } else {
      expect(state.discards.event.some(c => c.id === card.id)).toBe(true);
    }
  });

  it('is allowed any time during the player turn', () => {
    const state = createTestState('discard-phase');
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;

    const card = state.market.cards[0];
    moveToHand(state, card.id);
    expect(() => discardFromHand(state, state.hand.findIndex(h => h.id === card.id))).not.toThrow();
  });
});

// ── AC6: hand capacity ────────────────────────────────────────

describe('AC6: maxHandSize base 3, growable', () => {
  it('defaults to 3', () => {
    const state = createTestState('hand-base');
    expect(state.maxHandSize).toBe(3);
  });

  it('grows via staff handSlotsAdded (no hard cap)', () => {
    const state = createTestState('hand-grow');
    state.resourceBank.coins = 5000;

    const assistant = createStaffDeck(1).find(c => c.id.startsWith('staff-assistant'))!;
    // Staff cards are hired from the general market row (CG-0MT3KZOBZ005IRYE)
    state.market.cards.push({ ...assistant });
    purchaseStaffCard(state, assistant.id);
    expect(state.maxHandSize).toBe(3 + assistant.handSlotsAdded);

    const manager = createStaffDeck(1).find(c => c.id.startsWith('staff-manager'))!;
    state.market.cards.push({ ...manager });
    purchaseStaffCard(state, manager.id);
    expect(state.maxHandSize).toBe(3 + assistant.handSlotsAdded + manager.handSlotsAdded);
  });

  it('allows holding more than 3 cards once grown', () => {
    const state = createTestState('hand-grown-hold');
    executeWeekStart(state);
    state.phase = 'MarketPhase';
    state.resourceBank.coins = 0;

    const assistant = createStaffDeck(1).find(c => c.id.startsWith('staff-assistant'))!;
    // Staff cards are hired from the general market row (CG-0MT3KZOBZ005IRYE)
    state.market.cards.push({ ...assistant });
    state.resourceBank.coins = 5000;
    purchaseStaffCard(state, assistant.id);
    const capacity = state.maxHandSize;
    expect(capacity).toBe(4);

    // Move movable (non-staff) cards; top up the row with business cards
    // when a staff card occupies the last row slot (CG-0MT3KZNQB0053K55).
    while (state.hand.length < capacity) {
      const idx = state.market.cards.findIndex(c => c.family !== 'staff');
      if (idx === -1) {
        const topup = createBusinessDeck(1, ['biz-pawnshop']).find(c => c.id.startsWith('biz-pawnshop'))!;
        state.market.cards.push(topup);
        continue;
      }
      moveToHand(state, state.market.cards[idx].id);
    }
    expect(state.hand.length).toBe(capacity);
});

});
