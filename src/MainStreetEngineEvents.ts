/**
 * Main Street: Event Resolution
 *
 * Resolution of Investment/Incident events (single-player and competitive)
 * and the duration/incident helper predicates.
 *
 * @module
 */

import { createActiveEffect } from '@core-engine/ActiveEffect';
import { applyCompetitiveIncome, getSlotOwnerId } from './MainStreetAdjacency';
import type { EventCard, SynergyType, SpecializationSkill, DurationEventCard } from './MainStreetCards';
import { isDurationEventCard } from './MainStreetCards';
import { applyReputationMultiplier, roundInt } from './MainStreetDifficulty';
import { computeIncidentSkillBuffs, computeReputationGainMultiplier, getEmployedSpecializationSkills, computeTaxAuditRate, computeProportionalCoinLoss } from './MainStreetStaffBuffs';
import { deserializeSkillIds } from './MainStreetStaffSkills';
import type { MainStreetState, PlayerRecord, PendingPiggybackDecision } from './MainStreetState';
import { addLog, syncResourceBankToLedger, describeEventEffects, classifyEffect } from './MainStreetState';
import { recordMainStreetEvent } from './MainStreetTranscript';

/**
 * Resolves a single event card's effects on the game state.
 *
 * DurationEventCards branch to ActiveEffect creation instead of applying
 * one-shot coin/reputation deltas. Regular EventCards apply deltas as before.
 */
export function resolveEvent(state: MainStreetState, event: EventCard): void {
  // ── DurationEventCard branch ────────────────────────────────
  if (isDurationEventCard(event)) {
    const dEvent = event as DurationEventCard;

    // Compute effective duration (check clinic/medical center for duration
    // mitigation — negative effects only; positive effects keep full duration).
    let effectiveDuration = computeDurationWithClinicReduction(dEvent.duration, state, dEvent.multiplier);

    // Create the ActiveEffect
    const effect = createActiveEffect(
      dEvent.effectType,
      dEvent.multiplier,
      effectiveDuration,
      dEvent.id,
      `${dEvent.name}: ${dEvent.effect}`,
    );
    state.activeEffects.push(effect);

    // Log the onset (generic wording covering both negative cuts and
    // positive boosts — Group C adds positive income-multiplier and
    // rep-multiplier effects).
    const multiplierLabel = Math.round(dEvent.multiplier * 100);
    const what = dEvent.effectType === 'rep-multiplier' ? 'Reputation' : 'Income';
    const logText = effectiveDuration > 0
      ? `${dEvent.name}: ${what} multiplier ${multiplierLabel}% for ${effectiveDuration} turns`
      : `${dEvent.name}: Resolved with no effect (fully neutralized)`;
    addLog(state, logText, 'loss');

    // Record transcript event
    recordMainStreetEvent({
      type: 'active-effect',
      turn: state.turn,
      effectType: dEvent.effectType,
      sourceEventId: dEvent.id,
      duration: effectiveDuration,
      description: logText,
    });

    syncResourceBankToLedger(state);
    return;
  }

  // ── Regular EventCard resolution ────────────────────────────
  // Staff specialization incident/rep buffs (I4, CG-0MT4WXV2J000M35M):
  // damage reductions apply to Incident events only; the Brand Ambassador
  // +50% gains multiplier applies to positive reputation deltas from both
  // incidents and investments.
  const employedSkills = getEmployedSpecializationSkills(state);
  const repGainMultiplier = computeReputationGainMultiplier(employedSkills);
  const incidentBuffs = event.trigger === 'Incident' ? computeIncidentSkillBuffs(employedSkills) : null;
  const theftNeutralized =
    incidentBuffs !== null && incidentBuffs.immuneToTheftLoss && isTheftLossIncident(event);
  /** Effective coin delta after quality-inspector / security-consultant mitigation (integer). */
  const cDelta = (effect: number): number => {
    if (theftNeutralized && effect < 0) return 0; // theft immunity: no coin loss
    if (incidentBuffs === null || effect >= 0) return roundInt(effect);
    return roundInt(effect + Math.abs(effect) * incidentBuffs.coinDamageReductionPct);
  };
  /** Effective reputation delta after brand-ambassador / compliance mitigation (integer). */
  const rDelta = (effect: number): number => {
    if (effect > 0) return roundInt(effect * repGainMultiplier);
    if (incidentBuffs === null) return roundInt(effect);
    return roundInt(Math.min(0, effect + incidentBuffs.reputationDamageReductionFlat));
  };
  const rep = state.resourceBank.reputation;
  const cfg = state.config;
  // Event's own coin delta before staff mitigation / reputation scaling:
  // flat events use `coinDelta`; proportional events (CG-0MTQ7W0ZX0059R3J)
  // collect a percentage of the current banked balance at the effective rate.
  const baseCoinDelta = eventCoinDeltaFor(state, event);

  switch (event.target) {
    case 'SpecificSynergy': {
      // Count matching businesses and apply coinDelta per match. A
      // proportional event is a whole-balance effect, so its loss is applied
      // once rather than per match.
      const matchCount = state.streetGrid.filter(
        b => b !== null && b.synergyTypes.includes(event.targetSynergy as SynergyType),
      ).length;
      const rawDelta = event.coinPercentDelta !== undefined
        ? baseCoinDelta
        : baseCoinDelta * matchCount;
      state.resourceBank.coins += applyReputationMultiplier(cDelta(rawDelta), rep, cfg);
      state.resourceBank.reputation += rDelta(event.reputationDelta);
      break;
    }
    case 'All': {
      // Apply to all -- direct delta on resource bank
      state.resourceBank.coins += applyReputationMultiplier(cDelta(baseCoinDelta), rep, cfg);
      state.resourceBank.reputation += rDelta(event.reputationDelta);
      break;
    }
    case 'RandomBusiness': {
      // Pick a random placed business and apply effect
      const placed = state.streetGrid.filter(b => b !== null);
      if (placed.length > 0) {
        // Use RNG for deterministic random selection
        // Consume RNG for deterministic selection (used in future milestones)
        const _targetIdx = Math.floor(state.rng() * placed.length);
        void _targetIdx;
        state.resourceBank.coins += applyReputationMultiplier(cDelta(baseCoinDelta), rep, cfg);
      }
      state.resourceBank.reputation += rDelta(event.reputationDelta);
      break;
    }
  }

  // Sync shared EconomyLedger after resourceBank mutations
  syncResourceBankToLedger(state);
}

