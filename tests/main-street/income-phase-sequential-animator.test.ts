/**
 * Main Street: phased income animation — sequential card processing
 * (CG-0MTR766U6003RZ88).
 *
 * Verifies the one-card-at-a-time model introduced for
 * `MainStreetAnimator.animateIncomePhases()`:
 *
 *  - within the sequential phases (base/events/upcoming), card 0's count-out
 *    / coin flights are fully scheduled before card 1's begin (no parallel
 *    overlap);
 *  - the inter-card delay decreases progressively for successive cards;
 *  - later cards use shorter coin-flight durations (animation speed-up);
 *  - the reputation phase is the near-instant exception
 *    (MS-0MV8LHN0W0017XU1): its flights launch within the small
 *    `INCOME_FLIGHT_STAGGER_MS` (60ms) stagger window — no per-business
 *    `getCardDelay` accumulation — while retaining the gentle per-card
 *    duration decrease;
 *  - reduced motion and replay/headless exemptions are unchanged.
 *
 * Runs in the Node unit environment with Phaser + UI modules mocked. The
 * observable contract is the timing schedule registered on the scene's
 * `time.delayedCall` and the `moveGameObject` calls the schedule produces —
 * asserted via the public `animateIncomePhases` API, not internals.
 *
 * @module tests/main-street/income-phase-sequential-animator
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
// card's grid received a count-out, and in what order.
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
import type { SlotPhaseBreakdown } from '../../src/MainStreetAdjacency';
import type { IncomePhaseKey } from '../../src/scenes/MainStreetAnimator';
import { INCOME_FLIGHT_STAGGER_MS } from '../../src/scenes/MainStreetAnimatorTiming';

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
  /** Published HUD number anchors (MS-0MUYT57J80021CWW). */
  hudCoinAnchor?: { x: number; y: number } | null;
  hudRepAnchor?: { x: number; y: number } | null;
  /**
   * Per-seat scoreboard anchors keyed by `playerId`
   * (MS-0MW083MAN004JSCH); published by the competitive scoreboard render.
   */
  hudSeatAnchors?: Record<number, { x: number; y: number }> | null;
}

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
function makePhaseData(
  bases: number[],
  reps: number[] = [],
  /** Presentation-only seat owner per slot index (absent = owner 0). */
  ownerIds: Record<number, number> = {},
): SlotPhaseBreakdown[] {
  return bases.map((baseIncome, slotIndex) => ({
    slotIndex,
    businessName: `Biz ${slotIndex}`,
    baseIncome,
    synergyBonus: 0,
    repBonus: reps[slotIndex] ?? 0,
    eventDeltas: [],
    upcomingDeltas: [],
    // `ownerId` is added to `SlotPhaseBreakdown` by MS-0MW083KRZ009NJTA; the
    // cast keeps this suite compiling while that child is still landing.
    ...(ownerIds[slotIndex] === undefined ? {} : { ownerId: ownerIds[slotIndex] }),
  }) as unknown as SlotPhaseBreakdown);
}

/**
 * Fires the phase dispatch and then every call it registered, recording the
 * absolute scheduled delay of each count-out (`addCoins`) invocation. This
 * exposes the *schedule* the sequential model produces, card by card.
 */
function collectCountOutSchedule(
  scheduled: ScheduledCall[],
  dispatchIndex: number,
): Array<{ delay: number; handleIndex: number }> {
  const firstNew = scheduled.length;
  scheduled[dispatchIndex].fn();
  const newCalls = scheduled.slice(firstNew);

  const result: Array<{ delay: number; handleIndex: number }> = [];
  for (const call of newCalls) {
    const logLen = gridRegistry.addLog.length;
    call.fn();
    if (gridRegistry.addLog.length > logLen) {
      const entry = gridRegistry.addLog[gridRegistry.addLog.length - 1];
      result.push({ delay: call.delay, handleIndex: entry.handleIndex });
    }
  }
  return result;
}

/**
 * Fires a phase dispatch and returns the absolute scheduled delay of every
 * coin flight it launches (one per icon). For rep-only data the within-flight
 * icon stagger (`currentCoinStagger`) is constant across businesses, so the
 * gaps between these delays are exactly the launch offsets between
 * businesses — what the near-instant model constrains.
 */
