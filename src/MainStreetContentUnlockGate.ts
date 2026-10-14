/**
 * Main Street: content-unlock pack entitlement gate.
 *
 * Composes the launcher's unified content-unlock store into Main Street's
 * card-pack entitlement resolution so a declared pack is entitled when the
 * player owns its `dlc:<gameId>:<packId>` content unlock — **in addition to**
 * the existing Steam-DLC status. It plugs into the core renderer loader's
 * `CardPackLoaderOptions.resolveEntitlement` seam
 * (`core/src/ui/CardPackLoader.ts`), so no core loader behaviour changes: the
 * composition lives entirely on the game side.
 *
 * Design rules:
 *   - **Data-driven gating.** Which packs are content-unlock gated is a
 *     declaration ({@link MAIN_STREET_CONTENT_UNLOCK_GATED_PACKS}), not a
 *     hard-coded title in logic. Only declared packs are affected; every other
 *     pack and game keeps the Steam-DLC entitlement untouched.
 *   - **Total.** The composed resolver never throws: a missing, throwing or
 *     malformed content-unlock bridge degrades to the Steam status (the pack
 *     simply stays locked), and a throwing Steam resolver degrades to locked
 *     statuses. A game always boots.
 *   - **Additive.** An already-entitled (`free`/`unlocked`) pack is returned
 *     unchanged; the content unlock can only ever *promote* a gated pack from
 *     locked to unlocked.
 *
 * @see src/MainStreetCardPacks.ts — wires the composed resolver into the loader.
 * @see @ui/content-unlock-client — the total renderer read client.
 * @see @core-engine/DlcGate — the pure, total DLC gate reused here.
 * @module
 */

import { createDlcGate } from '@core-engine';
import type { CardPackStatusRef, PackEntitlementStatusLike } from '@ui/card-pack-client';
import { PACK_LOCK_REASON_STEAM_UNAVAILABLE } from '@ui/card-pack-client';
import type { ContentUnlockClient } from '@ui/content-unlock-client';
import type { CardPackEntitlementResolver } from '@ui/CardPackLoader';

/** The `gameId` Main Street content-unlock gated packs belong to. */
export const MAIN_STREET_GAME_ID = 'main-street';

/**
 * A pack gated on the launcher's unified content-unlock store.
 *
 * The declaration is intentionally data: adding a gated pack is a config
 * change, never a new branch in the entitlement logic.
 */
export interface ContentUnlockGatedPack {
  /** Game the pack extends (unlock target key `dlc:<gameId>:<dlcId>`). */
  readonly gameId: string;
  /** Pack id (manifest `id`). */
  readonly packId: string;
  /**
   * DLC id used in the unlock target key. Defaults to {@link packId} — the
   * Main Street convention where a pack's DLC id is its pack id.
   */
  readonly dlcId?: string;
  /** Human-readable lock reason; defaults to {@link CONTENT_UNLOCK_LOCK_REASON}. */
  readonly lockReason?: string;
  /**
   * Id of the launcher reward rule that performs the scoped simulated purchase
   * for this pack (see `core/electron/action-rewards.json`). Absent → the pack
   * offers no purchase affordance.
   */
  readonly purchaseRuleId?: string;
}

/** Default lock reason shown when a gated pack is not unlocked. */
export const CONTENT_UNLOCK_LOCK_REASON =
  'Requires the Main Street Residential card pack — unlock it from the Card Packs panel.';

/**
 * The packs Main Street gates on the unified content-unlock store.
 *
 * This is the single, data-driven declaration: the residential pack is
 * entitled by the `dlc:main-street:main-street-residential-pack` unlock.
 */
export const MAIN_STREET_CONTENT_UNLOCK_GATED_PACKS: readonly ContentUnlockGatedPack[] = [
  {
    gameId: MAIN_STREET_GAME_ID,
    packId: 'main-street-residential-pack',
    purchaseRuleId: 'main-street-residential-pack-purchase',
  },
];

/**
 * Find the gating declaration for a pack, or `null` when it is not gated.
 *
 * A `gameId` on the ref is authoritative when present; when it is absent the
 * match falls back to the pack id alone (best effort — the core loader always
 * supplies the manifest `gameId`).
 */
export function findContentUnlockGatedPack(
  gameId: string | null | undefined,
  packId: string,
  gatedPacks: readonly ContentUnlockGatedPack[] = MAIN_STREET_CONTENT_UNLOCK_GATED_PACKS,
): ContentUnlockGatedPack | null {
  for (const declaration of gatedPacks) {
    if (declaration.packId !== packId) continue;
    if (gameId && declaration.gameId !== gameId) continue;
    return declaration;
  }
  return null;
}

/** Whether a pack is declared content-unlock gated. */
export function isContentUnlockGatedPack(
  gameId: string | null | undefined,
  packId: string,
  gatedPacks: readonly ContentUnlockGatedPack[] = MAIN_STREET_CONTENT_UNLOCK_GATED_PACKS,
): boolean {
  return findContentUnlockGatedPack(gameId, packId, gatedPacks) !== null;
}

