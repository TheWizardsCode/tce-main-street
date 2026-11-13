/**
 * GDD staff consistency verification (MS-0MW2XKTR50062OFL, parent AC1/AC2).
 *
 * The GDD's Staff System (Appendix D.4) commits to exactly two staff types —
 * **business staff** and **management-company staff** — and the surrounding
 * design docs (`card-catalog.md`, `core-rules-and-mechanics.md`,
 * `specialization-skills.md`) must agree with that model. This suite is the
 * automated consistency check:
 *
 *  - AC1: the superseded three-tier hand-capacity model may appear only in a
 *    supersession context, and the checker detects it when it is reintroduced.
 *  - AC2: cross-references between the four docs resolve (links, cited GDD
 *    appendix numbers and cited section titles) and the stated roster counts,
 *    types, tiers, salaries and benefits agree with the shipped card data.
 *  - AC4: the same checks run as a standalone documentation check
 *    (`npm run validate:gdd`, exercised through its CLI exit codes here) as
 *    well as inside the unit suite.
 *
 * Every negative case mutates an in-memory copy of the documents and asserts
 * the specific violation rule, so the checker cannot silently stop detecting
 * drift.
 *
 * @module
 */
import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  CONSISTENCY_DOC_PATHS,
  checkGddStaffConsistency,
  formatGddConsistencyReport,
  gddConsistencyReportToJson,
  readConsistencyDocs,
  runGddConsistencyCli,
  shippedConsistencyTemplates,
  type ConsistencyDocKey,
  type ConsistencyDocs,
  type ConsistencyReport,
} from '../../src/scripts/gdd-staff-consistency';
import { STAFF_SKILL_CATALOG } from '../../src/MainStreetStaffSkills';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DOCS_GAME_DIR = path.join(PROJECT_ROOT, 'docs/game');

function run(docs: ConsistencyDocs = readConsistencyDocs(PROJECT_ROOT)): ConsistencyReport {
  return checkGddStaffConsistency({
    docs,
    staffTemplates: shippedConsistencyTemplates(),
    skillIds: STAFF_SKILL_CATALOG.map(skill => skill.id),
    docsGameDir: DOCS_GAME_DIR,
  });
}

function ruleNames(report: ConsistencyReport): string[] {
  return report.violations.map(violation => violation.rule);
}

/** Asserts the report carries `rule`, optionally with a message fragment. */
function expectViolation(report: ConsistencyReport, rule: string, fragment?: string): void {
  const match = report.violations.find(
    violation =>
      violation.rule === rule && (fragment === undefined || violation.message.includes(fragment)),
  );
  expect(
    match,
    `expected a ${rule} violation${fragment ? ` mentioning "${fragment}"` : ''}, got: ${JSON.stringify(report.violations, null, 2)}`,
  ).toBeDefined();
}

/** Inserts `text` immediately before the first occurrence of `heading`. */
function injectBefore(doc: string, heading: string, text: string): string {
  const index = doc.indexOf(heading);
  if (index < 0) throw new Error(`fixture heading not found: ${heading}`);
  return `${doc.slice(0, index)}${text}\n\n${doc.slice(index)}`;
}

