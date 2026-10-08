/**
 * Main Street: Upgrade-deck draw-weight tests (MS-0MUYK08I1004I19W).
 *
 * Covers the per-card `drawWeight` lever that makes the level-2 capstone
 * upgrade chains reachable:
 *   - CSV template → `UpgradeCard` plumbing (weights reach the deck);
 *   - cumulative-weight selection over a shuffled deck;
 *   - the refill-time eligibility bonus: an upgrade whose parent business is
 *     at the required level dominates the upgrade slot, while the same card
 *     without an eligible parent stays at its low base weight;
 *   - market-composition invariants and seeded determinism.
 *
 * The mechanism is deliberately refill-time only: it never resizes the
 * 78-card upgrade deck nor changes the `shuffleArray` Fisher–Yates call count,
 * so a seeded game keeps its deck composition.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, refillSingleRowMarket, type MainStreetState } from '../../src/MainStreetState';
import {
  createBusinessDeck,
  createUpgradeDeck,
  getUpgradeTemplates,
  MARKET_TOTAL_SLOTS,
  MARKET_BUSINESS_MIN,
  MARKET_UPGRADE_MAX,
  type BusinessCard,
  type UpgradeCard,
} from '../../src/MainStreetCards';

/** The four level-2 capstone upgrade templates whose reachability is lifted. */
const CAPSTONE_IDS = [
  'upg-grand-bakehouse',
  'upg-restaurant',
  'upg-multiplex',
  'upg-luxury-retreat',
] as const;

/** The four level-1 prerequisite upgrade templates weighted alongside them. */
const PREREQUISITE_IDS = [
  'upg-bread-factory',
  'upg-fast-food',
  'upg-imax',
  'upg-resort-spa',
] as const;

/** Builds a minimal but complete `UpgradeCard` fixture. */
function upgradeFixture(
  id: string,
  drawWeight: number | undefined,
  overrides: Partial<UpgradeCard> = {},
): UpgradeCard {
  return {
    family: 'upgrade',
    id,
    name: `Upgrade ${id}`,
    targetBusiness: 'Bakery',
    cost: 100,
    incomeBonus: 10,
    synergyRangeBonus: 0,
    description: 'draw-weight fixture',
    requiredLevel: 0,
    ...(drawWeight === undefined ? {} : { drawWeight }),
    ...overrides,
  };
}

/**
 * A state whose market already holds two business cards (so the ≥1-business
 * invariant is satisfied and the only remaining draw is the upgrade slot) and
 * whose decks hold exactly the supplied upgrade fixtures. When `streetLevel`
 * is set, a matching Bakery occupies street slot 0 at that level, so upgrade
 * fixtures targeting Bakery become eligible.
 */
function stateWithUpgradeDeck(
  upgrades: UpgradeCard[],
  seed: string,
  streetLevel?: number,
): MainStreetState {
  const state = setupMainStreetGame({ seed });
  const bakery = createBusinessDeck(1, ['biz-bakery'])[0];
  state.market.cards = [
    { ...bakery, id: 'biz-bakery-fixture-0' },
    { ...bakery, id: 'biz-bakery-fixture-1' },
  ];
  state.decks.business = [];
  state.decks.communitySpace = [];
  state.decks.event = [];
  state.decks.staff = [];
  state.decks.upgrade = upgrades;
  state.discards = { business: [], communitySpace: [], event: [], upgrade: [], staff: [] };
  if (streetLevel !== undefined) {
    const placed: BusinessCard = { ...bakery, id: 'biz-bakery-street', level: streetLevel };
    state.streetGrid[0] = placed;
  }
  return state;
}

/** Refills and returns the single upgrade card surfaced in the market. */
function drawnUpgradeId(state: MainStreetState): string {
  refillSingleRowMarket(state);
  const card = state.market.cards.find(c => c.family === 'upgrade');
  expect(card, 'expected the upgrade slot to be filled').toBeDefined();
  return card!.id;
}

