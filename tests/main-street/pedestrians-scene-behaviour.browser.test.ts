/**
 * Main Street: ambient reputation crowd — scene-level behaviour assertions
 * (parent MS-0MVRDVVH4001048Q / this item MS-0MVRMHVQ6004M7MO).
 *
 * Why this file exists
 * --------------------
 * `pedestrians-scene-visibility.browser.test.ts` guards that the crowd is
 * *present and visible*. Every other pedestrian suite drives the layer against
 * a **mock** scene, so the behaviours the intake brief measures (parent AC3,
 * AC4, AC5, AC6) are only ever asserted one seam away from the real scene:
 * reconciliation against the HUD value, shop occupancy at the reputation
 * income phase, crowd-sourced coin flights, the Reduced Motion / replay
 * exemptions and crowd persistence across a street rebuild.
 *
 * This file boots the **real** `MainStreetScene` (via `createMainStreetGame` +
 * `waitForScene`, the same harness as `activity-log-rendering.browser.test.ts`
 * and the visibility guard) in normal play with default settings, and asserts
 * each documented behaviour on the live scene graph, the live layer and the
 * live income animator:
 *
 *  - **parent AC3** — the live figure count tracks `pedestrianCount(reputation)`
 *    through the real HUD refresh path (a reputation gain reconciles the crowd).
 *  - **parent AC4** — figures walk on the road lanes, seek the
 *    nearest-occupied cell and walk into it deliberately (continuous motion,
 *    no teleport); by the reputation income phase at least
 *    `PEDESTRIAN_MIN_SHOP_RATIO` of the live crowd is inside, or walking into,
 *    occupied cells (the layer's teleport-free enforcement), and the crowd and
 *    its layer survive a street rebuild.
 *  - **parent AC5** — each reputation-phase coin flight is sourced from a crowd
 *    figure at that business (never the HUD reputation counter) and the
 *    credited reputation total equals the engine's deferred total.
 *  - **parent AC6** — Reduced Motion and replay/headless render zero figures and
 *    produce no reputation-phase dissolution/flights.
 *
 * The assertions are deliberately scene-graph + public-API based (no pixel
 * read-back), so they are deterministic across the WebGL/Canvas renderers.
 *
 * @module
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import Phaser from 'phaser';
import { waitForScene } from '@core-tests/helpers/waitForScene';

import { dismissTurnSummaryDialog } from './helpers/turn-summary-dialog';
import { getBusinessTemplates, type BusinessCard } from '../../src/MainStreetCards';
import { iconsForAmount, roundHalf } from '../../src/coin-grid';
import { hudFlightTarget } from '../../src/scenes/MainStreetAnimatorContext';
import { mapRoadBands } from '../../src/MainStreetMapView';
import {
  PEDESTRIAN_ENTER_SPEED_MULTIPLIER,
  PEDESTRIAN_MIN_SHOP_RATIO,
  PEDESTRIAN_TEXTURE_KEY,
  PEDESTRIAN_WALK_SPEED,
  type SceneLayout,
} from '../../src/scenes/MainStreetConstants';
import {
  occupiedShops,
  pedestrianCount,
  pedestrianLaneOffset,
  nearestShop,
  withinShopCapture,
  type PedestrianShop,
} from '../../src/scenes/MainStreetPedestrians';

/** Name the layer gives its container (see `MainStreetPedestrians.attachToStreet`). */
const LAYER_CONTAINER_NAME = 'ms-pedestrian-layer';

/** Reputation used by the income-phase tests: high enough for the coin multiplier. */
const INCOME_TEST_REPUTATION = 1000;

type FigureMode = 'walking' | 'entering' | 'inside' | 'leaving';

interface FigureSnapshot {
  x: number;
  y: number;
  lane: number;
  mode: FigureMode;
  from: number;
  target: number;
  shopIndex: number | null;
  spawnEdge: string | null;
}

