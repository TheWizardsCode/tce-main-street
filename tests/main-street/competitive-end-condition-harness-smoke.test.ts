/**
 * Main Street: Competitive end-condition harness smoke test.
 *
 * Verifies that the shared test fixture module works correctly
 * against the existing (pre-fix) engine. This test does NOT
 * assert the fixed behaviour — it merely proves the harness
 * can build states, evaluate end-conditions, and produce
 * deterministic results.
 *
 * Parent: MS-0MUVBH589001L7NL (Competitive game ends on AI seat failure)
 *
 * @module tests/main-street/competitive-end-condition-harness-smoke
 */
import { describe, it, expect } from 'vitest';

import {
  buildCompetitiveState,
  buildHumanVsAis,
  buildAiOnly,
  evaluateEndConditions,
  expectEndCondition,
  expectSeatWallet,
  expectSeatEliminated,
  statesAreEquivalent,
  isCompetitiveMode,
  findHumanSeat,
  countAiSeats,
  countActiveSeats,
  type EndConditionResult,
  type SeatWalletOverride,
} from './helpers/competitive-fixtures';

import { type OwnerTaggedSlot } from '../../src/MainStreetState';
import {
  executeCompetitiveWeekStart,
  endCompetitiveMarketTurn,
  resolveCompetitiveClosingPhases,
  resolveCompetitivePendingChoice,
} from '../../src/MainStreetEngine';

// ── Harness builder smoke ─────────────────────────────────────

describe('Harness builder — smoke', () => {
  it('buildCompetitiveState creates a valid competitive state with 2 seats', () => {
    const state = buildCompetitiveState({ seed: 'smoke-1', playerCount: 2 });
    expect(isCompetitiveMode(state)).toBe(true);
    expect(state.players!.length).toBe(2);
    expect(state.gameResult).toBe('playing');
    expect(state.phase).toBe('WeekStart');
  });

  it('buildHumanVsAis creates 1 human + 1 AI with correct controllers', () => {
    const state = buildHumanVsAis('smoke-2', 1, [[500, 3], [200, 2]]);
    expect(state.players!.length).toBe(2);
    expect(state.players![0].controller).toBe('human');
    expect(state.players![1].controller).toBe('ai');
  });

  it('buildHumanVsAis creates 1 human + N AI (N ≥ 2)', () => {
    const state = buildHumanVsAis('smoke-n3', 3, [[500, 3], [200, 2], [300, 2], [150, 1]]);
    expect(state.players!.length).toBe(4);
    expect(state.players![0].controller).toBe('human');
    for (let i = 1; i < 4; i++) {
      expect(state.players![i].controller).toBe('ai');
    }
  });

  it('buildAiOnly creates all-AI seats', () => {
    const state = buildAiOnly('smoke-ai', 3, [[300, 2], [200, 2], [100, 1]]);
    expect(state.players!.length).toBe(3);
    for (const p of state.players!) {
      expect(p.controller).toBe('ai');
    }
  });

  it('seat wallet overrides apply correctly', () => {
    const wallets: SeatWalletOverride[] = [
      { playerId: 0, coins: 999, reputation: 5 },
      { playerId: 1, coins: 100, reputation: 0 },
    ];
    const state = buildCompetitiveState({ seed: 'smoke-wallet', playerCount: 2, seatWallets: wallets });
    expect(state.players![0].coins).toBe(999);
    expect(state.players![0].reputation).toBe(5);
    expect(state.players![1].coins).toBe(100);
    expect(state.players![1].reputation).toBe(0);
  });

  it('slot ownership overrides apply correctly', () => {
    const slot: OwnerTaggedSlot = { card: null as any, ownerId: null };
    const overrides = [{ slotIndex: 0, ownerId: 0, card: slot.card }];
    const state = buildCompetitiveState({ seed: 'smoke-slot', playerCount: 2, slotOverrides: overrides });
    expect(state.ownerTaggedGrid![0].ownerId).toBe(0);
  });
});

// ── Determinism ───────────────────────────────────────────────

