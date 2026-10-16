#!/usr/bin/env node
/**
 * Competitive piggyback balance report (F7, epic MS-0MUYC47EL005Z69H).
 *
 * Records the competitive Monte Carlo before/after evidence for the piggyback
 * mechanic. The economy-runaway risk (intake) is that stacking 100%-reward
 * participation across organiser events could inflate a seat's economy; the
 * 150% cost premium is the primary mitigation. This report measures:
 *
 *   - win-rate / score attribution per seat (the AC2 metric);
 *   - average final coins per seat (economy runaway signal);
 *   - piggyback adoption: decisions offered, join-fully vs free-ride, coins
 *     spent (150% charges) vs coins/reputation earned through the mechanic
 *     (the F7 harness tally — zero on the pre-piggyback baseline).
 *
 * Canonical competitive profile: 200 seeds, prefix `mc-competitive`, 40 shared
 * days, `CompetitiveGreedyStrategy` for every seat, 2 players.
 *
 * Usage (after — from a checkout with the piggyback changes):
 *   npx vite-node src/scripts/balance/piggyback-balance-report.ts \
 *     --label after \
 *     --out docs/dev/assets/monte-carlo-piggyback-after.json \
 *     --md-out docs/dev/assets/monte-carlo-piggyback-after.md
 *
 * Usage (baseline — from a pre-piggyback checkout, copy this script in):
 *   npx vite-node src/scripts/balance/piggyback-balance-report.ts \
 *     --label baseline \
 *     --out docs/dev/assets/monte-carlo-piggyback-baseline.json
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
  type CompetitivePiggybackStats,
} from '../../MainStreetMonteCarlo';
import { currentCommitShaFull } from './baseline-blocks';

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

interface PiggybackTotals {
  decisions: number;
  joins: number;
  freeRides: number;
  coinsSpent: number;
  coinsEarned: number;
  reputationEarned: number;
  paidCostTotal: number;
  /** Runs in which at least one seat was offered a piggyback decision. */
  runsWithDecisions: number;
}

function emptyTotals(): PiggybackTotals {
  return {
    decisions: 0,
    joins: 0,
    freeRides: 0,
    coinsSpent: 0,
    coinsEarned: 0,
    reputationEarned: 0,
    paidCostTotal: 0,
    runsWithDecisions: 0,
  };
}

function addStats(target: PiggybackTotals, stats: CompetitivePiggybackStats | undefined): void {
  if (!stats) return;
  target.decisions += stats.decisions;
  target.joins += stats.joins;
  target.freeRides += stats.freeRides;
  target.coinsSpent += stats.coinsSpent;
  target.coinsEarned += stats.coinsEarned;
  target.reputationEarned += stats.reputationEarned;
  target.paidCostTotal += stats.paidCostTotal;
}

interface PlayerReport {
  playerId: number;
  winRate: number;
  averageScore: number;
  medianScore: number;
  averageCoins: number;
  losses: number;
  piggyback: PiggybackTotals;
}

interface PiggybackBalanceReport {
  label: string;
  generatedAt: string;
  commitSha: string | null;
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
  /**
   * True when the checkout that produced this artefact tallied piggyback
   * trade (post-F3/F4). The pre-piggyback baseline reports `false` and zero
   * piggyback totals — win-rate/score/coins are still comparable.
   */
  piggybackTallied: boolean;
  players: PlayerReport[];
  piggyback: PiggybackTotals;
}

