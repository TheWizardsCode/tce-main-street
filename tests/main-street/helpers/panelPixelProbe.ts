/**
 * Shared panel pixel-probe helpers for the Help/Settings browser tests
 * (MS-0MVWMDMLE007I8E1).
 *
 * Both panels are probed through `renderer.snapshotPixel()` on the live Canvas
 * renderer — the same helper pattern as
 * `webgl-renderer-clipping.browser.test.ts`. Every probe is derived from the
 * panel's OWN state:
 *
 * - the probe rect comes from the panel container's `x`/`y` plus its
 *   background rectangle's local position and size;
 * - the expected colour comes from the background rectangle's `fillColor`,
 *   i.e. the runtime value of that panel's private `PANEL_BG_COLOR` constant
 *   (`0x1a1a2e` in both `core/src/ui/HelpPanel.ts` and
 *   `core/src/ui/SettingsPanel.ts`).
 *
 * No colour, size or position literal is copied from source, so a panel whose
 * constant or geometry changed can never be silently probed at the wrong place
 * with the wrong colour.
 *
 * ## Thresholds
 *
 * {@link PANEL_INSIDE_TOLERANCE} is the maximum channel-sum distance an inside
 * probe may have from the panel's own paint (the panel colour drawn at
 * `PANEL_BG_ALPHA` 0.95 over the scene). It is deliberately narrow: every
 * probed surface is also checked against the scene-only frame at the same
 * point (before opening, and after closing), and that frame's distance from
 * the panel paint is ASSERTED to exceed this tolerance — so a scene-only frame
 * can never satisfy the inside match, and a panel that stopped rendering fails
 * the test instead of passing it.
 *
 * Measured on this scene (MS-0MVWMDMLE007I8E1): inside deltas 2 (Help panel) / 
 * 23 (Settings panel); scene-only deltas 48 (Help) / 438 (Settings). 40 sits
 * above the worst-case blend contribution of a fully white scene behind the
 * 0.95-alpha paint (≈34) and below the smallest measured scene-vs-paint
 * distance (48), so it is narrower than the panel-vs-scene distance on every
 * probed surface while staying robust to scene colour.
 *
 * {@link PANEL_OUTSIDE_FLOOR} is the minimum channel-sum distance an outside
 * probe must keep from the panel's paint. It is far below the measured
 * inside-vs-paint distance, so a mis-placed inside probe (a panel edge or an
 * antialiased pixel) fails loudly rather than passing as "outside".
 *
 * @module tests/main-street/helpers/panelPixelProbe
 */

import { expect } from 'vitest';
import Phaser from 'phaser';

/** One sampled pixel (0–255 per channel). */
export interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** The slice of a panel the probes need: its state and its paint surface. */
export interface PanelProbe {
  container: Phaser.GameObjects.Container;
  /** The panel's full-height background rectangle (painted `PANEL_BG_COLOR`). */
  background: Phaser.GameObjects.Rectangle;
  isOpen: boolean;
  /** Whether a slide tween is currently running. */
  isAnimating: boolean;
  open(): void;
  close(): void;
}

/** Axis-aligned world-space rectangle. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Maximum channel-sum distance between an inside probe and the panel's own
 * paint. Kept narrower than the measured scene-vs-panel colour distance at
 * every probed point (asserted at runtime), so a scene-only frame cannot
 * satisfy the inside match.
 */
export const PANEL_INSIDE_TOLERANCE = 40;

/**
 * Minimum channel-sum distance an outside probe must have from the panel's
 * paint — far below the measured inside-vs-paint distance, so an inside probe
 * that drifted onto a panel edge cannot pass as "outside".
 */
export const PANEL_OUTSIDE_FLOOR = 30;

/**
 * Sample one pixel through the Phaser renderer's snapshot API.
 *
 * `snapshotPixel` schedules the read for the next rendered frame, so awaiting
 * the promise doubles as a one-frame render barrier. Fails loudly when the
 * renderer does not expose the API, so a renderer regression can never be
 * downgraded to a state-only assertion.
 */
