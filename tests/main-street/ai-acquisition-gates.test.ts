/**
 * Main Street: AI acquisition gates (MS-0MV5VOIV40020KXT)
 *
 * Two heuristic gates on the market `move-to-hand` acquisition decision:
 *
 *   1. **Expensive-business gate** — an *unaffordable* business is not taken
 *      to hand when the acting seat has no income stream (no placed business
 *      it owns with `baseIncome > 0`). An affordable business, or an
 *      unaffordable one for a seat with income, is taken as before.
 *   2. **Untargeted-upgrade gate** — an upgrade is not taken to hand unless
 *      the acting seat owns its `targetBusiness` at the required level (the
 *      same eligibility the apply/play paths use).
 *
 * The gates are scored (not enumeration-filtered), so `RandomStrategy` keeps
 * its uniform random baseline (asserted here). Single-player gates are
 * exercised through `GreedyStrategy`/`BankingGreedyStrategy.chooseAction`
 * because the acquisition scorer is not exported; the competitive mirror is
 * exercised through the exported `scoreCompetitiveAction` pure scorer.
 *
 * @module tests/main-street/ai-acquisition-gates
 */

import { describe, it, expect } from 'vitest';

import {
  setupMainStreetGame,
  createCompetitiveState,
  type MainStreetState,
} from '../../src/MainStreetState';
import { executeWeekStart, executeCompetitiveWeekStart } from '../../src/MainStreetEngine';
import {
  GreedyStrategy,
  BankingGreedyStrategy,
  RandomStrategy,
  enumerateLegalActions,
  scoreCompetitiveAction,
} from '../../src/MainStreetAiStrategy';
import type { BusinessCard, UpgradeCard } from '../../src/MainStreetCards';

// ── Fixtures ─────────────────────────────────────────────────

function createTestState(seed: string = 'acq-gates'): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  return state;
}

function makeRng(seed: number = 42): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

function makeBusiness(
  overrides: Partial<BusinessCard> & Pick<BusinessCard, 'id' | 'name' | 'cost'>,
): BusinessCard {
  return {
    family: 'business',
    baseIncome: 0,
    synergyTypes: [],
    description: 'Test business.',
    maxLevel: 1,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    ...overrides,
  } as BusinessCard;
}

function makeUpgrade(
  overrides: Partial<UpgradeCard> &
    Pick<UpgradeCard, 'id' | 'name' | 'cost' | 'targetBusiness'>,
): UpgradeCard {
  return {
    family: 'upgrade',
    incomeBonus: 0,
    synergyRangeBonus: 0,
    description: 'Test upgrade.',
    requiredLevel: 0,
    ...overrides,
  } as UpgradeCard;
}

/**
 * Wipes the decision surface to a single-action turn with known coins, then
 * fills every street slot so `buy-business` / `play-business-from-hand` cannot
 * outrank the `move-to-hand` acquisition tier under test.
 *
 * `income` controls whether the seat has an income stream: when true the first
 * placed business has `baseIncome > 0`, otherwise every placed business earns
 * nothing.
 */
function prepareFullBoard(
  state: MainStreetState,
  coins: number,
  income: boolean,
): void {
  state.bankedActions = 0;
  state.actionsRemaining = 1;
  state.resourceBank.coins = coins;
  state.resourceBank.reputation = 0; // keep the favour fallback out of the way
  state.hand = [];
  state.market.cards = [];
  state.decks.business = [];
  state.decks.communitySpace = [];
  state.decks.upgrade = [];
  state.decks.event = [];
  state.decks.staff = [];

  state.streetGrid = state.streetGrid.map((_, index) =>
    makeBusiness({
      id: `filler-${index}`,
      name: `Filler ${index}`,
      cost: 1,
      baseIncome: income && index === 0 ? 5 : 0,
    }),
  );
}

