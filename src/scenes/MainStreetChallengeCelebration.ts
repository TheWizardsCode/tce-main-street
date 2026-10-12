/**
 * Main Street: Per-Action Challenge Celebration
 *
 * Centralises the immediate celebration of challenges completed mid-action
 * (CG-0MU8MZBV4007HF1Q). Challenges are now evaluated after every action
 * (producer decision Q2=A), so the scene celebrates as soon as the completing
 * action lands rather than waiting for end of turn. The end-of-turn
 * celebration consults the same `celebratedChallengeIds` set so a challenge is
 * never celebrated twice in a turn.
 *
 * In competitive human-vs-AI play only the human seat's completions celebrate
 * (MS-0MUWNTJIK009O6BZ, Q3 = A); an AI seat's completion is attributed to that
 * seat and is filtered out here. Single-player / legacy runs keep the
 * run-global behaviour unchanged.
 *
 * @module
 */

import { isHumanSeatCredit, type ChallengeSeatContext } from '../MainStreetChallenges';

/** Minimal scene surface required by {@link celebrateChallengeIds}. */
export interface ChallengeCelebrationScene {
  celebratedChallengeIds: Set<string>;
  state: ChallengeSeatContext & {
    activeChallenges: ReadonlyArray<{
      challenge: { id: string; title: string };
      completedBySeatId?: number | null;
    }>;
  };
  time: { delayedCall(delay: number, cb: () => void): unknown };
  msAnimator: { animateCelebration(title: string): Promise<void> };
  refreshAll(): void;
  incomeCollectionActive?: boolean;
  msRenderer: { refreshAllExceptStreet(): void };
}

/**
 * Fires the celebration VFX/SFX for the given challenge IDs, skipping any that
 * were already celebrated this turn or that were completed by a non-human seat
 * in competitive mode. Marks each celebrated ID and refreshes the challenge
 * tracker immediately after the staggered celebrations complete.
 *
 * Reduced motion is handled inside {@link MainStreetAnimator.animateCelebration}
 * (pop-text only, no particles).
 *
 * @param s   The Main Street scene.
 * @param ids Challenge IDs to celebrate (e.g. `state._newlyCompletedThisAction`).
 * @returns The subset of IDs actually celebrated (not already celebrated and
 *          credited to the human seat in competitive mode).
 */
export function celebrateChallengeIds(
  s: ChallengeCelebrationScene,
  ids: readonly string[],
): string[] {
  const toCelebrate = ids.filter(id => {
    if (s.celebratedChallengeIds.has(id)) return false;
    // Per-seat gate (MS-0MUWNTJIK009O6BZ, Q3 = A): in competitive mode only
    // the human seat's completions celebrate. Single-player stays global.
    const record = s.state.activeChallenges.find(ac => ac.challenge.id === id);
    return isHumanSeatCredit(s.state, record?.completedBySeatId);
  });
  if (toCelebrate.length === 0) return [];

  const titleById = new Map<string, string>();
  for (const ac of s.state.activeChallenges ?? []) {
    titleById.set(ac.challenge.id, ac.challenge.title);
  }

  toCelebrate.forEach((challengeId, index) => {
    const title = titleById.get(challengeId) ?? 'Challenge Complete!';
    s.celebratedChallengeIds.add(challengeId);
    s.time.delayedCall(index * 600, () => {
      void s.msAnimator.animateCelebration(title);
    });
  });

  // Refresh the tracker immediately after the staggered celebrations so the
  // completed state shows without waiting for end of turn (AC4).
  s.time.delayedCall(toCelebrate.length * 600 + 200, () => {
    if (s.incomeCollectionActive) {
      s.msRenderer.refreshAllExceptStreet();
    } else {
      s.refreshAll();
    }
  });

  return toCelebrate;
}
