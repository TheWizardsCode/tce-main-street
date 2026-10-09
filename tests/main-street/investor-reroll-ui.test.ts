/**
 * Main Street: Investor free re-roll + move-staff UI affordances
 * (MS-0MUOSULQ700186PP, parent MS-0MTISBYLS009936W).
 *
 * Covers the player-facing surface for the two child mechanics:
 *   AC1  The market re-roll button/tooltip surfaces whether the free re-roll
 *        is still available this turn and the 75% relevance bias; the label
 *        reflects the coin-free state when available and the escalated paid
 *        Research cost when not. The Investor's staff tooltip and the
 *        employed-staff summary also state the ability and its bias.
 *   AC2  The move-staff affordance exposes the 1-action-point cost and the
 *        legal destination businesses.
 *
 * The builders are Phaser-free, so the copy and state logic are unit-tested
 * without booting a scene. The controller handlers are driven through a
 * lightweight fake scene (mirrors `staff-market-row-ui.test.ts`).
 *
 * @module
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  createStaffDeck,
  type BusinessCard,
  type StaffCard,
  type SynergyType,
} from '../../src/MainStreetCards';
import {
  executeWeekStart,
  placeStaffOnBusiness,
} from '../../src/MainStreetEngine';
import { useFreeMarketReroll } from '../../src/MainStreetMarket';
import { UndoRedoManager } from '@core-engine/UndoRedoManager';
import {
  buildMarketRerollControl,
  buildMoveStaffAffordance,
  HUD_TOOLTIP_I18N_KEYS,
  HUD_TOOLTIP_STRINGS,
} from '../../src/scenes/MainStreetHudTooltips';
import {
  buildCardTooltipInfo,
  formatEmployedStaffSummary,
  type SynergyFormatConfig,
} from '../../src/MainStreetFormatting';
import {
  onFreeMarketRerollClick,
  onMoveStaffClick,
  onMoveStaffDestinationClick,
} from '../../src/scenes/MainStreetTurnControllerMarketActions';

// ── Fixtures ────────────────────────────────────────────────

/** Places a business card fixture at a given slot. */
function placeBusinessAt(
  state: MainStreetState,
  slot: number,
  name: string,
  synergy: SynergyType[],
): BusinessCard {
  const biz: BusinessCard = {
    family: 'business',
    id: `biz-${slot}`,
    name,
    cost: 3,
    baseIncome: 2,
    synergyTypes: [...synergy],
    maxLevel: 0,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    description: 'UI fixture.',
    ongoingCost: 0,
    employedStaff: [],
  };
  state.streetGrid[slot] = biz;
  return biz;
}

let staffSerial = 0;
/** Hires a staff template into the state's staffCards with a unique id. */
function hire(state: MainStreetState, idPrefix: string): StaffCard {
  const tpl = createStaffDeck(1).find(c => c.id.startsWith(idPrefix))!;
  const card = { ...tpl, id: `${tpl.id}-ui-${staffSerial++}` };
  state.staffCards.push(card);
  return card;
}

function marketPhaseState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  state.phase = 'MarketPhase';
  state.resourceBank.coins = 100000;
  return state;
}

// ── AC1: market re-roll control ─────────────────────────────

describe('buildMarketRerollControl (AC1)', () => {
  it('shows the escalated paid Research cost when no Investor is employed', () => {
    const state = marketPhaseState('reroll-no-investor');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);

    const control = buildMarketRerollControl(state);

    expect(control.freeRerollAvailable).toBe(false);
    expect(control.enabled).toBe(true);
    expect(control.paidCost).toBe(500);
    expect(control.label).toBe('Research (500)');
    expect(control.tooltip).toContain(HUD_TOOLTIP_STRINGS.marketRerollNoInvestorBody);
    expect(control.tooltip).toContain('Pay 500 coins');
  });

  it('reads free + surfaces the 75% relevance bias when an Investor is employed', () => {
    const state = marketPhaseState('reroll-free');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const investor = hire(state, 'staff-investor');
    placeStaffOnBusiness(state, investor.id, 0);

    const control = buildMarketRerollControl(state);

    expect(control.freeRerollAvailable).toBe(true);
    expect(control.enabled).toBe(true);
    expect(control.label).toBe('Free re-roll (Investor)');
    expect(control.tooltip).toContain('75%');
    expect(control.tooltip).toContain('Food');
    expect(control.tooltip).toContain('coin-free');
  });

  it('falls back to the escalated cost and flags the used gate after the free re-roll', () => {
    const state = marketPhaseState('reroll-used');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const investor = hire(state, 'staff-investor');
    placeStaffOnBusiness(state, investor.id, 0);

    // Use the free re-roll directly through the engine (the UI handler is
    // covered separately); this advances the shared escalation counter.
    useFreeMarketReroll(state);

    const control = buildMarketRerollControl(state);

    expect(control.freeRerollAvailable).toBe(false);
    expect(control.paidCost).toBe(750);
    expect(control.label).toBe('Research (750)');
    expect(control.tooltip).toContain(HUD_TOOLTIP_STRINGS.marketRerollUsedBody);
  });

  it('is disabled outside the Market phase', () => {
    const state = marketPhaseState('reroll-phase');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    state.phase = 'IncomePhase';

    const control = buildMarketRerollControl(state);

    expect(control.enabled).toBe(false);
    expect(control.tooltip).toContain(HUD_TOOLTIP_STRINGS.marketRerollGate);
  });

  it('uses i18n for the label and body copy', () => {
    const state = marketPhaseState('reroll-i18n');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const control = buildMarketRerollControl(state);
    expect(control.label).toBe(HUD_TOOLTIP_STRINGS.marketRerollPaidLabel.replace('{cost}', '500'));
    expect(HUD_TOOLTIP_I18N_KEYS.marketRerollPaidLabel).toBe('hud.tooltip.marketReroll.paidLabel');
  });
});

