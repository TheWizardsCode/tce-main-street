/**
 * Engine-checkout preflight tests (MS-0MVO26G5H0054SNV).
 *
 * Every test invocation in this repo composes whatever `./core` happens to
 * be checked out; worktrees created by the implement tooling check out the
 * gitlink recorded by the commit they were forked from, which can silently
 * predate the engine pin in `configs/engine-pin.json`. A green suite can
 * then never have seen the pinned engine code (observed in this repo:
 * worktree `core` checkouts at `e4d0e10b` / `8c602332` while the pin is
 * `9ee194e0`).
 *
 * These tests exercise `tests/tooling/engine-checkout-precheck.ts` —
 * wired as the Vitest root `test.globalSetup` and as `npm run engine:check`
 * — against network-free temp-git fixtures in the style of
 * `tests/main-street/engine-submodule-sync.test.ts`: an engine repo on
 * `dev` plus a game repo with a `core` submodule and a pin file
 * (`GIT_ALLOW_PROTOCOL=file`, local remotes only).
 *
 * @see tests/main-street/engine-submodule-sync.test.ts — the fixture pattern.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  readPin,
  resolveShaFull,
  runGit,
  submoduleIsDirty,
} from '@core-scripts/engine-sync.mjs';
import {
  checkEngineCheckout,
  runEngineCheckoutPreflight,
} from '../../tests/tooling/engine-checkout-precheck';
import type { EngineCheckoutDeps } from '../../tests/tooling/engine-checkout-precheck';

/** The real engine-sync API, injected so the fixture exercises the shared
 * git/pin primitives the preflight reuses in production. */
const REAL_DEPS: EngineCheckoutDeps = { readPin, resolveShaFull, runGit, submoduleIsDirty };

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

interface GameFixture {
  game: string;
  engine: string;
  core: string;
  pinPath: string;
  /** Engine commit the game was initialised with (and pinned to). */
  initSha: string;
  setPin: (sha: string) => void;
  /** Advance the engine dev branch; returns the new tip SHA. */
  advanceEngine: () => string;
  /** Fetch the engine's latest commits into the core clone (local remote). */
  fetchIntoCore: () => void;
  /** Commit a new local commit in core, a descendant of the current HEAD. */
  commitAheadInCore: () => string;
  /** Un-initialise the core submodule (removes the checkout). */
  deinitCore: () => void;
}

/**
 * Fixture mirroring this repo's real layout: a game repo with a `core`
 * submodule (engine on `dev`) pinned to the engine commit it was initialised
 * from. Network-free (local remotes via `GIT_ALLOW_PROTOCOL=file`).
 */
function makeGame(): GameFixture {
  const root = tempRoot('ms-engine-precheck-');
  const engine = path.join(root, 'engine');
  const game = path.join(root, 'game');
  const core = path.join(game, 'core');

  for (const dir of [engine, game]) fs.mkdirSync(dir, { recursive: true });

  git(engine, ['init', '-q', '-b', 'dev']);
  git(engine, ['config', 'user.email', 'fixture@test']);
  git(engine, ['config', 'user.name', 'Fixture']);
  fs.writeFileSync(path.join(engine, 'version.txt'), 'v1\n');
  git(engine, ['add', 'version.txt']);
  git(engine, ['commit', '-q', '-m', 'v1']);
  git(engine, ['tag', 'v1']);
  const initSha = git(engine, ['rev-parse', 'HEAD']).stdout.split(/\s+/)[0];

  git(game, ['init', '-q', '-b', 'main']);
  git(game, ['config', 'user.email', 'fixture@test']);
  git(game, ['config', 'user.name', 'Fixture']);
  const add = git(game, ['-c', 'protocol.file.allow=always', 'submodule', 'add', engine, 'core']);
  if (!add.ok) throw new Error(`fixture submodule add failed: ${add.stderr}`);
  git(game, ['config', '-f', '.gitmodules', 'submodule.core.branch', 'dev']);
  git(game, ['add', '.gitmodules', 'core']);
  git(game, ['commit', '-q', '-m', 'init']);

  const pinPath = path.join(game, 'configs', 'engine-pin.json');
  fs.mkdirSync(path.dirname(pinPath), { recursive: true });
  fs.writeFileSync(pinPath, JSON.stringify({ sha: initSha }));

  return {
    game,
    engine,
    core,
    pinPath,
    initSha,
    setPin: (sha) => fs.writeFileSync(pinPath, JSON.stringify({ sha })),
    advanceEngine: () => {
      fs.appendFileSync(path.join(engine, 'version.txt'), `v${Date.now()}\n`);
      git(engine, ['add', 'version.txt']);
      git(engine, ['commit', '-q', '-m', 'advance']);
      return git(engine, ['rev-parse', 'HEAD']).stdout.split(/\s+/)[0];
    },
    fetchIntoCore: () => {
      const res = git(core, ['-c', 'protocol.file.allow=always', 'fetch', 'origin']);
      if (!res.ok) throw new Error(`fixture fetch into core failed: ${res.stderr}`);
    },
    commitAheadInCore: () => {
      git(core, ['checkout', '-q', '-b', 'local-dev']);
      fs.appendFileSync(path.join(core, 'version.txt'), 'local\n');
      git(core, ['add', 'version.txt']);
      git(core, ['commit', '-q', '-m', 'local ahead']);
      return git(core, ['rev-parse', 'HEAD']).stdout.split(/\s+/)[0];
    },
    deinitCore: () => {
      const res = git(game, ['submodule', 'deinit', '-f', 'core']);
      if (!res.ok) throw new Error(`fixture deinit failed: ${res.stderr}`);
    },
  };
}

