/**
 * Card-catalog staff two-type contract (MS-0MW2XMAD2005MNQ4, parent AC4).
 *
 * The GDD's Staff System (Appendix D.4) commits to exactly two staff types —
 * **business staff** (employed at a single business, effects scoped to that
 * business) and **management-company staff** (employed by the player, effects
 * player/turn-scoped). `docs/game/card-catalog.md` is the roster of record for
 * the 26 shipped staff templates, so it must:
 *
 *  - explain the two-type model instead of the superseded hand-capacity framing,
 *  - classify every shipped staff card as exactly one of the two types,
 *  - keep the shipped cost / salary / tier / hand-slot data intact,
 *  - describe the Investor consistently with the model (business staff, bias
 *    toward its own business), and
 *  - keep pointing at `specialization-skills.md` and GDD Appendix D.4.
 *
 * The test fails when the catalogue's staff roster drifts from
 * `src/card-data.csv`, when a card loses its type, or when the two-type framing
 * disappears from the family description.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CARD_TIER_MAP, getStaffCardTemplates } from '../../src/MainStreetCards';
import type { StaffCard } from '../../src/MainStreetCardsTypes';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CATALOG = path.join(PROJECT_ROOT, 'docs/game/card-catalog.md');

const BUSINESS = 'Business';
const MANAGEMENT_COMPANY = 'Management-company';

interface DocumentedStaffRow {
  id: string;
  name: string;
  type: string;
  cost: number;
  ongoingCost: number;
  slots: string;
  tier: string;
  ability: string;
  description: string;
  rationale: string;
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

/** The `## Staff Cards` section body (everything up to the next `## ` heading). */
function staffSection(doc: string): string {
  const start = doc.indexOf('\n## Staff Cards');
  if (start < 0) throw new Error('card-catalog.md has no `## Staff Cards` section');
  const body = doc.slice(start + 1);
  const end = body.indexOf('\n## ', 1);
  return end < 0 ? body : body.slice(0, end);
}

/**
 * Parses the staff roster table rows:
 * `| ID | Name | Type | Cost | Ongoing/turn | Slots+ | Tier | Ability | Description | Rationale |`.
 */
function parseStaffRows(doc: string): DocumentedStaffRow[] {
  const rows: DocumentedStaffRow[] = [];
  for (const line of staffSection(doc).split('\n')) {
    const match = line.match(/^\|\s*`(staff-[a-z-]+)`\s*\|(.*)\|\s*$/);
    if (!match) continue;
    const cells = match[2].split('|').map(cell => cell.trim());
    rows.push({
      id: match[1],
      name: cells[0] ?? '',
      type: cells[1] ?? '',
      cost: Number(cells[2]),
      ongoingCost: Number(cells[3]),
      slots: cells[4] ?? '',
      tier: cells[5] ?? '',
      ability: cells[6] ?? '',
      description: cells[7] ?? '',
      rationale: cells[8] ?? '',
    });
  }
  return rows;
}

/**
 * The staff type derived from the shipped template, per the GDD invariant
 * "`handSlotsAdded > 0` implies management-company staff; business staff
 * always have `handSlotsAdded = 0`" plus the action-point marker.
 */
function shippedType(template: StaffCard): string {
  return template.handSlotsAdded > 0 || (template.actionsPerTurn ?? 0) > 0
    ? MANAGEMENT_COMPANY
    : BUSINESS;
}

function shippedTemplates(): StaffCard[] {
  return getStaffCardTemplates();
}

describe('card-catalog.md staff two-type roster', () => {
  it('documents every shipped staff template exactly once', () => {
    const rows = parseStaffRows(read(CATALOG));
    const documented = rows.map(row => row.id).sort();
    const shipped = shippedTemplates()
      .map(template => template.id)
      .sort();
    expect(documented).toEqual(shipped);
  });

  it('classifies each staff card as exactly one of the two types', () => {
    const templates = new Map(shippedTemplates().map(template => [template.id, template]));
    for (const row of parseStaffRows(read(CATALOG))) {
      const template = templates.get(row.id);
      expect(template, `${row.id} must exist in card-data.csv`).toBeDefined();
      expect([BUSINESS, MANAGEMENT_COMPANY]).toContain(row.type);
      expect(row.type, `${row.id} type must match the shipped card`).toBe(
        shippedType(template!),
      );
    }
  });

  it('splits the roster 9 management-company / 17 business and says so', () => {
    const rows = parseStaffRows(read(CATALOG));
    const management = rows.filter(row => row.type === MANAGEMENT_COMPANY);
    const business = rows.filter(row => row.type === BUSINESS);
    expect(management).toHaveLength(9);
    expect(business).toHaveLength(17);

    const section = staffSection(read(CATALOG));
    expect(section).toMatch(/9 management-company staff/);
    expect(section).toMatch(/17 business staff/);
  });

  it('keeps the shipped cost, salary, tier and hand-slot data', () => {
    const templates = new Map(shippedTemplates().map(template => [template.id, template]));
    for (const row of parseStaffRows(read(CATALOG))) {
      const template = templates.get(row.id)!;
      expect(row.name, `${row.id} name`).toBe(template.name);
      expect(row.cost, `${row.id} cost`).toBe(template.cost);
      expect(row.ongoingCost, `${row.id} ongoing cost`).toBe(template.ongoingCost);
      expect(row.tier, `${row.id} tier`).toBe(CARD_TIER_MAP.get(row.id));
      expect(row.slots, `${row.id} hand slots`).toBe(
        template.handSlotsAdded > 0 ? `+${template.handSlotsAdded}` : '—',
      );
    }
  });

  it('explains the two-type model and keeps the cross-references', () => {
    const section = staffSection(read(CATALOG));
    expect(section).toContain('Business staff');
    expect(section).toContain('Management-company staff');
    expect(section).toContain('employedAtSlot');
    expect(section).toContain('| Type |');
    expect(section).toContain('the-build-gdd.md');
    expect(section).toContain('Appendix D.4');
    expect(section).toContain('specialization-skills.md');
    // The superseded framing described staff as hand-capacity purchases only.
    expect(section).not.toMatch(/expand hand capacity at an ongoing per-turn coin cost/);
  });

  it('describes the Investor as business staff biased toward its own business', () => {
    const investor = parseStaffRows(read(CATALOG)).find(row => row.id === 'staff-investor');
    expect(investor, 'catalogue must list the Investor').toBeDefined();
    expect(investor!.type).toBe(BUSINESS);
    expect(investor!.description).toMatch(/its own business/i);
    expect(investor!.description).toContain('75%');
  });
});