/**
 * The event's own coin delta before staff mitigation and reputation scaling
 * (CG-0MTQ7W0ZX0059R3J).
 *
 * Flat-delta events return `event.coinDelta` unchanged. Proportional events
 * (`coinPercentDelta` defined) collect a percentage of the player's banked
 * coins RIGHT NOW: the base rate comes from the card (45% for the Tax Audit),
 * an employed staff member's `taxAuditRate` may lower it (the Accountant's
 * 25%), and the loss is rounded to the nearest integer and clamped so the
 * balance never drops below 0.
 *
 * Reads `state.resourceBank.coins` only and consumes no RNG — safe for
 * deterministic replay and CPU-side AI projection. This is the single source
 * of truth shared by {@link resolveEvent}, {@link computeEventDeltas} and
 * `projectEventCoinDelta` so the live, deferred and AI paths never diverge.
 *
 * @param state Current game state (read-only).
 * @param event The event being resolved / projected.
 * @returns The signed coin delta (negative = loss).
 */
export function eventCoinDeltaFor(state: MainStreetState, event: EventCard): number {
  if (event.coinPercentDelta === undefined) return event.coinDelta;
  const baseRate = Math.abs(event.coinPercentDelta);
  const rate = computeTaxAuditRate(state.staffCards ?? [], baseRate);
  return -computeProportionalCoinLoss(state.resourceBank.coins, rate);
}

/**
 * Plays and resolves an Investment event card from the player's hand.
 * Can only be called during the MarketPhase.
 *
 * @param state      Current game state (mutated in-place).
 * @param handIndex  Optional index of the event card in `state.hand` to play.
 *                   When omitted, the first event-family card in the hand is
 *                   played (backward-compatible with the old single-held-event
 *                   semantics used by tests and the AI).
 * @throws Error if no Investment event is found at the given index / in the hand.
 */
export function playHeldEvent(state: MainStreetState, handIndex?: number): void {
  const hand = state.hand ?? [];
  let index = handIndex;
  if (index === undefined) {
    index = hand.findIndex(c => c.family === 'event');
  }
  if (index === undefined || index < 0 || index >= hand.length) {
    throw new Error('No Investment event is currently held in hand.');
  }
  const card = hand[index];
  if (card.family !== 'event') {
    throw new Error(`Card at hand index ${index} is not an Investment event.`);
  }
  const event = card as EventCard;
  const coinsBefore = state.resourceBank.coins;
  const repBefore = state.resourceBank.reputation;
  resolveEvent(state, event);
  // Investment played by the active player: per-owner routing in competitive
  // mode (CG-0MTIIL6J200291ZQ) — benefit lands in the acting player's wallet.
  if ((state.players?.length ?? 0) > 1) {
    applyCompetitiveEventEffects(state, event, state.activePlayerId ?? 0);
  }
  // F3 (epic MS-0MUYC47EL005Z69H): an eligible organiser event raises one
  // pending piggyback decision per other active seat after the acting player's
  // effects resolve. No-op in N=1 / for non-eligible events.
  raisePiggybackDecisions(state, event, state.activePlayerId ?? 0, event.cost);
  const coinChange = state.resourceBank.coins - coinsBefore;
  const repChange = state.resourceBank.reputation - repBefore;
  addLog(
    state,
    state.activePlayerId ?? 0,
    `Investment: ${event.name} (${describeEventEffects(coinChange, repChange)})`,
    classifyEffect(coinChange, repChange),
  );
  hand.splice(index, 1);
}

/**
 * Resolves any remaining Investment event card from the player's hand.
 *
 * NOTE: This is no longer called automatically during processEndOfTurn.
 * Held events persist across turns until the player actively plays them
 * via the 'play-event' action during the MarketPhase. This function is
 * retained for programmatic / test use.
 *
 * @returns The resolved event, or null if no event was in hand.
 */
export function resolveHeldInvestment(state: MainStreetState): EventCard | null {
  const hand = state.hand ?? [];
  const index = hand.findIndex(c => c.family === 'event');
  if (index === -1) return null;

  const event = hand[index] as EventCard;
  const coinsBefore = state.resourceBank.coins;
  const repBefore = state.resourceBank.reputation;
  resolveEvent(state, event);
  const coinChange = state.resourceBank.coins - coinsBefore;
  const repChange = state.resourceBank.reputation - repBefore;
  addLog(
    state,
    state.activePlayerId ?? 0,
    `Investment (auto): ${event.name} (${describeEventEffects(coinChange, repChange)})`,
    classifyEffect(coinChange, repChange),
  );
  hand.splice(index, 1);
  return event;
}

