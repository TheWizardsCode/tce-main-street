/**
 * Remote pack degradation & bounded timeout hardening (`MS-0MVSFWCFZ0097D93`).
 *
 * The tracer bullet (`MS-0MVSFWBE6004SPDI`) proves the happy path. This file
 * pins the failure paths the parent's risk register concentrates on — boot
 * latency and offline regression — end to end through the public seams:
 *
 *   - every remote read (manifest **and** each pack CSV) is bounded by one
 *     exported ≈3 s constant, enforced with `AbortController` and a deadline
 *     race so even a transport that ignores the signal cannot stall boot;
 *   - the abort timer is cleared on success, error and timeout, so no handle
 *     outlives a request;
 *   - an unreachable host, a rejected `fetch`, a non-2xx response, a timeout
 *     and an unparseable manifest each boot on bundled content with exactly
 *     one source warning and no throw;
 *   - an unsupported manifest schema/version, a missing `cards` file, a wrong
 *     CSV header and a duplicate card id are each rejected whole with a
 *     warning naming the pack and the reason, without disturbing siblings;
 *   - one unreadable pack CSV degrades only that pack;
 *   - the Card Packs listing input is never empty when a bundled pack exists;
 *   - the remote path performs no `localStorage` / Cache Storage writes.
 *
 * Every fetch goes through an injected transport and the timeout assertions
 * use fake timers — no test performs real network I/O or waits a real 3 s.
 *
 * @see src/MainStreetRemotePackFetch.ts — the bounded, allow-listed read.
 * @see src/MainStreetPackSources.ts — catalogue verification + source.
 * @see src/MainStreetCardPacks.ts — discovery, merge warnings, boot wiring.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_REMOTE_PACK_TIMEOUT_MS,
  createRemotePackTextFetcher,
  type RemotePackFetchImpl,
  type RemotePackFetchResponse,
} from '../../src/MainStreetRemotePackFetch';
import {
  SUPPORTED_REMOTE_PACK_MANIFEST_VERSION,
  createConfiguredPackSourceRegistry,
  createRemotePackSource,
} from '../../src/MainStreetPackSources';
import {
  bootstrapMainStreetCardPacks,
  loadMainStreetCardPacks,
  resetMainStreetCardPacks,
  toCardPackListingInput,
} from '../../src/MainStreetCardPacks';
import { CARD_DATA_RAW } from '../../src/MainStreetCards';
import {
  BASE_HEADER,
  REMOTE_BASE_URL,
  REMOTE_CARD_ID,
  REMOTE_CSV_PATH,
  REMOTE_PACK_CSV,
  REMOTE_PACK_ID,
  createFakeRemoteTransport,
  createRemotePackSigningKey,
  ok,
  remotePackConfig,
  remotePackEnv,
  remotePackFiles,
  remotePackManifest,
  remotePackManifestEntry,
  remotePackRow,
  type RemotePackSigningKey,
} from './fixtures/remotePackFixtures';

/** The bundled, content-unlock-gated pack every failure path must preserve. */
const RESIDENTIAL_PACK_ID = 'main-street-residential-pack';

/** The manifest URL a configured source requests first. */
const MANIFEST_URL = `${REMOTE_BASE_URL}/packs/manifest.json`;

/** No warnings reach the console; each test asserts what it needs explicitly. */
const SILENT_LOGGER = { warn: () => {} };

/** A content-unlock client that reports nothing unlocked. */
const NOTHING_UNLOCKED = {
  isUnlocked: async () => false,
  getUnlocks: async () => [],
  refresh: async () => [],
};

/** Asset bytes for the injected asset transport (no network, no real art). */
const NO_ASSET_BYTES = async () => new Uint8Array([0]);

/** The fetcher config; the key is irrelevant to the host allow-list. */
const FETCHER_CONFIG = remotePackConfig('unused-public-key');

/** Collect warnings so a test can assert "exactly one". */
function warningSink(): { warnings: string[]; logger: { warn(m: string): void } } {
  const warnings: string[] = [];
  return { warnings, logger: { warn: (message: string) => warnings.push(message) } };
}

/** A transport that never settles and ignores the abort signal. */
const hangingTransport: RemotePackFetchImpl = () =>
  new Promise<RemotePackFetchResponse>(() => {});

