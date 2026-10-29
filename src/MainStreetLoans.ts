/**
 * Main Street: Bank Loans — pure model and helpers.
 *
 * Single source of truth for the loan option table, the repayment
 * arithmetic and the one-active-loan rule (Bank Loans epic
 * MS-0MVL6DZI0000F6CG, slice MS-0MVPWS6WB008WP79).
 *
 * The module is deliberately pure: it reads `MainStreetState`/`GameConfig`
 * and computes/validates without mutating state. The state-changing
 * `takeLoan` handler lives in `MainStreetEngineCommands.ts` and consumes
 * these helpers, so every later slice (repayment, bailout, HUD) reads the
 * same tested source of truth.
 *
 * ## Interest model (seed worked example)
 *
 * Flat 10% of principal over the whole term, spread evenly:
 *   totalRepayment = round(principal × (1 + interestRate))
 *   perTurnRepayment = round(totalRepayment / termTurns)
 * so 600 / 6 → 660 total → 110 per turn (the seed's worked example).
 * No compounding, no interest on the outstanding balance.
 *
 * ## One-active-loan rule (producer Q1 = A)
 *
 * At most one `ActiveLoan` per `ownerId` (the shared owner-id convention
 * `state.activePlayerId ?? 0`, matching `PlayerRecord.playerId`, the
 * `ownerTaggedGrid` and the activity-log seat ids). A second loan-taking
 * attempt is rejected with a user-facing reason and leaves resources
 * untouched.
 *
 * @module
 */

import type { MainStreetState } from './MainStreetState';
import type { ActiveLoan, LoanOption } from './MainStreetStateTypes';
import { addLog, describeEventEffects, syncResourceBankToLedger } from './MainStreetStateLog';

/**
 * Default flat interest rate over the loan term (10% of principal). Used by
 * the presets and as the fallback for a config that predates the loan fields.
 */
export const DEFAULT_LOAN_INTEREST_RATE = 0.1;

/**
 * Default loan menu: 300 coins / 3 turns, 600 / 6, 1000 / 10 (parent Q2 = B,
 * "a choice among options"). All three yield 110 per turn at the default
 * interest rate, so the menu offers a pure duration-vs-size trade-off.
 *
 * The menu is configuration data (`config.loanOptions`), identical for every
 * seat in a run; the presets embed this same table and re-balancing is a
 * config edit, not a code change.
 */
export const DEFAULT_LOAN_OPTIONS: readonly LoanOption[] = [
  { principal: 300, termTurns: 3 },
  { principal: 600, termTurns: 6 },
  { principal: 1000, termTurns: 10 },
] as const;

/**
 * Total repayment for a loan: `round(principal × (1 + loanInterestRate))`.
 *
 * Integer-only economy (CG-0MTIO1M15001E9Y6): rounds to the nearest integer
 * so `state.resourceBank`/ledger never accumulate fractional drift.
 */
export function loanTotalRepayment(principal: number, interestRate: number): number {
  return Math.round(principal * (1 + interestRate));
}

/**
 * Fixed per-turn repayment: `round(totalRepayment / termTurns)`.
 *
 * Integer-only economy (CG-0MTIO1M15001E9Y6). The seed's worked example
 * (600 over 6 turns at 110/turn = 660 total) is the canonical check.
 */
export function loanPerTurnRepayment(totalRepayment: number, termTurns: number): number {
  return Math.round(totalRepayment / termTurns);
}

/**
 * Resolves the acting seat id for a loan operation.
 *
 * Uses the shared owner-id convention: the active competitive seat when one
 * is set, otherwise `0` (single-player). `ownerId` may be supplied explicitly
 * by callers that address a specific seat (e.g. headless/AI drivers).
 */
export function loanOwnerId(state: MainStreetState, ownerId?: number): number {
  return ownerId ?? state.activePlayerId ?? 0;
}

/**
 * Looks up the active loan held by a seat, or undefined when the seat has
 * none. The one-active-loan invariant holds `state.loans` to at most one
 * entry per `ownerId`, so `find` is the canonical accessor.
 */
export function activeLoanFor(
  state: MainStreetState,
  ownerId?: number,
): ActiveLoan | undefined {
  return (state.loans ?? []).find((loan) => loan.ownerId === loanOwnerId(state, ownerId));
}

/**
 * Builds the `ActiveLoan` record a successful loan-taking creates, applying
 * the repayment arithmetic without touching state.
 *
 * All money fields are computed here, once, so the closing sequence (and the
 * HUD readout) reads pre-computed integers instead of re-deriving them.
 */
