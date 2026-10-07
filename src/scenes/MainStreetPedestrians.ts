/**
 * MainStreetPedestrians — ambient pedestrian silhouette layer.
 *
 * Derives the on-street pedestrian figure count from the player's reputation
 * and renders a presentation-only crowd of small silhouette figures that
 * wander within the street band. The layer is **presentation-only**: it never
 * mutates game state, the transcript, or the turn flow, and it draws its
 * randomness from a module-local seeded PRNG so it can never consume the
 * seeded gameplay RNG (seeded determinism and headless/AI parity are
 * preserved).
 *
 * Pure, Phaser-free helpers (count maths, wander bounds, PRNG, figure
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
  PEDESTRIAN_SILHOUETTE_H,
  PEDESTRIAN_SILHOUETTE_W,
  PEDESTRIAN_STREET_PADDING,
  PEDESTRIAN_TEXTURE_KEY,
  PEDESTRIAN_WALK_SPEED,
} from './MainStreetConstants';
import { streetViewportRect } from '../MainStreetMapView';

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

// ── Pure helper: wander bounds ─────────────────────────────────────

/** Axis-aligned rectangle in map-local coordinates. */
export interface PedestrianBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The map-local region pedestrian centres may occupy.
 *
 * Derived from the street viewport band (`streetViewportRect`, the plot area
 * plus its road ring) so the crowd stays over the street/road band and inside
 * the playfield, never over the market/HUD chrome. The inset accounts for the
 * silhouette half-size, the vertical bob, and a small padding so no figure
 * pokes outside the band.
 */
export function pedestrianWanderBounds(layout: SceneLayout): PedestrianBounds {
  const viewport = streetViewportRect(layout);
  const padX = PEDESTRIAN_STREET_PADDING + PEDESTRIAN_SILHOUETTE_W / 2;
  const padY = PEDESTRIAN_STREET_PADDING + PEDESTRIAN_SILHOUETTE_H / 2 + PEDESTRIAN_BOB_AMPLITUDE;
  return {
    x: viewport.x + padX,
    y: viewport.y + padY,
    w: Math.max(0, viewport.w - 2 * padX),
    h: Math.max(0, viewport.h - 2 * padY),
  };
}

// ── Pure helper: figure model + stepping ───────────────────────────

/** One wandering pedestrian, in map-local coordinates (x/y = centre). */
export interface PedestrianFigure {
  x: number;
  y: number;
  /** Horizontal velocity in map-local px per second. */
  vx: number;
  /** Vertical velocity in map-local px per second. */
  vy: number;
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

/**
 * Spawn a pedestrian at a random position inside `bounds` with a random
 * heading. Uses only the supplied RNG (presentation-local by contract).
 */
export function spawnPedestrianFigure(bounds: PedestrianBounds, rng: () => number): PedestrianFigure {
  const w = Math.max(0, bounds.w);
  const h = Math.max(0, bounds.h);
  const angle = sample01(rng) * Math.PI * 2;
  const speed = PEDESTRIAN_WALK_SPEED * (0.5 + sample01(rng) * 0.5);
  return {
    x: bounds.x + sample01(rng) * w,
    y: bounds.y + sample01(rng) * h,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed * 0.5,
    bobPhase: sample01(rng) * Math.PI * 2,
  };
}

/**
 * Advance a figure by `dtSeconds`, reflecting it off the wander-bounds edges
 * so it never leaves the street band. `dtSeconds` is capped so a long frame
 * (tab restore) cannot teleport a figure through the bounds.
 */
export function stepPedestrianFigure(
  figure: PedestrianFigure,
  bounds: PedestrianBounds,
  dtSeconds: number,
): void {
  const dt = Number.isFinite(dtSeconds) ? clamp(dtSeconds, 0, 0.1) : 0;

  figure.x += figure.vx * dt;
  figure.y += figure.vy * dt;

  const minX = bounds.x;
  const maxX = bounds.x + Math.max(0, bounds.w);
  if (figure.x < minX) {
    figure.x = minX;
    figure.vx = Math.abs(figure.vx);
  } else if (figure.x > maxX) {
    figure.x = maxX;
    figure.vx = -Math.abs(figure.vx);
  }

  const minY = bounds.y;
  const maxY = bounds.y + Math.max(0, bounds.h);
  if (figure.y < minY) {
    figure.y = minY;
    figure.vy = Math.abs(figure.vy);
  } else if (figure.y > maxY) {
    figure.y = maxY;
    figure.vy = -Math.abs(figure.vy);
  }

  figure.bobPhase = (figure.bobPhase + PEDESTRIAN_BOB_RATE * dt) % (Math.PI * 2);
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
  private boundsCache: PedestrianBounds | null = null;
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
      this.boundsCache = this.computeBounds();
      if (this.targetCount > 0) this.reconcile(this.targetCount);
    } catch (_) {
      // Presentation-only: never propagate a layer failure.
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

  /** Advance the wander animation. Wired to the scene `update` loop. */
  public update(deltaMs: number): void {
    try {
      if (!this.isEnabled()) {
        if (this.figures.length > 0 || this.container) this.destroyFiguresAndContainer();
        return;
      }
      if (!this.container || this.figures.length === 0) return;
      const bounds = this.boundsCache ?? this.computeBounds();
      this.boundsCache = bounds;
      const dt = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) / 1000 : 0;
      for (let i = 0; i < this.figures.length; i++) {
        const figure = this.figures[i];
        stepPedestrianFigure(figure, bounds, dt);
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

  /** Re-clamp figures into the (possibly re-computed) wander bounds. */
  public resize(): void {
    try {
      if (!this.isEnabled()) return;
      const bounds = this.computeBounds();
      this.boundsCache = bounds;
      for (const figure of this.figures) {
        figure.x = clamp(figure.x, bounds.x, bounds.x + Math.max(0, bounds.w));
        figure.y = clamp(figure.y, bounds.y, bounds.y + Math.max(0, bounds.h));
      }
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

  /** The current wander bounds (map-local), for tests and dissolve sourcing. */
  public getWanderBounds(): PedestrianBounds {
    if (!this.boundsCache) this.boundsCache = this.computeBounds();
    return { ...this.boundsCache };
  }

  // ── internals ────────────────────────────────────────────────────

  private computeBounds(): PedestrianBounds {
    try {
      const layout = this.scene?.layout as SceneLayout | undefined;
      if (!layout) return { x: 0, y: 0, w: 0, h: 0 };
      return pedestrianWanderBounds(layout);
    } catch (_) {
      return { x: 0, y: 0, w: 0, h: 0 };
    }
  }

  private reconcile(target: number): void {
    if (!this.container) return;
    const bounds = this.boundsCache ?? this.computeBounds();
    this.boundsCache = bounds;

    while (this.figures.length > target) {
      const image = this.images.pop();
      this.figures.pop();
      this.fadeOutAndDestroy(image);
    }

    while (this.figures.length < target) {
      const figure = spawnPedestrianFigure(bounds, this.rng);
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
