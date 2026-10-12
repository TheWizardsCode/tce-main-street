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
