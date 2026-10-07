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
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The shared closing primitive (extracted by MS-0MUYFX7Q2004JQ5R) is the
// contract under test below. It does not exist until that extraction lands, so
// the wrapper is a call-through no-op in the red phase and forwards to the real
// implementation once it is exported. Wrapping rather than replacing keeps the
// pre-existing competitive tests exercising the real behaviour.
vi.mock('../../src/scenes/MainStreetTurnControllerAnimation', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/scenes/MainStreetTurnControllerAnimation')
  >();
  return {
    ...actual,
    presentTurnClosing: vi.fn(
      (actual as unknown as { presentTurnClosing?: (...args: unknown[]) => void })
        .presentTurnClosing,
    ),
  };
});

import type { TurnResult } from '../../src/MainStreetEngine';
import * as AnimationModule from '../../src/scenes/MainStreetTurnControllerAnimation';
import { finishTurnPresentation } from '../../src/scenes/MainStreetTurnControllerTurnFlow';
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

/**
 * The shared presentation primitive under test. Absent until the extraction
 * item (MS-0MUYFX7Q2004JQ5R) exports it, hence the `unknown` cast — the real
 * module type does not carry the export yet.
 */
const presentTurnClosing = (
  AnimationModule as unknown as { presentTurnClosing: ReturnType<typeof vi.fn> }
).presentTurnClosing;

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

// ── Shared closing presentation primitive ─────────────────────────────
//
// Test-first contract for the single shared end-of-turn presentation
// primitive (MS-0MUYFX6ER000BLP3 → extracted by MS-0MUYFX7Q2004JQ5R).
//
// `finishTurnPresentation` (single-player) and `presentCompetitiveClosing`
// (competitive) share this primitive. The extraction
// (MS-0MUYFX7Q2004JQ5R) delegates both to it; these tests pin the contract.

interface PrimitiveHarness {
  scene: any;
  instructions: string[];
  incidentCalls: any[];
}

/**
 * Scene harness for the shared primitive: captures the instruction text and
 * each `animateIncidentReveal` invocation. Its clock drains synchronously so
 * any bounded hold the primitive (or its caller) schedules runs immediately.
 */
function makePrimitiveHarness(overrides: Record<string, unknown> = {}): PrimitiveHarness {
  const instructions: string[] = [];
  const incidentCalls: any[] = [];
  const scene: any = {
    replayMode: false,
    settingsPanel: { reducedMotion: false },
    instructionText: { setText: (t: string) => instructions.push(t) },
    layout: { gameW: 800, gameH: 600 },
    incidentRevealActive: false,
    msRenderer: { getFrontIncidentCardCenter: () => ({ x: 111, y: 222 }) },
    msAnimator: {
      animateIncidentReveal: (params: any) => {
        incidentCalls.push(params);
      },
    },
    time: {
      now: 0,
      delayedCall: (_ms: number, cb: () => void) => {
        cb();
        return {};
      },
    },
    ...overrides,
  };
  return { scene, instructions, incidentCalls };
}

/**
 * Turn-flow harness: enough scene surface for `finishTurnPresentation` to walk
 * to the advance callback on the normal (non-deferred, no-incident) path.
 */
function makeTurnFlowHarness(): { scene: any; tcCtx: any } {
  const scene: any = {
    state: { resourceBank: { coins: 0, reputation: 0 } },
    instructionText: { setText: vi.fn() },
    incomeCollectionActive: false,
    logDeferredUntilPhaseComplete: false,
    endOfTurnDeltasApplied: false,
    previousCoins: null,
    previousReputation: null,
    incidentRevealActive: false,
    tutorialController: { isActive: false },
    settingsPanel: { reducedMotion: false },
    replayMode: false,
    layout: { gameW: 800, gameH: 600 },
    refreshAll: vi.fn(),
    refreshAllExceptStreet: vi.fn(),
    refreshLog: vi.fn(),
    msLifecycleManager: { onTutorialActionComplete: vi.fn() },
    msAnimator: { animateIncidentReveal: vi.fn() },
    msRenderer: { getFrontIncidentCardCenter: () => ({ x: 0, y: 0 }) },
    time: {
      now: 0,
      delayedCall: (_ms: number, cb: () => void) => {
        cb();
        return {};
      },
    },
  };
  const tcCtx: any = {
    scene,
    startTurnPhase: vi.fn(),
    handleGameOver: vi.fn(),
    presentEventChoiceDialog: vi.fn(),
    onSaveCheckpoint: vi.fn(),
  };
  return { scene, tcCtx };
}

