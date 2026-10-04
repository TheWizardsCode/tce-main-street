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

  return players.map((player) => {
    const isHuman = (player.controller ?? (player.playerId === 0 ? 'human' : 'ai')) === 'human';
    return {
      playerId: player.playerId,
      label: isHuman ? 'You' : `AI ${player.playerId}`,
      coins: Math.round(player.coins),
      reputation: Math.round(player.reputation),
      score: Math.round(player.score),
      isHuman,
      isActive: player.playerId === activeId,
    };
  });
}

/** One-line scoreboard cell, e.g. `▶ You: 600c 300r 0pt`. */
export function formatCompetitiveScoreboardRow(row: CompetitiveScoreboardRow): string {
  return `${row.isActive ? '▶ ' : ''}${row.label}: ${row.coins}c ${row.reputation}r ${row.score}pt`;
}
