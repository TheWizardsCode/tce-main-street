/**
 * Main Street: Turn Flow
 *
 * Day start, end-turn presentation, game-over, event-choice dialogs, held
 * events, and undo/redo.
 *
 * @module
 */

import { playIllegalFeedback } from './MainStreetTurnControllerUtils';
import { flashError, flashConfirmation } from './MainStreetFeedback';

import { TranscriptStore, autoSaveTranscript } from '@core-engine/transcript';
import type { EventCard } from '../MainStreetCards';
import { playEventCommand, resolveEventChoiceCommand, resolvePiggybackCommand } from '../MainStreetCommands';
import { applyEndOfTurnDeltas, canAffordPiggybackJoinFully, executeWeekStart, findHumanSeatId, finishDeferredEndOfTurn, finishDeferredTurnClosing, piggybackJoinFullyCost, processEndOfTurn, projectPiggybackEventReward, resolvePendingPiggyback } from '../MainStreetEngine';
import type { TurnResult } from '../MainStreetEngine';
import { canPlayEvent } from '../MainStreetMarket';
import { addLog } from '../MainStreetState';
import { finalizeMainStreetTranscript, recordMainStreetEvent } from '../MainStreetTranscript';
import type { TutorialActionType } from '../TutorialFlow';
import { ensureTutorialMarketForUpcomingSteps } from '../TutorialScenario';
import { BrowserLocalStorageAdapter, hasSeenBankingHint, loadTutorialState, markBankingHintShown, saveTutorialState, shouldTriggerBankingHint } from '../TutorialState';
import type { MainStreetTurnControllerContext } from './MainStreetTurnControllerContext';
import { celebrateChallengeIds } from './MainStreetChallengeCelebration';
import { INCOME_COLLECTION_CAP_MS } from './MainStreetAnimatorTiming';
import { presentTurnClosing } from './MainStreetTurnControllerAnimation';
import { buildTurnSummary } from './MainStreetTurnSummary';
import { initDisplayedTotals } from './MainStreetAnimatorContext';
import {
  continueCompetitiveDayAfterPiggyback,
  endCompetitiveTurnDay,
  humanSeatPiggybackPending,
  isCompetitiveState,
  startCompetitiveDay,
} from './MainStreetTurnControllerCompetitive';

export function startTurnPhase(tcCtx: MainStreetTurnControllerContext, skipMarketRefill: boolean = false, suppressWeekBanner: boolean = false): void {
    // A new day begins: reset the per-turn celebrated-challenge set so this
    // turn can celebrate its own completions (CG-0MU8MZBV4007HF1Q).
    try { tcCtx.scene.celebratedChallengeIds?.clear(); } catch (_) { /* ignore */ }

    const s = tcCtx.scene;
    // Execute WeekStart (optionally refills market, transitions to MarketPhase)
    if (isCompetitiveState(s.state)) {
      // Competitive shared day: per-seat action budgets + human seat binding.
      startCompetitiveDay(s.state, skipMarketRefill);
    } else {
      executeWeekStart(s.state, skipMarketRefill);
    }
    // Staff applicant walk-on (CG-0MSTOATDU006UGAX): if a pending applicant
    // arrived at WeekStart the player must resolve it (hire or decline).
    s.pendingApplicant = (s.state as any).pendingApplicant ?? null;
    s.uiPhase = (s.pendingApplicant != null) ? 'applicant' : 'market';
    // A new day means no card is "just moved" anymore — any hand card
    // selected now costs an action to place (CG-0MSXIQIPJ000NDTL).
    s.justMovedHandCardId = null;

    // Tutorial: the single-row market only holds 3 cards, so force the
    // upcoming steps' required purchase targets into the line (days 2+).
    const weekStartTut = (s as any).tutorialController as any;
    if (weekStartTut?.isActive) {
      try {
        ensureTutorialMarketForUpcomingSteps(s.state, weekStartTut);
      } catch (_) {
        // robustness — never block day start on scenario bookkeeping
      }
    }

    // Reset the scene-carried banking-hint arm: each new day opens a fresh
    // presentation window; a hint left armed by a game-over closing must not
    // leak into the next playthrough (MS-0MV79JQ4H003E6BH).
    (s as any).pendingBankingHint = false;

    s.refreshAll();

    // A new turn begins: clear the previous crowd and let a fresh set wander
    // onto the street from the block corners (MS-0MUZ4WB290024ZGQ).
    // Presentation-only; a failure must never stall the turn.
    try { s.msPedestrians?.startNewTurn?.(); } catch (_) { /* presentation-only */ }

    // Day transition banner: non-interactive "Week W · Year Y" reveal at the board
    // centre (skipped under reduced motion / replay — handled inside the
    // animator). Skipped while the tutorial is active (its step overlays
    // carry the guidance), on checkpoint resume (skipMarketRefill — the
    // same day continues, so it is not a new-day transition), or when
    // suppressed at boot (suppressWeekBanner — deferred until the player
    // commits to playing).
    const tutController = (s as any).tutorialController as { isActive?: boolean } | undefined;
    if (!skipMarketRefill && !suppressWeekBanner && !tutController?.isActive) {
      try { s.msAnimator.animateWeekBanner({ turn: s.state.turn, week: s.state.week, year: s.state.year }); } catch (_) { /* presentation-only — ignore */ }
    }
    void s.cardSvgLoadPromise
      .then(() => s.prewarmVisibleCardTextures())
      .then(() => {
        try {
          s.refreshAll();
          // Market deal-in animation: the final refresh is the one the player
          // sees, so animate after it. Skipped on checkpoint resume
          // (skipMarketRefill) where the market is preserved, not refilled.
          if (!skipMarketRefill) {
            tcCtx.animateMarketDealIn('market');
          }
        } catch {
          // scene may be shutting down
        }
      });


  
}

