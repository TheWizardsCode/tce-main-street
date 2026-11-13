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
import type { LoanPayoff } from './MainStreetLoans';

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
  /**
   * Q3-A hire-and-place composite destination (MS-0MWEWIP02006VNFO): for a
   * **business-staff** hire the action carries the street-grid slot the member
   * is placed at as part of the same action. Absent for management-company
   * staff hires (no destination step, unchanged).
   */
  slotIndex?: number;
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

// ── One-off attribution (MS-0MWBZDNH3006DXV7) ────────────────

/**
 * Stable source keys for one-off breakdown entries. The engine stores these
 * keys as {@link OneOffBreakdownEntry.label}; consumers localise them via the
 * tooltip module's i18n keys (unknown keys render verbatim — absent-safe).
 */
export const ONE_OFF_SOURCE_KEYS = {
  /** Cards bought/placed during the MarketPhase (market or hand, cost at play). */
  marketPurchase: 'market-purchase',
  /** Card sale refunds (business/community-space sold from the grid or hand). */
  marketSale: 'market-sale',
  /** Investment event plays (cost + resolved effects, signed). */
  eventPlay: 'event-play',
  /** Community Favour exchange (coins → reputation or the reverse). */
  communityFavour: 'community-favour',
  /** Bank-loan scheduled repayment (negative; due in the closing). */
  loanRepayment: 'loan-repayment',
  /** Bank-loan principal taken during the MarketPhase (positive). */
  loanTaken: 'loan-taken',
  /** Bankruptcy bailout loan principal accepted at the closing (positive). */
  loanBailout: 'loan-bailout',
} as const;

/** One canonical source key of a one-off breakdown entry. */
export type OneOffSourceKey = (typeof ONE_OFF_SOURCE_KEYS)[keyof typeof ONE_OFF_SOURCE_KEYS];

/**
 * One attributed source of the one-off row (MS-0MWBZDNH3006DXV7).
 *
 * `coins` is the signed coin delta the source contributed (negative = cost),
 * `reputation` the signed reputation delta it moved (zero for sources that
 * only touch coins). The entries of a ledger's {@link TurnLedger.oneOffBreakdown}
 * sum to the authoritative residual {@link TurnLedger.oneOffDeltas}.coins
 * within a documented rounding tolerance(alignment A2).
 */
export interface OneOffBreakdownEntry {
  /** A {@link OneOffSourceKey} (or any stable label consumers render verbatim). */
  label: string;
  /** Signed coin delta contributed by this source. */
  coins: number;
  /** Signed reputation delta contributed by this source (zero when none). */
  reputation: number;
}

/**
 * Per-source one-off deltas captured during the turn
 * (MS-0MWBZDNH3006DXV7).
 *
 * A transient, engine-side accumulator (one per seat in competitive play) that
 * every MarketPhase and closing source writes to as it moves coins/reputation,
 * so the one-off row can explain itself instead of being a bare residual. It
 * never affects game logic — it is presentation data only — and is reset at
 * each WeekStart.
 */
export interface TurnOneOffAttribution {
  /** Coins spent placing/buying cards during the MarketPhase (negative). */
  marketPurchaseCost: number;
  /** Coins received from card sales during the MarketPhase (positive). */
  marketSaleProceeds: number;
  /** Signed coin delta from Investment event plays (cost + resolved effects). */
  eventPlayCoinEffect: number;
  /** Signed reputation delta from Investment event plays. */
  eventPlayRepEffect: number;
  /** Signed coin delta from the Community Favour exchange. */
  communityFavourCoins: number;
  /** Signed reputation delta from the Community Favour exchange. */
  communityFavourRep: number;
  /** Coins repaid on active bank loans during the closing (negative). */
  loanRepaid: number;
  /** Principal credited by a MarketPhase bank loan (positive). */
  loanTaken: number;
  /** Principal credited by an accepted bailout loan (positive). */
  loanBailout: number;
}

// ── Turn Result ─────────────────────────────────────────────

/**
 * One seat's wallet snapshot used by the competitive round ledger
 * (MS-0MVRNW26W0070CP0).
 *
 * `coins` / `reputation` / `score` are the seat's `PlayerRecord` values at one
 * moment in time — the day-start snapshot or the closing balance — so the
 * ledger can reconcile `dayStart + net == closing` per seat.
 */
export interface OwnerRoundBalance {
  coins: number;
  reputation: number;
  score: number;
}

