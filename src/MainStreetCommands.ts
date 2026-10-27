/**
 * Main Street: Action Commands
 *
 * Reversible command wrappers for market actions, built using the shared
 * ActionCommands adapter (`toCommand` / `ReversibleAction`) from the
 * core engine. Each command captures a pre-snapshot on first execute
 * and restores it on undo.
 *
 * @module
 */

import { toCommand, type ReversibleAction } from '@core-engine/ActionCommands';
import { evaluateChallengesAfterAction } from './MainStreetChallenges';
import type { SynergyType } from './MainStreetCards';
import type { MainStreetState } from './MainStreetState';
import {
  purchaseBusiness,
  moveToHand,
  purchaseUpgrade,
  purchaseEvent,
  refreshMarket,
  useFreeMarketReroll,
  sellBusiness,
  closeBusiness,
  playBusinessFromHand,
  playUpgradeFromHand,
  playEventFromHand,
  discardFromHand,
  buyAndPlaceUpgrade,
} from './MainStreetMarket';
import {
  buyAndPlaceBusiness,
  hireStaffCard,
  peekIncidentDeck,
  consumeAction as consumeEngineAction,
  hireApplicantAction,
  declineApplicantAction,
  letGoStaffAction,
  resolveEventChoice,
  resolveEventOption,
  resolvePendingPiggyback,
  placeStaffOnBusiness,
  isStaffRelocation,
  canMoveStaffOnBusiness,
  moveStaffOnBusiness,
  removeStaffFromBusiness,
  layoffStaffCard,
  takeLoan,
} from './MainStreetEngine';

// ── Action Budget Enforcement ────────────────────────────────

/**
 * Consume one action from the state budget. Throws if no actions remain.
 *
 * Delegates to the engine's single shared `consumeAction` helper
 * (CG-0MTCP7F9S009HARC) so the command layer and the engine `executeAction`
 * path decrement `actionsRemaining` AND `bankedActions` (floor 0) in
 * lock-step — one enforcement point, no divergence, no double-decrement.
 */
export function consumeAction(state: MainStreetState): void {
  consumeEngineAction(state);
}

/** Snapshot of the portions of state affected by market actions. */
interface MarketActionSnapshot {
  streetGrid: any | null;
  market: any | null;
  decks: any | null;
  resourceBank: any | null;
  hand: any | null;
  incidentDeck: any | null;
  activityLog: any | null;
  soldSlots: boolean[] | null;
  /**
   * Unified discard pile — captured so undoing a Close restores the removed
   * card (`closeBusiness` pushes it to `discardPile`).
   */
  discardPile: any | null;
  /** Grand Opening placement gate — captured so undo restores the per-turn flag. */
  businessPlacedThisTurn: boolean | null;
  /** Dynamic Grand Opening synergy — captured so undo restores the pre-placement synergy (MS-0MVCS1NOH0074YY2). */
  placedSynergiesThisTurn: SynergyType[] | null;
  /** Market re-roll escalation counter — captured so undo restores the inflated price (MS-0MTR6ZRF5007PWNZ). */
  marketRefreshesThisTurn: number | null;
  /** Investor free re-roll gate — captured so undo restores availability (MS-0MTISBYLS009936W). */
  investorFreeRerollUsedThisTurn: boolean | null;
  /** Daily action budget — captured so undo restores the spent action. */
  actionsRemaining: number | null;  /** Banked actions — captured so undo restores the banking state. */
  bankedActions: number | null;
  /** Staff peek gate — captured so undo restores the once-per-turn flag. */
  peekUsedThisTurn: boolean | null;
  /** Staff peek reveal — captured so undo clears a pending reveal. */
  revealedPeekedCard: any | null;
  /** Staff applicant — captured so undo restores pending/hired state. */
  pendingApplicant: any | null;
  /** Staff roster — captured so undo restores the staff list. */
  staffCards: any | null;
  /** Same-week upgrade composite tracker (CG-0MT3IYSRL001VVUP). */
  justMovedUpgradeCardId: string | null;
  /** Same-week event composite tracker (CG-0MTFWBNL30043ZBM). */
  justMovedEventCardId: string | null;
  /**
   * Pending dual-choice incident (CG-0MTSHG8RP008E128). Captured so undoing
   * a choice returns to the unresolved pending state with the event still in
   * play (AC10 parent / AC1 undo child).
   */
  pendingEventChoice: any | null;
  /**
   * Pending piggyback decision set (F3 of MS-0MUYC47EL005Z69H). Captured so
   * undoing an eligible event play returns to the unresolved pending state
   * (and redo re-raises it) instead of leaving a stale decision set behind.
   */
  pendingPiggyback: any | null;
  /**
   * Competitive per-owner wallets (F5 of MS-0MUYC47EL005Z69H). Captured so
   * undoing a piggyback decision restores the piggybacker's `PlayerRecord`
   * coins/reputation (the authoritative per-owner wallet) alongside the
   * pending set — the command never mutates the shared `resourceBank`.
   */
  players: any | null;
  /**
   * Active duration effects. Captured so undoing a choice that accepted a
   * DurationEventCard removes the effect it pushed.
   */
  activeEffects: any | null;
  /**
   * Challenge completion state (CG-0MU37CKRR008252I). `state.activeChallenges`
   * holds evaluator *functions* and must NOT be deep-cloned (structuredClone /
   * JSON clone silently drop them); capture the cloneable form instead: the
   * completed-ID list plus each challenge's `completed` flag by index.
   */
  challengesCompleted: string[] | null;
  completedFlags: boolean[] | null;
  /**
   * Per-seat challenge attribution by index (MS-0MUWNTJIK009O6BZ). Captured
   * alongside `completedFlags` so undo restores the pre-action attribution
   * (`undefined` for an incomplete challenge); without it a completion undone
   * and later re-completed by another seat would be mis-credited to the seat
   * that completed it first (AC3 of MS-0MV33TSK20076Q36).
   */
  completedBySeatIds: (number | null | undefined)[] | null;
  /**
   * Per-family discard piles — captured so undoing a discard removes the card
   * from its family discard pile as well as restoring the hand, and redo
   * re-adds it exactly once (CG-0MUEQ19VX0009VIW).
   */
  discards: any | null;
  /**
   * Active bank loans (Bank Loans epic MS-0MVL6DZI0000F6CG). Captured so
   * undoing a `take-loan` removes the recorded loan and restoring resources
   * also restores the one-active-loan invariant.
   */
  loans: any | null;
  /**
   * Pending loan offer (bailout flow). Captured so undo restores an
   * unresolved offer exactly as it was (and redo re-arms it).
   */
  pendingLoanOffer: any | null;
}

