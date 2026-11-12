/**
 * Main Street: Seat Colour Palette Tests
 *
 * Verifies the Phaser-free seat-colour helper (F1 of MS-0MUWNTN8W006C7EF):
 * palette membership/size, distinct per-seat assignment in seat order,
 * the insufficient-palette guard, seeded determinism, and the single-player
 * no-assignment rule.
 */
import { describe, it, expect } from 'vitest';

import {
  DIALOG_PANEL_BACKGROUND,
  MIN_SEAT_TEXT_CONTRAST,
  SEAT_COLOUR_PALETTE,
  InsufficientSeatColoursError,
  assignSeatColours,
  contrastRatio,
  ensureReadableSeatColour,
  getSeatColour,
  parseHexColour,
  seatColourToNumber,
  type SeatInfo,
} from '../../src/MainStreetSeatColours';
import { createSeededRng } from '@core-engine/SeededRng';

// ── Helpers ─────────────────────────────────────────────────

/** Build a human + AI seat list of the requested size. */
function makeSeats(count: number): SeatInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `seat-${index}`,
    controller: index === 0 ? 'human' : 'ai',
  }));
}

/** Fresh deterministic RNG for a numeric seed. */
function makeRng(seed: number): () => number {
  return createSeededRng(seed);
}

/** Convert an assignment map to a stable, comparable array. */
function toEntries(map: Map<string, string>): [string, string][] {
  return [...map.entries()];
}

// ── Palette ─────────────────────────────────────────────────

