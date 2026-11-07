#!/usr/bin/env node
/**
 * GDD staff two-type consistency checker (MS-0MW2XKTR50062OFL, parent AC1/AC2).
 *
 * The GDD (`docs/game/the-build-gdd.md`, Appendix D.4) commits to exactly two
 * staff types — **business staff** (employed at a single business, effects
 * scoped to that business) and **management-company staff** (employed by the
 * player, effects player/turn-scoped). The surrounding design docs
 * (`card-catalog.md`, `core-rules-and-mechanics.md`,
 * `specialization-skills.md`) must agree with that model and must not
 * reintroduce the superseded three-tier hand-capacity description.
 *
 * This module is the single source of truth for that verification. It runs
 * two ways, so a documentation change cannot drift without failing:
 *
 *  - as a unit test in the documentation-guard suite
 *    (`tests/main-street/gdd-staff-consistency.test.ts`), and
 *  - as a standalone check: `npm run validate:gdd` (add `-- --json` for the
 *    machine-readable report).
 *
 * Rules enforced:
 *
 *  1. `stale-three-tier` — the GDD mentions the old three-tier hand-capacity
 *     model only in a supersession context (the D.4.6 supersession section, or
 *     a line that explicitly says it is superseded); the other three docs must
 *     not mention it at all.
 *  2. `two-type-definition` — the GDD's Staff System section states exactly two
 *     types, names both, rules out a third, and gives the runtime determinant
 *     (`employedAtSlot`).
 *  3. `roster-coverage` — the D.4.3/D.4.4 role tables list every shipped staff
 *     template exactly once.
 *  4. `roster-type` — each card sits in the table for the type its shipped
 *     card data implies (`handSlotsAdded > 0` or `actionsPerTurn > 0` is
 *     management-company; everything else is business staff).
 *  5. `roster-data` — each role row's name, tier and salary match the shipped
 *     card (`src/card-data.csv` via the card model).
 *  6. `benefit-uniqueness` — no two roles state the same benefit.
 *  7. `delta-agreement` — the cards the GDD marks as re-scoped/re-valued are
 *     exactly the cards D.4.7 names.
 *  8. `roster-counts` — every stated roster count (total, per-type split and
 *     the "N of the M" phrasing) matches the shipped data.
 *  9. `skill-count` — the stated specialization-skill count matches the shipped
 *     catalog.
 * 10. `cross-references` — every relative markdown link resolves, the four docs
 *     reference each other, every cited GDD appendix number (`D.4.N`) exists as
 *     a heading, and every cited `§ *Section*` exists as a heading.
 * 11. `terminology` — every doc uses both type names, and the un-hyphenated
 *     "management company staff" label never appears.
 *
 * Runs under `vite-node` because the card model imports `card-data.csv` via
 * Vite's `?raw` query, which plain `tsx`/Node cannot resolve.
 *
 * @module
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CARD_TIER_MAP, getStaffCardTemplates } from '../MainStreetCards';
import { STAFF_SKILL_CATALOG } from '../MainStreetStaffSkills';

export type StaffType = 'Business' | 'Management-company';

/** The two staff types, as the GDD's D.4.1 table names them. */
export const STAFF_TYPES: readonly StaffType[] = ['Business', 'Management-company'];

/** The subset of a shipped staff template this checker needs. */
export interface ConsistencyStaffTemplate {
  id: string;
  name: string;
  tier?: number;
  ongoingCost: number;
  handSlotsAdded: number;
  actionsPerTurn?: number;
}

/** The four design documents, keyed by role. */
export interface ConsistencyDocs {
  gdd: string;
  cardCatalog: string;
  coreRules: string;
  specializationSkills: string;
}

export type ConsistencyDocKey = keyof ConsistencyDocs;

/** Filename stem of each document (as cited in prose and links). */
const DOC_STEMS: Record<ConsistencyDocKey, string> = {
  gdd: 'the-build-gdd',
  cardCatalog: 'card-catalog',
  coreRules: 'core-rules-and-mechanics',
  specializationSkills: 'specialization-skills',
};

/** Repository-relative path of each document, for report messages. */
export const CONSISTENCY_DOC_PATHS: Record<ConsistencyDocKey, string> = {
  gdd: 'docs/game/the-build-gdd.md',
  cardCatalog: 'docs/game/card-catalog.md',
  coreRules: 'docs/game/core-rules-and-mechanics.md',
  specializationSkills: 'docs/game/specialization-skills.md',
};

