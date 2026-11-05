/**
 * Main Street: post-action out-of-actions trigger
 *
 * The single post-action hook for the Auto advance turn feature
 * (MS-0MW1ZDI8Z006GPFY). Called once the action that spends the last action
 * point has resolved *and* its animations/audio have completed; decides
 * whether the out-of-actions moment fires and dispatches it:
 *
 *  - setting ON  → `tcCtx.endTurn()` — the exact code path the End Turn
 *    button handler uses (identical phase flow, income/incident/event-choice
 *    resolution, turn-summary presentation and save/checkpoint behaviour);
 *  - setting OFF → the injected dialog hook (the explainer overlay lives in
 *    the dialog work item and is wired by the scene).
 *
 * The decision is a pure function over an injected state so unit tests run
 * in Node without a Phaser scene; the scene owns the once-per-turn latch
 * flag (reset at turn start) and passes it in as `latchFired`.
 *
 * Guards (parent AC5): at most once per turn; never mid-animation/audio;
 * suppressed during the tutorial unless the current step allows `end-turn`;
 * never during non-human seats in competitive play; never during `uiPhase`
 * values where End Turn is not offered.
 *
 * @module
 */

import type { MainStreetTurnControllerContext } from './MainStreetTurnControllerContext';

/**
 * `uiPhase` values in which End Turn is not offered; the trigger must stay
 * silent during them. Matches the phases named in the feature AC
 * (`placing-from-hand`, `event-selected`, `applicant`).
 */
export const OUT_OF_ACTIONS_SILENT_PHASES: readonly string[] = [
  'placing-from-hand',
  'event-selected',
  'applicant',
];

/**
 * Complete observable state the trigger needs to decide. Everything is
 * injected — the caller (the scene's post-action path) resolves the live
 * values, so the decision stays pure and unit-testable.
 */
export interface OutOfActionsTriggerState {
  /** Whether the trigger already fired this turn (scene-owned latch). */
  latchFired: boolean;
  /** Whether the player's action budget reached zero as the action resolved. */
  zeroActions: boolean;
  /** Whether the triggering action's animations AND audio have completed. */
  presentationComplete: boolean;
  /** The persisted Auto advance turn preference. */
  autoAdvanceEnabled: boolean;
  /**
   * The tutorial gate for `end-turn`
   * (`msLifecycleManager.isTutorialActionAllowed('end-turn')`); `null` or
   * `undefined` when the tutorial is inactive or the gate is unavailable.
   */
  endTurnAllowed: { allowed: boolean; reason?: string } | null | undefined;
  /** Whether it is the human seat's turn (always true in single-player). */
  humanSeatTurn: boolean;
  /** The scene's current `uiPhase` (see `MainStreetScene.UIPhase`). */
  uiPhase: string;
}

/** Whether End Turn is offered in the given `uiPhase` (trigger-relevant). */
export function isEndTurnPhaseOffered(uiPhase: string): boolean {
  return !OUT_OF_ACTIONS_SILENT_PHASES.includes(uiPhase);
}

/**
 * Pure decision: whether the post-action out-of-actions trigger should fire.
 *
 * All four guards from the feature ACs are applied — once-per-turn latch,
 * animation/audio completion, the mode guards (tutorial / human seat /
 * uiPhase) — plus the zero-action precondition.
 */
export function shouldFireOutOfActionsTrigger(state: OutOfActionsTriggerState): boolean {
  if (state.latchFired) return false;
  if (!state.zeroActions) return false;
  if (!state.presentationComplete) return false;
  if (state.endTurnAllowed && !state.endTurnAllowed.allowed) return false;
  if (!state.humanSeatTurn) return false;
  if (!isEndTurnPhaseOffered(state.uiPhase)) return false;
  return true;
}

/**
 * Dialog-presentation seam for the setting-off path. The scene wires the
 * real `showOutOfActionsDialog()` here; unit tests inject a spy.
 */
export interface OutOfActionsTriggerHooks {
  /** Presents the out-of-actions explainer dialog (setting off). */
  showDialog?: () => void;
}

/**
 * Runs the post-action out-of-actions trigger.
 *
 * Returns `true` when the trigger fired (auto-advance or dialog) so the
 * caller can set the once-per-turn latch; `false` when a guard suppressed
 * it. With the setting ON the trigger dispatches through `tcCtx.endTurn()`
 * — the identical code path as the End Turn button.
 */
export function runOutOfActionsTrigger(
  tcCtx: MainStreetTurnControllerContext,
  state: OutOfActionsTriggerState,
  hooks: OutOfActionsTriggerHooks = {},
): boolean {
  if (!shouldFireOutOfActionsTrigger(state)) return false;
  if (state.autoAdvanceEnabled) {
    tcCtx.endTurn();
  } else {
    hooks.showDialog?.();
  }
  return true;
}
