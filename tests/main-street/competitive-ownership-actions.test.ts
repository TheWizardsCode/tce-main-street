/**
 * Main Street: Competitive Cross-Owner Sell/Close Ownership Tests
 *
 * Leaf MS-0MUVPG9C5004T47L (parent MS-0MUV9P89G0061SRA): in competitive mode a
 * seat may only sell or close a street slot it owns. The gate lives in the
 * legality/command layer (`canSellBusiness`/`sellBusiness`,
 * `canCloseBusiness`/`closeBusiness`) via the shared
 * `canActiveSeatActOnSlot` helper, so UI, AI and headless paths share one
 * source of truth. Single-player states carry no `ownerTaggedGrid`, so the
 * gate is a no-op there.
 *
 * AC references (MS-0MUVPG9C5004T47L):
 *   AC1/AC2: `canSellBusiness` rejects an opponent-owned slot with an
 *            ownership-specific reason; `sellBusiness` throws and mutates
 *            no state.
 *   AC3/AC4: `canCloseBusiness` rejects an opponent-owned slot; a rejected
 *            `closeBusinessCommand` consumes no action and mutates no state.
 *   AC5:     Single-player behaviour is unchanged.
 *   AC6:     Existing phase/sold-slot/action-budget gates are preserved.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import {
  setupMainStreetGame,
  createCompetitiveState,
  type MainStreetState,
} from '../../src/MainStreetState';
import { executeWeekStart, canPlaceFromHand, sellFromTableau, canSellFromTableau } from '../../src/MainStreetEngine';
import type { BusinessCard, UpgradeCard } from '../../src/MainStreetCards';
import { updateNeighborsOnPlacement } from '../../src/MainStreetAdjacency';
import {
  canActiveSeatActOnSlot,
  getSeatLabel,
} from '../../src/MainStreetAdjacencyOwner';
import {
  bindCompetitiveSeat,
  restoreCompetitiveSeat,
} from '../../src/MainStreetAiStrategy';
import {
  sellBusiness,
  canSellBusiness,
  closeBusiness,
  canCloseBusiness,
  canPlayUpgradeFromHand,
  playUpgradeFromHand,
  canPurchaseUpgrade,
  purchaseUpgrade,
  canBuyAndPlaceUpgrade,
  findTargetBusinessSlot,
} from '../../src/MainStreetMarket';
import type { LegalityResult } from '@rule-engine';
import {
  sellBusinessCommand,
  closeBusinessCommand,
} from '../../src/MainStreetCommands';

// ── Fixtures ────────────────────────────────────────────────

/** Deterministic business card for controlled ownership scenarios. */
function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: overrides.id ?? 'biz-test',
    name: overrides.name ?? 'Test Biz',
    cost: overrides.cost ?? 10,
    baseIncome: overrides.baseIncome ?? 5,
    synergyTypes: overrides.synergyTypes ?? [],
    maxLevel: overrides.maxLevel ?? 2,
    description: 'A test business',
    level: overrides.level ?? 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    appliedUpgrades: [],
    ...overrides,
  } as BusinessCard;
}

/** Two-seat competitive state in MarketPhase with a predictable wallet. */
function compState(seed: string = 'comp-ownership'): MainStreetState {
  const state = createCompetitiveState({ seed, playerCount: 2 });
  state.phase = 'MarketPhase';
  state.actionsRemaining = 3;
  state.resourceBank.coins = 10000;
  // Predictable per-seat wallets (reputation 0 → multiplier 1).
  for (const p of state.players!) {
    p.coins = 1000;
    p.reputation = 0;
  }
  return state;
}

/** Single-player state in MarketPhase (no `ownerTaggedGrid`). */
function soloState(seed: string = 'solo-ownership'): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  expect(state.phase).toBe('MarketPhase');
  expect(state.ownerTaggedGrid).toBeUndefined();
  return state;
}

/** Occupies a slot, refreshes adjacency, and tags its owner. */
function place(
  state: MainStreetState,
  card: BusinessCard,
  slot: number,
  ownerId: number,
): void {
  state.streetGrid[slot] = card;
  state.ownerTaggedGrid![slot] = { card, ownerId };
  updateNeighborsOnPlacement(state, slot);
}

/** Asserts an illegal result and returns its reason (narrows the union). */
function illegalReason(result: LegalityResult): string {
  if (result.legal) throw new Error('Expected an illegal legality result');
  return result.reason;
}

