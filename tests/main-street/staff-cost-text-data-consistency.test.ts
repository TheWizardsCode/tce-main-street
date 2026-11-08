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
 * The two-type redesign (MS-0MW3JXF6U00753LB) removed the IT Specialist's and
 * Delivery Driver's street-wide cost discounts, so those contracts are gone:
 * the IT Specialist now grants +1 synergy range and the Delivery Driver
 * discounts adjacent placements (`staffAdjacentPurchaseDiscount`).
 *
 * @module
 */

import { describe, expect, it } from 'vitest';

import { getCsvRows } from '../../src/MainStreetCards';

interface StaffCostTextContract {
  id: string;
  /**
   * Data source the description must agree with: a numeric CSV column, the
   * machine-readable `effect` spec column, or null for description-only cards.
   */
  column: 'refreshCostDiscount' | 'upgradeCostDiscount' | 'purchaseCostDiscount' | 'effect' | null;
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
    id: 'staff-bookkeeper',
    column: 'effect',
    descriptionPattern: /ongoing\s+cost\s+by\s+(\d+)%/i,
    expectedAmount: 20,
  },
  // The IT Specialist and the Delivery Driver no longer advertise a
  // street-wide cost reduction: the two-type redesign moves the IT Specialist
  // to +1 synergy range and the Delivery Driver to a placement-scoped
  // adjacency discount (MS-0MW3JXF6U00753LB), so neither has a cost-text
  // contract any more.
];

/**
 * Broad detector for a staff cost-reduction phrase that names a *coin* amount
 * (percentages are excluded — they are a different, scale-independent unit).
 * Used to ensure every such phrase is registered above.
 */
const UNREGISTERED_COST_REDUCTION_RE =
  /(?:refresh(?:es)?|upgrade|purchase|business\s+card\s+purchase)\s+cost\s+(?:by\s+)?\d+(?!\d)(?!\s*%)/i;

/**
 * Detector for percentage-based staff cost-reduction descriptions.
 * Catches patterns like "ongoing cost by 20%" that the coin-amount
 * detector (UNREGISTERED_COST_REDUCTION_RE) deliberately excludes.
 */
const UNREGISTERED_PERCENTAGE_COST_REDUCTION_RE =
  /(?:ongoing)\s+cost\s+by\s+(\d+)%/i;

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

/**
 * The amount carried by a contract's backing data source. Numeric columns map
 * straight through; the `effect` column's `ongoing-cost:percent:<n>` dimension
 * yields `<n>`. Returns null when the backing data is absent or unparseable, so
 * a description with no data fails loudly.
 */
function backingAmount(
  contract: StaffCostTextContract,
  row: Record<string, string>,
): number | null {
  if (!contract.column) return null;
  if (contract.column === 'effect') {
    const match = /ongoing-cost:percent:(\d+)/.exec(row.effect ?? '');
    return match ? Number(match[1]) : null;
  }
  const raw = row[contract.column];
  return raw ? Number(raw) : 0;
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
    // Also check percentage-based cost reductions
    for (const row of staffRows) {
      const description = row.description ?? '';
      if (!UNREGISTERED_PERCENTAGE_COST_REDUCTION_RE.test(description)) continue;
      if (!STAFF_COST_TEXT_CONTRACTS.some(c => c.id === row.id)) {
        unregistered.push(`${row.id}: "${description}"`);
      }
    }
    expect(
      unregistered,
      `Staff cost-reduction descriptions without a registered contract:\n${unregistered.join('\n')}`,
    ).toEqual([]);
  });

  it('every ongoing-cost percentage description is backed by data (Bookkeeper guard)', () => {
    const unbacked: string[] = [];
    for (const row of staffRows) {
      if (!UNREGISTERED_PERCENTAGE_COST_REDUCTION_RE.test(row.description ?? '')) continue;
      const contract = STAFF_COST_TEXT_CONTRACTS.find(c => c.id === row.id);
      if (!contract || !contract.column) {
        unbacked.push(`${row.id}: percentage description has no backing data source`);
        continue;
      }
      if (backingAmount(contract, row) === null) {
        unbacked.push(`${row.id}: percentage description has no parseable ${contract.column} data`);
      }
    }
    expect(
      unbacked,
      `Ongoing-cost percentage descriptions without backing data:\n${unbacked.join('\n')}`,
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

    const column = contract.column;
    if (column) {
      it(`${contract.id}: description amount equals ${column} backing data`, () => {
        const row = findStaff(contract.id);
        expect(row, `${contract.id} missing from card-data.csv`).toBeDefined();
        if (!row) return;

        const amount = describedAmount(contract, row.description ?? '');
        const dataValue = backingAmount(contract, row);
        expect(
          dataValue,
          `${contract.id}: description says '${amount}' but ${column} is absent/unparseable (${row[column]})`,
        ).not.toBeNull();
        expect(
          dataValue,
          `${contract.id}: description says '${amount}' but ${column} = ${row[column]}`,
        ).toBe(amount);
      });
    }

    if (!contract.column) {
      it(`${contract.id}: is documented as description-only`, () => {
        expect(contract.note, `${contract.id} must document its unimplemented-effect gap`).toBeDefined();
        expect(contract.note).toContain(UNIMPLEMENTED_NOTE);
      });
    }
  }
});
