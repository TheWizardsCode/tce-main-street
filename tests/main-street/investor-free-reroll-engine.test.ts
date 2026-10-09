/**
 * Main Street: Investor free market re-roll engine tests
 * (MS-0MUOSII720060IZQ, parent MS-0MTISBYLS009936W).
 *
 * Covers the engine/state/bias-draw slice of the Investor's free re-roll:
 *   - the relevance predicate across card families (`isMarketCardRelevant`);
 *   - employed-Investor detection (hosting business synergy types + bias);
 *   - a once-per-turn, coin-free, action-free free re-roll that advances the
 *     shared per-turn escalation counter and resets at WeekStart;
 *   - the bias-aware refill with random fallback, the ≥1-business invariant
 *     and seeded determinism;
 *   - paid-path parity when the bias is inert (bias 0 / empty relevance key).
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import {
  setupMainStreetGame,
  serializeMainStreetState,
  deserializeMainStreetState,
  refillSingleRowMarket,
  isMarketCardRelevant,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  canUseFreeMarketReroll,
  useFreeMarketReroll,
  getEmployedInvestorReroll,
  refreshMarket,
  refreshMarketCost,
  canRefreshMarket,
  INVESTOR_DEFAULT_RELEVANCE_BIAS,
} from '../../src/MainStreetMarket';
import {
  createBusinessDeck,
  createCommunitySpaceDeck,
  createEventDeck,
  createStaffDeck,
  createUpgradeDeck,
  MARKET_TOTAL_SLOTS,
  MARKET_BUSINESS_MIN,
  REFRESH_MARKET_COST,
  REFRESH_MARKET_COST_STEP,
  type BusinessCard,
  type StaffCard,
  type SynergyType,
} from '../../src/MainStreetCards';
import { executeWeekStart, placeStaffOnBusiness } from '../../src/MainStreetEngine';

// ── Fixtures ────────────────────────────────────────────────

/** Builds a business card fixture at a given slot. */
function placeBusinessAt(
  state: MainStreetState,
  slot: number,
  name: string,
  synergy: SynergyType[],
): BusinessCard {
  const biz: BusinessCard = {
    family: 'business',
    id: `biz-${slot}`,
    name,
    cost: 3,
    baseIncome: 2,
    synergyTypes: [...synergy],
    maxLevel: 0,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    description: 'Investor free-reroll fixture.',
    ongoingCost: 0,
    employedStaff: [],
  };
  state.streetGrid[slot] = biz;
  return biz;
}

/** Hires a staff template into the state's staffCards (unique id per call). */
let staffSerial = 0;
function hireStaff(state: MainStreetState, id: string): StaffCard {
  const tpl = createStaffDeck(1).find(c => c.id.startsWith(id))!;
  const card = { ...tpl, id: `${tpl.id}-fixture-${staffSerial++}` };
  state.staffCards.push(card);
  return card;
}

/** Employs an Investor (generalist) at the given business slot. */
function employInvestorAt(state: MainStreetState, slot: number): StaffCard {
  const investor = hireStaff(state, 'staff-investor');
  placeStaffOnBusiness(state, investor.id, slot);
  return investor;
}

function marketPhaseState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  state.phase = 'MarketPhase';
  return state;
}

function countBusinessInRow(state: MainStreetState): number {
  return state.market.cards.filter(
    c => c.family === 'business' || c.family === 'community-space',
  ).length;
}

// ── Relevance predicate ─────────────────────────────────────

