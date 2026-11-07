/**
 * Main Street: Game Events augmentation (MS-0MW1ZHBPK006M8YS)
 *
 * Main Street declares its own typed event names by augmenting the core
 * engine's {@link GameEventMap} — the additive mechanism documented on
 * `core/src/core-engine/GameEventEmitter.ts`. No game vocabulary ever enters
 * the engine module itself; the augmentation is a type-level contract only,
 * and the emitter stays name-agnostic at runtime, so every event (engine or
 * game-specific) is forwarded to the Phaser bridge, the `GlobalEventBuffer`
 * and the dev "Game Events" overlay through the existing catch-all
 * subscription — no per-game name lists anywhere.
 *
 * The only event declared here is:
 *
 *  - `activity-log` — emitted by `addLog(...)` / `addLogShared(...)` for every
 *    Activity Log row (payload: the {@link LogEntry} exactly as appended).
 *
 * ## Channel reachability
 *
 * The engine's log helpers receive only `MainStreetState` (engine purity:
 * headless Monte Carlo, unit tests and the tutorial scenario run with no
 * scene). The Game Events channel lives on the per-scene
 * {@link GameEventEmitter} (`CardGameScene.initEventSystem`), exposed as
 * `window.__GAME_EVENTS__` for the replay tool. {@link getActivityLogEmitter}
 * is the narrow, `window`-guarded read of that existing per-scene emitter —
 * it reuses the sanctioned channel instead of creating a new global, a second
 * emitter, or a module-level event bus.
 *
 * @module
 */

import type { GameEventEmitter } from '@core-engine/GameEventEmitter';
import type { LogEntry } from './MainStreetStateTypes';

// ── Event Map augmentation ──────────────────────────────────

/**
 * Declares the Main Street `activity-log` event on the engine's typed map.
 *
 * The payload is the {@link LogEntry} exactly as the Activity Log appends it
 * (`turn` / `text` / `type`, plus the optional seat fields), so the dev
 * "Game Events" overlay shows the same row the log displays and no second
 * message vocabulary is introduced.
 */
declare module '@core-engine/GameEventEmitter' {
  interface GameEventMap {
    /**
     * Emitted for every Activity Log row by `addLog(...)` / `addLogShared(...)`
     * when the scene's emitter is live. The single feed subscriber appends the
     * payload to `state.activityLog`; with no live channel `addLog` falls back
     * to appending directly (headless paths still log every row).
     */
    'activity-log': LogEntry;
  }
}

// ── Channel lookup ──────────────────────────────────────────

/**
 * Returns the scene's live Game Events channel, or `null` when none is
 * attached.
 *
 * The channel is the existing per-scene emitter exposed by
 * `CardGameScene.initEventSystem` as `window.__GAME_EVENTS__`. The lookup is
 * structural (checks for the emitter's public methods rather than trusting
 * tag/instanceof) so a test harness or a differently-typed window global can
 * never trip a false positive. `window`-guarded so pure-engine/headless runs
 * (Node unit tests, Monte Carlo, tutorial scenario) resolve `null` and keep
 * the direct-append fallback.
 *
 * @returns The live emitter, or `null` when no scene channel is attached.
 */
export function getActivityLogEmitter(): GameEventEmitter | null {
  if (typeof window === 'undefined') return null;
  const g = window as unknown as Record<string, unknown>;
  const maybe = g.__GAME_EVENTS__;
  if (!maybe || typeof maybe !== 'object') return null;
  const emitter = maybe as unknown as GameEventEmitter;
  if (typeof emitter.emit !== 'function' || typeof emitter.listenerCount !== 'function') {
    return null;
  }
  return emitter;
}
