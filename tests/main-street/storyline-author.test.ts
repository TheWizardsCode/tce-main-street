/**
 * Storyline authoring helper CLI (MS-0MUMP95IW002ARWJ)
 *
 * AC1 — Authoring commands: add a card and/or link a storyline safely (correct
 *       columns, no duplicate id); refuse invalid input with a clear message.
 * AC2 — Self-validating: the command runs the C3 validator after editing and
 *       fails (non-zero exit, no partial write) when the result is invalid.
 * AC3 — Tests exercise the add/link workflow against fixture CSVs and assert
 *       the resulting CSV plus a passing validation.
 *
 * @module
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  parseCsv,
  serializeCsv,
  addCard,
  linkCard,
  applyToFile,
  parseAuthorArgs,
  type AddCardSpec,
} from '../../src/scripts/storyline-author';
import { loadTemplatesFromCsv, getEventTemplates, resetTemplatesToDefault } from '../../src/MainStreetCards';
import { validateStorylines } from '../../src/scripts/validate-storylines';
import { resetStorylineRegistry } from '../../src/MainStreetStoryline';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const VITE_NODE_BIN = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'vite-node');
const AUTHOR_CLI = 'src/scripts/storyline-author-cli.ts';

// ── Fixtures ────────────────────────────────────────────────

/** A minimal valid fixture CSV: one plain card + one two-link choice card. */
const FIXTURE_CSV = [
  'family,id,name,cost,baseIncome,synergyTypes,upgradePath,maxLevel,reputationPerTurn,synergyCoinBonus,synergyRepBonus,description,tier,trigger,effect,target,targetSynergy,coinDelta,reputationDelta,duration,effectType,multiplier,targetBusiness,incomeBonus,synergyRangeBonus,requiredLevel,reputationBonus,newDisplayName,ongoingCost,handSlotsAdded,refreshCostDiscount,actionsPerTurn,peekOncePerTurn,upgradeCostDiscount,art_notes,hasChoices,acceptNextCardId,rejectNextCardId,storylineId,storylineTitle',
  'event,evt-fx-a,Fixture A,0,,,,,,,,,1,Incident,Lose 100 coins,All,,-100,0,,,,,,,,,,,,,,,,A test,true,evt-fx-b,evt-fx-c,storyline-fx,Fixture Arc',
  'event,evt-fx-b,Fixture B,0,,,,,,,,,1,Incident,Lose 50 coins,All,,-50,0,,,,,,,,,,,,,,,,B test,,,,storyline-fx,Fixture Arc',
  'event,evt-fx-c,Fixture C,0,,,,,,,,,1,Incident,Gain 25 coins,All,,25,0,,,,,,,,,,,,,,,,C test,,,,storyline-fx,Fixture Arc',
].join('\n') + '\n';

function makeSpec(overrides: Partial<AddCardSpec> = {}): AddCardSpec {
  return {
    id: 'evt-fx-new',
    name: 'New Card',
    effect: 'Lose 10 coins',
    coinDelta: -10,
    ...overrides,
  };
}

/** Loads a CSV string through the model and returns the validation result. */
function validate(csv: string) {
  loadTemplatesFromCsv(csv);
  return validateStorylines(getEventTemplates());
}

