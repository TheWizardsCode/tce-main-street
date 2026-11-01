/**
 * Main Street: Owner-Coloured Placed-Card Border Tests
 *
 * Automated coverage for F4 of MS-0MUWNTN8W006C7EF — every placed
 * business/community-space card carries an outer border in its owner's seat
 * colour, the full-card upgrade border is removed, and the upgrade indicator
 * moves to the top-left level badge / corner accent.
 *
 * These tests run in the Node unit environment, so Phaser and the browser-only
 * `@ui` modules are mocked. They assert the observable rendering wiring via the
 * public `drawBusinessSlot` / `applyUpgradeOverlays` API with a recording mock
 * scene: the owner border's colour matches the seat colour, it is a
 * transparent-filled full-card frame, the old gold full-card upgrade border is
 * gone, the top-left upgrade accent replaces it, and single-player (no seat
 * colour) is unchanged.
 *
 * Limitation: real Phaser pixel output needs a browser, which this repo does
 * not configure (only the `unit` vitest project ships). The manual/browser
 * legibility check is recorded on the work item.
 *
 * @module tests/main-street/owner-card-border
 */
import { describe, it, expect, vi } from 'vitest';

// Phaser and the browser-only renderer adapters are mocked, mirroring the
// existing street-renderer unit tests (synergy-tooltip-hover.test.ts).
vi.mock('phaser', () => ({ default: {} }));
vi.mock('@ui', () => ({ FONT_FAMILY: 'sans-serif', HandView: class {} }));
vi.mock('@ui/Renderer', () => ({ createGameZone: () => ({}) }));
vi.mock('@ui/Renderer/adapters/MainStreetAdapter', () => ({
  mainStreetRenderCardSvg: () => {},
}));

import {
  applyUpgradeOverlays,
  drawBusinessSlot,
} from '../../src/scenes/MainStreetRendererStreet';
import { seatColourToNumber } from '../../src/MainStreetSeatColours';
import { getSlotOwnerId, resolveSeatColour } from '../../src/MainStreetAdjacencyOwner';
import type { MainStreetRendererContext } from '../../src/scenes/MainStreetRendererContext';
import {
  GRID_SIZE,
  type BusinessCard,
  type CommunitySpaceCard,
} from '../../src/MainStreetCards';
import type { PlayerRecord } from '../../src/MainStreetStateTypes';

// ── Fixtures ────────────────────────────────────────────────

const SLOT_W = 140;
const SLOT_H = 80;
const RENDER_W = SLOT_W - 4;
const RENDER_H = SLOT_H - 4;

const ORANGE = '#E69F00';
const SKY_BLUE = '#56B4E9';

function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: 'biz-bakery',
    name: 'Bakery',
    cost: 3,
    baseIncome: 2,
    synergyTypes: ['Food'],
    maxLevel: 1,
    description: 'A test business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    ...overrides,
  };
}

function makeCommunitySpace(overrides: Partial<CommunitySpaceCard> = {}): CommunitySpaceCard {
  return {
    family: 'community-space',
    id: 'biz-park',
    name: 'Park',
    cost: 4,
    baseIncome: 1,
    ongoingCost: 0,
    synergyTypes: [],
    maxLevel: 1,
    description: 'A test community space',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ...overrides,
  };
}

/** A minimal but complete PlayerRecord (only the fields the renderer reads). */
function makePlayer(playerId: number, colour: string): PlayerRecord {
  return {
    playerId,
    coins: 0,
    reputation: 0,
    hand: [],
    staffCards: [],
    actionBudget: 1,
    score: 0,
    controller: playerId === 0 ? 'human' : 'ai',
    colour,
  };
}

// ── Recording mock scene ────────────────────────────────────

interface MockRect {
  kind: 'rectangle';
  x: number;
  y: number;
  w: number;
  h: number;
  fillColor?: number;
  fillAlpha?: number;
  strokeWidth?: number;
  strokeColor?: number;
  name?: string;
  data: Record<string, unknown>;
}

