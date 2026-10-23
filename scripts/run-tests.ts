#!/usr/bin/env node
/**
 * `npm test` entry point: one Vitest invocation, with a coverage verdict that
 * cannot be masked (MS-0MVK37SK5009M0NG).
 *
 * ## Why this exists
 *
 * The suite runs through the engine's retry runner
 * (`core/scripts/vitest-run-with-retry.ts`), which decides whether to retry or
 * accept a non-zero run **from the output text alone**: a transient signature
 * (worker RPC timeout / browser WebSocket drop) plus a summary line reading
 * `Test Files N passed (N)` is accepted as green. It has no notion of *which*
 * files the run intended to execute, so an accepted run can be missing an
 * entire Vitest project.
 *
 * That is not hypothetical. On 2026-10-23 a full-suite run at `f9609f8d` was:
 * attempt 1 — 381 of 381 files passed (376 `unit` + 5 `unit-cli`) but exited
 * non-zero on two `onTaskUpdate` timeouts; attempt 2 — only the 5 `unit-cli`
 * files ran, `unit` executed 0 of 376; summary `Test Files 5 passed (5)`;
 * runner verdict `accepted-transient`, exit 0. The gate would have gone green
 * with 376 files never executed.
 *
 * A Vitest reporter cannot prevent that: it can print and set
 * `process.exitCode`, both of which the acceptance decision ignores. So this
 * wrapper runs the retry runner **once** (same single Vitest invocation, same
 * `--project` flags, all arguments forwarded) and then enforces the guard's
 * machine-readable verdict (`PROJECT_COVERAGE_REPORT`, written by
 * `tests/tooling/vitest-project-coverage-reporter.ts`):
 *
 * - verdict incomplete → exit 1, printing the guard's message even when the
 *   retry runner accepted the run as green;
 * - verdict missing on an otherwise green run → exit 1 (the guard did not run,
 *   e.g. a `--reporter=` override replaced the configured reporters);
 * - otherwise the retry runner's exit code is propagated unchanged.
 *
 * Usage (what `package.json` runs):
 *
 *   tsx scripts/run-tests.ts --timeout-ms 720000 --project unit --project unit-cli
 *
 * @module scripts/run-tests
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ProjectCoverageReport } from '../tests/tooling/vitest-project-coverage-reporter';
import {
  COVERAGE_REPORT_ENV,
  formatCoverageFailure,
} from '../tests/tooling/vitest-project-coverage-reporter';

export { COVERAGE_REPORT_ENV };

/** Default retry runner (the engine owns it; this wrapper never reimplements it). */
export const DEFAULT_RUNNER = 'core/scripts/vitest-run-with-retry.ts';

/** Locate the `tsx` CLI in the local `node_modules` (worktrees symlink it). */
export function resolveTsxCli(cwd: string = process.cwd()): string {
  const candidates = [
    path.join(cwd, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.join(cwd, 'node_modules', '.bin', 'tsx'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `tsx not found under ${path.join(cwd, 'node_modules')} — run \`npm install\` first.`,
  );
}

/** Read the guard's verdict, or `undefined` when it was not written. */
export function readCoverageReport(
  reportPath: string,
): ProjectCoverageReport | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ProjectCoverageReport;
    if (typeof parsed?.ok !== 'boolean' || !Array.isArray(parsed.violations)) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/** Outcome of evaluating a finished run. */
export interface RunVerdict {
  exitCode: number;
  /** Text to print before exiting ('' when nothing needs saying). */
  message: string;
}

/**
 * Decide the wrapper's exit code from the retry runner's exit code and the
 * guard's verdict.
 *
 * - The guard's verdict only ever *adds* failure: a run the guard judged
 *   incomplete fails even if the runner exited 0.
 * - A green runner with no verdict fails: "the guard did not run" is not
 *   evidence that everything ran.
 * - A non-green runner keeps its own exit code (the verdict cannot make a
 *   genuine failure pass).
 */
export function evaluateRun(
  runnerExitCode: number,
  coverage: ProjectCoverageReport | undefined,
): RunVerdict {
  if (coverage && !coverage.ok) {
    return {
      exitCode: runnerExitCode === 0 ? 1 : runnerExitCode,
      message: formatCoverageFailure(coverage.violations),
    };
  }
  if (runnerExitCode === 0 && !coverage) {
    return {
      exitCode: 1,
      message: [
        '[project-coverage-guard] FAIL: the run finished green but produced no coverage verdict.',
        'The zero-coverage guard is wired through `test.reporters` in vite.config.ts;',
        'an explicit `--reporter=` on the command line replaces that list, so runs must',
        'not pass one. Re-run `npm test` without `--reporter`',
        '(docs/dev/testing.md, MS-0MVK37SK5009M0NG).',
      ].join('\n'),
    };
  }
  return { exitCode: runnerExitCode, message: '' };
}

/** Test seam: override the retry-runner path (production uses {@link DEFAULT_RUNNER}). */
export const RUNNER_ENV = 'PROJECT_COVERAGE_RUNNER';

/** Spawn the retry runner with `args`, inheriting stdio, and report its code. */
export function runRetryRunner(
  args: readonly string[],
  options: {
    cwd?: string;
    reportPath?: string;
    runner?: string;
    tsxCli?: string;
  } = {},
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const tsxCli = options.tsxCli ?? resolveTsxCli(cwd);
  const runner = options.runner ?? process.env[RUNNER_ENV] ?? DEFAULT_RUNNER;
  const reportPath = options.reportPath;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [tsxCli, runner, ...args], {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...(reportPath ? { [COVERAGE_REPORT_ENV]: reportPath } : {}),
      },
    });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reportPath = path.join(
    os.tmpdir(),
    `tce-main-street-coverage-${process.pid}.json`,
  );
  fs.rmSync(reportPath, { force: true });

  const runnerExitCode = await runRetryRunner(args, { reportPath });
  const coverage = readCoverageReport(reportPath);
  fs.rmSync(reportPath, { force: true });

  const verdict = evaluateRun(runnerExitCode, coverage);
  if (verdict.message) process.stderr.write(`${verdict.message}\n`);
  process.exit(verdict.exitCode);
}

if (process.argv[1] && /run-tests\.(ts|js)$/.test(process.argv[1])) {
  void main();
}
