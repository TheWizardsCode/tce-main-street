/**
 * Main Street: Competitive scene turn-flow integration tests
 *
 * Child MS-0MUTU8IYV0086PF6 of epic MS-0MUTTVR5K002ZDUP. Exercises the
 * production scene orchestration
 * (`src/scenes/MainStreetTurnControllerCompetitive.ts`) through the real
 * `MainStreetTurnController` with a lightweight fake scene: a full
 * human-vs-AI shared day is driven to a terminal condition across multiple
 * seeds, proving the AI seats take their turns automatically, per-seat state
 * diverges, difficulties reach the policy, and the day never stalls.
 *
 * Single-player is untouched (no `players[]` → the competitive branches are
 * inert); the existing turn-flow suite covers that path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSeededRng } from '@core-engine';

import { MainStreetTurnController } from '../../src/scenes/MainStreetTurnController';
import {
  canHumanSeatAct,
  createSeatAiPlayer,
  driveAiSeatsUntilClosing,
  endHumanMarketPhase,
  isCompetitiveState,
  resolveSeatStrategy,
  runCompetitiveClosing,
  startCompetitiveDay,
  withSeatDifficulty,
} from '../../src/scenes/MainStreetTurnControllerCompetitive';
import {
  CompetitiveGreedyStrategy,
  RandomStrategy,
  GreedyStrategy,
  BankingGreedyStrategy,
} from '../../src/MainStreetAiStrategy';
import { executeAction, type PlayerAction, type TurnResult } from '../../src/MainStreetEngine';
import {
  createCompetitiveState,
  seedToNumber,
  setupMainStreetGame,
  type CompetitiveOpponentConfig,
  type MainStreetState,
} from '../../src/MainStreetState';
import { getMainStreetRecorder, MainStreetTranscriptRecorder, setMainStreetRecorder } from '../../src/MainStreetTranscript';

/** Human vs a BankingGreedy/Hard AI opponent. */
const OPPONENTS: CompetitiveOpponentConfig[] = [{ strategy: 'BankingGreedy', difficulty: 'Hard' }];
const MAX_DAYS = 120;

/**
 * Minimal scene surface consumed by the competitive start/end paths. Phaser
 * is never touched: `cardSvgLoadPromise` never resolves, so the deferred
 * refresh/animation microtasks are not scheduled.
 */
function makeCompetitiveScene(state: MainStreetState): any {
  return {
    state,
    uiPhase: 'market',
    activeSeatId: 0,
    celebratedChallengeIds: new Set<string>(),
    pendingApplicant: null,
    justMovedHandCardId: null,
    hintUsedThisTurn: false,
    hintedCardId: null,
    hintedSlotIndex: null,
    instructionText: { setText: () => {} },
    cardSvgLoadPromise: new Promise<void>(() => {}),
    prewarmVisibleCardTextures: () => {},
    refreshAll: () => {},
    refreshActionButtons: () => {},
    refreshUndoRedoButtons: () => {},
    msAnimator: { animateWeekBanner: () => {} },
    tutorialController: { isActive: false },
    msLifecycleManager: {
      isTutorialActionAllowed: () => ({ allowed: true }),
      onTutorialActionComplete: () => {},
    },
    undoManager: { clear: () => {}, canUndo: () => false, canRedo: () => false },
    settingsPanel: { reducedMotion: true },
    replayMode: false,
  };
}

/** Plays the human seat's MarketPhase with the competitive greedy policy. */
function playHumanSeat(state: MainStreetState, maxActions = 16): void {
  const rng = createSeededRng(seedToNumber(`${state.seed}-human`));
  for (let guard = 0; guard < maxActions; guard++) {
    if (state.gameResult !== 'playing' || state.phase !== 'MarketPhase') break;
    let action: PlayerAction;
    try {
      action = CompetitiveGreedyStrategy.chooseAction(state, rng);
    } catch {
      break;
    }
    if (action.type === 'end-turn') break;
    try {
      executeAction(state, action);
    } catch {
      break;
    }
  }
}

interface SceneRunResult {
  state: MainStreetState;
  days: number;
  gameOver: TurnResult | null;
  /** Number of `ai-action` transcript events recorded by the AI seat driver. */
  aiActions: number;
}

