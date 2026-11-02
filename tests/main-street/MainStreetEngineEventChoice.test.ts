/**
 * Engine: Dual-Choice Event Resolution (CG-0MTT7E4FX007QCUR / parent
 * CG-0MTSHG8RP008E128)
 *
 * Unit tests for the core engine slice of the story-driven event-chain
 * feature: resolveIncident interception, the typed `pendingEventChoice`
 * state, processEndOfTurn pause/deferral, Accept/Reject paths, escalation
 * deck pushes, transcript recording, and the deferred-turn finish.
 *
 * The shipped card-data.csv has no choice cards yet (that is content
 * child CG-0MTT7FC7A000AA58), so tests inject synthetic choice templates via
 * `loadTemplatesFromCsv` AFTER setup (decks are built from the bundled data;
 * only template lookups for chain escalation are synthetic). Choice-ness is
 * declared through the registered option list — the options-only model — not
 * a per-card flag.
 *
 * @module
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  processEndOfTurn,
  resolveIncident,
  resolveEventChoice,
  resolveEventOption,
  finishDeferredEndOfTurn,
  type TurnResult,
} from '../../src/MainStreetEngine';
import {
  type EventCard,
  getEventTemplates,
  loadTemplatesFromCsv,
  resetTemplatesToDefault,
  getBaseTypeId,
} from '../../src/MainStreetCards';
import {
  MainStreetTranscriptRecorder,
  setMainStreetRecorder,
} from '../../src/MainStreetTranscript';
import {
  pushChainCard,
  registerStorylineOptions,
  resetStorylineRegistry,
} from '../../src/MainStreetStoryline';
import type { StorylineOption } from '../../src/MainStreetCardsTypes';

// ── Synthetic CSV (choice + escalation templates) ───────────

const SYNTHETIC_ROWS = [
  'event,evt-choice-test,Test Choice Event,0,1,Incident,Lose 300 coins,All,-300,-100,,,',
  'event,evt-esc-audit,Audit Escalation,0,1,Incident,Lose 400 coins,All,-400,0,,,',
  'event,evt-esc-worse,Worse Escalation,0,1,Incident,Lose 500 coins,All,-500,0,,,',
  'event,evt-plain-test,Plain Incident,0,1,Incident,Lose 100 coins,All,-100,0,,,',
  'event,evt-dur-choice,Duration Choice,100,1,Incident,80% income for 5 turns,All,0,0,5,income-multiplier,0.8',
  'event,evt-esc-dur,Duration Escalation,100,1,Incident,60% income for 6 turns,All,0,0,6,income-multiplier,0.6',
].join('\n');

const SYNTHETIC_CSV_HEADER =
  'family,id,name,cost,tier,trigger,effect,target,coinDelta,reputationDelta,duration,effectType,multiplier';

const SYNTHETIC_CSV_FULL = `${SYNTHETIC_CSV_HEADER}\n${SYNTHETIC_ROWS}`;

/**
 * The two-way option list the old flag/next-id columns used to compile to:
 * Accept applies the event effect and pushes its successor, Reject skips the
 * effect and pushes its successor. Authored through the registry seam because
 * `effectPolicy: 'skip'` is registry-only.
 */
function twoWayOptions(
  accept: string | null,
  reject: string | null,
): StorylineOption[] {
  return [
    {
      label: 'Accept',
      effectPolicy: 'apply',
      ...(accept !== null ? { successorId: accept } : {}),
    },
    {
      label: 'Reject',
      effectPolicy: 'skip',
      ...(reject !== null ? { successorId: reject } : {}),
    },
  ];
}

// ── Helpers ─────────────────────────────────────────────────

function makeIncident(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event' as const,
    id: overrides.id ?? 'evt-test-incident',
    name: overrides.name ?? 'Test Incident',
    trigger: 'Incident' as const,
    cost: 0,
    effect: 'test effect',
    target: 'All' as const,
    coinDelta: overrides.coinDelta ?? -100,
    reputationDelta: overrides.reputationDelta ?? 0,
    ...overrides,
  };
}

/** Fresh game (bundled CSV) with the synthetic choice templates registered. */
function createChoiceAwareState(seed = 'choice-engine-seed'): MainStreetState {
  const state = setupMainStreetGame({ seed, difficulty: 'Medium' });
  loadTemplatesFromCsv(SYNTHETIC_CSV_FULL);
  registerStorylineOptions('evt-choice-test', twoWayOptions('evt-esc-audit', 'evt-esc-worse'));
  registerStorylineOptions('evt-dur-choice', twoWayOptions(null, 'evt-esc-dur'));
  state.phase = 'MarketPhase';
  return state;
}

