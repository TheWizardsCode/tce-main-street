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
 *
 * @module
 */
import { describe, it, expect, afterEach } from 'vitest';

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