/**
 * Cross-references the two-type model requires: each doc must name each of the
 * listed docs (as a markdown link or a plain/code-span reference — the GDD
 * embeds its core rules inline and references them by filename).
 */
export const REQUIRED_CROSS_REFERENCES: Record<ConsistencyDocKey, ConsistencyDocKey[]> = {
  gdd: ['cardCatalog', 'coreRules', 'specializationSkills'],
  cardCatalog: ['gdd', 'coreRules', 'specializationSkills'],
  coreRules: ['gdd', 'cardCatalog'],
  specializationSkills: ['gdd', 'cardCatalog', 'coreRules'],
};

export interface ConsistencyViolation {
  rule: string;
  message: string;
}

export interface ConsistencyReport {
  ok: boolean;
  violations: ConsistencyViolation[];
  summary: {
    staffTotal: number;
    managementCompany: number;
    business: number;
    skills: number;
    documentsChecked: string[];
    rulesRun: string[];
  };
}

export interface ConsistencyOptions {
  docs: ConsistencyDocs;
  staffTemplates: ConsistencyStaffTemplate[];
  /** Shipped specialization-skill ids (the GDD states their count). */
  skillIds: string[];
  /**
   * Absolute path to `docs/game`, used to resolve relative markdown links.
   * Defaults to `<cwd>/docs/game`.
   */
  docsGameDir?: string;
}

const RULES = [
  'stale-three-tier',
  'two-type-definition',
  'roster-coverage',
  'roster-type',
  'roster-data',
  'benefit-uniqueness',
  'delta-agreement',
  'roster-counts',
  'skill-count',
  'cross-references',
  'terminology',
] as const;

/**
 * Phrases that only belong to the superseded three-tier hand-capacity model.
 * Each one is stale unless it sits in the supersession section or on a line
 * that explicitly says the model is superseded.
 */
const STALE_THREE_TIER_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'three-tier staff model', pattern: /three[- ]tier/i },
  { label: 'hand-capacity tiers', pattern: /hand[- ]capacity tiers?/i },
  { label: 'old currency scale', pattern: /old currency scale/i },
  { label: 'Assistant / Manager / Director tiers', pattern: /Assistant\s*\/\s*Manager\s*\/\s*Director/i },
  { label: 'random hand-card lay-off rule', pattern: /removing random hand cards/i },
  { label: 'staff as pure hand-capacity purchases', pattern: /hand[- ]capacity purchases?/i },
];

/** A line carrying this marker may mention the old model (it is being retired). */
const SUPERSESSION_MARKER = /supersed/i;

const SUPERSESSION_HEADING = /supersession of the old three-tier/i;

// ── Markdown helpers ────────────────────────────────────────

interface DocLine {
  text: string;
  lineNumber: number;
}

interface DocSection {
  heading: string;
  level: number;
  /** Body lines after the heading, up to the next heading. */
  lines: DocLine[];
}

