/**
 * Main Street: Income Collection Animator Tests
 *
 * Unit tests for `MainStreetAnimator.animateIncomeCollection` and the
 * `incomeCollectionActive` suppression in `animateHudValueChanges`.
 *
 * These run in the Node unit environment, so the browser-only Phaser and
 * `src/ui` modules are mocked. The tests assert observable behaviour via
 * the public animator API: which flights are launched (per producing slot
 * and reputation-earning slot), the staggered coin-pop SFX config, the
 * final "+total" pop, the reduced-motion / replay-mode exemptions, and the
 * HUD delta-pop suppression while collection is running.
 *
 * @module tests/main-street/income-collection-animator
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
import { SFX_KEYS } from '../../src/scenes/MainStreetConstants';
import type { IncomePhaseSlot } from '../../src/scenes/MainStreetAnimatorContext';
import type { SlotPhaseBreakdown } from '../../src/MainStreetAdjacency';

// ── Mock scene helpers ──────────────────────────────────────

interface ScheduledCall {
  delay: number;
  fn: () => void;
}

function createMockScene(overrides: Record<string, unknown> = {}) {
  const scheduled: ScheduledCall[] = [];
  const createdTexts: Array<{ x: number; y: number; label: string }> = [];
  const createdCircles: Array<{ x: number; y: number }> = [];

  const scene = {
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
    previousCoins: null as number | null,
    previousReputation: null as number | null,
    soundManager: { play: vi.fn() },
    gameEvents: { emit: vi.fn() },
    time: {
      delayedCall: vi.fn((delay: number, fn: () => void) => {
        scheduled.push({ delay, fn });
        return {};
      }),
    },
    add: {
      circle: vi.fn((x: number, y: number) => {
        createdCircles.push({ x, y });
        return { x, y, destroy: vi.fn(), setDepth: vi.fn() };
      }),
      text: vi.fn((x: number, y: number, label: string) => {
        createdTexts.push({ x, y, label });
        return {
          x,
          y,
          label,
          setOrigin: vi.fn().mockReturnThis(),
          setDepth: vi.fn().mockReturnThis(),
        };
      }),
      // `collectIncomeGrids` re-parents each collected grid icon to the scene.
      existing: vi.fn(),
    },
    ...overrides,
  };

  return { scene, scheduled, createdTexts, createdCircles };
}

/** Fires every scheduled delayed call, then every moveGameObject onComplete. */
function completeAllFlights(scheduled: ScheduledCall[]): void {
  for (const { fn } of scheduled) fn();
  for (const opts of moveGameObject.mock.calls.map((c) => c[0] as { onComplete?: () => void } | undefined)) {
    opts?.onComplete?.();
  }
}

// ── Tests ───────────────────────────────────────────────────