/**
 * Force the next incident draw to be the given (already choice-flagged)
 * template: clears the incident deck and places a single instance so the
 * constrained selector deterministically picks it.
 */
function forceNextIncident(state: MainStreetState, templateId: string): void {
  const template = loadTemplate(templateId);
  state.incidentDeck.length = 0;
  state.incidentDeck.push({ ...template, id: `${templateId}-0` });
}

function loadTemplate(id: string): EventCard {
  // getEventTemplates is module state (CSV reloaded); read it dynamically to
  // stay aligned with the engine's pushChainCard lookups.
  const t = getEventTemplates().find((c) => c.id === id);
  if (!t) throw new Error(`Template ${id} missing — is it in the synthetic CSV?`);
  return t;
}

function coins(state: MainStreetState): number { return state.resourceBank.coins; }
function rep(state: MainStreetState): number { return state.resourceBank.reputation; }

function assertTurnPaused(result: TurnResult, state: MainStreetState): void {
  expect(result.choicePending).toBe(true);
  expect(result.incident).toBeNull();
  expect(state.phase).toBe('IncidentPhase');
  expect(state.turn).toBe(1); // not advanced
  expect(state.pendingEventChoice).not.toBeNull();
  expect(state.pendingEventChoice!.resolved).toBe(false);
  expect(state.pendingEventChoice!.chosenOption).toBeNull();
}

