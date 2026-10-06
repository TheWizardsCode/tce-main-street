/**
 * Main Street: Challenge HUD live progress (MS-0MUI7ZJK8003HY9J).
 *
 * Browser-profile test: boots the game and asserts the challenge tracker
 * renders `<current>/<target>` for progress-capable challenges (Serial Seller)
 * and leaves progress-less challenges unchanged.
 *
 * Run with the browser project (see tests/main-street/README.md):
 *   npx vitest run tests/main-street/challenge-progress.browser.test.ts --project browser
 *
 * @module tests/main-street/challenge-progress.browser
 */
import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { CHALLENGE_TEMPLATES, type ActiveChallenge } from '../../src/MainStreetChallenges';

const TUTORIAL_STATE_KEY = 'tce-main-street-tutorial-state';

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();

  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame();
  await waitForScene(game, 'MainStreetScene');
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

interface SceneHandle extends Phaser.Scene {
  state: {
    soldSlots: boolean[];
    activeChallenges: ActiveChallenge[];
  };
  challengeContainer: Phaser.GameObjects.Container;
  refreshChallengeTracker: () => void;
}

function template(id: string) {
  const t = CHALLENGE_TEMPLATES.find((c) => c.id === id);
  if (!t) throw new Error(`Challenge template '${id}' not found`);
  return t;
}

function activate(...ids: string[]): ActiveChallenge[] {
  return ids.map((id) => ({ challenge: template(id), completed: false }));
}

/** All Phaser text strings currently rendered in the challenge panel. */
function challengeTexts(container: Phaser.GameObjects.Container): string[] {
  return container.list
    .filter((obj): obj is Phaser.GameObjects.Text => obj instanceof Phaser.GameObjects.Text)
    .map((t) => t.text);
}

/** The progress label (e.g. "2/3") rendered in the panel, or null. */
function findProgressLabel(container: Phaser.GameObjects.Container): string | null {
  return challengeTexts(container).find((t) => /^\d+\/\d+$/.test(t)) ?? null;
}

describe('MainStreet challenge HUD progress', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    try { (window as any).localStorage?.removeItem(TUTORIAL_STATE_KEY); } catch (_) { /* ignore */ }
    destroyGame(game);
    game = null;
  });

  it('renders live progress for Serial Seller as businesses are sold', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as unknown as SceneHandle;

    scene.state.activeChallenges = activate('ch-serial-seller');
    scene.state.soldSlots.fill(false);

    scene.refreshChallengeTracker();
    expect(findProgressLabel(scene.challengeContainer)).toBe('0/3');

    scene.state.soldSlots[0] = true;
    scene.state.soldSlots[3] = true;
    scene.refreshChallengeTracker();
    expect(findProgressLabel(scene.challengeContainer)).toBe('2/3');

    scene.state.soldSlots[7] = true;
    scene.refreshChallengeTracker();
    expect(findProgressLabel(scene.challengeContainer)).toBe('3/3');

    const texts = challengeTexts(scene.challengeContainer);
    expect(texts).toContain('Serial Seller');
    expect(texts).toContain('Sell 3 or more businesses in a single game.');
  }, 30_000);

  it('renders no progress label when only progress-less challenges are active', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as unknown as SceneHandle;

    scene.state.activeChallenges = activate('ch-deep-pockets', 'ch-beloved-mayor');
    scene.refreshChallengeTracker();

    expect(findProgressLabel(scene.challengeContainer)).toBeNull();
    const texts = challengeTexts(scene.challengeContainer);
    expect(texts).toContain('Deep Pockets');
    expect(texts).toContain('Beloved Mayor');
  }, 30_000);

  it('renders progress only on the progress-capable row in a mixed panel', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as unknown as SceneHandle;

    scene.state.activeChallenges = activate('ch-deep-pockets', 'ch-serial-seller');
    scene.state.soldSlots.fill(false);
    scene.state.soldSlots[1] = true;
    scene.refreshChallengeTracker();

    const labels = challengeTexts(scene.challengeContainer).filter((t) => /^\d+\/\d+$/.test(t));
    expect(labels).toEqual(['1/3']);
  }, 30_000);
});
