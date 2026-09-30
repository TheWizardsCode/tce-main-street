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
 * @module
 */

import type { DebugToolsEntry } from '@ui/debug/DebugToolsRegistry';
import { createSessionExportTool } from '@ui/debug/SessionExportTool';
import { createStateInspectorTool } from '@ui/debug/StateInspectorOverlay';
import { createGameEventLogTool } from '@ui/debug/GameEventLogOverlay';
import { createAiDecisionViewerTool } from '@ui/debug/AiDecisionOverlay';
import { createMarketCardCheatTool } from './MarketCardCheatOverlay';
import { createStaffApplicantCheatTool } from './StaffApplicantCheatOverlay';

/**
 * Builds the debug-tool list registered by Main Street.
 *
 * The engine-generic tools are always built. The Main-Street-specific cheats
 * (Market Card Cheat and Staff Applicant Cheat) are only included when
 * `devMode` is true — they must never be registered in a production build
 * (test-review C4). In production the scene never calls this function because
 * its only call site sits inside a literal `import.meta.env.DEV` branch that
 * Vite replaces with `false`.
 *
 * @param devMode  Whether Vite development mode is active.
 * @returns The debug-tool entries to register.
 */
export function buildMainStreetDebugTools(devMode: boolean): DebugToolsEntry[] {
  const tools: DebugToolsEntry[] = [
    createSessionExportTool(),
    createStateInspectorTool(),
    createGameEventLogTool(),
    createAiDecisionViewerTool(),
  ];
  if (!devMode) return tools;
  return [...tools, createMarketCardCheatTool(), createStaffApplicantCheatTool()];
}