afterEach(() => {
  setMainStreetRecorder(null);
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

// ── resolveIncident interception (AC1 engine) ───────────────

describe('resolveIncident intercepts choice events', () => {
  it('defers a choice event: sets pendingEventChoice, applies nothing, returns null', () => {
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-choice-test');
    const beforeCoins = coins(state);

    const drawn = resolveIncident(state);

    expect(drawn).toBeNull(); // deferred resolution (AC5 parent)
    expect(coins(state)).toBe(beforeCoins); // no effect applied
    expect(state.pendingEventChoice).not.toBeNull();
    expect(getBaseTypeId(state.pendingEventChoice!.event.id)).toBe('evt-choice-test');
    expect(state.pendingEventChoice!.resolved).toBe(false);
    // The card was removed from the deck (it is now "in play" pending choice)
    expect(state.incidentDeck.some((c) => c.id === 'evt-choice-test-0')).toBe(false);
  });

  it('resolves a non-choice event immediately (unchanged behaviour)', () => {
    const state = createChoiceAwareState();
    state.incidentDeck.length = 0;
    state.incidentDeck.push(makeIncident({ id: 'evt-plain-test', coinDelta: -100 }));
    const beforeCoins = coins(state);

    const drawn = resolveIncident(state);

    expect(drawn).not.toBeNull();
    expect(coins(state)).toBe(beforeCoins - 100); // applied normally
    expect(state.pendingEventChoice).toBeNull();
  });

  it('a card with no option source is a non-choice card', () => {
    const state = createChoiceAwareState();
    state.incidentDeck.length = 0;
    const noOptions = makeIncident({ id: 'evt-no-options', coinDelta: -50 });
    state.incidentDeck.push(noOptions);
    const beforeCoins = coins(state);

    const drawn = resolveIncident(state);

    expect(drawn).not.toBeNull();
    expect(coins(state)).toBe(beforeCoins - 50);
    expect(state.pendingEventChoice).toBeNull();
  });
});

// ── processEndOfTurn pause / deferral (AC3, AC7) ────────────

describe('processEndOfTurn defers when a choice event is drawn', () => {
  it('pauses before EndCheck with choicePending when an incident requires a choice', () => {
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-choice-test');

    const result = processEndOfTurn(state);

    assertTurnPaused(result, state);
    // No EndCheck ran: challenges not evaluated, gameResult still playing.
    expect(result.gameResult).toBe('playing');
    expect(result.newlyCompletedChallenges).toEqual([]);
  });

  it('returns choicePending (no throw, no double income) if end-turn is retried while unresolved', () => {
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-choice-test');
    processEndOfTurn(state); // pauses with pending choice (phase IncidentPhase)
    const coinsAfterPause = coins(state);

    const retry = processEndOfTurn(state); // phase is NOT MarketPhase

    expect(retry.choicePending).toBe(true);
    expect(coins(state)).toBe(coinsAfterPause); // no additional income applied
    expect(state.turn).toBe(1);
  });
});

// ── Accept path (AC4 engine) ────────────────────────────────

describe('resolveEventChoice — Accept path', () => {
  it('applies the event effect and pushes the accept successor to the deck top', () => {
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-choice-test');
    const coinsBefore = coins(state);
    const repBefore = rep(state);
    processEndOfTurn(state); // pause

    const res = resolveEventChoice(state, 'accept');

    // Effect applied (regular EventCard: coin delta -300, rep delta -100)
    expect(coins(state)).toBe(coinsBefore - 300);
    expect(rep(state)).toBe(repBefore - 100);
    // Escalation pushed to deck TOP (next to be drawn)
    expect(res.pushedCard).not.toBeNull();
    expect(getBaseTypeId(res.pushedCard!.id)).toBe('evt-esc-audit');
    expect(getBaseTypeId(state.incidentDeck[state.incidentDeck.length - 1].id)).toBe('evt-esc-audit');
    // Pending choice resolved — the token is the option label (F3 AC3).
    expect(state.pendingEventChoice!.chosenOption).toBe('Accept');
    expect(state.pendingEventChoice!.resolved).toBe(true);
  });

  it('ends the chain cleanly when the accept option has no successor', () => {
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-choice-test');
    // Re-register BEFORE the draw: the presented option list is frozen at
    // draw time (AC3), so post-draw mutation would not be seen.
    registerStorylineOptions('evt-choice-test', twoWayOptions(null, 'evt-esc-worse'));
    processEndOfTurn(state); // pause — pendingEventChoice is now set
    const deckLen = state.incidentDeck.length;

    const res = resolveEventChoice(state, 'accept');

    expect(res.pushedCard).toBeNull();
    expect(state.incidentDeck.length).toBe(deckLen); // nothing added
  });
});

// ── Reject path (AC5 engine) ────────────────────────────────

describe('resolveEventChoice — Reject path', () => {
  it('skips the event effect entirely and pushes the reject successor', () => {
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-choice-test');
    const coinsBefore = coins(state);
    const repBefore = rep(state);
    processEndOfTurn(state); // pause

    const res = resolveEventChoice(state, 'reject');

    // Reject = refuse the consequence: NO coins/rep change.
    expect(coins(state)).toBe(coinsBefore);
    expect(rep(state)).toBe(repBefore);
    // But the escalation (worse card) is added to the deck.
    expect(res.pushedCard).not.toBeNull();
    expect(getBaseTypeId(res.pushedCard!.id)).toBe('evt-esc-worse');
    expect(getBaseTypeId(state.incidentDeck[state.incidentDeck.length - 1].id)).toBe('evt-esc-worse');
    // The token is the option label (F3 AC3).
    expect(state.pendingEventChoice!.chosenOption).toBe('Reject');
    expect(state.pendingEventChoice!.resolved).toBe(true);
  });

  it('rejecting an event whose reject option has no successor adds nothing to the deck', () => {
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-choice-test');
    // Re-register BEFORE the draw (the option list is frozen at draw time —
    // see AC3 / createPendingStorylineChoice).
    registerStorylineOptions('evt-choice-test', twoWayOptions('evt-esc-audit', null));
    processEndOfTurn(state); // pause — pendingEventChoice is now set
    const deckLen = state.incidentDeck.length;
    const coinsBefore = coins(state);

    const res = resolveEventChoice(state, 'reject');

    expect(res.pushedCard).toBeNull();
    expect(state.incidentDeck.length).toBe(deckLen);
    expect(coins(state)).toBe(coinsBefore); // no effect applied
  });
});

// ── Duration events (AC2 parent — DurationEventCard inherits) ─

describe('Duration choice events', () => {
  it('accept pushes a duration active effect and chains via the accept successor', () => {
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-dur-choice');
    const effectsBefore = state.activeEffects.length;
    processEndOfTurn(state); // pause

    const res = resolveEventChoice(state, 'accept');

    // Accept applied the duration effect (board-wide active effect).
    expect(state.activeEffects.length).toBe(effectsBefore + 1);
    expect(state.activeEffects[state.activeEffects.length - 1].effectType).toBe('income-multiplier');
    // No accept successor registered → chain ends.
    expect(res.pushedCard).toBeNull();
  });

  it('reject skips the duration effect but adds the reject successor escalation', () => {
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-dur-choice');
    const effectsBefore = state.activeEffects.length;
    processEndOfTurn(state); // pause

    const res = resolveEventChoice(state, 'reject');

    expect(state.activeEffects.length).toBe(effectsBefore); // NOT applied
    expect(res.pushedCard).not.toBeNull();
    expect(getBaseTypeId(res.pushedCard!.id)).toBe('evt-esc-dur');
  });
});

// ── finishDeferredEndOfTurn (deferred closing) ──────────────

describe('finishDeferredEndOfTurn completes the paused turn', () => {
  it('clears the pending choice, runs EndCheck and advances to the next week', () => {
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-choice-test');
    const paused = processEndOfTurn(state);
    assertTurnPaused(paused, state);
    resolveEventChoice(state, 'accept');

    const result = finishDeferredEndOfTurn(state);

    expect(state.pendingEventChoice).toBeNull(); // consumed
    expect(state.phase).toBe('WeekStart'); // next week
    expect(state.turn).toBe(2);
    expect(result.choicePending).toBe(false);
    expect(result.gameResult).toBe('playing');
  });

  it('throws when called without a resolved pending choice', () => {
    const state = createChoiceAwareState();
    expect(() => finishDeferredEndOfTurn(state)).toThrow(/resolved pending event choice/);
  });

  it('throws when the pending choice is still unresolved', () => {
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-choice-test');
    processEndOfTurn(state); // pending but UNRESOLVED
    expect(() => finishDeferredEndOfTurn(state)).toThrow(/resolved pending event choice/);
  });

  it('resolveEventChoice throws when no choice is pending', () => {
    const state = createChoiceAwareState();
    expect(() => resolveEventChoice(state, 'accept')).toThrow(/No pending event choice/);
  });

  it('resolveEventChoice throws when the choice was already resolved', () => {
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-choice-test');
    processEndOfTurn(state);
    resolveEventChoice(state, 'accept');
    expect(() => resolveEventChoice(state, 'reject')).toThrow(/already resolved/);
  });
});

// ── Multi-outcome draw contract (MS-0MV8KQHYJ003EJO6 / F3) ──
//
// Pin the resolution half of the arbitrary-outcome contract: exactly one
// seeded `state.rng()` draw per selection at resolution time, `pushChainCard`
// RNG-free, and same-seed replay determinism. The option candidates are
// authored through the programmatic registry because the CSV `options` column
// lands in F2 — the seam under test here (`resolveEventOption` /
// `resolveStorylineOption`) must draw from the candidate set regardless of
// how the option was authored.
//
// These suites were RED against the two-way
// flag/next-id implementation (which never drew — it resolved the single
// `successorId`); F3 landed the draw and flipped them to passing `it`s. Guards
// that hold regardless stay plain `it`.

/** Column header for the multi-outcome engine fixtures (all rows aligned). */
const ENGINE_CSV_COLUMNS = [
  'family', 'id', 'name', 'cost', 'tier', 'trigger', 'effect', 'target',
  'coinDelta', 'reputationDelta', 'options',
];

interface EngineChoiceSpec {
  id: string;
  name: string;
  effect: string;
  coinDelta?: number;
  /** Raw `options` cell (`label|cardA,cardB;label2|cardC`), when authored. */
  options?: string;
}

/** Builds an aligned event CSV using the options column. */
function buildEngineCsv(events: EngineChoiceSpec[]): string {
  const lines = [ENGINE_CSV_COLUMNS.join(',')];
  for (const e of events) {
    const row: Record<string, string> = {
      family: 'event',
      id: e.id,
      name: e.name,
      cost: '0',
      tier: '1',
      trigger: 'Incident',
      effect: e.effect,
      target: 'All',
      coinDelta: String(e.coinDelta ?? 0),
      reputationDelta: '0',
      options: e.options ?? '',
    };
    lines.push(
      ENGINE_CSV_COLUMNS.map((c) =>
        c === 'options' ? `"${(row[c] ?? '').replace(/"/g, '""')}"` : row[c] ?? '',
      ).join(','),
    );
  }
  return lines.join('\n');
}

const MULTI_OUTCOME_CSV = buildEngineCsv([
  { id: 'evt-mo-choice', name: 'Multi Choice', effect: 'Lose 100 coins', coinDelta: -100 },
  { id: 'evt-mo-a', name: 'Branch A', effect: 'Lose 10 coins', coinDelta: -10 },
  { id: 'evt-mo-b', name: 'Branch B', effect: 'Lose 20 coins', coinDelta: -20 },
  { id: 'evt-mo-c', name: 'Branch C', effect: 'Lose 30 coins', coinDelta: -30 },
]);

/**
 * The multi-outcome option shape under test. `successorIds` does not exist on
 * the public `StorylineOption` type until F2, so the fixtures here are cast.
 */
interface ContractOption {
  readonly label: string;
  readonly successorIds: readonly string[];
  readonly effectPolicy: 'apply' | 'skip';
  readonly successorResolver?: (state: MainStreetState) => string | null | undefined;
}

const MULTI_OUTCOME_OPTION_SPECS: ContractOption[] = [
  { label: 'Left', successorIds: ['evt-mo-a', 'evt-mo-b'], effectPolicy: 'apply' },
  { label: 'Right', successorIds: [], effectPolicy: 'apply' },
];

/** State with the multi-outcome node queued as the next incident. */
function setupMultiOutcomeState(seed: string): MainStreetState {
  // Load the synthetic pool BEFORE setup so every same-seed state builds its
  // market/deck from an identical template pool (identical RNG consumption).
  loadTemplatesFromCsv(MULTI_OUTCOME_CSV);
  const state = setupMainStreetGame({ seed, difficulty: 'Medium' });
  registerStorylineOptions(
    'evt-mo-choice',
    MULTI_OUTCOME_OPTION_SPECS as unknown as StorylineOption[],
  );
  state.phase = 'MarketPhase';
  state.incidentDeck.length = 0;
  state.incidentDeck.push({ ...loadTemplate('evt-mo-choice'), id: 'evt-mo-choice-0' });
  return state;
}

describe('F1 — exactly one seeded rng draw per selection at resolution time', () => {
  it('AC2 — resolving a chosen option performs exactly one state.rng() draw', () => {
    const state = setupMultiOutcomeState('mo-one-draw');
    processEndOfTurn(state); // draw -> pending choice
    const rngBefore = state.rngCalls;

    resolveEventOption(state, 0);

    expect(state.rngCalls).toBe(rngBefore + 1);
  });

  it('AC2 — a single-candidate set still consumes exactly one draw', () => {
    const state = setupMainStreetGame({ seed: 'mo-single-draw', difficulty: 'Medium' });
    loadTemplatesFromCsv(MULTI_OUTCOME_CSV);
    registerStorylineOptions('evt-mo-choice', [
      { label: 'Only', successorIds: ['evt-mo-a'], effectPolicy: 'apply' },
    ] as unknown as StorylineOption[]);
    state.phase = 'MarketPhase';
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...loadTemplate('evt-mo-choice'), id: 'evt-mo-choice-0' });
    processEndOfTurn(state);
    const rngBefore = state.rngCalls;

    resolveEventOption(state, 0);

    expect(state.rngCalls).toBe(rngBefore + 1);
  });

  it('AC2 — pushChainCard consumes no rng', () => {
    const state = setupMainStreetGame({ seed: 'mo-push-no-rng', difficulty: 'Medium' });
    loadTemplatesFromCsv(MULTI_OUTCOME_CSV);
    const rngBefore = state.rngCalls;

    const pushed = pushChainCard(state, 'evt-mo-a');

    expect(pushed?.id).toContain('evt-mo-a');
    expect(state.rngCalls).toBe(rngBefore);
  });

  it('AC2 — an empty candidate set ends the chain without consuming a draw', () => {
    const state = setupMultiOutcomeState('mo-terminal');
    processEndOfTurn(state);
    const deckLen = state.incidentDeck.length;
    const rngBefore = state.rngCalls;

    const res = resolveEventOption(state, 1); // 'Right' → successorIds []

    expect(res.pushedCard).toBeNull();
    expect(state.incidentDeck.length).toBe(deckLen);
    expect(state.rngCalls).toBe(rngBefore);
  });
});

