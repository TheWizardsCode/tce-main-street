/**
 * Storyline documentation drift guard (MS-0MUMP968H005MXZY)
 *
 * **Engine reference headings are not a cross-repo contract**
 * (MS-0MVMNO29Z009SF6O). Dev builds compose the engine *dev tip*
 * (`engine:sync` follows `core` dev), so the Markdown headings of
 * `core/docs/core-engine/story-line.md` are engine prose that can be renamed
 * at any time — the seam section has already moved once
 * (`## Engine adapter` → `## Authoring seams (content, manifest, validator,
 * author)`). Pinning heading text therefore reddens this game's suite for a
 * change the game does not depend on. The AC5b guard instead asserts the
 * *semantic* anchors the game genuinely consumes — the seam API symbols
 * (`createStorylineSystem`, the `@story-line` package), the `GymStorylineScene`
 * consumer, the documented section topics, and the links resolving — and is
 * proven rename-tolerant by a fixture test. Do not re-pin headings here.
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
const DOC_PATH = path.join(PROJECT_ROOT, 'docs/game/storylines.md');
const README_PATH = path.join(PROJECT_ROOT, 'src/README.md');
const CONTENT_DOC_PATH = path.join(PROJECT_ROOT, 'docs/game/content-design-and-progression.md');
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
  acceptNext: string[];
  rejectNext: string[];
}> {
  const rows: ReturnType<typeof parseDocumentedChains> = [];
  for (const line of doc.split('\n')) {
    // Match rows like:
    //   | `evt-tax` | Tax Audit | storyline-tax | — | `evt-tax-inquiry` |
    // or a fan-out cell: | — | `evt-depression, evt-general-strike` |
    const m = line.match(
      /^\|\s*`(evt-[^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(—|[^|]+?)\s*\|\s*(—|[^|]+?)\s*\|/,
    );
    if (!m) continue;
    const unquote = (v: string): string[] => {
      const t = v.trim();
      if (t === '—' || t === '') return [];
      return t
        .replace(/`/g, '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
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
  it('docs/game/storylines.md exists', () => {
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

  it('documents the cost-aware presented-list AI policy (§4)', () => {
    const doc = DOC();
    const start = doc.indexOf('## 4. AI policy');
    const end = doc.indexOf('## 5. Tooling');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const policy = doc.slice(start, end);
    // The AI scores only the draw-time filtered list and projects the core
    // option fields (cost / extraEffect) into its value; pinned by the
    // `cost-aware scoring` cases in MainStreetAiEventChoice.test.ts.
    expect(policy).toContain('presented option list');
    expect(policy).toContain('getPendingStorylineOptions');
    expect(policy).toContain('getStorylineOptions');
    expect(policy).toContain('`cost`');
    expect(policy).toContain('`extraEffect`');
    expect(policy).toContain('REPUTATION_SEVERITY_SCALE');
    expect(policy).toMatch(/lowest\s+index/);
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
      // F6: the doc table lists each option's candidate successor set
      // (Accect/Reject labels); compare against the compiled option model.
      const options = compileStorylineFromEvent(card!).compiledOptions;
      const accept = options.find((o) => o.label === 'Accept')?.successorIds ?? [];
      const reject = options.find((o) => o.label === 'Reject')?.successorIds ?? [];
      expect(accept, `Accept candidates drift for ${row.id}`).toEqual(row.acceptNext);
      expect(reject, `Reject candidates drift for ${row.id}`).toEqual(row.rejectNext);
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
    // Documents says: Accept = option 0, Reject = option 1; every CSV option
    // carries effectPolicy 'apply' (Q4=B).
    const card = getEventTemplates().find((t) => t.id === 'evt-tax-error')!;
    const compiled = compileStorylineFromEvent(card);
    expect(compiled.compiledOptions[0]).toMatchObject({ label: 'Accept', effectPolicy: 'apply' });
    expect(compiled.compiledOptions[1]).toMatchObject({ label: 'Reject', effectPolicy: 'apply' });
  });
});

describe('AC2 — cross-references in README and content-design doc', () => {
  it('src/README.md references the doc, the CSV columns and the scripts', () => {
    const readme = read(README_PATH);
    expect(readme).toContain('docs/game/storylines.md');
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

const CORE_DOC_REF = 'core/docs/core-engine/story-line.md';
const CORE_DOC_PATH = path.join(PROJECT_ROOT, CORE_DOC_REF);

/**
 * Seam-API symbols the game genuinely depends on in the engine reference.
 *
 * These are the contract, not Markdown headings: dev builds compose the engine
 * dev tip, so the engine may rename any heading at any time
 * (MS-0MVMNO29Z009SF6O). Removing any of these anchors is real breakage.
 */
const REQUIRED_CORE_SYMBOLS = ['createStorylineSystem', '@story-line', 'GymStorylineScene'];

/**
 * Section topics the reference must keep documenting. Each is matched as a
 * keyword anywhere in the document (prose as well as headings), so a heading
 * rename is a no-op while dropping a topic entirely still fails the guard.
 */
