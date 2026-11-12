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
  PLStatementSection,
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
  expensesNote: 'ledger.tooltip.expenses.note',
  // Multi-line per-item layout
  itemLine: 'ledger.tooltip.item.line',
  itemBase: 'ledger.tooltip.item.base',
  itemModifier: 'ledger.tooltip.item.modifier',
  itemEffect: 'ledger.tooltip.item.effect',
  reductionLine: 'ledger.tooltip.expenses.reduction',
  clampLine: 'ledger.tooltip.expenses.clamp',
  totalLine: 'ledger.tooltip.total',
  totalLineNote: 'ledger.tooltip.total.note',
  // Incident/one-off/net
  incidentTitle: 'ledger.tooltip.incident.title',
  incidentNoEvent: 'ledger.tooltip.incident.noEvent',
  incidentEffect: 'ledger.tooltip.incident.effect',
  incidentBase: 'ledger.tooltip.incident.base',
  incidentModifier: 'ledger.tooltip.incident.modifier',
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
  closingDayStart: 'ledger.tooltip.closingCoins.dayStart',
  closingNetChange: 'ledger.tooltip.closingCoins.netChange',
  closingClosing: 'ledger.tooltip.closingCoins.closing',
  businessesOwnedTitle: 'ledger.tooltip.businessesOwned.title',
  businessesOwnedBody: 'ledger.tooltip.businessesOwned.body',
  repIncome: 'ledger.tooltip.repChange.income',
  repIncident: 'ledger.tooltip.repChange.incident',
  repOneOff: 'ledger.tooltip.repChange.oneOff',
  repTotal: 'ledger.tooltip.repChange.total',
} as const;

// ── Default English strings (registered as the 'en' locale bundle) ──

