/**
 * Pack-art test harness: committed fixtures, a fake asset transport, and a
 * `LoadedCardPack` builder with inlined `data:` URIs.
 *
 * Child of the Main Street DLC work item `MS-0MV26K321003MWO0` (feature F1).
 * Every later pack-art child (`MS-0MV592994004GTUE` registry,
 * `MS-0MV592AIA0073B98` end-to-end verification) resolves its fake pack bytes
 * and inlined art through this module, so the pack-art tests cannot drift.
 *
 * Nothing here touches production code: the transport and builder are
 * test doubles shaped to match the core card-pack loader seam
 * (`CardPackLoaderOptions.fetchAsset` / `LoadedCardPack.assetDataUris`) without
 * reading from the network or the launcher's `tce-packs://` protocol.
 *
 * @see tests/main-street/helpers/fixtures/pack-art/generate-fixtures.mjs — regenerates the fixtures.
 * @see tests/main-street/helpers/residentialPack.ts — the derived card-id ↔ asset mapping.
 * @see core/src/ui/CardPackLoader.ts — the production loader contract this mirrors.
 * @module
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CardPackManifestEntry } from '@core-engine';
import type { LoadedCardPack } from '@ui/CardPackLoader';
import { resolveCardPackAssetUrl } from '@ui/card-pack-url';

import {
  RESIDENTIAL_PACK_GAME_ID,
  RESIDENTIAL_PACK_ID,
  residentialPackCardIdToAsset,
} from './residentialPack';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Media type of every committed pack-art fixture. */
export const PACK_ART_FIXTURE_MEDIA_TYPE = 'image/png';

/** Directory holding the committed fake pack-art fixtures. */
export const PACK_ART_FIXTURES_DIR = path.join(HERE, 'fixtures', 'pack-art');

/**
 * Injectable asset-byte transport, matching the shape the core loader accepts
 * as `CardPackLoaderOptions.fetchAsset` (URL → `Uint8Array`).
 */
export type PackArtAssetTransport = (url: string) => Promise<Uint8Array>;

/**
 * A `LoadedCardPack` whose declared assets are also inlined as `data:` URIs.
 *
 * Mirrors the additive field the core card-pack seam exposes
 * (`assetDataUris`, keyed by card id / asset filename stem) so a test can feed
 * a fully-populated pack into the runtime pack-art registry.
 */
export interface LoadedCardPackWithArt extends LoadedCardPack {
  /** Inlined `data:<media>;base64,…` URIs keyed by card id (asset stem). */
  readonly assetDataUris: Readonly<Record<string, string>>;
}

/** Absolute path of the committed fixture for *cardId*. */
export function packArtFixturePath(cardId: string): string {
  return path.join(PACK_ART_FIXTURES_DIR, `${cardId}.png`);
}

/**
 * The filename stem of an asset path or URL — the card id under Option A
 * (`<cardId>.png`). Query strings and fragments are ignored.
 */
