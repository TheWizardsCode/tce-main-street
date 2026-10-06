/**
 * Named storylines, outcome feedback & continuity indicator
 * (MS-0MUMP96XH002SJ89)
 *
 * AC1 — Named storylines surfaced: the dialog title/subtitle use the storyline
 *       name (fallback: card name) and the activity log names the storyline.
 * AC2 — Outcome feedback: a resolved choice emits a narrative "story update"
 *       line tied to its storylineId.
 * AC3 — Continuity indicator: a storyline is active while a card of it is
 *       pending or queued, persists through cycles, and clears when it ends.
 * AC4 — Reduced motion: the presentation is instant (no animation input) —
 *       the helpers are pure and synchronous.
 * AC5 — Determinism preserved (covered by the C1 harness; smoke-checked here).
 *
 * @module
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  processEndOfTurn,
  resolveEventChoice,
} from '../../src/MainStreetEngine';
import {
  type EventCard,
  getEventTemplates,
  resetTemplatesToDefault,
} from '../../src/MainStreetCards';
import {
  choiceDialogTitle,
  choiceDialogSubtitle,
  storylineName,
  storyUpdateLine,
  getActiveStorylines,
  continuityIndicatorLabel,
} from '../../src/MainStreetStorylineUi';
import { resetStorylineRegistry } from '../../src/MainStreetStoryline';

function card(id: string): EventCard {
  const t = getEventTemplates().find((c) => c.id === id);
  if (!t) throw new Error(`template ${id} missing`);
  return t as EventCard;
}

function makeEvent(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event',
    id: 'evt-x',
    name: 'X',
    trigger: 'Incident',
    cost: 0,
    effect: 'x',
    target: 'All',
    coinDelta: -10,
    reputationDelta: 0,
    ...overrides,
  } as EventCard;
}

/** Queues a single incident and pauses the turn on its choice. */
function pauseWithStoryline(state: MainStreetState, templateId: string): EventCard {
  const t = card(templateId);
  state.phase = 'MarketPhase';
  state.incidentDeck.length = 0;
  state.incidentDeck.push({ ...t, id: `${t.id}-0` });
  processEndOfTurn(state);
  return t;
}

afterEach(() => {
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

// ── AC1: named storylines surfaced ──────────────────────────

describe('AC1 — named storylines surfaced', () => {
  it('storylineName prefers the title, falls back to the id', () => {
    expect(storylineName(makeEvent({ storylineId: 's1', storylineTitle: 'Arc One' }))).toBe('Arc One');
    expect(storylineName(makeEvent({ storylineId: 's1' }))).toBe('s1');
    expect(storylineName(makeEvent())).toBeNull();
  });

  it('the dialog title shows the storyline name when available', () => {
    const storylineCard = card('evt-flu-outbreak');
    expect(storylineCard.storylineTitle).toBe('Public Health Crisis');
    expect(choiceDialogTitle(storylineCard)).toBe('Public Health Crisis');
    // Subtitle names the specific incident.
    expect(choiceDialogSubtitle(storylineCard)).toBe('Flu Outbreak');
  });

  it('the dialog title falls back to the card name for non-storyline choices', () => {
    const plain = makeEvent({ hasChoices: true, name: 'Plain Choice' });
    expect(choiceDialogTitle(plain)).toBe('Plain Choice');
    expect(choiceDialogSubtitle(plain)).toBe('');
  });

  it('the activity log names the storyline via the story update line', () => {
    const state = setupMainStreetGame({ seed: 'agency-log', difficulty: 'Medium' });
    pauseWithStoryline(state, 'evt-flu-outbreak');
    resolveEventChoice(state, 'reject');
    const text = state.activityLog.map((e) => e.text).join('\n');
    expect(text).toContain('Public Health Crisis');
  });
});

// ── AC2: outcome feedback ───────────────────────────────────

describe('AC2 — outcome feedback line', () => {
  it('emits an accept line tied to the storyline title', () => {
    const line = storyUpdateLine(card('evt-tax-error'), 'accept', -200, 0);
    expect(line).toBe('Story update — Tax Troubles: you accepted the consequence (-200 coins).');
  });

  it('emits a reject line that keeps the thread open', () => {
    const line = storyUpdateLine(card('evt-flu-outbreak'), 'reject', 0, 0);
    expect(line).toContain('Public Health Crisis');
    expect(line).toContain('refused');
  });

  it('returns null for cards without a storyline (no update line)', () => {
    expect(storyUpdateLine(makeEvent({ hasChoices: true }), 'accept', -10, 0)).toBeNull();
  });

  it('names a generalised multi-way option label', () => {
    const line = storyUpdateLine(
      makeEvent({ storylineId: 's1', storylineTitle: 'Arc' }),
      'Investigate',
      50,
      0,
    );
    expect(line).toContain('Investigate');
    expect(line).toContain('+50 coins');
  });

  it('the engine writes the story update line to the activity log', () => {
    const state = setupMainStreetGame({ seed: 'agency-engine-log', difficulty: 'Medium' });
    pauseWithStoryline(state, 'evt-tax-error');
    const before = state.activityLog.length;
    resolveEventChoice(state, 'accept');
    const added = state.activityLog.slice(before).map((e) => e.text);
    expect(added.some((t) => t.startsWith('Story update — Tax Troubles:'))).toBe(true);
  });

  it('a non-storyline choice adds no story update line', () => {
    const state = setupMainStreetGame({ seed: 'agency-plain', difficulty: 'Medium' });
    // A synthetic choice card without a storylineId.
    const plain: EventCard = {
      family: 'event', id: 'evt-plain-choice', name: 'Plain Choice', trigger: 'Incident',
      cost: 0, effect: 'Lose 10 coins', target: 'All', coinDelta: -10, reputationDelta: 0,
      hasChoices: true,
    } as EventCard;
    state.phase = 'MarketPhase';
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...plain, id: 'evt-plain-choice-0' });
    processEndOfTurn(state);
    const before = state.activityLog.length;
    resolveEventChoice(state, 'accept');
    const added = state.activityLog.slice(before).map((e) => e.text);
    expect(added.some((t) => t.startsWith('Story update'))).toBe(false);
  });
});

