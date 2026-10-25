/**
 * Main Street: Grand Opening dynamic payout parity
 * (MS-0MVCS7LMP001QYPM, parent MS-0MV8KSPFK006HTXG).
 *
 * Test-first contract for the Feature-2 dynamic-synergy resolution
 * (implementing child MS-0MVCS7LIA003J2SM): the Grand Opening Sale payout
 * must track the synergy of the card placed THIS turn
 * (`placedSynergiesThisTurn`, Feature 1 state model MS-0MVCS1NOH0074YY2),
 * not the card's static `targetSynergy: Commerce` — across single-player
 * resolution and the competitive per-owner paths.
 *
 * Acceptance Criteria:
 *  1. Food placement → payout = 450 × Food-match count; Commerce-only grid
 *     cards are NOT counted (a Commerce card that ALSO shares the placed
 *     synergy does count).
 *  2. Multi-synergy placement (`Food|Culture`) → union match counts: any
 *     grid card sharing any of the placed synergies counts, once.
 *  3. Community-space placement drives the synergy selection symmetrically
 *     with business placements (the grid space itself counts as a match).
 *  4. Competitive path: `applyCompetitiveEventEffects` (backed by
 *     `computeOwnerEventDeltas`, exercised via the piggyback projection
 *     seam) matches the single-player payout for the acting owner.
 *  5. Math stays integer (450 × count); exact values asserted throughout.
 *     Full project suite passes.
 *
 * Red-phase convention (repo test-first tracer bullet): the parity cases
 * below are authored `it.fails` — they FAIL against today's code (which
 * resolves `evt-grand-opening` against the static `Commerce` target) and are
 * flipped to a plain `it` by the implementing child (MS-0MVCS7LIA003J2SM)
 * once the dynamic resolution lands. The regression guard (other
 * SpecificSynergy events keep their static target) holds today and stays
 * plain `it` so it keeps protecting the contract through the change.
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
} from '../../src/MainStreetEngine';
import { purchaseBusiness } from '../../src/MainStreetMarket';
import { tagSlotOwnerIfCompetitive } from '../../src/MainStreetAdjacency';
import type { BusinessCard, CommunitySpaceCard, EventCard, SynergyType } from '../../src/MainStreetCards';

// ── Fixtures ──────────────────────────────────────────────────

/**
 * `evt-grand-opening` exactly as shipped in card-data.csv row 46: static
 * `targetSynergy: Commerce`, `coinDelta: 450` — the resolution-time override
 * the Feature-2 child adds must pay `450 × matchCount` against the placed
 * synergy, not this static Commerce target.
 */
function grandOpening(): EventCard {
  return {
    family: 'event',
    id: 'evt-grand-opening',
    name: 'Grand Opening Sale',
    cost: 300,
    trigger: 'Investment',
    effect: '+450 coins for each business sharing the synergy of the business opened this turn.',
    target: 'SpecificSynergy',
    targetSynergy: 'Commerce',
    coinDelta: 450,
    reputationDelta: 0,
  } as unknown as EventCard;
}

/**
 * `evt-festival` (Local Festival), card-data.csv row 41: a DIFFERENT
 * `SpecificSynergy` event with its own static Culture target. Used by the
 * regression guard to prove the dynamic override is scoped to
 * `evt-grand-opening` only.
 */
function localFestival(): EventCard {
  return {
    family: 'event',
    id: 'evt-festival',
    name: 'Local Festival',
    cost: 300,
    trigger: 'Investment',
    effect: '+200 coins to all Culture businesses and +100 reputation.',
    target: 'SpecificSynergy',
    targetSynergy: 'Culture',
    coinDelta: 200,
    reputationDelta: 100,
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
    description: 'Grand Opening dynamic-payout fixture.',
    ongoingCost: 0,
    employedStaff: [],
  } as unknown as BusinessCard;
}

