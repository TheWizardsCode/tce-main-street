/**
 * Main Street: Competitive seat configuration tests
 *
 * Child MS-0MUTU8ICD002I1MK of epic MS-0MUTTVR5K002ZDUP. Covers the per-seat
 * controller/AI-strategy/AI-difficulty model:
 *
 *   AC1 — every competitive seat records `controller`; AI seats record an
 *         `aiStrategy` and `aiDifficulty`; the human seat is player 0.
 *   AC2 — a setup entry point maps a per-opponent strategy/difficulty list
 *         onto the seats.
 *   AC3 — invalid selections throw clear errors (zero AI opponents, unknown
 *         strategy/difficulty, list length mismatch).
 *   AC4 — single-player setup produces no seat records and is unchanged.
 *   AC5 — save/load round-trips the seat fields and legacy saves still load.
 */
import { describe, expect, it } from 'vitest';

import {
  setupMainStreetGame,
  createCompetitiveState,
  createStateFromModeSelection,
  serializeMainStreetState,
  deserializeMainStreetState,
  type CompetitiveOpponentConfig,
  type GameModeSelection,
  type MainStreetSerializedState,
  type MainStreetState,
} from '../../src/MainStreetState';
import { resolveSeatDifficulty } from '../../src/MainStreetAiStrategy';

/** Two configured opponents: random/easy and banking-greedy/hard. */
const OPPONENTS: CompetitiveOpponentConfig[] = [
  { strategy: 'Random', difficulty: 'Easy' },
  { strategy: 'BankingGreedy', difficulty: 'Hard' },
];

/** Returns the AI-controlled seats of a competitive state. */
function aiSeats(state: MainStreetState) {
  return (state.players ?? []).filter((p) => p.controller === 'ai');
}

// ── AC1: seat records ───────────────────────────────────────

describe('AC1 — competitive seat records', () => {
  it('marks player 0 as the human seat', () => {
    const state = createCompetitiveState({ seed: 'seat-human', playerCount: 3, opponents: OPPONENTS });
    const human = state.players![0];
    expect(human.playerId).toBe(0);
    expect(human.controller).toBe('human');
  });

  it('records controller, aiStrategy and aiDifficulty on every AI seat', () => {
    const state = createCompetitiveState({ seed: 'seat-ai', playerCount: 3, opponents: OPPONENTS });

    expect(state.players).toHaveLength(3);
    const ai = aiSeats(state);
    expect(ai).toHaveLength(2);

    expect(state.players![1]).toMatchObject({
      playerId: 1,
      controller: 'ai',
      aiStrategy: 'Random',
      aiDifficulty: 'Easy',
    });
    expect(state.players![2]).toMatchObject({
      playerId: 2,
      controller: 'ai',
      aiStrategy: 'BankingGreedy',
      aiDifficulty: 'Hard',
    });
  });
});

// ── AC2: setup entry points map the selection ───────────────

describe('AC2 — setup maps the opponent selection', () => {
  it('createCompetitiveState populates seats from playerCount + opponents', () => {
    const state = createCompetitiveState({ seed: 'map-basic', playerCount: 2, opponents: [OPPONENTS[0]] });
    expect(state.playerCount).toBe(2);
    expect(state.players![1].aiStrategy).toBe('Random');
    expect(state.players![1].aiDifficulty).toBe('Easy');
  });

  it('createStateFromModeSelection creates a competitive state sized to the opponents', () => {
    const selection: GameModeSelection = {
      mode: 'competitive',
      seed: 'map-mode',
      difficulty: 'Medium',
      opponents: OPPONENTS,
    };
    const state = createStateFromModeSelection(selection);

    expect(state.players).toHaveLength(OPPONENTS.length + 1);
    expect(state.playerCount).toBe(OPPONENTS.length + 1);
    expect(state.players![0].controller).toBe('human');
    expect(state.players!.slice(1).map((p) => p.controller)).toEqual(['ai', 'ai']);
    expect(state.players!.slice(1).map((p) => p.aiStrategy)).toEqual(['Random', 'BankingGreedy']);
    expect(state.players!.slice(1).map((p) => p.aiDifficulty)).toEqual(['Easy', 'Hard']);
  });

  it('createStateFromModeSelection single-player returns a seatless state', () => {
    const state = createStateFromModeSelection({ mode: 'single-player', seed: 'map-single' });
    expect(state.players).toBeUndefined();
    expect(state.playerCount).toBeUndefined();
  });
});

// ── AC3: validation ─────────────────────────────────────────

