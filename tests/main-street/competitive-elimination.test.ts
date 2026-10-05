/**
 * Main Street: AI seat elimination with business closure.
 *
 * Parent: MS-0MUVBH589001L7NL (Competitive game ends on AI seat failure)
 *
 * AC1 — optional `PlayerRecord.eliminated` (absent = false; legacy saves load).
 * AC2 — failing AI seat is marked eliminated and does not end the game.
 * AC3 — eliminated seat skipped in rotation / AI action enumeration.
 * AC4 — owned slots closed: owner cleared, cards discarded, no synergy.
 * AC5 — closure is a direct grid/discard operation (no action cost, no wallet change).
 * AC6 — tests cover flag, rotation skip, ownership cleared, discard, no income.
 * AC7 — multi-AI: eliminating one leaves the survivors rotating.
 *
 * @module tests/main-street/competitive-elimination
 */
import { describe, it, expect } from 'vitest';

import {
  buildCompetitiveState,
  buildHumanVsAis,
} from './helpers/competitive-fixtures';
import {
  checkCompetitiveSeatFailure,
  resolveCompetitiveSeatFailures,
  eliminateCompetitiveSeat,
  closeEliminatedSeatBusinesses,
  executeCompetitiveWeekStart,
  endCompetitiveMarketTurn,
  getActivePlayerId,
  getFirstActivePlayerId,
  getNextActivePlayerId,
} from '../../src/MainStreetEngine';
import {
  serializeMainStreetState,
  deserializeMainStreetState,
  createCompetitiveState,
} from '../../src/MainStreetState';
import type { BusinessCard } from '../../src/MainStreetCards';

// ── Helpers ─────────────────────────────────────────────────

function makeBusiness(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: overrides.id ?? 'test-biz',
    name: overrides.name ?? 'Test Biz',
    cost: overrides.cost ?? 100,
    baseIncome: overrides.baseIncome ?? 50,
    synergyTypes: overrides.synergyTypes ?? ['Food'],
    maxLevel: overrides.maxLevel ?? 1,
    description: overrides.description ?? 'A test business',
    level: overrides.level ?? 0,
    incomeBonus: overrides.incomeBonus ?? 0,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    reputationBonus: overrides.reputationBonus ?? 0,
    ongoingCost: overrides.ongoingCost ?? 0,
    ...overrides,
  } as BusinessCard;
}

// ── AC1: optional eliminated flag ───────────────────────────

describe('AC1 — optional PlayerRecord.eliminated', () => {
  it('is absent/false by default on new competitive seats', () => {
    const state = buildCompetitiveState({ seed: 'elim-default', playerCount: 3 });
    for (const p of state.players!) {
      expect(p.eliminated ?? false).toBe(false);
    }
  });

  it('round-trips through serialization', () => {
    const state = buildHumanVsAis('elim-save', 1, [[100, 5], [100, 3]]);
    state.players![1].eliminated = true;
    const restored = deserializeMainStreetState(serializeMainStreetState(state));
    expect(restored.players![1].eliminated).toBe(true);
    expect(restored.players![0].eliminated ?? false).toBe(false);
  });

  it('legacy saves without the field load unchanged (treated as false)', () => {
    const state = buildHumanVsAis('elim-legacy', 1, [[100, 5], [100, 3]]);
    const serialized = serializeMainStreetState(state) as unknown as {
      players: Array<Record<string, unknown>>;
    };
    for (const p of serialized.players) delete p.eliminated;
    const restored = deserializeMainStreetState(serialized as any);
    expect(restored.players![0].eliminated ?? false).toBe(false);
    expect(restored.players![1].eliminated ?? false).toBe(false);
  });
});

// ── AC2: failing AI is eliminated, game continues ───────────

describe('AC2 — AI failure marks elimination without ending the game', () => {
  it('marks the failing AI eliminated and does not set a loss', () => {
    // 1 human + 2 AI: eliminating one AI leaves the game playing (the
    // 1-human-vs-1-AI case now declares a last-standing win — F5).
    const state = buildHumanVsAis('elim-ai', 2, [[100, 5], [100, 0], [100, 3]]);
    state.turn = 2;
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(false);
    expect(state.gameResult).toBe('playing');
    expect(state.endReason).toBeNull();
    expect(state.players![1].eliminated).toBe(true);
    expect(state.players![2].eliminated ?? false).toBe(false);
  });

  it('is idempotent — a second resolution does not re-eliminate or re-log', () => {
    const state = buildHumanVsAis('elim-idem', 1, [[100, 5], [100, 0]]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);
    const logLength = state.activityLog.length;
    const ended = resolveCompetitiveSeatFailures(state);
    expect(ended).toBe(false);
    expect(state.players![1].eliminated).toBe(true);
    expect(state.activityLog.length).toBe(logLength);
  });

  it('an eliminated seat is no longer reported as failing', () => {
    const state = buildHumanVsAis('elim-no-report', 1, [[100, 5], [100, 0]]);
    state.turn = 2;
    eliminateCompetitiveSeat(state, 1);
    expect(checkCompetitiveSeatFailure(state)).toEqual([]);
  });
});

