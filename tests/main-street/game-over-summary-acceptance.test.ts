/**
 * Main Street: Game-over summary end-to-end acceptance.
 *
 * Parent: MS-0MUWDL0V40041USM (Provide reason for game ending),
 * verification child MS-0MUWE6OER004GNV1.
 *
 * Unlike the fixture-driven model/overlay unit tests, this acceptance suite
 * drives the **engine** to real terminal states and asserts the presentation
 * model renders the correct end-reason headline, per-player rows and
 * failure/elimination badges. It is the engine→presentation integration
 * counterpart to `game-over-summary.test.ts` and `game-over-overlay.test.ts`.
 *
 * Coverage:
 * - AC2: explicit plain-language end reason, naming the failing seat.
 * - AC3/AC5: per-player rows and failure/elimination badges from real state.
 * - AC4: the run-global challenge summary.
 * - AC7: single-player (no `players[]`) and competitive modes.
 *
 * @module tests/main-street/game-over-summary-acceptance
 */

import { describe, expect, it } from 'vitest';

import {
  buildHumanVsAis,
} from './helpers/competitive-fixtures';
import {
  checkCompetitiveEndConditions,
  checkImmediateLoss,
  executeCompetitiveWeekStart,
  endCompetitiveMarketTurn,
  resolveCompetitiveClosingPhases,
} from '../../src/MainStreetEngine';
import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import type { ActiveChallenge } from '../../src/MainStreetChallenges';
import {
  buildGameOverChallengeSummary,
  buildGameOverPlayerRows,
  formatEndReason,
} from '../../src/scenes/MainStreetGameOverSummary';

// ── Helpers ─────────────────────────────────────────────────

/** Drives a competitive state to InvestmentResolution (no seat actions). */
function driveToClosing(state: MainStreetState): void {
  executeCompetitiveWeekStart(state);
  const players = state.players!.length;
  for (let i = 0; i < players; i += 1) {
    endCompetitiveMarketTurn(state);
  }
}

/** Minimal completed challenge for the all-challenges end condition. */
function completedChallenge(id: string, title: string): ActiveChallenge {
  return {
    challenge: {
      id,
      title,
      description: '',
      category: 'resource',
      evaluator: () => true,
      rewardPoints: 0,
    },
    completed: true,
  };
}

// ── Engine-driven endings ───────────────────────────────────

describe('game-over summary acceptance — engine-driven endings', () => {
  it('competitive human reputation collapse names You and flags the row (AC2/AC5)', () => {
    const state = buildHumanVsAis('go-accept-collapse', 1, [[500, 0], [500, 5]]);
    state.turn = 2;
    driveToClosing(state);
    resolveCompetitiveClosingPhases(state);

    expect(state.endReason).toBe('reputation_collapse');
    expect(formatEndReason(state)).toBe('Reputation collapse — You');

    const rows = buildGameOverPlayerRows(state);
    expect(rows.map((row) => row.label)).toEqual(['You', 'AI 1']);
    expect(rows[0].isHuman).toBe(true);
    expect(rows[0].badge?.kind).toBe('reputation_collapse');
    expect(rows[1].badge).toBeUndefined();
  });

  it('competitive human bankruptcy names You and flags the row (AC2/AC5)', () => {
    const state = buildHumanVsAis('go-accept-bankrupt', 1, [[-5, 5], [500, 5]]);
    state.turn = 2;
    driveToClosing(state);
    resolveCompetitiveClosingPhases(state);

    expect(state.endReason).toBe('bankruptcy');
    expect(formatEndReason(state)).toBe('Bankruptcy — You');
    expect(buildGameOverPlayerRows(state)[0].badge?.kind).toBe('bankruptcy');
  });

  it('competitive AI collapse → last standing flags the eliminated AI (AC2/AC3)', () => {
    const state = buildHumanVsAis('go-accept-last-standing', 1, [[500, 5], [500, 0]]);
    state.turn = 2;
    driveToClosing(state);
    resolveCompetitiveClosingPhases(state);

    expect(state.endReason).toBe('last_standing');
    expect(state.competitiveWinnerId).toBe(0);
    expect(formatEndReason(state)).toBe('Last standing');

    const rows = buildGameOverPlayerRows(state);
    expect(rows[0].badge).toBeUndefined();
    expect(rows[1].label).toBe('AI 1');
    expect(rows[1].badge).toBeDefined();
  });

  it('competitive all-challenges completion renders the plain-language headline (AC2/AC4)', () => {
    const state = buildHumanVsAis('go-accept-challenges', 1, [[500, 5], [500, 5]]);
    state.activeChallenges = [completedChallenge('ch-accept', 'Acceptance challenge')];

    expect(checkCompetitiveEndConditions(state)).toBe(true);
    expect(state.endReason).toBe('all_challenges');
    expect(formatEndReason(state)).toBe('All challenges completed');

    const summary = buildGameOverChallengeSummary(state);
    expect(summary.totalCount).toBe(1);
    expect(summary.completedCount).toBe(1);
    expect(summary.items).toEqual([
      { title: 'Acceptance challenge', completed: true },
    ]);
  });

  it('single-player bankruptcy renders the plain headline and synthesised You row (AC3/AC7)', () => {
    const state = setupMainStreetGame({ seed: 'go-accept-single' });
    state.resourceBank.coins = -5;
    state.turn = 2;

    expect(checkImmediateLoss(state)).toBe(true);
    expect(state.endReason).toBe('bankruptcy');
    expect(formatEndReason(state)).toBe('Bankruptcy');

    const rows = buildGameOverPlayerRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('You');
    expect(rows[0].isHuman).toBe(true);
    expect(rows[0].coins).toBe(-5);
    expect(rows[0].badge?.kind).toBe('bankruptcy');
  });
});
