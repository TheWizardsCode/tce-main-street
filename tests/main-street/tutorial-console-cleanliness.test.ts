/**
 * Tutorial console-cleanliness regression (MS-0MV26MOWT004ZCQC).
 *
 * Booting/playing the tutorial used to flood the browser console with two
 * families of benign developer warnings that obscured genuine errors:
 *
 *  - `[tfAdapter] Missing tf factory for key "…"` for the four SFX mappings
 *    that intentionally fall back to WAV — the committed runtime synth ships
 *    12 of the 16 mapped factories (engine contract CG-0MUU9PSWC009CW76).
 *  - `Zone collision for "<hand|endTurnButton|incidentQueue>" while composing
 *    "main-street-canonical" with "main-street-tutorial"` for the zones the
 *    tutorial layout deliberately overrides under `sceneWins`.
 *
 * These tests pin both paths as quiet while asserting the underlying
 * behaviour still happens (WAV fallback, tutorial zone rects) and that
 * unexpected diagnostics are still surfaced rather than swallowed.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SoundManager, type SoundPlayer } from '@core-engine/SoundManager';
import { createTfPlayer } from '@core-engine/tfAdapter';
import {
  composeResolvedLayouts,
  type ComposeResolvedLayoutsIssue,
} from '@ui/screen-layout-compose';
import { getZoneRect, type LayoutViewport } from '@ui/screen-layout';
import type { ScreenLayoutDocument } from '@ui/screen-layout-schema';

import { loadMainStreetTfIntegration } from '../../src/debug/MainStreetDebugTools';
import { loadMainStreetTfModule } from '../../src/tf/mainStreetTfModule';
import baseLayout from '../../src/layouts/main-street.layout.json';
import tutorialLayout from '../../src/layouts/main-street-tutorial.layout.json';
import {
  MAIN_STREET_TF_FACTORYLESS_KEYS,
  MAIN_STREET_TF_SFX_MAPPING,
} from '../../src/sfx-tf-mapping';
import { createMainStreetTfLogger } from '../../src/tf/tfLogger';
import { composeTutorialLayout } from '../../src/scenes/tutorialLayoutCompose';
import {
  reportTutorialLayoutIssue,
  TUTORIAL_INTENTIONAL_OVERRIDE_ZONES,
} from '../../src/scenes/tutorialLayoutIssues';

const VIEWPORT: LayoutViewport = { width: 1280, height: 720 };

/** Zone names the tutorial overrides — the ones that used to warn on resolve. */
const OVERRIDE_ZONES = ['hand', 'endTurnButton', 'incidentQueue'] as const;

/** Recorder WAV player so the fallback path is observable. */
function createRecordingWavPlayer(): { player: SoundPlayer; played: string[] } {
  const played: string[] = [];
  return {
    played,
    player: {
      play: (key: string) => {
        played.push(key);
      },
      stop: () => {},
      setVolume: () => {},
      setMute: () => {},
    },
  };
}

