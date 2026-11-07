/**
 * Main Street: loan payoff dialog copy model (pure)
 *
 * Phaser-free model that turns one {@link LoanPayoff} entry reported by the
 * end-of-turn closing (engine slice MS-0MW3SMTRO006M86W) plus a small seat
 * context into the congratulation the payoff dialog renders
 * (MS-0MW3SMVVP006ZD4V, parent MS-0MW1ZJDVE000MUID).
 *
 * It is the single home of four things:
 *
 * - **The copy** — the debt-free headline, the weekly amount no longer
 *   deducted and the total repaid over the term, all derived from the payoff
 *   entry's own figures (`perTurnRepayment`, `totalRepayment`, `termTurns`).
 *   The figures mirror the ones the HUD loan line showed before the loan
 *   disappeared, so the dialog can never contradict the HUD or the loan
 *   dialogs (producer Q2 = B: no separate interest-paid line).
 * - **The presentation gate** — {@link shouldPresentLoanPayoff} decides
 *   whether a payoff may be shown at all: never in `replayMode`/headless runs,
 *   never for a seat that is not the human seat (delegated to the existing
 *   {@link isHumanSeatCredit} seam, producer Q3 = A), and never when the same
 *   closing ended the run in a win or a loss — game over wins.
 *
 * It also owns the two scene-facing pieces that must not drift from that
 * gate: {@link deriveLoanPayoffContext} (one home for reading `replayMode`,
 * the payoff's seat, the roster and the closing result off the scene) and
 * {@link presentLoanPayoffDialogs} (the sequential, one-dialog-per-payoff
 * continuation used by the turn-flow layer before the End of Turn summary,
 * MS-0MW3SN58E009HC84).
 *
 * Read-only: nothing here mutates state, consumes RNG, or imports a Phaser
 * symbol, so the copy and the gate are unit-testable in a plain Node
 * environment.
 *
 * @module src/scenes/MainStreetLoanPayoffModel
 */

import { isHumanSeatCredit } from '../MainStreetChallenges';
import type { LoanPayoff } from '../MainStreetLoans';

// ── Types ───────────────────────────────────────────────────

/** One competitive seat record, as far as presentation gating needs it. */
export interface LoanPayoffSeatRecord {
  /** Seat id carried by the seat record (legacy fallback: seat 0 is human). */
  readonly playerId?: number;
  /** `'human'` or `'ai'`; absent records fall back to the seat convention. */
  readonly controller?: string;
}

/**
 * The presentation context a payoff is evaluated against.
 *
 * Deliberately a plain data object (never the whole `MainStreetState`) so the
 * model stays pure and the turn-flow layer can build it from whatever state
 * surface it holds.
 */
export interface LoanPayoffContext {
  /** True for headless/replay runs: never present UI. */
  readonly replayMode?: boolean;
  /** The seat whose payoff this is — normally the entry's `ownerId`. */
  readonly seatId?: number | null;
  /** Competitive seat records; single-player carries none. */
  readonly players?: ReadonlyArray<LoanPayoffSeatRecord> | null;
  /**
   * The closing's result. A congratulation never pre-empts a win/loss summary,
   * so anything other than a run still in progress suppresses it. Omitted is
   * treated as `'playing'` (the ordinary mid-run payoff).
   */
  readonly gameResult?: 'playing' | 'win' | 'loss';
}

/** The complete, presentation-ready content of the payoff dialog. */
export interface LoanPayoffContent {
  /** Debt-free congratulation. */
  readonly headline: string;
  /**
   * Body lines, in display order: the weekly amount no longer deducted, then
   * the total repaid over the term.
   */
  readonly body: readonly string[];
  /** Label of the single dismiss action. */
  readonly dismissLabel: string;
}

// ── Copy ────────────────────────────────────────────────────

/** Headline congratulating the seat on clearing its debt. */
const HEADLINE = 'You are debt free!';

/** The dialog has one action: continue exactly where the flow left off. */
const DISMISS_LABEL = 'Continue';

/** Pluralises the loan term's unit (the term is a whole number of turns). */
function formatWeeks(termTurns: number): string {
  return `${termTurns} week${termTurns === 1 ? '' : 's'}`;
}

// ── Gate ────────────────────────────────────────────────────

/**
 * Whether a payoff is presentable as a congratulatory dialog.
 *
 * One predicate for the whole rule, so the turn-flow layer and the renderer
 * cannot disagree:
 *
 * - `replayMode` (headless/replay runs) never presents UI;
 * - only the human seat is presented to — delegated to the existing
 *   {@link isHumanSeatCredit} seam, which allows single-player/legacy runs
 *   and the `controller === 'human'` seat in competitive play, and rejects AI
 *   and unknown seats;
 * - a closing that ends the run (a win or a loss) is presentation for the
 *   game-over overlay instead — a congratulation never hides it.
 *
 * @param ctx The presentation context (pure input).
 * @returns Whether the payoff dialog may be shown.
 */
export function shouldPresentLoanPayoff(ctx: LoanPayoffContext): boolean {
  if (ctx.replayMode) return false;
  if ((ctx.gameResult ?? 'playing') !== 'playing') return false;
  return isHumanSeatCredit({ players: ctx.players }, ctx.seatId);
}

// ── Scene-facing glue ───────────────────────────────────────

