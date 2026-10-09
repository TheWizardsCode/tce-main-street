/**
 * Main Street: reputation income-phase invariant regression guard.
 *
 * Test-first lock for the reputation-phase rework
 * (parent MS-0MTV9AS15004AC1E, child MS-0MUYGFVIJ00070MB). The pedestrian
 * conversion re-sources the reputation phase's coin flight (currently the HUD
 * reputation counter) but MUST NOT change the economy or the accessibility
 * contracts. These tests pass on the pre-conversion implementation and must
 * keep passing after the conversion.
 *
 * Locked contracts:
 *  - the credited total (`creditedIncomeTotal`) and the
 *    `base + synergy + repBonus + eventDeltas` phase-sum invariant are
 *    unchanged — `upcomingDeltas` stay excluded from the credited total;
 *  - each reputation-phase slot emits `iconsForAmount(roundHalf(repBonus))`
 *    coins (the credited amount), independent of where the flight starts;
 *  - Reduced Motion performs no reputation flights, and replay/headless
 *    returns immediately (no rendering, no audio);
 *  - the per-slot reputation coin counts are deterministic (no gameplay RNG).
 *
 * Runs in the Node unit environment with Phaser + UI modules mocked, reusing
 * the harness pattern from `income-phase-sequential-animator.test.ts`. The
 * observable contract is the public `animateIncomePhases` API: the delayed
 * calls it schedules and the `moveGameObject` / `add.circle` calls those
 * produce — plus the pure `creditedIncomeTotal` helper.
 *
 * @module tests/main-street/income-phase-reputation-invariant
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phaser is browser-only; the animator only uses it for type annotations.
vi.mock('phaser', () => ({ default: {} }));

// Mock src/ui so importing the animator does not load Phaser-dependent UI code.
const { popTextOrIcon, moveGameObject } = vi.hoisted(() => ({
  popTextOrIcon: vi.fn(() => Promise.resolve()),
  moveGameObject: vi.fn((_opts?: unknown) => ({})),
}));

vi.mock('@ui', () => ({
  FONT_FAMILY: 'sans-serif',
  popTextOrIcon,
  moveGameObject,
}));

// Registry populated by the mocked createCoinGrid so tests can observe which
// card's grid received coins and in what order.
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
}

/** The dispatch index of the reputation phase within `animateIncomePhases`. */
const REPUTATION_DISPATCH_INDEX = 2;