const HEADING_PATTERN = /^(#{1,6})[ \t]+(.+?)[ \t]*$/;

/**
 * Splits a markdown document into heading-delimited sections. Fenced code
 * blocks are skipped so a `#` comment inside a fence is never read as a
 * heading.
 */
export function sections(markdown: string): DocSection[] {
  const sections: DocSection[] = [];
  let current: DocSection | null = null;
  let inFence = false;

  markdown.split('\n').forEach((text, index) => {
    const fence = /^\s*(```|~~~)/.test(text);
    if (fence) {
      inFence = !inFence;
      current?.lines.push({ text, lineNumber: index + 1 });
      return;
    }
    if (inFence) {
      current?.lines.push({ text, lineNumber: index + 1 });
      return;
    }
    const heading = HEADING_PATTERN.exec(text);
    if (heading) {
      current = { heading: heading[2], level: heading[1].length, lines: [] };
      sections.push(current);
      return;
    }
    current?.lines.push({ text, lineNumber: index + 1 });
  });

  return sections;
}

/** The first section whose heading matches `pattern`, if any. */
export function findSection(markdown: string, pattern: RegExp): DocSection | undefined {
  return sections(markdown).find(section => pattern.test(section.heading));
}

/** The body of the first section whose heading matches `pattern`. */
function sectionBody(markdown: string, pattern: RegExp): string {
  const section = findSection(markdown, pattern);
  if (!section) throw new Error(`document has no heading matching ${pattern}`);
  return section.lines.map(line => line.text).join('\n');
}

/**
 * The full text of the section matching `pattern`, including its nested
 * sub-sections (up to the next heading of the same or a higher level).
 */
function appendixText(markdown: string, pattern: RegExp): string | undefined {
  const all = sections(markdown);
  const index = all.findIndex(section => pattern.test(section.heading));
  if (index < 0) return undefined;
  const parentLevel = all[index].level;
  const parts = [all[index].heading, ...all[index].lines.map(line => line.text)];
  for (let i = index + 1; i < all.length && all[i].level > parentLevel; i++) {
    parts.push(all[i].heading, ...all[i].lines.map(line => line.text));
  }
  return parts.join('\n');
}

interface MarkdownLink {
  text: string;
  target: string;
  lineNumber: number;
}

function markdownLinks(markdown: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  markdown.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)) {
      links.push({ text: match[1], target: match[2], lineNumber: index + 1 });
    }
  });
  return links;
}

/** Normalises a benefit cell for uniqueness comparison. */
function normaliseBenefit(benefit: string): string {
  return benefit
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Splits a prose list ("A, B and C") into trimmed names. */
function splitNameList(list: string): string[] {
  return list
    .split(/,\s*|\s+and\s+/)
    .map(name => name.replace(/[.*`)]+$/, '').trim())
    .filter(name => name.length > 0);
}

function isDash(value: string): boolean {
  return value === '' || value === '—' || value === '–' || value === '-';
}

// ── Card-data helpers ───────────────────────────────────────

/**
 * The staff type implied by a shipped template, per the GDD invariant
 * "`handSlotsAdded > 0` (or an action-point grant) implies management-company
 * staff; business staff always have `handSlotsAdded = 0`".
 */
export function shippedStaffType(template: ConsistencyStaffTemplate): StaffType {
  return template.handSlotsAdded > 0 || (template.actionsPerTurn ?? 0) > 0
    ? 'Management-company'
    : 'Business';
}

interface RoleRow {
  id: string;
  role: string;
  tier: number;
  salary: number;
  benefit: string;
  delta: string;
  tableType: StaffType;
}

/** Parses the `| `staff-id` | Role | Tier | Salary | ... | Benefit | Delta |` rows. */
function parseRoleRows(markdown: string, tableType: StaffType): RoleRow[] {
  const rows: RoleRow[] = [];
  for (const line of markdown.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(cell => cell.trim());
    const id = cells[0]?.match(/^`(staff-[a-z-]+)`$/);
    if (!id) continue;
    rows.push({
      id: id[1],
      role: cells[1] ?? '',
      tier: Number(cells[2]),
      salary: Number(cells[3]),
      benefit: cells[cells.length - 2] ?? '',
      delta: cells[cells.length - 1] ?? '',
      tableType,
    });
  }
  return rows;
}

// ── Individual rules ────────────────────────────────────────

function checkStaleThreeTier(docs: ConsistencyDocs): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];

  const supersession = findSection(docs.gdd, SUPERSESSION_HEADING);
  if (!supersession) {
    violations.push({
      rule: 'stale-three-tier',
      message: `${CONSISTENCY_DOC_PATHS.gdd} has no "Supersession of the old three-tier hand-capacity model" section, so the superseded model is not retired anywhere`,
    });
  } else {
    const supersessionText = [supersession.heading, ...supersession.lines.map(l => l.text)].join('\n');
    if (!/superseded/i.test(supersessionText)) {
      violations.push({
        rule: 'stale-three-tier',
        message: `${CONSISTENCY_DOC_PATHS.gdd}:${supersession.lines[0]?.lineNumber ?? '?'} the supersession section must state that the old model is superseded`,
      });
    }
  }

  for (const key of Object.keys(docs) as ConsistencyDocKey[]) {
    const docPath = CONSISTENCY_DOC_PATHS[key];
    for (const section of sections(docs[key])) {
      const inSupersession = key === 'gdd' && SUPERSESSION_HEADING.test(section.heading);
      if (inSupersession) continue;
      for (const line of section.lines) {
        if (SUPERSESSION_MARKER.test(line.text)) continue;
        for (const { label, pattern } of STALE_THREE_TIER_PATTERNS) {
          if (!pattern.test(line.text)) continue;
          violations.push({
            rule: 'stale-three-tier',
            message: `${docPath}:${line.lineNumber} stale ${label} outside a supersession context: "${line.text.trim().slice(0, 120)}"`,
          });
        }
      }
    }
  }

  return violations;
}

