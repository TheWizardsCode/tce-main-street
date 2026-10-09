#!/usr/bin/env tsx
/**
 * Community-space placement report — canonical greedy profile.
 *
 * MS-0MUX8J9KJ005ZKDW: measures how often the greedy AI places
 * `community-space` cards relative to `business` cards, so the over-selection
 * problem can be captured as a baseline (AC1) and compared after the AI
 * scoring change (AC5). A single placement rate is not enough — the headline
 * metric is the community-space-to-business placement ratio: it must fall
 * materially without inverting the Easy ≥ Medium ≥ Hard win-rate ladder.
 *
 * Canonical profile (matches `docs/main-street/monte-carlo-baseline.json`):
 *   200 seeds, prefix `mc-balance`, 60 max turns, greedy, Easy/Medium/Hard.
 *
 * Usage:
 *   npx vite-node src/scripts/balance/community-space-placement-report.ts \
 *     --label baseline --out docs/main-street/community-space-ai-baseline.json
 *   npx vite-node src/scripts/balance/community-space-placement-report.ts --json
 *
 * Outputs:
 *   - JSON metrics artefact (`--out`; stdout when `--json`).
 *   - Optional markdown table (`--md-out`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { runAllCombinations, type CombinationResult } from '../../MainStreetMonteCarlo';
import type { DifficultyName } from '../../MainStreetDifficulty';
import { currentCommitShaFull } from './baseline-blocks';

const DIFFICULTIES: readonly DifficultyName[] = ['Easy', 'Medium', 'Hard'];

interface DifficultySummary {
  /** Number of runs in the combo. */
  runs: number;
  /** Number of wins. */
  wins: number;
  /** Win rate (0–1). */
  winRate: number;
  /** Total business-family placements across the runs. */
  businessPlacements: number;
  /** Mean business placements per run. */
  businessPlacementsPerRun: number;
  /** Total community-space placements across the runs. */
  communitySpacePlacements: number;
  /** Mean community-space placements per run. */
  communitySpacePlacementsPerRun: number;
  /** community-space ÷ business placement ratio (null when no business placements). */
  communityToBusinessRatio: number | null;
  /** Average coins per turn (liquidity). */
  averageCoinsPerTurn: number;
  /** Median final score. */
  medianScore: number;
}

interface OverallSummary {
  businessPlacements: number;
  communitySpacePlacements: number;
  businessPlacementsPerRun: number;
  communitySpacePlacementsPerRun: number;
  communityToBusinessRatio: number | null;
}

interface CommunitySpacePlacementReport {
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
  overall: OverallSummary;
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
  const wins = runs.filter(r => r.result === 'win').length;
  const businessPlacements = runs.reduce((sum, r) => sum + (r.businessPlacements ?? 0), 0);
  const communitySpacePlacements = runs.reduce(
    (sum, r) => sum + (r.communitySpacePlacements ?? 0),
    0,
  );
  return {
    runs: runs.length,
    wins,
    winRate: runs.length > 0 ? wins / runs.length : 0,
    businessPlacements,
    businessPlacementsPerRun: runs.length > 0 ? businessPlacements / runs.length : 0,
    communitySpacePlacements,
    communitySpacePlacementsPerRun:
      runs.length > 0 ? communitySpacePlacements / runs.length : 0,
    communityToBusinessRatio:
      businessPlacements > 0 ? communitySpacePlacements / businessPlacements : null,
    averageCoinsPerTurn: combo.metrics.averageCoinsPerTurn,
    medianScore: combo.metrics.medianScore,
  };
}

function buildReport(args: CliArgs): CommunitySpacePlacementReport {
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

  const businessPlacements = Object.values(perDifficulty).reduce(
    (sum, s) => sum + s.businessPlacements,
    0,
  );
  const communitySpacePlacements = Object.values(perDifficulty).reduce(
    (sum, s) => sum + s.communitySpacePlacements,
    0,
  );
  const runs = Object.values(perDifficulty).reduce((sum, s) => sum + s.runs, 0);

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
    overall: {
      businessPlacements,
      communitySpacePlacements,
      businessPlacementsPerRun: runs > 0 ? businessPlacements / runs : 0,
      communitySpacePlacementsPerRun: runs > 0 ? communitySpacePlacements / runs : 0,
      communityToBusinessRatio:
        businessPlacements > 0 ? communitySpacePlacements / businessPlacements : null,
    },
    ladder: {
      easyAtLeastMedium,
      mediumAtLeastHard,
      monotone: easyAtLeastMedium && mediumAtLeastHard,
    },
  };
}

function formatMarkdown(report: CommunitySpacePlacementReport): string {
  const rows: string[] = [
    '| Difficulty | business / run | community-space / run | community:business | win rate | coins/turn | median score |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const difficulty of DIFFICULTIES) {
    const s = report.perDifficulty[difficulty];
    if (!s) continue;
    rows.push(
      `| ${difficulty} | ${s.businessPlacementsPerRun.toFixed(2)} | ` +
      `${s.communitySpacePlacementsPerRun.toFixed(2)} | ` +
      `${s.communityToBusinessRatio === null ? 'n/a' : s.communityToBusinessRatio.toFixed(3)} | ` +
      `${s.winRate.toFixed(3)} | ${s.averageCoinsPerTurn.toFixed(2)} | ${s.medianScore.toFixed(1)} |`,
    );
  }
  const overall = report.overall;
  rows.push(
    `| **All** | **${overall.businessPlacementsPerRun.toFixed(2)}** | ` +
    `**${overall.communitySpacePlacementsPerRun.toFixed(2)}** | ` +
    `**${overall.communityToBusinessRatio === null ? 'n/a' : overall.communityToBusinessRatio.toFixed(3)}** | ` +
    `**${report.perDifficulty['Medium']?.winRate.toFixed(3) ?? 'n/a'} (Medium)** | — | — |`,
  );
  return [
    `# Community-space placement — ${report.label}`,
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
      `  ${difficulty}: community ${s.communitySpacePlacementsPerRun.toFixed(2)}/run, ` +
      `business ${s.businessPlacementsPerRun.toFixed(2)}/run, ` +
      `ratio ${s.communityToBusinessRatio === null ? 'n/a' : s.communityToBusinessRatio.toFixed(3)}, ` +
      `winRate=${(s.winRate * 100).toFixed(1)}%\n`,
    );
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`community-space-placement-report.ts failed: ${(error as Error).message}\n`);
  process.exit(1);
}
