/**
 * Main Street: Achievements (F7, CG-0MUNC7FK5001T5CP).
 *
 * Maps the 13 run-local challenge templates to persistent Steam achievements
 * through the engine-generic `AchievementSystem` (`@core-engine`). No Steam
 * SDK code lives in this repo: the *only* Steam-aware call is
 * `resolveMainStreetAchievementSink()`, which uses the renderer client
 * (`@ui/steam-achievements-client`) — a thin IPC wrapper. In a plain browser
 * (or headless run) the client is absent and the system falls back to the
 * engine's `NoOpAchievementSink`, so the game stays fully playable.
 *
 * ## Source of truth
 *
 * The launcher manifest `core/electron/achievement-manifest.json` (F4) is the
 * single source of truth for `achievementId ↔ steamApiName ↔ hidden`. The
 * achievement ids declared here MUST match that manifest exactly;
 * `tests/main-street/main-street-achievements.test.ts` fails the build if they
 * drift.
 *
 * @module
 */

import {
  AchievementSystem,
  NoOpAchievementSink,
  type AchievementDefinition,
  type AchievementSink,
} from '@core-engine/AchievementSystem';
import {
  createSteamAchievementSink,
  steamAchievementsClientFromWindow,
} from '@ui/steam-achievements-client';
import { CHALLENGE_TEMPLATES } from './MainStreetChallenges';
import type { MainStreetState } from './MainStreetState';

/** Game id used in the launcher achievement manifest. */
export const MAIN_STREET_GAME_ID = 'main-street';

/**
 * Explicit challenge-template id → achievement id mapping.
 *
 * The achievement id is the challenge id without the `ch-` prefix, but the
 * mapping is declared explicitly so it is auditable and so a rename in
 * `CHALLENGE_TEMPLATES` that is not reflected here fails the completeness
 * test rather than silently producing an unmapped challenge.
 */
export const CHALLENGE_TO_ACHIEVEMENT_ID: Readonly<Record<string, string>> = {
  'ch-foodie-row': 'foodie-row',
  'ch-culture-district': 'culture-district',
  'ch-commerce-hub': 'commerce-hub',
  'ch-full-block': 'full-block',
  'ch-bustling-street': 'bustling-street',
  'ch-deep-pockets': 'deep-pockets',
  'ch-beloved-mayor': 'beloved-mayor',
  'ch-renovator': 'renovator',
  'ch-first-upgrade': 'first-upgrade',
  'ch-diversified': 'diversified',
  'ch-synergy-master': 'synergy-master',
  'ch-entertainment-strip': 'entertainment-strip',
  'ch-serial-seller': 'serial-seller',
};

/** Resolve the achievement id for a challenge id, or `null` when unmapped. */
export function achievementIdForChallenge(challengeId: string): string | null {
  return CHALLENGE_TO_ACHIEVEMENT_ID[challengeId] ?? null;
}

/**
 * Achievement definitions, one per challenge template.
 *
 * Titles and descriptions are derived from the challenge templates so the
 * player-facing text stays in sync automatically; only the explicit id
 * mapping above (and the `hidden` flag) is authored here.
 */
export const MAIN_STREET_ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] =
  CHALLENGE_TEMPLATES.map((template) => ({
    id: achievementIdForChallenge(template.id) ?? template.id,
    title: template.title,
    description: template.description,
    // None of Main Street's challenges are secret. Mirrors the launcher
    // manifest; the flag is backend-only for Steam.
    hidden: false,
  }));

/** Options for {@link createMainStreetAchievementSystem}. */
export interface MainStreetAchievementSystemOptions {
  /** The unlock sink. Defaults to a no-op sink (headless/browser). */
  sink?: AchievementSink;
  /** Already-unlocked achievement ids to rehydrate (launcher persistence). */
  initialUnlocked?: string[];
}

/**
 * Build a Main Street `AchievementSystem`: registers every achievement and
 * wires the challenge → achievement mapping. The caller supplies the sink
 * (IPC-backed in the launcher, no-op otherwise).
 */
export function createMainStreetAchievementSystem(
  options: MainStreetAchievementSystemOptions = {},
): AchievementSystem {
  const system = new AchievementSystem({
    sink: options.sink,
    initialUnlocked: options.initialUnlocked,
  });
  system.registerDefinitions(MAIN_STREET_ACHIEVEMENT_DEFINITIONS);
  system.setMapping((challengeId) => {
    const achievementId = achievementIdForChallenge(challengeId);
    if (!achievementId) return null;
    return system.getDefinition(achievementId);
  });
  return system;
}

/**
 * Resolve the best available sink for the current runtime:
 *  - Electron launcher: forwards over `window.tce.achievements` (F6).
 *  - Plain browser / headless: the engine no-op sink.
 *
 * Never throws — a missing bridge simply means "no Steam achievements here".
 */
export function resolveMainStreetAchievementSink(): AchievementSink {
  try {
    const client = steamAchievementsClientFromWindow();
    return client ? createSteamAchievementSink(client) : new NoOpAchievementSink();
  } catch {
    return new NoOpAchievementSink();
  }
}

/**
 * Attach an achievement system to a game state (idempotent-friendly).
 *
 * Once attached, `MainStreetChallenges` forwards each newly completed
 * challenge to `state.achievementSystem.onChallengeCompleted(...)`, which
 * unlocks the mapped achievement exactly once (the engine sink is idempotent).
 */
export function attachMainStreetAchievements(
  state: MainStreetState,
  system?: AchievementSystem,
): AchievementSystem {
  const resolved = system ?? createMainStreetAchievementSystem({ sink: resolveMainStreetAchievementSink() });
  state.achievementSystem = resolved;
  return resolved;
}
