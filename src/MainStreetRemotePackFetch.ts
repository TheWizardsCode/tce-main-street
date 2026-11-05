/**
 * Main Street: the allow-listed, bounded text fetch for remote card packs.
 *
 * One total primitive ({@link createRemotePackTextFetcher}) is the only place
 * the remote pack source touches the network. It enforces the two gates the
 * remote source promises:
 *
 *   1. **Host allow-list first.** A target that is not on the configured host is
 *      refused *before* any request — the injected transport is never called.
 *   2. **Hard timeout.** Every read is bounded by
 *      {@link DEFAULT_REMOTE_PACK_TIMEOUT_MS} (≈3 s, producer decision Q3) via
 *      an `AbortController`, so the boot path never stalls on a hung host.
 *
 * Every failure — refusal, timeout, transport rejection, a non-2xx response or
 * a body-read failure — resolves to `null` and logs **exactly one** warning on
 * the supplied logger. Nothing thrown: the caller degrades to the other pack
 * sources (bundled content stays available).
 *
 * @see src/MainStreetRemotePackConfig.ts — configuration + allow-list predicate.
 * @see src/MainStreetPackSources.ts — `createRemotePackSource`.
 * @module
 */

import {
  isRemotePackHostAllowed,
  type RemotePackConfig,
} from './MainStreetRemotePackConfig';

/** Default hard timeout for one remote read, in milliseconds (≈3 s). */
export const DEFAULT_REMOTE_PACK_TIMEOUT_MS = 3000;

/** A warning sink; structurally compatible with the game's logger seam. */
export interface RemotePackWarningLogger {
  warn(message: string): void;
}

/** The minimal `Response` surface the fetcher consumes. */
export interface RemotePackFetchResponse {
  /** Whether the response was a 2xx success. */
  readonly ok: boolean;
  /** HTTP status code, when the transport reports one. */
  readonly status?: number;
  /** HTTP status text, when the transport reports one. */
  readonly statusText?: string;
  /** Read the response body as text. */
  text(): Promise<string>;
}

/** The injectable transport; defaults to the renderer's global `fetch`. */
export type RemotePackFetchImpl = (
  url: string,
  init: { readonly signal?: AbortSignal },
) => Promise<RemotePackFetchResponse>;

/** A total text fetcher: resolves the body text, or `null` on any failure. */
export type RemotePackTextFetcher = (url: string) => Promise<string | null>;

/** Options for {@link createRemotePackTextFetcher}. */
export interface RemotePackFetchOptions {
  /**
   * The validated remote configuration. Absent/`null` (or an invalid value at
   * runtime) refuses every read without issuing a request.
   */
  readonly config: RemotePackConfig | null | undefined;
  /** Warning sink; defaults to `console`. */
  readonly logger?: RemotePackWarningLogger;
  /** Transport override (tests); defaults to the global `fetch`. */
  readonly fetchText?: RemotePackFetchImpl;
  /** Hard timeout in milliseconds; defaults to {@link DEFAULT_REMOTE_PACK_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/** The default transport: the renderer's global `fetch`. */
const defaultFetchText: RemotePackFetchImpl = async (url, init) => {
  const response = await fetch(url, init);
  return response as unknown as RemotePackFetchResponse;
};

/** Describe an unknown thrown value without leaking anything sensitive. */
function errorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

/** Resolve a usable timeout, falling back to the default for hostile values. */
function resolveTimeout(timeoutMs: number | undefined): number {
  if (
    typeof timeoutMs === 'number' &&
    Number.isFinite(timeoutMs) &&
    timeoutMs > 0
  ) {
    return timeoutMs;
  }
  return DEFAULT_REMOTE_PACK_TIMEOUT_MS;
}

/**
 * Build the total, allow-listed, bounded text fetcher for one configuration.
 *
 * The returned function never throws and never rejects: it resolves the body
 * text on success, or `null` after logging one warning. A read is refused
 * without a request when the target is not on the configured host.
 */
export function createRemotePackTextFetcher(
  options: RemotePackFetchOptions,
): RemotePackTextFetcher {
  const logger = options.logger ?? console;
  const fetchText = options.fetchText ?? defaultFetchText;
  const timeoutMs = resolveTimeout(options.timeoutMs);
  const config = options.config ?? null;

  const warn = (message: string): void => {
    logger.warn(`[main-street] remote packs: ${message}`);
  };

  return async function fetchRemotePackText(url: string): Promise<string | null> {
    if (!isRemotePackHostAllowed(config, url)) {
      warn(
        `refused "${String(url)}" — not on the configured host ` +
          `"${config?.allowedHost ?? '<unconfigured>'}"; no request was made.`,
      );
      return null;
    }

    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (controller !== null) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    try {
      let response: RemotePackFetchResponse;
      try {
        response = await fetchText(url, controller ? { signal: controller.signal } : {});
      } catch (error) {
        if (timedOut) {
          warn(`timed out after ${timeoutMs}ms reading "${url}".`);
        } else {
          warn(`failed to read "${url}": ${errorMessage(error)}.`);
        }
        return null;
      }

      if (!response || response.ok !== true) {
        const status = response?.status;
        warn(
          `failed to read "${url}": HTTP ${
            typeof status === 'number' ? status : 'error'
          }${response?.statusText ? ` ${response.statusText}` : ''}.`,
        );
        return null;
      }

      try {
        const text = await response.text();
        if (typeof text !== 'string') {
          warn(`failed to read "${url}": the response body was not text.`);
          return null;
        }
        return text;
      } catch (error) {
        warn(`failed to read the body of "${url}": ${errorMessage(error)}.`);
        return null;
      }
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  };
}