export function endTurn(tcCtx: MainStreetTurnControllerContext): void {

    const s = tcCtx.scene;
    // Competitive shared day: the human's End Turn closes their MarketPhase,
    // then the AI seats are driven to the shared closing. Single-player keeps
    // the legacy processEndOfTurn path below byte-for-byte.
    if (isCompetitiveState(s.state)) {
      endCompetitiveTurnDay(tcCtx);
      return;
    }
    // Tutorial gating: only allow end-turn if it's the required action or tutorial is inactive
    const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('end-turn' as TutorialActionType);
    if (check && !check.allowed) {
      flashError(s, check.reason ?? 'Complete the highlighted step first.');
      playIllegalFeedback(s.actionContainer, s);
      return;
    }

    s.uiPhase = 'animating';
    s.refreshActionButtons();

    // ── Banking hint trigger (MS-0MT3JK16W006A66P) ────────────────
    // Contextual one-shot hint: the first time the player ends a turn with
    // at least one unused action (a bankable action) and the hint has not
    // yet been shown, remember the candidate and fire the HUD-highlighting
    // hint AFTER the non-blocking `processEndOfTurn` runs. The trigger is
    // not scoped to the tutorial: it fires both during and after the
    // tutorial, so a player who never banks during the scripted run still
    // sees the lesson the first time they bank in normal play (producer
    // clarification 2026-10-13). The flag is persisted via TutorialState so
    // a restart does not replay it; legacy saves default to "not shown"
    // (AC2).
    //
    // When the hint fires mid-tutorial the end-turn step completion is
    // deferred (see `finishTurnPresentation`) so the hint overlay can be
    // dismissed back into the flow instead of dead-ending it.
    let pendingBankingHint = false;
    try {
      const ts = loadTutorialState(new BrowserLocalStorageAdapter());
      if (
        shouldTriggerBankingHint({
          actionsRemaining: s.state.actionsRemaining,
          alreadyShown: hasSeenBankingHint(ts),
        })
      ) {
        pendingBankingHint = true;
        // The one-shot flag is NOT persisted here: persistence happens only
        // when the hint is actually presented (`advanceTurn`). Persisting at
        // end-turn consumed the hint even on turns that pause for an event
        // choice (the overlay is deferred past the dialog) — the flag was set
        // but the overlay never shown, silently muting the lesson for the
        // rest of the playthrough (MS-0MV79JQ4H003E6BH).
      }
    } catch { /* banking hint trigger must never block the turn */ }
    // Carry the armed hint on the scene across the closing presentation so a
    // choice-dialog pause cannot lose it (`onEventChoice` re-reads it).
    (s as any).pendingBankingHint = pendingBankingHint;

    // Process end-of-turn phases (events, income, night, end check)
    // Applicant auto-decline at end-of-turn (CG-0MSTOATDU006UGAX AC6):
    // walk the unresolved card off to the right and clear the scene state.
    // Doing it before processEndOfTurn's own decline guard covers both the
    // immediate scene visuals (animated departure) and the engine fallback.
    try {
      if (s.pendingApplicant != null) {
        const cardW = (s as any).layout?.handCardW ?? 120;
        const cardH = (s as any).layout?.handCardH ?? 170;
        const overlay = (s as any).applicantOverlayContainer as Phaser.GameObjects.Container | null;
        const reducedMotion = (s as any).settingsPanel?.reducedMotion;
        // Clear the scene-side applicant immediately; `processEndOfTurn`
        // clears the engine-side `state.pendingApplicant`.
        s.pendingApplicant = null;
        if (overlay && s.msAnimator) {
          // Guard the overlay from the refreshApplicant teardown while the
          // exit tween plays, then destroy it on completion.
          (s as any).applicantAnimating = true;
          s.msAnimator.animateApplicantWalkOff(overlay, cardW, cardH, reducedMotion, () => {
            (s as any).applicantAnimating = false;
            (s as any).clearApplicantOverlay?.();
          });
        } else {
          (s as any).clearApplicantOverlay?.();
        }
      }
    } catch { /* applicant cleanup never blocks end-turn */ }

    let result: TurnResult;
    // ── Deferred HUD window (CG-0MTR72P14000VO6Q) ─────────────
    // Capture the pre-animation resource values so the HUD keeps showing
    // them while the income/incident animations play; the deltas land only
    // when the closing presentation completes. Reset the exactly-once
    // application guard (set by the income/incident animation completions
    // or the closing finalizer).
    s.previousCoins = s.state.resourceBank.coins;
    s.previousReputation = s.state.resourceBank.reputation;
    s.endOfTurnDeltasApplied = false;
    // Display-only running totals (MS-0MUYAESVU007X2U8): reset here and only
    // initialise below in the deferred animation path, so reduced-motion /
    // tutorial / replay keep the existing instant-final behaviour.
    s.displayedCoins = null;
    s.displayedReputation = null;
    s.displayedIncomeCounted = false;
    try {
      // Deferred-mutation mode: normal interactive play defers the resource
      // application until the end-of-turn animations complete. Tutorial and
      // reduced-motion keep the legacy immediate path (no animation-window
      // pacing regressions); replay never mutates state.
      const reducedMotion = (s as any).settingsPanel?.reducedMotion === true;
      const inTutorialBefore =
        (s as { tutorialController?: { isActive?: boolean } }).tutorialController?.isActive === true;
      const deferred = !inTutorialBefore && !reducedMotion && !s.replayMode;
      if (deferred) {
        // Open the display-only counters at the pre-reconciliation values so
        // the HUD counts from the captured total as flights land/depart.
        initDisplayedTotals(s, s.previousCoins, s.previousReputation);
      }
      result = processEndOfTurn(
        s.state,
        deferred ? { deferResourceApplication: true } : undefined,
      );
    } catch (e) {
      // Defensive: if processEndOfTurn throws (e.g. phase mismatch from
      // async state replacement), recover gracefully instead of hanging
      // with a permanent "Processing end of turn..." message.
      console.error('[MainStreet] endTurn failed:', e);
      s.uiPhase = 'market';
      flashError(s, `Error: ${(e as Error).message}`);
      s.refreshAll();
      return;
    }

    // ── Pedestrian end-of-turn exit ────────────────────────────────
    // The crowd does not vanish at the end of the day: figures that are not
    // spending walk off the block during the end phase, and enough figures
    // walk into occupied shops to source the reputation income
    // (MS-0MUZ6CGSV002WTYM). Presentation-only; never blocks the turn.
    try { s.msPedestrians?.beginEndOfTurn?.(); } catch (_) { /* presentation-only */ }

    // ── Income Phase Animation ──────────────────────────────────────
    // Presentation-only VFX (AGENTS.md rule 8 + epic CG-0MT23O6W8003AXWJ):
    // the phased income show — base → synergy → reputation → events →
    // upcoming → grid-to-HUD collection — runs when the turn ends
    // with producing slots. Empty phases are skipped
    // (MS-0MUYT436C005B4QN), so the show length is the sum over scheduled
    // phases only. `scene.incomeCollectionActive` gates the HUD
    // delta pop and defers the street refresh + day start below so the
    // on-card coin grids survive the whole choreography. Never mutates
    // state or the transcript; failures are swallowed so the turn always
    // advances. Reduced-motion and replay/headless modes are handled
    // inside the animator (text-only progression / no-op).
    // Tutorial exemption: the tutorial keeps the compact window-safe
    // collection (`animateIncomeCollection`) so tutorial step pacing is
    // unchanged — precedent: the day banner is also skipped during the
    // tutorial (startTurnPhase); the full phased show runs in normal play.
    try {
      const inTutorial = (s as { tutorialController?: { isActive?: boolean } }).tutorialController?.isActive === true;
      const phaseBreakdown = result.income?.phaseBreakdown?.perSlotBreakdown ?? [];
      if (inTutorial) {
        if (result.income && result.income.total > 0) {
          const grid: Array<{ currentReputationPerTurn?: number } | null> = s.state.streetGrid ?? [];
          const repSources = grid
            .map((card, slotIndex) => ({ slotIndex, rep: card?.currentReputationPerTurn ?? 0 }))
            .filter((src) => src.rep > 0);
          s.msAnimator.animateIncomeCollection({
            income: result.income,
            repSources,
          });
        }
      } else if (phaseBreakdown.length > 0) {
        // Pass the pending deltas so the collection completion applies them
        // exactly once (CG-0MTR72P14000VO6Q); legacy mode passes nothing.
        s.msAnimator.animateIncomePhases(
          phaseBreakdown,
          result.requiresDeferredClosing === true ? { pendingDeltas: result } : undefined,
        );
      }
    } catch (_) {
      // Presentation-only: never block the turn on animation failures.
      s.incomeCollectionActive = false;
    }

    // Save checkpoint after each completed turn (fire-and-forget). In the
    // deferred-mutation path (CG-0MTR72P14000VO6Q) the closing tail (day
    // advance) runs only after the animations complete — persisting here
    // would capture a mid-animation state with un-applied deltas, so the
    // checkpoint is written in finalizeTurn instead (after the closing).
    if (result.requiresDeferredClosing !== true) {
      try { tcCtx.onSaveCheckpoint?.(); } catch (e) { /* ignore */ }
    }

    // Clear undo stack on end-of-turn (per acceptance criteria)
    try { s.undoManager.clear(); } catch (e) { /* ignore */ }
    // Undo/redo are per-turn only; after the clear neither action is
    // available, so both HUD buttons must show their disabled state
    // (CG-0MT5Y4DL8000AKKZ).
    s.refreshUndoRedoButtons(false, false);

    // ── Challenge Celebration VFX & Sound ────────────────────────
    // Celebrate only challenges not already celebrated mid-turn: the
    // per-action evaluation fires the celebration as soon as the completing
    // action lands (CG-0MU8MZBV4007HF1Q). celebrateChallengeIds dedupes
    // against `s.celebratedChallengeIds`, so the end-of-turn pass only fires
    // for closing-phase (Income / Incident) completions and never for an
    // already-celebrated mid-turn completion.
    if (result.newlyCompletedChallenges.length > 0) {
      celebrateChallengeIds(s, result.newlyCompletedChallenges);
    }

    // Brief delay then show result / advance
    tcCtx.finishTurnPresentation(result, pendingBankingHint);
  
}

