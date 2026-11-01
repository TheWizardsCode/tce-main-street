/**
 * Main Street: HUD strip layout browser test (CG-0MUFAISSZ002TE1B).
 *
 * Verifies the widened, market-aligned HUD strip:
 * - the strip spans exactly `[hudLeft, hudRight]` (AC2);
 * - Coins are left-aligned at the strip's left edge; Score + week label are
 *   right-aligned at the strip's right edge;
 * - Reputation sits right of the reserved favour band and never overlaps the
 *   Score;
 * - the actions-remaining counter is NOT rendered inside the strip (it moves
 *   to the action cluster in CG-0MUFAITX70081W41);
 * - every strip child is transient-tagged and survives/replaces correctly
 *   across two `refreshHud()` calls (no leak, no persistent-panel destruction).
 *
 * @module tests/main-street/hud-strip-layout.browser
 */
import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { BOX_STROKE } from '../../src/scenes/MainStreetConstants';
import { PANEL_FILL_ALPHA, PANEL_FILL_COLOR } from './helpers/panelTreatment';

const TUTORIAL_STATE_KEY = 'tce-main-street-tutorial-state';

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

interface HudSnapshot {
  layout: {
    hudLeft: number;
    hudRight: number;
    hudWidth: number;
    favourBandRight: number;
  };
  children: Array<Phaser.GameObjects.GameObject & { _hudTransient?: boolean }>;
  texts: Phaser.GameObjects.Text[];
  strip: Phaser.GameObjects.Rectangle | undefined;
}

function snapshot(scene: Phaser.Scene & Record<string, unknown>): HudSnapshot {
  const hud = (scene as any).hudContainer as Phaser.GameObjects.Container;
  const list = (hud?.list ?? hud?.getAll?.() ?? []) as Array<
    Phaser.GameObjects.GameObject & { _hudTransient?: boolean }
  >;
  const texts = list.filter(
    (o): o is Phaser.GameObjects.Text => o instanceof Phaser.GameObjects.Text,
  );
  const strip = list.find(
    (o): o is Phaser.GameObjects.Rectangle =>
      o instanceof Phaser.GameObjects.Rectangle
      && o.width > 500
      && o.height <= 40,
  );
  return {
    layout: (scene as any).layout as HudSnapshot['layout'],
    children: list,
    texts,
    strip,
  };
}

