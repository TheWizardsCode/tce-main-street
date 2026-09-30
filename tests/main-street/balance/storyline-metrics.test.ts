import { describe, it, expect, afterEach } from 'vitest';
import {
  computeStorylineFireFrequency,
  computeChainDepthStats,
  computeCycleStats,
  computeChoiceWinRateDelta,
  KNOWN_STORYLINE_IDS,
} from '../../../src/scripts/balance/engine/storyline-metrics';
import { runMonteCarlo } from '../../../src/MainStreetMonteCarlo';
import { getMainStreetRecorder, setMainStreetRecorder } from '../../../src/MainStreetTranscript';
import type { MonteCarloRunSummary, StorylineEventRecord } from '../../../src/MainStreetMonteCarlo';

/**
 * Builds a storyline event record with sensible defaults.
 */
function event(
  overrides: Partial<StorylineEventRecord> & { baseEventId: string },
): StorylineEventRecord {
  return {
    eventId: overrides.eventId ?? `${overrides.baseEventId}-0`,
    baseEventId: overrides.baseEventId,
    storylineId: overrides.storylineId ?? null,
    choice: overrides.choice ?? 'accept',
    chainDepth: overrides.chainDepth ?? 1,
    turn: overrides.turn ?? 1,
    successorId: overrides.successorId ?? null,
  };
}

/**
 * Builds a Monte Carlo run summary. `storylineEvents` is omitted unless the
 * caller supplies it, so the graceful-degradation paths can be exercised.
 */
function makeRun(overrides: Partial<MonteCarloRunSummary> = {}): MonteCarloRunSummary {
  return {
    seed: 'test-001',
    result: 'win',
    endReason: 'score_threshold',
    finalScore: 150,
    finalCoins: 30,
    turns: 15,
    turnWhenGridHalf: null,
    turnWhenGridFull: null,
    noActionTurns: 0,
    cardsOwned: [],
    marketOffers: [],
    economyHistory: [],
    ...overrides,
  };
}

