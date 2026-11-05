/**
 * Main Street: pack-source registry and the build-time bundled source.
 *
 * Main Street resolves card-pack content from an ordered set of interchangeable
 * **sources** rather than hard-wiring the Electron content directory. A source
 * is consulted in registration order and returns the raw text of a file under
 * the `packs/` root (`manifest.json`, a pack's `cards.csv`) or a browser-usable
 * URL for a pack asset. The registry is the single place source order is
 * decided, so a same-origin static source or a remote-bundle source can be
 * added **additively** without touching the core renderer loader
 * (`core/src/ui/CardPackLoader.ts`) or the in-game listing.
 *
 * The first source — {@link createBundledPackSource} — bakes the committed
 * production pack into the web build with Vite's `import.meta.glob`:
 * `?raw` for `manifest.json` and the pack CSVs, `?url` for the pack assets.
 * Nothing needs copying into `<contentDir>/packs/` for the browser
 * distribution; changing a bundled pack requires a rebuild in this iteration.
 *
 * Wiring is through the loader's existing injectable transport seams:
 * {@link createPackSourceTransports} adapts a registry to the
 * `fetchManifest` / `fetchCsv` callbacks, so `loadMainStreetCardPacks` can
 * serve bundled content with no core change. Explicit transports always win,
 * which keeps the Electron content-directory path untouched.
 *
 * The second source — {@link createRemotePackSource} — serves a **signed**
 * remote catalogue from the build-time configured base URL
 * (`VITE_REMOTE_PACK_URL` / `VITE_REMOTE_PACK_PUBLIC_KEY`). It fetches and
 * refuses only: the catalogue is trusted solely when its Ed25519 signature
 * verifies against the pinned key, every fetch is host allow-listed and
 * timeout-bounded, and any failure rejects the whole source with one warning.
 * Composing it with {@link createConfiguredPackSourceRegistry} registers the
 * bundled source **first**, so a registry configured with `mergeManifests`
 * lists both catalogues while the bundled entry wins any pack-id conflict
 * (`MS-0MVSFWBE6004SPDI`).
 *
 * **Totality.** The registry never throws: an unknown pack ref, a missing
 * bundled file, a source that rejects, or an empty registry all resolve to
 * `null`, and the core loader degrades to base content.
 *
 * ## Adding a source
 *
 * 1. Implement {@link PackSource} (a stable {@link PackSource.id} plus
 *    {@link PackSource.readPackFile}; optionally
 *    {@link PackSource.resolvePackFileUrl}).
 * 2. Register it on the registry, **after** the sources it should defer to:
 *    `registry.add(mySource)` (or construct
 *    `new PackSourceRegistry([bundled, mySource])`).
 *
 * Sources are consulted in order, so put the most specific/authoritative
 * source first. A source must be total (return `null`, never throw).
 *
 * @see src/MainStreetCardPacks.ts — consumes the transports via the
 *   `packSources` option.
 * @see @ui/CardPackLoader — the core loader whose seams this adapts.
 * @module
 */

import type {
  CardPackAssetFetcher,
  CardPackCsvFetcher,
  CardPackManifestFetcher,
} from '@ui/CardPackLoader';
import {
  parseCardPackManifest,
  type CardPackManifest,
  type CardPackManifestEntry,
} from '@core-engine';
import {
  parseRemotePackConfig,
  type RemotePackConfig,
  type RemotePackEnvLike,
} from './MainStreetRemotePackConfig';
import {
  createRemotePackTextFetcher,
  type RemotePackFetchImpl,
  type RemotePackTextFetcher,
} from './MainStreetRemotePackFetch';
import {
  verifyPackManifestSignature,
  type PackManifestSubtleCrypto,
} from './MainStreetRemotePackManifest';

/** A path relative to the `packs/` root, e.g. `manifest.json`. */
export type PackFilePath = string;

/** A warning sink; structurally compatible with the game's logger seam. */
export interface PackSourceLogger {
  warn(message: string): void;
}

/** The packs-relative path of the catalogue manifest. */
const MANIFEST_PACK_PATH = 'manifest.json';

