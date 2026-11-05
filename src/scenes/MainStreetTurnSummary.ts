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
 * @module src/scenes/MainStreetTurnSummary
 */

import type { MainStreetState } from '../MainStreetState';
import type { OwnerOngoingCosts, OwnerRoundLedger, TurnLedger, TurnResult } from '../MainStreetEngineTypes';
import { getSeatDisplayLabel } from '../MainStreetAdjacencyOwner';
import { buildCompetitiveScoreboard } from './MainStreetCompetitiveScoreboard';

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
}

/** One ongoing-expense row (`staff` / `community` / `business`). */
export interface TurnSummaryExpenseRow {
  category: TurnSummaryExpenseCategory;
  /** Display label for the category. */
  label: string;
  /** Signed coin delta for the category (zero or negative). */
  coins: number;
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
 * @param state  Committed game state after the closing deltas landed.
 * @param result The closed turn's result (ledger plus resolved incident).
 */
export function buildTurnSummary(
  state: MainStreetState,
  result: Pick<TurnResult, 'turnLedger' | 'incident'>,
): TurnSummary | null {
  const ledger = result.turnLedger;
  if (!ledger) return null;

  const income = INCOME_PHASES.map((phase) => ({
    phase,
    label: INCOME_LABELS[phase],
    coins: ledger.incomeByPhase[phase],
  }));
  const expenses = EXPENSE_CATEGORIES.map((category) => ({
    category,
    label: EXPENSE_LABELS[category],
    coins: ledger.ongoingCosts[category],
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

/**
 * The `[ Bank Loan ]` hint the competitive panel always shows
 * (MS-0MVRNV9Y8008IKGK).
 *
 * Loans are a per-seat affordance that does not exist in competitive play yet;
 * the button is therefore always disabled with this explanation, and the
 * `onBankLoanAction` seam is shaped `(seatId?: number) => void` so
 * MS-0MVL6DZI0000F6CG can enable it per seat without re-plumbing the panel.
 */
export const COMPETITIVE_BANK_LOAN_HINT =
  'Bank loans are not available in competitive play yet.';

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
 * @param state  Committed state after the closing (read-only).
 * @param result The closed shared day's result (round ledger).
 */
export function buildCompetitiveTurnSummary(
  state: MainStreetState,
  result: Pick<TurnResult, 'playerRoundLedger'>,
): CompetitiveTurnSummary | null {
  const ledger = result.playerRoundLedger;
  if (!ledger || ledger.seats.length === 0) return null;

  const seatsById = new Map(
    buildCompetitiveScoreboard(state).map((seat) => [String(seat.playerId), seat]),
  );

  return {
    turn: ledger.turn,
    rows: ledger.seats.map((seat) => {
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