/**
 * Non-mutating projection of the coin/reputation deltas {@link resolveEvent}
 * would apply for a regular (non-duration, non-choice) event right now
 * (CG-0MTR72P14000VO6Q).
 *
 * Mirrors the resource math inside resolveEvent — staff mitigation,
 * reputation gain multiplier, reputation multiplier scaling — WITHOUT
 * mutating `state.resourceBank`. Used by the deferred-mutation path
 * (processEndOfTurn with `deferResourceApplication`) so the incident deltas
 * are known before the end-of-turn animations complete.
 *
 * RandomBusiness consumes one RNG draw exactly as resolveEvent does (the
 * pull is unused for selection either way) so the deterministic RNG stream
 * is identical across the legacy and deferred paths. Duration events have
 * zero coin/rep deltas (they mutate activeEffects, not resourceBank).
 *
 * @param state      Current game state (read-only).
 * @param event      The already-drawn incident event.
 * @param repOverride Optional reputation value to use for the multiplier
 *                    scaling when the caller knows reputation will change
 *                    before this event applies (e.g. income rep added first).
 * @returns The coin and reputation deltas the event would apply.
 */
export function computeEventDeltas(
  state: MainStreetState,
  event: EventCard,
  repOverride?: number,
): { coinDelta: number; repDelta: number } {
  if (isDurationEventCard(event)) {
    // Duration events mutate activeEffects, not resourceBank — no deltas.
    return { coinDelta: 0, repDelta: 0 };
  }
  const employedSkills = getEmployedSpecializationSkills(state);
  const repGainMultiplier = computeReputationGainMultiplier(employedSkills);
  const incidentBuffs = event.trigger === 'Incident' ? computeIncidentSkillBuffs(employedSkills) : null;
  const theftNeutralized =
    incidentBuffs !== null && incidentBuffs.immuneToTheftLoss && isTheftLossIncident(event);
  const cDelta = (effect: number): number => {
    if (theftNeutralized && effect < 0) return 0;
    if (incidentBuffs === null || effect >= 0) return roundInt(effect);
    return roundInt(effect + Math.abs(effect) * incidentBuffs.coinDamageReductionPct);
  };
  const rDelta = (effect: number): number => {
    if (effect > 0) return roundInt(effect * repGainMultiplier);
    if (incidentBuffs === null) return roundInt(effect);
    return roundInt(Math.min(0, effect + incidentBuffs.reputationDamageReductionFlat));
  };
  const rep = repOverride ?? state.resourceBank.reputation;
  const cfg = state.config;
  // Proportional events collect from the current banked balance (same helper
  // as resolveEvent — CG-0MTQ7W0ZX0059R3J). In the deferred path income is
  // not yet applied; no non-choice proportional event ships, but routing
  // through the shared helper keeps the two paths identical for flat events.
  const baseCoinDelta = eventCoinDeltaFor(state, event);

  switch (event.target) {
    case 'SpecificSynergy': {
      const matchCount = state.streetGrid.filter(
        b => b !== null && b.synergyTypes.includes(event.targetSynergy as SynergyType),
      ).length;
      const rawDelta = event.coinPercentDelta !== undefined
        ? baseCoinDelta
        : baseCoinDelta * matchCount;
      return {
        coinDelta: applyReputationMultiplier(cDelta(rawDelta), rep, cfg),
        repDelta: rDelta(event.reputationDelta),
      };
    }
    case 'All':
      return {
        coinDelta: applyReputationMultiplier(cDelta(baseCoinDelta), rep, cfg),
        repDelta: rDelta(event.reputationDelta),
      };
    case 'RandomBusiness': {
      const placed = state.streetGrid.filter(b => b !== null);
      if (placed.length > 0) {
        // Consume RNG exactly as resolveEvent does (deterministic selection).
        void Math.floor(state.rng() * placed.length);
        return {
          coinDelta: applyReputationMultiplier(cDelta(baseCoinDelta), rep, cfg),
          repDelta: rDelta(event.reputationDelta),
        };
      }
      return {
        coinDelta: 0,
        repDelta: rDelta(event.reputationDelta),
      };
    }
    default:
      return { coinDelta: 0, repDelta: 0 };
  }
}

/**
 * Routes a shared Investment/Incident event's effects per-owner for
 * competitive states (N >= 2, CG-0MTIIL6J200291ZQ).
 *
 * Retains the shared resolution semantics of {@link resolveEvent} but applies
 * the deltas to each owning player's wallet rather than the shared host
 * wallet (which is left unchanged — the host path already resolved the event
 * on the resourceBank before this helper runs):
 *
 *  - Duration events are board-wide ActiveEffects (the shared activeEffects
 *    list) and are NOT re-routed here — they are applied once by the host
 *    path and influence every owner's income phase via
 *    {@link applyCompetitiveIncome}.
 *  - `All` / `RandomBusiness`:
 *      - Investment events (actingPlayerId provided): the acting player's own
 *        wallet receives the delta (playing the event benefits the acting
 *        player).
 *      - Incidents (shared deck, no acting player): every owner's wallet
 *        receives the delta, each scaled by its OWN reputation multiplier and
 *        staff mitigation (street-wide semantics). RandomBusiness resolves
 *        deterministically to the owner of the lowest-index placed business
 *        without consuming RNG (no such cards ship in the CSV at present —
 *        verified — so this path is a documented fallback).
 *  - `SpecificSynergy` (both triggers): coinDelta is multiplied by the count
 *    of matching businesses OWNED by that player (per-match rule retained)
 *    and credited to each slot owner; the reputation delta applies once per
 *    owner that owns at least one matching business (mirrors the shared
 *    resolution where rep is applied once regardless of match count).
 *
 * Consumes no RNG (deterministic replay, AC3).
 *
 * @param state           Competitive game state (players[] mutated in-place).
 * @param event           The already-resolved shared event card to route.
 * @param actingPlayerId  Owner index of the player who played the event
 *                        (Investment trigger). Omit for shared incidents.
 */
