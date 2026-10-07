/**
 * Live population reconciliation — behaviour tests (MS-0MUYGFWKG008GUA5)
 *
 * The ambient crowd must track the authoritative HUD reputation value while a
 * turn is in progress: the renderer's `animateHudValueChanges` reputation path
 * triggers an animator-context accessor that reconciles the pedestrian layer
 * to `pedestrianCount(reputation)`.
 *
 * Locked contracts:
 *  - a reputation gain fades a figure in and a loss fades a figure out, so the
 *    on-street count always matches the HUD value (0→1 gain, 2→1 loss);
 *  - reconciliation is delta-only — repeated changes in one turn add/remove
 *    only the difference and never rebuild (retained figures keep identity);
 *  - Reduced Motion and replay/headless skip the change, draw no RNG, and
 *    never mutate game state;
 *  - the refresh is purely presentation: no gameplay RNG (`Math.random`) is
 *    consumed and the scene `state` object is never touched.
 *
 * Runs in the Node unit environment with Phaser + UI mocked. The observable
 * contract is the public `MainStreetAnimator.animateHudValueChanges` API plus
 * the pedestrian layer's figure count and its fade tweens.
 *
 * @module tests/main-street/pedestrians-live-refresh
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

const { popTextOrIcon } = vi.hoisted(() => ({
  popTextOrIcon: vi.fn(() => Promise.resolve()),
}));

vi.mock('@ui', () => ({
  FONT_FAMILY: 'sans-serif',
  popTextOrIcon,
  moveGameObject: vi.fn((_opts?: unknown) => ({})),
}));

import type { SceneLayout } from '../../src/scenes/MainStreetConstants';
import { PEDESTRIAN_FADE_MS, PEDESTRIAN_TEXTURE_KEY } from '../../src/scenes/MainStreetConstants';
import { MainStreetAnimator } from '../../src/scenes/MainStreetAnimator';
import {
  MainStreetPedestrians,
  createPresentationRng,
  pedestrianCount,
} from '../../src/scenes/MainStreetPedestrians';

/** A minimal layout with the street-geometry fields the wander bounds read. */
const LAYOUT = {
  gameW: 1280,
  gameH: 720,
  hudY: 50,
  marketTop: 60,
  streetTop: 200,
  streetX: 100,
  slotW: 140,
  slotH: 80,
  slotGap: 20,
  streetRowGap: 12,
  streetCols: 5,
} as unknown as SceneLayout;

