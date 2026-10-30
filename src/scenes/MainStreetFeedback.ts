/**
 * Main Street: transient feedback channel
 *
 * Replaces the persistent instruction/hint line (parent MS-0MVKTB6WS000VLWK
 * AC4/AC6, item MS-0MVPWQK3U003DIR6). Former hint-line messages are routed
 * here and surfaced as a readable toast anchored above the hand-card band
 * using layout values — never a hard-coded pixel position and never
 * dependent on the final hand anchoring (the hand bottom-anchor item moves
 * `handY`; the anchor follows it).
 *
 * Readability contract (MS-0MVRDBD3P0026CXH): the toast fades/scales in
 * (~160 ms), holds fully opaque for `feedbackHoldMs(text)` (500 ms per
 * whitespace-delimited word), then fades out (~300 ms) and is destroyed. It
 * renders at `FEEDBACK_TOAST_DEPTH` — above every Main Street layer — and its
 * anchor is lifted clear of the hand-card band. Under reduced motion the same
 * text is held for the same time with no tweens, then destroyed. Only one
 * toast is live per scene: a new message cancels the previous toast's
 * timers/tweens and replaces it.
 *
 * Message taxonomy (producer decision Q4 = (a), recorded on the item):
 *
 *   - error        refusals / illegal moves ("Not enough coins…",
 *                  "Cannot hire…", "Hand full…")        → toast
 *   - confirmation outcomes ("Applied … to slot N", "Sold …") → toast
 *   - guidance     phase-teaching lines that only told the player what to do
 *                  ("Click an empty slot to place …", "Event selected — Play
 *                  it or Discard it", the standard market instruction) — these
 *                  are DROPPED rather than resurrected as toast.
 *   - progress     transient status lines ("Placing …", "Processing end of
 *                  turn…") that self-resolve visually — DROPPED.
 *
 * Activity Log recording is untouched: every message was already logged where
 * appropriate and stays logged there; this module only handles the on-screen
 * channel.
 *
 * @module
 */

import { FONT_FAMILY } from '@ui/constants';
import {
  FEEDBACK_TOAST_DEPTH,
  FEEDBACK_TOAST_FADE_IN_MS,
  FEEDBACK_TOAST_FADE_OUT_MS,
  FEEDBACK_TOAST_MARGIN_PX,
  FEEDBACK_TOAST_MAX_WIDTH,
  FEEDBACK_WORD_HOLD_MS,
  type SceneLayout,
} from './MainStreetConstants';

/** Feedback kinds: guidance/progress are dropped, error/confirmation toast. */
export type FeedbackKind = 'error' | 'confirmation' | 'guidance' | 'progress';

export interface FeedbackOptions {
  /** Defaults to `confirmation`. */
  kind?: FeedbackKind;
  /** Override the settings-panel reduced-motion flag (tests). */
  reducedMotion?: boolean;
  /**
   * Explicit fully-opaque hold in ms. Defaults to `feedbackHoldMs(text)`;
   * kept for tests and back-compatible call sites.
   */
  holdMs?: number;
  /** @deprecated Use {@link FeedbackOptions.holdMs}. Alias kept for back-compat. */
  duration?: number;
}

/** Kinds that are intentionally NOT surfaced as toast. */
const DROPPED_KINDS: ReadonlySet<FeedbackKind> = new Set(['guidance', 'progress']);

/** Base viewport width used when a scene has no finite `gameW`. */
const FALLBACK_GAME_W = 1280;

/** Base viewport height used when a scene has no finite `gameH`. */
const FALLBACK_GAME_H = 720;

/** Horizontal inset (px) applied to `gameW` when deriving the wrap width. */
const TOAST_WRAP_INSET_PX = 40;

/** Layout subset the toast anchor needs (hand-card height is optional). */
type FeedbackAnchorLayout = Pick<SceneLayout, 'logX' | 'handY' | 'gameW' | 'gameH'>
  & Partial<Pick<SceneLayout, 'handCardH'>>;

/**
 * Fully-opaque hold for a feedback message: `max(1, words) × 500 ms`.
 * Empty/whitespace-only text returns 0 (nothing to show).
 */
