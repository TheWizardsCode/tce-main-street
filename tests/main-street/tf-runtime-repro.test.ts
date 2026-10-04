/**
 * Regression reproduction (engine work item CG-0MUTU0MFE0077H0F,
 * investigation child CG-0MUU9PPA3003S1S4; sibling tracking item
 * MS-0MUU9QYQE006NLEZ).
 *
 * ## Root cause
 *
 * The committed ToneForge runtime synth module cannot produce a playable voice.
 * Every factory routes through `gainNode()`, which calls
 * `new Tone.Gain(clamp(initialVolume))` — passing the gain **positionally**.
 * Tone.js v15 interprets the positional argument as a `Param` and asserts
 * `isAudioParam(options.param) || options.param instanceof Param`, so
 * construction throws `param must be an AudioParam`.
 *
 * `createTfPlayer()` catches the throw per-key and only warns, so the failure
 * is invisible: the module loads, the player attaches, `isSynthActive()` is
 * `true`, and yet nothing plays (and no WAV fallback either, because
 * `SoundManager.play()` returns early after delegating to the synth player).
 *
 * This test reproduces the load -> normalise -> `createTfPlayer()` chain
 * exactly as the scene wires it and pins the observable contract.
 *
 * The sibling item (MS-0MUU9QYQE006NLEZ) converts the `it.todo` below into a
 * live assertion once the runtime-wiring fix lands.
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
      play: (key: string) => played.push(key),
      stop: () => {},
      setVolume: () => {},
      setMute: () => {},
    },
  };
}

describe('Main Street ToneForge runtime reproduction', () => {
  it('loads the committed module through the real loader', async () => {
    const module = await loadMainStreetTfModule();

    expect(module).toBeTruthy();
    for (const key of RUNTIME_FACTORY_KEYS) {
      expect(typeof module?.factories?.[key]).toBe('function');
    }
  });

  it('attaches the loaded module and delegates a synth-mapped key', async () => {
    const { player: wavPlayer, played } = createWavPlayer();
    const manager = new SoundManager(wavPlayer, { storage: null });

    const module = await loadMainStreetTfModule();
    expect(module).toBeTruthy();

    const synthPlayer = createTfPlayer(module!, { keyMap: MAIN_STREET_TF_SFX_MAPPING });
    manager.setSynthIntegration(synthPlayer, MAIN_STREET_TF_SFX_MAPPING);
    manager.register('sfx-deal', 'sfx-deal');

    expect(manager.isSynthActive()).toBe(true);

    manager.play('sfx-deal');

    // The attach + delegation links of the chain are healthy: the WAV player
    // is bypassed because the key is synth-mapped.
    expect(played).not.toContain('sfx-deal');
  });

  it.todo(
    'plays a synth voice for a mapped key (blocked on the runtime-wiring fix — gainNode() positional Tone.Gain arg, CG-0MUU9PSWI005EZ56)',
  );
});
