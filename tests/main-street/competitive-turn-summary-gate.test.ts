/**
 * Main Street: Competitive Turn Summary gate — MS-0MVRNV9Y8008IKGK
 *
 * Competitive play gains the single-player review-and-advance moment: after
 * `presentCompetitiveClosing` completes, the per-seat Turn Summary panel is
 * presented and the next shared day starts only when the player clicks
 * **[ Next Turn ]**.
 *
 * Pinned here:
 *  - AC4 — the panel is presented after the closing presentation completes and
 *    `startTurnPhase` runs only on `[ Next Turn ]` (exactly once);
 *  - AC5's auto-advance carve-outs — reduced motion, replay and headless keep
 *    today's pacing, and a closing without a competitive ledger never stalls;
 *  - the panel content flows through the real Phaser-free model (seat labels
 *    and colours from the competitive scoreboard conventions).
 *
 * Invariants (MS-0MVRNW5JT0046QI3): only seats still playing get rows; N=1 /
 * single-player never gate; a headless competitive day advances with no
 * overlay surface; the gate adds no checkpoint save, mutates no engine state
 * and consumes no RNG; and a throwing model build or panel presentation
 * advances immediately (never stalls, never advances twice).
 *
 * The per-seat closing presentation itself is covered by
 * `competitive-closing-presentation.test.ts`; this suite covers the gate.
 *
 * @module tests/main-street/competitive-turn-summary-gate
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Failure injection for the model build (MS-0MVRNW5JT0046QI3 AC5): the real
 * model runs unless a test asks the wrapper to throw.
 */
const modelControl = vi.hoisted(() => ({ throwOnBuild: false }));

vi.mock('../../src/scenes/MainStreetTurnSummary', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/scenes/MainStreetTurnSummary')
  >();
  return {
    ...actual,
    buildCompetitiveTurnSummary: (
      ...args: Parameters<typeof actual.buildCompetitiveTurnSummary>
    ) => {
      if (modelControl.throwOnBuild) throw new Error('competitive model build failed');
      return actual.buildCompetitiveTurnSummary(...args);
    },
  };
});

import {
  presentCompetitiveDayTail,
  presentCompetitiveTurnSummaryGate,
  shouldGateCompetitiveTurnSummary,
} from '../../src/scenes/MainStreetTurnControllerCompetitive';
import { executeCompetitiveTurn } from '../../src/MainStreetEngineCompetitiveTurn';
import type { TurnResult } from '../../src/MainStreetEngine';
import type { OwnerIncomeResult } from '../../src/MainStreetAdjacency';
import type { CompetitiveRoundLedger } from '../../src/MainStreetEngineTypes';
import { createCompetitiveState, type MainStreetState } from '../../src/MainStreetState';

// ── Fixtures ─────────────────────────────────────────────────

/** A two-seat competitive state (seats carry colours for row identity). */
function competitiveState(): MainStreetState {
  return createCompetitiveState({
    seed: 'competitive-summary-gate',
    playerCount: 2,
    difficulty: 'Easy',
    loansEnabled: false,
  });
}

/** One `OwnerIncomeResult` per seat, as `applyCompetitiveIncome` emits it. */
function makePlayerIncome(): OwnerIncomeResult[] {
  return [0, 1].map((ownerId) => ({
    ownerId,
    income: {
      total: 12 + ownerId,
      breakdown: [],
      handSynergyTotal: 0,
      phaseBreakdown: {
        perSlotBreakdown: [
          {
            slotIndex: ownerId,
            businessName: 'Cafe',
            baseIncome: 12 + ownerId,
            synergyBonus: 0,
            repBonus: 0,
            eventDeltas: [],
            upcomingDeltas: [],
            ownerId,
          },
        ],
        handSynergyTotal: 0,
      },
    },
  }));
}

/** The engine's competitive round ledger, as the closing emits it. */
function makeLedger(): CompetitiveRoundLedger {
  return {
    turn: 7,
    seats: [
      {
        ownerId: 0,
        businessesOwned: 3,
        incomeByPhase: { base: 12, synergy: 4, reputation: 2, events: -1 },
        incomeTotal: 17,
        netCoinChange: 9,
      },
      {
        ownerId: 1,
        businessesOwned: 2,
        incomeByPhase: { base: 13, synergy: 0, reputation: 0, events: 0 },
        incomeTotal: 13,
        netCoinChange: 11,
      },
    ],
  };
}