/** Options for {@link PackSourceRegistry}. */
export interface PackSourceRegistryOptions {
  /**
   * Merge every source's `manifest.json` into one catalogue document instead of
   * returning the first source's text.
   *
   * Used by {@link createConfiguredPackSourceRegistry} so a bundled and a
   * remote catalogue are listed together. Default `false` keeps the historic
   * first-wins text read for callers that expect one document verbatim.
   */
  readonly mergeManifests?: boolean;
}

/**
 * One interchangeable provider of card-pack content.
 *
 * Implementations must be **total**: a file this source does not carry (or a
 * read it cannot perform) resolves to `null`, never an exception. The registry
 * defensively catches a rejecting source too, so a third-party source cannot
 * break the boot.
 */
export interface PackSource {
  /** Stable, human-readable source id (used for registration and logging). */
  readonly id: string;
  /**
   * Read a text file under the `packs/` root.
   *
   * @param path A normalised, packs-relative path (e.g. `manifest.json` or
   *   `main-street/<packId>/cards.csv`).
   * @returns The file's text, or `null` when this source does not carry it.
   */
  readPackFile(path: PackFilePath): Promise<string | null>;
  /**
   * Resolve a browser-usable URL for a binary pack asset.
   *
   * Optional: a source that only serves text can omit it. Returns `null` when
   * the asset is not available through this source.
   */
  resolvePackFileUrl?(path: PackFilePath): Promise<string | null>;
}

/** Whether *value* is a usable {@link PackSource} (id + text reader). */
function isPackSource(value: unknown): value is PackSource {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PackSource>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.readPackFile === 'function'
  );
}

/** Await *operation*, mapping any rejection to `null` (total helper). */
async function safely<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch {
    return null;
  }
}

/**
 * An ordered, additive list of {@link PackSource}s.
 *
 * Consulted in registration order by {@link readPackFile} /
 * {@link resolvePackFileUrl}; the first source that returns a non-null value
 * wins. Registration is idempotent by source id so re-adding the same source
 * is a no-op, and adding a source never removes or reorders the existing ones
 * (the "additive" contract).
 *
 * With {@link PackSourceRegistryOptions.mergeManifests} enabled the
 * `manifest.json` read is special: every source's catalogue document is parsed
 * and merged into one manifest (source order preserved, first pack id wins), so
 * a bundled and a remote catalogue are listed together while a source whose
 * manifest is malformed contributes nothing. Pack files (`cards.csv`, assets)
 * keep first-wins consultation, so the bundled source always beats a remote
 * source for a duplicate pack.
 */
export class PackSourceRegistry {
  private readonly registered: PackSource[] = [];
  private readonly mergeManifests: boolean;

  constructor(
    sources: readonly PackSource[] = [],
    options: PackSourceRegistryOptions = {},
  ) {
    this.mergeManifests = options.mergeManifests === true;
    for (const source of sources) this.add(source);
  }

  /**
   * Append *source*, preserving the order of the sources already registered.
   * An invalid source, or one whose id is already registered, is ignored.
   */
  add(source: PackSource): this {
    if (!isPackSource(source)) return this;
    if (this.registered.some((existing) => existing.id === source.id)) {
      return this;
    }
    this.registered.push(source);
    return this;
  }

  /** A defensive copy of the registered sources, in consultation order. */
  get sources(): readonly PackSource[] {
    return [...this.registered];
  }

  /**
   * Read *path* from the first source that carries it, or `null` when no
   * source does. Never throws.
   *
   * When manifest merging is enabled, the `manifest.json` read merges every
   * source's catalogue instead of returning the first one.
   */
  async readPackFile(path: PackFilePath): Promise<string | null> {
    if (this.mergeManifests && path === MANIFEST_PACK_PATH) {
      return this.readMergedManifest();
    }
    for (const source of this.registered) {
      const text = await safely(() => source.readPackFile(path));
      if (typeof text === 'string') return text;
    }
    return null;
  }