// ── Shared per-owner event math (competitive routing + piggyback rewards) ──

/**
 * Per-owner staff/skill context for the shared per-owner event math.
 * Built per owner by {@link buildOwnerEventContext}; consumed by
 * {@link computeOwnerEventDeltas}, which backs both
 * {@link applyCompetitiveEventEffects} and the piggyback reward projection
 * so the two paths can never diverge (MS-0MV8BFT73001EUSP).
 */
interface OwnerEventContext {
  ownerId: number;
  player: PlayerRecord;
  skills: readonly SpecializationSkill[];
  incidentBuffs: ReturnType<typeof computeIncidentSkillBuffs> | null;
  theftNeutralized: boolean;
}

/**
 * Builds the per-owner staff context for an event (mirrors resolveEvent):
 * incident damage reduction applies to Incident triggers only; the Brand
 * Ambassador +50% gains multiplier applies to positive reputation deltas
 * from both incidents and investments. Non-mutating, consumes no RNG.
 */
function buildOwnerEventContext(
  event: EventCard,
  player: PlayerRecord,
): OwnerEventContext {
  const ownerId = player.playerId;
  const skills = (player.staffCards ?? []).flatMap((card) =>
    Array.isArray(card.specializationSkillIds) ? deserializeSkillIds(card.specializationSkillIds) : [],
  );
  const incidentBuffs =
    event.trigger === 'Incident' ? computeIncidentSkillBuffs(skills) : null;
  const theftNeutralized =
    incidentBuffs !== null && incidentBuffs.immuneToTheftLoss && isTheftLossIncident(event);
  return { ownerId, player, skills, incidentBuffs, theftNeutralized };
}

/**
 * Effective coin delta for one owner after staff mitigation (mirrors
 * resolveEvent's `cDelta`).
 */
function ownerCoinDelta(ctx: OwnerEventContext, effect: number): number {
  if (ctx.theftNeutralized && effect < 0) return 0; // theft immunity
  if (ctx.incidentBuffs === null || effect >= 0) return roundInt(effect);
  return roundInt(effect + Math.abs(effect) * ctx.incidentBuffs.coinDamageReductionPct);
}

/**
 * Effective reputation delta for one owner after brand-ambassador /
 * compliance mitigation (mirrors resolveEvent's `rDelta`).
 */
function ownerRepDelta(ctx: OwnerEventContext, effect: number): number {
  if (effect > 0) return roundInt(effect * computeReputationGainMultiplier(ctx.skills));
  if (ctx.incidentBuffs === null) return roundInt(effect);
  return roundInt(Math.min(0, effect + ctx.incidentBuffs.reputationDamageReductionFlat));
}

/** Full (scale 1.0) coin/reputation deltas an event routes to one owner's own board. */
interface OwnerEventDelta {
  coins: number;
  reputation: number;
  /** Own matching businesses for `SpecificSynergy` events (0 otherwise). */
  matchCount: number;
}

/**
 * Computes the full (scale 1.0) coin/reputation deltas an event would route
 * to a single owner's own board, mirroring the shared-resolution staff
 * mitigation and per-owner reputation multiplier. Shared by
 * {@link applyCompetitiveEventEffects} (mutating) and the piggyback reward
 * projection (non-mutating, scale-aware) so live routing and piggyback
 * reward math never diverge (MS-0MV8BFT73001EUSP AC1).
 *
 * - `SpecificSynergy`: coinDelta is multiplied by the count of matching
 *   businesses OWNED by that player; the reputation delta applies once when
 *   the owner holds at least one matching business.
 * - `All` / `RandomBusiness`: flat deltas on the owner's board (proportional
 *   events are taxed on the owner's OWN banked balance).
 *
 * Consumes no RNG and mutates no state.
 */
