/**
 * Staff two-type model in the surrounding documentation
 * (MS-0MW2XMBD5006UV3N, parent AC1/AC2/AC3).
 *
 * The GDD (Appendix D.4) defines exactly two staff types — **business staff**
 * and **management-company staff** — and `npm run validate:gdd` guards the four
 * core design documents against drifting from it. This suite covers the
 * documents *around* those four, which describe staff as hand-capacity-only
 * purchases before the redesign:
 *
 *  - `docs/game/content-design-and-progression.md` §1.4 — the shipped staff
 *    ladder must carry a type per row and agree with `src/card-data.csv`;
 *  - `docs/dev/prd-multi-use-card-economy.md` §5 — the historical PRD keeps its
 *    original design text but must carry a supersession pointer to the GDD;
 *  - `src/README.md` — hand capacity grows from **management-company** staff.
 *
 * The stale-phrasing helper is exercised with a negative case, so the guard
 * cannot silently stop detecting the superseded framing.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CARD_TIER_MAP, getStaffCardTemplates } from '../../src/MainStreetCards';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CONTENT = path.join(PROJECT_ROOT, 'docs/game/content-design-and-progression.md');
const PRD = path.join(PROJECT_ROOT, 'docs/dev/prd-multi-use-card-economy.md');
const SRC_README = path.join(PROJECT_ROOT, 'src/README.md');
const SRC_STAFF_BUFFS = path.join(PROJECT_ROOT, 'src/MainStreetStaffBuffs.ts');

const BUSINESS = 'Business';
const MANAGEMENT_COMPANY = 'Management-company';
const STAFF_TYPES = [BUSINESS, MANAGEMENT_COMPANY] as const;

/** Lines asserting staff exist to expand hand capacity — the superseded framing. */
const STALE_STAFF_ROLE_PATTERNS: readonly RegExp[] = [
  /\bstaff\b[^.\n]{0,80}\bexpand\w*\b[^.\n]{0,40}hand[- ](capacity|slots?)/i,
  /\bstaff\b[^.\n]{0,80}(increas|grow)\w*[^.\n]{0,40}hand[- ](capacity|slots?)/i,
  /\bstaff\b[^.\n]{0,40}hand[- ]capacity[^.\n]{0,40}\bonly\b/i,
];

/** A line is not stale when it names the two-type model (or is retiring it). */
const TYPE_AWARE_MARKER = /management-company|business staff|two types|supersed|historical accuracy|status update/i;

/** A section whose heading retires the old model may keep its original text. */
const SUPERSEDED_HEADING = /historical|supersed/i;

const HEADING = /^#{1,6}\s+(.*)$/;

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

