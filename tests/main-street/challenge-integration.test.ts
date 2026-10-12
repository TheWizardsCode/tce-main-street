/**
 * Main Street: Per-Seat Challenge Attribution Integration
 *
 * Integration tests (child MS-0MV33TSK20076Q36 of epic MS-0MUWNTJIK009O6BZ)
 * spanning the undo/redo snapshot layer, the headless multi-turn engine loop
 * and the EndCheck closing-phase evaluation. Complements the unit-level
 * attribution / scoring / celebration suites by exercising the real paths a
 * game session (and the headless AI-training loop) uses.
 *
 * Coverage:
 *  1. AC3 — undo revokes an attributed completion and clears
 *     `completedBySeatId`; redo re-attributes it to the acting seat.
 *  2. AC3 — after an undo, a different seat can complete the same challenge
 *     and is credited (no stale first-completer attribution).
 *  3. AC4 — the headless shared-day loop attributes completions to the acting
 *     seat across multiple turns and preserves earlier attributions. These are
 *     the same engine entry points the Monte Carlo harness drives.
 *  4. AC5 — a closing-phase (EndCheck) completion is attributed to the active
 *     seat in competitive mode and globally (`null`) in single-player.
 *
 * @module
 */
import { describe, it, expect, vi } from 'vitest';

import {
  createCompetitiveState,
  setupMainStreetGame,
  syncResourceBankToLedger,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  executeCompetitiveTurn,
  executeCompetitiveWeekStart,
  executeFullTurn,
} from '../../src/MainStreetEngine';
import { moveToHandCommand } from '../../src/MainStreetCommands';
import {
  CHALLENGE_TEMPLATES,
  type ActiveChallenge,
} from '../../src/MainStreetChallenges';
import { type BusinessCard } from '../../src/MainStreetCards';
import {
  performRedo,
  performUndo,
} from '../../src/scenes/MainStreetTurnControllerTurnFlow';
import { UndoRedoManager } from '@core-engine/UndoRedoManager';

// ── Helpers ─────────────────────────────────────────────────

/** Finds a challenge template by ID (throws if missing). */
function template(id: string): ActiveChallenge['challenge'] {
  const t = CHALLENGE_TEMPLATES.find(c => c.id === id);
  if (!t) throw new Error(`Challenge template '${id}' not found`);
  return t;
}

/** Replaces the active challenges with the given IDs (all incomplete). */
function activate(state: MainStreetState, ...ids: string[]): void {
  state.activeChallenges = ids.map(id => ({
    challenge: template(id),
    completed: false,
  }));
}

/** The `ActiveChallenge` record for a challenge id (throws if missing). */
function record(state: MainStreetState, id: string): ActiveChallenge {
  const ac = state.activeChallenges.find(c => c.challenge.id === id);
  if (!ac) throw new Error(`Active challenge '${id}' not found`);
  return ac;
}

/** A 2-seat competitive state: seat 0 is human, seat 1 is AI. */
function competitiveState(seed: string): MainStreetState {
  return createCompetitiveState({ seed, playerCount: 2 });
}

/** A competitive state armed at MarketPhase for player 0. */
function marketCompetitiveState(seed: string): MainStreetState {
  const state = competitiveState(seed);
  executeCompetitiveWeekStart(state);
  return state;
}

/** A business card available in the market (fabricated from the deck if needed). */
function marketBusinessCard(state: MainStreetState) {
  let card = state.market.cards.find(c => c.family === 'business');
  if (!card) {
    const deckCard = state.decks.business?.find((c: BusinessCard) => c.family === 'business');
    if (!deckCard) throw new Error('No business cards available');
    card = { ...deckCard };
    state.market.cards.push(card);
  }
  return card;
}

/**
 * A challenge whose evaluator is driven by `enabled` (the id is complete only
 * while it is a member) — lets a test decide which shared day completes which
 * challenge without depending on the resource economy.
 */
function gatedChallenge(id: string, enabled: ReadonlySet<string>): ActiveChallenge {
  return {
    challenge: { ...template(id), evaluator: () => enabled.has(id) },
    completed: false,
  };
}

/** A challenge that only completes during the EndCheck closing phase. */
function endCheckChallenge(id: string): ActiveChallenge {
  return {
    challenge: { ...template(id), evaluator: (state: MainStreetState) => state.phase === 'EndCheck' },
    completed: false,
  };
}

/** Mock scene supporting `performUndo` / `performRedo` (captures dialog callbacks). */
function makeUndoScene(state: MainStreetState, undoManager: UndoRedoManager) {
  const dialogCalls: Array<{ titles: string[]; onConfirm: () => void; onCancel: () => void }> = [];
  const scene: any = {
    uiPhase: 'market',
    undoManager,
    state,
    justMovedHandCardId: null,
    showUndoChallengeWarningDialog: vi.fn(
      (titles: string[], onConfirm: () => void, onCancel: () => void) => {
        dialogCalls.push({ titles, onConfirm, onCancel });
      },
    ),
    refreshUndoRedoButtons: vi.fn(),
    refreshAll: vi.fn(),
    msAnimator: { animateUndoRedo: vi.fn() },
  };
  return { scene, tcCtx: { scene } as any, dialogCalls };
}

// ── AC3 · Undo/redo restores the attributed challenge state ─

