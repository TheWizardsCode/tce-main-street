#!/usr/bin/env tsx
/**
 * Community Favour usage report — canonical greedy profile.
 *
 * MS-0MUVB2ZES005V83Y: measures how often the greedy AI spends reputation on
 * the Community Favour `rep→coins` exchange (CG-0MSTOATDQ005XDET) and whether
 * the exchange enables profitable placements. Run on the baseline (before a
 * heuristic change) and again afterwards; the two JSON artefacts are recorded
 * in the work item and a `docs/main-street/` comparison file (AC1/AC5).
 *
 * Canonical profile (matches `docs/main-street/monte-carlo-baseline.json`):
 *   200 seeds, prefix `mc-balance`, 60 max turns, greedy, Easy/Medium/Hard.
 *
 * Usage:
 *   npx vite-node src/scripts/balance/favour-usage-report.ts \
 *     --label baseline --out docs/main-street/favour-ai-baseline.json
 *   npx vite-node src/scripts/balance/favour-usage-report.ts --json
 *
 * Outputs:
 *   - JSON metrics artefact (`--out`; stdout when `--json`).
 *   - Optional markdown table (`--md-out`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  runAllCombinations,
  type CombinationResult,
} from '../../MainStreetMonteCarlo';
import type { DifficultyName } from '../../MainStreetDifficulty';
import { computeLossModeDecomposition } from './engine/global-metrics';
import type { LossModeDecompositionResult } from './engine/global-metrics';
import { currentCommitShaFull } from './baseline-blocks';

const DIFFICULTIES: readonly DifficultyName[] = ['Easy', 'Medium', 'Hard'];

interface DifficultySummary {
  /** Number of runs in the combo. */
  runs: number;
  /** Number of wins. */
  wins: number;
  /** Win rate (0–1). */
  winRate: number;
  /** Total rep→coins exchanges taken across the runs. */
  repToCoinsUses: number;
  /** Mean rep→coins exchanges per run. */
  repToCoinsPerRun: number;
  /** Total coins→rep exchanges taken across the runs. */
  coinsToRepUses: number;
  /** Mean coins→rep exchanges per run. */
  coinsToRepPerRun: number;
  /** Total losses. */
  losses: number;
  /** Loss-mode decomposition (counts + shares). */
  lossModes: LossModeDecompositionResult['counts'];
  /** Reputation-collapse share of losses (0–1). */
  reputationCollapseShare: number;
  /** Bankruptcy share of losses (0–1). */
  bankruptcyShare: number;
  /** Average coins per turn (liquidity). */
  averageCoinsPerTurn: number;
  /** Median final score. */
  medianScore: number;
}

interface FavourUsageReport {
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
    strategy: 'greedy';
    difficulties: readonly DifficultyName[];
  };
  perDifficulty: Record<string, DifficultySummary>;
  /** Primary balance gate: Easy ≥ Medium ≥ Hard. */
  ladder: {
    easyAtLeastMedium: boolean;
    mediumAtLeastHard: boolean;
    monotone: boolean;
  };
}

interface CliArgs {
  seeds: number;
  seedPrefix: string;
  maxTurns: number;
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
  const maxTurns = Number.parseInt(get('--maxTurns') ?? get('--max-turns') ?? '60', 10);
  if (!Number.isFinite(seeds) || seeds <= 0) {
    throw new Error('--seeds must be a positive integer');
  }
  if (!Number.isFinite(maxTurns) || maxTurns <= 0) {
    throw new Error('--maxTurns must be a positive integer');
  }
  return {
    seeds,
    seedPrefix: get('--seed-prefix') ?? 'mc-balance',
    maxTurns,
    label: get('--label') ?? 'baseline',
    out: get('--out'),
    mdOut: get('--md-out'),
    json: argv.includes('--json'),
  };
}

