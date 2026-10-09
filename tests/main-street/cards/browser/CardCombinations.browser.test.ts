/**
 * Main Street: Staff combination tests (browser / Playwright).
 *
 * Runs up to three cross-card combination checks for each staff card against
 * a controlled state, installs the result into the real `MainStreetScene`, and
 * asserts the HUD reflects it (AC3 of the browser framework child).
 *
 * @module
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StaffCard } from '../../../../src/MainStreetCards';
import { createDefaultRegistry } from '../CardTestRegistry';
import { resolveCardTemplate } from '../helpers/cardFixture';
import { newGame } from '../helpers/stateBuilders';
import { combinationsFor, STAFF_COMBINATIONS } from '../definitions/combinations';
import {
  assertHudShowsState,
  bootScene,
  destroyScene,
  installState,
  waitFrames,
  type SceneHarness,
} from './sceneHarness';

const registry = createDefaultRegistry();
const staffCards = registry
  .discoverCards()
  .filter(card => card.family === 'staff')
  .map(row => resolveCardTemplate(row.id, 'staff') as StaffCard);

let harness: SceneHarness | null = null;

beforeAll(async () => {
  harness = await bootScene();
}, 60_000);

afterAll(() => {
  destroyScene(harness);
  harness = null;
});

describe('Main Street browser staff combination definitions', () => {
  it('covers every required combination category', () => {
    const ids = STAFF_COMBINATIONS.map(combination => combination.id);
    expect(ids).toContain('per-business-scoping');
    expect(ids).toContain('upgrade-interaction');
  });

  for (const staff of staffCards) {
    for (const combination of combinationsFor(staff)) {
      it(`${staff.id} — ${combination.title}`, async () => {
        const state = combination.run(staff, newGame);
        installState(harness!.scene, state);
        await waitFrames(2);
        assertHudShowsState(harness!.scene, state);
      });
    }
  }
});
