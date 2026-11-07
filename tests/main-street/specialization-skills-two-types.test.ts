/**
 * Specialization-skills two-type contract (MS-0MW2XMB0P002D95K, parent AC4).
 *
 * The GDD's Staff System (Appendix D.4) commits to exactly two staff types —
 * **business staff** (employed at a single business, effects scoped to that
 * business and, where stated, its 8-way neighbours) and **management-company
 * staff** (employed by the player, effects player/turn-scoped).
 * `docs/game/specialization-skills.md` owns the 16-skill specialization
 * catalog, so it must frame skill scope in the two-type vocabulary:
 *
 *  - per-business skills are **business-staff** specialization effects,
 *  - street-wide/player-scope skills are **management-company staff** effects,
 *  - every one of the 16 catalogued skills is assigned exactly one staff type,
 *  - the stacking caps say how they bind each type, and
 *  - the cross-references to `card-catalog.md` and `the-build-gdd.md`
 *    (Appendix D.4) resolve and agree with the shipped skill catalog.
 *
 * The cross-type gap this document used to record as an open reconciliation
 * follow-up is **closed** (MS-0MW3LTMHT001PRDT: scope gate
 * MS-0MW4MSNWR00123OZ + type-consistent assignment MS-0MW4MSNMJ006E9JH), so
 * the guard asserts the closed state — no type-blind "global pool" prose, no
 * "not yet implemented" interim wording, and wiring notes that describe the
 * gated folds and name the gate helpers.
 *
 * The catalog (`STAFF_SKILL_CATALOG`) is the source of truth for which skills
 * exist, so a new skill that is not classified in the document fails this
 * guard.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { STAFF_SKILL_CATALOG } from '../../src/MainStreetStaffSkills';
import type { SpecializationSkillCategory } from '../../src/MainStreetCards';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DOC = path.join(PROJECT_ROOT, 'docs/game/specialization-skills.md');
const CATALOG_DOC = path.join(PROJECT_ROOT, 'docs/game/card-catalog.md');
const GDD_DOC = path.join(PROJECT_ROOT, 'docs/game/the-build-gdd.md');

const BUSINESS = 'Business';
const MANAGEMENT_COMPANY = 'Management-company';

/** The two staff types exactly as the GDD D.4.1 table names them. */
const STAFF_TYPES = [BUSINESS, MANAGEMENT_COMPANY];

const CATEGORY_HEADINGS: Record<SpecializationSkillCategory, string> = {
  'income-boost': 'Income Boost',
  'reputation-boost': 'Reputation Boost',
  'cost-reduction': 'Cost Reduction',
  'incident-mitigation': 'Incident Mitigation',
};

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

function doc(): string {
  return read(DOC);
}

