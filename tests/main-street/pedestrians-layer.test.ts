/**
 * Ambient pedestrian silhouette layer — unit tests (MS-0MUYGFW7T00579Z1,
 * reworked by MS-0MUZ4WB290024ZGQ and MS-0MUZ6CGSV002WTYM).
 *
 * Covers the presentation-only road-walking layer:
 *  - `buildRoadNetwork` places intersections on the drawn road bands;
 *  - figures spawn spread around the four block-perimeter edges and walk
 *    along a road **lane** (offset from the centre-line), never down the
 *    middle;
 *  - `occupiedShops` only exposes occupied cells and `withinShopCapture`
 *    gates entry;
 *  - `stepPedestrianFigure` walks a figure deliberately into a shop (no
 *    teleport) and then keeps it there;
 *  - the crowd persists across a street rebuild (`attachToStreet`);
 *  - the end-of-turn exit sends non-shoppers off the block.
 *
 * @module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { SceneLayout } from '../../src/scenes/MainStreetConstants';
import { PEDESTRIAN_TEXTURE_KEY } from '../../src/scenes/MainStreetConstants';
import { mapRoadBands, streetViewportRect } from '../../src/MainStreetMapView';
import {
  MainStreetPedestrians,
  PEDESTRIAN_SPAWN_EDGES,
  assignShopShoppers,
  buildRoadNetwork,
  createPresentationRng,
  nearestShop,
  networkBounds,
  occupiedShops,
  pedestrianLaneOffset,
  perimeterSpawnPoint,
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

/**
 * Perpendicular distance from a point to the centre-line of the road band the
 * figure is **travelling along** (the orientation of its current segment).
 * At intersections the crossing band's centre-line is not relevant.
 */
function laneDistanceForTravel(
  x: number,
  y: number,
  network: ReturnType<typeof buildRoadNetwork>,
  from: number,
  target: number,
): number {
  const a = network.nodes[from] ?? network.nodes[target];
  const b = network.nodes[target] ?? a;
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  let best = Infinity;
  for (const band of mapRoadBands(LAYOUT, LATTICE)) {
    if (horizontal && band.orientation === 'horizontal') {
      if (x >= band.x && x <= band.x + band.w) {
        best = Math.min(best, Math.abs(y - (band.y + band.h / 2)));
      }
    } else if (!horizontal && band.orientation === 'vertical') {
      if (y >= band.y && y <= band.y + band.h) {
        best = Math.min(best, Math.abs(x - (band.x + band.w / 2)));
      }
    }
  }
  return best;
}

function figure(overrides: Partial<PedestrianFigure> = {}): PedestrianFigure {
  return {
    x: 0,
    y: 0,
    target: -1,
    from: -1,
    lane: 1,
    mode: 'walking',
    shopIndex: null,
    destX: 0,
    destY: 0,
    bobPhase: 0,
    ...overrides,
  };
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
    expect(network.cols).toBe(2);
    expect(network.rows).toBe(2);
    expect(network.corners).toHaveLength(4);
    for (const corner of network.corners) {
      expect(network.adjacency[corner].length).toBeGreaterThan(0);
    }
  });
});

