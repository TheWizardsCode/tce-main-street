/**
 * Main Street: Turn Summary Model (pure)
 *
 * Phaser-free model that turns the committed end-of-turn ledger
 * (`TurnResult.turnLedger`, MS-0MVP45KZV006TMUK) plus the committed
 * `MainStreetState` into the content the Turn Summary dialog renders
 * (parent MS-0MVL6HMDP004WI41, child MS-0MVP45WBA001GAVY):
 *
 * - {@link buildTurnSummary} — the turn's headline figures: businesses owned
 *   per owner, per-phase income subtotals, per-category ongoing expenses,
 *   incident and one-off deltas, the net coin/reputation/score change, and
 *   the closing coin/reputation/score balances.
 *
 * Read-only contract: nothing here mutates `state`, consumes RNG, or imports
 * Phaser, so the model is unit-testable in a plain Node environment. The
 * ledger itself is presentation-only data already committed by the engine, so
 * building the summary never changes the turn.
 *
 * Competitive parity (MS-0MVRNVHJ50095N9Y):
 * {@link buildCompetitiveTurnSummary} reuses the same income/expense labels,
 * order and signed formatting as the single-player builder, so a competitive
 * seat row reads exactly like the single-player panel's rows.
 *
 * Per-seat standing (MS-0MVRNW26W0070CP0): each competitive row also carries
 * the day's net coin/reputation/score change, the closing coin / reputation /
 * score balances and the seat's share of the resolved incident and one-off
 * deltas — the same figures, order and signed formatting the single-player
 * panel shows. Every addition degrades to zero (or the committed wallet) when
 * the ledger omits it, so older/hand-built ledgers keep the previous row
 * shape instead of throwing.
 *
 * Owner-keyed by design: `TurnLedger.businessesOwned` is keyed by owner id, so
 * every {@link TurnSummaryOwnerRow} keeps its `ownerId` (the ledger key) and
 * per-seat wallet. The dialog currently renders the single human seat
 * ({@link TurnSummary.humanOwner}); the remaining rows are already present for
 * a future per-player panel.
 *
 * Closing balances are derived as `day-start snapshot + ledger net change`,
 * matching the ledger's own reconciliation identity. On the deferred path the
 * engine refreshes the net rows against the final state
 * (`refreshDeferredTurnLedger`), so the derived closing balances are the
 * post-turn balances while staying integer-consistent with the displayed net
 * and row subtotals.
 *
 * Profit/loss statement (parent MS-0MW4XULA90002OEY, producer answers Q1=A,
 * Q2=A, Q3=A): {@link buildPLProjection} re-projects one player's committed
 * ledger figures as an ordered coins-only profit/loss statement — Income
 * (base / synergy / reputation / events) with a total, Less: Operating
 * expenses (staff / community / business) with a total, the Incident and
 * One-off adjustments and an emphasised Net profit/loss bottom line — with the
 * non-monetary figures (reputation/score change, closing coins, businesses
 * owned) kept as supplementary context. {@link buildPLTabs} provides the
 * per-player tab model (id / label / colour / is-human, human default). Both
 * reuse the builders above, so single-player (`TurnLedger`) and competitive
 * (`CompetitiveRoundLedger`) closings share one statement shape. The tabbed
 * dialog holds the built summary rather than the raw result, so
 * {@link buildPLTabsFromTurnSummary} / {@link buildPLTabsFromCompetitiveSummary}
 * and {@link buildPLFromTurnSummary} / {@link buildPLFromCompetitiveRow} project
 * the same statement and tabs from it — one source of truth for both entry
 * points.
 *
 * @module src/scenes/MainStreetTurnSummary
 */

import type { MainStreetState } from '../MainStreetState';
import type { LogEntryActionType } from '../MainStreetStateTypes';
import type { OwnerOngoingCosts, OwnerRoundLedger, TurnLedger, TurnResult } from '../MainStreetEngineTypes';
import type { BusinessCard } from '../MainStreetCardsTypes';
import { getSeatDisplayLabel } from '../MainStreetAdjacencyOwner';
import { computeStaffSalaryCost, getEmployedSpecializationSkills, getSalaryScopeSkills, computeStreetOngoingCostReductionPct } from '../MainStreetStaffBuffs';
import { roundInt } from '../MainStreetDifficulty';
import { buildCompetitiveScoreboard } from './MainStreetCompetitiveScoreboard';
import {
  buildTurnSummaryLoanDescriptor,
  type TurnSummaryLoanDescriptor,
} from './MainStreetLoanSelectorModel';

// ── Row shapes ────────────────────────────────────────────────

/** The four income-phase subtotals reported by the ledger. */
export type TurnSummaryIncomePhase = keyof TurnLedger['incomeByPhase'];

/** The three ongoing-expense categories reported by the ledger. */
export type TurnSummaryExpenseCategory = keyof TurnLedger['ongoingCosts'];

/** One income-phase row (`base` / `synergy` / `reputation` / `events`). */
export interface TurnSummaryIncomeRow {
  phase: TurnSummaryIncomePhase;
  /** Display label for the phase. */
  label: string;
  /** Coins credited in this phase (may be negative for event effects). */
  coins: number;
  /** Optional per-business breakdown for the tooltip (absent-safe). */
  breakdown?: PLLineBreakdown;
}

/** One ongoing-expense row (`staff` / `community` / `business`). */
export interface TurnSummaryExpenseRow {
  category: TurnSummaryExpenseCategory;
  /** Display label for the category. */
  label: string;
  /** Signed coin delta for the category (zero or negative). */
  coins: number;
  /** Optional per-card breakdown for the tooltip (absent-safe). */
  breakdown?: PLLineBreakdown;
}

/**
 * One owner's turn-summary row.
 *
 * Owner-keyed: `ownerId` is the `TurnLedger.businessesOwned` key
 * (`String(playerId)`), so per-player rows can be added without reshaping the
 * data. In single-player the sole row is the human seat and its wallet is the
 * closing balance; in competitive shape each row reads its own `PlayerRecord`.
 */
export interface TurnSummaryOwnerRow {
  /** Ledger owner key (`String(playerId)`); `'0'` in single-player. */
  ownerId: string;
  /** Numeric owner / seat index parsed from {@link ownerId}. */
  playerId: number;
  /** Display label: `You` for the human seat, `AI <n>` for AI seats. */
  label: string;
  /** True when this seat is controlled by the human. */
  isHuman: boolean;
  /** Businesses standing on the street at closing for this owner. */
  businessesOwned: number;
  /** Closing coins for this owner. */
  coins: number;
  /** Closing reputation for this owner. */
  reputation: number;
  /** Closing score for this owner. */
  score: number;
}

/** A signed coin/reputation delta pair (incident or one-off rows). */
export interface TurnSummaryDeltas {
  coins: number;
  reputation: number;
}

/** Closing balances for the human seat (the seat the panel renders). */
export interface TurnSummaryClosing {
  coins: number;
  reputation: number;
  score: number;
}

