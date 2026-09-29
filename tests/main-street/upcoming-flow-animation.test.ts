/**
 * Main Street: Upcoming phase animation routing (CG-0MUA1UH3A008M4BS).
 *
 * Drives the REAL `MainStreetAnimator.runIncomePhase('upcoming', …)` against
 * a mocked Phaser scene and asserts the observable flight endpoints the ACs
 * call for:
 *
 *  - AC1 business-attached: gain lands on the business card, loss leaves it.
 *  - AC2 unattached (`target = All`): routes to/from the HUD coin counter and
 *    never touches a business grid.
 *  - AC3 reputation parity: reputation deltas follow the same rules.
 *  - AC4 presentational only: game state is never mutated by the phase.
 *
 * Runs in the Node unit environment with Phaser + UI modules mocked; the
 * observable contract is the `add.circle` origins and `moveGameObject`
 * destinations the choreography produces.
 *
 * @module tests/main-street/upcoming-flow-animation
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

vi.mock('../../src/coin-grid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/coin-grid')>();
  return {
    ...actual,
    createCoinGrid: vi.fn(() => ({
      addCoins: vi.fn(() => ({ placements: [], iconCount: 0 })),
      clear: vi.fn(),
      getLayout: vi.fn(() => null),
      container: {
        list: [],
        remove: vi.fn(),
        destroy: vi.fn(),
        getWorldTransformMatrix: () => ({ getX: () => 0, getY: () => 0 }),
      },
    })),
  };
});

import { MainStreetAnimator } from '../../src/scenes/MainStreetAnimator';
import type { IncomePhaseSlot } from '../../src/scenes/MainStreetAnimatorContext';
import type { SlotEventDelta, SlotPhaseBreakdown } from '../../src/MainStreetAdjacency';

// ── Geometry used by the mocked scene ────────────────────────────────
const GAME_W = 1280;
const HUD_Y = 50;
const QUEUE_TOP = 600;
const GRID_X = 111;
const GRID_Y = 222;
const SLOT_CENTER = { x: 321, y: 432 };
const UPCOMING = { x: GAME_W * 0.5, y: QUEUE_TOP };
const HUD_COIN = { x: GAME_W * 0.25 + 70, y: HUD_Y };
const HUD_REP = { x: GAME_W * 0.5, y: HUD_Y };

interface ScheduledCall {
  delay: number;
  fn: () => void;
}

interface MockIcon {
  getWorldTransformMatrix: () => { getX: () => number; getY: () => number };
  setPosition: () => MockIcon;
  setDepth: () => MockIcon;
  destroy: () => void;
}

function makeIcon(): MockIcon {
  const icon: MockIcon = {
    getWorldTransformMatrix: () => ({ getX: () => GRID_X, getY: () => GRID_Y }),
    setPosition: () => icon,
    setDepth: () => icon,
    destroy: vi.fn(),
  };
  return icon;
}

function createMockScene(): {
  scene: Record<string, unknown>;
  scheduled: ScheduledCall[];
  circles: Array<{ x: number; y: number; radius: number; color: number }>;
} {
  const scheduled: ScheduledCall[] = [];
  const circles: Array<{ x: number; y: number; radius: number; color: number }> = [];

  const scene: Record<string, unknown> = {
    layout: {
      gameW: GAME_W,
      gameH: 720,
      hudY: HUD_Y,
      queueTop: QUEUE_TOP,
      streetCols: 5,
      streetX: 20,
      streetTop: 100,
      slotW: 140,
      slotH: 80,
      slotGap: 20,
      streetRowGap: 12,
    },
    settingsPanel: null,
    replayMode: false,
    incomeCollectionActive: false,
    state: { activeEffects: [] },
    soundManager: { play: vi.fn() },
    gameEvents: { emit: vi.fn() },
    streetLocalToScreen: () => SLOT_CENTER,
    time: {
      delayedCall: vi.fn((delay: number, fn: () => void) => {
        scheduled.push({ delay, fn });
        return {};
      }),
    },
    add: {
      circle: vi.fn((x: number, y: number, radius: number, color: number) => {
        circles.push({ x, y, radius, color });
        return { setDepth: vi.fn().mockReturnThis(), destroy: vi.fn() };
      }),
      existing: vi.fn(),
    },
    tweens: { add: vi.fn() },
  };

  return { scene, scheduled, circles };
}

function makeSlot(
  deltas: SlotEventDelta[],
  opts: { withIcons?: boolean } = {},
): IncomePhaseSlot {
  const icons = opts.withIcons ? [makeIcon()] : [];
  const container = {
    list: icons,
    remove: vi.fn(() => {
      (container.list as unknown[]).length = 0;
    }),
    destroy: vi.fn(),
    getWorldTransformMatrix: () => ({ getX: () => GRID_X, getY: () => GRID_Y }),
  };
  const pd: SlotPhaseBreakdown = {
    slotIndex: 0,
    businessName: 'Cafe',
    baseIncome: 0,
    synergyBonus: 0,
    repBonus: 0,
    eventDeltas: [],
    upcomingDeltas: deltas,
  };
  return {
    pd,
    card: {} as never,
    handle: {
      addCoins: vi.fn(() => ({ placements: [], iconCount: 0 })),
      clear: vi.fn(),
      getLayout: vi.fn(() => null),
      container,
    } as never,
    displayed: 0,
  };
}

/** Runs the `upcoming` phase and fires every scheduled flight. */
function runUpcoming(
  animator: MainStreetAnimator,
  scene: Record<string, unknown>,
  scheduled: ScheduledCall[],
  slot: IncomePhaseSlot,
): void {
  animator.runIncomePhase('upcoming', [slot], { reducedMotion: false });
  expect(vi.mocked(scene.time as { delayedCall: unknown }).delayedCall).not.toBeUndefined();
  // Fire every delayed call (may schedule further calls — loop until stable).
  let guard = 0;
  while (scheduled.length > 0 && guard < 1000) {
    const next = scheduled.shift()!;
    next.fn();
    guard += 1;
  }
}