/** Safe cloning helper that uses structuredClone when available, else falls back to JSON clone. */
function safeClone<T>(obj: T): T {
  try {
    const sc = (globalThis as any).structuredClone;
    if (typeof sc === 'function') {
      return sc(obj);
    }
  } catch (_) {
    // fall back
  }
  // JSON fallback (sufficient for our snapshot uses: arrays/objects of primitives)
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Clones a pending choice for snapshotting.
 *
 * The frozen option-list snapshot is retained so undo/redo round-trips the
 * presenter-visible list without loss (F3 AC4): option data (label, candidate
 * sets, effect policy) is copied by value; runtime callback functions
 * (`condition` / `successorResolver`) are kept by reference — they are
 * process-local and are never structured-cloned. Resolution therefore re-reads
 * the exact draw-time list after undo/redo.
 */
function clonePendingChoice(pending: any): any {
  if (!pending) return null;
  return {
    event: safeClone(pending.event),
    chosenOption: pending.chosenOption,
    resolved: pending.resolved,
    options: pending.options
      ? pending.options.map((o: any) => ({
          label: o.label,
          successorId: o.successorId ?? null,
          successorIds: o.successorIds ? [...o.successorIds] : undefined,
          effectPolicy: o.effectPolicy,
          condition: o.condition,
          successorResolver: o.successorResolver,
        }))
      : undefined,
  };
}

/** Helper to capture a shallow snapshot of mutable market-related fields. */
function captureSnapshot(state: MainStreetState): MarketActionSnapshot {
  return {
    streetGrid: safeClone(state.streetGrid),
    market: safeClone(state.market),
    decks: safeClone(state.decks),
    resourceBank: safeClone(state.resourceBank),
    hand: safeClone(state.hand ?? []),
    incidentDeck: safeClone(state.incidentDeck),
    activityLog: safeClone(state.activityLog),
    soldSlots: safeClone(
      state.soldSlots ?? new Array<boolean>(state.streetGrid?.length ?? 10).fill(false),
    ) as boolean[],
    // Unified discard pile — captured so undoing a Close restores the removed
    // card (the card is pushed to `discardPile` by `closeBusiness`).
    discardPile: safeClone(state.discardPile ?? []),
    businessPlacedThisTurn: (state as any).businessPlacedThisTurn ?? false,
    placedSynergiesThisTurn: safeClone((state as any).placedSynergiesThisTurn ?? null),
    marketRefreshesThisTurn: state.marketRefreshesThisTurn ?? 0,
    investorFreeRerollUsedThisTurn: state.investorFreeRerollUsedThisTurn ?? false,
    actionsRemaining: state.actionsRemaining,
    bankedActions: state.bankedActions ?? 0,
    peekUsedThisTurn: state.peekUsedThisTurn ?? false,
    revealedPeekedCard: state.revealedPeekedCard ?? null,
    pendingApplicant: safeClone((state as any).pendingApplicant ?? null),
    staffCards: safeClone(state.staffCards ?? []),
    justMovedUpgradeCardId: (state as any).justMovedUpgradeCardId ?? null,
    justMovedEventCardId: (state as any).justMovedEventCardId ?? null,
    pendingEventChoice: clonePendingChoice((state as any).pendingEventChoice ?? null),
    pendingPiggyback: safeClone((state as any).pendingPiggyback ?? null),
    players: safeClone(state.players ?? null),
    activeEffects: safeClone(state.activeEffects ?? []),
    // Challenge completion state — cloneable form only (never activeChallenges,
    // whose evaluator functions would be dropped by safeClone).
    challengesCompleted: safeClone(state.challengesCompleted ?? []),
    completedFlags: (state.activeChallenges ?? []).map(ac => ac.completed),
    // Per-seat attribution is a primitive (number | null | undefined), so a
    // plain map is already an independent copy and preserves `undefined`
    // (safeClone's JSON fallback would coerce it to null).
    completedBySeatIds: (state.activeChallenges ?? []).map(ac => ac.completedBySeatId),
    discards: safeClone(state.discards ?? {}),
    loans: safeClone(state.loans ?? []),
    pendingLoanOffer: safeClone(state.pendingLoanOffer ?? null),
  };
}

/** Helper to restore a previously captured snapshot. */
function restoreSnapshot(state: MainStreetState, snap: MarketActionSnapshot): void {
  if (!snap.streetGrid || !snap.market || !snap.decks || !snap.resourceBank || !snap.activityLog) {
    throw new Error('Invalid snapshot');
  }
  state.streetGrid = snap.streetGrid as any;
  state.market = snap.market as any;
  state.decks = snap.decks as any;
  state.resourceBank = snap.resourceBank as any;
  state.hand = snap.hand as any;
  state.incidentDeck = snap.incidentDeck as any;
  state.activityLog = snap.activityLog as any;
  state.soldSlots = snap.soldSlots ?? new Array<boolean>(state.streetGrid?.length ?? 10).fill(false);
  state.discardPile = (snap.discardPile ?? []) as any;
  if (snap.businessPlacedThisTurn !== null && snap.businessPlacedThisTurn !== undefined) {
    (state as any).businessPlacedThisTurn = snap.businessPlacedThisTurn;
  }
  if ('placedSynergiesThisTurn' in snap) {
    (state as any).placedSynergiesThisTurn = snap.placedSynergiesThisTurn;
  }
  if (snap.marketRefreshesThisTurn !== null && snap.marketRefreshesThisTurn !== undefined) {
    state.marketRefreshesThisTurn = snap.marketRefreshesThisTurn;
  }
  if (
    snap.investorFreeRerollUsedThisTurn !== null &&
    snap.investorFreeRerollUsedThisTurn !== undefined
  ) {
    state.investorFreeRerollUsedThisTurn = snap.investorFreeRerollUsedThisTurn;
  }
  if (snap.actionsRemaining !== null && snap.actionsRemaining !== undefined) {
    state.actionsRemaining = snap.actionsRemaining;
  }
  if (snap.bankedActions !== null && snap.bankedActions !== undefined) {
    state.bankedActions = snap.bankedActions;
  }
  if (snap.peekUsedThisTurn !== null && snap.peekUsedThisTurn !== undefined) {
    state.peekUsedThisTurn = snap.peekUsedThisTurn;
  }
  if ('revealedPeekedCard' in snap) {
    state.revealedPeekedCard = snap.revealedPeekedCard;
  }
  if ('pendingApplicant' in snap) {
    (state as any).pendingApplicant = snap.pendingApplicant;
  }
  if ('staffCards' in snap) {
    state.staffCards = snap.staffCards;
  }
  if ('justMovedUpgradeCardId' in snap) {
    (state as any).justMovedUpgradeCardId = snap.justMovedUpgradeCardId;
  }
  if ('justMovedEventCardId' in snap) {
    (state as any).justMovedEventCardId = snap.justMovedEventCardId;
  }
  if ('pendingEventChoice' in snap) {
    (state as any).pendingEventChoice = snap.pendingEventChoice;
  }
  if ('pendingPiggyback' in snap) {
    (state as any).pendingPiggyback = snap.pendingPiggyback;
  }
  if (snap.players !== null && snap.players !== undefined) {
    state.players = snap.players as any;
  }
  if ('activeEffects' in snap) {
    state.activeEffects = snap.activeEffects ?? [];
  }
  // Restore challenge completion state atomically with the activityLog so
  // tracker, score and log stay consistent after undo (CG-0MU37CKRR008252I).
  if (snap.challengesCompleted !== null && snap.challengesCompleted !== undefined) {
    state.challengesCompleted = snap.challengesCompleted;
  }
  if (snap.completedFlags !== null && snap.completedFlags !== undefined) {
    for (let i = 0; i < state.activeChallenges.length && i < snap.completedFlags.length; i++) {
      state.activeChallenges[i].completed = snap.completedFlags[i];
    }
  }
  // Restore per-seat attribution in lock-step with the completion flags so an
  // undone completion is unattributed again and can be re-credited correctly
  // (MS-0MUWNTJIK009O6BZ, AC3 of MS-0MV33TSK20076Q36).
  if (snap.completedBySeatIds !== null && snap.completedBySeatIds !== undefined) {
    for (let i = 0; i < state.activeChallenges.length && i < snap.completedBySeatIds.length; i++) {
      state.activeChallenges[i].completedBySeatId = snap.completedBySeatIds[i];
    }
  }
  // Restore the per-family discard piles so undo removes a discarded card from
  // its pile (and redo re-adds it exactly once) — CG-0MUEQ19VX0009VIW.
  if (snap.discards !== null && snap.discards !== undefined) {
    state.discards = snap.discards;
  }
  // Restore the bank-loan record + pending offer so undo returns to the exact
  // one-active-loan state (MS-0MVPWS6WB008WP79).
  if ('loans' in snap) {
    state.loans = snap.loans ?? [];
  }
  if ('pendingLoanOffer' in snap) {
    state.pendingLoanOffer = snap.pendingLoanOffer ?? null;
  }
}

/**
 * Creates a snapshot-capturing action from a do function.
 * Captures the snapshot on the first execute and restores it on undo.
 */
function snapshotAction(
  doFn: (state: MainStreetState) => void,
  description: string,
): ReversibleAction<MainStreetState> {
  let pre: MarketActionSnapshot | null = null;
  // Same array reference is exposed on the ReversibleAction and propagated by
  // toCommand() onto the Command, so callers can read it after execute().
  const completedChallengeIds: string[] = [];
  return {
    completedChallengeIds,
    description,
    do(state: MainStreetState): void {
      if (pre === null) pre = captureSnapshot(state);
      try {
        doFn(state);
      } catch (err) {
        // Restore action budget on failure so the command layer never
        // consumes an action when the underlying operation throws.
        // (CG-0MUUDWIXG009IB0W: atomic action consumption.)
        if (pre.actionsRemaining !== null && pre.actionsRemaining !== undefined) {
          state.actionsRemaining = pre.actionsRemaining;
        }
        if (pre.bankedActions !== null && pre.bankedActions !== undefined) {
          state.bankedActions = pre.bankedActions;
        }
        throw err;
      }
      // Per-action challenge evaluation (CG-0MU37CKRR008252I): complete any
      // challenge satisfied by the command's forward mutation and record the
      // IDs so undo can warn before reverting a completion. Reset first so a
      // redo (do after undo) does not accumulate duplicates.
      completedChallengeIds.length = 0;
      completedChallengeIds.push(...evaluateChallengesAfterAction(state));
    },
    undo(state: MainStreetState): void {
      if (pre === null) return;
      restoreSnapshot(state, pre);
      // Clear the transient per-action buffer so the scene does not read a
      // stale completion after undo.
      state._newlyCompletedThisAction = [];
    },
  };
}

// ── Commands ────────────────────────────────────────────────

/** Command: Buy Business (consumes 1 action) */
export function buyBusinessCommand(
  state: MainStreetState,
  cardId: string,
  slotIndex: number,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        consumeAction(s);
        purchaseBusiness(s, cardId, slotIndex);
      },
      `BuyBusiness ${cardId} -> slot ${slotIndex}`,
    ),
  );
}

