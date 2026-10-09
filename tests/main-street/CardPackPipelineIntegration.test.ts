/**
 * Card-pack pipeline — end-to-end integration test.
 *
 * Cross-repo verification child of the core DLC epic `CG-0MUZFD1WR0031QTB`
 * (core feature F10 `CG-0MUZIS56500806DE`; Main Street
 * `MS-0MV0Q479I002W0R6`).
 *
 * Unlike `MainStreetCardPacks.test.ts` (which drives the merge/persistence
 * seams with in-memory stubs), this test drives a **real fixture content
 * directory** — the committed Main Street reference pack
 * (`<core>/tests/fixtures/reference-packs/main-street/`) — through the real
 * core renderer loader (`loadCardPacks`), the base+pack CSV merge
 * (`mergeMainStreetCardPool`), template application, save and load. It is the
 * one test that proves the whole channel agrees on the on-disk contract:
 *
 *   content dir → core loader → core merge → Main Street templates →
 *   serialize → reset → deserialize → same pool restored.
 *
 * It also pins the missing-pack policy: a pack recorded in a save but not
 * installed degrades to base content with a warning, and the game refuses to
 * resume only when a *live* card instance needs the missing template.
 *
 * @see src/MainStreetCardPacks.ts
 * @see src/ui/CardPackLoader.ts (core)
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CARD_DATA_RAW,
  CSV_CHECKSUM,
  getActiveCsvChecksum,
  getActiveCsvData,
  getBusinessTemplates,
  type BusinessCard,
} from '../../src/MainStreetCards';
import {
  MissingCardPackTemplateError,
  applyMainStreetCardPool,
  assertLiveTemplatesResolvable,
  collectLiveCardIds,
  findMissingLiveTemplateIds,
  getActiveMainStreetPacks,
  getAvailableTemplateIds,
  loadMainStreetCardPacks,
  resetMainStreetCardPacks,
} from '../../src/MainStreetCardPacks';
import {
  deserializeMainStreetState,
  serializeMainStreetState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The committed reference pack source tree. Its layout already mirrors the
 * installed packs root (`manifest.json` + `<gameId>/<packId>/…`), so it can be
 * copied verbatim into a disposable `<contentDir>/packs/`.
 */
const REFERENCE_PACK_ROOT = path.resolve(
  HERE,
  '../../core/tests/fixtures/reference-packs/main-street',
);

const PACK_ID = 'main-street-foundations';
const PACK_VERSION = '1.0.0';

/** One card of each family the reference pack contributes. */
const PACK_BUSINESS_ID = 'biz-ms-foundations-teahouse';
const PACK_EVENT_ID = 'evt-ms-foundations-fair';
const PACK_UPGRADE_ID = 'upg-ms-foundations-teahouse';
const PACK_CARD_IDS = [PACK_BUSINESS_ID, PACK_EVENT_ID, PACK_UPGRADE_ID] as const;

/** Deterministic warning sink so discovery never writes to the console. */
const silentLogger = { warn: (): void => {} };

const tempDirs: string[] = [];

/** Materialise the reference pack into a fresh `<contentDir>/packs/` tree. */
function makeContentDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ms-card-pack-e2e-'));
  tempDirs.push(dir);
  cpSync(REFERENCE_PACK_ROOT, path.join(dir, 'packs'), { recursive: true });
  return dir;
}

/** Materialise an empty content directory (no packs installed). */
function makeEmptyContentDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ms-card-pack-empty-'));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, 'packs'), { recursive: true });
  writeFileSync(
    path.join(dir, 'packs', 'manifest.json'),
    JSON.stringify({ version: 1, packs: [] }),
    'utf-8',
  );
  return dir;
}

/**
 * Filesystem transports standing in for the `tce-packs://` protocol: the
 * manifest is read from `<contentDir>/packs/manifest.json` and each pack asset
 * from `<contentDir>/packs/<gameId>/<packId>/<path>`.
 */
function diskFetchers(contentDir: string) {
  const packsDir = path.join(contentDir, 'packs');
  return {
    fetchManifest: async (url: string): Promise<string> => {
      expect(url).toMatch(/packs\/manifest\.json$/);
      return readFileSync(path.join(packsDir, 'manifest.json'), 'utf-8');
    },
    fetchCsv: async (url: string): Promise<string> => {
      const parsed = new URL(url);
      const [packId, ...rest] = decodeURIComponent(parsed.pathname)
        .split('/')
        .filter(Boolean);
      return readFileSync(
        path.join(packsDir, parsed.hostname, packId, rest.join('/')),
        'utf-8',
      );
    },
  };
}

/** A live business card instance built from the pack template. */
function packBusinessCard(): BusinessCard {
  const template = getBusinessTemplates().find((card) => card.id === PACK_BUSINESS_ID);
  expect(template, `pack business template ${PACK_BUSINESS_ID}`).toBeDefined();
  return {
    ...template!,
    family: 'business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
  };
}

