/**
 * Main Street: Grand Opening dynamic synergy — state lifecycle
 * (MS-0MVCS4WNF008KHU7, parent MS-0MV8KSPFK006HTXG).
 *
 * Test-first contract for the Feature-1 state model (implementing child
 * MS-0MVCS1NOH0074YY2): pins the lifecycle of the new
 * `placedSynergiesThisTurn` field that drives Grand Opening's dynamic
 * payout — which synergy was opened (placed) this turn.
 *
 * Acceptance Criteria:
 *  1. Every placement path records the placed card's synergyTypes into
 *     `placedSynergiesThisTurn`: purchaseBusiness, playBusinessFromHand,
 *     buyAndPlaceBusiness, plus community-space placements (symmetric
 *     with the existing placement gate).
 *  2. Week-start reset sets the field back to `null`/`[]`.
 *  3. Serialise → deserialise round-trip preserves the field.
 *  4. Legacy saves (without the field) backfill to `null` and do not crash.
 *  5. Undo of a placement restores the pre-placement synergy value, and
 *     redo re-applies the just-placed value.
 *  6. All tests pass with the project test suite.
 *
 * The contract cases are authored **red-phase** (`it.fails`, per the repo's
 * test-first tracer-bullet convention): they must FAIL against today's code
 * (where the field does not yet exist — reads are `undefined`) and are
 * flipped to a plain `it` by the implementing child once the state model
 * lands. Guards that already hold today stay plain `it` so they keep
 * protecting the contract through the change.
 *
 * Every scenario uses a seeded game state plus deterministic fixture cards
 * pushed into the market with explicit synergy types, so the assertions
 * never depend on the seeded market draw.
 */
import { describe, expect, it } from 'vitest';

import { UndoRedoManager } from '@core-engine/UndoRedoManager';

import {
  setupMainStreetGame,
  serializeMainStreetState,
  deserializeMainStreetState,
  type MainStreetState,
} from '../../src/MainStreetState';
import { executeWeekStart, buyAndPlaceBusiness } from '../../src/MainStreetEngine';
import { purchaseBusiness, playBusinessFromHand, moveToHand } from '../../src/MainStreetMarket';
import { buyBusinessCommand } from '../../src/MainStreetCommands';
import type { BusinessCard, CommunitySpaceCard, SynergyType } from '../../src/MainStreetCards';

// ── Helpers ──────────────────────────────────────────────────

/**
 * Reads the Feature-1 field from state. Read through an `unknown` cast so
 * the suite stays robust while the implementing child is still landing the
 * typed field; absent (should not happen once F1I ships) falls back to
 * `undefined`, which makes every contract assertion fail today (red-phase).
 */
function placedSynergies(state: MainStreetState): SynergyType[] | null | undefined {
  return (state as unknown as { placedSynergiesThisTurn?: SynergyType[] | null })
    .placedSynergiesThisTurn;
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
    description: 'Grand Opening dynamic-synergy fixture.',
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
    description: 'Grand Opening dynamic-synergy community-space fixture.',
  } as unknown as CommunitySpaceCard;
}

/**
 * Creates a MarketPhase state with the given fixture card already sitting in
 * the market row and enough coins for any placement path.
 */
function marketWith(
  seed: string,
  card: BusinessCard | CommunitySpaceCard,
): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  state.resourceBank.coins = 9999;
  state.market.cards.push(card);
  return state;
}

/** Moves a card id from the market into the hand and returns its hand index. */
function moveMarketCardToHand(state: MainStreetState, id: string, seed: string): number {
  const card = state.market.cards.find(c => c.id === id);
  if (!card) {
    throw new Error(`Fixture ${id} missing from market (seed ${seed})`);
  }
  moveToHand(state, id);
  const handIndex = state.hand.findIndex(c => c.id === id);
  if (handIndex < 0) {
    throw new Error(`Fixture ${id} not found in hand (seed ${seed})`);
  }
  return handIndex;
}

/** True when the field holds a cleared week-start value (`null` or `[]`). */
function isCleared(value: SynergyType[] | null | undefined): boolean {
  return value === null || (Array.isArray(value) && value.length === 0);
}

// ── AC1: Every placement path records the placed card's synergy ─