// ── AC1: Investor staff tooltip + employed-staff summary ────

describe('Investor staff tooltip and employed-staff summary (AC1)', () => {
  it('buildCardTooltipInfo states the free re-roll ability and the 75% bias', () => {
    const state = setupMainStreetGame({ seed: 'investor-tooltip' });
    const config = state.config as unknown as SynergyFormatConfig;
    const investor = createStaffDeck(1).find(c => c.id.startsWith('staff-investor'))!;

    const info = buildCardTooltipInfo(investor, config);

    expect(info).toContain('Staff:');
    expect(info).toContain('free market re-roll once per turn (75% relevance bias)');
  });

  it('employed-staff summary reports the free re-roll as available this turn', () => {
    const investor = createStaffDeck(1).find(c => c.id.startsWith('staff-investor'))!;

    const summary = formatEmployedStaffSummary([investor], { freeRerollUsedThisTurn: false })!;

    expect(summary).toContain('free re-roll available this turn');
    expect(summary).toContain('75% relevance bias');
  });

  it('employed-staff summary reports the free re-roll as used once spent', () => {
    const investor = createStaffDeck(1).find(c => c.id.startsWith('staff-investor'))!;

    const summary = formatEmployedStaffSummary([investor], { freeRerollUsedThisTurn: true })!;

    expect(summary).toContain('free re-roll used this turn');
  });

  it('leaves non-Investor staff summaries unchanged', () => {
    const chef = createStaffDeck(1).find(c => c.id.startsWith('staff-chef'))!;

    const summary = formatEmployedStaffSummary([chef])!;

    expect(summary).not.toContain('free re-roll');
  });
});

// ── AC2: move-staff affordance ──────────────────────────────

describe('buildMoveStaffAffordance (AC2)', () => {
  it('exposes the 1-action-point cost and legal destinations', () => {
    const state = marketPhaseState('move-affordance');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 2, 'Diner', ['Food']);
    const chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, chef.id, 0);
    state.actionsRemaining = 2;

    const affordance = buildMoveStaffAffordance(state, chef.id);

    expect(affordance.actionCost).toBe(1);
    expect(affordance.label).toBe('Move staff (1 action)');
    expect(affordance.enabled).toBe(true);
    expect(affordance.staffId).toBe(chef.id);
    expect(affordance.destinationSlots).toEqual([2]);
    expect(affordance.tooltip).toContain('costs 1 action point');
    expect(affordance.tooltip).toContain('Diner');
  });

  it('is disabled with no employed staff', () => {
    const state = marketPhaseState('move-none');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);

    const affordance = buildMoveStaffAffordance(state);

    expect(affordance.enabled).toBe(false);
    expect(affordance.staffId).toBeNull();
    expect(affordance.tooltip).toContain(HUD_TOOLTIP_STRINGS.moveStaffNoStaff);
  });

  it('is disabled when no actions remain and says so', () => {
    const state = marketPhaseState('move-no-actions');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 2, 'Diner', ['Food']);
    const chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, chef.id, 0);
    state.actionsRemaining = 0;

    const affordance = buildMoveStaffAffordance(state, chef.id);

    expect(affordance.enabled).toBe(false);
    expect(affordance.tooltip).toContain(HUD_TOOLTIP_STRINGS.moveStaffNoActions);
  });

  it('excludes destinations whose business type does not match', () => {
    const state = marketPhaseState('move-mismatch');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 1, 'Hardware Store', ['Service']);
    const chef = hire(state, 'staff-chef'); // Cafe|Diner|Food|Delicatessen
    placeStaffOnBusiness(state, chef.id, 0);
    state.actionsRemaining = 2;

    const affordance = buildMoveStaffAffordance(state, chef.id);

    expect(affordance.destinationSlots).toEqual([]);
    expect(affordance.enabled).toBe(false);
    expect(affordance.tooltip).toContain(HUD_TOOLTIP_STRINGS.moveStaffNoDestination);
  });
});

