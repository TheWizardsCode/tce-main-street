/**
 * MainStreetHudTooltips -- Tooltip content builders for the HUD status bar.
 *
 * Provides localisable string keys and builder functions for the Coins,
 * Reputation, Score, Actions and Community Favour tooltips shown when
 * hovering/tapping HUD values.
 *
 * ## i18n integration
 * Every user-facing string is looked up via the core-engine `t()` function
 * which resolves the active locale bundle and falls back to English defaults.
 * The English defaults are registered at module load time so they are always
 * available, even without an explicit locale setup.
 *
 * ## ARIA labels
 * Each interactive zone carries a static `aria-label` for screen readers.
 * These are also localisable through the same i18n system.
 *
 * @module
 */

import { type IncomeResult, type SlotIncome } from '../MainStreetAdjacency';
import { reputationCoinMultiplier, applyReputationMultiplier } from '../MainStreetDifficulty';
import { ORDERED_TIER_DEFINITIONS } from '../MainStreetTiers';
import { computeScore, effectiveWinThreshold, canMoveStaffOnBusiness } from '../MainStreetEngine';
import {
  canUseFreeMarketReroll,
  getEmployedInvestorReroll,
  refreshMarketCost,
  canRefreshMarket,
} from '../MainStreetMarket';
import type { MainStreetState, MainStreetCampaignProgress } from '../MainStreetState';
import { t, registerLocale } from '@core-engine/I18n';

// ── i18n Keys ───────────────────────────────────────────────

/** The set of i18n keys used by HUD tooltips.  A future localisation layer can
 *  swap implementations for these keys. */
export const HUD_TOOLTIP_I18N_KEYS = {
  coinsTitle: 'hud.tooltip.coins.title',
  coinsIncomeLabel: 'hud.tooltip.coins.income',
  coinsPreMultiplierLabel: 'hud.tooltip.coins.preMultiplier',
  coinsPostMultiplierLabel: 'hud.tooltip.coins.postMultiplier',
  coinsCalcNote: 'hud.tooltip.coins.calcNote',
  repTitle: 'hud.tooltip.rep.title',
  repValueLabel: 'hud.tooltip.rep.value',
  repMultiplierLabel: 'hud.tooltip.rep.multiplier',
  repEffectLabel: 'hud.tooltip.rep.effect',
  scoreTitle: 'hud.tooltip.score.title',
  scoreEstimateLabel: 'hud.tooltip.score.estimate',
  scoreBreakdownCoins: 'hud.tooltip.score.breakdownCoins',
  scoreBreakdownReputation: 'hud.tooltip.score.breakdownReputation',
  scoreBreakdownChallenges: 'hud.tooltip.score.breakdownChallenges',
  scoreBreakdownTurnCost: 'hud.tooltip.score.breakdownTurnCost',
  scoreTurnCostLabel: 'hud.tooltip.score.turnCost',
  scoreRemainingToWin: 'hud.tooltip.score.remainingToWin',
  scoreThresholdMet: 'hud.tooltip.score.thresholdMet',
  scoreNextTierLabel: 'hud.tooltip.score.nextTier',
  scoreAllTiersUnlocked: 'hud.tooltip.score.allTiersUnlocked',
  actionTitle: 'hud.tooltip.action.title',
  actionRemainingLabel: 'hud.tooltip.action.remaining',
  actionConsumesLabel: 'hud.tooltip.action.consumes',
  actionFreeOpsLabel: 'hud.tooltip.action.freeOps',
  actionBankedLabel: 'hud.tooltip.action.banked',
  actionBankingExplain: 'hud.tooltip.action.bankingExplain',
  actionBankingGmNote: 'hud.tooltip.action.bankingGmNote',
  favourCoinsToRepTitle: 'hud.tooltip.favour.coinsToRep.title',
  favourCoinsToRepRate: 'hud.tooltip.favour.coinsToRep.rate',
  favourRepToCoinsTitle: 'hud.tooltip.favour.repToCoins.title',
  favourRepToCoinsRate: 'hud.tooltip.favour.repToCoins.rate',
  favourGate: 'hud.tooltip.favour.gate',
  favourUsedThisTurn: 'hud.tooltip.favour.usedThisTurn',
  favourInsufficient: 'hud.tooltip.favour.insufficient',
  // Market re-roll control (MS-0MUOSULQ700186PP): the Research / free-reroll
  // button label and tooltip, and the move-staff affordance copy.
  marketRerollTitle: 'hud.tooltip.marketReroll.title',
  marketRerollFreeLabel: 'hud.tooltip.marketReroll.freeLabel',
  marketRerollPaidLabel: 'hud.tooltip.marketReroll.paidLabel',
  marketRerollFreeBody: 'hud.tooltip.marketReroll.freeBody',
  marketRerollPaidBody: 'hud.tooltip.marketReroll.paidBody',
  marketRerollGate: 'hud.tooltip.marketReroll.gate',
  marketRerollUsedBody: 'hud.tooltip.marketReroll.usedBody',
  marketRerollNoInvestorBody: 'hud.tooltip.marketReroll.noInvestorBody',
  moveStaffTitle: 'hud.tooltip.moveStaff.title',
  moveStaffLabel: 'hud.tooltip.moveStaff.label',
  moveStaffBody: 'hud.tooltip.moveStaff.body',
  moveStaffDestinations: 'hud.tooltip.moveStaff.destinations',
  moveStaffNoDestination: 'hud.tooltip.moveStaff.noDestination',
  moveStaffNoStaff: 'hud.tooltip.moveStaff.noStaff',
  moveStaffNoActions: 'hud.tooltip.moveStaff.noActions',
} as const;

