/**
 * Opt-in ToneForge contract for Main Street (MS-0MV76P7BN00164RF).
 *
 * ToneForge runtime synthesis is **off by default**: registering the debug
 * tool never attaches a synth player or invokes the module loader, so the boot
 * path stays on the WAV/Phaser pipeline and fetches no ToneForge chunk.
 * Enabling the dev-only ToneForge entry lazily loads and attaches the
 * integration; disabling detaches it with the WAV fallback intact.
 */

import { describe, it, expect, vi } from 'vitest';
import { SoundManager, type SoundPlayer } from '@core-engine/SoundManager';
import {
  createToneForgeStatusTool,
  TONEFORGE_DEBUG_TOOL_LABEL,
} from '@ui/debug/ToneForgeStatusTool';
import { buildMainStreetDebugTools } from '../../src/debug/MainStreetDebugTools';

function createMockPlayer(): SoundPlayer {
  return {
    play: vi.fn(),
    stop: vi.fn(),
    setVolume: vi.fn(),
    setMute: vi.fn(),
  };
}

describe('Main Street ToneForge opt-in', () => {
  it('registers the ToneForge entry in the dev tool list without invoking the loader', () => {
    const loader = vi.fn();

    const tools = buildMainStreetDebugTools(true, null, loader);

    expect(tools.map((t) => t.label)).toContain(TONEFORGE_DEBUG_TOOL_LABEL);
    // Registering the tool is a boot-path operation: it must never load.
    expect(loader).not.toHaveBeenCalled();
  });

  it('does not register the ToneForge entry in a production build', () => {
    const tools = buildMainStreetDebugTools(false, null);

    expect(tools.map((t) => t.label)).not.toContain(TONEFORGE_DEBUG_TOOL_LABEL);
  });

  it('starts inactive on the WAV path and opts in lazily, then reverts on disable', async () => {
    const wav = createMockPlayer();
    const synth = createMockPlayer();
    const manager = new SoundManager(wav, { storage: null });
    const loader = vi.fn(async () => ({
      player: synth,
      keyMap: { 'sfx-deal': 'card-draw' },
      diagnostics: { factoryCount: 16 },
    }));
    const tool = createToneForgeStatusTool(manager, { loadIntegration: loader });
    manager.register('sfx-deal', 'ms:sfx-deal');

    // Default: WAV path, nothing loaded, synthesis inactive.
    manager.play('sfx-deal');
    expect(wav.play).toHaveBeenCalledWith('ms:sfx-deal');
    expect(synth.play).not.toHaveBeenCalled();
    expect(manager.isSynthActive()).toBe(false);
    expect(loader).not.toHaveBeenCalled();

    // Opt in: the loader runs exactly once and synth handles the mapped key.
    tool.activate({} as never);
    await vi.waitFor(() => expect(manager.isSynthActive()).toBe(true));
    expect(loader).toHaveBeenCalledTimes(1);
    (wav.play as ReturnType<typeof vi.fn>).mockClear();
    manager.play('sfx-deal');
    expect(synth.play).toHaveBeenCalledWith('card-draw');
    expect(wav.play).not.toHaveBeenCalled();

    // Disable: back to WAV without a reload or scene restart.
    tool.activate({} as never);
    expect(manager.isSynthActive()).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);
    (wav.play as ReturnType<typeof vi.fn>).mockClear();
    manager.play('sfx-deal');
    expect(wav.play).toHaveBeenCalledWith('ms:sfx-deal');
  });

  it('keeps the WAV fallback for a mapped key that the synth could not handle after opt-in', async () => {
    const wav = createMockPlayer();
    // A synth player that reports the key as unhandled (e.g. its voice could
    // not be constructed).
    const synth: SoundPlayer = {
      play: vi.fn(() => false),
      stop: vi.fn(),
      setVolume: vi.fn(),
      setMute: vi.fn(),
    };
    const manager = new SoundManager(wav, { storage: null });
    const loader = vi.fn(async () => ({
      player: synth,
      keyMap: { 'sfx-challenge-complete': 'success-fanfare' },
    }));
    const tool = createToneForgeStatusTool(manager, { loadIntegration: loader });
    manager.register('sfx-challenge-complete', 'ms:sfx-challenge-complete');

    tool.activate({} as never);
    await vi.waitFor(() => expect(manager.isSynthActive()).toBe(true));

    manager.play('sfx-challenge-complete');

    // The synth reported the key as unhandled, so the sound falls back to WAV
    // rather than going silent (CG-0MUU9PSWC009CW76).
    expect(synth.play).toHaveBeenCalledWith('success-fanfare');
    expect(wav.play).toHaveBeenCalledWith('ms:sfx-challenge-complete');
  });
});
