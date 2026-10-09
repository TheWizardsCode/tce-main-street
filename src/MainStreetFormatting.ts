/**
 * Main Street: Synergy Display Formatting
 *
 * Pure helpers for converting card synergy displays from absolute coin
 * values to difficulty-aware percentage multipliers.
 *
 * Main Street synergy is percentage-based (CG-0MRVCWNEQ009H52Z): each
 * business/community-space card has a `synergyCoinBonus` rate (default
 * 0.5 = 50% of base income) which the difficulty preset scales via
 * `synergyBonusPerNeighbor` (Easy 0.5 / Medium 0.35 / Hard 0.25, re-tuned by
 * CG-0MSP26Q5N002EH8P). This
 * module computes the effective rate for display and resolves the
 * `{SYNERGY_RATE}` token used in card descriptions.
 *
 * Reputation synergy (`synergyRepBonus`) is intentionally NOT handled
 * here — it remains an absolute-value system by design. Event-card
 * effects ("+100 coins per X business") are genuine `coinDelta` effects and
 * are never tokenized.
 *
 * @module
 */

import type { GameConfig } from './MainStreetDifficulty';
import type { AnyCard, BusinessCard, CommunitySpaceCard, StaffCard, SynergyType } from './MainStreetCards';
import type { GridDims } from './MainStreetAdjacencyGeometry';
import {
  effectiveSynergyCoinBonus,
  effectiveSynergyRepBonus,
  synergyCoinContributionPerNeighbor,
} from './MainStreetAdjacencyScoring';
import { getSkill } from './MainStreetStaffSkills';
import { formatCurrency } from '@core-engine/I18n';

/** Default per-card coin synergy rate when the CSV does not specify one. */
export const DEFAULT_SYNERGY_COIN_RATE = 0.5;

/** Token substituted with the effective synergy percentage in card descriptions. */
export const SYNERGY_RATE_TOKEN = '{SYNERGY_RATE}';

/** The card shape needed by the formatters (only the coin-synergy rate is read). */
export interface SynergyRateCard {
  readonly synergyCoinBonus?: number;
}

/** Difficulty subset needed by the formatters. */
export type SynergyFormatConfig = Pick<GameConfig, 'synergyBonusPerNeighbor'>;

/**
 * Computes the effective coin-synergy rate (as a decimal) for a card under
 * a difficulty config.
 *
 *   effectiveRate = synergyCoinBonus (default 0.5) × synergyBonusPerNeighbor
 *
 * Returns 0 for zero-synergy opt-out cards (e.g. Pawn Shop).
 *
 * @param card    The business or community-space card.
 * @param config  The active difficulty config.
 * @returns The effective rate as a decimal (0..1.5+).
 */
export function effectiveSynergyRate(
  card: SynergyRateCard,
  config: SynergyFormatConfig,
): number {
  const baseRate = card.synergyCoinBonus ?? DEFAULT_SYNERGY_COIN_RATE;
  const multiplier = config?.synergyBonusPerNeighbor ?? 1;
  return baseRate * multiplier;
}

/**
 * Formats the effective coin-synergy rate as a percentage string with up to
 * one decimal place (e.g. "50%", "75%", "37.5%").
 *
 * Returns `null` for zero-synergy opt-out cards — callers should show the
 * card's explicit opt-out text instead of a percentage.
 *
 * @param card    The business or community-space card.
 * @param config  The active difficulty config.
 * @returns The formatted percentage string, or null when the card opts out.
 */
export function formatSynergyRate(
  card: SynergyRateCard,
  config: SynergyFormatConfig,
): string | null {
  const rate = effectiveSynergyRate(card, config);
  if (rate === 0) return null;
  return `${formatPercent(rate)}%`;
}

/**
 * Rounds a decimal rate to a percentage with up to one decimal place and no
 * trailing ".0" (50 → "50", 37.5 → "37.5", 75 → "75").
 */
function formatPercent(rate: number): string {
  const oneDecimal = Math.round(rate * 1000) / 10;
  return Number.isInteger(oneDecimal) ? String(oneDecimal) : oneDecimal.toFixed(1);
}

