/**
 * Main Street: Engine scaled piggyback rewards + join-fully cost
 *
 * F2 leaf MS-0MV8BFT73001EUSP of epic MS-0MUYC47EL005Z69H. Covers:
 *
 *  AC1 — a shared, non-mutating, scale-aware per-owner reward projection
 *        (0.5 / 1.0) using the owner's OWN board, including per-owner
 *        reputation coin multipliers and staff mitigation.
 *  AC2 — join-fully deducts exactly `round(1.5 × paidCost)` from the
 *        piggybacker's coins (never partial), credits 100% rewards, and
 *        leaves the action budget untouched.
 *  AC3 — unaffordable join-fully is a no-op (nothing charged) and the 50%
 *        free-ride is applied by the caller with no coins/action spent.
 *  AC4 — exact before/after coin and reputation values for both tiers on a
 *        piggybacker board with and without matching businesses.
 *
 * Fixtures set owner reputation to 0 so the reputation coin multiplier is 1
 * and expected credits are exact integer values (deterministic math checks).
 */
import { describe, it, expect } from 'vitest';

import { createCompetitiveState, type MainStreetState } from '../../src/MainStreetState';
import type { BusinessCard, EventCard, StaffCard } from '../../src/MainStreetCards';
import { updateNeighborsOnPlacement } from '../../src/MainStreetAdjacency';
import {
  applyCompetitiveEventEffects,
  applyPiggybackFreeRide,
  applyPiggybackJoinFully,
  piggybackJoinFullyCost,
  projectPiggybackEventReward,
} from '../../src/MainStreetEngine';

// ── Helpers ───────────────────────────────────────────────────────

function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business' as const,
    id: overrides.id ?? 'test-biz',
    name: overrides.name ?? 'Test Biz',
    cost: overrides.cost ?? 100,
    baseIncome: overrides.baseIncome ?? 50,
    synergyTypes: overrides.synergyTypes ?? ['Food'],
    maxLevel: overrides.maxLevel ?? 1,
    description: overrides.description ?? 'A test business',
    level: overrides.level ?? 0,
    incomeBonus: overrides.incomeBonus ?? 0,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    reputationBonus: overrides.reputationBonus ?? 0,
    ongoingCost: overrides.ongoingCost ?? 0,
    ...overrides,
  } as BusinessCard;
}

function makeEvent(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event' as const,
    id: overrides.id ?? 'evt-test',
    name: overrides.name ?? 'Test Event',
    trigger: overrides.trigger ?? 'Incident',
    cost: overrides.cost ?? 0,
    effect: overrides.effect ?? 'Test effect',
    target: overrides.target ?? 'All',
    coinDelta: overrides.coinDelta ?? 0,
    reputationDelta: overrides.reputationDelta ?? 0,
    ...overrides,
  } as EventCard;
}

/** A representative piggyback-eligible organiser event (Local Festival). */
function festival(overrides: Partial<EventCard> = {}): EventCard {
  return makeEvent({
    id: 'evt-local-festival',
    name: 'Local Festival',
    trigger: 'Investment',
    target: 'SpecificSynergy',
    targetSynergy: 'Culture',
    coinDelta: 200,
    reputationDelta: 100,
    cost: 300,
    piggybackable: true,
    ...overrides,
  });
}

function staffCard(overrides: Partial<StaffCard> = {}): StaffCard {
  return {
    family: 'staff' as const,
    id: overrides.id ?? 'staff-x',
    name: overrides.name ?? 'Staff X',
    cost: overrides.cost ?? 50,
    ongoingCost: overrides.ongoingCost ?? 150,
    actionsPerTurn: overrides.actionsPerTurn ?? 0,
    handSlotsAdded: overrides.handSlotsAdded ?? 0,
    reputationPerTurn: overrides.reputationPerTurn ?? 0,
    specializationSkillIds: overrides.specializationSkillIds ?? [],
    description: overrides.description ?? 'A test staff card',
    ...overrides,
  } as unknown as StaffCard;
}

/**
 * Creates a 2-player competitive state with clean wallets: players start at
 * 1000 coins / 0 reputation (multiplier = 1); the shared host wallet is
 * padded so host-loss checks never fire during fixtures.
 */
function compState(seed: string = 'piggyback-engine', playerCount: number = 2): MainStreetState {
  const state = createCompetitiveState({ seed, playerCount });
  state.resourceBank.coins = 100000;
  state.resourceBank.reputation = 1000;
  for (const p of state.players!) {
    p.coins = 1000;
    p.reputation = 0;
  }
  return state;
}

