/**
 * Test: AI Choice Evaluation Strategy (CG-0MTT7DB850037SMW / parent
 * CG-0MTSHG8RP008E128; reworked for the arbitrary-option model in
 * MS-0MV8KQSF1004E53Y)
 *
 * Canonical unit suite for the AI's option decision when simulating
 * storyline choices:
 *
 *  1. Shared rule — every compiled option applies the event's effect
 *     (CSV content is all effectPolicy 'apply', Q4=B), so the AI picks the
 *     option index whose pessimistic (worst-candidate) chain severity is
 *     lowest; terminal options win; ties resolve to the lowest index.
 *  2. The difficulty ladder agrees on the rule (Easy/Medium/Hard).
 *  3. Multi-option nodes (≥3, incl. random candidate sets) resolve
 *     deterministically and RNG-free.
 *  4. Edge cases — null/missing next ids and unknown templates never crash.
 *  5. Transcript consistency — AI choices are recorded identically to player
 *     choices (engine `event-choice` event shape, label token).
 *  6. The sim never stalls on a pending choice.
 *
 * @module
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import type { EventCard } from '../../src/MainStreetCards';
import {
  loadTemplatesFromCsv,
  resetTemplatesToDefault,
} from '../../src/MainStreetCards';
import { processEndOfTurn } from '../../src/MainStreetEngine';
import {
  decideEventChoice,
  resolveAiEventChoice,
} from '../../src/MainStreetAiStrategy';
import {
  MainStreetTranscriptRecorder,
  setMainStreetRecorder,
} from '../../src/MainStreetTranscript';

// ── Synthetic chain templates (registry for severity lookups) ──

const CHAIN_CSV =
  `family,id,name,cost,baseIncome,synergyTypes,upgradePath,maxLevel,reputationPerTurn,synergyCoinBonus,synergyRepBonus,description,tier,trigger,effect,target,targetSynergy,coinDelta,reputationDelta,duration,effectType,multiplier,targetBusiness,incomeBonus,synergyRangeBonus,requiredLevel,reputationBonus,newDisplayName,ongoingCost,handSlotsAdded,refreshCostDiscount,actionsPerTurn,peekOncePerTurn,upgradeCostDiscount,art_notes,hasChoices,acceptNextCardId,rejectNextCardId,options,storylineId,storylineTitle
event,evt-esc-bad,Bad Escalation,0,,,,,,,,,1,Incident,Lose 1000 coins,All,,-1000,0,,,,,,,,,,,,,,,,,,,,,
event,evt-esc-mid,Mid Escalation,0,,,,,,,,,1,Incident,Lose 200 coins,All,,-200,0,,,,,,,,,,,,,,,,,,,,,
event,evt-esc-small,Small Escalation,0,,,,,,,,,1,Incident,Lose 50 coins,All,,-50,0,,,,,,,,,,,,,,,,,,,,,
event,evt-esc-pos,Positive Escalation,0,,,,,,,,,1,Incident,Gain 300 coins,All,,300,0,,,,,,,,,,,,,,,,,,,,,`;

// ── Helpers ─────────────────────────────────────────────────

function negative(overrides: Partial<EventCard> = {}): EventCard {
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
    acceptNextCardId: null,
    rejectNextCardId: null,
    ...overrides,
  };
}

function positive(overrides: Partial<EventCard> = {}): EventCard {
  return negative({ coinDelta: 250, reputationDelta: 100, ...overrides });
}

function stateFor(difficulty: 'Easy' | 'Medium' | 'Hard', coins = 600): MainStreetState {
  const state = setupMainStreetGame({ seed: `ai-suite-${difficulty}`, difficulty });
  loadTemplatesFromCsv(CHAIN_CSV);
  state.resourceBank.coins = coins;
  return state;
}

afterEach(() => {
  setMainStreetRecorder(null);
  resetTemplatesToDefault();
});

// ── The shared least-harmful-chain rule ─────────────────────

describe('F7 — the AI picks the least-harmful option chain', () => {
  it('returns an option index (not an accept/reject token)', () => {
    const s = stateFor('Easy', 100);
    expect(typeof decideEventChoice(s, negative(), 'Easy')).toBe('number');
  });

  it('both-terminal events resolve to index 0 (tie → lowest index)', () => {
    const s = stateFor('Easy', 100);
    expect(decideEventChoice(s, negative(), 'Easy')).toBe(0);
    expect(decideEventChoice(s, negative({ coinDelta: -900 }), 'Easy')).toBe(0);
  });

  it('prefers the terminal option over any escalation', () => {
    const s = stateFor('Hard', 600);
    // Accept terminal, Reject→bad: accept (index 0).
    expect(decideEventChoice(s, negative({ acceptNextCardId: null, rejectNextCardId: 'evt-esc-bad' }), 'Hard')).toBe(0);
    // Reject terminal, Accept→bad: reject (index 1).
    expect(decideEventChoice(s, negative({ acceptNextCardId: 'evt-esc-bad', rejectNextCardId: null }), 'Hard')).toBe(1);
  });

  it('compares chain severities across options by worst candidate', () => {
    const s = stateFor('Hard', 600);
    // accept: mid(-200); reject: small(-50) → reject (1).
    expect(decideEventChoice(s, negative({ acceptNextCardId: 'evt-esc-mid', rejectNextCardId: 'evt-esc-small' }), 'Hard')).toBe(1);
    // accept: small(-50); reject: mid(-200) → accept (0).
    expect(decideEventChoice(s, negative({ acceptNextCardId: 'evt-esc-small', rejectNextCardId: 'evt-esc-mid' }), 'Hard')).toBe(0);
  });

  it('positive events follow the same least-harmful rule', () => {
    const s = stateFor('Hard');
    expect(decideEventChoice(s, positive(), 'Hard')).toBe(0);
    // Accept chains a small card; Reject stays terminal → Reject (1).
    expect(decideEventChoice(s, positive({ acceptNextCardId: 'evt-esc-small' }), 'Hard')).toBe(1);
  });

  it('unknown chain template ids behave as terminal (severity 0, no crash)', () => {
    const s = stateFor('Hard');
    const evt = negative({ acceptNextCardId: 'evt-ghost', rejectNextCardId: 'evt-missing' });
    // Both candidates unknown → both severity 0 → tie → index 0.
    expect(decideEventChoice(s, evt, 'Hard')).toBe(0);
  });
});

// ── Difficulty ladder agreement ─────────────────────────────

describe('F7 — the difficulty ladder agrees on the shared rule', () => {
  it('Easy/Medium/Hard return the same index for equivalent states', () => {
    const evt = negative({ acceptNextCardId: 'evt-esc-bad', rejectNextCardId: 'evt-esc-small' });
    const easy = decideEventChoice(stateFor('Easy'), evt, 'Easy');
    const medium = decideEventChoice(stateFor('Medium'), evt, 'Medium');
    const hard = decideEventChoice(stateFor('Hard'), evt, 'Hard');
    expect(new Set([easy, medium, hard])).toEqual(new Set([1]));
  });
});

// ── Arbitrary multi-option nodes (F7 core) ──────────────────

describe('F7 — arbitrary multi-option nodes', () => {
  it('three labelled options: terminal option wins', () => {
    const s = stateFor('Medium');
    const evt = negative({ options: 'Negotiate|evt-esc-small;Walk away|;Escalate|evt-esc-bad' });
    expect(decideEventChoice(s, evt, 'Medium')).toBe(1);
  });

  it('candidate-set fan-out: worst candidate drives the score deterministically', () => {
    const s = stateFor('Hard');
    const evt = negative({ options: 'Fight|evt-esc-bad,evt-esc-small;Flee|evt-esc-mid' });
    // Fight worst = -1000; Flee = -200 → Flee (1). Deterministic: same seed.
    const again = decideEventChoice(stateFor('Hard'), evt, 'Hard');
    expect(decideEventChoice(s, evt, 'Hard')).toBe(1);
    expect(again).toBe(1);
  });
});

// ── AC5: Edge cases ─────────────────────────────────────────

describe('AC5 — edge cases never crash', () => {
  it('null next ids and missing fields are handled', () => {
    const s = stateFor('Hard');
    const legacy = negative();
    delete (legacy as { hasChoices?: boolean }).hasChoices;
    (legacy as { acceptNextCardId?: string | null }).acceptNextCardId = null;
    (legacy as { rejectNextCardId?: string | null }).rejectNextCardId = null;
    expect(Number.isInteger(decideEventChoice(s, legacy, 'Hard'))).toBe(true);
  });
});

// ── AC6: Transcript consistency ─────────────────────────────

describe('AC6 — AI choices are recorded identically to player choices', () => {
  it('resolveAiEventChoice records an engine event-choice event (label token)', () => {
    const recorder = new MainStreetTranscriptRecorder({ seed: 'x' });
    setMainStreetRecorder(recorder);

    const state = stateFor('Hard', 600);
    const evt = negative({ coinDelta: -100, rejectNextCardId: 'evt-esc-mid' });
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...evt, id: 'evt-cur-0' });
    state.phase = 'MarketPhase';
    processEndOfTurn(state); // pause (choicePending)

    resolveAiEventChoice(state);

    const choiceEvents = recorder.getTranscript().events.filter((e) => e.type === 'event-choice');
    expect(choiceEvents).toHaveLength(1);
    const choice = choiceEvents[0];
    if (!choice || choice.type !== 'event-choice') return;
    expect(choice.eventId).toContain('evt-cur');
    expect(choice.cardName).toBe('Current Event');
    // F3 AC3: the transcript token is the option label, not a legacy
    // lowercase 'accept'/'reject' value.
    expect(['Accept', 'Reject']).toContain(choice.option);
  });

  it('AI choices are resolved automatically so the sim never stalls', () => {
    const state = stateFor('Hard', 600);
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...negative({ options: 'Accept|;Reject|evt-esc-mid' }), id: 'evt-cur-0' });
    state.phase = 'MarketPhase';
    processEndOfTurn(state); // pause
    expect(state.pendingEventChoice).not.toBeNull();

    resolveAiEventChoice(state);

    expect(state.pendingEventChoice).toBeNull();
    expect(state.phase).toBe('WeekStart');
    expect(state.turn).toBe(2);
  });
});