/** Command: Buy Upgrade */
export function buyUpgradeCommand(
  state: MainStreetState,
  cardId: string,
  targetSlot?: number,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => purchaseUpgrade(s, cardId, targetSlot),
      `BuyUpgrade ${cardId} -> slot ${targetSlot ?? 'auto'}`,
    ),
  );
}

/** Command: Move market card to hand (consumes 1 action; play-from-hand costs again) */
export function moveToHandCommand(
  state: MainStreetState,
  cardId: string,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        consumeAction(s);
        moveToHand(s, cardId);
      },
      `MoveToHand ${cardId}`,
    ),
  );
}

/**
 * Command: Move an event card to hand (costs 1 daily action — buy-event is
 * an action-type operation under the action economy, CG-0MTFWBNL30043ZBM).
 * Events use the cost-at-play deferral model: the move itself costs no coins.
 */
export function moveEventToHandCommand(
  state: MainStreetState,
  cardId: string,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        consumeAction(s);
        moveToHand(s, cardId);
        (s as any).justMovedEventCardId = cardId;
      },
      `MoveEventToHand ${cardId}`,
    ),
  );
}

/** Command: Buy Event (Investment) */
export function buyEventCommand(
  state: MainStreetState,
  cardId: string,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => purchaseEvent(s, cardId),
      `BuyEvent ${cardId}`,
    ),
  );
}

