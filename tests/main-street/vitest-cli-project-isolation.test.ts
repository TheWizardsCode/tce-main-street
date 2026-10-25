/**
 * Vitest project isolation and project-selection contract
 * (MS-0MV5PNIPO00940KG, MS-0MVK37SK5009M0NG).
 *
 * The CLI test files cold-start a `vite-node` process (or, for
 * `storyline-graph-svg`, a Playwright Chromium render) and assert that the
 * spawned CLI exits 0. Under Vitest's default file-level parallelism they
 * contend with each other and with the rest of the unit suite for CPU and the
 * Vite transform pipeline, intermittently producing a spurious non-zero exit
 * (`expected 1 to be +0`) even though the shipped CLI is fine.
 *
 * The fix moves exactly those files into a dedicated, serialized `unit-cli`
 * project. This test asserts the resolved Vitest configuration enacts that
 * contract, so a future edit cannot silently put the contention-prone files
 * back into the parallel pool.
 *
 * It also pins the *run-time selection* contract that MS-0MVK37SK5009M0NG
 * added: `npm test` passes two `--project` filters, and Vitest silently drops
 * the remaining `sequence.groupOrder` groups when an earlier group's pool run
 * rejects. The CLI group must therefore be the group that runs first (it can
 * never be the one dropped), and the whole non-browser suite must be
 * partitioned across the projects with no file claimed twice or not at all.
 *
 * @module
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import viteConfig, { CLI_TEST_FILES as DECLARED_CLI_TEST_FILES } from '../../vite.config';

/**
 * The canonical CLI set: subprocess/render-heavy files that must run serially
 * (MS-0MV5PNIPO00940KG). Asserted against the config's exported list so a
 * silent re-scope of either side fails here.
 */
const CLI_TEST_FILES = [
  'tests/main-street/validate-storylines.test.ts',
  'tests/main-street/storyline-graph.test.ts',
  'tests/main-street/storyline-author.test.ts',
  'tests/main-street/storyline-graph-svg.test.ts',
  'tests/main-street/harness-cli.test.ts',
];

const PROJECT_ROOT = path.resolve(__dirname, '../..');

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

interface ResolvedConfig {
  test?: {
    projects?: ResolvedProject[];
    reporters?: unknown[];
  };
}

/**
 * Resolve the Vitest projects declared by the exported Vite config. The config
 * is authored as a `defineConfig(({ mode }) => ({...}))` function, so evaluate
 * it with a test-mode env to obtain the plain configuration object.
 */
function resolveConfig(): ResolvedConfig['test'] {
  const exported = viteConfig as unknown;
  const resolved =
    typeof exported === 'function'
      ? (exported as (env: { command: string; mode: string }) => ResolvedConfig)({
          command: 'serve',
          mode: 'test',
        })
      : (exported as ResolvedConfig);
  return resolved.test;
}

function resolveProjects(): ResolvedProject[] {
  return resolveConfig()?.projects ?? [];
}

function projectNamed(projects: ResolvedProject[], name: string): ResolvedProjectTestConfig {
  const project = projects.find((candidate) => candidate.test?.name === name);
  if (!project?.test) {
    throw new Error(`expected a Vitest project named '${name}'`);
  }
  return project.test;
}

/**
 * Translate a Vitest glob (`tests/**\/*.test.ts`, `tests/**\/*.browser.test.ts`
 * or an exact path) into a matcher. Only the forms this config uses are
 * supported — the goal is to compute the *partition* of the files on disk, not
 * to reimplement globbing.
 */
function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === '*') {
      if (glob[index + 1] === '*') {
        // `**/` spans zero or more whole directories; a bare `**` spans anything.
        if (glob[index + 2] === '/') {
          source += '(?:[^/]+/)*';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

function matchesAny(globs: readonly string[] | undefined, file: string): boolean {
  if (!globs || globs.length === 0) return false;
  return globs.some((glob) => globToRegExp(glob).test(file));
}

/** Every `*.test.ts` file under `tests/`, repository-relative, sorted. */
function testFilesOnDisk(): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(absolute);
      } else if (entry.name.endsWith('.test.ts')) {
        files.push(path.relative(PROJECT_ROOT, absolute).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(PROJECT_ROOT, 'tests'));
  return files.sort();
}

/** `--project` values from the `npm test` scripts in `package.json`. */
function npmTestProjectFilters(): string[] {
  const script = npmTestScript();
  const filters: string[] = [];
  const tokens = script.split(/\s+/);
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === '--project') filters.push(tokens[index + 1]);
    else if (tokens[index].startsWith('--project=')) filters.push(tokens[index].slice('--project='.length));
  }
  return filters;
}

