/**
 * Main Street: Controller Animations
 *
 * Market deal-in, market swap, new-synergy-pair animations, and the shared
 * end-of-turn closing presentation primitive used by both the single-player
 * and competitive flows.
 *
 * @module
 */

import { computeSynergyPairs, diffNewSynergyPairs } from '../MainStreetAdjacency';
import type { SynergyPair } from '../MainStreetAdjacency';
import type { PendingEndOfTurnDeltas, TurnResult } from '../MainStreetEngine';
import type { MainStreetTurnControllerContext } from './MainStreetTurnControllerContext';

export function animateMarketDealIn(tcCtx: MainStreetTurnControllerContext, row: 'market'): void {

    const s = tcCtx.scene;
    try {
      s.msAnimator.animateMarketDealIn({
        row,
        cards: s.msRenderer.getMarketRowCards(row),
      });
    } catch (_) {
      // presentation-only — ignore
    }
  
}

export function animateMarketSwap(tcCtx: MainStreetTurnControllerContext, 
    row: 'market',
    outgoingRow: Array<{ id: string; family: 'business' | 'community-space' | 'event' | 'upgrade' }>,
  ): void {

    const s = tcCtx.scene;
    try {
      s.msAnimator.animateMarketDealIn({
        row,
        cards: s.msRenderer.getMarketRowCards(row),
        outgoing: outgoingRow.map((card, i) => ({
          cardId: card.id,
          family: card.family,
          ...s.msRenderer.getMarketSlotCenter(row, i),
        })),
      });
    } catch (_) {
      // presentation-only — ignore
    }
  
}

export function animateNewSynergyPairs(tcCtx: MainStreetTurnControllerContext, beforePairs: SynergyPair[]): void {

    const s = tcCtx.scene;
    try {
      const afterPairs = computeSynergyPairs(s.state.streetGrid, s.state.soldSlots ?? [], tcCtx.streetPairDims());
      for (const pair of diffNewSynergyPairs(beforePairs, afterPairs)) {
        s.msAnimator.animateSynergyFormation(pair);
      }
    } catch (_) {
      // presentation-only — ignore
    }
  
}

/**
 * Options for the shared end-of-turn closing presentation primitive
 * ({@link presentTurnClosing}). All fields are optional; the defaults match
 * the condensed competitive closing (text summary + incident reveal + bounded
 * hold).
 */
export interface ClosingPresentationOptions {
  /** Instruction text shown while the closing resolves (before the summary). */
  statusText?: string;
  /** Instruction text shown once the closing completes, before advancing. */
  completionText?: string;
  /** Bounded hold (ms) after the completion text before advancing. */
  holdMs?: number;
  /**
   * When `false`, the incident reveal animation is skipped entirely (e.g. the
   * single-player tutorial keeps its window-safe pacing). Defaults to `true`.
   */
  animateIncident?: boolean;
  /**
   * When `true`, the incident reveal is delegated to the animator even under
   * reduced motion / replay so the animator keeps its own pacing
   * (single-player parity). Defaults to `false`: those modes degrade to the
   * text summary and advance immediately (bounded, never stalls).
   */
  delegateReducedMotionIncident?: boolean;
  /**
   * Deferred-mutation deltas (CG-0MTR72P14000VO6Q) forwarded to the incident
   * reveal so the coin/rep deltas land when the reveal completes; absent for
   * the legacy immediate path.
   */
  pendingDeltas?: PendingEndOfTurnDeltas;
}

/**
 * Builds the one-line closing summary shared by the single-player and
 * competitive flows: the income total and, when one resolved, the incident
 * name. Returns an empty string when there is nothing to report.
 *
 * Text format: `Income: +N coins | Incident: <name>`.
 */
export function closingSummary(result: TurnResult): string {
  const parts: string[] = [];
  if (result.income && result.income.total > 0) {
    parts.push(`Income: +${result.income.total} coins`);
  }
  if (result.incident) {
    parts.push(`Incident: ${result.incident.name}`);
  }
  return parts.join(' | ');
}

/** Sets the scene instruction text, ignoring presentation-only failures. */
function setInstruction(s: any, text: string): void {
  try { s.instructionText?.setText?.(text); } catch { /* presentation-only */ }
}