/** Command: Play Investment Event from Hand */
export function playEventCommand(state: MainStreetState, handIndex?: number) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        const idx = handIndex ?? (s.hand ?? []).findIndex(c => c.family === 'event');
        const card = (s.hand ?? [])[idx] as any;
        const isSameWeek = card && (s as any).justMovedEventCardId != null && (s as any).justMovedEventCardId === card.id;
        if (!isSameWeek) consumeAction(s);
        return playEventFromHand(s, idx);
      },
      'PlayEventFromHand',
    ),
  );
}

/**
 * Command: Play Business from Hand (consumes 1 action; pays cost-at-play).
 *
 * Premium-aware (CG-0MT24X0SX007RLHN): when `premiumCost` is supplied the
 * +50% premium REPLACES the missing action (same-week composite placement
 * with 0 actions remaining) — no action is consumed and the premium price
 * is deducted, recorded in the undo/redo snapshot. When absent, the held-
 * card (plan-ahead) path is unchanged: 1 action consumed + listed cost.
 */
export function playBusinessFromHandCommand(
  state: MainStreetState,
  handIndex: number,
  slotIndex: number,
  premiumCost?: number,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        // Premium replaces the missing action — consume only on the
        // held-card / listed-cost path (CG-0MT24X0SX007RLHN).
        if (premiumCost === undefined) {
          consumeAction(s);
        }
        playBusinessFromHand(s, handIndex, slotIndex, premiumCost);
      },
      premiumCost !== undefined
        ? `PlayBusinessFromHand ${handIndex} -> slot ${slotIndex} (premium ${premiumCost})`
        : `PlayBusinessFromHand ${handIndex} -> slot ${slotIndex}`,
    ),
  );
}

