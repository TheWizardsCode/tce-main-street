/**
 * Main Street: Community-space AI scoring (MS-0MUX8J9KJ005ZKDW).
 *
 * The greedy AI used to score community spaces with the business formula
 * `(baseIncome + projectedSynergyBonus) × horizon − cost`. Because a
 * community space has `baseIncome = 0` and earns no synergy income itself,
 * that collapsed to `−cost`: the AI only ever picked one when it was the
 * least-bad affordable card. Community spaces now have their own placement
 * value (AC2):
 *
 *   (base income + synergy anchored for neighbours + reputation per turn)
 *     × horizon − cost − ongoing running cost × horizon
 *     − COMMUNITY_SPACE_SCORE_PENALTY
 *
 * and the greedy spend chain only accepts a community space whose score is
 * positive (AC3), so an "empty synergy" placement is no longer bought merely
 * because it is cheap. Genuinely valuable synergy placements are preserved
 * (AC4).
 */
import { describe, it, expect } from 'vitest';

import {
  setupMainStreetGame,
  createCompetitiveState,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  executeWeekStart,
  executeCompetitiveWeekStart,
  type PlayerAction,
} from '../../src/MainStreetEngine';
import {
  scoreAction,
  scoreCommunitySpacePlacement,
  scoreCompetitiveAction,
  aiPlanningHorizon,
  GreedyStrategy,
  MainStreetAiPlayer,
  COMMUNITY_SPACE_SCORE_PENALTY,
} from '../../src/MainStreetAiStrategy';
import type { BusinessCard, CommunitySpaceCard } from '../../src/MainStreetCards';
import { GRID_SIZE } from '../../src/MainStreetCards';
import { createSeededRng } from '@core-engine/SeededRng';

// ── Fixtures ────────────────────────────────────────────────

function makeState(seed: string = 'cs-ai-scoring'): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  // Isolate the heuristic from the seeded market / street contents.
  state.streetGrid = new Array(GRID_SIZE).fill(null);
  state.market.cards = [];
  state.hand = [];
  state.resourceBank.coins = 1000;
  state.resourceBank.reputation = 0;
  return state;
}

function makeBusiness(overrides: Partial<BusinessCard> & Pick<BusinessCard, 'id'>): BusinessCard {
  return {
    family: 'business',
    name: overrides.name ?? 'Business',
    cost: 0,
    baseIncome: 0,
    synergyTypes: [],
    maxLevel: 1,
    description: 'test business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    appliedUpgrades: [],
    ...overrides,
  } as BusinessCard;
}

function makeCommunitySpace(
  overrides: Partial<CommunitySpaceCard> & Pick<CommunitySpaceCard, 'id'>,
): CommunitySpaceCard {
  return {
    family: 'community-space',
    name: overrides.name ?? 'Community Space',
    cost: 0,
    baseIncome: 0,
    ongoingCost: 0,
    synergyTypes: [],
    maxLevel: 1,
    description: 'test community space',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    appliedUpgrades: [],
    ...overrides,
  } as CommunitySpaceCard;
}

// ── AC2: a zero-income, zero-synergy space loses to a business ──

describe('community-space scoring: zero-income space vs business', () => {
  it('scores a no-value community space below an affordable low-income business', () => {
    const state = makeState();
    state.resourceBank.coins = 1000;
    const business = makeBusiness({ id: 'biz-diner-0', baseIncome: 100, cost: 300 });
    const space = makeCommunitySpace({ id: 'cs-park-0', cost: 300 });
    state.market.cards = [business, space];

    const businessScore = scoreAction(state, {
      type: 'buy-business',
      cardId: business.id,
      slotIndex: 0,
    });
    const spaceScore = scoreAction(state, { type: 'buy-business', cardId: space.id, slotIndex: 1 });

    expect(businessScore).toBeGreaterThan(spaceScore);
    // No neighbours, no reputation, no running cost: the space can only lose
    // its cost and the business-preference penalty.
    expect(spaceScore).toBe(-300 - COMMUNITY_SPACE_SCORE_PENALTY);
  });

  it('greedy buys the business and leaves the no-value space on the market', () => {
    const state = makeState();
    state.resourceBank.coins = 1000;
    const business = makeBusiness({ id: 'biz-diner-0', baseIncome: 100, cost: 300 });
    const space = makeCommunitySpace({ id: 'cs-park-0', cost: 300 });
    state.market.cards = [business, space];

    const action = new MainStreetAiPlayer(GreedyStrategy, createSeededRng(1)).chooseAction(state);
    expect(action.type).toBe('buy-business');
    expect((action as { cardId: string }).cardId).toBe(business.id);
  });
});

// ── AC2: the synergy a space anchors for neighbours is its coin value ──

