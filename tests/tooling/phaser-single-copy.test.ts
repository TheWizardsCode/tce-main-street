/**
 * Regression guard: `phaser` must resolve to exactly one module identity.
 *
 * Background (MS-0MVK3SF54006Y6A6): this game repo composes the engine from the
 * `./core` submodule, and the submodule normally has no `node_modules` of its
 * own — every shared runtime dep resolves to this repo's root install. A single
 * `npm install` *inside* `core/` breaks that assumption: a second `phaser`
 * appears at `core/node_modules/phaser`, and core-owned modules (for example
 * `@ui`) resolve their own copy.
 *
 * The Node-environment unit tests mock Phaser with `vi.mock('phaser')`. Vitest
 * registers that mock under the module id resolved from the *test file* (the
 * root copy), so a core module importing its own copy is a different id the
 * mock does not cover — real Phaser is evaluated during collection and the
 * suite dies with `ReferenceError: window is not defined` in 17 files.
 *
 * The fix is `resolve.dedupe` in `vite.config.ts`, which pins both sides to the
 * root copy (mirroring `core/vite.config.ts`). This test asserts the contract
 * two ways: the checked-in config still declares the dedupe, and a fixture with
 * a nested duplicate — the exact broken layout — resolves to a single module id
 * when the real config's dedupe list is applied.
 *
 * @module tests/tooling/phaser-single-copy
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';

import viteConfig from '../../vite.config';

/** The subset of the resolved Vite config this guard cares about. */
interface ResolvedResolveConfig {
  resolve?: { dedupe?: string[] };
}

/**
 * Evaluate the exported config factory (authored as
 * `defineConfig(({ mode }) => ({...}))`) to obtain the plain `resolve` block,
 * mirroring how `tests/main-street/vitest-cli-project-isolation.test.ts`
 * inspects the `test` block.
 */
function resolvedResolveConfig(): ResolvedResolveConfig {
  const exported = viteConfig as unknown;
  if (typeof exported === 'function') {
    return (exported as (env: { command: string; mode: string }) => ResolvedResolveConfig)({
      command: 'serve',
      mode: 'test',
    });
  }
  return exported as ResolvedResolveConfig;
}

const CONFIG_DEDUPE = resolvedResolveConfig().resolve?.dedupe ?? [];

interface DuplicateFixture {
  /** Repository root of the fake checkout. */
  root: string;
  /** Importer standing in for a test file in this repo's `tests/`. */
  rootImporter: string;
  /** Importer standing in for a core-owned module reached through `@ui`. */
  coreImporter: string;
  /** The single shared copy (the root install). */
  sharedCopy: string;
  /** The second copy an `npm install` inside `core/` would create. */
  nestedCopy: string;
}

/**
 * Build a throwaway checkout on disk with the broken layout: a root
 * `node_modules/phaser` plus a nested `core/node_modules/phaser`.
 *
 * Created outside the repository (OS temp dir) so no `node_modules` is ever
 * planted inside the real `./core` submodule.
 */
function createDuplicateFixture(): DuplicateFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phaser-single-copy-'));

  const writeCopy = (dir: string, version: string): string => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'phaser', version, main: 'index.js' }),
    );
    fs.writeFileSync(path.join(dir, 'index.js'), 'export default {};\n');
    return path.join(dir, 'index.js');
  };

  const sharedCopy = writeCopy(path.join(root, 'node_modules', 'phaser'), '4.0.0-root');
  const nestedCopy = writeCopy(path.join(root, 'core', 'node_modules', 'phaser'), '4.0.0-core');

  const rootImporter = path.join(root, 'tests', 'main-street', 'animator.test.ts');
  fs.mkdirSync(path.dirname(rootImporter), { recursive: true });
  fs.writeFileSync(rootImporter, '// importer stand-in\n');

  const coreImporter = path.join(root, 'core', 'src', 'ui', 'popTextOrIcon.ts');
  fs.mkdirSync(path.dirname(coreImporter), { recursive: true });
  fs.writeFileSync(coreImporter, '// importer stand-in\n');

  return { root, rootImporter, coreImporter, sharedCopy, nestedCopy };
}

/**
 * Resolve `phaser` from both importers through Vite's real resolver for the
 * given dedupe list, using the same SSR (no dependency pre-bundling) mode the
 * Vitest module runner uses.
 */
async function resolveFromBoth(
  fixture: DuplicateFixture,
  dedupe: string[],
): Promise<{ fromRootImporter?: string; fromCoreImporter?: string }> {
  const server = await createServer({
    configFile: false,
    root: fixture.root,
    logLevel: 'silent',
    resolve: { dedupe },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  try {
    const fromRoot = await server.pluginContainer.resolveId('phaser', fixture.rootImporter, {
      ssr: true,
    });
    const fromCore = await server.pluginContainer.resolveId('phaser', fixture.coreImporter, {
      ssr: true,
    });
    return { fromRootImporter: fromRoot?.id, fromCoreImporter: fromCore?.id };
  } finally {
    await server.close();
  }
}

describe('phaser single-copy guarantee (MS-0MVK3SF54006Y6A6)', () => {
  it('declares phaser (and tone) as deduped in the checked-in config', () => {
    // A re-scaffold or a careless edit that drops the dedupe must fail loudly
    // here rather than resurface as 17 collection errors in the unit suite.
    expect(CONFIG_DEDUPE).toContain('phaser');
    // `tone` is the other shared runtime dep imported by core-owned modules
    // (`core/src/core-engine/tf-runtime/main-street-runtime-synth.mjs`).
    expect(CONFIG_DEDUPE).toContain('tone');
  });

  it('resolves a nested core copy and the root copy to one module id', async () => {
    const fixture = createDuplicateFixture();
    try {
      const { fromRootImporter, fromCoreImporter } = await resolveFromBoth(fixture, CONFIG_DEDUPE);

      // Both sides must land on the single shared copy — the id Vitest keys the
      // `vi.mock('phaser')` registration on.
      expect(fromRootImporter).toBe(fixture.sharedCopy);
      expect(fromCoreImporter).toBe(fixture.sharedCopy);
      expect(fromCoreImporter).toBe(fromRootImporter);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('demonstrates the fixture is load-bearing: without dedupe the ids diverge', async () => {
    // Anti-vacuity control: the same layout *without* the config's dedupe must
    // reproduce the failure mode (two module ids, so the mock misses the core
    // copy). If this ever passes with one id, the fixture no longer models the
    // bug and the assertion above would be meaningless.
    const fixture = createDuplicateFixture();
    try {
      const { fromRootImporter, fromCoreImporter } = await resolveFromBoth(fixture, []);

      expect(fromRootImporter).toBe(fixture.sharedCopy);
      expect(fromCoreImporter).toBe(fixture.nestedCopy);
      expect(fromCoreImporter).not.toBe(fromRootImporter);
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
