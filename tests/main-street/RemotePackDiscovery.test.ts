/**
 * Remote pack discovery end to end (`MS-0MVSFWBE6004SPDI`, tracer bullet).
 *
 * Proves the whole seam once, through the public API: a signed catalogue served
 * by a fake transport is discovered through the pack-source registry, merged
 * into the card pool alongside the bundled pack, applied at boot, and reaches
 * the Card Packs listing input. Also pins the degradation and composition
 * boundaries the parent item depends on:
 *
 *   - an unreachable / hung remote host leaves the bundled pack discoverable;
 *   - the browser boot path (`contentDir: null`) composes the configured remote
 *     source, while an explicit launcher `contentDir` composes none and issues
 *     no remote request.
 *
 * @see src/MainStreetCardPacks.ts — `loadMainStreetCardPacks` / `bootstrapMainStreetCardPacks`.
 * @see src/MainStreetPackSources.ts — `createConfiguredPackSourceRegistry`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bootstrapMainStreetCardPacks,
  getAvailableTemplateIds,
  loadMainStreetCardPacks,
  resetMainStreetCardPacks,
  toCardPackListingInput,
} from '../../src/MainStreetCardPacks';
import { CARD_DATA_RAW } from '../../src/MainStreetCards';
import { createConfiguredPackSourceRegistry } from '../../src/MainStreetPackSources';
import type { CardPackLoaderOptions } from '@ui/CardPackLoader';
import type { RemotePackFetchImpl } from '../../src/MainStreetRemotePackFetch';
import {
  REMOTE_ALLOWED_HOST,
  REMOTE_BASE_URL,
  REMOTE_CARD_ID,
  REMOTE_PACK_ID,
  createFakeRemoteTransport,
  createRemotePackSigningKey,
  remotePackEnv,
  remotePackFiles,
} from './fixtures/remotePackFixtures';

const RESIDENTIAL_PACK_ID = 'main-street-residential-pack';

/** No warnings reach the console; each test asserts what it needs explicitly. */
const SILENT_LOGGER = { warn: () => {} };

/** A content-unlock client that reports nothing unlocked. */
const NOTHING_UNLOCKED = {
  isUnlocked: async () => false,
  getUnlocks: async () => [],
  refresh: async () => [],
};

afterEach(() => {
  resetMainStreetCardPacks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('remote pack discovery through the loader', () => {
  it('merges a remote pack into the pool and the Card Packs listing input', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remotePackFiles(key));
    const registry = createConfiguredPackSourceRegistry({
      env: remotePackEnv(key.publicKeyBase64),
      fetchImpl: transport.fetch,
      logger: SILENT_LOGGER,
    });

    const result = await loadMainStreetCardPacks({
      contentDir: REMOTE_BASE_URL,
      packSources: registry,
      contentUnlocks: NOTHING_UNLOCKED,
      logger: SILENT_LOGGER,
    });

    // The remote (free) pack merged into the playable pool...
    expect(result.pool.activePacks).toEqual([{ id: REMOTE_PACK_ID, version: '1.0.0' }]);
    expect(result.pool.csv).toContain(REMOTE_CARD_ID);
    expect(result.loaded.map((pack) => pack.manifest.id)).toEqual([REMOTE_PACK_ID]);

    // ...alongside the bundled pack, which still lists as a gated row.
    expect(result.locked.map((pack) => pack.manifest.id)).toContain(RESIDENTIAL_PACK_ID);

    // ...and reaches the Card Packs listing input as an enabled row.
    const listing = toCardPackListingInput(
      result,
      result.loaded.map((pack) => pack.manifest.id),
    );
    const remoteRow = listing.packs.find((pack) => pack.manifest.id === REMOTE_PACK_ID);
    expect(remoteRow).toBeDefined();
    expect(remoteRow!.enabled).toBe(true);
    expect(remoteRow!.manifest.title).toBe('Main Street Remote Training');
    expect(listing.locked.map((pack) => pack.manifest.id)).toContain(RESIDENTIAL_PACK_ID);
  });

  it('keeps bundled packs discoverable when a hung remote host times out', async () => {
    const key = await createRemotePackSigningKey();
    const hanging: RemotePackFetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const warnings: string[] = [];
    const registry = createConfiguredPackSourceRegistry({
      env: remotePackEnv(key.publicKeyBase64),
      fetchImpl: hanging,
      timeoutMs: 5,
      logger: { warn: (message: string) => warnings.push(message) },
    });

    const result = await loadMainStreetCardPacks({
      contentDir: REMOTE_BASE_URL,
      packSources: registry,
      contentUnlocks: NOTHING_UNLOCKED,
      logger: SILENT_LOGGER,
    });

    // Boot still discovers the bundled catalogue; the remote source contributes
    // nothing and the timeout is warned about exactly once.
    expect(result.pool.baseOnly).toBe(true);
    expect(result.locked.map((pack) => pack.manifest.id)).toContain(RESIDENTIAL_PACK_ID);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('timed out');
  });
});

