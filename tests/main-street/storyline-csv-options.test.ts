/**
 * CSV `options` encoding and compilation (MS-0MV8KQJR30007JL5)
 *
 * Locks the arbitrary multi-outcome encoding (`label|cardA,cardB;label2|cardC`)
 * authored via the CSV `options` column and compiled into the generalised
 * `StorylineOption` model with candidate successor sets:
 *
 * AC1 — a choice node declares any number of labelled options via CSV, each
 *       with an ordered candidate successor list (empty list = chain ends).
 * AC3 — the compiled options expose candidate successor ids as `successorIds`;
 *       CSV compilation always emits `effectPolicy: 'apply'` and derives
 *       `hasChoices` from a non-empty option list.
 * AC4 — parsing is deterministic with whitespace trimmed; a non-empty
 *       encoding that decodes to no valid option is rejected, not ignored.
 * AC5 — a tracer storyline row resolves through the new compiled model
 *       (effect applied, option recorded); the random candidate draw lands
 *       in F3.
 *
 * @module
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  loadTemplatesFromCsv,
  resetTemplatesToDefault,
  getEventTemplates,
  getBaseTypeId,
  type EventCard,
} from '../../src/MainStreetCards';
import {
  processEndOfTurn,
  resolveEventOption,
} from '../../src/MainStreetEngine';
import {
  compileStorylineFromEvent,
  eventHasStoryline,
  getStorylineOptions,
  createPendingStorylineChoice,
  parseStorylineOptionsEncoding,
  resetStorylineRegistry,
} from '../../src/MainStreetStoryline';

// ── Fixtures (new-model CSV: legacy choice columns absent) ──

const CSV_COLUMNS = [
  'family', 'id', 'name', 'cost', 'tier', 'trigger', 'effect', 'target',
  'coinDelta', 'reputationDelta', 'storylineId', 'options',
];

interface CsvSpec {
  id: string;
  name: string;
  effect: string;
  coinDelta?: number;
  storylineId?: string;
  options?: string;
}

/** Builds a synthetic CSV whose only choice encoding is the `options` column. */
function buildCsv(events: CsvSpec[]): string {
  const lines = [CSV_COLUMNS.join(',')];
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
      storylineId: e.storylineId ?? '',
      options: e.options ?? '',
    };
    lines.push(
      CSV_COLUMNS.map((c) =>
        c === 'options' && row[c] !== '' ? `"${row[c].replace(/"/g, '""')}"` : row[c],
      ).join(','),
    );
  }
  return lines.join('\n');
}

function eventTemplate(id: string): EventCard {
  const t = getEventTemplates().find((c) => c.id === id);
  if (!t) throw new Error(`Template ${id} missing from fixture CSV`);
  return t as EventCard;
}

/** Directly constructs an off-CSV EventCard (programmatic shape checks). */
function rawEvent(overrides: Partial<EventCard> & { id: string }): EventCard {
  return {
    family: 'event',
    name: 'Raw Event',
    trigger: 'Incident',
    cost: 0,
    effect: 'Lose 40 coins',
    target: 'All',
    coinDelta: -40,
    reputationDelta: 0,
    ...overrides,
  } as EventCard;
}

