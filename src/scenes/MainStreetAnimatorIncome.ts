/**
 * Main Street: Income / HUD Animation
 *
 * Income collection and phased choreography, HUD value changes, celebration,
 * and coin-grid flight helpers.
 *
 * Import graph: depends only on `MainStreetAnimatorContext` (type) + timing.
 *
 * @module
 */

import Phaser from 'phaser';
import { FONT_FAMILY, moveGameObject, popTextOrIcon } from '@ui';
import type { SlotIncome, SlotPhaseBreakdown } from '../MainStreetAdjacency';
import { applyEndOfTurnDeltas } from '../MainStreetEngine';
import type { PendingEndOfTurnDeltas } from '../MainStreetEngine';
import { SFX_KEYS } from './MainStreetConstants';
import { createCoinGrid, iconsForAmount, roundHalf } from '../coin-grid';
import type { IncomePhaseKey, IncomePhaseOptions, IncomePhaseSlot, MainStreetAnimatorContext } from './MainStreetAnimatorContext';
import { resolveDeltaFlow, snapDisplayedTotals, stepDisplayedTotal, hudFlightTarget } from './MainStreetAnimatorContext';
import { INCOME_CARD_FULL_PAUSE_MULTIPLIER, INCOME_COLLECT_STAGGER_MS, INCOME_FLIGHT_MS, INCOME_FLIGHT_STAGGER_MS, INCOME_PHASE_GAP_MS, INCOME_PHASE_LABEL_MS } from './MainStreetAnimatorTiming';
import { pedestrianCount, pedestrianStreetAnchor } from './MainStreetPedestrians';

/**
 * Resolve the reputation phase's coin origins from the on-street
 * pedestrians (MS-0MUYGFWXK003QFYB, reworked MS-0MUZ4WB290024ZGQ).
 *
 * Delegates to the pedestrian layer's `dissolveIntoCoins`; the layer first
 * ensures the reputation-phase shop-occupancy minimum, then sources each
 * business from a figure inside it (or any shop occupant), falling back to a
 * street-area anchor when no figures are inside a shop. Never returns the HUD
 * reputation counter, so the reputation income always reads as coming from
 * the street.
 */
export function dissolveReputationCoins(
  animator: MainStreetAnimatorContext,
  targets: Array<{ x: number; y: number; slotIndex?: number }>,
): Array<{ x: number; y: number }> {
  const s = animator.scene;
  try {
    const sources = s?.msPedestrians?.dissolveIntoCoins?.(targets);
    if (Array.isArray(sources) && sources.length === targets.length) return sources;
  } catch (_) {
    // presentation-only
  }
  const anchor = pedestrianStreetAnchor(s?.layout);
  return targets.map(() => ({ ...anchor }));
}

/**
 * Reconcile the ambient street crowd to the authoritative HUD reputation
 * value (MS-0MUYGFWKG008GUA5). Presentation-only and defensive: a throwing
 * crowd layer can never stall the HUD update or the turn.
 *
 * This is the **only** path that raises the layer's population, so skipping or
 * early-returning it leaves an attached but empty crowd, silently — see the
 * lifecycle and attach contract in
 * `docs/game/ux-visual-audio.md` § "Ambient street pedestrians (reputation
 * crowd)" (MS-0MVRMI1EQ002I24K).
 */
function syncPedestrianPopulation(scene: MainStreetAnimatorContext['scene'], reputation: number): void {
  try {
    scene?.msPedestrians?.setPopulation?.(pedestrianCount(reputation));
  } catch (_) {
    // Presentation-only.
  }
}


export function animateHudValueChanges(animator: MainStreetAnimatorContext, params: {
    coins: number;
    reputation: number;
    coinX: number;
    repX: number;
    hudY: number;
  }): void {

    const s = animator.scene;
    const { coins, reputation, coinX, repX, hudY } = params;

    // Live population reconciliation (MS-0MUYGFWKG008GUA5): the same HUD
    // update path that renders the reputation counter also reconciles the
    // ambient crowd, so the on-street count always matches the HUD value.
    syncPedestrianPopulation(s, reputation);

    if (s.previousCoins === null || s.previousReputation === null) {
      s.previousCoins = coins;
      s.previousReputation = reputation;
      return;
    }

    const reducedMotion = s.settingsPanel?.reducedMotion;
    // While the end-of-turn income collection animation is running, the
    // immediate HUD delta pop is suppressed — the collection's final
    // "+total" pop (animateIncomeCollection) is the single landing
    // feedback. The income sound/event routing below is still performed.
    const suppressDeltaPop = s.incomeCollectionActive === true;

    if (coins !== s.previousCoins) {
      const delta = coins - s.previousCoins;
      if (!suppressDeltaPop) {
        const text = s.add.text(coinX, hudY - 6, `${delta > 0 ? '+' : ''}${delta}`, {
          fontSize: '16px',
          fontStyle: 'bold',
          color: delta >= 0 ? '#ffdd66' : '#ff7777',
          fontFamily: FONT_FAMILY,
        }).setOrigin(0.5).setDepth(500);
        void popTextOrIcon({
          scene: s,
          target: text,
          duration: 1500,
          riseY: 22,
          scale: 1.2,
          reducedMotion,
        });
      }
      try {
        if (delta > 0) {
          try { s.gameEvents?.emit('income-gained', { amount: delta }); } catch (_) {}
        } else if (delta < 0) {
          try { s.soundManager?.play(SFX_KEYS.INCOME_NEGATIVE); } catch (_) {}
        } else {
          try { s.soundManager?.play(SFX_KEYS.INCOME_NEUTRAL); } catch (_) {}
        }
      } catch (_) {}
    }

    if (reputation !== s.previousReputation) {
      const delta = reputation - s.previousReputation;
      if (!suppressDeltaPop) {
        const text = s.add.text(repX, hudY - 6, `${delta > 0 ? '+' : ''}${delta}`, {
          fontSize: '16px',
          fontStyle: 'bold',
          color: delta >= 0 ? '#99ccff' : '#ff8899',
          fontFamily: FONT_FAMILY,
        }).setOrigin(0.5).setDepth(500);
        void popTextOrIcon({
          scene: s,
          target: text,
          duration: 1500,
          riseY: 22,
          scale: 1.2,
          reducedMotion,
        });
      }
    }

    s.previousCoins = coins;
    s.previousReputation = reputation;
  
}

