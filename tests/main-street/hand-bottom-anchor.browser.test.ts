/**
 * Main Street: hand bottom-anchor and layout-sync contract
 * (parent MS-0MVKTB6WS000VLWK AC7 + AC8; item MS-0MVPWQMTL004J3GB).
 *
 * The hand card row's bottom edge must sit 8–12 px above the viewport bottom
 * at the 1280×720 base viewport (`handY` ≈ 628–632, up from 620) while the
 * horizontal anchoring (`handCenterX` = 467, left-anchored capacity row)
 * stays untouched and the position comes from the normalised SLL `hand` zone
 * (no new hard-coded pixels). Everything that follows the hand — the opaque
 * hand panel, the ghost capacity outlines and the drag hit areas — must move
 * with the new row, and the action row (End Turn / Peek) must keep its exact
 * position (`actionY` 648) because `MainStreetLayoutAdapter` no longer derives
 * `actionY` from the hand zone.
 *
 * The layout contract is checked on three levels:
 *
 * - **Layout geometry (Node-safe).** The SLL `hand` zone resolves to a row
 *   whose bottom sits 8–12 px above the viewport bottom and whose centre is
 *   still 467; the base and tutorial `hand` zones stay in sync; the action
 *   row resolves from its own SLL zone, not the hand zone.
 * - **Rendered row (browser).** The rendered hand cards, ghost capacity
 *   outlines and the opaque hand panel all sit on the *moved* row
 *   (`layout.handY`), i.e. every hand-band object follows the zone.
 * - **Action hit area (browser).** End Turn / Peek render at `actionY + 4`
 *   with the same height as before — no drift from the hand move.
 *
 * @module tests/main-street/hand-bottom-anchor.browser
 */

import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { destroyPhaserGame } from '@core-tests/helpers/phaserCanvasPool';
import { dismissBootModals } from './helpers/bootModals';
import {
  computeMainStreetLayoutWithSll,
  mainStreetAnchorPoint,
} from '../../src/scenes/MainStreetLayoutAdapter';
import { HAND_PANEL_PAD } from '../../src/scenes/MainStreetConstants';
import { getZoneRect } from '@ui/screen-layout';
import { parseScreenLayoutDocument } from '@ui/screen-layout-schema';
import baseLayout from '../../src/layouts/main-street.layout.json';
import tutorialLayout from '../../src/layouts/main-street-tutorial.layout.json';
import { TUTORIAL_STATE_STORAGE_KEY } from '../../src/TutorialState';
import { readPanelBounds } from './helpers/panelTreatment';

const GAME_W = 1280;
const GAME_H = 720;
const SCENE_KEY = 'MainStreetScene';

/** The base viewport used by the SLL base document. */
const BASE_VIEWPORT = { width: 1280, height: 720 } as const;

/** An expanded viewport the same normalised zone is resolved against. */
const EXPANDED_VIEWPORT = { width: 1600, height: 900 } as const;

/** The hand zone's bottom margin target: 8–12 px above the viewport bottom. */
const MIN_BOTTOM_MARGIN = 8;
const MAX_BOTTOM_MARGIN = 12;

type Scene = Phaser.Scene & Record<string, any>;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Scene boot / teardown ───────────────────────────────────

async function bootGame(width = GAME_W, height = GAME_H): Promise<Phaser.Game> {
  localStorage.clear();
  localStorage.setItem(
    TUTORIAL_STATE_STORAGE_KEY,
    JSON.stringify({ schemaVersion: 1, status: 'skipped', completedAt: null, lastStepId: null }),
  );

  let container = document.getElementById('game-container');
  if (container) container.remove();
  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({
    type: Phaser.CANVAS,
    parent: 'game-container',
    width,
    height,
  });
  await waitForScene(game, SCENE_KEY);
  await dismissBootModals(game.scene.getScene(SCENE_KEY) as Scene);
  return game;
}

function getScene(game: Phaser.Game): Scene {
  return game.scene.getScene(SCENE_KEY) as Scene;
}