/** The only market card is `card`; asserts the acquisition tier is reached. */
function seedMarketCard(state: MainStreetState, card: BusinessCard | UpgradeCard): void {
  state.market.cards = [card];
}

// ── Business gate: four combinations ────────────────────────

describe('business acquisition gate (single-player)', () => {
  it('affordable + no income stream → takes the card to hand', () => {
    const state = createTestState('biz-affordable-no-income');
    prepareFullBoard(state, 100, false);
    seedMarketCard(state, makeBusiness({ id: 'biz-cheap', name: 'Cheap Shop', cost: 40 }));

    const action = GreedyStrategy.chooseAction(state, makeRng());
    expect(action.type).toBe('move-to-hand');
  });

  it('affordable + income stream → takes the card to hand', () => {
    const state = createTestState('biz-affordable-income');
    prepareFullBoard(state, 100, true);
    seedMarketCard(state, makeBusiness({ id: 'biz-cheap', name: 'Cheap Shop', cost: 40 }));

    const action = GreedyStrategy.chooseAction(state, makeRng());
    expect(action.type).toBe('move-to-hand');
  });

  it('unaffordable + income stream → takes the card to hand', () => {
    const state = createTestState('biz-unaffordable-income');
    prepareFullBoard(state, 10, true);
    seedMarketCard(state, makeBusiness({ id: 'biz-mega', name: 'Mega Mall', cost: 5000 }));

    const action = GreedyStrategy.chooseAction(state, makeRng());
    expect(action.type).toBe('move-to-hand');
  });

  it('unaffordable + no income stream → never takes the card to hand', () => {
    const state = createTestState('biz-unaffordable-no-income');
    prepareFullBoard(state, 10, false);
    seedMarketCard(state, makeBusiness({ id: 'biz-mega', name: 'Mega Mall', cost: 5000 }));

    const action = GreedyStrategy.chooseAction(state, makeRng());
    expect(action.type).not.toBe('move-to-hand');
  });

  it('unaffordable + no income stream → BankingGreedy never takes it either', () => {
    const state = createTestState('biz-banking-no-income');
    prepareFullBoard(state, 10, false);
    seedMarketCard(state, makeBusiness({ id: 'biz-mega', name: 'Mega Mall', cost: 5000 }));

    const action = BankingGreedyStrategy.chooseAction(state, makeRng());
    expect(action.type).not.toBe('move-to-hand');
  });
});

// ── Upgrade gate: owned / absent / wrong level ──────────────

describe('upgrade acquisition gate (single-player)', () => {
  it('owns the target at the required level → takes the upgrade to hand', () => {
    const state = createTestState('upg-owned');
    prepareFullBoard(state, 10, false);
    // Grid is full; own a matching business at the required level in slot 0.
    state.streetGrid[0] = makeBusiness({
      id: 'bakery',
      name: 'Bakery',
      cost: 6,
      level: 0,
      maxLevel: 2,
    });
    seedMarketCard(
      state,
      makeUpgrade({
        id: 'upg-bakery',
        name: 'Bakery Upgrade',
        cost: 50,
        targetBusiness: 'Bakery',
        requiredLevel: 0,
      }),
    );

    const action = GreedyStrategy.chooseAction(state, makeRng());
    expect(action.type).toBe('move-to-hand');
  });

  it('does not own the target → never takes the upgrade to hand', () => {
    const state = createTestState('upg-absent');
    prepareFullBoard(state, 10, false);
    // No Bakery anywhere on the street.
    seedMarketCard(
      state,
      makeUpgrade({
        id: 'upg-bakery',
        name: 'Bakery Upgrade',
        cost: 50,
        targetBusiness: 'Bakery',
        requiredLevel: 0,
      }),
    );

    const action = GreedyStrategy.chooseAction(state, makeRng());
    expect(action.type).not.toBe('move-to-hand');
  });

  it('owns the target at the wrong level → never takes the upgrade to hand', () => {
    const state = createTestState('upg-wrong-level');
    prepareFullBoard(state, 10, false);
    // Bakery present but at level 1 while the upgrade requires level 0.
    state.streetGrid[0] = makeBusiness({
      id: 'bakery',
      name: 'Bakery',
      cost: 6,
      level: 1,
      maxLevel: 3,
    });
    seedMarketCard(
      state,
      makeUpgrade({
        id: 'upg-bakery',
        name: 'Bakery Upgrade',
        cost: 50,
        targetBusiness: 'Bakery',
        requiredLevel: 0,
      }),
    );

    const action = GreedyStrategy.chooseAction(state, makeRng());
    expect(action.type).not.toBe('move-to-hand');
  });

  it('owns the target but at max level → never takes the upgrade to hand', () => {
    const state = createTestState('upg-max-level');
    prepareFullBoard(state, 10, false);
    // Bakery at the required level but already maxed out → not upgradeable.
    state.streetGrid[0] = makeBusiness({
      id: 'bakery',
      name: 'Bakery',
      cost: 6,
      level: 1,
      maxLevel: 1,
    });
    seedMarketCard(
      state,
      makeUpgrade({
        id: 'upg-bakery',
        name: 'Bakery Upgrade',
        cost: 50,
        targetBusiness: 'Bakery',
        requiredLevel: 1,
      }),
    );

    const action = GreedyStrategy.chooseAction(state, makeRng());
    expect(action.type).not.toBe('move-to-hand');
  });
});