interface MockFill {
  color: number;
  alpha: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface MockGraphics {
  kind: 'graphics';
  name?: string;
  lastFill?: { color: number; alpha: number };
  fills: MockFill[];
  data: Record<string, unknown>;
}

interface MockContainer {
  kind: 'container';
  x: number;
  y: number;
  children: unknown[];
  data: Record<string, unknown>;
  destroyHandlers: (() => void)[];
}

interface HarnessOptions {
  players?: PlayerRecord[];
  ownerId?: number;
  sold?: boolean;
  replayMode?: boolean;
  reducedMotion?: boolean;
}

function createHarness(opts: HarnessOptions = {}) {
  const rects: MockRect[] = [];
  const containers: MockContainer[] = [];
  const graphicsList: MockGraphics[] = [];
  const tweenConfigs: Record<string, unknown>[] = [];
  const tweenManager = {
    add: vi.fn((config: Record<string, unknown>) => {
      tweenConfigs.push(config);
      return { ...config };
    }),
    killTweensOf: vi.fn(),
    isTweening: vi.fn(() => false),
  };

  const soldSlots = new Array<boolean>(GRID_SIZE).fill(false);
  if (opts.sold) soldSlots[0] = true;

  const ownerTaggedGrid = Array.from({ length: GRID_SIZE }, () => ({
    card: null,
    ownerId: null as number | null,
  }));
  if (opts.players && opts.ownerId !== undefined) {
    ownerTaggedGrid[0] = { card: null, ownerId: opts.ownerId };
  }

  const state: Record<string, unknown> = {
    streetGrid: new Array(GRID_SIZE).fill(null),
    soldSlots,
    players: opts.players,
    ownerTaggedGrid: opts.players ? ownerTaggedGrid : undefined,
    activePlayerId: 0,
    hand: [],
    config: {},
  };

  const scene = {
    layout: { slotW: SLOT_W, slotH: SLOT_H },
    replayMode: opts.replayMode ?? false,
    settingsPanel:
      opts.reducedMotion === undefined
        ? undefined
        : { reducedMotion: opts.reducedMotion },
    tweens: tweenManager,
    uiPhase: 'idle',
    pendingHandIndex: null,
    state,
    add: {
      container: vi.fn((x: number, y: number) => {
        const container: MockContainer = {
          kind: 'container',
          x,
          y,
          children: [],
          data: {},
          destroyHandlers: [],
        };
        containers.push(container);
        return {
          ...container,
          add: (obj: unknown) => {
            container.children.push(obj);
            return container;
          },
          setData: (key: string, value: unknown) => {
            container.data[key] = value;
            return container;
          },
          once: (event: string, handler: () => void) => {
            if (event === 'destroy') container.destroyHandlers.push(handler);
            return container;
          },
        };
      }),
      rectangle: vi.fn(
        (
          x: number,
          y: number,
          w: number,
          h: number,
          fillColor?: number,
          fillAlpha?: number,
        ) => {
          const rect: MockRect = {
            kind: 'rectangle',
            x,
            y,
            w,
            h,
            fillColor,
            fillAlpha,
            data: {},
          };
          rects.push(rect);
          const chain = {
            name: undefined as string | undefined,
            setStrokeStyle: (width: number, color: number) => {
              rect.strokeWidth = width;
              rect.strokeColor = color;
              return chain;
            },
            setFillStyle: (color: number, alpha: number) => {
              rect.fillColor = color;
              rect.fillAlpha = alpha;
              return chain;
            },
            setName: (name: string) => {
              rect.name = name;
              chain.name = name;
              return chain;
            },
            setData: (key: string, value: unknown) => {
              rect.data[key] = value;
              return chain;
            },
            setInteractive: () => chain,
            on: () => chain,
            setOrigin: () => chain,
          };
          return chain;
        },
      ),
      text: vi.fn(() => {
        const chain = {
          width: 20,
          setPosition: () => chain,
          setOrigin: () => chain,
          setColor: () => chain,
          setData: () => chain,
          setName: () => chain,
        };
        return chain;
      }),
      zone: vi.fn(() => {
        const chain = {
          setOrigin: () => chain,
          setInteractive: () => chain,
          setName: () => chain,
          on: () => chain,
        };
        return chain;
      }),
      // Shader-style upgrade accent (MS-0MV5I4O8U001SU5J): a Phaser Graphics
      // drawn as a stripped gradient. Recorded so the wiring can be asserted.
      graphics: vi.fn(() => {
        const graphics: MockGraphics = {
          kind: 'graphics',
          name: undefined,
          fills: [],
          data: {},
        };
        graphicsList.push(graphics);
        const chain = {
          clear: () => {
            graphics.fills.length = 0;
            return chain;
          },
          fillStyle: (color: number, alpha: number) => {
            graphics.lastFill = { color, alpha };
            return chain;
          },
          fillRect: (x: number, y: number, w: number, h: number) => {
            graphics.fills.push({ ...(graphics.lastFill ?? { color: 0, alpha: 1 }), x, y, w, h });
            return chain;
          },
          setName: (name: string) => {
            graphics.name = name;
            return chain;
          },
          setData: (key: string, value: unknown) => {
            graphics.data[key] = value;
            return chain;
          },
        };
        return chain;
      }),
    },
    streetContainer: { add: vi.fn((obj: unknown) => obj) },
  };

  const renderer: Record<string, unknown> = { scene };
  renderer.applyUpgradeOverlays = (
    container: unknown,
    biz: BusinessCard | CommunitySpaceCard,
    width: number,
    height: number,
  ) => applyUpgradeOverlays(renderer as unknown as MainStreetRendererContext, container as never, biz, width, height);

  return {
    renderer: renderer as unknown as MainStreetRendererContext,
    scene,
    rects,
    containers,
    graphics: graphicsList,
    tweenConfigs,
  };
}

/** The frame drawn for the card itself (full render size, no fill recorded). */
function ownerBorderRects(rects: MockRect[]): MockRect[] {
  return rects.filter((rect) => rect.data.ownerBorder === true);
}

// ── AC1/AC2: owner-coloured border colour matches the seat colour ──

describe('drawBusinessSlot owner-coloured border (AC1/AC2/AC3/AC7)', () => {
  it('draws an outer border in the AI owner’s seat colour on a business card', () => {
    const players = [makePlayer(0, ORANGE), makePlayer(1, SKY_BLUE)];
    const { renderer, rects } = createHarness({ players, ownerId: 1 });

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz());

    const borders = ownerBorderRects(rects);
    expect(borders).toHaveLength(1);
    const border = borders[0];
    // AC7: border colour equals the owner's seat colour.
    expect(border.strokeColor).toBe(seatColourToNumber(SKY_BLUE));
    // Full-card frame, transparent-filled so content is never obscured (AC6).
    expect(border.w).toBe(RENDER_W);
    expect(border.h).toBe(RENDER_H);
    expect(border.fillAlpha).toBe(0);
  });

  it('draws an outer border in the owner’s seat colour on a community-space card', () => {
    const players = [makePlayer(0, ORANGE), makePlayer(1, SKY_BLUE)];
    const { renderer, rects } = createHarness({ players, ownerId: 1 });

    drawBusinessSlot(renderer, 0, 0, 0, makeCommunitySpace());

    const borders = ownerBorderRects(rects);
    expect(borders).toHaveLength(1);
    expect(borders[0].strokeColor).toBe(seatColourToNumber(SKY_BLUE));
  });

  it('gives the human and AI owners visually distinct borders', () => {
    const players = [makePlayer(0, ORANGE), makePlayer(1, SKY_BLUE)];

    const human = createHarness({ players, ownerId: 0 });
    drawBusinessSlot(human.renderer, 0, 0, 0, makeBiz());
    const humanBorder = ownerBorderRects(human.rects)[0];

    const ai = createHarness({ players, ownerId: 1 });
    drawBusinessSlot(ai.renderer, 0, 0, 0, makeBiz());
    const aiBorder = ownerBorderRects(ai.rects)[0];

    expect(humanBorder.strokeColor).toBe(seatColourToNumber(ORANGE));
    expect(aiBorder.strokeColor).toBe(seatColourToNumber(SKY_BLUE));
    expect(humanBorder.strokeColor).not.toBe(aiBorder.strokeColor);
  });

  it('does not draw an owner border in single-player (no seat colour; AC unchanged)', () => {
    const { renderer, rects } = createHarness();

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz());

    expect(ownerBorderRects(rects)).toHaveLength(0);
  });

