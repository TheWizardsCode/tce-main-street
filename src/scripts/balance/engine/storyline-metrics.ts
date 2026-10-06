/**
 * Storyline Metrics Engine (S1–S4).
 *
 * Implements storyline-level balance analytics as pure computation functions
 * accepting typed Monte Carlo run summaries and returning typed structured
 * output. The metrics mirror the existing global (G1–G8) and card (M1–M7)
 * families and extend them with storyline coverage:
 *
 * - **S1** Fire frequency — how many runs feature each storyline.
 * - **S2** Chain depth — how far each storyline chain progresses.
 * - **S3** Cycle frequency — how often a chain returns to an earlier card.
 * - **S4** Choice win-rate delta — Accept vs Reject win-rate differential.
 *
 * All functions degrade gracefully by returning `null` when no run summary
 * carries a `storylineEvents` field (consistent with M2/M4/M6 and G3/G4/G6/G7).
 *
 * @module
 */

import type { MonteCarloRunSummary, StorylineEventRecord } from '../../../MainStreetMonteCarlo';
import { median } from './statistics';

// =========================================================================
// Shared helpers
// =========================================================================

/**
 * The five storylines shipped in `docs/main-street/storyline-manifest.json`.
 * Reported explicitly so a storyline that never fires appears with a zero
 * fire frequency rather than being omitted.
 */
export const KNOWN_STORYLINE_IDS: readonly string[] = [
  'storyline-economy',
  'storyline-health',
  'storyline-labor',
  'storyline-restaurant',
  'storyline-tax',
];

/** Storyline bucket used for events whose card has no `storylineId`. */
const UNGROUPED = 'ungrouped';

/** Strips a card instance serial suffix (`-\d+$`) to recover the template ID. */
function stripSerial(id: string): string {
  return id.replace(/-\d+$/, '');
}

/**
 * Returns true when any run summary carries a `storylineEvents` field.
 *
 * A present (even empty) array means storyline capture was wired for the run
 * batch; absence means the summaries predate Phase 2 analytics and the
 * storyline metrics return `null`.
 */
function hasStorylineData(runs: readonly MonteCarloRunSummary[]): boolean {
  return runs.some(run => Array.isArray(run.storylineEvents));
}

/** Returns the storyline events recorded for a run (empty when absent). */
function eventsOf(run: MonteCarloRunSummary): readonly StorylineEventRecord[] {
  return run.storylineEvents ?? [];
}

/** Bucket key for an event: its storyline id, or `ungrouped`. */
function bucketOf(event: StorylineEventRecord): string {
  return event.storylineId ?? UNGROUPED;
}

// =========================================================================
// S1: Storyline Fire Frequency
// =========================================================================

/** Fire-frequency statistics for a single storyline. */
export interface StorylineFireStat {
  /** Storyline grouping key. */
  storylineId: string;
  /** Number of runs in which the storyline fired at least once. */
  runCount: number;
  /** Share of all runs featuring the storyline (0 to 1). */
  runPercentage: number;
  /** Total number of storyline events across all runs. */
  eventCount: number;
}

/** Result for S1 (Storyline Fire Frequency). */
export interface StorylineFireFrequencyResult {
  /** Total number of runs analysed. */
  totalRuns: number;
  /** Per-storyline fire statistics, keyed by storyline id. */
  byStoryline: Record<string, StorylineFireStat>;
  /** Number of known storylines that fired in at least one run. */
  storylinesCovered: number;
}

/**
 * Computes S1: Storyline Fire Frequency.
 *
 * For each storyline reports how many runs featured it and what percentage of
 * runs that represents, derived from the run summaries' `storylineEvents`.
 * All five known storylines are always present (zeroed when they never fired).
 *
 * @param runs - Monte Carlo run summaries with (optional) `storylineEvents`.
 * @returns Fire-frequency result, or `null` when no run carried storyline data.
 */
export function computeStorylineFireFrequency(
  runs: readonly MonteCarloRunSummary[],
): StorylineFireFrequencyResult | null {
  if (!hasStorylineData(runs)) return null;

  const totalRuns = runs.length;
  const byStoryline: Record<string, StorylineFireStat> = {};
  const runsPerStoryline = new Map<string, Set<number>>();

  const ensureStat = (id: string): StorylineFireStat => {
    if (!byStoryline[id]) {
      byStoryline[id] = { storylineId: id, runCount: 0, runPercentage: 0, eventCount: 0 };
    }
    return byStoryline[id];
  };
  const ensureRuns = (id: string): Set<number> => {
    let set = runsPerStoryline.get(id);
    if (!set) {
      set = new Set<number>();
      runsPerStoryline.set(id, set);
    }
    return set;
  };

  // Seed the known storylines so they always appear (even at zero).
  for (const id of KNOWN_STORYLINE_IDS) ensureStat(id);

  runs.forEach((run, runIndex) => {
    for (const event of eventsOf(run)) {
      const id = bucketOf(event);
      ensureStat(id).eventCount++;
      ensureRuns(id).add(runIndex);
    }
  });

  for (const [id, set] of runsPerStoryline) {
    ensureStat(id).runCount = set.size;
  }
  for (const stat of Object.values(byStoryline)) {
    stat.runPercentage = totalRuns > 0 ? stat.runCount / totalRuns : 0;
  }

  const storylinesCovered = Object.values(byStoryline).filter(s => s.runCount > 0).length;

  return { totalRuns, byStoryline, storylinesCovered };
}

