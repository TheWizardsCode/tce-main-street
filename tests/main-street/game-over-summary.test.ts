/**
 * Main Street: Game-Over summary fixtures and harness
 *
 * Reusable, Phaser-free fixtures for the two-column Game Over overlay
 * (epic MS-0MUWDL0V40041USM, child MS-0MUWE6MA30038RGY).
 *
 * This module is the shared harness the later Game Over children build on:
 *
 * - {@link END_REASONS} enumerates every member of the `EndReason` union
 *   (including `null`), with a compile-time exhaustiveness guard so adding a
 *   new reason without updating the fixture list fails the type-check.
 * - {@link makeGameOverState} builds a valid `MainStreetState` for a given
 *   end reason in single-player or competitive (1-AI / 3-AI) shape, applying
 *   per-seat `PlayerRecord` overrides (coins, reputation, score, controller,
 *   eliminated).
 *
 * The smoke tests below prove each fixture is constructed correctly; the
 * per-reason headline and per-player row tests added by the summary-model
 * child import these builders.
 *
 * @module tests/main-street/game-over-summary
 */

import { describe, expect, it } from 'vitest';

import type {
  EndReason,
  GameResult,
  MainStreetState,
  PlayerRecord,
  SeatController,
} from '../../src/MainStreetState';
import { setupMainStreetGame } from '../../src/MainStreetState';
import { buildHumanVsAis } from './helpers/competitive-fixtures';

// ── End reasons ───────────────────────────────────────────────

/**
 * Every non-null `EndReason` member. The `Record` type is the compile-time
 * exhaustiveness guard: a new reason added to the union fails the build here
 * until it is listed.
 */
const END_REASON_MAP: Record<Exclude<EndReason, null>, true> = {
  score_threshold: true,
  score_threshold_continue: true,
  all_challenges: true,
  turn_limit_victory: true,
  bankruptcy: true,
  reputation_collapse: true,
  last_standing: true,
  last_standing_continue: true,
  turn_exhaustion: true,
};

/** Every member of the `EndReason` union, with `null` last. */
export const END_REASONS: readonly EndReason[] = [
  ...(Object.keys(END_REASON_MAP) as Exclude<EndReason, null>[]),
  null,
];

// ── Fixture builders ──────────────────────────────────────────

/** Number of AI opponents a fixture can model. `0` is single-player. */
export type GameOverAiOpponents = 0 | 1 | 3;

/** Per-seat `PlayerRecord` override (indexed by `playerId`). */
export interface GameOverSeatOverride {
  coins?: number;
  reputation?: number;
  score?: number;
  controller?: SeatController;
  eliminated?: boolean;
}

/** Options for {@link makeGameOverState}. */
export interface GameOverFixtureOptions {
  /** The end reason to record on the state (default `null` / still playing). */
  endReason?: EndReason;
  /**
   * Number of AI opponents: `0` builds a single-player state, `1` a
   * human + 1 AI state and `3` a human + 3 AI state (default `0`).
   */
  aiOpponents?: GameOverAiOpponents;
  /**
   * Per-seat overrides, indexed by `playerId`. In single-player (`0` AI) the
   * first entry overrides the shared wallet (`resourceBank`) and
   * `state.finalScore` instead.
   */
  seats?: GameOverSeatOverride[];
  /** Run-global completed challenge ids to place on the state. */
  challengesCompleted?: string[];
  /** Winning seat in competitive mode. Left untouched when omitted. */
  competitiveWinnerId?: number | null;
  /** Explicit game result; derived from the end reason when omitted. */
  gameResult?: GameResult;
  /** Deterministic seed. Derived from the mode and end reason when omitted. */
  seed?: string;
}

/** Loss reasons, so the derived `gameResult` matches engine semantics. */
const LOSS_REASONS: ReadonlySet<EndReason> = new Set([
  'bankruptcy',
  'reputation_collapse',
  'turn_exhaustion',
]);

