/**
 * AC4 unit tests: `engine:sync` / `engine:verify` dirty-state guard and
 * pin-mismatch failure paths (MS-0MVCRGKZY007DIED).
 *
 * The npm scripts wrap the engine-owned `core/scripts/engine-sync.mjs`
 * (re-scaffolded into this repo's `.gitmodules`-tracked `core` submodule).
 * These tests exercise the real script through its exported API against
 * local temp-git fixtures (no network): a dirty `./core` must fail loudly
 * (never clobber), and a `configs/engine-pin.json` whose SHA differs from the
 * remote-resolved target must fail the release verify path.
 *
 * @see core/scripts/engine-sync.d.mts — the typed API contract.
 * @see core/tests/scripts/engine-sync.test.ts — the engine-side canonical suite.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EngineSyncError,
  readPin,
  resolveRemoteTarget,
  submoduleIsDirty,
  syncEngine,
  verifyEngine,
} from '@core-scripts/engine-sync.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const PIN_REL = path.join('configs', 'engine-pin.json');

const tempRoots: string[] = [];

function tempRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0' },
    windowsHide: true,
  });
  return {
    ok: res.status === 0,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  };
}

/**
 * Fixture mirroring this repo's real layout: a repo root with a `core`
 * submodule (engine on `dev`) and a configs/ engine pin. The submodule's
 * remote is a LOCAL path (allowed via GIT_ALLOW_PROTOCOL=file) so every test
 * is network-free.
 */
function makeGame(): {
  game: string;
  pinPath: string;
  devTip: () => string;
  advance: () => string;
  offBranchCommit: () => string;
} {
  const root = tempRoot('ms-engine-sync-');
  const engine = path.join(root, 'engine');
  const game = path.join(root, 'game');

  for (const dir of [engine, game]) fs.mkdirSync(dir, { recursive: true });

  // Engine repo, `dev` branch (mirrors Tableau-Card-Engine's active branch).
  git(engine, ['init', '-q', '-b', 'dev']);
  git(engine, ['config', 'user.email', 'fixture@test']);
  git(engine, ['config', 'user.name', 'Fixture']);
  fs.writeFileSync(path.join(engine, 'version.txt'), 'v1\n');
  git(engine, ['add', 'version.txt']);
  git(engine, ['commit', '-q', '-m', 'v1']);

  // Game repo with `core` submodule, .gitmodules branch = dev.
  git(game, ['init', '-q', '-b', 'main']);
  git(game, ['config', 'user.email', 'fixture@test']);
  git(game, ['config', 'user.name', 'Fixture']);
  const add = git(game, ['-c', 'protocol.file.allow=always', 'submodule', 'add', engine, 'core']);
  if (!add.ok) throw new Error(`fixture submodule add failed: ${add.stderr}`);
  git(game, ['config', '-f', '.gitmodules', 'submodule.core.branch', 'dev']);
  git(game, ['add', '.gitmodules', 'core']);
  git(game, ['commit', '-q', '-m', 'init']);

  const pinPath = path.join(game, PIN_REL);
  fs.mkdirSync(path.dirname(pinPath), { recursive: true });

  const devTip = (): string => git(engine, ['rev-parse', 'HEAD']).stdout.split(/\s+/)[0] ?? '';
  const advance = (): string => {
    fs.appendFileSync(path.join(engine, 'version.txt'), `v${Date.now()}\n`);
    git(engine, ['add', 'version.txt']);
    git(engine, ['commit', '-q', '-m', 'advance']);
    return devTip();
  };
  // A commit on a branch other than `dev` — foreign to the tracked branch.
  const offBranchCommit = (): string => {
    git(engine, ['checkout', '-q', '-b', 'other']);
    fs.appendFileSync(path.join(engine, 'version.txt'), `other${Date.now()}\n`);
    git(engine, ['add', 'version.txt']);
    git(engine, ['commit', '-q', '-m', 'foreign']);
    const sha = devTip();
    git(engine, ['checkout', '-q', 'dev']);
    return sha;
  };
  return { game, pinPath, devTip, advance, offBranchCommit };
}

