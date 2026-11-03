/**
 * Main Street: per-seat competitive scoreboard flight anchors
 * (MS-0MW083FMS009O2CT, parent MS-0MVWNS9L7007CTK9 AC3 / AC6(b)).
 *
 * Test-first contract for the anchor seam the per-owner income flights will
 * consume: the competitive scoreboard renderer publishes **one live flight
 * anchor per rendered row**, keyed by that row's `playerId`, at the row centre
 * x and the row baseline y — mirroring the single live `hudCoinAnchor` /
 * `hudRepAnchor` contract (`MS-0MUYT57J80021CWW`).
 *
 * ## Pinned contract (landed by MS-0MW083MAN004JSCH)
 *
 * 1. `MainStreetScene.hudSeatAnchors: Record<number, {x, y}> | null` — `null`
 *    (or absent) before the first render, recomputed on **every** render.
 * 2. `renderCompetitiveScoreboard` assigns the whole map (never merges into a
 *    stale one) keyed by `row.playerId`, at the rendered row's text position
 *    (`{x, y}`, origin 0.5/1 ⇒ centre x, baseline y).
 * 3. The anchors are cleared together with the transient HUD in `refreshHud`
 *    (`clearTransientHud` path), so stale geometry never outlives a re-layout
 *    or a return to single-player.
 * 4. `MainStreetConstants.hudSeatFallback(layout, seatIndex, seatCount)`
 *    returns that same per-seat cell deterministically from `hudLeft` /
 *    `hudWidth` / row count, and matches what the renderer publishes for a
 *    stable layout — mirroring `hudCoinFallback` / `hudRepFallback`.
 *
 * ## Why `it.fails` (red phase)
 *
 * Per the repo's test-first tracer-bullet convention (see
 * `competitive-per-seat-hand-capacity.test.ts` and the sibling test item
 * `MS-0MW083E5H009ACB4`), the contract cases are authored **red-phase** with
 * `it.fails`: today the renderer publishes no anchors and the helper does not
 * exist, so every one of them fails. The implementing child
 * `MS-0MW083MAN004JSCH` ("Publish per-seat scoreboard anchors") flips them to a
 * plain `it` once the seam lands — leaving them as `it.fails` afterwards is
 * itself a failure, so this suite cannot go stale. Guards that already hold
 * today stay plain `it` so they keep protecting the existing row rendering
 * through the change.
 *
 * The AI bank is deliberately the seat's own summary row (the documented
 * stopgap until a real AI bank exists): these tests pin the **anchor seam** —
 * one anchor per row, per `playerId` — never a bank account.
 *
 * @module tests/main-street/competitive-seat-anchors
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));
vi.mock('@ui', () => ({
  FONT_FAMILY: 'sans-serif',
  markHudTransient: (obj: unknown) => obj,
  clearTransientHud: vi.fn(),
}));
// `refreshHud` (the transient-HUD clear path) is imported for the clearing
// cases only; its button/tooltip helpers are irrelevant to anchors.
vi.mock('@ui/Renderer', () => ({
  createActionButton: vi.fn(() => ({ list: [{}] })),
}));
vi.mock('@ui/Renderer/adapters/MainStreetAdapter', () => ({
  attachHudTooltipZone: vi.fn(),
  mainStreetRenderCardSvg: vi.fn(),
}));

import { renderCompetitiveScoreboard } from '../../src/scenes/MainStreetRendererCompetitiveHud';
import { refreshHud } from '../../src/scenes/MainStreetRendererHud';
import * as Constants from '../../src/scenes/MainStreetConstants';
import type { SceneLayout } from '../../src/scenes/MainStreetConstants';
import {
  createCompetitiveState,
  setupMainStreetGame,
  type CompetitiveOpponentConfig,
  type MainStreetState,
} from '../../src/MainStreetState';

// ── Fixtures ────────────────────────────────────────────────

const OPPONENTS: CompetitiveOpponentConfig[] = [
  { strategy: 'Random', difficulty: 'Easy' },
  { strategy: 'Greedy', difficulty: 'Medium' },
];

/** Three seats: the human plus two AI seats. */
function competitiveState(playerCount = 3): MainStreetState {
  return createCompetitiveState({
    seed: 'competitive-seat-anchors',
    playerCount,
    opponents: OPPONENTS.slice(0, Math.max(0, playerCount - 1)),
  });
}

/**
 * The real HUD strip band (`hudLeft`..`hudRight`, `hudWidth` wide) at a
 * realistic viewport. `layoutB` is the same strip after a re-layout (narrower
 * and shifted right), used to prove the anchors are recomputed, not cached.
 */
