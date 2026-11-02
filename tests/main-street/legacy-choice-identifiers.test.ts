/**
 * Legacy choice-identifier regression guard
 * (parent MS-0MVZLKEU5000Q7SQ, AC6).
 *
 * The engine core dropped the legacy two-way choice model end-to-end
 * (`hasChoices` / `acceptNextCardId` / `rejectNextCardId`) together with the
 * `ChoiceClarityLabels` presentation API. This game carried a temporary
 * bridge while its content, tools, docs and tests still used those fields;
 * the migration removes every occurrence. A plain `grep` at the end of the
 * migration would verify that once, by hand — this guard makes it a machine
 * check that shrinks with the migration instead.
 *
 * ## How it works
 *
 * A pure filesystem scan (no build, no `core/` import, no submodule fetch) of
 * `src/`, `tests/`, `docs/`, `schemas/` and `packs/` for the five legacy
 * identifiers, filtered to the file types that can carry them
 * (`SCAN_EXTENSIONS`). Matches are reported as `file:line:column identifier`.
 *
 * The scan is compared against `LEGACY_ALLOWLIST`, a `path → expected
 * identifier set` map seeded from the parent's refreshed sweep. The allowlist
 * is a **debt ledger**: it lets the migration land slice by slice while every
 * remaining occurrence is named explicitly. It fails closed in both
 * directions:
 *
 * - a match in a path that does not allow that identifier fails (a new
 *   occurrence, or a new occurrence inside a still-migrating file), and
 * - an allowlist entry whose path is gone, or whose identifier no longer
 *   occurs, fails (a stale entry cannot rot or silently mask a
 *   re-introduction).
 *
 * Deleting an entry is therefore the only way to make the list smaller, and
 * the last slice empties it. Once empty, the guard is the executable form of
 * "no legacy identifiers remain".
 *
 * ## Exclusion policy (documented here because the policy lives in the guard)
 *
 * - `core/` — the engine submodule; its pin is bumped, never edited here.
 * - `build/`, `docs/.vitepress/dist/` — generated artefacts, rebuilt by the
 *   build / docs build; a stale artefact must not fail the source guard.
 * - `data/transcripts/` — untracked local game recordings; historical, not
 *   regenerated.
 * - `.worklog/` — work-item text quotes the identifiers by design; it is
 *   history, not source.
 * - `node_modules/` — dependencies.
 * - this test file — it necessarily contains the identifiers as literals.
 *
 * ## Test-first (red) phase
 *
 * The final case is `it.fails` while the allowlist is non-empty (repo
 * precedent: `panel-opacity.browser.test.ts`, `MainStreetAiEventChoice.test.ts`).
 * It asserts the migration target — an empty allowlist and zero matches — so
 * the guard stays green for the intermediate slices that only shrink the list,
 * and turns red the moment the last entry is deleted, forcing the closing
 * slice to flip it to a plain `it`.
 *
 * @module tests/main-street/legacy-choice-identifiers
 */

import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

/** The five legacy identifiers the migration retires. */
export const LEGACY_IDENTIFIERS = [
  'hasChoices',
  'acceptNextCardId',
  'rejectNextCardId',
  'choiceClarityLabels',
  'ChoiceClarityLabels',
] as const;

export type LegacyIdentifier = (typeof LEGACY_IDENTIFIERS)[number];

/** Directories swept by the guard, relative to the repository root. */
export const SCAN_ROOTS = ['src', 'tests', 'docs', 'schemas', 'packs'] as const;

/** File types that can carry the identifiers. */
export const SCAN_EXTENSIONS = ['.ts', '.tsx', '.json', '.md', '.csv'] as const;

/**
 * Repository-relative paths excluded from the sweep. Documented in the module
 * doc comment above; asserted by the fixture case below so a deletion or typo
 * cannot silently widen the scan.
 */
export const EXCLUDED_PATHS = [
  'core',
  'build',
  'docs/.vitepress/dist',
  'data/transcripts',
  '.worklog',
  'node_modules',
  'tests/main-street/legacy-choice-identifiers.test.ts',
] as const;

