/**
 * Main Street: Activity Log ↔ Game Events feed (MS-0MW1ZHBPK006M8YS)
 *
 * The Activity Log is now fed through the Game Events channel: `addLog(...)`
 * emits a typed `activity-log` event when the scene's emitter is live
 * (`window.__GAME_EVENTS__`), and a single subscriber
 * (`bindActivityLogFeed`, wired by the scene lifecycle) is the only writer of
 * `state.activityLog`. With no live channel (headless Monte Carlo, unit
 * tests, tutorial scenario) `addLog` falls back to appending directly —
 * same rows, no throw.
 *
 * AC coverage mapped to tests:
 *  - event contract / single write path: `emits …` + `guard` tests below;
 *  - headless no-emitter fallback: `headless …`;
 *  - feed/buffer parity: `buffers one activity-log event per row`;
 *  - behaviour preserved across purchase / sell / income / incident /
 *    per-turn-net rows: the `channel and headless produce identical logs`
 *    parity test drives the same sequence through both paths;
 *  - undo/redo + save/load round-trips: `undo/redo` + `save/load` tests.
 *
 * Existing activity-log/seat-attribution/filter suites keep passing unchanged
 * (they cover loan, storyline and full-turn texts); this file pins the feed
 * wiring itself, which that suite predates.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { GameEventEmitter } from '@core-engine/GameEventEmitter';
import { GlobalEventBuffer } from '@ui/debug/GlobalEventBuffer';
import { UndoRedoManager } from '@core-engine/UndoRedoManager';

import {
  addLog,
  addLogShared,
  bindActivityLogFeed,
  setupMainStreetGame,
  serializeMainStreetState,
  deserializeMainStreetState,
  type LogEntry,
  type MainStreetState,
} from '../../src/MainStreetState';
import { buyBusinessCommand } from '../../src/MainStreetCommands';
import { executeWeekStart, processEndOfTurn } from '../../src/MainStreetEngine';
import { purchaseBusiness } from '../../src/MainStreetMarket';
import {
  createActivityLogState,
  driveAction,
  startDay,
} from './helpers/activity-log-harness';
import type { BusinessCard, EventCard } from '../../src/MainStreetCards';

// ── Helpers ─────────────────────────────────────────────────

/** Guarantees a clean headless baseline: no `window` global leaks across tests. */
function stripWindow(): void {
  const g = globalThis as Record<string, unknown>;
  delete g.window;
}

/** Points the channel lookup at a real emitter, as `CardGameScene.initEventSystem` does. */
function attachWindowChannel(emitter: GameEventEmitter): void {
  const g = globalThis as Record<string, unknown>;
  g.window = { __GAME_EVENTS__: emitter } as unknown as Window & typeof globalThis;
}

/** A fabricated Incident event card for the deterministic incident path. */
function makeIncident(): EventCard {
  return {
    family: 'event',
    id: 'feed-test-incident',
    name: 'Feed Test Incident',
    trigger: 'Incident',
    cost: 0,
    effect: '-1 coin',
    coinDelta: -1,
    reputationDelta: 0,
    target: 'All',
    targetSynergy: undefined,
  };
}

/** A fabricated Business card so the parity driver is seed-independent. */
function makeBusiness(): BusinessCard {
  return {
    family: 'business',
    id: 'feed-test-biz',
    name: 'Feed Test Biz',
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
  };
}

/**
 * Single-player segment: turn header + purchase + sell + per-turn net.
 * Uses the same direct engine seams the pre-feed `activity-log.test.ts`
 * drives, so the expected rows are the known-good baseline.
 */
function driveSinglePlayerSegment(state: MainStreetState): void {
  executeWeekStart(state); // turn header (shared)
  state.market.cards.unshift(makeBusiness()); // deterministic purchasable card
  state.resourceBank.coins = 5000; // ensure enough coins
  purchaseBusiness(state, 'feed-test-biz', 0); // loss entry
  driveAction(state, { type: 'sell', slotIndex: 0 }); // seat-attributed sale
  processEndOfTurn(state); // per-turn net row
}

/**
 * Competitive segment: turn header + per-owner income + explicit-seat
 * reputation + incident (shared draw + per-owner outcomes) — the paths that
 * exercise the default / explicit-seat / shared `addLog` overloads.
 */
function driveCompetitiveSegment(state: MainStreetState): void {
  startDay(state); // "Turn 1" header (shared)
  driveAction(state, { type: 'income' }); // per-owner income rows
  driveAction(state, { type: 'reputation', playerId: 0, delta: 3 });
  driveAction(state, { type: 'incident', event: makeIncident() });
}

// ── Setup ───────────────────────────────────────────────────

