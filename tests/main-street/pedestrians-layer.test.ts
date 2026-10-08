/**
 * Ambient pedestrian silhouette layer — unit tests (MS-0MUYGFW7T00579Z1,
 * reworked by MS-0MUZ4WB290024ZGQ).
 *
 * Covers the presentation-only road-walking layer:
 *  - `buildRoadNetwork` places intersections on the drawn road bands;
 *  - figures spawn at the block corners and walk along road segments;
 *  - `occupiedShops` only exposes occupied cells and `withinShopCapture`
 *    gates entry;
 *  - `stepPedestrianFigure` keeps walking figures on a road, enters an
 *    occupied shop and then keeps the figure there;
 *  - `forceShopOccupancy` guarantees the reputation-phase minimum;
 *  - the module-local seeded presentation PRNG is deterministic and never
 *    touches `Math.random`/gameplay RNG;
 *  - the Phaser adapter reconciles (add/remove the delta only), parents to the
 *    street container, generates one shared texture, moves figures on update,
 *    resets the crowd at turn start, and is defensive throughout.
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { SceneLayout } from '../../src/scenes/MainStreetConstants';
import { PEDESTRIAN_TEXTURE_KEY } from '../../src/scenes/MainStreetConstants';
import { mapRoadBands, streetViewportRect } from '../../src/MainStreetMapView';
import {
  MainStreetPedestrians,
  buildRoadNetwork,
  createPresentationRng,
  forceShopOccupancy,
  networkBounds,
  occupiedShops,
  shouldRenderPedestrians,
  spawnPedestrianFigure,
  stepPedestrianFigure,
  withinShopCapture,
  type PedestrianFigure,
} from '../../src/scenes/MainStreetPedestrians';

/** A minimal layout with the street-geometry fields the road maths reads. */
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

const LATTICE = { cols: 1, rows: 1 } as const;

/** True when a map-local point lies inside one of the drawn road bands. */
function onRoad(x: number, y: number): boolean {
  return mapRoadBands(LAYOUT, LATTICE).some(
    (band) => x >= band.x && x <= band.x + band.w && y >= band.y && y <= band.y + band.h,
  );
}

function figure(overrides: Partial<PedestrianFigure> = {}): PedestrianFigure {
  return { x: 0, y: 0, target: -1, from: -1, shopIndex: null, bobPhase: 0, ...overrides };
}

/** Deterministic RNG stub returning a fixed repeating sequence. */
function fixedRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

interface MockImage {
  x: number;
  y: number;
  textureKey: string;
  setOrigin: ReturnType<typeof vi.fn>;
  setDepth: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  setAlpha: ReturnType<typeof vi.fn>;
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
  state: { streetGrid: Array<unknown> | undefined };
  images: MockImage[];
  textures: { exists: (key: string) => boolean };
  generatedTextures: string[];
  getStreetContainer: () => MockContainer;
  getStreetViewLattice: () => { cols: number; rows: number };
  streetPlayableLattice: { cols: number; rows: number };
  add: {
    container: ReturnType<typeof vi.fn>;
    image: ReturnType<typeof vi.fn>;
    graphics: ReturnType<typeof vi.fn>;
  };
  /** Omitted by default so fade-out destroys immediately (no tween manager). */
  tweens?: { add: ReturnType<typeof vi.fn> };
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
    state: { streetGrid: Array.from({ length: 10 }, () => null) },
    images,
    textures: textureApi,
    generatedTextures,
    getStreetContainer: () => streetContainer,
    getStreetViewLattice: () => ({ cols: 1, rows: 1 }),
    streetPlayableLattice: { cols: 1, rows: 1 },
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
          setAlpha: vi.fn().mockReturnThis(),
          destroy: vi.fn(),
        };
        images.push(image);
        return image;
      }),
      graphics: vi.fn(() => ({
        fillStyle: vi.fn().mockReturnThis(),
        fillCircle: vi.fn().mockReturnThis(),
        fillRect: vi.fn().mockReturnThis(),
        generateTexture: vi.fn((key: string) => {
          textures.set(key, true);
          generatedTextures.push(key);
        }),
        destroy: vi.fn(),
      })),
    },
  };
  Object.assign(scene, overrides);
  return scene;
}

describe('buildRoadNetwork — intersections on the drawn roads', () => {
  it('places every node on a road band', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    expect(network.nodes.length).toBeGreaterThanOrEqual(4);
    for (const node of network.nodes) {
      expect(onRoad(node.x, node.y)).toBe(true);
    }
  });

  it('connects adjacent intersections and exposes four block corners', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    // A 1×1 lattice is a 2×2 node grid (a rectangular ring of four nodes).
    expect(network.cols).toBe(2);
    expect(network.rows).toBe(2);
    expect(network.corners).toHaveLength(4);
    for (const corner of network.corners) {
      expect(network.adjacency[corner].length).toBeGreaterThan(0);
    }
  });
});

