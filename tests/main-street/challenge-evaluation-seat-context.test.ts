/**
 * Main Street: Challenge Evaluation Seat Context
 *
 * Wiring tests for MS-0MV344TCN0094CY3 — every challenge evaluation entry
 * point must pass the acting seat's context so a completion is attributed to
 * the seat that actually completed it (parent MS-0MUWNTJIK009O6BZ, Q1 = B /
 * Q3 = A). The per-action path is covered by
 * `challenge-attribution-per-seat.test.ts`; this file pins the remaining
 * competitive paths:
 *
 *  1. EndCheck closing-phase evaluation (`finishCompetitiveClosingTail`, via
 *     `resolveCompetitiveClosingPhases`) attributes to `state.activePlayerId`.
 *  2. `executeCompetitiveTurn` carries the acting seat through a mid-turn
 *     completion (AI seat).
 *  3. `resolveCompetitivePendingChoice` (deferred dual-choice closing)
 *     attributes to `state.activePlayerId`.
 *  4. Single-player closing paths keep `null` / no seat context.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';

import {
  createCompetitiveState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import type { EventCard } from '../../src/MainStreetCards';
import { createMainStreetAchievementSystem } from '../../src/MainStreetAchievements';
import type { AchievementSink } from '@core-engine/AchievementSystem';
import {
  endCompetitiveMarketTurn,
  executeCompetitiveTurn,
  executeCompetitiveWeekStart,
  executeFullTurn,
  resolveCompetitiveClosingPhases,
  resolveCompetitivePendingChoice,
} from '../../src/MainStreetEngine';
import {
  CHALLENGE_TEMPLATES,
  type ActiveChallenge,
} from '../../src/MainStreetChallenges';

// ── Helpers ─────────────────────────────────────────────────

/** Recording achievement sink (asserts the human-only bridge gate). */
class RecordingSink implements AchievementSink {
  readonly unlocks: string[] = [];
  private readonly set = new Set<string>();

  unlock(achievementId: string): void {
    this.unlocks.push(achievementId);
    this.set.add(achievementId);
  }

  getUnlocked(): string[] {
    return [...this.set];
  }

  isUnlocked(achievementId: string): boolean {
    return this.set.has(achievementId);
  }
}

/**
 * An active challenge built from a real template (so its id still maps to an
 * achievement), with an overrideable evaluator — default: always complete.
 */
function activeChallenge(
  id: string,
  evaluator?: (state: MainStreetState) => boolean,
): ActiveChallenge {
  const template = CHALLENGE_TEMPLATES.find(c => c.id === id);
  if (!template) throw new Error(`Challenge template '${id}' not found`);
  return {
    challenge: { ...template, evaluator: evaluator ?? (() => true) },
    completed: false,
  };
}

/** Minimal non-choice incident card (deterministic closing draw). */
function makeIncident(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event' as const,
    id: 'evt-seat-context-incident',
    name: 'Seat Context Incident',
    trigger: 'Incident' as const,
    cost: 0,
    effect: 'test effect',
    target: 'All' as const,
    coinDelta: -10,
    reputationDelta: 0,
    hasChoices: false,
    ...overrides,
  };
}

/** Attaches a fresh recording achievement system and returns its sink. */
function attachAchievements(state: MainStreetState): RecordingSink {
  const sink = new RecordingSink();
  state.achievementSystem = createMainStreetAchievementSystem({ sink });
  return sink;
}

/** Drives a competitive state from WeekStart to the shared closing. */
function driveToClosing(state: MainStreetState): void {
  executeCompetitiveWeekStart(state);
  while (state.phase === 'MarketPhase') {
    endCompetitiveMarketTurn(state);
  }
  expect(state.phase).toBe('InvestmentResolution');
}

// ── AC2 · EndCheck closing-phase attribution ────────────────

