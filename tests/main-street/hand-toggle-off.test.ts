/**
 * Hand-card re-click toggle-off tests (MS-0MV767QTO008JUDJ).
 *
 * Re-clicking the hand card that is already selected must cancel the pending
 * selection (toggle-off) — the same outcome as pressing the action-bar
 * Cancel button — for all three hand families (business/community-space,
 * upgrade, held event). Clicking a *different* card must still switch the
 * selection.
 *
 * The handler cleanup is exercised at the controller level so the assertions
 * are precise about state, side effects, and the visual deselection call.
 *
 * @module tests/main-street/hand-toggle-off
 */

import { describe, it, expect, vi } from 'vitest';

import { setupMainStreetGame } from '../../src/MainStreetState';
import { MainStreetTurnController } from '../../src/scenes/MainStreetTurnController';

/** Minimal syntactically-valid cards for each hand family. */
const BUSINESS_CARD = { family: 'business', id: 'toggle-biz-1', name: 'Toggle Biz', cost: 3 } as any;
const UPGRADE_CARD = { family: 'upgrade', id: 'toggle-upg-1', name: 'Toggle Upgrade', cost: 2 } as any;
const EVENT_CARD = {
  family: 'event',
  id: 'toggle-evt-1',
  name: 'Toggle Event',
  trigger: 'Investment',
  cost: 1,
  effect: 'test',
  target: 'All',
  coinDelta: 1,
  reputationDelta: 0,
} as any;

/**
 * Creates a mock scene covering every property the hand-click handlers and the
 * shared `cancelHandSelection` cleanup touch, with spies for the observable
 * side effects.
 */
function createMockScene(): any {
  const scene: any = {
    state: setupMainStreetGame({ seed: 'hand-toggle-off-test' }),
    uiPhase: 'market',
    pendingHandIndex: null,
    pendingHandJustMoved: false,
    justMovedHandCardId: null,
    refreshAll: vi.fn(),
    overlayObjects: [],
    hudContainer: null,
    tooltipManager: { hide: vi.fn(), show: vi.fn() },
    gameEvents: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    time: { delayedCall: vi.fn().mockReturnValue({ remove: vi.fn() }) },
    refreshStreetGrid: vi.fn(),
    refreshActionButtons: vi.fn(),
    refreshUndoRedoButtons: vi.fn(),
    refreshAllAction: vi.fn(),
    msLifecycleManager: {
      isTutorialActionAllowed: vi.fn().mockReturnValue({ allowed: true }),
      onTutorialActionComplete: vi.fn(),
    },
    // Undo stack spy: a toggle-off must not execute any command.
    undoManager: { execute: vi.fn(), canUndo: vi.fn().mockReturnValue(false), canRedo: vi.fn().mockReturnValue(false) },
    // Market selection cleanup spy.
    clearMarketSelection: vi.fn(),
    // Renderer selection-highlight spy (null clears every border).
    msRenderer: { updateBusinessHandSelection: vi.fn() },
    cardSvgLoadPromise: Promise.resolve(),
    prewarmVisibleCardTextures: vi.fn().mockResolvedValue(undefined),
    updateSvgDebugOverlay: vi.fn(),
    animateTransferFromMarket: vi.fn().mockResolvedValue(undefined),
    previousCoins: null,
    previousReputation: null,
    transferAnimationCount: 0,
    activeTransferTweens: new Set(),
    activeTransferVisuals: new Set(),
    hiddenTransferSourceCardIds: new Set(),
    layout: { gameW: 1280, gameH: 720, actionY: 620, actionButtonH: 28, actionButtonW: 100 },
  };
  return scene;
}

/** Selects a hand card into the placing-from-hand phase for a known index. */
function primeSelection(scene: any, index: number, phase: 'placing-from-hand' | 'event-selected'): void {
  scene.pendingHandIndex = index;
  scene.pendingHandJustMoved = true;
  scene.uiPhase = phase;
}

