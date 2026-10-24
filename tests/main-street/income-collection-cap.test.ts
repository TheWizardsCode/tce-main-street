/**
 * Main Street: End-of-turn income-collection cap — single source of truth
 *
 * MS-0MVLINWHE004W4CP. The safety cap that bounds the end-of-turn
 * income-collection deferral is consumed in four places:
 *
 *   1. the day-start deferral in `MainStreetTurnControllerTurnFlow`,
 *   2. the forced event-choice dialog deferral there,
 *   3. the forced piggyback-decision show deferral there, and
 *   4. the closing primitive's `incomeCollectionCapMs` default in
 *      `MainStreetTurnControllerAnimation`.
 *
 * These tests pin all four consumers to the single exported
 * `INCOME_COLLECTION_CAP_MS`, so a hand-guessed literal drifting away from
 * the exported cap (the historical wait-race defect) becomes structurally
 * impossible. The literal is never restated here: the source-scan pattern is
 * derived from the imported constant, and the consumers are located via the
 * named constant rather than a value.
 *
 * The three turn-flow deferrals are private closures, so their agreement with
 * the cap is pinned structurally (a source scan scoped to this repo's own
 * module) while the closing default is pinned behaviourally through its
 * exported accessor.
 *
 * @module tests/main-street/income-collection-cap
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { INCOME_COLLECTION_CAP_MS } from '../../src/scenes/MainStreetAnimatorTiming';
import { getDefaultIncomeCollectionCapMs } from '../../src/scenes/MainStreetTurnControllerAnimation';

const SCENES_DIR = path.resolve(__dirname, '../../src/scenes');

/** Read a module from `src/scenes` as UTF-8 source text. */
function readSceneSource(file: string): string {
  return fs.readFileSync(path.join(SCENES_DIR, file), 'utf8');
}

/**
 * A pattern matching the cap's decimal value in source, tolerating numeric
 * separator underscores (both `16000` and `16_000` spellings).
 *
 * Derived from {@link INCOME_COLLECTION_CAP_MS} so the test never restates
 * the literal value; a future cap change keeps this guard accurate.
 */
function capLiteralPattern(): RegExp {
  const digits = String(INCOME_COLLECTION_CAP_MS).split('');
  return new RegExp(`\\b${digits.join('_?')}\\b`, 'g');
}

const TURN_FLOW_SOURCE = readSceneSource('MainStreetTurnControllerTurnFlow.ts');
const ANIMATION_SOURCE = readSceneSource('MainStreetTurnControllerAnimation.ts');

describe('INCOME_COLLECTION_CAP_MS', () => {
  it('is a positive whole-millisecond bound', () => {
    expect(Number.isInteger(INCOME_COLLECTION_CAP_MS)).toBe(true);
    expect(INCOME_COLLECTION_CAP_MS).toBeGreaterThan(0);
  });

  it('is the closing primitive default (consumer 4)', () => {
    // The exported accessor is the production default the primitive applies
    // when the caller passes no explicit `incomeCollectionCapMs`.
    expect(getDefaultIncomeCollectionCapMs()).toBe(INCOME_COLLECTION_CAP_MS);
  });
});

describe('MainStreetTurnControllerTurnFlow deferral sites (consumers 1-3)', () => {
  it('consumes INCOME_COLLECTION_CAP_MS at exactly three income deferrals', () => {
    const sites = TURN_FLOW_SOURCE.match(
      /startAt\s*=\s*s\.time\.now\s*\+\s*INCOME_COLLECTION_CAP_MS/g,
    );
    expect(sites).toHaveLength(3);
  });

  it('carries no restated cap literal once the constant references are removed', () => {
    const withoutConstant = TURN_FLOW_SOURCE.replace(/INCOME_COLLECTION_CAP_MS/g, '');
    const literals = withoutConstant.match(capLiteralPattern()) ?? [];
    expect(literals).toHaveLength(0);
  });
});

describe('MainStreetTurnControllerAnimation default (consumer 4)', () => {
  it('defaults incomeCollectionCapMs to INCOME_COLLECTION_CAP_MS', () => {
    expect(ANIMATION_SOURCE).toMatch(
      /incomeCollectionCapMs\s*\?\?\s*INCOME_COLLECTION_CAP_MS/,
    );
  });

  it('carries no restated cap literal once the constant references are removed', () => {
    const withoutConstant = ANIMATION_SOURCE.replace(/INCOME_COLLECTION_CAP_MS/g, '');
    const literals = withoutConstant.match(capLiteralPattern()) ?? [];
    expect(literals).toHaveLength(0);
  });
});