describe('SEAT_COLOUR_PALETTE', () => {
  it('exports at least 8 distinct colours', () => {
    expect(SEAT_COLOUR_PALETTE.length).toBeGreaterThanOrEqual(8);
    expect(new Set(SEAT_COLOUR_PALETTE).size).toBe(SEAT_COLOUR_PALETTE.length);
  });

  it('contains only 6-digit hex colour strings', () => {
    for (const colour of SEAT_COLOUR_PALETTE) {
      expect(colour).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('includes the colour-blind-safe Okabe–Ito hues', () => {
    const upper = SEAT_COLOUR_PALETTE.map((colour) => colour.toUpperCase());
    for (const hue of [
      '#E69F00', // orange
      '#56B4E9', // sky blue
      '#009E73', // bluish green
      '#F0E442', // yellow
      '#0072B2', // blue
      '#D55E00', // vermillion
      '#CC79A7', // reddish purple
      '#000000', // black
    ]) {
      expect(upper).toContain(hue);
    }
  });
});

// ── Assignment ──────────────────────────────────────────────

describe('assignSeatColours', () => {
  it('assigns exactly one distinct palette colour per seat', () => {
    const seats = makeSeats(4);
    const assignment = assignSeatColours(seats, makeRng(1));

    expect(assignment.size).toBe(seats.length);
    const colours = [...assignment.values()];
    expect(new Set(colours).size).toBe(colours.length);
    for (const colour of colours) {
      expect(SEAT_COLOUR_PALETTE).toContain(colour);
    }
  });

  it('keys the assignment by playerId in seat order', () => {
    const seats = makeSeats(3);
    const assignment = assignSeatColours(seats, makeRng(7));

    expect([...assignment.keys()]).toEqual(seats.map((seat) => seat.playerId));
  });

  it('gives the human and every AI seat a distinct colour', () => {
    const seats = makeSeats(5);
    const assignment = assignSeatColours(seats, makeRng(3));

    const humanColour = assignment.get('seat-0');
    expect(humanColour).toBeDefined();
    for (const seat of seats.slice(1)) {
      expect(assignment.get(seat.playerId)).toBeDefined();
      expect(assignment.get(seat.playerId)).not.toBe(humanColour);
    }
  });

  it('throws InsufficientSeatColoursError when seats exceed the palette', () => {
    const tooMany = makeSeats(SEAT_COLOUR_PALETTE.length + 1);

    expect(() => assignSeatColours(tooMany, makeRng(1))).toThrow(
      InsufficientSeatColoursError,
    );
  });

  it('reports the seat and palette counts on the guard error', () => {
    const tooMany = makeSeats(SEAT_COLOUR_PALETTE.length + 2);

    try {
      assignSeatColours(tooMany, makeRng(1));
      expect.unreachable('expected assignSeatColours to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientSeatColoursError);
      const guard = error as InsufficientSeatColoursError;
      expect(guard.seatCount).toBe(SEAT_COLOUR_PALETTE.length + 2);
      expect(guard.paletteSize).toBe(SEAT_COLOUR_PALETTE.length);
    }
  });

  it('assigns colours for a full palette-sized seat list', () => {
    const seats = makeSeats(SEAT_COLOUR_PALETTE.length);
    const assignment = assignSeatColours(seats, makeRng(1));

    expect(assignment.size).toBe(SEAT_COLOUR_PALETTE.length);
    expect(new Set(assignment.values()).size).toBe(SEAT_COLOUR_PALETTE.length);
  });

  it('does not assign colours in single-player (one human seat)', () => {
    const assignment = assignSeatColours(makeSeats(1), makeRng(1));

    expect(assignment.size).toBe(0);
  });

  it('does not assign colours for an empty seat list', () => {
    expect(assignSeatColours([], makeRng(1)).size).toBe(0);
  });
});

// ── Determinism ─────────────────────────────────────────────

describe('assignSeatColours determinism', () => {
  it('returns the same assignment for the same seed and seat list', () => {
    const seats = makeSeats(6);

    const first = assignSeatColours(seats, makeRng(2024));
    const second = assignSeatColours(seats, makeRng(2024));

    expect(toEntries(second)).toEqual(toEntries(first));
  });

  it('changes the mapping when the seed changes', () => {
    const seats = makeSeats(6);

    const first = assignSeatColours(seats, makeRng(1));
    const other = assignSeatColours(seats, makeRng(2));

    expect(toEntries(other)).not.toEqual(toEntries(first));
  });

  it('does not mutate the shared palette between calls', () => {
    const snapshot = [...SEAT_COLOUR_PALETTE];

    assignSeatColours(makeSeats(6), makeRng(99));

    expect([...SEAT_COLOUR_PALETTE]).toEqual(snapshot);
  });
});

// ── Lookup helper ───────────────────────────────────────────

describe('getSeatColour', () => {
  it('returns the same colour as assignSeatColours for that seat', () => {
    const seats = makeSeats(4);
    const assignment = assignSeatColours(seats, makeRng(42));

    const lookedUp = getSeatColour(seats, 'seat-2', makeRng(42));

    expect(lookedUp).toBe(assignment.get('seat-2'));
  });

  it('returns undefined for an unknown player id', () => {
    expect(getSeatColour(makeSeats(3), 'nobody', makeRng(1))).toBeUndefined();
  });

  it('returns undefined in single-player mode', () => {
    expect(getSeatColour(makeSeats(1), 'seat-0', makeRng(1))).toBeUndefined();
  });
});

// ── Phaser colour conversion ─────────────────────────────────

describe('seatColourToNumber', () => {
  it('converts every palette colour to its 24-bit integer value', () => {
    for (const colour of SEAT_COLOUR_PALETTE) {
      expect(seatColourToNumber(colour)).toBe(Number.parseInt(colour.slice(1), 16));
    }
  });

  it('converts a known colour precisely', () => {
    expect(seatColourToNumber('#E69F00')).toBe(0xe69f00);
    expect(seatColourToNumber('#000000')).toBe(0x000000);
    expect(seatColourToNumber('#FFFFFF')).toBe(0xffffff);
  });

  it('accepts a colour without the leading hash', () => {
    expect(seatColourToNumber('56B4E9')).toBe(0x56b4e9);
  });

  it('falls back to black for malformed input rather than throwing', () => {
    for (const bad of ['', '#12', 'nonsense', '#GGGGGG', 'rgb(1,2,3)']) {
      expect(seatColourToNumber(bad)).toBe(0x000000);
    }
  });
});

// ── Legibility on a dark surface ─────────────────────────────

describe('ensureReadableSeatColour', () => {
  it('returns a legible seat colour unchanged (exactly, including casing)', () => {
    for (const colour of ['#F0E442', '#56B4E9', '#E69F00', '#CC79A7', '#FFFFFF']) {
      expect(ensureReadableSeatColour(colour)).toBe(colour);
    }
  });

  it('lightens the palette black so it clears WCAG AA on the black panel', () => {
    const resolved = ensureReadableSeatColour('#000000');
    const resolvedRgb = parseHexColour(resolved)!;
    const panelRgb = parseHexColour(DIALOG_PANEL_BACKGROUND)!;

    expect(resolved).not.toBe('#000000');
    expect(contrastRatio(resolvedRgb, panelRgb)).toBeGreaterThanOrEqual(MIN_SEAT_TEXT_CONTRAST);
  });

  it('honours an explicit background and a stricter minimum ratio', () => {
    // The activity-log panel background (dark brown) is used elsewhere.
    const onLogPanel = ensureReadableSeatColour('#000000', '#1a1408');
    expect(contrastRatio(parseHexColour(onLogPanel)!, parseHexColour('#1a1408')!))
      .toBeGreaterThanOrEqual(MIN_SEAT_TEXT_CONTRAST);
    // Every palette colour must clear a 7:1 (AAA) request on black.
    for (const colour of SEAT_COLOUR_PALETTE) {
      const resolved = ensureReadableSeatColour(colour, DIALOG_PANEL_BACKGROUND, 7);
      expect(contrastRatio(parseHexColour(resolved)!, parseHexColour(DIALOG_PANEL_BACKGROUND)!))
        .toBeGreaterThanOrEqual(7);
    }
  });

  it('keeps the seat hue family: a lightened colour stays brighter than the input', () => {
    const resolved = parseHexColour(ensureReadableSeatColour('#000000'))!;
    // Black has no hue to keep; the resolved grey carries equal channels.
    expect(resolved[0]).toBe(resolved[1]);
    expect(resolved[1]).toBe(resolved[2]);
    expect(resolved[0]).toBeGreaterThan(0);
  });

  it('is total: malformed colours and backgrounds are returned unchanged', () => {
    expect(ensureReadableSeatColour('nonsense')).toBe('nonsense');
    expect(ensureReadableSeatColour('')).toBe('');
    expect(ensureReadableSeatColour('#F0E442', 'rgb(0,0,0)')).toBe('#F0E442');
  });

  it('falls back to white when no lightening step can satisfy the ratio', () => {
    // 21:1 is the maximum possible ratio, so a 30:1 request is unsatisfiable.
    expect(ensureReadableSeatColour('#000000', DIALOG_PANEL_BACKGROUND, 30)).toBe('#ffffff');
  });
});
