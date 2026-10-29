/**
 * Main Street: Competitive Turn Orchestration (scene level)
 *
 * Scene-level shared-day orchestration for human-vs-AI competitive play
 * (epic MS-0MUTTVR5K002ZDUP, child MS-0MUTU8IYV0086PF6).
 *
 * The engine already owns the shared-day contract
 * (`MainStreetEngineCompetitiveTurn`): WeekStart → one MarketPhase per seat →
 * shared closing (Income → Incident → EndCheck). This module drives that
 * contract from the interactive scene:
 *
 *   1. {@link startCompetitiveDay} opens the day and binds the human seat.
 *   2. The human player acts while `activePlayerId === 0`
 *      ({@link canHumanSeatAct}); {@link endHumanMarketPhase} advances the
 *      active seat when they end their MarketPhase.
 *   3. {@link driveAiSeatsUntilClosing} takes every remaining AI seat,
 *      choosing actions with a {@link MainStreetAiPlayer} configured from that
 *      seat's strategy/difficulty and executing them through `executeAction`
 *      under a bounded guard.
 *   4. {@link runCompetitiveClosing} runs the shared closing and completes a
 *      paused dual-choice incident so the day never stalls.
 *   5. {@link presentCompetitiveClosing} presents the closing results as one
 *      phase-major income choreography over every non-eliminated seat, in seat
 *      order, with per-seat income text, then the shared incident reveal and
 *      next-day advance via the shared `presentTurnClosing` primitive
 *      (MS-0MUXAQQON006XA6I). Bounded and non-blocking, so the day never
 *      stalls even under reduced motion, replay or a headless context.
 *
 * All functions are Phaser-free and operate on `MainStreetState`, so they are
 * exercised by the node integration test while the scene wires them behind a
 * `isCompetitiveState` branch (single-player is untouched).
 *
 * @module
 */

import { createSeededRng } from '@core-engine';
import { flashConfirmation } from './MainStreetFeedback';
import {
  executeAction,
  findHumanSeatId,
  hasPendingPiggyback,
  type PlayerAction,
  type TurnResult,
} from '../MainStreetEngine';
import {
  endCompetitiveMarketTurn,
  executeCompetitiveWeekStart,
  getActivePlayerId,
  getNextActivePlayerId,
  resolveCompetitiveClosingPhases,
  resolveCompetitiveLoanOffer,
  resolveCompetitivePendingChoice,
  resolveCompetitivePendingPiggyback,
} from '../MainStreetEngineCompetitiveTurn';
import {
  BankingGreedyStrategy,
  GreedyStrategy,
  MainStreetAiPlayer,
  RandomStrategy,
  bindCompetitiveSeat,
  competitiveAiReserveCoins,
  resolveSeatDifficulty,
  restoreCompetitiveSeat,
  type MainStreetAiStrategy,
} from '../MainStreetAiStrategy';
import type { DifficultyName } from '../MainStreetDifficulty';
import {
  addLog,
  seedToNumber,
  type AiSeatStrategy,
  type MainStreetState,
  type PlayerRecord,
} from '../MainStreetState';
import { recordMainStreetEvent } from '../MainStreetTranscript';
import { continueAfterLastStanding, continueAfterThreshold } from '../MainStreetEngineTurnClosing';
import { closingSummary, perSeatClosingSummary, presentTurnClosing } from './MainStreetTurnControllerAnimation';
import { hasOpenBailoutOffer } from './MainStreetGameOverSummary';
import { COMPETITIVE_CLOSING_MAX_TOTAL_MS } from './MainStreetAnimatorTiming';
import type { OwnerIncomeResult } from '../MainStreetAdjacency';
import type { MainStreetTurnControllerContext } from './MainStreetTurnControllerContext';

/** Default hard cap on actions a single AI seat may take in one shared day. */
export const DEFAULT_MAX_ACTIONS_PER_AI_SEAT = 64;

/** True when the state carries a competitive roster (N >= 2 players). */
export function isCompetitiveState(state: MainStreetState): boolean {
  return (state.players?.length ?? 0) > 1;
}

/**
 * Whether the human seat may take an action. Always true in single-player;
 * in competitive mode only while the human seat (player 0) is active.
 */
