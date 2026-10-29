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
import type { ActiveLoan, LoanOption, PendingLoanOffer } from './MainStreetStateTypes';
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
 * Picks the option the AI/headless bailout policy accepts: the **largest**
 * principal, with the longest term as the deterministic tie-break (parent
 * Q5 = A). Equal principal AND term fall back to the earliest menu entry, so
 * the choice is fully deterministic and consumes no RNG.
 *
 * @param options The presented menu (`PendingLoanOffer.options`).
 * @throws Error when the menu is empty (a malformed offer).
 */
export function largestBailoutOption(options: readonly LoanOption[]): LoanOption {
  if (options.length === 0) {
    throw new Error('Cannot choose a bailout option from an empty loan menu.');
  }
  let best = options[0];
  for (const option of options) {
    if (
      option.principal > best.principal ||
      (option.principal === best.principal && option.termTurns > best.termTurns)
    ) {
      best = option;
    }
  }
  return best;
}

/**
 * Raises a bankruptcy bailout offer for the acting seat when it would fail on
 * `coins < 0` and holds no active loan (Bank Loans epic MS-0MVL6DZI0000F6CG,
 * slice MS-0MVPWS9L9001PVXG).
 *
 * This is the single gate the closing sequence consults **before** declaring
 * bankruptcy. It mutates only the transitional decision fields:
 *
 * - `state.pendingLoanOffer` is set to the presented menu (a snapshot of
 *   `config.loanOptions`) with `reason: 'bankruptcy'`;
 * - `state._bailoutOffered` records `{ ownerId, turn }` so a second
 *   evaluation in the same turn (after a decline) cannot re-offer;
 * - one `neutral` activity-log row announces the decision.
 *
 * The engine closes nothing here — the caller pauses the closing and returns
 * `TurnResult.pendingLoanOffer === true`; `acceptLoanOffer` / `declineLoanOffer`
 * resolve the decision and the closing tail re-runs once.
 *
 * Rules (parent AC4/AC5/AC7 and the producer decisions Q3=A, Q6=A):
 * - only while the game is still playing;
 * - loans must be enabled (`config.loansEnabled`);
 * - the seat must not already hold an active loan (one loan at a time — a
 *   seat already repaying simply goes bankrupt);
 * - at most one offer per seat per turn;
 * - no offer while another offer is already unresolved;
 * - the competitive opening-day solvency grace wins: a competitive seat cannot
 *   be bankrupted on turn 1, so no bailout is offered to it (single-player
 *   bankruptcy is unchanged on turn 1, per the grace's own contract).
 *
 * @param state Current game state (mutated only when an offer is raised).
 * @param opts  Optional `projectedCoins`: the deferred-mutation path evaluates
 *              the balance the closing **will** produce before it is applied.
 * @returns `true` when an offer was raised and the closing must pause.
 */
export function maybeOfferBailout(
  state: MainStreetState,
  opts?: { projectedCoins?: number },
): boolean {
  if (state.gameResult !== 'playing') return false;
  if (!state.config.loansEnabled) return false;
  // An unresolved offer is already the pause; never stack or re-raise one.
  if (state.pendingLoanOffer) return false;

  const ownerId = loanOwnerId(state);
  // Opening-day solvency grace (MS-0MVJNFESC005QJ41) is competitive-only: a
  // competitive seat cannot be bankrupted on turn 1, so the grace resolves it
  // and no loan is needed. Single-player keeps its turn-1 bankruptcy rule.
  if ((state.players?.length ?? 0) > 0 && state.turn <= 1) return false;

  const seat = state.players?.find((player) => player.playerId === ownerId);
  if (seat?.eliminated) return false;
  if (activeLoanFor(state, ownerId)) return false;

  // Per-turn guard: at most one bailout offer per seat per turn (a decline
  // must converge to game over, never loop).
  const offered = state._bailoutOffered;
  if (offered && offered.ownerId === ownerId && offered.turn === state.turn) return false;

  const coins = opts?.projectedCoins ?? state.resourceBank.coins;
  if (!(coins < 0)) return false;

  const options = optionsFor(state).map((option) => ({ ...option }));
  if (options.length === 0) return false;

  state.pendingLoanOffer = { ownerId, reason: 'bankruptcy', options };
  state._bailoutOffered = { ownerId, turn: state.turn };
  addLog(
    state,
    ownerId,
    `Bankruptcy bailout: coins are ${coins}; a bank loan is available — accept an option to keep playing, or decline to end the run.`,
    'neutral',
  );
  return true;
}

/**
 * Declines the pending bankruptcy bailout offer.
 *
 * Clears `state.pendingLoanOffer` (so the loss can be declared) but leaves the
 * per-turn guard in place, so the very next evaluation cannot raise the same
 * offer again — a decline converges to game over in a single pass.
 *
 * @param state Current game state (mutated).
 * @returns `true` when an offer was declined, `false` when none was pending.
 */
