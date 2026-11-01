/**
 * Main Street hand drag-to-place tests (unit).
 *
 * Covers the hand-origin half of the drag-drop feature
 * (MS-0MV76HVE4007AOO0), mirroring the market-upgrade tests in
 * `tests/main-street/drag.test.ts` style:
 *  - pickup validation (`canPickUpHandCard`): hand upgrade vetoed when no
 *    eligible business exists / tutorial gating; hand business vetoed when the
 *    action budget is spent, no affordable empty slot exists, or tutorial
 *    gating; event cards stay click-only;
 *  - drop-zone validation (`canDropHandCard`): upgrade → eligible business
 *    only; business → empty affordable slot only; occupied slot snap-back;
 *  - drop handlers reuse the click-flow commands from the hand:
 *    `onDragDropHandUpgrade` → `applyHandUpgradeToSlot` (same-week composite
 *    free, held = 1 action, undoable) and `onDragDropHandBusiness` →
 *    click-place flow (listed cost, undoable);
 *  - drag-drop module wiring: pickup veto keeps the card in hand with illegal
 *    feedback; invalid drops snap back and spend nothing.
 *
 * @module tests/main-street/hand-drag-drop
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setupMainStreetGame } from '../../src/MainStreetState';
import { MainStreetTurnController } from '../../src/scenes/MainStreetTurnController';
import { UndoRedoManager } from '@core-engine/UndoRedoManager';
import { COMMON_SFX_KEYS } from '@core-engine/SoundManager';
import { getUpgradeTemplates } from '../../src/MainStreetCardsTemplates';
import { unregisterDragDraggables, unregisterHandDraggables } from '../../src/scenes/MainStreetRendererDragDrop';

// ── Mocks ──────────────────────────────────────────────────

/** Minimal Phaser plumbing needed by createDragDropManager. */
function createPhaserMock(): any {
  const tweenTargets: Array<{ x: number; y: number }> = [];
  return {
    tweens: {
      add: vi.fn((config: any) => {
        const targets = Array.isArray(config.targets) ? config.targets : [config.targets];
        for (const t of targets) {
          tweenTargets.push(t);
          if (t && config.x !== undefined) t.x = config.x;
          if (t && config.y !== undefined) t.y = config.y;
        }
        config.onComplete?.();
        return { stop: vi.fn(), destroy: vi.fn() };
      }),
    },
    input: {
      on: vi.fn(),
      off: vi.fn(),
      setDraggable: vi.fn(),
      dragDistanceThreshold: 0,
    },
    sound: { play: vi.fn(), stopByKey: vi.fn(), volume: 1, mute: false },
  };
}

/** Container-shaped draggable (no setTint — like a real Phaser Container). */
function createMockContainer(x = 300, y = 150, depth = 5): any {
  const go: any = {
    x,
    y,
    depth,
    name: '',
    input: null,
    setDepth: vi.fn((d: number) => { go.depth = d; }),
    setInteractive: vi.fn(),
    setName: vi.fn((n: string) => { go.name = n; }),
    on: vi.fn(),
  };
  return go;
}

/**
 * Minimal Main Street scene mock with a real state and undo manager, plus
 * the Phaser plumbing required by the drag-drop module. Extends the
 * market-drag mock with the hand fields (`hand`, `handView`, layout hand
 * anchors, `justMoved*` trackers) the from-hand predicates read.
 */
