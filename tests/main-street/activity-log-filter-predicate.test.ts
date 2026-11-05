/**
 * Main Street: Activity Log filter predicate tests (MS-0MW3PFQZ200931Z5)
 *
 * Unit tests for the pure, Phaser-free predicate module
 * (`src/MainStreetLogFilter.ts`) — the decision rule behind the All / You / AI
 * Activity Log filter controls of epic MS-0MW1ZGM1F0010DQW.
 *
 * Contract under test:
 *
 *  - `entryMatchesLogFilter(entry, filter, humanSeatId)` — a pure boolean:
 *    `'all'` matches every entry; entries without a `seatId` (turn headers,
 *    per-turn net summary, incidents, market refresh, week start, game-over)
 *    match **every** filter (producer decision Q2 = A); seat-attributed
 *    entries match by seat (`'human'` = the human seat, `'ai'` = every seat
 *    other than the human seat).
 *  - `filterLogEntries(entries, filter, humanSeatId)` — a new array, never
 *    mutates its input, preserves the original entry order (identity of
 *    retained entries).
 *  - `shouldShowLogFilterControls(state)` — true only when the roster has
 *    2+ seats (false for single-player, single seat and tutorial), per
 *    producer decision Q3 = A.
 *  - A roster with no human-controller seat (`findHumanSeatId` → -1) degrades
 *    to "no entry matches You/AI-by-seat" without throwing.
 *
 * The module imports are type-only from `MainStreetStateTypes`, so importing
 * it under the node `vitest` environment (no Phaser mocking) proves it stays
 * Phaser-free.
 */
import { describe, expect, it } from 'vitest';

import {
  entryMatchesLogFilter,
  filterLogEntries,
  shouldShowLogFilterControls,
} from '../../src/MainStreetLogFilter';
import type { LogFilter, LogEntry, MainStreetState } from '../../src/MainStreetState';
import {
  createCompetitiveState,
  setupMainStreetGame,
  type CompetitiveOpponentConfig,
} from '../../src/MainStreetState';
import { findHumanSeatId } from '../../src/MainStreetEngine';

// ── Fixtures (fabricated, like the rest of the unit suite) ──

/** A fabricated log entry; `seatId` present only when attributed to a seat. */
function makeEntry(seatId: number, text = `seat ${seatId}`): LogEntry {
  return { turn: 1, text, type: 'neutral', seatId };
}

/** A shared / turn-level entry — never carries a `seatId`. */
function makeSharedEntry(text = 'shared'): LogEntry {
  return { turn: 1, text, type: 'neutral' };
}

/** A minimal competitive seat; only the roster length matters to the predicate. */
function seat(controller: 'human' | 'ai' = 'human') {
  return { playerId: 0, score: 0, controller } as unknown as NonNullable<
    MainStreetState['players']
  >[number];
}
function rosterState(players: NonNullable<MainStreetState['players']>): MainStreetState {
  return { players } as unknown as MainStreetState;
}

const OPPONENTS: CompetitiveOpponentConfig[] = [
  { strategy: 'Random', difficulty: 'Easy' },
  { strategy: 'Greedy', difficulty: 'Medium' },
];

// ── entryMatchesLogFilter: filter × entry-kind table ────────