/**
 * Command: Play Upgrade from Hand (cost-at-play).
 *
 * Same-week composite (CG-0MT3IYSRL001VVUP): if the upgrade at handIndex is
 * the same card just moved from market to hand this turn (justMovedUpgradeCardId),
 * the play is free — the move already consumed the action. Otherwise consumes 1 action.
 *
 * Premium-aware: when `premiumCost` is supplied the +50% premium REPLACES
 * the action (drag buy-and-play at 0 actions remaining) — no action consumed.
 */
export function playUpgradeFromHandCommand(
  state: MainStreetState,
  handIndex: number,
  targetSlot?: number,
  premiumCost?: number,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        if (premiumCost !== undefined) {
          // Premium replaces the action — no consumeAction (mirrors playBusinessFromHandCommand).
        } else {
          const card = (s.hand ?? [])[handIndex];
          const isSameWeekComposite = card != null && s.justMovedUpgradeCardId != null && s.justMovedUpgradeCardId === (card as any).id;
          if (!isSameWeekComposite) {
            consumeAction(s);
          }
          // Clear composite tracker after play (whether same-week or held).
          if (s.justMovedUpgradeCardId != null && card != null && s.justMovedUpgradeCardId === (card as any).id) {
            s.justMovedUpgradeCardId = null;
          }
        }
        // Delegate to engine helper — premiumCost currently not threading into
        // playUpgradeFromHand (upgrade premium is charged in buyAndPlaceUpgrade only);
        // kept for API parity with playBusinessFromHandCommand.
        playUpgradeFromHand(s, handIndex, targetSlot);
      },
      premiumCost !== undefined
        ? `PlayUpgradeFromHand ${handIndex} (premium ${premiumCost})`
        : `PlayUpgradeFromHand ${handIndex}`,
    ),
  );
}

/** Command: Discard a hand card, costing its coin value in reputation (clamped at 0). */
export function discardFromHandCommand(
  state: MainStreetState,
  handIndex: number,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => discardFromHand(s, handIndex),
      `DiscardFromHand ${handIndex}`,
    ),
  );
}

