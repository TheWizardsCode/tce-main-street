/**
 * Documentation path drift guard (MS-0MUNC8AOL0092BE5)
 *
 * After the src/ migration, `docs/` must never reference the old
 * `example-games/main-street/` layout again. This guard recursively scans
 * every file under `docs/` (text files — `.md`, `.json`, `.ts`, `.mmd`,
 * `.svg`, ...) and fails on any occurrence of the stale prefix.
 *
 * AC1 — the substring `example-games/main-street/` does not appear anywhere
 *       under `docs/`.
 * AC4 — the guard detects an injected reference (negative case).
 *
 * Binary files (e.g. `*.png` screenshots) are skipped: they cannot legally
 * contain the ASCII prefix, and reading them as UTF-8 would throw or garble
 * the scan.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DOCS_ROOT = path.join(PROJECT_ROOT, 'docs');
const STALE_PREFIX = 'example-games/main-street/';

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.json',
  '.ts',
  '.js',
  '.mjs',
  '.mmd',
  '.svg',
  '.txt',
  '.yaml',
  '.yml',
]);

function isTextFile(file: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

/** Recursively yield every file path under `docs/`. */
function walkDocs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkDocs(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** Collect every (relative path, line) pair under `docs/` containing the stale prefix. */
function findStaleReferences(): Array<{ file: string; line: string }> {
  const hits: Array<{ file: string; line: string }> = [];
  for (const file of walkDocs(DOCS_ROOT)) {
    if (!isTextFile(file)) continue;
    let contents: string;
    try {
      contents = fs.readFileSync(file, 'utf-8');
    } catch {
      // Unreadable / binary files are skipped — the ASCII prefix cannot appear.
      continue;
    }
    for (const [i, line] of contents.split('\n').entries()) {
      if (line.includes(STALE_PREFIX)) {
        hits.push({ file: path.relative(PROJECT_ROOT, file), line: `${i + 1}: ${line.trim()}` });
      }
    }
  }
  return hits;
}

describe('docs path drift guard (AC1)', () => {
  it('expects docs/ to exist', () => {
    expect(fs.existsSync(DOCS_ROOT)).toBe(true);
  });

  it('no file under docs/ contains the stale example-games/main-street/ prefix', () => {
    const hits = findStaleReferences();
    expect(hits).toEqual([]);
  });
});

describe('guard negative case (AC4)', () => {
  it('detects an injected stale reference', () => {
    const docPath = path.join(DOCS_ROOT, 'README-drift-probe.tmp.md');
    fs.writeFileSync(docPath, `# probe\n\nSee ${STALE_PREFIX}MainStreetEngine.ts for details.\n`);
    try {
      const hits = findStaleReferences();
      expect(hits.some((h) => h.file.endsWith('README-drift-probe.tmp.md'))).toBe(true);
    } finally {
      fs.rmSync(docPath, { force: true });
    }
  });
});