/**
 * Everything the Turn Summary dialog surfaces for the turn just closed.
 *
 * `net` mirrors the ledger; `closing` is `day-start snapshot + net`. Every
 * value shown by the dialog is available here, so the panel is testable
 * without a browser.
 */
export interface TurnSummary {
  /** Turn number the closing belongs to. */
  turn: number;
  /** Resolved incident name, or `null` when no incident was drawn. */
  incidentName: string | null;
  /** One row per owner, ordered by owner id; renders the human seat today. */
  owners: TurnSummaryOwnerRow[];
  /** The human seat's row (the one the dialog renders), or `null`. */
  humanOwner: TurnSummaryOwnerRow | null;
  /** Per-phase income subtotals, in `base` / `synergy` / `reputation` / `events` order. */
  income: TurnSummaryIncomeRow[];
  /** Sum of {@link income}. */
  incomeTotal: number;
  /** Per-category ongoing expenses, in `staff` / `community` / `business` order. */
  expenses: TurnSummaryExpenseRow[];
  /** Sum of {@link expenses}. */
  expensesTotal: number;
  /** Incident coin/reputation delta. */
  incident: TurnSummaryDeltas;
  /** Non-recurring (market, event-play, other) coin/reputation delta. */
  oneOff: TurnSummaryDeltas;
  /** Net coin/reputation/score change for the day. */
  net: { coins: number; reputation: number; score: number };
  /** Closing coin/reputation/score balances for the human seat. */
  closing: TurnSummaryClosing;
}

// ── Labels ────────────────────────────────────────────────────

/** Income-phase order and labels as the dialog presents them. */
const INCOME_LABELS: Record<TurnSummaryIncomePhase, string> = {
  base: 'Base income',
  synergy: 'Synergy income',
  reputation: 'Reputation income',
  events: 'Event income',
};

/** Ongoing-expense order and labels as the dialog presents them. */
const EXPENSE_LABELS: Record<TurnSummaryExpenseCategory, string> = {
  staff: 'Staff wages',
  community: 'Community spaces',
  business: 'Business costs',
};

/** Fixed phase order (never depend on `Object.keys` ordering). */
const INCOME_PHASES: readonly TurnSummaryIncomePhase[] = [
  'base',
  'synergy',
  'reputation',
  'events',
];

/** Fixed expense-category order. */
const EXPENSE_CATEGORIES: readonly TurnSummaryExpenseCategory[] = [
  'staff',
  'community',
  'business',
];

// ── Builder ───────────────────────────────────────────────────

/**
 * Builds the Turn Summary model for one closed turn, or `null` when the
 * result carries no ledger.
 *
 * `null` is the competitive / hand-built signal: `TurnResult.turnLedger` is
 * optional and competitive closings do not populate it (parent AC4 keeps the
 * single-player dialog out of competitive play — the competitive panel reads
 * `TurnResult.playerRoundLedger` through
 * {@link buildCompetitiveTurnSummary}), so the caller renders nothing.
 *
 * @param state     Committed game state after the closing deltas landed.
 * @param result    The closed turn's result (ledger plus resolved incident).
 * @param incomeResult Optional income breakdown for per-business tooltip data;
 *                     when absent the tooltip shows a generic explanation.
 */
export function buildTurnSummary(
  state: MainStreetState,
  result: Pick<TurnResult, 'turnLedger' | 'incident'> & { income?: TurnResult['income'] },
): TurnSummary | null {
  const ledger = result.turnLedger;
  if (!ledger) return null;

  const income = INCOME_PHASES.map((phase) => ({
    phase,
    label: INCOME_LABELS[phase],
    coins: ledger.incomeByPhase[phase],
    ...incomeLineBreakdown(phase, result.income),
  }));
  const expenses = EXPENSE_CATEGORIES.map((category) => ({
    category,
    label: EXPENSE_LABELS[category],
    coins: ledger.ongoingCosts[category],
    ...expenseLineBreakdown(state, category),
  }));

  const closing = closingBalances(state, ledger);
  const owners = buildOwnerRows(state, ledger, closing);
  const humanOwner =
    owners.find((owner) => owner.isHuman)
    ?? owners.find((owner) => owner.ownerId === '0')
    ?? owners[0]
    ?? null;

  return {
    turn: state.turn,
    incidentName: result.incident?.name ?? null,
    owners,
    humanOwner,
    income,
    incomeTotal: sum(income.map((row) => row.coins)),
    expenses,
    expensesTotal: sum(expenses.map((row) => row.coins)),
    incident: {
      coins: ledger.incidentCoinChange,
      reputation: ledger.incidentRepChange,
    },
    oneOff: { ...ledger.oneOffDeltas },
    net: {
      coins: ledger.netCoinChange,
      reputation: ledger.netRepChange,
      score: ledger.netScoreChange,
    },
    closing,
  };
}

// ── Internals ─────────────────────────────────────────────────

/** Sums a list of numbers (empty list → 0). */
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Derives the closing balances from the day-start snapshot plus the ledger's
 * net rows — the same identity the engine's ledger reconciles against.
 *
 * The `??` fallbacks only apply to hand-built legacy states whose snapshots
 * are unset (the engine's `buildTurnLedger` uses the same fallback, so `net`
 * is 0 there and the closing balance equals the live wallet).
 */
function closingBalances(state: MainStreetState, ledger: TurnLedger): TurnSummaryClosing {
  const startCoins = state.weekStartCoins
    ?? (state.resourceBank.coins - ledger.netCoinChange);
  const startRep = state.weekStartRep
    ?? (state.resourceBank.reputation - ledger.netRepChange);
  const startScore = state.weekStartScore
    ?? (state.finalScore - ledger.netScoreChange);
  return {
    coins: startCoins + ledger.netCoinChange,
    reputation: startRep + ledger.netRepChange,
    score: startScore + ledger.netScoreChange,
  };
}

/**
 * Builds one row per owner key in the ledger.
 *
 * Rows are ordered by numeric owner id (deterministic; never key insertion
 * order). Single-player states have no `players[]` roster, so the sole owner
 * row uses the human label `You` and the closing balances; competitive-shaped
 * states relabel rows from {@link buildCompetitiveScoreboard} and read each
 * seat's own `PlayerRecord` wallet.
 */
function buildOwnerRows(
  state: MainStreetState,
  ledger: TurnLedger,
  closing: TurnSummaryClosing,
): TurnSummaryOwnerRow[] {
  const roster = buildCompetitiveScoreboard(state);
  const seatsById = new Map(roster.map((seat) => [String(seat.playerId), seat]));
  const singlePlayer = (state.players?.length ?? 0) === 0;

  return Object.keys(ledger.businessesOwned)
    .sort((a, b) => Number(a) - Number(b))
    .map((ownerId) => {
      const seat = seatsById.get(ownerId);
      const isHuman = seat ? seat.isHuman : ownerId === '0';
      const label = seat?.label ?? (ownerId === '0' ? 'You' : `Player ${ownerId}`);
      const wallet = singlePlayer
        ? closing
        : {
          coins: seat?.coins ?? Math.round(state.resourceBank.coins),
          reputation: seat?.reputation ?? Math.round(state.resourceBank.reputation),
          score: seat?.score ?? Math.round(state.finalScore),
        };
      return {
        ownerId,
        playerId: Number(ownerId),
        label,
        isHuman,
        businessesOwned: ledger.businessesOwned[ownerId],
        ...wallet,
      };
    });
}

