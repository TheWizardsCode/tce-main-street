/**
 * Main Street: Market Refill and Refresh
 *
 * Deck-to-market refill, paid refresh, card cycling, incident-deck
 * replenishment, and the cheat replace helper.
 *
 * Import graph: depends on `MainStreetMarketTypes`.
 *
 * @module
 */

import type { LegalityResult } from '@rule-engine';
import { shuffleArray } from '@card-system';
import type { MainStreetState } from './MainStreetState';
import { addLog, describeEventEffects, classifyEffect, refillSingleRowMarket } from './MainStreetState';
import type { BusinessCard, CommunitySpaceCard, UpgradeCard, EventCard, AnyCard, StaffCard, SynergyType } from './MainStreetCards';
import { REFRESH_MARKET_COST, REFRESH_MARKET_COST_STEP } from './MainStreetCards';
import { computeRefreshCostDiscount, getEmployedSpecializationSkills } from './MainStreetStaffBuffs';
import type { RefreshResult } from './MainStreetMarketTypes';

/** Monotonic counter for cheat-generated replacement card ids. */
let cheatNonce = 0;

/**
 * Refills the single-row marketplace toward `MARKET_TOTAL_SLOTS` cards with
 * the target composition (CG-0MSTOATDT009BRX2): at most 3 cards, always ≥1
 * business card (community-space counts as business), the remainder random
 * within "1–2 business, 0–1 upgrade, 0–1 event".
 *
 * TOP-UP semantics: currently-visible cards are preserved and only missing
 * slots are drawn (mirrors the legacy day-start refill; the tutorial relies
 * on this to keep scenario-placed cards alive across the day boundary).
 * Callers wanting a full re-draw discard/clear the row first:
 * `refreshMarket` (research) and `cycleMarketCards` (end-of-day cycle) do.
 */
export function refillMarket(state: MainStreetState): void {
  refillSingleRowMarket(state);
}

/**
 * Checks whether the player can research (refresh) the single-row market.
 */
export function canRefreshMarket(state: MainStreetState): LegalityResult {
  if (state.phase !== 'MarketPhase') {
    return { legal: false, reason: 'Researching the market is only allowed during MarketPhase.' };
  }
  const cost = refreshMarketCost(state);
  if (state.resourceBank.coins < cost) {
    return { legal: false, reason: `Not enough coins. Need ${cost}, have ${state.resourceBank.coins}.` };
  }
  return { legal: true };
}

/**
 * Effective cost to research (refresh) the single-row market for the next
 * re-roll, after staff discounts (e.g. the Accountant's "refresh costs 1 less"
 * ability — Group F, CG-0MSQJ7VL9009JHF4 / CG-0MSTOATDT009BRX2). Discounts are
 * summed across hired staff and the result is clamped at 0 (never negative).
 *
 * Escalating cost (MS-0MTR6ZRF5007PWNZ): the base rises by
 * `REFRESH_MARKET_COST_STEP` (250) for every re-roll already made this turn —
 * 500, 750, 1000, … — and is reset at `WeekStart`. Discounts are subtracted
 * from the escalated base, so the clamp is applied last.
 */
export function refreshMarketCost(state: MainStreetState): number {
  const discount = (state.staffCards ?? []).reduce(
    (sum, card) => sum + (card.refreshCostDiscount ?? 0),
    0,
  );
  // Negotiator specialization skill: -1 on refreshes (I4, CG-0MT4WXV2J000M35M).
  const negotiatorDiscount = computeRefreshCostDiscount(getEmployedSpecializationSkills(state));
  const escalatedBase =
    REFRESH_MARKET_COST + REFRESH_MARKET_COST_STEP * (state.marketRefreshesThisTurn ?? 0);
  return Math.max(0, escalatedBase - discount - negotiatorDiscount);
}

/**
 * Researches (refreshes) the single-row market: charges the player, discards all
 * currently-visible (unmoved/unpurchased) cards to their respective discard
 * piles, and refills the whole line to full composition. Each re-roll in the
 * same turn costs 250 more than the previous one (MS-0MTR6ZRF5007PWNZ); the
 * escalation resets at `WeekStart`. The counter is incremented after the charge
 * so the reported and charged cost is the pre-increment (current) value.
 */
