/**
 * Main Street: Activity Log Scroll Bounds Tests
 *
 * Verifies that the Activity Log scrollable content area computes
 * correct scroll bounds using actual rendered content heights,
 * accounting for word-wrapped entries.
 *
 * Also carries the Activity Log content regression coverage
 * (MS-0MV14JDUG000E1V6): the log must render non-empty content on scene load
 * and after a completed turn in single-player, tutorial and competitive modes,
 * and must never be left blank by a deferral flag that survived a scene
 * restart. See the `content regression` describe block at the end.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Phaser from 'phaser';
import { waitForScene } from '@core-tests/helpers/waitForScene';
import { executeWeekStart, endTurnHeadless } from '../../src/MainStreetEngine';
import { getEventTemplates } from '../../src/MainStreetCards';

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();
  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: Phaser.CANVAS, parent: 'game-container' });
  await waitForScene(game, 'MainStreetScene');
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

function waitFrames(n: number, fallbackMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let left = n;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const fallback = setTimeout(finish, fallbackMs);

    const tick = () => {
      if (settled) return;
      left -= 1;
      if (left <= 0) {
        clearTimeout(fallback);
        finish();
      } else {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  });
}

/**
 * The rendered Activity Log text strings.
 *
 * A Phaser `Text` game object stores its rendered string in `.text` directly
 * (there is no nested `.text.text`, which is always `undefined`). Filtering to
 * `Text` objects also excludes the `Graphics` turn-header bars, which carry no
 * text.
 */
function renderedLogTexts(scene: any): string[] {
  return (scene.logContentContainer.list as any[])
    .filter((child) => child instanceof Phaser.GameObjects.Text)
    .map((child: any) => child.text as string);
}

/** Poll until `predicate` is true, or reject after `timeoutMs`. */
async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 10_000,
  intervalMs = 100,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
}

