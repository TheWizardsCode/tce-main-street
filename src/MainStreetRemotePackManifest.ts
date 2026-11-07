/**
 * Main Street: signed remote pack manifests (Ed25519).
 *
 * A remote catalogue is trusted only when its `manifest.json` is a **signed
 * envelope**: the pack-manifest document plus an Ed25519 signature over the
 * document's deterministic canonical payload, verified against the build-time
 * **pinned** public key. This is producer decision Q2 in `MS-0MV26X8T200852AC`
 * ("signed manifests", Ed25519) implemented as the first end-to-end slice.
 *
 * ```
 * {
 *   "manifest": { "version": 1, "packs": [ … ] },
 *   "signature": "<base64 Ed25519 signature over canonical(manifest)>"
 * }
 * ```
 *
 * ## Canonical payload
 *
 * {@link canonicalPackManifestPayload} serialises the manifest deterministically
 * — object keys sorted recursively, no insignificant whitespace, arrays in
 * order — so an external operator can reproduce the exact signed bytes from the
 * JSON document, and reordering keys in the document never changes the payload.
 *
 * ## Totality
 *
 * {@link verifyPackManifestSignature} never throws: absent/blank signatures,
 * malformed envelopes, a tampered body, a signature from a different keypair
 * and an environment without WebCrypto each map to a discriminated status.
 * Ed25519 is available natively (Node 22 WebCrypto and the Playwright Chromium
 * used by the browser tests), so no runtime dependency is added.
 *
 * A `manifest` whose signature verifies `ok` is still only an **envelope**
 * check; the caller validates the document itself with the core
 * `parseCardPackManifest` before trusting it (see `createRemotePackSource`).
 *
 * @see src/MainStreetRemotePackConfig.ts — the pinned public key + allow-list.
 * @see src/MainStreetPackSources.ts — `createRemotePackSource`.
 * @module
 */

import { decodeBase64Bytes } from './MainStreetRemotePackConfig';

/** Raw length of an Ed25519 signature, in bytes. */
export const ED25519_SIGNATURE_BYTES = 64;

/** The signed envelope served as a remote `packs/manifest.json`. */
export interface SignedPackManifestEnvelope {
  /** The pack-manifest document the signature covers. */
  readonly manifest: Record<string, unknown>;
  /** Base64 Ed25519 signature over {@link canonicalPackManifestPayload}. */
  readonly signature: string;
}

/** The discriminated outcome of {@link verifyPackManifestSignature}. */
export type PackManifestVerificationStatus =
  /** The envelope is well formed and the signature verifies. */
  | 'ok'
  /** The envelope carries no signature (absent or blank). */
  | 'missing-signature'
  /** A signature is present but does not verify for the pinned key. */
  | 'invalid-signature'
  /** The served document is not a well-formed signed envelope. */
  | 'malformed-envelope'
  /** Verification could not be attempted (no WebCrypto, unusable pinned key). */
  | 'unavailable';

/** The outcome of verifying one remote manifest. */
export interface PackManifestVerification {
  /** Discriminated verification status. */
  readonly status: PackManifestVerificationStatus;
  /** The enveloped manifest when {@link status} is `ok`; otherwise `null`. */
  readonly manifest: Record<string, unknown> | null;
  /** Human-readable detail (never contains secrets); `null` when `ok`. */
  readonly reason: string | null;
}

/** The minimal WebCrypto surface this module needs (injectable for tests). */
export interface PackManifestSubtleCrypto {
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: { readonly name: string },
    extractable: boolean,
    keyUsages: readonly string[],
  ): Promise<unknown>;
  verify(
    algorithm: { readonly name: string },
    key: unknown,
    signature: Uint8Array,
    data: Uint8Array,
  ): Promise<boolean>;
}

/** Options for {@link verifyPackManifestSignature}. */
export interface VerifyPackManifestSignatureOptions {
  /** The raw text served as the remote `manifest.json` (the signed envelope). */
  readonly envelopeText: unknown;
  /** The pinned Ed25519 public key, raw base64. */
  readonly publicKeyBase64: string;
  /**
   * WebCrypto `subtle` implementation. Defaults to `globalThis.crypto.subtle`;
   * pass `null` to simulate an environment without WebCrypto in tests.
   */
  readonly subtle?: PackManifestSubtleCrypto | null;
}

/** Whether *value* is a plain (non-array, non-null) object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A successful envelope parse. */
interface EnvelopeParseSuccess {
  readonly ok: true;
  readonly envelope: SignedPackManifestEnvelope;
}

/** A failed envelope parse (before any signature work). */
interface EnvelopeParseFailure {
  readonly ok: false;
  readonly status: PackManifestVerificationStatus;
  readonly reason: string;
}

/**
 * Parse a served `manifest.json` into a signed envelope.
 *
 * Never throws. A blank/absent `signature` yields `missing-signature`; non-JSON
 * text, a non-object document, a missing/non-object `manifest`, or a string
 * `signature` that is not strict base64 of the expected length yields
 * `malformed-envelope`.
 */
