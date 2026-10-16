/**
 * Main Street: Deterministic AI piggyback join-fully policy
 *
 * F4 leaf MS-0MV8BG2CA007JDEX of epic MS-0MUYC47EL005Z69H. Covers:
 *
 *  AC1 — `decidePiggyback` returns `'join' | 'free-ride'` deterministically
 *        with no RNG; identical inputs → identical outputs and a full
 *        raise+resolve replay is byte-identical.
 *  AC2 — the shared `canAffordPiggybackJoinFully` predicate gates both the
 *        application path and the AI policy; the AI never joins when the
 *        charge is unaffordable.
 *  AC3 — the headless competitive/AI day loop (`resolveCompetitivePendingPiggyback`,
 *        the scene `runCompetitiveClosing`, and the Monte Carlo harness)
 *        auto-resolves pending decisions via the AI policy so the sim never
 *        stalls.
 *  AC4 — affordability edges, heuristic thresholds (reward vs the 150% charge
 *        and the difficulty-visible liquidity floor) and a competitive Monte
 *        Carlo harness check.
 *
 * Fixtures set owner reputation to 0 so the reputation coin multiplier is 1
 * and expected credits are exact integer values (deterministic math checks).
 */
import { describe, it, expect } from 'vitest';

import {
  createCompetitiveState,
  type MainStreetState,
} from '../../src/MainStreetState';
import { bindCompetitiveSeat } from '../../src/MainStreetAiStrategy';
import {
  canAffordPiggybackJoinFully,
  decidePiggyback,
  decidePiggybackForAllSeats,
  decidePiggybackForSeat,
  executeAction,
  piggybackBalanceFloor,
  piggybackJoinFullyCost,
  PIGGYBACK_DIFFICULTY_PROFILES,
  raisePiggybackDecisions,
  resolveCompetitivePendingPiggyback,
  resolveAllPendingPiggybacks,
  resolveCompetitiveClosingPhases,
  applyPiggybackJoinFully,
} from '../../src/MainStreetEngine';
import {
  decidePiggyback as decidePiggybackViaAi,
  decidePiggybackForSeat as decidePiggybackForSeatViaAi,
} from '../../src/MainStreetAiStrategy';
import { runCompetitiveSeed } from '../../src/MainStreetMonteCarlo';
import type { EventCard } from '../../src/MainStreetCards';
import type { PendingPiggybackDecision } from '../../src/MainStreetStateTypes';

// ── Helpers ───────────────────────────────────────────────────────

function makeEvent(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event' as const,
    id: overrides.id ?? 'evt-test',
    name: overrides.name ?? 'Test Event',
    trigger: overrides.trigger ?? 'Investment',
    cost: overrides.cost ?? 300,
    effect: overrides.effect ?? 'Test effect',
    target: overrides.target ?? 'All',
    coinDelta: overrides.coinDelta ?? 0,
    reputationDelta: overrides.reputationDelta ?? 0,
    ...overrides,
  } as EventCard;
}

/**
 * A flat `All` organiser event whose projected own-board reward is exact and
 * independent of board composition (`coins = coinDelta`, `rep = reputationDelta`
 * at reputation 0).
 */
function eligibleAllEvent(
  coinDelta: number,
  reputationDelta: number,
  overrides: Partial<EventCard> = {},
): EventCard {
  return makeEvent({
    id: 'evt-eligible-all',
    name: 'Eligible Gathering',
    trigger: 'Investment',
    target: 'All',
    coinDelta,
    reputationDelta,
    cost: 300,
    piggybackable: true,
    ...overrides,
  });
}

/** A decision object with the default 300-coin paid cost (charge 450). */
function decisionFor(
  seatId: number,
  event: EventCard,
  paidCost = 300,
): PendingPiggybackDecision {
  return { seatId, event, paidCost, chosenJoin: null, resolved: false };
}

/**
 * Creates a competitive state with clean wallets: every seat at 1000 coins /
 * 0 reputation (multiplier = 1); the shared host wallet is padded so host-loss
 * checks never fire during fixtures. Phase is MarketPhase with a fresh action
 * budget so dispatch paths are legal.
 */
function compState(seed: string, playerCount: number): MainStreetState {
  const state = createCompetitiveState({ seed, playerCount });
  state.resourceBank.coins = 100000;
  state.resourceBank.reputation = 1000;
  for (const p of state.players!) {
    p.coins = 1000;
    p.reputation = 0;
  }
  state.phase = 'MarketPhase';
  state.actionsRemaining = 5;
  state.activePlayerId = 0;
  return state;
}

