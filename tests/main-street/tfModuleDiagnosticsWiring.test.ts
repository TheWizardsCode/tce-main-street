/**
 * Sibling wiring contract for the ToneForge loader diagnostics (engine item
 * CG-0MUTU0MFE0077H0F, child CG-0MUU9PP9V000UOC3; sibling item
 * MS-0MUU9QYQE006NLEZ).
 *
 * The scene's async load handler forwards the loader's retained diagnostics to
 * `SoundManager.setSynthDiagnostics()` so the debug indicator can report why
 * ToneForge is inactive. This test pins that end of the contract without
 * booting the whole Phaser scene: it drives the real loader and the real
 * `SoundManager` exactly as the handler does.
 *
 * The loader caches its module result in module scope, so each case imports
 * the loader dynamically after `vi.resetModules()` for isolation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundManager } from '@core-engine/SoundManager';

/** Minimal WAV player stand-in. */
function wavPlayer() {
  return {
    play: () => {},
    stop: () => {},
    setVolume: () => {},
    setMute: () => {},
  };
}

describe('mainStreet tf diagnostics -> SoundManager wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE__;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@core-engine/tf-runtime/main-street-runtime-synth.mjs');
  });

  it('reports the successful load factory count to SoundManager', async () => {
    const manager = new SoundManager(wavPlayer(), { storage: null });
    const loader = await import('../../src/tf/mainStreetTfModule');

    const loaded = await loader.loadMainStreetTfModule();
    const diagnostics = loader.getMainStreetTfDiagnostics();

    // Mirrors the scene handler: forward diagnostics on the success path.
    manager.setSynthDiagnostics({
      factoryCount: diagnostics.factoryCount,
      lastLoadError: diagnostics.lastLoadError,
    });

    const status = manager.getSynthStatus();
    expect(loaded).toBeTruthy();
    expect(status.factoryCount).toBeGreaterThan(0);
    expect(status.lastLoadError).toBeNull();
  });

  it('surfaces a load failure reason to SoundManager', async () => {
    vi.doMock('@core-engine/tf-runtime/main-street-runtime-synth.mjs', () => ({
      get TF_RUNTIME_MODULE() {
        throw new Error('synthetic wiring failure');
      },
    }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const manager = new SoundManager(wavPlayer(), { storage: null });
    const loader = await import('../../src/tf/mainStreetTfModule');

    await loader.loadMainStreetTfModule();
    const diagnostics = loader.getMainStreetTfDiagnostics();

    // Mirrors the scene handler: forward diagnostics on the failure path.
    manager.setSynthDiagnostics({
      factoryCount: diagnostics.factoryCount,
      lastLoadError: diagnostics.lastLoadError,
    });

    const status = manager.getSynthStatus();
    expect(status.lastLoadError).toContain('synthetic wiring failure');
    // No synth player was attached, so ToneForge is inactive.
    expect(status.active).toBe(false);
  });
});