// ── AC4/AC5/AC6: business closure ───────────────────────────

describe('AC4/AC5/AC6 — owned businesses are closed', () => {
  it('clears ownership, removes the card from the grid and discards it', () => {
    const biz = makeBusiness({ id: 'ai-biz', baseIncome: 50 });
    const state = buildCompetitiveState({
      seed: 'elim-close',
      playerCount: 2,
      seatWallets: [
        { playerId: 0, coins: 500, reputation: 5 },
        { playerId: 1, coins: 500, reputation: 5 },
      ],
      slotOverrides: [{ slotIndex: 1, ownerId: 1, card: biz }],
    });
    state.turn = 2;

    const closed = closeEliminatedSeatBusinesses(state, 1);
    expect(closed).toBe(1);
    expect(state.streetGrid[1]).toBeNull();
    expect(state.ownerTaggedGrid![1].ownerId).toBeNull();
    expect(state.ownerTaggedGrid![1].card).toBeNull();
    expect(state.discardPile.some(c => c.id === 'ai-biz')).toBe(true);
  });

  it('does not change any wallet or action budget (no action cost)', () => {
    const biz = makeBusiness({ id: 'ai-biz-2' });
    const state = buildCompetitiveState({
      seed: 'elim-wallet',
      playerCount: 2,
      seatWallets: [
        { playerId: 0, coins: 500, reputation: 5 },
        { playerId: 1, coins: 500, reputation: 5 },
      ],
      slotOverrides: [{ slotIndex: 1, ownerId: 1, card: biz }],
    });
    const before = state.players!.map(p => ({ coins: p.coins, reputation: p.reputation, actionBudget: p.actionBudget }));
    closeEliminatedSeatBusinesses(state, 1);
    const after = state.players!.map(p => ({ coins: p.coins, reputation: p.reputation, actionBudget: p.actionBudget }));
    expect(after).toEqual(before);
  });

  it('closes all owned slots and leaves other seats untouched', () => {
    const bizA = makeBusiness({ id: 'ai-a', baseIncome: 50 });
    const bizB = makeBusiness({ id: 'ai-b', baseIncome: 60 });
    const humanBiz = makeBusiness({ id: 'human-biz', baseIncome: 70 });
    const state = buildCompetitiveState({
      seed: 'elim-multi-slot',
      playerCount: 2,
      slotOverrides: [
        { slotIndex: 1, ownerId: 1, card: bizA },
        { slotIndex: 6, ownerId: 1, card: bizB },
        { slotIndex: 3, ownerId: 0, card: humanBiz },
      ],
    });
    const closed = closeEliminatedSeatBusinesses(state, 1);
    expect(closed).toBe(2);
    expect(state.streetGrid[1]).toBeNull();
    expect(state.streetGrid[6]).toBeNull();
    // Human business is untouched.
    expect(state.streetGrid[3]?.id).toBe('human-biz');
    expect(state.ownerTaggedGrid![3].ownerId).toBe(0);
  });

  it('closing an eliminated seat business removes its income contribution', () => {
    const biz = makeBusiness({ id: 'income-biz', baseIncome: 100, synergyTypes: ['Food'] });
    const state = buildCompetitiveState({
      seed: 'elim-income',
      playerCount: 2,
      slotOverrides: [{ slotIndex: 1, ownerId: 1, card: biz }],
    });
    // Before closure the card is on the grid with an owner tag.
    expect(state.streetGrid[1]).not.toBeNull();
    expect(state.ownerTaggedGrid![1].ownerId).toBe(1);
    closeEliminatedSeatBusinesses(state, 1);
    // After closure no slot is owned by the eliminated seat.
    const stillOwned = state.ownerTaggedGrid!.some(t => t.ownerId === 1);
    expect(stillOwned).toBe(false);
    expect(state.streetGrid[1]).toBeNull();
  });
});

// ── AC3: rotation skip ──────────────────────────────────────

