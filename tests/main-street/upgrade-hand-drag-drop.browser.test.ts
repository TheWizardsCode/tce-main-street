/**
 * Main Street: hand upgrade drag-drop browser tests (MS-0MV76HVE4007AOO0).
 *
 * Hand-held upgrades are draggable onto eligible street businesses —
 * mirroring the market buy-and-play drag — while the click-to-apply flow
 * keeps working:
 *
 * - pickup is vetoed with illegal feedback when no eligible business exists
 *   (the drag never engages);
 * - eligible business slots highlight green and ineligible ones red while a
 *   hand-origin drag is live (drag-highlight resolution from the hand);
 * - dropping a hand upgrade onto an eligible business applies it through the
 *   same undoable `playUpgradeFromHandCommand` path as the click flow
 *   (same-week composite free; held from a previous week = 1 action);
 * - dropping on an ineligible business snaps the card back with illegal
 *   feedback and spends nothing;
 * - a pure click (below the drag threshold) still reaches the click-to-apply
 *   flow after the drag gesture — click-vs-drag coexistence (AC5).
 *
 * Assertions go through the scene's public interaction surface and the state
 * it mutates — never source greps.
 *
 * @module tests/main-street/upgrade-hand-drag-drop.browser
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { destroyPhaserGame } from '@core-tests/helpers/phaserCanvasPool';
import { dismissBootModals } from './helpers/bootModals';
import { TUTORIAL_STATE_STORAGE_KEY } from '../../src/TutorialState';
import {
  getBusinessTemplates,
  getUpgradeTemplates,
  type BusinessCard,
  type UpgradeCard,
} from '../../src/MainStreetCards';

const GAME_W = 1280;
const GAME_H = 720;

type Scene = Phaser.Scene & Record<string, any>;

/** Clear localStorage so persisted tutorial/checkpoint hints cannot surface. */
async function clearPersistentStorage(): Promise<void> {
  try { localStorage.clear(); } catch { /* ignore */ }
}

/**
 * Remove the persisted run checkpoint through the live save store.
 */
async function clearSaveStore(scene: Scene | undefined): Promise<void> {
  try { await scene?.saveStore?.clear?.(); } catch { /* ignore in constrained environments */ }
}

async function bootGame(): Promise<Phaser.Game> {
  await clearPersistentStorage();
  // Skip the tutorial so no tutorial step gates a drag interaction.
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
  await waitForScene(game, 'MainStreetScene');
  await dismissBootModals(game.scene.getScene('MainStreetScene') as Scene);
  return game;
}

