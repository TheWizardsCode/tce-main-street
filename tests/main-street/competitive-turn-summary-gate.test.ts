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
 * The per-seat closing presentation itself is covered by
 * `competitive-closing-presentation.test.ts`; this suite covers the gate.
 *
 * @module tests/main-street/competitive-turn-summary-gate
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  presentCompetitiveDayTail,
  presentCompetitiveTurnSummaryGate,
  shouldGateCompetitiveTurnSummary,
} from '../../src/scenes/MainStreetTurnControllerCompetitive';
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
});

// ── Panel presentation ───────────────────────────────────────

describe('presentCompetitiveTurnSummaryGate (MS-0MVRNV9Y8008IKGK)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

// ── The competitive day tail ─────────────────────────────────

describe('presentCompetitiveDayTail gate (AC4/AC5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('presents the panel after the closing presentation and gate the next day on [ Next Turn ]', () => {
    const { scene, tcCtx } = makeHarness();
    const order: string[] = [];
    scene.msAnimator.animateIncomePhases = vi.fn(() => order.push('closing'));
    scene.showCompetitiveTurnSummaryDialog = vi.fn(() => order.push('panel'));

    presentCompetitiveDayTail(tcCtx, makeClosing());

    // The closing presentation completed first, then the panel appeared.
    expect(order).toEqual(['closing', 'panel']);
    expect(tcCtx.onSaveCheckpoint).toHaveBeenCalledTimes(1);
    expect(tcCtx.startTurnPhase).not.toHaveBeenCalled();

    const [, onNextTurn] = scene.showCompetitiveTurnSummaryDialog.mock.calls[0];
    onNextTurn();
    expect(tcCtx.startTurnPhase).toHaveBeenCalledTimes(1);
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
});
