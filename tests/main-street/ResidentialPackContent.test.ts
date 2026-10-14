/**
 * Production residential pack — content & builder contract (verification).
 *
 * Verification child of the Main Street DLC work item `MS-0MV0M5BHH0020WFY`.
 * This is the dedicated acceptance suite for the committed production pack
 * source tree (`packs/`): it parses the real manifest and CSV, drives the real
 * core builder and merge seam, and runs the existing schema validation over
 * the merged `base + pack` rows. It reads the authored content — never a
 * fixture — so it is red until the pack-content child lands.
 *
 * @see packs/manifest.json
 * @see packs/main-street/main-street-residential-pack/cards.csv
 * @see core/scripts/build-card-pack.mjs
 * @see core/src/core-engine/CardPackMerge.ts
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { mergeCardPackCsv } from '@core-engine';
import { parseCsv, validateCsvRows, type CsvRow } from '@balance-cards';
// @ts-ignore: no declaration file for the core .mjs builder — intentional
import { buildCardPack } from '@core-scripts/build-card-pack.mjs';

import { CARD_DATA_RAW } from '../../src/MainStreetCards';
import {
  BASE_CARD_CSV_PATH as BASE_CSV_PATH,
  REPO_ROOT,
  RESIDENTIAL_PACK_ROOT as PACK_SOURCE,
  readResidentialPackCsv,
} from './helpers/residentialPack';

const PACK_ID = 'main-street-residential-pack';
const GAME_ID = 'main-street';
const EXPECTED_FAMILIES = ['business', 'event', 'upgrade', 'staff', 'community-space'];

interface ManifestEntry {
  id: string;
  gameId: string;
  version: string;
  coreEngineVersion: string;
  cards: string;
  assets?: string[];
}

interface Manifest {
  version: number;
  packs: ManifestEntry[];
}

const tempRoots: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** The raw header line of the base card pool. */
function baseHeader(): string {
  return CARD_DATA_RAW.split('\n')[0];
}

/** Parse the authored pack manifest. */
function readManifest(): Manifest {
  return JSON.parse(
    readFileSync(path.join(PACK_SOURCE, 'manifest.json'), 'utf-8'),
  ) as Manifest;
}

/** The authored pack CSV text (shared helper keeps the suites in sync). */
function readPackCsv(): string {
  return readResidentialPackCsv();
}

/** Parse a CSV fragment into its header (column names) and row objects. */
function parseFragment(csv: string): {
  header: string[];
  rows: Record<string, string>[];
} {
  const rows = parseCsv(csv) as unknown as Record<string, string>[];
  return { header: Object.keys(rows[0] ?? {}), rows };
}

/** Build the production pack into a fresh temp packs root. */
function buildPack(): { outRoot: string; packDir: string } {
  const outRoot = tempDir('ms-residential-content-');
  const result = buildCardPack({
    inputDir: PACK_SOURCE,
    projectRoot: REPO_ROOT,
    outRoot,
  });
  expect(result.rejected).toEqual([]);
  return { outRoot, packDir: path.join(outRoot, GAME_ID, PACK_ID) };
}

describe('residential pack manifest contract', () => {
  it('declares the main-street-residential-pack entry with all required fields', () => {
    const manifest = readManifest();
    const entry = manifest.packs.find((pack) => pack.id === PACK_ID);
    expect(entry, `manifest entry ${PACK_ID}`).toBeDefined();
    expect(entry?.gameId).toBe(GAME_ID);
    expect(typeof entry?.version).toBe('string');
    expect(entry?.version.length).toBeGreaterThan(0);
    expect(typeof entry?.coreEngineVersion).toBe('string');
    expect(entry?.coreEngineVersion.length).toBeGreaterThan(0);
    expect(entry?.cards).toBe('cards.csv');
    expect(Array.isArray(entry?.assets)).toBe(true);
    expect(entry?.assets?.length).toBeGreaterThan(0);
  });
});