function createMockScene(slotCount: number, overrides: Partial<MockScene> = {}): {
  scene: MockScene;
  scheduled: ScheduledCall[];
} {
  const scheduled: ScheduledCall[] = [];
  const cards = Array.from({ length: slotCount }, (_, i) => ({
    getData: (key: string) => (key === 'streetSlotIndex' ? i : undefined),
  }));

  const scene: MockScene = {
    layout: {
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
    },
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

/** Phase data with `baseIncome`/`repBonus` in the ×100 economy (1 icon = 100). */
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

/** Reset all module-level harness state between phase runs within one test. */
function resetHarness(): void {
  vi.clearAllMocks();
  gridRegistry.handles.length = 0;
  gridRegistry.addLog.length = 0;
}

interface ReputationFlight {
  /** Slot index derived from the mock grid destination (coins land on the card). */
  slotIndex: number;
  /** Flight origin captured from the created coin visual. */
  fromX: number;
  fromY: number;
}

/**
 * Fires the reputation phase dispatch and records every coin flight it
 * launches, associating each with the slot whose grid it lands on. The
 * mocked coin grid places each slot's centre at a distinct `destX`, so the
 * destination identifies the emitting slot without touching internals.
 */
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

/** Group reputation flights by emitting slot. */
function flightsBySlot(flights: ReputationFlight[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const flight of flights) {
    counts.set(flight.slotIndex, (counts.get(flight.slotIndex) ?? 0) + 1);
  }
  return counts;
}

describe('reputation income-phase invariants (MS-0MUYGFVIJ00070MB)', () => {
  beforeEach(resetHarness);

  it('leaves the credited total and the phase-sum invariant unchanged (AC1)', () => {
    const phaseData: SlotPhaseBreakdown[] = [
      {
        slotIndex: 0,
        businessName: 'Biz 0',
        baseIncome: 300,
        synergyBonus: 50,
        repBonus: 160,
        eventDeltas: [{ cardId: 'evt-1', name: 'Flu', delta: -60 }],
        upcomingDeltas: [],
      },
      {
        slotIndex: 1,
        businessName: 'Biz 1',
        baseIncome: 200,
        synergyBonus: 0,
        repBonus: 120,
        eventDeltas: [],
        // Presentation-only descriptor — must never enter the credited total.
        upcomingDeltas: [{ cardId: 'up-1', name: 'Upcoming', delta: 500 }],
      },
    ];
    const { scene } = createMockScene(phaseData.length);
    const animator = new MainStreetAnimator(scene);

    // The credited total is exactly the base+synergy+repBonus+eventDeltas sum
    // (rounded, floored at 0); `upcomingDeltas` are excluded.
    const phaseSum = phaseData.reduce(
      (sum, pd) =>
        sum +
        pd.baseIncome +
        pd.synergyBonus +
        pd.repBonus +
        (pd.eventDeltas ?? []).reduce((s, d) => s + d.delta, 0),
      0,
    );
    const upcomingSum = phaseData.reduce(
      (sum, pd) => sum + (pd.upcomingDeltas ?? []).reduce((s, d) => s + d.delta, 0),
      0,
    );
    expect(upcomingSum).toBeGreaterThan(0);
    expect(animator.creditedIncomeTotal(phaseData)).toBe(Math.round(Math.max(0, phaseSum)));
    expect(animator.creditedIncomeTotal(phaseData)).toBe(770);

    // Running the reputation phase is presentation-only: the credited total
    // and the phase data itself are untouched.
    const before = animator.creditedIncomeTotal(phaseData);
    const snapshot = JSON.parse(JSON.stringify(phaseData)) as SlotPhaseBreakdown[];
    animator.animateIncomePhases(phaseData, { phaseGapMs: 100_000 });
    const after = animator.creditedIncomeTotal(phaseData);

    expect(after).toBe(before);
    expect(phaseData).toEqual(snapshot);
  });

  it('emits iconsForAmount(roundHalf(repBonus)) coins per reputation-phase slot (AC2)', () => {
    const repBonuses = [50, 230, 1000, 0];
    const { scene, scheduled } = createMockScene(repBonuses.length);
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomePhases(makePhaseData([0, 0, 0, 0], repBonuses), {
      phaseGapMs: 100_000,
    });
    const counts = flightsBySlot(collectReputationFlights(scene, scheduled));

    repBonuses.forEach((repBonus, slotIndex) => {
      const expected = iconsForAmount(roundHalf(repBonus));
      expect(counts.get(slotIndex) ?? 0, `slot ${slotIndex} (repBonus ${repBonus})`).toBe(
        expected,
      );
    });

    // Exact credited-icon total, so no slot is silently dropped or duplicated.
    const expectedTotal = repBonuses.reduce(
      (sum, repBonus) => sum + iconsForAmount(roundHalf(repBonus)),
      0,
    );
    expect([...counts.values()].reduce((sum, n) => sum + n, 0)).toBe(expectedTotal);
  });

  it('keeps the per-slot coin counts independent of where the flight starts (AC2)', () => {
    const repBonuses = [50, 230, 1000, 0];

    // Run A: the historical HUD-counter origin (top of the screen).
    const runA = createMockScene(repBonuses.length);
    new MainStreetAnimator(runA.scene).animateIncomePhases(
      makePhaseData([0, 0, 0, 0], repBonuses),
      { phaseGapMs: 100_000 },
    );
    const countsA = flightsBySlot(collectReputationFlights(runA.scene, runA.scheduled));

    // Run B: a different origin (fresh scene, different HUD/screen geometry).
    resetHarness();
    const runB = createMockScene(repBonuses.length, {
      layout: {
        gameW: 800,
        hudY: 400,
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
      },
    });
    new MainStreetAnimator(runB.scene).animateIncomePhases(
      makePhaseData([0, 0, 0, 0], repBonuses),
      { phaseGapMs: 100_000 },
    );
    const countsB = flightsBySlot(collectReputationFlights(runB.scene, runB.scheduled));

    // The credited coin count per slot is a pure function of repBonus — the
    // re-sourced origin (pedestrians, post-conversion) cannot change it.
    repBonuses.forEach((_repBonus, slotIndex) => {
      expect(countsA.get(slotIndex) ?? 0).toBe(countsB.get(slotIndex) ?? 0);
    });
    expect([...countsA.entries()].sort()).toEqual([...countsB.entries()].sort());
  });

  it('performs no reputation flights under Reduced Motion (AC3)', () => {
    const { scene, scheduled } = createMockScene(3, {
      settingsPanel: { reducedMotion: true },
    });
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomePhases(makePhaseData([0, 0, 0], [100, 250, 500]), {
      phaseGapMs: 100_000,
    });
    const flights = collectReputationFlights(scene, scheduled);

    expect(flights).toEqual([]);
    expect(moveGameObject).not.toHaveBeenCalled();
    expect(scene.add.circle).not.toHaveBeenCalled();
    expect(scene.soundManager.play).not.toHaveBeenCalled();
  });

  it('returns immediately in replay/headless mode — no rendering or audio (AC3)', () => {
    const { scene, scheduled } = createMockScene(3, { replayMode: true });
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomePhases(makePhaseData([0, 0, 0], [100, 250, 500]), {
      phaseGapMs: 100,
    });

    // Nothing at all is scheduled, created or played.
    expect(scheduled).toEqual([]);
    expect(gridRegistry.handles).toEqual([]);
    expect(scene.add.circle).not.toHaveBeenCalled();
    expect(moveGameObject).not.toHaveBeenCalled();
    expect(scene.soundManager.play).not.toHaveBeenCalled();
    expect(scene.incomeCollectionActive).toBe(false);
  });

  it('is deterministic: identical inputs produce identical per-slot coin counts (AC4)', () => {
    const repBonuses = [50, 230, 1000, 0];

    const runOnce = (): Map<number, number> => {
      resetHarness();
      const { scene, scheduled } = createMockScene(repBonuses.length);
      new MainStreetAnimator(scene).animateIncomePhases(
        makePhaseData([0, 0, 0, 0], repBonuses),
        { phaseGapMs: 100_000 },
      );
      return flightsBySlot(collectReputationFlights(scene, scheduled));
    };

    const first = runOnce();
    const second = runOnce();

    // No gameplay RNG draws influence the credited coin counts.
    expect([...first.entries()].sort()).toEqual([...second.entries()].sort());
    repBonuses.forEach((repBonus, slotIndex) => {
      expect(second.get(slotIndex) ?? 0).toBe(iconsForAmount(roundHalf(repBonus)));
    });
  });
});
