/**
 * Main Street: Activity Log filter baseline — browser surface (MS-0MW3PFLDP000CF2X)
 *
 * Exercises the shared browser helper (`bootActivityLogScene`) from
 * `helpers/activity-log-harness.ts` and pins the rendered no-prefix /
 * prefixed behaviour that the headless baseline can only approximate at the
 * entry level (the renderer draws a coloured `seatLabel` prefix only when an
 * entry carries `seatLabel && seatColour`).
 *
 * Later filter children extend this file through the same helper — no
 * copy-pasted boot or teardown code.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  bootActivityLogScene,
  waitFrames,
  type ActivityLogSceneHandle,
} from './helpers/activity-log-harness';

/** Seat-prefix text objects look like `"You "` / `"AI 1 "` (trailing space). */
function seatPrefixLines(handle: ActivityLogSceneHandle): string[] {
  return handle.renderedTexts().filter((t) => /^(You|AI \d+) $/.test(t));
}

describe('Activity Log filter baseline — browser harness (MS-0MW3PFLDP000CF2X)', () => {
  let handle: ActivityLogSceneHandle | null = null;

  afterEach(() => {
    handle?.destroy();
    handle = null;
  });

  it('boots a competitive scene and exposes the Activity Log panel state', async () => {
    handle = await bootActivityLogScene({ mode: 'competitive' });
    const scene = handle.scene;

    expect(scene.state.players?.length).toBe(2);
    expect(handle.entryCount()).toBeGreaterThan(0);
    expect(handle.renderedChildren().length).toBeGreaterThan(0);
    expect(handle.renderedTexts()).toContain('Turn 1');

    // The filter seam is exposed but absent today: the predicate and the
    // filter-control row land in later children, which flip these readings.
    expect(handle.logFilter()).toBeUndefined();
    expect(handle.hasFilterControlRow()).toBe(false);
  }, 60_000);

  it('renders a seat prefix only for the attributed entry, never the shared one', async () => {
    handle = await bootActivityLogScene({ mode: 'competitive' });
    const scene = handle.scene;

    const prefixesBefore = seatPrefixLines(handle).length;

    const { addLog, addLogShared } = await import('../../src/MainStreetState');
    addLog(scene.state, 1, 'Seat-attributed action', 'neutral'); // stamped "AI 1"
    // Explicit opt-out: shared / turn-level entries carry no seat fields
    // (MS-0MW3PFQ4L0046Q3K AC4).
    addLogShared(scene.state, 'Shared summary line', 'neutral');
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const texts = handle.renderedTexts();
    expect(texts).toContain('AI 1 ');
    expect(texts).toContain('Seat-attributed action');
    expect(texts).toContain('Shared summary line');

    // Exactly one new prefix appeared — for the seat entry. The shared entry
    // rendered with no prefix.
    expect(seatPrefixLines(handle).length).toBe(prefixesBefore + 1);
  }, 60_000);

  it('renders single-player (no roster) entries with no prefix', async () => {
    handle = await bootActivityLogScene({ mode: 'single-player' });
    const scene = handle.scene;

    const { addLog } = await import('../../src/MainStreetState');
    // The seat-argument overload is a no-op without a roster: the entry is
    // seat-less, so the renderer draws no prefix for it.
    addLog(scene.state, 0, 'Collected income', 'gain');
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const texts = handle.renderedTexts();
    expect(texts).toContain('Collected income');
    expect(seatPrefixLines(handle)).toEqual([]);
  }, 60_000);
});
