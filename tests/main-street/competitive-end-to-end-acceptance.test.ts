/**
 * Main Street: Competitive end-to-end acceptance.
 *
 * Parent: MS-0MUVBH589001L7NL (Competitive game ends on AI seat failure)
 *
 * AC2 — 1 human + 1 AI: AI collapses → game does not end in loss → human
 *       continues → last AI eliminated → human declared winner → optional
 *       continue solo.
 * AC3 — multi-AI: play continues after one AI is eliminated; the win is
 *       declared only at the last elimination.
 * AC4 — the per-seat regression test is present and green (see
 *       `competitive-seat-failure.test.ts`).
 * AC5 — determinism tests pass; the previously-worked-around seed is resolved
 *       (see `competitive-monte-carlo.test.ts`).
 *
 * @module tests/main-street/competitive-end-to-end-acceptance
 */
import { describe, it, expect } from 'vitest';

import { buildHumanVsAis } from './helpers/competitive-fixtures';
import {
  continueAfterLastStanding,
  executeCompetitiveWeekStart,
  endCompetitiveMarketTurn,
  resolveCompetitiveClosingPhases,
} from '../../src/MainStreetEngine';
import type { MainStreetState } from '../../src/MainStreetState';

// ── Helpers ─────────────────────────────────────────────────

/** Drives a competitive state to InvestmentResolution (no seat actions). */
function driveToClosing(state: MainStreetState): void {
  executeCompetitiveWeekStart(state);
  const n = state.players!.length;
  for (let i = 0; i < n; i++) {
    endCompetitiveMarketTurn(state);
  }
}

// ── AC2: 1 human + 1 AI end-to-end ──────────────────────────

describe('AC2 — 1 human + 1 AI end-to-end', () => {
  it('walks collapse → no loss → last-standing win → continue solo', () => {
    const state = buildHumanVsAis('e2e-1v1', 1, [[500, 5], [500, 0]]);
    state.turn = 2;

    driveToClosing(state);
    // The AI collapses at closing: the game must NOT end in a loss.
    const closing = resolveCompetitiveClosingPhases(state);
    expect(state.players![1].eliminated).toBe(true);
    expect(state.gameResult).toBe('win');
    expect(state.endReason).toBe('last_standing');
    expect(state.competitiveWinnerId).toBe(0);
    expect(closing.gameResult).toBe('win');

    // Optional continue solo resumes play.
    const resumed = continueAfterLastStanding(state);
    expect(resumed).toBe(true);
    expect(state.gameResult).toBe('playing');
    expect(state.endReason).toBe('last_standing_continue');
    expect(state.phase).toBe('WeekStart');

    // A subsequent shared day runs with only the human in rotation.
    executeCompetitiveWeekStart(state);
    endCompetitiveMarketTurn(state);
    expect(state.phase).toBe('InvestmentResolution');
    const next = resolveCompetitiveClosingPhases(state);
    expect(next.gameResult).toBe('playing');
    expect(state.endReason).toBe('last_standing_continue');
  });

  it('an AI bankruptcy collapse follows the same walk', () => {
    const state = buildHumanVsAis('e2e-1v1-bankrupt', 1, [[500, 5], [-5, 3]]);
    state.turn = 2;
    driveToClosing(state);
    const closing = resolveCompetitiveClosingPhases(state);
    expect(closing.gameResult).not.toBe('loss');
    expect(state.players![1].eliminated).toBe(true);
    expect(state.endReason).toBe('last_standing');
  });

  it('a human collapse still ends the game as a loss (not last-standing)', () => {
    const state = buildHumanVsAis('e2e-human', 1, [[500, 0], [500, 5]]);
    state.turn = 2;
    driveToClosing(state);
    const closing = resolveCompetitiveClosingPhases(state);
    expect(closing.gameResult).toBe('loss');
    expect(state.endReason).toBe('reputation_collapse');
    expect(state.players![0].eliminated ?? false).toBe(false);
  });
});

// ── AC3: multi-AI end-to-end ────────────────────────────────

describe('AC3 — multi-AI end-to-end', () => {
  it('continues after one AI is eliminated and wins only at the last', () => {
    const state = buildHumanVsAis('e2e-1v2', 2, [[500, 5], [500, 0], [500, 3]]);
    state.turn = 2;

    // Day 1: seat 1 collapses; seat 2 survives.
    driveToClosing(state);
    const r1 = resolveCompetitiveClosingPhases(state);
    expect(state.players![1].eliminated).toBe(true);
    expect(state.players![2].eliminated ?? false).toBe(false);
    expect(r1.gameResult).toBe('playing');
    expect(state.endReason).not.toBe('last_standing');

    // Day 2: seat 2 collapses → the human wins by last standing.
    state.players![2].reputation = 0;
    executeCompetitiveWeekStart(state);
    endCompetitiveMarketTurn(state); // 0 -> 2 (seat 1 eliminated)
    endCompetitiveMarketTurn(state); // 2 -> InvestmentResolution
    expect(state.phase).toBe('InvestmentResolution');
    const r2 = resolveCompetitiveClosingPhases(state);
    expect(state.players![2].eliminated).toBe(true);
    expect(r2.gameResult).toBe('win');
    expect(state.endReason).toBe('last_standing');
    expect(state.competitiveWinnerId).toBe(0);
  });

  it('eliminating one AI does not declare a winner while others survive', () => {
    const state = buildHumanVsAis('e2e-1v2-survivor', 2, [[500, 5], [500, 0], [500, 4]]);
    state.turn = 2;
    driveToClosing(state);
    const closing = resolveCompetitiveClosingPhases(state);
    expect(closing.gameResult).toBe('playing');
    expect(state.competitiveWinnerId).toBeNull();
  });
});

// ── AC4: regression presence ────────────────────────────────

describe('AC4 — per-seat regression present', () => {
  it('the human-healthy / AI-collapse regression is green (referenced)', () => {
    // The canonical regression lives in competitive-seat-failure.test.ts
    // ("human healthy + AI reputation = 0 → closing does NOT end in loss").
    // Re-run the same shape here so the acceptance item fails if it regresses.
    const state = buildHumanVsAis('e2e-regression', 2, [[500, 5], [300, 0], [300, 4]]);
    state.turn = 2;
    driveToClosing(state);
    const closing = resolveCompetitiveClosingPhases(state);
    expect(closing.gameResult).not.toBe('loss');
  });
});