function makeClosing(overrides: Partial<TurnResult> = {}): TurnResult {
  return {
    income: null,
    incident: null,
    incidentCoinChange: 0,
    incidentRepChange: 0,
    gameResult: 'playing',
    finalScore: 0,
    newlyCompletedChallenges: [],
    choicePending: false,
    playerIncome: makePlayerIncome(),
    playerRoundLedger: makeLedger(),
    ...overrides,
  } as TurnResult;
}

interface Harness {
  scene: any;
  tcCtx: any;
  state: MainStreetState;
}

/**
 * A minimal scene/controller surface: the real competitive closing
 * presentation runs (its pop texts are recorded in `feedbackHistory`), the
 * animator is a spy and the panel is a spy — so the ordering between the
 * closing presentation and the gate is observable.
 */
function makeHarness(overrides: Record<string, unknown> = {}): Harness {
  const state = competitiveState();
  const scene: any = {
    state,
    replayMode: false,
    settingsPanel: { reducedMotion: false },
    incomeCollectionActive: false,
    feedbackHistory: [],
    msAnimator: { animateIncomePhases: vi.fn() },
    showCompetitiveTurnSummaryDialog: vi.fn(),
    ...overrides,
  };
  const tcCtx: any = {
    scene,
    startTurnPhase: vi.fn(),
    handleGameOver: vi.fn(),
    onSaveCheckpoint: vi.fn(),
  };
  return { scene, tcCtx, state };
}

// ── Gate predicate ───────────────────────────────────────────

describe('shouldGateCompetitiveTurnSummary (MS-0MVRNV9Y8008IKGK)', () => {
  it('gates a competitive closing that carries a round ledger', () => {
    const { tcCtx } = makeHarness();
    expect(shouldGateCompetitiveTurnSummary(tcCtx, makeClosing())).toBe(true);
  });

  it('does not gate replay (headless presentation has no UI)', () => {
    const { tcCtx } = makeHarness({ replayMode: true });
    expect(shouldGateCompetitiveTurnSummary(tcCtx, makeClosing())).toBe(false);
  });

  it('does not gate reduced motion (existing auto-advance pacing)', () => {
    const { tcCtx } = makeHarness({ settingsPanel: { reducedMotion: true } });
    expect(shouldGateCompetitiveTurnSummary(tcCtx, makeClosing())).toBe(false);
  });

  it('does not gate a headless scene with no dialog surface', () => {
    const { tcCtx } = makeHarness({ showCompetitiveTurnSummaryDialog: undefined });
    expect(shouldGateCompetitiveTurnSummary(tcCtx, makeClosing())).toBe(false);
  });

  it('does not gate a closing without a competitive ledger (single-player / hand-built)', () => {
    const { tcCtx } = makeHarness();
    expect(
      shouldGateCompetitiveTurnSummary(tcCtx, makeClosing({ playerRoundLedger: undefined })),
    ).toBe(false);
  });

  it('does not gate a single-player state', () => {
    const { tcCtx, state } = makeHarness();
    state.players = [];
    expect(shouldGateCompetitiveTurnSummary(tcCtx, makeClosing())).toBe(false);
  });

  it('does not gate an N=1 closing (single-player panel owns that path)', () => {
    const { tcCtx, state } = makeHarness();
    state.players = state.players!.slice(0, 1);
    expect(shouldGateCompetitiveTurnSummary(tcCtx, makeClosing())).toBe(false);
  });
});

// ── Panel presentation ───────────────────────────────────────