function computeOwnerEventDeltas(
  state: MainStreetState,
  event: EventCard,
  ctx: OwnerEventContext,
): OwnerEventDelta {
  const cfg = state.config;
  // Proportional events (CG-0MTQ7W0ZX0059R3J): each owner is taxed on its
  // OWN banked balance at its own effective rate (an Accountant employed by
  // one player only mitigates that player's audit). Flat events keep the
  // nominal per-owner `coinDelta`.
  const baseCoinDelta = event.coinPercentDelta === undefined
    ? event.coinDelta
    : -computeProportionalCoinLoss(
        ctx.player.coins,
        computeTaxAuditRate(ctx.player.staffCards ?? [], Math.abs(event.coinPercentDelta)),
      );

  let coins = 0;
  let reputation = 0;
  let matchCount = 0;
  switch (event.target) {
    case 'SpecificSynergy': {
      for (let i = 0; i < state.streetGrid.length; i++) {
        const b = state.streetGrid[i];
        if (!b || !b.synergyTypes) continue;
        if (getSlotOwnerId(state, i) !== ctx.ownerId) continue;
        if (b.synergyTypes.includes(event.targetSynergy as SynergyType)) matchCount += 1;
      }
      if (matchCount > 0) {
        const rawDelta = event.coinPercentDelta !== undefined
          ? baseCoinDelta
          : baseCoinDelta * matchCount;
        coins = applyReputationMultiplier(ownerCoinDelta(ctx, rawDelta), ctx.player.reputation, cfg);
        reputation = ownerRepDelta(ctx, event.reputationDelta);
      }
      break;
    }
    case 'All':
    case 'RandomBusiness':
      coins = applyReputationMultiplier(ownerCoinDelta(ctx, baseCoinDelta), ctx.player.reputation, cfg);
      reputation = ownerRepDelta(ctx, event.reputationDelta);
      break;
    default:
      break;
  }
  return { coins, reputation, matchCount };
}

/**
 * Routes a shared Investment/Incident event's effects per-owner for
 * competitive states (N >= 2, CG-0MTIIL6J200291ZQ).
 *
 * Retains the shared resolution semantics of {@link resolveEvent} but applies
 * the deltas to each owning player's wallet rather than the shared host
 * wallet (which is left unchanged — the host path already resolved the event
 * on the resourceBank before this helper runs):
 *
 *  - Duration events are board-wide ActiveEffects (the shared activeEffects
 *    list) and are NOT re-routed here — they are applied once by the host
 *    path and influence every owner's income phase via
 *    {@link applyCompetitiveIncome}.
 *  - `All` / `RandomBusiness`:
 *      - Investment events (actingPlayerId provided): the acting player's own
 *        wallet receives the delta (playing the event benefits the acting
 *        player).
 *      - Incidents (shared deck, no acting player): every owner's wallet
 *        receives the delta, each scaled by its OWN reputation multiplier and
 *        staff mitigation (street-wide semantics). RandomBusiness resolves
 *        deterministically to the owner of the lowest-index placed business
 *        without consuming RNG (no such cards ship in the CSV at present —
 *        verified — so this path is a documented fallback).
 *  - `SpecificSynergy` (both triggers): coinDelta is multiplied by the count
 *    of matching businesses OWNED by that player (per-match rule retained)
 *    and credited to each slot owner; the reputation delta applies once per
 *    owner that owns at least one matching business (mirrors the shared
 *    resolution where rep is applied once regardless of match count).
 *
 * Consumes no RNG (deterministic replay, AC3).
 *
 * @param state           Competitive game state (players[] mutated in-place).
 * @param event           The already-resolved shared event card to route.
 * @param actingPlayerId  Owner index of the player who played the event
 *                        (Investment trigger). Omit for shared incidents.
 */
export function applyCompetitiveEventEffects(
  state: MainStreetState,
  event: EventCard,
  actingPlayerId?: number,
): void {
  if (!state.players || state.players.length < 2) return;
  if (isDurationEventCard(event)) return; // board-wide effect, host-applied only

  const target = event.target;
  const actingId = event.trigger === 'Investment' ? actingPlayerId ?? 0 : undefined;

  const changed: { ownerId: number; coins: number; rep: number }[] = [];
  for (const player of state.players) {
    // Investment `All`/`RandomBusiness` benefits the acting player only;
    // incidents and per-owner `SpecificSynergy` events route to every owner.
    if (target !== 'SpecificSynergy' && actingId !== undefined && player.playerId !== actingId) continue;
    const ctx = buildOwnerEventContext(event, player);
    const delta = computeOwnerEventDeltas(state, event, ctx);
    if (delta.coins !== 0 || delta.reputation !== 0) {
      player.coins += delta.coins;
      player.reputation += delta.reputation;
      changed.push({ ownerId: player.playerId, coins: delta.coins, rep: delta.reputation });
    }
  }

  for (const c of changed) {
    addLog(
      state,
      c.ownerId,
      `${event.trigger}: ${event.name} (${describeEventEffects(c.coins, c.rep)})`,
      classifyEffect(c.coins, c.rep),
    );
  }
}

// ── Piggyback rewards (epic MS-0MUYC47EL005Z69H, F2 engine helpers) ──

/**
 * Scale factor for a piggyback reward share: `0.5` = automatic free-ride,
 * `1.0` = join fully (100%).
 */
export type PiggybackRewardScale = 0.5 | 1.0;

/**
 * Non-mutating per-owner projection of the reward an eligible event pays to
 * a piggybacker's OWN board at a scale factor (0.5 / 1.0), including the
 * per-owner reputation coin multiplier and staff mitigation (MS-0MV8BFT73001EUSP AC1).
 *
 * The un-scaled full reward is computed by
 * {@link computeOwnerEventDeltas} (identical to `applyCompetitiveEventEffects`
 * for the acting owner) and then scaled and rounded — the economy is
 * integer-only (CG-0MTIO1M15001E9Y6). `SpecificSynergy` rewards count the
 * piggybacker's OWN matching businesses; `All` events pay the flat deltas
 * regardless of board composition (no matching business → zero reward for
 * synergy events).
 *
 * Consumes no RNG and mutates no state — safe for replay and headless AI
 * projection. The caller enforces eligibility and the N≥2 competitive gate;
 * this helper is pure reward math.
 *
 * @param state               Competitive game state (read-only).
 * @param event               The piggyback-eligible organiser event.
 * @param piggybackerOwnerId  Seat whose own board the reward is computed on.
 * @param scale               Reward share: 0.5 (free-ride) or 1.0 (join fully).
 * @returns The scaled integer coin/reputation reward plus the owner's own
 *          match count (0 for `All`-target events or no matching businesses).
 */
