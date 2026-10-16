/**
 * Main Street: Sell, Close, and Refunds
 *
 * Refund computation, sale legality/execution, and full close (demolition).
 *
 * Import graph: depends on `MainStreetMarketTypes`.
 *
 * @module
 */

import type { LegalityResult } from '@rule-engine';
import type { MainStreetState } from './MainStreetState';
import { addLog, describeEventEffects, classifyEffect } from './MainStreetState';
import type { BusinessCard, CommunitySpaceCard } from './MainStreetCards';
import { updateNeighborsOnSale, updateNeighborsOnClose, hasAdjacentSameType } from './MainStreetAdjacency';
import { canActiveSeatActOnSlot } from './MainStreetAdjacencyOwner';
import { roundInt } from './MainStreetDifficulty';
import {
  computePerBusinessSkillBuffs,
  getEmployedSpecializationSkillsForBusiness,
} from './MainStreetStaffBuffs';
import type { CloseResult, SellRefundBreakdown, SellResult } from './MainStreetMarketTypes';

/**
 * Computes the sell refund for a card using the new formula (CG-0MT5XO7DI0066QCT).
 *
 * Refund = baseRefund + synergyIncomeComponent + synergyRepComponent
 *
 * Where:
 *   baseRefund = Math.ceil((card.cost + totalUpgradeCost) * 1.5)
 *   synergyIncomeComponent = Math.max(0, currentIncome - effectiveBase)
 *   synergyRepComponent = Math.max(0, currentReputationPerTurn - (repPerTurn + repBonus))
 *   effectiveBase = (baseIncome + incomeBonus) * (hasAdjacentSameType ? 0.6 : 1)
 *
 * Synergy components use Math.max(0, ...) to avoid negative contributions
 * (e.g. when same-type penalty reduces income below base).
 * If currentIncome or currentReputationPerTurn is undefined, the respective
 * component is treated as 0 (defensive guard).
 *
 * @param state     Current game state.
 * @param card      The card being sold.
 * @param slotIndex The grid slot index of the card.
 * @returns SellRefundBreakdown with the total refund and component breakdown.
 */
export function computeSellRefund(
  state: MainStreetState,
  card: BusinessCard | CommunitySpaceCard,
  slotIndex: number,
): SellRefundBreakdown {
  const upgradeCosts = (card as any).totalUpgradeCost ?? 0;

  // Base refund: 1.5× the total cost (purchase + upgrades)
  const baseRefund = Math.ceil((card.cost + upgradeCosts) * 1.5);

  // Compute effectiveBase (base income + upgrade bonus, with same-type penalty)
  const soldSlots: boolean[] = state.soldSlots ?? [];
  const gridDims = state.streetGridCols && state.streetGridRows
    ? { cols: state.streetGridCols, rows: state.streetGridRows }
    : undefined;
  let effectiveBase = card.baseIncome + card.incomeBonus;
  if (hasAdjacentSameType(state.streetGrid, slotIndex, soldSlots, gridDims)) {
    effectiveBase = roundInt(effectiveBase * 0.6);
  }

  // Synergy income component: the portion of currentIncome above effectiveBase.
  // Undefined cached income means the card has not been (re)calculated — treat
  // as no synergy contribution rather than deriving one from a zero baseline.
  const synergyIncomeComponent =
    card.currentIncome === undefined
      ? 0
      : Math.max(0, card.currentIncome - effectiveBase);

  // Synergy reputation component: the portion above base rep + upgrade bonus.
  // As with income, an undefined cached value contributes no synergy — this
  // matters for cards whose base `reputationPerTurn` is negative (e.g. the
  // Pawn Shop, -10): `(undefined ?? 0) - (-10)` would otherwise fabricate a
  // +10 "synergy" refund for an uncalculated card.
  const synergyRepComponent =
    card.currentReputationPerTurn === undefined
      ? 0
      : Math.max(
          0,
          card.currentReputationPerTurn - (card.reputationPerTurn ?? 0) - card.reputationBonus,
        );

  const totalRefund = baseRefund + synergyIncomeComponent + synergyRepComponent;

  return { baseRefund, synergyIncomeComponent, synergyRepComponent, totalRefund };
}

