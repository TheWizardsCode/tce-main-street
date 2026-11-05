/**
 * Remote pack integrity: configuration, allow-list, signed-manifest
 * verification, the bounded fetch and whole-source rejection
 * (`MS-0MVSFWBE6004SPDI`).
 *
 * The security contract this file pins:
 *
 *   - the configuration parser is total and derives a host allow-list; unset,
 *     blank or invalid configuration produces no source and never throws;
 *   - the canonical payload an operator signs is deterministic and stable under
 *     key reordering;
 *   - `verifyPackManifestSignature` returns `ok` / `missing-signature` /
 *     `invalid-signature` / `malformed-envelope` / `unavailable` and never
 *     throws, for any input;
 *   - the fetch primitive refuses a non-configured host **before** any request
 *     and maps every failure to `null` plus exactly one warning;
 *   - the remote source rejects the whole catalogue (every path `null`, one
 *     warning) on any verification or manifest-shape failure, and is total.
 *
 * @see src/MainStreetRemotePackConfig.ts
 * @see src/MainStreetRemotePackManifest.ts
 * @see src/MainStreetRemotePackFetch.ts
 * @see src/MainStreetPackSources.ts
 */

import { describe, expect, it, vi } from 'vitest';

import {
  decodeBase64Bytes,
  encodeBase64Bytes,
  isRemotePackHostAllowed,
  parseRemotePackConfig,
  type RemotePackConfig,
  type RemotePackEnvLike,
} from '../../src/MainStreetRemotePackConfig';
import {
  canonicalPackManifestPayload,
  parseSignedPackManifestEnvelope,
  verifyPackManifestSignature,
} from '../../src/MainStreetRemotePackManifest';
import {
  createRemotePackTextFetcher,
  type RemotePackFetchImpl,
} from '../../src/MainStreetRemotePackFetch';
import {
  BUNDLED_PACK_SOURCE_ID,
  REMOTE_PACK_SOURCE_ID,
  createConfiguredPackSourceRegistry,
  createRemotePackSource,
  type PackSource,
} from '../../src/MainStreetPackSources';
import {
  REMOTE_ALLOWED_HOST,
  REMOTE_BASE_URL,
  REMOTE_CSV_PATH,
  REMOTE_PACK_ID,
  REMOTE_PACK_CSV,
  createFakeRemoteTransport,
  createRemotePackSigningKey,
  remotePackConfig,
  remotePackEnv,
  remotePackFiles,
  remotePackManifest,
  remotePackManifestEntry,
  type RemotePackSigningKey,
} from './fixtures/remotePackFixtures';

/** A base64 value decoding to exactly 32 zero bytes (a valid raw Ed25519 key). */
const VALID_PUBLIC_KEY = encodeBase64Bytes(new Uint8Array(32));

/** Collect warnings so a test can assert "exactly one". */
function warningSink(): { warnings: string[]; logger: { warn(m: string): void } } {
  const warnings: string[] = [];
  return { warnings, logger: { warn: (message: string) => warnings.push(message) } };
}

/** A signed envelope plus the values needed to verify it. */
async function signedCatalogue(
  manifest: unknown = remotePackManifest(),
  key?: RemotePackSigningKey,
): Promise<{ key: RemotePackSigningKey; envelopeText: string }> {
  const signer = key ?? (await createRemotePackSigningKey());
  return { key: signer, envelopeText: await signer.signEnvelope(manifest) };
}