// ── Competitive (per-seat) builder ────────────────────────────

/** One seat's row in the competitive Turn Summary panel. */
export interface CompetitiveTurnSummaryRow {
  /** Owner / seat index (index into `state.players`). */
  ownerId: number;
  /** Display label: `You` for the human seat, `AI <n>` for AI seats. */
  label: string;
  /** True when this seat is controlled by the human. */
  isHuman: boolean;
  /**
   * The seat's colour-blind-safe hex colour (the competitive scoreboard's
   * `resolveSeatColour` value); `undefined` when the roster has no assignment.
   */
  colour?: string;
  /** Businesses standing on the street at closing for this seat. */
  businessesOwned: number;
  /** Per-phase income subtotals, in `base` / `synergy` / `reputation` / `events` order. */
  income: TurnSummaryIncomeRow[];
  /** Sum of {@link income} — coins the income phase credited to this seat. */
  incomeTotal: number;
  /**
   * Per-category ongoing expenses for this seat, in `staff` / `community` /
   * `business` order (MS-0MVRNVHJ50095N9Y). Same labels, order and signed
   * (zero-or-negative) convention as the single-player panel's rows; a seat
   * whose ledger carries no breakdown gets three zero rows rather than
   * dropping the section.
   */
  expenses: TurnSummaryExpenseRow[];
  /** Sum of {@link expenses} — ongoing coins this seat was charged. */
  expensesTotal: number;
  /** Net coin change for this seat across the shared closing. */
  netCoinChange: number;
  /**
   * Net reputation change for this seat for the day (0 when the ledger carries
   * no reputation row — absent-safe, MS-0MVRNW26W0070CP0).
   */
  netRepChange: number;
  /**
   * Net score change for this seat for the day (0 when absent — absent-safe,
   * MS-0MVRNW26W0070CP0).
   */
  netScoreChange: number;
  /**
   * Closing coin / reputation / score balances for this seat
   * (MS-0MVRNW26W0070CP0). Derived from the ledger's closing snapshot, else
   * `day-start + net`, else the committed `PlayerRecord` wallet, so an older
   * ledger still renders the seat's standing.
   */
  closing: TurnSummaryClosing;
  /** The seat's share of the resolved incident's coin/reputation delta. */
  incident: TurnSummaryDeltas;
  /** Non-recurring (market, event-play, other) coin/reputation delta. */
  oneOff: TurnSummaryDeltas;
}

/** Everything the competitive Turn Summary panel surfaces for the round closed. */
export interface CompetitiveTurnSummary {
  /** Shared day the round closed. */
  turn: number;
  /**
   * The human seat's `ownerId` (the row the panel's `[ Bank Loan ]` button is
   * keyed to), or `-1` when the roster has no human seat. Resolved from the
   * same roster {@link MainStreetLoanSelectorModel.buildTurnSummaryLoanDescriptor}
   * reads, so the descriptor and the take agree on the seat.
   */
  humanSeatId: number;
  /**
   * The human seat's mid-game loan affordance, built by
   * {@link MainStreetLoanSelectorModel.buildTurnSummaryLoanDescriptor} for
   * `humanSeatId` (MS-0MW4YUHOU00474HZ AC1): `enabled` exactly when the human
   * seat may borrow (loans enabled, no active loan on that seat, a non-empty
   * menu), with the reason-specific hint otherwise. A roster without a human
   * seat yields a disabled, hint-less descriptor (nothing to key the button
   * to).
   */
  loanDescriptor: TurnSummaryLoanDescriptor;
  /** One row per non-eliminated seat, in seat order. */
  rows: CompetitiveTurnSummaryRow[];
}

/**
 * Builds the per-category expense rows a seat's row renders
 * (MS-0MVRNVHJ50095N9Y).
 *
 * Reuses the single-player row builder's labels and fixed `staff` /
 * `community` / `business` order, so both panels read identically. An absent
 * breakdown (a hand-built or older ledger) is rendered as three zero rows: the
 * seat is still shown, with "nothing spent" rather than a missing section.
 *
 * @param costs The seat's ongoing-cost breakdown, if the ledger carries one.
 */
function buildExpenseRows(
  costs: OwnerOngoingCosts | undefined,
): TurnSummaryExpenseRow[] {
  return EXPENSE_CATEGORIES.map((category) => ({
    category,
    label: EXPENSE_LABELS[category],
    coins: costs?.[category] ?? 0,
  }));
}

/**
 * Derives one competitive row's closing balances
 * (MS-0MVRNW26W0070CP0).
 *
 * Preference order: the ledger's own closing snapshot (the committed wallet
 * after the closing), then the day-start snapshot plus the net rows (the
 * ledger's reconciliation identity), then the committed `PlayerRecord` wallet
 * from the roster. Hand-built or older ledgers carry none of the first two, so
 * the seat still shows its standing instead of zeros.
 */
function competitiveClosing(
  seat: OwnerRoundLedger,
  rosterSeat: { coins: number; reputation: number; score: number } | undefined,
  net: { coins: number; reputation: number; score: number },
): TurnSummaryClosing {
  if (seat.closing) return { ...seat.closing };
  if (seat.dayStart) {
    return {
      coins: seat.dayStart.coins + net.coins,
      reputation: seat.dayStart.reputation + net.reputation,
      score: seat.dayStart.score + net.score,
    };
  }
  return {
    coins: rosterSeat?.coins ?? 0,
    reputation: rosterSeat?.reputation ?? 0,
    score: rosterSeat?.score ?? 0,
  };
}

/**
 * Builds the competitive (per-seat) Turn Summary model, or `null` when the
 * result carries no competitive round ledger (MS-0MVRNV9Y8008IKGK).
 *
 * Reuses the single-player presentation conventions rather than forking them:
 * seat labels come from the same `buildCompetitiveScoreboard` rows (`You` /
 * `AI n`) and colours from the shared `resolveSeatColour` lookup, so a seat
 * reads the same colour here as on the HUD, the street and the game-over
 * summary.
 *
 * `null` is the absent-safe signal: single-player closings
 * (`TurnResult.turnLedger`), N=1 closings, headless results and hand-built
 * results carry no `playerRoundLedger`, so the caller presents nothing and the
 * day advances exactly as before.
 *
 * Eliminated seats never become rows (MS-0MVRNW5JT0046QI3): a seat the closing
 * knocked out — bankruptcy / reputation collapse resolved after the income
 * phase — is filtered here as well as at ledger emission, so the panel shows
 * exactly the seats still playing (no ghost rows) even for a hand-built or
 * legacy ledger that still carries one. `null` when nothing remains to show,
 * which the gate treats as "advance immediately".
 *
 * @param state  Committed state after the closing (read-only).
 * @param result The closed shared day's result (round ledger).
 */