/** Places a card at a slot, refreshes adjacency caches, tags its owner. */
function place(state: MainStreetState, card: BusinessCard, slot: number, ownerId: number): void {
  state.streetGrid[slot] = card;
  updateNeighborsOnPlacement(state, slot);
  state.ownerTaggedGrid![slot] = { card, ownerId };
}

// ── AC1: scale-aware, non-mutating per-owner projection ──────────

describe('AC1 — scale-aware per-owner reward projection (MS-0MV8BFT73001EUSP)', () => {
  it('SpecificSynergy scales with the owner\'s own matching businesses', () => {
    const state = compState('pb-ac1-synergy');
    place(state, makeBiz({ id: 'c1', synergyTypes: ['Culture'] }), 0, 1);
    place(state, makeBiz({ id: 'c2', synergyTypes: ['Culture'] }), 1, 1);
    place(state, makeBiz({ id: 'c3', synergyTypes: ['Culture'] }), 6, 0); // P0 owns 1

    const full = projectPiggybackEventReward(state, festival(), 1, 1.0);
    expect(full.scale).toBe(1.0);
    expect(full.matchCount).toBe(2);
    expect(full.coins).toBe(400); // 200 × 2 matches
    expect(full.reputation).toBe(100); // rep applied once

    const half = projectPiggybackEventReward(state, festival(), 1, 0.5);
    expect(half.scale).toBe(0.5);
    expect(half.matchCount).toBe(2);
    expect(half.coins).toBe(200);
    expect(half.reputation).toBe(50);
  });

  it('SpecificSynergy with no matching businesses yields a zero reward', () => {
    const state = compState('pb-ac1-nomatch');
    place(state, makeBiz({ id: 'c1', synergyTypes: ['Food'] }), 0, 1);

    const proj = projectPiggybackEventReward(state, festival(), 1, 1.0);
    expect(proj.matchCount).toBe(0);
    expect(proj.coins).toBe(0);
    expect(proj.reputation).toBe(0);
  });

  it('All-target events pay the flat delta regardless of board composition', () => {
    const state = compState('pb-ac1-all');
    const party = makeEvent({
      id: 'evt-garden-party', name: 'Garden Party', trigger: 'Investment', target: 'All',
      coinDelta: 350, reputationDelta: 450, cost: 700, piggybackable: true,
    });

    const full = projectPiggybackEventReward(state, party, 1, 1.0);
    expect(full.matchCount).toBe(0);
    expect(full.coins).toBe(350);
    expect(full.reputation).toBe(450);

    const half = projectPiggybackEventReward(state, party, 1, 0.5);
    expect(half.coins).toBe(175);
    expect(half.reputation).toBe(225);
  });

  it('applies the per-owner reputation coin multiplier to the reward', () => {
    const state = compState('pb-ac1-repmult');
    state.players![1].reputation = 8000; // multiplier = 1 + 8000/8000 = 2 → capped 1.5
    place(state, makeBiz({ id: 'c1', synergyTypes: ['Culture'] }), 0, 1);

    const full = projectPiggybackEventReward(state, festival(), 1, 1.0);
    expect(full.coins).toBe(300); // 200 × 1.5
    expect(full.reputation).toBe(100); // rep is not coin-multiplied

    const half = projectPiggybackEventReward(state, festival(), 1, 0.5);
    expect(half.coins).toBe(150);
    expect(half.reputation).toBe(50);
  });

  it('applies per-owner staff reputation-gain mitigation (Brand Ambassador)', () => {
    const state = compState('pb-ac1-staff');
    state.players![1].staffCards = [staffCard({ specializationSkillIds: ['skill-brand-ambassador'] })];
    place(state, makeBiz({ id: 'c1', synergyTypes: ['Culture'] }), 0, 1);

    const full = projectPiggybackEventReward(state, festival(), 1, 1.0);
    expect(full.reputation).toBe(150); // 100 × 1.5

    const half = projectPiggybackEventReward(state, festival(), 1, 0.5);
    expect(half.reputation).toBe(75);
  });

  it('is non-mutating and consumes no RNG', () => {
    const state = compState('pb-ac1-pure');
    place(state, makeBiz({ id: 'c1', synergyTypes: ['Culture'] }), 0, 1);

    const before = {
      p0coins: state.players![0].coins,
      p0rep: state.players![0].reputation,
      p1coins: state.players![1].coins,
      p1rep: state.players![1].reputation,
      bankCoins: state.resourceBank.coins,
      bankRep: state.resourceBank.reputation,
      rngCalls: state.rngCalls,
    };

    projectPiggybackEventReward(state, festival(), 1, 1.0);
    projectPiggybackEventReward(state, festival(), 1, 0.5);

    expect(state.players![0].coins).toBe(before.p0coins);
    expect(state.players![0].reputation).toBe(before.p0rep);
    expect(state.players![1].coins).toBe(before.p1coins);
    expect(state.players![1].reputation).toBe(before.p1rep);
    expect(state.resourceBank.coins).toBe(before.bankCoins);
    expect(state.resourceBank.reputation).toBe(before.bankRep);
    expect(state.rngCalls).toBe(before.rngCalls);
  });
});

