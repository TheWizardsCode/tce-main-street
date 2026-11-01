/**
 * Main Street: Engine Action and Result Types
 *
 * All discriminated-union action payloads and result/closing interfaces
 * consumed by the engine. Types only — leaf module.
 *
 * @module
 */

import { finishDeferredTurnClosing, processEndOfTurn } from './MainStreetEngineTurnClosing';
import type { IncomeResult, OwnerIncomeResult } from './MainStreetAdjacency';
import type { EventCard } from './MainStreetCards';

export interface BuyBusinessAction {
  type: 'buy-business';
  cardId: string;
  slotIndex: number;
}

/**
 * Buy an upgrade card and apply it to a business.
 *
 * Headless equivalent of the same-week click composite
 * (CG-0MT3IYSRL001VVUP): the market click moves the upgrade to hand (one
 * daily action) and applying it the same day is free, so buying and applying
 * in one step costs exactly **one daily action** at the listed cost.
 */
export interface BuyUpgradeAction {
  type: 'buy-upgrade';
  cardId: string;
  targetSlot?: number;
}

/** Buy an Investment-trigger event card (held until played). */

export interface BuyEventAction {
  type: 'buy-event';
  cardId: string;
}

/** Play the currently held Investment event. */

export interface PlayEventAction {
  type: 'play-event';
  handIndex?: number;
}

/** Move a market card into the hand for free (CG-0MSTOATDT009BRX2). */

export interface MoveToHandAction {
  type: 'move-to-hand';
  cardId: string;
}

/** Play a business/community-space card from the hand onto the street (cost-at-play). */

export interface PlayBusinessFromHandAction {
  type: 'play-business-from-hand';
  handIndex: number;
  slotIndex: number;
}

/** Play an upgrade card from the hand onto a business (cost-at-play). */

export interface PlayUpgradeFromHandAction {
  type: 'play-upgrade-from-hand';
  handIndex: number;
  targetSlot?: number;
}

/** Play an Investment event from the hand (cost-at-play). */

export interface PlayEventFromHandAction {
  type: 'play-event-from-hand';
  handIndex: number;
}

/** Discard a hand card during the player's turn, costing the card's coin value in reputation. */

export interface DiscardFromHandAction {
  type: 'discard-from-hand';
  handIndex: number;
}

/** Directly buy a business from the market and place it on the street (costs 50% more). */

export interface BuyAndPlaceAction {
  type: 'buy-and-place';
  cardId: string;
  slotIndex: number;
}

/**
 * Buy an upgrade from the market and apply it in one step (drag-drop path,
 * CG-0MT3IYSRL001VVUP). Without overrides it charges a +50% premium and
 * consumes 1 action.
 *
 * Composite parity (MS-0MVKT3TZF0091IHC): with 2+ actions remaining the UI
 * supplies the discounted listed cost as `priceOverride` and `extraActions: 1`
 * (drag + placement); with ≤ 1 action it leaves both unset and the premium +
 * explainer path applies.
 */
export interface BuyAndPlaceUpgradeAction {
  type: 'buy-and-place-upgrade';
  cardId: string;
  targetSlot?: number;
  /** Optional listed-price override for the 2-action parity path (see buyAndPlaceUpgrade). */
  priceOverride?: number;
  /** Additional daily actions to consume alongside the drag's action (parity path: 1). */
  extraActions?: number;
}

/** Hire a staff card from the general market row. */

export interface HireStaffAction {
  type: 'hire-staff';
  cardId: string;
}

/** End the current market/action phase. */

export interface EndTurnAction {
  type: 'end-turn';
}

/**
 * Staff peek skill (CG-0MSXOW6GN008ZSMN): reveal the top card of the
 * face-down incident deck once per turn, as an action. The peeked card is
 * returned face-down without being resolved.
 */
export interface PeekIncidentAction {
  type: 'peek-incident-deck';
}

/** Community Favour action: exchange coins ↔ reputation. */

