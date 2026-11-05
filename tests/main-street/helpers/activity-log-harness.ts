/**
 * Main Street: Activity Log filter acceptance harness (MS-0MW3PFLDP000CF2X)
 *
 * Shared, deterministic test scaffolding for the Activity Log filter epic
 * (MS-0MW1ZGM1F0010DQW). This is the **test-first** child of the plan: it
 * lands before any production change and stays green while every later child
 * builds attribution / filter-predicate assertions on top of it.
 *
 * Two surfaces:
 *
 *  - a **headless action driver** — `createActivityLogState` builds a
 *    competitive state via `createCompetitiveState` and `driveAction` drives
 *    each gameplay path through the existing engine entry points, returning
 *    the activity-log entries that path appended (`state.activityLog.slice`);
 *  - a **browser boot helper** — `bootActivityLogScene` boots a `MainStreetScene`
 *    (competitive by default, single-player opt-in), waits for the scene, and
 *    exposes the Activity Log panel state (entry count, `logContentContainer`
 *    rendered children, `logFilter`, filter-control row presence) with clean
 *    teardown, following the boot/teardown pattern in
 *    `tests/main-street/activity-log-rendering.browser.test.ts`.
 *
 * Later children import their scaffolding from here — no copy-pasted boot or
 * state-setup code anywhere else.
 */

import type Phaser from 'phaser';
import {
  addLog,
  classifyEffect,
  createCompetitiveState,
  describeEventEffects,
  setupMainStreetGame,
  type CompetitiveOpponentConfig,
  type LogEntry,
  type MainStreetState,
} from '../../../src/MainStreetState';
import { applyCompetitiveIncome, recalculateCard } from '../../../src/MainStreetAdjacency';
import {
  executeAction,
  executeCompetitiveWeekStart,
  executeWeekStart,
  maybeOfferBailoutForSeat,
  sellFromHand,
  layoffStaffCard,
  resolveIncident,
  applyCompetitiveEventEffects,
  type PlayerAction,
} from '../../../src/MainStreetEngine';
import { sellBusiness } from '../../../src/MainStreetMarket';
import type { EventCard } from '../../../src/MainStreetCards';
import { bindCompetitiveSeat, restoreCompetitiveSeat } from '../../../src/MainStreetAiStrategy';

// ── Headless driver ─────────────────────────────────────────

/** Options for building a deterministic competitive harness state. */
export interface CreateActivityLogStateOptions {
  /** Deterministic seed for decks / incidents / seat colours. */
  seed: string;
  /** Number of seats (default 2). */
  playerCount?: number;
  /** Per-opponent configuration for AI seats (default: Greedy/Medium). */
  opponents?: CompetitiveOpponentConfig[];
  /** Difficulty preset applied to the whole game. */
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  /** Bank-loan availability (default `true` so the loan/bailout paths work). */
  loansEnabled?: boolean;
}

/**
 * Builds a competitive state for activity-log tests via `createCompetitiveState`.
 *
 * Determinism: the same options reproduce the same seat colours, wallets and
 * deck order. Seat 0 is the human (`You`), seats 1..N-1 are AI (`AI n`).
 *
 * @param opts - Construction options.
 * @returns A mutable competitive `MainStreetState` (pre-day-start).
 */
export function createActivityLogState(opts: CreateActivityLogStateOptions): MainStreetState {
  const playerCount = opts.playerCount ?? 2;
  return createCompetitiveState({
    seed: opts.seed,
    playerCount,
    opponents: opts.opponents ?? (playerCount >= 2 ? [{ strategy: 'Greedy', difficulty: 'Medium' }] : undefined),
    difficulty: opts.difficulty,
    loansEnabled: opts.loansEnabled ?? true,
  });
}

/**
 * Builds the no-roster single-player state used by the "single-player carries
 * no seat fields" baseline invariant.
 *
 * @param seed - Deterministic seed.
 * @returns A mutable single-player `MainStreetState` (pre-day-start).
 */
