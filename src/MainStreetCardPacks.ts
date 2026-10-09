/**
 * Main Street: Card Pack Merge & Persistence (DLC card packs).
 *
 * Main Street's single, documented card-pack entry point. It resolves the
 * card packs installed for this game through the core renderer loader
 * (`@ui/CardPackLoader`) and the entitlement client
 * (`@ui/card-pack-client`), feeds `base CARD_DATA_RAW + pack rows` through the
 * core deterministic merge (`mergeCardPackCsv`), and applies the result to the
 * template arrays through exactly one call to `loadTemplatesFromCsv()`.
 *
 * Responsibilities:
 *   - {@link mergeMainStreetCardPool} — pure `base + packs → pool` merge; the
 *     ONE place packs are combined with the base card pool.
 *   - {@link loadMainStreetCardPacks} — async discovery + merge; never throws,
 *     degrades to base content on any failure, and warns about packs that are
 *     missing / disabled / locked / incompatible.
 *   - {@link applyMainStreetCardPool} / {@link resetMainStreetCardPacks} — apply
 *     the pool to the live template arrays and record the active pack set.
 *   - {@link findMissingLiveTemplateIds} — the "refuse only when a live card
 *     instance requires a missing template" check.
 *
 * Design rules (mirroring the core DLC channel):
 *   - **Never throw.** Every environment failure degrades to base content.
 *   - **One merge entry point.** No other module concatenates pack CSV rows.
 *   - **Every pack column is persisted.** Saves record active pack ids +
 *     versions + the merged checksum (`csvChecksum` / `csvData`) so a load
 *     restores the exact same pool.
 *
 * @see MainStreetCardsTemplates.ts — `loadTemplatesFromCsv` (the apply target).
 * @see MainStreetStateSerialize.ts — persists the active pack set.
 * @see @core-engine/CardPackMerge — the deterministic merge.
 * @see @ui/CardPackLoader — the renderer discovery/entitlement loader.
 * @module
 */

import {
  computeMergedChecksum,
  mergeCardPackCsv,
  type CardPackMergeConflict,
  type CardPackMergeResult,
  type IncompatiblePack,
} from '@core-engine';
import {
  loadCardPacks,
  type CardPackLoadError,
  type CardPackLoadResult,
  type CardPackLoaderOptions,
  type LoadedCardPack,
  type LockedCardPack,
} from '@ui/CardPackLoader';
import {
  cardPackClientFromWindow,
  type CardPackClient,
} from '@ui/card-pack-client';
import {
  contentUnlockClientFromWindow,
  type ContentUnlockClient,
} from '@ui/content-unlock-client';
import { readContentDirFromWindow } from '@ui/game-plugin-boot';
import {
  MAIN_STREET_GAME_ID,
  composeContentUnlockEntitlement,
} from './MainStreetContentUnlockGate';
import {
  getEnabledCardPackIds,
  setEnabledCardPackIds,
  type StorageLike,
} from './MainStreetPrefs';
import {
  CARD_DATA_RAW,
  getBusinessTemplates,
  getCommunitySpaceTemplates,
  getEventTemplates,
  getStaffCardTemplates,
  getUpgradeTemplates,
  loadTemplatesFromCsv,
  resetTemplatesToDefault,
} from './MainStreetCardsTemplates';
import type { ActiveMainStreetPack } from './MainStreetCardsTypes';
import { getBaseTypeId } from './MainStreetCardsUtils';
import type { MainStreetState } from './MainStreetStateTypes';

export type { ActiveMainStreetPack };

/**
 * The `gameId` Main Street pack manifests must declare.
 *
 * Re-exported from {@link ./MainStreetContentUnlockGate} so the content-unlock
 * gating declaration and the loader share one source of truth.
 */
export { MAIN_STREET_GAME_ID };

/** A merged Main Street card pool ready to apply to the templates. */
export interface MainStreetCardPool {
  /** The merged CSV text (`base + accepted packs`). */
  readonly csv: string;
  /** Deterministic checksum of {@link csv} (persisted as `csvChecksum`). */
  readonly checksum: string;
  /** Packs whose rows were merged, in manifest order (`[]` for base only). */
  readonly activePacks: ActiveMainStreetPack[];
  /** Duplicate card ids across the base pool and packs. */
  readonly conflicts: CardPackMergeConflict[];
  /** Structural merge problems (unusable base, rejected packs). */
  readonly errors: string[];
  /** True when no pack contributed rows. */
  readonly baseOnly: boolean;
}

