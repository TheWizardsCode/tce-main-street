/**
 * Multi-source composition & deterministic precedence (`MS-0MVSFWDFW002C1MD`).
 *
 * Pins the guarantees the parent item (`MS-0MV26X8T200852AC`, AC 5) relies on:
 *
 *   - composition order is explicit: the bundled source first, then every
 *     configured remote catalogue in configured URL order;
 *   - bundled content always wins a pack-id conflict, byte-for-byte;
 *   - a pack id offered by two remote catalogues resolves to the
 *     first-registered source;
 *   - composition is additive and idempotent (a duplicate source id is a
 *     no-op and never reorders);
 *   - a remote source that cannot be constructed (or a malformed list entry)
 *     is skipped with a warning while its siblings and bundled content still
 *     serve;
 *   - the change stays inert for an unconfigured build and for the Electron
 *     content-directory path (no remote source, no remote fetch);
 *   - gating is untouched: a remote pack the player is not entitled to is
 *     reported `locked` and contributes no cards.
 *
 * @see src/MainStreetPackSources.ts — `composePackSourceRegistry` /
 *   `createConfiguredPackSourceRegistry`.
 * @see src/MainStreetRemotePackConfig.ts — `parseRemotePackSourceConfigs`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CARD_DATA_RAW } from '../../src/MainStreetCards';
import {
  bootstrapMainStreetCardPacks,
  getAvailableTemplateIds,
  loadMainStreetCardPacks,
  resetMainStreetCardPacks,
} from '../../src/MainStreetCardPacks';
import {
  BUNDLED_PACK_SOURCE_ID,
  REMOTE_PACK_SOURCE_ID,
  composePackSourceRegistry,
  createConfiguredPackSourceRegistry,
  createDefaultPackSourceRegistry,
  remotePackSourceIdForIndex,
  type PackSource,
} from '../../src/MainStreetPackSources';
import { parseRemotePackSourceConfigs } from '../../src/MainStreetRemotePackConfig';
import type { RemotePackEnvLike } from '../../src/MainStreetRemotePackConfig';
import type { RemotePackFetchImpl } from '../../src/MainStreetRemotePackFetch';
import type {
  CardPackClient,
  CardPackStatusRef,
  PackEntitlementStatusLike,
} from '@ui/card-pack-client';
import type { CardPackLoaderOptions } from '@ui/CardPackLoader';
import {
  BASE_HEADER,
  REMOTE_ALLOWED_HOST,
  REMOTE_BASE_URL,
  REMOTE_CARD_ID,
  REMOTE_CSV_PATH,
  REMOTE_PACK_CSV,
  REMOTE_PACK_ID,
  createFakeRemoteTransport,
  createRemotePackSigningKey,
  notFound,
  remotePackConfig,
  remotePackEnv,
  remotePackManifest,
  remotePackManifestEntry,
  remotePackRow,
  type FakeRemoteTransport,
} from './fixtures/remotePackFixtures';

/** A second, distinct remote catalogue on the same allow-listed host. */
const SECOND_BASE_URL = 'https://packs.example.com/second-catalogue';

const SILENT_LOGGER = { warn: () => {} };

const NOTHING_UNLOCKED = {
  isUnlocked: async () => false,
  getUnlocks: async () => [],
  refresh: async () => [],
};

/** Build an ordered multi-catalogue env bag. */
function multiSourceEnv(
  entries: readonly { url: string; publicKey: string }[],
): RemotePackEnvLike {
  return { VITE_REMOTE_PACK_SOURCES: JSON.stringify(entries) };
}

/** Send each request to the fixture transport that owns its base URL. */
function combineTransports(
  entries: readonly { baseUrl: string; transport: FakeRemoteTransport }[],
): RemotePackFetchImpl {
  return async (url, init) => {
    const match = entries.find((entry) =>
      url.startsWith(`${entry.baseUrl.replace(/\/+$/, '')}/packs/`),
    );
    if (!match) return notFound();
    return match.transport.fetch(url, init);
  };
}

