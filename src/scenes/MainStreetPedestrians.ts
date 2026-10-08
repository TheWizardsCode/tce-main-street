/**
 * MainStreetPedestrians — ambient pedestrian silhouette layer.
 *
 * Derives the on-street pedestrian figure count from the player's reputation
 * and renders a presentation-only crowd of small silhouette figures that walk
 * the road bands between (and around) the street cells. Figures may step off
 * the road to spend money inside an **occupied** business cell, where they
 * remain; the end-of-turn reputation income phase is sourced from the figures
 * inside those shops.
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
  PEDESTRIAN_FADE_MS,
  PEDESTRIAN_MIN_SHOP_RATIO,
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
 * Reduced Motion and replay/headless modes perform no pedestrian rendering
 * (parent AC5). Pure so the exemption is unit-testable headless.
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

/**
 * The bounding rectangle of the road network in map-local coordinates. Used
 * as the walkable area for tests and resize clamping.
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

/** Axis-aligned rectangle in map-local coordinates. */
export interface PedestrianBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The street-area anchor used when no pedestrians are on screen.
 *
 * Centres on the street viewport band so a pedestrian-sourced coin flight is
 * never allowed to fall back to the HUD reputation counter
 * (MS-0MUYGFWXK003QFYB). Pure and exported for unit testing.
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
}

/**
 * Derive the enterable shops from the player's street grid.
 *
 * Only **occupied** cells (a truthy `streetGrid` entry) are returned, so a
 * pedestrian can only ever enter a shop that exists. Pure and defensive.
 */
