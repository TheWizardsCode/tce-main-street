/**
 * Main Street: per-card piggyback-eligibility flag (MS-0MV8BFOVB000HM0W / F1)
 *
 * Verifies the `piggybackable` column added to `src/card-data.csv`:
 * - exactly the 16 producer-approved "Option-A" organiser Investment cards
 *   are flagged `true` (epic MS-0MUYC47EL005Z69H, producer Q1 answer "A"),
 *   and no other row is flagged;
 * - every flagged card is an Investment event (never an incident);
 * - non-organiser Investment events (Grand Opening Sale, Charity Drive,
 *   Bulk Purchase, Volunteer Day) parse to a falsy/absent flag;
 * - absent and invalid flag values fall back to absent (backwards
 *   compatible — older saves and templates are unaffected);
 * - the CSV checksum reflects the new column.
 *
 * @module tests/main-street/piggyback-eligibility
 */
import { describe, expect, it, afterEach } from 'vitest';

import {
  type EventCard,
  getEventTemplates,
  loadTemplatesFromCsv,
  resetTemplatesToDefault,
  CARD_DATA_RAW,
  CSV_CHECKSUM,
} from '../../src/MainStreetCards';
import { computeCsvChecksum } from '../../src/CsvChecksum';

// ── The producer-approved Option-A flagged set (16 cards) ────

/** Exactly the 16 town-wide festival/fair/party/celebration cards flagged `true`. */
const ORGANISER_IDS: readonly string[] = [
  'evt-festival', // Local Festival
  'evt-wellness-fair', // Wellness Fair
  'evt-block-party', // Block Party
  'evt-harvest-festival', // Harvest Festival
  'evt-book-fair', // Book Fair
  'evt-community-garden', // Garden Party
  'evt-festival-season', // Festival Season
  'evt-health-carnival', // Health Carnival
  'evt-summer-fest', // Summer Fest
  'evt-st-brigids', // St Brigid's Day
  'evt-st-patricks', // St Patrick's Day
  'evt-easter', // Easter
  'evt-may-day', // May Day / Bealtaine
  'evt-lughnasadh', // Lughnasadh
  'evt-samhain', // Samhain / Halloween
  'evt-christmas', // Christmas
];

/** Representative non-organiser Investment events that must NEVER be flagged. */
const NON_ORGANISER_IDS: readonly string[] = [
  'evt-grand-opening', // Grand Opening Sale
  'evt-charity-drive', // Charity Drive
  'evt-bulk-purchase', // Bulk Purchase
  'evt-volunteer-day', // Volunteer Day
];

function templateById(id: string): EventCard {
  const card = getEventTemplates().find((c: EventCard) => c.id === id);
  expect(card, `event template ${id} should exist in card-data.csv`).toBeDefined();
  return card as EventCard;
}

// ── Data-contract tests over the bundled card-data.csv ───────

describe('piggybackable flag in card-data.csv (AC1/AC2)', () => {
  it('flags exactly the 16 Option-A organiser cards and nothing else', () => {
    const flagged = getEventTemplates().filter((c: EventCard) => c.piggybackable === true);
    expect(flagged).toHaveLength(ORGANISER_IDS.length);
    expect(flagged.map((c: EventCard) => c.id).sort()).toEqual(
      [...ORGANISER_IDS].sort(),
    );
  });

  it('every flagged card is an Investment event, never an incident', () => {
    for (const id of ORGANISER_IDS) {
      const card = templateById(id);
      expect(card.piggybackable, `${id} should be piggybackable`).toBe(true);
      expect(card.trigger, `${id} should be an Investment event`).toBe('Investment');
    }
  });

  it('every non-flagged event carries an absent flag (never an explicit false)', () => {
    // A non-true value must parse to `undefined`, not `false` — older saves and
    // templates omit the field entirely, and the parser only spreads `true`.
    for (const card of getEventTemplates()) {
      if (card.piggybackable !== true) {
        expect(card.piggybackable, `${card.id} flag should be absent`).toBeUndefined();
      }
    }
  });

  it('non-organiser Investment events (AC3 examples) are not flagged', () => {
    for (const id of NON_ORGANISER_IDS) {
      const card = templateById(id);
      expect(card.trigger).toBe('Investment');
      expect(card.piggybackable, `${id} must not be piggyback-eligible`).toBeFalsy();
    }
  });
});

// ── Backwards compatibility: older CSV/saves without the column ─

/** The full 54-column bundled CSV header. */
const BUNDLED_HEADER = CARD_DATA_RAW.split('\n')[0];

/**
 * Rebuild the bundled CSV as a legacy 53-column pool: drop the
 * `piggybackable` header column and the trailing flag field from every row.
 */
function legacyCsvWithoutPiggybackColumn(): string {
  const lines = CARD_DATA_RAW.split('\n').filter((line) => line !== '');
  const header = lines[0].replace(',piggybackable', '');
  const rows = lines
    .slice(1)
    .map((line) => line.replace(/,(true)?$/, ''));
  return [header, ...rows].join('\n') + '\n';
}

/** An existing bundled event row with its trailing flag field rewritten. */
function eventRowWithFlag(id: string, flag: '' | 'false' | 'true'): string {
  const base = CARD_DATA_RAW.split('\n').find((line) =>
    line.startsWith('event,evt-festival,'),
  );
  if (!base) throw new Error('bundled evt-festival row is missing');
  const withoutFlag = base.replace(/,(true)?$/, '');
  const withId = withoutFlag.replace(',evt-festival,', `,${id},`);
  return flag === '' ? `${withId},` : `${withId},${flag}`;
}

describe('piggybackable backward compatibility (AC1)', () => {
  afterEach(() => {
    resetTemplatesToDefault();
  });

  it('parses events from a legacy CSV (no piggybackable column) as absent', () => {
    loadTemplatesFromCsv(legacyCsvWithoutPiggybackColumn());
    expect(templateById('evt-festival').piggybackable).toBeUndefined();
    expect(templateById('evt-christmas').piggybackable).toBeUndefined();
    // The rest of the row still parses normally (no column shift).
    expect(templateById('evt-festival').name).toBe('Local Festival');
    expect(templateById('evt-festival').trigger).toBe('Investment');
  });

  it('treats an empty or non-"true" column value as absent', () => {
    const csv = [
      BUNDLED_HEADER,
      eventRowWithFlag('evt-empty-flag', ''),
      eventRowWithFlag('evt-false-flag', 'false'),
      eventRowWithFlag('evt-true-flag', 'true'),
    ].join('\n') + '\n';

    loadTemplatesFromCsv(csv);
    expect(templateById('evt-empty-flag').piggybackable).toBeUndefined();
    expect(templateById('evt-false-flag').piggybackable).toBeUndefined();
    expect(templateById('evt-true-flag').piggybackable).toBe(true);
  });
});

// ── Checksum reflects the new column (AC4) ───────────────────

describe('piggybackable and the CSV checksum (AC4)', () => {
  it('the bundled CSV declares the piggybackable column', () => {
    expect(CARD_DATA_RAW.split('\n')[0].split(',')).toContain('piggybackable');
  });

  it('the checksum changes when the piggybackable column is removed', () => {
    const withoutColumn = legacyCsvWithoutPiggybackColumn();
    expect(computeCsvChecksum(withoutColumn)).not.toBe(computeCsvChecksum(CARD_DATA_RAW));
    // The runtime checksum is consistent with the raw bundled text.
    expect(CSV_CHECKSUM).toBe(computeCsvChecksum(CARD_DATA_RAW));
  });
});