/** A one-pack CSV fragment with the base column order. */
function packCsv(cardId: string, name: string): string {
  return [
    BASE_HEADER,
    remotePackRow({
      family: 'business',
      id: cardId,
      name,
      cost: '100',
      baseIncome: '50',
      synergyTypes: 'Residential',
      description: `A card from the ${name} remote catalogue.`,
    }),
  ].join('\n');
}

/** Files a remote host serves for one catalogue containing *packId*. */
async function catalogueFiles(
  key: Awaited<ReturnType<typeof createRemotePackSigningKey>>,
  packId: string,
  csv: string,
  version = '1.0.0',
): Promise<Record<string, string>> {
  return {
    'manifest.json': await key.signEnvelope(
      remotePackManifest({
        packs: [
          remotePackManifestEntry({
            id: packId,
            version,
            title: `${packId} catalogue`,
            assets: [],
          }),
        ],
      }),
    ),
    [`main-street/${packId}/cards.csv`]: csv,
  };
}

/** A client that reports every pack as locked (no ungating shortcut). */
const LOCKING_CLIENT: CardPackClient = {
  isAvailable: async () => true,
  hasCatalog: async () => true,
  supportsDlcCheck: async () => true,
  getCatalog: async () => null,
  getStatus: async (pack) => lockedStatus(pack),
  listStatus: async (packs) => packs.map((pack) => lockedStatus(pack)),
};

function lockedStatus(pack: CardPackStatusRef): PackEntitlementStatusLike {
  return {
    packId: pack.id,
    gameId: pack.gameId ?? null,
    state: 'locked',
    steamAppId: null,
    reason: 'Not entitled.',
  };
}

