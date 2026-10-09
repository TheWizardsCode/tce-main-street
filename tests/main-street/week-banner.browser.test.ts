/**
 * Main Street: Week Transition Banner Browser Tests
 *
 * Verifies the week-start banner trigger end to end in a real Phaser scene:
 *
 * 1. `startTurnPhase()` triggers `MainStreetAnimator.animateWeekBanner` with
 *    the current turn — including the first turn (week 1).
 * 2. The banner is skipped while the tutorial is active (its step overlays
 *    carry the guidance) and on checkpoint resume (`skipMarketRefill=true` —
 *    the same week continues).
 * 3. Under reduced motion the trigger still fires (the animator degrades
 *    internally — covered by unit tests).
 *
 * The banner is non-interactive and non-blocking; the market remains fully
 * interactive the whole time.
 *
 * @module tests/main-street/week-banner.browser
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';

// ── Boot helpers (mirrors MainStreetScene.browser.test.ts) ──

/** Key used by TutorialState for the tutorial-offer eligibility flag. */
const TUTORIAL_STATE_KEY = 'tce-main-street-tutorial-state';

async function bootGame(options: { width?: number; height?: number } = {}): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();

  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame(options);
  await waitForScene(game, 'MainStreetScene');
  return game;
}

/** Clears persisted tutorial state so the boot flow shows the offer modal. */
function resetTutorialState(): void {
  try {
    (window as any).localStorage?.removeItem(TUTORIAL_STATE_KEY);
  } catch (_) {
    // ignore in constrained environments
  }
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) {
    game.destroy(true, false);
  }
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

