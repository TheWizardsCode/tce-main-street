/**
 * Testing-docs drift guard: documented Vitest projects match `vite.config.ts`
 * (MS-0MVJPV0BV000LSLW).
 *
 * `docs/dev/testing.md` opened with "Two projects are defined in
 * `vite.config.ts`" long after the serialized `unit-cli` project
 * (MS-0MV5PNIPO00940KG) had been added, and its project table omitted
 * `unit-cli` entirely. The table is the first thing a contributor reads when
 * deciding how to run a suite, so a missing row hides the one project whose
 * serialization constraints matter most.
 *
 * These tests read the real config and the real doc and compare them:
 *
 * 1. every `test.name` declared in `vite.config.ts` has a row in the project
 *    table, and the table declares no project the config does not define;
 * 2. the prose does not understate the count ("Two projects" when there are
 *    three) — the number word must agree with the config;
 * 3. the `unit-cli` row keeps naming `CLI_TEST_FILES` and the serialization
 *    setting, so the reason that project exists stays documented.
 *
 * The guard reads `vite.config.ts` as text rather than importing it: importing
 * would boot the whole plugin stack (and Phaser) inside a unit test.
 *
 * @module tests/main-street/testing-docs-projects
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'vite.config.ts');
const DOC_PATH = path.join(PROJECT_ROOT, 'docs/dev/testing.md');

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];

/** Vitest project names declared in `vite.config.ts` → `name: '<project>'`. */
function declaredProjectNames(): string[] {
  const config = fs.readFileSync(CONFIG_PATH, 'utf8');
  const names: string[] = [];
  for (const match of config.matchAll(/^\s{8,}name: '([a-z][a-z0-9-]*)',$/gm)) {
    names.push(match[1]);
  }
  return names;
}

/** Project names listed as the first column of the doc's project table. */
function documentedProjectNames(doc: string): string[] {
  const names: string[] = [];
  for (const line of doc.split('\n')) {
    const row = /^\|\s*`([a-z][a-z0-9-]*)`\s*\|/.exec(line);
    if (row) names.push(row[1]);
  }
  return names;
}

describe('docs/dev/testing.md — Vitest project inventory', () => {
  it('declares a project for every project in vite.config.ts', () => {
    const declared = declaredProjectNames();
    const documented = documentedProjectNames(fs.readFileSync(DOC_PATH, 'utf8'));

    // Sanity: the config parse must actually find the projects, otherwise the
    // assertion below would pass vacuously.
    expect(declared.length).toBeGreaterThanOrEqual(3);
    expect(documented.sort()).toEqual([...new Set(declared)].sort());
  });

  it('states a project count that matches the config', () => {
    const declared = declaredProjectNames();
    const doc = fs.readFileSync(DOC_PATH, 'utf8');
    const expectedWord = NUMBER_WORDS[declared.length];

    expect(doc).toMatch(
      new RegExp(
        `\\b${expectedWord}\\s+projects\\s+are\\s+defined\\s+in\\s+\`vite\\.config\\.ts\``,
        'i',
      ),
    );
  });

  it('documents the unit-cli project as the serialized CLI suite', () => {
    const doc = fs.readFileSync(DOC_PATH, 'utf8');
    const unitCliRow = doc
      .split('\n')
      .find((line) => /^\|\s*`unit-cli`\s*\|/.test(line));

    expect(unitCliRow, 'unit-cli must have a row in the project table').toBeDefined();
    expect(unitCliRow).toContain('CLI_TEST_FILES');
    expect(unitCliRow).toContain('fileParallelism: false');
    expect(doc).toContain('npm test');
  });
});
