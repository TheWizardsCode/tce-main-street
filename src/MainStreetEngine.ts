/**
 * Main Street: Turn Engine (barrel)
 *
 * **This module is a barrel file.** All exports are re-exported from
 * per-concern sub-modules to preserve backward compatibility with existing
 * imports — consumers should import from `MainStreetEngine` and not need
 * to change when sub-modules evolve.
 *
 * | Sub-module                          | Responsibility |
 * |-------------------------------------|----------------|
 * | `MainStreetEngineTypes`             | Action payloads + result interfaces (leaf) |
 * | `MainStreetEngineScoring`           | Scores, event projection, AI choice |
 * | `MainStreetEngineWeekStart`          | Day start + phase cursor |
 * | `MainStreetEngineCompetitiveTurn`   | Competitive day orchestration |
 * | `MainStreetEngineActions`           | Action dispatch + budget |
 * | `MainStreetEngineEvents`            | Event resolution |
 * | `MainStreetEngineTurnClosing`       | End-of-turn + end checks |
 * | `MainStreetEngineCommands`          | Command implementations |
 *
 * @module
 */


// ── Types ─────────────────────────────────────────────
export type {
  BuyAndPlaceAction,
  BuyAndPlaceUpgradeAction,
  BuyBusinessAction,
  BuyEventAction,
  BuyUpgradeAction,
  CloseBusinessAction,
  CommunityFavourAction,
  DiscardFromHandAction,
  EndOfTurnOptions,
  EndTurnAction,
  EventChoiceResolution,
  HireStaffAction,
  MoveToHandAction,
  PeekIncidentAction,
  PendingEndOfTurnDeltas,
  PlayBusinessFromHandAction,
  PlayEventAction,
  PlayEventFromHandAction,
  PlayUpgradeFromHandAction,
  PlayerAction,
  TakeLoanAction,
  TurnResult,
} from './MainStreetEngineTypes';

export type {
  CompetitiveSeatFailure,
  CompetitiveSeatFailureReason,
} from './MainStreetEngineTurnClosing';

// ── Scoring ─────────────────────────────────────────────
export {
  AI_EVENT_CHOICE_SIGNIFICANTLY_WORSE_RATIO,
  PIGGYBACK_DIFFICULTY_PROFILES,
  computeScore,
  decideEventChoice,
  decidePiggyback,
  decidePiggybackForAllSeats,
  decidePiggybackForSeat,
  effectiveWinThreshold,
  eventSeverity,
  piggybackBalanceFloor,
  projectEventCoinDelta,
  updateCompetitiveScores,
  updateScore,
} from './MainStreetEngineScoring';

export type { PiggybackDifficultyProfile, PiggybackPolicyDecision } from './MainStreetEngineScoring';

// ── WeekStart ─────────────────────────────────────────────
export {
  advancePhase,
  executeWeekStart,
  setPhase,
} from './MainStreetEngineWeekStart';

// ── CompetitiveTurn ─────────────────────────────────────────────
export {
  endCompetitiveMarketTurn,
  executeCompetitiveTurn,
  executeCompetitiveWeekStart,
  getActivePlayerId,
  getFirstActivePlayerId,
  getNextActivePlayerId,
  resolveCompetitiveClosingPhases,
  resolveCompetitiveLoanOffer,
  resolveCompetitivePendingChoice,
  resolveCompetitivePendingPiggyback,
  setActivePlayerId,
} from './MainStreetEngineCompetitiveTurn';

// ── Actions ─────────────────────────────────────────────
export {
  consumeAction,
  executeAction,
  executeCommunityFavour,
  peekIncidentDeck,
} from './MainStreetEngineActions';

