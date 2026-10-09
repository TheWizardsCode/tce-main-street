/**
 * Production residential pack — build wrapper & installability.
 *
 * Child of the Main Street DLC work item `MS-0MV0M5BHH0020WFY`
 * ("Production residential pack content & builder wrapper"). Unlike the
 * dedicated verification child (`ResidentialPackContent.test.ts`), this suite
 * exercises the **npm build wrapper** (`build:card-pack`) over the committed
 * production `packs/` source tree and proves the emitted root is installable:
 * a valid merged manifest, the pack directory (CSV + assets) in place, and a
 * clean merge with the base card pool.
 *
 * @see package.json — `build:card-pack` script.
 * @see packs/README.md — authoring/building/installing the pack.
 * @see core/scripts/build-card-pack.mjs — the core builder.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { mergeCardPackCsv } from '@core-engine';
// @ts-ignore: no declaration file for the core .mjs builder — intentional
import { buildCardPack } from '@core-scripts/build-card-pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');
const PACK_SOURCE = path.join(REPO_ROOT, 'packs');
const BASE_CSV_PATH = path.join(REPO_ROOT, 'src/card-data.csv');

const PACK_ID = 'main-street-residential-pack';
const GAME_ID = 'main-street';

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

describe('residential pack — build wrapper produces an installable root', () => {
  it('builds the production pack source into a merged manifest + pack dir', () => {
    const outRoot = tempDir('ms-residential-pack-build-');
    const result = buildCardPack({
      inputDir: PACK_SOURCE,
      projectRoot: REPO_ROOT,
      outRoot,
    });

    // The committed production pack builds without a single rejection.
    expect(result.rejected).toEqual([]);
    expect(result.packs.map((pack: { id: string }) => pack.id)).toContain(PACK_ID);

    // The output manifest upserts the pack entry (installable contract).
    const manifestPath = path.join(outRoot, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const entry = manifest.packs.find(
      (pack: { id: string; gameId: string }) =>
        pack.id === PACK_ID && pack.gameId === GAME_ID,
    );
    expect(entry, 'residential pack manifest entry').toBeDefined();
    expect(entry.cards).toBe('cards.csv');
    expect(Array.isArray(entry.assets)).toBe(true);
    expect(entry.assets.length).toBeGreaterThan(0);

    // The pack directory carries the CSV fragment and every declared asset.
    const packDir = path.join(outRoot, GAME_ID, PACK_ID);
    expect(existsSync(path.join(packDir, 'cards.csv'))).toBe(true);
    for (const asset of entry.assets as string[]) {
      expect(existsSync(path.join(packDir, asset)), asset).toBe(true);
    }
  });

  it('merges the built pack with the base pool without conflicts or errors', () => {
    const outRoot = tempDir('ms-residential-pack-merge-');
    buildCardPack({
      inputDir: PACK_SOURCE,
      projectRoot: REPO_ROOT,
      outRoot,
    });

    const baseCsv = readFileSync(BASE_CSV_PATH, 'utf-8');
    const packCsv = readFileSync(
      path.join(outRoot, GAME_ID, PACK_ID, 'cards.csv'),
      'utf-8',
    );

    const merged = mergeCardPackCsv(baseCsv, [{ id: PACK_ID, csv: packCsv }]);
    expect(merged.errors).toEqual([]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.merged).not.toBeNull();
    // Additive: every pack row survives into the merged pool.
    expect(merged.merged).toContain('biz-ms-residential-property-mgmt');
    expect(merged.merged).toContain('cs-ms-residential-community-centre');
  });
});
