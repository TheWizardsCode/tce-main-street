/**
 * Main Street debug-tool registration.
 *
 * Phaser-free so the dev/production registration decision can be asserted
 * directly by tests (test-review C4, MS-0MUMO3BDE000QDXJ) instead of by
 * grepping the scene source. `MainStreetScene` calls this inside its literal
 * `if (import.meta.env.DEV)` branch so Vite/Rollup still tree-shakes the
 * entire debug-tools path (including the Main Street cheats) from production
 * builds.
 *
 * The ToneForge status entry is registered here (dev-only) as the **opt-in**
 * entry point (MS-0MV76P7BN00164RF): enabling it lazily loads + attaches the
 * ToneForge runtime module, so nothing is fetched or attached at scene boot.
 * The engine's effective-list injection in `CardGameScene` de-duplicates by
 * label, so this game-owned entry replaces the engine default.
 *
 * @module
 */

import type { DebugToolsEntry } from '@ui/debug/DebugToolsRegistry';
import type { SoundManager } from '@core-engine/SoundManager';
import { createTfPlayer } from '@core-engine';
import {
  createToneForgeStatusTool,
  type SynthIntegrationLoad,
  type SynthIntegrationLoader,
} from '@ui/debug/ToneForgeStatusTool';
import { createSessionExportTool } from '@ui/debug/SessionExportTool';
import { createStateInspectorTool } from '@ui/debug/StateInspectorOverlay';
import { createGameEventLogTool } from '@ui/debug/GameEventLogOverlay';
import { createAiDecisionViewerTool } from '@ui/debug/AiDecisionOverlay';
import { getMainStreetTfDiagnostics, loadMainStreetTfModule } from '../tf/mainStreetTfModule';
import { MAIN_STREET_TF_SFX_MAPPING } from '../sfx-tf-mapping';
import { createMainStreetTfLogger } from '../tf/tfLogger';
import { createMarketCardCheatTool } from './MarketCardCheatOverlay';
import { createStaffApplicantCheatTool } from './StaffApplicantCheatOverlay';

/**
 * Lazily load and build the Main Street ToneForge synth integration.
 *
 * Called only when the dev-only ToneForge debug tool is switched on, so no
 * ToneForge runtime chunk is fetched at scene boot (MS-0MV76P7BN00164RF). A
 * failed load stays loud: the loader warns (`[mainStreet tf]`) and its
 * retained diagnostics are recorded on the SoundManager so the status line
 * surfaces the reason, while the WAV/Phaser path is untouched.
 *
 * @param soundManager The scene's SoundManager (may be null in constrained
 *                     environments — the loader never throws).
 * @returns The integration to attach, or `null` when it could not be loaded.
 */
export async function loadMainStreetTfIntegration(
  soundManager: SoundManager | null,
): Promise<SynthIntegrationLoad | null> {
  const module = await loadMainStreetTfModule();
  const diagnostics = getMainStreetTfDiagnostics();
  if (!module) {
    // Failure path: record the retained diagnostics so the status line shows
    // why ToneForge is inactive (framing preserved from the eager wiring,
    // CG-0MUU9PP9V000UOC3) and keep the WAV path untouched.
    soundManager?.setSynthDiagnostics({
      factoryCount: diagnostics.factoryCount,
      lastLoadError: diagnostics.lastLoadError,
    });
    return null;
  }
  return {
    player: createTfPlayer(module, {
      keyMap: MAIN_STREET_TF_SFX_MAPPING,
      // Every mapped key ships a runtime factory, so no expected fallback
      // needs suppressing; any genuinely missing factory still warns
      // (MS-0MV8PDNDT0033TH8, MS-0MV26MOWT004ZCQC).
      logger: createMainStreetTfLogger(),
    }),
    keyMap: MAIN_STREET_TF_SFX_MAPPING,
    diagnostics: {
      factoryCount: diagnostics.factoryCount,
      lastLoadError: diagnostics.lastLoadError,
    },
  };
}

/**
 * Builds the debug-tool list registered by Main Street.
 *
 * The engine-generic tools are always built. The Main-Street-specific cheats
 * (Market Card Cheat and Staff Applicant Cheat) and the ToneForge opt-in entry
 * are only included when `devMode` is true — they must never be registered in a
 * production build (test-review C4). In production the scene never calls this
 * function because its only call site sits inside a literal
 * `import.meta.env.DEV` branch that Vite replaces with `false`.
 *
 * @param devMode          Whether Vite development mode is active.
 * @param soundManager     The scene's SoundManager (required for the ToneForge
 *                         entry; `null` in constrained environments).
 * @param loadIntegration  Test-injectable synth loader; defaults to the real
 *                         lazy loader. Never invoked while the tool is merely
 *                         registered — only when synthesis is enabled.
 * @returns The debug-tool entries to register.
 */
export function buildMainStreetDebugTools(
  devMode: boolean,
  soundManager: SoundManager | null = null,
  loadIntegration?: SynthIntegrationLoader,
): DebugToolsEntry[] {
  const tools: DebugToolsEntry[] = [
    createSessionExportTool(),
    createStateInspectorTool(),
    createGameEventLogTool(),
    createAiDecisionViewerTool(),
  ];
  if (!devMode) return tools;
  return [
    ...tools,
    createMarketCardCheatTool(),
    createStaffApplicantCheatTool(),
    // Opt-in ToneForge entry: enabling lazily loads + attaches the module.
    // Registering the entry itself never touches the loader.
    createToneForgeStatusTool(soundManager, {
      loadIntegration: loadIntegration ?? (() => loadMainStreetTfIntegration(soundManager)),
    }),
  ];
}
