/**
 * Main Street: Grand Opening projection parity
 * (MS-0MVCS89X70034IPI, parent MS-0MV8KSPFK006HTXG).
 *
 * Test-first contract for the Feature-3 AI/projection parity work
 * (implementing child MS-0MVCS8A0L0000H7X): every projection/AI path that
 * estimates an `evt-grand-opening` payout must agree with the actual dynamic
 * resolution — the payout tracks the synergy of the card placed THIS turn
 * (`placedSynergiesThisTurn`, Feature 1 MS-0MVCS1NOH0074YY2; resolution-time
 * dynamics, Feature 2 MS-0MVCS7LIA003J2SM), NOT the card's static CSV
 * `targetSynergy: Commerce`.
 *
 * Acceptance Criteria:
 *  1. Single-player: `projectEventCoinDelta` == actual `resolveEvent` payout
 *     for a Food-placement scenario.
 *  2. Competitive: `computeCompetitiveEventValue` == per-owner
 *     `computeOwnerEventDeltas` payout.
 *  3. Piggyback projection path equals the expected dynamic reward.
 *  4. `scoreEventAction` value consistent with the dynamic payout.
 *  5. Animation attribution (`attachUpcomingDeltas`, MainStreetAdjacencyScoring)
 *     marks the same dynamic-match slots. Full suite passes.
 *
 * Red-phase convention (repo test-first tracer bullet, follow MS-0MVCS7LMP001QYPM):
 * the projection-parity cases below were authored `it.fails` — they FAILED
 * against the previous code, which still projected `evt-grand-opening` against
 * the static Commerce target (`projectEventCoinDelta` Sc/MainStreetEngineScoring,
 * `countOwnSynergyMatches` scoped to `event.targetSynergy` in
 * MainStreetAiStrategy, `attachUpcomingDeltas` slot attribution) — and are now
 * active `it` cases, flipped by the implementing child (MS-0MVCS8A0L0000H7X)
 * once the dynamic projection landed via the shared `eventSynergyTargets`
 * resolver. The piggyback projection seam (AC3) was already dynamic via
 * `computeOwnerEventDeltas` (Feature 2), so its cases stay plain `it`: they
 * pin the parity contract the other paths have now moved to.
 *
 * Every scenario uses a seeded game state plus deterministic fixture cards
 * with explicit synergy types, so the assertions never depend on the seeded
 * market draw.
 */
import { describe, expect, it } from 'vitest';

import {
  setupMainStreetGame,
  createCompetitiveState,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  executeWeekStart,
  resolveEvent,
  applyCompetitiveEventEffects,
  projectPiggybackEventReward,
  projectEventCoinDelta,
} from '../../src/MainStreetEngine';
import { purchaseBusiness } from '../../src/MainStreetMarket';
import {
  applyIncome,
  attachUpcomingDeltas,
  type IncomeResult,
  type SlotEventDelta,
} from '../../src/MainStreetAdjacency';
import {
  scoreAction,
  computeCompetitiveEventValue,
} from '../../src/MainStreetAiStrategy';
import { eventSynergyTargets, matchesEventSynergyTargets } from '../../src/MainStreetEventSynergy';
import { tagSlotOwnerIfCompetitive } from '../../src/MainStreetAdjacency';
import type { BusinessCard, CommunitySpaceCard, EventCard, SynergyType } from '../../src/MainStreetCards';

// ── Fixtures ──────────────────────────────────────────────────

/**
 * `evt-grand-opening` exactly as shipped in card-data.csv row 46: static
 * `targetSynergy: Commerce`, `coinDelta: 450`, cost 300 — the static Commerce
 * target every projection path must ignore in favour of the placed-synergy
 * override when projecting (Feature 2 resolved; Feature 3 projects).
 */
function grandOpening(): EventCard {
  return {
    family: 'event',
    id: 'evt-grand-opening',
    name: 'Grand Opening Sale',
    cost: 300,
    trigger: 'Investment',
    effect: '+450 coins from a Commerce promotion.',
    target: 'SpecificSynergy',
    targetSynergy: 'Commerce',
    coinDelta: 450,
    reputationDelta: 0,
  } as unknown as EventCard;
}

/** A deterministic business fixture with explicit synergy types. */
function businessFixture(id: string, synergyTypes: SynergyType[]): BusinessCard {
  return {
    family: 'business',
    id,
    name: `Fixture ${id}`,
    cost: 100,
    baseIncome: 10,
    synergyTypes,
    maxLevel: 0,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    description: 'Grand Opening projection-parity fixture.',
    ongoingCost: 0,
    employedStaff: [],
  } as unknown as BusinessCard;
}