/** One occurrence of a legacy identifier in a scanned file. */
export interface LegacyMatch {
  /** Repository-relative POSIX path. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column of the identifier within the line. */
  column: number;
  identifier: LegacyIdentifier;
}

/**
 * The migration debt ledger: path → identifiers that may still appear there.
 *
 * Grouped per migration slice, so each child of the parent item deletes its
 * own entries and the list only ever shrinks. Seeded from the parent's
 * refreshed 2026-11-02 sweep (44 tracked files: 17 `src/`, 22 `tests/`,
 * 5 docs/schema/packs).
 */
export const LEGACY_ALLOWLIST: Readonly<
  Record<string, readonly LegacyIdentifier[]>
> = {
  // Slice 2 (content, adapter and authoring tools, MS-0MVZNRA85009L01U) is
  // complete: its CSVs, adapter, CLI and Monte Carlo harness carry no legacy
  // identifier. The graph node keeps the legacy `hasChoices` field name on its
  // manifest nodes until the schema/manifest rename to `isChoice` (slice 4).
  'src/scripts/storyline-graph.ts': ['hasChoices'],

  // Slice 3 (transcript and journal schema, MS-0MVZNRAL3000C1Z7) is complete:
  // the event-choice record carries only the chosen option label and the
  // journal adapter documents the options-only contract.
  //
  // --- Slice 4: schema, manifest artefact and docs (MS-0MVZNRAYU001IFLR) -
  'docs/dev/assets/storyline-manifest.json': ['hasChoices'],
  'docs/game/content-design-and-progression.md': [
    'acceptNextCardId',
    'hasChoices',
    'rejectNextCardId',
  ],
  'docs/game/storylines.md': [
    'acceptNextCardId',
    'choiceClarityLabels',
    'hasChoices',
    'rejectNextCardId',
  ],
  'schemas/main-street-storyline.schema.json': ['hasChoices'],
  'src/README.md': ['acceptNextCardId', 'hasChoices', 'rejectNextCardId'],

  // --- Tests: retired by the slice that migrates the contract they cover -
  // The content/adapter slice tests are migrated; the doc-drift guard keeps
  // asserting the documented columns until the docs/schema slice migrates them.
  'tests/main-street/storylines-doc-drift.test.ts': [
    'acceptNextCardId',
    'hasChoices',
    'rejectNextCardId',
  ],
};

/** `true` when *relPath* is or lives under one of the excluded paths. */
export function isExcluded(
  relPath: string,
  excluded: readonly string[] = EXCLUDED_PATHS,
): boolean {
  const posix = relPath.split(path.sep).join('/');
  return excluded.some(
    (entry) => posix === entry || posix.startsWith(`${entry}/`),
  );
}

function hasScannedExtension(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return SCAN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Collect scanned files under `rootDir/root`, pruned by `excluded`. */
function collectFiles(
  rootDir: string,
  root: string,
  excluded: readonly string[],
  out: string[],
): void {
  const absolute = root === '.' ? rootDir : path.join(rootDir, root);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    const rel = path.relative(rootDir, absolute).split(path.sep).join('/');
    if (!isExcluded(rel, excluded) && hasScannedExtension(rel)) out.push(rel);
    return;
  }
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const childRel = (
      root === '.' ? entry.name : `${root}/${entry.name}`
    ) as string;
    if (isExcluded(childRel, excluded)) continue;
    if (entry.isDirectory()) {
      collectFiles(rootDir, childRel, excluded, out);
    } else if (entry.isFile() && hasScannedExtension(childRel)) {
      out.push(childRel);
    }
  }
}

/**
 * Sweep *rootDir* for legacy identifiers.
 *
 * Pure filesystem read: no build, no `src/` import, no submodule access, so
 * the guard runs even while the tree is red at a new engine pin.
 */