describe('Determinism — same seed → identical state', () => {
  it('buildCompetitiveState produces equivalent states from same seed', () => {
    const s1 = buildCompetitiveState({ seed: 'det-1', playerCount: 2 });
    const s2 = buildCompetitiveState({ seed: 'det-1', playerCount: 2 });
    expect(statesAreEquivalent(s1, s2)).toBe(true);
  });

  it('buildHumanVsAis produces equivalent states from same seed', () => {
    const s1 = buildHumanVsAis('det-hv', 1, [[500, 3], [200, 2]]);
    const s2 = buildHumanVsAis('det-hv', 1, [[500, 3], [200, 2]]);
    expect(statesAreEquivalent(s1, s2)).toBe(true);
  });

  it('different seeds produce different shared decks', () => {
    const s1 = buildCompetitiveState({ seed: 'det-diff-a', playerCount: 2 });
    const s2 = buildCompetitiveState({ seed: 'det-diff-b', playerCount: 2 });
    expect(s1.decks.business.map(c => c.id)).not.toEqual(s2.decks.business.map(c => c.id));
  });

  it('determinism survives wallet overrides', () => {
    const wallets: SeatWalletOverride[] = [
      { playerId: 0, coins: 1234, reputation: 7 },
      { playerId: 1, coins: 567, reputation: 3 },
    ];
    const s1 = buildCompetitiveState({ seed: 'det-wallet', playerCount: 2, seatWallets: wallets });
    const s2 = buildCompetitiveState({ seed: 'det-wallet', playerCount: 2, seatWallets: wallets });
    expect(statesAreEquivalent(s1, s2)).toBe(true);
  });
});

// ── End-condition evaluation smoke ────────────────────────────

describe('End-condition evaluation — smoke against pre-fix engine', () => {
  let result: EndConditionResult;

  it('evaluateEndConditions returns a structured result', () => {
    const state = buildCompetitiveState({ seed: 'end-smoke', playerCount: 2 });
    result = evaluateEndConditions(state);
    expect(result.ended).toBe(false);
    expect(result.gameResult).toBe('playing');
    expect(result.endReason).toBeNull();
    expect(result.competitiveWinnerId).toBeNull();
    expect(result.seats.length).toBe(2);
  });

  it('score-threshold win is detected', () => {
    const state = buildCompetitiveState({
      seed: 'end-win',
      playerCount: 2,
      winThreshold: 10,
      seatWallets: [
        { playerId: 0, coins: 100, reputation: 10 },
        { playerId: 1, coins: 1, reputation: 1 },
      ],
    });
    result = evaluateEndConditions(state);
    expect(result.ended).toBe(true);
    expect(result.gameResult).toBe('win');
    expect(result.competitiveWinnerId).toBe(0);
  });

  it('P1 wins when only P1 crosses threshold', () => {
    const state = buildCompetitiveState({
      seed: 'end-p1',
      playerCount: 2,
      winThreshold: 10,
      seatWallets: [
        { playerId: 0, coins: 1, reputation: 1 },
        { playerId: 1, coins: 100, reputation: 10 },
      ],
    });
    result = evaluateEndConditions(state);
    expect(result.ended).toBe(true);
    expect(result.competitiveWinnerId).toBe(1);
  });

  it('no win when no player crosses threshold', () => {
    const state = buildCompetitiveState({
      seed: 'end-none',
      playerCount: 2,
      winThreshold: 9999,
      seatWallets: [
        { playerId: 0, coins: 100, reputation: 5 },
        { playerId: 1, coins: 200, reputation: 3 },
      ],
    });
    result = evaluateEndConditions(state);
    expect(result.ended).toBe(false);
  });

  it('tie wins go to lowest index (player 0)', () => {
    const state = buildCompetitiveState({
      seed: 'end-tie',
      playerCount: 2,
      winThreshold: 10,
      seatWallets: [
        { playerId: 0, coins: 20, reputation: 5 },
        { playerId: 1, coins: 30, reputation: 10 },
      ],
    });
    result = evaluateEndConditions(state);
    expect(result.ended).toBe(true);
    expect(result.competitiveWinnerId).toBe(0);
  });
});