describe('presentCompetitiveTurnSummaryGate (MS-0MVRNV9Y8008IKGK)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelControl.throwOnBuild = false;
  });

  it('presents the per-seat panel built by the real model and holds the day until [ Next Turn ]', () => {
    const { scene, tcCtx } = makeHarness();

    presentCompetitiveTurnSummaryGate(tcCtx, makeClosing(), () => tcCtx.startTurnPhase());

    expect(scene.showCompetitiveTurnSummaryDialog).toHaveBeenCalledTimes(1);
    const [summary, onNextTurn] = scene.showCompetitiveTurnSummaryDialog.mock.calls[0];

    // Wired content, not a stub: one row per seat with the scoreboard labels.
    expect(summary.turn).toBe(7);
    expect(summary.rows.map((row: { label: string }) => row.label)).toEqual(['You', 'AI 1']);
    expect(summary.rows[0].businessesOwned).toBe(3);
    expect(summary.rows[0].incomeTotal).toBe(17);
    expect(summary.rows[1].netCoinChange).toBe(11);

    // The next day must NOT have started yet.
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();

    // Only the player's [ Next Turn ] click advances the day.
    onNextTurn();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('advances immediately when the scene cannot present the panel (never strands the day)', () => {
    const { tcCtx } = makeHarness({ showCompetitiveTurnSummaryDialog: undefined });
    const onNextTurn = vi.fn();

    presentCompetitiveTurnSummaryGate(tcCtx, makeClosing(), onNextTurn);

    expect(onNextTurn).toHaveBeenCalledTimes(1);
  });

  it('advances immediately when the ledger disappears between predicate and present', () => {
    const { tcCtx } = makeHarness();
    const onNextTurn = vi.fn();

    presentCompetitiveTurnSummaryGate(
      tcCtx,
      makeClosing({ playerRoundLedger: undefined }),
      onNextTurn,
    );

    expect(tcCtx.scene.showCompetitiveTurnSummaryDialog).not.toHaveBeenCalled();
    expect(onNextTurn).toHaveBeenCalledTimes(1);
  });

  it('renders no row for an eliminated seat (only the seats still playing)', () => {
    const { scene, tcCtx, state } = makeHarness();
    state.players![1].eliminated = true;

    presentCompetitiveTurnSummaryGate(tcCtx, makeClosing(), vi.fn());

    const [summary] = scene.showCompetitiveTurnSummaryDialog.mock.calls[0];
    expect(summary.rows.map((row: { ownerId: number }) => row.ownerId)).toEqual([0]);
    expect(summary.rows).toHaveLength(1);
  });

  it('advances immediately when the model build throws (never strands the day)', () => {
    modelControl.throwOnBuild = true;
    const { tcCtx } = makeHarness();
    const onNextTurn = vi.fn();

    try {
      presentCompetitiveTurnSummaryGate(tcCtx, makeClosing(), onNextTurn);
    } finally {
      modelControl.throwOnBuild = false;
    }

    expect(tcCtx.scene.showCompetitiveTurnSummaryDialog).not.toHaveBeenCalled();
    expect(onNextTurn).toHaveBeenCalledTimes(1);
  });

  it('advances exactly once when the panel presentation throws (no overlay manager)', () => {
    const { scene, tcCtx } = makeHarness({
      showCompetitiveTurnSummaryDialog: vi.fn(() => {
        throw new Error('scene has no overlay manager');
      }),
    });
    const onNextTurn = vi.fn();

    presentCompetitiveTurnSummaryGate(tcCtx, makeClosing(), onNextTurn);

    expect(scene.showCompetitiveTurnSummaryDialog).toHaveBeenCalledTimes(1);
    expect(onNextTurn).toHaveBeenCalledTimes(1);
  });

  it('adds no checkpoint save, mutates no engine state and consumes no RNG', () => {
    const { scene, tcCtx, state } = makeHarness();
    const before = JSON.stringify(state);
    const rngCallsBefore = state.rngCalls;

    presentCompetitiveTurnSummaryGate(tcCtx, makeClosing(), vi.fn());

    expect(scene.showCompetitiveTurnSummaryDialog).toHaveBeenCalledTimes(1);
    expect(tcCtx.onSaveCheckpoint).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).toBe(before);
    expect(state.rngCalls).toBe(rngCallsBefore);
  });

  it('passes the human seat id and its loan seam to the panel (AC1/AC2 wiring)', () => {
    const { scene, tcCtx } = makeHarness();

    presentCompetitiveTurnSummaryGate(tcCtx, makeClosing(), vi.fn());

    const [summary, , onBankLoanAction, result] =
      scene.showCompetitiveTurnSummaryDialog.mock.calls[0];
    // The summary model carries the human seat identity used to key the
    // button (fixture: seat 0 is human, loans disabled).
    expect(summary.humanSeatId).toBe(0);
    expect(summary.loanDescriptor.enabled).toBe(false);
    expect(summary.loanDescriptor.reason).toBe('loans-disabled');
    // The seam is provided once a human seat exists and is invoked per press
    // of the enabled button with that seat id.
    expect(typeof onBankLoanAction).toBe('function');
    onBankLoanAction(0);
    // The closing result is handed over so the panel can re-render the same
    // TurnResult after a take.
    expect(result).toEqual(makeClosing());
  });
});

