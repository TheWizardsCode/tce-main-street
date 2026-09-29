/**
 * Staff cost-reduction text / data consistency guard
 * (CG-0MTKMGL66004I0PC, AC4).
 *
 * The integer-economy migration scaled coin *data* ×100, but staff
 * cost-reduction *text* was left on the pre-migration scale (e.g. the
 * Accountant said "refreshes cost 1 less" while its data column was the
 * discount amount). This guard parses every staff cost-reduction description
 * and asserts the stated amount equals the matching `card-data.csv` data
 * column under the ×100 rule, failing with a message that identifies the
 * offending card id.
 *
 * Cards whose ability is description-only (no implementing data column or
 * engine path) are registered explicitly with `column: null` and a note, so a
 * future staff card cannot silently introduce a cost-reduction description
 * without either backing it with data or documenting the gap.
 *
 * @module
 */

import { describe, expect, it } from 'vitest';

import { getCsvRows } from '../../src/MainStreetCards';

interface StaffCostTextContract {
  id: string;
  /** Data column the description must agree with, or null for description-only cards. */
  column: 'refreshCostDiscount' | 'upgradeCostDiscount' | null;
  /** Captures the amount stated in the description. */
  descriptionPattern: RegExp;
  /** The ×100-scale amount the description must state. */
  expectedAmount: number;
  /** Documents why a `column: null` card is not data-backed. */
  note?: string;
}

const UNIMPLEMENTED_NOTE =
  'description-only; effect intentionally not implemented (out of scope)';

const STAFF_COST_TEXT_CONTRACTS: readonly StaffCostTextContract[] = [
  {
    id: 'staff-accountant',
    column: 'refreshCostDiscount',
    descriptionPattern: /refreshes?\s+cost\s+(\d+)\s+less/i,
    expectedAmount: 100,
  },
  {
    id: 'staff-financial',
    column: 'upgradeCostDiscount',
    descriptionPattern: /upgrade\s+cost\s+by\s+(\d+)/i,
    expectedAmount: 100,
  },
  {
    id: 'staff-it',
    column: null,
    descriptionPattern: /refresh\s+cost\s+by\s+(\d+)/i,
    expectedAmount: 100,
    note: UNIMPLEMENTED_NOTE,
  },
  {
    id: 'staff-delivery',
    column: null,
    descriptionPattern: /purchase\s+cost\s+by\s+(\d+)/i,
    expectedAmount: 50,
    note: UNIMPLEMENTED_NOTE,
  },
];

/**
 * Broad detector for a staff cost-reduction phrase that names a *coin* amount
 * (percentages are excluded — they are a different, scale-independent unit).
 * Used to ensure every such phrase is registered above.
 */
const UNREGISTERED_COST_REDUCTION_RE =
  /(?:refresh(?:es)?|upgrade|purchase|business\s+card\s+purchase|ongoing)\s+cost\s+(?:by\s+)?\d+(?!\d)(?!\s*%)/i;

const rows = getCsvRows();
const staffRows = rows.filter(r => r.family === 'staff');

function findStaff(id: string): Record<string, string> | undefined {
  return staffRows.find(r => r.id === id);
}

function describedAmount(
  contract: StaffCostTextContract,
  description: string,
): number | null {
  const match = contract.descriptionPattern.exec(description);
  return match ? Number(match[1]) : null;
}

// ── Contract registry sanity ─────────────────────────────────

describe('staff cost-text guard registry', () => {
  it('covers every registered card id in card-data.csv', () => {
    const missing = STAFF_COST_TEXT_CONTRACTS.filter(c => !findStaff(c.id)).map(c => c.id);
    expect(missing, `Registered staff ids missing from CSV: ${missing.join(', ')}`).toEqual([]);
  });

  it('every cost-reduction description in the CSV is registered (no silent drift)', () => {
    const unregistered: string[] = [];
    for (const row of staffRows) {
      const description = row.description ?? '';
      if (!UNREGISTERED_COST_REDUCTION_RE.test(description)) continue;
      if (!STAFF_COST_TEXT_CONTRACTS.some(c => c.id === row.id)) {
        unregistered.push(`${row.id}: "${description}"`);
      }
    }
    expect(
      unregistered,
      `Staff cost-reduction descriptions without a registered contract:\n${unregistered.join('\n')}`,
    ).toEqual([]);
  });
});

// ── Description ↔ data consistency ───────────────────────────

describe('staff cost-reduction text matches data (×100 rule)', () => {
  for (const contract of STAFF_COST_TEXT_CONTRACTS) {
    it(`${contract.id}: description states ${contract.expectedAmount}`, () => {
      const row = findStaff(contract.id);
      expect(row, `${contract.id} missing from card-data.csv`).toBeDefined();
      if (!row) return;

      const amount = describedAmount(contract, row.description ?? '');
      expect(
        amount,
        `${contract.id}: description "${row.description}" does not state a cost-reduction amount`,
      ).not.toBeNull();
      expect(
        amount,
        `${contract.id}: description says '${amount}' but the ×100 value is ${contract.expectedAmount}`,
      ).toBe(contract.expectedAmount);
    });

    if (contract.column) {
      const column = contract.column;
      it(`${contract.id}: description amount equals ${column} data column`, () => {
        const row = findStaff(contract.id);
        expect(row, `${contract.id} missing from card-data.csv`).toBeDefined();
        if (!row) return;

        const amount = describedAmount(contract, row.description ?? '');
        const dataValue = row[column] ? Number(row[column]) : 0;
        expect(
          dataValue,
          `${contract.id}: description says '${amount}' but ${column} = ${row[column]}`,
        ).toBe(amount);
      });
    }

    if (!contract.column) {
      it(`${contract.id}: is documented as description-only`, () => {
        expect(contract.note, `${contract.id} must document its unimplemented-effect gap`).toBe(
          UNIMPLEMENTED_NOTE,
        );
      });
    }
  }
});
