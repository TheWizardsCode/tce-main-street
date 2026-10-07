/**
 * Reputation phase — pedestrian-sourced coins (MS-0MUYGFWXK003QFYB)
 *
 * Verifies that the `'reputation'` income phase sources its coin flights from
 * the on-street pedestrians (`dissolveIntoCoins`) instead of the HUD
 * reputation counter, while keeping the credited economy and accessibility
 * contracts unchanged:
 *
 *  - each reputation-phase flight originates at the pedestrian dissolve pool
 *    (or the street-area anchor when no figures are on screen) — never the
 *    HUD counter `{ x: gameW * 0.5, y: hudY }`;
 *  - the credited total and per-slot coin counts stay unchanged;
 *  - Reduced Motion performs no flights; replay/headless returns immediately;
 *  - a throwing dissolve falls back to the street anchor and never stalls.
 *
 * Runs in the Node unit environment with Phaser + UI + coin-grid mocked, using
 * the same harness as `income-phase-reputation-invariant.test.ts`.
 *
 * @module tests/main-street/income-phase-reputation-source
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

const { popTextOrIcon, moveGameObject } = vi.hoisted(() => ({
  popTextOrIcon: vi.fn(() => Promise.resolve()),
  moveGameObject: vi.fn((_opts?: unknown) => ({})),
}));

vi.mock('@ui', () => ({
  FONT_FAMILY: 'sans-serif',
  popTextOrIcon,
  moveGameObject,
}));

const gridRegistry = vi.hoisted(() => ({
  handles: [] as Array<{ container: Record<string, unknown> }>,
  addLog: [] as Array<{ handleIndex: number; count: number }>,
}));

vi.mock('../../src/coin-grid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/coin-grid')>();
  return {
    ...actual,
    createCoinGrid: vi.fn(() => {
      const handleIndex = gridRegistry.handles.length;
      const container: Record<string, unknown> = {
        list: [] as Array<Record<string, unknown>>,
        removeAll: vi.fn(() => {
          (container.list as Array<unknown>).length = 0;
        }),
        destroy: vi.fn(),
        getWorldTransformMatrix: () => ({
          getX: () => 100 + handleIndex * 160,
          getY: () => 140,
        }),
      };
      const handle = {
        addCoins: vi.fn((count: number) => {
          gridRegistry.addLog.push({ handleIndex, count });
          container.list = Array.from({ length: count }, () => ({
            setScale: vi.fn(),
            getWorldTransformMatrix: () => ({ getX: () => 120, getY: () => 150 }),
            setPosition: vi.fn().mockReturnThis(),
            setDepth: vi.fn().mockReturnThis(),
            destroy: vi.fn(),
          }));
          return { placements: [], iconCount: count };
        }),
        clear: vi.fn(),
        getLayout: vi.fn(() => null),
        container,
      };
      gridRegistry.handles.push(handle);
      return handle;
    }),
  };
});

import { MainStreetAnimator } from '../../src/scenes/MainStreetAnimator';
import { iconsForAmount, roundHalf } from '../../src/coin-grid';
import { pedestrianStreetAnchor } from '../../src/scenes/MainStreetPedestrians';
import type { SlotPhaseBreakdown } from '../../src/MainStreetAdjacency';

interface ScheduledCall {
  delay: number;
  fn: () => void;
}

interface MockScene {
  layout: Record<string, number>;
  settingsPanel: unknown;
  replayMode: boolean;
  incomeCollectionActive: boolean;
  state: { activeEffects: unknown[] };
  soundManager: { play: ReturnType<typeof vi.fn> };
  gameEvents: { emit: ReturnType<typeof vi.fn> };
  time: { delayedCall: ReturnType<typeof vi.fn> };
  add: Record<string, unknown>;
  tweens: { add: ReturnType<typeof vi.fn> };
  streetContainer: { list: unknown[] };
  msRenderer: { animateUpcomingEffectLine: ReturnType<typeof vi.fn> };
  msPedestrians?: { dissolveIntoCoins: (targets: Array<{ x: number; y: number }>) => Array<{ x: number; y: number }> };
}

const REPUTATION_DISPATCH_INDEX = 2;

const LAYOUT = {
  gameW: 1280,
  hudY: 50,
  gameH: 720,
  streetTop: 100,
  streetCols: 5,
  streetX: 20,
  slotW: 140,
  slotH: 80,
  slotGap: 20,
  streetRowGap: 12,
  queueTop: 600,
  logX: 20,
};

function createMockScene(slotCount: number, overrides: Partial<MockScene> = {}): {
  scene: MockScene;
  scheduled: ScheduledCall[];
} {
  const scheduled: ScheduledCall[] = [];
  const cards = Array.from({ length: slotCount }, (_, i) => ({
    getData: (key: string) => (key === 'streetSlotIndex' ? i : undefined),
  }));

  const scene: MockScene = {
    layout: { ...LAYOUT },
    settingsPanel: null,
    replayMode: false,
    incomeCollectionActive: false,
    state: { activeEffects: [] },
    soundManager: { play: vi.fn() },
    gameEvents: { emit: vi.fn() },
    time: {
      delayedCall: vi.fn((delay: number, fn: () => void) => {
        scheduled.push({ delay, fn });
        return {};
      }),
    },
    add: {
      circle: vi.fn(() => ({ setDepth: vi.fn().mockReturnThis(), destroy: vi.fn() })),
      text: vi.fn(() => ({
        setOrigin: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
        setAlpha: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      })),
      container: vi.fn(() => ({
        add: vi.fn(),
        setDepth: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
        list: [],
      })),
      existing: vi.fn(),
      graphics: vi.fn(() => ({
        fillStyle: vi.fn().mockReturnThis(),
        fillCircle: vi.fn().mockReturnThis(),
        generateTexture: vi.fn(),
        clear: vi.fn().mockReturnThis(),
        destroy: vi.fn(),
      })),
    },
    tweens: {
      add: vi.fn((cfg: { onComplete?: () => void }) => {
        cfg?.onComplete?.();
        return {};
      }),
    },
    streetContainer: { list: cards },
    msRenderer: { animateUpcomingEffectLine: vi.fn() },
  };

  Object.assign(scene, overrides);
  return { scene, scheduled };
}

function makePhaseData(bases: number[], reps: number[] = []): SlotPhaseBreakdown[] {
  return bases.map((baseIncome, slotIndex) => ({
    slotIndex,
    businessName: `Biz ${slotIndex}`,
    baseIncome,
    synergyBonus: 0,
    repBonus: reps[slotIndex] ?? 0,
    eventDeltas: [],
    upcomingDeltas: [],
  }));
}

function resetHarness(): void {
  vi.clearAllMocks();
  gridRegistry.handles.length = 0;
  gridRegistry.addLog.length = 0;
}

interface ReputationFlight {
  slotIndex: number;
  fromX: number;
  fromY: number;
}

function collectReputationFlights(
  scene: MockScene,
  scheduled: ScheduledCall[],
): ReputationFlight[] {
  const firstNew = scheduled.length;
  scheduled[REPUTATION_DISPATCH_INDEX].fn();
  const newCalls = scheduled.slice(firstNew);

  const flights: ReputationFlight[] = [];
  for (const call of newCalls) {
    const beforeMoves = moveGameObject.mock.calls.length;
    const beforeCircles = (scene.add.circle as ReturnType<typeof vi.fn>).mock.calls.length;
    call.fn();
    const circles = (scene.add.circle as ReturnType<typeof vi.fn>).mock.calls;
    for (let i = beforeMoves; i < moveGameObject.mock.calls.length; i++) {
      const opts = moveGameObject.mock.calls[i][0] as unknown as {
        destX: number;
        destY: number;
      };
      const circleIndex = beforeCircles + (i - beforeMoves);
      const circle = circles[circleIndex] ?? [];
      flights.push({
        slotIndex: Math.round((opts.destX - 100) / 160),
        fromX: circle[0] as number,
        fromY: circle[1] as number,
      });
    }
  }
  return flights;
}

describe('reputation phase — pedestrian-sourced coins (MS-0MUYGFWXK003QFYB)', () => {
  beforeEach(resetHarness);

  it('originates every reputation flight at the pedestrian dissolve pool (AC1)', () => {
    const repBonuses = [50, 230, 1000, 0];
    const pedestrianSources = [
      { x: 210, y: 305 },
      { x: 275, y: 330 },
      { x: 340, y: 355 },
      { x: 405, y: 380 },
    ];
    const dissolve = vi.fn((targets: Array<{ x: number; y: number }>) =>
      targets.map((_, i) => ({ ...pedestrianSources[i % pedestrianSources.length] })),
    );
    const { scene, scheduled } = createMockScene(repBonuses.length, {
      msPedestrians: { dissolveIntoCoins: dissolve },
    });
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomePhases(makePhaseData([0, 0, 0, 0], repBonuses), {
      phaseGapMs: 100_000,
    });
    const flights = collectReputationFlights(scene, scheduled);

    expect(dissolve).toHaveBeenCalledTimes(1);
    expect(flights.length).toBeGreaterThan(0);
    for (const flight of flights) {
      const source = pedestrianSources[flight.slotIndex];
      expect(flight.fromX).toBe(source.x);
      expect(flight.fromY).toBe(source.y);
    }
    // Never the historical HUD reputation counter origin.
    const hud = { x: LAYOUT.gameW * 0.5, y: LAYOUT.hudY };
    expect(flights.every((f) => !(f.fromX === hud.x && f.fromY === hud.y))).toBe(true);
  });

  it('falls back to the street-area anchor (never the HUD counter) with no pedestrians (AC2)', () => {
    const repBonuses = [120, 220];
    const { scene, scheduled } = createMockScene(repBonuses.length);
    const animator = new MainStreetAnimator(scene);
    const anchor = pedestrianStreetAnchor(scene.layout as never);

    animator.animateIncomePhases(makePhaseData([0, 0], repBonuses), {
      phaseGapMs: 100_000,
    });
    const flights = collectReputationFlights(scene, scheduled);

    expect(flights.length).toBeGreaterThan(0);
    for (const flight of flights) {
      expect(flight.fromX).toBe(anchor.x);
      expect(flight.fromY).toBe(anchor.y);
    }
    // The street anchor is distinct from the HUD reputation counter.
    expect(anchor.x === LAYOUT.gameW * 0.5 && anchor.y === LAYOUT.hudY).toBe(false);
  });

  it('keeps the credited total and per-slot coin counts unchanged (AC3)', () => {
    const repBonuses = [50, 230, 1000, 0];
    const pedestrianSources = [
      { x: 200, y: 300 },
      { x: 260, y: 320 },
      { x: 320, y: 340 },
      { x: 380, y: 360 },
    ];
    const { scene, scheduled } = createMockScene(repBonuses.length, {
      msPedestrians: {
        dissolveIntoCoins: (targets) => targets.map((_, i) => ({ ...pedestrianSources[i] })),
      },
    });
    const animator = new MainStreetAnimator(scene);

    const phaseData = makePhaseData([0, 0, 0, 0], repBonuses);
    const before = animator.creditedIncomeTotal(phaseData);
    animator.animateIncomePhases(phaseData, { phaseGapMs: 100_000 });
    const after = animator.creditedIncomeTotal(phaseData);
    expect(after).toBe(before);

    const flights = collectReputationFlights(scene, scheduled);
    const counts = new Map<number, number>();
    for (const flight of flights) {
      counts.set(flight.slotIndex, (counts.get(flight.slotIndex) ?? 0) + 1);
    }
    repBonuses.forEach((repBonus, slotIndex) => {
      expect(counts.get(slotIndex) ?? 0).toBe(iconsForAmount(roundHalf(repBonus)));
    });
    // Exact credited icon total — no slot dropped or duplicated.
    const expectedTotal = repBonuses.reduce(
      (sum, repBonus) => sum + iconsForAmount(roundHalf(repBonus)),
      0,
    );
    expect([...counts.values()].reduce((sum, n) => sum + n, 0)).toBe(expectedTotal);
  });

  it('performs no reputation flights under Reduced Motion (AC4)', () => {
    const { scene, scheduled } = createMockScene(3, {
      settingsPanel: { reducedMotion: true },
      msPedestrians: { dissolveIntoCoins: (t) => t.map(() => ({ x: 1, y: 2 })) },
    });
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomePhases(makePhaseData([0, 0, 0], [100, 250, 500]), {
      phaseGapMs: 100_000,
    });
    const flights = collectReputationFlights(scene, scheduled);

    expect(flights).toEqual([]);
    expect(moveGameObject).not.toHaveBeenCalled();
    expect(scene.add.circle).not.toHaveBeenCalled();
  });

  it('returns immediately in replay/headless mode (AC4)', () => {
    const { scene, scheduled } = createMockScene(3, { replayMode: true });
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomePhases(makePhaseData([0, 0, 0], [100, 250, 500]), {
      phaseGapMs: 100,
    });

    expect(scheduled).toEqual([]);
    expect(scene.add.circle).not.toHaveBeenCalled();
    expect(moveGameObject).not.toHaveBeenCalled();
  });

  it('is defensive: a throwing dissolve falls back to the street anchor and still flies (AC4)', () => {
    const { scene, scheduled } = createMockScene(2, {
      msPedestrians: {
        dissolveIntoCoins: () => {
          throw new Error('boom');
        },
      },
    });
    const animator = new MainStreetAnimator(scene);
    const anchor = pedestrianStreetAnchor(scene.layout as never);

    expect(() =>
      animator.animateIncomePhases(makePhaseData([0, 0], [150, 150]), { phaseGapMs: 100_000 }),
    ).not.toThrow();
    const flights = collectReputationFlights(scene, scheduled);

    expect(flights.length).toBeGreaterThan(0);
    for (const flight of flights) {
      expect(flight.fromX).toBe(anchor.x);
      expect(flight.fromY).toBe(anchor.y);
    }
  });
});
