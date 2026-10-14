/**
 * Community Space Ongoing-Cost Tests
 *
 * Validates the community-space ongoing-cost mechanic introduced by
 * CG-0MRXYGM9B006I3PE ("Why would a library bring in money"):
 * - Community space cards with `ongoingCost` are charged each income phase
 *   (clamped at 0 coins, logged) alongside staff costs.
 * - The Library (cs-library) is a reputation asset: no income, 25/turn
 *   ongoing cost, +10 reputation/turn, full synergy participation (Park
 *   model, default 0.5 coin rate).
 * - The Park (cs-park) has a 40/turn ongoing cost (CG-0MU9NW9EP003B1AK),
 *   clamped at 0 coins and exempt when sold.
 * - The Community Hub upgrade (upg-community-hub) grants +10 reputation/turn
 *   and no income or synergy-range bonus.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import {
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  createCommunitySpaceDeck,
  createBusinessDeck,
  createUpgradeDeck,
  type CommunitySpaceCard,
} from '../../src/MainStreetCards';
import {
  applyCommunitySpaceOngoingCosts,
  processEndOfTurn,
} from '../../src/MainStreetEngine';
import { purchaseUpgrade } from '../../src/MainStreetMarket';
import {
  computeSynergyBonus,
  computeSynergyRepBonus,
  computeSynergyPairs,
} from '../../src/MainStreetAdjacency';

// ── Helpers ─────────────────────────────────────────────────

function createTestState(seed: string = 'community-space-ongoing-cost'): MainStreetState {
  return setupMainStreetGame({ seed });
}

/**
 * Places a Library card on the street grid (slot 0) and simulates the
 * placement cache (`currentIncome` / `currentReputationPerTurn`) that
 * `updateNeighborsOnPlacement` would set after a real placement.
 */
function placeLibrary(state: MainStreetState): CommunitySpaceCard {
  const library = createCommunitySpaceDeck(1).find(c => c.name === 'Library')!;
  library.currentIncome = library.baseIncome;
  library.currentReputationPerTurn = library.reputationPerTurn ?? 0;
  state.streetGrid[0] = library;
  return library;
}

/**
 * Creates a synthetic zero-cost community-space card for testing the
 * "no ongoing cost" path (all shipped community spaces now have a
 * non-zero `ongoingCost`).
 */
