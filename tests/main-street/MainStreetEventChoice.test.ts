/**
 * Event Choice Data Model — options-only contract
 * (CG-0MTT7DUJE002HPPM / parent CG-0MTSHG8RP008E128; migrated by
 * MS-0MVZNR9U70068PL3)
 *
 * The runtime model has one choice encoding: the `options` column on an
 * `EventCard` (a CSV-authored option list) or an explicitly registered option
 * list. This suite pins that contract at the data-model layer:
 *
 * - a card with a non-empty `options` encoding compiles to an ordered option
 *   list; a blank / absent encoding is not a choice;
 * - a bare `storylineId` is descriptive metadata and never makes a card a
 *   choice;
 * - terminal options (`label|`) compile to an empty candidate set;
 * - multi-candidate options compile to their candidate successor set;
 * - `DurationEventCard` inherits the same model;
 * - CSV parsing populates `options` and ignores unknown columns, so legacy
 *   columns left in a row cannot resurrect the removed two-way model;
 * - the shipped CSV's seven designed chain cards are the only choice events.
 *
 * @module
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  type EventCard,
  type DurationEventCard,
  isDurationEventCard,
  getEventTemplates,
  loadTemplatesFromCsv,
  resetTemplatesToDefault,
} from '../../src/MainStreetCards';
import {
  compileStorylineFromEvent,
  eventHasStoryline,
  getStorylineOptions,
  resetStorylineRegistry,
} from '../../src/MainStreetStoryline';

// ── Factories ───────────────────────────────────────────────

function makeEventCard(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event' as const,
    id: overrides.id ?? 'evt-test',
    name: overrides.name ?? 'Test Event',
    trigger: overrides.trigger ?? 'Incident',
    cost: 0,
    effect: 'test effect',
    target: 'All',
    coinDelta: 0,
    reputationDelta: 0,
    ...overrides,
  };
}

function makeDurationEventCard(overrides: Partial<DurationEventCard> = {}): DurationEventCard {
  return {
    family: 'event' as const,
    id: overrides.id ?? 'evt-duration-test',
    name: overrides.name ?? 'Duration Test Event',
    trigger: overrides.trigger ?? 'Incident',
    cost: 100,
    effect: 'test duration effect',
    target: 'All',
    coinDelta: 0,
    reputationDelta: 0,
    duration: 5,
    effectType: 'income-multiplier',
    multiplier: 0.8,
    ...overrides,
  };
}

/** Labels + candidate sets of a card's compiled options. */
function shape(event: EventCard): Array<[string, string[]]> {
  return getStorylineOptions(event).map((option) => [
    option.label,
    [...(option.successorIds ?? [])],
  ]);
}

