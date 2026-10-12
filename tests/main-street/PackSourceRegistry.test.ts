/**
 * Main Street pack-source registry and bundled source (unit).
 *
 * Covers the registry contract the browser distribution relies on: strict
 * source ordering, additive registration, total degradation for unknown refs /
 * missing files / empty registries, the Vite `import.meta.glob` bundled source,
 * and wiring into the existing `fetchManifest` / `fetchCsv` loader seams with
 * no `tce-packs://` request.
 *
 * Child of `MS-0MV1O7EGG004MWGD` ("Pack-source registry and bundled source",
 * `MS-0MV53CFUS004DFX1`).
 *
 * @see src/MainStreetPackSources.ts
 * @see src/MainStreetCardPacks.ts
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CARD_DATA_RAW } from '../../src/MainStreetCards';
import {
  loadMainStreetCardPacks,
  resetMainStreetCardPacks,
} from '../../src/MainStreetCardPacks';
import {
  BUNDLED_PACK_SOURCE_ID,
  PackSourceRegistry,
  createBundledPackSource,
  createDefaultPackSourceRegistry,
  createPackSourceTransports,
  packPathFromManifestUrl,
  packPathFromPackUrl,
  resolvePackAssetUrl,
  type PackSource,
} from '../../src/MainStreetPackSources';

const RESIDENTIAL_PACK_ID = 'main-street-residential-pack';
const RESIDENTIAL_GAME_ID = 'main-street';
const RESIDENTIAL_CARD_ID = 'biz-ms-residential-property-mgmt';

const BASE_HEADER = CARD_DATA_RAW.split('\n')[0];
const BASE_COLUMNS = BASE_HEADER.split(',');

/** Build a pack CSV row with the base column order. */
function packRow(fields: Record<string, string>): string {
  return BASE_COLUMNS.map((column) => fields[column] ?? '').join(',');
}

const MANIFEST = JSON.stringify({
  version: 1,
  packs: [
    {
      id: RESIDENTIAL_PACK_ID,
      gameId: RESIDENTIAL_GAME_ID,
      title: 'Main Street Residential',
      description: 'Test manifest.',
      version: '1.0.0',
      coreEngineVersion: '^0.1.0',
      cards: 'cards.csv',
      assets: [`assets/${RESIDENTIAL_CARD_ID}.png`],
    },
  ],
});

const PACK_CSV = [
  BASE_HEADER,
  packRow({
    family: 'business',
    id: RESIDENTIAL_CARD_ID,
    name: 'Residential Property Management',
    cost: '300',
    baseIncome: '120',
    synergyTypes: 'Residential',
    description: 'A bundled residential pack card.',
  }),
].join('\n');

/** A total in-memory source over a packs-relative text map. */
function memorySource(
  id: string,
  files: Readonly<Record<string, string>>,
  urls: Readonly<Record<string, string>> = {},
): PackSource {
  return {
    id,
    async readPackFile(path) {
      return Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null;
    },
    async resolvePackFileUrl(path) {
      return Object.prototype.hasOwnProperty.call(urls, path) ? urls[path] : null;
    },
  };
}

afterEach(() => {
  resetMainStreetCardPacks();
  vi.restoreAllMocks();
});

describe('PackSourceRegistry ordering', () => {
  it('consults sources in registration order and returns the first hit', async () => {
    const first = memorySource('first', { 'manifest.json': 'first-manifest' });
    const second = memorySource('second', {
      'manifest.json': 'second-manifest',
      'main-street/pack/cards.csv': 'second-csv',
    });
    const registry = new PackSourceRegistry([first, second]);

    expect(registry.sources.map((source) => source.id)).toEqual(['first', 'second']);
    await expect(registry.readPackFile('manifest.json')).resolves.toBe('first-manifest');
    // A path the first source does not carry falls through to the second.
    await expect(registry.readPackFile('main-street/pack/cards.csv')).resolves.toBe('second-csv');
  });

  it('skips a source that throws or returns a non-string', async () => {
    const throwing: PackSource = {
      id: 'throwing',
      async readPackFile() {
        throw new Error('boom');
      },
    };
    const good = memorySource('good', { 'manifest.json': 'good' });
    const registry = new PackSourceRegistry([throwing, good]);

    await expect(registry.readPackFile('manifest.json')).resolves.toBe('good');
    await expect(registry.readPackFile('missing.json')).resolves.toBeNull();
  });
});