/** ARIA label i18n keys (for screen-reader accessibility). */
export const HUD_ARIA_I18N_KEYS = {
  coins: 'hud.aria.coins',
  rep: 'hud.aria.rep',
  score: 'hud.aria.score',
  action: 'hud.aria.action',
  favourCoinsToRep: 'hud.aria.favour.coinsToRep',
  favourRepToCoins: 'hud.aria.favour.repToCoins',
} as const;

// ── ARIA label lookup via i18n ──────────────────────────────

/** ARIA labels for HUD interactive zones — resolved through the i18n system. */
export const HUD_ARIA_LABELS = {
  get coins() { return t(HUD_ARIA_I18N_KEYS.coins); },
  get rep() { return t(HUD_ARIA_I18N_KEYS.rep); },
  get score() { return t(HUD_ARIA_I18N_KEYS.score); },
  get action() { return t(HUD_ARIA_I18N_KEYS.action); },
  get favourCoinsToRep() { return t(HUD_ARIA_I18N_KEYS.favourCoinsToRep); },
  get favourRepToCoins() { return t(HUD_ARIA_I18N_KEYS.favourRepToCoins); },
};

// ── Default English strings (registered as the 'en' locale bundle) ────

/** Default English string templates. Registered as the `en` locale bundle. */
export const HUD_TOOLTIP_STRINGS = {
  coinsTitle: 'Income This Turn',
  coinsIncomeLabel: 'Base income',
  coinsPreMultiplierLabel: 'Before reputation',
  coinsPostMultiplierLabel: 'After reputation',
  coinsCalcNote: 'Sum of business incomes + synergy bonuses',
  repTitle: 'Reputation',
  repValueLabel: 'Reputation',
  repMultiplierLabel: 'Coin multiplier',
  repEffectLabel: 'Higher reputation multiplies coin income (capped)',
  scoreTitle: 'Score Estimate',
  scoreEstimateLabel: 'Estimated score',
  scoreBreakdownCoins: 'Coins',
  scoreBreakdownReputation: 'Reputation',
  scoreBreakdownChallenges: 'Challenges',
  scoreBreakdownTurnCost: 'Turn cost',
  scoreTurnCostLabel: 'Total turn cost',
  scoreRemainingToWin: 'more needed to win',
  scoreThresholdMet: 'Win threshold met!',
  scoreNextTierLabel: 'Next tier',
  scoreAllTiersUnlocked: 'All tiers unlocked',
  actionTitle: 'Actions This Week',
  actionRemainingLabel: 'Actions remaining',
  actionConsumesLabel: 'Costs 1 action: buy/place business, move to hand, hire staff, close business',
  actionFreeOpsLabel: 'No action: research market, sell, end turn. Discard costs reputation (its coin cost), not an action',
  actionBankedLabel: 'Banked actions',
  actionBankingExplain: "1 action per turn, with up to two turns' unused actions banked — every action you take spends 1 from the bank (down to 0), so banked actions are a finite reserve, not a permanent bonus",
  actionBankingGmNote: '+1 action per week from action-granting staff (staff actions are used first, never banked)',
  favourCoinsToRepTitle: 'Community Favour — Coins → Reputation',
  favourCoinsToRepRate: 'Spend {cost} coins to gain {gain} reputation.',
  favourRepToCoinsTitle: 'Community Favour — Reputation → Coins',
  favourRepToCoinsRate: 'Spend {cost} reputation to gain {gain} coins.',
  favourGate: 'Once per turn.',
  favourUsedThisTurn: 'Already used this turn.',
  favourInsufficient: 'Not enough {resource} (need {cost}).',
  marketRerollTitle: 'Market Re-roll',
  marketRerollFreeLabel: 'Free re-roll (Investor)',
  marketRerollPaidLabel: 'Research ({cost})',
  marketRerollFreeBody:
    "Investor ability: one coin-free, action-free re-roll per turn.\n75% of drawn cards are biased toward this business's synergy types ({types}).",
  marketRerollPaidBody: 'Pay {cost} coins to research the market and replace all visible cards.',
  marketRerollGate: 'Available only during Market phase.',
  marketRerollUsedBody: 'The Investor free re-roll has already been used this turn.',
  marketRerollNoInvestorBody: 'No employed Investor grants a free re-roll.',
  moveStaffTitle: 'Move Staff',
  moveStaffLabel: 'Move staff ({cost} action)',
  moveStaffBody: 'Relocating an employed staff member to another matching business costs {cost} action point.',
  moveStaffDestinations: 'Move to: {names}.',
  moveStaffNoDestination: 'No matching business has a free employment slot.',
  moveStaffNoStaff: 'No employed staff member can be moved.',
  moveStaffNoActions: 'No actions remaining this week — end your turn first.',
} as const;