  it('keeps the owner border on a sold (dimmed) card', () => {
    const players = [makePlayer(0, ORANGE), makePlayer(1, SKY_BLUE)];
    const { renderer, rects } = createHarness({ players, ownerId: 1, sold: true });

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz());

    const borders = ownerBorderRects(rects);
    expect(borders).toHaveLength(1);
    expect(borders[0].strokeColor).toBe(seatColourToNumber(SKY_BLUE));
  });
});

// ── AC4/AC5: full-card upgrade border removed, indicator relocated ──

describe('upgrade border removed, top-left indicator (AC4/AC5)', () => {
  it('draws no full-card gold upgrade border for an upgraded card', () => {
    const players = [makePlayer(0, ORANGE), makePlayer(1, SKY_BLUE)];
    const { renderer, rects } = createHarness({ players, ownerId: 1 });

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz({ level: 1 }));

    // The old upgrade border was a full-card stroke in gold (0xffaa22).
    const goldStrokes = rects.filter(
      (rect) => rect.strokeColor === 0xffaa22,
    );
    expect(goldStrokes).toHaveLength(0);
  });

  it('relocates the upgrade indicator to a top-left corner accent', () => {
    const players = [makePlayer(0, ORANGE), makePlayer(1, SKY_BLUE)];
    const { renderer, rects } = createHarness({ players, ownerId: 1 });

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz({ level: 2 }));

    const accents = rects.filter((rect) => rect.name === 'ms-upgrade-accent');
    expect(accents).toHaveLength(1);
    const accent = accents[0];
    expect(accent.fillColor).toBe(0xffaa22);
    // Top-left corner in container-local coords (card centre is the origin).
    expect(accent.x).toBeLessThan(0);
    expect(accent.y).toBeLessThan(0);
  });

  it('draws no upgrade accent for a base (level 0) card', () => {
    const players = [makePlayer(0, ORANGE), makePlayer(1, SKY_BLUE)];
    const { renderer, rects } = createHarness({ players, ownerId: 1 });

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz({ level: 0 }));

    expect(rects.filter((rect) => rect.name === 'ms-upgrade-accent')).toHaveLength(0);
  });

  it('draws a shader-effect Graphics confined to the top-left accent region', () => {
    const players = [makePlayer(0, ORANGE), makePlayer(1, SKY_BLUE)];
    const { renderer, graphics } = createHarness({ players, ownerId: 1 });

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz({ level: 2 }));

    expect(graphics).toHaveLength(1);
    expect(graphics[0].name).toBe('ms-upgrade-shader');
    expect(graphics[0].fills.length).toBeGreaterThan(0);
    // Every gradient strip stays in the top-left quadrant (container-local
    // 0,0 is the card centre), so the effect is never a full-card stroke.
    for (const fill of graphics[0].fills) {
      expect(fill.x).toBeLessThan(0);
      expect(fill.y).toBeLessThan(0);
      expect(fill.x + fill.w).toBeLessThanOrEqual(0);
      expect(fill.y + fill.h).toBeLessThanOrEqual(0);
    }
  });

  it('draws a shard clearly larger and more vivid than the flat corner accent (remediation)', () => {
    const players = [makePlayer(0, ORANGE), makePlayer(1, SKY_BLUE)];
    const { renderer, graphics } = createHarness({ players, ownerId: 1 });

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz({ level: 2 }));

    const shader = graphics[0];
    const shardArea = shader.fills.reduce((sum, fill) => sum + fill.w * fill.h, 0);
    // The former flat accent was 30x16 = 480 px^2; the shard must clearly
    // exceed it so the upgrade distinction is actually visible on screen.
    expect(shardArea).toBeGreaterThan(480 * 2);

    // The shard carries the vivid gradient (gold + warm-white foil) rather
    // than the single flat gold fill the old accent used.
    const colours = new Set(shader.fills.map((fill) => fill.color));
    expect(colours.size).toBeGreaterThan(2);
    expect([...colours]).toContain(0xfff4d6);
  });

  it('draws no shader effect for a base (level 0) card', () => {
    const players = [makePlayer(0, ORANGE), makePlayer(1, SKY_BLUE)];
    const { renderer, graphics } = createHarness({ players, ownerId: 1 });

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz({ level: 0 }));

    expect(graphics).toHaveLength(0);
  });
});

