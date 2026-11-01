/**
 * Main Street: Bailout Loan Offer overlay model (pure)
 *
 * Phaser-free model that turns the outstanding bankruptcy bailout offer
 * (`state.pendingLoanOffer`, raised by the single-player bailout slice
 * MS-0MVPWS9L9001PVXG) into the content the
 * {@link module:scenes/MainStreetLoanOverlay} dialog renders
 * (MS-0MVPWSBLG006YMBA, parent MS-0MVL6DZI0000F6CG).
 *
 * Every row is derived from the offer's presented menu
 * (`PendingLoanOffer.options`, a snapshot of `config.loanOptions`) and the
 * configured interest rate, using the same repayment arithmetic as
 * `MainStreetLoans` — so the dialog can never disagree with the loan the
 * engine records on acceptance.
 *
 * Read-only: nothing here mutates `state`, consumes no RNG and has no Phaser
 * import, so the model is unit-testable in a plain Node environment.
 *
 * @module src/scenes/MainStreetLoanOverlayModel
 */

import type { MainStreetState } from '../MainStreetState';
import {
  DEFAULT_LOAN_INTEREST_RATE,
  largestBailoutOption,
  loanPerTurnRepayment,
  loanTotalRepayment,
} from '../MainStreetLoans';

// ── Types ───────────────────────────────────────────────────

/** One selectable loan option row in the bailout dialog. */
export interface LoanOfferRow {
  /** Index into the presented offer menu (`PendingLoanOffer.options`). */
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
   * repayment and the term — one button per option, as the overlay requires.
   */
  readonly label: string;
}

/** The complete, presentation-ready content of the bailout dialog. */
export interface LoanOfferModel {
  /** Owner index of the seat that must decide. */
  readonly ownerId: number;
  /** Why the offer was raised (only the bankruptcy bailout exists). */
  readonly reason: 'bankruptcy';
  /** Dialog title. */
  readonly title: string;
  /** Plain-language explanation of why the offer is on screen. */
  readonly intro: string;
  /** One row per presented option, in menu order. */
  readonly rows: readonly LoanOfferRow[];
  /** Label for the decline action. */
  readonly declineLabel: string;
  /** Small print explaining the repayment schedule. */
  readonly footer: string;
  /**
   * Index of the deterministic default choice (the AI/headless policy: the
   * largest principal, longest term as the tie-break). Used by the headless
   * fallback when no overlay surface exists.
   */
  readonly recommendedIndex: number;
}

// ── Formatting ──────────────────────────────────────────────

/** Formats a whole-coin amount with the game's currency symbol. */
function formatCoins(amount: number): string {
  return `€${amount}`;
}

/** Builds a row's self-contained button label. */
function formatRowLabel(
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

// ── Model builder ───────────────────────────────────────────

/**
 * Builds the bailout dialog model from the state's pending loan offer.
 *
 * Uses the offer's presented menu (never re-reads `config.loanOptions`, so a
 * menu that changed after the offer was raised cannot desynchronise the
 * dialog from the accept handler) and the configured interest rate, falling
 * back to {@link DEFAULT_LOAN_INTEREST_RATE} for legacy configs that predate
 * the loan fields (the same defensive default as `buildActiveLoan`).
 *
 * @param state The current game state (read-only). Only `pendingLoanOffer`
 *              and the loan interest rate are consulted.
 * @returns The dialog model, or `null` when no offer is pending.
 */
export function buildLoanOfferModel(
  state: Pick<MainStreetState, 'pendingLoanOffer' | 'config'>,
): LoanOfferModel | null {
  const pending = state.pendingLoanOffer;
  if (!pending) return null;

  const interestRate = Number.isFinite(state.config?.loanInterestRate)
    ? (state.config.loanInterestRate as number)
    : DEFAULT_LOAN_INTEREST_RATE;

  const rows: LoanOfferRow[] = pending.options.map((option, index) => {
    const totalRepayment = loanTotalRepayment(option.principal, interestRate);
    const perTurnRepayment = loanPerTurnRepayment(totalRepayment, option.termTurns);
    return {
      index,
      principal: option.principal,
      termTurns: option.termTurns,
      totalRepayment,
      perTurnRepayment,
      label: formatRowLabel(
        option.principal,
        perTurnRepayment,
        totalRepayment,
        option.termTurns,
      ),
    };
  });

  // Deterministic default (largest principal, longest term as the
  // tie-break), matching the headless/AI bailout policy. The offer is only
  // raised with a non-empty menu, but a hand-built empty offer must not
  // crash the model: fall back to 0.
  const recommended = rows.length > 0 ? largestBailoutOption(pending.options) : undefined;
  const recommendedIndex = recommended
    ? rows.findIndex(
        (row) =>
          row.principal === recommended.principal && row.termTurns === recommended.termTurns,
      )
    : 0;

  return {
    ownerId: pending.ownerId,
    reason: pending.reason,
    title: 'Bank Loan Offer',
    intro:
      "You cannot cover this turn's costs.\n" +
      'Take a bank loan to keep playing, or decline to end the run.',
    rows,
    declineLabel: '[ Decline — end the run ]',
    footer:
      'The per-turn repayment is deducted at the end of each turn ' +
      'until the loan is repaid.',
    recommendedIndex: recommendedIndex < 0 ? 0 : recommendedIndex,
  };
}