interface MockImage {
  x: number;
  y: number;
  textureKey: string;
  alpha: number;
  setOrigin: ReturnType<typeof vi.fn>;
  setDepth: ReturnType<typeof vi.fn>;
  setPosition: ReturnType<typeof vi.fn>;
  setAlpha: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

interface TweenConfig {
  targets: MockImage;
  alpha: number;
  duration?: number;
  onComplete?: () => void;
}

interface MockContainer {
  name?: string;
  children: unknown[];
  add: (child: unknown) => void;
  setName?: (name: string) => MockContainer;
  destroy: ReturnType<typeof vi.fn>;
  destroyed: boolean;
  list: unknown[];
}

function makeContainer(): MockContainer {
  const container: MockContainer = {
    children: [],
    list: [],
    destroyed: false,
    add(child: unknown) {
      container.children.push(child);
      container.list = container.children;
    },
    setName(name: string) {
      container.name = name;
      return container;
    },
    destroy: vi.fn(() => {
      container.destroyed = true;
    }),
  };
  return container;
}

interface IntegrationScene {
  layout: SceneLayout;
  replayMode: boolean;
  settingsPanel: { reducedMotion: boolean } | null;
  incomeCollectionActive: boolean;
  previousCoins: number | null;
  previousReputation: number | null;
  state: { resourceBank: { coins: number; reputation: number } };
  gameEvents: { emit: ReturnType<typeof vi.fn> };
  soundManager: { play: ReturnType<typeof vi.fn> };
  textures: { exists: (key: string) => boolean };
  getStreetContainer: () => MockContainer;
  add: {
    text: ReturnType<typeof vi.fn>;
    container: ReturnType<typeof vi.fn>;
    image: ReturnType<typeof vi.fn>;
    graphics: ReturnType<typeof vi.fn>;
  };
  tweens: { add: ReturnType<typeof vi.fn> };
  msPedestrians: MainStreetPedestrians;
}

function createHarness(options: {
  reducedMotion?: boolean;
  replayMode?: boolean;
  withTweens?: boolean;
  rng?: () => number;
} = {}): {
  scene: IntegrationScene;
  animator: MainStreetAnimator;
  layer: MainStreetPedestrians;
  images: MockImage[];
  tweenConfigs: TweenConfig[];
  streetContainer: MockContainer;
} {
  const textureKeys = new Set<string>();
  const images: MockImage[] = [];
  const tweenConfigs: TweenConfig[] = [];
  const streetContainer = makeContainer();

  const scene = {
    layout: LAYOUT,
    replayMode: options.replayMode ?? false,
    settingsPanel: { reducedMotion: options.reducedMotion ?? false },
    incomeCollectionActive: false,
    previousCoins: null,
    previousReputation: null,
    state: { resourceBank: { coins: 0, reputation: 0 } },
    gameEvents: { emit: vi.fn() },
    soundManager: { play: vi.fn() },
    textures: { exists: (key: string) => textureKeys.has(key) },
    getStreetContainer: () => streetContainer,
    add: {
      text: vi.fn(() => ({
        setOrigin: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
      })),
      container: vi.fn(() => makeContainer()),
      image: vi.fn((x: number, y: number, textureKey: string) => {
        const image: MockImage = {
          x,
          y,
          textureKey,
          alpha: 1,
          setOrigin: vi.fn().mockReturnThis(),
          setDepth: vi.fn().mockReturnThis(),
          setPosition: vi.fn(function (this: MockImage, nx: number, ny: number) {
            this.x = nx;
            this.y = ny;
            return this;
          }),
          setAlpha: vi.fn(function (this: MockImage, value: number) {
            this.alpha = value;
            return this;
          }),
          destroy: vi.fn(),
        };
        images.push(image);
        return image;
      }),
      graphics: vi.fn(() => ({
        fillStyle: vi.fn().mockReturnThis(),
        fillCircle: vi.fn().mockReturnThis(),
        fillRect: vi.fn().mockReturnThis(),
        generateTexture: vi.fn((key: string) => {
          textureKeys.add(key);
        }),
        destroy: vi.fn(),
      })),
    },
    // Omit `tweens` entirely to exercise the no-tween-manager fallback.
    ...(options.withTweens === false
      ? {}
      : { tweens: { add: vi.fn((cfg: TweenConfig) => {
          tweenConfigs.push(cfg);
          return {};
        }) } }),
  } as unknown as IntegrationScene;

  const layer = new MainStreetPedestrians(
    scene,
    options.rng ?? createPresentationRng(42),
  );
  scene.msPedestrians = layer;

  return {
    scene,
    animator: new MainStreetAnimator(scene),
    layer,
    images,
    tweenConfigs,
    streetContainer,
  };
}

/** Drive one HUD refresh through the public animator API. */
function refresh(
  animator: MainStreetAnimator,
  reputation: number,
  coins = 0,
): void {
  animator.animateHudValueChanges({
    coins,
    reputation,
    coinX: 100,
    repX: 640,
    hudY: 50,
  });
}

describe('live population refresh — animator-context accessor (MS-0MUYGFWKG008GUA5)', () => {
  let mathRandomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mathRandomSpy = vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    mathRandomSpy.mockRestore();
  });

  it('seeds the initial population from the HUD reputation on the first render', () => {
    const { animator, layer } = createHarness();

    refresh(animator, 100);

    expect(layer.getTargetCount()).toBe(pedestrianCount(100));
    expect(layer.getFigureCount()).toBe(2);
  });

  it('fades a figure in on a 0→1 reputation gain', () => {
    const { animator, layer, images, tweenConfigs } = createHarness();

    refresh(animator, 0);
    expect(layer.getFigureCount()).toBe(0);

    refresh(animator, 50);

    expect(layer.getFigureCount()).toBe(1);
    expect(images).toHaveLength(1);
    // Fade-in: spawned transparent, then tweened to full opacity.
    expect(images[0].setAlpha).toHaveBeenCalledWith(0);
    expect(tweenConfigs).toContainEqual(
      expect.objectContaining({
        targets: images[0],
        alpha: 1,
        duration: PEDESTRIAN_FADE_MS,
      }),
    );
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });

