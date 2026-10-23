/**
 * Zero-coverage guard for the Vitest project set (MS-0MVK37SK5009M0NG).
 *
 * ## The failure it exists for
 *
 * `npm test` runs `vitest run --project unit --project unit-cli` — one
 * invocation, two projects, sequenced by `sequence.groupOrder`. Vitest 3.2.7
 * executes those groups one after another (`executeTests` in its pool layer)
 * with a bare `await` per group and no per-group error isolation. When an
 * earlier group's pool run *rejects* — which happens when a `unit` worker
 * misses the 60 s `onTaskUpdate` RPC window under CPU contention — the group
 * loop aborts, every later group is dropped, and the run still reports the
 * files it did execute as passing. Twenty-eight cached full-suite runs from
 * 2026-10-19 to 2026-10-23 show the correlation exactly: `|unit-cli|` lines
 * are present iff no `[vitest-worker]: Timeout calling "onTaskUpdate"`
 * transient occurred, so a green gate sometimes meant 375 of 380 files ran.
 *
 * ## What this guard does
 *
 * It is a Vitest *reporter* (wired in `vite.config.ts`), so it runs inside the
 * same single invocation and sees the ground truth: the specifications the
 * run *intended* to execute (`onTestRunStart`) and the modules it actually
 * executed (`onTestRunEnd`). Any intended file that never ran is a gate
 * failure — it names the project, the expected and missing files, and sets a
 * non-zero exit code so the run cannot report green.
 *
 * Being spec-driven (rather than glob-driven) makes the guard filter-aware for
 * free: a filtered invocation (`vitest run --project browser tests/e2e/x.ts`,
 * `--changed`, `--shard`) only "expects" the files that match its filters, so
 * it is never reported as incomplete.
 *
 * The comparison logic is exported as pure functions so it can be unit-tested
 * without booting Vitest.
 *
 * @module tests/tooling/vitest-project-coverage-reporter
 */
import path from 'node:path';

import type { Reporter, TestModule, TestSpecification, Vitest } from 'vitest/node';

/** A file a project's run intended to execute (or actually executed). */
export interface ProjectFile {
  /** Vitest project name (`unit`, `unit-cli`, `browser`, …). */
  project: string;
  /** Absolute path of the test file (Vitest's module id). */
  moduleId: string;
}

/** A project that did not execute every file the run intended for it. */
export interface ProjectCoverageViolation {
  /** Vitest project name. */
  project: string;
  /** Repository-relative paths the run intended to execute, sorted. */
  expected: string[];
  /** Repository-relative paths the project actually executed, sorted. */
  ran: string[];
  /** Repository-relative paths that never executed, sorted. */
  missing: string[];
}

/**
 * Normalise a module id for identity comparison.
 *
 * Vitest's specifications glob absolute file paths; reported modules normally
 * carry the same absolute path, but browser/virtual modules may report a
 * relative or URL-ish id. Only absolute paths are resolved (so `a/./b.ts` and
 * `a//b.ts` compare equal); anything else is compared verbatim.
 */
export function normaliseModuleId(moduleId: string): string {
  return path.isAbsolute(moduleId) ? path.resolve(moduleId) : moduleId;
}

/**
 * Group `files` by project name, normalising every module id (see
 * {@link normaliseModuleId}) so specifications and reported modules compare by
 * identity rather than by spelling.
 */
export function groupByProject(files: readonly ProjectFile[]): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();
  for (const file of files) {
    const existing = grouped.get(file.project);
    const moduleId = normaliseModuleId(file.moduleId);
    if (existing) existing.add(moduleId);
    else grouped.set(file.project, new Set([moduleId]));
  }
  return grouped;
}

/**
 * Compare what the run intended to execute with what it executed and return
 * one violation per project with at least one unexecuted file, sorted by
 * project name.
 *
 * Projects that were intended but contributed no specs at all are reported too
 * (a configured project whose `include` matches nothing must not pass
 * silently); projects absent from `expected` (filtered out by `--project`, or
 * with no matching files) are not violations — nothing was expected of them.
 */
