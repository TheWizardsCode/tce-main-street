/**
 * Main Street: Seat Colour Palette
 *
 * A Phaser-free, pure helper that provides a colour-blind-safe palette and
 * deterministic per-seat colour assignment for competitive games
 * (F1 of MS-0MUWNTN8W006C7EF — Identify different AI players).
 *
 * The helper is intentionally presentation-only: it has no knowledge of the
 * game state, the renderer or Phaser, so it can be unit-tested in plain Node
 * and reused by every seat-identity surface (activity-log prefixes, the
 * competitive scoreboard/HUD and placed-card borders).
 *
 * ## Design
 *
 * - {@link SEAT_COLOUR_PALETTE} is the fixed Okabe–Ito colour-vision-deficiency
 *   palette (8 colours). Colour is never the sole carrier of meaning in the
 *   UI: a seat's label text (`You`, `AI 1`, …) always accompanies its colour.
 * - {@link assignSeatColours} shuffles the palette with an injected, seeded
 *   {@link RandomSource} and hands one colour to each seat in seat order, so
 *   the assignment is deterministic for a given seed and can be persisted
 *   (rather than reshuffled) across save/load.
 * - A guard ({@link InsufficientSeatColoursError}) keeps the "distinct colour
 *   per seat" invariant honest when a game configures more seats than the
 *   palette has colours.
 *
 * @module
 */

/**
 * A deterministic pseudo-random number generator: called with no arguments it
 * returns a value in `[0, 1)` (the same contract as `Math.random`). Game
 * state exposes one as `state.rng`; tests use `createSeededRng`.
 */
export type RandomSource = () => number;

/** Who controls a seat: the human player or an AI opponent. */
export type SeatControllerKind = 'human' | 'ai';

/**
 * The minimal seat description the palette module needs.
 *
 * `playerId` is the stable seat identity used as the assignment map key and
 * for lookups; `controller` records whether the seat is the human or an AI
 * opponent (both receive a colour in competitive play).
 */
export interface SeatInfo {
  /** Stable seat identifier, used as the assignment map key and for lookups. */
  playerId: string;
  /** Whether the seat is controlled by the human or an AI. */
  controller: SeatControllerKind;
}

/**
 * The fixed colour-blind-safe seat palette.
 *
 * This is the Okabe–Ito colour-vision-deficiency-safe set (8 colours), large
 * enough for the maximum supported AI opponent count. The palette is never
 * mutated: {@link assignSeatColours} shuffles a copy.
 */
export const SEAT_COLOUR_PALETTE: readonly string[] = [
  '#E69F00', // orange
  '#56B4E9', // sky blue
  '#009E73', // bluish green
  '#F0E442', // yellow
  '#0072B2', // blue
  '#D55E00', // vermillion
  '#CC79A7', // reddish purple
  '#000000', // black
] as const;

/**
 * Raised when a seat list is larger than the palette, so a distinct colour per
 * seat cannot be honoured.
 *
 * Carries the offending counts so callers and tests can reason about the
 * failure without parsing the message.
 */
export class InsufficientSeatColoursError extends Error {
  /** Number of seats that needed a colour. */
  readonly seatCount: number;
  /** Number of colours available in {@link SEAT_COLOUR_PALETTE}. */
  readonly paletteSize: number;

  constructor(seatCount: number, paletteSize: number) {
    super(
      `Cannot assign a distinct colour to ${seatCount} seats: ` +
        `the seat palette only has ${paletteSize} colours.`,
    );
    this.name = 'InsufficientSeatColoursError';
    this.seatCount = seatCount;
    this.paletteSize = paletteSize;
  }
}

/**
 * Returns a Fisher–Yates-shuffled copy of the palette.
 *
 * Uses exactly `palette.length - 1` draws from `rng`, so a freshly seeded RNG
 * yields the same permutation every time.
 *
 * @param rng Injected deterministic random source.
 * @returns A new array containing every palette colour exactly once.
 */
function shufflePalette(rng: RandomSource): string[] {
  const palette = [...SEAT_COLOUR_PALETTE];
  for (let i = palette.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [palette[i], palette[j]] = [palette[j], palette[i]];
  }
  return palette;
}

/**
 * Assigns one distinct palette colour to each competitive seat.
 *
 * The palette is shuffled with the injected `rng` and the resulting colours
 * are handed out in seat order, so the same seed + seat list always produces
 * the same `playerId → colour` mapping. The returned {@link Map} preserves
 * seat order in its iteration order.
 *
 * Single-player (a list of at most one human seat) needs no colour
 * assignment and yields an empty map, leaving the single-player visuals
 * unchanged. A list larger than {@link SEAT_COLOUR_PALETTE} throws
 * {@link InsufficientSeatColoursError} rather than silently reusing a colour.
 *
 * @param seats Seat list in seat order (human first, then AI opponents).
 * @param rng   Injected deterministic random source (e.g. `state.rng`).
 * @returns A map from `playerId` to hex colour; empty for single-player.
 * @throws {InsufficientSeatColoursError} When there are more seats than colours.
 */
export function assignSeatColours(
  seats: readonly SeatInfo[],
  rng: RandomSource,
): Map<string, string> {
  const assignment = new Map<string, string>();

  // Single-player (one seat, human only) requires no colour assignment.
  if (seats.length <= 1) return assignment;

  if (seats.length > SEAT_COLOUR_PALETTE.length) {
    throw new InsufficientSeatColoursError(seats.length, SEAT_COLOUR_PALETTE.length);
  }

  const shuffled = shufflePalette(rng);
  seats.forEach((seat, index) => {
    assignment.set(seat.playerId, shuffled[index]);
  });
  return assignment;
}

