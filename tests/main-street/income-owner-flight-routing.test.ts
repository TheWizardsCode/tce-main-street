/**
 * Main Street: owner-aware income flight destination resolution
 * (MS-0MW083E5H009ACB4, parent MS-0MVWNS9L7007CTK9).
 *
 * Test-first contract for the per-owner flight resolver that the animator's
 * three HUD-bound income routes (grid → bank collection, the reputation
 * phase's card → rep-bank pips, and the `upcoming` coin/reputation flows) must
 * consume instead of the shared `hudFlightTarget`:
 *
 *   `flightTargetFor(host, kind, layout, ownerId)`
 *
 * - owner `0` (the human seat, and every single-player / legacy slot that
 *   carries no owner) resolves exactly as `hudFlightTarget` does today — the
 *   published `hudCoinAnchor` / `hudRepAnchor`, else the legacy
 *   `hudCoinFallback` / `hudRepFallback` coordinate;
 * - an AI owner (`ownerId >= 1`) resolves to that seat's published
 *   competitive-scoreboard anchor (`hudSeatAnchors[ownerId]`), falling back to
 *   a deterministic per-seat cell when no anchor has been published yet.
 *
 * Why `it.fails` was used (red phase — now green): per the repo's test-first
 * tracer-bullet convention (see `competitive-per-seat-hand-capacity.test.ts`),
 * the contract cases were authored **red-phase** with `it.fails` by
 * `MS-0MW083E5H009ACB4` — the resolver did not exist, so every one of them
 * failed. The implementing child `MS-0MW083O38005B22F` ("Resolve income flights
 * per owner") flipped them to a plain `it` once the resolver landed; leaving
 * them as `it.fails` after the implementation ships is itself a failure, so the
 * suite cannot go stale. Guards that already held before the change stay plain
 * `it` so they keep protecting the single-player contract.
 *
 * The seat-fallback geometry is owned by the implementation
 * (`MainStreetConstants`, MS-0MW083MAN004JSCH), so this suite pins the
 * *contract* of the fallback — deterministic, per-owner, inside the HUD strip
 * band, never the shared HUD anchor — rather than exact pixel values.
 *
 * @module tests/main-street/income-owner-flight-routing
 */

import { describe, it, expect } from 'vitest';

import * as AnimatorContext from '../../src/scenes/MainStreetAnimatorContext';
import { hudFlightTarget } from '../../src/scenes/MainStreetAnimatorContext';
import { hudCoinFallback, hudRepFallback } from '../../src/scenes/MainStreetConstants';
import type { SceneLayout } from '../../src/scenes/MainStreetConstants';
import type { HudAnchorHost } from '../../src/scenes/MainStreetAnimatorContext';

// ── Fixtures ────────────────────────────────────────────────

/** HUD-strip layout shared by every case (the real strip geometry). */
const LAYOUT = {
  gameW: 1280,
  gameH: 720,
  hudY: 50,
  hudLeft: 20,
  hudRight: 1260,
  hudWidth: 1240,
} as unknown as SceneLayout;

/** Where the HUD render publishes the human seat's coin / reputation values. */
const HUD_COIN_ANCHOR = { x: 409, y: 50 };
const HUD_REP_ANCHOR = { x: 777, y: 50 };

/** Where the competitive scoreboard publishes two AI seats' summary rows. */
const SEAT_ANCHORS: Record<number, { x: number; y: number }> = {
  1: { x: 790, y: 32 },
  2: { x: 1090, y: 32 },
};

/** A host that has published the HUD anchors and every seat anchor. */
function publishedHost(): Record<string, unknown> {
  return {
    hudCoinAnchor: HUD_COIN_ANCHOR,
    hudRepAnchor: HUD_REP_ANCHOR,
    hudSeatAnchors: SEAT_ANCHORS,
  };
}

/** A host before the first render: nothing published yet. */
function blankHost(): Record<string, unknown> {
  return { hudCoinAnchor: null, hudRepAnchor: null, hudSeatAnchors: null };
}

type Target = { x: number; y: number };

/** The per-owner resolver's published signature (added by the implementing child). */
type FlightTargetFor = (
  host: unknown,
  kind: 'coin' | 'rep',
  layout: SceneLayout,
  ownerId?: number,
) => Target;

/**
 * Resolve the `flightTargetFor` export. Read through an `unknown` cast so the
 * suite keeps type-checking against the public module surface rather than a
 * private import path.
 */
function resolver(): FlightTargetFor {
  const fn = (AnimatorContext as unknown as { flightTargetFor?: FlightTargetFor })
    .flightTargetFor;
  if (typeof fn !== 'function') {
    throw new Error(
      'flightTargetFor(host, kind, layout, ownerId) is not exported from ' +
        'MainStreetAnimatorContext — contract authored by ' +
        'MS-0MW083E5H009ACB4 and implemented by MS-0MW083O38005B22F.',
    );
  }
  return fn;
}

// ── Owner 0 == today's hudFlightTarget (guards that already hold) ──

