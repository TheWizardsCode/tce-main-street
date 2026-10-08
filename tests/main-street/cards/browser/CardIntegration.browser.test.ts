/**
 * Main Street: Card integration definitions (browser / Playwright).
 *
 * Runs the explicit per-card definition for every card discovered in
 * `src/card-data.csv` against the real `MainStreetScene`, installs the
 * resulting engine state into the live scene, and asserts the player-facing
 * HUD reflects it. Results are posted to the Vite server, which writes the
 * `browserTestStatus` / `browserTestFailReason` columns back into the CSV.
 *
 * @module
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MainStreetState } from '../../../../src/MainStreetState';
import type { CardTestResult } from '../CardTestTypes';
import { createDefaultRegistry } from '../CardTestRegistry';
import { BROWSER_RESULT_TARGETS } from '../ResultColumns';
import { newGame } from '../helpers/stateBuilders';
import {
  assertHudShowsState,
  bootScene,
  destroyScene,
  installState,
  waitFrames,
  type SceneHarness,
} from './sceneHarness';

const registry = createDefaultRegistry();
const cards = registry.discoverCards();
const results: CardTestResult[] = [];
let harness: SceneHarness | null = null;

beforeAll(async () => {
  harness = await bootScene();
}, 60_000);

afterAll(async () => {
  if (results.length > 0) {
    const response = await fetch('/__card-results', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ results, targets: BROWSER_RESULT_TARGETS }),
    });
    if (!response.ok) {
      // Surface a write failure without masking test outcomes.
      throw new Error(`Failed to persist browser card results: ${response.status}`);
    }
  }
  destroyScene(harness);
  harness = null;
});

describe('Main Street browser card integration definitions', () => {
  it('discovers every card in card-data.csv', () => {
    expect(cards.length).toBe(175);
  });

  for (const card of cards) {
    it(`${card.family}: ${card.id} (${card.name})`, async () => {
      let controlled: MainStreetState | undefined;
      const factory = (seed: string): MainStreetState => {
        controlled = newGame(seed);
        return controlled;
      };

      const result = registry.runCard(card, factory);
      results.push(result);
      if (result.status === 'fail') {
        throw new Error(result.failReason);
      }
      if (!controlled) {
        throw new Error(`${card.id}: no controlled state was created.`);
      }

      // Reflect the driven state in the real scene and assert the HUD.
      installState(harness!.scene, controlled);
      await waitFrames(2);
      assertHudShowsState(harness!.scene, controlled);
    });
  }
});
