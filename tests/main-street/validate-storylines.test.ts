/**
 * Storyline static validator (MS-0MUMP944B009PEO6)
 *
 * Tests for the pure validation core, the cycle policy, and the CLI exit
 * codes (AC1–AC5).
 *
 * AC1 — Validator CLI: exits 0 for the shipped CSV, non-zero for broken
 *       fixtures (dangling link, unknown target, duplicate id).
 * AC2 — Uses the model: validation reads the typed parser/model, not a
 *       hand-rolled CSV parse (asserted by feeding CSV text through the
 *       model loader and validating the parsed templates).
 * AC3 — Fixture tests: valid fixture + at least one broken fixture per
 *       failure class.
 * AC4 — Cycle policy: the shipped tax cycle is informational, not a failure;
 *       an unintentional cycle is surfaced in the same report.
 * AC5 — Suite gate: the shipped storylines are valid (asserted in-process so
 *       the unit project fails whenever they break).
 *
 * @module
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  validateStorylines,
  findCycles,
  formatStorylineReport,
  storylineReportToJson,
  type StorylineValidationResult,
} from '../../src/scripts/validate-storylines';
import { getEventTemplates, loadTemplatesFromCsv, resetTemplatesToDefault } from '../../src/MainStreetCards';
import type { EventCard, StorylineOption } from '../../src/MainStreetCardsTypes';
import { resetStorylineRegistry } from '../../src/MainStreetStoryline';

// ── Fixture helpers ─────────────────────────────────────────

/** Column order for the synthetic CSV fixtures (must match the parser). */
const CSV_COLUMNS = [
  'family', 'id', 'name', 'cost', 'baseIncome', 'synergyTypes', 'upgradePath',
  'maxLevel', 'reputationPerTurn', 'synergyCoinBonus', 'synergyRepBonus',
  'description', 'tier', 'trigger', 'effect', 'target', 'targetSynergy',
  'coinDelta', 'reputationDelta', 'duration', 'effectType', 'multiplier',
  'targetBusiness', 'incomeBonus', 'synergyRangeBonus', 'requiredLevel',
  'reputationBonus', 'newDisplayName', 'ongoingCost', 'handSlotsAdded',
  'refreshCostDiscount', 'actionsPerTurn', 'peekOncePerTurn',
  'upgradeCostDiscount', 'art_notes', 'hasChoices', 'acceptNextCardId',
  'rejectNextCardId', 'storylineId', 'storylineTitle',
];

interface CsvEventSpec {
  id: string;
  name?: string;
  effect?: string;
  coinDelta?: number;
  hasChoices?: boolean;
  acceptNextCardId?: string;
  rejectNextCardId?: string;
  storylineId?: string;
  storylineTitle?: string;
}

/** Builds a well-formed synthetic event CSV from a compact spec list. */
function buildCsv(events: CsvEventSpec[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const e of events) {
    const row: Record<string, string> = {
      family: 'event',
      id: e.id,
      name: e.name ?? e.id,
      cost: '0',
      tier: '1',
      trigger: 'Incident',
      effect: e.effect ?? 'Test incident',
      target: 'All',
      coinDelta: String(e.coinDelta ?? -10),
      reputationDelta: '0',
    };
    if (e.hasChoices) row.hasChoices = 'true';
    if (e.acceptNextCardId) row.acceptNextCardId = e.acceptNextCardId;
    if (e.rejectNextCardId) row.rejectNextCardId = e.rejectNextCardId;
    if (e.storylineId) row.storylineId = e.storylineId;
    if (e.storylineTitle) row.storylineTitle = e.storylineTitle;
    lines.push(CSV_COLUMNS.map((c) => row[c] ?? '').join(','));
  }
  return lines.join('\n');
}

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const VITE_NODE_BIN = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'vite-node');
const VALIDATOR = 'src/scripts/validate-storylines-cli.ts';

function makeEvent(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event',
    id: 'evt-x',
    name: 'X',
    trigger: 'Incident',
    cost: 0,
    effect: 'x',
    target: 'All',
    coinDelta: -10,
    reputationDelta: 0,
    ...overrides,
  } as EventCard;
}

/** Runs the real CLI as a subprocess and returns stdout/exit code. */
function runValidatorCli(args: string[], timeoutMs = 180_000): { stdout: string; stderr: string; exitCode: number } {
  const res = spawnSync(VITE_NODE_BIN, [VALIDATOR, ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    env: { ...process.env },
  });
  return {
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    exitCode: res.status ?? (res.signal ? 1 : 0),
  };
}