// ── Sell ownership gate (AC1/AC2) ───────────────────────────

describe('Competitive sell ownership gate (AC1/AC2)', () => {
  it('rejects selling an AI-owned slot from the human seat with an ownership reason', () => {
    const state = compState('sell-ai');
    state.activePlayerId = 0;
    place(state, makeBiz({ id: 'ai-biz' }), 0, 1);

    const result = canSellBusiness(state, 0);
    expect(result.legal).toBe(false);
    const reason = illegalReason(result);
    expect(reason).toContain('AI 1');
    expect(reason).toMatch(/belongs to/i);
  });

  it('allows the human seat to sell its own business', () => {
    const state = compState('sell-own');
    state.activePlayerId = 0;
    place(state, makeBiz({ id: 'own-biz' }), 0, 0);

    expect(canSellBusiness(state, 0).legal).toBe(true);
  });

  it('defensively rejects an AI seat selling the human-owned business', () => {
    const state = compState('sell-human');
    state.activePlayerId = 1;
    place(state, makeBiz({ id: 'human-biz' }), 0, 0);

    const result = canSellBusiness(state, 0);
    expect(result.legal).toBe(false);
    expect(illegalReason(result)).toMatch(/the player/i);
  });

  it('sellBusiness throws for an opponent-owned slot and mutates no state', () => {
    const state = compState('sell-throw');
    state.activePlayerId = 0;
    const card = makeBiz({ id: 'ai-biz-2' });
    place(state, card, 0, 1);

    const coinsBefore = state.resourceBank.coins;
    const gridBefore = state.streetGrid[0];
    const soldBefore = state.soldSlots[0];
    const logBefore = state.activityLog.length;

    expect(() => sellBusiness(state, 0)).toThrow(/AI 1/);

    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.streetGrid[0]).toBe(gridBefore);
    expect(state.soldSlots[0]).toBe(soldBefore);
    expect(state.activityLog).toHaveLength(logBefore);
  });

  it('credits the owning seat wallet when the owner sells its own business', () => {
    const state = compState('sell-wallet');
    state.activePlayerId = 0;
    // Bind the acting seat so the shared wallet mirrors players[0] during play.
    bindCompetitiveSeat(state, 0);
    place(state, makeBiz({ id: 'own-wallet-biz' }), 0, 0);

    const walletBefore = state.players![0].coins;
    sellBusiness(state, 0);
    restoreCompetitiveSeat(state, 0);

    expect(state.players![0].coins).toBeGreaterThan(walletBefore);
    expect(state.players![1].coins).toBe(1000); // opponent untouched
  });

  it('keeps existing sell gates intact (phase and sold-slot)', () => {
    const state = compState('sell-gates');
    state.activePlayerId = 0;
    place(state, makeBiz({ id: 'own-gates' }), 0, 0);

    state.phase = 'IncomePhase';
    expect(canSellBusiness(state, 0).legal).toBe(false);

    state.phase = 'MarketPhase';
    state.soldSlots[0] = true;
    const soldResult = canSellBusiness(state, 0);
    expect(soldResult.legal).toBe(false);
    expect(illegalReason(soldResult)).toMatch(/sold/i);
  });
});

// ── Close ownership gate (AC3/AC4) ──────────────────────────

describe('Competitive close ownership gate (AC3/AC4)', () => {
  it('rejects closing an AI-owned slot from the human seat', () => {
    const state = compState('close-ai');
    state.activePlayerId = 0;
    place(state, makeBiz({ id: 'ai-close-biz' }), 0, 1);

    const result = canCloseBusiness(state, 0);
    expect(result.legal).toBe(false);
    expect(illegalReason(result)).toContain('AI 1');
  });

  it('closeBusiness throws for an opponent-owned slot', () => {
    const state = compState('close-throw');
    state.activePlayerId = 0;
    const card = makeBiz({ id: 'ai-close-biz-2' });
    place(state, card, 0, 1);

    expect(() => closeBusiness(state, 0)).toThrow(/AI 1/);
    expect(state.streetGrid[0]).toBe(card);
    expect(state.discardPile).toHaveLength(0);
  });

  it('a rejected close command consumes no action', () => {
    const state = compState('close-no-action');
    state.activePlayerId = 0;
    place(state, makeBiz({ id: 'ai-close-biz-3' }), 0, 1);

    const actionsBefore = state.actionsRemaining;
    const bankedBefore = state.bankedActions;

    expect(() => closeBusinessCommand(state, 0).execute()).toThrow(/AI 1/);

    expect(state.actionsRemaining).toBe(actionsBefore);
    expect(state.bankedActions).toBe(bankedBefore);
    expect(state.streetGrid[0]).not.toBeNull();
  });

  it('allows the owner to close its own business and frees the slot', () => {
    const state = compState('close-own');
    state.activePlayerId = 0;
    place(state, makeBiz({ id: 'own-close-biz' }), 0, 0);

    expect(canCloseBusiness(state, 0).legal).toBe(true);
    closeBusiness(state, 0);
    expect(state.streetGrid[0]).toBeNull();
  });

  it('defensively rejects an AI seat closing the human-owned business', () => {
    const state = compState('close-human');
    state.activePlayerId = 1;
    place(state, makeBiz({ id: 'human-close-biz' }), 0, 0);

    expect(canCloseBusiness(state, 0).legal).toBe(false);
    expect(() => closeBusiness(state, 0)).toThrow(/the player/i);
  });
});

