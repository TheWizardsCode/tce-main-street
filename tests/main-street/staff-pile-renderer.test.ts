/**
 * Main Street: Staff Pile renderer (MS-0MWBWKZ1G006IBH2).
 *
 * Unit coverage for `MainStreetRendererStaffPile` using a stub scene, so the
 * pile's rendering contract is verified without booting Phaser:
 *
 *  - empty state — no management-company staff ⇒ nothing drawn (no placeholder);
 *  - membership — only management-company staff reach the pile;
 *  - stack — the newest hire is drawn last (on top) and the stack is capped;
 *  - count badge and portrait row content;
 *  - the pile's depth keeps it behind the hand layer;
 *  - the single hover hit area is clamped to the free band left of the hand
 *    capacity row, and hovering it shows/hides the tooltip;
 *  - repeated refreshes destroy the previous pile (no object accumulation).
 *
 * The SVG card renderer is mocked: it is a pure texture pipeline, not part of
 * the pile's own contract.
 *
 * @module
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStaffDeck, type StaffCard } from '../../src/MainStreetCards';

// Phaser and the `@ui` barrel pull a browser-only module graph; the pile
// module only needs `FONT_FAMILY` from `@ui`, and the SVG card renderer is
// mocked below, so both are stubbed at the module boundary.
vi.mock('phaser', () => ({ default: {} }));

const renderCardSvg = vi.fn();

vi.mock('@ui', () => ({ FONT_FAMILY: 'sans-serif' }));

vi.mock('@ui/Renderer/adapters/MainStreetAdapter', () => ({
  mainStreetRenderCardSvg: (...args: unknown[]) => renderCardSvg(...args),
}));

import {
  destroyStaffPile,
  drawStaffPile,
  staffPileHitBounds,
  STAFF_PILE_HIT_NAME,
  STAFF_PILE_NAME,
} from '../../src/scenes/MainStreetRendererStaffPile';
import {
  HAND_SLOT_PITCH_PAD,
  STAFF_PILE_DEPTH,
  STAFF_PILE_STACK_SIZE,
} from '../../src/scenes/MainStreetConstants';

/** Minimal Phaser-shaped object: records the calls the pile module makes. */
interface StubObject {
  name?: string;
  active: boolean;
  depth?: number;
  x: number;
  y: number;
  text?: string;
  destroyed: boolean;
  children: StubObject[];
  handlers: Record<string, () => void>;
  fillStyle(): StubObject;
  fillRoundedRect(): StubObject;
  lineStyle(): StubObject;
  strokeRoundedRect(): StubObject;
  setDepth(depth: number): StubObject;
  setName(name: string): StubObject;
  setOrigin(): StubObject;
  setStrokeStyle(): StubObject;
  setInteractive(): StubObject;
  setData(key: string, value: unknown): StubObject;
  on(event: string, handler: () => void): StubObject;
  add(child: StubObject): StubObject;
  destroy(): void;
}

function stubObject(x = 0, y = 0, text?: string): StubObject {
  const object: StubObject = {
    active: true,
    destroyed: false,
    children: [],
    handlers: {},
    x,
    y,
    text,
    fillStyle() {
      return object;
    },
    fillRoundedRect() {
      return object;
    },
    lineStyle() {
      return object;
    },
    strokeRoundedRect() {
      return object;
    },
    setDepth(depth: number) {
      object.depth = depth;
      return object;
    },
    setName(name: string) {
      object.name = name;
      return object;
    },
    setOrigin() {
      return object;
    },
    setStrokeStyle() {
      return object;
    },
    setInteractive() {
      return object;
    },
    setData() {
      return object;
    },
    on(event: string, handler: () => void) {
      object.handlers[event] = handler;
      return object;
    },
    add(child: StubObject) {
      object.children.push(child);
      return object;
    },
    destroy() {
      object.destroyed = true;
      object.active = false;
    },
  };
  return object;
}