export function snapshotPixel(game: Phaser.Game, x: number, y: number): Promise<Pixel> {
  const renderer = game.renderer as unknown as {
    snapshotPixel?: (x: number, y: number, cb: (c: { r: number; g: number; b: number; a?: number }) => void) => void;
  };
  if (typeof renderer.snapshotPixel !== 'function') {
    throw new Error('renderer.snapshotPixel() is unavailable — pixel probes cannot run');
  }
  return new Promise((resolve) => {
    renderer.snapshotPixel!(Math.floor(x), Math.floor(y), (c) => {
      resolve({ r: c.r, g: c.g, b: c.b, a: c.a ?? 255 });
    });
  });
}

/** Channel-sum colour distance (0 = identical, 765 = black ↔ white). */
export function pixelDistance(a: Pixel, b: Pixel): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

/** True when `point` lies inside `rect` (far edges excluded). */
export function pointInRect(point: { x: number; y: number }, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.w &&
    point.y >= rect.y &&
    point.y < rect.y + rect.h
  );
}

/** One rendered frame of the game loop, resolved from the POST_RENDER event. */
export function waitRenderedFrame(game: Phaser.Game): Promise<void> {
  return new Promise((resolve) => {
    game.events.once(Phaser.Core.Events.POST_RENDER, () => resolve());
  });
}

/**
 * Resolve once `predicate` holds, or throw after `maxFrames` rendered frames.
 * Waits are render-driven (the same basis `snapshotPixel` reads from), so a
 * stalled game loop surfaces as a timeout instead of a silently skipped
 * assertion.
 */
export async function waitUntil(
  game: Phaser.Game,
  label: string,
  predicate: () => boolean,
  maxFrames = 240,
): Promise<void> {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    if (predicate()) return;
    await waitRenderedFrame(game);
  }
  throw new Error(`Timed out waiting for ${label} after ${maxFrames} rendered frames`);
}

/**
 * The panel background's world-space rect from its own geometry: container
 * `x`/`y` plus the background shape's local position and size (origin-centred,
 * unscaled). Width/height are final even while the panel is off-screen; only
 * `x` moves during the slide.
 */
export function panelBackgroundWorldRect(panel: PanelProbe): Rect {
  const bg = panel.background;
  const c = panel.container;
  return {
    x: c.x + bg.x - bg.width / 2,
    y: c.y + bg.y - bg.height / 2,
    w: bg.width,
    h: bg.height,
  };
}

/**
 * The panel background's world-space rect once it has slid fully in at
 * `targetX` (only the container's x changes during the slide).
 */
export function panelTargetRect(panel: PanelProbe, targetX: number): Rect {
  return { ...panelBackgroundWorldRect(panel), x: targetX };
}

/**
 * The colour the panel paints, read from its background rectangle's own
 * `fillColor` — the runtime value of that panel's private `PANEL_BG_COLOR`
 * constant. Never a hardcoded literal.
 */
export function panelPaint(panel: PanelProbe): Pixel {
  const fill = (panel.background.fillColor ?? 0) & 0xffffff;
  return { r: (fill >> 16) & 0xff, g: (fill >> 8) & 0xff, b: fill & 0xff, a: 255 };
}

/** Two probe points for one panel, both validated against the panel's rect. */
export interface PaintProbe {
  /** Surface name for assertion messages (e.g. 'Help panel'). */
  surface: string;
  /** Probe point that must lie inside the panel rect and show its paint. */
  inside: { x: number; y: number };
  /** Probe point that must lie outside the panel rect and not show its paint. */
  outside: { x: number; y: number };
}