/**
 * Sells a business or community-space card from the street grid.
 *
 * The card remains on the grid but is marked as sold (non-functional).
 * The player receives a refund calculated as:
 *   baseRefund = Math.ceil((card.cost + totalUpgradeCost) * 1.5)
 *   + synergy income component (currentIncome - effectiveBase, clamped ≥ 0)
 *   + synergy reputation component (currentRep - (repPerTurn + repBonus), clamped ≥ 0)
 *
 * where effectiveBase = (baseIncome + incomeBonus) × (same-type adjacent ? 0.6 : 1).
 *
 * This is the same +50% premium multiplier used for same-week composite
 * and drag-and-drop placements (CG-0MT5XO7DI0066QCT).
 *
 * @param state     Current game state (mutated in-place).
 * @param slotIndex Street grid slot index of the card to sell.
 * @returns SellResult on success.
 * @throws Error if the slot is empty, already sold, not in MarketPhase, or
 *         (in competitive mode) owned by a different seat.
 */
export function sellBusiness(
  state: MainStreetState,
  slotIndex: number,
): SellResult {
  // Validate slot index
  if (slotIndex < 0 || slotIndex >= state.streetGrid.length) {
    throw new Error(`Invalid slot index: ${slotIndex}. Must be 0-${state.streetGrid.length - 1}.`);
  }

  const card = state.streetGrid[slotIndex];

  // Check slot is occupied
  if (card === null) {
    throw new Error(`Slot ${slotIndex} is empty. Nothing to sell.`);
  }

  // Check not already sold
  const soldSlots: boolean[] = state.soldSlots ?? [];
  if (soldSlots[slotIndex]) {
    throw new Error(`Slot ${slotIndex} has already been sold.`);
  }

  // Ownership gate (competitive only): a seat may only sell a business it
  // owns. Single-player states have no owner-tagged grid, so this is a no-op.
  const ownership = canActiveSeatActOnSlot(state, slotIndex);
  if (!ownership.legal) {
    throw new Error(ownership.reason);
  }

  // Calculate refund using the new formula (CG-0MT5XO7DI0066QCT)
  const breakdown = computeSellRefund(state, card, slotIndex);
  const refund = breakdown.totalRefund;

  // Credit coins
  state.resourceBank.coins += refund;

  // Mark slot as sold
  state.soldSlots[slotIndex] = true;

  // Incrementally update all affected neighbors' cached values.
  // With the sold-neighbour-synergy fix, sold cards remain synergy anchors
  // — neighbours typically retain their synergy bonuses (values stay stable),
  // but recalculation ensures consistency for same-type penalty and type-matching.
  updateNeighborsOnSale(state, slotIndex);

  addLog(
    state,
    `Sold ${card.name} from slot ${slotIndex} for +${refund} coins (€${breakdown.baseRefund} base + ${breakdown.synergyIncomeComponent} synergy income + ${breakdown.synergyRepComponent} synergy rep) (${describeEventEffects(refund, 0)})`,
    classifyEffect(refund, 0),
  );

  return { card, refund, slotIndex };
}

// ── Dev-mode Cheat: Replace Random Market Card ───────────────


/**
 * Checks whether a business at the given slot can be sold.
 *
 * @param state         Current game state.
 * @param slotIndex     Street grid slot index to check.
 * @param isPlacingMode Whether the player is currently in card-placement mode (selling not allowed).
 * @returns LegalityResult indicating whether the action is permitted. In
 *          competitive mode an opponent-owned slot is rejected with an
 *          ownership-specific reason; single-player is unaffected.
 */
export function canSellBusiness(
  state: MainStreetState,
  slotIndex: number,
  isPlacingMode: boolean = false,
): LegalityResult {
  // Must be in MarketPhase
  if (state.phase !== 'MarketPhase') {
    return { legal: false, reason: 'Selling is only allowed during the MarketPhase.' };
  }

  // Must not be in card-placement mode
  if (isPlacingMode) {
    return { legal: false, reason: 'Cannot sell a card while in card-placement mode.' };
  }

  // Validate slot index
  if (slotIndex < 0 || slotIndex >= state.streetGrid.length) {
    return { legal: false, reason: `Invalid slot index: ${slotIndex}.` };
  }

  const card = state.streetGrid[slotIndex];

  // Check slot is occupied
  if (card === null) {
    return { legal: false, reason: `Slot ${slotIndex} is empty. Nothing to sell.` };
  }

  // Check not already sold
  const soldSlots: boolean[] = state.soldSlots ?? [];
  if (soldSlots[slotIndex]) {
    return { legal: false, reason: `Slot ${slotIndex} has already been sold.` };
  }

  // Ownership gate (competitive only): a seat may only sell its own business.
  const ownership = canActiveSeatActOnSlot(state, slotIndex);
  if (!ownership.legal) {
    return ownership;
  }

  return { legal: true };
}

