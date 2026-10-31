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
 *  5. the Canvas renderer still uses `GeometryMask` (no behaviour change);
 *  6. every clipping surface — Help panel, Settings panel, overlay dialogs and
 *     the gym card index — paints **inside** its own scroll rect and **not**
 *     outside it, proven with `renderer.snapshotPixel()` probes.
 *
 * ## Zero-tolerance warning capture
 *
 * A real WebGL boot must raise **zero** `setMask … not supported in WebGL`
 * warnings from **any** source. Core-owned call sites (`core/src/ui/*`, the gym
 * example scenes) now clip through the same renderer-aware `ContainerClip`, so
 * there is no `/core/` exclusion left for a Canvas-only mask to hide behind: a
 * single leftover `setMask` anywhere fails this file
 * (MS-0MVU03UEC000BX1O).
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
import { createOverlayDialog } from '@ui/Overlay';
import type { OverlayDialogHandle } from '@ui/Overlay';
import { createContainerClip, type ContainerClip } from '../../src/ContainerClip';
import { TUTORIAL_STATE_STORAGE_KEY } from '../../src/TutorialState';
import { dismissBootModals } from './helpers/bootModals';

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
  // Idempotent: a second call in the same test must not lose the *real*
  // original `console.warn` (and with it the ability to restore it).
  if (originalWarn) return;
  warnSpy = [];
  originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnSpy.push(`${args.map((a) => String(a)).join(' ')}\n${new Error().stack ?? ''}`);
    originalWarn?.apply(console, args as []);
  };
}

/**
 * Every Canvas-only `setMask` warning raised during the current test.
 *
 * No source filter — a real WebGL boot must raise **none** of these, whether the
 * call originated in this repo, in `./core` or in a bundled library. Core's
 * clipping surfaces migrated to the renderer-aware `createContainerClip`, so an
 * exclusion list here could only hide a regression (MS-0MVU03UEC000BX1O).
 */
function canvasOnlyWarnings(): string[] {
  return warnSpy.filter((w) => CANVAS_ONLY_WARNING.test(w));
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
  try {
    localStorage.removeItem(TUTORIAL_STATE_STORAGE_KEY);
  } catch {
    /* storage may be unavailable */
  }
}

/**
 * Answer the tutorial offer up-front so the boot flow never presents a
 * full-screen modal backdrop over the scene. Its dim layer would otherwise
 * darken every pixel this file probes, making the panel-background and canary
 * colour assertions meaningless.
 */
function seedTutorialSkipped(): void {
  try {
    localStorage.clear();
    localStorage.setItem(
      TUTORIAL_STATE_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, status: 'skipped', completedAt: null, lastStepId: null }),
    );
  } catch {
    /* storage may be unavailable */
  }
}

// Panic-safe teardown: `console.warn` is restored and the game destroyed even
// when an assertion throws mid-boot (afterEach always runs), so a failed probe
// can never leak a patched console into later tests in this file.
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
    }).snapshotPixel(Math.floor(x), Math.floor(y), (c) => resolve({ r: c.red, g: c.green, b: c.blue }));
  });
}

/** Per-channel colour distance, summed (0 = identical, 765 = black ↔ white). */
function pixelDistance(a: Pixel, b: Pixel): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function formatPixel(p: Pixel): string {
  return `rgb(${p.r},${p.g},${p.b})`;
}

/** True when `point` lies inside `rect` (far edges excluded). */
function pointInRect(
  point: { x: number; y: number },
  rect: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.w &&
    point.y >= rect.y &&
    point.y < rect.y + rect.h
  );
}

/** Resolve once `predicate` holds, or throw after `maxFrames` rendered frames. */
async function waitUntil(
  g: Phaser.Game,
  label: string,
  predicate: () => boolean,
  maxFrames = 180,
): Promise<void> {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    if (predicate()) return;
    await waitFrames(g, 1);
  }
  throw new Error(`Timed out waiting for ${label} after ${maxFrames} rendered frames`);
}

/**
 * Panel background shared by the Help panel, the Settings panel and the default
 * overlay-dialog box: `PANEL_BG_COLOR` in `core/src/ui/HelpPanel.ts` and
 * `core/src/ui/SettingsPanel.ts`, and the default `boxColor` in
 * `core/src/ui/Overlay.ts` (0x1a1a2e, drawn at 95% alpha over the scene).
 */