export function occupiedShops(
  streetGrid: Array<unknown> | null | undefined,
  layout: SceneLayout | null | undefined,
  lattice: StreetLatticeDims = DEFAULT_LATTICE,
  gameplay: StreetLatticeDims = DEFAULT_LATTICE,
): PedestrianShop[] {
  if (!layout || !Array.isArray(streetGrid) || streetGrid.length === 0) return [];
  const roadY = roadBandY(layout);
  const capturePad = PEDESTRIAN_SHOP_CAPTURE_PAD;
  const shops: PedestrianShop[] = [];
  for (let slotIndex = 0; slotIndex < streetGrid.length; slotIndex++) {
    if (!streetGrid[slotIndex]) continue;
    const centre = playableIndexToMapCenter(slotIndex, layout, lattice, gameplay);
    const halfW = layout.slotW / 2;
    const halfH = layout.slotH / 2;
    shops.push({
      slotIndex,
      x: centre.x,
      y: centre.y,
      captureXMin: centre.x - halfW - capturePad,
      captureXMax: centre.x + halfW + capturePad,
      captureYMin: centre.y - halfH - roadY / 2 - capturePad,
      captureYMax: centre.y + halfH + roadY / 2 + capturePad,
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

/** One walking pedestrian, in map-local coordinates (x/y = centre). */
export interface PedestrianFigure {
  x: number;
  y: number;
  /** Node index the figure is currently walking toward (`-1` = idle). */
  target: number;
  /** Node index the figure most recently departed (avoids instant reversal). */
  from: number;
  /** Occupied-cell slot index the figure has entered, or `null` while walking. */
  shopIndex: number | null;
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

/**
 * Spawn a pedestrian at a block corner, heading onto the street. Uses only the
 * supplied RNG (presentation-local by contract).
 */
export function spawnPedestrianFigure(network: RoadNetwork, rng: () => number): PedestrianFigure {
  const figure: PedestrianFigure = {
    x: 0,
    y: 0,
    target: -1,
    from: -1,
    shopIndex: null,
    bobPhase: sample01(rng) * Math.PI * 2,
  };
  if (network.nodes.length === 0) return figure;

  // Enter from a block corner; fall back to any node with a neighbour.
  const start =
    pick(network.corners, rng) ??
    network.adjacency.findIndex((neighbours) => neighbours.length > 0);
  const startIndex = start >= 0 ? start : 0;
  const node = network.nodes[startIndex];
  const neighbour = pick(network.adjacency[startIndex] ?? [], rng);
  figure.x = node.x;
  figure.y = node.y;
  figure.from = startIndex;
  figure.target = neighbour ?? startIndex;
  return figure;
}

/**
 * Advance a figure by `dtSeconds`, walking it along road segments. At each
 * intersection it turns onto a random adjacent segment; while walking it may
 * step into an occupied shop within its capture rectangle, where it stays.
 *
 * `dtSeconds` is capped so a long frame (tab restore) cannot teleport a figure
 * far past an intersection. The RNG is presentation-local by contract.
 */
export function stepPedestrianFigure(
  figure: PedestrianFigure,
  network: RoadNetwork,
  shops: PedestrianShop[],
  dtSeconds: number,
  rng: () => number,
): void {
  const dt = Number.isFinite(dtSeconds) ? clamp(dtSeconds, 0, 0.1) : 0;
  if (dt <= 0) return;

  if (figure.shopIndex !== null) {
    // Inside a shop: stay put (only the bob continues).
    figure.bobPhase = (figure.bobPhase + PEDESTRIAN_BOB_RATE * dt) % (Math.PI * 2);
    return;
  }

  // Decide whether to step off the road into an occupied shop. Checked before
  // the road-motion guard so an idle figure in range can still enter.
  if (shops.length > 0 && sample01(rng) < PEDESTRIAN_SHOP_ENTRY_RATE * dt) {
    const shop = shops.find((candidate) => withinShopCapture(figure, candidate));
    if (shop) {
      figure.shopIndex = shop.slotIndex;
      figure.x = shop.x;
      figure.y = shop.y;
      figure.bobPhase = (figure.bobPhase + PEDESTRIAN_BOB_RATE * dt) % (Math.PI * 2);
      return;
    }
  }

  if (network.nodes.length === 0 || figure.target < 0) {
    figure.bobPhase = (figure.bobPhase + PEDESTRIAN_BOB_RATE * dt) % (Math.PI * 2);
    return;
  }

  const target = network.nodes[figure.target];
  let dx = target.x - figure.x;
  let dy = target.y - figure.y;
  let dist = Math.hypot(dx, dy);
  const stepDist = PEDESTRIAN_WALK_SPEED * dt;

  if (dist <= stepDist || dist < 1e-6) {
    // Arrived at the intersection — choose the next road segment.
    figure.x = target.x;
    figure.y = target.y;
    const current = figure.target;
    const neighbours = network.adjacency[current] ?? [];
    const forward = neighbours.filter((n) => n !== figure.from);
    const next = pick(forward.length > 0 ? forward : neighbours, rng);
    figure.from = current;
    figure.target = next ?? current;
  } else {
    dx /= dist;
    dy /= dist;
    figure.x += dx * stepDist;
    figure.y += dy * stepDist;
  }

  figure.bobPhase = (figure.bobPhase + PEDESTRIAN_BOB_RATE * dt) % (Math.PI * 2);
}

/**
 * Ensure at least `minRatio` of the live crowd is inside an occupied cell.
 *
 * Deterministic, presentation-only guarantee for the reputation income phase
 * (producer requirement: "by the time it gets to the reputation income phase
 * at least 25% will be in occupied cells"). Returns the resulting occupancy.
 */
export function forceShopOccupancy(
  figures: PedestrianFigure[],
  shops: PedestrianShop[],
  minRatio: number = PEDESTRIAN_MIN_SHOP_RATIO,
): number {
  if (figures.length === 0 || shops.length === 0) {
    return figures.reduce((count, figure) => count + (figure.shopIndex !== null ? 1 : 0), 0);
  }
  const required = Math.ceil(Math.max(0, Math.min(1, minRatio)) * figures.length);
  let occupancy = figures.reduce((count, figure) => count + (figure.shopIndex !== null ? 1 : 0), 0);
  if (occupancy >= required) return occupancy;

  let cursor = 0;
  for (const figure of figures) {
    if (occupancy >= required) break;
    if (figure.shopIndex !== null) continue;
    const shop = shops[cursor % shops.length];
    cursor += 1;
    figure.shopIndex = shop.slotIndex;
    figure.x = shop.x;
    figure.y = shop.y;
    occupancy += 1;
  }
  return occupancy;
}

/** Clamp every walking figure inside the road-network bounding rectangle. */
export function clampFiguresToNetwork(figures: PedestrianFigure[], network: RoadNetwork): void {
  if (network.nodes.length === 0) return;
  const bounds = networkBounds(network);
  for (const figure of figures) {
    if (figure.shopIndex !== null) continue;
    figure.x = clamp(figure.x, bounds.x, bounds.x + bounds.w);
    figure.y = clamp(figure.y, bounds.y, bounds.y + bounds.h);
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
 * turn (parent AC4/AC5).
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
   * `removeAll(true)`, which also destroys this layer's container).
   */
  public create(): void {
    this.attachToStreet();
  }

  /**
   * Re-attach the layer to the (possibly rebuilt) street container and
   * re-spawn the current target population. Idempotent.
   */
  public attachToStreet(): void {
    try {
      this.destroyFiguresAndContainer();
      if (!this.isEnabled()) return;
      const parent = this.scene?.getStreetContainer?.();
      if (!parent) return;
      this.ensureTexture();
      if (!this.scene?.textures?.exists?.(PEDESTRIAN_TEXTURE_KEY)) return;
      this.container = this.scene.add.container(0, 0);
      this.container.setName?.('ms-pedestrian-layer');
      parent.add(this.container);
      this.networkCache = this.computeNetwork();
      if (this.targetCount > 0) this.reconcile(this.targetCount);
    } catch (_) {
      // Presentation-only: never propagate a layer failure.
    }
  }

  /**
   * Clear the crowd and spawn a fresh set from the block corners. Called at
   * the start of a new turn (MS-0MUZ4WB290024ZGQ): the previous turn's
   * shoppers are removed and new pedestrians wander onto the street.
   */
  public startNewTurn(): void {
    try {
      if (!this.isEnabled()) {
        this.destroyFiguresAndContainer();
        return;
      }
      this.destroyFiguresAndContainer();
      if (!this.container) {
        this.attachToStreet();
        return;
      }
      this.reconcile(this.targetCount);
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
        this.destroyFiguresAndContainer();
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
        if (this.figures.length > 0 || this.container) this.destroyFiguresAndContainer();
        return;
      }
      if (!this.container || this.figures.length === 0) return;
      const network = this.networkCache ?? this.computeNetwork();
      this.networkCache = network;
      const shops = this.computeShops();
      const dt = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) / 1000 : 0;
      for (let i = 0; i < this.figures.length; i++) {
        const figure = this.figures[i];
        stepPedestrianFigure(figure, network, shops, dt, this.rng);
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
      clampFiguresToNetwork(this.figures, network);
    } catch (_) {
      // Presentation-only.
    }
  }

  /** Destroy all figures and the layer container. Wired to scene shutdown. */
  public destroy(): void {
    this.targetCount = 0;
    this.destroyFiguresAndContainer();
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

  /** Slot indices of the figures currently inside a shop. */
  public getShopOccupancy(): number[] {
    return this.figures
      .filter((figure) => figure.shopIndex !== null)
      .map((figure) => figure.shopIndex as number);
  }

  /**
   * Ensure at least {@link PEDESTRIAN_MIN_SHOP_RATIO} of the live crowd is
   * inside an occupied cell, then return the current shop occupancy. Called
   * immediately before the reputation income phase
   * (MS-0MUZ4WB290024ZGQ).
   */
  public prepareForIncomePhase(): number {
    try {
      const shops = this.computeShops();
      return forceShopOccupancy(this.figures, shops, PEDESTRIAN_MIN_SHOP_RATIO);
    } catch (_) {
      return 0;
    }
  }

  /**
   * Dissolve the on-screen pedestrians into a coin-source pool for the
   * reputation income phase (MS-0MUYGFWXK003QFYB, reworked by
   * MS-0MUZ4WB290024ZGQ).
   *
   * A target that names a `slotIndex` sources from a figure inside **that**
   * business; otherwise (or when that shop has no occupant) any shop occupant
   * is used. When no figures are inside a shop the source falls back to a
   * street-area anchor — **never** the HUD reputation counter, so the
   * conversion always reads as coming from the street.
   */
  public dissolveIntoCoins(
    targets: Array<{ x: number; y: number; slotIndex?: number }>,
  ): Array<{ x: number; y: number }> {
    try {
      const list = Array.isArray(targets) ? targets : [];
      if (list.length === 0) return [];
      this.prepareForIncomePhase();
      const anchor = this.streetAnchor();
      const occupants = this.figures.filter((figure) => figure.shopIndex !== null);
      return list.map((target) => {
        if (typeof target.slotIndex === 'number') {
          const forShop = occupants.find((figure) => figure.shopIndex === target.slotIndex);
          if (forShop) return { x: forShop.x, y: forShop.y };
        }
        const anyOccupant = occupants[0];
        if (anyOccupant) return { x: anyOccupant.x, y: anyOccupant.y };
        return { ...anchor };
      });
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

    while (this.figures.length < target) {
      const figure = spawnPedestrianFigure(network, this.rng);
      const image = this.scene.add.image(figure.x, figure.y, PEDESTRIAN_TEXTURE_KEY);
      image?.setOrigin?.(0.5, 0.5);
      image?.setDepth?.(1);
      this.container.add(image);
      this.figures.push(figure);
      this.images.push(image);
      this.fadeIn(image);
    }
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
   * Fade a removed figure out, destroying it when the tween completes. The
   * figure is already detached from the live arrays, so the count drops
   * immediately while the image fades over {@link PEDESTRIAN_FADE_MS}. Falls
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
            try {
              image.destroy?.();
            } catch (_) {
              // presentation-only
            }
          },
        });
        return;
      }
    } catch (_) {
      // fall through to an immediate destroy
    }
    try {
      image.destroy?.();
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

  private destroyFiguresAndContainer(): void {
    for (const image of this.images) {
      try {
        image?.destroy?.();
      } catch (_) {
        // ignore
      }
    }
    for (const image of this.fadingImages) {
      try {
        image?.destroy?.();
      } catch (_) {
        // ignore
      }
    }
    this.images = [];
    this.figures = [];
    this.fadingImages = [];
    try {
      this.container?.destroy?.();
    } catch (_) {
      // ignore
    }
    this.container = null;
  }
}
