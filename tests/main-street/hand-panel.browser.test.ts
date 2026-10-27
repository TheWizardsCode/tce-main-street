/**
 * Main Street: persistent opaque hand panel
 * (parent MS-0MVKTB6WS000VLWK, AC2 + AC9).
 *
 * The player hand used to render cards + ghost capacity outlines directly over
 * the street/map backdrop. The contract is that the hand renders on its own
 * opaque panel with the Activity Log treatment (fill `0x1a1408` @ 0.85, 1 px
 * `0x665544` border, `BOX_RADIUS` corners):
 *
 * - drawn **behind** the hand cards and the ghost capacity outlines (and below
 *   the street slot band, so the road/grid layer can never cover it);
 * - sized from the capacity row (`maxSlots × (handCardW + 8)`, geometry read
 *   from the SLL layout authority, never hard-coded pixels) so it grows and
 *   shrinks with `maxHandSize` (staff hire / lay-off) without clipping cards or
 *   ghosts;
 * - **non-interactive** — hand-card clicks, hand→street drags and market-origin
 *   drag registrations behave exactly as before;
 * - rebuilt with `refreshPlayerHand`'s `removeAll(true)` cycle leaving exactly
 *   one panel, and torn down/cleared on scene restart.
 *
 * **Test-first (red) phase.** These assertions are `it.fails` while no hand
 * panel exists. The paired implementation item (MS-0MVPWQIPZ002PHPD) flips
 * each `it.fails` to a plain `it`. Assertions that already hold today (layout
 * authority, click/drag behaviour, registration invariants) run first inside
 * each case so the harness itself is green before the contract assertion fails.
 *
 * Observable contract used by the implementation: the panel is the single
 * display object named {@link HAND_PANEL_NAME} (`ms-hand-panel`); everything
 * else is asserted through rendered state (graphics command stream, display
 * depth, `renderer.dragDropRegistered`, `state.hand` / `state.streetGrid`).
 *
 * @module tests/main-street/hand-panel.browser
 */

import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { destroyPhaserGame } from '@core-tests/helpers/phaserCanvasPool';
import { dismissBootModals } from './helpers/bootModals';
import { TUTORIAL_STATE_STORAGE_KEY } from '../../src/TutorialState';
import { BOX_RADIUS } from '../../src/scenes/MainStreetConstants';
import { computeMainStreetLayoutWithSll } from '../../src/scenes/MainStreetLayoutAdapter';
import { streetPixelHeight } from '../../src/MainStreetMapView';
import { getBusinessTemplates, type BusinessCard } from '../../src/MainStreetCards';
import {
  expectPanelTreatment,
  readPanelBounds,
  readPanelTreatment,
} from './helpers/panelTreatment';

const GAME_W = 1280;
const GAME_H = 720;
const SCENE_KEY = 'MainStreetScene';

/** Name of the persistent hand panel display object (observable contract). */
const HAND_PANEL_NAME = 'ms-hand-panel';

/** Hand-row slot pitch used by `HandView` (`spacing: handCardW + 8`). */
const HAND_SLOT_PITCH_PAD = 8;

type Scene = Phaser.Scene & Record<string, any>;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Scene boot / teardown ───────────────────────────────────