describe('GDD staff consistency — shipped documentation', () => {
  it('reports no violations for the shipped docs and card data', () => {
    const report = run();
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('summarises the roster split and skill count from the shipped data', () => {
    const report = run();
    const staff = shippedConsistencyTemplates();
    expect(report.summary.staffTotal).toBe(staff.length);
    expect(report.summary.managementCompany + report.summary.business).toBe(staff.length);
    expect(report.summary.managementCompany).toBe(
      staff.filter(t => t.handSlotsAdded > 0 || (t.actionsPerTurn ?? 0) > 0).length,
    );
    expect(report.summary.skills).toBe(STAFF_SKILL_CATALOG.length);
  });

  it('renders a PASS report in both human and JSON form', () => {
    const report = run();
    const human = formatGddConsistencyReport(report);
    expect(human).toContain('GDD staff consistency: PASS');
    expect(human).toContain(`${report.summary.staffTotal} (${report.summary.managementCompany} management-company, ${report.summary.business} business)`);

    const parsed = JSON.parse(gddConsistencyReportToJson(report));
    expect(parsed.ok).toBe(true);
    expect(parsed.violations).toEqual([]);
    expect(parsed.summary.documentsChecked).toEqual(Object.values(CONSISTENCY_DOC_PATHS));
  });
});

describe('GDD staff consistency — stale three-tier detection (AC1)', () => {
  it('flags a three-tier statement reintroduced outside the supersession section', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.gdd = injectBefore(
      docs.gdd,
      '#### D.4.5 Expected gameplay outcomes',
      'Staff are bought in three hand-capacity tiers: Assistant, Manager and Director.',
    );
    const report = run(docs);
    expect(report.ok).toBe(false);
    expectViolation(report, 'stale-three-tier', 'hand-capacity tiers');
  });

  it('accepts a three-tier mention that explicitly marks the model superseded', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.gdd = injectBefore(
      docs.gdd,
      '#### D.4.5 Expected gameplay outcomes',
      'This appendix replaces the three-tier hand-capacity model, superseding it with two staff types.',
    );
    expect(ruleNames(run(docs))).not.toContain('stale-three-tier');
  });

  it('flags a missing supersession section', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.gdd = docs.gdd.replace(
      '#### D.4.6 Supersession of the old three-tier hand-capacity model',
      '#### D.4.6 Retired model',
    );
    const report = run(docs);
    expectViolation(report, 'stale-three-tier', 'no "Supersession of the old three-tier hand-capacity model" section');
  });

  it('flags the old model reintroduced in a sibling document', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.cardCatalog = injectBefore(
      docs.cardCatalog,
      '## Staff Cards',
      'Staff expand hand capacity in three tiers.',
    );
    expectViolation(run(docs), 'stale-three-tier', 'card-catalog.md');
  });
});

describe('GDD staff consistency — roster agreement (AC2)', () => {
  it('flags a shipped staff card missing from the GDD roster', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.gdd = docs.gdd.replace(/^\| `staff-investor`.*$/m, '');
    expectViolation(run(docs), 'roster-coverage', 'staff-investor');
  });

  it('flags a card listed under the wrong staff type', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    const baristaRow = /^\| `staff-barista`.*$/m.exec(docs.gdd)?.[0];
    expect(baristaRow, 'fixture must contain the Barista row').toBeTruthy();
    docs.gdd = injectBefore(
      docs.gdd.replace(/^\| `staff-barista`.*$/m, ''),
      '#### D.4.5 Expected gameplay outcomes',
      baristaRow!,
    );
    expectViolation(run(docs), 'roster-type', 'staff-barista');
  });

  it('flags a role row whose salary contradicts the shipped card', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.gdd = docs.gdd.replace(
      '| `staff-chef` | Chef | 3 | 100 |',
      '| `staff-chef` | Chef | 3 | 120 |',
    );
    expectViolation(run(docs), 'roster-data', 'staff-chef');
  });

  it('flags two roles that state the same benefit', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.gdd = docs.gdd.replace(
      '**+20% coin income** to **its own business** (applied after synergy and after the duplicate-business market-saturation reduction)',
      '**+20 coins/turn** to **each adjacent Food business** (flat synergy coin)',
    );
    expectViolation(run(docs), 'benefit-uniqueness');
  });

  it('flags a re-scoped card that D.4.7 no longer names', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.gdd = docs.gdd.replace(
      'value changes for Assistant, Executive, Baker and Event Planner',
      'value changes for Assistant, Executive and Baker',
    );
    expectViolation(run(docs), 'delta-agreement', 'Event Planner');
  });
});

describe('GDD staff consistency — stated counts (AC2)', () => {
  it('flags a per-type count that contradicts the shipped data', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.gdd = docs.gdd.replace('**9 management-company staff**', '**10 management-company staff**');
    expectViolation(run(docs), 'roster-counts', 'management-company staff count');
  });

  it('flags a stated roster total that contradicts the shipped data', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.gdd = docs.gdd.replace('remap of the 26 staff templates', 'remap of the 27 staff templates');
    expectViolation(run(docs), 'roster-counts', 'total staff count');
  });

  it('flags a stated specialization-skill count that contradicts the catalog', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.gdd = docs.gdd.replace('the 16-skill classification', 'the 15-skill classification');
    expectViolation(run(docs), 'skill-count');
  });
});