describe('PackSourceRegistry additive registration', () => {
  it('adds a source without removing or reordering existing ones', async () => {
    const bundled = memorySource('bundled', { 'manifest.json': 'bundled' });
    const registry = new PackSourceRegistry([bundled]);

    const remote = memorySource('remote', { 'main-street/pack/cards.csv': 'remote-csv' });
    registry.add(remote);

    expect(registry.sources.map((source) => source.id)).toEqual(['bundled', 'remote']);
    // The original source is untouched...
    await expect(registry.readPackFile('manifest.json')).resolves.toBe('bundled');
    // ...and the new source is consulted.
    await expect(registry.readPackFile('main-street/pack/cards.csv')).resolves.toBe('remote-csv');
  });

  it('ignores an invalid source and a duplicate id', () => {
    const registry = new PackSourceRegistry();
    registry.add({ id: 'ok', readPackFile: async () => 'ok' });
    registry.add({ id: 'ok', readPackFile: async () => 'duplicate' });
    registry.add({ id: '', readPackFile: async () => 'no-id' } as unknown as PackSource);
    registry.add({ id: 'no-reader' } as unknown as PackSource);

    expect(registry.sources.map((source) => source.id)).toEqual(['ok']);
  });

  it('returns a defensive copy of the source list', () => {
    const registry = new PackSourceRegistry([memorySource('a', {})]);
    const sources = registry.sources as PackSource[];
    sources.push(memorySource('b', {}));
    expect(registry.sources.map((source) => source.id)).toEqual(['a']);
  });
});