export function refreshMarket(state: MainStreetState): RefreshResult {
  const legality = canRefreshMarket(state);
  if (!legality.legal) throw new Error(legality.reason);

  // Deduct cost (after staff refresh discounts, e.g. Accountant)
  const cost = refreshMarketCost(state);
  state.resourceBank.coins -= cost;

  // Move visible market cards to their respective discard piles
  const removed: AnyCard[] = state.market.cards.slice();
  for (const c of removed) {
    if (c.family === 'business') {
      state.discards.business.push(c as any);
    } else if (c.family === 'community-space') {
      state.discards.communitySpace.push(c as any);
    } else if (c.family === 'upgrade') {
      state.discards.upgrade.push(c as any);
    } else if (c.family === 'event') {
      state.discards.event.push(c as any);
    } else if (c.family === 'staff') {
      // Staff are a first-class market family (CG-0MT3KZNQB0053K55).
      state.discards.staff.push(c as StaffCard);
    }
  }

  // Clear the visible row and draw a fresh full line
  state.market.cards.length = 0;
  refillSingleRowMarket(state);

  // Advance the per-turn escalation counter only after the re-roll succeeded:
  // the next re-roll this turn costs 250 more (MS-0MTR6ZRF5007PWNZ). The
  // `cost` above was computed pre-increment, so the reported/charged price is
  // the current turn's price.
  state.marketRefreshesThisTurn = (state.marketRefreshesThisTurn ?? 0) + 1;

  // Build a detailed replacement summary for the activity log
  const replacedStrings = removed.map(c => {
    const name = (c as any).name ?? c.id;
    return `${c.id}${name ? ` (${name})` : ''}`;
  });
  addLog(state, `Researched market (-€${cost}): replaced ${replacedStrings.join(', ')} (${describeEventEffects(-cost, 0)})`, classifyEffect(-cost, 0));

  return { replaced: removed, cost };
}

// ── Investor free market re-roll (MS-0MTISBYLS009936W) ──────

/** An employed staff member whose free re-roll ability is available. */
export interface EmployedInvestorReroll {
  /** The employed Investor card instance. */
  readonly card: StaffCard;
  /** Street-grid slot of the business the Investor is employed at. */
  readonly slotIndex: number;
  /** Synergy types of the hosting business (the relevance key). */
  readonly synergyTypes: readonly SynergyType[];
  /** Per-slot relevance probability from the card. */
  readonly bias: number;
}

/**
 * Default relevance bias applied when an Investor declares the free re-roll
 * ability without an explicit `marketRelevanceBias` value
 * (MS-0MTISBYLS009936W): 75%.
 */
export const INVESTOR_DEFAULT_RELEVANCE_BIAS = 0.75;

/**
 * Finds the first employed staff member that grants the Investor's free market
 * re-roll (MS-0MTISBYLS009936W). "Employed" means the member is registered on
 * a street-grid business's `employedStaff` list (the per-business source of
 * truth, CG-0MTIOLY2A0092OT1), with an `employedAtSlot` fallback for in-memory
 * states that predate the field. Hand-slot staff (not employed at a business) do
 * NOT grant the re-roll, because the relevance key is the hosting business.
 *
 * Pure: never mutates state and consumes no RNG. Multiple employed Investors
 * do not stack — only the first is reported (the per-turn gate is global).
 *
 * @param state Current game state.
 * @returns The employed Investor reroll descriptor, or null when none exists.
 */
export function getEmployedInvestorReroll(
  state: MainStreetState,
): EmployedInvestorReroll | null {
  for (let slotIndex = 0; slotIndex < state.streetGrid.length; slotIndex++) {
    const business = state.streetGrid[slotIndex];
    if (!business) continue;
    const members: StaffCard[] = Array.isArray(business.employedStaff)
      ? (business.employedStaff as StaffCard[])
      : (state.staffCards ?? []).filter(m => m.employedAtSlot === slotIndex);
    const investor = members.find(m => m.freeMarketRerollPerTurn === true);
    if (!investor) continue;
    const declared = investor.marketRelevanceBias;
    const bias =
      typeof declared === 'number' && Number.isFinite(declared)
        ? Math.max(0, Math.min(1, declared))
        : INVESTOR_DEFAULT_RELEVANCE_BIAS;
    return {
      card: investor,
      slotIndex,
      synergyTypes: business.synergyTypes ?? [],
      bias,
    };
  }
  return null;
}

