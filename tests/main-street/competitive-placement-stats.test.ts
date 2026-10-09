/**
 * Main Street: Competitive Placement Opponent-Benefit Instrumentation Tests
 *
 * Leaf MS-0MUZFVM86003IPSM (parent MS-0MUYODDW300690KX) — the evidence the
 * ownership-aware placement change must produce. The competitive Monte Carlo
 * harness now tallies, for every street placement, the marginal synergy it
 * anchors for the acting seat's own businesses versus other seats'. These
 * tests pin the measurement (per-owner attribution), the wiring into the run
 * summaries, and determinism (the instrumentation consumes no RNG).
 *
 * AC7 — Before/after competitive evidence: the measurement is the metric the
 *        evidence artefact reports (rate of placements conferring net benefit
 *        on opponents).
 */
import { describe, it, expect } from 'vitest';

import {
  runCompetitiveSeed,
  runCompetitiveMonteCarlo,
  measurePlacementBenefit,
  emptyCompetitivePlacementStats,
  type CompetitivePlacementStats,
} from '../../src/MainStreetMonteCarlo';
import { createCompetitiveState, type MainStreetState } from '../../src/MainStreetState';
import { executeCompetitiveWeekStart } from '../../src/MainStreetEngine';
import type { BusinessCard, CommunitySpaceCard } from '../../src/MainStreetCards';

// ── Fixtures ─────────────────────────────────────────────────

/** A competitive board with an empty, untagged street and seat 0 acting. */
function board(seed: string): MainStreetState {
  const state = createCompetitiveState({ seed, playerCount: 2 });
  executeCompetitiveWeekStart(state);
  state.streetGrid = new Array(state.streetGrid.length).fill(null);
  state.ownerTaggedGrid = state.ownerTaggedGrid!.map(() => ({ card: null, ownerId: null }));
  state.activePlayerId = 0;
  return state;
}

/** An income-producing neighbour with the given synergy type. */
function makeBiz(id: string, synergy: BusinessCard['synergyTypes'][number]): BusinessCard {
  return {
    family: 'business',
    id,
    name: id,
    cost: 100,
    baseIncome: 400,
    synergyTypes: [synergy],
    maxLevel: 1,
    description: id,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
  } as BusinessCard;
}

/** A synergy-anchor community space with the given synergy type. */
function makeSpace(id: string, synergy: CommunitySpaceCard['synergyTypes'][number]): CommunitySpaceCard {
  return {
    family: 'community-space',
    id,
    name: id,
    cost: 300,
    baseIncome: 0,
    synergyTypes: [synergy],
    maxLevel: 1,
    description: id,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
  } as CommunitySpaceCard;
}

/** Places a card in a slot and tags the owner (mirrors engine placement). */
function placeAt(state: MainStreetState, card: BusinessCard | CommunitySpaceCard, slot: number, ownerId: number): void {
  state.streetGrid[slot] = card;
  state.ownerTaggedGrid![slot] = { card, ownerId };
}

const PLACEMENT_SLOT = 3;
const NEIGHBOUR_SLOT = 4;
const SECOND_NEIGHBOUR_SLOT = 8;

// ── AC7: per-owner attribution of a placement's anchored synergy ──

describe('measurePlacementBenefit — per-owner synergy attribution', () => {
  it('credits an own-owned neighbour to own and leaves opponent at zero', () => {
    const state = board('measure-own');
    placeAt(state, makeBiz('cinema', 'Entertainment'), NEIGHBOUR_SLOT, 0);
    const before = [...state.streetGrid];
    placeAt(state, makeSpace('park', 'Entertainment'), PLACEMENT_SLOT, 0);

    const { own, opponent } = measurePlacementBenefit(state, before, PLACEMENT_SLOT, 0);
    expect(own).toBeGreaterThan(0);
    expect(opponent).toBe(0);
  });

  it('attributes an other-seat neighbour entirely to opponent', () => {
    const state = board('measure-opponent');
    placeAt(state, makeBiz('cinema', 'Entertainment'), NEIGHBOUR_SLOT, 1);
    const before = [...state.streetGrid];
    placeAt(state, makeSpace('park', 'Entertainment'), PLACEMENT_SLOT, 0);

    const { own, opponent } = measurePlacementBenefit(state, before, PLACEMENT_SLOT, 0);
    expect(own).toBe(0);
    expect(opponent).toBeGreaterThan(0);
  });

  it('splits a mixed own/opponent neighbourhood across both buckets', () => {
    const state = board('measure-mixed');
    placeAt(state, makeBiz('own-food', 'Food'), NEIGHBOUR_SLOT, 0);
    placeAt(state, makeBiz('opp-culture', 'Culture'), SECOND_NEIGHBOUR_SLOT, 1);
    const before = [...state.streetGrid];
    const hub = {
      ...makeSpace('community-hub', 'Food'),
      synergyTypes: ['Food', 'Culture'],
    } as CommunitySpaceCard;
    placeAt(state, hub, PLACEMENT_SLOT, 0);

    const { own, opponent } = measurePlacementBenefit(state, before, PLACEMENT_SLOT, 0);
    expect(own).toBeGreaterThan(0);
    expect(opponent).toBeGreaterThan(0);
  });
});

// ── AC7: wiring into the run summaries ───────────────────────

describe('competitive runs carry placement-opponent-benefit stats', () => {
  it('tallies placements per player with internally consistent counters', () => {
    const seeds = Array.from({ length: 12 }, (_, i) => `placement-stats-${i + 1}`);
    const result = runCompetitiveMonteCarlo({ seeds, maxTurns: 20 });

    let totalPlacements = 0;
    for (const run of result.runs) {
      for (const player of run.players) {
        const stats = player.placementStats;
        expect(stats).toBeDefined();
        const s = stats as CompetitivePlacementStats;

        expect(s.placements).toBe(s.businessPlacements + s.communitySpacePlacements);
        expect(s.opponentBeneficialPlacements).toBeLessThanOrEqual(s.placements);
        expect(s.opponentTouchedPlacements).toBeGreaterThanOrEqual(
          s.opponentBeneficialPlacements,
        );
        expect(s.businessOpponentBeneficialPlacements).toBeLessThanOrEqual(
          s.businessPlacements,
        );
        expect(s.communitySpaceOpponentBeneficialPlacements).toBeLessThanOrEqual(
          s.communitySpacePlacements,
        );
        expect(s.ownSynergyAnchored).toBeGreaterThanOrEqual(0);
        expect(s.opponentSynergyAnchored).toBeGreaterThanOrEqual(0);
        totalPlacements += s.placements;
      }
    }
    // The competitive greedy AI does place cards, so the instrumentation must
    // observe real placements — a permanent zero would make the evidence vacuous.
    expect(totalPlacements).toBeGreaterThan(0);
  });

  it('is deterministic: the same seed yields identical placement stats', () => {
    const seed = 'placement-determinism';
    const a = runCompetitiveSeed(seed, 20);
    const b = runCompetitiveSeed(seed, 20);
    expect(a.players.map(p => p.placementStats)).toEqual(b.players.map(p => p.placementStats));
  });

  it('emptyCompetitivePlacementStats is a zeroed tally', () => {
    expect(emptyCompetitivePlacementStats()).toEqual({
      placements: 0,
      businessPlacements: 0,
      communitySpacePlacements: 0,
      ownSynergyAnchored: 0,
      opponentSynergyAnchored: 0,
      opponentBeneficialPlacements: 0,
      opponentTouchedPlacements: 0,
      businessOpponentBeneficialPlacements: 0,
      communitySpaceOpponentBeneficialPlacements: 0,
    });
  });
});