describe('MainStreetAnimator.animateIncomeCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('launches one staggered coin flight per producing slot to the HUD coins counter', () => {
    const { scene, scheduled } = createMockScene();
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomeCollection({
      income: {
        total: 4,
        breakdown: [
          { slotIndex: 0, businessName: 'Bakery', baseIncome: 2, synergyBonus: 0, total: 2 },
          { slotIndex: 1, businessName: 'Laundromat', baseIncome: 2, synergyBonus: 0, total: 2 },
        ],
      },
      repSources: [],
    });

    // Flag is active while collection is running.
    expect(scene.incomeCollectionActive).toBe(true);

    // Two flights scheduled with increasing delays (staggered launch).
    expect(scheduled.map((c) => c.delay)).toEqual([0, 50]);
    expect(scheduled).toHaveLength(2);

    // Fire the launches (the flights start when each delayed call fires).
    for (const { fn } of scheduled) fn();

    // Each flight targets the HUD coin counter with the shared coin-pop SFX
    // played via the scene SoundManager. No anchors are published (the mock
    // scene has none), so the flight uses the conservative fallback coordinate
    // — the value before the first HUD render.
    const coinX = 1280 * 0.25 + 70;
    const moveCalls = moveGameObject.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(moveCalls).toHaveLength(2);
    for (const opts of moveCalls) {
      expect(opts.destX).toBe(coinX);
      expect(opts.destY).toBe(50);
      expect(opts.sfx).toEqual({ start: SFX_KEYS.COIN_POP });
      expect(opts.soundManager).toBe(scene.soundManager);
    }
    // Sources are the street-slot centres of the producing slots.
    const circleStarts = scene.add.circle.mock.calls.map((c) => ({ x: c[0], y: c[1] }));
    expect(circleStarts).toEqual([
      { x: 90, y: 140 },   // slot 0 (col 0, row 0)
      { x: 250, y: 140 },  // slot 1 (col 1, row 0)
    ]);
  });

  it('launches reputation pips to the rep HUD value for rep-earning cards', () => {
    const { scene, scheduled } = createMockScene();
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomeCollection({
      income: { total: 0, breakdown: [] },
      repSources: [{ slotIndex: 2, rep: 1 }],
    });

    expect(scheduled).toHaveLength(1);
    scheduled[0].fn();

    const moveCalls = moveGameObject.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(moveCalls).toHaveLength(1);
    // Rep pip targets the reputation label at the strip centre (gameW * 0.5).
    expect(moveCalls[0].destX).toBe(1280 * 0.5);
    expect(moveCalls[0].destY).toBe(50);
  });

  it('pops the final "+total" once every flight has landed and clears the flag', async () => {
    const { scene, scheduled, createdTexts } = createMockScene();
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomeCollection({
      income: {
        total: 4,
        breakdown: [
          { slotIndex: 0, businessName: 'Bakery', baseIncome: 2, synergyBonus: 0, total: 2 },
          { slotIndex: 1, businessName: 'Laundromat', baseIncome: 2, synergyBonus: 0, total: 2 },
        ],
      },
      repSources: [],
    });

    completeAllFlights(scheduled);

    // Final "+total" pop at the coin counter, above the HUD strip.
    expect(popTextOrIcon).toHaveBeenCalledTimes(1);
    const popOpts = popTextOrIcon.mock.calls[0][0] as Record<string, unknown>;
    const totalText = createdTexts.find((t) => t.label === '+4');
    expect(totalText).toBeDefined();
    expect(popOpts.target).toBeDefined();
    expect((popOpts.target as { label: string }).label).toBe('+4');
    expect(popOpts.duration).toBeGreaterThan(0);

    // The collection flag clears once the animation is complete.
    expect(scene.incomeCollectionActive).toBe(false);
  });

  it('does nothing when no slots produce income or reputation (flag stays unset)', () => {
    const { scene, scheduled } = createMockScene();
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomeCollection({
      income: {
        total: 0,
        breakdown: [{ slotIndex: 0, businessName: 'Sold', baseIncome: 0, synergyBonus: 0, total: 0 }],
      },
      repSources: [],
    });

    expect(scene.incomeCollectionActive).toBe(false);
    expect(scheduled).toHaveLength(0);
    expect(moveGameObject).not.toHaveBeenCalled();
  });

  it('skips all flights under reduced motion (single final pop handled by HUD refresh)', () => {
    const { scene, scheduled } = createMockScene({
      settingsPanel: { reducedMotion: true },
    });
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomeCollection({
      income: {
        total: 4,
        breakdown: [{ slotIndex: 0, businessName: 'Bakery', baseIncome: 2, synergyBonus: 0, total: 2 }],
      },
      repSources: [],
    });

    expect(scene.incomeCollectionActive).toBe(false);
    expect(scheduled).toHaveLength(0);
    expect(moveGameObject).not.toHaveBeenCalled();
    expect(popTextOrIcon).not.toHaveBeenCalled();
  });

  it('returns immediately in replay/headless mode (documented exemption)', () => {
    const { scene, scheduled } = createMockScene({ replayMode: true });
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomeCollection({
      income: {
        total: 4,
        breakdown: [{ slotIndex: 0, businessName: 'Bakery', baseIncome: 2, synergyBonus: 0, total: 2 }],
      },
      repSources: [],
    });

    expect(scene.incomeCollectionActive).toBe(false);
    expect(scheduled).toHaveLength(0);
    expect(moveGameObject).not.toHaveBeenCalled();
  });

  it('flies coins and the final +total pop to the published HUD coin anchor (MS-0MUYT57J80021CWW)', () => {
    // The HUD render publishes the live coin-number anchor; the flight must
    // land exactly on it, ignoring the legacy gameW-fraction fallback.
    const { scene, scheduled, createdTexts } = createMockScene({
      hudCoinAnchor: { x: 409, y: 50 },
      hudRepAnchor: { x: 777, y: 50 },
    });
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomeCollection({
      income: {
        total: 4,
        breakdown: [{ slotIndex: 0, businessName: 'Bakery', baseIncome: 2, synergyBonus: 0, total: 2 }],
      },
      repSources: [],
    });

    completeAllFlights(scheduled);

    const moveCalls = moveGameObject.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(moveCalls).toHaveLength(1);
    expect(moveCalls[0].destX).toBe(409);
    expect(moveCalls[0].destY).toBe(50);
    // The final "+total" pop targets the same published anchor.
    const totalText = createdTexts.find((t) => t.label === '+4');
    expect(totalText).toBeDefined();
    expect(totalText!.x).toBe(409);
    expect(scene.incomeCollectionActive).toBe(false);
  });

  it('flies reputation pips to the published HUD rep anchor (MS-0MUYT57J80021CWW)', () => {
    const { scene, scheduled } = createMockScene({
      hudCoinAnchor: { x: 409, y: 50 },
      hudRepAnchor: { x: 777, y: 50 },
    });
    const animator = new MainStreetAnimator(scene);

    animator.animateIncomeCollection({
      income: { total: 0, breakdown: [] },
      repSources: [{ slotIndex: 2, rep: 1 }],
    });

    scheduled[0].fn();
    const moveCalls = moveGameObject.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(moveCalls).toHaveLength(1);
    expect(moveCalls[0].destX).toBe(777);
    expect(moveCalls[0].destY).toBe(50);
  });
});