export function projectPiggybackEventReward(
  state: MainStreetState,
  event: EventCard,
  piggybackerOwnerId: number,
  scale: PiggybackRewardScale,
): PiggybackRewardProjection {
  const player = state.players?.[piggybackerOwnerId];
  if (!player || isDurationEventCard(event)) {
    return { scale, coins: 0, reputation: 0, matchCount: 0 };
  }
  const ctx = buildOwnerEventContext(event, player);
  const delta = computeOwnerEventDeltas(state, event, ctx);
  return {
    scale,
    coins: roundInt(delta.coins * scale),
    reputation: roundInt(delta.reputation * scale),
    matchCount: delta.matchCount,
  };
}

/** Non-mutating per-owner projection of a piggyback reward (see {@link projectPiggybackEventReward}). */
export interface PiggybackRewardProjection {
  /** Scale factor the reward was computed at (0.5 free-ride / 1.0 join fully). */
  scale: PiggybackRewardScale;
  /** Scaled integer coin reward for the piggybacker's own board. */
  coins: number;
  /** Scaled integer reputation reward for the piggybacker's own board. */
  reputation: number;
  /** The owner's own matching businesses (0 for `All` events / no matches). */
  matchCount: number;
}

/**
 * Exact join-fully charge for a paid cost: `round(1.5 × paidCost)` — the
 * cost baseline is what the acting player ACTUALLY paid at play time (after
 * any discounts the acting player holds), not the nominal CSV cost
 * (MS-0MV8BFT73001EUSP AC2, epic Q2/Q3).
 */
export function piggybackJoinFullyCost(paidCost: number): number {
  return Math.max(0, Math.round(paidCost * 1.5));
}

/** Result of applying the join-fully tier (see {@link applyPiggybackJoinFully}). */
export interface PiggybackJoinFullyResult {
  /** True when the 150% charge and 100% reward were applied; false when unaffordable (no-op). */
  applied: boolean;
  /**
   * Exact join-fully cost `round(1.5 × paidCost)`. Deducted from the
   * piggybacker's coins only when `applied` is true — reported even in the
   * unaffordable case so callers can present the shortfall.
   */
  charge: number;
  /** The 100%-scale reward projection for the piggybacker's own board. */
  reward: PiggybackRewardProjection;
}

/**
 * Applies the join-fully tier to a piggybacker's `PlayerRecord`
 * (MS-0MV8BFT73001EUSP AC2/AC3):
 *
 * - Deducts exactly `round(1.5 × paidCost)` from the piggybacker's coins,
 *   never a partial charge, and credits the 100% event reward computed on
 *   the piggybacker's OWN board (per-owner reputation multiplier + staff
 *   mitigation via {@link projectPiggybackEventReward}).
 * - Never spends an action point: `PlayerRecord.actionBudget` and
 *   `state.actionsRemaining` are untouched.
 * - When the piggybacker cannot afford the charge the call is a no-op
 *   (`applied: false`, nothing charged, wallet unchanged) and the caller
 *   applies the automatic 50% free-ride (epic AC3).
 * - Mutates only the piggybacker's `PlayerRecord` — never the shared
 *   `resourceBank` (deterministic replay, save/deserialize untouched).
 *
 * @throws Error when no player record exists for `piggybackerOwnerId`.
 */
export function applyPiggybackJoinFully(
  state: MainStreetState,
  event: EventCard,
  piggybackerOwnerId: number,
  paidCost: number,
): PiggybackJoinFullyResult {
  const player = state.players?.[piggybackerOwnerId];
  if (!player) {
    throw new Error(`Piggyback: no player record for seat ${piggybackerOwnerId}.`);
  }
  const charge = piggybackJoinFullyCost(paidCost);
  const reward = projectPiggybackEventReward(state, event, piggybackerOwnerId, 1.0);
  if (player.coins < charge) {
    // Unaffordable: option unavailable, nothing charged (never a partial
    // charge); the caller then applies the automatic 50% free-ride.
    return { applied: false, charge, reward };
  }
  player.coins = player.coins - charge + reward.coins;
  player.reputation += reward.reputation;
  addLog(
    state,
    piggybackerOwnerId,
    `Piggyback: joined ${event.name} fully (${describeEventEffects(reward.coins - charge, reward.reputation)})`,
    classifyEffect(reward.coins - charge, reward.reputation),
  );
  return { applied: true, charge, reward };
}

/**
 * Applies the automatic free-ride tier (epic AC3, MS-0MV8BFT73001EUSP AC3):
 * credits a piggybacker's `PlayerRecord` with 50% of the event's reward
 * computed on their own board. No coins are charged and no action point is
 * spent; mutates only the piggybacker's `PlayerRecord`, never the shared
 * `resourceBank`.
 *
 * @returns The applied 50% reward projection.
 * @throws Error when no player record exists for `piggybackerOwnerId`.
 */
