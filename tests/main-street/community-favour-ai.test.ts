/**
 * Community Favour (CG-0MSTOATDQ005XDET): AI strategy tests.
 *
 * Contract (MS-0MUVB2ZES005V83Y): the greedy rep→coins heuristic is an
 * **enablement + value/timing** gate, replacing the old "stalled + any
 * buffer" fallback:
 *  - AC2 — the exchange fires only when the gained coins enable affording a
 *    placement with positive greedy value that was unaffordable beforehand;
 *  - AC3 — that placement's reward (income + projected synergy over the
 *    planning horizon) must clear `FAVOUR_REP_TO_COINS_MIN_REWARD_RATIO` ×
 *    the reputation spent;
 *  - AC4 — the reputation buffer after the exchange is preserved
 *    (`FAVOUR_REP_TO_COINS_MIN_REP_BUFFER`); the same shared gate drives the
 *    competitive mirror so the two heuristics cannot diverge.
 *
 * AC1 (enumerateLegalActions) is unchanged and still covered: favour remains
 * a free, once-per-turn, MarketPhase-only exchange.
 */
import { describe, it, expect } from 'vitest';

import {
  setupMainStreetGame,
  createCompetitiveState,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  executeWeekStart,
  executeCompetitiveWeekStart,
  executeAction,
} from '../../src/MainStreetEngine';
import type { PlayerAction } from '../../src/MainStreetEngine';
import {
  enumerateLegalActions,
  scoreAction,
  scoreCompetitiveAction,
  GreedyStrategy,
  MainStreetAiPlayer,
  FAVOUR_REP_TO_COINS_MIN_REWARD_RATIO,
  FAVOUR_REP_TO_COINS_MIN_REP_BUFFER,
} from '../../src/MainStreetAiStrategy';
import { createSeededRng } from '@core-engine/SeededRng';

function createTestState(seed: string = 'cf-ai-test'): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  return state;
}

function favourActions(actions: PlayerAction[]): Array<{ type: 'community-favour'; direction: 'coins-to-rep' | 'rep-to-coins' }> {
  return actions.filter(a => a.type === 'community-favour') as Array<{ type: 'community-favour'; direction: 'coins-to-rep' | 'rep-to-coins' }>;
}

const REP_TO_COINS: PlayerAction = { type: 'community-favour', direction: 'rep-to-coins' };
const COINS_TO_REP: PlayerAction = { type: 'community-favour', direction: 'coins-to-rep' };

/**
 * Overrides every market card's cost, and every placeable
 * (business/community-space) card's base income, so the enablement and
 * value/timing gates can be exercised in isolation from the seeded market.
 */
function setMarketCards(
  state: MainStreetState,
  overrides: { cost?: number; baseIncome?: number },
): void {
  for (const card of state.market.cards) {
    if (overrides.cost !== undefined) {
      (card as { cost: number }).cost = overrides.cost;
    }
    if (
      overrides.baseIncome !== undefined &&
      (card.family === 'business' || card.family === 'community-space')
    ) {
      (card as { baseIncome: number }).baseIncome = overrides.baseIncome;
    }
  }
}

// ── AC1: Enumerated when legal ──────────────────────────────

describe('enumerateLegalActions: Community Favour', () => {
  it('includes both directions when resources suffice and gate unused', () => {
    const state = createTestState();
    state.resourceBank.coins = 1000;
    state.resourceBank.reputation = 1000;
    state.favourUsedThisTurn = false;

    const favs = favourActions(enumerateLegalActions(state));
    expect(favs.map(f => f.direction).sort()).toEqual(['coins-to-rep', 'rep-to-coins']);
  });

  it('excludes coins-to-rep when coins are insufficient', () => {
    const state = createTestState();
    state.resourceBank.coins = state.config.favourCoinsToRepCost - 1;
    state.resourceBank.reputation = 1000;
    state.favourUsedThisTurn = false;

    const favs = favourActions(enumerateLegalActions(state));
    expect(favs.some(f => f.direction === 'coins-to-rep')).toBe(false);
    expect(favs.some(f => f.direction === 'rep-to-coins')).toBe(true);
  });

  it('excludes rep-to-coins when reputation is insufficient', () => {
    const state = createTestState();
    state.resourceBank.coins = 1000;
    state.resourceBank.reputation = state.config.favourRepToCoinsRepCost - 1;
    state.favourUsedThisTurn = false;

    const favs = favourActions(enumerateLegalActions(state));
    expect(favs.some(f => f.direction === 'rep-to-coins')).toBe(false);
    expect(favs.some(f => f.direction === 'coins-to-rep')).toBe(true);
  });

  it('excludes both when the once-per-turn gate is spent', () => {
    const state = createTestState();
    state.resourceBank.coins = 1000;
    state.resourceBank.reputation = 1000;
    state.favourUsedThisTurn = true;

    expect(favourActions(enumerateLegalActions(state))).toHaveLength(0);
  });

  it('excludes both outside MarketPhase', () => {
    const state = createTestState();
    state.resourceBank.coins = 1000;
    state.resourceBank.reputation = 1000;
    state.favourUsedThisTurn = false;
    state.phase = 'IncomePhase';

    expect(favourActions(enumerateLegalActions(state))).toHaveLength(0);
  });

  it('stays available even when the daily action budget is spent (free action)', () => {
    const state = createTestState();
    state.resourceBank.coins = 1000;
    state.resourceBank.reputation = 1000;
    state.favourUsedThisTurn = false;
    state.actionsRemaining = 0;

    // Community Favour is a FREE once-per-turn exchange (CG-0MSTOATDQ005XDET),
    // so it stays available at zero remaining actions.
    const favs = favourActions(enumerateLegalActions(state));
    expect(favs.length).toBeGreaterThan(0);
    expect(favs.some(f => f.direction === 'coins-to-rep')).toBe(true);
    expect(favs.some(f => f.direction === 'rep-to-coins')).toBe(true);
    // end-turn still present so the AI loop terminates.
    expect(enumerateLegalActions(state).some(a => a.type === 'end-turn')).toBe(true);
  });
});

