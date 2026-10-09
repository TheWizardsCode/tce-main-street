/**
 * Main Street: Preferences store
 *
 * Persistent player preferences for Main Street, mirroring the
 * `SettingsStore` (src/ui/SettingsStore.ts) localStorage patterns. Uses an
 * injectable storage adapter so unit tests run in Node without a browser
 * localStorage.
 *
 * Preference keys:
 *   - `tce-main-street-buy-and-place-premium-dialog-dismissed` — when
 *     'true', the same-turn buy-and-play premium explainer dialog no longer
 *     fires (CG-0MT24X0SX007RLHN).
 *   - `tce-main-street-enabled-card-packs` — the JSON array of card-pack ids
 *     the player has enabled, seeding new games (child of CG-0MUZFD1WR0031QTB).
 *     Absent means "no preference yet" and all entitled packs are enabled.
 *
 * @module
 */

/** Minimal subset of the Storage API needed by the preferences store. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Storage key for the buy-and-play premium dialog dismissal preference. */
export const PREMIUM_DIALOG_DISMISSED_KEY = 'tce-main-street-buy-and-place-premium-dialog-dismissed';

/** Storage key for the enabled card-pack id list (seeds new games). */
export const ENABLED_CARD_PACKS_KEY = 'tce-main-street-enabled-card-packs';

/** Resolves the storage backend (browser localStorage when available). */
function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof globalThis !== 'undefined' && (globalThis as any).localStorage
      ? (globalThis as any).localStorage
      : null;
  } catch {
    return null;
  }
}

/**
 * Returns true when the player has permanently dismissed the buy-and-play
 * premium explainer dialog ("Don't show this again").
 *
 * @param storage Optional storage backend. When omitted, falls back to the
 *   browser localStorage (safe no-op in headless/Node contexts).
 */
export function isBuyAndPlacePremiumDialogDismissed(storage?: StorageLike | null): boolean {
  const backend = resolveStorage(storage);
  if (!backend) return false;
  try {
    return backend.getItem(PREMIUM_DIALOG_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Persists (or clears) the buy-and-play premium dialog dismissal preference.
 *
 * @param dismissed When true, the dialog will not fire on future premium
 *   buy-and-play. When false, the preference is cleared.
 * @param storage   Optional storage backend (defaults to browser localStorage).
 */
export function setBuyAndPlacePremiumDialogDismissed(
  dismissed: boolean,
  storage?: StorageLike | null,
): void {
  const backend = resolveStorage(storage);
  if (!backend) return;
  try {
    if (dismissed) {
      backend.setItem(PREMIUM_DIALOG_DISMISSED_KEY, 'true');
    } else if (backend.removeItem) {
      backend.removeItem(PREMIUM_DIALOG_DISMISSED_KEY);
    } else {
      backend.setItem(PREMIUM_DIALOG_DISMISSED_KEY, 'false');
    }
  } catch {
    // ignore storage failures — the preference is best-effort persistence
  }
}

/**
 * Returns the player's enabled card-pack id preference, or `null` when no
 * preference has been stored yet.
 *
 * `null` (no preference) and `[]` (all packs deliberately disabled) are
 * distinct: the boot path enables every entitled pack when the preference is
 * `null`, and none when it is `[]`. Malformed stored values are treated as
 * "no preference" so a corrupt entry never crashes the boot.
 *
 * @param storage Optional storage backend (defaults to browser localStorage).
 */
export function getEnabledCardPackIds(storage?: StorageLike | null): string[] | null {
  const backend = resolveStorage(storage);
  if (!backend) return null;
  try {
    const raw = backend.getItem(ENABLED_CARD_PACKS_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );
  } catch {
    return null;
  }
}

/**
 * Persists the enabled card-pack id set (de-duplicated, order preserved).
 *
 * @param ids     The enabled pack ids.
 * @param storage Optional storage backend (defaults to browser localStorage).
 */
export function setEnabledCardPackIds(
  ids: readonly string[],
  storage?: StorageLike | null,
): void {
  const backend = resolveStorage(storage);
  if (!backend) return;
  try {
    const normalised = [...new Set(ids)].filter(
      (id) => typeof id === 'string' && id.length > 0,
    );
    backend.setItem(ENABLED_CARD_PACKS_KEY, JSON.stringify(normalised));
  } catch {
    // ignore storage failures — the preference is best-effort persistence
  }
}