describe('MainStreetAnimator.animateHudValueChanges income suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suppresses the immediate delta pop while collection is active but still routes the income sound', () => {
    const { scene } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    scene.previousCoins = 10;
    scene.previousReputation = 5;
    scene.incomeCollectionActive = true;

    animator.animateHudValueChanges({
      coins: 14,
      reputation: 5,
      coinX: 390,
      repX: 640,
      hudY: 50,
    });

    // No immediate pop text while the collection animation is running...
    expect(scene.add.text).not.toHaveBeenCalled();
    expect(popTextOrIcon).not.toHaveBeenCalled();
    // ...but the income-gained event (income sound) is still emitted.
    expect(scene.gameEvents.emit).toHaveBeenCalledWith('income-gained', { amount: 4 });
  });

  it('shows the delta pop when collection is not active', () => {
    const { scene } = createMockScene();
    const animator = new MainStreetAnimator(scene);
    scene.previousCoins = 10;
    scene.previousReputation = 5;

    animator.animateHudValueChanges({
      coins: 14,
      reputation: 5,
      coinX: 390,
      repX: 640,
      hudY: 50,
    });

    expect(scene.add.text).toHaveBeenCalledTimes(1);
    expect(popTextOrIcon).toHaveBeenCalledTimes(1);
    expect(scene.gameEvents.emit).toHaveBeenCalledWith('income-gained', { amount: 4 });
  });
});