afterEach(() => {
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

// ── AC1 + AC3: pure validation over fixtures ────────────────

describe('AC3 — valid fixture passes', () => {
  it('a well-formed two-option chain validates with no issues', () => {
    const cards = [
      makeEvent({ id: 'evt-a', hasChoices: true, acceptNextCardId: 'evt-b', rejectNextCardId: null }),
      makeEvent({ id: 'evt-b' }),
    ];
    const result = validateStorylines(cards);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.choiceCardCount).toBe(1);
  });

  it('a choice card with both successor paths present validates', () => {
    const cards = [
      makeEvent({ id: 'evt-a', hasChoices: true, acceptNextCardId: 'evt-b', rejectNextCardId: 'evt-c' }),
      makeEvent({ id: 'evt-b' }),
      makeEvent({ id: 'evt-c' }),
    ];
    expect(validateStorylines(cards).valid).toBe(true);
  });
});

describe('AC3 — dangling link fails', () => {
  it('a choice card linking to a missing accept card is invalid', () => {
    const cards = [makeEvent({ id: 'evt-a', hasChoices: true, acceptNextCardId: 'evt-missing' })];
    const result = validateStorylines(cards);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.kind === 'dangling-link');
    expect(issue).toBeDefined();
    expect(issue!.cardId).toBe('evt-a');
    expect(issue!.target).toBe('evt-missing');
    expect(issue!.message).toContain('evt-missing');
  });

  it('a choice card linking to a missing reject card is invalid', () => {
    const cards = [makeEvent({ id: 'evt-a', hasChoices: true, rejectNextCardId: 'evt-missing' })];
    const result = validateStorylines(cards);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.kind === 'dangling-link' && i.target === 'evt-missing')).toBe(true);
  });

  it('an invalid option-list successor is flagged as a dangling link', () => {
    const cards = [makeEvent({ id: 'evt-a', hasChoices: true })];
    const opts: StorylineOption[] = [
      { label: 'Go', successorId: 'evt-nope', effectPolicy: 'apply' },
    ];
    const result = validateStorylines(cards, { getOptions: () => opts });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.kind === 'dangling-link')).toBe(true);
  });
});

describe('AC3 — unknown target fails', () => {
  it('a registered successor that does not exist fails validation', () => {
    const cards = [makeEvent({ id: 'evt-a', hasChoices: true })];
    const opts: StorylineOption[] = [
      { label: 'Accept', successorId: 'evt-ghost', effectPolicy: 'apply' },
    ];
    const result = validateStorylines(cards, { getOptions: () => opts });
    expect(result.valid).toBe(false);
    expect(result.issues.find((i) => i.target === 'evt-ghost')).toBeDefined();
  });
});

describe('AC3 — duplicate id fails', () => {
  it('two cards sharing an id are invalid', () => {
    const cards = [makeEvent({ id: 'evt-dup' }), makeEvent({ id: 'evt-dup' })];
    const result = validateStorylines(cards);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.kind === 'duplicate-id');
    expect(issue).toBeDefined();
    expect(issue!.cardId).toBe('evt-dup');
  });

  it('instance-serial ids collapse to the same base and are not duplicates', () => {
    // evt-a-0 and evt-a-1 are instances of the same template — not duplicates.
    const cards = [makeEvent({ id: 'evt-a-0' }), makeEvent({ id: 'evt-a-1' })];
    const result = validateStorylines(cards);
    expect(result.issues.some((i) => i.kind === 'duplicate-id')).toBe(false);
  });
});

describe('AC3 — invalid option fails', () => {
  it('an empty option label is invalid', () => {
    const cards = [makeEvent({ id: 'evt-a', hasChoices: true })];
    const opts: StorylineOption[] = [{ label: '  ', successorId: null, effectPolicy: 'skip' }];
    const result = validateStorylines(cards, { getOptions: () => opts });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.kind === 'invalid-option')).toBe(true);
  });

  it('a choice card with zero options is invalid', () => {
    const cards = [makeEvent({ id: 'evt-a', hasChoices: true })];
    const result = validateStorylines(cards, { getOptions: () => [] });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.kind === 'invalid-option')).toBe(true);
  });
});

// ── AC2: uses the typed model ───────────────────────────────

describe('AC2 — validation reuses the typed CSV parser/model', () => {
  it('validates templates parsed by the shared CSV model loader', () => {
    const csv = buildCsv([
      { id: 'evt-model-a', hasChoices: true, acceptNextCardId: 'evt-model-b', storylineId: 'arc-1' },
      { id: 'evt-model-b', storylineId: 'arc-1' },
    ]);
    loadTemplatesFromCsv(csv);
    const result = validateStorylines(getEventTemplates());
    expect(result.valid).toBe(true);
    expect(result.choiceCardCount).toBe(1);
    expect(result.storylineIds).toEqual(['arc-1']);
  });

  it('a broken model-loaded fixture reports the parsed card id', () => {
    const csv = buildCsv([
      { id: 'evt-model-a', hasChoices: true, acceptNextCardId: 'evt-nowhere' },
    ]);
    loadTemplatesFromCsv(csv);
    const result = validateStorylines(getEventTemplates());
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.cardId === 'evt-model-a' && i.target === 'evt-nowhere')).toBe(true);
  });
});