function checkTwoTypeDefinition(docs: ConsistencyDocs): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  const body = appendixText(docs.gdd, /^D\.4\s+Staff System/i);
  if (!body) {
    return [
      {
        rule: 'two-type-definition',
        message: `${CONSISTENCY_DOC_PATHS.gdd} has no "D.4 Staff System" section`,
      },
    ];
  }
  const expectations: ReadonlyArray<{ label: string; pattern: RegExp }> = [
    { label: 'the "Business staff" type name', pattern: /\*\*Business staff\*\*|Business staff\b/ },
    { label: 'the "Management-company staff" type name', pattern: /Management-company staff/ },
    { label: 'an explicit two-type commitment', pattern: /exactly \*\*two types\*\*|exactly two types/i },
    { label: 'a rejection of a third type', pattern: /not a third category|no third type/i },
    { label: 'the runtime determinant (`employedAtSlot`)', pattern: /employedAtSlot/ },
  ];
  for (const { label, pattern } of expectations) {
    if (!pattern.test(body)) {
      violations.push({
        rule: 'two-type-definition',
        message: `${CONSISTENCY_DOC_PATHS.gdd} D.4 must state ${label}`,
      });
    }
  }
  return violations;
}

function checkRoster(
  docs: ConsistencyDocs,
  staffTemplates: ConsistencyStaffTemplate[],
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  const businessRows = parseRoleRows(sectionBody(docs.gdd, /^D\.4\.3\b/), 'Business');
  const managementRows = parseRoleRows(
    sectionBody(docs.gdd, /^D\.4\.4\b/),
    'Management-company',
  );
  const rows = [...businessRows, ...managementRows];
  const templates = new Map(staffTemplates.map(template => [template.id, template]));

  // Coverage: every shipped template exactly once.
  const seen = new Map<string, number>();
  for (const row of rows) seen.set(row.id, (seen.get(row.id) ?? 0) + 1);
  for (const [id, count] of seen) {
    if (count > 1) {
      violations.push({
        rule: 'roster-coverage',
        message: `${CONSISTENCY_DOC_PATHS.gdd} lists ${id} ${count} times across D.4.3/D.4.4 (each staff card belongs to exactly one type)`,
      });
    }
  }
  for (const template of staffTemplates) {
    if (!seen.has(template.id)) {
      violations.push({
        rule: 'roster-coverage',
        message: `${CONSISTENCY_DOC_PATHS.gdd} D.4.3/D.4.4 do not list the shipped staff card ${template.id} (${template.name})`,
      });
    }
  }
  for (const row of rows) {
    const template = templates.get(row.id);
    if (!template) {
      violations.push({
        rule: 'roster-coverage',
        message: `${CONSISTENCY_DOC_PATHS.gdd} lists ${row.id} (${row.role}), which is not a shipped staff card`,
      });
      continue;
    }

    // Type: the table must match the type the shipped card data implies.
    const expectedType = shippedStaffType(template);
    if (row.tableType !== expectedType) {
      violations.push({
        rule: 'roster-type',
        message: `${CONSISTENCY_DOC_PATHS.gdd} lists ${row.id} under ${row.tableType} staff, but its shipped card data implies ${expectedType} staff`,
      });
    }

    // Data: role name, tier and salary must match the shipped card.
    if (row.role !== template.name) {
      violations.push({
        rule: 'roster-data',
        message: `${CONSISTENCY_DOC_PATHS.gdd} calls ${row.id} "${row.role}", but the shipped card name is "${template.name}"`,
      });
    }
    if (template.tier !== undefined && row.tier !== template.tier) {
      violations.push({
        rule: 'roster-data',
        message: `${CONSISTENCY_DOC_PATHS.gdd} gives ${row.id} tier ${row.tier}, but the shipped card tier is ${template.tier}`,
      });
    }
    if (row.salary !== template.ongoingCost) {
      violations.push({
        rule: 'roster-data',
        message: `${CONSISTENCY_DOC_PATHS.gdd} gives ${row.id} a salary of ${row.salary}/turn, but the shipped ongoing cost is ${template.ongoingCost}`,
      });
    }
  }

  // Benefit uniqueness across both types.
  const benefits = new Map<string, RoleRow>();
  for (const row of rows) {
    const key = normaliseBenefit(row.benefit);
    const clash = benefits.get(key);
    if (clash) {
      violations.push({
        rule: 'benefit-uniqueness',
        message: `${CONSISTENCY_DOC_PATHS.gdd} gives ${row.id} (${row.role}) the same benefit as ${clash.id} (${clash.role}): "${row.benefit}"`,
      });
    } else {
      benefits.set(key, row);
    }
  }

  // The re-scoped/re-valued set stated in D.4.7 must equal the delta cells.
  const deltaRoles = new Set(rows.filter(row => !isDash(row.delta)).map(row => row.role));
  const deltaParagraph = sectionBody(docs.gdd, /^D\.4\.7\b/);
  const scopeNames = /scope tightenings for ([^;]+);/i.exec(deltaParagraph)?.[1];
  const valueNames = /value changes for ([^.]+)\./i.exec(deltaParagraph)?.[1];
  const statedDeltas = new Set([
    ...(scopeNames ? splitNameList(scopeNames) : []),
    ...(valueNames ? splitNameList(valueNames) : []),
  ]);
  if (statedDeltas.size === 0) {
    violations.push({
      rule: 'delta-agreement',
      message: `${CONSISTENCY_DOC_PATHS.gdd} D.4.7 must name the re-scoped and re-valued cards`,
    });
  }
  for (const role of deltaRoles) {
    if (!statedDeltas.has(role)) {
      violations.push({
        rule: 'delta-agreement',
        message: `${CONSISTENCY_DOC_PATHS.gdd} D.4.3/D.4.4 mark ${role} as re-scoped/re-valued, but D.4.7 does not name it`,
      });
    }
  }
  for (const role of statedDeltas) {
    if (!deltaRoles.has(role)) {
      violations.push({
        rule: 'delta-agreement',
        message: `${CONSISTENCY_DOC_PATHS.gdd} D.4.7 names ${role} as re-scoped/re-valued, but no role row is marked with a delta`,
      });
    }
  }

  return violations;
}

