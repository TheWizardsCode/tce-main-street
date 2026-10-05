/**
 * Main Street: Competitive turn driver (headless test support).
 *
 * Reusable acceptance harness for playable competitive mode
 * (child of epic MS-0MUTTVR5K002ZDUP). Drives a full human-vs-AI (or
 * AI-vs-AI) competitive game end-to-end against the existing engine seams —
 * the test-side counterpart of the scene's turn orchestration that later
 * siblings must keep green.
 *
 * Day loop (mirrors the engine's shared-day contract,
 * CG-0MT5X3GMA007EG30):
 *
 *   executeCompetitiveWeekStart
 *     → for each seat: bind seat → choose/execute actions → restore seat
 *                      → endCompetitiveMarketTurn
 *     → resolveCompetitiveClosingPhases
 *         (resolveCompetitivePendingChoice when the closing pauses on a
 *          dual-choice incident)
 *   …repeat until a terminal `gameResult` or the harness day cap.
 *
 * Seat actions are chosen through the shared AI seams
 * ({@link MainStreetAiStrategy.chooseAction}) and recorded to the transcript
 * as `ai-action` events, mirroring the scene contract used by
 * `MainStreetAiPlayer.playGame` / the Monte Carlo harness. Determinism comes
 * from the state seed (deck / incident order) plus one seeded RNG per seat.
 *
 * @module tests/main-street/helpers/competitiveTurnDriver
 */

import { createSeededRng } from '@core-engine';
import {
  createCompetitiveState,
  seedToNumber,
  type GameResult,
  type MainStreetState,
} from '../../../src/MainStreetState';
import {
  endCompetitiveMarketTurn,
  executeAction,
  executeCompetitiveWeekStart,
  resolveCompetitiveClosingPhases,
  resolveCompetitivePendingChoice,
  updateCompetitiveScores,
  type PlayerAction,
} from '../../../src/MainStreetEngine';
import {
  bindCompetitiveSeat,
  CompetitiveGreedyStrategy,
  restoreCompetitiveSeat,
  type MainStreetAiStrategy,
} from '../../../src/MainStreetAiStrategy';
import {
  getMainStreetRecorder,
  MainStreetTranscriptRecorder,
  recordMainStreetEvent,
  setMainStreetRecorder,
  type MainStreetTranscript,
} from '../../../src/MainStreetTranscript';

/** Harness-only day cap (not a game mechanic). */
export const DEFAULT_COMPETITIVE_DAY_CAP = 60;

/** Defensive cap on actions per seat per day — never spin inside one phase. */
const MAX_ACTIONS_PER_SEAT = 32;

/** Per-seat terminal snapshot captured at run end. */
export interface CompetitiveSeatOutcome {
  /** Owner index (index into `state.players`). */
  playerId: number;
  coins: number;
  reputation: number;
  score: number;
  /** Number of non-`end-turn` actions this seat executed across the run. */
  actionsTaken: number;
}

/** Result of driving a single competitive game to a terminal condition / cap. */
export interface CompetitiveGameRun {
  seed: string;
  /** True when the engine reached a terminal `gameResult` (not the day cap). */
  terminal: boolean;
  /** Number of shared days executed. */
  days: number;
  gameResult: GameResult;
  /** Engine end reason, or `'max_days_cap'` when the cap was reached. */
  endReason: string;
  /** Winning seat index, or `null` on a loss end condition / cap. */
  winnerId: number | null;
  /** Terminal per-seat snapshots (length = playerCount). */
  seats: CompetitiveSeatOutcome[];
  /** Number of days where the closing paused on a dual-choice incident. */
  pendingChoicesResolved: number;
  /** The final (mutated) game state, for deeper assertions. */
  state: MainStreetState;
  /** Transcript captured over the run (AI actions, turn-ends, engine info). */
  transcript: MainStreetTranscript;
}

/** Options for {@link runCompetitiveGame}. */
export interface RunCompetitiveGameOptions {
  /** Seed for decks, incidents and the per-seat AI RNGs. */
  seed: string;
  /** Number of seats (default 2 — human vs AI; N-player ready). */
  playerCount?: number;
  /** Harness day cap (default {@link DEFAULT_COMPETITIVE_DAY_CAP}). */
  maxDays?: number;
  /** Per-seat strategy (length must equal playerCount); default competitive greedy. */
  strategies?: readonly MainStreetAiStrategy[];
  /** Explicit per-seat RNGs (mainly for tests); default seeded per seat. */
  seatRngs?: readonly (() => number)[];
  /**
   * Override the win threshold (mainly for tests). Lets a test guarantee a
   * first-to-threshold win without depending on a fragile seed.
   */
  winThreshold?: number;
}

/**
 * Creates one deterministic RNG per seat from the run seed.
 *
 * Distinct per-seat streams mean each seat breaks action-scoring ties
 * independently, while the same seed still reproduces the identical game.
 */
export function createSeatRngs(seed: string, playerCount: number): Array<() => number> {
  return Array.from({ length: playerCount }, (_, playerId) =>
    createSeededRng(seedToNumber(`${seed}-seat-p${playerId}`)),
  );
}

/**
 * Resolves the per-seat strategy list, defaulting every seat to
 * {@link CompetitiveGreedyStrategy} (the ownership-aware, staff-free AI).
 */
