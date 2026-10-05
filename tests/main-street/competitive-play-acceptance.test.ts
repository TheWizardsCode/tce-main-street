/**
 * Main Street: Competitive play acceptance harness.
 *
 * Test-first child of epic MS-0MUTTVR5K002ZDUP. Verifies — against the
 * existing engine seams — that a full competitive game can be driven
 * end-to-end, that the per-owner economy diverges, that the run is
 * deterministic, and that seat actions reach the transcript. This is the
 * regression net the sibling seat-config and scene-orchestration children
 * must keep green.
 *
 * The driver under test lives in
 * `tests/main-street/helpers/competitiveTurnDriver.ts`; it is test support,
 * not production code.
 */
import { describe, expect, it } from 'vitest';

import {
  runCompetitiveGame,
  seatsDiverge,
  type CompetitiveGameRun,
} from './helpers/competitiveTurnDriver';
import { CompetitiveGreedyStrategy } from '../../src/MainStreetAiStrategy';

/** Acceptance seeds — the harness must resolve every one. */
const ACCEPTANCE_SEEDS = [
  'comp-acceptance-1',
  'comp-acceptance-2',
  'comp-acceptance-3',
  'comp-acceptance-4',
  'comp-acceptance-5',
] as const;

const MAX_DAYS = 60;

/** Runs the acceptance seeds once and reuses the results across assertions. */
let cachedAcceptanceRuns: CompetitiveGameRun[] | undefined;
function acceptanceRuns(): CompetitiveGameRun[] {
  cachedAcceptanceRuns ??= ACCEPTANCE_SEEDS.map(seed =>
    runCompetitiveGame({ seed, maxDays: MAX_DAYS }),
  );
  return cachedAcceptanceRuns;
}

// ── End-to-end drive + terminal resolution ───────────────────

describe('Competitive acceptance — end-to-end drive', () => {
  it('drives each seed through the shared-day loop to a resolved terminal state', () => {
    const runs = acceptanceRuns();
    expect(runs).toHaveLength(ACCEPTANCE_SEEDS.length);

    for (const run of runs) {
      // At least one full shared day executed (WeekStart → markets → closing).
      expect(run.days).toBeGreaterThanOrEqual(1);
      expect(run.days).toBeLessThanOrEqual(MAX_DAYS);

      // Resolved terminal state: winner declared, or a loss end condition.
      expect(run.terminal).toBe(true);
      expect(run.gameResult).not.toBe('playing');
      expect(run.endReason).not.toBe('max_days_cap');
      if (run.winnerId !== null) {
        expect(run.gameResult).toBe('win');
        expect(run.state.competitiveWinnerId).toBe(run.winnerId);
        expect(run.seats[run.winnerId]).toBeDefined();
      } else {
        expect(run.gameResult).toBe('loss');
        expect(['bankruptcy', 'reputation_collapse', 'turn_exhaustion', 'all_challenges']).toContain(
          run.endReason,
        );
      }
    }
  });

  it('never stalls: every seed reports one seat per player with a finite day count', () => {
    for (const run of acceptanceRuns()) {
      expect(run.seats).toHaveLength(2);
      expect(run.seats.map(seat => seat.playerId)).toEqual([0, 1]);
      for (const seat of run.seats) {
        expect(Number.isFinite(seat.coins)).toBe(true);
        expect(Number.isFinite(seat.reputation)).toBe(true);
        expect(Number.isFinite(seat.score)).toBe(true);
        expect(seat.actionsTaken).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('resolves a competitive winner when a seat reaches a win end condition', () => {
    // Seed re-baselined for the per-seat failure evaluation
    // (MS-0MUVBH589001L7NL): 'comp-acceptance-winner' now ends in a genuine
    // human reputation collapse (the old shared-bank check masked it), so a
    // seed that reaches the threshold while the human stays solvent is used.
    const run = runCompetitiveGame({ seed: 'comp-acceptance-winner-2', maxDays: MAX_DAYS });
    expect(run.terminal).toBe(true);
    expect(run.gameResult).toBe('win');
    expect(run.winnerId).not.toBeNull();
    expect(run.state.competitiveWinnerId).toBe(run.winnerId);
    expect(run.seats[run.winnerId!]).toBeDefined();
  });

  it('resumes the shared closing when it pauses on a dual-choice incident', () => {
    const runs = acceptanceRuns();
    // The seeded incident deck reliably pauses at least one acceptance run.
    expect(runs.some(run => run.pendingChoicesResolved > 0)).toBe(true);
    for (const run of runs) {
      if (run.pendingChoicesResolved > 0) expect(run.terminal).toBe(true);
    }
  });
});

// ── Per-player divergence ────────────────────────────────────

describe('Competitive acceptance — per-player divergence', () => {
  it('routes the per-owner economy so at least one seed shows divergent player states', () => {
    expect(acceptanceRuns().some(run => seatsDiverge(run.seats))).toBe(true);
  });

  it('reports a distinct terminal economy for the divergent seats', () => {
    const run = acceptanceRuns().find(candidate => seatsDiverge(candidate.seats));
    expect(run).toBeDefined();
    const [p0, p1] = run!.seats;
    const diverged =
      p0.coins !== p1.coins || p0.reputation !== p1.reputation || p0.score !== p1.score;
    expect(diverged).toBe(true);
  });
});

// ── Determinism ──────────────────────────────────────────────

describe('Competitive acceptance — determinism', () => {
  it('replays the same seed and strategy sequence to an identical terminal state', () => {
    const seed = 'comp-acceptance-determinism';
    const strategySequence = [CompetitiveGreedyStrategy, CompetitiveGreedyStrategy];
    const a = runCompetitiveGame({ seed, maxDays: MAX_DAYS, strategies: strategySequence });
    const b = runCompetitiveGame({ seed, maxDays: MAX_DAYS, strategies: strategySequence });

    expect(b.gameResult).toBe(a.gameResult);
    expect(b.winnerId).toBe(a.winnerId);
    expect(b.endReason).toBe(a.endReason);
    expect(b.days).toBe(a.days);
    expect(b.seats).toEqual(a.seats);
    // Engine RNG state at the terminal point matches too.
    expect(b.state.rngCalls).toBe(a.state.rngCalls);
  });
});

// ── Transcript contract ──────────────────────────────────────

describe('Competitive acceptance — AI transcript', () => {
  it('records every executed seat action to the transcript as an ai-action event', () => {
    const run = runCompetitiveGame({ seed: 'comp-acceptance-transcript', maxDays: MAX_DAYS });
    const aiEvents = run.transcript.events.filter(event => event.type === 'ai-action');

    const executedActions = run.seats.reduce((total, seat) => total + seat.actionsTaken, 0);
    expect(executedActions).toBeGreaterThan(0);
    expect(aiEvents).toHaveLength(executedActions);

    for (const event of aiEvents) {
      expect(event.type).toBe('ai-action');
      expect(event.strategy).toBe(CompetitiveGreedyStrategy.name);
      // `end-turn` is a decision boundary, not a recorded seat action.
      expect(event.action.type).not.toBe('end-turn');
    }
  });

  it('captures the day loop (turn-end events) alongside the seat actions', () => {
    const run = runCompetitiveGame({ seed: 'comp-acceptance-transcript-2', maxDays: MAX_DAYS });
    const turnEnds = run.transcript.events.filter(event => event.type === 'turn-end');
    expect(turnEnds.length).toBeGreaterThan(0);
    expect(turnEnds.length).toBeLessThanOrEqual(run.days);
  });
});
