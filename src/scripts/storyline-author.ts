/**
 * Storyline authoring helper CLI
 *
 * Safe, self-validating editing of `src/card-data.csv` storyline cards
 * (MS-0MUMP95IW002ARWJ):
 *
 *  - `add-card`   appends a new event card row (correct column count, no
 *                 duplicate id).
 *  - `link`       sets the choice links (`hasChoices`, `acceptNextCardId`,
 *                 `rejectNextCardId`) on an existing card.
 *  - `set-storyline` sets `storylineId`/`storylineTitle` on an existing card.
 *
 * Every mutation is **transactional**: the new CSV is built in memory, loaded
 * through the typed model and validated with the C3 validator *before* any
 * write. If validation fails, nothing is written and the CLI exits non-zero.
 *
 * @module
 */

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadTemplatesFromCsv, getEventTemplates } from '../MainStreetCards';
import { validateStorylines, formatStorylineReport } from './validate-storylines';

// ── CSV utilities (minimal RFC-4180 subset) ─────────────────

export interface ParsedCsv {
  readonly header: string[];
  readonly rows: string[][];
}

/**
 * Parses CSV text into a header + row matrix. Handles quoted fields with
 * embedded commas, quotes (`""`) and newlines.
 */
export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      records.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  // Final field/row (when the file has no trailing newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  // Drop a trailing empty record produced by a terminal newline.
  while (records.length > 0 && records[records.length - 1].every((f) => f === '')) {
    records.pop();
  }

  const header = records.shift() ?? [];
  return { header, rows: records };
}

/** Escapes one CSV field (minimal quoting — only when required). */
export function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialises a header + row matrix to CSV text (LF newlines, trailing newline). */
export function serializeCsv(parsed: ParsedCsv): string {
  const lines = [parsed.header.map(escapeCsvField).join(',')];
  for (const row of parsed.rows) {
    lines.push(row.map(escapeCsvField).join(','));
  }
  return `${lines.join('\n')}\n`;
}

// ── Author operations ───────────────────────────────────────

export interface AuthorResult {
  /** The mutated CSV text (unchanged when validation fails). */
  readonly csv: string;
  /** Validation/authoring errors; empty when the operation succeeded. */
  readonly errors: readonly string[];
  /** True when the operation produced a valid CSV. */
  readonly ok: boolean;
}

export interface AddCardSpec {
  readonly id: string;
  readonly name: string;
  readonly effect: string;
  readonly coinDelta?: number;
  readonly reputationDelta?: number;
  readonly hasChoices?: boolean;
  readonly acceptNextCardId?: string | null;
  readonly rejectNextCardId?: string | null;
  readonly storylineId?: string | null;
  readonly storylineTitle?: string | null;
  readonly trigger?: string;
  readonly target?: string;
}

export interface LinkSpec {
  readonly id: string;
  /** When provided, sets the accept-next link (null clears it). */
  readonly acceptNextCardId?: string | null;
  /** When provided, sets the reject-next link (null clears it). */
  readonly rejectNextCardId?: string | null;
  /** When true, marks the card as a choice (hasChoices=true). */
  readonly hasChoices?: boolean;
  /** When provided, sets the storyline id. */
  readonly storylineId?: string | null;
  /** When provided, sets the storyline title. */
  readonly storylineTitle?: string | null;
}

const COL = {
  family: 'family',
  id: 'id',
  name: 'name',
  cost: 'cost',
  tier: 'tier',
  trigger: 'trigger',
  effect: 'effect',
  target: 'target',
  coinDelta: 'coinDelta',
  reputationDelta: 'reputationDelta',
  hasChoices: 'hasChoices',
  acceptNextCardId: 'acceptNextCardId',
  rejectNextCardId: 'rejectNextCardId',
  storylineId: 'storylineId',
  storylineTitle: 'storylineTitle',
} as const;

/** Returns the row array for a card id, or undefined. */
function findRow(parsed: ParsedCsv, id: string): string[] | undefined {
  const idx = parsed.header.indexOf(COL.id);
  if (idx < 0) return undefined;
  return parsed.rows.find((r) => r[idx] === id);
}

/** Returns a fresh, all-empty row aligned to the header. */
function emptyRow(parsed: ParsedCsv): string[] {
  return new Array(parsed.header.length).fill('');
}

/** Sets a column value on a row (by header name); no-op if the column is absent. */
function setField(parsed: ParsedCsv, row: string[], column: string, value: string): void {
  const idx = parsed.header.indexOf(column);
  if (idx >= 0) row[idx] = value;
}

