/**
 * Behaviour of the zero-coverage guard (MS-0MVK37SK5009M0NG).
 *
 * The guard exists because a Vitest run can report green while an entire
 * configured project never executed: Vitest 3.2.7 aborts its sequential
 * `sequence.groupOrder` loop when an earlier group's pool run rejects (the
 * `[vitest-worker]: Timeout calling "onTaskUpdate"` transient), silently
 * dropping every later group. These tests pin the guard's decision logic and
 * its reporter wiring against that shape, so a future change cannot turn the
 * silent skip back into a green gate.
 *
 * @module tests/tooling/vitest-project-coverage-reporter
 */
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { TestModule, TestSpecification } from 'vitest/node';

import {
  createProjectCoverageReporter,
  findUnexecutedFiles,
  formatCoverageFailure,
  groupByProject,
} from './vitest-project-coverage-reporter';

const ROOT = path.resolve('/repo');

const CLI_FILES = [
  'tests/main-street/validate-storylines.test.ts',
  'tests/main-street/storyline-graph.test.ts',
  'tests/main-street/storyline-author.test.ts',
  'tests/main-street/storyline-graph-svg.test.ts',
  'tests/main-street/harness-cli.test.ts',
];

const UNIT_FILES = [
  'tests/main-street/MainStreetHandState.test.ts',
  'tests/main-street/terminology-guard.test.ts',
];

function abs(relativePath: string): string {
  return path.join(ROOT, relativePath);
}

function projectFile(project: string, relativePath: string) {
  return { project, moduleId: abs(relativePath) };
}

/** Minimal structural fakes for the reporter lifecycle seams. */
function asSpecifications(
  files: { project: string; moduleId: string }[],
): ReadonlyArray<TestSpecification> {
  return files.map((file) => ({
    project: { name: file.project },
    moduleId: file.moduleId,
  })) as unknown as TestSpecification[];
}

function asTestModules(
  files: { project: string; moduleId: string }[],
): ReadonlyArray<TestModule> {
  return files.map((file) => ({
    project: { name: file.project },
    moduleId: file.moduleId,
  })) as unknown as TestModule[];
}

describe('groupByProject', () => {
  it('groups absolute module ids per project', () => {
    const grouped = groupByProject([
      projectFile('unit', 'tests/a.test.ts'),
      projectFile('unit', 'tests/b.test.ts'),
      projectFile('unit-cli', 'tests/c.test.ts'),
    ]);

    expect([...grouped.keys()].sort()).toEqual(['unit', 'unit-cli']);
    expect([...grouped.get('unit')!].sort()).toEqual([
      abs('tests/a.test.ts'),
      abs('tests/b.test.ts'),
    ]);
  });

  it('treats different spellings of the same path as one file', () => {
    const grouped = groupByProject([
      { project: 'unit', moduleId: abs('tests/a.test.ts') },
      { project: 'unit', moduleId: `${ROOT}//tests/./a.test.ts` },
    ]);

    expect(grouped.get('unit')!.size).toBe(1);
  });
});

describe('findUnexecutedFiles', () => {
  it('reports a project that executed none of its expected files', () => {
    const violations = findUnexecutedFiles(
      [...CLI_FILES.map((file) => projectFile('unit-cli', file)), ...UNIT_FILES.map((file) => projectFile('unit', file))],
      UNIT_FILES.map((file) => projectFile('unit', file)),
      ROOT,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].project).toBe('unit-cli');
    expect(violations[0].ran).toEqual([]);
    expect(violations[0].expected).toEqual([...CLI_FILES].sort());
    expect(violations[0].missing).toEqual([...CLI_FILES].sort());
  });

  it('reports a project that executed only some of its expected files', () => {
    const violations = findUnexecutedFiles(
      [
        projectFile('unit', 'tests/main-street/a.test.ts'),
        projectFile('unit', 'tests/main-street/b.test.ts'),
        projectFile('unit', 'tests/main-street/c.test.ts'),
      ],
      [
        projectFile('unit', 'tests/main-street/a.test.ts'),
        projectFile('unit', 'tests/main-street/c.test.ts'),
      ],
      ROOT,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].project).toBe('unit');
    expect(violations[0].ran).toHaveLength(2);
    expect(violations[0].missing).toEqual(['tests/main-street/b.test.ts']);
  });

  it('reports nothing when every expected file executed', () => {
    const expected = [
      ...CLI_FILES.map((file) => projectFile('unit-cli', file)),
      ...UNIT_FILES.map((file) => projectFile('unit', file)),
    ];

    expect(findUnexecutedFiles(expected, expected, ROOT)).toEqual([]);
  });

  it('reports nothing for projects that were not part of the run', () => {
    // A `--project unit` invocation expects nothing of `unit-cli`.
    expect(
      findUnexecutedFiles(
        UNIT_FILES.map((file) => projectFile('unit', file)),
        UNIT_FILES.map((file) => projectFile('unit', file)),
        ROOT,
      ),
    ).toEqual([]);
  });

  it('reports projects in a deterministic order', () => {
    const expected = [
      projectFile('unit-cli', 'tests/cli.test.ts'),
      projectFile('browser', 'tests/b.browser.test.ts'),
      projectFile('unit', 'tests/a.test.ts'),
    ];

    expect(findUnexecutedFiles(expected, [], ROOT).map((v) => v.project)).toEqual([
      'browser',
      'unit',
      'unit-cli',
    ]);
  });
});