export function resolveSeatStrategies(
  strategies: readonly MainStreetAiStrategy[] | undefined,
  playerCount: number,
): MainStreetAiStrategy[] {
  if (strategies && strategies.length === playerCount) return [...strategies];
  return Array.from({ length: playerCount }, () => CompetitiveGreedyStrategy);
}

/**
 * Drives one shared day: the opening WeekStart, then each seat's MarketPhase
 * (bind → choose/execute → restore → endCompetitiveMarketTurn). Leaves the
 * state at `InvestmentResolution` for the caller's closing phases, or at a
 * terminal result if the game ended mid-day.
 *
 * Executed (non-`end-turn`) actions are recorded to the active transcript as
 * `ai-action` events and counted into `actionsTaken` by seat.
 */
export function driveCompetitiveMarketPhases(
  state: MainStreetState,
  strategies: readonly MainStreetAiStrategy[],
  seatRngs: readonly (() => number)[],
  actionsTaken: number[],
): void {
  executeCompetitiveWeekStart(state);
  const playerCount = state.players?.length ?? 1;

  for (let playerId = 0; playerId < playerCount; playerId++) {
    // Eliminated seats take no further MarketPhase (MS-0MUVQRBVI0015AB2).
    if (state.players![playerId].eliminated) continue;
    if (state.gameResult !== 'playing' || state.phase !== 'MarketPhase') break;
    state.activePlayerId = playerId;

    let guard = 0;
    for (;;) {
      if (guard++ > MAX_ACTIONS_PER_SEAT) break;
      bindCompetitiveSeat(state, playerId);
      let action: PlayerAction;
      try {
        action = strategies[playerId].chooseAction(state, seatRngs[playerId]);
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
      actionsTaken[playerId] = (actionsTaken[playerId] ?? 0) + 1;
      recordMainStreetEvent({
        type: 'ai-action',
        turn: state.turn,
        strategy: strategies[playerId].name,
        action,
      });
      if (state.gameResult !== 'playing') break;
    }

    if (state.gameResult !== 'playing') break;
    if (state.phase === 'MarketPhase') endCompetitiveMarketTurn(state);
  }
}

/**
 * Runs a single competitive game to a terminal condition or the day cap.
 *
 * Installs a transcript recorder for the duration of the run (restored on
 * exit, even on error) so seat actions and engine events are captured. The
 * returned `seats` snapshots are refreshed with `updateCompetitiveScores`
 * so per-seat scores are current even when the game ended mid-day.
 */
export function runCompetitiveGame(options: RunCompetitiveGameOptions): CompetitiveGameRun {
  const {
    seed,
    playerCount = 2,
    maxDays = DEFAULT_COMPETITIVE_DAY_CAP,
    seatRngs: explicitRngs,
  } = options;

  const state = createCompetitiveState({ seed, playerCount });
  if (options.winThreshold !== undefined) {
    state.config = { ...state.config, winThreshold: options.winThreshold } as typeof state.config;
  }
  const strategies = resolveSeatStrategies(options.strategies, playerCount);
  const seatRngs = explicitRngs && explicitRngs.length === playerCount
    ? [...explicitRngs]
    : createSeatRngs(seed, playerCount);
  const actionsTaken = new Array<number>(playerCount).fill(0);

  const previousRecorder = getMainStreetRecorder();
  const recorder = new MainStreetTranscriptRecorder({
    week: state.week,
    year: state.year,
    turn: state.turn,
  });
  setMainStreetRecorder(recorder);

  let days = 0;
  let pendingChoicesResolved = 0;
  try {
    while (state.gameResult === 'playing' && days < maxDays) {
      driveCompetitiveMarketPhases(state, strategies, seatRngs, actionsTaken);
      days += 1;
      if (state.gameResult !== 'playing') break;
      if (state.phase !== 'InvestmentResolution') {
        // Unexpected phase before the closing — stop rather than throw, so a
        // stalled day is reported as non-terminal instead of an exception.
        break;
      }
      const closing = resolveCompetitiveClosingPhases(state);
      if (closing.choicePending) {
        // Dual-choice incident: resolve per the difficulty policy and finish
        // the shared-day closing (per-owner routing retained).
        resolveCompetitivePendingChoice(state);
        pendingChoicesResolved += 1;
      }
      recordMainStreetEvent({ type: 'turn-end', turn: state.turn });
    }
  } finally {
    setMainStreetRecorder(previousRecorder);
  }

  updateCompetitiveScores(state);
  const terminal = state.gameResult !== 'playing';
  const seats: CompetitiveSeatOutcome[] = (state.players ?? []).map(player => ({
    playerId: player.playerId,
    coins: player.coins,
    reputation: player.reputation,
    score: player.score,
    actionsTaken: actionsTaken[player.playerId] ?? 0,
  }));

  return {
    seed,
    terminal,
    days,
    gameResult: state.gameResult,
    endReason: state.endReason ?? (terminal ? 'unknown' : 'max_days_cap'),
    winnerId: state.competitiveWinnerId ?? null,
    seats,
    pendingChoicesResolved,
    state,
    transcript: recorder.getTranscript(),
  };
}

/**
 * Whether any pair of seats differs in coins, reputation or score — the
 * observable proof that the per-owner economy routed independently.
 */
export function seatsDiverge(seats: readonly CompetitiveSeatOutcome[]): boolean {
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      const a = seats[i];
      const b = seats[j];
      if (a.coins !== b.coins || a.reputation !== b.reputation || a.score !== b.score) {
        return true;
      }
    }
  }
  return false;
}