/**
 * Adds a card and validates the resulting CSV. Duplicate ids are rejected
 * before any mutation. The returned `csv` is the unchanged input on failure.
 */
export function addCard(csvText: string, spec: AddCardSpec): AuthorResult {
  const parsed = parseCsv(csvText);
  const errors: string[] = [];

  if (!spec.id || spec.id.trim() === '') errors.push('add-card: --id is required');
  if (!spec.name || spec.name.trim() === '') errors.push('add-card: --name is required');
  if (!spec.effect || spec.effect.trim() === '') errors.push('add-card: --effect is required');
  if (errors.length > 0) return { csv: csvText, errors, ok: false };

  if (findRow(parsed, spec.id)) {
    return {
      csv: csvText,
      errors: [`add-card: card id "${spec.id}" already exists (duplicate id)`],
      ok: false,
    };
  }

  const row = emptyRow(parsed);
  setField(parsed, row, COL.family, 'event');
  setField(parsed, row, COL.id, spec.id);
  setField(parsed, row, COL.name, spec.name);
  setField(parsed, row, COL.cost, '0');
  setField(parsed, row, COL.tier, '1');
  setField(parsed, row, COL.trigger, spec.trigger ?? 'Incident');
  setField(parsed, row, COL.effect, spec.effect);
  setField(parsed, row, COL.target, spec.target ?? 'All');
  setField(parsed, row, COL.coinDelta, String(spec.coinDelta ?? 0));
  setField(parsed, row, COL.reputationDelta, String(spec.reputationDelta ?? 0));
  if (spec.hasChoices) setField(parsed, row, COL.hasChoices, 'true');
  if (spec.acceptNextCardId) setField(parsed, row, COL.acceptNextCardId, spec.acceptNextCardId);
  if (spec.rejectNextCardId) setField(parsed, row, COL.rejectNextCardId, spec.rejectNextCardId);
  if (spec.storylineId) setField(parsed, row, COL.storylineId, spec.storylineId);
  if (spec.storylineTitle) setField(parsed, row, COL.storylineTitle, spec.storylineTitle);

  parsed.rows.push(row);
  return validateAndReturn(csvText, parsed);
}

/**
 * Links an existing card (sets choice links and/or storyline metadata) and
 * validates the resulting CSV.
 */
export function linkCard(csvText: string, spec: LinkSpec): AuthorResult {
  const parsed = parseCsv(csvText);
  const row = findRow(parsed, spec.id);
  if (!row) {
    return {
      csv: csvText,
      errors: [`link: card id "${spec.id}" not found`],
      ok: false,
    };
  }

  // Validate link targets before mutating so the error names the bad link.
  const idxId = parsed.header.indexOf(COL.id);
  const ids = new Set(parsed.rows.map((r) => r[idxId]));
  if (spec.acceptNextCardId) {
    if (!ids.has(spec.acceptNextCardId)) {
      return {
        csv: csvText,
        errors: [`link: accept-next target "${spec.acceptNextCardId}" does not exist`],
        ok: false,
      };
    }
    setField(parsed, row, COL.hasChoices, 'true');
    setField(parsed, row, COL.acceptNextCardId, spec.acceptNextCardId);
  }
  if (spec.rejectNextCardId) {
    if (!ids.has(spec.rejectNextCardId)) {
      return {
        csv: csvText,
        errors: [`link: reject-next target "${spec.rejectNextCardId}" does not exist`],
        ok: false,
      };
    }
    setField(parsed, row, COL.hasChoices, 'true');
    setField(parsed, row, COL.rejectNextCardId, spec.rejectNextCardId);
  }
  if (spec.hasChoices) setField(parsed, row, COL.hasChoices, 'true');
  if (spec.storylineId !== undefined && spec.storylineId !== null) {
    setField(parsed, row, COL.storylineId, spec.storylineId);
  }
  if (spec.storylineTitle !== undefined && spec.storylineTitle !== null) {
    setField(parsed, row, COL.storylineTitle, spec.storylineTitle);
  }

  return validateAndReturn(csvText, parsed);
}

/**
 * Serialises the mutated matrix, loads it through the typed model and runs the
 * C3 validator. Returns the original CSV untouched when validation fails.
 */