export function animateCelebration(animator: MainStreetAnimatorContext, challengeTitle: string): Promise<void> {

    const s = animator.scene;
    const reducedMotion = s.settingsPanel?.reducedMotion;

    // Center of the challenge tracker panel
    const cx = s.layout.challengeX + s.layout.challengeW / 2;
    const cy = s.layout.challengeY + 30;

    // Play the celebration sound
    try {
      s.soundManager?.play(SFX_KEYS.CELEBRATE);
    } catch (_) { /* ignore */ }

    if (reducedMotion) {
      // Reduced-motion: pop text only (no particles)
      return popTextOrIcon({
        scene: s,
        label: `\uD83C\uDF89 ${challengeTitle}`,
        x: cx,
        y: cy,
        duration: 200,
        reducedMotion: true,
        scale: 1.5,
      });
    }

    // Try particle burst
    try {
      const particleKey = 'celebrate-particle';
      if (!s.textures.exists(particleKey)) {
        const g = s.add.graphics();
        g.fillStyle(0xffdd44, 1);
        g.fillCircle(4, 4, 4);
        g.generateTexture(particleKey, 8, 8);
        g.destroy();
      }

      const texture = s.textures.get(particleKey);
      if (texture && s.add.particles) {
        const emitter = s.add.particles(cx, cy, particleKey, {
          speed: { min: 60, max: 200 },
          angle: { min: 0, max: 360 },
          scale: { start: 0.8, end: 0 },
          lifespan: 1000,
          quantity: 25,
          emitting: false,
          tint: [0xffdd44, 0x44ff44, 0x44aaff, 0xff6644, 0xdd88ff],
        });

        emitter.explode(25);

        // Show pop text alongside particles
        void popTextOrIcon({
          scene: s,
          label: `\uD83C\uDF89 ${challengeTitle}`,
          x: cx,
          y: cy - 30,
          duration: 1500,
          scale: 1.3,
          riseY: 40,
          style: { fontSize: '16px', fontStyle: 'bold', color: '#ffdd44' },
        });

        // Clean up after particles finish
        return new Promise<void>((resolve) => {
          s.time.delayedCall(1500, () => {
            try { emitter.destroy(); } catch (_) { /* ignore */ }
            resolve();
          });
        });
      }
    } catch (_) { /* ignore */ }

    // Fallback: pop text if particle system unavailable or errored
    return popTextOrIcon({
      scene: s,
      label: `\uD83C\uDF89 ${challengeTitle}`,
      x: cx,
      y: cy,
      duration: 600,
      scale: 2,
      riseY: 40,
      style: { fontSize: '18px', fontStyle: 'bold', color: '#ffdd44' },
    });
  
}

export function animateIncomeCollection(animator: MainStreetAnimatorContext, params: {

    /** Income result from `processEndOfTurn` (pre-multiplier totals). */
    income: {
      total: number;
      breakdown: SlotIncome[];
    };
    /** Per-slot reputation contributions (`currentReputationPerTurn > 0`). */
    repSources: Array<{ slotIndex: number; rep: number }>;
  }): void {

    const s = animator.scene;

    // Headless/replay exemption: no rendering or audio in those modes.
    if (s.replayMode) return;

    // Reduced motion: skip flights; the HUD refresh path provides the
    // single final pop + income sound.
    if (s.settingsPanel?.reducedMotion) return;

    const coinSources = params.income.breakdown.filter((b) => b.total > 0);
    if (coinSources.length === 0 && params.repSources.length === 0) return;

    const { hudY } = s.layout;
    // HUD landing targets (MS-0MUYT57J80021CWW): the published coin/reputation
    // number anchors, with a conservative fallback to the legacy approximate
    // coordinates before the first HUD render.
    const coinTarget = hudFlightTarget(s, 'coin', s.layout);
    const repTarget = hudFlightTarget(s, 'rep', s.layout);
    const flightMs = 600;
    const staggerMs = 50;

    s.incomeCollectionActive = true;
    let remaining = coinSources.length + params.repSources.length;

    const completeOne = (): void => {
      remaining -= 1;
      if (remaining > 0) return;
      // All flights landed — final "+total" pop at the coin counter.
      const totalText = s.add.text(coinTarget.x, hudY - 8, `+${params.income.total}`, {
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#ffdd66',
        fontFamily: FONT_FAMILY,
      }).setOrigin(0.5).setDepth(500);
      void popTextOrIcon({
        scene: s,
        target: totalText,
        duration: 1000,
        riseY: 24,
        scale: 1.3,
        reducedMotion: false, // collection only runs when reduced motion is off
      });
      s.incomeCollectionActive = false;
    };

    const launch = (
      from: { x: number; y: number },
      to: { x: number; y: number },
      kind: 'coin' | 'rep',
      delayMs: number,
    ): void => {
      s.time.delayedCall(delayMs, () => {
        const visual = s.add.circle(
          from.x,
          from.y,
          kind === 'coin' ? 6 : 5,
          kind === 'coin' ? 0xffcc44 : 0x88bbff,
          1,
        );
        visual.setDepth(3000);
        moveGameObject({
          scene: s,
          target: visual,
          destX: to.x,
          destY: to.y,
          duration: flightMs,
          ease: 'Quad.easeIn',
          soundManager: s.soundManager,
          // Coin flights pop; reputation pips are silent (no coin sound).
          sfx: kind === 'coin' ? { start: SFX_KEYS.COIN_POP } : undefined,
          onComplete: () => {
            visual.destroy();
            completeOne();
          },
        });
      });
    };

    coinSources.forEach((slot, i) => {
      launch(animator.getStreetSlotCenter(slot.slotIndex), { x: coinTarget.x, y: hudY }, 'coin', i * staggerMs);
    });
    params.repSources.forEach((slot, i) => {
      launch(animator.getStreetSlotCenter(slot.slotIndex), { x: repTarget.x, y: hudY }, 'rep', (coinSources.length + i) * staggerMs);
    });
  
}