describe('Hand card re-click toggle-off (MS-0MV767QTO008JUDJ)', () => {
  describe('business / community-space cards', () => {
    it('re-clicking the selected business card deselects it and returns to market', () => {
      const scene = createMockScene();
      scene.state.hand = [BUSINESS_CARD, { ...BUSINESS_CARD, id: 'toggle-biz-2', name: 'Other Biz' }];
      primeSelection(scene, 0, 'placing-from-hand');
      scene.justMovedHandCardId = BUSINESS_CARD.id;
      scene.state.justMovedUpgradeCardId = 'some-upgrade';

      const controller = new MainStreetTurnController(scene);
      controller.onHandBusinessCardClick(0);

      expect(scene.pendingHandIndex).toBeNull();
      expect(scene.pendingHandJustMoved).toBe(false);
      expect(scene.uiPhase).toBe('market');
      // Visual deselection: the border is removed via a null index.
      expect(scene.msRenderer.updateBusinessHandSelection).toHaveBeenCalledWith(null);
      expect(scene.clearMarketSelection).toHaveBeenCalled();
      // Same-week trackers reset so a re-selected card costs an action again.
      expect(scene.justMovedHandCardId).toBeNull();
      expect(scene.state.justMovedUpgradeCardId).toBeNull();
      // The standard market instruction is a dropped guidance line
      // (MS-0MVPWQK3U003DIR6) — no persistent text after cancel.
      expect(scene.lastFeedback).toBeUndefined();
      // The card stays in hand.
      expect(scene.state.hand.some((c: any) => c.id === BUSINESS_CARD.id)).toBe(true);
    });

    it('produces no action, coin, log or undo side effects on toggle-off', () => {
      const scene = createMockScene();
      scene.state.hand = [BUSINESS_CARD];
      primeSelection(scene, 0, 'placing-from-hand');
      const actionsBefore = scene.state.actionsRemaining;
      const coinsBefore = scene.state.resourceBank.coins;
      const logBefore = (scene.state.activityLog ?? []).length;

      const controller = new MainStreetTurnController(scene);
      controller.onHandBusinessCardClick(0);

      expect(scene.state.actionsRemaining).toBe(actionsBefore);
      expect(scene.state.resourceBank.coins).toBe(coinsBefore);
      expect((scene.state.activityLog ?? []).length).toBe(logBefore);
      expect(scene.undoManager.execute).not.toHaveBeenCalled();
    });

    it('clicking a different business card still switches the selection', () => {
      const scene = createMockScene();
      scene.state.hand = [BUSINESS_CARD, { ...BUSINESS_CARD, id: 'toggle-biz-2', name: 'Other Biz' }];
      primeSelection(scene, 0, 'placing-from-hand');

      const controller = new MainStreetTurnController(scene);
      controller.onHandBusinessCardClick(1);

      expect(scene.pendingHandIndex).toBe(1);
      expect(scene.uiPhase).toBe('placing-from-hand');
      expect(scene.msRenderer.updateBusinessHandSelection).toHaveBeenCalledWith(1);
    });
  });

  describe('upgrade cards', () => {
    it('re-clicking the selected upgrade card deselects it and returns to market', () => {
      const scene = createMockScene();
      scene.state.hand = [UPGRADE_CARD];
      primeSelection(scene, 0, 'placing-from-hand');

      const controller = new MainStreetTurnController(scene);
      controller.onHandUpgradeCardClick(0);

      expect(scene.pendingHandIndex).toBeNull();
      expect(scene.pendingHandJustMoved).toBe(false);
      expect(scene.uiPhase).toBe('market');
      expect(scene.msRenderer.updateBusinessHandSelection).toHaveBeenCalledWith(null);
      expect(scene.clearMarketSelection).toHaveBeenCalled();
      expect(scene.lastFeedback).toBeUndefined();
      expect(scene.state.hand.some((c: any) => c.id === UPGRADE_CARD.id)).toBe(true);
    });

    it('clicking a different upgrade card still switches the selection', () => {
      const scene = createMockScene();
      scene.state.hand = [UPGRADE_CARD, { ...UPGRADE_CARD, id: 'toggle-upg-2', name: 'Other Upgrade' }];
      primeSelection(scene, 0, 'placing-from-hand');

      const controller = new MainStreetTurnController(scene);
      controller.onHandUpgradeCardClick(1);

      expect(scene.pendingHandIndex).toBe(1);
      expect(scene.uiPhase).toBe('placing-from-hand');
      expect(scene.msRenderer.updateBusinessHandSelection).toHaveBeenCalledWith(1);
    });
  });

  describe('held event cards', () => {
    it('re-clicking the selected event card deselects it and returns to market', () => {
      const scene = createMockScene();
      scene.state.hand = [EVENT_CARD];
      primeSelection(scene, 0, 'event-selected');

      const controller = new MainStreetTurnController(scene);
      controller.onHandEventCardClick(0);

      expect(scene.pendingHandIndex).toBeNull();
      expect(scene.pendingHandJustMoved).toBe(false);
      expect(scene.uiPhase).toBe('market');
      expect(scene.msRenderer.updateBusinessHandSelection).toHaveBeenCalledWith(null);
      expect(scene.clearMarketSelection).toHaveBeenCalled();
      expect(scene.lastFeedback).toBeUndefined();
      expect(scene.state.hand.some((c: any) => c.id === EVENT_CARD.id)).toBe(true);
    });

    it('produces no action, coin, log or undo side effects on toggle-off', () => {
      const scene = createMockScene();
      scene.state.hand = [EVENT_CARD];
      primeSelection(scene, 0, 'event-selected');
      const actionsBefore = scene.state.actionsRemaining;
      const coinsBefore = scene.state.resourceBank.coins;
      const logBefore = (scene.state.activityLog ?? []).length;

      const controller = new MainStreetTurnController(scene);
      controller.onHandEventCardClick(0);

      expect(scene.state.actionsRemaining).toBe(actionsBefore);
      expect(scene.state.resourceBank.coins).toBe(coinsBefore);
      expect((scene.state.activityLog ?? []).length).toBe(logBefore);
      expect(scene.undoManager.execute).not.toHaveBeenCalled();
    });

    it('clicking a different event card still switches the selection', () => {
      const scene = createMockScene();
      scene.state.hand = [EVENT_CARD, { ...EVENT_CARD, id: 'toggle-evt-2', name: 'Other Event' }];
      primeSelection(scene, 0, 'event-selected');

      const controller = new MainStreetTurnController(scene);
      controller.onHandEventCardClick(1);

      expect(scene.pendingHandIndex).toBe(1);
      expect(scene.uiPhase).toBe('event-selected');
      expect(scene.msRenderer.updateBusinessHandSelection).toHaveBeenCalledWith(1);
    });
  });
});