/**
 * Boot the browser discovery path over a remote catalogue, capturing the
 * **source-level** warnings separately from the loader's own warnings.
 *
 * The source logger is deliberately distinct from the load logger: a remote
 * failure must produce exactly one source warning regardless of unrelated
 * listing warnings (e.g. the bundled pack being content-unlock gated).
 */
async function bootRemote(options: {
  key?: RemotePackSigningKey;
  files?: Record<string, string>;
  manifest?: Record<string, unknown>;
  fetchImpl?: RemotePackFetchImpl;
  timeoutMs?: number;
}) {
  const key = options.key ?? (await createRemotePackSigningKey());
  const files =
    options.files ??
    (await remotePackFiles(
      key,
      options.manifest ? { manifest: options.manifest } : {},
    ));
  const transport = createFakeRemoteTransport(files);
  const { warnings: sourceWarnings, logger } = warningSink();
  const registry = createConfiguredPackSourceRegistry({
    env: remotePackEnv(key.publicKeyBase64),
    fetchImpl: options.fetchImpl ?? transport.fetch,
    timeoutMs: options.timeoutMs,
    logger,
  });

  const result = await loadMainStreetCardPacks({
    contentDir: REMOTE_BASE_URL,
    packSources: registry,
    contentUnlocks: NOTHING_UNLOCKED,
    fetchAsset: NO_ASSET_BYTES,
    logger: SILENT_LOGGER,
  });

  return { key, files, transport, result, sourceWarnings };
}

/** A one-row pack CSV fragment for *packId*'s card *cardId*. */
function packCsvFor(cardId: string, name: string): string {
  return [
    BASE_HEADER,
    remotePackRow({
      family: 'business',
      id: cardId,
      name,
      cost: '260',
      baseIncome: '95',
      synergyTypes: 'Residential',
      description: `A card from ${name}.`,
    }),
  ].join('\n');
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetMainStreetCardPacks();
});

