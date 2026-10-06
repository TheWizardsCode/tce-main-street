/**
 * Storyline journal & choice clarity (MS-0MUMP97LQ006PP1D)
 *
 * AC1 — Journal data: past storyline choices and outcomes, most recent first.
 * AC2 — Empty state: journal is empty before any choice is made.
 * AC3 — Choice clarity: option labels explain apply vs skip semantics and do
 *       NOT reveal the escalation card id.
 * AC4 — Depth/interaction is enforced by the overlay implementation (browser
 *       test); the pure helpers here keep the data layer honest.
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
  parseStoryUpdate,
  buildJournal,
  journalIsEmpty,
  choiceClarityLabels,
  journalTitle,
  STORY_UPDATE_PREFIX,
} from '../../src/MainStreetStorylineJournal';
import { resetStorylineRegistry } from '../../src/MainStreetStoryline';

function card(id: string): EventCard {
  const t = getEventTemplates().find((c) => c.id === id);
  if (!t) throw new Error(`template ${id} missing`);
  return t as EventCard;
}

function pauseWithStoryline(state: MainStreetState, templateId: string): void {
  const t = card(templateId);
  state.phase = 'MarketPhase';
  state.incidentDeck.length = 0;
  state.incidentDeck.push({ ...t, id: `${t.id}-0` });
  processEndOfTurn(state);
}

afterEach(() => {
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

// ── parseStoryUpdate ────────────────────────────────────────

describe('parseStoryUpdate', () => {
  it('parses a well-formed story update line', () => {
    const parsed = parseStoryUpdate('Story update — Tax Troubles: you accepted the consequence (-200 coins).');
    expect(parsed).toEqual({
      storyline: 'Tax Troubles',
      outcome: 'you accepted the consequence (-200 coins).',
    });
  });

  it('returns null for non-story lines', () => {
    expect(parseStoryUpdate('Incident: Rainy Day (-100 coins)')).toBeNull();
    expect(parseStoryUpdate('')).toBeNull();
  });

  it('returns null for a malformed update (missing separator)', () => {
    expect(parseStoryUpdate(`${STORY_UPDATE_PREFIX}Tax Troubles without separator`)).toBeNull();
  });
});

// ── AC1: journal rows ───────────────────────────────────────

describe('AC1 — buildJournal lists past choices, most recent first', () => {
  it('collects story updates from the activity log in reverse order', () => {
    const state = setupMainStreetGame({ seed: 'journal-order', difficulty: 'Medium' });
    pauseWithStoryline(state, 'evt-flu-outbreak');
    resolveEventChoice(state, 'reject'); // Public Health Crisis
    pauseWithStoryline(state, 'evt-tax-error');
    resolveEventChoice(state, 'accept'); // Tax Troubles

    const journal = buildJournal(state);
    expect(journal.length).toBeGreaterThanOrEqual(2);
    // Most recent first → Tax Troubles precedes Public Health Crisis.
    const taxIndex = journal.findIndex((e) => e.storyline === 'Tax Troubles');
    const healthIndex = journal.findIndex((e) => e.storyline === 'Public Health Crisis');
    expect(taxIndex).toBeGreaterThanOrEqual(0);
    expect(healthIndex).toBeGreaterThanOrEqual(0);
    expect(taxIndex).toBeLessThan(healthIndex);
  });

  it('the entry records the turn and outcome text', () => {
    const state = setupMainStreetGame({ seed: 'journal-fields', difficulty: 'Medium' });
    pauseWithStoryline(state, 'evt-tax-error');
    const turn = state.turn;
    resolveEventChoice(state, 'accept');
    const entry = buildJournal(state)[0]!;
    expect(entry.storyline).toBe('Tax Troubles');
    expect(entry.turn).toBe(turn);
    expect(entry.outcome).toContain('accepted');
  });

  it('ignores non-story log lines', () => {
    const state = setupMainStreetGame({ seed: 'journal-ignore', difficulty: 'Medium' });
    state.activityLog.push({ turn: 1, text: 'Incident: Rainy Day (-100 coins)', type: 'loss' });
    expect(buildJournal(state).some((e) => e.text.includes('Rainy Day'))).toBe(false);
  });
});

// ── AC2: empty state ────────────────────────────────────────

describe('AC2 — empty state', () => {
  it('the journal is empty before any choice is made', () => {
    const state = setupMainStreetGame({ seed: 'journal-empty', difficulty: 'Medium' });
    state.activityLog.length = 0;
    expect(journalIsEmpty(state)).toBe(true);
    expect(buildJournal(state)).toEqual([]);
    expect(journalTitle(state)).toBe('Storyline Journal');
  });

  it('the journal is not empty after a storyline choice resolves', () => {
    const state = setupMainStreetGame({ seed: 'journal-nonempty', difficulty: 'Medium' });
    pauseWithStoryline(state, 'evt-flu-outbreak');
    resolveEventChoice(state, 'reject');
    expect(journalIsEmpty(state)).toBe(false);
  });
});

// ── AC3: choice clarity ─────────────────────────────────────

describe('AC3 — choice clarity labels', () => {
  it('explains apply semantics for Accept', () => {
    const labels = choiceClarityLabels(card('evt-tax-error'));
    expect(labels.accept).toContain('apply');
    expect(labels.accept).toContain(card('evt-tax-error').effect);
  });

  it('explains skip semantics for Reject', () => {
    const labels = choiceClarityLabels(card('evt-tax-error'));
    expect(labels.reject.toLowerCase()).toContain('refuse');
    expect(labels.reject.toLowerCase()).toContain('different incident');
  });

  it('does NOT reveal the escalation card id or name (both paths)', () => {
    for (const id of ['evt-tax-error', 'evt-strike-service', 'evt-popular-menu', 'evt-flu-outbreak']) {
      const c = card(id);
      const labels = choiceClarityLabels(c);
      const revealed = `${labels.accept} ${labels.reject}`;
      if (c.acceptNextCardId) expect(revealed).not.toContain(c.acceptNextCardId);
      if (c.rejectNextCardId) {
        expect(revealed).not.toContain(c.rejectNextCardId);
        const successor = getEventTemplates().find((t) => t.id === c.rejectNextCardId);
        if (successor) expect(revealed).not.toContain(successor.name);
      }
    }
  });

  it('falls back gracefully for a generalised multi-way card', () => {
    const event: EventCard = {
      family: 'event', id: 'evt-multi', name: 'Multi', trigger: 'Incident', cost: 0,
      effect: 'x', target: 'All', coinDelta: -10, reputationDelta: 0, hasChoices: true,
    } as EventCard;
    const labels = choiceClarityLabels(event);
    expect(labels.accept.length).toBeGreaterThan(0);
    expect(labels.reject.length).toBeGreaterThan(0);
  });
});

// ── journalTitle ────────────────────────────────────────────

describe('journalTitle names the storylines seen', () => {
  it('lists distinct storyline names', () => {
    const state = setupMainStreetGame({ seed: 'journal-title', difficulty: 'Medium' });
    pauseWithStoryline(state, 'evt-flu-outbreak');
    resolveEventChoice(state, 'reject');
    pauseWithStoryline(state, 'evt-flu-outbreak');
    resolveEventChoice(state, 'accept');
    const title = journalTitle(state);
    expect(title).toContain('Storyline Journal');
    expect(title).toContain('Public Health Crisis');
    // Distinct names only (no duplicate).
    expect(title.split('Public Health Crisis').length - 1).toBe(1);
  });
});
