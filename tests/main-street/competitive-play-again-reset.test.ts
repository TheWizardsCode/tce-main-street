/**
 * MS-0MVJNFESC005QJ41 — "Play Again does not reset the AI".
 *
 * Reported repro: win a competitive game because the AI goes bankrupt, click
 * `[ Play Again ]`, start a new competitive game — and the AI is bankrupt
 * again, "in the first turn". The reporter suspected carried-over AI stats.
 *
 * Investigation (recorded on the work item):
 *  - The Play Again / New Game path is clean: `createCompetitiveState()` seeds
 *    every `PlayerRecord` from the difficulty preset, so no wallet,
 *    elimination flag, hand, staff or score survives a finished run. The
 *    coverage below keeps that guarantee pinned.
 *  - The real defect is an **opening-day elimination**: an AI seat spent its
 *    whole purse during its first MarketPhase (e.g. hiring 400 of its 600
 *    starting coins) and was then bankrupted by that same day's incident (a
 *    flat -200 Protest / -500 General Strike). The match was therefore decided
 *    on turn 1 with the AI eliminated, which looks exactly like carried-over
 *    state.
 *
 * Fix covered here:
 *  1. `applyFirstSharedDaySolvencyGrace` — no competitive seat can end the
 *     first shared day in debt (bankruptcy elimination applies from turn 2).
 *  2. `competitiveAiReserveCoins` + the seat-binding reserve — AI seats keep a
 *     difficulty-gated liquidity floor, so they stop buying before they are
 *     one incident away from bankruptcy.
 *
 * The seeded scenarios (`dayone-12`, `dayone-42`) are the reproduced failures:
 * pre-fix they end the match on turn 1 (`loss/bankruptcy` and
 * `win/last_standing` respectively); post-fix both seats survive the opening
 * day.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSeededRng } from '@core-engine';

import { MainStreetTurnController } from '../../src/scenes/MainStreetTurnController';
import {
  CompetitiveGreedyStrategy,
  COMPETITIVE_AI_RESERVE_RATIO,
  bindCompetitiveSeat,
  competitiveAiReserveCoins,
  restoreCompetitiveSeat,
} from '../../src/MainStreetAiStrategy';
import {
  applyFirstSharedDaySolvencyGrace,
  checkCompetitiveSeatFailure,
  executeAction,
  type PlayerAction,
} from '../../src/MainStreetEngine';
import {
  createCompetitiveState,
  seedToNumber,
  setupMainStreetGame,
  type CompetitiveOpponentConfig,
  type MainStreetState,
} from '../../src/MainStreetState';
import { createStateFromModeSelection } from '../../src/MainStreetStateSetup';
import {
  MainStreetTranscriptRecorder,
  getMainStreetRecorder,
  setMainStreetRecorder,
} from '../../src/MainStreetTranscript';
import {
  driveAiSeatsUntilClosing,
  endHumanMarketPhase,
  startCompetitiveDay,
} from '../../src/scenes/MainStreetTurnControllerCompetitive';

/** Medium-difficulty preset starting purse used by the seeded scenarios. */
const MEDIUM_STARTING_COINS = 600;
const MEDIUM_STARTING_REP = 300;

const MEDIUM_OPPONENT: CompetitiveOpponentConfig = { strategy: 'Greedy', difficulty: 'Medium' };

/**
 * Minimal scene surface consumed by the competitive start/end paths. Phaser is
 * never touched: `cardSvgLoadPromise` never resolves, so the deferred
 * refresh/animation microtasks are not scheduled. The human seat is played by
 * `CompetitiveGreedyStrategy` so a full day resolves deterministically.
 */
