/**
 * Main Street: Upgrade Shader Effect Browser Tests
 * (MS-0MV5I4O8U001SU5J static accent, MS-0MV5I4ONA000Z7NV motion)
 *
 * Boots a real Phaser game in Chromium and asserts:
 *
 * 1. The Canvas-compatible shader-style upgrade accent (`ms-upgrade-shader`)
 *    is attached to an upgraded (level > 0) card and absent on a base
 *    (level 0) card; the old full-card gold upgrade border stays gone.
 * 2. When motion is allowed the accent carries a deterministic shimmer tween
 *    (`ms-upgrade-shimmer`), while reduced motion and replay/headless render
 *    the static form and create no tween.
 *
 * The effect is presentation-only: it never mutates game state.
 *
 * The pure spec/gradient/predicate contract is covered headlessly in
 * `upgrade-overlay-spec.test.ts` / `owner-card-border.test.ts`; this is the
 * end-to-end rendering leg of the ACs.
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

/** The animated shimmer rectangle on a card container, if present. */
function shimmerOf(container: any): any {
  return (container?.list ?? []).find((obj: any) => obj?.name === 'ms-upgrade-shimmer');
}

/** Every rectangle child of a container. */
function rectsOf(container: any): any[] {
  return (container?.list ?? []).filter(
    (obj: any) => obj instanceof Phaser.GameObjects.Rectangle,
  );
}

// ── Tests ───────────────────────────────────────────────────

describe('Upgrade shader effect (browser, AC1/AC3/AC5)', () => {
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

  it('animates a deterministic shimmer tween when motion is allowed', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;
    const biz = makeBiz({ id: 'shader-anim', level: 1 });
    scene.state.streetGrid[0] = biz;
    scene.refreshAll();

    await waitForCondition(() => Boolean(cardContainerForSlot(scene, 0)));
    const card = cardContainerForSlot(scene, 0);

    const shimmer = shimmerOf(card);
    expect(shimmer).toBeDefined();

    const tweens = scene.tweens.getTweensOf(shimmer);
    expect(tweens.length).toBeGreaterThanOrEqual(1);
    // The shimmer sweeps indefinitely (deterministic duration/easing are
    // asserted headlessly from the recorded tween config in the unit tests).
    expect(scene.tweens.isTweening(shimmer)).toBe(true);

    // Presentation-only: the effect never mutates game state.
    expect(scene.state.streetGrid[0]).toBe(biz);
    expect(scene.state.streetGrid[0].level).toBe(1);
  }, 30_000);

  it('renders the static form and creates no tween under reduced motion', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;
    if (scene.settingsPanel) scene.settingsPanel._reducedMotion = true;
    else scene.settingsPanel = { reducedMotion: true };

    scene.state.streetGrid[0] = makeBiz({ id: 'shader-rm', level: 1 });
    scene.refreshAll();

    await waitForCondition(() => Boolean(cardContainerForSlot(scene, 0)));
    const card = cardContainerForSlot(scene, 0);

    // The upgrade distinction is preserved in static form...
    expect(shaderEffectOf(card)).toBeDefined();
    expect(shaderEffectOf(card)).toBeInstanceOf(Phaser.GameObjects.Graphics);
    // ...but no shimmer object (and therefore no shimmer tween) is created.
    expect(shimmerOf(card)).toBeUndefined();
  }, 30_000);

  it('creates no animation in replay/headless mode', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;
    scene.replayMode = true;

    scene.state.streetGrid[0] = makeBiz({ id: 'shader-replay', level: 1 });
    scene.refreshAll();

    await waitForCondition(() => Boolean(cardContainerForSlot(scene, 0)));
    const card = cardContainerForSlot(scene, 0);

    expect(shaderEffectOf(card)).toBeDefined();
    expect(shimmerOf(card)).toBeUndefined();
  }, 30_000);
});