/** A deterministic community-space fixture with explicit synergy types. */
function communitySpaceFixture(id: string, synergyTypes: SynergyType[]): CommunitySpaceCard {
  return {
    family: 'community-space',
    id,
    name: `Fixture ${id}`,
    cost: 100,
    baseIncome: 10,
    ongoingCost: 0,
    synergyTypes,
    maxLevel: 0,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    description: 'Grand Opening dynamic-payout community-space fixture.',
  } as unknown as CommunitySpaceCard;
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

/** Same placement helper for a community-space driving card. */
function placeCommunitySpace(
  state: MainStreetState,
  id: string,
  synergyTypes: SynergyType[],
  slot: number,
): void {
  state.market.cards.push(communitySpaceFixture(id, synergyTypes));
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

// ── AC1: Food placement → 450 × Food count; Commerce-only excluded ─

describe('AC1: Food placement drives the payout; Commerce-only cards are not counted', () => {
  it('pays 450 per Food grid card and ignores Commerce-only cards', () => {
    const state = singlePlayerState('f2t-ac1-food');
    placeBusiness(state, 'f2t-ac1-a', ['Food'], 0);             // opened this turn
    gridPush(state, businessFixture('f2t-ac1-b', ['Food']), 1); // pre-existing Food
    gridPush(state, businessFixture('f2t-ac1-c', ['Commerce']), 2); // must NOT count

    const delta = payoutDelta(state, grandOpening());

    expect(delta).toBe(450 * 2); // placed Food + pre-existing Food
    expect(Number.isInteger(delta)).toBe(true);
  });

  it('counts a Commerce card that ALSO shares the placed Food synergy', () => {
    const state = singlePlayerState('f2t-ac1-shared');
    placeBusiness(state, 'f2t-ac1-d', ['Food'], 0);
    gridPush(state, businessFixture('f2t-ac1-e', ['Commerce', 'Food']), 1);

    // Union of {Food}: the Commerce|Food card shares Food → counted.
    expect(payoutDelta(state, grandOpening())).toBe(450 * 2);
  });
});

// ── AC2: Multi-synergy placement → union match counts ─────────

describe('AC2: multi-synergy Food|Culture placement counts the union of matches', () => {
  it('pays for every grid card sharing ANY placed synergy, once', () => {
    const state = singlePlayerState('f2t-ac2-union');
    placeBusiness(state, 'f2t-ac2-a', ['Food', 'Culture'], 0);  // opened this turn
    gridPush(state, businessFixture('f2t-ac2-b', ['Food']), 1); // union: Food
    gridPush(state, businessFixture('f2t-ac2-c', ['Culture']), 2); // union: Culture
    gridPush(state, businessFixture('f2t-ac2-d', ['Commerce']), 3); // no overlap → excluded

    const delta = payoutDelta(state, grandOpening());

    // placed Food|Culture + Food + Culture = 3 matches; Commerce excluded.
    expect(delta).toBe(450 * 3);
    expect(Number.isInteger(delta)).toBe(true);
  });
});

// ── AC3: Community-space placement drives selection symmetrically ─

describe('AC3: community-space placement selects the payout synergy like a business', () => {
  it('pays 450 per Culture match when a Culture community space was opened', () => {
    const state = singlePlayerState('f2t-ac3-cs');
    placeCommunitySpace(state, 'f2t-ac3-a', ['Culture'], 0);    // opened this turn
    gridPush(state, businessFixture('f2t-ac3-b', ['Culture']), 1); // pre-existing Culture
    gridPush(state, businessFixture('f2t-ac3-c', ['Commerce']), 2); // untouched Commerce

    const delta = payoutDelta(state, grandOpening());

    // The opened Culture space itself counts as a match.
    expect(delta).toBe(450 * 2);
    expect(Number.isInteger(delta)).toBe(true);
  });
});

// ── AC4: Competitive per-owner paths match single-player payout ─

describe('AC4: competitive event effects match the single-player payout for the acting owner', () => {
  it('applyCompetitiveEventEffects pays the acting owner the dynamic payout', () => {
    // Owner 0 owns the placed Food card + a pre-existing Food card. Owner 1
    // owns a Commerce-only card that must NOT drive owner 0's payout.
    const comp = competitiveState('f2t-ac4-comp');
    placeBusiness(comp, 'f2t-ac4-a', ['Food'], 0); // tagged to owner 0 (active player)
    gridPushOwned(comp, businessFixture('f2t-ac4-b', ['Food']), 1, 0);
    gridPushOwned(comp, businessFixture('f2t-ac4-c', ['Commerce']), 2, 1);

    const p0Before = comp.players![0].coins;
    const p1Before = comp.players![1].coins;
    const rngCallsBefore = comp.rngCalls;

    applyCompetitiveEventEffects(comp, grandOpening(), 0);
    const compDelta = comp.players![0].coins - p0Before;

    // Single-player board with the same composition and the same placed
    // synergy — the parity baseline the competitive path must match.
    const single = singlePlayerState('f2t-ac4-single');
    placeBusiness(single, 'f2t-ac4-d', ['Food'], 0);
    gridPush(single, businessFixture('f2t-ac4-e', ['Food']), 1);
    gridPush(single, businessFixture('f2t-ac4-f', ['Commerce']), 2);
    const singleDelta = payoutDelta(single, grandOpening());

    expect(compDelta).toBe(singleDelta); // same dynamic-synergy resolution
    expect(compDelta).toBe(450 * 2);     // owner 0's 2 Food-owned cards
    expect(Number.isInteger(compDelta)).toBe(true);
    // Non-matching owner is untouched; resolution is deterministic (no RNG).
    expect(comp.players![1].coins).toBe(p1Before);
    expect(comp.rngCalls).toBe(rngCallsBefore);
  });

  it('computeOwnerEventDeltas (piggyback projection seam) matches the payout', () => {
    const comp = competitiveState('f2t-ac4-project');
    placeBusiness(comp, 'f2t-ac4-g', ['Food'], 0);
    gridPushOwned(comp, businessFixture('f2t-ac4-h', ['Food']), 1, 0);

    // The 1.0-scale piggyback projection is computed through
    // `computeOwnerEventDeltas` — the same per-owner math
    // `applyCompetitiveEventEffects` applies — so its full-scale coins must
    // equal the acting owner's single-player-equivalent payout.
    const projection = projectPiggybackEventReward(comp, grandOpening(), 0, 1.0);

    expect(projection.scale).toBe(1.0);
    expect(projection.matchCount).toBe(2);
    expect(projection.coins).toBe(450 * 2);
    expect(Number.isInteger(projection.coins)).toBe(true);
  });
});

// ── Guard: non-Grand-Opening events keep their static target ─────

describe('guard: the dynamic override is scoped to evt-grand-opening only', () => {
  it('other SpecificSynergy events keep their static target synergy', () => {
    // A Food card was placed this turn, but Local Festival targets Culture
    // statically: only the single pre-existing Culture business pays.
    const state = singlePlayerState('f2t-guard-festival');
    placeBusiness(state, 'f2t-ac5-a', ['Food'], 0);
    gridPush(state, businessFixture('f2t-ac5-b', ['Culture']), 1);
    gridPush(state, businessFixture('f2t-ac5-c', ['Food']), 2);

    expect(payoutDelta(state, localFestival())).toBe(200); // 200 × 1 Culture match
  });
});
