/**
 * Ambient pedestrian silhouette layer — unit tests (MS-0MUYGFW7T00579Z1)
 *
 * Covers the presentation-only wander layer:
 *  - `pedestrianWanderBounds` keeps the crowd over the street band and inside
 *    the playfield (never over the market/HUD chrome);
 *  - the module-local seeded presentation PRNG is deterministic and never
 *    touches `Math.random`/gameplay RNG;
 *  - `stepPedestrianFigure` reflects off the bounds and clamps long frames;
 *  - the Phaser adapter reconciles (add/remove the delta only), parents to the
 *    street container, generates one shared texture, and moves figures on
 *    update;
 *  - Reduced Motion and replay/headless modes render nothing;
 *  - every method is defensive — a throwing scene can never propagate.
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { SceneLayout } from '../../src/scenes/MainStreetConstants';
import { PEDESTRIAN_TEXTURE_KEY } from '../../src/scenes/MainStreetConstants';
import { streetViewportRect } from '../../src/MainStreetMapView';
import {
  MainStreetPedestrians,
  createPresentationRng,
  pedestrianWanderBounds,
  shouldRenderPedestrians,
  spawnPedestrianFigure,
  stepPedestrianFigure,
  type PedestrianBounds,
} from '../../src/scenes/MainStreetPedestrians';

/** A minimal layout with the street-geometry fields the bounds maths reads. */
const LAYOUT = {
  gameW: 1280,
  gameH: 720,
  hudY: 50,
  marketTop: 60,
  streetTop: 200,
  streetX: 100,
  slotW: 140,
  slotH: 80,
  slotGap: 20,
  streetRowGap: 12,
  streetCols: 5,
} as unknown as SceneLayout;