describe('isMarketCardRelevant', () => {
  const foodBiz = createBusinessDeck(1, ['biz-bakery'])[0];
  const healthBiz = createBusinessDeck(1, ['biz-clinic'])[0];
  const cultureSpace = createCommunitySpaceDeck(1, ['cs-library'])[0];
  const foodEvent = createEventDeck(1, ['evt-food-tasting'], () => 0.5)[0];
  const cultureEvent = createEventDeck(1, ['evt-book-fair'], () => 0.5)[0];
  const allEvent = createEventDeck(1, ['evt-charity-drive'], () => 0.5)[0];
  const chef = createStaffDeck(1, ['staff-chef'])[0];
  const financialAdvisor = createStaffDeck(1, ['staff-financial'])[0];
  const upgrade = createUpgradeDeck(1)[0];

  it('matches business and community-space cards by shared synergy type', () => {
    expect(isMarketCardRelevant(foodBiz, ['Food'])).toBe(true);
    expect(isMarketCardRelevant(foodBiz, ['Health'])).toBe(false);
    expect(isMarketCardRelevant(cultureSpace, ['Culture'])).toBe(true);
    expect(isMarketCardRelevant(cultureSpace, ['Food'])).toBe(false);
    expect(isMarketCardRelevant(healthBiz, ['Food'])).toBe(false);
  });

  it('matches events by targetSynergy, treating All-events as universally relevant', () => {
    expect(isMarketCardRelevant(foodEvent, ['Food'])).toBe(true);
    expect(isMarketCardRelevant(foodEvent, ['Culture'])).toBe(false);
    expect(isMarketCardRelevant(cultureEvent, ['Food'])).toBe(false);
    expect(isMarketCardRelevant(allEvent, ['Food'])).toBe(true);
  });

  it('matches staff by allowedBusinessTypes overlap', () => {
    expect(isMarketCardRelevant(chef, ['Food'])).toBe(true);
    expect(isMarketCardRelevant(chef, ['Commerce'])).toBe(false);
    expect(isMarketCardRelevant(financialAdvisor, ['Food'])).toBe(false);
    expect(isMarketCardRelevant(financialAdvisor, ['Commerce'])).toBe(true);
  });

  it('never treats upgrades as relevant by synergy type', () => {
    expect(isMarketCardRelevant(upgrade, ['Food', 'Culture', 'Commerce', 'Service', 'Entertainment', 'Health'])).toBe(false);
  });

  it('treats an empty relevance key as nothing being relevant', () => {
    expect(isMarketCardRelevant(foodBiz, [])).toBe(false);
    expect(isMarketCardRelevant(allEvent, [])).toBe(false);
  });
});

// ── Employed-Investor detection ─────────────────────────────

describe('getEmployedInvestorReroll', () => {
  it('returns null when no Investor is employed', () => {
    const state = marketPhaseState('investor-none');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    expect(getEmployedInvestorReroll(state)).toBeNull();
  });

  it('reports the hosting business synergy types and the 75% bias', () => {
    const state = marketPhaseState('investor-employed');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const investor = employInvestorAt(state, 0);

    const descriptor = getEmployedInvestorReroll(state)!;
    expect(descriptor.card.id).toBe(investor.id);
    expect(descriptor.slotIndex).toBe(0);
    expect(descriptor.synergyTypes).toEqual(['Food']);
    expect(descriptor.bias).toBe(INVESTOR_DEFAULT_RELEVANCE_BIAS);
    expect(descriptor.bias).toBe(0.75);
  });

  it('ignores a hand-slot Investor (not employed at a business)', () => {
    const state = marketPhaseState('investor-hand');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    hireStaff(state, 'staff-investor'); // never placed
    expect(getEmployedInvestorReroll(state)).toBeNull();
  });
});

// ── Free re-roll behaviour ──────────────────────────────────

