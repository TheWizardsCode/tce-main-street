/**
 * Storyline behaviour regression harness
 *
 * Shipped story-driven event-chain regression tests for the Main Street game.
 * These tests lock the current Accept/Reject semantics for all seven shipped
 * choice cards (MS-0MUB0GFY00001ASV / C1):
 *
 *   evt-tax-error     Error in Tax Return       → evt-tax
 *   evt-tax           Tax Audit                 → evt-tax-inquiry (reject)
 *   evt-tax-inquiry   Inquiry Commission        → evt-tax-error (accept)
 *   evt-strike-service Service Workers Strike   → evt-general-strike
 *   evt-popular-menu  Popular Menu Item          → evt-farm-table
 *   evt-recession     Economic Recession         → evt-depression
 *   evt-flu-outbreak  Flu Outbreak               → evt-pandemic
 *
 * AC1: Legacy-pinned semantics facts — for every shipped card,
 *       resolveIncident stashes pendingEventChoice (no effect),
 *       resolveEventChoice('accept') applies the effect and draws the Accept
 *       option's successor from its candidate set;
 *       resolveEventChoice('reject') ALSO applies the event effect — migrated
 *       CSV options always carry effectPolicy 'apply' (Q4=B, F6) — then draws
 *       the Reject option's successor.
 * AC2: Chain links resolve — every option candidate references an existing card ID.
 * AC3: Invariant coverage — undo/redo, save/load round-trip, transcript
 *       shape, AI decision for Easy/Medium/Hard with shipped cards.
 * AC4: Tutorial exclusion pinned — choice incidents excluded.
 * AC5-6: Green baseline and full suite pass.
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
import {
  processEndOfTurn,
  resolveIncident,
  resolveEventChoice,
  resolveEventOption,
} from '../../src/MainStreetEngine';
import {
  getEventTemplates,
  loadTemplatesFromCsv,
  getBaseTypeId,
  resetTemplatesToDefault,
} from '../../src/MainStreetCards';
import {
  getPendingStorylineOptions,
  getStorylineOptions,
  registerStorylineOptions,
  resetStorylineRegistry,
} from '../../src/MainStreetStoryline';
import type { StorylineOption } from '../../src/MainStreetCardsTypes';
import {
  decideEventChoice,
} from '../../src/MainStreetEngineScoring';
import {
  resolveAiEventChoice,
} from '../../src/MainStreetAiStrategy';
import {
  MainStreetTranscriptRecorder,
  setMainStreetRecorder,
} from '../../src/MainStreetTranscript';
import { UndoRedoManager } from '@core-engine/UndoRedoManager';
import { resolveEventChoiceCommand } from '../../src/MainStreetCommands';
import {
  createTutorialScenario,
  STANDARD_TUTORIAL_SCENARIO,
} from '../../src/TutorialScenario';
import type { EventCard } from '../../src/MainStreetCards';
import {
  COST_FIXTURE_EVENT_ID,
  COST_GATED_LABEL,
  ESCALATING_LABEL,
  EXTRA_EFFECT_LABEL,
  PRESENTED_LABELS,
  queueCostFixtureChoice,
  registerAiCostFixtures,
} from './helpers/aiEventChoiceCostFixtures';

// ── The seven shipped choice cards (alphabetical) ───────────

const CHOICE_CARDS = [
  'evt-flu-outbreak',
  'evt-popular-menu',
  'evt-recession',
  'evt-strike-service',
  'evt-tax',
  'evt-tax-error',
  'evt-tax-inquiry',
];

/** Resolve the template for a shipped choice card (throws if missing). */
function shippedChoice(id: string): EventCard {
  const t = getEventTemplates().find((c) => c.id === id);
  if (!t) throw new Error(`Shipped choice card ${id} not found`);
  return t as EventCard;
}

/** Push a single shipped choice card into the incident deck for testing. */
function queueChoice(state: MainStreetState, templateId: string): void {
  state.incidentDeck.length = 0;
  const t = shippedChoice(templateId);
  state.incidentDeck.push({ ...t, id: `${t.id}-0` });
}

/** Assert the turn is paused with a pending choice. */
function expectChoicePending(state: MainStreetState): void {
  expect(state.pendingEventChoice).not.toBeNull();
  expect(state.pendingEventChoice!.resolved).toBe(false);
  expect(state.pendingEventChoice!.chosenOption).toBeNull();
}