/** Options for {@link mergeMainStreetCardPool}. */
export interface MergeMainStreetCardPoolOptions {
  /**
   * When provided, only these pack ids are eligible (the player's enabled
   * set). Absent merges every enabled (entitled) pack the loader returned.
   */
  readonly enabledPackIds?: readonly string[];
}

/** Injectable discovery seam (tests pass a stub instead of a content dir). */
export type MainStreetCardPackLoader = (
  options: CardPackLoaderOptions,
) => Promise<CardPackLoadResult>;

/** A minimal logger seam; defaults to `console`. */
export interface MainStreetCardPackLogger {
  warn(message: string): void;
}

/** Options for {@link loadMainStreetCardPacks}. */
export interface MainStreetPackLoadOptions {
  /** The launcher-resolved content directory (URL or absolute path). */
  readonly contentDir: string;
  /** Core-engine version for compatibility; defaults to the core constant. */
  readonly engineVersion?: string;
  /**
   * Packs recorded in a save being loaded. Used only for *degradation
   * warnings*: a requested pack that is not active produces a "missing" or
   * "disabled" warning instead of a silent drop.
   */
  readonly requestedPacks?: readonly ActiveMainStreetPack[];
  /** Restrict the merge to this enabled set (absent = all entitled packs). */
  readonly enabledPackIds?: readonly string[];
  /** Manifest transport override (tests). */
  readonly fetchManifest?: CardPackLoaderOptions['fetchManifest'];
  /** CSV transport override (tests). */
  readonly fetchCsv?: CardPackLoaderOptions['fetchCsv'];
  /** Dynamic-import fallback transport override (tests). */
  readonly importer?: CardPackLoaderOptions['importer'];
  /** Entitlement client; defaults to the total `window.tce` client. */
  readonly client?: CardPackClient;
  /**
   * Unified content-unlock read client; defaults to the total
   * `window.tce.contentUnlocks` client. A missing/malformed client leaves
   * content-unlock gated packs locked.
   */
  readonly contentUnlocks?: ContentUnlockClient | null;
  /** Discovery loader override; defaults to the core `loadCardPacks`. */
  readonly loader?: MainStreetCardPackLoader;
  /** Warning sink; defaults to `console`. */
  readonly logger?: MainStreetCardPackLogger;
}

/** Outcome of {@link loadMainStreetCardPacks}. Never thrown. */
export interface MainStreetPackLoadResult {
  /** The merged pool (base only when nothing loaded/applied). */
  readonly pool: MainStreetCardPool;
  /** Entitled packs the loader read, enabled by default. */
  readonly loaded: LoadedCardPack[];
  /** Compatible but unentitled packs (never fetched). */
  readonly locked: LockedCardPack[];
  /** Core-range incompatible packs. */
  readonly incompatible: IncompatiblePack[];
  /** Human-readable degradation warnings (missing/disabled/locked/errors). */
  readonly warnings: string[];
  /** Pack-level and manifest-level load failures. */
  readonly errors: CardPackLoadError[];
}

// ── Active pack registry (module-level) ─────────────────────

/** The pack set currently applied to the live template arrays. */
let _activePacks: ActiveMainStreetPack[] = [];

/**
 * Returns the packs currently active in this process (a defensive copy).
 * Serialized into saves as `activePacks`.
 */
export function getActiveMainStreetPacks(): ActiveMainStreetPack[] {
  return _activePacks.map((pack) => ({ id: pack.id, version: pack.version }));
}

/**
 * Records the active pack set without touching the templates.
 *
 * Used by the deserializer after it has restored the merged CSV, so a loaded
 * save keeps reporting the pack set it was created with.
 */
export function setActiveMainStreetPacks(
  packs: readonly ActiveMainStreetPack[] | undefined,
): void {
  _activePacks = (packs ?? [])
    .filter(
      (pack): pack is ActiveMainStreetPack =>
        typeof pack?.id === 'string' && pack.id.length > 0,
    )
    .map((pack) => ({ id: pack.id, version: typeof pack.version === 'string' ? pack.version : '' }));
}

// ── Merge (the single entry point) ───────────────────────────