// ── Controller handlers ─────────────────────────────────────

/** Minimal fake scene surface for the market-action handlers. */
function createMockScene(state: MainStreetState): any {
  const scene: any = {
    state,
    uiPhase: 'market',
    pendingStaffMoveId: null,
    actionContainer: null,
    settingsPanel: { reducedMotion: true },
    instructionText: { setText: vi.fn() },
    tooltipManager: { hide: vi.fn(), show: vi.fn() },
    refreshAll: vi.fn(),
    refreshStreetGrid: vi.fn(),
    refreshActionButtons: vi.fn(),
    refreshUndoRedoButtons: vi.fn(),
    undoManager: new UndoRedoManager(),
    gameEvents: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
    animateMarketSwap: vi.fn(),
    animateMarketDealIn: vi.fn(),
    animateNewSynergyPairs: vi.fn(),
    sound: { play: vi.fn() },
  };
  return scene;
}

describe('onFreeMarketRerollClick (AC1)', () => {
  it('executes the coin-free re-roll and sets the once-per-turn flag', () => {
    const state = marketPhaseState('handler-free');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const investor = hire(state, 'staff-investor');
    placeStaffOnBusiness(state, investor.id, 0);
    state.resourceBank.coins = 1234;
    state.actionsRemaining = 2;
    const scene = createMockScene(state);
    const ctx = { scene, animateMarketSwap: vi.fn() };

    onFreeMarketRerollClick(ctx as any);

    expect(state.investorFreeRerollUsedThisTurn).toBe(true);
    expect(state.resourceBank.coins).toBe(1234);
    expect(state.actionsRemaining).toBe(2);
    expect(scene.undoManager.canUndo()).toBe(true);
    expect(ctx.animateMarketSwap).toHaveBeenCalledWith('market', expect.any(Array));
    expect(scene.instructionText.setText).toHaveBeenCalledWith(
      expect.stringContaining('coin-free'),
    );
  });

  it('refuses with illegal feedback when no Investor is employed', () => {
    const state = marketPhaseState('handler-free-illegal');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    const scene = createMockScene(state);

    onFreeMarketRerollClick({ scene } as any);

    expect(state.investorFreeRerollUsedThisTurn).toBe(false);
    expect(scene.animateMarketSwap).not.toHaveBeenCalled();
    expect(scene.instructionText.setText).toHaveBeenCalledWith(
      expect.stringContaining('Cannot free re-roll'),
    );
  });
});

describe('move-staff handlers (AC2)', () => {
  let state: MainStreetState;
  let scene: any;
  let chef: StaffCard;

  beforeEach(() => {
    staffSerial = 0;
    state = marketPhaseState('handler-move');
    placeBusinessAt(state, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 2, 'Diner', ['Food']);
    chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, chef.id, 0);
    state.actionsRemaining = 2;
    scene = createMockScene(state);
  });

  it('begins a relocation and completes it for exactly 1 action', () => {
    onMoveStaffClick({ scene } as any, chef.id);
    expect(scene.uiPhase).toBe('moving-staff');
    expect(scene.pendingStaffMoveId).toBe(chef.id);

    onMoveStaffDestinationClick({ scene } as any, 2);

    expect(scene.uiPhase).toBe('market');
    expect(scene.pendingStaffMoveId).toBeNull();
    expect(state.staffCards.find(c => c.id === chef.id)!.employedAtSlot).toBe(2);
    expect(state.actionsRemaining).toBe(1);
  });

  it('keeps the moving phase on an illegal destination and spends no action', () => {
    placeBusinessAt(state, 1, 'Hardware Store', ['Service']);
    onMoveStaffClick({ scene } as any, chef.id);

    onMoveStaffDestinationClick({ scene } as any, 1);

    expect(scene.uiPhase).toBe('moving-staff');
    expect(state.actionsRemaining).toBe(2);
    expect(state.staffCards.find(c => c.id === chef.id)!.employedAtSlot).toBe(0);
    expect(scene.instructionText.setText).toHaveBeenCalledWith(
      expect.stringContaining('type does not match'),
    );
  });

  it('does not enter the moving phase when no actions remain', () => {
    state.actionsRemaining = 0;

    onMoveStaffClick({ scene } as any, chef.id);

    expect(scene.uiPhase).toBe('market');
    expect(scene.pendingStaffMoveId).toBeNull();
    expect(scene.instructionText.setText).toHaveBeenCalledWith(
      expect.stringContaining('No actions remaining'),
    );
  });
});
