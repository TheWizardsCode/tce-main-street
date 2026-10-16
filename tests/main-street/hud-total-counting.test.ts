/**
 * Main Street: HUD reconciliation count-up/count-down tests
 * (MS-0MUYAESVU007X2U8)
 *
 * The end-of-turn reconciliation animates coins/reputation arriving at (or
 * leaving) the HUD. A display-only pair of running totals (`displayedCoins` /
 * `displayedReputation`) steps with those flights so the HUD shows the totals
 * building, landing exactly on the post-reconciliation value — without ever
 * mutating engine state or the deferred-mutation guards.
 *
 * Runs in the Node unit environment with Phaser + UI modules mocked. The tests
 * assert observable behaviour via the public animator API: the pure stepping
 * helpers, the per-flight landing/departure steps for the collection, the
 * upcoming coin/pip flights and the incident-reveal bubbles, plus the
 * reduced-motion exemption.
 *
 * @module tests/main-street/hud-total-counting
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phaser is browser-only; the animator only uses it for type annotations.
vi.mock('phaser', () => ({ default: {} }));

// Mock src/ui so importing the animator does not load Phaser-dependent UI code.
const { popTextOrIcon, moveGameObject } = vi.hoisted(() => ({
  popTextOrIcon: vi.fn((_opts?: unknown) => Promise.resolve()),
  moveGameObject: vi.fn((_opts?: unknown) => ({})),
}));

vi.mock('@ui', () => ({
  FONT_FAMILY: 'sans-serif',
  popTextOrIcon,
  moveGameObject,
}));

import { MainStreetAnimator } from '../../src/scenes/MainStreetAnimator';
import {
  initDisplayedTotals,
  snapDisplayedTotals,
  stepDisplayedTotal,
} from '../../src/scenes/MainStreetAnimatorContext';

// ── Mock scene helpers ──────────────────────────────────────

interface ScheduledCall {
  delay: number;
  fn: () => void;
}

function makeIcon() {
  return {
    getWorldTransformMatrix: () => ({ getX: () => 10, getY: () => 20 }),
    setPosition: vi.fn().mockReturnThis(),
    setDepth: vi.fn().mockReturnThis(),
    setScale: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
  };
}

function createMockScene(overrides: Record<string, unknown> = {}) {
  const scheduled: ScheduledCall[] = [];

  const scene: Record<string, any> = {
    layout: {
      gameW: 1280,
      hudY: 50,
      streetCols: 5,
      streetX: 20,
      slotW: 140,
      slotH: 80,
      slotGap: 20,
      streetTop: 100,
      streetRowGap: 12,
    },
    settingsPanel: null,
    replayMode: false,
    incomeCollectionActive: false,
    incidentRevealActive: false,
    previousCoins: null as number | null,
    previousReputation: null as number | null,
    displayedCoins: null as number | null,
    displayedReputation: null as number | null,
    displayedIncomeCounted: false,
    endOfTurnDeltasApplied: false,
    state: { resourceBank: { coins: 100, reputation: 5 } },
    soundManager: { play: vi.fn() },
    gameEvents: { emit: vi.fn() },
    time: {
      delayedCall: vi.fn((delay: number, fn: () => void) => {
        scheduled.push({ delay, fn });
        return {};
      }),
    },
    add: {
      circle: vi.fn((x: number, y: number) => ({
        x,
        y,
        destroy: vi.fn(),
        setDepth: vi.fn().mockReturnThis(),
      })),
      text: vi.fn((x: number, y: number, label: string) => ({
        x,
        y,
        label,
        setOrigin: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
      })),
      existing: vi.fn(),
    },
    syncHudTotals: vi.fn(),
    ...overrides,
  };

  return { scene, scheduled };
}

/** Fires every scheduled delayed call (which register the flights). */
function runScheduled(scheduled: ScheduledCall[]): void {
  for (const { fn } of [...scheduled]) fn();
}

/** Fires the `onComplete` of every registered flight (the landings). */
function runMoveCompletes(): void {
  for (const call of moveGameObject.mock.calls) {
    (call[0] as { onComplete?: () => void } | undefined)?.onComplete?.();
  }
}