describe('spawnPedestrianFigure — enters from a block corner', () => {
  it('spawns at a corner node and heads along a road', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(7);
    for (let i = 0; i < 20; i++) {
      const spawned = spawnPedestrianFigure(network, rng);
      const corner = network.corners.find(
        (c) => network.nodes[c].x === spawned.x && network.nodes[c].y === spawned.y,
      );
      expect(corner).toBeDefined();
      expect(spawned.shopIndex).toBeNull();
      expect(spawned.target).toBeGreaterThanOrEqual(0);
    }
  });

  it('never consumes Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(11);
    for (let i = 0; i < 30; i++) spawnPedestrianFigure(network, rng);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('occupiedShops — only occupied cells are enterable', () => {
  it('returns nothing when the street grid is empty', () => {
    expect(occupiedShops([null, null], LAYOUT, LATTICE, LATTICE)).toHaveLength(0);
    expect(occupiedShops(undefined, LAYOUT, LATTICE, LATTICE)).toHaveLength(0);
  });

  it('returns a capture zone per occupied cell only', () => {
    const grid: Array<unknown> = [null, { name: 'Bakery' }, null, { name: 'Diner' }];
    const shops = occupiedShops(grid, LAYOUT, LATTICE, LATTICE);
    expect(shops.map((shop) => shop.slotIndex)).toEqual([1, 3]);
    expect(shops.every((shop) => Number.isFinite(shop.x) && Number.isFinite(shop.y))).toBe(true);
  });
});

describe('stepPedestrianFigure — road-only walking', () => {
  it('keeps a walking figure on a road band across many frames', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(99);
    const walker = spawnPedestrianFigure(network, rng);
    for (let i = 0; i < 500; i++) {
      stepPedestrianFigure(walker, network, [], 0.05, rng);
      expect(walker.shopIndex).toBeNull();
      expect(onRoad(walker.x, walker.y)).toBe(true);
    }
  });

  it('treats a non-finite or negative delta as no movement', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(3);
    const walker = spawnPedestrianFigure(network, rng);
    const { x, y } = walker;
    stepPedestrianFigure(walker, network, [], Number.NaN, rng);
    stepPedestrianFigure(walker, network, [], -1, rng);
    expect(walker.x).toBe(x);
    expect(walker.y).toBe(y);
  });

  it('caps a long frame so a tab-restore cannot leap the network', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(5);
    const walker = spawnPedestrianFigure(network, rng);
    stepPedestrianFigure(walker, network, [], 600, rng);
    const bounds = networkBounds(network);
    expect(walker.x).toBeGreaterThanOrEqual(bounds.x);
    expect(walker.x).toBeLessThanOrEqual(bounds.x + bounds.w);
    expect(walker.y).toBeGreaterThanOrEqual(bounds.y);
    expect(walker.y).toBeLessThanOrEqual(bounds.y + bounds.h);
  });
});

describe('stepPedestrianFigure — entering an occupied shop', () => {
  it('enters an occupied shop when in range and then stays there', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const shops = occupiedShops([{ name: 'Bakery' }], LAYOUT, LATTICE, LATTICE);
    const shop = shops[0];
    // Start a walker on the road directly above the shop.
    const walker = figure({ x: shop.x, y: network.nodes[0].y, target: -1, from: -1 });
    expect(withinShopCapture(walker, shop)).toBe(true);

    // rng() === 0 ⇒ the entry test always fires.
    stepPedestrianFigure(walker, network, shops, 0.05, fixedRng([0]));

    expect(walker.shopIndex).toBe(shop.slotIndex);
    const { x, y } = walker;
    for (let i = 0; i < 50; i++) {
      stepPedestrianFigure(walker, network, shops, 0.05, createPresentationRng(i + 1));
      expect(walker.x).toBe(x);
      expect(walker.y).toBe(y);
      expect(walker.shopIndex).toBe(shop.slotIndex);
    }
  });

  it('does not leave the road when no occupied cells exist', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const walker = spawnPedestrianFigure(network, createPresentationRng(1));
    const rng = fixedRng([0]);
    for (let i = 0; i < 100; i++) {
      stepPedestrianFigure(walker, network, [], 0.05, rng);
      expect(walker.shopIndex).toBeNull();
      expect(onRoad(walker.x, walker.y)).toBe(true);
    }
  });
});

