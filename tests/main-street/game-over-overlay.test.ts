/**
 * Main Street: Two-column Game Over overlay (epic MS-0MUWDL0V40041USM)
 *
 * Unit tests for `MainStreetOverlayContent.showGameOverOverlay` using the
 * mock-scene pattern established by `undo-challenge-warning.test.ts`. The
 * `@ui` overlay helpers are mocked so the layout, content and conventions can
 * be asserted without booting Phaser (the browser suite additionally drives
 * the real scene in the launcher distribution).
 *
 * Coverage:
 * - Two labelled columns ("Game State" / "Summary") with the title and
 *   end-reason headline spanning the top.
 * - Left column: per-player rows (label, coins, reputation, score) and
 *   failure/elimination badges, plus the run's challenges met — a per-seat
 *   breakdown in competitive mode, the single list in single-player.
 * - Right column: the retained summary (score breakdown, challenge details,
 *   difficulty selector, Play Again / Menu buttons).
 * - Overlay conventions: HUD parenting, 199/200/201 depths, overlayObjects.
 * - Panel fits the tested viewport; replay mode returns early.
 *
 * @module tests/main-street/game-over-overlay
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => {
  const buttons: Array<{
    label: string;
    depth: number;
    handlers: Record<string, Array<() => void>>;
    emit: (event: string) => void;
  }> = [];
  const backgrounds: Array<{ backdrop: { depth?: number }; box: { depth?: number; width?: number; height?: number } }> = [];
  return { buttons, backgrounds };
});

vi.mock('@ui', () => ({
  FONT_FAMILY: 'Arial',
  createOverlayBackground: vi.fn((_s: unknown, backdrop: unknown, box: unknown) => {
    ui.backgrounds.push({
      backdrop: backdrop as { depth?: number },
      box: box as { depth?: number; width?: number; height?: number },
    });
    return { objects: [], box: {} };
  }),
  createOverlayButton: vi.fn((_s: unknown, _x: number, _y: number, label: string, depth: number) => {
    const handlers: Record<string, Array<() => void>> = {};
    const obj = {
      label,
      depth,
      handlers,
      on: (event: string, cb: () => void) => {
        (handlers[event] ??= []).push(cb);
        return obj;
      },
      emit: (event: string) => handlers[event]?.forEach((cb) => cb()),
    };
    ui.buttons.push(obj);
    return obj;
  }),
  dismissOverlay: vi.fn(),
}));

const chartMock = vi.hoisted(() => ({
  calls: [] as Array<{ geometry: unknown; spec: unknown }>,
  deferred: null as null | (() => Promise<{ canvas: object; destroy: () => void }>),
}));
vi.mock('../../src/scenes/MainStreetStatsChart', () => ({
  createStatsChart: vi.fn((_scene: unknown, geometry: unknown, spec: unknown) => {
    chartMock.calls.push({ geometry, spec });
    if (chartMock.deferred) return chartMock.deferred();
    return Promise.resolve({ canvas: {}, destroy: vi.fn() });
  }),
  destroyStatsChart: vi.fn(),
}));

import { createOverlayBackground, createOverlayButton, dismissOverlay } from '@ui';
import { destroyStatsChart } from '../../src/scenes/MainStreetStatsChart';
import { MainStreetOverlayContent } from '../../src/scenes/MainStreetOverlayContent';
import type { TurnResult } from '../../src/MainStreetEngine';

interface TextMock {
  text: string;
  x: number;
  y: number;
  depth: number | null;
  handlers: Record<string, Array<() => void>>;
  setOrigin: () => TextMock;
  setDepth: (d: number) => TextMock;
  setInteractive: () => TextMock;
  setText: (s: string) => TextMock;
  on: (event: string, cb: () => void) => TextMock;
  emit: (event: string) => void;
}

function makeText(text: string, x: number, y: number): TextMock {
  const handlers: Record<string, Array<() => void>> = {};
  const obj: TextMock = {
    text,
    x,
    y,
    depth: null,
    handlers,
    setOrigin: () => obj,
    setDepth: (d: number) => { obj.depth = d; return obj; },
    setInteractive: () => obj,
    setText: (s: string) => { obj.text = s; return obj; },
    on: (event: string, cb: () => void) => { (handlers[event] ??= []).push(cb); return obj; },
    emit: (event: string) => handlers[event]?.forEach((cb) => cb()),
  };
  return obj;
}

interface RectMock {
  width: number;
  height: number;
  depth: number | null;
  setStrokeStyle: () => RectMock;
  setOrigin: () => RectMock;
  setDepth: (d: number) => RectMock;
}

function makeRect(width: number, height: number): RectMock {
  const obj: RectMock = {
    width,
    height,
    depth: null,
    setStrokeStyle: () => obj,
    setOrigin: () => obj,
    setDepth: (d: number) => { obj.depth = d; return obj; },
  };
  return obj;
}

/** Minimal scene mock backed by a real overlay-content instance. */
function makeScene(state: Record<string, unknown>) {
  const texts: TextMock[] = [];
  const rectangles: RectMock[] = [];
  const hudAdded: unknown[] = [];
  const scene: Record<string, unknown> = {
    layout: { gameW: 1280, gameH: 720 },
    overlayObjects: [],
    uiPhase: 'market',
    replayMode: false,
    selectedDifficulty: 'Medium',
    campaign: undefined,
    refreshAll: vi.fn(),
    scene: { restart: vi.fn() },
    sceneRestartGeneration: 0,
    msAnimator: { animateGameOver: vi.fn() },
    hudContainer: { add: vi.fn((o: unknown) => hudAdded.push(o)) },
    add: {
      text: vi.fn((x: number, y: number, text: string) => {
        const obj = makeText(text, x, y);
        texts.push(obj);
        return obj;
      }),
      rectangle: vi.fn((_x: number, _y: number, width: number, height: number) => {
        const obj = makeRect(width, height);
        rectangles.push(obj);
        return obj;
      }),
    },
    state: {
      config: { challengeBonusPoints: 10 },
      challengesCompleted: [],
      activeChallenges: [],
      resourceBank: { coins: 0, reputation: 0 },
      finalScore: 0,
      endReason: null,
      ...state,
    },
  };
  return { scene, texts, rectangles, hudAdded };
}