describe('spawnPedestrianFigure — enters on a road lane', () => {
  it('spawns on a road lane, heading along a road', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(7);
    const laneOffset = pedestrianLaneOffset(LAYOUT);
    for (let i = 0; i < 20; i++) {
      const spawned = spawnPedestrianFigure(network, LAYOUT, rng);
      expect(spawned.mode).toBe('walking');
      expect(spawned.shopIndex).toBeNull();
      expect(spawned.target).toBeGreaterThanOrEqual(0);
      // On a lane (offset from its travel band's centre-line), not the middle.
      expect(onRoad(spawned.x, spawned.y)).toBe(true);
      expect(laneDistanceForTravel(spawned.x, spawned.y, network, spawned.from, spawned.target)).toBeCloseTo(
        laneOffset,
        3,
      );
    }
  });

  it('never consumes Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(11);
    for (let i = 0; i < 30; i++) spawnPedestrianFigure(network, LAYOUT, rng);
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

describe('stepPedestrianFigure — road-lane walking', () => {
  it('walks on a lane, not the middle, across many frames', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const laneOffset = pedestrianLaneOffset(LAYOUT);
    const rng = createPresentationRng(99);
    // Start on the long top segment's lane, heading right, so the walker stays
    // on one road segment for the whole run (spawn geometry is covered by the
    // balanced-distribution tests below).
    const start = network.nodes[0];
    const walker = figure({ x: start.x, y: start.y + laneOffset, from: 0, target: 1, lane: 1 });
    for (let i = 0; i < 500; i++) {
      stepPedestrianFigure(walker, network, [], LAYOUT, 0.05, rng);
      expect(walker.mode).toBe('walking');
      expect(onRoad(walker.x, walker.y)).toBe(true);
      // Always offset from the travel band's centre-line (not down the middle).
      expect(
        laneDistanceForTravel(walker.x, walker.y, network, walker.from, walker.target),
      ).toBeCloseTo(laneOffset, 3);
    }
  });

  it('uses both sides of the road across a spawned crowd', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(5);
    const lanes = new Set<number>();
    for (let i = 0; i < 50; i++) lanes.add(spawnPedestrianFigure(network, LAYOUT, rng).lane);
    expect(lanes.has(1)).toBe(true);
    expect(lanes.has(-1)).toBe(true);
  });

  it('treats a non-finite or negative delta as no movement', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(3);
    const walker = spawnPedestrianFigure(network, LAYOUT, rng);
    const { x, y } = walker;
    stepPedestrianFigure(walker, network, [], LAYOUT, Number.NaN, rng);
    stepPedestrianFigure(walker, network, [], LAYOUT, -1, rng);
    expect(walker.x).toBe(x);
    expect(walker.y).toBe(y);
  });

  it('caps a long frame so a tab-restore cannot leap the network', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(5);
    const walker = spawnPedestrianFigure(network, LAYOUT, rng);
    stepPedestrianFigure(walker, network, [], LAYOUT, 600, rng);
    const bounds = networkBounds(network);
    const lane = pedestrianLaneOffset(LAYOUT);
    expect(walker.x).toBeGreaterThanOrEqual(bounds.x - lane);
    expect(walker.x).toBeLessThanOrEqual(bounds.x + bounds.w + lane);
    expect(walker.y).toBeGreaterThanOrEqual(bounds.y - lane);
    expect(walker.y).toBeLessThanOrEqual(bounds.y + bounds.h + lane);
  });
});

describe('stepPedestrianFigure — deliberate shop entry (no teleport)', () => {
  it('switches to entering without jumping, then walks inside over time', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const shops = occupiedShops([{ name: 'Bakery' }], LAYOUT, LATTICE, LATTICE);
    const shop = shops[0];
    const walker = figure({
      x: shop.x + 1,
      y: network.nodes[0].y,
      target: 0,
      from: 0,
      lane: 1,
    });
    expect(withinShopCapture(walker, shop)).toBe(true);
    const before = { x: walker.x, y: walker.y };

    // rng() === 0 ⇒ the entry decision fires.
    stepPedestrianFigure(walker, network, shops, LAYOUT, 0.05, fixedRng([0]));

    expect(walker.mode).toBe('entering');
    // No teleport: the figure did not snap to the shop centre.
    const distAfter = Math.hypot(walker.x - shop.x, walker.y - shop.y);
    const distBefore = Math.hypot(before.x - shop.x, before.y - shop.y);
    expect(distAfter).toBeCloseTo(distBefore, 6);
    expect(distAfter).toBeGreaterThan(1);

    // It walks in and only then is marked inside.
    for (let i = 0; i < 300 && walker.mode !== 'inside'; i++) {
      stepPedestrianFigure(walker, network, shops, LAYOUT, 0.05, createPresentationRng(i + 1));
    }
    expect(walker.mode).toBe('inside');
    // Arrived at a random point inside the cell (not necessarily the centre).
    expect(walker.x).toBeGreaterThanOrEqual(shop.cellXMin - 0.01);
    expect(walker.x).toBeLessThanOrEqual(shop.cellXMax + 0.01);
    expect(walker.y).toBeGreaterThanOrEqual(shop.cellYMin - 0.01);
    expect(walker.y).toBeLessThanOrEqual(shop.cellYMax + 0.01);

    // Once inside it stays.
    const { x, y } = walker;
    for (let i = 0; i < 20; i++) {
      stepPedestrianFigure(walker, network, shops, LAYOUT, 0.05, createPresentationRng(i + 5));
      expect(walker.x).toBe(x);
      expect(walker.y).toBe(y);
      expect(walker.mode).toBe('inside');
    }
  });

  it('does not leave the road when no occupied cells exist', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const walker = spawnPedestrianFigure(network, LAYOUT, createPresentationRng(1));
    const rng = fixedRng([0]);
    for (let i = 0; i < 100; i++) {
      stepPedestrianFigure(walker, network, [], LAYOUT, 0.05, rng);
      expect(walker.mode).toBe('walking');
      expect(onRoad(walker.x, walker.y)).toBe(true);
    }
  });
});