export function canHumanSeatAct(state: MainStreetState): boolean {
  return !isCompetitiveState(state) || getActivePlayerId(state) === 0;
}

/** Maps a seat's stored strategy identifier to its strategy implementation. */
const STRATEGY_BY_ID: Record<AiSeatStrategy, MainStreetAiStrategy> = {
  Random: RandomStrategy,
  Greedy: GreedyStrategy,
  BankingGreedy: BankingGreedyStrategy,
};

/**
 * Resolves the strategy implementation for an AI seat. Falls back to
 * `Greedy` for legacy seats that predate the identifier.
 */
export function resolveSeatStrategy(
  seat: Pick<PlayerRecord, 'aiStrategy'> | undefined,
): MainStreetAiStrategy {
  return STRATEGY_BY_ID[seat?.aiStrategy ?? 'Greedy'] ?? GreedyStrategy;
}

/**
 * Builds the `MainStreetAiPlayer` for a seat from its strategy identifier.
 *
 * @param seat Seat record (strategy identifier read from `aiStrategy`).
 * @param rng  Deterministic tie-break RNG for the seat.
 */
export function createSeatAiPlayer(
  seat: Pick<PlayerRecord, 'aiStrategy'> | undefined,
  rng: () => number,
): MainStreetAiPlayer {
  return new MainStreetAiPlayer(resolveSeatStrategy(seat), rng);
}

/**
 * Runs `fn` with the shared `config.difficultyName` temporarily overridden to
 * `difficulty`, then restores it.
 *
 * Producer decision Q3 scopes a per-opponent difficulty to the AI decision
 * policy only. `difficultyName` is read by the AI policy (`scoreBankOption`)
 * and never by the per-action engine path, so a scoped override threads the
 * seat difficulty into the policy without mutating the shared economy.
 */
export function withSeatDifficulty<T>(
  state: MainStreetState,
  difficulty: DifficultyName,
  fn: () => T,
): T {
  const previous = state.config.difficultyName;
  if (previous === difficulty) return fn();
  state.config = { ...state.config, difficultyName: difficulty };
  try {
    return fn();
  } finally {
    state.config = { ...state.config, difficultyName: previous };
  }
}

/**
 * Opens a shared competitive day: runs `executeCompetitiveWeekStart` (shared
 * market refill, per-seat action budgets, `activePlayerId = 0`) and binds the
 * human seat so the shared action fields address player 0.
 */
export function startCompetitiveDay(
  state: MainStreetState,
  skipMarketRefill: boolean = false,
): void {
  // Mid-day resume (MS-0MUTU8JKV003UQFG): a loaded checkpoint can be armed in
  // MarketPhase with an active seat. Re-running WeekStart would reset the
  // per-seat budgets and `activePlayerId`; instead bind the saved active seat
  // and leave the shared day intact.
  const midDayResume =
    state.phase === 'MarketPhase' && (state.players?.length ?? 0) > 1;
  if (midDayResume) {
    bindCompetitiveSeat(state, getActivePlayerId(state));
    return;
  }

  executeCompetitiveWeekStart(state, skipMarketRefill);
  if (state.players && state.players.length > 0) {
    bindCompetitiveSeat(state, 0);
  }
}

/**
 * Ends the human player's MarketPhase: writes the shared wallet back into the
 * human seat and advances `activePlayerId` to the next seat. No-op when the
 * human seat is not the active seat or the day is not in MarketPhase.
 */
export function endHumanMarketPhase(state: MainStreetState): void {
  if (state.phase !== 'MarketPhase' || !isCompetitiveState(state)) return;
  if (!canHumanSeatAct(state)) return;
  restoreCompetitiveSeat(state, getActivePlayerId(state));
  endCompetitiveMarketTurn(state);
}

/** Callbacks the scene uses to keep its presentation in sync with AI seats. */
export interface CompetitiveAiDriverOptions {
  /** Called whenever the active seat changes (active-seat indicator). */
  onActiveSeatChange?: (playerId: number) => void;
  /** Called after each AI action is executed (scene-level VFX/log hooks). */
  onAiAction?: (playerId: number, action: PlayerAction) => void;
  /** Bounded guard: maximum actions a single AI seat may take. */
  maxActionsPerSeat?: number;
  /** Deterministic per-seat RNG factory. Defaults to a seed-derived stream. */
  rngForSeat?: (playerId: number) => () => number;
}

