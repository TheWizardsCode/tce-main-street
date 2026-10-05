/**
 * Main Street: non-mutating upgrade-play legality predicate
 * (child of MS-0MUUYD15V003SP0Z / CG-0MUUDWIXG009IB0W).
 *
 * `canPlayUpgradeFromHand` must match `playUpgradeFromHand`'s checks without
 * mutating state, so the UI can reject an illegal attempt before animating or
 * spending an action. These tests exercise the predicate via the public
 * market API and assert both legality and the absence of mutation.
 *
 * @module tests/main-street/upgrade-legality-precheck
 */
import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import {
  canPlayUpgradeFromHand,
  playUpgradeFromHand,
  effectiveUpgradeCost,
} from '../../src/MainStreetMarket';
import type { BusinessCard, UpgradeCard } from '../../src/MainStreetCards';
import type { LegalityResult } from '@rule-engine';

function createState(seed = 'upgrade-precheck'): MainStreetState {
  return setupMainStreetGame({ seed });
}

/** Narrows an illegal LegalityResult to its reason (fails the test otherwise). */
function illegalReason(result: LegalityResult): string {
  if (result.legal) throw new Error('Expected an illegal result but got legal');
  return result.reason;
}

/** Picks the first level-0 upgrade and a matching base-level business. */
function fixture(): { upgrade: UpgradeCard; business: BusinessCard } {
  const state = createState();
  const upgrade = state.decks.upgrade.find(u => (u.requiredLevel ?? 0) === 0) as UpgradeCard;
  if (!upgrade) throw new Error('No level-0 upgrade template');
  const biz = state.decks.business.find(b => b.name === upgrade.targetBusiness) as BusinessCard;
  if (!biz) throw new Error(`No business template named "${upgrade.targetBusiness}"`);
  return { upgrade, business: biz };
}

function placeBusiness(state: MainStreetState, biz: BusinessCard, slot = 0, level = 0): void {
  state.streetGrid[slot] = { ...biz, level, appliedUpgrades: [] } as BusinessCard;
}

describe('canPlayUpgradeFromHand (non-mutating predicate)', () => {
  it('is legal when coins cover the discounted cost and the target is eligible', () => {
    const state = createState('ok');
    state.phase = 'MarketPhase';
    const { upgrade, business } = fixture();
    state.hand = [{ ...upgrade }];
    placeBusiness(state, business, 0, upgrade.requiredLevel ?? 0);
    state.resourceBank.coins = effectiveUpgradeCost(state, upgrade, 0);

    const result = canPlayUpgradeFromHand(state, 0, 0);
    expect(result.legal).toBe(true);
  });

  it('is illegal when coins are below the effective cost', () => {
    const state = createState('poor');
    state.phase = 'MarketPhase';
    const { upgrade, business } = fixture();
    state.hand = [{ ...upgrade }];
    placeBusiness(state, business, 0, upgrade.requiredLevel ?? 0);
    state.resourceBank.coins = effectiveUpgradeCost(state, upgrade, 0) - 1;

    const beforeCoins = state.resourceBank.coins;
    const beforeHand = state.hand.length;
    const beforeGrid = state.streetGrid[0];

    const result = canPlayUpgradeFromHand(state, 0, 0);
    expect(result.legal).toBe(false);
    expect(illegalReason(result)).toMatch(/not enough coins/i);

    // No mutation
    expect(state.resourceBank.coins).toBe(beforeCoins);
    expect(state.hand).toHaveLength(beforeHand);
    expect(state.streetGrid[0]).toBe(beforeGrid);
  });

  it('is illegal when the target business has the wrong level', () => {
    const state = createState('wrong-level');
    const { upgrade, business } = fixture();
    state.hand = [{ ...upgrade }];
    // Place the business at a level that cannot take this upgrade.
    placeBusiness(state, business, 0, (upgrade.requiredLevel ?? 0) + 1);
    state.resourceBank.coins = 10000;

    const result = canPlayUpgradeFromHand(state, 0, 0);
    expect(result.legal).toBe(false);
    expect(illegalReason(result)).toMatch(/not a valid target/i);
  });

  it('is illegal when the hand card is not an upgrade', () => {
    const state = createState('wrong-family');
    const { business } = fixture();
    state.hand = [{ ...business }];

    const result = canPlayUpgradeFromHand(state, 0, 0);
    expect(result.legal).toBe(false);
    expect(illegalReason(result)).toMatch(/not an upgrade card/i);
  });

  it('is illegal for an invalid hand index', () => {
    const state = createState('bad-index');
    const result = canPlayUpgradeFromHand(state, 99, 0);
    expect(result.legal).toBe(false);
    expect(illegalReason(result)).toMatch(/invalid hand index/i);
  });

  it('agrees with playUpgradeFromHand on the insufficient-coins outcome', () => {
    const state = createState('agree');
    state.phase = 'MarketPhase';
    const { upgrade, business } = fixture();
    state.hand = [{ ...upgrade }];
    placeBusiness(state, business, 0, upgrade.requiredLevel ?? 0);
    state.resourceBank.coins = 0;

    const predicate = canPlayUpgradeFromHand(state, 0, 0);
    expect(predicate.legal).toBe(false);
    expect(() => playUpgradeFromHand(state, 0, 0)).toThrow(/Not enough coins/i);
  });
});