/**
 * Looks up a single seat's colour by recomputing the deterministic assignment.
 *
 * Convenience wrapper around {@link assignSeatColours}. Because `rng` is
 * stateful, callers that need several colours must supply a freshly seeded RNG
 * per call — or better, call {@link assignSeatColours} once and reuse the map.
 * Returns `undefined` for an unknown seat or in single-player mode.
 *
 * @param seats    Seat list in seat order.
 * @param playerId The seat whose colour is requested.
 * @param rng      Injected deterministic random source (freshly seeded).
 * @returns The seat's hex colour, or `undefined` when it has none.
 * @throws {InsufficientSeatColoursError} When there are more seats than colours.
 */
export function getSeatColour(
  seats: readonly SeatInfo[],
  playerId: string,
  rng: RandomSource,
): string | undefined {
  return assignSeatColours(seats, rng).get(playerId);
}

/**
 * Converts a seat hex colour (`#RRGGBB`) to the 24-bit integer Phaser's
 * `setStrokeStyle` / `fillStyle` style APIs expect (e.g. `#E69F00` →
 * `0xE69F00`).
 *
 * Phaser-free and total: malformed input falls back to black (`0x000000`)
 * rather than throwing, so a bad persisted colour can never crash the render
 * loop. This is the one place seat colours cross from the pure presentation
 * contract (hex strings) into Phaser's numeric colour space, keeping the
 * placed-card border (F4 of MS-0MUWNTN8W006C7EF) consistent with the rest of
 * the seat-identity UI.
 *
 * @param hex A `#RRGGBB` colour string (the `#` is optional).
 * @returns The equivalent 24-bit integer, or `0x000000` for malformed input.
 */
export function seatColourToNumber(hex: string): number {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  return match ? Number.parseInt(match[1], 16) : 0x000000;
}

// ── Text legibility on dark surfaces ─────────────────────────

/**
 * Background the Turn Summary tab strip draws on: the overlay's solid black
 * panel (`createOverlayBackground` fill `0x000000`).
 */
export const DIALOG_PANEL_BACKGROUND = '#000000';

/** WCAG AA contrast ratio for normal-size text (`MIN_SEAT_PREFIX_CONTRAST`). */
export const MIN_SEAT_TEXT_CONTRAST = 4.5;

/** Mixing steps used when lightening a seat colour toward white. */
const SEAT_TEXT_LIGHTEN_STEPS = 20;

/** A parsed RGB colour with channels in `[0, 255]`. */
export type Rgb = [number, number, number];

/** Parses a `#rrggbb` (or `#rgb`) hex colour, or `null` when malformed. */
export function parseHexColour(hex: string): Rgb | null {
  const value = hex.trim().replace(/^#/, '');
  if (value.length === 3) {
    return [
      parseInt(value[0] + value[0], 16),
      parseInt(value[1] + value[1], 16),
      parseInt(value[2] + value[2], 16),
    ];
  }
  if (value.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(value)) return null;
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

/** Formats an RGB colour as a lowercase `#rrggbb` string. */
export function toHexColour([r, g, b]: Rgb): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** WCAG relative luminance of an RGB colour (0 = black, 1 = white). */
export function relativeLuminance([r, g, b]: Rgb): number {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two RGB colours (1 = identical, 21 = max). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Euclidean distance between two RGB colours in the 0–441 range. */
export function rgbDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** Mixes an RGB colour `t` (0–1) of the way toward white. */
export function mixTowardWhite(rgb: Rgb, t: number): Rgb {
  return [
    rgb[0] + (255 - rgb[0]) * t,
    rgb[1] + (255 - rgb[1]) * t,
    rgb[2] + (255 - rgb[2]) * t,
  ];
}

/**
 * Resolves a seat colour to a text colour that is legible on a dark surface.
 *
 * The palette is colour-blind-safe, not background-aware: it includes the
 * Okabe–Ito **black** (`#000000`), which vanishes on a black panel. A seat
 * assigned that hue would lose its label — the Turn Summary tab strip drew
 * exactly that, so a `[ You ]` (or `[ AI n ]`) tab could silently disappear
 * (MS-0MWBWRITL0089GGJ). This helper lightens a too-dark seat colour toward
 * white until it clears the WCAG AA contrast ratio, so the label stays
 * readable while keeping as much of the seat's identity as the palette allows.
 *
 * A colour that already clears the ratio is returned **unchanged** (the exact
 * caller string), so a seat keeps its own hue wherever it is legible. Total
 * and Phaser-free: malformed input is returned unchanged rather than throwing,
 * and an unfixable colour falls back to white.
 *
 * @param seatColour    The seat's persisted hex colour (`PlayerRecord.colour`).
 * @param backgroundHex Background the text sits on (default: the dialog panel).
 * @param minContrast   Minimum WCAG contrast ratio (default: AA, 4.5:1).
 * @returns A hex colour legible on the background.
 */
export function ensureReadableSeatColour(
  seatColour: string,
  backgroundHex: string = DIALOG_PANEL_BACKGROUND,
  minContrast: number = MIN_SEAT_TEXT_CONTRAST,
): string {
  const seat = parseHexColour(seatColour);
  const background = parseHexColour(backgroundHex);
  if (!seat || !background) return seatColour;
  if (contrastRatio(seat, background) >= minContrast) return seatColour;

  for (let step = 1; step <= SEAT_TEXT_LIGHTEN_STEPS; step++) {
    const candidate = mixTowardWhite(seat, step / SEAT_TEXT_LIGHTEN_STEPS);
    if (contrastRatio(candidate, background) >= minContrast) return toHexColour(candidate);
  }
  return '#ffffff';
}