export function feedbackHoldMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return words === 0 ? 0 : Math.max(1, words) * FEEDBACK_WORD_HOLD_MS;
}

/**
 * Anchor for transient feedback: centred over the main content area, lifted
 * clear of the hand-card band (`handY − handCardH / 2 − margin`).
 *
 * `handCardH` is optional for back-compat: when missing (or non-finite) the
 * toast keeps the historical plain lift above `handY` instead of guessing a
 * card height. Horizontal centring and the no-metrics fallback are unchanged.
 */
export function feedbackAnchor(layout: FeedbackAnchorLayout): { x: number; y: number } {
  const gameW = Number.isFinite(layout.gameW) ? layout.gameW : FALLBACK_GAME_W;
  const gameH = Number.isFinite(layout.gameH) ? layout.gameH : FALLBACK_GAME_H;
  const x = Number.isFinite(layout.logX) ? Math.round(layout.logX / 2) : Math.round(gameW / 2);

  if (!Number.isFinite(layout.handY)) {
    return { x, y: gameH - TOAST_WRAP_INSET_PX };
  }

  const cardHalf = Number.isFinite(layout.handCardH) && (layout.handCardH as number) > 0
    ? (layout.handCardH as number) / 2
    : 0;
  return { x, y: layout.handY - cardHalf - FEEDBACK_TOAST_MARGIN_PX };
}

/** One live toast per scene, plus the handles needed to tear it down. */
interface ActiveToast {
  text: any;
  timers: any[];
  tweens: any[];
}

const activeToasts = new WeakMap<object, ActiveToast>();
const cleanupBoundScenes = new WeakSet<object>();

function stopTween(tween: any): void {
  try { tween?.stop?.(); } catch { /* already gone */ }
}

function removeTimer(timer: any): void {
  try { timer?.remove?.(); } catch { /* already gone */ }
}

/** Destroy the scene's live toast and cancel every pending callback. */
function destroyActiveToast(scene: any): void {
  if (!scene || typeof scene !== 'object') return;
  const active = activeToasts.get(scene);
  if (!active) return;
  activeToasts.delete(scene);
  for (const tween of active.tweens) stopTween(tween);
  for (const timer of active.timers) removeTimer(timer);
  try { active.text?.destroy?.(); } catch { /* already gone */ }
}

/**
 * Bind scene shutdown/destroy cleanup once per scene instance so no toast
 * timer/tween outlives the scene. Re-bound after a shutdown (Phaser reuses
 * the scene instance on restart).
 */
function bindSceneCleanup(scene: any): void {
  if (!scene || typeof scene !== 'object' || cleanupBoundScenes.has(scene)) return;
  const events = scene.events;
  if (!events || typeof events.once !== 'function') return;
  cleanupBoundScenes.add(scene);
  const cleanup = (): void => {
    cleanupBoundScenes.delete(scene);
    destroyActiveToast(scene);
  };
  try {
    events.once('shutdown', cleanup);
    events.once('destroy', cleanup);
  } catch { /* presentation-only */ }
}

/** Wrap width for the toast: the named cap, narrowed to fit the viewport. */
function toastWrapWidth(gameW: number | undefined): number {
  const width = Number.isFinite(gameW) ? (gameW as number) : FALLBACK_GAME_W;
  return Math.min(FEEDBACK_TOAST_MAX_WIDTH, width - TOAST_WRAP_INSET_PX);
}

/**
 * Present the toast: fade/scale in → fully-opaque hold → fade out → destroy.
 * Reduced motion skips the tweens but keeps the same hold (never dropped).
 */
