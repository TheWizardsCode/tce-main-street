/**
 * Main Street: Help/Settings buttons (MS-0MVWMDMLE007I8E1).
 *
 * Regression test that the Help ("?") and Settings (gear) buttons exist,
 * carry their glyphs, are parented into the shared HUD container (so they
 * render above the HUD overlays), and that opening the Help panel actually
 * PAINTS it.
 *
 * Hardening (MS-0MVWMDMLE007I8E1) removed from this file:
 *
 * - `expect(hudHasHelp || true).toBeTruthy()` / `expect(hudHasSettings ||
 *   true).toBeTruthy()` — always true, could never fail (shared Test Writing
 *   Guidelines anti-pattern 2);
 * - the duplicated `expect(hl).toBeDefined()` / `expect(sl).toBeDefined()`
 *   re-checks that repeated earlier assertions;
 * - the 180-unit colour-distance panel probe (wider than the distance between
 *   the panel background and several scene colours) and the silent
 *   2D/WebGL `getImageData` fallback.
 *
 * Panel paint is now proven through `renderer.snapshotPixel()` with a rect
 * derived from the panel's own background geometry and a colour read from the
 * panel's own `fillColor`, and a scene-only frame cannot satisfy the probe
 * (see `helpers/panelPixelProbe.ts`).
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

/** A toggle button's display parts (both button classes parent these into the HUD). */
interface ButtonParts {
  label: Phaser.GameObjects.Text;
  circle: Phaser.GameObjects.GameObject;
  hitArea: Phaser.GameObjects.GameObject;
  /** Present on `HelpButton`; `SettingsButton` exposes no such accessor. */
  getSceneChildren?: () => Phaser.GameObjects.GameObject[];
}

/** The scene slice this file reads. */
interface ButtonScene extends Phaser.Scene {
  helpButton: ButtonParts;
  settingsButton: ButtonParts;
  helpPanel: PanelProbe;
  hudContainer: Phaser.GameObjects.Container;
}

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

describe('MainStreet help/settings buttons (regression)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('renders Help and Settings buttons, parents them into the HUD, and paints the Help panel', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ButtonScene;

    // Dismiss the blocking New Game selector so nothing dims the scene behind
    // the panel probes.
    await dismissBootModals(scene);
    for (let i = 0; i < 20; i += 1) await waitRenderedFrame(game);

    // ── Buttons exist and carry their glyphs (asserted once) ──
    expect(scene.helpButton).toBeDefined();
    expect(scene.settingsButton).toBeDefined();

    expect(scene.helpButton.label.text).toBe('?');
    expect(scene.settingsButton.label.text).toBe('\u2699');
    expect(scene.helpButton.label.visible).toBe(true);
    expect(scene.settingsButton.label.visible).toBe(true);

    // ── HUD parenting (strict: every part must be in the HUD child list) ──
    expect(scene.hudContainer).toBeTruthy();
    const hudChildren = scene.hudContainer.list;

    // HelpButton publishes its parts; SettingsButton does not, so its parts
    // are read from the instance (same objects it parents into the HUD).
    const helpParts = scene.helpButton.getSceneChildren
      ? scene.helpButton.getSceneChildren()
      : [scene.helpButton.circle, scene.helpButton.label, scene.helpButton.hitArea];
    expect(helpParts.length).toBeGreaterThan(0);
    for (const part of helpParts) {
      expect(hudChildren).toContain(part);
    }
    for (const part of [scene.settingsButton.circle, scene.settingsButton.label, scene.settingsButton.hitArea]) {
      expect(hudChildren).toContain(part);
    }

    // ── The Help panel is actually painted when opened ──
    const panel = scene.helpPanel;
    // HelpPanel slides in to x = 0. Probe geometry comes from the panel's own
    // background rect (width/height are final while it is off-screen).
    const targetX = 0;
    const rect = panelTargetRect(panel, targetX);
    const probe = {
      surface: 'Help panel',
      // Just left of the scrollbar track and right of the wrapped text column
      // (both widths come from the panel's own PADDING / TRACK_BAR_WIDTH
      // constants), at mid height where only the panel background is painted.
      inside: { x: targetX + rect.w - 15, y: rect.y + rect.h / 2 },
      // Beyond the panel's right edge the scene shows instead.
      outside: { x: targetX + rect.w + 30, y: rect.y + rect.h / 2 },
    };

    // Scene-only pixel at the inside point while the panel is still closed.
    const sceneOnlyPixel = await snapshotPixel(game, probe.inside.x, probe.inside.y);

    // Open the panel through the BUTTON (its pointerdown handler), so the
    // assertion also proves the button still drives its panel.
    scene.helpButton.hitArea.emit('pointerdown');
    await waitPanelOpen(game, panel, targetX, probe.surface);
    await expectPanelPainted(game, panel, probe, sceneOnlyPixel);

    // Closing must remove the paint again.
    await closePanelAndWait(game, panel, targetX - rect.w, probe.surface);
    const afterClose = await snapshotPixel(game, probe.inside.x, probe.inside.y);
    const closeDelta = pixelDistance(afterClose, panelPaint(panel));
    expect(
      closeDelta,
      `closing must remove the panel paint from the inside point — distance ${closeDelta} <= inside tolerance ${PANEL_INSIDE_TOLERANCE}`,
    ).toBeGreaterThan(PANEL_INSIDE_TOLERANCE);
  }, 90_000);
});
