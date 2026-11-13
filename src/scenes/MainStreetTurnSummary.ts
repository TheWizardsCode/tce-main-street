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
 * Competitive per-card parity (MS-0MWEGDNP300007WC):
 * {@link expenseLineBreakdownForOwner} also feeds each competitive seat's
 * expense rows, so a seat's staff / community / business rows carry the same
 * per-card {@link PLLineBreakdown} the single-player builder spreads — both
 * panels' expense tooltips list the cards behind each category total, with
 * the same labels, order and committed coins.
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
 * Tooltip detail (MS-0MWBCACHZ006RTQ9): the projection also carries the data the
 * row tooltips need to show their arithmetic. A {@link PLBreakdownItem} keeps
 * the committed `coins` contribution and may add `base`, `modifiers` and
 * `effects` that only *explain* it (`base + sum(modifiers) === coins`, and
 * `sum(effects.delta) === coins`). {@link PLStatementLine.breakdown} groups
 * those items per business (income phases) or per card (expense categories), and
 * each section carries the lines its total row enumerates.
 * {@link PLAdjustmentLine.detail} holds the incident's base effect plus each
 * named modifier, and {@link PLSupplementaryContext} carries the derivable
 * context figures (`dayStartCoins`, `businessNames`, `reputationParts`). The
 * one-off adjustment line additionally carries
 * {@link PLAdjustmentLine.breakdown} — per-source attribution (market
 * purchase / sale, event play, Community Favour, loan effects) captured by
 * the engine during the turn (MS-0MWBZDNH3006DXV7), emitted only when the
 * entries reconcile to the committed residual `oneOffDeltas.coins` within a
 * documented rounding tolerance. Every
 * field is optional and absent-safe: a legacy or hand-built ledger keeps the
 * previous shape, and the tooltip degrades to the committed total plus an
 * explanatory note rather than inventing an attribution.
 *
 * @module src/scenes/MainStreetTurnSummary
 */

import type { MainStreetState } from '../MainStreetState';
import type { LogEntryActionType } from '../MainStreetStateTypes';
import type { OneOffBreakdownEntry, OwnerOngoingCosts, OwnerRoundLedger, TurnLedger, TurnResult } from '../MainStreetEngineTypes';
import { getSeatDisplayLabel, getSlotOwnerId } from '../MainStreetAdjacencyOwner';
import {
  computeBusinessOngoingCostReductionPct,
  computeIncidentSkillBuffs,
  computeReputationGainMultiplier,
  computeStaffSalaryCost,
  getEmployedSpecializationSkills,
  getSalaryScopeSkills,
  computeStreetOngoingCostReductionPct,
  getStreetScopeSkills,
} from '../MainStreetStaffBuffs';
import { getEmployedStaffForBusiness } from '../MainStreetEngineCommands';
import { getSkill, type SpecializationSkill } from '../MainStreetStaffSkills';
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
  /**
   * Optional derivation of the incident's committed deltas — the resolved
   * incident's own base effect plus each named staff modifier applied to it
   * (MS-0MWC90S6H009EDRD). Absent-safe: an unresolved/bare incident, or one
   * whose modifiers cannot be reconciled exactly to the committed deltas,
   * leaves this undefined.
   */
  incidentDetail?: PLIncidentDetail;
  /** Non-recurring (market, event-play, other) coin/reputation delta. */
  oneOff: TurnSummaryDeltas;
  /**
   * Optional per-source attribution of the one-off row
   * (MS-0MWBZDNH3006DXV7): labelled entries that sum to {@link oneOff}.
   * Absent-safe — a legacy/hand-built ledger (or one whose sources cannot be
   * fully attributed) omits it and the tooltip falls back to the
   * reconciliation formula.
   */
  oneOffBreakdown?: OneOffBreakdownEntry[];
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
    incidentDetail: buildIncidentDetail(
      getEmployedSpecializationSkills(state),
      result.incident,
      ledger.incidentCoinChange,
      ledger.incidentRepChange,
    ),
    oneOff: { ...ledger.oneOffDeltas },
    ...(ledger.oneOffBreakdown ? { oneOffBreakdown: ledger.oneOffBreakdown } : {}),
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
  /**
   * Optional derivation of this seat's committed incident deltas — the resolved
   * incident's own base effect plus each named staff modifier applied to it
   * (MS-0MWC90S6H009EDRD). Absent-safe: no resolved incident, no recoverable
   * per-seat skills, or a delta the modifiers cannot reconcile exactly leaves
   * this undefined.
   */
  incidentDetail?: PLIncidentDetail;
  /** Non-recurring (market, event-play, other) coin/reputation delta. */
  oneOff: TurnSummaryDeltas;
  /**
   * Optional per-source attribution of this seat's one-off row
   * (MS-0MWBZDNH3006DXV7): mirrors `TurnLedger.oneOffBreakdown` so the
   * competitive panel renders the same per-source list as single-player.
   * Absent-safe (legacy/hand-built ledgers render the formula).
   */
  oneOffBreakdown?: OneOffBreakdownEntry[];
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
 * Each row additionally carries the seat's per-card breakdown
 * (MS-0MWEGDNP300007WC), spread from
 * {@link expenseLineBreakdownForOwner} exactly as the single-player builder
 * does — the same owner-filtered derivation, so a competitive seat's expense
 * tooltips list the cards behind each category total. Absent-safe: a
 * legacy/hand-built ledger whose state yields no per-card detail simply leaves
 * `breakdown` undefined and the tooltip keeps the committed total plus its
 * explanatory note.
 *
 * @param costs    The seat's ongoing-cost breakdown, if the ledger carries one.
 * @param state    Committed game state (read-only), for per-card derivation.
 * @param ownerId  The seat to derive the per-card breakdown for.
 */