/** The `dlc:<gameId>:<dlcId>` unlock target key for a gated pack. */
export function contentUnlockKeyFor(declaration: ContentUnlockGatedPack): string {
  return `dlc:${declaration.gameId}:${declaration.dlcId ?? declaration.packId}`;
}

/** The status assumed when the Steam resolver returned nothing for a ref. */
function defaultStatus(ref: CardPackStatusRef): PackEntitlementStatusLike {
  return {
    packId: ref.id,
    gameId: ref.gameId ?? null,
    state: 'free',
    steamAppId: null,
    reason: null,
  };
}

/** A locked status for a ref with the supplied reason. */
function lockedStatus(
  ref: CardPackStatusRef,
  reason: string,
): PackEntitlementStatusLike {
  return {
    packId: ref.id,
    gameId: ref.gameId ?? null,
    state: 'locked',
    steamAppId: ref.steamAppId ?? null,
    reason,
  };
}

/** Normalise a resolver result entry (or fill a default) for one ref. */
function statusForRef(
  ref: CardPackStatusRef,
  status: PackEntitlementStatusLike | undefined,
): PackEntitlementStatusLike {
  if (
    typeof status === 'object' &&
    status !== null &&
    typeof status.packId === 'string'
  ) {
    return status;
  }
  return defaultStatus(ref);
}

/**
 * Whether the unified store reports a gated pack's DLC target unlocked.
 *
 * Total: a missing/malformed client, or a throwing bridge, yields `false` so a
 * gated pack whose entitlement cannot be read stays locked rather than
 * crashing the boot. The pure {@link createDlcGate} enforces the totality
 * contract.
 */
async function isGatedPackUnlocked(
  contentUnlocks: ContentUnlockClient | null | undefined,
  declaration: ContentUnlockGatedPack,
): Promise<boolean> {
  if (!contentUnlocks || typeof contentUnlocks.isUnlocked !== 'function') {
    return false;
  }
  const gate = createDlcGate({
    gameId: declaration.gameId,
    isUnlocked: (target) => contentUnlocks.isUnlocked(target),
  });
  return gate.isUnlocked(declaration.dlcId ?? declaration.packId);
}

/** Options for {@link composeContentUnlockEntitlement}. */
export interface ComposeContentUnlockEntitlementOptions {
  /**
   * The Steam-DLC entitlement resolver the composition augments (usually
   * `(refs) => cardPackClient.listStatus(refs)`). A throwing resolver degrades
   * to locked statuses.
   */
  readonly steam: CardPackEntitlementResolver;
  /**
   * The unified content-unlock read client. Absent/malformed → gated packs
   * stay locked (the Steam status is preserved).
   */
  readonly contentUnlocks?: ContentUnlockClient | null;
  /** Gating declaration override (tests); defaults to the Main Street set. */
  readonly gatedPacks?: readonly ContentUnlockGatedPack[];
}

/**
 * Compose a total entitlement resolver that adds the unified content-unlock
 * store on top of the Steam-DLC status.
 *
 * For every declared content-unlock gated pack the resolver checks the
 * `dlc:<gameId>:<dlcId>` unlock: a positive unlock promotes the pack to
 * `unlocked`; otherwise the pack is reported `locked` with an actionable
 * reason (its rows never merge). Non-declared packs are returned exactly as
 * the Steam resolver reported them, so their entitlement is unchanged.
 *
 * Never throws: every failure degrades to the Steam status / a locked status.
 */
export function composeContentUnlockEntitlement(
  options: ComposeContentUnlockEntitlementOptions,
): CardPackEntitlementResolver {
  const gatedPacks = options.gatedPacks ?? MAIN_STREET_CONTENT_UNLOCK_GATED_PACKS;

  return async (
    refs: readonly CardPackStatusRef[],
  ): Promise<PackEntitlementStatusLike[]> => {
    let steamStatuses: PackEntitlementStatusLike[];
    try {
      steamStatuses = await options.steam(refs);
      if (!Array.isArray(steamStatuses)) steamStatuses = [];
    } catch {
      steamStatuses = refs.map((ref) =>
        lockedStatus(ref, PACK_LOCK_REASON_STEAM_UNAVAILABLE),
      );
    }

    return Promise.all(
      refs.map(async (ref, index): Promise<PackEntitlementStatusLike> => {
        const status = statusForRef(ref, steamStatuses[index]);
        const declaration = findContentUnlockGatedPack(
          ref.gameId,
          ref.id,
          gatedPacks,
        );
        // Only declared gated packs are touched; an already-entitled pack is
        // returned unchanged so a content unlock can only promote, never lock.
        if (!declaration || status.state === 'unlocked') return status;

        const unlocked = await isGatedPackUnlocked(options.contentUnlocks, declaration);
        if (unlocked) {
          return { ...status, state: 'unlocked', reason: null };
        }
        return {
          ...status,
          state: 'locked',
          reason: declaration.lockReason ?? CONTENT_UNLOCK_LOCK_REASON,
        };
      }),
    );
  };
}