/**
 * Checks whether the player may use the Investor's free market re-roll now
 * (MS-0MTISBYLS009936W AC2): the game must be in `MarketPhase`, at least one
 * Investor must be employed, and the once-per-turn flag must not yet be set.
 * Multiple Investors do not stack — the flag is global, so this returns
 * illegal once the free re-roll has been used this turn. After that, further
 * re-rolls fall back to the normal paid `refreshMarket` path.
 */
export function canUseFreeMarketReroll(state: MainStreetState): LegalityResult {
  if (state.phase !== 'MarketPhase') {
    return {
      legal: false,
      reason: 'The Investor free re-roll is only allowed during MarketPhase.',
    };
  }
  if (state.investorFreeRerollUsedThisTurn) {
    return {
      legal: false,
      reason: 'The Investor free re-roll has already been used this turn.',
    };
  }
  if (!getEmployedInvestorReroll(state)) {
    return { legal: false, reason: 'No employed Investor grants a free re-roll.' };
  }
  return { legal: true };
}

/**
 * Performs the Investor's free market re-roll (MS-0MTISBYLS009936W AC2/AC3):
 * coin-free and action-free, once per turn. Discards the visible row, refills
 * it with a bias-aware draw toward the hosting business's synergy types using
 * the seeded RNG (`state.rng` — same seed ⇒ same game), sets the per-turn flag,
 * and advances the shared per-turn escalation counter
 * (`marketRefreshesThisTurn`) so the next PAID re-roll costs the escalated
 * price. `refreshMarketCost` remains the paid path's single source of truth.
 *
 * @param state Current game state (mutated in-place).
 * @returns The replaced cards and a cost of 0 (the re-roll is coin-free).
 * @throws Error when the free re-roll is not legal (wrong phase, already used,
 *         or no employed Investor).
 */
export function useFreeMarketReroll(state: MainStreetState): RefreshResult {
  const legality = canUseFreeMarketReroll(state);
  if (!legality.legal) throw new Error(legality.reason);
  const investor = getEmployedInvestorReroll(state)!;

  // Discard the currently visible row (same family routing as refreshMarket).
  const removed: AnyCard[] = state.market.cards.slice();
  for (const c of removed) {
    if (c.family === 'business') {
      state.discards.business.push(c as any);
    } else if (c.family === 'community-space') {
      state.discards.communitySpace.push(c as any);
    } else if (c.family === 'upgrade') {
      state.discards.upgrade.push(c as any);
    } else if (c.family === 'event') {
      state.discards.event.push(c as any);
    } else if (c.family === 'staff') {
      state.discards.staff.push(c as StaffCard);
    }
  }

  state.market.cards.length = 0;
  refillSingleRowMarket(state, {
    bias: investor.bias,
    synergyTypes: investor.synergyTypes,
  });

  // Once per turn, no stacking (the flag is global), and advance the shared
  // escalation counter so the next paid re-roll costs more.
  state.investorFreeRerollUsedThisTurn = true;
  state.marketRefreshesThisTurn = (state.marketRefreshesThisTurn ?? 0) + 1;

  const replacedStrings = removed.map(c => {
    const name = (c as any).name ?? c.id;
    return `${c.id}${name ? ` (${name})` : ''}`;
  });
  addLog(
    state,
    `Investor free re-roll: replaced ${replacedStrings.join(', ')} (coin-free)`,
    'neutral',
  );

  return { replaced: removed, cost: 0 };
}

/**
 * Cycles all unpurchased market cards to their respective discard piles
 * and refills the market from the decks.
 *
 * Called at the end of each MarketPhase (before IncomePhase) to ensure
 * fresh cards are available each turn. Player-owned cards (hand, tableau)
 * are not affected.
 *
 * Uses the existing seeded RNG for any reshuffles that occur during refill.
 *
 * @param state  Current game state (mutated in-place).
 */
export function cycleMarketCards(state: MainStreetState): void {
  // ── Cycle the single-row market cards to discards ────────
  const visibleCards = state.market.cards.splice(0);
  for (const card of visibleCards) {
    if (card.family === 'business') {
      state.discards.business.push(card as BusinessCard);
    } else if (card.family === 'community-space') {
      state.discards.communitySpace.push(card as CommunitySpaceCard);
    } else if (card.family === 'upgrade') {
      state.discards.upgrade.push(card as UpgradeCard);
    } else if (card.family === 'event') {
      state.discards.event.push(card as EventCard);
    } else if (card.family === 'staff') {
      // Staff are a first-class market family (CG-0MT3KZNQB0053K55).
      state.discards.staff.push(card as StaffCard);
    }
  }

  // ── Refill the single row from decks ─────────────────────
  refillSingleRowMarket(state);
}