/** ARIA label default English strings. Registered as the `en` locale bundle. */
export const HUD_ARIA_STRINGS = {
  coins: 'Coins status — hover for expected income breakdown',
  rep: 'Reputation status — hover for multiplier details',
  score: 'Score status — hover for next tier threshold',
  action: 'Actions remaining this week — buying/placing/hiring spends one',
  favourCoinsToRep: 'Community Favour: exchange coins for reputation (once per turn)',
  favourRepToCoins: 'Community Favour: exchange reputation for coins (once per turn)',
} as const;

// ── Register the English locale bundle ────────────────────────────────
// This is done at module-load time so the default strings are always available.
// The i18n keys (HUD_TOOLTIP_I18N_KEYS / HUD_ARIA_I18N_KEYS) are used as the
// lookup keys; HUD_TOOLTIP_STRINGS and HUD_ARIA_STRINGS supply the values.

const enBundle: Record<string, string> = {};
for (const [k, v] of Object.entries(HUD_TOOLTIP_STRINGS)) {
  enBundle[HUD_TOOLTIP_I18N_KEYS[k as keyof typeof HUD_TOOLTIP_STRINGS]] = v;
}
for (const [k, v] of Object.entries(HUD_ARIA_STRINGS)) {
  enBundle[HUD_ARIA_I18N_KEYS[k as keyof typeof HUD_ARIA_STRINGS]] = v;
}
registerLocale('en', enBundle);

// ── Tooltip Content Builders ─────────────────────────────────

