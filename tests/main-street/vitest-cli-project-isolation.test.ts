/**
 * Vitest project isolation for the subprocess/render-heavy CLI tests
 * (MS-0MV5PNIPO00940KG).
 *
 * The CLI test files cold-start a `vite-node` process (or, for
 * `storyline-graph-svg`, a Playwright Chromium render) and assert that the
 * spawned CLI exits 0. Under Vitest's default file-level parallelism they
 * contend with each other and with the rest of the unit suite for CPU and the
 * Vite transform pipeline, intermittently producing a spurious non-zero exit
 * (`expected 1 to be +0`) even though the shipped CLI is fine.
 *
 * The fix moves exactly those files into a dedicated, serialized `unit-cli`
 * project that runs after the default `unit` group. This test asserts the
 * resolved Vitest configuration enacts that contract, so a future edit cannot
 * silently put the contention-prone files back into the parallel pool.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';

import viteConfig from '../../vite.config';

/**
 * Subprocess/render-heavy CLI test files that must run serially. Kept in sync
 * with the `CLI_TEST_FILES` constant in `vite.config.ts` by asserting the
 * project partition (not by importing the constant, which is not exported).
 */
const CLI_TEST_FILES = [
  'tests/main-street/validate-storylines.test.ts',
  'tests/main-street/storyline-graph.test.ts',
  'tests/main-street/storyline-author.test.ts',
  'tests/main-street/storyline-graph-svg.test.ts',
  'tests/main-street/harness-cli.test.ts',
  'tests/main-street/card-diagrams.test.ts',
];

interface ResolvedProjectTestConfig {
  name?: string;
  include?: string[];
  exclude?: string[];
  fileParallelism?: boolean;
  sequence?: { concurrent?: boolean; groupOrder?: number };
  maxWorkers?: number;
}

interface ResolvedProject {
  test?: ResolvedProjectTestConfig;
}

/**
 * Resolve the Vitest projects declared by the exported Vite config. The config
 * is authored as a `defineConfig(({ mode }) => ({...}))` function, so evaluate
 * it with a test-mode env to obtain the plain configuration object.
 */
function resolveProjects(): ResolvedProject[] {
  const exported = viteConfig as unknown;
  const resolved =
    typeof exported === 'function'
      ? (
          exported as (env: { command: string; mode: string }) => {
            test?: { projects?: ResolvedProject[] };
          }
        )({ command: 'serve', mode: 'test' })
      : (exported as { test?: { projects?: ResolvedProject[] } });
  return resolved.test?.projects ?? [];
}

function projectNamed(projects: ResolvedProject[], name: string): ResolvedProjectTestConfig {
  const project = projects.find((candidate) => candidate.test?.name === name);
  if (!project?.test) {
    throw new Error(`expected a Vitest project named '${name}'`);
  }
  return project.test;
}

describe('unit-cli project isolation (MS-0MV5PNIPO00940KG)', () => {
  const projects = resolveProjects();

  it('keeps the subprocess/render-heavy CLI files out of the parallel unit project', () => {
    const unit = projectNamed(projects, 'unit');
    const excluded = new Set(unit.exclude ?? []);
    const included = unit.include ?? [];

    for (const file of CLI_TEST_FILES) {
      expect(excluded.has(file)).toBe(true);
      expect(included).not.toContain(file);
    }
  });

  it('includes exactly the contention-prone CLI files in the serialized unit-cli project', () => {
    const unitCli = projectNamed(projects, 'unit-cli');

    expect(unitCli.include).toEqual(CLI_TEST_FILES);
  });

  it('runs the unit-cli project serially, after the default project group', () => {
    const unitCli = projectNamed(projects, 'unit-cli');

    expect(unitCli.fileParallelism).toBe(false);
    expect(unitCli.sequence?.concurrent).toBe(false);
    expect(unitCli.sequence?.groupOrder).toBeGreaterThan(0);
  });
});
