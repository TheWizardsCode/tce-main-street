/**
 * Launcher scaffold-drift guard (MS-0MVU03TR0006KZDH).
 *
 * `./main.ts` is not hand-authored: it is the output of the engine-owned
 * generator `core/scripts/game-repo-scaffold.ts` (`renderMainTs()`), which
 * `npm run scaffold` writes verbatim. Two failure modes have already cost us a
 * release each, and both are silent:
 *
 * 1. **Hand-edit drift.** Explanations (the CANVAS→AUTO rationale, the
 *    ContainerClip renderer notes) were written as comments inside `main.ts`,
 *    so the next `npm run scaffold` destroyed them and reverted the renderer
 *    line with them.
 * 2. **Generator regression.** A generator that emits `type: Phaser.CANVAS`
 *    turns every re-scaffolded launcher back into Canvas, where Phaser 4's
 *    Filter/mask pipeline is unavailable (CG-0MVTQ3WPV003ZECA).
 *
 * This guard closes both: the committed launcher must be byte-for-byte the
 * generator's output, so launcher commentary can only ever live in the
 * generator or in `docs/` — never as a hand edit. It is sensitive by
 * construction: append any comment to `./main.ts` and this file fails.
 *
 * @module tests/main-street/main-ts-scaffold-drift
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderMainTs } from '@core-scripts/game-repo-scaffold';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const MAIN_TS_PATH = path.join(PROJECT_ROOT, 'main.ts');

/** The launcher as committed (what `npm run scaffold` must leave behind). */
function readCommittedMainTs(): string {
  return fs.readFileSync(MAIN_TS_PATH, 'utf8');
}

describe('main.ts — generator-owned, drift-guarded (AC1, AC4)', () => {
  it('is byte-for-byte the output of renderMainTs()', () => {
    // A diff here means either `npm run scaffold` was not run after a
    // generator change, or someone hand-edited the generated file. Regenerate
    // (never hand-patch) and move the explanation into docs/ or the generator.
    expect(readCommittedMainTs()).toBe(renderMainTs());
  });

  it('never pins the Canvas renderer — the launcher boots with Phaser.AUTO', () => {
    const mainTs = readCommittedMainTs();

    expect(mainTs).toMatch(/^\s*type: Phaser\.AUTO,$/m);
    expect(mainTs).not.toMatch(/Phaser\.CANVAS/);
  });
});
