/**
 * Main Street: Owner-Coloured Placed-Card Border Browser Test
 * (F4 of MS-0MUWNTN8W006C7EF)
 *
 * Boots a real Phaser game in Chromium, starts a competitive (2-seat) game,
 * places a card on the street and asserts the rendered card carries an outer
 * border in its owner's seat colour, that the full-card gold upgrade border is
 * gone, and that the upgrade indicator is the top-left corner accent. This is
 * the manual/browser legibility check for AC8, complementing the headless
 * wiring tests in `owner-card-border.test.ts`.
 *
 * @module tests/main-street/owner-card-border.browser
 */
import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import {
  getBusinessTemplates,
  type BusinessCard,
} from '../../src/MainStreetCards';
import { seatColourToNumber } from '../../src/MainStreetSeatColours';

// ── Boot helpers ────────────────────────────────────────────

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();
  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: Phaser.CANVAS });
  await waitForCondition(() => {
    const scene = game.scene.getScene('MainStreetScene') as any;
    return Boolean(scene && scene.state && scene.streetContainer);
  }, 20_000);
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 10_000, pollMs = 25): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
}

/** A minimal street business built from a real template (valid SVG face). */
function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  const tpl = getBusinessTemplates()[0];
  return {
    family: 'business',
    ...tpl,
    id: `owner-border-biz-${tpl.id}`,
    level: 0,
    baseIncome: 2,
    ongoingCost: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    appliedUpgrades: [],
    ...overrides,
  };
}

/** The card container rendered for a street slot (tagged by slot index). */
function cardContainerForSlot(scene: any, index: number): any {
  return (scene.streetContainer?.list ?? []).find(
    (obj: any) => obj?.getData?.('streetSlotIndex') === index,
  );
}

/** The owner border rectangle on a card container, if present. */
function ownerBorderOf(container: any): any {
  return (container?.list ?? []).find((obj: any) => obj?.getData?.('ownerBorder') === true);
}

/** The top-left upgrade accent rectangle on a card container, if present. */
function upgradeAccentOf(container: any): any {
  return (container?.list ?? []).find((obj: any) => obj?.name === 'ms-upgrade-accent');
}

/** Every rectangle child of a container. */
function rectsOf(container: any): any[] {
  return (container?.list ?? []).filter((obj: any) => obj instanceof Phaser.GameObjects.Rectangle);
}

// ── Tests ───────────────────────────────────────────────────

describe('Owner-coloured placed-card border (browser, AC8)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  async function startCompetitive(): Promise<any> {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;
    scene.msLifecycleManager.applyNewGameSelection({
      mode: 'competitive',
      opponents: [{ strategy: 'Greedy', difficulty: 'Medium' }],
    });
    await waitForCondition(() => (scene.state?.players?.length ?? 0) === 2);
    return scene;
  }

  it('frames a business card with its owner’s seat colour', async () => {
    const scene = await startCompetitive();
    const biz = makeBiz();
    scene.state.streetGrid[0] = biz;
    scene.state.ownerTaggedGrid[0] = { card: biz, ownerId: 1 };
    scene.refreshAll();

    await waitForCondition(() => Boolean(cardContainerForSlot(scene, 0)));
    const card = cardContainerForSlot(scene, 0);

    const border = ownerBorderOf(card);
    expect(border).toBeDefined();
    expect(border.name).toBe('ms-owner-border-0');
    expect(border.strokeColor).toBe(seatColourToNumber(scene.state.players[1].colour));
    // Transparent fill: the frame never obscures the card face.
    expect(border.fillAlpha).toBe(0);
  });

  it('gives the human and AI seats visually distinct borders', async () => {
    const scene = await startCompetitive();
    const humanBiz = makeBiz({ id: 'human-biz' });
    const aiBiz = makeBiz({ id: 'ai-biz' });
    scene.state.streetGrid[0] = humanBiz;
    scene.state.ownerTaggedGrid[0] = { card: humanBiz, ownerId: 0 };
    scene.state.streetGrid[1] = aiBiz;
    scene.state.ownerTaggedGrid[1] = { card: aiBiz, ownerId: 1 };
    scene.refreshAll();

    await waitForCondition(
      () => Boolean(cardContainerForSlot(scene, 0) && cardContainerForSlot(scene, 1)),
    );
    const humanBorder = ownerBorderOf(cardContainerForSlot(scene, 0));
    const aiBorder = ownerBorderOf(cardContainerForSlot(scene, 1));

    expect(humanBorder.strokeColor).toBe(seatColourToNumber(scene.state.players[0].colour));
    expect(aiBorder.strokeColor).toBe(seatColourToNumber(scene.state.players[1].colour));
    expect(humanBorder.strokeColor).not.toBe(aiBorder.strokeColor);
  });

  it('removes the full-card upgrade border and shows a top-left upgrade accent', async () => {
    const scene = await startCompetitive();
    const biz = makeBiz({ level: 2 });
    scene.state.streetGrid[0] = biz;
    scene.state.ownerTaggedGrid[0] = { card: biz, ownerId: 1 };
    scene.refreshAll();

    await waitForCondition(() => Boolean(cardContainerForSlot(scene, 0)));
    const card = cardContainerForSlot(scene, 0);

    // No full-card gold stroke remains (the old `upgradeBorder`).
    const goldFullCardStrokes = rectsOf(card).filter(
      (rect: any) => rect.strokeColor === 0xffaa22 && rect.width > 100,
    );
    expect(goldFullCardStrokes).toHaveLength(0);

    // The upgrade indicator is the top-left corner accent.
    const accent = upgradeAccentOf(card);
    expect(accent).toBeDefined();
    expect(accent.fillColor).toBe(0xffaa22);
    expect(accent.x).toBeLessThan(0);
    expect(accent.y).toBeLessThan(0);
  }, 30_000);
});
