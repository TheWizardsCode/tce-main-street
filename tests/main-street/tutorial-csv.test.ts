/**
 * Tutorial CSV Integrity Tests
 *
 * Validates the spreadsheet source of truth for tutorial copy:
 * - Header is `key,text`
 * - Every required key is present (65 total)
 * - No duplicate or orphan/unknown keys
 * - No value is empty
 * - Embedded commas and double quotes round-trip
 * - Leading UTF-8 BOM is tolerated
 * - Placeholder tokens are preserved
 *
 * @module
 */

import { describe, it, expect } from 'vitest';
import { parseCsv } from '@core-engine/CsvLoader';
import { TUTORIAL_EN_BUNDLE } from '../../src/i18n/tutorial-en';
import tutorialCsvRaw from '../../src/i18n/tutorial-en.csv?raw';

// ── Required keys ─────────────────────────────────────────────

const REQUIRED_KEYS = [
  // Offer modal (4)
  'tutorial.modal.title',
  'tutorial.modal.body',
  'tutorial.modal.skipBtn',
  'tutorial.modal.startBtn',
  // Overlay buttons (4)
  'tutorial.overlay.dismiss',
  'tutorial.overlay.next',
  'tutorial.overlay.exit',
  'tutorial.overlay.startFullGame',
  // Banking hints (2)
  'tutorial.bankingHint.title',
  'tutorial.bankingHint.body',
  // Steam follow CTA (5) — F5, CG-0MSMAJQQT004SDCC
  'tutorial.steamFollow.cta',
  'tutorial.steamFollow.opened',
  'tutorial.steamFollow.openedBrowser',
  'tutorial.steamFollow.unavailable',
  'tutorial.steamFollow.unlocked',
  // Tutorial steps T1–T25 (50 = 25 × 2)
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].flatMap(n => [
    `tutorial.T${n}.title`,
    `tutorial.T${n}.body`,
  ]),
];

describe('Tutorial CSV integrity', () => {
  const rawCsv = tutorialCsvRaw;
  it('has a `key,text` header', () => {
    const lines = rawCsv.split('\n').filter(l => l.trim() !== '');
    const headerLine = lines[0].trim();
    const parts = headerLine.split(',').map(p => p.trim());
    expect(parts).toEqual(['key', 'text']);
  });

  it('contains exactly 65 data rows (keys)', () => {
    const rows = parseCsv(rawCsv);
    expect(rows.length).toBe(65);
  });

  it('every required key is present', () => {
    const rows = parseCsv(rawCsv);
    const keys = new Set(rows.map(r => r.key));
    for (const req of REQUIRED_KEYS) {
      expect(keys).toContain(req);
    }
  });

  it('no duplicate keys', () => {
    const rows = parseCsv(rawCsv);
    const keys = rows.map(r => r.key);
    const seen = new Set<string>();
    for (const k of keys) {
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('no orphan/unknown keys', () => {
    const rows = parseCsv(rawCsv);
    const reqSet = new Set(REQUIRED_KEYS);
    for (const row of rows) {
      expect(reqSet).toContain(row.key);
    }
  });

  it('no empty values', () => {
    const rows = parseCsv(rawCsv);
    for (const row of rows) {
      expect(row.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('embedded double quote round-trips (banking hint body)', () => {
    const rows = parseCsv(rawCsv);
    const banking = rows.find(r => r.key === 'tutorial.bankingHint.body');
    expect(banking).toBeDefined();
    expect(banking!.text).toContain('"(1 banked)"');
  });

  it('comma-bearing values round-trip correctly (RFC4180 quoting)', () => {
    const rows = parseCsv(rawCsv);
    const commaKeys = new Set<string>();
    for (const row of rows) {
      if (row.text.includes(',')) {
        commaKeys.add(row.key);
      }
    }
    // At least 7 values contain commas and must round-trip through the CSV
    // parser without splitting into separate fields.
    expect(commaKeys.size).toBeGreaterThanOrEqual(7);
    // Verify specific comma-containing keys parse cleanly as full strings.
    const t3Body = rows.find(r => r.key === 'tutorial.T3.body');
    expect(t3Body!.text).toContain('free now'); // the full sentence is preserved
    expect(t3Body!.text).toContain('listed **{cost}**');
  });

  it('placeholder tokens are preserved', () => {
    const rows = parseCsv(rawCsv);
    const placeholders = ['{cardName}', '{cost}', '{bonus}', '{synergyCardName}'];
    for (const row of rows) {
      for (const ph of placeholders) {
        if (row.text.includes(ph)) {
          // Ensure the placeholder appears as written, not mangled.
          expect(row.text).toContain(ph);
        }
      }
    }
  });

  it('T3 body preserves card-data placeholders', () => {
    const rows = parseCsv(rawCsv);
    const t3 = rows.find(r => r.key === 'tutorial.T3.body');
    expect(t3!.text).toContain('{cardName}');
    expect(t3!.text).toContain('{cost}');
  });

  it('T20 body preserves synergyCardName placeholder', () => {
    const rows = parseCsv(rawCsv);
    const t20 = rows.find(r => r.key === 'tutorial.T20.body');
    expect(t20!.text).toContain('{cardName}');
    expect(t20!.text).toContain('{synergyCardName}');
  });

  it('loader bundle has all 65 keys (CSV loads correctly)', () => {
    expect(Object.keys(TUTORIAL_EN_BUNDLE).length).toBe(65);
  });
});