const LAYOUT_A = {
  gameW: 1280,
  gameH: 720,
  hudLeft: 20,
  hudRight: 1260,
  hudWidth: 1240,
  hudY: 50,
  favourBandRight: 700,
  favourCoinsToRepX: 620,
  favourRepToCoinsX: 680,
  favourButtonW: 56,
  favourButtonH: 20,
} as unknown as SceneLayout;

const LAYOUT_B = {
  ...LAYOUT_A,
  hudLeft: 120,
  hudRight: 1120,
  hudWidth: 1000,
  hudY: 60,
} as unknown as SceneLayout;

type SeatAnchor = { x: number; y: number };
type SeatAnchorStore = Record<number, SeatAnchor>;

/** Why a red-phase case failed, in terms the implementing child can act on. */
function missingAnchorStore(): Error {
  return new Error(
    'scene.hudSeatAnchors is not published yet — red-phase contract authored by ' +
      'MS-0MW083FMS009O2CT, landed by MS-0MW083MAN004JSCH (one anchor per rendered ' +
      'competitive scoreboard row, keyed by playerId).',
  );
}

/** The pinned pre-render fallback helper (added by the implementing child). */
type SeatFallback = (layout: SceneLayout, seatIndex: number, seatCount: number) => SeatAnchor;

function seatFallback(): SeatFallback {
  const fn = (Constants as unknown as { hudSeatFallback?: SeatFallback }).hudSeatFallback;
  if (typeof fn !== 'function') {
    throw new Error(
      'hudSeatFallback(layout, seatIndex, seatCount) is not exported from ' +
        'MainStreetConstants yet — red-phase contract authored by ' +
        'MS-0MW083FMS009O2CT, landed by MS-0MW083MAN004JSCH.',
    );
  }
  return fn;
}

// ── Recording scene harness ─────────────────────────────────

interface RecordedText {
  x: number;
  y: number;
  text: string;
  style: Record<string, unknown>;
  name?: string;
  data: Record<string, unknown>;
}

interface Harness {
  renderer: { scene: Record<string, unknown> };
  scene: Record<string, unknown> & { hudSeatAnchors?: SeatAnchorStore | null };
  texts: RecordedText[];
}

/**
 * A minimal recording `MainStreetRendererContext` scene: captures every text
 * object the renderer creates together with its x/y, style and `setData` tags,
 * mirroring the real Phaser surface the HUD render and the competitive
 * scoreboard use. Deliberately does **not** pre-create `hudSeatAnchors` unless
 * asked, so the "before the first render" state is exercised for real.
 */
function createHarness(
  state: MainStreetState,
  options: { layout?: SceneLayout; hudSeatAnchors?: SeatAnchorStore | null } = {},
): Harness {
  const texts: RecordedText[] = [];

  function textObject(x: number, y: number, text: string, style: Record<string, unknown>) {
    const obj: RecordedText = { x, y, text, style, data: {} };
    const chain = {
      x,
      y,
      width: 100,
      height: 16,
      setOrigin: () => chain,
      setStrokeStyle: () => chain,
      setDepth: () => chain,
      setName: (name: string) => {
        obj.name = name;
        return chain;
      },
      setData: (key: string, value: unknown) => {
        obj.data[key] = value;
        return chain;
      },
    };
    texts.push(obj);
    return chain;
  }

  const scene: Record<string, unknown> = {
    state,
    layout: options.layout ?? LAYOUT_A,
    uiPhase: 'idle',
    replayMode: false,
    hudContainer: { add: vi.fn((obj: unknown) => obj), list: [] },
    animateHudValueChanges: vi.fn(),
    onCommunityFavourClick: vi.fn(),
    add: {
      text: vi.fn(textObject),
      rectangle: vi.fn(() => ({
        setOrigin: () => ({ setStrokeStyle: () => ({}) }),
        setStrokeStyle: () => ({}),
      })),
    },
  };
  if ('hudSeatAnchors' in options) scene.hudSeatAnchors = options.hudSeatAnchors;

  return {
    renderer: { scene },
    scene: scene as Harness['scene'],
    texts,
  };
}

/** The published per-seat anchor map, or an actionable red-phase failure. */
function publishedAnchors(scene: Harness['scene']): SeatAnchorStore {
  const store = scene.hudSeatAnchors;
  if (!store) throw missingAnchorStore();
  return store;
}

/** Rendered scoreboard rows keyed by their tagged `playerId`. */
function rowsByPlayer(texts: RecordedText[]): Map<number, RecordedText> {
  return new Map(
    texts
      .filter((t) => t.data.playerId !== undefined)
      .map((t) => [t.data.playerId as number, t]),
  );
}

