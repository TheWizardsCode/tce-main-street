/**
 * Main Street: Incident and Peek Animation
 *
 * Incident reveal, delta bubbles, and peek-deck reveal animations.
 *
 * Import graph: depends only on `MainStreetAnimatorContext` (type) + timing.
 *
 * @module
 */

import { moveGameObject } from '@ui';
import type { PendingEndOfTurnDeltas } from '../MainStreetEngine';
import { CARD_BACK_TEMPLATE, SFX_KEYS } from './MainStreetConstants';
import {
  INCIDENT_BUBBLE_FLIGHT_MS,
  INCIDENT_BUBBLE_STAGGER_MS,
  INCIDENT_REVEAL_HOLD_MS,
} from './MainStreetAnimatorTiming';
import { mainStreetRenderCardSvg } from '@ui/Renderer/adapters/MainStreetAdapter';
import type { MainStreetAnimatorContext } from './MainStreetAnimatorContext';


export function animateIncidentReveal(animator: MainStreetAnimatorContext, params: {
    cardId: string;
    incidentName: string;
    /** Net coin delta from the incident (negative = loss). */
    coinChange: number;
    /** Net reputation delta from the incident (negative = loss). */
    repChange: number;
    /** Origin of the reveal: the front incident-queue card centre. */
    from: { x: number; y: number };
    /** Fired after the container is returned and destroyed. */
    onComplete?: () => void;
    /**
     * Deferred-mutation deltas (CG-0MTR72P14000VO6Q): applied in the reveal
     * cleanup (at most once via the scene guard) so the incident's coin/rep
     * deltas land only after the reveal completes. Absent for the legacy
     * immediate path where the engine already applied them.
     */
    pendingDeltas?: PendingEndOfTurnDeltas;
  }): void {

    const s = animator.scene;

    // Headless/replay exemption: no rendering or audio in those modes. The
    // completion callback still fires so the caller's turn-advance chain is
    // never left hanging (presentation is skipped; control flow is not).
    if (s.replayMode) {
      params.onComplete?.();
      return;
    }
    // No incident resolved: no-op — no rendering, audio, or scheduling. Fire
    // the completion callback so a defensive empty-id call never hangs the turn.
    if (!params.cardId) {
      params.onComplete?.();
      return;
    }
    const reducedMotion = s.settingsPanel?.reducedMotion === true;

    // Warning sting SFX — retained in both modes.
    try { s.soundManager?.play(SFX_KEYS.INCOME_NEGATIVE); } catch (_) { /* ignore */ }

    const w = s.layout.queueCardW ?? s.layout.marketCardW;
    const h = s.layout.queueCardH ?? s.layout.marketCardH;

    // Build the card-back-over-face container at the queue origin.
    const container = s.add.container(params.from.x, params.from.y);
    container.setDepth(10000);

    // Face first (bottom), then back overlay (top).
    mainStreetRenderCardSvg(s, container, params.cardId, w, h);
    const back = mainStreetRenderCardSvg(s, container, CARD_BACK_TEMPLATE, w, h);

    const cleanup = (): void => {
      // Deferred-mutation application (CG-0MTR72P14000VO6Q AC3): apply any
      // pending deltas when the incident reveal completes (this may be the
      // last animation of the end-of-turn cycle). Idempotent via the scene
      // guard — the income collection may have applied them already.
      animator.applyPendingDeltasOnce(params.pendingDeltas);
      // Close the deferred HUD window so refreshHud renders post-delta values.
      s.incidentRevealActive = false;
      container.destroy();
      params.onComplete?.();
    };

    if (reducedMotion) {
      // Reduced motion: the card appears instantly face-up at board centre —
      // no flight, no hinge flip, no bubble travel — but the hold
      // (INCIDENT_REVEAL_HOLD_MS) is preserved so the player still has time to
      // read the incident.
      back.setVisible(false);
      container.setPosition(s.layout.gameW / 2, s.layout.gameH / 2);
      s.incidentRevealActive = true;
      s.time.delayedCall(INCIDENT_REVEAL_HOLD_MS, () => {
        cleanup();
      });
      return;
    }

    // ── Full motion choreography ──
    s.incidentRevealActive = true;

    // 2. Flight to board centre (~550ms).
    const boardCentre = { x: s.layout.gameW / 2, y: s.layout.gameH / 2 };
    s.tweens.add({
      targets: container,
      x: boardCentre.x,
      y: boardCentre.y,
      scaleX: 1.1,
      scaleY: 1.1,
      duration: 550,
      ease: 'Quad.easeOut',
      onComplete: () => {
        // 3. Hinge-flip: scaleX → 0 reveals the face.
        s.tweens.add({
          targets: back,
          scaleX: 0,
          duration: 260,
          ease: 'Cubic.easeIn',
          onComplete: () => {
            back.setVisible(false);
            // 4. Delta bubbles during the hold.
            animator.animateIncidentDeltaBubbles({
              coinChange: params.coinChange,
              repChange: params.repChange,
              cardCenter: boardCentre,
              hudCoinX: s.layout.gameW * 0.25 + 70,
              hudRepX: s.layout.gameW * 0.5,
              hudY: s.layout.hudY,
            });
            // Hold, then return to queue.
            s.time.delayedCall(INCIDENT_REVEAL_HOLD_MS, () => {
              // Return animation: scale down slightly, move back.
              s.tweens.add({
                targets: container,
                x: params.from.x,
                y: params.from.y,
                scaleX: 1,
                scaleY: 1,
                duration: 400,
                ease: 'Quad.easeIn',
                onComplete: cleanup,
              });
            });
          },
        });
      },
    });
  
}