export interface CommunityFavourAction {
  type: 'community-favour';
  /** Direction of the exchange. */
  direction: 'coins-to-rep' | 'rep-to-coins';
}

/**
 * Close a street card (MS-0MURC6XO8005W57D): removes a non-sold business or
 * community-space card for 1 action and no coins, applying the reputation
 * consequence (penalty for reputation-positive cards, boost for nuisance
 * cards). Exposed to the AI so its close evaluation factors the reputation
 * cost (supersedes the former Close AC6 "no AI changes").
 */
export interface CloseBusinessAction {
  type: 'close-business';
  slotIndex: number;
}

/**
 * Take a bank loan by choosing one option from the configured loan menu
 * (Bank Loans epic MS-0MVL6DZI0000F6CG, slice MS-0MVPWS6WB008WP79).
 *
 * Carries the chosen `LoanOption` index into `config.loanOptions`. Costs **no
 * action point** and is refused with a clear user-facing reason when the seat
 * already holds an active loan (one loan at a time, producer Q1 = A).
 */
export interface TakeLoanAction {
  type: 'take-loan';
  /** Index into `config.loanOptions` for the option being taken. */
  optionIndex: number;
}

/** Union of all player actions. */

export type PlayerAction =
  | BuyBusinessAction
  | BuyUpgradeAction
  | BuyEventAction
  | MoveToHandAction
  | PlayBusinessFromHandAction
  | PlayUpgradeFromHandAction
  | PlayEventFromHandAction
  | DiscardFromHandAction
  | BuyAndPlaceAction
  | BuyAndPlaceUpgradeAction
  | HireStaffAction
  | PlayEventAction
  | PeekIncidentAction
  | CommunityFavourAction
  | CloseBusinessAction
  | TakeLoanAction
  | EndTurnAction;

// ── Turn Result ─────────────────────────────────────────────

/** Result returned after processing a full turn cycle. */

/**
 * Pending resource deltas computed during end-of-turn.
 * Used by the deferred-mutation pattern (CG-0MTR72P14000VO6Q):
 * the engine computes deltas without mutating state for the
 * interactive path; the scene layer applies them after animations complete.
 */
export interface PendingEndOfTurnDeltas {
  /** Net coin delta from income + ongoing costs (may be negative). */
  pendingCoinDelta?: number;
  /** Net reputation delta from income (may be negative). */
  pendingRepDelta?: number;
  /** Score delta from challenges completed this turn (positive only). */
  pendingScoreDelta?: number;
}

/**
 * End-of-turn ledger for one single-player closing (MS-0MVP45KZV006TMUK).
 *
 * Reporting-only data for the Turn Summary dialog (parent MS-0MVL6HMDP004WI41):
 * it mirrors deltas already applied (or, on the deferred path, returned as
 * {@link PendingEndOfTurnDeltas}) so reading it consumes no RNG and mutates no
 * state. Populated by `processEndOfTurn` for the deferred and legacy paths;
 * absent (`undefined`) for competitive closings and for hand-built results.
 *
 * Conventions:
 * - `incomeByPhase` mirrors `IncomeResult.phaseBreakdown`: the four subtotals
 *   sum to the coins the income phase credited.
 * - `ongoingCosts` are **signed** coin deltas (zero or negative), mirroring the
 *   ongoing-cost helpers' return values.
 * - `oneOffDeltas` are non-recurring signed deltas — pre-closing MarketPhase
 *   spending/earning (purchases, sales, event plays, Community Favour) plus any
 *   closing effect outside income, ongoing costs and the incident — so the
 *   ledger reconciles exactly:
 *   `netCoinChange = incomeByPhase (sum) + ongoingCosts (sum) +
 *   incidentCoinChange + oneOffDeltas.coins`; reputation reconciles the same
 *   way against `income.repDelta` and `incidentRepChange`.
 */