/**
 * Command: Buy & Place business directly to slot (consumes 1 action; +50%
 * premium, or listed price when `priceOverride` is supplied for GM parity
 * — CG-0MT24X0SX007RLHN).
 *
 * @param priceOverride Optional price to charge instead of the +50% premium
 *                      (listed cost for GM parity; unset → premium default).
 * @param extraActions  Additional daily actions to consume alongside the
 *                      drag's own action. 1 on Golden Mile days (the
 *                      equivalent composite move+place consumes 2 actions at
 *                      listed cost; drag must charge identically).
 */
export function buyAndPlaceBusinessCommand(
  state: MainStreetState,
  cardId: string,
  slotIndex: number,
  priceOverride?: number,
  extraActions: number = 0,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        for (let i = 0; i < extraActions; i += 1) consumeAction(s);
        consumeAction(s);
        buyAndPlaceBusiness(s, cardId, slotIndex, priceOverride);
      },
      `BuyAndPlace ${cardId} -> slot ${slotIndex}`,
    ),
  );
}

/**
 * Command: Buy & Place Upgrade directly onto a business (drag-drop path,
 * CG-0MT3IYSRL001VVUP). Without overrides it consumes 1 action and charges
 * the +50% premium (Math.ceil(cost * 1.5 * 2) / 2, matching business
 * buy-and-place).
 *
 * Composite parity (MS-0MVKT3TZF0091IHC): the UI resolves one price/action
 * pair from `actionsRemaining` and passes it here unchanged — on the 2+-action
 * listed-cost path `priceOverride` is the discounted listed cost and
 * `extraActions` is 1 (drag + placement); on the ≤ 1-action premium path both
 * are left unset (premium replaces the placement action). The undo snapshot
 * restores both consumed actions and the banked decrement.
 *
 * @param priceOverride Optional price to charge instead of the +50% premium
 *                      (discounted listed cost on the 2-action parity path).
 * @param extraActions  Additional daily actions to consume (1 on the parity
 *                      path, where the drag also pays the placement action).
 */
export function buyAndPlaceUpgradeCommand(
  state: MainStreetState,
  cardId: string,
  targetSlot?: number,
  priceOverride?: number,
  extraActions: number = 0,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        for (let i = 0; i < extraActions; i += 1) consumeAction(s);
        consumeAction(s);
        buyAndPlaceUpgrade(s, cardId, targetSlot, priceOverride);
      },
      `BuyAndPlaceUpgrade ${cardId} -> slot ${targetSlot ?? 'auto'}`,
    ),
  );
}

/** Command: Hire Staff from market (consumes 1 action) */
export function hireStaffCardCommand(
  state: MainStreetState,
  cardId: string,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        consumeAction(s);
        hireStaffCard(s, cardId);
      },
      `HireStaff ${cardId}`,
    ),
  );
}

/** Command: Research (refresh) the single-row market (free) */
export function refreshMarketCommand(state: MainStreetState) {
  return toCommand(
    state,
    snapshotAction(
      (s) => refreshMarket(s),
      'RefreshMarket',
    ),
  );
}

/**
 * Command: Investor free market re-roll (MS-0MTISBYLS009936W / MS-0MUOSULA8005MUCY).
 *
 * Wraps the engine's coin-free, action-free once-per-turn `useFreeMarketReroll`
 * in `snapshotAction` so the operation participates in undo/redo: the per-turn
 * gate (`investorFreeRerollUsedThisTurn`), the shared escalation counter
 * (`marketRefreshesThisTurn`) and the replaced market row are all captured
 * before the draw and restored on undo. Without the snapshot the fields would
 * serialise but a mid-turn free re-roll could not be reverted.
 */
export function freeMarketRerollCommand(state: MainStreetState) {
  return toCommand(
    state,
    snapshotAction(
      (s) => useFreeMarketReroll(s),
      'FreeMarketReroll',
    ),
  );
}

/** Command: Sell Business (free) */
export function sellBusinessCommand(
  state: MainStreetState,
  slotIndex: number,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => sellBusiness(s, slotIndex),
      `SellBusiness slot ${slotIndex}`,
    ),
  );
}

/**
 * Command: Close Business (costs 1 daily action, no coins).
 *
 * The card is removed from the street grid entirely (slot -> null) and pushed
 * to the unified `discardPile`, freeing the slot for later placement. The
 * action cost goes through the command layer's `consumeAction` — the single
 * shared enforcement point (CG-0MTCP7F9S009HARC) — so `actionsRemaining` and
 * `bankedActions` (floor 0) decrement in lock-step with every other
 * action-consuming operation. `closeBusiness` itself is free of action logic,
 * so the cost is charged exactly once.
 *
 * The pre-snapshot (which now includes `discardPile`) makes the whole close
 * reversible via the shared undo manager: undo restores the card, slot,
 * discard pile, action budget, and activity log.
 *
 * @param state     Current game state.
 * @param slotIndex Street grid slot index of the card to close.
 */