// ── AC2: join-fully cost + 100% reward ───────────────────────────

describe('AC2 — join-fully cost and 100% reward (MS-0MV8BFT73001EUSP)', () => {
  it('deducts exactly 150% of paid cost, credits 100% reward, spends no action', () => {
    const state = compState('pb-ac2-join');
    place(state, makeBiz({ id: 'c1', synergyTypes: ['Culture'] }), 0, 1);
    place(state, makeBiz({ id: 'c2', synergyTypes: ['Culture'] }), 1, 1);
    const budgetBefore = state.players![1].actionBudget;
    const actionsBefore = state.actionsRemaining;

    const result = applyPiggybackJoinFully(state, festival(), 1, 300);

    expect(result.applied).toBe(true);
    expect(result.charge).toBe(450); // round(1.5 × 300)
    expect(result.reward.scale).toBe(1.0);
    expect(result.reward.coins).toBe(400); // 200 × 2 matches
    expect(result.reward.reputation).toBe(100);

    expect(state.players![1].coins).toBe(1000 - 450 + 400); // 950
    expect(state.players![1].reputation).toBe(100);
    expect(state.players![1].actionBudget).toBe(budgetBefore);
    expect(state.actionsRemaining).toBe(actionsBefore);
    // Per-owner authority: the shared host wallet is never touched.
    expect(state.resourceBank.coins).toBe(100000);
    expect(state.resourceBank.reputation).toBe(1000);
  });

  it('rounds the charge to the nearest integer (integer-only economy)', () => {
    expect(piggybackJoinFullyCost(300)).toBe(450);
    expect(piggybackJoinFullyCost(301)).toBe(452); // 451.5 → 452
    expect(piggybackJoinFullyCost(1)).toBe(2); // 1.5 → 2
    expect(piggybackJoinFullyCost(0)).toBe(0);
  });

  it('uses the paid cost (after acting-player discounts), not the nominal cost', () => {
    const state = compState('pb-ac2-paidcost');
    place(state, makeBiz({ id: 'c1', synergyTypes: ['Culture'] }), 0, 1);

    const result = applyPiggybackJoinFully(state, festival(), 1, 120);
    expect(result.charge).toBe(180); // 1.5 × 120, not 1.5 × 300
    expect(state.players![1].coins).toBe(1000 - 180 + 200);
  });

  it('is affordable at the exact boundary (coins === charge)', () => {
    const state = compState('pb-ac2-boundary');
    state.players![1].coins = 450;
    place(state, makeBiz({ id: 'c1', synergyTypes: ['Culture'] }), 0, 1);

    const result = applyPiggybackJoinFully(state, festival(), 1, 300);
    expect(result.applied).toBe(true);
    expect(state.players![1].coins).toBe(450 - 450 + 200); // 200
    expect(state.players![1].reputation).toBe(100);
  });

  it('throws for an unknown seat', () => {
    const state = compState('pb-ac2-badseat');
    expect(() => applyPiggybackJoinFully(state, festival(), 9, 300)).toThrow(/no player record/);
  });
});

// ── AC3: unaffordable no-op + free-ride fallback ─────────────────

describe('AC3 — unaffordable join-fully is a no-op; free-ride fallback (MS-0MV8BFT73001EUSP)', () => {
  it('charges nothing and leaves the wallet untouched when unaffordable', () => {
    const state = compState('pb-ac3-unaffordable');
    state.players![1].coins = 100;
    place(state, makeBiz({ id: 'c1', synergyTypes: ['Culture'] }), 0, 1);

    const result = applyPiggybackJoinFully(state, festival(), 1, 300);

    expect(result.applied).toBe(false);
    expect(result.charge).toBe(450); // reported so the caller can show the shortfall
    expect(state.players![1].coins).toBe(100); // never partially charged
    expect(state.players![1].reputation).toBe(0);
  });

  it('then applies the automatic 50% free-ride (no coins, no action)', () => {
    const state = compState('pb-ac3-freeride');
    state.players![1].coins = 100;
    place(state, makeBiz({ id: 'c1', synergyTypes: ['Culture'] }), 0, 1);
    const budgetBefore = state.players![1].actionBudget;
    const actionsBefore = state.actionsRemaining;

    applyPiggybackJoinFully(state, festival(), 1, 300); // unaffordable no-op
    const ride = applyPiggybackFreeRide(state, festival(), 1);

    expect(ride.scale).toBe(0.5);
    expect(ride.coins).toBe(100); // 200 × 0.5
    expect(ride.reputation).toBe(50); // 100 × 0.5
    expect(state.players![1].coins).toBe(100 + 100); // no charge
    expect(state.players![1].reputation).toBe(50);
    expect(state.players![1].actionBudget).toBe(budgetBefore);
    expect(state.actionsRemaining).toBe(actionsBefore);
  });
});