function summariseCombo(combo: CombinationResult): DifficultySummary {
  const runs = combo.runs;
  const repToCoinsUses = runs.reduce((sum, r) => sum + (r.favourRepToCoinsUses ?? 0), 0);
  const coinsToRepUses = runs.reduce((sum, r) => sum + (r.favourCoinsToRepUses ?? 0), 0);
  const lossModes = computeLossModeDecomposition(runs);
  const losses = lossModes.totalLosses;
  const wins = runs.filter(r => r.result === 'win').length;
  return {
    runs: runs.length,
    wins,
    winRate: runs.length > 0 ? wins / runs.length : 0,
    repToCoinsUses,
    repToCoinsPerRun: runs.length > 0 ? repToCoinsUses / runs.length : 0,
    coinsToRepUses,
    coinsToRepPerRun: runs.length > 0 ? coinsToRepUses / runs.length : 0,
    losses,
    lossModes: lossModes.counts,
    reputationCollapseShare: lossModes.shares.reputation_collapse,
    bankruptcyShare: lossModes.shares.bankruptcy,
    averageCoinsPerTurn: combo.metrics.averageCoinsPerTurn,
    medianScore: combo.metrics.medianScore,
  };
}

function buildReport(args: CliArgs): FavourUsageReport {
  const seeds = Array.from({ length: args.seeds }, (_, i) => `${args.seedPrefix}-${i}`);
  const results = runAllCombinations({
    seeds,
    maxTurns: args.maxTurns,
    strategies: ['greedy'],
    difficulties: DIFFICULTIES,
  });

  const perDifficulty: Record<string, DifficultySummary> = {};
  for (const combo of results) {
    perDifficulty[combo.difficulty] = summariseCombo(combo);
  }

  const easy = perDifficulty['Easy'];
  const medium = perDifficulty['Medium'];
  const hard = perDifficulty['Hard'];
  const easyAtLeastMedium = !!easy && !!medium && easy.winRate >= medium.winRate;
  const mediumAtLeastHard = !!medium && !!hard && medium.winRate >= hard.winRate;

  return {
    label: args.label,
    generatedAt: new Date().toISOString(),
    commitSha: currentCommitShaFull() ?? null,
    profile: {
      seeds: args.seeds,
      seedPrefix: args.seedPrefix,
      maxTurns: args.maxTurns,
      strategy: 'greedy',
      difficulties: DIFFICULTIES,
    },
    perDifficulty,
    ladder: {
      easyAtLeastMedium,
      mediumAtLeastHard,
      monotone: easyAtLeastMedium && mediumAtLeastHard,
    },
  };
}

function formatMarkdown(report: FavourUsageReport): string {
  const rows: string[] = [
    '| Difficulty | rep→coins / run | coins→rep / run | win rate | rep-collapse / losses | bankruptcy / losses | coins/turn | median score |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const difficulty of DIFFICULTIES) {
    const s = report.perDifficulty[difficulty];
    if (!s) continue;
    rows.push(
      `| ${difficulty} | ${s.repToCoinsPerRun.toFixed(2)} | ${s.coinsToRepPerRun.toFixed(2)} | ` +
      `${s.winRate.toFixed(3)} | ${s.lossModes.reputation_collapse} / ${s.losses} ` +
      `(${(s.reputationCollapseShare * 100).toFixed(1)}%) | ${s.lossModes.bankruptcy} / ${s.losses} ` +
      `(${(s.bankruptcyShare * 100).toFixed(1)}%) | ${s.averageCoinsPerTurn.toFixed(2)} | ${s.medianScore.toFixed(1)} |`,
    );
  }
  return [
    `# Community Favour usage — ${report.label}`,
    '',
    `- Generated: ${report.generatedAt}`,
    `- Commit: ${report.commitSha ?? 'unknown'}`,
    `- Profile: ${report.profile.seeds} seeds, prefix \`${report.profile.seedPrefix}\`, ` +
      `${report.profile.maxTurns} max turns, ${report.profile.strategy}, ` +
      `${report.profile.difficulties.join('/')}`,
    `- Win-rate ladder Easy ≥ Medium ≥ Hard: ${report.ladder.monotone ? 'holds' : 'BROKEN'}`,
    '',
    ...rows,
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
    `Running canonical greedy profile: ${args.seeds} seeds, ${args.maxTurns} max turns, ` +
    `Easy/Medium/Hard...\n`,
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

  process.stderr.write('\n');
  for (const difficulty of DIFFICULTIES) {
    const s = report.perDifficulty[difficulty];
    if (!s) continue;
    process.stderr.write(
      `  ${difficulty}: rep→coins ${s.repToCoinsPerRun.toFixed(2)}/run, ` +
      `winRate=${(s.winRate * 100).toFixed(1)}%, ` +
      `repCollapse=${(s.reputationCollapseShare * 100).toFixed(1)}% of losses\n`,
    );
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`favour-usage-report.ts failed: ${(error as Error).message}\n`);
  process.exit(1);
}