// ── Random baseline is unchanged ────────────────────────────

describe('RandomStrategy baseline', () => {
  it('keeps gated move-to-hand actions in its uniform legal pick (enumeration untouched)', () => {
    const state = createTestState('random-unchanged');
    prepareFullBoard(state, 10, false);
    seedMarketCard(state, makeBusiness({ id: 'biz-mega', name: 'Mega Mall', cost: 5000 }));

    // Enumeration still offers the gated card...
    expect(
      enumerateLegalActions(state).some(
        a => a.type === 'move-to-hand' && a.cardId === 'biz-mega',
      ),
    ).toBe(true);

    // ...and RandomStrategy can still return it: gating is scoring-only.
    let sawMoveToHand = false;
    for (let i = 0; i < 50 && !sawMoveToHand; i++) {
      const action = RandomStrategy.chooseAction(state, makeRng(i));
      if (action.type === 'move-to-hand') sawMoveToHand = true;
    }
    expect(sawMoveToHand).toBe(true);
  });
});

// ── Competitive mirror (pure scorer) ────────────────────────

function competitiveBoard(seed: string): MainStreetState {
  const state = createCompetitiveState({ seed, playerCount: 2 });
  executeCompetitiveWeekStart(state);
  state.streetGrid = new Array(state.streetGrid.length).fill(null);
  state.ownerTaggedGrid = state.ownerTaggedGrid!.map(() => ({
    card: null,
    ownerId: null,
  }));
  state.market.cards = [];
  state.hand = [];
  state.activePlayerId = 0;
  for (const p of state.players ?? []) p.coins = 0;
  return state;
}

function placeOwned(
  state: MainStreetState,
  card: BusinessCard,
  slot: number,
  ownerId: number,
): void {
  state.streetGrid[slot] = card;
  state.ownerTaggedGrid![slot] = { card, ownerId };
}