export function finishTurnPresentation(tcCtx: MainStreetTurnControllerContext, 
    result: TurnResult,
    pendingBankingHint: boolean,
  ): void {

    const s = tcCtx.scene;
    if (result.choicePending) {
      // Deferred mode: the income deltas must land when the turn pauses (the
      // Accept/Reject dialog blocks the closing). Apply now if the income
      // animation's completion hasn't already (idempotent guard) so the
      // paused turn's income matches the legacy UX (income lands at pause).
      if (result.requiresDeferredClosing === true && !s.endOfTurnDeltasApplied) {
        try {
          applyEndOfTurnDeltas(s.state, result);
          s.endOfTurnDeltasApplied = true;
        } catch { /* presentation-only */ }
      }
      tcCtx.presentEventChoiceDialog();
      return;
    }

    // Deferred-mutation mode (CG-0MTR72P14000VO6Q): when the result requires
    // the deferred closing, `gameResult` / `finalScore` are pre-turn values —
    // the game-over evaluation happens in finalizeTurn AFTER the animations
    // complete and the deltas land (AC4: no banner mid-animation). The legacy
    // immediate branch below is for reduced-motion / tutorial / replay and the
    // dual-choice resolution path (already-final results).
    const deferred = result.requiresDeferredClosing === true;
    if (result.gameResult !== 'playing' && !deferred) {
      tcCtx.handleGameOver(result);
      return;
    }

    // The income/incident summary text is set by the shared closing
    // presentation primitive below, so the single-player and competitive
    // flows cannot drift (MS-0MUYFX7Q2004JQ5R).
    // While the phased income show runs, the street cards host the
    // on-card coin grids (child 2); refresh everything EXCEPT the
    // street so those grids survive until collection completes, then
    // refresh fully once the choreography finishes.
    // Defer log rendering until after startTurnPhase has displayed
    // upcoming cards (MS-0MURBOD2E009SOM2). The deferred flag suppresses
    // the log render; it is cleared in finalizeTurn after startTurnPhase,
    // and reset unconditionally by createScene() on every scene creation so
    // an interrupted closing cannot leave the log blank across a restart
    // (MS-0MV14JDUG000E1V6).
    s.logDeferredUntilPhaseComplete = true;
    if (s.incomeCollectionActive) {
      s.msRenderer.refreshAllExceptStreet();
    } else {
      s.refreshAll();
    }

    // Tutorial: mark end-turn step complete if active. Unchanged — the
    // step completes when the turn action resolves, not when the
    // closing presentation finishes. However, if a banking hint is pending
    // during the tutorial, defer step completion until the hint is dismissed
    // (MS-0MT3JK16W006A66P) — the hint overlay advances the tutorial on
    // dismiss so the player is not left stuck on an untaught step.
    const inTutorialWithBankingHint =
      pendingBankingHint &&
      (s as { tutorialController?: { isActive?: boolean } }).tutorialController?.isActive === true;
    if (!inTutorialWithBankingHint) {
      (s.msLifecycleManager as any).onTutorialActionComplete?.('end-turn' as TutorialActionType);
    }

    // ── Closing presentation → day start ─────────────────────────
    // Advance the day once the closing presentation is done: present
    // the banking hint (if any), then defer to the phased income show
    // (bounded) or the normal ~800ms schedule.
    // Lift the log-render deferral and render every entry accumulated during
    // closing (MS-0MURBOD2E009SOM2). Called after the upcoming/phase UI has
    // been displayed — or, on game-over, before the overlay so the log never
    // stays suppressed. Safe to call more than once.
    const flushDeferredLog = (): void => {
      s.logDeferredUntilPhaseComplete = false;
      try { s.refreshLog(); } catch { /* presentation-only */ }
    };
    const advanceTurn = (): void => {
      // ── Banking hint presentation (CG-0MT3JK16W006A66P) ─────
      // Non-blocking HUD-highlighting overlay, once per playthrough. Fires
      // after the turn's gated step has advanced so it does not
      // compete with the step's own overlay. Never blocks the day
      // start. The one-shot flag is persisted HERE, at actual presentation,
      // so an end-turn that never reaches this point (event-choice pause /
      // game-over) does not consume the hint (MS-0MV79JQ4H003E6BH).
      if (pendingBankingHint) {
        try {
          const ts = loadTutorialState(new BrowserLocalStorageAdapter());
          if (!hasSeenBankingHint(ts)) {
            void saveTutorialState(new BrowserLocalStorageAdapter(), markBankingHintShown(ts)).catch(() => {});
          }
        } catch { /* hint persistence must never block the closing */ }
        try { (s as any).tutorialOverlay?.showBankingHint?.(); } catch { /* presentation-only */ }
        (s as any).pendingBankingHint = false;
      }
      if (s.incomeCollectionActive) {
        // Bounded deferral: start the next week once the choreography
        // completes (AC7 collect clears the flag); a safety cap forces
        // the day start even if the flag is somehow never cleared, so
        // end-of-turn can never hang the game (AC5).
        const startAt = s.time.now + INCOME_COLLECTION_CAP_MS;
        const startAfterIncomeShow = (): void => {
          if (s.incomeCollectionActive && s.time.now < startAt) {
            s.time.delayedCall(250, startAfterIncomeShow);
          } else {
            s.incomeCollectionActive = false;
            finalizeTurn();
          }
        };
        startAfterIncomeShow();
      } else {
        s.time.delayedCall(800, () => finalizeTurn());
      }
    };

    // ── Deferred closing tail (CG-0MTR72P14000VO6Q) ────────────
    // Runs only after the closing animations complete (income collection
    // and/or incident reveal): applies any remaining deltas (idempotent
    // guard), runs the deferred closing (EndCheck → next week / game-over
    // evaluation), clears the deferred HUD window so refreshHud shows the
    // post-delta values, and either shows the game-over overlay or starts
    // the next week. The legacy path (deferred === false) just starts the
    // day — the closing already ran inside processEndOfTurn.
    const finalizeTurn = (): void => {
      if (deferred) {
        if (!s.endOfTurnDeltasApplied) {
          try {
            applyEndOfTurnDeltas(s.state, result);
            s.endOfTurnDeltasApplied = true;
          } catch { /* presentation-only */ }
        }
        let finalResult: TurnResult;
        try {
          finalResult = finishDeferredTurnClosing(s.state, result);
        } catch (e) {
          // Defensive: never hang the turn on a closing failure.
          console.error('[MainStreet] deferred closing failed:', e);
          finalResult = result;
        }
        // Close the deferred HUD window so refreshHud renders the final
        // post-delta values.
        s.previousCoins = null;
        s.previousReputation = null;
        s.displayedCoins = null;
        s.displayedReputation = null;
        s.incidentRevealActive = false;
        // Defer log rendering until after startTurnPhase has displayed
        // upcoming cards (MS-0MURBOD2E009SOM2).
        s.logDeferredUntilPhaseComplete = true;
        // Render the final post-delta state under the upcoming overlay
        // (startTurnPhase refreshes internally for the continuing path).
        try { s.refreshAll(); } catch { /* presentation-only */ }
        if (finalResult.gameResult !== 'playing') {
          // No upcoming phase — flush the accumulated log alongside the
          // game-over overlay instead of leaving it suppressed.
          flushDeferredLog();
          tcCtx.handleGameOver(finalResult);
          return;
        }
        // Persist the checkpoint now that the turn has fully closed (the
        // deferred end-of-turn path skips the earlier endTurn save so the
        // checkpoint always reflects a complete, applied turn).
        try { tcCtx.onSaveCheckpoint?.(); } catch (e) { /* ignore */ }
        tcCtx.startTurnPhase();
        // Log entries accumulated during closing now render after the
        // phase UI has been displayed (MS-0MURBOD2E009SOM2).
        flushDeferredLog();
      } else {
        tcCtx.startTurnPhase();
        // Clear deferral flag so accumulated log entries render after
        // the phase UI (MS-0MURBOD2E009SOM2).
        flushDeferredLog();
      }
    };

    // Incident reveal presentation (CG-0MTW18KFK000MM3I): the resolved
    // incident card flies from the Upcoming panel to board centre, flips
    // face-up and stays visible for INCIDENT_REVEAL_HOLD_MS so the player can read the
    // incident before the turn advances. The reveal **blocks** the day
    // start until the hold completes (then the normal advance applies).
    //
    // Audit (CG-0MTR766U6003RZ88): phases must be distinct and not overlap.
    // If income collection is still running, wait for it to complete before
    // starting the incident reveal.
    //
    // Tutorial exemption: the tutorial keeps its window-safe step pacing,
    // so the reveal (and its hold) is skipped — the same
    // precedent as the phased income show and the day banner being
    // skipped during the tutorial.
    //
    // If there is no incident, the entire animation is skipped — no
    // delay, no state mutation — and the day advances as before.
    const inTutorial =
      (s as { tutorialController?: { isActive?: boolean } }).tutorialController?.isActive === true;
    // Shared closing presentation primitive (MS-0MUYFX7Q2004JQ5R): the income
    // summary, incident reveal (with the deferred-delta window) and the day
    // advance are driven by one path used by both single-player and
    // competitive. The tutorial keeps its window-safe pacing by skipping the
    // reveal (`animateIncident: false`); reduced motion / replay delegate to the
    // animator so its own pacing is unchanged (`delegateReducedMotionIncident`).
    //
    // The Turn Summary gate (MS-0MVP46Q8X003419R) intercepts the deferred
    // closing: the day no longer advances straight off the animations — the
    // summary dialog is presented first and `advanceTurn` runs only once the
    // player clicks [ Next Turn ]. Reduced-motion / tutorial / replay (already
    // non-deferred) keep the existing auto-advance pacing.
    const afterClosing = shouldGateTurnSummary(tcCtx, result)
      ? () => presentTurnSummaryGate(tcCtx, result, advanceTurn)
      : advanceTurn;
    presentTurnClosing(tcCtx, result, afterClosing, {
      animateIncident: !inTutorial,
      delegateReducedMotionIncident: true,
      pendingDeltas: deferred ? result : undefined,
    });
  
}