export function buildCompetitiveTurnSummary(
  state: MainStreetState,
  result: Pick<TurnResult, 'playerRoundLedger'> & {
    /** Optional per-seat income detail for tooltip breakdowns (absent-safe). */
    playerIncome?: TurnResult['playerIncome'];
  },
): CompetitiveTurnSummary | null {
  const ledger = result.playerRoundLedger;
  if (!ledger || ledger.seats.length === 0) return null;

  const roster = state.players ?? [];
  const seats = ledger.seats.filter((seat) => roster[seat.ownerId]?.eliminated !== true);
  if (seats.length === 0) return null;

  const seatsById = new Map(
    buildCompetitiveScoreboard(state).map((seat) => [String(seat.playerId), seat]),
  );

  // Per-seat income detail for tooltip breakdowns (MS-0MW7QQ65P006N3KA):
  // `OwnerIncomeResult.income` carries the same per-business breakdown the
  // single-player `IncomeResult` does, so a seat's income tooltips can name its
  // own businesses. Absent for older/hand-built ledgers — the tooltip then
  // degrades to the category total with an explanatory note.
  const incomeByOwner = new Map<number, TurnResult['income']>();
  for (const entry of result.playerIncome ?? []) {
    incomeByOwner.set(entry.ownerId, entry.income);
  }

  // The human seat the panel's loan affordance keys to (MS-0MW4YUHOU00474HZ
  // AC1): resolved from the scoreboard's `isHuman` rows — the same
  // controller-derived source `findHumanSeatId` uses — and its mid-game loan
  // descriptor. A roster with no human seat cannot key the button, so the
  // descriptor is disabled with no hint (no reason is known).
  const humanSeatId =
    seats.find((seat) => seatsById.get(String(seat.ownerId))?.isHuman === true)?.ownerId
    ?? -1;
  const loanDescriptor =
    humanSeatId >= 0
      ? buildTurnSummaryLoanDescriptor(state, humanSeatId)
      : { enabled: false, reason: null, activeLoan: null, options: [], hint: null };

  return {
    turn: ledger.turn,
    humanSeatId,
    loanDescriptor,
    rows: seats.map((seat) => {
      const ownerId = seat.ownerId;
      const rosterSeat = seatsById.get(String(ownerId));
      const expenses = buildExpenseRows(seat.ongoingCosts);
      const net = {
        coins: seat.netCoinChange,
        reputation: seat.netRepChange ?? 0,
        score: seat.netScoreChange ?? 0,
      };
      return {
        ownerId,
        label: rosterSeat?.label ?? getSeatDisplayLabel(ownerId),
        isHuman: rosterSeat ? rosterSeat.isHuman : ownerId === 0,
        colour: rosterSeat?.colour,
        businessesOwned: seat.businessesOwned,
        income: INCOME_PHASES.map((phase) => ({
          phase,
          label: INCOME_LABELS[phase],
          coins: seat.incomeByPhase[phase],
          ...incomeLineBreakdown(phase, incomeByOwner.get(ownerId)),
        })),
        incomeTotal: seat.incomeTotal,
        expenses,
        expensesTotal: sum(expenses.map((row) => row.coins)),
        netCoinChange: net.coins,
        netRepChange: net.reputation,
        netScoreChange: net.score,
        closing: competitiveClosing(seat, rosterSeat, net),
        incident: {
          coins: seat.incidentCoinChange ?? 0,
          reputation: seat.incidentRepChange ?? 0,
        },
        oneOff: {
          coins: seat.oneOffDeltas?.coins ?? 0,
          reputation: seat.oneOffDeltas?.reputation ?? 0,
        },
      };
    }),
  };
}

// ── Profit/loss statement projection ──────────────────────────

/** The statement's two monetary sections. */
export type PLStatementSectionKey = 'income' | 'expenses';

/** One monetary line of the profit/loss statement. */
export interface PLStatementLine {
  /**
   * Stable line key: the ledger's own phase (`base` / `synergy` /
   * `reputation` / `events`) or expense category (`staff` / `community` /
   * `business`), so a renderer can key a line without parsing its label.
   */
  key: string;
  /** Display label (the same wording both Turn Summary panels use today). */
  label: string;
  /** Signed coin amount: credited for income, zero-or-negative for expenses. */
  coins: number;
  /**
   * Optional per-item breakdown for tooltip rendering (per-business income,
   * per-card costs). Absent-safe: legacy/hand-built ledgers render without a
   * breakdown tooltip (the overlay falls back to a generic explanation).
   *
   * Note `key` here is shared with the ledger's phase (`base`/`synergy`/`events`)
   * or category (`staff`/`community`/`business`), but the breakdown groups
   * per business for income phases and per card for expense categories.
   */
  breakdown?: PLLineBreakdown;
  /**
   * Optional tooltip content string. When absent the overlay builds row
   * content from the model via {@link module:scenes/MainStreetTurnSummaryTooltips}
   * (the reconciliation formula for one-off/net rows, generic explanations for
   * context rows).
   */
  tooltipContent?: string;
}

/**
 * One titled section of the statement, with its lines and total.
 *
 * The total is the ledger's own subtotal (never a re-sum of the lines), so the
 * statement reconciles to the committed figures it is projected from.
 */
export interface PLStatementSection {
  key: PLStatementSectionKey;
  /** Section heading (`Income` / `Less: Operating expenses`). */
  label: string;
  /** The section's monetary lines, in fixed display order. */
  lines: PLStatementLine[];
  /** Label of the section's total row. */
  totalLabel: string;
  /** Sum of the section's coins, from the committed ledger. */
  total: number;
}

/** A coin/reputation adjustment row (the incident or one-off delta). */
export interface PLAdjustmentLine {
  key: 'incident' | 'oneOff';
  label: string;
  coins: number;
  reputation: number;
  /** Optional tooltip content (incident name/effect; one-off reconciliation). */
  tooltipContent?: string;
}

/**
 * Non-monetary figures shown alongside — never inside — the monetary P&L
 * lines (producer Q2=A).
 */
export interface PLSupplementaryContext {
  /** The day's net reputation change. */
  reputationChange: number;
  /** The day's net score change. */
  scoreChange: number;
  /** Closing coin balance for the player the statement belongs to. */
  closingCoins: number;
  /** Businesses standing on the street at closing for that player. */
  businessesOwned: number;
  /**
   * Optional tooltip content for each context row, keyed by row. Absent-safe:
   * the overlay falls back to a generic explanation when a key is missing.
   */
  tooltips?: Partial<Record<
    'reputationChange' | 'scoreChange' | 'closingCoins' | 'businessesOwned',
    string
  >>;
}

/**
 * One player's management-company profit/loss statement for the closed turn.
 *
 * Reconciles exactly:
 * `income.total + expenses.total + incident.coins + oneOff.coins ==
 * net.coins` (the ledger's own identity).
 */
