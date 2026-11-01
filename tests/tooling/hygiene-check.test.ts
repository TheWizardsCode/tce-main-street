/**
 * Logic tests for `scripts/hygiene_check.sh` (MS-0MVS0FNLH003VBMW).
 *
 * The script is the committed, **read-only** half of the host-pressure
 * remediation: it reports orphaned worktree directories, swap/memory pressure
 * and orphaned dev servers, and never prunes or kills anything. Its risky part
 * is the *classification* — which directory is an inert leftover, which needs a
 * human, which dev-server process belongs to a dead worktree — so that is what
 * these tests drive, through the script's documented fixture seams
 * (`HYGIENE_*_FILE`, `--proc-root`):
 *
 * - registered-vs-orphaned inventory, with `safe-to-prune` (empty or a cwd
 *   placeholder only) distinguished from `needs-review` (anything else);
 * - `in_use` detection for an orphaned directory that a live process still has
 *   as its cwd — removing that directory would break that shell;
 * - memory/swap pressure grading (ok / warning / critical);
 * - dev-server ownership (main checkout, registered worktree, orphaned
 *   worktree, stale path), the staleness flag, and the exclusion of `vitest` /
 *   `vite-node` runs (they are test runners, not servers);
 * - port-listener reporting for the dev (3000) and preview (4173) ports;
 * - the read-only guarantee: after a run the inspected tree is byte-identical
 *   (nothing pruned, no placeholder removed).
 *
 * @module tests/tooling/hygiene-check
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'hygiene_check.sh');

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const dir of temporaryDirectories.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(dir);
  return dir;
}

/** A fixture checkout: repo root with a worktrees dir and registered entries. */
interface Fixture {
  root: string;
  worktrees: string;
  proc: string;
  files: Record<string, string>;
}