export function createSinglePlayerState(seed: string): MainStreetState {
  return setupMainStreetGame({ seed, loansEnabled: true });
}

/**
 * Starts the day for the active mode and returns the entries the start
 * appended (the `Turn N` turn-header — a shared, seat-less entry).
 *
 * Uses `executeCompetitiveWeekStart` when a roster is present and
 * `executeWeekStart` otherwise, mirroring the engine's own mode dispatch.
 *
 * @param state - A fresh pre-day-start state.
 * @returns The log entries appended by the week start.
 */
export function startDay(state: MainStreetState): LogEntry[] {
  const prev = state.activityLog.length;
  if (state.players && state.players.length > 0) {
    executeCompetitiveWeekStart(state);
  } else {
    executeWeekStart(state);
  }
  return state.activityLog.slice(prev);
}

/**
 * Actions the harness can drive.
 *
 * - Every `PlayerAction` (`buy-business`, `play-business-from-hand`,
 *   `buy-and-place`, `play-event`, `play-event-from-hand`, `move-to-hand`,
 *   `buy-upgrade`, `hire-staff`, `take-loan`, `community-favour`, ...) is
 *   dispatched through the engine's canonical `executeAction` seam, bound to a
 *   seat in competitive mode (bind → act → restore).
 * - Phase-level paths with no `PlayerAction` counterpart:
 *   - `income` — the IncomePhase collection entry point
 *     (`applyCompetitiveIncome`, which also logs the per-owner
 *     `Reputation from cards` line);
 *   - `reputation` — a seat reputation change. The engine exposes no
 *     standalone "change one seat's reputation and log it" entry point, so
 *     this harness-owned path applies the delta to the seat's wallet and
 *     appends the seat-attributed entry through the same canonical
 *     `addLog(state, seatId, ...)` overload that `applyCompetitiveIncome` /
 *     `applyCompetitiveEventEffects` use — the exact seam the filter epic
 *     pins attribution on.
 *   - `bailout` — the bankruptcy bailout offer for a seat
 *     (`maybeOfferBailoutForSeat`), which logs a seat-attributed entry.
 *   - `sell` / `sell-from-hand` — the engine sale paths
 *     (`sellBusiness` / `sellFromHand`), which log seat-attributed entries
 *     (the daily action is charged by the scene command layer, so the
 *     headless driver calls the engine mutation directly).
 *   - `layoff` — the staff lay-off path (`layoffStaffCard`).
 *   - `incident` — the shared incident draw (`resolveIncident`) followed by
 *     the per-owner outcome routing (`applyCompetitiveEventEffects`), so a
 *     single drive produces both the unattributed draw line and the
 *     seat-attributed per-owner outcome lines.
 */
export type ActivityLogDriveAction =
  | PlayerAction
  | { type: 'income' }
  | { type: 'reputation'; playerId: number; delta: number }
  | { type: 'bailout'; playerId: number }
  | { type: 'sell'; slotIndex: number }
  | { type: 'sell-from-hand'; handIndex: number }
  | { type: 'layoff'; cardId: string }
  | { type: 'incident'; event?: EventCard };

/**
 * Drives one action path through the engine and returns the activity-log
 * entries the path appended (`state.activityLog.slice(prev)`).
 *
 * In competitive states a `PlayerAction` is executed bound to the given seat
 * (default `state.activePlayerId`), mirroring
 * `driveCompetitiveMarketPhases`: bind → set active → execute → restore, so
 * the seat's wallet / hand / staff are the acting seat's. Phase-level paths
 * operate directly on the roster.
 *
 * @param state   The harness state (mutated in place).
 * @param action  The path to drive.
 * @param options Per-call options.
 * @returns The log entries appended by this path.
 */
