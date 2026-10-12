/**
 * Main Street pack-art registry (F3, `MS-0MV26K321003MWO0`).
 *
 * A card pack declares its art as `assets/<cardId>.png`; the core
 * `loadCardPacks` seam reads those bytes through the environment-injected
 * transport and exposes them as `LoadedCardPack.assetDataUris` (card id → an
 * inlined `data:` URI). Because `MainStreetCardSvgGenerator` rasterises each
 * card face from a `data:` URI, the art must be available **synchronously** at
 * render time — this module holds the per-card inlined URIs in a module-level
 * map.
 *
 * The registry is populated during pack bootstrap
 * ({@link bootstrapMainStreetCardPacks}) and cleared on reset, so it is always
 * fully populated before `MainStreetSvgTextureManager` generates textures.
 *
 * Lookup is by **card id** (Option A: the asset filename stem equals the card
 * id), not by display name — so a pack card's bespoke art follows a card
 * rename, and a pack can never shadow a base card it does not own.
 *
 * @see src/MainStreetCardArt.ts — the pack-aware resolver that reads this map.
 * @see core/src/ui/CardPackLoader.ts — the loader that produces the data URIs.
 * @module
 */

/** Module-level card id → inlined `data:` art URI registry. */
const PACK_ART = new Map<string, string>();

/**
 * Register one card's inlined pack art.
 *
 * A blank card id or data URI is ignored, so a malformed pack cannot poison
 * the registry. Re-registering an id replaces the previous value (later packs
 * win), mirroring the loader's pack ordering.
 */
export function registerPackArt(cardId: string, dataUri: string): void {
  if (!cardId || !dataUri) return;
  PACK_ART.set(cardId, dataUri);
}

/**
 * Register every `cardId → dataUri` entry of a pack's inlined assets.
 *
 * Convenience wrapper used by the bootstrap wiring; it applies the same
 * blank-guard as {@link registerPackArt}.
 */
export function registerPackArtAssets(
  assets: Readonly<Record<string, string>>,
): void {
  for (const [cardId, dataUri] of Object.entries(assets)) {
    registerPackArt(cardId, dataUri);
  }
}

/**
 * The inlined pack art for a card id, or `undefined` when no pack supplies it.
 *
 * Returning `undefined` (rather than a fallback) lets the caller fall through
 * to the base name-keyed art map and then the generic `Fallback` sprite.
 */
export function getPackArtDataUri(cardId: string): string | undefined {
  if (!cardId) return undefined;
  return PACK_ART.get(cardId);
}

/** Whether a pack supplies inlined art for a card id. */
export function hasPackArt(cardId: string): boolean {
  return Boolean(cardId) && PACK_ART.has(cardId);
}

/** Clear the registry (pack reset, or a failed/disabled pack leaving base-only state). */
export function resetPackArt(): void {
  PACK_ART.clear();
}

/** Number of registered pack-art entries (diagnostics and tests). */
export function packArtCount(): number {
  return PACK_ART.size;
}