// ── The competitive day tail ─────────────────────────────────

describe('presentCompetitiveDayTail gate (AC4/AC5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves the checkpoint before the closing and panels only after it completes', () => {
    const { scene, tcCtx } = makeHarness();
    const order: string[] = [];
    tcCtx.onSaveCheckpoint = vi.fn(() => order.push('save'));
    scene.msAnimator.animateIncomePhases = vi.fn(() => order.push('closing'));
    scene.showCompetitiveTurnSummaryDialog = vi.fn(() => order.push('panel'));

    presentCompetitiveDayTail(tcCtx, makeClosing());

    // Exactly one save, before the closing presentation completes, and the
    // panel is the closing's completion callback — the gate adds no save.
    expect(order).toEqual(['save', 'closing', 'panel']);
    expect(tcCtx.onSaveCheckpoint).toHaveBeenCalledTimes(1);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();

    const [, onNextTurn] = scene.showCompetitiveTurnSummaryDialog.mock.calls[0];
    onNextTurn();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
    // The click adds no further save either.
    expect(tcCtx.onSaveCheckpoint).toHaveBeenCalledTimes(1);
  });

  it('keeps reduced-motion auto-advance pacing', () => {
    const { scene, tcCtx } = makeHarness({ settingsPanel: { reducedMotion: true } });

    presentCompetitiveDayTail(tcCtx, makeClosing());

    expect(scene.showCompetitiveTurnSummaryDialog).not.toHaveBeenCalled();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('keeps replay auto-advance pacing', () => {
    const { scene, tcCtx } = makeHarness({ replayMode: true });

    presentCompetitiveDayTail(tcCtx, makeClosing());

    expect(scene.showCompetitiveTurnSummaryDialog).not.toHaveBeenCalled();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('keeps headless auto-advance pacing (no dialog surface)', () => {
    const { scene, tcCtx } = makeHarness({ showCompetitiveTurnSummaryDialog: undefined });

    presentCompetitiveDayTail(tcCtx, makeClosing());

    // No dialog surface exists at all, and the day advanced anyway.
    expect(scene.showCompetitiveTurnSummaryDialog).toBeUndefined();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });

  it('drives a real headless competitive day to the next day with no overlay surface', () => {
    // The engine runs a whole shared day with no scene at all (Monte-Carlo /
    // AI-driven parity): it advances and surfaces the round ledger.
    const state = createCompetitiveState({
      seed: 'competitive-summary-headless-day',
      playerCount: 3,
      difficulty: 'Easy',
      loansEnabled: false,
    });
    state.resourceBank.coins = 1000;
    state.resourceBank.reputation = 1000;
    state.incidentDeck = [];
    const dayBefore = state.turn;

    const result = executeCompetitiveTurn(state, [[], [], []]);

    expect(result.gameResult).toBe('playing');
    expect(result.playerRoundLedger).toBeDefined();
    expect(state.turn).toBe(dayBefore + 1);

    // The same result in a headless scene: no dialog surface, so the panel is
    // never presented and the next day starts immediately.
    const { scene, tcCtx } = makeHarness({ showCompetitiveTurnSummaryDialog: undefined });
    scene.state = state;

    presentCompetitiveDayTail(tcCtx, result);

    expect(scene.showCompetitiveTurnSummaryDialog).toBeUndefined();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
  });
});
