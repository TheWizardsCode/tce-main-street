/**
 * Main Street: no persistent instruction/hint line (browser)
 *
 * Rewritten for MS-0MVPWQK3U003DIR6 (parent AC4). The persistent bottom-band
 * instruction/hint line (shared `HintBar` + `instructionText`) is gone. These
 * browser tests boot the real MainStreetScene and assert:
 *
 *   AC1: no `hintBar`/`instructionText` exists on the scene at all.
 *   AC2: entering placing-from-hand renders no persistent inline text in the
 *        action container and surfaces no guidance pop text.
 *   AC3: Cancel returns to market without resurrecting a persistent line.
 *
 * @module tests/main-street/hint-bar-placement.browser
 */

import { describe, it, expect, afterEach } from 'vitest';
import Phaser from 'phaser';
import { waitForScene } from '@core-tests/helpers/waitForScene';
import { TUTORIAL_STATE_STORAGE_KEY } from '../../src/TutorialState';
import { canPurchaseBusiness, getEmptySlots } from '../../src/MainStreetMarket';

const GAME_W = 1280;
const GAME_H = 720;

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

/** Last surfaced transient feedback text ('' when none). */
function feedbackText(scene: Scene): string {
  return String(scene.lastFeedback?.text ?? '');
}

/** All rendered text labels in the scene root (including transient pop text). */
function renderedTexts(scene: Scene): string[] {
  return ((scene.children?.list ?? []) as any[])
    .filter((o) => o?.type === 'Text' && typeof o.text === 'string')
    .map((o) => String(o.text));
}

/** True if any text object remains rendered inline in the action container. */
function hasInlineActionText(scene: Scene): boolean {
  const list = scene.actionContainer?.list ?? [];
  return list.some((entry: any) => {
    if (entry?.text === undefined || entry?.type !== 'Text') return false;
    // The actions-remaining counter is a legitimate standalone readout in the
    // action cluster (CG-0MUFAITX70081W41) — not an inline placement hint.
    if (/\d+\s+actions?\s+left/i.test(String(entry.text))) return false;
    // Any other standalone text directly in the action container is an
    // inline hint, which the HintBar AC forbids (nested button text is fine).
    return true;
  });
}

/** Find the interactive Cancel button inside the action container and click it. */
async function clickCancelButton(scene: Scene): Promise<void> {
  const list: any[] = scene.actionContainer?.list ?? [];
  const cancel = list.find((entry: any) => {
    if (!entry?.list) return false;
    return entry.list.some((child: any) => child?.text === 'Cancel');
  });
  expect(cancel, 'Cancel button should exist in the action container').toBeTruthy();
  const bg = cancel.list.find((child: any) => typeof child?.setInteractive === 'function');
  expect(bg, 'Cancel button background').toBeTruthy();
  bg.emit('pointerdown');
  await wait(60);
}

describe('Main Street has no persistent instruction line (browser)', () => {
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

  it('creates no hint bar and shows no persistent placement line', async () => {
    game = await bootGame();
    const scene = getScene(game);
    await waitForMarketReady(scene);
    await waitForSettled(scene);

    // AC1: neither the shared HintBar nor the legacy instruction text exists.
    expect(scene.hintBar).toBeUndefined();
    expect(scene.instructionText).toBeUndefined();

    scene.state.resourceBank.coins = 2000;
    const targetSlot = getEmptySlots(scene.state)[0];
    expect(targetSlot).toBeGreaterThanOrEqual(0);
    const business = scene.state.market.cards.find((c: any) =>
      c && canPurchaseBusiness(scene.state, c.id, targetSlot).legal,
    );
    expect(business).toBeTruthy();

    scene.onBusinessCardClick(business);
    await waitForCondition(
      () => scene.state.hand?.some((c: any) => c.id === business.id),
      'business moved to hand',
    );

    // Enter placing-from-hand by clicking the hand card.
    scene.onHandBusinessCardClick(0);
    await waitForCondition(
      () => scene.uiPhase === 'placing-from-hand',
      'placing-from-hand phase',
    );

    // AC2: the phase guidance line is dropped — no persistent text in the
    // action container and no guidance pop text is surfaced (the earlier
    // move-to-hand confirmation legitimately remains in the feedback record).
    expect(hasInlineActionText(scene)).toBe(false);
    expect(feedbackText(scene)).not.toContain('click an empty slot');

    // AC3: Cancel returns to market with no persistent line.
    await clickCancelButton(scene);
    await waitForCondition(
      () => scene.uiPhase === 'market',
      'back to market after cancel',
    );
    expect(scene.hintBar).toBeUndefined();
    expect(scene.instructionText).toBeUndefined();
    expect(feedbackText(scene)).not.toContain('buy cards from the market');
  });

  it('surfaces a refusal as transient pop text with no persistent line', async () => {
    game = await bootGame();
    const scene = getScene(game);
    await waitForMarketReady(scene);
    await waitForSettled(scene);

    scene.state.resourceBank.coins = 2000;
    scene.state.actionsRemaining = 0;

    const slot = getEmptySlots(scene.state)[0];
    const business = scene.state.market.cards.find((c: any) =>
      c && canPurchaseBusiness(scene.state, c.id, slot).legal,
    );
    expect(business).toBeTruthy();
    scene.onBusinessCardClick(business);

    // The refusal is surfaced through the transient channel and rendered…
    expect(String(scene.lastFeedback?.text ?? '')).toContain('No actions remaining');
    expect(scene.lastFeedback?.kind).toBe('error');
    expect(renderedTexts(scene).some((t) => t.includes('No actions remaining'))).toBe(true);
    // …with no persistent instruction/hint line.
    expect(scene.instructionText).toBeUndefined();
    expect(scene.hintBar).toBeUndefined();
  });

  it('keeps the action row position independent of the removed line', async () => {
    game = await bootGame();
    const scene = getScene(game);
    await waitForMarketReady(scene);

    const rects = scene.getSectionRectsForTest();
    expect(rects).not.toHaveProperty('instruction');
    expect(rects.action.y).toBe(scene.layout.actionY + 4);
    expect(rects.action.h).toBe(scene.layout.actionButtonH);
  });
});
