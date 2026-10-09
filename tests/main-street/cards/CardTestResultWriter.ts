/**
 * Main Street: Card Test Framework — CSV result writer.
 *
 * Appends (once) and updates the four card-test result columns in
 * `src/card-data.csv`, preserving every existing column, its order, and the
 * row order. The CSV is also consumed by `@balance-cards` and the card-art
 * pipeline, which validate the known header prefix and ignore trailing
 * columns, so appending is backward compatible.
 *
 * The writer is idempotent: it rewrites the file only when the serialised
 * content actually changes.
 *
 * @module
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { CardTestResult } from './CardTestTypes';
import {
  BROWSER_RESULT_TARGETS,
  RESULT_COLUMNS,
  UNIT_RESULT_TARGETS,
  type ResultColumnTargets,
} from './ResultColumns';

export {
  BROWSER_RESULT_TARGETS,
  RESULT_COLUMNS,
  UNIT_RESULT_TARGETS,
  type ResultColumnTargets,
};

/** Splits a single CSV record into unescaped field values. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** Escapes a single CSV field, quoting only when required. */
export function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialises field values back into one CSV record. */
export function joinCsvLine(values: readonly string[]): string {
  return values.map(escapeCsvField).join(',');
}

/**
 * Applies `results` to `csvText`, returning the new text.
 *
 * @param csvText  Raw CSV content (header + rows, LF line endings).
 * @param results  Results keyed by card id.
 * @param targets  Which status/reason columns to update (defaults to unit).
 * @returns `{ csv, changed }` — `changed` is false when the text is identical.
 */
export function applyResultsToCsv(
  csvText: string,
  results: readonly CardTestResult[],
  targets: ResultColumnTargets = {
    statusColumn: RESULT_COLUMNS[0],
    reasonColumn: RESULT_COLUMNS[1],
  },
): { csv: string; changed: boolean } {
  const endsWithNewline = csvText.endsWith('\n');
  const lines = csvText.split('\n');
  if (endsWithNewline) {
    lines.pop();
  }
  if (lines.length === 0 || lines[0].trim() === '') {
    throw new Error('Cannot write card test results: CSV has no header row.');
  }

  const header = splitCsvLine(lines[0]);
  // Ensure every result column exists (append missing ones in order).
  for (const column of RESULT_COLUMNS) {
    if (!header.includes(column)) {
      header.push(column);
    }
  }

  const idIndex = header.indexOf('id');
  if (idIndex === -1) {
    throw new Error('Cannot write card test results: CSV header has no "id" column.');
  }
  const statusIndex = header.indexOf(targets.statusColumn);
  const reasonIndex = header.indexOf(targets.reasonColumn);

  const byId = new Map(results.map(result => [result.cardId, result]));

  const outLines: string[] = [joinCsvLine(header)];
  for (let rowIndex = 1; rowIndex < lines.length; rowIndex++) {
    const line = lines[rowIndex];
    if (line === '') {
      continue;
    }
    const fields = splitCsvLine(line);
    // Normalise the field count in case the appended columns are new.
    while (fields.length < header.length) {
      fields.push('');
    }
    const cardId = fields[idIndex];
    const result = byId.get(cardId);
    if (result) {
      fields[statusIndex] = result.status;
      fields[reasonIndex] = result.status === 'pass' ? '' : result.failReason;
    }
    outLines.push(joinCsvLine(fields));
  }

  let csv = outLines.join('\n');
  if (endsWithNewline) {
    csv += '\n';
  }
  return { csv, changed: csv !== csvText };
}

/**
 * Writes (idempotently) the card test results back into the CSV file at
 * `csvPath`. The write is atomic (temp file + rename) so concurrent readers
 * never observe a partial file.
 *
 * @returns `{ changed, path }`.
 */
export function writeCardTestResults(
  csvPath: string,
  results: readonly CardTestResult[],
  targets?: ResultColumnTargets,
): { changed: boolean; path: string } {
  const original = readFileSync(csvPath, 'utf-8');
  const { csv, changed } = applyResultsToCsv(original, results, targets);
  if (!changed) {
    return { changed: false, path: csvPath };
  }
  const tempPath = `${csvPath}.card-test.tmp`;
  writeFileSync(tempPath, csv, 'utf-8');
  renameSync(tempPath, csvPath);
  return { changed: true, path: csvPath };
}
