/**
 * MainStreetTurnSummaryTooltips — Tooltip content builders and i18n keys for the
 * end-of-turn ledger (Turn Summary P&L statement).
 *
 * Provides localisable string keys and builder functions for the tooltip content
 * shown when hovering/tapping each P&L line in the Turn Summary panel.
 *
 * ## Design rationale
 *
 * The Turn Summary dialog renders a profit/loss statement whose rows show a
 * label and a signed coin figure. This module builds the per-line tooltip
 * strings from the Turn Summary projection (`PLProjection` plus its per-item
 * `breakdown` data), so the overlay can attach `attachHudTooltipZone` to each
 * rendered row without inventing figures: every number here either comes from
 * the committed ledger or is the engine's own per-card charge threaded through
 * the model.
 *
 * ## i18n integration
 *
 * Every user-facing string is looked up via the core-engine `t()` function
 * which resolves the active locale bundle and falls back to English defaults.
 * English defaults are registered at module-load time so they are always
 * available, even without an explicit locale setup.
 *
 * ## One-off fallback (documented choice)
 *
 * The ledger stores one-off only as a residual
 * (`netCoinChange - incomeCoins - ongoingTotal - incidentCoinChange`), with no
 * per-source breakdown stored. Where per-source data is unavailable the tooltip
 * presents the reconciliation formula that produces the value — the documented
 * fallback permitted by parent AC7:
 * `one-off = net - (income + expenses + incident)`.
 *
 * @module
 */

import { t, registerLocale } from '@core-engine/I18n';
import type {
  PLAdjustmentLine,
  PLProjection,
  PLStatementLine,
  PLSupplementaryContext,
} from './MainStreetTurnSummary';

/** The supplementary context rows the ledger renders (excludes the `tooltips` map). */
export type PLSupplementaryContextKey =
  | 'reputationChange'
  | 'scoreChange'
  | 'closingCoins'
  | 'businessesOwned';

// ── i18n Keys ───────────────────────────────────────────────

/** The set of i18n keys used by ledger-tooltip content. */
export const LEDGER_TOOLTIP_I18N_KEYS = {
  // Generic per-line headings/notes
  incomeNote: 'ledger.tooltip.income.note',
  incomePerBusiness: 'ledger.tooltip.income.perBusiness',
  expensesNote: 'ledger.tooltip.expenses.note',
  expensesPerItem: 'ledger.tooltip.expenses.perItem',
  reductionLine: 'ledger.tooltip.expenses.reduction',
  clampLine: 'ledger.tooltip.expenses.clamp',
  totalLine: 'ledger.tooltip.total',
  // Incident/one-off/net
  incidentTitle: 'ledger.tooltip.incident.title',
  incidentNoEvent: 'ledger.tooltip.incident.noEvent',
  incidentEffect: 'ledger.tooltip.incident.effect',
  oneOffTitle: 'ledger.tooltip.oneOff.title',
  oneOffFormula: 'ledger.tooltip.oneOff.formula',
  netTitle: 'ledger.tooltip.net.title',
  netFormula: 'ledger.tooltip.net.formula',
  // Supplementary context
  repChangeTitle: 'ledger.tooltip.repChange.title',
  repChangeBody: 'ledger.tooltip.repChange.body',
  scoreChangeTitle: 'ledger.tooltip.scoreChange.title',
  scoreChangeBody: 'ledger.tooltip.scoreChange.body',
  closingCoinsTitle: 'ledger.tooltip.closingCoins.title',
  closingCoinsBody: 'ledger.tooltip.closingCoins.body',
  businessesOwnedTitle: 'ledger.tooltip.businessesOwned.title',
  businessesOwnedBody: 'ledger.tooltip.businessesOwned.body',
} as const;

// ── Default English strings (registered as the 'en' locale bundle) ──

