/**
 * Remote pack asset resolution (`MS-0MVSFWEJ30030X9B`).
 *
 * Proves the vertical slice a remote pack's art travels: the verified
 * catalogue gates resolution → {@link PackSource.resolvePackFileUrl} answers an
 * absolute URL on the configured remote base → the core loader exposes it
 * through `LoadedCardPack.assetUrls` → the existing `fetchAsset` transport
 * reads the bytes at that URL → the pack-art registry holds the inlined art the
 * card renderer resolves.
 *
 * Pins the guarantees the parent item (`MS-0MV26X8T201852AC`, AC 7) relies on:
 *
 *   - an asset is resolvable **only** once the catalogue's signature and shape
 *     verified — a rejected source resolves nothing;
 *   - a base URL carrying a path prefix (`https://host/packs-v2/`) is joined
 *     exactly once, never dropping the prefix and never doubling a slash;
 *   - a path the catalogue does not declare, and any traversal (`..` in either
 *     separator form), resolves `null` and issues no request;
 *   - resolving a URL is a pure string transform: it adds **no** asset
 *     byte-read path, so the existing `fetchAsset` transport still performs the
 *     single read;
 *   - a remote pack with art resolves that art through the browser pack path
 *     (`contentDir: null`), so `getCardArtDataUriForCard` — the seam the card
 *     texture generator reads — returns the remote asset.
 *
 * @see src/MainStreetPackSources.ts — `createRemotePackSource` /
 *   `createPackSourceTransports`.
 * @see src/MainStreetCardPacks.ts — `bootstrapMainStreetCardPacks`.
 * @see src/MainStreetCardPackArt.ts — the pack-art registry.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bootstrapMainStreetCardPacks,
  resetMainStreetCardPacks,
} from '../../src/MainStreetCardPacks';
import { getCardArtDataUriForCard } from '../../src/MainStreetCardArt';
import {
  getPackArtDataUri,
  resetPackArt,
} from '../../src/MainStreetCardPackArt';
import {
  createConfiguredPackSourceRegistry,
  createRemotePackSource,
  resolvePackAssetUrl,
  type PackSource,
} from '../../src/MainStreetPackSources';
import { parseRemotePackConfig } from '../../src/MainStreetRemotePackConfig';
import type { RemotePackConfig } from '../../src/MainStreetRemotePackConfig';
import {
  REMOTE_BASE_URL,
  REMOTE_CARD_ID,
  REMOTE_GAME_ID,
  REMOTE_PACK_ID,
  createFakeRemoteTransport,
  createRemotePackSigningKey,
  remotePackConfig,
  remotePackEnv,
  remotePackFiles,
  remotePackManifestEntry,
  type FakeRemoteTransport,
  type RemotePackSigningKey,
} from './fixtures/remotePackFixtures';
import { pngBytesToDataUri } from './helpers/packArt';

/** The card id the fixture pack supplies art for (Option A stem = card id). */
const REMOTE_ART_CARD_ID = REMOTE_CARD_ID;

/** The pack-relative art path the fixture manifest declares. */
const REMOTE_ART_RELATIVE = `assets/${REMOTE_ART_CARD_ID}.png`;

/** The packs-root-relative path the registry resolves for that art. */
const REMOTE_ART_PATH = `${REMOTE_GAME_ID}/${REMOTE_PACK_ID}/${REMOTE_ART_RELATIVE}`;

/** The absolute URL that path resolves to on the configured base. */
const REMOTE_ART_URL = `${REMOTE_BASE_URL}/packs/${REMOTE_ART_PATH}`;

/** The one URL resolving any asset requires: the signed catalogue. */
const REMOTE_MANIFEST_URL = `${REMOTE_BASE_URL}/packs/manifest.json`;

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
  resetPackArt();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Options for {@link buildSource}. */
interface BuildSourceOptions {
  /** Pinned keypair; defaults to a fresh one. */
  readonly key?: RemotePackSigningKey;
  /** Served text files; defaults to a healthy catalogue for the pinned key. */
  readonly files?: Record<string, string>;
  /** Validated config; defaults to {@link REMOTE_BASE_URL}. */
  readonly config?: RemotePackConfig;
}

/**
 * Build a remote source over a fake catalogue, returning its warnings and the
 * transport that records every request, so a test can assert both "served" and
 * "never requested".
 */