export function packAssetStem(assetPathOrUrl: string): string {
  const withoutQuery = assetPathOrUrl.split(/[?#]/)[0];
  const base = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Read one committed fixture's PNG bytes. */
export function readPackArtFixture(cardId: string): Uint8Array {
  return readFileSync(packArtFixturePath(cardId));
}

/** Load every committed fixture in *dir*, keyed by card id (filename stem). */
export function loadPackArtFixtures(
  dir: string = PACK_ART_FIXTURES_DIR,
): Map<string, Uint8Array> {
  const fixtures = new Map<string, Uint8Array>();
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.png')) continue;
    fixtures.set(packAssetStem(entry), readFileSync(path.join(dir, entry)));
  }
  return fixtures;
}

/**
 * Load the fixture for every card id declared by the production residential
 * pack, keyed by card id. Throws if a declared card has no committed fixture,
 * so a missing fixture fails loudly.
 */
export function loadResidentialPackArtFixtures(): Map<string, Uint8Array> {
  const fixtures = new Map<string, Uint8Array>();
  for (const cardId of residentialPackCardIdToAsset().keys()) {
    fixtures.set(cardId, readPackArtFixture(cardId));
  }
  return fixtures;
}

/** Normalise the accepted asset-map shapes to `[key, bytes]` entries. */
function assetEntries(
  assets: ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>,
): Array<[string, Uint8Array]> {
  if (assets instanceof Map) return [...assets.entries()];
  return Object.entries(assets);
}

/**
 * Build an asset-byte transport that serves *assets* without any network
 * access.
 *
 * Keys may be resolved pack URLs (`tce-packs://…`), pack-relative asset paths,
 * or bare card ids. Each lookup first matches the key exactly, then falls back
 * to the filename stem, so a caller can seed only `cardId → bytes`. An unknown
 * URL rejects with an actionable error, mirroring the loader's per-asset
 * degradation path.
 */
export function createFakeAssetTransport(
  assets: ReadonlyMap<string, Uint8Array> | Readonly<Record<string, Uint8Array>>,
): PackArtAssetTransport {
  const byKey = new Map<string, Uint8Array>();
  const byStem = new Map<string, Uint8Array>();
  for (const [key, bytes] of assetEntries(assets)) {
    byKey.set(key, bytes);
    byStem.set(packAssetStem(key), bytes);
  }
  return async (url: string): Promise<Uint8Array> => {
    const direct = byKey.get(url);
    if (direct) return direct;
    const byFilename = byStem.get(packAssetStem(url));
    if (byFilename) return byFilename;
    throw new Error(`Fake pack-art transport has no bytes for "${url}".`);
  };
}

/** Base64-inline *bytes* as a `data:` URI with the supplied media type. */
export function bytesToDataUri(
  bytes: Uint8Array,
  mediaType: string = PACK_ART_FIXTURE_MEDIA_TYPE,
): string {
  return `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** Base64-inline PNG *bytes* as a `data:image/png;base64,…` URI. */
export function pngBytesToDataUri(bytes: Uint8Array): string {
  return bytesToDataUri(bytes, PACK_ART_FIXTURE_MEDIA_TYPE);
}

/** Options accepted by {@link buildLoadedCardPack}. */
export interface BuildLoadedCardPackOptions {
  /** PNG bytes keyed by card id (filename stem = card id). */
  readonly assets:
    | ReadonlyMap<string, Uint8Array>
    | Readonly<Record<string, Uint8Array>>;
  /** Pack-relative asset path for a card id; defaults to `assets/<cardId>.png`. */
  readonly assetPathFor?: (cardId: string) => string;
  /** CSV fragment text the pack contributes; defaults to empty. */
  readonly csv?: string;
  /** Manifest field overrides (id, gameId, title, …). */
  readonly manifest?: Partial<CardPackManifestEntry>;
  /** Whether the pack is enabled; defaults to `true`. */
  readonly enabled?: boolean;
}

/** Default Option A asset path for a card id. */
function defaultAssetPath(cardId: string): string {
  return `assets/${cardId}.png`;
}

/**
 * Build a `LoadedCardPack` as the core loader would return it, with every
 * supplied `cardId → PNG bytes` pair inlined as a `data:` URI.
 *
 * The declared `assets` list and resolved `assetUrls` are derived from the
 * card ids (Option A: stem = card id), so a test can hand the result to the
 * runtime pack-art registry and serve its bytes through
 * {@link createFakeAssetTransport}.
 */
export function buildLoadedCardPack(
  options: BuildLoadedCardPackOptions,
): LoadedCardPackWithArt {
  const overrides = options.manifest ?? {};
  const packId = overrides.id ?? RESIDENTIAL_PACK_ID;
  const gameId = overrides.gameId ?? RESIDENTIAL_PACK_GAME_ID;
  const assetPathFor = options.assetPathFor ?? defaultAssetPath;
  const entries = assetEntries(options.assets);
  const assetPaths = entries.map(([cardId]) => assetPathFor(cardId));

  const manifest: CardPackManifestEntry = {
    id: packId,
    gameId,
    title: overrides.title ?? 'Pack-Art Test Pack',
    description: overrides.description ?? 'Fake pack for pack-art tests.',
    version: overrides.version ?? '1.0.0',
    coreEngineVersion: overrides.coreEngineVersion ?? '^0.1.0',
    cards: overrides.cards ?? 'cards.csv',
    assets: assetPaths,
    ...(overrides.entitlement ? { entitlement: overrides.entitlement } : {}),
  };

  const assetDataUris: Record<string, string> = {};
  for (const [cardId, bytes] of entries) {
    assetDataUris[cardId] = pngBytesToDataUri(bytes);
  }

  return {
    manifest,
    csv: options.csv ?? '',
    assetUrls: assetPaths.map((assetPath) =>
      resolveCardPackAssetUrl(gameId, packId, assetPath),
    ),
    assetDataUris,
    status: {
      packId,
      gameId,
      state: 'free',
      steamAppId: null,
      reason: null,
    },
    enabled: options.enabled ?? true,
  };
}