export function driveAction(
  state: MainStreetState,
  action: ActivityLogDriveAction,
  options: { seatId?: number } = {},
): LogEntry[] {
  const prev = state.activityLog.length;

  switch (action.type) {
    case 'income': {
      // Competitive per-owner income; the N<2 path delegates to the shared
      // `applyIncome` internally, so one call covers both modes.
      applyCompetitiveIncome(state);
      return state.activityLog.slice(prev);
    }
    case 'reputation': {
      const player = state.players?.find((p) => p.playerId === action.playerId);
      if (player) player.reputation += action.delta;
      addLog(
        state,
        action.playerId,
        `Reputation change: ${action.delta > 0 ? '+' : ''}${action.delta} reputation (${describeEventEffects(0, action.delta)})`,
        classifyEffect(0, action.delta),
      );
      return state.activityLog.slice(prev);
    }
    case 'bailout': {
      maybeOfferBailoutForSeat(state, action.playerId);
      return state.activityLog.slice(prev);
    }
    case 'sell': {
      // The acting seat is whatever `options.seatId` (or the ambient
      // `activePlayerId`) says — same derivation the default `addLog` uses.
      sellBusiness(state, action.slotIndex);
      return state.activityLog.slice(prev);
    }
    case 'sell-from-hand': {
      sellFromHand(state, action.handIndex);
      return state.activityLog.slice(prev);
    }
    case 'layoff': {
      layoffStaffCard(state, action.cardId);
      return state.activityLog.slice(prev);
    }
    case 'incident': {
      // Deterministic draw: when the caller supplies an incident card, drive
      // it directly (fresh balance, no week window on fabricated cards).
      if (action.event) {
        state.incidentDeck = [action.event];
      }
      const incident = resolveIncident(state);
      if (incident) {
        applyCompetitiveEventEffects(state, incident);
      }
      return state.activityLog.slice(prev);
    }
    default: {
      // A `PlayerAction`: dispatch through the engine's single action seam.
      if (state.players && state.players.length > 0) {
        const seatId = options.seatId ?? state.activePlayerId ?? 0;
        state.activePlayerId = seatId;
        bindCompetitiveSeat(state, seatId);
        try {
          executeAction(state, action);
        } finally {
          restoreCompetitiveSeat(state, seatId);
        }
      } else {
        executeAction(state, action);
      }
      return state.activityLog.slice(prev);
    }
  }
}

/**
 * Re-exported adjacency cache primitive so children sync a fabricated card's
 * cached income / reputation through the harness import point.
 */
export { recalculateCard };

// ── Browser boot helper ─────────────────────────────────────

/** Anything the scene exposes — the handle reads only what it documents. */
type SceneLike = Phaser.Scene & Record<string, any>;

/** Options for {@link bootActivityLogScene}. */
export interface BootActivityLogSceneOptions {
  /** Game mode (default `'competitive'`). */
  mode?: 'competitive' | 'single-player';
  /** Per-opponent configuration for competitive mode (default Greedy/Medium). */
  opponents?: CompetitiveOpponentConfig[];
  /** Extra animation frames to settle after boot (default 10). */
  settleFrames?: number;
}

/**
 * Live Activity Log panel state exposed by {@link bootActivityLogScene}.
 *
 * The handle is deliberately a record of *reads*, so later children can extend
 * the seam (e.g. the filter predicate itself) without changing the boot path.
 */
export interface ActivityLogSceneHandle {
  game: Phaser.Game;
  scene: SceneLike;
  /** The number of entries in `state.activityLog`. */
  entryCount(): number;
  /** Children currently rendered into `logContentContainer`. */
  renderedChildren(): Phaser.GameObjects.GameObject[];
  /** Rendered `Text` strings from `logContentContainer`, in order. */
  renderedTexts(): string[];
  /**
   * The scene's `logFilter` state. `undefined` until the filter-predicate
   * child lands — the seam exists now so later children pin it in place.
   */
  logFilter(): unknown;
  /**
   * Whether a filter-control row container is present **and visible**.
   * `false` until the filter-controls child lands (the row reads as absent
   * by design); `false` in single-player / tutorial even after it lands,
   * because the row container is always built but hidden when
   * `shouldShowLogFilterControls` is false (MS-0MW3PFSMB002EIY6).
   */
  hasFilterControlRow(): boolean;
  /** Clean teardown: `game.destroy(true, false)` + container removal. */
  destroy(): void;
}