export function declineLoanOffer(state: MainStreetState): boolean {
  const pending = state.pendingLoanOffer;
  if (!pending) return false;
  state.pendingLoanOffer = null;
  addLog(
    state,
    pending.ownerId,
    'Declined the bankruptcy bailout — the bankruptcy stands.',
    'loss',
  );
  return true;
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

// ── Persistence: defensive restore (MS-0MVPWSE0E003QLKE) ────

/**
 * Narrows an untrusted serialized value to a finite number.
 *
 * A checkpoint on disk is data, not code: a hand-edited, truncated or
 * corrupted save can carry `null`, strings or `NaN` where the runtime model
 * expects integers. Every restore check below goes through this guard so an
 * invalid entry is dropped instead of poisoning the repayment arithmetic with
 * `NaN` for the rest of the run.
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Restores the active loans from a saved checkpoint, dropping anything that is
 * not a well-formed {@link ActiveLoan} (save schema v3, persistence slice
 * MS-0MVPWSE0E003QLKE).
 *
 * The schedule is resumed, not recomputed: `principal`, `totalRepayment`,
 * `perTurnRepayment`, `turnsRemaining`, `termTurns` and `ownerId` round-trip
 * verbatim so a mid-loan save keeps billing exactly the amount the seat agreed
 * to and for exactly the turns it has left.
 *
 * Defensive rules (any violation drops the entry rather than throwing):
 *
 * - every field must be a finite number, with `ownerId`/`termTurns` integral
 *   and `termTurns >= 1` (a zero-turn loan could never be repaid);
 * - `principal` must be positive and the money fields non-negative;
 * - `turnsRemaining` is clamped to `termTurns`, so a corrupt save can never
 *   extend a loan beyond the term it was issued for;
 * - a loan with no payments left (`turnsRemaining <= 0`) is retired on load,
 *   matching what the next repayment pass would do anyway;
 * - at most one loan per `ownerId` survives (the one-active-loan rule,
 *   producer Q1 = A) — the first well-formed entry wins.
 *
 * @param raw The untrusted `loans` value from the serialized state.
 * @returns The loans safe to resume; an empty array when the save predates
 *          the loan mechanic (schema v2) or carries nothing usable.
 */
export function restoreActiveLoans(raw: unknown): ActiveLoan[] {
  if (!Array.isArray(raw)) return [];

  const restored: ActiveLoan[] = [];
  const seenOwners = new Set<number>();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const {
      ownerId,
      principal,
      totalRepayment,
      perTurnRepayment,
      turnsRemaining,
      termTurns,
      takenOnTurn,
    } = entry as Record<string, unknown>;

    if (!isFiniteNumber(ownerId) || !Number.isInteger(ownerId) || ownerId < 0) continue;
    if (!isFiniteNumber(principal) || principal <= 0) continue;
    if (!isFiniteNumber(totalRepayment) || totalRepayment < 0) continue;
    if (!isFiniteNumber(perTurnRepayment) || perTurnRepayment < 0) continue;
    if (!isFiniteNumber(turnsRemaining)) continue;
    if (!isFiniteNumber(termTurns) || !Number.isInteger(termTurns) || termTurns < 1) continue;
    if (!isFiniteNumber(takenOnTurn) || takenOnTurn < 0) continue;
    if (seenOwners.has(ownerId)) continue;

    // Clamp to the loan's own term; `Math.floor` keeps a fractional (corrupt)
    // counter from buying an extra payment.
    const clampedTurnsRemaining = Math.min(Math.floor(turnsRemaining), termTurns);
    if (clampedTurnsRemaining <= 0) continue;

    seenOwners.add(ownerId);
    restored.push({
      ownerId,
      principal,
      totalRepayment,
      perTurnRepayment,
      turnsRemaining: clampedTurnsRemaining,
      termTurns,
      takenOnTurn,
    });
  }

  return restored;
}

/**
 * Restores the pending loan offer from a saved checkpoint, or `null` when the
 * save has none (or carries something unusable).
 *
 * A save taken while the bailout decision is open must resume with the offer
 * still pending: the seat, the reason and the presented options round-trip
 * verbatim so the player is shown exactly the menu they were given.
 *
 * Defensive rules (any violation drops the offer rather than throwing):
 *
 * - the entry must be an object with a non-negative integral `ownerId`;
 * - `reason` must be the only reason currently produced (`'bankruptcy'`) — an
 *   unknown reason has no resolver, so keeping it would stall the closing;
 * - `options` must be an array with at least one usable option (positive
 *   `principal`, integral `termTurns >= 1`); unusable options are dropped, and
 *   an offer with no option left is dropped entirely — `largestBailoutOption`
 *   throws on an empty menu, and a human could never resolve one.
 *
 * @param raw The untrusted `pendingLoanOffer` value from the serialized state.
 * @returns The offer to resume, or `null` when there is nothing to resume.
 */
export function restorePendingLoanOffer(raw: unknown): PendingLoanOffer | null {
  if (!raw || typeof raw !== 'object') return null;
  const offer = raw as Record<string, unknown>;

  const { ownerId, reason, options: rawOptions } = offer;
  if (!isFiniteNumber(ownerId) || !Number.isInteger(ownerId) || ownerId < 0) return null;
  if (reason !== 'bankruptcy') return null;
  if (!Array.isArray(rawOptions)) return null;

  const options: LoanOption[] = [];
  for (const entry of rawOptions) {
    if (!entry || typeof entry !== 'object') continue;
    const { principal, termTurns } = entry as Record<string, unknown>;
    if (!isFiniteNumber(principal) || principal <= 0) continue;
    if (!isFiniteNumber(termTurns) || !Number.isInteger(termTurns) || termTurns < 1) continue;
    options.push({ principal, termTurns });
  }
  if (options.length === 0) return null;

  return { ownerId, reason: 'bankruptcy', options };
}