function collectFlightLaunchDelays(
  scheduled: ScheduledCall[],
  dispatchIndex: number,
): number[] {
  const firstNew = scheduled.length;
  scheduled[dispatchIndex].fn();
  const newCalls = scheduled.slice(firstNew);

  const delays: number[] = [];
  for (const call of newCalls) {
    const before = moveGameObject.mock.calls.length;
    call.fn();
    if (moveGameObject.mock.calls.length > before) delays.push(call.delay);
  }
  return delays;
}

/** Fires a phase dispatch and returns the coin-flight durations it launches. */
function collectFlightDurations(
  scheduled: ScheduledCall[],
  dispatchIndex: number,
): number[] {
  const firstNew = scheduled.length;
  scheduled[dispatchIndex].fn();
  const newCalls = scheduled.slice(firstNew);

  const durations: number[] = [];
  for (const call of newCalls) {
    const before = moveGameObject.mock.calls.length;
    call.fn();
    for (let i = before; i < moveGameObject.mock.calls.length; i++) {
      const opts = moveGameObject.mock.calls[i][0] as unknown as { duration?: number };
      if (typeof opts.duration === 'number') durations.push(opts.duration);
    }
  }
  return durations;
}

describe('MainStreetAnimator.animateIncomePhases — sequential card processing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gridRegistry.handles.length = 0;
    gridRegistry.addLog.length = 0;
  });

  it('counts base coins out one card at a time (card 0 completes before card 1 begins)', () => {
    const { scene, scheduled } = createMockScene(2);
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomePhases(makePhaseData([300, 200]), { phaseGapMs: 100_000 });

    // Fire the base phase dispatch (index 0) and inspect the count-out schedule.
    const schedule = collectCountOutSchedule(scheduled, 0);
    expect(schedule.length).toBeGreaterThan(0);

    const card0 = schedule.filter((s) => s.handleIndex === 0);
    const card1 = schedule.filter((s) => s.handleIndex === 1);
    expect(card0.length).toBe(3);
    expect(card1.length).toBe(2);

    // Sequential (AC1): every card-0 count-out is scheduled strictly before
    // every card-1 count-out — no parallel overlap.
    const lastCard0 = Math.max(...card0.map((s) => s.delay));
    const firstCard1 = Math.min(...card1.map((s) => s.delay));
    expect(firstCard1).toBeGreaterThan(lastCard0);
  });

  it('decreases the delay between successive cards (AC3)', () => {
    const { scene, scheduled } = createMockScene(4);
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomePhases(makePhaseData([100, 100, 100, 100]), { phaseGapMs: 100_000 });

    const schedule = collectCountOutSchedule(scheduled, 0);
    // First count-out delay registered for each card = that card's start offset.
    const starts = [0, 1, 2, 3].map((h) => Math.min(...schedule.filter((s) => s.handleIndex === h).map((s) => s.delay)));

    expect(starts).toHaveLength(4);
    const gaps = [starts[1] - starts[0], starts[2] - starts[1], starts[3] - starts[2]];
    // Progressive speed-up: each gap is strictly smaller than the previous one.
    expect(gaps[0]).toBeGreaterThan(gaps[1]);
    expect(gaps[1]).toBeGreaterThan(gaps[2]);
  });

  it('speeds up coin flights for later cards (AC4), near-instant reputation launch (MS-0MV8LHN0W0017XU1)', () => {
    const { scene, scheduled } = createMockScene(3);
    const animator = new MainStreetAnimator(scene);

    // Re-based onto the near-instant reputation model: flights now START
    // within the small stagger window (no per-business delay), but the gentle
    // per-card duration decrease (getFlightDuration) is retained, so later
    // cards still fly faster. Base is empty (0), so the sole scheduled phase
    // is reputation; one icon per card (repBonus 100) → dispatch index 0.
    animator.animateIncomePhases(makePhaseData([0, 0, 0], [100, 100, 100]), { phaseGapMs: 100_000 });

    const durations = collectFlightDurations(scheduled, 0);
    expect(durations).toHaveLength(3);
    // Later cards fly faster: durations strictly decrease.
    expect(durations[0]).toBeGreaterThan(durations[1]);
    expect(durations[1]).toBeGreaterThan(durations[2]);
  });

  it('launches all reputation flights within the small stagger window — no inter-business delay (AC6)', () => {
    const { scene, scheduled } = createMockScene(4);
    const animator = new MainStreetAnimator(scene);

    // Rep-only data: base/synergy are empty, so reputation is the first
    // scheduled phase (dispatch index 0) — one coin icon per producing
    // business (repBonus 100 = 1 icon). A zero-bonus slot sits mid-roster to
    // prove it is skipped WITHOUT accumulating delay.
    animator.animateIncomePhases(makePhaseData([0, 0, 0, 0], [100, 0, 100, 100]), {
      phaseGapMs: 100_000,
    });

    const delays = collectFlightLaunchDelays(scheduled, 0);
    expect(delays).toHaveLength(3);

    // No getCardDelay accumulation between businesses: successive profits
    // start only INCOME_FLIGHT_STAGGER_MS apart (the synergy-phase stagger),
    // and the entire phase launches within (n-1) × 60 ms — never the old
    // sequential 500ms→120ms per-business delays.
    const sorted = [...delays].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBe(INCOME_FLIGHT_STAGGER_MS);
    }
    expect(sorted[sorted.length - 1] - sorted[0]).toBe(2 * INCOME_FLIGHT_STAGGER_MS);
  });

  it('runs only non-empty phases, in order, then collect (skip semantics)', () => {
    const { scene, scheduled } = createMockScene(2);
    const animator = new MainStreetAnimator(scene);

    // Base + reputation contribute; synergy/events/upcoming are empty.
    const order: IncomePhaseKey[] = [];
    animator.animateIncomePhases(makePhaseData([100, 100], [100, 100]), {
      phaseGapMs: 100_000,
      onPhase: (phase) => order.push(phase),
    });

    // Two scheduled phases (base, reputation) + collect = 3 dispatches.
    for (let i = 0; i < 3; i++) scheduled[i].fn();

    expect(order).toEqual(['base', 'reputation', 'collect']);
  });

  it('skips every empty phase and schedules only base + collect for base-only data', () => {
    const { scene, scheduled } = createMockScene(2);
    const animator = new MainStreetAnimator(scene);

    const order: IncomePhaseKey[] = [];
    const labels: string[] = [];
    const labelSpy = vi.spyOn(animator, 'showIncomePhaseLabel').mockImplementation((label: string) => {
      labels.push(label);
    });

    animator.animateIncomePhases(makePhaseData([100, 100]), {
      phaseGapMs: 100_000,
      onPhase: (phase) => order.push(phase),
    });

    // Only base is non-empty: exactly one phase dispatch + collect.
    expect(scheduled).toHaveLength(2);
    for (let i = 0; i < scheduled.length; i++) scheduled[i].fn();

    expect(order).toEqual(['base', 'collect']);
    // No label is shown for the skipped phases.
    expect(labels).toEqual(['Base income']);
    labelSpy.mockRestore();
  });

  it('collect runs immediately (no gap) when every phase is empty', () => {
    const { scene, scheduled } = createMockScene(2);
    const animator = new MainStreetAnimator(scene);

    // All contributions zero → every phase is empty.
    animator.animateIncomePhases(
      [
        { slotIndex: 0, businessName: 'A', baseIncome: 0, synergyBonus: 0, repBonus: 0, eventDeltas: [], upcomingDeltas: [] },
        { slotIndex: 1, businessName: 'B', baseIncome: 0, synergyBonus: 0, repBonus: 0, eventDeltas: [], upcomingDeltas: [] },
      ],
      { phaseGapMs: 100_000, startDelayMs: 42, onPhase: () => {} },
    );

    // Exactly one scheduled call (collect) at the start delay — no phase gaps.
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].delay).toBe(42);
  });

  // ── Phase-major combined sweep (MS-0MUXAQQON006XA6I) ────────────────────
  // The competitive closing concatenates every non-eliminated seat's slots in
  // seat order and calls `animateIncomePhases` once. These tests pin the
  // resulting phase-major ordering: each phase runs once over the whole
  // roster, and within a phase the seats play in seat order.

  it('runs each phase once over a combined multi-seat roster (phase-major, not per-seat)', () => {
    const { scene, scheduled } = createMockScene(4);
    const animator = new MainStreetAnimator(scene);

    // Four cards = two seats × two cards, concatenated in seat order.
    const order: IncomePhaseKey[] = [];
    animator.animateIncomePhases(makePhaseData([100, 100, 100, 100], [100, 100, 100, 100]), {
      phaseGapMs: 100_000,
      onPhase: (phase) => order.push(phase),
    });

    // Fire the scheduled phase dispatches (base, reputation) then the collection.
    for (let i = 0; i < 3; i++) scheduled[i].fn();

    // One sweep over the whole roster — the phase sequence is NOT repeated
    // per seat (which would emit entries per seat).
    expect(order).toEqual(['base', 'reputation', 'collect']);
  });

  it('within a phase, seat 0 slots animate before seat 1 slots (seat order)', () => {
    const { scene, scheduled } = createMockScene(4);
    const animator = new MainStreetAnimator(scene);

    // Seat 0 owns handles 0-1, seat 1 owns handles 2-3.
    animator.animateIncomePhases(makePhaseData([100, 100, 100, 100]), { phaseGapMs: 100_000 });

    const schedule = collectCountOutSchedule(scheduled, 0);
    const seat0 = schedule.filter((s) => s.handleIndex <= 1);
    const seat1 = schedule.filter((s) => s.handleIndex >= 2);

    expect(seat0.length).toBeGreaterThan(0);
    expect(seat1.length).toBeGreaterThan(0);
    // Every seat-0 count-out lands strictly before every seat-1 count-out.
    const lastSeat0 = Math.max(...seat0.map((s) => s.delay));
    const firstSeat1 = Math.min(...seat1.map((s) => s.delay));
    expect(firstSeat1).toBeGreaterThan(lastSeat0);
  });

  it('reduced motion schedules no count-outs and no coin flights (AC5)', () => {
    const { scene, scheduled } = createMockScene(2, {
      settingsPanel: { reducedMotion: true },
    });
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomePhases(makePhaseData([300, 200], [100, 100]), { phaseGapMs: 100_000 });

    const schedule = collectCountOutSchedule(scheduled, 0);
    expect(schedule).toEqual([]);
    expect(gridRegistry.addLog).toEqual([]);

    // Dispatch index 1 = reputation (the second scheduled phase).
    const durations = collectFlightDurations(scheduled, 1);
    expect(durations).toEqual([]);
    expect(moveGameObject).not.toHaveBeenCalled();
  });

  it('replay/headless mode schedules nothing (AC7)', () => {
    const { scene, scheduled } = createMockScene(2, { replayMode: true });
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomePhases(makePhaseData([300, 200]), { phaseGapMs: 100 });

    expect(scheduled).toEqual([]);
    expect(gridRegistry.handles).toEqual([]);
    expect(scene.incomeCollectionActive).toBe(false);
  });
});