/** Plays `event` for `seatId` through `executeAction` (`play-event-from-hand`). */
function playViaExecuteAction(
  state: MainStreetState,
  seatId: number,
  event: EventCard,
): void {
  state.activePlayerId = seatId;
  state.phase = 'MarketPhase';
  state.actionsRemaining = 5;
  bindCompetitiveSeat(state, seatId);
  state.hand.push(event);
  executeAction(state, { type: 'play-event-from-hand', handIndex: state.hand.length - 1 });
}

// ── AC1: determinism, no RNG ─────────────────────────────────────

describe('AC1 — decidePiggyback is deterministic and consumes no RNG', () => {
  it('returns identical outputs for identical inputs across repeated calls', () => {
    const state = compState('pb-ai-determ', 2);
    const event = eligibleAllEvent(400, 200); // reward 600 > charge 450
    const decision = decisionFor(1, event);

    const first = decidePiggyback(state, decision);
    const second = decidePiggyback(state, decision);

    expect(first).toBe('join');
    expect(second).toBe(first);
  });

  it('consumes no RNG when evaluating the policy', () => {
    const state = compState('pb-ai-no-rng', 2);
    const before = state.rngCalls;

    for (let i = 0; i < 25; i++) {
      decidePiggyback(state, decisionFor(1, eligibleAllEvent(400, 200)));
    }

    expect(state.rngCalls).toBe(before);
  });

  it('is exported through the MainStreetAiStrategy public API (AC5)', () => {
    const state = compState('pb-ai-public-api', 2);
    const decision = decisionFor(1, eligibleAllEvent(400, 200));
    expect(decidePiggybackViaAi(state, decision)).toBe(decidePiggyback(state, decision));
    expect(decidePiggybackForSeatViaAi(decision, state)).toBe(
      decidePiggybackForSeat(decision, state),
    );
  });

  it('a full raise+resolve replay is byte-identical and consumes zero RNG', () => {
    const build = (seed: string) => {
      const state = compState(seed, 3);
      playViaExecuteAction(state, 0, eligibleAllEvent(100, 200));
      return state;
    };
    const a = build('pb-ai-replay');
    const b = build('pb-ai-replay');
    const rngBefore = a.rngCalls;

    const ra = resolveAllPendingPiggybacks(a, decidePiggybackForSeat);
    const rb = resolveAllPendingPiggybacks(b, decidePiggybackForSeat);

    expect(ra).toEqual(rb);
    expect(a.rngCalls).toBe(rngBefore);
    expect(a.rngCalls).toBe(b.rngCalls);
    for (let pid = 1; pid < 3; pid++) {
      expect(a.players![pid].coins).toBe(b.players![pid].coins);
      expect(a.players![pid].reputation).toBe(b.players![pid].reputation);
    }
  });
});

// ── AC2: shared affordability predicate ──────────────────────────

describe('AC2 — shared affordability predicate gates the policy and the engine', () => {
  it('is exact at the 150% charge boundary', () => {
    const state = compState('pb-ai-afford-boundary', 2);
    const charge = piggybackJoinFullyCost(300); // 450

    state.players![1].coins = charge;
    expect(canAffordPiggybackJoinFully(state, 1, 300)).toBe(true);
    state.players![1].coins = charge - 1;
    expect(canAffordPiggybackJoinFully(state, 1, 300)).toBe(false);
  });

  it('never joins when the charge is unaffordable, however lucrative the reward', () => {
    const event = eligibleAllEvent(100_000, 100_000);
    const state = compState('pb-ai-afford-policy', 2);
    state.players![1].coins = 100; // far below the 450 charge

    expect(decidePiggyback(state, decisionFor(1, event))).toBe('free-ride');
  });

  it('applies the same predicate on the engine path (no partial charge)', () => {
    const event = eligibleAllEvent(400, 200);
    const state = compState('pb-ai-afford-engine', 2);
    state.players![1].coins = 449; // just below the 450 charge

    const result = applyPiggybackJoinFully(state, event, 1, 300);
    expect(result.applied).toBe(false);
    expect(result.charge).toBe(450);
    expect(state.players![1].coins).toBe(449); // untouched — never partial

    state.players![1].coins = 450; // exactly affordable
    const ok = applyPiggybackJoinFully(state, event, 1, 300);
    expect(ok.applied).toBe(true);
    expect(state.players![1].coins).toBe(450 - 450 + 400); // charge then reward
  });
});

// ── AC4: heuristic thresholds ────────────────────────────────────