// ── Seat-colour lookup helper ────────────────────────────────

describe('resolveSeatColour', () => {
  it('returns the seat colour in competitive multi-seat mode', () => {
    const players = [makePlayer(0, ORANGE), makePlayer(1, SKY_BLUE)];
    const state = { players } as never;

    expect(resolveSeatColour(state, 1)).toBe(SKY_BLUE);
  });

  it('returns undefined for the single-player roster', () => {
    const state = { players: [makePlayer(0, ORANGE)] } as never;

    expect(resolveSeatColour(state, 0)).toBeUndefined();
  });

  it('returns undefined when there is no roster', () => {
    expect(resolveSeatColour({} as never, 0)).toBeUndefined();
  });

  it('returns undefined for an unknown seat', () => {
    const players = [makePlayer(0, ORANGE), makePlayer(1, SKY_BLUE)];

    expect(resolveSeatColour({ players } as never, 9)).toBeUndefined();
  });
});

// ── Owner lookup integration ─────────────────────────────────

describe('owner lookup integration', () => {
  it('uses the slot’s tagged owner rather than the active player', () => {
    const players = [makePlayer(0, ORANGE), makePlayer(1, SKY_BLUE)];
    const { renderer } = createHarness({ players, ownerId: 1 });

    const ownerId = getSlotOwnerId(renderer.scene.state, 0);
    expect(ownerId).toBe(1);
    expect(resolveSeatColour(renderer.scene.state, ownerId)).toBe(SKY_BLUE);
  });
});

