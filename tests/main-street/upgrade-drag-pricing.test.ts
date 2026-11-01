/**
 * Main Street: market→business upgrade drag pricing parity (MS-0MVKT3TZF0091IHC).
 *
 * The market→street upgrade drag resolves ONE price/action pair from the
 * current `actionsRemaining`, exactly like the business drag
 * (CG-0MT24X0SX007RLHN):
 *
 * - **2+ actions** → discounted **listed** cost, consumes the drag action
 *   plus the placement action (2 total), no premium dialog.
 * - **≤ 1 action** → discount-first **+50% premium**, consumes 1 action and
 *   fires the premium explainer dialog.
 *
 * `computeUpgradeDragPricing` is the single source of truth shared by the
 * pickup gate, the drop gate and the executed command, so the gates can never
 * disagree with what is charged. This file covers the price/action split, the
 * gate/execution agreement (including a per-business upgrade discount),
 * undo/redo accounting and the illegal-drag reason strings.
 *
 * @module tests/main-street/upgrade-drag-pricing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setupMainStreetGame } from '../../src/MainStreetState';
import { executeWeekStart } from '../../src/MainStreetEngine';
import { MainStreetTurnController } from '../../src/scenes/MainStreetTurnController';
import { UndoRedoManager } from '@core-engine/UndoRedoManager';
import { COMMON_SFX_KEYS } from '@core-engine/SoundManager';
import { buyAndPlaceUpgradeCommand } from '../../src/MainStreetCommands';
import {
  canBuyAndPlaceUpgrade,
  computeUpgradeDragPricing,
  upgradeDragVetoReason,
} from '../../src/MainStreetMarket';
import type { BusinessCard, StaffCard, UpgradeCard } from '../../src/MainStreetCards';

// ── Fixtures ────────────────────────────────────────────────

const LISTED_COST = 300;
const ADVISOR_DISCOUNT = 100;

function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: 'biz-bookshop-parity',
    name: 'Bookshop',
    cost: 250,
    baseIncome: 1,
    synergyTypes: [],
    maxLevel: 2,
    description: 'test business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    appliedUpgrades: [],
    ...overrides,
  };
}

function makeUpgrade(overrides: Partial<UpgradeCard> = {}): UpgradeCard {
  return {
    family: 'upgrade',
    id: 'upg-bookshop-parity',
    name: 'Bookshop Extension',
    cost: LISTED_COST,
    targetBusiness: 'Bookshop',
    requiredLevel: 0,
    incomeBonus: 1,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    description: 'test upgrade',
    ...overrides,
  };
}

function makeAdvisor(slotIndex = 0): StaffCard {
  return {
    family: 'staff',
    id: 'staff-advisor-parity',
    name: 'Financial Advisor',
    cost: 1000,
    ongoingCost: 150,
    description: 'test advisor',
    employedAtSlot: slotIndex,
    upgradeCostDiscount: ADVISOR_DISCOUNT,
  } as StaffCard;
}

interface SetupOptions {
  actions?: number;
  banked?: number;
  coins?: number;
  discount?: boolean;
  businessLevel?: number;
  includeBusiness?: boolean;
}

/**
 * Fresh MarketPhase state with one Bookshop on slot 0 and its upgrade in the
 * development row. `coins`, `actionsRemaining` and `bankedActions` are set
 * explicitly so the reported 348-coin / 2-action scenario is deterministic.
 */
function setupState(options: SetupOptions = {}): ReturnType<typeof setupMainStreetGame> {
  const state = setupMainStreetGame({ seed: `upgrade-drag-parity-${options.actions ?? 2}` });
  executeWeekStart(state, true);
  state.phase = 'MarketPhase';

  const discount = options.discount ?? false;
  state.streetGrid = state.streetGrid.map(() => null);
  if (options.includeBusiness !== false) {
    state.streetGrid[0] = makeBiz({
      level: options.businessLevel ?? 0,
      employedStaff: discount ? [makeAdvisor(0)] : [],
    });
  }
  state.market.cards = [makeUpgrade()];
  state.hand = [];
  state.resourceBank.coins = options.coins ?? 1000;
  state.actionsRemaining = options.actions ?? 2;
  state.bankedActions = options.banked ?? 0;
  state.justMovedUpgradeCardId = null;
  return state;
}

function marketUpgrade(state: ReturnType<typeof setupMainStreetGame>): UpgradeCard {
  const card = state.market.cards.find(c => c.family === 'upgrade');
  if (!card) throw new Error('upgrade missing from the market fixture');
  return card as UpgradeCard;
}

// ── Pricing helper: parity split ────────────────────────────