/** Default English string templates for ledger tooltips. */
export const LEDGER_TOOLTIP_STRINGS = {
  incomeNote: 'Business income — how each owned business contributes.',
  expensesNote: 'Operating expenses — what each item costs you.',
  itemLine: '{name}: {amount}',
  itemBase: '  Base: {amount}',
  itemModifier: '  {name}: {amount}',
  itemEffect: '  {name}: {amount}',
  reductionLine: 'Street-wide reduction: {amount}',
  clampLine: 'Limited by available coins: {amount}',
  totalLine: 'Total: {amount}',
  totalLineNote: 'The sum of the lines above.',
  incidentTitle: 'Incident',
  incidentNoEvent: 'No incident was resolved this turn.',
  incidentEffect: '{name}: Coins {coins}, Rep {reputation}',
  incidentBase: 'Base: Coins {coins}, Rep {reputation}',
  incidentModifier: '{name}: Coins {coins}, Rep {reputation}',
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
  closingDayStart: 'Day start: {amount}',
  closingNetChange: 'Net change: {amount}',
  closingClosing: 'Closing: {amount}',
  businessesOwnedTitle: 'Businesses owned',
  businessesOwnedBody: 'Businesses standing on the street at closing (sold slots excluded).',
  repIncome: 'Income: {amount}',
  repIncident: 'Incident: {amount}',
  repOneOff: 'One-off: {amount}',
  repTotal: 'Total: {amount}',
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
 * Renders one top-level breakdown item as `Name: signed amount`.
 *
 * One item per line: the comma-joined summary this module used previously has
 * been replaced with a multi-line layout so every contributing item is visible
 * on its own line (MS-0MWC90TUH007CC8T). Amounts are signed in the row's own
 * convention (income positive, costs negative).
 */
function formatItemLine(name: string, coins: number): string {
  return t(LEDGER_TOOLTIP_I18N_KEYS.itemLine, { name, amount: formatSigned(coins) });
}

/** Renders an indented `Base: signed amount` line beneath an item. */
function formatItemBase(base: number): string {
  return t(LEDGER_TOOLTIP_I18N_KEYS.itemBase, { amount: formatSigned(base) });
}

/** Renders an indented `Name: signed amount` modifier line beneath an item. */
function formatItemModifier(name: string, coins: number): string {
  return t(LEDGER_TOOLTIP_I18N_KEYS.itemModifier, { name, amount: formatSigned(coins) });
}

/** Renders an indented `Name: signed delta` event-effect line beneath its business. */
function formatItemEffect(name: string, delta: number): string {
  return t(LEDGER_TOOLTIP_I18N_KEYS.itemEffect, { name, amount: formatSigned(delta) });
}

// ── Line tooltip builders ───────────────────────────────────

/**
 * Builds the tooltip for one income line (base / synergy / reputation / events).
 *
 * The line's committed amount is followed by **one contributing business per
 * line**, each with its signed coin contribution. The Events row additionally
 * lists each committed event effect as an indented line beneath its business,
 * so the tooltip names every effect rather than only the per-business sum.
 *
 * When the line carries no per-item breakdown the tooltip degrades to the
 * committed total plus a generic explanatory note (absent-safe).
 *
 * @param line The income statement line.
 */
export function buildIncomeLineTooltip(line: PLStatementLine): string {
  const lines: string[] = [`${line.label}: ${formatSigned(line.coins)}`];
  const items = line.breakdown?.items ?? [];
  if (items.length === 0) {
    lines.push(t(LEDGER_TOOLTIP_I18N_KEYS.incomeNote));
    return lines.join('\n');
  }

  for (const item of items) {
    lines.push(formatItemLine(item.name, item.coins));
    for (const effect of item.effects ?? []) {
      lines.push(formatItemEffect(effect.name, effect.delta));
    }
  }
  return lines.join('\n');
}

/**
 * Builds the tooltip for one ongoing-expense line (staff / community /
 * business).
 *
 * Lists **one contributing item per line** with its committed signed charge.
 * A staff item that carries modifiers additionally explains its charge as
 * `Base:` plus every named modifier on an indented line (e.g. the Operations
 * Manager salary discount), so `base + sum(modifiers)` reconciles to the item's
 * charge.
 *
 * The item lines are then reconciled to the committed category total: a
 * street-wide Cost Cutter reduction is shown separately, and a coin-limited
 * shortfall (the engine clamps each family to the coins available) is shown as
 * a reconciling note. `sum(items) + reduction + clamp` therefore equals the
 * row's committed total.
 *
 * A line with no per-item breakdown degrades to the committed total plus a
 * generic explanatory note (absent-safe).
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

  for (const item of items) {
    lines.push(formatItemLine(item.name, item.coins));
    const modifiers = item.modifiers ?? [];
    if (modifiers.length === 0) continue;
    if (item.base !== undefined) lines.push(formatItemBase(item.base));
    for (const modifier of modifiers) {
      lines.push(formatItemModifier(modifier.name, modifier.coins));
    }
  }

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
 * Builds a tooltip for a section total row (`Total income` /
 * `Total operating expenses`).
 *
 * The total is the committed subtotal (never a re-sum of the displayed lines).
 * Every contributing line is then enumerated with its signed amount, so the
 * tooltip shows the arithmetic instead of the generic "sum of the lines" note.
 *
 * @param section The statement section whose total row this annotates.
 */
export function buildTotalLineTooltip(section: PLStatementSection): string {
  const lines: string[] = [
    `${section.totalLabel}: ${formatSigned(section.total)}`,
  ];
  if (section.lines.length === 0) {
    lines.push(t(LEDGER_TOOLTIP_I18N_KEYS.totalLineNote));
    return lines.join('\n');
  }
  for (const line of section.lines) {
    lines.push(`${line.label}: ${formatSigned(line.coins)}`);
  }
  return lines.join('\n');
}

/**
 * Builds the tooltip for the Incident adjustment row.
 *
 * Shows the resolved incident's name and its committed coin/reputation effect,
 * then — when the model carries a reconciling `detail` — the incident's base
 * effect and every named modifier applied to it, so the committed deltas are
 * reproducible. Falls back to a "no incident" note when the closing resolved
 * none.
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
  const lines: string[] = [
    t(LEDGER_TOOLTIP_I18N_KEYS.incidentTitle),
    t(LEDGER_TOOLTIP_I18N_KEYS.incidentEffect, {
      name: incidentName,
      coins: formatSigned(incident.coins),
      reputation: formatSigned(incident.reputation),
    }),
  ];
  const detail = incident.detail;
  if (detail) {
    lines.push(t(LEDGER_TOOLTIP_I18N_KEYS.incidentBase, {
      coins: formatSigned(detail.base.coins),
      reputation: formatSigned(detail.base.reputation),
    }));
    for (const modifier of detail.modifiers) {
      lines.push(t(LEDGER_TOOLTIP_I18N_KEYS.incidentModifier, {
        name: modifier.name,
        coins: formatSigned(modifier.coins),
        reputation: formatSigned(modifier.reputation),
      }));
    }
  }
  return lines.join('\n');
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
 * Renders the numeric derivation when the projection carries it
 * (closing coins as day start + net change, reputation change as its income /
 * incident / one-off constituents, businesses owned by name) and otherwise
 * keeps the existing explanatory prose (absent-safe). Score change always keeps
 * its prose because the projection carries no challenge-level detail.
 *
 * @param key      The context row key.
 * @param context  The projection's context figures.
 */
export function buildContextLineTooltip(
  key: PLSupplementaryContextKey,
  context: PLSupplementaryContext,
): string {
  switch (key) {
    case 'reputationChange': {
      const parts = context.reputationParts;
      if (!parts) {
        return [t(LEDGER_TOOLTIP_I18N_KEYS.repChangeTitle), t(LEDGER_TOOLTIP_I18N_KEYS.repChangeBody)]
          .join('\n');
      }
      return [
        t(LEDGER_TOOLTIP_I18N_KEYS.repChangeTitle),
        t(LEDGER_TOOLTIP_I18N_KEYS.repIncome, { amount: formatSigned(parts.income) }),
        t(LEDGER_TOOLTIP_I18N_KEYS.repIncident, { amount: formatSigned(parts.incident) }),
        t(LEDGER_TOOLTIP_I18N_KEYS.repOneOff, { amount: formatSigned(parts.oneOff) }),
        t(LEDGER_TOOLTIP_I18N_KEYS.repTotal, { amount: formatSigned(context.reputationChange) }),
      ].join('\n');
    }
    case 'scoreChange':
      return [t(LEDGER_TOOLTIP_I18N_KEYS.scoreChangeTitle), t(LEDGER_TOOLTIP_I18N_KEYS.scoreChangeBody)]
        .join('\n');
    case 'closingCoins': {
      if (context.dayStartCoins === undefined) {
        return [t(LEDGER_TOOLTIP_I18N_KEYS.closingCoinsTitle), t(LEDGER_TOOLTIP_I18N_KEYS.closingCoinsBody)]
          .join('\n');
      }
      return [
        t(LEDGER_TOOLTIP_I18N_KEYS.closingCoinsTitle),
        t(LEDGER_TOOLTIP_I18N_KEYS.closingDayStart, { amount: formatSigned(context.dayStartCoins) }),
        t(LEDGER_TOOLTIP_I18N_KEYS.closingNetChange, {
          amount: formatSigned(context.closingCoins - context.dayStartCoins),
        }),
        t(LEDGER_TOOLTIP_I18N_KEYS.closingClosing, { amount: formatSigned(context.closingCoins) }),
      ].join('\n');
    }
    case 'businessesOwned': {
      const names = context.businessNames;
      if (!names || names.length === 0) {
        return [
          t(LEDGER_TOOLTIP_I18N_KEYS.businessesOwnedTitle),
          t(LEDGER_TOOLTIP_I18N_KEYS.businessesOwnedBody),
        ].join('\n');
      }
      return [t(LEDGER_TOOLTIP_I18N_KEYS.businessesOwnedTitle), ...names].join('\n');
    }
    default:
      return String(key);
  }
}

// ── Summary-tab row tooltips ─────────────────────────────────

/**
 * The metrics a Summary-tab figure can annotate.
 *
 * Mirrors `SummaryMetricKey` in the model module; redeclared here so the
 * tooltip builder stays importable without pulling the whole model in.
 */
export type SummaryTooltipMetricKey = 'income' | 'reputation' | 'score';

/** Extra i18n keys used by the Summary-tab figure tooltips. */
export const SUMMARY_TOOLTIP_I18N_KEYS = {
  incomeTitle: 'ledger.summary.income.title',
  reputationTitle: 'ledger.summary.reputation.title',
  reputationFormula: 'ledger.summary.reputation.formula',
  scoreTitle: 'ledger.summary.score.title',
} as const;

/** Default English strings for the Summary-tab figure tooltips. */
export const SUMMARY_TOOLTIP_STRINGS = {
  incomeTitle: 'Income — the day’s full profit/loss breakdown.',
  reputationTitle: 'Reputation change',
  reputationFormula:
    'Reputation = incident ({incident}) + one-off ({oneOff}) = {total}',
  scoreTitle: 'Score change',
} as const;

// Register the extra strings into the English bundle (module-load time).
const summaryEnBundle: Record<string, string> = {};
for (const [k, v] of Object.entries(SUMMARY_TOOLTIP_STRINGS)) {
  summaryEnBundle[SUMMARY_TOOLTIP_I18N_KEYS[k as keyof typeof SUMMARY_TOOLTIP_STRINGS]] = v;
}
registerLocale('en', summaryEnBundle);

/**
 * Builds the tooltip for one seat's figure on the Summary tab, reusing the
 * existing per-line builders so the breakdown matches that seat's per-player
 * tab exactly.
 *
 *  - **income** — the full P&L breakdown (income phases, expense categories,
 *    incident, one-off and the net reconciliation) that produces the figure.
 *  - **reputation** — the day's reputation change with its incident/one-off
 *    reconciliation.
 *  - **score** — the day's score change explanation.
 *
 * Every figure in the returned string comes from the seat's `PLProjection`, so
 * the tooltip reconciles to the headline figure it annotates.
 *
 * @param key          The metric the figure belongs to.
 * @param projection   The seat's P&L projection (the tooltip source).
 * @param incidentName The resolved incident's name, when known.
 */
export function buildSummaryMetricTooltip(
  key: SummaryTooltipMetricKey,
  projection: PLProjection,
  incidentName: string | null = null,
): string {
  if (key === 'reputation') {
    return [
      t(SUMMARY_TOOLTIP_I18N_KEYS.reputationTitle),
      t(SUMMARY_TOOLTIP_I18N_KEYS.reputationFormula, {
        incident: formatSigned(projection.incident.reputation),
        oneOff: formatSigned(projection.oneOff.reputation),
        total: formatSigned(projection.net.reputation),
      }),
    ].join('\n');
  }
  if (key === 'score') {
    return [
      t(SUMMARY_TOOLTIP_I18N_KEYS.scoreTitle),
      t(LEDGER_TOOLTIP_I18N_KEYS.scoreChangeBody),
    ].join('\n');
  }

  // income: the whole statement, reusing the per-line builders so the
  // Summary tooltip and the per-player tab can never drift.
  const parts: string[] = [t(SUMMARY_TOOLTIP_I18N_KEYS.incomeTitle)];
  for (const line of projection.income.lines) parts.push(buildIncomeLineTooltip(line));
  parts.push(buildTotalLineTooltip(projection.income));
  for (const line of projection.expenses.lines) parts.push(buildExpenseLineTooltip(line));
  parts.push(buildTotalLineTooltip(projection.expenses));
  parts.push(buildIncidentLineTooltip(projection.incident, incidentName));
  parts.push(buildOneOffLineTooltip(projection));
  parts.push(buildNetLineTooltip(projection));
  return parts.join('\n\n');
}
