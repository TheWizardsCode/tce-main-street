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

import type { MainStreetState, LogEntry, LogEntryType, LogEntryActionType } from './MainStreetStateTypes';
import { getSeatDisplayLabel } from './MainStreetAdjacencyOwner';
import {
  contrastRatio,
  mixTowardWhite,
  parseHexColour,
  rgbDistance,
  toHexColour,
} from './MainStreetSeatColours';
import { getActivityLogEmitter } from './MainStreetGameEvents';
import type { GameEventEmitter } from '@core-engine/GameEventEmitter';

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
    const candidate = mixTowardWhite(seat, step / SEAT_PREFIX_LIGHTEN_STEPS);
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
 *
 * Optional `actionType` — set on every player- or AI-initiated action
 * so the Summary tab can filter by category (MS-0MWBWRITL0089GGJ).
 */
export function addLog(
  state: MainStreetState,
  text: string,
  type: LogEntryType,
  actionType?: LogEntryActionType,
): void;
export function addLog(
  state: MainStreetState,
  seatId: number,
  text: string,
  type: LogEntryType,
  actionType?: LogEntryActionType,
): void;
export function addLog(
  state: MainStreetState,
  seatIdOrText: number | string,
  textOrType: string | LogEntryType,
  maybeType?: LogEntryType | LogEntryActionType,
  maybeActionType?: LogEntryActionType,
): void {
  // Explicit-seat overload: `addLog(state, seatId, text, type, actionType?)`.
  if (typeof seatIdOrText === 'number') {
    const seatId = seatIdOrText;
    const entry: LogEntry = {
      turn: state.turn,
      text: textOrType as string,
      type: maybeType as LogEntryType,
    };
    if (maybeActionType) entry.actionType = maybeActionType;
    const seat = state.players?.find((player) => player.playerId === seatId);
    // Only competitive multi-seat games get a prefix: single-player (no roster
    // or one seat) and legacy seats without a persisted colour stay unchanged.
    if ((state.players?.length ?? 0) > 1 && seat?.colour) {
      entry.seatId = seatId;
      entry.seatLabel = getSeatDisplayLabel(seatId);
      entry.seatColour = seat.colour;
    }
    publishActivityLogEntry(state, entry);
    return;
  }

  // Default overload `addLog(state, text, type, actionType?)`: attribute to
  // the acting seat derived from the engine source, opt out via `addLogShared`.
  const entry: LogEntry = {
    turn: state.turn,
    text: seatIdOrText,
    type: textOrType as LogEntryType,
  };
  // In this overload the 4th positional argument (`maybeType`) is the action
  // marker; the 5th is unused.
  if (maybeType) entry.actionType = maybeType as LogEntryActionType;
  const actingSeatId = resolveActingSeatId(state);
  if (actingSeatId != null) {
    entry.seatId = actingSeatId;
    entry.seatLabel = getSeatDisplayLabel(actingSeatId);
    entry.seatColour = state.players!.find((player) => player.playerId === actingSeatId)!.colour;
  }
  publishActivityLogEntry(state, entry);
}

/**
 * Appends a genuinely shared / turn-level log entry with no seat fields.
 *
 * The explicit opt-out from the default acting-seat attribution
 * (MS-0MW3PFQ4L0046Q3K AC4): turn header, per-turn net summary, incident draw,
 * market refresh/deal-in, week start, game over and tutorial/help lines use
 * this form so a You/AI filter never mislabels them as a seat's action.
 */
export function addLogShared(
  state: MainStreetState,
  text: string,
  type: LogEntryType,
  actionType?: LogEntryActionType,
): void {
  const entry: LogEntry = { turn: state.turn, text, type };
  if (actionType) entry.actionType = actionType;
  publishActivityLogEntry(state, entry);
}

// ── Single write path / Game Events feed ────────────────────

/**
 * The SINGLE writer of `state.activityLog` (MS-0MW1ZHBPK006M8YS).
 *
 * Every Activity Log row — whether produced by the Game Events feed
 * subscriber ({@link bindActivityLogFeed}) or by the headless no-emitter
 * fallback ({@link publishActivityLogEntry}) — passes through this function;
 * a guard test pins that no `.push` on `state.activityLog` exists anywhere
 * else in the production source. Undo/save restore re-assigns the whole log
 * from a snapshot (a restore, not a row write) and is intentionally not
 * routed here (see `MainStreetCommands.restoreSnapshot`).
 */
export function appendActivityLogEntry(state: MainStreetState, entry: LogEntry): void {
  state.activityLog.push(entry);
}

/**
 * Routes a log entry to the Game Events feed when the scene channel is live,
 * otherwise appends directly (headless fallback).
 *
 * Channel path: emits the typed `activity-log` event on the scene emitter
 * (`window.__GAME_EVENTS__`); the subscriber registered by
 * {@link bindActivityLogFeed} appends the row. The guard requires a live
 * `activity-log` listener so a wrong/stale emitter (another game's scene on
 * the same page) degrades to the direct append instead of silently dropping
 * rows — the row can never be lost and can never be written twice.
 *
 * Headless path (no `window`, no emitter, or no subscriber): appends directly
 * through the single writer, keeping Monte Carlo, unit tests and the tutorial
 * scenario byte-identical with the pre-feed behaviour.
 */
function publishActivityLogEntry(state: MainStreetState, entry: LogEntry): void {
  const emitter = getActivityLogEmitter();
  if (emitter && emitter.listenerCount('activity-log') > 0) {
    emitter.emit('activity-log', entry);
    return;
  }
  appendActivityLogEntry(state, entry);
}

/**
 * Binds the Game Events channel's `activity-log` event to the single writer.
 *
 * Called by the Main Street scene once per emitter creation (`initEventSystem`
 * runs on every scene start/restart and creates a fresh emitter, so this fires
 * exactly once per live channel). `getState` is evaluated at **emit** time —
 * not at bind time — so in-place `state` replacement (competitive new game,
 * save load, tutorial start, difficulty change) still appends to the current
 * state; the scene instance is stable across those replacements.
 *
 * @param emitter  The scene's live {@link GameEventEmitter}.
 * @param getState Resolves the `MainStreetState` to append to when a row fires
 *                 (typically `() => scene.state`).
 * @returns An unsubscribe function (the emitter is discarded on scene
 *          shutdown via `removeAllListeners`, so callers may drop it).
 */
export function bindActivityLogFeed(
  emitter: GameEventEmitter,
  getState: () => MainStreetState | null | undefined,
): () => void {
  return emitter.on('activity-log', (entry: LogEntry) => {
    const state = getState();
    // Guard the brief boot window before the first state is assigned: no
    // logging happens until the first `startTurnPhase`, so no rows are
    // affected in practice, and a missing state must never throw out of the
    // emit (an engine action would fail).
    if (state) appendActivityLogEntry(state, entry);
  });
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