// ── Owner-aware collection routing (MS-0MW083E5H009ACB4) ────────────────
//
// The grid → bank collection is one of the three HUD-bound income routes
// (parent MS-0MVWNS9L7007CTK9 AC2). In competitive play the collected coins
// must fly to the *owning* seat's bank: owner `0` (the human) keeps the shared
// HUD coin counter, an AI owner (`ownerId >= 1`) targets that seat's
// competitive-scoreboard summary anchor.
//
// Following the repo's test-first tracer-bullet convention, the owner-aware
// cases were authored **red-phase** with `it.fails` (the collection routed
// every slot to the single HUD anchor) and flipped to plain `it` by the
// implementing child MS-0MW083O38005B22F. The single-player guard stays a
// plain `it` so it keeps protecting owner-0 behaviour through the change.

/** Where the HUD publishes the human seat's coin counter for these cases. */
const COLLECTION_HUD_COIN = { x: 409, y: 50 };
/** Where the competitive scoreboard publishes an AI seat's summary row. */
const COLLECTION_SEAT_ANCHOR = { x: 900, y: 32 };

interface CollectionSlotSpec {
  slotIndex: number;
  /** Presentation-only seat owner; absent for single-player / legacy slots. */
  ownerId?: number;
  /** Coins sitting in the slot's on-card grid (one collected icon each). */
  gridCoins: number;
}

/**
 * A producing slot with a fake on-card coin grid: one icon per grid coin, each
 * reporting a distinct world position, so the collection's flight origins and
 * destinations are observable without any rendering.
 */
function makeCollectionSlot(spec: CollectionSlotSpec): IncomePhaseSlot {
  const icons = Array.from({ length: spec.gridCoins }, (_, i) => {
    const icon = {
      getWorldTransformMatrix: () => ({
        getX: () => spec.slotIndex * 160 + i,
        getY: () => 140,
      }),
      setPosition: () => icon,
      setDepth: () => icon,
      destroy: vi.fn(),
    };
    return icon;
  });
  const container = {
    list: icons as unknown[],
    remove: vi.fn((icon: unknown) => {
      const idx = icons.indexOf(icon as (typeof icons)[number]);
      if (idx >= 0) icons.splice(idx, 1);
    }),
    destroy: vi.fn(),
  };
  // `ownerId` is presentation-only owner identity (added to both the phase
  // breakdown and the animator slot by MS-0MW083KRZ009NJTA); read through
  // `unknown` so this suite compiles while that child is still landing.
  const pd = {
    slotIndex: spec.slotIndex,
    businessName: `Biz ${spec.slotIndex}`,
    baseIncome: spec.gridCoins * 100,
    synergyBonus: 0,
    repBonus: 0,
    eventDeltas: [],
    upcomingDeltas: [],
    ownerId: spec.ownerId,
  } as unknown as SlotPhaseBreakdown;
  return {
    pd,
    card: {} as never,
    handle: {
      addCoins: vi.fn(() => ({ placements: [], iconCount: 0 })),
      clear: vi.fn(),
      getLayout: vi.fn(() => null),
      container,
    } as never,
    displayed: spec.gridCoins,
    ownerId: spec.ownerId,
  } as unknown as IncomePhaseSlot;
}

/** Runs the collection and completes every scheduled flight. */
function runCollection(
  animator: MainStreetAnimator,
  slots: IncomePhaseSlot[],
  scheduled: ScheduledCall[],
): void {
  animator.collectIncomeGrids(slots, {
    reducedMotion: false,
    creditedTotal: slots.reduce((sum, sl) => sum + sl.pd.baseIncome, 0),
  });
  completeAllFlights(scheduled);
}

/** A flight destination in the shape `moveGameObject` receives. */
function dest(target: { x: number; y: number }): { destX: number; destY: number } {
  return { destX: target.x, destY: target.y };
}

/** Flight destinations in launch order, one per collected grid coin. */
function collectionDestinations(): Array<{ destX: number; destY: number }> {
  return moveGameObject.mock.calls.map((c) => {
    const opts = c[0] as { destX: number; destY: number };
    return { destX: opts.destX, destY: opts.destY };
  });
}