export function closeBusinessCommand(
  state: MainStreetState,
  slotIndex: number,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        consumeAction(s);
        closeBusiness(s, slotIndex);
      },
      `CloseBusiness slot ${slotIndex}`,
    ),
  );
}

/**
 * Command: Hire the pending staff applicant (CG-0MSTOATDU006UGAX, 0 cost, no hand slots).
 */
export function hireApplicantCommand(state: MainStreetState) {
  return toCommand(
    state,
    snapshotAction(
      (s) => { hireApplicantAction(s); },
      'HireApplicant',
    ),
  );
}

/**
 * Command: Take a bank loan by choosing an option from the configured loan
 * menu (Bank Loans epic MS-0MVL6DZI0000F6CG, slice MS-0MVPWS6WB008WP79).
 *
 * Deliberately does **not** consume an action: the loan is AP-neutral and the
 * snapshot captures the active-loan record (`loans`), the pending offer and
 * the credited resources, so undo removes the loan and restores the exact
 * one-active-loan state and redo re-applies it.
 *
 * @param state       Current game state.
 * @param optionIndex Index into `config.loanOptions`.
 */
export function takeLoanCommand(state: MainStreetState, optionIndex: number) {
  return toCommand(
    state,
    snapshotAction(
      (s) => takeLoan(s, optionIndex),
      `TakeLoan option ${optionIndex}`,
    ),
  );
}

/**
 * Command: Decline the pending staff applicant (CG-0MSTOATDU006UGAX, free, no other effects).
 */
export function declineApplicantCommand(state: MainStreetState) {
  return toCommand(
    state,
    snapshotAction(
      (s) => { declineApplicantAction(s); },
      'DeclineApplicant',
    ),
  );
}

/**
 * Command: Resolve the pending dual-choice incident (CG-0MTSHG8RP008E128).
 *
 * Accept applies the event's effect + pushes the accept-next card; Reject
 * refuses the effect + pushes the reject-next card. Because the command is
 * snapshot-based (pre-capture includes the unresolved `pendingEventChoice`,
 * the incident deck WITHOUT the escalation, the resource bank BEFORE the
 * effect, and active effects), undo returns to the unresolved pending state
 * with the event still in play — escalation removed, resources restored
 * (AC10 parent / AC1+AC4 undo child).
 *
 * @param state  Current game state.
 * @param option The player's (or AI's) decision.
 */
export function resolveEventChoiceCommand(
  state: MainStreetState,
  option: string | number,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        if (typeof option === 'number') {
          // F7 (MS-0MV8KQSF1004E53Y): index over the arbitrary option list.
          resolveEventOption(s, option);
        } else {
          resolveEventChoice(s, option as 'accept' | 'reject');
        }
      },
      `ResolveEventChoice ${JSON.stringify(option)}`,
    ),
  );
}

/**
 * Command: Resolve a pending human piggyback decision (F5 of
 * MS-0MUYC47EL005Z69H).
 *
 * Wraps the engine's {@link resolvePendingPiggyback} for one seat in a
 * snapshot-based reversible command (mirrors `resolveEventChoiceCommand`):
 * the pre-capture includes the unresolved `pendingPiggyback` set and the
 * competitive per-owner wallets (via `players`), so undo returns to the
 * pre-decision state — pending set re-opened, the piggybacker's coins and
 * reputation restored — and redo re-applies the chosen tier.
 *
 * - `join === true`: join-fully tier (150% charge, 100% own-board reward,
 *   no action point); when the seat cannot afford the charge the engine
 *   falls back to the automatic 50% free-ride (never a partial charge).
 * - `join === false`: automatic 50% free-ride.
 *
 * @param state  Current game state.
 * @param seatId The piggybacker owner index whose decision is resolved.
 * @param join   True to join fully, false to keep the 50% free-ride.
 */
export function resolvePiggybackCommand(
  state: MainStreetState,
  seatId: number,
  join: boolean,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        resolvePendingPiggyback(s, seatId, join);
      },
      join ? `ResolvePiggybackJoin ${seatId}` : `ResolvePiggybackFreeRide ${seatId}`,
    ),
  );
}

/**
 * Command: Let go a staff member (CG-0MSTOATDU006UGAX, -salary coins, -1 rep).
 */