function showToast(
  scene: any,
  text: string,
  anchor: { x: number; y: number },
  holdMs: number,
  reducedMotion: boolean,
): void {
  bindSceneCleanup(scene);
  destroyActiveToast(scene);

  const label = scene.add.text(anchor.x, anchor.y, text, {
    fontSize: '18px',
    fontStyle: 'bold',
    fontFamily: FONT_FAMILY,
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: 4,
    align: 'center',
  });
  try { label.setOrigin(0.5); } catch { /* presentation-only */ }
  try { label.setDepth(FEEDBACK_TOAST_DEPTH); } catch { /* presentation-only */ }
  try { label.setWordWrapWidth(toastWrapWidth(scene?.layout?.gameW)); } catch { /* presentation-only */ }

  const toast: ActiveToast = { text: label, timers: [], tweens: [] };
  activeToasts.set(scene, toast);

  const isCurrent = (): boolean => activeToasts.get(scene) === toast;

  const schedule = (ms: number, cb: () => void): void => {
    if (!isCurrent()) return;
    if (typeof scene?.time?.delayedCall !== 'function') {
      cb();
      return;
    }
    const timer = scene.time.delayedCall(ms, () => {
      if (!isCurrent()) return;
      cb();
    });
    toast.timers.push(timer);
  };

  const animate = typeof scene?.tweens?.add === 'function';

  const fadeOut = (): void => {
    if (!isCurrent()) return;
    if (!animate) {
      destroyActiveToast(scene);
      return;
    }
    const tween = scene.tweens.add({
      targets: label,
      alpha: 0,
      duration: FEEDBACK_TOAST_FADE_OUT_MS,
      ease: 'Quad.easeIn',
      onComplete: () => {
        if (isCurrent()) destroyActiveToast(scene);
      },
    });
    toast.tweens.push(tween);
  };

  // Reduced motion (and headless scenes without a tween manager) shows the
  // same static text for the same hold — no tweens, never dropped.
  if (reducedMotion || !animate) {
    try { label.setAlpha(1); } catch { /* presentation-only */ }
    schedule(holdMs, () => destroyActiveToast(scene));
    return;
  }

  try {
    label.setAlpha(0);
    label.setScale(0.9);
  } catch { /* presentation-only */ }

  const fadeIn = scene.tweens.add({
    targets: label,
    alpha: 1,
    scaleX: 1,
    scaleY: 1,
    duration: FEEDBACK_TOAST_FADE_IN_MS,
    ease: 'Quad.easeOut',
    onComplete: () => schedule(holdMs, fadeOut),
  });
  toast.tweens.push(fadeIn);
}

/**
 * Surface a former instruction-line message as a readable toast.
 *
 * Guidance and progress messages are dropped (they only taught a phase or
 * self-resolved); errors and confirmations are shown. Reduced-motion users
 * see a static, no-tween toast held for the same time instead of the animated
 * one — the message is surfaced, never silently dropped.
 */
export function flashFeedback(scene: any, text: string | null | undefined, options: FeedbackOptions = {}): void {
  const kind = options.kind ?? 'confirmation';
  if (!text || DROPPED_KINDS.has(kind)) return;
  if (text.trim().length === 0) return;

  // Observability seam: record what was surfaced (used by tests and QA to
  // assert the feedback channel without scraping rendered scene objects).
  try {
    if (scene) {
      scene.lastFeedback = { text, kind };
      (scene.feedbackHistory ??= []).push({ text, kind });
    }
  } catch { /* presentation-only */ }

  const layout: FeedbackAnchorLayout | undefined = scene?.layout;
  if (!layout) return;

  const holdMs = options.holdMs ?? options.duration ?? feedbackHoldMs(text);
  if (!(holdMs > 0)) return;

  const reducedMotion = options.reducedMotion ?? scene?.settingsPanel?.reducedMotion ?? false;
  const anchor = feedbackAnchor(layout);

  try {
    showToast(scene, text, anchor, holdMs, reducedMotion);
  } catch { /* presentation-only */ }
}

/** Convenience: refusal / error feedback. */
export function flashError(scene: any, text: string | null | undefined, options?: FeedbackOptions): void {
  flashFeedback(scene, text, { ...options, kind: 'error' });
}

/** Convenience: outcome / confirmation feedback. */
export function flashConfirmation(scene: any, text: string | null | undefined, options?: FeedbackOptions): void {
  flashFeedback(scene, text, { ...options, kind: 'confirmation' });
}
