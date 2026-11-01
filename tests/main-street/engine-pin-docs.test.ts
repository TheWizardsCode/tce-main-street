/**
 * Documentation guard: the current engine pin is never hard-coded in prose.
 *
 * Background (MS-0MVQO6N34007DHP8, AC5): `npm run build` runs `engine:sync`,
 * which re-pins `configs/engine-pin.json` (and the `core` gitlink) to the
 * core `dev` tip on every dev build. A sha written into documentation as the
 * *current* pin is therefore stale by design as soon as the engine moves.
 *
 * That is exactly what happened after the `0409c1eb` hold was retired: the
 * audit that closed this item found `docs/dev/build-and-release.md` still
 * naming the pin from the re-pin commit while `configs/engine-pin.json` had
 * been advanced again by a later build. The documentation contract is now
 * "the pin file is the single source of truth": prose may cite a sha as
 * history (the retired-hold narrative does), but a line claiming the pin is
 * *current* must point at `configs/engine-pin.json` instead of quoting a sha.
 *
 * This guard fails loudly if a currency claim re-acquires a literal sha, so
 * the drift class cannot silently return.
 *
 * @module tests/main-street/engine-pin-docs
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const DOCS_DEV = path.join(REPO_ROOT, 'docs', 'dev');
const PIN_REL = path.join('configs', 'engine-pin.json');
const BUILD_DOC_REL = path.join('docs', 'dev', 'build-and-release.md');

/** A git object id short enough to be a real commit reference. */
const SHA_LITERAL = /\b[0-9a-f]{7,40}\b/i;

/** Lines (plus wrapped continuation lines) that claim what the pin *is*. */
const CURRENCY_CLAIM = /\bcurrent pin\b/i;

/**
 * Return the currency-claim paragraphs of one markdown document.
 *
 * A claim starts on the line naming the current pin and runs until the next
 * blank line, which is how the pin paragraph is wrapped in this repo's docs.
 */
function currentPinClaims(markdown: string): { line: number; text: string }[] {
  const lines = markdown.split('\n');
  const claims: { line: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!CURRENCY_CLAIM.test(lines[i])) continue;

    const paragraph = [lines[i]];
    for (let j = i + 1; j < lines.length && lines[j].trim() !== ''; j += 1) {
      paragraph.push(lines[j]);
    }
    claims.push({ line: i + 1, text: paragraph.join('\n') });
  }

  return claims;
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

describe('engine pin documentation', () => {
  it('records a well-formed pin sha in configs/engine-pin.json', () => {
    const pin = JSON.parse(read(PIN_REL)) as { sha?: string };

    expect(pin.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('states the pin policy without hard-coding the current sha', () => {
    const claims = currentPinClaims(read(BUILD_DOC_REL));

    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(
        SHA_LITERAL.test(claim.text),
        `docs/dev/build-and-release.md:${claim.line} hard-codes a sha in a `
          + `current-pin claim; point at ${PIN_REL} instead (the pin advances on `
          + `every dev build):\n${claim.text}`,
      ).toBe(false);
    }
  });

  it('names configs/engine-pin.json as the source of truth for the pin', () => {
    const claims = currentPinClaims(read(BUILD_DOC_REL));

    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(
        claim.text,
        `docs/dev/build-and-release.md:${claim.line} must reference ${PIN_REL}`,
      ).toContain(PIN_REL);
    }
  });

  it('keeps every docs/dev page free of hard-coded current-pin sha claims', () => {
    const offenders: string[] = [];

    for (const entry of fs.readdirSync(DOCS_DEV)) {
      if (!entry.endsWith('.md')) continue;

      const relativePath = path.join('docs', 'dev', entry);
      for (const claim of currentPinClaims(read(relativePath))) {
        if (SHA_LITERAL.test(claim.text)) {
          offenders.push(`${relativePath}:${claim.line}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