/**
 * Merge the base card CSV with the loaded packs' CSV fragments.
 *
 * Pure and deterministic: it delegates to the core `mergeCardPackCsv` (which
 * rejects a mismatched/conflicting pack *whole*), then records the accepted
 * pack ids + versions and the merged checksum. This is the ONE place pack
 * rows are combined with Main Street's base pool.
 *
 * @param baseCsv  Main Street's base card CSV (usually `CARD_DATA_RAW`).
 * @param packs    Entitled packs from {@link loadMainStreetCardPacks}.
 * @param options  Optional enabled-id filter.
 */
export function mergeMainStreetCardPool(
  baseCsv: string,
  packs: readonly LoadedCardPack[] = [],
  options: MergeMainStreetCardPoolOptions = {},
): MainStreetCardPool {
  const enabledIds =
    options.enabledPackIds !== undefined
      ? new Set(options.enabledPackIds)
      : null;

  const candidates = packs.filter((pack) => {
    if (!pack.enabled) return false;
    if (enabledIds && !enabledIds.has(pack.manifest.id)) return false;
    return true;
  });

  const result: CardPackMergeResult = mergeCardPackCsv(
    baseCsv,
    candidates.map((pack) => ({ id: pack.manifest.id, csv: pack.csv })),
  );

  const rejected = rejectedPackIds(result);
  const applied = candidates.filter((pack) => !rejected.has(pack.manifest.id));

  // With no pack contributing rows the merged text is regenerated from the
  // parsed rows (which normalises the original file), so return the *exact*
  // base text/checksum instead: a base-only pool must be byte-identical to
  // the bundled CSV or an existing base save's checksum would no longer match.
  const csv = applied.length === 0 ? baseCsv : (result.merged ?? baseCsv);

  return {
    csv,
    checksum: computeMergedChecksum(csv),
    activePacks: applied.map((pack) => ({
      id: pack.manifest.id,
      version: pack.manifest.version,
    })),
    conflicts: result.conflicts,
    errors: result.errors,
    baseOnly: applied.length === 0,
  };
}

/**
 * The packs the core merge rejected, derived from its structural report.
 *
 * A pack is rejected whole when its header does not match the base schema
 * (reported as `Pack "<id>": …` in `errors`) or when it contributes a
 * duplicate card id (reported in `conflicts` with the pack id as a source).
 * The core merge is the single source of truth, so this only *derives* the
 * accepted subset for the saved active-pack metadata — it never merges rows.
 */
function rejectedPackIds(result: CardPackMergeResult): Set<string> {
  const rejected = new Set<string>();
  for (const conflict of result.conflicts) {
    for (const source of conflict.sources) {
      if (source !== 'base') rejected.add(source);
    }
  }
  for (const error of result.errors) {
    const match = /^Pack "([^"]+)":/.exec(error);
    if (match) rejected.add(match[1]);
  }
  return rejected;
}

/** A base-content-only pool (used when discovery fails). */
function baseCardPool(): MainStreetCardPool {
  return {
    csv: CARD_DATA_RAW,
    checksum: computeMergedChecksum(CARD_DATA_RAW),
    activePacks: [],
    conflicts: [],
    errors: [],
    baseOnly: true,
  };
}

// ── Discovery + merge (async) ────────────────────────────────

/**
 * Discover the installed card packs for Main Street, merge them with the base
 * pool, and report degradation warnings.
 *
 * Never throws: a missing/malformed manifest, an unavailable entitlement
 * bridge, and a failed CSV read all fall back to base content (the caller can
 * still apply {@link MainStreetPackLoadResult.pool} safely). A pack recorded in
 * a save but not currently active is reported as *missing* (not installed) or
 * *disabled* (installed but excluded/locked).
 */
