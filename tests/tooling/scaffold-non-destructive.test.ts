/**
 * `npm run scaffold` is non-destructive (MS-0MVWGI4CB0055IT0).
 *
 * The engine-owned generator (`core/scripts/game-repo-scaffold.ts`) used to
 * overwrite every generated file on every run: on a clean `dev` tree one
 * `npm run scaffold` rewrote 11 files, including this repo's LOCAL SURGICAL
 * ADDITIONS in `vite.config.ts` and the drift guard's own `STALE_PREFIX`
 * (evidence: `MS-0MVVGUYYG004XXOB`). The generator now supports write gating
 * (`--only`, `--force`, `--dry-run`, per-file classification) and this repo's
 * `scaffold` script opts in to the narrow selection `--only main.ts --force`.
 *
 * This guard runs **the repo's own `scaffold` script arguments** (parsed out of
 * `package.json` and re-pointed at a temporary copy) against a throwaway copy
 * of the wiring files and asserts the contract by behaviour:
 *
 * 1. Only `main.ts` may be written — even when it has diverged from the
 *    template, which is what `--force` is for. Every protected wiring file
 *    (`package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`,
 *    `env.d.ts`, `configs/game.json`) and the representative `tests/` files
 *    must come out byte-identical.
 * 2. `--dry-run` reports the classification without writing a single byte.
 * 3. A second run is a no-op: `main.ts` classifies `unchanged` and the tree is
 *    byte-identical, so `npm run scaffold` twice leaves `git status` clean.
 *
 * The temp copy is outside the repository, so a regression can never damage the
 * live checkout; the real `./core` is passed as `--core-root` because the
 * generator reads its templates from there.
 *
 * @module tests/tooling/scaffold-non-destructive
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderMainTs } from '@core-scripts/game-repo-scaffold';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CORE_ROOT = path.join(PROJECT_ROOT, 'core');
const TSX_CLI = path.join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

/**
 * Files the scaffold must never write outside the selected `main.ts`, plus
 * representative `tests/` files: the generator's blanket
 * `example-games/<game>/` → `src/` rewrite used to edit those too
 * (`tests/main-street/docs-path-drift.test.ts` carries the stale prefix as a
 * forbidden-pattern constant, and `tests/tooling/phaser-single-copy.test.ts`
 * carries a `./core` comment the rewrite mangled).
 */
const PROTECTED_FILES = [
  'package.json',
  'vite.config.ts',
  'tsconfig.json',
  'index.html',
  'env.d.ts',
  'configs/game.json',
  'tests/tooling/phaser-single-copy.test.ts',
  'tests/main-street/docs-path-drift.test.ts',
];

/** The generated launcher: copied in, then deliberately diverged. */
const GENERATED_LAUNCHER = 'main.ts';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** The argv the repo's `scaffold` script invokes (`tsx <script> <args…>`). */
function scaffoldArgv(): { script: string; args: string[] } {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  const script = pkg.scripts?.scaffold;
  if (typeof script !== 'string') {
    throw new Error('package.json has no `scaffold` script to exercise');
  }
  const tokens = script.split(/\s+/).filter((token) => token !== '');
  if (tokens[0] !== 'tsx' || tokens.length < 2) {
    throw new Error(`unexpected scaffold script shape: ${script}`);
  }
  return { script: tokens[1], args: tokens.slice(2) };
}

/**
 * Re-point the script's own arguments at a temporary checkout: the temp dir
 * becomes `--game-repo-root` and the real engine checkout becomes
 * `--core-root` (the templates are read from there).
 */
function retarget(args: string[], gameRepoRoot: string): string[] {
  const retargeted: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--game-repo-root') {
      retargeted.push(arg, gameRepoRoot);
      i += 1;
      continue;
    }
    if (arg === '--core-root') {
      retargeted.push(arg, CORE_ROOT);
      i += 1;
      continue;
    }
    retargeted.push(arg);
  }
  return retargeted;
}

interface ScaffoldRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run the repo's scaffold script against the temp copy, with extra flags. */
function runScaffold(gameRepoRoot: string, extraArgs: string[]): ScaffoldRun {
  const { script, args } = scaffoldArgv();
  const result = spawnSync(
    process.execPath,
    [TSX_CLI, path.resolve(PROJECT_ROOT, script), ...retarget(args, gameRepoRoot), ...extraArgs],
    { cwd: PROJECT_ROOT, encoding: 'utf8' },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: `${result.stderr ?? ''}${result.error ? String(result.error) : ''}`,
  };
}

