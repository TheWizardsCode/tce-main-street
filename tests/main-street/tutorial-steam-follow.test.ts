/**
 * Steam follow CTA in the tutorial completion step (core CG-0MSMAJQQT004SDCC, F5).
 *
 * Pins the Main Street side of the follow-to-unlock feature:
 *  - the final step opts in to the CTA (`showSteamFollowCta`), and only it
 *  - the CTA copy exists in the English bundle
 *  - the CTA is additive — the step remains a plain `confirm` step, so the
 *    existing "Let's play!" action still finishes the tutorial
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { UNIFIED_TUTORIAL_STEPS, UNIFIED_TUTORIAL_STEP_COUNT } from '../../src/TutorialFlow';
import { resetI18n, registerLocale, setLocale, t } from '@core-engine/I18n';
import { TUTORIAL_EN_BUNDLE } from '../../src/i18n/tutorial-en';
import { runSteamFollowCta, STEAM_STORE_URL } from '../../src/SteamFollowCta';
import type { SteamFollowBridge } from '../../src/SteamFollowCta';

beforeAll(() => {
  resetI18n();
  registerLocale('en', TUTORIAL_EN_BUNDLE);
  setLocale('en');
  steamFollowStatus = {
    openedBrowser: t('tutorial.steamFollow.openedBrowser'),
    opened: t('tutorial.steamFollow.opened'),
    unavailable: t('tutorial.steamFollow.unavailable'),
    unlocked: t('tutorial.steamFollow.unlocked'),
  };
});

describe('Steam follow CTA step wiring', () => {
  it('sets showSteamFollowCta on the final completion step only', () => {
    const flagged = UNIFIED_TUTORIAL_STEPS.filter((s) => s.showSteamFollowCta);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].id).toBe('T26');
    expect(UNIFIED_TUTORIAL_STEPS[UNIFIED_TUTORIAL_STEP_COUNT - 1].id).toBe('T26');
  });

  it('keeps the final step a plain confirm step (CTA never blocks finishing)', () => {
    const last = UNIFIED_TUTORIAL_STEPS[UNIFIED_TUTORIAL_STEP_COUNT - 1];
    expect(last.gate).toBe('confirm');
    expect(last.highlightZone).toBe('completionModal');
  });

  it('does not add a step for the CTA (it is a flag on the final completion step)', () => {
    const last = UNIFIED_TUTORIAL_STEPS[UNIFIED_TUTORIAL_STEP_COUNT - 1];
    expect(last.showSteamFollowCta).toBe(true);
    expect(UNIFIED_TUTORIAL_STEPS.filter((s) => s.showSteamFollowCta)).toHaveLength(1);
  });
});

describe('Steam follow CTA copy', () => {
  it('bundles every CTA string', () => {
    for (const key of [
      'tutorial.steamFollow.cta',
      'tutorial.steamFollow.opened',
      'tutorial.steamFollow.openedBrowser',
      'tutorial.steamFollow.unavailable',
      'tutorial.steamFollow.unlocked',
    ]) {
      expect(TUTORIAL_EN_BUNDLE[key], `${key} must be bundled`).toBeTruthy();
    }
  });

  it('resolves the CTA button label', () => {
    expect(t('tutorial.steamFollow.cta')).toBe('Follow us on Steam');
  });

  it('explains the browser fallback grants no reward', () => {
    expect(t('tutorial.steamFollow.openedBrowser').toLowerCase()).toMatch(/launcher/);
  });
});

/** Resolves the exact status copy the CTA shows for each outcome (set in `beforeAll`). */
let steamFollowStatus: {
  openedBrowser: string;
  opened: string;
  unavailable: string;
  unlocked: string;
};