/**
 * Whether the Turn Summary dialog gates the deferred closing
 * (MS-0MVP46Q8X003419R, parent AC1/AC4).
 *
 * The dialog is presented only on the deferred single-player closing path:
 *
 *  - `requiresDeferredClosing` — the turn is mid-closing with its deltas
 *    un-applied; the dialog is the gate in front of `finalizeTurn`. Every
 *    legacy/immediate closing (reduced motion, tutorial, replay, the resumed
 *    event-choice tail) already ran its closing and advances untouched.
 *  - replay — headless/replay never presents UI.
 *  - reduced motion — keeps the existing auto-advance pacing (no extra click
 *    to sit through).
 *  - tutorial — keeps its window-safe step pacing.
 *  - competitive — operator decision (parent AC4): competitive closings keep
 *    their per-seat closing text (`perSeatClosingSummary`) and never present
 *    the single-player summary dialog.
 */
export function shouldGateTurnSummary(
  tcCtx: MainStreetTurnControllerContext,
  result: TurnResult,
): boolean {
  const s = tcCtx.scene;
  if (result.requiresDeferredClosing !== true) return false;
  if (s.replayMode === true) return false;
  if (s.settingsPanel?.reducedMotion === true) return false;
  if ((s as { tutorialController?: { isActive?: boolean } }).tutorialController?.isActive === true) {
    return false;
  }
  try {
    if (isCompetitiveState(s.state)) return false;
  } catch {
    // Defensive: an unreadable state keeps the legacy pacing (never stall).
    return false;
  }
  return true;
}