/** True when at least one producing slot has a base-income coin to count out. */
function hasBaseIncome(slots: IncomePhaseSlot[]): boolean {
  return slots.some((sl) => iconsForAmount(Math.max(0, roundHalf(sl.pd.baseIncome))) > 0);
}

/** True when at least one producing slot has a reputation coin to fly in. */
function hasReputationIncome(slots: IncomePhaseSlot[]): boolean {
  return slots.some((sl) => iconsForAmount(roundHalf(sl.pd.repBonus)) > 0);
}

/** True when at least one producing slot carries a non-zero Upcoming delta. */
function hasUpcomingDeltas(slots: IncomePhaseSlot[]): boolean {
  return slots.some((sl) =>
    (sl.pd.upcomingDeltas ?? []).some((d) => iconsForAmount(Math.abs(roundHalf(d.delta))) > 0),
  );
}

/**
 * Per-phase emptiness predicate (MS-0MUYT436C005B4QN). A phase is empty when
 * nothing would be animated for it; empty phases are skipped outright by
 * {@link animateIncomePhases} — no label and no inter-phase gap.
 *
 * The conditions are the SAME ones each `runIncomePhase` case uses, so a
 * skipped phase can never hide a contribution the flights would have shown.
 */
function isIncomePhaseEmpty(animator: MainStreetAnimatorContext, key: IncomePhaseKey, slots: IncomePhaseSlot[]): boolean {
  switch (key) {
    case 'base':
      return !hasBaseIncome(slots);
    case 'synergy':
      return animator.synergyPhaseFlights(slots).length === 0;
    case 'reputation':
      return !hasReputationIncome(slots);
    case 'events':
      return animator.eventDeltaEffects(slots).length === 0;
    case 'upcoming':
      return !hasUpcomingDeltas(slots);
    default:
      return true;
  }
}

export function animateIncomePhases(animator: MainStreetAnimatorContext, phaseData: SlotPhaseBreakdown[], options: IncomePhaseOptions = {}): void {

    const s = animator.scene;

    // Headless/replay exemption (AC10): no rendering or audio in those modes.
    if (s.replayMode) return;

    const reducedMotion = s.settingsPanel?.reducedMotion === true;
    const gap = Math.max(1, options.phaseGapMs ?? INCOME_PHASE_GAP_MS);
    const startAt = Math.max(0, options.startDelayMs ?? 0);

    try {
      // Resolve producing slots to live card containers and create their
      // grids up front. Grids are parented to the card containers (child 2)
      // so coins move with the cards; later phases mutate them in place.
      const slots: IncomePhaseSlot[] = [];
      for (const pd of phaseData) {
        const card = animator.findStreetCardContainer(pd.slotIndex);
        if (!card) continue;
        slots.push({ pd, card, handle: createCoinGrid(s, card), displayed: 0 });
      }
      if (slots.length === 0) return;

      s.incomeCollectionActive = true;

      const emit = (phase: IncomePhaseKey, index: number): void => {
        try {
          options.onPhase?.(phase, index);
        } catch { /* ignore */ }
      };

      const phaseMeta: Array<{ key: IncomePhaseKey; label: string; color: number }> = [
        { key: 'base', label: 'Base income', color: 0xffdd66 },
        { key: 'synergy', label: 'Synergy', color: 0xb89bff },
        { key: 'reputation', label: 'Reputation', color: 0x88bbff },
        { key: 'events', label: 'Events', color: 0xff7744 },
        { key: 'upcoming', label: 'Upcoming', color: 0x55ddaa },
      ];

      // Skip empty phases entirely (MS-0MUYT436C005B4QN): only phases with a
      // non-zero contribution are scheduled, contiguously, so an empty phase
      // shows no label and consumes no `INCOME_PHASE_GAP_MS`. The canonical
      // order and the per-phase gap between SCHEDULED phases are unchanged.
      const activePhases = phaseMeta.filter((meta) => !isIncomePhaseEmpty(animator, meta.key, slots));

      let t = startAt;
      activePhases.forEach((meta, i) => {
        const at = t;
        s.time.delayedCall(at, () => {
          try {
            emit(meta.key, i);
            animator.showIncomePhaseLabel(meta.label, meta.color);
            animator.runIncomePhase(meta.key, slots, {
              reducedMotion,
              pendingDeltas: options.pendingDeltas,
            });
          } catch { /* ignore */ }
        });
        t += gap;
      });

      // `collect` always runs after the last scheduled phase — immediately
      // after `startAt` when every phase is empty, so the day never hangs.
      s.time.delayedCall(t, () => {
        try {
          emit('collect', activePhases.length);
          animator.collectIncomeGrids(slots, {
            reducedMotion,
            creditedTotal: animator.creditedIncomeTotal(phaseData),
            pendingDeltas: options.pendingDeltas,
          });
        } catch { /* ignore */ }
      });
    } catch {
      s.incomeCollectionActive = false;
    }
  
}