describe('AC3 — eliminated seats are skipped in rotation', () => {
  it('endCompetitiveMarketTurn skips an eliminated middle seat', () => {
    const state = buildCompetitiveState({ seed: 'rot-skip', playerCount: 3 });
    state.players![1].eliminated = true;
    executeCompetitiveWeekStart(state);
    expect(state.activePlayerId).toBe(0);
    endCompetitiveMarketTurn(state); // 0 -> 2 (skip 1)
    expect(state.activePlayerId).toBe(2);
    expect(state.phase).toBe('MarketPhase');
    endCompetitiveMarketTurn(state); // 2 -> InvestmentResolution
    expect(state.phase).toBe('InvestmentResolution');
  });

  it('getNextActivePlayerId skips eliminated seats', () => {
    const state = buildCompetitiveState({ seed: 'rot-next', playerCount: 4 });
    state.players![1].eliminated = true;
    state.players![2].eliminated = true;
    expect(getNextActivePlayerId(state, 0)).toBe(3);
    expect(getNextActivePlayerId(state, 3)).toBe(-1);
  });

  it('getFirstActivePlayerId skips an eliminated seat 0', () => {
    const state = buildCompetitiveState({ seed: 'rot-first', playerCount: 3 });
    state.players![0].eliminated = true;
    expect(getFirstActivePlayerId(state)).toBe(1);
  });

  it('getActivePlayerId resolves away from an eliminated active seat', () => {
    const state = buildCompetitiveState({ seed: 'rot-active', playerCount: 3 });
    state.players![1].eliminated = true;
    state.activePlayerId = 1;
    expect(getActivePlayerId(state)).toBe(0);
  });

  it('all seats eliminated → next is -1 (closing)', () => {
    const state = buildCompetitiveState({ seed: 'rot-all', playerCount: 2 });
    state.players![0].eliminated = true;
    state.players![1].eliminated = true;
    expect(getFirstActivePlayerId(state)).toBe(-1);
    expect(getNextActivePlayerId(state, 0)).toBe(-1);
  });
});

// ── AC7: multi-AI survivors keep rotating ───────────────────

describe('AC7 — multi-AI: survivors keep rotating', () => {
  it('eliminating one AI leaves the remaining AI seats active', () => {
    const state = buildHumanVsAis('multi-survivors', 3, [
      [500, 5],
      [500, 0], // collapses
      [500, 3],
      [500, 2],
    ]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);

    expect(state.players![1].eliminated).toBe(true);
    expect(state.players![2].eliminated ?? false).toBe(false);
    expect(state.players![3].eliminated ?? false).toBe(false);

    // Rotation: 0 -> 2 -> 3 -> closing (skipping 1).
    executeCompetitiveWeekStart(state);
    expect(state.activePlayerId).toBe(0);
    endCompetitiveMarketTurn(state);
    expect(state.activePlayerId).toBe(2);
    endCompetitiveMarketTurn(state);
    expect(state.activePlayerId).toBe(3);
    endCompetitiveMarketTurn(state);
    expect(state.phase).toBe('InvestmentResolution');
  });

  it('eliminates multiple failing AIs and leaves solvent survivors', () => {
    const state = buildHumanVsAis('multi-multiple', 3, [
      [500, 5],
      [500, 0],
      [-1, 3],
      [500, 2],
    ]);
    state.turn = 2;
    resolveCompetitiveSeatFailures(state);
    expect(state.players![1].eliminated).toBe(true);
    expect(state.players![2].eliminated).toBe(true);
    expect(state.players![3].eliminated ?? false).toBe(false);
  });
});

// ── Integration: elimination through the shared closing ─────

describe('Integration — elimination via the shared closing', () => {
  it('a collapsing AI is eliminated during closing while the human continues', () => {
    const biz = makeBusiness({ id: 'ai-collapse-biz', baseIncome: 50 });
    // 1 human + 2 AI so the game keeps playing after one elimination.
    const state = buildHumanVsAis('close-elim', 2, [[500, 5], [500, 0], [500, 4]]);
    state.turn = 2;
    state.ownerTaggedGrid![1] = { card: biz, ownerId: 1 };
    state.streetGrid[1] = biz;

    executeCompetitiveWeekStart(state);
    endCompetitiveMarketTurn(state);
    endCompetitiveMarketTurn(state);
    endCompetitiveMarketTurn(state);

    // Drive the closing directly (bypasses the income phase's RNG-dependent
    // incident, so the assertion is deterministic).
    resolveCompetitiveSeatFailures(state);
    expect(state.players![1].eliminated).toBe(true);
    expect(state.gameResult).toBe('playing');
    expect(state.streetGrid[1]).toBeNull();
  });

  it('a new competitive state has no eliminated seats', () => {
    const state = createCompetitiveState({ seed: 'fresh', playerCount: 2 });
    expect(state.players!.every(p => !p.eliminated)).toBe(true);
  });
});