/** Schedules `cb` after `delayMs` when the scene has a clock, else runs now. */
function scheduleOrRun(s: any, delayMs: number, cb: () => void): void {
  try {
    if (typeof s.time?.delayedCall === 'function') {
      s.time.delayedCall(delayMs, cb);
      return;
    }
  } catch { /* fall through to immediate */ }
  cb();
}

/**
 * Shared end-of-turn closing presentation primitive (MS-0MUYFX7Q2004JQ5R).
 *
 * Both the single-player `finishTurnPresentation` and the competitive
 * `presentCompetitiveClosing` delegate here, so the income summary, incident
 * reveal, end-of-turn text and advance callback cannot drift:
 *
 *  1. optionally sets a `statusText` (e.g. `Resolving end-of-turn effects...`);
 *  2. writes the shared {@link closingSummary} text (income and/or incident);
 *  3. when an incident resolved and animation is enabled, drives the incident
 *     reveal and advances only once its `onComplete` fires (preserving the
 *     deferred-delta window via `options.pendingDeltas`);
 *  4. otherwise advances immediately — reduced motion, replay and headless
 *     modes degrade to text so the day always starts (bounded).
 *
 * The primitive accepts a single-seat closing plus an advance callback; the
 * competitive flow calls it once per game (the per-seat iteration is a
 * separate, later concern). It consumes no RNG and mutates no engine state.
 *
 * @param tcCtx      Scene context (only `scene` is used).
 * @param result     The closing `TurnResult`.
 * @param onComplete Invoked exactly once when the presentation is done.
 * @param options    Presentation options (see {@link ClosingPresentationOptions}).
 */
export function presentTurnClosing(
  tcCtx: MainStreetTurnControllerContext,
  result: TurnResult,
  onComplete: () => void,
  options: ClosingPresentationOptions = {},
): void {

    const s = tcCtx.scene;
    const replay = s.replayMode === true;
    const reducedMotion = s.settingsPanel?.reducedMotion === true;
    const animationsEnabled = !replay && !reducedMotion;
    const delegateIncident =
      animationsEnabled || options.delegateReducedMotionIncident === true;

    if (options.statusText) setInstruction(s, options.statusText);

    // Always show the summary text so reduced motion / replay / headless still
    // receive the feedback (the incident name is part of the summary).
    const summary = closingSummary(result);
    if (summary) setInstruction(s, summary);

    const finish = (): void => {
      if (options.completionText) setInstruction(s, options.completionText);
      if (typeof options.holdMs === 'number' && options.holdMs > 0) {
        scheduleOrRun(s, options.holdMs, onComplete);
      } else {
        onComplete();
      }
    };

    const incident = result.incident;
    if (!incident || options.animateIncident === false || !delegateIncident) {
      finish();
      return;
    }

    const reveal = (): void => {
      try {
        const from = s.msRenderer?.getFrontIncidentCardCenter?.()
          ?? { x: (s.layout?.gameW ?? 0) / 2, y: (s.layout?.gameH ?? 0) / 2 };
        s.msAnimator?.animateIncidentReveal?.({
          cardId: incident.id,
          incidentName: incident.name,
          coinChange: result.incidentCoinChange,
          repChange: result.incidentRepChange,
          from,
          pendingDeltas: options.pendingDeltas,
          onComplete: finish,
        });
      } catch {
        // presentation-only — never let the reveal hang the turn.
        finish();
      }
    };

    // Single-player parity: if the phased income choreography is still
    // running, wait for it to complete before starting the incident reveal so
    // the phases stay distinct and non-overlapping. Bounded by a safety cap so
    // the day can never stall (AC6).
    if (s.incomeCollectionActive) {
      const startAt = (s.time?.now ?? 0) + 16_000;
      const startAfterIncome = (): void => {
        if (s.incomeCollectionActive && (s.time?.now ?? 0) < startAt) {
          scheduleOrRun(s, 250, startAfterIncome);
        } else {
          s.incomeCollectionActive = false;
          reveal();
        }
      };
      startAfterIncome();
    } else {
      reveal();
    }
  
}