const PANEL_BG: Pixel = { r: 0x1a, g: 0x1a, b: 0x2e };

/**
 * Canary content colour for surfaces whose own paint is indistinguishable from
 * the scene behind them (the card list is text on the scene background, so a
 * mis-applied clip would not change any single pixel). Absent from every
 * palette in the repo, so a match can only be the probe content itself.
 */
const CANARY: Pixel = { r: 0xff, g: 0x00, b: 0xff };

/** One surface's scroll rect plus where to sample its paint inside/outside. */
interface SurfaceProbe {
  /** Surface name, used in assertion messages. */
  surface: string;
  /** The surface's own scroll rect, from its public bounds/layout constants. */
  rect: { x: number; y: number; w: number; h: number };
  /** Colour the surface paints at `inside` when it is drawn and clipped. */
  paint: Pixel;
  /** Probe point that must lie inside `rect` and show `paint`. */
  inside: { x: number; y: number };
  /** Probe point that must lie outside `rect` and must not show `paint`. */
  outside: { x: number; y: number };
  /** Maximum colour distance tolerated between `inside` and `paint`. */
  insideTolerance: number;
  /** Minimum colour distance required between `outside` and `paint`. */
  outsideFloor: number;
}

/**
 * Assert one surface paints inside its own scroll rect and nowhere outside it.
 *
 * Both probe points are checked against the rect before the pixels are read, so
 * the surface's own rect — not a hand-written literal — decides where the paint
 * is allowed: a probe that drifts off its surface fails loudly instead of
 * silently matching a different panel.
 */