/** Drives a full competitive game through the production scene controller. */
function runSceneGame(seed: string, opponents: CompetitiveOpponentConfig[] = OPPONENTS): SceneRunResult {
  const state = createCompetitiveState({ seed, playerCount: opponents.length + 1, opponents });
  const scene = makeCompetitiveScene(state);
  const controller = new MainStreetTurnController(scene);

  let gameOver: TurnResult | null = null;
  controller.handleGameOver = (result: TurnResult) => {
    gameOver = result;
  };

  const previousRecorder = getMainStreetRecorder();
  const recorder = new MainStreetTranscriptRecorder({ week: state.week, year: state.year, turn: state.turn });
  setMainStreetRecorder(recorder);
  try {
    controller.startTurnPhase();
    let days = 0;
    while (state.gameResult === 'playing' && days < MAX_DAYS) {
      playHumanSeat(state);
      controller.endTurn();
      days += 1;
    }
    const transcript = recorder.getTranscript();
    const aiActions = transcript.events.filter((e) => e.type === 'ai-action').length;
    return { state, days, gameOver, aiActions };
  } finally {
    setMainStreetRecorder(previousRecorder);
  }
}

afterEach(() => {
  setMainStreetRecorder(null);
});

// ── AC1: shared-day start + human-only input ─────────────────

describe('AC1 — shared-day start and human input gating', () => {
  it('starts the day with executeCompetitiveWeekStart and binds the human seat', () => {
    const state = createCompetitiveState({ seed: 'day-start', playerCount: 2, opponents: OPPONENTS });
    startCompetitiveDay(state);

    expect(state.activePlayerId).toBe(0);
    expect(state.phase).toBe('MarketPhase');
    // Human seat (player 0) is bound into the shared action fields.
    expect(state.resourceBank.coins).toBe(state.players![0].coins);
    expect(state.actionsRemaining).toBe(state.players![0].actionBudget);
  });

  it('accepts input only while the human seat is active', () => {
    const state = createCompetitiveState({ seed: 'input-gate', playerCount: 3, opponents: [
      { strategy: 'Greedy', difficulty: 'Medium' },
      { strategy: 'Random', difficulty: 'Easy' },
    ] });
    expect(canHumanSeatAct(state)).toBe(true);
    state.activePlayerId = 1;
    expect(canHumanSeatAct(state)).toBe(false);
    state.activePlayerId = 2;
    expect(canHumanSeatAct(state)).toBe(false);
  });

  it('ignores human action entry points while an AI seat is active', () => {
    const state = createCompetitiveState({ seed: 'input-noop', playerCount: 2, opponents: OPPONENTS });
    const scene = makeCompetitiveScene(state);
    const controller = new MainStreetTurnController(scene);
    state.activePlayerId = 1;
    scene.uiPhase = 'market';

    const before = state.resourceBank.coins;
    controller.onRefreshMarketClick();
    controller.onSlotClick(0);
    // No action reached the engine — the shared wallet is untouched.
    expect(state.resourceBank.coins).toBe(before);
  });

  it('endHumanMarketPhase advances the active seat to the first AI', () => {
    const state = createCompetitiveState({ seed: 'end-human', playerCount: 2, opponents: OPPONENTS });
    startCompetitiveDay(state);
    endHumanMarketPhase(state);
    expect(state.activePlayerId).toBe(1);
    expect(state.phase).toBe('MarketPhase');
  });

  it('isCompetitiveState is false for single-player states', () => {
    const single = setupMainStreetGame({ seed: 'sp-competitive-check' });
    expect(isCompetitiveState(single)).toBe(false);
    expect(canHumanSeatAct(single)).toBe(true);
  });
});

// ── AC2: AI seat driver ──────────────────────────────────────

describe('AC2 — AI seats are driven automatically', () => {
  it('drives every AI seat to the shared closing after the human ends', () => {
    const state = createCompetitiveState({ seed: 'ai-drive', playerCount: 3, opponents: [
      { strategy: 'Random', difficulty: 'Easy' },
      { strategy: 'Greedy', difficulty: 'Medium' },
    ] });
    startCompetitiveDay(state);
    endHumanMarketPhase(state);

    const actions = driveAiSeatsUntilClosing(state);
    expect(actions).toBeGreaterThan(0);
    expect(state.phase).toBe('InvestmentResolution');
  });

  it('returns control with no manual intervention and respects the bounded guard', () => {
    const state = createCompetitiveState({ seed: 'ai-guard', playerCount: 2, opponents: OPPONENTS });
    startCompetitiveDay(state);
    endHumanMarketPhase(state);

    const actions = driveAiSeatsUntilClosing(state, { maxActionsPerSeat: 1 });
    expect(actions).toBeLessThanOrEqual(1);
    expect(state.phase).toBe('InvestmentResolution');
  });

  it('maps strategy identifiers to implementations', () => {
    expect(resolveSeatStrategy({ aiStrategy: 'Random' })).toBe(RandomStrategy);
    expect(resolveSeatStrategy({ aiStrategy: 'Greedy' })).toBe(GreedyStrategy);
    expect(resolveSeatStrategy({ aiStrategy: 'BankingGreedy' })).toBe(BankingGreedyStrategy);
    // Legacy seat with no identifier defaults to Greedy.
    expect(resolveSeatStrategy(undefined)).toBe(GreedyStrategy);
    expect(createSeatAiPlayer({ aiStrategy: 'Random' }, () => 0.5)).toBeDefined();
  });
});