/** Tear the game down deterministically. */
function destroyGame(game: Phaser.Game | null): void {
  destroyPhaserGame(game);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Advance the Phaser game loop by one deterministic frame (rAF may be
 * starved under full-suite CPU contention — CG-0MUE2U21C0007BKL).
 */
function stepGame(scene: Scene, deltaMs = 16): void {
  const loop = (scene.game as any)?.loop;
  if (!loop || typeof loop.step !== 'function') return;
  const now = typeof loop.now === 'number' && loop.now > 0
    ? loop.now
    : window.performance.now();
  try {
    loop.step(now + deltaMs);
  } catch { /* game loop already torn down */ }
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

function getScene(game: Phaser.Game): Scene {
  return game.scene.getScene('MainStreetScene') as Scene;
}

/** Dispatch a native DOM MouseEvent at canvas (game-world) coordinates. */
function dispatchMouse(type: string, worldX: number, worldY: number): void {
  const canvas = document.querySelector('#game-container canvas') as HTMLCanvasElement;
  expect(canvas).toBeTruthy();
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.x + (worldX / GAME_W) * rect.width;
  const clientY = rect.y + (worldY / GAME_H) * rect.height;
  canvas.dispatchEvent(
    new MouseEvent(type, {
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
    }),
  );
}

/** The rendered hand container for a card id (renderCard names it). */
function findHandCardContainer(scene: Scene, cardId: string): any | undefined {
  // HandView's renderCard containers are scene-level display objects (not
  // children of handContainer), so search the scene display list by name.
  const list: any[] = [...((scene.children as any)?.list ?? [])];
  return list.find((child) => child?.name === `ms-hand-card-${cardId}`);
}

/**
 * Drive a drag gesture up to (but not including) the release, retrying until
 * the container moves (the contention guard from the market drag suite).
 */
async function beginDrag(
  scene: Scene,
  container: any,
  opts: { expectEngage?: boolean; deadlineMs?: number; resolve?: () => any } = {},
): Promise<any> {
  const { expectEngage = true, deadlineMs = 30_000, resolve } = opts;
  let target = container;

  stepGame(scene);
  stepGame(scene);
  await wait(0);

  const start = Date.now();
  for (;;) {
    if (resolve) {
      const fresh = resolve();
      if (fresh) target = fresh;
    }
    const originX = target.x;
    const originY = target.y;
    stepGame(scene);

    dispatchMouse('mousedown', originX, originY);
    dispatchMouse('mousemove', originX + 6, originY);
    dispatchMouse('mousemove', originX + 60, originY + 20);
    stepGame(scene);
    await wait(0);

    if (Math.abs(target.x - originX) > 5 || Math.abs(target.y - originY) > 5) {
      return target;
    }
    if (!expectEngage) return target;

    if (Date.now() - start >= deadlineMs) {
      throw new Error(
        `Timed out waiting for the drag to engage after ${deadlineMs}ms ` +
          `(container.x=${target.x}, container.y=${target.y})`,
      );
    }
    dispatchMouse('mouseup', originX, originY);
    stepGame(scene);
    await wait(2);
  }
}

/** Complete a gesture started with {@link beginDrag} at the given target. */
async function releaseDrag(
  scene: Scene,
  dx: number,
  dy: number,
  settleMs = 300,
): Promise<void> {
  stepGame(scene);
  dispatchMouse('mousemove', dx, dy);
  stepGame(scene);
  dispatchMouse('mouseup', dx, dy);
  stepGame(scene);
  const settleStart = Date.now();
  while (Date.now() - settleStart < settleMs) {
    stepGame(scene);
    await wait(4);
  }
}

/** A level-0 upgrade plus a matching base-level business template. */
function makeUpgradeFixture(): { biz: BusinessCard; upgrade: UpgradeCard } {
  const upgrades = getUpgradeTemplates();
  const upgrade = upgrades.find((u) => (u.requiredLevel ?? 0) === 0);
  if (!upgrade) throw new Error('No level-0 upgrade templates');
  const tpl = getBusinessTemplates().find((t) => t.name === upgrade.targetBusiness);
  if (!tpl) throw new Error(`No business template named "${upgrade.targetBusiness}"`);
  const biz: BusinessCard = {
    ...tpl,
    id: `handdrag-biz-${tpl.id}`,
    family: 'business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    appliedUpgrades: [],
  };
  return { biz, upgrade };
}

/**
 * Place a deterministic upgrade-in-hand / street setup on the live scene:
 * the upgrade rests in the HAND (not the market), one matching business sits
 * on slot 0, and all other slots are empty.
 */
function setupUpgradeScene(
  scene: Scene,
  opts: { actions?: number; coins?: number; businessLevel?: number; sameWeek?: boolean } = {},
): { biz: BusinessCard; upgrade: UpgradeCard } {
  const { biz, upgrade } = makeUpgradeFixture();
  const level = opts.businessLevel ?? 0;
  const placedBiz: BusinessCard = { ...biz, level, id: `${biz.id}-lvl${level}` };

  scene.state.streetGrid[0] = placedBiz;
  for (let i = 1; i < scene.state.streetGrid.length; i += 1) {
    scene.state.streetGrid[i] = null;
  }

  scene.state.market.cards = [];
  scene.state.hand = [upgrade];
  scene.state.resourceBank.coins = opts.coins ?? 2000;
  scene.state.actionsRemaining = opts.actions ?? 1;
  scene.state.justMovedUpgradeCardId = opts.sameWeek ? upgrade.id : null;

  scene.pendingHandIndex = null;
  scene.pendingHandJustMoved = opts.sameWeek ?? false;
  scene.uiPhase = 'market';
  if (scene.settingsPanel) scene.settingsPanel._reducedMotion = true;
  scene.refreshAll();

  return { biz: placedBiz, upgrade };
}

/** A single affordable business card for the hand-drag placement half. */
function makeHandBusiness(): BusinessCard {
  const tpl = getBusinessTemplates()[0];
  if (!tpl) throw new Error('No business templates');
  return {
    ...tpl,
    id: `handdrag-biz-place-${tpl.id}`,
    family: 'business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    appliedUpgrades: [],
    cost: Math.min(tpl.cost, 100),
  };
}

/**
 * Place a deterministic business-in-hand setup: the card rests in the HAND,
 * the market is empty and every street slot is empty.
 */
function setupBusinessScene(
  scene: Scene,
  opts: { actions?: number; coins?: number; sameWeek?: boolean } = {},
): BusinessCard {
  const card = makeHandBusiness();
  for (let i = 0; i < scene.state.streetGrid.length; i += 1) {
    scene.state.streetGrid[i] = null;
  }
  scene.state.market.cards = [];
  scene.state.hand = [card];
  scene.state.resourceBank.coins = opts.coins ?? 2000;
  scene.state.actionsRemaining = opts.actions ?? 1;
  scene.justMovedHandCardId = opts.sameWeek ? card.id : null;
  scene.pendingHandIndex = null;
  scene.pendingHandJustMoved = opts.sameWeek ?? false;
  scene.uiPhase = 'market';
  if (scene.settingsPanel) scene.settingsPanel._reducedMotion = true;
  scene.refreshAll();
  return card;
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

describe('Main Street hand upgrade drag-drop (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(async () => {
    await clearSaveStore(game?.scene.getScene('MainStreetScene') as Scene | undefined);
    destroyGame(game);
    game = null;
    try { localStorage.removeItem(TUTORIAL_STATE_STORAGE_KEY); } catch { /* ignore */ }
  });

  it('registers the hand upgrade as draggable and refuses pickup when no eligible business exists', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const { upgrade } = setupUpgradeScene(scene);
    // Remove the only eligible business: pickup must be vetoed.
    scene.state.streetGrid[0] = null;
    scene.refreshAll();

    const container = await waitForHandStable(scene, upgrade.id);
    const originX = container.x;
    const originY = container.y;

    const dragged = await beginDrag(scene, container, {
      expectEngage: false,
      resolve: () => findHandCardContainer(scene, upgrade.id),
    });
    await releaseDrag(scene, scene.getStreetSlotCenter(0).x, scene.getStreetSlotCenter(0).y, 400);

    // The card never left the hand and nothing was spent.
    expect(dragged.x).toBeCloseTo(originX, 0);
    expect(dragged.y).toBeCloseTo(originY, 0);
    expect(scene.state.hand.some((c: any) => c.id === upgrade.id)).toBe(true);
    expect(scene.state.streetGrid[0]).toBeNull();
    expect(scene.state.actionsRemaining).toBe(1);
    expect(scene.state.resourceBank.coins).toBe(2000);
    expect(scene.undoManager.canUndo()).toBe(false);
  }, 60_000);

  it('highlights eligible business slots green and ineligible ones red from a hand origin', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const { upgrade } = setupUpgradeScene(scene);

    // Slot 0 holds a level-0 business (eligible); slot 1 a level-1 one
    // (ineligible for this level-0 upgrade).
    scene.state.streetGrid[1] = { ...scene.state.streetGrid[0]!, id: 'ineligible-lvl1', level: 1 };
    scene.refreshAll();

    scene.msRenderer.showDragHighlights(upgrade.id);

    const highlights: Array<{ slotIndex: number; validity: string }> =
      scene.msRenderer.getDragHighlights();
    const bySlot = new Map(highlights.map((h) => [h.slotIndex, h.validity]));

    expect(bySlot.get(0)).toBe('valid');
    expect(bySlot.get(1)).toBe('invalid');
    // Empty slots are skipped for an upgrade drag.
    expect(bySlot.has(2)).toBe(false);
    scene.msRenderer.clearDragHighlights();
    expect(scene.msRenderer.getDragHighlights()).toHaveLength(0);
  }, 60_000);

  it('drops a same-week hand upgrade onto an eligible business free of a second action', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const { upgrade } = setupUpgradeScene(scene, { actions: 1, sameWeek: true });
    const container = await waitForHandStable(scene, upgrade.id);
    const target = scene.getStreetSlotCenter(0);

    await beginDrag(scene, container, {
      resolve: () => findHandCardContainer(scene, upgrade.id),
    });
    await releaseDrag(scene, target.x, target.y);

    await waitForCondition(
      () => scene.state.streetGrid[0]?.level === 1,
      'upgrade applied to the business after the drop',
      10_000,
      scene,
    );

    // Same-week composite: the apply is free (action count unchanged).
    expect(scene.state.actionsRemaining).toBe(1);
    expect(scene.state.resourceBank.coins).toBe(2000 - upgrade.cost);
    expect(scene.state.hand.some((c: any) => c.id === upgrade.id)).toBe(false);
    expect(scene.state.justMovedUpgradeCardId).toBeNull();
    expect(scene.uiPhase).toBe('market');
    expect(scene.undoManager.canUndo()).toBe(true);
  }, 60_000);

  it('drops a held hand upgrade onto an eligible business costing exactly one action', async () => {
    game = await bootGame();
    const scene = getScene(game);
    // Held from a previous week: sameWeek omitted.
    const { upgrade } = setupUpgradeScene(scene, { actions: 1 });
    const container = await waitForHandStable(scene, upgrade.id);
    const target = scene.getStreetSlotCenter(0);

    await beginDrag(scene, container, {
      resolve: () => findHandCardContainer(scene, upgrade.id),
    });
    await releaseDrag(scene, target.x, target.y);

    await waitForCondition(
      () => scene.state.streetGrid[0]?.level === 1,
      'upgrade applied to the business after the drop',
      10_000,
      scene,
    );

    expect(scene.state.actionsRemaining).toBe(0);
    expect(scene.state.hand.some((c: any) => c.id === upgrade.id)).toBe(false);
    expect(scene.undoManager.canUndo()).toBe(true);
  }, 60_000);

  it('rejects a drop on an ineligible business with a snap-back and no action spent', async () => {
    game = await bootGame();
    const scene = getScene(game);
    // Slot 0 holds an eligible level-0 business (so pickup ENGAGES), while
    // slot 1 holds a level-1 business — ineligible for this level-0 upgrade.
    // Dropping on slot 1 must snap the card back and spend nothing.
    const { biz, upgrade } = setupUpgradeScene(scene, { actions: 1 });
    scene.state.streetGrid[1] = { ...biz, id: 'ineligible-lvl1', level: 1 };
    scene.refreshAll();

    let container = await waitForHandStable(scene, upgrade.id);
    const originX = container.x;
    const originY = container.y;
    const target = scene.getStreetSlotCenter(1);

    // Pickup is allowed (an eligible business exists on slot 0), so the drag
    // engages; the drop-zone rejects slot 1 and the card snap-backs.
    container = await beginDrag(scene, container, {
      resolve: () => findHandCardContainer(scene, upgrade.id),
    });
    await releaseDrag(scene, target.x, target.y, 500);

    expect(container.x).toBeCloseTo(originX, 0);
    expect(container.y).toBeCloseTo(originY, 0);
    expect(scene.state.hand.some((c: any) => c.id === upgrade.id)).toBe(true);
    expect(scene.state.streetGrid[0]?.level).toBe(0);
    expect(scene.state.streetGrid[1]?.level).toBe(1);
    expect(scene.state.actionsRemaining).toBe(1);
    expect(scene.state.resourceBank.coins).toBe(2000);
    expect(scene.undoManager.canUndo()).toBe(false);
  }, 60_000);

  it('keeps the click-to-apply flow working after a drag gesture (coexistence)', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const { upgrade } = setupUpgradeScene(scene, { actions: 1, sameWeek: true });
    let container = await waitForHandStable(scene, upgrade.id);

    // First a full drag that snap-backs (release far from the street).
    container = await beginDrag(scene, container, {
      resolve: () => findHandCardContainer(scene, upgrade.id),
    });
    await releaseDrag(scene, GAME_W - 40, GAME_H - 40);

    // The hand was rebuilt by the snap-back flow; re-resolve the container.
    container = await waitForHandStable(scene, upgrade.id);
    const originX = container.x;
    const originY = container.y;

    // A pure click below the drag threshold reaches the click path.
    dispatchMouse('mousedown', originX, originY);
    dispatchMouse('mouseup', originX, originY);
    stepGame(scene);

    await waitForCondition(
      () => scene.uiPhase === 'placing-from-hand' && scene.pendingHandIndex === 0,
      'pure click after the drag reaches onHandUpgradeCardClick',
      10_000,
      scene,
    );
    expect(scene.state.hand.some((c: any) => c.id === upgrade.id)).toBe(true);
  }, 60_000);
});

