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
import { INCOME_COLLECTION_CAP_MS } from './MainStreetAnimatorTiming';
import type { OwnerIncomeResult, SynergyPair } from '../MainStreetAdjacency';
import type { PendingEndOfTurnDeltas, TurnResult } from '../MainStreetEngine';
import type { MainStreetTurnControllerContext } from './MainStreetTurnControllerContext';
import { flashConfirmation } from './MainStreetFeedback';

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
  /**
   * When provided, overrides the shared {@link closingSummary} income text.
   * Pass an empty string to suppress the summary entirely (e.g. the
   * per-seat closing path replaces the shared host total with per-seat lines).
   */
  incomeSummary?: string;
  /**
   * When `true`, the presentation waits for a phased income choreography
   * (`scene.incomeCollectionActive`) to finish collecting before it writes the
   * completion text and advances, so the animation is never left running in
   * the background while the next day starts. The wait is bounded by
   * {@link incomeCollectionCapMs}. Defaults to `false`; single-player drives
   * its own bounded advance outside the primitive.
   */
  waitForIncomeCollection?: boolean;
  /**
   * Bound (ms) for any deferred income-collection wait: both the incident
   * pre-wait and the {@link waitForIncomeCollection} advance wait. Defaults
   * to {@link INCOME_COLLECTION_CAP_MS} (single-player parity); the
   * competitive closing passes the global closing bound so a large roster
   * can still complete its choreography before the day advances.
   */
  incomeCollectionCapMs?: number;
}

/**
 * Returns the default bound (ms) for any deferred income-collection wait.
 *
 * Single source of truth for the closing primitive's default: consumers that
 * do not pass an explicit {@link ClosingPresentationOptions.incomeCollectionCapMs}
 * defer with this bound. Kept as an exported accessor so unit tests can pin
 * the production default against {@link INCOME_COLLECTION_CAP_MS} without
 * restating the literal value (MS-0MVLINWHE004W4CP).
 */
