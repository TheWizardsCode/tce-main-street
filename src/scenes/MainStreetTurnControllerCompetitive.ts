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
 *
 * All functions are Phaser-free and operate on `MainStreetState`, so they are
 * exercised by the node integration test while the scene wires them behind a
 * `isCompetitiveState` branch (single-player is untouched).
 *
 * @module
 */

import { createSeededRng } from '@core-engine';
import {
  executeAction,
  type PlayerAction,
  type TurnResult,
} from '../MainStreetEngine';
import {
  endCompetitiveMarketTurn,
  executeCompetitiveWeekStart,
  getActivePlayerId,
  resolveCompetitiveClosingPhases,
  resolveCompetitivePendingChoice,
} from '../MainStreetEngineCompetitiveTurn';
import {
  BankingGreedyStrategy,
  GreedyStrategy,
  MainStreetAiPlayer,
  RandomStrategy,
  bindCompetitiveSeat,
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
 */
function driveActiveAiSeat(
  state: MainStreetState,
  playerId: number,
  options: CompetitiveAiDriverOptions,
): number {
  const seat = state.players?.[playerId];
  if (!seat || seat.controller !== 'ai') return 0;

  const maxActions = options.maxActionsPerSeat ?? DEFAULT_MAX_ACTIONS_PER_AI_SEAT;
  const rng = (options.rngForSeat ?? ((id) => defaultSeatRng(state, id)))(playerId);
  const aiPlayer = createSeatAiPlayer(seat, rng);
  let actions = 0;

  for (let guard = 0; guard < maxActions; guard++) {
    if (state.gameResult !== 'playing' || state.phase !== 'MarketPhase') break;

    bindCompetitiveSeat(state, playerId);
    let action: PlayerAction;
    try {
      const difficulty = resolveSeatDifficulty(state, playerId);
      action = withSeatDifficulty(state, difficulty, () => aiPlayer.chooseAction(state));
    } catch {
      restoreCompetitiveSeat(state, playerId);
      break;
    }

    if (action.type === 'end-turn') {
      restoreCompetitiveSeat(state, playerId);
      break;
    }

    try {
      executeAction(state, action);
    } catch {
      // Illegal action from the strategy — end this seat's MarketPhase.
      restoreCompetitiveSeat(state, playerId);
      break;
    }
    restoreCompetitiveSeat(state, playerId);
    actions += 1;

    addLog(state, `AI ${playerId} ${describeAction(action)}`, 'neutral');
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

  for (let playerId = getActivePlayerId(state); playerId < players.length; playerId++) {
    if (state.gameResult !== 'playing' || state.phase !== 'MarketPhase') break;
    const seat = players[playerId];
    if (!seat || seat.controller !== 'ai') break; // human seat — await input

    state.activePlayerId = playerId;
    options.onActiveSeatChange?.(playerId);
    actions += driveActiveAiSeat(state, playerId, options);

    if (state.gameResult !== 'playing') break;
    if (state.phase === 'MarketPhase') endCompetitiveMarketTurn(state);
  }

  return actions;
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
  let result = resolveCompetitiveClosingPhases(state);
  if (result.choicePending) {
    result = resolveCompetitivePendingChoice(state) ?? result;
  }
  return result;
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

/**
 * Scene entry point for ending a competitive day (called by `endTurn`).
 *
 * Ends the human's MarketPhase, drives every AI seat to the shared closing,
 * runs the closing (resolving any paused choice) and hands control back to the
 * scene: game-over via `handleGameOver`, otherwise the next day via
 * `startTurnPhase`.
 */
export function endCompetitiveTurnDay(tcCtx: MainStreetTurnControllerContext): void {
  const s = tcCtx.scene;
  const state: MainStreetState = s.state;

  s.uiPhase = 'animating';
  try { s.instructionText?.setText?.('AI opponents are taking their turns...'); } catch { /* presentation-only */ }
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
  } else {
    // Competitive turn-boundary checkpoint (MS-0MUTU8JKV003UQFG): the closing
    // has advanced the shared day to WeekStart, so persist here (the
    // single-player path saves after processEndOfTurn).
    try { tcCtx.onSaveCheckpoint?.(); } catch { /* non-fatal */ }
    tcCtx.startTurnPhase();
  }
}