  /**
   * Merge every source's catalogue document into one manifest.
   *
   * Packs keep source order and the **first** pack id wins, which is exactly
   * the registry's first-wins consultation order: a bundled pack can never be
   * overridden by a remote pack with the same id. A source whose manifest is
   * missing or not a valid pack catalogue contributes nothing (its whole
   * catalogue is rejected). Never throws.
   */
  private async readMergedManifest(): Promise<string | null> {
    const documents: CardPackManifest[] = [];
    for (const source of this.registered) {
      const text = await safely(() => source.readPackFile(MANIFEST_PACK_PATH));
      if (typeof text !== 'string') continue;
      const parsed = parseCardPackManifest(text);
      if (!parsed.ok) continue;
      documents.push(parsed.manifest);
    }
    if (documents.length === 0) return null;
    if (documents.length === 1) return JSON.stringify(documents[0]);

    const seenPackIds = new Set<string>();
    const packs: CardPackManifestEntry[] = [];
    for (const document of documents) {
      for (const pack of document.packs) {
        if (seenPackIds.has(pack.id)) continue;
        seenPackIds.add(pack.id);
        packs.push(pack);
      }
    }
    return JSON.stringify({ version: documents[0].version, packs });
  }

  /**
   * Resolve a browser-usable URL for *path* from the first source that can, or
   * `null` when no source can. Never throws.
   */
  async resolvePackFileUrl(path: PackFilePath): Promise<string | null> {
    for (const source of this.registered) {
      if (typeof source.resolvePackFileUrl !== 'function') continue;
      const url = await safely(() => source.resolvePackFileUrl!(path));
      if (typeof url === 'string') return url;
    }
    return null;
  }
}

// ── Bundled (build-time) source ──────────────────────────────

/** The id of the build-time bundled source. */
export const BUNDLED_PACK_SOURCE_ID = 'bundled';

/**
 * The committed production packs, baked into the bundle at build time.
 *
 * `?raw` imports the manifest and every pack CSV as a string; `?url` imports
 * the asset binaries as emitted, same-origin URLs. Vite replaces these globs
 * with a map keyed by the source-relative path at transform time, so the
 * content is part of the module graph in both the browser build and tests.
 */
const BUNDLED_TEXT_GLOBS: Record<string, () => Promise<unknown>> = {
  ...import.meta.glob('../packs/manifest.json', {
    query: '?raw',
    import: 'default',
  }),
  ...import.meta.glob('../packs/**/cards.csv', {
    query: '?raw',
    import: 'default',
  }),
};

/** Asset binaries under `packs/`, imported as emitted URLs. */
const BUNDLED_ASSET_GLOBS: Record<string, () => Promise<unknown>> =
  import.meta.glob('../packs/**/*.{png,jpg,jpeg,webp,gif,svg,mp3,ogg,wav}', {
    query: '?url',
    import: 'default',
  });

/** Strip the source-relative `../packs/` prefix from a glob key. */
function toPackRelativePath(globKey: string): string {
  return globKey.replace(/^(?:\.\.\/)+packs\//, '');
}

/** Re-key a Vite glob map from source-relative to packs-relative paths. */
function normaliseGlobModules(
  modules: Readonly<Record<string, () => Promise<unknown>>>,
): Record<string, () => Promise<unknown>> {
  const normalised: Record<string, () => Promise<unknown>> = {};
  for (const [key, load] of Object.entries(modules)) {
    normalised[toPackRelativePath(key)] = load;
  }
  return normalised;
}

/**
 * Normalise a packs-relative path, rejecting traversal and empty paths.
 * Returns `null` when the path is unusable, so the bundled source can never
 * be tricked into reading outside `packs/`.
 */
function normalisePackPath(path: string): string | null {
  if (typeof path !== 'string' || path.trim() === '') return null;
  if (path.includes('\0')) return null;
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    segments.push(segment);
  }
  return segments.length > 0 ? segments.join('/') : null;
}

/** Extract a string from a loaded Vite glob module value. */
function textFromModule(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const fallback = (value as Record<string, unknown>).default;
    if (typeof fallback === 'string') return fallback;
  }
  return null;
}

/** Load one module value by packs-relative (or glob) path, or `null`. */
async function loadModuleValue(
  modules: Readonly<Record<string, () => Promise<unknown>>>,
  path: string,
): Promise<unknown> {
  const normalised = normalisePackPath(path);
  if (normalised === null) return null;
  const load = modules[normalised];
  if (typeof load !== 'function') return null;
  return safely(() => load());
}

