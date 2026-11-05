/**
 * Main Street: build-time configuration for the remote card-pack source.
 *
 * The remote catalogue is a **build-time** declaration (producer decision Q1 in
 * `MS-0MV26X8T200852AC`): the web build reads two Vite environment variables and
 * derives a validated {@link RemotePackConfig} from them.
 *
 *   - `VITE_REMOTE_PACK_URL` — the base URL the remote `packs/` tree is served
 *     from (e.g. `https://packs.example.com/main-street`). The catalogue is
 *     read from `<baseUrl>/packs/manifest.json` and pack files from
 *     `<baseUrl>/packs/<gameId>/<packId>/…`.
 *   - `VITE_REMOTE_PACK_PUBLIC_KEY` — the **pinned** Ed25519 public key (raw
 *     32-byte key, base64) that every remote manifest signature must verify
 *     against. The private signing key is held by the distribution operator and
 *     never ships in the game.
 *
 * **Inert when unset.** An unconfigured build composes no remote source and
 * performs no remote request. A blank or invalid configuration likewise yields
 * no remote source: {@link parseRemotePackConfig} never throws, it returns a
 * discriminated failure the caller turns into one warning (see
 * `createConfiguredPackSourceRegistry` in `./MainStreetPackSources.ts`).
 *
 * The allow-list is derived from the configured base URL: only that
 * origin/host may ever be requested, so a compromised or buggy caller cannot
 * turn the remote source into a request for an arbitrary host.
 *
 * @see src/MainStreetRemotePackManifest.ts — signed-envelope verification.
 * @see src/MainStreetRemotePackFetch.ts — the allow-listed bounded fetch.
 * @see src/MainStreetPackSources.ts — `createRemotePackSource` + composition.
 * @module
 */

/** Environment variable holding the remote catalogue base URL. */
export const REMOTE_PACK_URL_ENV_VAR = 'VITE_REMOTE_PACK_URL';

/** Environment variable holding the pinned Ed25519 public key (base64). */
export const REMOTE_PACK_PUBLIC_KEY_ENV_VAR = 'VITE_REMOTE_PACK_PUBLIC_KEY';

/** Length of a raw Ed25519 public key, in bytes. */
export const ED25519_PUBLIC_KEY_BYTES = 32;

/** The shape of the build-time environment this module reads. */
export interface RemotePackEnvLike {
  /** Base URL the remote `packs/` tree is served from. */
  readonly VITE_REMOTE_PACK_URL?: unknown;
  /** Pinned Ed25519 public key, raw base64. */
  readonly VITE_REMOTE_PACK_PUBLIC_KEY?: unknown;
}

/** A validated remote pack configuration. */
export interface RemotePackConfig {
  /**
   * The catalogue base URL, normalised: no trailing slash, no credentials, an
   * `http(s)` scheme. Pack files live under `<baseUrl>/packs/`.
   */
  readonly baseUrl: string;
  /** The pinned Ed25519 public key, raw base64 (32 bytes). */
  readonly publicKeyBase64: string;
  /** The allow-listed host (`URL.host`, so a non-default port is included). */
  readonly allowedHost: string;
}

/** Why a remote pack configuration could not be used. */
export type RemotePackConfigFailureStatus =
  /** Neither variable is set — the build carries no remote catalogue. */
  | 'unconfigured'
  /** The variables are set (or blank) but do not form a usable configuration. */
  | 'invalid';

/** A successful parse. */
export interface RemotePackConfigSuccess {
  readonly ok: true;
  readonly config: RemotePackConfig;
}

/** A failed parse; `reason` is a human-readable, actionable explanation. */
export interface RemotePackConfigFailure {
  readonly ok: false;
  readonly status: RemotePackConfigFailureStatus;
  readonly reason: string;
}

/** Discriminated result of {@link parseRemotePackConfig}. */
export type RemotePackConfigResult =
  | RemotePackConfigSuccess
  | RemotePackConfigFailure;

/** Coerce an environment value to a trimmed, non-empty string, or `null`. */
function nonBlankString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Decode strict base64 (standard alphabet, padded, no whitespace) into bytes.
 *
 * Returns `null` for any non-string, malformed or non-canonical input instead
 * of throwing, so callers stay total. Used for the pinned public key, the
 * manifest signature and test fixtures.
 */
