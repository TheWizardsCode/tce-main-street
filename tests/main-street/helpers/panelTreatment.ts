/**
 * Panel-treatment inspection helpers for the opaque play-panel contract.
 *
 * Shared by `panel-opacity.browser.test.ts` (market box + Activity Log
 * reference) and `hand-panel.browser.test.ts` (the persistent hand panel), so
 * the "Activity Log treatment" — fill `0x1a1408` at alpha 0.85, 1 px
 * `0x665544` border, `BOX_RADIUS` corners — is asserted through ONE reader.
 *
 * Phaser's `Graphics` exposes no `getBounds()` and no style getters, so this
 * module reads what the graphics object *actually drew* from its
 * `commandBuffer` (the render command stream). That keeps the assertions
 * behavioural — they inspect the rendered treatment, not the source constants
 * that produced it.
 *
 * @module tests/main-street/helpers/panelTreatment
 */

import { expect } from 'vitest';
import type Phaser from 'phaser';

import { BOX_STROKE } from '../../../src/scenes/MainStreetConstants';

// `Phaser.GameObjects.Graphics` render-command opcodes (Phaser
// `src/gameobjects/graphics/Commands.js`). Named locally so the reader is
// self-documenting; the numeric values are the stable on-the-wire opcodes.
const CMD_ARC = 0;
const CMD_BEGIN_PATH = 1;
const CMD_CLOSE_PATH = 2;
const CMD_FILL_RECT = 3;
const CMD_LINE_TO = 4;
const CMD_MOVE_TO = 5;
const CMD_LINE_STYLE = 6;
const CMD_FILL_STYLE = 7;
const CMD_FILL_PATH = 8;
const CMD_STROKE_PATH = 9;
const CMD_FILL_TRIANGLE = 10;
const CMD_STROKE_TRIANGLE = 11;
const CMD_SAVE = 14;
const CMD_RESTORE = 15;
const CMD_TRANSLATE = 16;
const CMD_SCALE = 17;
const CMD_ROTATE = 18;

/** Parameter count per opcode (used to walk the stream safely). */
const COMMAND_ARITY: Record<number, number> = {
  [CMD_ARC]: 8,
  [CMD_BEGIN_PATH]: 1,
  [CMD_CLOSE_PATH]: 1,
  [CMD_FILL_RECT]: 5,
  [CMD_LINE_TO]: 3,
  [CMD_MOVE_TO]: 3,
  [CMD_LINE_STYLE]: 4,
  [CMD_FILL_STYLE]: 3,
  [CMD_FILL_PATH]: 1,
  [CMD_STROKE_PATH]: 1,
  [CMD_FILL_TRIANGLE]: 7,
  [CMD_STROKE_TRIANGLE]: 7,
  [CMD_SAVE]: 1,
  [CMD_RESTORE]: 1,
  [CMD_TRANSLATE]: 3,
  [CMD_SCALE]: 3,
  [CMD_ROTATE]: 2,
};

/**
 * The shared opaque-panel fill (the Activity Log's fill colour, promoted to
 * the treatment every play panel uses — parent AC1/AC2/AC3).
 */
export const PANEL_FILL_COLOR = 0x1a1408;

/** The shared opaque-panel fill alpha (Activity Log reference). */
export const PANEL_FILL_ALPHA = 0.85;

/** Style painted by a graphics object, read back from its command stream. */
export interface PanelTreatment {
  /** Fill colour (`fillStyle` first argument). */
  fillColor: number;
  /** Fill alpha (`fillStyle` second argument). */
  fillAlpha: number;
  /** Border colour (`lineStyle` second argument). */
  strokeColor: number;
  /** Border width in px (`lineStyle` first argument). */
  strokeWidth: number;
  /** Border alpha (`lineStyle` third argument). */
  strokeAlpha: number;
  /** Corner radius of the first arc (rounded-rect corner), in px. */
  radius: number;
}

/** Axis-aligned painted bounds of a graphics object, in scene coordinates. */
export interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Read the numeric command stream of a graphics object. */
function commandStream(g: Phaser.GameObjects.Graphics): number[] {
  const raw = (g as unknown as { commandBuffer?: unknown }).commandBuffer;
  return Array.isArray(raw) ? (raw as number[]) : [];
}

/** Path-building opcodes (they draw nothing on their own). */
const PATH_COMMANDS = new Set<number>([
  CMD_ARC,
  CMD_BEGIN_PATH,
  CMD_CLOSE_PATH,
  CMD_LINE_TO,
  CMD_MOVE_TO,
]);

/** Opcodes that paint the current path with the *fill* style. */
const FILL_COMMANDS = new Set<number>([CMD_FILL_RECT, CMD_FILL_PATH, CMD_FILL_TRIANGLE]);

/** Opcodes that paint the current path with the *line* (stroke) style. */
const STROKE_COMMANDS = new Set<number>([CMD_STROKE_PATH, CMD_STROKE_TRIANGLE]);

/**
 * Read the fill/stroke treatment a graphics object was drawn with.
 *
 * A `Graphics` object's `commandBuffer` starts with the default style commands
 * Phaser pushes at construction (`LINE_STYLE 1,0,0` + `FILL_STYLE 0,0`), so the
 * treatment a panel actually paints with is the style **in effect when its
 * first fill path / stroke path is emitted**, not the first style command in
 * the stream. Failing to skip those defaults reads colour `0` for every panel.
 *
 * Returns `null` when the object filled nothing (nothing to assert) or when the
 * stream contains an opcode this reader does not know — the caller then fails
 * loudly rather than silently passing on an unread panel.
 */