/** Build a temp copy of the wiring files plus a deliberately diverged launcher. */
function createFixture(): { root: string; before: Map<string, string> } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-non-destructive-'));
  temporaryDirectories.push(root);

  const before = new Map<string, string>();
  for (const relativePath of PROTECTED_FILES) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(PROJECT_ROOT, relativePath), target);
    before.set(relativePath, fs.readFileSync(target, 'utf8'));
  }

  // A hand-edit that `--force` must overwrite: without `--force` a diverged
  // selected file classifies `skip-local`, so this is what distinguishes the
  // two halves of the contract.
  const divergedLauncher = `${renderMainTs()}\n// LOCAL DRIFT: the scaffold must overwrite this.\n`;
  fs.writeFileSync(path.join(root, GENERATED_LAUNCHER), divergedLauncher, 'utf8');

  return { root, before };
}

/**
 * Every file under `root`, relative path → content, for byte-level diffs.
 * Symlinks are recorded by target (never followed), so a side effect the
 * selection run must not perform still shows up as a change.
 */
function snapshotTree(root: string): Map<string, string> {
  const snapshot = new Map<string, string>();
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolute).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        snapshot.set(relativePath, `-> ${fs.readlinkSync(absolute)}`);
      } else if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        snapshot.set(relativePath, fs.readFileSync(absolute, 'utf8'));
      }
    }
  };
  walk(root);
  return snapshot;
}

interface ScaffoldFileReport {
  path: string;
  action: 'create' | 'update' | 'unchanged' | 'skip-local';
}

/** Parse the `--json` report the generator prints for a single `--game` run. */
function parseReport(run: ScaffoldRun): { files: ScaffoldFileReport[]; written: string[] } {
  try {
    return JSON.parse(run.stdout) as { files: ScaffoldFileReport[]; written: string[] };
  } catch {
    throw new Error(
      `scaffold did not emit a JSON report (exit ${run.status}):\n${run.stdout}\n${run.stderr}`,
    );
  }
}

describe('npm run scaffold — non-destructive by default (MS-0MVWGI4CB0055IT0)', () => {
  it('regenerates main.ts and leaves every protected wiring file byte-identical', () => {
    const { root, before } = createFixture();
    const treeBefore = snapshotTree(root);

    const run = runScaffold(root, []);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);

    // The selected launcher is regenerated — the divergence is gone.
    expect(fs.readFileSync(path.join(root, GENERATED_LAUNCHER), 'utf8')).toBe(renderMainTs());

    // Everything else is untouched, byte for byte.
    for (const [relativePath, contents] of before) {
      expect(fs.readFileSync(path.join(root, relativePath), 'utf8'), relativePath).toBe(contents);
    }

    // A selection run performs none of the full-run side effects.
    expect(fs.existsSync(path.join(root, 'core'))).toBe(false);

    // Only the launcher changed in the tree at all.
    const treeAfter = snapshotTree(root);
    const changed = [...treeAfter.keys()]
      .filter((key) => treeBefore.get(key) !== treeAfter.get(key))
      .sort();
    expect(changed).toEqual([GENERATED_LAUNCHER]);
  });

  it('classifies the diverged launcher as an update while everything else is skipped or unchanged', () => {
    const { root } = createFixture();

    const run = runScaffold(root, ['--json']);
    expect(run.status).toBe(0);

    const report = parseReport(run);
    expect(report.written.map((file) => path.basename(file))).toEqual([GENERATED_LAUNCHER]);

    const launcher = report.files.find((file) => file.path === GENERATED_LAUNCHER);
    expect(launcher?.action).toBe('update');

    for (const file of report.files) {
      if (file.path === GENERATED_LAUNCHER) continue;
      expect(['unchanged', 'skip-local'], file.path).toContain(file.action);
    }
  });

  it('writes nothing on --dry-run and reports the update it would make', () => {
    const { root } = createFixture();
    const treeBefore = snapshotTree(root);

    const run = runScaffold(root, ['--dry-run', '--json']);
    expect(run.status).toBe(0);

    const report = parseReport(run);
    const launcher = report.files.find((file) => file.path === GENERATED_LAUNCHER);
    expect(launcher?.action).toBe('update');
    expect(report.written).toEqual([]);

    // Not a single byte moved — the diverged launcher is still there.
    expect(snapshotTree(root)).toEqual(treeBefore);
    expect(fs.readFileSync(path.join(root, GENERATED_LAUNCHER), 'utf8')).toContain('LOCAL DRIFT');
  });

  it('is idempotent: a second run leaves the tree byte-identical', () => {
    const { root } = createFixture();

    expect(runScaffold(root, []).status).toBe(0);
    const afterFirstRun = snapshotTree(root);

    const second = runScaffold(root, ['--json']);
    expect(second.status).toBe(0);

    const report = parseReport(second);
    expect(report.written).toEqual([]);
    const launcher = report.files.find((file) => file.path === GENERATED_LAUNCHER);
    expect(launcher?.action).toBe('unchanged');

    expect(snapshotTree(root)).toEqual(afterFirstRun);
  });
});