// =========================================================================
// S2: Chain Depth
// =========================================================================

/** Chain-depth statistics for a single storyline. */
export interface StorylineChainDepthStat {
  /** Storyline grouping key. */
  storylineId: string;
  /** Mean recorded chain depth across all of the storyline's events. */
  meanDepth: number;
  /** Median recorded chain depth across all of the storyline's events. */
  medianDepth: number;
  /** Maximum recorded chain depth (longest chain reached). */
  maxDepth: number;
  /** Number of events contributing to the distribution. */
  eventCount: number;
  /** Number of runs contributing to the distribution. */
  runCount: number;
}

/** Result for S2 (Chain Depth Statistics). */
export interface ChainDepthStatsResult {
  /** Per-storyline depth distributions, keyed by storyline id. */
  byStoryline: Record<string, StorylineChainDepthStat>;
}

/**
 * Computes S2: Chain Depth Statistics.
 *
 * Collects every recorded `chainDepth` per storyline (root = 1, each successor
 * +1) across runs and reports the mean, median, and maximum depth. Storylines
 * that never fired are omitted.
 *
 * @param runs - Monte Carlo run summaries with (optional) `storylineEvents`.
 * @returns Depth distribution result, or `null` when no run carried storyline data.
 */
export function computeChainDepthStats(
  runs: readonly MonteCarloRunSummary[],
): ChainDepthStatsResult | null {
  if (!hasStorylineData(runs)) return null;

  const depths = new Map<string, number[]>();
  const runCounts = new Map<string, Set<number>>();

  runs.forEach((run, runIndex) => {
    for (const event of eventsOf(run)) {
      const id = bucketOf(event);
      let list = depths.get(id);
      if (!list) {
        list = [];
        depths.set(id, list);
      }
      list.push(event.chainDepth);

      let set = runCounts.get(id);
      if (!set) {
        set = new Set<number>();
        runCounts.set(id, set);
      }
      set.add(runIndex);
    }
  });

  const byStoryline: Record<string, StorylineChainDepthStat> = {};
  for (const [id, list] of depths) {
    byStoryline[id] = {
      storylineId: id,
      meanDepth: list.reduce((sum, v) => sum + v, 0) / list.length,
      medianDepth: median(list),
      maxDepth: Math.max(...list),
      eventCount: list.length,
      runCount: runCounts.get(id)?.size ?? 0,
    };
  }

  return { byStoryline };
}

// =========================================================================
// S3: Cycle Detection
// =========================================================================

/** Cycle statistics for a single storyline. */
export interface StorylineCycleStat {
  /** Storyline grouping key. */
  storylineId: string;
  /** Total cycle occurrences (chain revisits) across all runs. */
  cycleCount: number;
  /** Number of runs in which the storyline cycled at least once. */
  runsWithCycle: number;
  /** Share of all runs in which the storyline cycled (0 to 1). */
  cycleFrequency: number;
  /** Mean number of cycles per run for this storyline. */
  cyclesPerRun: number;
}

/** Result for S3 (Cycle Statistics). */
export interface CycleStatsResult {
  /** Per-storyline cycle statistics, keyed by storyline id. */
  byStoryline: Record<string, StorylineCycleStat>;
  /** Total cycle occurrences across every storyline. */
  totalCycles: number;
  /** Share of runs featuring at least one cycle in any storyline (0 to 1). */
  cycleFrequencyPerRun: number;
}

/**
 * Detects cycles within one run's ordered events, grouped per storyline.
 *
 * A chain continues while each event's base ID equals the successor queued by
 * the previous event; any other event starts a fresh chain. A cycle occurrence
 * is a chain transition that revisits a base event ID already seen in the
 * current chain — e.g. the shipped `evt-tax → evt-tax-inquiry → evt-tax-error
 * → evt-tax` loop. Returns the number of such revisits per storyline.
 */
