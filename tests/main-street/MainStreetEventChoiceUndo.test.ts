/**
 * Persistence & Undo for Event Choices (CG-0MTT7F1JG007E7UL / parent
 * CG-0MTSHG8RP008E128)
 *
 * Unit tests for:
 *  - the snapshot-based `resolveEventChoiceCommand` (undo returns to the
 *    unresolved pending state — escalation removed, resources restored);
 *  - redo re-applying the choice via the UndoRedoManager;
 *  - duration-event accept undo removing the pushed active effect;
 *  - save/load of `pendingEventChoice` (round-trip) and legacy saves
 *    WITHOUT the field loading with defaults (schema-version compatibility —
 *    the MainStreet save schema version is intentionally NOT bumped because
 *    SaveLoadStore strictly rejects version mismatches; the migration
 *    default `pendingEventChoice = null` provides old-save compatibility).
 *
 * @module
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  setupMainStreetGame,
  serializeMainStreetState,
  deserializeMainStreetState,
  type MainStreetState,
} from '../../src/MainStreetState';
import { UndoRedoManager } from '@core-engine/UndoRedoManager';
import {
  type EventCard,
  getEventTemplates,
  loadTemplatesFromCsv,
  resetTemplatesToDefault,
  getBaseTypeId,
} from '../../src/MainStreetCards';
import {
  processEndOfTurn,
  finishDeferredEndOfTurn,
  resolveEventChoice,
  resolveEventOption,
  type TurnResult,
} from '../../src/MainStreetEngine';
import { resolveEventChoiceCommand } from '../../src/MainStreetCommands';
import {
  registerStorylineOptions,
  resetStorylineRegistry,
} from '../../src/MainStreetStoryline';
import type { StorylineOption } from '../../src/MainStreetCardsTypes';

// ── Synthetic CSV (choice + escalation templates) ──────────

const SYNTHETIC_CSV =
  `family,id,name,cost,baseIncome,synergyTypes,upgradePath,maxLevel,reputationPerTurn,synergyCoinBonus,synergyRepBonus,description,tier,trigger,effect,target,targetSynergy,coinDelta,reputationDelta,duration,effectType,multiplier,targetBusiness,incomeBonus,synergyRangeBonus,requiredLevel,reputationBonus,newDisplayName,ongoingCost,handSlotsAdded,refreshCostDiscount,actionsPerTurn,peekOncePerTurn,upgradeCostDiscount,art_notes,hasChoices,acceptNextCardId,rejectNextCardId
event,evt-choice-a,Choice A,0,,,,,,,,,1,Incident,Lose 100 coins,All,,-100,0,,,,,,,,,,,,,,,,,true,evt-next-b,evt-worse
event,evt-next-b,Next B,0,,,,,,,,,1,Incident,Lose 50 coins,All,,-50,0,,,,,,,,,,,,,,,,,,,
event,evt-worse,Worse Card,0,,,,,,,,,1,Incident,Lose 400 coins,All,,-400,0,,,,,,,,,,,,,,,,,,,
event,evt-dur-choice,Duration Choice,0,,,,,,,,,1,Incident,80% income 4 turns,All,,0,0,4,income-multiplier,0.8,,,,,,,,,,,,,,true,,evt-next-b`;

// ── Helpers ─────────────────────────────────────────────────

function makeState(seed = 'choice-undo-suite'): MainStreetState {
  const state = setupMainStreetGame({ seed, difficulty: 'Medium' });
  loadTemplatesFromCsv(SYNTHETIC_CSV);
  state.phase = 'MarketPhase';
  return state;
}

/** Ends the current turn and returns the paused (choicePending) state. */
function pauseWithChoice(state: MainStreetState, templateId: string): TurnResult {
  const t = getEventTemplates().find((c) => c.id === templateId);
  if (!t) throw new Error(`Template ${templateId} missing`);
  state.incidentDeck.length = 0;
  state.incidentDeck.push({ ...t, id: `${templateId}-0` });
  const result = processEndOfTurn(state);
  expect(result.choicePending).toBe(true);
  return result;
}

function pending(state: MainStreetState): NonNullable<MainStreetState['pendingEventChoice']> {
  const p = state.pendingEventChoice;
  if (!p) throw new Error('expected a pending choice');
  return p;
}