export interface PLProjection {
  /** Ledger owner key the statement belongs to (`String(playerId)`). */
  playerKey: string;
  /** Tab/seat display label: `You` for the human seat, `AI n` otherwise. */
  label: string;
  /** True when this statement belongs to the human seat. */
  isHuman: boolean;
  /** The seat's colour-blind-safe hex colour; `undefined` in single-player. */
  colour?: string;
  /** Income section (base / synergy / reputation / events) with its total. */
  income: PLStatementSection;
  /** Less: Operating expenses section (staff / community / business). */
  expenses: PLStatementSection;
  /** Incident coin/reputation adjustment. */
  incident: PLAdjustmentLine;
  /** Non-recurring (market, event-play, other) coin/reputation adjustment. */
  oneOff: PLAdjustmentLine;
  /** Emphasised bottom line: net profit/loss for the day. */
  net: { label: string; coins: number; reputation: number; score: number };
  /** Non-monetary figures, kept outside the monetary lines. */
  context: PLSupplementaryContext;
}

/** One player's tab in the unified tabbed Turn Summary dialog. */
export interface PLTab {
  /** Ledger owner key (`String(playerId)`; `'0'` in single-player). */
  id: string;
  /** Display label: `You` for the human seat, `AI n` otherwise. */
  label: string;
  /** Seat colour; `undefined` in single-player (there is nothing to compare). */
  colour?: string;
  /** True when the tab belongs to the human seat. */
  isHuman: boolean;
  /** True for exactly one tab: the human seat, else the first tab. */
  isDefault: boolean;
}

/** Fixed statement wording (UK English, matching the existing panel labels). */
const PL_LABELS = {
  income: 'Income',
  incomeTotal: 'Total income',
  expenses: 'Less: Operating expenses',
  expensesTotal: 'Total operating expenses',
  incident: 'Incident',
  oneOff: 'One-off',
  net: 'Net profit/loss',
} as const;

/**
 * A single item in a per-item breakdown (business name → coins, staff card →
 * cost, etc.). Used by tooltip content builders.
 */
export interface PLBreakdownItem {
  /** Display name of the item (business name, staff name, etc.). */
  name: string;
  /** Coin contribution of this item (positive for income, negative for cost). */
  coins: number;
}

/**
 * Optional per-item breakdown attached to a P&L line for tooltip rendering.
 *
 * When present the overlay attaches a tooltip that lists each item; when absent
 * the row shows a generic explanation (the reconciliation formula, etc.).
 */
export interface PLLineBreakdown {
  /** Ordered list of named items with their coin contribution. */
  items: PLBreakdownItem[];
  /**
   * Optional street-wide ongoing-cost reduction (Cost Cutter) applied to this
   * family, as a positive coin amount. Stored so the tooltip can attribute the
   * gap between the per-item base sum and the committed total to the reduction
   * rather than to a coins-limited shortfall. Absent when no reduction applies.
   */
  streetReduction?: number;
}

/** The result fields the P&L projection reads (both ledger shapes). */
type PLResultInput = Pick<TurnResult, 'turnLedger' | 'incident' | 'playerRoundLedger'> & {
  /**
   * Optional per-business income detail for tooltip breakdowns. Absent-safe: a
   * caller that omits it (hand-built results, legacy call sites) still gets a
   * statement, just without per-business breakdowns.
   */
  income?: TurnResult['income'];
  /** Optional per-seat income detail for competitive tooltip breakdowns. */
  playerIncome?: TurnResult['playerIncome'];
};

/**
 * Builds the tab model of the unified Turn Summary dialog: one tab per player,
 * with the human seat marked as the default.
 *
 * Competitive closings (`TurnResult.playerRoundLedger`) win when present — the
 * ledger that carries the seats the panel shows, already filtered to the
 * non-eliminated seats. Otherwise the single-player `TurnLedger` yields its
 * owner rows, or a single `You` tab when the player owns no business yet (a
 * statement is still owed: staff wages, incidents and one-offs can all move the
 * day's result with an empty street). No ledger of either shape → no tabs.
 *
 * @param state  Committed game state after the closing (read-only).
 * @param result The closed turn's result.
 */
export function buildPLTabs(
  state: MainStreetState,
  result: PLResultInput,
): PLTab[] {
  const competitive = buildCompetitiveTurnSummary(state, result);
  if (competitive) return buildPLTabsFromCompetitiveSummary(competitive);
  const summary = buildTurnSummary(state, result);
  return summary ? buildPLTabsFromTurnSummary(summary) : [];
}

/**
 * Builds the tab model from an already-built single-player summary.
 *
 * The tabbed dialog receives the summary (not the raw result), so it needs the
 * same tab projection without re-deriving the summary — one owner row per tab,
 * or the single human `You` tab when the player owns no business yet.
 *
 * @param summary The single-player Turn Summary model.
 */
export function buildPLTabsFromTurnSummary(summary: TurnSummary): PLTab[] {
  const seats = summary.owners.length > 0
    ? summary.owners
    : [{ ownerId: '0', label: 'You', isHuman: true }];
  return markDefaultTab(seats.map((seat) => ({
    id: seat.ownerId,
    label: seat.label,
    colour: undefined,
    isHuman: seat.isHuman,
    isDefault: false,
  })));
}

/**
 * Builds the tab model from an already-built competitive summary: one tab per
 * non-eliminated seat, in seat order, with the seat's own label and colour.
 *
 * @param summary The competitive (per-seat) Turn Summary model.
 */
export function buildPLTabsFromCompetitiveSummary(
  summary: CompetitiveTurnSummary,
): PLTab[] {
  return markDefaultTab(summary.rows.map((row) => ({
    id: String(row.ownerId),
    label: row.label,
    colour: row.colour,
    isHuman: row.isHuman,
    isDefault: false,
  })));
}

/** Marks exactly one tab as the default: the human seat, else the first tab. */
function markDefaultTab(tabs: PLTab[]): PLTab[] {
  const defaultTab = tabs.find((tab) => tab.isHuman) ?? tabs[0];
  if (defaultTab) defaultTab.isDefault = true;
  return tabs;
}

/**
 * Builds the P&L statement for one player, or `null` when the result carries no
 * ledger of either shape or the named player has no statement.
 *
 * Re-projects the committed ledger only — no new accounting data, no state
 * mutation, no RNG — so the dialog is a presentation of the turn's own figures.
 *
 * @param state     Committed state after the closing (read-only).
 * @param result    The closed turn's result (either ledger shape).
 * @param playerKey Owner key (`'0'`, `1`, …) of the player to project;
 *                  omitted → the default (human) tab.
 */
export function buildPLProjection(
  state: MainStreetState,
  result: PLResultInput,
  playerKey?: string | number,
): PLProjection | null {
  const competitive = buildCompetitiveTurnSummary(state, result);
  if (competitive) {
    const key = selectPlayerKey(buildPLTabsFromCompetitiveSummary(competitive), playerKey);
    const row = competitive.rows.find((candidate) => String(candidate.ownerId) === key);
    return row ? buildPLFromCompetitiveRow(row) : null;
  }

  const summary = buildTurnSummary(state, result);
  return summary ? buildPLFromTurnSummary(summary, playerKey) : null;
}

