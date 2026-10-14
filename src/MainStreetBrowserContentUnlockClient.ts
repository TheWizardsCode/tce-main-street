/**
 * Main Street: browser `localStorage`-backed content-unlock client.
 *
 * The Electron launcher exposes a unified content-unlock store through the
 * `window.tce.contentUnlocks` context bridge
 * (`core/src/ui/content-unlock-client.ts`). A **plain browser** has no such
 * bridge, so without a replacement the residential pack can never be unlocked
 * and its listing row stays permanently locked. This module supplies that
 * replacement: a total {@link ContentUnlockClient} backed by the same
 * `localStorage` seam Main Street already uses for preferences
 * ({@link StorageLike} in `src/MainStreetPrefs.ts`), so the full
 * lock → purchase → enable flow works in the browser distribution and an
 * unlock survives a page reload.
 *
 * ## Precedence
 *
 * {@link resolveMainStreetContentUnlockClient} is the single resolution point:
 * when the Electron `window.tce.contentUnlocks` bridge is present it keeps
 * **precedence** (the authoritative launcher store wins); otherwise the
 * `localStorage` client is used. The two stores never disagree because only one
 * is ever consulted, and the choice is explicit and tested.
 *
 * ## Totality
 *
 * Every method is total, matching `createContentUnlockClient`'s degradation
 * contract: a missing, throwing or malformed storage backend reports "not
 * unlocked" / `[]` and never throws, so a browser build always boots. A
 * `refresh` that cannot persist (no storage, or a throwing `setItem`) returns
 * `[]` rather than claiming an unlock that did not happen.
 *
 * ## Persisted shape
 *
 * Unlock state is stored as a JSON array of {@link ContentUnlockRecordLike}
 * under {@link BROWSER_CONTENT_UNLOCKS_KEY}. Each record carries its canonical
 * target key (`game:<id>` / `dlc:<gameId>:<dlcId>`), the structural target and
 * an ISO timestamp, so {@link ContentUnlockClient.getUnlocks} can return the
 * same shape the Electron bridge returns.
 *
 * ## Scoped simulated purchase
 *
 * The browser has no reward engine, so `refresh` only supports the
 * **rule-scoped simulated purchase** the Card Packs panel performs. It unlocks
 * a target only when `simulatePurchase: true` **and** the rule id is named in
 * `ruleIds`; a global `refresh({ attested: true })` never unlocks anything, and
 * no rule outside the requested scope is evaluated — so a browser purchase can
 * never collateral-unlock another configured reward. The rule → target mapping
 * is data ({@link MAIN_STREET_BROWSER_CONTENT_UNLOCK_RULES}) derived from the
 * gated-pack declarations, not a hard-coded branch.
 *
 * @see src/MainStreetContentUnlockGate.ts — gated-pack declarations.
 * @see src/MainStreetCardPacks.ts — boots through
 *   {@link resolveMainStreetContentUnlockClient}.
 * @see @ui/content-unlock-client — the core client interface and total contract.
 * @module
 */

import {
  contentUnlockClientFromWindow,
  isUnlockTarget,
  type ContentUnlockClient,
  type ContentUnlockRecordLike,
  type ContentUnlockRefreshOptions,
  type ContentUnlockRefreshResult,
  type UnlockTargetLike,
} from '@ui/content-unlock-client';
import { MAIN_STREET_CONTENT_UNLOCK_GATED_PACKS } from './MainStreetContentUnlockGate';
import { resolveStorage, type StorageLike } from './MainStreetPrefs';

/**
 * `localStorage` key holding the browser's persisted content unlocks.
 *
 * Distinct from `tce-main-street-enabled-card-packs` (the enabled-pack
 * preference) so the two preferences never overwrite each other.
 */
export const BROWSER_CONTENT_UNLOCKS_KEY = 'tce-main-street-content-unlocks';

/**
 * One rule-scoped simulated-purchase mapping: the reward rule id used by the
 * purchase affordance and the content target that rule unlocks.
 */
export interface BrowserContentUnlockRule {
  /** Reward rule id (e.g. `main-street-residential-pack-purchase`). */
  readonly ruleId: string;
  /** Content target the rule unlocks. */
  readonly target: UnlockTargetLike;
}

/**
 * The browser simulated-purchase rules Main Street supports.
 *
 * Derived from the gated-pack declarations so the rule/target pair cannot drift
 * from the entitlement gate: every declared pack with a `purchaseRuleId` gets a
 * rule unlocking its `dlc:<gameId>:<dlcId>` target. Data, not logic — adding a
 * purchasable pack does not change this module.
 */
export const MAIN_STREET_BROWSER_CONTENT_UNLOCK_RULES: readonly BrowserContentUnlockRule[] =
  MAIN_STREET_CONTENT_UNLOCK_GATED_PACKS.flatMap((declaration) => {
    const ruleId = declaration.purchaseRuleId;
    if (typeof ruleId !== 'string' || ruleId.length === 0) return [];
    return [
      {
        ruleId,
        target: {
          kind: 'dlc' as const,
          gameId: declaration.gameId,
          dlcId: declaration.dlcId ?? declaration.packId,
        },
      },
    ];
  });

/**
 * The canonical target key for a unified content target.
 *
 * Mirrors the key format the Electron unlock store persists
 * (`game:<id>` / `dlc:<gameId>:<dlcId>`).
 */
export function contentUnlockTargetKey(target: UnlockTargetLike): string {
  return target.kind === 'game'
    ? `game:${target.gameId}`
    : `dlc:${target.gameId}:${target.dlcId}`;
}

/** Whether *value* is a structurally valid persisted unlock record. */
function isContentUnlockRecord(value: unknown): value is ContentUnlockRecordLike {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.key === 'string' &&
    candidate.key.length > 0 &&
    typeof candidate.unlockedAt === 'string' &&
    isUnlockTarget(candidate.target)
  );
}