/** Anchor entries as `[playerId, anchor]` pairs, sorted by seat id. */
function anchorEntries(store: SeatAnchorStore): Array<[number, SeatAnchor]> {
  return Object.entries(store)
    .map(([id, anchor]) => [Number(id), anchor] as [number, SeatAnchor])
    .sort((a, b) => a[0] - b[0]);
}

// ── Publication (AC1, AC2) ─────────────────────────────────

describe('renderCompetitiveScoreboard publishes per-seat anchors (red-phase)', () => {
  it('still renders one tagged row per seat when no anchor store exists yet', () => {
    const { renderer, scene, texts } = createHarness(competitiveState());

    // Before the first render the store is absent entirely — the renderer must
    // never assume it exists.
    expect(scene.hudSeatAnchors).toBeUndefined();

    expect(() => renderCompetitiveScoreboard(renderer as never)).not.toThrow();
    expect(rowsByPlayer(texts).size).toBe(3);
  });

  it('renders nothing for a single-player state, so no seat anchors are implied', () => {
    const single = setupMainStreetGame({ seed: 'competitive-seat-anchors-single' });
    const { renderer, scene, texts } = createHarness(single);

    renderCompetitiveScoreboard(renderer as never);

    expect(texts).toHaveLength(0);
    expect(scene.hudSeatAnchors).toBeUndefined();
  });

  it('renders the scoreboard through the transient HUD refresh on this harness', () => {
    const { renderer, texts } = createHarness(competitiveState());

    // Harness sanity guard: the clearing cases below must fail only on the
    // unpublished anchors, never because `refreshHud` hits a missing scene API.
    expect(() => refreshHud(renderer as never)).not.toThrow();
    expect(rowsByPlayer(texts).size).toBe(3);
  });

  it.fails('publishes one anchor per rendered row, keyed by playerId, at the row centre x and baseline y', () => {
    const { renderer, scene, texts } = createHarness(competitiveState());

    renderCompetitiveScoreboard(renderer as never);

    const rows = rowsByPlayer(texts);
    const anchors = publishedAnchors(scene);

    // One entry per rendered row — no more, no fewer.
    expect(anchorEntries(anchors).map(([id]) => id)).toEqual([0, 1, 2]);
    expect(Object.keys(anchors)).toHaveLength(rows.size);

    // The anchor is the row's own text position: origin (0.5, 1) means its x is
    // the cell centre and its y is the text baseline — the row's summary spot.
    for (const [playerId, row] of rows) {
      expect(anchors[playerId]).toEqual({ x: row.x, y: row.y });
    }

    // ...which is the centre of that seat's cell inside the HUD strip band.
    const colWidth = LAYOUT_A.hudWidth / rows.size;
    for (let index = 0; index < rows.size; index += 1) {
      expect(anchors[index].x).toBeCloseTo(LAYOUT_A.hudLeft + colWidth * index + colWidth / 2, 5);
    }
    // Every row shares the same baseline, above the HUD strip's centre line.
    const ys = anchorEntries(anchors).map(([, anchor]) => anchor.y);
    expect(new Set(ys).size).toBe(1);
    expect(ys[0]).toBeLessThan(LAYOUT_A.hudY);
  });

  it.fails('publishes into a scene whose anchor store starts null (safe before the first render)', () => {
    const { renderer, scene, texts } = createHarness(competitiveState(), { hudSeatAnchors: null });

    renderCompetitiveScoreboard(renderer as never);

    expect(anchorEntries(publishedAnchors(scene)).map(([id]) => id)).toEqual([0, 1, 2]);
    expect(rowsByPlayer(texts).size).toBe(3);
  });

  it.fails('recomputes on every render: a shrunken roster leaves no stale seat anchor', () => {
    const state = competitiveState();
    const { renderer, scene } = createHarness(state, {
      // Stale entries from an earlier, larger roster must not survive.
      hudSeatAnchors: { 0: { x: 1, y: 2 }, 1: { x: 3, y: 4 }, 2: { x: 5, y: 6 }, 3: { x: 7, y: 8 } },
    });

    renderCompetitiveScoreboard(renderer as never);
    expect(anchorEntries(publishedAnchors(scene)).map(([id]) => id)).toEqual([0, 1, 2]);

    // A seat is eliminated / the roster shrinks: the removed seat's anchor is
    // gone rather than left pointing at geometry that no longer exists.
    state.players = state.players!.slice(0, 2);
    renderCompetitiveScoreboard(renderer as never);
    expect(anchorEntries(publishedAnchors(scene)).map(([id]) => id)).toEqual([0, 1]);
  });

  it.fails('recomputes on every render: a re-layout moves every anchor', () => {
    const { renderer, scene } = createHarness(competitiveState());

    renderCompetitiveScoreboard(renderer as never);
    const before = publishedAnchors(scene);
    const beforeA = anchorEntries(before).map(([, anchor]) => anchor);

    (scene as { layout: SceneLayout }).layout = LAYOUT_B;
    renderCompetitiveScoreboard(renderer as never);
    const after = publishedAnchors(scene);

    expect(anchorEntries(after).map(([id]) => id)).toEqual([0, 1, 2]);
    for (const index of [0, 1, 2]) {
      // Fresh geometry — never the previous render's coordinates.
      expect(after[index]).not.toEqual(beforeA[index]);
      expect(after[index].y).toBeLessThan(LAYOUT_B.hudY);
    }
    const colWidth = LAYOUT_B.hudWidth / 3;
    for (const index of [0, 1, 2]) {
      expect(after[index].x).toBeCloseTo(LAYOUT_B.hudLeft + colWidth * index + colWidth / 2, 5);
    }
  });
});