describe('remote pack configuration', () => {
  it('parses a valid configuration and normalises the base URL', () => {
    const result = parseRemotePackConfig({
      VITE_REMOTE_PACK_URL: `${REMOTE_BASE_URL}/`,
      VITE_REMOTE_PACK_PUBLIC_KEY: `  ${VALID_PUBLIC_KEY}  `,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.baseUrl).toBe(REMOTE_BASE_URL);
    expect(result.config.allowedHost).toBe(REMOTE_ALLOWED_HOST);
    expect(result.config.publicKeyBase64).toBe(VALID_PUBLIC_KEY);
  });

  it('is unconfigured when neither variable is set (inert, no source)', () => {
    const envs: Array<RemotePackEnvLike | null | undefined> = [
      {},
      null,
      undefined,
      { OTHER: 'x' } as RemotePackEnvLike,
    ];
    for (const env of envs) {
      const result = parseRemotePackConfig(env);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe('unconfigured');
    }
  });

  it('is unconfigured when both variables are blank', () => {
    const result = parseRemotePackConfig({
      VITE_REMOTE_PACK_URL: '   ',
      VITE_REMOTE_PACK_PUBLIC_KEY: '',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe('unconfigured');
  });

  it('is invalid for a partial, malformed or unusable configuration', () => {
    const cases: Array<Record<string, unknown>> = [
      // Only the URL is set.
      { VITE_REMOTE_PACK_URL: REMOTE_BASE_URL },
      // Only the key is set.
      { VITE_REMOTE_PACK_PUBLIC_KEY: VALID_PUBLIC_KEY },
      // Not a URL at all.
      { VITE_REMOTE_PACK_URL: 'not a url', VITE_REMOTE_PACK_PUBLIC_KEY: VALID_PUBLIC_KEY },
      // Wrong scheme.
      { VITE_REMOTE_PACK_URL: 'ftp://packs.example.com', VITE_REMOTE_PACK_PUBLIC_KEY: VALID_PUBLIC_KEY },
      // Embedded credentials.
      {
        VITE_REMOTE_PACK_URL: 'https://user:secret@packs.example.com',
        VITE_REMOTE_PACK_PUBLIC_KEY: VALID_PUBLIC_KEY,
      },
      // Key is not base64.
      { VITE_REMOTE_PACK_URL: REMOTE_BASE_URL, VITE_REMOTE_PACK_PUBLIC_KEY: 'not*base64' },
      // Key decodes to the wrong length.
      { VITE_REMOTE_PACK_URL: REMOTE_BASE_URL, VITE_REMOTE_PACK_PUBLIC_KEY: 'AAAA' },
    ];

    for (const env of cases) {
      const result = parseRemotePackConfig(env);
      expect(result.ok, JSON.stringify(env)).toBe(false);
      if (result.ok) return;
      expect(result.status).toBe('invalid');
      // Never leaks the credentials it rejected.
      expect(result.reason).not.toContain('secret');
    }
  });

  it('decodes and re-encodes strict base64 without throwing on hostile input', () => {
    expect(decodeBase64Bytes(VALID_PUBLIC_KEY)).toHaveLength(32);
    expect(encodeBase64Bytes(new Uint8Array(32))).toBe(VALID_PUBLIC_KEY);
    for (const hostile of [null, undefined, 42, '', '   ', 'not-base64', 'AAA=AAAA']) {
      expect(decodeBase64Bytes(hostile)).toBeNull();
    }
  });
});

describe('remote pack host allow-list', () => {
  const config = parseRemotePackConfig(
    remotePackEnv(VALID_PUBLIC_KEY),
  ) as { ok: true; config: RemotePackConfig };

  it('allows only the configured host over the configured scheme', () => {
    expect(isRemotePackHostAllowed(config.config, `${REMOTE_BASE_URL}/packs/manifest.json`)).toBe(true);
    expect(isRemotePackHostAllowed(config.config, 'https://packs.example.com/other')).toBe(true);
  });

  it('refuses a different host, port, scheme or a malformed target', () => {
    const refused = [
      'https://evil.example.com/packs/manifest.json',
      'https://sub.packs.example.com/packs/manifest.json',
      'https://packs.example.com:8443/packs/manifest.json',
      'http://packs.example.com/packs/manifest.json',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'not a url',
      '',
      42,
      null,
      undefined,
    ];
    for (const target of refused) {
      expect(isRemotePackHostAllowed(config.config, target), String(target)).toBe(false);
    }
  });

  it('refuses everything when unconfigured', () => {
    expect(isRemotePackHostAllowed(null, `${REMOTE_BASE_URL}/packs/manifest.json`)).toBe(false);
    expect(isRemotePackHostAllowed(undefined, 'https://packs.example.com/x')).toBe(false);
  });
});

describe('canonical manifest payload', () => {
  it('is stable under input key reordering', () => {
    const ordered = {
      version: 1,
      packs: [{ id: 'pack', gameId: 'main-street', assets: ['b.png', 'a.png'], meta: { z: 1, a: 2 } }],
    };
    const reordered = {
      packs: [{ meta: { a: 2, z: 1 }, assets: ['b.png', 'a.png'], gameId: 'main-street', id: 'pack' }],
      version: 1,
    };

    expect(canonicalPackManifestPayload(ordered)).toBe(canonicalPackManifestPayload(reordered));
    expect(canonicalPackManifestPayload(ordered)).toBe(
      '{"packs":[{"assets":["b.png","a.png"],"gameId":"main-street","id":"pack","meta":{"a":2,"z":1}}],"version":1}',
    );
  });

  it('preserves array order and is total for values JSON cannot represent', () => {
    expect(canonicalPackManifestPayload([1, 2])).not.toBe(canonicalPackManifestPayload([2, 1]));
    expect(canonicalPackManifestPayload({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalPackManifestPayload({ a: [undefined] })).toBe('{"a":[null]}');
    for (const hostile of [undefined, null, 42, 'text', true]) {
      expect(() => canonicalPackManifestPayload(hostile)).not.toThrow();
    }
  });
});

describe('signed manifest envelope parsing', () => {
  it('accepts a well-formed envelope', async () => {
    const manifest = remotePackManifest();
    const key = await createRemotePackSigningKey();
    const parsed = parseSignedPackManifestEnvelope(await key.signEnvelope(manifest));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.envelope.manifest).toEqual(manifest);
  });

  it('reports a blank or absent signature as missing-signature', () => {
    for (const envelope of [
      { manifest: remotePackManifest() },
      { manifest: remotePackManifest(), signature: '   ' },
      { manifest: remotePackManifest(), signature: '' },
    ]) {
      const parsed = parseSignedPackManifestEnvelope(JSON.stringify(envelope));
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.status).toBe('missing-signature');
    }
  });

  it('reports non-JSON and wrong-shape documents as malformed-envelope', () => {
    for (const text of [
      '',
      '   ',
      '{not json',
      '[]',
      'null',
      '42',
      JSON.stringify({ manifest: 'not-an-object', signature: 'AAAA' }),
      JSON.stringify({ manifest: [], signature: 'AAAA' }),
      JSON.stringify({ manifest: remotePackManifest(), signature: 42 }),
    ]) {
      const parsed = parseSignedPackManifestEnvelope(text);
      expect(parsed.ok, text).toBe(false);
      if (parsed.ok) return;
      expect(parsed.status).toBe('malformed-envelope');
    }
  });
});

describe('verifyPackManifestSignature', () => {
  it('verifies a manifest signed with the matching private key', async () => {
    const { key, envelopeText } = await signedCatalogue();

    const result = await verifyPackManifestSignature({
      envelopeText,
      publicKeyBase64: key.publicKeyBase64,
    });

    expect(result.status).toBe('ok');
    expect(result.reason).toBeNull();
    expect(result.manifest).toEqual(remotePackManifest());
  });

  it('rejects a one-byte body change as invalid-signature', async () => {
    const key = await createRemotePackSigningKey();
    const signedManifest = remotePackManifest();
    const signature = await key.sign(signedManifest);
    const tampered = remotePackManifest({
      packs: [remotePackManifestEntry({ title: 'Main Street Remote TraininG' })],
    });

    const result = await verifyPackManifestSignature({
      envelopeText: JSON.stringify({ manifest: tampered, signature }),
      publicKeyBase64: key.publicKeyBase64,
    });

    expect(result.status).toBe('invalid-signature');
    expect(result.manifest).toBeNull();
  });

  it('rejects a signature produced by a different keypair as invalid-signature', async () => {
    const pinned = await createRemotePackSigningKey();
    const attacker = await createRemotePackSigningKey();
    const envelopeText = await attacker.signEnvelope(remotePackManifest());

    const result = await verifyPackManifestSignature({
      envelopeText,
      publicKeyBase64: pinned.publicKeyBase64,
    });

    expect(result.status).toBe('invalid-signature');
    expect(result.manifest).toBeNull();
  });

  it('reports a blank or absent signature as missing-signature', async () => {
    const key = await createRemotePackSigningKey();
    for (const envelopeText of [
      JSON.stringify({ manifest: remotePackManifest() }),
      JSON.stringify({ manifest: remotePackManifest(), signature: '  ' }),
    ]) {
      const result = await verifyPackManifestSignature({
        envelopeText,
        publicKeyBase64: key.publicKeyBase64,
      });
      expect(result.status).toBe('missing-signature');
      expect(result.manifest).toBeNull();
    }
  });

  it('reports a non-JSON or wrong-shape envelope as malformed-envelope', async () => {
    const key = await createRemotePackSigningKey();
    for (const envelopeText of ['not json', '[]', 'null', JSON.stringify({ signature: 'AAAA' })]) {
      const result = await verifyPackManifestSignature({
        envelopeText,
        publicKeyBase64: key.publicKeyBase64,
      });
      expect(result.status).toBe('malformed-envelope');
      expect(result.manifest).toBeNull();
    }
  });

  it('reports unavailable when WebCrypto or the pinned key cannot be used', async () => {
    const { envelopeText } = await signedCatalogue();

    const noSubtle = await verifyPackManifestSignature({
      envelopeText,
      publicKeyBase64: VALID_PUBLIC_KEY,
      subtle: null,
    });
    expect(noSubtle.status).toBe('unavailable');
    expect(noSubtle.manifest).toBeNull();

    const badKey = await verifyPackManifestSignature({
      envelopeText,
      publicKeyBase64: 'not-base64',
    });
    expect(badKey.status).toBe('unavailable');

    const wrongLengthKey = await verifyPackManifestSignature({
      envelopeText,
      publicKeyBase64: 'AAAA',
    });
    expect(wrongLengthKey.status).toBe('unavailable');
  });

  it('never throws for any input and never reports ok', async () => {
    const key = await createRemotePackSigningKey();
    const hostileInputs: unknown[] = [
      null,
      undefined,
      0,
      42,
      true,
      '',
      '   ',
      '[]',
      'null',
      '{"manifest":{}}',
      '{"manifest":{},"signature":"AAAA"}',
      JSON.stringify({ manifest: remotePackManifest(), signature: 'A'.repeat(88) }),
      JSON.stringify({ manifest: remotePackManifest(), signature: `${'A'.repeat(86)}==` }),
    ];

    for (const envelopeText of hostileInputs) {
      const result = await verifyPackManifestSignature({
        envelopeText,
        publicKeyBase64: key.publicKeyBase64,
      });
      expect([
        'ok',
        'missing-signature',
        'invalid-signature',
        'malformed-envelope',
        'unavailable',
      ]).toContain(result.status);
      expect(result.status).not.toBe('ok');
      expect(result.manifest).toBeNull();
    }
  });
});

describe('allow-listed bounded text fetch', () => {
  const config: RemotePackConfig = remotePackConfig(VALID_PUBLIC_KEY);

  it('returns the body text for an allow-listed URL', async () => {
    const { logger, warnings } = warningSink();
    const fetchText = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'manifest-text',
    }));

    const fetcher = createRemotePackTextFetcher({ config, logger, fetchText });
    await expect(fetcher(`${REMOTE_BASE_URL}/packs/manifest.json`)).resolves.toBe('manifest-text');
    expect(warnings).toEqual([]);
  });

  it('refuses a non-configured host without calling the transport', async () => {
    const { logger, warnings } = warningSink();
    const fetchText = vi.fn();

    const fetcher = createRemotePackTextFetcher({ config, logger, fetchText });
    await expect(fetcher('https://evil.example.com/packs/manifest.json')).resolves.toBeNull();

    expect(fetchText).not.toHaveBeenCalled();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('not on the configured host');
  });

  it('maps a non-2xx response to null with one warning', async () => {
    const { logger, warnings } = warningSink();
    const fetcher = createRemotePackTextFetcher({
      config,
      logger,
      fetchText: async () => ({ ok: false, status: 503, statusText: 'Unavailable', text: async () => '' }),
    });

    await expect(fetcher(`${REMOTE_BASE_URL}/packs/manifest.json`)).resolves.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('503');
  });

  it('maps a transport rejection to null with one warning', async () => {
    const { logger, warnings } = warningSink();
    const fetcher = createRemotePackTextFetcher({
      config,
      logger,
      fetchText: async () => {
        throw new Error('network down');
      },
    });

    await expect(fetcher(`${REMOTE_BASE_URL}/packs/manifest.json`)).resolves.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('network down');
  });

  it('maps a body-read failure to null with one warning', async () => {
    const { logger, warnings } = warningSink();
    const fetcher = createRemotePackTextFetcher({
      config,
      logger,
      fetchText: async () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw new Error('body stream failed');
        },
      }),
    });

    await expect(fetcher(`${REMOTE_BASE_URL}/packs/manifest.json`)).resolves.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('body stream failed');
  });

  it('bounds a hung read with the timeout and one warning', async () => {
    const { logger, warnings } = warningSink();
    const hanging: RemotePackFetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });

    const fetcher = createRemotePackTextFetcher({
      config,
      logger,
      fetchText: hanging,
      timeoutMs: 5,
    });

    await expect(fetcher(`${REMOTE_BASE_URL}/packs/manifest.json`)).resolves.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('timed out');
  });
});

