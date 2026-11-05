/**
 * Fixtures for the signed remote card-pack source (`MS-0MVSFWBE6004SPDI`).
 *
 * Everything the remote-discovery and integrity tests need, in one place so a
 * later slice can reuse it unchanged:
 *
 *   - a real Ed25519 keypair, generated with WebCrypto in the test process, that
 *     signs a catalogue exactly as a distribution operator would: the signature
 *     covers the **canonical payload** of the manifest (not the raw text);
 *   - a valid remote pack manifest + CSV fragment in the game's real schema;
 *   - a fake transport that serves a `packs/`-relative file map over the
 *     configured base URL and records every request, so tests can assert both
 *     "served" and "never requested".
 *
 * The private key exists only here, in tests — the production pinned public key
 * is a build-time constant and the signing key is never shipped.
 *
 * @see src/MainStreetRemotePackManifest.ts
 * @see src/MainStreetRemotePackConfig.ts
 * @see src/MainStreetRemotePackFetch.ts
 */

import { CARD_DATA_RAW } from '../../../src/MainStreetCards';
import {
  encodeBase64Bytes,
  type RemotePackConfig,
  type RemotePackEnvLike,
} from '../../../src/MainStreetRemotePackConfig';
import type {
  RemotePackFetchImpl,
  RemotePackFetchResponse,
} from '../../../src/MainStreetRemotePackFetch';
import { canonicalPackManifestPayload } from '../../../src/MainStreetRemotePackManifest';

/** The base URL every fixture catalogue is served from. */
export const REMOTE_BASE_URL = 'https://packs.example.com/main-street-dist';

/** The host the allow-list derives from {@link REMOTE_BASE_URL}. */
export const REMOTE_ALLOWED_HOST = 'packs.example.com';

/** The fixture pack id (deliberately different from the bundled pack). */
export const REMOTE_PACK_ID = 'main-street-remote-pack';

/** The game the fixture pack extends. */
export const REMOTE_GAME_ID = 'main-street';

/** The fixture card id contributed by the remote pack. */
export const REMOTE_CARD_ID = 'biz-ms-remote-training-hall';

/** The base card CSV header — a pack fragment must reuse it exactly. */
export const BASE_HEADER = CARD_DATA_RAW.split('\n')[0];

const BASE_COLUMNS = BASE_HEADER.split(',');

/** Build one pack CSV row in the base column order. */
export function remotePackRow(fields: Record<string, string>): string {
  return BASE_COLUMNS.map((column) => fields[column] ?? '').join(',');
}

/** A valid one-row pack CSV fragment for {@link REMOTE_PACK_ID}. */
export const REMOTE_PACK_CSV = [
  BASE_HEADER,
  remotePackRow({
    family: 'business',
    id: REMOTE_CARD_ID,
    name: 'Remote Training Hall',
    cost: '260',
    baseIncome: '95',
    synergyTypes: 'Residential',
    description: 'A card served by a signed remote pack.',
  }),
].join('\n');

/** One manifest entry for the remote pack (overridable per test). */
export function remotePackManifestEntry(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: REMOTE_PACK_ID,
    gameId: REMOTE_GAME_ID,
    title: 'Main Street Remote Training',
    description: 'A remote pack fixture served from a signed catalogue.',
    version: '1.0.0',
    coreEngineVersion: '^0.1.0',
    cards: 'cards.csv',
    assets: [`assets/${REMOTE_CARD_ID}.png`],
    ...overrides,
  };
}

/** A complete manifest document (plain object, ready to be signed). */
export function remotePackManifest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { version: 1, packs: [remotePackManifestEntry()], ...overrides };
}

/** A signing keypair plus the helpers an operator would use. */
export interface RemotePackSigningKey {
  /** The pinned public key the game ships (raw base64). */
  readonly publicKeyBase64: string;
  /** Sign a manifest, returning the base64 signature. */
  sign(manifest: unknown): Promise<string>;
  /** Sign a manifest and render the signed envelope JSON text. */
  signEnvelope(manifest: unknown): Promise<string>;
}

/**
 * Generate a fresh Ed25519 keypair and return it with signing helpers.
 *
 * WebCrypto Ed25519 is native in Node 22 and in the Playwright Chromium the
 * browser project runs, so no runtime dependency is involved.
 */