// ── AC4: cycle policy ───────────────────────────────────────

describe('AC4 — cycles are informational by default', () => {
  it('the shipped tax cycle is reported as informational and does not fail', () => {
    const result = validateStorylines(getEventTemplates());
    expect(result.valid).toBe(true);
    const cycle = result.findings.find((f) => f.kind === 'cycle');
    expect(cycle).toBeDefined();
    expect(cycle!.path).toEqual(expect.arrayContaining(['evt-tax', 'evt-tax-inquiry', 'evt-tax-error']));
    expect(result.issues).toEqual([]);
  });

  it('an unintentional cycle is surfaced in the same report but still valid', () => {
    const cards = [
      makeEvent({ id: 'evt-a', hasChoices: true, rejectNextCardId: 'evt-b' }),
      makeEvent({ id: 'evt-b', hasChoices: true, rejectNextCardId: 'evt-a' }),
    ];
    const result = validateStorylines(cards);
    expect(result.valid).toBe(true);
    const cycle = result.findings.find((f) => f.kind === 'cycle');
    expect(cycle).toBeDefined();
    expect([...cycle!.path].sort()).toEqual(['evt-a', 'evt-b']);
  });

  it('with failOnCycle the same cycle becomes a hard error', () => {
    const cards = [
      makeEvent({ id: 'evt-a', hasChoices: true, rejectNextCardId: 'evt-b' }),
      makeEvent({ id: 'evt-b', hasChoices: true, rejectNextCardId: 'evt-a' }),
    ];
    const result = validateStorylines(cards, { failOnCycle: true });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.kind === 'cycle-error')).toBe(true);
  });

  it('a self-link is reported as a self-link finding', () => {
    const cards = [
      makeEvent({ id: 'evt-self', hasChoices: true, acceptNextCardId: 'evt-self' }),
    ];
    const result = validateStorylines(cards);
    expect(result.valid).toBe(true);
    expect(result.findings.some((f) => f.kind === 'self-link')).toBe(true);
  });
});

describe('AC4 — findCycles reports distinct cycles once', () => {
  it('collapses rotations of the same cycle', () => {
    const adjacency = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
    ]);
    const cycles = findCycles(adjacency);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns no cycles for a DAG', () => {
    const adjacency = new Map<string, string[]>([
      ['a', ['b', 'c']],
      ['b', ['c']],
      ['c', []],
    ]);
    expect(findCycles(adjacency)).toEqual([]);
  });

  it('finds two independent cycles', () => {
    const adjacency = new Map<string, string[]>([
      ['a', ['b']], ['b', ['a']],
      ['x', ['y']], ['y', ['x']],
    ]);
    const cycles = findCycles(adjacency);
    expect(cycles).toHaveLength(2);
  });
});

// ── AC5: suite gate ─────────────────────────────────────────