describe('free re-roll availability and cost', () => {
  it('is illegal without an employed Investor', () => {
    const state = marketPhaseState('free-no-investor');
    const legality = canUseFreeMarketReroll(state);
    expect(legality.legal).toBe(false);
    expect((legality as { reason?: string }).reason ?? '').toMatch(/No employed Investor/i);
    expect(() => useFreeMarketReroll(state)).toThrow(/No employed Investor/i);
  });

  it('is illegal outside MarketPhase', () => {
    const state = marketPhaseState('free-phase');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    employInvestorAt(state, 0);
    state.phase = 'IncomePhase';
    expect(canUseFreeMarketReroll(state).legal).toBe(false);
  });

  it('is coin-free and action-free, sets the flag and advances the escalation counter', () => {
    const state = marketPhaseState('free-exec');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    employInvestorAt(state, 0);
    state.resourceBank.coins = 1234;
    state.actionsRemaining = 2;

    const costBefore = refreshMarketCost(state);
    const result = useFreeMarketReroll(state);

    expect(result.cost).toBe(0);
    expect(state.resourceBank.coins).toBe(1234);
    expect(state.actionsRemaining).toBe(2);
    expect(state.investorFreeRerollUsedThisTurn).toBe(true);
    expect(state.marketRefreshesThisTurn).toBe(1);
    // The free re-roll advances the shared counter, so the next PAID re-roll
    // costs the escalated price (MS-0MTR6ZRF5007PWNZ).
    expect(refreshMarketCost(state)).toBe(costBefore + REFRESH_MARKET_COST_STEP);
    expect(state.market.cards).toHaveLength(MARKET_TOTAL_SLOTS);
    expect(countBusinessInRow(state)).toBeGreaterThanOrEqual(MARKET_BUSINESS_MIN);
  });

  it('allows only one free re-roll per turn; further re-rolls use the paid path', () => {
    const state = marketPhaseState('free-once');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    employInvestorAt(state, 0);
    state.resourceBank.coins = 100000;

    useFreeMarketReroll(state);
    expect(canUseFreeMarketReroll(state).legal).toBe(false);
    expect(() => useFreeMarketReroll(state)).toThrow(/already been used/i);

    // The normal paid path remains available and charges the escalated price.
    expect(canRefreshMarket(state).legal).toBe(true);
    const paid = refreshMarket(state);
    expect(paid.cost).toBe(REFRESH_MARKET_COST + REFRESH_MARKET_COST_STEP);
    expect(state.marketRefreshesThisTurn).toBe(2);
  });

  it('does not stack with multiple employed Investors', () => {
    const state = marketPhaseState('free-multi');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 1, 'Gym', ['Health']);
    employInvestorAt(state, 0);
    employInvestorAt(state, 1);

    // Only one Investor is reported (the gate is global, not per-card).
    expect(getEmployedInvestorReroll(state)).not.toBeNull();
    useFreeMarketReroll(state);
    expect(canUseFreeMarketReroll(state).legal).toBe(false);
    expect(state.marketRefreshesThisTurn).toBe(1);
  });

  it('resets the flag and escalation at WeekStart', () => {
    const state = marketPhaseState('free-reset');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    employInvestorAt(state, 0);
    useFreeMarketReroll(state);
    expect(state.investorFreeRerollUsedThisTurn).toBe(true);

    state.phase = 'WeekStart';
    executeWeekStart(state);

    expect(state.investorFreeRerollUsedThisTurn).toBe(false);
    expect(state.marketRefreshesThisTurn).toBe(0);
    // executeWeekStart leaves the game in MarketPhase with a fresh free re-roll.
    expect(canUseFreeMarketReroll(state).legal).toBe(true);
  });

  it('round-trips the flag through save/load (reloading mid-turn keeps availability)', () => {
    const state = marketPhaseState('free-save-load');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    employInvestorAt(state, 0);
    useFreeMarketReroll(state);

    const restored = deserializeMainStreetState(serializeMainStreetState(state));
    expect(restored.investorFreeRerollUsedThisTurn).toBe(true);
    restored.phase = 'MarketPhase';
    expect(canUseFreeMarketReroll(restored).legal).toBe(false);
  });

  it('backfills the flag to false for legacy saves', () => {
    const state = marketPhaseState('free-legacy');
    const saved = serializeMainStreetState(state) as unknown as Record<string, unknown>;
    delete saved.investorFreeRerollUsedThisTurn;

    const restored = deserializeMainStreetState(saved as never);
    expect(restored.investorFreeRerollUsedThisTurn).toBe(false);
  });
});

// ── Bias-aware draw ─────────────────────────────────────────