afterEach(() => {
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

// ── AC3: CSV round-trip ─────────────────────────────────────

describe('AC3 — CSV parse/serialise round-trip', () => {
  it('is lossless for the fixture', () => {
    expect(serializeCsv(parseCsv(FIXTURE_CSV))).toBe(FIXTURE_CSV);
  });

  it('preserves quoted fields containing commas', () => {
    const csv = 'a,b,c\n1,"x, y",3\n';
    const parsed = parseCsv(csv);
    expect(parsed.rows[0]).toEqual(['1', 'x, y', '3']);
    expect(serializeCsv(parsed)).toBe(csv);
  });

  it('escapes fields that need quoting', () => {
    const csv = 'a,b,c\n1,"has ""quotes""",3\n';
    const parsed = parseCsv(csv);
    expect(parsed.rows[0][1]).toBe('has "quotes"');
    expect(serializeCsv(parsed)).toBe(csv);
  });
});

// ── AC1: add-card ───────────────────────────────────────────

describe('AC1 — add-card', () => {
  it('appends a valid card with the correct column count', () => {
    const result = addCard(FIXTURE_CSV, makeSpec());
    expect(result.ok, result.errors.join('; ')).toBe(true);

    const parsed = parseCsv(result.csv);
    const row = parsed.rows.find((r) => r[parsed.header.indexOf('id')] === 'evt-fx-new');
    expect(row).toBeDefined();
    expect(row!.length).toBe(parsed.header.length); // aligned to the header
    expect(row![parsed.header.indexOf('name')]).toBe('New Card');
    expect(row![parsed.header.indexOf('coinDelta')]).toBe('-10');
    expect(row![parsed.header.indexOf('family')]).toBe('event');
  });

  it('the resulting CSV validates', () => {
    const result = addCard(FIXTURE_CSV, makeSpec());
    expect(validate(result.csv).valid).toBe(true);
  });

  it('refuses a duplicate id', () => {
    const result = addCard(FIXTURE_CSV, makeSpec({ id: 'evt-fx-a' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('duplicate id');
    expect(result.csv).toBe(FIXTURE_CSV); // untouched
  });

  it('refuses a missing id / name / effect with clear messages', () => {
    for (const spec of [makeSpec({ id: '' }), makeSpec({ name: '' }), makeSpec({ effect: '' })]) {
      const result = addCard(FIXTURE_CSV, spec);
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('can add a choice card with links and storyline metadata', () => {
    const result = addCard(FIXTURE_CSV, makeSpec({
      id: 'evt-fx-choice',
      hasChoices: true,
      acceptNextCardId: 'evt-fx-b',
      rejectNextCardId: 'evt-fx-c',
      storylineId: 'storyline-fx',
      storylineTitle: 'Fixture Arc',
    }));
    expect(result.ok, result.errors.join('; ')).toBe(true);
    expect(validate(result.csv).valid).toBe(true);
  });
});

// ── AC1: link ───────────────────────────────────────────────

describe('AC1 — link', () => {
  it('sets accept/reject links and marks the card as a choice', () => {
    // First add an unlinked card, then link it.
    const added = addCard(FIXTURE_CSV, makeSpec({ id: 'evt-fx-link' }));
    expect(added.ok).toBe(true);

    const linked = linkCard(added.csv, {
      id: 'evt-fx-link',
      acceptNextCardId: 'evt-fx-b',
      rejectNextCardId: 'evt-fx-c',
    });
    expect(linked.ok, linked.errors.join('; ')).toBe(true);

    const parsed = parseCsv(linked.csv);
    const row = parsed.rows.find((r) => r[parsed.header.indexOf('id')] === 'evt-fx-link')!;
    expect(row[parsed.header.indexOf('hasChoices')]).toBe('true');
    expect(row[parsed.header.indexOf('acceptNextCardId')]).toBe('evt-fx-b');
    expect(row[parsed.header.indexOf('rejectNextCardId')]).toBe('evt-fx-c');
    expect(validate(linked.csv).valid).toBe(true);
  });

  it('sets storyline metadata on an existing card', () => {
    const result = linkCard(FIXTURE_CSV, {
      id: 'evt-fx-b',
      storylineId: 'storyline-fx',
      storylineTitle: 'Fixture Arc',
    });
    expect(result.ok).toBe(true);
    const parsed = parseCsv(result.csv);
    const row = parsed.rows.find((r) => r[parsed.header.indexOf('id')] === 'evt-fx-b')!;
    expect(row[parsed.header.indexOf('storylineId')]).toBe('storyline-fx');
  });

  it('refuses an unknown card id', () => {
    const result = linkCard(FIXTURE_CSV, { id: 'evt-nope', acceptNextCardId: 'evt-fx-b' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('not found');
    expect(result.csv).toBe(FIXTURE_CSV);
  });

  it('refuses a link target that does not exist', () => {
    const result = linkCard(FIXTURE_CSV, { id: 'evt-fx-b', acceptNextCardId: 'evt-missing' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('does not exist');
    expect(result.csv).toBe(FIXTURE_CSV);
  });
});

// ── AC2: self-validating / transactional ────────────────────

describe('AC2 — self-validating, no partial write', () => {
  it('refuses an add that introduces a dangling link', () => {
    const result = addCard(FIXTURE_CSV, makeSpec({
      id: 'evt-fx-bad',
      hasChoices: true,
      acceptNextCardId: 'evt-nowhere',
    }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('evt-nowhere');
    expect(result.csv).toBe(FIXTURE_CSV); // unchanged
  });

  it('applyToFile leaves the file untouched on validation failure', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tce-author-'));
    try {
      const file = path.join(dir, 'fixture.csv');
      fs.writeFileSync(file, FIXTURE_CSV, 'utf-8');

      const result = applyToFile(file, (csv) =>
        addCard(csv, makeSpec({ id: 'evt-fx-bad', hasChoices: true, acceptNextCardId: 'evt-nowhere' })),
      );

      expect(result.ok).toBe(false);
      expect(fs.readFileSync(file, 'utf-8')).toBe(FIXTURE_CSV);
      // No temp file left behind.
      expect(fs.readdirSync(dir)).toEqual(['fixture.csv']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applyToFile writes the valid result atomically', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tce-author-'));
    try {
      const file = path.join(dir, 'fixture.csv');
      fs.writeFileSync(file, FIXTURE_CSV, 'utf-8');

      const result = applyToFile(file, (csv) => addCard(csv, makeSpec({ id: 'evt-fx-ok' })));
      expect(result.ok, result.errors.join('; ')).toBe(true);
      expect(fs.readFileSync(file, 'utf-8')).toBe(result.csv);
      expect(fs.readdirSync(dir)).toEqual(['fixture.csv']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parseAuthorArgs understands add-card and link', () => {
    const add = parseAuthorArgs(['add-card', '--id', 'x', '--name', 'X', '--effect', 'e']);
    expect('error' in add).toBe(false);
    if (!('error' in add)) {
      expect(add.command).toBe('add-card');
      expect((add.spec as AddCardSpec).id).toBe('x');
    }
    const link = parseAuthorArgs(['link', '--id', 'x', '--accept-next', 'y']);
    expect('error' in link).toBe(false);
    if (!('error' in link)) expect(link.command).toBe('link');
    expect(parseAuthorArgs(['bogus'])).toHaveProperty('error');
  });
});

// ── AC1 + AC2: CLI end-to-end ───────────────────────────────

// Each test spawns a cold `vite-node` CLI subprocess (1–3 s each, sometimes
// slower under the 4-worker full-suite load). The 15 s global test timeout is
// too tight for these subprocess integration tests and produced spurious
// timeouts (MS-0MUPKEWEC005U2XV), so this suite gets a longer budget. The
// spawnSync call still hard-kills the child at 180 s.
describe('AC1/AC2 — authoring CLI via vite-node (fixture file)', { timeout: 60_000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tce-author-cli-'));

  function writeFixture(name: string): string {
    const p = path.join(dir, name);
    fs.writeFileSync(p, FIXTURE_CSV, 'utf-8');
    return p;
  }

  function runAuthor(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    const res = spawnSync(VITE_NODE_BIN, [AUTHOR_CLI, ...args], {
      cwd: PROJECT_ROOT,
      encoding: 'utf-8',
      timeout: 180_000,
      killSignal: 'SIGKILL',
      env: { ...process.env },
    });
    return {
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
      exitCode: res.status ?? (res.signal ? 1 : 0),
    };
  }

  it('add-card writes a valid card to a fixture file', () => {
    const file = writeFixture('add.csv');
    const res = runAuthor(['add-card', '--id', 'evt-cli-new', '--name', 'CLI New', '--effect', 'Lose 5 coins', '--coin-delta', '-5', '--csv', file]);
    expect(res.exitCode).toBe(0);
    const after = fs.readFileSync(file, 'utf-8');
    expect(after).toContain('evt-cli-new');
    expect(validate(after).valid).toBe(true);
  });

  it('link writes links to a fixture file and validates', () => {
    const file = writeFixture('link.csv');
    // Add then link.
    runAuthor(['add-card', '--id', 'evt-cli-link', '--name', 'CLI Link', '--effect', 'Lose 5 coins', '--csv', file]);
    const res = runAuthor(['link', '--id', 'evt-cli-link', '--accept-next', 'evt-fx-b', '--reject-next', 'evt-fx-c', '--csv', file]);
    expect(res.exitCode).toBe(0);
    const after = fs.readFileSync(file, 'utf-8');
    expect(after).toContain('evt-cli-link');
    expect(validate(after).valid).toBe(true);
  });

  it('refuses an invalid add (dangling link) with non-zero exit and no write', () => {
    const file = writeFixture('invalid.csv');
    const before = fs.readFileSync(file, 'utf-8');
    const res = runAuthor([
      'add-card', '--id', 'evt-cli-bad', '--name', 'Bad', '--effect', 'Lose 5 coins',
      '--has-choices', '--accept-next', 'evt-nowhere', '--csv', file,
    ]);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain('evt-nowhere');
    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
  });

  it('refuses a duplicate id with non-zero exit', () => {
    const file = writeFixture('dup.csv');
    const res = runAuthor(['add-card', '--id', 'evt-fx-a', '--name', 'Dup', '--effect', 'x', '--csv', file]);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain('duplicate id');
  });

  it('dry-run validates without writing', () => {
    const file = writeFixture('dry.csv');
    const before = fs.readFileSync(file, 'utf-8');
    const res = runAuthor(['add-card', '--id', 'evt-cli-dry', '--name', 'Dry', '--effect', 'x', '--csv', file, '--dry-run']);
    expect(res.exitCode).toBe(0);
    expect(fs.readFileSync(file, 'utf-8')).toBe(before);
  });
});
