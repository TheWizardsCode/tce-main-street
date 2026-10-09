/**
 * Main Street: Competitive end-condition AI-win tests (MS-0MUX6PMCE002I6HO).
 *
 * Verifies that when an AI player wins (reaches score threshold, completes
 * all challenges, or wins turn limit), the human sees `gameResult = 'loss'`
 * and the correct `competitiveWinnerId` is set.
 *
 * @module tests/main-street/competitive-end-condition-ai-win
 */
import { describe, it, expect } from 'vitest';

import {
  buildCompetitiveState,
  buildHumanVsAis,
  evaluateEndConditions,
} from './helpers/competitive-fixtures';
import { checkEndConditions } from '../../src/MainStreetEngine';

/**
 * Effective competitive target used by these win-attribution tests
 * (MS-0MUZK64F8000XYO0: win threshold = round(base / playerCount / 50) * 50).
 */
const EFFECTIVE_TARGET = 50;

/**
 * Base `winThreshold` that yields {@link EFFECTIVE_TARGET} after the
 * per-player division and nearest-50 rounding for `playerCount` seats.
 */
function baseThreshold(playerCount: number): number {
  return EFFECTIVE_TARGET * playerCount;
}

describe('AI threshold win → human sees loss (AC1)', () => {
  it('AI (seat 1) reaches threshold → gameResult is loss, winner is AI', () => {
    const state = buildHumanVsAis('ai-threshold-win', 1, [
      [10, 1],    // human below threshold (score 11)
      [40, 20],   // AI above threshold (score 60)
    ], baseThreshold(2));

    const result = evaluateEndConditions(state);
    expect(result.ended).toBe(true);
    expect(result.gameResult).toBe('loss');
    expect(result.endReason).toBe('score_threshold');
    expect(result.competitiveWinnerId).toBe(1);
  });

  it('AI (seat 2) reaches threshold with human below → human loss', () => {
    const state = buildHumanVsAis('ai-threshold-win-2ai', 2, [
      [10, 1],   // human below
      [5, 1],    // AI 1 below
      [40, 20],  // AI 2 above
    ], baseThreshold(3));

    const result = evaluateEndConditions(state);
    expect(result.ended).toBe(true);
    expect(result.gameResult).toBe('loss');
    expect(result.endReason).toBe('score_threshold');
    expect(result.competitiveWinnerId).toBe(2);
  });

  it('human reaches threshold → gameResult is win, winner is human', () => {
    const state = buildHumanVsAis('human-threshold-win', 1, [
      [40, 20],   // human above threshold
      [10, 1],    // AI below threshold
    ], baseThreshold(2));

    const result = evaluateEndConditions(state);
    expect(result.ended).toBe(true);
    expect(result.gameResult).toBe('win');
    expect(result.endReason).toBe('score_threshold');
    expect(result.competitiveWinnerId).toBe(0);
  });

  it('multi-AI threshold with human losing → human loss', () => {
    const state = buildHumanVsAis('multi-ai-lose', 3, [
      [5, 1],    // human below
      [5, 1],    // AI 1 below
      [5, 1],    // AI 2 below
      [40, 20],  // AI 3 above
    ], baseThreshold(4));

    const result = evaluateEndConditions(state);
    expect(result.ended).toBe(true);
    expect(result.gameResult).toBe('loss');
    expect(result.endReason).toBe('score_threshold');
    expect(result.competitiveWinnerId).toBe(3);
  });

  it('human wins tie (lowest index) → gameResult is win', () => {
    const state = buildHumanVsAis('human-tie-win', 1, [
      [40, 20],   // human at tie level
      [40, 20],   // AI at same level
    ], baseThreshold(2));

    const result = evaluateEndConditions(state);
    expect(result.ended).toBe(true);
    expect(result.gameResult).toBe('win');
    expect(result.endReason).toBe('score_threshold');
    expect(result.competitiveWinnerId).toBe(0);
  });
});

describe('All challenges complete → correct human/AI win attribution (AC1)', () => {
  it('shared challenge milestone credited to AI (human not seat 0) → human sees loss', () => {
    // The all_challenges milestone is shared and credited to the
    // lowest-index seat (0). Place the human at seat 1 so the credit
    // goes to an AI and the human must see a loss.
    const state = buildCompetitiveState({ seed: 'ai-challenges-win', playerCount: 2 });
    state.players![0].controller = 'ai';
    state.players![1].controller = 'human';
    state.activeChallenges.forEach(ac => { ac.completed = true; });

    const result = evaluateEndConditions(state);
    expect(result.ended).toBe(true);
    expect(result.gameResult).toBe('loss');
    expect(result.endReason).toBe('all_challenges');
    expect(result.competitiveWinnerId).toBe(0);
  });

  it('human at seat 0 wins challenges → gameResult is win', () => {
    const state = buildHumanVsAis('human-challenges-win', 1, [
      [20, 10],
      [10, 1],
    ]);

    state.activeChallenges.forEach(ac => { ac.completed = true; });

    const result = evaluateEndConditions(state);
    expect(result.ended).toBe(true);
    expect(result.gameResult).toBe('win');
    expect(result.endReason).toBe('all_challenges');
    expect(result.competitiveWinnerId).toBe(0);
  });
});

describe('Turn limit victory → correct human/AI win attribution (AC1)', () => {
  it('AI has best score at turn limit → human sees loss', () => {
    const state = buildHumanVsAis('ai-turn-limit-win', 1, [
      [10, 5],   // human below threshold
      [20, 5],   // AI above human, below threshold
    ], 100);

    // Set turn to maxTurns to trigger turn-limit path
    state.config = { ...state.config, maxTurns: 3, winThreshold: 100 } as typeof state.config;
    state.turn = 3;

    const result = evaluateEndConditions(state);
    expect(result.ended).toBe(true);
    expect(result.gameResult).toBe('loss');
    expect(result.endReason).toBe('turn_limit_victory');
    expect(result.competitiveWinnerId).toBe(1);
  });

  it('human has best score at turn limit → gameResult is win', () => {
    const state = buildHumanVsAis('human-turn-limit-win', 1, [
      [20, 5],   // human above AI
      [10, 5],   // AI below human
    ], 100);

    state.config = { ...state.config, maxTurns: 3, winThreshold: 100 } as typeof state.config;
    state.turn = 3;

    const result = evaluateEndConditions(state);
    expect(result.ended).toBe(true);
    expect(result.gameResult).toBe('win');
    expect(result.endReason).toBe('turn_limit_victory');
    expect(result.competitiveWinnerId).toBe(0);
  });
});

describe('Single-player mode unchanged (AC4)', () => {
  it('single-player threshold win still shows gameResult win', () => {
    // Build a competitive state then strip players to simulate single-player
    const state = buildCompetitiveState({ seed: 'sp-threshold', playerCount: 1 });
    state.players = undefined; // single-player path: no players[] → checkEndConditions
    state.config = { ...state.config, winThreshold: 10 } as typeof state.config;
    state.resourceBank.coins = 20;
    state.resourceBank.reputation = 10;
    state.finalScore = 20;

    checkEndConditions(state);

    expect(state.gameResult).toBe('win');
    expect(state.endReason).toBe('score_threshold');
  });
});