/** Default English string templates for ledger tooltips. */
export const LEDGER_TOOLTIP_STRINGS = {
  incomeNote: 'Business income — how each owned business contributes.',
  incomePerBusiness: 'Per business: {breakdown}',
  expensesNote: 'Operating expenses — what each item costs you.',
  expensesPerItem: 'Per item: {breakdown}',
  reductionLine: 'Street-wide reduction: {amount}',
  clampLine: 'Limited by available coins: {amount}',
  totalLine: 'Total: {amount}',
  incidentTitle: 'Incident',
  incidentNoEvent: 'No incident was resolved this turn.',
  incidentEffect: '{name}: Coins {coins}, Rep {reputation}',
  oneOffTitle: 'One-off',
  oneOffFormula:
    'One-off = net change ({net}) − income ({income}) − expenses ({expenses}) − incident ({incident}) = {oneOff}',
  netTitle: 'Net profit/loss',
  netFormula:
    'Net = income ({income}) + expenses ({expenses}) + incident ({incident}) + one-off ({oneOff}) = {net}',
  repChangeTitle: 'Reputation change',
  repChangeBody: 'The day’s net reputation change, after income, incidents and one-offs.',
  scoreChangeTitle: 'Score change',
  scoreChangeBody: 'The change in your final score this day (coins + reputation + challenges).',
  closingCoinsTitle: 'Closing coins',
  closingCoinsBody: 'Your coin balance at the end of the day (day start + net change).',
  businessesOwnedTitle: 'Businesses owned',
  businessesOwnedBody: 'Businesses standing on the street at closing (sold slots excluded).',
} as const;

// ── Register the English locale bundle ──────────────────────

const enBundle: Record<string, string> = {};
for (const [k, v] of Object.entries(LEDGER_TOOLTIP_STRINGS)) {
  enBundle[LEDGER_TOOLTIP_I18N_KEYS[k as keyof typeof LEDGER_TOOLTIP_STRINGS]] = v;
}
registerLocale('en', enBundle);

// ── Formatting helpers ──────────────────────────────────────

/** Formats a signed integer as `+N` / `-N` / `0`. */
function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** Sums a list of numbers. */
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Renders a per-item breakdown as `Name: +N, Name: -M`.
 *
 * Items are shown with their signed coin contribution, matching the row's own
 * signed convention (income positive, costs negative).
 */
function formatBreakdown(items: readonly { name: string; coins: number }[]): string {
  return items.map((item) => `${item.name}: ${formatSigned(item.coins)}`).join(', ');
}

// ── Line tooltip builders ───────────────────────────────────

/**
 * Builds the tooltip for one income line (base / synergy / reputation / events).
 *
 * When the line carries a per-business breakdown the tooltip names each business
 * and its coin contribution; otherwise it explains the line generically.
 *
 * @param line The income statement line.
 */
export function buildIncomeLineTooltip(line: PLStatementLine): string {
  const lines: string[] = [`${line.label}: ${formatSigned(line.coins)}`];
  if (line.breakdown && line.breakdown.items.length > 0) {
    lines.push(t(LEDGER_TOOLTIP_I18N_KEYS.incomePerBusiness, {
      breakdown: formatBreakdown(line.breakdown.items),
    }));
  } else {
    lines.push(t(LEDGER_TOOLTIP_I18N_KEYS.incomeNote));
  }
  return lines.join('\n');
}

/**
 * Builds the tooltip for one ongoing-expense line (staff / community /
 * business).
 *
 * Lists each card's base charge, then reconciles to the committed category
 * total: a street-wide Cost Cutter reduction is shown separately, and a
 * coin-limited shortfall (the engine clamps each family to the coins
 * available) is shown as a reconciling note. `sum(items) + reduction + clamp`
 * therefore equals the row's committed total.
 *
 * @param line The expense statement line.
 */
export function buildExpenseLineTooltip(line: PLStatementLine): string {
  const lines: string[] = [`${line.label}: ${formatSigned(line.coins)}`];
  const items = line.breakdown?.items ?? [];
  if (items.length === 0) {
    lines.push(t(LEDGER_TOOLTIP_I18N_KEYS.expensesNote));
    return lines.join('\n');
  }

  lines.push(t(LEDGER_TOOLTIP_I18N_KEYS.expensesPerItem, {
    breakdown: formatBreakdown(items),
  }));

  // Reconcile the base per-card sum to the committed total.
  // Both the Cost Cutter reduction and any coins-clamp raise the signed total
  // toward zero, so they are shown as positive reconciling adjustments.
  const baseTotal = sum(items.map((item) => item.coins));
  const adjustment = line.coins - baseTotal;
  const streetReduction = line.breakdown?.streetReduction ?? 0;
  if (streetReduction > 0) {
    lines.push(t(LEDGER_TOOLTIP_I18N_KEYS.reductionLine, {
      amount: formatSigned(streetReduction),
    }));
  }
  const clampShortfall = adjustment - streetReduction;
  if (clampShortfall > 0) {
    // The engine clamps each family to the coins available, so the committed
    // charge can be smaller than the reduced cost.
    lines.push(t(LEDGER_TOOLTIP_I18N_KEYS.clampLine, {
      amount: formatSigned(clampShortfall),
    }));
  }

  lines.push(t(LEDGER_TOOLTIP_I18N_KEYS.totalLine, {
    amount: formatSigned(line.coins),
  }));
  return lines.join('\n');
}