// ── Assertion helpers ─────────────────────────────────────────

describe('Assertion helpers', () => {
  it('expectSeatWallet asserts correct seat values', () => {
    const state = buildCompetitiveState({
      seed: 'assert-seat',
      playerCount: 2,
      seatWallets: [
        { playerId: 0, coins: 100, reputation: 5 },
        { playerId: 1, coins: 200, reputation: 3 },
      ],
    });
    const result = evaluateEndConditions(state);
    expectSeatWallet(result.seats, 0, 100, 5);
    expectSeatWallet(result.seats, 1, 200, 3);
  });

  it('expectEndCondition asserts individual fields', () => {
    const state = buildCompetitiveState({ seed: 'assert-end', playerCount: 2 });
    const result = evaluateEndConditions(state);
    expectEndCondition(result, { ended: false, gameResult: 'playing', competitiveWinnerId: null });
  });

  it('evaluateEndConditions exposes per-seat eliminated (false pre-fix)', () => {
    const state = buildCompetitiveState({ seed: 'assert-elim', playerCount: 2 });
    const result = evaluateEndConditions(state);
    expectSeatEliminated(result.seats, 0, false);
    expectSeatEliminated(result.seats, 1, false);
  });
});

// ── Utility functions ─────────────────────────────────────────

describe('Utility functions', () => {
  it('findHumanSeat returns 0 for a human-vs-AI state', () => {
    const state = buildHumanVsAis('util-human', 1, [[500, 3], [200, 2]]);
    expect(findHumanSeat(state)).toBe(0);
  });

  it('findHumanSeat returns -1 for all-AI state', () => {
    const state = buildAiOnly('util-no-human', 2, [[300, 2], [200, 2]]);
    expect(findHumanSeat(state)).toBe(-1);
  });

  it('countAiSeats returns correct count', () => {
    const state = buildHumanVsAis('util-ai-count', 3, [[500, 3], [200, 2], [100, 1], [50, 1]]);
    expect(countAiSeats(state)).toBe(3);
  });

  it('countActiveSeats works when no seats are eliminated', () => {
    const state = buildCompetitiveState({ seed: 'util-active', playerCount: 4 });
    expect(countActiveSeats(state)).toBe(4);
  });
});

// ── Integration: harness + closing phases ─────────────────────

describe('Integration — harness + competitive closing', () => {
  it('buildHumanVsAis state drives through a full shared day without crash', () => {
    const state = buildHumanVsAis('int-day', 1, [[500, 5], [300, 4]]);
    state.resourceBank.coins = 1000;
    state.resourceBank.reputation = 1000;

    // Drive through: WeekStart -> markets -> closing
    executeCompetitiveWeekStart(state);
    for (let i = 0; i < 2; i++) {
      endCompetitiveMarketTurn(state);
    }
    expect(state.phase).toBe('InvestmentResolution');

    const closing = resolveCompetitiveClosingPhases(state);
    expect(closing.gameResult).toBe('playing');
    if (closing.choicePending) {
      resolveCompetitivePendingChoice(state);
    }
    expect(state.phase).toBe('WeekStart');
  });

  it('multi-AI state (1H + 3AI) drives through a full shared day', () => {
    const state = buildHumanVsAis('int-n4', 3, [[500, 5], [300, 4], [250, 3], [200, 2]]);
    state.resourceBank.coins = 2000;
    state.resourceBank.reputation = 2000;

    executeCompetitiveWeekStart(state);
    for (let i = 0; i < 4; i++) {
      endCompetitiveMarketTurn(state);
    }
    expect(state.phase).toBe('InvestmentResolution');

    const closing = resolveCompetitiveClosingPhases(state);
    expect(closing.gameResult).toBe('playing');
    if (closing.choicePending) {
      resolveCompetitivePendingChoice(state);
    }
    expect(state.phase).toBe('WeekStart');
  });
});