function buildExpenseRows(
  costs: OwnerOngoingCosts | undefined,
  state: MainStreetState,
  ownerId: number,
): TurnSummaryExpenseRow[] {
  return EXPENSE_CATEGORIES.map((category) => ({
    category,
    label: EXPENSE_LABELS[category],
    coins: costs?.[category] ?? 0,
    ...expenseLineBreakdownForOwner(state, ownerId, category),
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
    /** The resolved incident, so a seat's incident detail can name its modifiers. */
    incident?: TurnResult['incident'];
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
      const expenses = buildExpenseRows(seat.ongoingCosts, state, ownerId);
      const net = {
        coins: seat.netCoinChange,
        reputation: seat.netRepChange ?? 0,
        score: seat.netScoreChange ?? 0,
      };
      const incident = {
        coins: seat.incidentCoinChange ?? 0,
        reputation: seat.incidentRepChange ?? 0,
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
        incident,
        incidentDetail: buildIncidentDetail(
          getStreetScopeSkills(roster[ownerId]?.staffCards ?? []),
          result.incident,
          incident.coins,
          incident.reputation,
        ),
        oneOff: {
          coins: seat.oneOffDeltas?.coins ?? 0,
          reputation: seat.oneOffDeltas?.reputation ?? 0,
        },
        ...(seat.oneOffBreakdown ? { oneOffBreakdown: seat.oneOffBreakdown } : {}),
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

/**
 * One named signed modifier applied to the resolved incident's base effect
 * (MS-0MWC90S6H009EDRD).
 *
 * `coins` is a positive reduction of the incident's coin damage and
 * `reputation` a positive reduction/increase of its reputation delta, so
 * `base + every modifier` reconciles exactly to the committed incident line.
 */
export interface PLIncidentModifier {
  /** Display name of the modifier (a staff skill name). */
  name: string;
  /** Signed coin effect of the modifier on {@link PLIncidentDetail.base}. */
  coins: number;
  /** Signed reputation effect of the modifier on {@link PLIncidentDetail.base}. */
  reputation: number;
}

/**
 * Derivation of an incident's committed coin/reputation deltas
 * (MS-0MWC90S6H009EDRD).
 *
 * `base` is the resolved incident card's own effect and `modifiers` each named
 * staff mitigation/gain applied to it, so the identity
 * `base + sum(modifiers) === incident coins/reputation` holds exactly. The
 * model only emits it when that identity reconciles; otherwise the detail is
 * omitted (absent-safe).
 */
export interface PLIncidentDetail {
  /** The resolved incident's own unmodified coin/reputation effect. */
  base: { coins: number; reputation: number };
  /** Named modifiers applied to {@link base}, in application order. */
  modifiers: PLIncidentModifier[];
}

/** A coin/reputation adjustment row (the incident or one-off delta). */
export interface PLAdjustmentLine {
  key: 'incident' | 'oneOff';
  label: string;
  coins: number;
  reputation: number;
  /**
   * Optional per-source attribution of the one-off row
   * (MS-0MWBZDNH3006DXV7): labelled entries that sum to {@link coins} within
   * the documented rounding tolerance. Present only when the projection's
   * ledger carried it; the tooltip lists one line per source and keeps the
   * reconciliation formula as a checksum, falling back to the formula alone
   * when absent.
   */
  breakdown?: OneOffBreakdownEntry[];
  /**
   * Optional incident derivation for the tooltip (base effect + each named
   * modifier). Present only on the incident line, and only when it reconciles
   * exactly to {@link coins} / {@link reputation} (absent-safe).
   */
  detail?: PLIncidentDetail;
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
   * Day-start coin balance for the player the statement belongs to
   * (MS-0MWC90S6H009EDRD): `closingCoins - net.coins`, so the context tooltip
   * can show the arithmetic behind the closing balance. Absent-safe: omitted
   * where the projection carries no supporting per-item data (a hand-built or
   * legacy ledger keeps the previous context shape).
   */
  dayStartCoins?: number;
  /**
   * One display name per business the projection already breaks down, so the
   * context tooltip can name the businesses owned rather than restating the
   * count (MS-0MWC90S6H009EDRD). Absent-safe: omitted when the projection
   * carries no per-business income detail.
   */
  businessNames?: string[];
  /**
   * The reputation-change constituents that reconcile to
   * {@link reputationChange}: income reputation plus the committed incident and
   * one-off reputation deltas (MS-0MWC90S6H009EDRD). Absent-safe: omitted when
   * the projection carries no per-item income detail.
   */
  reputationParts?: { income: number; incident: number; oneOff: number };
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
 * One named signed modifier applied to a breakdown item's {@link
 * PLBreakdownItem.base} (e.g. the Operations Manager salary discount).
 *
 * `coins` is signed in the item's own convention: positive when the modifier
 * increases the item (an income bonus, a salary discount on a negative cost),
 * negative when it reduces it.
 */
export interface PLBreakdownModifier {
  /** Display name of the modifier (a staff skill name, etc.). */
  name: string;
  /** Signed coin effect of the modifier on {@link PLBreakdownItem.base}. */
  coins: number;
}

/**
 * One named event effect that produced part of a business's event-phase coins
 * (the committed `SlotEventDelta`), so the Events tooltip can name every
 * effect rather than only the per-business sum (MS-0MWC90RB7004BC4E).
 */
export interface PLBreakdownEffect {
  /** Human-readable effect name (`SlotEventDelta.name`). */
  name: string;
  /** Signed coin delta the effect contributed (negative = reduction). */
  delta: number;
}

/**
 * A single item in a per-item breakdown (business name → coins, staff card →
 * cost, etc.). Used by tooltip content builders.
 *
 * `coins` is always the **committed** contribution the item adds to the line
 * (the engine's own per-card charge, or the ledger's per-business figure).
 * `base`, `modifiers` and `effects` only *explain* that figure for the
 * tooltip: they are optional, and when `base` is present the invariant
 * `base + sum(modifiers.coins) === coins` holds for every emitted item, as
 * does `sum(effects.delta) === coins` when `effects` is present.
 */
export interface PLBreakdownItem {
  /** Display name of the item (business name, staff name, etc.). */
  name: string;
  /** Coin contribution of this item (positive for income, negative for cost). */
  coins: number;
  /**
   * Unmodified per-item amount, in the same sign convention as {@link coins}
   * (e.g. a staff member's base salary as a negative expense). Present only
   * where the committed state carries the unmodified figure; the model never
   * invents one.
   */
  base?: number;
  /**
   * Named signed modifiers applied to {@link base}, in application order.
   * Absent when the item carries no per-item modifier detail (community-space
   * and business costs); never synthesised.
   */
  modifiers?: PLBreakdownModifier[];
  /**
   * Named event effects that produced this item's {@link coins} (Events row
   * only). Absent when the committed `SlotPhaseBreakdown` carries no
   * `eventDeltas` for the business; never synthesised. The deltas sum to
   * {@link coins}, so the effects explain the item rather than adding to it.
   */
  effects?: PLBreakdownEffect[];
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

  const closingCoins = owner?.coins ?? summary.closing.coins;
  const businessNames = incomeBusinessNames(summary.income);

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
      ...(summary.incidentDetail ? { detail: summary.incidentDetail } : {}),
    },
    oneOff: {
      key: 'oneOff',
      label: PL_LABELS.oneOff,
      coins: summary.oneOff.coins,
      reputation: summary.oneOff.reputation,
      ...(summary.oneOffBreakdown ? { breakdown: summary.oneOffBreakdown } : {}),
    },
    net: { label: PL_LABELS.net, ...summary.net },
    context: {
      reputationChange: summary.net.reputation,
      scoreChange: summary.net.score,
      closingCoins,
      businessesOwned: owner?.businessesOwned ?? 0,
      ...contextDerivations(
        closingCoins,
        summary.net.coins,
        summary.net.reputation,
        summary.incident.reputation,
        summary.oneOff.reputation,
        businessNames,
      ),
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
  const businessNames = incomeBusinessNames(row.income);
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
      ...(row.incidentDetail ? { detail: row.incidentDetail } : {}),
    },
    oneOff: {
      key: 'oneOff',
      label: PL_LABELS.oneOff,
      coins: row.oneOff.coins,
      reputation: row.oneOff.reputation,
      ...(row.oneOffBreakdown ? { breakdown: row.oneOffBreakdown } : {}),
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
      ...contextDerivations(
        row.closing.coins,
        row.netCoinChange,
        row.netRepChange,
        row.incident.reputation,
        row.oneOff.reputation,
        businessNames,
        true,
      ),
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

  if (phase === 'events') {
    // Enumerate each committed `SlotEventDelta` as a named effect on its
    // business's item, so the tooltip names every effect and not only the
    // per-business sum (MS-0MWC90RB7004BC4E). A slot whose effects net to
    // zero is still kept: it carries effects worth explaining, and its zero
    // `coins` keeps `sum(items) === line coins` intact.
    const items = phaseSlots
      .map((slot) => {
        const effects = (slot.eventDeltas ?? []).map((delta) => ({
          name: delta.name,
          delta: delta.delta,
        }));
        const coins = effects.reduce((total, effect) => total + effect.delta, 0);
        return { name: slot.businessName, coins, effects };
      })
      .filter((item) => item.coins !== 0 || item.effects.length > 0);
    return items.length > 0 ? { breakdown: { items } } : {};
  }

  const items = phaseSlots
    .map((slot) => ({ name: slot.businessName, coins: slot.repBonus }))
    .filter((item) => item.coins !== 0);
  return items.length > 0 ? { breakdown: { items } } : {};
}

/** Skill id of the Operations Manager salary-discount modifier. */
const OPERATIONS_MANAGER_SKILL_ID = 'skill-operations-manager';

/**
 * Builds the optional per-item breakdown for one ongoing-expense category for
 * ONE owner (MS-0MWEGDNAD009QDRO).
 *
 * Derives per-card costs from the owner's own committed cards the same way the
 * engine's `applyCompetitiveOngoingCosts` / `applyStaffOngoingCosts` /
 * `applyCommunitySpaceOngoingCosts` / `applyBusinessOngoingCosts` helpers
 * compute them, so the tooltip's per-item figures are the engine's own
 * per-card charges — never invented by the UI.
 *
 * Sources mirror the engine per category: staff come from the owner's
 * `players[ownerId].staffCards` (a roster-less / hand-built state falls back
 * to the shared `state.staffCards`, so the single-player derivation is the
 * owner-0 derivation over the shared set); community spaces and businesses
 * come from the owner-filtered `state.streetGrid` via `getSlotOwnerId`,
 * with sold slots excluded (a sold business no longer runs on the street).
 *
 * Items hold the **base** per-card charge (before the street-wide Cost Cutter
 * reduction and before any available-coins clamp). The tooltip builder
 * reconciles them to the committed category total with a reduction/clamp line
 * (see {@link module:scenes/MainStreetTurnSummaryTooltips}).
 *
 * Staff items additionally explain their charge as `base ± modifiers`: `base`
 * is the card's `ongoingCost` (negative, expense convention) and each naming
 * `Operations Manager` discount becomes a signed modifier, using the same
 * {@link getSalaryScopeSkills} + `computeStaffSalaryDiscount` helpers the
 * engine charges with. Business items also carry a named modifier when a
 * Bookkeeper reduces the business's ongoing cost: `base` is the raw
 * `ongoingCost` and `coins` mirrors the engine's
 * `effectiveBusinessOngoingCost` (the Bookkeeper reduction applied per
 * business, rounded and floored at 0), so the discount is exposed as a signed
 * modifier rather than a phantom coins clamp. Community-space items carry
 * `base` only — their only modifier is street-wide (`streetReduction`), so
 * none is synthesised per item.
 *
 * The street-wide reduction mirrors `applyCompetitiveOngoingCosts`: staff
 * salaries reduce with the OWNER's street-wide skills
 * (`getStreetScopeSkills(players[ownerId].staffCards)` — never the host's),
 * while community/business reduce with the shared host staff set
 * (`getEmployedSpecializationSkills(state)`, the `hostReduction`), so a seat's
 * breakdown reconciles to the same skill set the engine charged it with.
 *
 * Costs are stored as negative coin deltas, matching the expense row
 * convention. Absent-safe: an unknown owner, a roster-less or hand-built state
 * with no cards, or an empty source → no breakdown (`{}`), never a throw.
 * Pure: mutates no state and consumes no RNG.
 *
 * @param state    Committed game state after the closing (read-only).
 * @param ownerId  The owner to derive the breakdown for (0 in single-player).
 * @param category The ongoing-expense category to break down.
 */
export function expenseLineBreakdownForOwner(
  state: MainStreetState,
  ownerId: number,
  category: TurnSummaryExpenseCategory,
): { breakdown?: PLLineBreakdown } {
  const roster = state.players ?? [];
  // Staff source: the owner's own staff when a roster exists; a roster-less /
  // hand-built state (single-player) falls back to the shared `state.staffCards`,
  // so `expenseLineBreakdown` delegation keeps single-player output unchanged.
  const staffCards = roster.length > 0
    ? roster[ownerId]?.staffCards ?? []
    : state.staffCards ?? [];

  if (category === 'staff') {
    const items: PLBreakdownItem[] = [];
    for (const card of staffCards) {
      const base = -card.ongoingCost;
      const coins = -computeStaffSalaryCost(getSalaryScopeSkills(card), card.ongoingCost);
      if (coins === 0) continue;
      // `coins` is the engine's own `computeStaffSalaryCost` charge (it applies
      // `computeStaffSalaryDiscount` internally), so the applied discount is
      // exactly `coins - base`: the invariant `base + sum(modifiers) === coins`
      // holds structurally, including the zero-salary clamp when the discount
      // would exceed the base salary.
      const discount = coins - base;
      const modifiers: PLBreakdownModifier[] = discount !== 0
        ? [{ name: getSkill(OPERATIONS_MANAGER_SKILL_ID).name, coins: discount }]
        : [];
      items.push({ name: card.name, coins, base, modifiers });
    }
    if (items.length === 0) return {};
    // Owner-scoped staff reduction: the same skill set `applyCompetitiveOngoingCosts`
    // charges each owner's staff with (the shared host roster never reduces a
    // seat's own staff).
    return {
      breakdown: {
        items,
        ...streetReduction(
          items,
          computeStreetOngoingCostReductionPct(getStreetScopeSkills(staffCards)),
        ),
      },
    };
  }

  return category === 'community'
    ? ownerFamilyBreakdown(state, ownerId, 'community-space')
    : ownerFamilyBreakdown(state, ownerId, 'business');
}

/**
 * Builds the optional per-item breakdown for one ongoing-expense category in
 * the single-player panel.
 *
 * Delegates to {@link expenseLineBreakdownForOwner} for owner 0 — the
 * single-player owner key — over the shared `state.staffCards` (roster-less
 * states) and the untagged grid (all slots belong to the active player), so
 * single-player output is unchanged by the owner-filtered generalisation.
 *
 * @param state    Committed game state after the closing (read-only).
 * @param category The ongoing-expense category to break down.
 */
function expenseLineBreakdown(
  state: MainStreetState,
  category: TurnSummaryExpenseCategory,
): { breakdown?: PLLineBreakdown } {
  return expenseLineBreakdownForOwner(state, 0, category);
}

/**
 * Builds one owner's community-space or business-cost breakdown items from the
 * owner-filtered street grid (MS-0MWEGDNAD009QDRO).
 *
 * Each owned, unsold slot of the family appears on its own line with its base
 * ongoing cost (`slot.ongoingCost`, expense convention). Business items
 * additionally mirror the engine's `effectiveBusinessOngoingCost`: a Bookkeeper
 * employed at the business reduces its ongoing cost before the street-wide Cost
 * Cutter reduction, exposed as a named modifier (`base + modifier === coins`)
 * rather than a phantom coins clamp (MS-0MWEQN2R2007GQG0). Community-space
 * items carry no per-item modifier — the family's only modifier is the
 * street-wide {@link streetReduction}, computed with the host skill set.
 * Absent-safe: no owned slot → `{}`.
 */
function ownerFamilyBreakdown(
  state: MainStreetState,
  ownerId: number,
  family: 'community-space' | 'business',
): { breakdown?: PLLineBreakdown } {
  const soldSlots = state.soldSlots ?? [];
  const items: PLBreakdownItem[] = [];
  const grid = state.streetGrid ?? [];
  for (let i = 0; i < grid.length; i++) {
    const slot = grid[i];
    if (!slot || slot.family !== family) continue;
    if (getSlotOwnerId(state, i) !== ownerId) continue;
    if (soldSlots[i]) continue;
    const cost = slot.ongoingCost ?? 0;
    if (cost > 0) {
      // Business items mirror the engine's `effectiveBusinessOngoingCost`: the
      // Bookkeeper's per-business reduction (GDD D.4.3) applies to this
      // business before the street-wide Cost Cutter reduction, rounded to the
      // nearest integer and floored at 0 (MS-0MWEQN2R2007GQG0). The discount
      // is exposed as a named modifier rather than a phantom coins clamp, so
      // `base + sum(modifiers) === coins` holds structurally. Community-space
      // items keep the raw `ongoingCost` (their only modifier is street-wide).
      const item: PLBreakdownItem = {
        name: slot.name,
        coins: -cost,
        base: -cost,
      };
      if (family === 'business') {
        const reductionPct = computeBusinessOngoingCostReductionPct(state, i);
        const effectiveCost = reductionPct > 0
          ? Math.max(0, roundInt(cost * (1 - reductionPct)))
          : cost;
        item.coins = -effectiveCost;
        const reduction = cost - effectiveCost;
        if (reduction > 0) {
          // Name the staff member(s) providing the reduction (the Bookkeeper),
          // so the tooltip explains the discount instead of a coins clamp.
          const reducers = getEmployedStaffForBusiness(state, i)
            .filter((member) => (member.ongoingCostReduction ?? 0) > 0)
            .map((member) => member.name);
          item.modifiers = [{ name: reducers.join(', '), coins: reduction }];
        }
      }
      items.push(item);
    }
  }
  if (items.length === 0) return {};
  // Host-scoped reduction (the engine's `hostReduction`): community/business
  // running costs reduce with the shared host staff set for every seat.
  return {
    breakdown: {
      items,
      ...streetReduction(
        items,
        computeStreetOngoingCostReductionPct(getEmployedSpecializationSkills(state)),
      ),
    },
  };
}

/**
 * Computes the street-wide Cost Cutter reduction for a family's base per-item
 * sum, mirroring the engine (`roundInt(totalCost * (1 - reductionPct))`).
 *
 * Returns `{ streetReduction }` (a positive coin amount) only when the reduction
 * actually moves the family total; an unreduced family returns `{}` so the
 * breakdown stays absent-safe.
 *
 * @param items        The family's per-card items (the base sum to reduce).
 * @param reductionPct The street-wide reduction percent to apply — the caller
 *                     derives it from the same skill set the engine charges
 *                     with (`getStreetScopeSkills(owner.staffCards)` for staff,
 *                     `getEmployedSpecializationSkills(state)` for community /
 *                     business), so the breakdown mirrors
 *                     `applyCompetitiveOngoingCosts` per category.
 */
function streetReduction(
  items: readonly PLBreakdownItem[],
  reductionPct: number,
): { streetReduction?: number } {
  if (reductionPct <= 0) return {};
  const absSum = items.reduce((total, item) => total - item.coins, 0);
  const afterReduction = roundInt(absSum * (1 - reductionPct));
  const amount = absSum - afterReduction;
  return amount > 0 ? { streetReduction: amount } : {};
}

/**
 * Collects the distinct business names the projection already breaks down, in
 * first-seen order (MS-0MWC90S6H009EDRD). Empty when the projection carries no
 * per-business income detail, so the caller can keep today's context shape.
 *
 * @param lines Income rows (single-player or competitive) carrying an optional
 *              per-business breakdown.
 */
function incomeBusinessNames(
  lines: readonly { breakdown?: PLLineBreakdown }[],
): string[] {
  const names: string[] = [];
  for (const line of lines) {
    for (const item of line.breakdown?.items ?? []) {
      if (!names.includes(item.name)) names.push(item.name);
    }
  }
  return names;
}

/**
 * Builds the supplementary-context derivations from already-committed figures
 * (MS-0MWC90S6H009EDRD).
 *
 * `dayStartCoins` is `closing - net` (the ledger's own reconciliation
 * identity). `businessNames` and `reputationParts` are only emitted when the
 * projection carries per-business income detail, keeping a hand-built/legacy
 * ledger on today's four-field context shape (absent-safe). The reputation
 * constituents derive the income part as the residual
 * `net - incident - oneOff`, so they always reconcile to
 * {@link PLSupplementaryContext.reputationChange}.
 *
 * @param closingCoins       The player's committed closing coin balance.
 * @param netCoins           The player's committed net coin change.
 * @param netReputation      The player's committed net reputation change.
 * @param incidentReputation The committed incident reputation delta.
 * @param oneOffReputation   The committed one-off reputation delta.
 * @param businessNames      Names the income breakdown already carries.
 * @param alwaysDayStart     Competitive rows always carry a committed closing
 *                           and net, so they emit `dayStartCoins` even without
 *                           income detail (the figure is still derivable).
 */
function contextDerivations(
  closingCoins: number,
  netCoins: number,
  netReputation: number,
  incidentReputation: number,
  oneOffReputation: number,
  businessNames: readonly string[],
  alwaysDayStart = false,
): Pick<PLSupplementaryContext, 'dayStartCoins' | 'businessNames' | 'reputationParts'> {
  const hasIncomeDetail = businessNames.length > 0;
  if (!hasIncomeDetail && !alwaysDayStart) return {};
  return {
    dayStartCoins: closingCoins - netCoins,
    ...(hasIncomeDetail
      ? {
        businessNames: [...businessNames],
        reputationParts: {
          income: netReputation - incidentReputation - oneOffReputation,
          incident: incidentReputation,
          oneOff: oneOffReputation,
        },
      }
      : {}),
  };
}

/** Skill id of the Quality Inspector incident coin-damage modifier. */
const QUALITY_INSPECTOR_SKILL_ID = 'skill-quality-inspector';

/** Skill id of the Compliance Officer incident reputation-damage modifier. */
const COMPLIANCE_SKILL_ID = 'skill-compliance';

/** Skill id of the Brand Ambassador reputation-gain multiplier. */
const BRAND_AMBASSADOR_SKILL_ID = 'skill-brand-ambassador';

/**
 * Derives the incident's committed deltas as a base effect plus each named
 * staff modifier applied to it (MS-0MWC90S6H009EDRD).
 *
 * Every figure comes from the resolved incident card and the engine's own
 * mitigation helpers ({@link computeIncidentSkillBuffs},
 * {@link computeReputationGainMultiplier}), so the detail explains — never
 * invents — the committed `incidentCoinChange` / `incidentRepChange`. The
 * identity `base + sum(modifiers) === committed` is verified for both axes; a
 * delta the named modifiers cannot reproduce exactly (per-business cluster
 * mitigation, proportional/theft effects, target scaling) yields `undefined`, so
 * the line stays absent-safe rather than showing misleading arithmetic.
 *
 * @param skills             The player's realisable management-company skills.
 * @param incident           The resolved incident card, if any.
 * @param committedCoins     The committed incident coin delta.
 * @param committedReputation The committed incident reputation delta.
 */
function buildIncidentDetail(
  skills: readonly SpecializationSkill[],
  incident: TurnResult['incident'] | null | undefined,
  committedCoins: number,
  committedReputation: number,
): PLIncidentDetail | undefined {
  if (!incident) return undefined;
  const baseCoins = incident.coinDelta;
  const baseReputation = incident.reputationDelta;
  if (typeof baseCoins !== 'number' || typeof baseReputation !== 'number') return undefined;

  const buffs = computeIncidentSkillBuffs(skills);
  const reputationMultiplier = computeReputationGainMultiplier(skills);
  const modifiers: PLIncidentModifier[] = [];

  // Quality Inspector: proportional reduction of negative coin damage.
  if (baseCoins < 0 && buffs.coinDamageReductionPct > 0) {
    const reduction = roundInt(Math.abs(baseCoins) * buffs.coinDamageReductionPct);
    if (reduction !== 0) {
      modifiers.push({
        name: getSkill(QUALITY_INSPECTOR_SKILL_ID).name,
        coins: reduction,
        reputation: 0,
      });
    }
  }

  // Compliance Officer: flat reduction of negative reputation damage
  // (engine semantics: `min(0, effect + flat)`, never below zero).
  if (baseReputation < 0 && buffs.reputationDamageReductionFlat > 0) {
    const reduction = Math.min(
      Math.abs(baseReputation),
      buffs.reputationDamageReductionFlat,
    );
    if (reduction !== 0) {
      modifiers.push({
        name: getSkill(COMPLIANCE_SKILL_ID).name,
        coins: 0,
        reputation: reduction,
      });
    }
  }

  // Brand Ambassador: multiplier on positive reputation gains.
  if (baseReputation > 0 && reputationMultiplier !== 1) {
    const boosted = roundInt(baseReputation * reputationMultiplier) - baseReputation;
    if (boosted !== 0) {
      modifiers.push({
        name: getSkill(BRAND_AMBASSADOR_SKILL_ID).name,
        coins: 0,
        reputation: boosted,
      });
    }
  }

  const detail: PLIncidentDetail = {
    base: { coins: baseCoins, reputation: baseReputation },
    modifiers,
  };
  const coinTotal = detail.base.coins
    + modifiers.reduce((total, modifier) => total + modifier.coins, 0);
  const reputationTotal = detail.base.reputation
    + modifiers.reduce((total, modifier) => total + modifier.reputation, 0);
  if (coinTotal !== committedCoins || reputationTotal !== committedReputation) {
    return undefined;
  }
  return detail;
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