/**
 * Read the persisted records, or `null` when the store is unreadable/malformed.
 *
 * `null` (unreadable) is distinct from `[]` (readable but empty) so a `refresh`
 * never claims an unlock it could not verify. Invalid individual entries are
 * dropped rather than poisoning the whole store.
 */
function readRecords(storage: StorageLike): ContentUnlockRecordLike[] | null {
  try {
    const raw = storage.getItem(BROWSER_CONTENT_UNLOCKS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(isContentUnlockRecord);
  } catch {
    return null;
  }
}

/** Persist *records*, returning whether the write succeeded (never throws). */
function writeRecords(
  storage: StorageLike,
  records: readonly ContentUnlockRecordLike[],
): boolean {
  try {
    storage.setItem(BROWSER_CONTENT_UNLOCKS_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

/** Options for {@link createBrowserContentUnlockClient}. */
export interface BrowserContentUnlockClientOptions {
  /**
   * Storage backend; defaults to the browser `localStorage`. An explicit
   * `null` yields a total no-op client (used by tests and bridge precedence).
   */
  readonly storage?: StorageLike | null;
  /**
   * Simulated-purchase rule table override (tests); defaults to
   * {@link MAIN_STREET_BROWSER_CONTENT_UNLOCK_RULES}.
   */
  readonly rules?: readonly BrowserContentUnlockRule[];
  /** Clock override for deterministic `unlockedAt` timestamps (tests). */
  readonly now?: () => Date;
}

/**
 * Create a total `localStorage`-backed {@link ContentUnlockClient}.
 *
 * `isUnlocked`/`getUnlocks` read only what was persisted by this client, and
 * `refresh` performs the explicit rule-scoped simulated purchase. Never throws.
 */
export function createBrowserContentUnlockClient(
  options: BrowserContentUnlockClientOptions = {},
): ContentUnlockClient {
  const storage = resolveStorage(options.storage);
  const rules = options.rules ?? MAIN_STREET_BROWSER_CONTENT_UNLOCK_RULES;
  const now = options.now;

  return {
    async isUnlocked(target: UnlockTargetLike): Promise<boolean> {
      if (!storage || !isUnlockTarget(target)) return false;
      const records = readRecords(storage);
      if (!records) return false;
      const key = contentUnlockTargetKey(target);
      return records.some((record) => record.key === key);
    },

    async getUnlocks(): Promise<ContentUnlockRecordLike[]> {
      if (!storage) return [];
      return readRecords(storage) ?? [];
    },

    async refresh(
      refreshOptions?: ContentUnlockRefreshOptions,
    ): Promise<ContentUnlockRefreshResult[]> {
      if (!storage || typeof refreshOptions !== 'object' || refreshOptions === null) {
        return [];
      }
      // The browser client only performs an explicit simulated purchase; a
      // plain or self-attested refresh never unlocks.
      if (refreshOptions.simulatePurchase !== true) return [];

      const requestedRuleIds = new Set(
        Array.isArray(refreshOptions.ruleIds)
          ? refreshOptions.ruleIds.filter(
              (id): id is string => typeof id === 'string' && id.length > 0,
            )
          : [],
      );
      if (requestedRuleIds.size === 0) return [];

      const requestedRules = rules.filter((rule) =>
        requestedRuleIds.has(rule.ruleId),
      );
      if (requestedRules.length === 0) return [];

      const records = readRecords(storage);
      if (!records) return [];
      const byKey = new Map(records.map((record) => [record.key, record]));
      const unlockedAt = (now ? now() : new Date()).toISOString();
      const results: ContentUnlockRefreshResult[] = [];
      let changed = false;
      for (const rule of requestedRules) {
        const key = contentUnlockTargetKey(rule.target);
        if (byKey.has(key)) {
          results.push({ ruleId: rule.ruleId, key, outcome: 'already-unlocked' });
          continue;
        }
        byKey.set(key, { key, target: rule.target, unlockedAt });
        results.push({ ruleId: rule.ruleId, key, outcome: 'unlocked' });
        changed = true;
      }
      // A purchase that cannot be persisted is reported as "nothing happened".
      if (changed && !writeRecords(storage, [...byKey.values()])) return [];
      return results;
    },
  };
}

/** The subset of `window.tce` the precedence check reads. */
interface TceContentUnlockWindow {
  tce?: { contentUnlocks?: unknown };
}

/**
 * Whether the Electron `window.tce.contentUnlocks` bridge is available.
 *
 * The bridge wins precedence when present, so the check requires the two read
 * methods the Electron store always exposes.
 */
export function hasWindowContentUnlockBridge(): boolean {
  if (typeof window === 'undefined') return false;
  const bridge = (window as unknown as TceContentUnlockWindow).tce?.contentUnlocks;
  if (typeof bridge !== 'object' || bridge === null) return false;
  const candidate = bridge as { isUnlocked?: unknown; getUnlocks?: unknown };
  return (
    typeof candidate.isUnlocked === 'function' &&
    typeof candidate.getUnlocks === 'function'
  );
}

/**
 * Resolve the content-unlock client for the current runtime.
 *
 * Precedence is explicit: the Electron `window.tce.contentUnlocks` bridge is
 * used when present (it is the authoritative launcher store); otherwise the
 * browser `localStorage` client is returned. Never `null` — a bridge-less
 * browser still gets a client that degrades to "not unlocked".
 */
export function resolveMainStreetContentUnlockClient(
  options: BrowserContentUnlockClientOptions = {},
): ContentUnlockClient {
  if (hasWindowContentUnlockBridge()) return contentUnlockClientFromWindow();
  return createBrowserContentUnlockClient(options);
}