  it('fades a figure out on a 2→1 reputation loss', () => {
    const { animator, layer, images, tweenConfigs } = createHarness();

    refresh(animator, 100);
    expect(layer.getFigureCount()).toBe(2);
    const removed = images[images.length - 1];

    refresh(animator, 50);

    // The on-street count matches the HUD value immediately…
    expect(layer.getFigureCount()).toBe(1);
    // …while the outgoing figure fades to transparent before being destroyed.
    expect(removed.destroy).not.toHaveBeenCalled();
    const fadeOut = tweenConfigs.find((cfg) => cfg.targets === removed && cfg.alpha === 0);
    expect(fadeOut).toBeDefined();
    expect(fadeOut?.duration).toBe(PEDESTRIAN_FADE_MS);
    fadeOut?.onComplete?.();
    expect(removed.destroy).toHaveBeenCalled();
  });

  it('reconciles multi-change turns with delta-only add/remove (no rebuild)', () => {
    const { animator, layer, images } = createHarness();

    refresh(animator, 0); // 0 figures
    refresh(animator, 50); // +1
    const firstFigureImage = images[0];
    refresh(animator, 100); // +1
    refresh(animator, 60); // still 1 figure — sub-threshold change is a no-op
    refresh(animator, 50); // -1
    refresh(animator, 150); // +2

    expect(layer.getFigureCount()).toBe(3);
    // Four images created in total (1 + 1 + 0 + 0 + 2): only the deltas.
    expect(images).toHaveLength(4);
    // The retained figure kept its identity — the layer never rebuilt.
    expect(images[0]).toBe(firstFigureImage);
  });

  it('skips the change and draws no RNG under Reduced Motion', () => {
    const rng = vi.fn(createPresentationRng(7));
    const { animator, layer, images, scene } = createHarness({
      reducedMotion: true,
      rng,
    });

    refresh(animator, 0);
    refresh(animator, 150);

    expect(layer.isEnabled()).toBe(false);
    expect(layer.getFigureCount()).toBe(0);
    expect(images).toHaveLength(0);
    expect(rng).not.toHaveBeenCalled();
    expect(mathRandomSpy).not.toHaveBeenCalled();
    // The live refresh never mutates game state.
    expect(scene.state.resourceBank).toEqual({ coins: 0, reputation: 0 });
  });

  it('skips the change in replay/headless mode', () => {
    const { animator, layer, images } = createHarness({ replayMode: true });

    refresh(animator, 0);
    refresh(animator, 150);

    expect(layer.isEnabled()).toBe(false);
    expect(layer.getFigureCount()).toBe(0);
    expect(images).toHaveLength(0);
    expect(mathRandomSpy).not.toHaveBeenCalled();
  });

  it('is defensive: a throwing layer never propagates from the refresh path', () => {
    const { animator, scene } = createHarness();
    (scene as { msPedestrians: unknown }).msPedestrians = {
      setPopulation: vi.fn(() => {
        throw new Error('boom');
      }),
    };

    expect(() => refresh(animator, 150)).not.toThrow();
  });
});

describe('pedestrian fade — no tween manager fallback (MS-0MUYGFWKG008GUA5)', () => {
  it('snaps figures to full opacity and destroys removed figures immediately', () => {
    const { animator, layer, images, tweenConfigs } = createHarness({ withTweens: false });

    refresh(animator, 100);
    expect(layer.getFigureCount()).toBe(2);
    expect(images[0].setAlpha).toHaveBeenCalledWith(1);
    expect(tweenConfigs).toHaveLength(0);

    refresh(animator, 50);
    expect(images[1].destroy).toHaveBeenCalled();
  });
});

describe('pedestrian texture reuse (MS-0MUYGFWKG008GUA5)', () => {
  it('generates the shared silhouette texture once across live refreshes', () => {
    const { animator, scene } = createHarness();

    refresh(animator, 50);
    refresh(animator, 150);
    refresh(animator, 100);

    expect(scene.add.graphics).toHaveBeenCalledTimes(1);
    expect(scene.textures.exists(PEDESTRIAN_TEXTURE_KEY)).toBe(true);
  });
});