describe('F1 — seeded replay determinism for candidate-set options', () => {
  it('AC2 — same seed resolves every option to the same successor (replay pair)', () => {
    for (const index of [0, 1]) {
      const seed = `mo-replay-${index}`;
      const a = setupMultiOutcomeState(seed);
      const b = setupMultiOutcomeState(seed);
      processEndOfTurn(a);
      processEndOfTurn(b);

      const ra = resolveEventOption(a, index);
      const rb = resolveEventOption(b, index);

      expect(ra.pushedCard?.id ?? null).toBe(rb.pushedCard?.id ?? null);
      // A non-terminal option must actually push a card (the draw happened).
      if (MULTI_OUTCOME_OPTION_SPECS[index].successorIds.length > 0) {
        expect(ra.pushedCard).not.toBeNull();
      }
    }
  });

  it('AC3 — the random draw never changes the option list the player sees', () => {
    const state = setupMultiOutcomeState('mo-visible');
    processEndOfTurn(state);
    const labelsBefore = state.pendingEventChoice!.options!.map((o) => o.label);

    resolveEventOption(state, 0);

    expect(state.pendingEventChoice!.options!.map((o) => o.label)).toEqual(labelsBefore);
  });
});

describe('F1 — successorResolver precedence at resolution time', () => {
  it('AC3 — a resolver overrides the candidate set and consumes no draw', () => {
    const state = setupMainStreetGame({ seed: 'mo-resolver', difficulty: 'Medium' });
    loadTemplatesFromCsv(MULTI_OUTCOME_CSV);
    registerStorylineOptions('evt-mo-choice', [{
      label: 'Directed',
      successorIds: ['evt-mo-a', 'evt-mo-b'],
      effectPolicy: 'apply',
      successorResolver: () => 'evt-mo-c',
    } as unknown as StorylineOption]);
    state.phase = 'MarketPhase';
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...loadTemplate('evt-mo-choice'), id: 'evt-mo-choice-0' });
    processEndOfTurn(state);
    const rngBefore = state.rngCalls;

    const res = resolveEventOption(state, 0);

    expect(res.pushedCard?.id).toContain('evt-mo-c');
    expect(state.rngCalls).toBe(rngBefore);
  });
});