export async function createRemotePackSigningKey(): Promise<RemotePackSigningKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const rawPublicKey = new Uint8Array(
    await crypto.subtle.exportKey('raw', pair.publicKey),
  );

  const sign = async (manifest: unknown): Promise<string> => {
    const payload = new TextEncoder().encode(
      canonicalPackManifestPayload(manifest),
    );
    const signature = await crypto.subtle.sign(
      { name: 'Ed25519' },
      pair.privateKey,
      payload,
    );
    return encodeBase64Bytes(new Uint8Array(signature));
  };

  return {
    publicKeyBase64: encodeBase64Bytes(rawPublicKey),
    sign,
    async signEnvelope(manifest: unknown): Promise<string> {
      return JSON.stringify({ manifest, signature: await sign(manifest) });
    },
  };
}

/**
 * Re-wrap *manifest* in the signature carried by *envelopeText*.
 *
 * The signature is genuine, so the result is a **tampered** envelope whose body
 * no longer matches the signed canonical payload: verification fails on the
 * integrity check, not on the envelope shape. Lets a test pin "a signed body
 * that was altered after signing" without re-implementing the signing flow.
 */
export function tamperSignedEnvelope(
  envelopeText: string,
  manifest: unknown,
): string {
  const parsed = JSON.parse(envelopeText) as { signature?: unknown };
  return JSON.stringify({ manifest, signature: parsed.signature });
}

/** Build a valid build-time env bag for the fixture catalogue. */
export function remotePackEnv(
  publicKeyBase64: string,
  baseUrl: string = REMOTE_BASE_URL,
): RemotePackEnvLike {
  return {
    VITE_REMOTE_PACK_URL: baseUrl,
    VITE_REMOTE_PACK_PUBLIC_KEY: publicKeyBase64,
  };
}

/** Build a validated config object (bypasses the env parser). */
export function remotePackConfig(
  publicKeyBase64: string,
  overrides: Partial<RemotePackConfig> = {},
): RemotePackConfig {
  return {
    baseUrl: REMOTE_BASE_URL,
    publicKeyBase64,
    allowedHost: REMOTE_ALLOWED_HOST,
    ...overrides,
  };
}

/** The packs-relative path of the fixture pack's CSV. */
export const REMOTE_CSV_PATH = `${REMOTE_GAME_ID}/${REMOTE_PACK_ID}/cards.csv`;

/** Options for {@link remotePackFiles}. */
export interface RemotePackFileOptions {
  /** Manifest document to sign; defaults to {@link remotePackManifest}. */
  readonly manifest?: Record<string, unknown>;
  /** Signer override (e.g. a "hostile" keypair); defaults to `key`. */
  readonly signer?: RemotePackSigningKey;
}

/**
 * The files a healthy remote catalogue serves, keyed by packs-relative path.
 *
 * `manifest.json` is the **signed envelope**; the CSV is the pack content.
 */
export async function remotePackFiles(
  key: RemotePackSigningKey,
  options: RemotePackFileOptions = {},
): Promise<Record<string, string>> {
  const signer = options.signer ?? key;
  return {
    'manifest.json': await signer.signEnvelope(
      options.manifest ?? remotePackManifest(),
    ),
    [REMOTE_CSV_PATH]: REMOTE_PACK_CSV,
  };
}

/** A fake transport plus a record of the URLs it was asked for. */
export interface FakeRemoteTransport {
  /** Injectable `fetch`-shaped transport for the remote source. */
  readonly fetch: RemotePackFetchImpl;
  /** Every URL requested, in order. */
  readonly calls: string[];
}

/**
 * Serve *files* (packs-relative path → text) over a fake `fetch`.
 *
 * A path the map does not carry is a 404, exactly as a static host would
 * behave. No request is issued unless the source asks for it.
 */
export function createFakeRemoteTransport(
  files: Readonly<Record<string, string>>,
  baseUrl: string = REMOTE_BASE_URL,
): FakeRemoteTransport {
  const calls: string[] = [];
  const prefix = `${baseUrl.replace(/\/+$/, '')}/packs/`;

  const fetchImpl: RemotePackFetchImpl = async (url) => {
    calls.push(url);
    const path = url.startsWith(prefix) ? url.slice(prefix.length) : null;
    const body = path === null ? undefined : files[path];
    if (typeof body !== 'string') {
      return notFound();
    }
    return ok(body);
  };

  return { fetch: fetchImpl, calls };
}

/** A 200 response carrying *body*. */
export function ok(body: string): RemotePackFetchResponse {
  return { ok: true, status: 200, statusText: 'OK', text: async () => body };
}

/** A 404 response (a file the fake host does not carry). */
export function notFound(): RemotePackFetchResponse {
  return {
    ok: false,
    status: 404,
    statusText: 'Not Found',
    text: async () => '',
  };
}
