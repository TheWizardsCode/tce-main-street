/**
 * Main Street: Competitive closing presentation tests
 *
 * Bug MS-0MUVUPRXZ0030LUD ("End Turn Phase is missing in AI game"). In
 * competitive mode the shared closing (Income → Incident → EndCheck) ran
 * silently; the scene jumped straight to the next day. These tests pin the
 * presentation contract added to
 * `src/scenes/MainStreetTurnControllerCompetitive.ts`:
 *
 *   AC1 income feedback (shared total)
 *   AC2 incident reveal (name + deltas)
 *   AC3 instruction text reflects the closing progression
 *   AC4 non-blocking and bounded — the day always advances, including reduced
 *       motion / replay / headless
 *   AC5 single-player path untouched (asserted at the end)
 */
import { describe, expect, it } from 'vitest';

import type { TurnResult } from '../../src/MainStreetEngine';
import { MainStreetTurnController } from '../../src/scenes/MainStreetTurnController';
import {
  COMPETITIVE_CLOSING_HOLD_MS,
  competitiveClosingSummary,
  driveAiSeatsUntilClosing,
  endCompetitiveTurnDay,
  endHumanMarketPhase,
  presentCompetitiveClosing,
  startCompetitiveDay,
} from '../../src/scenes/MainStreetTurnControllerCompetitive';
import {
  createCompetitiveState,
  setupMainStreetGame,
  type CompetitiveOpponentConfig,
  type MainStreetState,
} from '../../src/MainStreetState';

const OPPONENTS: CompetitiveOpponentConfig[] = [{ strategy: 'BankingGreedy', difficulty: 'Hard' }];

// ── Fixtures ──────────────────────────────────────────────────────────

function makeIncome(total: number): TurnResult['income'] {
  return {
    total,
    breakdown: [],
    handSynergyTotal: 0,
    phaseBreakdown: {
      perSlotBreakdown: [
        {
          slotIndex: 0,
          businessName: 'Cafe',
          baseIncome: total,
          synergyBonus: 0,
          repBonus: 0,
          eventDeltas: [],
          upcomingDeltas: [],
        },
      ],
      handSynergyTotal: 0,
    },
  };
}

function makeResult(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    income: makeIncome(12),
    incident: null,
    incidentCoinChange: 0,
    incidentRepChange: 0,
    gameResult: 'playing',
    finalScore: 0,
    newlyCompletedChallenges: [],
    choicePending: false,
    ...overrides,
  };
}

interface PresentationHarness {
  scene: any;
  instructions: string[];
  incomeCalls: Array<{ phaseData: any[]; options: any }>;
  incidentCalls: any[];
}

/** Lightweight fake scene recording the presentation surface under test. */
function makeHarness(overrides: Record<string, unknown> = {}): PresentationHarness {
  const instructions: string[] = [];
  const incomeCalls: Array<{ phaseData: any[]; options: any }> = [];
  const incidentCalls: any[] = [];
  const scene: any = {
    replayMode: false,
    settingsPanel: { reducedMotion: false },
    instructionText: { setText: (t: string) => instructions.push(t) },
    layout: { gameW: 800, gameH: 600 },
    msRenderer: { getFrontIncidentCardCenter: () => ({ x: 111, y: 222 }) },
    msAnimator: {
      animateIncomePhases: (phaseData: any[], options: any) => {
        incomeCalls.push({ phaseData, options });
      },
      animateIncidentReveal: (params: any) => {
        incidentCalls.push(params);
      },
    },
    ...overrides,
  };
  return { scene, instructions, incomeCalls, incidentCalls };
}

/** Fake Phaser clock: `now` advances on schedule; `runAll` drains the queue. */
function makeFakeClock(): {
  now: number;
  delayedCall: (ms: number, cb: () => void) => void;
  runAll: () => void;
  delays: number[];
} {
  const queue: Array<() => void> = [];
  const clock = {
    now: 0,
    delays: [] as number[],
    delayedCall(ms: number, cb: () => void) {
      clock.now += ms;
      clock.delays.push(ms);
      queue.push(cb);
    },
    runAll() {
      let guard = 0;
      while (queue.length > 0) {
        if (guard++ > 10_000) throw new Error('fake clock runaway');
        queue.shift()!();
      }
    },
  };
  return clock;
}

const asCtx = (scene: any): any => ({ scene });
const lastInstruction = (instructions: string[]): string => instructions[instructions.length - 1];