/**
 * Projects one player's P&L statement from an already-built single-player
 * summary, or `null` when that player has no statement.
 *
 * The tabbed dialog holds the summary (not the raw result), so this is the same
 * projection {@link buildPLProjection} produces, without re-deriving the
 * summary. Every figure comes from the summary's own committed ledger rows, so
 * the statement still reconciles exactly.
 *
 * @param summary   The single-player Turn Summary model.
 * @param playerKey Owner key (`'0'` in single-player); omitted → the human tab.
 */
export function buildPLFromTurnSummary(
  summary: TurnSummary,
  playerKey?: string | number,
): PLProjection | null {
  const tabs = buildPLTabsFromTurnSummary(summary);
  const key = selectPlayerKey(tabs, playerKey);
  const tab = tabs.find((candidate) => candidate.id === key);
  if (!tab) return null;
  const owner = summary.owners.find((candidate) => candidate.ownerId === key);
  // A player with an empty street has no owner row but is still owed a
  // statement (the single-player human seat is always `'0'`).
  const emptyStreetHuman = summary.owners.length === 0 && key === '0';
  if (!owner && !emptyStreetHuman) return null;

  return {
    playerKey: key,
    label: tab.label,
    isHuman: tab.isHuman,
    colour: tab.colour,
    income: plSection(
      'income',
      PL_LABELS.income,
      PL_LABELS.incomeTotal,
      summary.income.map((line) => ({
        key: line.phase,
        label: line.label,
        coins: line.coins,
        ...(line.breakdown ? { breakdown: line.breakdown } : {}),
      })),
      summary.incomeTotal,
    ),
    expenses: plSection(
      'expenses',
      PL_LABELS.expenses,
      PL_LABELS.expensesTotal,
      summary.expenses.map((line) => ({
        key: line.category,
        label: line.label,
        coins: line.coins,
        ...(line.breakdown ? { breakdown: line.breakdown } : {}),
      })),
      summary.expensesTotal,
    ),
    incident: {
      key: 'incident',
      label: PL_LABELS.incident,
      coins: summary.incident.coins,
      reputation: summary.incident.reputation,
    },
    oneOff: {
      key: 'oneOff',
      label: PL_LABELS.oneOff,
      coins: summary.oneOff.coins,
      reputation: summary.oneOff.reputation,
    },
    net: { label: PL_LABELS.net, ...summary.net },
    context: {
      reputationChange: summary.net.reputation,
      scoreChange: summary.net.score,
      closingCoins: owner?.coins ?? summary.closing.coins,
      businessesOwned: owner?.businessesOwned ?? 0,
    },
  };
}

/**
 * Projects one seat's P&L statement from an already-built competitive row.
 *
 * The tabbed dialog holds the competitive summary (not the raw result), so this
 * is the same projection {@link buildPLProjection} produces for a seat, without
 * re-deriving the summary.
 *
 * @param row The seat's competitive Turn Summary row.
 */
export function buildPLFromCompetitiveRow(
  row: CompetitiveTurnSummaryRow,
): PLProjection {
  return {
    playerKey: String(row.ownerId),
    label: row.label,
    isHuman: row.isHuman,
    colour: row.colour,
    income: plSection(
      'income',
      PL_LABELS.income,
      PL_LABELS.incomeTotal,
      row.income.map((line) => ({
        key: line.phase,
        label: line.label,
        coins: line.coins,
        ...(line.breakdown ? { breakdown: line.breakdown } : {}),
      })),
      row.incomeTotal,
    ),
    expenses: plSection(
      'expenses',
      PL_LABELS.expenses,
      PL_LABELS.expensesTotal,
      row.expenses.map((line) => ({
        key: line.category,
        label: line.label,
        coins: line.coins,
        ...(line.breakdown ? { breakdown: line.breakdown } : {}),
      })),
      row.expensesTotal,
    ),
    incident: {
      key: 'incident',
      label: PL_LABELS.incident,
      coins: row.incident.coins,
      reputation: row.incident.reputation,
    },
    oneOff: {
      key: 'oneOff',
      label: PL_LABELS.oneOff,
      coins: row.oneOff.coins,
      reputation: row.oneOff.reputation,
    },
    net: {
      label: PL_LABELS.net,
      coins: row.netCoinChange,
      reputation: row.netRepChange,
      score: row.netScoreChange,
    },
    context: {
      reputationChange: row.netRepChange,
      scoreChange: row.netScoreChange,
      closingCoins: row.closing.coins,
      businessesOwned: row.businessesOwned,
    },
  };
}

/** Resolves the statement/tab key: the requested player, else the default tab. */
function selectPlayerKey(tabs: readonly PLTab[], playerKey?: string | number): string {
  if (playerKey !== undefined) return String(playerKey);
  return (tabs.find((tab) => tab.isDefault) ?? tabs[0])?.id ?? '';
}

/**
 * Builds the optional per-business breakdown for one income phase.
 *
 * The engine's `IncomeResult` carries per-slot income in `breakdown`
 * (`baseIncome` + `synergyBonus`) and per-slot phase data in
 * `phaseBreakdown.perSlotBreakdown` (`repBonus`, `eventDeltas`). We project the
 * phase-specific per-business contribution so the "Business income" tooltip can
 * name each business.
 *
 * Absent-safe: an absent `incomeResult` or empty breakdown → no breakdown (the
 * overlay falls back to a generic explanation tooltip).
 *
 * @param phase        The income phase to break down.
 * @param incomeResult The closed turn's `IncomeResult` (per-business detail).
 */
function incomeLineBreakdown(
  phase: TurnSummaryIncomePhase,
  income: TurnResult['income'] | null | undefined,
): { breakdown?: PLLineBreakdown } {
  if (!income) return {};

  if (phase === 'base' || phase === 'synergy') {
    const items = (income.breakdown ?? [])
      .map((slot) => ({
        name: slot.businessName,
        coins: phase === 'base' ? slot.baseIncome : slot.synergyBonus,
      }))
      .filter((item) => item.coins !== 0);
    return items.length > 0 ? { breakdown: { items } } : {};
  }

  // Reputation and event phases come from the per-slot phase breakdown.
  const phaseSlots = income.phaseBreakdown?.perSlotBreakdown ?? [];
  const items = phaseSlots
    .map((slot) => ({
      name: slot.businessName,
      coins:
        phase === 'reputation'
          ? slot.repBonus
          : (slot.eventDeltas ?? []).reduce((total, delta) => total + delta.delta, 0),
    }))
    .filter((item) => item.coins !== 0);
  return items.length > 0 ? { breakdown: { items } } : {};
}

/**
 * Builds the optional per-item breakdown for one ongoing-expense category.
 *
 * Derives per-card costs from the committed state the same way the engine's
 * `applyStaffOngoingCosts` / `applyCommunitySpaceOngoingCosts` /
 * `applyBusinessOngoingCosts` helpers compute them, so the tooltip's per-item
 * figures are the engine's own per-card charges — never invented by the UI.
 *
 * Items hold the **base** per-card charge (before the street-wide Cost Cutter
 * reduction and before any available-coins clamp). The tooltip builder
 * reconciles them to the committed category total with a reduction/clamp line
 * (see {@link module:scenes/MainStreetTurnSummaryTooltips}).
 *
 * Costs are stored as negative coin deltas, matching the expense row
 * convention. Absent-safe: a missing/empty source → no breakdown.
 *
 * @param state    Committed game state after the closing (read-only).
 * @param category The ongoing-expense category to break down.
 */