afterEach(() => {
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

// ── Command: execute / undo / redo ──────────────────────────

describe('resolveEventChoiceCommand — accept execute/undo/redo', () => {
  it('executes (effect + escalation) and undoes back to the pending state', () => {
    const state = makeState();
    pauseWithChoice(state, 'evt-choice-a');
    const coinsBefore = state.resourceBank.coins;
    const deckBefore = state.incidentDeck.length;
    const undo = new UndoRedoManager();

    const cmd = resolveEventChoiceCommand(state, 'accept');
    undo.execute(cmd);

    // Executed: -100 coins applied; escalation evt-next-b pushed.
    expect(state.resourceBank.coins).toBe(coinsBefore - 100);
    expect(state.incidentDeck.length).toBe(deckBefore + 1);
    expect(getBaseTypeId(state.incidentDeck[state.incidentDeck.length - 1].id)).toBe('evt-next-b');
    expect(pending(state).resolved).toBe(true);
    // F3 AC3: the chosen token is the option label.
    expect(pending(state).chosenOption).toBe('Accept');

    // Undo: back to unresolved pending; escalation removed; coins restored.
    undo.undo();
    expect(state.pendingEventChoice).not.toBeNull();
    expect(pending(state).resolved).toBe(false);
    expect(pending(state).chosenOption).toBeNull();
    expect(state.incidentDeck.length).toBe(deckBefore);
    expect(state.resourceBank.coins).toBe(coinsBefore);
  });

  it('redo re-applies the accepted choice', () => {
    const state = makeState();
    pauseWithChoice(state, 'evt-choice-a');
    const coinsBefore = state.resourceBank.coins;
    const undo = new UndoRedoManager();

    const cmd = resolveEventChoiceCommand(state, 'accept');
    undo.execute(cmd);
    undo.undo();
    expect(state.resourceBank.coins).toBe(coinsBefore);

    undo.redo();
    expect(state.resourceBank.coins).toBe(coinsBefore - 100);
    expect(pending(state).resolved).toBe(true);
    expect(state.incidentDeck.some((c) => getBaseTypeId(c.id) === 'evt-next-b')).toBe(true);
  });
});

describe('resolveEventChoiceCommand — reject execute/undo', () => {
  it('undo of a reject removes the pushed escalation and re-opens the choice', () => {
    const state = makeState();
    pauseWithChoice(state, 'evt-choice-a');
    const coinsBefore = state.resourceBank.coins;
    const undo = new UndoRedoManager();

    const cmd = resolveEventChoiceCommand(state, 'reject');
    undo.execute(cmd);

    // Reject: no effect, but evt-worse pushed.
    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.incidentDeck.some((c) => getBaseTypeId(c.id) === 'evt-worse')).toBe(true);
    // F3 AC3: the chosen token is the option label.
    expect(pending(state).chosenOption).toBe('Reject');

    undo.undo();
    expect(state.incidentDeck.some((c) => getBaseTypeId(c.id) === 'evt-worse')).toBe(false);
    expect(pending(state).resolved).toBe(false);
  });
});

describe('resolveEventChoiceCommand — duration accept undo restores active effects', () => {
  it('undo removes the active effect the accept pushed', () => {
    const state = makeState();
    pauseWithChoice(state, 'evt-dur-choice');
    const effectsBefore = state.activeEffects.length;
    const undo = new UndoRedoManager();

    const cmd = resolveEventChoiceCommand(state, 'accept');
    undo.execute(cmd);
    expect(state.activeEffects.length).toBe(effectsBefore + 1);

    undo.undo();
    expect(state.activeEffects.length).toBe(effectsBefore);
    expect(pending(state).resolved).toBe(false);
  });
});

describe('choice command integrates with the deferred closing', () => {
  it('a resolved-then-finished turn clears the pending choice and advances', () => {
    const state = makeState();
    pauseWithChoice(state, 'evt-choice-a');
    const undo = new UndoRedoManager();

    const cmd = resolveEventChoiceCommand(state, 'accept');
    undo.execute(cmd);
    const result = finishDeferredEndOfTurn(state);
    expect(result.choicePending).toBe(false);
    expect(state.pendingEventChoice).toBeNull();
    expect(state.phase).toBe('WeekStart');
    expect(state.turn).toBe(2);
  });
});

// ── Save/load compatibility (AC2/AC3) ───────────────────────

describe('save/load compatibility for pendingEventChoice', () => {
  it('round-trips an unresolved pending choice through serialize/deserialize', () => {
    const state = makeState('save-pending');
    pauseWithChoice(state, 'evt-choice-a');
    const evtId = getBaseTypeId(pending(state).event.id);

    const saved = serializeMainStreetState(state);
    expect(saved.pendingEventChoice).not.toBeNull();
    const restored = deserializeMainStreetState(saved);

    expect(restored.pendingEventChoice).not.toBeNull();
    expect(getBaseTypeId(restored.pendingEventChoice!.event.id)).toBe(evtId);
    expect(restored.pendingEventChoice!.resolved).toBe(false);
    expect(restored.pendingEventChoice!.chosenOption).toBeNull();
  });

  it('legacy saves without pendingEventChoice load with the field defaulted to null', () => {
    const state = makeState('legacy-save');
    const saved = serializeMainStreetState(state);
    // Simulate an old-format save: strip the field entirely.
    delete (saved as { pendingEventChoice?: unknown }).pendingEventChoice;

    const restored = deserializeMainStreetState(saved as never);
    expect(restored.pendingEventChoice).toBeNull();
    expect(restored.gameResult).toBe('playing');
  });

  it('events without the new fields behave as non-choice after a legacy load', () => {
    const state = makeState('legacy-events');
    // Remove the choice fields from the pending event (as a legacy card would
    // have them absent) and confirm non-choice behaviour on resolution.
    const legacyEvent: EventCard = {
      family: 'event',
      id: 'evt-legacy-0',
      name: 'Legacy Incident',
      trigger: 'Incident',
      cost: 0,
      effect: 'Lose 30 coins',
      target: 'All',
      coinDelta: -30,
      reputationDelta: 0,
    };
    delete (legacyEvent as { hasChoices?: boolean }).hasChoices;
    state.incidentDeck.length = 0;
    state.incidentDeck.push(legacyEvent);
    const coinsBefore = state.resourceBank.coins;

    const result = processEndOfTurn(state);

    expect(result.choicePending).toBe(false);
    expect(state.pendingEventChoice).toBeNull();
    expect(state.resourceBank.coins).toBe(coinsBefore - 30);
    expect(result.incident).not.toBeNull();
  });

  it('accept/undo works after a save/load round-trip (restored pending)', () => {
    const state = makeState('save-undo');
    pauseWithChoice(state, 'evt-choice-a');
    const restored = deserializeMainStreetState(serializeMainStreetState(state));
    const coinsBefore = restored.resourceBank.coins;
    const undo = new UndoRedoManager();

    const cmd = resolveEventChoiceCommand(restored, 'accept');
    undo.execute(cmd);
    expect(restored.resourceBank.coins).toBe(coinsBefore - 100);
    undo.undo();
    expect(restored.resourceBank.coins).toBe(coinsBefore);
    expect(restored.pendingEventChoice!.resolved).toBe(false);
  });
});

// ── F3 AC4: arbitrary option-list round-trip (MS-0MV8KQL820077BOS) ──
//
// The pending choice can carry an arbitrary (any-count) ordered option list
// (registry seam). F3 guarantees that list round-trips save/load and undo/redo
// without loss (labels + candidate data), preserves the chosen label token,
// and that the accept/reject decision keys index 0/1 over any option count.

const MULTI_UNDO_CSV = [
  'family,id,name,cost,baseIncome,synergyTypes,upgradePath,maxLevel,reputationPerTurn,synergyCoinBonus,synergyRepBonus,description,tier,trigger,effect,target,targetSynergy,coinDelta,reputationDelta,duration,effectType,multiplier,targetBusiness,incomeBonus,synergyRangeBonus,requiredLevel,reputationBonus,newDisplayName,ongoingCost,handSlotsAdded,refreshCostDiscount,actionsPerTurn,peekOncePerTurn,upgradeCostDiscount,art_notes,hasChoices,acceptNextCardId,rejectNextCardId',
  'event,evt-multi-choice,Multi Choice,0,,,,,,,,,1,Incident,Lose 100 coins,All,,-100,0,,,,,,,,,,,,,,,,,true,,',
  'event,evt-mo-a,Branch A,0,,,,,,,,,1,Incident,Lose 10 coins,All,,-10,0,,,,,,,,,,,,,,,,,,,',
  'event,evt-mo-b,Branch B,0,,,,,,,,,1,Incident,Lose 20 coins,All,,-20,0,,,,,,,,,,,,,,,,,,,',
  'event,evt-mo-c,Branch C,0,,,,,,,,,1,Incident,Lose 30 coins,All,,-30,0,,,,,,,,,,,,,,,,,,,',
].join('\n');

/** A 3-option registry choice with single-candidate sets (deterministic draws). */
const THREE_WAY_OPTIONS: StorylineOption[] = [
  { label: 'Alpha', successorIds: ['evt-mo-a'], effectPolicy: 'apply' },
  { label: 'Beta', successorIds: ['evt-mo-b'], effectPolicy: 'apply' },
  { label: 'Gamma', successorIds: [], effectPolicy: 'skip' },
];

/** State with the 3-option node queued (pause on end-of-turn). */
function pauseMultiChoice(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed, difficulty: 'Medium' });
  loadTemplatesFromCsv(MULTI_UNDO_CSV);
  registerStorylineOptions('evt-multi-choice', THREE_WAY_OPTIONS);
  state.phase = 'MarketPhase';
  const t = getEventTemplates().find((c) => c.id === 'evt-multi-choice');
  if (!t) throw new Error('evt-multi-choice missing');
  state.incidentDeck.length = 0;
  state.incidentDeck.push({ ...t, id: 'evt-multi-choice-0' });
  const result = processEndOfTurn(state);
  expect(result.choicePending).toBe(true);
  return state;
}

