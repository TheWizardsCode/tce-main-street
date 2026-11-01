/**
 * Clipping documentation drift guard (MS-0MVU03UPW009MVD1).
 *
 * `docs/dev/testing.md` and the `src/README.md` "Viewport clipping" bullet kept
 * describing the WebGL clipping gap after it had closed: the testing doc
 * excused every Canvas-only `setMask` warning raised inside the `core`
 * submodule (tracked in `MS-0MVTE0UP00013TNW`), and the README still listed the
 * core-owned panels as Canvas-only.
 *
 * The documentation is the only artefact this item ships, so these tests couple
 * the prose to the artefacts it describes instead of restating it:
 *
 * 1. the reference WebGL test still captures warnings with **no** source
 *    filter — the docs may not claim an exclusion the test no longer has;
 * 2. `docs/dev/testing.md` states the zero-tolerance rule and the
 *    generator-owned `./main.ts` rule;
 * 3. the `src/README.md` "Viewport clipping" bullet names the engine helper as
 *    the single implementation and keeps no deferral/Canvas-only claim;
 * 4. no tracked doc points at the deleted local `src/ContainerClip.ts`.
 *
 * @module tests/main-street/clipping-docs-drift
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '../..');

const CLIPPING_TEST = 'tests/main-street/webgl-renderer-clipping.browser.test.ts';
const TESTING_DOC = 'docs/dev/testing.md';
const MODULE_DOC = 'src/README.md';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/** Collapse line wrapping so prose assertions do not depend on line breaks. */
function flatten(markdown: string): string {
  return markdown.replace(/\s+/g, ' ').trim();
}

/**
 * The body of the `- **<label>**` bullet that starts in `markdown`.
 *
 * The bullet runs until the next bullet or heading, so a stale sentence cannot
 * hide outside the snippet the test inspects while still living in the same
 * bullet. Throws when the label is absent — a renamed bullet must fail loudly
 * rather than pass vacuously.
 */
function readBullet(markdown: string, label: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.includes(`**${label}**`));
  if (start === -1) throw new Error(`bullet "${label}" not found`);

  const body = [lines[start]];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^- \*\*/.test(lines[i]) || /^#{1,6} /.test(lines[i])) break;
    body.push(lines[i]);
  }
  return flatten(body.join(' '));
}

/** Every markdown file under `docs/` and `src/`. */
function markdownFiles(roots: readonly string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.vitepress') continue;
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        files.push(full);
      }
    }
  };
  for (const root of roots) walk(path.join(REPO_ROOT, root));
  return files;
}

describe('WebGL clipping test — zero-tolerance warning capture', () => {
  const source = read(CLIPPING_TEST);

  it('filters Canvas-only warnings by message only, never by origin', () => {
    // The zero-tolerance claim in the docs is only true while the capture has
    // no path filter: an `/core/` exclusion would silently re-open the gap the
    // docs now say is closed.
    expect(source).not.toMatch(/inRepoCanvasOnlyWarnings/);

    const body = /function canvasOnlyWarnings\(\)[^{]*\{\s*([^}]*)\}/.exec(source);
    expect(body, 'canvasOnlyWarnings() must exist in the WebGL test').not.toBeNull();
    expect(body![1]).toContain('CANVAS_ONLY_WARNING');
    expect(body![1]).not.toMatch(/core|startsWith|includes/);
  });
});

describe('docs/dev/testing.md — WebGL clipping claims', () => {
  const doc = flatten(read(TESTING_DOC));

  it('states that the WebGL test allows zero Canvas-only warnings from any source', () => {
    expect(doc).toContain('**zero** `setMask … not supported in WebGL` warnings');
    expect(doc).toContain('from **any** source');
  });

  it('no longer excuses warnings raised inside the core submodule', () => {
    expect(doc).not.toMatch(/core-owned call sites[^.]*\bexclud/i);
    expect(doc).not.toContain('excluded because they are not editable');
    expect(doc).not.toContain('MS-0MVTE0UP00013TNW');
  });

  it('records that ./main.ts is generator-owned and must never be hand-edited', () => {
    expect(doc).toContain('./main.ts');
    expect(doc).toContain('generator-owned');
    expect(doc).toContain('core/scripts/game-repo-scaffold.ts');
    expect(doc).toMatch(/never (edit|hand-edit)/i);
  });
});

describe('src/README.md — "Viewport clipping" bullet', () => {
  const bullet = readBullet(read(MODULE_DOC), 'Viewport clipping.');

  it('names the engine helper as the single renderer-aware implementation', () => {
    expect(bullet).toContain('@ui/ContainerClip');
    expect(bullet).toContain('createContainerClip()');
    expect(bullet).toMatch(/single/i);
    expect(bullet).toContain('renderer-aware');
    // The helper the bullet names must actually exist in the composed engine.
    expect(fs.existsSync(path.join(REPO_ROOT, 'core/src/ui/ContainerClip.ts'))).toBe(true);
  });

  it('keeps no deferral or Canvas-only claim for the core-owned panels', () => {
    expect(bullet).not.toMatch(/still use|deferred|still Canvas-only/i);
    expect(bullet).not.toMatch(/tracked in `MS-0MVTE0UP00013TNW`/);
    expect(bullet).toMatch(/renderer-aware end to end|whole clipping pipeline is renderer-aware/i);
  });
});

describe('clipping docs — no reference to the deleted local helper', () => {
  it('never points at src/ContainerClip.ts (the local copy removed in MS-0MVU03U2P0075VJX)', () => {
    const offenders = markdownFiles(['docs', 'src'])
      .filter((file) => read(path.relative(REPO_ROOT, file)).includes('src/ContainerClip.ts'))
      .map((file) => path.relative(REPO_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
