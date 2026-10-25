/**
 * AI: Event-Choice Evaluation (CG-0MTT7EQZP005NWGQ / parent
 * CG-0MTSHG8RP008E128; reworked for the arbitrary-option model in
 * MS-0MV8KQSF1004E53Y)
 *
 * Unit tests for the AI's option decision when it encounters a storyline
 * choice during simulation, under the migrated option model:
 *
 * - Every compiled option applies the event's own effect (CSV content is all
 *   effectPolicy 'apply' — producer Q4=B), so the AI's only lever is the
 *   option's successor-candidate chain.
 * - `decideEventChoice` returns the **option index** whose pessimistic
 *   (worst-candidate) chain severity is lowest — terminal options (0) win —
 *   deterministically and RNG-free, on arbitrary option lists (any count).
 * - `resolveAiEventChoice` completes the deferred closing so sims never stall.
 * - Cost-aware scoring (MS-0MVNU5BRZ0087L1E): `decideEventChoice` answers
 *   with an index into the **presented** option list (the draw-time
 *   cost-filtered snapshot) and projects `cost` / `extraEffect` deltas into
 *   the option value. The contract cases below are authored `it.fails`
 *   (repo red-phase tracer-bullet convention) against the chain-severity-only
 *   policy and are flipped to plain `it` by MS-0MVNU5EEC006ZCTF.
 *
 * @module
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import type { EventCard } from '../../src/MainStreetCardsTypes';
import {
  loadTemplatesFromCsv,
  resetTemplatesToDefault,
} from '../../src/MainStreetCards';
import {
  processEndOfTurn,
  type TurnResult,
} from '../../src/MainStreetEngine';
import {
  decideEventChoice,
  resolveAiEventChoice,
  projectEventCoinDelta,
} from '../../src/MainStreetAiStrategy';
import {
  createPendingStorylineChoice,
  getPendingStorylineOptions,
  getStorylineOptions,
  registerStorylineOptions,
  resetStorylineRegistry,
} from '../../src/MainStreetStoryline';
import type { PendingEventChoice } from '../../src/MainStreetState';
import type { DifficultyName } from '../../src/MainStreetDifficulty';
import type { StorylineOption } from '../../src/MainStreetCardsTypes';

// ── Synthetic chain templates (registry lookups for severity) ──

const CHAIN_CSV = [
  'family,id,name,cost,baseIncome,synergyTypes,upgradePath,maxLevel,reputationPerTurn,synergyCoinBonus,synergyRepBonus,description,tier,trigger,effect,target,targetSynergy,coinDelta,reputationDelta,duration,effectType,multiplier,targetBusiness,incomeBonus,synergyRangeBonus,requiredLevel,reputationBonus,newDisplayName,ongoingCost,handSlotsAdded,refreshCostDiscount,actionsPerTurn,peekOncePerTurn,upgradeCostDiscount,art_notes,hasChoices,acceptNextCardId,rejectNextCardId,options,storylineId,storylineTitle',
  'event,evt-chain-bad,Bad Escalation,0,,,,,,,,,1,Incident,Very bad,All,,-1000,0,,,,,,,,,,,,,,,,,,,,',
  'event,evt-chain-mid,Mid Escalation,0,,,,,,,,,1,Incident,Mid,All,,-200,0,,,,,,,,,,,,,,,,,,,,',
  'event,evt-chain-small,Small Escalation,0,,,,,,,,,1,Incident,Small,All,,-50,0,,,,,,,,,,,,,,,,,,,,',
  'event,evt-chain-positive,Positive Esc,0,,,,,,,,,1,Incident,Positive,All,,50,0,,,,,,,,,,,,,,,,,,,,',
].join('\n');

function makeEvent(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event',
    id: 'evt-cur',
    name: 'Current Event',
    trigger: 'Incident',
    cost: 0,
    effect: 'Lose coins',
    target: 'All',
    coinDelta: -300,
    reputationDelta: 0,
    hasChoices: true,
    ...overrides,
  } as EventCard;
}

function makeState(difficulty: 'Easy' | 'Medium' | 'Hard', coins = 600): MainStreetState {
  const state = setupMainStreetGame({ seed: `ai-choice-${difficulty}`, difficulty });
  loadTemplatesFromCsv(CHAIN_CSV);
  state.resourceBank.coins = coins;
  return state;
}

afterEach(() => {
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

// ── The shared policy: least-harmful chain wins ─────────────

describe('decideEventChoice picks the least-harmful option chain', () => {
  it('returns the option index, not an accept/reject token', () => {
    const state = makeState('Medium');
    expect(typeof decideEventChoice(state, makeEvent(), 'Medium')).toBe('number');
  });

  it('prefers a terminal option (severity 0) over any escalation', () => {
    const state = makeState('Easy');
    // Reject targets a small card; accept is terminal → accept (index 0).
    const evt = makeEvent({ acceptNextCardId: null, rejectNextCardId: 'evt-chain-small' });
    expect(decideEventChoice(state, evt, 'Easy')).toBe(0);

    // Accept escalates to a big card; reject is terminal → reject (index 1).
    const evt2 = makeEvent({ acceptNextCardId: 'evt-chain-bad', rejectNextCardId: null });
    expect(decideEventChoice(state, evt2, 'Hard')).toBe(1);
  });

  it('compares chain severities across options (worst candidate drives the score)', () => {
    const state = makeState('Medium');
    // Options [Accept→bad, Reject→small]; both apply the effect → Reject (1).
    const evt = makeEvent({ acceptNextCardId: 'evt-chain-bad', rejectNextCardId: 'evt-chain-small' });
    expect(decideEventChoice(state, evt, 'Medium')).toBe(1);
  });

  it('is deterministic and difficulty-invariant across the ladder', () => {
    const stateM = makeState('Medium');
    const stateH = makeState('Hard');
    const evt = makeEvent({ acceptNextCardId: 'evt-chain-mid', rejectNextCardId: 'evt-chain-small' });
    const medium = decideEventChoice(stateM, evt, 'Medium');
    // Same seed ⇒ same state ⇒ same decision on Hard.
    expect(decideEventChoice(stateH, evt, 'Hard')).toBe(medium);
    expect(medium).toBe(1);
  });

  it('handles missing/unknown chain templates without crashing (unknown → severity 0)', () => {
    const state = makeState('Hard', 600);
    const evt = makeEvent({ acceptNextCardId: 'evt-chain-bad', rejectNextCardId: 'evt-missing-too' });
    // Reject's unknown candidate contributes 0 → reject (index 1) is safest.
    expect(decideEventChoice(state, evt, 'Hard')).toBe(1);
  });

  it('returns 0 for a single-option or non-choice event (no crash)', () => {
    const state = makeState('Easy');
    expect(decideEventChoice(state, makeEvent({ hasChoices: false }), 'Easy')).toBe(0);
  });
});

// ── Arbitrary multi-option nodes (F7 core) ───────────────────

describe('decideEventChoice over an arbitrary multi-option node (F7)', () => {
  it('picks the terminal option among ≥3 labelled options', () => {
    const state = makeState('Hard');
    // Three options: Negotiate→[small], Walk away→[], Escalate→[bad].
    const evt = makeEvent({
      options: 'Negotiate|evt-chain-small;Walk away|;Escalate|evt-chain-bad',
    });
    expect(decideEventChoice(state, evt, 'Hard')).toBe(1); // Walk away (terminal)
  });

  it('picks the least-harmful candidate set when no option is terminal', () => {
    const state = makeState('Medium');
    const evt = makeEvent({
      options: 'Negotiate|evt-chain-bad,evt-chain-mid;Settle|evt-chain-small',
    });
    // Negotiate's worst candidate is -1000; Settle's worst is -50 → Settle.
    expect(decideEventChoice(state, evt, 'Medium')).toBe(1);
  });

  it('stays deterministic on a random fan-out candidate set (no RNG)', () => {
    const state = makeState('Easy');
    const evt = makeEvent({
      options: 'Fight|evt-chain-bad,evt-chain-small;Flee|evt-chain-mid',
    });
    const a = decideEventChoice({ ...state } as MainStreetState, evt, 'Easy');
    // The decision never consults state.rng(): repeated identical calls agree
    // even on structurally-identical state objects.
    expect(typeof a).toBe('number');
    expect(evt.options).toBeDefined();
  });
});

// ── Cost-aware scoring over the presented option list ───────
//
// Test-first contract for MS-0MVNU5EEC006ZCTF (parent MS-0MVI0APQY000OIOY).
// The target signature is
//
//   decideEventChoice(state, event, difficulty, pending?)
//
// and it must return an index into the **presented** option list: the frozen
// draw-time snapshot (`getPendingStorylineOptions(pending, state)`) when a
// pending choice is supplied, otherwise the state-aware compile
// (`getStorylineOptions(event, state)`) that applies draw-time condition and
// cost filtering. Option value is the chain severity *plus* the option's
// declared `cost` *minus* its `extraEffect`, with reputation weighted by
// REPUTATION_SEVERITY_SCALE (100) — the same weight `eventSeverity` uses —
// lowest value wins, ties resolve to the lowest index.

/**
 * Target contract for {@link decideEventChoice}: the implementing child adds
 * the optional fourth `pending` parameter. The cast keeps this file compiling
 * (and `npm run build` green) until then; the 3-argument form stays valid, so
 * the current policy is exercised exactly as today.
 */