describe('remote pack source', () => {
  /** Build a source over a fake catalogue, with its warnings and transport. */
  async function buildSource(
    options: {
      files?: Record<string, string>;
      key?: RemotePackSigningKey;
      fetchImpl?: RemotePackFetchImpl;
      config?: RemotePackConfig;
    } = {},
  ) {
    const key = options.key ?? (await createRemotePackSigningKey());
    const files = options.files ?? (await remotePackFiles(key));
    const transport = createFakeRemoteTransport(files);
    const { logger, warnings } = warningSink();
    const source = createRemotePackSource({
      config: options.config ?? remotePackConfig(key.publicKeyBase64),
      fetchImpl: options.fetchImpl ?? transport.fetch,
      logger,
    });
    return { key, files, transport, source, warnings };
  }

  it('has an id that distinguishes it from the bundled source', async () => {
    const { source } = await buildSource();
    expect(source.id).toBe(REMOTE_PACK_SOURCE_ID);
    expect(source.id).not.toBe(BUNDLED_PACK_SOURCE_ID);
  });

  it('serves the verified manifest and the declared pack CSV', async () => {
    const { source, transport, warnings } = await buildSource();

    const manifestText = await source.readPackFile('manifest.json');
    expect(manifestText).not.toBeNull();
    expect(JSON.parse(manifestText!)).toEqual(remotePackManifest());

    await expect(source.readPackFile(REMOTE_CSV_PATH)).resolves.toBe(REMOTE_PACK_CSV);
    await expect(source.resolvePackFileUrl!(REMOTE_CSV_PATH)).resolves.toBe(
      `${REMOTE_BASE_URL}/packs/${REMOTE_CSV_PATH}`,
    );
    expect(warnings).toEqual([]);
    expect(transport.calls).toContain(`${REMOTE_BASE_URL}/packs/${REMOTE_CSV_PATH}`);
  });

  it('fetches and verifies the manifest once per source instance', async () => {
    const { source, transport } = await buildSource();

    await source.readPackFile('manifest.json');
    await source.readPackFile(REMOTE_CSV_PATH);
    await source.readPackFile(REMOTE_CSV_PATH);

    const manifestCalls = transport.calls.filter((url) => url.endsWith('/packs/manifest.json'));
    expect(manifestCalls).toHaveLength(1);
    expect(transport.calls.filter((url) => url.endsWith('/cards.csv'))).toHaveLength(2);
  });

  it('serves only files the verified catalogue declares', async () => {
    const { source, transport } = await buildSource();
    await source.readPackFile('manifest.json');
    const callsBefore = transport.calls.length;

    await expect(source.readPackFile('main-street/other-pack/cards.csv')).resolves.toBeNull();
    await expect(source.resolvePackFileUrl!('main-street/other-pack/assets/x.png')).resolves.toBeNull();
    expect(transport.calls).toHaveLength(callsBefore);
  });

  it('rejects the whole source on an invalid signature with exactly one warning', async () => {
    const pinned = await createRemotePackSigningKey();
    const attacker = await createRemotePackSigningKey();
    const files = await remotePackFiles(pinned, { signer: attacker });
    const { source, warnings } = await buildSource({ key: pinned, files });

    await expect(source.readPackFile('manifest.json')).resolves.toBeNull();
    await expect(source.readPackFile(REMOTE_CSV_PATH)).resolves.toBeNull();
    await expect(source.resolvePackFileUrl!(REMOTE_CSV_PATH)).resolves.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('invalid-signature');
  });

  it('rejects the whole source on a missing manifest with exactly one warning', async () => {
    const key = await createRemotePackSigningKey();
    const { source, warnings } = await buildSource({ key, files: {} });

    await expect(source.readPackFile('manifest.json')).resolves.toBeNull();
    await expect(source.readPackFile(REMOTE_CSV_PATH)).resolves.toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it('rejects the whole source on a signed but malformed manifest with one warning', async () => {
    const key = await createRemotePackSigningKey();
    // Signed correctly, but not a pack catalogue: no `packs` array.
    const files = {
      'manifest.json': await key.signEnvelope({ version: 1 }),
      [REMOTE_CSV_PATH]: REMOTE_PACK_CSV,
    };
    const { source, warnings } = await buildSource({ key, files });

    await expect(source.readPackFile('manifest.json')).resolves.toBeNull();
    await expect(source.readPackFile(REMOTE_CSV_PATH)).resolves.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('malformed manifest');
  });

  it('is disabled with one warning for an invalid configuration', async () => {
    const { logger, warnings } = warningSink();
    const source = createRemotePackSource({
      config: null as unknown as RemotePackConfig,
      logger,
    });

    expect(source.id).toBe(REMOTE_PACK_SOURCE_ID);
    expect(warnings).toHaveLength(1);
    await expect(source.readPackFile('manifest.json')).resolves.toBeNull();
  });

  it('never throws, whatever the path or transport does', async () => {
    const key = await createRemotePackSigningKey();
    const throwing: RemotePackFetchImpl = async () => {
      throw new Error('transport exploded');
    };
    const { source } = await buildSource({
      key,
      fetchImpl: throwing,
    });

    const hostilePaths: unknown[] = [
      undefined,
      null,
      42,
      '',
      '   ',
      '../secret.json',
      'main-street/pack/../../secret',
      `${REMOTE_CSV_PATH}\u0000`,
      REMOTE_CSV_PATH,
    ];

    for (const path of hostilePaths) {
      await expect(source.readPackFile(path as string)).resolves.toBeNull();
      await expect(source.resolvePackFileUrl!(path as string)).resolves.toBeNull();
    }
  });
});

describe('configured registry composition', () => {
  it('registers the bundled source first, then the remote source', async () => {
    const key = await createRemotePackSigningKey();
    const { logger } = warningSink();

    const registry = createConfiguredPackSourceRegistry({
      env: remotePackEnv(key.publicKeyBase64),
      logger,
    });

    expect(registry.sources.map((source: PackSource) => source.id)).toEqual([
      BUNDLED_PACK_SOURCE_ID,
      REMOTE_PACK_SOURCE_ID,
    ]);
  });

  it('composes no remote source and warns once when unset', () => {
    const { logger, warnings } = warningSink();

    const registry = createConfiguredPackSourceRegistry({ env: {}, logger });

    expect(registry.sources.map((source) => source.id)).toEqual([BUNDLED_PACK_SOURCE_ID]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('inactive');
  });

  it('composes no remote source and warns once for an invalid configuration', () => {
    const { logger, warnings } = warningSink();

    const registry = createConfiguredPackSourceRegistry({
      env: { VITE_REMOTE_PACK_URL: REMOTE_BASE_URL, VITE_REMOTE_PACK_PUBLIC_KEY: 'bad' },
      logger,
    });

    expect(registry.sources.map((source) => source.id)).toEqual([BUNDLED_PACK_SOURCE_ID]);
    expect(warnings).toHaveLength(1);
  });

  it('merges both catalogues with the bundled pack winning a duplicate id', async () => {
    const key = await createRemotePackSigningKey();
    const { logger } = warningSink();
    const transport = createFakeRemoteTransport(
      await remotePackFiles(key, {
        manifest: remotePackManifest({
          packs: [remotePackManifestEntry({ version: '9.9.9', title: 'Remote variant' })],
        }),
      }),
    );

    const bundledCsv = `${REMOTE_PACK_CSV}\n`;
    const registry = createConfiguredPackSourceRegistry({
      env: remotePackEnv(key.publicKeyBase64),
      logger,
      fetchImpl: transport.fetch,
      bundledModules: {
        text: {
          'manifest.json': async () =>
            JSON.stringify(
              remotePackManifest({
                packs: [remotePackManifestEntry({ version: '0.0.1', title: 'Bundled variant' })],
              }),
            ),
          [REMOTE_CSV_PATH]: async () => bundledCsv,
        },
        urls: {},
      },
    });

    const merged = JSON.parse((await registry.readPackFile('manifest.json'))!);
    expect(merged.packs).toHaveLength(1);
    expect(merged.packs[0]).toMatchObject({ id: REMOTE_PACK_ID, version: '0.0.1' });
    // File consultation is first-wins too: the bundled CSV is served.
    await expect(registry.readPackFile(REMOTE_CSV_PATH)).resolves.toBe(bundledCsv);
  });
});
