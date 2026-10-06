/**
 * Main Street: New Game mode-selection model tests
 *
 * Child MS-0MUTU8INS009MRR1 of epic MS-0MUTTVR5K002ZDUP. Unit tests for the
 * pure selection → setup-options builder that backs the pre-game "New Game"
 * overlay. Runs independently of Phaser.
 */
import { describe, expect, it } from 'vitest';

import {
  MAX_AI_OPPONENTS,
  buildGameModeSelection,
  createOpponentSelection,
  createStateFromNewGameSelection,
  defaultNewGameSelection,
  validateNewGameSelection,
  type NewGameSelection,
} from '../../src/scenes/MainStreetNewGameSelection';

/** Valid single-player selection. */
const SINGLE: NewGameSelection = { mode: 'single-player', opponents: [] };

/** Valid competitive selection with two configured opponents. */
const COMPETITIVE: NewGameSelection = {
  mode: 'competitive',
  opponents: [
    { strategy: 'Random', difficulty: 'Easy' },
    { strategy: 'BankingGreedy', difficulty: 'Hard' },
  ],
};

describe('NewGameSelection defaults and helpers', () => {
  it('defaults to single-player with no opponents', () => {
    expect(defaultNewGameSelection()).toEqual({ mode: 'single-player', opponents: [] });
  });

  it('creates an opponent selection with sane defaults', () => {
    expect(createOpponentSelection()).toEqual({ strategy: 'Greedy', difficulty: 'Medium' });
  });
});

describe('validateNewGameSelection', () => {
  it('accepts single-player with no opponents', () => {
    expect(() => validateNewGameSelection(SINGLE)).not.toThrow();
  });

  it('accepts competitive with 1..MAX opponents', () => {
    for (let count = 1; count <= MAX_AI_OPPONENTS; count++) {
      const selection: NewGameSelection = {
        mode: 'competitive',
        opponents: Array.from({ length: count }, () => createOpponentSelection()),
      };
      expect(() => validateNewGameSelection(selection)).not.toThrow();
    }
  });

  it('rejects competitive with zero opponents', () => {
    expect(() => validateNewGameSelection({ mode: 'competitive', opponents: [] })).toThrow(
      /at least 1 AI opponent/i,
    );
  });

  it('rejects competitive with more than MAX opponents', () => {
    const selection: NewGameSelection = {
      mode: 'competitive',
      opponents: Array.from({ length: MAX_AI_OPPONENTS + 1 }, () => createOpponentSelection()),
    };
    expect(() => validateNewGameSelection(selection)).toThrow(/at most 3 AI opponents/i);
  });

  it('rejects single-player carrying opponents', () => {
    const selection = { mode: 'single-player', opponents: [createOpponentSelection()] } as NewGameSelection;
    expect(() => validateNewGameSelection(selection)).toThrow(/does not accept AI opponents/i);
  });

  it('rejects an unknown mode', () => {
    const selection = { mode: 'sandbox', opponents: [] } as unknown as NewGameSelection;
    expect(() => validateNewGameSelection(selection)).toThrow(/Unknown game mode/i);
  });

  it('rejects an unknown strategy', () => {
    const selection = {
      mode: 'competitive',
      opponents: [{ strategy: 'Omniscient', difficulty: 'Easy' }],
    } as unknown as NewGameSelection;
    expect(() => validateNewGameSelection(selection)).toThrow(/Unknown AI strategy/i);
  });

  it('rejects an unknown difficulty', () => {
    const selection = {
      mode: 'competitive',
      opponents: [{ strategy: 'Greedy', difficulty: 'Nightmare' }],
    } as unknown as NewGameSelection;
    expect(() => validateNewGameSelection(selection)).toThrow(/Unknown AI difficulty/i);
  });
});

describe('buildGameModeSelection', () => {
  it('maps single-player to a seatless mode selection', () => {
    const built = buildGameModeSelection(SINGLE, { difficulty: 'Hard' });
    expect(built).toEqual({ mode: 'single-player', difficulty: 'Hard' });
  });

  it('maps competitive onto the engine opponent list', () => {
    const built = buildGameModeSelection(COMPETITIVE, { difficulty: 'Medium' });
    expect(built).toEqual({
      mode: 'competitive',
      difficulty: 'Medium',
      opponents: [
        { strategy: 'Random', difficulty: 'Easy' },
        { strategy: 'BankingGreedy', difficulty: 'Hard' },
      ],
    });
  });

  it('rejects an invalid selection before building', () => {
    expect(() => buildGameModeSelection({ mode: 'competitive', opponents: [] })).toThrow();
  });
});

describe('createStateFromNewGameSelection', () => {
  it('builds a single-player state with no seat records', () => {
    const state = createStateFromNewGameSelection(SINGLE, { seed: 'sel-single', difficulty: 'Easy' });
    expect(state.players).toBeUndefined();
    expect(state.playerCount).toBeUndefined();
    expect(state.config.difficultyName).toBe('Easy');
  });

  it('builds a competitive state whose seats match the selection', () => {
    const state = createStateFromNewGameSelection(COMPETITIVE, { seed: 'sel-comp', difficulty: 'Medium' });
    expect(state.players).toHaveLength(3);
    expect(state.playerCount).toBe(3);
    expect(state.players![0].controller).toBe('human');
    expect(state.players!.slice(1).map((p) => p.controller)).toEqual(['ai', 'ai']);
    expect(state.players!.slice(1).map((p) => p.aiStrategy)).toEqual(['Random', 'BankingGreedy']);
    expect(state.players!.slice(1).map((p) => p.aiDifficulty)).toEqual(['Easy', 'Hard']);
  });
});