/**
 * Boots a MainStreetScene (competitive by default) and returns a handle to
 * the Activity Log panel state, with clean teardown.
 *
 * Follows the established boot/teardown pattern
 * (`tests/main-street/activity-log-rendering.browser.test.ts`): container
 * creation, `createMainStreetGame`, `waitForScene`, a settle frame count,
 * dismissal of the turn-summary dialog if one is presented, and
 * `game.destroy(true, false)` on teardown. Phaser is imported dynamically so
 * the headless driver surface stays importable from node-unit tests.
 *
 * @param options - Boot options.
 * @returns A live handle; call `destroy()` in `afterEach` (or `finally`).
 */
export async function bootActivityLogScene(
  options: BootActivityLogSceneOptions = {},
): Promise<ActivityLogSceneHandle> {
  const {
    mode = 'competitive',
    opponents = [{ strategy: 'Greedy', difficulty: 'Medium' }],
    settleFrames = 10,
  } = options;

  let container = document.getElementById('game-container');
  if (container) container.remove();
  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const phaserModule = await import('phaser');
  const phaser = ((phaserModule as { default?: typeof Phaser }).default ?? phaserModule) as typeof Phaser;

  const { createMainStreetGame } = await import('../../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: phaser.CANVAS, parent: 'game-container' });

  const { waitForScene } = await import('@core-tests/helpers/waitForScene');
  await waitForScene(game, 'MainStreetScene');
  const scene = game.scene.getScene('MainStreetScene') as SceneLike;

  if (mode === 'competitive') {
    scene.msLifecycleManager.applyNewGameSelection({ mode: 'competitive', opponents });
    await waitForCondition(() => (scene.state?.players?.length ?? 0) === opponents.length + 1, 20_000);
  } else {
    scene.msLifecycleManager.applyNewGameSelection({ mode: 'single-player' });
    await waitForCondition(() => Boolean(scene.state && scene.logContentContainer), 20_000);
  }

  await waitFrames(settleFrames);
  // No-op at boot, present (and dismissed) after a completed closing — the
  // pattern the reference browser tests rely on. The dialog helper imports
  // Phaser statically, so it is loaded lazily to keep this module importable
  // from node-unit tests.
  const { dismissTurnSummaryDialogIfPresent } = await import('./turn-summary-dialog');
  dismissTurnSummaryDialogIfPresent(scene);

  let destroyed = false;
  return {
    game,
    scene,
    entryCount: () => scene.state?.activityLog?.length ?? 0,
    renderedChildren: () => [...((scene.logContentContainer?.list as Phaser.GameObjects.GameObject[]) ?? [])],
    renderedTexts: () =>
      ((scene.logContentContainer?.list as Phaser.GameObjects.GameObject[]) ?? [])
        .filter((child) => child instanceof phaser.GameObjects.Text)
        .map((child) => (child as Phaser.GameObjects.Text).text),
    logFilter: () => scene.logFilter,
    hasFilterControlRow: () => {
      const row = scene.logFilterRow ?? scene.filterControlRow;
      return Boolean(row) && row.visible !== false;
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      game.destroy(true, false);
      document.getElementById('game-container')?.remove();
    },
  };
}

// ── Shared polling utilities (browser only) ─────────────────

/** Waits `n` animation frames (with a safety timeout). */
export function waitFrames(n: number, fallbackMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let left = n;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const fallback = setTimeout(finish, fallbackMs);

    const tick = () => {
      if (settled) return;
      left -= 1;
      if (left <= 0) {
        clearTimeout(fallback);
        finish();
      } else {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  });
}

/** Polls `predicate` every `intervalMs` until true or `timeoutMs` elapses. */
export async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 10_000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
}