describe('engine:sync — dirty-state guard (AC1/AC4)', () => {
  it('fails loudly when ./core has uncommitted changes and never clobbers', () => {
    const f = makeGame();
    const before = git(path.join(f.game, 'core'), ['rev-parse', 'HEAD']).stdout;
    fs.appendFileSync(path.join(f.game, 'core', 'version.txt'), 'wip\n');

    expect(submoduleIsDirty(f.game)).toBe(true);
    expect(() => syncEngine({ repoRoot: f.game })).toThrow(EngineSyncError);
    expect(() => syncEngine({ repoRoot: f.game })).toThrow(/uncommitted changes/);

    // The WIP is intact and the checkout did not move.
    expect(fs.readFileSync(path.join(f.game, 'core', 'version.txt'), 'utf-8')).toContain('wip');
    expect(git(path.join(f.game, 'core'), ['rev-parse', 'HEAD']).stdout).toBe(before);
  });

  it('follows the engine dev tip on a clean checkout', () => {
    const f = makeGame();
    const tip = f.advance();
    const res = syncEngine({ repoRoot: f.game });
    expect(res.updated).toBe(true);
    expect(res.to).toBe(tip);
    expect(git(path.join(f.game, 'core'), ['rev-parse', 'HEAD']).stdout).toBe(tip);
  });
});

describe('engine:verify — pin-mismatch failure path (AC2/AC4)', () => {
  it('fails loudly when the pinned SHA differs from the remote-resolved target', () => {
    const f = makeGame();
    const stale = f.devTip();
    f.advance();
    fs.writeFileSync(f.pinPath, JSON.stringify({ sha: stale }));

    // The pin differs from the current dev target → release verify must fail.
    const target = resolveRemoteTarget(f.game);
    expect(target).not.toBe(stale);
    expect(() => verifyEngine({ repoRoot: f.game })).toThrow(/PIN MISMATCH/);
  });

  it('checks out exactly the pinned SHA when it matches the remote target', () => {
    const f = makeGame();
    const tip = f.advance();
    fs.writeFileSync(f.pinPath, JSON.stringify({ sha: tip }));
    const res = verifyEngine({ repoRoot: f.game });
    expect(res.sha).toBe(tip);
    expect(git(path.join(f.game, 'core'), ['rev-parse', 'HEAD']).stdout).toBe(tip);
  });

  it('fails loudly on a dirty ./core even with a correct pin', () => {
    const f = makeGame();
    fs.writeFileSync(f.pinPath, JSON.stringify({ sha: f.devTip() }));
    fs.appendFileSync(path.join(f.game, 'core', 'version.txt'), 'wip\n');
    expect(() => verifyEngine({ repoRoot: f.game })).toThrow(/local modifications/);
  });

  it('requires a committed pin (configs/engine-pin.json)', () => {
    const f = makeGame();
    expect(() => readPin(f.game)).toThrow(/pin file not found/);
    fs.writeFileSync(f.pinPath, '{"sha": "not-a-sha"}');
    expect(() => readPin(f.game)).toThrow(EngineSyncError);
  });
});