const REQUIRED_CORE_TOPICS = ['API', 'validation', 'authoring', 'adapter', 'Gym'];

/**
 * Checks the engine's story-line reference against the game-side contract.
 *
 * Heading text is deliberately **not** checked: headings are engine prose, not
 * a cross-repo contract (MS-0MVMNO29Z009SF6O).
 *
 * @param coreDoc - Markdown content of the engine reference (live file or fixture).
 * @param file - Path used in failure messages, so a fixture failure is attributable.
 * @returns One message per missing anchor; `[]` means the contract holds.
 */
function checkCoreReferenceContract(coreDoc: string, file: string = CORE_DOC_REF): string[] {
  const missing: string[] = [];
  for (const symbol of REQUIRED_CORE_SYMBOLS) {
    if (!coreDoc.includes(symbol)) {
      missing.push(`${file}: missing seam-API anchor \`${symbol}\``);
    }
  }
  const lower = coreDoc.toLowerCase();
  for (const topic of REQUIRED_CORE_TOPICS) {
    if (!lower.includes(topic.toLowerCase())) {
      missing.push(`${file}: missing section topic "${topic}"`);
    }
  }
  return missing;
}

/**
 * Simulates an engine-side heading rename by rewriting every Markdown heading.
 *
 * The rename fixture is derived from the live reference rather than committed
 * as a copy, so it can never go stale as the engine's prose evolves.
 */
function renameAllHeadings(doc: string): string {
  let n = 0;
  return doc.replace(/^#{1,6}\s+.*$/gm, () => `## Renamed section ${(n += 1)}`);
}

describe('AC5b — core story-line reference contract (semantic anchors, not headings)', () => {
  it('the core dev reference exists and satisfies the seam-API contract', () => {
    expect(fs.existsSync(CORE_DOC_PATH), `missing ${CORE_DOC_REF}`).toBe(true);
    const missing = checkCoreReferenceContract(read(CORE_DOC_PATH));
    expect(missing, 'core story-line reference no longer documents the seam API').toEqual([]);
  });

  it('tolerates an engine-side rename of every section heading (fixture)', () => {
    const renamedFixture = renameAllHeadings(read(CORE_DOC_PATH));
    // Prove the fixture really exercises the renames this guard used to pin.
    expect(renamedFixture).not.toContain('## Authoring seams');
    expect(renamedFixture).not.toContain('## Engine adapter');
    expect(renamedFixture).toContain('## Renamed section 1');
    expect(
      checkCoreReferenceContract(renamedFixture, 'fixture: renamed headings'),
      'a heading rename must not break the contract check',
    ).toEqual([]);
  });

  it('still fails when a seam-API anchor disappears (negative fixture)', () => {
    const brokenFixture = read(CORE_DOC_PATH).replace(/createStorylineSystem/g, 'renamedFactory');
    expect(checkCoreReferenceContract(brokenFixture, 'fixture: missing symbol')).toEqual([
      'fixture: missing symbol: missing seam-API anchor `createStorylineSystem`',
    ]);
  });

  it('still fails when a documented section topic disappears (negative fixture)', () => {
    const brokenFixture = read(CORE_DOC_PATH).replace(/[Vv]alidation/g, 'scrutiny');
    expect(checkCoreReferenceContract(brokenFixture, 'fixture: missing topic')).toContain(
      'fixture: missing topic: missing section topic "validation"',
    );
  });

  it('the core reference is linked from the core developer docs and the Gym index', () => {
    expect(read(path.join(PROJECT_ROOT, 'core/docs/DEVELOPER.md'))).toContain(
      'core-engine/story-line.md',
    );
    expect(read(path.join(PROJECT_ROOT, 'core/docs/gym/GYM_INDEX.md'))).toContain(
      'core-engine/story-line.md',
    );
  });

  it('the Main Street doc links to the core reference and describes the modules as adapters', () => {
    const doc = DOC();
    expect(doc).toContain(`[\`@story-line\`](../../${CORE_DOC_REF})`);
    expect(doc).toContain('mainStreetStorylineEngineAdapter');
    expect(doc).toContain('mainStreetStorylineUiAdapter');
    expect(doc).toContain('thin adapters');
  });

  it('the core reference link resolves', () => {
    const target = path.resolve(path.dirname(DOC_PATH), `../../${CORE_DOC_REF}`);
    expect(fs.existsSync(target), `broken link to ${CORE_DOC_REF}`).toBe(true);
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
    expect(tax.rejectNext).toEqual(['evt-tax-WRONG']);
    // And that mutated value does NOT match the compiled CSV option model.
    const compiled = compileStorylineFromEvent(byId.get('evt-tax')!);
    const reject = compiled.compiledOptions.find((o) => o.label === 'Reject')?.successorIds ?? [];
    expect(reject).not.toEqual(tax.rejectNext);
  });
});