function expenseLineBreakdown(
  state: MainStreetState,
  category: TurnSummaryExpenseCategory,
): { breakdown?: PLLineBreakdown } {
  const soldSlots = state.soldSlots ?? [];

  if (category === 'staff') {
    const items = (state.staffCards ?? [])
      .map((card) => ({
        name: card.name,
        coins: -computeStaffSalaryCost(getSalaryScopeSkills(card), card.ongoingCost),
      }))
      .filter((item) => item.coins !== 0);
    return items.length > 0
      ? { breakdown: { items, ...streetReduction(state, items) } }
      : {};
  }

  if (category === 'community') {
    const items: PLBreakdownItem[] = [];
    const grid = state.streetGrid ?? [];
    for (let i = 0; i < grid.length; i++) {
      const slot = grid[i];
      if (!slot || slot.family !== 'community-space') continue;
      if (soldSlots[i]) continue;
      const cost = slot.ongoingCost ?? 0;
      if (cost > 0) items.push({ name: slot.name, coins: -cost });
    }
    return items.length > 0
      ? { breakdown: { items, ...streetReduction(state, items) } }
      : {};
  }

  // category === 'business'
  const items: PLBreakdownItem[] = [];
  const grid = state.streetGrid ?? [];
  for (let i = 0; i < grid.length; i++) {
    const slot = grid[i];
    if (!slot || slot.family !== 'business') continue;
    if (soldSlots[i]) continue;
    const cost = (slot as BusinessCard).ongoingCost ?? 0;
    if (cost > 0) items.push({ name: slot.name, coins: -cost });
  }
  return items.length > 0
    ? { breakdown: { items, ...streetReduction(state, items) } }
    : {};
}

/**
 * Computes the street-wide Cost Cutter reduction for a family's base per-item
 * sum, mirroring the engine (`roundInt(totalCost * (1 - reductionPct))`).
 *
 * Returns `{ streetReduction }` (a positive coin amount) only when the reduction
 * actually moves the family total; an unreduced family returns `{}` so the
 * breakdown stays absent-safe.
 */
function streetReduction(
  state: MainStreetState,
  items: readonly PLBreakdownItem[],
): { streetReduction?: number } {
  const reductionPct = computeStreetOngoingCostReductionPct(
    getEmployedSpecializationSkills(state),
  );
  if (reductionPct <= 0) return {};
  const absSum = items.reduce((total, item) => total - item.coins, 0);
  const afterReduction = roundInt(absSum * (1 - reductionPct));
  const amount = absSum - afterReduction;
  return amount > 0 ? { streetReduction: amount } : {};
}

/** Assembles one titled statement section. */
function plSection(
  key: PLStatementSectionKey,
  label: string,
  totalLabel: string,
  lines: PLStatementLine[],
  total: number,
): PLStatementSection {
  return { key, label, lines, totalLabel, total };
}

// ── Summary tab (headline view) ──────────────────────────────

/**
 * Stable id of the Summary tab.
 *
 * Distinct from the numeric seat keys (`'0'`, `'1'`, …) so the overlay can
 * recognise the headline tab without inspecting its label, and so the
 * selected-tab preservation after a loan take never confuses it with a seat.
 */
export const SUMMARY_TAB_ID = 'summary';

/** Display label of the Summary tab (`[ Summary ]`). */
export const SUMMARY_TAB_LABEL = 'Summary';

/** One seat's presentation (owner key / label / colour / human) on the Summary tab. */
export interface SummarySeat {
  /** Ledger owner key (`String(playerId)`; `'0'` in single-player). */
  ownerId: string;
  /** Display label: `You` for the human seat, `AI n` for AI seats. */
  label: string;
  /** True when this seat is controlled by the human. */
  isHuman: boolean;
  /** Seat colour-blind-safe hex colour; `undefined` in single-player. */
  colour?: string;
}

/**
 * One player- or AI-initiated action row in the Summary tab.
 *
 * Selected structurally from `state.activityLog` by the entry's `actionType`
 * marker — never by matching message text — so turn headers and the per-turn
 * monetary summary rows (which carry no marker) can never appear here.
 */
export interface SummaryActionRow extends SummarySeat {
  /** Structural action category (from `LogEntry.actionType`). */
  actionType: LogEntryActionType;
  /** The action's committed activity-log text. */
  text: string;
}

/** One seat's share of a resolved event's effect. */
export interface SummaryEventSeatEffect extends SummarySeat {
  /** Signed coin delta applied to this seat. */
  coins: number;
  /** Signed reputation delta applied to this seat. */
  reputation: number;
}

/**
 * One resolved event (the turn's incident) and the effect it applied.
 *
 * Played event cards surface through {@link SummaryActionRow} as
 * player-initiated actions rather than a second events list; this section is
 * the incident the closing resolved.
 */
export interface SummaryEventRow {
  /** Incident card name (or a generic `Incident` label when unnamed). */
  name: string;
  /** Total signed coin delta across the seats. */
  coins: number;
  /** Total signed reputation delta across the seats. */
  reputation: number;
  /** Per-seat effect of the event. */
  seats: SummaryEventSeatEffect[];
}

/** The metrics the Summary tab presents, one row each. */
export type SummaryMetricKey = 'income' | 'reputation' | 'score';

/** One seat's figure on a metric row. */
export interface SummaryMetricFigure extends SummarySeat {
  /** Signed change for the day (`+N` / `-N` / `0`). */
  change: number;
  /** Resulting closing balance. */
  balance: number;
  /**
   * The seat's P&L projection — the tooltip breakdown source, so the figure's
   * tooltip can never drift from that seat's per-player tab.
   */
  projection: PLProjection;
}

/** One metric row (Income / Reputation / Score) with every seat's figure. */
export interface SummaryMetricRow {
  key: SummaryMetricKey;
  label: string;
  figures: SummaryMetricFigure[];
}

/** The Summary tab's whole model (sections in confirmed order). */
export interface SummaryTabModel {
  /** Shared day / turn the closing belongs to. */
  turn: number;
  /** The Summary tab descriptor (first tab, selected by default). */
  tab: PLTab;
  /** Major actions (player- and AI-initiated), in activity-log order. */
  actions: SummaryActionRow[];
  /** The resolved incident(s) and the effect applied. */
  events: SummaryEventRow[];
  /** One row per metric, each carrying every seat's change and balance. */
  metrics: SummaryMetricRow[];
}

/** Fixed metric order and labels for the Summary tab. */
const SUMMARY_METRIC_ORDER: readonly SummaryMetricKey[] = ['income', 'reputation', 'score'];

const SUMMARY_METRIC_LABELS: Record<SummaryMetricKey, string> = {
  income: 'Income',
  reputation: 'Reputation',
  score: 'Score',
};