describe('MainStreet Activity Log scroll bounds', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('content container is positioned below the title bar', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    const { LOG_TITLE_H } = await import(
      '../../src/scenes/MainStreetConstants'
    );

    // Content container should be positioned at LOG_TITLE_H + 2 (2px gap below title)
    expect(scene.logContentContainer.y).toBe(LOG_TITLE_H + 2);
  });

  it('scroll bounds use actual content height (logTotalContentH - visibleH) for entries with word-wrap', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    const { LOG_TITLE_H } = await import(
      '../../src/scenes/MainStreetConstants'
    );

    const longText = 'This is a very long activity log entry that should word-wrap across multiple lines due to its length exceeding the content width';

    // Add 50 entries with long text to trigger word-wrap
    for (let i = 0; i < 50; i++) {
      scene.state.activityLog.push({
        text: `${longText} #${i}`,
        type: 'neutral',
        turn: 1,
      });
    }

    // Force a re-render — this recomputes logTotalContentH and logMaxScroll
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // logTotalContentH should reflect actual rendered heights, not fixed line height
    expect(scene.logTotalContentH).toBeDefined();
    expect(typeof scene.logTotalContentH).toBe('number');
    expect(scene.logTotalContentH).toBeGreaterThan(0);

    const visibleH = Math.max(1, scene.layout.logH - LOG_TITLE_H - 4);

    // The scroll max should be computed from actual total content height
    // This is the KEY fix: logMaxScroll = logTotalContentH - visibleH
    // instead of the old formula: hiddenCount * LOG_LINE_H (18px)
    const expectedScrollMax = Math.max(0, scene.logTotalContentH - visibleH);
    expect(scene.logMaxScroll).toBeCloseTo(expectedScrollMax, 0);
  });

  it('scroll bounds are larger with word-wrapped entries compared to fixed line height estimate', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    const { LOG_TITLE_H, LOG_LINE_H } = await import(
      '../../src/scenes/MainStreetConstants'
    );

    const longText = 'This is a very long activity log entry that should word-wrap across multiple lines due to its length exceeding the content width';

    // Add entries with long text (word-wrap = tall entries)
    for (let i = 0; i < 50; i++) {
      scene.state.activityLog.push({
        text: `${longText} #${i}`,
        type: 'neutral',
        turn: 1,
      });
    }

    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const visibleH = Math.max(1, scene.layout.logH - LOG_TITLE_H - 4);
    const maxDisplayEntries = Math.max(1, Math.ceil(visibleH / LOG_LINE_H));
    const hiddenCount = Math.max(0, scene.state.activityLog.length - maxDisplayEntries);

    // Old scroll max estimate (using fixed line height)
    const oldScrollMax = hiddenCount * LOG_LINE_H;
    // New scroll max (using actual content height)
    const newScrollMax = scene.logMaxScroll;

    // With word-wrapped entries, new scroll max should be >= old scroll max
    // (since entries are taller than LOG_LINE_H)
    expect(newScrollMax).toBeGreaterThanOrEqual(oldScrollMax);
  });

  it('scroll offset is clamped to valid range when content height decreases', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    // Add many entries, then refresh, then add fewer entries
    for (let i = 0; i < 50; i++) {
      scene.state.activityLog.push({
        text: `Entry ${i}`,
        type: 'neutral',
        turn: 1,
      });
    }

    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // Simulate scroll offset near bottom
    scene.logScrollOffset = scene.logMaxScroll;

    // Now truncate the log (simulates game restart)
    scene.state.activityLog = scene.state.activityLog.slice(0, 3);
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // With only 3 entries, all should fit — scroll max should be 0
    expect(scene.logMaxScroll).toBe(0);
    expect(scene.logScrollOffset).toBe(0);
  });

  it('auto-scroll snaps to bottom when new entries are added at the bottom', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    const { LOG_TITLE_H } = await import(
      '../../src/scenes/MainStreetConstants'
    );

    // Simulate being at the bottom
    scene.logAutoScroll = true;

    // Add new entries
    for (let i = 0; i < 5; i++) {
      scene.state.activityLog.push({
        text: `New entry ${i}`,
        type: 'neutral',
        turn: 1,
      });
    }

    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const visibleH = Math.max(1, scene.layout.logH - LOG_TITLE_H - 4);

    // When auto-scroll is active, logScrollOffset should be at or near the bottom
    if (scene.logTotalContentH > visibleH) {
      expect(scene.logScrollOffset).toBeCloseTo(scene.logMaxScroll, 0);
    } else {
      // If all entries fit, scroll should be at 0
      expect(scene.logScrollOffset).toBe(0);
    }
  });

  it('text objects are correctly parented to logContentContainer', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    // Add a few entries
    for (let i = 0; i < 5; i++) {
      scene.state.activityLog.push({
        text: `Entry ${i}`,
        type: 'neutral',
        turn: 1,
      });
    }
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const textEntries = scene.logContentContainer.list.filter(
      (obj: any) => obj instanceof Phaser.GameObjects.Text,
    );
    expect(textEntries.length).toBeGreaterThan(0);

    // Every text object must have logContentContainer as its parent
    for (const txt of textEntries) {
      expect(txt.parentContainer).toBe(scene.logContentContainer);
    }
  });

  it('graphics objects (bar backgrounds) have correct Y position', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    // Clear any existing log entries and re-render
    scene.state.activityLog.length = 0;
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // Add entries including turn headers (which create Graphics objects)
    scene.state.activityLog.push({
      text: 'Turn 1',
      type: 'turn-header',
      turn: 1,
    });
    scene.state.activityLog.push({
      text: 'Some entry',
      type: 'neutral',
      turn: 1,
    });
    scene.state.activityLog.push({
      text: 'Turn 2',
      type: 'turn-header',
      turn: 2,
    });
    scene.state.activityLog.push({
      text: 'More entries',
      type: 'gain',
      turn: 2,
    });
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const allChildren = scene.logContentContainer.list;
    const graphicsObjs = allChildren.filter(
      (obj: any) => obj instanceof Phaser.GameObjects.Graphics,
    );

    expect(graphicsObjs.length).toBe(2);

    // The first turn header (Turn 1) is at yOff=0
    // The second turn header (Turn 2) follows 'Some entry' so y >= font height
    expect((graphicsObjs[0] as any).y).toBe(0);
    expect((graphicsObjs[1] as any).y).toBeGreaterThan(0);

    // Verify graphics are parented to logContentContainer
    for (const g of graphicsObjs) {
      expect((g as any).parentContainer).toBe(scene.logContentContainer);
    }
  });

  it('mask is applied to the content container', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    // The content container should have a mask that clips scrollable content
    expect(scene.logContentContainer.mask).toBeDefined();
    expect(scene.logContentContainer.mask).toBeTruthy();

    // Verify the mask graphics exists
    expect(scene.logMaskGraphics).toBeDefined();

    // Verify the contentMask was created
    expect(scene.logContentMask).toBeDefined();
  });

  it('per-entry visibility hides entries outside the scrollable window', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(15);

    const { LOG_TITLE_H } = await import(
      '../../src/scenes/MainStreetConstants'
    );

    // Clear existing entries to have a clean starting state
    scene.state.activityLog.length = 0;
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // Add entries that overflow the visible area
    for (let i = 0; i < 100; i++) {
      scene.state.activityLog.push({
        text: `Entry ${i} - some text`,
        type: 'neutral',
        turn: 1,
      });
    }
    scene.msRenderer.refreshLog();
    await waitFrames(5);

    const visibleH = Math.max(1, scene.layout.logH - LOG_TITLE_H - 4);
    const maxVisEntries = Math.ceil(visibleH / 18);

    // ── Phase 1: At scrollOffset = 0 ──
    scene.logScrollOffset = 0;
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const childrenP1 = scene.logContentContainer.list;
    expect(childrenP1.length).toBe(100);

    const visibleCountP1 = childrenP1.filter((c: any) => c.visible).length;
    // At scrollOffset=0, only entries fitting in visibleH should be visible
    expect(visibleCountP1).toBeGreaterThan(0);
    expect(visibleCountP1).toBeLessThanOrEqual(maxVisEntries);

    // All children should have been created (even if not visible)
    const hiddenCountP1 = childrenP1.filter((c: any) => !c.visible).length;
    expect(hiddenCountP1).toBe(100 - visibleCountP1);

    // ── Phase 2: Scroll to the bottom ──
    scene.logScrollOffset = scene.logMaxScroll;
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const childrenP2 = scene.logContentContainer.list;
    const visibleCountP2 = childrenP2.filter((c: any) => c.visible).length;
    const hiddenCountP2 = childrenP2.filter((c: any) => !c.visible).length;

    // At bottom, should still have the same number of visible entries
    expect(visibleCountP2).toBeGreaterThan(0);
    expect(visibleCountP2).toBeLessThanOrEqual(maxVisEntries);
    expect(hiddenCountP2).toBe(100 - visibleCountP2);

    // ── Phase 3: Scroll back to the top ──
    scene.logScrollOffset = 0;
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const childrenP3 = scene.logContentContainer.list;
    const visibleCountP3 = childrenP3.filter((c: any) => c.visible).length;
    expect(visibleCountP3).toBeGreaterThan(0);
    expect(visibleCountP3).toBeLessThanOrEqual(maxVisEntries);

    // Total should be consistent
    const hiddenCountP3 = childrenP3.filter((c: any) => !c.visible).length;
    expect(hiddenCountP3).toBe(100 - visibleCountP3);
  });

  it('mask clips content when scrolled to bottom (coordinate verification)', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(15);

    // Add enough entries to overflow the log
    for (let i = 0; i < 100; i++) {
      scene.state.activityLog.push({
        text: `Entry ${i} - with some wrapping text to ensure overflow`,
        type: 'neutral',
        turn: 1,
      });
    }
    scene.msRenderer.refreshLog();
    await waitFrames(5);

    const { LOG_TITLE_H } = await import(
      '../../src/scenes/MainStreetConstants'
    );

    // Simulate being at the bottom of the log
    scene.logScrollOffset = scene.logMaxScroll;
    scene.msRenderer.refreshLog();
    await waitFrames(5);

    // Container should have shifted up by logMaxScroll
    expect(scene.logContentContainer.y).toBeLessThan(LOG_TITLE_H + 2);

    // The container should be at LOG_TITLE_H + 2 - logMaxScroll
    const expectedY = LOG_TITLE_H + 2 - scene.logMaxScroll;
    expect(scene.logContentContainer.y).toBeCloseTo(expectedY, 0);

    // The MASK geometry should cover from logY + LOG_TITLE_H downward.
    // At scroll=bottom, the container has shifted up, so most entries
    // are now ABOVE the mask top. The mask should clip them.
    const maskTopY = scene.layout.logY + LOG_TITLE_H;
    const containerWorldY = scene.layout.logY + scene.logContentContainer.y;

    // When scrolled to bottom, the ENTIRE container top should be
    // above the mask top (since we shifted up by logMaxScroll which
    // is totalContentH - visibleH, so only the last visibleH pixels
    // of content are within the mask)
    expect(containerWorldY).toBeLessThan(maskTopY);
  });

  it('auto-scrolls to bottom when entries first overflow', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    const { LOG_TITLE_H } = await import(
      '../../src/scenes/MainStreetConstants'
    );

    // ── Phase 1: Few entries that fit ──
    // This simulates the initial game setup where a handful of entries exist.
    for (let i = 0; i < 5; i++) {
      scene.state.activityLog.push({
        text: `Entry ${i}`,
        type: 'neutral',
        turn: 1,
      });
    }
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // All entries fit — container at default position, no scroll
    expect(scene.logScrollOffset).toBe(0);
    expect(scene.logContentContainer.y).toBe(LOG_TITLE_H + 2);

    // ── Phase 2: Add enough entries to overflow ──
    // This simulates gameplay adding enough entries that they exceed visibleH.
    // logAutoScroll starts true, so the log should auto-scroll to the bottom.
    for (let i = 0; i < 50; i++) {
      scene.state.activityLog.push({
        text: `Overflow entry ${i}`,
        type: 'neutral',
        turn: 1,
      });
    }
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // logAutoScroll is true, so scroll offset should be at the bottom
    const visibleH = Math.max(1, scene.layout.logH - LOG_TITLE_H - 4);
    if (scene.logTotalContentH > visibleH) {
      expect(scene.logScrollOffset).toBeCloseTo(scene.logMaxScroll, 0);
      expect(scene.logAutoScroll).toBe(true);
      // Container shifted up to show the bottom
      expect(scene.logContentContainer.y).toBeLessThan(LOG_TITLE_H + 2);
    } else {
      expect(scene.logScrollOffset).toBe(0);
    }

    // Verify all text objects have non-negative Y within the container
    const textEntries = scene.logContentContainer.list.filter(
      (obj: any) => obj instanceof Phaser.GameObjects.Text,
    );
    expect(textEntries.length).toBeGreaterThan(0);

    for (const txt of textEntries) {
      // Every text's local Y should be >= 0 (no entry positioned above
      // the container origin). No content renders above the container.
      expect(txt.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('renders all log entries and uses mask clipping for off-screen entries', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    const longText = 'Long text that wraps ' + 'wrap '.repeat(8);
    const entryCount = 100;

    // Add entries with word-wrap
    for (let i = 0; i < entryCount; i++) {
      scene.state.activityLog.push({
        text: `${longText} #${i}`,
        type: 'neutral',
        turn: 1,
      });
    }

    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const textEntries = scene.logContentContainer.list.filter(
      (obj: any) => obj instanceof Phaser.GameObjects.Text,
    );

    // All entries should be rendered in the container (no windowing).
    // The mask clips off-screen entries; scrolling shifts the container.
    // logTotalContentH should reflect the true total height.
    expect(textEntries.length).toBeGreaterThanOrEqual(entryCount);
    expect(scene.logTotalContentH).toBeGreaterThan(scene.layout.logH);
  });

  it('auto-scrolls to bottom as entries accumulate from a fresh scene', async () => {
    // Regression test for CG-0MT24HFNM002MPF5: the log should auto-scroll
    // to show the latest entries without the player needing to manually
    // wheel-scroll to the bottom first.
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    const { LOG_TITLE_H } = await import(
      '../../src/scenes/MainStreetConstants'
    );
    const visibleH = Math.max(1, scene.layout.logH - LOG_TITLE_H - 4);

    // Start with a few entries that fit
    for (let i = 0; i < 5; i++) {
      scene.state.activityLog.push({
        text: `Entry ${i}`,
        type: 'neutral',
        turn: 1,
      });
    }
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // At start, logAutoScroll should be true and no offset needed (all fit)
    expect(scene.logAutoScroll).toBe(true);
    expect(scene.logScrollOffset).toBe(0);

    // Add entries that cause overflow — auto-scroll should engage immediately
    for (let i = 0; i < 50; i++) {
      scene.state.activityLog.push({
        text: `Entry ${i}`,
        type: 'neutral',
        turn: 1,
      });
    }
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // With overflow and logAutoScroll=true, offset should be at the bottom
    expect(scene.logAutoScroll).toBe(true);
    if (scene.logTotalContentH > visibleH) {
      expect(scene.logScrollOffset).toBeCloseTo(scene.logMaxScroll, 0);
    }
  });

  it('does not yank scroll position when player has scrolled up', async () => {
    // Regression test for CG-0MT24HFNM002MPF5: if the player scrolls up
    // to read history, new entries must NOT steal their scroll position.
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    // Add enough entries to overflow
    for (let i = 0; i < 80; i++) {
      scene.state.activityLog.push({
        text: `Entry ${i}`,
        type: 'neutral',
        turn: 1,
      });
    }
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // Player scrolls up manually by setting logAutoScroll = false and
    // picking an offset in the middle of the content
    scene.logAutoScroll = false;
    const scrollUpOffset = Math.floor(scene.logMaxScroll / 2);
    scene.logScrollOffset = scrollUpOffset;
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const positionBefore = scene.logScrollOffset;

    // Add new entries — player is NOT at bottom, so auto-scroll should NOT engage
    for (let i = 0; i < 5; i++) {
      scene.state.activityLog.push({
        text: `New entry ${i}`,
        type: 'neutral',
        turn: 2,
      });
    }
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // Scroll offset should be unchanged — the player's reading position
    // is preserved. logAutoScroll remains false.
    expect(scene.logScrollOffset).toBe(positionBefore);
    expect(scene.logAutoScroll).toBe(false);
  });

  it('re-engages auto-scroll when player scrolls back to bottom', async () => {
    // Regression test for CG-0MT24HFNM002MPF5: if the player scrolls back
    // to the bottom, subsequent new entries should again auto-scroll.
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    const { LOG_TITLE_H } = await import(
      '../../src/scenes/MainStreetConstants'
    );
    const visibleH = Math.max(1, scene.layout.logH - LOG_TITLE_H - 4);

    // Add enough entries to overflow
    for (let i = 0; i < 80; i++) {
      scene.state.activityLog.push({
        text: `Entry ${i}`,
        type: 'neutral',
        turn: 1,
      });
    }
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // Player scrolls up
    scene.logAutoScroll = false;
    scene.logScrollOffset = Math.floor(scene.logMaxScroll / 2);
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // Now player scrolls back to bottom
    scene.logScrollOffset = scene.logMaxScroll;
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // atBottom check should re-enable auto-scroll
    expect(scene.logAutoScroll).toBe(true);

    // Add new entries — should auto-scroll
    for (let i = 0; i < 5; i++) {
      scene.state.activityLog.push({
        text: `New entry ${i}`,
        type: 'neutral',
        turn: 2,
      });
    }
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // Offset should have moved to the bottom again
    expect(scene.logAutoScroll).toBe(true);
    if (scene.logTotalContentH > visibleH) {
      expect(scene.logScrollOffset).toBeCloseTo(scene.logMaxScroll, 0);
    }
  });

  // ── Deferred log rendering (MS-0MURBOD2E009SOM2) ─────────────
  it('suppresses new entry rendering while logDeferredUntilPhaseComplete is set', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    // Seed one visible entry and render it.
    scene.state.activityLog.push({ text: 'Visible entry', type: 'neutral', turn: 1 });
    scene.msRenderer.refreshLog();
    await waitFrames(3);
    const renderedBefore = scene.logContentContainer.list.length;
    const prevCountBefore = scene.logPrevEntryCount;

    // Enter the deferral window and add a new entry.
    scene.logDeferredUntilPhaseComplete = true;
    scene.state.activityLog.push({ text: 'Deferred entry', type: 'gain', turn: 1 });
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    // No new content was rendered and the count tracker did not advance, so
    // the next non-deferred refresh still sees a change to render.
    expect(scene.logContentContainer.list.length).toBe(renderedBefore);
    expect(scene.logPrevEntryCount).toBe(prevCountBefore);

    // Lift the deferral: the accumulated entry now renders.
    scene.logDeferredUntilPhaseComplete = false;
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const texts = renderedLogTexts(scene);
    expect(texts).toContain('Deferred entry');
  });

  it('keeps accumulated entries in order when rendered after the deferral window', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    await waitFrames(10);

    scene.logDeferredUntilPhaseComplete = true;
    scene.state.activityLog.push({ text: 'Order A', type: 'neutral', turn: 1 });
    scene.state.activityLog.push({ text: 'Order B', type: 'gain', turn: 1 });
    scene.state.activityLog.push({ text: 'Order C', type: 'loss', turn: 1 });
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    scene.logDeferredUntilPhaseComplete = false;
    scene.msRenderer.refreshLog();
    await waitFrames(3);

    const texts = renderedLogTexts(scene);
    const a = texts.indexOf('Order A');
    const b = texts.indexOf('Order B');
    const c = texts.indexOf('Order C');
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });
});