describe('checkEngineCheckout — pass paths (AC1/AC4)', () => {
  it('passes when ./core is exactly the pin', async () => {
    const f = makeGame();
    const result = await checkEngineCheckout({ repoRoot: f.game, deps: REAL_DEPS });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('at-pin');
    expect(result.composedSha).toBe(f.initSha);
    expect(result.pinSha).toBe(f.initSha);
    expect(result.dirty).toBe(false);
    expect(result.message).toContain('composed core@');
    expect(result.message).toContain('pin ');
  });

  it('passes when ./core is ahead of the pin (the post-engine:sync dev head)', async () => {
    const f = makeGame();
    const ahead = f.commitAheadInCore();
    const result = await checkEngineCheckout({ repoRoot: f.game, deps: REAL_DEPS });

    expect(result.ok).toBe(true);
    expect(result.reason).toBe('ahead-of-pin');
    expect(result.composedSha).toBe(ahead);
    // git describe identifies the composed engine when a tag is reachable.
    expect(result.describe).toMatch(/^v1-/);
    expect(result.message).toContain('ahead of pin');
    expect(result.message).toContain('v1-');
  });

  it('reports a dirty ./core loudly without failing (composition stays identifiable)', async () => {
    const f = makeGame();
    fs.appendFileSync(path.join(f.core, 'version.txt'), 'wip\n');
    const result = await checkEngineCheckout({ repoRoot: f.game, deps: REAL_DEPS });

    expect(result.ok).toBe(true);
    expect(result.dirty).toBe(true);
    expect(result.message).toContain('uncommitted changes');
    expect(result.message).toContain(f.initSha.slice(0, 7));
  });
});

describe('checkEngineCheckout — fail paths (AC1/AC4)', () => {
  it('fails when ./core is behind the pin, naming both SHAs and the remediation', async () => {
    const f = makeGame();
    const newPin = f.advanceEngine();
    f.setPin(newPin);
    f.fetchIntoCore();
    const result = await checkEngineCheckout({ repoRoot: f.game, deps: REAL_DEPS });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('behind-pin');
    expect(result.pinSha).toBe(newPin);
    expect(result.message).toContain('BEHIND');
    expect(result.message).toContain(f.initSha.slice(0, 7)); // composed SHA named
    expect(result.message).toContain(newPin.slice(0, 7)); // pin SHA named
    expect(result.message).toContain('npm run engine:sync');
  });

  it('fails when the pin commit is absent from the local ./core clone', async () => {
    const f = makeGame();
    const newPin = f.advanceEngine();
    f.setPin(newPin); // never fetched into the core clone
    const result = await checkEngineCheckout({ repoRoot: f.game, deps: REAL_DEPS });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('pin-missing');
    expect(result.pinSha).toBeNull();
    expect(result.message).toContain('not present in this ./core clone');
    expect(result.message).toContain(newPin.slice(0, 7)); // raw pin SHA still named
    expect(result.message).toContain('npm run engine:sync');
  });

  it('fails on a diverged checkout', async () => {
    const f = makeGame();
    f.commitAheadInCore(); // local tip, a descendant of the original commit
    const newPin = f.advanceEngine();
    f.setPin(newPin);
    f.fetchIntoCore(); // pins an unrelated engine commit
    const result = await checkEngineCheckout({ repoRoot: f.game, deps: REAL_DEPS });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('diverged');
    expect(result.message).toContain('DIVERGED');
  });

  it('fails when ./core is uninitialised', async () => {
    const f = makeGame();
    f.deinitCore();
    const result = await checkEngineCheckout({ repoRoot: f.game, deps: REAL_DEPS });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('core-uninitialised');
    expect(result.message).toContain('./core');
    expect(result.message).toContain('npm run engine:sync');
  });

  it('reports an uninitialised checkout when the engine tooling is missing and no deps are injected', async () => {
    const f = makeGame();
    f.deinitCore();
    // No deps → the default loader must degrade to the precheck's own message
    // instead of dying with an import/resolver error.
    const result = await checkEngineCheckout({ repoRoot: f.game });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('core-uninitialised');
    expect(result.message).toContain('npm run engine:sync');
  });

  it('fails when the pin file is unreadable', async () => {
    const f = makeGame();
    fs.writeFileSync(f.pinPath, '{"sha": "nope"}');
    const result = await checkEngineCheckout({ repoRoot: f.game, deps: REAL_DEPS });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('pin-unreadable');
    expect(result.message).toContain('configs/engine-pin.json could not be read');
  });
});