function fixture(
  directories: string[],
  files: Record<string, string> = {},
): Fixture {
  const base = tempDir('hygiene-check-');
  const root = path.join(base, 'repo');
  const worktrees = path.join(root, '.worklog', 'worktrees');
  const proc = path.join(base, 'proc');
  fs.mkdirSync(worktrees, { recursive: true });
  fs.mkdirSync(proc, { recursive: true });
  for (const name of directories) {
    fs.mkdirSync(path.join(worktrees, name), { recursive: true });
  }
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(worktrees, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return { root, worktrees, proc, files: {} };
}

/** Porcelain `git worktree list` output registering the given worktree dirs. */
function worktreeList(root: string, registered: string[]): string {
  const entries = [
    `worktree ${root}\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/dev\n`,
    ...registered.map(
      (name) =>
        `worktree ${path.join(root, '.worklog', 'worktrees', name)}\n` +
        `HEAD 2222222222222222222222222222222222222222\n` +
        `branch refs/heads/wl-${name}\n`,
    ),
  ];
  return `${entries.join('\n')}\n`;
}

/** `free -m` output with the given swap usage. */
function freeOutput(swapUsedMb: number, memAvailableMb = 17_472): string {
  const memUsed = 30_990 - memAvailableMb;
  return [
    '               total        used        free      shared  buff/cache   available',
    `Mem:           30990       ${memUsed}        7671         297       10520       ${memAvailableMb}`,
    `Swap:           8191       ${swapUsedMb}        ${8191 - swapUsedMb}`,
  ].join('\n');
}

const SWAPON_OUTPUT = [
  'NAME      TYPE SIZE USED PRIO',
  '/swap.img file   8G 1.4M   -1',
].join('\n');

/** One `ps` row: every fixture row pins pid, age (s), RSS (KB) and args. */
function psRow(pid: number, ageSeconds: number, rssKb: number, args: string): string {
  return `${pid}\t${ageSeconds}\t${rssKb}\t${args}`;
}

/** One `ss -ltn` row for a listening socket on the given port. */
function ssRow(port: number): string {
  return `LISTEN 0      511          0.0.0.0:${port}         0.0.0.0:*`;
}

interface RunOptions {
  worktreeList?: string;
  free?: string;
  swapon?: string;
  ps?: string;
  ss?: string;
}

function runScript(fx: Fixture, options: RunOptions, extraArgs: string[] = []) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HYGIENE_WORKTREE_LIST_FILE: writeInput(fx, 'worktree-list', options.worktreeList ?? ''),
    HYGIENE_FREE_FILE: writeInput(fx, 'free', options.free ?? freeOutput(1)),
    HYGIENE_SWAPON_FILE: writeInput(fx, 'swapon', options.swapon ?? SWAPON_OUTPUT),
    HYGIENE_PS_FILE: writeInput(fx, 'ps', options.ps ?? ''),
    HYGIENE_SS_FILE: writeInput(fx, 'ss', options.ss ?? ''),
  };
  const result = spawnSync(
    'bash',
    [SCRIPT, '--repo-root', fx.root, '--proc-root', fx.proc, '--json', ...extraArgs],
    { encoding: 'utf8', env },
  );
  if (result.status !== 0) {
    throw new Error(`hygiene_check.sh failed (${result.status}): ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as {
    worktrees: {
      registered_count: number;
      directory_count: number;
      orphaned_count: number;
      safe_to_prune_count: number;
      needs_review_count: number;
      registered: { path: string }[];
      orphaned: {
        name: string;
        classification: string;
        entries: string[];
        in_use: boolean;
        in_use_pids: string[];
      }[];
    };
    memory: { swap_used_pct: number; pressure: string; mem_available_mb: number };
    dev_servers: {
      port_listeners: { port: number; listening: boolean }[];
      processes: {
        pid: number;
        age_s: number;
        rss_mb: number;
        cwd: string;
        kind: string;
        owner: string;
        stale: boolean;
      }[];
      process_count: number;
      orphaned_count: number;
      stale_count: number;
    };
    warnings: string[];
  };
}

/** Write one fixture input file into the temp tree (never into the checkout). */
function writeInput(fx: Fixture, name: string, contents: string): string {
  const target = path.join(path.dirname(fx.proc), `${name}.txt`);
  fs.writeFileSync(target, contents);
  return target;
}

/** A live process in the fake procfs: `<pid>/cwd` symlink to `cwd`. */
function addProcess(fx: Fixture, pid: number, cwd: string): void {
  const dir = path.join(fx.proc, String(pid));
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(cwd, path.join(dir, 'cwd'));
}

/** Every path (relative) under `root` — used to prove the script mutates nothing. */
function snapshot(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      found.push(path.relative(root, full) + (entry.isDirectory() ? '/' : ''));
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return found.sort();
}

describe('worktree inventory: registered vs orphaned classification', () => {
  it('separates safe-to-prune leftovers from directories a human must review', () => {
    const fx = fixture(
      [
        'registered-a',
        'orphan-empty',
        'orphan-placeholder',
        'orphan-stale-checkout',
      ],
      {
        'orphan-placeholder/.keep': 'placeholder to restore shell cwd\n',
        'orphan-stale-checkout/.git': 'gitdir: /gone/.git/worktrees/x\n',
        'orphan-stale-checkout/src/app.ts': '// stale but real work\n',
      },
    );

    const report = runScript(fx, {
      worktreeList: worktreeList(fx.root, ['registered-a']),
    });

    // main checkout + registered-a; only the three leftovers are orphaned.
    expect(report.worktrees.registered_count).toBe(2);
    expect(report.worktrees.directory_count).toBe(4);
    expect(report.worktrees.orphaned_count).toBe(3);
    expect(
      report.worktrees.registered.map((entry) => path.basename(entry.path)),
    ).toEqual(['repo', 'registered-a']);

    const byName = Object.fromEntries(
      report.worktrees.orphaned.map((entry) => [entry.name, entry]),
    );
    expect(byName['orphan-empty'].classification).toBe('safe-to-prune');
    expect(byName['orphan-placeholder'].classification).toBe('safe-to-prune');
    expect(byName['orphan-placeholder'].entries).toEqual(['.keep']);
    expect(byName['orphan-stale-checkout'].classification).toBe('needs-review');
    expect(byName['orphan-stale-checkout'].entries).toEqual(['.git', 'src']);
    expect(report.worktrees.safe_to_prune_count).toBe(2);
    expect(report.worktrees.needs_review_count).toBe(1);
  });

  it('flags an orphaned directory a live process is sitting in as in_use', () => {
    const fx = fixture(['orphan-in-use', 'orphan-idle'], {
      'orphan-in-use/.keep': 'x\n',
    });
    // One shell in the directory itself, one deeper inside a subdirectory:
    // both pin the top-level candidate and must be reported.
    addProcess(fx, 4321, path.join(fx.worktrees, 'orphan-in-use'));
    addProcess(fx, 8765, path.join(fx.worktrees, 'orphan-in-use', 'src', 'deep'));

    const report = runScript(fx, { worktreeList: worktreeList(fx.root, []) });
    const byName = Object.fromEntries(
      report.worktrees.orphaned.map((entry) => [entry.name, entry]),
    );

    expect(byName['orphan-in-use'].in_use).toBe(true);
    expect(byName['orphan-in-use'].in_use_pids).toEqual(['4321', '8765']); // sorted numerically
    expect(byName['orphan-idle'].in_use).toBe(false);
    expect(
      report.warnings.some((warning) => warning.includes('do not remove')),
    ).toBe(true);
  });

  it('never prunes, deletes or otherwise mutates the inspected tree', () => {
    const fx = fixture(['orphan-empty', 'orphan-placeholder'], {
      'orphan-placeholder/.keep': 'keep me\n',
    });
    const before = snapshot(fx.root);

    runScript(fx, {
      worktreeList: worktreeList(fx.root, []),
      // A critical-pressure, orphaned-server report must still not touch the tree.
      free: freeOutput(8_180),
      ps: psRow(999, 10_000, 500_000, `${path.join(fx.worktrees, 'orphan-empty', 'node_modules/.bin/vite')} --host`),
    });

    expect(snapshot(fx.root)).toEqual(before);
  });
});

describe('memory / swap pressure grading', () => {
  it.each([
    { swapUsedMb: 1, expected: 'ok' },
    { swapUsedMb: 5_000, expected: 'warning' },
    { swapUsedMb: 8_100, expected: 'critical' },
  ])(
    'grades $swapUsedMb MB of 8191 MB swap as $expected',
    ({ swapUsedMb, expected }) => {
      const fx = fixture([]);
      const report = runScript(fx, {
        worktreeList: worktreeList(fx.root, []),
        free: freeOutput(swapUsedMb),
      });

      expect(report.memory.pressure).toBe(expected);
      expect(report.memory.swap_used_pct).toBe(
        Math.floor((swapUsedMb * 100) / 8191),
      );
    },
  );

  it('grades exhausted RAM headroom as critical even when swap is unused', () => {
    const fx = fixture([]);
    const report = runScript(fx, {
      worktreeList: worktreeList(fx.root, []),
      // 300 MB available of 30 990 MB ≈ 0 %, well under the 5 % bar.
      free: freeOutput(0, 300),
    });

    expect(report.memory.pressure).toBe('critical');
  });
});

describe('dev-server inventory', () => {
  function serverFixture(): Fixture {
    return fixture(['registered-a', 'orphan-worktree'], {
      'orphan-worktree/.keep': 'x\n',
    });
  }

  it('attributes each vite server to its checkout and excludes test runners', () => {
    const fx = serverFixture();
    addProcess(fx, 100, fx.root);
    addProcess(fx, 200, path.join(fx.worktrees, 'registered-a'));
    addProcess(fx, 300, path.join(fx.worktrees, 'orphan-worktree'));
    addProcess(fx, 400, path.join(fx.root, 'deleted-worktree'));

    const report = runScript(fx, {
      worktreeList: worktreeList(fx.root, ['registered-a']),
      ps: [
        psRow(100, 60, 230_000, 'node /repo/node_modules/.bin/vite --host'),
        psRow(200, 3_600, 250_000, 'node /repo/node_modules/.bin/vite --host'),
        psRow(300, 60, 240_000, 'node /repo/node_modules/.bin/vite --host'),
        psRow(400, 60, 100_000, 'node /repo/node_modules/.bin/vite preview'),
        // Test runners are not servers.
        psRow(500, 60, 900_000, 'node /repo/node_modules/.bin/vitest run --project unit'),
        psRow(600, 60, 900_000, 'node /repo/node_modules/.bin/vite-node src/cli.ts'),
        // The `sh -c`/npm wrapper is the server's parent shell, not reported.
        psRow(700, 60, 4_000, 'sh -c vite --host'),
      ].join('\n'),
    });

    expect(report.dev_servers.process_count).toBe(4);
    const byPid = Object.fromEntries(
      report.dev_servers.processes.map((entry) => [entry.pid, entry]),
    );
    expect(Object.keys(byPid).sort()).toEqual(['100', '200', '300', '400']);
    expect(byPid[100].owner).toBe('main-checkout');
    expect(byPid[100].rss_mb).toBe(224);
    expect(byPid[200].owner).toBe('registered-worktree');
    expect(byPid[300].owner).toBe('orphaned-worktree');
    expect(byPid[300].cwd).toBe(path.join(fx.worktrees, 'orphan-worktree'));
    expect(byPid[400].owner).toBe('stale-path');
    expect(byPid[400].kind).toBe('preview');

    // Two servers belong to no live checkout: the orphaned worktree and the
    // deleted path. That is the "orphaned dev server" the runbook asks about.
    expect(report.dev_servers.orphaned_count).toBe(2);
    expect(
      report.warnings.some((warning) => warning.includes('dev server process')),
    ).toBe(true);
  });

  it('flags long-lived servers past the staleness bar and honours --stale-server-hours', () => {
    const fx = fixture([]);
    addProcess(fx, 100, fx.root);
    const ps = psRow(100, 5 * 3_600, 230_000, 'node /repo/node_modules/.bin/vite --host');

    const defaulted = runScript(fx, {
      worktreeList: worktreeList(fx.root, []),
      ps,
    });
    expect(defaulted.dev_servers.stale_count).toBe(1);
    expect(defaulted.dev_servers.processes[0].stale).toBe(true);

    const relaxed = runScript(
      fx,
      { worktreeList: worktreeList(fx.root, []), ps },
      ['--stale-server-hours', '8'],
    );
    expect(relaxed.dev_servers.stale_count).toBe(0);
    expect(relaxed.dev_servers.processes[0].stale).toBe(false);
  });

  it('reports the dev and preview port listeners', () => {
    const fx = fixture([]);
    const report = runScript(fx, {
      worktreeList: worktreeList(fx.root, []),
      ss: [ssRow(3000), ssRow(4173)].join('\n'),
    });
    expect(report.dev_servers.port_listeners).toEqual([
      { port: 3000, listening: true },
      { port: 4173, listening: true },
    ]);
  });

  it('reports a closed dev port when nothing listens', () => {
    const fx = fixture([]);
    const report = runScript(fx, {
      worktreeList: worktreeList(fx.root, []),
      ss: ssRow(5173),
    });
    expect(report.dev_servers.port_listeners).toEqual([
      { port: 3000, listening: false },
      { port: 4173, listening: false },
    ]);
  });
});

describe('command line', () => {
  it('prints a human summary that names the counts and the read-only contract', () => {
    const fx = fixture(['orphan-empty'], {});
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HYGIENE_WORKTREE_LIST_FILE: writeInput(fx, 'worktree-list', worktreeList(fx.root, [])),
      HYGIENE_FREE_FILE: writeInput(fx, 'free', freeOutput(1)),
      HYGIENE_SWAPON_FILE: writeInput(fx, 'swapon', SWAPON_OUTPUT),
      HYGIENE_PS_FILE: writeInput(fx, 'ps', ''),
      HYGIENE_SS_FILE: writeInput(fx, 'ss', ''),
    };
    const result = spawnSync(
      'bash',
      [SCRIPT, '--repo-root', fx.root, '--proc-root', fx.proc],
      { encoding: 'utf8', env },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('orphaned (unregistered)  : 1');
    expect(result.stdout).toContain('grade : ok');
    expect(result.stdout).toContain('This script is read-only.');
  });

  it('rejects an unknown argument with a usage error', () => {
    const result = spawnSync('bash', [SCRIPT, '--nonsense'], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown argument');
  });
});