describe('Activity Log feed (MS-0MW1ZHBPK006M8YS)', () => {
  let emitter: GameEventEmitter;
  let unsubscribe: (() => void) | null = null;

  beforeEach(() => {
    stripWindow();
    GlobalEventBuffer.getInstance().clear();
    emitter = new GameEventEmitter();
    unsubscribe = null;
  });

  afterEach(() => {
    unsubscribe?.();
    stripWindow();
    GlobalEventBuffer.getInstance().clear();
  });

  /** Opens the channel for the current test: window + feed subscriber + buffer. */
  function openChannel(state: MainStreetState): void {
    unsubscribe?.();
    attachWindowChannel(emitter);
    unsubscribe = bindActivityLogFeed(emitter, () => state);
    GlobalEventBuffer.getInstance().subscribe(emitter);
  }

  // ── Event contract / single write path ────────────────────

  it('emits a typed activity-log event and the single subscriber appends the row', () => {
    const state = createActivityLogState({ seed: 'feed-contract' });
    openChannel(state);
    expect(emitter.listenerCount('activity-log')).toBe(1);

    const seen: LogEntry[] = [];
    const captureOff = emitter.on('activity-log', (entry) => seen.push(entry));

    addLog(state, 'Direct row', 'neutral');
    addLogShared(state, 'Shared row', 'turn-header');
    addLog(state, 0, 'Seat row', 'gain');

    // Exactly one row per call — the subscriber, not a second write, appended.
    expect(state.activityLog).toHaveLength(3);
    expect(state.activityLog.map((e) => e.text)).toEqual(
      ['Direct row', 'Shared row', 'Seat row'],
    );
    // The emitted payload IS the appended row (same object) in emission order.
    expect(seen).toEqual(state.activityLog);
    captureOff();
  });

  it('routes the first row through the engine week-start when the channel is live', () => {
    const state = createActivityLogState({ seed: 'feed-weekstart' });
    openChannel(state);

    startDay(state);

    expect(state.activityLog.map((e) => e.text)).toEqual(['Turn 1']);
  });

  it('guard: state.activityLog has no row-append writer outside appendActivityLogEntry', () => {
    // AC-mandated structural invariant (MS-0MW1ZHBPK006M8YS): every row is
    // produced through the single writer. A behavioural test cannot cover the
    // full 102-site surface, so this pins the architecture: no `.push` /
    // `.unshift` / `.splice` on `activityLog` anywhere in `src/` except the
    // one row-append inside `appendActivityLogEntry`. Deliberate exclusions
    // (restore/serialisation) are assignments/clones, not row appends, and
    // are documented on `appendActivityLogEntry` and `restoreSnapshot`.
    const srcRoot = resolve(__dirname, '../../src');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) files.push(full);
      }
    };
    walk(srcRoot);

    const appends: Array<{ file: string; line: string }> = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (/\.activityLog\s*\.\s*(push|unshift|splice)\s*\(/.test(line)) {
          appends.push({ file: relative(srcRoot, file), line: `${idx + 1}: ${line.trim()}` });
        }
      });
    }

    expect(appends).toHaveLength(1);
    expect(appends[0].file).toBe('MainStreetStateLog.ts');
    const src = readFileSync(join(srcRoot, 'MainStreetStateLog.ts'), 'utf8');
    const fnStart = src.indexOf('export function appendActivityLogEntry');
    expect(fnStart).toBeGreaterThanOrEqual(0);
    const fnTail = src.indexOf('\n}', fnStart);
    expect(src.slice(fnStart, fnTail)).toContain('state.activityLog.push(entry);');
    // The lone append must be (and stay) inside the single-writer function.
    const match = src.indexOf('state.activityLog.push(entry);');
    expect(match).toBeGreaterThan(fnStart);
    expect(match).toBeLessThan(fnTail);
  });

  // ── Headless no-emitter fallback ──────────────────────────

  it('headless: no emitter attached still logs every row and throws nothing', () => {
    // `stripWindow()` in beforeEach guarantees `typeof window === 'undefined'`.
    const state = createActivityLogState({ seed: 'feed-headless' });
    driveCompetitiveSegment(state);

    expect(state.activityLog.length).toBeGreaterThan(0);
    expect(state.activityLog[0].text).toBe('Turn 1');
    // The shared incident draw produced both draw + per-owner outcome lines.
    expect(state.activityLog.some((e) => /Incident/.test(e.text))).toBe(true);
  });

  // ── Channel vs headless parity (behaviour preserved) ──────

  it('channel and headless produce identical logs for the same actions', () => {
    const competitiveChannel = createActivityLogState({ seed: 'feed-parity-c' });
    const competitiveHeadless = createActivityLogState({ seed: 'feed-parity-c' });
    const singleChannel = setupMainStreetGame({ seed: 'feed-parity-s' });
    const singleHeadless = setupMainStreetGame({ seed: 'feed-parity-s' });

    // Channel side: the subscriber binds the state actually being driven.
    openChannel(competitiveChannel);
    driveCompetitiveSegment(competitiveChannel);
    openChannel(singleChannel);
    driveSinglePlayerSegment(singleChannel);

    // Headless side: no channel on the page at all (a second live state
    // would make `addLog` emit into the channel-bound state instead).
    unsubscribe?.();
    stripWindow();
    driveCompetitiveSegment(competitiveHeadless);
    driveSinglePlayerSegment(singleHeadless);

    expect(competitiveChannel.activityLog).toEqual(competitiveHeadless.activityLog);
    expect(singleChannel.activityLog).toEqual(singleHeadless.activityLog);
    // A representative cross-section across the AC3 categories.
    const text = singleChannel.activityLog.map((e) => e.text).join('\n');
    expect(text).toMatch(/Turn 1/); // turn-header
    expect(text).toMatch(/Placed|Purchased|Bought/); // purchase (loss) row
    expect(text).toMatch(/Sold/); // sell row
    expect(text).toMatch(/net:/); // per-turn net row
    const cText = competitiveChannel.activityLog.map((e) => e.text).join('\n');
    expect(cText).toMatch(/income/i); // per-owner income
    expect(cText).toMatch(/Incident/); // incident draw + per-owner outcomes
  });

  // ── Buffer / overlay parity ───────────────────────────────

  it('buffers one activity-log event per row, in emission order', () => {
    const state = createActivityLogState({ seed: 'feed-buffer' });
    openChannel(state);

    driveCompetitiveSegment(state);

    const buffer = GlobalEventBuffer.getInstance();
    const logEvents = buffer.getEntries().filter((e) => e.eventName === 'activity-log');
    expect(logEvents).toHaveLength(state.activityLog.length);
    // Emission order equals row order: the buffered payloads are the
    // appended entries in log order (all events are emitted synchronously
    // by the engine before the buffer is read).
    expect(logEvents.map((e) => e.payload)).toEqual(state.activityLog);
  });

  // ── Undo / redo ───────────────────────────────────────────

  it('undo restores the log and the single writer keeps appending after it', () => {
    const state = createActivityLogState({ seed: 'feed-undo' });
    openChannel(state);

    startDay(state);
    const before = JSON.parse(JSON.stringify(state.activityLog));

    state.market.cards.unshift(makeBusiness());
    state.resourceBank.coins = 5000;
    const undo = new UndoRedoManager();
    undo.execute(buyBusinessCommand(state, 'feed-test-biz', 0));

    // Execute appended the purchase row (and possibly challenge rows).
    expect(state.activityLog.length).toBeGreaterThan(before.length);

    // Undo restores the log exactly (AC5 — the undoable record is
    // authoritative; the identical round-trip is pinned by the existing
    // MainStreetEventChoiceUndo suite).
    undo.undo();
    expect(state.activityLog).toEqual(before);

    // Redo re-applies the same rows through the same single write path.
    undo.redo();
    expect(state.activityLog.length).toBeGreaterThan(before.length);

    // The feed is an append-only session audit trail: it keeps every event
    // (including undone rows — documented divergence in the work item),
    // while the undoable log stays authoritative.
    const buffer = GlobalEventBuffer.getInstance();
    const logEvents = buffer.getEntries().filter((e) => e.eventName === 'activity-log');
    expect(logEvents.length).toBeGreaterThanOrEqual(state.activityLog.length);

    // The single writer still appends to the (possibly restored) log array
    // after undo — the subscriber binds the state, not a stale array copy.
    undo.undo();
    addLog(state, 'Post-undo row', 'neutral');
    expect(state.activityLog[state.activityLog.length - 1].text).toBe('Post-undo row');
  });

  // ── Save / load ───────────────────────────────────────────

  it('save/load round-trip preserves a feed-written log', () => {
    const state = createActivityLogState({ seed: 'feed-save' });
    openChannel(state);

    driveCompetitiveSegment(state);

    const serialised = serializeMainStreetState(state);
    const restored = deserializeMainStreetState(serialised);

    // AC5: save/load round-trips the feed-written log exactly as today.
    expect(restored.activityLog).toEqual(state.activityLog);

    // A freshly restored state keeps logging with no channel bound to it
    // (headless fallback) without throwing and without losing rows.
    unsubscribe?.();
    stripWindow();
    addLog(restored, 'After restore', 'neutral');
    expect(restored.activityLog[restored.activityLog.length - 1].text).toBe('After restore');
  });
});