describe('ENGINE_CHECKOUT_CHECK bypass (AC1)', () => {
  /** A fixture whose core is behind the pin (would fail unbypassed). */
  function behindFixture(): GameFixture {
    const f = makeGame();
    const newPin = f.advanceEngine();
    f.setPin(newPin);
    f.fetchIntoCore();
    return f;
  }

  it('warn downgrades a failure to a passing result and logs every use', async () => {
    const f = behindFixture();
    const env = { ENGINE_CHECKOUT_CHECK: 'warn' };
    const result = await checkEngineCheckout({ repoRoot: f.game, env, deps: REAL_DEPS });

    expect(result.ok).toBe(true);
    expect(result.bypass).toBe('warn');
    expect(result.message).toContain('ENGINE_CHECKOUT_CHECK=warn');

    const logger = vi.fn();
    const state = { reported: false };
    await runEngineCheckoutPreflight({ repoRoot: f.game, env, logger, state, deps: REAL_DEPS });
    await runEngineCheckoutPreflight({ repoRoot: f.game, env, logger, state, deps: REAL_DEPS });
    expect(logger).toHaveBeenCalledTimes(2); // logged every time it is used
    for (const call of logger.mock.calls) {
      expect(String(call[0])).toContain('ENGINE_CHECKOUT_CHECK=warn');
    }
  });

  it('off suppresses the failure', async () => {
    const f = behindFixture();
    const env = { ENGINE_CHECKOUT_CHECK: 'off' };
    const result = await checkEngineCheckout({ repoRoot: f.game, env, deps: REAL_DEPS });

    expect(result.ok).toBe(true);
    expect(result.bypass).toBe('off');
  });

  it('does not recognise an invalid value — the gate stays on', async () => {
    const f = behindFixture();
    const env = { ENGINE_CHECKOUT_CHECK: 'banana' };
    const result = await checkEngineCheckout({ repoRoot: f.game, env, deps: REAL_DEPS });

    expect(result.ok).toBe(false);
    expect(result.bypass).toBeNull();
    expect(result.message).toContain('not a recognised value');
  });
});

describe('composed-engine identity logging (AC2)', () => {
  it('logs the identity line at most once per process, across several preflight runs', async () => {
    const f = makeGame();
    const logger = vi.fn();
    const state = { reported: false };

    await runEngineCheckoutPreflight({ repoRoot: f.game, logger, state, deps: REAL_DEPS });
    await runEngineCheckoutPreflight({ repoRoot: f.game, logger, state, deps: REAL_DEPS });

    expect(logger).toHaveBeenCalledTimes(1);
    const line = String(logger.mock.calls[0][0]);
    // The composed engine identity (short SHA + describe tag) alongside the pin.
    expect(line).toContain('composed core@');
    expect(line).toContain('v1'); // describe tag
    expect(line).toContain('pin ');
    expect(line).toContain('OK');
  });

  it('a fresh process state reports again (each process gets its own line)', async () => {
    const f = makeGame();
    const logger = vi.fn();
    await runEngineCheckoutPreflight({
      repoRoot: f.game,
      logger,
      state: { reported: false },
      deps: REAL_DEPS,
    });
    await runEngineCheckoutPreflight({
      repoRoot: f.game,
      logger,
      state: { reported: true },
      deps: REAL_DEPS,
    });

    expect(logger).toHaveBeenCalledTimes(1);
  });

  it('throws on a genuine failure so the Vitest globalSetup aborts the run', async () => {
    const f = makeGame();
    const newPin = f.advanceEngine();
    f.setPin(newPin);
    f.fetchIntoCore();

    await expect(
      runEngineCheckoutPreflight({ repoRoot: f.game, deps: REAL_DEPS }),
    ).rejects.toThrow(/npm run engine:sync/);
  });
});