export function buildActiveLoan(
  state: MainStreetState,
  option: LoanOption,
  ownerId?: number,
): ActiveLoan {
  // Defensive default for configs that predate the loan config (legacy saves
  // are migrated by `getPreset`-shaped configs today, but never trust NaN).
  const interestRate = Number.isFinite(state.config.loanInterestRate)
    ? state.config.loanInterestRate
    : DEFAULT_LOAN_INTEREST_RATE;
  const totalRepayment = loanTotalRepayment(option.principal, interestRate);
  const perTurnRepayment = loanPerTurnRepayment(totalRepayment, option.termTurns);
  return {
    ownerId: loanOwnerId(state, ownerId),
    principal: option.principal,
    totalRepayment,
    perTurnRepayment,
    turnsRemaining: option.termTurns,
    termTurns: option.termTurns,
    takenOnTurn: state.turn,
  };
}

/**
 * Validates a loan-taking attempt against every rule without mutating state.
 *
 * Returns `{ legal: true }` when the seat may take a loan by choosing the
 * option at `optionIndex` in `config.loanOptions`; otherwise
 * `{ legal: false, reason }` with a clear, user-facing reason and no resource
 * change (the caller refuses before any mutation).
 *
 * Rules enforced (parent Q1 = A; this slice's ACs):
 * - the game is still playing and the phase is MarketPhase;
 * - loans are enabled in the config;
 * - the seat does not already hold an active loan;
 * - the chosen option exists in `config.loanOptions`;
 * - the seat has no unresolved pending loan offer (bailout must decide
 *   first, so a pending offer is never stacked or queued — Q1/A).
 */
export function canTakeLoan(
  state: MainStreetState,
  optionIndex: number,
  ownerId?: number,
): import('@rule-engine').LegalityResult {
  if (state.gameResult !== 'playing') {
    return { legal: false, reason: 'The game is over; no more loans can be taken.' };
  }
  if (state.phase !== 'MarketPhase') {
    return { legal: false, reason: `Loans can only be taken during the market phase, not ${state.phase}.` };
  }
  if (!state.config.loansEnabled) {
    return { legal: false, reason: 'Bank loans are disabled in this game.' };
  }
  const id = loanOwnerId(state, ownerId);
  if (state.players && state.players.length > 0) {
    const seat = state.players.find((player) => player.playerId === id);
    if (!seat) {
      return { legal: false, reason: `Unknown seat ${id}: no player record to lend to.` };
    }
    if (seat.eliminated) {
      return { legal: false, reason: 'An eliminated seat cannot take a loan.' };
    }
  }
  if (activeLoanFor(state, id)) {
    return {
      legal: false,
      reason: 'One loan at a time: repay your current loan before taking another.',
    };
  }
  const option = optionsFor(state)[optionIndex];
  if (!option) {
    return {
      legal: false,
      reason: `Unknown loan option ${optionIndex}. Choose an option from the configured loan menu.`,
    };
  }
  const pending = state.pendingLoanOffer;
  if (pending && pending.ownerId === id) {
    return {
      legal: false,
      reason: 'A loan offer is awaiting your decision — accept or decline it first.',
    };
  }
  return { legal: true };
}

/**
 * The configured loan menu, falling back to the default table when the config
 * lacks one (defensive: legacy `GameConfig` shapes predating the loan config).
 */
export function optionsFor(state: Pick<MainStreetState, 'config'>): readonly LoanOption[] {
  return state.config.loanOptions ?? DEFAULT_LOAN_OPTIONS;
}

/**
 * Applies one scheduled repayment to a loan, returning the loan's next state
 * or `null` when this payment retires it.
 *
 * Pure: the caller (the closing sequence, slice MS-0MVPWS885006O5QR) performs
 * the wallet debit and the activity-log row; this helper owns only the
 * turn-count bookkeeping, so "retired after `termTurns` payments with no
 * further deductions" is one tested rule (parent AC3) shared by every
 * consumer (repayment pass, headless close, bailout bookkeeping).
 *
 * @param loan The loan as it stood before this payment.
 * @returns The loan with `turnsRemaining` decremented, or `null` when this
 *          payment was the last one (the loan is retired and must be
 *          removed from `state.loans`).
 */
export function applyLoanPayment(loan: ActiveLoan): ActiveLoan | null {
  const turnsRemaining = loan.turnsRemaining - 1;
  if (turnsRemaining <= 0) return null;
  return { ...loan, turnsRemaining };
}