// ── Close Business (Street Grid) ─────────────────────────────

/** Result returned after closing a business on the street grid. */

/**
 * Effective per-turn reputation contribution of the card at `slotIndex`,
 * matching what the income phase credits to that slot
 * (MS-0MURC6XO8005W57D).
 *
 * Starts from the card's cached `currentReputationPerTurn` (synergy and
 * upgrades baked in) and falls back to the card's base `reputationPerTurn`
 * when the cached value has not been calculated. Adds any per-business staff
 * skill buffs employed at the slot, mirroring the income phase's
 * `baseRep + buffs.reputation.flat` ledger.
 *
 * @param state     Current game state.
 * @param card      The card occupying the slot.
 * @param slotIndex Street grid slot index.
 * @returns Effective per-turn reputation (may be negative).
 */
export function effectiveCardReputationPerTurn(
  state: MainStreetState,
  card: BusinessCard | CommunitySpaceCard,
  slotIndex: number,
): number {
  const base = card.currentReputationPerTurn ?? card.reputationPerTurn ?? 0;
  const buffs = computePerBusinessSkillBuffs(
    getEmployedSpecializationSkillsForBusiness(state, slotIndex),
    {
      synergyTypes: (card as BusinessCard).synergyTypes ?? [],
      baseIncome: (card as BusinessCard).baseIncome ?? 0,
      ongoingCost: (card as BusinessCard).ongoingCost ?? 0,
    },
  );
  return base + buffs.reputation.flat;
}

/**
 * Signed reputation delta for closing the card at `slotIndex`
 * (MS-0MURC6XO8005W57D): `-(effectiveRepPerTurn × closeReputationMultiplier)`.
 *
 * Negative for a card that contributes reputation (a penalty), positive for a
 * nuisance card (a boost). The caller applies the reputation floor; this
 * helper returns the raw, un-clamped delta for scoring and display.
 *
 * @param state     Current game state.
 * @param slotIndex Street grid slot index.
 * @returns Signed reputation delta (0 when the slot is empty).
 */
export function closeReputationDelta(state: MainStreetState, slotIndex: number): number {
  const card = state.streetGrid[slotIndex];
  if (!card) return 0;
  const perTurn = effectiveCardReputationPerTurn(state, card, slotIndex);
  return -(perTurn * state.config.closeReputationMultiplier);
}

/**
 * Checks whether a business or community-space card at the given slot can be
 * closed.
 *
 * Closing is the counterpart to selling: it costs one daily action (charged
 * by `closeBusinessCommand` via the shared `consumeAction` helper) and grants
 * no coins, but removes the card from the street entirely so the slot becomes
 * immediately placeable again. Sold cards are inert and must not be closeable.
 *
 * Gates on MarketPhase, not-placing-mode, slot bounds, slot occupied, card
 * non-sold, and >=1 daily action available — the same `LegalityResult`
 * pattern as `canSellBusiness`, plus the action-budget check.
 *
 * @param state         Current game state.
 * @param slotIndex     Street grid slot index to check.
 * @param isPlacingMode Whether the player is currently in card-placement mode (closing not allowed).
 * @returns LegalityResult indicating whether the action is permitted. In
 *          competitive mode an opponent-owned slot is rejected with an
 *          ownership-specific reason; single-player is unaffected.
 */