/**
 * Presents the Turn Summary dialog and resumes the deferred closing on
 * [ Next Turn ] (MS-0MVP46Q8X003419R, parent AC1–AC3).
 *
 * Runs where `advanceTurn` used to: after the closing animations completed.
 *
 *  1. Applies any outstanding deferred deltas under the scene's
 *     `endOfTurnDeltasApplied` exactly-once guard (AC3) — the income/incident
 *     animation completions normally got there first, so this is a no-op
 *     there, and `finalizeTurn`'s own guard covers the rest.
 *  2. Builds the dialog content through the Phaser-free
 *     {@link buildTurnSummary} model from the committed ledger.
 *  3. Delegates to `scene.showTurnSummaryDialog`, whose `onNextTurn` callback
 *     is `advanceTurn` — so the banking hint, the income-collection wait and
 *     `finalizeTurn` all run after the dialog is dismissed (AC2/AC5).
 *
 * Never stalls: a result without a ledger (competitive / hand-built), a
 * failing model build or a scene without dialog support advances immediately,
 * matching the previous pacing.
 */
export function presentTurnSummaryGate(
  tcCtx: MainStreetTurnControllerContext,
  result: TurnResult,
  onNextTurn: () => void,
): void {
  const s = tcCtx.scene;

  // AC3: the panel renders the committed post-delta turn, applied once.
  const show = (): void => {
    if (!s.endOfTurnDeltasApplied) {
      try {
        applyEndOfTurnDeltas(s.state, result);
        s.endOfTurnDeltasApplied = true;
      } catch { /* presentation-only — the closing finalizer re-guards */ }
    }

    let summary: ReturnType<typeof buildTurnSummary> = null;
    try {
      summary = buildTurnSummary(s.state, result);
    } catch { /* presentation-only — never strand the closing */ }

    if (!summary || typeof s.showTurnSummaryDialog !== 'function') {
      // No ledger (competitive-shaped / hand-built result) or no overlay
      // surface (headless) — keep the previous advance behaviour.
      onNextTurn();
      return;
    }

    s.showTurnSummaryDialog(summary, onNextTurn);
  };

  // AC1: the dialog appears after ALL end-of-turn animations complete. The no-
  // incident presentation completes before the phased income collection has
  // finished collecting, so wait for the choreography (bounded by the same
  // safety cap as `advanceTurn`) before rendering; the incident-reveal path
  // already waited for collection inside `presentTurnClosing`. A clock-less
  // scene (headless) proceeds immediately.
  if (s.incomeCollectionActive && typeof s.time?.delayedCall === 'function') {
    const startAt = (s.time?.now ?? 0) + INCOME_COLLECTION_CAP_MS;
    const waitForIncome = (): void => {
      if (s.incomeCollectionActive && (s.time?.now ?? 0) < startAt) {
        s.time.delayedCall(250, waitForIncome);
      } else {
        s.incomeCollectionActive = false;
        show();
      }
    };
    waitForIncome();
  } else {
    show();
  }
}

