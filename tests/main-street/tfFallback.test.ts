/**
 * Missing-factory fallback contract (engine item CG-0MUTU0MFE0077H0F, child
 * CG-0MUU9PSWC009CW76; sibling tracking item MS-0MUU9QYQE006NLEZ).
 *
 * `MAIN_STREET_TF_SFX_MAPPING` maps 16 logical keys and the committed runtime
 * module ships a factory for all 16 (MS-0MV8PDNDT0033TH8). Because
 * `SoundManager.play()` used to return after delegating to the synth player, a
 * key without a factory went completely silent: no synth voice *and* no WAV
 * fallback.
 *
 * The engine fix makes `tfAdapter`'s player report whether it handled the key
 * and `SoundManager` fall through to WAV when it did not. This test drives the
 * **real** mapping and the **real** loader/player and asserts that every mapped
 * key resolves to a shipped factory, and that every key either plays a voice or
 * falls back to the WAV player — never a silent drop.
 */

import { describe, expect, it } from 'vitest';
import { SoundManager, type SoundPlayer } from '@core-engine/SoundManager';
import { createTfPlayer } from '@core-engine/tfAdapter';

import { loadMainStreetTfModule } from '../../src/tf/mainStreetTfModule';
import {
  MAIN_STREET_TF_FACTORYLESS_FACTORY_KEYS,
  MAIN_STREET_TF_FACTORYLESS_KEYS,
  MAIN_STREET_TF_SFX_MAPPING,
} from '../../src/sfx-tf-mapping';

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

  it('ships a runtime factory and descriptor for every mapped key', async () => {
    const module = await loadMainStreetTfModule();
    expect(module).toBeTruthy();

    for (const [logicalKey, factoryKey] of Object.entries(MAIN_STREET_TF_SFX_MAPPING)) {
      expect(
        typeof module!.factories?.[factoryKey],
        `${logicalKey} -> ${factoryKey} must have a runtime factory`,
      ).toBe('function');
      expect(
        module!.descriptors?.[factoryKey],
        `${logicalKey} -> ${factoryKey} must have a runtime descriptor`,
      ).toBeDefined();
    }
  });

  it('the synth player reports no missing factory for any mapped key', async () => {
    const module = await loadMainStreetTfModule();
    const warnings: string[] = [];
    const player = createTfPlayer(module!, {
      keyMap: MAIN_STREET_TF_SFX_MAPPING,
      logger: { warn: (message: string) => warnings.push(message) },
    });

    for (const logicalKey of Object.keys(MAIN_STREET_TF_SFX_MAPPING)) {
      player.play(logicalKey);
    }

    // Under Node there is no Web Audio context, so voice construction may fail
    // (reported as `Failed to create tf voice`). That is fine: what must never
    // happen again is a *missing factory*.
    expect(warnings.filter((message) => message.includes('Missing tf factory'))).toEqual([]);
  });

  it('declares no factory-less keys now that all 16 mappings play through the synth', async () => {
    // AC3: the workaround lists are empty, so the four former fallback keys are
    // no longer suppressed as expected gaps.
    expect(MAIN_STREET_TF_FACTORYLESS_KEYS).toEqual([]);
    expect(MAIN_STREET_TF_FACTORYLESS_FACTORY_KEYS).toEqual([]);

    const module = await loadMainStreetTfModule();
    for (const key of [
      'sfx-income-positive',
      'sfx-income-negative',
      'sfx-income-neutral',
      'sfx-challenge-complete',
    ]) {
      const factoryKey = MAIN_STREET_TF_SFX_MAPPING[key];
      expect(typeof module!.factories?.[factoryKey]).toBe('function');
    }
  });
});