/**
 * Builds the tooltip content string for the Coins HUD element.
 *
 * Single source preview of the CG-0MTINZ5GG007BH44 economy (Q1=c — see
 * MainStreetDifficulty header): sums cached currentIncome, then applies
 * the same reputationCoinMultiplier / applyReputationMultiplier as
 * MainStreetAdjacency.applyIncome so the tooltip's ×N and post-multiplier
 * total agree with the credited income when the multiplier is sampled
 * after income's own rep accrual. Q2 shows 3 decimals so lifts like
 * 1.0375 render as ×1.038, not the misleading ×1.0 of toFixed(1).
 */
export function buildCoinsTooltip(state: MainStreetState): string {
  const soldSlots = state.soldSlots ?? [];
  const grid = state.streetGrid;

  // Use cached currentIncome values (CG-0MRV84ZT60069PW6).
  let baseIncome = 0;
  for (let i = 0; i < grid.length; i++) {
    if (soldSlots[i]) continue;
    const card = grid[i];
    if (!card) continue;
    baseIncome += card.currentIncome ?? 0;
  }
  const multipliedIncome = applyReputationMultiplier(
    baseIncome,
    state.resourceBank.reputation,
    state.config,
  );
  const multiplier = reputationCoinMultiplier(state.resourceBank.reputation, state.config);
  // CG-0MTINZ5GG007BH44 (Q2): show 3 decimals so lifts like 1.0375 render as
  // ×1.038 instead of the misleading ×1.0 from toFixed(1).
  const multiplierStr = Number.isFinite(multiplier) ? multiplier.toFixed(3) : '1.000';

  const preMultiplierStr = Number.isFinite(baseIncome) ? String(Math.round(baseIncome)) : '0';
  const postMultiplierStr = Number.isFinite(multipliedIncome) ? String(Math.round(multipliedIncome)) : '0';

  const lines = [
    t(HUD_TOOLTIP_I18N_KEYS.coinsTitle),
    `${t(HUD_TOOLTIP_I18N_KEYS.coinsPreMultiplierLabel)}: ${preMultiplierStr}`,
    `${t(HUD_TOOLTIP_I18N_KEYS.coinsPostMultiplierLabel)}: ${postMultiplierStr} (×${multiplierStr})`,
    t(HUD_TOOLTIP_I18N_KEYS.coinsCalcNote),
  ];

  return lines.join('\n');
}

/**
 * Builds the full IncomeResult for external use (e.g. tests).
 *
 * Preview-only base totals (no difficulty/buff/multiplier deltas); the
 * credited path is applyIncome which samples the rep multiplier at Q1=c
 * per the MainStreetDifficulty header.
 */
export function getIncomeResult(state: MainStreetState): IncomeResult {
  const soldSlots = state.soldSlots ?? [];
  const grid = state.streetGrid;
  const breakdown: SlotIncome[] = [];
  let total = 0;

  for (let i = 0; i < grid.length; i++) {
    if (soldSlots[i]) continue;
    const card = grid[i];
    if (!card) continue;

    const slotTotal = card.currentIncome ?? 0;

    breakdown.push({
      slotIndex: i,
      businessName: card.name,
      baseIncome: slotTotal,
      synergyBonus: 0,
      total: slotTotal,
    });
    total += slotTotal;
  }

  return {
    total,
    breakdown,
    handSynergyTotal: 0,
    // Preview-only path: no multipliers/effects applied, so phase data is
    // base-only with zero rep/event/upcoming contributions.
    phaseBreakdown: {
      perSlotBreakdown: breakdown.map(b => ({
        slotIndex: b.slotIndex,
        businessName: b.businessName,
        baseIncome: b.total,
        synergyBonus: 0,
        repBonus: 0,
        eventDeltas: [],
        upcomingDeltas: [],
      })),
      handSynergyTotal: 0,
    },
  };
}

/**
 * Builds the tooltip content string for the Reputation HUD element.
 *
 * Reads the same reputationCoinMultiplier single source (Q1=c) and
 * Q2 3-decimal display as buildCoinsTooltip.
 */