describe('AC4 — heuristic thresholds (reward vs charge; difficulty floor)', () => {
  it('joins only when the 100% reward strictly exceeds the 150% charge', () => {
    const state = compState('pb-ai-threshold', 2); // Medium, floor 150

    // reward 450 == charge 450 → free-ride (must strictly exceed).
    expect(decidePiggyback(state, decisionFor(1, eligibleAllEvent(250, 200)))).toBe(
      'free-ride',
    );
    // reward 449 < charge → free-ride.
    expect(decidePiggyback(state, decisionFor(1, eligibleAllEvent(249, 200)))).toBe(
      'free-ride',
    );
    // reward 451 > charge → join.
    expect(decidePiggyback(state, decisionFor(1, eligibleAllEvent(251, 200)))).toBe('join');
  });

  it('uses the difficulty-visible liquidity floor (Medium, startingCoins 600)', () => {
    const event = eligibleAllEvent(400, 200); // reward 600 > charge 450
    const state = compState('pb-ai-floor', 2);
    expect(state.config.difficultyName).toBe('Medium');
    expect(piggybackBalanceFloor(state, 'Medium')).toBe(150);

    // remaining 150 == floor → join (free-ride only when strictly below).
    state.players![1].coins = 450 + 150;
    expect(decidePiggyback(state, decisionFor(1, event))).toBe('join');
    // remaining 149 < floor → free-ride.
    state.players![1].coins = 450 + 149;
    expect(decidePiggyback(state, decisionFor(1, event))).toBe('free-ride');
  });

  it('is difficulty-aware: the same affordable state can free-ride on Easy but join on Hard', () => {
    const event = eligibleAllEvent(400, 200); // reward 600 > charge 450
    const state = compState('pb-ai-difficulty', 2);
    state.players![1].coins = 520; // remaining 70 after the 450 charge
    const decision = decisionFor(1, event);

    // Floors: Easy 300, Medium 150, Hard 60 (600 × ratio).
    expect(piggybackBalanceFloor(state, 'Easy')).toBe(300);
    expect(piggybackBalanceFloor(state, 'Medium')).toBe(150);
    expect(piggybackBalanceFloor(state, 'Hard')).toBe(60);

    expect(decidePiggyback(state, decision, 'Easy')).toBe('free-ride');
    expect(decidePiggyback(state, decision, 'Medium')).toBe('free-ride');
    expect(decidePiggyback(state, decision, 'Hard')).toBe('join');
  });

  it('exposes the difficulty profile table for tuning', () => {
    expect(PIGGYBACK_DIFFICULTY_PROFILES.Easy.minBalanceFloorRatio).toBeGreaterThan(
      PIGGYBACK_DIFFICULTY_PROFILES.Hard.minBalanceFloorRatio,
    );
  });
});

// ── AC3: seat-aware headless resolution ──────────────────────────

