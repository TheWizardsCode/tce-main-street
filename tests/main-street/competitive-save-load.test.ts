/**
 * Main Street: Competitive save/load round-trip tests
 *
 * Child MS-0MUTU8JKV003UQFG of epic MS-0MUTTVR5K002ZDUP. Verifies that a
 * competitive state (including per-seat configuration and the mid-day active
 * seat) survives save/load, that a loaded competitive game can be driven to a
 * terminal condition, and that single-player save/load plus the Monte Carlo
 * baseline are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '@core-engine';

import {
  createCompetitiveState,
  deserializeMainStreetState,
  serializeMainStreetState,
  seedToNumber,
  setupMainStreetGame,
  type CompetitiveOpponentConfig,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  driveAiSeatsUntilClosing,
  endHumanMarketPhase,
  runCompetitiveClosing,
  startCompetitiveDay,
} from '../../src/scenes/MainStreetTurnControllerCompetitive';
import { CompetitiveGreedyStrategy } from '../../src/MainStreetAiStrategy';
import { executeAction, type PlayerAction } from '../../src/MainStreetEngine';
import { runMonteCarlo } from '../../src/MainStreetMonteCarlo';

const OPPONENTS: CompetitiveOpponentConfig[] = [
  { strategy: 'Random', difficulty: 'Easy' },
  { strategy: 'BankingGreedy', difficulty: 'Hard' },
];

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

/** Round-trips a state through the real serializer. */
function roundTrip(state: MainStreetState): MainStreetState {
  return deserializeMainStreetState(serializeMainStreetState(state));
}

describe('Competitive save/load — mid-day round-trip', () => {
  it('round-trips every competitive field, including seat configuration', () => {
    const state = createCompetitiveState({ seed: 'save-midday', playerCount: 3, opponents: OPPONENTS });
    startCompetitiveDay(state);
    playHumanSeat(state);
    endHumanMarketPhase(state);
    expect(state.activePlayerId).toBe(1);
    expect(state.phase).toBe('MarketPhase');
    state.competitiveWinnerId = 2; // exercise a non-null winner round-trip

    const restored = roundTrip(state);

    expect(restored.phase).toBe('MarketPhase');
    expect(restored.activePlayerId).toBe(1);
    expect(restored.playerCount).toBe(3);
    expect(restored.competitiveWinnerId).toBe(2);
    expect(restored.ownerTaggedGrid).toEqual(state.ownerTaggedGrid);

    expect(restored.players).toHaveLength(3);
    // Byte-identical seat round-trip (controller/strategy/difficulty included).
    expect(JSON.stringify(restored.players)).toBe(JSON.stringify(state.players));
    for (let i = 0; i < 3; i++) {
      expect(restored.players![i]).toMatchObject({
        playerId: state.players![i].playerId,
        coins: state.players![i].coins,
        reputation: state.players![i].reputation,
        score: state.players![i].score,
        controller: state.players![i].controller,
      });
    }
  });

  it('resuming a loaded mid-day state continues the shared day', () => {
    const state = createCompetitiveState({ seed: 'save-resume', playerCount: 3, opponents: OPPONENTS });
    startCompetitiveDay(state);
    playHumanSeat(state);
    endHumanMarketPhase(state);

    const restored = roundTrip(state);
    const actions = driveAiSeatsUntilClosing(restored);

    expect(actions).toBeGreaterThan(0);
    expect(restored.phase).toBe('InvestmentResolution');
    const result = runCompetitiveClosing(restored);
    expect(result).not.toBeNull();
    if (restored.gameResult === 'playing') {
      expect(restored.phase).toBe('WeekStart');
      expect(restored.activePlayerId).toBe(0);
    }
  });

  it('drives a loaded competitive game to a terminal condition', () => {
    const state = createCompetitiveState({ seed: 'save-terminal', playerCount: 2, opponents: [OPPONENTS[0]] });
    startCompetitiveDay(state);
    const restored = roundTrip(state);
    // Resuming a loaded fresh state (still WeekStart) opens the shared day.
    startCompetitiveDay(restored);

    let days = 0;
    while (restored.gameResult === 'playing' && days < 200) {
      if (restored.phase === 'WeekStart') startCompetitiveDay(restored);
      playHumanSeat(restored);
      if (restored.phase === 'MarketPhase') endHumanMarketPhase(restored);
      driveAiSeatsUntilClosing(restored);
      if (restored.gameResult !== 'playing') break;
      if (restored.phase === 'InvestmentResolution') runCompetitiveClosing(restored);
      days += 1;
    }

    expect(restored.gameResult).not.toBe('playing');
    expect(days).toBeLessThan(200);
  });
});

describe('Single-player save/load regression', () => {
  it('round-trips a single-player state with no seat records and byte-identical output', () => {
    const single = setupMainStreetGame({ seed: 'sp-save-regression', difficulty: 'Medium' });
    const restored = roundTrip(single);

    expect(restored.players).toBeUndefined();
    expect(restored.ownerTaggedGrid).toBeUndefined();
    expect(restored.playerCount).toBeUndefined();

    // Re-serialising the restored state reproduces the original save exactly.
    expect(JSON.stringify(serializeMainStreetState(restored))).toBe(
      JSON.stringify(serializeMainStreetState(single)),
    );
  });

  it('loads a legacy single-player save that has no players field', () => {
    const single = setupMainStreetGame({ seed: 'sp-legacy', difficulty: 'Easy' });
    const saved = JSON.parse(JSON.stringify(serializeMainStreetState(single))) as Record<string, unknown>;
    delete saved.players;
    delete saved.ownerTaggedGrid;
    delete saved.playerCount;
    delete saved.activePlayerId;
    delete saved.competitiveWinnerId;

    const restored = deserializeMainStreetState(saved as never);
    expect(restored.players).toBeUndefined();
    expect(restored.seed).toBe('sp-legacy');
    expect(restored.config.difficultyName).toBe('Easy');
  });
});

describe('Monte Carlo regression (single-player unchanged)', () => {
  it('produces byte-identical single-player Monte Carlo results for the same seed', () => {
    const options = { seeds: ['mc-regression-seed'], maxTurns: 25, strategy: 'greedy' as const };
    const a = runMonteCarlo(options);
    const b = runMonteCarlo(options);
    expect(a.runs).toEqual(b.runs);
    expect(a.metrics).toEqual(b.metrics);
  });
});
