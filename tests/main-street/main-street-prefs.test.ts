/**
 * Main Street: Preferences store tests
 *
 * Verifies the persisted \"Don't show this again\" preference backing the
 * buy-and-play premium explainer dialog (CG-0MT24X0SX007RLHN).
 *
 * @module
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isBuyAndPlacePremiumDialogDismissed,
  setBuyAndPlacePremiumDialogDismissed,
  PREMIUM_DIALOG_DISMISSED_KEY,
  isAutoAdvanceTurnEnabled,
  setAutoAdvanceTurnEnabled,
  AUTO_ADVANCE_TURN_KEY,
} from '../../src/MainStreetPrefs';
import type { StorageLike } from '../../src/MainStreetPrefs';

function createMockStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: vi.fn((k: string) => (map.has(k) ? map.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => map.set(k, v)),
    removeItem: vi.fn((k: string) => map.delete(k)),
  };
}

/**
 * Creates an adapter over an explicit backing map, so several "sessions" can
 * share the same persisted state without sharing the adapter instance.
 */
function createMapStorage(map: Map<string, string>): StorageLike {
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

describe('MainStreetPrefs premium dialog dismissal', () => {
  it('returns false when storage is null (never dismissed)', () => {
    expect(isBuyAndPlacePremiumDialogDismissed(null)).toBe(false);
  });

  it('returns false when storage has no entry', () => {
    const storage = createMockStorage();
    expect(isBuyAndPlacePremiumDialogDismissed(storage)).toBe(false);
  });

  it('persists and restores the dismissal preference', () => {
    const storage = createMockStorage();
    expect(isBuyAndPlacePremiumDialogDismissed(storage)).toBe(false);

    setBuyAndPlacePremiumDialogDismissed(true, storage);
    expect(storage.setItem).toHaveBeenCalledWith(PREMIUM_DIALOG_DISMISSED_KEY, 'true');
    expect(isBuyAndPlacePremiumDialogDismissed(storage)).toBe(true);
  });

  it('clears the preference when un-dismissed', () => {
    const storage = createMockStorage();
    setBuyAndPlacePremiumDialogDismissed(true, storage);
    expect(isBuyAndPlacePremiumDialogDismissed(storage)).toBe(true);

    setBuyAndPlacePremiumDialogDismissed(false, storage);
    expect(storage.removeItem).toHaveBeenCalledWith(PREMIUM_DIALOG_DISMISSED_KEY);
    expect(isBuyAndPlacePremiumDialogDismissed(storage)).toBe(false);
  });

  it('handles storage fallback without removeItem (getItem/setItem only)', () => {
    const map = new Map<string, string>();
    const minimal: StorageLike = {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => map.set(k, v),
    };
    setBuyAndPlacePremiumDialogDismissed(false, minimal);
    // without removeItem, the preference is written as 'false'
    expect(minimal.getItem(PREMIUM_DIALOG_DISMISSED_KEY)).toBe('false');
    expect(isBuyAndPlacePremiumDialogDismissed(minimal)).toBe(false);
  });

  it('is best-effort under storage exceptions (no throw)', () => {
    const throwing: StorageLike = {
      getItem: vi.fn(() => { throw new Error('boom'); }),
      setItem: vi.fn(() => { throw new Error('boom'); }),
      removeItem: vi.fn(() => { throw new Error('boom'); }),
    };
    expect(isBuyAndPlacePremiumDialogDismissed(throwing)).toBe(false);
    expect(() => setBuyAndPlacePremiumDialogDismissed(true, throwing)).not.toThrow();
  });
});

describe('MainStreetPrefs auto-advance turn preference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is disabled by default when nothing has been stored', () => {
    const storage = createMockStorage();
    expect(isAutoAdvanceTurnEnabled(storage)).toBe(false);
  });

  it('is disabled when no storage backend is available', () => {
    expect(isAutoAdvanceTurnEnabled(null)).toBe(false);
  });

  it('persists an enabled preference and reads it back', () => {
    const storage = createMockStorage();

    setAutoAdvanceTurnEnabled(true, storage);

    expect(storage.setItem).toHaveBeenCalledWith(AUTO_ADVANCE_TURN_KEY, 'true');
    expect(isAutoAdvanceTurnEnabled(storage)).toBe(true);
  });

  it('persists an explicit disabled preference', () => {
    const storage = createMockStorage();
    setAutoAdvanceTurnEnabled(true, storage);
    expect(isAutoAdvanceTurnEnabled(storage)).toBe(true);

    setAutoAdvanceTurnEnabled(false, storage);

    expect(storage.setItem).toHaveBeenLastCalledWith(AUTO_ADVANCE_TURN_KEY, 'false');
    expect(isAutoAdvanceTurnEnabled(storage)).toBe(false);
  });

  it('treats an unrecognised stored value as disabled', () => {
    const map = new Map<string, string>([[AUTO_ADVANCE_TURN_KEY, 'yes']]);
    expect(isAutoAdvanceTurnEnabled(createMapStorage(map))).toBe(false);
  });

  it('uses the injected storage adapter rather than the global localStorage', () => {
    const localStorageGet = vi.fn(() => 'true');
    const localStorageSet = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: localStorageGet,
      setItem: localStorageSet,
      removeItem: vi.fn(),
    });

    const storage = createMockStorage();
    expect(isAutoAdvanceTurnEnabled(storage)).toBe(false);
    setAutoAdvanceTurnEnabled(true, storage);

    expect(storage.getItem).toHaveBeenCalledWith(AUTO_ADVANCE_TURN_KEY);
    expect(storage.setItem).toHaveBeenCalledWith(AUTO_ADVANCE_TURN_KEY, 'true');
    expect(localStorageGet).not.toHaveBeenCalled();
    expect(localStorageSet).not.toHaveBeenCalled();
  });

  it('survives a fresh adapter instance over the same storage (re-read)', () => {
    const persisted = new Map<string, string>();
    const firstSession = createMapStorage(persisted);
    setAutoAdvanceTurnEnabled(true, firstSession);

    const secondSession = createMapStorage(persisted);
    expect(isAutoAdvanceTurnEnabled(secondSession)).toBe(true);
  });
});