export function handleGameOver(tcCtx: MainStreetTurnControllerContext, result: TurnResult): void {

    const s = tcCtx.scene;
    // Snapshot tiers before the campaign update mutates them
    const tiersBefore = s.campaign
      ? [...s.campaign.unlockedTiers]
      : [];

    // Update campaign progress (tier evaluation + persistence),
    // then compute newly unlocked tiers and show the overlay.
    // Auto-save transcript to browser storage (fire-and-forget)
    const transcript = finalizeMainStreetTranscript({
      gameResult: result.gameResult,
      finalScore: result.finalScore,
    });
    if (transcript) {
      const transcriptStore = new TranscriptStore();
      autoSaveTranscript(transcriptStore, 'main-street', transcript, '[MainStreet]');
    }

    // Update standalone player statistics (fire-and-forget, independent
    // of campaign progress update). Guarded against replay mode internally
    // by the lifecycle manager.
    s.updateStats(result.gameResult, result.finalScore);

    // Clear checkpoint on game end
    try { tcCtx.onGameEnd?.(); } catch (e) { /* ignore */ }
    s.updateCampaignProgress().then(() => {
      const tiersAfter = s.campaign
        ? s.campaign.unlockedTiers
        : [];
      const newlyUnlockedTiers = tiersAfter.filter(
        (t: any) => !tiersBefore.includes(t),
      );
      s.showGameOverOverlay(result, newlyUnlockedTiers);
    });
  
}

export function presentEventChoiceDialog(tcCtx: MainStreetTurnControllerContext): void {

    const s = tcCtx.scene;
    const pending = s.state.pendingEventChoice;
    if (!pending || pending.resolved) return; // nothing to decide

    // Tutorial regression guard (CG-0MTT7FO7I009295E AC2): the tutorial
    // scenario deck excludes choice events by construction, but if one were
    // ever drawn in tutorial mode, auto-accept so the tutorial never hangs
    // waiting for dialog input (no teaching step exists — producer decision
    // 2026-09-08 Q2).
    const tutController = (s as { tutorialController?: { isActive?: boolean } }).tutorialController;
    if (tutController?.isActive) {
      tcCtx.onEventChoice('accept');
      return;
    }

    const show = (): void => {
      const overlay = s.msOverlayManager as unknown as {
        showEventChoiceDialog?: (e: EventCard, onChoose: (optionIndex: number) => void) => void;
      };
      if (overlay && typeof overlay.showEventChoiceDialog === 'function') {
        overlay.showEventChoiceDialog(
          pending.event,
          (optionIndex) => tcCtx.onEventChoice(optionIndex),
        );
      } else {
        // Defensive fallback: no dialog support — auto-accept so a pending
        // choice can never hang the game loop (regression guard).
        tcCtx.onEventChoice('accept');
      }
    };

    if (s.incomeCollectionActive) {
      // Bounded deferral: present once the income choreography completes; a
      // safety cap forces the dialog even if the flag is never cleared, so a
      // pending choice can never hang the game (AC5).
      const startAt = s.time.now + INCOME_COLLECTION_CAP_MS;
      const waitForIncome = (): void => {
        if (s.incomeCollectionActive && s.time.now < startAt) {
          s.time.delayedCall(250, waitForIncome);
        } else {
          s.incomeCollectionActive = false;
          show();
        }
      };
      waitForIncome();
    } else {
      show();
    }
  
}

export function onEventChoice(tcCtx: MainStreetTurnControllerContext, option: string | number): void {

    const s = tcCtx.scene;
    const pending = s.state.pendingEventChoice;
    if (!pending || pending.resolved) return;
    const event = pending.event;
    try {
      // Resolve via the snapshot-based undoable command so the choice can be
      // undone back to the unresolved pending state (AC10
      // CG-0MTSHG8RP008E128 — escalation removed, resources restored). Runs
      // through the undo manager when one is present.
      const coinsBefore = s.state.resourceBank.coins;
      const repBefore = s.state.resourceBank.reputation;
      const deckBefore = s.state.incidentDeck.length;
      const choiceCmd = resolveEventChoiceCommand(s.state, option);
      if (s.undoManager) s.undoManager.execute(choiceCmd);
      else choiceCmd.execute();
      // Re-derive the consequence from the state diff (the command hides the
      // engine resolution result): resource deltas + the pushed escalation.
      const coinChange = s.state.resourceBank.coins - coinsBefore;
      const repChange = s.state.resourceBank.reputation - repBefore;
      const pushedCard =
        s.state.incidentDeck.length === deckBefore + 1
          ? s.state.incidentDeck[s.state.incidentDeck.length - 1]
          : null;
      void pushedCard;
      flashConfirmation(s, 
        typeof option === 'number'
          ? `${event.name}: chose option ${option + 1}.`
          : `${event.name}: consequence ${option === 'accept' ? 'accepted' : 'refused'}.`,
      );
      // Complete the deferred closing (EndCheck → next week) and present it.
      const finalResult = finishDeferredEndOfTurn(s.state);
      // The turn is now closed — the undo stack is cleared (mirrors the
      // normal end-of-turn clear) so a choice cannot be undone after the day
      // advanced (undo would resurrect the pending choice mid-market).
      try { s.undoManager?.clear(); } catch (_) { /* ignore */ }
      // Stacks are empty again — disable both HUD buttons
      // (CG-0MT5Y4DL8000AKKZ).
      s.refreshUndoRedoButtons(false, false);
      // Visual consequence for resource deltas (applied effect), mirroring
      // the standard incident reveal. Reject applies nothing — the
      // instruction text above is the only feedback. The reveal blocks the
      // day start until its hold completes (CG-0MTW18KFK000MM3I).
      const present = (): void => {
        // The turn paused on an event-choice dialog before the banking hint
        // could be presented — carry the still-armed hint into the resumed
        // closing so it is not silently swallowed (MS-0MV79JQ4H003E6BH).
        const pendingHint = (s as any).pendingBankingHint === true;
        (s as any).pendingBankingHint = false;
        tcCtx.finishTurnPresentation(finalResult, pendingHint);
      };
      if (coinChange !== 0 || repChange !== 0) {
        try {
          s.msAnimator.animateIncidentReveal({
            cardId: event.id,
            incidentName: event.name,
            coinChange,
            repChange,
            from: s.msRenderer.getFrontIncidentCardCenter(),
            onComplete: present,
          });
        } catch (_) {
          // presentation-only — never let the reveal hang the turn.
          present();
        }
      } else {
        present();
      }
    } catch (e) {
      // Resolution failed (should not happen in normal flow): recover by
      // returning to the market instead of hanging on a dead dialog.
      console.error('[EventChoice] resolve failed:', e);
      s.uiPhase = 'market';
      flashError(s, `Error: ${(e as Error).message}`);
      s.refreshAll();
    }
  
}

