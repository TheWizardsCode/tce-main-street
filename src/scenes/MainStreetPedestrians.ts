/**
 * MainStreetPedestrians — ambient pedestrian silhouette layer.
 *
 * Derives the on-street pedestrian figure count from the player's reputation
 * and renders a presentation-only crowd of small silhouette figures that walk
 * the road bands between (and around) the street cells.
 *
 * Behaviour (producer model):
 *  - figures walk **on one side of the road or the other** — offset from the
 *    road centre-line — never down the middle;
 *  - a figure may **walk deliberately** into an occupied business cell to
 *    spend money, and stays inside once it arrives (no teleporting);
 *  - at the end of the turn the crowd does not vanish: figures that are not
 *    spending walk **off the block** (off-screen) during the end phase, while
 *    enough figures walk into occupied shops to source the reputation income;
 *  - a fresh set wanders onto the street from the four block corners at the
 *    start of the next turn;
 *  - the crowd persists across a street rebuild (a card being played), keeping
 *    each figure's position, lane and mode.
 *
 * The layer is **presentation-only**: it never mutates game state, the
 * transcript, or the turn flow, and it draws its randomness from a
 * module-local seeded PRNG so it can never consume the seeded gameplay RNG
 * (seeded determinism and headless/AI parity are preserved).
 *
 * Pure, Phaser-free helpers (count maths, road network, shop occupancy, figure
 * stepping, render-exemption decision) are exported for headless unit tests;
 * the {@link MainStreetPedestrians} class is the thin Phaser adapter wired to
 * the scene lifecycle.
 *
 * @module
 */

import type { SceneLayout } from './MainStreetConstants';
import {
  PEDESTRIAN_BOB_AMPLITUDE,
  PEDESTRIAN_BOB_RATE,
  PEDESTRIAN_ENTER_SPEED_MULTIPLIER,
  PEDESTRIAN_FADE_MS,
  PEDESTRIAN_MIN_SHOP_RATIO,
  PEDESTRIAN_OFF_BLOCK_MARGIN,
  PEDESTRIAN_SHOP_CAPTURE_PAD,
  PEDESTRIAN_SHOP_ENTRY_RATE,
  PEDESTRIAN_SILHOUETTE_H,
  PEDESTRIAN_SILHOUETTE_W,
  PEDESTRIAN_TEXTURE_KEY,
  PEDESTRIAN_WALK_SPEED,
} from './MainStreetConstants';
import {
  mapRoadBands,
  playableIndexToMapCenter,
  roadBandY,
  streetViewportRect,
  type StreetLatticeDims,
} from '../MainStreetMapView';

// ── Named constants ────────────────────────────────────────────────

/**
 * Reputation points required per pedestrian figure.
 *
 * The count is `floor(reputation / PEDESTRIAN_REP_RATIO)`, floored at 0 and
 * uncapped (producer decision: no hard cap on crowd density).
 */
export const PEDESTRIAN_REP_RATIO = 50;

/**
 * Reputation blue — the solid-colour used for pedestrian silhouettes on the
 * street, matching the existing reputation visual language.
 */
export const PEDESTRIAN_COLOR = '#88bbff';

/** Numeric form of {@link PEDESTRIAN_COLOR} for Phaser graphics calls. */
export const PEDESTRIAN_COLOR_HEX = 0x88bbff;

/**
 * Fixed seed for the module-local presentation PRNG.
 *
 * The value is arbitrary; its only role is to make wander motion reproducible
 * without ever touching the seeded gameplay RNG.
 */
export const PEDESTRIAN_RNG_SEED = 0x5eed1a7;

/** The gameplay lattice used when the scene exposes none (legacy 1×1 board). */
const DEFAULT_LATTICE: StreetLatticeDims = { cols: 1, rows: 1 };

/** How far off the road centre-line a figure walks, in map-local px. */
export function pedestrianLaneOffset(layout: SceneLayout): number {
  const band = roadBandY(layout);
  const half = PEDESTRIAN_SILHOUETTE_W / 2;
  return Math.max(0, band / 2 - half - 2);
}

// ── Pure helper: population count ──────────────────────────────────

/**
 * Derive the pedestrian figure count from reputation.
 *
 * @param reputation — the player's current reputation score.
 * @returns `floor(reputation / 50)` floored at 0; returns 0 for negative,
 *          NaN, or non-finite inputs.
 */
export function pedestrianCount(reputation: number): number {
  if (!Number.isFinite(reputation) || reputation < 0) {
    return 0;
  }
  return Math.floor(reputation / PEDESTRIAN_REP_RATIO);
}

// ── Pure helper: render-exemption decision ─────────────────────────

/** Presentation conditions that suppress the pedestrian layer. */
export interface PedestrianRenderConditions {
  /** True in replay/headless mode (the scene forbids presentation). */
  replayMode?: boolean;
  /** True when the player has Reduced Motion enabled. */
  reducedMotion?: boolean;
}

/**
 * Whether the pedestrian layer may render.
 *
 * Reduced Motion and replay/headless modes perform no pedestrian rendering.
 * Pure so the exemption is unit-testable headless.
 */