// ── Pre-render fallback geometry (AC4) ─────────────────────

describe('hudSeatFallback pre-render geometry (red-phase)', () => {
  it.fails('matches the anchors the renderer publishes for a stable layout', () => {
    const { renderer, scene } = createHarness(competitiveState());
    renderCompetitiveScoreboard(renderer as never);
    const published = publishedAnchors(scene);
    const fallback = seatFallback();

    // The fallback IS the renderer's geometry: a flight resolved before the
    // first render lands exactly where the rendered row's anchor sits.
    for (const seatIndex of [0, 1, 2]) {
      expect(fallback(LAYOUT_A, seatIndex, 3)).toEqual(published[seatIndex]);
    }
  });

  it.fails('is deterministic, per-seat, left-to-right and inside the HUD strip band', () => {
    const fallback = seatFallback();

    const seats = [0, 1, 2].map((seatIndex) => fallback(LAYOUT_A, seatIndex, 3));
    // Deterministic: the same call resolves the same cell every time.
    expect(fallback(LAYOUT_A, 1, 3)).toEqual(seats[1]);
    // Own cell per seat, laid out left to right in row order.
    expect(seats[0].x).toBeLessThan(seats[1].x);
    expect(seats[1].x).toBeLessThan(seats[2].x);
    // Never outside the strip: each cell centre sits inside hudLeft..hudRight.
    for (const seat of seats) {
      expect(seat.x).toBeGreaterThan(LAYOUT_A.hudLeft);
      expect(seat.x).toBeLessThan(LAYOUT_A.hudLeft + LAYOUT_A.hudWidth);
    }
    // One shared row baseline above the strip's centre line.
    expect(new Set(seats.map((seat) => seat.y)).size).toBe(1);
    expect(seats[0].y).toBeLessThan(LAYOUT_A.hudY);

    // Row count drives the cell width, so a two-seat grid differs from three.
    expect(fallback(LAYOUT_A, 1, 2)).not.toEqual(fallback(LAYOUT_A, 1, 3));
  });
});

// ── Clearing with the transient HUD (AC3) ──────────────────

describe('refreshHud clears the per-seat anchors with the transient HUD (red-phase)', () => {
  it.fails('publishes while the competitive scoreboard renders and clears when it goes away', () => {
    const state = competitiveState();
    const { renderer, scene } = createHarness(state);

    refreshHud(renderer as never);
    expect(anchorEntries(publishedAnchors(scene)).map(([id]) => id)).toEqual([0, 1, 2]);

    // Back to a single-player roster: no scoreboard row is rendered, so no seat
    // anchor may outlive the transient HUD refresh.
    state.players = undefined;
    refreshHud(renderer as never);

    const cleared = scene.hudSeatAnchors;
    expect(cleared === null || cleared === undefined || Object.keys(cleared).length === 0).toBe(true);
  });

  it.fails('republishes on a re-layout and leaves no stale geometry behind', () => {
    const state = competitiveState();
    const { renderer, scene } = createHarness(state);

    refreshHud(renderer as never);
    const before = anchorEntries(publishedAnchors(scene)).map(([, anchor]) => anchor);

    (scene as { layout: SceneLayout }).layout = LAYOUT_B;
    refreshHud(renderer as never);
    const after = publishedAnchors(scene);

    const fallback = seatFallback();
    for (const seatIndex of [0, 1, 2]) {
      expect(after[seatIndex]).not.toEqual(before[seatIndex]);
      expect(after[seatIndex]).toEqual(fallback(LAYOUT_B, seatIndex, 3));
    }
  });
});
