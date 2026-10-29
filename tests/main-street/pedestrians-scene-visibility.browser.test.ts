/**
 * Main Street: ambient reputation crowd — scene-level visibility regression
 * guard (MS-0MVRDVVH4001048Q / MS-0MVRMHTW6006KQKI).
 *
 * Why this file exists
 * --------------------
 * Every existing pedestrian test (`pedestrians-layer.test.ts`,
 * `pedestrians-live-refresh.test.ts`, `pedestrians-count.test.ts`) drives the
 * layer against a *mock* scene, so none of them can catch an integration
 * break — the layer being destroyed by a street rebuild, never attached to the
 * live street container, left at `targetCount = 0` because the HUD refresh
 * path stopped reconciling it, or rendered off-screen/behind a panel.
 *
 * This guard boots the **real** `MainStreetScene` (via `createMainStreetGame`
 * + `waitForScene`, the same harness as
 * `activity-log-rendering.browser.test.ts`, MS-0MV14JDUG000E1V6) in normal
 * play with default settings and asserts the crowd the player is supposed to
 * see is actually on the street:
 *
 *  1. the layer is enabled (not Reduced Motion, not replay/headless);
 *  2. the live figure count equals `pedestrianCount(state.resourceBank.reputation)`
 *     and is non-zero for the starting reputation;
 *  3. the layer container is parented to the scene's **current**
 *     `streetContainer` (re-checked after a street rebuild, so a stale
 *     container reference cannot pass);
 *  4. every figure renders through the shared `PEDESTRIAN_TEXTURE_KEY`
 *     silhouette texture;
 *  5. the layer's bounds are non-empty, on-screen and inside the street
 *     viewport, catching the occluded/off-screen failure shape.
 *
 * The guard is deliberately scene-graph based (no pixel read-back), so it is
 * deterministic across the WebGL/Canvas renderers and cannot flake on
 * antialiasing or device-pixel-ratio differences.
 *
 * @module
 */

import { describe, it, expect, afterEach } from 'vitest';
import type Phaser from 'phaser';
import { waitForScene } from '@core-tests/helpers/waitForScene';

import { PEDESTRIAN_TEXTURE_KEY } from '../../src/scenes/MainStreetConstants';
import { pedestrianCount } from '../../src/scenes/MainStreetPedestrians';
import { streetViewportRect } from '../../src/MainStreetMapView';
import type { SceneLayout } from '../../src/scenes/MainStreetConstants';

/** Name the layer gives its container (see `MainStreetPedestrians.attachToStreet`). */
const LAYER_CONTAINER_NAME = 'ms-pedestrian-layer';

/** Slop (px) allowed when checking a figure sits inside the street viewport. */
const VIEWPORT_SLOP = 16;

interface LayerProbe {
  isEnabled(): boolean;
  getFigureCount(): number;
  getTargetCount(): number;
  getFigurePositions(): Array<{ x: number; y: number }>;
}

interface SceneProbe {
  state: { resourceBank: { reputation: number } };
  layout: SceneLayout;
  msPedestrians: LayerProbe;
  settingsPanel?: { reducedMotion?: boolean };
  replayMode?: boolean;
  getStreetContainer(): Phaser.GameObjects.Container;
  refreshStreetGrid(): void;
}

let game: Phaser.Game | null = null;