type PresentedDecide = (
  state: MainStreetState,
  event: EventCard,
  difficulty: DifficultyName,
  pending?: PendingEventChoice | null,
) => number;

const decidePresented = decideEventChoice as PresentedDecide;

describe('cost-aware scoring', () => {
  /** Registers a cost-bearing option list (registry reset in `afterEach`). */
  function registerOptions(eventId: string, options: StorylineOption[]): void {
    registerStorylineOptions(eventId, options);
  }

  it.fails(
    'never selects a cost-gated option the draw-time filter dropped',
    () => {
      // 200 coins: the 900-coin bribe is unaffordable, so the presented list
      // is [Blame (severe chain), Take the hit (terminal)].
      const state = makeState('Medium', 200);
      const evt = makeEvent({ id: 'evt-cost-gate' });
      registerOptions('evt-cost-gate', [
        {
          label: 'Bribe the inspector',
          successorIds: [],
          effectPolicy: 'apply',
          cost: { coins: 900 },
        },
        {
          label: 'Blame the supplier',
          successorIds: ['evt-chain-bad'],
          effectPolicy: 'apply',
        },
        { label: 'Take the hit', successorIds: [], effectPolicy: 'apply' },
      ]);

      // Sanity: this is exactly what the player would be offered.
      const presented = getStorylineOptions(evt, state);
      expect(presented.map((o) => o.label)).toEqual([
        'Blame the supplier',
        'Take the hit',
      ]);

      const choice = decidePresented(state, evt, 'Medium');
      // The returned index addresses the presented list, not the raw one.
      expect(presented[choice]).toBeDefined();
      // The dropped bribe is the safest chain, yet it must never be chosen:
      // 'Take the hit' (terminal) is index 1 of the presented list.
      expect(choice).toBe(1);
    },
  );

  it.fails(
    'reads the frozen draw-time snapshot for a pending choice',
    () => {
      const state = makeState('Medium', 600);
      const evt = makeEvent({ id: 'evt-cost-frozen' });
      registerOptions('evt-cost-frozen', [
        {
          label: 'Pay the fine',
          successorIds: ['evt-chain-bad'],
          effectPolicy: 'apply',
        },
        { label: 'Fight it', successorIds: [], effectPolicy: 'apply' },
      ]);
      const pending = createPendingStorylineChoice(evt, state);
      expect(pending).not.toBeNull();
      if (!pending) throw new Error('pending choice was not created');

      // Registered AFTER the draw: the presented list was frozen, so this
      // must not move the AI's choice (it would flip the winner to index 0).
      registerOptions('evt-cost-frozen', [
        { label: 'Settle', successorIds: [], effectPolicy: 'apply' },
        {
          label: 'Escalate',
          successorIds: ['evt-chain-bad'],
          effectPolicy: 'apply',
        },
      ]);

      const frozen = getPendingStorylineOptions(pending, state);
      expect(frozen.map((o) => o.label)).toEqual(['Pay the fine', 'Fight it']);

      const choice = decidePresented(state, evt, 'Medium', pending);
      // Valid for the frozen list, and it picks the terminal option in it.
      expect(frozen[choice]).toBeDefined();
      expect(frozen[choice]?.label).toBe('Fight it');
      expect(choice).toBe(1);
    },
  );

  it.fails(
    'prefers an extra-effect option once its delta is counted',
    () => {
      const state = makeState('Medium', 600);
      const evt = makeEvent({ id: 'evt-cost-extra' });
      // Same chain severity (both terminal) — only the extra effect differs.
      registerOptions('evt-cost-extra', [
        { label: 'Walk away', successorIds: [], effectPolicy: 'apply' },
        {
          label: 'Sell the story',
          successorIds: [],
          effectPolicy: 'apply',
          extraEffect: { coins: 250 },
        },
      ]);
      expect(decidePresented(state, evt, 'Medium')).toBe(1);
    },
  );

  it('keeps the other option when the extra effect does not cover its price', () => {
    // Control for the case above: identical chain severities, and the
    // extra-effect option now also costs more than its delta is worth
    // (0 vs 400 − 250 = 150), so the plain option wins. Together the pair
    // fails any policy that ignores the delta *or* the cost.
    const state = makeState('Medium', 600);
    const evt = makeEvent({ id: 'evt-cost-extra-control' });
    registerOptions('evt-cost-extra-control', [
      { label: 'Walk away', successorIds: [], effectPolicy: 'apply' },
      {
        label: 'Sell the story',
        successorIds: [],
        effectPolicy: 'apply',
        extraEffect: { coins: 250 },
        cost: { coins: 400 },
      },
    ]);
    expect(decidePresented(state, evt, 'Medium')).toBe(0);
  });

  it('breaks a cost tie on the coin scale at the lowest index', () => {
    const state = makeState('Medium', 600);
    const evt = makeEvent({ id: 'evt-cost-coins' });
    // Safe-but-expensive (0 + 400) vs cheap-but-costly (50 + 350): a tie.
    registerOptions('evt-cost-coins', [
      {
        label: 'Buy them off',
        successorIds: [],
        effectPolicy: 'apply',
        cost: { coins: 400 },
      },
      {
        label: 'Risk the escalation',
        successorIds: ['evt-chain-small'],
        effectPolicy: 'apply',
        cost: { coins: 350 },
      },
    ]);
    expect(decidePresented(state, evt, 'Medium')).toBe(0);
  });

  it.fails(
    'lets the cheap-but-costly chain win just past the cost break-even',
    () => {
      const state = makeState('Medium', 600);
      const evt = makeEvent({ id: 'evt-cost-coins-past' });
      // One coin past the break-even of the tie case above: 0 + 401 now loses
      // to 50 + 350 = 400, so the safe-but-expensive chain is abandoned.
      registerOptions('evt-cost-coins-past', [
        {
          label: 'Buy them off',
          successorIds: [],
          effectPolicy: 'apply',
          cost: { coins: 401 },
        },
        {
          label: 'Risk the escalation',
          successorIds: ['evt-chain-small'],
          effectPolicy: 'apply',
          cost: { coins: 350 },
        },
      ]);
      expect(decidePresented(state, evt, 'Medium')).toBe(1);
    },
  );

  it.fails(
    'weights reputation cost at REPUTATION_SEVERITY_SCALE (100)',
    () => {
      const state = makeState('Medium', 600);
      state.resourceBank.reputation = 10;
      const evt = makeEvent({ id: 'evt-cost-rep' });
      // Safe: 0 + 2 rep × 100 = 200. Cheap-but-costly: 50 + 50 coins = 100.
      // At a 1-point reputation weight the safe option would win (2 < 100),
      // so this only passes once reputation is scaled like `eventSeverity`.
      registerOptions('evt-cost-rep', [
        {
          label: 'Pay in reputation',
          successorIds: [],
          effectPolicy: 'apply',
          cost: { reputation: 2 },
        },
        {
          label: 'Pay in coins',
          successorIds: ['evt-chain-small'],
          effectPolicy: 'apply',
          cost: { coins: 50 },
        },
      ]);
      expect(decidePresented(state, evt, 'Medium')).toBe(1);
    },
  );

  it('never consults state.rng, so repeated calls agree (seeded replays)', () => {
    const state = makeState('Medium', 600);
    const evt = makeEvent({ id: 'evt-cost-determinism' });
    registerOptions('evt-cost-determinism', [
      {
        label: 'Bribe',
        successorIds: [],
        effectPolicy: 'apply',
        cost: { coins: 900 },
      },
      {
        label: 'Blame',
        successorIds: ['evt-chain-bad'],
        effectPolicy: 'apply',
      },
      { label: 'Take the hit', successorIds: [], effectPolicy: 'apply' },
    ]);

    const rngSpy = vi.spyOn(state, 'rng');
    const first = decidePresented(state, evt, 'Medium');
    const second = decidePresented(state, evt, 'Medium');

    expect(second).toBe(first);
    expect(rngSpy).not.toHaveBeenCalled();
    rngSpy.mockRestore();
  });
});

