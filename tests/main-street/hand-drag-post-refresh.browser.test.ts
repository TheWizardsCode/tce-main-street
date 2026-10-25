/**
 * Main Street: hand-drag regression after a refresh cycle
 * (MS-0MVK4E56S0059JPY, parent MS-0MVJN9UDS005312W).
 *
 * Pins the hand-drag behaviour the consumer reported ("cards cannot be
 * dragged and dropped from the hand") against the refresh paths that the
 * original hand-drag suite did not cover. Findings from the repro item
 * (MS-0MVK4E4KU002KU23) refuted the refresh cycle itself: registration
 * survives every refresh path; the actual defect is the **click-select then
 * drag** path — clicking a hand card leaves `uiPhase='placing-from-hand'`
 * and `canPickUpHandCard` (`MainStreetTurnControllerDragDrop.ts:242`)
 * vetoes any pickup while `uiPhase !== 'market'`, so the drag manager
 * silently discards the drop.
 *
 * Therefore the cases below drive the click-select-then-drag sequence (drag
 * a hand card after click-selecting it) for business, community-space and
 * upgrade families. They were authored `it.fails` (the repo's test-first
 * tracer-bullet convention) and FAILED on `dev` before the fix; the
 * implementing fix (MS-0MVK4E5M00021XEY) flipped them to plain `it`. The
 * other green cases pin the paths that already held: post-refresh direct
 * drags (AC3), click-vs-drag coexistence after a refresh (AC4) and event
 * cards staying click-only (AC5). AC8: the failing assertion output is
 * recorded on the work item.
 *
 * Assertions go through the scene's public interaction surface and the
 * state it mutates (`state.hand`, `state.streetGrid`, action/coin budget,
 * `renderer.dragDropRegistered`) — never source greps.
 *
 * @module tests/main-street/hand-drag-post-refresh.browser
 */

import { afterEach, describe, expect, it } from 'vitest';
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
 * Wait for the hand container to stabilise (SVG prewarm can rebuild it).
 */
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
    // Fail safe: release at the DRAG position, never at the resting origin.
    // A mouseup at rest after a failed drag would be read by the card's
    // pointerup handler as a click (distance 0 < threshold) — toggling a
    // click-selected card's selection off and masking the very veto the
    // regression tests must observe.
    dispatchMouse('mouseup', originX + 60, originY + 20);
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

/** A pure click (below the drag threshold) at the container's centre. */
function pureClick(scene: Scene, container: any): void {
  dispatchMouse('mousedown', container.x, container.y);
  dispatchMouse('mouseup', container.x, container.y);
  stepGame(scene);
}

/** A level-0 upgrade plus a matching base-level business template. */
function makeUpgradeFixture(): { upgrade: UpgradeCard } {
  const upgrades = getUpgradeTemplates();
  const upgrade = upgrades.find((u) => (u.requiredLevel ?? 0) === 0);
  if (!upgrade) throw new Error('No level-0 upgrade templates');
  return { upgrade };
}

/**
 * A single affordable business/community-space card for the hand-drag
 * placement half (same shape as the sibling hand-drag suite uses).
 */
function makeHandCard(name: string, family: 'business' | 'community-space'): BusinessCard {
  const tpl = getBusinessTemplates()[0];
  if (!tpl) throw new Error('No business templates');
  return {
    ...tpl,
    id: `handdrag-${family}-${name}-${tpl.id}`,
    family,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    appliedUpgrades: [],
    cost: Math.min(tpl.cost, 100),
  };
}

/**
 * Place a deterministic business-in-hand setup: the card rests in the HAND
 * (market cleared, street empty), having survived the full refresh cycle.
 */
function setupBusinessScene(
  scene: Scene,
  card: BusinessCard,
  opts: { actions?: number; coins?: number } = {},
): BusinessCard {
  for (let i = 0; i < scene.state.streetGrid.length; i += 1) {
    scene.state.streetGrid[i] = null;
  }
  scene.state.market.cards = [];
  scene.state.hand = [card];
  scene.state.resourceBank.coins = opts.coins ?? 2000;
  scene.state.actionsRemaining = opts.actions ?? 1;
  scene.justMovedHandCardId = null;
  scene.justMovedUpgradeCardId = null;
  scene.pendingHandIndex = null;
  scene.pendingHandJustMoved = false;
  scene.uiPhase = 'market';
  if (scene.settingsPanel) scene.settingsPanel._reducedMotion = true;
  scene.refreshAll();
  return card;
}