function checkCounts(
  docs: ConsistencyDocs,
  staffTemplates: ConsistencyStaffTemplate[],
  skillIds: string[],
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  const total = staffTemplates.length;
  const management = staffTemplates.filter(t => shippedStaffType(t) === 'Management-company').length;
  const business = total - management;

  const expectations: ReadonlyArray<{
    label: string;
    pattern: RegExp;
    expected: number;
    group: number;
  }> = [
    { label: 'total staff count', pattern: /(\d+)\s+(?:shipped\s+)?(?:staff|distinct) (?:cards|templates|roles)/gi, expected: total, group: 1 },
    { label: 'management-company staff count', pattern: /(?<![.\d])(\d+)\s+management-company staff/gi, expected: management, group: 1 },
    { label: 'business staff count', pattern: /(?<![.\d])(\d+)\s+business staff/gi, expected: business, group: 1 },
  ];

  for (const key of Object.keys(docs) as ConsistencyDocKey[]) {
    const docPath = CONSISTENCY_DOC_PATHS[key];
    for (const { label, pattern, expected, group } of expectations) {
      for (const match of docs[key].matchAll(pattern)) {
        const stated = Number(match[group]);
        if (stated !== expected) {
          violations.push({
            rule: 'roster-counts',
            message: `${docPath} states a ${label} of ${stated}, but the shipped data has ${expected}`,
          });
        }
      }
    }
    // "N of the M" phrasing about the roster.
    for (const match of docs[key].matchAll(/(\d+) of the (\d+)/g)) {
      if (Number(match[1]) !== business || Number(match[2]) !== total) {
        violations.push({
          rule: 'roster-counts',
          message: `${docPath} states "${match[0]}", but the shipped data has ${business} of ${total} staff cards with no hand-capacity grant`,
        });
      }
    }
    // Specialization-skill count.
    for (const match of docs[key].matchAll(/(\d+)-skill/g)) {
      if (Number(match[1]) !== skillIds.length) {
        violations.push({
          rule: 'skill-count',
          message: `${docPath} states a ${match[1]}-skill catalog, but the shipped catalog has ${skillIds.length} skills`,
        });
      }
    }
  }

  return violations;
}