describe('PackSourceRegistry total degradation', () => {
  it('returns null from an empty registry', async () => {
    const registry = new PackSourceRegistry();
    await expect(registry.readPackFile('manifest.json')).resolves.toBeNull();
    await expect(registry.resolvePackFileUrl('a/b.png')).resolves.toBeNull();
  });

  it('returns null for an unknown path', async () => {
    const registry = new PackSourceRegistry([memorySource('a', { 'manifest.json': 'm' })]);
    await expect(registry.readPackFile('nope/cards.csv')).resolves.toBeNull();
  });

  it('leaves the core loader on base content when the registry is empty', async () => {
    const registry = new PackSourceRegistry();
    const result = await loadMainStreetCardPacks({
      contentDir: 'bundled://main-street',
      packSources: registry,
      logger: { warn: () => {} },
    });

    expect(result.pool.baseOnly).toBe(true);
    expect(result.pool.csv).toBe(CARD_DATA_RAW);
    // The failure is reported structurally, never thrown.
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('bundled pack source', () => {
  const modules = {
    text: {
      'manifest.json': async () => MANIFEST,
      [`${RESIDENTIAL_GAME_ID}/${RESIDENTIAL_PACK_ID}/cards.csv`]: async () => PACK_CSV,
    },
    urls: {
      [`${RESIDENTIAL_GAME_ID}/${RESIDENTIAL_PACK_ID}/assets/${RESIDENTIAL_CARD_ID}.png`]:
        async () => '/assets/residential-hash.png',
    },
  };

  it('reads packed text and asset URLs by packs-relative path', async () => {
    const source = createBundledPackSource(modules);
    expect(source.id).toBe(BUNDLED_PACK_SOURCE_ID);
    await expect(source.readPackFile('manifest.json')).resolves.toBe(MANIFEST);
    await expect(
      source.readPackFile(`${RESIDENTIAL_GAME_ID}/${RESIDENTIAL_PACK_ID}/cards.csv`),
    ).resolves.toBe(PACK_CSV);
    await expect(
      source.resolvePackFileUrl!(
        `${RESIDENTIAL_GAME_ID}/${RESIDENTIAL_PACK_ID}/assets/${RESIDENTIAL_CARD_ID}.png`,
      ),
    ).resolves.toBe('/assets/residential-hash.png');
  });

  it('is total for missing files, traversal and loader rejections', async () => {
    const source = createBundledPackSource({
      text: {
        'manifest.json': async () => {
          throw new Error('read failed');
        },
      },
      urls: {},
    });

    await expect(source.readPackFile('missing.json')).resolves.toBeNull();
    await expect(source.readPackFile('../secret.txt')).resolves.toBeNull();
    await expect(source.readPackFile('')).resolves.toBeNull();
    // A rejecting loader degrades to null.
    await expect(source.readPackFile('manifest.json')).resolves.toBeNull();
    await expect(source.resolvePackFileUrl!('any.png')).resolves.toBeNull();
  });

  it('resolves the committed production pack through the real glob map', async () => {
    const source = createBundledPackSource();

    const manifestText = await source.readPackFile('manifest.json');
    expect(manifestText).not.toBeNull();
    expect(manifestText).toContain(RESIDENTIAL_PACK_ID);

    const csv = await source.readPackFile(
      `${RESIDENTIAL_GAME_ID}/${RESIDENTIAL_PACK_ID}/cards.csv`,
    );
    expect(csv).not.toBeNull();
    expect(csv).toContain(RESIDENTIAL_CARD_ID);

    // `?url` yields a browser-usable same-origin/relative URL — never the
    // Electron-only `tce-packs://` scheme.
    const assetUrl = await source.resolvePackFileUrl!(
      `${RESIDENTIAL_GAME_ID}/${RESIDENTIAL_PACK_ID}/assets/${RESIDENTIAL_CARD_ID}.png`,
    );
    expect(typeof assetUrl).toBe('string');
    expect(assetUrl).not.toContain('tce-packs://');
  });
});

describe('URL → packs-relative path mapping', () => {
  it('maps manifest URLs under any scheme to `manifest.json`', () => {
    expect(packPathFromManifestUrl('file:///content/packs/manifest.json')).toBe('manifest.json');
    expect(packPathFromManifestUrl('https://host/base/packs/manifest.json')).toBe('manifest.json');
    expect(packPathFromManifestUrl('bundled://main-street/packs/manifest.json')).toBe('manifest.json');
    expect(packPathFromManifestUrl('manifest.json')).toBe('manifest.json');
    expect(packPathFromManifestUrl('https://host/base/cards.csv')).toBeNull();
  });

  it('maps tce-packs URLs to `<gameId>/<packId>/<path>` and rejects other schemes', () => {
    expect(
      packPathFromPackUrl(
        `tce-packs://${RESIDENTIAL_GAME_ID}/${RESIDENTIAL_PACK_ID}/cards.csv`,
      ),
    ).toBe(`${RESIDENTIAL_GAME_ID}/${RESIDENTIAL_PACK_ID}/cards.csv`);
    // Host/ids are lower-cased to match on-disk pack directory semantics.
    expect(packPathFromPackUrl('tce-packs://Main-Street/Pack/assets/A.png')).toBe(
      'main-street/pack/assets/A.png',
    );
    expect(packPathFromPackUrl('https://host/pack/cards.csv')).toBeNull();
    expect(packPathFromPackUrl('tce-packs://main-street/pack')).toBeNull();
  });
});

describe('loader transport wiring', () => {
  it('serves manifest and CSV from the registry through the loader seams', async () => {
    const registry = new PackSourceRegistry([
      createBundledPackSource({
        text: {
          'manifest.json': async () => MANIFEST,
          [`${RESIDENTIAL_GAME_ID}/${RESIDENTIAL_PACK_ID}/cards.csv`]: async () => PACK_CSV,
        },
        urls: {},
      }),
    ]);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await loadMainStreetCardPacks({
      contentDir: 'bundled://main-street',
      packSources: registry,
      contentUnlocks: {
        isUnlocked: async () => true,
        getUnlocks: async () => [],
        refresh: async () => [],
      },
      logger: { warn: () => {} },
    });

    // The bundled source supplied the production pack, with no core-loader
    // change and no `tce-packs://` / network request.
    expect(result.pool.activePacks).toEqual([{ id: RESIDENTIAL_PACK_ID, version: '1.0.0' }]);
    expect(result.pool.csv).toContain(RESIDENTIAL_CARD_ID);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lets an explicit transport override the registry', async () => {
    const registry = new PackSourceRegistry([
      createBundledPackSource({
        text: { 'manifest.json': async () => MANIFEST },
        urls: {},
      }),
    ]);
    const explicitManifest = JSON.stringify({ version: 1, packs: [] });

    const result = await loadMainStreetCardPacks({
      contentDir: 'bundled://main-street',
      packSources: registry,
      fetchManifest: async () => explicitManifest,
      logger: { warn: () => {} },
    });

    expect(result.pool.baseOnly).toBe(true);
  });

  it('defaults to the bundled registry so the committed pack is loadable', async () => {
    const transports = createPackSourceTransports();
    const manifestText = await transports.fetchManifest(
      'bundled://main-street/packs/manifest.json',
    );
    expect(manifestText).toContain(RESIDENTIAL_PACK_ID);

    const csv = await transports.fetchCsv(
      `tce-packs://${RESIDENTIAL_GAME_ID}/${RESIDENTIAL_PACK_ID}/cards.csv`,
    );
    expect(csv).toContain(RESIDENTIAL_CARD_ID);
  });

  it('degrades to base content when the registry cannot resolve the manifest', async () => {
    const transports = createPackSourceTransports(new PackSourceRegistry());
    await expect(transports.fetchManifest('bundled://main-street/packs/manifest.json')).rejects.toThrow();
    await expect(
      transports.fetchCsv(`tce-packs://${RESIDENTIAL_GAME_ID}/${RESIDENTIAL_PACK_ID}/cards.csv`),
    ).rejects.toThrow();

    const result = await loadMainStreetCardPacks({
      contentDir: 'bundled://main-street',
      packSources: new PackSourceRegistry(),
      logger: { warn: () => {} },
    });
    expect(result.pool.baseOnly).toBe(true);
    expect(result.pool.csv).toBe(CARD_DATA_RAW);
  });

  it('resolves pack asset URLs through the registry without a tce-packs request', async () => {
    const registry = createDefaultPackSourceRegistry();
    const url = await resolvePackAssetUrl(
      registry,
      `tce-packs://${RESIDENTIAL_GAME_ID}/${RESIDENTIAL_PACK_ID}/assets/${RESIDENTIAL_CARD_ID}.png`,
    );
    expect(typeof url).toBe('string');
    expect(url).not.toContain('tce-packs://');
  });
});
