/**
 * Main Street: Synergy Link Tooltip Hover-Wiring Tests
 *
 * Automated coverage for the interactive hover band added to each persistent
 * synergy line by `drawSynergyLines()`. Runs in the Node unit environment, so
 * Phaser and the browser-only `@ui` modules are mocked.
 *
 * The band is a narrow, rotated, invisible zone added to `streetContainer`
 * after the line. These tests assert the observable wiring: one zone per pair,
 * its geometry (clamped to the gap between the two cards), the tooltip content
 * shown on `pointerover`, the hide on `pointerout`, and the replay-mode /
 * missing-TooltipManager guards.
 *
 * Limitation: real Phaser pointer hit-testing needs a browser, which this repo
 * does not configure (only the `unit` vitest project is shipped). The tests
 * therefore assert the wiring and geometry via the public `drawSynergyLines()`
 * API with a recording mock scene; the hit-band geometry is also constrained
 * so it cannot cover either slot rect (the regression risk the intake brief
 * called out).
 *
 * @module tests/main-street/synergy-tooltip-hover
 */
import { describe, it, expect, vi } from 'vitest';

// Phaser is browser-only; the renderer only uses it for type annotations.
vi.mock('phaser', () => ({ default: {} }));
vi.mock('@ui', () => ({ FONT_FAMILY: 'sans-serif', HandView: class {} }));
vi.mock('@ui/Renderer', () => ({ createGameZone: () => ({}) }));
vi.mock('@ui/Renderer/adapters/MainStreetAdapter', () => ({
  mainStreetRenderCardSvg: () => {},
}));

import { drawSynergyLines } from '../../src/scenes/MainStreetRendererStreet';
import { buildSynergyLinkTooltipInfo } from '../../src/MainStreetFormatting';
import type { MainStreetRendererContext } from '../../src/scenes/MainStreetRendererContext';
import {
  GRID_SIZE,
  type BusinessCard,
  type CommunitySpaceCard,
} from '../../src/MainStreetCards';

// ── Fixtures ────────────────────────────────────────────────

interface MockZone {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  name?: string;
  interactive: boolean;
  fire(event: string): void;
}