/** A staff fixture: name, salary and an optional employer slot. */
function staff(
  name: string,
  ongoingCost: number,
  employedAtSlot?: number,
): StaffCard {
  const base = createStaffDeck(1)[0]!;
  return {
    ...base,
    id: `staff-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    ongoingCost,
    description: `${name} effect text.`,
    allowedBusinessTypes: undefined,
    ...(employedAtSlot === undefined
      ? { employedAtSlot: undefined }
      : { employedAtSlot }),
  };
}

/** Build a stub scene carrying layout, state and a tooltip-manager spy. */
function makeScene(options: {
  staffCards?: StaffCard[];
  maxHandSize?: number;
  replayMode?: boolean;
} = {}) {
  const created: StubObject[] = [];
  const record = (object: StubObject): StubObject => {
    created.push(object);
    return object;
  };
  const scene: any = {
    layout: {
      gameW: 1280,
      gameH: 720,
      staffPileX: 20,
      staffPileY: 565,
      staffPileW: 220,
      staffPileH: 102,
      handCenterX: 467,
      handCardW: 140,
    },
    state: {
      staffCards: options.staffCards ?? [],
      maxHandSize: options.maxHandSize ?? 3,
    },
    replayMode: options.replayMode ?? false,
    tooltipManager: { show: vi.fn(), hide: vi.fn() },
    add: {
      container: vi.fn((x: number, y: number) => record(stubObject(x, y))),
      graphics: vi.fn(() => record(stubObject())),
      rectangle: vi.fn((x: number, y: number) => record(stubObject(x, y))),
      text: vi.fn((x: number, y: number, text: string) => record(stubObject(x, y, text))),
    },
  };
  const renderer = { scene } as any;
  return { scene, renderer, created };
}

describe('drawStaffPile — empty state', () => {
  beforeEach(() => renderCardSvg.mockClear());

  it('draws nothing when the company employs no staff', () => {
    const { scene, renderer } = makeScene({ staffCards: [] });

    drawStaffPile(renderer);

    expect(scene.staffPileContainer).toBeUndefined();
    expect(scene.add.container).not.toHaveBeenCalled();
  });

  it('draws nothing when every hired member is business staff', () => {
    const { scene, renderer } = makeScene({
      staffCards: [staff('Chef', 90, 0), staff('Barista', 70, 1)],
    });

    drawStaffPile(renderer);

    expect(scene.staffPileContainer).toBeUndefined();
    expect(scene.add.container).not.toHaveBeenCalled();
  });

  it('draws nothing when the layout exposes no staffPile zone', () => {
    const { scene, renderer } = makeScene({ staffCards: [staff('Manager', 120)] });
    scene.layout.staffPileW = 0;

    drawStaffPile(renderer);

    expect(scene.staffPileContainer).toBeUndefined();
  });
});

describe('drawStaffPile — stack, badge and portrait row', () => {
  beforeEach(() => renderCardSvg.mockClear());

  it('stacks card faces with the newest hire on top and shows the full count', () => {
    const roster = [
      staff('Manager', 120),
      staff('Accountant', 60),
      staff('Socialite', 45),
      staff('Director', 100),
    ];
    const { scene, renderer } = makeScene({ staffCards: roster });

    drawStaffPile(renderer);

    const container = scene.staffPileContainer as StubObject;
    expect(container).toBeDefined();
    expect(container.depth).toBe(STAFF_PILE_DEPTH);
    expect(container.name).toBe(STAFF_PILE_NAME);

    // Card faces: capped at STAFF_PILE_STACK_SIZE, drawn oldest → newest.
    const stackedIds = renderCardSvg.mock.calls
      .filter(call => call[3] !== undefined && call[4] === 80)
      .map(call => call[2] as string);
    expect(stackedIds).toEqual([
      'staff-accountant',
      'staff-socialite',
      'staff-director',
    ]);
    expect(stackedIds.length).toBe(STAFF_PILE_STACK_SIZE);

    // Count badge reports the whole roster, not just the visible stack.
    const counts = container.children
      .filter(child => child.text !== undefined)
      .map(child => child.text);
    expect(counts).toContain('4');
  });

  it('renders a portrait row beneath the stack for every member that fits', () => {
    const { renderer } = makeScene({
      staffCards: [staff('Manager', 120), staff('Accountant', 60)],
    });

    drawStaffPile(renderer);

    const portraitIds = renderCardSvg.mock.calls
      .filter(call => call[4] === 56)
      .map(call => call[2] as string);
    expect(portraitIds).toEqual(['staff-manager', 'staff-accountant']);
  });

  it('keeps the pile behind the hand layer', () => {
    const { scene, renderer } = makeScene({ staffCards: [staff('Manager', 120)] });

    drawStaffPile(renderer);

    // HAND_PANEL_DEPTH is -100; the pile must sit below it so the hand panel
    // — and every hand card — stays in front and keeps its input.
    expect((scene.staffPileContainer as StubObject).depth).toBeLessThan(-100);
  });
});

describe('drawStaffPile — hover tooltip', () => {
  beforeEach(() => renderCardSvg.mockClear());

  it('shows the management-company summary on hover and hides it on leave', () => {
    const { scene, renderer } = makeScene({
      staffCards: [staff('Manager', 120), staff('Chef', 90, 2)],
    });

    drawStaffPile(renderer);

    const hit = scene.staffPileHitArea as StubObject;
    expect(hit).toBeDefined();
    expect(hit.name).toBe(STAFF_PILE_HIT_NAME);

    hit.handlers.pointerover();
    expect(scene.tooltipManager.show).toHaveBeenCalledTimes(1);
    const shown = scene.tooltipManager.show.mock.calls[0][0] as string;
    expect(shown).toContain('Management Company Staff');
    expect(shown).toContain('• Manager ');
    expect(shown).not.toContain('Chef');

    hit.handlers.pointerout();
    expect(scene.tooltipManager.hide).toHaveBeenCalledTimes(1);
  });

  it('adds no hover hit area in replay mode', () => {
    const { scene, renderer } = makeScene({
      staffCards: [staff('Manager', 120)],
      replayMode: true,
    });

    drawStaffPile(renderer);

    expect(scene.staffPileHitArea).toBeUndefined();
    expect(scene.staffPileContainer).toBeDefined();
  });

  it('does not intercept input: the hit area carries no pointerdown handler', () => {
    const { scene, renderer } = makeScene({ staffCards: [staff('Manager', 120)] });

    drawStaffPile(renderer);

    const hit = scene.staffPileHitArea as StubObject;
    expect(hit.handlers.pointerdown).toBeUndefined();
    expect(Object.keys(hit.handlers).sort()).toEqual(['pointerout', 'pointerover']);
  });
});

describe('staffPileHitBounds — clamped to the free band left of the hand', () => {
  it('spans the pile zone at the starting hand size', () => {
    const { renderer } = makeScene({ maxHandSize: 3 });

    const bounds = staffPileHitBounds(renderer)!;

    // capacity row left edge = 467 - 3 * (140 + 8) / 2 = 245 → the whole
    // 220 px pile zone is inside the free band.
    expect(bounds).toEqual({ x: 20, y: 565, w: 220, h: 102 });
  });

  it('shrinks the hit area as the capacity row grows', () => {
    const { renderer } = makeScene({ maxHandSize: 4 });

    const bounds = staffPileHitBounds(renderer)!;

    expect(bounds.x).toBe(20);
    expect(bounds.x + bounds.w).toBeCloseTo(171, 0);
    expect(bounds.w).toBeLessThan(220);
    // Never over the hand's slots: the capacity row starts at its own left edge.
    expect(bounds.x + bounds.w).toBeLessThanOrEqual(
      467 - (4 * (140 + HAND_SLOT_PITCH_PAD)) / 2,
    );
  });

  it('returns null once the capacity row has swept past the pile zone', () => {
    const { renderer } = makeScene({ maxHandSize: 8 });

    expect(staffPileHitBounds(renderer)).toBeNull();
  });
});

describe('drawStaffPile — refresh lifecycle', () => {
  beforeEach(() => renderCardSvg.mockClear());

  it('rebuilds the pile cleanly on every refresh (no accumulated objects)', () => {
    const { scene, renderer } = makeScene({ staffCards: [staff('Manager', 120)] });

    drawStaffPile(renderer);
    const first = scene.staffPileContainer as StubObject;
    drawStaffPile(renderer);
    const second = scene.staffPileContainer as StubObject;

    expect(first.destroyed).toBe(true);
    expect(second).not.toBe(first);
    expect(second.destroyed).toBe(false);
  });

  it('removes the pile when the last management-company member is laid off', () => {
    const scene: any = makeScene({ staffCards: [staff('Manager', 120)] });
    drawStaffPile(scene.renderer);
    const pile = scene.scene.staffPileContainer as StubObject;
    expect(pile).toBeDefined();

    scene.scene.state.staffCards = [staff('Chef', 90, 1)];
    drawStaffPile(scene.renderer);

    expect(pile.destroyed).toBe(true);
    expect(scene.scene.staffPileContainer).toBeUndefined();
  });

  it('destroyStaffPile is safe when no pile was drawn', () => {
    const { scene, renderer } = makeScene();

    expect(() => destroyStaffPile(renderer)).not.toThrow();
    expect(scene.staffPileContainer).toBeUndefined();
  });
});
