/**
 * Bookkeeper −20% own-business ongoing-cost reduction (MS-0MW7D0LGL007PAUY).
 *
 * The Bookkeeper's printed ability ("Reduces this business ongoing cost by
 * 20%") was description-only. This suite proves the effect end-to-end:
 *
 *  - the shipped template carries `ongoingCostReduction = 0.2` (parsed from the
 *    `effect=ongoing-cost:percent:20` spec);
 *  - the single-player `applyBusinessOngoingCosts` path applies it per business,
 *    before the street-wide Cost Cutter reduction, floored at 0;
 *  - the competitive `applyCompetitiveOngoingCosts` path does the same per owner;
 *  - it is own-business only (a Bookkeeper next door never helps) and inert when
 *    the member is held but not employed;
 *  - no RNG is consumed (determinism preserved).
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import {
  createCompetitiveState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  getStaffCardTemplates,
  type BusinessCard,
  type StaffCard,
} from '../../src/MainStreetCards';
import {
  applyBusinessOngoingCosts,
  applyCompetitiveOngoingCosts,
} from '../../src/MainStreetEngine';
import {
  computeBusinessOngoingCostReductionPct,
  computeBusinessStaffBuffs,
} from '../../src/MainStreetStaffBuffs';

// ── Fixtures ────────────────────────────────────────────────

/** The shipped Bookkeeper template (now carries the parsed effect). */
function bookkeeperTemplate(): StaffCard {
  const card = getStaffCardTemplates().find(c => c.id === 'staff-bookkeeper');
  if (!card) throw new Error('staff-bookkeeper template not found');
  return card;
}

/** A plain business fixture with an exact ongoing cost. */
function makeBusiness(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: overrides.id ?? 'test-biz',
    name: overrides.name ?? 'Test Biz',
    cost: overrides.cost ?? 300,
    baseIncome: overrides.baseIncome ?? 4,
    synergyTypes: overrides.synergyTypes ?? ['Food'],
    maxLevel: overrides.maxLevel ?? 1,
    description: overrides.description ?? 'A test business',
    level: overrides.level ?? 0,
    incomeBonus: overrides.incomeBonus ?? 0,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    reputationBonus: overrides.reputationBonus ?? 0,
    ongoingCost: overrides.ongoingCost ?? 0,
    employedStaff: overrides.employedStaff ?? [],
  } as BusinessCard;
}

/**
 * Employs a Bookkeeper instance at `slot` by registering it on the business's
 * `employedStaff` list (the per-business source of truth) and, when
 * `alsoInState` is set, on `state.staffCards` too (the single-player roster).
 */
function employBookkeeper(
  state: MainStreetState,
  slot: number,
  member: StaffCard = bookkeeperTemplate(),
  alsoInState = true,
): StaffCard {
  const placed: StaffCard = { ...member, id: `${member.id}-${slot}` } as StaffCard;
  placed.employedAtSlot = slot;
  const biz = state.streetGrid[slot]!;
  if (!Array.isArray(biz.employedStaff)) biz.employedStaff = [];
  biz.employedStaff.push(placed);
  if (alsoInState) state.staffCards.push(placed);
  return placed;
}

/** A single-player state with a high coin balance. */
function singlePlayerState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  state.resourceBank.coins = 1000;
  return state;
}

// ── Parsed data ─────────────────────────────────────────────

describe('Bookkeeper effect data and parsing', () => {
  it('parses effect=ongoing-cost:percent:20 into ongoingCostReduction = 0.2', () => {
    expect(bookkeeperTemplate().ongoingCostReduction).toBe(0.2);
  });

  it('carries the reduction through the per-business buff bundle', () => {
    const state = singlePlayerState('bookkeeper-buff-bundle');
    state.streetGrid[0] = makeBusiness({ id: 'b0', ongoingCost: 50 });
    employBookkeeper(state, 0);
    expect(computeBusinessStaffBuffs(state, 0).ongoingCostReductionPct).toBeCloseTo(0.2, 10);
  });
});

// ── Single-player path ──────────────────────────────────────