function validateAndReturn(originalCsv: string, parsed: ParsedCsv): AuthorResult {
  const candidate = serializeCsv(parsed);
  try {
    loadTemplatesFromCsv(candidate);
  } catch (err) {
    return {
      csv: originalCsv,
      errors: [`validation: failed to parse the edited CSV: ${(err as Error).message}`],
      ok: false,
    };
  }
  const result = validateStorylines(getEventTemplates());
  if (!result.valid) {
    return {
      csv: originalCsv,
      errors: result.issues.map((i) => i.message),
      ok: false,
    };
  }
  return { csv: candidate, errors: [], ok: true };
}

/**
 * Applies a mutation atomically to a CSV file: builds the new content, and only
 * writes it (via a temp file + rename) when validation passes. On failure the
 * target file is untouched.
 */
export function applyToFile(
  csvPath: string,
  mutate: (csvText: string) => AuthorResult,
): AuthorResult {
  const original = readFileSync(csvPath, 'utf-8');
  const result = mutate(original);
  if (!result.ok) return result;

  const tmp = `${csvPath}.tmp-${process.pid}`;
  writeFileSync(tmp, result.csv, 'utf-8');
  renameSync(tmp, csvPath);
  return result;
}

// ── CLI ─────────────────────────────────────────────────────

export interface AuthorCliOptions {
  readonly command: 'add-card' | 'link';
  readonly csvPath: string;
  readonly dryRun: boolean;
  readonly spec: AddCardSpec | LinkSpec;
}

/** Parses a `--key value` argument map. */
function argMap(argv: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        map.set(key, next);
        i++;
      } else {
        map.set(key, 'true');
      }
    }
  }
  return map;
}

/** Parses the CLI argv into author command options. */
export function parseAuthorArgs(argv: readonly string[]): AuthorCliOptions | { error: string } {
  const command = argv.find((a) => a === 'add-card' || a === 'link');
  if (!command) return { error: 'expected a command: add-card | link' };
  const map = argMap(argv);

  const csvPath = resolve(process.cwd(), map.get('csv') ?? 'src/card-data.csv');
  const dryRun = map.get('dry-run') === 'true';
  const optional = (k: string): string | undefined => {
    const v = map.get(k);
    return v === undefined ? undefined : v;
  };

  if (command === 'add-card') {
    const spec: AddCardSpec = {
      id: map.get('id') ?? '',
      name: map.get('name') ?? '',
      effect: map.get('effect') ?? '',
      coinDelta: map.has('coin-delta') ? Number(map.get('coin-delta')) : undefined,
      reputationDelta: map.has('reputation-delta') ? Number(map.get('reputation-delta')) : undefined,
      hasChoices: map.get('has-choices') === 'true',
      acceptNextCardId: optional('accept-next') ?? null,
      rejectNextCardId: optional('reject-next') ?? null,
      storylineId: optional('storyline-id') ?? null,
      storylineTitle: optional('storyline-title') ?? null,
      trigger: optional('trigger'),
      target: optional('target'),
    };
    return { command, csvPath, dryRun, spec };
  }

  const spec: LinkSpec = {
    id: map.get('id') ?? '',
    acceptNextCardId: optional('accept-next') ?? null,
    rejectNextCardId: optional('reject-next') ?? null,
    hasChoices: map.get('has-choices') === 'true',
    storylineId: optional('storyline-id') ?? null,
    storylineTitle: optional('storyline-title') ?? null,
  };
  return { command, csvPath, dryRun, spec };
}

/**
 * Runs the authoring CLI.
 *
 * @returns Exit code: 0 on success, 1 on invalid input/validation failure.
 */
export function runAuthorCli(argv: readonly string[] = process.argv.slice(2)): number {
  const parsed = parseAuthorArgs(argv);
  if ('error' in parsed) {
    process.stderr.write(`storyline-author: ${parsed.error}\n`);
    return 1;
  }

  const mutate =
    parsed.command === 'add-card'
      ? (csv: string) => addCard(csv, parsed.spec as AddCardSpec)
      : (csv: string) => linkCard(csv, parsed.spec as LinkSpec);

  const result = parsed.dryRun
    ? mutate(readFileSync(parsed.csvPath, 'utf-8'))
    : applyToFile(parsed.csvPath, mutate);

  if (!result.ok) {
    process.stderr.write(`storyline-author: refusing to write — validation failed:\n`);
    for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
    return 1;
  }

  if (parsed.dryRun) {
    process.stdout.write(`storyline-author: dry-run OK (${parsed.command}); no file written\n`);
  } else {
    process.stdout.write(`storyline-author: ${parsed.command} applied to ${parsed.csvPath}\n`);
  }
  return 0;
}

// Re-exported so callers can render a validation report after an operation.
export { formatStorylineReport };