// ── Owner-aware reputation routing (MS-0MW083E5H009ACB4) ────────────────
//
// The reputation phase's card → rep-bank pips are one of the three HUD-bound
// income routes (parent MS-0MVWNS9L7007CTK9 AC2). In competitive play each
// producing slot's pips must land on the *owning* seat's bank: owner `0` (the
// human) on the shared HUD reputation counter, an AI owner (`ownerId >= 1`) on
// that seat's competitive-scoreboard summary anchor.
//
// Following the repo's test-first tracer-bullet convention, the owner-aware
// cases are authored **red-phase** with `it.fails` (the phase still routes every
// slot to the single HUD anchor today); the implementing child
// MS-0MW083O38005B22F flips them to a plain `it`. The owner-0 guard stays a
// plain `it` so it keeps protecting single-player behaviour through the change.

/** Published HUD reputation anchor (the human seat's rep bank). */
const REP_ROUTE_HUD_ANCHOR = { x: 777, y: 50 };
/** Published AI seat anchor (the seat's scoreboard summary row). */
const REP_ROUTE_SEAT_ANCHOR = { x: 900, y: 32 };

/**
 * Fires the reputation phase dispatch and every flight it schedules, returning
 * the destinations of all coin/pip flights it launched (in launch order).
 */
function runReputationPhase(
  scheduled: ScheduledCall[],
  dispatchIndex: number,
): Array<{ x: number; y: number }> {
  const firstNew = scheduled.length;
  scheduled[dispatchIndex].fn();
  for (const call of scheduled.slice(firstNew)) call.fn();
  return moveGameObject.mock.calls.map((c) => {
    const opts = c[0] as unknown as { destX: number; destY: number };
    return { x: opts.destX, y: opts.destY };
  });
}

