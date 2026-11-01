/**
 * Main Street: Hint button and hint subsystem removed (browser)
 *
 * Replacement for the deleted `tests/main-street/hint-bar-placement.browser.test.ts`
 * and `tests/main-street/hint.test.ts` (MS-0MVPWQLIH008R5M3, parent AC5).
 * Boots the real MainStreetScene and asserts:
 *
 *   AC1: no Hint button is rendered in the HUD in any phase.
 *   AC2: the action row reserves no hint slot — End Turn stays right-aligned
 *        and the remaining buttons sit immediately beside it (no 104px gap).
 *   AC3: no market card or street slot is highlighted as a hint after
 *        selection actions (no `0x44ffff` hint stroke anywhere).
 *   AC4: no hint subsystem state exists on the scene or layout
 *        (`hintUsedThisTurn` / `hintedCardId` / `hintedSlotIndex` /
 *        `onHintClick` / `hintButtonW`).
 *   AC5: the shared HintBar was removed by MS-0MVPWQK3U003DIR6 and stays
 *        gone — no persistent instruction line at any phase.
 *
 * The tutorial banking-hint system is unrelated and out of scope; its tests
 * keep passing unchanged.
 *
 * @module tests/main-street/hint-removal.browser
 */

import { describe, it, expect, afterEach } from 'vitest';
import Phaser from 'phaser';
import { waitForScene } from '@core-tests/helpers/waitForScene';
import { TUTORIAL_STATE_STORAGE_KEY } from '../../src/TutorialState';
import { canPurchaseBusiness, getEmptySlots } from '../../src/MainStreetMarket';

const GAME_W = 1280;
const GAME_H = 720;

/** The hint highlight stroke colour once used by the removed hint subsystem. */
const HINT_STROKE = 0x44ffff;

/**
 * Clear persistent storage (localStorage + IndexedDB) so a checkpoint saved
 * by another test (or a previous run) cannot surface the resume overlay.
 */