describe('EndCheck closing-phase attribution (AC2)', () => {
  it('credits the active seat when the shared closing completes a challenge', () => {
    const state = createCompetitiveState({ seed: 'closing-seat-ai', playerCount: 2 });
    driveToClosing(state);
    state.incidentDeck = [makeIncident()];
    state.activePlayerId = 1; // AI seat
    state.activeChallenges = [activeChallenge('ch-foodie-row')];

    const result = resolveCompetitiveClosingPhases(state);

    expect(result.choicePending).toBe(false);
    expect(state.activeChallenges[0].completed).toBe(true);
    expect(state.activeChallenges[0].completedBySeatId).toBe(1);
  });

  it('does not unlock the human achievement when the closing completion is credited to an AI seat', () => {
    const state = createCompetitiveState({ seed: 'closing-seat-ai-unlock', playerCount: 2 });
    driveToClosing(state);
    state.incidentDeck = [makeIncident()];
    state.activePlayerId = 1;
    state.activeChallenges = [activeChallenge('ch-foodie-row')];
    const sink = attachAchievements(state);

    resolveCompetitiveClosingPhases(state);

    expect(state.activeChallenges[0].completedBySeatId).toBe(1);
    expect(sink.unlocks).toEqual([]);
  });

  it('credits the human active seat and unlocks the human achievement', () => {
    const state = createCompetitiveState({ seed: 'closing-seat-human', playerCount: 2 });
    driveToClosing(state);
    state.incidentDeck = [makeIncident()];
    state.activePlayerId = 0; // human seat
    state.activeChallenges = [activeChallenge('ch-foodie-row')];
    const sink = attachAchievements(state);

    resolveCompetitiveClosingPhases(state);

    expect(state.activeChallenges[0].completedBySeatId).toBe(0);
    expect(sink.unlocks).toEqual(['foodie-row']);
  });
});

// ── AC3 · executeCompetitiveTurn mid-turn seat context ──────

describe('executeCompetitiveTurn mid-turn seat context (AC3)', () => {
  it('attributes an AI mid-turn completion to the AI seat, not the human seat', () => {
    const state = createCompetitiveState({ seed: 'mid-turn-ai', playerCount: 2 });
    // The challenge becomes satisfiable only while the AI seat (id 1) is
    // acting, proving the context follows the acting seat through the turn.
    state.activeChallenges = [
      activeChallenge('ch-foodie-row', s => s.activePlayerId === 1),
    ];

    // The human seat (0) takes no action; the AI seat (1) takes a free
    // Community Favour, which triggers per-action challenge evaluation.
    executeCompetitiveTurn(state, [
      [],
      [{ type: 'community-favour', direction: 'rep-to-coins' }],
    ]);

    expect(state.activeChallenges[0].completed).toBe(true);
    expect(state.activeChallenges[0].completedBySeatId).toBe(1);
  });
});

// ── AC4 · Deferred dual-choice closing seat context ─────────

describe('resolveCompetitivePendingChoice seat context (AC4)', () => {
  it('attributes the deferred closing completion to the active seat', () => {
    const state = createCompetitiveState({ seed: 'pending-choice-seat', playerCount: 2 });
    driveToClosing(state);
    state.activePlayerId = 1;
    state.activeChallenges = [activeChallenge('ch-foodie-row')];
    // A legacy dual-choice incident, directly staged as unresolved.
    state.pendingEventChoice = {
      event: makeIncident({ id: 'evt-choice-seat', hasChoices: true }),
      chosenOption: null,
      resolved: false,
    };

    const result = resolveCompetitivePendingChoice(state);

    expect(result).not.toBeNull();
    expect(state.activeChallenges[0].completed).toBe(true);
    expect(state.activeChallenges[0].completedBySeatId).toBe(1);
  });
});

// ── AC5 · Single-player keeps no seat context ───────────────

describe('single-player closing keeps no seat context (AC5)', () => {
  it('attributes a closing-phase completion to null in single-player', () => {
    const state = setupMainStreetGame({ seed: 'closing-single-player' });
    state.activeChallenges = [activeChallenge('ch-foodie-row')];

    const result = executeFullTurn(state, []);

    expect(result.newlyCompletedChallenges).toContain('ch-foodie-row');
    expect(state.activeChallenges[0].completed).toBe(true);
    expect(state.activeChallenges[0].completedBySeatId).toBeNull();
  });
});
