/**
 * The pinned engine's scaffold template must not emit the core-only
 * `scaffold:game` / `scaffold:games` scripts into a generated game repo
 * (MS-0MVSB5TYD000K5N6, parent MS-0MVO30VXS002A1Z0).
 *
 * `renderPackageJson` in `core/scripts/game-repo-scaffold.ts` inherits the core
 * checkout's whole `scripts` map. `core/package.json` legitimately declares both
 * keys (the core *does* own `scripts/game-repo-scaffold.ts`), so before the
 * engine-side filter they leaked into every generated game repo and died with a
 * module-not-found error — a game repo has no root `scripts/` tree (Option C).
 *
 * The engine fix exists only as a commit on the engine `dev` branch; this repo
 * sees it exclusively through the pinned `./core` gitlink. That makes this a
 * **composition** guard, not a duplicate of the engine-side unit test: it fails
 * whenever the pin regresses to an engine commit that predates the filter, so a
 * stale pin can never silently reintroduce the dead scripts.
 *
 * Two views of the same contract:
 *
 * 1. `renderPackageJson` (the pure renderer) over the **real** `./core`
 *    manifest — the key set a game repo would be given.
 * 2. The repo's own `npm run scaffold` generator, retargeted at a throwaway
 *    fixture checkout (`--only package.json`), so the contract is asserted by
 *    behaviour through the real CLI rather than by the renderer alone.
 *
 * The fixture is outside the repository: no re-scaffold ever touches the live
 * checkout (which would drop its locally-added scripts).
 *
 * @module tests/tooling/engine-scaffold-template
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderPackageJson } from '@core-scripts/game-repo-scaffold';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CORE_ROOT = path.join(PROJECT_ROOT, 'core');
const CORE_MANIFEST = path.join(CORE_ROOT, 'package.json');
const PACKAGE_JSON = path.join(PROJECT_ROOT, 'package.json');
const TSX_CLI = path.join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

/** The two core-only scripts the template must never emit. */
const CORE_ONLY_SCAFFOLD_SCRIPTS = ['scaffold:game', 'scaffold:games'] as const;

interface CoreManifestFixture {
  scripts?: Record<string, string>;
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** The core manifest this repo actually composes (the cached `./core` checkout). */
function readComposedCoreManifest(): CoreManifestFixture {
  return JSON.parse(fs.readFileSync(CORE_MANIFEST, 'utf8')) as CoreManifestFixture;
}

function renderScripts(manifest: CoreManifestFixture): Record<string, string> {
  const pkg = JSON.parse(
    renderPackageJson('main-street', manifest, './core'),
  ) as { scripts?: Record<string, string> };
  if (!pkg.scripts || typeof pkg.scripts !== 'object') {
    throw new Error('renderPackageJson emitted no `scripts` map');
  }
  return pkg.scripts;
}

/**
 * The repo's `scaffold` script (`tsx <engine script> --game … --core-root …`),
 * parsed out of `package.json` so the test exercises the same generator the
 * maintainers run.
 */
function repoScaffoldCommand(): { scriptPath: string; game: string } {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const command = pkg.scripts?.scaffold;
  if (typeof command !== 'string') {
    throw new Error('package.json declares no `scaffold` script to exercise');
  }
  const tokens = command.split(/\s+/).filter((token) => token !== '');
  if (tokens[0] !== 'tsx' || tokens.length < 2) {
    throw new Error(`unexpected scaffold script shape: ${command}`);
  }
  const gameIndex = tokens.indexOf('--game');
  const game = gameIndex === -1 ? undefined : tokens[gameIndex + 1];
  if (game === undefined) {
    throw new Error(`scaffold script names no --game: ${command}`);
  }
  return { scriptPath: path.resolve(PROJECT_ROOT, tokens[1] as string), game };
}

/**
 * Scaffold a throwaway fixture checkout with the pinned engine, regenerating
 * only its `package.json` (a full run would pull in the whole game tree, which
 * this contract does not need).
 */
function scaffoldFixturePackageJson(): Record<string, string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-engine-scaffold-'));
  temporaryDirectories.push(root);

  const { scriptPath, game } = repoScaffoldCommand();
  const run = spawnSync(
    process.execPath,
    [
      TSX_CLI,
      scriptPath,
      '--game',
      game,
      '--game-repo-root',
      root,
      '--core-root',
      CORE_ROOT,
      '--only',
      'package.json',
      '--json',
    ],
    { cwd: PROJECT_ROOT, encoding: 'utf8' },
  );

  if (run.status !== 0) {
    throw new Error(
      `scaffold exited ${run.status}:\n${run.stdout ?? ''}\n${run.stderr ?? ''}`,
    );
  }

  const generated = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  if (!generated.scripts || typeof generated.scripts !== 'object') {
    throw new Error('the scaffolded fixture declares no `scripts` map');
  }
  return generated.scripts;
}

describe('pinned engine scaffold template (MS-0MVSB5TYD000K5N6)', () => {
  it('drops the core-only scaffold:game/scaffold:games scripts from a rendered game manifest', () => {
    const manifest = readComposedCoreManifest();

    // Pre-condition, so the drop cannot pass vacuously: the composed core
    // manifest really does declare both keys (it owns the script file).
    for (const key of CORE_ONLY_SCAFFOLD_SCRIPTS) {
      expect(
        manifest.scripts?.[key],
        `composed ./core manifest no longer declares ${key}; revisit this guard`,
      ).toBeTypeOf('string');
    }

    const scripts = renderScripts(manifest);

    for (const key of CORE_ONLY_SCAFFOLD_SCRIPTS) {
      expect(scripts).not.toHaveProperty(key);
    }
    // The working entry point still travels into the game repo.
    expect(scripts.scaffold).toContain('./core/scripts/game-repo-scaffold.ts');
    // Other inherited toolchain scripts still pass through.
    expect(scripts['engine:sync']).toContain('./core/scripts/engine-sync.mjs');
  });

  it('regenerates a fixture package.json without the core-only scripts', () => {
    const scripts = scaffoldFixturePackageJson();

    for (const key of CORE_ONLY_SCAFFOLD_SCRIPTS) {
      expect(scripts).not.toHaveProperty(key);
    }
    // The fixture really was generated from the template: the game-repo entry
    // point and the inherited engine tooling are present.
    expect(scripts.scaffold).toBeTypeOf('string');
    expect(scripts.scaffold).toContain('scripts/game-repo-scaffold.ts');
    expect(scripts['engine:sync']).toBeTypeOf('string');
  });
});