// ── MS-0MV5I4ONA000Z7NV: shader motion gating ─────────────────

/**
 * The shader accent animates (deterministic shimmer sweep) only when motion is
 * allowed; reduced motion and replay/headless render the static gradient and
 * create no tween. These tests assert the renderer wiring via the recording
 * tween manager, and that destroying the card container kills the tween.
 */
describe('shader motion gating (MS-0MV5I4ONA000Z7NV)', () => {
  it('creates a deterministic shimmer tween when motion is allowed', () => {
    const { renderer, graphics, tweenConfigs } = createHarness({
      reducedMotion: false,
      replayMode: false,
    });

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz({ level: 1 }));

    expect(tweenConfigs).toHaveLength(1);
    const tween = tweenConfigs[0] as Record<string, unknown>;
    expect(tween.duration).toBe(2000);
    expect(tween.ease).toBe('Sine.easeInOut');
    expect(tween.repeat).toBe(-1);
    // The sweep drives the shard gradient phase via a redraw callback, so the
    // shard itself animates rather than a separate overlay rectangle.
    expect(typeof tween.onUpdate).toBe('function');
    expect((tween.targets as { phase?: number }).phase).toBe(0);
    // The shader Graphics records its tween for lifecycle cleanup / QA.
    expect(graphics[0].data.shaderTween).toBeDefined();
  });

  it('creates a deterministic shimmer tween by default (no settings panel)', () => {
    const { renderer, tweenConfigs } = createHarness();

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz({ level: 1 }));

    expect(tweenConfigs).toHaveLength(1);
  });

  it('does not create a tween when reduced motion is enabled', () => {
    const { renderer, graphics, tweenConfigs } = createHarness({ reducedMotion: true });

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz({ level: 1 }));

    expect(tweenConfigs).toHaveLength(0);
    expect(graphics[0].data.shaderTween).toBeUndefined();
  });

  it('does not create a tween in replay mode', () => {
    const { renderer, graphics, tweenConfigs } = createHarness({ replayMode: true });

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz({ level: 1 }));

    expect(tweenConfigs).toHaveLength(0);
    expect(graphics[0].data.shaderTween).toBeUndefined();
  });

  it('creates no motion for a base (level 0) card even when motion is allowed', () => {
    const { renderer, tweenConfigs } = createHarness({ reducedMotion: false });

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz({ level: 0 }));

    expect(tweenConfigs).toHaveLength(0);
  });

  it('kills the shader tween when the card container is destroyed (no leak)', () => {
    const { renderer, containers, scene } = createHarness({ reducedMotion: false });

    drawBusinessSlot(renderer, 0, 0, 0, makeBiz({ level: 1 }));

    const container = containers[0];
    expect(container.destroyHandlers.length).toBeGreaterThan(0);
    for (const handler of container.destroyHandlers) handler();
    expect(scene.tweens.killTweensOf).toHaveBeenCalled();
  });
});