/** Terminal reasons that leave the run `playing` (endless / continue-solo). */
const CONTINUE_REASONS: ReadonlySet<EndReason> = new Set([
  'score_threshold_continue',
  'last_standing_continue',
]);

/** Derives the `gameResult` implied by an end reason. */
function deriveGameResult(endReason: EndReason): GameResult {
  if (endReason === null || CONTINUE_REASONS.has(endReason)) return 'playing';
  return LOSS_REASONS.has(endReason) ? 'loss' : 'win';
}

/**
 * Builds a valid `MainStreetState` for a given end reason and mode.
 *
 * Determinstic: the same options produce the same wallet/score/controller
 * shape (no `Date.now()`, no unseeded RNG).
 *
 * @param options - Fixture options; every field is optional.
 * @returns A mutable `MainStreetState` ready for Game Over formatting tests.
 */
export function makeGameOverState(options: GameOverFixtureOptions = {}): MainStreetState {
  const {
    endReason = null,
    aiOpponents = 0,
    seats = [],
    challengesCompleted,
    competitiveWinnerId,
    gameResult,
    seed = `game-over-${aiOpponents}ai-${endReason ?? 'playing'}`,
  } = options;

  let state: MainStreetState;

  if (aiOpponents === 0) {
    state = setupMainStreetGame({ seed });
  } else {
    const playerCount = aiOpponents + 1;
    const wallets: Array<[coins: number, reputation: number]> = [];
    for (let playerId = 0; playerId < playerCount; playerId += 1) {
      const seat = seats[playerId];
      wallets.push([seat?.coins ?? 600, seat?.reputation ?? 300]);
    }
    state = buildHumanVsAis(seed, aiOpponents, wallets);
    state.players!.forEach((player, playerId) => {
      const seat = seats[playerId];
      if (seat?.score !== undefined) player.score = seat.score;
      if (seat?.controller !== undefined) player.controller = seat.controller;
      if (seat?.eliminated !== undefined) player.eliminated = seat.eliminated;
    });
  }

  if (aiOpponents === 0 && seats[0]) {
    const seat = seats[0];
    if (seat.coins !== undefined) state.resourceBank.coins = seat.coins;
    if (seat.reputation !== undefined) state.resourceBank.reputation = seat.reputation;
    if (seat.score !== undefined) state.finalScore = seat.score;
  }

  state.endReason = endReason;
  state.gameResult = gameResult ?? deriveGameResult(endReason);
  if (challengesCompleted !== undefined) {
    state.challengesCompleted = [...challengesCompleted];
  }
  if (competitiveWinnerId !== undefined) {
    state.competitiveWinnerId = competitiveWinnerId;
  }

  return state;
}

/** Convenience builder for a single-player game-over state. */
export function makeSinglePlayerGameOverState(
  endReason: EndReason,
  options: Omit<GameOverFixtureOptions, 'endReason' | 'aiOpponents'> = {},
): MainStreetState {
  return makeGameOverState({ ...options, endReason, aiOpponents: 0 });
}

/** Convenience builder for a competitive (1-AI or 3-AI) game-over state. */
export function makeCompetitiveGameOverState(
  aiOpponents: Exclude<GameOverAiOpponents, 0>,
  endReason: EndReason,
  options: Omit<GameOverFixtureOptions, 'endReason' | 'aiOpponents'> = {},
): MainStreetState {
  return makeGameOverState({ ...options, endReason, aiOpponents });
}

// ── Smoke tests ───────────────────────────────────────────────

describe('END_REASONS', () => {
  it('includes the null reason with no duplicates', () => {
    expect(END_REASONS).toContain(null);
    expect(new Set(END_REASONS).size).toBe(END_REASONS.length);
  });

  it('includes every documented game-over reason', () => {
    for (const reason of [
      'score_threshold',
      'all_challenges',
      'turn_limit_victory',
      'bankruptcy',
      'reputation_collapse',
      'last_standing',
      'turn_exhaustion',
    ] as const) {
      expect(END_REASONS).toContain(reason);
    }
  });
});

