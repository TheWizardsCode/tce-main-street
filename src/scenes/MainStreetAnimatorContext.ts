/**
 * Main Street: Animator Context Interface
 *
 * The public surface the animator exposes to its helper modules. Helper
 * modules depend ONLY on this type (never on each other), so the module graph
 * is a hub-and-spoke with no cycles. Also hosts the income-phase public types.
 *
 * @module
 */

import type { SlotIncome, SlotPhaseBreakdown, SynergyPair } from '../MainStreetAdjacency';
import type { PendingEndOfTurnDeltas } from '../MainStreetEngine';
import type { CoinGridHandle } from '../coin-grid';

export type IncomePhaseKey = 'base' | 'synergy' | 'reputation' | 'events' | 'upcoming' | 'collect';

/** Options for {@link MainStreetAnimator.animateIncomePhases}. */
export interface IncomePhaseOptions {
  /** Milliseconds between phase starts (default `INCOME_PHASE_GAP_MS`). */
  phaseGapMs?: number;
  /** Initial delay before the first phase (default 0). */
  startDelayMs?: number;
  /**
   * Lifecycle hook called at each phase start (including `collect`), in
   * both full and reduced-motion modes. Never throws into the choreography.
   */
  onPhase?: (phase: IncomePhaseKey, index: number) => void;
  /**
   * Deferred-mutation deltas (CG-0MTR72P14000VO6Q): when provided, the
   * collection finalize step applies them to `state.resourceBank` exactly
   * once (guarded by the scene's `endOfTurnDeltasApplied` flag) so the HUD
   * numbers update only after the coins land. Absent for the legacy
   * immediate path (reduced-motion / tutorial / headless) where the engine
   * already applied them.
   */
  pendingDeltas?: PendingEndOfTurnDeltas;
}

/** A producing slot resolved to its live card container + coin grid handle. */
export interface IncomePhaseSlot {
  pd: SlotPhaseBreakdown;
  card: Phaser.GameObjects.Container;
  handle: CoinGridHandle;
  /** Coins currently shown in the on-card grid (integer). */
  displayed: number;
}

/**
 * One direction of a synergy coin flight along a synergy line
 * (CG-0MTV6LZEA003YS3E).
 *
 * For each synergy pair the animator emits two flights — one per direction —
 * so both cards in the pair visibly receive coins from the other.
 */
export interface SynergyPhaseFlight {
  /** Giver slot index (coin origin, clipped slot edge). */
  fromSlotIndex: number;
  /** Receiver slot index (coin destination, receiver's coin grid). */
  toSlotIndex: number;
  /** Receiver's phase slot + on-card coin grid (the `revealInGrid` target). */
  slot: IncomePhaseSlot;
  /** Coin origin on the giver's clipped slot edge (`p1` of the pair geometry). */
  start: { x: number; y: number };
  /** Coin destination on the receiver's clipped slot edge (`p2` of the pair geometry). */
  end: { x: number; y: number };
  /**
   * Receiver's synergy coin amount attributable to this giver (integer, ×100
   * economy). Shares are split across the receiver's matching neighbours so
   * they sum exactly to the receiver's `SlotPhaseBreakdown.synergyBonus`.
   */
  amount: number;
}

/** MainStreetAnimator -- animation and HUD-delta helper for Main Street scene. */

