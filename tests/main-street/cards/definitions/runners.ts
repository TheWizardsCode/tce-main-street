/**
 * Main Street: Card Test Framework — per-family verification runners.
 *
 * Each runner drives a real engine state through the card's acquisition /
 * play path and asserts the resulting state matches the card's declared
 * fields in `card-data.csv`. All runners are synchronous and deterministic.
 *
 * The runners are deliberately shared by family: a card's *definition* is its
 * explicit registry entry (see `definitions/index.ts`), while the mechanics of
 * verifying its family live here. A new card therefore needs only a new
 * registry entry.
 *
 * @module
 */

import {
  REFRESH_MARKET_COST,
  isDurationEventCard,
  staffMatchesBusiness,
  type BusinessCard,
  type CommunitySpaceCard,
  type DurationEventCard,
  type EventCard,
  type StaffCard,
  type UpgradeCard,
} from '../../../../src/MainStreetCards';
import {
  hireStaffCard,
  endTurnHeadless,
  executeWeekStart,
  placeStaffOnBusiness,
  resolveEvent,
} from '../../../../src/MainStreetEngine';
import {
  playEventFromHand,
  purchaseBusiness,
  purchaseEvent,
  purchaseUpgrade,
  refreshMarketCost,
} from '../../../../src/MainStreetMarket';
import {
  TAX_AUDIT_BASE_RATE,
  computePurchaseCostDiscount,
  computeTaxAuditRate,
  computeUpgradeCostDiscount,
} from '../../../../src/MainStreetStaffBuffs';
import { hasPeekCapableStaff } from '../../../../src/MainStreetStaffSkills';
import type { MainStreetState } from '../../../../src/MainStreetState';
import type { CardTestContext } from '../CardTestTypes';
import {
  findPlacedTemplateByName,
  findPlacedTemplateBySynergy,
  getAllPlacedTemplates,
} from '../helpers/cardFixture';
import { clearIncidents, fundCoins, setMarket } from '../helpers/stateBuilders';