export async function loadMainStreetCardPacks(
  options: MainStreetPackLoadOptions,
): Promise<MainStreetPackLoadResult> {
  const logger = options.logger ?? console;
  const client = options.client ?? cardPackClientFromWindow();
  const loader = options.loader ?? loadCardPacks;

  let result: CardPackLoadResult;
  try {
    result = await loader({
      contentDir: options.contentDir,
      gameId: MAIN_STREET_GAME_ID,
      engineVersion: options.engineVersion,
      fetchManifest: options.fetchManifest,
      fetchCsv: options.fetchCsv,
      importer: options.importer,
      resolveEntitlement: composeContentUnlockEntitlement({
        steam: (refs) => client.listStatus(refs),
        contentUnlocks: options.contentUnlocks ?? contentUnlockClientFromWindow(),
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const warning = `Card pack discovery failed (${message}); continuing with base content.`;
    logger.warn(warning);
    return {
      pool: baseCardPool(),
      loaded: [],
      locked: [],
      incompatible: [],
      warnings: [warning],
      errors: [],
    };
  }

  const pool = mergeMainStreetCardPool(CARD_DATA_RAW, result.packs, {
    enabledPackIds: options.enabledPackIds,
  });

  const warnings: string[] = [];
  for (const error of result.errors) {
    warnings.push(`Card pack "${error.id}" could not be read: ${error.reason}`);
  }
  for (const locked of result.locked) {
    warnings.push(
      `Card pack "${locked.manifest.id}" is locked (${locked.reason}); it is not active.`,
    );
  }
  for (const item of result.incompatible) {
    warnings.push(
      `Card pack "${item.pack.id}" is incompatible (${item.reason}); it is not active.`,
    );
  }
  warnings.push(...missingPackWarnings(options.requestedPacks, pool, result));

  for (const warning of warnings) {
    logger.warn(warning);
  }

  return {
    pool,
    loaded: result.packs,
    locked: result.locked,
    incompatible: result.incompatible,
    warnings,
    errors: result.errors,
  };
}

/** Warnings for packs a save recorded that are no longer active. */
function missingPackWarnings(
  requested: readonly ActiveMainStreetPack[] | undefined,
  pool: MainStreetCardPool,
  result: CardPackLoadResult,
): string[] {
  if (!requested || requested.length === 0) return [];
  const active = new Set(pool.activePacks.map((pack) => pack.id));
  const known = new Set<string>([
    ...result.packs.map((pack) => pack.manifest.id),
    ...result.locked.map((pack) => pack.manifest.id),
    ...result.incompatible.map((item) => item.pack.id),
  ]);

  const warnings: string[] = [];
  for (const pack of requested) {
    if (active.has(pack.id)) continue;
    const version = pack.version ? ` (v${pack.version})` : '';
    if (known.has(pack.id)) {
      warnings.push(
        `Card pack "${pack.id}"${version} is disabled; continuing without its cards.`,
      );
    } else {
      warnings.push(
        `Card pack "${pack.id}"${version} is missing; continuing without its cards.`,
      );
    }
  }
  return warnings;
}

// ── Apply / reset ────────────────────────────────────────────

/**
 * Apply a merged pool to the live template arrays through the single
 * `loadTemplatesFromCsv()` entry point and record the active pack set.
 *
 * After this call, new game state deals pack cards and
 * `getActiveCsvData()` / `getActiveCsvChecksum()` reflect the merged pool, so
 * the next save persists the same content.
 */
export function applyMainStreetCardPool(pool: MainStreetCardPool): void {
  loadTemplatesFromCsv(pool.csv);
  setActiveMainStreetPacks(pool.activePacks);
}

/**
 * Restore the bundled base pool and clear the active pack set.
 * Used when starting a fresh game or when pack discovery is skipped.
 */
export function resetMainStreetCardPacks(): void {
  resetTemplatesToDefault();
  setActiveMainStreetPacks([]);
}

// ── Boot bootstrap & UI helpers (F9 / CG-0MUZIS4KZ003R1HP) ───

/**
 * The most recent discovery result, or `null` when packs were never loaded
 * (browser/core-only build, or discovery skipped). Read by the in-game
 * listing ({@link toCardPackListingInput}); written only by
 * {@link bootstrapMainStreetCardPacks} / {@link setMainStreetCardPackLoadResult}.
 */
let _lastLoadResult: MainStreetPackLoadResult | null = null;

/** Whether {@link bootstrapMainStreetCardPacks} has completed (success or not). */
let _bootstrapped = false;

/** Whether the process has run pack discovery once. */
export function isMainStreetCardPacksBootstrapped(): boolean {
  return _bootstrapped;
}

/** The latest pack discovery result, or `null` when none was produced. */
export function getMainStreetCardPackLoadResult(): MainStreetPackLoadResult | null {
  return _lastLoadResult;
}

/**
 * Record a discovery result as the listing source (test / replay seam).
 *
 * Marks discovery as bootstrapped so the scene boot gate does not re-run it.
 */
export function setMainStreetCardPackLoadResult(
  result: MainStreetPackLoadResult | null,
): void {
  _lastLoadResult = result;
  _bootstrapped = true;
}

/** Options for {@link bootstrapMainStreetCardPacks}. */
export interface BootstrapMainStreetCardPacksOptions {
  /**
   * Content directory override. Defaults to `window.tce.contentDir`. An
   * explicit `null` forces the base-content path even when a launcher bridge
   * exists (used by tests).
   */
  readonly contentDir?: string | null;
  /** Core-engine version for compatibility; defaults to the core constant. */
  readonly engineVersion?: string;
  /** Packs a save requested (degradation warnings only). */
  readonly requestedPacks?: readonly ActiveMainStreetPack[];
  /** Manifest transport override (tests). */
  readonly fetchManifest?: MainStreetPackLoadOptions['fetchManifest'];
  /** CSV transport override (tests). */
  readonly fetchCsv?: MainStreetPackLoadOptions['fetchCsv'];
  /** Dynamic-import transport override (tests). */
  readonly importer?: MainStreetPackLoadOptions['importer'];
  /** Entitlement client override; defaults to the `window.tce` client. */
  readonly client?: CardPackClient;
  /**
   * Unified content-unlock read client override; defaults to the
   * `window.tce.contentUnlocks` client.
   */
  readonly contentUnlocks?: ContentUnlockClient | null;
  /** Discovery loader override; defaults to the core `loadCardPacks`. */
  readonly loader?: MainStreetCardPackLoader;
  /** Warning sink; defaults to `console`. */
  readonly logger?: MainStreetCardPackLogger;
  /** Storage backend for the enabled-pack preference (tests). */
  readonly storage?: StorageLike | null;
}

/**
 * Discover, merge and apply the installed card packs *before* scene setup.
 *
 * This is the Main Street boot entry point (called from
 * `createMainStreetGame.ts` / `main.ts`, and by the scene lifecycle when the
 * launcher started the scene directly). It never throws:
 *
 *   - no content directory (browser / core-only build) → base content;
 *   - any discovery failure → {@link loadMainStreetCardPacks} already degrades
 *     to base content;
 *   - a missing/malformed manifest → base content.
 *
 * On success the merged pool is applied to the live templates so
 * `setupMainStreetGame()` deals pack cards, and the enabled-pack preference
 * seeds the active set. Returns the load result, or `null` when no content
 * directory was available.
 */
export async function bootstrapMainStreetCardPacks(
  options: BootstrapMainStreetCardPacksOptions = {},
): Promise<MainStreetPackLoadResult | null> {
  const contentDir =
    options.contentDir !== undefined
      ? options.contentDir
      : readContentDirFromWindow();

  if (!contentDir) {
    // Safe base-content fallback: no packs are reachable in this environment.
    resetMainStreetCardPacks();
    _lastLoadResult = null;
    _bootstrapped = true;
    return null;
  }

  const enabledPackIds = getEnabledCardPackIds(options.storage) ?? undefined;
  const result = await loadMainStreetCardPacks({
    contentDir,
    engineVersion: options.engineVersion,
    requestedPacks: options.requestedPacks,
    enabledPackIds,
    fetchManifest: options.fetchManifest,
    fetchCsv: options.fetchCsv,
    importer: options.importer,
    client: options.client,
    contentUnlocks: options.contentUnlocks,
    loader: options.loader,
    logger: options.logger,
  });

  applyMainStreetCardPool(result.pool);
  _lastLoadResult = result;
  _bootstrapped = true;
  return result;
}

/**
 * The enabled pack ids shown by the listing.
 *
 * The stored preference wins when present (an empty array means the player
 * disabled every pack). With no preference all entitled packs are enabled by
 * default, matching the loader.
 */
export function resolveEnabledPackIds(
  load: MainStreetPackLoadResult | null,
  storage?: StorageLike | null,
): string[] {
  const persisted = getEnabledCardPackIds(storage);
  if (persisted !== null) return persisted;
  return load ? load.loaded.map((pack) => pack.manifest.id) : [];
}

/**
 * Shape a Main Street discovery result as a core {@link CardPackLoadResult}
 * for the reusable `CardPackListing`.
 *
 * Loaded packs carry an explicit `enabled` flag derived from *enabledPackIds*
 * so the listing renders the player's toggles (the loader always marks its
 * packs enabled).
 */
export function toCardPackListingInput(
  load: MainStreetPackLoadResult | null,
  enabledPackIds: readonly string[],
): CardPackLoadResult {
  if (!load) return { packs: [], incompatible: [], locked: [], errors: [] };
  const enabled = new Set(enabledPackIds);
  return {
    packs: load.loaded.map((pack) => ({
      ...pack,
      enabled: enabled.has(pack.manifest.id),
    })),
    incompatible: load.incompatible,
    locked: load.locked,
    errors: load.errors,
  };
}

/** The outcome of {@link applyEnabledMainStreetPacks}. */
export interface ApplyEnabledMainStreetPacksResult {
  /** Whether the requested enabled set was applied. */
  readonly applied: boolean;
  /** The enabled set in effect after the call (previous set on refusal). */
  readonly enabledPackIds: string[];
  /** Human-readable refusal reason, when `applied` is false. */
  readonly reason: string | null;
}

/** Options for {@link applyEnabledMainStreetPacks}. */
export interface ApplyEnabledMainStreetPacksOptions {
  /**
   * Live game state. When supplied, a toggle that would strand a live card
   * instance (a pack card in play) is refused and the previous pool restored
   * — the "refuse only when a live card instance needs the missing template"
   * policy, honoured for the interactive toggle.
   */
  readonly state?: MainStreetState | null;
  /** Persist the new enabled set as the new-game preference. Default true. */
  readonly persist?: boolean;
  /** Storage backend for the preference (tests). */
  readonly storage?: StorageLike | null;
}

/**
 * Re-merge the base pool with *enabledPackIds* and apply it to the live
 * templates, so the game's card pool refreshes consistently when a pack is
 * enabled/disabled in the listing.
 *
 * Enabling is always safe (additive rows). Disabling a pack whose cards are
 * still live in *state* is refused: the previous pool is restored and
 * `applied: false` is returned with an actionable reason, so a save can never
 * be stranded mid-run. The enabled set is persisted as the new-game
 * preference on success.
 */
export function applyEnabledMainStreetPacks(
  load: MainStreetPackLoadResult | null,
  enabledPackIds: readonly string[],
  options: ApplyEnabledMainStreetPacksOptions = {},
): ApplyEnabledMainStreetPacksResult {
  const previousEnabled = getActiveMainStreetPacks().map((pack) => pack.id);
  const previousPool = mergeMainStreetCardPool(CARD_DATA_RAW, load?.loaded ?? [], {
    enabledPackIds: previousEnabled,
  });

  if (!load) {
    return {
      applied: false,
      enabledPackIds: previousEnabled,
      reason: 'No card packs are installed.',
    };
  }

  const nextPool = mergeMainStreetCardPool(CARD_DATA_RAW, load.loaded, {
    enabledPackIds,
  });
  applyMainStreetCardPool(nextPool);

  if (options.state) {
    const missing = findMissingLiveTemplateIds(options.state);
    if (missing.length > 0) {
      applyMainStreetCardPool(previousPool);
      return {
        applied: false,
        enabledPackIds: previousEnabled,
        reason:
          'A card from that pack is currently in play — finish or restart ' +
          'the game before disabling it.',
      };
    }
  }

  if (options.persist !== false) {
    setEnabledCardPackIds(enabledPackIds, options.storage);
  }
  return { applied: true, enabledPackIds: [...enabledPackIds], reason: null };
}

// ── Live-template resolution (degradation refusal) ──────────

/** Every card template id currently available across all card families. */
export function getAvailableTemplateIds(): string[] {
  return [
    ...getBusinessTemplates(),
    ...getCommunitySpaceTemplates(),
    ...getEventTemplates(),
    ...getUpgradeTemplates(),
    ...getStaffCardTemplates(),
  ].map((template) => template.id);
}

/**
 * Card ids referenced by a *live* card instance in `state` (placed on the
 * street, in the market, hand, decks, discards, incident deck, or a pending
 * applicant/choice). These are the instances that cannot be reconstructed
 * from a missing template.
 */
export function collectLiveCardIds(state: MainStreetState): string[] {
  const ids = new Set<string>();
  // Normalise to the base template id (copy/serial suffixes like `-0` are
  // stripped): live instances carry suffixed ids (`biz-bakery-1`) while
  // templates are keyed by the base id (`biz-bakery`), so comparing raw ids
  // would report every real card as "missing" (CG-0MUZIS4KZ003R1HP).
  const add = (card: { id?: unknown } | null | undefined): void => {
    if (card && typeof card.id === 'string' && card.id.length > 0) {
      ids.add(getBaseTypeId(card.id));
    }
  };
  const addAll = (cards: readonly unknown[] | undefined): void => {
    for (const card of cards ?? []) add(card as { id?: unknown });
  };

  addAll(state.streetGrid as readonly unknown[]);
  addAll(state.market?.cards as readonly unknown[]);
  addAll(state.hand as readonly unknown[]);
  addAll(state.discardPile as readonly unknown[]);
  addAll(state.staffCards as readonly unknown[]);
  addAll(state.decks?.business as readonly unknown[]);
  addAll(state.decks?.communitySpace as readonly unknown[]);
  addAll(state.decks?.event as readonly unknown[]);
  addAll(state.decks?.upgrade as readonly unknown[]);
  addAll(state.decks?.staff as readonly unknown[]);
  addAll(state.discards?.business as readonly unknown[]);
  addAll(state.discards?.communitySpace as readonly unknown[]);
  addAll(state.discards?.event as readonly unknown[]);
  addAll(state.discards?.upgrade as readonly unknown[]);
  addAll(state.discards?.staff as readonly unknown[]);
  addAll(state.incidentDeck as readonly unknown[]);
  add((state.revealedPeekedCard as { id?: unknown } | null) ?? undefined);
  add(state.pendingApplicant?.card as { id?: unknown } | undefined);
  add(state.pendingEventChoice?.event as { id?: unknown } | undefined);
  return [...ids];
}

/**
 * Live card ids that have no available template.
 *
 * An empty result means base + active packs cover every live instance; a
 * non-empty result means a pack that supplied those templates is
 * missing/disabled and the game must refuse to resume until it is restored.
 */
export function findMissingLiveTemplateIds(
  state: MainStreetState,
  availableTemplateIds: Iterable<string> = getAvailableTemplateIds(),
): string[] {
  const available = availableTemplateIds instanceof Set
    ? availableTemplateIds
    : new Set(availableTemplateIds);
  return collectLiveCardIds(state).filter((id) => !available.has(id));
}

/** Raised when live card instances cannot be resolved from available templates. */
export class MissingCardPackTemplateError extends Error {
  /** The template ids referenced by live instances but not available. */
  readonly missingTemplateIds: string[];

  constructor(missingTemplateIds: string[]) {
    super(
      'This saved game uses cards from a card pack that is no longer ' +
        `available: ${missingTemplateIds.join(', ')}. Reinstall or re-enable ` +
        'the pack to resume.',
    );
    this.name = 'MissingCardPackTemplateError';
    this.missingTemplateIds = missingTemplateIds;
  }
}

/**
 * Refuse only when a live card instance requires a missing template.
 *
 * @throws {MissingCardPackTemplateError} when any live instance's template is
 *   unavailable; otherwise returns normally.
 */
export function assertLiveTemplatesResolvable(
  state: MainStreetState,
  availableTemplateIds?: Iterable<string>,
): void {
  const missing = findMissingLiveTemplateIds(state, availableTemplateIds);
  if (missing.length > 0) {
    throw new MissingCardPackTemplateError(missing);
  }
}

/**
 * Namespaced facade matching the boot-wiring call site
 * (`MainStreetCardPacks.load()` in `createMainStreetGame.ts` / `main.ts`).
 */
export const MainStreetCardPacks = {
  /** Discover + merge installed packs (never throws). */
  load: loadMainStreetCardPacks,
  /** Pure `base + packs → pool` merge (the single entry point). */
  merge: mergeMainStreetCardPool,
  /** Apply a pool to the live templates and record the active set. */
  apply: applyMainStreetCardPool,
  /** Restore base content and clear the active set. */
  reset: resetMainStreetCardPacks,
  /** The pack set currently applied in this process. */
  getActive: getActiveMainStreetPacks,
  /** Live instances that a missing pack would strand. */
  findMissingLiveTemplateIds,
  /** Discover + merge + apply installed packs before scene setup. */
  bootstrap: bootstrapMainStreetCardPacks,
  /** Whether boot discovery has completed. */
  isBootstrapped: isMainStreetCardPacksBootstrapped,
  /** The latest discovery result (listing source). */
  getLoadResult: getMainStreetCardPackLoadResult,
  /** Apply a new enabled set, refusing to strand live pack cards. */
  applyEnabled: applyEnabledMainStreetPacks,
} as const;