// ── AC3: closing + no deadlock ───────────────────────────────

describe('AC3 — closing and terminal resolution', () => {
  it('runs the shared closing and advances the day when the game continues', () => {
    const state = createCompetitiveState({ seed: 'closing', playerCount: 2, opponents: OPPONENTS });
    startCompetitiveDay(state);
    endHumanMarketPhase(state);
    driveAiSeatsUntilClosing(state);

    const result = runCompetitiveClosing(state);
    expect(result).not.toBeNull();
    expect(result!.choicePending).toBe(false);
    // Either the game ended or the next shared day was armed.
    if (state.gameResult === 'playing') {
      expect(state.phase).toBe('WeekStart');
      expect(state.activePlayerId).toBe(0);
    }
  });

  it('runs multiple seeds to a terminal condition without stalling', () => {
    const seeds = ['scene-a', 'scene-b', 'scene-c', 'scene-d', 'scene-e'];
    for (const seed of seeds) {
      const run = runSceneGame(seed);
      expect(run.state.gameResult, `seed ${seed} should resolve`).not.toBe('playing');
      expect(run.days).toBeLessThan(MAX_DAYS);
      expect(run.days).toBeGreaterThan(0);
      expect(run.gameOver).not.toBeNull();
      expect(run.aiActions).toBeGreaterThan(0);
    }
  }, 60_000);
});

// ── AC4: visibility + per-seat difficulty ────────────────────

describe('AC4 — AI visibility and per-seat difficulty', () => {
  it('records AI actions to the transcript and the activity log', () => {
    const state = createCompetitiveState({ seed: 'visible', playerCount: 2, opponents: [
      { strategy: 'Random', difficulty: 'Hard' },
    ] });
    startCompetitiveDay(state);
    endHumanMarketPhase(state);
    driveAiSeatsUntilClosing(state);

    // Activity-log entry written as the AI seat acts.
    expect(state.activityLog.some((entry) => entry.text.startsWith('AI 1'))).toBe(true);
  });

  it('threads the seat difficulty into the policy without mutating the shared config', () => {
    const state = createCompetitiveState({ seed: 'seat-difficulty', playerCount: 2, difficulty: 'Easy', opponents: [
      { strategy: 'BankingGreedy', difficulty: 'Hard' },
    ] });
    const shared = state.config.difficultyName;
    const observed = withSeatDifficulty(state, 'Hard', () => state.config.difficultyName);
    expect(observed).toBe('Hard');
    expect(state.config.difficultyName).toBe(shared);

    // The BankingGreedy policy must observe the AI seat's own difficulty
    // while choosing (Hard), then the shared config is restored (Easy).
    const observedByPolicy: string[] = [];
    const originalChoose = BankingGreedyStrategy.chooseAction.bind(BankingGreedyStrategy);
    const spy = vi
      .spyOn(BankingGreedyStrategy, 'chooseAction')
      .mockImplementation((choosingState, rng) => {
        observedByPolicy.push(choosingState.config.difficultyName);
        return originalChoose(choosingState, rng);
      });
    startCompetitiveDay(state);
    endHumanMarketPhase(state);
    driveAiSeatsUntilClosing(state, { maxActionsPerSeat: 1 });
    spy.mockRestore();

    expect(observedByPolicy).toContain('Hard');
    expect(state.config.difficultyName).toBe('Easy');
  });
});

// ── AC: full human-vs-AI game diverges per seat ──────────────

describe('Full scene game — per-seat divergence', () => {
  it('produces divergent per-player economies in a completed game', () => {
    const run = runSceneGame('scene-diverge');
    const players = run.state.players ?? [];
    expect(players).toHaveLength(2);

    const diverged =
      players[0].coins !== players[1].coins ||
      players[0].reputation !== players[1].reputation ||
      players[0].score !== players[1].score;
    expect(diverged).toBe(true);

    if (run.state.gameResult === 'win') {
      expect(run.state.competitiveWinnerId).not.toBeNull();
    }
  });
});