describe('forceShopOccupancy — reputation-phase minimum', () => {
  it('moves enough figures inside so at least 25% are in shops', () => {
    const shops = occupiedShops(
      [{ name: 'A' }, null, { name: 'B' }, null, null, null, null, null, null, null],
      LAYOUT,
      LATTICE,
      LATTICE,
    );
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const figures = Array.from({ length: 8 }, () => spawnPedestrianFigure(network, createPresentationRng(1)));

    const occupancy = forceShopOccupancy(figures, shops, 0.25);

    expect(occupancy).toBeGreaterThanOrEqual(Math.ceil(0.25 * figures.length));
    expect(figures.filter((f) => f.shopIndex !== null).length).toBe(occupancy);
  });

  it('is a no-op when there are no occupied cells', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const figures = [spawnPedestrianFigure(network, createPresentationRng(2))];
    expect(forceShopOccupancy(figures, [], 0.25)).toBe(0);
    expect(figures[0].shopIndex).toBeNull();
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

describe('createPresentationRng — presentation-local determinism', () => {
  it('is deterministic for a fixed seed and yields floats in [0, 1)', () => {
    const a = createPresentationRng(12345);
    const b = createPresentationRng(12345);
    for (let i = 0; i < 50; i++) {
      const value = a();
      expect(value).toBe(b());
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

describe('MainStreetPedestrians — Phaser adapter', () => {
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
    expect(scene.add.container).toHaveBeenCalledTimes(1);
    expect(scene.streetContainer.children).toHaveLength(1);
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });

  it('reconciles the delta instead of rebuilding (add then remove)', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(3));

    layer.setPopulation(3);
    const firstImages = [...scene.images];

    layer.setPopulation(5);
    expect(layer.getFigureCount()).toBe(5);
    expect(scene.images.slice(0, 3)).toEqual(firstImages);

    layer.setPopulation(2);
    expect(layer.getFigureCount()).toBe(2);
    expect(firstImages[2].destroy).toHaveBeenCalled();
    expect(layer.getFigureCount()).toBe(layer.getTargetCount());
  });

  it('moves walking figures along roads on update', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(11));
    layer.setPopulation(6);

    const before = layer.getFigurePositions();
    layer.update(500);
    const after = layer.getFigurePositions();

    expect(after).toHaveLength(6);
    // At least one figure moved along its road segment.
    expect(after.some((p, i) => p.x !== before[i].x || p.y !== before[i].y)).toBe(true);
    // Rendered images track the figure centres.
    scene.images.forEach((image, i) => {
      expect(image.setPosition).toHaveBeenCalled();
      expect(image.x).toBeCloseTo(after[i].x, 5);
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

  it('clears and respawns the crowd from the corners at the start of a new turn', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(31));
    layer.setPopulation(4);

    const firstImages = [...scene.images];
    layer.startNewTurn();

    expect(layer.getFigureCount()).toBe(4);
    expect(layer.getTargetCount()).toBe(4);
    // The old figures were destroyed and replaced by a fresh set.
    expect(firstImages[0].destroy).toHaveBeenCalled();
    expect(scene.images.length).toBe(8);
    const network = layer.getRoadNetwork();
    for (const position of layer.getFigurePositions()) {
      const atCorner = network.corners.some(
        (c) => network.nodes[c].x === position.x && network.nodes[c].y === position.y,
      );
      expect(atCorner).toBe(true);
    }
  });

  it('sources reputation coins from a figure inside the target shop', () => {
    const scene = createMockScene();
    scene.state.streetGrid = [{ name: 'Bakery' }, null, null, null, null, null, null, null, null, null];
    const layer = new MainStreetPedestrians(scene, createPresentationRng(2));
    layer.setPopulation(4);
    layer.update(16);

    const occupancy = layer.prepareForIncomePhase();
    expect(occupancy).toBeGreaterThanOrEqual(Math.ceil(0.25 * 4));
    expect(layer.getShopOccupancy()).toContain(0);

    const sources = layer.dissolveIntoCoins([{ x: 0, y: 0, slotIndex: 0 }]);
    const shop = occupiedShops(scene.state.streetGrid, LAYOUT, LATTICE, LATTICE)[0];
    expect(sources).toEqual([{ x: shop.x, y: shop.y }]);
  });

  it('falls back to the street anchor — never the HUD counter — with no shops', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(4));
    layer.setPopulation(2);
    const viewport = streetViewportRect(LAYOUT);

    const sources = layer.dissolveIntoCoins([{ x: 0, y: 0, slotIndex: 0 }]);

    expect(sources).toHaveLength(1);
    expect(sources[0].y).toBeGreaterThan(LAYOUT.hudY);
    expect(sources[0].x).toBeCloseTo(viewport.x + viewport.w / 2, 5);
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
    expect(() => layer.startNewTurn()).not.toThrow();
    expect(() => layer.dissolveIntoCoins([{ x: 0, y: 0 }])).not.toThrow();
    expect(() => layer.destroy()).not.toThrow();
  });

  it('survives a street rebuild (re-attach) while retaining the target population', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(8));
    layer.setPopulation(3);

    layer.attachToStreet();

    expect(layer.getTargetCount()).toBe(3);
    expect(layer.getFigureCount()).toBe(3);
    expect(scene.add.container).toHaveBeenCalledTimes(2);
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