export interface MainStreetAnimatorContext {
  readonly scene: any;
  currentCoinStagger: number;
  resetCoinStaggerForTurn(): void;
  reduceCoinStaggerAfterCard(): void;
  getCardDelay(numSlots: number, si: number): number;
  getFlightDuration(numSlots: number, si: number): number;
  getIconStagger(numIcons: number, i: number): number;
  animateHudValueChanges(params: {
    coins: number;
    reputation: number;
    coinX: number;
    repX: number;
    hudY: number;
  }): void;
  animateCelebration(challengeTitle: string): Promise<void>;
  animateIncomeCollection(params: {

    /** Income result from `processEndOfTurn` (pre-multiplier totals). */
    income: {
      total: number;
      breakdown: SlotIncome[];
    };
    /** Per-slot reputation contributions (`currentReputationPerTurn > 0`). */
    repSources: Array<{ slotIndex: number; rep: number }>;
  }): void;
  animateIncomePhases(phaseData: SlotPhaseBreakdown[], options: IncomePhaseOptions ): void;
  runIncomePhase(phase: IncomePhaseKey, slots: IncomePhaseSlot[], ctx: {
    reducedMotion: boolean;
  }): void;
  eventDeltaEffects(slots: IncomePhaseSlot[]): Array<{
    sourceEventId: string;
    description: string;
  }>;
  eventSourcePoint(): { x: number; y: number };
  /**
   * Builds the bidirectional synergy-line coin flights for the `synergy` income
   * phase: one flight per direction per synergy pair, each carrying the
   * receiver's per-neighbour synergy share
   * (CG-0MTV6LZEA003YS3E).
   */
  synergyPhaseFlights(slots: IncomePhaseSlot[]): SynergyPhaseFlight[];
  countOutCoins(slot: IncomePhaseSlot, amount: number, at: number): void;
  revealInGrid(slot: IncomePhaseSlot, cumulativeAmount: number): void;
  flyCoinsIn(
    slot: IncomePhaseSlot,
    amount: number,
    from: { x: number; y: number },
    at: number,
    flightMs?: number,
  ): void;
  /**
   * Flies coins from `from` to `to` (along a synergy line) and increments the
   * receiver's on-card coin grid on each arrival
   * (CG-0MTV6LZEA003YS3E).
   */
  flyCoinsAlongLine(
    slot: IncomePhaseSlot,
    amount: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
    at: number,
    flightMs?: number,
  ): void;
  flyCoinsOut(
    slot: IncomePhaseSlot,
    amount: number,
    to: { x: number; y: number },
    at: number,
    flightMs?: number,
  ): void;
  /**
   * Flies coin visuals point-to-point without touching a business grid
   * (CG-0MUA1UH3A008M4BS — all Upcoming coin deltas: gain actor → HUD coin
   * counter, loss HUD coin counter → actor).
   */
  flyCoinsToPoint(
    from: { x: number; y: number },
    to: { x: number; y: number },
    amount: number,
    at: number,
    flightMs?: number,
  ): void;
  /**
   * Flies reputation-pip visuals point-to-point (CG-0MUA1UH3A008M4BS AC3 —
   * reputation parity for Upcoming deltas: gain actor → HUD reputation
   * counter, loss HUD counter → actor).
   */
  flyRepPips(
    from: { x: number; y: number },
    to: { x: number; y: number },
    amount: number,
    at: number,
    flightMs?: number,
  ): void;
  applyPendingDeltasOnce(deltas: PendingEndOfTurnDeltas | undefined): void;
  collectIncomeGrids(slots: IncomePhaseSlot[], ctx: {
    reducedMotion: boolean;
    creditedTotal: number;
    /** Deferred-mutation deltas to apply when the collection finishes (CG-0MTR72P14000VO6Q). */
    pendingDeltas?: PendingEndOfTurnDeltas;
  }): void;
  creditedIncomeTotal(phaseData: SlotPhaseBreakdown[]): number;
  showIncomePhaseLabel(text: string, color: number): void;
  animateMarketDealIn(params: {
    row: 'market';
    /** Rendered card containers for the row, in slot order — these deal in. */
    cards: Phaser.GameObjects.Container[];
    /**
     * Cards leaving the row (Discover/Research): snapshot visuals at their
     * old slot positions fade/shrink out before the incoming cards deal in.
     */
    outgoing?: Array<{
      cardId: string;
      family: 'business' | 'community-space' | 'event' | 'upgrade';
      x: number;
      y: number;
    }>;
  }): void;
  animateIncidentReveal(params: {
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
  }): void;
  /**
   * Animates the resource-delta bubbles between the board-centre incident card
   * and the HUD counters during the reveal hold. Gain = card → HUD, loss =
   * HUD → card, for coins and reputation alike; both coordinate axes follow
   * the sign (CG-0MUA1UH3A008M4BS).
   */
  animateIncidentDeltaBubbles(params: {
    coinChange: number;
    repChange: number;
    cardCenter: { x: number; y: number };
    hudCoinX: number;
    hudRepX: number;
    hudY: number;
  }): void;
  animatePeekReveal(params: {
    cardId: string;
    cardName: string;
    /** Origin of the reveal: the face-down incident-deck stack centre. */
    from: { x: number; y: number };
    /** Fired after the card is returned face-down (both modes). */
    onComplete?: () => void;
  }): void;
  animateSynergyFormation(pair: SynergyPair): void;
  popSynergyText(at: { x: number; y: number }, _color: number): void;
  findStreetCardContainer(slotIndex: number): Phaser.GameObjects.Container | null;
  getMarketCardCenter(_row: 'market', slotIndex: number): { x: number; y: number } | null;
  animateWeekBanner(params: { turn: number; week: number; year: number }): void;
  animateGameOver(params: { win: boolean; width: number; height: number }): void;
  animateUndoRedo(params: { action: 'undo' | 'redo'; description: string }): void;
  getStreetSlotCenter(slotIndex: number): { x: number; y: number };
  localSlotCentre(slotIndex: number): { x: number; y: number };
  animateLevelUp(params: { slotIndex: number; level: number }): void;
  animateSell(params: {
    slotIndex: number;
    refund: number;
    cardId: string;
    family: 'business' | 'community-space';
  }): Promise<void>;
  animateClose(params: {
    slotIndex: number;
    cardId: string;
    family: 'business' | 'community-space';
  }): Promise<void>;
  animateEventPlayed(params: { x: number; y: number; eventName: string }): void;
  getHandCardCenter(): { x: number; y: number };
  createTransferCardVisual(
    cardId: string,
    family: 'business' | 'community-space' | 'event' | 'upgrade' | 'staff',
    atX: number,
    atY: number,
  ): Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform;
  cleanupTransferAnimations(): void;
  animateTransferFromMarket(options: {
    cardId: string;
    family: 'business' | 'community-space' | 'event' | 'upgrade' | 'staff';
    row: 'market';
    slotIndex: number;
    /**
     * Optional start position for the transfer visual. When omitted the
     * visual originates at the market card's slot centre (click/AI flows,
     * where the card still sits in the market). Drag-and-drop flows pass
     * the drop location so the animation continues from where the card was
     * released instead of jumping back to the market row.
     */
    source?: { x: number; y: number };
    destination: { x: number; y: number };
    /**
     * Optional explicit animation duration (ms). When omitted the transfer
     * keeps the fixed 1500ms default used by click-to-buy / place-from-hand
     * / upgrade / event / AI flows. The drag-and-drop buy path passes a
     * distance-proportional duration (see `computeDragTransferDuration` in
     * MainStreetConstants.ts) so a card dropped near its slot settles
     * quickly. Reduced-motion behaviour is unchanged: the animation is
     * skipped entirely before this option is consulted.
     */
    duration?: number;
  }): Promise<void>;
  animateApplicantWalkOn(
    container: Phaser.GameObjects.Container,
    cardW: number,
    _cardH: number,
    reducedMotion?: boolean,
  ): void;
  animateApplicantWalkOff(
    container: Phaser.GameObjects.Container,
    cardW: number,
    _cardH: number,
    reducedMotion?: boolean,
    onComplete?: () => void,
  ): void;
  animateApplicantWalkIn(
    container: Phaser.GameObjects.Container,
    targetSlotIndex: number,
    _cardW: number,
    _cardH: number,
    reducedMotion?: boolean,
    onComplete?: () => void,
  ): void;
}

