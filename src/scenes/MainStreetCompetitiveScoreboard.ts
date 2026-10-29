/**
 * Main Street: Competitive Scoreboard Model (pure)
 *
 * Phaser-free per-player scoreboard row builder for competitive mode
 * (child MS-0MUTU8J9T0034OT7 of epic MS-0MUTTVR5K002ZDUP). Kept separate from
 * the renderer so the per-seat mapping is unit-tested independently of Phaser.
 *
 * @module
 */

import type { MainStreetState } from '../MainStreetState';
import { resolveSeatColour } from '../MainStreetAdjacencyOwner';
import { activeLoanFor, formatLoanObligationCompact } from '../MainStreetLoans';

/**
 * Failure / elimination badge attached to a game-over scoreboard row.
 *
 * `kind` is machine-readable for tests; `label` is the short display text
 * rendered next to the row (e.g. `Bankrupt`, `Reputation collapse`,
 * `Eliminated`).
 */
export interface CompetitiveScoreboardBadge {
  kind: 'bankruptcy' | 'reputation_collapse' | 'eliminated';
  label: string;
}

/** One rendered scoreboard row (per competitive seat). */
export interface CompetitiveScoreboardRow {
  /** Owner index (index into `state.players`). */
  playerId: number;
  /** Display label: `You` for the human seat, `AI <n>` for AI seats. */
  label: string;
  coins: number;
  reputation: number;
  score: number;
  /** True when this seat is controlled by the human. */
  isHuman: boolean;
  /** True when this seat is the acting seat for the current shared day. */
  isActive: boolean;
  /**
   * The seat's persisted colour-blind-safe hex colour, resolved through the
   * shared {@link resolveSeatColour} lookup (F5 of MS-0MUWNTN8W006C7EF).
   *
   * This is the one colour every seat-identity surface uses — the activity-log
   * prefix (F3), the owner-coloured placed-card border (F4) and this
   * scoreboard/HUD — so a seat reads as the same colour throughout the UI.
   * `undefined` only for a single-seat roster, which has no colour assignment
   * (and produces no rendered rows in competitive play).
   */
  colour?: string;
  /**
   * Optional failure/elimination badge (game-over summary only). Absent while
   * a seat is solvent; the live competitive HUD never sets it.
   */
  badge?: CompetitiveScoreboardBadge;
  /**
   * True when this seat holds a still-unresolved piggyback decision (F5 of
   * MS-0MUYC47EL005Z69H) — the human seat is awaiting the join-fully /
   * keep-50% prompt. Surfaced as a `· decision` marker on the scoreboard row.
   */
  piggybackPending?: boolean;
  /**
   * Outstanding loan obligation for this seat (MS-0MVPWSCRD004A6Z4): the
   * remaining turns and per-turn repayment, e.g. `Loan: 110/turn, 6 left`.
   *
   * `undefined` when the seat holds no active loan or loans are disabled, so
   * the marker is hidden entirely rather than showing a zero obligation.
   */
  loanObligation?: string;
}

/**
 * Builds the per-seat scoreboard rows from the competitive state.
 *
 * Reads each `PlayerRecord` directly (never the bound shared wallet). Legacy
 * seats without a `controller` are treated as human for seat 0 and AI
 * otherwise, matching the save-load backfill.
 */
export function buildCompetitiveScoreboard(state: MainStreetState): CompetitiveScoreboardRow[] {
  const players = state.players ?? [];
  const activeId = state.activePlayerId ?? 0;
  // Seats with a still-unresolved piggyback decision (F5): the human seat is
  // awaiting the interactive join-fully / keep-50% prompt.
  const pendingPiggybackSeats = new Set(
    (state.pendingPiggyback?.decisions ?? [])
      .filter((d) => !d.resolved)
      .map((d) => d.seatId),
  );

  return players.map((player) => {
    const isHuman = (player.controller ?? (player.playerId === 0 ? 'human' : 'ai')) === 'human';
    // Active-loan obligation (MS-0MVPWSCRD004A6Z4): every seat holding a loan
    // shows what it still owes beside its coins/reputation readout. Hidden
    // entirely when loans are disabled (`loansEnabled: false`).
    const loan = state.config.loansEnabled ? activeLoanFor(state, player.playerId) : undefined;
    return {
      playerId: player.playerId,
      label: isHuman ? 'You' : `AI ${player.playerId}`,
      coins: Math.round(player.coins),
      reputation: Math.round(player.reputation),
      score: Math.round(player.score),
      isHuman,
      isActive: player.playerId === activeId,
      piggybackPending: pendingPiggybackSeats.has(player.playerId),
      loanObligation: loan ? formatLoanObligationCompact(loan) : undefined,
      // AC4/AC5: one shared colour source for every seat-identity surface.
      colour: resolveSeatColour(state, player.playerId),
    };
  });
}

/** One-line scoreboard cell, e.g. `▶ You: 600c 300r 0pt` (plus any loan/decision markers). */
export function formatCompetitiveScoreboardRow(row: CompetitiveScoreboardRow): string {
  const marker = row.piggybackPending ? ' · decision' : '';
  const loan = row.loanObligation ? ` · ${row.loanObligation}` : '';
  return `${row.isActive ? '▶ ' : ''}${row.label}: ${row.coins}c ${row.reputation}r ${row.score}pt${marker}${loan}`;
}

/**
 * Formats a row's failure/elimination badge, or `''` when the seat is healthy.
 *
 * The live competitive HUD's {@link formatCompetitiveScoreboardRow} output is
 * intentionally unchanged; the game-over summary renders the badge separately
 * so it can be drawn in a distinct colour beside the row.
 */
export function formatCompetitiveScoreboardBadge(row: CompetitiveScoreboardRow): string {
  return row.badge?.label ?? '';
}