describe('nearest occupied cell targeting (MS-0MUZ9O1I00088JF2)', () => {
  const shopsGrid = () =>
    occupiedShops(
      [{ name: 'A' }, null, null, null, { name: 'B' }, null, null, null, null, null],
      LAYOUT,
      LATTICE,
      LATTICE,
    );

  it('nearestShop returns the closest occupied cell', () => {
    const shops = shopsGrid();
    const shopA = shops.find((s) => s.slotIndex === 0) as (typeof shops)[number];
    const shopB = shops.find((s) => s.slotIndex === 4) as (typeof shops)[number];
    expect(nearestShop({ x: shopA.x + 5, y: shopA.y }, shops)?.slotIndex).toBe(0);
    expect(nearestShop({ x: shopB.x - 5, y: shopB.y }, shops)?.slotIndex).toBe(4);
    expect(nearestShop({ x: 0, y: 0 }, [])).toBeNull();
  });

  it('walks a figure to the nearest occupied cell and into it', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const shops = occupiedShops([{ name: 'Bakery' }], LAYOUT, LATTICE, LATTICE);
    const walker = spawnPedestrianFigure(network, LAYOUT, createPresentationRng(6));
    const rng = createPresentationRng(17);

    expect(walker.shopIndex).toBeNull();
    for (let i = 0; i < 1200 && walker.mode !== 'inside'; i++) {
      stepPedestrianFigure(walker, network, shops, LAYOUT, 0.05, rng);
    }

    expect(walker.shopIndex).toBe(shops[0].slotIndex);
    expect(walker.mode).toBe('inside');
  });

  it('retargets to a cell filled mid-turn when it is nearer', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const far = occupiedShops(
      [null, null, null, null, { name: 'B' }, null, null, null, null, null],
      LAYOUT,
      LATTICE,
      LATTICE,
    );
    const withNear = occupiedShops(
      [{ name: 'A' }, null, null, null, { name: 'B' }, null, null, null, null, null],
      LAYOUT,
      LATTICE,
      LATTICE,
    );
    const nearShop = withNear.find((shop) => shop.slotIndex === 0) as (typeof withNear)[number];
    // An explicit walker near the cell that will be filled, so the retarget
    // assertion is independent of the (evenly distributed) spawn geometry.
    const walker = figure({ x: nearShop.x + 5, y: nearShop.y, target: 0, from: 0, lane: 1 });
    const rng = createPresentationRng(23);

    // Only the far cell exists — the figure heads for it.
    stepPedestrianFigure(walker, network, far, LAYOUT, 0.05, rng);
    expect(walker.shopIndex).toBe(4);

    // A nearer cell is filled during the turn: the figure retargets to it.
    stepPedestrianFigure(walker, network, withNear, LAYOUT, 0.05, rng);
    expect(walker.shopIndex).toBe(0);
  });
});