describe('makeGameOverState', () => {
  const modes: GameOverAiOpponents[] = [0, 1, 3];

  it.each(modes)('builds a valid %i-AI state for every end reason', (aiOpponents) => {
    for (const endReason of END_REASONS) {
      const state = makeGameOverState({ endReason, aiOpponents });

      expect(state.endReason).toBe(endReason);
      expect(state.config).toBeDefined();
      expect(['playing', 'win', 'loss']).toContain(state.gameResult);
      expect(Array.isArray(state.challengesCompleted)).toBe(true);
      expect(Array.isArray(state.activeChallenges)).toBe(true);

      if (aiOpponents === 0) {
        expect(state.players ?? null).toBeNull();
      } else {
        expect(state.players).toHaveLength(aiOpponents + 1);
        expect(state.players![0].controller).toBe('human');
        for (let playerId = 1; playerId <= aiOpponents; playerId += 1) {
          expect(state.players![playerId].controller).toBe('ai');
        }
      }
    }
  });

  it('applies per-seat PlayerRecord overrides in competitive mode', () => {
    const state = makeGameOverState({
      endReason: 'bankruptcy',
      aiOpponents: 1,
      seats: [
        { coins: 250, reputation: 12, score: 88 },
        { coins: -5, reputation: 0, score: 10, eliminated: true, controller: 'ai' },
      ],
      competitiveWinnerId: 0,
    });

    const [human, ai] = state.players! as [PlayerRecord, PlayerRecord];
    expect(human.coins).toBe(250);
    expect(human.reputation).toBe(12);
    expect(human.score).toBe(88);
    expect(ai.coins).toBe(-5);
    expect(ai.reputation).toBe(0);
    expect(ai.score).toBe(10);
    expect(ai.eliminated).toBe(true);
    expect(state.competitiveWinnerId).toBe(0);
  });

  it('applies the single-player override to the shared wallet and final score', () => {
    const state = makeGameOverState({
      endReason: 'all_challenges',
      seats: [{ coins: 42, reputation: 7, score: 123 }],
    });

    expect(state.players ?? null).toBeNull();
    expect(state.resourceBank.coins).toBe(42);
    expect(state.resourceBank.reputation).toBe(7);
    expect(state.finalScore).toBe(123);
  });

  it('carries the run-global completed challenges', () => {
    const state = makeGameOverState({
      endReason: 'all_challenges',
      challengesCompleted: ['ch-funding', 'ch-expansion'],
    });

    expect(state.challengesCompleted).toEqual(['ch-funding', 'ch-expansion']);
  });

  it('derives loss/win/playing from the end reason unless overridden', () => {
    expect(makeGameOverState({ endReason: 'bankruptcy' }).gameResult).toBe('loss');
    expect(makeGameOverState({ endReason: 'score_threshold' }).gameResult).toBe('win');
    expect(makeGameOverState({ endReason: 'score_threshold_continue' }).gameResult).toBe('playing');
    expect(makeGameOverState({ endReason: null }).gameResult).toBe('playing');
    expect(makeGameOverState({ endReason: null, gameResult: 'win' }).gameResult).toBe('win');
  });
});

describe('makeSinglePlayerGameOverState / makeCompetitiveGameOverState', () => {
  it('the single-player convenience builder never creates players', () => {
    const state = makeSinglePlayerGameOverState('bankruptcy');
    expect(state.players ?? null).toBeNull();
    expect(state.endReason).toBe('bankruptcy');
  });

  it('the competitive convenience builder creates the requested AI seats', () => {
    const state = makeCompetitiveGameOverState(3, 'last_standing');
    expect(state.players).toHaveLength(4);
    expect(state.players![0].controller).toBe('human');
    expect(state.players!.slice(1).every((player) => player.controller === 'ai')).toBe(true);
  });
});