describe('community-space scoring: neighbour synergy', () => {
  it('values an adjacent synergy anchor above a disconnected placement', () => {
    const state = makeState();
    const horizon = aiPlanningHorizon(state);
    const bonusPerNeighbor = state.config.synergyBonusPerNeighbor;
    // Entertainment business on slot 4; slot 3 is adjacent, slot 0 is not.
    state.streetGrid[4] = makeBusiness({
      id: 'biz-cinema-0',
      baseIncome: 400,
      synergyTypes: ['Entertainment'],
    });
    const space = makeCommunitySpace({
      id: 'cs-playground-0',
      cost: 300,
      synergyTypes: ['Entertainment'],
    });

    const adjacent = scoreCommunitySpacePlacement(state, space, 3, horizon);
    const disconnected = scoreCommunitySpacePlacement(state, space, 0, horizon);

    // The anchor adds one matching neighbour to the business: 400 × 0.5 ×
    // bonusPerNeighbor per turn, over the planning horizon.
    const expectedGain = 400 * 0.5 * bonusPerNeighbor * horizon;
    expect(adjacent - disconnected).toBe(expectedGain);
    expect(adjacent).toBeGreaterThan(0);
  });

  it('places a synergy-anchoring space when it clears the penalty (AC4)', () => {
    const state = makeState();
    state.resourceBank.coins = 1000;
    state.streetGrid[4] = makeBusiness({
      id: 'biz-cinema-0',
      baseIncome: 400,
      synergyTypes: ['Entertainment'],
    });
    const space = makeCommunitySpace({
      id: 'cs-playground-0',
      cost: 300,
      synergyTypes: ['Entertainment'],
    });
    state.market.cards = [space];

    const action = new MainStreetAiPlayer(GreedyStrategy, createSeededRng(1)).chooseAction(state);
    expect(action.type).toBe('buy-business');
    expect((action as { cardId: string }).cardId).toBe(space.id);
  });
});

// ── AC2: ongoing running cost is part of the score ──────────

describe('community-space scoring: running cost', () => {
  it('subtracts ongoingCost × horizon from the placement value', () => {
    const state = makeState();
    const horizon = aiPlanningHorizon(state);
    const freeToRun = makeCommunitySpace({ id: 'cs-playground-0', cost: 300, ongoingCost: 0 });
    const costlyToRun = makeCommunitySpace({ id: 'cs-park-0', cost: 300, ongoingCost: 40 });

    const freeScore = scoreCommunitySpacePlacement(state, freeToRun, 0, horizon);
    const costlyScore = scoreCommunitySpacePlacement(state, costlyToRun, 0, horizon);

    expect(freeScore - costlyScore).toBe(40 * horizon);
  });
});

// ── AC3: the named threshold governs the business preference ──

describe('community-space scoring: business-preference threshold', () => {
  it('exposes a positive named penalty constant', () => {
    expect(COMMUNITY_SPACE_SCORE_PENALTY).toBeGreaterThan(0);
  });

  it('greedy declines a marginal space whose value does not clear the penalty', () => {
    const state = makeState();
    const horizon = aiPlanningHorizon(state);
    state.resourceBank.coins = 1000;
    // Gross 30 × horizon, cost 300; at every horizon the net after the
    // penalty stays negative, so the space is not eligible.
    const space = makeCommunitySpace({ id: 'cs-fountain-0', cost: 300, reputationPerTurn: 30 });
    state.market.cards = [space];

    const score = scoreCommunitySpacePlacement(state, space, 0, horizon);
    expect(score).toBeLessThan(0);
    // The penalty is what tips it below zero: its unpenalised value is positive
    // over the (long) early-game horizon.
    expect(score + COMMUNITY_SPACE_SCORE_PENALTY).toBeGreaterThan(0);

    const action = new MainStreetAiPlayer(GreedyStrategy, createSeededRng(1)).chooseAction(state);
    // It may still lock the card into hand (one action, no coins), but it will
    // not spend coins placing it on the street.
    expect(action.type).not.toBe('buy-business');
  });

  it('greedy still buys a genuinely valuable space (AC4)', () => {
    const state = makeState();
    state.resourceBank.coins = 1000;
    const space = makeCommunitySpace({ id: 'cs-shelter-0', cost: 100, reputationPerTurn: 800 });
    state.market.cards = [space];

    const action = new MainStreetAiPlayer(GreedyStrategy, createSeededRng(1)).chooseAction(state);
    expect(action.type).toBe('buy-business');
    expect((action as { cardId: string }).cardId).toBe(space.id);
  });
});

// ── AC2: hand-play mirror ───────────────────────────────────

describe('community-space scoring: play from hand', () => {
  it('uses the community formula for play-business-from-hand', () => {
    const state = makeState();
    const horizon = aiPlanningHorizon(state);
    const space = makeCommunitySpace({ id: 'cs-park-0', cost: 300 });
    state.resourceBank.coins = 1000;
    state.hand = [space];

    const score = scoreAction(state, { type: 'play-business-from-hand', handIndex: 0, slotIndex: 0 });
    expect(score).toBe(scoreCommunitySpacePlacement(state, space, 0, horizon));
    expect(score).toBe(-300 - COMMUNITY_SPACE_SCORE_PENALTY);
  });
});

// ── AC2: competitive mirror cannot diverge ──────────────────

describe('community-space scoring: competitive mirror', () => {
  it('scores a no-value community space below a business for the acting seat', () => {
    const state = createCompetitiveState({ seed: 'cs-ai-competitive', playerCount: 2 });
    executeCompetitiveWeekStart(state);
    state.streetGrid = new Array(GRID_SIZE).fill(null);
    state.market.cards = [];
    const business = makeBusiness({ id: 'biz-diner-0', baseIncome: 100, cost: 300 });
    const space = makeCommunitySpace({ id: 'cs-park-0', cost: 300 });
    state.market.cards = [business, space];

    const businessScore = scoreCompetitiveAction(
      state,
      { type: 'buy-business', cardId: business.id, slotIndex: 0 } as PlayerAction,
      0,
    );
    const spaceScore = scoreCompetitiveAction(
      state,
      { type: 'buy-business', cardId: space.id, slotIndex: 1 } as PlayerAction,
      0,
    );

    expect(spaceScore).toBeLessThan(businessScore);
    expect(spaceScore).toBe(-300 - COMMUNITY_SPACE_SCORE_PENALTY);
  });
});