/** Injectable module maps for {@link createBundledPackSource} (tests). */
export interface BundledPackModules {
  /**
   * Text module loaders keyed by **packs-relative** path (e.g.
   * `manifest.json`, `main-street/<packId>/cards.csv`). Defaults to the
   * compiled-in `?raw` globs.
   */
  readonly text?: Readonly<Record<string, () => Promise<unknown>>>;
  /**
   * URL module loaders keyed by **packs-relative** path. Defaults to the
   * compiled-in `?url` globs.
   */
  readonly urls?: Readonly<Record<string, () => Promise<unknown>>>;
}

/**
 * Build the bundled {@link PackSource}: the committed production packs baked
 * into the build by Vite's `import.meta.glob`.
 *
 * @param modules Test seam; absent uses the compiled-in glob maps.
 */
export function createBundledPackSource(
  modules: BundledPackModules = {},
): PackSource {
  const text = modules.text ?? normaliseGlobModules(BUNDLED_TEXT_GLOBS);
  const urls = modules.urls ?? normaliseGlobModules(BUNDLED_ASSET_GLOBS);

  return {
    id: BUNDLED_PACK_SOURCE_ID,
    async readPackFile(path: PackFilePath): Promise<string | null> {
      return textFromModule(await loadModuleValue(text, path));
    },
    async resolvePackFileUrl(path: PackFilePath): Promise<string | null> {
      return textFromModule(await loadModuleValue(urls, path));
    },
  };
}

/**
 * The default registry: the bundled build-time source only.
 *
 * Callers that add a same-origin or remote source register it after this one
 * (or construct their own registry with the bundled source first).
 */
export function createDefaultPackSourceRegistry(): PackSourceRegistry {
  return new PackSourceRegistry([createBundledPackSource()]);
}

// ── Remote (signed) source ──────────────────────────────────

/** The id of the remote (signed catalogue) source. */
export const REMOTE_PACK_SOURCE_ID = 'remote';

/**
 * The remote catalogue schema version this build understands.
 *
 * A signed catalogue that declares any other `version` is rejected whole: the
 * game must never interpret a document whose shape it does not know.
 */
export const SUPPORTED_REMOTE_PACK_MANIFEST_VERSION = 1;

/** Directory under the configured base URL that holds the catalogue. */
const REMOTE_PACKS_DIRNAME = 'packs';

/** Options for {@link createRemotePackSource}. */
export interface RemotePackSourceOptions {
  /** The validated build-time configuration (see `MainStreetRemotePackConfig`). */
  readonly config: RemotePackConfig;
  /**
   * Raw transport override (tests); defaults to the global `fetch`.
   *
   * It is always composed through {@link createRemotePackTextFetcher}, so the
   * host allow-list and the hard timeout apply to every injected transport too.
   */
  readonly fetchImpl?: RemotePackFetchImpl;
  /** Warning sink; defaults to `console`. */
  readonly logger?: PackSourceLogger;
  /** Hard per-read timeout in milliseconds; defaults to ≈3 s. */
  readonly timeoutMs?: number;
  /** WebCrypto implementation override (tests); defaults to `globalThis.crypto.subtle`. */
  readonly subtle?: PackManifestSubtleCrypto | null;
}

/** A verified remote catalogue: the manifest text plus its declared pack roots. */
interface VerifiedRemoteManifest {
  /** The verified catalogue document, re-serialised for the loader. */
  readonly text: string;
  /** Lower-cased `<gameId>/<packId>/` roots this source may serve files from. */
  readonly packRoots: readonly string[];
}

/** A source that never contributes anything (invalid configuration). */
function inertRemotePackSource(): PackSource {
  return {
    id: REMOTE_PACK_SOURCE_ID,
    async readPackFile(): Promise<string | null> {
      return null;
    },
    async resolvePackFileUrl(): Promise<string | null> {
      return null;
    },
  };
}