function makeZeroCostSpace(name: string, synergyType: 'Food' | 'Culture' | 'Commerce' | 'Service' | 'Entertainment' | 'Health'): CommunitySpaceCard {
  return {
    family: 'community-space',
    id: `cs-synthetic-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    cost: 200,
    baseIncome: 0,
    ongoingCost: 0,
    synergyTypes: [synergyType],
    maxLevel: 0,
    description: 'Synthetic zero-cost card.',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    reputationPerTurn: 10,
    appliedUpgrades: [],
    currentIncome: 0,
    currentReputationPerTurn: 10,
  };
}

// ── AC: Library stats (reputation asset) ────────────────────

describe('Library card stats (reputation asset)', () => {
  it('should be a reputation asset with default synergy participation and a running cost', () => {
    const library = createCommunitySpaceDeck(1).find(c => c.name === 'Library');
    expect(library).toBeDefined();
    expect(library!.baseIncome).toBe(0);
    expect(library!.ongoingCost).toBe(25);
    expect(library!.reputationPerTurn).toBe(40);
    // Empty synergy fields (Park pattern) default to a 0.5 coin synergy rate,
    // so the Library participates in neighbours' Culture synergy (reversed by
    // CG-0MSKS963N000ZSTU).
    expect(library!.synergyCoinBonus).toBeUndefined();
    expect(library!.synergyRepBonus).toBeUndefined();
    // Cost re-priced 700 -> 400 by MS-0MUR9IN7L0004TO5 (see
    // docs/main-street/analysis/community-space-event-repricing.md).
    expect(library!.cost).toBe(400);
  });
});

// ── AC: Library synergy participation (Park model) ──────────

describe('Library synergy participation (behavioral, Park model)', () => {
  it('should earn no coin synergy itself (baseIncome 0) despite a matching Culture neighbor', () => {
    const state = createTestState('library-no-coin-synergy');
    const library = placeLibrary(state);
    // Art Gallery is Culture|Entertainment — shares Culture with the Library.
    // The Library participates in synergy now (default 0.5 coin rate) but its
    // baseIncome is 0, so its own coin synergy is still 0.
    const gallery = createBusinessDeck(1).find(c => c.name === 'Art Gallery')!;
    state.streetGrid[1] = gallery;

    const slot = state.streetGrid.indexOf(library);
    expect(computeSynergyBonus(state.streetGrid, slot)).toBe(0);
  });

  it('should receive reputation synergy from a Culture neighbor with a rep bonus', () => {
    const state = createTestState('library-rep-synergy');
    const library = placeLibrary(state);
    // Art Gallery has synergyRepBonus 10 — the Library now receives rep
    // synergy from it (reversed by CG-0MSKS963N000ZSTU).
    const gallery = createBusinessDeck(1).find(c => c.name === 'Art Gallery')!;
    expect(gallery.synergyRepBonus).toBe(10);
    state.streetGrid[1] = gallery;

    const slot = state.streetGrid.indexOf(library);
    expect(computeSynergyRepBonus(state.streetGrid, slot)).toBe(10);
  });

  it('should be counted toward a neighbor\'s synergy (contributes like the Park)', () => {
    const state = createTestState('library-contributes');
    // Cafe (Food|Culture, baseIncome 1) adjacent to the Library
    const cafe = createBusinessDeck(1).find(c => c.name === 'Cafe')!;
    const library = createCommunitySpaceDeck(1).find(c => c.name === 'Library')!;
    state.streetGrid[0] = cafe;
    state.streetGrid[1] = library;

    // The Library participates in synergy now, so it is counted toward N:
    // Cafe earns 315 base income × 0.5 default rate × 1 neighbor = 158 coins
    // (5-turn payback rebalance, MS-0MUQUBJFL0076RT6).
    expect(computeSynergyBonus(state.streetGrid, 0)).toBe(158);
  });

  it('should give a Bookshop 1.15 Culture synergy when placed adjacent', () => {
    const state = createTestState('bookshop-library-synergy');
    // Bookshop (Culture, baseIncome 2.3) adjacent to the Library
    const bookshop = createBusinessDeck(1).find(c => c.name === 'Bookshop')!;
    const library = createCommunitySpaceDeck(1).find(c => c.name === 'Library')!;
    state.streetGrid[0] = bookshop;
    state.streetGrid[1] = library;

    // 161 base income × 0.5 default rate × 1 neighbor = 81 coins/turn
    // (5-turn payback rebalance, MS-0MUQUBJFL0076RT6).
    expect(computeSynergyBonus(state.streetGrid, 0)).toBe(81);
  });

  it('should draw a Culture synergy line between a Bookshop and the Library', () => {
    const state = createTestState('bookshop-library-pair');
    const bookshop = createBusinessDeck(1).find(c => c.name === 'Bookshop')!;
    const library = createCommunitySpaceDeck(1).find(c => c.name === 'Library')!;
    state.streetGrid[0] = bookshop;
    state.streetGrid[1] = library;

    const pairs = computeSynergyPairs(state.streetGrid);
    expect(pairs).toContainEqual({
      fromIndex: 0,
      toIndex: 1,
      sharedSynergy: 'Culture',
    });
  });
});

// ── AC: Ongoing-cost deduction in the income phase ──────────

describe('Community space ongoing-cost deduction', () => {
  it('should deduct the total ongoingCost of placed community spaces from coins', () => {
    const state = createTestState();
    const library = placeLibrary(state);
    expect(library.ongoingCost).toBe(25);

    state.resourceBank.coins = 1000;
    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(975);
    const log = state.activityLog.find(l => l.text.includes('Community space costs'));
    expect(log).toBeDefined();
    expect(log!.text).toContain('-25');
  });

  it('should clamp the deduction at 0 coins and log insufficient funds', () => {
    const state = createTestState();
    placeLibrary(state);

    state.resourceBank.coins = 10;
    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(0);
    const log = state.activityLog.find(l => l.text.includes('Insufficient coins for community space costs'));
    expect(log).toBeDefined();
  });

  it('should do nothing when no community space has an ongoing cost', () => {
    const state = createTestState();
    // All shipped community spaces now have a non-zero ongoingCost;
    // use a synthetic zero-cost card for this edge case.
    const zeroCost = makeZeroCostSpace('ZeroCost Space', 'Entertainment');
    zeroCost.currentIncome = zeroCost.baseIncome;
    zeroCost.currentReputationPerTurn = zeroCost.reputationPerTurn ?? 0;
    state.streetGrid[0] = zeroCost;

    state.resourceBank.coins = 5;
    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(5);
  });

  it('should deduct 20 coins per turn for a placed Playground (MS-0MUMC6IVF0098WRL)', () => {
    const state = createTestState('playground-ongoing-cost');
    state.resourceBank.coins = 1000;

    const playground = createCommunitySpaceDeck(1).find(c => c.name === 'Playground')!;
    playground.currentIncome = playground.baseIncome;
    playground.currentReputationPerTurn = playground.reputationPerTurn ?? 0;
    state.streetGrid[0] = playground;

    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(980);
    const log = state.activityLog.find(l => l.text.includes('Community space costs'));
    expect(log).toBeDefined();
    expect(log!.text).toContain('-20');
  });

  it('should clamp a Playground deduction at 0 coins and log insufficient funds', () => {
    const state = createTestState('playground-clamped');
    const playground = createCommunitySpaceDeck(1).find(c => c.name === 'Playground')!;
    playground.currentIncome = playground.baseIncome;
    playground.currentReputationPerTurn = playground.reputationPerTurn ?? 0;
    state.streetGrid[0] = playground;

    state.resourceBank.coins = 15;
    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(0);
    const log = state.activityLog.find(l => l.text.includes('Insufficient coins for community space costs'));
    expect(log).toBeDefined();
  });

  it('should NOT deduct ongoingCost for a sold Playground', () => {
    const state = createTestState('sold-playground-no-cost');
    state.resourceBank.coins = 1000;

    const playground = createCommunitySpaceDeck(1).find(c => c.name === 'Playground')!;
    playground.currentIncome = playground.baseIncome;
    playground.currentReputationPerTurn = playground.reputationPerTurn ?? 0;
    state.streetGrid[0] = playground;
    state.soldSlots[0] = true;

    const coinsBefore = state.resourceBank.coins;
    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(coinsBefore);
  });

  it('should deduct 25 coins per turn for a placed Town Fountain (MS-0MUMC6IVF0098WRL)', () => {
    const state = createTestState('fountain-ongoing-cost');
    state.resourceBank.coins = 1000;

    const fountain = createCommunitySpaceDeck(1).find(c => c.name === 'Town Fountain')!;
    fountain.currentIncome = fountain.baseIncome;
    fountain.currentReputationPerTurn = fountain.reputationPerTurn ?? 0;
    state.streetGrid[0] = fountain;

    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(975);
    const log = state.activityLog.find(l => l.text.includes('Community space costs'));
    expect(log).toBeDefined();
    expect(log!.text).toContain('-25');
  });

  it('should clamp a Town Fountain deduction at 0 coins and log insufficient funds', () => {
    const state = createTestState('fountain-clamped');
    const fountain = createCommunitySpaceDeck(1).find(c => c.name === 'Town Fountain')!;
    fountain.currentIncome = fountain.baseIncome;
    fountain.currentReputationPerTurn = fountain.reputationPerTurn ?? 0;
    state.streetGrid[0] = fountain;

    state.resourceBank.coins = 20;
    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(0);
    const log = state.activityLog.find(l => l.text.includes('Insufficient coins for community space costs'));
    expect(log).toBeDefined();
  });

  it('should NOT deduct ongoingCost for a sold Town Fountain', () => {
    const state = createTestState('sold-fountain-no-cost');
    state.resourceBank.coins = 1000;

    const fountain = createCommunitySpaceDeck(1).find(c => c.name === 'Town Fountain')!;
    fountain.currentIncome = fountain.baseIncome;
    fountain.currentReputationPerTurn = fountain.reputationPerTurn ?? 0;
    state.streetGrid[0] = fountain;
    state.soldSlots[0] = true;

    const coinsBefore = state.resourceBank.coins;
    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(coinsBefore);
  });

  it('should deduct 30 coins per turn for a placed Community Shelter (MS-0MUMC6IVF0098WRL)', () => {
    const state = createTestState('shelter-ongoing-cost');
    state.resourceBank.coins = 1000;

    const shelter = createCommunitySpaceDeck(1).find(c => c.name === 'Community Shelter')!;
    shelter.currentIncome = shelter.baseIncome;
    shelter.currentReputationPerTurn = shelter.reputationPerTurn ?? 0;
    state.streetGrid[0] = shelter;

    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(970);
    const log = state.activityLog.find(l => l.text.includes('Community space costs'));
    expect(log).toBeDefined();
    expect(log!.text).toContain('-30');
  });

  it('should clamp a Community Shelter deduction at 0 coins and log insufficient funds', () => {
    const state = createTestState('shelter-clamped');
    const shelter = createCommunitySpaceDeck(1).find(c => c.name === 'Community Shelter')!;
    shelter.currentIncome = shelter.baseIncome;
    shelter.currentReputationPerTurn = shelter.reputationPerTurn ?? 0;
    state.streetGrid[0] = shelter;

    state.resourceBank.coins = 25;
    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(0);
    const log = state.activityLog.find(l => l.text.includes('Insufficient coins for community space costs'));
    expect(log).toBeDefined();
  });

  it('should NOT deduct ongoingCost for a sold Community Shelter', () => {
    const state = createTestState('sold-shelter-no-cost');
    state.resourceBank.coins = 1000;

    const shelter = createCommunitySpaceDeck(1).find(c => c.name === 'Community Shelter')!;
    shelter.currentIncome = shelter.baseIncome;
    shelter.currentReputationPerTurn = shelter.reputationPerTurn ?? 0;
    state.streetGrid[0] = shelter;
    state.soldSlots[0] = true;

    const coinsBefore = state.resourceBank.coins;
    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(coinsBefore);
  });

  it('should deduct 40 coins per turn for a placed Park (CG-0MU9NW9EP003B1AK)', () => {
    const state = createTestState('park-ongoing-cost');
    state.resourceBank.coins = 1000;

    const park = createCommunitySpaceDeck(1).find(c => c.name === 'Park')!;
    park.currentIncome = park.baseIncome;
    park.currentReputationPerTurn = park.reputationPerTurn ?? 0;
    state.streetGrid[0] = park;

    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(960);
    const log = state.activityLog.find(l => l.text.includes('Community space costs'));
    expect(log).toBeDefined();
    expect(log!.text).toContain('-40');
  });

  it('should clamp a Park deduction at 0 coins and log insufficient funds', () => {
    const state = createTestState('park-clamped');
    const park = createCommunitySpaceDeck(1).find(c => c.name === 'Park')!;
    park.currentIncome = park.baseIncome;
    park.currentReputationPerTurn = park.reputationPerTurn ?? 0;
    state.streetGrid[0] = park;

    state.resourceBank.coins = 30;
    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(0);
    const log = state.activityLog.find(l => l.text.includes('Insufficient coins for community space costs'));
    expect(log).toBeDefined();
  });

  it('should deduct community-space costs alongside staff costs in the full turn loop', () => {
    const state = createTestState('full-turn-ongoing-cost');
    placeLibrary(state);

    // Add a staff card with an ongoing cost
    state.staffCards.push({
      family: 'staff',
      id: 'staff-tester',
      name: 'Tester',
      cost: 3,
      ongoingCost: 50,
      handSlotsAdded: 1,
      description: 'Test staff',
    });

    // No incidents to keep the turn deterministic
    state.incidentDeck = [];
    state.phase = 'MarketPhase';

    state.resourceBank.coins = 1000;
    processEndOfTurn(state);

    // Library costs 25 + staff 50 = 75 total ongoing costs
    expect(state.resourceBank.coins).toBeCloseTo(925, 5);
    expect(state.activityLog.some(l => l.text.includes('Community space costs'))).toBe(true);
    expect(state.activityLog.some(l => l.text.includes('Staff costs'))).toBe(true);
  });

  it('should not drive coins below zero through the full turn loop', () => {
    const state = createTestState('clamped-full-turn');
    placeLibrary(state);
    state.incidentDeck = [];
    state.phase = 'MarketPhase';

    state.resourceBank.coins = 10;
    processEndOfTurn(state);

    expect(state.resourceBank.coins).toBe(0);
  });
});

// ── Sold-card exclusion (CG-0MU3VH7QW006A2XA) ─────────────────

describe('Sold-card exclusion from community-space ongoing costs (CG-0MU3VH7QW006A2XA)', () => {
  it('should NOT deduct ongoingCost for a sold community-space card', () => {
    const state = createTestState('sold-cs-no-cost');
    state.resourceBank.coins = 1000;

    placeLibrary(state);
    // Mark the slot as sold
    state.soldSlots[0] = true;

    const coinsBefore = state.resourceBank.coins;
    applyCommunitySpaceOngoingCosts(state);

    // Sold card should NOT incur ongoing cost
    expect(state.resourceBank.coins).toBe(coinsBefore);
  });

  it('should still deduct for an unsold community-space card (regression)', () => {
    const state = createTestState('unsold-cs-cost');
    state.resourceBank.coins = 1000;

    placeLibrary(state);
    // Not sold — soldSlots[0] is false

    const coinsBefore = state.resourceBank.coins;
    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(coinsBefore - 25);
  });

  it('should NOT deduct the Park 40/turn cost when the Park is sold', () => {
    const state = createTestState('sold-park-no-cost');
    state.resourceBank.coins = 1000;

    const park = createCommunitySpaceDeck(1).find(c => c.name === 'Park')!;
    park.currentIncome = park.baseIncome;
    park.currentReputationPerTurn = park.reputationPerTurn ?? 0;
    state.streetGrid[0] = park;
    state.soldSlots[0] = true;

    const coinsBefore = state.resourceBank.coins;
    applyCommunitySpaceOngoingCosts(state);

    expect(state.resourceBank.coins).toBe(coinsBefore);
  });

  it('should only deduct for unsold spaces when mixing sold and unsold community spaces', () => {
    const state = createTestState('mixed-sold-unsold-cs');
    state.resourceBank.coins = 1000;

    // Sold library in slot 0
    const soldLibrary = createCommunitySpaceDeck(1).find(c => c.name === 'Library')!;
    soldLibrary.currentIncome = soldLibrary.baseIncome;
    soldLibrary.currentReputationPerTurn = soldLibrary.reputationPerTurn ?? 0;
    state.streetGrid[0] = soldLibrary;
    state.soldSlots[0] = true;

    // Unsold Park in slot 1 (Park costs 40/turn since CG-0MU9NW9EP003B1AK)
    const park = createCommunitySpaceDeck(1).find(c => c.name === 'Park')!;
    park.currentIncome = park.baseIncome;
    park.currentReputationPerTurn = park.reputationPerTurn ?? 0;
    state.streetGrid[1] = park;

    // Add another community space with ongoing cost in slot 2
    const garden = createCommunitySpaceDeck(1).find(c => c.name === 'Community Garden')!;
    garden.currentIncome = garden.baseIncome;
    garden.currentReputationPerTurn = garden.reputationPerTurn ?? 0;
    state.streetGrid[2] = garden;

    const coinsBefore = state.resourceBank.coins;
    applyCommunitySpaceOngoingCosts(state);

    // Sold library is free, but both the unsold Park (40) and the unsold
    // Community Garden (10) are charged.
    const expectedCost = (park.ongoingCost ?? 0) + (garden.ongoingCost ?? 0);
    expect(state.resourceBank.coins).toBe(coinsBefore - expectedCost);
  });
});

// ── AC: Community Hub upgrade repurposed to reputation ──────

describe('Community Hub upgrade (upg-community-hub)', () => {
  it('should grant +0.1 reputation/turn with no income or synergy-range bonus', () => {
    const state = createTestState('community-hub-upgrade');
    const library = placeLibrary(state);
    state.resourceBank.coins = 1000;

    // Put the Community Hub upgrade into the investments row
    const communityHub = createUpgradeDeck(1).find(u => u.targetBusiness === 'Library')!;
    state.market.cards.push(communityHub);

    const slot = state.streetGrid.indexOf(library);
    purchaseUpgrade(state, communityHub.id, slot);

    expect(library.incomeBonus).toBe(0);
    expect(library.synergyRangeBonus).toBe(0);
    expect(library.reputationBonus).toBe(10);
    // Effective reputation per turn = base 40 (re-tuned ×4 by
    // MS-0MUR9IMN60093HIE) + upgrade bonus 10
    expect((library.reputationPerTurn ?? 0) + library.reputationBonus).toBeCloseTo(50, 5);
  });

  it('should have a rebalanced cost per the upgrade formula', () => {
    const communityHub = createUpgradeDeck(1).find(u => u.targetBusiness === 'Library')!;
    expect(communityHub.cost).toBe(400);
  });
});