describe('AC1: placement paths record placedSynergiesThisTurn', () => {
  it.fails('purchaseBusiness records the bought card synergyTypes', () => {
    const state = marketWith('f1t-ac1-purchase', businessFixture('f1t-bakery', ['Food']));

    purchaseBusiness(state, 'f1t-bakery', 0);

    expect(placedSynergies(state)).toEqual(['Food']);
    expect(state.streetGrid[0]?.id).toBe('f1t-bakery');
  });

  it.fails('playBusinessFromHand records the played card synergyTypes', () => {
    const state = marketWith('f1t-ac1-play-hand', businessFixture('f1t-cafe', ['Food']));
    const handIndex = moveMarketCardToHand(state, 'f1t-cafe', 'f1t-ac1-play-hand');

    playBusinessFromHand(state, handIndex, 0);

    expect(placedSynergies(state)).toEqual(['Food']);
    expect(state.streetGrid[0]?.id).toBe('f1t-cafe');
  });

  it.fails('buyAndPlaceBusiness records the placed card synergyTypes', () => {
    const state = marketWith('f1t-ac1-bap', businessFixture('f1t-gallery', ['Culture', 'Entertainment']));

    buyAndPlaceBusiness(state, 'f1t-gallery', 0);

    expect(placedSynergies(state)).toEqual(['Culture', 'Entertainment']);
    expect(state.streetGrid[0]?.id).toBe('f1t-gallery');
  });

  it.fails('community-space placements populate the field symmetrically', () => {
    const state = marketWith('f1t-ac1-cs', communitySpaceFixture('f1t-library', ['Culture']));

    purchaseBusiness(state, 'f1t-library', 0);

    expect(placedSynergies(state)).toEqual(['Culture']);
    expect(state.streetGrid[0]?.id).toBe('f1t-library');
  });
});

// ── AC2: Week-start reset ────────────────────────────────────

describe('AC2: WeekStart resets placedSynergiesThisTurn to null/[]', () => {
  it.fails('replaces the recorded value with a cleared one at the new day', () => {
    const state = marketWith('f1t-ac2-reset', businessFixture('f1t-bakery', ['Food']));

    purchaseBusiness(state, 'f1t-bakery', 0);
    expect(placedSynergies(state)).toEqual(['Food']);

    state.phase = 'WeekStart';
    executeWeekStart(state);

    expect(isCleared(placedSynergies(state))).toBe(true);
    expect((state as unknown as { businessPlacedThisTurn?: boolean }).businessPlacedThisTurn).toBe(false);
  });
});

// ── AC3: Serialisation round-trip ────────────────────────────

describe('AC3: serialise → deserialise round-trip preserves the field', () => {
  it.fails('keeps the recorded synergy across a save/load boundary', () => {
    const state = marketWith('f1t-ac3-roundtrip', businessFixture('f1t-bakery', ['Food']));

    purchaseBusiness(state, 'f1t-bakery', 0);

    const restored = deserializeMainStreetState(serializeMainStreetState(state));

    expect(placedSynergies(restored)).toEqual(['Food']);
  });
});

// ── AC4: Legacy backfill ─────────────────────────────────────

describe('AC4: legacy saves without the field backfill to null without crashing', () => {
  it('deserialises a legacy save (field absent) without crashing', () => {
    const state = marketWith('f1t-ac4-nocrash', businessFixture('f1t-bakery', ['Food']));
    purchaseBusiness(state, 'f1t-bakery', 0);

    const saved = serializeMainStreetState(state) as unknown as Record<string, unknown>;
    delete saved.placedSynergiesThisTurn;

    // Must not throw and must yield a usable state.
    const restored = deserializeMainStreetState(saved as never);
    expect(restored.streetGrid[0]?.id).toBe('f1t-bakery');
  });

  it.fails('backfills a missing field to null on legacy saves', () => {
    const state = marketWith('f1t-ac4-backfill', businessFixture('f1t-bakery', ['Food']));
    purchaseBusiness(state, 'f1t-bakery', 0);

    const saved = serializeMainStreetState(state) as unknown as Record<string, unknown>;
    delete saved.placedSynergiesThisTurn;

    const restored = deserializeMainStreetState(saved as never);

    expect(placedSynergies(restored)).toBeNull();
  });
});

// ── AC5: Undo / redo of a placement ──────────────────────────

describe('AC5: undo/redo restores and re-applies the synergy value', () => {
  it.fails('undo restores the pre-placement value and redo re-applies the placed one', () => {
    const state = marketWith('f1t-ac5-undo', businessFixture('f1t-cafe', ['Food']));
    // Second fixture for the undoable placement — slot 1 is still free.
    state.market.cards.push(businessFixture('f1t-gallery', ['Culture', 'Entertainment']));

    // Pre-placement synergy comes from a first placement this turn.
    purchaseBusiness(state, 'f1t-cafe', 0);
    expect(placedSynergies(state)).toEqual(['Food']);

    // The undoable placement switches the recorded synergy to the new card.
    const mgr = new UndoRedoManager();
    mgr.execute(buyBusinessCommand(state, 'f1t-gallery', 1));
    expect(placedSynergies(state)).toEqual(['Culture', 'Entertainment']);

    // Undo: back to the pre-placement value.
    mgr.undo();
    expect(placedSynergies(state)).toEqual(['Food']);
    expect(state.streetGrid[1]).toBeNull();

    // Redo: the just-placed value is re-applied.
    mgr.redo();
    expect(placedSynergies(state)).toEqual(['Culture', 'Entertainment']);
    expect(state.streetGrid[1]?.id).toBe('f1t-gallery');
  });
});