function consoleWarnMessages(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tutorial zone composition is console-clean', () => {
  it('resolves the intentional override zones without a Zone collision warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // The exact composition `MainStreetTutorialHints` uses at boot:
    // `sceneWins` + the quiet tutorial reporter.
    const resolved = composeTutorialLayout(VIEWPORT, 1);

    for (const zone of OVERRIDE_ZONES) {
      const rect = resolved.zones[zone]?.rect;
      expect(rect).toBeDefined();

      // sceneWins still applies the tutorial rect, not the base rect.
      const tutorialRect = getZoneRect(
        tutorialLayout as ScreenLayoutDocument,
        zone,
        VIEWPORT,
        1,
      );
      expect(rect!.x).toBeCloseTo(tutorialRect.x, 5);
      expect(rect!.y).toBeCloseTo(tutorialRect.y, 5);
      expect(rect!.width).toBeCloseTo(tutorialRect.width ?? 0, 5);
      expect(rect!.height).toBeCloseTo(tutorialRect.height ?? 0, 5);
    }

    const messages = consoleWarnMessages(warnSpy);
    expect(messages.filter((message) => message.includes('Zone collision'))).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still reports the collisions internally (they are quiet, not removed)', () => {
    const issues: ComposeResolvedLayoutsIssue[] = [];
    const resolved = composeResolvedLayouts(
      baseLayout as ScreenLayoutDocument,
      tutorialLayout as ScreenLayoutDocument,
      VIEWPORT,
      1,
      { policy: 'sceneWins', reportIssue: (issue) => issues.push(issue) },
    );

    const collisions = issues
      .filter((issue) => issue.code === 'ZONE_COLLISION')
      .map((issue) => issue.zoneName)
      .sort();
    expect(collisions).toEqual([...OVERRIDE_ZONES].sort());

    // The tutorial override wins for each collision.
    for (const zone of OVERRIDE_ZONES) {
      const tutorialRect = getZoneRect(
        tutorialLayout as ScreenLayoutDocument,
        zone,
        VIEWPORT,
        1,
      );
      const baseRect = getZoneRect(
        baseLayout as ScreenLayoutDocument,
        zone,
        VIEWPORT,
        1,
      );
      expect(resolved.zones[zone].rect.x).toBeCloseTo(tutorialRect.x, 5);
      expect(resolved.zones[zone].rect.y).toBeCloseTo(tutorialRect.y, 5);
      // A regression that silently keeps the base rect would pass the quiet
      // assertion above but fail here.
      if (baseRect.y !== tutorialRect.y) {
        expect(resolved.zones[zone].rect.y).not.toBeCloseTo(baseRect.y, 1);
      }
    }
  });

  it('keeps unexpected collisions and validation errors loud', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // An intentional override stays quiet.
    reportTutorialLayoutIssue({
      code: 'ZONE_COLLISION',
      severity: 'warning',
      policy: 'sceneWins',
      zoneName: 'hand',
      message: 'Zone collision for "hand" while composing "base" with "scene".',
    });
    expect(warnSpy).not.toHaveBeenCalled();

    // An unexpected collision is still surfaced.
    reportTutorialLayoutIssue({
      code: 'ZONE_COLLISION',
      severity: 'warning',
      policy: 'sceneWins',
      zoneName: 'market',
      message: 'Zone collision for "market" while composing "base" with "scene".',
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // A validation error is still surfaced at error level.
    reportTutorialLayoutIssue({
      code: 'VALIDATION_ERROR',
      severity: 'error',
      policy: 'sceneWins',
      message: 'Invalid base layout "base": / missing zone',
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('documents exactly the zones that collide between the two layouts', () => {
    const baseZones = Object.keys((baseLayout as { zones: Record<string, unknown> }).zones);
    const tutorialZones = Object.keys(
      (tutorialLayout as { zones: Record<string, unknown> }).zones,
    );
    const collisions = tutorialZones.filter((zone) => baseZones.includes(zone)).sort();
    expect(collisions).toEqual([...TUTORIAL_INTENTIONAL_OVERRIDE_ZONES].sort());
  });
});

describe('tutorial ToneForge wiring is console-clean', () => {
  it('keeps the four factory-less keys quiet and falls back to WAV', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const integration = await loadMainStreetTfIntegration(null);
    expect(integration).not.toBeNull();

    const { player: wavPlayer, played } = createRecordingWavPlayer();
    const manager = new SoundManager(wavPlayer, { storage: null });
    manager.setSynthIntegration(integration!.player, integration!.keyMap);

    for (const key of MAIN_STREET_TF_FACTORYLESS_KEYS) {
      manager.register(key, `ms:${key}`);
      manager.play(key);
    }

    const missingWarnings = consoleWarnMessages(warnSpy).filter((message) =>
      message.includes('[tfAdapter] Missing tf factory'),
    );
    expect(missingWarnings).toEqual([]);

    // Each factory-less key still reaches a backend: the WAV player.
    expect(played).toEqual(
      expect.arrayContaining(MAIN_STREET_TF_FACTORYLESS_KEYS.map((key) => `ms:${key}`)),
    );
  });

  it('forwards genuinely missing-factory and other adapter warnings', () => {
    const forwarded: string[] = [];
    const logger = createMainStreetTfLogger((message) => forwarded.push(message));

    // Documented factory-less keys (logical or mapped form) stay quiet.
    logger.warn(
      '[tfAdapter] Missing tf factory for key "sfx-income-positive" (mapped: "income-positive-chime")',
    );
    logger.warn(
      '[tfAdapter] Missing tf factory for key "income-positive-chime" (mapped: "income-positive-chime")',
    );
    expect(forwarded).toEqual([]);

    // An unexpected missing factory is still surfaced.
    logger.warn(
      '[tfAdapter] Missing tf factory for key "sfx-deal" (mapped: "card-draw")',
    );
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toContain('Missing tf factory');

    // Any other adapter warning is forwarded unchanged.
    logger.warn('[tfAdapter] Failed to create tf voice for key "card-draw"');
    expect(forwarded).toHaveLength(2);
  });

  it('surfaces a genuinely missing factory through the real createTfPlayer wiring', async () => {
    const module = await loadMainStreetTfModule();
    expect(module).toBeTruthy();

    const forwarded: string[] = [];
    const player = createTfPlayer(module!, {
      keyMap: MAIN_STREET_TF_SFX_MAPPING,
      logger: createMainStreetTfLogger((message) => forwarded.push(message)),
    });

    // Expected factory-less key: quiet fallback.
    expect(player.play('sfx-income-positive')).toBe(false);
    expect(forwarded).toEqual([]);

    // Unexpected key: still loud.
    expect(player.play('sfx-not-in-the-mapping')).toBe(false);
    expect(forwarded.some((message) => message.includes('Missing tf factory'))).toBe(true);
  });
});
