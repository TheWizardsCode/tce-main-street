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
 * AC1: Legacy choice semantics pinned — for every shipped card,
 *       resolveIncident stashes pendingEventChoice (no effect),
 *       resolveEventChoice('accept') applies effect + pushes acceptNextCardId,
 *       resolveEventChoice('reject') skips effect + pushes rejectNextCardId.
 * AC2: Chain links resolve — acceptNextCardId / rejectNextCardId reference
 *       existing card IDs.
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
} from '../../src/MainStreetEngine';
import {
  getEventTemplates,
  resetTemplatesToDefault,
} from '../../src/MainStreetCards';
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

describe('AC1 — Accept path: apply effect + push acceptNextCardId', () => {
  for (const cardId of CHOICE_CARDS) {
    it(`${cardId}: accept applies the event effect and pushes acceptNextCardId`, () => {
      const state = setupMainStreetGame({ seed: `ac1-accept-${cardId}`, difficulty: 'Medium' });
      state.phase = 'MarketPhase';
      queueChoice(state, cardId);
      const template = shippedChoice(cardId) as EventCard;

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
      // The pending choice is resolved.
      expect(state.pendingEventChoice!.chosenOption).toBe('accept');
      expect(state.pendingEventChoice!.resolved).toBe(true);
      // Pushed card: acceptNextCardId if present, otherwise null.
      const acceptNext = template.acceptNextCardId ?? null;
      if (acceptNext) {
        expect(res.pushedCard).not.toBeNull();
        expect(res.pushedCard!.id).toContain(acceptNext);
        expect(state.incidentDeck.length).toBe(deckLenAfterDraw + 1);
      } else {
        expect(res.pushedCard).toBeNull();
        expect(state.incidentDeck.length).toBe(deckLenAfterDraw);
      }
    });
  }
});

describe('AC1 — Reject path: skip effect + push rejectNextCardId', () => {
  for (const cardId of CHOICE_CARDS) {
    it(`${cardId}: reject skips the event effect and pushes rejectNextCardId`, () => {
      const state = setupMainStreetGame({ seed: `ac1-reject-${cardId}`, difficulty: 'Medium' });
      state.phase = 'MarketPhase';
      queueChoice(state, cardId);
      const coinsBefore = state.resourceBank.coins;
      const repBefore = state.resourceBank.reputation;
      const template = shippedChoice(cardId) as EventCard;

      processEndOfTurn(state); // pause — removes card from deck
      const deckLenAfterDraw = state.incidentDeck.length;
      const res = resolveEventChoice(state, 'reject');

      // Reject: NO effect applied.
      expect(state.resourceBank.coins).toBe(coinsBefore);
      expect(state.resourceBank.reputation).toBe(repBefore);
      // Pushed card: rejectNextCardId if present, otherwise null.
      const rejectNext = template.rejectNextCardId ?? null;
      if (rejectNext) {
        expect(res.pushedCard).not.toBeNull();
        expect(res.pushedCard!.id).toContain(rejectNext);
        expect(state.incidentDeck.length).toBe(deckLenAfterDraw + 1);
      } else {
        expect(res.pushedCard).toBeNull();
        expect(state.incidentDeck.length).toBe(deckLenAfterDraw);
      }
      expect(state.pendingEventChoice!.chosenOption).toBe('reject');
      expect(state.pendingEventChoice!.resolved).toBe(true);
    });
  }
});

// ── AC2: Chain links resolve ─────────────────────────────────

describe('AC2 — every acceptNextCardId / rejectNextCardId references an existing card', () => {
  it('all chain links resolve to shipped template IDs', () => {
    const allIds = new Set(getEventTemplates().map((c) => c.id));
    for (const cardId of CHOICE_CARDS) {
      const template = shippedChoice(cardId) as EventCard;
      if (template.acceptNextCardId) {
        expect(allIds.has(template.acceptNextCardId),
          `${cardId}.acceptNextCardId (${template.acceptNextCardId}) must exist`).toBe(true);
      }
      if (template.rejectNextCardId) {
        expect(allIds.has(template.rejectNextCardId),
          `${cardId}.rejectNextCardId (${template.rejectNextCardId}) must exist`).toBe(true);
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
      expect(state.pendingEventChoice!.chosenOption).toBe('accept');
      // Deck grows by one if acceptNextCardId is set, stays same otherwise.
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
    expect(choiceEvent.option).toBe('accept');
    // Both next-card IDs present (even if undefined, the shape includes them).
    expect('acceptNextCardId' in choiceEvent).toBe(true);
    expect('rejectNextCardId' in choiceEvent).toBe(true);
  });
});

describe('AC3d — AI decideEventChoice for shipped cards (Easy/Medium/Hard)', () => {
  for (const cardId of CHOICE_CARDS) {
    it(`${cardId}: AI accepts positive events on all difficulties`, () => {
      const template = shippedChoice(cardId) as EventCard;
      if (template.coinDelta + (template.reputationDelta ?? 0) >= 0) {
        const state = setupMainStreetGame({ seed: `ai-pos-${cardId}`, difficulty: 'Easy' });
        expect(decideEventChoice(state, template, 'Easy')).toBe('accept');
        expect(decideEventChoice(state, template, 'Medium')).toBe('accept');
        expect(decideEventChoice(state, template, 'Hard')).toBe('accept');
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