afterEach(() => {
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

// ── AC1/AC3: CSV options compile to candidate-set options ──

describe('AC1 — CSV `options` column compiles to the candidate-set model', () => {
  const CSV = buildCsv([
    {
      id: 'evt-multi',
      name: 'Multi Outcome',
      effect: 'Lose 100 coins',
      coinDelta: -100,
      storylineId: 'arc-multi',
      options: 'Negotiate|evt-multi-a,evt-multi-b;Walk away|;Escalate|evt-multi-c',
    },
    { id: 'evt-multi-a', name: 'Branch A', effect: 'Lose 10 coins', coinDelta: -10 },
    { id: 'evt-multi-b', name: 'Branch B', effect: 'Lose 20 coins', coinDelta: -20 },
    { id: 'evt-multi-c', name: 'Branch C', effect: 'Lose 30 coins', coinDelta: -30 },
  ]);

  it('compiles an arbitrary ordered option list with candidate successor sets', () => {
    loadTemplatesFromCsv(CSV);
    const compiled = compileStorylineFromEvent(eventTemplate('evt-multi'));

    expect(compiled.compiledOptions.map((o) => o.label)).toEqual([
      'Negotiate',
      'Walk away',
      'Escalate',
    ]);
    expect(compiled.compiledOptions[0].successorIds).toEqual([
      'evt-multi-a',
      'evt-multi-b',
    ]);
    expect(compiled.compiledOptions[2].successorIds).toEqual(['evt-multi-c']);
  });

  it('an empty candidate list is a terminal option (successorIds: [])', () => {
    loadTemplatesFromCsv(CSV);
    const options = getStorylineOptions(eventTemplate('evt-multi'));

    expect(options[1].label).toBe('Walk away');
    expect(options[1].successorIds).toEqual([]);
  });

  it('compilation is deterministic and returns fresh option objects', () => {
    loadTemplatesFromCsv(CSV);
    const first = compileStorylineFromEvent(eventTemplate('evt-multi')).compiledOptions;
    const second = compileStorylineFromEvent(eventTemplate('evt-multi')).compiledOptions;

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first[0]).not.toBe(second[0]);
  });

  it('whitespace around labels, separators and candidate ids is trimmed', () => {
    const padded = rawEvent({
      id: 'evt-padded',
      options: '  Negotiate |  evt-a , evt-b ;  Walk away |  ',
    });

    const options = compileStorylineFromEvent(padded).compiledOptions;
    expect(options.map((o) => o.label)).toEqual(['Negotiate', 'Walk away']);
    expect(options[0].successorIds).toEqual(['evt-a', 'evt-b']);
    expect(options[1].successorIds).toEqual([]);
  });
});

// ── AC3: effectPolicy 'apply' + derived hasChoices ──────────

describe('AC3 — CSV options always compile as "apply" and derive hasChoices', () => {
  it('every CSV-authored option carries effectPolicy "apply"', () => {
    const csv = buildCsv([
      { id: 'evt-apply', name: 'Apply All', effect: 'Lose 50 coins', coinDelta: -50, options: 'One|evt-a;Two|;Three|evt-b' },
      { id: 'evt-a', name: 'A', effect: 'x', coinDelta: 0 },
      { id: 'evt-b', name: 'B', effect: 'x', coinDelta: 0 },
    ]);
    loadTemplatesFromCsv(csv);

    const policies = compileStorylineFromEvent(eventTemplate('evt-apply')).compiledOptions.map(
      (o) => o.effectPolicy,
    );
    expect(policies).toEqual(['apply', 'apply', 'apply']);
  });

  it('hasChoices is derived from a non-empty option list at parse time', () => {
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-derived', name: 'Derived', effect: 'Lose 20 coins', coinDelta: -20, options: 'Go|' },
    ]));

    const card = eventTemplate('evt-derived');
    expect(card.hasChoices).toBe(true);
    expect(eventHasStoryline(card)).toBe(true);
  });

  it('a blank options cell is a non-choice node (no options, no hasChoices)', () => {
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-plain', name: 'Plain', effect: 'Lose 20 coins', coinDelta: -20 },
    ]));

    const card = eventTemplate('evt-plain');
    expect(card.options).toBeUndefined();
    expect(Boolean(card.hasChoices)).toBe(false);
    expect(compileStorylineFromEvent(card).compiledOptions).toEqual([]);
    expect(eventHasStoryline(card)).toBe(false);
    expect(createPendingStorylineChoice(card)).toBeNull();
  });

  it('a whitespace-only options cell is treated as blank (non-choice)', () => {
    const card = rawEvent({ id: 'evt-spaces', options: '   ' });
    expect(eventHasStoryline(card)).toBe(false);
    expect(compileStorylineFromEvent(card).compiledOptions).toEqual([]);
  });
});

// ── AC4: deterministic parsing; invalid encodings rejected ──