/**
 * Place a deterministic upgrade-in-hand / street setup on the live scene:
 * the upgrade rests in the HAND, one matching business sits on slot 0, all
 * other slots are empty, and the full refresh cycle has run.
 */
function setupUpgradeScene(
  scene: Scene,
  upgrade: UpgradeCard,
  opts: { actions?: number; coins?: number; businessLevel?: number } = {},
): UpgradeCard {
  const tpl = getBusinessTemplates().find((t) => t.name === upgrade.targetBusiness);
  if (!tpl) throw new Error(`No business template named "${upgrade.targetBusiness}"`);
  const biz: BusinessCard = {
    ...tpl,
    id: `handdrag-biz-${tpl.id}`,
    family: 'business',
    level: opts.businessLevel ?? 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    appliedUpgrades: [],
  };
  scene.state.streetGrid[0] = biz;
  for (let i = 1; i < scene.state.streetGrid.length; i += 1) {
    scene.state.streetGrid[i] = null;
  }

  scene.state.market.cards = [];
  scene.state.hand = [upgrade];
  scene.state.resourceBank.coins = opts.coins ?? 2000;
  scene.state.actionsRemaining = opts.actions ?? 1;
  scene.justMovedUpgradeCardId = null;
  scene.justMovedHandCardId = null;
  scene.pendingHandIndex = null;
  scene.pendingHandJustMoved = false;
  scene.uiPhase = 'market';
  if (scene.settingsPanel) scene.settingsPanel._reducedMotion = true;
  scene.refreshAll();

  return upgrade;
}

/** A held event card (select-then-act family) placed in the hand. */
function makeHeldEvent(scene: Scene, id: string): void {
  scene.state.phase = 'MarketPhase';
  scene.state.market.cards = [];
  for (let i = 0; i < scene.state.streetGrid.length; i += 1) {
    scene.state.streetGrid[i] = null;
  }
  scene.state.hand = [{
    family: 'event',
    id,
    name: 'Held Event',
    trigger: 'Investment',
    cost: 3,
    effect: 'test effect',
    target: 'All',
    coinDelta: 1,
    reputationDelta: 0,
  }];
  scene.state.resourceBank.coins = 500;
  scene.state.resourceBank.reputation = 10;
  scene.justMovedHandCardId = null;
  scene.pendingHandIndex = null;
  scene.pendingHandJustMoved = false;
  scene.uiPhase = 'market';
  if (scene.settingsPanel) scene.settingsPanel._reducedMotion = true;
  scene.refreshAll();
  scene.refreshActionButtons();
}

/** Finds a rendered action button container whose label matches. */
function findActionButton(
  scene: Scene,
  matcher: (text: string) => boolean,
): Phaser.GameObjects.Container | null {
  for (const obj of scene.actionContainer?.list ?? []) {
    const container = obj as Phaser.GameObjects.Container;
    if (container.type !== 'Container' || !Array.isArray(container.list)) continue;
    const label = container.list.find((c: any) => c.type === 'Text') as
      | Phaser.GameObjects.Text
      | undefined;
    if (label && typeof label.text === 'string' && matcher(label.text)) return container;
  }
  return null;
}