function buildReport(args: CliArgs): PiggybackBalanceReport {
  const seeds = Array.from({ length: args.seeds }, (_, i) => `${args.seedPrefix}-${i}`);
  const result: CompetitiveMonteCarloResult = runCompetitiveMonteCarlo({
    seeds,
    maxTurns: args.maxTurns,
    playerCount: args.playerCount,
  });

  const runs = result.runs.length;
  const perPlayer = new Map<number, PiggybackTotals>();
  for (let pid = 0; pid < args.playerCount; pid++) perPlayer.set(pid, emptyTotals());
  let overall = emptyTotals();

  for (const run of result.runs) {
    for (const player of run.players) {
      const stats = player.piggybackStats;
      addStats(overall, stats);
      const bucket = perPlayer.get(player.playerId);
      if (bucket) addStats(bucket, stats);
    }
    if (run.players.some(p => (p.piggybackStats?.decisions ?? 0) > 0)) {
      overall.runsWithDecisions += 1;
    }
  }

  const piggybackTallied = result.runs.some(r =>
    r.players.some(p => p.piggybackStats !== undefined),
  );

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
    piggybackTallied,
    players: Array.from(perPlayer.entries()).map(([pid, totals]) => {
      const m = result.metrics.players.find(p => p.playerId === pid);
      return {
        playerId: pid,
        winRate: m?.winRate ?? 0,
        averageScore: m?.averageScore ?? 0,
        medianScore: m?.medianScore ?? 0,
        averageCoins: m?.averageCoins ?? 0,
        losses: m?.losses ?? 0,
        piggyback: totals,
      };
    }),
    piggyback: overall,
  };
}

function pct(value: number, denominator: number): string {
  return denominator > 0 ? `${((value / denominator) * 100).toFixed(1)}%` : 'n/a';
}

function formatMarkdown(report: PiggybackBalanceReport): string {
  const pb = report.piggyback;
  const joinRate = pct(pb.joins, pb.decisions);
  const lines = [
    `# Competitive piggyback balance — ${report.label}`,
    '',
    `- Generated: ${report.generatedAt}`,
    `- Commit: ${report.commitSha ?? 'unknown'}`,
    `- Profile: ${report.profile.seeds} seeds, prefix \`${report.profile.seedPrefix}\`, ` +
      `${report.profile.maxTurns} max turns, ${report.profile.playerCount} players, ` +
      `${report.profile.strategy}`,
    `- Runs: ${report.runs} (average ${report.averageTurns.toFixed(2)} shared days)`,
    `- Piggyback tallied: ${report.piggybackTallied ? 'yes' : 'no (pre-piggyback baseline)'}`,
    '',
    '| Seat | Win rate | Avg score | Median score | Avg coins | Piggyback decisions | Join-fully | Free-ride | Coins spent | Coins earned | Rep earned |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const p of report.players) {
    lines.push(
      `| ${p.playerId} | ${(p.winRate * 100).toFixed(1)}% | ${p.averageScore.toFixed(1)} | ` +
        `${p.medianScore.toFixed(1)} | ${p.averageCoins.toFixed(1)} | ${p.piggyback.decisions} | ` +
        `${p.piggyback.joins} | ${p.piggyback.freeRides} | ${p.piggyback.coinsSpent} | ` +
        `${p.piggyback.coinsEarned} | ${p.piggyback.reputationEarned} |`,
    );
  }
  lines.push(
    '',
    `| Metric | Value |`,
    '|---|---:|',
    `| Runs with ≥1 piggyback decision | ${pb.runsWithDecisions} (${pct(pb.runsWithDecisions, report.runs)}) |`,
    `| Total decisions | ${pb.decisions} |`,
    `| **Join-fully rate (of decisions)** | **${joinRate}** |`,
    `| Free-ride count | ${pb.freeRides} |`,
    `| Coins spent (150% charges) | ${pb.coinsSpent} |`,
    `| Coins earned | ${pb.coinsEarned} |`,
    `| Net coins through mechanic | ${pb.coinsEarned - pb.coinsSpent} |`,
    `| Reputation earned | ${pb.reputationEarned} |`,
    `| Paid-cost baseline sum | ${pb.paidCostTotal} |`,
    '',
  );
  return lines.join('\n');
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

  const pb = report.piggyback;
  process.stderr.write(
    `\n  runs=${report.runs} win-rates=[${report.players.map(p => `${p.playerId}@${(p.winRate * 100).toFixed(1)}%`).join(', ')}] ` +
      `avgCoins=[${report.players.map(p => p.averageCoins.toFixed(0)).join(', ')}] ` +
      `piggyback=${pb.decisions} decisions / ${pb.joins} joins` +
      ` (${pct(pb.joins, pb.decisions)}), net coins ${pb.coinsEarned - pb.coinsSpent}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`piggyback-balance-report.ts failed: ${(error as Error).message}\n`);
  process.exit(1);
}