export function parseSignedPackManifestEnvelope(
  text: unknown,
): EnvelopeParseSuccess | EnvelopeParseFailure {
  if (typeof text !== 'string' || text.trim() === '') {
    return {
      ok: false,
      status: 'malformed-envelope',
      reason: 'the served manifest is empty',
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: 'malformed-envelope',
      reason: 'the served manifest is not valid JSON',
    };
  }
  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      status: 'malformed-envelope',
      reason: 'the served manifest is not a JSON object',
    };
  }

  const signature = parsed.signature;
  if (signature === undefined || signature === null) {
    return {
      ok: false,
      status: 'missing-signature',
      reason: 'the served manifest carries no signature',
    };
  }
  if (typeof signature !== 'string') {
    return {
      ok: false,
      status: 'malformed-envelope',
      reason: 'the manifest signature is not a string',
    };
  }
  if (signature.trim() === '') {
    return {
      ok: false,
      status: 'missing-signature',
      reason: 'the served manifest carries a blank signature',
    };
  }

  const manifest = parsed.manifest;
  if (!isPlainObject(manifest)) {
    return {
      ok: false,
      status: 'malformed-envelope',
      reason: 'the signed envelope carries no manifest object',
    };
  }

  return { ok: true, envelope: { manifest, signature } };
}

/**
 * Canonicalise an arbitrary JSON value for signing/verification.
 *
 * Deterministic and total: object keys are sorted recursively, arrays keep
 * their order, and values JSON cannot represent (`undefined`, functions,
 * symbols) serialise as `null` inside arrays and are dropped from objects —
 * matching `JSON.stringify` — so key reordering never changes the payload.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
      }
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const item = record[key];
        if (
          item === undefined ||
          typeof item === 'function' ||
          typeof item === 'symbol'
        ) {
          continue;
        }
        parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      return 'null';
  }
}

/**
 * The deterministic canonical payload a remote manifest signature covers.
 *
 * Asserted stable under input key reordering, so an external operator can
 * reproduce the signed bytes from the published JSON document.
 */
export function canonicalPackManifestPayload(manifest: unknown): string {
  return canonicalJson(manifest);
}

/** Resolve the WebCrypto `subtle` implementation, or `null` when unusable. */
function resolveSubtle(
  subtle: PackManifestSubtleCrypto | null | undefined,
): PackManifestSubtleCrypto | null {
  if (subtle === null) return null;
  if (subtle !== undefined) return subtle;
  const candidate = (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as PackManifestSubtleCrypto).importKey === 'function' &&
    typeof (candidate as PackManifestSubtleCrypto).verify === 'function'
  ) {
    return candidate as PackManifestSubtleCrypto;
  }
  return null;
}

/**
 * Verify a served remote manifest against the pinned Ed25519 public key.
 *
 * Total: every input (any type, any malformation, a hostile envelope, a missing
 * WebCrypto implementation or an unusable pinned key) resolves to a
 * {@link PackManifestVerification}; nothing is thrown and no network request is
 * made here.
 */
export async function verifyPackManifestSignature(
  options: VerifyPackManifestSignatureOptions,
): Promise<PackManifestVerification> {
  let parsed: EnvelopeParseSuccess | EnvelopeParseFailure;
  try {
    parsed = parseSignedPackManifestEnvelope(options?.envelopeText);
  } catch {
    return {
      status: 'malformed-envelope',
      manifest: null,
      reason: 'the served manifest could not be read',
    };
  }
  if (!parsed.ok) {
    return { status: parsed.status, manifest: null, reason: parsed.reason };
  }

  const signatureBytes = decodeBase64Bytes(parsed.envelope.signature);
  if (signatureBytes === null || signatureBytes.length !== ED25519_SIGNATURE_BYTES) {
    return {
      status: 'invalid-signature',
      manifest: null,
      reason: `the signature is not a base64 ${ED25519_SIGNATURE_BYTES}-byte Ed25519 signature`,
    };
  }

  const subtle = resolveSubtle(options.subtle);
  if (subtle === null) {
    return {
      status: 'unavailable',
      manifest: null,
      reason: 'WebCrypto Ed25519 verification is unavailable in this environment',
    };
  }

  const keyBytes = decodeBase64Bytes(options.publicKeyBase64);
  if (keyBytes === null) {
    return {
      status: 'unavailable',
      manifest: null,
      reason: 'the pinned public key is not valid base64',
    };
  }

  let key: unknown;
  try {
    key = await subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    return {
      status: 'unavailable',
      manifest: null,
      reason: 'the pinned public key could not be imported as an Ed25519 key',
    };
  }

  const payload = canonicalPackManifestPayload(parsed.envelope.manifest);
  const data = new TextEncoder().encode(payload);
  try {
    const valid = await subtle.verify({ name: 'Ed25519' }, key, signatureBytes, data);
    if (!valid) {
      return {
        status: 'invalid-signature',
        manifest: null,
        reason: 'the signature does not verify against the pinned public key',
      };
    }
  } catch {
    return {
      status: 'invalid-signature',
      manifest: null,
      reason: 'the signature could not be verified',
    };
  }

  return { status: 'ok', manifest: parsed.envelope.manifest, reason: null };
}
