/**
 * Main Street: persistent achievement mapping (F7, CG-0MUNC7FK5001T5CP).
 *
 * Verifies that:
 *  - every challenge template is mapped to exactly one achievement,
 *  - the game mapping matches the launcher manifest (drift guard),
 *  - challenge completion unlocks the mapped achievement through the engine
 *    `AchievementSystem`, exactly once (idempotent),
 *  - the mapping delegates to an injectable sink (the IPC bridge in the
 *    launcher, a no-op elsewhere),
 *  - the runtime resolves safely with no Steam bridge present (browser /
 *    headless) — no Steam SDK is imported anywhere in this repo.
 *
 * @module
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

import {
  CHALLENGE_TO_ACHIEVEMENT_ID,
  MAIN_STREET_ACHIEVEMENT_DEFINITIONS,
  MAIN_STREET_GAME_ID,
  achievementIdForChallenge,
  createMainStreetAchievementSystem,
  resolveMainStreetAchievementSink,
} from '../../src/MainStreetAchievements';
import { CHALLENGE_TEMPLATES, evaluateChallenges, evaluateChallengesAfterAction, type Challenge } from '../../src/MainStreetChallenges';
import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import type { AchievementSink } from '@core-engine/AchievementSystem';
import { NoOpAchievementSink } from '@core-engine/AchievementSystem';

// ── Test doubles ────────────────────────────────────────────

/** Recording sink for asserting delegation. */
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

/** Build a one-shot active challenge with a fixed id and always-true evaluator. */
function activeChallenge(id: string, title = id): { challenge: Challenge; completed: boolean } {
  return {
    challenge: {
      id,
      title,
      description: `${title} description`,
      category: 'synergy',
      evaluator: () => true,
      rewardPoints: 10,
    },
    completed: false,
  };
}

const MANIFEST_PATH = path.resolve(__dirname, '..', '..', 'core', 'electron', 'achievement-manifest.json');

interface LauncherManifest {
  version: number;
  games: Array<{
    gameId: string;
    achievements: Array<{ achievementId: string; steamApiName: string; hidden: boolean }>;
  }>;
}

function loadLauncherManifest(): LauncherManifest {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8')) as LauncherManifest;
}

// ── Mapping completeness ────────────────────────────────────

describe('Main Street achievement mapping', () => {
  it('maps every challenge template exactly once', () => {
    expect(Object.keys(CHALLENGE_TO_ACHIEVEMENT_ID)).toHaveLength(CHALLENGE_TEMPLATES.length);
    for (const template of CHALLENGE_TEMPLATES) {
      expect(
        achievementIdForChallenge(template.id),
        `challenge '${template.id}' is not mapped to an achievement`,
      ).toBeTruthy();
    }
  });

  it('declares exactly one achievement definition per template', () => {
    expect(MAIN_STREET_ACHIEVEMENT_DEFINITIONS).toHaveLength(CHALLENGE_TEMPLATES.length);
  });

  it('uses unique achievement ids', () => {
    const ids = MAIN_STREET_ACHIEVEMENT_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries a non-empty title and description for every achievement', () => {
    for (const def of MAIN_STREET_ACHIEVEMENT_DEFINITIONS) {
      expect(def.title.length, `${def.id} title`).toBeGreaterThan(0);
      expect(def.description.length, `${def.id} description`).toBeGreaterThan(0);
    }
  });

  it('resolves an unknown challenge id to null', () => {
    expect(achievementIdForChallenge('ch-not-real')).toBeNull();
  });

  it('maps the Serial Seller challenge to the serial-seller achievement', () => {
    expect(achievementIdForChallenge('ch-serial-seller')).toBe('serial-seller');
    const def = MAIN_STREET_ACHIEVEMENT_DEFINITIONS.find((d) => d.id === 'serial-seller');
    expect(def, 'serial-seller achievement definition must exist').toBeDefined();
    expect(def!.title).toBe('Serial Seller');
  });
});

// ── Launcher manifest drift guard ───────────────────────────

describe('launcher manifest drift guard', () => {
  const manifest = loadLauncherManifest();
  const game = manifest.games.find((g) => g.gameId === MAIN_STREET_GAME_ID);

  it('has a main-street entry in the launcher manifest', () => {
    expect(game, 'launcher manifest must contain a main-street entry').toBeDefined();
  });

  it('maps every game achievement id to a launcher manifest entry', () => {
    const manifestIds = new Set(game!.achievements.map((a) => a.achievementId));
    for (const def of MAIN_STREET_ACHIEVEMENT_DEFINITIONS) {
      expect(manifestIds.has(def.id), `'${def.id}' is missing from the launcher manifest`).toBe(true);
    }
  });

  it('does not declare extra achievements the launcher does not know about', () => {
    const gameIds = new Set(MAIN_STREET_ACHIEVEMENT_DEFINITIONS.map((d) => d.id));
    for (const entry of game!.achievements) {
      expect(gameIds.has(entry.achievementId), `launcher manifest '${entry.achievementId}' has no game mapping`).toBe(true);
    }
  });

  it('matches the launcher hidden flag for every achievement', () => {
    const hiddenById = new Map(game!.achievements.map((a) => [a.achievementId, a.hidden]));
    for (const def of MAIN_STREET_ACHIEVEMENT_DEFINITIONS) {
      expect(def.hidden, `hidden flag drift for '${def.id}'`).toBe(hiddenById.get(def.id));
    }
  });
});