/**
 * One seat's round ledger for a competitive shared closing
 * (MS-0MVRNV9Y8008IKGK).
 *
 * Reporting-only: every value mirrors deltas already applied to the seat's
 * `PlayerRecord` during the shared closing, so reading it consumes no RNG and
 * mutates no state. It exists so a per-seat Turn Summary panel is testable
 * without a browser.
 *
 * Extended with the day's net change, closing balances and the seat's share of
 * the resolved incident and one-off deltas (MS-0MVRNW26W0070CP0), so a
 * competitive row carries the same figures the single-player panel shows.
 * Every addition is optional and absent-safe: consumers fall back to the
 * pre-extension row shape when a hand-built or older ledger omits them.
 */
export interface OwnerRoundLedger {
  /** Owner / seat index (index into `state.players`). */
  ownerId: number;
  /**
   * Businesses standing on the street at closing for this owner. Sold slots
   * are excluded (they no longer run as businesses), matching
   * `TurnLedger.businessesOwned`.
   */
  businessesOwned: number;
  /**
   * Per-phase income subtotals, mirroring `IncomeResult.phaseBreakdown` for
   * this seat's own slots: the four values sum to the coins the income phase
   * credited to this seat.
   */
  incomeByPhase: TurnLedger['incomeByPhase'];
  /** Sum of {@link incomeByPhase} — coins the income phase credited to this seat. */
  incomeTotal: number;
  /**
   * Ongoing expenses charged to this seat in the closing, split by category
   * (MS-0MVRNVHJ50095N9Y). Same categories, sign convention and semantics as
   * `TurnLedger.ongoingCosts`, so the per-seat panel reuses the single-player
   * expense labels and signed formatting.
   *
   * Optional and absent-safe: a hand-built ledger (or one produced before this
   * field existed) carries no breakdown, which consumers render as three zero
   * rows rather than dropping the seat.
   */
  ongoingCosts?: OwnerOngoingCosts;
  /**
   * Day-start wallet snapshot for this seat: coins / reputation / score as they
   * stood when the shared day opened, before any seat's MarketPhase ran
   * (MS-0MVRNW26W0070CP0). The baseline for the three net rows, so the net
   * covers the seat's own MarketPhase spending and matches the single-player
   * ledger's day-start identity.
   *
   * Optional and absent-safe: a hand-built ledger (or a closing reached without
   * a day start) omits it, and consumers treat the closing balance minus the
   * net change as the baseline instead.
   */
  dayStart?: OwnerRoundBalance;
  /**
   * Closing wallet balances for this seat (its committed `PlayerRecord` after
   * the shared closing) (MS-0MVRNW26W0070CP0). Satisfies the reconciliation
   * identity `dayStart + net == closing` per seat. Optional and absent-safe;
   * consumers fall back to the committed wallet in `state.players`.
   */
  closing?: OwnerRoundBalance;
  /**
   * Net coin change for this seat for the day (income + ongoing costs +
   * incident routing + one-off deltas), measured against {@link dayStart}.
   */
  netCoinChange: number;
  /**
   * Net reputation change for this seat for the day, measured against
   * {@link dayStart}. Optional and absent-safe (consumers render zero).
   */
  netRepChange?: number;
  /**
   * Net score change for this seat for the day, measured against
   * {@link dayStart}. Optional and absent-safe (consumers render zero).
   */
  netScoreChange?: number;
  /**
   * The seat's share of the resolved incident's coin delta (negative = loss),
   * routed per owner by `applyCompetitiveEventEffects`. Optional and
   * absent-safe (consumers render zero).
   */
  incidentCoinChange?: number;
  /**
   * The seat's share of the resolved incident's reputation delta (negative =
   * loss). Optional and absent-safe (consumers render zero).
   */
  incidentRepChange?: number;
  /**
   * Non-recurring signed coin/reputation deltas for this seat: pre-closing
   * MarketPhase spending/earning plus any closing effect outside income,
   * ongoing costs and the incident — the same residual convention as
   * `TurnLedger.oneOffDeltas`, so the row reconciles exactly. Optional and
   * absent-safe (consumers render zero).
   */
  oneOffDeltas?: {
    coins: number;
    reputation: number;
  };
  /**
   * Optional per-source attribution of this seat's one-off row
   * (MS-0MWBZDNH3006DXV7): the same shape and contract as
   * `TurnLedger.oneOffBreakdown`, so the competitive panel renders the same
   * per-source list as the single-player panel. Absent-safe: an older or
   * hand-built ledger (or a seat whose captured sources do not reconcile to
   * {@link oneOffDeltas}) omits it and consumers fall back to the legacy
   * reconciliation formula.
   */
  oneOffBreakdown?: OneOffBreakdownEntry[];
}