export function buildReputationTooltip(state: MainStreetState): string {
  const rep = state.resourceBank.reputation;
  const multiplier = reputationCoinMultiplier(rep, state.config);
  // CG-0MTINZ5GG007BH44 (Q2): 3-decimal display.
  const multiplierStr = Number.isFinite(multiplier) ? multiplier.toFixed(3) : '1.000';

  const lines = [
    t(HUD_TOOLTIP_I18N_KEYS.repTitle),
    `${t(HUD_TOOLTIP_I18N_KEYS.repValueLabel)}: ${rep}`,
    `${t(HUD_TOOLTIP_I18N_KEYS.repMultiplierLabel)}: ×${multiplierStr}`,
    t(HUD_TOOLTIP_I18N_KEYS.repEffectLabel),
  ];

  return lines.join('\n');
}

/**
 * Builds the HUD `Score: x / y` line.
 *
 * The denominator is the effective win threshold: the base difficulty
 * threshold divided by the number of seats and rounded to the nearest 50 in
 * competitive play, or the base value unchanged in single-player
 * (MS-0MUZK652V001L71C). Keeping this in the Phaser-free tooltip module lets
 * the HUD string be unit-tested without booting a scene.
 *
 * @param state  Current game state (read-only).
 * @param score  Optional pre-computed score estimate for the numerator.
 * @returns The HUD score line, e.g. `Score: 1200/3350`.
 */
export function buildHudScoreLine(state: MainStreetState, score: number = computeScore(state)): string {
  return `Score: ${Math.round(score)}/${effectiveWinThreshold(state)}`;
}

/**
 * Builds the tooltip content string for the Score HUD element.
 *
 * Shows:
 * - Current final-score estimate in "x / y" format (where y is the win threshold)
 * - Score breakdown by source (coins, reputation multiplier, challenge bonus)
 * - How close the player is to the win threshold
 * - Next locked tier name and reputation threshold (or "All tiers unlocked")
 */
export function buildScoreTooltip(
  state: MainStreetState,
  campaign: MainStreetCampaignProgress | null,
): string {
  const score = computeScore(state);
  // Competitive play races toward the effective (per-seat) win threshold
  // (`base / playerCount`, rounded to the nearest 50) so the tooltip target
  // always matches the value the engine awards the win at
  // (MS-0MUZK652V001L71C). Single-player resolves to the unchanged base value.
  const threshold = effectiveWinThreshold(state);

  // Score breakdown components
  const coins = state.resourceBank.coins;
  const rep = state.resourceBank.reputation;
  const repContribution = rep;
  const challengeContribution = state.challengesCompleted.length * state.config.challengeBonusPoints;
  const remaining = threshold - score;

  // Compute total ongoing turn cost from all placed cards.
  // Street grid holds BusinessCard | CommunitySpaceCard, both of which have
  // ongoingCost. Staff ongoing costs are tracked separately in state.staffCards.
  const soldSlots = state.soldSlots ?? [];
  let totalTurnCost = 0;
  for (let i = 0; i < state.streetGrid.length; i++) {
    if (soldSlots[i]) continue;
    const card = state.streetGrid[i];
    if (!card) continue;
    totalTurnCost += card.ongoingCost ?? 0;
  }
  // Add ongoing costs from hired staff cards (not on the street grid).
  for (const staff of state.staffCards ?? []) {
    totalTurnCost += staff.ongoingCost ?? 0;
  }

  // Determine next locked tier
  const unlockedTiers = campaign?.unlockedTiers ?? ['tier-1'];
  const nextTier = findNextLockedTier(unlockedTiers);

  const lines = [
    t(HUD_TOOLTIP_I18N_KEYS.scoreTitle),
    `${t(HUD_TOOLTIP_I18N_KEYS.scoreEstimateLabel)}: ${Math.round(score)}/${threshold}`,
    '',
    `${t(HUD_TOOLTIP_I18N_KEYS.scoreBreakdownCoins)}: ${Math.round(coins)}`,
    `${t(HUD_TOOLTIP_I18N_KEYS.scoreBreakdownReputation)}: ${repContribution}`,
    `${t(HUD_TOOLTIP_I18N_KEYS.scoreBreakdownChallenges)}: ${challengeContribution}`,
    '',
    `${t(HUD_TOOLTIP_I18N_KEYS.scoreTurnCostLabel)}: -${totalTurnCost}/turn`,
  ];

  if (remaining > 0) {
    lines.push(
      '',
      `${Math.round(remaining)} ${t(HUD_TOOLTIP_I18N_KEYS.scoreRemainingToWin)}`,
    );
  } else {
    lines.push(
      '',
      t(HUD_TOOLTIP_I18N_KEYS.scoreThresholdMet),
    );
  }

  if (nextTier) {
    lines.push(
      '',
      `${t(HUD_TOOLTIP_I18N_KEYS.scoreNextTierLabel)}: ${nextTier.name} (requires Rep ≥ ${nextTier.reputationThreshold})`,
    );
  } else {
    lines.push(
      '',
      t(HUD_TOOLTIP_I18N_KEYS.scoreAllTiersUnlocked),
    );
  }

  return lines.join('\n');
}