function destroyGame(): void {
  try {
    game?.destroy(true, false);
  } catch {
    /* already torn down */
  }
  game = null;
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

async function bootNormalPlayGame(): Promise<{ game: Phaser.Game; scene: SceneProbe }> {
  // Default settings: a persisted Reduced Motion preference from another test
  // (or a previous manual run) would legitimately hide the crowd and turn this
  // guard into a false failure.
  localStorage.clear();
  destroyGame();
  const host = document.createElement('div');
  host.id = 'game-container';
  document.body.appendChild(host);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  // No explicit `type`: use the real game's renderer selection (AUTO), not the
  // Canvas-only override the mock/behaviour harnesses pass.
  game = createMainStreetGame({ parent: 'game-container' });
  await waitForScene(game, 'MainStreetScene');
  const scene = game.scene.getScene('MainStreetScene') as unknown as SceneProbe;
  return { game, scene };
}

/** Wait until the scene has rendered the HUD (and so reconciled the crowd). */
async function waitForCrowd(scene: SceneProbe, expected: number, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (scene.msPedestrians?.getFigureCount() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The layer container, looked up inside the live street container by name. */
function findLayerContainer(scene: SceneProbe): Phaser.GameObjects.Container | undefined {
  const street = scene.getStreetContainer();
  const list = ((street as unknown as { list?: unknown[] }).list ?? []) as Array<{
    name?: string;
  }>;
  return list.find((child) => child?.name === LAYER_CONTAINER_NAME) as
    | Phaser.GameObjects.Container
    | undefined;
}

/** True when two rectangles overlap (Phaser bounds are x/y/width/height). */
function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.width > b.x && a.y < b.y + b.h && a.y + a.height > b.y;
}

describe('ambient reputation crowd is visible in normal play', () => {
  afterEach(() => {
    destroyGame();
  });

  it('renders pedestrianCount(reputation) silhouettes on the live street container', async () => {
    const { scene } = await bootNormalPlayGame();
    const reputation = scene.state.resourceBank.reputation;
    const expected = pedestrianCount(reputation);

    // Preconditions of a normal-play game: the crowd is not exempt.
    expect(scene.replayMode ?? false).toBe(false);
    expect(scene.settingsPanel?.reducedMotion ?? false).toBe(false);
    expect(expected).toBeGreaterThan(0);

    await waitForCrowd(scene, expected);

    const layer = scene.msPedestrians;
    expect(layer.isEnabled()).toBe(true);
    expect(layer.getTargetCount()).toBe(expected);
    expect(layer.getFigureCount()).toBe(expected);

    // (1) Attached to the live street container, not a stale one.
    const container = findLayerContainer(scene);
    expect(container, `no '${LAYER_CONTAINER_NAME}' container inside the street container`).toBeTruthy();
    expect(container?.parentContainer).toBe(scene.getStreetContainer());

    // (2) Every figure renders the shared silhouette texture.
    const images = ((container as unknown as { list?: unknown[] })?.list ?? []) as Array<{
      texture?: { key?: string };
    }>;
    expect(images.filter((image) => image?.texture?.key === PEDESTRIAN_TEXTURE_KEY).length).toBe(expected);

    // (3) Non-empty, on-screen bounds inside the street viewport.
    const viewport = streetViewportRect(scene.layout);
    const bounds = (container as unknown as { getBounds(): { x: number; y: number; width: number; height: number } })
      .getBounds();
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(intersects(bounds, viewport)).toBe(true);

    for (const figure of layer.getFigurePositions()) {
      expect(figure.x).toBeGreaterThanOrEqual(viewport.x - VIEWPORT_SLOP);
      expect(figure.x).toBeLessThanOrEqual(viewport.x + viewport.w + VIEWPORT_SLOP);
      expect(figure.y).toBeGreaterThanOrEqual(viewport.y - VIEWPORT_SLOP);
      expect(figure.y).toBeLessThanOrEqual(viewport.y + viewport.h + VIEWPORT_SLOP);
    }
  });

  it('stays attached to the street container across a street rebuild', async () => {
    const { scene } = await bootNormalPlayGame();
    const expected = pedestrianCount(scene.state.resourceBank.reputation);
    await waitForCrowd(scene, expected);

    const streetBefore = scene.getStreetContainer();
    scene.refreshStreetGrid();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The rebuild clears the street container with `removeAll(true)`; the layer
    // must be re-attached to that same live container with its crowd intact.
    expect(scene.getStreetContainer()).toBe(streetBefore);
    const container = findLayerContainer(scene);
    expect(container?.parentContainer).toBe(scene.getStreetContainer());
    expect(scene.msPedestrians.getFigureCount()).toBe(expected);
  });
});