/**
 * Debits one loan repayment from a borrowing seat's wallet through the
 * established economy path (never a bare wallet mutation).
 *
 * Wallet resolution mirrors {@link buildActiveLoan}'s sibling credit path in
 * `MainStreetEngineCommands.creditLoanPrincipal`:
 *
 * - **Single-player** (no `PlayerRecord` for the seat): the shared
 *   `state.resourceBank` is the wallet, so the amount is debited there and
 *   `syncResourceBankToLedger` records it against the `EconomyLedger`.
 * - **Competitive** (`state.players` present): the seat's `PlayerRecord` is
 *   the authoritative wallet at rest, so the amount is debited there. While
 *   the seat is bound, its record and the shared wallet mirror one another
 *   (`bindCompetitiveSeat` copies record → shared wallet), so the debit is
 *   mirrored into `resourceBank` only when that mirror currently holds —
 *   otherwise another seat's shared wallet is never touched.
 *
 * The debit is **never clamped** to the available balance (producer Q6 = A):
 * a shortfall leaves `coins < 0` so the ordinary bankruptcy path decides what
 * happens next. Consumes no RNG.
 *
 * @param state  Current game state (mutated in-place).
 * @param seatId Owner id of the borrowing seat.
 * @param amount Coins to debit (the loan's fixed `perTurnRepayment`).
 */
export function debitLoanRepayment(
  state: MainStreetState,
  seatId: number,
  amount: number,
): void {
  if (amount === 0) return;

  if ((state.players?.length ?? 0) > 0) {
    const seat = state.players!.find((player) => player.playerId === seatId);
    // No record to bill: leave every wallet untouched rather than debiting a
    // shared mirror that belongs to another seat.
    if (!seat) return;
    const mirrorBound = state.resourceBank.coins === seat.coins;
    seat.coins -= amount;
    if (mirrorBound) {
      state.resourceBank.coins -= amount;
    }
    syncResourceBankToLedger(state);
    return;
  }

  state.resourceBank.coins -= amount;
  syncResourceBankToLedger(state);
}

/**
 * Applies one turn's scheduled repayment to every active loan
 * (Bank Loans epic MS-0MVL6DZI0000F6CG, slice MS-0MVPWS885006O5QR).
 *
 * For each loan on `state.loans`:
 *
 * 1. the fixed `perTurnRepayment` is debited from the borrowing seat's wallet
 *    through {@link debitLoanRepayment} — unconditionally, never clamped
 *    (producer Q6 = A);
 * 2. `turnsRemaining` is decremented via {@link applyLoanPayment} and the loan
 *    is removed from `state.loans` when the term is paid off;
 * 3. one `loss` activity-log row records the expense (and the remaining term),
 *    so the deduction is visible as a one-off in the turn's net summary.
 *
 * `loansEnabled: false` is a **hard no-op** (parent AC8): no wallet change, no
 * log row and no ledger entry, keeping loans-off headless baselines
 * byte-identical. A state with no active loans is likewise untouched.
 *
 * Deferred-mutation support (CG-0MTR72P14000VO6Q) mirrors the ongoing-cost
 * helpers: `{ apply: false }` performs the loan bookkeeping (term decrement,
 * retirement, expense row) but leaves the wallet debit to the caller, which
 * folds the returned delta into `TurnResult.pendingCoinDelta` and applies it
 * with the rest of the turn's deltas.
 *
 * @param state Current game state (mutated in-place unless deferred).
 * @param opts  Optional deferred-mutation flag (`apply: false`).
 * @returns The signed coin total debited by this pass (zero or negative).
 */
export function applyLoanRepayments(
  state: MainStreetState,
  opts?: { apply?: boolean },
): number {
  // Hard no-op: loans disabled must not move coins, log, or bookkeep.
  if (!state.config.loansEnabled) return 0;
  const loans = state.loans ?? [];
  if (loans.length === 0) return 0;

  let totalRepaid = 0;
  const surviving: ActiveLoan[] = [];

  for (const loan of loans) {
    const amount = loan.perTurnRepayment;
    if (opts?.apply !== false) {
      debitLoanRepayment(state, loan.ownerId, amount);
    }
    totalRepaid += amount;

    const next = applyLoanPayment(loan);
    if (next) surviving.push(next);

    addLog(
      state,
      loan.ownerId,
      next
        ? `Loan repayment: -${amount} coins (${next.turnsRemaining} turn${
          next.turnsRemaining === 1 ? '' : 's'
        } left) (${describeEventEffects(-amount, 0)})`
        : `Loan repayment: -${amount} coins — loan repaid in full ` +
          `(${loan.totalRepayment} total) (${describeEventEffects(-amount, 0)})`,
      'loss',
    );
  }

  state.loans = surviving;
  return -totalRepaid;
}
