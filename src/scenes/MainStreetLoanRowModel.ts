/**
 * Main Street: Loan option row model (pure, shared)
 *
 * The single home of the loan-option **row arithmetic and label formatting**
 * (MS-0MVXYCHV2000ST0C, parent MS-0MVPWSQMG004198C): the bankruptcy bailout
 * dialog ({@link module:scenes/MainStreetLoanOverlayModel}) and the mid-game
 * loan selector ({@link module:scenes/MainStreetLoanSelectorModel}) present the
 * same menu, so the per-turn/total repayment figures and the button label are
 * built here once and reused. Keeping one implementation means the two
 * dialogs can never disagree with each other or with the loan the engine
 * records on acceptance.
 *
 * Every row is derived from a `LoanOption` table and the configured interest
 * rate, using the same repayment arithmetic as `MainStreetLoans` —
 * `loanTotalRepayment()` / `loanPerTurnRepayment()`.
 *
 * The bailout dialog additionally annotates each row with its coverage of the
 * closing shortfall (MS-0MVZC1DAS001C8LF); that annotation is optional here —
 * a menu presented without a known shortfall (the mid-game selector, or a
 * legacy offer saved before the figure was recorded) marks it unknown.
 *
 * Read-only: nothing here mutates `state`, consumes no RNG and has no Phaser
 * import, so the module is unit-testable in a plain Node environment.
 *
 * @module src/scenes/MainStreetLoanRowModel
 */

import {
  DEFAULT_LOAN_INTEREST_RATE,
  loanPerTurnRepayment,
  loanTotalRepayment,
} from '../MainStreetLoans';
import type { LoanOption } from '../MainStreetStateTypes';

// ── Types ───────────────────────────────────────────────────

/**
 * One selectable loan option row, shared by the bailout and selector dialogs.
 */
export interface LoanOfferRow {
  /**
   * Index into the menu the row was built from — the presented offer's
   * `PendingLoanOffer.options` for the bailout, `config.loanOptions` for the
   * mid-game selector.
   */
  readonly index: number;
  /** Coins credited to the wallet immediately. */
  readonly principal: number;
  /** Number of turns over which the loan is repaid. */
  readonly termTurns: number;
  /** Total to repay over the whole term (`round(principal × (1 + rate))`). */
  readonly totalRepayment: number;
  /** Fixed deduction per turn (`round(totalRepayment / termTurns)`). */
  readonly perTurnRepayment: number;
  /**
   * Self-contained button label naming the principal, the per-turn and total
   * repayment and the term — one button per option, as the dialogs require —
   * plus the row's coverage of the closing shortfall when that figure is known
   * (a "covers the gap" / "€N short" suffix).
   */
  readonly label: string;
  /**
   * Whether this option's principal alone restores a non-negative balance.
   * `null` when the shortfall is unknown or not applicable — a save taken
   * before the figure was recorded, or a mid-game selector menu (which is
   * presented against no closing shortfall at all) — in which case the row
   * states no coverage.
   */
  readonly coversShortfall: boolean | null;
  /**
   * Coins the seat would still be short after taking this option
   * (`max(0, shortfall - principal)`), or `null` when the shortfall is
   * unknown. `0` exactly when {@link coversShortfall} is `true`.
   */
  readonly stillShort: number | null;
}

// ── Formatting ──────────────────────────────────────────────

/** Formats a whole-coin amount with the game's currency symbol. */
export function formatCoins(amount: number): string {
  return `€${amount}`;
}

/**
 * Builds a row's self-contained button label (without the optional coverage
 * suffix, which {@link buildLoanRows} appends).
 *
 * The only place the loan option label format string lives: both dialogs go
 * through {@link buildLoanRows}, so a copy change applies to each of them.
 */
export function formatRowLabel(
  principal: number,
  perTurnRepayment: number,
  totalRepayment: number,
  termTurns: number,
): string {
  return (
    `[ Borrow ${formatCoins(principal)} — ${formatCoins(perTurnRepayment)}/turn, ` +
    `${formatCoins(totalRepayment)} total over ${termTurns} turns ]`
  );
}

/**
 * Appends a row's coverage of the closing shortfall to its self-contained
 * label: "covers the gap" when the principal alone restores a non-negative
 * balance, otherwise how many coins the seat would still be short.
 *
 * Returns the label unchanged when the shortfall is unknown, so a save taken
 * before the figure was recorded renders exactly as it did then.
 */
export function withCoverage(
  label: string,
  coversShortfall: boolean | null,
  stillShort: number | null,
): string {
  if (coversShortfall === null) return label;
  if (coversShortfall) return `${label} — covers the gap`;
  return `${label} — ${formatCoins(stillShort ?? 0)} short`;
}

/**
 * The loan interest rate to price a menu with.
 *
 * Falls back to {@link DEFAULT_LOAN_INTEREST_RATE} for legacy configs that
 * predate the loan fields (the same defensive default as `buildActiveLoan`),
 * so a missing or non-finite rate can never price a menu at `NaN`.
 */
export function resolveLoanInterestRate(
  config: { readonly loanInterestRate?: number } | undefined,
): number {
  const rate = config?.loanInterestRate;
  return Number.isFinite(rate) ? (rate as number) : DEFAULT_LOAN_INTEREST_RATE;
}

/**
 * Builds one row per menu entry, in menu order.
 *
 * @param options      The menu to present (the offer's snapshot for the
 *                     bailout, `config.loanOptions` for the selector).
 * @param interestRate Flat rate applied over the whole term.
 * @param shortfall    Coins needed to reach the next turn, or `null` when the
 *                     figure is unknown / not applicable. When known, each row
 *                     states whether its principal closes the gap.
 */
export function buildLoanRows(
  options: readonly LoanOption[],
  interestRate: number,
  shortfall: number | null,
): LoanOfferRow[] {
  return options.map((option, index) => {
    const totalRepayment = loanTotalRepayment(option.principal, interestRate);
    const perTurnRepayment = loanPerTurnRepayment(totalRepayment, option.termTurns);
    // A loan's principal is credited immediately, so it closes the gap exactly
    // when it covers the shortfall; the first instalment is charged next turn
    // and therefore never deepens this figure.
    const coversShortfall = shortfall === null ? null : option.principal >= shortfall;
    const stillShort =
      shortfall === null ? null : Math.max(0, shortfall - option.principal);
    return {
      index,
      principal: option.principal,
      termTurns: option.termTurns,
      totalRepayment,
      perTurnRepayment,
      coversShortfall,
      stillShort,
      label: withCoverage(
        formatRowLabel(
          option.principal,
          perTurnRepayment,
          totalRepayment,
          option.termTurns,
        ),
        coversShortfall,
        stillShort,
      ),
    };
  });
}