/**
 * Builds the Summary tab descriptor: the first tab, selected by default.
 *
 * `isHuman: false` because it belongs to no seat — selection is signalled by
 * the overlay's bold weight, not by seat colour.
 */
export function buildSummaryTab(): PLTab {
  return {
    id: SUMMARY_TAB_ID,
    label: SUMMARY_TAB_LABEL,
    colour: undefined,
    isHuman: false,
    isDefault: true,
  };
}

/** One seat's built projection plus its closing balances (internal). */
interface SummarySeatEntry {
  seat: SummarySeat;
  projection: PLProjection;
  closing: TurnSummaryClosing;
}

/**
 * Builds the Summary tab model for the closed turn, or `null` when the result
 * carries no ledger of either shape (nothing to summarise).
 *
 * Sections render in the confirmed order **Major actions → Events →
 * Income/Reputation/Score** (producer answer Q1 = A). Every figure is
 * projected from the same committed ledger the per-player tabs use, so the
 * Summary and per-player views can never drift:
 *
 *  - **Major actions** — selected structurally from `state.activityLog` for the
 *    closed turn by the entry's `actionType` marker (producer answer Q2), so
 *    turn headers and the per-turn monetary summary rows never appear;
 *  - **Events** — the resolved incident and the effect it applied, per seat;
 *  - **Income / Reputation / Score** — one row per metric, every seat's signed
 *    change and closing balance on that row (producer answer Q3 = A), each
 *    figure paired with its `PLProjection` for the tooltip breakdown.
 *
 * Absent-safe: a turn record with no marked actions or no incident yields empty
 * sections rather than throwing, and the caller advances the closing normally.
 *
 * @param state  Committed game state after the closing (read-only).
 * @param result The closed turn's result (either ledger shape).
 */
export function buildSummaryTabModel(
  state: MainStreetState,
  result: PLResultInput,
): SummaryTabModel | null {
  const competitive = buildCompetitiveTurnSummary(state, result);
  const single = competitive ? null : buildTurnSummary(state, result);
  return buildSummaryTabModelFromSummary(
    state,
    single,
    competitive,
    result.incident?.name ?? null,
  );
}

/**
 * Builds the Summary tab model from an already-built single-player or
 * competitive summary, or `null` when neither carries a statement.
 *
 * The tabbed dialog holds the built summary (not the raw result), so this is
 * the same projection {@link buildSummaryTabModel} produces without
 * re-deriving it. `state` is read only for the closed turn's activity log (the
 * actions section) — never mutated.
 *
 * @param state        Committed game state after the closing (read-only).
 * @param single       The built single-player summary, or `null`.
 * @param competitive  The built competitive summary, or `null`.
 * @param incidentName The resolved incident's name, when known.
 */
export function buildSummaryTabModelFromSummary(
  state: MainStreetState | null,
  single: TurnSummary | null,
  competitive: CompetitiveTurnSummary | null,
  incidentName: string | null,
): SummaryTabModel | null {
  if (!competitive && !single) return null;

  const entries: SummarySeatEntry[] = [];
  if (competitive) {
    for (const row of competitive.rows) {
      entries.push({
        seat: {
          ownerId: String(row.ownerId),
          label: row.label,
          isHuman: row.isHuman,
          colour: row.colour,
        },
        projection: buildPLFromCompetitiveRow(row),
        closing: { ...row.closing },
      });
    }
  } else if (single) {
    for (const tab of buildPLTabsFromTurnSummary(single)) {
      const projection = buildPLFromTurnSummary(single, tab.id);
      if (!projection) continue;
      const owner = single.owners.find((candidate) => candidate.ownerId === tab.id);
      entries.push({
        seat: {
          ownerId: tab.id,
          label: tab.label,
          isHuman: tab.isHuman,
          colour: tab.colour,
        },
        projection,
        closing: owner
          ? { coins: owner.coins, reputation: owner.reputation, score: owner.score }
          : { ...single.closing },
      });
    }
  }
  if (entries.length === 0) return null;

  const turn = competitive ? competitive.turn : single!.turn;
  const metrics: SummaryMetricRow[] = SUMMARY_METRIC_ORDER.map((key) => ({
    key,
    label: SUMMARY_METRIC_LABELS[key],
    figures: entries.map(({ seat, projection, closing }) => ({
      ...seat,
      change:
        key === 'income'
          ? projection.net.coins
          : key === 'reputation'
            ? projection.net.reputation
            : projection.net.score,
      balance:
        key === 'income'
          ? closing.coins
          : key === 'reputation'
            ? closing.reputation
            : closing.score,
      projection,
    })),
  }));

  return {
    turn,
    tab: buildSummaryTab(),
    actions: buildSummaryActions(state, turn, entries),
    events: buildSummaryEvents(incidentName, entries),
    metrics,
  };
}

/**
 * Selects the closed turn's player- and AI-initiated actions from the activity
 * log by their structural `actionType` marker (never by message text).
 *
 * Entries carrying no marker (turn headers, per-turn income/reputation summary
 * rows, incident draws, market refreshes, …) are skipped. An entry with no
 * `seatId` (single-player, where the log does not attribute) is credited to the
 * panel's human seat.
 */
function buildSummaryActions(
  state: MainStreetState | null,
  turn: number,
  entries: readonly SummarySeatEntry[],
): SummaryActionRow[] {
  const byOwner = new Map(entries.map(({ seat }) => [seat.ownerId, seat]));
  const human = entries.find(({ seat }) => seat.isHuman)?.seat ?? entries[0]?.seat;
  const rows: SummaryActionRow[] = [];

  for (const entry of state?.activityLog ?? []) {
    if (entry.turn !== turn) continue;
    if (!entry.actionType) continue;
    const seat =
      entry.seatId != null
        ? byOwner.get(String(entry.seatId))
        : human;
    if (!seat) continue;
    rows.push({ ...seat, actionType: entry.actionType, text: entry.text });
  }
  return rows;
}

/**
 * Builds the Events section: the resolved incident and its per-seat effect.
 *
 * The per-seat effect comes from each seat's `PLProjection.incident`, so the
 * Summary's event figures reconcile with that seat's per-player Incident row.
 * Returns an empty list when no incident was resolved and no seat carries an
 * incident delta (absent-safe).
 */
function buildSummaryEvents(
  incidentName: string | null,
  entries: readonly SummarySeatEntry[],
): SummaryEventRow[] {
  const incident = incidentName;
  const effects = entries.map(({ seat, projection }) => ({
    ...seat,
    coins: projection.incident.coins,
    reputation: projection.incident.reputation,
  }));
  const nonZero = effects.filter((effect) => effect.coins !== 0 || effect.reputation !== 0);

  // No incident name and no per-seat delta: nothing happened, render nothing.
  if (!incident && nonZero.length === 0) return [];

  const seats = incident ? effects : nonZero;
  return [{
    name: incident ?? 'Incident',
    coins: seats.reduce((total, effect) => total + effect.coins, 0),
    reputation: seats.reduce((total, effect) => total + effect.reputation, 0),
    seats,
  }];
}