/** Throws with an actionable message when `condition` is falsy. */
function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** Formats an expected/observed pair for failure notes. */
function expectEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, observed ${String(actual)}.`);
  }
}

// ── Business / Community-space ──────────────────────────────

/**
 * Buys a business or community-space card from a controlled market, asserts
 * the placement/cost/income outcomes, then advances a real turn and asserts
 * the turn progressed.
 */
export function verifyPlaceableCard(context: CardTestContext): void {
  const card = context.card as BusinessCard | CommunitySpaceCard;
  const state = context.createState(`place-${card.id}`);
  fundCoins(state);
  setMarket(state, [card]);
  // Challenges are orthogonal to per-card behaviour and must not end the run
  // before the turn-progression assertion.
  state.activeChallenges = [];

  const coinsBefore = state.resourceBank.coins;
  purchaseBusiness(state, card.id, 0);

  const placed = state.streetGrid[0] as BusinessCard | CommunitySpaceCard | null;
  check(placed, `${card.name} was not placed on the street grid.`);
  expectEqual(placed.name, card.name, 'Placed card name');
  expectEqual(placed.id, card.id, 'Placed card id');

  const discount = computePurchaseCostDiscount(state);
  const effectiveCost = Math.max(0, card.cost - discount);
  expectEqual(
    coinsBefore - state.resourceBank.coins,
    effectiveCost,
    `${card.name} purchase cost`,
  );

  // With no neighbours the cached per-turn values equal the declared bases.
  expectEqual(placed.currentIncome, card.baseIncome, `${card.name} currentIncome`);
  expectEqual(
    placed.currentReputationPerTurn ?? 0,
    card.reputationPerTurn ?? 0,
    `${card.name} currentReputationPerTurn`,
  );

  // Real turn progression: executeWeekStart → endTurnHeadless advances the turn.
  clearIncidents(state);
  const turnBefore = state.turn;
  executeWeekStart(state);
  endTurnHeadless(state);
  check(
    state.turn > turnBefore,
    `${card.name} did not advance a turn (turn stayed ${turnBefore}).`,
  );
}

// ── Upgrade ─────────────────────────────────────────────────

/** Buys an upgrade from a controlled market onto its target business. */
export function verifyUpgradeCard(context: CardTestContext): void {
  const card = context.card as UpgradeCard;
  const target = findPlacedTemplateByName(card.targetBusiness);
  check(
    target,
    `No placeable business template named '${card.targetBusiness}' for upgrade ${card.id}.`,
  );

  const state = context.createState(`upg-${card.id}`);
  fundCoins(state);

  const business = {
    ...target,
    level: card.requiredLevel ?? 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    appliedUpgrades: [],
  } as BusinessCard | CommunitySpaceCard;
  state.streetGrid[0] = business;
  setMarket(state, [card]);

  const before = {
    level: business.level,
    incomeBonus: business.incomeBonus,
    reputationBonus: business.reputationBonus,
    displayName: business.displayName,
  };

  purchaseUpgrade(state, card.id, 0);

  expectEqual(business.level, before.level + 1, `${card.name} level`);
  expectEqual(
    business.incomeBonus,
    before.incomeBonus + card.incomeBonus,
    `${card.name} incomeBonus`,
  );
  expectEqual(
    business.reputationBonus,
    before.reputationBonus + (card.reputationBonus ?? 0),
    `${card.name} reputationBonus`,
  );
  check(
    (business.appliedUpgrades ?? []).includes(card.id),
    `${card.name} was not recorded in appliedUpgrades.`,
  );
  if (card.newDisplayName) {
    expectEqual(business.displayName, card.newDisplayName, `${card.name} displayName`);
  }
}

// ── Staff ───────────────────────────────────────────────────

/** Hires a staff card from a controlled market and asserts its declared abilities. */
export function verifyStaffCard(context: CardTestContext): void {
  const card = context.card as StaffCard;
  const state = context.createState(`staff-${card.id}`);
  fundCoins(state);

  const staff = { ...card };
  setMarket(state, [staff]);
  const coinsBefore = state.resourceBank.coins;
  const handBefore = state.maxHandSize;

  hireStaffCard(state, card.id);

  const hired = state.staffCards.find(member => member.id === card.id);
  check(hired, `${card.name} was not added to staffCards.`);
  expectEqual(coinsBefore - state.resourceBank.coins, card.cost, `${card.name} hire cost`);
  expectEqual(
    state.maxHandSize,
    handBefore + card.handSlotsAdded,
    `${card.name} hand slots added`,
  );

  if (card.purchaseCostDiscount != null) {
    expectEqual(
      computePurchaseCostDiscount(state),
      card.purchaseCostDiscount,
      `${card.name} purchaseCostDiscount`,
    );
  }

  if (card.refreshCostDiscount != null) {
    const expected = Math.max(0, REFRESH_MARKET_COST - card.refreshCostDiscount);
    expectEqual(refreshMarketCost(state), expected, `${card.name} refreshCostDiscount`);
  }

  if (card.taxAuditRate != null) {
    expectEqual(
      computeTaxAuditRate(state.staffCards, TAX_AUDIT_BASE_RATE),
      card.taxAuditRate,
      `${card.name} taxAuditRate`,
    );
  }

  if (card.actionsPerTurn != null) {
    executeWeekStart(state);
    expectEqual(
      state.actionsRemaining,
      1 + card.actionsPerTurn,
      `${card.name} actionsPerTurn`,
    );
  }

  if (card.upgradeCostDiscount != null) {
    const eligible =
      getAllPlacedTemplates().find(candidate => staffMatchesBusiness(staff, candidate)) ??
      getAllPlacedTemplates()[0];
    check(eligible, 'No business template available to employ the staff member.');
    state.streetGrid[1] = { ...eligible } as BusinessCard | CommunitySpaceCard;
    placeStaffOnBusiness(state, card.id, 1);
    expectEqual(
      computeUpgradeCostDiscount(state, 1),
      card.upgradeCostDiscount,
      `${card.name} upgradeCostDiscount`,
    );
  }

  if (card.peekOncePerTurn) {
    check(hasPeekCapableStaff(state), `${card.name} did not register as peek-capable.`);
  }
}

// ── Event ───────────────────────────────────────────────────

/** Places businesses so a targeted event has a non-empty population. */
function installEventTargets(state: MainStreetState, card: EventCard): number {
  if (card.target === 'SpecificSynergy' && card.targetSynergy) {
    const match = findPlacedTemplateBySynergy(card.targetSynergy);
    if (match) {
      state.streetGrid[0] = { ...match } as BusinessCard | CommunitySpaceCard;
      return 1;
    }
    return 0;
  }
  if (card.target === 'RandomBusiness') {
    const any = getAllPlacedTemplates()[0];
    if (any) {
      state.streetGrid[0] = { ...any } as BusinessCard | CommunitySpaceCard;
      return 1;
    }
    return 0;
  }
  return 0;
}

/**
 * Asserts the coin/reputation outcome of resolving `card` given the balance
 * immediately before resolution and the cost charged at play time.
 */
function assertEventOutcome(
  card: EventCard,
  coinsBefore: number,
  coinsAfter: number,
  repBefore: number,
  repAfter: number,
  cost: number,
  matchCount: number,
): void {
  const repDelta = repAfter - repBefore;
  expectEqual(repDelta, card.reputationDelta, `${card.name} reputation delta`);

  let expectedRaw: number;
  if (card.coinPercentDelta !== undefined) {
    const balanceAfterCost = coinsBefore - cost;
    const rate = Math.abs(card.coinPercentDelta);
    expectedRaw = -Math.min(balanceAfterCost, Math.round(balanceAfterCost * rate));
  } else if (card.target === 'SpecificSynergy') {
    expectedRaw = card.coinDelta * matchCount;
  } else {
    expectedRaw = card.coinDelta;
  }

  const observed = coinsAfter - coinsBefore;
  if (expectedRaw > 0) {
    // Positive gains are scaled by the reputation coin multiplier (>= 1).
    check(
      observed >= expectedRaw - cost,
      `${card.name} coin delta: expected at least ${expectedRaw - cost}, observed ${observed}.`,
    );
  } else {
    expectEqual(observed, expectedRaw - cost, `${card.name} coin delta`);
  }
}

/**
 * Resolves an event card and asserts its declared effect. Investment events
 * are acquired and played through the real market path; incidents are
 * resolved through the engine's incident resolution API.
 */
export function verifyEventCard(context: CardTestContext): void {
  const card = context.card as EventCard;
  const state = context.createState(`evt-${card.id}`);
  fundCoins(state);
  state.resourceBank.reputation = 1000;

  if (isDurationEventCard(card)) {
    const durationCard = card as DurationEventCard;
    const before = state.activeEffects.length;
    resolveEvent(state, card);
    expectEqual(
      state.activeEffects.length,
      before + 1,
      `${card.name} active effect count`,
    );
    const effect = state.activeEffects[state.activeEffects.length - 1];
    expectEqual(effect.sourceEventId, card.id, `${card.name} active effect source`);
    expectEqual(effect.multiplier, durationCard.multiplier, `${card.name} multiplier`);
    check(effect.turnsRemaining > 0, `${card.name} duration must be positive.`);
    return;
  }

  const matchCount = installEventTargets(state, card);

  if (card.trigger === 'Investment') {
    setMarket(state, [card]);
    purchaseEvent(state, card.id);
    const handIndex = state.hand.findIndex(c => c.id === card.id);
    check(handIndex >= 0, `${card.name} was not moved to hand.`);
    // Grand Opening requires a placement this turn; arm it for the play path.
    (state as unknown as { businessPlacedThisTurn?: boolean }).businessPlacedThisTurn = true;
    // Playing from hand is a MarketPhase action; the setup state starts in
    // WeekStart, so enter the play phase explicitly.
    state.phase = 'MarketPhase';

    const coinsBefore = state.resourceBank.coins;
    const repBefore = state.resourceBank.reputation;
    playEventFromHand(state, handIndex);

    check(
      !state.hand.some(c => c.id === card.id),
      `${card.name} was not removed from hand after play.`,
    );
    assertEventOutcome(
      card,
      coinsBefore,
      state.resourceBank.coins,
      repBefore,
      state.resourceBank.reputation,
      card.cost,
      matchCount,
    );
    return;
  }

  const coinsBefore = state.resourceBank.coins;
  const repBefore = state.resourceBank.reputation;
  resolveEvent(state, card);
  assertEventOutcome(
    card,
    coinsBefore,
    state.resourceBank.coins,
    repBefore,
    state.resourceBank.reputation,
    0,
    matchCount,
  );
}
