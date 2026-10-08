#!/usr/bin/env node
/**
 * Competitive placement opponent-benefit report (MS-0MUZFVM86003IPSM).
 *
 * Measures the rate at which the competitive greedy AI makes street
 * placements that confer *net* benefit on opponents — i.e. the marginal
 * synergy the placement anchors for other seats' businesses exceeds the
 * synergy it anchors for the acting seat's own businesses.
 *
 * The ownership-aware placement change (MS-0MUZFVLVS007S56L) should lower this
 * rate (community spaces that only boost a rival are now rejected) while
 * leaving single-player baselines untouched. Run the report before and after
 * the change to capture the headline evidence.
 *
 * Canonical competitive profile: 200 seeds, prefix `mc-competitive`, 40 shared
 * days, `CompetitiveGreedyStrategy` for every seat, 2 players.
 *
 * Usage:
 *   npx vite-node src/scripts/balance/competitive-placement-report.ts \
 *     --label baseline --out docs/main-street/competitive-placement-ai-baseline.json \
 *     --md-out docs/main-street/competitive-placement-ai-baseline.md
 *   npx vite-node src/scripts/balance/competitive-placement-report.ts --json
 *
 * Outputs:
 *   - JSON metrics artefact (`--out`; stdout when `--json`).
 *   - Optional markdown table (`--md-out`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  runCompetitiveMonteCarlo,
  type CompetitiveMonteCarloResult,
  type CompetitiveMonteCarloMetrics,
  type CompetitivePlacementStats,
} from '../../MainStreetMonteCarlo';
import { currentCommitShaFull } from './baseline-blocks';

interface AggregatePlacementStats {
  placements: number;
  businessPlacements: number;
  communitySpacePlacements: number;
  ownSynergyAnchored: number;
  opponentSynergyAnchored: number;
  opponentBeneficialPlacements: number;
  opponentTouchedPlacements: number;
  businessOpponentBeneficialPlacements: number;
  communitySpaceOpponentBeneficialPlacements: number;
  /** opponentBeneficialPlacements ÷ placements (null when no placements). */
  opponentBeneficialRate: number | null;
  /** opponentTouchedPlacements ÷ placements (null when no placements). */
  opponentTouchedRate: number | null;
  /** communitySpaceOpponentBeneficialPlacements ÷ communitySpacePlacements. */
  communitySpaceOpponentBeneficialRate: number | null;
  /** businessOpponentBeneficialPlacements ÷ businessPlacements. */
  businessOpponentBeneficialRate: number | null;
  /** Mean total placements per run (all seats). */
  placementsPerRun: number;
  /** Mean community-space placements per run (all seats). */
  communitySpacePlacementsPerRun: number;
}

interface PlayerReport extends AggregatePlacementStats {
  playerId: number;
  winRate: number;
  averageScore: number;
}

interface CompetitivePlacementReport {
  /** Free-form label (baseline / after). */
  label: string;
  /** ISO timestamp of the run. */
  generatedAt: string;
  /** Full commit SHA the report was generated from (best-effort). */
  commitSha: string | null;
  /** Canonical profile metadata. */
  profile: {
    seeds: number;
    seedPrefix: string;
    maxTurns: number;
    playerCount: number;
    strategy: 'competitive-greedy';
  };
  runs: number;
  averageTurns: number;
  endReasons: Record<string, number>;
  overall: AggregatePlacementStats;
  players: PlayerReport[];
}

interface CliArgs {
  seeds: number;
  seedPrefix: string;
  maxTurns: number;
  playerCount: number;
  label: string;
  out?: string;
  mdOut?: string;
  json: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx === -1 ? undefined : argv[idx + 1];
  };
  const seeds = Number.parseInt(get('--seeds') ?? '200', 10);
  const maxTurns = Number.parseInt(get('--maxTurns') ?? get('--max-turns') ?? '40', 10);
  const playerCount = Number.parseInt(get('--players') ?? '2', 10);
  if (!Number.isFinite(seeds) || seeds <= 0) {
    throw new Error('--seeds must be a positive integer');
  }
  if (!Number.isFinite(maxTurns) || maxTurns <= 0) {
    throw new Error('--maxTurns must be a positive integer');
  }
  if (!Number.isFinite(playerCount) || playerCount < 2) {
    throw new Error('--players must be an integer >= 2 (competitive)');
  }
  return {
    seeds,
    seedPrefix: get('--seed-prefix') ?? 'mc-competitive',
    maxTurns,
    playerCount,
    label: get('--label') ?? 'baseline',
    out: get('--out'),
    mdOut: get('--md-out'),
    json: argv.includes('--json'),
  };
}