function checkCrossReferences(
  docs: ConsistencyDocs,
  docsGameDir: string,
): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  const gddAppendixHeadings = new Set(
    sections(docs.gdd)
      .map(section => /^(D\.4(?:\.\d+)?)\b/.exec(section.heading)?.[1])
      .filter((heading): heading is string => Boolean(heading)),
  );

  for (const key of Object.keys(docs) as ConsistencyDocKey[]) {
    const docPath = CONSISTENCY_DOC_PATHS[key];
    const doc = docs[key];

    // Relative markdown links must resolve to a real file.
    for (const link of markdownLinks(doc)) {
      if (/^(?:[a-z]+:)?\/\//i.test(link.target) || link.target.startsWith('#')) continue;
      if (link.target.startsWith('mailto:')) continue;
      const target = link.target.split('#')[0];
      if (!target.endsWith('.md')) continue;
      const resolved = path.resolve(docsGameDir, target);
      if (!fs.existsSync(resolved)) {
        violations.push({
          rule: 'cross-references',
          message: `${docPath}:${link.lineNumber} links to ${link.target}, which does not exist`,
        });
      }
    }

    // Required cross-references must be present (link or plain reference).
    for (const required of REQUIRED_CROSS_REFERENCES[key]) {
      const filename = path.basename(CONSISTENCY_DOC_PATHS[required]);
      if (!doc.includes(filename)) {
        violations.push({
          rule: 'cross-references',
          message: `${docPath} does not reference ${CONSISTENCY_DOC_PATHS[required]}`,
        });
      }
    }

    // Every cited GDD appendix number must exist as a heading.
    for (const match of doc.matchAll(/D\.4(?:\.(\d+))?/g)) {
      const cited = match[1] ? `D.4.${match[1]}` : 'D.4';
      if (!gddAppendixHeadings.has(cited)) {
        violations.push({
          rule: 'cross-references',
          message: `${docPath} cites GDD ${cited}, but ${CONSISTENCY_DOC_PATHS.gdd} has no ${cited} heading`,
        });
      }
    }

    // Every cited `§ *Section title*` naming one of the four docs must exist as
    // a heading in a doc it names (citations of other docs are out of scope).
    for (const [index, line] of doc.split('\n').entries()) {
      const titles = [...line.matchAll(/§\s*\*([^*\n]+)\*/g)].map(match => match[1].trim());
      if (titles.length === 0) continue;
      const named = (Object.keys(DOC_STEMS) as ConsistencyDocKey[]).filter(key =>
        line.includes(DOC_STEMS[key]),
      );
      if (named.length === 0) continue;
      const headings = named.flatMap(key =>
        sections(docs[key]).map(section => section.heading.toLowerCase()),
      );
      for (const title of titles) {
        if (!headings.some(heading => heading.includes(title.toLowerCase()))) {
          violations.push({
            rule: 'cross-references',
            message: `${docPath}:${index + 1} cites § *${title}*, but ${named.map(key => CONSISTENCY_DOC_PATHS[key]).join(' / ')} has no matching heading`,
          });
        }
      }
    }
  }

  return violations;
}

function checkTerminology(docs: ConsistencyDocs): ConsistencyViolation[] {
  const violations: ConsistencyViolation[] = [];
  for (const key of Object.keys(docs) as ConsistencyDocKey[]) {
    const docPath = CONSISTENCY_DOC_PATHS[key];
    const doc = docs[key];
    for (const type of STAFF_TYPES) {
      const label = `${type} staff`;
      if (!new RegExp(label, 'i').test(doc)) {
        violations.push({
          rule: 'terminology',
          message: `${docPath} never uses the staff type name "${label}"`,
        });
      }
    }
    if (/management company staff/i.test(doc)) {
      violations.push({
        rule: 'terminology',
        message: `${docPath} uses "management company staff" without the hyphen (the type name is "management-company staff")`,
      });
    }
  }
  return violations;
}

// ── Entry points ────────────────────────────────────────────

