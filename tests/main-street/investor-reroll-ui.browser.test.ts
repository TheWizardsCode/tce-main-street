/**
 * Main Street: Investor free re-roll + move-staff affordances (browser)
 * (MS-0MUOSULQ700186PP, parent MS-0MTISBYLS009936W).
 *
 * Boots the real Phaser scene to verify the UI wiring end-to-end:
 *   AC1  The market re-roll button reads `Free re-roll (Investor)` while the
 *        free re-roll is available and flips to the escalated `Research
 *        ({cost})` label once it is spent; clicking the free-state button
 *        performs the coin-free re-roll.
 *   AC2  The street slot routes a click to the pending relocation while the
 *        `moving-staff` phase is active, charging exactly 1 action point.
 *
 * @module tests/main-street/investor-reroll-ui.browser
 */

import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { createStaffDeck, type BusinessCard, type StaffCard, type SynergyType } from '../../src/MainStreetCards';
import { placeStaffOnBusiness } from '../../src/MainStreetEngine';

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();

  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame();
  await waitForScene(game, 'MainStreetScene');
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

/** Places a business fixture at a slot. */
function placeBusinessAt(
  scene: Phaser.Scene & Record<string, any>,
  slot: number,
  name: string,
  synergy: SynergyType[],
): BusinessCard {
  const biz: BusinessCard = {
    family: 'business', id: `biz-ui-${slot}`, name, cost: 3, baseIncome: 2,
    synergyTypes: [...synergy], maxLevel: 0, level: 0, incomeBonus: 0,
    synergyRangeBonus: 0, reputationBonus: 0, description: 'UI fixture.',
    ongoingCost: 0, employedStaff: [],
  };
  scene.state.streetGrid[slot] = biz;
  return biz;
}

/** Recursively collects text labels from a container. */
function collectTexts(container: Phaser.GameObjects.Container): string[] {
  const out: string[] = [];
  const walk = (obj: Phaser.GameObjects.GameObject): void => {
    if (obj instanceof Phaser.GameObjects.Text) out.push(obj.text);
    if (obj instanceof Phaser.GameObjects.Container) {
      for (const child of obj.list) walk(child);
    }
  };
  for (const obj of container.list) walk(obj);
  return out;
}

describe('Investor free re-roll UI (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('labels the market re-roll free while available and paid once spent (AC1)', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, any>;
    scene.settingsPanel = { ...scene.settingsPanel, reducedMotion: true };
    scene.state.phase = 'MarketPhase';
    scene.uiPhase = 'market';
    scene.state.resourceBank.coins = 100000;

    placeBusinessAt(scene, 0, 'Corner Bakery', ['Food']);
    const investor = createStaffDeck(1).find((c: StaffCard) => c.id.startsWith('staff-investor'))!;
    scene.state.staffCards.push({ ...investor });
    placeStaffOnBusiness(scene.state, investor.id, 0);

    scene.refreshAll();
    let labels = collectTexts(scene.marketContainer);
    expect(labels).toContain('Free re-roll (Investor)');

    // Clicking the free-state button performs the coin-free re-roll.
    const coinsBefore = scene.state.resourceBank.coins;
    scene.onFreeMarketRerollClick();
    expect(scene.state.investorFreeRerollUsedThisTurn).toBe(true);
    expect(scene.state.resourceBank.coins).toBe(coinsBefore);

    scene.refreshAll();
    labels = collectTexts(scene.marketContainer);
    expect(labels).toContain('Research (750)');
    expect(labels).not.toContain('Free re-roll (Investor)');
  });
});

describe('Move-staff affordance routing (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('routes a street slot click to the pending relocation for 1 action (AC2)', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, any>;
    scene.settingsPanel = { ...scene.settingsPanel, reducedMotion: true };
    scene.state.phase = 'MarketPhase';
    scene.uiPhase = 'market';

    placeBusinessAt(scene, 0, 'Corner Bakery', ['Food']);
    placeBusinessAt(scene, 2, 'Diner', ['Food']);
    const chef = createStaffDeck(1).find((c: StaffCard) => c.id.startsWith('staff-chef'))!;
    scene.state.staffCards.push({ ...chef });
    placeStaffOnBusiness(scene.state, chef.id, 0);
    scene.state.actionsRemaining = 2;

    scene.refreshAll();

    // The affordance enters the moving-staff phase (label/tooltip built by the
    // pure builder and asserted in the unit suite).
    scene.beginStaffMove(chef.id);
    expect(scene.uiPhase).toBe('moving-staff');
    expect(scene.pendingStaffMoveId).toBe(chef.id);

    // The destination business slot's zone routes the click to the move.
    const zone = scene.streetContainer.list.find(
      (o: Phaser.GameObjects.GameObject) => o.name === 'ms-business-slot-zone-2',
    ) as Phaser.GameObjects.Zone | undefined;
    expect(zone).toBeDefined();
    zone!.emit('pointerdown');

    expect(scene.state.staffCards.find((c: StaffCard) => c.id === chef.id)!.employedAtSlot).toBe(2);
    expect(scene.state.actionsRemaining).toBe(1);
    expect(scene.uiPhase).toBe('market');
    expect(scene.pendingStaffMoveId).toBeNull();
  });
});
