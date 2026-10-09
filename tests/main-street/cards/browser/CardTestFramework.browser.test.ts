/**
 * Main Street: Browser card framework meta-tests.
 *
 * Proves the browser framework fails on a missing definition and a
 * deliberately wrong expectation, and that the HUD assertion genuinely
 * reflects the installed state (rather than passing vacuously).
 *
 * @module
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CardTestRegistry } from '../CardTestRegistry';
import { newGame } from '../helpers/stateBuilders';
import {
  assertHudShowsState,
  bootScene,
  destroyScene,
  installState,
  waitFrames,
  type SceneHarness,
} from './sceneHarness';

function makeRow(id: string) {
  return { id, family: 'business' as const, name: id, row: { id, family: 'business', name: id } };
}

let harness: SceneHarness | null = null;

beforeAll(async () => {
  harness = await bootScene();
}, 60_000);

afterAll(() => {
  destroyScene(harness);
  harness = null;
});

describe('Browser card framework meta-tests', () => {
  it('reports a card with no definition as a failure', () => {
    const registry = new CardTestRegistry();
    const result = registry.runCard(makeRow('biz-unregistered'));
    expect(result.status).toBe('fail');
    expect(result.failReason).toMatch(/No test definition registered/);
  });

  it('fails on a deliberately wrong expectation', () => {
    const registry = new CardTestRegistry();
    registry.register({
      cardId: 'biz-bakery',
      family: 'business',
      verifies: 'deliberately wrong',
      run: () => {
        throw new Error('expected 42, observed 7');
      },
    });
    const result = registry.runCard(makeRow('biz-bakery'), newGame);
    expect(result.status).toBe('fail');
    expect(result.failReason).toContain('expected 42, observed 7');
  });

  it('injects the supplied state factory into the definition context', () => {
    const registry = new CardTestRegistry();
    let seenSeed = '';
    registry.register({
      cardId: 'biz-bakery',
      family: 'business',
      verifies: 'captures seed',
      run: context => {
        context.createState('injected-seed');
      },
    });
    registry.runCard(makeRow('biz-bakery'), seed => {
      seenSeed = seed;
      return newGame(seed);
    });
    expect(seenSeed).toBe('injected-seed');
  });

  it('asserts the live HUD reflects the installed state (and fails when stale)', async () => {
    const state = newGame('browser-meta-hud');
    installState(harness!.scene, state);
    await waitFrames(2);
    expect(() => assertHudShowsState(harness!.scene, state)).not.toThrow();

    // Mutate without refreshing: the HUD is now stale, so the assertion fails.
    state.resourceBank.coins += 7;
    expect(() => assertHudShowsState(harness!.scene, state)).toThrow(/Coins:/);
  });
});