async function waitForCondition(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 25;
  const label = options.label ?? 'condition';
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

interface BannerCall {
  turn: number;
}

function spyOnWeekBanner(scene: Phaser.Scene & Record<string, unknown>): { calls: BannerCall[] } {
  const animator = scene.msAnimator as unknown as {
    animateWeekBanner: (params: BannerCall) => void;
  };
  const original = animator.animateWeekBanner.bind(animator);
  const calls: BannerCall[] = [];
  vi.spyOn(animator, 'animateWeekBanner').mockImplementation((params) => {
    calls.push(params);
    original(params); // run the real implementation so the visuals run
  });
  return { calls };
}

/**
 * Finds a Phaser.Text overlay button by its label. Overlay buttons live on the
 * scene display list and/or inside the HUD container, so search all three
 * locations (they may be parented into `hudContainer`).
 */
function findTextButton(
  scene: Phaser.Scene & Record<string, unknown>,
  matcher: (text: string) => boolean,
): Phaser.GameObjects.Text | undefined {
  const allTexts: Phaser.GameObjects.Text[] = [];
  const displayList = (scene as any).displayList?.getAll?.() ?? [];
  const children = (scene as any).children?.getAll?.() ?? [];
  const hud = (scene as any).hudContainer?.list ?? (scene as any).hudContainer?.getAll?.() ?? [];
  for (const obj of [...displayList, ...children, ...hud]) {
    if (obj instanceof Phaser.GameObjects.Text) allTexts.push(obj as Phaser.GameObjects.Text);
  }
  return allTexts.find((t) => matcher(t.text ?? ''));
}

/**
 * Clears persisted run checkpoints/campaign progress. The SaveLoadStore lives
 * in IndexedDB, which is origin-scoped and shared across browser test files;
 * without this a confirmed game here suppresses the tutorial offer (via a
 * saved checkpoint) in a later file.
 */
async function clearSaveStore(scene: Phaser.Scene & Record<string, unknown>): Promise<void> {
  try {
    await (scene as any).saveStore?.clear?.();
  } catch (_) {
    // ignore in constrained environments
  }
}

describe('MainStreet week banner', () => {
  let game: Phaser.Game | null = null;

  afterEach(async () => {
    if (game) {
      const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;
      await clearSaveStore(scene);
    }

    const moduleUrl = (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE_URL__;
    if (typeof moduleUrl === 'string' && moduleUrl.startsWith('blob:')) {
      URL.revokeObjectURL(moduleUrl);
    }

    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE__;
    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE_URL__;
    delete (globalThis as unknown as Record<string, unknown>).__TF_PLAY_COUNT__;
    // Clear persisted tutorial state + any checkpoints so tests do not
    // contend with each other's boot-time overlays (mitigation from the
    // reverted WIP: each test destroys its game and clears storage).
    resetTutorialState();
    try { (window as any).localStorage?.clear(); } catch (_) { /* ignore */ }
    destroyGame(game);
    game = null;
  });

  it('fires the banner with the current turn on a new-week start (including week 1)', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;
    // Ensure the tutorial is not active so the banner is eligible.
    (scene as unknown as { tutorialController?: unknown }).tutorialController = undefined;

    const { calls } = spyOnWeekBanner(scene);

    (scene.state as { phase: string }).phase = 'WeekStart';
    (scene.msTurnController as unknown as { startTurnPhase: (skipMarketRefill?: boolean) => void }).startTurnPhase();

    await waitForCondition(() => calls.length >= 1, { timeoutMs: 5000, label: 'week banner trigger' });
    expect(calls).toHaveLength(1);
    expect(calls[0].turn).toBe((scene.state as { turn: number }).turn);
  }, 30_000);

  it('does NOT fire while the tutorial is active or on checkpoint resume', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;

    const { calls } = spyOnWeekBanner(scene);

    // Tutorial active → skipped.
    (scene as unknown as { tutorialController?: unknown }).tutorialController = { isActive: true };
    (scene.state as { phase: string }).phase = 'WeekStart';
    (scene.msTurnController as unknown as { startTurnPhase: (skipMarketRefill?: boolean) => void }).startTurnPhase();
    expect(calls).toHaveLength(0);

    // Checkpoint resume (same week continues) → skipped.
    (scene as unknown as { tutorialController?: unknown }).tutorialController = undefined;
    (scene.state as { phase: string }).phase = 'WeekStart';
    (scene.msTurnController as unknown as { startTurnPhase: (skipMarketRefill?: boolean) => void }).startTurnPhase(true);
    expect(calls).toHaveLength(0);
  }, 30_000);


  // ── Deferral tests (CG-0MSZE2PY7007J6XA) ──────────────────
  //
  // These verify the week-banner is deferred at boot until the player
  // commits to playing: (a) no banner while the tutorial offer modal is
  // waiting for a choice; (b) the deferred banner fires exactly once after
  // the player skips the tutorial offer.

  it('does NOT fire the banner at boot while the tutorial offer modal is waiting for a choice', async () => {
    resetTutorialState();
    try { (window as any).localStorage?.clear(); } catch (_) { /* ignore */ }
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;

    // Spy AFTER boot so we measure only post-boot banner triggers.
    const { calls } = spyOnWeekBanner(scene);

    // Tutorial offer modal should be waiting for a choice (fresh tutorial state
    // + no checkpoint in a clean browser). Wait for it to become visible.
    await waitForCondition(() => {
      const modal = (scene as unknown as { tutorialOfferModal?: { isVisible: boolean } }).tutorialOfferModal;
      return modal?.isVisible === true;
    }, { timeoutMs: 5000, intervalMs: 25, label: 'tutorial offer modal visible' });

    // Give any straggling async boot callbacks a chance to fire the banner.
    await new Promise((r) => setTimeout(r, 300));

    // The deferred banner must NOT have played while the modal is up.
    expect(calls).toHaveLength(0);
    // And the deferred flag is still pending.
    expect((scene as unknown as { deferredWeekBanner: boolean }).deferredWeekBanner).toBe(true);
  }, 30_000);

  it('keeps the banner deferred while the mode selector waits, then fires it exactly once on mode confirm', async () => {
    resetTutorialState();
    try { (window as any).localStorage?.clear(); } catch (_) { /* ignore */ }
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;

    // Spy AFTER boot so we measure only post-boot banner triggers.
    const { calls } = spyOnWeekBanner(scene);

    // The tutorial offer is the first blocking modal.
    await waitForCondition(() => {
      const modal = (scene as unknown as { tutorialOfferModal?: { isVisible: boolean } }).tutorialOfferModal;
      return modal?.isVisible === true;
    }, { timeoutMs: 5000, intervalMs: 25, label: 'tutorial offer modal visible' });
    expect(calls).toHaveLength(0);

    // Skip the offer through the modal's real onSkip wiring. Under the
    // reordered boot flow (MS-0MV0319OC002H15F) this presents the New Game
    // mode selector next — it no longer plays the banner directly.
    const skipBtn = findTextButton(scene, (text) => text.toLowerCase().includes('skip'));
    expect(skipBtn).toBeTruthy();
    if (!skipBtn) return;
    skipBtn.emit('pointerdown');

    await waitForCondition(() => {
      const overlay = (scene as unknown as { newGameOverlay?: { isVisible: boolean } }).newGameOverlay;
      return overlay?.isVisible === true;
    }, { timeoutMs: 5000, intervalMs: 25, label: 'new game selector visible after skip' });

    // The banner must stay deferred while the selector waits for a choice.
    // Give any straggling async boot callbacks a chance to fire it.
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toHaveLength(0);
    expect((scene as unknown as { deferredWeekBanner: boolean }).deferredWeekBanner).toBe(true);

    // Confirm the default (single-player) mode: the player has now committed
    // to playing, so the deferred banner fires exactly once.
    const startBtn = findTextButton(scene, (text) => text.toLowerCase().includes('start game'));
    expect(startBtn).toBeTruthy();
    if (!startBtn) return;
    startBtn.emit('pointerdown');

    await waitForCondition(() => calls.length >= 1, { timeoutMs: 5000, label: 'deferred week banner after mode confirm' });
    expect(calls).toHaveLength(1);
    expect(calls[0].turn).toBe((scene.state as { turn: number }).turn);
    // The flag is cleared after firing (fires exactly once).
    expect((scene as unknown as { deferredWeekBanner: boolean }).deferredWeekBanner).toBe(false);
  }, 30_000);
});