export function runIncomePhase(animator: MainStreetAnimatorContext, phase: IncomePhaseKey, slots: IncomePhaseSlot[], ctx: {
    reducedMotion: boolean;
    /** Deferred deltas so the reputation phase can fly income reputation to the HUD (MS-0MUYAESVU007X2U8 AC1). */
    pendingDeltas?: PendingEndOfTurnDeltas;
  }): void {

    const s = animator.scene;
    const numSlots = slots.length;

    switch (phase) {
      case 'base': {
        if (ctx.reducedMotion) return;
        let delayOffset = 0;
        for (let si = 0; si < numSlots; si++) {
          const slot = slots[si];
          const amount = Math.max(0, roundHalf(slot.pd.baseIncome));
          if (iconsForAmount(amount) === 0) {
            delayOffset += animator.getCardDelay(numSlots, si);
            continue;
          }
          animator.countOutCoins(slot, amount, delayOffset);
          // Audit (CG-0MTR766U6003RZ88): pause for 5× current stagger when
          // card's coin grid is full, then reduce stagger by 20% for next card.
          const pauseMs = INCOME_CARD_FULL_PAUSE_MULTIPLIER * animator.currentCoinStagger;
          delayOffset += animator.getCardDelay(numSlots, si) + pauseMs;
          animator.reduceCoinStaggerAfterCard();
        }
        break;
      }
      case 'synergy': {
        if (ctx.reducedMotion) return;
        // Bidirectional line-to-grid flights (CG-0MTV6LZEA003YS3E): for every
        // synergy pair, one coin stream per direction travels along the shared
        // clipped line (synergyLineEndpoints) from the giver's edge to the
        // receiver's edge, then pops into the receiver's on-card coin grid.
        // The phase no longer short-circuits while any slot has a synergy
        // bonus; `synergyPhaseFlights` already filters slots without one.
        const flights = animator.synergyPhaseFlights(slots);
        if (flights.length === 0) return;
        let at = 0;
        for (const flight of flights) {
          animator.flyCoinsAlongLine(flight.slot, flight.amount, flight.start, flight.end, at);
          // Per-line stagger (parallel flights never drift further than this).
          at += INCOME_FLIGHT_STAGGER_MS;
        }
        break;
      }
      case 'reputation': {
        if (ctx.reducedMotion) return;
        if (!slots.some((sl) => iconsForAmount(roundHalf(sl.pd.repBonus)) > 0)) return;
        // The reputation income is sourced from the on-street pedestrians
        // (MS-0MUYGFWXK003QFYB, reworked MS-0MUZ4WB290024ZGQ): each business's
        // coin stream dissolves out of a figure standing inside that business
        // — or any shop occupant / a street-area anchor when none are inside
        // a shop — never the HUD reputation counter. The credited amounts and
        // on-card `revealInGrid` landing are unchanged; pacing is the
        // near-instant model below.
        const slotCenters = slots.map((sl) => ({
          ...animator.getStreetSlotCenter(sl.pd.slotIndex),
          slotIndex: sl.pd.slotIndex,
        }));
        const sources = animator.dissolveReputationCoins(slotCenters);
        const streetAnchor = pedestrianStreetAnchor(s.layout);
        // HUD-bound reputation income (MS-0MUYAESVU007X2U8 AC1): the turn's
        // reputation income is flown as pips from each business's card to the
        // HUD reputation counter, so the "Reputation:" total ticks up as each
        // pip ARRIVES at the bar (the same HUD-arrival contract as coins —
        // presentation-only, never mutates state). Only the INCOME share is
        // flown here: the `upcoming` phase already flies the incident's rep
        // delta (signed) via flyRepPips, so it is excluded
        // (`pendingRepDelta` = income.repDelta + incidentRepChange, so
        // subtracting the upcoming rep share recovers the income share even
        // when the incident is a loss). The exact post-reconciliation value
        // is snapped at the final landing regardless.
        const repFlownUpcoming = slots.reduce(
          (sum, sl) => sum + (sl.pd.upcomingDeltas ?? [])
            .reduce((acc, d) => acc + (d.kind === 'rep' ? d.delta : 0), 0),
          0,
        );
        const incomeRep = Math.max(0, (ctx.pendingDeltas?.pendingRepDelta ?? 0) - repFlownUpcoming);
        // Distribute the income reputation across the producing slots by their
        // reputation bonus weight so the flown pips sum exactly to incomeRep
        // (one pip per exported slot when small).
        const totalRepBonus = slots.reduce(
          (sum, sl) => sum + Math.max(0, roundHalf(sl.pd.repBonus)),
          0,
        );
        const hudRepTarget = hudFlightTarget(s, 'rep', s.layout);
        // Near-instant launch (MS-0MV8LHN0W0017XU1): every producing
        // business's reputation coins/pips start with only the small
        // synergy-phase stagger (`INCOME_FLIGHT_STAGGER_MS`) between flights
        // — mirroring the synergy phase — instead of the sequential
        // per-business `getCardDelay` accumulation and full-grid pause. No
        // business waits for a prior business's reputation to finish before
        // launching; the whole phase launches within (n-1) × 60 ms. The gentle
        // per-card duration decrease (`getFlightDuration`) is retained for
        // readability. Sources, credited amounts and HUD-pip weighting are
        // unchanged. The phase no longer mutates the shared `currentCoinStagger`
        // (`reduceCoinStaggerAfterCard`) — base/events/upcoming own that
        // sequential bookkeeping — so only the reputation cards' 20% stagger
        // reduction is removed from later phases' pacing.
        let at = 0;
        for (let si = 0; si < numSlots; si++) {
          const slot = slots[si];
          const amount = Math.max(0, roundHalf(slot.pd.repBonus));
          // Zero-bonus slots are skipped outright — they accumulate no launch
          // delay in the near-instant model.
          if (iconsForAmount(amount) === 0) continue;
          const from = sources[si] ?? streetAnchor;
          const flightMs = animator.getFlightDuration(numSlots, si);
          animator.flyCoinsIn(slot, amount, from, at, flightMs);
          // Reputation income flies card → HUD rep counter, ticking per pip
          // landing (the display-only running total; see flyRepPips). Each
          // exporting slot carries its proportional share of incomeRep.
          if (incomeRep > 0 && totalRepBonus > 0) {
            const slotRepShare = incomeRep * (amount / totalRepBonus);
            animator.flyRepPips(from, hudRepTarget, slotRepShare, at, flightMs, slotRepShare);
          }
          // Per-business launch stagger only — the synergy-phase model.
          at += INCOME_FLIGHT_STAGGER_MS;
        }
        break;
      }
      case 'events': {
        if (ctx.reducedMotion) return;
        const deltaEffects = animator.eventDeltaEffects(slots);
        if (deltaEffects.length === 0) return;
        const lineStartRow = (s.state.activeEffects ?? []).length;
        deltaEffects.forEach((effect, ei) => {
          try {
            s.msRenderer?.animateUpcomingEffectLine?.(effect, lineStartRow + ei);
          } catch { /* ignore */ }
          // Coins in/out per affected slot for this effect.
          let effectDelayOffset = 0;
          for (let si = 0; si < numSlots; si++) {
            const slot = slots[si];
            const delta = slot.pd.eventDeltas.reduce(
              (acc, d) => (d.cardId === effect.sourceEventId ? acc + d.delta : acc),
              0,
            );
            if (delta === 0) {
              effectDelayOffset += animator.getCardDelay(numSlots, si);
              continue;
            }
            if (iconsForAmount(Math.abs(roundHalf(delta))) === 0) {
              effectDelayOffset += animator.getCardDelay(numSlots, si);
              continue;
            }
            const amount = Math.abs(roundHalf(delta));
            const flightMs = animator.getFlightDuration(numSlots, si);
            const at = effectDelayOffset;
            if (delta > 0) {
              animator.flyCoinsIn(slot, amount, animator.eventSourcePoint(), at, flightMs);
            } else {
              animator.flyCoinsOut(slot, amount, animator.eventSourcePoint(), at, flightMs);
            }
            const pauseMs = INCOME_CARD_FULL_PAUSE_MULTIPLIER * animator.currentCoinStagger;
            effectDelayOffset += animator.getCardDelay(numSlots, si) + pauseMs;
            animator.reduceCoinStaggerAfterCard();
          }
        });
        break;
      }
      case 'upcoming': {
        if (ctx.reducedMotion) return;
        // "Upcoming" phase (CG-0MUA1UH3A008M4BS): routes each Upcoming-card
        // coin AND reputation delta using one uniform sign rule — a gain flows
        // from the actor to the HUD resource, a loss flows from the HUD
        // resource to the actor (incident-reveal convention,
        // CG-0MU41XVNV002N2D9). The actor is the affected business card when
        // attached (source `EventCard.target` = `SpecificSynergy` /
        // `RandomBusiness`), otherwise the Upcoming panel. Producer manual
        // review (2026-10-01): the flow must go card → HUD for a gain and
        // HUD → card for a loss, for both coins and reputation. No Upcoming
        // delta touches a business coin grid — the grid is reserved for
        // credited income. Presentation-only: never mutates state or the
        // credited total.
        const upcomingSource = { x: s.layout.gameW * 0.5, y: s.layout.queueTop };
        // HUD destinations: the published coin/reputation number anchors
        // (MS-0MUYT57J80021CWW), falling back to the legacy approximate
        // coordinates before the first HUD render.
        const hudCoin = hudFlightTarget(s, 'coin', s.layout);
        const hudRep = hudFlightTarget(s, 'rep', s.layout);
        let delayOffset = 0;
        for (let si = 0; si < numSlots; si++) {
          const slot = slots[si];
          for (const d of slot.pd.upcomingDeltas ?? []) {
            const amount = Math.abs(roundHalf(d.delta));
            if (iconsForAmount(amount) === 0) continue;
            const flightMs = animator.getFlightDuration(numSlots, si);
            const at = delayOffset;
            const route = resolveDeltaFlow(d, {
              upcomingSource,
              slotCenter: animator.getStreetSlotCenter(slot.pd.slotIndex),
              hudCoin,
              hudRep,
            });
            if (route.kind === 'coin') {
              // Attached (business card ↔ HUD coin counter) and unattached
              // (Upcoming panel ↔ HUD coin counter) coin deltas both fly
              // point-to-point without touching a business grid. The signed
              // delta steps the display-only coin total as each icon lands /
              // departs (MS-0MUYAESVU007X2U8).
              animator.flyCoinsToPoint(route.from, route.to, amount, at, flightMs, d.delta);
            } else {
              // Reputation parity (AC3): same attachment + direction rule,
              // flying reputation pips instead of coins.
              animator.flyRepPips(route.from, route.to, amount, at, flightMs, d.delta);
            }
          }
          const pauseMs = INCOME_CARD_FULL_PAUSE_MULTIPLIER * animator.currentCoinStagger;
          delayOffset += animator.getCardDelay(numSlots, si) + pauseMs;
          animator.reduceCoinStaggerAfterCard();
        }
        break;
      }
      default:
        break;
    }
  
}