function createMockScene(overrides: Record<string, unknown> = {}): any {
  const phaser = createPhaserMock();
  const state = setupMainStreetGame({ seed: 'ms-hand-drag-test' });
  // From-hand commands require the engine MarketPhase (validateHandIndex
  // throws otherwise); the real game reaches it via WeekStart flows.
  state.phase = 'MarketPhase';
  state.actionsRemaining = 1;

  const scene: any = {
    state,
    uiPhase: 'market',
    layout: {
      streetCols: 5,
      streetX: 60,
      streetTop: 220,
      slotW: 100,
      slotH: 64,
      slotGap: 8,
      streetRowGap: 8,
      handX: 40,
      handY: 620,
      handCardW: 140,
      handCardH: 80,
      handCenterX: 400,
    },
    settingsPanel: { reducedMotion: false },
    msLifecycleManager: {
      isTutorialActionAllowed: vi.fn().mockReturnValue({ allowed: true }),
      onTutorialActionComplete: vi.fn(),
    },
    tooltipManager: { hide: vi.fn(), show: vi.fn() },
    showBuyAndPlacePremiumDialog: vi.fn((_cardName: string, onProceed: () => void) => {
      scene.premiumDialogOnProceed = onProceed;
    }),
    premiumDialogOnProceed: null,
    selectMarketCardById: vi.fn(),
    clearMarketSelection: vi.fn(),
    hiddenTransferSourceCardIds: new Set(),
    refreshAll: vi.fn(),
    refreshStreetGrid: vi.fn(),
    refreshActionButtons: vi.fn(),
    refreshUndoRedoButtons: vi.fn(),
    gameEvents: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    undoManager: new UndoRedoManager(),
    dragDropManager: undefined,
    animateTransferFromMarket: vi.fn().mockResolvedValue(undefined),
    getStreetSlotCenter: vi.fn((slotIndex: number) => ({ x: 500 + slotIndex, y: 260 })),
    // Hand-view stub: getBasePosition feeds the hand→street transfer source.
    msRenderer: {
      handView: {
        getBasePosition: vi.fn((index: number) => ({ x: 200 + index * 20, y: 620 })),
        getSpriteAt: vi.fn(),
      },
      updateBusinessHandSelection: vi.fn(),
    },
    pendingHandIndex: null,
    pendingHandJustMoved: false,
    justMovedHandCardId: null,
    input: phaser.input,
    tweens: phaser.tweens,
    sound: phaser.sound,
    ...overrides,
  };
  return scene;
}

/** First business/community-space card in the market row, made affordable. */
function pickBusinessCard(scene: any): any {
  const card = scene.state.market.cards.find(
    (c: any) => c.family === 'business' || c.family === 'community-space',
  );
  if (!card) throw new Error('No business card in market for test');
  return { ...card }; // detached copy so later family edits cannot corrupt the market
}

/** First non-event card in hand, made affordable deterministically. */
function putCardInHand(scene: any, card: any): number {
  const hand = scene.state.hand ?? [];
  hand.push(card);
  scene.state.actionsRemaining = 1;
  ensureAffordable(scene, card);
  return hand.length - 1;
}

/** Top up coins past a card's effective cost. */
function ensureAffordable(scene: any, card: any): void {
  scene.state.resourceBank.coins = Math.max(
    scene.state.resourceBank.coins,
    (card.cost ?? 0) + 10,
  );
}

/** A level-0 upgrade plus an eligible base-level business fixture. */
function makeUpgradeFixture(): { biz: any; upgrade: any } {
  const upgrades = getUpgradeTemplates();
  const upgrade = upgrades.find((u: any) => (u.requiredLevel ?? 0) === 0);
  if (!upgrade) throw new Error('No level-0 upgrade templates');
  const biz: any = {
    id: `hand-biz-${upgrade.targetBusiness}`,
    name: upgrade.targetBusiness,
    family: 'business',
    level: 0,
    maxLevel: 2,
    cost: 10,
    baseIncome: 1,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    synergyTypes: ['Culture'],
    appliedUpgrades: [],
    displayName: undefined,
  };
  return { biz, upgrade };
}

/** First empty street slot index (or -1). */
function firstEmptySlot(state: any): number {
  return state.streetGrid.findIndex((slot: any) => slot === null);
}

const POINTER = { x: 0, y: 0 } as any;

// ── Tests ──────────────────────────────────────────────────