// ── Events ─────────────────────────────────────────────
export {
  applyCompetitiveEventEffects,
  applyPiggybackFreeRide,
  applyPiggybackJoinFully,
  canAffordPiggybackJoinFully,
  computeEventDeltas,
  eventSynergyTargets,
  getNextPendingPiggybackSeat,
  getPiggybackSeatIds,
  hasPendingPiggyback,
  isPiggybackEligible,
  matchesEventSynergyTargets,
  piggybackJoinFullyCost,
  playHeldEvent,
  projectPiggybackEventReward,
  raisePiggybackDecisions,
  resolveAllPendingPiggybacks,
  resolveEvent,
  resolveHeldInvestment,
  resolvePendingPiggyback,
} from './MainStreetEngineEvents';

export type {
  PiggybackJoinFullyResult,
  PiggybackRewardProjection,
  PiggybackRewardScale,
  PiggybackSeatResolution,
} from './MainStreetEngineEvents';

// ── TurnClosing ─────────────────────────────────────────────
export {
  appendTurnNetRow,
  applyEndOfTurnDeltas,
  applyFirstSharedDaySolvencyGrace,
  checkCompetitiveEndConditions,
  checkCompetitiveSeatFailure,
  checkLastStanding,
  closeEliminatedSeatBusinesses,
  continueAfterLastStanding,
  continueAfterThreshold,
  eliminateCompetitiveSeat,
  findHumanSeatId,
  resolveCompetitiveSeatFailures,
  checkEndConditions,
  checkImmediateLoss,
  endTurnHeadless,
  executeFullTurn,
  finishDeferredEndOfTurn,
  finishDeferredTurnClosing,
  processEndOfTurn,
  resolveEventChoice,
  resolveEventOption,
  resolveIncident,
  resolvePendingEventChoice,
  resolvePendingLoanOffer,
} from './MainStreetEngineTurnClosing';

// ── Commands ─────────────────────────────────────────────
export {
  applyBusinessOngoingCosts,
  applyCommunitySpaceOngoingCosts,
  applyCompetitiveOngoingCosts,
  applyStaffOngoingCosts,
  buyAndPlaceBusiness,
  canHireStaffApplicant,
  canMoveStaffOnBusiness,
  canPlaceFromHand,
  canPlaceStaffOnBusiness,
  canSellBusiness,
  canSellFromHand,
  canSellFromTableau,
  computeApplicantChance,
  declineApplicantAction,
  declineStaffApplicant,
  executeSell,
  getEmployedStaffCountAt,
  getEmployedStaffForBusiness,
  getEmploymentCapacity,
  hasFreeEmploymentSlot,
  hireApplicantAction,
  isStaffRelocation,
  hireStaffApplicant,
  hireStaffCard,
  layoffStaffCard,
  letGoStaffAction,
  letGoStaffMember,
  moveStaffOnBusiness,
  acceptLoanOffer,
  placeFromHand,
  placeStaffOnBusiness,
  removeStaffFromBusiness,
  resolveStaffApplicant,
  sellFromHand,
  sellFromTableau,
  takeLoan,
  creditLoanPrincipal,
} from './MainStreetEngineCommands';

// ── Bank loan model (Bank Loans epic MS-0MVL6DZI0000F6CG) ──
export {
  DEFAULT_LOAN_INTEREST_RATE,
  DEFAULT_LOAN_OPTIONS,
  activeLoanFor,
  applyLoanPayment,
  applyLoanRepayments,
  buildActiveLoan,
  canTakeLoan,
  debitLoanRepayment,
  declineLoanOffer,
  largestBailoutOption,
  maybeOfferBailout,
  maybeOfferBailoutForSeat,
  loanOwnerId,
  loanPerTurnRepayment,
  loanTotalRepayment,
  optionsFor,
} from './MainStreetLoans';

export type { ActiveLoan, LoanOption, PendingLoanOffer } from './MainStreetStateTypes';

// ── Re-exports kept for convenience (tests/consumers import these from the engine) ──
export { reputationCoinMultiplier, applyReputationMultiplier } from './MainStreetDifficulty';
export { cycleMarketCards } from './MainStreetMarket';
export { describeEventEffects, classifyEffect } from './MainStreetState';