describe('AC4 — malformed or empty-decoding options encodings are rejected', () => {
  it('a non-empty encoding that decodes to no valid option throws', () => {
    expect(() => parseStorylineOptionsEncoding(';;')).toThrow(/no valid option/);
    expect(() => compileStorylineFromEvent(rawEvent({ id: 'evt-empty-enc', options: ' ; ; ' }))).toThrow(
      /no valid option/,
    );
  });

  it('an option segment missing the label/successor separator is rejected', () => {
    expect(() => parseStorylineOptionsEncoding('Negotiate;Go|evt-a')).toThrow(
      /missing the "\|" separator/,
    );
  });

  it('an empty label is rejected', () => {
    expect(() => parseStorylineOptionsEncoding('|evt-a')).toThrow(/empty label/);
    expect(() => parseStorylineOptionsEncoding('Good|evt-a;|evt-b')).toThrow(/empty label/);
  });

  it('blank encodings decode to an empty option list (non-choice)', () => {
    expect(parseStorylineOptionsEncoding('')).toEqual([]);
    expect(parseStorylineOptionsEncoding('  \n  ')).toEqual([]);
  });

  it('a malformed row in a loaded CSV is rejected at compilation', () => {
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-bad', name: 'Bad', effect: 'Lose 10 coins', coinDelta: -10, options: 'NoPipeHere' },
    ]));
    expect(() => getStorylineOptions(eventTemplate('evt-bad'))).toThrow(/separator/);
  });
});

// ── AC5: a tracer storyline row resolves through the new model ──

describe('AC5 — tracer storyline row (evt-recession) resolves through the compiled model', () => {
  const TRACER_CSV = buildCsv([
    {
      id: 'evt-recession',
      name: 'Economic Recession',
      effect: 'Lose 80 coins',
      coinDelta: -80,
      storylineId: 'storyline-economy',
      options: 'Grind through|evt-depression;Cut spending|',
    },
    {
      id: 'evt-depression',
      name: 'Depression',
      effect: 'Lose 120 coins',
      coinDelta: -120,
      storylineId: 'storyline-economy',
    },
  ]);

  function tracerState(seed: string): MainStreetState {
    const state = setupMainStreetGame({ seed, difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    const t = eventTemplate('evt-recession');
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...t, id: 'evt-recession-0' });
    return state;
  }

  it('the migrated row compiles to two candidate-set options and defers as a choice', () => {
    loadTemplatesFromCsv(TRACER_CSV);
    const card = eventTemplate('evt-recession');

    expect(card.hasChoices).toBe(true);
    expect(card.options).toContain('Grind through|evt-depression');
    expect(compileStorylineFromEvent(card).compiledOptions[0].successorIds).toEqual([
      'evt-depression',
    ]);
    expect(compileStorylineFromEvent(card).compiledOptions[1].successorIds).toEqual([]);
    expect(createPendingStorylineChoice(card)).not.toBeNull();

    const state = tracerState('tracer-defer');
    const result = processEndOfTurn(state);
    expect(result.choicePending).toBe(true);
    expect(state.pendingEventChoice).not.toBeNull();
    expect(state.pendingEventChoice!.options?.map((o) => o.successorIds)).toEqual([
      ['evt-depression'],
      [],
    ]);
  });

  it('resolving an option applies the effect and records the chosen label', () => {
    loadTemplatesFromCsv(TRACER_CSV);
    const state = tracerState('tracer-resolve');
    processEndOfTurn(state);
    const coinsBefore = state.resourceBank.coins;

    const res = resolveEventOption(state, 0);

    expect(res.option).toBe('Grind through');
    expect(res.coinChange).toBe(-80);
    expect(state.resourceBank.coins).toBe(coinsBefore - 80);
    expect(state.pendingEventChoice!.resolved).toBe(true);
    expect(state.pendingEventChoice!.chosenOption).toBe('Grind through');
    // F3 landed the uniform random draw: the single-candidate set
    // ['evt-depression'] resolves to exactly that candidate (drawn once from
    // the seeded state.rng()).
    expect(res.pushedCard).not.toBeNull();
    expect(getBaseTypeId(res.pushedCard!.id)).toBe('evt-depression');
  });
});