/** Human-readable one-line summary of an AI action for the activity log. */
function describeAction(action: PlayerAction): string {
  switch (action.type) {
    case 'buy-business':
      return `bought business ${action.cardId}`;
    case 'buy-upgrade':
      return `bought upgrade ${action.cardId}`;
    case 'buy-event':
      return `bought event ${action.cardId}`;
    case 'move-to-hand':
      return `moved ${action.cardId} to hand`;
    case 'play-business-from-hand':
      return `placed business from hand`;
    case 'play-upgrade-from-hand':
      return `played upgrade from hand`;
    case 'play-event-from-hand':
      return `played event from hand`;
    case 'discard-from-hand':
      return `discarded a hand card`;
    case 'close-business':
      return `closed a street card`;
    case 'community-favour':
      return `used Community Favour`;
    case 'end-turn':
      return `ended their turn`;
    default:
      return action.type;
  }
}

/**
 * Default deterministic per-seat RNG: derived from the game seed and the seat
 * index so the same seed reproduces the same AI tie-breaks.
 */
function defaultSeatRng(state: MainStreetState, playerId: number): () => number {
  return createSeededRng(seedToNumber(`${state.seed}-seat-${playerId}`));
}

/**
 * Drives one AI seat through its MarketPhase: bind → choose/execute actions →
 * restore → advance the seat. Returns the number of executed actions.
 *
 * The bounded guard ({@link CompetitiveAiDriverOptions.maxActionsPerSeat})
 * stops a misbehaving strategy from looping forever; illegal actions and
 * strategy errors end the seat's phase rather than throwing into the scene.
 *
 * Every bind/restore pair passes the seat's liquidity reserve
 * ({@link competitiveAiReserveCoins}, MS-0MVJNFESC005QJ41) so the AI cannot
 * spend its last coins and then be bankrupted by the shared closing (ongoing
 * costs + the day's incident) — the reported "AI bankrupt in the first turn"
 * behaviour. The reserve only limits the AI's *spendable* view of its wallet;
 * the seat's real balance is unchanged (see `bindCompetitiveSeat`).
 */
function driveActiveAiSeat(
  state: MainStreetState,
  playerId: number,
  options: CompetitiveAiDriverOptions,
): number {
  const seat = state.players?.[playerId];
  if (!seat || seat.controller !== 'ai') return 0;
  // Eliminated seats take no further MarketPhase (MS-0MUVQRBVI0015AB2).
  if (seat.eliminated) return 0;

  const maxActions = options.maxActionsPerSeat ?? DEFAULT_MAX_ACTIONS_PER_AI_SEAT;
  const rng = (options.rngForSeat ?? ((id) => defaultSeatRng(state, id)))(playerId);
  const aiPlayer = createSeatAiPlayer(seat, rng);
  const difficulty = resolveSeatDifficulty(state, playerId);
  const reserve = competitiveAiReserveCoins(state, difficulty);
  let actions = 0;

  for (let guard = 0; guard < maxActions; guard++) {
    if (state.gameResult !== 'playing' || state.phase !== 'MarketPhase') break;

    bindCompetitiveSeat(state, playerId, reserve);
    let action: PlayerAction;
    try {
      action = withSeatDifficulty(state, difficulty, () => aiPlayer.chooseAction(state));
    } catch {
      restoreCompetitiveSeat(state, playerId, reserve);
      break;
    }

    if (action.type === 'end-turn') {
      restoreCompetitiveSeat(state, playerId, reserve);
      break;
    }

    try {
      executeAction(state, action);
    } catch {
      // Illegal action from the strategy — end this seat's MarketPhase.
      restoreCompetitiveSeat(state, playerId, reserve);
      break;
    }
    restoreCompetitiveSeat(state, playerId, reserve);
    actions += 1;

    addLog(state, playerId, describeAction(action), 'neutral');
    try {
      recordMainStreetEvent({ type: 'ai-action', turn: state.turn, strategy: resolveSeatStrategy(seat).name, action });
    } catch { /* transcript is optional (headless) */ }
    options.onAiAction?.(playerId, action);

    if (state.gameResult !== 'playing') break;
  }

  return actions;
}