/**
 * Options controlling `buildCardTooltipInfo()` output.
 */
export interface CardTooltipInfoOptions {
  /**
   * Include the coin/reputation detail lines for event cards (used by the
   * market-row tooltip). Hand-held event cards omit these lines.
   */
  includeEventDetail?: boolean;
  /**
   * Append the reason a card cannot be acted on right now (no daily actions
   * left) to the full card details. Additive by design: the complete card
   * tooltip is preserved (CG-0MT24RFIV007NQMP) and the blocking reason is
   * added alongside it (CG-0MT3IYSRL001VVUP).
   */
  noActionsRemaining?: boolean;
}

/**
 * Formats a coin/reputation delta value for tooltip display.
 *
 * Values are integers (e.g. `+5`, `-3`).
 *
 * This avoids the spurious `toFixed(3)` output (`5.000`) that previously
 * confused players alongside the per-match `effect` text on SpecificSynergy
 * event cards.
 *
 * @param value  The delta value (positive or negative).
 * @returns The formatted string with a sign prefix.
 */
export function formatTooltipDelta(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? '+' : ''}${rounded}`;
}

/**
 * Formats a per-turn reputation total with an explicit sign, e.g. `+5/turn`
 * or `-10/turn`, returning an empty string when the total is zero (no
 * reputation effect).
 *
 * Negative per-turn reputation is possible (Pawn Shop penalty,
 * CG-0MUAYBA0L000XLK3); earlier display code only surfaced positive values,
 * which hid the penalty from the player.
 *
 * @param totalReputation  The card's reputation-per-turn (including bonuses).
 * @returns The signed `/<turn>` suffix, or `''` when zero.
 */
export function formatPerTurnReputation(totalReputation: number): string {
  const rounded = Math.round(totalReputation);
  if (rounded === 0) return '';
  return `${rounded > 0 ? '+' : ''}${rounded}/turn`;
}

/**
 * Build the hover tooltip text for a Main Street card.
 *
 * All families render their cost line through `formatCurrency()` so the
 * currency symbol follows the active locale (e.g. `€` for `en`, `$` for
 * `en-US`) instead of a hardcoded symbol or raw number.
 *
 * Unknown card families return an empty string.
 *
 * @param card    The card to describe.
 * @param config  The active difficulty config (for synergy-rate resolution).
 * @param options  Optional per-call tweaks (event detail lines).
 * @returns The tooltip text (may be empty for unsupported families).
 */
export function buildCardTooltipInfo(
  card: AnyCard,
  config: SynergyFormatConfig,
  options: CardTooltipInfoOptions = {},
): string {
  switch (card.family) {
    case 'business': {
      const b = card;
      const bTotalRep = (b.reputationPerTurn ?? 0) + (b.reputationBonus ?? 0);
      const bRepSuffix = formatPerTurnReputation(bTotalRep);
      const bRepInfo = bRepSuffix !== '' ? `\nReputation: ${bRepSuffix}` : '';
      const bOngoingInfo = `\nOngoing cost: -${b.ongoingCost ?? 0}/turn`;
      return `Business: ${b.name}\nCost: ${formatCurrency(b.cost)}\nIncome: +${b.baseIncome + (b.incomeBonus || 0)}/turn${bOngoingInfo}${bRepInfo}\nSynergy: ${(b.synergyTypes || []).join('/')}\n${resolveDescription(b.description ?? '', b, config)}`;
    }
    case 'community-space': {
      const cs = card;
      const csTotalRep = (cs.reputationPerTurn ?? 0) + (cs.reputationBonus ?? 0);
      const csRepSuffix = formatPerTurnReputation(csTotalRep);
      const csRepInfo = csRepSuffix !== '' ? `\nReputation: ${csRepSuffix}` : '';
      const csOngoingInfo = `\nOngoing cost: -${cs.ongoingCost ?? 0}/turn`;
      return `Community Space: ${cs.name}\nCost: ${formatCurrency(cs.cost)}\nIncome: +${cs.baseIncome + (cs.incomeBonus || 0)}/turn${csOngoingInfo}${csRepInfo}\nSynergy: ${(cs.synergyTypes || []).join('/')}\n${resolveDescription(cs.description ?? '', cs, config)}`;
    }
    case 'event': {
      const e = card;
      // For SpecificSynergy events the raw coinDelta is a per-match value
      // (the engine multiplies it by the count of matching businesses).
      // Showing the raw delta alongside the per-match effect text is
      // confusing — players see "Coins: +5" even when there are zero
      // matching businesses on the street (effective gain = 0).  The
      // effect text already describes the per-match behaviour, so we
      // suppress the detail line for these events entirely.
      //
      // For 'All' and 'RandomBusiness' targets the delta is board-independent
      // and can be shown as a flat value.
      let detail = '';
      if (options.includeEventDetail && e.target !== 'SpecificSynergy') {
        // Percentage-based coin effects (e.g. the Tax Audit's `-0.45`) ignore
        // the flat `coinDelta`; render the applied percentage so the detail
        // line never contradicts the effect text.
        const coins = e.coinPercentDelta !== undefined
          ? `${e.coinPercentDelta < 0 ? '-' : '+'}${Math.round(Math.abs(e.coinPercentDelta) * 100)}%`
          : formatTooltipDelta(e.coinDelta);
        const rep = formatTooltipDelta(e.reputationDelta);
        detail = `\nCoins: ${coins}, Rep: ${rep}`;
      }
      return `Event: ${e.name}\nCost: ${formatCurrency(e.cost)}\nEffect: ${e.effect}${detail}`;
    }
    case 'upgrade': {
      const u = card;
      const noActions = options.noActionsRemaining ? '\nNo actions remaining this week — end your turn.' : '';
      // CG-0MT3IYSRL001VVUP: upgrades follow the business-card economy — the
      // market click moves the card to hand (1 action; same-week apply is a
      // free composite, a held apply costs 1 action); dragging it onto a
      // business buys-and-applies immediately at the +50% premium.
      return `Upgrade: ${u.name}\nCost: ${formatCurrency(u.cost)}\nClick: move to hand (1 action)\nDrag: buy & apply now (+50%)\nApplies to: ${u.targetBusiness}\nIncome Bonus: +${u.incomeBonus}\nRequires: Lv${u.requiredLevel ?? 0}\n${u.description ?? ''}${noActions}`;
    }
    case 'staff': {
      // Staff cards are hired directly from the general market row
      // (CG-0MT3KZOUX007GQ44): show hire-relevant info — cost, hand slots,
      // ongoing cost and the staff member's abilities.
      const st = card as StaffCard;
      const lines = [
        `Staff: ${st.name}`,
        `Cost: ${formatCurrency(st.cost)}`,
        `Hand slots: +${st.handSlotsAdded}`,
      ];
      lines.push(`Ongoing cost: -${st.ongoingCost ?? 0}/turn`);
      const stRepInfo = formatPerTurnReputation(st.reputationPerTurn ?? 0);
      if (stRepInfo !== '') lines.push(`Reputation: ${stRepInfo}`);
      if ((st.refreshCostDiscount ?? 0) > 0) lines.push(`Refresh discount: -${st.refreshCostDiscount} per refresh`);
      // Per-business upgrade discount (Financial Advisor, CG-0MTKMGL66004I0PC).
      if ((st.upgradeCostDiscount ?? 0) > 0) lines.push(`Upgrade discount: -${st.upgradeCostDiscount} per upgrade (this business)`);
      if ((st.taxAuditRate ?? 0) > 0) lines.push(`Tax Audit: losses reduced to ${Math.round((st.taxAuditRate ?? 0) * 100)}%`);
      if ((st.actionsPerTurn ?? 0) > 0) lines.push(`Actions: +${st.actionsPerTurn}/week`);
      if (st.peekOncePerTurn) lines.push('Ability: peek the incident deck once per turn');
      // Investor free market re-roll (MS-0MUOSULQ700186PP AC1): surface the
      // ability and the relevance bias (default 75%) on the applicant card.
      if (st.freeMarketRerollPerTurn) {
        const biasPct = Math.round((st.marketRelevanceBias ?? 0.75) * 100);
        lines.push(`Ability: free market re-roll once per turn (${biasPct}% relevance bias)`);
      }
      // Specialization skills (CG-0MT1CIWSD003VBPK): the applicant card's
      // locked skill set (1-3 skills incl. the Town Gossip baseline). Legacy
      // cards without specializationSkillIds show no skills line.
      const skillIds = Array.isArray(st.specializationSkillIds) ? st.specializationSkillIds : [];
      const skillNames: string[] = [];
      for (const id of skillIds) {
        try {
          skillNames.push(getSkill(id).name);
        } catch {
          // Unknown/stale id on a saved card — show nothing for it (forward-compat).
        }
      }
      if (skillNames.length > 0) lines.push(`Skills: ${skillNames.join(', ')}`);
      if (st.description) lines.push(st.description);
      return lines.join('\n');
    }
    default:
      // Staff cards (and any future unknown families) show no tooltip text.
      return '';
  }
}

/**
 * Renders the employed-staff enumeration for a business/community-space slot
 * tooltip (CG-0MU3BTTCH001E7ZD AC2/AC3): each staff member's name, the
 * business types they serve (or "Generalist"), and their effect/ability
 * description. Returns null when no staff are employed (empty state — AC5:
 * the tooltip keeps showing only the business's own info).
 *
 * Staff carrying the Investor's free market re-roll ability additionally
 * surface whether the free re-roll is still available this turn and the
 * relevance bias (default 75%) — MS-0MUOSULQ700186PP AC1. The caller passes
 * the state's once-per-turn flag through `options`.
 *
 * @param staff   The staff members employed at the slot.
 * @param options Optional state context (free-reroll availability).
 * @returns A \n-prefixed bulleted section, or null when empty.
 */
export function formatEmployedStaffSummary(
  staff: readonly StaffCard[],
  options?: { freeRerollUsedThisTurn?: boolean },
): string | null {
  if (!Array.isArray(staff) || staff.length === 0) return null;
  const lines = staff.map((member) => {
    const types =
      Array.isArray(member.allowedBusinessTypes) && member.allowedBusinessTypes.length > 0
        ? member.allowedBusinessTypes.join('/')
        : 'Generalist';
    const effect = member.description ? ` — ${member.description}` : '';
    // Investor free re-roll (MS-0MUOSULQ700186PP AC1): surface availability
    // this turn plus the relevance bias alongside the member's own effect.
    const reroll = member.freeMarketRerollPerTurn
      ? ` — free re-roll ${options?.freeRerollUsedThisTurn ? 'used' : 'available'} this turn (${Math.round((member.marketRelevanceBias ?? 0.75) * 100)}% relevance bias)`
      : '';
    return `• ${member.name} (${types})${effect}${reroll}`;
  });
  return `\nEmployed staff (${staff.length}):\n${lines.join('\n')}`;
}

/**
 * Resolves a card description template by substituting the `{SYNERGY_RATE}`
 * token with the card's effective percentage for the active difficulty.
 *
 * Descriptions without the token pass through unchanged (event-card effects,
 * upgrade cards, zero-synergy opt-out text, flavour text).
 *
 * @param desc    The raw description (may contain the {SYNERGY_RATE} token).
 * @param card    The business or community-space card the description belongs to.
 * @param config  The active difficulty config.
 * @returns The description with the token resolved (or unchanged).
 */
export function resolveDescription(
  desc: string,
  card: SynergyRateCard,
  config: SynergyFormatConfig,
): string {
  if (!desc.includes(SYNERGY_RATE_TOKEN)) return desc;
  const rate = formatSynergyRate(card, config);
  if (rate === null) {
    // Defensive: a tokenized template on an opt-out card would otherwise show
    // a bare "{SYNERGY_RATE}". Drop the token rather than displaying it.
    return desc.replace(/\{SYNERGY_RATE\}/g, '').replace(/\s{2,}/g, ' ').trim();
  }
  return desc.replace(/\{SYNERGY_RATE\}/g, rate);
}

/**
 * Builds the hover tooltip text for one persistent synergy link between two
 * adjacent cards (CG-... synergy-line tooltip).
 *
 * The tooltip names the shared synergy type and states, for EACH endpoint, the
 * per-turn coin and/or reputation effect of that single link under the active
 * difficulty multiplier (`config.synergyBonusPerNeighbor`):
 *
 * ```
 * Food synergy
 * Bakery  ⟷  Diner
 * Bakery: +2 coins/turn, +5 rep/turn from this link
 * Diner: +0.8 coins/turn from this link
 * ```
 *
 * **Per-link share, not the card total.** The coin value shown is the marginal
 * contribution of the ONE link (the card's own rate × effective base × the
 * difficulty multiplier), matching the engine's per-neighbour share in
 * `synergyCoinContributionPerNeighbor()`. `computeSynergyBonus()` rounds only
 * the TOTAL across all matching neighbours, so a per-link share may not sum
 * exactly to the card's displayed synergy total; the value is therefore
 * formatted to at most one decimal and the doc comment records that it is an
 * approximation (risk noted in the intake brief).
 *
 * **Reputation direction.** Reputation synergy flows FROM the neighbour: a card
 * gains `neighbour.synergyRepBonus` from the link (see
 * `computeSynergyRepBonus`), so each endpoint's rep line reflects the OTHER
 * card's `synergyRepBonus`.
 *
 * **Sold endpoints** earn nothing from the link themselves but still anchor the
 * synergy for the other card (CG-0MT5XUE2200047IJ); their line says so.
 *
 * Returns an empty string when either endpoint is missing or opts out of the
 * synergy system entirely (`synergyCoinBonus === 0` AND `synergyRepBonus === 0`,
 * e.g. the Pawn Shop) — callers should not show a tooltip in that case.
 *
 * Pure (no Phaser/scene dependency) so it can be unit-tested headless.
 *
 * @param grid           The street grid.
 * @param fromIndex      Lower slot index of the pair.
 * @param toIndex        Higher slot index of the pair.
 * @param sharedSynergy  The synergy type shared by the pair (line colour source).
 * @param config         Active difficulty config (for the coin multiplier).
 * @param soldSlots      Sold-slot flags.
 * @param gridDims       Optional grid dimensions for expanded lattices.
 * @returns The tooltip text, or `''` when no tooltip should be shown.
 */
export function buildSynergyLinkTooltipInfo(
  grid: (BusinessCard | CommunitySpaceCard | null)[],
  fromIndex: number,
  toIndex: number,
  sharedSynergy: SynergyType,
  config: SynergyFormatConfig,
  soldSlots: boolean[] = [],
  gridDims?: GridDims,
): string {
  const from = grid[fromIndex];
  const to = grid[toIndex];
  if (!from || !to) return '';

  // Zero-synergy opt-out (e.g. Pawn Shop): neither endpoint participates in
  // the synergy system, so there is no link effect to explain.
  if (isZeroSynergyCard(from) || isZeroSynergyCard(to)) return '';

  const fromSold = soldSlots[fromIndex] === true;
  const toSold = soldSlots[toIndex] === true;

  return [
    `${sharedSynergy} synergy`,
    `${from.name}  ⟷  ${to.name}`,
    synergyEndpointLine(from, fromIndex, to, fromSold, config, grid, soldSlots, gridDims),
    synergyEndpointLine(to, toIndex, from, toSold, config, grid, soldSlots, gridDims),
  ].join('\n');
}

/** True when a card opts out of the synergy system entirely. */
function isZeroSynergyCard(card: BusinessCard | CommunitySpaceCard): boolean {
  return effectiveSynergyCoinBonus(card) === 0 && effectiveSynergyRepBonus(card) === 0;
}

/**
 * One endpoint's line in a synergy-link tooltip: the per-link coin and/or
 * reputation it gains, or the sold-endpoint anchor wording.
 */
function synergyEndpointLine(
  card: BusinessCard | CommunitySpaceCard,
  index: number,
  neighbour: BusinessCard | CommunitySpaceCard,
  sold: boolean,
  config: SynergyFormatConfig,
  grid: (BusinessCard | CommunitySpaceCard | null)[],
  soldSlots: boolean[],
  gridDims?: GridDims,
): string {
  if (sold) {
    return `${card.name} (sold): earns nothing, but still anchors this synergy`;
  }

  const coins = synergyCoinContributionPerNeighbor(
    grid,
    index,
    config?.synergyBonusPerNeighbor ?? 1,
    soldSlots,
    gridDims,
  );
  // Reputation synergy flows from the neighbour to this card.
  const rep = effectiveSynergyRepBonus(neighbour);

  const parts: string[] = [];
  if (coins > 0) parts.push(`+${formatShareAmount(coins)} coins/turn`);
  if (rep > 0) parts.push(`+${formatShareAmount(rep)} rep/turn`);
  if (parts.length === 0) {
    return `${card.name}: no per-turn gain from this link`;
  }
  return `${card.name}: ${parts.join(', ')} from this link`;
}

/**
 * Formats a per-link coin/reputation share to at most one decimal place, with
 * no trailing ".0" (`2` → "2", `1.05` → "1.1", `0.25` → "0.3").
 */
function formatShareAmount(value: number): string {
  const oneDecimal = Math.round(value * 10) / 10;
  return Number.isInteger(oneDecimal) ? String(oneDecimal) : oneDecimal.toFixed(1);
}

/**
 * Renders the turn instruction label (CG-0MSLXJCHH001DLIO).
 *
 * - Unlimited config (no `config.maxTurns`): `Turn N`
 * - Limited config (explicit `config.maxTurns`): `Turn N / M`
 *
 * Default presets impose no turn limit, so the label shows only the current
 * turn unless a limit is explicitly configured.
 *
 * @param config  The active difficulty config (maxTurns optional).
 * @param turn    The current 1-based turn number.
 * @returns The turn label, e.g. `Turn 3` or `Turn 3 / 20`.
 */
export function turnLabel(config: Pick<GameConfig, 'maxTurns'>, turn: number): string {
  return config.maxTurns !== undefined
    ? `Turn ${turn} / ${config.maxTurns}`
    : `Turn ${turn}`;
}

/**
 * Renders the calendar label: `Week W · Year Y`.
 *
 * Used in the HUD strip and tutorial text to surface the current week and
 * year instead of the opaque turn count. Each turn represents one week
 * (CG-0MTT0K9RX0004QTE).
 *
 * @param week  The current game week (1–52).
 * @param year  The current game year (≥1).
 * @returns The formatted label, e.g. `Week 12 · Year 3`.
 */
export function weekLabel(week: number, year: number): string {
  return `Week ${week} · Year ${year}`;
}

/**
 * The synergy-anchor line shown for a sold business/community-space card
 * (CG-0MTFS4PP40064GHE). A sold card earns no income of its own but remains
 * a synergy anchor for adjacent businesses, so the copy must never claim
 * that synergy stops.
 */
export const SOLD_CARD_TOOLTIP_SYNERGY_LINE =
  'This card no longer produces income, but still provides synergy to adjacent businesses.';

/**
 * Builds the tooltip shown when hovering a sold business/community-space
 * slot (CG-0MTFS4PP40064GHE). Phaser-free so the sold-card copy can be
 * asserted directly by tests rather than by grepping the renderer source.
 *
 * @param card  The sold card (only its `name` is read).
 * @returns The multi-line sold-card tooltip string.
 */
export function formatSoldCardTooltip(card: Pick<AnyCard, 'name'>): string {
  return `Sold: ${card.name}\n${SOLD_CARD_TOOLTIP_SYNERGY_LINE}`;
}