// ── AC2/AC3/AC4: scoreAction heuristic ──────────────────────

describe('scoreAction: Community Favour', () => {
  it('scores rep-to-coins above the default when the exchange enables a high-value placement', () => {
    const state = createTestState();
    state.resourceBank.coins = 0;
    // Every placeable market card becomes affordable after the +300 coins and
    // carries an income that clears the value/timing ratio.
    setMarketCards(state, { cost: 10, baseIncome: 1000 });
    state.resourceBank.reputation = state.config.favourRepToCoinsRepCost + 100;
    state.favourUsedThisTurn = false;

    expect(scoreAction(state, REP_TO_COINS)).toBeGreaterThan(1);
  });

  it('scores rep-to-coins at the default when the gained coins still cannot afford a profitable placement (AC2)', () => {
    const state = createTestState();
    state.resourceBank.coins = 0;
    // The placement is enormously valuable but still unaffordable after the
    // exchange, so the exchange enables nothing.
    setMarketCards(state, { cost: 100_000, baseIncome: 1000 });
    state.resourceBank.reputation = 1000;
    state.favourUsedThisTurn = false;

    expect(scoreAction(state, REP_TO_COINS)).toBe(1);
  });

  it('scores rep-to-coins at the default when the enabled placement is not early/high-value (AC3)', () => {
    const state = createTestState();
    state.resourceBank.coins = 0;
    // Affordable after the exchange, but the placement's reward is tiny
    // relative to the reputation spent.
    setMarketCards(state, { cost: 10, baseIncome: 1 });
    state.resourceBank.reputation = 1000;
    state.favourUsedThisTurn = false;

    expect(scoreAction(state, REP_TO_COINS)).toBe(1);
  });

  it('scores rep-to-coins at the low default when no placement is newly enabled', () => {
    const state = createTestState();
    // Cheapest card costs 1 and the player already has enough coins — the
    // exchange enables nothing (it is not a stalled turn).
    setMarketCards(state, { cost: 1 });
    state.resourceBank.coins = state.config.favourCoinsToRepCost + 1;
    state.resourceBank.reputation = 1000;
    state.favourUsedThisTurn = false;

    expect(scoreAction(state, REP_TO_COINS)).toBe(1);
  });

  it('preserves the reputation buffer: declines when the exchange would leave no reserve (AC4)', () => {
    const state = createTestState();
    state.resourceBank.coins = 0;
    setMarketCards(state, { cost: 10, baseIncome: 1000 });
    // Exactly the rep cost: converting would drop reputation to 0 and trigger
    // reputation-collapse loss — must NOT be recommended.
    state.resourceBank.reputation = state.config.favourRepToCoinsRepCost;
    state.favourUsedThisTurn = false;

    expect(FAVOUR_REP_TO_COINS_MIN_REP_BUFFER).toBeGreaterThanOrEqual(1);
    expect(scoreAction(state, REP_TO_COINS)).toBe(1);
  });

  it('takes the exchange when exactly the minimum buffer remains (AC4 boundary)', () => {
    const state = createTestState();
    state.resourceBank.coins = 0;
    setMarketCards(state, { cost: 10, baseIncome: 1000 });
    state.resourceBank.reputation =
      state.config.favourRepToCoinsRepCost + FAVOUR_REP_TO_COINS_MIN_REP_BUFFER;
    state.favourUsedThisTurn = false;

    expect(scoreAction(state, REP_TO_COINS)).toBeGreaterThan(1);
  });

  it('scores coins-to-rep at the low default', () => {
    const state = createTestState();
    state.resourceBank.coins = 1000;
    state.resourceBank.reputation = 1000;
    state.favourUsedThisTurn = false;

    expect(scoreAction(state, COINS_TO_REP)).toBe(1);
  });

  it('the hint action is legal and scoreable in an unaffordable market', () => {
    const state = createTestState();
    state.resourceBank.coins = 0;
    state.resourceBank.reputation = 1000;
    state.favourUsedThisTurn = false;
    state.actionsRemaining = 1;

    const legal = enumerateLegalActions(state);
    expect(legal.some(a => a.type === 'end-turn')).toBe(true);
    expect(legal.some(a => a.type === 'community-favour' && a.direction === 'rep-to-coins')).toBe(true);
  });
});