describe('residential pack CSV contract', () => {
  it('reuses the base card-data.csv header exactly (same columns, same order)', () => {
    const { header } = parseFragment(readPackCsv());
    expect(header).toEqual(baseHeader().split(','));
  });

  it('adds 8–12 residential cards with unique ids that do not collide with the base pool', () => {
    const packRows = parseFragment(readPackCsv()).rows;
    const baseRows = parseFragment(CARD_DATA_RAW).rows;

    expect(packRows.length).toBeGreaterThanOrEqual(8);
    expect(packRows.length).toBeLessThanOrEqual(12);

    const packIds = packRows.map((row) => row.id);
    expect(new Set(packIds).size).toBe(packIds.length);

    const baseIds = new Set(baseRows.map((row) => row.id));
    const baseNames = new Set(baseRows.map((row) => row.name));
    for (const row of packRows) {
      expect(baseIds.has(row.id), `pack id collides with base: ${row.id}`).toBe(false);
      expect(baseNames.has(row.name), `pack name collides with base: ${row.name}`).toBe(false);
    }
  });

  it('spans every card family with residential-namespaced rows', () => {
    const packRows = parseFragment(readPackCsv()).rows;
    const families = new Set(packRows.map((row) => row.family));
    for (const family of EXPECTED_FAMILIES) {
      expect(families.has(family), `missing family ${family}`).toBe(true);
    }
    for (const row of packRows) {
      expect(row.id).toMatch(/-ms-residential-/);
    }
  });

  it('follows the existing per-family tier/cost/effect conventions', () => {
    const packRows = parseFragment(readPackCsv()).rows;
    const allRows = [...parseFragment(CARD_DATA_RAW).rows, ...packRows];
    const knownBusinessNames = new Set(
      allRows
        .filter((row) => row.family === 'business' || row.family === 'community-space')
        .map((row) => row.name),
    );

    for (const row of packRows) {
      expect(row.tier, `${row.id} tier`).toMatch(/^\d+$/);
      expect(Number(row.tier)).toBeGreaterThan(0);

      if (row.family === 'business') {
        expect(row.cost, `${row.id} cost`).toMatch(/^\d+$/);
        expect(Number(row.cost)).toBeGreaterThan(0);
        expect(row.baseIncome, `${row.id} baseIncome`).not.toBe('');
        expect(row.synergyTypes, `${row.id} synergyTypes`).not.toBe('');
        expect(row.upgradePath, `${row.id} upgradePath`).not.toBe('');
        expect(row.maxLevel, `${row.id} maxLevel`).not.toBe('');
      }

      if (row.family === 'community-space') {
        expect(row.cost, `${row.id} cost`).toMatch(/^\d+$/);
        expect(row.synergyTypes, `${row.id} synergyTypes`).not.toBe('');
        expect(row.maxLevel, `${row.id} maxLevel`).not.toBe('');
      }

      if (row.family === 'event') {
        expect(row.trigger, `${row.id} trigger`).not.toBe('');
        expect(row.effect, `${row.id} effect`).not.toBe('');
        expect(row.target, `${row.id} target`).not.toBe('');
        if (row.target === 'SpecificSynergy') {
          expect(row.targetSynergy, `${row.id} targetSynergy`).not.toBe('');
        }
      }

      if (row.family === 'upgrade') {
        expect(row.targetBusiness, `${row.id} targetBusiness`).not.toBe('');
        expect(
          knownBusinessNames.has(row.targetBusiness),
          `${row.id} targets unknown business "${row.targetBusiness}"`,
        ).toBe(true);
        expect(row.requiredLevel, `${row.id} requiredLevel`).not.toBe('');
      }

      if (row.family === 'staff') {
        expect(row.cost, `${row.id} cost`).toMatch(/^\d+$/);
        expect(row.ongoingCost, `${row.id} ongoingCost`).not.toBe('');
      }
    }
  });
});

describe('residential pack builder & merge contract', () => {
  it('builds into an installable root and merges with the base pool cleanly', () => {
    const { packDir } = buildPack();
    const builtCsv = readFileSync(path.join(packDir, 'cards.csv'), 'utf-8');
    expect(builtCsv).toBe(readPackCsv());

    const merged = mergeCardPackCsv(CARD_DATA_RAW, [{ id: PACK_ID, csv: builtCsv }]);
    expect(merged.errors).toEqual([]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.merged).not.toBeNull();

    // Every pack card survives the merge (additive).
    for (const row of parseFragment(readPackCsv()).rows) {
      expect(merged.merged).toContain(row.id);
    }
  });

  it('passes the existing schema validation over the merged base + pack rows', () => {
    const { packDir } = buildPack();
    const builtCsv = readFileSync(path.join(packDir, 'cards.csv'), 'utf-8');
    const merged = mergeCardPackCsv(CARD_DATA_RAW, [{ id: PACK_ID, csv: builtCsv }]);
    expect(merged.merged).not.toBeNull();

    const rows = parseCsv(merged.merged as string) as CsvRow[];
    // The existing balance-cards schema validator accepts every merged row.
    expect(() => validateCsvRows(rows)).not.toThrow();
    // base + pack row count is exactly additive.
    expect(rows.length).toBe(
      parseFragment(CARD_DATA_RAW).rows.length + parseFragment(readPackCsv()).rows.length,
    );
  });

  it('preserves every base row unchanged in the merged pool (purely additive)', () => {
    const { packDir } = buildPack();
    const builtCsv = readFileSync(path.join(packDir, 'cards.csv'), 'utf-8');
    const merged = mergeCardPackCsv(CARD_DATA_RAW, [{ id: PACK_ID, csv: builtCsv }]);

    // The bundled raw CSV is the file on disk (the pack never edits it) ...
    expect(readFileSync(BASE_CSV_PATH, 'utf-8')).toBe(CARD_DATA_RAW);

    // ... and every base id is still present in the merged pool.
    const mergedText = merged.merged as string;
    for (const baseRow of parseFragment(CARD_DATA_RAW).rows) {
      expect(mergedText, `base id missing after merge: ${baseRow.id}`).toContain(baseRow.id);
    }
  });
});