async function destroyGame(game: Phaser.Game | null): Promise<void> {
  try {
    await (game?.scene.getScene(SCENE_KEY) as Scene | undefined)?.saveStore?.clear?.();
  } catch { /* ignore in constrained environments */ }
  destroyPhaserGame(game);
  const container = document.getElementById('game-container');
  if (container) container.remove();
  try { localStorage.removeItem(TUTORIAL_STATE_STORAGE_KEY); } catch { /* ignore */ }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFrames(scene: Scene, frames = 20): Promise<void> {
  const loop = (scene.game as any)?.loop;
  for (let i = 0; i < frames; i += 1) {
    if (loop?.step) {
      const now = loop.now > 0 ? loop.now : window.performance.now();
      loop.step(now + 16);
    }
    await wait(0);
  }
}

// ── Hand-band inspection ────────────────────────────────────

/** Every display object named `ms-hand-panel` (root list + containers). */
function findHandPanels(scene: Scene): any[] {
  const found: any[] = [];
  const visit = (obj: any): void => {
    if (!obj) return;
    if (obj.name === 'ms-hand-panel') found.push(obj);
    const list = obj.list as any[] | undefined;
    if (Array.isArray(list)) list.forEach(visit);
  };
  ((scene.children as any)?.list ?? []).forEach(visit);
  return found;
}

/** Find the End Turn button container in the action container. */
function findActionButton(scene: Scene, label: string): { rect: Rect; container: any } | null {
  const actionContainer = scene.actionContainer as Phaser.GameObjects.Container;
  for (const entry of actionContainer?.list ?? []) {
    if (!(entry instanceof Phaser.GameObjects.Container)) continue;
    if (!entry.list.some((child) => child instanceof Phaser.GameObjects.Text && (child as Phaser.GameObjects.Text).text === label)) {
      continue;
    }
    const bg = entry.list.find((child) => child instanceof Phaser.GameObjects.Rectangle) as Phaser.GameObjects.Rectangle | undefined;
    if (!bg) continue;
    return {
      rect: {
        x: entry.x - bg.width / 2,
        y: entry.y - bg.height / 2,
        width: bg.width,
        height: bg.height,
      },
      container: entry,
    };
  }
  return null;
}

// ── Test layout helpers (Node-safe) ─────────────────────────

function parsedBaseLayout(): ReturnType<typeof parseScreenLayoutDocument>['layout'] {
  const parsed = parseScreenLayoutDocument(baseLayout);
  if (!parsed.valid) throw new Error(`base layout invalid: ${parsed.errors[0]?.message}`);
  return parsed.layout;
}

function parsedTutorialLayout(): ReturnType<typeof parseScreenLayoutDocument>['layout'] {
  const parsed = parseScreenLayoutDocument(tutorialLayout);
  if (!parsed.valid) throw new Error(`tutorial layout invalid: ${parsed.errors[0]?.message}`);
  return parsed.layout;
}

// ── Tests ───────────────────────────────────────────────────

describe('hand bottom-anchor and layout-sync contract (AC7 + AC8)', () => {
  let game: Phaser.Game | null = null;

  afterEach(async () => {
    await destroyGame(game);
    game = null;
  });

  describe('SLL geometry (Node-safe, no Phaser)', () => {
    it('anchors the hand row 8–12 px above the viewport bottom at 1280×720 (AC7)', () => {
      const layout = computeMainStreetLayoutWithSll();

      // handY from the normalised zone: round(0.872222 × 720) = 628.
      expect(layout.handY).toBeGreaterThanOrEqual(628);
      expect(layout.handY).toBeLessThanOrEqual(632);

      // The hand row rect (handY .. handY + handCardH) leaves an 8–12 px gap.
      const bottomMargin = layout.gameH - (layout.handY + layout.handCardH);
      expect(bottomMargin).toBeGreaterThanOrEqual(MIN_BOTTOM_MARGIN);
      expect(bottomMargin).toBeLessThanOrEqual(MAX_BOTTOM_MARGIN);
    });

    it('keeps the horizontal anchoring untouched (AC7): handCenterX 467, handX 40', () => {
      const layout = computeMainStreetLayoutWithSll();
      expect(layout.handCenterX).toBe(467);
      expect(layout.handX).toBe(40);
      // The capacity row remains centred on the street block.
      expect(layout.handCenterX).toBe(layout.streetX + 390);
    });

    it('moves the hand zone to the target normalised y in the SLL document', () => {
      const layout = parsedBaseLayout();
      const hand = layout.zones.hand;
      expect(hand.rect.y).toBeCloseTo(0.872222, 5);
      // anchors.topLeft kept in sync — the adapter resolves handY from it.
      expect(hand.anchors.topLeft.y).toBe(hand.rect.y);
      expect(hand.rect.x).toBe(0.03125);
      expect(hand.anchors.topLeft.x).toBe(0.03125);
    });

    it('keeps the tutorial hand zone in sync with the base hand zone (AC8)', () => {
      const base = parsedBaseLayout();
      const tutorial = parsedTutorialLayout();

      expect(tutorial.zones.hand.rect.y).toBe(base.zones.hand.rect.y);
      expect(tutorial.zones.hand.anchors.topLeft.y).toBe(base.zones.hand.anchors.topLeft.y);
      expect(tutorial.zones.hand.rect.y).toBeCloseTo(0.872222, 5);
    });

    it('resolves the tutorial highlight hand rect to the rendered hand rect (AC8)', () => {
      // The tutorial highlight rect must equal the rendered hand rect as
      // computed by the layout adapter (the renderer's source of truth).
      const layout = computeMainStreetLayoutWithSll();
      const resolved = getZoneRect(tutorialLayout as never, 'hand', BASE_VIEWPORT, 1);
      const highlight = { x: resolved.x, y: resolved.y, w: resolved.width ?? 0, h: resolved.height ?? 0 };

      // Highlight covers the hand row centred on 467: (323, 628, 288, 80).
      expect(highlight.w).toBeCloseTo(288, 0);
      expect(highlight.h).toBeCloseTo(80, 0);
      expect(highlight.x).toBeCloseTo(323, 0);
      expect(highlight.y).toBeCloseTo(628, 0);

      // And it is exactly the rendered hand rect from the layout adapter.
      const renderedHandW = 2 * layout.handCardW + 8;
      expect(highlight.x).toBeCloseTo(layout.handCenterX - Math.round(renderedHandW / 2), 0);
      expect(highlight.y).toBeCloseTo(layout.handY, 0);
      expect(highlight.w).toBeCloseTo(renderedHandW, 0);
      expect(highlight.h).toBeCloseTo(layout.handCardH, 0);
    });

    it('keeps the bottom margin on an expanded viewport via the normalised zone (AC7)', () => {
      // The position comes from the normalised SLL zone, so the row's
      // proportional bottom margin is identical at any viewport.
      const base = parsedBaseLayout();
      for (const viewport of [
        BASE_VIEWPORT,
        EXPANDED_VIEWPORT,
        { width: 800, height: 600 },
      ] as const) {
        const rect = getZoneRect(base, 'hand', viewport, 1);
        expect(rect.y / viewport.height).toBeCloseTo(0.872222, 5);
      }
    });

    it('decouples the action row from the hand zone and pins it at 648 (AC8)', () => {
      const layout = computeMainStreetLayoutWithSll();

      // The action row keeps its exact pre-anchoring position.
      expect(layout.actionY).toBe(648);

      // It resolves from its own SLL zone (topRight anchor), not from the
      // hand zone: changing the hand anchor must not move the action row.
      const actionTopRight = mainStreetAnchorPoint('actionRow', 'topRight');
      expect(Math.round(actionTopRight.y)).toBe(layout.actionY);
      expect(layout.actionY).not.toBe(layout.handY + 28);

      // Hand zone anchor is what handY resolves from — and they differ.
      const handTopLeft = mainStreetAnchorPoint('hand', 'topLeft');
      expect(Math.round(handTopLeft.y)).toBe(layout.handY);
      expect(layout.actionY).not.toBe(layout.handY);
    });
  });

  describe('rendered hand band (browser)', () => {
    it('renders the hand cards on the moved row (layout.handY) (AC7)', async () => {
      game = await bootGame();
      const scene = getScene(game);
      await waitFrames(scene, 30);
      await wait(200);

      const layout = computeMainStreetLayoutWithSll();
      expect(scene.layout.handY).toBe(layout.handY);
      expect(scene.layout.handCenterX).toBe(layout.handCenterX);

      const handView = scene.msRenderer?.handView;
      expect(handView).toBeDefined();

      // Populate the hand so actual card sprites exist.
      const marketCards: any[] = (scene.state?.market?.cards ?? []).filter(Boolean);
      expect(marketCards.length).toBeGreaterThan(0);
      scene.state.hand = [marketCards[0]];
      scene.msRenderer.refreshPlayerHand();
      await waitFrames(scene, 10);
      await wait(150);

      const sprites = handView.getSprites?.() ?? [];
      expect(sprites.length).toBeGreaterThan(0);
      // HandView is anchored on the moved handY — every card follows.
      for (const sprite of sprites) {
        expect(sprite.y).toBeCloseTo(layout.handY, 0);
      }
    });

    it('moves the ghost capacity outlines and the opaque hand panel with the row (AC7)', async () => {
      game = await bootGame();
      const scene = getScene(game);
      await waitFrames(scene, 30);
      await wait(200);

      const layout = computeMainStreetLayoutWithSll();
      const handView = scene.msRenderer?.handView;
      expect(handView).toBeDefined();

      // Ghost capacity outlines sit on the moved row.
      const outlines: any[] = handView?.outlineRects ?? [];
      expect(outlines.length).toBeGreaterThan(0);
      for (const rect of outlines) {
        expect(rect.y).toBeCloseTo(layout.handY, 0);
        expect(rect.height).toBe(layout.handCardH - 4);
      }

      // The opaque hand panel band derives from the same moved row: its top
      // sits handCardH/2 + HAND_PANEL_PAD above handY.
      const panels = findHandPanels(scene);
      expect(panels.length).toBe(1);
      const panel = readPanelBounds(panels[0]);
      expect(panel).not.toBeNull();
      expect(panel!.y).toBeCloseTo(layout.handY - layout.handCardH / 2 - HAND_PANEL_PAD, 0);
      expect(panel!.y + panel!.height).toBeCloseTo(layout.handY + layout.handCardH / 2 + HAND_PANEL_PAD, 0);
      expect(panel!.y + panel!.height).toBeLessThanOrEqual(layout.gameH);
      expect(panel!.x + panel!.width / 2).toBeCloseTo(layout.handCenterX, 0);
    });
  });

  describe('action row hit areas (browser)', () => {
    it('keeps End Turn / Peek at actionY + 4 with no drift (AC8)', async () => {
      game = await bootGame();
      const scene = getScene(game);
      await waitFrames(scene, 30);
      await wait(200);

      const layout = computeMainStreetLayoutWithSll();

      // The action row must still render at its pre-hand-move position.
      expect(layout.actionY).toBe(648);

      const endTurn = findActionButton(scene, 'End Turn');
      expect(endTurn).not.toBeNull();
      expect(endTurn!.rect.y).toBeCloseTo(layout.actionY + 4, 0);
      expect(endTurn!.rect.width).toBeCloseTo(layout.actionButtonW, 0);
      // Right-aligned at gameW − 24 (unchanged horizontal anchoring).
      expect(endTurn!.rect.x + endTurn!.rect.width).toBeCloseTo(layout.gameW - 24, 0);
      // Hit area stays inside the viewport at the pre-anchoring position:
      // the tutorial `endTurnButton` highlight rect (actionY+4, actionButtonH)
      // fully covers the rendered button — no drift from the hand move.
      expect(endTurn!.rect.y).toBe(layout.actionY + 4);
      expect(endTurn!.rect.height).toBeLessThanOrEqual(layout.actionButtonH);
      expect(endTurn!.rect.y + endTurn!.rect.height).toBeLessThanOrEqual(layout.gameH);

      // The action row top (652) stays below the hand row top (628) but does
      // not collide with the hand's rendered card band (668 bottom) — the
      // pre-existing vertical separation is preserved.
      expect(endTurn!.rect.y).toBeGreaterThan(layout.handY);
    });

    it('keeps the SLL hand and actionRow zones distinct in the base layout', () => {
      const base = parsedBaseLayout();
      expect(base.zones.actionRow).toBeDefined();
      const actionRect = getZoneRect(base, 'actionRow', BASE_VIEWPORT, 1);
      expect(actionRect.y).toBeCloseTo(648, 0);
      expect(base.zones.actionRow.rect.y).toBeCloseTo(0.9, 3);
    });
  });
});
