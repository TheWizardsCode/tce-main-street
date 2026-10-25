/**
 * The `npm test` coverage verdict wrapper (MS-0MVK37SK5009M0NG).
 *
 * `scripts/run-tests.ts` exists because the engine's retry runner can accept an
 * incomplete run as green: on 2026-10-23 a retried full-suite run executed 0 of
 * 376 `unit` files, summarised `Test Files 5 passed (5)`, and was accepted as
 * `accepted-transient` (exit 0). A Vitest reporter cannot stop that — its
 * output and `process.exitCode` are ignored by the acceptance decision — so the
 * wrapper runs the runner once and enforces the guard's verdict afterwards.
 *
 * These tests cover the decision logic directly and the wrapper's real
 * process behaviour (env plumbing, report reading, exit codes) against
 * stand-in runners, so no Vitest run is needed.
 *
 * @module tests/tooling/run-tests-guard
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ProjectCoverageReport } from './vitest-project-coverage-reporter';
import {
  COVERAGE_REPORT_ENV,
  evaluateRun,
  readCoverageReport,
  resolveTsxCli,
  RUNNER_ENV,
} from '../../scripts/run-tests';

const REPO_ROOT = path.resolve(__dirname, '../..');

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tests-guard-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

const INCOMPLETE: ProjectCoverageReport = {
  ok: false,
  violations: [
    {
      project: 'unit',
      expected: ['tests/a.test.ts', 'tests/b.test.ts'],
      ran: [],
      missing: ['tests/a.test.ts', 'tests/b.test.ts'],
    },
  ],
};

const COMPLETE: ProjectCoverageReport = { ok: true, violations: [] };

describe('evaluateRun', () => {
  it('fails a run the retry runner accepted as green but the guard judged incomplete', () => {
    const verdict = evaluateRun(0, INCOMPLETE);

    expect(verdict.exitCode).toBe(1);
    expect(verdict.message).toContain('project "unit" executed 0 of 2 expected file(s)');
    expect(verdict.message).toContain('tests/a.test.ts');
  });

  it('keeps a genuine failure failing', () => {
    const verdict = evaluateRun(1, INCOMPLETE);

    expect(verdict.exitCode).toBe(1);
    expect(verdict.message).toContain('project "unit"');
  });

  it('passes a complete run', () => {
    expect(evaluateRun(0, COMPLETE)).toEqual({ exitCode: 0, message: '' });
  });

  it('keeps a non-zero exit even when coverage is complete', () => {
    expect(evaluateRun(2, COMPLETE)).toEqual({ exitCode: 2, message: '' });
  });

  it('fails a green run that produced no verdict at all', () => {
    const verdict = evaluateRun(0, undefined);

    expect(verdict.exitCode).toBe(1);
    expect(verdict.message).toContain('produced no coverage verdict');
    expect(verdict.message).toContain('--reporter=');
  });

  it('never masks a non-green runner exit when the verdict is missing', () => {
    expect(evaluateRun(1, undefined)).toEqual({ exitCode: 1, message: '' });
  });
});

describe('readCoverageReport', () => {
  it('reads an incomplete verdict', () => {
    const reportPath = path.join(temporaryDirectory(), 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(INCOMPLETE), 'utf8');

    expect(readCoverageReport(reportPath)).toEqual(INCOMPLETE);
  });

  it('returns undefined for a missing file', () => {
    expect(readCoverageReport(path.join(temporaryDirectory(), 'absent.json'))).toBeUndefined();
  });

  it('returns undefined for a malformed report rather than crashing', () => {
    const reportPath = path.join(temporaryDirectory(), 'report.json');
    fs.writeFileSync(reportPath, '{"ok":"yes"}', 'utf8');

    expect(readCoverageReport(reportPath)).toBeUndefined();
  });
});

describe('scripts/run-tests.ts (npm test entry point)', () => {
  /** Write a stand-in runner that writes `report` (if given) and exits `code`. */
  function standInRunner(directory: string, report: ProjectCoverageReport | undefined, code: number): string {
    const runnerPath = path.join(directory, `runner-${code}-${report ? 'report' : 'silent'}.mjs`);
    const reportLiteral = report ? JSON.stringify(report) : 'null';
    fs.writeFileSync(
      runnerPath,
      [
        "import fs from 'node:fs';",
        `const report = ${reportLiteral};`,
        `const code = ${code};`,
        'const reportPath = process.env.PROJECT_COVERAGE_REPORT;',
        'if (report && reportPath) {',
        '  fs.writeFileSync(reportPath, JSON.stringify(report));',
        '}',
        'process.exit(code);',
        '',
      ].join('\n'),
      'utf8',
    );
    return runnerPath;
  }

  function runWrapper(runnerPath: string): { status: number | null; output: string } {
    const result = spawnSync(
      process.execPath,
      [resolveTsxCli(REPO_ROOT), path.join(REPO_ROOT, 'scripts', 'run-tests.ts'), '--project', 'unit'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, [RUNNER_ENV]: runnerPath },
        timeout: 120_000,
      },
    );
    return {
      status: result.status,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  }

  // Each case spawns `tsx` twice (wrapper + stand-in runner); a loaded host can
  // take well over the 15 s default, so every case gets an explicit budget.
  const CASE_TIMEOUT_MS = 120_000;

  it('fails when the accepted run left files unexecuted', () => {
    const runner = standInRunner(temporaryDirectory(), INCOMPLETE, 0);
    const { status, output } = runWrapper(runner);

    expect(status).toBe(1);
    expect(output).toContain('[project-coverage-guard] FAIL');
    expect(output).toContain('project "unit" executed 0 of 2 expected file(s)');
  }, CASE_TIMEOUT_MS);

  it('passes a complete run', () => {
    const { status, output } = runWrapper(
      standInRunner(temporaryDirectory(), COMPLETE, 0),
    );

    expect(status).toBe(0);
    expect(output).not.toContain('[project-coverage-guard]');
  }, CASE_TIMEOUT_MS);

  it('forwards a non-zero runner exit code unchanged', () => {
    expect(runWrapper(standInRunner(temporaryDirectory(), COMPLETE, 3)).status).toBe(3);
  }, CASE_TIMEOUT_MS);

  it('fails a green run that produced no verdict', () => {
    const { status, output } = runWrapper(standInRunner(temporaryDirectory(), undefined, 0));

    expect(status).toBe(1);
    expect(output).toContain('produced no coverage verdict');
  }, CASE_TIMEOUT_MS);

  it('passes the report path to the runner through the environment', () => {
    const directory = temporaryDirectory();
    const probe = path.join(directory, 'probe.mjs');
    const seenPath = path.join(directory, 'seen.txt');
    fs.writeFileSync(
      probe,
      [
        "import fs from 'node:fs';",
        'fs.writeFileSync(' + JSON.stringify(seenPath) + ', process.env.PROJECT_COVERAGE_REPORT ?? "");',
        'process.exit(0);',
        '',
      ].join('\n'),
      'utf8',
    );

    runWrapper(probe);

    const reported = fs.readFileSync(seenPath, 'utf8');
    expect(reported).toMatch(/tce-main-street-coverage-\d+\.json$/);
    expect(COVERAGE_REPORT_ENV).toBe('PROJECT_COVERAGE_REPORT');
  }, CASE_TIMEOUT_MS);
});