describe('AC3 — invalid selections throw clear errors', () => {
  it('rejects a competitive selection with zero AI opponents', () => {
    expect(() =>
      createStateFromModeSelection({ mode: 'competitive', seed: 'bad-zero', opponents: [] }),
    ).toThrow(/at least one AI opponent/i);
  });

  it('rejects a competitive selection that omits opponents', () => {
    const selection = { mode: 'competitive', seed: 'bad-missing' } as unknown as GameModeSelection;
    expect(() => createStateFromModeSelection(selection)).toThrow(/at least one AI opponent/i);
  });

  it('rejects an opponents list shorter than playerCount - 1', () => {
    expect(() =>
      createCompetitiveState({ seed: 'bad-short', playerCount: 3, opponents: [OPPONENTS[0]] }),
    ).toThrow(/playerCount - 1/i);
  });

  it('rejects an opponents list longer than playerCount - 1', () => {
    expect(() =>
      createCompetitiveState({ seed: 'bad-long', playerCount: 2, opponents: OPPONENTS }),
    ).toThrow(/playerCount - 1/i);
  });

  it('rejects an empty opponents list with playerCount 2 (length mismatch)', () => {
    expect(() =>
      createCompetitiveState({ seed: 'bad-empty', playerCount: 2, opponents: [] }),
    ).toThrow(/playerCount - 1/i);
  });

  it('rejects an unknown AI strategy', () => {
    const bad = [{ strategy: 'Omniscient', difficulty: 'Easy' }] as unknown as CompetitiveOpponentConfig[];
    expect(() =>
      createCompetitiveState({ seed: 'bad-strategy', playerCount: 2, opponents: bad }),
    ).toThrow(/Unknown AI strategy/i);
  });

  it('rejects an unknown AI difficulty', () => {
    const bad = [{ strategy: 'Greedy', difficulty: 'Nightmare' }] as unknown as CompetitiveOpponentConfig[];
    expect(() =>
      createCompetitiveState({ seed: 'bad-difficulty', playerCount: 2, opponents: bad }),
    ).toThrow(/Unknown AI difficulty/i);
  });
});

// ── AC4: single-player unchanged ────────────────────────────

describe('AC4 — single-player is unchanged', () => {
  it('setupMainStreetGame produces no seat records', () => {
    const state = setupMainStreetGame({ seed: 'sp-seatless', difficulty: 'Medium' });
    expect(state.players).toBeUndefined();
    expect(state.ownerTaggedGrid).toBeUndefined();
    expect(state.playerCount).toBeUndefined();
    expect(state.activePlayerId).toBeUndefined();
  });

  it('is byte-identical for the same seed and difficulty', () => {
    const a = serializeMainStreetState(setupMainStreetGame({ seed: 'sp-determinism', difficulty: 'Hard' }));
    const b = serializeMainStreetState(setupMainStreetGame({ seed: 'sp-determinism', difficulty: 'Hard' }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ── AC5: serialization round-trip & legacy compatibility ────

describe('AC5 — save/load round-trip', () => {
  it('round-trips controller/aiStrategy/aiDifficulty', () => {
    const state = createCompetitiveState({ seed: 'round-trip', playerCount: 3, opponents: OPPONENTS });
    const restored = deserializeMainStreetState(serializeMainStreetState(state));

    expect(restored.players).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(restored.players![i].controller).toBe(state.players![i].controller);
      expect(restored.players![i].aiStrategy).toBe(state.players![i].aiStrategy);
      expect(restored.players![i].aiDifficulty).toBe(state.players![i].aiDifficulty);
    }
  });

  it('loads a legacy save lacking seat fields, defaulting to human seats', () => {
    const state = createCompetitiveState({ seed: 'legacy-seat', playerCount: 2, opponents: [OPPONENTS[0]] });
    const saved = JSON.parse(JSON.stringify(serializeMainStreetState(state))) as MainStreetSerializedState & {
      players: Array<Record<string, unknown>>;
    };
    for (const player of saved.players) {
      delete player.controller;
      delete player.aiStrategy;
      delete player.aiDifficulty;
    }

    const restored = deserializeMainStreetState(saved as MainStreetSerializedState);
    expect(restored.players).toHaveLength(2);
    for (const player of restored.players!) {
      expect(player.controller).toBe('human');
    }
  });
});

// ── Per-seat difficulty resolver ────────────────────────────

describe('Per-seat difficulty resolver', () => {
  it('returns the AI seat difficulty for AI-controlled seats', () => {
    const state = createCompetitiveState({ seed: 'resolver-ai', playerCount: 3, opponents: OPPONENTS });
    expect(resolveSeatDifficulty(state, 1)).toBe('Easy');
    expect(resolveSeatDifficulty(state, 2)).toBe('Hard');
  });

  it('falls back to the global difficulty for the human seat', () => {
    const state = createCompetitiveState({
      seed: 'resolver-human',
      playerCount: 2,
      difficulty: 'Hard',
      opponents: [{ strategy: 'Greedy', difficulty: 'Easy' }],
    });
    expect(resolveSeatDifficulty(state, 0)).toBe('Hard');
  });

  it('uses the active seat when no playerId is given', () => {
    const state = createCompetitiveState({ seed: 'resolver-active', playerCount: 2, opponents: [OPPONENTS[1]] });
    state.activePlayerId = 1;
    expect(resolveSeatDifficulty(state)).toBe('Hard');
  });

  it('returns the global difficulty in single-player states', () => {
    const state = setupMainStreetGame({ seed: 'resolver-single', difficulty: 'Easy' });
    expect(resolveSeatDifficulty(state)).toBe('Easy');
  });
});