describe('MainStreetAnimator.collectIncomeGrids owner-aware routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps a legacy slot without an ownerId on the HUD coin anchor (single-player unchanged)', () => {
    const { scene, scheduled } = createMockScene({
      hudCoinAnchor: COLLECTION_HUD_COIN,
      hudRepAnchor: { x: 777, y: 50 },
      // No per-seat anchors: single-player has no scoreboard.
      hudSeatAnchors: null,
    });
    const animator = new MainStreetAnimator(scene);

    runCollection(animator, [makeCollectionSlot({ slotIndex: 0, gridCoins: 1 })], scheduled);

    expect(collectionDestinations()).toEqual([dest(COLLECTION_HUD_COIN)]);
  });

  it("routes an AI-owned slot's grid coins to that seat's anchor, not the human HUD", () => {
    const { scene, scheduled } = createMockScene({
      hudCoinAnchor: COLLECTION_HUD_COIN,
      hudRepAnchor: { x: 777, y: 50 },
      hudSeatAnchors: { 1: COLLECTION_SEAT_ANCHOR },
    });
    const animator = new MainStreetAnimator(scene);

    const human = makeCollectionSlot({ slotIndex: 0, ownerId: 0, gridCoins: 1 });
    const ai = makeCollectionSlot({ slotIndex: 1, ownerId: 1, gridCoins: 1 });

    runCollection(animator, [human, ai], scheduled);

    // Slot order is preserved: the human's coin lands on the HUD counter, the
    // AI seat's coin lands on its own summary row.
    expect(collectionDestinations()).toEqual([
      dest(COLLECTION_HUD_COIN),
      dest(COLLECTION_SEAT_ANCHOR),
    ]);
  });

  it('falls back to the deterministic seat cell for an AI slot before the scoreboard publishes anchors', () => {
    const fallbackCoin = { destX: 1280 * 0.25 + 70, destY: 50 };
    const destinations: Array<{ destX: number; destY: number }> = [];

    // Two identical collections must resolve the same seat cell. Each run is
    // measured on its own: `moveGameObject` accumulates across the loop, so the
    // recorded calls are cleared before each collection (otherwise the second
    // pass would also re-count the first run's flight).
    for (let run = 0; run < 2; run++) {
      vi.clearAllMocks();
      const { scene, scheduled } = createMockScene({
        hudCoinAnchor: COLLECTION_HUD_COIN,
        hudRepAnchor: { x: 777, y: 50 },
        hudSeatAnchors: null,
      });
      const animator = new MainStreetAnimator(scene);
      runCollection(
        animator,
        [makeCollectionSlot({ slotIndex: 1, ownerId: 1, gridCoins: 1 })],
        scheduled,
      );
      destinations.push(...collectionDestinations());
    }

    expect(destinations).toHaveLength(2);
    // Deterministic per seat, never the human HUD counter or its fallback.
    expect(destinations[1]).toEqual(destinations[0]);
    expect(destinations[0]).not.toEqual(dest(COLLECTION_HUD_COIN));
    expect(destinations[0]).not.toEqual(fallbackCoin);
    // ...and it stays on/above the HUD baseline like every other HUD flight.
    expect(destinations[0].destY).toBeLessThanOrEqual(50);
  });
});

// ── Human-only "+total" landing feedback (MS-0MW083IXO002Q8K3) ──────────────
//
// Test-first contract for the parent's AC4 / AC5 (parent MS-0MVWNS9L7007CTK9):
// the collection's landing pop is per-owner feedback, not one combined total at
// the human counter. The human seat (owner `0`, and every legacy / single-player
// slot with no owner at all) keeps the HUD coin anchor and pops that seat's own
// credited total; an AI seat (`ownerId >= 1`) pops at its own competitive
// scoreboard anchor — or is suppressed — and the combined multi-seat total is
// never shown at the human counter.
//
// ## Red phase (flipped)
//
// The per-owner cases were authored **red-phase** with `it.fails` (repo
// test-first tracer-bullet convention — see the sibling item
// MS-0MW083E5H009ACB4 above): the collection popped one combined total at the
// single HUD anchor. The implementing child MS-0MW083PZ8001QEHS flipped them to
// plain `it`; leaving them as `it.fails` afterwards is itself a failure, so
// this suite cannot go stale. The single-player case was always a plain `it` so
// the unchanged owner-0 contract keeps being protected.

