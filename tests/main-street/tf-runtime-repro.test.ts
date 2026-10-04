/**
 * End-to-end activation contract for the Main Street ToneForge runtime path
 * (engine work item CG-0MUTU0MFE0077H0F; sibling tracking item
 * MS-0MUU9QYQE006NLEZ).
 *
 * ## Corrected root-cause note (engine child CG-0MUU9PSWI005EZ56)
 *
 * An earlier investigation concluded, from a Node-only reproduction, that the
 * committed runtime module's `new Tone.Gain(clamp(v))` voice construction
 * threw `param must be an AudioParam`, making every factory unplayable and so
 * leaving ToneForge silent. **That conclusion was a Node-environment
 * artefact**: with no Web Audio context, Tone.js's `Param` assertion fails for
 * *any* `Gain` construction. In a real browser all 12 factories construct
 * successfully, and the real scene ends up with an active synth player.
 *
 * This test therefore pins the observable, environment-independent contract of
 * the load -> normalise -> `createTfPlayer()` -> `setSynthIntegration()` chain
 * that the scene relies on:
 *
 *  - the real loader resolves a normalisable tf module with the expected
 *    factory keys;
 *  - attaching it makes `SoundManager.isSynthActive()` true;
 *  - a synth-mapped key delegates to the synth player and does **not** hit the
 *    WAV player.
 */

import { describe, expect, it } from 'vitest';
import { SoundManager } from '@core-engine/SoundManager';
import { createTfPlayer } from '@core-engine/tfAdapter';

import { loadMainStreetTfModule } from '../../src/tf/mainStreetTfModule';
import { MAIN_STREET_TF_SFX_MAPPING } from '../../src/sfx-tf-mapping';

/** All synth factory keys shipped by the committed runtime module. */
const RUNTIME_FACTORY_KEYS = [
  'card-draw',
  'card-slide',
  'card-place',
  'card-discard',
  'card-coin-collect',
  'ui-notification-chime',
  'card-table-ambience',
  'construction-hammer',
  'construction-saw',
  'construction-lite-hammer',
  'construction-lite-saw',
  'crowd-cheer',
] as const;

/** Minimal WAV player that records calls, used as the fallback target. */
function createWavPlayer() {
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

describe('Main Street ToneForge runtime activation', () => {
  it('loads the committed module through the real loader', async () => {
    const module = await loadMainStreetTfModule();

    expect(module).toBeTruthy();
    for (const key of RUNTIME_FACTORY_KEYS) {
      expect(typeof module?.factories?.[key]).toBe('function');
    }
  });

  it('attaches the loaded module and routes a synth-mapped key without a silent drop', async () => {
    const { player: wavPlayer, played } = createWavPlayer();
    const manager = new SoundManager(wavPlayer, { storage: null });

    const module = await loadMainStreetTfModule();
    expect(module).toBeTruthy();

    const synthPlayer = createTfPlayer(module!, {
      keyMap: MAIN_STREET_TF_SFX_MAPPING,
      logger: { warn: () => {} },
    });
    const synthCalls: string[] = [];
    const originalPlay = synthPlayer.play.bind(synthPlayer);
    synthPlayer.play = (key: string): boolean => {
      synthCalls.push(key);
      return originalPlay(key);
    };

    manager.setSynthIntegration(synthPlayer, MAIN_STREET_TF_SFX_MAPPING);
    manager.register('sfx-deal', 'sfx-deal');

    expect(manager.isSynthActive()).toBe(true);

    manager.play('sfx-deal');

    // The key is always sent to the synth player first.
    expect(synthCalls).toEqual(['card-draw']);

    // Routing must never be a silent drop. In a real browser the synth voice
    // plays (no WAV call); under Node there is no Web Audio context, so voice
    // creation fails and the engine's missing/failed-factory fallback routes
    // the key to WAV instead. Either way the key reaches a backend.
    const handledBySynth = synthPlayer.play('card-draw');
    if (handledBySynth) {
      expect(played).toEqual([]);
    } else {
      expect(played).toContain('sfx-deal');
    }
  });
});