/**
 * Builds the tooltip content string for the Actions HUD element.
 *
 * Explains the daily action budget: what spends an action, what is free,
 * and the banking mechanic (unused base actions carry over, capped at 2).
 * When action-granting staff are employed (`actionsPerTurn`, e.g. the
 * Manager, Director or General Manager), appends the staff action note
 * (staff actions are consumed first and never bank). (CG-0MT3IOPZB005LNAR)
 */
export function buildActionTooltip(state: MainStreetState): string {
  const remaining = state.actionsRemaining;
  const banked = state.bankedActions ?? 0;
  const staffActionBonus = (state.staffCards ?? []).reduce((sum, card) => sum + (card.actionsPerTurn ?? 0), 0);
  const lines = [
    t(HUD_TOOLTIP_I18N_KEYS.actionTitle),
    `${t(HUD_TOOLTIP_I18N_KEYS.actionRemainingLabel)}: ${remaining}`,
    `${t(HUD_TOOLTIP_I18N_KEYS.actionBankedLabel)}: ${banked}`,
    '',
    t(HUD_TOOLTIP_I18N_KEYS.actionConsumesLabel),
    t(HUD_TOOLTIP_I18N_KEYS.actionFreeOpsLabel),
    '',
    t(HUD_TOOLTIP_I18N_KEYS.actionBankingExplain),
  ];
  if (staffActionBonus > 0) {
    lines.push(t(HUD_TOOLTIP_I18N_KEYS.actionBankingGmNote));
  }
  return lines.join('\n');
}

/**
 * Builds the Community Favour tooltip for a direction (CG-0MUFAITED0088AGN).
 *
 * Shows the exact exchange rate (from `state.config`) and the once-per-turn
 * limit, plus the current gate/affordability status. All copy is i18n-sourced.
 */
export function buildFavourTooltip(
  state: MainStreetState,
  direction: 'coins-to-rep' | 'rep-to-coins',
): string {
  const isCoinsToRep = direction === 'coins-to-rep';
  const cost = isCoinsToRep
    ? state.config.favourCoinsToRepCost
    : state.config.favourRepToCoinsRepCost;
  const gain = isCoinsToRep ? 1 : state.config.favourRepToCoinsCoinGain;
  const resourceName = isCoinsToRep ? 'coins' : 'reputation';
  const resource = isCoinsToRep ? state.resourceBank.coins : state.resourceBank.reputation;

  const lines = [
    t(isCoinsToRep ? HUD_TOOLTIP_I18N_KEYS.favourCoinsToRepTitle : HUD_TOOLTIP_I18N_KEYS.favourRepToCoinsTitle),
    t(isCoinsToRep ? HUD_TOOLTIP_I18N_KEYS.favourCoinsToRepRate : HUD_TOOLTIP_I18N_KEYS.favourRepToCoinsRate, {
      cost,
      gain,
    }),
    t(HUD_TOOLTIP_I18N_KEYS.favourGate),
  ];

  if (state.favourUsedThisTurn) {
    lines.push(t(HUD_TOOLTIP_I18N_KEYS.favourUsedThisTurn));
  } else if (resource < cost) {
    lines.push(t(HUD_TOOLTIP_I18N_KEYS.favourInsufficient, { resource: resourceName, cost }));
  }

  return lines.join('\n');
}