/** Zero-filled aggregate in the same shape as the per-player tallies. */
function emptyAggregate(): Omit<AggregatePlacementStats, 'opponentBeneficialRate' | 'opponentTouchedRate' | 'communitySpaceOpponentBeneficialRate' | 'businessOpponentBeneficialRate' | 'placementsPerRun' | 'communitySpacePlacementsPerRun'> {
  return {
    placements: 0,
    businessPlacements: 0,
    communitySpacePlacements: 0,
    ownSynergyAnchored: 0,
    opponentSynergyAnchored: 0,
    opponentBeneficialPlacements: 0,
    opponentTouchedPlacements: 0,
    businessOpponentBeneficialPlacements: 0,
    communitySpaceOpponentBeneficialPlacements: 0,
  };
}

type MutableAggregate = ReturnType<typeof emptyAggregate>;

function addStats(target: MutableAggregate, stats: CompetitivePlacementStats | undefined): void {
  if (!stats) return;
  target.placements += stats.placements;
  target.businessPlacements += stats.businessPlacements;
  target.communitySpacePlacements += stats.communitySpacePlacements;
  target.ownSynergyAnchored += stats.ownSynergyAnchored;
  target.opponentSynergyAnchored += stats.opponentSynergyAnchored;
  target.opponentBeneficialPlacements += stats.opponentBeneficialPlacements;
  target.opponentTouchedPlacements += stats.opponentTouchedPlacements;
  target.businessOpponentBeneficialPlacements += stats.businessOpponentBeneficialPlacements;
  target.communitySpaceOpponentBeneficialPlacements += stats.communitySpaceOpponentBeneficialPlacements;
}

/** Adds the derived rates and per-run means to a raw tally. */
function finaliseAggregate(
  raw: MutableAggregate,
  runs: number,
): AggregatePlacementStats {
  const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);
  return {
    ...raw,
    opponentBeneficialRate: rate(raw.opponentBeneficialPlacements, raw.placements),
    opponentTouchedRate: rate(raw.opponentTouchedPlacements, raw.placements),
    communitySpaceOpponentBeneficialRate: rate(
      raw.communitySpaceOpponentBeneficialPlacements,
      raw.communitySpacePlacements,
    ),
    businessOpponentBeneficialRate: rate(
      raw.businessOpponentBeneficialPlacements,
      raw.businessPlacements,
    ),
    placementsPerRun: runs > 0 ? raw.placements / runs : 0,
    communitySpacePlacementsPerRun: runs > 0 ? raw.communitySpacePlacements / runs : 0,
  };
}

function aggregatePlayerStats(
  metrics: CompetitiveMonteCarloMetrics,
  raw: MutableAggregate,
  runs: number,
  playerId: number,
): PlayerReport {
  const player = metrics.players.find(p => p.playerId === playerId);
  return {
    playerId,
    winRate: player?.winRate ?? 0,
    averageScore: player?.averageScore ?? 0,
    ...finaliseAggregate(raw, runs),
  };
}

