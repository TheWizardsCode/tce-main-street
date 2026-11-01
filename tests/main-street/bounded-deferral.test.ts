/**
 * Main Street: wall-clock bounded deferral contract
 *
 * MS-0MVMKEU2000639TG (decision C — make the income-collection cap
 * starvation-proof). The end-of-turn deferral waits on the scene's
 * `incomeCollectionActive` flag before advancing the day, bounded by
 * {@link INCOME_COLLECTION_CAP_MS}. Historically that bound was only
 * *observed* at scene-clock poll boundaries, and Phaser's `TimeStep` clamps
 * each frame's delta to `1000 / fps.min` (200 ms by default) — so under
 * rAF starvation (≈2× CPU oversubscription) both the choreography and the
 * 250 ms re-polls run at a fraction of wall-clock speed and the cap was
 * detected late. A stall bound that is only observed at frame boundaries is
 * not a stall bound.
 *
 * These tests pin the contract that fixes that:
 *
 *  1. the deadline is *wall clock* (`Date.now`), not the scene clock;
 *  2. the enforcing re-poll is a *wall timer* (`setTimeout`), so the advance
 *     is forced even while the page paints nothing (backgrounded/hidden tab);
 *  3. both are injectable, so the behaviour is driven deterministically here
 *     and by the existing fake-scene-clock suites;
 *  4. a scene with no clock degrades to an immediate continuation, preserving
 *     `scheduleOrRun`'s headless semantics;
 *  5. a stale wall timer never fires into a destroyed scene.
 *
 * @module tests/main-street/bounded-deferral
 */

import { describe, expect, it, vi } from 'vitest';

import { INCOME_COLLECTION_CAP_MS } from '../../src/scenes/MainStreetAnimatorTiming';
import { deferUntilIncomeCollected } from '../../src/scenes/MainStreetTurnControllerAnimation';