// ── AC2/AC3/AC4: competitive mirror uses the same gate ──────

describe('scoreCompetitiveAction: Community Favour mirror', () => {
  function competitiveState(): MainStreetState {
    const state = createCompetitiveState({ seed: 'cf-competitive', playerCount: 2 });
    executeCompetitiveWeekStart(state);
    return state;
  }

  it('takes rep-to-coins when the exchange enables a high-value placement', () => {
    const state = competitiveState();
    const player = state.players![0];
    player.coins = 0;
    player.reputation = state.config.favourRepToCoinsRepCost + 100;
    state.favourUsedThisTurn = false;
    setMarketCards(state, { cost: 10, baseIncome: 1000 });

    expect(scoreCompetitiveAction(state, REP_TO_COINS, 0)).toBeGreaterThan(1);
  });

  it('declines rep-to-coins under the same enablement and buffer gates', () => {
    const state = competitiveState();
    const player = state.players![0];
    player.coins = 0;
    player.reputation = state.config.favourRepToCoinsRepCost + 100;
    state.favourUsedThisTurn = false;

    // Unaffordable after the exchange ⇒ no enablement.
    setMarketCards(state, { cost: 100_000, baseIncome: 1000 });
    expect(scoreCompetitiveAction(state, REP_TO_COINS, 0)).toBe(1);

    // Enabled but no reputation buffer ⇒ decline.
    setMarketCards(state, { cost: 10, baseIncome: 1000 });
    player.reputation = state.config.favourRepToCoinsRepCost;
    expect(scoreCompetitiveAction(state, REP_TO_COINS, 0)).toBe(1);
  });
});

// ── AC2/AC4: AI executes the favour decision end-to-end ─────

describe('AI Community Favour integration', () => {
  it('takes a free Community Favour exchange when it enables a high-value placement', () => {
    const state = createTestState();
    state.resourceBank.coins = 0;
    state.resourceBank.reputation = 1000;
    setMarketCards(state, { cost: 10, baseIncome: 1000 });
    state.favourUsedThisTurn = false;
    state.actionsRemaining = 0; // only the free exchange remains

    const aiPlayer = new MainStreetAiPlayer(GreedyStrategy, createSeededRng(1234));
    const action = aiPlayer.chooseAction(state);
    expect(action).toEqual(REP_TO_COINS);

    const beforeCoins = state.resourceBank.coins;
    const beforeActions = state.actionsRemaining;
    executeAction(state, action);

    expect(state.favourUsedThisTurn).toBe(true);
    expect(state.resourceBank.coins).toBe(
      beforeCoins + state.config.favourRepToCoinsCoinGain,
    );
    // Free action: the exchange does not touch the daily budget.
    expect(state.actionsRemaining).toBe(beforeActions);
  });

  it('declines the exchange and ends the turn when it enables no profitable placement', () => {
    const state = createTestState();
    state.resourceBank.coins = 0;
    state.resourceBank.reputation = 1000;
    setMarketCards(state, { cost: 100_000, baseIncome: 1000 });
    state.favourUsedThisTurn = false;
    state.actionsRemaining = 0;

    const aiPlayer = new MainStreetAiPlayer(GreedyStrategy, createSeededRng(1234));
    expect(aiPlayer.chooseAction(state).type).toBe('end-turn');
    expect(state.favourUsedThisTurn).toBe(false);
  });

  it('is deterministic for a given seed and state', () => {
    const build = (): { action: PlayerAction; state: MainStreetState } => {
      const state = createTestState();
      state.resourceBank.coins = 0;
      state.resourceBank.reputation = 1000;
      setMarketCards(state, { cost: 10, baseIncome: 1000 });
      state.favourUsedThisTurn = false;
      state.actionsRemaining = 0;
      const aiPlayer = new MainStreetAiPlayer(GreedyStrategy, createSeededRng(1234));
      return { action: aiPlayer.chooseAction(state), state };
    };

    const first = build();
    const second = build();
    expect(second.action).toEqual(first.action);
  });

  it('exposes the calibrated value/timing ratio as a positive constant (AC3)', () => {
    expect(FAVOUR_REP_TO_COINS_MIN_REWARD_RATIO).toBeGreaterThan(1);
  });
});