/** Tooltip for the coins→reputation Community Favour button. */
export function buildCoinsToRepTooltip(state: MainStreetState): string {
  return buildFavourTooltip(state, 'coins-to-rep');
}

/** Tooltip for the reputation→coins Community Favour button. */
export function buildRepToCoinsTooltip(state: MainStreetState): string {
  return buildFavourTooltip(state, 'rep-to-coins');
}

// ── Market re-roll control (MS-0MUOSULQ700186PP) ─────────────

/**
 * Resolved label/tooltip/state for the market re-roll button.
 *
 * The button is the single affordance for both the Investor's free re-roll
 * and the paid Research action: when the free re-roll is available it reads
 * `Free re-roll (Investor)`, otherwise it reads `Research ({escalated cost})`
 * (wording matches the MS-0MTIS895Y008XGQ1 rename).
 */
export interface MarketRerollControlSpec {
  /** Button label — free-state or escalated paid cost. */
  readonly label: string;
  /** Full hover tooltip text (availability + 75% relevance bias / paid cost). */
  readonly tooltip: string;
  /** True when the Investor's free re-roll may be used right now. */
  readonly freeRerollAvailable: boolean;
  /** Current escalated paid Research cost (0 when the free re-roll is used). */
  readonly paidCost: number;
  /** True when either re-roll path is currently possible. */
  readonly enabled: boolean;
}

/**
 * Builds the market re-roll button spec (MS-0MUOSULQ700186PP AC1).
 *
 * Surfaces whether the Investor's free re-roll is still available this turn
 * and the relevance bias (default 75%) when it is. When it is not available
 * the label/tooltip fall back to the escalated paid Research cost so the
 * player always sees the coin price they will actually pay.
 */
export function buildMarketRerollControl(state: MainStreetState): MarketRerollControlSpec {
  const investor = getEmployedInvestorReroll(state);
  const freeRerollAvailable = canUseFreeMarketReroll(state).legal;
  const paidCost = refreshMarketCost(state);
  const paidAvailable = canRefreshMarket(state).legal;

  if (freeRerollAvailable && investor) {
    const biasPct = Math.round(investor.bias * 100);
    const types = investor.synergyTypes.length > 0 ? investor.synergyTypes.join('/') : 'none';
    const tooltip = [
      t(HUD_TOOLTIP_I18N_KEYS.marketRerollTitle),
      t(HUD_TOOLTIP_I18N_KEYS.marketRerollFreeBody, { bias: biasPct, types }),
      t(HUD_TOOLTIP_I18N_KEYS.marketRerollGate),
    ].join('\n');
    return {
      label: t(HUD_TOOLTIP_I18N_KEYS.marketRerollFreeLabel),
      tooltip,
      freeRerollAvailable: true,
      paidCost,
      enabled: true,
    };
  }

  const status = state.investorFreeRerollUsedThisTurn
    ? t(HUD_TOOLTIP_I18N_KEYS.marketRerollUsedBody)
    : investor
      ? ''
      : t(HUD_TOOLTIP_I18N_KEYS.marketRerollNoInvestorBody);
  const lines = [
    t(HUD_TOOLTIP_I18N_KEYS.marketRerollTitle),
    t(HUD_TOOLTIP_I18N_KEYS.marketRerollPaidBody, { cost: paidCost }),
    t(HUD_TOOLTIP_I18N_KEYS.marketRerollGate),
  ];
  if (status) lines.push(status);

  return {
    label: t(HUD_TOOLTIP_I18N_KEYS.marketRerollPaidLabel, { cost: paidCost }),
    tooltip: lines.join('\n'),
    freeRerollAvailable: false,
    paidCost,
    enabled: paidAvailable,
  };
}