/**
 * Build the remote {@link PackSource}: a signed catalogue served over HTTPS.
 *
 * The source **fetches and refuses only**. On the first read it fetches
 * `<base>/packs/manifest.json`, verifies the Ed25519 signature against the
 * pinned key, validates the enveloped document with the core manifest parser,
 * and memoises the verdict for the lifetime of the instance — so one boot
 * performs one manifest fetch and one verification, not one per CSV. Any
 * failure (host refusal, timeout, non-2xx, missing/invalid signature, malformed
 * catalogue) rejects the **whole source** with exactly one warning and every
 * path from it resolves `null`.
 *
 * Once verified, `manifest.json` is served from memory and only files under a
 * pack root the catalogue declares (`<gameId>/<packId>/…`) are fetched. The
 * source never throws, whatever the configuration or transport does.
 *
 * @param options Configuration plus injectable transport/logger/crypto seams.
 */
export function createRemotePackSource(
  options: RemotePackSourceOptions,
): PackSource {
  const logger = options?.logger ?? console;
  const config = options?.config;
  if (
    !config ||
    typeof config.baseUrl !== 'string' ||
    config.baseUrl === '' ||
    typeof config.publicKeyBase64 !== 'string' ||
    config.publicKeyBase64 === ''
  ) {
    logger.warn(
      '[main-street] remote packs: invalid configuration; the remote pack source is disabled.',
    );
    return inertRemotePackSource();
  }

  const fetchText: RemotePackTextFetcher = createRemotePackTextFetcher({
    config,
    logger,
    timeoutMs: options.timeoutMs,
    fetchText: options.fetchImpl,
  });

  const warn = (message: string): void => {
    logger.warn(`[main-street] remote packs: ${message}`);
  };

  const remoteUrl = (path: string): string =>
    `${config.baseUrl}/${REMOTE_PACKS_DIRNAME}/${path}`;

  let verifiedPromise: Promise<VerifiedRemoteManifest | null> | null = null;

  const ensureVerifiedManifest = (): Promise<VerifiedRemoteManifest | null> => {
    verifiedPromise ??= safely(verifyRemoteManifest);
    return verifiedPromise;
  };

  async function verifyRemoteManifest(): Promise<VerifiedRemoteManifest | null> {
    const manifestUrl = remoteUrl(MANIFEST_PACK_PATH);
    const envelopeText = await safely(() => fetchText(manifestUrl));
    // The transport already logged exactly one warning for its own failure.
    if (typeof envelopeText !== 'string') return null;

    const verification = await verifyPackManifestSignature({
      envelopeText,
      publicKeyBase64: config.publicKeyBase64,
      subtle: options.subtle,
    });
    if (verification.status !== 'ok' || verification.manifest === null) {
      warn(
        `rejected the catalogue at "${manifestUrl}" ` +
          `(${verification.status}: ${verification.reason ?? 'verification failed'}); ` +
          'no packs from this source are loaded.',
      );
      return null;
    }

    const parsed = parseCardPackManifest(verification.manifest);
    if (!parsed.ok) {
      warn(
        `rejected the catalogue at "${manifestUrl}" (malformed manifest: ` +
          `${parsed.errors.join('; ')}); no packs from this source are loaded.`,
      );
      return null;
    }

    if (parsed.manifest.version !== SUPPORTED_REMOTE_PACK_MANIFEST_VERSION) {
      warn(
        `rejected the catalogue at "${manifestUrl}" (unsupported manifest ` +
          `version ${parsed.manifest.version}; this build supports version ` +
          `${SUPPORTED_REMOTE_PACK_MANIFEST_VERSION}); no packs from this ` +
          'source are loaded.',
      );
      return null;
    }

    const packRoots: string[] = [];
    for (const pack of parsed.manifest.packs) {
      const root = normalisePackPath(`${pack.gameId}/${pack.id}/`);
      if (root !== null) packRoots.push(`${root}/`.toLowerCase());
    }
    return { text: JSON.stringify(parsed.manifest), packRoots };
  }

  const isDeclaredFile = (
    manifest: VerifiedRemoteManifest,
    path: string,
  ): boolean => {
    const lower = path.toLowerCase();
    return manifest.packRoots.some((root) => lower.startsWith(root));
  };

  return {
    id: REMOTE_PACK_SOURCE_ID,
    async readPackFile(path: PackFilePath): Promise<string | null> {
      const normalised = normalisePackPath(path);
      if (normalised === null) return null;

      const manifest = await ensureVerifiedManifest();
      if (manifest === null) return null;
      if (normalised === MANIFEST_PACK_PATH) return manifest.text;
      if (!isDeclaredFile(manifest, normalised)) return null;

      const text = await safely(() => fetchText(remoteUrl(normalised)));
      return typeof text === 'string' ? text : null;
    },
    async resolvePackFileUrl(path: PackFilePath): Promise<string | null> {
      const normalised = normalisePackPath(path);
      if (normalised === null) return null;

      const manifest = await ensureVerifiedManifest();
      if (manifest === null) return null;
      if (!isDeclaredFile(manifest, normalised)) return null;
      return remoteUrl(normalised);
    },
  };
}