describe('engine:sync — pin travels with the gitlink (policy, CG-0MVO268500071BPI)', () => {
  it('writes the pin to the new HEAD and stages it with the core gitlink when advancing', () => {
    const f = makeGame();
    fs.writeFileSync(f.pinPath, JSON.stringify({ sha: f.devTip() }));
    const tip = f.advance();
    const res = syncEngine({ repoRoot: f.game });
    expect(res.updated).toBe(true);
    expect(res.pinWritten).toBe(true);
    expect(readPin(f.game)).toBe(tip);
    // Both staged together — one commit can never record them divergent.
    const staged = git(f.game, ['diff', '--cached', '--name-only']).stdout.split('\n');
    expect(staged).toContain(PIN_REL);
    expect(staged).toContain('core');
    expect(git(f.game, ['ls-files', '-s', 'core']).stdout.split(/\s+/)[1]).toBe(tip);
  });

  it('leaves the pin byte-identical on a second (no-op) sync', () => {
    const f = makeGame();
    fs.writeFileSync(f.pinPath, JSON.stringify({ sha: f.devTip() }));
    f.advance();
    syncEngine({ repoRoot: f.game }); // advances + writes the pin
    const bytes = fs.readFileSync(f.pinPath, 'utf-8');
    const res = syncEngine({ repoRoot: f.game }); // no-op
    expect(res.updated).toBe(false);
    expect(res.pinWritten).toBe(false);
    expect(fs.readFileSync(f.pinPath, 'utf-8')).toBe(bytes);
  });

  it('leaves the pin untouched on the offline (remote-unreachable) fallback', () => {
    const f = makeGame();
    const tip = f.advance();
    fs.writeFileSync(f.pinPath, JSON.stringify({ sha: f.devTip() })); // pin == dev tip != checkout
    expect(readPin(f.game)).toBe(tip);
    git(path.join(f.game, 'core'), ['remote', 'set-url', 'origin', 'http://127.0.0.1:9/nowhere.git']);
    const bytes = fs.readFileSync(f.pinPath, 'utf-8');
    const res = syncEngine({ repoRoot: f.game });
    expect(res.warning).toMatch(/remote unreachable|WARNING/);
    expect(res.updated).toBe(false);
    expect(res.pinWritten).toBe(false);
    expect(fs.readFileSync(f.pinPath, 'utf-8')).toBe(bytes);
    expect(readPin(f.game)).toBe(tip);
  });

  it('never creates a pin for a repo that has none (no spurious file)', () => {
    const f = makeGame();
    const tip = f.advance();
    const res = syncEngine({ repoRoot: f.game });
    expect(res.updated).toBe(true);
    expect(res.pinWritten).toBe(false);
    expect(fs.existsSync(f.pinPath)).toBe(false);
    expect(git(f.game, ['diff', '--cached', '--name-only']).stdout).not.toContain('engine-pin.json');
    expect(tip).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('engine:verify — lag vs bad/foreign pin diagnostics (policy, CG-0MVO268500071BPI)', () => {
  it('diagnoses LAG: pin is an ancestor of the tracked tip by N commits — re-pin (pin and gitlink travel together)', () => {
    const f = makeGame();
    const oldTip = f.devTip();
    f.advance();
    f.advance(); // the tracked tip is now 2 commits ahead of the pin
    fs.writeFileSync(f.pinPath, JSON.stringify({ sha: oldTip }));
    expect(() => verifyEngine({ repoRoot: f.game })).toThrow(EngineSyncError);
    expect(() => verifyEngine({ repoRoot: f.game })).toThrow(
      /is an ancestor of the tracked dev tip by 2 commit/,
    );
    expect(() => verifyEngine({ repoRoot: f.game })).toThrow(/Re-pin: .* travel together/);
  });

  it('diagnoses a BAD/FOREIGN pin: it does not resolve on the tracked branch', () => {
    const f = makeGame();
    const foreign = f.offBranchCommit();
    expect(foreign).toMatch(/^[0-9a-f]{40}$/);
    fs.writeFileSync(f.pinPath, JSON.stringify({ sha: foreign }));
    // The pin must not be an ancestor of the tracked tip, and must not resolve
    // on the tracked branch → the bad-pin diagnosis, still a hard failure.
    expect(() => verifyEngine({ repoRoot: f.game })).toThrow(EngineSyncError);
    expect(() => verifyEngine({ repoRoot: f.game })).toThrow(
      /does not resolve on the tracked branch dev/,
    );
    expect(() => verifyEngine({ repoRoot: f.game })).toThrow(/bad or foreign pin/);
  });
});

describe('release pin contract (AC3)', () => {
  it('the engine pin file holds a single `sha` field — nothing extra', () => {
    const pinPath = path.join(REPO_ROOT, PIN_REL);
    const pin = JSON.parse(fs.readFileSync(pinPath, 'utf-8')) as Record<string, unknown>;
    expect(Object.keys(pin)).toEqual(['sha']);
    expect(typeof pin.sha).toBe('string');
    expect(pin.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('matches the committed ./core submodule pointer being shipped with the pin', () => {
    // The pin is written by the release process alongside the version bump;
    // it must equal the engine commit this repo pins — the gitlink recorded
    // in the index with this change (compared after commit by the engine
    // suite; here the index-level pointer is the value being shipped).
    const pinPath = path.join(REPO_ROOT, PIN_REL);
    const pin = JSON.parse(fs.readFileSync(pinPath, 'utf-8')) as { sha: string };
    // git ls-files -s <path> → <mode> <sha> <stage>	<path>; take the gitlink.
    const indexEntry = git(REPO_ROOT, ['ls-files', '-s', 'core']).stdout;
    const resolved = indexEntry.split(/\s+/)[1] ?? '';
    expect(resolved).toBe(pin.sha);
  });
});