afterEach(() => {
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

// ── Options-only choice model ───────────────────────────────

describe('EventCard choice model — the options encoding is the only choice', () => {
  it('a card without options is not a choice', () => {
    const card = makeEventCard();
    expect(eventHasStoryline(card)).toBe(false);
    expect(compileStorylineFromEvent(card).compiledOptions).toEqual([]);
    expect(shape(card)).toEqual([]);
  });

  it('a card with a CSV options encoding is a choice with an ordered option list', () => {
    const card = makeEventCard({ options: 'Accept|evt-next;Reject|evt-later' });
    expect(eventHasStoryline(card)).toBe(true);
    expect(shape(card)).toEqual([
      ['Accept', ['evt-next']],
      ['Reject', ['evt-later']],
    ]);
  });

  it('a blank options encoding is not a choice', () => {
    const card = makeEventCard({ options: '   ' });
    expect(eventHasStoryline(card)).toBe(false);
    expect(shape(card)).toEqual([]);
  });

  it('a bare storylineId does not make a card a choice', () => {
    const card = makeEventCard({ storylineId: 'storyline-economy' });
    expect(eventHasStoryline(card)).toBe(false);
    expect(shape(card)).toEqual([]);
  });

  it('an empty candidate list is a terminal option', () => {
    const card = makeEventCard({ options: 'Accept|;Reject|evt-worse' });
    expect(shape(card)).toEqual([
      ['Accept', []],
      ['Reject', ['evt-worse']],
    ]);
  });

  it('a comma-separated candidate list compiles to a candidate successor set', () => {
    const card = makeEventCard({ options: 'Fight|evt-a,evt-b;Flee|evt-c' });
    expect(shape(card)).toEqual([
      ['Fight', ['evt-a', 'evt-b']],
      ['Flee', ['evt-c']],
    ]);
  });

  it('CSV-authored options always apply the event effect', () => {
    const card = makeEventCard({ options: 'Accept|;Reject|' });
    expect(getStorylineOptions(card).map((option) => option.effectPolicy)).toEqual([
      'apply',
      'apply',
    ]);
  });

  it('a malformed options encoding is rejected at compilation, not silently ignored', () => {
    const card = makeEventCard({ options: 'Accept' }); // no '|' separator
    expect(() => compileStorylineFromEvent(card)).toThrow(/missing the "\|" separator/);
  });
});

// ── DurationEventCard inherits ─────────────────────────────

describe('DurationEventCard inherits the options model', () => {
  it('DurationEventCard can carry an options encoding and compiles it', () => {
    const card = makeDurationEventCard({ options: 'Accept|;Reject|evt-recession-worse' });
    expect(isDurationEventCard(card)).toBe(true);
    expect(shape(card)).toEqual([
      ['Accept', []],
      ['Reject', ['evt-recession-worse']],
    ]);
  });

  it('DurationEventCard without options is not a choice', () => {
    const card = makeDurationEventCard();
    expect(eventHasStoryline(card)).toBe(false);
    expect(shape(card)).toEqual([]);
  });
});

// ── CSV parsing ─────────────────────────────────────────────

describe('CSV parsing: the options column', () => {
  const csvWithChoices = [
    'family,id,name,cost,tier,trigger,effect,target,coinDelta,reputationDelta,duration,effectType,multiplier,storylineId,options',
    'event,evt-choice-yes,Choice Yes,0,1,Incident,Test incident,All,-300,0,,,,,"Accept|evt-next-accept;Reject|evt-next-reject"',
    'event,evt-plain,Plain Event,0,1,Incident,Plain incident,All,-100,0,,,,,',
    'event,evt-duration-choice,Duration Choice,100,1,Incident,Duration incident,All,0,0,5,income-multiplier,0.8,,"Accept|;Reject|evt-depression"',
    'event,evt-accept-only,Accept Only,0,1,Incident,Accept only,All,-300,0,,,,,"Accept|evt-next"',
  ].join('\n');

  it('parses a choice event with both option labels and successors', () => {
    loadTemplatesFromCsv(csvWithChoices);
    const t = getEventTemplates().find((c) => c.id === 'evt-choice-yes') as EventCard;
    expect(t).toBeDefined();
    expect(t.options).toBe('Accept|evt-next-accept;Reject|evt-next-reject');
    expect(shape(t)).toEqual([
      ['Accept', ['evt-next-accept']],
      ['Reject', ['evt-next-reject']],
    ]);
  });

  it('an event with a blank options cell carries no options and is not a choice', () => {
    loadTemplatesFromCsv(csvWithChoices);
    const t = getEventTemplates().find((c) => c.id === 'evt-plain') as EventCard;
    expect(t).toBeDefined();
    expect(t.options).toBeUndefined();
    expect(eventHasStoryline(t)).toBe(false);
  });

  it('a DurationEventCard from CSV carries its options encoding', () => {
    loadTemplatesFromCsv(csvWithChoices);
    const t = getEventTemplates().find((c) => c.id === 'evt-duration-choice') as EventCard;
    expect(t).toBeDefined();
    expect(isDurationEventCard(t)).toBe(true);
    expect(t.options).toBe('Accept|;Reject|evt-depression');
    expect(shape(t)).toEqual([
      ['Accept', []],
      ['Reject', ['evt-depression']],
    ]);
  });

  it('a single-option encoding parses to one option (terminal)', () => {
    loadTemplatesFromCsv(csvWithChoices);
    const t = getEventTemplates().find((c) => c.id === 'evt-accept-only') as EventCard;
    expect(t).toBeDefined();
    expect(shape(t)).toEqual([['Accept', ['evt-next']]]);
  });

  it('the shipped CSV makes exactly the designed chain cards choices', () => {
    const choiceIds = [
      'evt-tax-error', 'evt-tax', 'evt-tax-inquiry',
      'evt-strike-service',
      'evt-popular-menu',
      'evt-recession',
      'evt-flu-outbreak',
    ];
    for (const c of getEventTemplates()) {
      expect(shape(c).length > 0, `${c.id} choice-ness`).toBe(choiceIds.includes(c.id));
    }
  });
});
