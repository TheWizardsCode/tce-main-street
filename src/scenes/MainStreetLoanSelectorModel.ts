/**
 * Main Street: Turn Summary loans descriptor + mid-game loan selector (pure)
 *
 * Phaser-free models that let the Turn Summary dialog offer a **mid-game bank
 * loan** (MS-0MVXYCHV2000ST0C, parent MS-0MVPWSQMG004198C):
 *
 * - {@link buildTurnSummaryLoanDescriptor} — decides whether the dialog's
 *   `[ Bank Loan ]` affordance is available, names the reason it is not, and
 *   carries the acting seat's outstanding obligation so the button can say
 *   *why* (loans disabled vs. already owing) instead of a generic note.
 * - {@link buildLoanSelectorModel} — the option list the dialog presents on
 *   press: one row per `config.loanOptions` entry, priced and labelled exactly
 *   like the bankruptcy bailout dialog, plus a Cancel action.
 *
 * The menu, the repayment arithmetic and the one-active-loan rule stay in
 * `MainStreetLoans` and the shared row builder
 * ({@link module:scenes/MainStreetLoanRowModel}) — nothing here is a second
 * source of truth. The selector is driven by the configured menu, **never** by
 * `state.pendingLoanOffer`: the bailout offer keeps its own dialog and the two
 * paths never overlap.
 *
 * Read-only: nothing here mutates `state`, consumes no RNG and has no Phaser
 * import, so both models are unit-testable in a plain Node environment.
 *
 * @module src/scenes/MainStreetLoanSelectorModel
 */

import type { MainStreetState } from '../MainStreetState';
import type { LoanOption } from '../MainStreetStateTypes';
import {
  activeLoanFor,
  formatLoanObligation,
  optionsFor,
} from '../MainStreetLoans';
import {
  buildLoanRows,
  resolveLoanInterestRate,
  type LoanOfferRow,
} from './MainStreetLoanRowModel';

// ── Descriptor ──────────────────────────────────────────────

/**
 * Why the `[ Bank Loan ]` affordance is unavailable. `null` when it is
 * available (the descriptor's `enabled` flag).
 */
export type TurnSummaryLoanReason = 'loans-disabled' | 'active-loan' | 'no-options';

/** The acting seat's outstanding obligation, as the hint renders it. */
export interface TurnSummaryActiveLoan {
  /** Fixed deduction per turn (`ActiveLoan.perTurnRepayment`). */
  readonly perTurnRepayment: number;
  /** Payments still due (`ActiveLoan.turnsRemaining`). */
  readonly turnsRemaining: number;
}

/**
 * The complete, presentation-ready answer to "may this seat take a loan now?".
 *
 * Exactly the shape the Turn Summary dialog consumes — no scene state, no
 * Phaser objects — so the enable/disable matrix can be pinned by unit tests
 * (MS-0MVXYCHCJ002ER7L).
 */
export interface TurnSummaryLoanDescriptor {
  /** True exactly when the seat may borrow from the dialog right now. */
  readonly enabled: boolean;
  /** Why borrowing is unavailable, or `null` when `enabled`. */
  readonly reason: TurnSummaryLoanReason | null;
  /** The seat's outstanding obligation, or `null` when it has none. */
  readonly activeLoan: TurnSummaryActiveLoan | null;
  /** The configured menu (empty when loans are off). */
  readonly options: readonly LoanOption[];
  /** Reason-specific disabled hint, or `null` when `enabled`. */
  readonly hint: string | null;
}

/** Disabled hint shown when the run has the loan mechanic turned off. */
export const LOANS_DISABLED_HINT = 'Bank loans are disabled in this game.';

/** Disabled hint shown when no loan menu is configured (nothing to offer). */
export const NO_LOAN_OPTIONS_HINT =
  'No bank loans are configured for this game.';

