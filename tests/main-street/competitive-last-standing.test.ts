/**
 * Main Street: Last-standing win + continue-solo option.
 *
 * Parent: MS-0MUVBH589001L7NL (Competitive game ends on AI seat failure)
 *
 * AC1 — 1 human + 1 AI: eliminating the AI declares the human winner
 *       (`gameResult='win'`, `competitiveWinnerId=human`, `last_standing`).
 * AC2 — multiple AIs: no winner until the last AI is eliminated.
 * AC3 — `last_standing` / `last_standing_continue` EndReason values.
 * AC4 — explicit continue-solo offer; accepting resumes play.
 * AC5 — idempotent (no re-declare / re-offer on subsequent closings).
 * AC6 — determinism/idempotence + scene-level offered/declined paths.
 * AC7 — winner resolved via `controller === 'human'`, not hard-coded seat 0.
 *
 * @module tests/main-street/competitive-last-standing
 */
import { describe, it, expect, vi } from 'vitest';

import { buildCompetitiveState, buildHumanVsAis } from './helpers/competitive-fixtures';
import {
  checkLastStanding,
  continueAfterLastStanding,
  findHumanSeatId,
  resolveCompetitiveSeatFailures,
  checkCompetitiveEndConditions,
  executeCompetitiveWeekStart,
  endCompetitiveMarketTurn,
  resolveCompetitiveClosingPhases,
} from '../../src/MainStreetEngine';
import { continueCompetitiveLastStanding } from '../../src/scenes/MainStreetTurnControllerCompetitive';
import type { MainStreetState } from '../../src/MainStreetState';

// ── Helpers ─────────────────────────────────────────────────

function fakeControllerContext(state: MainStreetState) {
  const scene = { state, uiPhase: 'game-over' } as any;
  const startTurnPhase = vi.fn();
  const handleGameOver = vi.fn();
  const ctx = { scene, startTurnPhase, handleGameOver } as any;
  return { ctx, startTurnPhase, handleGameOver };
}

// ── AC1: 1 human vs 1 AI ────────────────────────────────────

describe('AC1 — eliminating the only AI declares the human winner', () => {
  it('sets win / last_standing / human winner', () => {
    const state = buildHumanVsAis('ls-1v1', 1, [[500, 5], [500, 0]]);
    state.turn = 2;
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(true);
    expect(state.gameResult).toBe('win');
    expect(state.endReason).toBe('last_standing');
    expect(state.competitiveWinnerId).toBe(0);
  });

  it('checkLastStanding returns true and is idempotent', () => {
    const state = buildHumanVsAis('ls-1v1-idem', 1, [[500, 5], [500, 0]]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);
    // A second resolution does not re-declare (endReason already last_standing).
    expect(checkLastStanding(state)).toBe(false);
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(false);
    expect(state.endReason).toBe('last_standing');
  });

  it('does not fire while an AI seat survives', () => {
    const state = buildHumanVsAis('ls-survivor', 1, [[500, 5], [500, 3]]);
    expect(checkLastStanding(state)).toBe(false);
    expect(state.gameResult).toBe('playing');
  });

  it('does not fire for a single-human (N=1) competitive state', () => {
    const state = buildCompetitiveState({ seed: 'ls-n1', playerCount: 1 });
    state.turn = 2;
    expect(checkLastStanding(state)).toBe(false);
  });

  it('does not fire for an all-AI state (no human)', () => {
    const state = buildCompetitiveState({ seed: 'ls-all-ai', playerCount: 2 });
    state.players![0].controller = 'ai';
    state.players![1].controller = 'ai';
    state.players![0].eliminated = true;
    state.players![1].eliminated = true;
    expect(checkLastStanding(state)).toBe(false);
  });
});

// ── AC2: multiple AIs ───────────────────────────────────────

describe('AC2 — with multiple AIs the win waits for the last elimination', () => {
  it('eliminating one of two AIs does not declare a winner', () => {
    const state = buildHumanVsAis('ls-multi-1', 2, [[500, 5], [500, 0], [500, 3]]);
    state.turn = 2;
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(false);
    expect(state.gameResult).toBe('playing');
    expect(state.endReason).toBeNull();
    expect(state.competitiveWinnerId).toBeNull();
  });

  it('the win is declared only once the last AI is eliminated', () => {
    const state = buildHumanVsAis('ls-multi-2', 2, [[500, 5], [500, 0], [500, 0]]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);
    expect(state.gameResult).toBe('win');
    expect(state.endReason).toBe('last_standing');
    expect(state.competitiveWinnerId).toBe(0);
  });
});

// ── AC4: continue solo ──────────────────────────────────────