function makeCompetitiveScene(state: MainStreetState): any {
  return {
    state,
    uiPhase: 'market',
    activeSeatId: 0,
    celebratedChallengeIds: new Set<string>(),
    pendingApplicant: null,
    justMovedHandCardId: null,
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
    undoManager: {
      clear: () => {},
      canUndo: () => false,
      canRedo: () => false,
      execute: (cmd: unknown) => cmd,
    },
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

/**
 * Plays a full competitive game (or `maxDays` shared days) through the real
 * scene turn controller. Returns the controller's game-over turns.
 */
function playGame(
  state: MainStreetState,
  maxDays = 120,
): { days: number; gameOvers: number } {
  const scene = makeCompetitiveScene(state);
  const controller = new MainStreetTurnController(scene);
  let gameOvers = 0;
  controller.handleGameOver = () => {
    gameOvers += 1;
  };

  const previousRecorder = getMainStreetRecorder();
  setMainStreetRecorder(
    new MainStreetTranscriptRecorder({ week: state.week, year: state.year, turn: state.turn }),
  );
  let days = 0;
  try {
    controller.startTurnPhase();
    while (state.gameResult === 'playing' && days < maxDays) {
      playHumanSeat(state);
      controller.endTurn();
      days += 1;
    }
  } finally {
    setMainStreetRecorder(previousRecorder);
  }
  return { days, gameOvers };
}

afterEach(() => {
  setMainStreetRecorder(null);
});

// ── AC1: the reported "stats not reset" hypothesis ───────────

describe('AC1 — a new competitive game after a finished run starts fresh', () => {
  it('seeds every seat from the preset, never from the previous run', () => {
    // Play a real run for a dozen shared days, then pin the reported
    // end-of-run observation (the AI finished bankrupt and eliminated).
    const finished = createCompetitiveState({
      seed: 'fresh-after-finished-run',
      playerCount: 2,
      opponents: [MEDIUM_OPPONENT],
    });
    playGame(finished, 12);
    expect(finished.turn).toBeGreaterThan(1);
    finished.players![1].coins = -500;
    finished.players![1].eliminated = true;
    finished.gameResult = 'win';
    finished.endReason = 'last_standing';
    finished.competitiveWinnerId = 0;

    // The next game goes through the same path as the New Game selector.
    const next = createStateFromModeSelection({
      mode: 'competitive',
      difficulty: 'Medium',
      opponents: [MEDIUM_OPPONENT],
    });

    expect(next.players).toHaveLength(2);
    for (const seat of next.players ?? []) {
      expect(seat.coins).toBe(MEDIUM_STARTING_COINS);
      expect(seat.reputation).toBe(MEDIUM_STARTING_REP);
      expect(seat.hand).toEqual([]);
      expect(seat.staffCards).toEqual([]);
      expect(seat.score).toBe(0);
      expect(seat.actionBudget).toBe(1);
      // No elimination, no failure badge and no negative wallet carried over.
      expect(seat.eliminated).toBeUndefined();
      expect(checkCompetitiveSeatFailure(next)).toEqual([]);
    }
    expect(next.gameResult).toBe('playing');
    expect(next.turn).toBe(1);
    expect(next.competitiveWinnerId).toBeNull();
  });
});

// ── AC2: opening-day solvency grace ──────────────────────────

describe('AC2 — the first shared day cannot be decided by debt', () => {
  function openingDayState(): MainStreetState {
    const state = createCompetitiveState({
      seed: 'grace-unit',
      playerCount: 2,
      opponents: [MEDIUM_OPPONENT],
    });
    // Both seats finish the opening day in debt (the day-1 incident swing).
    state.players![0].coins = -178;
    state.players![1].coins = -80;
    return state;
  }

  it('writes off opening-day debt instead of eliminating the seats', () => {
    const state = openingDayState();

    const writtenOff = applyFirstSharedDaySolvencyGrace(state);

    expect(writtenOff).toBe(258);
    expect(state.players![0].coins).toBe(0);
    expect(state.players![1].coins).toBe(0);
    expect(state.players![0].eliminated).toBeUndefined();
    expect(state.players![1].eliminated).toBeUndefined();
    expect(state.gameResult).toBe('playing');
    // The grace is visible in the activity log for both seats.
    const graceEntries = state.activityLog.filter((entry) =>
      String(entry.text).includes('First-day grace'),
    );
    expect(graceEntries).toHaveLength(2);
  });

  it('is idempotent and declares nothing on its own', () => {
    const state = openingDayState();
    applyFirstSharedDaySolvencyGrace(state);
    const logLength = state.activityLog.length;

    expect(applyFirstSharedDaySolvencyGrace(state)).toBe(0);
    expect(state.activityLog.length).toBe(logLength);
    expect(state.gameResult).toBe('playing');
  });

  it('leaves single-player and later turns untouched', () => {
    // Single-player states carry no roster: the grace must be a no-op.
    const single = setupMainStreetGame({ seed: 'grace-single' });
    single.resourceBank.coins = -100;
    expect(applyFirstSharedDaySolvencyGrace(single)).toBe(0);
    expect(single.resourceBank.coins).toBe(-100);
    // A negative seat from turn 2 onwards keeps the normal bankruptcy rule.
    const state = openingDayState();
    state.turn = 2;
    expect(applyFirstSharedDaySolvencyGrace(state)).toBe(0);
    expect(state.players![0].coins).toBe(-178);
  });

  it('keeps bankruptcy elimination from turn 2 (grace does not disable it)', () => {
    const state = createCompetitiveState({
      seed: 'grace-turn-2',
      playerCount: 2,
      opponents: [MEDIUM_OPPONENT],
    });
    state.turn = 2;
    state.players![1].coins = -5;

    // Grace is inert on turn 2, so the seat still fails and is eliminated.
    applyFirstSharedDaySolvencyGrace(state);
    expect(checkCompetitiveSeatFailure(state)).toEqual([
      { playerId: 1, reason: 'bankruptcy' },
    ]);
  });

  it.each([
    ['dayone-12', MEDIUM_OPPONENT],
    ['dayone-42', { strategy: 'Greedy', difficulty: 'Hard' } as CompetitiveOpponentConfig],
  ])(
    'reported scenario %s no longer ends the match on turn 1',
    (seed, opponent) => {
      const state = createCompetitiveState({
        seed,
        playerCount: 2,
        opponents: [opponent],
      });
      const { days, gameOvers } = playGame(state, 1);

      expect(days).toBe(1);
      expect(gameOvers).toBe(0);
      expect(state.gameResult).toBe('playing');
      expect(state.turn).toBe(2);
      expect(checkCompetitiveSeatFailure(state)).toEqual([]);
      for (const seat of state.players ?? []) {
        expect(seat.eliminated).toBeUndefined();
        expect(seat.coins).toBeGreaterThanOrEqual(0);
      }
    },
    60_000,
  );
});

// ── AC3: AI liquidity reserve ───────────────────────────────

describe('AC3 — competitive AI seats keep a liquidity reserve', () => {
  function seatState(): MainStreetState {
    return createCompetitiveState({
      seed: 'reserve-unit',
      playerCount: 2,
      opponents: [MEDIUM_OPPONENT],
    });
  }

  it('is difficulty-gated and derived from the preset starting purse', () => {
    const state = seatState();
    expect(COMPETITIVE_AI_RESERVE_RATIO.Easy).toBeGreaterThan(COMPETITIVE_AI_RESERVE_RATIO.Hard);
    expect(competitiveAiReserveCoins(state, 'Easy')).toBe(
      Math.round(MEDIUM_STARTING_COINS * COMPETITIVE_AI_RESERVE_RATIO.Easy),
    );
    expect(competitiveAiReserveCoins(state, 'Medium')).toBe(
      Math.round(MEDIUM_STARTING_COINS * COMPETITIVE_AI_RESERVE_RATIO.Medium),
    );
    expect(competitiveAiReserveCoins(state, 'Hard')).toBe(
      Math.round(MEDIUM_STARTING_COINS * COMPETITIVE_AI_RESERVE_RATIO.Hard),
    );
  });

  it('withholds the reserve from the spendable view without charging it', () => {
    const state = seatState();
    const reserve = competitiveAiReserveCoins(state, 'Medium');

    bindCompetitiveSeat(state, 1, reserve);
    expect(state.resourceBank.coins).toBe(MEDIUM_STARTING_COINS - reserve);

    // The seat spends 200 of its spendable budget while bound.
    state.resourceBank.coins -= 200;
    restoreCompetitiveSeat(state, 1, reserve);

    // The reserve is never spent: only the 200 leaves the real wallet.
    expect(state.players![1].coins).toBe(MEDIUM_STARTING_COINS - 200);
  });

  it('restores a seat whose wallet is below the reserve intact', () => {
    const state = seatState();
    const reserve = competitiveAiReserveCoins(state, 'Medium');
    state.players![1].coins = reserve - 40;

    bindCompetitiveSeat(state, 1, reserve);
    expect(state.resourceBank.coins).toBe(0); // nothing spendable

    restoreCompetitiveSeat(state, 1, reserve);
    expect(state.players![1].coins).toBe(reserve - 40);
  });

  it('drives an AI MarketPhase without letting the seat breach its reserve', () => {
    const state = seatState();
    const reserve = competitiveAiReserveCoins(state, 'Medium');
    // A seat sitting exactly on its floor has nothing to spend.
    state.players![1].coins = reserve;

    startCompetitiveDay(state);
    endHumanMarketPhase(state);
    driveAiSeatsUntilClosing(state);

    expect(state.players![1].coins).toBeGreaterThanOrEqual(reserve);
  });

  it('drives a full AI MarketPhase with the reserve intact across seeds', () => {
    for (const seed of ['reserve-drive-1', 'reserve-drive-2', 'reserve-drive-3']) {
      const state = createCompetitiveState({
        seed,
        playerCount: 2,
        opponents: [{ strategy: 'Greedy', difficulty: 'Medium' }],
      });
      const reserve = competitiveAiReserveCoins(state, 'Medium');

      startCompetitiveDay(state);
      endHumanMarketPhase(state);
      driveAiSeatsUntilClosing(state);

      expect(
        state.players![1].coins,
        `AI seat breached its ${reserve}-coin reserve on seed ${seed}`,
      ).toBeGreaterThanOrEqual(reserve);
    }
  });
});