// ========================================================================
// S1: Storyline Fire Frequency
// ========================================================================
describe('computeStorylineFireFrequency (S1)', () => {
  it('counts runs and computes the percentage per storyline', () => {
    const runs = [
      makeRun({ result: 'win', storylineEvents: [event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax' })] }),
      makeRun({ result: 'loss', storylineEvents: [event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax' })] }),
      makeRun({ result: 'win', storylineEvents: [event({ baseEventId: 'evt-flu-outbreak', storylineId: 'storyline-health' })] }),
      makeRun({ result: 'loss', storylineEvents: [] }),
    ];

    const result = computeStorylineFireFrequency(runs);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.totalRuns).toBe(4);
    expect(result.byStoryline['storyline-tax'].runCount).toBe(2);
    expect(result.byStoryline['storyline-tax'].runPercentage).toBeCloseTo(0.5, 5);
    expect(result.byStoryline['storyline-tax'].eventCount).toBe(2);
    expect(result.byStoryline['storyline-health'].runCount).toBe(1);
    expect(result.byStoryline['storyline-health'].runPercentage).toBeCloseTo(0.25, 5);
    expect(result.storylinesCovered).toBe(2);
  });

  it('reports every known storyline even when it never fired', () => {
    const result = computeStorylineFireFrequency([makeRun({ storylineEvents: [] })]);
    expect(result).not.toBeNull();
    if (!result) return;

    for (const id of KNOWN_STORYLINE_IDS) {
      expect(result.byStoryline[id]).toBeDefined();
      expect(result.byStoryline[id].runCount).toBe(0);
      expect(result.byStoryline[id].runPercentage).toBe(0);
      expect(result.byStoryline[id].eventCount).toBe(0);
    }
    expect(result.storylinesCovered).toBe(0);
  });

  it('counts a run once per storyline even with a multi-event chain', () => {
    const runs = [
      makeRun({
        storylineEvents: [
          event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', chainDepth: 1, successorId: 'evt-tax-inquiry' }),
          event({ baseEventId: 'evt-tax-inquiry', storylineId: 'storyline-tax', chainDepth: 2 }),
        ],
      }),
    ];

    const result = computeStorylineFireFrequency(runs);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.byStoryline['storyline-tax'].runCount).toBe(1);
    expect(result.byStoryline['storyline-tax'].eventCount).toBe(2);
  });

  it('returns null when no run carries storylineEvents', () => {
    expect(computeStorylineFireFrequency([makeRun(), makeRun()])).toBeNull();
  });
});

// ========================================================================
// S2: Chain Depth Statistics
// ========================================================================
describe('computeChainDepthStats (S2)', () => {
  it('computes mean, median, and max depth per storyline', () => {
    const runs = [
      makeRun({
        storylineEvents: [
          event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', chainDepth: 1, successorId: 'evt-tax-inquiry' }),
          event({ baseEventId: 'evt-tax-inquiry', storylineId: 'storyline-tax', chainDepth: 2, successorId: 'evt-tax-error' }),
          event({ baseEventId: 'evt-tax-error', storylineId: 'storyline-tax', chainDepth: 3 }),
        ],
      }),
      makeRun({
        storylineEvents: [event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', chainDepth: 1 })],
      }),
    ];

    const result = computeChainDepthStats(runs);
    expect(result).not.toBeNull();
    if (!result) return;

    const stat = result.byStoryline['storyline-tax'];
    expect(stat.eventCount).toBe(4);
    expect(stat.runCount).toBe(2);
    expect(stat.maxDepth).toBe(3);
    // depths 1, 2, 3, 1 => mean 7/4
    expect(stat.meanDepth).toBeCloseTo(1.75, 5);
    // sorted 1, 1, 2, 3 => median (1 + 2) / 2
    expect(stat.medianDepth).toBeCloseTo(1.5, 5);
  });

  it('keeps distinct storylines in separate distributions', () => {
    const runs = [
      makeRun({
        storylineEvents: [
          event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', chainDepth: 3 }),
          event({ baseEventId: 'evt-flu-outbreak', storylineId: 'storyline-health', chainDepth: 1 }),
        ],
      }),
    ];

    const result = computeChainDepthStats(runs);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.byStoryline['storyline-tax'].maxDepth).toBe(3);
    expect(result.byStoryline['storyline-health'].maxDepth).toBe(1);
    expect(result.byStoryline['storyline-tax'].eventCount).toBe(1);
  });

  it('returns null when no run carries storylineEvents', () => {
    expect(computeChainDepthStats([makeRun()])).toBeNull();
  });
});

// ========================================================================
// S3: Cycle Statistics
// ========================================================================
describe('computeCycleStats (S3)', () => {
  it('detects the tax cycle and counts occurrences per run', () => {
    const runs = [
      makeRun({
        storylineEvents: [
          event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', chainDepth: 1, successorId: 'evt-tax-inquiry' }),
          event({ baseEventId: 'evt-tax-inquiry', storylineId: 'storyline-tax', chainDepth: 2, successorId: 'evt-tax-error' }),
          event({ baseEventId: 'evt-tax-error', storylineId: 'storyline-tax', chainDepth: 3, successorId: 'evt-tax' }),
          event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', chainDepth: 4, successorId: 'evt-tax-inquiry' }),
          event({ baseEventId: 'evt-tax-inquiry', storylineId: 'storyline-tax', chainDepth: 5 }),
        ],
      }),
      makeRun({
        storylineEvents: [event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', chainDepth: 1 })],
      }),
    ];

    const result = computeCycleStats(runs);
    expect(result).not.toBeNull();
    if (!result) return;

    expect(result.totalCycles).toBe(2);
    expect(result.byStoryline['storyline-tax'].cycleCount).toBe(2);
    expect(result.byStoryline['storyline-tax'].runsWithCycle).toBe(1);
    expect(result.byStoryline['storyline-tax'].cycleFrequency).toBeCloseTo(0.5, 5);
    expect(result.byStoryline['storyline-tax'].cyclesPerRun).toBeCloseTo(1, 5);
    expect(result.cycleFrequencyPerRun).toBeCloseTo(0.5, 5);
  });

  it('reports no cycle for an acyclic chain', () => {
    const runs = [
      makeRun({
        storylineEvents: [
          event({ baseEventId: 'evt-flu-outbreak', storylineId: 'storyline-health', chainDepth: 1, successorId: 'evt-pandemic' }),
          event({ baseEventId: 'evt-pandemic', storylineId: 'storyline-health', chainDepth: 2 }),
        ],
      }),
    ];

    const result = computeCycleStats(runs);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.totalCycles).toBe(0);
    expect(result.cycleFrequencyPerRun).toBe(0);
    expect(Object.keys(result.byStoryline)).toHaveLength(0);
  });

  it('treats an interrupted chain as a new chain (no false cycle)', () => {
    const runs = [
      makeRun({
        storylineEvents: [
          event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', chainDepth: 1, successorId: 'evt-tax-inquiry' }),
          // The successor was never drawn; a fresh tax incident starts later.
          event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', chainDepth: 1 }),
        ],
      }),
    ];

    const result = computeCycleStats(runs);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.totalCycles).toBe(0);
  });

  it('returns null when no run carries storylineEvents', () => {
    expect(computeCycleStats([makeRun()])).toBeNull();
  });
});

// ========================================================================
// S4: Choice Win-Rate Delta
// ========================================================================
describe('computeChoiceWinRateDelta (S4)', () => {
  it('returns a positive delta when Accept correlates with winning', () => {
    const runs = [
      makeRun({ result: 'win', storylineEvents: [event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', choice: 'accept' })] }),
      makeRun({ result: 'win', storylineEvents: [event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', choice: 'accept' })] }),
      makeRun({ result: 'loss', storylineEvents: [event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', choice: 'reject' })] }),
    ];

    const result = computeChoiceWinRateDelta(runs, 'evt-tax');
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.value).toBe(1);
    expect(result.winRateWhenAccept).toBe(1);
    expect(result.winRateWhenReject).toBe(0);
    expect(result.acceptRuns).toBe(2);
    expect(result.rejectRuns).toBe(1);
  });

  it('returns a negative delta when Accept correlates with losing', () => {
    const runs = [
      makeRun({ result: 'loss', storylineEvents: [event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', choice: 'accept' })] }),
      makeRun({ result: 'win', storylineEvents: [event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', choice: 'reject' })] }),
    ];

    const result = computeChoiceWinRateDelta(runs, 'evt-tax');
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.value).toBe(-1);
  });

  it('accepts a serial-suffixed event id and normalises it to the base id', () => {
    const runs = [
      makeRun({
        result: 'win',
        storylineEvents: [
          event({ eventId: 'evt-tax-2', baseEventId: 'evt-tax', storylineId: 'storyline-tax', choice: 'accept' }),
        ],
      }),
    ];

    const result = computeChoiceWinRateDelta(runs, 'evt-tax-2');
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.eventId).toBe('evt-tax');
    expect(result.acceptRuns).toBe(1);
  });

  it('returns a zeroed result when the event never appeared', () => {
    const runs = [makeRun({ storylineEvents: [event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax' })] })];
    const result = computeChoiceWinRateDelta(runs, 'evt-flu-outbreak');
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.value).toBe(0);
    expect(result.acceptRuns).toBe(0);
    expect(result.rejectRuns).toBe(0);
  });

  it('classifies a run by its first choice for the event', () => {
    const runs = [
      makeRun({
        result: 'loss',
        storylineEvents: [
          event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', choice: 'accept', chainDepth: 1 }),
          event({ baseEventId: 'evt-tax', storylineId: 'storyline-tax', choice: 'reject', chainDepth: 4 }),
        ],
      }),
    ];

    const result = computeChoiceWinRateDelta(runs, 'evt-tax');
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.acceptRuns).toBe(1);
    expect(result.rejectRuns).toBe(0);
  });

  it('returns null when no run carries storylineEvents', () => {
    expect(computeChoiceWinRateDelta([makeRun()], 'evt-tax')).toBeNull();
  });
});

// ========================================================================
// Harness integration: event-choice capture
// ========================================================================
describe('Monte Carlo storyline capture', () => {
  afterEach(() => {
    // Never leave a recorder installed between tests.
    setMainStreetRecorder(null);
  });

  it('populates a storylineEvents array on every run summary', () => {
    const result = runMonteCarlo({
      seeds: ['mc-story-0', 'mc-story-1'],
      maxTurns: 30,
      strategy: 'greedy',
    });
    expect(result.runs.length).toBe(2);
    for (const run of result.runs) {
      expect(Array.isArray(run.storylineEvents)).toBe(true);
    }
  });

  it('captures well-formed event-choice records over a batch of runs', () => {
    const seeds = Array.from({ length: 60 }, (_, i) => `mc-storyline-${i}`);
    const result = runMonteCarlo({ seeds, maxTurns: 60, strategy: 'greedy' });

    const captured = result.runs.flatMap(run => run.storylineEvents ?? []);
    expect(captured.length).toBeGreaterThan(0);

    for (const record of captured) {
      expect(record.chainDepth).toBeGreaterThanOrEqual(1);
      expect(record.turn).toBeGreaterThanOrEqual(0);
      expect(['accept', 'reject']).toContain(record.choice);
      expect(record.storylineId).not.toBeNull();
      expect(record.baseEventId).not.toMatch(/-\d+$/);
    }

    // The engine only emits event-choice entries for choice cards, so the
    // captured set must be a subset of the manifest's choice cards.
    const choiceEvents = new Set([
      'evt-flu-outbreak',
      'evt-popular-menu',
      'evt-recession',
      'evt-strike-service',
      'evt-tax',
      'evt-tax-error',
      'evt-tax-inquiry',
    ]);
    for (const record of captured) {
      expect(choiceEvents.has(record.baseEventId)).toBe(true);
    }
  });

  it('restores the previously installed transcript recorder', () => {
    const previous = getMainStreetRecorder();
    runMonteCarlo({ seeds: ['mc-story-restore'], maxTurns: 10, strategy: 'greedy' });
    expect(getMainStreetRecorder()).toBe(previous);
  });
});
