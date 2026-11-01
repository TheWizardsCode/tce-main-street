/**
 * Main Street: opaque play-panel treatment — market box
 * (parent MS-0MVKTB6WS000VLWK, AC1).
 *
 * The market section previously drew its background at `BOX_FILL` alpha 0.3
 * with a 0.4-alpha border, so roads / the map grid read through it whenever the
 * street camera was zoomed or panned. The contract is that the market box
 * adopts the Activity Log panel treatment — fill `0x1a1408` at alpha 0.85,
 * 1 px `0x665544` border, `BOX_RADIUS` corners — read from one shared token
 * set so the panels cannot drift (parent constraint).
 *
 * **Test-first (red) phase.** The assertions below are `it.fails` while the
 * market box still renders at alpha 0.3 / stroke 0.4. The paired
 * implementation item (MS-0MVPWQIPZ002PHPD) flips each `it.fails` to a plain
 * `it` once the treatment ships.
 *
 * Assertions inspect the rendered graphics command stream (fill/stroke/radius)
 * and the painted bounds, never the source constants that produced them.
 *
 * @module tests/main-street/panel-opacity.browser
 */

import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { destroyPhaserGame } from '@core-tests/helpers/phaserCanvasPool';
import { BOX_RADIUS } from '../../src/scenes/MainStreetConstants';
import { computeMainStreetLayoutWithSll } from '../../src/scenes/MainStreetLayoutAdapter';
import {
  expectPanelTreatment,
  readPanelBounds,
  readPanelTreatment,
} from './helpers/panelTreatment';

type Scene = Phaser.Scene & Record<string, unknown>;

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();
  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({
    type: Phaser.CANVAS,
    parent: 'game-container',
  });
  await waitForScene(game, 'MainStreetScene');
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  destroyPhaserGame(game);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

/** First `Graphics` child of a container (the panel background is drawn first). */
function firstGraphics(container: Phaser.GameObjects.Container | undefined): Phaser.GameObjects.Graphics | undefined {
  const list = (container?.list ?? []) as Phaser.GameObjects.GameObject[];
  return list.find((o): o is Phaser.GameObjects.Graphics =>
    o instanceof Phaser.GameObjects.Graphics);
}

describe('Main Street market panel treatment', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('market box adopts the Activity Log panel treatment (AC1; MS-0MVPWQIPZ002PHPD)', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Scene;

    const logBg = firstGraphics(scene.logContainer as Phaser.GameObjects.Container);
    expect(logBg, 'Activity Log background graphics not found').toBeDefined();

    // The Activity Log is the reference treatment: read it first and require
    // the market box to match its fill + border exactly (shared token set).
    const reference = readPanelTreatment(logBg!);
    expectPanelTreatment(reference, { label: 'Activity Log panel' });

    const marketBg = firstGraphics(scene.marketContainer as Phaser.GameObjects.Container);
    expect(marketBg, 'market panel background graphics not found').toBeDefined();
    const marketTreatment = readPanelTreatment(marketBg!);
    expectPanelTreatment(marketTreatment, {
      label: 'Market panel',
      radius: BOX_RADIUS,
    });

    // No drift: identical fill and border treatment to the Activity Log.
    const t = marketTreatment!;
    const ref = reference!;
    expect(t.fillColor, 'market fill colour must match the Activity Log').toBe(ref.fillColor);
    expect(t.fillAlpha, 'market fill alpha must match the Activity Log').toBeCloseTo(
      ref.fillAlpha,
      2,
    );
    expect(t.strokeColor, 'market border colour must match the Activity Log').toBe(
      ref.strokeColor,
    );
    expect(t.strokeWidth, 'market border width must match the Activity Log').toBe(
      ref.strokeWidth,
    );

    // Geometry comes from the layout authority, never hard-coded pixels: the
    // box spans the market zone's live edges and covers the whole market row.
    const layout = computeMainStreetLayoutWithSll();
    const sceneLayout = scene.layout as unknown as typeof layout;
    expect(sceneLayout.marketLeft, 'live layout must be the SLL layout').toBe(
      layout.marketLeft,
    );
    expect(sceneLayout.marketRight, 'live layout must be the SLL layout').toBe(
      layout.marketRight,
    );

    const bounds = readPanelBounds(marketBg!);
    expect(bounds, 'market panel bounds not readable').not.toBeNull();
    expect(bounds!.x).toBeCloseTo(layout.marketLeft, 0);
    expect(bounds!.width).toBeCloseTo(layout.marketRight - layout.marketLeft, 0);
    expect(
      bounds!.height,
      'market panel must cover the whole market row',
    ).toBeGreaterThanOrEqual(layout.marketRowH);
  }, 60_000);
});
