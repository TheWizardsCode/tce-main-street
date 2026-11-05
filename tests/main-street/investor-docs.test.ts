/**
 * Investor documentation drift guard (MS-0MUOSUMNK000QZ62, parent AC8).
 *
 * The Investor — a free, once-per-turn market re-roll with a 75% relevance
 * bias, plus the 1-action staff relocation it shares with every other staff
 * card — must stay reflected across the rules docs, the catalogue/progression
 * tables and the developer CSV reference. This guard fails when the documented
 * staff row drifts from the shipped `card-data.csv`, when the deck-size table
 * stops counting every staff template, or when the mechanic vanishes from the
 * canonical docs.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CARD_TIER_MAP, getStaffCardTemplates } from '../../src/MainStreetCards';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CATALOG = path.join(PROJECT_ROOT, 'docs/game/card-catalog.md');
const CONTENT = path.join(PROJECT_ROOT, 'docs/game/content-design-and-progression.md');
const CORE_RULES = path.join(PROJECT_ROOT, 'docs/game/core-rules-and-mechanics.md');
const SRC_README = path.join(PROJECT_ROOT, 'src/README.md');

const INVESTOR_ID = 'staff-investor';

interface DocumentedRow {
  name: string;
  cost: number;
  ongoingCost: number;
  tier: string;
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

/** Parses the catalogue staff row `| `id` | Name | Type | Cost | Ongoing | Slots+ | Tier | … |`. */
function parseCatalogRow(doc: string, id: string): DocumentedRow | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `^\\|\\s*\`${escaped}\`\\s*\\|([^|]*)\\|([^|]*)\\|([^|]*)\\|([^|]*)\\|([^|]*)\\|([^|]*)\\|`,
    'm',
  );
  const m = doc.match(re);
  if (!m) return null;
  return {
    name: m[1].trim(),
    cost: Number(m[3].trim()),
    ongoingCost: Number(m[4].trim()),
    tier: m[6].trim(),
  };
}

/**
 * Parses a prose progression-table row (`| Name | … |`) using the table's own
 * header, so a column added to the table cannot silently shift the values the
 * guard reads.
 */
function parseContentRow(doc: string, name: string): DocumentedRow | null {
  const lines = doc.split('\n');
  const headerIndex = lines.findIndex(
    line => /^\|\s*Name\s*\|/.test(line) && /\bStaff type\b/.test(line),
  );
  if (headerIndex < 0) return null;
  const header = lines[headerIndex].split('|').map(cell => cell.trim());
  const column = (label: string): number => header.indexOf(label);
  const costAt = column('Cost');
  const ongoingAt = column('Ongoing/turn');
  const tierAt = column('Tier');
  if (costAt < 0 || ongoingAt < 0 || tierAt < 0) return null;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rowRe = new RegExp(`^\\|\\s*${escaped}\\s*\\|`, 'm');
  const rowIndex = lines.findIndex(line => rowRe.test(line));
  if (rowIndex < 0) return null;
  const cells = lines[rowIndex].split('|').map(cell => cell.trim());
  return {
    name,
    cost: Number(cells[costAt]),
    ongoingCost: Number(cells[ongoingAt]),
    tier: cells[tierAt],
  };
}

function investorTemplate() {
  const template = getStaffCardTemplates().find(c => c.id === INVESTOR_ID);
  expect(template, `${INVESTOR_ID} must exist in card-data.csv`).toBeDefined();
  return template!;
}

describe('Investor documentation drift guard', () => {
  it('the shipped card declares the free re-roll, 75% bias and generalist types', () => {
    const template = investorTemplate();
    expect(template.name).toBe('Investor');
    expect(template.freeMarketRerollPerTurn).toBe(true);
    expect(template.marketRelevanceBias).toBe(0.75);
    expect(template.handSlotsAdded).toBe(0);
    expect([...(template.allowedBusinessTypes ?? [])].sort()).toEqual(
      ['Commerce', 'Culture', 'Entertainment', 'Food', 'Health', 'Service'].sort(),
    );
  });

  it('card-catalog.md documents the Investor row matching the shipped card', () => {
    const template = investorTemplate();
    const row = parseCatalogRow(read(CATALOG), INVESTOR_ID);
    expect(row, 'catalogue must list the Investor').not.toBeNull();
    expect(row!.name).toBe(template.name);
    expect(row!.cost).toBe(template.cost);
    expect(row!.ongoingCost).toBe(template.ongoingCost);
    expect(row!.tier).toBe(CARD_TIER_MAP.get(INVESTOR_ID));
  });

  it('content-design-and-progression.md lists the Investor row matching the shipped card', () => {
    const template = investorTemplate();
    const row = parseContentRow(read(CONTENT), 'Investor');
    expect(row, 'progression table must list the Investor').not.toBeNull();
    expect(row!.cost).toBe(template.cost);
    expect(row!.ongoingCost).toBe(template.ongoingCost);
    expect(row!.tier).toBe(CARD_TIER_MAP.get(INVESTOR_ID));
  });

  it('card-catalog.md deck-size table counts every staff template', () => {
    const match = read(CATALOG).match(/^\|\s*Staff\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/m);
    expect(match, 'deck-size table must have a Staff row').not.toBeNull();
    const templates = Number(match![1]);
    const copies = Number(match![2]);
    const total = Number(match![3]);
    expect(templates).toBe(getStaffCardTemplates().length);
    expect(total).toBe(templates * copies);
  });

  it('core-rules-and-mechanics.md documents the free re-roll, relevance bias and relocation cost', () => {
    const doc = read(CORE_RULES);
    expect(doc).toContain('Investor');
    expect(doc).toMatch(/free (market )?re-roll/i);
    expect(doc).toContain('75%');
    expect(doc).toContain('marketRelevanceBias');
    expect(doc).toContain('marketRefreshesThisTurn');
    expect(doc).toContain('investorFreeRerollUsedThisTurn');
    expect(doc).toMatch(/Relocat\w* staff costs exactly one action/i);
  });

  it('src/README.md documents the two new staff CSV columns', () => {
    const doc = read(SRC_README);
    expect(doc).toContain('freeMarketRerollPerTurn');
    expect(doc).toContain('marketRelevanceBias');
  });
});