/**
 * Assert a panel is actually PAINTED (not merely logically open):
 *
 *  1. the inside probe lies inside the panel's own background rect and the
 *     outside probe lies outside it — a probe that drifted off its surface
 *     fails loudly instead of silently measuring a different panel;
 *  2. the inside pixel matches the panel's own paint within
 *     {@link PANEL_INSIDE_TOLERANCE};
 *  3. the scene-only pixel at the same inside point (sampled while the panel
 *     was not drawn) is farther from the paint than that tolerance — a frame
 *     in which the panel was not rendered cannot satisfy 2;
 *  4. the outside pixel differs from the paint by more than
 *     {@link PANEL_OUTSIDE_FLOOR}.
 *
 * @param game The live game.
 * @param panel The panel to probe (must be slid fully in and not animating).
 * @param probe The inside/outside probe points.
 * @param sceneOnlyPixel The inside-point pixel sampled while the panel was not
 *   painted (before opening or after closing).
 */
export async function expectPanelPainted(
  game: Phaser.Game,
  panel: PanelProbe,
  probe: PaintProbe,
  sceneOnlyPixel: Pixel,
): Promise<void> {
  const paint = panelPaint(panel);
  const rect = panelBackgroundWorldRect(panel);

  expect(
    pointInRect(probe.inside, rect),
    `${probe.surface}: inside probe (${probe.inside.x}, ${probe.inside.y}) must lie inside the panel rect ${JSON.stringify(rect)}`,
  ).toBe(true);
  expect(
    pointInRect(probe.outside, rect),
    `${probe.surface}: outside probe (${probe.outside.x}, ${probe.outside.y}) must lie outside the panel rect ${JSON.stringify(rect)}`,
  ).toBe(false);

  const inside = await snapshotPixel(game, probe.inside.x, probe.inside.y);
  const outside = await snapshotPixel(game, probe.outside.x, probe.outside.y);

  const insideDelta = pixelDistance(inside, paint);
  const outsideDelta = pixelDistance(outside, paint);
  const sceneOnlyDelta = pixelDistance(sceneOnlyPixel, paint);

  expect(
    insideDelta,
    `${probe.surface}: inside pixel rgb(${inside.r},${inside.g},${inside.b}) must match the panel paint rgb(${paint.r},${paint.g},${paint.b}) — distance ${insideDelta} >= inside tolerance ${PANEL_INSIDE_TOLERANCE}`,
  ).toBeLessThan(PANEL_INSIDE_TOLERANCE);

  expect(
    sceneOnlyDelta,
    `${probe.surface}: the un-painted (scene-only) pixel rgb(${sceneOnlyPixel.r},${sceneOnlyPixel.g},${sceneOnlyPixel.b}) must NOT match the panel paint rgb(${paint.r},${paint.g},${paint.b}) — distance ${sceneOnlyDelta} <= inside tolerance ${PANEL_INSIDE_TOLERANCE}, so a scene-only frame would pass`,
  ).toBeGreaterThan(PANEL_INSIDE_TOLERANCE);

  expect(
    outsideDelta,
    `${probe.surface}: outside pixel rgb(${outside.r},${outside.g},${outside.b}) must not be the panel paint rgb(${paint.r},${paint.g},${paint.b}) — distance ${outsideDelta} <= outside floor ${PANEL_OUTSIDE_FLOOR}`,
  ).toBeGreaterThan(PANEL_OUTSIDE_FLOOR);
}

/**
 * Wait for an already-triggered open to finish: asserts the panel reports
 * itself open and its slide-in tween settles at `targetX`. A panel whose
 * tween never runs (or never opens) times out and fails.
 */
export async function waitPanelOpen(
  game: Phaser.Game,
  panel: PanelProbe,
  targetX: number,
  surface: string,
): Promise<void> {
  expect(panel.isOpen, `${surface}: isOpen must be true once opened`).toBe(true);
  await waitUntil(
    game,
    `${surface} to slide fully in`,
    () => !panel.isAnimating && Math.abs(panel.container.x - targetX) < 0.5,
  );
}

/** Close a panel and wait for its slide-out tween to finish at `targetX`. */
export async function closePanelAndWait(
  game: Phaser.Game,
  panel: PanelProbe,
  targetX: number,
  surface: string,
): Promise<void> {
  panel.close();
  await waitUntil(
    game,
    `${surface} to slide fully out`,
    () => !panel.isAnimating && Math.abs(panel.container.x - targetX) < 0.5,
  );
}