export function collectMatches(
  rootDir: string,
  roots: readonly string[] = SCAN_ROOTS,
  excluded: readonly string[] = EXCLUDED_PATHS,
): LegacyMatch[] {
  const files: string[] = [];
  for (const root of roots) collectFiles(rootDir, root, excluded, files);

  const matches: LegacyMatch[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(rootDir, file), 'utf-8');
    content.split('\n').forEach((line, index) => {
      for (const identifier of LEGACY_IDENTIFIERS) {
        let from = line.indexOf(identifier);
        while (from !== -1) {
          matches.push({
            file,
            line: index + 1,
            column: from + 1,
            identifier,
          });
          from = line.indexOf(identifier, from + identifier.length);
        }
      }
    });
  }
  return matches;
}

/** Format one match as `file:line:column identifier`. */
export function formatMatch(match: LegacyMatch): string {
  return `${match.file}:${match.line}:${match.column} ${match.identifier}`;
}

export interface AllowlistDiff {
  /** Matches whose file does not allow that identifier. */
  unexpected: LegacyMatch[];
  /** `file identifier` pairs the allowlist still lists but the tree lost. */
  staleIdentifiers: string[];
  /** Allowlist paths with no legacy identifier left at all. */
  stalePaths: string[];
}

/** Compare a sweep against the allowlist (both directions). */
export function diffAgainstAllowlist(
  matches: readonly LegacyMatch[],
  allowlist: Readonly<Record<string, readonly LegacyIdentifier[]>>,
): AllowlistDiff {
  const actual = new Map<string, Set<string>>();
  for (const match of matches) {
    const set = actual.get(match.file) ?? new Set<string>();
    set.add(match.identifier);
    actual.set(match.file, set);
  }

  const unexpected = matches.filter(
    (match) => !(allowlist[match.file] ?? []).includes(match.identifier),
  );

  const staleIdentifiers: string[] = [];
  const stalePaths: string[] = [];
  for (const [file, allowed] of Object.entries(allowlist)) {
    const found = actual.get(file);
    if (!found || found.size === 0) {
      stalePaths.push(file);
      continue;
    }
    for (const identifier of allowed) {
      if (!found.has(identifier)) {
        staleIdentifiers.push(`${file} ${identifier}`);
      }
    }
  }

  return { unexpected, staleIdentifiers, stalePaths };
}

/** Render a diff as human-readable, actionable lines (empty when clean). */
export function formatDiff(diff: AllowlistDiff): string[] {
  const lines: string[] = [];
  for (const match of diff.unexpected) {
    lines.push(`unexpected legacy identifier: ${formatMatch(match)}`);
  }
  for (const entry of diff.staleIdentifiers) {
    lines.push(
      `stale allowlist entry: ${entry} (identifier gone — delete the entry)`,
    );
  }
  for (const entry of diff.stalePaths) {
    lines.push(
      `stale allowlist entry: ${entry} (no legacy identifier left — delete the entry)`,
    );
  }
  return lines;
}

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeFixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-id-guard-'));
  tempDirs.push(root);
  for (const [relPath, content] of Object.entries(files)) {
    const absolute = path.join(root, relPath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf-8');
  }
  return root;
}