/** Replaces the drawable decks with exactly the given templates. */
function setDrawPools(
  state: MainStreetState,
  pools: {
    business?: BusinessCard[];
    communitySpace?: ReturnType<typeof createCommunitySpaceDeck>;
    event?: ReturnType<typeof createEventDeck>;
    staff?: StaffCard[];
    upgrade?: ReturnType<typeof createUpgradeDeck>;
  },
): void {
  state.decks.business = pools.business ?? [];
  state.decks.communitySpace = pools.communitySpace ?? [];
  state.decks.event = pools.event ?? [];
  state.decks.staff = pools.staff ?? [];
  state.decks.upgrade = pools.upgrade ?? [];
  state.discards = { business: [], communitySpace: [], event: [], upgrade: [], staff: [] };
  state.market.cards.length = 0;
}

describe('bias-aware refillSingleRowMarket', () => {
  it('with bias=1 draws the relevant business for the forced ≥1-business slot', () => {
    const state = setupMainStreetGame({ seed: 'bias-forced-biz' });
    setDrawPools(state, {
      business: [
        ...createBusinessDeck(1, ['biz-bakery']), // Food (relevant)
        ...createBusinessDeck(1, ['biz-hardware']), // Service (not relevant)
        ...createBusinessDeck(1, ['biz-clinic']), // Health (not relevant)
      ],
    });

    refillSingleRowMarket(state, { bias: 1, synergyTypes: ['Food'] });

    const first = state.market.cards[0] as BusinessCard;
    expect(first.family).toBe('business');
    expect(first.synergyTypes).toContain('Food');
    expect(state.market.cards).toHaveLength(MARKET_TOTAL_SLOTS);
    expect(countBusinessInRow(state)).toBeGreaterThanOrEqual(MARKET_BUSINESS_MIN);
  });

  it('with bias=1 fills the row entirely from the relevant pool when it suffices', () => {
    const state = setupMainStreetGame({ seed: 'bias-all-relevant' });
    state.week = 25; // evt-food-tasting window (20–36)
    setDrawPools(state, {
      business: [
        ...createBusinessDeck(1, ['biz-bakery']),
        ...createBusinessDeck(1, ['biz-hardware']),
      ],
      event: createEventDeck(1, ['evt-food-tasting'], () => 0.5),
      staff: createStaffDeck(1, ['staff-chef']),
    });

    refillSingleRowMarket(state, { bias: 1, synergyTypes: ['Food'] });

    expect(state.market.cards).toHaveLength(MARKET_TOTAL_SLOTS);
    for (const card of state.market.cards) {
      expect(isMarketCardRelevant(card, ['Food']), card.id).toBe(true);
    }
  });

  it('falls back to the random pool when no relevant card exists, preserving ≥1 business', () => {
    const state = setupMainStreetGame({ seed: 'bias-fallback' });
    setDrawPools(state, {
      business: [
        ...createBusinessDeck(1, ['biz-hardware']),
        ...createBusinessDeck(1, ['biz-clinic']),
      ],
    });

    refillSingleRowMarket(state, { bias: 1, synergyTypes: ['Food'] });

    expect(state.market.cards.length).toBeGreaterThan(0);
    expect(countBusinessInRow(state)).toBeGreaterThanOrEqual(MARKET_BUSINESS_MIN);
  });

  it('is deterministic for the same seed and relevance descriptor', () => {
    const run = (): string[] => {
      const state = setupMainStreetGame({ seed: 'bias-determinism' });
      state.market.cards.length = 0;
      refillSingleRowMarket(state, { bias: 0.75, synergyTypes: ['Food'] });
      return state.market.cards.map(c => c.id);
    };
    expect(run()).toEqual(run());
  });

  it('an inert bias (bias 0) is byte-identical to the fully random refill', () => {
    const make = (relevance?: { bias: number; synergyTypes: SynergyType[] }): string[] => {
      const state = setupMainStreetGame({ seed: 'bias-parity' });
      state.market.cards.length = 0;
      refillSingleRowMarket(state, relevance);
      return state.market.cards.map(c => c.id);
    };
    const random = make();
    const zeroBias = make({ bias: 0, synergyTypes: ['Food'] });
    const emptyKey = make({ bias: 1, synergyTypes: [] });
    expect(zeroBias).toEqual(random);
    expect(emptyKey).toEqual(random);
  });
});