describe('AC3 — seat-aware auto-resolution for the headless day loop', () => {
  it('decidePiggybackForSeat applies the policy to AI seats and free-rides the human seat', () => {
    const state = compState('pb-ai-seat-aware', 2);
    expect(state.players![0].controller).toBe('human');
    expect(state.players![1].controller).toBe('ai');
    const event = eligibleAllEvent(400, 200); // reward 600 > charge 450

    expect(decidePiggybackForSeat(decisionFor(1, event), state)).toBe(true);
    expect(decidePiggybackForSeat(decisionFor(0, event), state)).toBe(false);
  });

  it('decidePiggybackForAllSeats applies the policy to every seat (Monte Carlo harness)', () => {
    const state = compState('pb-ai-all-seats', 2);
    const event = eligibleAllEvent(400, 200);

    expect(decidePiggybackForAllSeats(decisionFor(0, event), state)).toBe(true);
    expect(decidePiggybackForAllSeats(decisionFor(1, event), state)).toBe(true);
  });

  it('resolveCompetitivePendingPiggyback defaults to the AI policy (AI joins, human free-rides)', () => {
    // Two identical states: A uses the default (AI policy), B forces free-ride.
    const organiser = eligibleAllEvent(400, 200);
    const a = compState('pb-ai-headless', 2);
    playViaExecuteAction(a, 0, organiser);
    a.phase = 'InvestmentResolution';
    const b = compState('pb-ai-headless', 2);
    playViaExecuteAction(b, 0, organiser);
    b.phase = 'InvestmentResolution';

    // Resolve ONLY the piggyback decisions so wallet deltas isolate the
    // join-vs-free-ride difference (the closing then collects
    // reputation-scaled income, which would otherwise differ because A's
    // seat 1 reaches the closing with +100 more reputation than B's).
    const resolutionsA = resolveAllPendingPiggybacks(a, decidePiggybackForSeat);
    const resolutionsB = resolveAllPendingPiggybacks(b, () => false);

    expect(resolutionsA).toHaveLength(1);
    expect(resolutionsB).toHaveLength(1);
    expect(resolutionsA[0].joined).toBe(true);
    expect(resolutionsB[0].joined).toBe(false);
    expect(a.pendingPiggyback ?? null).toBeNull();
    expect(b.pendingPiggyback ?? null).toBeNull();

    // Seat 1 (AI) joined in A: pays exactly the 150% charge (450) and earns
    // the 400 Coin / 200 rep 100% reward, versus B's 200 Coin / 100 rep
    // free-ride. No action point is spent in either branch.
    expect(resolutionsA[0].charge).toBe(450);
    expect(resolutionsA[0].reward.coins).toBe(400);
    expect(resolutionsA[0].reward.reputation).toBe(200);
    expect(a.players![1].coins).toBe(1000 - 450 + 400);
    expect(a.players![1].reputation).toBe(200);
    expect(b.players![1].coins).toBe(1000 + 200);
    expect(b.players![1].reputation).toBe(100);

    // Isolation: the acting player's wallet is identical in both branches
    // (piggyback decisions never touch the acting player, AC4).
    expect(a.players![0].coins).toBe(b.players![0].coins);
    expect(a.players![0].reputation).toBe(b.players![0].reputation);
  });

  it('runCompetitiveClosing (scene/driveAiSeatsUntilClosing path) settles via the AI policy', () => {
    const state = compState('pb-ai-scene', 2);
    playViaExecuteAction(state, 0, eligibleAllEvent(400, 200));
    state.phase = 'InvestmentResolution';

    const paused = resolveCompetitiveClosingPhases(state);
    expect(paused.piggybackPending).toBe(true);

    // Default resolution path — the AI seat joins.
    const result = resolveCompetitivePendingPiggyback(state);
    expect(result).not.toBeNull();
    // The seat paid the 450 charge during the pause resolution.
    expect(state.pendingPiggyback ?? null).toBeNull();

    // Both the acting seat (0) and the join-fully piggybacker (1) earned the
    // identical +400 Coin / +200 rep own-board reward for this flat `All`
    // event; seat 1 additionally paid the exact 150% charge (450) and runs
    // the identical post-resolution closing (shared reputation 200), so the
    // piggybacker's wallet is the acting seat's minus exactly the charge.
    // (Re-projecting the reward AFTER resolution would double-count the
    // reputation already credited — assert the applied wallet deltas instead.)
    expect(state.players![1].coins).toBe(state.players![0].coins - 450);
    expect(state.players![1].reputation).toBe(state.players![0].reputation);
  });

  it('raisePiggybackDecisions does not stall: an AI seat can always be settled', () => {
    const state = compState('pb-ai-no-stall', 3);
    const raised = raisePiggybackDecisions(state, eligibleAllEvent(400, 200), 0, 300);
    expect(raised).toBe(true);

    const resolutions = resolveAllPendingPiggybacks(state, decidePiggybackForSeat);
    expect(resolutions).toHaveLength(2);
    expect(resolutions.every((r) => r.joined)).toBe(true);
    expect(state.pendingPiggyback ?? null).toBeNull();
  });
});

// ── AC4: Monte Carlo harness ─────────────────────────────────────

describe('AC4 — competitive Monte Carlo harness exercises the AI path', () => {
  it('is deterministic across identical seeds with the AI policy wired in', () => {
    const runA = runCompetitiveSeed('pb-ai-mc', 40);
    const runB = runCompetitiveSeed('pb-ai-mc', 40);

    expect(runA.turns).toBeGreaterThan(0);
    expect(runA.turns).toBe(runB.turns);
    expect(runA.winnerId).toBe(runB.winnerId);
    for (let pid = 0; pid < runA.players.length; pid++) {
      expect(runA.players[pid].finalCoins).toBe(runB.players[pid].finalCoins);
      expect(runA.players[pid].finalReputation).toBe(runB.players[pid].finalReputation);
      expect(runA.players[pid].finalScore).toBe(runB.players[pid].finalScore);
    }
  });

  it('completes a batch without stalling on pending piggyback decisions', () => {
    const seeds = Array.from({ length: 12 }, (_, i) => `pb-ai-batch-${i}`);
    for (const seed of seeds) {
      const run = runCompetitiveSeed(seed, 40);
      expect(run.turns).toBeGreaterThan(0);
      expect(run.players).toHaveLength(2);
    }
  });
});