export interface TurnLedger {
  /** Per-phase coin income subtotals (sums to the income phase's credited coins). */
  incomeByPhase: {
    base: number;
    synergy: number;
    reputation: number;
    events: number;
  };
  /** Ongoing (recurring) expense subtotals, signed (zero or negative). */
  ongoingCosts: {
    staff: number;
    community: number;
    business: number;
  };
  /** Net coin delta from the resolved incident (negative = loss). */
  incidentCoinChange: number;
  /** Net reputation delta from the resolved incident (negative = loss). */
  incidentRepChange: number;
  /** Non-recurring coin/reputation deltas (see {@link TurnOneOffDeltas}). */
  oneOffDeltas: {
    coins: number;
    reputation: number;
  };
  /** Net coin change for the day (closing coins − day-start coins). */
  netCoinChange: number;
  /** Net reputation change for the day (closing rep − day-start rep). */
  netRepChange: number;
  /** Net score change for the day (closing score − day-start score). */
  netScoreChange: number;
  /**
   * Businesses standing on the street at closing, keyed by owner id as a
   * string (`String(playerId)`; `'0'` in single-player). Owner-keyed so the
   * competitive per-player panel can reuse the same data later; sold slots
   * are excluded (they no longer run as businesses).
   */
  businessesOwned: Record<string, number>;
}

export interface TurnResult extends PendingEndOfTurnDeltas {
  /** Income earned during the income phase. */
  income: IncomeResult | null;
  /** Incident event drawn and resolved (if any). */
  incident: EventCard | null;
  /** Net coin delta from the resolved incident (negative = loss). */
  incidentCoinChange: number;
  /** Net reputation delta from the resolved incident (negative = loss). */
  incidentRepChange: number;
  /** Current game result after the turn. */
  gameResult: 'playing' | 'win' | 'loss';
  /** Current final score. */
  finalScore: number;
  /** Challenge IDs that were newly completed during this turn's evaluation. */
  newlyCompletedChallenges: string[];
  /**
   * True when the closing sequence paused because a dual-choice incident was
   * drawn (CG-0MTSHG8RP008E128). When set, `state.pendingEventChoice` holds
   * the drawn event and the UI must present the Accept/Reject dialog before
   * the deferred closing (EndCheck / next week) can run.
   */
  choicePending: boolean;
  /**
   * True when the shared closing paused because an eligible organiser event
   * raised pending piggyback decisions that are not yet resolved (F3 of epic
   * MS-0MUYC47EL005Z69H). When set, `state.pendingPiggyback` holds one
   * unresolved entry per other active seat; the caller resolves them via
   * `resolvePendingPiggyback` before re-running the closing. Absent/false
   * when no piggyback decision is pending.
   */
  piggybackPending?: boolean;
  /**
   * True when the closing paused because a bankruptcy bailout loan offer was
   * raised (Bank Loans epic MS-0MVL6DZI0000F6CG, slice MS-0MVPWS9L9001PVXG).
   * When set, `state.pendingLoanOffer` holds the offer and the caller resolves
   * it via `acceptLoanOffer` / `declineLoanOffer` before the closing tail
   * (`finishDeferredTurnClosing`) re-runs. Mirrors `choicePending` /
   * `piggybackPending`; absent/false when no offer is open.
   */
  pendingLoanOffer?: boolean;
  /**
   * True when this result came from the deferred-mutation path
   * (processEndOfTurn with `deferResourceApplication`, CG-0MTR72P14000VO6Q):
   * the resource deltas are un-applied and the closing tail (EndCheck → next
   * day) has NOT run. The scene applies the deltas after the end-of-turn
   * animations complete and calls {@link finishDeferredTurnClosing} before
   * acting on `gameResult` / `finalScore` (which are pre-turn values here).
   * Absent/false for the legacy path and headless/AI results.
   */
  requiresDeferredClosing?: boolean;
  /**
   * Authoritative per-seat income applied during a competitive shared closing
   * (N >= 2, MS-0MUYFX56M006RVIZ). Each entry is an `OwnerIncomeResult` from
   * `applyCompetitiveIncome`, whose `income.phaseBreakdown` drives the per-seat
   * income choreography. Only the non-eliminated seats are surfaced, in seat
   * order; absent for single-player / N=1 closings.
   *
   * Presentation-only data: it mirrors deltas already applied to each
   * `PlayerRecord`, so reading it consumes no RNG and mutates no state.
   */
  playerIncome?: OwnerIncomeResult[];
  /**
   * End-of-turn ledger (MS-0MVP45KZV006TMUK): per-phase income subtotals,
   * ongoing-cost subtotals, incident and one-off deltas, net coin/reputation/
   * score change for the day, and the businesses owned at closing. Populated
   * by `processEndOfTurn` for both the deferred and the legacy single-player
   * paths (refreshed against the final state by the deferred closing), so a
   * Turn Summary can render every value from committed engine data. Absent
   * for competitive closings and for hand-built results — consumers must
   * treat it as optional. A paused result (pending event choice / piggyback)
   * carries a day-to-date ledger: the net rows are still measured against the
   * day-start snapshot, but the closing phases have not run yet.
   */
  turnLedger?: TurnLedger;
}