async function buildSource(options: BuildSourceOptions = {}): Promise<{
  readonly key: RemotePackSigningKey;
  readonly source: PackSource;
  readonly transport: FakeRemoteTransport;
  readonly warnings: string[];
}> {
  const key = options.key ?? (await createRemotePackSigningKey());
  const files = options.files ?? (await remotePackFiles(key));
  const transport = createFakeRemoteTransport(files);
  const warnings: string[] = [];
  const source = createRemotePackSource({
    config: options.config ?? remotePackConfig(key.publicKeyBase64),
    fetchImpl: transport.fetch,
    logger: { warn: (message: string) => warnings.push(message) },
  });
  return { key, source, transport, warnings };
}

/** The pack-art registry stub bytes (content is irrelevant; identity is not). */
const ART_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 7, 7]);

describe('URL shape for a manifest-declared asset', () => {
  it('resolves an absolute URL on the configured base and reads no asset bytes', async () => {
    const { source, transport } = await buildSource();

    await expect(source.resolvePackFileUrl!(REMOTE_ART_PATH)).resolves.toBe(
      REMOTE_ART_URL,
    );

    // Absolute, on the configured origin, with the configured path prefix.
    const resolved = new URL(REMOTE_ART_URL);
    expect(resolved.protocol).toBe('https:');
    expect(resolved.host).toBe('packs.example.com');
    expect(resolved.pathname).toBe(`/main-street-dist/packs/${REMOTE_ART_PATH}`);

    // Resolution is a string transform: the only request it needed was the
    // catalogue it must verify, never the asset itself.
    expect(transport.calls).toEqual([REMOTE_MANIFEST_URL]);
  });

  it('joins a base URL carrying a path prefix and a trailing slash exactly once', async () => {
    const key = await createRemotePackSigningKey();
    const prefixedBase = 'https://packs.example.com/packs-v2/';
    const parsed = parseRemotePackConfig({
      VITE_REMOTE_PACK_URL: prefixedBase,
      VITE_REMOTE_PACK_PUBLIC_KEY: key.publicKeyBase64,
    });
    if (!parsed.ok) throw new Error(`config rejected: ${parsed.reason}`);
    expect(parsed.config.baseUrl).toBe('https://packs.example.com/packs-v2');

    const transport = createFakeRemoteTransport(
      await remotePackFiles(key),
      prefixedBase,
    );
    const source = createRemotePackSource({
      config: parsed.config,
      fetchImpl: transport.fetch,
      logger: SILENT_LOGGER,
    });

    const resolved = await source.resolvePackFileUrl!(REMOTE_ART_PATH);

    expect(resolved).toBe(
      `https://packs.example.com/packs-v2/packs/${REMOTE_ART_PATH}`,
    );
    // The prefix survives and the join contributes exactly one slash.
    expect(new URL(resolved!).pathname).toBe(
      `/packs-v2/packs/${REMOTE_ART_PATH}`,
    );
    expect(resolved!.replace(new URL(resolved!).origin, '')).not.toContain('//');
    expect(transport.calls).toEqual([
      'https://packs.example.com/packs-v2/packs/manifest.json',
    ]);
  });

  it('never doubles a slash in a directly supplied config that keeps a trailing slash', async () => {
    const key = await createRemotePackSigningKey();
    const baseWithSlash = 'https://cdn.example.com/a/b/';
    const transport = createFakeRemoteTransport(
      await remotePackFiles(key),
      baseWithSlash,
    );
    const source = createRemotePackSource({
      config: remotePackConfig(key.publicKeyBase64, {
        baseUrl: baseWithSlash,
        allowedHost: 'cdn.example.com',
      }),
      fetchImpl: transport.fetch,
      logger: SILENT_LOGGER,
    });

    await expect(source.resolvePackFileUrl!(REMOTE_ART_PATH)).resolves.toBe(
      `https://cdn.example.com/a/b/packs/${REMOTE_ART_PATH}`,
    );
  });
});

describe('resolution is gated on a verified catalogue', () => {
  it('resolves no asset URLs when the signature does not verify', async () => {
    const pinned = await createRemotePackSigningKey();
    const attacker = await createRemotePackSigningKey();
    const files = await remotePackFiles(pinned, { signer: attacker });
    const { source, transport, warnings } = await buildSource({
      key: pinned,
      files,
    });

    await expect(source.resolvePackFileUrl!(REMOTE_ART_PATH)).resolves.toBeNull();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('invalid-signature');
    // The asset was never even asked for.
    expect(transport.calls).toEqual([REMOTE_MANIFEST_URL]);
  });

  it('resolves no asset URLs when the catalogue document is malformed', async () => {
    const key = await createRemotePackSigningKey();
    const files = await remotePackFiles(key, {
      manifest: { version: 1, packs: 'not-an-array' },
    });
    const { source, warnings } = await buildSource({ key, files });

    await expect(source.resolvePackFileUrl!(REMOTE_ART_PATH)).resolves.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('malformed manifest');
  });

  it('resolves no asset URLs for a catalogue version this build does not support', async () => {
    const key = await createRemotePackSigningKey();
    const files = await remotePackFiles(key, {
      manifest: { version: 2, packs: [remotePackManifestEntry()] },
    });
    const { source, warnings } = await buildSource({ key, files });

    await expect(source.resolvePackFileUrl!(REMOTE_ART_PATH)).resolves.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('unsupported manifest version');
  });
});

