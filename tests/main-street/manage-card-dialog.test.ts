/**
 * Main Street: Manage-Card dialog ownership guard (scene-level)
 *
 * Leaf MS-0MUVPGA3A001TGGT (parent MS-0MUV9P89G0061SRA): when the human seat
 * clicks a street slot in competitive play, the Manage-Card dialog may only
 * open for a slot the acting seat owns. Clicking an opponent-owned slot must
 * block the dialog and surface the ownership-specific illegal-move message
 * instead — no Sell / Close command is wired up.
 *
 * These tests drive the real scene entry point (`onSellCard`) with a
 * lightweight fake scene (no Phaser boot), mirroring the fake-scene pattern
 * used by `competitive-scene-turn-flow.test.ts`. The overlay Sell/Close
 * handlers carry a defensive mirror of the same `canSellBusiness` predicate.
 *
 * @module
 */

import { describe, it, expect, vi } from 'vitest';

import {
  createCompetitiveState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import { executeWeekStart } from '../../src/MainStreetEngine';
import type { BusinessCard } from '../../src/MainStreetCards';
import { onSellCard } from '../../src/scenes/MainStreetTurnControllerPlaceSell';

// ── Fixtures ────────────────────────────────────────────────

/** Deterministic business card for dialog fixtures. */
function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: overrides.id ?? 'biz-dialog',
    name: overrides.name ?? 'Dialog Biz',
    cost: overrides.cost ?? 10,
    baseIncome: overrides.baseIncome ?? 5,
    synergyTypes: overrides.synergyTypes ?? [],
    maxLevel: overrides.maxLevel ?? 2,
    description: 'A dialog test business',
    level: overrides.level ?? 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    appliedUpgrades: [],
    ...overrides,
  } as BusinessCard;
}

/** Two-seat competitive state in MarketPhase with the human seat active. */
function compState(seed: string): MainStreetState {
  const state = createCompetitiveState({ seed, playerCount: 2 });
  state.phase = 'MarketPhase';
  state.activePlayerId = 0;
  state.actionsRemaining = 3;
  state.resourceBank.coins = 1000;
  return state;
}

interface FakeScene {
  scene: any;
  instruction: { text: string };
  showSellConfirmation: ReturnType<typeof vi.fn>;
}

/** Minimal scene surface consumed by `onSellCard`. */
function makeScene(state: MainStreetState): FakeScene {
  const instruction = { text: '' };
  const showSellConfirmation = vi.fn();
  const scene: any = {
    state,
    uiPhase: 'market',
    instructionText: { setText: (text: string) => { instruction.text = text; } },
    actionContainer: null,
    showSellConfirmation,
    // Presentation hooks `playIllegalFeedback` may touch.
    settingsPanel: { reducedMotion: true },
    sound: { play: () => {} },
  };
  return { scene, instruction, showSellConfirmation };
}

/** Occupies a slot and tags its owner. */
function place(state: MainStreetState, card: BusinessCard, slot: number, ownerId: number): void {
  state.streetGrid[slot] = card;
  state.ownerTaggedGrid![slot] = { card, ownerId };
}

// ── Tests ───────────────────────────────────────────────────

describe('Manage-Card dialog ownership guard', () => {
  it('blocks the dialog for an opponent-owned slot and shows ownership feedback', () => {
    const state = compState('dialog-block');
    place(state, makeBiz({ id: 'ai-dialog-biz' }), 0, 1);
    const { scene, instruction, showSellConfirmation } = makeScene(state);

    onSellCard({ scene } as any, 0);

    expect(showSellConfirmation).not.toHaveBeenCalled();
    expect(instruction.text).toContain('AI 1');
    // No state mutation from a blocked click.
    expect(state.soldSlots[0]).toBe(false);
    expect(state.streetGrid[0]).not.toBeNull();
  });

  it('opens the dialog for a slot the acting seat owns', () => {
    const state = compState('dialog-own');
    place(state, makeBiz({ id: 'own-dialog-biz' }), 0, 0);
    const { scene, showSellConfirmation } = makeScene(state);

    onSellCard({ scene } as any, 0);

    expect(showSellConfirmation).toHaveBeenCalledTimes(1);
    expect(showSellConfirmation.mock.calls[0][0]).toBe(0);
  });

  it('opens the dialog in single-player (no owner-tagged grid)', () => {
    const state = setupMainStreetGame({ seed: 'dialog-solo' });
    executeWeekStart(state);
    state.streetGrid[0] = makeBiz({ id: 'solo-dialog-biz' });
    const { scene, showSellConfirmation } = makeScene(state);

    onSellCard({ scene } as any, 0);

    expect(showSellConfirmation).toHaveBeenCalledTimes(1);
  });
});