describe('MainStreetAnimator.animateIncomePhases — owner-aware reputation routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gridRegistry.handles.length = 0;
    gridRegistry.addLog.length = 0;
  });

  it('keeps an owner-less (single-player / legacy) slot on the HUD reputation anchor', () => {
    const { scene, scheduled } = createMockScene(1, {
      hudRepAnchor: REP_ROUTE_HUD_ANCHOR,
      hudSeatAnchors: null,
    } as Partial<MockScene>);
    const animator = new MainStreetAnimator(scene);

    // Rep-only data: reputation is the first (index 0) scheduled phase.
    animator.animateIncomePhases(makePhaseData([0], [100]), {
      phaseGapMs: 100_000,
      pendingDeltas: { pendingRepDelta: 100 },
    });

    const destinations = runReputationPhase(scheduled, 0);
    expect(destinations).toContainEqual({ ...REP_ROUTE_HUD_ANCHOR });
  });

  it.fails("routes an AI-owned slot's reputation pips to that seat's anchor, not the human HUD (red-phase)", () => {
    const { scene, scheduled } = createMockScene(2, {
      hudRepAnchor: REP_ROUTE_HUD_ANCHOR,
      hudSeatAnchors: { 1: REP_ROUTE_SEAT_ANCHOR },
    } as Partial<MockScene>);
    const animator = new MainStreetAnimator(scene);

    // Slot 0 belongs to the human seat, slot 1 to AI seat 1. One reputation
    // icon each (repBonus 100 in the ×100 economy), one pip flown per slot.
    animator.animateIncomePhases(makePhaseData([0, 0], [100, 100], { 1: 1 }), {
      phaseGapMs: 100_000,
      pendingDeltas: { pendingRepDelta: 200 },
    });

    const destinations = runReputationPhase(scheduled, 0);

    // The human slot keeps the HUD reputation counter...
    expect(destinations).toContainEqual({ ...REP_ROUTE_HUD_ANCHOR });
    // ...while the AI seat's pips land on its own summary row.
    expect(destinations).toContainEqual({ ...REP_ROUTE_SEAT_ANCHOR });
    // Exactly one pip per owning seat — the AI slot never also credits the HUD.
    expect(destinations.filter((d) => d.x === REP_ROUTE_HUD_ANCHOR.x)).toHaveLength(1);
    expect(destinations.filter((d) => d.x === REP_ROUTE_SEAT_ANCHOR.x)).toHaveLength(1);
  });

  it.fails('falls back to the deterministic seat cell for an AI slot with no published seat anchor (red-phase)', () => {
    const { scene, scheduled } = createMockScene(1, {
      hudRepAnchor: REP_ROUTE_HUD_ANCHOR,
      hudSeatAnchors: null,
    } as Partial<MockScene>);
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomePhases(makePhaseData([0], [100], { 0: 1 }), {
      phaseGapMs: 100_000,
      pendingDeltas: { pendingRepDelta: 100 },
    });

    const destinations = runReputationPhase(scheduled, 0);
    // The on-card grid flights (destined for the grid, one per rep icon) are
    // separate from the HUD-bound pips — isolate the pips here.
    const pipDestinations = destinations.filter((d) => d.y !== 140);
    expect(pipDestinations).toHaveLength(1);
    // Never the human HUD counter; deterministic per seat and on/above the
    // HUD baseline like every other HUD flight.
    expect(pipDestinations[0]).not.toEqual({ ...REP_ROUTE_HUD_ANCHOR });
    expect(pipDestinations[0].y).toBeLessThanOrEqual(50);
  });
});