/** Options for {@link createConfiguredPackSourceRegistry}. */
export interface ConfiguredPackSourceRegistryOptions {
  /** Build-time env bag; defaults to `import.meta.env`. */
  readonly env?: RemotePackEnvLike | null;
  /** Warning sink; defaults to `console`. */
  readonly logger?: PackSourceLogger;
  /** Raw transport override (tests); defaults to the global `fetch`. */
  readonly fetchImpl?: RemotePackFetchImpl;
  /** Hard per-read timeout in milliseconds; defaults to ≈3 s. */
  readonly timeoutMs?: number;
  /** WebCrypto implementation override (tests). */
  readonly subtle?: PackManifestSubtleCrypto | null;
  /** Bundled module maps (tests); defaults to the compiled-in globs. */
  readonly bundledModules?: BundledPackModules;
}

/** The build-time env bag, read defensively (a bundler may not provide one). */
function defaultRemotePackEnv(): RemotePackEnvLike {
  try {
    return (import.meta.env ?? {}) as RemotePackEnvLike;
  } catch {
    return {};
  }
}

/**
 * Compose the registry the browser boot path uses: the bundled source **first**,
 * then the configured remote source when the build declares one.
 *
 * The registry merges both catalogues (bundled first, so a bundled pack always
 * wins a pack-id conflict) and keeps first-wins file consultation, which makes
 * remote packs appear in the Card Packs listing alongside bundled packs with no
 * UI change. An unset, blank or invalid configuration composes **no** remote
 * source, performs no remote request, and logs one warning — never throws.
 *
 * @param options Injectable env/transport/logger/crypto seams (tests).
 */
export function createConfiguredPackSourceRegistry(
  options: ConfiguredPackSourceRegistryOptions = {},
): PackSourceRegistry {
  const logger = options.logger ?? console;
  const parsed = parseRemotePackConfig(options.env ?? defaultRemotePackEnv());
  const sources: PackSource[] = [createBundledPackSource(options.bundledModules)];

  if (parsed.ok) {
    sources.push(
      createRemotePackSource({
        config: parsed.config,
        logger,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        subtle: options.subtle,
      }),
    );
  } else {
    logger.warn(
      `[main-street] remote packs: remote pack discovery inactive — ` +
        `${parsed.reason}; using bundled packs only.`,
    );
  }

  return new PackSourceRegistry(sources, { mergeManifests: true });
}

// ── Loader transport adapters ────────────────────────────────

/**
 * Recover the packs-relative path of a pack manifest URL.
 *
 * The core loader builds the manifest URL as `<contentDir>/packs/manifest.json`
 * (any scheme). Only the trailing `packs/manifest.json` matters to a source, so
 * a remote or sentinel content directory resolves identically. Returns `null`
 * when the URL is not a packs manifest.
 */
export function packPathFromManifestUrl(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  if (url === 'manifest.json') return 'manifest.json';
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Not an absolute URL — match the raw string (e.g. a sentinel base).
  }
  return /(?:^|\/)packs\/manifest\.json$/.test(pathname) ? 'manifest.json' : null;
}

/**
 * Recover the packs-relative path of a `tce-packs://<gameId>/<packId>/<path>`
 * URL (used by the core loader for pack CSVs and assets).
 *
 * Returns `null` for any other scheme or a malformed URL. This is a pure string
 * transform: it never performs the request, so adapting it to a source makes
 * the browser path issue **no `tce-packs://` request**.
 */