// ── Engine system: idempotent unlock + delegation ───────────

describe('createMainStreetAchievementSystem', () => {
  it('unlocks the mapped achievement exactly once on repeat completions', () => {
    const sink = new RecordingSink();
    const system = createMainStreetAchievementSystem({ sink });

    expect(system.onChallengeCompleted('ch-foodie-row')).toBe('foodie-row');
    expect(system.onChallengeCompleted('ch-foodie-row')).toBe('foodie-row');

    expect(sink.unlocks).toEqual(['foodie-row']);
    expect(system.isUnlocked('foodie-row')).toBe(true);
  });

  it('delegates the mapped achievement id to the sink', () => {
    const sink = new RecordingSink();
    const system = createMainStreetAchievementSystem({ sink });

    system.onChallengeCompleted('ch-culture-district');
    expect(sink.unlocks).toEqual(['culture-district']);
  });

  it('ignores unmapped challenges', () => {
    const sink = new RecordingSink();
    const system = createMainStreetAchievementSystem({ sink });

    expect(system.onChallengeCompleted('ch-unknown')).toBeNull();
    expect(sink.unlocks).toEqual([]);
  });

  it('rehydrates initial unlocks without re-dispatching', () => {
    const sink = new RecordingSink();
    const system = createMainStreetAchievementSystem({ sink, initialUnlocked: ['foodie-row'] });

    system.onChallengeCompleted('ch-foodie-row');
    expect(sink.unlocks).toEqual(['foodie-row']);
  });

  it('defaults to a no-op sink and still tracks unlocks locally', () => {
    const system = createMainStreetAchievementSystem();
    system.onChallengeCompleted('ch-full-block');
    expect(system.isUnlocked('full-block')).toBe(true);
  });
});

// ── Challenge completion wiring ─────────────────────────────

describe('challenge completion wiring', () => {
  it('forwards a completed challenge through state.achievementSystem', () => {
    const state: MainStreetState = setupMainStreetGame({ seed: 'ach-test-seed' });
    const sink = new RecordingSink();
    state.achievementSystem = createMainStreetAchievementSystem({ sink });

    state.activeChallenges = [activeChallenge('ch-foodie-row', 'Foodie Row')];
    const newlyCompleted = evaluateChallenges(state.activeChallenges, state);

    expect(newlyCompleted).toEqual(['ch-foodie-row']);
    expect(sink.unlocks).toEqual(['foodie-row']);
  });

  it('fires exactly once across the per-action and end-of-turn paths', () => {
    const state: MainStreetState = setupMainStreetGame({ seed: 'ach-test-seed-2' });
    const sink = new RecordingSink();
    state.achievementSystem = createMainStreetAchievementSystem({ sink });

    state.activeChallenges = [activeChallenge('ch-first-upgrade', 'First Upgrade')];
    evaluateChallengesAfterAction(state);
    // The end-of-turn EndCheck re-evaluates; the challenge is already flagged
    // completed, so nothing is reported twice.
    evaluateChallenges(state.activeChallenges, state);

    expect(sink.unlocks).toEqual(['first-upgrade']);
  });

  it('does not throw when no achievement system is attached', () => {
    const state: MainStreetState = setupMainStreetGame({ seed: 'ach-test-seed-3' });
    state.achievementSystem = null;
    state.activeChallenges = [activeChallenge('ch-commerce-hub', 'Commerce Hub')];

    expect(() => evaluateChallenges(state.activeChallenges, state)).not.toThrow();
    expect(state.challengesCompleted).toContain('ch-commerce-hub');
  });
});

// ── Runtime sink resolution ─────────────────────────────────

describe('resolveMainStreetAchievementSink', () => {
  it('returns a no-op sink in a Node/headless environment (no bridge)', () => {
    const sink = resolveMainStreetAchievementSink();
    expect(sink).toBeInstanceOf(NoOpAchievementSink);
  });

  it('produces a working game state with the default sink attached', () => {
    const state = setupMainStreetGame({ seed: 'ach-test-seed-4' });
    expect(state.achievementSystem).toBeTruthy();
  });
});