describe('rejection of undeclared and traversing paths', () => {
  it('resolves nothing for a path the verified catalogue does not declare', async () => {
    const { source, transport } = await buildSource();
    // Verify first so the assertions below are about the declared-file gate.
    await source.resolvePackFileUrl!(REMOTE_ART_PATH);
    const callsAfterDeclaredRead = transport.calls.length;

    await expect(
      source.resolvePackFileUrl!('main-street/other-pack/assets/x.png'),
    ).resolves.toBeNull();
    // The catalogue document itself is not an asset.
    await expect(source.resolvePackFileUrl!('manifest.json')).resolves.toBeNull();
    // Neither miss issued a request.
    expect(transport.calls).toHaveLength(callsAfterDeclaredRead);
  });

  it('resolves nothing for traversal attempts, slash or backslash separated', async () => {
    const { source, transport } = await buildSource();
    const hostilePaths = [
      `${REMOTE_GAME_ID}/${REMOTE_PACK_ID}/assets/../../../evil.png`,
      `${REMOTE_GAME_ID}\\${REMOTE_PACK_ID}\\assets\\..\\..\\..\\evil.png`,
      '../evil.png',
      '/etc/passwd',
    ];

    for (const path of hostilePaths) {
      await expect(
        source.resolvePackFileUrl!(path),
        `"${path}" must not resolve`,
      ).resolves.toBeNull();
    }

    expect(
      transport.calls.some(
        (url) => url.includes('evil') || url.includes('passwd'),
      ),
    ).toBe(false);
  });
});

describe('remote art through the loader and pack-art registry', () => {
  it('reads the art at the remote URL and registers it for the card renderer', async () => {
    const key = await createRemotePackSigningKey();
    const transport = createFakeRemoteTransport(await remotePackFiles(key));
    const assetReads: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        assetReads.push(url);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: async () => ART_BYTES.buffer,
        };
      }),
    );

    // The browser pack path: no launcher content directory, so the configured
    // remote catalogue is composed after the bundled source.
    const result = await bootstrapMainStreetCardPacks({
      contentDir: null,
      remotePackEnv: remotePackEnv(key.publicKeyBase64),
      remotePackFetch: transport.fetch,
      contentUnlocks: NOTHING_UNLOCKED,
      storage: null,
      logger: SILENT_LOGGER,
    });

    expect(result).not.toBeNull();
    const remotePack = result!.loaded.find(
      (pack) => pack.manifest.id === REMOTE_PACK_ID,
    );
    expect(remotePack, 'the remote pack is loaded').toBeDefined();

    // 1. The loader exposes the pack-scoped asset seam.
    const packScopedUrl = `tce-packs://${REMOTE_GAME_ID}/${REMOTE_PACK_ID}/${REMOTE_ART_RELATIVE}`;
    expect(remotePack!.assetUrls).toEqual([packScopedUrl]);

    // 2. The injected transport resolved that seam to the remote absolute URL
    //    and the existing byte transport performed the one and only read.
    expect(assetReads).toEqual([REMOTE_ART_URL]);

    // 3. The production registry resolves the same seam to the same URL.
    const registry = createConfiguredPackSourceRegistry({
      env: remotePackEnv(key.publicKeyBase64),
      fetchImpl: transport.fetch,
      logger: SILENT_LOGGER,
    });
    await expect(
      resolvePackAssetUrl(registry, remotePack!.assetUrls[0]!),
    ).resolves.toBe(REMOTE_ART_URL);

    // 4. Pack art landed in the registry before any texture is generated, and
    //    the renderer's resolver answers with the remote art.
    const expectedArt = pngBytesToDataUri(ART_BYTES);
    expect(remotePack!.assetDataUris[REMOTE_ART_CARD_ID]).toBe(expectedArt);
    expect(getPackArtDataUri(REMOTE_ART_CARD_ID)).toBe(expectedArt);
    expect(
      getCardArtDataUriForCard(REMOTE_ART_CARD_ID, 'Remote Training Hall'),
    ).toBe(expectedArt);
  });
});