describe('computeUpgradeDragPricing: composite-parity split', () => {
  it('charges the listed cost and adds the placement action at 2+ actions', () => {
    const state = setupState({ actions: 2 });
    const pricing = computeUpgradeDragPricing(state, marketUpgrade(state), 0);

    expect(pricing.listedCost).toBe(LISTED_COST);
    expect(pricing.premiumApplies).toBe(false);
    expect(pricing.price).toBe(LISTED_COST);
    expect(pricing.extraActions).toBe(1); // drag action + placement action
  });

  it('charges the premium and adds no placement action at 1 action', () => {
    const state = setupState({ actions: 1 });
    const pricing = computeUpgradeDragPricing(state, marketUpgrade(state), 0);

    expect(pricing.premiumApplies).toBe(true);
    expect(pricing.premiumCost).toBe(Math.ceil(LISTED_COST * 1.5 * 2) / 2);
    expect(pricing.price).toBe(pricing.premiumCost);
    expect(pricing.extraActions).toBe(0); // premium replaces the placement action
  });

  it('applies the per-business upgrade discount first, then the premium', () => {
    const discountedListed = LISTED_COST - ADVISOR_DISCOUNT;

    const listedState = setupState({ actions: 2, discount: true });
    const listedPricing = computeUpgradeDragPricing(listedState, marketUpgrade(listedState), 0);
    expect(listedPricing.listedCost).toBe(discountedListed);
    expect(listedPricing.price).toBe(discountedListed);

    const premiumState = setupState({ actions: 1, discount: true });
    const premiumPricing = computeUpgradeDragPricing(premiumState, marketUpgrade(premiumState), 0);
    expect(premiumPricing.listedCost).toBe(discountedListed);
    expect(premiumPricing.premiumCost).toBe(Math.ceil(discountedListed * 1.5 * 2) / 2);
    expect(premiumPricing.price).toBe(Math.ceil(discountedListed * 1.5 * 2) / 2);
  });

  it('falls back to the card listed cost when no target is eligible', () => {
    const state = setupState({ actions: 2, includeBusiness: false });
    const pricing = computeUpgradeDragPricing(state, marketUpgrade(state));

    expect(pricing.listedCost).toBe(LISTED_COST);
    expect(pricing.price).toBe(LISTED_COST);
    expect(pricing.extraActions).toBe(1);
  });
});

// ── Gate / execution agreement ──────────────────────────────

describe('gate and execution agree on the shared price', () => {
  it('accepts the reported 348-coin / 2-action scenario at listed cost', () => {
    const state = setupState({ actions: 2, coins: 348, banked: 1 });
    const card = marketUpgrade(state);
    const pricing = computeUpgradeDragPricing(state, card, 0);

    // The drop gate must accept the same price the command charges.
    expect(canBuyAndPlaceUpgrade(state, card.id, 0, pricing.price).legal).toBe(true);
    expect(pricing.price).toBe(300);
  });

  it('does not veto a pickup whose only affordable target carries a discount', () => {
    // Undiscounted the drag costs 450 premium; with the advisor it costs 300
    // at the premium (200 listed), which 348 coins can afford at 1 action.
    const state = setupState({ actions: 1, coins: 348, discount: true });
    const card = marketUpgrade(state);
    const pricing = computeUpgradeDragPricing(state, card, 0);

    expect(pricing.price).toBe(Math.ceil((LISTED_COST - ADVISOR_DISCOUNT) * 1.5 * 2) / 2);
    expect(canBuyAndPlaceUpgrade(state, card.id, 0, pricing.price).legal).toBe(true);

    // The old gate compared the raw undiscounted premium (450) and vetoed.
    expect(upgradeDragVetoReason(state, card.id)).toBeUndefined();
  });
});

// ── Undo / redo and action accounting ───────────────────────