// ── Single-player no-op (AC5) ───────────────────────────────

describe('Single-player sell/close unaffected (AC5)', () => {
  it('canSellBusiness/sellBusiness remain legal without an owner-tagged grid', () => {
    const state = soloState('solo-sell');
    state.streetGrid[0] = makeBiz({ id: 'solo-sell-biz' });

    expect(canSellBusiness(state, 0).legal).toBe(true);
    const coinsBefore = state.resourceBank.coins;
    sellBusiness(state, 0);
    expect(state.resourceBank.coins).toBeGreaterThan(coinsBefore);
    expect(state.soldSlots[0]).toBe(true);
  });

  it('canCloseBusiness/closeBusiness remain legal without an owner-tagged grid', () => {
    const state = soloState('solo-close');
    state.streetGrid[0] = makeBiz({ id: 'solo-close-biz' });

    expect(canCloseBusiness(state, 0).legal).toBe(true);
    closeBusiness(state, 0);
    expect(state.streetGrid[0]).toBeNull();
  });
});

// ── Command-level sell guard (AC2 integration) ──────────────

describe('Sell command rejects cross-owner execution', () => {
  it('sellBusinessCommand throws for an opponent-owned slot', () => {
    const state = compState('sell-command');
    state.activePlayerId = 0;
    place(state, makeBiz({ id: 'ai-cmd-biz' }), 0, 1);

    expect(() => sellBusinessCommand(state, 0).execute()).toThrow(/AI 1/);
    expect(state.soldSlots[0]).toBe(false);
  });
});

// ── Upgrade ownership gate (AC3) ────────────────────────────

/**
 * Resolves a level-0 upgrade and its matching business template from the
 * seeded decks so the fixture always satisfies the name/level match rules.
 */
function upgradeFixture(state: MainStreetState): { upgrade: UpgradeCard; business: BusinessCard } {
  const upgrade = state.decks.upgrade.find(
    (u) => (u.requiredLevel ?? 0) === 0,
  ) as UpgradeCard | undefined;
  if (!upgrade) throw new Error('No level-0 upgrade template');
  const business = state.decks.business.find(
    (b) => b.name === upgrade.targetBusiness,
  ) as BusinessCard | undefined;
  if (!business) throw new Error(`No business template named "${upgrade.targetBusiness}"`);
  return { upgrade, business };
}

/** A base-level copy of the fixture business, ready for placement. */
function targetBiz(business: BusinessCard, level: number): BusinessCard {
  return { ...business, level, appliedUpgrades: [] } as BusinessCard;
}