describe('MainStreet hand drag-to-place wiring', () => {
  let controller: MainStreetTurnController;
  let scene: any;

  beforeEach(() => {
    scene = createMockScene();
    controller = new MainStreetTurnController(scene);
  });

  describe('canPickUpHandCard (pickup validation)', () => {
    it('allows a hand upgrade when an eligible affordable business exists', () => {
      const { biz, upgrade } = makeUpgradeFixture();
      scene.state.streetGrid[0] = biz;
      putCardInHand(scene, upgrade);
      expect(scene.state.resourceBank.coins).toBeGreaterThanOrEqual(upgrade.cost);
      expect(controller.canPickUpHandCard(upgrade.id)).toBe(true);
    });

    it('vetoes a hand upgrade pickup when no eligible business exists on the street', () => {
      const { upgrade } = makeUpgradeFixture();
      scene.state.streetGrid = scene.state.streetGrid.map(() => null);
      putCardInHand(scene, upgrade);
      expect(controller.canPickUpHandCard(upgrade.id)).toBe(false);
    });

    it('vetoes a hand upgrade pickup when the only matching business is ineligible (level mismatch)', () => {
      const { biz, upgrade } = makeUpgradeFixture();
      scene.state.streetGrid[0] = { ...biz, level: 1 }; // requires level 0
      putCardInHand(scene, upgrade);
      expect(controller.canPickUpHandCard(upgrade.id)).toBe(false);
    });

    it('vetoes a hand upgrade pickup when apply-upgrade tutorial gating forbids it', () => {
      const { biz, upgrade } = makeUpgradeFixture();
      scene.state.streetGrid[0] = biz;
      putCardInHand(scene, upgrade);
      scene.msLifecycleManager.isTutorialActionAllowed = vi.fn().mockReturnValue({ allowed: false });
      expect(controller.canPickUpHandCard(upgrade.id)).toBe(false);
    });

    it('vetoes a hand upgrade pickup when not in the market phase', () => {
      const { biz, upgrade } = makeUpgradeFixture();
      scene.state.streetGrid[0] = biz;
      putCardInHand(scene, upgrade);
      scene.uiPhase = 'placing-from-hand';
      expect(controller.canPickUpHandCard(upgrade.id)).toBe(false);
    });

    it('vetoes a hand upgrade pickup when the card is not in the hand', () => {
      const { biz } = makeUpgradeFixture();
      scene.state.streetGrid[0] = biz;
      expect(controller.canPickUpHandCard('biz-not-in-hand-0')).toBe(false);
    });

    it('allows a hand business pickup when an affordable empty slot exists', () => {
      const card = pickBusinessCard(scene);
      putCardInHand(scene, card);
      expect(firstEmptySlot(scene.state)).toBeGreaterThanOrEqual(0);
      expect(controller.canPickUpHandCard(card.id)).toBe(true);
    });

    it('vetoes a hand business pickup when the action budget is spent', () => {
      const card = pickBusinessCard(scene);
      putCardInHand(scene, card);
      scene.state.actionsRemaining = 0;
      expect(controller.canPickUpHandCard(card.id)).toBe(false);
    });

    it('vetoes a hand business pickup when no affordable empty slot exists', () => {
      const card = pickBusinessCard(scene);
      putCardInHand(scene, card);
      scene.state.resourceBank.coins = 0;
      expect(controller.canPickUpHandCard(card.id)).toBe(false);
    });

    it('vetoes a hand business pickup when every slot is occupied', () => {
      const card = pickBusinessCard(scene);
      putCardInHand(scene, card);
      scene.state.streetGrid = scene.state.streetGrid.map(() => ({
        family: 'business', id: 'filled', name: 'Occupied', cost: 1,
      }));
      expect(controller.canPickUpHandCard(card.id)).toBe(false);
    });

    it('vetoes a hand business pickup when place-business tutorial gating forbids it', () => {
      const card = pickBusinessCard(scene);
      putCardInHand(scene, card);
      scene.msLifecycleManager.isTutorialActionAllowed = vi.fn().mockReturnValue({ allowed: false });
      expect(controller.canPickUpHandCard(card.id)).toBe(false);
    });

    it('rejects event cards in hand (click-only, out of drag scope)', () => {
      const card = pickBusinessCard(scene);
      scene.state.hand.push(card);
      scene.state.hand[scene.state.hand.length - 1].family = 'event';
      expect(controller.canPickUpHandCard(card.id)).toBe(false);
    });
  });

  describe('canDropHandCard (drop-zone validation)', () => {
    it('accepts a hand upgrade onto its eligible business', () => {
      const { biz, upgrade } = makeUpgradeFixture();
      scene.state.streetGrid[0] = biz;
      putCardInHand(scene, upgrade);
      expect(controller.canDropHandCard(upgrade.id, 0)).toBe(true);
    });

    it('rejects a hand upgrade onto an ineligible business', () => {
      const { biz, upgrade } = makeUpgradeFixture();
      scene.state.streetGrid[0] = { ...biz, level: 1 };
      putCardInHand(scene, upgrade);
      expect(controller.canDropHandCard(upgrade.id, 0)).toBe(false);
    });

    it('rejects a hand upgrade onto an empty slot', () => {
      const { upgrade } = makeUpgradeFixture();
      putCardInHand(scene, upgrade);
      expect(controller.canDropHandCard(upgrade.id, 0)).toBe(false);
    });

    it('accepts a hand business onto an affordable empty slot', () => {
      const card = pickBusinessCard(scene);
      putCardInHand(scene, card);
      const slot = firstEmptySlot(scene.state);
      expect(controller.canDropHandCard(card.id, slot)).toBe(true);
    });

    it('rejects a hand business onto an occupied slot', () => {
      const card = pickBusinessCard(scene);
      putCardInHand(scene, card);
      const slot = firstEmptySlot(scene.state);
      scene.state.streetGrid[slot] = { family: 'business', id: 'other-biz', name: 'Other' };
      expect(controller.canDropHandCard(card.id, slot)).toBe(false);
    });

    it('rejects out-of-bounds slots', () => {
      const card = pickBusinessCard(scene);
      putCardInHand(scene, card);
      expect(controller.canDropHandCard(card.id, 999)).toBe(false);
      expect(controller.canDropHandCard(card.id, -1)).toBe(false);
    });

    it('rejects a hand upgrade at an eligible business when the budget is spent (held = 1 action)', () => {
      const { biz, upgrade } = makeUpgradeFixture();
      scene.state.streetGrid[0] = biz;
      putCardInHand(scene, upgrade);
      scene.state.actionsRemaining = 0;
      expect(controller.canDropHandCard(upgrade.id, 0)).toBe(false);
    });
  });

  describe('onDragDropHandUpgrade (drag → apply from hand)', () => {
    it('applies an upgrade from hand and charges one action for a held card', async () => {
      const { biz, upgrade } = makeUpgradeFixture();
      scene.state.streetGrid[0] = biz;
      const handIndex = putCardInHand(scene, upgrade);
      const coinsBefore = scene.state.resourceBank.coins;

      controller.onDragDropHandUpgrade({
        gameObject: createMockContainer(340, 260, 5),
        data: upgrade.id,
        zoneData: 0,
      });

      // The click-flow apply path ran: transfer animation source is the hand.
      expect(scene.animateTransferFromMarket).toHaveBeenCalledTimes(1);
      const opts = scene.animateTransferFromMarket.mock.calls[0][0];
      expect(opts.cardId).toBe(upgrade.id);
      expect(opts.family).toBe('upgrade');
      expect(opts.source).toEqual({ x: 200 + handIndex * 20, y: 620 });
      expect(opts.destination).toEqual(scene.getStreetSlotCenter(0));

      await new Promise((resolve) => setTimeout(resolve, 0));

      // Held card costs exactly one action and its upgrade cost.
      expect(scene.state.actionsRemaining).toBe(0);
      expect(scene.state.resourceBank.coins).toBe(coinsBefore - upgrade.cost);
      expect(scene.state.streetGrid[0]?.level).toBe(1);
      expect(scene.state.hand.some((c: any) => c.id === upgrade.id)).toBe(false);
      expect(scene.uiPhase).toBe('market');
      // Single undoable command reverse the whole apply.
      expect(scene.undoManager.canUndo()).toBe(true);
      expect(scene.refreshUndoRedoButtons).toHaveBeenCalledWith(true, false);
      expect(scene.gameEvents.emit).toHaveBeenCalledWith('card:placed', expect.objectContaining({ cardId: upgrade.id }));
      expect(scene.msLifecycleManager.onTutorialActionComplete).toHaveBeenCalledWith('apply-upgrade');

      scene.undoManager.undo();
      expect(scene.state.streetGrid[0]?.level).toBe(0);
      expect(scene.state.hand.some((c: any) => c.id === upgrade.id)).toBe(true);
    });

    it('spends no action when the same-week composite applies (just moved from market)', async () => {
      const { biz, upgrade } = makeUpgradeFixture();
      scene.state.streetGrid[0] = biz;
      const handIndex = putCardInHand(scene, upgrade);
      scene.state.actionsRemaining = 1;
      // The upgrade was bought from the market this same week.
      scene.state.justMovedUpgradeCardId = upgrade.id;
      const coinsBefore = scene.state.resourceBank.coins;

      controller.onDragDropHandUpgrade({
        gameObject: createMockContainer(340, 260, 5),
        data: upgrade.id,
        zoneData: 0,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Same-week composite: the upgrade applies free (no action consumed).
      expect(scene.state.actionsRemaining).toBe(1);
      expect(scene.state.streetGrid[0]?.level).toBe(1);
      expect(scene.state.resourceBank.coins).toBe(coinsBefore - upgrade.cost);
      expect(scene.state.justMovedUpgradeCardId).toBeNull();
      expect(scene.undoManager.canUndo()).toBe(true);
      void handIndex;
    });
  });

  describe('onDragDropHandBusiness (drag → place from hand)', () => {
    it('places a hand business onto an affordable empty slot at listed cost', async () => {
      const card = pickBusinessCard(scene);
      const handIndex = putCardInHand(scene, card);
      const slot = firstEmptySlot(scene.state);
      const coinsBefore = scene.state.resourceBank.coins;

      controller.onDragDropHandBusiness({
        gameObject: createMockContainer(340, 260, 5),
        data: card.id,
        zoneData: slot,
      });

      // The click-place flow ran: pending armed, then the shared onSlotClick
      // hand branch animated the transfer from the hand position.
      expect(scene.animateTransferFromMarket).toHaveBeenCalledTimes(1);
      const opts = scene.animateTransferFromMarket.mock.calls[0][0];
      expect(opts.cardId).toBe(card.id);
      expect(opts.family).toBe('business');
      expect(opts.source).toEqual({ x: 200 + handIndex * 20, y: 620 });
      expect(opts.destination).toEqual(scene.getStreetSlotCenter(slot));

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(scene.state.streetGrid[slot]?.id).toBe(card.id);
      expect(scene.state.hand.some((c: any) => c.id === card.id)).toBe(false);
      // Held business: listed cost + one action.
      expect(scene.state.resourceBank.coins).toBe(coinsBefore - card.cost);
      expect(scene.state.actionsRemaining).toBe(0);
      expect(scene.uiPhase).toBe('market');
      expect(scene.undoManager.canUndo()).toBe(true);
      expect(scene.msLifecycleManager.onTutorialActionComplete).toHaveBeenCalledWith('place-business');
    });
  });

  describe('drag-drop module wiring', () => {
    it('pickup veto keeps the hand card in place and plays illegal feedback', () => {
      const { biz, upgrade } = makeUpgradeFixture();
      scene.state.streetGrid[0] = biz;
      putCardInHand(scene, upgrade);
      // Make the upgrade unaffordable AFTER placing it in hand → pickup veto.
      scene.state.resourceBank.coins = 0;

      controller.initDragDrop();
      const manager = scene.dragDropManager;
      expect(manager).toBeTruthy();

      const container = createMockContainer(300, 150, 5);
      manager.registerDraggable({
        gameObject: container,
        data: upgrade.id,
        hitArea: { x: -50, y: -40, width: 100, height: 80 },
        canPickUp: () => controller.canPickUpHandCard(upgrade.id),
        onDrop: vi.fn(),
      });

      const dragstart = scene.input.on.mock.calls.find((c: any[]) => c[0] === 'dragstart');
      expect(dragstart).toBeTruthy();
      dragstart[1](POINTER, container);

      expect(container.x).toBe(300);
      expect(container.y).toBe(150);
      expect(container.depth).toBe(5);
      expect(scene.sound.play).toHaveBeenCalledWith(COMMON_SFX_KEYS.ILLEGAL_MOVE);
    });

    it('invalid drop (occupied target) snap-backs the hand card with illegal feedback', () => {
      const card = pickBusinessCard(scene);
      putCardInHand(scene, card);
      const slot = firstEmptySlot(scene.state);
      // Occupy the target slot → canDropHandCard rejects the drop.
      scene.state.streetGrid[slot] = { family: 'business', id: 'other-biz', name: 'Other' };

      controller.initDragDrop();
      const manager = scene.dragDropManager;
      const container = createMockContainer(300, 150, 5);
      const zone = { name: 'occupied-slot' };

      manager.registerDraggable({
        gameObject: container,
        data: card.id,
        hitArea: { x: -50, y: -40, width: 100, height: 80 },
        canPickUp: () => controller.canPickUpHandCard(card.id),
        onDrop: vi.fn(),
      });
      manager.registerDropZone({
        zone,
        data: slot,
        canAccept: (payload: any) => controller.canDropHandCard(payload.data, slot),
      });

      const events = Object.fromEntries(
        scene.input.on.mock.calls.map((c: any[]) => [c[0], c[1]]),
      );
      events['dragstart'](POINTER, container);
      container.x = 700;
      container.y = 300;
      events['drop'](POINTER, container, zone);

      expect(container.x).toBe(300);
      expect(container.y).toBe(150);
      expect(container.depth).toBe(5);
      expect(scene.sound.play).toHaveBeenCalledWith(COMMON_SFX_KEYS.ILLEGAL_MOVE);
      expect(scene.state.hand.some((c: any) => c.id === card.id)).toBe(true);
      expect(scene.undoManager.canUndo()).toBe(false);
    });

    it('valid hand-upgrade drop executes the apply via the module drop handler', async () => {
      const { biz, upgrade } = makeUpgradeFixture();
      scene.state.streetGrid[0] = biz;
      putCardInHand(scene, upgrade);

      controller.initDragDrop();
      const manager = scene.dragDropManager;
      const container = createMockContainer(300, 150, 5);
      const zone = { name: 'street-slot' };

      manager.registerDraggable({
        gameObject: container,
        data: upgrade.id,
        hitArea: { x: -50, y: -40, width: 100, height: 80 },
        canPickUp: () => controller.canPickUpHandCard(upgrade.id),
        onDrop: (payload: any) => controller.onDragDropHandUpgrade(payload),
      });
      manager.registerDropZone({
        zone,
        data: 0,
        canAccept: (payload: any) => controller.canDropHandCard(payload.data, 0),
      });

      const events = Object.fromEntries(
        scene.input.on.mock.calls.map((c: any[]) => [c[0], c[1]]),
      );
      events['dragstart'](POINTER, container);
      events['drop'](POINTER, container, zone);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(scene.state.streetGrid[0]?.level).toBe(1);
      expect(scene.state.hand.some((c: any) => c.id === upgrade.id)).toBe(false);
      expect(scene.undoManager.canUndo()).toBe(true);
    });
  });
});

// ── Post-refresh regression coverage (MS-0MVK4E56S0059JPY) ──────────────────

describe('pickup gate: click-select then drag (regression, fix MS-0MVK4E5M00021XEY)', () => {
  let controller: MainStreetTurnController;
  let scene: any;

  beforeEach(() => {
    scene = createMockScene();
    controller = new MainStreetTurnController(scene);
  });

  describe('red-phase cases (flipped by the fix item MS-0MVK4E5M00021XEY)', () => {
    it('allows pickup of the click-selected hand business — a drag continues the selection', () => {
      const card = pickBusinessCard(scene);
      const idx = putCardInHand(scene, card);
      // The click flow left the card selected: uiPhase + pendingHandIndex.
      scene.uiPhase = 'placing-from-hand';
      scene.pendingHandIndex = idx;
      scene.pendingHandJustMoved = false;
      expect(controller.canPickUpHandCard(card.id)).toBe(true);
    });

    it('allows pickup of the click-selected hand community-space card', () => {
      const card = { ...pickBusinessCard(scene), family: 'community-space' };
      const idx = putCardInHand(scene, card);
      scene.uiPhase = 'placing-from-hand';
      scene.pendingHandIndex = idx;
      scene.pendingHandJustMoved = false;
      expect(controller.canPickUpHandCard(card.id)).toBe(true);
    });

    it('allows pickup of the click-selected hand upgrade', () => {
      const { biz, upgrade } = makeUpgradeFixture();
      scene.state.streetGrid[0] = biz;
      const idx = putCardInHand(scene, upgrade);
      scene.uiPhase = 'placing-from-hand';
      scene.pendingHandIndex = idx;
      scene.pendingHandJustMoved = false;
      expect(controller.canPickUpHandCard(upgrade.id)).toBe(true);
    });
  });

  describe('guards the fix stays precise', () => {
    it('still vetoes pickup of a DIFFERENT hand card while another card is click-selected', () => {
      const cardA = pickBusinessCard(scene);
      const idxA = putCardInHand(scene, cardA);
      putCardInHand(scene, { ...pickBusinessCard(scene), id: 'other-biz-in-hand' });
      scene.uiPhase = 'placing-from-hand';
      scene.pendingHandIndex = idxA;
      // cardB (index 1) is not the selected card → the pickup must stay vetoed
      // even after the fix accepts the same-card continuation.
      expect(controller.canPickUpHandCard(scene.state.hand[1].id)).toBe(false);
    });

    it('vetoes pickup when the phase is placing-from-hand but nothing is pending', () => {
      const card = pickBusinessCard(scene);
      putCardInHand(scene, card);
      scene.uiPhase = 'placing-from-hand';
      scene.pendingHandIndex = null;
      expect(controller.canPickUpHandCard(card.id)).toBe(false);
    });

    it('allows pickup again after the selection is toggled off (deselect restores the market phase)', () => {
      const card = pickBusinessCard(scene);
      putCardInHand(scene, card);
      scene.uiPhase = 'placing-from-hand';
      scene.pendingHandIndex = 0;
      // Clicking the card again cancels the selection (back to market phase).
      scene.uiPhase = 'market';
      scene.pendingHandIndex = null;
      expect(controller.canPickUpHandCard(card.id)).toBe(true);
    });
  });
});

describe('hand-drag registration invariant after refresh paths (AC6)', () => {
  let scene: any;
  let controller: MainStreetTurnController;
  let registry: Set<any>;
  let renderer: any;
  let dragstart: (pointer: any, container: any) => void;

  beforeEach(() => {
    scene = createMockScene();
    controller = new MainStreetTurnController(scene);
    controller.initDragDrop();
    // The production registry the renderer maintains (MainStreetRenderer).
    registry = new Set<any>();
    renderer = { scene, dragDropRegistered: registry };
    dragstart = scene.input.on.mock.calls.find((c: any[]) => c[0] === 'dragstart')![1];
  });

  /**
   * Register a hand card container exactly as the renderer's hand renderCard
   * callback does (MS-0MV76HVE4007AOO0): real drag manager, live production
   * predicates, registry bookkeeping.
   */
  function registerHandCard(card: any, x = 300, y = 150): any {
    const container = createMockContainer(x, y, 5);
    scene.dragDropManager.registerDraggable({
      gameObject: container,
      data: card.id,
      hitArea: { x: -50, y: -40, width: 100, height: 80 },
      canPickUp: () => controller.canPickUpHandCard(card.id),
      onDrop: (payload: any) =>
        card.family === 'upgrade'
          ? controller.onDragDropHandUpgrade(payload)
          : controller.onDragDropHandBusiness(payload),
    });
    registry.add(container);
    container.setName(`ms-hand-card-${card.id}`);
    return container;
  }

  /**
   * Register a market card container exactly as the renderer's
   * drawMarketCard draggable path does (MS-0MV76HVE4007AOO0): real drag
   * manager, live production predicates, registry bookkeeping.
   */
  function registerMarketCard(card: any, x = 60, y = 100): any {
    const container = createMockContainer(x, y, 5);
    scene.dragDropManager.registerDraggable({
      gameObject: container,
      data: card.id,
      hitArea: { x: -50, y: -40, width: 100, height: 80 },
      canPickUp: () => controller.canPickUpBusinessCard(card.id),
      onDrop: (payload: any) => controller.onDragDropBusiness(payload),
    });
    registry.add(container);
    container.setName(`ms-market-card-${card.id}`);
    return container;
  }

  /** Two-card hand: a business plus an upgrade on an eligible street slot. */
  function seededHand(): any[] {
    const { biz, upgrade } = makeUpgradeFixture();
    scene.state.streetGrid[0] = biz;
    const business = pickBusinessCard(scene);
    putCardInHand(scene, business);
    putCardInHand(scene, upgrade);
    return [business, upgrade];
  }

  it('full refresh cycle (market unregister -> hand re-register) leaves every hand container registered with no stale entries', () => {
    const hand = seededHand();
    const firstContainers = hand.map((card, i) => registerHandCard(card, 300 + i * 30));
    const marketContainer = registerMarketCard(pickBusinessCard(scene));

    // refreshMarket() → unregisterDragDraggables() is origin-scoped
    // (MS-0MVK4E5M00021XEY): the market row's container is unregistered,
    // but hand-origin registrations SURVIVE the market-only step.
    unregisterDragDraggables(renderer);
    expect(registry.has(marketContainer)).toBe(false);
    expect(registry.size).toBe(hand.length);
    // The surviving hand containers are still tracked by the drag manager:
    // a drag gesture on them raises depth (registered + draggable).
    dragstart(POINTER, firstContainers[0]);
    expect(firstContainers[0].depth).toBe(1000);
    expect(scene.sound.play).not.toHaveBeenCalledWith(COMMON_SFX_KEYS.ILLEGAL_MOVE);

    // refreshPlayerHand() → unregisterHandDraggables() clears the previous
    // hand generation before the HandView rebuild destroys the containers,
    // then re-registers every hand card fresh.
    unregisterHandDraggables(renderer);
    expect(registry.size).toBe(0);
    // Unregistered containers are no longer tracked: a drag gesture raises
    // no depth and plays no feedback (the manager simply has no entry).
    dragstart(POINTER, firstContainers[1]);
    expect(firstContainers[1].depth).toBe(5);
    expect(scene.sound.play).not.toHaveBeenCalled();

    // The fresh hand generation registers as draggable.
    const freshContainers = hand.map((card, i) => registerHandCard(card, 300 + i * 30));
    expect(registry.size).toBe(hand.length);
    for (const container of freshContainers) {
      dragstart(POINTER, container);
      expect(container.depth).toBe(1000); // pickup engaged → registered + draggable
    }
    expect(scene.sound.play).not.toHaveBeenCalledWith(COMMON_SFX_KEYS.ILLEGAL_MOVE);
  });

  it('the scoped unregister steps leave no stale/destroyed container in the registry', () => {
    const hand = seededHand();
    for (const [i, card] of hand.entries()) registerHandCard(card, 300 + i * 30);
    registerMarketCard(pickBusinessCard(scene));
    expect(registry.size).toBe(3);
    // The refreshMarket unregister step clears ONLY the market scope —
    // destroyed pre-refresh market containers never linger, while live
    // hand containers stay (AC4). The refreshPlayerHand step then clears
    // the hand scope — destroyed pre-refresh hand containers never linger
    // either (AC5). Both steps together leave the registry empty.
    unregisterDragDraggables(renderer);
    expect(registry.size).toBe(2);
    unregisterHandDraggables(renderer);
    expect(registry.size).toBe(0);
  });

  // Red-phase (failed on today's dev): registration survives a market-only
  // refresh only after MS-0MVK4E5M00021XEY landed the origin-scoped guard;
  // flipped to plain `it` with that fix.
  it('hand containers stay registered after a market-only refresh (refreshMarket() without refreshPlayerHand())', () => {
    const hand = seededHand();
    const container = registerHandCard(hand[0]);
    // Debug cheat overlay (MarketCardCheatOverlay) calls refreshMarket() ALONE
    // (no refreshPlayerHand). Registration must survive this partial path, not
    // rely on the later hand re-render.
    unregisterDragDraggables(renderer);
    dragstart(POINTER, container);
    expect(container.depth).toBe(1000); // still draggable after the market-only refresh
    expect(scene.sound.play).not.toHaveBeenCalledWith(COMMON_SFX_KEYS.ILLEGAL_MOVE);
  });
});

describe('event cards stay click-only at the drag-module level (AC5)', () => {
  let scene: any;
  let controller: MainStreetTurnController;

  beforeEach(() => {
    scene = createMockScene();
    controller = new MainStreetTurnController(scene);
  });

  it('a drag gesture on a hand event card is vetoed: the card never engages and illegal feedback plays', () => {
    const base = pickBusinessCard(scene);
    const eventCard = { ...base, family: 'event' };
    scene.state.hand.push(eventCard);
    scene.state.actionsRemaining = 1;

    controller.initDragDrop();
    const manager = scene.dragDropManager;
    const container = createMockContainer(300, 150, 5);
    manager.registerDraggable({
      gameObject: container,
      data: eventCard.id,
      hitArea: { x: -50, y: -40, width: 100, height: 80 },
      canPickUp: () => controller.canPickUpHandCard(eventCard.id),
      onDrop: vi.fn(),
    });

    const evt = scene.input.on.mock.calls.find((c: any[]) => c[0] === 'dragstart')!;
    evt[1](POINTER, container);

    // Vetoed at pickup: never depth-raised (drag never engages), stays in hand.
    expect(container.depth).toBe(5);
    expect(container.x).toBe(300);
    expect(container.y).toBe(150);
    expect(scene.sound.play).toHaveBeenCalledWith(COMMON_SFX_KEYS.ILLEGAL_MOVE);
    expect(scene.state.hand.some((c: any) => c.id === eventCard.id)).toBe(true);
    expect(scene.undoManager.canUndo()).toBe(false);
  });

  it('select-then-act stays the event interaction: clicking an event card selects it instead of starting a drag', () => {
    const base = pickBusinessCard(scene);
    const eventCard = { ...base, family: 'event' };
    scene.state.hand.push(eventCard);
    scene.state.actionsRemaining = 1;

    controller.onHandEventCardClick(0);

    expect(scene.uiPhase).toBe('event-selected');
    expect(scene.pendingHandIndex).toBe(0);
    // And the event card is still not a legal pickup target for dragging.
    expect(controller.canPickUpHandCard(eventCard.id)).toBe(false);
  });
});
