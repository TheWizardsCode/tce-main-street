/**
 * Steam follow CTA in the tutorial completion step (core CG-0MSMAJQQT004SDCC, F5).
 *
 * Pins the Main Street side of the follow-to-unlock feature:
 *  - the final step opts in to the CTA (`showSteamFollowCta`), and only it
 *  - the CTA copy exists in the English bundle
 *  - the CTA is additive — the step remains a plain `confirm` step, so the
 *    existing "Let's play!" action still finishes the tutorial
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { UNIFIED_TUTORIAL_STEPS, UNIFIED_TUTORIAL_STEP_COUNT } from '../../src/TutorialFlow';
import { resetI18n, registerLocale, setLocale, t } from '@core-engine/I18n';
import { TUTORIAL_EN_BUNDLE } from '../../src/i18n/tutorial-en';

beforeAll(() => {
  resetI18n();
  registerLocale('en', TUTORIAL_EN_BUNDLE);
  setLocale('en');
});

describe('Steam follow CTA step wiring', () => {
  it('sets showSteamFollowCta on the final completion step only', () => {
    const flagged = UNIFIED_TUTORIAL_STEPS.filter((s) => s.showSteamFollowCta);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].id).toBe('T25');
    expect(UNIFIED_TUTORIAL_STEPS[UNIFIED_TUTORIAL_STEP_COUNT - 1].id).toBe('T25');
  });

  it('keeps the final step a plain confirm step (CTA never blocks finishing)', () => {
    const last = UNIFIED_TUTORIAL_STEPS[UNIFIED_TUTORIAL_STEP_COUNT - 1];
    expect(last.gate).toBe('confirm');
    expect(last.highlightZone).toBe('completionModal');
  });

  it('does not add a step for the CTA', () => {
    expect(UNIFIED_TUTORIAL_STEPS.some((s) => s.id === 'T26')).toBe(false);
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