export function letGoStaffCommand(state: MainStreetState, idx: number) {
  return toCommand(
    state,
    snapshotAction(
      (s) => { letGoStaffAction(s, idx); },
      `LetGoStaff ${idx}`,
    ),
  );
}

/**
 * Command: Place a hired staff member on a business slot
 * (CG-0MU3BTSQ8006ZRCU AC1-AC3). The initial placement of a newly-hired
 * member is free (no action/coins — the member is already hired);
 * **relocating** an already-employed member to another business costs exactly
 * 1 action point (MS-0MUOSUNYR0073SI1, parent AC4). Validated by
 * `canPlaceStaffOnBusiness` (business-type match + employment capacity).
 * Undo restores the previous employment and any spent action.
 */
export function placeStaffOnBusinessCommand(
  state: MainStreetState,
  staffId: string,
  slotIndex: number,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        // Relocation is a player action; hire-time placement stays free.
        if (isStaffRelocation(s, staffId, slotIndex)) {
          consumeAction(s);
        }
        placeStaffOnBusiness(s, staffId, slotIndex);
      },
      `PlaceStaff ${staffId} -> slot ${slotIndex}`,
    ),
  );
}

/**
 * Command: Move (relocate) an employed staff member to another business
 * (MS-0MUOSUKUC004G2VO, parent AC4).
 *
 * The explicit player-facing relocation action: costs exactly 1 action point
 * for all staff, is validated by `canMoveStaffOnBusiness` (the member must be
 * employed elsewhere; destination must match `allowedBusinessTypes` and have a
 * free employment slot), and is fully snapshotted so undo restores both the
 * previous employment and the spent action.
 *
 * Distinct from `placeStaffOnBusinessCommand`, which covers the action-free
 * initial placement at hire time; callers that move an already-employed member
 * should prefer this command so the intent (and the action cost) is explicit.
 */
export function moveStaffCommand(
  state: MainStreetState,
  staffId: string,
  slotIndex: number,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => {
        // Pre-flight before any mutation or action spend so an illegal move
        // leaves the state (and the action budget) untouched.
        const legality = canMoveStaffOnBusiness(s, staffId, slotIndex);
        if (!legality.legal) {
          throw new Error(legality.reason);
        }
        consumeAction(s);
        moveStaffOnBusiness(s, staffId, slotIndex);
      },
      `MoveStaff ${staffId} -> slot ${slotIndex}`,
    ),
  );
}

/**
 * Command: Remove a staff member from its business (kept hired;
 * employment cleared so per-business buffs stop). AC5 (removal flow).
 */
export function removeStaffFromBusinessCommand(
  state: MainStreetState,
  staffId: string,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => { removeStaffFromBusiness(s, staffId); },
      `RemoveStaff ${staffId}`,
    ),
  );
}

/**
 * Command: Sell / lay off a staff card entirely (AC5). Uses the existing
 * `layoffStaffCard` engine flow — removes the member from `staffCards` and
 * the business's `employedStaff`, drops `maxHandSize`/hand cards per
 * `handSlotsAdded`, returns the card to `discards.staff`. Undo restores all.
 */
export function layoffStaffCommand(
  state: MainStreetState,
  staffId: string,
) {
  return toCommand(
    state,
    snapshotAction(
      (s) => { layoffStaffCard(s, staffId); },
      `LayoffStaff ${staffId}`,
    ),
  );
}

/**
 * Command: Staff peek at the incident deck (CG-0MSXOW6GN008ZSMN).
 * Consumes 1 action, sets the once-per-turn gate, and exposes the revealed
 * card via `state.revealedPeekedCard`. The deck is NOT mutated — the card
 * stays on top face-down and is never resolved. Undo restores the action,
 * the gate, and clears the reveal.
 */
export function peekIncidentDeckCommand(state: MainStreetState) {
  return toCommand(
    state,
    snapshotAction(
      (s) => { peekIncidentDeck(s); },
      'PeekIncidentDeck',
    ),
  );
}

// Re-export renamed symbols for backward compatibility
/** @deprecated Use buyBusinessCommand() instead. */
export const BuyBusinessCommand = buyBusinessCommand;
/** @deprecated Use buyUpgradeCommand() instead. */
export const BuyUpgradeCommand = buyUpgradeCommand;
/** @deprecated Use buyEventCommand() instead. */
export const BuyEventCommand = buyEventCommand;
/** @deprecated Use playEventCommand() instead. */
export const PlayEventCommand = playEventCommand;
/** @deprecated Use moveToHandCommand() instead. */
export const BuyBusinessToHandCommand = moveToHandCommand;
/** @deprecated Use refreshMarketCommand() instead. */
export const BuyRefreshInvestmentsCommand = refreshMarketCommand;