function winResult(finalScore = 100): TurnResult {
  return {
    income: {
      total: 0,
      breakdown: [],
      handSynergyTotal: 0,
      phaseBreakdown: { perSlotBreakdown: [], handSynergyTotal: 0 },
    },
    incident: null,
    incidentCoinChange: 0,
    incidentRepChange: 0,
    finalScore,
    gameResult: 'win',
    newlyCompletedChallenges: [],
    choicePending: false,
  };
}

/** Minimal competitive PlayerRecord for the left column. */
function player(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    playerId: 0,
    coins: 100,
    reputation: 10,
    score: 0,
    hand: [],
    staffCards: [],
    actionBudget: 1,
    controller: 'human',
    eliminated: false,
    ...overrides,
  };
}

describe('MainStreetOverlayContent.showGameOverOverlay (three-column)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.buttons.length = 0;
    ui.backgrounds.length = 0;
    chartMock.calls.length = 0;
    chartMock.deferred = null;
  });

  it('renders the two labelled columns, title and headline in single-player', () => {
    const { scene, texts } = makeScene({
      endReason: 'score_threshold',
      resourceBank: { coins: 42, reputation: 7 },
      finalScore: 123,
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult(123));

    const rendered = texts.map((t) => t.text);
    expect(rendered).toContain('You Win!');
    expect(rendered).toContain('Score threshold reached');
    expect(rendered).toContain('Game State');
    expect(rendered).toContain('Summary');
    // Single-player synthesises the sole row from the shared wallet.
    expect(rendered).toContain('You: 42c  7r  123pt');
  });

  it('retains the right-column summary and bottom-anchored controls', () => {
    const { scene, texts } = makeScene({
      endReason: 'score_threshold',
      resourceBank: { coins: 10, reputation: 4 },
      activeChallenges: [
        { challenge: { id: 'ch-1', title: 'First challenge' }, completed: true },
        { challenge: { id: 'ch-2', title: 'Second challenge' }, completed: false },
      ],
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult(200));

    const breakdown = texts.find(
      (t) => t.text.includes('Coins:') && t.text.includes('Final Score:'),
    );
    expect(breakdown).toBeDefined();
    const rendered = texts.map((t) => t.text);
    expect(rendered).toContain('Challenge Details:');
    expect(rendered).toContain('Met: 1 / 2');
    expect(rendered.some((t) => t.startsWith('Difficulty:'))).toBe(true);
    expect(ui.buttons.map((b) => b.label)).toEqual(
      expect.arrayContaining(['[ Play Again ]', '[ Menu ]']),
    );
    expect(ui.buttons.every((b) => b.depth === 201)).toBe(true);
  });

  it('renders the final cash-at-end-of-turn line in the Summary column', () => {
    const { scene, texts } = makeScene({
      endReason: 'score_threshold',
      resourceBank: { coins: 55, reputation: 6 },
      turnStatsHistory: [
        { turn: 1, coins: 20, reputation: 2, score: 0, profit: 5, businesses: 1, staff: 0 },
        { turn: 2, coins: 55, reputation: 6, score: 10, profit: 35, businesses: 2, staff: 1 },
      ],
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    const rendered = texts.map((t) => t.text);
    expect(rendered).toContain('Cash at end of turn: 55');
    // Existing Summary content is retained alongside the new line.
    expect(rendered.some((t) => t.includes('Coins:') && t.includes('Final Score:'))).toBe(true);
  });

  it('falls back to the live wallet for the cash line when the history is empty', () => {
    const { scene, texts } = makeScene({
      endReason: 'score_threshold',
      resourceBank: { coins: 42, reputation: 3 },
      turnStatsHistory: [],
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    expect(texts.map((t) => t.text)).toContain('Cash at end of turn: 42');
  });

  it('renders a third Stats column of five labelled graphs', () => {
    const { scene, texts } = makeScene({
      endReason: 'score_threshold',
      resourceBank: { coins: 55, reputation: 6 },
      turnStatsHistory: [
        { turn: 1, coins: 20, reputation: 2, score: 0, profit: 5, businesses: 1, staff: 0 },
        { turn: 2, coins: 55, reputation: 6, score: 10, profit: 35, businesses: 2, staff: 1 },
      ],
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    const rendered = texts.map((t) => t.text);
    // Three column headers.
    expect(rendered).toContain('Game State');
    expect(rendered).toContain('Summary');
    expect(rendered).toContain('Stats');

    // Five charts, in the requested order, each fed from the series model.
    expect(chartMock.calls).toHaveLength(5);
    const titles = chartMock.calls.map((c) => (c.spec as { title: string }).title);
    expect(titles).toEqual([
      'Profit per turn',
      'Cash at end of turn',
      'Businesses at end of turn',
      'Staff at end of turn',
      'Reputation at end of turn',
    ]);
    const cashSpec = chartMock.calls[1]!.spec as { labels: string[]; values: number[] };
    expect(cashSpec.labels).toEqual(['1', '2']);
    expect(cashSpec.values).toEqual([20, 55]);
  });

  it('links the Summary to the Stats column without mutating state', () => {
    const history = [
      { turn: 1, coins: 30, reputation: 3, score: 0, profit: 10, businesses: 1, staff: 0 },
    ];
    const { scene, texts, rectangles } = makeScene({
      endReason: 'score_threshold',
      turnStatsHistory: history,
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    const link = texts.find((t) => t.text === '[ View detailed stats ]');
    expect(link).toBeDefined();
    const stateBefore = JSON.parse(JSON.stringify((scene as { state: unknown }).state));

    link!.emit('pointerdown');

    // A static focus frame is added (no animation), state is untouched.
    expect(rectangles).toHaveLength(1);
    expect(rectangles[0]!.depth).toBe(201);
    expect(JSON.parse(JSON.stringify((scene as { state: unknown }).state))).toEqual(stateBefore);
  });

  it('fits three columns inside 1280×720 for a rich 12-turn history', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      turn: i + 1,
      coins: 100 + i * 10,
      reputation: 2 + i,
      score: i * 5,
      profit: 10,
      businesses: 1 + (i % 3),
      staff: i % 2,
    }));
    const { scene } = makeScene({
      endReason: 'score_threshold',
      resourceBank: { coins: 220, reputation: 13 },
      turnStatsHistory: history,
      activeChallenges: [
        { challenge: { id: 'c1', title: 'One' }, completed: true },
        { challenge: { id: 'c2', title: 'Two' }, completed: false },
        { challenge: { id: 'c3', title: 'Three' }, completed: false },
      ],
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    const box = ui.backgrounds[0].box as { width: number; height: number };
    expect(box.width).toBeLessThanOrEqual(1280);
    expect(box.height).toBeLessThanOrEqual(720);
    const panelTop = 720 / 2 - box.height / 2;
    expect(panelTop).toBeGreaterThanOrEqual(0);
    expect(panelTop + box.height).toBeLessThanOrEqual(720);

    // Every chart sits inside the viewport.
    for (const call of chartMock.calls) {
      const g = call.geometry as { x: number; width: number };
      expect(g.x).toBeGreaterThan(0);
      expect(g.x + g.width).toBeLessThanOrEqual(1280);
    }
  });

  it('fits three columns inside 1280×720 for an empty history', () => {
    const { scene } = makeScene({
      endReason: 'score_threshold',
      resourceBank: { coins: 0, reputation: 0 },
      turnStatsHistory: [],
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    const box = ui.backgrounds[0].box as { width: number; height: number };
    expect(box.width).toBeLessThanOrEqual(1280);
    expect(box.height).toBeLessThanOrEqual(720);
    expect(chartMock.calls).toHaveLength(5);
  });

  it('lists every competitive seat with failure/elimination badges and names the failing seat', () => {
    const { scene, texts } = makeScene({
      endReason: 'bankruptcy',
      turn: 2,
      resourceBank: { coins: 0, reputation: 0 },
      players: [
        player({ playerId: 0, coins: -5, reputation: 10, score: 50 }),
        player({ playerId: 1, coins: 100, reputation: 10, score: 20, controller: 'ai', eliminated: true }),
      ],
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    const rendered = texts.map((t) => t.text);
    expect(rendered).toContain('You: -5c  10r  50pt  — Bankrupt');
    expect(rendered).toContain('AI 1: 100c  10r  20pt  — Eliminated');
    // Headline prefers the human seat for a per-seat failure.
    expect(rendered).toContain('Bankruptcy — You');
  });

  it('renders a per-seat challenge breakdown in competitive mode', () => {
    const { scene, texts } = makeScene({
      endReason: 'score_threshold',
      turn: 2,
      players: [
        player({ playerId: 0, coins: 100, reputation: 10, score: 40 }),
        player({ playerId: 1, coins: 80, reputation: 10, score: 20, controller: 'ai' }),
      ],
      activeChallenges: [
        { challenge: { id: 'ch-deep-pockets', title: 'Deep Pockets' }, completed: true, completedBySeatId: 1 },
        { challenge: { id: 'ch-beloved-mayor', title: 'Beloved Mayor' }, completed: true, completedBySeatId: 0 },
      ],
      challengesCompleted: ['ch-deep-pockets', 'ch-beloved-mayor'],
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    const rendered = texts.map((t) => t.text);
    // Each seat is credited only with the challenges it personally completed.
    expect(rendered).toContain('You: Beloved Mayor');
    expect(rendered).toContain('AI 1: Deep Pockets');
    // The run-global totals are still shown.
    expect(rendered).toContain('Met: 2 / 2');
    // The human must never be shown the AI seat's completion.
    expect(rendered.some((t) => t.includes('Deep Pockets') && t.startsWith('You:')))
      .toBe(false);
  });

  it('shows an em dash for a competitive seat with no completions', () => {
    const { scene, texts } = makeScene({
      endReason: 'score_threshold',
      turn: 2,
      players: [
        player({ playerId: 0, coins: 100, reputation: 10, score: 40 }),
        player({ playerId: 1, coins: 80, reputation: 10, score: 20, controller: 'ai' }),
      ],
      activeChallenges: [
        { challenge: { id: 'ch-beloved-mayor', title: 'Beloved Mayor' }, completed: true, completedBySeatId: 0 },
      ],
      challengesCompleted: ['ch-beloved-mayor'],
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    const rendered = texts.map((t) => t.text);
    expect(rendered).toContain('You: Beloved Mayor');
    expect(rendered).toContain('AI 1: \u2014');
  });

  it('retains the single-list challenge format in single-player mode', () => {
    const { scene, texts } = makeScene({
      endReason: 'score_threshold',
      activeChallenges: [
        { challenge: { id: 'ch-1', title: 'First challenge' }, completed: true },
        { challenge: { id: 'ch-2', title: 'Second challenge' }, completed: false },
      ],
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    const rendered = texts.map((t) => t.text);
    expect(rendered).toContain('\u2713  First challenge');
    expect(rendered).toContain('\u2717  Second challenge');
    // No per-seat labels leak into the single-player presentation (the player
    // row `You: <coins>c ...` is distinct from the per-seat `You: <titles>`).
    expect(rendered.some((t) => /^(You|AI 1): (First|Second) challenge/.test(t)))
      .toBe(false);
  });

  it('parents every element into hudContainer at depth 201 and uses the 199/200 backdrop convention', () => {
    const { scene, texts, hudAdded } = makeScene({ endReason: null });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    for (const text of texts) expect(text.depth).toBe(201);
    for (const text of texts) expect(hudAdded).toContain(text);
    expect(createOverlayBackground).toHaveBeenCalledTimes(1);
    expect(ui.backgrounds[0].backdrop.depth).toBe(199);
    expect(ui.backgrounds[0].box.depth).toBe(200);
    expect(createOverlayButton).toHaveBeenCalledTimes(2);
    expect((scene.overlayObjects as unknown[]).length).toBeGreaterThan(0);
  });

  it('fits the panel within the tested viewport for a populated run', () => {
    const { scene } = makeScene({
      endReason: 'score_threshold',
      campaign: { unlockedTiers: ['tier-1'], totalRuns: 5, totalWins: 2, highestScore: 900, persistentReputation: 40, milestoneHistory: [] },
      resourceBank: { coins: 123, reputation: 40 },
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult(), ['tier-2']);

    const box = ui.backgrounds[0].box;
    const layout = scene.layout as { gameW: number; gameH: number };
    const panelTop = layout.gameH / 2 - (box.height ?? 0) / 2;
    expect(box.width).toBeGreaterThan(600);
    expect(panelTop).toBeGreaterThanOrEqual(0);
    expect(panelTop + (box.height ?? 0)).toBeLessThanOrEqual(layout.gameH);
  });

  it('returns early in replay mode without rendering anything', () => {
    const { scene } = makeScene({ endReason: 'bankruptcy' });
    scene.replayMode = true;
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    expect((scene.overlayObjects as unknown[])).toHaveLength(0);
    expect((scene.add as { text: ReturnType<typeof vi.fn> }).text).not.toHaveBeenCalled();
  });

  it('offers a Continue Solo action for a last-standing win and wires it to the turn controller', () => {
    const continueFn = vi.fn();
    const { scene } = makeScene({ endReason: 'last_standing' });
    (scene as Record<string, unknown>).msTurnController = {
      continueCompetitiveLastStanding: continueFn,
    };
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    const labels = ui.buttons.map((b) => b.label);
    expect(labels).toContain('[ Continue Solo ]');
    expect(labels).toEqual(expect.arrayContaining(['[ Play Again ]', '[ Menu ]']));

    ui.buttons.find((b) => b.label === '[ Continue Solo ]')?.emit('pointerdown');
    expect(continueFn).toHaveBeenCalledTimes(1);
  });

  it('does not offer Continue Solo when no last-standing offer is open', () => {
    const { scene } = makeScene({ endReason: 'bankruptcy' });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());
    expect(ui.buttons.map((b) => b.label)).not.toContain('[ Continue Solo ]');
  });

  it('offers an Enter Endless Mode action at the threshold and wires it to the turn controller', () => {
    const continueFn = vi.fn();
    const { scene } = makeScene({ endReason: 'score_threshold_continue' });
    (scene as Record<string, unknown>).msTurnController = {
      continueEndlessMode: continueFn,
    };
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    const labels = ui.buttons.map((b) => b.label);
    expect(labels).toContain('[ Enter Endless Mode ]');
    expect(labels).toEqual(expect.arrayContaining(['[ Play Again ]', '[ Menu ]']));

    ui.buttons.find((b) => b.label === '[ Enter Endless Mode ]')?.emit('pointerdown');
    expect(continueFn).toHaveBeenCalledTimes(1);
  });

  it('does not offer Enter Endless Mode for any other end reason', () => {
    const endReasons = ['bankruptcy', 'score_threshold', 'last_standing', null] as const;
    for (const endReason of endReasons) {
      ui.buttons.length = 0;
      const { scene } = makeScene({ endReason });
      new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());
      expect(ui.buttons.map((b) => b.label)).not.toContain('[ Enter Endless Mode ]');
    }
  });

  // ── Play Again teardown (MS-0MW6H5R340033GJJ) ──────────────

  it('tears down the full overlay array exactly once, clears it, then restarts', () => {
    const { scene } = makeScene({ endReason: 'score_threshold' });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());

    const playAgain = ui.buttons.find((b) => b.label === '[ Play Again ]');
    expect(playAgain).toBeDefined();

    const overlayArrayRef = (scene as any).overlayObjects as unknown[];
    const overlayCountBefore = overlayArrayRef.length;
    expect(overlayCountBefore).toBeGreaterThan(0);

    // Capture the overlay array exactly as `dismissOverlay` sees it, and the
    // array length at the moment `restart()` is requested.
    let arrayAtDismiss: unknown[] = [];
    vi.mocked(dismissOverlay).mockImplementationOnce((objects: unknown[]) => {
      arrayAtDismiss = objects;
    });
    let overlayCountAtRestart = -1;
    vi.mocked((scene as any).scene.restart).mockImplementationOnce(() => {
      overlayCountAtRestart = ((scene as any).overlayObjects as unknown[]).length;
    });

    playAgain!.emit('pointerdown');

    // AC3: dismissOverlay received the full overlay-object array...
    const dismissed = arrayAtDismiss;
    expect(dismissed).toBe(overlayArrayRef);
    expect(dismissed).toHaveLength(overlayCountBefore);
    // ...with no duplicate object (so each is destroyed exactly once).
    expect(new Set(dismissed).size).toBe(overlayCountBefore);
    // The bookkeeping array is emptied before the restart is requested.
    expect(overlayCountAtRestart).toBe(0);
    expect((scene as any).overlayObjects).toEqual([]);
    expect((scene as any).scene.restart).toHaveBeenCalledTimes(1);
  });

  it('does not double-destroy when the shared destroy loop throws mid-teardown', () => {
    const { scene } = makeScene({ endReason: 'score_threshold' });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());
    const playAgain = ui.buttons.find((b) => b.label === '[ Play Again ]');

    // Simulate a partially failed shared loop (e.g. one object was already
    // destroyed by a late callback).
    vi.mocked(dismissOverlay).mockImplementationOnce(() => {
      throw new Error('already destroyed');
    });

    expect(() => playAgain!.emit('pointerdown')).not.toThrow();
    expect((scene as any).overlayObjects).toEqual([]);
    expect((scene as any).scene.restart).toHaveBeenCalledTimes(1);
  });

  it('discards a stats-chart handle that resolves after a scene restart', async () => {
    const { scene } = makeScene({ endReason: 'score_threshold' });
    const resolvers: Array<(handle: { canvas: object; destroy: () => void }) => void> = [];
    chartMock.deferred = () =>
      new Promise<{ canvas: object; destroy: () => void }>((resolve) => {
        resolvers.push(resolve);
      });

    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());
    expect(resolvers).toHaveLength(5);

    // Simulate `scene.restart()`: createScene bumps the generation and clears
    // the overlay bookkeeping before the pending charts resolve.
    (scene as any).sceneRestartGeneration += 1;
    (scene as any).overlayObjects = [];

    for (const resolve of resolvers) resolve({ canvas: {}, destroy: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // AC2: every late handle is destroyed instead of attached to the new scene.
    expect(vi.mocked(destroyStatsChart)).toHaveBeenCalledTimes(5);
    expect((scene as any).overlayObjects).toHaveLength(0);
  });

  it('attaches stats-chart handles when the scene has not restarted (control)', async () => {
    const { scene } = makeScene({ endReason: 'score_threshold' });
    const resolvers: Array<(handle: { canvas: object; destroy: () => void }) => void> = [];
    chartMock.deferred = () =>
      new Promise<{ canvas: object; destroy: () => void }>((resolve) => {
        resolvers.push(resolve);
      });

    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());
    const before = ((scene as any).overlayObjects as unknown[]).length;

    for (const resolve of resolvers) resolve({ canvas: {}, destroy: vi.fn() });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(((scene as any).overlayObjects as unknown[]).length).toBe(before + 5);
    expect(vi.mocked(destroyStatsChart)).not.toHaveBeenCalled();
  });
});