describe('browser boot wiring', () => {
  it('composes the configured remote source on the browser path', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remotePackFiles(key));

    const result = await bootstrapMainStreetCardPacks({
      contentDir: null,
      remotePackEnv: remotePackEnv(key.publicKeyBase64),
      remotePackFetch: transport.fetch,
      contentUnlocks: NOTHING_UNLOCKED,
      storage: null,
      logger: SILENT_LOGGER,
    });

    expect(result).not.toBeNull();
    // Bundled + remote catalogues both discovered; the remote pack is applied.
    expect(result!.loaded.map((pack) => pack.manifest.id)).toContain(REMOTE_PACK_ID);
    expect(result!.locked.map((pack) => pack.manifest.id)).toContain(RESIDENTIAL_PACK_ID);
    expect(getAvailableTemplateIds()).toContain(REMOTE_CARD_ID);
    expect(transport.calls.some((url) => url.endsWith('/packs/manifest.json'))).toBe(true);
  });

  it('performs no real network I/O: every remote request goes through the injected transport', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remotePackFiles(key));
    const realFetch = vi.fn(async () => {
      throw new Error('a real network request was issued');
    });
    vi.stubGlobal('fetch', realFetch);

    const result = await bootstrapMainStreetCardPacks({
      contentDir: null,
      remotePackEnv: remotePackEnv(key.publicKeyBase64),
      remotePackFetch: transport.fetch,
      fetchAsset: async () => new Uint8Array([0]),
      contentUnlocks: NOTHING_UNLOCKED,
      storage: null,
      logger: SILENT_LOGGER,
    });

    expect(result).not.toBeNull();
    expect(result!.loaded.map((pack) => pack.manifest.id)).toContain(
      REMOTE_PACK_ID,
    );

    // Every request went to the injected transport, and only to the
    // allow-listed host; the global network was never touched.
    expect(transport.calls.length).toBeGreaterThan(0);
    expect(
      transport.calls.every(
        (url) => new URL(url).host === REMOTE_ALLOWED_HOST,
      ),
    ).toBe(true);
    expect(realFetch).not.toHaveBeenCalled();
  });

  it('composes no remote source and fetches nothing for an explicit launcher contentDir', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remotePackFiles(key));
    const remoteFetch = vi.fn(transport.fetch);
    const globalFetchSpy = vi.spyOn(globalThis, 'fetch');
    const loader = vi.fn(async (_options: CardPackLoaderOptions) => ({
      packs: [],
      incompatible: [],
      locked: [],
      errors: [],
    }));

    const result = await bootstrapMainStreetCardPacks({
      contentDir: '/content',
      loader,
      remotePackEnv: remotePackEnv(key.publicKeyBase64),
      remotePackFetch: remoteFetch,
      contentUnlocks: NOTHING_UNLOCKED,
      storage: null,
      logger: SILENT_LOGGER,
    });

    expect(result).not.toBeNull();
    expect(loader).toHaveBeenCalledOnce();
    // No pack-source transports were composed, so the Electron content-dir
    // path is byte-for-byte unchanged and no remote source exists.
    const options = loader.mock.calls[0][0];
    expect(options.fetchManifest).toBeUndefined();
    expect(options.fetchCsv).toBeUndefined();
    expect(options.fetchAsset).toBeUndefined();
    expect(remoteFetch).not.toHaveBeenCalled();
    expect(globalFetchSpy).not.toHaveBeenCalled();
    expect(result!.pool.csv).toBe(CARD_DATA_RAW);
  });
});