describe('Main Street hand business drag-drop (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(async () => {
    await clearSaveStore(game?.scene.getScene('MainStreetScene') as Scene | undefined);
    destroyGame(game);
    game = null;
    try { localStorage.removeItem(TUTORIAL_STATE_STORAGE_KEY); } catch { /* ignore */ }
  });

  it('drops a hand business onto an empty slot at listed cost, spending one action', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const card = setupBusinessScene(scene, { actions: 1, coins: 2000 });
    const container = await waitForHandStable(scene, card.id);
    const target = scene.getStreetSlotCenter(0);

    await beginDrag(scene, container, {
      resolve: () => findHandCardContainer(scene, card.id),
    });
    await releaseDrag(scene, target.x, target.y);

    await waitForCondition(
      () => scene.state.streetGrid[0]?.id === card.id,
      'business placed on the empty slot after the drop',
      10_000,
      scene,
    );

    // Held business: listed cost + one action, through the undoable click flow.
    expect(scene.state.actionsRemaining).toBe(0);
    expect(scene.state.resourceBank.coins).toBe(2000 - card.cost);
    expect(scene.state.hand.some((c: any) => c.id === card.id)).toBe(false);
    expect(scene.uiPhase).toBe('market');
    expect(scene.undoManager.canUndo()).toBe(true);
  }, 60_000);

  it('snaps a hand business back when dropped on an occupied slot', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const card = setupBusinessScene(scene, { actions: 1, coins: 2000 });
    // Occupy slot 0; the drop there must be rejected.
    scene.state.streetGrid[0] = {
      family: 'business', id: 'occupied-biz', name: 'Occupied', cost: 1,
      baseIncome: 1, synergyTypes: ['Food'], maxLevel: 1, level: 0,
      incomeBonus: 0, synergyRangeBonus: 0, reputationBonus: 0, appliedUpgrades: [],
    } as any;
    scene.refreshAll();

    let container = await waitForHandStable(scene, card.id);
    const originX = container.x;
    const originY = container.y;
    const target = scene.getStreetSlotCenter(0);

    // A second empty slot keeps the pickup valid, so the drag engages and the
    // drop-zone rejects the occupied slot (snap-back).
    container = await beginDrag(scene, container, {
      resolve: () => findHandCardContainer(scene, card.id),
    });
    await releaseDrag(scene, target.x, target.y, 500);

    expect(container.x).toBeCloseTo(originX, 0);
    expect(container.y).toBeCloseTo(originY, 0);
    expect(scene.state.hand.some((c: any) => c.id === card.id)).toBe(true);
    expect(scene.state.streetGrid[0]?.id).toBe('occupied-biz');
    expect(scene.state.actionsRemaining).toBe(1);
    expect(scene.state.resourceBank.coins).toBe(2000);
    expect(scene.undoManager.canUndo()).toBe(false);
  }, 60_000);

  it('refuses pickup when no affordable empty slot exists', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const card = setupBusinessScene(scene, { actions: 1, coins: 0 });
    const container = await waitForHandStable(scene, card.id);
    const originX = container.x;
    const originY = container.y;

    const dragged = await beginDrag(scene, container, {
      expectEngage: false,
      resolve: () => findHandCardContainer(scene, card.id),
    });
    await releaseDrag(scene, scene.getStreetSlotCenter(0).x, scene.getStreetSlotCenter(0).y, 400);

    expect(dragged.x).toBeCloseTo(originX, 0);
    expect(dragged.y).toBeCloseTo(originY, 0);
    expect(scene.state.hand.some((c: any) => c.id === card.id)).toBe(true);
    expect(scene.state.streetGrid[0]).toBeNull();
    expect(scene.undoManager.canUndo()).toBe(false);
  }, 60_000);
});