/**
 * Drives every remaining AI seat until the shared day reaches the closing
 * phases (or the game ends). The human seat is never driven: when the active
 * seat is the human (or the phase has already left MarketPhase) this is a
 * no-op, so control returns to the player with no manual intervention.
 *
 * @returns The number of AI actions executed.
 */
export function driveAiSeatsUntilClosing(
  state: MainStreetState,
  options: CompetitiveAiDriverOptions = {},
): number {
  if (!isCompetitiveState(state)) return 0;

  const players = state.players ?? [];
  let actions = 0;

  for (let playerId = getActivePlayerId(state); playerId >= 0 && playerId < players.length; playerId = getNextActivePlayerId(state, playerId)) {
    if (state.gameResult !== 'playing' || state.phase !== 'MarketPhase') break;
    const seat = players[playerId];
    if (!seat || seat.eliminated) continue; // eliminated seats take no further turn
    if (seat.controller !== 'ai') break; // human seat — await input

    state.activePlayerId = playerId;
    options.onActiveSeatChange?.(playerId);
    actions += driveActiveAiSeat(state, playerId, options);

    if (state.gameResult !== 'playing') break;
    if (state.phase === 'MarketPhase') endCompetitiveMarketTurn(state);
  }

  return actions;
}

/**
 * True when the state carries a pending piggyback decision the HUMAN seat
 * must still resolve (F5 of MS-0MUYC47EL005Z69H). The shared closing pauses
 * on this seat: the human is prompted to join fully or keep the 50% share
 * before the day continues.
 */
export function humanSeatPiggybackPending(state: MainStreetState): boolean {
  if (!hasPendingPiggyback(state)) return false;
  const humanId = findHumanSeatId(state);
  if (humanId < 0) return false;
  const pending = state.pendingPiggyback;
  return (pending?.decisions ?? []).some(
    (decision) => decision.seatId === humanId && !decision.resolved,
  );
}

/**
 * Runs the shared competitive closing once every seat has acted, resolving a
 * paused dual-choice incident inline so the day never stalls.
 *
 * @returns The closing `TurnResult`, or `null` when the day is not at the
 *          closing phase.
 */
export function runCompetitiveClosing(state: MainStreetState): TurnResult | null {
  if (state.phase !== 'InvestmentResolution') return null;
  const closing = resolveCompetitiveClosingPhases(state);
  if (closing.piggybackPending) {
    // F3 (epic MS-0MUYC47EL005Z69H): an eligible organiser event raised
    // pending piggyback decisions. F5 (MS-0MV8BG5OQ003XUJW): when the
    // human seat still holds an unresolved decision, pause instead of
    // auto-settling — the scene presents the join-fully / keep-50% prompt
    // (mirrors the choice-pending pause below) and `onPiggybackChoice`
    // resumes the shared day. Otherwise settle every seat (AI seats via the
    // F4 determininstic policy, humans via the free-ride default) so the
    // headless/replay day never stalls.
    if (humanSeatPiggybackPending(state)) {
      return closing;
    }
    return resolveCompetitivePendingPiggyback(state) ?? closing;
  }
  if (!closing.choicePending) return closing;
  const resolved = resolveCompetitivePendingChoice(state) ?? closing;
  // A dual-choice incident pauses the closing *after* the income phase. The
  // deferred continuation does not re-run income, so carry the per-owner data
  // captured before the pause through to the presented result
  // (MS-0MUYFX56M006RVIZ).
  if (resolved.playerIncome === undefined) {
    resolved.playerIncome = closing.playerIncome;
  }
  return resolved;
}

/** Minimal turn result describing a state that ended outside the closing. */
function turnResultFromState(state: MainStreetState): TurnResult {
  return {
    income: null,
    incident: null,
    incidentCoinChange: 0,
    incidentRepChange: 0,
    gameResult: state.gameResult,
    finalScore: state.finalScore,
    newlyCompletedChallenges: [],
    choicePending: false,
  };
}

/** Brief hold after the closing summary before the next shared day starts. */
export const COMPETITIVE_CLOSING_HOLD_MS = 900;