describe('entryMatchesLogFilter', () => {
  // Three-seat competitive roster: seat 0 = human, seats 1 and 2 = AI.
  const human = makeEntry(0);
  const ai1 = makeEntry(1);
  const ai2 = makeEntry(2);
  const shared = makeSharedEntry();
  const turnHeader = makeSharedEntry('Turn 3');

  it.each<[LogFilter, LogEntry, number, boolean]>([
    ['all', human, 0, true],
    ['all', ai1, 0, true],
    ['all', shared, 0, true],
    ['human', human, 0, true],
    ['human', ai1, 0, false],
    ['human', shared, 0, true],
    ['ai', human, 0, false],
    ['ai', ai1, 0, true],
    ['ai', shared, 0, true],
    // Multi-AI: every AI seat is one bucket.
    ['ai', ai2, 0, true],
    ['human', ai2, 0, false],
  ])(
    'filter=%s entry(seatId=%s) humanSeatId=%s -> %s',
    (filter, entry, humanSeatId, expected) => {
      expect(entryMatchesLogFilter(entry, filter, humanSeatId)).toBe(expected);
    },
  );

  it("'all' matches every entry, seat-attributed or shared", () => {
    expect(entryMatchesLogFilter(human, 'all', 0)).toBe(true);
    expect(entryMatchesLogFilter(ai1, 'all', 0)).toBe(true);
    expect(entryMatchesLogFilter(ai2, 'all', 0)).toBe(true);
    expect(entryMatchesLogFilter(shared, 'all', 0)).toBe(true);
    expect(entryMatchesLogFilter(turnHeader, 'all', 0)).toBe(true);
  });

  it("entries without a seatId match every filter (Q2 = A: shared/turn-level stay visible)", () => {
    for (const filter of ['all', 'human', 'ai'] as const) {
      expect(entryMatchesLogFilter(shared, filter, 0)).toBe(true);
      expect(entryMatchesLogFilter(turnHeader, filter, 0)).toBe(true);
    }
  });

  it('entries without a seatId match even when the human seat is absent (-1)', () => {
    for (const filter of ['human', 'ai'] as const) {
      expect(entryMatchesLogFilter(shared, filter, -1)).toBe(true);
      expect(entryMatchesLogFilter(turnHeader, filter, -1)).toBe(true);
    }
  });

  it('a roster without a human seat degrades to no You/AI-by-seat match without throwing', () => {
    // Seat buckets are undefined without a human seat: no seat-attributed entry
    // matches the 'human' (seatId === -1 never holds) or the 'ai' bucket
    // (there is no human seat to be "other than").
    expect(entryMatchesLogFilter(human, 'human', -1)).toBe(false);
    expect(entryMatchesLogFilter(ai1, 'ai', -1)).toBe(false);
    expect(entryMatchesLogFilter(ai2, 'ai', -1)).toBe(false);
    // And the call itself never throws for degenerate ids.
    expect(() => entryMatchesLogFilter(human, 'ai', -1)).not.toThrow();
  });
});

// ── filterLogEntries: table, empty input, immutability, order ──

describe('filterLogEntries', () => {
  const human = makeEntry(0, 'human action');
  const ai1 = makeEntry(1, 'AI 1 action');
  const ai2 = makeEntry(2, 'AI 2 action');
  const shared = makeSharedEntry('market refresh');
  const turnHeader = makeSharedEntry('Turn 3');
  // Deliberately out of natural seat order to pin order preservation.
  const entries = [ai2, shared, human, turnHeader, ai1];

  it.each<[LogFilter, number[]]>([
    // Indices into `entries` that must survive the filter, in order.
    ['all', [0, 1, 2, 3, 4]],
    ['human', [2, 1, 3]], // human + shared + turn header
    ['ai', [0, 4, 1, 3]], // both AI seats + shared + turn header
  ])('filter=%s keeps exactly the expected entries in original order', (filter, kept) => {
    const out = filterLogEntries(entries, filter, 0);
    expect(out.map((e) => e.text)).toEqual(kept.map((i) => entries[i].text));
    // Identity: retained entries are the same objects, not copies.
    kept.forEach((index, position) => expect(out[position]).toBe(entries[index]));
  });

  it('returns a new array and never mutates its input', () => {
    const snapshot = entries.map((e) => ({ ...e }));
    const out = filterLogEntries(entries, 'human', 0);
    expect(out).not.toBe(entries);
    expect(entries).toEqual(snapshot);
    // The input array itself is untouched (same order, same length).
    expect(entries).toHaveLength(5);
  });

  it('handles an empty input array for every filter', () => {
    for (const filter of ['all', 'human', 'ai'] as const) {
      const out = filterLogEntries([], filter, 0);
      expect(out).toEqual([]);
      // `.filter` always returns a fresh array, even for an empty input.
      expect(out).not.toBe(filterLogEntries([], filter, 0));
    }
  });
});