describe('MainStreet HUD strip layout', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    try { (window as any).localStorage?.removeItem(TUTORIAL_STATE_KEY); } catch (_) { /* ignore */ }
    destroyGame(game);
    game = null;
  });

  it('draws a market-aligned strip with the counter removed from it', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;

    const before = snapshot(scene);
    expect(before.strip, 'HUD strip rectangle not found').toBeDefined();
    const strip = before.strip!;

    // Market-aligned edges: strip spans [hudLeft, hudRight].
    expect(strip.x).toBeCloseTo(before.layout.hudLeft, 0);
    expect(strip.x + strip.width).toBeCloseTo(before.layout.hudRight, 0);
    expect(strip.width).toBeCloseTo(before.layout.hudWidth, 0);

    // Coins left-aligned near the strip's left edge.
    const coinText = before.texts.find((t) => t.text?.startsWith('Coins:'));
    expect(coinText, 'Coins text missing').toBeDefined();
    expect(coinText!.x).toBeCloseTo(before.layout.hudLeft + 10, 0);

    // Score right-aligned near the strip's right edge.
    const scoreText = before.texts.find((t) => t.text?.startsWith('Score:'));
    expect(scoreText, 'Score text missing').toBeDefined();
    expect(scoreText!.getRightCenter().x).toBeCloseTo(before.layout.hudRight - 10, 0);

    // Week label retained under the Score.
    const weekText = before.texts.find((t) => t.text?.startsWith('Week '));
    expect(weekText, 'week label missing').toBeDefined();

    // Reputation is right of the reserved favour band and does not overlap Score.
    const repText = before.texts.find((t) => t.text?.startsWith('Reputation:'));
    expect(repText, 'Reputation text missing').toBeDefined();
    expect(repText!.getLeftCenter().x).toBeGreaterThanOrEqual(before.layout.favourBandRight);
    expect(repText!.getRightCenter().x).toBeLessThan(scoreText!.getLeftCenter().x);

    // No actions-remaining counter text inside the strip bounds.
    const counterInStrip = before.texts.find((t) => {
      if (!/\d+\s+actions?\s+left/i.test(t.text ?? '')) return false;
      const left = t.getLeftCenter().x;
      const right = t.getRightCenter().x;
      return left >= strip.x - 2 && right <= strip.x + strip.width + 2;
    });
    expect(counterInStrip, 'action counter must not render in the HUD strip').toBeUndefined();

    // Every strip child is transient-tagged.
    for (const child of [strip, coinText!, repText!, scoreText!, weekText!]) {
      expect((child as any)._hudTransient, 'strip child must be transient-tagged').toBe(true);
    }

    // Refresh: transient children are replaced (not leaked).
    const transientCountBefore = before.children.filter((c) => c._hudTransient).length;
    (scene as any).refreshHud();
    const after = snapshot(scene);
    const transientCountAfter = after.children.filter((c) => c._hudTransient).length;
    expect(transientCountAfter).toBe(transientCountBefore);

    // New strip is present and still market-aligned.
    expect(after.strip).toBeDefined();
    expect(after.strip!.x).toBeCloseTo(before.layout.hudLeft, 0);
    expect(after.strip!.x + after.strip!.width).toBeCloseTo(before.layout.hudRight, 0);
  }, 30_000);

  // Opaque HUD strip (parent MS-0MVKTB6WS000VLWK AC3). The strip used to be
  // `0x1a1408` at alpha 0.6, which let the map backdrop read through it; the
  // contract is the shared panel alpha (0.85) with the same `BOX_STROKE` token
  // the Activity Log / market / hand panels use, so the surfaces cannot drift.
  // Red phase: `it.fails` until MS-0MVPWQIPZ002PHPD raises the alpha.
  it('HUD strip uses the shared 0.85 opaque panel treatment (AC3; MS-0MVPWQIPZ002PHPD)', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;

    const strip = snapshot(scene).strip;
    expect(strip, 'HUD strip rectangle not found').toBeDefined();

    expect(strip!.isFilled, 'HUD strip must be a filled rectangle').toBe(true);
    expect(strip!.fillColor, 'HUD strip fill colour').toBe(PANEL_FILL_COLOR);
    expect(strip!.fillAlpha, 'HUD strip fill alpha').toBeCloseTo(PANEL_FILL_ALPHA, 2);
    expect(strip!.strokeColor, 'HUD strip border colour').toBe(BOX_STROKE);
    expect(strip!.lineWidth, 'HUD strip border width').toBe(1);
  }, 30_000);

  it('publishes coin/rep number anchors that match the rendered number centre (MS-0MUYT57J80021CWW)', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as Phaser.Scene & Record<string, unknown>;

    // Independent check of the published anchor: the centre of the numeric
    // portion of the `Coins: N` / `Reputation: N` label — label origin +
    // prefix width + number-width/2 — measured via probe texts rendered with
    // the label's exact style.
    const expectAnchorMatches = (
      label: Phaser.GameObjects.Text | undefined,
      prefix: string,
      anchor: { x: number; y: number } | null | undefined,
    ): void => {
      expect(label, `${prefix} label missing`).toBeDefined();
      expect(anchor, `${prefix} anchor must be published`).toBeDefined();
      const style = (label as unknown as { style: { toJSON: () => object } }).style.toJSON();
      const probe = (text: string): number => {
        const p = scene.add.text(0, 0, text, style) as Phaser.GameObjects.Text;
        const w = p.width;
        p.destroy();
        return w;
      };
      const number = String(label!.text).slice(prefix.length);
      const expected = label!.x + probe(prefix) + probe(number) / 2;
      // ≤2px tolerance (AC1) — the flights land on the number, not a label-
      // wide or gameW-fraction approximation.
      expect(Math.abs(anchor!.x - expected)).toBeLessThanOrEqual(2);
      expect(anchor!.y).toBeCloseTo(Number(label!.y), 0);
    };

    const before = snapshot(scene);
    expectAnchorMatches(
      before.texts.find((t) => t.text?.startsWith('Coins:')),
      'Coins: ',
      (scene as any).hudCoinAnchor,
    );
    expectAnchorMatches(
      before.texts.find((t) => t.text?.startsWith('Reputation:')),
      'Reputation: ',
      (scene as any).hudRepAnchor,
    );

    // Layout drift resilience (AC3): re-rendering the HUD republishes the
    // anchors from the live layout/values — the re-rendered numbers still
    // match.
    (scene as any).refreshHud();
    const after = snapshot(scene);
    expectAnchorMatches(
      after.texts.find((t) => t.text?.startsWith('Coins:')),
      'Coins: ',
      (scene as any).hudCoinAnchor,
    );
    expectAnchorMatches(
      after.texts.find((t) => t.text?.startsWith('Reputation:')),
      'Reputation: ',
      (scene as any).hudRepAnchor,
    );

    // Digit-count resilience (AC1): a large coin/reputation value widens the
    // number, and the republished anchor must still cover the glyph centre.
    (scene as any).state.resourceBank.coins = 1234567;
    (scene as any).state.resourceBank.reputation = 987654;
    (scene as any).refreshHud();
    const wide = snapshot(scene);
    expect(wide.texts.find((t) => t.text?.startsWith('Coins:'))!.text).toBe('Coins: 1234567');
    expect(wide.texts.find((t) => t.text?.startsWith('Reputation:'))!.text).toBe('Reputation: 987654');
    expectAnchorMatches(
      wide.texts.find((t) => t.text?.startsWith('Coins:')),
      'Coins: ',
      (scene as any).hudCoinAnchor,
    );
    expectAnchorMatches(
      wide.texts.find((t) => t.text?.startsWith('Reputation:')),
      'Reputation: ',
      (scene as any).hudRepAnchor,
    );
  }, 30_000);
});
