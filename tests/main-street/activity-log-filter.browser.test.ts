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

    // The filter seam is now live: the scene carries `logFilter` defaulting to
    // `'all'` and reset on scene creation (MS-0MW3PFRV6003LJLD), while the
    // filter-control row itself is still the separate controls child
    // (MS-0MW3PFSMB002EIY6), so the row reads as absent.
    expect(handle.logFilter()).toBe('all');
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

/**
 * Filtered Activity Log rendering (MS-0MW3PFRV6003LJLD): selecting a filter
 * re-renders the log through the pure predicate without mutating
 * `state.activityLog`, keeps shared/turn-level entries visible, shows a clear
 * empty-state line, and recomputes scroll bounds from the rendered entries
 * only. Tests set `scene.logFilter` directly (the controls row is the separate
 * child MS-0MW3PFSMB002EIY6).
 */
describe('Filtered Activity Log rendering (MS-0MW3PFRV6003LJLD)', () => {
  let handle: ActivityLogSceneHandle | null = null;

  afterEach(() => {
    handle?.destroy();
    handle = null;
  });

  /**
   * Replaces the boot-time log with a deterministic three-class sample:
   * a shared turn header, a shared line, a human ("You", seat 0) action and
   * an AI ("AI 1", seat 1) action, then re-renders under the current filter.
   */
  async function seedThreeClassLog() {
    handle = await bootActivityLogScene({ mode: 'competitive' });
    const scene = handle.scene;
    const { addLog, addLogShared } = await import('../../src/MainStreetState');
    scene.state.activityLog.length = 0;
    addLogShared(scene.state, 'Turn 1', 'turn-header');
    addLogShared(scene.state, 'Shared world event', 'neutral');
    addLog(scene.state, 0, 'Human move', 'gain');
    addLog(scene.state, 1, 'AI move', 'neutral');
    scene.msRenderer.refreshLog();
    await waitFrames(3);
    return scene;
  }

  it('renders exactly the expected entries per filter (You / AI / shared) without mutating the log', async () => {
    const scene = await seedThreeClassLog();
    const { serializeMainStreetState } = await import('../../src/MainStreetState');

    // Deep-clone snapshot to assert the render never mutates state.activityLog.
    const before = JSON.parse(JSON.stringify(scene.state.activityLog));
    const saveBefore = JSON.stringify(serializeMainStreetState(scene.state));

    // Default 'all' renders every entry, prefix and body included.
    let texts = handle!.renderedTexts();
    expect(texts).toContain('Turn 1'); // turn header: shared, always visible
    expect(texts).toContain('Shared world event');
    expect(texts).toContain('You ');
    expect(texts).toContain('Human move');
    expect(texts).toContain('AI 1 ');
    expect(texts).toContain('AI move');

    // 'human': the human action + shared stay, the AI action disappears.
    scene.logFilter = 'human';
    scene.msRenderer.refreshLog();
    await waitFrames(3);
    texts = handle!.renderedTexts();
    expect(texts).toContain('Turn 1');
    expect(texts).toContain('Shared world event');
    expect(texts).toContain('You ');
    expect(texts).toContain('Human move');
    expect(texts).not.toContain('AI 1 ');
    expect(texts).not.toContain('AI move');

    // 'ai': the AI action + shared stay, the human action disappears.
    scene.logFilter = 'ai';
    scene.msRenderer.refreshLog();
    await waitFrames(3);
    texts = handle!.renderedTexts();
    expect(texts).toContain('Turn 1');
    expect(texts).toContain('Shared world event');
    expect(texts).toContain('AI 1 ');
    expect(texts).toContain('AI move');
    expect(texts).not.toContain('You ');
    expect(texts).not.toContain('Human move');

    // Back to 'all': the full set is restored — no entry lost or duplicated.
    scene.logFilter = 'all';
    scene.msRenderer.refreshLog();
    await waitFrames(3);
    texts = handle!.renderedTexts();
    for (const body of ['Shared world event', 'Human move', 'AI move']) {
      expect(texts.filter((t) => t === body)).toHaveLength(1);
    }

    // The state log and its serialised form are untouched by filtering.
    expect(JSON.stringify(scene.state.activityLog)).toBe(JSON.stringify(before));
    expect(JSON.stringify(serializeMainStreetState(scene.state))).toBe(saveBefore);
  }, 60_000);

  it('shows a clear empty-state line when nothing (not even shared) matches', async () => {
    const scene = await seedThreeClassLog();

    // A log with only human-seat entries under the 'ai' filter matches
    // nothing — shared/turn-level entries are absent, so the empty-state
    // line renders instead of a blank panel.
    const { addLog } = await import('../../src/MainStreetState');
    scene.state.activityLog.length = 0;
    addLog(scene.state, 0, 'Human-only line', 'gain');
    scene.logFilter = 'ai';
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const texts = handle!.renderedTexts();
    expect(texts).toContain('No activity for this filter');
    expect(texts).not.toContain('Human-only line');
    // The empty state is a real rendered line (non-zero content height).
    expect(scene.logTotalContentH).toBeGreaterThan(0);
  }, 60_000);

  it('recomputes content height, scroll bounds and clamping from rendered entries only', async () => {
    const scene = await seedThreeClassLog();
    const { LOG_TITLE_H, LOG_FILTER_ROW_H } = await import('../../src/scenes/MainStreetConstants');
    const { addLog } = await import('../../src/MainStreetState');

    // Competitive → controls row shown → visibleH reserves LOG_FILTER_ROW_H.
    const visibleH = Math.max(1, scene.layout.logH - LOG_TITLE_H - LOG_FILTER_ROW_H - 4);

    // Flood the log with AI-only wrapped lines (tall content), then filter to
    // 'human' so only the human + shared entries remain rendered.
    const longText = 'A long wrapped AI-only line that forces the log content taller'.repeat(3);
    for (let i = 0; i < 40; i++) {
      addLog(scene.state, 1, `${longText} #${i}`, 'neutral');
    }
    scene.msRenderer.refreshLog();
    await waitFrames(3);
    const allHeight = scene.logTotalContentH;
    expect(allHeight).toBeGreaterThan(visibleH); // log overflows under 'all'

    scene.logFilter = 'human';
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // Height and max scroll come from the filtered set only: the single
    // shared line + the human line (both short) fit without scrolling.
    const filteredHeight = scene.logTotalContentH;
    expect(filteredHeight).toBeLessThan(allHeight);
    expect(filteredHeight).toBeLessThanOrEqual(visibleH);
    expect(scene.logMaxScroll).toBe(0);
    expect(scene.logScrollOffset).toBe(0);

    // Auto-scroll / clamping with a taller filtered set: force some AI entries
    // under 'human' by re-adding human entries until overflow, then verify the
    // offset is clamped to the recomputed max (never past it, never yanked).
    scene.logFilter = 'all';
    scene.msRenderer.refreshLog();
    await waitFrames(3);
    scene.logAutoScroll = false;
    const bottom = scene.logMaxScroll;
    scene.logScrollOffset = bottom - 7; // scrolled up slightly
    scene.logFilter = 'ai';
    scene.msRenderer.refreshLog();
    await waitFrames(3);
    expect(scene.logMaxScroll).toBeGreaterThan(0);
    expect(scene.logScrollOffset).toBeGreaterThan(0);
    expect(scene.logScrollOffset).toBeLessThanOrEqual(scene.logMaxScroll);
  }, 60_000);

  it('keeps the reader at the bottom across a filter change when auto-scroll is active', async () => {
    const scene = await seedThreeClassLog();
    const { addLog } = await import('../../src/MainStreetState');
    for (let i = 0; i < 30; i++) addLog(scene.state, 1, `AI filler ${i}`, 'neutral');
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    scene.logAutoScroll = true;
    scene.logScrollOffset = scene.logMaxScroll; // reader is at the bottom
    scene.logFilter = 'human';
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // Human + shared only: everything fits, so the view settles at 0 — the
    // per-filter bottom, never yanked past the new max.
    expect(scene.logMaxScroll).toBe(0);
    expect(scene.logScrollOffset).toBe(0);
  }, 60_000);

  it('defers a filter change made during the deferral window (applies on next render)', async () => {
    const scene = await seedThreeClassLog();

    // Enter the deferral window, switch filter, refresh: nothing re-renders
    // (the pre-filter content stays) and the deferred contract is unbroken.
    scene.logDeferredUntilPhaseComplete = true;
    const prev = handle!.renderedTexts();
    scene.logFilter = 'human';
    scene.msRenderer.refreshLog();
    await waitFrames(3);
    expect(handle!.renderedTexts()).toEqual(prev); // still 'all' content

    // Deferral clears: the pending filter change applies on the next render.
    scene.logDeferredUntilPhaseComplete = false;
    scene.msRenderer.refreshLog();
    await waitFrames(3);
    const texts = handle!.renderedTexts();
    expect(texts).toContain('Human move');
    expect(texts).not.toContain('AI 1 ');
  }, 60_000);

  it('never writes logFilter into serialised save data (round trip)', async () => {
    const scene = await seedThreeClassLog();
    const { serializeMainStreetState, deserializeMainStreetState } = await import('../../src/MainStreetState');

    scene.logFilter = 'human';
    const serialised = serializeMainStreetState(scene.state);
    expect(JSON.stringify(serialised)).not.toContain('logFilter');

    const restored = deserializeMainStreetState(serialised);
    expect((restored as Record<string, unknown>).logFilter).toBeUndefined();
    // The round trip preserves the log entries themselves.
    expect(restored.activityLog.length).toBe(scene.state.activityLog.length);
  }, 60_000);
});
