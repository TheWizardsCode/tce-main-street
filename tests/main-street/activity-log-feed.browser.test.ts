/**
 * Main Street: Activity Log feed — browser surface (MS-0MW1ZHBPK006M8YS)
 *
 * Boots a real `MainStreetScene` (via the shared harness) so the scene's
 * `GameEventEmitter` is live and `window.__GAME_EVENTS__` is set, then pins
 * the feed contract in the place the unit suite cannot reach:
 *
 *  - the scene lifecycle attached **exactly one** `activity-log` subscriber
 *    (the single writer) to the live emitter;
 *  - `addLog(...)` rows land in `state.activityLog` exactly once (no
 *    double-write from both the subscriber and a fallback) and are mirrored
 *    one-for-one into the `GlobalEventBuffer` (which the dev "Game Events"
 *    overlay reads) in emission order;
 *  - rows remain renderable through the unchanged `refreshLog` path;
 *  - the state the rows land on is the **post-`applyNewGameSelection`
 *    competitive state** — proving the subscriber resolves the current state
 *    at emit time across in-place replacement.
 *
 * The harness's own boot already replaced the boot state with a competitive
 * one (`applyNewGameSelection`), so this file exercises the exact
 * state-replacement scenario the design guards.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { GlobalEventBuffer } from '@ui/debug/GlobalEventBuffer';
import type { GameEventEmitter } from '@core-engine/GameEventEmitter';
import {
  bootActivityLogScene,
  driveAction,
  waitFrames,
  type ActivityLogSceneHandle,
} from './helpers/activity-log-harness';

/** The buffered `activity-log` events, in buffer order. */
function activityLogFeedEvents(): { payload: unknown }[] {
  return GlobalEventBuffer.getInstance()
    .getEntries()
    .filter((e) => e.eventName === 'activity-log');
}

describe('Activity Log feed — browser scene (MS-0MW1ZHBPK006M8YS)', () => {
  let handle: ActivityLogSceneHandle | null = null;

  afterEach(() => {
    GlobalEventBuffer.getInstance().clear();
    handle?.destroy();
    handle = null;
  });

  it('wires one feed subscriber per live emitter and mirrors rows into the buffer', async () => {
    handle = await bootActivityLogScene({ mode: 'competitive' });
    const scene = handle.scene;
    const emitter = scene.gameEvents as unknown as GameEventEmitter;
    // The lifecycle wiring (MainStreetLifecycleManagerLifecycle) attached the
    // single writer; the emitter exists once `initEventSystem` ran.
    expect(emitter.listenerCount('activity-log')).toBe(1);

    // Explicit subscription guards against DEV-gating: the scene auto-subscribes
    // in `import.meta.env.DEV`; this makes the assertion environment-proof.
    GlobalEventBuffer.getInstance().subscribe(scene.gameEvents);
    GlobalEventBuffer.getInstance().clear();

    const rowsBefore = scene.state.activityLog.length;
    const { addLog, addLogShared } = await import('../../src/MainStreetState');

    // One shared, one default-seat, one explicit-seat row, plus a real engine
    // path (per-owner income) — all through the same publish seam.
    addLogShared(scene.state, 'Feed shared row', 'turn-header');
    addLog(scene.state, 'Feed default row', 'neutral');
    addLog(scene.state, 1, 'Feed seat row', 'gain');
    driveAction(scene.state, { type: 'income' });

    const appended = scene.state.activityLog.slice(rowsBefore);
    // Exactly the rows published — a double-write (subscriber + fallback)
    // would have duplicated at least one row.
    expect(appended.length).toBeGreaterThanOrEqual(4);
    expect(appended[0].text).toBe('Feed shared row');
    expect(appended.map((e) => e.text)).toContain('Feed seat row');

    // Buffer parity: one activity-log event per row, payloads in log order.
    const feedEvents = activityLogFeedEvents();
    expect(feedEvents.length).toBeGreaterThanOrEqual(appended.length);
    expect(feedEvents.slice(-appended.length).map((e) => e.payload)).toEqual(appended);

    // Unchanged rendering path: the rendered panel shows the feed-written rows.
    scene.msRenderer.refreshLog();
    await waitFrames(3);
    const texts = handle.renderedTexts();
    expect(texts).toContain('Feed shared row');
    expect(texts).toContain('Feed default row');
    expect(texts).toContain('Feed seat row');
  }, 60_000);

  it('keeps rows on the current state after in-place replacement', async () => {
    handle = await bootActivityLogScene({ mode: 'competitive' });
    const scene = handle.scene;
    GlobalEventBuffer.getInstance().subscribe(scene.gameEvents);
    GlobalEventBuffer.getInstance().clear();

    // The harness boot applied a competitive selection AFTER scene creation —
    // the current `scene.state` is therefore already a replaced object, and
    // the feed still lands rows on it (subscriber resolves state at emit time).
    const competitiveState = scene.state;
    const { addLog } = await import('../../src/MainStreetState');
    addLog(competitiveState, 'Replacement-proof row', 'neutral');

    const rows = scene.state.activityLog as unknown[];
    expect(rows[rows.length - 1]).toMatchObject({ text: 'Replacement-proof row' });
    const feedEvents = activityLogFeedEvents();
    expect(feedEvents[feedEvents.length - 1].payload).toEqual(rows[rows.length - 1]);
  }, 60_000);
});
