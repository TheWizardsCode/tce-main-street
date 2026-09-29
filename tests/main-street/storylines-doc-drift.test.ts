/**
 * Storyline documentation drift guard (MS-0MUMP968H005MXZY)
 *
 * Guards the canonical storyline doc against drift:
 *
 * AC1 — The canonical doc exists and covers every required section.
 * AC2 — `src/README.md` and `content-design-and-progression.md` reference the
 *       doc and list the new CSV columns/scripts.
 * AC3 — The documented chain examples match `src/card-data.csv`.
 * AC4 — An authoring checklist is present.
 * AC5 — The core-engine extraction path / migration notes are documented.
 * AC6 — The roadmap links each deferred work item.
 * AC7 — This test fails when either the doc or the CSV drifts.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getEventTemplates, resetTemplatesToDefault } from '../../src/MainStreetCards';
import { compileStorylineFromEvent } from '../../src/MainStreetStoryline';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DOC_PATH = path.join(PROJECT_ROOT, 'docs/main-street/storylines.md');
const README_PATH = path.join(PROJECT_ROOT, 'src/README.md');
const CONTENT_DOC_PATH = path.join(PROJECT_ROOT, 'docs/main-street/content-design-and-progression.md');
const CSV_PATH = path.join(PROJECT_ROOT, 'src/card-data.csv');

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

const DOC = () => read(DOC_PATH);

/** Parses the documented shipped-graph table (section 7.2). */
function parseDocumentedChains(doc: string): Array<{
  id: string;
  name: string;
  storylineId: string;
  acceptNext: string | null;
  rejectNext: string | null;
}> {
  const rows: ReturnType<typeof parseDocumentedChains> = [];
  for (const line of doc.split('\n')) {
    // Match rows like: | `evt-tax` | Tax Audit | storyline-tax | — | `evt-tax-inquiry` |
    const m = line.match(
      /^\|\s*`(evt-[^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(—|[^|]+?)\s*\|\s*(—|[^|]+?)\s*\|/,
    );
    if (!m) continue;
    const unquote = (v: string): string | null => {
      const t = v.trim();
      if (t === '—' || t === '') return null;
      return t.replace(/`/g, '').trim();
    };
    rows.push({
      id: m[1],
      name: m[2].trim(),
      storylineId: m[3].trim(),
      acceptNext: unquote(m[4]),
      rejectNext: unquote(m[5]),
    });
  }
  return rows;
}

resetTemplatesToDefault();

describe('AC1 — canonical doc exists and covers the required sections', () => {
  it('docs/main-street/storylines.md exists', () => {
    expect(fs.existsSync(DOC_PATH)).toBe(true);
  });

  it('covers concepts, data model, lifecycle, AI, tooling, walkthrough, checklist, extraction and roadmap', () => {
    const doc = DOC();
    const requiredHeadings = [
      '## 1. Concepts',
      '## 2. Data model and CSV columns',
      '## 3. Resolution lifecycle',
      '## 4. AI policy',
      '## 5. Tooling',
      '## 6. Cycles are a first-class shape',
      '## 7. Authoring walkthrough',
      '## 8. Authoring checklist',
      '## 9. Core-engine extraction path',
      '## 10. Roadmap',
    ];
    for (const heading of requiredHeadings) {
      expect(doc, `missing heading ${heading}`).toContain(heading);
    }
  });

  it('documents the five storyline CSV columns', () => {
    const doc = DOC();
    for (const col of ['hasChoices', 'acceptNextCardId', 'rejectNextCardId', 'storylineId', 'storylineTitle']) {
      expect(doc, `missing column ${col}`).toContain(col);
    }
  });

  it('documents undo/redo, save/load and the transcript shape', () => {
    const doc = DOC();
    expect(doc).toContain('Undo/redo');
    expect(doc).toContain('Save/load');
    expect(doc).toContain("type: 'event-choice'");
  });
});

describe('AC3 — documented chains match src/card-data.csv', () => {
  it('every documented row matches the shipped CSV (and vice versa)', () => {
    const documented = parseDocumentedChains(DOC());
    expect(documented.length).toBeGreaterThanOrEqual(7);

    const byId = new Map(getEventTemplates().map((t) => [t.id, t]));
    for (const row of documented) {
      const card = byId.get(row.id);
      expect(card, `documented card ${row.id} missing from CSV`).toBeDefined();
      expect(card!.name, `name drift for ${row.id}`).toBe(row.name);
      expect(card!.storylineId ?? null, `storylineId drift for ${row.id}`).toBe(row.storylineId);
      expect(card!.acceptNextCardId ?? null, `acceptNext drift for ${row.id}`).toBe(row.acceptNext);
      expect(card!.rejectNextCardId ?? null, `rejectNext drift for ${row.id}`).toBe(row.rejectNext);
    }
  });

  it('documents every shipped choice card', () => {
    const documentedIds = new Set(parseDocumentedChains(DOC()).map((r) => r.id));
    const shippedChoiceIds = getEventTemplates()
      .filter((t) => t.id.startsWith('evt-') && Boolean(t.hasChoices))
      .map((t) => t.id);
    expect(shippedChoiceIds.length).toBe(7);
    for (const id of shippedChoiceIds) {
      expect(documentedIds.has(id), `choice card ${id} is not documented`).toBe(true);
    }
  });

  it('the documented storyline ids exist in the CSV', () => {
    const csv = read(CSV_PATH);
    for (const row of parseDocumentedChains(DOC())) {
      expect(csv).toContain(row.storylineId);
    }
  });

  it('the compiled option model matches the documented accept/reject semantics', () => {
    // Documents says: Accept = option 0 (apply), Reject = option 1 (skip).
    const card = getEventTemplates().find((t) => t.id === 'evt-tax-error')!;
    const compiled = compileStorylineFromEvent(card);
    expect(compiled.compiledOptions[0]).toMatchObject({ label: 'Accept', effectPolicy: 'apply' });
    expect(compiled.compiledOptions[1]).toMatchObject({ label: 'Reject', effectPolicy: 'skip' });
  });
});