// ── projection helper (unchanged) ───────────────────────────

describe('projectEventCoinDelta mirrors engine deltas (static)', () => {
  it('returns the raw delta for an All-target loss', () => {
    const state = makeState('Medium', 600);
    expect(projectEventCoinDelta(state, makeEvent({ coinDelta: -300, target: 'All' }))).toBe(-300);
  });

  it('scales SpecificSynergy by the number of matching businesses', () => {
    const state = makeState('Medium', 600);
    const biz = {
      family: 'business' as const, id: 'biz-f', name: 'Food', cost: 1, baseIncome: 1,
      synergyTypes: ['Food'] as never[], maxLevel: 0, description: '', level: 0, incomeBonus: 0,
      synergyRangeBonus: 0, reputationBonus: 0, ongoingCost: 0,
    };
    state.streetGrid[0] = biz;
    state.streetGrid[1] = biz;
    const evt = makeEvent({ coinDelta: -50, target: 'SpecificSynergy', targetSynergy: 'Food' as never });
    expect(projectEventCoinDelta(state, evt)).toBe(-100);
  });
});

// ── resolveAiEventChoice integration ────────────────────────

describe('resolveAiEventChoice resolves a paused sim turn', () => {
  function pauseWithChoice(difficulty: 'Easy' | 'Medium' | 'Hard'): MainStreetState {
    const state = makeState(difficulty);
    const evt = makeEvent({
      id: 'evt-sim-choice',
      coinDelta: -100, // small manageable loss
      options: 'Accept|;Reject|evt-chain-small',
    });
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...evt, id: 'evt-sim-choice-0' });
    state.phase = 'MarketPhase';
    const result: TurnResult = processEndOfTurn(state);
    expect(result.choicePending).toBe(true); // sanity: paused
    return state;
  }

  it('decides and completes the deferred closing (effect applies — Q4=B)', () => {
    const state = pauseWithChoice('Easy');
    const turnBefore = state.turn;
    const coinsBefore = state.resourceBank.coins;

    resolveAiEventChoice(state);

    expect(state.pendingEventChoice).toBeNull();
    expect(state.phase).toBe('WeekStart');
    expect(state.turn).toBe(turnBefore + 1);
    // Whatever option the AI picks, the migrated CSV options apply the effect.
    expect(state.resourceBank.coins).toBe(coinsBefore - 100);
  });

  it('resolves a multi-option node headlessly without stalling', () => {
    const state = makeState('Hard', 600);
    const evt = makeEvent({
      id: 'evt-sim-choice2',
      coinDelta: -300,
      options: 'Negotiate|evt-chain-mid;Walk away|;Escalate|evt-chain-bad',
    });
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...evt, id: 'evt-sim-choice2-0' });
    state.phase = 'MarketPhase';
    processEndOfTurn(state); // pause
    const turnBefore = state.turn;

    resolveAiEventChoice(state);

    expect(state.pendingEventChoice).toBeNull();
    expect(state.turn).toBe(turnBefore + 1);
    expect(state.resourceBank.coins).toBe(300); // -300 applied (all options apply)
  });
});
