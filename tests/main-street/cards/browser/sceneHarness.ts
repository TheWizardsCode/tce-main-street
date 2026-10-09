/**
 * Main Street: Card test framework — browser scene harness.
 *
 * Boots the real `MainStreetScene` in headless Chromium, installs a controlled
 * engine state into it, and reads the player-facing HUD so browser card tests
 * assert that the running game reflects the engine state.
 *
 * @module
 */

import Phaser from 'phaser';
import { waitForScene } from '@core-tests/helpers/waitForScene';
import type { MainStreetState } from '../../../../src/MainStreetState';

/** A booted scene plus the owning Phaser game. */
export interface SceneHarness {
  readonly game: Phaser.Game;
  readonly scene: Phaser.Scene & Record<string, unknown>;
}

/** Resolves after `count` animation frames. */
export function waitFrames(count: number): Promise<void> {
  return new Promise(resolve => {
    let remaining = count;
    const tick = (): void => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Boots a fresh `MainStreetScene` and returns the harness. */
export async function bootScene(): Promise<SceneHarness> {
  let container = document.getElementById('game-container');
  if (container) container.remove();
  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: Phaser.CANVAS, parent: 'game-container' });
  await waitForScene(game, 'MainStreetScene');
  await waitFrames(5);
  const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;
  return { game, scene };
}

/** Destroys the booted game and removes its container. */
export function destroyScene(harness: SceneHarness | null): void {
  if (harness?.game) {
    harness.game.destroy(true, false);
  }
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

/** Recursively collects every `Text` object inside a container. */
export function collectTexts(container: Phaser.GameObjects.Container): Phaser.GameObjects.Text[] {
  const out: Phaser.GameObjects.Text[] = [];
  const visit = (node: Phaser.GameObjects.Container): void => {
    for (const child of node.list as Phaser.GameObjects.GameObject[]) {
      if (child instanceof Phaser.GameObjects.Text) out.push(child);
      else if (child instanceof Phaser.GameObjects.Container) visit(child);
    }
  };
  visit(container);
  return out;
}

/** All text strings currently rendered in the HUD. */
export function hudTexts(scene: Phaser.Scene & Record<string, unknown>): string[] {
  const hud = scene.hudContainer as Phaser.GameObjects.Container | undefined;
  if (!hud) return [];
  return collectTexts(hud).map(text => text.text);
}

/**
 * Installs a controlled engine state into the live scene and refreshes the
 * HUD so the player-facing display reflects it.
 */
export function installState(
  scene: Phaser.Scene & Record<string, unknown>,
  state: MainStreetState,
): void {
  scene.state = state;
  const refresh = scene.refreshHud as (() => void) | undefined;
  if (typeof refresh === 'function') refresh.call(scene);
}

/**
 * Asserts the HUD shows the controlled state's rounded coin and reputation
 * balances (the player-facing values rendered by `refreshHud`).
 *
 * @throws When the HUD does not reflect the state.
 */
export function assertHudShowsState(
  scene: Phaser.Scene & Record<string, unknown>,
  state: MainStreetState,
): void {
  const texts = hudTexts(scene);
  const coinLabel = `Coins: ${Math.round(state.resourceBank.coins)}`;
  const repLabel = `Reputation: ${Math.round(state.resourceBank.reputation)}`;
  if (!texts.includes(coinLabel)) {
    throw new Error(`HUD does not show '${coinLabel}'. HUD: ${texts.join(' | ')}`);
  }
  if (!texts.includes(repLabel)) {
    throw new Error(`HUD does not show '${repLabel}'. HUD: ${texts.join(' | ')}`);
  }
}
