/**
 * Harness self-validation for `scripts/soak-browser-waits.sh`
 * (MS-0MVLINY2Q004V33L).
 *
 * The soak is deliberately NOT exercised against real Vitest runs here — a
 * 20-run browser soak is the standalone evidence job, run through the test
 * skill's `soak` / `soak-load` types. What belongs in the `unit` project is
 * the *harness logic*: run loop, fail-fast abort, summary markdown, and the
 * `--load` burner lifecycle. These tests drive the script with its documented
 * `SOAK_RUNNER_CMD` override (and a temp copy of the script, so the generated
 * `results/` summaries never touch the checkout):
 *
 * - a pass-only mock proves `--runs N` runs N times, writes one PASS row per
 *   run and exits 0;
 * - a fail-on-run-3 mock proves the harness aborts at the first failure (runs
 *   4..N never execute), keeps and prints the failing run's output, and exits
 *   non-zero with a FAILED summary;
 * - a `--load` mock proves `$(nproc)` burners are alive during the run, the
 *   load average is recorded, and the burners are gone afterwards (EXIT trap).
 *
 * @module tests/tooling/soak-browser-waits
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SOAK_SCRIPT = path.join(REPO_ROOT, 'scripts', 'soak-browser-waits.sh');

/** Count of live `yes` processes (the burner process name). */
function burnerCount(): number {
  const probe = spawnSync('pgrep', ['-x', 'yes'], { encoding: 'utf8' });
  if (probe.status === 1) return 0; // pgrep: no match
  if (probe.status !== 0) throw new Error(`pgrep -x yes failed: ${probe.stderr}`);
  return probe.stdout.trim().split('\n').filter(Boolean).length;
}

const temporaryDirectories: string[] = [];

/**
 * An isolated sandbox containing a copy of the soak script, so the script's
 * repo-root-relative `results/` output stays out of the checkout.
 */
function sandbox(): { root: string; script: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soak-selftest-'));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  const script = path.join(root, 'scripts', 'soak-browser-waits.sh');
  fs.copyFileSync(SOAK_SCRIPT, script);
  fs.chmodSync(script, 0o755);
  return { root, script };
}

/** Write an executable mock runner into the sandbox and return its path. */
function mockRunner(root: string, name: string, body: string[]): string {
  const runner = path.join(root, name);
  fs.writeFileSync(runner, ['#!/usr/bin/env bash', ...body, ''].join('\n'));
  fs.chmodSync(runner, 0o755);
  return runner;
}

/** The single summary file the script wrote into `<root>/results/`. */
function readSummary(root: string, runs: number): string {
  const dir = path.join(root, 'results');
  const files = fs.readdirSync(dir).filter((name) => /^soak-browser-waits-.*\.md$/.test(name));
  expect(files).toHaveLength(1);
  const markdown = fs.readFileSync(path.join(dir, files[0]), 'utf8');
  // Sanity: the summary reports the requested run count and one row per run.
  expect(markdown).toContain(`- Runs: ${runs} `);
  expect(markdown.split('\n').filter((line) => /^\| \d+ \|/.test(line))).toHaveLength(runs);
  return markdown;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()!;
    // Defensive: never leave imposed load behind if a test failed mid-run.
    spawnSync('bash', ['-c', 'pkill -f "yes >/dev/null" 2>/dev/null || true']);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('scripts/soak-browser-waits.sh harness', () => {
  it('runs N mock passes, records a PASS row each and exits 0', () => {
    const { root, script } = sandbox();
    const runner = mockRunner(root, 'mock-pass.sh', ['sleep 0.05', 'exit 0']);

    const result = spawnSync('bash', [script, '--runs', '4'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, SOAK_RUNNER_CMD: `bash ${runner}` },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('all 4 runs passed');
    const markdown = readSummary(root, 4);
    for (const row of markdown.split('\n').filter((line) => /^\| \d+ \|/.test(line))) {
      expect(row).toContain('| PASS |');
    }
    expect(markdown).toContain('Result: **all 4 runs passed.**');
  });

  it('fails fast: a failure on run 3 of 7 aborts, prints that output, exits 1', () => {
    const { root, script } = sandbox();
    const counter = path.join(root, 'counter');
    const runner = mockRunner(root, 'mock-fail-on-3.sh', [
      'n=$(( $(cat "$COUNTER" 2>/dev/null || echo 0) + 1 ))',
      'echo "$n" > "$COUNTER"',
      'echo "mock run $n"',
      'if [ "$n" -eq 3 ]; then',
      '  echo "mock browser failure: Timed out waiting for turn to advance"',
      '  exit 1',
      'fi',
      'exit 0',
    ]);

    const result = spawnSync('bash', [script, '--runs', '7'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, SOAK_RUNNER_CMD: `bash ${runner}`, COUNTER: counter },
    });

    // Fail-fast: the run loop aborted, so runs 4..7 never executed.
    expect(fs.readFileSync(counter, 'utf8').trim()).toBe('3');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('run 3/7 FAILED');
    // The failing run's full output is surfaced for triage...
    expect(result.stdout).toContain('--- output from failing run (');
    expect(result.stdout).toContain('mock browser failure: Timed out waiting for turn to advance');
    // ...and its log is retained rather than deleted.
    const logs = fs.readdirSync(path.join(root, 'results')).filter((name) => name.includes('-run-3.log'));
    expect(logs).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, 'results', logs[0]), 'utf8')).toContain('mock browser failure');

    const markdown = fs.readFileSync(
      path.join(root, 'results', fs.readdirSync(path.join(root, 'results')).find((n) => n.endsWith('.md'))!),
      'utf8',
    );
    expect(markdown).toContain('Result: **FAILED** on run 3');
    expect(markdown).toContain('| 3 | FAIL |');
    // Rows for runs that never executed are marked unknown, not claimed PASS.
    expect(markdown).toContain('| 4 | ? |');
  });

  it('--load: imposes burners while running and tears them down after', () => {
    const { root, script } = sandbox();
    // The real soak burns $(nproc) cores; that is network of the evidence job
    // (soak/soak-load), not this unit test — a 16-core spike inside the
    // parallel unit pool would starve sibling workers and self-induce vitest
    // RPC timeouts. The override still exercises the same start/stop/trap/summary
    // mechanism with 2 burners and records real load averages.
    const runner = mockRunner(root, 'mock-check-burners.sh', [
      'expected=2',
      'alive=$(pgrep -x yes | wc -l)',
      'echo "burners-alive=$alive expected=$expected"',
      '[ "$alive" -ge "$expected" ] || exit 1',
      'exit 0',
    ]);

    const before = burnerCount();
    const result = spawnSync('bash', [script, '--runs', '1', '--load'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        SOAK_RUNNER_CMD: `bash ${runner}`,
        SOAK_BURNERS: '2',
      },
    });
    const after = burnerCount();

    // Exit 0 only if the mock's >=2-burners check passed.
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('imposing load: 2 CPU burner(s)');
    expect(result.stdout).toContain('run 1/1 pass');
    expect(result.stdout).not.toContain('FAILED');
    // EXIT trap: no burner survives the soak (count returns to baseline).
    expect(after).toBeLessThanOrEqual(before);

    const markdown = readSummary(root, 1);
    expect(markdown).toContain('- CPU burners: 2');
    expect(markdown).toContain('- Mode: load');
    expect(markdown).toMatch(/- Load average before: [\d.]+, during-peak: [\d.]+, after: [\d.]+/);
    // A load average is actually recorded (never the 0.00 sentinel).
    expect(markdown).not.toContain('during-peak: 0.00');
  });
});
