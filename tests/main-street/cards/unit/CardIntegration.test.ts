/**
 * Main Street: Card integration definitions (Node/Vitest).
 *
 * Runs the explicit per-card definition for every card discovered in
 * `src/card-data.csv` against real engine play states and turn progressions,
 * then records the pass/fail outcome (with a failure note) back into
 * `src/card-data.csv` via the result writer.
 *
 * @module
 */

import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { CardTestResult } from '../CardTestTypes';
import { createDefaultRegistry } from '../CardTestRegistry';
import { writeCardTestResults } from '../CardTestResultWriter';

const CSV_PATH = resolve(process.cwd(), 'src/card-data.csv');

const registry = createDefaultRegistry();
const cards = registry.discoverCards();
const results: CardTestResult[] = [];

describe('Main Street card integration definitions', () => {
  it('discovers every card in card-data.csv', () => {
    // 175 cards: 31 business, 8 community-space, 39 upgrade, 26 staff, 71 event.
    expect(cards.length).toBe(175);
    const families = cards.reduce<Record<string, number>>((acc, card) => {
      acc[card.family] = (acc[card.family] ?? 0) + 1;
      return acc;
    }, {});
    expect(families.business).toBe(31);
    expect(families['community-space']).toBe(8);
    expect(families.upgrade).toBe(39);
    expect(families.staff).toBe(26);
    expect(families.event).toBe(71);
  });

  it('has an explicit definition for every discovered card', () => {
    expect(registry.missingDefinitions(cards)).toEqual([]);
  });

  for (const card of cards) {
    it(`${card.family}: ${card.id} (${card.name})`, () => {
      const result = registry.runCard(card);
      results.push(result);
      if (result.status === 'fail') {
        throw new Error(result.failReason);
      }
    });
  }
});

// Write the results back into the CSV once, after all card definitions have
// run. `applyResultsToCsv` is idempotent, so re-running with unchanged
// outcomes produces no diff.
afterAll(() => {
  writeCardTestResults(CSV_PATH, results);
});