function detectCyclesByStoryline(
  events: readonly StorylineEventRecord[],
): Map<string, number> {
  const grouped = new Map<string, StorylineEventRecord[]>();
  for (const event of events) {
    const id = bucketOf(event);
    let list = grouped.get(id);
    if (!list) {
      list = [];
      grouped.set(id, list);
    }
    list.push(event);
  }

  const cycles = new Map<string, number>();
  for (const [id, list] of grouped) {
    let occurrences = 0;
    let visited = new Set<string>();
    let expectedSuccessor: string | null = null;

    for (const event of list) {
      if (event.baseEventId !== expectedSuccessor) {
        // Not a continuation — begin a fresh chain.
        visited = new Set<string>();
      }
      if (visited.has(event.baseEventId)) occurrences++;
      visited.add(event.baseEventId);
      expectedSuccessor = event.successorId;
    }

    if (occurrences > 0) cycles.set(id, occurrences);
  }

  return cycles;
}

/**
 * Computes S3: Cycle Statistics.
 *
 * Detects and counts chain revisits per storyline and per run, and reports the
 * fraction of runs in which any cycle occurred.
 *
 * @param runs - Monte Carlo run summaries with (optional) `storylineEvents`.
 * @returns Cycle statistics, or `null` when no run carried storyline data.
 */
export function computeCycleStats(
  runs: readonly MonteCarloRunSummary[],
): CycleStatsResult | null {
  if (!hasStorylineData(runs)) return null;

  const byStoryline: Record<string, StorylineCycleStat> = {};
  const runsWithAnyCycle = new Set<number>();
  let totalCycles = 0;

  runs.forEach((run, runIndex) => {
    const cycles = detectCyclesByStoryline(eventsOf(run));
    if (cycles.size === 0) return;
    runsWithAnyCycle.add(runIndex);

    for (const [id, occurrences] of cycles) {
      if (!byStoryline[id]) {
        byStoryline[id] = {
          storylineId: id,
          cycleCount: 0,
          runsWithCycle: 0,
          cycleFrequency: 0,
          cyclesPerRun: 0,
        };
      }
      byStoryline[id].cycleCount += occurrences;
      byStoryline[id].runsWithCycle += 1;
      totalCycles += occurrences;
    }
  });

  const totalRuns = runs.length;
  for (const stat of Object.values(byStoryline)) {
    stat.cycleFrequency = totalRuns > 0 ? stat.runsWithCycle / totalRuns : 0;
    stat.cyclesPerRun = totalRuns > 0 ? stat.cycleCount / totalRuns : 0;
  }

  return {
    byStoryline,
    totalCycles,
    cycleFrequencyPerRun: totalRuns > 0 ? runsWithAnyCycle.size / totalRuns : 0,
  };
}

// =========================================================================
// S4: Choice Win-Rate Delta
// =========================================================================

/** Result for S4 (Choice Win-Rate Delta). */
export interface ChoiceWinRateDeltaResult {
  /** Base event ID the delta was computed for. */
  eventId: string;
  /** Win-rate delta: `winRateWhenAccept - winRateWhenReject`. */
  value: number;
  /** Win rate of runs whose first choice for the event was Accept. */
  winRateWhenAccept: number;
  /** Win rate of runs whose first choice for the event was Reject. */
  winRateWhenReject: number;
  /** Number of runs whose first choice for the event was Accept. */
  acceptRuns: number;
  /** Number of runs whose first choice for the event was Reject. */
  rejectRuns: number;
}

/**
 * Computes S4: Choice Win-Rate Delta for a single storyline choice event.
 *
 * Runs are classified by the **first** recorded choice for the event (a run
 * can revisit an event in a cycle); the differential is
 * `winRateWhenAccept - winRateWhenReject`, mirroring the M2 win-rate delta
 * pattern. Returns a zeroed result when the event never appeared.
 *
 * @param runs - Monte Carlo run summaries with (optional) `storylineEvents`.
 * @param eventId - Event template ID (serial suffix tolerated, e.g. `'evt-tax-0'`).
 * @returns Choice win-rate delta, or `null` when no run carried storyline data.
 */
export function computeChoiceWinRateDelta(
  runs: readonly MonteCarloRunSummary[],
  eventId: string,
): ChoiceWinRateDeltaResult | null {
  if (!hasStorylineData(runs)) return null;

  const baseId = stripSerial(eventId);
  let acceptRuns = 0;
  let acceptWins = 0;
  let rejectRuns = 0;
  let rejectWins = 0;

  for (const run of runs) {
    const first = eventsOf(run).find(event => event.baseEventId === baseId);
    if (!first) continue;

    const choice = first.choice.toLowerCase();
    if (choice === 'accept') {
      acceptRuns++;
      if (run.result === 'win') acceptWins++;
    } else if (choice === 'reject') {
      rejectRuns++;
      if (run.result === 'win') rejectWins++;
    }
  }

  const winRateWhenAccept = acceptRuns > 0 ? acceptWins / acceptRuns : 0;
  const winRateWhenReject = rejectRuns > 0 ? rejectWins / rejectRuns : 0;

  return {
    eventId: baseId,
    value: winRateWhenAccept - winRateWhenReject,
    winRateWhenAccept,
    winRateWhenReject,
    acceptRuns,
    rejectRuns,
  };
}
