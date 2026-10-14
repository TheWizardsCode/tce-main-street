/**
 * Main Street: Per-Seat Challenge Celebration & Achievement Gating
 *
 * Unit tests for the competitive per-seat gating of challenge presentation
 * (MS-0MUWNTJIK009O6BZ, Q3 = A): in competitive human-vs-AI play only the
 * **human seat's** completions may fire the celebration VFX/SFX, unlock a
 * Steam achievement, or appear in the HUD challenge contribution. A challenge
 * completed by an AI seat is credited to that seat and must not celebrate or
 * unlock for the human. Single-player / legacy runs (no seat context) keep
 * their run-global behaviour byte-for-byte.
 *
 * Coverage:
 *  1. Human completion in competitive mode → celebration fires and the
 *     achievement bridge unlocks.
 *  2. AI completion in competitive mode → no celebration and no unlock.
 *  3. Single-player → celebration and achievement behaviour unchanged.
 *  4. `celebrateChallengeIds` filters an id list down to the human seat's
 *     completions (including mixed human/AI batches).
 *  5. The per-action evaluation path (`evaluateChallengesAfterAction`) applies
 *     the same gate using `state.activePlayerId`.
 *  6. The HUD score tooltip's challenge contribution shows only the human
 *     seat's completions in competitive mode; single-player stays global.
 *
 * @module
 */
import { describe, it, expect, vi } from 'vitest';