describe('Steam follow CTA bridge vs browser branching', () => {
  const bridge = (overrides: Partial<SteamFollowBridge>): SteamFollowBridge => ({ ...overrides });

  const harness = (deps: { bridge?: SteamFollowBridge; openUrl?: (url: string) => void } = {}) => {
    const openedUrls: string[] = [];
    const statuses: string[] = [];
    const openUrl = deps.openUrl ?? ((url: string) => openedUrls.push(url));
    const run = () =>
      runSteamFollowCta({
        bridge: deps.bridge,
        openUrl,
        translate: t,
        setStatus: (text) => statuses.push(text),
      });
    return { run, openedUrls, statuses };
  };

  it('browser mode (no bridge) opens the web store and explains no reward is granted', async () => {
    const { run, openedUrls, statuses } = harness();
    await run();
    expect(openedUrls).toEqual([STEAM_STORE_URL]);
    expect(statuses).toEqual([steamFollowStatus.openedBrowser]);
  });

  it('browser mode still degrades gracefully when the popup is blocked', async () => {
    const { run, openedUrls, statuses } = harness({ openUrl: () => { throw new Error('popup blocked'); } });
    await run();
    expect(openedUrls).toEqual([]);
    expect(statuses).toEqual([steamFollowStatus.openedBrowser]);
  });

  it('launcher mode opens via the bridge and does not open a window itself', async () => {
    const { run, openedUrls, statuses } = harness({
      bridge: bridge({ openStorePage: async () => true }),
    });
    await run();
    expect(openedUrls).toEqual([]);
    expect(statuses).toEqual([steamFollowStatus.opened]);
  });

  it('re-checks the follow automatically when the binding supports it', async () => {
    const claim = vi.fn(async () => ({ unlocked: false }));
    const claimManually = vi.fn(async () => ({ unlocked: true }));
    const { run, statuses } = harness({
      bridge: bridge({
        openStorePage: async () => true,
        supportsAutomaticFollowCheck: async () => true,
        claim,
        claimManually,
      }),
    });
    await run();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claimManually).not.toHaveBeenCalled();
    expect(statuses).toEqual([steamFollowStatus.opened]); // not unlocked yet
  });

  it('falls back to the manual self-attest claim when automatic detection is unavailable', async () => {
    const claim = vi.fn();
    const claimManually = vi.fn(async () => ({ unlocked: true }));
    const { run, statuses } = harness({
      bridge: bridge({
        openStorePage: async () => true,
        supportsAutomaticFollowCheck: async () => false,
        claim,
        claimManually,
      }),
    });
    await run();
    expect(claim).not.toHaveBeenCalled();
    expect(claimManually).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([steamFollowStatus.opened, steamFollowStatus.unlocked]);
  });

  it('falls back to the manual claim when the binding omits automatic detection', async () => {
    const claim = vi.fn();
    const claimManually = vi.fn(async () => ({ unlocked: true }));
    const { run } = harness({
      bridge: bridge({ openStorePage: async () => true, claim, claimManually }),
    });
    await run();
    expect(claim).not.toHaveBeenCalled();
    expect(claimManually).toHaveBeenCalledTimes(1);
  });

  it('surfaces the unlocked copy when the follow is confirmed', async () => {
    const { run, statuses } = harness({
      bridge: bridge({
        openStorePage: async () => true,
        supportsAutomaticFollowCheck: async () => true,
        claim: async () => ({ unlocked: true }),
      }),
    });
    await run();
    expect(statuses).toEqual([steamFollowStatus.opened, steamFollowStatus.unlocked]);
  });

  it('a refused open degrades to the unavailable copy', async () => {
    const { run, openedUrls, statuses } = harness({
      bridge: bridge({ openStorePage: async () => false }),
    });
    await run();
    expect(openedUrls).toEqual([]);
    expect(statuses).toEqual([steamFollowStatus.unavailable]);
  });

  it('a missing openStorePage method degrades to the unavailable copy', async () => {
    const { run, statuses } = harness({ bridge: bridge({}) });
    await run();
    expect(statuses).toEqual([steamFollowStatus.unavailable]);
  });

  it('a rejected open call degrades to unavailable (never throws)', async () => {
    const { run, statuses } = harness({
      bridge: bridge({ openStorePage: async () => { throw new Error('bridge failure'); } }),
    });
    await expect(run()).resolves.toBeUndefined();
    expect(statuses).toEqual([steamFollowStatus.unavailable]);
  });

  it('a rejected follow re-check degrades to unavailable (never throws)', async () => {
    const { run, statuses } = harness({
      bridge: bridge({
        openStorePage: async () => true,
        supportsAutomaticFollowCheck: async () => true,
        claim: async () => { throw new Error('claim failure'); },
      }),
    });
    await expect(run()).resolves.toBeUndefined();
    expect(statuses).toEqual([steamFollowStatus.opened, steamFollowStatus.unavailable]);
  });

  it('a rejected automatic-detection probe degrades to unavailable (never throws)', async () => {
    const { run, statuses } = harness({
      bridge: bridge({
        openStorePage: async () => true,
        supportsAutomaticFollowCheck: async () => { throw new Error('probe failure'); },
      }),
    });
    await expect(run()).resolves.toBeUndefined();
    expect(statuses).toEqual([steamFollowStatus.opened, steamFollowStatus.unavailable]);
  });
});