/**
 * Builds the Turn Summary loan descriptor for one seat.
 *
 * Rules, in this order (the first that applies wins, because the hint must
 * name the **most fundamental** block — a run with loans off never depends on
 * the seat's obligation):
 *
 * 1. `config.loansEnabled === false` → `loans-disabled`, empty menu;
 * 2. the seat already holds an active loan → `active-loan`, carrying
 *    `{ perTurnRepayment, turnsRemaining }` and the hint
 *    {@link formatLoanObligation}`(loan)` — the same wording as the HUD
 *    readout, so the two can never drift (producer Q3 = A);
 * 3. the configured menu is empty → `no-options`;
 * 4. otherwise → `enabled: true`, `reason: null`, `hint: null`.
 *
 * @param state   Current game state (never mutated).
 * @param ownerId Seat to evaluate (defaults to the acting/bound seat, via
 *                `MainStreetLoans.loanOwnerId`).
 */
export function buildTurnSummaryLoanDescriptor(
  state: MainStreetState,
  ownerId?: number,
): TurnSummaryLoanDescriptor {
  if (!state.config.loansEnabled) {
    return {
      enabled: false,
      reason: 'loans-disabled',
      activeLoan: null,
      options: [],
      hint: LOANS_DISABLED_HINT,
    };
  }

  // Copies, so a caller cannot mutate the configured table through the
  // descriptor.
  const options = optionsFor(state).map((option) => ({ ...option }));

  const loan = activeLoanFor(state, ownerId);
  if (loan) {
    const activeLoan: TurnSummaryActiveLoan = {
      perTurnRepayment: loan.perTurnRepayment,
      turnsRemaining: loan.turnsRemaining,
    };
    return {
      enabled: false,
      reason: 'active-loan',
      activeLoan,
      options,
      hint: formatLoanObligation(activeLoan),
    };
  }

  if (options.length === 0) {
    return {
      enabled: false,
      reason: 'no-options',
      activeLoan: null,
      options,
      hint: NO_LOAN_OPTIONS_HINT,
    };
  }

  return { enabled: true, reason: null, activeLoan: null, options, hint: null };
}

// ── Selector ────────────────────────────────────────────────

/** The complete, presentation-ready content of the mid-game loan selector. */
export interface LoanSelectorModel {
  /** Dialog title. */
  readonly title: string;
  /** Plain-language explanation of what the menu does. */
  readonly intro: string;
  /** One row per configured option, in menu order. */
  readonly rows: readonly LoanOfferRow[];
  /** Label for the back-out action (never the bailout decline label). */
  readonly cancelLabel: string;
  /** Small print explaining the repayment schedule. */
  readonly footer: string;
}

/** Dialog title for the mid-game selector. */
export const LOAN_SELECTOR_TITLE = 'Bank Loan';

/**
 * Back-out label for the mid-game selector.
 *
 * Deliberately distinct from the bailout dialog's
 * `[ Decline — end the run ]`: cancelling here only closes the dialog, it
 * never ends the run.
 */
export const LOAN_SELECTOR_CANCEL_LABEL = '[ Cancel ]';

/**
 * Builds the mid-game loan selector content from `config.loanOptions`.
 *
 * The rows come from the **same** builder as the bankruptcy bailout dialog
 * ({@link buildLoanRows}), so the per-turn/total repayment figures and the
 * button labels are identical for the same menu — a re-balanced
 * `config.loanOptions` needs no UI change (parent assumption A3).
 *
 * The menu is a run-wide config table, so the content is identical for every
 * seat: `_ownerId` is accepted for signature symmetry with
 * {@link buildTurnSummaryLoanDescriptor} (the Turn Summary gate holds both and
 * passes the same seat to each) and is not needed to build the rows.
 *
 * @param state    Current game state (never mutated); only `config` is read.
 * @param _ownerId Acting seat, accepted for symmetry — the menu is shared.
 */
export function buildLoanSelectorModel(
  state: Pick<MainStreetState, 'config'>,
  _ownerId?: number,
): LoanSelectorModel {
  return {
    title: LOAN_SELECTOR_TITLE,
    intro:
      'Borrow from the bank to fund the next week.\n' +
      'Taking a loan costs no action point.',
    rows: buildLoanRows(
      optionsFor(state),
      resolveLoanInterestRate(state.config),
      // A mid-game loan is not raised against a closing shortfall, so no row
      // states any coverage (`coversShortfall` / `stillShort` are null).
      null,
    ),
    cancelLabel: LOAN_SELECTOR_CANCEL_LABEL,
    footer:
      'The per-turn repayment is deducted at the end of each turn ' +
      'until the loan is repaid.',
  };
}
