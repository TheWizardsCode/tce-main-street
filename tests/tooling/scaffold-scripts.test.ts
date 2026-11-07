/**
 * Scaffold npm scripts must be runnable (parent MS-0MVO30VXS002A1Z0,
 * child MS-0MVSAW76W003SOE2).
 *
 * The engine scaffold (`core/scripts/game-repo-scaffold.ts`) used to inherit the
 * core checkout's whole `scripts` map, so every generated game repo shipped
 * `scaffold:game` and `scaffold:games` pointing at `scripts/game-repo-scaffold.ts`
 * — a file that does **not** exist in a game repo (Option C: game repos have no
 * root `scripts/` tree; the scaffold lives in `./core/scripts/`). Both keys died
 * with a module-not-found error while the working `npm run scaffold` entry point
 * sat right beside them.
 *
 * This is a config-contract guard, in the same shape as
 * `tests/tooling/scaffold-non-destructive.test.ts` and
 * `tests/deploy/deploy-workflow.test.ts`: it pins the two broken keys out of
 * `package.json` and, more generally, asserts that **every** declared
 * `scaffold*` script resolves to a file that exists on disk. A future template
 * change (or a re-scaffold) that reintroduces a dead script therefore fails
 * here, at test time, instead of only when a maintainer runs the script.
 *
 * The positive and negative cases below share one helper, so the guard's teeth
 * are demonstrated rather than assumed: the fixture case proves the check
 * really does flag a dangling target.
 *
 * @module tests/tooling/scaffold-scripts
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PACKAGE_JSON = path.join(PROJECT_ROOT, 'package.json');

type ScriptMap = Record<string, string>;

/**
 * Interpreters whose first argument is the script file they run. Anything else
 * is treated as the executable itself (`scripts/tf-generate-synths.sh`).
 */
const INTERPRETERS = new Set([
  'tsx',
  'ts-node',
  'vite-node',
  'node',
  'deno',
  'bun',
  'bash',
  'sh',
  'zsh',
  'python',
  'python3',
]);

/** Read the `scripts` map out of this repo's `package.json`. */
function readScripts(): ScriptMap {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')) as {
    scripts?: ScriptMap;
  };
  if (!pkg.scripts || typeof pkg.scripts !== 'object') {
    throw new Error('package.json declares no `scripts` map');
  }
  return pkg.scripts;
}

/**
 * The file a script command runs, as written in the manifest (e.g.
 * `./core/scripts/game-repo-scaffold.ts` for
 * `tsx ./core/scripts/game-repo-scaffold.ts --core-root ./core`).
 *
 * Leading `KEY=value` environment assignments are skipped. An unexpected shape
 * (a package runner, a shell pipeline, a flag where the file should be) throws
 * rather than silently returning something the caller would then "verify".
 */
function resolveScriptTarget(command: string): string {
  const tokens = command
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '');

  let index = 0;
  while (
    index < tokens.length &&
    /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] as string)
  ) {
    index += 1;
  }

  const head = tokens[index];
  if (head === undefined) {
    throw new Error(`empty script command: ${JSON.stringify(command)}`);
  }

  if (head === 'npm' || head === 'npx' || head === 'yarn' || head === 'pnpm') {
    throw new Error(
      `cannot resolve a package-runner command to a single file: ${JSON.stringify(command)}`,
    );
  }

  const usesInterpreter = INTERPRETERS.has(path.basename(head));
  const target = usesInterpreter ? tokens[index + 1] : head;
  if (target === undefined || target.startsWith('-')) {
    throw new Error(
      `cannot resolve a script file from: ${JSON.stringify(command)}`,
    );
  }
  return target;
}

/**
 * The `scaffold*` scripts whose target file is missing from this checkout.
 * Empty for a healthy manifest.
 */
function danglingScaffoldScripts(scripts: ScriptMap): string[] {
  return Object.keys(scripts)
    .filter((key) => key.startsWith('scaffold'))
    .filter((key) => {
      const target = resolveScriptTarget(scripts[key] as string);
      return !fs.existsSync(path.resolve(PROJECT_ROOT, target));
    })
    .sort();
}

describe('scaffold npm scripts (MS-0MVO30VXS002A1Z0)', () => {
  const scripts = readScripts();

  it('declares neither scaffold:game nor scaffold:games', () => {
    expect(scripts).not.toHaveProperty('scaffold:game');
    expect(scripts).not.toHaveProperty('scaffold:games');
  });

  it('keeps `npm run scaffold` as the game-repo entry point', () => {
    const scaffold = scripts.scaffold;
    expect(typeof scaffold).toBe('string');
    // It must drive the engine-owned generator from the `./core` submodule —
    // this repo has no root `scripts/` tree of its own.
    expect(scaffold).toContain('./core/scripts/game-repo-scaffold.ts');
    expect(scaffold).toContain('--core-root ./core');
  });

  it('resolves every scaffold* script to a file that exists on disk', () => {
    const scaffoldKeys = Object.keys(scripts).filter((key) =>
      key.startsWith('scaffold'),
    );
    // Guard against a vacuous pass: the entry point must still be declared.
    expect(scaffoldKeys).toContain('scaffold');
    expect(danglingScaffoldScripts(scripts)).toEqual([]);
  });

  it('flags a dangling scaffold target (the guard is not vacuous)', () => {
    // The exact shape the scaffold template used to inherit: a game repo has no
    // `scripts/game-repo-scaffold.ts`, so this command can only ever fail.
    const fixture: ScriptMap = {
      scaffold: 'tsx ./core/scripts/game-repo-scaffold.ts --core-root ./core',
      'scaffold:game': 'tsx scripts/game-repo-scaffold.ts',
      'scaffold:games': 'tsx scripts/game-repo-scaffold.ts --all',
    };
    expect(danglingScaffoldScripts(fixture)).toEqual([
      'scaffold:game',
      'scaffold:games',
    ]);
  });
});