async function bootGame(): Promise<Phaser.Game> {
  // Skip the tutorial so no tutorial overlay gates hand interaction.
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
    width: GAME_W,
    height: GAME_H,
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

// ── Frame / input helpers ───────────────────────────────────

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Advance the Phaser game loop by one deterministic frame. */
function stepGame(scene: Scene, deltaMs = 16): void {
  const loop = (scene.game as any)?.loop;
  if (!loop || typeof loop.step !== 'function') return;
  const now = typeof loop.now === 'number' && loop.now > 0 ? loop.now : window.performance.now();
  try { loop.step(now + deltaMs); } catch { /* game loop already torn down */ }
}

async function settleFrames(scene: Scene, frames = 6): Promise<void> {
  for (let i = 0; i < frames; i += 1) {
    stepGame(scene);
    await wait(0);
  }
}

async function waitForCondition(
  predicate: () => boolean,
  label: string,
  timeoutMs = 10_000,
  scene?: Scene,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    if (scene) stepGame(scene);
    await wait(0);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Dispatch a native DOM MouseEvent at canvas (game-world) coordinates. */
function dispatchMouse(type: string, worldX: number, worldY: number): void {
  const canvas = document.querySelector('#game-container canvas') as HTMLCanvasElement;
  expect(canvas).toBeTruthy();
  const rect = canvas.getBoundingClientRect();
  canvas.dispatchEvent(
    new MouseEvent(type, {
      clientX: rect.x + (worldX / GAME_W) * rect.width,
      clientY: rect.y + (worldY / GAME_H) * rect.height,
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
    }),
  );
}

/** A pure click (below the drag threshold) at the container's centre. */
function pureClick(scene: Scene, container: any): void {
  dispatchMouse('mousedown', container.x, container.y);
  dispatchMouse('mouseup', container.x, container.y);
  stepGame(scene);
}

/** Drive a drag gesture until the container actually moves. */
async function beginDrag(scene: Scene, container: any, resolve: () => any, deadlineMs = 20_000): Promise<any> {
  stepGame(scene);
  stepGame(scene);
  await wait(0);
  const start = Date.now();
  let target = container;
  for (;;) {
    const fresh = resolve();
    if (fresh) target = fresh;
    const originX = target.x;
    const originY = target.y;
    stepGame(scene);
    dispatchMouse('mousedown', originX, originY);
    dispatchMouse('mousemove', originX + 6, originY);
    dispatchMouse('mousemove', originX + 60, originY + 20);
    stepGame(scene);
    await wait(0);
    if (Math.abs(target.x - originX) > 5 || Math.abs(target.y - originY) > 5) return target;
    if (Date.now() - start >= deadlineMs) {
      throw new Error(`Timed out waiting for the hand drag to engage (x=${target.x}, y=${target.y})`);
    }
    // Release at the drag position, never at rest: a mouseup at rest would be
    // read as a click and mask the path under test.
    dispatchMouse('mouseup', originX + 60, originY + 20);
    stepGame(scene);
    await wait(2);
  }
}

/** Complete a gesture started with {@link beginDrag}. */
async function releaseDrag(scene: Scene, x: number, y: number, settleMs = 300): Promise<void> {
  stepGame(scene);
  dispatchMouse('mousemove', x, y);
  stepGame(scene);
  dispatchMouse('mouseup', x, y);
  stepGame(scene);
  const start = Date.now();
  while (Date.now() - start < settleMs) {
    stepGame(scene);
    await wait(4);
  }
}

// ── Hand-layer inspection ───────────────────────────────────

/** Every display object named {@link HAND_PANEL_NAME} (root list + containers). */
function findHandPanels(scene: Scene): any[] {
  const found: any[] = [];
  const visit = (obj: any): void => {
    if (!obj) return;
    if (obj.name === HAND_PANEL_NAME) found.push(obj);
    const list = obj.list as any[] | undefined;
    if (Array.isArray(list)) list.forEach(visit);
  };
  ((scene.children as any)?.list ?? []).forEach(visit);
  return found;
}

/** True when `obj` lives anywhere inside `container`. */
function isDescendantOf(obj: any, container: any): boolean {
  let node = obj?.parentContainer;
  while (node) {
    if (node === container) return true;
    node = node.parentContainer;
  }
  return false;
}

/**
 * Depth an object actually renders at: a container child renders at its root
 * container's depth, so walk up to the root before reading `depth`.
 */
function layerDepth(obj: any): number {
  let node = obj;
  while (node?.parentContainer) node = node.parentContainer;
  return typeof node?.depth === 'number' ? node.depth : 0;
}

/** Hand cards and ghost capacity outlines (the objects the panel sits behind). */
function handLayerObjects(scene: Scene): any[] {
  const handView = scene.msRenderer?.handView;
  const sprites: any[] = handView?.getSprites?.() ?? [];
  const outlines: any[] = handView?.outlineRects ?? [];
  return [...sprites, ...outlines];
}

/** Axis-aligned bounds of a display object in scene coordinates. */
function boundsOf(obj: any): Rect {
  const b = obj?.getBounds?.();
  if (b && typeof b.width === 'number' && b.width > 0 && typeof b.height === 'number' && b.height > 0) {
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  const width = Number(obj?.width) || 0;
  const height = Number(obj?.height) || 0;
  return {
    x: (Number(obj?.x) || 0) - width / 2,
    y: (Number(obj?.y) || 0) - height / 2,
    width,
    height,
  };
}

/** The rendered hand card container for a card id (renderCard names it). */
function findHandCardContainer(scene: Scene, cardId: string): any | undefined {
  const list: any[] = [...((scene.children as any)?.list ?? [])];
  return list.find((child) => child?.name === `ms-hand-card-${cardId}`);
}

/** Wait for the hand container to stabilise (SVG prewarm can rebuild it). */
async function waitForHandStable(scene: Scene, cardId: string): Promise<any> {
  try {
    await Promise.race([scene.cardSvgLoadPromise, wait(5000)]);
  } catch { /* ignore */ }
  await wait(250);
  let previous: any;
  let stablePolls = 0;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await wait(250);
    const now = findHandCardContainer(scene, cardId);
    if (now && now === previous) {
      stablePolls += 1;
      if (stablePolls >= 3) return now;
    } else {
      stablePolls = 0;
    }
    previous = now;
  }
  throw new Error('Timed out waiting for the hand container to stabilise');
}

// ── Fixtures ────────────────────────────────────────────────

/** An affordable business card for the hand (deterministic drag/click fixture). */
function makeHandCard(name: string): BusinessCard {
  const tpl = getBusinessTemplates()[0];
  if (!tpl) throw new Error('No business templates');
  return {
    ...tpl,
    id: `handpanel-${name}-${tpl.id}`,
    family: 'business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    appliedUpgrades: [],
    cost: Math.min(tpl.cost, 100),
  };
}

/** One business card in hand, market cleared, street empty, full refresh run. */
function setupBusinessScene(scene: Scene, card: BusinessCard): void {
  for (let i = 0; i < scene.state.streetGrid.length; i += 1) {
    scene.state.streetGrid[i] = null;
  }
  scene.state.market.cards = [];
  scene.state.hand = [card];
  scene.state.resourceBank.coins = 2000;
  scene.state.actionsRemaining = 1;
  scene.justMovedHandCardId = null;
  scene.justMovedUpgradeCardId = null;
  scene.pendingHandIndex = null;
  scene.pendingHandJustMoved = false;
  scene.uiPhase = 'market';
  if (scene.settingsPanel) scene.settingsPanel._reducedMotion = true;
  scene.refreshAll();
}

// ── Tests ───────────────────────────────────────────────────

describe('Main Street hand panel', () => {
  let game: Phaser.Game | null = null;

  afterEach(async () => {
    await destroyGame(game);
    game = null;
  });

  it('renders one opaque hand panel behind the cards and ghost outlines (AC2; MS-0MVPWQIPZ002PHPD)', async () => {
    game = await bootGame();
    const scene = getScene(game);
    await settleFrames(scene);

    const panels = findHandPanels(scene);
    expect(panels.length, 'exactly one hand panel must exist').toBe(1);
    const panel = panels[0];

    // Shared Activity Log treatment: opaque fill + 1 px border + rounded corners.
    expect(
      panel,
      'the hand panel must be a graphics object (fill + border + radius)',
    ).toBeInstanceOf(Phaser.GameObjects.Graphics);
    expectPanelTreatment(readPanelTreatment(panel), {
      label: 'Hand panel',
      radius: BOX_RADIUS,
    });

    // Non-interactive: never registered for input, drag or drop.
    expect((panel as any).input ?? null, 'hand panel must not be interactive').toBeNull();
    expect(
      scene.msRenderer.dragDropRegistered.has(panel),
      'hand panel must never be a draggable',
    ).toBe(false);
    expect(
      isDescendantOf(panel, scene.streetContainer),
      'hand panel must not live inside the street layer',
    ).toBe(false);

    // Behind the hand layer: empty hand (ghost outlines only) ...
    const emptyLayer = handLayerObjects(scene);
    expect(emptyLayer.length, 'ghost capacity outlines must exist').toBeGreaterThan(0);
    for (const obj of emptyLayer) {
      expect(
        layerDepth(panel),
        'hand panel must render behind the ghost capacity outlines',
      ).toBeLessThan(layerDepth(obj));
    }

    // ... and behind a populated hand, where extra capacity ghosts are pushed
    // deepest (a panel that only wins on the empty hand would still cover them).
    const marketCards: any[] = (scene.state?.market?.cards ?? []).filter(Boolean);
    expect(marketCards.length).toBeGreaterThan(0);
    scene.state.hand = [marketCards[0]];
    scene.msRenderer.refreshPlayerHand();
    await settleFrames(scene);

    const populatedPanels = findHandPanels(scene);
    expect(populatedPanels.length, 'exactly one hand panel after a hand refresh').toBe(1);
    const populatedLayer = handLayerObjects(scene);
    expect(populatedLayer.length).toBeGreaterThan(0);
    for (const obj of populatedLayer) {
      expect(
        layerDepth(populatedPanels[0]),
        'hand panel must render behind the hand cards and every ghost outline',
      ).toBeLessThan(layerDepth(obj));
    }
  }, 60_000);

  it('sizes the panel from the SLL capacity row and tracks maxHandSize (AC2)', async () => {
    game = await bootGame();
    const scene = getScene(game);
    await settleFrames(scene);

    // The live layout is the SLL layout — every expected value below derives
    // from the layout authority, never from hard-coded pixels.
    const layout = computeMainStreetLayoutWithSll();
    const sceneLayout = scene.layout as unknown as typeof layout;
    expect(sceneLayout.handCardW).toBe(layout.handCardW);
    expect(sceneLayout.handCardH).toBe(layout.handCardH);
    expect(sceneLayout.handCenterX).toBe(layout.handCenterX);
    expect(sceneLayout.handY).toBe(layout.handY);
    expect(sceneLayout.gameH).toBe(layout.gameH);

    const expectPanelForCapacity = (slots: number, label: string): void => {
      const panels = findHandPanels(scene);
      expect(panels.length, `${label}: exactly one hand panel`).toBe(1);
      const bounds = readPanelBounds(panels[0]);
      expect(bounds, `${label}: panel bounds must be readable`).not.toBeNull();

      expect(
        bounds!.width,
        `${label}: panel width must cover the capacity row (maxSlots × (handCardW + 8))`,
      ).toBeCloseTo(slots * (layout.handCardW + HAND_SLOT_PITCH_PAD), 0);
      expect(
        bounds!.x + bounds!.width / 2,
        `${label}: panel must stay centred on handCenterX`,
      ).toBeCloseTo(layout.handCenterX, 0);
      expect(
        bounds!.height,
        `${label}: panel must cover the full hand card height`,
      ).toBeGreaterThanOrEqual(layout.handCardH - 4);
      expect(
        bounds!.y + bounds!.height,
        `${label}: panel must stay inside the viewport`,
      ).toBeLessThanOrEqual(layout.gameH);
      expect(
        bounds!.y,
        `${label}: panel must sit below the street slot band`,
      ).toBeGreaterThanOrEqual(layout.streetTop + streetPixelHeight(sceneLayout));

      // No card / ghost clipping: every hand-layer object sits inside the panel.
      for (const obj of handLayerObjects(scene)) {
        const objBounds = boundsOf(obj);
        expect(objBounds.x, `${label}: ghost/card left edge inside the panel`).toBeGreaterThanOrEqual(
          bounds!.x - 1,
        );
        expect(objBounds.y, `${label}: ghost/card top edge inside the panel`).toBeGreaterThanOrEqual(
          bounds!.y - 1,
        );
        expect(
          objBounds.x + objBounds.width,
          `${label}: ghost/card right edge inside the panel`,
        ).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
        expect(
          objBounds.y + objBounds.height,
          `${label}: ghost/card bottom edge inside the panel`,
        ).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
      }
    };

    const baseCapacity = Number(scene.state.maxHandSize);
    expect(baseCapacity, 'base hand capacity').toBeGreaterThan(0);
    expectPanelForCapacity(baseCapacity, 'base capacity');

    // Staff hire raises maxHandSize: the panel must grow with the capacity row.
    scene.state.maxHandSize = baseCapacity + 2;
    scene.msRenderer.refreshPlayerHand();
    await settleFrames(scene);
    expectPanelForCapacity(baseCapacity + 2, 'raised capacity');

    // Lay-off shrinks it back.
    scene.state.maxHandSize = baseCapacity;
    scene.msRenderer.refreshPlayerHand();
    await settleFrames(scene);
    expectPanelForCapacity(baseCapacity, 'restored capacity');
  }, 60_000);

  it('survives refreshPlayerHand and is rebuilt exactly once on restart (AC2)', async () => {
    game = await bootGame();
    const scene = getScene(game);
    await settleFrames(scene);

    const initialPanels = findHandPanels(scene);
    expect(initialPanels.length, 'exactly one hand panel at boot').toBe(1);
    const initial = initialPanels[0];
    const initialBounds = readPanelBounds(initial);
    expect(initialBounds, 'initial panel bounds must be readable').not.toBeNull();

    // Populate the hand so the refresh cycle runs with cards present.
    const marketCards: any[] = (scene.state?.market?.cards ?? []).filter(Boolean);
    expect(marketCards.length).toBeGreaterThanOrEqual(2);
    scene.state.hand = marketCards.slice(0, 2).map((c: any) => ({ ...c }));

    for (let cycle = 0; cycle < 2; cycle += 1) {
      // refreshPlayerHand() calls handContainer.removeAll(true) then rebuilds.
      scene.msRenderer.refreshPlayerHand();
      await settleFrames(scene);

      const panels = findHandPanels(scene);
      expect(panels.length, `cycle ${cycle}: exactly one hand panel after refresh`).toBe(1);

      const bounds = readPanelBounds(panels[0]);
      expect(bounds, `cycle ${cycle}: panel bounds must be readable`).not.toBeNull();
      expect(bounds!.x, `cycle ${cycle}: panel keeps its position`).toBeCloseTo(
        initialBounds!.x,
        0,
      );
      expect(bounds!.width, `cycle ${cycle}: panel keeps its width`).toBeCloseTo(
        initialBounds!.width,
        0,
      );
    }

    // Scene restart: the pre-restart panel is torn down and exactly one fresh
    // panel is created (no duplicates, no stale graphics from the old scene).
    scene.scene.restart();
    await waitForScene(game, SCENE_KEY);
    const restarted = getScene(game);
    await settleFrames(restarted, 10);

    expect(findHandPanels(restarted).length, 'exactly one hand panel after restart').toBe(1);
    expect((initial as any).active, 'the pre-restart panel must be destroyed').toBe(false);
  }, 90_000);

  it('is non-interactive: hand click, hand→street drag and market drag registrations unchanged (AC4)', async () => {
    game = await bootGame();
    const scene = getScene(game);
    await settleFrames(scene);

    // Market-origin draggables must survive the hand panel's rebuild cycle —
    // refreshPlayerHand() rebuilds the hand container only.
    const marketRegistered = [...scene.msRenderer.dragDropRegistered].filter((c: any) =>
      String(c?.name ?? '').startsWith('ms-market-card-'),
    );
    expect(marketRegistered.length, 'market cards must be registered draggables').toBeGreaterThan(0);
    scene.msRenderer.refreshPlayerHand();
    await settleFrames(scene);
    for (const container of marketRegistered) {
      expect(
        scene.msRenderer.dragDropRegistered.has(container),
        'hand refresh must not unregister market draggables',
      ).toBe(true);
      expect((container as any).active, 'market draggable must stay alive').toBe(true);
    }

    // Hand-card click: the panel must never swallow the card's hit area.
    const card = makeHandCard('Click');
    setupBusinessScene(scene, card);
    let container = await waitForHandStable(scene, card.id);
    pureClick(scene, container);
    await waitForCondition(
      () => scene.uiPhase === 'placing-from-hand' && scene.pendingHandIndex === 0,
      'hand-card click reaches onHandBusinessCardClick',
      10_000,
      scene,
    );

    // Hand → street drag: still places the held business on an empty slot.
    scene.uiPhase = 'market';
    scene.pendingHandIndex = null;
    scene.refreshPlayerHand();
    container = await waitForHandStable(scene, card.id);
    const target = scene.getStreetSlotCenter(0);
    await beginDrag(scene, container, () => findHandCardContainer(scene, card.id));
    await releaseDrag(scene, target.x, target.y);
    await waitForCondition(
      () => scene.state.streetGrid[0]?.id === card.id,
      'hand→street drag places the business',
      10_000,
      scene,
    );
    expect(scene.state.hand.some((c: any) => c.id === card.id), 'card left the hand').toBe(false);

    // Contract assertion last: one non-interactive panel behind the hand layer.
    const panels = findHandPanels(scene);
    expect(panels.length, 'exactly one hand panel').toBe(1);
    expect((panels[0] as any).input ?? null, 'hand panel must not be interactive').toBeNull();
    expect(
      scene.msRenderer.dragDropRegistered.has(panels[0]),
      'hand panel must never be a draggable',
    ).toBe(false);
  }, 90_000);
});
