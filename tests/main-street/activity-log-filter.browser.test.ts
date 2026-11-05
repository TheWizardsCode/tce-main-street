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
import { afterEach, describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';

import {
  bootActivityLogScene,
  waitFrames,
  waitForCondition,
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
    // `'all'` and reset on scene creation (MS-0MW3PFRV6003LJLD), and the
    // filter-control row renders beneath the title bar in competitive mode
    // (MS-0MW3PFSMB002EIY6).
    expect(handle.logFilter()).toBe('all');
    expect(handle.hasFilterControlRow()).toBe(true);
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

/**
 * Activity Log filter controls (MS-0MW3PFSMB002EIY6): the compact All / You / AI
 * control row rendered beneath the 22 px title bar in competitive mode, built
 * with the shared `createActionButton` helper. Covers the acceptance criteria:
 * present in competitive / hidden in single-player + tutorial, mutually
 * exclusive with the active control visually distinguishable beyond colour,
 * click wiring through `renderer.refreshLog()` (active click is a no-op),
 * layout inside the panel, and clean destroy/rebuild across scene restart.
 */
describe('Activity Log filter controls (MS-0MW3PFSMB002EIY6)', () => {
  let handle: ActivityLogSceneHandle | null = null;

  afterEach(() => {
    handle?.destroy();
    handle = null;
  });

  /** Resolves the rendered button (container + Rectangle bg + Text label) for `label`. */
  function filterControl(scene: any, label: 'All' | 'You' | 'AI'): {
    button: Phaser.GameObjects.Container;
    bg: any;
    text: any;
  } {
    const row = scene.logFilterRow as Phaser.GameObjects.Container | undefined;
    expect(row, 'logFilterRow container').toBeTruthy();
    const button = row!.list.find(
      (c: any) =>
        c.type === 'Container' &&
        Array.isArray(c.list) &&
        c.list.some((k: any) => k.type === 'Text' && k.text === label),
    ) as Phaser.GameObjects.Container | undefined;
    expect(button, `filter button "${label}"`).toBeTruthy();
    const bg = button!.list.find((c: any) => c.type === 'Rectangle');
    const text = button!.list.find((c: any) => c.type === 'Text');
    expect(bg, `filter button "${label}" background`).toBeTruthy();
    expect(text, `filter button "${label}" label`).toBeTruthy();
    return { button: button!, bg, text };
  }

  /** Seeds a deterministic three-class log (shared header, shared, human, AI). */
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

  it('renders three mutually exclusive controls in competitive mode with All active by default', async () => {
    handle = await bootActivityLogScene({ mode: 'competitive' });
    const scene = handle.scene;

    expect(handle.hasFilterControlRow()).toBe(true);
    const row = scene.logFilterRow as Phaser.GameObjects.Container;
    const buttons = row.list.filter((c: any) => c.type === 'Container');
    expect(buttons).toHaveLength(3);
    for (const label of ['All', 'You', 'AI'] as const) {
      expect(filterControl(scene, label).text.text).toBe(label);
    }

    // Default active = All; treatment differs beyond colour alone (fill
    // alpha, stroke weight and label weight/brightness are all distinct).
    const active = filterControl(scene, 'All');
    const inactive = filterControl(scene, 'You');
    expect(active.bg.fillAlpha).toBe(1);
    expect(active.bg.lineWidth).toBe(2);
    expect(String(active.text.style.fontStyle)).toBe('bold');
    expect(String(inactive.bg.fillAlpha)).not.toBe(String(active.bg.fillAlpha));
    expect(inactive.bg.fillAlpha).toBeLessThan(active.bg.fillAlpha);
    expect(inactive.bg.lineWidth).toBe(1);
    expect(inactive.bg.lineWidth).toBeLessThan(active.bg.lineWidth);
    expect(String(inactive.text.style.fontStyle)).not.toBe('bold');
    expect(String(inactive.text.style.color)).not.toBe(String(active.text.style.color));

    // You and AI share the inactive treatment.
    const ai = filterControl(scene, 'AI');
    expect(ai.bg.fillAlpha).toBeLessThan(active.bg.fillAlpha);
    expect(ai.bg.lineWidth).toBe(1);
  }, 60_000);

  it('keeps the row inside the ~300 x 218 panel bounds, beneath the title bar', async () => {
    handle = await bootActivityLogScene({ mode: 'competitive' });
    const scene = handle.scene;
    const { LOG_FILTER_ROW_H, LOG_TITLE_H } = await import('../../src/scenes/MainStreetConstants');
    const layout = scene.layout;

    const row = scene.logFilterRow as Phaser.GameObjects.Container;
    for (const button of row.list.filter((c: any) => c.type === 'Container')) {
      const bg = button.list.find((k: any) => k.type === 'Rectangle');
      const left = button.x - bg.displayWidth / 2;
      const right = button.x + bg.displayWidth / 2;
      const top = button.y - bg.displayHeight / 2;
      const bottom = button.y + bg.displayHeight / 2;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(layout.logW);
      expect(top).toBeGreaterThanOrEqual(LOG_TITLE_H);
      expect(bottom).toBeLessThanOrEqual(LOG_TITLE_H + LOG_FILTER_ROW_H);
    }
  }, 60_000);

  it('keeps the newest entry visible below the filter row (auto-scrolled to the reserved area)', async () => {
    handle = await bootActivityLogScene({ mode: 'competitive' });
    const scene = handle.scene;
    const { LOG_FILTER_ROW_H, LOG_TITLE_H } = await import('../../src/scenes/MainStreetConstants');
    const { addLog } = await import('../../src/MainStreetState');

    for (let i = 0; i < 40; i++) addLog(scene.state, 1, `AI filler ${i}`, 'neutral');
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const visibleH = Math.max(1, scene.layout.logH - LOG_TITLE_H - LOG_FILTER_ROW_H - 4);
    expect(scene.logTotalContentH).toBeGreaterThan(visibleH); // log overflows
    expect(scene.logMaxScroll).toBe(scene.logTotalContentH - visibleH);
    expect(scene.logScrollOffset).toBe(scene.logMaxScroll); // auto-scrolled to bottom

    // The newest (bottom-most) rendered entry sits inside the visible window,
    // which is fully below the filter row band — never hidden or clipped by it.
    const content = scene.logContentContainer.list as any[];
    const lastLocalY = Math.max(...content.map((c) => c.y));
    expect(lastLocalY).toBeGreaterThanOrEqual(scene.logScrollOffset);
    expect(lastLocalY).toBeLessThan(scene.logScrollOffset + visibleH);
    expect(scene.logContentContainer.y + lastLocalY).toBeGreaterThanOrEqual(
      LOG_TITLE_H + LOG_FILTER_ROW_H,
    );
  }, 60_000);

  it('clicking You / AI / All sets logFilter, re-renders the log and repaints the active control', async () => {
    const scene = await seedThreeClassLog();

    // Click [ You ]: human + shared entries stay, the AI entry disappears.
    filterControl(scene, 'You').bg.emit('pointerdown');
    await waitFrames(3);
    expect(scene.logFilter).toBe('human');
    let texts = handle!.renderedTexts();
    expect(texts).toContain('Turn 1');
    expect(texts).toContain('Shared world event');
    expect(texts).toContain('You ');
    expect(texts).toContain('Human move');
    expect(texts).not.toContain('AI 1 ');
    expect(texts).not.toContain('AI move');
    expect(filterControl(scene, 'You').bg.lineWidth).toBe(2); // now active
    expect(filterControl(scene, 'All').bg.lineWidth).toBe(1); // demoted

    // Click [ AI ]: the AI entry + shared stay, the human entry disappears.
    filterControl(scene, 'AI').bg.emit('pointerdown');
    await waitFrames(3);
    expect(scene.logFilter).toBe('ai');
    texts = handle!.renderedTexts();
    expect(texts).toContain('AI 1 ');
    expect(texts).toContain('AI move');
    expect(texts).not.toContain('You ');
    expect(texts).not.toContain('Human move');
    expect(filterControl(scene, 'AI').bg.lineWidth).toBe(2);
    expect(filterControl(scene, 'You').bg.lineWidth).toBe(1);

    // Click [ All ]: the full set is restored, no entry lost or duplicated.
    filterControl(scene, 'All').bg.emit('pointerdown');
    await waitFrames(3);
    expect(scene.logFilter).toBe('all');
    texts = handle!.renderedTexts();
    for (const body of ['Shared world event', 'Human move', 'AI move']) {
      expect(texts.filter((t) => t === body)).toHaveLength(1);
    }
    expect(filterControl(scene, 'All').bg.lineWidth).toBe(2);
  }, 60_000);

  it('clicking the active control is a no-op: no state mutation, no re-render', async () => {
    const scene = await seedThreeClassLog();
    const spy = vi.spyOn(scene.msRenderer, 'refreshLog');
    const before = JSON.stringify(scene.state.activityLog);
    const renderedBefore = handle!.renderedTexts();

    // All is the default active filter — clicking it must do nothing.
    filterControl(scene, 'All').bg.emit('pointerdown');
    expect(scene.logFilter).toBe('all');
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(scene.state.activityLog)).toBe(before);
    expect(handle!.renderedTexts()).toEqual(renderedBefore);

    // Switch to You, then click You again — the second click is a no-op.
    filterControl(scene, 'You').bg.emit('pointerdown');
    await waitFrames(3);
    expect(scene.logFilter).toBe('human');
    expect(spy).toHaveBeenCalledTimes(1);

    filterControl(scene, 'You').bg.emit('pointerdown');
    await waitFrames(3);
    expect(scene.logFilter).toBe('human');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(scene.state.activityLog)).toBe(before);
  }, 60_000);

  it('hides the row in single-player and reacts to a tutorial-like no-roster state', async () => {
    handle = await bootActivityLogScene({ mode: 'single-player' });
    const scene = handle.scene;

    // Single-player: the row container exists (built in createContainers) but
    // is hidden — no filter distinction exists without a roster.
    expect(handle.hasFilterControlRow()).toBe(false);
    expect((scene.logFilterRow as Phaser.GameObjects.Container).visible).toBe(false);

    // The hidden row consumes no vertical log space: nine short shared entries
    // fit the full (row-less) visible window. If the row wrongly reserved
    // LOG_FILTER_ROW_H here, the same nine entries would overflow and
    // auto-scroll (maxScroll > 0).
    const { addLogShared } = await import('../../src/MainStreetState');
    scene.state.activityLog.length = 0;
    for (let i = 0; i < 9; i++) addLogShared(scene.state, `Shared line ${i}`, 'neutral');
    scene.msRenderer.refreshLog();
    await waitFrames(3);
    expect(scene.logMaxScroll).toBe(0);

    // Tutorial runs through the same no-roster state path: swap in a fresh
    // single-player state (as createTutorialScenario does) and refresh — the
    // row stays hidden and the log renders unchanged.
    const { setupMainStreetGame } = await import('../../src/MainStreetState');
    scene.state = setupMainStreetGame({ seed: 'tutorial-like-filter-controls' });
    scene.msRenderer.refreshLog();
    await waitFrames(3);
    expect((scene.logFilterRow as Phaser.GameObjects.Container).visible).toBe(false);
    expect(handle.hasFilterControlRow()).toBe(false);
  }, 60_000);

  it('keeps the selection across a UI refresh and resets to All on scene restart without leaking rows', async () => {
    // Skip the tutorial-offer boot modal so the restart path is deterministic
    // (the reference New-Game selector restart test uses the same seed).
    try {
      (window as any).localStorage?.setItem(
        'tce-main-street-tutorial-state',
        JSON.stringify({
          schemaVersion: 1,
          status: 'skipped',
          completedAt: null,
          lastStepId: null,
          bankingHintShownAt: null,
        }),
      );
    } catch (_) { /* ignore in constrained environments */ }

    const scene = await seedThreeClassLog();

    // Select AI…
    filterControl(scene, 'AI').bg.emit('pointerdown');
    await waitFrames(3);
    expect(scene.logFilter).toBe('ai');

    // …and verify it survives a turn-end / UI refresh within the session.
    scene.msRenderer.refreshAll();
    await waitFrames(5);
    expect(scene.logFilter).toBe('ai');
    expect(filterControl(scene, 'AI').bg.lineWidth).toBe(2);

    // Scene restart (the game-over "Play Again" path): the row is rebuilt
    // fresh (no duplicates, no orphaned buttons) and the filter resets to All.
    scene.scene.restart();
    await waitForCondition(() => (scene as any).newGameSelectionMade === false, 20_000);
    scene.msLifecycleManager.applyNewGameSelection({
      mode: 'competitive',
      opponents: [{ strategy: 'Greedy', difficulty: 'Medium' }],
    });
    await waitForCondition(() => (scene.state?.players?.length ?? 0) === 2, 20_000);
    await waitFrames(10);

    expect(scene.logFilter).toBe('all');
    const rows = (scene.logContainer.list as Phaser.GameObjects.GameObject[]).filter(
      (c: any) => c.name === 'logFilterRow',
    );
    expect(rows).toHaveLength(1);
    const row = rows[0] as Phaser.GameObjects.Container;
    expect(row.list.filter((c: any) => c.type === 'Container')).toHaveLength(3);
    expect(handle.hasFilterControlRow()).toBe(true);
    // The newly rebuilt row is a live, interactive object (not a stale ref).
    expect(filterControl(scene, 'All').bg.fillAlpha).toBe(1);
  }, 60_000);
});