// ── AC1/AC2: closing summary text ────────────────────────────────────

describe('competitiveClosingSummary (AC1/AC2)', () => {
  it('summarises income and a resolved incident', () => {
    const result = makeResult({ incident: { id: 'inc-1', name: 'Roadworks' } as any });
    expect(competitiveClosingSummary(result)).toBe('Income: +12 coins | Incident: Roadworks');
  });

  it('omits zero income and reports an incident-only closing', () => {
    expect(competitiveClosingSummary(makeResult({ income: makeIncome(0) }))).toBe('');
    expect(
      competitiveClosingSummary(
        makeResult({ income: null, incident: { id: 'inc-2', name: 'Flood' } as any }),
      ),
    ).toBe('Incident: Flood');
  });
});

// ── AC1/AC3: income feedback + progression ───────────────────────────

describe('presentCompetitiveClosing — income feedback (AC1/AC3)', () => {
  it('shows the shared income total and the closing progression text', () => {
    const h = makeHarness();
    let completed = 0;

    presentCompetitiveClosing(asCtx(h.scene), makeResult(), () => completed++);

    expect(h.instructions[0]).toBe('Resolving end-of-turn effects...');
    expect(h.instructions).toContain('Income: +12 coins');
    expect(h.instructions).toContain('End of turn complete.');
    expect(lastInstruction(h.instructions)).toBe('End of turn complete.');
    // Condensed/bounded: the long coin-grid choreography is deliberately not run.
    expect(h.incomeCalls).toHaveLength(0);
    expect(completed).toBe(1);
  });

  it('handles a closing with neither income nor incident without stalling', () => {
    const h = makeHarness();
    let completed = 0;

    presentCompetitiveClosing(asCtx(h.scene), makeResult({ income: null }), () => completed++);

    expect(h.instructions[0]).toBe('Resolving end-of-turn effects...');
    expect(lastInstruction(h.instructions)).toBe('End of turn complete.');
    expect(completed).toBe(1);
  });
});

// ── AC2: incident reveal ─────────────────────────────────────────────

describe('presentCompetitiveClosing — incident reveal (AC2)', () => {
  it('reveals the incident and advances only after the reveal completes', () => {
    const h = makeHarness();
    const result = makeResult({
      incident: { id: 'inc-9', name: 'Roadworks' } as any,
      incidentCoinChange: -4,
      incidentRepChange: -1,
    });
    let completed = 0;

    presentCompetitiveClosing(asCtx(h.scene), result, () => completed++);

    expect(h.incidentCalls).toHaveLength(1);
    expect(h.incidentCalls[0]).toMatchObject({
      cardId: 'inc-9',
      incidentName: 'Roadworks',
      coinChange: -4,
      repChange: -1,
      from: { x: 111, y: 222 },
    });
    // Bounded: the day must not advance until the reveal's onComplete fires.
    expect(completed).toBe(0);
    h.incidentCalls[0].onComplete();
    expect(completed).toBe(1);
    expect(lastInstruction(h.instructions)).toBe('End of turn complete.');
  });

  it('skips the reveal under reduced motion but keeps the incident text (AC4)', () => {
    const h = makeHarness({ settingsPanel: { reducedMotion: true } });
    const result = makeResult({ incident: { id: 'inc-3', name: 'Fire' } as any });
    let completed = 0;

    presentCompetitiveClosing(asCtx(h.scene), result, () => completed++);

    expect(h.incomeCalls).toHaveLength(0);
    expect(h.incidentCalls).toHaveLength(0);
    expect(h.instructions.some((t) => t.includes('Income: +12 coins'))).toBe(true);
    expect(h.instructions.some((t) => t.includes('Incident: Fire'))).toBe(true);
    expect(lastInstruction(h.instructions)).toBe('End of turn complete.');
    expect(completed).toBe(1);
  });
});

// ── AC4: bounded / non-blocking ──────────────────────────────────────