async function expectPaintedInsideRect(g: Phaser.Game, probe: SurfaceProbe): Promise<void> {
  expect(
    pointInRect(probe.inside, probe.rect),
    `${probe.surface}: inside probe (${probe.inside.x}, ${probe.inside.y}) must lie inside the surface rect ${JSON.stringify(probe.rect)}`,
  ).toBe(true);
  expect(
    pointInRect(probe.outside, probe.rect),
    `${probe.surface}: outside probe (${probe.outside.x}, ${probe.outside.y}) must lie outside the surface rect ${JSON.stringify(probe.rect)}`,
  ).toBe(false);

  const inside = await snapshotPixel(g, probe.inside.x, probe.inside.y);
  const outside = await snapshotPixel(g, probe.outside.x, probe.outside.y);
  const insideDelta = pixelDistance(inside, probe.paint);
  const outsideDelta = pixelDistance(outside, probe.paint);

  expect(
    insideDelta,
    `${probe.surface}: inside pixel ${formatPixel(inside)} should be the surface paint ${formatPixel(probe.paint)} (distance ${insideDelta} > insideTolerance ${probe.insideTolerance})`,
  ).toBeLessThan(probe.insideTolerance);
  expect(
    outsideDelta,
    `${probe.surface}: outside pixel ${formatPixel(outside)} must not be the surface paint ${formatPixel(probe.paint)} (distance ${outsideDelta} <= outsideFloor ${probe.outsideFloor})`,
  ).toBeGreaterThan(probe.outsideFloor);
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

/** The Help panel fields this file derives its own scroll rect from. */
interface HelpPanelProbe {
  container: Phaser.GameObjects.Container;
  /** Panel width in px (the panel's `panelWidth`). */
  panelWidth: number;
  /** Top of the scrollable content (`_contentTopY`, set by `setupScrollMask`). */
  _contentTopY?: number;
  /** Height of the visible content area (`_visibleHeight`). */
  _visibleHeight?: number;
  open(): void;
  close(): void;
  isOpen: boolean;
}

/** The Settings panel fields this file derives its own scroll rect from. */
interface SettingsPanelProbe {
  container: Phaser.GameObjects.Container;
  panelWidth: number;
  canvasWidth: number;
  canvasHeight: number;
  open(): void;
  close(): void;
  isOpen: boolean;
}

/**
 * The Help panel's scroll rect, from the content geometry the panel computed in
 * `setupScrollMask()` — never a hand-written rectangle, so the probe cannot
 * silently measure the wrong region.
 */
function helpPanelScrollRect(panel: HelpPanelProbe): { x: number; y: number; w: number; h: number } {
  // The panel stores its computed scroll geometry on `_contentTopY` /
  // `_visibleHeight` — the very values its own `updateClip()` uses to place the
  // content clip — so the probe measures the panel's real scroll rect rather
  // than a copied literal.
  if (typeof panel._contentTopY !== 'number' || typeof panel._visibleHeight !== 'number') {
    throw new Error('HelpPanel has not published its scroll geometry — setupScrollMask() did not run');
  }
  return { x: panel.container.x, y: panel._contentTopY, w: panel.panelWidth, h: panel._visibleHeight };
}

/**
 * The Settings panel's scroll rect — the same geometry the panel uses for its
 * own `_scrollClip` (panel body, full canvas height).
 */
function settingsPanelScrollRect(panel: SettingsPanelProbe): { x: number; y: number; w: number; h: number } {
  return {
    x: panel.canvasWidth - panel.panelWidth,
    y: 0,
    w: panel.panelWidth,
    h: panel.canvasHeight,
  };
}

interface SceneProbe {
  layout: SceneLayout;
  streetContainer: Phaser.GameObjects.Container;
  logContentContainer: Phaser.GameObjects.Container;
  streetMapClip: ContainerClip | null;
  logContentClip: ContainerClip | null;
  logContentMask: Phaser.Display.Masks.GeometryMask | null;
  helpPanel: HelpPanelProbe;
  settingsPanel: SettingsPanelProbe;
  updateStreetMapMask(): void;
  updateLogMask(): void;
}

async function bootMainStreet(type: number): Promise<Phaser.Game> {
  seedTutorialSkipped();
  createHost();
  game = createMainStreetGame({ type } as never);
  await waitForScene(game, 'MainStreetScene');
  // The tutorial offer is pre-skipped, so the boot flow presents the blocking
  // New Game selector — a full-screen dim backdrop. Dismiss it before probing
  // pixels; otherwise every sampled colour reads the backdrop-darkened scene.
  await dismissBootModals(game.scene.getScene('MainStreetScene') as Phaser.Scene);
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

    // AC: no Canvas-only setMask warning in a real WebGL boot — from ANY
    // source, `/core/` included.
    expect(canvasOnlyWarnings()).toEqual([]);
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
    expect(canvasOnlyWarnings()).toEqual([]);
  });

  it('paints the Help panel inside its scroll rect and nowhere outside it', async () => {
    startWarningCapture();
    await bootMainStreet(Phaser.WEBGL);
    const scene = mainStreetScene();

    scene.helpPanel.open();
    // Wait for the 300 ms slide-in: the clip rect is anchored to the panel's
    // current world x, so sampling mid-animation would measure a moving target.
    await waitUntil(game!, 'Help panel to slide fully in', () => Math.abs(scene.helpPanel.container.x) < 0.5);
    await waitFrames(game!, 2);

    const rect = helpPanelScrollRect(scene.helpPanel);
    expect(rect.w).toBe(scene.helpPanel.panelWidth);
    expect(rect.h).toBeGreaterThan(0);

    await expectPaintedInsideRect(game!, {
      surface: 'Help panel scroll area',
      rect,
      paint: PANEL_BG,
      // Inside: just left of the panel's scrollbar track and right of the
      // wrapped text column (both widths come from the panel's own
      // PADDING/TRACK_BAR_WIDTH constants), so only its background is painted.
      inside: { x: rect.x + rect.w - 15, y: rect.y + rect.h / 2 },
      // Outside: beyond the panel's right edge the street shows instead.
      outside: { x: rect.x + rect.w + 30, y: rect.y + rect.h / 2 },
      insideTolerance: 60,
      outsideFloor: 25,
    });

    expect(canvasOnlyWarnings()).toEqual([]);
    scene.helpPanel.close();
  });

  it('paints the Settings panel inside its scroll rect and nowhere outside it', async () => {
    startWarningCapture();
    await bootMainStreet(Phaser.WEBGL);
    const scene = mainStreetScene();

    scene.settingsPanel.open();
    const rect = settingsPanelScrollRect(scene.settingsPanel);
    await waitUntil(
      game!,
      'Settings panel to slide fully in',
      () => Math.abs(scene.settingsPanel.container.x - rect.x) < 0.5,
    );
    await waitFrames(game!, 2);

    await expectPaintedInsideRect(game!, {
      surface: 'Settings panel scroll area',
      rect,
      paint: PANEL_BG,
      // Inside: left of every label/slider (they start at the panel's PADDING),
      // at mid height where only the panel background is painted.
      inside: { x: rect.x + 8, y: rect.y + rect.h / 2 },
      // Outside: beyond the panel's left edge the scene shows instead.
      outside: { x: rect.x - 30, y: rect.y + rect.h / 2 },
      insideTolerance: 60,
      outsideFloor: 25,
    });

    expect(canvasOnlyWarnings()).toEqual([]);
    scene.settingsPanel.close();
  });

  it('clips an overlay dialog content area to its scroll rect', async () => {
    startWarningCapture();
    await bootMainStreet(Phaser.WEBGL);
    const scene = game!.scene.getScene('MainStreetScene') as Phaser.Scene;

    // The same core primitive every Main Street overlay dialog is built from
    // (`createOverlayDialog`), with a content block twice as tall as the visible
    // area: with the clip missing, the overflow would paint over the dialog's
    // header and button rows.
    const dialog: OverlayDialogHandle = createOverlayDialog(scene, {
      title: 'Clipping probe',
      width: 520,
      height: 360,
    });
    const canary = scene.add
      .rectangle(0, 0, dialog.contentWidth, dialog.contentHeight * 2, 0xff00ff)
      .setOrigin(0, 0);
    dialog.scrollContainer.add(canary);
    dialog.refresh(dialog.contentHeight * 2);
    await waitFrames(game!, 3);

    const rect = {
      x: dialog.contentX,
      y: dialog.contentY,
      w: dialog.contentWidth,
      h: dialog.contentHeight,
    };

    await expectPaintedInsideRect(game!, {
      surface: 'overlay dialog content area',
      rect,
      paint: CANARY,
      // Inside: the canary content.
      inside: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
      // Outside: the dialog's own button row below the content viewport, where
      // the un-clipped canary would otherwise bleed through.
      outside: { x: rect.x + rect.w / 2, y: rect.y + rect.h + 20 },
      insideTolerance: 40,
      outsideFloor: 100,
    });

    expect(canvasOnlyWarnings()).toEqual([]);
    dialog.close();
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
  listContainer: Phaser.GameObjects.Container;
  listBounds: { x: number; y: number; width: number; height: number };
  contentHeight: number;
  applyScroll(): void;
  /** The scroll region in scene coordinates (public accessor). */
  getListBounds(): { x: number; y: number; width: number; height: number };
  /** Total scrollable overflow of the rendered list (0 when it fits). */
  getMaxScroll(): number;
}

describe('GymCardIndexScene under WebGL', () => {
  async function bootGym(): Promise<GymProbe> {
    seedTutorialSkipped();
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

    expect(canvasOnlyWarnings()).toEqual([]);
  });

  it('clips the card list to its scroll rect (pixel probe)', async () => {
    startWarningCapture();
    const scene = await bootGym();

    // The real index overflows its region, so the clip is live under WebGL.
    expect(scene.getMaxScroll()).toBeGreaterThan(0);
    expect(scene.listClip.active).toBe(true);

    const bounds = scene.getListBounds();
    const rect = { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };

    // The list is text on the scene background, so a mis-applied clip would not
    // change any single pixel. A canary block twice as tall as the list makes
    // the clip observable: it must be confined to the list region.
    const canary = scene.add
      .rectangle(0, 0, rect.w, rect.h * 2, 0xff00ff)
      .setOrigin(0, 0);
    scene.listContainer.add(canary);
    await waitFrames(game!, 2);

    await expectPaintedInsideRect(game!, {
      surface: 'gym card index list',
      rect,
      paint: CANARY,
      inside: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
      // Outside: the strip below the list, where the overflow would bleed.
      outside: { x: rect.x + rect.w / 2, y: rect.y + rect.h + 10 },
      insideTolerance: 40,
      outsideFloor: 100,
    });

    expect(canvasOnlyWarnings()).toEqual([]);
  });
});