export function presentPiggybackDialog(tcCtx: MainStreetTurnControllerContext): void {

    const s = tcCtx.scene;
    const state = s.state;
    // The closing pauses only when the HUMAN seat holds an unresolved
    // piggyback decision (F5 of MS-0MUYC47EL005Z69H). Nothing to present
    // otherwise.
    if (!state.pendingPiggyback || !humanSeatPiggybackPending(state)) return;
    const humanId = findHumanSeatId(state);
    if (humanId < 0) return;
    const decision = state.pendingPiggyback.decisions.find(
      (d: { seatId: number; resolved: boolean }) => d.seatId === humanId && !d.resolved,
    );
    if (!decision) return;

    // Exact prompt data (AC1): the 150% charge and the 100%/50% own-board
    // reward projections, computed through the same helpers the engine and AI
    // policy use so the prompt can never disagree with the application path.
    const charge = piggybackJoinFullyCost(decision.paidCost);
    const affordable = canAffordPiggybackJoinFully(state, humanId, decision.paidCost);
    const fullReward = projectPiggybackEventReward(state, decision.event, humanId, 1);
    const halfReward = projectPiggybackEventReward(state, decision.event, humanId, 0.5);

    // Tutorial/hud regression guard (mirrors `presentEventChoiceDialog`): a
    // headless tutorial can never hang waiting for dialog input — keep the
    // automatic free-ride.
    const tutController = (s as { tutorialController?: { isActive?: boolean } }).tutorialController;
    if (tutController?.isActive) {
      tcCtx.onPiggybackChoice(false);
      return;
    }
    // Replay/headless guard: the competition overlay is never presented in
    // replay, so resolve the decision headlessly (keep the automatic
    // free-ride) — a replay can never hang on the interactive prompt.
    if (s.replayMode === true) {
      tcCtx.onPiggybackChoice(false);
      return;
    }

    const show = (): void => {
      const overlay = s.msOverlayManager as unknown as {
        showPiggybackDialog?: (
          info: {
            event: EventCard;
            charge: number;
            affordable: boolean;
            fullReward: { coins: number; reputation: number };
            halfReward: { coins: number; reputation: number };
          },
          onJoin: () => void,
          onKeep: () => void,
        ) => void;
      };
      if (overlay && typeof overlay.showPiggybackDialog === 'function') {
        overlay.showPiggybackDialog(
          { event: decision.event, charge, affordable, fullReward, halfReward },
          () => tcCtx.onPiggybackChoice(true),
          () => tcCtx.onPiggybackChoice(false),
        );
      } else {
        // Defensive fallback: no dialog support — keep the free-ride so a
        // pending decision can never hang the game loop (regression guard).
        tcCtx.onPiggybackChoice(false);
      }
    };

    if (s.incomeCollectionActive) {
      // Bounded deferral: present once the income choreography completes; a
      // safety cap forces the dialog even if the flag is never cleared, so a
      // pending decision can never hang the game.
      const startAt = s.time.now + INCOME_COLLECTION_CAP_MS;
      const waitForIncome = (): void => {
        if (s.incomeCollectionActive && s.time.now < startAt) {
          s.time.delayedCall(250, waitForIncome);
        } else {
          s.incomeCollectionActive = false;
          show();
        }
      };
      waitForIncome();
    } else {
      show();
    }
  
}

export function onPiggybackChoice(tcCtx: MainStreetTurnControllerContext, join: boolean): void {

    const s = tcCtx.scene;
    const state = s.state;
    const humanId = findHumanSeatId(state);
    if (humanId < 0) return;
    const decision = state.pendingPiggyback?.decisions.find(
      (d: { seatId: number; resolved: boolean }) => d.seatId === humanId && !d.resolved,
    );
    if (!decision) return; // nothing to decide
    try {
      // Resolve via the snapshot-based undoable command so the decision can
      // be undone back to the unresolved pending state (AC1). Runs through
      // the undo manager when one is present.
      const cmd = resolvePiggybackCommand(state, humanId, join);
      if (s.undoManager) s.undoManager.execute(cmd);
      else cmd.execute();
      flashConfirmation(s, 
        join ? 'Joined the event fully — 100% share earned!' : 'Kept the automatic 50% share.',
      );
    } catch (e) {
      // Resolution failed (should not happen in normal flow): recover by
      // keeping the free-ride so the day never stalls on a dead prompt.
      console.error('[Piggyback] resolve failed:', e);
      try { resolvePendingPiggyback(state, humanId, false); } catch (_) { /* ignore */ }
      flashError(s, `Error: ${(e as Error).message}`);
      s.refreshAll();
    }
    // Continue the shared day: settle any remaining seats (AI via the F4
    // policy), finish the deferred closing and present it — the day never
    // stalls (AC3).
    continueCompetitiveDayAfterPiggyback(tcCtx);
    // The decision closed out this shared day; clear the per-turn undo stack
    // (mirrors `onEventChoice`'s deferred-closing clear) so the piggyback
    // resolution cannot be undone after the day advanced — undo would
    // resurrect the pending decision mid-next-market. The command itself
    // remains snapshot-undoable at the command layer (AC1).
    try { s.undoManager?.clear(); } catch (_) { /* ignore */ }
    try { s.refreshUndoRedoButtons?.(false, false); } catch (_) { /* ignore */ }
  
}