/**
 * Replenishes the face-down incident deck when it is exhausted: gathers
 * remaining Incident-trigger cards from the event deck and event discards
 * and shuffles them into a new face-down deck (seeded, so the order is
 * deterministic per game seed). Constraint satisfaction (repeat spacing /
 * streak) happens at draw time via `findConstrainedIncidentIndex`, not by
 * pre-ordering the deck (CG-0MSZDD2TP003TZS5).
 *
 * No visible refill loop: the deck is face-down and only its remaining
 * count is shown. Called by `resolveIncident` when `incidentDeck` is empty.
 * Does nothing when no Incident-trigger cards are available anywhere.
 */
export function replenishIncidentDeck(state: MainStreetState): void {
  if (state.incidentDeck.length > 0) return;

  const pool: EventCard[] = [];
  const eventDeck = state.decks.event;
  for (let i = eventDeck.length - 1; i >= 0; i--) {
    if (eventDeck[i].trigger === 'Incident') {
      pool.push(eventDeck.splice(i, 1)[0]);
    }
  }
  const eventDiscards = state.discards.event;
  for (let i = eventDiscards.length - 1; i >= 0; i--) {
    if (eventDiscards[i].trigger === 'Incident') {
      pool.push(eventDiscards.splice(i, 1)[0]);
    }
  }
  if (pool.length === 0) return;

  // Seeded shuffle only — no pre-ordering. `resolveIncident` selects each
  // card at draw time via `findConstrainedIncidentIndex` (deterministic,
  // consumes no RNG), so the deck order here only sets the candidate order.
  shuffleArray(pool, state.rng);
  state.incidentDeck = pool;
  addLog(state, 'Reshuffled incident deck from event cards', 'neutral');
}

/**
 * Dev-mode cheat helper: replace a uniformly-random slot from
 * `state.market.cards` with a shallow copy of the chosen template
 * (unique id `${templateId}--cheat-${nonce}`), push the displaced
 * card to its family's discard pile, and return the displaced card.
 *
 * The market row is NOT refilled here; callers should re-render via
 * the existing renderer path (e.g. `scene.refreshMarket()`).
 */
export function cheatReplaceMarketCard(
  state: MainStreetState,
  template: AnyCard,
  family: string,
  rng?: () => number,
): AnyCard | null {
  const slots = state.market.cards.length;
  if (slots === 0) return null;
  const slotIndex = Math.floor((rng?.() ?? Math.random()) * slots);
  const displaced = state.market.cards[slotIndex] ?? null;
  const baseId = (template as any).id ?? family;
  // Templates intentionally omit `family` (it is inferred from the source
  // array), so set it explicitly to match the chosen family — the renderer
  // and affordability checks both route on this field (MS-0MUO7FS95000OLN9).
  const newCard: AnyCard = { ...(template as any), id: `${baseId}--cheat-${cheatNonce++}`, family } as AnyCard;
  if (family === 'business' || family === 'community-space') {
    (newCard as any).level = 0;
    (newCard as any).incomeBonus = 0;
    (newCard as any).synergyRangeBonus = 0;
    (newCard as any).reputationBonus = 0;
    (newCard as any).ongoingCost = (newCard as any).ongoingCost ?? 0;
    (newCard as any).appliedUpgrades = [];
    (newCard as any).totalUpgradeCost = 0;
  }
  state.market.cards[slotIndex] = newCard;
  if (displaced) {
    const fam = (displaced as any).family as string;
    if (fam === 'business') state.discards.business.push(displaced as BusinessCard);
    else if (fam === 'community-space') state.discards.communitySpace.push(displaced as CommunitySpaceCard);
    else if (fam === 'event') state.discards.event.push(displaced as EventCard);
    else if (fam === 'upgrade') state.discards.upgrade.push(displaced as UpgradeCard);
    else if (fam === 'staff') state.discards.staff.push(displaced as StaffCard);
  }
  return displaced;
}