// ── State setup helpers ───────────────────────────────────────

/**
 * Single-player MarketPhase state with rich coins and reputation 0 (so the
 * reputation coin multiplier is exactly 1 and every expected payout is an
 * exact integer).
 */
function singlePlayerState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  state.resourceBank.coins = 9999;
  state.resourceBank.reputation = 0;
  return state;
}

/**
 * 2-player competitive state with clean wallets (coins 9999, reputation 0 →
 * multiplier 1) and the shared host wallet padded so host checks never fire.
 */
function competitiveState(seed: string): MainStreetState {
  const state = createCompetitiveState({ seed, playerCount: 2 });
  state.resourceBank.coins = 100000;
  state.resourceBank.reputation = 1000;
  for (const p of state.players!) {
    p.coins = 9999;
    p.reputation = 0;
  }
  return state;
}

/**
 * Places a card at `slot` through the real `purchaseBusiness` placement
 * path, which arms the gate and records `placedSynergiesThisTurn` — the
 * driving synergy for the dynamic payout ("the card opened this turn").
 * Ownership is tagged to the active player in competitive states.
 */
function placeBusiness(
  state: MainStreetState,
  id: string,
  synergyTypes: SynergyType[],
  slot: number,
): void {
  state.market.cards.push(businessFixture(id, synergyTypes));
  purchaseBusiness(state, id, slot);
}

/**
 * Pushes an already-grid card directly (not a placement this turn), so it
 * contributes to the match count WITHOUT changing the recorded placed
 * synergy. Mirrors "businesses already on the street when the card is opened".
 */
function gridPush(state: MainStreetState, card: BusinessCard | CommunitySpaceCard, slot: number): void {
  state.streetGrid[slot] = card;
}

/** gridPush plus explicit competitive ownership tagging. */
function gridPushOwned(
  state: MainStreetState,
  card: BusinessCard | CommunitySpaceCard,
  slot: number,
  ownerId: number,
): void {
  state.streetGrid[slot] = card;
  tagSlotOwnerIfCompetitive(state, slot, ownerId);
}

/** Coins gained by resolving `event` on the shared resource bank. */
function payoutDelta(state: MainStreetState, event: EventCard): number {
  const before = state.resourceBank.coins;
  resolveEvent(state, event);
  return state.resourceBank.coins - before;
}

// ── AC1: single-player projection equals the resolved payout ──

describe('AC1: projectEventCoinDelta equals the resolved payout for the placed synergy', () => {
  it('projects the dynamic Food payout for a Food placement, not the static Commerce count', () => {
    const state = singlePlayerState('f3t-ac1-food');
    placeBusiness(state, 'f3t-ac1-a', ['Food'], 0);             // opened this turn
    gridPush(state, businessFixture('f3t-ac1-b', ['Food']), 1); // pre-existing Food
    gridPush(state, businessFixture('f3t-ac1-c', ['Commerce']), 2); // must NOT drive the projection

    const projection = projectEventCoinDelta(state, grandOpening());
    const actual = payoutDelta(state, grandOpening());

    // Static Commerce projection today → 450 (the one Commerce card); the
    // dynamic payout is 450 × 2 Food matches.
    expect(projection).toBe(actual);
    expect(projection).toBe(450 * 2);
    expect(Number.isInteger(projection)).toBe(true);
  });

  it('projects the union of a multi-synergy Food|Culture placement, matching the payout', () => {
    const state = singlePlayerState('f3t-ac1-union');
    placeBusiness(state, 'f3t-ac1-d', ['Food', 'Culture'], 0);  // opened this turn
    gridPush(state, businessFixture('f3t-ac1-e', ['Food']), 1); // union: Food
    gridPush(state, businessFixture('f3t-ac1-f', ['Culture']), 2); // union: Culture
    gridPush(state, businessFixture('f3t-ac1-g', ['Commerce']), 3); // no overlap → excluded

    const projection = projectEventCoinDelta(state, grandOpening());
    const actual = payoutDelta(state, grandOpening());

    expect(projection).toBe(actual);
    expect(projection).toBe(450 * 3); // placed union + Food + Culture
    expect(Number.isInteger(projection)).toBe(true);
  });
});

// ── AC2: competitive AI value equals the per-owner dynamic payout ─