// ── AC3: continuity indicator ───────────────────────────────

describe('AC3 — continuity indicator state', () => {
  it('is empty when no storyline is in play', () => {
    const state = setupMainStreetGame({ seed: 'agency-none', difficulty: 'Medium' });
    state.incidentDeck.length = 0;
    expect(getActiveStorylines(state)).toEqual([]);
    expect(continuityIndicatorLabel(state)).toBeNull();
  });

  it('is active while a storyline choice is pending', () => {
    const state = setupMainStreetGame({ seed: 'agency-pending', difficulty: 'Medium' });
    pauseWithStoryline(state, 'evt-flu-outbreak');
    const active = getActiveStorylines(state);
    expect(active.map((a) => a.storylineId)).toEqual(['storyline-health']);
    expect(active[0].storylineTitle).toBe('Public Health Crisis');
    expect(continuityIndicatorLabel(state)).toContain('Public Health Crisis');
  });

  it('persists when a successor of the same storyline is queued', () => {
    const state = setupMainStreetGame({ seed: 'agency-successor', difficulty: 'Medium' });
    pauseWithStoryline(state, 'evt-flu-outbreak');
    resolveEventChoice(state, 'reject'); // queues evt-pandemic (storyline-health)
    const active = getActiveStorylines(state);
    expect(active.map((a) => a.storylineId)).toEqual(['storyline-health']);
    expect(active[0].cardIds).toContain('evt-pandemic');
  });

  it('clears when the chain ends (no successor of the storyline remains)', () => {
    const state = setupMainStreetGame({ seed: 'agency-clear', difficulty: 'Medium' });
    pauseWithStoryline(state, 'evt-flu-outbreak');
    resolveEventChoice(state, 'accept'); // accept ends the chain (no successor)
    state.incidentDeck.length = 0; // no escalation queued
    expect(getActiveStorylines(state)).toEqual([]);
    expect(continuityIndicatorLabel(state)).toBeNull();
  });

  it('persists through a cycle (the tax chain)', () => {
    const state = setupMainStreetGame({ seed: 'agency-cycle', difficulty: 'Medium' });
    pauseWithStoryline(state, 'evt-tax-inquiry');
    // Inquiry Commission accept → evt-tax-error (same storyline).
    resolveEventChoice(state, 'accept');
    const active = getActiveStorylines(state);
    expect(active.map((a) => a.storylineId)).toContain('storyline-tax');
    expect(active[0].cardIds).toContain('evt-tax-error');
  });

  it('reports multiple concurrent storylines deterministically (sorted by id)', () => {
    const state = setupMainStreetGame({ seed: 'agency-multi', difficulty: 'Medium' });
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...card('evt-flu-outbreak'), id: 'evt-flu-outbreak-0' });
    state.incidentDeck.push({ ...card('evt-recession'), id: 'evt-recession-0' });
    const active = getActiveStorylines(state);
    expect(active.map((a) => a.storylineId)).toEqual(['storyline-economy', 'storyline-health']);
    expect(continuityIndicatorLabel(state)).toContain('Economic Downturn');
    expect(continuityIndicatorLabel(state)).toContain('Public Health Crisis');
  });

  it('summarises more than two active storylines', () => {
    const state = setupMainStreetGame({ seed: 'agency-summary', difficulty: 'Medium' });
    state.incidentDeck.length = 0;
    for (const id of ['evt-flu-outbreak', 'evt-recession', 'evt-strike-service', 'evt-tax']) {
      state.incidentDeck.push({ ...card(id), id: `${id}-0` });
    }
    const label = continuityIndicatorLabel(state)!;
    expect(label).toContain('+2 more');
  });
});

// ── AC4: reduced motion ─────────────────────────────────────

describe('AC4 — reduced-motion-safe presentation', () => {
  it('the continuity helpers are pure and synchronous (no animation dependency)', () => {
    const state = setupMainStreetGame({ seed: 'agency-pure', difficulty: 'Medium' });
    pauseWithStoryline(state, 'evt-flu-outbreak');
    // Calling twice yields identical output and mutates nothing observable.
    const first = continuityIndicatorLabel(state);
    const second = continuityIndicatorLabel(state);
    expect(second).toBe(first);
    // The pending state is untouched by presentation queries.
    expect(state.pendingEventChoice!.resolved).toBe(false);
  });
});

// ── AC5: determinism smoke-check ────────────────────────────

describe('AC5 — determinism preserved', () => {
  it('two identically seeded runs produce the same story-update log', () => {
    const run = (): string[] => {
      const state = setupMainStreetGame({ seed: 'agency-det', difficulty: 'Medium' });
      pauseWithStoryline(state, 'evt-flu-outbreak');
      resolveEventChoice(state, 'reject');
      return state.activityLog.map((e) => e.text);
    };
    expect(run()).toEqual(run());
  });
});