describe('assignShopShoppers — reputation-phase minimum, teleport-free', () => {
  it('sets enough figures walking into shops without moving them', () => {
    const shops = occupiedShops(
      [{ name: 'A' }, null, { name: 'B' }, null, null, null, null, null, null, null],
      LAYOUT,
      LATTICE,
      LATTICE,
    );
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const figures = Array.from({ length: 8 }, () =>
      spawnPedestrianFigure(network, LAYOUT, createPresentationRng(1)),
    );
    const positionsBefore = figures.map((f) => ({ x: f.x, y: f.y }));

    const occupancy = assignShopShoppers(figures, shops, createPresentationRng(7), 0.25);

    expect(occupancy).toBeGreaterThanOrEqual(Math.ceil(0.25 * figures.length));
    const entering = figures.filter((f) => f.mode === 'entering');
    expect(entering.length).toBeGreaterThanOrEqual(2);
    // No teleport: every figure kept its position.
    figures.forEach((f, i) => {
      expect(f.x).toBe(positionsBefore[i].x);
      expect(f.y).toBe(positionsBefore[i].y);
    });
  });

  it('is a no-op when there are no occupied cells', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const figures = [spawnPedestrianFigure(network, LAYOUT, createPresentationRng(2))];
    expect(assignShopShoppers(figures, [], createPresentationRng(1), 0.25)).toBe(0);
    expect(figures[0].mode).toBe('walking');
  });

  it('spreads shoppers bound for the same cell across distinct interior points', () => {
    const shops = occupiedShops(
      [{ name: 'Bakery' }, null, null, null, null, null, null, null, null, null],
      LAYOUT,
      LATTICE,
      LATTICE,
    );
    const shop = shops[0];
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const figures = Array.from({ length: 6 }, () =>
      spawnPedestrianFigure(network, LAYOUT, createPresentationRng(3)),
    );

    assignShopShoppers(figures, shops, createPresentationRng(99), 1);

    const destinations = figures.map((f) => `${f.destX.toFixed(2)},${f.destY.toFixed(2)}`);
    // Every figure walks to its own point inside the cell.
    expect(new Set(destinations).size).toBeGreaterThan(1);
    for (const figure of figures) {
      expect(figure.destX).toBeGreaterThanOrEqual(shop.cellXMin - 0.01);
      expect(figure.destX).toBeLessThanOrEqual(shop.cellXMax + 0.01);
      expect(figure.destY).toBeGreaterThanOrEqual(shop.cellYMin - 0.01);
      expect(figure.destY).toBeLessThanOrEqual(shop.cellYMax + 0.01);
    }
  });
});

