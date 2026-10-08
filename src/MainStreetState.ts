/**
 * Main Street: Game State Types and Setup
 *
 * **This module is a barrel file.** All exports are re-exported from
 * per-concern sub-modules to preserve backward compatibility with existing
 * imports — consumers should import from `MainStreetState` and not need
 * to change when sub-modules evolve.
 *
 * | Sub-module                     | Responsibility |
 * |--------------------------------|----------------|
 * | `MainStreetStateTypes`         | State interfaces, enums, type aliases |
 * | `MainStreetStateLog`           | Activity-log helpers and ledger sync |
 * | `MainStreetStateSetup`         | Seeded setup, market refill, competitive state |
 * | `MainStreetStateSerialize`     | Serialize/deserialize + migration |
 *
 * @module
 */

// ── Types ───────────────────────────────────────────────────
export type {
  LogEntryType,
  LogEntry,
  TurnPhase,
  MarketState,
  ResourceBank,
  GameResult,
  EndReason,
  PlayerRecord,
  OwnerTaggedSlot,
  CompetitiveStateOptions,
  SeatController,
  AiSeatStrategy,
  AiSeatDifficulty,
  CompetitiveOpponentConfig,
  GameMode,
  GameModeSelectionBase,
  SinglePlayerModeSelection,
  CompetitiveModeSelection,
  GameModeSelection,
  MainStreetState,
  PendingApplicant,
  PendingEventChoice,
  MainStreetSerializedState,
  MilestoneRecord,
  MainStreetCampaignProgress,
  MainStreetSetupOptions,
} from './MainStreetStateTypes';

export { PHASE_ORDER, AI_SEAT_STRATEGIES, AI_SEAT_DIFFICULTIES } from './MainStreetStateTypes';

// ── Logging ─────────────────────────────────────────────────
export {
  describeEventEffects,
  classifyEffect,
  addLog,
  syncResourceBankToLedger,
} from './MainStreetStateLog';

// ── Scoring ─────────────────────────────────────────────────
export {
  effectiveWinThreshold,
} from './MainStreetEngineScoring';

// ── Setup ───────────────────────────────────────────────────
export {
  seedToNumber,
  ALLOWED_START_WEEKS,
  rollStartWeek,
  advanceWeek,
  generateSeedString,
  refillSingleRowMarket,
  isMarketCardRelevant,
  setupMainStreetGame,
  createCompetitiveState,
  createStateFromModeSelection,
  setIncidentBalanceLimits,
  setStreetGridLattice,
} from './MainStreetStateSetup';

export type { MarketRelevanceBias } from './MainStreetStateSetup';

// ── Serialization ───────────────────────────────────────────
export {
  serializeMainStreetState,
  deserializeMainStreetState,
} from './MainStreetStateSerialize';
