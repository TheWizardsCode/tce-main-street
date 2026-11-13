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
  SYNERGY_TYPE_NAMES,
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
  computeAdjacentPurchaseDiscount,
  computeBusinessIncidentMitigation,
  computeBusinessOngoingCostReductionPct,
  computeBusinessStaffBuffs,
  computePurchaseCostDiscount,
  computeTaxAuditRate,
  computeUpgradeCostDiscount,
} from '../../../../src/MainStreetStaffBuffs';
import { hasPeekCapableStaff } from '../../../../src/MainStreetStaffSkills';
import { getEmployedInvestorReroll } from '../../../../src/MainStreetMarketRefill';
import { applyIncome } from '../../../../src/MainStreetAdjacency';
import { resolveNeighbors } from '../../../../src/MainStreetAdjacencyGeometry';
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

/** Asserts two numbers agree within a small tolerance (fractions). */
function expectClose(actual: number, expected: number, label: string): void {
  if (typeof actual !== 'number' || Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${label}: expected ${String(expected)}, observed ${String(actual)}.`);
  }
}

/**
 * True when a staff card declares any per-business effect that must be
 * exercised by placing it on a business (GDD D.4.3). Management-company-only
 * cards (hand slots / actions / refresh / tax / peek) return false.
 */
function hasPerBusinessEffect(card: StaffCard): boolean {
  return (
    card.incomeBonus != null ||
    card.incomePercent != null ||
    card.reputationBonus != null ||
    card.reputationPercent != null ||
    card.synergyRangeBonus != null ||
    card.adjacencyPurchaseDiscount != null ||
    card.ongoingCostReduction != null ||
    card.incidentEffect != null ||
    card.upgradeCostDiscount != null ||
    card.freeMarketRerollPerTurn != null ||
    card.marketRelevanceBias != null
  );
}

/** A synthetic business fixture used for neighbour-bound assertion checks. */
function makeBusinessFixture(
  overrides: Partial<BusinessCard> = {},
): BusinessCard {
  return {
    family: 'business',
    id: overrides.id ?? 'staff-verifier-fixture',
    name: overrides.name ?? 'Verifier Fixture',
    cost: overrides.cost ?? 300,
    baseIncome: overrides.baseIncome ?? 4,
    synergyTypes: overrides.synergyTypes ?? ['Food'],
    maxLevel: overrides.maxLevel ?? 1,
    description: overrides.description ?? 'Staff verifier fixture.',
    level: overrides.level ?? 0,
    incomeBonus: overrides.incomeBonus ?? 0,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    reputationBonus: overrides.reputationBonus ?? 0,
    ongoingCost: overrides.ongoingCost ?? 0,
    employedStaff: overrides.employedStaff ?? [],
  } as BusinessCard;
}

/**
 * Picks a grid slot with a free 8-way neighbour for the employer and a
 * second slot for the neighbour fixture.
 */
function pickEmployerAndNeighbour(state: MainStreetState): { employer: number; neighbour: number } {
  const dims = { cols: state.streetGridCols, rows: state.streetGridRows };
  for (let slot = 0; slot < state.streetGrid.length; slot++) {
    const neighbour = resolveNeighbors(slot, 1, dims).find(index => !state.streetGrid[index]);
    if (neighbour !== undefined) return { employer: slot, neighbour };
  }
  throw new Error('No free adjacent slot pair available for staff buff verification.');
}

/**
 * Builds the neighbour business fixture so it matches the card's
 * `incomeBonusTypes` filter (a synergy type is preferred over a business name).
 */
function neighbourFixtureFor(card: StaffCard): BusinessCard {
  const types = card.incomeBonusTypes ?? [];
  const synergy = types.find(token =>
    (SYNERGY_TYPE_NAMES as readonly string[]).includes(token),
  ) as BusinessCard['synergyTypes'][number] | undefined;
  return makeBusinessFixture({
    id: 'staff-verifier-neighbour',
    name: types[0] ?? 'Verifier Neighbour',
    synergyTypes: synergy ? [synergy] : ['Food'],
  });
}

/**
 * Reads the mitigation value for one incident dimension from a bundle.
 */
function incidentMagnitude(
  bundle: ReturnType<typeof computeBusinessIncidentMitigation>,
  kind: 'coin' | 'reputation' | 'frequency',
): number {
  if (kind === 'coin') return bundle.coinDamageReductionPct;
  if (kind === 'reputation') return bundle.reputationDamageReductionFlat;
  return bundle.frequencyReductionPct;
}

/**
 * The typed effect field names a raw `card-data.csv` row declares. A field
 * present here must be carried by the parsed template (and asserted) for the
 * card to earn `unitTestStatus = pass` — the honesty guard (AC4).
 */
function declaredEffectFields(row: Record<string, string>): string[] {
  const fields: string[] = [];
  const effect = row.effect ?? '';
  if (effect) {
    const kind = effect.split(':')[0];
    if (kind === 'income') fields.push(effect.includes(':percent:') ? 'incomePercent' : 'incomeBonus');
    else if (kind === 'reputation') fields.push(effect.includes(':percent:') ? 'reputationPercent' : 'reputationBonus');
    else if (kind === 'synergy-range') fields.push('synergyRangeBonus');
    else if (kind === 'purchase-discount') fields.push('adjacencyPurchaseDiscount');
    else if (kind === 'ongoing-cost') fields.push('ongoingCostReduction');
    else if (kind.startsWith('incident-')) fields.push('incidentEffect');
    else fields.push(`effect:${kind}`);
  }
  if (row.reputationPerTurn) fields.push('reputationPerTurn');
  if (row.freeMarketRerollPerTurn) fields.push('freeMarketRerollPerTurn');
  if (row.marketRelevanceBias) fields.push('marketRelevanceBias');
  if (row.upgradeCostDiscount) fields.push('upgradeCostDiscount');
  if (row.purchaseCostDiscount) fields.push('purchaseCostDiscount');
  // Dedicated management-company columns (GDD D.4.4). Every one of these must
  // be carried by the parsed template AND asserted, so a parser that silently
  // drops e.g. `actionsPerTurn` cannot leave the card reporting `pass`.
  if (row.handSlotsAdded) fields.push('handSlotsAdded');
  if (row.actionsPerTurn) fields.push('actionsPerTurn');
  if (row.refreshCostDiscount) fields.push('refreshCostDiscount');
  if (row.taxAuditRate) fields.push('taxAuditRate');
  if (row.peekOncePerTurn) fields.push('peekOncePerTurn');
  return fields;
}

/**
 * Compares each dedicated numeric column the raw row declares with the value
 * the parsed template carries. The presence guard above cannot catch a field
 * that is asserted from the *parsed* value itself (hand slots), or a field the
 * parser maps to the wrong number; this value guard closes both gaps (AC4).
 */
function assertDedicatedColumnValues(card: StaffCard, row: Record<string, string>): void {
  const columns: ReadonlyArray<[string, number | boolean | undefined]> = [
    ['handSlotsAdded', card.handSlotsAdded],
    ['actionsPerTurn', card.actionsPerTurn],
    ['refreshCostDiscount', card.refreshCostDiscount],
    ['taxAuditRate', card.taxAuditRate],
    ['peekOncePerTurn', card.peekOncePerTurn],
    ['reputationPerTurn', card.reputationPerTurn],
    ['upgradeCostDiscount', card.upgradeCostDiscount],
    ['purchaseCostDiscount', card.purchaseCostDiscount],
    ['freeMarketRerollPerTurn', card.freeMarketRerollPerTurn],
    ['marketRelevanceBias', card.marketRelevanceBias],
  ];
  for (const [column, parsed] of columns) {
    const raw = row[column];
    if (raw == null || raw === '') continue;
    const expected = Number(raw);
    const actual = typeof parsed === 'boolean' ? Number(parsed) : parsed;
    check(
      actual != null && Math.abs(actual - expected) <= 1e-9,
      `${card.name}: card-data.csv declares ${column}=${raw} but the parsed template carries ${String(parsed)}.`,
    );
  }
}

/**
 * Hires a staff card from a controlled market and asserts its declared
 * abilities, including the per-business effects (placed on a real business and
 * read back through the buff functions) and the honesty guard that a declared
 * effect which the template does not carry cannot report `pass`.
 */
export function verifyStaffCard(context: CardTestContext): void {
  const card = context.card as StaffCard;
  const state = context.createState(`staff-${card.id}`);
  fundCoins(state);

  const staff = { ...card };
  setMarket(state, [staff]);
  const coinsBefore = state.resourceBank.coins;
  const handBefore = state.maxHandSize;
  const asserted = new Set<string>();

  hireStaffCard(state, card.id);

  const hired = state.staffCards.find(member => member.id === card.id);
  check(hired, `${card.name} was not added to staffCards.`);
  expectEqual(coinsBefore - state.resourceBank.coins, card.cost, `${card.name} hire cost`);
  expectEqual(
    state.maxHandSize,
    handBefore + card.handSlotsAdded,
    `${card.name} hand slots added`,
  );
  asserted.add('handSlotsAdded');

  if (card.purchaseCostDiscount != null) {
    expectEqual(
      computePurchaseCostDiscount(state),
      card.purchaseCostDiscount,
      `${card.name} purchaseCostDiscount`,
    );
    asserted.add('purchaseCostDiscount');
  }

  if (card.refreshCostDiscount != null) {
    const expected = Math.max(0, REFRESH_MARKET_COST - card.refreshCostDiscount);
    expectEqual(refreshMarketCost(state), expected, `${card.name} refreshCostDiscount`);
    asserted.add('refreshCostDiscount');
  }

  if (card.taxAuditRate != null) {
    expectEqual(
      computeTaxAuditRate(state.staffCards, TAX_AUDIT_BASE_RATE),
      card.taxAuditRate,
      `${card.name} taxAuditRate`,
    );
    asserted.add('taxAuditRate');
  }

  if (card.actionsPerTurn != null) {
    executeWeekStart(state);
    expectEqual(
      state.actionsRemaining,
      1 + card.actionsPerTurn,
      `${card.name} actionsPerTurn`,
    );
    asserted.add('actionsPerTurn');
  }

  if (card.reputationPerTurn != null) {
    // Management-company per-turn reputation (the Socialite) accrues during
    // the income phase; with no businesses placed the delta is exactly it.
    const repBefore = state.resourceBank.reputation;
    applyIncome(state);
    expectEqual(
      state.resourceBank.reputation - repBefore,
      card.reputationPerTurn,
      `${card.name} reputationPerTurn`,
    );
    asserted.add('reputationPerTurn');
  }

  if (card.peekOncePerTurn) {
    check(hasPeekCapableStaff(state), `${card.name} did not register as peek-capable.`);
    asserted.add('peekOncePerTurn');
  }

  if (hasPerBusinessEffect(card)) {
    const { employer, neighbour } = pickEmployerAndNeighbour(state);
    const eligible =
      getAllPlacedTemplates().find(candidate => staffMatchesBusiness(staff, candidate)) ??
      getAllPlacedTemplates()[0];
    check(eligible, 'No business template available to employ the staff member.');
    state.streetGrid[employer] = { ...eligible, employedStaff: [] } as BusinessCard | CommunitySpaceCard;
    placeStaffOnBusiness(state, card.id, employer);
    // A matching neighbour lets the adjacency-scoped effects be observed.
    state.streetGrid[neighbour] = neighbourFixtureFor(card);

    const buffs = computeBusinessStaffBuffs(state, employer);

    if (card.incomeBonus != null && (card.incomeBonusTarget ?? 'own') === 'own') {
      expectEqual(buffs.incomeFlat, card.incomeBonus, `${card.name} incomeBonus (own)`);
      asserted.add('incomeBonus');
    }
    if (card.incomePercent != null) {
      expectClose(buffs.incomePercent, card.incomePercent, `${card.name} incomePercent`);
      asserted.add('incomePercent');
    }
    if (card.reputationBonus != null && (card.reputationBonusTarget ?? 'own') === 'own') {
      expectEqual(buffs.reputationFlat, card.reputationBonus, `${card.name} reputationBonus (own)`);
      asserted.add('reputationBonus');
    }
    if (card.reputationPercent != null) {
      expectClose(buffs.reputationPercent, card.reputationPercent, `${card.name} reputationPercent`);
      asserted.add('reputationPercent');
    }
    if (card.synergyRangeBonus != null) {
      expectEqual(buffs.synergyRangeBonus, card.synergyRangeBonus, `${card.name} synergyRangeBonus`);
      asserted.add('synergyRangeBonus');
    }
    if (card.ongoingCostReduction != null) {
      expectClose(
        computeBusinessOngoingCostReductionPct(state, employer),
        card.ongoingCostReduction,
        `${card.name} ongoingCostReduction`,
      );
      asserted.add('ongoingCostReduction');
    }
    if (card.upgradeCostDiscount != null) {
      expectEqual(
        computeUpgradeCostDiscount(state, employer),
        card.upgradeCostDiscount,
        `${card.name} upgradeCostDiscount`,
      );
      asserted.add('upgradeCostDiscount');
    }

    if (card.incidentEffect) {
      const { kind, amount, target } = card.incidentEffect;
      const atEmployer = incidentMagnitude(computeBusinessIncidentMitigation(state, employer), kind);
      expectClose(atEmployer, amount, `${card.name} incidentEffect (${kind})`);
      if (target === 'own') {
        // Own-business scope: the neighbour must not be protected.
        const atNeighbour = incidentMagnitude(
          computeBusinessIncidentMitigation(state, neighbour),
          kind,
        );
        expectEqual(atNeighbour, 0, `${card.name} incidentEffect leaked to neighbour`);
      } else {
        const atNeighbour = incidentMagnitude(
          computeBusinessIncidentMitigation(state, neighbour),
          kind,
        );
        expectClose(atNeighbour, amount, `${card.name} incidentEffect (cluster) at neighbour`);
      }
      asserted.add('incidentEffect');
    }

    // Adjacent-targeted income / reputation land on the neighbour.
    if (card.incomeBonus != null && card.incomeBonusTarget === 'adjacent') {
      expectEqual(
        computeBusinessStaffBuffs(state, neighbour).incomeFlat,
        card.incomeBonus,
        `${card.name} incomeBonus (adjacent)`,
      );
      asserted.add('incomeBonus');
    }
    if (card.reputationBonus != null && card.reputationBonusTarget === 'adjacent') {
      expectEqual(
        computeBusinessStaffBuffs(state, neighbour).reputationFlat,
        card.reputationBonus,
        `${card.name} reputationBonus (adjacent)`,
      );
      asserted.add('reputationBonus');
    }
    if (card.adjacencyPurchaseDiscount != null) {
      expectEqual(
        computeAdjacentPurchaseDiscount(state, neighbour),
        card.adjacencyPurchaseDiscount,
        `${card.name} adjacencyPurchaseDiscount`,
      );
      asserted.add('adjacencyPurchaseDiscount');
    }

    if (card.freeMarketRerollPerTurn != null || card.marketRelevanceBias != null) {
      const reroll = getEmployedInvestorReroll(state);
      check(reroll, `${card.name} did not register an employed free market re-roll.`);
      expectEqual(reroll!.card.freeMarketRerollPerTurn, true, `${card.name} freeMarketRerollPerTurn`);
      if (card.marketRelevanceBias != null) {
        expectClose(reroll!.bias, card.marketRelevanceBias, `${card.name} marketRelevanceBias`);
      }
      asserted.add('freeMarketRerollPerTurn');
      if (card.marketRelevanceBias != null) asserted.add('marketRelevanceBias');
    }
  }

  // Honesty guard (AC4): a raw row that declares an effect the template does
  // not carry (a parser gap) must not report `pass`.
  for (const field of declaredEffectFields(context.row.row)) {
    check(
      asserted.has(field),
      `${card.name}: declared effect '${field}' from card-data.csv was not parsed/asserted (unitTestStatus cannot pass vacuously).`,
    );
  }
  assertDedicatedColumnValues(card, context.row.row);
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