describe('legacy choice-identifier guard', () => {
  it('detects each of the five identifiers, and skips excluded paths and types', () => {
    const fixture = makeFixture({
      'src/identifiers.ts': [
        'hasChoices',
        'acceptNextCardId',
        'rejectNextCardId',
        'choiceClarityLabels',
        'ChoiceClarityLabels',
        'derivedChoices = hasChoices',
      ].join('\n'),
      // Excluded by path (see EXCLUDED_PATHS / module doc comment).
      'core/storyline.ts': 'hasChoices',
      'build/generated.ts': 'hasChoices',
      'docs/.vitepress/dist/assets/app.json': '{"hasChoices":true}',
      'data/transcripts/run-1.json': '{"hasChoices":true}',
      '.worklog/items.md': 'hasChoices',
      'node_modules/pkg/index.ts': 'hasChoices',
      // Excluded by extension.
      'src/notes.txt': 'hasChoices',
      'src/art.svg': 'hasChoices',
    });

    const matches = collectMatches(fixture, [
      'src',
      'core',
      'build',
      'docs',
      'data',
      '.worklog',
      'node_modules',
    ]);

    expect(
      matches.map(
        (match) =>
          `${match.file}:${match.line}:${match.column} ${match.identifier}`,
      ),
    ).toEqual([
      'src/identifiers.ts:1:1 hasChoices',
      'src/identifiers.ts:2:1 acceptNextCardId',
      'src/identifiers.ts:3:1 rejectNextCardId',
      'src/identifiers.ts:4:1 choiceClarityLabels',
      'src/identifiers.ts:5:1 ChoiceClarityLabels',
      'src/identifiers.ts:6:18 hasChoices',
    ]);
    // Every identifier in the vocabulary is exercised by the fixture, so a
    // typo or a dropped alternative cannot silently neuter the guard.
    expect(new Set(matches.map((match) => match.identifier))).toEqual(
      new Set(LEGACY_IDENTIFIERS),
    );
  });

  it('documents the generated, historical and submodule exclusions', () => {
    expect(isExcluded('docs/.vitepress/dist/assets/app.json')).toBe(true);
    expect(isExcluded('data/transcripts/main-street/run-1.json')).toBe(true);
    expect(isExcluded('build/bundle.js')).toBe(true);
    expect(isExcluded('core/scripts/vite-game-discovery-plugin.ts')).toBe(true);
    expect(isExcluded('.worklog/worklog-data.jsonl')).toBe(true);
    expect(
      isExcluded('tests/main-street/legacy-choice-identifiers.test.ts'),
    ).toBe(true);
    expect(isExcluded('src/MainStreetStoryline.ts')).toBe(false);
    expect(isExcluded('docs/game/storylines.md')).toBe(false);
    // `docs/dev/` is scanned even though `docs/.vitepress/dist/` is not.
    expect(isExcluded('docs/dev/assets/storyline-manifest.json')).toBe(false);
  });

  it('reports unexpected matches and stale allowlist entries', () => {
    const matches: LegacyMatch[] = [
      { file: 'src/a.ts', line: 1, column: 1, identifier: 'hasChoices' },
      { file: 'src/b.ts', line: 2, column: 3, identifier: 'acceptNextCardId' },
    ];

    expect(
      diffAgainstAllowlist(matches, {
        'src/a.ts': ['hasChoices', 'rejectNextCardId'],
        'src/gone.ts': ['hasChoices'],
      }),
    ).toEqual({
      unexpected: [matches[1]],
      staleIdentifiers: ['src/a.ts rejectNextCardId'],
      stalePaths: ['src/gone.ts'],
    });

    expect(
      formatDiff(
        diffAgainstAllowlist(matches, {
          'src/a.ts': ['hasChoices', 'rejectNextCardId'],
          'src/b.ts': ['acceptNextCardId'],
        }),
      ),
    ).toEqual([
      'stale allowlist entry: src/a.ts rejectNextCardId (identifier gone — delete the entry)',
    ]);

    expect(
      formatDiff(diffAgainstAllowlist(matches, {
        'src/a.ts': ['hasChoices'],
        'src/b.ts': ['acceptNextCardId'],
      })),
    ).toEqual([]);
  });

  it('the allowlist matches the tree exactly', () => {
    const matches = collectMatches(PROJECT_ROOT);
    const diff = diffAgainstAllowlist(matches, LEGACY_ALLOWLIST);

    expect(
      formatDiff(diff),
      'A new legacy identifier appeared (remove it or, while migrating, add it to LEGACY_ALLOWLIST), ' +
        'or an allowlist entry is stale (delete it).',
    ).toEqual([]);
  });

  // Test-first (red) phase: turns green-by-inversion once the allowlist is
  // empty. The closing slice of parent MS-0MVZLKEU5000Q7SQ flips `it.fails`
  // to a plain `it` and deletes the now-empty LEGACY_ALLOWLIST.
  it.fails('no legacy choice identifiers remain in the tree', () => {
    expect(collectMatches(PROJECT_ROOT).map(formatMatch)).toEqual([]);
    expect(Object.keys(LEGACY_ALLOWLIST)).toEqual([]);
  });
});
