/**
 * Main Street: Competitive HUD scoreboard model tests
 *
 * Child MS-0MUTU8J9T0034OT7 of epic MS-0MUTTVR5K002ZDUP. Unit tests for the
 * Phaser-free per-player scoreboard row builder that backs the competitive HUD.
 */
import { describe, expect, it } from 'vitest';

import {
  buildCompetitiveScoreboard,
  formatCompetitiveScoreboardRow,
} from '../../src/scenes/MainStreetCompetitiveScoreboard';
import {
  createCompetitiveState,
  setupMainStreetGame,
  type CompetitiveOpponentConfig,
  type MainStreetState,
} from '../../src/MainStreetState';

const OPPONENTS: CompetitiveOpponentConfig[] = [
  { strategy: 'Random', difficulty: 'Easy' },
  { strategy: 'Greedy', difficulty: 'Medium' },
];

function competitiveState(): MainStreetState {
  return createCompetitiveState({ seed: 'hud-scoreboard', playerCount: 3, opponents: OPPONENTS });
}

describe('buildCompetitiveScoreboard', () => {
  it('returns one row per seat', () => {
    const rows = buildCompetitiveScoreboard(competitiveState());
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.playerId)).toEqual([0, 1, 2]);
  });

  it('reads each seat own coins/reputation/score (not the shared wallet)', () => {
    const state = competitiveState();
    state.players![0].coins = 111;
    state.players![1].coins = 222;
    state.players![2].coins = 333;
    state.players![0].reputation = 10;
    state.players![1].reputation = 20;
    state.players![2].reputation = 30;
    state.players![1].score = 999;
    // Shared wallet deliberately different from any seat.
    state.resourceBank.coins = 5;

    const rows = buildCompetitiveScoreboard(state);
    expect(rows.map((r) => r.coins)).toEqual([111, 222, 333]);
    expect(rows.map((r) => r.reputation)).toEqual([10, 20, 30]);
    expect(rows[1].score).toBe(999);
  });

  it('labels the human seat "You" and AI seats "AI <id>"', () => {
    const rows = buildCompetitiveScoreboard(competitiveState());
    expect(rows[0].label).toBe('You');
    expect(rows[0].isHuman).toBe(true);
    expect(rows[1].label).toBe('AI 1');
    expect(rows[2].label).toBe('AI 2');
    expect(rows[1].isHuman).toBe(false);
  });

  it('highlights only the active seat', () => {
    const state = competitiveState();
    state.activePlayerId = 1;
    const rows = buildCompetitiveScoreboard(state);
    expect(rows.map((r) => r.isActive)).toEqual([false, true, false]);
  });

  it('moves the active highlight when control hands back', () => {
    const state = competitiveState();
    state.activePlayerId = 2;
    expect(buildCompetitiveScoreboard(state).map((r) => r.isActive)).toEqual([false, false, true]);
    state.activePlayerId = 0;
    expect(buildCompetitiveScoreboard(state).map((r) => r.isActive)).toEqual([true, false, false]);
  });

  it('defaults legacy seats without a controller to human/AI by seat index', () => {
    const state = competitiveState();
    for (const player of state.players!) {
      delete player.controller;
    }
    const rows = buildCompetitiveScoreboard(state);
    expect(rows[0].isHuman).toBe(true);
    expect(rows[1].isHuman).toBe(false);
    expect(rows[2].isHuman).toBe(false);
  });

  it('returns no rows for a single-player state', () => {
    const single = setupMainStreetGame({ seed: 'hud-single' });
    expect(buildCompetitiveScoreboard(single)).toEqual([]);
  });
});

describe('formatCompetitiveScoreboardRow', () => {
  it('formats coins/reputation/score and marks the active seat', () => {
    const state = competitiveState();
    state.activePlayerId = 1;
    const rows = buildCompetitiveScoreboard(state);
    expect(formatCompetitiveScoreboardRow(rows[0])).toBe('You: 600c 300r 0pt');
    expect(formatCompetitiveScoreboardRow(rows[1])).toBe('▶ AI 1: 600c 300r 0pt');
  });
});