/**
 * Builds the one-line closing summary shown to the player: the shared income
 * total and, when one resolved, the incident name. Returns an empty string
 * when there is nothing to report (e.g. a turn that ended outside the closing).
 *
 * Delegates to the shared {@link closingSummary} used by the single-player
 * `finishTurnPresentation`, so both flows report the closing identically
 * (MS-0MUYFX7Q2004JQ5R).
 */
export function competitiveClosingSummary(result: TurnResult): string {
  return closingSummary(result);
}

/**
 * Presents the shared competitive closing results then calls `onComplete`
 * exactly once. Non-blocking and bounded: reduced motion, replay and headless
 * contexts skip the animation and advance immediately, so the next day always
 * starts.
 *
 * Two paths share the one closing primitive (`presentTurnClosing`):
 *
 *  - **Per-seat (AC1–AC3):** when the closing surfaced authoritative
 *    per-owner income (`result.playerIncome`, from
 *    `applyCompetitiveIncome`), the presentation runs one phase-major income
 *    choreography over every non-eliminated seat, in seat order, using each
 *    seat's own `phaseBreakdown.perSlotBreakdown`. The engine already filtered
 *    eliminated seats, so iterating `playerIncome` skips them. The closing
 *    summary reports each seat's own income (`Player N: +X coins`), never the
 *    shared host total, which can differ from any seat's actual income.
 *  - **Legacy/shared:** with no per-owner data, it keeps the condensed shared
 *    summary used by single-player-free callers.
 *
 *  - AC1: one phase-major income choreography over all seats (or per-seat text
 *         when animations are disabled).
 *  - AC2: incident reveal (name + deltas) when an incident resolved, once per
 *         shared day.
 *  - AC3: instruction text reports each seat's income.
 *  - AC4: the next day always starts (bounded); text feedback survives reduced
 *         motion, replay and headless contexts.
 *
 * @param tcCtx      Scene context (only `scene` is used).
 * @param result     The closing `TurnResult` from `runCompetitiveClosing`.
 * @param onComplete Invoked exactly once when the presentation is done.
 */
export function presentCompetitiveClosing(
  tcCtx: MainStreetTurnControllerContext,
  result: TurnResult,
  onComplete: () => void,
): void {
  const seats = result.playerIncome ?? [];
  if (seats.length === 0) {
    // Legacy/shared path (no per-owner data): condensed shared summary.
    presentTurnClosing(tcCtx, result, onComplete, {
      statusText: 'Resolving end-of-turn effects...',
      completionText: 'End of turn complete.',
      holdMs: COMPETITIVE_CLOSING_HOLD_MS,
    });
    return;
  }
  presentPerSeatCompetitiveClosing(tcCtx, result, seats, onComplete);
}

/**
 * Per-seat competitive closing presentation (MS-0MUXAQQON006XA6I, amended by
 * the producer audit of 2026-10-08): a single phase-major income choreography
 * over every non-eliminated seat, in seat order, followed by the shared
 * incident reveal and the day advance.
 *
 * The seats' `income.phaseBreakdown.perSlotBreakdown` lists are concatenated in
 * seat order and handed to `animateIncomePhases` once. `runIncomePhase` walks
 * the combined slot list per phase, so each phase (base → synergy → reputation
 * → events → upcoming → collection) plays for the human seat, then AI 1, then
 * AI 2, before the next phase begins — rather than a full seat-major
 * choreography per seat.
 *
 * Presentation-only and Phaser-free-by-contract: it reads `result.playerIncome`
 * and the scene's animator surface, mutates no engine state and consumes no
 * RNG. Reduced motion / replay / headless skip the animations but still show
 * the per-seat text and advance the day (bounded).
 */
