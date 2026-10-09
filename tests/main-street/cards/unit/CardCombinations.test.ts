/**
 * Main Street: Staff combination tests (Node/Vitest).
 *
 * Runs up to three cross-card combination checks for each staff card,
 * covering discount stacking, per-business vs street-wide scoping, and
 * staff/upgrade interaction (AC3 of the unit framework child).
 *
 * @module
 */

import { describe, expect, it } from 'vitest';

import type { StaffCard } from '../../../../src/MainStreetCards';
import { createDefaultRegistry } from '../CardTestRegistry';
import { resolveCardTemplate } from '../helpers/cardFixture';
import { STAFF_COMBINATIONS, combinationsFor } from '../definitions/combinations';

const registry = createDefaultRegistry();
const staffRows = registry.discoverCards().filter(card => card.family === 'staff');
const staffCards = staffRows.map(
  row => resolveCardTemplate(row.id, 'staff') as StaffCard,
);

describe('Main Street staff combination definitions', () => {
  it('covers every required combination category', () => {
    const ids = STAFF_COMBINATIONS.map(combination => combination.id);
    for (const required of [
      'purchase-discount-stacking',
      'refresh-discount-stacking',
      'per-business-scoping',
      'upgrade-interaction',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('assigns at most three combinations per staff card', () => {
    for (const staff of staffCards) {
      expect(combinationsFor(staff).length).toBeLessThanOrEqual(3);
    }
  });

  for (const staff of staffCards) {
    const combinations = combinationsFor(staff);
    for (const combination of combinations) {
      it(`${staff.id} — ${combination.title}`, () => {
        combination.run(staff);
      });
    }
  }
});
