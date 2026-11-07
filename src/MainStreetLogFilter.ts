/**
 * Main Street: Activity Log filter predicate
 *
 * Pure, Phaser-free decision functions behind the Activity Log filter controls
 * (epic MS-0MW1ZGM1F0010DQW): which entries match the All / You / AI filter.
 *
 * The module is deliberately side-effect free:
 *
 *  - it imports **types only** (`LogEntry`, `LogFilter`, `MainStreetState`),
 *    so it runs under plain `vitest` in node with no Phaser mocking;
 *  - `entryMatchesLogFilter` / `filterLogEntries` take the already-resolved
 *    `humanSeatId` (from `findHumanSeatId` in `MainStreetEngineTurnClosing`)
 *    as data instead of a state, keeping the per-entry decision pure;
 *  - `filterLogEntries` never mutates its input — it returns a new array and
 *    preserves the original entry order (identity of retained entries).
 *
 * Consistency with the state-log writers (`MainStreetStateLog`): an entry
 * carries a `seatId` only when it is attributable to a competitive seat
 * (`addLog`), while shared / turn-level entries (turn header, per-turn net
 * summary, incident, market refresh, week start, game-over) never carry one
 * (`addLogShared`).
 *
 * The projection is **presentation-only** (MS-0MW3PFRV6003LJLD): the caller
 * renders the derived subset and never writes it back into
 * `state.activityLog`. The unfiltered log stays the source of truth for the
 * preserved contracts — the deferred-render gate (MS-0MURBOD2E009SOM2), the
 * scene-restart reset (MS-0MV14JDUG000E1V6) and the re-render trigger
 * (MS-0MV1BMMO900824N9) — all of which operate on the full log.
 *
 * @module
 */

import type { LogEntry, LogFilter, MainStreetState } from './MainStreetStateTypes';

export type { LogFilter } from './MainStreetStateTypes';

/**
 * Whether a single log entry is visible under the given filter.
 *
 * - `'all'` matches every entry.
 * - Shared / turn-level entries (no `seatId`) match **every** filter, so turn
 *   structure and shared world events are never lost (producer decision Q2 = A).
 * - Seat-attributed entries match by seat: `'human'` = the human seat,
 *   `'ai'` = every seat other than the human seat (all AI seats are grouped
 *   into one bucket).
 * - A `humanSeatId` below 0 (roster without a human-controller seat) makes the
 *   You/AI seat buckets empty: no seat-attributed entry matches `'human'` or
 *   `'ai'` (there is no human seat to be "other than"), and the call never
 *   throws.
 *
 * @param entry The log entry to test.
 * @param filter The active filter (`'all' | 'human' | 'ai'`).
 * @param humanSeatId The human seat's `playerId`, or `-1` when the roster has
 *   no human-controller seat (as returned by `findHumanSeatId`).
 */
export function entryMatchesLogFilter(
  entry: LogEntry,
  filter: LogFilter,
  humanSeatId: number,
): boolean {
  if (filter === 'all') return true;
  // Shared / turn-level entries stay visible under every filter (Q2 = A).
  if (entry.seatId == null) return true;
  // Degenerate roster: the You/AI-by-seat buckets are empty (AC5).
  if (humanSeatId < 0) return false;
  return filter === 'human' ? entry.seatId === humanSeatId : entry.seatId !== humanSeatId;
}

/**
 * Returns the entries visible under the filter as a **new** array.
 *
 * The input is never mutated and the retained entries keep their original
 * order and identity. Presentation-only: the caller must not write the result
 * back into `state.activityLog` — the full log stays the source of truth for
 * the deferred-render gate (MS-0MURBOD2E009SOM2), the scene-restart reset
 * (MS-0MV14JDUG000E1V6) and the re-render trigger (MS-0MV1BMMO900824N9).
 *
 * @param entries The activity log entries (read-only).
 * @param filter The active filter.
 * @param humanSeatId The human seat's `playerId`, or `-1` when absent.
 * @returns A new array of the matching entries, in original order.
 */
export function filterLogEntries(
  entries: readonly LogEntry[],
  filter: LogFilter,
  humanSeatId: number,
): LogEntry[] {
  return entries.filter((entry) => entryMatchesLogFilter(entry, filter, humanSeatId));
}

/**
 * Whether the filter controls should be shown for the given state.
 *
 * True only when the roster has 2+ seats — i.e. competitive play where a
 * You/AI distinction exists. False for single-player (no roster), a single
 * seat (competitive N=1) and the tutorial (a single-player run), so those
 * modes see the log exactly as they always have (producer decision Q3 = A).
 *
 * @param state The game state; only `players` is read.
 */
export function shouldShowLogFilterControls(state: MainStreetState): boolean {
  return (state.players?.length ?? 0) >= 2;
}