describe('AC2: computeCompetitiveEventValue equals the per-owner dynamic payout', () => {
  it('values the acting owner by the placed synergy match count, not the static Commerce count', () => {
    // Owner 0 owns the placed Food card + a pre-existing Food card. Owner 1
    // owns a Commerce-only card that must NOT drive owner 0's value.
    const comp = competitiveState('f3t-ac2-comp');
    placeBusiness(comp, 'f3t-ac2-a', ['Food'], 0);              // tagged to owner 0
    gridPushOwned(comp, businessFixture('f3t-ac2-b', ['Food']), 1, 0);
    gridPushOwned(comp, businessFixture('f3t-ac2-c', ['Commerce']), 2, 1);

    const value = computeCompetitiveEventValue(comp, grandOpening(), 0);

    // Static Commerce count for owner 0 is 0 → today's value is 0; the
    // dynamic payout for owner 0 is 450 × 2 Food matches.
    const p0Before = comp.players![0].coins;
    const p1Before = comp.players![1].coins;
    applyCompetitiveEventEffects(comp, grandOpening(), 0);
    const p0Delta = comp.players![0].coins - p0Before;

    expect(value).toBe(p0Delta);
    expect(value).toBe(450 * 2);
    // Non-matching owner is untouched by the per-owner routing.
    expect(comp.players![1].coins).toBe(p1Before);
  });

  it('counts a Commerce card that ALSO shares the placed Food synergy against the placed synergy', () => {
    const comp = competitiveState('f3t-ac2-shared');
    placeBusiness(comp, 'f3t-ac2-d', ['Food'], 0);              // placed this turn
    gridPushOwned(comp, businessFixture('f3t-ac2-e', ['Commerce', 'Food']), 1, 0);

    const value = computeCompetitiveEventValue(comp, grandOpening(), 0);

    // Dynamic (Food): both cards match → 450 × 2. Static (Commerce): only
    // the Commerce|Food card → 450 × 1.
    expect(value).toBe(450 * 2);
  });
});

// ── AC3: piggyback projection equals the expected dynamic reward ─

describe('AC3: piggyback projection path reflects the dynamic payout', () => {
  it('full-scale projection equals the dynamic payout for the piggybacker', () => {
    const comp = competitiveState('f3t-ac3-full');
    placeBusiness(comp, 'f3t-ac3-a', ['Food'], 0);              // tagged to owner 0
    gridPushOwned(comp, businessFixture('f3t-ac3-b', ['Food']), 1, 0);

    const reward = projectPiggybackEventReward(comp, grandOpening(), 0, 1.0);

    // The 1.0-scale piggyback projection is computed through
    // `computeOwnerEventDeltas` — the same per-owner math
    // `applyCompetitiveEventEffects` applies — so it must equal the actual
    // dynamic payout: 450 × the piggybacker's own Food matches.
    expect(reward.scale).toBe(1.0);
    expect(reward.matchCount).toBe(2);
    expect(reward.coins).toBe(450 * 2);
    expect(Number.isInteger(reward.coins)).toBe(true);
  });

  it('half-scale free-ride splits the dynamic reward', () => {
    const comp = competitiveState('f3t-ac3-half');
    placeBusiness(comp, 'f3t-ac3-c', ['Food'], 0);
    gridPushOwned(comp, businessFixture('f3t-ac3-d', ['Food']), 1, 0);

    const reward = projectPiggybackEventReward(comp, grandOpening(), 0, 0.5);

    expect(reward.scale).toBe(0.5);
    expect(reward.matchCount).toBe(2);
    expect(reward.coins).toBe(Math.round((450 * 2) * 0.5)); // integer economy
  });

  it('an owner with no matching businesses projects zero — no ghost value', () => {
    const comp = competitiveState('f3t-ac3-none');
    placeBusiness(comp, 'f3t-ac3-e', ['Food'], 0);              // owner 0
    gridPushOwned(comp, businessFixture('f3t-ac3-f', ['Commerce']), 1, 1); // owner 1

    const reward = projectPiggybackEventReward(comp, grandOpening(), 1, 1.0);

    expect(reward.matchCount).toBe(0);
    expect(reward.coins).toBe(0);
    expect(reward.reputation).toBe(0);
  });
});

// ── AC4: scoreEventAction consistent with the dynamic payout ───

