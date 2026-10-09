/**
 * Main Street: Enter Endless Mode scene continuation.
 *
 * Child of MS-0MTIILU5V006GCN4.
 *
 * AC2 — Pressing [ Enter Endless Mode ] accepts the endless-continuation
 *       offer, resumes the game loop (`gameResult` back to `'playing'`) and
 *       keeps scoring; declining leaves the declared win.
 * AC3 — The action is a no-op unless the endless offer is actually open.
 *
 * The scene wiring (`MainStreetOverlayContent` → `[ Enter Endless Mode ]`) is
 * covered in `game-over-overlay.test.ts`; this module drives the turn-
 * controller seam it calls end-to-end against a real engine state.
 *
 * @module tests/main-street/endless-mode-continuation
 */
import { describe, it, expect, vi } from 'vitest';

import {
  setupMainStreetGame,
  createCompetitiveState,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  checkEndConditions,
  checkCompetitiveEndConditions,
  updateCompetitiveScores,
} from '../../src/MainStreetEngine';
import { continueEndlessMode } from '../../src/scenes/MainStreetTurnControllerCompetitive';
import { MainStreetTurnController } from '../../src/scenes/MainStreetTurnController';

// ── Helpers ─────────────────────────────────────────────────

function fakeControllerContext(state: MainStreetState) {
  const scene = { state, uiPhase: 'game-over' } as any;
  const startTurnPhase = vi.fn();
  const handleGameOver = vi.fn();
  const ctx = { scene, startTurnPhase, handleGameOver } as any;
  return { ctx, startTurnPhase, handleGameOver };
}

/** Opens the single-player endless offer and returns the state. */
function openSinglePlayerOffer(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed, endlessMode: true });
  state.resourceBank.coins = state.config.winThreshold + 10;
  checkEndConditions(state);
  return state;
}

/** Opens the competitive endless offer (human seat crosses first). */
function openCompetitiveOffer(seed: string): MainStreetState {
  const state = createCompetitiveState({ seed, playerCount: 2, endlessMode: true });
  const bonus = state.challengesCompleted.length * state.config.challengeBonusPoints;
  const rep = 1;
  [state.config.winThreshold + 2, 1].forEach((desired, i) => {
    state.players![i].coins = desired - rep - bonus;
    state.players![i].reputation = rep;
  });
  updateCompetitiveScores(state);
  checkCompetitiveEndConditions(state);
  return state;
}

// ── AC2: accepting the offer resumes play ───────────────────

describe('AC2 — [ Enter Endless Mode ] resumes the game loop', () => {
  it('accepting the single-player offer resumes play and starts the next turn', () => {
    const state = openSinglePlayerOffer('endless-ui-single');
    expect(state.gameResult).toBe('win');
    expect(state.endReason).toBe('score_threshold_continue');

    const { ctx, startTurnPhase } = fakeControllerContext(state);
    const resumed = continueEndlessMode(ctx);

    expect(resumed).toBe(true);
    expect(state.gameResult).toBe('playing');
    expect(state.endReason).toBe('score_threshold_continue');
    expect(state.turn).toBe(2); // advanced from turn 1
    expect(startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('accepting the competitive offer resumes play', () => {
    const state = openCompetitiveOffer('endless-ui-comp');
    expect(state.gameResult).toBe('win');
    expect(state.endReason).toBe('score_threshold_continue');

    const { ctx, startTurnPhase } = fakeControllerContext(state);
    const resumed = continueEndlessMode(ctx);

    expect(resumed).toBe(true);
    expect(state.gameResult).toBe('playing');
    expect(startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('declining leaves the declared threshold win', () => {
    const state = openSinglePlayerOffer('endless-ui-decline');
    // Declining = not calling continueEndlessMode.
    expect(state.gameResult).toBe('win');
    expect(state.endReason).toBe('score_threshold_continue');
  });
});

// ── AC3: the action is a no-op without an open offer ────────

describe('AC3 — no-op without an open endless offer', () => {
  it('continueEndlessMode returns false and does not advance the turn', () => {
    const state = setupMainStreetGame({ seed: 'endless-ui-noop' });
    const { ctx, startTurnPhase } = fakeControllerContext(state);

    expect(continueEndlessMode(ctx)).toBe(false);
    expect(state.gameResult).toBe('playing');
    expect(state.endReason).toBeNull();
    expect(startTurnPhase).not.toHaveBeenCalled();
  });

  it('is idempotent — a second call after acceptance is a no-op', () => {
    const state = openSinglePlayerOffer('endless-ui-idem');
    const { ctx, startTurnPhase } = fakeControllerContext(state);

    expect(continueEndlessMode(ctx)).toBe(true);
    const turnAfterAccept = state.turn;
    expect(continueEndlessMode(ctx)).toBe(false);
    expect(state.turn).toBe(turnAfterAccept);
    expect(startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('the win overlay action is also exposed on MainStreetTurnController', () => {
    const state = openSinglePlayerOffer('endless-ui-controller');
    const scene: any = { state, uiPhase: 'game-over', refreshAll: vi.fn(), overlayObjects: [] };
    const controller = new MainStreetTurnController(scene);
    const startSpy = vi.spyOn(controller, 'startTurnPhase').mockImplementation(() => {});

    expect(controller.continueEndlessMode()).toBe(true);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(state.gameResult).toBe('playing');
  });
});