export function applyPiggybackFreeRide(
  state: MainStreetState,
  event: EventCard,
  piggybackerOwnerId: number,
): PiggybackRewardProjection {
  const player = state.players?.[piggybackerOwnerId];
  if (!player) {
    throw new Error(`Piggyback: no player record for seat ${piggybackerOwnerId}.`);
  }
  const reward = projectPiggybackEventReward(state, event, piggybackerOwnerId, 0.5);
  player.coins += reward.coins;
  player.reputation += reward.reputation;
  addLog(
    state,
    piggybackerOwnerId,
    `Piggyback: ${event.name} free-ride (${describeEventEffects(reward.coins, reward.reputation)})`,
    classifyEffect(reward.coins, reward.reputation),
  );
  return reward;
}

// ── Piggyback decision state machine (epic MS-0MUYC47EL005Z69H, F3) ──

/**
 * Other non-eliminated seats that owe a piggyback decision when `actingSeatId`
 * plays an eligible organiser event, in seat order (F3 AC5).
 *
 * The acting seat is excluded, and eliminated seats are skipped entirely
 * (MS-0MUVQRBVI0015AB2). Returns an empty list for single-player / N=1 state,
 * which is how the N=1 no-pause gate is enforced.
 */
export function getPiggybackSeatIds(
  state: MainStreetState,
  actingSeatId: number,
): number[] {
  const players = state.players ?? [];
  const seats: number[] = [];
  for (const player of players) {
    if (player.eliminated) continue;
    if (player.playerId === actingSeatId) continue;
    seats.push(player.playerId);
  }
  return seats;
}

/**
 * True when playing `event` by `actingSeatId` should raise piggyback decisions:
 * competitive (N≥2), an Investment trigger, the per-card `piggybackable` flag
 * set, a non-duration card, and at least one other active seat. Consumes no RNG
 * (pure predicate shared by the raise gate and the AI policy, F4).
 */
export function isPiggybackEligible(
  state: MainStreetState,
  event: EventCard,
  actingSeatId: number,
): boolean {
  if ((state.players?.length ?? 0) < 2) return false;
  if (event.trigger !== 'Investment') return false;
  if (event.piggybackable !== true) return false;
  if (isDurationEventCard(event)) return false;
  return getPiggybackSeatIds(state, actingSeatId).length > 0;
}

/**
 * True when `state` carries a pending piggyback set with at least one
 * unresolved decision (F3 AC1). The shared closing pauses while true.
 */
export function hasPendingPiggyback(state: MainStreetState): boolean {
  const pending = state.pendingPiggyback;
  if (!pending) return false;
  return pending.decisions.some((decision) => !decision.resolved);
}

/**
 * Lowest-index seat whose decision is still unresolved, in seat order, or
 * `null` when every decision is resolved / nothing is pending. The interactive
 * prompt (F5) uses this to present the next decision in order.
 */
export function getNextPendingPiggybackSeat(state: MainStreetState): number | null {
  const pending = state.pendingPiggyback;
  if (!pending) return null;
  for (const decision of pending.decisions) {
    if (!decision.resolved) return decision.seatId;
  }
  return null;
}

/**
 * Raises one pending piggyback decision per other active seat for an eligible
 * organiser event just played by `actingSeatId` (F3 AC1).
 *
 * Called after the acting player's event effects resolve, from every event-play
 * dispatch path (`play-event`, `play-event-from-hand` via `playEventFromHand`,
 * and `playHeldEvent`). No-op (returns false, sets no state) for N=1,
 * non-eligible events, or when no other active seat remains — so N=1 and
 * non-eligible events never pause.
 *
 * `paidCost` is the amount the acting player ACTUALLY paid (the 150% join-fully
 * baseline); `event.cost` is the listed cost charged by `playEventFromHand`.
 * Consumes no RNG. A still-unresolved set from a previous play is auto-resolved
 * (free-ride default) first so no seat's share is silently dropped.
 *
 * @returns True when a pending set was raised.
 */
export function raisePiggybackDecisions(
  state: MainStreetState,
  event: EventCard,
  actingSeatId: number,
  paidCost: number,
): boolean {
  if (!isPiggybackEligible(state, event, actingSeatId)) return false;
  // Defensive: never drop an unresolved set the caller forgot to resolve.
  // Headless drivers and the interactive scene resolve before the next play,
  // so this path is only reached by a caller that skipped resolution.
  if (hasPendingPiggyback(state)) {
    resolveAllPendingPiggybacks(state);
  }
  const decisions: PendingPiggybackDecision[] = getPiggybackSeatIds(state, actingSeatId).map(
    (seatId) => ({
      seatId,
      event,
      paidCost,
      chosenJoin: null,
      resolved: false,
    }),
  );
  state.pendingPiggyback = { actingSeatId, event, paidCost, decisions };
  addLog(
    state,
    `Piggyback: ${event.name} — ${decisions.length} seat(s) invited to join fully.`,
    'neutral',
  );
  return true;
}

/** Outcome of resolving one seat's pending piggyback decision (F3 AC2). */
export interface PiggybackSeatResolution {
  seatId: number;
  /** True when the join-fully tier was applied (150% charged, 100% reward). */
  joined: boolean;
  /** True when the automatic 50% free-ride was applied. */
  freeRide: boolean;
  /** Coins charged from the seat (0 for a free-ride). */
  charge: number;
  /** The reward projection actually applied to the seat's own board. */
  reward: PiggybackRewardProjection;
}