// ── shouldShowLogFilterControls ─────────────────────────────

describe('shouldShowLogFilterControls', () => {
  it('shows controls for a competitive roster of 2+ seats', () => {
    const twoSeats = createCompetitiveState({
      seed: 'filter-controls-2',
      playerCount: 2,
      opponents: [{ strategy: 'Random', difficulty: 'Easy' }],
    });
    const threeSeats = createCompetitiveState({
      seed: 'filter-controls-3',
      playerCount: 3,
      opponents: OPPONENTS,
    });
    expect(shouldShowLogFilterControls(twoSeats)).toBe(true);
    expect(shouldShowLogFilterControls(threeSeats)).toBe(true);
  });

  it('hides controls for a single-player state (no roster)', () => {
    const singlePlayer = setupMainStreetGame({ seed: 'filter-controls-solo' });
    expect(singlePlayer.players).toBeUndefined();
    expect(shouldShowLogFilterControls(singlePlayer)).toBe(false);
  });

  it('hides controls for a single-seat roster (competitive N=1)', () => {
    const oneSeat = createCompetitiveState({
      seed: 'filter-controls-1',
      playerCount: 1,
      opponents: [],
    });
    expect(shouldShowLogFilterControls(oneSeat)).toBe(false);
  });

  it('hides controls for the tutorial (a single-player run with no roster)', () => {
    // The tutorial is driven through the single-player mode path, so it has
    // the same absent roster as any other single-player game.
    const tutorial = setupMainStreetGame({ seed: 'filter-controls-tutorial' });
    expect(shouldShowLogFilterControls(tutorial)).toBe(false);
  });

  it('is false for an empty or single-seat roster and true only on 2+ seats', () => {
    expect(shouldShowLogFilterControls(rosterState([]))).toBe(false);
    expect(shouldShowLogFilterControls(rosterState([seat('human')]))).toBe(false);
    // Two seats show controls whatever the controllers are.
    expect(shouldShowLogFilterControls(rosterState([seat('human'), seat('ai')]))).toBe(true);
  });
});

// ── humanSeatId resolution integration (AC5) ────────────────

describe('humanSeatId resolution via findHumanSeatId', () => {
  it("resolves the human seat and drives the filters end-to-end", () => {
    const state = createCompetitiveState({
      seed: 'filter-human-resolution',
      playerCount: 3,
      opponents: OPPONENTS,
    });
    const humanSeatId = findHumanSeatId(state);
    expect(humanSeatId).toBe(0);

    // A fabricated log mixing human / AI / shared entries.
    const allEntries = [makeEntry(0), makeEntry(1), makeEntry(2), makeSharedEntry()];
    expect(filterLogEntries(allEntries, 'human', humanSeatId).map((e) => e.seatId)).toEqual([
      0, undefined,
    ]);
    expect(filterLogEntries(allEntries, 'ai', humanSeatId).map((e) => e.seatId)).toEqual([
      1, 2, undefined,
    ]);
  });

  it('a roster without a human-controller seat resolves to -1 and matches no You/AI seat entry', () => {
    const state = createCompetitiveState({
      seed: 'filter-no-human',
      playerCount: 2,
      opponents: [{ strategy: 'Random', difficulty: 'Easy' }],
    });
    // Take away the human seat (seat 0 becomes AI-controlled).
    state.players![0].controller = 'ai';
    const humanSeatId = findHumanSeatId(state);
    expect(humanSeatId).toBe(-1);

    const allEntries = [makeEntry(0), makeEntry(1), makeSharedEntry()];
    // No entry matches You/AI-by-seat; only shared entries remain visible.
    expect(filterLogEntries(allEntries, 'human', humanSeatId).map((e) => e.seatId)).toEqual([
      undefined,
    ]);
    expect(filterLogEntries(allEntries, 'ai', humanSeatId).map((e) => e.seatId)).toEqual([
      undefined,
    ]);
    // 'all' is unaffected.
    expect(filterLogEntries(allEntries, 'all', humanSeatId)).toHaveLength(3);
  });
});