/**
 * Builds the tooltip for the Incident adjustment row.
 *
 * Shows the resolved incident's name and its coin/reputation effect; falls back
 * to a "no incident" note when the closing resolved none.
 *
 * @param incident     The incident adjustment line (committed deltas).
 * @param incidentName The resolved incident card name, or `null`.
 */
export function buildIncidentLineTooltip(
  incident: PLAdjustmentLine,
  incidentName: string | null,
): string {
  if (!incidentName) {
    return [t(LEDGER_TOOLTIP_I18N_KEYS.incidentTitle), t(LEDGER_TOOLTIP_I18N_KEYS.incidentNoEvent)]
      .join('\n');
  }
  return [
    t(LEDGER_TOOLTIP_I18N_KEYS.incidentTitle),
    t(LEDGER_TOOLTIP_I18N_KEYS.incidentEffect, {
      name: incidentName,
      coins: formatSigned(incident.coins),
      reputation: formatSigned(incident.reputation),
    }),
  ].join('\n');
}

/**
 * Builds the tooltip for the One-off adjustment row.
 *
 * The ledger stores no per-source breakdown, so this presents the documented
 * reconciliation formula that produces the residual (parent AC7).
 *
 * @param projection The player's P&L projection.
 */
export function buildOneOffLineTooltip(projection: PLProjection): string {
  return [
    t(LEDGER_TOOLTIP_I18N_KEYS.oneOffTitle),
    t(LEDGER_TOOLTIP_I18N_KEYS.oneOffFormula, {
      net: formatSigned(projection.net.coins),
      income: formatSigned(projection.income.total),
      expenses: formatSigned(projection.expenses.total),
      incident: formatSigned(projection.incident.coins),
      oneOff: formatSigned(projection.oneOff.coins),
    }),
  ].join('\n');
}

/**
 * Builds the tooltip for the Net profit/loss bottom line.
 *
 * Explains the reconciliation identity:
 * `income + expenses + incident + one-off = net`.
 *
 * @param projection The player's P&L projection.
 */
export function buildNetLineTooltip(projection: PLProjection): string {
  return [
    t(LEDGER_TOOLTIP_I18N_KEYS.netTitle),
    t(LEDGER_TOOLTIP_I18N_KEYS.netFormula, {
      income: formatSigned(projection.income.total),
      expenses: formatSigned(projection.expenses.total),
      incident: formatSigned(projection.incident.coins),
      oneOff: formatSigned(projection.oneOff.coins),
      net: formatSigned(projection.net.coins),
    }),
  ].join('\n');
}

/**
 * Builds the tooltip for a supplementary context row.
 *
 * @param key        The context row key.
 * @param _context   The projection's context figures (reserved for future
 *                   derivation detail; kept in the signature so callers pass
 *                   the same projection the row renders).
 */
export function buildContextLineTooltip(
  key: PLSupplementaryContextKey,
  _context: PLSupplementaryContext,
): string {
  switch (key) {
    case 'reputationChange':
      return [t(LEDGER_TOOLTIP_I18N_KEYS.repChangeTitle), t(LEDGER_TOOLTIP_I18N_KEYS.repChangeBody)]
        .join('\n');
    case 'scoreChange':
      return [t(LEDGER_TOOLTIP_I18N_KEYS.scoreChangeTitle), t(LEDGER_TOOLTIP_I18N_KEYS.scoreChangeBody)]
        .join('\n');
    case 'closingCoins':
      return [t(LEDGER_TOOLTIP_I18N_KEYS.closingCoinsTitle), t(LEDGER_TOOLTIP_I18N_KEYS.closingCoinsBody)]
        .join('\n');
    case 'businessesOwned':
      return [
        t(LEDGER_TOOLTIP_I18N_KEYS.businessesOwnedTitle),
        t(LEDGER_TOOLTIP_I18N_KEYS.businessesOwnedBody),
      ].join('\n');
    default:
      return String(key);
  }
}