export function findUnexecutedFiles(
  expected: readonly ProjectFile[],
  ran: readonly ProjectFile[],
  relativeTo: string = process.cwd(),
): ProjectCoverageViolation[] {
  const expectedByProject = groupByProject(expected);
  const ranByProject = groupByProject(ran);
  const violations: ProjectCoverageViolation[] = [];
  const toRelative = (moduleId: string) =>
    path.isAbsolute(moduleId) ? path.relative(relativeTo, moduleId) : moduleId;
  for (const project of [...expectedByProject.keys()].sort()) {
    const expectedFiles = [...expectedByProject.get(project)!].sort();
    const ranFiles = new Set(ranByProject.get(project) ?? []);
    const missing = expectedFiles.filter((moduleId) => !ranFiles.has(moduleId));
    if (missing.length === 0) continue;
    violations.push({
      project,
      expected: expectedFiles.map(toRelative),
      ran: [...ranFiles].sort().map(toRelative),
      missing: missing.map(toRelative),
    });
  }
  return violations;
}

/** Maximum number of file names listed per project before eliding. */
const MAX_LISTED_FILES = 10;

function listFiles(files: readonly string[]): string[] {
  const listed = files.slice(0, MAX_LISTED_FILES).map((file) => `      - ${file}`);
  if (files.length > MAX_LISTED_FILES) {
    listed.push(`      … and ${files.length - MAX_LISTED_FILES} more`);
  }
  return listed;
}

/**
 * Render the operator-facing failure message for `violations`: which project
 * came up short, which files never ran, and why an incomplete run must not be
 * read as green.
 */
export function formatCoverageFailure(
  violations: readonly ProjectCoverageViolation[],
): string {
  const lines = [
    '[project-coverage-guard] FAIL: a configured Vitest project did not run every test file.',
  ];
  for (const violation of violations) {
    lines.push(
      `  project "${violation.project}" executed ${violation.ran.length} of ` +
        `${violation.expected.length} expected file(s); ${violation.missing.length} never ran:`,
      ...listFiles(violation.missing),
    );
  }
  lines.push(
    'This run does not prove the suite passed — the files above were never executed,',
    'so a green summary would be a false negative for them.',
    'Known cause: Vitest drops the remaining `sequence.groupOrder` groups when an earlier',
    'group\'s pool run rejects (for example the `[vitest-worker]: Timeout calling',
    '"onTaskUpdate"` transient). Re-run the suite; if this repeats, see',
    'docs/dev/testing.md ("Guarantee: every configured project runs")',
    '(MS-0MVK37SK5009M0NG).',
  );
  return lines.join('\n');
}

/** Injectable seams so the reporter's own logic can be unit-tested. */
export interface ProjectCoverageReporterOptions {
  /** Emit the failure text (defaults to `console.error`). */
  report?: (message: string) => void;
  /** Mark the run as failed (defaults to `process.exitCode = 1`). */
  fail?: () => void;
}

/**
 * Build the reporter that fails a run which did not execute every test file it
 * intended to. Wired into `vite.config.ts` (`test.reporters`) so it applies to
 * every Vitest invocation in this repo.
 */
export function createProjectCoverageReporter(
  options: ProjectCoverageReporterOptions = {},
): Reporter {
  const report = options.report ?? ((message: string) => console.error(message));
  const fail = options.fail ?? (() => {
    process.exitCode = 1;
  });

  let expected: ProjectFile[] = [];
  let relativeTo = process.cwd();

  return {
    onInit(vitest: Vitest) {
      relativeTo = vitest.config?.root ?? process.cwd();
    },
    onTestRunStart(specifications: ReadonlyArray<TestSpecification>) {
      // Vitest announces every file it intends to run before any group starts,
      // including the files of groups a later abort may drop.
      expected = specifications.map((specification) => ({
        project: specification.project.name,
        moduleId: specification.moduleId,
      }));
    },
    onTestRunEnd(testModules: ReadonlyArray<TestModule>) {
      if (expected.length === 0) return;
      const ran: ProjectFile[] = testModules.map((testModule) => ({
        project: testModule.project.name,
        moduleId: testModule.moduleId,
      }));
      const violations = findUnexecutedFiles(expected, ran, relativeTo);
      if (violations.length === 0) return;
      report(formatCoverageFailure(violations));
      fail();
    },
  };
}