export function packPathFromPackUrl(url: string): string | null {
  if (typeof url !== 'string') return null;
  const match = /^tce-packs:\/\/([^/]+)\/([^/?#]+)\/([^?#]+)/.exec(url);
  if (!match) return null;
  const gameId = match[1].toLowerCase();
  const packId = match[2].toLowerCase();
  const file = match[3].replace(/\\/g, '/').replace(/^\/+/, '');
  if (file.length === 0) return null;
  return `${gameId}/${packId}/${file}`;
}

/** The loader transport callbacks a {@link PackSourceRegistry} supplies. */
export interface PackSourceTransports {
  /** Manifest transport for `CardPackLoaderOptions.fetchManifest`. */
  readonly fetchManifest: CardPackManifestFetcher;
  /** CSV transport for `CardPackLoaderOptions.fetchCsv`. */
  readonly fetchCsv: CardPackCsvFetcher;
  /**
   * Asset-byte transport for `CardPackLoaderOptions.fetchAsset`. Resolves the
   * loader's `tce-packs://` asset URL to a browser-usable URL through the
   * registry (the `?url` emitted for a bundled asset) before reading its bytes,
   * so the browser path never issues a `tce-packs://` request.
   */
  readonly fetchAsset: CardPackAssetFetcher;
}

/** Default asset-byte read: the renderer's global `fetch` + `arrayBuffer`. */
async function defaultFetchAssetBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Adapt *registry* to the core loader's manifest/CSV/asset transport seams.
 *
 * The returned callbacks map the URL the loader would have requested to a
 * packs-relative path and read it from the registry. When no source carries the
 * file they throw a descriptive error **for the loader's existing try/catch**,
 * so discovery degrades to base content rather than crashing (the registry
 * itself stays total). Assets are resolved to a browser-usable URL before the
 * injected byte reader is called, so a bundled `?url` is read same-origin and
 * a `tce-packs://` request is never made.
 *
 * Defaults to the bundled registry, which also keeps the bundled pack (its
 * `?raw` text and `?url` assets) referenced from the production module graph so
 * the web build emits it even before a caller wires a source explicitly.
 *
 * @param registry        Source registry; defaults to the bundled registry.
 * @param fetchAssetBytes Asset-byte reader; defaults to `fetch` + `arrayBuffer`.
 */
export function createPackSourceTransports(
  registry: PackSourceRegistry = createDefaultPackSourceRegistry(),
  fetchAssetBytes: (url: string) => Promise<Uint8Array> = defaultFetchAssetBytes,
): PackSourceTransports {
  return {
    async fetchManifest(url: string): Promise<string> {
      const path = packPathFromManifestUrl(url) ?? 'manifest.json';
      const text = await registry.readPackFile(path);
      if (text === null) {
        throw new Error(`No pack source resolved "${path}".`);
      }
      return text;
    },
    async fetchCsv(url: string): Promise<string> {
      const path = packPathFromPackUrl(url);
      const text = path === null ? null : await registry.readPackFile(path);
      if (text === null) {
        throw new Error(`No pack source resolved "${url}".`);
      }
      return text;
    },
    async fetchAsset(url: string): Promise<Uint8Array> {
      const resolved = await resolvePackAssetUrl(registry, url);
      if (resolved === null) {
        throw new Error(`No pack source resolved asset "${url}".`);
      }
      return fetchAssetBytes(resolved);
    },
  };
}

/**
 * Resolve a loader-produced pack URL (CSV or asset) to a browser-usable URL
 * through *registry*, or `null` when no source can.
 *
 * Exposed so the browser boot path can rewrite the core loader's
 * `tce-packs://` asset references to same-origin/relative URLs without a
 * direct request to the Electron-only scheme.
 */
export async function resolvePackAssetUrl(
  registry: PackSourceRegistry,
  packUrl: string,
): Promise<string | null> {
  const path = packPathFromPackUrl(packUrl);
  return path === null ? null : registry.resolvePackFileUrl(path);
}
