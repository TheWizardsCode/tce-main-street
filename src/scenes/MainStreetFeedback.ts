/**
 * Main Street: transient feedback channel
 *
 * Replaces the persistent instruction/hint line (parent MS-0MVKTB6WS000VLWK
 * AC4/AC6, item MS-0MVPWQK3U003DIR6). Former hint-line messages are routed
 * here and surfaced as short-lived pop text anchored above the hand band
 * using layout values — never a hard-coded pixel position and never
 * dependent on the final hand anchoring (the hand bottom-anchor item moves
 * `handY`; the anchor follows it).
 *
 * Message taxonomy (producer decision Q4 = (a), recorded on the item):
 *
 *   - error        refusals / illegal moves ("Not enough coins…",
 *                  "Cannot hire…", "Hand full…")        → pop text
 *   - confirmation outcomes ("Applied … to slot N", "Sold …") → pop text
 *   - guidance     phase-teaching lines that only told the player what to do
 *                  ("Click an empty slot to place …", "Event selected — Play
 *                  it or Discard it", the standard market instruction) — these
 *                  are DROPPED rather than resurrected as pop text.
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
import { popTextOrIcon } from '@ui/popTextOrIcon';
import type { SceneLayout } from './MainStreetConstants';

/** Feedback kinds: guidance/progress are dropped, error/confirmation pop. */
export type FeedbackKind = 'error' | 'confirmation' | 'guidance' | 'progress';

export interface FeedbackOptions {
  /** Defaults to `confirmation`. */
  kind?: FeedbackKind;
  /** Override the settings-panel reduced-motion flag (tests). */
  reducedMotion?: boolean;
  /** Lifetime of the pop text in ms. Default 1100. */
  duration?: number;
}

/** Kinds that are intentionally NOT surfaced as pop text. */
const DROPPED_KINDS: ReadonlySet<FeedbackKind> = new Set(['guidance', 'progress']);

/** Lift above the hand band (px) — the old instruction line's offset. */
const FEEDBACK_LIFT_PX = 20;

/** Anchor for transient feedback: centred over the main content area, above the hand band. */
export function feedbackAnchor(layout: Pick<SceneLayout, 'logX' | 'handY' | 'gameW' | 'gameH'>): { x: number; y: number } {
  const gameW = layout.gameW ?? 1280;
  const x = Number.isFinite(layout.logX) ? Math.round(layout.logX / 2) : Math.round(gameW / 2);
  const y = Number.isFinite(layout.handY)
    ? layout.handY - FEEDBACK_LIFT_PX
    : (layout.gameH ?? 720) - 40;
  return { x, y };
}

/**
 * Surface a former instruction-line message as short-lived pop text.
 *
 * Guidance and progress messages are dropped (they only taught a phase or
 * self-resolved); errors and confirmations are shown. Reduced-motion users
 * see a static, no-tween message for `duration` ms instead of the animated
 * pop — the message is surfaced, never silently dropped.
 */
export function flashFeedback(scene: any, text: string | null | undefined, options: FeedbackOptions = {}): void {
  const kind = options.kind ?? 'confirmation';
  if (!text || DROPPED_KINDS.has(kind)) return;

  // Observability seam: record what was surfaced (used by tests and QA to
  // assert the feedback channel without scraping rendered scene objects).
  try {
    if (scene) {
      scene.lastFeedback = { text, kind };
      (scene.feedbackHistory ??= []).push({ text, kind });
    }
  } catch { /* presentation-only */ }

  const layout: SceneLayout | undefined = scene?.layout;
  if (!layout) return;

  const reducedMotion = options.reducedMotion ?? scene?.settingsPanel?.reducedMotion ?? false;
  const anchor = feedbackAnchor(layout);
  const duration = options.duration ?? 1100;

  if (reducedMotion) {
    // Reduced motion: static message, no tween (still surfaced).
    try {
      const label = scene.add.text(anchor.x, anchor.y, text, {
        fontSize: '14px',
        fontFamily: FONT_FAMILY,
        color: '#ccaa77',
      }).setOrigin(0.5).setDepth(900);
      const destroy = (): void => {
        try { label.destroy(); } catch { /* already gone */ }
      };
      if (typeof scene.time?.delayedCall === 'function') {
        scene.time.delayedCall(duration, destroy);
      } else {
        destroy();
      }
    } catch { /* presentation-only */ }
    return;
  }

  try {
    void popTextOrIcon({
      scene,
      x: anchor.x,
      y: anchor.y,
      label: text,
      duration,
      riseY: 20,
      scale: 1.1,
      reducedMotion: false,
    });
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