describe('F3 AC4 — an arbitrary option list survives save/load', () => {
  it('the frozen 3-option list and chosen token round-trip through serialize/deserialize', () => {
    const state = pauseMultiChoice('multi-save');
    resolveEventOption(state, 2); // 'Gamma' (skip, terminal)
    expect(state.pendingEventChoice!.chosenOption).toBe('Gamma');

    const saved = serializeMainStreetState(state);
    expect(saved.pendingEventChoice).not.toBeNull();
    expect(saved.pendingEventChoice!.options).toHaveLength(3);

    const loaded = deserializeMainStreetState(saved);
    const restored = loaded.pendingEventChoice!;
    // The arbitrary list round-trips without loss (labels + candidate sets).
    expect(restored.options!.map((o) => o.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(restored.options!.map((o) => o.successorIds)).toEqual([
      ['evt-mo-a'],
      ['evt-mo-b'],
      [],
    ]);
    // Chosen label token preserved (F3 AC3).
    expect(restored.chosenOption).toBe('Gamma');
    expect(restored.resolved).toBe(true);
  });

  it('resolveEventChoice indexing works over any option count (accept=0, reject=1 of 3)', () => {
    const acceptState = pauseMultiChoice('multi-index-accept');
    resolveEventChoice(acceptState, 'accept'); // → index 0 → 'Alpha' (apply, pushes evt-mo-a)
    expect(acceptState.pendingEventChoice!.chosenOption).toBe('Alpha');
    expect(acceptState.incidentDeck.find((c) => getBaseTypeId(c.id) === 'evt-mo-a')).toBeDefined();

    const rejectState = pauseMultiChoice('multi-index-reject');
    resolveEventChoice(rejectState, 'reject'); // → index 1 → 'Beta' (apply, pushes evt-mo-b)
    expect(rejectState.pendingEventChoice!.chosenOption).toBe('Beta');
    expect(rejectState.incidentDeck.find((c) => getBaseTypeId(c.id) === 'evt-mo-b')).toBeDefined();
  });
});

describe('F3 AC4 — an arbitrary option list survives undo/redo', () => {
  it('undo/redo round-trips the frozen 3-option list via the snapshot command', () => {
    const state = pauseMultiChoice('multi-undo');
    const coinsBefore = state.resourceBank.coins;
    const deckBefore = state.incidentDeck.length;
    const undo = new UndoRedoManager();

    // 'reject' indexes over the 3-option list → index 1 → 'Beta' (apply).
    const cmd = resolveEventChoiceCommand(state, 'reject');
    undo.execute(cmd);
    expect(state.pendingEventChoice!.chosenOption).toBe('Beta');
    // F3 resolution applies the EVENT effect for an 'apply' option (the
    // node's 'Lose 100 coins'), not the successor card's delta; the branch
    // card is pushed, its own effect is not auto-applied.
    expect(state.resourceBank.coins).toBe(coinsBefore - 100);
    expect(state.incidentDeck.find((c) => getBaseTypeId(c.id) === 'evt-mo-b')).toBeDefined();

    // Undo re-opens the choice: the frozen 3-option list survives without
    // loss (F3 AC4), the chosen token resets, nothing stayed pushed.
    undo.undo();
    expect(state.pendingEventChoice!.resolved).toBe(false);
    expect(state.pendingEventChoice!.chosenOption).toBeNull();
    expect(state.pendingEventChoice!.options!.map((o) => o.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(state.pendingEventChoice!.options!.map((o) => o.successorIds)).toEqual([
      ['evt-mo-a'],
      ['evt-mo-b'],
      [],
    ]);
    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.incidentDeck.length).toBe(deckBefore);

    // Redo re-applies 'Beta' — the preserved candidate set is drawn again.
    undo.redo();
    expect(state.pendingEventChoice!.chosenOption).toBe('Beta');
    expect(state.incidentDeck.find((c) => getBaseTypeId(c.id) === 'evt-mo-b')).toBeDefined();
  });
});
