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
 *   failure/elimination badges, plus the run's challenges met.
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

import { createOverlayBackground, createOverlayButton } from '@ui';
import { MainStreetOverlayContent } from '../../src/scenes/MainStreetOverlayContent';
import type { TurnResult } from '../../src/MainStreetEngine';

interface TextMock {
  text: string;
  x: number;
  y: number;
  depth: number | null;
  setOrigin: () => TextMock;
  setDepth: (d: number) => TextMock;
  setInteractive: () => TextMock;
  setText: (s: string) => TextMock;
  on: (event: string, cb: () => void) => TextMock;
}

function makeText(text: string, x: number, y: number): TextMock {
  const obj: TextMock = {
    text,
    x,
    y,
    depth: null,
    setOrigin: () => obj,
    setDepth: (d: number) => { obj.depth = d; return obj; },
    setInteractive: () => obj,
    setText: (s: string) => { obj.text = s; return obj; },
    on: () => obj,
  };
  return obj;
}

/** Minimal scene mock backed by a real overlay-content instance. */
function makeScene(state: Record<string, unknown>) {
  const texts: TextMock[] = [];
  const hudAdded: unknown[] = [];
  const scene: Record<string, unknown> = {
    layout: { gameW: 1280, gameH: 720 },
    overlayObjects: [],
    uiPhase: 'market',
    replayMode: false,
    selectedDifficulty: 'Medium',
    campaign: undefined,
    refreshAll: vi.fn(),
    msAnimator: { animateGameOver: vi.fn() },
    hudContainer: { add: vi.fn((o: unknown) => hudAdded.push(o)) },
    add: {
      text: vi.fn((x: number, y: number, text: string) => {
        const obj = makeText(text, x, y);
        texts.push(obj);
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
  return { scene, texts, hudAdded };
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

describe('MainStreetOverlayContent.showGameOverOverlay (two-column)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.buttons.length = 0;
    ui.backgrounds.length = 0;
  });

  it('renders the two labelled columns, title and headline in single-player', () => {
    const { scene, texts } = makeScene({
      endReason: 'all_challenges',
      resourceBank: { coins: 42, reputation: 7 },
      finalScore: 123,
    });
    new MainStreetOverlayContent(scene).showGameOverOverlay(winResult(123));

    const rendered = texts.map((t) => t.text);
    expect(rendered).toContain('You Win!');
    expect(rendered).toContain('All challenges completed');
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
    const endReasons = ['bankruptcy', 'score_threshold', 'last_standing', 'all_challenges', null] as const;
    for (const endReason of endReasons) {
      ui.buttons.length = 0;
      const { scene } = makeScene({ endReason });
      new MainStreetOverlayContent(scene).showGameOverOverlay(winResult());
      expect(ui.buttons.map((b) => b.label)).not.toContain('[ Enter Endless Mode ]');
    }
  });
});