/** The body of the `## <heading>` section, up to the next `## ` heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`\n## ${heading}`);
  if (start < 0) throw new Error(`specialization-skills.md has no "## ${heading}" section`);
  const body = text.slice(start + 1);
  const end = body.indexOf('\n## ', 1);
  return end < 0 ? body : body.slice(0, end);
}

/** Collapses markdown blockquote line breaks and whitespace runs into single spaces. */
function prose(text: string): string {
  return text
    .replace(/\s*\n>\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface DocumentedSkill {
  id: string;
  name: string;
  category: string;
  staffType: string;
}

/**
 * Parses the skill → staff-type table rows:
 * `| `skill-id` | Name | Category | Effect ... | Scope ... | Staff type |`.
 * The staff type is the last cell.
 */
function parseSkillRows(text: string): DocumentedSkill[] {
  const rows: DocumentedSkill[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\|\s*`(skill-[a-z-]+)`\s*\|(.*)\|\s*$/);
    if (!match) continue;
    const cells = match[2].split('|').map(cell => cell.trim());
    rows.push({
      id: match[1],
      name: cells[0] ?? '',
      category: cells[1] ?? '',
      staffType: cells[cells.length - 1] ?? '',
    });
  }
  return rows;
}

function catalogById(): Map<string, (typeof STAFF_SKILL_CATALOG)[number]> {
  return new Map(STAFF_SKILL_CATALOG.map(skill => [skill.id, skill]));
}

describe('specialization-skills.md two-type framing', () => {
  it('defines both staff types and the runtime determinant', () => {
    const text = prose(doc());
    expect(text).toContain('Business staff');
    expect(text).toContain('Management-company staff');
    expect(text).toContain('employedAtSlot');
    // The type is derived from assignment, not a separate flag (GDD D.4.2).
    expect(text).toMatch(/employedAtSlot[^.]*management-company/i);
  });

  it('frames per-business skills as business-staff effects', () => {
    const text = prose(doc());
    expect(text).toMatch(/per-business[^.]*business-staff/i);
    expect(text).toMatch(/business-staff speciali[sz]ation effect/i);
  });

  it('frames street-wide skills as management-company staff effects', () => {
    const text = prose(doc());
    expect(text).toMatch(/street-wide[^.]*management-company/i);
    expect(text).toMatch(/management-company staff effect/i);
  });

  it('classifies every catalogued skill exactly once, as exactly one staff type', () => {
    const rows = parseSkillRows(doc());
    expect(rows.length, 'the skill/type table must classify every catalogued skill').toBe(
      STAFF_SKILL_CATALOG.length,
    );
    expect(rows.map(row => row.id).sort()).toEqual(STAFF_SKILL_CATALOG.map(s => s.id).sort());

    const catalog = catalogById();
    for (const row of rows) {
      const skill = catalog.get(row.id)!;
      expect(row.name, `${row.id} name`).toBe(skill.name);
      expect(row.category, `${row.id} category`).toBe(CATEGORY_HEADINGS[skill.category]);
      expect(STAFF_TYPES, `${row.id} must have one of the two staff types`).toContain(row.staffType);
    }
  });

  it('splits the catalog 5 income / 4 reputation / 3 cost / 4 incident and 8 business / 8 management-company', () => {
    const rows = parseSkillRows(doc());
    const catalog = catalogById();
    const byCategory = (category: SpecializationSkillCategory) =>
      rows.filter(row => catalog.get(row.id)!.category === category);

    expect(byCategory('income-boost')).toHaveLength(5);
    expect(byCategory('reputation-boost')).toHaveLength(4);
    expect(byCategory('cost-reduction')).toHaveLength(3);
    expect(byCategory('incident-mitigation')).toHaveLength(4);

    expect(rows.filter(row => row.staffType === BUSINESS)).toHaveLength(8);
    expect(rows.filter(row => row.staffType === MANAGEMENT_COMPANY)).toHaveLength(8);

    const text = prose(doc());
    expect(text).toMatch(/8 business/i);
    expect(text).toMatch(/8 management-company/i);
  });

  it('assigns each skill the staff type its scope requires', () => {
    const types = new Map(parseSkillRows(doc()).map(row => [row.id, row.staffType]));

    // Scope anchors: per-business effects can only be business staff; anything
    // that resolves against the player, the player's turn, the market or the
    // street-wide incident/economy state can only be management-company staff.
    const expectations: Record<string, string> = {
      'skill-networker': BUSINESS,
      'skill-chef': BUSINESS,
      'skill-dj': BUSINESS,
      'skill-sales-champion': BUSINESS,
      'skill-tech-guru': BUSINESS,
      'skill-community-builder': BUSINESS,
      'skill-pr-strategist': BUSINESS,
      'skill-operations-manager': BUSINESS,
      'skill-town-gossip': MANAGEMENT_COMPANY,
      'skill-brand-ambassador': MANAGEMENT_COMPANY,
      'skill-cost-cutter': MANAGEMENT_COMPANY,
      'skill-negotiator': MANAGEMENT_COMPANY,
      'skill-quality-inspector': MANAGEMENT_COMPANY,
      'skill-risk-manager': MANAGEMENT_COMPANY,
      'skill-security-consultant': MANAGEMENT_COMPANY,
      'skill-compliance': MANAGEMENT_COMPANY,
    };
    for (const [id, staffType] of Object.entries(expectations)) {
      expect(types.get(id), `${id} staff type`).toBe(staffType);
    }
  });

  it('states the stacking caps per member and how they bind each type', () => {
    const text = prose(doc());
    expect(text).toMatch(/more than 1 income-boost/i);
    expect(text).toMatch(/more than 1 reputation-boost/i);
    expect(text).toMatch(/Town Gossip/);
    expect(text).toMatch(/exempt/i);
    expect(text).toMatch(/per member/i);
    // Incident mitigation is management-company scope, so its "stacks freely"
    // rule is about the company roster, not one business.
    expect(text).toMatch(/incident-mitigation skills stack freely/i);
    expect(text).toMatch(/company roster/i);
  });

  it('records the cross-type assignment gap as closed, not outstanding', () => {
    const text = prose(doc());
    // Both halves of the follow-up are shipped and named: the behavioural
    // scope gate and the deterministic type-consistent assignment.
    expect(text).toMatch(/gap is closed/i);
    expect(text).toMatch(/MS-0MW4MSNWR00123OZ/);
    expect(text).toMatch(/MS-0MW4MSNMJ006E9JH/);
    expect(text).toMatch(/scope gate|scope-gate/i);
    expect(text).toMatch(/type-consistent assignment/i);
    // The interim behaviour is no longer described as what ships.
    expect(text).not.toMatch(/not yet type-consistent/i);
    expect(text).not.toMatch(/until they land/i);
    expect(text).not.toMatch(/neither is part of this documentation work item/i);
    expect(text).not.toMatch(/keeps street-wide effects from any employed member/i);
    expect(text).not.toMatch(/currently leaks/i);
  });

  it('no longer describes assignment as a type-blind global pool', () => {
    const text = prose(doc());
    expect(text).not.toMatch(/global 16-skill pool/i);
    expect(text).not.toMatch(/drawn from the global pool/i);
    // The shipped draw is type-consistent: one pool per staff type.
    expect(text).toMatch(/business staff draw only business-scope skills/i);
    expect(text).toMatch(/management-company staff draw only management-company-scope skills/i);
  });

  it('wiring notes describe the gated folds and name the gate helpers', () => {
    const wiring = prose(section(doc(), 'Wiring notes'));
    // Street-wide/player folds read management-company members only.
    expect(wiring).toMatch(/management-company members? only/i);
    // Per-business folds read business-scope skills from the employing
    // business's members (not every street-wide skill the street can hold).
    expect(wiring).toMatch(/business-scope skills of the members employed at that slot/i);
    // Operations Manager is a business-staff effect, gated per charging member.
    expect(wiring).toMatch(/Operations Manager[^.]{0,160}business-staff effect/i);
    // The aggregation helpers are the single gate point every consumer reads.
    expect(wiring).toMatch(/getStreetScopeSkills/);
    expect(wiring).toMatch(/getBusinessScopeSkills/);
    expect(wiring).toMatch(/getSalaryScopeSkills/);
  });

  it('keeps the GDD D.4.8 paragraph and the staff catalogue in the closed state', () => {
    const gdd = prose(read(GDD_DOC));
    expect(gdd).toMatch(/A skill is inert when its scope does not match its holder's type/);
    expect(gdd).not.toMatch(/shipped cross-type follow-?ups/i);

    const catalogue = prose(read(CATALOG_DOC));
    // The 12 specialization applicants are all business staff, so they draw
    // business-scope skills only: the management-company Town Gossip baseline
    // cannot appear on them.
    expect(catalogue).not.toMatch(/Town Gossip baseline, stacking caps/);
    expect(catalogue).toMatch(/type-consistent/i);
  });

  it('keeps the cross-references to the GDD and the card catalogue', () => {
    const text = doc();
    expect(text).toContain('the-build-gdd.md');
    expect(text).toContain('Appendix D.4');
    expect(text).toContain('card-catalog.md');
    expect(text).toContain('Staff Cards');
    // The referenced documents exist and own the two-type model / roster.
    expect(fs.existsSync(GDD_DOC)).toBe(true);
    expect(fs.existsSync(CATALOG_DOC)).toBe(true);
    expect(read(GDD_DOC)).toContain('## Appendix D: Multi-Use Card Economy');
    expect(read(GDD_DOC)).toMatch(/D\.4 Staff System/);
    expect(read(CATALOG_DOC)).toContain('## Staff Cards');
  });

  it('drops the superseded blanket street-wide claims', () => {
    const text = prose(doc());
    // Community Builder is a per-business reputation skill under the two-type
    // model; the old "street-wide (all businesses)" note is superseded.
    expect(text).not.toMatch(/Community Builder is street-wide \(all businesses\)/i);
    // Skills are no longer described without a staff-type framing.
    expect(text).not.toMatch(/Every staff applicant card carries \*\*1–3 specialization skills\*\*/);
  });
});
