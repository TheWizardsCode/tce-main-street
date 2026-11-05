/**
 * Main Street: Activity Log Helpers
 *
 * Appends and classifies activity-log entries, describes effective effect
 * deltas, and keeps the shared EconomyLedger consistent with resourceBank.
 *
 * Seat-attributable entries (competitive mode) carry the acting seat's
 * canonical label (`You`, `AI 1`, ...) and persisted colour; the renderer
 * draws that label as a coloured prefix (F3 of MS-0MUWNTN8W006C7EF). Three
 * call forms decide attribution explicitly at the call site
 * (MS-0MW3PFQ4L0046Q3K):
 *
 *  - `addLog(state, text, type)` — defaults to the acting seat, derived from
 *    the engine's acting-seat source (`state.activePlayerId`), with no
 *    attribution when the roster has fewer than two seats or the acting seat
 *    is absent (single-player / tutorial unchanged);
 *  - `addLog(state, seatId, text, type)` — attributes to an explicit seat
 *    (per-owner phase paths where the ambient acting seat differs, e.g.
 *    per-owner income, event effects, loan rows);
 *  - `addLogShared(state, text, type)` — the explicit opt-out for genuinely
 *    shared / turn-level entries (turn header, net summary, incident draw,
 *    market refresh, week start, game over, tutorial/help lines).
 *
 * Import graph: depends on `MainStreetStateTypes` (state shape) and
 * `MainStreetAdjacencyOwner` (shared seat-label source).
 *
 * Seat fields are **presentation-only** (epic MS-0MW1ZGM1F0010DQW): the
 * renderer draws them as the coloured seat prefix and the presentational
 * filter predicate (`MainStreetLogFilter`) groups entries into You / AI
 * buckets from them — they are never read back into engine logic. The
 * unfiltered `state.activityLog` always remains the source of truth for the
 * preserved contracts: the deferred-render gate (MS-0MURBOD2E009SOM2), the
 * scene-restart reset (MS-0MV14JDUG000E1V6) and the re-render trigger
 * (MS-0MV1BMMO900824N9).
 *
 * @module
 */

import type { MainStreetState, LogEntry, LogEntryType } from './MainStreetStateTypes';
import { getSeatDisplayLabel } from './MainStreetAdjacencyOwner';

/**
 * Background colour of the activity-log panel (mirrors the renderer's
 * `0x1a1408` fill in `MainStreetRendererStreet`). Kept here so the pure
 * prefix-legibility helper can be unit-tested without Phaser.
 */
const LOG_PANEL_BG = '#1a1408';

/** Minimum WCAG contrast ratio for the seat prefix on the dark log panel. */
const MIN_SEAT_PREFIX_CONTRAST = 4.5;

/** Minimum RGB distance between the seat prefix and the line-type colour. */
const MIN_SEAT_PREFIX_LINE_DISTANCE = 60;

/** Mixing steps used when lightening a seat colour toward white. */
const SEAT_PREFIX_LIGHTEN_STEPS = 20;

/** A parsed RGB colour with channels in `[0, 255]`. */
type RGB = [number, number, number];