export function onPlayHeldEvent(tcCtx: MainStreetTurnControllerContext, handIndex?: number): void {
    const s = tcCtx.scene;
    // Allow both the one-click market path and the select-then-act
    // `event-selected` phase (CG-0MUEQ1BF000770B3).
    if (s.uiPhase !== 'market' && s.uiPhase !== 'event-selected') return;
    // Tutorial gating: only allow play-event if it's the required action or
    // the tutorial is inactive (T23 "Triggering Events" uses this gate).
    const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('play-event' as TutorialActionType);
    if (check && !check.allowed) {
      flashError(s, check.reason ?? 'Complete the highlighted step first.');
      playIllegalFeedback(s.actionContainer, s);
      return;
    }

    // Resolve the event card to play: an explicit hand index (from clicking a
    // specific event card in the merged hand) or the first event in the hand.
    const hand = s.state.hand ?? [];
    let index = handIndex;
    if (index === undefined) {
      index = hand.findIndex((c: any) => c.family === 'event');
    }
    if (index === undefined || index < 0 || index >= hand.length) return;
    const card = hand[index];
    if (card.family !== 'event') return;

    // Pre-flight legality (MS-0MUUYGUVB009QOP6): reject an illegal event play
    // BEFORE the command runs, so the player gets immediate feedback with no
    // action/coin mutation even though the command layer also restores on
    // throw. Mirrors the command's own affordability/action/timing checks.
    const legality = canPlayEvent(s.state, index);
    if (!legality.legal) {
      const blockedSprite = s.msRenderer?.handView?.getSpriteAt?.(index) as any;
      playIllegalFeedback(blockedSprite ?? s.actionContainer, s);
      flashError(s, legality.reason ?? 'Cannot play this event.');
      return;
    }

    console.debug('[MS] onPlayHeldEvent: attempting PlayEvent', { eventId: card.id, coinsBefore: s.state.resourceBank.coins });

    // Capture the played card's position BEFORE the hand re-renders — the
    // card leaves the hand on `refreshAll`, so its sprite must be read now.
    const handSpriteSprite = s.msRenderer?.handView?.getSpriteAt?.(index) as Phaser.GameObjects.Sprite | undefined;
    const handSprite = handSpriteSprite ? { x: handSpriteSprite.x, y: handSpriteSprite.y } : undefined;
    const playedPos = handSprite;

    let played = false;
    try {
      const cmd = playEventCommand(s.state, index);
      s.undoManager.execute(cmd);
      s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
      played = true;
      // Record action event
      try { recordMainStreetEvent({ type: 'action', turn: s.state.turn, action: { type: 'play-event' }, description: cmd.description }); } catch (_) {}
      try { s.gameEvents?.emit('card:placed', { action: 'play-event', heldEventId: card.id }); } catch (_) {}
      flashConfirmation(s, 'Played held Investment event!');
      addLog(s.state, 'Played held event (via UI)', 'neutral');
      console.debug('[MS] PlayEvent executed', { coinsAfter: s.state.resourceBank.coins });
      // Tutorial: mark play-event step complete if active
      try {
        (s.msLifecycleManager as any).onTutorialActionComplete?.('play-event' as TutorialActionType);
      } catch (_) { /* ignore */ }
      // Select-then-act: clear the event selection once the play succeeds.
      s.pendingHandIndex = null;
      s.uiPhase = 'market';
    } catch (e) {
      const msg = (e as Error).message;
      console.error('[MS] PlayEvent failed', e);
      playIllegalFeedback(handSpriteSprite, s);
      flashError(s, `Error: ${msg}`);
    }

    s.refreshAll();

    // Burst + cheer SFX + event-name pop at the played card's position
    // (only when the play succeeded). Reduced motion / replay handled
    // inside the animator.
    if (played && playedPos) {
      try {
        s.msAnimator.animateEventPlayed({ x: playedPos.x, y: playedPos.y, eventName: card.name });
      } catch (_) { /* presentation-only — ignore */ }
    }
  
}

export function performUndo(tcCtx: MainStreetTurnControllerContext): void {

    const s = tcCtx.scene;
    if (s.uiPhase === 'animating' || s.uiPhase === 'game-over') return;
    if (!s.undoManager || !s.undoManager.canUndo()) return;

    const doUndo = (): void => {
      try {
        const cmd = s.undoManager.undo();
        s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
        addLog(s.state, 'Undo', 'neutral');
        try { if (cmd) recordMainStreetEvent({ type: 'undo', turn: s.state.turn, reversedAction: { description: cmd.description } }); } catch (_) {}
        // Undoing a move-to-hand removes the card from hand, so any tracked
        // "just moved" card is stale (CG-0MSXIQIPJ000NDTL).
        s.justMovedHandCardId = null;
        s.refreshAll();
        // Undo feedback (AGENTS.md rule 8): "Undid: <action>" pop bottom-centre
        // over the hand band + UI click SFX. Reduced motion / replay handled inside the
        // animator; non-blocking, presentation-only.
        if (cmd) {
          try { s.msAnimator?.animateUndoRedo({ action: 'undo', description: cmd.description }); } catch (_) { /* presentation-only — ignore */ }
        }
      } catch (e) {
        console.error('Undo failed:', e);
      }
    };

    // Undo-challenge warning (CG-0MU37CKRR008252I, producer decision Q1=A):
    // if the command about to be undone completed one or more challenges,
    // warn the player before the completions are revoked. "Keep Completed"
    // aborts the undo entirely (no state change); "Undo Anyway" proceeds.
    const pending = typeof s.undoManager.peekUndo === 'function' ? s.undoManager.peekUndo() : undefined;
    const completedIds: string[] = pending?.completedChallengeIds ?? [];
    if (completedIds.length > 0 && typeof s.showUndoChallengeWarningDialog === 'function') {
      const titles = completedIds.map((id: string) => {
        const active = (s.state.activeChallenges ?? []).find(
          (ac: { challenge: { id: string } }) => ac.challenge.id === id,
        );
        return active?.challenge.title ?? id;
      });
      s.showUndoChallengeWarningDialog(titles, doUndo, () => { /* Keep Completed */ });
      return;
    }

    doUndo();
  
}

export function performRedo(tcCtx: MainStreetTurnControllerContext): void {

    const s = tcCtx.scene;
    if (s.uiPhase === 'animating' || s.uiPhase === 'game-over') return;
    if (!s.undoManager || !s.undoManager.canRedo()) return;

    try {
      const cmd = s.undoManager.redo();
      s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
      addLog(s.state, 'Redo', 'neutral');
      try { if (cmd) recordMainStreetEvent({ type: 'redo', turn: s.state.turn, reappliedAction: { description: cmd.description } }); } catch (_) {}
      s.refreshAll();
      // Redo feedback (AGENTS.md rule 8): "Redid: <action>" pop bottom-centre
      // over the hand band + UI click SFX. Reduced motion / replay handled inside the
      // animator; non-blocking, presentation-only.
      if (cmd) {
        try { s.msAnimator?.animateUndoRedo({ action: 'redo', description: cmd.description }); } catch (_) { /* presentation-only — ignore */ }
      }
    } catch (e) {
      console.error('Redo failed:', e);
    }
  
}