export function eventDeltaEffects(animator: MainStreetAnimatorContext, slots: IncomePhaseSlot[]): Array<{
    sourceEventId: string;
    description: string;
  }> {

    const s = animator.scene;
    const byId = new Map<string, string>();
    for (const slot of slots) {
      for (const d of slot.pd.eventDeltas ?? []) {
        if (!byId.has(d.cardId)) byId.set(d.cardId, d.name);
      }
    }
    for (const effect of s.state.activeEffects ?? []) {
      if (effect.effectType === 'income-multiplier' && byId.has(effect.sourceEventId)) {
        byId.set(effect.sourceEventId, effect.description);
      }
    }
    return [...byId.entries()].map(([sourceEventId, description]) => ({ sourceEventId, description }));
  
}

export function countOutCoins(animator: MainStreetAnimatorContext, slot: IncomePhaseSlot, amount: number, at: number): void {

    const s = animator.scene;
    const iconCount = iconsForAmount(amount);
    if (iconCount === 0) return;
    for (let n = 1; n <= iconCount; n++) {
      s.time.delayedCall(at + animator.getIconStagger(iconCount, n - 1), () => {
        try {
          // Incrementally add one coin at a time (half coin last) so the
          // grid accumulates across phases (AC: stay visible until collect).
          const increment = 1;
          animator.revealInGrid(slot, Math.round(slot.displayed + increment));
        } catch { /* ignore */ }
      });
    }
  
}