import {
  createCompetitiveState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import { findHumanSeatId } from '../../src/MainStreetEngine';
import {
  CHALLENGE_TEMPLATES,
  evaluateChallenges,
  evaluateChallengesAfterAction,
  type ActiveChallenge,
} from '../../src/MainStreetChallenges';
import {
  createMainStreetAchievementSystem,
} from '../../src/MainStreetAchievements';
import {
  celebrateChallengeIds,
  type ChallengeCelebrationScene,
} from '../../src/scenes/MainStreetChallengeCelebration';
import { buildScoreTooltip, HUD_TOOLTIP_STRINGS } from '../../src/scenes/MainStreetHudTooltips';
import type { AchievementSink } from '@core-engine/AchievementSystem';

// ── Helpers ─────────────────────────────────────────────────

/** Recording achievement sink for asserting the bridge unlock pattern. */
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
 * Builds an active challenge from a real template id with an always-true
 * evaluator, so `evaluateChallenges` completes it deterministically while the
 * id still maps to a real achievement.
 */
function activeChallenge(
  id: string,
  opts: { completed?: boolean; seatId?: number | null } = {},
): ActiveChallenge {
  const template = CHALLENGE_TEMPLATES.find(c => c.id === id);
  if (!template) throw new Error(`Challenge template '${id}' not found`);
  const record: ActiveChallenge = {
    challenge: { ...template, evaluator: () => true },
    completed: opts.completed ?? false,
  };
  if (opts.seatId !== undefined) record.completedBySeatId = opts.seatId;
  return record;
}

/** Attaches a fresh recording achievement system and returns its sink. */
function attachAchievements(state: MainStreetState): RecordingSink {
  const sink = new RecordingSink();
  state.achievementSystem = createMainStreetAchievementSystem({ sink });
  return sink;
}

/** A 2-seat competitive state: seat 0 is human, seat 1 is AI. */
function competitiveState(seed: string, playerCount = 2): MainStreetState {
  return createCompetitiveState({ seed, playerCount });
}

interface SceneHarness {
  scene: ChallengeCelebrationScene;
  scheduled: Array<{ delay: number; cb: () => void }>;
  celebrate: ReturnType<typeof vi.fn>;
  refreshAll: ReturnType<typeof vi.fn>;
  refreshAllExceptStreet: ReturnType<typeof vi.fn>;
}

/** Mock celebration scene backed by the real game state. */
function makeScene(state: MainStreetState): SceneHarness {
  const scheduled: Array<{ delay: number; cb: () => void }> = [];
  const celebrate = vi.fn().mockResolvedValue(undefined);
  const refreshAll = vi.fn();
  const refreshAllExceptStreet = vi.fn();

  const scene: ChallengeCelebrationScene = {
    celebratedChallengeIds: new Set<string>(),
    state: state as unknown as ChallengeCelebrationScene['state'],
    time: {
      delayedCall(delay: number, cb: () => void) {
        scheduled.push({ delay, cb });
        return undefined;
      },
    },
    msAnimator: { animateCelebration: celebrate },
    refreshAll,
    incomeCollectionActive: false,
    msRenderer: { refreshAllExceptStreet },
  };
  return { scene, scheduled, celebrate, refreshAll, refreshAllExceptStreet };
}

/** Runs all scheduled callbacks (in scheduling order). */
function flush(scheduled: Array<{ delay: number; cb: () => void }>): void {
  for (const { cb } of scheduled.splice(0)) cb();
}

// ── AC1 · Human seat completes a challenge ──────────────────

describe('per-seat celebration & achievement gating · human seat', () => {
  it('celebrates the human completion and unlocks its achievement', () => {
    const state = competitiveState('per-seat-human');
    const sink = attachAchievements(state);
    const humanSeat = findHumanSeatId(state);
    state.activeChallenges = [activeChallenge('ch-foodie-row')];

    const newlyCompleted = evaluateChallenges(state.activeChallenges, state, humanSeat);
    expect(newlyCompleted).toEqual(['ch-foodie-row']);
    expect(sink.unlocks).toEqual(['foodie-row']);

    const { scene, scheduled, celebrate } = makeScene(state);
    const celebrated = celebrateChallengeIds(scene, newlyCompleted);

    expect(celebrated).toEqual(['ch-foodie-row']);
    expect(scene.celebratedChallengeIds.has('ch-foodie-row')).toBe(true);
    flush(scheduled);
    expect(celebrate).toHaveBeenCalledWith('Foodie Row');
  });
});

// ── AC2 · AI seat completes a challenge ─────────────────────

describe('per-seat celebration & achievement gating · AI seat', () => {
  it('does not celebrate or unlock an AI completion', () => {
    const state = competitiveState('per-seat-ai');
    const sink = attachAchievements(state);
    const aiSeat = state.players!.findIndex(p => p.controller === 'ai');
    expect(aiSeat).toBeGreaterThan(0);
    state.activeChallenges = [activeChallenge('ch-foodie-row')];

    const newlyCompleted = evaluateChallenges(state.activeChallenges, state, aiSeat);
    expect(newlyCompleted).toEqual(['ch-foodie-row']);
    // Attribution still records the AI seat, but the human gets no unlock.
    expect(state.activeChallenges[0].completedBySeatId).toBe(aiSeat);
    expect(sink.unlocks).toEqual([]);

    const { scene, scheduled, celebrate } = makeScene(state);
    const celebrated = celebrateChallengeIds(scene, newlyCompleted);

    expect(celebrated).toEqual([]);
    expect(scene.celebratedChallengeIds.has('ch-foodie-row')).toBe(false);
    flush(scheduled);
    expect(celebrate).not.toHaveBeenCalled();
  });
});

// ── AC3 · Single-player unchanged ───────────────────────────

describe('per-seat celebration & achievement gating · single-player', () => {
  it('celebrates and unlocks with no seat context (unchanged)', () => {
    const state = setupMainStreetGame({ seed: 'per-seat-single' });
    expect(state.players ?? []).toHaveLength(0);
    const sink = attachAchievements(state);
    state.activeChallenges = [activeChallenge('ch-foodie-row')];

    const newlyCompleted = evaluateChallenges(state.activeChallenges, state);
    expect(newlyCompleted).toEqual(['ch-foodie-row']);
    expect(state.activeChallenges[0].completedBySeatId).toBeNull();
    expect(sink.unlocks).toEqual(['foodie-row']);

    const { scene, scheduled, celebrate } = makeScene(state);
    const celebrated = celebrateChallengeIds(scene, newlyCompleted);

    expect(celebrated).toEqual(['ch-foodie-row']);
    flush(scheduled);
    expect(celebrate).toHaveBeenCalledWith('Foodie Row');
  });
});

// ── AC4 · celebrateChallengeIds seat gate ───────────────────

describe('celebrateChallengeIds · per-seat gate', () => {
  it('celebrates only the human-completed ids from a mixed batch', () => {
    const state = competitiveState('per-seat-mixed');
    const humanSeat = findHumanSeatId(state);
    const aiSeat = state.players!.findIndex(p => p.controller === 'ai');
    state.activeChallenges = [
      activeChallenge('ch-foodie-row', { completed: true, seatId: humanSeat }),
      activeChallenge('ch-deep-pockets', { completed: true, seatId: aiSeat }),
    ];

    const { scene, scheduled, celebrate } = makeScene(state);
    const celebrated = celebrateChallengeIds(scene, ['ch-foodie-row', 'ch-deep-pockets']);

    expect(celebrated).toEqual(['ch-foodie-row']);
    flush(scheduled);
    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(celebrate).toHaveBeenCalledWith('Foodie Row');
  });

  it('does not credit an unattributed completion to the human in competitive mode', () => {
    const state = competitiveState('per-seat-unattributed');
    state.activeChallenges = [activeChallenge('ch-foodie-row', { completed: true })];

    const { scene, scheduled, celebrate } = makeScene(state);
    const celebrated = celebrateChallengeIds(scene, ['ch-foodie-row']);

    expect(celebrated).toEqual([]);
    flush(scheduled);
    expect(celebrate).not.toHaveBeenCalled();
  });
});

// ── AC1/AC2 · Per-action evaluation path ────────────────────

describe('evaluateChallengesAfterAction · per-seat gate', () => {
  it('unlocks when the human is the active seat', () => {
    const state = competitiveState('per-action-human');
    const sink = attachAchievements(state);
    state.activePlayerId = findHumanSeatId(state);
    state.activeChallenges = [activeChallenge('ch-first-upgrade')];

    const newlyCompleted = evaluateChallengesAfterAction(state);

    expect(newlyCompleted).toEqual(['ch-first-upgrade']);
    expect(state._newlyCompletedThisAction).toEqual(['ch-first-upgrade']);
    expect(sink.unlocks).toEqual(['first-upgrade']);
  });

  it('does not unlock when an AI seat is the active seat', () => {
    const state = competitiveState('per-action-ai');
    const sink = attachAchievements(state);
    state.activePlayerId = state.players!.findIndex(p => p.controller === 'ai');
    state.activeChallenges = [activeChallenge('ch-first-upgrade')];

    const newlyCompleted = evaluateChallengesAfterAction(state);

    expect(newlyCompleted).toEqual(['ch-first-upgrade']);
    expect(state.activeChallenges[0].completedBySeatId).toBe(state.activePlayerId);
    expect(sink.unlocks).toEqual([]);
  });
});

// ── HUD challenge contribution (parent AC4) ─────────────────

describe('HUD challenge contribution · per-seat display', () => {
  it('shows only the human seat\'s completed challenges in competitive mode', () => {
    const state = competitiveState('hud-per-seat');
    const humanSeat = findHumanSeatId(state);
    const aiSeat = state.players!.findIndex(p => p.controller === 'ai');
    state.activeChallenges = [
      activeChallenge('ch-foodie-row', { completed: true, seatId: humanSeat }),
      activeChallenge('ch-deep-pockets', { completed: true, seatId: aiSeat }),
    ];
    state.challengesCompleted = ['ch-foodie-row', 'ch-deep-pockets'];

    const tooltip = buildScoreTooltip(state, null);

    // Human completed exactly one challenge → one bonus, not two.
    expect(tooltip).toContain(
      `${HUD_TOOLTIP_STRINGS.scoreBreakdownChallenges}: ${state.config.challengeBonusPoints}`,
    );
    expect(tooltip).not.toContain(
      `${HUD_TOOLTIP_STRINGS.scoreBreakdownChallenges}: ${state.config.challengeBonusPoints * 2}`,
    );
  });

  it('keeps the run-global contribution in single-player', () => {
    const state = setupMainStreetGame({ seed: 'hud-per-seat-single' });
    state.activeChallenges = [
      activeChallenge('ch-foodie-row', { completed: true }),
    ];
    state.challengesCompleted = ['ch-foodie-row'];

    const tooltip = buildScoreTooltip(state, null);

    expect(tooltip).toContain(
      `${HUD_TOOLTIP_STRINGS.scoreBreakdownChallenges}: ${state.config.challengeBonusPoints}`,
    );
  });
});