// ── Pure display-total helpers ──────────────────────────────

describe('display-only reconciliation totals (MS-0MUYAESVU007X2U8)', () => {
  it('steps mid-flight strictly between the pre- and post-values, then snaps exact', () => {
    const host = {
      displayedCoins: 100,
      displayedReputation: 5,
      previousCoins: 100,
      previousReputation: 5,
      syncHudTotals: vi.fn(),
    };

    stepDisplayedTotal(host, 'coin', 100);
    expect(host.displayedCoins).toBe(200); // strictly between 100 and 300
    expect(host.syncHudTotals).toHaveBeenCalledTimes(1);

    snapDisplayedTotals(host, { pendingCoinDelta: 200, pendingRepDelta: 3 });
    expect(host.displayedCoins).toBe(300); // exact post-reconciliation value
    expect(host.displayedReputation).toBe(8);
    expect(host.syncHudTotals).toHaveBeenCalledTimes(2);
  });

  it('counts down symmetrically for negative deltas', () => {
    const host = {
      displayedCoins: 500,
      displayedReputation: 10,
      previousCoins: 500,
      previousReputation: 10,
    };

    stepDisplayedTotal(host, 'coin', -200);
    stepDisplayedTotal(host, 'rep', -4);
    expect(host.displayedCoins).toBe(300);
    expect(host.displayedReputation).toBe(6);

    snapDisplayedTotals(host, { pendingCoinDelta: -250, pendingRepDelta: -5 });
    expect(host.displayedCoins).toBe(250);
    expect(host.displayedReputation).toBe(5);
  });

  it('never counts when the counters are not initialised (reduced motion / replay)', () => {
    const host = {
      displayedCoins: null,
      displayedReputation: null,
      previousCoins: 100,
      previousReputation: 5,
      syncHudTotals: vi.fn(),
    };

    stepDisplayedTotal(host, 'coin', 50);
    stepDisplayedTotal(host, 'rep', 2);
    snapDisplayedTotals(host, { pendingCoinDelta: 50, pendingRepDelta: 2 });

    expect(host.displayedCoins).toBeNull();
    expect(host.displayedReputation).toBeNull();
    expect(host.syncHudTotals).not.toHaveBeenCalled();
  });

  it('initialises both running totals', () => {
    const host = {
      displayedCoins: null,
      displayedReputation: null,
      previousCoins: null,
      previousReputation: null,
    };
    initDisplayedTotals(host, 100, 7);
    expect(host.displayedCoins).toBe(100);
    expect(host.displayedReputation).toBe(7);
  });
});

// ── Collection flights ──────────────────────────────────────

// ── Phase-level accrual counting ────────────────────────────