// ── AC4: both tiers with / without matching businesses ───────────

describe('AC4 — exact both-tier values with and without matching businesses (MS-0MV8BFT73001EUSP)', () => {
  it('join-fully vs free-ride exact before/after values (with matches)', () => {
    const state = compState('pb-ac4-with');
    place(state, makeBiz({ id: 'c1', synergyTypes: ['Culture'] }), 0, 1);
    place(state, makeBiz({ id: 'c2', synergyTypes: ['Culture'] }), 1, 1);

    // Join-fully on seat 1: 1000 coins / 0 rep before.
    const joined = applyPiggybackJoinFully(state, festival(), 1, 300);
    expect(joined.reward.coins).toBe(400);
    expect(joined.reward.reputation).toBe(100);
    expect(state.players![1].coins).toBe(950); // 1000 − 450 + 400
    expect(state.players![1].reputation).toBe(100);

    // Free-ride on seat 0 (no matching businesses → nothing for a synergy event).
    const ride = applyPiggybackFreeRide(state, festival(), 0);
    expect(ride.coins).toBe(0);
    expect(ride.reputation).toBe(0);
    expect(state.players![0].coins).toBe(1000);
    expect(state.players![0].reputation).toBe(0);
  });

  it('with no matching businesses both tiers pay nothing for a synergy event', () => {
    const state = compState('pb-ac4-without');
    place(state, makeBiz({ id: 'c1', synergyTypes: ['Food'] }), 0, 1);

    const full = projectPiggybackEventReward(state, festival(), 1, 1.0);
    const half = projectPiggybackEventReward(state, festival(), 1, 0.5);
    expect(full.coins).toBe(0);
    expect(full.reputation).toBe(0);
    expect(half.coins).toBe(0);
    expect(half.reputation).toBe(0);

    // Applying join-fully still charges the 150% cost (the reward is simply 0).
    const result = applyPiggybackJoinFully(state, festival(), 1, 300);
    expect(result.applied).toBe(true);
    expect(state.players![1].coins).toBe(1000 - 450);
  });
});

// ── Parity + determinism with live competitive routing ───────────

describe('parity and determinism (MS-0MV8BFT73001EUSP AC1)', () => {
  it('projection at 1.0 equals the acting owner credit from applyCompetitiveEventEffects', () => {
    const projected = compState('pb-parity-proj');
    const applied = compState('pb-parity-apply');
    for (const s of [projected, applied]) {
      place(s, makeBiz({ id: 'c1', synergyTypes: ['Culture'] }), 0, 1);
      place(s, makeBiz({ id: 'c2', synergyTypes: ['Culture'] }), 1, 1);
      place(s, makeBiz({ id: 'c3', synergyTypes: ['Culture'] }), 6, 0); // P0 × 1
    }

    const proj = projectPiggybackEventReward(projected, festival(), 1, 1.0);
    applyCompetitiveEventEffects(applied, festival(), 1);

    // The acting owner's live credit matches the piggyback projection exactly.
    expect(applied.players![1].coins - 1000).toBe(proj.coins);
    expect(applied.players![1].reputation - 0).toBe(proj.reputation);
    // The other owner's own routing is unchanged by the projection.
    expect(applied.players![0].coins - 1000).toBe(200);
    expect(projected.players![0].coins).toBe(1000);
  });

  it('repeated projections are deterministic and consume no RNG', () => {
    const state = compState('pb-determinism');
    place(state, makeBiz({ id: 'c1', synergyTypes: ['Culture'] }), 0, 1);

    const rngBefore = state.rngCalls;
    const first = projectPiggybackEventReward(state, festival(), 1, 0.5);
    const second = projectPiggybackEventReward(state, festival(), 1, 0.5);

    expect(second).toEqual(first);
    expect(state.rngCalls).toBe(rngBefore);
  });
});