export function canCloseBusiness(
  state: MainStreetState,
  slotIndex: number,
  isPlacingMode: boolean = false,
): LegalityResult {
  if (state.phase !== 'MarketPhase') {
    return { legal: false, reason: 'Closing is only allowed during the MarketPhase.' };
  }

  if (isPlacingMode) {
    return { legal: false, reason: 'Cannot close a card while in card-placement mode.' };
  }

  if (slotIndex < 0 || slotIndex >= state.streetGrid.length) {
    return { legal: false, reason: `Invalid slot index: ${slotIndex}.` };
  }

  const card = state.streetGrid[slotIndex];
  if (card === null) {
    return { legal: false, reason: `Slot ${slotIndex} is empty. Nothing to close.` };
  }

  const soldSlots: boolean[] = state.soldSlots ?? [];
  if (soldSlots[slotIndex]) {
    return { legal: false, reason: `Slot ${slotIndex} has already been sold and cannot be closed.` };
  }

  // Ownership gate (competitive only): a seat may only close its own
  // business. Checked before the action budget so a cross-owner attempt is
  // always reported as an ownership violation (and never consumes an action).
  const ownership = canActiveSeatActOnSlot(state, slotIndex);
  if (!ownership.legal) {
    return ownership;
  }

  if ((state.actionsRemaining ?? 0) <= 0) {
    return { legal: false, reason: 'No actions remaining this week. Closing costs 1 action.' };
  }

  return { legal: true };
}

/**
 * Closes (demolishes without refund) a business or community-space card on the
 * street grid.
 *
 * The card is fully removed: the slot becomes `null` (immediately placeable
 * again), the card is pushed to the unified `discardPile` (it is not removed
 * from the game), affected neighbours' cached income/reputation are
 * recalculated with the closed card no longer present, and an activity-log
 * entry is written. Closing also applies a **reputation consequence**
 * (MS-0MURC6XO8005W57D): the player's reputation is adjusted by
 * `-(cardReputationPerTurn × closeReputationMultiplier)` and floored at 0, so
 * removing a reputation-positive card is a penalty and removing a nuisance
 * (negative per-turn reputation) is a boost. No coins are credited and no
 * action is consumed at this layer — the daily action is charged by
 * `closeBusinessCommand` so that the engine and command paths share the single
 * `consumeAction` enforcement point (CG-0MTCP7F9S009HARC).
 *
 * @param state     Current game state (mutated in-place).
 * @param slotIndex Street grid slot index of the card to close.
 * @returns CloseResult on success, including the applied reputation delta.
 * @throws Error if the slot is out of bounds, empty, already sold, or (in
 *         competitive mode) owned by a different seat.
 */
export function closeBusiness(
  state: MainStreetState,
  slotIndex: number,
): CloseResult {
  if (slotIndex < 0 || slotIndex >= state.streetGrid.length) {
    throw new Error(`Invalid slot index: ${slotIndex}. Must be 0-${state.streetGrid.length - 1}.`);
  }

  const card = state.streetGrid[slotIndex];
  if (card === null) {
    throw new Error(`Slot ${slotIndex} is empty. Nothing to close.`);
  }

  const soldSlots: boolean[] = state.soldSlots ?? [];
  if (soldSlots[slotIndex]) {
    throw new Error(`Slot ${slotIndex} has already been sold and cannot be closed.`);
  }

  // Ownership gate (competitive only): a seat may only close its own business.
  const ownership = canActiveSeatActOnSlot(state, slotIndex);
  if (!ownership.legal) {
    throw new Error(ownership.reason);
  }

  // Reputation consequence (MS-0MURC6XO8005W57D): compute the raw delta from
  // the card's effective per-turn reputation BEFORE the grid is mutated, then
  // apply it floored at 0 (the Discard precedent, CG-0MTQ7KUVF009ELQK). A
  // clamped application reports only the reputation actually removed.
  const rawRepDelta = closeReputationDelta(state, slotIndex);
  const repBefore = state.resourceBank.reputation;
  state.resourceBank.reputation = Math.max(0, repBefore + rawRepDelta);
  const reputationDelta = state.resourceBank.reputation - repBefore;

  // Send the card to the unified discard pile (community-space cards share the
  // business card shape; the pile is typed as BusinessCard[]).
  state.discardPile.push(card as unknown as BusinessCard);

  // Remove from the grid; the slot becomes immediately placeable.
  state.streetGrid[slotIndex] = null;
  state.soldSlots[slotIndex] = false;

  // Recalculate neighbours with the closed card fully removed (unlike a sale,
  // where the card stays on the grid as an inert synergy anchor).
  updateNeighborsOnClose(state, slotIndex);

  addLog(
    state,
    `Closed ${card.name} from slot ${slotIndex} (no refund, 1 action, ${describeEventEffects(0, reputationDelta)})`,
    classifyEffect(0, reputationDelta),
  );

  return { card, slotIndex, reputationDelta };
}

