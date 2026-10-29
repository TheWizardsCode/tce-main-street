/**
 * Main Street: WebGL renderer boot + renderer-aware container clipping
 * (MS-0MV1HJ9ES009Y8GK).
 *
 * ## Why this file exists
 *
 * Phaser 4 dropped WebGL support for `GameObject.setMask`: a
 * `GeometryMask` is Canvas-only, and the WebGL renderer logs
 * `"This method is not supported in WebGL. Create a Mask filter instead."`
 * and returns. Every browser test in this repo (except the AUTO boot in
 * `hud-total-counting-live.browser.test.ts`) pins `Phaser.CANVAS` for CI
 * speed, so the Canvas-only mask path was green while any real WebGL boot
 * rendered the street map, the Activity Log and the gym card index
 * **unclipped**.
 *
 * This file is the first browser test that forces `Phaser.WEBGL` and asserts
 * rendering correctness, covering:
 *
 *  1. the renderer actually boots on WebGL (not a silent Canvas fallback);
 *  2. the clip mechanism clips pixels under WebGL — content inside the clip
 *     region is painted, content outside is not, `clear()` un-clips and
 *     `setRect()` re-clips (pixel probes, so this is a real rendering
 *     assertion rather than a scene-graph claim);
 *  3. the real `MainStreetScene` applies a WebGL Mask filter to the street
 *     viewport and to the Activity Log scroll area, with the expected rects,
 *     and logs **no** `setMask … not supported in WebGL` warning;
 *  4. the real `GymCardIndexScene` applies/clears the list clip under WebGL;
 *  5. the Canvas renderer still uses `GeometryMask` (no behaviour change).
 *
 * @module
 */

import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { createMainStreetGame } from '../../src/createMainStreetGame';
import { streetViewportRect } from '../../src/MainStreetMapView';
import { LOG_TITLE_H, type SceneLayout } from '../../src/scenes/MainStreetConstants';
import { GYM_CARD_INDEX_KEY, GymCardIndexScene } from '../../src/gym/GymCardIndexScene';
import { GAME_H, GAME_W } from '@ui/constants';
import { createContainerClip, type ContainerClip } from '../../src/ContainerClip';

const CANVAS_ONLY_WARNING = /not supported in WebGL/i;

let game: Phaser.Game | null = null;
let warnSpy: string[] = [];
let originalWarn: typeof console.warn | null = null;

interface Pixel {
  r: number;
  g: number;
  b: number;
}

function startWarningCapture(): void {
  warnSpy = [];
  originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnSpy.push(`${args.map((a) => String(a)).join(' ')}\n${new Error().stack ?? ''}`);
    originalWarn?.apply(console, args as []);
  };
}

/**
 * Canvas-only `setMask` warnings raised by **this repo's** code.
 *
 * Core-owned call sites (`core/src/ui/SettingsPanel.ts`, `HelpPanel.ts`,
 * `Overlay.ts`, `core/example-games/gym/...`) cannot be edited from this repo
 * — the `core` submodule is a separate checkout — so they are tracked in the
 * core work item `MS-0MVTE0UP00013TNW` and their warnings are excluded here.
 */
function inRepoCanvasOnlyWarnings(): string[] {
  return warnSpy.filter(
    (w) =>
      CANVAS_ONLY_WARNING.test(w) &&
      /\/src\//.test(w) &&
      !/\/core\//.test(w) &&
      !/\/node_modules\//.test(w),
  );
}

function stopWarningCapture(): void {
  if (originalWarn) console.warn = originalWarn;
  originalWarn = null;
}

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

afterEach(() => {
  stopWarningCapture();
  destroyGame();
});

/** Resolve after `n` completed renders, so mask updates have been drawn. */
function waitFrames(g: Phaser.Game, n: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = n;
    const onRender = (): void => {
      remaining -= 1;
      if (remaining <= 0) {
        g.events.off(Phaser.Core.Events.POST_RENDER, onRender);
        resolve();
      }
    };
    g.events.on(Phaser.Core.Events.POST_RENDER, onRender);
  });
}

function snapshotPixel(g: Phaser.Game, x: number, y: number): Promise<Pixel> {
  return new Promise((resolve) => {
    (g.renderer as unknown as {
      snapshotPixel: (x: number, y: number, cb: (c: { red: number; green: number; blue: number }) => void) => void;
    }).snapshotPixel(x, y, (c) => resolve({ r: c.red, g: c.green, b: c.blue }));
  });
}

function createHost(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);
  return container;
}

// ────────────────────────────────────────────────────────────────────────────
// 1 + 2. The clip mechanism itself, exercised on a real WebGL framebuffer
// ────────────────────────────────────────────────────────────────────────────