export function shouldRenderPedestrians(conditions: PedestrianRenderConditions): boolean {
  return conditions.replayMode !== true && conditions.reducedMotion !== true;
}

// ── Pure helper: seeded presentation PRNG ──────────────────────────

/**
 * Create a deterministic, module-local PRNG (mulberry32).
 *
 * The returned function yields floats in `[0, 1)`. It is deliberately
 * independent of `Math.random` and of any gameplay RNG so presentation
 * randomness can never perturb seeded determinism.
 */
export function createPresentationRng(seed: number = PEDESTRIAN_RNG_SEED): () => number {
  let state = (Number.isFinite(seed) ? seed : PEDESTRIAN_RNG_SEED) >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Pure helper: road network ──────────────────────────────────────

/** One intersection of the road grid, in map-local coordinates. */
export interface RoadNode {
  x: number;
  y: number;
}

/**
 * The walkable road grid: intersections (nodes) and the road segments
 * (adjacency) that connect them. Built from the street-cell lattice's road
 * bands so figures always walk on a drawn road.
 */
export interface RoadNetwork {
  nodes: RoadNode[];
  /** Node index → adjacent node indices (along a road segment). */
  adjacency: number[][];
  /** Number of vertical road lines (node-grid columns). */
  cols: number;
  /** Number of horizontal road lines (node-grid rows). */
  rows: number;
  /** The four block-corner node indices (deduplicated on a 1×1 grid). */
  corners: number[];
}

/**
 * Build the road network for the displayed lattice.
 *
 * The road bands form a grid; their centre-lines intersect at every
 * (vertical, horizontal) pair. Figures walk the segments between adjacent
 * intersections, so every point on an edge lies on a drawn road band.
 */
export function buildRoadNetwork(
  layout: SceneLayout,
  lattice: StreetLatticeDims = DEFAULT_LATTICE,
): RoadNetwork {
  const bands = mapRoadBands(layout, lattice);
  const vx = bands
    .filter((b) => b.orientation === 'vertical')
    .map((b) => b.x + b.w / 2)
    .sort((a, b) => a - b);
  const hy = bands
    .filter((b) => b.orientation === 'horizontal')
    .map((b) => b.y + b.h / 2)
    .sort((a, b) => a - b);

  const cols = vx.length;
  const rows = hy.length;
  const nodes: RoadNode[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      nodes.push({ x: vx[i], y: hy[j] });
    }
  }
  const indexOf = (i: number, j: number): number => j * cols + i;
  const adjacency: number[][] = nodes.map(() => []);
  const link = (a: number, b: number): void => {
    if (a < 0 || b < 0 || a >= nodes.length || b >= nodes.length) return;
    if (!adjacency[a].includes(b)) adjacency[a].push(b);
    if (!adjacency[b].includes(a)) adjacency[b].push(a);
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (i + 1 < cols) link(indexOf(i, j), indexOf(i + 1, j));
      if (j + 1 < rows) link(indexOf(i, j), indexOf(i, j + 1));
    }
  }

  const corners: number[] = [];
  if (cols > 0 && rows > 0) {
    for (const [i, j] of [
      [0, 0],
      [cols - 1, 0],
      [0, rows - 1],
      [cols - 1, rows - 1],
    ]) {
      const index = indexOf(i, j);
      if (!corners.includes(index)) corners.push(index);
    }
  }

  return { nodes, adjacency, cols, rows, corners };
}

/** Axis-aligned rectangle in map-local coordinates. */
export interface PedestrianBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The bounding rectangle of the road network in map-local coordinates.
 */