describe('AC5 — the shipped storylines are valid (suite gate)', () => {
  it('validateStorylines(shipped CSV) has no issues', () => {
    const result = validateStorylines(getEventTemplates());
    expect(result.issues, formatStorylineReport(result)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('the shipped choice-card count is the designed seven', () => {
    expect(validateStorylines(getEventTemplates()).choiceCardCount).toBe(7);
  });
});

// ── AC1: CLI exit codes ─────────────────────────────────────

describe('AC1 — CLI exit codes via vite-node', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tce-validate-storylines-'));

  function writeFixture(name: string, csv: string): string {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, csv, 'utf-8');
    return p;
  }

  it('exits 0 for the shipped CSV', () => {
    const res = runValidatorCli([]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('RESULT: VALID');
    expect(res.stdout).toContain('storyline-tax');
  });

  it('exits 0 and emits JSON with --json', () => {
    const res = runValidatorCli(['--json']);
    expect(res.exitCode).toBe(0);
    const parsed = JSON.parse(res.stdout) as StorylineValidationResult;
    expect(parsed.valid).toBe(true);
    expect(parsed.storylineIds).toContain('storyline-tax');
  });

  it('exits non-zero for a dangling-link fixture, naming the offending card/link', () => {
    const csv = buildCsv([
      { id: 'evt-broken', hasChoices: true, acceptNextCardId: 'evt-nowhere' },
    ]);
    const fixture = writeFixture('dangling.csv', csv);
    const res = runValidatorCli(['--csv', fixture]);
    expect(res.exitCode).not.toBe(0);
    expect(res.stdout).toContain('evt-broken');
    expect(res.stdout).toContain('evt-nowhere');
    expect(res.stdout).toContain('RESULT: INVALID');
  });

  it('exits non-zero for a duplicate-id fixture', () => {
    const csv = buildCsv([{ id: 'evt-dup' }, { id: 'evt-dup' }]);
    const fixture = writeFixture('duplicate.csv', csv);
    const res = runValidatorCli(['--csv', fixture]);
    expect(res.exitCode).not.toBe(0);
    expect(res.stdout).toContain('Duplicate card id');
  });

  it('exits 0 for a valid fixture with a cycle (cycle is informational)', () => {
    const csv = buildCsv([
      { id: 'evt-cyc-a', hasChoices: true, rejectNextCardId: 'evt-cyc-b' },
      { id: 'evt-cyc-b', hasChoices: true, rejectNextCardId: 'evt-cyc-a' },
    ]);
    const fixture = writeFixture('cycle.csv', csv);
    const res = runValidatorCli(['--csv', fixture]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('[cycle]');
  });

  it('exits non-zero for the same cycle with --fail-on-cycle', () => {
    const csv = buildCsv([
      { id: 'evt-cyc-a', hasChoices: true, rejectNextCardId: 'evt-cyc-b' },
      { id: 'evt-cyc-b', hasChoices: true, rejectNextCardId: 'evt-cyc-a' },
    ]);
    const fixture = writeFixture('cycle-fail.csv', csv);
    const res = runValidatorCli(['--csv', fixture, '--fail-on-cycle']);
    expect(res.exitCode).not.toBe(0);
  });
});

// ── AC6: opt-in pre-push reminder ───────────────────────────

describe('AC6 — opt-in pre-push reminder installer', () => {
  const INSTALLER = path.join(PROJECT_ROOT, 'src', 'scripts', 'install-storylines-pre-push.sh');

  it('installs a non-blocking reminder, is idempotent, and can be removed', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tce-storyline-hook-'));
    try {
      // Minimal git repo so `git rev-parse --show-toplevel` resolves.
      spawnSync('git', ['init', '-q'], { cwd: repo });

      const install = spawnSync('sh', [INSTALLER], { cwd: repo, encoding: 'utf-8' });
      expect(install.status).toBe(0);

      const hookFile = path.join(repo, '.git', 'hooks', 'pre-push');
      expect(fs.existsSync(hookFile)).toBe(true);
      const hook = fs.readFileSync(hookFile, 'utf-8');
      expect(hook).toContain('storyline-pre-push-reminder');
      expect(hook).toContain('validate:storylines');
      // Non-blocking: the reminder must not use `set -e` failure propagation
      // and must swallow a validator failure with a warning.
      expect(hook).toContain('|| echo');

      // Idempotent: a second install does not duplicate the block.
      spawnSync('sh', [INSTALLER], { cwd: repo, encoding: 'utf-8' });
      const hook2 = fs.readFileSync(hookFile, 'utf-8');
      const markerCount = hook2.split('storyline-pre-push-reminder').length - 1;
      expect(markerCount).toBe(1);

      // Removable.
      const remove = spawnSync('sh', [INSTALLER, '--remove'], { cwd: repo, encoding: 'utf-8' });
      expect(remove.status).toBe(0);
      const hook3 = fs.readFileSync(hookFile, 'utf-8');
      expect(hook3).not.toContain('storyline-pre-push-reminder');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('is opt-in: the committed pre-push hook does not run the validator', () => {
    // The framework-managed committed hook must not be modified; the reminder
    // is local-only. This pins the opt-in property.
    const committedHook = path.join(PROJECT_ROOT, '.githooks', 'pre-push');
    if (fs.existsSync(committedHook)) {
      const text = fs.readFileSync(committedHook, 'utf-8');
      expect(text).not.toContain('storyline-pre-push-reminder');
    }
  });
});

// ── Report renderers ────────────────────────────────────────

describe('report renderers', () => {
  it('formatStorylineReport lists errors, findings and the verdict', () => {
    const cards = [
      makeEvent({ id: 'evt-a', hasChoices: true, acceptNextCardId: 'evt-missing' }),
    ];
    const text = formatStorylineReport(validateStorylines(cards));
    expect(text).toContain('[dangling-link]');
    expect(text).toContain('RESULT: INVALID');
  });

  it('storylineReportToJson round-trips through JSON.parse', () => {
    const json = storylineReportToJson(validateStorylines(getEventTemplates()));
    const parsed = JSON.parse(json) as { valid: boolean; storylineIds: string[] };
    expect(parsed.valid).toBe(true);
    expect(Array.isArray(parsed.storylineIds)).toBe(true);
  });
});