afterEach(() => {
  setMainStreetRecorder(null);
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

// ── AC1: Legacy choice semantics for every shipped card ─────

describe('AC1 — resolveIncident defers every shipped choice card', () => {
  for (const cardId of CHOICE_CARDS) {
    it(`${cardId}: resolveIncident stashes pendingEventChoice without applying effect`, () => {
      const state = setupMainStreetGame({ seed: `ac1-${cardId}`, difficulty: 'Medium' });
      state.phase = 'MarketPhase'; // required for resolveIncident to draw
      queueChoice(state, cardId);
      const coinsBefore = state.resourceBank.coins;
      const repBefore = state.resourceBank.reputation;

      const drawn = resolveIncident(state);

      // Deferred: no event returned, no effect applied.
      expect(drawn).toBeNull();
      expect(state.resourceBank.coins).toBe(coinsBefore);
      expect(state.resourceBank.reputation).toBe(repBefore);
      expectChoicePending(state);
      // The pending event is the shipped template (base id matches).
      expect(state.pendingEventChoice!.event.id).toContain(cardId);
    });
  }
});

describe('AC1 — Accept path: apply effect + push the Accept option successor', () => {
  for (const cardId of CHOICE_CARDS) {
    it(`${cardId}: accept applies the event effect and pushes the Accept candidate`, () => {
      const state = setupMainStreetGame({ seed: `ac1-accept-${cardId}`, difficulty: 'Medium' });
      state.phase = 'MarketPhase';
      queueChoice(state, cardId);
      const template = shippedChoice(cardId) as EventCard;
      const acceptTargets = (getStorylineOptions(template).find((o) => o.label === 'Accept')?.successorIds ?? []);

      processEndOfTurn(state); // pause — removes card from deck
      const deckLenAfterDraw = state.incidentDeck.length;
      const coinsBefore = state.resourceBank.coins;
      const repBefore = state.resourceBank.reputation;
      const res = resolveEventChoice(state, 'accept');

      // Effect applied: coins/rep changed in the direction of the event.
      const actualCoinChange = state.resourceBank.coins - coinsBefore;
      const expectedSign = template.coinDelta >= 0 ? 1 : -1;
      expect(actualCoinChange * expectedSign).toBeGreaterThanOrEqual(0);
      // Reputation delta (for non-zero reputationDelta events).
      if (template.reputationDelta && template.reputationDelta !== 0) {
        const actualRepChange = state.resourceBank.reputation - repBefore;
        const expectedRepSign = template.reputationDelta >= 0 ? 1 : -1;
        expect(actualRepChange * expectedRepSign).toBeGreaterThanOrEqual(0);
      }
      // The pending choice is resolved — the token is the option label (F3 AC3).
      expect(state.pendingEventChoice!.chosenOption).toBe('Accept');
      expect(state.pendingEventChoice!.resolved).toBe(true);
      // Pushed card: a member of the Accept option's candidate set, if any.
      if (acceptTargets.length > 0) {
        expect(res.pushedCard).not.toBeNull();
        expect(acceptTargets).toContain(getBaseTypeId(res.pushedCard!.id));
        expect(state.incidentDeck.length).toBe(deckLenAfterDraw + 1);
      } else {
        expect(res.pushedCard).toBeNull();
        expect(state.incidentDeck.length).toBe(deckLenAfterDraw);
      }
    });
  }
});

describe('AC1 — Reject path: applies the effect (Q4=B) + pushes the Reject successor', () => {
  for (const cardId of CHOICE_CARDS) {
    it(`${cardId}: reject applies the event effect and pushes the Reject candidate`, () => {
      const state = setupMainStreetGame({ seed: `ac1-reject-${cardId}`, difficulty: 'Medium' });
      state.phase = 'MarketPhase';
      queueChoice(state, cardId);
      const coinsBefore = state.resourceBank.coins;
      const repBefore = state.resourceBank.reputation;
      const template = shippedChoice(cardId) as EventCard;
      const rejectTargets = (getStorylineOptions(template).find((o) => o.label === 'Reject')?.successorIds ?? []);

      processEndOfTurn(state); // pause — removes card from deck
      const deckLenAfterDraw = state.incidentDeck.length;
      const res = resolveEventChoice(state, 'reject');

      // F6 migration note (Q4=B): migrated CSV options always carry
      // effectPolicy 'apply', so the former Reject branch now APPLIES the
      // event effect instead of skipping it.
      const actualCoinChange = state.resourceBank.coins - coinsBefore;
      const expectedSign = template.coinDelta >= 0 ? 1 : -1;
      expect(actualCoinChange * expectedSign).toBeGreaterThanOrEqual(0);
      if (template.reputationDelta && template.reputationDelta !== 0) {
        const actualRepChange = state.resourceBank.reputation - repBefore;
        const expectedRepSign = template.reputationDelta >= 0 ? 1 : -1;
        expect(actualRepChange * expectedRepSign).toBeGreaterThanOrEqual(0);
      }
      // Pushed card: a member of the Reject option's candidate set, if any.
      if (rejectTargets.length > 0) {
        expect(res.pushedCard).not.toBeNull();
        expect(rejectTargets).toContain(getBaseTypeId(res.pushedCard!.id));
        expect(state.incidentDeck.length).toBe(deckLenAfterDraw + 1);
      } else {
        expect(res.pushedCard).toBeNull();
        expect(state.incidentDeck.length).toBe(deckLenAfterDraw);
      }
      // The chosen token is the option label (F3 AC3).
      expect(state.pendingEventChoice!.chosenOption).toBe('Reject');
      expect(state.pendingEventChoice!.resolved).toBe(true);
    });
  }
});

// ── AC2: Chain links resolve ─────────────────────────────────

describe('AC2 — every option candidate references an existing card', () => {
  it('all candidate successor ids resolve to shipped template IDs', () => {
    const allIds = new Set(getEventTemplates().map((c) => c.id));
    for (const cardId of CHOICE_CARDS) {
      const options = getStorylineOptions(shippedChoice(cardId));
      expect(options.length).toBeGreaterThan(0);
      for (const option of options) {
        for (const target of option.successorIds ?? []) {
          expect(allIds.has(target),
            `${cardId} option ${option.label} candidate ${target} must exist`).toBe(true);
        }
      }
    }
  });
});

// ── AC3: Invariant coverage ──────────────────────────────────

describe('AC3a — undo/redo of a resolved shipped choice', () => {
  for (const cardId of CHOICE_CARDS) {
    it(`${cardId}: undo/redo round-trip with accept`, () => {
      const state = setupMainStreetGame({ seed: `ac3-undo-${cardId}`, difficulty: 'Medium' });
      state.phase = 'MarketPhase';
      queueChoice(state, cardId);
      const coinsBefore = state.resourceBank.coins;
      processEndOfTurn(state); // pause — removes card from deck

      // Measure deck length after the incident was drawn (card removed).
      const deckLenAfterDraw = state.incidentDeck.length;

      const undo = new UndoRedoManager();
      const cmd = resolveEventChoiceCommand(state, 'accept');
      undo.execute(cmd);

      // Execute: effect applied, escalation pushed if present.
      expect(state.pendingEventChoice!.resolved).toBe(true);
      // Label token (F3 AC3).
      expect(state.pendingEventChoice!.chosenOption).toBe('Accept');
      // Deck grows by one when the Accept option has a candidate, else stays.
      expect(state.incidentDeck.length).toBeGreaterThanOrEqual(deckLenAfterDraw);

      // Undo: back to unresolved pending.
      undo.undo();
      expect(state.pendingEventChoice).not.toBeNull();
      expect(state.pendingEventChoice!.resolved).toBe(false);
      expect(state.resourceBank.coins).toBe(coinsBefore);
      // Deck restored to pre-execute state.
      expect(state.incidentDeck.length).toBe(deckLenAfterDraw);

      // Redo: re-apply.
      undo.redo();
      expect(state.pendingEventChoice!.resolved).toBe(true);
    });
  }
});

describe('AC3b — save/load round-trip of pendingEventChoice', () => {
  for (const cardId of CHOICE_CARDS) {
    it(`${cardId}: unresolved pending survives serialize/deserialize`, () => {
      const state = setupMainStreetGame({ seed: `ac3-save-${cardId}`, difficulty: 'Medium' });
      state.phase = 'MarketPhase';
      queueChoice(state, cardId);
      processEndOfTurn(state); // pause
      expectChoicePending(state);

      const saved = serializeMainStreetState(state);
      expect(saved.pendingEventChoice).not.toBeNull();

      const restored = deserializeMainStreetState(saved as never);
      expect(restored.pendingEventChoice).not.toBeNull();
      expect(restored.pendingEventChoice!.resolved).toBe(false);
      expect(restored.pendingEventChoice!.chosenOption).toBeNull();
      expect(restored.pendingEventChoice!.event.id).toContain(cardId);
    });
  }
});

describe('AC3b — legacy save compatibility (no pendingEventChoice field)', () => {
  it('legacy save without pendingEventChoice loads with null default', () => {
    const state = setupMainStreetGame({ seed: 'legacy-compat', difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    queueChoice(state, CHOICE_CARDS[0]);
    processEndOfTurn(state); // pause
    const saved = serializeMainStreetState(state);
    delete (saved as { pendingEventChoice?: unknown }).pendingEventChoice;
    const restored = deserializeMainStreetState(saved as never);
    expect(restored.pendingEventChoice).toBeNull();
    // The saved state is restored cleanly.
    expect(restored.gameResult).toBe('playing');
  });
});

describe('AC3c — transcript event-choice shape for shipped cards', () => {
  it('the transcript records an event-choice with the correct shape', () => {
    const cardId = CHOICE_CARDS[0]; // evt-flu-outbreak
    const recorder = new MainStreetTranscriptRecorder({ seed: 'ac3-transcript' });
    setMainStreetRecorder(recorder);
    const state = setupMainStreetGame({ seed: 'transcript-shape', difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    queueChoice(state, cardId);
    processEndOfTurn(state);
    resolveEventChoice(state, 'accept');

    const events = recorder.getTranscript().events;
    const choiceEvent = events.find((e) => e.type === 'event-choice');
    expect(choiceEvent).toBeDefined();
    if (!choiceEvent || choiceEvent.type !== 'event-choice') return;

    // Shape assertions (AC12 parent):
    expect(typeof choiceEvent.turn).toBe('number');
    expect(typeof choiceEvent.eventId).toBe('string');
    expect(typeof choiceEvent.cardName).toBe('string');
    // F3 AC3: the transcript token is the option label.
    expect(choiceEvent.option).toBe('Accept');
    // Both next-card IDs present (even if undefined, the shape includes them).
    expect('acceptNextCardId' in choiceEvent).toBe(true);
    expect('rejectNextCardId' in choiceEvent).toBe(true);
  });
});

describe('AC3d — AI decideEventChoice for shipped cards (Easy/Medium/Hard)', () => {
  // F7 (MS-0MV8KQSF1004E53Y): the AI returns an option INDEX over the
  // compiled option list and all difficulties share the least-harmful-chain
  // rule. For the shipped content the positive node's Accept option is
  // terminal (severity 0), so the AI picks index 0.
  for (const cardId of CHOICE_CARDS) {
    it(`${cardId}: AI picks index 0 for positive events on all difficulties`, () => {
      const template = shippedChoice(cardId) as EventCard;
      if (template.coinDelta + (template.reputationDelta ?? 0) >= 0) {
        const state = setupMainStreetGame({ seed: `ai-pos-${cardId}`, difficulty: 'Easy' });
        expect(decideEventChoice(state, template, 'Easy')).toBe(0);
        expect(decideEventChoice(state, template, 'Medium')).toBe(0);
        expect(decideEventChoice(state, template, 'Hard')).toBe(0);
      }
    });

    it(`${cardId}: decision is a valid index for every difficulty`, () => {
      const template = shippedChoice(cardId) as EventCard;
      const optionCount = getStorylineOptions(template).length;
      expect(optionCount).toBeGreaterThan(0);
      for (const difficulty of ['Easy', 'Medium', 'Hard'] as const) {
        const state = setupMainStreetGame({ seed: `ai-idx-${cardId}-${difficulty}`, difficulty });
        const index = decideEventChoice(state, template, difficulty);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(optionCount);
      }
    });
  }
});

describe('AC3d — resolveAiEventChoice completes a paused turn with a shipped card', () => {
  for (const cardId of CHOICE_CARDS) {
    it(`${cardId}: resolveAiEventChoice resolves and advances the turn`, () => {
      const state = setupMainStreetGame({ seed: `ai-complete-${cardId}`, difficulty: 'Medium' });
      state.phase = 'MarketPhase';
      queueChoice(state, cardId);
      const turnBefore = state.turn;
      processEndOfTurn(state); // pause
      expectChoicePending(state);

      const result = resolveAiEventChoice(state);

      expect(state.pendingEventChoice).toBeNull();
      expect(state.phase).toBe('WeekStart');
      expect(state.turn).toBe(turnBefore + 1);
      expect(result).not.toBeNull();
    });
  }
});

// ── AC1: AI decision parity with the pre-policy behaviour ────
//
// MS-0MVNU5HNV007R803: the cost-aware policy (MS-0MVNU5EEC006ZCTF) must not
// move a single shipped-card decision. The table below is the decision the
// pre-policy severity-only implementation (`decideEventChoice` over the
// unfiltered list) returned for each card at `d09735a8^` — the commit before
// the cost-aware policy landed. Only `evt-tax-inquiry` is non-zero: its Accept
// option escalates to `evt-tax-error` (severity 200) while Reject is terminal.
// Shipped options declare no `cost`/`extraEffect`, so the projected value
// delta is 0 and the policy is decision-for-decision identical.
const LEGACY_AI_CHOICE_INDEX: Record<string, number> = {
  'evt-flu-outbreak': 0,
  'evt-popular-menu': 0,
  'evt-recession': 0,
  'evt-strike-service': 0,
  'evt-tax': 0,
  'evt-tax-error': 0,
  'evt-tax-inquiry': 1,
};

describe('AC1 — AI decision parity with the pre-policy behaviour', () => {
  it('pins a legacy index for every shipped choice card', () => {
    expect(Object.keys(LEGACY_AI_CHOICE_INDEX).sort()).toEqual([...CHOICE_CARDS].sort());
  });

  for (const cardId of CHOICE_CARDS) {
    it(`${cardId}: Easy/Medium/Hard all return the pre-policy index`, () => {
      const template = shippedChoice(cardId);
      for (const difficulty of ['Easy', 'Medium', 'Hard'] as const) {
        const state = setupMainStreetGame({
          seed: `legacy-parity-${cardId}-${difficulty}`,
          difficulty,
        });
        const presented = getStorylineOptions(template, state);
        const index = decideEventChoice(state, template, difficulty);

        // Behavioural parity: the same index the legacy policy selected.
        expect(index).toBe(LEGACY_AI_CHOICE_INDEX[cardId]);
        // …and that index addresses an option the player is actually offered.
        expect(presented[index]).toBeDefined();
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(presented.length);
        expect(LEGACY_AI_CHOICE_INDEX[cardId]).toBeLessThan(presented.length);
      }
    });
  }
});

// ── AC4: Tutorial exclusion pinned ───────────────────────────

describe('AC4 — choice incidents excluded from tutorial play', () => {
  it('every tutorial-pinned incident is non-choice', () => {
    for (const templateId of STANDARD_TUTORIAL_SCENARIO.incidentDeck) {
      const t = getEventTemplates().find((c) => c.id === templateId);
      expect(t, `template ${templateId} must exist`).toBeDefined();
      expect(Boolean(t!.hasChoices)).toBe(false);
    }
  });

  it('none of the shipped choice cards appear in the tutorial incident deck', () => {
    const tutorialDeck = new Set(STANDARD_TUTORIAL_SCENARIO.incidentDeck);
    for (const cardId of CHOICE_CARDS) {
      expect(tutorialDeck.has(cardId),
        `${cardId} must not be in the tutorial incident deck`).toBe(false);
    }
  });

  it('building a tutorial scenario with a choice incident throws', () => {
    // Flip a tutorial-pinned card to a choice event.
    const award = getEventTemplates().find((t) => t.id === 'evt-award')!;
    (award as { hasChoices?: boolean }).hasChoices = true;
    expect(() => createTutorialScenario({
      ...STANDARD_TUTORIAL_SCENARIO,
      incidentDeck: ['evt-award'],
    })).toThrow(/hasChoices/);
  });
});

// ── AC4: cost-gated / extra-effect transcript harness ────────
//
// MS-0MVNU5HNV007R803: register BOTH a cost-gated and an extra-effect option
// on a shipped choice card and drive the decision through the real draw →
// presented-list → transcript path. The recorded transcript label must always
// be one that was actually presented, so the cost-gated (unaffordable) option
// can never appear and the extra-effect option must win.

describe('AC4 — cost-gated and extra-effect options in the transcript harness', () => {
  it('records an option label that was actually presented, never a cost-gated one', () => {
    registerAiCostFixtures();
    const recorder = new MainStreetTranscriptRecorder({ seed: 'ac4-cost-transcript' });
    setMainStreetRecorder(recorder);
    const state = setupMainStreetGame({ seed: 'ac4-cost-transcript', difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    queueCostFixtureChoice(state);

    const paused = processEndOfTurn(state);
    expect(paused.choicePending).toBe(true);
    const pending = state.pendingEventChoice;
    if (!pending) throw new Error('fixture choice was not paused');

    // Draw-time snapshot: the unaffordable bribe is filtered out. This is
    // exactly the list the player and the AI are offered.
    const presented = getPendingStorylineOptions(pending, state).map((o) => o.label);
    expect(presented).toEqual([...PRESENTED_LABELS]);
    expect(presented).not.toContain(COST_GATED_LABEL);

    expect(() => resolveAiEventChoice(state)).not.toThrow();
    expect(state.pendingEventChoice).toBeNull();

    const choiceEvent = recorder
      .getTranscript()
      .events.find((e) => e.type === 'event-choice' && e.eventId.startsWith(COST_FIXTURE_EVENT_ID));
    expect(choiceEvent).toBeDefined();
    if (!choiceEvent || choiceEvent.type !== 'event-choice') return;

    // The transcript label is one of the presented options…
    expect(presented).toContain(choiceEvent.option);
    // …never the cost-gated option that the filter dropped…
    expect(choiceEvent.option).not.toBe(COST_GATED_LABEL);
    // …and the extra-effect option wins over the punitive escalation.
    expect(choiceEvent.option).toBe(EXTRA_EFFECT_LABEL);
    expect(choiceEvent.option).not.toBe(ESCALATING_LABEL);
  });
});

// ── AC5/6: Green baseline (suite is run by the harness runner) ─

describe('AC5 — regression harness smoke', () => {
  it('the full shipped-choice set is intact', () => {
    const shippedChoiceIds = getEventTemplates()
      .filter((c) => c.family === 'event' && Boolean(c.hasChoices))
      .map((c) => c.id)
      .sort();
    expect(shippedChoiceIds).toEqual(CHOICE_CARDS);
  });
});

// ── F1: seeded multi-outcome replay coverage (MS-0MV8KQHYJ003EJO6) ──
//
// Extends the shipped-choice harness with the arbitrary-outcome model: a
// registered multi-candidate option must resolve to the same successor across
// same-seed replays and consume exactly one seeded draw. The five shipped
// storylines are migrated in F6 and F9 owns the full green gate; these
// tracer-bullet cases were RED (`it.fails`) until the random draw landed in
// F3, which flipped them to passing `it`s.

const MO_HARNESS_CSV = [
  'family,id,name,cost,tier,trigger,effect,target,coinDelta,reputationDelta,hasChoices',
  'event,evt-mo-h,Multi Harness,0,1,Incident,Lose 100 coins,All,-100,0,true',
  'event,evt-mo-h-a,Branch A,0,1,Incident,Lose 10 coins,All,-10,0,',
  'event,evt-mo-h-b,Branch B,0,1,Incident,Lose 20 coins,All,-20,0,',
].join('\n');

/** Queues the synthetic multi-outcome node as the next incident. */
function queueMultiOutcome(state: MainStreetState): void {
  const t = getEventTemplates().find((c) => c.id === 'evt-mo-h');
  if (!t) throw new Error('Synthetic multi-outcome template evt-mo-h missing');
  state.incidentDeck.length = 0;
  state.incidentDeck.push({ ...t, id: 'evt-mo-h-0' });
}

/** Builds an identically-seeded state with the multi-outcome node queued. */
function multiOutcomeState(seed: string): MainStreetState {
  // Load the synthetic pool BEFORE setup so the replay pair consumes an
  // identical RNG stream while building its market/deck.
  loadTemplatesFromCsv(MO_HARNESS_CSV);
  const state = setupMainStreetGame({ seed, difficulty: 'Medium' });
  state.phase = 'MarketPhase';
  queueMultiOutcome(state);
  return state;
}

describe('F1 — seeded multi-outcome replay coverage (MS-0MV8KQHYJ003EJO6)', () => {
  it('AC2 — same seed resolves a candidate-set option to the same successor', () => {
    registerStorylineOptions('evt-mo-h', [
      { label: 'Branch', successorIds: ['evt-mo-h-a', 'evt-mo-h-b'], effectPolicy: 'apply' },
    ] as unknown as StorylineOption[]);

    const a = multiOutcomeState('harness-replay');
    processEndOfTurn(a);
    const ra = resolveEventOption(a, 0);

    const b = multiOutcomeState('harness-replay');
    processEndOfTurn(b);
    const rb = resolveEventOption(b, 0);

    expect(ra.pushedCard).not.toBeNull();
    expect(ra.pushedCard!.id).toBe(rb.pushedCard!.id);
  });

  it('AC2 — resolving a candidate-set option consumes exactly one seeded draw', () => {
    registerStorylineOptions('evt-mo-h', [
      { label: 'Branch', successorIds: ['evt-mo-h-a', 'evt-mo-h-b'], effectPolicy: 'apply' },
    ] as unknown as StorylineOption[]);

    const state = multiOutcomeState('harness-one-draw');
    processEndOfTurn(state);
    const rngBefore = state.rngCalls;

    resolveEventOption(state, 0);

    expect(state.rngCalls).toBe(rngBefore + 1);
  });
});

// ── F9: seeded replay pinning (MS-0MV8KQVOL0047QIK) ─────────
//
// Final verification item: pin the seeded replay/Monte-Carlo determinism
// claims end-to-end. Both the PLAYER path (resolveEventOption) and the AI
// path (resolveAiEventChoice) must resolve the same good seed to the same
// random successor — the uniform candidate draw consumes exactly one
// seeded state.rng() call, so same-seed runs agree and different seeds may
// differ.

const F9_OPTIONS = [
  { label: 'Branch', successorIds: ['evt-mo-h-a', 'evt-mo-h-b'], effectPolicy: 'apply' },
] as unknown as StorylineOption[];

describe('F9 — seeded player-path replay pair (MS-0MV8KQVOL0047QIK)', () => {
  it('same seed resolves the multi-candidate option to the same successor', () => {
    registerStorylineOptions('evt-mo-h', F9_OPTIONS);
    const player = (seed: string): string | null => {
      const state = multiOutcomeState(seed);
      processEndOfTurn(state);
      return getBaseTypeId(resolveEventOption(state, 0).pushedCard!.id);
    };
    expect(player('f9-player-replay-a')).toBe(player('f9-player-replay-a'));
    expect(player('f9-player-replay-b')).toBe(player('f9-player-replay-b'));
    // The draw landed on one of the two candidates (fan-out exercised).
    expect(['evt-mo-h-a', 'evt-mo-h-b']).toContain(player('f9-player-replay-a'));
  });
});

describe('F9 — seeded AI-path replay pair (MS-0MV8KQVOL0047QIK)', () => {
  it('same seed through resolveAiEventChoice takes the same random branch', () => {
    registerStorylineOptions('evt-mo-h', F9_OPTIONS);
    const run = (seed: string): { drawn: string | null; resolved: boolean } => {
      const state = multiOutcomeState(seed);
      processEndOfTurn(state);
      resolveAiEventChoice(state);
      const pushed = state.incidentDeck[0];
      return {
        drawn: pushed ? getBaseTypeId(pushed.id) : null,
        resolved: state.pendingEventChoice === null,
      };
    };
    // Identical inputs ⇒ identical successors (deterministic replay).
    expect(run('f9-ai-replay-a')).toEqual(run('f9-ai-replay-a'));
    expect(run('f9-ai-replay-b')).toEqual(run('f9-ai-replay-b'));
    const a = run('f9-ai-replay-a');
    // The AI resolved headlessly (no pending choice left) onto a valid
    // candidate of the single-option node.
    expect(a.resolved).toBe(true);
    expect(['evt-mo-h-a', 'evt-mo-h-b']).toContain(a.drawn);
  });
});