export function networkBounds(network: RoadNetwork): PedestrianBounds {
  if (network.nodes.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of network.nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * The street-area anchor used when no pedestrians are on screen.
 *
 * Centres on the street viewport band so a pedestrian-sourced coin flight is
 * never allowed to fall back to the HUD reputation counter.
 */
export function pedestrianStreetAnchor(layout: SceneLayout): { x: number; y: number } {
  const viewport = streetViewportRect(layout);
  return { x: viewport.x + viewport.w / 2, y: viewport.y + viewport.h / 2 };
}

// ── Pure helper: occupied shops ────────────────────────────────────

/**
 * An occupied business cell a pedestrian may enter. `capture` is the
 * rectangle (map-local) within which a road-walking figure may step off the
 * road into the shop.
 */
export interface PedestrianShop {
  slotIndex: number;
  x: number;
  y: number;
  captureXMin: number;
  captureXMax: number;
  captureYMin: number;
  captureYMax: number;
  /** Interior of the cell, inset so a silhouette stays inside it. */
  cellXMin: number;
  cellXMax: number;
  cellYMin: number;
  cellYMax: number;
}

/**
 * Derive the enterable shops from the player's street grid.
 *
 * Only **occupied** cells (a truthy `streetGrid` entry) are returned, so a
 * pedestrian can only ever enter a shop that exists. The capture rectangle
 * spans both lanes of the adjacent road. Pure and defensive.
 */
export function occupiedShops(
  streetGrid: Array<unknown> | null | undefined,
  layout: SceneLayout | null | undefined,
  lattice: StreetLatticeDims = DEFAULT_LATTICE,
  gameplay: StreetLatticeDims = DEFAULT_LATTICE,
): PedestrianShop[] {
  if (!layout || !Array.isArray(streetGrid) || streetGrid.length === 0) return [];
  const roadY = roadBandY(layout);
  const lane = pedestrianLaneOffset(layout);
  const capturePad = PEDESTRIAN_SHOP_CAPTURE_PAD;
  const shops: PedestrianShop[] = [];
  for (let slotIndex = 0; slotIndex < streetGrid.length; slotIndex++) {
    if (!streetGrid[slotIndex]) continue;
    const centre = playableIndexToMapCenter(slotIndex, layout, lattice, gameplay);
    const halfW = layout.slotW / 2;
    const halfH = layout.slotH / 2;
    const reachY = halfH + roadY / 2 + lane + capturePad;
    // Interior a shopper can occupy without the silhouette poking out.
    const inset = PEDESTRIAN_SILHOUETTE_W / 2 + 2;
    shops.push({
      slotIndex,
      x: centre.x,
      y: centre.y,
      captureXMin: centre.x - halfW - capturePad,
      captureXMax: centre.x + halfW + capturePad,
      captureYMin: centre.y - reachY,
      captureYMax: centre.y + reachY,
      cellXMin: centre.x - halfW + inset,
      cellXMax: centre.x + halfW - inset,
      cellYMin: centre.y - halfH + inset,
      cellYMax: centre.y + halfH - inset,
    });
  }
  return shops;
}

/** Whether a figure position lies inside a shop's entry capture rectangle. */
export function withinShopCapture(figure: { x: number; y: number }, shop: PedestrianShop): boolean {
  return (
    figure.x >= shop.captureXMin &&
    figure.x <= shop.captureXMax &&
    figure.y >= shop.captureYMin &&
    figure.y <= shop.captureYMax
  );
}

// ── Pure helper: figure model + stepping ───────────────────────────

/** Pedestrian behaviour state. */
export type PedestrianMode = 'walking' | 'entering' | 'inside' | 'leaving';

/** One pedestrian, in map-local coordinates (x/y = centre). */
export interface PedestrianFigure {
  x: number;
  y: number;
  /** Node index the figure is currently walking toward (`-1` = idle). */
  target: number;
  /** Node index the figure most recently departed (avoids instant reversal). */
  from: number;
  /** Side of the road the figure walks: `+1` or `-1`. */
  lane: number;
  /** Behaviour state. */
  mode: PedestrianMode;
  /** Occupied-cell slot index the figure has entered / is heading to, or null. */
  shopIndex: number | null;
  /** Target point for `entering` / `leaving`. */
  destX: number;
  destY: number;
  /** Current bob phase, in radians. */
  bobPhase: number;
}

/** Clamp a value into `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

/** Clamp a raw RNG sample into `[0, 1)`, guarding a misbehaving injected RNG. */
function sample01(rng: () => number): number {
  const value = rng();
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 0.999999);
}

/** Pick an element from `items` using one RNG sample (safe on empty arrays). */
function pick<T>(items: T[], rng: () => number): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(sample01(rng) * items.length)];
}