function presentPerSeatCompetitiveClosing(
  tcCtx: MainStreetTurnControllerContext,
  result: TurnResult,
  seats: OwnerIncomeResult[],
  onComplete: () => void,
): void {
  const s = tcCtx.scene;
  const replay = s.replayMode === true;
  const reducedMotion = s.settingsPanel?.reducedMotion === true;
  const animationsEnabled = !replay && !reducedMotion;

  // AC3: per-seat income feedback from each seat's own authoritative total.
  // Set before the choreography so reduced motion / replay / headless still
  // receive the text; the shared host total is never shown.
  const summary = perSeatClosingSummary(seats);
  if (summary) {
    flashConfirmation(s, summary);
  }

  // AC1 (amended by the producer audit of 2026-10-08): one phase-major sweep
  // over all non-eliminated seats. The seats' slot lists are concatenated in
  // seat order; the shared choreography emits each phase once and iterates the
  // combined slots in order, so the human seat, then AI 1, then AI 2 play each
  // phase in turn. The engine has already applied the per-owner deltas to each
  // `PlayerRecord` during the shared closing, so no deferred-delta payload is
  // forwarded here (re-sending the shared result would double-apply it); the
  // deferred-delta window is preserved by the existing HUD gating instead: the
  // competitive scoreboard is not refreshed during the closing, and the shared
  // HUD is gated by `incomeCollectionActive` while the choreography runs, so
  // numbers update only once play resumes.
  if (animationsEnabled) {
    const combined = seats.flatMap(
      (seat) => seat.income?.phaseBreakdown?.perSlotBreakdown ?? [],
    );
    if (combined.length > 0) {
      try {
        s.msAnimator?.animateIncomePhases?.(combined);
      } catch {
        // presentation-only — never stall the closing on an animation failure
      }
    }
  }

  // AC2/AC4/AC6: the shared incident reveal (once per shared day) and the day
  // advance are driven by the same primitive as single-player. The primitive
  // waits for the phase-major choreography to finish collecting before it
  // advances (`waitForIncomeCollection`), bounded by the global closing cap, so
  // the animation is never left running in the background while the next day
  // starts. The primitive's shared income summary is suppressed (empty)
  // because the per-seat lines above replace it (AC3).
  presentTurnClosing(tcCtx, result, onComplete, {
    completionText: 'End of turn complete.',
    holdMs: 0,
    incomeSummary: '',
    waitForIncomeCollection: true,
    incomeCollectionCapMs: COMPETITIVE_CLOSING_MAX_TOTAL_MS,
  });
}

/**
 * Scene entry point for ending a competitive day (called by `endTurn`).
 *
 * Ends the human's MarketPhase, drives every AI seat to the shared closing,
 * runs the closing (resolving any paused choice), presents the closing results
 * via {@link presentCompetitiveClosing} and hands control back to the scene:
 * game-over via `handleGameOver`, otherwise the next day via `startTurnPhase`.
 * The presentation is bounded/non-blocking, so the next day always starts.
 */
export function endCompetitiveTurnDay(tcCtx: MainStreetTurnControllerContext): void {
  const s = tcCtx.scene;
  const state: MainStreetState = s.state;

  s.uiPhase = 'animating';
  try { s.refreshActionButtons?.(); } catch { /* presentation-only */ }

  if (state.gameResult === 'playing') {
    endHumanMarketPhase(state);
  }

  if (state.gameResult === 'playing') {
    driveAiSeatsUntilClosing(state, {
      onActiveSeatChange: (playerId) => {
        s.activeSeatId = playerId;
        try { s.refreshAll?.(); } catch { /* presentation-only */ }
      },
    });
  }

  if (state.gameResult !== 'playing') {
    tcCtx.handleGameOver(turnResultFromState(state));
    return;
  }

  const closing = runCompetitiveClosing(state) ?? turnResultFromState(state);
  if (state.gameResult !== 'playing') {
    tcCtx.handleGameOver(closing);
  } else if (
    closing.piggybackPending &&
    humanSeatPiggybackPending(state) &&
    typeof tcCtx.presentPiggybackDialog === 'function'
  ) {
    // F5 (MS-0MV8BG5OQ003XUJW): the closing paused on the human seat's
    // piggyback decision (another seat organised an eligible event). Present
    // the join-fully / keep-50% prompt; `onPiggybackChoice` resolves via an
    // undoable command and re-runs the closing so the day never stalls.
    tcCtx.presentPiggybackDialog();
  } else if (closing.piggybackPending) {
    // No interactive prompt surface: settle the pending human decision
    // headlessly (AI seats via the F4 policy, humans via the free-ride
    // default) and finish the closing so the day always advances (AC3).
    const settled =
      resolveCompetitivePendingPiggyback(state) ?? closing;
    presentCompetitiveDayTail(tcCtx, settled);
  } else {
    presentCompetitiveDayTail(tcCtx, closing);
  }
}