describe('Competitive upgrade ownership gate (AC3)', () => {
  it('canPlayUpgradeFromHand rejects an opponent-owned target', () => {
    const state = compState('up-hand-ai');
    state.activePlayerId = 0;
    const { upgrade, business } = upgradeFixture(state);
    state.hand = [{ ...upgrade }];
    state.resourceBank.coins = 10000;
    place(state, targetBiz(business, upgrade.requiredLevel ?? 0), 0, 1);

    const result = canPlayUpgradeFromHand(state, 0, 0);
    expect(result.legal).toBe(false);
    expect(illegalReason(result)).toContain('AI 1');
  });

  it('canPlayUpgradeFromHand allows the owner to upgrade its own business', () => {
    const state = compState('up-hand-own');
    state.activePlayerId = 0;
    const { upgrade, business } = upgradeFixture(state);
    state.hand = [{ ...upgrade }];
    state.resourceBank.coins = 10000;
    place(state, targetBiz(business, upgrade.requiredLevel ?? 0), 0, 0);

    expect(canPlayUpgradeFromHand(state, 0, 0).legal).toBe(true);
  });

  it('playUpgradeFromHand throws for an opponent-owned target and mutates no state', () => {
    const state = compState('up-play-ai');
    state.activePlayerId = 0;
    const { upgrade, business } = upgradeFixture(state);
    state.hand = [{ ...upgrade }];
    state.resourceBank.coins = 10000;
    const placed = targetBiz(business, upgrade.requiredLevel ?? 0);
    place(state, placed, 0, 1);

    const coinsBefore = state.resourceBank.coins;
    const levelBefore = placed.level;

    expect(() => playUpgradeFromHand(state, 0, 0)).toThrow(/AI 1/);

    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.hand).toHaveLength(1);
    expect(placed.level).toBe(levelBefore);
  });

  it('canPurchaseUpgrade rejects an opponent-owned explicit target', () => {
    const state = compState('up-buy-ai');
    state.activePlayerId = 0;
    const { upgrade, business } = upgradeFixture(state);
    state.market.cards.push({ ...upgrade });
    state.resourceBank.coins = 10000;
    place(state, targetBiz(business, upgrade.requiredLevel ?? 0), 0, 1);

    const result = canPurchaseUpgrade(state, upgrade.id, 0);
    expect(result.legal).toBe(false);
    expect(illegalReason(result)).toContain('AI 1');
  });

  it('default target selection never resolves to an opponent-owned slot', () => {
    const state = compState('up-default');
    state.activePlayerId = 0;
    const { upgrade, business } = upgradeFixture(state);
    state.market.cards.push({ ...upgrade });
    state.resourceBank.coins = 10000;
    const requiredLevel = upgrade.requiredLevel ?? 0;
    // Opponent owns slot 0; the acting seat owns slot 1 — both eligible.
    place(state, targetBiz(business, requiredLevel), 0, 1);
    place(state, targetBiz(business, requiredLevel), 1, 0);

    expect(findTargetBusinessSlot(state, upgrade)).toBe(1);
    expect(canPurchaseUpgrade(state, upgrade.id).legal).toBe(true);
  });

  it('purchaseUpgrade throws for an opponent-owned target and mutates no state', () => {
    const state = compState('up-purchase-ai');
    state.activePlayerId = 0;
    const { upgrade, business } = upgradeFixture(state);
    state.market.cards.push({ ...upgrade });
    state.resourceBank.coins = 10000;
    const placed = targetBiz(business, upgrade.requiredLevel ?? 0);
    place(state, placed, 0, 1);

    const coinsBefore = state.resourceBank.coins;
    const marketBefore = state.market.cards.length;

    expect(() => purchaseUpgrade(state, upgrade.id, 0)).toThrow(/AI 1/);

    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.market.cards).toHaveLength(marketBefore);
    expect(placed.level).toBe(upgrade.requiredLevel ?? 0);
  });

  it('the drag-drop upgrade gate rejects an opponent-owned target', () => {
    const state = compState('up-drag-ai');
    state.activePlayerId = 0;
    const { upgrade, business } = upgradeFixture(state);
    state.market.cards.push({ ...upgrade });
    state.resourceBank.coins = 10000;
    place(state, targetBiz(business, upgrade.requiredLevel ?? 0), 0, 1);

    const result = canBuyAndPlaceUpgrade(state, upgrade.id, 0);
    expect(result.legal).toBe(false);
    expect(illegalReason(result)).toContain('AI 1');
  });

  it('single-player upgrade targeting is unaffected (no owner-tagged grid)', () => {
    const state = soloState('up-solo');
    const { upgrade, business } = upgradeFixture(state);
    state.hand = [{ ...upgrade }];
    state.resourceBank.coins = 10000;
    state.streetGrid[0] = targetBiz(business, upgrade.requiredLevel ?? 0);

    expect(findTargetBusinessSlot(state, upgrade)).toBe(0);
    expect(canPlayUpgradeFromHand(state, 0, 0).legal).toBe(true);
  });
});

// ── Consolidated cross-owner coverage (AC4-AC7) ─────────────