interface MockImage {
  x: number;
  y: number;
  textureKey: string;
  setOrigin: ReturnType<typeof vi.fn>;
  setDepth: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

interface MockContainer {
  name?: string;
  children: unknown[];
  add: (child: unknown) => void;
  setName?: (name: string) => MockContainer;
  destroy: ReturnType<typeof vi.fn>;
  destroyed: boolean;
  list: unknown[];
}

function makeContainer(): MockContainer {
  const container: MockContainer = {
    children: [],
    list: [],
    destroyed: false,
    add(child: unknown) {
      container.children.push(child);
      container.list = container.children;
    },
    setName(name: string) {
      container.name = name;
      return container;
    },
    destroy: vi.fn(() => {
      container.destroyed = true;
    }),
  };
  return container;
}

interface MockScene {
  layout: SceneLayout;
  replayMode: boolean;
  settingsPanel: { reducedMotion: boolean } | null;
  streetContainer: MockContainer;
  streetChildCount: number;
  images: MockImage[];
  textures: { exists: (key: string) => boolean };
  generatedTextures: string[];
  graphicsCreated: number;
  getStreetContainer: () => MockContainer;
  add: {
    container: ReturnType<typeof vi.fn>;
    image: ReturnType<typeof vi.fn>;
    graphics: ReturnType<typeof vi.fn>;
  };
}

function createMockScene(overrides: Partial<MockScene> = {}): MockScene {
  const textures = new Map<string, boolean>();
  const textureApi = { exists: (key: string) => textures.has(key) };
  const images: MockImage[] = [];
  const generatedTextures: string[] = [];
  const streetContainer = makeContainer();
  const scene: MockScene = {
    layout: LAYOUT,
    replayMode: false,
    settingsPanel: { reducedMotion: false },
    streetContainer,
    streetChildCount: 0,
    images,
    textures: textureApi,
    generatedTextures,
    graphicsCreated: 0,
    getStreetContainer: () => streetContainer,
    add: {
      container: vi.fn(() => makeContainer()),
      image: vi.fn((x: number, y: number, textureKey: string) => {
        const image: MockImage = {
          x,
          y,
          textureKey,
          setOrigin: vi.fn().mockReturnThis(),
          setDepth: vi.fn().mockReturnThis(),
          setPosition: vi.fn(function (this: MockImage, nx: number, ny: number) {
            this.x = nx;
            this.y = ny;
            return this;
          }),
          destroy: vi.fn(),
        };
        images.push(image);
        return image;
      }),
      graphics: vi.fn(() => {
        scene.graphicsCreated += 1;
        return {
          fillStyle: vi.fn().mockReturnThis(),
          fillCircle: vi.fn().mockReturnThis(),
          fillRect: vi.fn().mockReturnThis(),
          generateTexture: vi.fn((key: string) => {
            textures.set(key, true);
            generatedTextures.push(key);
          }),
          destroy: vi.fn(),
        };
      }),
    },
  };
  Object.assign(scene, overrides);
  return scene;
}

/** Deterministic RNG stub returning a fixed repeating sequence. */
function fixedRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('pedestrianWanderBounds — stays over the street band (MS-0MUYGFW7T00579Z1)', () => {
  it('is fully contained inside the street viewport rect', () => {
    const viewport = streetViewportRect(LAYOUT);
    const bounds = pedestrianWanderBounds(LAYOUT);

    expect(bounds.w).toBeGreaterThan(0);
    expect(bounds.h).toBeGreaterThan(0);
    expect(bounds.x).toBeGreaterThanOrEqual(viewport.x);
    expect(bounds.y).toBeGreaterThanOrEqual(viewport.y);
    expect(bounds.x + bounds.w).toBeLessThanOrEqual(viewport.x + viewport.w);
    expect(bounds.y + bounds.h).toBeLessThanOrEqual(viewport.y + viewport.h);
  });

  it('keeps sampled figure centres inside the playfield (non-negative, within game bounds)', () => {
    const bounds = pedestrianWanderBounds(LAYOUT);
    const rng = createPresentationRng(1);
    for (let i = 0; i < 200; i++) {
      const figure = spawnPedestrianFigure(bounds, rng);
      expect(figure.x).toBeGreaterThanOrEqual(bounds.x);
      expect(figure.x).toBeLessThanOrEqual(bounds.x + bounds.w);
      expect(figure.y).toBeGreaterThanOrEqual(bounds.y);
      expect(figure.y).toBeLessThanOrEqual(bounds.y + bounds.h);
    }
  });
});

describe('shouldRenderPedestrians — accessibility exemptions', () => {
  it('renders only when neither Reduced Motion nor replay/headless is set', () => {
    expect(shouldRenderPedestrians({})).toBe(true);
    expect(shouldRenderPedestrians({ replayMode: false, reducedMotion: false })).toBe(true);
    expect(shouldRenderPedestrians({ reducedMotion: true })).toBe(false);
    expect(shouldRenderPedestrians({ replayMode: true })).toBe(false);
    expect(shouldRenderPedestrians({ replayMode: true, reducedMotion: true })).toBe(false);
  });
});

describe('createPresentationRng — presentation-local determinism (MS-0MUYGFW7T00579Z1)', () => {
  it('is deterministic for a fixed seed', () => {
    const a = createPresentationRng(12345);
    const b = createPresentationRng(12345);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces floats in [0, 1)', () => {
    const rng = createPresentationRng(7);
    for (let i = 0; i < 100; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('never consumes Math.random (gameplay RNG is untouched)', () => {
    const spy = vi.spyOn(Math, 'random');
    const rng = createPresentationRng(99);
    for (let i = 0; i < 50; i++) rng();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('stepPedestrianFigure — bounded wander', () => {
  const bounds: PedestrianBounds = { x: 0, y: 0, w: 100, h: 50 };

  it('reflects a figure off the right/bottom edges and keeps it inside', () => {
    const figure = { x: 99, y: 49, vx: 100, vy: 100, bobPhase: 0 };
    for (let i = 0; i < 50; i++) {
      stepPedestrianFigure(figure, bounds, 0.1);
      expect(figure.x).toBeGreaterThanOrEqual(bounds.x);
      expect(figure.x).toBeLessThanOrEqual(bounds.x + bounds.w);
      expect(figure.y).toBeGreaterThanOrEqual(bounds.y);
      expect(figure.y).toBeLessThanOrEqual(bounds.y + bounds.h);
    }
  });

  it('caps a long frame so a tab-restore cannot teleport through the bounds', () => {
    const figure = { x: 10, y: 10, vx: 1000, vy: 0, bobPhase: 0 };
    stepPedestrianFigure(figure, bounds, 60);
    expect(figure.x).toBeLessThanOrEqual(bounds.x + bounds.w);
  });

  it('treats a non-finite delta as zero', () => {
    const figure = { x: 10, y: 10, vx: 100, vy: 0, bobPhase: 0 };
    stepPedestrianFigure(figure, bounds, Number.NaN);
    expect(figure.x).toBe(10);
    expect(figure.y).toBe(10);
  });
});

describe('MainStreetPedestrians — Phaser adapter (MS-0MUYGFW7T00579Z1)', () => {
  let mathRandomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mathRandomSpy = vi.spyOn(Math, 'random');
  });
  afterEach(() => {
    mathRandomSpy.mockRestore();
  });

  it('spawns the target population, parents to the street container, and shares one texture', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(42));

    layer.setPopulation(4);

    expect(layer.getFigureCount()).toBe(4);
    expect(scene.images).toHaveLength(4);
    expect(scene.generatedTextures).toEqual([PEDESTRIAN_TEXTURE_KEY]);
    // One shared container, parented to the street container.
    expect(scene.add.container).toHaveBeenCalledTimes(1);
    expect(scene.streetContainer.children).toHaveLength(1);
    // The adaptor never touches gameplay RNG.
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });

  it('reconciles the delta instead of rebuilding (add then remove)', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(3));

    layer.setPopulation(3);
    expect(layer.getFigureCount()).toBe(3);
    const firstImages = [...scene.images];

    layer.setPopulation(5);
    expect(layer.getFigureCount()).toBe(5);
    // Existing images are retained (no rebuild): the first three survive.
    expect(scene.images.slice(0, 3)).toEqual(firstImages);

    layer.setPopulation(2);
    expect(layer.getFigureCount()).toBe(2);
    // Removed figures had their images destroyed.
    expect(firstImages[2].destroy).toHaveBeenCalled();
    expect(layer.getFigureCount()).toBe(layer.getTargetCount());
  });

  it('moves figures on update and keeps them inside the wander bounds', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(11));
    layer.setPopulation(6);
    const bounds = layer.getWanderBounds();

    layer.update(500);

    const positions = layer.getFigurePositions();
    expect(positions).toHaveLength(6);
    for (const { x, y } of positions) {
      expect(x).toBeGreaterThanOrEqual(bounds.x);
      expect(x).toBeLessThanOrEqual(bounds.x + bounds.w);
      expect(y).toBeGreaterThanOrEqual(bounds.y);
      expect(y).toBeLessThanOrEqual(bounds.y + bounds.h);
    }
    // The rendered images track the figure centres (allowing the vertical bob).
    scene.images.forEach((image, i) => {
      expect(image.setPosition).toHaveBeenCalled();
      expect(image.x).toBeCloseTo(positions[i].x, 5);
    });
  });

  it('reproduces identical layout for a fixed seed (presentation determinism)', () => {
    const run = () => {
      const scene = createMockScene();
      const layer = new MainStreetPedestrians(scene, createPresentationRng(2024));
      layer.setPopulation(5);
      layer.update(300);
      return layer.getFigurePositions();
    };
    expect(run()).toEqual(run());
  });

  it('renders nothing under Reduced Motion and consumes no RNG', () => {
    const scene = createMockScene({ settingsPanel: { reducedMotion: true } });
    const rng = vi.fn(fixedRng([0.1, 0.2, 0.3]));
    const layer = new MainStreetPedestrians(scene, rng);

    layer.setPopulation(5);
    layer.update(100);

    expect(layer.isEnabled()).toBe(false);
    expect(layer.getFigureCount()).toBe(0);
    expect(scene.images).toHaveLength(0);
    expect(scene.generatedTextures).toHaveLength(0);
    expect(rng).not.toHaveBeenCalled();
  });

  it('renders nothing in replay/headless mode', () => {
    const scene = createMockScene({ replayMode: true });
    const layer = new MainStreetPedestrians(scene, createPresentationRng(5));

    layer.setPopulation(5);
    layer.update(100);

    expect(layer.isEnabled()).toBe(false);
    expect(layer.getFigureCount()).toBe(0);
    expect(scene.images).toHaveLength(0);
  });

  it('is defensive: a throwing scene never propagates', () => {
    const scene = createMockScene({
      getStreetContainer: () => {
        throw new Error('boom');
      },
    });
    const layer = new MainStreetPedestrians(scene, createPresentationRng(5));

    expect(() => layer.create()).not.toThrow();
    expect(() => layer.setPopulation(5)).not.toThrow();
    expect(() => layer.update(16)).not.toThrow();
    expect(() => layer.resize()).not.toThrow();
    expect(() => layer.destroy()).not.toThrow();
  });

  it('survives a street rebuild (re-attach) while retaining the target population', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(8));
    layer.setPopulation(3);

    // Simulate a street rebuild clearing the container, then re-attaching.
    layer.attachToStreet();

    expect(layer.getTargetCount()).toBe(3);
    expect(layer.getFigureCount()).toBe(3);
    expect(scene.add.container).toHaveBeenCalledTimes(2);
  });

  it('re-clamps figures into the new bounds on resize', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(17));
    layer.setPopulation(4);

    // Shrink the street enormously; every figure must be clamped inside.
    (scene as { layout: SceneLayout }).layout = {
      ...LAYOUT,
      gameW: 200,
      streetX: 0,
      streetTop: 0,
      slotW: 10,
      slotH: 10,
      slotGap: 2,
      streetRowGap: 2,
    } as unknown as SceneLayout;

    layer.resize();
    const bounds = layer.getWanderBounds();
    for (const { x, y } of layer.getFigurePositions()) {
      expect(x).toBeGreaterThanOrEqual(bounds.x);
      expect(x).toBeLessThanOrEqual(bounds.x + bounds.w);
      expect(y).toBeGreaterThanOrEqual(bounds.y);
      expect(y).toBeLessThanOrEqual(bounds.y + bounds.h);
    }
  });

  it('destroys the layer on shutdown', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(1));
    layer.setPopulation(2);
    const container = scene.add.container.mock.results[0].value as MockContainer;

    layer.destroy();

    expect(layer.getFigureCount()).toBe(0);
    expect(layer.getTargetCount()).toBe(0);
    expect(container.destroy).toHaveBeenCalled();
  });
});