describe('phase-level accrual counting (MS-0MUYAESVU007X2U8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts base income up per coin as it counts out onto the card', () => {
    const { scene, scheduled } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    scene.previousCoins = 100;
    scene.displayedCoins = 100;

    // Two icons represent the 200 base income; each reveal steps +100.
    const slot = {
      pd: { slotIndex: 0, baseIncome: 200, synergyBonus: 0, repBonus: 0, eventDeltas: [] },
      displayed: 0,
      handle: {
        container: {
          list: [],
          remove: vi.fn(),
          destroy: vi.fn(),
          getWorldTransformMatrix: () => ({ getX: () => 0, getY: () => 0 }),
        },
        addCoins: vi.fn().mockReturnValue({ positions: [] }),
        getWorldTransformMatrix: () => ({ getX: () => 0, getY: () => 0 }),
      },
    } as any;

    animator.countOutCoins(slot, 200, 0);
    // Fire only the FIRST scheduled reveal: the running total must be
    // strictly between the pre- (100) and post-reconciliation values — the
    // visible build-up during the phase, not a final burst.
    scheduled[0].fn();
    expect(scene.displayedCoins).toBe(200);
    expect(scene.syncHudTotals).toHaveBeenCalled();
  });

  it('steps reputation income up as rep coins land (AC1 reputation parity)', () => {
    const { scene, scheduled } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    scene.previousCoins = 100;
    scene.displayedCoins = 100;
    scene.previousReputation = 300;
    scene.displayedReputation = 300;

    // One rep coin carrying the slot's repBonus; 5 reputation income to
    // allocate across it.
    const slot = {
      pd: { slotIndex: 0, baseIncome: 0, synergyBonus: 0, repBonus: 500, eventDeltas: [] },
      displayed: 0,
      handle: {
        container: {
          list: [],
          remove: vi.fn(),
          destroy: vi.fn(),
          getWorldTransformMatrix: () => ({ getX: () => 0, getY: () => 0 }),
        },
        addCoins: vi.fn().mockReturnValue({ positions: [] }),
        getWorldTransformMatrix: () => ({ getX: () => 0, getY: () => 0 }),
      },
    } as any;

    animator.runIncomePhase('reputation', [slot], {
      reducedMotion: false,
      pendingDeltas: { pendingCoinDelta: 0, pendingRepDelta: 5, pendingScoreDelta: 0 },
    });
    runScheduled(scheduled);
    runMoveCompletes();

    // The shown Reputation counter climbs with the rep coins (was frozen at
    // the pre value the whole turn before this fix) and lands on the exact
    // income value (5 rep across 5 coins).
    expect(scene.displayedReputation).toBe(305);
    expect(scene.syncHudTotals).toHaveBeenCalled();
  });
});

// ── Collection flights ──────────────────────────────────────

describe('collectIncomeGrids display counting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not re-count coins per icon (they accrued during the phases) and snaps exact at the last landing', () => {
    const { scene, scheduled } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    vi.spyOn(animator, 'applyPendingDeltasOnce').mockImplementation(() => {});
    scene.previousCoins = 100;
    scene.displayedCoins = 100;

    const slots = [{
      pd: { slotIndex: 0, businessName: 'Bakery', baseIncome: 200, synergyBonus: 0, repBonus: 0, eventDeltas: [] },
      handle: { container: { list: [makeIcon(), makeIcon()], remove: vi.fn(), destroy: vi.fn() } },
    }];

    animator.collectIncomeGrids(slots as any, {
      reducedMotion: false,
      creditedTotal: 200,
      pendingDeltas: { pendingCoinDelta: 250, pendingRepDelta: 0, pendingScoreDelta: 0 },
    });

    // The collection is a visual delivery of the already-counted coins: the
    // per-icon coin steps live in the phases (base/synergy/reputation/events),
    // so merely flying the grid to the HUD must NOT move the running total.
    expect(scene.displayedCoins).toBe(100);
    runScheduled(scheduled);
    (moveGameObject.mock.calls[0][0] as { onComplete: () => void })?.onComplete?.();
    expect(scene.displayedCoins).toBe(100);

    // Last landing: the collection snaps the running totals to the
    // authoritative post-reconciliation values exactly once (AC5b).
    (moveGameObject.mock.calls[1][0] as { onComplete: () => void })?.onComplete?.();
    expect(scene.displayedCoins).toBe(350);
    // The in-place re-render happened at the snap (not per landing).
    expect(scene.syncHudTotals).toHaveBeenCalled();
    // The phased show is marked as counted so the incident replay cannot double-count.
    expect(scene.displayedIncomeCounted).toBe(true);
  });

  it('never counts under reduced motion', () => {
    const { scene } = createMockScene({ settingsPanel: { reducedMotion: true } });
    const animator = new MainStreetAnimator(scene);
    vi.spyOn(animator, 'applyPendingDeltasOnce').mockImplementation(() => {});
    scene.previousCoins = 100;
    scene.displayedCoins = null; // reduced motion never initialises the counter

    const slots = [{
      pd: { slotIndex: 0, businessName: 'Bakery', baseIncome: 100, synergyBonus: 0, repBonus: 0, eventDeltas: [] },
      handle: { container: { list: [makeIcon()], remove: vi.fn(), destroy: vi.fn() } },
    }];

    animator.collectIncomeGrids(slots as any, {
      reducedMotion: true,
      creditedTotal: 100,
      pendingDeltas: { pendingCoinDelta: 100, pendingRepDelta: 0, pendingScoreDelta: 0 },
    });

    expect(scene.displayedCoins).toBeNull();
  });
});