// ── Move-staff affordance (MS-0MUOSULQ700186PP) ──────────────

/**
 * Resolved label/tooltip/state for the move-staff affordance.
 *
 * The 1-action-point cost is always surfaced (label + tooltip); `enabled`
 * additionally requires a targeted employed member, at least one legal
 * destination, and a remaining action.
 */
export interface MoveStaffAffordance {
  /** Button label, e.g. `Move staff (1 action)`. */
  readonly label: string;
  /** Full hover tooltip text (cost + legal destinations). */
  readonly tooltip: string;
  /** Action points charged for the relocation (always 1). */
  readonly actionCost: number;
  /** True when the targeted member can be relocated right now. */
  readonly enabled: boolean;
  /** The targeted employed staff id, or null when none can move. */
  readonly staffId: string | null;
  /** Legal destination street-grid slots for the targeted member. */
  readonly destinationSlots: readonly number[];
}

/**
 * Builds the move-staff affordance spec (MS-0MUOSULQ700186PP AC2).
 *
 * Relocation costs exactly 1 action point for every staff member; this helper
 * exposes that cost alongside the legal destination businesses so the UI can
 * present the affordance without re-deriving the rule. When `staffId` is
 * omitted the first employed member is targeted (the Manage-Card dialog
 * passes the member the player chose).
 *
 * @param state   Current game state (read-only).
 * @param staffId Optional employed member to target; defaults to the first.
 */
export function buildMoveStaffAffordance(
  state: MainStreetState,
  staffId?: string | null,
): MoveStaffAffordance {
  const actionCost = 1;
  const employed = (state.staffCards ?? []).filter(
    m => m.employedAtSlot !== undefined && m.employedAtSlot !== null,
  );
  const targetId = staffId ?? (employed.length > 0 ? employed[0].id : null);
  const target = targetId ? employed.find(m => m.id === targetId) ?? null : null;

  const destinationSlots: number[] = [];
  if (target) {
    for (let slot = 0; slot < state.streetGrid.length; slot++) {
      if (!state.streetGrid[slot]) continue;
      if ((state.soldSlots ?? [])[slot]) continue;
      if (canMoveStaffOnBusiness(state, target.id, slot).legal) destinationSlots.push(slot);
    }
  }

  const noActions = state.actionsRemaining <= 0;
  const lines = [
    t(HUD_TOOLTIP_I18N_KEYS.moveStaffTitle),
    t(HUD_TOOLTIP_I18N_KEYS.moveStaffBody, { cost: actionCost }),
  ];
  if (target) {
    const names = destinationSlots
      .map(slot => (state.streetGrid[slot] as { name?: string } | null)?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0);
    lines.push(
      names.length > 0
        ? t(HUD_TOOLTIP_I18N_KEYS.moveStaffDestinations, { names: names.join(', ') })
        : t(HUD_TOOLTIP_I18N_KEYS.moveStaffNoDestination),
    );
  } else {
    lines.push(t(HUD_TOOLTIP_I18N_KEYS.moveStaffNoStaff));
  }
  if (noActions) lines.push(t(HUD_TOOLTIP_I18N_KEYS.moveStaffNoActions));

  return {
    label: t(HUD_TOOLTIP_I18N_KEYS.moveStaffLabel, { cost: actionCost }),
    tooltip: lines.join('\n'),
    actionCost,
    enabled: !!target && !noActions && destinationSlots.length > 0,
    staffId: target?.id ?? null,
    destinationSlots,
  };
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Finds the next tier that is NOT yet unlocked.
 * Returns the tier definition, or undefined if all tiers are unlocked.
 */
export function findNextLockedTier(
  unlockedTiers: string[],
): { id: string; name: string; reputationThreshold: number } | undefined {
  const unlockedSet = new Set(unlockedTiers);
  for (const tier of ORDERED_TIER_DEFINITIONS) {
    if (!unlockedSet.has(tier.id)) {
      return {
        id: tier.id,
        name: tier.name,
        reputationThreshold: tier.reputationThreshold,
      };
    }
  }
  return undefined;
}