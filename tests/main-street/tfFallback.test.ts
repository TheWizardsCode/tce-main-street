/**
 * Missing-factory fallback contract (engine item CG-0MUTU0MFE0077H0F, child
 * CG-0MUU9PSWC009CW76; sibling tracking item MS-0MUU9QYQE006NLEZ).
 *
 * `MAIN_STREET_TF_SFX_MAPPING` maps 16 logical keys but the committed runtime
 * module ships only 12 factories, so four entries map to a factory that does
 * not exist. Because `SoundManager.play()` used to return after delegating to
 * the synth player, those keys went completely silent: no synth voice *and*
 * no WAV fallback.
 *
 * The engine fix makes `tfAdapter`'s player report whether it handled the key
 * and `SoundManager` fall through to WAV when it did not. This test drives the
 * **real** mapping and the **real** loader/player and asserts that every mapped
 * key either plays a voice or falls back to the WAV player — never a silent
 * drop.
 */

import { describe, expect, it } from 'vitest';
import { SoundManager, type SoundPlayer } from '@core-engine/SoundManager';
import { createTfPlayer } from '@core-engine/tfAdapter';

import { loadMainStreetTfModule } from '../../src/tf/mainStreetTfModule';
import { MAIN_STREET_TF_SFX_MAPPING } from '../../src/sfx-tf-mapping';

/** Records which asset keys the WAV/Phaser path was asked to play. */
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

describe('Main Street tf missing-factory fallback', () => {
  it('every mapped key either plays a synth voice or falls back to WAV', async () => {
    const module = await loadMainStreetTfModule();
    expect(module).toBeTruthy();

    const { player: wavPlayer, played: wavPlayed } = createRecordingWavPlayer();
    const manager = new SoundManager(wavPlayer, { storage: null });

    const synthPlayer = createTfPlayer(module!, {
      keyMap: MAIN_STREET_TF_SFX_MAPPING,
      logger: { warn: () => {} },
    });
    const synthPlayed: string[] = [];
    const originalPlay = synthPlayer.play.bind(synthPlayer);
    synthPlayer.play = (key: string): boolean => {
      const handled = originalPlay(key);
      if (handled) synthPlayed.push(key);
      return handled;
    };

    manager.setSynthIntegration(synthPlayer, MAIN_STREET_TF_SFX_MAPPING);

    for (const logicalKey of Object.keys(MAIN_STREET_TF_SFX_MAPPING)) {
      manager.register(logicalKey, `ms:${logicalKey}`);
      manager.play(logicalKey);
    }

    for (const logicalKey of Object.keys(MAIN_STREET_TF_SFX_MAPPING)) {
      const mappedFactory = MAIN_STREET_TF_SFX_MAPPING[logicalKey];
      const hasFactory = typeof module!.factories?.[mappedFactory] === 'function';
      const routedToSynth = synthPlayed.includes(mappedFactory);
      const routedToWav = wavPlayed.includes(`ms:${logicalKey}`);
      // Never a silent drop: each mapped key reached a backend.
      expect(routedToSynth || routedToWav).toBe(true);
      if (!hasFactory) {
        expect(routedToWav).toBe(true);
      }
    }
  });

  it('the four factory-less mappings fall back to WAV', async () => {
    const module = await loadMainStreetTfModule();
    const { player: wavPlayer, played } = createRecordingWavPlayer();
    const manager = new SoundManager(wavPlayer, { storage: null });

    manager.setSynthIntegration(
      createTfPlayer(module!, { keyMap: MAIN_STREET_TF_SFX_MAPPING, logger: { warn: () => {} } }),
      MAIN_STREET_TF_SFX_MAPPING,
    );

    const factoryless = [
      'sfx-income-positive',
      'sfx-income-negative',
      'sfx-income-neutral',
      'sfx-challenge-complete',
    ] as const;

    for (const key of factoryless) {
      manager.register(key, `ms:${key}`);
      manager.play(key);
    }

    expect(played).toEqual(expect.arrayContaining(factoryless.map((k) => `ms:${k}`)));
  });
});