function makeBiz(
  id: string,
  name: string,
  overrides: Partial<BusinessCard> = {},
): BusinessCard {
  return {
    family: 'business',
    id,
    name,
    cost: 3,
    baseIncome: 2,
    synergyTypes: ['Food'],
    synergyCoinBonus: 0.5,
    synergyRepBonus: 0,
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

function emptyGrid(): (BusinessCard | CommunitySpaceCard | null)[] {
  return new Array<BusinessCard | CommunitySpaceCard | null>(GRID_SIZE).fill(null);
}

interface HarnessOptions {
  replayMode?: boolean;
  withTooltipManager?: boolean;
  grid?: (BusinessCard | CommunitySpaceCard | null)[];
  nodes?: Array<{ gameplayIndex: number; localX: number; localY: number }>;
}

function createHarness(opts: HarnessOptions = {}) {
  const zones: MockZone[] = [];
  const graphics: unknown[] = [];
  const show = vi.fn();
  const hide = vi.fn();

  const grid = opts.grid ?? (() => {
    const g = emptyGrid();
    g[0] = makeBiz('biz-bakery', 'Bakery');
    g[1] = makeBiz('biz-diner', 'Diner');
    return g;
  })();

  const scene = {
    layout: {
      streetX: 0,
      streetTop: 0,
      slotW: 140,
      slotH: 80,
      slotGap: 20,
      streetRowGap: 12,
      streetCols: 5,
    },
    replayMode: opts.replayMode ?? false,
    tooltipManager: opts.withTooltipManager === false ? undefined : { show, hide },
    state: {
      streetGrid: grid,
      soldSlots: new Array(GRID_SIZE).fill(false),
      config: { synergyBonusPerNeighbor: 1 },
    },
    // The 10-slot GRID_SIZE fixture is the 1×1 (legacy) lattice, so
    // `drawSynergyLines` resolves gridDims to `undefined`.
    streetPlayableLattice: { cols: 1, rows: 1 },
    add: {
      graphics: vi.fn(() => {
        const g = {
          lineStyle: vi.fn().mockReturnThis(),
          beginPath: vi.fn().mockReturnThis(),
          moveTo: vi.fn().mockReturnThis(),
          lineTo: vi.fn().mockReturnThis(),
          strokePath: vi.fn().mockReturnThis(),
        };
        graphics.push(g);
        return g;
      }),
      zone: vi.fn((x: number, y: number, width: number, height: number) => {
        const handlers: Record<string, Array<() => void>> = {};
        const zone: MockZone = {
          x,
          y,
          width,
          height,
          rotation: 0,
          interactive: false,
          fire: (event: string) => (handlers[event] ?? []).forEach((cb) => cb()),
        };
        zones.push(zone);
        return {
          setOrigin: () => zone,
          setRotation: (r: number) => {
            zone.rotation = r;
            return zone;
          },
          setName: (n: string) => {
            zone.name = n;
            return zone;
          },
          setInteractive: () => {
            zone.interactive = true;
            return zone;
          },
          on: (event: string, cb: () => void) => {
            (handlers[event] ??= []).push(cb);
            return zone;
          },
          destroy: vi.fn(),
        };
      }),
    },
    streetContainer: {
      add: vi.fn((obj: unknown) => obj),
    },
  };

  const nodes = opts.nodes ?? [
    { gameplayIndex: 0, localX: 0, localY: 0 },
    { gameplayIndex: 1, localX: 160, localY: 0 },
  ];
  const renderer = {
    scene,
    mapNodes: vi.fn(() => nodes),
  };

  return {
    renderer: renderer as unknown as MainStreetRendererContext,
    scene,
    zones,
    graphics,
    show,
    hide,
  };
}

// ── Tests ───────────────────────────────────────────────────

describe('drawSynergyLines synergy-link hover band', () => {
  it('adds one narrow rotated hit band per pair and shows the link tooltip on hover', () => {
    const { renderer, zones, show, hide, scene } = createHarness();

    drawSynergyLines(renderer);

    expect(zones).toHaveLength(1);
    const zone = zones[0];

    // Named after the pair so tests/QA can address it.
    expect(zone.name).toBe('ms-synergy-line-zone-0-1');
    expect(zone.interactive).toBe(true);

    // Slot 0 centre (70,40), slot 1 centre (230,40) → clipped segment
    // (140,40)→(160,40), midpoint (150,40), length 20.
    expect(zone.x).toBe(150);
    expect(zone.y).toBe(40);
    expect(zone.width).toBe(20);
    expect(zone.rotation).toBeCloseTo(0, 6);

    // The band spans only the gap between the slot rects (x ∈ [140,160]) and
    // is thin, so it cannot steal either slot's hover/click zone.
    expect(zone.x - zone.width / 2).toBeGreaterThanOrEqual(140);
    expect(zone.x + zone.width / 2).toBeLessThanOrEqual(160);
    expect(zone.height).toBeLessThanOrEqual(12);

    // Hover shows the same content the pure builder produces.
    const expected = buildSynergyLinkTooltipInfo(
      scene.state.streetGrid,
      0,
      1,
      'Food',
      scene.state.config,
      scene.state.soldSlots,
      undefined,
    );
    expect(expected).not.toBe('');
    zone.fire('pointerover');
    expect(show).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledWith(expected, 150, 40);

    // Leaving hides it.
    zone.fire('pointerout');
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('rotates the band to the segment angle for a vertically adjacent pair', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz('biz-a', 'Biz A');
    grid[5] = makeBiz('biz-b', 'Biz B');
    const { renderer, zones } = createHarness({
      grid,
      nodes: [
        { gameplayIndex: 0, localX: 0, localY: 0 },
        { gameplayIndex: 5, localX: 0, localY: 92 },
      ],
    });

    drawSynergyLines(renderer);

    expect(zones).toHaveLength(1);
    const zone = zones[0];
    // Slot 0 centre (70,40), slot 5 centre (70,132) → clipped (70,80)→(70,92).
    expect(zone.x).toBe(70);
    expect(zone.y).toBe(86);
    expect(zone.width).toBe(12);
    expect(zone.rotation).toBeCloseTo(Math.PI / 2, 6);
  });

  it('does not create hit bands in replay mode (lines still render)', () => {
    const { renderer, zones, graphics } = createHarness({ replayMode: true });

    drawSynergyLines(renderer);

    expect(graphics).toHaveLength(1);
    expect(zones).toHaveLength(0);
  });

  it('does not create hit bands when no TooltipManager is present', () => {
    const { renderer, zones } = createHarness({ withTooltipManager: false });

    drawSynergyLines(renderer);

    expect(zones).toHaveLength(0);
  });

  it('creates no hit band for a zero-synergy opt-out pair (no line drawn either)', () => {
    const grid = emptyGrid();
    grid[0] = makeBiz('biz-hardware', 'Hardware');
    grid[1] = makeBiz('biz-pawnshop', 'Pawn Shop', { synergyCoinBonus: 0, synergyRepBonus: 0 });
    const { renderer, zones, graphics } = createHarness({ grid });

    drawSynergyLines(renderer);

    expect(graphics).toHaveLength(0);
    expect(zones).toHaveLength(0);
  });
});