describe('formatCoverageFailure', () => {
  const [violation] = findUnexecutedFiles(
    CLI_FILES.map((file) => projectFile('unit-cli', file)),
    [],
    ROOT,
  );

  it('names the short project, the counts and every missing file', () => {
    const message = formatCoverageFailure([violation]);

    expect(message).toContain('project "unit-cli" executed 0 of 5 expected file(s)');
    for (const file of CLI_FILES) {
      expect(message).toContain(file);
    }
    expect(message).toContain('never executed');
  });

  it('names the known upstream cause so the operator can act', () => {
    const message = formatCoverageFailure([violation]);

    expect(message).toContain('sequence.groupOrder');
    expect(message).toContain('group\'s pool run rejects');
    expect(message).toContain('onTaskUpdate');
    expect(message).toContain('docs/dev/testing.md');
    expect(message).toContain('MS-0MVK37SK5009M0NG');
  });

  it('elides very long file lists but keeps the count', () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      `tests/many-${String(index).padStart(2, '0')}.test.ts`,
    );
    const [manyViolation] = findUnexecutedFiles(
      many.map((file) => projectFile('unit', file)),
      [],
      ROOT,
    );

    const message = formatCoverageFailure([manyViolation]);

    expect(message).toContain('… and 4 more');
    expect(message).toContain('tests/many-09.test.ts');
    expect(message).not.toContain('tests/many-10.test.ts');
  });
});

describe('createProjectCoverageReporter', () => {
  function lifecycle(
    specifications: { project: string; moduleId: string }[],
    modules: { project: string; moduleId: string }[],
  ) {
    const report = vi.fn();
    const fail = vi.fn();
    const reporter = createProjectCoverageReporter({ report, fail });
    reporter.onTestRunStart?.(asSpecifications(specifications));
    reporter.onTestRunEnd?.(asTestModules(modules), [], 'passed');
    return { report, fail };
  }

  it('fails the run when a configured project executed none of its files', () => {
    // The observed defect: `unit` ran every file, `unit-cli` ran none.
    const { report, fail } = lifecycle(
      [
        ...UNIT_FILES.map((file) => ({ project: 'unit', moduleId: abs(file) })),
        ...CLI_FILES.map((file) => ({ project: 'unit-cli', moduleId: abs(file) })),
      ],
      UNIT_FILES.map((file) => ({ project: 'unit', moduleId: abs(file) })),
    );

    expect(fail).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toContain('project "unit-cli"');
  });

  it('stays silent for a complete run', () => {
    const files = [
      ...UNIT_FILES.map((file) => ({ project: 'unit', moduleId: abs(file) })),
      ...CLI_FILES.map((file) => ({ project: 'unit-cli', moduleId: abs(file) })),
    ];

    const { report, fail } = lifecycle(files, files);

    expect(fail).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('ignores a run with no specifications (nothing was expected)', () => {
    const { report, fail } = lifecycle([], []);

    expect(fail).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('checks only the files a filtered invocation expected', () => {
    // `vitest run --project unit tests/.../a.test.ts` expects one file only.
    const { report, fail } = lifecycle(
      [{ project: 'unit', moduleId: abs('tests/a.test.ts') }],
      [{ project: 'unit', moduleId: abs('tests/a.test.ts') }],
    );

    expect(fail).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});
