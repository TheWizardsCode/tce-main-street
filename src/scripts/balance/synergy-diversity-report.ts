#!/usr/bin/env node
/**
 * Synergy diversity (G4/HHI) report — MS-0MUR9INHX001QCSE (C5
 * MS-0MVFR4RM20021KA4).
 *
 * Runs the canonical greedy Monte Carlo profile and reports, per difficulty,
 * the Herfindahl-Hirschman Index (HHI) of synergy-type shares from each run's
 * captured `finalGrid`, using the template-derived synergy type map
 * (`buildSynergyTypeMap()`). Any synergy type with a share > 40% in a
 * difficulty is flagged as dominant (stderr + markdown).
 *
 * Canonical profile: 200 seeds, prefix `mc-balance`, 60 max turns, `greedy`,
 * difficulties Easy/Medium/Hard. `--difficulty` optionally filters to one
 * level or a comma list; without it all three are reported.
 *
 * Usage:
 *   npx vite-node src/scripts/balance/synergy-diversity-report.ts
 *   npx vite-node src/scripts/balance/synergy-diversity-report.ts \
 *     --seeds 200 --maxTurns 40 --difficulty Medium --json
 *   npx vite-node src/scripts/balance/synergy-diversity-report.ts \
 *     --label canonical --out docs/dev/assets/synergy-diversity-report.json
 *
 * Outputs:
 *   - JSON to stdout with `--json`, and to `--out` when supplied.
 *   - Markdown summary table (default `docs/dev/assets/synergy-diversity-report.md`).
 *   - One warning line per dominance finding on stderr.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  ALL_DIFFICULTIES,
  runAllCombinations,
  type MonteCarloStrategy,
} from '../../MainStreetMonteCarlo';
import type { DifficultyName } from '../../MainStreetDifficulty';
import {
  assembleSynergyDiversityReport,
  buildSynergyDiversityEntry,
  formatDominanceWarnings,
  formatSynergyDiversityJson,
  formatSynergyDiversityMarkdown,
  type SynergyDiversityReport,
} from './engine/synergy-diversity';
import { buildSynergyTypeMap } from './engine/global-metrics';
import { currentCommitShaFull } from './baseline-blocks';

const DEFAULT_MD_OUT = 'docs/dev/assets/synergy-diversity-report.md';

interface CliArgs {
  seeds: number;
  seedPrefix: string;
  maxTurns: number;
  strategy: MonteCarloStrategy;
  difficulties: readonly DifficultyName[];
  label: string;
  out?: string;
  mdOut?: string;
  json: boolean;
}

function parseDifficulties(raw: string | undefined): readonly DifficultyName[] {
  if (!raw) return ALL_DIFFICULTIES;
  const requested = raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  const invalid = requested.filter(
    value => !ALL_DIFFICULTIES.includes(value as DifficultyName),
  );
  if (invalid.length > 0) {
    throw new Error(
      `--difficulty must be one or more of ${ALL_DIFFICULTIES.join(', ')}; got "${invalid.join(', ')}"`,
    );
  }
  return requested as DifficultyName[];
}

function parseArgs(argv: readonly string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx === -1 ? undefined : argv[idx + 1];
  };
  const seeds = Number.parseInt(get('--seeds') ?? '200', 10);
  const maxTurns = Number.parseInt(get('--maxTurns') ?? get('--max-turns') ?? '60', 10);
  const strategy = (get('--strategy') ?? 'greedy') as MonteCarloStrategy;
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
    strategy,
    difficulties: parseDifficulties(get('--difficulty')),
    label: get('--label') ?? 'canonical',
    out: get('--out'),
    mdOut: get('--md-out') ?? DEFAULT_MD_OUT,
    json: argv.includes('--json'),
  };
}

function buildReport(args: CliArgs): SynergyDiversityReport {
  const seeds = Array.from({ length: args.seeds }, (_, i) => `${args.seedPrefix}-${i}`);
  const combinations = runAllCombinations({
    seeds,
    maxTurns: args.maxTurns,
    strategies: [args.strategy],
    difficulties: args.difficulties,
  });

  const synergyTypeMap = buildSynergyTypeMap();
  const entries = combinations.map(combination =>
    buildSynergyDiversityEntry(combination.difficulty, combination.runs, synergyTypeMap),
  );
  const { dominance } = assembleSynergyDiversityReport(entries);

  return {
    label: args.label,
    generatedAt: new Date().toISOString(),
    commitSha: currentCommitShaFull() ?? null,
    profile: {
      seeds: args.seeds,
      seedPrefix: args.seedPrefix,
      maxTurns: args.maxTurns,
      strategy: args.strategy,
    },
    entries,
    dominance,
  };
}

function writeOutput(path: string, content: string): void {
  const abs = resolve(path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  process.stderr.write(
    `Running canonical synergy-diversity profile: ${args.seeds} seeds, ` +
      `${args.maxTurns} max turns, ${args.strategy}, ` +
      `${args.difficulties.join('/')}...\n`,
  );

  const report = buildReport(args);
  const json = formatSynergyDiversityJson(report);
  const markdown = formatSynergyDiversityMarkdown(report);

  if (args.json) process.stdout.write(`${json}\n`);
  if (args.out) {
    writeOutput(args.out, `${json}\n`);
    process.stderr.write(`JSON written: ${args.out}\n`);
  }
  if (args.mdOut) {
    writeOutput(args.mdOut, markdown);
    process.stderr.write(`Markdown written: ${args.mdOut}\n`);
  }

  const warnings = formatDominanceWarnings(report.dominance);
  for (const warning of warnings) process.stderr.write(`${warning}\n`);

  const summary = report.entries
    .map(entry => `${entry.difficulty}: HHI=${entry.hhi} runs=${entry.runs}`)
    .join(', ');
  process.stderr.write(
    `\n  ${summary}\n  dominance findings: ${report.dominance.length}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `synergy-diversity-report.ts failed: ${(error as Error).message}\n`,
  );
  process.exit(1);
}