/** Unit direction from `from` to `to` (defaults to `(1, 0)` when degenerate). */
function direction(
  from: RoadNode | undefined,
  to: RoadNode | undefined,
): { x: number; y: number } {
  if (!from || !to) return { x: 1, y: 0 };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

/**
 * The lane-offset point at *node* for a figure travelling in *dir*.
 * The perpendicular offset keeps the figure on one side of the road.
 */
export function lanePoint(
  node: RoadNode,
  dir: { x: number; y: number },
  laneOffset: number,
  lane: number,
): { x: number; y: number } {
  return {
    x: node.x - dir.y * laneOffset * lane,
    y: node.y + dir.x * laneOffset * lane,
  };
}

/** Move a figure toward a point; returns true once it arrives. */
function moveToward(
  figure: PedestrianFigure,
  destX: number,
  destY: number,
  speed: number,
  dt: number,
): boolean {
  const dx = destX - figure.x;
  const dy = destY - figure.y;
  const dist = Math.hypot(dx, dy);
  const step = speed * dt;
  if (dist <= step || dist < 1e-6) {
    figure.x = destX;
    figure.y = destY;
    return true;
  }
  figure.x += (dx / dist) * step;
  figure.y += (dy / dist) * step;
  return false;
}

/**
 * Spawn a pedestrian at a block corner, on a road lane, heading onto the
 * street. Uses only the supplied RNG (presentation-local by contract).
 */
export function spawnPedestrianFigure(
  network: RoadNetwork,
  layout: SceneLayout | null | undefined,
  rng: () => number,
): PedestrianFigure {
  const figure: PedestrianFigure = {
    x: 0,
    y: 0,
    target: -1,
    from: -1,
    lane: sample01(rng) < 0.5 ? -1 : 1,
    mode: 'walking',
    shopIndex: null,
    destX: 0,
    destY: 0,
    bobPhase: sample01(rng) * Math.PI * 2,
  };
  if (network.nodes.length === 0) return figure;

  const start =
    pick(network.corners, rng) ??
    network.adjacency.findIndex((neighbours) => neighbours.length > 0);
  const startIndex = start >= 0 ? start : 0;
  const neighbour = pick(network.adjacency[startIndex] ?? [], rng) ?? startIndex;
  figure.from = startIndex;
  figure.target = neighbour;

  const laneOffset = layout ? pedestrianLaneOffset(layout) : 0;
  const dir = direction(network.nodes[startIndex], network.nodes[neighbour]);
  const at = lanePoint(network.nodes[startIndex], dir, laneOffset, figure.lane);
  figure.x = at.x;
  figure.y = at.y;
  return figure;
}

/**
 * Direct a figure to walk deliberately into `shop` (no teleport). The
 * destination is a per-figure random point inside the cell, so a crowd in one
 * business spreads across it instead of converging on the centre.
 */
export function beginShopEntry(
  figure: PedestrianFigure,
  shop: PedestrianShop,
  rng: () => number,
): void {
  figure.mode = 'entering';
  figure.shopIndex = shop.slotIndex;
  figure.destX = shop.cellXMin + sample01(rng) * Math.max(0, shop.cellXMax - shop.cellXMin);
  figure.destY = shop.cellYMin + sample01(rng) * Math.max(0, shop.cellYMax - shop.cellYMin);
}

/**
 * Direct a walking figure to leave the block toward its nearest edge
 * (`dest` sits just beyond the network bounds by `margin`).
 */
export function directFigureOffBlock(
  figure: PedestrianFigure,
  network: RoadNetwork,
  margin: number = PEDESTRIAN_OFF_BLOCK_MARGIN,
): void {
  const bounds = networkBounds(network);
  if (bounds.w === 0 && bounds.h === 0) {
    figure.mode = 'leaving';
    figure.destX = figure.x;
    figure.destY = figure.y;
    return;
  }
  const dLeft = figure.x - bounds.x;
  const dRight = bounds.x + bounds.w - figure.x;
  const dTop = figure.y - bounds.y;
  const dBottom = bounds.y + bounds.h - figure.y;
  const min = Math.min(dLeft, dRight, dTop, dBottom);
  figure.mode = 'leaving';
  if (min === dLeft) {
    figure.destX = bounds.x - margin;
    figure.destY = figure.y;
  } else if (min === dRight) {
    figure.destX = bounds.x + bounds.w + margin;
    figure.destY = figure.y;
  } else if (min === dTop) {
    figure.destX = figure.x;
    figure.destY = bounds.y - margin;
  } else {
    figure.destX = figure.x;
    figure.destY = bounds.y + bounds.h + margin;
  }
}

/** Whether a `leaving` figure has walked clear of the block. */
export function isOffBlock(
  figure: PedestrianFigure,
  network: RoadNetwork,
  margin: number = PEDESTRIAN_OFF_BLOCK_MARGIN,
): boolean {
  const bounds = networkBounds(network);
  const clearance = margin * 0.5;
  return (
    figure.x < bounds.x - clearance ||
    figure.x > bounds.x + bounds.w + clearance ||
    figure.y < bounds.y - clearance ||
    figure.y > bounds.y + bounds.h + clearance
  );
}

/**
 * Advance a figure by `dtSeconds`.
 *
 *  - `walking` figures follow the road lane network; at each intersection they
 *    turn onto a random adjacent segment, and may decide to walk into an
 *    occupied shop within their capture rectangle;
 *  - `entering` figures walk continuously to their shop and become `inside`
 *    only on arrival (never teleport);
 *  - `inside` figures stay put;
 *  - `leaving` figures walk to their off-block destination.
 *
 * `dtSeconds` is capped so a long frame cannot teleport a figure past an
 * intersection. The RNG is presentation-local by contract.
 */
export function stepPedestrianFigure(
  figure: PedestrianFigure,
  network: RoadNetwork,
  shops: PedestrianShop[],
  layout: SceneLayout | null | undefined,
  dtSeconds: number,
  rng: () => number,
): void {
  const dt = Number.isFinite(dtSeconds) ? clamp(dtSeconds, 0, 0.1) : 0;
  if (dt <= 0) return;

  if (figure.mode === 'inside') {
    figure.bobPhase = (figure.bobPhase + PEDESTRIAN_BOB_RATE * dt) % (Math.PI * 2);
    return;
  }

  if (figure.mode === 'entering' || figure.mode === 'leaving') {
    const speed = PEDESTRIAN_WALK_SPEED * PEDESTRIAN_ENTER_SPEED_MULTIPLIER;
    const arrived = moveToward(figure, figure.destX, figure.destY, speed, dt);
    if (figure.mode === 'entering' && arrived) figure.mode = 'inside';
    figure.bobPhase = (figure.bobPhase + PEDESTRIAN_BOB_RATE * dt) % (Math.PI * 2);
    return;
  }

  // ── walking ──────────────────────────────────────────────────────
  if (network.nodes.length === 0 || figure.target < 0) {
    figure.bobPhase = (figure.bobPhase + PEDESTRIAN_BOB_RATE * dt) % (Math.PI * 2);
    return;
  }

  // Decide whether to step off the road into an occupied shop.
  if (shops.length > 0 && sample01(rng) < PEDESTRIAN_SHOP_ENTRY_RATE * dt) {
    const shop = shops.find((candidate) => withinShopCapture(figure, candidate));
    if (shop) {
      beginShopEntry(figure, shop, rng);
      figure.bobPhase = (figure.bobPhase + PEDESTRIAN_BOB_RATE * dt) % (Math.PI * 2);
      return;
    }
  }

  const fromNode = network.nodes[figure.from] ?? network.nodes[figure.target];
  const toNode = network.nodes[figure.target];
  const dir = direction(fromNode, toNode);
  const laneOffset = layout ? pedestrianLaneOffset(layout) : 0;
  const at = lanePoint(toNode, dir, laneOffset, figure.lane);

  if (moveToward(figure, at.x, at.y, PEDESTRIAN_WALK_SPEED, dt)) {
    // Arrived at the intersection — choose the next road segment (lane kept).
    const current = figure.target;
    const neighbours = network.adjacency[current] ?? [];
    const forward = neighbours.filter((n) => n !== figure.from);
    const next = pick(forward.length > 0 ? forward : neighbours, rng);
    figure.from = current;
    figure.target = next ?? current;
  }

  figure.bobPhase = (figure.bobPhase + PEDESTRIAN_BOB_RATE * dt) % (Math.PI * 2);
}

/**
 * Assign enough figures to **walk** into occupied shops to reach `minRatio`.
 *
 * Deterministic, presentation-only, and teleport-free: figures are switched
 * to `entering` (they walk in over subsequent steps). Returns the number of
 * figures inside or in transit to a shop afterwards. This is the reputation
 * income phase's 25% sourcing guarantee.
 */
export function assignShopShoppers(
  figures: PedestrianFigure[],
  shops: PedestrianShop[],
  rng: () => number,
  minRatio: number = PEDESTRIAN_MIN_SHOP_RATIO,
): number {
  const countShoppers = (list: PedestrianFigure[]): number =>
    list.reduce(
      (count, figure) => count + (figure.mode === 'inside' || figure.mode === 'entering' ? 1 : 0),
      0,
    );
  if (figures.length === 0) return 0;
  const required = Math.ceil(Math.max(0, Math.min(1, minRatio)) * figures.length);
  let occupancy = countShoppers(figures);
  if (occupancy >= required || shops.length === 0) return occupancy;

  let cursor = 0;
  for (const figure of figures) {
    if (occupancy >= required) break;
    if (figure.mode !== 'walking') continue;
    const shop = shops[cursor % shops.length];
    cursor += 1;
    beginShopEntry(figure, shop, rng);
    occupancy += 1;
  }
  return occupancy;
}

/**
 * Begin the end-of-turn exit: at least `minRatio` of the crowd walks into
 * occupied shops, and every remaining walking figure walks off the block.
 * Idempotent-ish: `entering`/`inside` figures are left alone.
 */
export function beginEndOfTurnExit(
  figures: PedestrianFigure[],
  network: RoadNetwork,
  shops: PedestrianShop[],
  rng: () => number,
  margin: number = PEDESTRIAN_OFF_BLOCK_MARGIN,
): void {
  assignShopShoppers(figures, shops, rng);
  for (const figure of figures) {
    if (figure.mode === 'walking') directFigureOffBlock(figure, network, margin);
  }
}

/** Clamp every walking figure inside the lane-expanded road-network bounds. */
export function clampFiguresToNetwork(
  figures: PedestrianFigure[],
  network: RoadNetwork,
  laneOffset: number,
): void {
  if (network.nodes.length === 0) return;
  const bounds = networkBounds(network);
  for (const figure of figures) {
    if (figure.mode !== 'walking') continue;
    figure.x = clamp(figure.x, bounds.x - laneOffset, bounds.x + bounds.w + laneOffset);
    figure.y = clamp(figure.y, bounds.y - laneOffset, bounds.y + bounds.h + laneOffset);
  }
}

// ── Phaser layer ───────────────────────────────────────────────────

/**
 * Ambient pedestrian layer.
 *
 * Owns a single container parented to the scene's `streetContainer` so the
 * crowd pans and clips with the street-map camera. One runtime-generated
 * silhouette texture is shared by every figure. Every public method is
 * defensive: a failure is swallowed so a throwing layer can never stall the
 * turn.
 */
export class MainStreetPedestrians {
  private readonly rng: () => number;
  private container: any = null;
  private figures: PedestrianFigure[] = [];
  private images: any[] = [];
  private networkCache: RoadNetwork | null = null;
  private targetCount = 0;
  /** Images whose fade-out tween is still running (cleaned on destroy). */
  private fadingImages: any[] = [];

  constructor(private readonly scene: any, rng: () => number = createPresentationRng()) {
    this.rng = rng;
  }

  /** Whether the layer may render under the current scene conditions. */
  public isEnabled(): boolean {
    try {
      return shouldRenderPedestrians({
        replayMode: this.scene?.replayMode === true,
        reducedMotion: this.scene?.settingsPanel?.reducedMotion === true,
      });
    } catch (_) {
      return false;
    }
  }

  /**
   * Create (or re-create) the layer. Called once from the scene lifecycle and
   * again after every street rebuild (the street container is cleared with
   * `removeAll(true)`). Existing figures are **preserved** — the layer only
   * re-parents them, so a card being played does not reset the crowd.
   */
  public create(): void {
    this.attachToStreet();
  }

  /**
   * Re-attach the layer to the (possibly rebuilt) street container. Any live
   * figures keep their position, lane and mode; the images are re-created
   * around them. Idempotent.
   */
  public attachToStreet(): void {
    try {
      // Tear down only the container/rendering, never the figures themselves.
      this.destroyContainerAndImages();
      if (!this.isEnabled()) return;
      const parent = this.scene?.getStreetContainer?.();
      if (!parent) return;
      this.ensureTexture();
      if (!this.scene?.textures?.exists?.(PEDESTRIAN_TEXTURE_KEY)) return;
      this.container = this.scene.add.container(0, 0);
      this.container.setName?.('ms-pedestrian-layer');
      parent.add(this.container);
      this.networkCache = this.computeNetwork();
      if (this.figures.length === 0 && this.targetCount > 0) {
        // First creation (or after a full reset): spawn from the corners.
        this.spawnToTarget(this.targetCount);
      } else {
        // Rebuild: recreate images at the figures' current positions.
        this.renderExistingFigures();
      }
    } catch (_) {
      // Presentation-only: never propagate a layer failure.
    }
  }

  /**
   * Clear the crowd and spawn a fresh set from the block corners. Called at
   * the start of a new turn, after the previous turn's crowd has walked off.
   */
  public startNewTurn(): void {
    try {
      if (!this.isEnabled()) {
        this.destroyAll();
        return;
      }
      this.destroyAll();
      if (!this.container) {
        this.attachToStreet();
        return;
      }
      this.spawnToTarget(this.targetCount);
    } catch (_) {
      // Presentation-only.
    }
  }

  /**
   * Begin the end-of-turn exit: enough figures walk into occupied shops to
   * source the reputation income, and the rest walk off the block. Called when
   * the end-of-turn presentation starts.
   */
  public beginEndOfTurn(): void {
    try {
      if (!this.isEnabled()) return;
      if (!this.container) this.attachToStreet();
      if (this.figures.length === 0) return;
      const network = this.networkCache ?? this.computeNetwork();
      this.networkCache = network;
      beginEndOfTurnExit(this.figures, network, this.computeShops(), this.rng);
    } catch (_) {
      // Presentation-only.
    }
  }

  /**
   * Set the target figure count, reconciling the live layer immediately
   * (adds/removes only the delta — it never rebuilds the whole layer).
   */
  public setPopulation(count: number): void {
    try {
      this.targetCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
      if (!this.isEnabled()) {
        this.destroyAll();
        return;
      }
      if (!this.container) {
        this.attachToStreet();
        return;
      }
      this.reconcile(this.targetCount);
    } catch (_) {
      // Presentation-only.
    }
  }

  /** Advance the road walk. Wired to the scene `update` loop. */
  public update(deltaMs: number): void {
    try {
      if (!this.isEnabled()) {
        if (this.figures.length > 0 || this.container) this.destroyAll();
        return;
      }
      if (!this.container || this.figures.length === 0) return;
      const network = this.networkCache ?? this.computeNetwork();
      this.networkCache = network;
      const shops = this.computeShops();
      const layout = this.scene?.layout as SceneLayout | undefined;
      const dt = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) / 1000 : 0;
      for (let i = this.figures.length - 1; i >= 0; i--) {
        const figure = this.figures[i];
        stepPedestrianFigure(figure, network, shops, layout, dt, this.rng);
        if (figure.mode === 'leaving' && isOffBlock(figure, network)) {
          const [image] = this.images.splice(i, 1);
          this.figures.splice(i, 1);
          this.destroyImage(image);
          continue;
        }
        const image = this.images[i];
        image?.setPosition?.(
          figure.x,
          figure.y + Math.sin(figure.bobPhase) * PEDESTRIAN_BOB_AMPLITUDE,
        );
      }
    } catch (_) {
      // Presentation-only.
    }
  }

  /** Re-clamp figures into the (possibly re-computed) road network. */
  public resize(): void {
    try {
      if (!this.isEnabled()) return;
      const network = this.computeNetwork();
      this.networkCache = network;
      const layout = this.scene?.layout as SceneLayout | undefined;
      clampFiguresToNetwork(this.figures, network, layout ? pedestrianLaneOffset(layout) : 0);
    } catch (_) {
      // Presentation-only.
    }
  }

  /** Destroy all figures and the layer container. Wired to scene shutdown. */
  public destroy(): void {
    this.targetCount = 0;
    this.destroyAll();
  }

  /** Current live figure count (0 when the layer is disabled). */
  public getFigureCount(): number {
    return this.figures.length;
  }

  /** Current target figure count (retained across street rebuilds). */
  public getTargetCount(): number {
    return this.targetCount;
  }

  /** Snapshot of the live figure centres, in map-local coordinates. */
  public getFigurePositions(): { x: number; y: number }[] {
    return this.figures.map((figure) => ({ x: figure.x, y: figure.y }));
  }

  /** Snapshot of the live figure modes (for tests/diagnostics). */
  public getFigureModes(): PedestrianMode[] {
    return this.figures.map((figure) => figure.mode);
  }

  /**
   * Snapshot of the live figures (position, lane, mode and walking segment),
   * for tests/diagnostics.
   */
  public getFigureSnapshot(): Array<{
    x: number;
    y: number;
    lane: number;
    mode: PedestrianMode;
    from: number;
    target: number;
    shopIndex: number | null;
  }> {
    return this.figures.map((figure) => ({
      x: figure.x,
      y: figure.y,
      lane: figure.lane,
      mode: figure.mode,
      from: figure.from,
      target: figure.target,
      shopIndex: figure.shopIndex,
    }));
  }

  /** The walkable road-network bounding rectangle (map-local). */
  public getWanderBounds(): PedestrianBounds {
    if (!this.networkCache) this.networkCache = this.computeNetwork();
    return networkBounds(this.networkCache);
  }

  /** The road network the crowd walks (for tests and diagnostics). */
  public getRoadNetwork(): RoadNetwork {
    if (!this.networkCache) this.networkCache = this.computeNetwork();
    return this.networkCache;
  }

  /** Slot indices of the figures inside a shop (arrived). */
  public getShopOccupancy(): number[] {
    return this.figures
      .filter((figure) => figure.mode === 'inside')
      .map((figure) => figure.shopIndex as number);
  }

  /**
   * Ensure at least {@link PEDESTRIAN_MIN_SHOP_RATIO} of the live crowd is
   * heading into an occupied cell (walking, never teleporting), then return
   * the number inside or in transit. Called immediately before the reputation
   * income phase.
   */
  public prepareForIncomePhase(): number {
    try {
      return assignShopShoppers(this.figures, this.computeShops(), this.rng, PEDESTRIAN_MIN_SHOP_RATIO);
    } catch (_) {
      return 0;
    }
  }

  /**
   * Dissolve the on-screen pedestrians into a coin-source pool for the
   * reputation income phase.
   *
   * A target that names a `slotIndex` sources from a figure **inside** that
   * business (then a figure walking into it); otherwise any in-shop figure is
   * used. When no figures are inside a shop the source falls back to a
   * street-area anchor — **never** the HUD reputation counter.
   */
  public dissolveIntoCoins(
    targets: Array<{ x: number; y: number; slotIndex?: number }>,
  ): Array<{ x: number; y: number }> {
    try {
      const list = Array.isArray(targets) ? targets : [];
      if (list.length === 0) return [];
      this.prepareForIncomePhase();
      const anchor = this.streetAnchor();
      const inside = this.figures.filter((figure) => figure.mode === 'inside');
      const entering = this.figures.filter((figure) => figure.mode === 'entering');
      const pickFor = (slotIndex: number | undefined): { x: number; y: number } | null => {
        if (typeof slotIndex === 'number') {
          const insideFor = inside.find((figure) => figure.shopIndex === slotIndex);
          if (insideFor) return { x: insideFor.x, y: insideFor.y };
          const enteringFor = entering.find((figure) => figure.shopIndex === slotIndex);
          if (enteringFor) return { x: enteringFor.x, y: enteringFor.y };
        }
        const any = inside[0] ?? entering[0];
        return any ? { x: any.x, y: any.y } : null;
      };
      return list.map(
        (target) => pickFor(target.slotIndex) ?? { ...anchor },
      );
    } catch (_) {
      const anchor = this.streetAnchor();
      return Array.isArray(targets) ? targets.map(() => ({ ...anchor })) : [];
    }
  }

  /** Street-area anchor derived from the current layout (never the HUD). */
  private streetAnchor(): { x: number; y: number } {
    try {
      const layout = this.scene?.layout as SceneLayout | undefined;
      if (!layout) return { x: 0, y: 0 };
      return pedestrianStreetAnchor(layout);
    } catch (_) {
      return { x: 0, y: 0 };
    }
  }

  // ── internals ────────────────────────────────────────────────────

  private lattice(): StreetLatticeDims {
    const view = this.scene?.getStreetViewLattice?.();
    if (view && Number.isFinite(view.cols) && Number.isFinite(view.rows)) return view;
    return DEFAULT_LATTICE;
  }

  private gameplayLattice(): StreetLatticeDims {
    const playable = this.scene?.streetPlayableLattice;
    if (playable && Number.isFinite(playable.cols) && Number.isFinite(playable.rows)) {
      return playable;
    }
    return DEFAULT_LATTICE;
  }

  private computeNetwork(): RoadNetwork {
    try {
      const layout = this.scene?.layout as SceneLayout | undefined;
      if (!layout) return { nodes: [], adjacency: [], cols: 0, rows: 0, corners: [] };
      return buildRoadNetwork(layout, this.lattice());
    } catch (_) {
      return { nodes: [], adjacency: [], cols: 0, rows: 0, corners: [] };
    }
  }

  private computeShops(): PedestrianShop[] {
    try {
      const layout = this.scene?.layout as SceneLayout | undefined;
      const grid = this.scene?.state?.streetGrid;
      if (!layout) return [];
      return occupiedShops(grid, layout, this.lattice(), this.gameplayLattice());
    } catch (_) {
      return [];
    }
  }

  private reconcile(target: number): void {
    if (!this.container) return;
    const network = this.networkCache ?? this.computeNetwork();
    this.networkCache = network;

    while (this.figures.length > target) {
      const image = this.images.pop();
      this.figures.pop();
      this.fadeOutAndDestroy(image);
    }

    const layout = this.scene?.layout as SceneLayout | undefined;
    while (this.figures.length < target) {
      const figure = spawnPedestrianFigure(network, layout, this.rng);
      const image = this.addFigureImage(figure);
      this.figures.push(figure);
      this.images.push(image);
      this.fadeIn(image);
    }
  }

  /** Spawn `target` figures and render them (used on create / new turn). */
  private spawnToTarget(target: number): void {
    if (!this.container) return;
    const network = this.networkCache ?? this.computeNetwork();
    this.networkCache = network;
    const layout = this.scene?.layout as SceneLayout | undefined;
    for (let i = 0; i < target; i++) {
      const figure = spawnPedestrianFigure(network, layout, this.rng);
      const image = this.addFigureImage(figure);
      this.figures.push(figure);
      this.images.push(image);
      this.fadeIn(image);
    }
  }

  /** Re-create images for the existing figures at their current positions. */
  private renderExistingFigures(): void {
    if (!this.container) return;
    this.images = [];
    for (const figure of this.figures) {
      const image = this.addFigureImage(figure);
      this.images.push(image);
    }
  }

  private addFigureImage(figure: PedestrianFigure): any {
    const image = this.scene.add.image(figure.x, figure.y, PEDESTRIAN_TEXTURE_KEY);
    image?.setOrigin?.(0.5, 0.5);
    image?.setDepth?.(1);
    this.container?.add?.(image);
    return image;
  }

  /**
   * Fade a newly spawned figure in. Falls back to full opacity when the scene
   * has no tween manager (unit harnesses, headless) so the figure is still
   * visible.
   */
  private fadeIn(image: any): void {
    try {
      if (!image) return;
      const tweens = this.scene?.tweens;
      if (tweens?.add) {
        image.setAlpha?.(0);
        tweens.add({ targets: image, alpha: 1, duration: PEDESTRIAN_FADE_MS });
      } else {
        image.setAlpha?.(1);
      }
    } catch (_) {
      try {
        image?.setAlpha?.(1);
      } catch (_) {
        // presentation-only
      }
    }
  }

  /**
   * Fade a removed figure out, destroying it when the tween completes. Falls
   * back to an immediate destroy when the scene has no tween manager.
   */
  private fadeOutAndDestroy(image: any): void {
    if (!image) return;
    try {
      const tweens = this.scene?.tweens;
      if (tweens?.add) {
        this.fadingImages.push(image);
        tweens.add({
          targets: image,
          alpha: 0,
          duration: PEDESTRIAN_FADE_MS,
          onComplete: () => {
            this.forgetFadingImage(image);
            this.destroyImage(image);
          },
        });
        return;
      }
    } catch (_) {
      // fall through to an immediate destroy
    }
    this.destroyImage(image);
  }

  private destroyImage(image: any): void {
    try {
      image?.destroy?.();
    } catch (_) {
      // presentation-only
    }
  }

  /** Detach an image from the fading registry once its fade-out finishes. */
  private forgetFadingImage(image: any): void {
    const index = this.fadingImages.indexOf(image);
    if (index >= 0) this.fadingImages.splice(index, 1);
  }

  private ensureTexture(): void {
    const textures = this.scene?.textures;
    if (!textures || textures.exists(PEDESTRIAN_TEXTURE_KEY)) return;
    const w = PEDESTRIAN_SILHOUETTE_W;
    const h = PEDESTRIAN_SILHOUETTE_H;
    const graphics = this.scene.add.graphics();
    graphics.fillStyle(PEDESTRIAN_COLOR_HEX, 1);
    // Head, torso, two legs — a minimal solid silhouette.
    const headR = w * 0.22;
    graphics.fillCircle(w / 2, headR + h * 0.02, headR);
    graphics.fillRect(w * 0.3, h * 0.32, w * 0.4, h * 0.38);
    graphics.fillRect(w * 0.3, h * 0.68, w * 0.16, h * 0.3);
    graphics.fillRect(w * 0.54, h * 0.68, w * 0.16, h * 0.3);
    graphics.generateTexture(PEDESTRIAN_TEXTURE_KEY, w, h);
    graphics.destroy();
  }

  /** Destroy the container and rendered images, keeping the figure state. */
  private destroyContainerAndImages(): void {
    for (const image of this.images) this.destroyImage(image);
    for (const image of this.fadingImages) this.destroyImage(image);
    this.images = [];
    this.fadingImages = [];
    try {
      this.container?.destroy?.();
    } catch (_) {
      // ignore
    }
    this.container = null;
  }

  /** Destroy everything, including the figure state. */
  private destroyAll(): void {
    this.destroyContainerAndImages();
    this.figures = [];
  }
}