describe('Cross-owner ownership coverage (AC4-AC7)', () => {
  it('a permitted close frees the slot for the owner to place immediately (AC5)', () => {
    const state = compState('close-placeable');
    state.activePlayerId = 0;
    place(state, makeBiz({ id: 'own-close-free' }), 0, 0);
    closeBusiness(state, 0);

    const held = makeBiz({ id: 'held-after-close', cost: 5, baseIncome: 2 });
    state.hand.push(held);
    state.resourceBank.coins = Math.max(state.resourceBank.coins, held.cost);

    expect(canPlaceFromHand(state, 0, 0).legal).toBe(true);
  });

  it('an AI seat can upgrade its own business (positive competitive case)', () => {
    const state = compState('up-ai-own');
    state.activePlayerId = 1;
    const { upgrade, business } = upgradeFixture(state);
    state.hand = [{ ...upgrade }];
    state.resourceBank.coins = 10000;
    place(state, targetBiz(business, upgrade.requiredLevel ?? 0), 0, 1);

    expect(canPlayUpgradeFromHand(state, 0, 0).legal).toBe(true);
  });

  it('sell, close and upgrade all return the same ownership-specific reason (AC7)', () => {
    const state = compState('reasons');
    state.activePlayerId = 0;
    const { upgrade } = upgradeFixture(state);
    state.market.cards.push({ ...upgrade });
    state.resourceBank.coins = 10000;
    place(state, makeBiz({ id: 'reason-biz' }), 0, 1);

    const expected = 'That business belongs to AI 1.';
    expect(illegalReason(canSellBusiness(state, 0))).toBe(expected);
    expect(illegalReason(canCloseBusiness(state, 0))).toBe(expected);
    expect(illegalReason(canPurchaseUpgrade(state, upgrade.id, 0))).toBe(expected);
  });

  it('the shared ownership gate is a no-op in single-player (AC5/AC6)', () => {
    const state = soloState('gate-solo');
    state.streetGrid[0] = makeBiz({ id: 'gate-solo-biz' });
    expect(canActiveSeatActOnSlot(state, 0).legal).toBe(true);
  });

  it('the shared ownership gate rejects the non-owner and labels the owner (AC7)', () => {
    const state = compState('gate-comp');
    state.activePlayerId = 0;
    place(state, makeBiz({ id: 'gate-comp-biz' }), 0, 1);

    const result = canActiveSeatActOnSlot(state, 0);
    expect(result.legal).toBe(false);
    expect(illegalReason(result)).toBe('That business belongs to AI 1.');
    expect(getSeatLabel(1)).toBe('AI 1');
    expect(getSeatLabel(0)).toBe('the player');
  });
});

// ── Legacy tableau sell path guard (MS-0MUVPGAG9005KFEA) ────

describe('Legacy tableau sell path honours the ownership gate', () => {
  it('canSellFromTableau rejects an opponent-owned slot', () => {
    const state = compState('legacy-can');
    state.activePlayerId = 0;
    place(state, makeBiz({ id: 'legacy-ai-biz' }), 0, 1);

    const result = canSellFromTableau(state, 0);
    expect(result.legal).toBe(false);
    expect(illegalReason(result)).toContain('AI 1');
  });

  it('sellFromTableau throws for an opponent-owned slot and mutates no state', () => {
    const state = compState('legacy-throw');
    state.activePlayerId = 0;
    const card = makeBiz({ id: 'legacy-ai-biz-2' });
    place(state, card, 0, 1);

    const coinsBefore = state.resourceBank.coins;
    const discardBefore = state.discardPile.length;

    expect(() => sellFromTableau(state, 0)).toThrow(/AI 1/);

    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.streetGrid[0]).toBe(card);
    expect(state.discardPile).toHaveLength(discardBefore);
  });

  it('the owner can sell its own business via the legacy path', () => {
    const state = compState('legacy-own');
    state.activePlayerId = 0;
    place(state, makeBiz({ id: 'legacy-own-biz', cost: 20 }), 0, 0);

    expect(canSellFromTableau(state, 0).legal).toBe(true);
    const coinsBefore = state.resourceBank.coins;
    sellFromTableau(state, 0);
    expect(state.resourceBank.coins).toBeGreaterThan(coinsBefore);
    expect(state.streetGrid[0]).toBeNull();
  });

  it('single-player legacy sell is unaffected (no owner-tagged grid)', () => {
    const state = soloState('legacy-solo');
    state.streetGrid[0] = makeBiz({ id: 'legacy-solo-biz' });

    expect(canSellFromTableau(state, 0).legal).toBe(true);
    sellFromTableau(state, 0);
    expect(state.streetGrid[0]).toBeNull();
  });
});
