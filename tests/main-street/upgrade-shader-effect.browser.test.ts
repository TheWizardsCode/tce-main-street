/**
 * Main Street: Upgrade Shader Effect Browser Test (MS-0MV5I4O8U001SU5J)
 *
 * Boots a real Phaser game in Chromium and asserts the Canvas-compatible
 * shader-style upgrade accent (`ms-upgrade-shader`) is attached to an upgraded
 * (level > 0) card and absent on a base (level 0) card. It also confirms the
 * old full-card gold upgrade border stays gone, so the shader effect is the
 * upgrade distinction and never a full-card stroke.
 *
 * The pure spec/gradient contract is covered headlessly in
 * `upgrade-overlay-spec.test.ts` / `owner-card-border.test.ts`; this is the
 * end-to-end rendering leg of AC5.
 *
 * @module tests/main-street/upgrade-shader-effect.browser
 */
import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import { getBusinessTemplates, type BusinessCard } from '../../src/MainStreetCards';

// ── Boot helpers (mirrors owner-card-border.browser.test.ts) ──

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

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 10_000,
  pollMs = 25,
): Promise<void> {
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
    id: `shader-biz-${tpl.id}`,
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

/** The shader-style upgrade accent Graphics on a card container, if present. */
function shaderEffectOf(container: any): any {
  return (container?.list ?? []).find((obj: any) => obj?.name === 'ms-upgrade-shader');
}

/** Every rectangle child of a container. */
function rectsOf(container: any): any[] {
  return (container?.list ?? []).filter(
    (obj: any) => obj instanceof Phaser.GameObjects.Rectangle,
  );
}

// ── Tests ───────────────────────────────────────────────────

describe('Upgrade shader effect (browser, AC1/AC5)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('attaches the shader accent to an upgraded card and not to a base card', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;

    scene.state.streetGrid[0] = makeBiz({ id: 'shader-base', level: 0 });
    scene.state.streetGrid[1] = makeBiz({ id: 'shader-upgraded', level: 2 });
    scene.refreshAll();

    await waitForCondition(
      () => Boolean(cardContainerForSlot(scene, 0) && cardContainerForSlot(scene, 1)),
    );

    const baseCard = cardContainerForSlot(scene, 0);
    const upgradedCard = cardContainerForSlot(scene, 1);

    // Base card (level 0) renders exactly as today: no shader effect.
    expect(shaderEffectOf(baseCard)).toBeUndefined();

    // Upgraded card (level > 0) carries the Canvas-compatible shader accent,
    // named for test discovery, alongside the flat corner accent.
    const shader = shaderEffectOf(upgradedCard);
    expect(shader).toBeDefined();
    expect(shader).toBeInstanceOf(Phaser.GameObjects.Graphics);

    // The upgrade indicator is no longer a full-card gold stroke.
    const goldFullCardStrokes = rectsOf(upgradedCard).filter(
      (rect: any) => rect.strokeColor === 0xffaa22 && rect.width > 100,
    );
    expect(goldFullCardStrokes).toHaveLength(0);
  }, 30_000);
});