/**
 * Activity Log content regression (MS-0MV14JDUG000E1V6).
 *
 * The producer-reported regression is a blank Activity Log: the panel and its
 * title render but the content area is empty and never fills. The root cause
 * is the scene-instance `logDeferredUntilPhaseComplete` flag: it is set during
 * the end-of-turn closing and cleared on flush, but it is **not** reset on
 * scene creation. Because Phaser reuses the scene instance across
 * `scene.restart()` / `scene.start()` (and `state` replacements), a flag left
 * set suppresses every subsequent `refreshLog` render for the rest of the
 * session. The flag was introduced by commit `7441311`
 * (MS-0MURBOD2E009SOM2) without a matching reset (identified by commit-diff
 * inspection: `logDeferredUntilPhaseComplete` appears only in that commit's
 * source diff, and the `create()` log-state reset never clears it).
 *
 * RED PHASE: the blank-log repro below is `it.fails` until the fix child
 * (MS-0MV1BMMO900824N9) resets the flag on scene creation, at which point it
 * must be flipped to a plain `it` — mirroring the project's established
 * red-phase convention (`it.fails` while the dependent fix is in flight).
 */
describe('MainStreet Activity Log content regression (MS-0MV14JDUG000E1V6)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  /** Force non-choice incidents so a completed turn never pauses on a dialog. */
  function forceSafeIncidents(scene: any): void {
    const safeTemplates = getEventTemplates().filter((t) =>
      ['evt-award', 'evt-good-press', 'evt-graffiti-art', 'evt-street-cleaning'].includes(t.id),
    );
    scene.state.incidentDeck.length = 0;
    scene.state.incidentDeck.push(
      ...safeTemplates.map((t, i) => ({ ...t, id: `${t.id}-${i}` })),
      ...safeTemplates.map((t, i) => ({ ...t, id: `${t.id}-${i + 10}` })),
    );
  }

  it('renders non-empty log content on load and after a completed turn (single-player)', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;
    await waitFrames(10);

    // On load the week-start turn header is rendered.
    expect(renderedLogTexts(scene).length).toBeGreaterThan(0);
    expect(renderedLogTexts(scene)).toContain('Turn 1');

    // Complete a turn through the real scene end-turn path.
    forceSafeIncidents(scene);
    const beforeTurn = scene.state.turn;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await waitForCondition(() => scene.state.turn > beforeTurn, 15_000);

    // The deferred flush renders the accumulated entries once the closing
    // presentation completes.
    await waitForCondition(
      () =>
        scene.logDeferredUntilPhaseComplete === false &&
        renderedLogTexts(scene).includes(`Turn ${scene.state.turn}`),
      15_000,
    );

    const texts = renderedLogTexts(scene);
    expect(texts.length).toBeGreaterThan(1);
    expect(texts).toContain(`Turn ${scene.state.turn}`);
  }, 60_000);

  it('renders non-empty log content on load and after a completed turn (tutorial)', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;
    await waitFrames(5);

    // Start the tutorial exactly as the tutorial offer does: replace the state
    // with the deterministic tutorial scenario and start the day.
    const { createTutorialScenario } = await import('../../src/TutorialScenario');
    scene.selectedDifficulty = 'Easy';
    scene.state = createTutorialScenario();
    scene.startTurnPhase(false, true);
    scene.refreshAll();
    await waitFrames(5);

    expect(renderedLogTexts(scene).length).toBeGreaterThan(0);
    expect(renderedLogTexts(scene)).toContain('Turn 1');

    // Complete a turn at the engine level (the tutorial gates the interactive
    // End Turn), then refresh the renderer.
    const beforeCount = renderedLogTexts(scene).length;
    endTurnHeadless(scene.state);
    executeWeekStart(scene.state);
    scene.refreshAll();
    await waitFrames(5);

    const texts = renderedLogTexts(scene);
    expect(texts.length).toBeGreaterThan(beforeCount);
    expect(texts.some((t) => t.startsWith('Turn '))).toBe(true);
  }, 60_000);

  it('renders non-empty log content on load and after a completed turn (competitive)', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;
    await waitFrames(5);

    scene.msLifecycleManager.applyNewGameSelection({
      mode: 'competitive',
      opponents: [{ strategy: 'Greedy', difficulty: 'Medium' }],
    });
    await waitForCondition(() => (scene.state.players?.length ?? 0) === 2, 20_000);
    await waitFrames(5);

    expect(renderedLogTexts(scene).length).toBeGreaterThan(0);
    expect(renderedLogTexts(scene)).toContain('Turn 1');

    const beforeCount = renderedLogTexts(scene).length;
    endTurnHeadless(scene.state);
    executeWeekStart(scene.state);
    scene.refreshAll();
    await waitFrames(5);

    const texts = renderedLogTexts(scene);
    expect(texts.length).toBeGreaterThan(beforeCount);
    expect(texts.some((t) => t.startsWith('Turn '))).toBe(true);
  }, 60_000);

  // RED PHASE: fails until MS-0MV1BMMO900824N9 resets
  // `logDeferredUntilPhaseComplete` on scene creation — then flip to `it`.
  it.fails('renders the log after a scene restart even when the deferred-render flag was left set', async () => {
    // Blank-log regression: the scene-instance deferral flag must be reset on
    // scene creation, otherwise a flag left set across `scene.restart()` keeps
    // `refreshLog` suppressed and the Activity Log stays blank. This test
    // FAILS on the pre-fix revision (introduced by 7441311) and passes once
    // the flag is reset in `create()`.
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;
    await waitFrames(10);

    // Simulate a closing presentation interrupted before its flush.
    scene.logDeferredUntilPhaseComplete = true;

    scene.scene.restart();
    await waitForScene(game, 'MainStreetScene');
    const restarted = game.scene.getScene('MainStreetScene') as any;
    await waitFrames(10);

    expect(restarted.logDeferredUntilPhaseComplete).toBe(false);
    const texts = renderedLogTexts(restarted);
    expect(texts.length).toBeGreaterThan(0);
    expect(texts).toContain('Turn 1');
  }, 60_000);
});