// ── Upcoming / event delta routing (CG-0MUA1UH3A008M4BS) ────────────────
// Pure routing decision shared by the income animator and its unit tests.
// Lives in the type hub so helper modules can depend on it without importing
// each other (preserving the hub-and-spoke import graph).

/** A resolved flow for one coin/reputation delta (origin → target + kind). */
export interface DeltaFlowRoute {
  /**
   * Flow origin, per the uniform incident-reveal sign rule: for a gain it is
   * the actor (the affected business card when attached, otherwise the
   * Upcoming panel); for a loss it is the HUD resource counter (coins or
   * reputation).
   */
  from: { x: number; y: number };
  /** Flow destination: the HUD resource counter for a gain, the actor for a loss. */
  to: { x: number; y: number };
  /**
   * Whether the delta's actor is a business card (`true`) or the HUD totals
   * (`false`). Attached deltas (a number `attachedSlotIndex`) use the business
   * card as the actor; unattached deltas use the Upcoming panel.
   */
  attached: boolean;
  /** Resource kind: coins or reputation (reputation parity — AC3). */
  kind: 'coin' | 'rep';
  /** Signed delta (negative = loss). */
  delta: number;
}

/** Geometry the routing helper needs; supplied by the caller (scene layout). */
export interface DeltaFlowGeometry {
  /** Upcoming-panel source point (coin/rep originate here for gains). */
  upcomingSource: { x: number; y: number };
  /** Business-attached target: the affected slot's centre. */
  slotCenter: { x: number; y: number };
  /** HUD coin counter position. */
  hudCoin: { x: number; y: number };
  /** HUD reputation counter position. */
  hudRep: { x: number; y: number };
}