interface LayerProbe {
  isEnabled(): boolean;
  getFigureCount(): number;
  getTargetCount(): number;
  getFigureSnapshot(): FigureSnapshot[];
  getShopOccupancy(): number[];
  getRoadNetwork(): {
    nodes: Array<{ x: number; y: number }>;
    adjacency: number[][];
    cols: number;
    rows: number;
  };
  prepareForIncomePhase(): number;
  dissolveIntoCoins(
    targets: Array<{ x: number; y: number; slotIndex?: number }>,
  ): Array<{ x: number; y: number }>;
  setPopulation(count: number): void;
}

interface AnimatorProbe {
  animateIncomePhases(
    phaseData: unknown[],
    options?: { phaseGapMs?: number; onPhase?: (phase: string) => void; pendingDeltas?: unknown },
  ): void;
  dissolveReputationCoins(targets: Array<{ x: number; y: number; slotIndex?: number }>): Array<{
    x: number;
    y: number;
  }>;
}

interface SceneProbe {
  state: {
    resourceBank: { coins: number; reputation: number };
    streetGrid: Array<BusinessCard | null>;
    incidentDeck: Array<unknown>;
    phase: string;
    turn: number;
  };
  layout: SceneLayout;
  msPedestrians: LayerProbe;
  msAnimator: AnimatorProbe;
  msTurnController: { endTurn(): void };
  settingsPanel?: { reducedMotion?: boolean; _reducedMotion?: boolean };
  replayMode?: boolean;
  incomeCollectionActive?: boolean;
  getStreetContainer(): Phaser.GameObjects.Container;
  getStreetViewLattice(): { cols: number; rows: number };
  streetPlayableLattice: { cols: number; rows: number };
  refreshAll(): void;
  refreshHud(): void;
  prewarmVisibleCardTextures(): Promise<unknown>;
}

let game: Phaser.Game | null = null;

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