describe('presentCompetitiveClosing — bounded and non-blocking (AC4)', () => {
  it('advances immediately with no animation calls in replay/headless', () => {
    const h = makeHarness({ replayMode: true });
    let completed = 0;

    presentCompetitiveClosing(
      asCtx(h.scene),
      makeResult({ incident: { id: 'i', name: 'X' } as any }),
      () => completed++,
    );

    expect(h.incomeCalls).toHaveLength(0);
    expect(h.incidentCalls).toHaveLength(0);
    expect(completed).toBe(1);
  });

  it('holds briefly after the closing before advancing (real clock present)', () => {
    const clock = makeFakeClock();
    const h = makeHarness({ time: clock });
    let completed = 0;

    presentCompetitiveClosing(asCtx(h.scene), makeResult({ incident: null }), () => completed++);

    // Waiting on the condensed end-of-turn hold, not yet advanced.
    expect(completed).toBe(0);
    expect(clock.delays).toContain(COMPETITIVE_CLOSING_HOLD_MS);
    clock.runAll();
    expect(completed).toBe(1);
  });

  it('invokes onComplete exactly once even when the reveal is skipped', () => {
    const h = makeHarness({ settingsPanel: { reducedMotion: true } });
    const completions: number[] = [];
    presentCompetitiveClosing(asCtx(h.scene), makeResult(), () => completions.push(1));
    expect(completions).toHaveLength(1);
  });
});

// ── Wiring: endCompetitiveTurnDay presents before the next day ───────

/** Non-blocking scene surface consumed by the competitive end-turn path. */
function makeEndTurnScene(state: MainStreetState, instructions: string[]): any {
  return {
    state,
    uiPhase: 'market',
    activeSeatId: 0,
    celebratedChallengeIds: new Set<string>(),
    pendingApplicant: null,
    justMovedHandCardId: null,
    hintUsedThisTurn: false,
    hintedCardId: null,
    hintedSlotIndex: null,
    instructionText: { setText: (t: string) => instructions.push(t) },
    cardSvgLoadPromise: new Promise<void>(() => {}),
    prewarmVisibleCardTextures: () => {},
    refreshAll: () => {},
    refreshActionButtons: () => {},
    refreshUndoRedoButtons: () => {},
    layout: { gameW: 800, gameH: 600 },
    msRenderer: { getFrontIncidentCardCenter: () => ({ x: 0, y: 0 }) },
    // Replay/reduced motion = no animation, deterministic synchronous advance;
    // still records the closing presentation text.
    replayMode: true,
    settingsPanel: { reducedMotion: true },
    msAnimator: { animateWeekBanner: () => {} },
    tutorialController: { isActive: false },
    msLifecycleManager: {
      isTutorialActionAllowed: () => ({ allowed: true }),
      onTutorialActionComplete: () => {},
    },
    undoManager: { clear: () => {}, canUndo: () => false, canRedo: () => false },
  };
}

describe('endCompetitiveTurnDay — closing is presented before the next day', () => {
  it('shows the closing progression then advances the shared day', () => {
    const state = createCompetitiveState({
      seed: 'closing-presentation',
      playerCount: 2,
      opponents: OPPONENTS,
    });
    const instructions: string[] = [];
    const scene = makeEndTurnScene(state, instructions);
    let started = 0;
    let gameOver: TurnResult | null = null;
    const tcCtx: any = {
      scene,
      startTurnPhase: () => { started += 1; },
      handleGameOver: (r: TurnResult) => { gameOver = r; },
      onSaveCheckpoint: () => {},
    };

    // Prepare a real shared day and stop at the closing, then end the day
    // through the production scene entry point.
    startCompetitiveDay(state);
    endHumanMarketPhase(state);
    driveAiSeatsUntilClosing(state);
    endCompetitiveTurnDay(tcCtx);

    // AC4: bounded — exactly one continuation path is taken.
    expect(started + (gameOver ? 1 : 0)).toBe(1);
    if (started === 1) {
      // AC3: progression text is shown before the day advances.
      expect(instructions[0]).toBe('AI opponents are taking their turns...');
      expect(instructions).toContain('Resolving end-of-turn effects...');
      expect(instructions).toContain('End of turn complete.');
    }
  }, 30_000);

  it('single-player endTurn never enters the competitive closing presentation', () => {
    const state = setupMainStreetGame({ seed: 'sp-closing-presentation' });
    const instructions: string[] = [];
    const scene = makeEndTurnScene(state, instructions);
    const controller = new MainStreetTurnController(scene);
    (controller as any).finishTurnPresentation = () => {};

    // Sanity: the state is single-player, so the competitive branch is inert.
    expect(state.players ?? []).toHaveLength(0);
    controller.startTurnPhase();
    controller.endTurn();
    expect(instructions).not.toContain('AI opponents are taking their turns...');
    expect(instructions).not.toContain('End of turn complete.');
  }, 30_000);
});