export function revealInGrid(animator: MainStreetAnimatorContext, slot: IncomePhaseSlot, cumulativeAmount: number): void {

    const s = animator.scene;
    slot.displayed = cumulativeAmount;
    const layout = slot.handle.addCoins(cumulativeAmount);
    if (!layout) return;
    const icons = slot.handle.container.list;
    const last = icons[icons.length - 1] as Phaser.GameObjects.Image | undefined;
    if (last) {
      last.setScale(0);
      s.tweens.add({
        targets: last,
        scaleX: 1,
        scaleY: 1,
        duration: 220,
        ease: 'Back.easeOut',
      });
    }
    try { s.soundManager?.play(SFX_KEYS.COIN_POP); } catch { /* ignore */ }
  
}

export function flyCoinsIn(animator: MainStreetAnimatorContext, 
    slot: IncomePhaseSlot,
    amount: number,
    from: { x: number; y: number },
    at: number,
    flightMs?: number,
  ): void {

    const s = animator.scene;
    const iconCount = iconsForAmount(amount);
    if (iconCount === 0) return;
    const duration = flightMs ?? INCOME_FLIGHT_MS;
    const m = slot.handle.container.getWorldTransformMatrix();
    const to = { x: m.getX(0, 0), y: m.getY(0, 0) };
    for (let i = 0; i < iconCount; i++) {
      s.time.delayedCall(at + animator.getIconStagger(iconCount, i), () => {
        try {
          const visual = s.add.circle(from.x, from.y, 6, 0xffcc44, 1).setDepth(3000);
          moveGameObject({
            scene: s,
            target: visual,
            destX: to.x,
            destY: to.y,
            duration,
            ease: 'Quad.easeIn',
            soundManager: s.soundManager,
            sfx: { start: SFX_KEYS.COIN_POP, moveIntervalMs: 200 },
            onComplete: () => {
              try {
                visual.destroy();
                // Incrementally add one landed coin (half coin last) so
                // concurrent phases accumulate robustly.
                const increment = 1;
                animator.revealInGrid(slot, Math.round(slot.displayed + increment));
              } catch { /* ignore */ }
            },
          });
        } catch { /* ignore */ }
      });
    }
  
}

export function flyCoinsAlongLine(animator: MainStreetAnimatorContext, 
    slot: IncomePhaseSlot,
    amount: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
    at: number,
    flightMs?: number,
  ): void {

    const s = animator.scene;
    const iconCount = iconsForAmount(amount);
    if (iconCount === 0) return;
    const duration = flightMs ?? INCOME_FLIGHT_MS;
    for (let i = 0; i < iconCount; i++) {
      s.time.delayedCall(at + i * INCOME_FLIGHT_STAGGER_MS, () => {
        try {
          const visual = s.add.circle(from.x, from.y, 6, 0xffcc44, 1).setDepth(3000);
          moveGameObject({
            scene: s,
            target: visual,
            destX: to.x,
            destY: to.y,
            duration,
            ease: 'Quad.easeIn',
            soundManager: s.soundManager,
            sfx: { start: SFX_KEYS.COIN_POP, moveIntervalMs: 200 },
            onComplete: () => {
              try {
                visual.destroy();
                // Arrival increments the receiver's on-card grid (same
                // incremental accumulation as base/reputation phases).
                animator.revealInGrid(slot, Math.round(slot.displayed + 1));
              } catch { /* ignore */ }
            },
          });
        } catch { /* ignore */ }
      });
    }
  
}

export function flyCoinsOut(animator: MainStreetAnimatorContext, 
    slot: IncomePhaseSlot,
    amount: number,
    to: { x: number; y: number },
    at: number,
    flightMs?: number,
  ): void {

    const s = animator.scene;
    const grid = slot.handle.container;
    const iconCount = iconsForAmount(amount);
    if (iconCount === 0) return;
    const duration = flightMs ?? INCOME_FLIGHT_MS;
    // Decrement sequence: 1 icon per 100 coins (x100 economy presentation scaling).
    const decrements: number[] = [];
    for (let k = 0; k < iconCount; k++) decrements.push(1);
    for (let i = 0; i < iconCount; i++) {
      s.time.delayedCall(at + animator.getIconStagger(iconCount, i), () => {
        try {
          const icon = grid.list[grid.list.length - 1] as Phaser.GameObjects.Image | undefined;
          if (!icon) return; // no coins left in the grid to remove
          // Decrement incrementally from the live displayed total so
          // concurrent negative deltas accumulate correctly.
          slot.displayed = Math.round(Math.max(0, slot.displayed - decrements[i]));
          const m = icon.getWorldTransformMatrix();
          const from = { x: m.getX(0, 0), y: m.getY(0, 0) };
          grid.remove(icon);
          s.add.existing(icon);
          icon.setPosition(from.x, from.y).setDepth(3000);
          moveGameObject({
            scene: s,
            target: icon,
            destX: to.x,
            destY: to.y,
            duration,
            ease: 'Quad.easeIn',
            onComplete: () => {
              try { icon.destroy(); } catch { /* ignore */ }
            },
          });
          s.tweens.add({ targets: icon, alpha: 0, duration, delay: duration * 0.4 });
        } catch { /* ignore */ }
      });
    }
  
}