/** Collapses blockquote line breaks and whitespace runs, as the docs guards do. */
function prose(text: string): string {
  return text
    .replace(/\s*\n>\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns the lines that still describe staff as a hand-capacity purchase,
 * ignoring lines that name the two-type model, carry a supersession note, or
 * sit in a section whose heading retires the superseded model.
 */
function staleStaffRoleStatements(markdown: string): string[] {
  const stale: string[] = [];
  let inSupersededSection = false;
  for (const line of markdown.split('\n')) {
    const heading = HEADING.exec(line);
    if (heading) inSupersededSection = SUPERSEDED_HEADING.test(heading[1]);
    if (inSupersededSection || TYPE_AWARE_MARKER.test(line)) continue;
    if (STALE_STAFF_ROLE_PATTERNS.some(pattern => pattern.test(line))) stale.push(line);
  }
  return stale;
}

/** The body of a `### <heading>` section, up to the next heading of any level. */
function subsection(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  if (start < 0) throw new Error(`missing section: ${heading}`);
  const rest = doc.slice(start + heading.length);
  const next = rest.search(/^#{1,3} /m);
  return next < 0 ? rest : rest.slice(0, next);
}

interface ProgressionRow {
  name: string;
  type: string;
  cost: number;
  ongoingCost: number;
  tier: string;
}

/** Parses §1.4's staff ladder using the table's own header (no fixed columns). */
function parseStaffLadder(doc: string): ProgressionRow[] {
  const body = subsection(doc, '### 1.4 Staff Cards');
  const lines = body.split('\n');
  const headerIndex = lines.findIndex(line => /^\|\s*Name\s*\|/.test(line));
  if (headerIndex < 0) throw new Error('§1.4 has no staff ladder table');
  const header = lines[headerIndex].split('|').map(cell => cell.trim());
  const at = (label: string): number => {
    const index = header.indexOf(label);
    if (index < 0) throw new Error(`§1.4 staff ladder has no "${label}" column`);
    return index;
  };
  const nameAt = at('Name');
  const typeAt = at('Staff type');
  const costAt = at('Cost');
  const ongoingAt = at('Ongoing/turn');
  const tierAt = at('Tier');

  const rows: ProgressionRow[] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').map(cell => cell.trim());
    if (!cells[nameAt]) continue;
    rows.push({
      name: cells[nameAt],
      type: cells[typeAt],
      cost: Number(cells[costAt]),
      ongoingCost: Number(cells[ongoingAt]),
      tier: cells[tierAt],
    });
  }
  return rows;
}

/** Shipped staff templates keyed by display name, as the docs name them. */
function shippedByName(): Map<string, ReturnType<typeof getStaffCardTemplates>[number]> {
  const byName = new Map<string, ReturnType<typeof getStaffCardTemplates>[number]>();
  for (const template of getStaffCardTemplates()) byName.set(template.name, template);
  return byName;
}

describe('content-design-and-progression.md staff section', () => {
  it('states the two types and points at the authoritative model', () => {
    const section = subsection(read(CONTENT), '### 1.4 Staff Cards');
    expect(section).toContain('**business staff**');
    expect(section).toContain('**management-company staff**');
    expect(section).toContain('the-build-gdd.md');
    expect(section).toContain('Appendix D.4');
    expect(section).toContain('card-catalog.md');
  });

  it('declares a staff type per ladder row and uses only the two type names', () => {
    const rows = parseStaffLadder(read(CONTENT));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(STAFF_TYPES, `${row.name} must carry a staff type`).toContain(row.type);
    }
    expect(rows.some(row => row.type === MANAGEMENT_COMPANY)).toBe(true);
    expect(rows.some(row => row.type === BUSINESS)).toBe(true);
  });

  it('agrees with card-data.csv on cost, salary, tier and type for every ladder row', () => {
    const shipped = shippedByName();
    for (const row of parseStaffLadder(read(CONTENT))) {
      const template = shipped.get(row.name);
      expect(template, `${row.name} must be a shipped staff template`).toBeDefined();
      expect(row.cost, `${row.name} cost`).toBe(template!.cost);
      expect(row.ongoingCost, `${row.name} ongoing cost`).toBe(template!.ongoingCost);
      expect(row.tier, `${row.name} tier`).toBe(CARD_TIER_MAP.get(template!.id));
      const expectedType =
        template!.handSlotsAdded > 0 || (template!.actionsPerTurn ?? 0) > 0
          ? MANAGEMENT_COMPANY
          : BUSINESS;
      expect(row.type, `${row.name} staff type`).toBe(expectedType);
    }
  });

  it('accounts for the staff cards the ladder leaves to the catalogue', () => {
    const doc = read(CONTENT);
    const rows = parseStaffLadder(doc);
    const remainder = doc.match(/remaining (\d+) staff cards/i);
    expect(remainder, 'the section must state how many staff cards it leaves out').not.toBeNull();
    expect(rows.length + Number(remainder![1])).toBe(getStaffCardTemplates().length);
  });

  it('no longer describes staff as a hand-capacity purchase', () => {
    expect(staleStaffRoleStatements(read(CONTENT))).toEqual([]);
  });
});

describe('prd-multi-use-card-economy.md staff section', () => {
  it('records the two-type supersession and points at the GDD model', () => {
    const section = prose(subsection(read(PRD), '### 5. Staff Cards'));
    expect(section).toMatch(/two-type\*{0,2} family/i);
    expect(section).toContain('**business staff**');
    expect(section).toContain('**management-company staff**');
    expect(section).toContain('the-build-gdd.md');
    expect(section).toContain('Appendix D.4');
    expect(section).toContain('card-catalog.md');
    // The superseded lay-off rule stays visible, but only behind the note.
    expect(section).toMatch(/lay-off costs one turn's salary plus 1 reputation/i);
    // The original design text survives as an explicitly historical section.
    expect(section).toMatch(/historical, superseded/i);
  });

  it('keeps every stale staff statement behind a supersession note', () => {
    expect(staleStaffRoleStatements(read(PRD))).toEqual([]);
  });
});

describe('src/README.md hand-capacity contract', () => {
  it('attributes hand-capacity growth to management-company staff only', () => {
    const doc = read(SRC_README);
    expect(doc).toMatch(
      /growable by \*\*management-company\*\* staff `handSlotsAdded`\s+only — business staff never grant hand slots/,
    );
  });

  it('no longer describes staff as a hand-capacity purchase', () => {
    expect(staleStaffRoleStatements(read(SRC_README))).toEqual([]);
  });
});

describe('src/MainStreetStaffBuffs.ts code comments (AC7)', () => {
  it('uses the two-type name "management-company staff" rather than the pre-two-type "hand-slot staff"', () => {
    const doc = read(SRC_STAFF_BUFFS);
    expect(doc).toContain('management-company staff');
    expect(doc).not.toMatch(/hand-slot staff/);
  });
});

describe('stale staff statement detector (negative case)', () => {
  it('flags the pre-redesign phrasing that the review removed', () => {
    const stale = [
      'Staff cards expand hand capacity at an ongoing per-turn coin cost.',
      'Staff cards are a new card family (`family: \'staff\'`) that expand the player\'s hand capacity at an ongoing coin cost.',
      'Staff cards expand hand capacity with ongoing costs.',
      'Staff exist for hand-capacity only.',
    ];
    for (const line of stale) {
      expect(staleStaffRoleStatements(line), line).not.toEqual([]);
    }
  });

  it('ignores the two-type framing, supersession notes and historical sections', () => {
    const allowed = [
      '**Management-company staff** are employed by the player; only management-company staff grant hand capacity.',
      '> **Status update:** the old rule described staff as a hand-capacity purchase; that model is superseded.',
      '#### Historical design (superseded)\n\nStaff cards expand hand capacity at an ongoing cost.',
    ];
    for (const text of allowed) {
      expect(staleStaffRoleStatements(text), text).toEqual([]);
    }
  });
});
