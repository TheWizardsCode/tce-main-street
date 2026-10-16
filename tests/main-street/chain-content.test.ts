/**
 * Content: Story-chain card wiring in the shipped CSV (CG-0MTT7FC7A000AA58 /
 * parent CG-0MTSHG8RP008E128)
 *
 * Verifies the chain-card content the producer approved 2026-09-09, migrated
 * to the arbitrary multi-outcome `options` model (MS-0MV8KQJR30007JL5 /
 * MS-0MV8KQQQ90044CM5):
 *   Chain 1 Tax Escalation (3-step cycle):  evt-tax-error -> evt-tax -> evt-tax-inquiry (accept resets to evt-tax-error)
 *   Chain 2 Labor Unrest (2-step no reset): evt-strike-service -> evt-general-strike (terminal)
 *   Chain 3 Restaurant Opportunity (2-step):evt-popular-menu -> evt-farm-table (terminal)
 *   Chain 4 Economic Downturn (2-step):     evt-recession -> evt-depression (terminal)
 *   Health escalation (AC5 example):        evt-flu-outbreak -> evt-pandemic (terminal)
 *
 * Semantics per the migrated model (F6, producer Q4=B): every CSV-authored
 * option carries `effectPolicy: 'apply'`, so both Accept and Reject apply the
 * event effect; the option's candidate successor is then drawn. An empty
 * candidate list is a terminal option (the chain ends).
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import {
  type EventCard,
  isDurationEventCard,
  getEventTemplates,
} from '../../src/MainStreetCards';
import { getStorylineOptions } from '../../src/MainStreetStoryline';

type Card = EventCard & { id: string };

function template(id: string): Card {
  const t = getEventTemplates().find((c) => c.id === id) as Card | undefined;
  if (!t) throw new Error(`Template ${id} missing from shipped CSV`);
  return t;
}

/** Candidate successor ids for a labelled option of a card (empty = terminal). */
function targets(id: string, label: string): string[] {
  const t = template(id);
  return [...(getStorylineOptions(t).find((o) => o.label === label)?.successorIds ?? [])];
}

/** Asserts a choice card's option list matches the two-way Accept/Reject shape. */
function expectTwoWay(id: string, accept: string | null, reject: string | null): void {
  const c = template(id);
  expect(c.hasChoices).toBe(true);
  const options = getStorylineOptions(c);
  expect(options.map((o) => o.label)).toEqual(['Accept', 'Reject']);
  expect(options.every((o) => o.effectPolicy === 'apply')).toBe(true);
  expect(targets(id, 'Accept')).toEqual(accept === null ? [] : [accept]);
  expect(targets(id, 'Reject')).toEqual(reject === null ? [] : [reject]);
}

function allIdsResolve(ids: string[]): void {
  const known = new Set(getEventTemplates().map((c) => c.id));
  for (const id of ids) {
    expect(known.has(id), `chain link ${id} not in CSV`).toBe(true);
  }
}

describe('Chain 1: Tax Escalation (3-step cycle, resets)', () => {
  it('Error in Tax Return: accept ends, reject -> Tax Audit', () => {
    expectTwoWay('evt-tax-error', null, 'evt-tax');
    expect(template('evt-tax-error').coinDelta).toBeLessThan(0); // negative event
  });

  it('Tax Audit (retrofitted): accept ends, reject -> Inquiry Commission', () => {
    expectTwoWay('evt-tax', null, 'evt-tax-inquiry');
  });

  it('Inquiry Commission: accept -> Error in Tax Return (cycle), reject ends', () => {
    expectTwoWay('evt-tax-inquiry', 'evt-tax-error', null);
    expect(template('evt-tax-inquiry').coinDelta).toBeLessThan(0);
    expect(template('evt-tax-inquiry').reputationDelta).toBeLessThan(0);
  });

  it('severity escalates along the chain (2 -> 3 -> 6 coins)', () => {
    expect(template('evt-tax-error').coinDelta).toBeGreaterThan(template('evt-tax').coinDelta);
    expect(template('evt-tax').coinDelta).toBeGreaterThan(template('evt-tax-inquiry').coinDelta);
  });
});

describe('Chain 2: Labor Unrest (2-step, no reset)', () => {
  it('Service Workers Strike: accept ends, reject -> General Strike', () => {
    expectTwoWay('evt-strike-service', null, 'evt-general-strike');
    expect(template('evt-strike-service').coinDelta).toBeLessThan(0);
  });

  it('General Strike is a terminal plain incident (chain ends when drawn)', () => {
    const c = template('evt-general-strike');
    expect(Boolean(c.hasChoices)).toBe(false);
    expect(c.coinDelta).toBeLessThan(0);
  });
});