describe('AC2 — cross-references in README and content-design doc', () => {
  it('src/README.md references the doc, the CSV columns and the scripts', () => {
    const readme = read(README_PATH);
    expect(readme).toContain('docs/main-street/storylines.md');
    expect(readme).toContain('hasChoices');
    expect(readme).toContain('acceptNextCardId');
    expect(readme).toContain('rejectNextCardId');
    expect(readme).toContain('storylineId');
    expect(readme).toContain('storylineTitle');
    expect(readme).toContain('validate:storylines');
    expect(readme).toContain('storylines:graph');
    expect(readme).toContain('storylines:author');
  });

  it('content-design-and-progression.md references the doc and lists the storylines', () => {
    const content = read(CONTENT_DOC_PATH);
    expect(content).toContain('storylines.md');
    expect(content).toContain('storyline-tax');
    expect(content).toContain('storyline-health');
    expect(content).toContain('storyline-economy');
    expect(content).toContain('storyline-labor');
    expect(content).toContain('storyline-restaurant');
  });

  it('every relative markdown link in the canonical doc resolves', () => {
    const doc = DOC();
    const linkRe = /\]\((\.\.?\/[^)#]+)(#[^)]*)?\)/g;
    let m: RegExpExecArray | null;
    let checked = 0;
    while ((m = linkRe.exec(doc)) !== null) {
      const target = path.resolve(path.dirname(DOC_PATH), m[1]);
      expect(fs.existsSync(target), `broken link ${m[1]}`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('AC4 — authoring checklist', () => {
  it('contains a pass/fail checklist for adding a storyline', () => {
    const doc = DOC();
    expect(doc).toContain('## 8. Authoring checklist');
    expect(doc).toMatch(/- \[ \]/); // markdown checkbox
    expect(doc).toContain('validate:storylines');
  });
});

describe('AC5 — core-engine extraction path documented', () => {
  it('documents the seam functions and migration notes', () => {
    const doc = DOC();
    expect(doc).toContain('compileStorylineFromEvent');
    expect(doc).toContain('resolveStorylineOption');
    expect(doc).toContain('pushChainCard');
    expect(doc).toContain('resolveEventOption');
    expect(doc).toContain('Migration notes');
  });
});

describe('AC6 — roadmap links deferred work items', () => {
  it('lists each deferred work item id in the roadmap', () => {
    const doc = DOC();
    for (const id of [
      'MS-0MUNB4ZXQ0081EX7',
      'MS-0MUNB54KU005084C',
      'MS-0MUNB58TK0025CB9',
      'MS-0MUNB5D7K001GH19',
    ]) {
      expect(doc, `roadmap missing ${id}`).toContain(id);
    }
  });

  it('documents the tooling commands that the roadmap ideas build on', () => {
    const doc = DOC();
    for (const cmd of ['validate:storylines', 'storylines:graph', 'storylines:author']) {
      expect(doc).toContain(cmd);
    }
  });
});

describe('AC7 — drift guard fails on drift', () => {
  it('the parser detects a mutated documented link', () => {
    // Mutate the chains-table row specifically (the same id also appears in
    // the §1 storyline table, so a naive global replace would be ambiguous).
    const mutated = DOC().replace(
      /(\|\s*`evt-tax`\s*\|\s*Tax Audit\s*\|[^|]*\|\s*—\s*\|\s*)`evt-tax-inquiry`(\s*\|)/,
      '$1`evt-tax-WRONG`$2',
    );
    const documented = parseDocumentedChains(mutated);
    const byId = new Map(getEventTemplates().map((t) => [t.id, t]));
    const tax = documented.find((r) => r.id === 'evt-tax')!;
    expect(tax.rejectNext).toBe('evt-tax-WRONG');
    // And that mutated value does NOT match the CSV.
    expect(byId.get('evt-tax')!.rejectNextCardId).not.toBe(tax.rejectNext);
  });
});