describe('buyAndPlaceUpgradeCommand: parity action spend and undo/redo', () => {
  it('spends both actions (including the banked one) and restores them on undo', () => {
    const state = setupState({ actions: 2, coins: 348, banked: 1 });
    const card = marketUpgrade(state);
    const pricing = computeUpgradeDragPricing(state, card, 0);

    const undo = new UndoRedoManager();
    undo.execute(buyAndPlaceUpgradeCommand(state, card.id, 0, pricing.price, pricing.extraActions));

    // Reported scenario: 300 coins deducted (48 left), both actions consumed,
    // the banked action spent per action.
    expect(state.streetGrid[0]!.level).toBe(1);
    expect(state.resourceBank.coins).toBe(48);
    expect(state.actionsRemaining).toBe(0);
    expect(state.bankedActions).toBe(0);
    expect(state.market.cards.some(c => c.id === card.id)).toBe(false);
    expect(undo.canUndo()).toBe(true);

    undo.undo();
    expect(state.streetGrid[0]!.level).toBe(0);
    expect(state.resourceBank.coins).toBe(348);
    expect(state.actionsRemaining).toBe(2);
    expect(state.bankedActions).toBe(1);
    expect(state.market.cards.some(c => c.id === card.id)).toBe(true);

    undo.redo();
    expect(state.streetGrid[0]!.level).toBe(1);
    expect(state.resourceBank.coins).toBe(48);
    expect(state.actionsRemaining).toBe(0);
    expect(state.bankedActions).toBe(0);
  });

  it('spends exactly one action on the premium path (no extra placement action)', () => {
    const state = setupState({ actions: 1, coins: 1000, banked: 1 });
    const card = marketUpgrade(state);
    const pricing = computeUpgradeDragPricing(state, card, 0);

    const undo = new UndoRedoManager();
    undo.execute(buyAndPlaceUpgradeCommand(state, card.id, 0, undefined, pricing.extraActions));

    expect(pricing.premiumApplies).toBe(true);
    expect(pricing.extraActions).toBe(0);
    expect(state.resourceBank.coins).toBe(1000 - pricing.premiumCost);
    expect(state.actionsRemaining).toBe(0);
    // Banked actions are spent per action: the drag's single action draws the
    // bank down by one; the premium replaces only the placement action, so
    // there is no SECOND bank decrement.
    expect(state.bankedActions).toBe(0);
  });
});

// ── Reason strings ──────────────────────────────────────────

describe('upgradeDragVetoReason: illegal drags state why', () => {
  it('reports the coins needed at the premium (reported 348 vs 450 case)', () => {
    const state = setupState({ actions: 1, coins: 348 });

    expect(upgradeDragVetoReason(state, marketUpgrade(state).id)).toBe(
      'Need 450 at premium, have 348.',
    );
  });

  it('reports the listed coins needed on the parity path', () => {
    const state = setupState({ actions: 2, coins: 200 });

    expect(upgradeDragVetoReason(state, marketUpgrade(state).id)).toBe('Need 300, have 200.');
  });

  it('reports no actions remaining', () => {
    const state = setupState({ actions: 0, coins: 2000 });

    expect(upgradeDragVetoReason(state, marketUpgrade(state).id)).toMatch(/No actions remaining/);
  });

  it('reports no valid business to upgrade', () => {
    const state = setupState({ actions: 2, coins: 2000, includeBusiness: false });

    expect(upgradeDragVetoReason(state, marketUpgrade(state).id)).toBe('No valid business to upgrade.');
  });

  it('returns undefined when the drag is legal', () => {
    const state = setupState({ actions: 2, coins: 348 });

    expect(upgradeDragVetoReason(state, marketUpgrade(state).id)).toBeUndefined();
  });
});

// ── Controller: gates, execution and onIllegal feedback ──────

