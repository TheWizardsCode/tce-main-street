/**
 * Hand / market card re-click toggle-off browser tests (MS-0MV767QTO008JUDJ).
 *
 * Re-clicking the hand card that is already selected must deselect it and
 * return to the market phase (the same outcome as the action-bar Cancel) —
 * and re-clicking an already-selected market (Development row) card must
 * clear its selection without triggering the card's action. These tests
 * drive the REAL Phaser pointer pipeline (native DOM mouse events at the
 * rendered card positions) so the full input → hit-test → handler path is
 * exercised, exactly the gesture the bug report describes.
 *
 * @module tests/main-street/card-deselect.browser
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import Phaser from 'phaser';
import { waitForScene } from '@core-tests/helpers/waitForScene';
import { TUTORIAL_STATE_STORAGE_KEY } from '../../src/TutorialState';
import { dismissBootModals } from './helpers/bootModals';

const GAME_W = 1280;
const GAME_H = 720;

/** Clear localStorage so persisted tutorial hints cannot surface a modal. */
async function clearPersistentStorage(): Promise<void> {
  try { localStorage.clear(); } catch { /* ignore */ }
}

async function bootGame(): Promise<Phaser.Game> {
  await clearPersistentStorage();
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
  // Reduced-motion keeps transfer animations synchronous, so market→hand
  // moves resolve deterministically under parallel-browser CPU contention.
  const sceneAny = game.scene.getScene('MainStreetScene') as any;
  if (sceneAny?.settingsPanel) sceneAny.settingsPanel._reducedMotion = true;
  await dismissBootModals(sceneAny);
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(
  predicate: () => boolean,
  label: string,
  timeoutMs = 10_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

type Scene = Phaser.Scene & Record<string, any>;

function getScene(game: Phaser.Game): Scene {
  return game.scene.getScene('MainStreetScene') as Scene;
}

async function waitForMarketReady(scene: Scene): Promise<void> {
  await waitForCondition(
    () => scene.state?.market?.cards?.length > 0,
    'market row populated',
  );
}

/** Wait until the market row rendering has settled (no container rebuilds). */
async function waitForSettled(scene: Scene): Promise<void> {
  const firstCard = (): Phaser.GameObjects.GameObject | undefined =>
    (scene.marketContainer?.list ?? []).find(
      (c: any) => c.name?.startsWith?.('ms-market-card-'),
    );
  for (let i = 0; i < 60; i++) {
    await wait(250);
    const now = firstCard();
    if (now === undefined) continue;
    await wait(250);
    if (firstCard() === now) return;
  }
  throw new Error('Timed out waiting for market rendering to settle');
}

/** Dispatch a native DOM MouseEvent at canvas (world) coordinates. */
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

async function clickAt(worldX: number, worldY: number): Promise<void> {
  dispatchMouse('mousedown', worldX, worldY);
  await wait(30);
  dispatchMouse('mouseup', worldX, worldY);
}

/** True while any hand sprite still carries a green selection border. */
function hasHandSelectionBorder(scene: Scene): boolean {
  const sprites = scene.msRenderer?.handView?.getSprites?.() ?? [];
  return sprites.some(
    (sp: any) => !!sp?.getByName?.('hand-selection-border'),
  );
}

/** Last surfaced transient feedback text ('' when none). */
function hintText(scene: Scene): string {
  return String(scene.lastFeedback?.text ?? '');
}

/** First grid-placeable (business/community-space) market card. */
function firstBuyableCard(scene: Scene): any {
  const card = scene.state.market.cards.find(
    (c: any) => c.family === 'business' || c.family === 'community-space',
  );
  expect(card).toBeTruthy();
  return card;
}

describe('Card re-click toggle-off (browser, real pointer pipeline)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
    try { localStorage.removeItem(TUTORIAL_STATE_STORAGE_KEY); } catch { /* ignore */ }
  });

  it('re-clicking the selected hand card deselects it and returns to market', async () => {
    game = await bootGame();
    const scene = getScene(game);
    await waitForMarketReady(scene);
    await waitForSettled(scene);

    // Give the player a business card in hand (real buy-to-hand flow).
    scene.state.resourceBank.coins = 2000;
    scene.state.actionsRemaining = 5;
    const biz = firstBuyableCard(scene);
    scene.onBusinessCardClick(biz);
    await waitForCondition(
      () => scene.state.hand?.some((c: any) => c.id === biz.id),
      'business moved to hand',
    );
    await waitForCondition(() => scene.uiPhase === 'market', 'market phase after move');

    const centers = scene.msRenderer.handView.getCardCenters();
    expect(centers.length).toBeGreaterThanOrEqual(1);

    // First click: select the hand card → placing-from-hand.
    await clickAt(centers[0].x, centers[0].y);
    await waitForCondition(
      () => scene.uiPhase === 'placing-from-hand' && scene.pendingHandIndex === 0,
      'hand card selected via pointer',
    );
    expect(hasHandSelectionBorder(scene)).toBe(true);

    // Side-effect baselines across the toggle-off click.
    const actionsBefore = scene.state.actionsRemaining;
    const coinsBefore = scene.state.resourceBank.coins;
    const logBefore = (scene.state.activityLog ?? []).length;
    const handBefore = (scene.state.hand ?? []).length;

    // Second click on the SAME card: toggle-off (real pointer pipeline).
    await clickAt(centers[0].x, centers[0].y);
    await waitForCondition(() => scene.uiPhase === 'market', 'back to market after re-click');

    expect(scene.pendingHandIndex).toBeNull();
    expect(scene.pendingHandJustMoved).toBe(false);
    expect(hasHandSelectionBorder(scene)).toBe(false);
    // The standard market instruction is a dropped guidance line: cancel must
    // leave no persistent line (the earlier move-to-hand confirmation is the
    // last surfaced feedback and is not a market-instruction reset).
    expect(hintText(scene)).not.toContain('buy cards from the market');
    expect(hintText(scene)).not.toContain('click an empty slot');

    // The card stays in the hand; nothing is placed, spent or logged.
    expect((scene.state.hand ?? []).length).toBe(handBefore);
    expect(scene.state.hand?.some((c: any) => c.id === biz.id)).toBe(true);
    expect(scene.state.actionsRemaining).toBe(actionsBefore);
    expect(scene.state.resourceBank.coins).toBe(coinsBefore);
    expect((scene.state.activityLog ?? []).length).toBe(logBefore);
  });

  it('re-clicking the already-selected market card deselects it and skips its action', async () => {
    game = await bootGame();
    const scene = getScene(game);
    await waitForMarketReady(scene);
    await waitForSettled(scene);

    // Fill the hand so a buy click rejects on capacity — the rejection path
    // (per MS-0MUUDWIXG009IB0W) retains the market selection, which is the
    // exact state the toggle-off must clear.
    scene.state.hand = scene.state.market.cards.slice();
    scene.state.maxHandSize = scene.state.hand.length;
    scene.state.actionsRemaining = 1;
    scene.refreshAll();
    await waitForSettled(scene);

    const target = firstBuyableCard(scene);
    const container = scene.marketContainer.getByName(`ms-market-card-${target.id}`);
    expect(container).toBeTruthy();

    // First click selects the card; the buy action rejects (hand full), so
    // the selection persists — the scenario that motivates toggle-off.
    await clickAt(container.x, container.y);
    await waitForCondition(
      () => scene.marketSelectionManager.getSelected() !== null,
      'market card selected via pointer',
    );

    // Let the illegal-feedback shake settle, then spy on the action so a
    // suppressed action is observable.
    await wait(400);
    const actionSpy = vi.fn();
    scene.onBusinessCardClick = actionSpy;
    const handBefore = (scene.state.hand ?? []).length;

    // Second click on the SAME card: toggle-off — selection cleared, action
    // NOT triggered.
    await clickAt(container.x, container.y);
    await waitForCondition(
      () => scene.marketSelectionManager.getSelected() === null,
      'market card deselected on re-click',
    );
    expect(actionSpy).not.toHaveBeenCalled();
    expect((scene.state.hand ?? []).length).toBe(handBefore);
  });
});