describe('competitive acquisition gate (pure scorer)', () => {
  it('unaffordable business with no income stream scores 0', () => {
    const s = competitiveBoard('comp-biz-no-income');
    s.players![0].coins = 10;
    s.market.cards = [makeBusiness({ id: 'biz-mega', name: 'Mega Mall', cost: 5000 })];

    expect(
      scoreCompetitiveAction(s, { type: 'move-to-hand', cardId: 'biz-mega' }, 0),
    ).toBe(0);
  });

  it('unaffordable business with an owned income stream scores its cost', () => {
    const s = competitiveBoard('comp-biz-income');
    s.players![0].coins = 10;
    placeOwned(s, makeBusiness({ id: 'income', name: 'Income', cost: 1, baseIncome: 5 }), 0, 0);
    s.market.cards = [makeBusiness({ id: 'biz-mega', name: 'Mega Mall', cost: 5000 })];

    expect(
      scoreCompetitiveAction(s, { type: 'move-to-hand', cardId: 'biz-mega' }, 0),
    ).toBe(5000);
  });

  it('an opponent\'s income stream does not unlock the gate', () => {
    const s = competitiveBoard('comp-biz-opponent-income');
    s.players![0].coins = 10;
    // Seat 1 owns the income business; seat 0 has none.
    placeOwned(s, makeBusiness({ id: 'income', name: 'Income', cost: 1, baseIncome: 5 }), 0, 1);
    s.market.cards = [makeBusiness({ id: 'biz-mega', name: 'Mega Mall', cost: 5000 })];

    expect(
      scoreCompetitiveAction(s, { type: 'move-to-hand', cardId: 'biz-mega' }, 0),
    ).toBe(0);
  });

  it('upgrade without an owned target at the required level scores 0', () => {
    const s = competitiveBoard('comp-upg-absent');
    s.players![0].coins = 10;
    s.market.cards = [
      makeUpgrade({
        id: 'upg-bakery',
        name: 'Bakery Upgrade',
        cost: 50,
        targetBusiness: 'Bakery',
        requiredLevel: 0,
      }),
    ];

    expect(
      scoreCompetitiveAction(s, { type: 'move-to-hand', cardId: 'upg-bakery' }, 0),
    ).toBe(0);
  });

  it('an opponent-owned target does not satisfy the upgrade gate', () => {
    const s = competitiveBoard('comp-upg-opponent');
    s.players![0].coins = 10;
    placeOwned(
      s,
      makeBusiness({ id: 'bakery', name: 'Bakery', cost: 6, level: 0, maxLevel: 2 }),
      0,
      1,
    );
    s.market.cards = [
      makeUpgrade({
        id: 'upg-bakery',
        name: 'Bakery Upgrade',
        cost: 50,
        targetBusiness: 'Bakery',
        requiredLevel: 0,
      }),
    ];

    expect(
      scoreCompetitiveAction(s, { type: 'move-to-hand', cardId: 'upg-bakery' }, 0),
    ).toBe(0);
  });

  it('upgrade with an owned target at the required level scores its cost', () => {
    const s = competitiveBoard('comp-upg-owned');
    s.players![0].coins = 10;
    placeOwned(
      s,
      makeBusiness({ id: 'bakery', name: 'Bakery', cost: 6, level: 0, maxLevel: 2 }),
      0,
      0,
    );
    s.market.cards = [
      makeUpgrade({
        id: 'upg-bakery',
        name: 'Bakery Upgrade',
        cost: 50,
        targetBusiness: 'Bakery',
        requiredLevel: 0,
      }),
    ];

    expect(
      scoreCompetitiveAction(s, { type: 'move-to-hand', cardId: 'upg-bakery' }, 0),
    ).toBe(50);
  });

  it('upgrade with an owned target at the wrong level scores 0', () => {
    const s = competitiveBoard('comp-upg-wrong-level');
    s.players![0].coins = 10;
    placeOwned(
      s,
      makeBusiness({ id: 'bakery', name: 'Bakery', cost: 6, level: 1, maxLevel: 3 }),
      0,
      0,
    );
    s.market.cards = [
      makeUpgrade({
        id: 'upg-bakery',
        name: 'Bakery Upgrade',
        cost: 50,
        targetBusiness: 'Bakery',
        requiredLevel: 0,
      }),
    ];

    expect(
      scoreCompetitiveAction(s, { type: 'move-to-hand', cardId: 'upg-bakery' }, 0),
    ).toBe(0);
  });
});
