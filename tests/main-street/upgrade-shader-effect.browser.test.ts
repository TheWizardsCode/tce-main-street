/**
 * Main Street: Upgrade Shader Effect Browser Tests
 * (MS-0MV5I4O8U001SU5J static shard, MS-0MV5I4ONA000Z7NV motion,
 *  MS-0MUWNTQ5L0075Y38 remediation)
 *
 * Boots a real Phaser game in Chromium and asserts:
 *
 * 1. The Canvas-compatible shader-style upgrade shard (`ms-upgrade-shader`,
 *    a `Graphics`) is attached to an upgraded (level > 0) card and absent on a
 *    base (level 0) card; the old full-card gold upgrade border stays gone.
 * 2. The reworked shard is actually *visible*: upgrading a card measurably
 *    brightens its top-left quadrant (the previous flat gold accent sat at the
 *    exact same spot in the exact same colour, so the manual review saw "no
 *    difference in the upgraded cards").
 * 3. When motion is allowed the shard runs a deterministic shimmer tween,
 *    while reduced motion and replay/headless render the static form and
 *    create no tween.
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
  const game = createMainStreetGame({
    type: Phaser.CANVAS,
    parent: 'game-container',
    width: 1280,
    height: 720,
  });
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

/** Wait N animation frames (mirrors the migration browser test). */
function waitFrames(n: number, fallbackMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let left = n;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fallback = setTimeout(finish, fallbackMs);
    const tick = () => {
      if (settled) return;
      left -= 1;
      if (left <= 0) { clearTimeout(fallback); finish(); }
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
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

/** The shader-style upgrade shard Graphics on a card container, if present. */
function shaderEffectOf(container: any): any {
  return (container?.list ?? []).find((obj: any) => obj?.name === 'ms-upgrade-shader');
}

/** Every rectangle child of a container. */
function rectsOf(container: any): any[] {
  return (container?.list ?? []).filter(
    (obj: any) => obj instanceof Phaser.GameObjects.Rectangle,
  );
}

/** Read a single pixel from the game canvas at (x, y). */
async function readPixel(
  scene: Phaser.Scene,
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
): Promise<[number, number, number, number]> {
  try {
    const renderer: any = (scene.game as Phaser.Game).renderer;
    if (renderer && typeof renderer.snapshotPixel === 'function') {
      const value = await new Promise<{ r: number; g: number; b: number; a?: number }>((resolve) => {
        renderer.snapshotPixel(x, y, (pixel: any) => resolve(pixel));
      });
      if (value && typeof value.r === 'number') {
        return [value.r, value.g, value.b, value.a ?? 255];
      }
    }
  } catch (_) { /* fall back to the 2D context */ }

  const ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    const data = ctx2d.getImageData(x, y, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  }
  throw new Error('No render context available for pixel read');
}

/** Mean luminance (0–255) of the top-left fraction of a card's bounds. */
async function meanTopLeftLuminance(
  scene: Phaser.Scene,
  canvas: HTMLCanvasElement,
  card: any,
  fraction = 0.45,
): Promise<number> {
  const bounds = card.getBounds();
  const w = Math.max(4, Math.round(bounds.width * fraction));
  const h = Math.max(4, Math.round(bounds.height * fraction));
  const x0 = Math.max(0, Math.round(bounds.x));
  const y0 = Math.max(0, Math.round(bounds.y));
  let total = 0;
  let count = 0;
  for (let x = x0; x < x0 + w; x += 4) {
    for (let y = y0; y < y0 + h; y += 4) {
      const [r, g, b] = await readPixel(scene, canvas, x, y);
      total += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count += 1;
    }
  }
  return count > 0 ? total / count : 0;
}

// ── Tests ───────────────────────────────────────────────────

describe('Upgrade shader effect (browser, AC1/AC3/AC5)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('attaches the shader shard to an upgraded card and not to a base card', async () => {
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

    // Upgraded card (level > 0) carries the Canvas-compatible shader shard,
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

  it('visibly brightens the top-left quadrant when a card is upgraded (remediation)', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;
    // Static form keeps the readback deterministic.
    if (scene.settingsPanel) scene.settingsPanel._reducedMotion = true;
    else scene.settingsPanel = { reducedMotion: true };

    const canvas = document.querySelector('#game-container canvas') as HTMLCanvasElement;
    expect(canvas).toBeTruthy();

    scene.state.streetGrid[0] = makeBiz({ id: 'shader-pixel', level: 0 });
    scene.refreshAll();
    await waitForCondition(() => Boolean(cardContainerForSlot(scene, 0)));
    await waitFrames(4);
    const baseCard = cardContainerForSlot(scene, 0);
    const baseLuma = await meanTopLeftLuminance(scene, canvas, baseCard);

    scene.state.streetGrid[0] = makeBiz({ id: 'shader-pixel', level: 2 });
    scene.refreshAll();
    await waitForCondition(() => Boolean(shaderEffectOf(cardContainerForSlot(scene, 0))));
    await waitFrames(4);
    const upgradedCard = cardContainerForSlot(scene, 0);
    const upgradedLuma = await meanTopLeftLuminance(scene, canvas, upgradedCard);

    // The card face texture is identical (no displayName variant), so the only
    // difference in the top-left quadrant is the upgrade badge / accent / shard.
    // The shard must make a measurable difference, not the old invisible
    // same-colour gold patch.
    // Measured on this renderer: base ~16.6, upgraded ~34.5 mean luminance.
    expect(upgradedLuma).toBeGreaterThan(baseLuma + 5);
  }, 30_000);

  it('animates a deterministic shimmer tween when motion is allowed', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;
    const biz = makeBiz({ id: 'shader-anim', level: 1 });
    scene.state.streetGrid[0] = biz;
    scene.refreshAll();

    await waitForCondition(() => Boolean(cardContainerForSlot(scene, 0)));
    const card = cardContainerForSlot(scene, 0);
    const shader = shaderEffectOf(card);
    expect(shader).toBeDefined();

    const tween = shader.getData('shaderTween');
    expect(tween).toBeDefined();
    expect(typeof tween.isPlaying === 'function' ? tween.isPlaying() : true).toBe(true);

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
    const shader = shaderEffectOf(card);
    expect(shader).toBeDefined();
    expect(shader).toBeInstanceOf(Phaser.GameObjects.Graphics);
    // ...but no shimmer tween is created.
    expect(shader.getData('shaderTween')).toBeUndefined();
  }, 30_000);

  it('creates no animation in replay/headless mode', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;
    scene.replayMode = true;

    scene.state.streetGrid[0] = makeBiz({ id: 'shader-replay', level: 1 });
    scene.refreshAll();

    await waitForCondition(() => Boolean(cardContainerForSlot(scene, 0)));
    const card = cardContainerForSlot(scene, 0);

    const shader = shaderEffectOf(card);
    expect(shader).toBeDefined();
    expect(shader.getData('shaderTween')).toBeUndefined();
  }, 30_000);
});