function npmTestScript(): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  const script = pkg.scripts?.test;
  if (!script) throw new Error('package.json declares no `test` script');
  return script;
}

describe('unit-cli project isolation (MS-0MV5PNIPO00940KG)', () => {
  const projects = resolveProjects();

  it('declares the CLI file set in the config, matching the pinned set', () => {
    expect(DECLARED_CLI_TEST_FILES).toEqual(CLI_TEST_FILES);
  });

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

  it('runs the unit-cli project serially', () => {
    const unitCli = projectNamed(projects, 'unit-cli');

    expect(unitCli.fileParallelism).toBe(false);
    expect(unitCli.sequence?.concurrent).toBe(false);
  });
});

describe('npm test project selection (MS-0MVK37SK5009M0NG)', () => {
  const projects = resolveProjects();

  it('passes exactly the declared unit and unit-cli projects to one invocation', () => {
    const filters = npmTestProjectFilters();

    expect(filters).toEqual(['unit', 'unit-cli']);
    // Each filter must resolve to exactly one declared project: a wildcard that
    // matched several (or none) is how a project silently drops out of a run.
    for (const filter of filters) {
      const matches = projects
        .map((project) => project.test?.name)
        .filter((name): name is string => typeof name === 'string')
        .filter((name) => name === filter);
      expect(matches).toEqual([filter]);
    }
  });

  it('keeps the single invocation and the retry timeout behind the coverage guard', () => {
    const script = npmTestScript();

    // One Vitest invocation through the repo-local entry point, which enforces
    // the coverage verdict afterwards (see scripts/run-tests.ts). Pointing
    // `npm test` straight at the engine runner would drop that enforcement.
    expect(script).toContain('scripts/run-tests.ts');
    expect(script).toContain('--timeout-ms 720000');
    expect(script.match(/--project/g)).toHaveLength(2);
    // No second invocation stage.
    expect(script).not.toContain('&&');
  });

  it('sequences the groups so the serialized CLI group runs before the parallel group', () => {
    const unit = projectNamed(projects, 'unit');
    const unitCli = projectNamed(projects, 'unit-cli');
    const unitOrder = unit.sequence?.groupOrder ?? 0;
    const unitCliOrder = unitCli.sequence?.groupOrder ?? 0;

    // Distinct groups are what keep the CLI files out of the parallel pool…
    expect(unitCliOrder).not.toBe(unitOrder);
    // …and running FIRST is what makes them unskippable: Vitest aborts the
    // remaining group loop when an earlier group's pool run rejects, dropping
    // whichever groups have not started yet (MS-0MVK37SK5009M0NG).
    expect(unitCliOrder).toBeLessThan(unitOrder);
  });

  it('claims every test file on disk for exactly one project', () => {
    const files = testFilesOnDisk();
    // Sanity: the walk must find the suite, otherwise the assertion below is vacuous.
    expect(files.length).toBeGreaterThan(100);

    const unclaimed: string[] = [];
    const multiplyClaimed: string[] = [];
    for (const file of files) {
      const claims = projects.filter((project) => {
        const test = project.test;
        if (!test) return false;
        return matchesAny(test.include, file) && !matchesAny(test.exclude, file);
      });
      if (claims.length === 0) unclaimed.push(file);
      if (claims.length > 1) multiplyClaimed.push(file);
    }

    expect(unclaimed).toEqual([]);
    expect(multiplyClaimed).toEqual([]);
  });

  it('claims the CLI files only for unit-cli', () => {
    for (const file of CLI_TEST_FILES) {
      const claims = projects
        .filter((project) => matchesAny(project.test?.include, file))
        .filter((project) => !matchesAny(project.test?.exclude, file))
        .map((project) => project.test?.name);

      expect(claims).toEqual(['unit-cli']);
    }
  });

  it('wires the zero-coverage guard reporter into the config', () => {
    const reporters = resolveConfig()?.reporters;

    expect(Array.isArray(reporters)).toBe(true);
    const lifecycleReporters = (reporters ?? []).filter(
      (reporter) =>
        typeof reporter === 'object' &&
        reporter !== null &&
        typeof (reporter as { onTestRunEnd?: unknown }).onTestRunEnd === 'function',
    );
    expect(lifecycleReporters).toHaveLength(1);
    // The default console reporter must stay wired: the test-skill cache and
    // human operators both read its `Test Files … passed` summary line.
    expect(reporters).toContainEqual(['default', {}]);
  });
});