/** Parses a `#rrggbb` (or `#rgb`) hex colour, or `null` when malformed. */
function parseHexColour(hex: string): RGB | null {
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
function toHexColour(rgb: RGB): string {
  const channel = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

/** WCAG relative luminance of an RGB colour (0 = black, 1 = white). */
function relativeLuminance([r, g, b]: RGB): number {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two RGB colours (1 = identical, 21 = max). */
function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Euclidean distance between two RGB colours in the 0–441 range. */
function rgbDistance(a: RGB, b: RGB): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/**
 * Resolves the colour used to draw a seat's activity-log prefix.
 *
 * The prefix sits on the dark activity-log panel beside body text coloured by
 * the entry's line type. Two constraints keep it readable and distinct:
 *
 *  1. **Legibility** — the prefix must clear a minimum contrast ratio against
 *     the dark panel, so very dark palette hues (e.g. the Okabe–Ito black) are
 *     lightened toward white until they do.
 *  2. **Distinguishability** — the prefix must stay a minimum RGB distance from
 *     the line-type colour (gain/loss/neutral) so the two never visually
 *     merge. (Colour is never the sole carrier of meaning: the seat label text
 *     always accompanies it.)
 *
 * A colour that already satisfies both constraints is returned unchanged, so a
 * seat keeps its own colour wherever it is legible.
 *
 * @param seatColour The seat's persisted hex colour (`PlayerRecord.colour`).
 * @param lineColour The body text colour for the entry's `LogEntryType`.
 * @returns A hex colour legible on the panel and distinct from the line.
 */
export function resolveLogSeatColour(seatColour: string, lineColour: string): string {
  const seat = parseHexColour(seatColour);
  const line = parseHexColour(lineColour);
  const panel = parseHexColour(LOG_PANEL_BG);
  if (!seat || !line || !panel) return seatColour;

  for (let step = 0; step <= SEAT_PREFIX_LIGHTEN_STEPS; step++) {
    const t = step / SEAT_PREFIX_LIGHTEN_STEPS;
    const candidate: RGB = [
      seat[0] + (255 - seat[0]) * t,
      seat[1] + (255 - seat[1]) * t,
      seat[2] + (255 - seat[2]) * t,
    ];
    if (
      contrastRatio(candidate, panel) >= MIN_SEAT_PREFIX_CONTRAST &&
      rgbDistance(candidate, line) >= MIN_SEAT_PREFIX_LINE_DISTANCE
    ) {
      // Preserve the caller's exact string when no adjustment was needed.
      return step === 0 ? seatColour : toHexColour(candidate);
    }
  }
  return '#ffffff';
}

/**
 * Builds a compact, human-readable description of an effective (post-mitigation)
 * coin/reputation change pair for activity-log entries (CG-0MT5W7UJJ0065MEZ).
 *
 * Examples:
 *   - `+200 coins, +100 rep` for a gain of 200 coins and 100 reputation
 *   - `-100 coins` for a pure coin loss
 *   - `+100 rep` for a pure reputation gain
 *   - `no effect` when both deltas are zero
 *
 * @param coinChange Effective coins delta (integer).
 * @param repChange  Effective reputation delta.
 */
export function describeEventEffects(coinChange: number, repChange: number): string {
  const parts: string[] = [];
  if (coinChange !== 0) parts.push(`${coinChange > 0 ? '+' : ''}${Math.round(coinChange)} coins`);
  if (repChange !== 0) parts.push(`${repChange > 0 ? '+' : ''}${Math.round(repChange)} rep`);
  return parts.length > 0 ? parts.join(', ') : 'no effect';
}

/**
 * Classifies a coin/rep change pair as gain, loss, or neutral for log coloring.
 *
 * Uses the NET coin+rep heuristic (sum of both deltas); shared by every
 * enriched log site so a mixed exchange (e.g. -200 coins +100 rep) colours
 * consistently with its effective net effect.
 */
export function classifyEffect(
  coinChange: number,
  repChange: number,
): 'gain' | 'loss' | 'neutral' {
  const net = coinChange + repChange;
  if (net > 0) return 'gain';
  if (net < 0) return 'loss';
  return 'neutral';
}

/**
 * Resolves the seat id the default `addLog` overload should attribute to, or
 * `null` when the entry must carry no seat fields.
 *
 * The acting seat is the engine's own seat source (`state.activePlayerId`)
 * — never UI state (MS-0MW3PFQ4L0046Q3K AC4). No attribution when:
 *  - the roster has fewer than two seats (single-player / single-seat /
 *    tutorial games are byte-identical and unprefixed);
 *  - `state.activePlayerId` is absent (no acting seat yet);
 *  - the acting seat has no persisted colour (legacy seat).
 */
function resolveActingSeatId(state: MainStreetState): number | null {
  if ((state.players?.length ?? 0) < 2) return null;
  const seatId = state.activePlayerId;
  if (seatId == null) return null;
  const seat = state.players?.find((player) => player.playerId === seatId);
  if (!seat?.colour) return null;
  return seatId;
}

/**
 * Appends a log entry to the activity log.
 *
 * Convenience helper so engine/market functions don't need to
 * construct the object themselves.
 *
 * Three call forms:
 *
 *  - `addLog(state, text, type)` — defaults to the acting seat: in a
 *    competitive multi-seat game the entry is stamped with the acting seat's
 *    label (`state.activePlayerId`) and persisted colour so the renderer can
 *    draw a coloured prefix; single-player (no roster, or one seat) and
 *    seat-less contexts stay unprefixed.
 *  - `addLog(state, seatId, text, type)` — attributes to an explicit seat id;
 *    the explicit-seat overload is for per-owner phase paths where the
 *    ambient acting seat is not the entry's seat. Same single-player rules.
 *  - `addLogShared(state, text, type)` — the named opt-out for genuinely
 *    shared / turn-level entries; never stamps seat fields.
 */
export function addLog(state: MainStreetState, text: string, type: LogEntryType): void;
export function addLog(
  state: MainStreetState,
  seatId: number,
  text: string,
  type: LogEntryType,
): void;
export function addLog(
  state: MainStreetState,
  seatIdOrText: number | string,
  textOrType: string | LogEntryType,
  maybeType?: LogEntryType,
): void {
  // Explicit-seat overload: `addLog(state, seatId, text, type)`.
  if (typeof seatIdOrText === 'number') {
    const seatId = seatIdOrText;
    const entry: LogEntry = {
      turn: state.turn,
      text: textOrType as string,
      type: maybeType as LogEntryType,
    };
    const seat = state.players?.find((player) => player.playerId === seatId);
    // Only competitive multi-seat games get a prefix: single-player (no roster
    // or one seat) and legacy seats without a persisted colour stay unchanged.
    if ((state.players?.length ?? 0) > 1 && seat?.colour) {
      entry.seatId = seatId;
      entry.seatLabel = getSeatDisplayLabel(seatId);
      entry.seatColour = seat.colour;
    }
    state.activityLog.push(entry);
    return;
  }

  // Default overload `addLog(state, text, type)`: attribute to the acting
  // seat derived from the engine source, opt out via `addLogShared`.
  const entry: LogEntry = {
    turn: state.turn,
    text: seatIdOrText,
    type: textOrType as LogEntryType,
  };
  const actingSeatId = resolveActingSeatId(state);
  if (actingSeatId != null) {
    entry.seatId = actingSeatId;
    entry.seatLabel = getSeatDisplayLabel(actingSeatId);
    entry.seatColour = state.players!.find((player) => player.playerId === actingSeatId)!.colour;
  }
  state.activityLog.push(entry);
}

/**
 * Appends a genuinely shared / turn-level log entry with no seat fields.
 *
 * The explicit opt-out from the default acting-seat attribution
 * (MS-0MW3PFQ4L0046Q3K AC4): turn header, per-turn net summary, incident draw,
 * market refresh/deal-in, week start, game over and tutorial/help lines use
 * this form so a You/AI filter never mislabels them as a seat's action.
 */
export function addLogShared(state: MainStreetState, text: string, type: LogEntryType): void {
  state.activityLog.push({ turn: state.turn, text, type });
}

/**
 * Syncs the shared EconomyLedger from resourceBank values.
 * Called after direct resourceBank mutations to keep the ledger consistent.
 */
export function syncResourceBankToLedger(state: MainStreetState): void {
  const coins = state.resourceBank.coins;
  const rep = state.resourceBank.reputation;
  const coinDelta = coins - state.ledger.get('coins');
  const repDelta = rep - state.ledger.get('reputation');
  if (coinDelta !== 0 || repDelta !== 0) {
    state.ledger.apply({ coins: coinDelta, reputation: repDelta }, 'sync-from-resourceBank');
  }
}