/**
 * One seat's ongoing (recurring) expense breakdown for a shared closing
 * (MS-0MVRNVHJ50095N9Y, parent MS-0MVO1SFCM000ZLBI).
 *
 * Values are **signed** coin deltas — zero or negative — mirroring
 * `TurnLedger.ongoingCosts` for the single-player ledger, so both Turn Summary
 * panels format the same categories the same way. Each value is the amount
 * actually charged to that seat's own wallet (clamped when the wallet ran
 * short), matching the single-player attribution convention.
 */
export interface OwnerOngoingCosts {
  /** Staff salaries charged to this seat (zero or negative). */
  staff: number;
  /** Community-space running costs charged to this seat (zero or negative). */
  community: number;
  /** Business running costs charged to this seat (zero or negative). */
  business: number;
}

/**
 * Owner-keyed competitive round ledger surfaced by a competitive shared
 * closing (MS-0MVRNV9Y8008IKGK, parent MS-0MVO1SFCM000ZLBI).
 *
 * Optional and absent-safe: single-player closings (`TurnResult.turnLedger`),
 * N=1 and hand-built results carry no ledger, so every consumer must treat
 * absence as "nothing to present".
 */
export interface CompetitiveRoundLedger {
  /** The shared day the round closed (the day that just finished). */
  turn: number;
  /** One entry per non-eliminated seat the closing surfaced, in seat order. */
  seats: OwnerRoundLedger[];
}

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
  /**
   * Optional per-source attribution of the one-off row
   * (MS-0MWBZDNH3006DXV7): each entry names one source (market purchase,
   * market sale, event play, Community Favour, loan repayment / taken /
   * bailout) with its signed coin delta and any reputation it moved. The
   * entries sum to {@link oneOffDeltas}.coins within a documented rounding
   * tolerance (A2 — the last entry absorbs any drift). Present only when
   * the engine captured per-source deltas during the turn that reconcile to
   * the residual; absent for legacy / hand-built ledgers and for turns whose
   * sources cannot be fully attributed (consumers fall back to the
   * reconciliation formula — never invented attribution).
   */
  oneOffBreakdown?: OneOffBreakdownEntry[];
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
   * Loans retired by their final scheduled repayment during this closing
   * (loan payoff notification, MS-0MW3SMTRO006M86W). One seat-tagged entry per
   * retired loan, carrying the owner id, per-turn repayment, total repayment
   * and term — exactly the figures the HUD loan row showed before the debt
   * disappeared, so presentation congratulates on the engine's own decision
   * instead of diffing `state.loans` before and after the turn.
   *
   * Populated by `processEndOfTurn` (the shared/single-player closing,
   * including its choice-pending, bailout-paused and deferred-closing results)
   * and by `resolveCompetitiveClosingPhases` (the shared competitive closing);
   * absent when nothing retired. The deferred closing spreads the paused
   * result, so a resumed turn carries the same entries without re-running the
   * repayment pass — a payoff is never reported twice. The dual-choice resume
   * (`finishDeferredEndOfTurn`) likewise does not re-run the repayment pass: a
   * retirement reported on the paused result is not repeated there.
   *
   * Presentation-only and transient: never written to or read from a save, no
   * new state field, no state mutation and no RNG consumption. `loansEnabled:
   * false` and no-loan turns leave it absent, so their behaviour stays
   * byte-identical (parent AC 8).
   */
  loanPayoffs?: LoanPayoff[];
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
  /**
   * Competitive round ledger (MS-0MVRNV9Y8008IKGK): per-seat businesses owned,
   * per-phase income subtotals, ongoing expenses, the day's net coin /
   * reputation / score change, the day-start and closing balances and the
   * seat's share of the incident / one-off deltas
   * (MS-0MVRNW26W0070CP0) for the shared day just closed. Populated by
   * `resolveCompetitiveClosingPhases` for N >= 2
   * (threaded through `finishCompetitiveClosingTail`, including the deferred
   * dual-choice resume); absent for single-player, N=1, headless short-cuts and
   * hand-built results, so consumers must treat it as optional.
   *
   * Presentation-only data: it mirrors deltas already applied to each
   * `PlayerRecord`, so reading it consumes no RNG and mutates no state.
   */
  playerRoundLedger?: CompetitiveRoundLedger;
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