// ── Transcript recording (AC6/AC12) ─────────────────────────

describe('transcript recording for event choices', () => {
  it('records an event-choice event with the chosen option label', () => {
    const recorder = new MainStreetTranscriptRecorder({ seed: 'x' });
    setMainStreetRecorder(recorder);
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-choice-test');
    processEndOfTurn(state);

    resolveEventChoice(state, 'reject');

    const events = recorder.getTranscript().events;
    const choiceEvent = events.find((e) => e.type === 'event-choice');
    expect(choiceEvent).toBeDefined();
    if (!choiceEvent || choiceEvent.type !== 'event-choice') return;
    expect(choiceEvent.eventId).toContain('evt-choice-test'); // instance id carries the base template id
    expect(choiceEvent.cardName).toBe('Test Choice Event');
    // F3 AC3: the transcript token is the option label, not a legacy
    // lowercase 'reject' value.
    expect(choiceEvent.option).toBe('Reject');
  });

  it('records the options-only event-choice schema (no resolved-successor ids)', () => {
    // AC4: the recorded event is the schema of record for a resolved choice,
    // so its key set is pinned. The chosen option label is the only
    // resolution token the options-only model records; re-introducing a
    // successor-id field widens this key set and fails here (a JSON-level
    // assertion, not a source scan).
    const recorder = new MainStreetTranscriptRecorder({ seed: 'x' });
    setMainStreetRecorder(recorder);
    const state = createChoiceAwareState();
    forceNextIncident(state, 'evt-choice-test');
    processEndOfTurn(state);

    resolveEventChoice(state, 'accept');

    const choiceEvent = recorder
      .getTranscript()
      .events.find((e) => e.type === 'event-choice');
    expect(choiceEvent).toBeDefined();
    if (!choiceEvent) return;

    // `week`/`year` are the calendar stamp the recorder attaches to every
    // event (CG-0MTT0K9RX0004QTE).
    expect(Object.keys(choiceEvent).sort()).toEqual([
      'cardName',
      'eventId',
      'option',
      'turn',
      'type',
      'week',
      'year',
    ]);
  });
});

// ── F1: multi-outcome transcript label (MS-0MV8KQHYJ003EJO6) ─

describe('F1 — transcript records the chosen option label for a multi-outcome node', () => {
  it('records the chosen option label as the stable token (F3 AC3)', () => {
    const recorder = new MainStreetTranscriptRecorder({ seed: 'mo-transcript' });
    setMainStreetRecorder(recorder);
    const state = setupMultiOutcomeState('mo-transcript');
    processEndOfTurn(state);

    resolveEventOption(state, 0); // 'Left' (successorIds candidate set)

    const events = recorder.getTranscript().events;
    const choiceEvent = events.find((e) => e.type === 'event-choice');
    expect(choiceEvent).toBeDefined();
    if (!choiceEvent || choiceEvent.type !== 'event-choice') return;
    expect(choiceEvent.eventId).toContain('evt-mo-choice');
    expect(choiceEvent.cardName).toBe('Multi Choice');
    // The chosen option is recorded as a stable label token (the raw label,
    // not a legacy 'accept'/'reject' or an index).
    expect(choiceEvent.option).toBe('Left');
  });
});