describe('undo/redo · attributed challenge state (AC3)', () => {
  it('undo revokes the attribution and redo re-attributes it to the acting seat', () => {
    const state = marketCompetitiveState('undo-attr-redo');
    state.activePlayerId = 0;
    activate(state, 'ch-deep-pockets');
    state.resourceBank.coins = 3000;
    syncResourceBankToLedger(state);
    state.maxHandSize = 5;

    const card = marketBusinessCard(state);
    const undoManager = new UndoRedoManager();
    undoManager.execute(moveToHandCommand(state, card.id));

    // The acting human seat completed Deep Pockets.
    expect(record(state, 'ch-deep-pockets').completed).toBe(true);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(0);

    // Undo (confirming the challenge warning) revokes flag + attribution.
    const { tcCtx, dialogCalls } = makeUndoScene(state, undoManager);
    performUndo(tcCtx);
    expect(dialogCalls).toHaveLength(1);
    expect(dialogCalls[0].titles).toEqual(['Deep Pockets']);
    dialogCalls[0].onConfirm();

    expect(record(state, 'ch-deep-pockets').completed).toBe(false);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBeUndefined();
    expect(state.challengesCompleted).not.toContain('ch-deep-pockets');

    // Redo re-applies the action and re-attributes it to the acting seat.
    performRedo(tcCtx);
    expect(record(state, 'ch-deep-pockets').completed).toBe(true);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(0);
    expect(
      state.challengesCompleted.filter(id => id === 'ch-deep-pockets'),
    ).toHaveLength(1);
  });

  it('credits a different seat that completes the challenge after an undo', () => {
    const state = marketCompetitiveState('undo-attr-other-seat');
    state.activePlayerId = 0;
    activate(state, 'ch-deep-pockets');
    state.resourceBank.coins = 3000;
    syncResourceBankToLedger(state);
    state.maxHandSize = 5;

    const undoManager = new UndoRedoManager();
    undoManager.execute(moveToHandCommand(state, marketBusinessCard(state).id));
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(0);

    const { tcCtx, dialogCalls } = makeUndoScene(state, undoManager);
    performUndo(tcCtx);
    dialogCalls[0].onConfirm();
    // The undone completion is unattributed, not left on the original seat.
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBeUndefined();

    // Seat 1 (the AI) now performs the completing action.
    state.activePlayerId = 1;
    undoManager.execute(moveToHandCommand(state, marketBusinessCard(state).id));

    expect(record(state, 'ch-deep-pockets').completed).toBe(true);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(1);
  });
});

// ── AC4 · Headless multi-turn attribution ───────────────────

describe('headless multi-turn play · attribution (AC4)', () => {
  it('attributes completions to the acting seat across multiple shared days', () => {
    const state = competitiveState('headless-multi-turn');
    const enabled = new Set<string>();
    state.activeChallenges = [
      gatedChallenge('ch-deep-pockets', enabled),
      gatedChallenge('ch-beloved-mayor', enabled),
    ];
    // Fund the free once-per-day Community Favour (rep-to-coins needs 200 rep).
    state.resourceBank.reputation = 600;
    syncResourceBankToLedger(state);

    // Day 1 — the human seat (0) acts first and completes Deep Pockets.
    enabled.add('ch-deep-pockets');
    executeCompetitiveTurn(state, [
      [{ type: 'community-favour', direction: 'rep-to-coins' }],
      [],
    ]);
    expect(record(state, 'ch-deep-pockets').completed).toBe(true);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(0);

    // Day 2 — the AI seat (1) completes Beloved Mayor during its own phase.
    enabled.delete('ch-deep-pockets');
    enabled.add('ch-beloved-mayor');
    executeCompetitiveTurn(state, [
      [],
      [{ type: 'community-favour', direction: 'rep-to-coins' }],
    ]);

    expect(record(state, 'ch-beloved-mayor').completed).toBe(true);
    expect(record(state, 'ch-beloved-mayor').completedBySeatId).toBe(1);
    // The earlier day's attribution is untouched by the later day's EndCheck.
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(0);
    expect(state.challengesCompleted).toEqual(['ch-deep-pockets', 'ch-beloved-mayor']);
  });

  it('keeps single-player headless attribution global across multiple turns', () => {
    const state = setupMainStreetGame({ seed: 'headless-single-multi' });
    const enabled = new Set<string>();
    state.activeChallenges = [
      gatedChallenge('ch-deep-pockets', enabled),
      // Second challenge stays incomplete so the run continues past turn 1.
      gatedChallenge('ch-beloved-mayor', enabled),
    ];

    // The challenge completes during the first turn's EndCheck.
    enabled.add('ch-deep-pockets');
    executeFullTurn(state, []);
    expect(state.gameResult).toBe('playing');
    expect(record(state, 'ch-deep-pockets').completed).toBe(true);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBeNull();

    // A later turn must neither reassign nor re-complete it.
    executeFullTurn(state, []);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBeNull();
    expect(
      state.challengesCompleted.filter(id => id === 'ch-deep-pockets'),
    ).toHaveLength(1);
  });
});

// ── AC5 · EndCheck closing-phase attribution ────────────────

describe('EndCheck closing-phase completion · attribution (AC5)', () => {
  it('attributes a competitive closing completion to the active seat', () => {
    const state = competitiveState('endcheck-competitive');
    state.activeChallenges = [endCheckChallenge('ch-deep-pockets')];

    // No actions are taken, so the challenge can only complete at EndCheck.
    executeCompetitiveTurn(state, [[], []]);

    expect(record(state, 'ch-deep-pockets').completed).toBe(true);
    // The last seat to take its MarketPhase is the active seat at closing.
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBe(1);
  });

  it('attributes a single-player closing completion globally (null seat)', () => {
    const state = setupMainStreetGame({ seed: 'endcheck-single' });
    state.activeChallenges = [endCheckChallenge('ch-deep-pockets')];

    executeFullTurn(state, []);

    expect(record(state, 'ch-deep-pockets').completed).toBe(true);
    expect(record(state, 'ch-deep-pockets').completedBySeatId).toBeNull();
  });
});