describe('hudFlightTarget — the owner-0 / single-player contract (unchanged)', () => {
  it('prefers the published HUD coin and reputation anchors for owner 0', () => {
    const host = publishedHost();
    expect(hudFlightTarget(host as unknown as HudAnchorHost, 'coin', LAYOUT)).toEqual(HUD_COIN_ANCHOR);
    expect(hudFlightTarget(host as unknown as HudAnchorHost, 'rep', LAYOUT)).toEqual(HUD_REP_ANCHOR);
  });

  it('falls back to the shared legacy coordinates before the first HUD render', () => {
    const host = blankHost();
    expect(hudFlightTarget(host as unknown as HudAnchorHost, 'coin', LAYOUT)).toEqual(
      hudCoinFallback(LAYOUT),
    );
    expect(hudFlightTarget(host as unknown as HudAnchorHost, 'rep', LAYOUT)).toEqual(
      hudRepFallback(LAYOUT),
    );
  });
});

// ── flightTargetFor — per-owner income flight destination ───

describe('flightTargetFor — per-owner income flight destination', () => {
  it('resolves the human seat (owner 0) to the published HUD anchors', () => {
    const host = publishedHost();
    const resolve = resolver();

    expect(resolve(host, 'coin', LAYOUT, 0)).toEqual(HUD_COIN_ANCHOR);
    expect(resolve(host, 'rep', LAYOUT, 0)).toEqual(HUD_REP_ANCHOR);
    // The HUD anchors win over any seat anchor at the same owner id.
    expect(resolve({ ...host, hudSeatAnchors: { 0: { x: 5, y: 5 } } }, 'coin', LAYOUT, 0)).toEqual(
      HUD_COIN_ANCHOR,
    );
  });

  it("resolves an AI seat (ownerId >= 1) to that seat's published scoreboard anchor", () => {
    const host = publishedHost();
    const resolve = resolver();

    // The AI "bank" today is the seat's competitive-scoreboard summary row,
    // published per playerId by the renderer (MS-0MW083MAN004JSCH).
    expect(resolve(host, 'coin', LAYOUT, 1)).toEqual(SEAT_ANCHORS[1]);
    expect(resolve(host, 'rep', LAYOUT, 1)).toEqual(SEAT_ANCHORS[1]);
    expect(resolve(host, 'coin', LAYOUT, 2)).toEqual(SEAT_ANCHORS[2]);
    // An AI seat never falls back to the human HUD counters.
    expect(resolve(host, 'coin', LAYOUT, 1)).not.toEqual(HUD_COIN_ANCHOR);
    expect(resolve(host, 'rep', LAYOUT, 2)).not.toEqual(HUD_REP_ANCHOR);
  });

  it('is null-safe: an unpublished seat anchor falls back deterministically per seat', () => {
    const resolve = resolver();
    // The scoreboard has not published anchors yet (first frame / re-layout).
    const host = blankHost();

    const first = resolve(host, 'coin', LAYOUT, 1);
    const second = resolve(host, 'coin', LAYOUT, 1);
    // Deterministic: the same call resolves the same cell every time.
    expect(second).toEqual(first);
    // Coin and reputation occupy the same seat cell (one seat, one bank).
    expect(resolve(host, 'rep', LAYOUT, 1)).toEqual(first);
    // A seat fallback is never the human HUD counter.
    expect(first).not.toEqual(hudCoinFallback(LAYOUT));
    expect(first).not.toEqual(hudRepFallback(LAYOUT));
    // ... and a partially published map still falls back for the missing seat.
    const partial = { ...blankHost(), hudSeatAnchors: { 1: SEAT_ANCHORS[1] } };
    expect(resolve(partial, 'coin', LAYOUT, 2)).toEqual(resolve(blankHost(), 'coin', LAYOUT, 2));
  });

  it('gives each seat its own cell inside the HUD strip band (deterministic layout)', () => {
    const resolve = resolver();
    const host = blankHost();

    const seatX = [1, 2, 3].map((ownerId) => resolve(host, 'coin', LAYOUT, ownerId).x);
    // Each seat gets its own cell, laid out left to right by owner id (the
    // same order the scoreboard renders its rows).
    expect(seatX[0]).toBeLessThan(seatX[1]);
    expect(seatX[1]).toBeLessThan(seatX[2]);
    // Every fallback stays inside the HUD strip band, on/above its baseline.
    for (const ownerId of [1, 2, 3]) {
      const cell = resolve(host, 'rep', LAYOUT, ownerId);
      expect(cell.x).toBeGreaterThanOrEqual(LAYOUT.hudLeft);
      expect(cell.x).toBeLessThanOrEqual(LAYOUT.hudRight);
      expect(cell.y).toBeLessThanOrEqual(LAYOUT.hudY);
    }
  });

  it('treats an absent ownerId exactly like hudFlightTarget (legacy / single-player)', () => {
    const resolve = resolver();

    // Published anchors: absent owner and explicit owner 0 both match today's
    // HUD resolution, for both resource kinds.
    const published = publishedHost();
    for (const kind of ['coin', 'rep'] as const) {
      const legacy = hudFlightTarget(published as unknown as HudAnchorHost, kind, LAYOUT);
      expect(resolve(published, kind, LAYOUT, undefined)).toEqual(legacy);
      expect(resolve(published, kind, LAYOUT, 0)).toEqual(legacy);
    }

    // Unpublished anchors: the legacy fallback coordinates, unchanged.
    const blank = blankHost();
    expect(resolve(blank, 'coin', LAYOUT, undefined)).toEqual(hudCoinFallback(LAYOUT));
    expect(resolve(blank, 'rep', LAYOUT, undefined)).toEqual(hudRepFallback(LAYOUT));
  });
});