describe('bounded timeout', () => {
  it('exports the ≈3 s default as a single constant', () => {
    expect(DEFAULT_REMOTE_PACK_TIMEOUT_MS).toBe(3000);
  });

  it('resolves null at the default deadline when the transport ignores the abort signal', async () => {
    vi.useFakeTimers();
    const { logger, warnings } = warningSink();
    const fetcher = createRemotePackTextFetcher({
      config: FETCHER_CONFIG,
      logger,
      fetchText: hangingTransport,
    });

    let settled = false;
    const pending = fetcher(MANIFEST_URL).then((value) => {
      settled = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_REMOTE_PACK_TIMEOUT_MS - 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('timed out');
    expect(warnings[0]).toContain(`${DEFAULT_REMOTE_PACK_TIMEOUT_MS}ms`);
  });

  it('honours an explicit timeout override', async () => {
    vi.useFakeTimers();
    const { logger } = warningSink();
    const fetcher = createRemotePackTextFetcher({
      config: FETCHER_CONFIG,
      logger,
      fetchText: hangingTransport,
      timeoutMs: 25,
    });

    let settled = false;
    const pending = fetcher(MANIFEST_URL).then((value) => {
      settled = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(24);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
  });

  it('aborts the request through AbortController at the deadline', async () => {
    vi.useFakeTimers();
    const { logger } = warningSink();
    let signal: AbortSignal | undefined;
    const fetcher = createRemotePackTextFetcher({
      config: FETCHER_CONFIG,
      logger,
      timeoutMs: 10,
      fetchText: (_url, init) => {
        signal = init.signal;
        return new Promise<RemotePackFetchResponse>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        });
      },
    });

    const pending = fetcher(MANIFEST_URL);
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
  });

  it('bounds a pack CSV read as well as the manifest read', async () => {
    const key = await createRemotePackSigningKey();
    const files = await remotePackFiles(key);
    const transport = createFakeRemoteTransport(files);
    const { logger, warnings } = warningSink();
    const source = createRemotePackSource({
      config: remotePackConfig(key.publicKeyBase64),
      fetchImpl: (url, init) =>
        url.endsWith('/cards.csv')
          ? new Promise<RemotePackFetchResponse>((_resolve, reject) => {
              init.signal?.addEventListener('abort', () =>
                reject(new Error('aborted')),
              );
            })
          : transport.fetch(url, init),
      logger,
    });

    await expect(source.readPackFile('manifest.json')).resolves.not.toBeNull();

    vi.useFakeTimers();
    const pending = source.readPackFile(REMOTE_CSV_PATH);
    await vi.advanceTimersByTimeAsync(DEFAULT_REMOTE_PACK_TIMEOUT_MS);
    await expect(pending).resolves.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('timed out');
  });

  it('bounds a body read that never settles after the headers arrive', async () => {
    vi.useFakeTimers();
    const { logger, warnings } = warningSink();
    const fetcher = createRemotePackTextFetcher({
      config: FETCHER_CONFIG,
      logger,
      timeoutMs: 10,
      fetchText: async () => ({
        ok: true,
        status: 200,
        text: () => new Promise<string>(() => {}),
      }),
    });

    const pending = fetcher(MANIFEST_URL);
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('timed out');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the abort timer after a successful read', async () => {
    vi.useFakeTimers();
    const { logger } = warningSink();
    const fetcher = createRemotePackTextFetcher({
      config: FETCHER_CONFIG,
      logger,
      fetchText: async () => ok('manifest-text'),
    });

    await expect(fetcher(MANIFEST_URL)).resolves.toBe('manifest-text');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the abort timer after a transport failure', async () => {
    vi.useFakeTimers();
    const { logger } = warningSink();
    const fetcher = createRemotePackTextFetcher({
      config: FETCHER_CONFIG,
      logger,
      fetchText: async () => {
        throw new Error('network down');
      },
    });

    await expect(fetcher(MANIFEST_URL)).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the abort timer after a timeout', async () => {
    vi.useFakeTimers();
    const { logger } = warningSink();
    const fetcher = createRemotePackTextFetcher({
      config: FETCHER_CONFIG,
      logger,
      fetchText: hangingTransport,
      timeoutMs: 10,
    });

    const pending = fetcher(MANIFEST_URL);
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('degradation on the boot path', () => {
  const FAILURE_MODES: ReadonlyArray<{
    readonly name: string;
    readonly transport: RemotePackFetchImpl;
    readonly warning: string;
    readonly timeoutMs?: number;
  }> = [
    {
      name: 'an unreachable host',
      transport: async () => {
        throw new TypeError('fetch failed');
      },
      warning: 'fetch failed',
    },
    {
      name: 'a synchronously rejecting fetch',
      transport: (() => {
        throw new TypeError('Failed to fetch');
      }) as unknown as RemotePackFetchImpl,
      warning: 'Failed to fetch',
    },
    {
      name: 'a non-2xx response',
      transport: async () => ({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => '',
      }),
      warning: '503',
    },
    {
      name: 'a timeout abort',
      transport: hangingTransport,
      warning: 'timed out',
      timeoutMs: 5,
    },
    {
      name: 'an unparseable manifest',
      transport: async () => ok('{not json'),
      warning: 'malformed-envelope',
    },
  ];

  for (const mode of FAILURE_MODES) {
    it(`boots on bundled content with exactly one source warning for ${mode.name}`, async () => {
      const { result, sourceWarnings } = await bootRemote({
        fetchImpl: mode.transport,
        timeoutMs: mode.timeoutMs,
      });

      // No throw, base content, nothing from the remote source.
      expect(result.pool.baseOnly).toBe(true);
      expect(result.pool.csv).toBe(CARD_DATA_RAW);
      expect(result.loaded).toEqual([]);

      // The bundled (gated) pack is still discoverable, so the listing is not
      // empty.
      const listing = toCardPackListingInput(result, []);
      expect(listing.locked.map((pack) => pack.manifest.id)).toContain(
        RESIDENTIAL_PACK_ID,
      );

      // Exactly one actionable warning, naming the reason.
      expect(sourceWarnings).toHaveLength(1);
      expect(sourceWarnings[0]).toContain(mode.warning);
    });
  }

  it('keeps the Card Packs listing input non-empty when the remote source fails', async () => {
    const { result } = await bootRemote({
      fetchImpl: async () => {
        throw new TypeError('offline');
      },
    });

    const listing = toCardPackListingInput(result, []);
    expect([...listing.packs, ...listing.locked].length).toBeGreaterThan(0);
    expect(listing.locked.map((pack) => pack.manifest.id)).toContain(
      RESIDENTIAL_PACK_ID,
    );
  });
});

describe('rejection of bad remote data', () => {
  it('rejects a catalogue with an unsupported manifest version whole, with one warning', async () => {
    const key = await createRemotePackSigningKey();
    const { result, sourceWarnings } = await bootRemote({
      key,
      manifest: remotePackManifest({
        version: SUPPORTED_REMOTE_PACK_MANIFEST_VERSION + 1,
      }),
    });

    expect(result.loaded).toEqual([]);
    expect(result.pool.baseOnly).toBe(true);
    expect(sourceWarnings).toHaveLength(1);
    expect(sourceWarnings[0]).toContain('unsupported manifest version');
  });

  it('rejects a catalogue with an unexpected schema whole, with one warning', async () => {
    const key = await createRemotePackSigningKey();
    const { result, sourceWarnings } = await bootRemote({
      key,
      files: {
        'manifest.json': await key.signEnvelope({ version: 1 }),
        [REMOTE_CSV_PATH]: REMOTE_PACK_CSV,
      },
    });

    expect(result.loaded).toEqual([]);
    expect(result.pool.baseOnly).toBe(true);
    expect(sourceWarnings).toHaveLength(1);
    expect(sourceWarnings[0]).toContain('malformed manifest');
  });

  it('rejects a pack whose cards file is missing whole, with one warning', async () => {
    const key = await createRemotePackSigningKey();
    const files = await remotePackFiles(key);
    delete files[REMOTE_CSV_PATH];

    const { result, sourceWarnings } = await bootRemote({ key, files });

    expect(result.loaded).toEqual([]);
    expect(result.pool.baseOnly).toBe(true);
    expect(result.pool.csv).toBe(CARD_DATA_RAW);
    expect(sourceWarnings).toHaveLength(1);
    expect(sourceWarnings[0]).toContain(REMOTE_PACK_ID);
    expect(sourceWarnings[0]).toContain('404');
  });

  it('degrades only the unreadable pack, still merging a sibling pack from the same source', async () => {
    const key = await createRemotePackSigningKey();
    const brokenPackId = 'main-street-remote-broken-pack';
    const manifest = remotePackManifest({
      packs: [
        remotePackManifestEntry({ assets: [] }),
        remotePackManifestEntry({
          id: brokenPackId,
          title: 'Broken remote pack',
          assets: [],
        }),
      ],
    });
    const files = await remotePackFiles(key, { manifest });

    const { result, sourceWarnings } = await bootRemote({ key, files });

    // The healthy pack still loads and merges; the broken one contributes
    // nothing.
    expect(result.loaded.map((pack) => pack.manifest.id)).toEqual([
      REMOTE_PACK_ID,
    ]);
    expect(result.pool.activePacks).toEqual([
      { id: REMOTE_PACK_ID, version: '1.0.0' },
    ]);
    expect(result.pool.csv).toContain(REMOTE_CARD_ID);
    expect(sourceWarnings).toHaveLength(1);
    expect(sourceWarnings[0]).toContain(brokenPackId);
  });

  it('rejects a pack with a wrong CSV header whole, warning once and leaving other sources intact', async () => {
    const key = await createRemotePackSigningKey();
    const badCsv = ['wrong,header', 'a,b'].join('\n');
    const files = {
      'manifest.json': await key.signEnvelope(
        remotePackManifest({
          packs: [remotePackManifestEntry({ assets: [] })],
        }),
      ),
      [REMOTE_CSV_PATH]: badCsv,
    };

    const { result } = await bootRemote({ key, files });

    expect(result.pool.baseOnly).toBe(true);
    expect(result.pool.csv).toBe(CARD_DATA_RAW);
    expect(result.pool.errors.some((error) => error.includes('header'))).toBe(
      true,
    );
    const warning = result.warnings.find(
      (entry) => entry.includes(REMOTE_PACK_ID) && entry.includes('rejected'),
    );
    expect(warning).toBeDefined();
    expect(warning).toContain('header');

    // The bundled source is unaffected.
    expect(result.locked.map((pack) => pack.manifest.id)).toContain(
      RESIDENTIAL_PACK_ID,
    );
  });

  it('rejects a wrong-header pack whole without affecting a sibling remote pack', async () => {
    const key = await createRemotePackSigningKey();
    const brokenPackId = 'main-street-remote-header-pack';
    const manifest = remotePackManifest({
      packs: [
        remotePackManifestEntry({ assets: [] }),
        remotePackManifestEntry({
          id: brokenPackId,
          title: 'Wrong header pack',
          assets: [],
        }),
      ],
    });
    const files = {
      'manifest.json': await key.signEnvelope(manifest),
      [REMOTE_CSV_PATH]: REMOTE_PACK_CSV,
      [`main-street/${brokenPackId}/cards.csv`]: ['wrong,header', 'a,b'].join(
        '\n',
      ),
    };

    const { result } = await bootRemote({ key, files });

    // Only the healthy sibling pack merged; the wrong-header pack is rejected
    // whole and its rows never reach the pool.
    expect(result.pool.activePacks).toEqual([
      { id: REMOTE_PACK_ID, version: '1.0.0' },
    ]);
    expect(result.pool.csv).toContain(REMOTE_CARD_ID);
    expect(result.pool.csv).not.toContain('wrong,header');
    expect(result.pool.errors.some((error) => error.includes('header'))).toBe(
      true,
    );

    const warning = result.warnings.find(
      (entry) => entry.includes(brokenPackId) && entry.includes('rejected'),
    );
    expect(warning).toBeDefined();
    expect(warning).toContain('header');

    // The bundled source is unaffected too.
    expect(result.locked.map((pack) => pack.manifest.id)).toContain(
      RESIDENTIAL_PACK_ID,
    );
  });

  it('rejects a pack that duplicates an accepted card id, leaving a sibling pack active', async () => {
    const key = await createRemotePackSigningKey();
    const duplicatePackId = 'main-street-remote-duplicate-pack';
    const manifest = remotePackManifest({
      packs: [
        remotePackManifestEntry({ assets: [] }),
        remotePackManifestEntry({
          id: duplicatePackId,
          title: 'Duplicate remote pack',
          assets: [],
        }),
      ],
    });
    const files = {
      'manifest.json': await key.signEnvelope(manifest),
      [REMOTE_CSV_PATH]: REMOTE_PACK_CSV,
      [`main-street/${duplicatePackId}/cards.csv`]: packCsvFor(
        'biz-bakery',
        'Duplicate Bakery',
      ),
    };

    const { result } = await bootRemote({ key, files });

    // Only the healthy pack merged; the duplicate was rejected whole.
    expect(result.pool.activePacks).toEqual([
      { id: REMOTE_PACK_ID, version: '1.0.0' },
    ]);
    expect(result.pool.csv).toContain(REMOTE_CARD_ID);
    expect(result.pool.csv).not.toContain('Duplicate Bakery');
    expect(
      result.pool.conflicts.some((conflict) => conflict.id === 'biz-bakery'),
    ).toBe(true);

    const warning = result.warnings.find(
      (entry) =>
        entry.includes(duplicatePackId) && entry.includes('rejected'),
    );
    expect(warning).toBeDefined();
    expect(warning).toContain('duplicate card id "biz-bakery"');
  });
});

describe('no client-side caching', () => {
  it('performs no localStorage or Cache Storage writes on the remote path', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remotePackFiles(key));

    const setItem = vi.fn();
    const getItem = vi.fn(() => null);
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem, removeItem });
    const cacheOpen = vi.fn();
    vi.stubGlobal('caches', {
      open: cacheOpen,
      keys: vi.fn(),
      match: vi.fn(),
      delete: vi.fn(),
    });

    const result = await bootstrapMainStreetCardPacks({
      contentDir: null,
      remotePackEnv: remotePackEnv(key.publicKeyBase64),
      remotePackFetch: transport.fetch,
      fetchAsset: NO_ASSET_BYTES,
      contentUnlocks: NOTHING_UNLOCKED,
      logger: SILENT_LOGGER,
    });

    expect(result).not.toBeNull();
    // The remote host was actually consulted, so the "no writes" assertion is
    // meaningful.
    expect(transport.calls.some((url) => url.endsWith('/packs/manifest.json'))).toBe(
      true,
    );
    expect(result!.loaded.map((pack) => pack.manifest.id)).toContain(
      REMOTE_PACK_ID,
    );

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(cacheOpen).not.toHaveBeenCalled();
  });
});