describe('shared closing presentation primitive (MS-0MUYFX6ER000BLP3)', () => {
  beforeEach(() => {
    presentTurnClosing.mockClear();
  });

  it(
    'AC1 — a single-seat closing drives the income summary, incident reveal, end-of-turn text and advance callback',
    () => {
      const h = makePrimitiveHarness();
      const result = makeResult({
        income: makeIncome(12),
        incident: { id: 'inc-9', name: 'Roadworks' } as any,
        incidentCoinChange: -4,
        incidentRepChange: -1,
      });
      let completed = 0;

      presentTurnClosing(asCtx(h.scene), result, () => { completed += 1; }, {
        completionText: 'End of turn complete.',
      });

      // Income summary text — the same format both closings use today.
      expect(h.instructions.some((t) => t.includes('Income: +12 coins'))).toBe(true);

      // Incident reveal driven once, with the closing's deltas and origin.
      expect(h.incidentCalls).toHaveLength(1);
      expect(h.incidentCalls[0]).toMatchObject({
        cardId: 'inc-9',
        incidentName: 'Roadworks',
        coinChange: -4,
        repChange: -1,
        from: { x: 111, y: 222 },
      });

      // Bounded: the advance callback waits for the reveal to complete.
      expect(completed).toBe(0);
      h.incidentCalls[0].onComplete();

      // End-of-turn text, then advance exactly once.
      expect(lastInstruction(h.instructions)).toBe('End of turn complete.');
      expect(completed).toBe(1);
    },
  );

  it('AC1 — a closing with no incident advances without a reveal', () => {
    const h = makePrimitiveHarness();
    let completed = 0;

    presentTurnClosing(asCtx(h.scene), makeResult({ income: makeIncome(3) }), () => {
      completed += 1;
    }, {
      completionText: 'End of turn complete.',
    });

    expect(h.incidentCalls).toHaveLength(0);
    expect(h.instructions.some((t) => t.includes('Income: +3 coins'))).toBe(true);
    expect(completed).toBe(1);
  });

  it('AC1 — reduced motion degrades to text and advances immediately', () => {
    const h = makePrimitiveHarness({ settingsPanel: { reducedMotion: true } });
    const result = makeResult({ incident: { id: 'inc-3', name: 'Fire' } as any });
    let completed = 0;

    presentTurnClosing(asCtx(h.scene), result, () => { completed += 1; }, {
      completionText: 'End of turn complete.',
    });

    expect(h.incidentCalls).toHaveLength(0);
    expect(h.instructions.some((t) => t.includes('Incident: Fire'))).toBe(true);
    expect(completed).toBe(1);
  });

  it('AC1 — replay/headless skips animation but still advances (bounded)', () => {
    const h = makePrimitiveHarness({ replayMode: true });
    let completed = 0;

    presentTurnClosing(asCtx(h.scene), makeResult({ incident: { id: 'i', name: 'X' } as any }), () => {
      completed += 1;
    }, {
      completionText: 'End of turn complete.',
    });

    expect(h.incidentCalls).toHaveLength(0);
    expect(completed).toBe(1);
  });

  it(
    'AC3 — finishTurnPresentation delegates to the shared primitive and still advances the day',
    () => {
      const { tcCtx } = makeTurnFlowHarness();

      finishTurnPresentation(tcCtx, makeResult({ income: makeIncome(5) }), false);

      expect(presentTurnClosing).toHaveBeenCalledTimes(1);
      const args = presentTurnClosing.mock.calls[0];
      expect(args[0]).toBe(tcCtx);
      expect(args[1]).toMatchObject({ income: { total: 5 } });
      expect(typeof args[2]).toBe('function');
      // The single-player advance chain is preserved: the primitive's callback
      // still starts the next day.
      expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
    },
  );

  it(
    'AC3 — presentCompetitiveClosing delegates to the shared primitive and still advances',
    () => {
      const h = makePrimitiveHarness();
      let advanced = 0;

      presentCompetitiveClosing(asCtx(h.scene), makeResult(), () => { advanced += 1; });

      expect(presentTurnClosing).toHaveBeenCalledTimes(1);
      expect(advanced).toBe(1);
    },
  );
});
