/**
 * Steam follow call-to-action logic (core CG-0MSMAJQQT004SDCC, F5).
 *
 * The CTA on the tutorial's final completion step opens the Steam
 * store/community page and re-checks the follow so the bonus can unlock.
 * The decision logic is deliberately DOM-free and dependency-injected here,
 * so the bridge-vs-browser branching is unit-testable without a DOM or a
 * Phaser scene. `MainStreetTutorialHints.handleSteamFollow()` owns the status
 * element and delegates the branch selection to {@link runSteamFollowCta}.
 *
 * @module
 */

/** Subset of the launcher preload bridge (`window.tce.steamFollow`). */
export interface SteamFollowBridge {
  /** Open the Steam store/community page in the client; true on success. */
  openStorePage?: () => Promise<boolean> | boolean;
  /** Automatic follow check (needs `ISteamFriends::IsFollowing`). */
  claim?: () => Promise<{ unlocked?: boolean }> | { unlocked?: boolean };
  /** Manual self-attest fallback when automatic detection is unavailable. */
  claimManually?: () => Promise<{ unlocked?: boolean }> | { unlocked?: boolean };
  /** Whether automatic detection is available in this binding. */
  supportsAutomaticFollowCheck?: () => Promise<boolean> | boolean;
}

/** Dependencies for {@link runSteamFollowCta}; every side effect is injected. */
export interface SteamFollowCtaDeps {
  /** Launcher bridge, or undefined in a plain browser. */
  bridge?: SteamFollowBridge;
  /** Opens a URL (`window.open` in production). */
  openUrl: (url: string) => void;
  /** Translation lookup (`t` from the core i18n bundle). */
  translate: (key: string) => string;
  /** Writes the CTA status line. */
  setStatus: (text: string) => void;
}

/** Public Steam store page used by the browser fallback. */
export const STEAM_STORE_URL = 'https://store.steampowered.com/';

/**
 * Open the Steam page and re-check the follow.
 *
 * Launcher mode uses the bridge and re-checks the follow — automatic
 * detection when the Steamworks binding supports it, the manual self-attest
 * claim otherwise (F3 finding), so the reward stays reachable. Browser mode
 * opens the web store page and explains no reward is granted there.
 *
 * Never throws: a missing bridge or a rejected call degrades to a status
 * message so the tutorial stays completable.
 */
export async function runSteamFollowCta(deps: SteamFollowCtaDeps): Promise<void> {
  const { bridge, openUrl, translate, setStatus } = deps;

  try {
    if (!bridge) {
      // Plain browser: open the public store page, no reward available.
      try {
        openUrl(STEAM_STORE_URL);
      } catch {
        /* ignore — a blocked popup must not break the tutorial */
      }
      setStatus(translate('tutorial.steamFollow.openedBrowser'));
      return;
    }

    const opened = await bridge.openStorePage?.();
    if (!opened) {
      setStatus(translate('tutorial.steamFollow.unavailable'));
      return;
    }
    setStatus(translate('tutorial.steamFollow.opened'));

    const supportsAuto = (await bridge.supportsAutomaticFollowCheck?.()) ?? false;
    const result = supportsAuto
      ? await bridge.claim?.()
      : await bridge.claimManually?.();
    if (result?.unlocked) setStatus(translate('tutorial.steamFollow.unlocked'));
  } catch {
    setStatus(translate('tutorial.steamFollow.unavailable'));
  }
}