/** Runs every consistency rule and returns the violations (empty when clean). */
export function checkGddStaffConsistency(options: ConsistencyOptions): ConsistencyReport {
  const { docs, staffTemplates, skillIds } = options;
  const docsGameDir = options.docsGameDir ?? path.resolve(process.cwd(), 'docs/game');

  const violations: ConsistencyViolation[] = [
    ...checkStaleThreeTier(docs),
    ...checkTwoTypeDefinition(docs),
    ...checkRoster(docs, staffTemplates),
    ...checkCounts(docs, staffTemplates, skillIds),
    ...checkCrossReferences(docs, docsGameDir),
    ...checkTerminology(docs),
  ];

  const managementCompany = staffTemplates.filter(
    template => shippedStaffType(template) === 'Management-company',
  ).length;

  return {
    ok: violations.length === 0,
    violations,
    summary: {
      staffTotal: staffTemplates.length,
      managementCompany,
      business: staffTemplates.length - managementCompany,
      skills: skillIds.length,
      documentsChecked: Object.values(CONSISTENCY_DOC_PATHS),
      rulesRun: [...RULES],
    },
  };
}

/** Human-readable report (used by the CLI's default mode). */
export function formatGddConsistencyReport(report: ConsistencyReport): string {
  const { summary } = report;
  const header = `GDD staff consistency: ${report.ok ? 'PASS' : `FAIL (${report.violations.length} violation${report.violations.length === 1 ? '' : 's'})`}`;
  const counts = `staff: ${summary.staffTotal} (${summary.managementCompany} management-company, ${summary.business} business); specialization skills: ${summary.skills}`;
  const lines = [header, counts, `documents: ${summary.documentsChecked.join(', ')}`];
  for (const violation of report.violations) {
    lines.push(`  [${violation.rule}] ${violation.message}`);
  }
  return lines.join('\n');
}

/** Machine-readable report (`--json`). */
export function gddConsistencyReportToJson(report: ConsistencyReport): string {
  return JSON.stringify(report, null, 2);
}

/** Reads the four documents from `<projectRoot>/docs/game`. */
export function readConsistencyDocs(projectRoot: string = process.cwd()): ConsistencyDocs {
  const read = (key: ConsistencyDocKey) =>
    fs.readFileSync(path.join(projectRoot, CONSISTENCY_DOC_PATHS[key]), 'utf-8');
  return {
    gdd: read('gdd'),
    cardCatalog: read('cardCatalog'),
    coreRules: read('coreRules'),
    specializationSkills: read('specializationSkills'),
  };
}

/** The shipped staff templates in the checker's structural shape. */
export function shippedConsistencyTemplates(): ConsistencyStaffTemplate[] {
  return getStaffCardTemplates().map(template => {
    const tier = CARD_TIER_MAP.get(template.id);
    return {
      id: template.id,
      name: template.name,
      tier: tier === undefined ? undefined : Number(tier),
      ongoingCost: template.ongoingCost,
      handSlotsAdded: template.handSlotsAdded,
      actionsPerTurn: template.actionsPerTurn,
    };
  });
}

/** Builds the report from the real repository state. */
export function buildGddConsistencyReport(
  projectRoot: string = process.cwd(),
): ConsistencyReport {
  return checkGddStaffConsistency({
    docs: readConsistencyDocs(projectRoot),
    staffTemplates: shippedConsistencyTemplates(),
    skillIds: STAFF_SKILL_CATALOG.map(skill => skill.id),
    docsGameDir: path.join(projectRoot, 'docs/game'),
  });
}

/**
 * CLI entry point: exit code 0 when the documentation is consistent, 1 when a
 * violation is found (so `npm run validate:gdd` is usable in a docs check).
 */
export function runGddConsistencyCli(
  argv: readonly string[] = process.argv.slice(2),
  projectRoot: string = process.cwd(),
): number {
  const rootArg = argv.indexOf('--project-root');
  const root =
    rootArg >= 0 && argv[rootArg + 1] ? path.resolve(argv[rootArg + 1]) : projectRoot;
  const report = buildGddConsistencyReport(root);
  const output = argv.includes('--json')
    ? gddConsistencyReportToJson(report)
    : formatGddConsistencyReport(report);
  console.log(output);
  return report.ok ? 0 : 1;
}
