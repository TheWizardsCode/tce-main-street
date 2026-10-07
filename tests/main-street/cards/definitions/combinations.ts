/**
 * Main Street: Card Test Framework — staff combination definitions.
 *
 * Beyond the single-card definitions, the framework runs up to three
 * cross-card combination checks for each staff card, selected by the staff
 * card's declared abilities:
 *
 * - **discount-stacking** — hiring every staff member that declares the same
 *   street-wide discount yields the summed discount (purchase / refresh).
 * - **per-business-scoping** — an `upgradeCostDiscount` staff member discounts
 *   only the business it is employed at, never the street.
 * - **upgrade-interaction** — an employed `upgradeCostDiscount` staff member
 *   reduces the charged upgrade cost while the upgrade still applies.
 *
 * @module
 */

import {
  REFRESH_MARKET_COST,
  createStaffDeck,
  createUpgradeDeck,
  staffMatchesBusiness,
  type StaffCard,
} from '../../../../src/MainStreetCards';
import { hireStaffCard, placeStaffOnBusiness } from '../../../../src/MainStreetEngine';
import { purchaseUpgrade, refreshMarketCost } from '../../../../src/MainStreetMarket';
import {
  computePurchaseCostDiscount,
  computeUpgradeCostDiscount,
} from '../../../../src/MainStreetStaffBuffs';
import type { MainStreetState } from '../../../../src/MainStreetState';
import type { StaffCombination } from '../CardTestTypes';
import {
  findPlacedTemplateByName,
  getAllPlacedTemplates,
  resolveCardTemplate,
} from '../helpers/cardFixture';
import { fundCoins, newGame, setMarket } from '../helpers/stateBuilders';

function check(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expectEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, observed ${String(actual)}.`);
  }
}

function comboState(seed: string): MainStreetState {
  const state = newGame(seed);
  fundCoins(state);
  state.activeChallenges = [];
  return state;
}

/** A fresh employment-candidate business matching the staff where possible. */
function employmentTarget(staff: StaffCard) {
  return (
    getAllPlacedTemplates().find(candidate => staffMatchesBusiness(staff, candidate)) ??
    getAllPlacedTemplates()[0]
  );
}

// ── discount-stacking ───────────────────────────────────────

function runPurchaseStacking(card: StaffCard): void {
  const state = comboState(`combo-purchase-${card.id}`);
  const providers = createStaffDeck(1).filter(s => (s.purchaseCostDiscount ?? 0) > 0);
  for (const provider of providers) {
    setMarket(state, [provider]);
    hireStaffCard(state, provider.id);
  }
  const sum = providers.reduce((total, s) => total + (s.purchaseCostDiscount ?? 0), 0);
  expectEqual(computePurchaseCostDiscount(state), sum, `${card.name} purchase discount sum`);
}

function runRefreshStacking(card: StaffCard): void {
  const state = comboState(`combo-refresh-${card.id}`);
  const providers = createStaffDeck(1).filter(s => (s.refreshCostDiscount ?? 0) > 0);
  for (const provider of providers) {
    setMarket(state, [provider]);
    hireStaffCard(state, provider.id);
  }
  const sum = providers.reduce((total, s) => total + (s.refreshCostDiscount ?? 0), 0);
  expectEqual(
    refreshMarketCost(state),
    Math.max(0, REFRESH_MARKET_COST - sum),
    `${card.name} refresh discount sum`,
  );
}

// ── per-business-scoping ────────────────────────────────────

function runUpgradeScoping(card: StaffCard): void {
  const state = comboState(`combo-scope-${card.id}`);
  const target = employmentTarget(card);
  check(target, 'No business available to employ the upgrade-discount staff member.');
  const other =
    getAllPlacedTemplates().find(candidate => candidate.name !== target.name) ?? target;
  state.streetGrid[0] = { ...target };
  state.streetGrid[1] = { ...other };

  const staff = resolveCardTemplate(card.id, 'staff') as StaffCard;
  setMarket(state, [staff]);
  hireStaffCard(state, staff.id);
  fundCoins(state);
  placeStaffOnBusiness(state, staff.id, 0);

  expectEqual(
    computeUpgradeCostDiscount(state, 0),
    card.upgradeCostDiscount ?? 0,
    `${card.name} discount at employing business`,
  );
  expectEqual(
    computeUpgradeCostDiscount(state, 1),
    0,
    `${card.name} discount must not leak to another business`,
  );
}

// ── upgrade-interaction ─────────────────────────────────────

function runUpgradeInteraction(card: StaffCard): void {
  const state = comboState(`combo-upgrade-${card.id}`);
  const upgrade = createUpgradeDeck(1).find(candidate => {
    const target = findPlacedTemplateByName(candidate.targetBusiness);
    return Boolean(target) && staffMatchesBusiness(card, target!);
  });
  check(upgrade, `No upgrade with a target business eligible for ${card.name}.`);
  const target = findPlacedTemplateByName(upgrade!.targetBusiness);
  check(target, `No target business '${upgrade!.targetBusiness}' for upgrade interaction test.`);

  state.streetGrid[0] = {
    ...target!,
    level: upgrade!.requiredLevel ?? 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    appliedUpgrades: [],
  };

  const staff = resolveCardTemplate(card.id, 'staff') as StaffCard;
  setMarket(state, [staff]);
  hireStaffCard(state, staff.id);
  fundCoins(state);
  placeStaffOnBusiness(state, staff.id, 0);

  setMarket(state, [upgrade!]);
  const coinsBefore = state.resourceBank.coins;
  purchaseUpgrade(state, upgrade!.id, 0);

  const expected = Math.max(0, upgrade!.cost - (card.upgradeCostDiscount ?? 0));
  expectEqual(
    coinsBefore - state.resourceBank.coins,
    expected,
    `${card.name} discounted upgrade cost`,
  );
  expectEqual(
    state.streetGrid[0]?.level,
    (upgrade!.requiredLevel ?? 0) + 1,
    `${card.name} upgrade still applied`,
  );
}

// ── Catalogue ───────────────────────────────────────────────

/** The combination scenarios, in priority order (max three per staff card). */
export const STAFF_COMBINATIONS: readonly StaffCombination[] = [
  {
    id: 'purchase-discount-stacking',
    title: 'discount stacking (street-wide purchase)',
    appliesTo: card => (card.purchaseCostDiscount ?? 0) > 0,
    run: runPurchaseStacking,
  },
  {
    id: 'refresh-discount-stacking',
    title: 'discount stacking (refresh cost)',
    appliesTo: card => (card.refreshCostDiscount ?? 0) > 0,
    run: runRefreshStacking,
  },
  {
    id: 'per-business-scoping',
    title: 'per-business vs street-wide scoping',
    appliesTo: card => (card.upgradeCostDiscount ?? 0) > 0,
    run: runUpgradeScoping,
  },
  {
    id: 'upgrade-interaction',
    title: 'synergy/upgrade interaction',
    appliesTo: card => (card.upgradeCostDiscount ?? 0) > 0,
    run: runUpgradeInteraction,
  },
];

/** Up to three applicable combinations for a staff card. */
export function combinationsFor(card: StaffCard): StaffCombination[] {
  return STAFF_COMBINATIONS.filter(combination => combination.appliesTo(card)).slice(0, 3);
}