/** Minimal Phaser plumbing needed by createDragDropManager. */
function createPhaserMock(): any {
  return {
    tweens: {
      add: vi.fn((config: any) => {
        const targets = Array.isArray(config.targets) ? config.targets : [config.targets];
        for (const t of targets) {
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
    input: null,
    setDepth: vi.fn((d: number) => { go.depth = d; }),
    setInteractive: vi.fn(),
    setName: vi.fn(),
    on: vi.fn(),
  };
  return go;
}

function createMockScene(state: ReturnType<typeof setupMainStreetGame>): any {
  const phaser = createPhaserMock();
  const scene: any = {
    state,
    uiPhase: 'market',
    settingsPanel: { reducedMotion: true },
    msLifecycleManager: {
      isTutorialActionAllowed: vi.fn().mockReturnValue({ allowed: true }),
      onTutorialActionComplete: vi.fn(),
    },
    tooltipManager: { hide: vi.fn(), show: vi.fn() },
    showBuyAndPlacePremiumDialog: vi.fn((_cardName: string, onProceed: () => void, onCancel: () => void) => {
      scene.premiumDialogOnProceed = onProceed;
      scene.premiumDialogOnCancel = onCancel;
    }),
    premiumDialogOnProceed: null,
    premiumDialogOnCancel: null,
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
    activeTransferVisuals: new Set(),
    input: phaser.input,
    tweens: phaser.tweens,
    sound: phaser.sound,
  };
  return scene;
}

const POINTER = { x: 0, y: 0 } as any;

describe('MainStreetTurnController: upgrade drag parity wiring', () => {
  let controller: MainStreetTurnController;
  let scene: any;

  beforeEach(() => {
    scene = createMockScene(setupState({ actions: 2, coins: 348, banked: 1 }));
    controller = new MainStreetTurnController(scene);
  });

  it('allows pickup when the pending 2-action drag is affordable at listed cost', () => {
    const card = marketUpgrade(scene.state);
    expect(controller.canPickUpUpgradeCard(card.id)).toBe(true);
    expect(controller.canDropUpgradeCard(card.id, 0)).toBe(true);
  });

  it('vetoes pickup when the player cannot afford the premium at 1 action', () => {
    scene.state.actionsRemaining = 1;
    scene.state.resourceBank.coins = 348;
    const card = marketUpgrade(scene.state);

    expect(controller.canPickUpUpgradeCard(card.id)).toBe(false);
    expect(controller.canDropUpgradeCard(card.id, 0)).toBe(false);
  });

  it('does not veto a pickup the discounted target would legally accept (AC3)', () => {
    // 348 coins cannot pay the undiscounted 450 premium, but the discounted
    // 300 premium at this business is affordable — the pickup must agree with
    // the drop gate instead of vetoing on the raw card cost.
    scene.state.actionsRemaining = 1;
    scene.state.resourceBank.coins = 348;
    scene.state.streetGrid[0] = makeBiz({ employedStaff: [makeAdvisor(0)] });
    const card = marketUpgrade(scene.state);

    expect(controller.canPickUpUpgradeCard(card.id)).toBe(true);
    expect(controller.canDropUpgradeCard(card.id, 0)).toBe(true);
  });

  it('executes the 2-action drag at listed cost with no premium dialog', async () => {
    const card = marketUpgrade(scene.state);

    controller.onDragDropUpgrade({
      gameObject: createMockContainer(412, 331, 5),
      data: card.id,
      zoneData: 0,
    } as any);

    // No premium explainer on the parity path; the transfer starts at once.
    expect(scene.showBuyAndPlacePremiumDialog).not.toHaveBeenCalled();
    expect(scene.animateTransferFromMarket).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scene.state.streetGrid[0]!.level).toBe(1);
    expect(scene.state.resourceBank.coins).toBe(48);
    expect(scene.state.actionsRemaining).toBe(0);
    expect(scene.state.bankedActions).toBe(0);
    expect(scene.uiPhase).toBe('market');
    expect(scene.lastFeedback?.text).toMatch(/listed/i);
  });

  it('fires the premium dialog at 1 action and commits on Proceed', async () => {
    scene.state.actionsRemaining = 1;
    scene.state.bankedActions = 1;
    scene.state.resourceBank.coins = 1000;
    const card = marketUpgrade(scene.state);

    controller.onDragDropUpgrade({
      gameObject: createMockContainer(412, 331, 5),
      data: card.id,
      zoneData: 0,
    } as any);

    expect(scene.showBuyAndPlacePremiumDialog).toHaveBeenCalled();
    expect(scene.premiumDialogOnProceed).toBeTypeOf('function');

    scene.premiumDialogOnProceed();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scene.state.streetGrid[0]!.level).toBe(1);
    expect(scene.state.resourceBank.coins).toBe(1000 - 450);
    expect(scene.state.actionsRemaining).toBe(0);
    // One action spent (the premium replaces the placement action), so the
    // banked reserve is drawn down by exactly one.
    expect(scene.state.bankedActions).toBe(0);
  });

  it('cancelling the premium dialog leaves the card, coins and actions untouched', async () => {
    scene.state.actionsRemaining = 1;
    scene.state.resourceBank.coins = 1000;
    const card = marketUpgrade(scene.state);

    controller.onDragDropUpgrade({
      gameObject: createMockContainer(412, 331, 5),
      data: card.id,
      zoneData: 0,
    } as any);

    scene.premiumDialogOnCancel?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(scene.state.streetGrid[0]!.level).toBe(0);
    expect(scene.state.market.cards.some((c: any) => c.id === card.id)).toBe(true);
    expect(scene.state.resourceBank.coins).toBe(1000);
    expect(scene.state.actionsRemaining).toBe(1);
    expect(scene.animateTransferFromMarket).not.toHaveBeenCalled();
  });

  it('states the legality reason in the instruction text on a vetoed pickup', () => {
    scene.state.actionsRemaining = 1;
    scene.state.resourceBank.coins = 348;
    const card = marketUpgrade(scene.state);

    controller.initDragDrop();
    const container = createMockContainer(300, 150, 5);
    scene.dragDropManager.registerDraggable({
      gameObject: container,
      data: card.id,
      hitArea: { x: -50, y: -40, width: 100, height: 80 },
      canPickUp: () => controller.canPickUpUpgradeCard(card.id),
      onDrop: vi.fn(),
    });

    const dragstart = scene.input.on.mock.calls.find((c: any[]) => c[0] === 'dragstart');
    expect(dragstart).toBeTruthy();
    dragstart[1](POINTER, container);

    // Illegal feedback preserved (shake + mute-respecting SFX) …
    expect(scene.sound.play).toHaveBeenCalledWith(COMMON_SFX_KEYS.ILLEGAL_MOVE);
    expect(container.x).toBe(300);
    // … and the underlying reason now reaches transient pop feedback.
    expect(scene.lastFeedback?.text).toBe('Need 450 at premium, have 348.');
  });
});