/**
 * The minimal scene surface the presentation context is derived from.
 *
 * Deliberately structural (no Phaser, no `MainStreetScene` import), so the
 * derivation is unit-testable and the turn-flow layer can pass its scene
 * without narrowing a type.
 */
export interface LoanPayoffScene {
  /** True for headless/replay runs: never present UI. */
  readonly replayMode?: boolean;
  /** The live game state the seat records and the closing result come from. */
  readonly state?: {
    readonly players?: ReadonlyArray<LoanPayoffSeatRecord> | null;
    readonly gameResult?: 'playing' | 'win' | 'loss';
  } | null;
  /**
   * The scene's payoff dialog. Its single continuation resumes the flow the
   * dialog interrupted; `false` means the dialog's own gate suppressed it.
   */
  readonly showLoanPayoffDialog?: (
    payoff: LoanPayoff,
    onDismiss: () => void,
  ) => boolean;
}

/**
 * Derives the model's presentation context from the live scene.
 *
 * One home for the derivation, so the renderer and the turn-flow sequencer can
 * never disagree about the seat, the replay flag or the closing result the
 * {@link shouldPresentLoanPayoff} gate reads.
 *
 * @param s      The scene (or a hand-built stand-in; anything absent is safe).
 * @param payoff The retired loan being considered.
 * @returns The pure presentation context.
 */
export function deriveLoanPayoffContext(
  s: LoanPayoffScene | null | undefined,
  payoff: LoanPayoff,
): LoanPayoffContext {
  const state = s?.state;
  return {
    replayMode: s?.replayMode === true,
    seatId: payoff.ownerId,
    players: state?.players ?? null,
    gameResult: state?.gameResult,
  };
}

/**
 * Presents one congratulation per reported payoff, then runs `next` — the flow
 * the dialogs interrupted (MS-0MW3SN58E009HC84).
 *
 * Sequencing rules, all in one place so the single-player and competitive
 * closings behave identically:
 *
 * - **one dialog per payoff, sequentially** — the next payoff is considered
 *   only once the previous dialog has been dismissed, so no more than one
 *   modal is ever active (the End of Turn summary's buttons can never be
 *   reached while a congratulation is up);
 * - every payoff passes the {@link shouldPresentLoanPayoff} gate first, so
 *   replay/headless runs, non-human seats and a run that already ended present
 *   nothing and the flow continues immediately;
 * - a scene with no dialog surface (headless/tests) or a dialog that reports
 *   itself suppressed (`false`) also continues immediately — the closing can
 *   never be stranded by a missing overlay;
 * - no payoffs → `next` runs synchronously, so a closing without a retirement
 *   behaves exactly as it did before the dialog existed.
 *
 * The dialog calls its continuation at most once (the renderer guards a double
 * dismissal), so the flow is never resumed twice for one payoff.
 *
 * @param s       The scene (structural — see {@link LoanPayoffScene}).
 * @param payoffs The closing's `TurnResult.loanPayoffs` (absent/empty is fine).
 * @param next    What to run once every dialog has been dismissed.
 */
export function presentLoanPayoffDialogs(
  s: LoanPayoffScene | null | undefined,
  payoffs: ReadonlyArray<LoanPayoff> | null | undefined,
  next: () => void,
): void {
  const list = payoffs ?? [];

  const presentFrom = (index: number): void => {
    if (index >= list.length) {
      next();
      return;
    }
    const payoff = list[index];
    // The dialog resumes the interrupted flow at most once; the renderer
    // guards against a second button press, so this never double-advances.
    const continueFlow = (): void => presentFrom(index + 1);

    if (!shouldPresentLoanPayoff(deriveLoanPayoffContext(s, payoff))) {
      continueFlow();
      return;
    }
    if (typeof s?.showLoanPayoffDialog !== 'function') {
      continueFlow();
      return;
    }
    // `false` = the renderer's own gate suppressed it (nothing was drawn).
    if (s.showLoanPayoffDialog(payoff, continueFlow) === false) continueFlow();
  };

  presentFrom(0);
}

// ── Model builder ───────────────────────────────────────────

/**
 * Builds the payoff dialog's copy from one reported payoff entry.
 *
 * Every figure is taken from the entry itself (the engine's own retirement
 * record), never recomputed from the live loan list — by the time the dialog
 * is presented the loan is already gone. The weekly (per-turn) amount and the
 * total repaid are the same figures the HUD loan line showed, and the term is
 * rendered in weeks (one turn = one week), matching the rules copy.
 *
 * @param payoff The retired loan, as reported on `TurnResult.loanPayoffs`.
 * @param ctx    The presentation context (see {@link shouldPresentLoanPayoff}).
 * @returns The dialog content, or `null` when the gate suppresses it.
 */
export function buildLoanPayoffContent(
  payoff: LoanPayoff,
  ctx: LoanPayoffContext,
): LoanPayoffContent | null {
  if (!shouldPresentLoanPayoff(ctx)) return null;
  return {
    headline: HEADLINE,
    body: [
      `${payoff.perTurnRepayment} coins/week is no longer deducted.`,
      `${payoff.totalRepayment} coins repaid over ${formatWeeks(payoff.termTurns)}.`,
    ],
    dismissLabel: DISMISS_LABEL,
  };
}
