/**
 * Regression tests for the balance-cards CSV pipeline (CG-0MSREC65T004J5SS).
 *
 * The bug: `npm run balance-cards` crashed with "CSV has 30 columns but
 * expected 29" because `refreshCostDiscount` was added to card-data.csv
 * (Group F staff expansion, CG-0MSQJ7VL9009JHF4) but not to
 * `CSV_COLUMNS`/`NUMERIC_COLUMNS` in src/balance-cards/csv.ts. The per-group
 * expansion tests fed pre-parsed rows into `validateCsvRows`, bypassing
 * `parseCsv`/`readCsvFile` — the exact code path that crashed.
 *
 * These tests exercise the full `readCsvFile` → `validateCsvRows` →
 * `runBalancingPass` pipeline against the real card-data.csv so a future
 * CSV-column change cannot silently break the CLI again. The
 * `upgradeCostDiscount` column (Financial Advisor, CG-0MTKMGL66004I0PC) is
 * covered by the same pipeline so a future schema addition cannot regress it.
 *
 * @module
 */

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

import {
  readCsvFile,
  validateCsvRows,
  runBalancingPass,
  toCsvString,
  parseCsv,
  validateRow,
  CSV_COLUMNS,
  NUMERIC_COLUMNS,
} from '@balance-cards';

const CSV_PATH = resolve(process.cwd(), 'src/card-data.csv');

describe('balance-cards CSV pipeline (regression CG-0MSREC65T004J5SS)', () => {
  it('reads the real card-data.csv without a column-count crash', () => {
    const rows = readCsvFile(CSV_PATH);
    // Header has 44 columns, including refreshCostDiscount (Group F),
    // upgradeCostDiscount (Financial Advisor, CG-0MTKMGL66004I0PC) and
    // purchaseCostDiscount (Delivery Driver, CG-0MUMCVH3N007KT1M).
    expect(rows.length).toBeGreaterThan(100);
  });

  it('declares upgradeCostDiscount immediately after peekOncePerTurn and treats it as numeric', () => {
    // Schema contract: the new column is inserted at the position the CSV
    // parser expects (immediately after peekOncePerTurn).
    expect(CSV_COLUMNS.indexOf('upgradeCostDiscount')).toBe(
      CSV_COLUMNS.indexOf('peekOncePerTurn') + 1,
    );
    expect(NUMERIC_COLUMNS).toContain('upgradeCostDiscount');
  });

  it('declares purchaseCostDiscount immediately after upgradeCostDiscount and treats it as numeric', () => {
    // Schema contract: the new column is inserted immediately after
    // upgradeCostDiscount, before art_notes (CG-0MUMCVH3N007KT1M).
    expect(CSV_COLUMNS.indexOf('purchaseCostDiscount')).toBe(
      CSV_COLUMNS.indexOf('upgradeCostDiscount') + 1,
    );
    expect(NUMERIC_COLUMNS).toContain('purchaseCostDiscount');
  });

  it('validates all real CSV rows (refreshCostDiscount is numeric)', () => {
    const rows = readCsvFile(CSV_PATH);
    expect(() => validateCsvRows(rows)).not.toThrow();
  });

  it('parses refreshCostDiscount into staff rows', () => {
    const rows = readCsvFile(CSV_PATH);
    const accountant = rows.find(r => r.id === 'staff-accountant');
    expect(accountant).toBeDefined();
    expect(accountant?.refreshCostDiscount).toBe('100');
  });

  it('parses upgradeCostDiscount into the Financial Advisor row', () => {
    const rows = readCsvFile(CSV_PATH);
    const advisor = rows.find(r => r.id === 'staff-financial');
    expect(advisor).toBeDefined();
    expect(advisor?.upgradeCostDiscount).toBe('100');
  });

  it('parses purchaseCostDiscount into the Delivery Driver row', () => {
    const rows = readCsvFile(CSV_PATH);
    const delivery = rows.find(r => r.id === 'staff-delivery');
    expect(delivery).toBeDefined();
    expect(delivery?.purchaseCostDiscount).toBe('50');
  });

  it('runs the full balancing pass on the real CSV', () => {
    const rows = readCsvFile(CSV_PATH);
    const result = runBalancingPass(rows);
    expect(result.rows).toHaveLength(rows.length);
    // Staff cost-reduction columns survive the pass unchanged
    const accountant = result.rows.find(r => r.id === 'staff-accountant');
    expect(accountant?.refreshCostDiscount).toBe('100');
    const advisor = result.rows.find(r => r.id === 'staff-financial');
    expect(advisor?.upgradeCostDiscount).toBe('100');
    const delivery = result.rows.find(r => r.id === 'staff-delivery');
    expect(delivery?.purchaseCostDiscount).toBe('50');
  });

  it('round-trips the balanced CSV with all 44 columns intact', () => {
    const rows = readCsvFile(CSV_PATH);
    const result = runBalancingPass(rows);
    const reparsed = parseCsv(toCsvString(result.rows));
    expect(reparsed).toHaveLength(result.rows.length);
    const accountant = reparsed.find(r => r.id === 'staff-accountant');
    expect(accountant?.refreshCostDiscount).toBe('100');
    const advisor = reparsed.find(r => r.id === 'staff-financial');
    expect(advisor?.upgradeCostDiscount).toBe('100');
    const delivery = reparsed.find(r => r.id === 'staff-delivery');
    expect(delivery?.purchaseCostDiscount).toBe('50');
  });

  it('treats refreshCostDiscount as numeric in row validation', () => {
    const rows = readCsvFile(CSV_PATH);
    const accountant = rows.find(r => r.id === 'staff-accountant');
    expect(accountant).toBeDefined();
    const nonNumeric = { ...accountant, refreshCostDiscount: 'abc' };
    const errors = validateRow(nonNumeric as never, 0);
    expect(errors.some(e => e.includes("refreshCostDiscount' has non-numeric value"))).toBe(true);
  });

  it('treats upgradeCostDiscount as numeric in row validation', () => {
    const rows = readCsvFile(CSV_PATH);
    const advisor = rows.find(r => r.id === 'staff-financial');
    expect(advisor).toBeDefined();
    const nonNumeric = { ...advisor, upgradeCostDiscount: 'abc' };
    const errors = validateRow(nonNumeric as never, 0);
    expect(errors.some(e => e.includes("upgradeCostDiscount' has non-numeric value"))).toBe(true);
  });
});