/**
 * Resolves the flow route (origin, destination, attachment, kind) for an
 * Upcoming/event coin or reputation delta (CG-0MUA1UH3A008M4BS AC1–AC3).
 *
 * Routing is uniform for coins and reputation and reuses the incident-reveal
 * sign rule (CG-0MU41XVNV002N2D9):
 * - The **actor** is the affected business card when the delta is **attached**
 *   (`attachedSlotIndex` is a number — source `EventCard.target` is
 *   `SpecificSynergy` / `RandomBusiness`), otherwise the Upcoming panel.
 * - The **resource** is the HUD coin counter for `coin` deltas and the HUD
 *   reputation counter for `rep` deltas.
 * - **Gain** (`delta >= 0`): actor → HUD resource (a card that gives flows to
 *   the HUD). **Loss** (`delta < 0`): HUD resource → actor (a card that costs
 *   draws from the HUD).
 *
 * This resolves the producer's manual review (2026-10-01): the flow must go
 * "from the card to the HUD" for a gain and "from the HUD to the card" for a
 * loss, for **both** coins and reputation. No Upcoming delta ever touches a
 * business coin grid; the grid only ever accumulates credited income.
 *
 * Pure and exported for unit testing (AC1/AC2/AC3 assertions on flight
 * start/end points and direction).
 */
export function resolveDeltaFlow(
  delta: { delta: number; kind?: 'coin' | 'rep'; attachedSlotIndex?: number | null },
  geometry: DeltaFlowGeometry,
): DeltaFlowRoute {
  const kind: 'coin' | 'rep' = delta.kind === 'rep' ? 'rep' : 'coin';
  const attached = typeof delta.attachedSlotIndex === 'number';
  const isGain = delta.delta >= 0;
  const actor = attached ? geometry.slotCenter : geometry.upcomingSource;
  const resource = kind === 'rep' ? geometry.hudRep : geometry.hudCoin;
  return {
    from: isGain ? actor : resource,
    to: isGain ? resource : actor,
    attached,
    kind,
    delta: delta.delta,
  };
}