describe('shouldRenderPedestrians — accessibility exemptions', () => {
  it('renders only when neither Reduced Motion nor replay/headless is set', () => {
    expect(shouldRenderPedestrians({})).toBe(true);
    expect(shouldRenderPedestrians({ reducedMotion: true })).toBe(false);
    expect(shouldRenderPedestrians({ replayMode: true })).toBe(false);
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

describe('balanced perimeter spawn distribution (MS-0MUZH6P0M00443G0)', () => {
  const EDGES = PEDESTRIAN_SPAWN_EDGES;

  /** Distance from a point to its nearest block-corner node. */
  const distanceToNearestCorner = (
    network: ReturnType<typeof buildRoadNetwork>,
    position: { x: number; y: number },
  ): number =>
    Math.min(
      ...network.corners.map((corner) =>
        Math.hypot(
          network.nodes[corner].x - position.x,
          network.nodes[corner].y - position.y,
        ),
      ),
    );

  it('covers all four edges and includes non-corner origins across a seeded run', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(1234);
    const edges = new Set<string>();
    const total = 40;
    let nonCorner = 0;

    for (let i = 0; i < total; i++) {
      const spawned = spawnPedestrianFigure(network, LAYOUT, rng, i);
      expect(spawned.mode).toBe('walking');
      expect(spawned.spawnEdge).toBeDefined();
      edges.add(spawned.spawnEdge as string);
      if (distanceToNearestCorner(network, spawned) > 50) nonCorner += 1;
      // Still on a road lane, heading along a valid road segment.
      expect(onRoad(spawned.x, spawned.y)).toBe(true);
      expect(
        laneDistanceForTravel(spawned.x, spawned.y, network, spawned.from, spawned.target),
      ).toBeCloseTo(pedestrianLaneOffset(LAYOUT), 3);
    }

    expect([...edges].sort()).toEqual([...EDGES].sort());
    // Most figures originate part-way along an edge, not at a corner node.
    expect(nonCorner).toBeGreaterThanOrEqual(total / 4);
  });

  it('keeps the per-edge share balanced (stratified round-robin)', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(77);
    const total = 40;
    const counts = new Map<string, number>();

    for (let i = 0; i < total; i++) {
      const edge = spawnPedestrianFigure(network, LAYOUT, rng, i).spawnEdge as string;
      counts.set(edge, (counts.get(edge) ?? 0) + 1);
    }

    for (const edge of EDGES) expect(counts.get(edge) ?? 0).toBe(total / 4);
  });

  it('keeps the per-edge share within one of an equal share for a non-multiple run', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(555);
    const total = 42;
    const counts = new Map<string, number>();

    for (let i = 0; i < total; i++) {
      const edge = spawnPedestrianFigure(network, LAYOUT, rng, i).spawnEdge as string;
      counts.set(edge, (counts.get(edge) ?? 0) + 1);
    }

    for (const edge of EDGES) {
      expect(Math.abs((counts.get(edge) ?? 0) - total / 4)).toBeLessThanOrEqual(1);
    }
  });

  it('emits mid-edge spawn points on valid adjacent perimeter nodes', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const rng = createPresentationRng(9);
    const points = Array.from({ length: 40 }, (_, i) =>
      perimeterSpawnPoint(network, LAYOUT, rng, i),
    );

    for (const point of points) {
      expect(point).not.toBeNull();
      const spawn = point as NonNullable<typeof point>;
      expect(EDGES).toContain(spawn.edge);
      expect(spawn.from).not.toBe(spawn.target);
      expect(network.adjacency[spawn.from]).toContain(spawn.target);
      expect(onRoad(spawn.x, spawn.y)).toBe(true);
    }

    const midEdge = points.filter(
      (point) => distanceToNearestCorner(network, point as NonNullable<typeof point>) >= 50,
    );
    expect(midEdge.length).toBeGreaterThan(0);
  });

  it('spreads an evenly distributed crowd across more than one occupied business', () => {
    const network = buildRoadNetwork(LAYOUT, LATTICE);
    const grid: Array<unknown> = [
      { name: 'Left' },
      null,
      null,
      null,
      { name: 'Right' },
      null,
      null,
      null,
      null,
      null,
    ];
    const shops = occupiedShops(grid, LAYOUT, LATTICE, LATTICE);
    const spawnRng = createPresentationRng(4242);
    const figures = Array.from({ length: 24 }, (_, i) =>
      spawnPedestrianFigure(network, LAYOUT, spawnRng, i),
    );

    // Even entry spread means the crowd does not all target the same shop.
    const initialTargets = new Set(
      figures.map((figure) => nearestShop(figure, shops)?.slotIndex ?? -1),
    );
    expect(initialTargets.size).toBeGreaterThanOrEqual(2);

    const stepRng = createPresentationRng(99);
    for (let frame = 0; frame < 2000; frame++) {
      for (const figure of figures) {
        if (figure.mode === 'walking' || figure.mode === 'entering') {
          stepPedestrianFigure(figure, network, shops, LAYOUT, 0.05, stepRng);
        }
      }
    }

    const occupied = new Set(
      figures.filter((figure) => figure.mode === 'inside').map((figure) => figure.shopIndex),
    );
    expect(occupied.size).toBeGreaterThanOrEqual(2);
  });

  it('uses the stratified perimeter for mid-turn population gains', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(31));
    layer.setPopulation(2);
    layer.update(16);
    const before = layer.getFigureSnapshot();

    layer.setPopulation(6);
    layer.update(16);
    const gained = layer.getFigureSnapshot().slice(before.length);

    expect(gained).toHaveLength(4);
    expect(new Set(gained.map((fig) => fig.spawnEdge)).size).toBe(4);
    for (const fig of gained) expect(onRoad(fig.x, fig.y)).toBe(true);
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

  it('moves walking figures on lanes as it updates', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(11));
    layer.setPopulation(6);

    const before = layer.getFigurePositions();
    layer.update(500);
    const after = layer.getFigurePositions();

    expect(after).toHaveLength(6);
    expect(after.some((p, i) => p.x !== before[i].x || p.y !== before[i].y)).toBe(true);
    const laneOffset = pedestrianLaneOffset(LAYOUT);
    const network = layer.getRoadNetwork();
    for (const fig of layer.getFigureSnapshot()) {
      if (fig.mode !== 'walking') continue;
      expect(onRoad(fig.x, fig.y)).toBe(true);
      expect(
        laneDistanceForTravel(fig.x, fig.y, network, fig.from, fig.target),
      ).toBeCloseTo(laneOffset, 3);
    }
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

  it('preserves the crowd across a street rebuild (card played)', () => {
    const scene = createMockScene();
    const layer = new MainStreetPedestrians(scene, createPresentationRng(8));
    layer.setPopulation(4);
    layer.update(500);
    const before = layer.getFigurePositions();
    const modesBefore = layer.getFigureModes();

    // A street rebuild clears the container and re-attaches the layer.
    layer.attachToStreet();

    expect(layer.getFigureCount()).toBe(4);
    expect(layer.getTargetCount()).toBe(4);
    expect(layer.getFigurePositions()).toEqual(before);
    expect(layer.getFigureModes()).toEqual(modesBefore);
  });

  it('walks non-shoppers off the block at end of turn and clears leftovers next turn', () => {
    const scene = createMockScene();
    scene.state.streetGrid = [
      { name: 'Bakery' },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];
    const layer = new MainStreetPedestrians(scene, createPresentationRng(21));
    layer.setPopulation(8);

    layer.beginEndOfTurn();

    const modes = layer.getFigureModes();
    expect(modes.filter((m) => m === 'entering').length).toBeGreaterThanOrEqual(2);
    expect(modes.filter((m) => m === 'leaving').length).toBeGreaterThanOrEqual(1);
    expect(modes.includes('walking')).toBe(false);

    // Walk the crowd until the leavers have left the block.
    for (let i = 0; i < 400; i++) layer.update(100);

    const finalModes = layer.getFigureModes();
    expect(finalModes.includes('leaving')).toBe(false);
    expect(finalModes.filter((m) => m === 'inside').length).toBeGreaterThanOrEqual(2);
    expect(layer.getFigureCount()).toBeLessThan(8);

    // A new turn clears the leftovers and spawns a fresh crowd spread around
    // the block perimeter (not clustered at the four corners).
    layer.startNewTurn();
    expect(layer.getFigureCount()).toBe(8);
    const snapshot = layer.getFigureSnapshot();
    for (const fig of snapshot) {
      expect(fig.spawnEdge).not.toBeNull();
      expect(onRoad(fig.x, fig.y)).toBe(true);
    }
    expect(new Set(snapshot.map((fig) => fig.spawnEdge)).size).toBeGreaterThanOrEqual(2);
  });

  it('sources reputation coins from a figure inside the target shop', () => {
    const scene = createMockScene();
    scene.state.streetGrid = [
      { name: 'Bakery' },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];
    const layer = new MainStreetPedestrians(scene, createPresentationRng(2));
    layer.setPopulation(4);
    layer.update(16);

    const assigned = layer.prepareForIncomePhase();
    expect(assigned).toBeGreaterThanOrEqual(Math.ceil(0.25 * 4));

    // Walk the shoppers in.
    for (let i = 0; i < 300 && layer.getShopOccupancy().length === 0; i++) layer.update(100);
    expect(layer.getShopOccupancy()).toContain(0);

    const sources = layer.dissolveIntoCoins([{ x: 0, y: 0, slotIndex: 0 }]);
    const shop = occupiedShops(scene.state.streetGrid, LAYOUT, LATTICE, LATTICE)[0];
    expect(sources).toHaveLength(1);
    // Sourced from a figure inside the cell (spread), not the cell centre.
    expect(sources[0].x).toBeGreaterThanOrEqual(shop.cellXMin - 0.01);
    expect(sources[0].x).toBeLessThanOrEqual(shop.cellXMax + 0.01);
    expect(sources[0].y).toBeGreaterThanOrEqual(shop.cellYMin - 0.01);
    expect(sources[0].y).toBeLessThanOrEqual(shop.cellYMax + 0.01);
    expect(layer.getFigurePositions()).toContainEqual(sources[0]);
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
    layer.beginEndOfTurn();

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
    expect(() => layer.beginEndOfTurn()).not.toThrow();
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