/**
 * Resolves one seat's pending piggyback decision (F3 AC2).
 *
 * - `join === true`: applies the join-fully tier via {@link applyPiggybackJoinFully}
 *   (deducts `round(1.5 × paidCost)`, credits the 100% own-board reward, spends
 *   no action point). When the seat cannot afford the charge the join is
 *   unavailable, nothing is charged, and the automatic 50% free-ride is applied
 *   instead (epic AC3) — never a partial charge.
 * - `join === false`: applies the automatic 50% free-ride via
 *   {@link applyPiggybackFreeRide}.
 *
 * Seats resolve independently in seat order; resolving the last unresolved
 * entry clears `state.pendingPiggyback`. Deterministic and consumes no RNG.
 *
 * @returns The applied resolution, or `null` when nothing is pending for the
 *          seat (no set, unknown seat, or already resolved).
 * @throws Error when no player record exists for `seatId` (via the F2 helper).
 */
export function resolvePendingPiggyback(
  state: MainStreetState,
  seatId: number,
  join: boolean,
): PiggybackSeatResolution | null {
  const pending = state.pendingPiggyback;
  if (!pending) return null;
  const decision = pending.decisions.find((entry) => entry.seatId === seatId);
  if (!decision || decision.resolved) return null;

  let resolution: PiggybackSeatResolution;
  if (join) {
    const result = applyPiggybackJoinFully(state, decision.event, seatId, decision.paidCost);
    if (result.applied) {
      resolution = {
        seatId,
        joined: true,
        freeRide: false,
        charge: result.charge,
        reward: result.reward,
      };
    } else {
      // Unaffordable: the join option is unavailable (no partial charge); the
      // automatic 50% free-ride applies instead (epic AC3).
      const reward = applyPiggybackFreeRide(state, decision.event, seatId);
      resolution = { seatId, joined: false, freeRide: true, charge: 0, reward };
    }
  } else {
    const reward = applyPiggybackFreeRide(state, decision.event, seatId);
    resolution = { seatId, joined: false, freeRide: true, charge: 0, reward };
  }

  decision.chosenJoin = resolution.joined;
  decision.resolved = true;
  if (!hasPendingPiggyback(state)) {
    state.pendingPiggyback = null;
  }
  return resolution;
}

/**
 * Resolves every unresolved piggyback decision in seat order (F3 AC2/AC4).
 *
 * `decide` is the policy seam: given a decision it returns `true` to join
 * fully, `false` to keep the free-ride. When omitted every seat keeps the
 * automatic free-ride (the deterministic headless default — the F4 AI policy
 * supplies the seat-aware heuristic through this seam). Consumes no RNG.
 *
 * @returns The applied resolution for every seat resolved, in seat order.
 */
export function resolveAllPendingPiggybacks(
  state: MainStreetState,
  decide?: (decision: Readonly<PendingPiggybackDecision>, state: MainStreetState) => boolean,
): PiggybackSeatResolution[] {
  const pending = state.pendingPiggyback;
  if (!pending) return [];
  const resolutions: PiggybackSeatResolution[] = [];
  // Iterate a copy: resolvePendingPiggyback may clear the pending set on the
  // final entry, but never mutates the decisions array itself.
  for (const decision of [...pending.decisions]) {
    if (decision.resolved) continue;
    const join = decide ? decide(decision, state) === true : false;
    const resolution = resolvePendingPiggyback(state, decision.seatId, join);
    if (resolution) resolutions.push(resolution);
  }
  return resolutions;
}

/**
 * Computes the effective duration for a DurationEventCard by scanning
 * the street grid for Clinic and Medical Center cards.
 *
 * Rules:
 * - Medical Center (upg-medical-center) reduces duration by 3
 * - Clinic (biz-clinic) reduces duration by 2
 * - Only the stronger reduction applies (Medical Center > Clinic)
 * - Minimum duration floor is 1
 * - Reduction applies ONLY to negative effects (multiplier < 1): a Clinic
 *   should shorten a harmful income cut, not a positive boost like
 *   Tourist Season / Community Renovation (Group C, CG-0MSQJ244M0055X7S).
 *
 * @param baseDuration  Base duration before reductions
 * @param state         Current game state (street grid is scanned)
 * @param multiplier    The effect's multiplier; < 1 = negative effect
 * @returns Effective duration after reductions (min 1).
 */
function computeDurationWithClinicReduction(
  baseDuration: number,
  state: MainStreetState,
  multiplier: number,
): number {
  // Positive effects (>= 1) are not shortened by medical coverage.
  if (multiplier >= 1) return baseDuration;

  let hasMedicalCenter = false;
  let hasClinic = false;

  for (const slot of state.streetGrid) {
    if (slot === null) continue;
    if (slot.id.startsWith('upg-medical-center')) {
      hasMedicalCenter = true;
    } else if (slot.id.startsWith('biz-clinic')) {
      hasClinic = true;
    }
  }

  let reduction = 0;
  if (hasMedicalCenter) {
    reduction = 3;
  } else if (hasClinic) {
    reduction = 2;
  }

  return Math.max(1, baseDuration - reduction);
}

/**
 * True for Incident events representing theft or loss of coins (targeted in
 * the Security Consultant's immunity, I4). Matches on the incident's
 * description, which is the stable design source (all incident descriptions
 * in card-data.csv state their consequence explicitly).
 */
function isTheftLossIncident(event: EventCard): boolean {
  return (
    event.trigger === 'Incident' &&
    (/\btheft\b/i.test(event.effect) || /\bloss(?:es)?\b/i.test(event.effect))
  );
}

