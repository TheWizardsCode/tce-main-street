/**
 * Main Street: New Game Mode Selection (pure model)
 *
 * Pure, Phaser-free selection model for the pre-game "New Game" overlay
 * (child MS-0MUTU8INS009MRR1 of epic MS-0MUTTVR5K002ZDUP).
 *
 * The overlay UI is a thin view over this model: it keeps a
 * {@link NewGameSelection}, and on confirm calls
 * {@link createStateFromNewGameSelection} to build the game state. Keeping the
 * mapping here means the "selection → setup options" contract is unit-tested
 * independently of Phaser.
 *
 * @module
 */

import {
  AI_SEAT_DIFFICULTIES,
  AI_SEAT_STRATEGIES,
  createStateFromModeSelection,
  type AiSeatDifficulty,
  type AiSeatStrategy,
  type CompetitiveOpponentConfig,
  type GameModeSelection,
  type MainStreetSetupOptions,
  type MainStreetState,
} from '../MainStreetState';

/** Top-level mode offered by the selector. */
export type NewGameMode = 'single-player' | 'competitive';

/** Minimum / maximum AI opponents allowed in competitive mode. */
export const MIN_AI_OPPONENTS = 1;
export const MAX_AI_OPPONENTS = 3;

/** Per-opponent selection (strategy + decision-policy difficulty). */
export interface OpponentSelection {
  strategy: AiSeatStrategy;
  difficulty: AiSeatDifficulty;
}

/** The overlay's selection state. */
export interface NewGameSelection {
  mode: NewGameMode;
  /**
   * AI opponents (competitive only). Length must be within
   * {@link MIN_AI_OPPONENTS}..{@link MAX_AI_OPPONENTS} in competitive mode and
   * 0 in single-player.
   */
  opponents: OpponentSelection[];
}

/** The default selection shown when the overlay opens (single-player). */
export function defaultNewGameSelection(): NewGameSelection {
  return { mode: 'single-player', opponents: [] };
}

/** Creates a single opponent selection with sane defaults. */
export function createOpponentSelection(
  strategy: AiSeatStrategy = 'Greedy',
  difficulty: AiSeatDifficulty = 'Medium',
): OpponentSelection {
  return { strategy, difficulty };
}

/**
 * Validates a selection, throwing a clear error for any invalid combination
 * (AC: an invalid selection is rejected before state creation).
 */
export function validateNewGameSelection(selection: NewGameSelection): void {
  if (!selection || (selection.mode !== 'single-player' && selection.mode !== 'competitive')) {
    throw new Error(
      `Unknown game mode: ${String((selection as { mode?: unknown } | undefined)?.mode)}`,
    );
  }

  const opponents = selection.opponents ?? [];
  if (!Array.isArray(opponents)) {
    throw new Error('opponents must be an array');
  }

  if (selection.mode === 'single-player') {
    if (opponents.length > 0) {
      throw new Error('Single-player mode does not accept AI opponents');
    }
    return;
  }

  if (opponents.length < MIN_AI_OPPONENTS) {
    throw new Error(
      `Competitive mode requires at least ${MIN_AI_OPPONENTS} AI opponent`,
    );
  }
  if (opponents.length > MAX_AI_OPPONENTS) {
    throw new Error(
      `Competitive mode supports at most ${MAX_AI_OPPONENTS} AI opponents, got ${opponents.length}`,
    );
  }

  opponents.forEach((opponent, index) => {
    if (!opponent || typeof opponent !== 'object') {
      throw new Error(`opponents[${index}] must be an object`);
    }
    if (!AI_SEAT_STRATEGIES.includes(opponent.strategy)) {
      throw new Error(
        `Unknown AI strategy for opponents[${index}]: ${String(opponent.strategy)} ` +
          `(expected one of ${AI_SEAT_STRATEGIES.join(', ')})`,
      );
    }
    if (!AI_SEAT_DIFFICULTIES.includes(opponent.difficulty)) {
      throw new Error(
        `Unknown AI difficulty for opponents[${index}]: ${String(opponent.difficulty)} ` +
          `(expected one of ${AI_SEAT_DIFFICULTIES.join(', ')})`,
      );
    }
  });
}

/**
 * Builds the engine-level {@link GameModeSelection} from the overlay model.
 *
 * @param selection The overlay's selection.
 * @param options   Setup options (seed, global difficulty, unlocked cards,
 *                  endless mode). The per-opponent difficulty is separate
 *                  from the shared economy difficulty (producer Q3).
 * @throws When the selection is invalid.
 */
export function buildGameModeSelection(
  selection: NewGameSelection,
  options: MainStreetSetupOptions = {},
): GameModeSelection {
  validateNewGameSelection(selection);

  if (selection.mode === 'single-player') {
    return { mode: 'single-player', ...options };
  }

  const opponents: CompetitiveOpponentConfig[] = selection.opponents.map((opponent) => ({
    strategy: opponent.strategy,
    difficulty: opponent.difficulty,
  }));
  return { mode: 'competitive', opponents, ...options };
}

/**
 * Builds a ready-to-play state from the overlay selection (AC: Competitive
 * creates a state whose `players[]`/seat configuration matches the selection).
 *
 * @throws When the selection is invalid (before any state is created).
 */
export function createStateFromNewGameSelection(
  selection: NewGameSelection,
  options: MainStreetSetupOptions = {},
): MainStreetState {
  return createStateFromModeSelection(buildGameModeSelection(selection, options));
}