describe('Main Street hand drag after a refresh cycle (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(async () => {
    await clearSaveStore(game?.scene.getScene('MainStreetScene') as Scene | undefined);
    destroyGame(game);
    game = null;
    try { localStorage.removeItem(TUTORIAL_STATE_STORAGE_KEY); } catch { /* ignore */ }
  });

  it('places a click-selected hand business onto an empty slot after a refresh cycle (AC1/AC8)', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const card = makeHandCard('ClickSelect', 'business');
    setupBusinessScene(scene, card, { actions: 1, coins: 2000 });
    let container = await waitForHandStable(scene, card.id);

    // The click-selected hand card is the defect path: selecting starts the
    // placing-from-hand phase, and the drag must continue that selection.
    pureClick(scene, container);
    await waitForCondition(
      () => scene.uiPhase === 'placing-from-hand' && scene.pendingHandIndex === 0,
      'pure click reached onHandBusinessCardClick',
      10_000,
      scene,
    );

    // The click handler refreshed the hand; re-resolve the fresh container.
    container = await waitForHandStable(scene, card.id);
    const target = scene.getStreetSlotCenter(0);
    await beginDrag(scene, container, {
      deadlineMs: 4_000,
      resolve: () => findHandCardContainer(scene, card.id),
    });
    await releaseDrag(scene, target.x, target.y);

    await waitForCondition(
      () => scene.state.streetGrid[0]?.id === card.id,
      'business placed after click-select then drag',
      5_000,
      scene,
    );

    // Held business: listed cost + one action, through the undoable click flow.
    expect(scene.state.actionsRemaining).toBe(0);
    expect(scene.state.resourceBank.coins).toBe(2000 - card.cost);
    expect(scene.state.hand.some((c: any) => c.id === card.id)).toBe(false);
    expect(scene.uiPhase).toBe('market');
    expect(scene.undoManager.canUndo()).toBe(true);
  }, 60_000);

  it('places a click-selected hand community-space card after a refresh cycle (AC1/AC8)', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const card = makeHandCard('ClickSelect', 'community-space');
    setupBusinessScene(scene, card, { actions: 1, coins: 2000 });
    let container = await waitForHandStable(scene, card.id);

    pureClick(scene, container);
    await waitForCondition(
      () => scene.uiPhase === 'placing-from-hand' && scene.pendingHandIndex === 0,
      'pure click reached onHandBusinessCardClick (community-space)',
      10_000,
      scene,
    );
    container = await waitForHandStable(scene, card.id);

    const target = scene.getStreetSlotCenter(0);
    await beginDrag(scene, container, {
      deadlineMs: 4_000,
      resolve: () => findHandCardContainer(scene, card.id),
    });
    await releaseDrag(scene, target.x, target.y);

    await waitForCondition(
      () => scene.state.streetGrid[0]?.id === card.id,
      'community-space placed after click-select then drag',
      5_000,
      scene,
    );
    expect(scene.state.actionsRemaining).toBe(0);
    expect(scene.state.resourceBank.coins).toBe(2000 - card.cost);
    expect(scene.state.hand.some((c: any) => c.id === card.id)).toBe(false);
    expect(scene.undoManager.canUndo()).toBe(true);
  }, 60_000);

  it('applies a click-selected hand upgrade after a refresh cycle (AC2/AC8)', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const { upgrade } = makeUpgradeFixture();
    setupUpgradeScene(scene, upgrade, { actions: 1 });
    scene.state.market.cards = [];
    // Cover the partial refresh sequence too: the market and the hand are
    // rebuilt in the exact refreshMarket → refreshPlayerHand order.
    scene.refreshMarket();
    scene.refreshPlayerHand();
    let container = await waitForHandStable(scene, upgrade.id);

    pureClick(scene, container);
    await waitForCondition(
      () => scene.uiPhase === 'placing-from-hand' && scene.pendingHandIndex === 0,
      'pure click reached onHandUpgradeCardClick',
      10_000,
      scene,
    );
    container = await waitForHandStable(scene, upgrade.id);

    const target = scene.getStreetSlotCenter(0);
    await beginDrag(scene, container, {
      deadlineMs: 4_000,
      resolve: () => findHandCardContainer(scene, upgrade.id),
    });
    await releaseDrag(scene, target.x, target.y);

    await waitForCondition(
      () => scene.state.streetGrid[0]?.level === 1,
      'upgrade applied after click-select then drag',
      5_000,
      scene,
    );

    // Held upgrade: one action + upgrade cost, through the undoable from-hand apply.
    expect(scene.state.actionsRemaining).toBe(0);
    expect(scene.state.resourceBank.coins).toBe(2000 - upgrade.cost);
    expect(scene.state.hand.some((c: any) => c.id === upgrade.id)).toBe(false);
    expect(scene.uiPhase).toBe('market');
    expect(scene.undoManager.canUndo()).toBe(true);
  }, 60_000);

  it('keeps an unselected hand business draggable after refreshMarket() + refreshPlayerHand() (AC3)', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const card = makeHandCard('AfterPartial', 'business');
    setupBusinessScene(scene, card, { actions: 1, coins: 2000 });

    // The exact partial-refresh sequence named by the findings item.
    scene.refreshMarket();
    scene.refreshPlayerHand();

    const container = await waitForHandStable(scene, card.id);
    const target = scene.getStreetSlotCenter(0);
    await beginDrag(scene, container, {
      resolve: () => findHandCardContainer(scene, card.id),
    });
    await releaseDrag(scene, target.x, target.y);

    await waitForCondition(
      () => scene.state.streetGrid[0]?.id === card.id,
      'business placed after the partial refresh sequence',
      10_000,
      scene,
    );
    expect(scene.state.actionsRemaining).toBe(0);
    expect(scene.state.resourceBank.coins).toBe(2000 - card.cost);
    expect(scene.state.hand.some((c: any) => c.id === card.id)).toBe(false);
    expect(scene.undoManager.canUndo()).toBe(true);
  }, 60_000);

  it('runs a genuine market action (buy from market) and keeps the landed hand card draggable (AC3)', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const marketCard = makeHandCard('BuyFromMarket', 'business');
    scene.state.phase = 'MarketPhase';
    for (let i = 0; i < scene.state.streetGrid.length; i += 1) {
      scene.state.streetGrid[i] = null;
    }
    scene.state.market.cards = [marketCard];
    scene.state.hand = [];
    scene.state.resourceBank.coins = 2000;
    scene.state.actionsRemaining = 2;
    scene.uiPhase = 'market';
    if (scene.settingsPanel) scene.settingsPanel._reducedMotion = true;
    scene.refreshAll();

    // Buy from the market: a real action that runs the full refresh chain
    // (moveToHandCommand → refreshAll) and leaves the card in the hand.
    scene.onBusinessCardClick(marketCard);
    await waitForCondition(
      () => (scene.state.hand ?? []).some((c: any) => c.id === marketCard.id),
      'market card moved to hand by the buy action',
      10_000,
      scene,
    );

    // The landed card is draggable directly (no click-select needed).
    const container = await waitForHandStable(scene, marketCard.id);
    const target = scene.getStreetSlotCenter(0);
    await beginDrag(scene, container, {
      resolve: () => findHandCardContainer(scene, marketCard.id),
    });
    await releaseDrag(scene, target.x, target.y);

    await waitForCondition(
      () => scene.state.streetGrid[0]?.id === marketCard.id,
      'hand-landed card placed after drag',
      10_000,
      scene,
    );
    // Buy consumed 1 action; the same-week placement is free at the +50%
    // premium (the exact click-path rule).
    expect(scene.state.actionsRemaining).toBe(0);
    expect(scene.state.hand.some((c: any) => c.id === marketCard.id)).toBe(false);
    expect(scene.undoManager.canUndo()).toBe(true);
  }, 60_000);

  it('keeps pure clicks reaching the click handlers after a refresh (click-vs-drag coexistence, AC4)', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const business = makeHandCard('CoexistBiz', 'business');
    const { upgrade } = makeUpgradeFixture();
    setupUpgradeScene(scene, upgrade, { actions: 2, coins: 3000 });
    // A mixed hand: upgrade at index 0, business at index 1.
    scene.state.hand = [upgrade, business];
    scene.refreshAll();

    // Upgrade click still reaches onHandUpgradeCardClick after the refresh.
    let container = await waitForHandStable(scene, upgrade.id);
    pureClick(scene, container);
    await waitForCondition(
      () => scene.uiPhase === 'placing-from-hand' && scene.pendingHandIndex === 0,
      'upgrade click reached onHandUpgradeCardClick',
      10_000,
      scene,
    );

    // Toggle the selection back off (Cancel parity), then a business click
    // still reaches onHandBusinessCardClick.
    container = await waitForHandStable(scene, upgrade.id);
    pureClick(scene, container);
    await waitForCondition(
      () => scene.uiPhase === 'market' && scene.pendingHandIndex === null,
      'upgrade re-click cancelled the selection',
      10_000,
      scene,
    );

    container = await waitForHandStable(scene, business.id);
    pureClick(scene, container);
    await waitForCondition(
      () => scene.uiPhase === 'placing-from-hand' && scene.pendingHandIndex === 1,
      'business click reached onHandBusinessCardClick',
      10_000,
      scene,
    );
    expect(scene.state.hand.some((c: any) => c.id === business.id)).toBe(true);
  }, 60_000);

  it('keeps hand event cards click-only after a refresh: never draggable, select-then-act intact (AC5)', async () => {
    game = await bootGame();
    const scene = getScene(game);
    makeHeldEvent(scene, 'held-event-post-refresh');
    const eventContainer = scene.msRenderer.handView.getSpriteAt(0);
    expect(eventContainer).toBeTruthy();

    // The registry the renderer maintains holds no draggable for the event:
    // event cards are never registered (drag registration is business,
    // community-space and upgrade only).
    for (const registered of scene.msRenderer.dragDropRegistered ?? []) {
      expect(registered?.name).not.toBe('ms-hand-card-held-event-post-refresh');
    }

    // A drag gesture: the container never follows the pointer (no drag
    // starts), nothing is placed, and the card stays in the hand. The
    // gesture's pointer-down is the ordinary click, so it must reach the
    // select-then-act flow instead of starting a drag.
    const originX = eventContainer.x;
    const originY = eventContainer.y;
    await beginDrag(scene, eventContainer, {
      expectEngage: false,
      resolve: () => scene.msRenderer.handView.getSpriteAt(0),
    });
    await releaseDrag(scene, scene.getStreetSlotCenter(0).x, scene.getStreetSlotCenter(0).y, 400);

    const fresh = scene.msRenderer.handView.getSpriteAt(0);
    expect(fresh.x).toBeCloseTo(originX, 0);
    expect(fresh.y).toBeCloseTo(originY, 0);
    expect(scene.state.hand.some((c: any) => c.id === 'held-event-post-refresh')).toBe(true);
    expect(scene.state.streetGrid[0]).toBeNull();
    expect(scene.undoManager.canUndo()).toBe(false);

    // Select-then-act: the click selected the event (not a drag), and the
    // action bar offers [Play] / [Discard].
    scene.refreshActionButtons();
    await waitForCondition(
      () => scene.uiPhase === 'event-selected' && scene.pendingHandIndex === 0,
      'event click selected the held event',
      10_000,
      scene,
    );
    expect(findActionButton(scene, (t) => t === 'Play')).not.toBeNull();
    expect(findActionButton(scene, (t) => t.startsWith('Discard'))).not.toBeNull();
  }, 60_000);

  it('recovers dragging after a cancelled selection (click again to deselect, then drag) (recovery pin)', async () => {
    game = await bootGame();
    const scene = getScene(game);
    const card = makeHandCard('DeselectRecover', 'business');
    setupBusinessScene(scene, card, { actions: 1, coins: 2000 });
    let container = await waitForHandStable(scene, card.id);

    // Select…
    pureClick(scene, container);
    await waitForCondition(
      () => scene.uiPhase === 'placing-from-hand' && scene.pendingHandIndex === 0,
      'click reached onHandBusinessCardClick',
      10_000,
      scene,
    );
    // …and deselect (click again). The drag must engage afterwards.
    container = await waitForHandStable(scene, card.id);
    pureClick(scene, container);
    await waitForCondition(
      () => scene.uiPhase === 'market' && scene.pendingHandIndex === null,
      'second click cancelled the selection',
      10_000,
      scene,
    );

    container = await waitForHandStable(scene, card.id);
    const target = scene.getStreetSlotCenter(0);
    await beginDrag(scene, container, {
      resolve: () => findHandCardContainer(scene, card.id),
    });
    await releaseDrag(scene, target.x, target.y);

    await waitForCondition(
      () => scene.state.streetGrid[0]?.id === card.id,
      'business placed after deselect-then-drag',
      10_000,
      scene,
    );
    expect(scene.state.actionsRemaining).toBe(0);
    expect(scene.undoManager.canUndo()).toBe(true);
  }, 60_000);
});