describe('GDD staff consistency — cross-references (AC2)', () => {
  it('flags a relative link whose target does not exist', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.gdd = docs.gdd.replace(
      '[specialization-skills.md](specialization-skills.md)',
      '[specialization-skills.md](specialization-skills-renamed.md)',
    );
    expectViolation(run(docs), 'cross-references', 'specialization-skills-renamed.md');
  });

  it('flags a citation of a non-existent GDD appendix number', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.coreRules = docs.coreRules.replace('D.4.3/D.4.8', 'D.4.3/D.4.9');
    expectViolation(run(docs), 'cross-references', 'D.4.9');
  });

  it('flags a dropped cross-reference between the docs', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.gdd = docs.gdd.replaceAll('specialization-skills.md', 'staff-skills.md');
    expectViolation(run(docs), 'cross-references', 'does not reference');
  });
});

describe('GDD staff consistency — terminology (AC2)', () => {
  it('flags the un-hyphenated type name', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    docs.cardCatalog = docs.cardCatalog.replace(
      '- **Management-company staff** —',
      '- **Management company staff** —',
    );
    expectViolation(run(docs), 'terminology', 'without the hyphen');
  });
});

describe('GDD staff consistency — audit-gap pins (MS-0MW20VBSZ003A01O closure)', () => {
  it('D.4.4 states the shipped +1 hand slot for Socialite, Accountant and Lookout', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    const d44 = docs.gdd.slice(docs.gdd.indexOf('#### D.4.4'), docs.gdd.indexOf('#### D.4.5'));
    for (const id of ['staff-socialite', 'staff-accountant', 'staff-lookout']) {
      const row = d44.split('\n').find(line => line.includes(`\`${id}\``));
      expect(row, `${id} row must exist in D.4.4`).toBeDefined();
      expect(row!, `${id} D.4.4 benefit must state the shipped +1 hand slot (delta is unchanged)`).toContain('+1 hand slot');
    }
  });

  it('Chef is marked re-scoped in D.4.3 and named in the D.4.7 scope tightenings', () => {
    const docs = readConsistencyDocs(PROJECT_ROOT);
    const chefRow = docs.gdd.split('\n').find(line => line.includes('`staff-chef`'));
    expect(chefRow, 'Chef row must exist in D.4.3').toBeDefined();
    expect(chefRow!, 'Chef delta must note the scope tightening (was "nearby Food businesses")').not.toMatch(/\| — \|$/);
    const d47 = docs.gdd.slice(docs.gdd.indexOf('#### D.4.7'));
    expect(d47).toMatch(/scope tightenings for [^;]*Chef/);
  });
});

describe('GDD staff consistency — standalone documentation check (AC4)', () => {
  it('CLI exits 0 and prints the JSON report for consistent docs', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(runGddConsistencyCli(['--json'], PROJECT_ROOT)).toBe(0);
      const payload = JSON.parse(log.mock.calls[0][0] as string);
      expect(payload.ok).toBe(true);
      expect(payload.summary.staffTotal).toBe(shippedConsistencyTemplates().length);
    } finally {
      log.mockRestore();
    }
  });

  it('CLI exits 1 when a document contradicts the two-type model', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gdd-consistency-'));
    try {
      const docs = readConsistencyDocs(PROJECT_ROOT);
      for (const key of Object.keys(CONSISTENCY_DOC_PATHS) as ConsistencyDocKey[]) {
        const target = path.join(root, CONSISTENCY_DOC_PATHS[key]);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const contents =
          key === 'gdd'
            ? injectBefore(
                docs[key],
                '#### D.4.5 Expected gameplay outcomes',
                'Staff come in three hand-capacity tiers.',
              )
            : docs[key];
        fs.writeFileSync(target, contents);
      }

      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        expect(runGddConsistencyCli(['--json', '--project-root', root])).toBe(1);
        const payload = JSON.parse(log.mock.calls[0][0] as string);
        expect(payload.ok).toBe(false);
        expect(
          payload.violations.some((violation: { rule: string }) => violation.rule === 'stale-three-tier'),
        ).toBe(true);
      } finally {
        log.mockRestore();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