/**
 * Presents the finished competitive closing (or the game-over result) then
 * advances the shared day. Shared by the normal close path and the F5
 * piggyback continuation so both flows report identically
 * (checkpoint → closing summary → next day).
 */
export function presentCompetitiveDayTail(
  tcCtx: MainStreetTurnControllerContext,
  closing: TurnResult,
): void {
  const state: MainStreetState = tcCtx.scene.state;
  // Competitive seat bailout pause (MS-0MVPWSAMH005LV9R): while a seat's offer
  // is open the shared day has NOT closed — present the dialog and wait. The
  // resumed closing re-enters this tail (accept continues the day, decline
  // produces today's bankruptcy outcome).
  if (closing.pendingLoanOffer === true || hasOpenBailoutOffer(state)) {
    if (typeof tcCtx.presentLoanOfferDialog === 'function' && tcCtx.presentLoanOfferDialog(closing)) {
      return;
    }
    // No interactive surface (headless/replay): resolve deterministically with
    // the AI policy so the day never stalls.
    if (state.pendingLoanOffer) {
      presentCompetitiveDayTail(tcCtx, resolveCompetitiveLoanOffer(state, closing));
      return;
    }
  }
  if (state.gameResult !== 'playing') {
    tcCtx.handleGameOver(closing);
    return;
  }
  // Competitive turn-boundary checkpoint (MS-0MUTU8JKV003UQFG): the closing
  // has advanced the shared day to WeekStart, so persist here (the
  // single-player path saves after processEndOfTurn).
  try { tcCtx.onSaveCheckpoint?.(); } catch { /* non-fatal */ }
  // Present the closing (income → incident → end check) before the next day
  // starts. Bounded/non-blocking: the day always advances (AC4).
  presentCompetitiveClosing(tcCtx, closing, () => tcCtx.startTurnPhase());
}

/**
 * Continues the shared day after the human resolves their piggyback decision
 * (F5 of MS-0MUYC47EL005Z69H). The human seat is resolved via the undoable
 * command in `onPiggybackChoice`; this re-runs the closing — settling any
 * remaining seats (AI seats via the F4 deterministic policy) — and presents
 * the finished closing so the day always advances (AC3: no stall).
 */
export function continueCompetitiveDayAfterPiggyback(
  tcCtx: MainStreetTurnControllerContext,
): void {
  const state: MainStreetState = tcCtx.scene.state;
  const closing = runCompetitiveClosing(state) ?? turnResultFromState(state);
  presentCompetitiveDayTail(tcCtx, closing);
}

/**
 * Resumes play after a last-standing win when the player accepts the
 * continue-solo offer (MS-0MUVQRCQJ00737UV). The scene calls this from the
 * win overlay's "Continue solo" action; declining simply leaves the state at
 * the `win` / `last_standing` result (no call).
 *
 * Idempotent: a no-op unless the offer is open (`endReason ===
 * 'last_standing'`).
 *
 * @returns `true` when play resumed, `false` when no offer was open.
 */
export function continueCompetitiveLastStanding(
  tcCtx: MainStreetTurnControllerContext,
): boolean {
  const state: MainStreetState = tcCtx.scene.state;
  if (!continueAfterLastStanding(state)) return false;
  tcCtx.scene.uiPhase = 'market';
  tcCtx.startTurnPhase();
  return true;
}

/**
 * Resumes play after the endless-continuation offer is accepted
 * (CG-0MTIILU5V006GCN4): the score threshold was reached with
 * `config.endlessMode === true`, the winner was declared, and the end-game
 * overlay showed the "Enter Endless Mode" action. The scene calls this from
 * that action; declining simply leaves the declared win.
 *
 * Idempotent: a no-op unless the offer is open (`endReason ===
 * 'score_threshold_continue'` and `gameResult !== 'playing'`).
 *
 * @returns `true` when play resumed, `false` when no offer was open.
 */
export function continueEndlessMode(
  tcCtx: MainStreetTurnControllerContext,
): boolean {
  const state: MainStreetState = tcCtx.scene.state;
  if (!continueAfterThreshold(state)) return false;
  tcCtx.scene.uiPhase = 'market';
  tcCtx.startTurnPhase();
  return true;
}