describe('Chain 3: Restaurant Opportunity (2-step, no reset, positive)', () => {
  it('Popular Menu Item: accept ends, reject -> Farm-to-Table Feature', () => {
    expectTwoWay('evt-popular-menu', null, 'evt-farm-table');
    expect(template('evt-popular-menu').coinDelta).toBeGreaterThan(0); // positive event
  });

  it('Farm-to-Table Feature is a terminal plain positive incident (better card)', () => {
    const c = template('evt-farm-table');
    expect(Boolean(c.hasChoices)).toBe(false);
    expect(c.coinDelta).toBeGreaterThan(0);
    expect(c.reputationDelta).toBeGreaterThan(0);
    // The rejected escalation is strictly better than the original.
    expect(c.coinDelta + c.reputationDelta).toBeGreaterThan(
      template('evt-popular-menu').coinDelta + template('evt-popular-menu').reputationDelta,
    );
  });
});

describe('Chain 4: Economic Downturn (2-step, no reset, duration)', () => {
  it('Economic Recession (retrofitted duration): accept ends, reject -> Depression', () => {
    expect(isDurationEventCard(template('evt-recession'))).toBe(true);
    // The shipped fan-out: Reject leads to depression OR a general strike.
    expect(template('evt-recession').hasChoices).toBe(true);
    expect(getStorylineOptions(template('evt-recession')).map((o) => o.label)).toEqual(['Accept', 'Reject']);
    const reject = getStorylineOptions(template('evt-recession')).find((o) => o.label === 'Reject')!;
    expect(reject.successorIds).toEqual(['evt-depression', 'evt-general-strike']);
  });

  it('Depression is a terminal duration card, strictly worse than the recession', () => {
    const c = template('evt-depression');
    expect(isDurationEventCard(c)).toBe(true);
    expect(Boolean(c.hasChoices)).toBe(false);
    const recession = template('evt-recession');
    // Lower income multiplier + longer duration = worse for the player.
    expect((c as unknown as { multiplier: number }).multiplier).toBeLessThan(
      (recession as unknown as { multiplier: number }).multiplier,
    );
    expect((c as unknown as { duration: number }).duration).toBeGreaterThan(
      (recession as unknown as { duration: number }).duration,
    );
  });
});

describe('Health escalation (AC5 example: Flu Outbreak -> Pandemic)', () => {
  it('Flu Outbreak (retrofitted duration): accept ends, reject -> Pandemic', () => {
    expect(isDurationEventCard(template('evt-flu-outbreak'))).toBe(true);
    expectTwoWay('evt-flu-outbreak', null, 'evt-pandemic');
  });

  it('Pandemic is a terminal duration card, worse than the flu', () => {
    const c = template('evt-pandemic');
    expect(isDurationEventCard(c)).toBe(true);
    expect(Boolean(c.hasChoices)).toBe(false);
    const flu = template('evt-flu-outbreak');
    expect((c as unknown as { multiplier: number }).multiplier).toBeLessThan(
      (flu as unknown as { multiplier: number }).multiplier,
    );
  });
});

describe('Cross-chain integrity (AC4 data model / AC6 non-chain unchanged)', () => {
  it('every option candidate resolves to a shipped template', () => {
    const all = [
      evtTargets('evt-tax-error'),
      evtTargets('evt-tax'),
      evtTargets('evt-tax-inquiry'),
      evtTargets('evt-strike-service'),
      evtTargets('evt-popular-menu'),
      evtTargets('evt-recession'),
      evtTargets('evt-flu-outbreak'),
    ].flat();
    allIdsResolve(all);
  });

  it('non-chain one-off incidents were not retrofitted (AC6)', () => {
    for (const id of [
      'evt-festival', 'evt-rainy', 'evt-award', 'evt-food-critic', 'evt-construction',
      'evt-viral-review', 'evt-vandalism', 'evt-strike', 'evt-heatwave', 'evt-protest',
    ]) {
      const c = template(id);
      expect(Boolean(c.hasChoices), `${id} must stay a plain incident`).toBe(false);
    }
  });

  it('all newly shipped choice cards are exactly the designed set', () => {
    const choiceIds = getEventTemplates()
      .filter((c) => c.family === 'event' && Boolean(c.hasChoices))
      .map((c) => c.id)
      .sort();
    expect(choiceIds).toEqual(
      [
        'evt-tax', 'evt-tax-error', 'evt-tax-inquiry',
        'evt-strike-service',
        'evt-popular-menu',
        'evt-recession',
        'evt-flu-outbreak',
      ].sort(),
    );
  });
});

/** All candidate successor ids across every option of a shipped card. */
function evtTargets(id: string): string[] {
  return getStorylineOptions(template(id)).flatMap((o) => o.successorIds ?? []);
}