describe('container clip under WebGL', () => {
  interface ClipProbe {
    clip: ContainerClip;
    rectProbe: { inside: Pixel; outside: Pixel };
  }

  /**
   * Boot a minimal WebGL game whose single container paints the whole viewport
   * red, clipped to the left half. The mask rect is deliberately 100×200 in a
   * 200×200 viewport so "inside" and "outside" are unambiguous.
   */
  async function bootClipProbe(): Promise<ClipProbe> {
    createHost();
    let clip: ContainerClip | null = null;

    const scene = new (class extends Phaser.Scene {
      constructor() {
        super({ key: 'clip-probe' });
      }
      create(): void {
        const container = this.add.container(0, 0);
        container.add(this.add.rectangle(100, 100, 400, 400, 0xff0000));
        clip = createContainerClip(this, container, { x: 0, y: 0, w: 100, h: 200 });
      }
    })();

    game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent: 'game-container',
      width: 200,
      height: 200,
      backgroundColor: '#000000',
      scene,
      banner: false,
      audio: { noAudio: true },
    } as Phaser.Types.Core.GameConfig);

    await new Promise<void>((resolve) => game!.events.once(Phaser.Core.Events.READY, () => resolve()));
    await waitFrames(game, 3);

    expect(clip).not.toBeNull();
    const inside = await snapshotPixel(game, 50, 100);
    const outside = await snapshotPixel(game, 150, 100);
    return { clip: clip as unknown as ContainerClip, rectProbe: { inside, outside } };
  }

  it('boots on the WebGL renderer (not a silent Canvas fallback)', async () => {
    await bootClipProbe();
    expect(game!.renderer.type).toBe(Phaser.WEBGL);
  });

  it('paints inside the clip rect and masks outside it', async () => {
    const { clip, rectProbe } = await bootClipProbe();

    expect(clip.renderer).toBe('webgl');
    expect(clip.maskFilter).not.toBeNull();
    expect(clip.geometryMask).toBeNull();
    expect(clip.active).toBe(true);

    // Inside: the red container is visible.
    expect(rectProbe.inside.r).toBeGreaterThan(200);
    expect(rectProbe.inside.g).toBeLessThan(40);
    // Outside: the mask hides it, leaving the black background.
    expect(rectProbe.outside.r).toBeLessThan(40);
    expect(rectProbe.outside.g).toBeLessThan(40);
  });

  it('un-clips on clear() and re-clips on setRect()', async () => {
    const { clip } = await bootClipProbe();

    clip.clear();
    expect(clip.active).toBe(false);
    await waitFrames(game!, 2);
    const unclippedLeft = await snapshotPixel(game!, 50, 100);
    const unclippedRight = await snapshotPixel(game!, 150, 100);
    expect(unclippedLeft.r).toBeGreaterThan(200);
    expect(unclippedRight.r).toBeGreaterThan(200);

    // Re-clip to the *right* half: the sides swap.
    clip.setRect({ x: 100, y: 0, w: 100, h: 200 });
    expect(clip.active).toBe(true);
    expect(clip.rect).toEqual({ x: 100, y: 0, w: 100, h: 200 });
    await waitFrames(game!, 2);
    const reLeft = await snapshotPixel(game!, 50, 100);
    const reRight = await snapshotPixel(game!, 150, 100);
    expect(reLeft.r).toBeLessThan(40);
    expect(reRight.r).toBeGreaterThan(200);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. The real Mission Street scene under WebGL
// ────────────────────────────────────────────────────────────────────────────

interface SceneProbe {
  layout: SceneLayout;
  streetContainer: Phaser.GameObjects.Container;
  logContentContainer: Phaser.GameObjects.Container;
  streetMapClip: ContainerClip | null;
  logContentClip: ContainerClip | null;
  logContentMask: Phaser.Display.Masks.GeometryMask | null;
  updateStreetMapMask(): void;
  updateLogMask(): void;
}

async function bootMainStreet(type: number): Promise<Phaser.Game> {
  createHost();
  game = createMainStreetGame({ type } as never);
  await waitForScene(game, 'MainStreetScene');
  await waitFrames(game, 3);
  return game;
}

function mainStreetScene(): SceneProbe {
  return game!.scene.getScene('MainStreetScene') as unknown as SceneProbe;
}

describe('MainStreetScene under WebGL', () => {
  it('applies WebGL Mask-filter clips to the street viewport and the log', async () => {
    startWarningCapture();
    await bootMainStreet(Phaser.WEBGL);

    const scene = mainStreetScene();
    const viewport = streetViewportRect(scene.layout);

    // Street map clip: a screen-space Mask filter whose rect matches the
    // street band the camera pans and zooms inside.
    expect(scene.streetMapClip).not.toBeNull();
    expect(scene.streetMapClip!.renderer).toBe('webgl');
    expect(scene.streetMapClip!.maskFilter).not.toBeNull();
    expect(scene.streetMapClip!.geometryMask).toBeNull();
    expect(scene.streetContainer.mask).toBeFalsy();
    expect(scene.streetMapClip!.rect).toEqual({
      x: viewport.x,
      y: viewport.y,
      w: viewport.w,
      h: viewport.h,
    });

    // Activity Log clip: excludes the title bar, same rect the Canvas
    // GeometryMask used.
    expect(scene.logContentClip).not.toBeNull();
    expect(scene.logContentClip!.renderer).toBe('webgl');
    expect(scene.logContentClip!.maskFilter).not.toBeNull();
    expect(scene.logContentContainer.mask).toBeFalsy();
    expect(scene.logContentClip!.rect).toEqual({
      x: scene.layout.logX,
      y: scene.layout.logY + LOG_TITLE_H,
      w: scene.layout.logW,
      h: scene.layout.logH - LOG_TITLE_H - 2,
    });

    // AC: no Canvas-only setMask warning in a real WebGL boot.
    expect(inRepoCanvasOnlyWarnings()).toEqual([]);
  });

  it('keeps the clip anchored to the viewport band after a street camera apply', async () => {
    startWarningCapture();
    await bootMainStreet(Phaser.WEBGL);
    const scene = mainStreetScene();
    const before = { ...scene.streetMapClip!.rect };

    // Panning/zooming the street transforms the container; the clip must not
    // move with it (Canvas GeometryMask semantics).
    const renderer = (game!.scene.getScene('MainStreetScene') as unknown as {
      msRenderer: { applyStreetCamera(animate: boolean): void };
    }).msRenderer;
    renderer.applyStreetCamera(false);
    await waitFrames(game!, 2);

    expect(scene.streetMapClip!.rect).toEqual(before);
    expect(scene.streetMapClip!.active).toBe(true);
    expect(inRepoCanvasOnlyWarnings()).toEqual([]);
  });

  it('still uses a GeometryMask on the Canvas renderer (no Canvas regression)', async () => {
    startWarningCapture();
    await bootMainStreet(Phaser.CANVAS);

    const scene = mainStreetScene();
    expect(game!.renderer.type).toBe(Phaser.CANVAS);
    expect(scene.streetMapClip!.renderer).toBe('canvas');
    expect(scene.streetMapClip!.geometryMask).not.toBeNull();
    expect(scene.streetMapClip!.maskFilter).toBeNull();
    expect(scene.streetContainer.mask).toBeTruthy();
    expect(scene.logContentClip!.renderer).toBe('canvas');
    expect(scene.logContentMask).not.toBeNull();
    expect(scene.logContentContainer.mask).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. Gym card-index list clip under WebGL
// ────────────────────────────────────────────────────────────────────────────

interface GymProbe {
  listClip: ContainerClip;
  listBounds: { x: number; y: number; width: number; height: number };
  contentHeight: number;
  applyScroll(): void;
}

describe('GymCardIndexScene under WebGL', () => {
  async function bootGym(): Promise<GymProbe> {
    createHost();
    game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent: 'game-container',
      width: GAME_W,
      height: GAME_H,
      backgroundColor: '#121a2a',
      scene: [GymCardIndexScene],
    });
    await waitForScene(game, GYM_CARD_INDEX_KEY);
    await waitFrames(game, 2);
    return game.scene.getScene(GYM_CARD_INDEX_KEY) as unknown as GymProbe;
  }

  it('clips the list to its bounds while it overflows, and clears it when it fits', async () => {
    startWarningCapture();
    const scene = await bootGym();

    expect(game!.renderer.type).toBe(Phaser.WEBGL);
    expect(scene.listClip.renderer).toBe('webgl');
    expect(scene.listClip.maskFilter).not.toBeNull();

    // Force overflow → clipped to the list bounds.
    (scene as unknown as { contentHeight: number }).contentHeight =
      scene.listBounds.height + 200;
    scene.applyScroll();
    expect(scene.listClip.active).toBe(true);
    expect(scene.listClip.rect).toEqual({
      x: scene.listBounds.x,
      y: scene.listBounds.y,
      w: scene.listBounds.width,
      h: scene.listBounds.height,
    });

    // Content fits → the clip is released (a zero-area mask would hide the
    // whole list, so this must be a real clear).
    (scene as unknown as { contentHeight: number }).contentHeight = 10;
    scene.applyScroll();
    expect(scene.listClip.active).toBe(false);

    expect(inRepoCanvasOnlyWarnings()).toEqual([]);
  });
});