describe('AC4: scoreEventAction is consistent with the dynamic payout', () => {
  it('scores grand opening at the dynamic payout minus the play cost', () => {
    const state = singlePlayerState('f3t-ac4-score');
    placeBusiness(state, 'f3t-ac4-a', ['Food'], 0);             // opened this turn
    gridPush(state, businessFixture('f3t-ac4-b', ['Food']), 1); // pre-existing Food
    gridPush(state, businessFixture('f3t-ac4-c', ['Commerce']), 2); // must NOT count
    state.market.cards.push(grandOpening());

    const score = scoreAction(state, { type: 'buy-event', cardId: 'evt-grand-opening' });

    // Today's static score is 450 + 0 − 300 = 150 (flat card math, no match
    // count); with the dynamic payout the event's play value is
    // 450 × 2 Food matches − 300 = 600.
    expect(score).toBe(450 * 2 - 300);
    expect(Number.isInteger(score)).toBe(true);
  });
});

// ── AC5: one shared resolver drives every path ──────────────

describe('AC5: eventSynergyTargets is the single source of truth', () => {
  it('resolves Grand Opening to the placed-this-turn synergy, not its static Commerce target', () => {
    const state = singlePlayerState('f3t-ac5-resolver');
    placeBusiness(state, 'f3t-ac5-resolver-a', ['Food', 'Culture'], 0);

    const targets = eventSynergyTargets(state, grandOpening());

    expect(targets).toEqual(['Food', 'Culture']);
    expect(targets).not.toEqual(['Commerce']);
  });

  it('keeps other SpecificSynergy events on their static target (no behaviour change)', () => {
    const state = singlePlayerState('f3t-ac5-static');
    placeBusiness(state, 'f3t-ac5-static-a', ['Food'], 0);

    const festival = {
      family: 'event',
      id: 'evt-festival-0',
      name: 'Festival',
      cost: 100,
      trigger: 'Investment',
      target: 'SpecificSynergy',
      targetSynergy: 'Culture',
      coinDelta: 50,
      reputationDelta: 0,
    } as unknown as EventCard;

    expect(eventSynergyTargets(state, festival)).toEqual(['Culture']);
  });

  it('falls back to the static target when the dynamic override is armed but unplaced', () => {
    const state = singlePlayerState('f3t-ac5-unplaced');
    // Empty grid + no placement this turn: the resolver must not crash and
    // must fall back to the static Commerce target rather than inventing one.
    const targets = eventSynergyTargets(state, grandOpening());

    expect(targets).toEqual(['Commerce']);
    expect(matchesEventSynergyTargets(null, targets)).toBe(false);
  });
});

// ── AC5: animation attribution marks the dynamic-match slots ───

describe('AC5: attachUpcomingDeltas attributes the payout to the dynamic-match slots', () => {
  it('marks the Food-match slots for a Food placement, excluding the Commerce-only card', () => {
    const state = singlePlayerState('f3t-ac5-attrib');
    placeBusiness(state, 'f3t-ac5-a', ['Food'], 0);             // opened this turn
    gridPush(state, businessFixture('f3t-ac5-b', ['Food']), 1); // pre-existing Food
    gridPush(state, businessFixture('f3t-ac5-c', ['Commerce']), 2); // must NOT be marked

    const result = applyIncome(state);
    attachUpcomingDeltas(result, state, grandOpening(), 450 * 2, 0);

    /** upcomingDeltas per slot index, keyed for attribution assertions. */
    function attachedDeltas(income: IncomeResult): Map<number, SlotEventDelta[]> {
      const map = new Map<number, SlotEventDelta[]>();
      for (const pd of income.phaseBreakdown.perSlotBreakdown) {
        map.set(pd.slotIndex, pd.upcomingDeltas);
      }
      return map;
    }
    const attached = attachedDeltas(result);

    // Static Commerce attribution today marks slot 2 (the Commerce-only
    // card) instead; the dynamic contract marks exactly the Food slots,
    // splitting the payout across them (450 each).
    const foodSlot0 = attached.get(0)!;
    const foodSlot1 = attached.get(1)!;
    const commerceSlot2 = attached.get(2)!;

    expect(foodSlot0).toHaveLength(1);
    expect(foodSlot0[0]).toMatchObject({ kind: 'coin', delta: 450, attachedSlotIndex: 0 });
    expect(foodSlot1).toHaveLength(1);
    expect(foodSlot1[0]).toMatchObject({ kind: 'coin', delta: 450, attachedSlotIndex: 1 });
    expect(commerceSlot2).toHaveLength(0);

    // The attached deltas sum to the exact dynamic payout.
    const total = [...attached.values()].flat().reduce((sum, d) => sum + d.delta, 0);
    expect(total).toBe(450 * 2);
  });
});