/**
 * Flies `amount` coin visuals point-to-point WITHOUT touching any business
 * coin grid (CG-0MUA1UH3A008M4BS). Used for all Upcoming coin deltas: a gain
 * flows from the actor (business card when attached, otherwise the Upcoming
 * panel) to the HUD coin counter; a loss flows HUD coin counter → actor
 * (producer manual review 2026-10-01). Each coin plays the shared
 * `sfx-coin-pop` at launch, matching the grid flights.
 */
export function flyCoinsToPoint(animator: MainStreetAnimatorContext,
    from: { x: number; y: number },
    to: { x: number; y: number },
    amount: number,
    at: number,
    flightMs?: number,
    /**
     * Signed delta this flight represents, for the display-only running total
     * (MS-0MUYAESVU007X2U8). When provided, each coin landing steps the HUD
     * coin total by `displayDelta / iconCount`, so the total tracks the flight
     * and sums exactly to the delta. Absent on the legacy call sites — the step
     * then no-ops (the counter is not counting).
     */
    displayDelta?: number,
  ): void {

    const s = animator.scene;
    const iconCount = iconsForAmount(amount);
    if (iconCount === 0) return;
    const duration = flightMs ?? INCOME_FLIGHT_MS;
    const perIcon = (displayDelta ?? 0) / iconCount;
    // A loss departs from the HUD, a gain lands on it — step the display-only
    // total at the HUD end of the flight (MS-0MUYAESVU007X2U8 AC1/AC2).
    const stepOnLaunch = (displayDelta ?? 0) < 0;
    for (let i = 0; i < iconCount; i++) {
      s.time.delayedCall(at + animator.getIconStagger(iconCount, i), () => {
        try {
          if (stepOnLaunch) stepDisplayedTotal(s, 'coin', perIcon);
          const visual = s.add.circle(from.x, from.y, 6, 0xffcc44, 1).setDepth(3000);
          moveGameObject({
            scene: s,
            target: visual,
            destX: to.x,
            destY: to.y,
            duration,
            ease: 'Quad.easeIn',
            soundManager: s.soundManager,
            sfx: { start: SFX_KEYS.COIN_POP, moveIntervalMs: 200 },
            onComplete: () => {
              try { visual.destroy(); } catch { /* ignore */ }
              if (!stepOnLaunch) stepDisplayedTotal(s, 'coin', perIcon);
            },
          });
        } catch { /* ignore */ }
      });
    }
  
}

/**
 * Flies `amount` reputation-pip visuals point-to-point (CG-0MUA1UH3A008M4BS
 * AC3, reputation parity). Used for Upcoming reputation deltas with the same
 * attachment and direction rule as coins: a gain flows from the actor
 * (business card when attached, otherwise the Upcoming panel) to the HUD
 * reputation counter; a loss flows HUD counter → actor. Reputation pips are
 * silent, matching the reputation income phase.
 *
 * A provided `displayDelta` steps the display-only reputation total per pip
 * (MS-0MUYAESVU007X2U8).
 */
export function flyRepPips(animator: MainStreetAnimatorContext,
    from: { x: number; y: number },
    to: { x: number; y: number },
    amount: number,
    at: number,
    flightMs?: number,
    /** Signed reputation delta for the display-only running total (see flyCoinsToPoint). */
    displayDelta?: number,
  ): void {

    const s = animator.scene;
    const iconCount = iconsForAmount(amount);
    if (iconCount === 0) return;
    const duration = flightMs ?? INCOME_FLIGHT_MS;
    const perIcon = (displayDelta ?? 0) / iconCount;
    const stepOnLaunch = (displayDelta ?? 0) < 0;
    for (let i = 0; i < iconCount; i++) {
      s.time.delayedCall(at + animator.getIconStagger(iconCount, i), () => {
        try {
          if (stepOnLaunch) stepDisplayedTotal(s, 'rep', perIcon);
          const visual = s.add.circle(from.x, from.y, 5, 0x88bbff, 1).setDepth(3000);
          moveGameObject({
            scene: s,
            target: visual,
            destX: to.x,
            destY: to.y,
            duration,
            ease: 'Quad.easeIn',
            onComplete: () => {
              try { visual.destroy(); } catch { /* ignore */ }
              if (!stepOnLaunch) stepDisplayedTotal(s, 'rep', perIcon);
            },
          });
        } catch { /* ignore */ }
      });
    }
  
}

export function applyPendingDeltasOnce(animator: MainStreetAnimatorContext, deltas: PendingEndOfTurnDeltas | undefined): void {

    if (!deltas) return;
    const s = animator.scene;
    try {
      if (!s.endOfTurnDeltasApplied) {
        applyEndOfTurnDeltas(s.state, deltas);
        s.endOfTurnDeltasApplied = true;
      }
    } catch { /* presentation-only — never break the choreography */ }
  
}

/**
 * The credited invoice amount collected from one slot's grid (base + synergy +
 * reputation + event deltas — the same components `creditedIncomeTotal` sums
 * per turn). Used to price each collected grid icon for the display-only HUD
 * counting (MS-0MUYAESVU007X2U8): a slot with N icons contributes this amount
 * split evenly across its N flights, so the collection totals exactly the
 * income the grid represented.
 */