describe('AC4 — continue-solo option', () => {
  it('accepting resumes play with last_standing_continue', () => {
    const state = buildHumanVsAis('ls-continue', 1, [[500, 5], [500, 0]]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);
    expect(state.endReason).toBe('last_standing');

    const resumed = continueAfterLastStanding(state);
    expect(resumed).toBe(true);
    expect(state.gameResult).toBe('playing');
    expect(state.endReason).toBe('last_standing_continue');
    expect(state.phase).toBe('WeekStart');
  });

  it('is idempotent — a second continue is a no-op', () => {
    const state = buildHumanVsAis('ls-continue-idem', 1, [[500, 5], [500, 0]]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);
    expect(continueAfterLastStanding(state)).toBe(true);
    const turnAfter = state.turn;
    expect(continueAfterLastStanding(state)).toBe(false);
    expect(state.turn).toBe(turnAfter);
    expect(state.endReason).toBe('last_standing_continue');
  });

  it('a no-op when no offer is open', () => {
    const state = buildHumanVsAis('ls-no-offer', 1, [[500, 5], [500, 3]]);
    expect(continueAfterLastStanding(state)).toBe(false);
    expect(state.gameResult).toBe('playing');
  });
});

// ── AC5: idempotence across subsequent closings ─────────────

describe('AC5 — subsequent closings do not re-declare or re-offer', () => {
  it('after continuing, later end-checks keep playing', () => {
    const state = buildHumanVsAis('ls-subsequent', 1, [[500, 5], [500, 0]]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);
    continueAfterLastStanding(state);

    // A subsequent EndCheck must not re-trigger last-standing.
    const ended = checkCompetitiveEndConditions(state);
    expect(ended).toBe(false);
    expect(state.gameResult).toBe('playing');
    expect(state.endReason).toBe('last_standing_continue');
  });

  it('a full subsequent shared day after continuing stays playable', () => {
    const state = buildHumanVsAis('ls-next-day', 1, [[500, 5], [500, 0]]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);
    continueAfterLastStanding(state);
    expect(state.phase).toBe('WeekStart');

    // Drive one more shared day (only the human remains in rotation).
    executeCompetitiveWeekStart(state);
    endCompetitiveMarketTurn(state);
    expect(state.phase).toBe('InvestmentResolution');
    const result = resolveCompetitiveClosingPhases(state);
    expect(result.gameResult).toBe('playing');
    expect(state.endReason).toBe('last_standing_continue');
  });
});

// ── AC7: winner via controller === 'human' ──────────────────

describe('AC7 — winner resolved via controller, not hard-coded seat 0', () => {
  it('findHumanSeatId resolves the human seat', () => {
    const state = buildHumanVsAis('ls-human-seat', 1, [[500, 5], [500, 3]]);
    expect(findHumanSeatId(state)).toBe(0);
  });

  it('declares the correct winner when the human is not seat 0', () => {
    const state = buildCompetitiveState({
      seed: 'ls-human-seat-1',
      playerCount: 2,
      seatWallets: [
        { playerId: 0, coins: 500, reputation: 0 }, // AI
        { playerId: 1, coins: 500, reputation: 5 }, // human
      ],
    });
    state.players![0].controller = 'ai';
    state.players![1].controller = 'human';
    state.turn = 2;
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(true);
    expect(state.competitiveWinnerId).toBe(1);
    expect(state.players![1].eliminated ?? false).toBe(false);
  });
});

// ── AC6: scene-level offered / declined paths ───────────────

describe('AC6 — scene-level offered/declined paths', () => {
  it('offered (accepted): continueCompetitiveLastStanding resumes the scene', () => {
    const state = buildHumanVsAis('ls-scene-accept', 1, [[500, 5], [500, 0]]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);
    const { ctx, startTurnPhase } = fakeControllerContext(state);

    const resumed = continueCompetitiveLastStanding(ctx);
    expect(resumed).toBe(true);
    expect(state.gameResult).toBe('playing');
    expect(state.endReason).toBe('last_standing_continue');
    expect(startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('declined: state remains the last-standing win', () => {
    const state = buildHumanVsAis('ls-scene-decline', 1, [[500, 5], [500, 0]]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);
    // Declining = not calling continueCompetitiveLastStanding.
    expect(state.gameResult).toBe('win');
    expect(state.endReason).toBe('last_standing');
    expect(state.competitiveWinnerId).toBe(0);
  });

  it('scene continue is a no-op without an open offer', () => {
    const state = buildHumanVsAis('ls-scene-noop', 1, [[500, 5], [500, 3]]);
    const { ctx, startTurnPhase } = fakeControllerContext(state);
    expect(continueCompetitiveLastStanding(ctx)).toBe(false);
    expect(startTurnPhase).not.toHaveBeenCalled();
  });
});
