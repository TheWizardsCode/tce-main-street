/**
 * Main Street: Storyline Journal Overlay (browser, MS-0MUMP97LQ006PP1D)
 *
 * Browser verification of the storyline journal overlay:
 *  1. Opening it before any storyline choice shows the empty state.
 *  2. After a storyline choice resolves, it lists the storyline + outcome.
 *  3. Overlay-pattern compliance: all elements are parented into the HUD
 *     container at depth 201 (backdrop 199 / box 200 / elements 201).
 *
 * NOTE: browser tests are excluded from the `unit` project
 * (`vitest run --project unit`); this file is exercised by the browser
 * profile.
 *
 * @module tests/main-street/storyline-journal.browser
 */
import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();

  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: Phaser.CANVAS });
  await waitForScene(game, 'MainStreetScene');
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

async function waitForCondition(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 25;
  const label = options.label ?? 'condition';
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

function hudTexts(scene: Phaser.Scene & Record<string, unknown>): Phaser.GameObjects.Text[] {
  const hud = scene.hudContainer as Phaser.GameObjects.Container;
  if (!hud) return [];
  return hud.list.filter(
    (child): child is Phaser.GameObjects.Text => child instanceof Phaser.GameObjects.Text,
  );
}

function findText(scene: Phaser.Scene & Record<string, unknown>, label: string): Phaser.GameObjects.Text | undefined {
  return hudTexts(scene).find((t) => t.text === label);
}

function findTextContaining(scene: Phaser.Scene & Record<string, unknown>, fragment: string): Phaser.GameObjects.Text | undefined {
  return hudTexts(scene).find((t) => t.text.includes(fragment));
}

function sceneState(scene: Phaser.Scene & Record<string, unknown>): Record<string, any> {
  return scene.state as Record<string, any>;
}

describe('Main Street storyline journal overlay', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('shows the empty state before any storyline choice', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;
    sceneState(scene).activityLog.length = 0;

    (scene as unknown as { showStorylineJournal: () => void }).showStorylineJournal();

    await waitForCondition(
      () => Boolean(findText(scene, 'Storyline Journal')),
      { label: 'journal title' },
    );
    expect(findText(scene, 'Storyline Journal')).toBeDefined();
    expect(findTextContaining(scene, 'No storyline choices yet')).toBeDefined();
    // Depth convention (backdrop 199 / box 200 / buttons 201).
    expect(findText(scene, 'Storyline Journal')!.depth).toBe(201);
    expect(findText(scene, '[ Close ]')!.depth).toBe(201);
  });

  it('lists a resolved storyline choice and its outcome', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;

    // Seed a resolved storyline choice into the activity log.
    sceneState(scene).activityLog.push({
      turn: 3,
      text: 'Story update — Tax Troubles: you accepted the consequence (-200 coins).',
      type: 'loss',
    });

    (scene as unknown as { showStorylineJournal: () => void }).showStorylineJournal();

    await waitForCondition(
      () => Boolean(findTextContaining(scene, 'Tax Troubles')),
      { label: 'journal storyline row' },
    );
    expect(findTextContaining(scene, 'Tax Troubles')).toBeDefined();
    expect(findTextContaining(scene, 'accepted the consequence')).toBeDefined();
  });
});