describe('applyBusinessOngoingCosts — Bookkeeper reduction', () => {
  it('reduces the employing business ongoing cost by 20%', () => {
    const state = singlePlayerState('bookkeeper-single');
    state.streetGrid[0] = makeBusiness({ id: 'b0', ongoingCost: 50 });
    employBookkeeper(state, 0);

    const delta = applyBusinessOngoingCosts(state);

    expect(delta).toBe(-40); // 50 − 20% = 40
    expect(state.resourceBank.coins).toBe(960);
  });

  it('leaves non-employing businesses untouched', () => {
    const state = singlePlayerState('bookkeeper-scope');
    state.streetGrid[0] = makeBusiness({ id: 'with', ongoingCost: 50 });
    state.streetGrid[1] = makeBusiness({ id: 'without', ongoingCost: 50 });
    employBookkeeper(state, 0);

    const delta = applyBusinessOngoingCosts(state);

    expect(delta).toBe(-90); // 40 (with) + 50 (without)
  });

  it('is inert for a Bookkeeper held but not employed', () => {
    const state = singlePlayerState('bookkeeper-not-employed');
    state.streetGrid[0] = makeBusiness({ id: 'b0', ongoingCost: 100 });
    // Hired but never placed on a business: no employedAtSlot, no roster link.
    state.staffCards.push({ ...bookkeeperTemplate(), id: 'unemployed-bookkeeper' });

    const delta = applyBusinessOngoingCosts(state);

    expect(delta).toBe(-100);
  });

  it('does not help a business merely adjacent to the Bookkeeper', () => {
    const state = singlePlayerState('bookkeeper-adjacent');
    state.streetGrid[0] = makeBusiness({ id: 'employer', ongoingCost: 100 });
    state.streetGrid[1] = makeBusiness({ id: 'neighbour', ongoingCost: 100 });
    employBookkeeper(state, 0);

    // Employer: 80, neighbour: 100 (no reduction leaks to the neighbour).
    expect(applyBusinessOngoingCosts(state)).toBe(-180);
    expect(computeBusinessOngoingCostReductionPct(state, 1)).toBe(0);
  });

  it('floors the effective cost at 0 when the reduction reaches 100%', () => {
    const state = singlePlayerState('bookkeeper-floor');
    state.streetGrid[0] = makeBusiness({ id: 'b0', ongoingCost: 50 });
    const full = { ...bookkeeperTemplate(), id: 'full-reduction', ongoingCostReduction: 1 } as StaffCard;
    employBookkeeper(state, 0, full);

    expect(computeBusinessOngoingCostReductionPct(state, 0)).toBe(1);
    expect(applyBusinessOngoingCosts(state)).toBe(0);
    expect(state.resourceBank.coins).toBe(1000);
  });

  it('stacks with the street-wide Cost Cutter reduction (Bookkeeper applied first)', () => {
    const state = singlePlayerState('bookkeeper-cutter');
    state.streetGrid[0] = makeBusiness({ id: 'b0', ongoingCost: 100 });
    employBookkeeper(state, 0);
    // A management-company member (no employedAtSlot) carries the Cost Cutter.
    state.staffCards.push({
      ...bookkeeperTemplate(),
      id: 'host-cutter',
      ongoingCost: 0,
      specializationSkillIds: ['skill-cost-cutter'],
      employedAtSlot: undefined,
      ongoingCostReduction: 0,
    } as StaffCard);

    // 100 − 20% = 80, then −15% street-wide = roundInt(80 × 0.85) = 68.
    expect(applyBusinessOngoingCosts(state)).toBe(-68);
  });
});

// ── Competitive per-owner path ──────────────────────────────

describe('applyCompetitiveOngoingCosts — Bookkeeper reduction per owner', () => {
  it('reduces only the owning seat’s bookkeeper business', () => {
    const state = createCompetitiveState({
      seed: 'bookkeeper-competitive',
      playerCount: 2,
      difficulty: 'Easy',
      loansEnabled: false,
    });
    state.incidentDeck = [];
    for (const seat of state.players!) seat.coins = 1000;

    // Seat 0 owns a business employing the Bookkeeper; seat 1 owns a plain one.
    const seat0 = makeBusiness({ id: 'seat0', ongoingCost: 50 });
    const seat1 = makeBusiness({ id: 'seat1', ongoingCost: 50 });
    state.streetGrid[0] = seat0;
    state.streetGrid[10] = seat1;
    state.ownerTaggedGrid![0] = { card: seat0, ownerId: 0 };
    state.ownerTaggedGrid![10] = { card: seat1, ownerId: 1 };
    employBookkeeper(state, 0, bookkeeperTemplate(), false);

    const breakdown = applyCompetitiveOngoingCosts(state);

    expect(breakdown.get(0)).toEqual({ staff: 0, community: 0, business: -40 });
    expect(breakdown.get(1)).toEqual({ staff: 0, community: 0, business: -50 });
    expect(state.players![0].coins).toBe(960);
    expect(state.players![1].coins).toBe(950);
  });
});

// ── Determinism ─────────────────────────────────────────────

describe('Bookkeeper reduction preserves determinism', () => {
  it('produces an identical deduction across identical seeded runs', () => {
    const run = (): { delta: number; coins: number } => {
      const state = singlePlayerState('bookkeeper-rng');
      state.streetGrid[0] = makeBusiness({ id: 'b0', ongoingCost: 50 });
      employBookkeeper(state, 0);
      const delta = applyBusinessOngoingCosts(state);
      return { delta, coins: state.resourceBank.coins };
    };
    expect(run()).toEqual(run());
  });
});