export function decodeBase64Bytes(base64: unknown): Uint8Array | null {
  if (typeof base64 !== 'string') return null;
  const trimmed = base64.trim();
  if (trimmed === '' || trimmed.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  try {
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

/** Encode bytes as standard padded base64 (browser- and Node-safe). */
export function encodeBase64Bytes(bytes: ArrayLike<number>): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

/**
 * Parse and validate the remote pack configuration from a build-time env bag.
 *
 * Injectable (`env` is a parameter) so tests need no `import.meta.env` and no
 * rebuild. Never throws: every problem is a discriminated failure with an
 * actionable `reason`.
 *
 * @param env The build-time environment; typically `import.meta.env`.
 */
export function parseRemotePackConfig(
  env: RemotePackEnvLike | null | undefined,
): RemotePackConfigResult {
  const rawUrl = nonBlankString(env?.VITE_REMOTE_PACK_URL);
  const rawKey = nonBlankString(env?.VITE_REMOTE_PACK_PUBLIC_KEY);

  if (rawUrl === null && rawKey === null) {
    return {
      ok: false,
      status: 'unconfigured',
      reason: `${REMOTE_PACK_URL_ENV_VAR} and ${REMOTE_PACK_PUBLIC_KEY_ENV_VAR} are not configured`,
    };
  }
  if (rawUrl === null || rawKey === null) {
    const missing = rawUrl === null ? REMOTE_PACK_URL_ENV_VAR : REMOTE_PACK_PUBLIC_KEY_ENV_VAR;
    return {
      ok: false,
      status: 'invalid',
      reason: `${missing} must be set whenever either remote-pack variable is set`,
    };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, status: 'invalid', reason: `${REMOTE_PACK_URL_ENV_VAR} is not a valid URL` };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      status: 'invalid',
      reason: `${REMOTE_PACK_URL_ENV_VAR} must use an http(s) scheme`,
    };
  }
  if (url.host === '') {
    return { ok: false, status: 'invalid', reason: `${REMOTE_PACK_URL_ENV_VAR} has no host` };
  }
  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      status: 'invalid',
      reason: `${REMOTE_PACK_URL_ENV_VAR} must not contain credentials`,
    };
  }

  const keyBytes = decodeBase64Bytes(rawKey);
  if (keyBytes === null || keyBytes.length !== ED25519_PUBLIC_KEY_BYTES) {
    return {
      ok: false,
      status: 'invalid',
      reason: `${REMOTE_PACK_PUBLIC_KEY_ENV_VAR} must be a base64-encoded ${ED25519_PUBLIC_KEY_BYTES}-byte Ed25519 public key`,
    };
  }

  const basePath = url.pathname.replace(/\/+$/, '');
  return {
    ok: true,
    config: {
      baseUrl: `${url.origin}${basePath}`,
      publicKeyBase64: encodeBase64Bytes(keyBytes),
      allowedHost: url.host,
    },
  };
}

/**
 * The host allow-list predicate: whether *targetUrl* may be requested for the
 * configured catalogue.
 *
 * Only the configured host (`host`, so the port must match too) over the same
 * `http(s)` scheme is allowed, and only when the target is an absolute URL.
 * A `null`/malformed target, a different host, a different port, a non-http
 * scheme or an unconfigured catalogue all return `false` — the callers refuse
 * **before** issuing any request.
 */
export function isRemotePackHostAllowed(
  config: RemotePackConfig | null | undefined,
  targetUrl: unknown,
): boolean {
  if (!config || typeof config !== 'object') return false;
  if (typeof config.allowedHost !== 'string' || config.allowedHost === '') {
    return false;
  }
  const base = parseHttpUrl(config.baseUrl);
  if (base === null) return false;
  const target = parseHttpUrl(targetUrl);
  if (target === null) return false;
  return target.host === config.allowedHost && target.protocol === base.protocol;
}

/** Parse a non-empty string as an `http(s)` URL, or `null`. */
function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.host === '' ? null : url;
  } catch {
    return null;
  }
}
