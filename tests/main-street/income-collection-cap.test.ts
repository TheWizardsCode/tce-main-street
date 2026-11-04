/**
 * Main Street: End-of-turn income-collection cap — single source of truth
 *
 * MS-0MVLINWHE004W4CP / MS-0MVMKEU2000639TG. The safety cap that bounds the
 * end-of-turn income-collection deferral is consumed in exactly two places:
 *
 *   1. the shared wall-clock bounded-deferral helper
 *      (`deferUntilIncomeCollected`, `MainStreetTurnControllerAnimation`),
 *      which every deferral site now delegates to, and
 *   2. the closing primitive's `incomeCollectionCapMs` default in that same
 *      module, which feeds the helper's per-site `capMs` override.
 *
 * This replaces the pre-adoption pin, which counted the three duplicated
 * inline `startAt = <scene clock> + INCOME_COLLECTION_CAP_MS` polls in the turn
 * flow. Those polls are gone (they observed the cap only at scene-clock poll
 * boundaries, which is the starvation defect), so the pin now asserts the
 * structural inverse: no inline cap deadline and no inline 250 ms scene-clock
 * poll survives in either module, and every deferral site routes through the
 * helper. The literal is never restated here: the source-scan pattern is
 * derived from the imported constant.
 *
 * The helper's cap is pinned behaviourally while its consumers are pinned
 * structurally (a source scan scoped to this repo's own modules).
 *
 * @module tests/main-street/income-collection-cap
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { INCOME_COLLECTION_CAP_MS } from '../../src/scenes/MainStreetAnimatorTiming';
import {
  deferUntilIncomeCollected,
  getDefaultIncomeCollectionCapMs,
} from '../../src/scenes/MainStreetTurnControllerAnimation';

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

describe('deferral sites route through the shared helper (decision C adoption)', () => {
  it('leaves no inline income-collection poll in either module', () => {
    // Every deferral site delegates to `deferUntilIncomeCollected`. A new
    // inline scene-clock deadline/poll would re-introduce the starvation
    // defect the helper removes: the cap was observed only at clamped
    // scene-clock poll boundaries, so a starved rAF detected it late.
    const modules: Array<[string, string]> = [
      ['MainStreetTurnControllerTurnFlow.ts', TURN_FLOW_SOURCE],
      ['MainStreetTurnControllerAnimation.ts', ANIMATION_SOURCE],
    ];
    for (const [name, source] of modules) {
      expect(source, `${name} still declares a scene-clock cap deadline`)
        .not.toMatch(/startAt/);
      expect(source, `${name} still schedules its own 250 ms poll`)
        .not.toMatch(/delayedCall\(\s*250/);
      expect(source, `${name} still schedules its own 250 ms poll via scheduleOrRun`)
        .not.toMatch(/scheduleOrRun\(\s*s,\s*250/);
    }
  });

  it('routes every deferral site through deferUntilIncomeCollected', () => {
    const callSites = (source: string): number =>
      source.match(/deferUntilIncomeCollected\(\s*s,/g)?.length ?? 0;
    // Five in the turn flow (`advanceTurn`, the turn-summary gate, the loan
    // offer, the event choice and the piggyback decision) and two in the
    // animation module (the closing presentation and the incident-reveal
    // gating). A site that stops using the helper must fail this pin.
    expect(callSites(TURN_FLOW_SOURCE)).toBe(5);
    expect(callSites(ANIMATION_SOURCE)).toBe(2);
  });
});

describe('MainStreetTurnControllerAnimation default (consumer 4)', () => {
  it('defaults incomeCollectionCapMs to INCOME_COLLECTION_CAP_MS', () => {
    expect(ANIMATION_SOURCE).toMatch(
      /incomeCollectionCapMs\s*\?\?\s*INCOME_COLLECTION_CAP_MS/,
    );
  });

  it('leaves no restated cap literal in the turn flow', () => {
    // After adoption the turn flow holds no cap value of its own: it delegates
    // to the helper, so the cap cannot drift per site.
    expect(TURN_FLOW_SOURCE.replace(/INCOME_COLLECTION_CAP_MS/g, ''))
      .not.toMatch(capLiteralPattern());
  });

  it('carries no restated cap literal once the constant references are removed', () => {
    const withoutConstant = ANIMATION_SOURCE.replace(/INCOME_COLLECTION_CAP_MS/g, '');
    const literals = withoutConstant.match(capLiteralPattern()) ?? [];
    expect(literals).toHaveLength(0);
  });
});

/**
 * MS-0MVMKEU2000639TG (decision C): the wall-clock bounded-deferral helper is
 * the single place the cap is enforced. Pinning it here means the extraction
 * cannot silently drift back into per-site literals: the helper consumes the
 * exported constant (never a restated number) and an injected `capMs` actually
 * overrides the bound it enforces.
 */
describe('deferUntilIncomeCollected consumes the shared cap (decision C)', () => {
  it('defaults its cap to INCOME_COLLECTION_CAP_MS', () => {
    const scene: any = {
      incomeCollectionActive: true,
      time: { now: 0, delayedCall: () => {} },
    };
    const armed: number[] = [];
    let now = 0;

    deferUntilIncomeCollected(scene, () => {}, {
      now: () => now,
      schedule: (_cb, delayMs) => {
        armed.push(delayMs);
        return armed.length;
      },
      clear: () => {},
    });

    // The bound the helper arms is the production constant, not a literal.
    expect(armed).toEqual([INCOME_COLLECTION_CAP_MS]);
    expect(now).toBe(0);
  });

  it('honours an injected cap override instead of the default', () => {
    const scene: any = {
      incomeCollectionActive: true,
      time: { now: 0, delayedCall: () => {} },
    };
    const armed: number[] = [];

    deferUntilIncomeCollected(scene, () => {}, {
      now: () => 0,
      schedule: (_cb, delayMs) => {
        armed.push(delayMs);
        return armed.length;
      },
      clear: () => {},
      capMs: INCOME_COLLECTION_CAP_MS / 2,
    });

    expect(armed).toEqual([INCOME_COLLECTION_CAP_MS / 2]);
  });

  it('names the shared constant in the helper source rather than restating it', () => {
    const helper = ANIMATION_SOURCE.match(
      /capMs\s*\?\?\s*INCOME_COLLECTION_CAP_MS/,
    );
    expect(helper).not.toBeNull();
  });
});