/**
 * Options for {@link processEndOfTurn}.
 */
export interface EndOfTurnOptions {
  /**
   * Deferred-mutation flag (CG-0MTR72P14000VO6Q). When `true` (interactive
   * scene path), resource deltas (income, ongoing costs, incident) are
   * computed and returned in `TurnResult.pending*Delta` but NOT applied to
   * `state.resourceBank` / `state.finalScore`, and the closing tail
   * (EndCheck → next week) is deferred to {@link finishDeferredTurnClosing}
   * which the caller runs after the end-of-turn animations complete.
   *
   * When unset/false (headless/AI path and reduced-motion mode), the legacy
   * behaviour is preserved: deltas are applied immediately and the turn
   * closes deterministically within this call.
   */
  deferResourceApplication?: boolean;
  /**
   * Skip this turn's loan-repayment pass (Bank Loans epic
   * MS-0MVL6DZI0000F6CG, slice MS-0MVPWS9L9001PVXG). Used only when a
   * pre-income bailout pause resumes: the repayment phase already ran before
   * the offer was resolved, so the freshly accepted bailout loan must not be
   * charged its first instalment in the same closing.
   */
  skipLoanRepayments?: boolean;
}

/**
 * Result of applying an Accept / Reject decision for a pending dual-choice
 * incident (CG-0MTSHG8RP008E128).
 */
export interface EventChoiceResolution {
  /** The event the decision was made about. */
  event: EventCard;
  /**
   * The chosen option's label token (F3 AC3): the label IS the token — e.g.
   * 'Accept', 'Reject', or a generalised label such as 'Investigate the
   * ledger'. The legacy lowercase 'accept'/'reject' tokens were removed.
   */
  option: string;
  /** Net coin delta applied by the chosen path (0 for reject / durations). */
  coinChange: number;
  /** Net reputation delta applied by the chosen path. */
  repChange: number;
  /**
   * The escalation card instance pushed onto the incident deck by the chosen
   * path (null when the chain ends — no next card).
   */
  pushedCard: EventCard | null;
}

/**
 * Context carried into the single-player closing tail (EndCheck → next week).
 * Shared by the normal path (processEndOfTurn) and the deferred path
 * (finishDeferredEndOfTurn after a dual-choice incident).
 */
export interface SinglePlayerTurnClosingContext {
  /** Income result of the turn being closed (null when no income ran). */
  income: IncomeResult | null;
  /** The resolved incident (null when deferred / no incident). */
  incident: EventCard | null;
  /** Net coin delta from the resolved incident. */
  incidentCoinChange: number;
  /** Net reputation delta from the resolved incident. */
  incidentRepChange: number;
  /** The turn being summarised by the net row. */
  turnEnded: number;
}