function lastMove(): { destX: number; destY: number } {
  const calls = moveGameObject.mock.calls;
  const opts = calls[calls.length - 1][0] as unknown as { destX: number; destY: number };
  return { destX: opts.destX, destY: opts.destY };
}

describe('runIncomePhase("upcoming") routing (CG-0MUA1UH3A008M4BS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC1: attached coin gain lands on the business card grid (Upcoming → grid)', () => {
    const { scene, scheduled, circles } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    const slot = makeSlot([{ cardId: 'e', name: 'Festival', delta: 100, kind: 'coin', attachedSlotIndex: 0 }]);

    runUpcoming(animator, scene, scheduled, slot);

    expect(circles[0]).toMatchObject({ x: UPCOMING.x, y: UPCOMING.y });
    expect(lastMove()).toEqual({ destX: GRID_X, destY: GRID_Y });
  });

  it('AC1: attached coin loss leaves the business card grid (grid → Upcoming)', () => {
    const { scene, scheduled, circles } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    const slot = makeSlot(
      [{ cardId: 'e', name: 'Pipe Burst', delta: -100, kind: 'coin', attachedSlotIndex: 0 }],
      { withIcons: true },
    );

    runUpcoming(animator, scene, scheduled, slot);

    // flyCoinsOut uses the existing grid icon (no new circle) and flies it to
    // the Upcoming source.
    expect(circles).toHaveLength(0);
    expect(lastMove()).toEqual({ destX: UPCOMING.x, destY: UPCOMING.y });
    void circles;
  });

  it('AC2: unattached coin gain lands on the HUD coin counter and never the grid', () => {
    const { scene, scheduled, circles } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    const slot = makeSlot([{ cardId: 'e', name: 'Tax Audit', delta: 100, kind: 'coin', attachedSlotIndex: null }]);

    runUpcoming(animator, scene, scheduled, slot);

    expect(circles[0]).toMatchObject({ x: UPCOMING.x, y: UPCOMING.y });
    expect(lastMove()).toEqual({ destX: HUD_COIN.x, destY: HUD_COIN.y });
    expect(lastMove()).not.toEqual({ destX: GRID_X, destY: GRID_Y });
  });

  it('AC2: unattached coin loss leaves the HUD coin counter (HUD → Upcoming)', () => {
    const { scene, scheduled, circles } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    const slot = makeSlot([{ cardId: 'e', name: 'Tax Audit', delta: -100, kind: 'coin', attachedSlotIndex: null }]);

    runUpcoming(animator, scene, scheduled, slot);

    expect(circles[0]).toMatchObject({ x: HUD_COIN.x, y: HUD_COIN.y });
    expect(lastMove()).toEqual({ destX: UPCOMING.x, destY: UPCOMING.y });
  });

  it('AC3: attached reputation gain lands on the business card', () => {
    const { scene, scheduled, circles } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    const slot = makeSlot([{ cardId: 'e', name: 'Award', delta: 100, kind: 'rep', attachedSlotIndex: 0 }]);

    runUpcoming(animator, scene, scheduled, slot);

    expect(circles[0]).toMatchObject({ x: UPCOMING.x, y: UPCOMING.y, radius: 5, color: 0x88bbff });
    expect(lastMove()).toEqual({ destX: SLOT_CENTER.x, destY: SLOT_CENTER.y });
  });

  it('AC3: attached reputation loss leaves the business card', () => {
    const { scene, scheduled, circles } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    const slot = makeSlot([{ cardId: 'e', name: 'Inspection', delta: -100, kind: 'rep', attachedSlotIndex: 0 }]);

    runUpcoming(animator, scene, scheduled, slot);

    expect(circles[0]).toMatchObject({ x: SLOT_CENTER.x, y: SLOT_CENTER.y });
    expect(lastMove()).toEqual({ destX: UPCOMING.x, destY: UPCOMING.y });
  });

  it('AC3: unattached reputation gain lands on the HUD reputation counter', () => {
    const { scene, scheduled, circles } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    const slot = makeSlot([{ cardId: 'e', name: 'Good Press', delta: 100, kind: 'rep', attachedSlotIndex: null }]);

    runUpcoming(animator, scene, scheduled, slot);

    expect(circles[0]).toMatchObject({ x: UPCOMING.x, y: UPCOMING.y });
    expect(lastMove()).toEqual({ destX: HUD_REP.x, destY: HUD_REP.y });
    expect(lastMove()).not.toEqual({ destX: HUD_COIN.x, destY: HUD_COIN.y });
  });

  it('AC3: unattached reputation loss leaves the HUD reputation counter', () => {
    const { scene, scheduled, circles } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    const slot = makeSlot([{ cardId: 'e', name: 'Vandalism', delta: -100, kind: 'rep', attachedSlotIndex: null }]);

    runUpcoming(animator, scene, scheduled, slot);

    expect(circles[0]).toMatchObject({ x: HUD_REP.x, y: HUD_REP.y });
    expect(lastMove()).toEqual({ destX: UPCOMING.x, destY: UPCOMING.y });
  });

  it('AC4: the phase never mutates game state', () => {
    const { scene, scheduled } = createMockScene();
    const state = scene.state as { activeEffects: unknown[]; resourceBank?: unknown };
    const before = JSON.stringify(state);
    const animator = new MainStreetAnimator(scene);
    const slot = makeSlot([{ cardId: 'e', name: 'Mixed', delta: -100, kind: 'coin', attachedSlotIndex: null }]);

    runUpcoming(animator, scene, scheduled, slot);

    expect(JSON.stringify(scene.state)).toBe(before);
  });

  it('AC4: reduced motion schedules no flights', () => {
    const { scene, scheduled, circles } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    const slot = makeSlot([{ cardId: 'e', name: 'Festival', delta: 100, kind: 'coin', attachedSlotIndex: 0 }]);

    animator.runIncomePhase('upcoming', [slot], { reducedMotion: true });

    expect(scheduled).toHaveLength(0);
    expect(circles).toHaveLength(0);
    expect(moveGameObject).not.toHaveBeenCalled();
  });
});