/** A wall clock whose reading only moves when the test moves it. */
function makeFakeWallClock() {
  let now = 1_000;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

/**
 * A wall-timer stub collecting `(cb, delayMs)` registrations so a test can
 * fire them explicitly. Mirrors `setTimeout`'s handle contract without
 * keeping the process alive.
 */
function makeFakeWallTimer() {
  const pending = new Map<number, { cb: () => void; delayMs: number }>();
  let nextHandle = 1;
  return {
    schedule(cb: () => void, delayMs: number) {
      const handle = nextHandle++;
      pending.set(handle, { cb, delayMs });
      return handle;
    },
    clear(handle: unknown) {
      pending.delete(handle as number);
    },
    /** Fire every registered callback (a starved host eventually wakes). */
    fireAll() {
      const entries = [...pending.entries()];
      pending.clear();
      for (const [, { cb }] of entries) cb();
    },
    get size() {
      return pending.size;
    },
    delays: () => [...pending.values()].map((entry) => entry.delayMs),
  };
}

/**
 * A scene whose *scene* clock is frozen: `delayedCall` registers the callback
 * but never advances `time.now`, exactly as Phaser does when no frame runs.
 * Any implementation that keys its deadline off the scene clock therefore
 * never expires in this scene — only a wall-clock deadline can.
 */
function makeFrozenSceneClockScene(overrides: Record<string, unknown> = {}) {
  const scheduled: Array<() => void> = [];
  const scene: any = {
    incomeCollectionActive: true,
    time: {
      now: 0,
      delayedCall: (_ms: number, cb: () => void) => {
        scheduled.push(cb);
      },
    },
    ...overrides,
  };
  return { scene, scheduled };
}

describe('deferUntilIncomeCollected — wall-clock enforcement', () => {
  it('forces the continuation within one poll interval of the cap on a frozen scene clock', () => {
    const wall = makeFakeWallClock();
    const timer = makeFakeWallTimer();
    const { scene } = makeFrozenSceneClockScene();
    let completed = 0;

    deferUntilIncomeCollected(scene, () => { completed += 1; }, {
      now: wall.now,
      schedule: timer.schedule,
      clear: timer.clear,
    });

    // The choreography is still collecting, and no frame is painting — the
    // scene clock never advances, so nothing may complete yet.
    expect(completed).toBe(0);

    // One poll interval short of the cap: still waiting.
    timer.fireAll();
    expect(completed).toBe(0);

    // The cap elapses on the *wall* clock.
    wall.advance(INCOME_COLLECTION_CAP_MS);
    timer.fireAll();

    // Forced exactly once, and the deferral flag is cleared so the next day
    // can start with a clean slate.
    expect(completed).toBe(1);
    expect(scene.incomeCollectionActive).toBe(false);
  });

  it('arms the enforcing re-poll as a wall timer of at most the cap', () => {
    const wall = makeFakeWallClock();
    const timer = makeFakeWallTimer();
    const { scene } = makeFrozenSceneClockScene();

    deferUntilIncomeCollected(scene, () => {}, {
      now: wall.now,
      schedule: timer.schedule,
      clear: timer.clear,
    });

    // A wall timer exists even though no animation frame will ever run, and
    // it is bounded by the production cap (never an unbounded wait).
    expect(timer.size).toBeGreaterThan(0);
    expect(Math.max(...timer.delays())).toBeLessThanOrEqual(INCOME_COLLECTION_CAP_MS);
  });

  it('completes as soon as the choreography clears the flag, before the cap', () => {
    const wall = makeFakeWallClock();
    const timer = makeFakeWallTimer();
    const { scene, scheduled } = makeFrozenSceneClockScene();
    let completed = 0;

    deferUntilIncomeCollected(scene, () => { completed += 1; }, {
      now: wall.now,
      schedule: timer.schedule,
      clear: timer.clear,
    });

    expect(completed).toBe(0);

    // The choreography finishes normally: the next scene-clock poll observes
    // the cleared flag and advances without waiting for the cap.
    scene.incomeCollectionActive = false;
    while (scheduled.length > 0) scheduled.shift()!();

    expect(completed).toBe(1);
    // Fast path must not leave the wall watchdog armed.
    expect(timer.size).toBe(0);
  });

  it('never completes twice when both the poll and the wall watchdog observe the cap', () => {
    const wall = makeFakeWallClock();
    const timer = makeFakeWallTimer();
    const { scene, scheduled } = makeFrozenSceneClockScene();
    let completed = 0;

    deferUntilIncomeCollected(scene, () => { completed += 1; }, {
      now: wall.now,
      schedule: timer.schedule,
      clear: timer.clear,
    });

    wall.advance(INCOME_COLLECTION_CAP_MS);
    timer.fireAll();                                   // wall watchdog forces
    while (scheduled.length > 0) scheduled.shift()!(); // stale scene poll runs

    expect(completed).toBe(1);
  });
});

describe('deferUntilIncomeCollected — degradation and safety', () => {
  it('runs the continuation immediately when the scene has no clock (headless)', () => {
    const scene: any = { incomeCollectionActive: true, time: undefined };
    let completed = 0;

    deferUntilIncomeCollected(scene, () => { completed += 1; });

    // Parity with `scheduleOrRun`: a clock-less scene cannot defer, so it
    // proceeds at once and the flag is cleared for the next turn.
    expect(completed).toBe(1);
    expect(scene.incomeCollectionActive).toBe(false);
  });

  it('does not fire a stale wall timer into a destroyed scene', () => {
    const wall = makeFakeWallClock();
    const timer = makeFakeWallTimer();
    const { scene } = makeFrozenSceneClockScene({
      isActive: () => false, // scene shut down between arming and firing
    });
    let completed = 0;

    deferUntilIncomeCollected(scene, () => { completed += 1; }, {
      now: wall.now,
      schedule: timer.schedule,
      clear: timer.clear,
    });

    wall.advance(INCOME_COLLECTION_CAP_MS);
    expect(() => timer.fireAll()).not.toThrow();
    expect(completed).toBe(0);
  });

  it('swallows a throwing continuation instead of stalling the turn', () => {
    const wall = makeFakeWallClock();
    const timer = makeFakeWallTimer();
    const { scene } = makeFrozenSceneClockScene();

    deferUntilIncomeCollected(scene, () => { throw new Error('boom'); }, {
      now: wall.now,
      schedule: timer.schedule,
      clear: timer.clear,
    });

    wall.advance(INCOME_COLLECTION_CAP_MS);
    expect(() => timer.fireAll()).not.toThrow();
    expect(scene.incomeCollectionActive).toBe(false);
  });
});

describe('deferUntilIncomeCollected — scene-clock poll cadence', () => {
  it('keeps re-polling on the scene clock while the choreography is collecting', () => {
    const wall = makeFakeWallClock();
    const timer = makeFakeWallTimer();
    const { scene, scheduled } = makeFrozenSceneClockScene();
    const delayedCall = vi.fn((ms: number, cb: () => void) => {
      scene.time.now += ms;
      scheduled.push(cb);
    });
    scene.time.delayedCall = delayedCall;

    deferUntilIncomeCollected(scene, () => {}, {
      now: wall.now,
      schedule: timer.schedule,
      clear: timer.clear,
    });

    // The first poll ran synchronously, found the flag set, and re-armed on
    // the scene clock — so the shipped pacing (and the existing fake-clock
    // suites) behave exactly as before.
    expect(delayedCall).toHaveBeenCalled();
    expect(scene.time.now).toBeGreaterThan(0);
  });
});
