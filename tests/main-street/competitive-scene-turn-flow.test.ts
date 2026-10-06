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
  bindCompetitiveSeat,
  restoreCompetitiveSeat,
} from '../../src/MainStreetAiStrategy';
import {
  consumeAction,
  endCompetitiveMarketTurn,
  executeAction,
  resolveCompetitiveClosingPhases,
  type PlayerAction,
  type TurnResult,
} from '../../src/MainStreetEngine';
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
    const runs = seeds.map(seed => ({ seed, run: runSceneGame(seed) }));
    for (const { seed, run } of runs) {
      expect(run.state.gameResult, `seed ${seed} should resolve`).not.toBe('playing');
      expect(run.days).toBeLessThan(MAX_DAYS);
      expect(run.days).toBeGreaterThan(0);
      expect(run.gameOver).not.toBeNull();
    }
    // The AI seats are driven automatically and execute actions when the game
    // continues long enough (some seeds now resolve early via a genuine human
    // collapse under the per-seat evaluation, before the AI acts).
    expect(runs.some(({ run }) => run.aiActions > 0)).toBe(true);
  }, 60_000);
});

// ── Competitive action banking (MS-0MUVUPWHD0032CU4) ─────────

describe('Competitive action banking', () => {
  /**
   * A fresh human-vs-AI competitive state armed for P0's MarketPhase with a
   * high win threshold and padded wallets so the shared day never ends early.
   */
  function bankedState(seed: string, bank: number): MainStreetState {
    const state = createCompetitiveState({ seed, playerCount: 2, opponents: OPPONENTS });
    state.config = { ...state.config, winThreshold: 10_000_000 } as typeof state.config;
    for (const p of state.players!) {
      p.coins = 100000;
      p.reputation = 100000;
    }
    state.bankedActions = bank;
    startCompetitiveDay(state);
    return state;
  }

  /** An idle seat: bind (arm its budget), then restore without acting, then
   * advance the shared day to the next seat / closing. */
  function idleSeat(state: MainStreetState, playerId: number): void {
    bindCompetitiveSeat(state, playerId);
    restoreCompetitiveSeat(state, playerId);
    endCompetitiveMarketTurn(state);
  }

  /** A spending seat: bind (arm its budget), consume `spend` actions, then
   * restore and advance the shared day to the next seat / closing. */
  function spendingSeat(state: MainStreetState, playerId: number, spend: number): void {
    bindCompetitiveSeat(state, playerId);
    for (let i = 0; i < spend; i++) consumeAction(state);
    restoreCompetitiveSeat(state, playerId);
    endCompetitiveMarketTurn(state);
  }

  it('AC2 — binding a seat grants base budget plus the remaining shared bank', () => {
    const state = bankedState('bank-bind', 2);
    // P0 was bound by startCompetitiveDay: 1 base + 2 banked.
    expect(state.actionsRemaining).toBe(3);
    // The seat's base budget stays bank-free while bound.
    expect(state.players![0].actionBudget).toBe(1);

    // The human spends one action — `consumeAction` draws down both the
    // weekly counter and the shared bank.
    consumeAction(state);
    expect(state.actionsRemaining).toBe(2);
    expect(state.bankedActions).toBe(1);
    endHumanMarketPhase(state);
    expect(state.players![0].actionBudget).toBe(1); // base restored bank-free

    // The next seat sees base + the *remaining* bank (not the full day-start
    // snapshot, and not zero).
    bindCompetitiveSeat(state, 1);
    expect(state.actionsRemaining).toBe(2); // 1 base + 1 banked remaining
  });

  it('AC1 — an idle shared day banks exactly one action, regardless of seat', () => {
    const state = bankedState('bank-idle-day', 0);
    expect(state.bankedActions).toBe(0);
    expect(state.actionsRemaining).toBe(1); // P0 base only

    // Human idles (production path), then the AI seat idles.
    endHumanMarketPhase(state);
    idleSeat(state, 1);
    const closing = resolveCompetitiveClosingPhases(state);
    expect(closing.choicePending).toBe(false);
    expect(state.bankedActions).toBe(1);

    // A second idle day reaches the cap of 2.
    startCompetitiveDay(state);
    endHumanMarketPhase(state);
    idleSeat(state, 1);
    resolveCompetitiveClosingPhases(state);
    expect(state.bankedActions).toBe(2);
  });

  it('AC2 — a banked action spent by the human is not re-granted to the AI', () => {
    const state = bankedState('bank-shared-pool', 2);
    expect(state.actionsRemaining).toBe(3); // 1 base + 2 banked

    // Human spends a banked action, depleting the shared pool to 1.
    consumeAction(state);
    expect(state.bankedActions).toBe(1);
    endHumanMarketPhase(state);

    // The AI gets base + remaining bank only (2), never base + the original 2 (3).
    bindCompetitiveSeat(state, 1);
    expect(state.actionsRemaining).toBe(2);
    expect(state.bankedActions).toBe(1);
  });

  it('AC1 — the human\'s unused base action banks even when an AI seat spends its action', () => {
    // Regression (MS-0MUVUPWHD0032CU4 manual rejection): the human ends their
    // MarketPhase without acting and the AI then spends its own base action.
    // The day-end bank must still bank the human's unused base action — the
    // AI draining the shared counter must not discard it.
    const state = bankedState('bank-human-unused', 0);
    expect(state.actionsRemaining).toBe(1); // human base only

    endHumanMarketPhase(state);
    expect(state.players![0].actionBudget).toBe(1); // human base left over

    spendingSeat(state, 1, 1); // AI spends its own base action
    const closing = resolveCompetitiveClosingPhases(state);
    expect(closing.choicePending).toBe(false);
    expect(state.bankedActions).toBe(1);
  });

  it('AC1 — a banked action persists to the next day and is not lost when the AI spends', () => {
    const state = bankedState('bank-ai-spends-each-day', 0);
    endHumanMarketPhase(state); // human idles, banking its base action
    spendingSeat(state, 1, 1); // AI spends its own base action
    resolveCompetitiveClosingPhases(state);
    expect(state.bankedActions).toBe(1);

    // The bank survives the day boundary: P0's shared budget is base + banked.
    startCompetitiveDay(state);
    expect(state.actionsRemaining).toBe(2); // 1 base + 1 banked
    expect(state.bankedActions).toBe(1);

    // Day 2: the AI draws the carried bank down, but the human's idle base
    // action re-banks, so the pool is still non-empty rather than lost.
    endHumanMarketPhase(state);
    spendingSeat(state, 1, 1);
    resolveCompetitiveClosingPhases(state);
    expect(state.bankedActions).toBe(1);
  });

  it('AC1 — spending the full budget clears the bank even if the AI idles (producer repro)', () => {
    // Producer repro: day 1 idle -> bank 1; day 2 spend both APs -> the bank
    // must clear. An AI seat's own unused action must NOT top the human's bank
    // back up, or the bank would never clear while the AI had no good move.
    const state = bankedState('bank-clear-on-spend', 0);

    // Day 1: human idles, AI idles -> bank 1.
    endHumanMarketPhase(state);
    idleSeat(state, 1);
    resolveCompetitiveClosingPhases(state);
    expect(state.bankedActions).toBe(1);

    // Day 2: human receives base 1 + banked 1 = 2 APs.
    startCompetitiveDay(state);
    expect(state.actionsRemaining).toBe(2);

    // Spend both APs, then end the day; the AI idles.
    consumeAction(state);
    consumeAction(state);
    endHumanMarketPhase(state);
    expect(state.players![0].actionBudget).toBe(0);
    idleSeat(state, 1);
    resolveCompetitiveClosingPhases(state);
    expect(state.bankedActions).toBe(0);

    // Day 3: base budget only — the bank did not linger.
    startCompetitiveDay(state);
    expect(state.actionsRemaining).toBe(1);
  });
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