/** The human seat's published coin counter for these cases. */
const TOTAL_POP_HUD_COIN = { x: 409, y: 50 };
/** The AI seat's published competitive-scoreboard summary row. */
const TOTAL_POP_AI_SEAT = { x: 900, y: 32 };

/** The "+..." texts created by a collection, in creation order. */
function plusTexts(
  created: Array<{ x: number; y: number; label: string }>,
): Array<{ x: number; y: number; label: string }> {
  return created.filter((text) => text.label.startsWith('+'));
}

describe('MainStreetAnimator.collectIncomeGrids human-only "+total" pop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pops the landed total at the HUD coin anchor for a legacy / human-only collection', () => {
    const { scene, scheduled, createdTexts } = createMockScene({
      hudCoinAnchor: TOTAL_POP_HUD_COIN,
      hudRepAnchor: { x: 777, y: 50 },
      hudSeatAnchors: null,
    });
    const animator = new MainStreetAnimator(scene);

    runCollection(animator, [makeCollectionSlot({ slotIndex: 0, gridCoins: 3 })], scheduled);

    const pops = plusTexts(createdTexts);
    expect(pops.map((text) => text.label)).toEqual(['+300']);
    expect(pops[0].x).toBe(TOTAL_POP_HUD_COIN.x);
  });

  it('pops each seat\'s own total — never one combined total at the human counter ', () => {
    const { scene, scheduled, createdTexts } = createMockScene({
      hudCoinAnchor: TOTAL_POP_HUD_COIN,
      hudRepAnchor: { x: 777, y: 50 },
      hudSeatAnchors: { 1: TOTAL_POP_AI_SEAT },
    });
    const animator = new MainStreetAnimator(scene);

    // Human seat: 3 collected icons (300). AI seat: 5 collected icons (500).
    // The combined sweep credits 800 — the human counter must never see it.
    runCollection(
      animator,
      [
        makeCollectionSlot({ slotIndex: 0, ownerId: 0, gridCoins: 3 }),
        makeCollectionSlot({ slotIndex: 1, ownerId: 1, gridCoins: 5 }),
      ],
      scheduled,
    );

    const pops = plusTexts(createdTexts);
    // The human counter pops the human seat's own credited total, exactly once.
    expect(
      pops.filter((text) => text.x === TOTAL_POP_HUD_COIN.x).map((text) => text.label),
    ).toEqual(['+300']);
    // Never the combined multi-seat total, anywhere.
    expect(pops.some((text) => text.label === '+800')).toBe(false);
    // Any AI landing pop sits on that seat's own anchor with that seat's total
    // (or is suppressed — an absent AI pop is equally acceptable).
    for (const pop of pops.filter((text) => text.x !== TOTAL_POP_HUD_COIN.x)) {
      expect(pop.x).toBe(TOTAL_POP_AI_SEAT.x);
      expect(pop.label).toBe('+500');
    }
  });

  it('emits no landing pop at the human counter when only AI seats produced income ', () => {
    const { scene, scheduled, createdTexts } = createMockScene({
      hudCoinAnchor: TOTAL_POP_HUD_COIN,
      hudRepAnchor: { x: 777, y: 50 },
      hudSeatAnchors: { 1: TOTAL_POP_AI_SEAT },
    });
    const animator = new MainStreetAnimator(scene);

    runCollection(
      animator,
      [makeCollectionSlot({ slotIndex: 1, ownerId: 1, gridCoins: 4 })],
      scheduled,
    );

    expect(
      plusTexts(createdTexts).filter((text) => text.x === TOTAL_POP_HUD_COIN.x),
    ).toHaveLength(0);
  });
});
