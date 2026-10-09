/**
 * Shared residential pack test constants/helpers.
 *
 * Child of the Main Street DLC work item `MS-0MV0M5BHH0020WFY`. The content
 * verification (`ResidentialPackContent.test.ts`) and the art verification
 * (`ResidentialPackArt.test.ts`) both resolve the production pack's paths
 * through this module, so the two suites cannot drift.
 *
 * @see packs/main-street/main-street-residential-pack/cards.csv
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (the worktree/checkout running the suite). */
export const REPO_ROOT = path.resolve(HERE, '../../..');

/** The production pack id / DLC id. */
export const RESIDENTIAL_PACK_ID = 'main-street-residential-pack';

/** The game the production pack extends. */
export const RESIDENTIAL_PACK_GAME_ID = 'main-street';

/** The production pack source root (`<repo>/packs`). */
export const RESIDENTIAL_PACK_ROOT = path.join(REPO_ROOT, 'packs');

/** The production pack's CSV fragment path. */
export const RESIDENTIAL_PACK_CSV_PATH = path.join(
  RESIDENTIAL_PACK_ROOT,
  RESIDENTIAL_PACK_GAME_ID,
  RESIDENTIAL_PACK_ID,
  'cards.csv',
);

/** The base card pool path (`<repo>/src/card-data.csv`). */
export const BASE_CARD_CSV_PATH = path.join(REPO_ROOT, 'src', 'card-data.csv');

/** Read the production pack's CSV fragment text. */
export function readResidentialPackCsv(): string {
  return readFileSync(RESIDENTIAL_PACK_CSV_PATH, 'utf-8');
}

/**
 * Parse a CSV fragment into its header (column names) and row objects.
 *
 * Quoted-field aware, so a description containing a comma does not shift the
 * columns. Returns `header` as the first row's keys and `rows` as the data
 * rows.
 */
export function parseCsvFragment(csv: string): {
  header: string[];
  rows: Record<string, string>[];
} {
  const lines = csv.trim().split('\n');
  const header = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue;
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    header.forEach((column, index) => {
      row[column] = values[index] ?? '';
    });
    rows.push(row);
  }
  return { header, rows };
}

/** Parse one CSV line, honouring double-quoted fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/** Distinct card names declared by the production pack CSV fragment. */
export function residentialPackCardNames(): string[] {
  const { rows } = parseCsvFragment(readResidentialPackCsv());
  return [...new Set(rows.map((row) => row.name).filter(Boolean))];
}