export function animateIncidentDeltaBubbles(animator: MainStreetAnimatorContext, params: {
    coinChange: number;
    repChange: number;
    cardCenter: { x: number; y: number };
    hudCoinX: number;
    hudRepX: number;
    hudY: number;
  }): void {

    const s = animator.scene;
    if (s.settingsPanel?.reducedMotion === true) return;

    const { coinChange, repChange, cardCenter, hudCoinX, hudRepX, hudY } = params;
    const flightMs = INCIDENT_BUBBLE_FLIGHT_MS;

    // Coin bubbles. Direction follows the incident convention
    // (CG-0MU41XVNV002N2D9): a gain flows card → HUD, a loss HUD → card.
    // BOTH X and Y must follow the sign: setting only X (with the start Y
    // pinned to `hudY` and the destination Y pinned to the card centre) made
    // a gain start in the HUD's vertical band and land on the card, so it
    // still read as HUD → card (CG-0MUA1UH3A008M4BS rework 3).
    if (coinChange !== 0) {
      const iconCount = Math.min(Math.abs(coinChange), 5); // cap at 5 bubbles
      const coinGain = coinChange > 0;
      const coinFrom = coinGain ? cardCenter : { x: hudCoinX, y: hudY };
      const coinTo = coinGain ? { x: hudCoinX, y: hudY } : cardCenter;
      for (let i = 0; i < iconCount; i++) {
        s.time.delayedCall(i * INCIDENT_BUBBLE_STAGGER_MS, () => {
          const bubble = s.add.circle(coinFrom.x, coinFrom.y, 5, 0xffcc44, 1).setDepth(3000);
          moveGameObject({
            scene: s,
            target: bubble,
            destX: coinTo.x,
            destY: coinTo.y,
            duration: flightMs,
            ease: 'Quad.easeIn',
            soundManager: s.soundManager,
            sfx: { start: SFX_KEYS.COIN_POP },
            onComplete: () => {
              try { bubble.destroy(); } catch (_) { /* ignore */ }
            },
          });
        });
      }
    }

    // Reputation bubbles (same sign rule; silent blue pips).
    if (repChange !== 0) {
      const iconCount = Math.min(Math.abs(repChange), 5); // cap at 5 bubbles
      const repGain = repChange > 0;
      const repFrom = repGain ? cardCenter : { x: hudRepX, y: hudY };
      const repTo = repGain ? { x: hudRepX, y: hudY } : cardCenter;
      for (let i = 0; i < iconCount; i++) {
        s.time.delayedCall(i * INCIDENT_BUBBLE_STAGGER_MS, () => {
          const bubble = s.add.circle(repFrom.x, repFrom.y, 4, 0x88bbff, 1).setDepth(3000);
          moveGameObject({
            scene: s,
            target: bubble,
            destX: repTo.x,
            destY: repTo.y,
            duration: flightMs,
            ease: 'Quad.easeIn',
            onComplete: () => {
              try { bubble.destroy(); } catch (_) { /* ignore */ }
            },
          });
        });
      }
    }
  
}

export function animatePeekReveal(animator: MainStreetAnimatorContext, params: {
    cardId: string;
    cardName: string;
    /** Origin of the reveal: the face-down incident-deck stack centre. */
    from: { x: number; y: number };
    /** Fired after the card is returned face-down (both modes). */
    onComplete?: () => void;
  }): void {

    const s = animator.scene;

    // Headless/replay exemption: no rendering or audio in those modes.
    if (s.replayMode) return;
    const reducedMotion = s.settingsPanel?.reducedMotion === true;
    const w = s.layout.queueCardW;
    const h = s.layout.queueCardH;

    const container = s.add.container(params.from.x, params.from.y);
    container.setDepth(10000);

    // The actual SVG face sits beneath the card back; the back flips open
    // to reveal it and flips closed to return the card face-down.
    mainStreetRenderCardSvg(s, container, params.cardId, w, h);
    const back = mainStreetRenderCardSvg(s, container, CARD_BACK_TEMPLATE, w, h);

    const cleanup = (): void => {
      container.destroy();
      params.onComplete?.();
    };

    // Deal SFX on reveal — retained under reduced motion (rule 8).
    try { s.soundManager?.play(SFX_KEYS.DEAL); } catch (_) { /* ignore */ }

    if (reducedMotion) {
      // Instant reveal: drop the back, hold the face briefly, restore.
      back.setVisible(false);
      s.time.delayedCall(900, () => {
        try { s.soundManager?.play(SFX_KEYS.CLICK); } catch (_) { /* ignore */ }
        cleanup();
      });
      return;
    }

    // Hinge open: scaleX 1 → 0 reveals the face beneath.
    s.tweens.add({
      targets: back,
      scaleX: 0,
      duration: 260,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        back.setVisible(false);
        try { s.soundManager?.play(SFX_KEYS.CLICK); } catch (_) { /* ignore */ }
        // Hold the face up, then flip back down.
        s.time.delayedCall(1600, () => {
          back.setVisible(true);
          back.scaleX = 0;
          s.tweens.add({
            targets: back,
            scaleX: 1,
            duration: 260,
            ease: 'Cubic.easeOut',
            onComplete: cleanup,
          });
        });
      },
    });
  
}