async function bootNormalPlayGame(): Promise<{ game: Phaser.Game; scene: SceneProbe }> {
  // Default settings: a persisted Reduced Motion preference from another test
  // (or a previous manual run) would legitimately hide the crowd.
  localStorage.clear();
  destroyGame();
  const host = document.createElement('div');
  host.id = 'game-container';
  document.body.appendChild(host);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  game = createMainStreetGame({ type: Phaser.CANVAS, parent: 'game-container' });
  await waitForScene(game, 'MainStreetScene');
  const scene = game.scene.getScene('MainStreetScene') as unknown as SceneProbe;
  return { game, scene };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(
  predicate: () => boolean,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const intervalMs = opts.intervalMs ?? 50;
  const label = opts.label ?? 'condition';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

/** A business card carrying the cached per-turn values `applyIncome` reads. */
function makeBusiness(id: string, overrides: Partial<BusinessCard> = {}): BusinessCard {
  const template = getBusinessTemplates()[0];
  if (!template) throw new Error('No business templates loaded');
  return {
    ...template,
    id,
    family: 'business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    appliedUpgrades: [],
    currentIncome: 2,
    currentReputationPerTurn: 0,
    ...overrides,
  };
}

/**
 * Replace the incident deck with non-choice, budget-safe incidents so an
 * end-of-turn test never pauses on a dual-choice dialog. Mirrors
 * `income-collection.browser.test.ts`; these tests exercise the crowd, not the
 * choice mechanic.
 */
async function makeIncidentsNone(scene: SceneProbe): Promise<void> {
  const templates = (await import('../../src/MainStreetCards')).getEventTemplates();
  const safeIds = ['evt-award', 'evt-good-press', 'evt-graffiti-art', 'evt-street-cleaning'];
  const picked = templates.filter((t) => safeIds.includes(t.id));
  scene.state.incidentDeck.length = 0;
  scene.state.incidentDeck.push(
    ...picked.map((t, i) => ({ ...t, id: `${t.id}-${i}` })),
    ...picked.map((t, i) => ({ ...t, id: `${t.id}-${i + 10}` })),
  ) as never;
  // Blank it entirely: the reputation-income subject is not the incident.
  scene.state.incidentDeck.length = 0;
}

/**
 * Wait until the street container stops being re-rendered. Boot-time SVG
 * prewarm refreshes rebuild it once rasterisation completes; a mid-show
 * rebuild would destroy the coin grids. Mirrors the income-collection harness.
 */
async function waitForStableStreet(scene: SceneProbe): Promise<void> {
  const street = scene.getStreetContainer();
  let prev: readonly Phaser.GameObjects.GameObject[] = street.list ?? [];
  let stable = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(200);
    const cur = street.list ?? [];
    const same = cur.length === prev.length && cur.every((child, j) => child === prev[j]);
    prev = cur;
    stable = same ? stable + 1 : 0;
    if (stable >= 2) return;
  }
}

/** The layer container, looked up inside the live street container by name. */
function findLayerContainer(scene: SceneProbe): Phaser.GameObjects.Container | undefined {
  const street = scene.getStreetContainer();
  const list = ((street as unknown as { list?: unknown[] }).list ?? []) as Array<{
    name?: string;
  }>;
  return list.find((child) => child?.name === LAYER_CONTAINER_NAME) as
    | Phaser.GameObjects.Container
    | undefined;
}

/** The layer's silhouette images under its live container. */
function figureImages(scene: SceneProbe): Array<{ texture?: { key?: string } }> {
  const container = findLayerContainer(scene);
  const list = ((container as unknown as { list?: unknown[] })?.list ?? []) as Array<{
    texture?: { key?: string };
  }>;
  return list.filter((child) => child?.texture?.key === PEDESTRIAN_TEXTURE_KEY);
}

/** The shops the live layer derives from the real street grid. */
function liveShops(scene: SceneProbe): PedestrianShop[] {
  return occupiedShops(
    scene.state.streetGrid,
    scene.layout,
    scene.getStreetViewLattice(),
    scene.streetPlayableLattice,
  );
}

/** True when a point lies inside any drawn road band. */
function onRoadBand(
  point: { x: number; y: number },
  bands: Array<{ x: number; y: number; w: number; h: number }>,
): boolean {
  return bands.some(
    (band) =>
      point.x >= band.x - 0.5 &&
      point.x <= band.x + band.w + 0.5 &&
      point.y >= band.y - 0.5 &&
      point.y <= band.y + band.h + 0.5,
  );
}

/**
 * Perpendicular distance from a point to the lane line of the road segment a
 * walking figure is travelling along, plus how far along the segment it is.
 */
function laneGeometry(
  figure: FigureSnapshot,
  network: LayerProbe['getRoadNetwork'],
): { perpendicular: number; fromStart: number; fromEnd: number } | null {
  const a = network.nodes[figure.from] ?? network.nodes[figure.target];
  const b = network.nodes[figure.target] ?? a;
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const along = ((figure.x - a.x) * dx + (figure.y - a.y) * dy) / length;
  const perpendicular = Math.abs((figure.x - a.x) * dy - (figure.y - a.y) * dx) / length;
  return { perpendicular, fromStart: along, fromEnd: length - along };
}

function isInsideShopCell(figure: FigureSnapshot, shop: PedestrianShop): boolean {
  return (
    figure.x >= shop.cellXMin - 0.01 &&
    figure.x <= shop.cellXMax + 0.01 &&
    figure.y >= shop.cellYMin - 0.01 &&
    figure.y <= shop.cellYMax + 0.01
  );
}

describe('ambient reputation crowd — scene-level behaviour', () => {
  afterEach(() => {
    destroyGame();
    vi.restoreAllMocks();
  });

  /**
   * Parent AC3 — live population reconciliation. After the first HUD refresh
   * the live figure count is non-zero and equals
   * `pedestrianCount(state.resourceBank.reputation)`, and a later reputation
   * gain reconciles through the same HUD path.
   */
  it('reconciles the live crowd to the HUD reputation after the first refresh (parent AC3)', async () => {
    const { scene } = await bootNormalPlayGame();
    const initialReputation = scene.state.resourceBank.reputation;
    const initialExpected = pedestrianCount(initialReputation);
    expect(initialExpected).toBeGreaterThan(0);

    await waitForCondition(
      () => scene.msPedestrians.getFigureCount() === initialExpected,
      { label: 'first HUD refresh to reconcile the crowd' },
    );
    expect(scene.msPedestrians.getTargetCount()).toBe(initialExpected);
    expect(figureImages(scene)).toHaveLength(initialExpected);

    // A reputation gain addressed through the real HUD refresh path must
    // reconcile the crowd — the live count always tracks the pure helper.
    scene.state.resourceBank.reputation = initialReputation + 200;
    const grownExpected = pedestrianCount(scene.state.resourceBank.reputation);
    expect(grownExpected).toBeGreaterThan(initialExpected);
    scene.refreshHud();

    await waitForCondition(
      () => scene.msPedestrians.getFigureCount() === grownExpected,
      { label: 'HUD reconciliation after a reputation gain' },
    );
    expect(scene.msPedestrians.getTargetCount()).toBe(grownExpected);
    expect(figureImages(scene)).toHaveLength(grownExpected);
  });

  /**
   * Parent AC4 — road-lane walking, nearest-occupied-cell targeting and
   * deliberate (non-teleporting) shop entry, asserted against the live layer
   * and the real scene update loop.
   */
  it('walks the road lanes, seeks the nearest occupied cell and enters it deliberately (parent AC4)', async () => {
    const { scene } = await bootNormalPlayGame();
    await scene.prewarmVisibleCardTextures();
    await waitForStableStreet(scene);

    // Two far-apart occupied cells so nearest-cell targeting is observable.
    const streetSlots = scene.state.streetGrid.length;
    scene.state.streetGrid[0] = makeBusiness('biz-walk-near');
    scene.state.streetGrid[streetSlots - 1] = makeBusiness('biz-walk-far');
    scene.refreshAll();

    const expected = pedestrianCount(scene.state.resourceBank.reputation);
    await waitForCondition(() => scene.msPedestrians.getFigureCount() === expected, {
      label: 'crowd after the street rebuild',
    });

    const layer = scene.msPedestrians;
    const network = layer.getRoadNetwork();
    const shops = liveShops(scene);
    expect(shops).toHaveLength(2);
    const laneOffset = pedestrianLaneOffset(scene.layout);
    const bands = mapRoadBands(scene.layout, scene.getStreetViewLattice());

    // The shops appeared after the crowd spawned, so let one scene update
    // acquire the nearest-cell target before sampling the invariant.
    await waitForCondition(
      () =>
        layer
          .getFigureSnapshot()
          .filter((figure) => figure.mode === 'walking')
          .every((figure) => figure.shopIndex !== null),
      { label: 'walking figures to acquire a nearest-cell target' },
    );

    const samples: Array<{ at: number; figures: FigureSnapshot[] }> = [];
    const record = (): void => {
      samples.push({ at: performance.now(), figures: layer.getFigureSnapshot() });
    };

    record();
    for (let i = 0; i < 6; i++) {
      await sleep(120);
      record();
    }

    // The income phase's teleport-free guarantee: enough figures are switched
    // to walking into occupied cells, without moving them.
    const guaranteed = layer.prepareForIncomePhase();
    expect(guaranteed).toBeGreaterThanOrEqual(Math.ceil(PEDESTRIAN_MIN_SHOP_RATIO * expected));
    for (let i = 0; i < 8; i++) {
      await sleep(120);
      record();
    }

    let midSegmentChecks = 0;
    let enteringObserved = 0;
    for (const sample of samples) {
      expect(sample.figures).toHaveLength(expected);
      for (const figure of sample.figures) {
        // No end-of-turn exit has begun: the crowd is walking, entering or
        // standing inside a shop.
        expect(['walking', 'entering', 'inside']).toContain(figure.mode);

        if (figure.mode === 'walking') {
          // Walking figures stay on the drawn roads (entering figures are the
          // deliberate exception: they walk off the road into their shop).
          expect(onRoadBand(figure, bands)).toBe(true);
          // Always heading for the nearest occupied cell (re-resolved each
          // frame), and never off the road lane while in transit.
          expect(figure.shopIndex).toBe(nearestShop(figure, shops)?.slotIndex ?? null);
          const geometry = laneGeometry(figure, network);
          expect(geometry).toBeTruthy();
          if (
            geometry &&
            geometry.fromStart > laneOffset + 8 &&
            geometry.fromEnd > laneOffset + 8
          ) {
            // Mid-segment: exactly on the lane offset from the centre-line.
            midSegmentChecks += 1;
            expect(Math.abs(geometry.perpendicular - laneOffset)).toBeLessThan(0.6);
          }
        }

        if (figure.mode === 'entering') {
          enteringObserved += 1;
          const shop = shops.find((candidate) => candidate.slotIndex === figure.shopIndex);
          expect(shop, 'an entering figure must target an occupied cell').toBeTruthy();
        }

        if (figure.mode === 'inside') {
          const shop = shops.find((candidate) => candidate.slotIndex === figure.shopIndex);
          expect(shop, 'an inside figure must occupy an occupied cell').toBeTruthy();
          if (shop) expect(isInsideShopCell(figure, shop)).toBe(true);
        }
      }
    }

    expect(midSegmentChecks).toBeGreaterThan(0);
    expect(enteringObserved).toBeGreaterThan(0);

    // Deliberate (non-teleporting) entry: between consecutive samples every
    // figure moves at most the layer's fastest walk speed, and an entering
    // figure only ever gets closer to its chosen cell (then stays inside).
    const maxSpeed = PEDESTRIAN_WALK_SPEED * PEDESTRIAN_ENTER_SPEED_MULTIPLIER;
    for (let i = 1; i < samples.length; i++) {
      const dtSeconds = (samples[i].at - samples[i - 1].at) / 1000;
      const bound = maxSpeed * dtSeconds + 4;
      samples[i].figures.forEach((figure, index) => {
        const previous = samples[i - 1].figures[index];
        if (!previous) return;
        const step = Math.hypot(figure.x - previous.x, figure.y - previous.y);
        expect(step).toBeLessThanOrEqual(bound);
        if (previous.mode === 'entering' && figure.mode === 'entering') {
          const shop = shops.find((candidate) => candidate.slotIndex === figure.shopIndex);
          if (shop) {
            const before = Math.hypot(previous.x - shop.x, previous.y - shop.y);
            const after = Math.hypot(figure.x - shop.x, figure.y - shop.y);
            expect(after).toBeLessThanOrEqual(before + 0.5);
          }
        }
      });
    }
  });

  /**
   * Parent AC2/AC4/AC5 — at the reputation income phase at least
   * `PEDESTRIAN_MIN_SHOP_RATIO` of the live crowd is in/at an occupied cell,
   * every reputation-phase coin flight is sourced from a crowd figure at that
   * business (never the HUD counter), and the credited reputation total equals
   * the engine's deferred total.
   */
  it('sources the reputation income phase from the crowd and credits the engine total (parent AC2, AC4, AC5)', async () => {
    const { scene } = await bootNormalPlayGame();
    await makeIncidentsNone(scene);
    await scene.prewarmVisibleCardTextures();
    await waitForStableStreet(scene);

    // A reputation high enough that the coin multiplier splits a real
    // reputation-phase bonus, on a business that also earns reputation.
    scene.state.resourceBank.reputation = INCOME_TEST_REPUTATION;
    scene.state.streetGrid[0] = makeBusiness('biz-rep-income', {
      currentIncome: 100,
      currentReputationPerTurn: 25,
    });
    scene.refreshAll();
    scene.refreshHud();

    const expectedCrowd = pedestrianCount(INCOME_TEST_REPUTATION);
    await waitForCondition(() => scene.msPedestrians.getFigureCount() === expectedCrowd, {
      label: 'crowd reconciled to the income-test reputation',
    });

    const layer = scene.msPedestrians;
    const animator = scene.msAnimator;
    const shops = liveShops(scene);
    expect(shops.map((shop) => shop.slotIndex)).toEqual([0]);

    let enginePhaseData: Array<{ slotIndex: number; repBonus: number }> = [];
    let enginePending: { pendingRepDelta?: number } | undefined;
    const originalAnimate = animator.animateIncomePhases.bind(animator);
    vi.spyOn(animator, 'animateIncomePhases').mockImplementation((phaseData, options) => {
      enginePhaseData = phaseData as Array<{ slotIndex: number; repBonus: number }>;
      enginePending = options?.pendingDeltas as { pendingRepDelta?: number } | undefined;
      return originalAnimate(phaseData, options);
    });

    interface DissolveSnapshot {
      targets: Array<{ x: number; y: number; slotIndex?: number }>;
      sources: Array<{ x: number; y: number }>;
      figures: FigureSnapshot[];
    }
    const dissolves: DissolveSnapshot[] = [];
    const originalDissolve = layer.dissolveIntoCoins.bind(layer);
    vi.spyOn(layer, 'dissolveIntoCoins').mockImplementation((targets) => {
      const sources = originalDissolve(targets);
      dissolves.push({ targets, sources, figures: layer.getFigureSnapshot() });
      return sources;
    });

    const hudRepCounter = hudFlightTarget(scene, 'rep', scene.layout);
    const reputationBefore = scene.state.resourceBank.reputation;
    const turnBefore = scene.state.turn;

    scene.msTurnController.endTurn();

    await waitForCondition(() => dissolves.length > 0, {
      timeoutMs: 30_000,
      label: 'reputation income phase to dissolve the crowd',
    });

    // The engine's own phase data carries a non-empty reputation contribution.
    const reputationSlot = enginePhaseData.find((slot) => slot.slotIndex === 0);
    expect(reputationSlot).toBeTruthy();
    expect(iconsForAmount(roundHalf(reputationSlot!.repBonus))).toBeGreaterThan(0);
    expect(enginePending?.pendingRepDelta ?? 0).toBeGreaterThan(0);

    for (const dissolve of dissolves) {
      const live = dissolve.figures.filter(
        (figure) => figure.mode === 'inside' || figure.mode === 'entering',
      );
      // parent AC2/AC4: by the reputation income phase at least
      // PEDESTRIAN_MIN_SHOP_RATIO of the live crowd is inside, or walking
      // into, an occupied cell (the layer's teleport-free enforcement).
      expect(live.length / dissolve.figures.length).toBeGreaterThanOrEqual(
        PEDESTRIAN_MIN_SHOP_RATIO,
      );
      for (const figure of live) {
        expect(shops.map((shop) => shop.slotIndex)).toContain(figure.shopIndex);
        expect(figure.shopIndex).not.toBeNull();
      }
      expect(layer.getShopOccupancy().every((slotIndex) => slotIndex === 0)).toBe(true);

      // parent AC5: every reputation-phase flight is sourced from a crowd
      // figure at that business — never the HUD reputation counter, and never
      // the street anchor while an assigned shopper exists.
      expect(dissolve.sources).toHaveLength(dissolve.targets.length);
      dissolve.targets.forEach((target, index) => {
        const source = dissolve.sources[index];
        const shop = shops.find((candidate) => candidate.slotIndex === target.slotIndex);
        expect(shop, `no occupied cell for slot ${target.slotIndex}`).toBeTruthy();

        const samePosition = (figure: FigureSnapshot): boolean =>
          Math.abs(figure.x - source.x) < 0.01 && Math.abs(figure.y - source.y) < 0.01;
        const insideForShop = dissolve.figures.filter(
          (figure) => figure.mode === 'inside' && figure.shopIndex === target.slotIndex,
        );
        const enteringForShop = dissolve.figures.filter(
          (figure) => figure.mode === 'entering' && figure.shopIndex === target.slotIndex,
        );

        // The documented sourcing order: a figure inside the business, then a
        // figure walking into it (the teleport-free income-phase assignment).
        if (insideForShop.length > 0) {
          expect(insideForShop.some(samePosition)).toBe(true);
          expect(withinShopCapture(source, shop!)).toBe(true);
        } else {
          expect(enteringForShop.length).toBeGreaterThan(0);
          expect(enteringForShop.some(samePosition)).toBe(true);
        }

        const origin = dissolve.figures.find(
          (figure) =>
            (figure.mode === 'inside' || figure.mode === 'entering') && samePosition(figure),
        );
        expect(origin, 'coin flight must start at a live crowd figure').toBeTruthy();
        expect(origin!.shopIndex).toBe(target.slotIndex);

        // Architecturally impossible for the HUD counter to leak in; assert
        // it explicitly so a future refactor cannot reintroduce it.
        expect(
          Math.abs(source.x - hudRepCounter.x) < 0.01 && Math.abs(source.y - hudRepCounter.y) < 0.01,
        ).toBe(false);
      });
    }

    // The crowd-sourced flight never changes the credited amount: the
    // reputation total the scene credits equals the engine's deferred total.
    await waitForCondition(() => scene.incomeCollectionActive === false, {
      timeoutMs: 40_000,
      label: 'phased income show to complete',
    });
    expect(await dismissTurnSummaryDialog(scene)).toBe(true);
    await waitForCondition(
      () => scene.state.phase === 'MarketPhase' && scene.state.turn === turnBefore + 1,
      { timeoutMs: 15_000, label: 'day to start after [ Next Turn ]' },
    );
    expect(scene.state.resourceBank.reputation - reputationBefore).toBe(
      enginePending!.pendingRepDelta,
    );
  });

  /**
   * Parent AC6 — Reduced Motion renders zero figures and performs no
   * reputation-phase dissolution/flights, while the turn still advances.
   */
  it('renders no crowd and flies no reputation coins under Reduced Motion (parent AC6)', async () => {
    const { scene } = await bootNormalPlayGame();
    await makeIncidentsNone(scene);
    await scene.prewarmVisibleCardTextures();
    await waitForStableStreet(scene);

    scene.state.resourceBank.reputation = INCOME_TEST_REPUTATION;
    scene.state.streetGrid[0] = makeBusiness('biz-reduced-motion', {
      currentIncome: 100,
      currentReputationPerTurn: 25,
    });
    scene.refreshAll();
    scene.refreshHud();

    await waitForCondition(() => scene.msPedestrians.getFigureCount() > 0, {
      label: 'crowd before enabling Reduced Motion',
    });

    // Enable the real preference and reconcile through the HUD path: the
    // layer must tear itself down.
    scene.settingsPanel!._reducedMotion = true;
    scene.refreshHud();
    await waitForCondition(
      () => scene.msPedestrians.getFigureCount() === 0 && !findLayerContainer(scene),
      { label: 'Reduced Motion to tear the crowd down' },
    );
    expect(scene.msPedestrians.isEnabled()).toBe(false);

    let enginePhaseData: Array<{ slotIndex: number; repBonus: number }> = [];
    const originalAnimate = scene.msAnimator.animateIncomePhases.bind(scene.msAnimator);
    vi.spyOn(scene.msAnimator, 'animateIncomePhases').mockImplementation((phaseData, options) => {
      enginePhaseData = phaseData as Array<{ slotIndex: number; repBonus: number }>;
      return originalAnimate(phaseData, options);
    });
    const dissolveSpy = vi.spyOn(scene.msAnimator, 'dissolveReputationCoins');

    const turnBefore = scene.state.turn;
    scene.msTurnController.endTurn();
    await waitForCondition(() => scene.incomeCollectionActive === false, {
      timeoutMs: 20_000,
      label: 'Reduced Motion income progression to finish',
    });
    // Give the scheduled phases (including reputation) time to fire.
    await sleep(500);

    // The reputation phase was built (non-empty), so the absence of a
    // dissolve is the exemption, not an empty turn.
    const reputationSlot = enginePhaseData.find((slot) => slot.slotIndex === 0);
    expect(reputationSlot).toBeTruthy();
    expect(iconsForAmount(roundHalf(reputationSlot!.repBonus))).toBeGreaterThan(0);
    expect(dissolveSpy).not.toHaveBeenCalled();
    expect(scene.msPedestrians.getFigureCount()).toBe(0);

    // The exemption never blocks play.
    await waitForCondition(
      () => scene.state.phase === 'MarketPhase' && scene.state.turn === turnBefore + 1,
      { timeoutMs: 15_000, label: 'Reduced Motion turn to advance' },
    );
  });

  /**
   * Parent AC6 — replay/headless mode renders zero figures and schedules no
   * income phases (so no reputation flights), without mutating state.
   */
  it('renders no crowd and flies no reputation coins in replay/headless mode (parent AC6)', async () => {
    const { scene } = await bootNormalPlayGame();
    await scene.prewarmVisibleCardTextures();
    await waitForStableStreet(scene);

    scene.state.streetGrid[0] = makeBusiness('biz-replay');
    scene.refreshAll();
    await waitForCondition(() => scene.msPedestrians.getFigureCount() > 0, {
      label: 'crowd before switching to replay mode',
    });

    scene.replayMode = true;
    scene.msPedestrians.setPopulation(pedestrianCount(scene.state.resourceBank.reputation));
    expect(scene.msPedestrians.isEnabled()).toBe(false);
    expect(scene.msPedestrians.getFigureCount()).toBe(0);
    expect(findLayerContainer(scene)).toBeUndefined();

    const dissolveSpy = vi.spyOn(scene.msAnimator, 'dissolveReputationCoins');
    const phases: string[] = [];
    scene.msAnimator.animateIncomePhases(
      [
        {
          slotIndex: 0,
          businessName: 'Replay Biz',
          baseIncome: 0,
          synergyBonus: 0,
          repBonus: 100,
          eventDeltas: [],
          upcomingDeltas: [],
        },
      ],
      { phaseGapMs: 50, onPhase: (phase) => phases.push(phase) },
    );
    await sleep(400);

    expect(phases).toEqual([]);
    expect(scene.incomeCollectionActive ?? false).toBe(false);
    expect(dissolveSpy).not.toHaveBeenCalled();
    expect(scene.msPedestrians.getFigureCount()).toBe(0);
  });

  /**
   * Parent AC4 — crowd persistence: playing a card rebuilds the street
   * (`removeAll(true)` + re-attach) and the crowd keeps its size on the live
   * street container.
   */
  it('keeps the crowd and its layer across a card-play street rebuild (parent AC4)', async () => {
    const { scene } = await bootNormalPlayGame();
    await scene.prewarmVisibleCardTextures();
    await waitForStableStreet(scene);

    const expected = pedestrianCount(scene.state.resourceBank.reputation);
    await waitForCondition(() => scene.msPedestrians.getFigureCount() === expected, {
      label: 'crowd before the card play',
    });

    const streetBefore = scene.getStreetContainer();
    const containerBefore = findLayerContainer(scene);
    expect(containerBefore?.parentContainer).toBe(streetBefore);

    // Playing a card lands on the street grid and rebuilds the street
    // (`streetContainer.removeAll(true)` then re-attach) through refreshAll.
    scene.state.streetGrid[0] = makeBusiness('biz-rebuild');
    scene.refreshAll();

    await waitForCondition(() => {
      const container = findLayerContainer(scene);
      return !!container && container !== containerBefore;
    }, { label: 'layer to re-attach after the street rebuild' });

    // The rebuild clears the container in place; the layer must be attached
    // to that live container with its crowd intact, not a stale reference.
    expect(scene.getStreetContainer()).toBe(streetBefore);
    const containerAfter = findLayerContainer(scene);
    expect(containerAfter?.parentContainer).toBe(scene.getStreetContainer());
    expect(scene.msPedestrians.getFigureCount()).toBe(expected);
    expect(scene.msPedestrians.getTargetCount()).toBe(expected);
    expect(figureImages(scene)).toHaveLength(expected);
    expect(figureImages(scene).every((image) => image.texture?.key === PEDESTRIAN_TEXTURE_KEY)).toBe(true);
  });
});
