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
import type { TurnLedger, TurnResult } from '../MainStreetEngineTypes';
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
 * dialog out of competitive play), so the caller renders nothing.
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