afterEach(() => {
  resetMainStreetCardPacks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('configured multi-source composition', () => {
  it('registers bundled first, then every remote catalogue in configured URL order', async () => {
    const first = await createRemotePackSigningKey();
    const second = await createRemotePackSigningKey();
    const registry = createConfiguredPackSourceRegistry({
      env: multiSourceEnv([
        { url: REMOTE_BASE_URL, publicKey: first.publicKeyBase64 },
        { url: SECOND_BASE_URL, publicKey: second.publicKeyBase64 },
      ]),
      logger: SILENT_LOGGER,
    });

    expect(registry.sources.map((source) => source.id)).toEqual([
      BUNDLED_PACK_SOURCE_ID,
      REMOTE_PACK_SOURCE_ID,
      remotePackSourceIdForIndex(1),
    ]);
    // The bundled source is genuinely first — the precedence guarantee.
    expect(registry.sources[0]!.id).toBe(BUNDLED_PACK_SOURCE_ID);
  });

  it('keeps the default registry bundled-only (existing callers unchanged)', () => {
    expect(createDefaultPackSourceRegistry().sources.map((source) => source.id)).toEqual([
      BUNDLED_PACK_SOURCE_ID,
    ]);
    const withEmptyEnv = createConfiguredPackSourceRegistry({
      env: {},
      logger: SILENT_LOGGER,
    });
    expect(withEmptyEnv.sources.map((source) => source.id)).toEqual([
      BUNDLED_PACK_SOURCE_ID,
    ]);
  });

  it('parses the ordered list and reports a malformed entry without rejecting its siblings', async () => {
    const key = await createRemotePackSigningKey();
    const parsed = parseRemotePackSourceConfigs(
      multiSourceEnv([
        { url: REMOTE_BASE_URL, publicKey: key.publicKeyBase64 },
        { url: 'not-a-url', publicKey: key.publicKeyBase64 },
      ]),
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.configs.map((config) => config.baseUrl)).toEqual([REMOTE_BASE_URL]);
    expect(parsed.skipped).toHaveLength(1);
    expect(parsed.skipped[0]!.index).toBe(1);
  });

  it('skips a malformed list entry with a warning and composes the valid one', async () => {
    const key = await createRemotePackSigningKey();
    const warnings: string[] = [];
    const registry = createConfiguredPackSourceRegistry({
      env: multiSourceEnv([
        { url: REMOTE_BASE_URL, publicKey: key.publicKeyBase64 },
        { url: 'not-a-url', publicKey: key.publicKeyBase64 },
      ]),
      logger: { warn: (message) => warnings.push(message) },
    });

    expect(registry.sources.map((source) => source.id)).toEqual([
      BUNDLED_PACK_SOURCE_ID,
      REMOTE_PACK_SOURCE_ID,
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('skipped configured remote source #2');
  });

  it('falls back to the single-catalogue variables when the list is unset', async () => {
    const key = await createRemotePackSigningKey();
    const registry = createConfiguredPackSourceRegistry({
      env: remotePackEnv(key.publicKeyBase64),
      logger: SILENT_LOGGER,
    });

    expect(registry.sources.map((source) => source.id)).toEqual([
      BUNDLED_PACK_SOURCE_ID,
      REMOTE_PACK_SOURCE_ID,
    ]);
  });
});

describe('deterministic precedence', () => {
  it('serves bundled content byte-for-byte when a remote source carries the same pack path', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(
      await catalogueFiles(key, REMOTE_PACK_ID, REMOTE_PACK_CSV, '9.9.9'),
    );
    const bundledCsv = `${REMOTE_PACK_CSV}\n`;
    const registry = createConfiguredPackSourceRegistry({
      env: remotePackEnv(key.publicKeyBase64),
      fetchImpl: transport.fetch,
      logger: SILENT_LOGGER,
      bundledModules: {
        text: {
          'manifest.json': async () =>
            JSON.stringify(
              remotePackManifest({
                packs: [
                  remotePackManifestEntry({ version: '0.0.1', title: 'Bundled variant' }),
                ],
              }),
            ),
          [REMOTE_CSV_PATH]: async () => bundledCsv,
        },
        urls: {},
      },
    });

    // Byte-for-byte: the bundled text, never the remote variant's bytes.
    await expect(registry.readPackFile(REMOTE_CSV_PATH)).resolves.toBe(bundledCsv);

    const merged = JSON.parse((await registry.readPackFile('manifest.json'))!);
    expect(merged.packs).toHaveLength(1);
    expect(merged.packs[0]).toMatchObject({ id: REMOTE_PACK_ID, version: '0.0.1' });
  });

  it('resolves a pack id offered by two remote sources to the first-registered source', async () => {
    const first = await createRemotePackSigningKey();
    const second = await createRemotePackSigningKey();
    const firstCsv = `${REMOTE_PACK_CSV}\n# first`;
    const secondCsv = `${REMOTE_PACK_CSV}\n# second`;
    const firstTransport = createFakeRemoteTransport(
      await catalogueFiles(first, REMOTE_PACK_ID, firstCsv, '1.0.0'),
      REMOTE_BASE_URL,
    );
    const secondTransport = createFakeRemoteTransport(
      await catalogueFiles(second, REMOTE_PACK_ID, secondCsv, '2.0.0'),
      SECOND_BASE_URL,
    );

    const registry = createConfiguredPackSourceRegistry({
      env: multiSourceEnv([
        { url: REMOTE_BASE_URL, publicKey: first.publicKeyBase64 },
        { url: SECOND_BASE_URL, publicKey: second.publicKeyBase64 },
      ]),
      fetchImpl: combineTransports([
        { baseUrl: REMOTE_BASE_URL, transport: firstTransport },
        { baseUrl: SECOND_BASE_URL, transport: secondTransport },
      ]),
      logger: SILENT_LOGGER,
    });

    // Both catalogues are consulted...
    const merged = JSON.parse((await registry.readPackFile('manifest.json'))!);
    const offered = merged.packs.filter(
      (pack: { id: string }) => pack.id === REMOTE_PACK_ID,
    );
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ id: REMOTE_PACK_ID, version: '1.0.0' });

    // ...but the shared pack path resolves to the first-registered source.
    await expect(registry.readPackFile(REMOTE_CSV_PATH)).resolves.toBe(firstCsv);
  });
});

describe('idempotent, additive composition', () => {
  it('composing twice yields the same order and no duplicates', async () => {
    const first = await createRemotePackSigningKey();
    const second = await createRemotePackSigningKey();
    const env = multiSourceEnv([
      { url: REMOTE_BASE_URL, publicKey: first.publicKeyBase64 },
      { url: SECOND_BASE_URL, publicKey: second.publicKeyBase64 },
    ]);

    const one = createConfiguredPackSourceRegistry({ env, logger: SILENT_LOGGER });
    const two = createConfiguredPackSourceRegistry({ env, logger: SILENT_LOGGER });

    expect(two.sources.map((source) => source.id)).toEqual(
      one.sources.map((source) => source.id),
    );
  });

  it('ignores a re-added source with a duplicate id and never reorders', async () => {
    const key = await createRemotePackSigningKey();
    const registry = createConfiguredPackSourceRegistry({
      env: multiSourceEnv([{ url: REMOTE_BASE_URL, publicKey: key.publicKeyBase64 }]),
      logger: SILENT_LOGGER,
    });
    const before = registry.sources.map((source) => source.id);

    registry.add(registry.sources[1]!);
    registry.add({
      id: REMOTE_PACK_SOURCE_ID,
      async readPackFile() {
        return 'duplicate';
      },
    } as PackSource);

    expect(registry.sources.map((source) => source.id)).toEqual(before);
    expect(registry.sources).toHaveLength(before.length);
  });
});

describe('resilience', () => {
  it('skips a remote source that throws during construction and keeps bundled content', async () => {
    const key = await createRemotePackSigningKey();
    const config = remotePackConfig(key.publicKeyBase64);
    const warnings: string[] = [];

    const registry = composePackSourceRegistry({
      bundledModules: {
        text: { 'manifest.json': async () => JSON.stringify(remotePackManifest()) },
        urls: {},
      },
      remotes: [
        { id: REMOTE_PACK_SOURCE_ID, config },
        { id: 'remote-broken', config },
      ],
      remoteSourceFactory: (options) => {
        if (options.id === 'remote-broken') {
          throw new Error('cannot build this catalogue');
        }
        return { id: options.id!, async readPackFile() { return null; } };
      },
      logger: { warn: (message) => warnings.push(message) },
    });

    expect(registry.sources.map((source) => source.id)).toEqual([
      BUNDLED_PACK_SOURCE_ID,
      REMOTE_PACK_SOURCE_ID,
    ]);
    expect(warnings.some((message) => message.includes('could not be constructed'))).toBe(
      true,
    );
    // The bundled catalogue still serves despite the failed remote source.
    const manifest = await registry.readPackFile('manifest.json');
    expect(manifest).toContain('packs');
  });
});

describe('inertness', () => {
  it('yields the same boot result as the bundled-only build when configuration is unset', async () => {
    const viaConfig = await bootstrapMainStreetCardPacks({
      contentDir: null,
      remotePackEnv: {},
      contentUnlocks: NOTHING_UNLOCKED,
      storage: null,
      logger: SILENT_LOGGER,
    });
    resetMainStreetCardPacks();
    const viaBundledOnly = await bootstrapMainStreetCardPacks({
      contentDir: null,
      packSources: createDefaultPackSourceRegistry(),
      contentUnlocks: NOTHING_UNLOCKED,
      storage: null,
      logger: SILENT_LOGGER,
    });

    expect(viaConfig).not.toBeNull();
    expect(viaBundledOnly).not.toBeNull();
    expect(viaConfig!.pool.csv).toBe(viaBundledOnly!.pool.csv);
    expect(viaConfig!.pool.baseOnly).toBe(viaBundledOnly!.pool.baseOnly);
    expect(viaConfig!.loaded.map((pack) => pack.manifest.id)).toEqual(
      viaBundledOnly!.loaded.map((pack) => pack.manifest.id),
    );
  });

  it('composes no remote source and fetches nothing for an explicit launcher contentDir', async () => {
    const key = await createRemotePackSigningKey();
    const remoteFetch = vi.fn(async () => notFound());
    const loader = vi.fn(async (_options: CardPackLoaderOptions) => ({
      packs: [],
      incompatible: [],
      locked: [],
      errors: [],
    }));

    const result = await bootstrapMainStreetCardPacks({
      contentDir: '/content',
      loader,
      remotePackEnv: multiSourceEnv([
        { url: REMOTE_BASE_URL, publicKey: key.publicKeyBase64 },
      ]),
      remotePackFetch: remoteFetch,
      contentUnlocks: NOTHING_UNLOCKED,
      storage: null,
      logger: SILENT_LOGGER,
    });

    expect(result).not.toBeNull();
    expect(loader).toHaveBeenCalledOnce();
    const options = loader.mock.calls[0]![0];
    expect(options.fetchManifest).toBeUndefined();
    expect(options.fetchCsv).toBeUndefined();
    expect(options.fetchAsset).toBeUndefined();
    expect(remoteFetch).not.toHaveBeenCalled();
    expect(result!.pool.csv).toBe(CARD_DATA_RAW);
  });
});

describe('applied pool and gating parity', () => {
  it('applies cards from several remote catalogues through the boot path', async () => {
    const first = await createRemotePackSigningKey();
    const second = await createRemotePackSigningKey();
    const FIRST_PACK_ID = 'main-street-remote-first';
    const SECOND_PACK_ID = 'main-street-remote-second';
    const FIRST_CARD_ID = 'biz-ms-remote-first-card';
    const SECOND_CARD_ID = 'biz-ms-remote-second-card';

    const firstTransport = createFakeRemoteTransport(
      await catalogueFiles(
        first,
        FIRST_PACK_ID,
        packCsv(FIRST_CARD_ID, 'First remote'),
      ),
      REMOTE_BASE_URL,
    );
    const secondTransport = createFakeRemoteTransport(
      await catalogueFiles(
        second,
        SECOND_PACK_ID,
        packCsv(SECOND_CARD_ID, 'Second remote'),
      ),
      SECOND_BASE_URL,
    );

    const result = await bootstrapMainStreetCardPacks({
      contentDir: null,
      remotePackEnv: multiSourceEnv([
        { url: REMOTE_BASE_URL, publicKey: first.publicKeyBase64 },
        { url: SECOND_BASE_URL, publicKey: second.publicKeyBase64 },
      ]),
      remotePackFetch: combineTransports([
        { baseUrl: REMOTE_BASE_URL, transport: firstTransport },
        { baseUrl: SECOND_BASE_URL, transport: secondTransport },
      ]),
      fetchAsset: async () => new Uint8Array([0]),
      contentUnlocks: NOTHING_UNLOCKED,
      storage: null,
      logger: SILENT_LOGGER,
    });

    expect(result).not.toBeNull();
    expect(result!.loaded.map((pack) => pack.manifest.id)).toEqual(
      expect.arrayContaining([FIRST_PACK_ID, SECOND_PACK_ID]),
    );
    expect(getAvailableTemplateIds()).toEqual(
      expect.arrayContaining([FIRST_CARD_ID, SECOND_CARD_ID]),
    );
    expect(result!.pool.csv).toContain(FIRST_CARD_ID);
    expect(result!.pool.csv).toContain(SECOND_CARD_ID);
  });

  it('reports an unentitled remote pack locked and never merges its cards', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await catalogueFiles(key, REMOTE_PACK_ID, REMOTE_PACK_CSV));
    const registry = createConfiguredPackSourceRegistry({
      env: multiSourceEnv([{ url: REMOTE_BASE_URL, publicKey: key.publicKeyBase64 }]),
      fetchImpl: transport.fetch,
      logger: SILENT_LOGGER,
    });

    const result = await loadMainStreetCardPacks({
      contentDir: REMOTE_BASE_URL,
      packSources: registry,
      client: LOCKING_CLIENT,
      contentUnlocks: NOTHING_UNLOCKED,
      logger: SILENT_LOGGER,
    });

    expect(result.locked.map((pack) => pack.manifest.id)).toContain(REMOTE_PACK_ID);
    expect(result.loaded.map((pack) => pack.manifest.id)).not.toContain(REMOTE_PACK_ID);
    expect(result.pool.csv).not.toContain(REMOTE_CARD_ID);
    // The remote host was still allow-listed and reachable: the refusal is the
    // entitlement gate, not a discovery failure.
    expect(transport.calls.every((url) => new URL(url).host === REMOTE_ALLOWED_HOST)).toBe(
      true,
    );
  });
});