export function getDefaultIncomeCollectionCapMs(): number {
  return INCOME_COLLECTION_CAP_MS;
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

/**
 * Builds the per-seat closing income summary used by the animated competitive
 * closing (MS-0MUXAQQON006XA6I AC3): one `Player N: +X coins` line per
 * surfaced seat, joined with ` | `. `ownerId` is zero-based in `state.players`,
 * so the display index is `ownerId + 1`.
 *
 * The competitive closing surfaces the authoritative per-owner income (see
 * `applyCompetitiveIncome`); the shared host total can differ from any seat's
 * actual income, so it is deliberately not reported here.
 */
export function perSeatClosingSummary(seats: OwnerIncomeResult[]): string {
  return seats
    .map((seat) => `Player ${seat.ownerId + 1}: +${seat.income.total} coins`)
    .join(' | ');
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

/** Wall-clock reader. Defaults to `Date.now`; injectable for deterministic tests. */
export type WallClock = () => number;

/** One-shot wall timer. Defaults to `setTimeout`; injectable for tests. */
export type WallTimerSchedule = (cb: () => void, delayMs: number) => unknown;

/** Cancels a handle returned by {@link WallTimerSchedule}. Defaults to `clearTimeout`. */
export type WallTimerClear = (handle: unknown) => void;

/** Options for {@link deferUntilIncomeCollected}. */
export interface BoundedDeferralOptions {
  /** Wall-clock source. Defaults to `Date.now`. */
  now?: WallClock;
  /** Wall timer used to enforce the cap. Defaults to `setTimeout`. */
  schedule?: WallTimerSchedule;
  /** Canceller paired with {@link BoundedDeferralOptions.schedule}. Defaults to `clearTimeout`. */
  clear?: WallTimerClear;
  /** Cap in wall-clock ms. Defaults to {@link INCOME_COLLECTION_CAP_MS}. */
  capMs?: number;
  /** Scene-clock re-poll interval in ms. Defaults to 250. */
  pollMs?: number;
}

/** The default wall-clock reader: `Date.now`. */
function defaultWallClock(): number {
  return Date.now();
}

/**
 * The default wall timer: `setTimeout`, `unref`'d where the host supports it.
 *
 * `unref` keeps a pending safety watchdog from holding a Node process open —
 * the watchdog is a last-resort bound, not work the process should stay alive
 * for. Browsers have no `unref`, so the optional call is a no-op there.
 */
function defaultWallSchedule(cb: () => void, delayMs: number): unknown {
  const handle: any = setTimeout(cb, delayMs);
  if (typeof handle?.unref === 'function') handle.unref();
  return handle;
}

/** The default wall-timer canceller: `clearTimeout`. */
function defaultWallClear(handle: unknown): void {
  clearTimeout(handle as any);
}

/**
 * Bounded, **wall-clock enforced** deferral on `incomeCollectionActive`
 * (MS-0MVMKEU2000639TG, decision C).
 *
 * The end-of-turn deferral waits for the phased income choreography to finish
 * collecting before the day advances, bounded by
 * {@link INCOME_COLLECTION_CAP_MS} so end-of-turn can never hang the game
 * (CG-0MTR72P14000VO6Q, AC5/AC7). Two clocks matter here, and they are not
 * interchangeable:
 *
 *  - the **scene clock** (`scene.time`) paces the re-poll. Phaser's `TimeStep`
 *    clamps each frame's delta to `1000 / fps.min` (200 ms by default) and
 *    `Clock.elapsed` advances by that clamped delta, so under rAF starvation a
 *    250 ms `delayedCall` re-poll fires at a fraction of wall-clock speed;
 *  - the **wall clock** (`Date.now`) bounds the wait. It keeps running when no
 *    frame is painted, which is exactly the case a stall bound must cover.
 *
 * Using the scene clock for *both* was the defect: the cap deadline was
 * wall-clock based but only *observed* at clamped poll boundaries, so the
 * forced advance was detected late by the same starvation it exists to bound.
 * This helper keeps the shipped pacing (scene-clock re-polls, so the
 * choreography is still allowed to finish) and adds a wall-clock watchdog that
 * forces completion once the cap has elapsed — even if the page paints
 * nothing at all (backgrounded or hidden document, fully starved rAF).
 *
 * Semantics (identical at every deferral site):
 *
 *  1. `isPending()` is re-checked on the scene clock every `pollMs`;
 *  2. when it reads `false`, the deferral completes immediately and the wall
 *     watchdog is cancelled — the normal fast path is unchanged;
 *  3. when the wall clock reaches `capMs`, the deferral is forced: the flag is
 *     cleared, the watchdog is cancelled, and `onComplete` runs;
 *  4. a scene with no clock (headless) cannot poll, so `onComplete` runs at
 *     once — parity with {@link scheduleOrRun};
 *  5. a stale watchdog never fires into a destroyed scene (`isActive()` false)
 *     and never throws out of the timer callback;
 *  6. `onComplete` runs **exactly once**, whichever path wins.
 *
 * Accepted, documented semantic change (producer Q2 = 1): because the bound is
 * wall clock, a hidden or backgrounded document now forces the advance after
 * the cap instead of stalling until the tab paints again. That is the intended
 * meaning of a stall bound — nothing is visible while hidden, and the previous
 * behaviour was an unbounded stall rather than a bound.
 *
 * @param s          Scene exposing `incomeCollectionActive` (`isActive()` read
 *                   when present).
 * @param onComplete Continuation invoked exactly once (guarded against throws).
 * @param options    Injectable clocks/timers and cap overrides.
 */
export function deferUntilIncomeCollected(
  s: any,
  onComplete: () => void,
  options: BoundedDeferralOptions = {},
): void {
  const now = options.now ?? defaultWallClock;
  const schedule = options.schedule ?? defaultWallSchedule;
  const clear = options.clear ?? defaultWallClear;
  const capMs = options.capMs ?? INCOME_COLLECTION_CAP_MS;
  const pollMs = options.pollMs ?? 250;

  let done = false;
  let watchdog: unknown;

  const finish = (): void => {
    if (done) return;
    done = true;
    if (watchdog !== undefined) {
      try { clear(watchdog); } catch { /* cancelling is best-effort */ }
      watchdog = undefined;
    }
    s.incomeCollectionActive = false;
    try {
      onComplete();
    } catch {
      // presentation-only — never let the continuation stall the turn.
    }
  };

  // The scene is shutting down: drop the deferral without calling back.
  const sceneGone = (): boolean =>
    typeof s?.isActive === 'function' && s.isActive() === false;

  // No scene clock: a headless scene cannot poll, so it proceeds immediately
  // (the animator clears the flag itself when it cannot schedule).
  if (typeof s?.time?.delayedCall !== 'function') {
    finish();
    return;
  }

  const deadline = now() + capMs;

  const poll = (): void => {
    if (done) return;
    if (sceneGone()) { done = true; return; }
    if (s.incomeCollectionActive !== true) { finish(); return; }
    if (now() >= deadline) { finish(); return; }
    scheduleOrRun(s, pollMs, poll);
  };

  // Wall-clock watchdog: the only path that fires while no frame is painted.
  // It re-reads the wall clock when it fires (a timer can fire early) and
  // re-arms for the remainder, so it can never force before the cap.
  const armWatchdog = (delayMs: number): void => {
    try {
      watchdog = schedule(() => {
        watchdog = undefined;
        if (done) return;
        if (sceneGone()) { done = true; return; }
        const remaining = deadline - now();
        if (remaining > 0) { armWatchdog(remaining); return; }
        finish();
      }, delayMs);
    } catch {
      // A host without timers falls back to the scene-clock poll alone.
      watchdog = undefined;
    }
  };

  armWatchdog(capMs);

  poll();
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

    if (options.statusText) flashConfirmation(s, options.statusText);

    // Always show the summary text so reduced motion / replay / headless still
    // receive the feedback (the incident name is part of the summary). The
    // per-seat closing passes its own per-seat `incomeSummary`, replacing the
    // shared host total; an empty string suppresses the summary.
    const summary = options.incomeSummary ?? closingSummary(result);
    if (summary) flashConfirmation(s, summary);

    const incomeCapMs = options.incomeCollectionCapMs ?? INCOME_COLLECTION_CAP_MS;

    const complete = (): void => {
      if (options.completionText) flashConfirmation(s, options.completionText);
      if (typeof options.holdMs === 'number' && options.holdMs > 0) {
        scheduleOrRun(s, options.holdMs, onComplete);
      } else {
        onComplete();
      }
    };

    const finish = (): void => {
      // Bounded deferral (AC6): when the caller ran a phased income
      // choreography, wait for it to finish collecting before advancing so the
      // animation is never left running in the background while the next day
      // starts. The bound is enforced on the wall clock
      // (MS-0MVMKEU2000639TG decision C), so the advance is forced even if the
      // flag is somehow never cleared or the page stops painting, and the
      // closing can never hang the game. A clock-less scene (headless) proceeds
      // immediately inside the helper (the animator clears the flag when it
      // cannot schedule).
      if (options.waitForIncomeCollection === true && s.incomeCollectionActive) {
        deferUntilIncomeCollected(s, complete, { capMs: incomeCapMs });
        return;
      }
      complete();
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
    // the phases stay distinct and non-overlapping. The bound is enforced on
    // the wall clock (MS-0MVMKEU2000639TG decision C) so the day can never
    // stall (AC6) — not even when the page stops painting.
    if (s.incomeCollectionActive) {
      deferUntilIncomeCollected(s, reveal, { capMs: incomeCapMs });
    } else {
      reveal();
    }
  
}