function buildReport(args: CliArgs): CompetitivePlacementReport {
  const seeds = Array.from({ length: args.seeds }, (_, i) => `${args.seedPrefix}-${i}`);
  const result: CompetitiveMonteCarloResult = runCompetitiveMonteCarlo({
    seeds,
    maxTurns: args.maxTurns,
    playerCount: args.playerCount,
  });

  const runs = result.runs.length;
  const overall = emptyAggregate();
  const perPlayer = new Map<number, MutableAggregate>();
  for (let pid = 0; pid < args.playerCount; pid++) perPlayer.set(pid, emptyAggregate());

  for (const run of result.runs) {
    for (const player of run.players) {
      addStats(overall, player.placementStats);
      const bucket = perPlayer.get(player.playerId);
      if (bucket) addStats(bucket, player.placementStats);
    }
  }

  return {
    label: args.label,
    generatedAt: new Date().toISOString(),
    commitSha: currentCommitShaFull() ?? null,
    profile: {
      seeds: args.seeds,
      seedPrefix: args.seedPrefix,
      maxTurns: args.maxTurns,
      playerCount: args.playerCount,
      strategy: 'competitive-greedy',
    },
    runs,
    averageTurns: result.metrics.averageTurns,
    endReasons: result.metrics.endReasons,
    overall: finaliseAggregate(overall, runs),
    players: Array.from(perPlayer.entries()).map(([pid, bucket]) =>
      aggregatePlayerStats(result.metrics, bucket, runs, pid),
    ),
  };
}

function pct(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function formatMarkdown(report: CompetitivePlacementReport): string {
  const o = report.overall;
  return [
    `# Competitive placement opponent-benefit — ${report.label}`,
    '',
    `- Generated: ${report.generatedAt}`,
    `- Commit: ${report.commitSha ?? 'unknown'}`,
    `- Profile: ${report.profile.seeds} seeds, prefix \`${report.profile.seedPrefix}\`, ` +
      `${report.profile.maxTurns} max turns, ${report.profile.playerCount} players, ` +
      `${report.profile.strategy}`,
    `- Runs: ${report.runs} (average ${report.averageTurns.toFixed(2)} shared days)`,
    '',
    '| Metric | Value |',
    '|---|---:|',
    `| Placements / run | ${o.placementsPerRun.toFixed(2)} |`,
    `| Community-space placements / run | ${o.communitySpacePlacementsPerRun.toFixed(2)} |`,
    `| Net-opponent-beneficial placements | ${o.opponentBeneficialPlacements} |`,
    `| **Net-opponent-beneficial rate** | **${pct(o.opponentBeneficialRate)}** |`,
    `| Opponent-touched placements | ${o.opponentTouchedPlacements} |`,
    `| Opponent-touched rate | ${pct(o.opponentTouchedRate)} |`,
    `| Community-space net-opponent-beneficial rate | ${pct(o.communitySpaceOpponentBeneficialRate)} |`,
    `| Business net-opponent-beneficial rate | ${pct(o.businessOpponentBeneficialRate)} |`,
    `| Own synergy anchored | ${o.ownSynergyAnchored} |`,
    `| Opponent synergy anchored | ${o.opponentSynergyAnchored} |`,
    '',
  ].join('\n');
}

function writeOutput(path: string, content: string): void {
  const abs = resolve(path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  process.stderr.write(
    `Running canonical competitive profile: ${args.seeds} seeds, ${args.maxTurns} max turns, ` +
      `${args.playerCount} players, competitive-greedy...\n`,
  );
  const report = buildReport(args);
  const json = JSON.stringify(report, null, 2);
  const markdown = formatMarkdown(report);

  if (args.json) {
    process.stdout.write(`${json}\n`);
  }
  if (args.out) {
    writeOutput(args.out, `${json}\n`);
    process.stderr.write(`JSON written: ${args.out}\n`);
  }
  if (args.mdOut) {
    writeOutput(args.mdOut, markdown);
    process.stderr.write(`Markdown written: ${args.mdOut}\n`);
  }

  const o = report.overall;
  process.stderr.write(
    `\n  placements/run=${o.placementsPerRun.toFixed(2)} ` +
      `net-opponent-beneficial=${o.opponentBeneficialPlacements}` +
      ` (${pct(o.opponentBeneficialRate)}), ` +
      `community-space=${o.communitySpacePlacements}` +
      ` (${pct(o.communitySpaceOpponentBeneficialRate)}), ` +
      `opponent-touched=${o.opponentTouchedPlacements} (${pct(o.opponentTouchedRate)})\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `competitive-placement-report.ts failed: ${(error as Error).message}\n`,
  );
  process.exit(1);
}
