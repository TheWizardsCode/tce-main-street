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
 * The shortfall (MS-0MVZC1DAS001C8LF) is read from the offer's own snapshot
 * (`PendingLoanOffer.shortfall`, captured when the offer was raised) — never
 * recomputed from the live wallet, which on the deferred-mutation path still
 * holds the pre-closing balance. It drives the intro amount, each row's
 * coverage note and the "no option covers it" warning; a legacy offer without
 * it renders the amount-free copy exactly as before.
 *
 * Read-only: nothing here mutates `state`, consumes no RNG and has no Phaser
 * import, so the model is unit-testable in a plain Node environment.
 *
 * The row arithmetic and label formatting live in the shared
 * {@link module:scenes/MainStreetLoanRowModel}, so the mid-game loan selector
 * ({@link module:scenes/MainStreetLoanSelectorModel}) presents exactly the
 * same menu without a duplicated format string.
 *
 * @module src/scenes/MainStreetLoanOverlayModel
 */

import type { MainStreetState } from '../MainStreetState';
import { largestBailoutOption } from '../MainStreetLoans';
import {
  buildLoanRows,
  formatCoins,
  resolveLoanInterestRate,
  type LoanOfferRow,
} from './MainStreetLoanRowModel';

// ── Types ───────────────────────────────────────────────────

/**
 * One selectable loan option row (shared with the mid-game selector via
 * {@link module:scenes/MainStreetLoanRowModel}).
 */
export type { LoanOfferRow } from './MainStreetLoanRowModel';

/** The complete, presentation-ready content of the bailout dialog. */
export interface LoanOfferModel {
  /** Owner index of the seat that must decide. */
  readonly ownerId: number;
  /** Why the offer was raised (only the bankruptcy bailout exists). */
  readonly reason: 'bankruptcy';
  /** Dialog title. */
  readonly title: string;
  /**
   * Plain-language explanation of why the offer is on screen. States the exact
   * shortfall when it is known (MS-0MVZC1DAS001C8LF) and falls back to the
   * amount-free sentence for a save whose offer predates the field.
   */
  readonly intro: string;
  /**
   * Coins needed to reach the next turn (`max(0, -coins)` at the closing),
   * snapshotted on the offer, or `null` when unknown.
   */
  readonly shortfall: number | null;
  /**
   * Warning shown when **no** presented option closes the gap — taking any of
   * them still leaves the seat below zero and the run ends. `null` when an
   * option suffices (or the shortfall is unknown).
   */
  readonly warning: string | null;
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

// ── Copy ────────────────────────────────────────────────────

/**
 * Line stating how far short of this turn's costs the seat is — the copy that
 * replaces the amount-free sentence when the offer carries a shortfall.
 */
function formatShortfallLine(shortfall: number): string {
  return `You are ${formatCoins(shortfall)} short of covering this turn's costs.`;
}

/** The amount-free intro fallback (offers saved before the shortfall field). */
const INTRO_WITHOUT_SHORTFALL =
  "You cannot cover this turn's costs.\n" +
  'Take a bank loan to keep playing, or decline to end the run.';

/** Warning shown when no presented option is big enough to close the gap. */
const NO_OPTION_COVERS_WARNING =
  'No option covers the gap: any of these loans still leaves you below zero, ' +
  'and the run ends.';

// ── Model builder ───────────────────────────────────────────

/**
 * Builds the bailout dialog model from the state's pending loan offer.
 *
 * Uses the offer's presented menu (never re-reads `config.loanOptions`, so a
 * menu that changed after the offer was raised cannot desynchronise the
 * dialog from the accept handler) and the configured interest rate, falling
 * back to `DEFAULT_LOAN_INTEREST_RATE` for legacy configs that predate the
 * loan fields (see `resolveLoanInterestRate`, the same defensive default as
 * `buildActiveLoan`).
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

  // The shortfall is a snapshot taken when the offer was raised (never
  // recomputed here: on the deferred-mutation path the turn's deltas are still
  // un-applied, so a live re-read would show the wrong figure). A whole,
  // non-negative coin amount is required; anything else is "unknown".
  const rawShortfall = pending.shortfall;
  const shortfall =
    typeof rawShortfall === 'number' && Number.isFinite(rawShortfall) && rawShortfall >= 0
      ? Math.floor(rawShortfall)
      : null;

  // Shared with the mid-game selector so both dialogs price the same menu the
  // same way (MS-0MVXYCHV2000ST0C).
  const rows: readonly LoanOfferRow[] = buildLoanRows(
    pending.options,
    resolveLoanInterestRate(state.config),
    shortfall,
  );

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
      shortfall === null
        ? INTRO_WITHOUT_SHORTFALL
        : `${formatShortfallLine(shortfall)}\n` +
          'Take a bank loan to keep playing, or decline to end the run.',
    shortfall,
    // Warn only when the figure is known and not one presented option reaches
    // it — otherwise the player learns it only after accepting unrescuable debt.
    warning:
      shortfall !== null && rows.length > 0 && rows.every((row) => !row.coversShortfall)
        ? NO_OPTION_COVERS_WARNING
        : null,
    rows,
    declineLabel: '[ Decline — end the run ]',
    footer:
      'The per-turn repayment is deducted at the end of each turn ' +
      'until the loan is repaid.',
    recommendedIndex: recommendedIndex < 0 ? 0 : recommendedIndex,
  };
}
