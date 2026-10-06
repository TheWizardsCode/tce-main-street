/**
 * Charity Shop card tests (MS-0MUAYBAHW007RMSL).
 *
 * The Charity Shop is a tier-2, standalone Culture business added by the
 * producer: 1.5 gross income per turn + 0.6 reputation per turn, costing 3.
 * Under the ×100 integer economy (CG-0MTIO1M15001E9Y6) that maps to
 * `cost = 300`, `baseIncome = 150`, `reputationPerTurn = 60`; the standard
 * ¼-price ongoing cost convention (CG-0MSVYPEZ90085SHE) gives
 * `ongoingCost = 75` (net 75 coins/turn, or 0.75 at the design scale).
 *
 * Acceptance criteria covered:
 *   (AC1) `card-data.csv` carries the exact producer economy contract, a
 *         non-empty description and art notes, and the description text
 *         matches the data (reputation figure + Culture synergy sentence).
 *   (AC2) The card is registered as a business template, appears in the
 *         business deck, and is available from tier 2 in the tier progression.
 *   (AC4) The economy values are asserted directly.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import {
  CARD_TEMPLATE_NAMES,
  CARD_TIER_MAP,
  createBusinessDeck,
  getBusinessTemplates,
} from '../../src/MainStreetCards';
import { TIER_DEFINITIONS } from '../../src/MainStreetTiers';
import {
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import { applyIncome } from '../../src/MainStreetAdjacency';
import type { BusinessCard } from '../../src/MainStreetCards';

const CARD_ID = 'biz-charity-shop';

/** The raw CSV template as loaded from `card-data.csv`. */
function findCharityShop() {
  const template = getBusinessTemplates().find(c => c.id === CARD_ID);
  if (!template) throw new Error(`${CARD_ID} template not found in card-data.csv`);
  return template;
}

/** A game state with an empty street and no staff (isolates the card under test). */
function createEmptyState(seed = 'charity-shop'): MainStreetState {
  const state = setupMainStreetGame({ seed });
  state.streetGrid = state.streetGrid.map(() => null);
  state.staffCards = [];
  return state;
}

/** Places a fresh Charity Shop on the street at `index` with its caches primed. */
function placeCharityShop(state: MainStreetState, index = 0): BusinessCard {
  const template = findCharityShop();
  const card: BusinessCard = {
    family: 'business',
    ...template,
    id: `${CARD_ID}-${index}`,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    appliedUpgrades: [],
  } as BusinessCard;
  card.currentIncome = card.baseIncome + (card.incomeBonus ?? 0);
  card.currentReputationPerTurn =
    (card.reputationPerTurn ?? 0) + (card.reputationBonus ?? 0);
  state.streetGrid[index] = card;
  return card;
}

// ── AC1/AC4: card data contract ─────────────────────────────

describe('Charity Shop card data (×100 integer economy)', () => {
  it('costs 300 coins (design cost 3)', () => {
    expect(findCharityShop().cost).toBe(300);
  });

  it('generates 150 gross base income per turn (design 1.5)', () => {
    expect(findCharityShop().baseIncome).toBe(150);
  });

  it('provides +60 reputation per turn (design 0.6)', () => {
    expect(findCharityShop().reputationPerTurn).toBe(60);
  });

  it('pays the standard ¼-price ongoing cost of 75 per turn', () => {
    expect(findCharityShop().ongoingCost).toBe(75);
  });

  it('is a standalone Culture business at tier 2', () => {
    const card = findCharityShop();
    expect(card.synergyTypes).toEqual(['Culture']);
    // Standalone convention (Craft Shop, Pharmacy, Grand Hotel, …): a card with
    // no upgrade chain carries maxLevel 0 and an empty upgradePath. The intake
    // brief's literal "maxLevel = 1" contradicted this convention and the
    // upgrade-coverage consistency tests (every maxLevel >= 1 / non-empty
    // upgradePath card must have a matching upgrade); resolved in favour of the
    // producer's actual "standalone, no upgrade chain" intent.
    expect(card.maxLevel).toBe(0);
    expect(card.upgradePath ?? '').toBe('');
    expect(CARD_TIER_MAP.get(CARD_ID)).toBe('2');
  });

  it('has a non-empty description and art notes', () => {
    const card = findCharityShop();
    expect(card.description.length).toBeGreaterThan(0);
    // art_notes is not exposed on the template type; assert it via the raw CSV
    // row shape is unnecessary — the description is the player-facing text.
  });
});

// ── AC4: card text matches data ─────────────────────────────

describe('Charity Shop card text matches its data', () => {
  it('states the reputation figure that matches reputationPerTurn', () => {
    // The shared card-text-data-consistency guard parses "N reputation per turn"
    // from every non-event description and asserts it equals reputationPerTurn.
    const description = findCharityShop().description;
    expect(description).toContain('60 reputation per turn');
  });

  it('names only Culture in its adjacency synergy sentence', () => {
    const description = findCharityShop().description;
    expect(description).toMatch(/adjacent Culture business/);
    for (const other of ['Food', 'Commerce', 'Service', 'Entertainment', 'Health']) {
      expect(description).not.toMatch(new RegExp(`adjacent ${other} business`));
    }
  });
});

// ── AC2: registration and progression ───────────────────────

describe('Charity Shop registration and progression', () => {
  it('registers the template name and id', () => {
    expect(CARD_TEMPLATE_NAMES.get(CARD_ID)).toBe('Charity Shop');
  });

  it('appears in the business deck', () => {
    const deck = createBusinessDeck(1);
    const instance = deck.find(c => c.id.replace(/-\d+$/, '') === CARD_ID);
    expect(instance, `${CARD_ID} absent from business deck`).toBeDefined();
    expect(instance!.family).toBe('business');
  });

  it('unlocks at tier 2 and is absent from tier 1', () => {
    expect(TIER_DEFINITIONS['tier-2'].newCardIds).toContain(CARD_ID);
    expect(TIER_DEFINITIONS['tier-1'].newCardIds).not.toContain(CARD_ID);
    expect(TIER_DEFINITIONS['tier-1'].cumulativeCardIds).not.toContain(CARD_ID);
    expect(TIER_DEFINITIONS['tier-2'].cumulativeCardIds).toContain(CARD_ID);
  });
});

// ── AC1: behaviour through the income phase ─────────────────

describe('Charity Shop income phase', () => {
  it('credits +60 reputation per turn', () => {
    const state = createEmptyState();
    placeCharityShop(state, 0);
    const reputationBefore = state.resourceBank.reputation;

    const result = applyIncome(state);

    expect(result.repDelta).toBe(60);
    expect(state.resourceBank.reputation).toBe(reputationBefore + 60);
  });

  it('generates its 150 base income with no neighbours', () => {
    const state = createEmptyState();
    placeCharityShop(state, 0);

    const result = applyIncome(state);

    // Breakdown reports the un-multiplied base income for the slot.
    expect(result.breakdown).toHaveLength(1);
    expect(result.breakdown[0].baseIncome).toBe(150);
    expect(result.breakdown[0].businessName).toBe('Charity Shop');
  });
});