// ── Upcoming coin / pip flights ─────────────────────────────

describe('flyCoinsToPoint / flyRepPips display counting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('steps the coin total up at each gain landing', () => {
    const { scene, scheduled } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    scene.previousCoins = 500;
    scene.displayedCoins = 500;

    animator.flyCoinsToPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 200, 0, undefined, 200);
    runScheduled(scheduled);

    expect(scene.displayedCoins).toBe(500); // nothing until a landing
    runMoveCompletes();
    expect(scene.displayedCoins).toBe(700);
  });

  it('steps the coin total down at each loss departure', () => {
    const { scene, scheduled } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    scene.previousCoins = 500;
    scene.displayedCoins = 500;

    animator.flyCoinsToPoint({ x: 100, y: 0 }, { x: 0, y: 0 }, 200, 0, undefined, -200);
    // A loss departs from the HUD, so the total moves at launch.
    runScheduled(scheduled);
    runMoveCompletes();
    expect(scene.displayedCoins).toBe(300);
  });

  it('steps the reputation total for pip flights in both directions', () => {
    const { scene, scheduled } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    scene.previousReputation = 10;
    scene.displayedReputation = 10;

    // Gain: counts at landing.
    animator.flyRepPips({ x: 0, y: 0 }, { x: 100, y: 0 }, 2, 0, undefined, 2);
    runScheduled(scheduled);
    expect(scene.displayedReputation).toBe(10);
    runMoveCompletes();
    expect(scene.displayedReputation).toBe(12);

    // Loss: counts at departure.
    moveGameObject.mockClear();
    scheduled.length = 0;
    animator.flyRepPips({ x: 100, y: 0 }, { x: 0, y: 0 }, 3, 0, undefined, -3);
    runScheduled(scheduled);
    expect(scene.displayedReputation).toBe(9);
  });
});

// ── Incident-reveal bubbles ─────────────────────────────────

describe('animateIncidentDeltaBubbles display counting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts an incident loss down as the bubbles depart the HUD', () => {
    const { scene, scheduled } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    scene.previousCoins = 500;
    scene.displayedCoins = 500;
    scene.displayedIncomeCounted = false;

    animator.animateIncidentDeltaBubbles({
      coinChange: -100,
      repChange: 0,
      cardCenter: { x: 10, y: 10 },
      hudCoinX: 100,
      hudRepX: 200,
      hudY: 50,
    });

    runScheduled(scheduled);
    runMoveCompletes();
    expect(scene.displayedCoins).toBe(400);
  });

  it('counts an incident gain up at the HUD', () => {
    const { scene, scheduled } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    scene.previousCoins = 500;
    scene.displayedCoins = 500;
    scene.displayedIncomeCounted = false;

    animator.animateIncidentDeltaBubbles({
      coinChange: 100,
      repChange: 0,
      cardCenter: { x: 10, y: 10 },
      hudCoinX: 100,
      hudRepX: 200,
      hudY: 50,
    });

    runScheduled(scheduled);
    expect(scene.displayedCoins).toBe(500); // counts at the HUD landing
    runMoveCompletes();
    expect(scene.displayedCoins).toBe(600);
  });

  it('does not count when the phased upcoming phase already counted the delta', () => {
    const { scene, scheduled } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    scene.previousCoins = 500;
    scene.displayedCoins = 500;
    scene.displayedIncomeCounted = true; // phased show already counted the incident

    animator.animateIncidentDeltaBubbles({
      coinChange: -100,
      repChange: 0,
      cardCenter: { x: 10, y: 10 },
      hudCoinX: 100,
      hudRepX: 200,
      hudY: 50,
    });

    runScheduled(scheduled);
    runMoveCompletes();
    expect(scene.displayedCoins).toBe(500);
  });
});