describe('upgrade draw-weight plumbing', () => {
  it('carries a drawWeight from the CSV templates into the upgrade deck', () => {
    const templates = getUpgradeTemplates();
    const deck = createUpgradeDeck(2);

    for (const id of [...CAPSTONE_IDS, ...PREREQUISITE_IDS]) {
      const template = templates.find(t => t.id === id);
      expect(template, `${id} template missing`).toBeDefined();
      expect(template!.drawWeight, `${id} drawWeight`).toBeGreaterThanOrEqual(1);

      const deckCards = deck.filter(c => c.id.startsWith(`${id}-`));
      expect(deckCards.length).toBe(2);
      for (const card of deckCards) {
        expect(card.drawWeight).toBe(template!.drawWeight);
      }
    }
  });

  it('leaves the upgrade deck at its canonical size (weights never resize it)', () => {
    const templates = getUpgradeTemplates();
    expect(createUpgradeDeck(2)).toHaveLength(templates.length * 2);
  });
});

describe('weighted upgrade selection', () => {
  it('selects by cumulative weight, not deck position', () => {
    // Fixtures target a business that is not on the street, so the eligibility
    // bonus is inert and only the declared base weights matter. Deck
    // [base(1), heavy(9)]: total 10. A roll at 5.0 skips the base card
    // (5 - 1 = 4) and lands on the heavy card (4 - 9 < 0); a roll at 0.5 falls
    // inside the base card's band.
    const deck = [
      upgradeFixture('upg-a', 1, { targetBusiness: 'Nowhere' }),
      upgradeFixture('upg-b', 9, { targetBusiness: 'Nowhere' }),
    ];

    const pickAt = (roll: number): string => {
      const state = stateWithUpgradeDeck(deck.map(c => ({ ...c })), `weight-roll-${roll}`);
      let calls = 0;
      // First call is the (single-option) legal-slot pick; every later call is
      // the weighted selection roll.
      state.rng = () => (++calls === 1 ? 0 : roll);
      return drawnUpgradeId(state);
    };

    expect(pickAt(0.5)).toBe('upg-b');
    expect(pickAt(0.05)).toBe('upg-a');
  });

  it('excludes a zero-weight card unless it has an eligible target', () => {
    // Ineligible zero-weight card: effective weight 0, so the other card wins
    // for any roll.
    const deck = [
      upgradeFixture('upg-zero', 0, { targetBusiness: 'Nowhere' }),
      upgradeFixture('upg-one', 1, { targetBusiness: 'Nowhere' }),
    ];
    const state = stateWithUpgradeDeck(deck, 'weight-zero');
    let calls = 0;
    state.rng = () => (++calls === 1 ? 0 : 0);
    expect(drawnUpgradeId(state)).toBe('upg-one');
  });

  it('surfaces a heavily weighted upgrade far more often than baseline cards', () => {
    const deck = [
      upgradeFixture('upg-heavy', 20, { targetBusiness: 'Nowhere' }),
      upgradeFixture('upg-base-1', 1, { targetBusiness: 'Nowhere' }),
      upgradeFixture('upg-base-2', 1, { targetBusiness: 'Nowhere' }),
      upgradeFixture('upg-base-3', 1, { targetBusiness: 'Nowhere' }),
      upgradeFixture('upg-base-4', 1, { targetBusiness: 'Nowhere' }),
      upgradeFixture('upg-base-5', 1, { targetBusiness: 'Nowhere' }),
    ];

    const counts = new Map<string, number>();
    for (let i = 0; i < 240; i++) {
      const state = stateWithUpgradeDeck(deck.map(c => ({ ...c })), `weight-dist-${i}`);
      const id = drawnUpgradeId(state);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    const heavy = counts.get('upg-heavy') ?? 0;
    const baselines = ['upg-base-1', 'upg-base-2', 'upg-base-3', 'upg-base-4', 'upg-base-5'].map(
      id => counts.get(id) ?? 0,
    );
    // 20/25 expected share ≈ 192/240; assert a wide floor plus strict
    // dominance over every individual baseline.
    expect(heavy).toBeGreaterThanOrEqual(140);
    for (const n of baselines) expect(heavy).toBeGreaterThan(n);
  });
});

describe('refill-time eligibility bonus', () => {
  it('makes an upgrade with a parent at the required level dominate an unused one', () => {
    // [capstone(3), baseline(undeclared)]. With a Bakery at level 1 the
    // capstone weighs 33 (3 + bonus) vs the baseline's 1, so a high roll picks
    // it; with no eligible parent the capstone weighs only 3 and the same roll
    // picks the baseline instead.
    const deck = [
      upgradeFixture('upg-cap', 3, { requiredLevel: 1 }),
      upgradeFixture('upg-base', undefined),
    ];

    const pickAt = (roll: number, streetLevel?: number): string => {
      const state = stateWithUpgradeDeck(deck.map(c => ({ ...c })), `eligibility-${roll}-${streetLevel}`, streetLevel);
      let calls = 0;
      state.rng = () => (++calls === 1 ? 0 : roll);
      return drawnUpgradeId(state);
    };

    expect(pickAt(0.9, 1)).toBe('upg-cap');
    expect(pickAt(0.9)).toBe('upg-base');
  });

  it('lifts capstone visibility once the parent reaches level 1', () => {
    // Same deck and seeds, differing only in whether the parent is level 1.
    const deck = [
      upgradeFixture('upg-cap', 3, { requiredLevel: 1 }),
      ...Array.from({ length: 8 }, (_, i) => upgradeFixture(`upg-base-${i}`, 1)),
    ];

    const countCap = (streetLevel?: number): number => {
      let n = 0;
      for (let i = 0; i < 120; i++) {
        const state = stateWithUpgradeDeck(deck.map(c => ({ ...c })), `eligibility-vis-${streetLevel}-${i}`, streetLevel);
        if (drawnUpgradeId(state) === 'upg-cap') n++;
      }
      return n;
    };

    const eligible = countCap(1);
    const ineligible = countCap();
    // Eligible weight is 33/(33 + 8) ≈ 80%; ineligible is 3/(3 + 8) ≈ 27%.
    expect(eligible).toBeGreaterThan(ineligible);
    expect(eligible).toBeGreaterThanOrEqual(72); // conservative floor of ~60%
  });
});

describe('weighted refill invariants', () => {
  it('preserves the market composition invariants with the full weighted deck', () => {
    const state = setupMainStreetGame({ seed: 'weight-invariants' });
    state.market.cards.length = 0;
    // createUpgradeDeck now carries the CSV drawWeight values for the eight
    // chain templates; refill must still obey the row composition rules.
    state.decks.upgrade = createUpgradeDeck(2);

    for (let turn = 0; turn < 20; turn++) {
      state.market.cards.length = 0;
      refillSingleRowMarket(state);
      expect(state.market.cards.length).toBeLessThanOrEqual(MARKET_TOTAL_SLOTS);
      const businesses = state.market.cards.filter(
        c => c.family === 'business' || c.family === 'community-space',
      ).length;
      expect(businesses).toBeGreaterThanOrEqual(MARKET_BUSINESS_MIN);
      const upgrades = state.market.cards.filter(c => c.family === 'upgrade').length;
      expect(upgrades).toBeLessThanOrEqual(MARKET_UPGRADE_MAX);
    }
  });

  it('is deterministic for the same seed and weighted deck', () => {
    const run = (): string[] => {
      const state = setupMainStreetGame({ seed: 'weight-determinism' });
      state.market.cards.length = 0;
      state.decks.upgrade = createUpgradeDeck(2);
      refillSingleRowMarket(state);
      return state.market.cards.map(c => c.id);
    };
    expect(run()).toEqual(run());
  });
});