export function readPanelTreatment(
  g: Phaser.GameObjects.Graphics,
): PanelTreatment | null {
  const cmds = commandStream(g);
  let fillColor: number | undefined;
  let fillAlpha: number | undefined;
  let strokeColor: number | undefined;
  let strokeWidth: number | undefined;
  let strokeAlpha: number | undefined;
  let radius: number | undefined;

  // Style currently in effect (updated by the style opcodes).
  let currentFill: { color: number; alpha: number } | undefined;
  let currentLine: { width: number; color: number; alpha: number } | undefined;
  // Style captured at the first fill / stroke path.
  let paintedFill: { color: number; alpha: number } | undefined;
  let paintedLine: { width: number; color: number; alpha: number } | undefined;

  for (let i = 0; i < cmds.length; ) {
    const op = cmds[i];
    const arity = COMMAND_ARITY[op];
    if (arity === undefined) return null;
    if (op === CMD_FILL_STYLE) {
      currentFill = { color: cmds[i + 1], alpha: cmds[i + 2] };
    } else if (op === CMD_LINE_STYLE) {
      currentLine = { width: cmds[i + 1], color: cmds[i + 2], alpha: cmds[i + 3] };
    } else if (op === CMD_ARC) {
      // Rounded-rect corners are arcs; the first one gives the radius.
      if (radius === undefined) radius = cmds[i + 3];
    } else if (FILL_COMMANDS.has(op)) {
      if (paintedFill === undefined) paintedFill = currentFill;
    } else if (STROKE_COMMANDS.has(op)) {
      if (paintedLine === undefined) paintedLine = currentLine;
    } else if (!PATH_COMMANDS.has(op)) {
      return null;
    }
    i += arity;
  }

  if (paintedFill === undefined) return null;
  fillColor = paintedFill.color;
  fillAlpha = paintedFill.alpha;
  strokeWidth = paintedLine?.width ?? 0;
  strokeColor = paintedLine?.color ?? 0;
  strokeAlpha = paintedLine?.alpha ?? 0;

  return {
    fillColor,
    fillAlpha: fillAlpha ?? 1,
    strokeColor,
    strokeWidth,
    strokeAlpha,
    radius: radius ?? 0,
  };
}

/**
 * Read the painted bounds of a graphics object (scene coordinates).
 *
 * A rounded rect is drawn as a path of `moveTo` / `lineTo` segments plus one
 * `arc` per corner; bounding each arc by its full circle makes the union
 * exactly the rounded rect's outer bounds. The graphics object's own
 * `x` / `y` offset is added so a panel drawn at local `(0, 0)` inside a
 * positioned container reports scene coordinates.
 */
export function readPanelBounds(
  g: Phaser.GameObjects.Graphics,
): PanelBounds | null {
  const cmds = commandStream(g);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const include = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (let i = 0; i < cmds.length; ) {
    const op = cmds[i];
    const arity = COMMAND_ARITY[op];
    if (arity === undefined) return null;
    if (op === CMD_MOVE_TO || op === CMD_LINE_TO) {
      include(cmds[i + 1], cmds[i + 2]);
    } else if (op === CMD_ARC) {
      const cx = cmds[i + 1];
      const cy = cmds[i + 2];
      const r = cmds[i + 3];
      include(cx - r, cy - r);
      include(cx + r, cy + r);
    } else if (op === CMD_FILL_RECT) {
      const x = cmds[i + 1];
      const y = cmds[i + 2];
      include(x, y);
      include(x + cmds[i + 3], y + cmds[i + 4]);
    }
    i += arity;
  }

  if (!Number.isFinite(minX)) return null;
  const offsetX = Number((g as unknown as { x?: number }).x) || 0;
  const offsetY = Number((g as unknown as { y?: number }).y) || 0;
  return {
    x: minX + offsetX,
    y: minY + offsetY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Assert a graphics object carries the shared opaque-panel treatment.
 *
 * @param treatment - Result of {@link readPanelTreatment}.
 * @param opts.label - Human-readable panel name used in failure messages.
 * @param opts.radius - Expected corner radius in px (omit for square panels).
 * @param opts.strokeAlphaMin - Minimum acceptable border alpha. The parent ACs
 *   fix the border colour and width but not its alpha, so the assertion is a
 *   visibility floor rather than a pinned value.
 */
export function expectPanelTreatment(
  treatment: PanelTreatment | null,
  opts: { label: string; radius?: number; strokeAlphaMin?: number },
): void {
  expect(
    treatment,
    `${opts.label}: no fill/stroke treatment found in the graphics command stream`,
  ).not.toBeNull();
  const t = treatment as PanelTreatment;
  expect(t.fillColor, `${opts.label}: fill colour`).toBe(PANEL_FILL_COLOR);
  expect(t.fillAlpha, `${opts.label}: fill alpha`).toBeCloseTo(PANEL_FILL_ALPHA, 2);
  expect(t.strokeColor, `${opts.label}: border colour`).toBe(BOX_STROKE);
  expect(t.strokeWidth, `${opts.label}: border width`).toBe(1);
  expect(t.strokeAlpha, `${opts.label}: border alpha`).toBeGreaterThanOrEqual(
    opts.strokeAlphaMin ?? 0.4,
  );
  if (opts.radius !== undefined) {
    expect(t.radius, `${opts.label}: corner radius`).toBe(opts.radius);
  }
}
