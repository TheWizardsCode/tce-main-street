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
 * Several remote catalogues compose additively through
 * `VITE_REMOTE_PACK_SOURCES`, a JSON array of `{ "url", "publicKey" }`
 * entries. Its entries keep the order they are declared in, so the first
 * catalogue listed wins a pack-id conflict between remote sources
 * ({@link parseRemotePackSourceConfigs}). The single-source variables remain
 * supported as a one-entry fallback when the list is unset.
 *
 * **Inert when unset.** An unconfigured build composes no remote source and
 * performs no remote request. A blank or invalid configuration likewise yields
 * no remote source: {@link parseRemotePackConfig} never throws, it returns a
 * discriminated failure the caller turns into one warning (see
 * `createConfiguredPackSourceRegistry` in `./MainStreetPackSources.ts`). A
 * malformed **individual** list entry is skipped (and reported) without
 * discarding its valid siblings.
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

/**
 * Environment variable holding several remote catalogues as a JSON array of
 * `{ "url": "https://…", "publicKey": "<base64>" }` entries, in precedence
 * order. When set it replaces the single-source variables.
 */
export const REMOTE_PACK_SOURCES_ENV_VAR = 'VITE_REMOTE_PACK_SOURCES';

/** Length of a raw Ed25519 public key, in bytes. */
export const ED25519_PUBLIC_KEY_BYTES = 32;

/** The shape of the build-time environment this module reads. */
export interface RemotePackEnvLike {
  /** Base URL the remote `packs/` tree is served from. */
  readonly VITE_REMOTE_PACK_URL?: unknown;
  /** Pinned Ed25519 public key, raw base64. */
  readonly VITE_REMOTE_PACK_PUBLIC_KEY?: unknown;
  /**
   * Several remote catalogues as a JSON array of `{ url, publicKey }` entries,
   * in precedence order. Takes precedence over the single-source variables.
   */
  readonly VITE_REMOTE_PACK_SOURCES?: unknown;
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

/** One configured remote catalogue that could not be used. */
export interface RemotePackConfigSkip {
  /** Zero-based position of the entry in `VITE_REMOTE_PACK_SOURCES`. */
  readonly index: number;
  /** Actionable reason the entry was skipped. */
  readonly reason: string;
}

/** A successful parse of the ordered remote-catalogue list. */
export interface RemotePackConfigsSuccess {
  readonly ok: true;
  /**
   * The usable catalogues, in declared order. An entry that cannot be used is
   * omitted (and reported in {@link skipped}) without discarding its siblings.
   */
  readonly configs: readonly RemotePackConfig[];
  /** Configured entries that were skipped, with their reasons. */
  readonly skipped: readonly RemotePackConfigSkip[];
}

/** Discriminated result of {@link parseRemotePackSourceConfigs}. */
export type RemotePackConfigsResult =
  | RemotePackConfigsSuccess
  | RemotePackConfigFailure;

/**
 * Parse the ordered list of remote catalogues a build declares.
 *
 * When `VITE_REMOTE_PACK_SOURCES` is set it must be a non-empty JSON array of
 * `{ "url", "publicKey" }` objects. Each entry is validated with
 * {@link parseRemotePackConfig}, and an unusable entry is **skipped and
 * reported** rather than rejecting the whole build: one bad catalogue never
 * disables the others. The declared order is preserved so precedence between
 * remote sources is the order the operator wrote them in.
 *
 * When the list variable is unset (or blank) the single-source
 * `VITE_REMOTE_PACK_URL` / `VITE_REMOTE_PACK_PUBLIC_KEY` pair is used as a
 * one-entry list, which keeps an existing single-catalogue build byte-for-byte
 * compatible. With neither configured the result is the `unconfigured`
 * failure.
 *
 * Never throws: malformed JSON, a non-array value or an empty array is an
 * `invalid` failure with an actionable `reason`.
 *
 * @param env The build-time environment; typically `import.meta.env`.
 */
export function parseRemotePackSourceConfigs(
  env: RemotePackEnvLike | null | undefined,
): RemotePackConfigsResult {
  const rawSources = nonBlankString(env?.VITE_REMOTE_PACK_SOURCES);
  if (rawSources === null) {
    const single = parseRemotePackConfig(env);
    return single.ok
      ? { ok: true, configs: [single.config], skipped: [] }
      : single;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawSources);
  } catch {
    return {
      ok: false,
      status: 'invalid',
      reason: `${REMOTE_PACK_SOURCES_ENV_VAR} is not valid JSON`,
    };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return {
      ok: false,
      status: 'invalid',
      reason:
        `${REMOTE_PACK_SOURCES_ENV_VAR} must be a non-empty JSON array of ` +
        '{ "url", "publicKey" } entries',
    };
  }

  const configs: RemotePackConfig[] = [];
  const skipped: RemotePackConfigSkip[] = [];
  parsed.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      skipped.push({ index, reason: 'entry is not an object' });
      return;
    }
    const candidate = entry as Record<string, unknown>;
    const result = parseRemotePackConfig({
      VITE_REMOTE_PACK_URL: candidate.url,
      VITE_REMOTE_PACK_PUBLIC_KEY: candidate.publicKey,
    });
    if (result.ok) {
      configs.push(result.config);
    } else {
      skipped.push({ index, reason: result.reason });
    }
  });

  return { ok: true, configs, skipped };
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