afterEach(() => {
  resetMainStreetCardPacks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('card-pack pipeline — installed pack through loader, merge, save and load', () => {
  it('restores the exact same merged pool after a save/load round-trip', async () => {
    const contentDir = makeContentDir();

    // 1. Loader → merge: the real core loader discovers the reference pack
    //    from disk and the real merge combines base + pack rows.
    const loadResult = await loadMainStreetCardPacks({
      contentDir,
      ...diskFetchers(contentDir),
      logger: silentLogger,
    });

    expect(loadResult.errors).toEqual([]);
    expect(loadResult.locked).toEqual([]);
    expect(loadResult.incompatible).toEqual([]);
    expect(loadResult.warnings).toEqual([]);
    expect(loadResult.pool.baseOnly).toBe(false);
    expect(loadResult.pool.activePacks).toEqual([
      { id: PACK_ID, version: PACK_VERSION },
    ]);
    expect(loadResult.pool.checksum).not.toBe(CSV_CHECKSUM);
    for (const id of PACK_CARD_IDS) {
      expect(loadResult.pool.csv, id).toContain(id);
    }
    // Base rows are always preserved ahead of the pack's rows.
    expect(loadResult.pool.csv.startsWith(CARD_DATA_RAW.split('\n')[0])).toBe(true);

    // 2. Apply: pack templates become available through the single entry point.
    applyMainStreetCardPool(loadResult.pool);
    for (const id of PACK_CARD_IDS) {
      expect(getAvailableTemplateIds(), id).toContain(id);
    }
    expect(getActiveCsvData()).toBe(loadResult.pool.csv);
    expect(getActiveCsvChecksum()).toBe(loadResult.pool.checksum);

    // 3. Play: a fresh game deals from the merged pool and holds a pack card.
    const state = setupMainStreetGame({ seed: 'card-pack-pipeline' });
    state.streetGrid[0] = packBusinessCard();
    expect(collectLiveCardIds(state)).toContain(PACK_BUSINESS_ID);

    // 4. Save: the active pack set, merged CSV and checksum are persisted.
    const saved = serializeMainStreetState(state);
    expect(saved.activePacks).toEqual([{ id: PACK_ID, version: PACK_VERSION }]);
    expect(saved.csvChecksum).toBe(loadResult.pool.checksum);
    expect(saved.csvData).toContain(PACK_BUSINESS_ID);

    // 5. Fresh process: drop the applied pool, then restore the save.
    resetMainStreetCardPacks();
    expect(getAvailableTemplateIds()).not.toContain(PACK_BUSINESS_ID);
    expect(getActiveCsvChecksum()).toBe(CSV_CHECKSUM);

    const restored = deserializeMainStreetState(structuredClone(saved));

    // 6. The same pool is restored: templates, active set and checksum.
    for (const id of PACK_CARD_IDS) {
      expect(getAvailableTemplateIds(), id).toContain(id);
    }
    expect(getActiveCsvChecksum()).toBe(saved.csvChecksum);
    expect(getActiveCsvData()).toBe(loadResult.pool.csv);
    expect(getActiveMainStreetPacks()).toEqual([
      { id: PACK_ID, version: PACK_VERSION },
    ]);
    expect(getAvailableTemplateIds()).toContain(PACK_BUSINESS_ID);
    // The live pack card resolves against the restored pool.
    expect(findMissingLiveTemplateIds(restored)).toEqual([]);
    expect(() => assertLiveTemplatesResolvable(restored)).not.toThrow();
    expect(collectLiveCardIds(restored)).toContain(PACK_BUSINESS_ID);
  });
});

describe('card-pack pipeline — missing-pack degradation', () => {
  it('warns and continues with base content when a saved pack is not installed', async () => {
    const contentDir = makeEmptyContentDir();

    const loadResult = await loadMainStreetCardPacks({
      contentDir,
      ...diskFetchers(contentDir),
      requestedPacks: [{ id: PACK_ID, version: PACK_VERSION }],
      logger: silentLogger,
    });

    expect(loadResult.pool.baseOnly).toBe(true);
    expect(loadResult.pool.csv).toBe(CARD_DATA_RAW);
    expect(loadResult.pool.checksum).toBe(CSV_CHECKSUM);
    expect(loadResult.pool.activePacks).toEqual([]);
    expect(loadResult.warnings).toHaveLength(1);
    expect(loadResult.warnings[0]).toContain(PACK_ID);
    expect(loadResult.warnings[0]).toContain('missing');
  });

  it('refuses to resume only when a live card instance needs the missing template', async () => {
    // Capture a live pack business card while the pack pool is available.
    const withPackDir = makeContentDir();
    const withPack = await loadMainStreetCardPacks({
      contentDir: withPackDir,
      ...diskFetchers(withPackDir),
      logger: silentLogger,
    });
    applyMainStreetCardPool(withPack.pool);
    const liveCard = packBusinessCard();

    // A fresh process now discovers no pack: degrade to base content.
    const contentDir = makeEmptyContentDir();
    const loadResult = await loadMainStreetCardPacks({
      contentDir,
      ...diskFetchers(contentDir),
      requestedPacks: [{ id: PACK_ID, version: PACK_VERSION }],
      logger: silentLogger,
    });
    applyMainStreetCardPool(loadResult.pool);

    // A save with no live pack cards degrades cleanly to base content.
    const baseState = setupMainStreetGame({ seed: 'missing-pack-no-live' });
    expect(findMissingLiveTemplateIds(baseState)).toEqual([]);
    expect(() => assertLiveTemplatesResolvable(baseState)).not.toThrow();

    // A save whose live instance needs the (now missing) pack template refuses.
    const stranded = {
      ...baseState,
      streetGrid: [liveCard, ...baseState.streetGrid.slice(1)],
    } as MainStreetState;
    expect(findMissingLiveTemplateIds(stranded)).toEqual([PACK_BUSINESS_ID]);
    expect(() => assertLiveTemplatesResolvable(stranded)).toThrow(
      MissingCardPackTemplateError,
    );

    // Restoring the pack pool makes the same live instance resolvable again.
    const restoredDir = makeContentDir();
    const loaded = await loadMainStreetCardPacks({
      contentDir: restoredDir,
      ...diskFetchers(restoredDir),
      logger: silentLogger,
    });
    applyMainStreetCardPool(loaded.pool);
    expect(findMissingLiveTemplateIds(stranded)).toEqual([]);
    expect(() => assertLiveTemplatesResolvable(stranded)).not.toThrow();
  });
});
