/**
 * Scaffold entry-point documentation guard (MS-0MVSB5Y83001XSU2)
 *
 * The parent item (MS-0MVO30VXS002A1Z0) removed the dead `scaffold:game` /
 * `scaffold:games` npm scripts from generated game repos: they point at
 * `scripts/game-repo-scaffold.ts`, a file that exists only in the core
 * checkout (Option C — a game repo has no root `scripts/` tree). The working
 * game-repo entry point is `npm run scaffold`, which drives the engine-owned
 * generator via `--core-root ./core`.
 *
 * The documentation contract this guard pins:
 *
 * AC1 — `docs/dev/build-and-release.md` names `npm run scaffold` as the
 *       game-repo scaffold entry point and carries its `--core-root ./core`
 *       construction.
 * AC2 — The same doc states that `scaffold:game` / `scaffold:games` are
 *       **core-checkout-only** commands. That is the one legitimate mention:
 *       it names the two keys only to say they must NOT be declared or run in
 *       a game repo.
 * AC3 — No other game-repo-context doc references `scaffold:game(s)`. A
 *       return of either key in any other `docs/` file (or in
 *       `build-and-release.md` outside its core-only disclaimer) is the
 *       dead-script regression class this item removed, so it fails here at
 *       test time.
 *
 * This is a doc-drift guard in the same shape as
 * `tests/main-street/engine-pin-docs.test.ts`: it asserts semantic anchors
 * (the entry-point construction, the core-only disclaimer), never prose
 * headings.
 *
 * @module tests/main-street/scaffold-docs-drift
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const DOCS = path.join(REPO_ROOT, 'docs');
const BUILD_DOC = path.join(DOCS, 'dev', 'build-and-release.md');

/** Either core-checkout-only key (`scaffold:game` matches both keys). */
const CORE_ONLY_SCRIPT = /scaffold:game(?:s)?/;

/** All markdown files under `docs/`, recursively, as absolute paths. */
function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...markdownFiles(full));
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

describe('scaffold entry-point docs (MS-0MVSB5Y83001XSU2)', () => {
  const buildDoc = fs.readFileSync(BUILD_DOC, 'utf8');

  it('names `npm run scaffold` as the game-repo entry point with --core-root ./core', () => {
    // AC1: the entry point is the game-repo scaffold entry point…
    expect(buildDoc).toMatch(/game-repo scaff(?:old)? entry point/i);
    // …resolves through the `./core` submodule, and carries `--core-root ./core`.
    expect(buildDoc).toContain('--core-root ./core');
    expect(buildDoc).toContain('core/scripts/game-repo-scaffold.ts');
  });

  it('states that scaffold:game / scaffold:games are core-checkout-only', () => {
    // AC2: every paragraph that mentions a core-only key must carry the
    // `core-checkout-only` disclaimer — the mention exists only to say the
    // keys must NOT be declared or run in a game repo.
    const paragraphs = buildDoc.split(/\n\n+/);
    const mentions = paragraphs.filter((p) => CORE_ONLY_SCRIPT.test(p));
    expect(mentions.length).toBeGreaterThan(0);
    for (const paragraph of mentions) {
      expect(paragraph.toLowerCase()).toContain('core-checkout-only');
    }
  });

  it('keeps scaffold:game(s) out of every other game-repo doc', () => {
    // AC3: no other doc under `docs/` may reference either key.
    const offenders = markdownFiles(DOCS)
      .filter((file) => file !== BUILD_DOC)
      .filter((file) => CORE_ONLY_SCRIPT.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(REPO_ROOT, file))
      .sort();
    expect(offenders).toEqual([]);
  });
});