async function clearPersistentStorage(): Promise<void> {
  try { localStorage.clear(); } catch { /* ignore */ }
  try {
    let names: string[] = ['save-load-store'];
    if (typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function') {
      try {
        names = (await Promise.race([
          indexedDB.databases(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('databases timeout')), 2000)),
        ])).map((d: IDBDatabaseInfo) => d.name).filter((n): n is string => !!n);
      } catch { /* fall back to the default name */ }
    }
    await Promise.race([
      Promise.all(
        names.map(
          (n) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(n);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve();
              req.onblocked = () => resolve();
            }),
        ),
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch { /* ignore */ }
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

  const { createMainStreetGame } = await import(
    '../../src/createMainStreetGame'
  );
  const game = createMainStreetGame({
    type: Phaser.CANVAS,
    parent: 'game-container',
    width: GAME_W,
    height: GAME_H,
  });
  await waitForScene(game, 'MainStreetScene');
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

/** Labels of all action buttons currently in the action container. */
function actionButtonLabels(scene: Scene): string[] {
  const labels: string[] = [];
  for (const entry of scene.actionContainer?.list ?? []) {
    const children: any[] = Array.isArray(entry?.list) ? entry.list : [];
    const text = children.find((c: any) => c?.type === 'Text' && typeof c.text === 'string');
    if (text !== undefined) labels.push(String(text.text));
  }
  return labels;
}

/** Bounding boxes of the interactive action buttons (background rects). */
function actionButtonRects(scene: Scene): Array<{ label: string; x: number; w: number }> {
  const rects: Array<{ label: string; x: number; w: number }> = [];
  for (const entry of scene.actionContainer?.list ?? []) {
    const children: any[] = Array.isArray(entry?.list) ? entry.list : [];
    const text = children.find((c: any) => c?.type === 'Text' && typeof c.text === 'string');
    const bg = children.find((c: any) => c?.type === 'Rectangle' && typeof c.setInteractive === 'function');
    if (text !== undefined && bg !== undefined) {
      // The background is centred in the button container: absolute left = container.x - w/2.
      rects.push({
        label: String(text.text),
        x: entry.x - bg.width / 2,
        w: bg.width,
      });
    }
  }
  return rects;
}

function hasHintButton(scene: Scene): boolean {
  return actionButtonLabels(scene).some((label) => label === 'Hint' || label === 'Hint \u2713');
}

/** Any shape in a container tree stroked with the hint highlight colour. */
function findHintHueStrokes(node: { list?: any[] }, depth = 0): number {
  let found = 0;
  for (const obj of node.list ?? []) {
    if (obj?.strokeColor === HINT_STROKE) found += 1;
    if (Array.isArray(obj?.list)) found += findHintHueStrokes(obj, depth + 1);
  }
  return found;
}

describe('Main Street has no Hint button or hint subsystem (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    const moduleUrl = (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE_URL__;
    if (typeof moduleUrl === 'string' && moduleUrl.startsWith('blob:')) {
      URL.revokeObjectURL(moduleUrl);
    }
    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE__;
    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE_URL__;
    delete (globalThis as unknown as Record<string, unknown>).__TF_PLAY_COUNT__;
    destroyGame(game);
    game = null;
    localStorage.removeItem(TUTORIAL_STATE_STORAGE_KEY);
  });

  it('renders no Hint button and reserves no hint slot in the action row', async () => {
    game = await bootGame();
    const scene = getScene(game);
    await waitForMarketReady(scene);
    await waitForSettled(scene);

    // AC1: no Hint button in the market action row.
    expect(hasHintButton(scene)).toBe(false);

    // AC4: no hint subsystem state on scene or layout.
    expect(scene.hintUsedThisTurn).toBeUndefined();
    expect(scene.hintedCardId).toBeUndefined();
    expect(scene.hintedSlotIndex).toBeUndefined();
    expect(scene.onHintClick).toBeUndefined();
    expect(scene.createHintButton).toBeUndefined();
    expect(scene.layout?.hintButtonW).toBeUndefined();

    // AC2: End Turn stays right-aligned at gameW - 24.
    const rects = actionButtonRects(scene);
    const endTurn = rects.find((r) => r.label === 'End Turn');
    expect(endTurn).toBeTruthy();
    expect(endTurn!.x + endTurn!.w).toBe(scene.layout.gameW - 24);
    // The full action rect no longer reserves the hint slot (its width is
    // just the End Turn button now, not +12+hintButtonW).
    expect(scene.getSectionRectsForTest().action.w).toBe(scene.layout.actionButtonW);

    // AC2: no reserved hint slot — the label immediately left of End Turn
    // sits exactly 12px away (a lingering hint slot would gap by 116px).
    const sorted = [...rects].sort((a, b) => b.x - a.x);
    expect(sorted[0].label).toBe('End Turn');
    const nextLeft = sorted[1];
    expect(nextLeft).toBeDefined();
    expect(endTurn!.x - (nextLeft.x + nextLeft.w)).toBe(12);

    // AC5: no persistent instruction/hint line is rendered.
    expect(scene.hintBar).toBeUndefined();
    expect(scene.instructionText).toBeUndefined();
  });

  it('renders no Hint button while placing from hand', async () => {
    game = await bootGame();
    const scene = getScene(game);
    await waitForMarketReady(scene);
    await waitForSettled(scene);

    scene.state.resourceBank.coins = 2000;
    const business = scene.state.market.cards.find((c: any) =>
      c && canPurchaseBusiness(scene.state, c.id, getEmptySlots(scene.state)[0]).legal,
    );
    expect(business).toBeTruthy();
    scene.onBusinessCardClick(business);
    await waitForCondition(
      () => scene.state.hand?.some((c: any) => c.id === business.id),
      'business moved to hand',
    );
    scene.onHandBusinessCardClick(0);
    await waitForCondition(
      () => scene.uiPhase === 'placing-from-hand',
      'placing-from-hand phase',
    );

    expect(hasHintButton(scene)).toBe(false);
    expect(scene.hintUsedThisTurn).toBeUndefined();
    expect(scene.hintBar).toBeUndefined();
    expect(scene.instructionText).toBeUndefined();
  });

  it('does not highlight any market card or street slot as a hint', async () => {
    game = await bootGame();
    const scene = getScene(game);
    await waitForMarketReady(scene);
    await waitForSettled(scene);

    // Market: no card carries the hint stroke hue after a selection action.
    scene.onBusinessCardClick(scene.state.market.cards[0]);
    await wait(120);
    expect(findHintHueStrokes(scene.marketContainer)).toBe(0);

    // Street: no empty slot (or placed card) is stroked with the hint hue.
    expect(findHintHueStrokes(scene.streetContainer)).toBe(0);
  });

  it('keeps the action row position independent of the removed line and button', async () => {
    game = await bootGame();
    const scene = getScene(game);
    await waitForMarketReady(scene);

    const rects = scene.getSectionRectsForTest();
    expect(rects.action.y).toBe(scene.layout.actionY + 4);
    expect(rects.action.h).toBe(scene.layout.actionButtonH);
    expect(rects.action).not.toHaveProperty('instruction');
  });
});
