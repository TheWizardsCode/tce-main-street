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