function creditedSlotAmount(pd: SlotPhaseBreakdown): number {
  let sum = (pd?.baseIncome ?? 0) + (pd?.synergyBonus ?? 0) + (pd?.repBonus ?? 0);
  for (const d of pd?.eventDeltas ?? []) sum += d.delta;
  return sum;
}

export function collectIncomeGrids(animator: MainStreetAnimatorContext, slots: IncomePhaseSlot[], ctx: {
    reducedMotion: boolean;
    creditedTotal: number;
    /** Deferred-mutation deltas to apply when the collection finishes (CG-0MTR72P14000VO6Q). */
    pendingDeltas?: PendingEndOfTurnDeltas;
  }): void {

    const s = animator.scene;
    const { hudY } = s.layout;
    // HUD landing target (MS-0MUYT57J80021CWW): the published coin number
    // anchor, with a conservative fallback before the first HUD render.
    const coinTarget = hudFlightTarget(s, 'coin', s.layout);
    const numSlots = slots.length;

    let pending = 0;
    const finalize = (): void => {
      try {
        // Deferred-mutation application (CG-0MTR72P14000VO6Q AC3): apply the
        // pending deltas in a single step once the coin-grid flight lands,
        // BEFORE the incomeCollectionActive flag clears — the final
        // refreshAll (in finishTurnPresentation) then shows the new values.
        // Idempotent: the scene guard ensures at-most-once across the income
        // and incident animations.
        animator.applyPendingDeltasOnce(ctx.pendingDeltas);
        // Display-only totals (MS-0MUYAESVU007X2U8): the phased choreography
        // has counted its flights — mark it so the incident-reveal replay
        // never double-counts the same "Upcoming" delta, and snap the running
        // totals to the authoritative post-reconciliation values so the HUD
        // lands exactly on the final value at the last collection landing
        // (per-icon rounding and unanimated ongoing costs are absorbed here).
        if (ctx.pendingDeltas) {
          s.displayedIncomeCounted = true;
          snapDisplayedTotals(s, ctx.pendingDeltas);
        }
        if (!ctx.reducedMotion || pending === 0) {
          const totalText = s.add.text(coinTarget.x, hudY - 8, `+${ctx.creditedTotal}`, {
            fontSize: '18px',
            fontStyle: 'bold',
            color: '#ffdd66',
            fontFamily: FONT_FAMILY,
          }).setOrigin(0.5).setDepth(500);
          void popTextOrIcon({
            scene: s,
            target: totalText,
            duration: 1000,
            riseY: 24,
            scale: 1.3,
            reducedMotion: false,
          });
          try { s.soundManager?.play(SFX_KEYS.INCOME_POSITIVE); } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      for (const slot of slots) {
        try { slot.handle.container.destroy(); } catch { /* ignore */ }
      }
      s.incomeCollectionActive = false;
    };

    if (ctx.reducedMotion) {
      finalize();
      return;
    }

    // Collect one card's grid at a time (sequential per-slot).
    let delayOffset = 0;
    for (let si = 0; si < numSlots; si++) {
      const slot = slots[si];
      const grid = slot.handle.container;
      const icons = [...grid.list];
      // Display-only counting (MS-0MUYAESVU007X2U8): each collected icon steps
      // the HUD coin total by an equal share of the slot's credited amount, so
      // the running total tracks the collection and sums exactly per slot.
      const iconCount = icons.length;
      const perIcon = iconCount > 0 ? creditedSlotAmount(slot.pd) / iconCount : 0;
      const flightMs = animator.getFlightDuration(numSlots, si);
      for (let i = 0; i < icons.length; i++) {
        const icon = icons[i] as Phaser.GameObjects.Image;
        pending += 1;
        s.time.delayedCall(delayOffset + i * INCOME_COLLECT_STAGGER_MS, () => {
          try {
            const m = icon.getWorldTransformMatrix();
            const from = { x: m.getX(0, 0), y: m.getY(0, 0) };
            grid.remove(icon);
            s.add.existing(icon);
            icon.setPosition(from.x, from.y).setDepth(3000);
            moveGameObject({
              scene: s,
              target: icon,
              destX: coinTarget.x,
              destY: hudY,
              duration: flightMs,
              ease: 'Quad.easeIn',
              soundManager: s.soundManager,
              sfx: { start: SFX_KEYS.COIN_POP, moveIntervalMs: 200 },
              onComplete: () => {
                try { icon.destroy(); } catch { /* ignore */ }
                stepDisplayedTotal(s, 'coin', perIcon);
                pending -= 1;
                if (pending <= 0) finalize();
              },
            });
          } catch {
            pending -= 1;
            if (pending <= 0) finalize();
          }
        });
      }
      delayOffset += animator.getCardDelay(numSlots, si);
    }
    if (pending === 0) finalize();
  
}

export function showIncomePhaseLabel(animator: MainStreetAnimatorContext, text: string, color: number): void {

    const s = animator.scene;
    try {
      const label = s.add.text(
        s.layout.gameW * 0.5,
        Math.max(24, s.layout.streetTop - 10),
        text,
        {
          fontSize: '15px',
          fontStyle: 'bold',
          color: '#' + color.toString(16).padStart(6, '0'),
          fontFamily: FONT_FAMILY,
        },
      ).setOrigin(0.5).setDepth(510).setAlpha(0);
      s.tweens.add({ targets: label, alpha: 1, duration: 160, ease: 'Quad.easeOut' });
      s.time.delayedCall(INCOME_PHASE_LABEL_MS, () => {
        try {
          s.tweens.add({
            targets: label,
            alpha: 0,
            duration: 220,
            onComplete: () => {
              try { label.destroy(); } catch { /* ignore */ }
            },
          });
        } catch { /* ignore */ }
      });
    } catch { /* ignore */ }
  
}
