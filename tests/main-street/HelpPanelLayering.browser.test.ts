/**
 * Main Street: Help/Settings panel layering (MS-0MVWMDMLE007I8E1).
 *
 * Visual regression tests proving each panel is actually PAINTED above the
 * scene when opened — not merely logically open.
 *
 * Hardening (MS-0MVWMDMLE007I8E1) removed from this file:
 *
 * - the Settings-panel pixel checks downgraded to `console.warn()` (never an
 *   assertion) when they were weak — now real `expect`s via
 *   `renderer.snapshotPixel()`;
 * - the `if (panelContainer.x <= canvas.width)` guard, true both when the
 *   panel was open (`canvasWidth - panelWidth`) and closed (`canvasWidth`), so
 *   the Settings test could never reach its assertion branch — removed;
 * - the logical-only fallback used when the container had not moved — the
 *   slide-in/out is waited for (headless tweens advance; the WebGL clipping
 *   tests rely on the same behaviour) and a never-moving panel times out and
 *   fails instead;
 * - the hardcoded Settings colour `0x101020` (16,16,32), which did not match
 *   `SettingsPanel.PANEL_BG_COLOR` (`0x1a1a2e`) — colours are now read from
 *   each panel's own `fillColor` at runtime, never a literal;
 * - the debug `console.info()` calls.
 *
 * Both probes are derived from each panel's own background geometry and
 * validated against it (see `helpers/panelPixelProbe.ts`) — the same pattern
 * as `webgl-renderer-clipping.browser.test.ts`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { TUTORIAL_STATE_STORAGE_KEY } from '../../src/TutorialState';
import { dismissBootModals } from './helpers/bootModals';
import {
  closePanelAndWait,
  expectPanelPainted,
  waitPanelOpen,
  panelPaint,
  panelTargetRect,
  pixelDistance,
  snapshotPixel,
  waitRenderedFrame,
  PANEL_INSIDE_TOLERANCE,
  type PanelProbe,
} from './helpers/panelPixelProbe';

/** Seed the tutorial as skipped so the boot flow never dims the pixel probes. */
function seedTutorialSkipped(): void {
  try {
    localStorage.clear();
    localStorage.setItem(
      TUTORIAL_STATE_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, status: 'skipped', completedAt: null, lastStepId: null }),
    );
  } catch {
    /* storage may be unavailable */
  }
}

async function bootGame(): Promise<Phaser.Game> {
  seedTutorialSkipped();
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
  try {
    localStorage.removeItem(TUTORIAL_STATE_STORAGE_KEY);
  } catch {
    /* storage may be unavailable */
  }
}

describe('MainStreet Help panel layering (visual)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('paints the help panel above market cards and the HUD strip when opened', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & {
      helpPanel: PanelProbe;
    };
    await dismissBootModals(scene);
    for (let i = 0; i < 24; i += 1) await waitRenderedFrame(game);

    const canvas = document.querySelector('#game-container canvas') as HTMLCanvasElement | null;
    expect(canvas).toBeTruthy();
    if (!canvas) throw new Error('Canvas not found');

    const panel = scene.helpPanel;
    // HelpPanel slides in to x = 0; the rect comes from the panel's own
    // background geometry (final width/height even while it is off-screen).
    const targetX = 0;
    const rect = panelTargetRect(panel, targetX);
    expect(rect.w).toBeGreaterThan(0);
    expect(rect.h).toBeGreaterThan(0);

    const probe = {
      surface: 'Help panel',
      // Just left of the scrollbar track and right of the wrapped text column
      // (both widths come from the panel's own PADDING / TRACK_BAR_WIDTH
      // constants), at mid height where only the panel background is painted.
      inside: { x: targetX + rect.w - 15, y: rect.y + rect.h / 2 },
      // Beyond the panel's right edge the street shows instead.
      outside: { x: targetX + rect.w + 30, y: rect.y + rect.h / 2 },
    };

    // Scene-only pixel before the panel opens — a frame without the panel must
    // not satisfy the inside match (proves paint, not just state).
    const sceneOnlyPixel = await snapshotPixel(game, probe.inside.x, probe.inside.y);

    panel.open();
    await waitPanelOpen(game, panel, targetX, probe.surface);
    await expectPanelPainted(game, panel, probe, sceneOnlyPixel);

    // Closing must remove the paint from the same point.
    await closePanelAndWait(game, panel, targetX - rect.w, probe.surface);
    const afterClose = await snapshotPixel(game, probe.inside.x, probe.inside.y);
    const closeDelta = pixelDistance(afterClose, panelPaint(panel));
    expect(
      closeDelta,
      `closing must remove the panel paint from the inside point — distance ${closeDelta} <= inside tolerance ${PANEL_INSIDE_TOLERANCE}`,
    ).toBeGreaterThan(PANEL_INSIDE_TOLERANCE);
  }, 90_000);

  it('paints the settings panel above market cards when opened', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & {
      settingsPanel: PanelProbe;
    };
    await dismissBootModals(scene);
    for (let i = 0; i < 24; i += 1) await waitRenderedFrame(game);

    const canvas = document.querySelector('#game-container canvas') as HTMLCanvasElement | null;
    expect(canvas).toBeTruthy();
    if (!canvas) throw new Error('Canvas not found');

    const panel = scene.settingsPanel;
    // SettingsPanel slides in to `canvas.width - panelWidth`; the rect (and so
    // the panel width) comes from the panel's own background geometry.
    const rect = panelTargetRect(panel, panel.container.x);
    const targetX = canvas.width - rect.w;

    const probe = {
      surface: 'Settings panel',
      // Left of every label/slider (they start at the panel's PADDING), at mid
      // height where only the panel background is painted.
      inside: { x: targetX + 8, y: rect.y + rect.h / 2 },
      // Beyond the panel's left edge the scene shows instead.
      outside: { x: targetX - 30, y: rect.y + rect.h / 2 },
    };

    const sceneOnlyPixel = await snapshotPixel(game, probe.inside.x, probe.inside.y);

    panel.open();
    await waitPanelOpen(game, panel, targetX, probe.surface);
    await expectPanelPainted(game, panel, probe, sceneOnlyPixel);

    await closePanelAndWait(game, panel, canvas.width, probe.surface);
    const afterClose = await snapshotPixel(game, probe.inside.x, probe.inside.y);
    const closeDelta = pixelDistance(afterClose, panelPaint(panel));
    expect(
      closeDelta,
      `closing must remove the settings panel paint from the inside point — distance ${closeDelta} <= inside tolerance ${PANEL_INSIDE_TOLERANCE}`,
    ).toBeGreaterThan(PANEL_INSIDE_TOLERANCE);
  }, 90_000);
});
