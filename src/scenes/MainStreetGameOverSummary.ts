/**
 * Main Street: Game-Over Summary Model (pure)
 *
 * Phaser-free model that turns committed game state into the content the
 * two-column Game Over overlay renders (epic MS-0MUWDL0V40041USM, child
 * MS-0MUWE6MSQ006DEZ4):
 *
 * - {@link formatEndReason} — a plain-language end-reason headline derived
 *   from `state.endReason`, naming the failing seat in competitive mode.
 * - {@link buildGameOverPlayerRows} — one row per player (single-player
 *   synthesises the sole `You` row from the shared wallet), reusing the
 *   competitive scoreboard model and adding failure/elimination badges.
 * - {@link buildGameOverChallengeSummary} — the run's completed / active
 *   challenges.
 *
 * Read-only contract: nothing here mutates `state`, and there is no Phaser
 * import, so the model is unit-testable in a plain Node environment.
 *
 * @module src/scenes/MainStreetGameOverSummary
 */

import type { EndReason, MainStreetState, PlayerRecord } from '../MainStreetState';
import {
  buildCompetitiveScoreboard,
  type CompetitiveScoreboardBadge,
  type CompetitiveScoreboardRow,
} from './MainStreetCompetitiveScoreboard';

// ── End-reason headline ───────────────────────────────────────

/**
 * Plain-language headlines for every non-null `EndReason`. The `Record` type
 * is the compile-time exhaustiveness guard — a new reason fails the build
 * until it is given a headline.
 */
const END_REASON_HEADLINES: Record<Exclude<EndReason, null>, string> = {
  score_threshold: 'Score threshold reached',
  score_threshold_continue: 'Score threshold reached — endless mode continues',
  all_challenges: 'All challenges completed',
  turn_limit_victory: 'Turn limit survived',
  bankruptcy: 'Bankruptcy',
  reputation_collapse: 'Reputation collapse',
  last_standing: 'Last standing',
  last_standing_continue: 'Last standing — continuing solo',
  turn_exhaustion: 'Turn limit exhausted',
};

/** True when the state carries a competitive `players[]` roster. */
function isCompetitive(state: MainStreetState): boolean {
  return (state.players?.length ?? 0) > 0;
}

/**
 * Formats the plain-language end-reason headline for the overlay.
 *
 * For per-seat failures (`bankruptcy`, `reputation_collapse`) in competitive
 * mode the headline names the player concerned (preferring the human seat),
 * e.g. `Bankruptcy — You` or `Reputation collapse — AI 1`. Single-player and
 * non-failure reasons return the bare headline.
 */
export function formatEndReason(state: MainStreetState): string {
  const reason = state.endReason;
  // `null` (still playing) and any legacy/unknown value fall back gracefully
  // rather than rendering `undefined`; unknown values keep the historic
  // underscore→space rendering.
  if (reason == null) return 'Game over';

  const headline = (END_REASON_HEADLINES as Record<string, string>)[reason]
    ?? String(reason).replace(/_/g, ' ');
  if (
    (reason === 'bankruptcy' || reason === 'reputation_collapse') &&
    isCompetitive(state)
  ) {
    const label = failingSeatLabel(state, reason);
    if (label) return `${headline} — ${label}`;
  }
  return headline;
}

/** Finds the display label of the seat that hit `kind`, preferring the human. */
function failingSeatLabel(
  state: MainStreetState,
  kind: CompetitiveScoreboardBadge['kind'],
): string | null {
  const matching = buildGameOverPlayerRows(state).filter((row) => row.badge?.kind === kind);
  const human = matching.find((row) => row.isHuman);
  return (human ?? matching[0])?.label ?? null;
}

// ── Per-player rows ───────────────────────────────────────────

/**
 * Builds one badge per failing / eliminated seat.
 *
 * Priority is cause-before-consequence: a seat that is both bankrupt and
 * eliminated is flagged `Bankrupt` (the cause), a reputation-collapsed seat is
 * flagged `Reputation collapse`, and a seat merely marked `eliminated` is
 * flagged `Eliminated`. Reputation collapse only applies after turn 1, matching
 * the engine's {@link checkCompetitiveSeatFailure} semantics (reputation
 * legitimately starts at 0 on turn 1).
 */
function badgeForWallet(
  coins: number,
  reputation: number,
  eliminated: boolean,
  turn: number,
): CompetitiveScoreboardBadge | undefined {
  if (coins < 0) return { kind: 'bankruptcy', label: 'Bankrupt' };
  if (turn > 1 && reputation <= 0) {
    return { kind: 'reputation_collapse', label: 'Reputation collapse' };
  }
  if (eliminated) return { kind: 'eliminated', label: 'Eliminated' };
  return undefined;
}

/** Badge for a competitive `PlayerRecord`. */
function badgeForPlayer(
  player: PlayerRecord,
  turn: number,
): CompetitiveScoreboardBadge | undefined {
  return badgeForWallet(player.coins, player.reputation, player.eliminated === true, turn);
}

/** Synthesises the sole `You` row for a single-player state. */
function singlePlayerRow(state: MainStreetState): CompetitiveScoreboardRow {
  const { coins, reputation } = state.resourceBank;
  return {
    playerId: 0,
    label: 'You',
    coins: Math.round(coins),
    reputation: Math.round(reputation),
    score: Math.round(state.finalScore),
    isHuman: true,
    isActive: false,
    badge: badgeForWallet(coins, reputation, false, state.turn),
  };
}

/**
 * Builds the left-column player rows for the Game Over overlay.
 *
 * Competitive states reuse {@link buildCompetitiveScoreboard} (reading each
 * `PlayerRecord` directly, never the shared scratch bank) and attach a
 * failure/elimination badge. Single-player states have no `players[]`, so the
 * one `You` row is synthesised from the shared wallet and `finalScore`.
 */
export function buildGameOverPlayerRows(state: MainStreetState): CompetitiveScoreboardRow[] {
  const players = state.players;
  if (players && players.length > 0) {
    return buildCompetitiveScoreboard(state).map((row) => {
      const player = players[row.playerId];
      return player ? { ...row, badge: badgeForPlayer(player, state.turn) } : row;
    });
  }
  return [singlePlayerRow(state)];
}

// ── Challenge summary ─────────────────────────────────────────

/** One active challenge with its completion state. */
export interface GameOverChallengeItem {
  title: string;
  completed: boolean;
}

/** The run's challenge completion summary. */
export interface GameOverChallengeSummary {
  /** Active challenges (title + completion) in engine order. */
  items: GameOverChallengeItem[];
  /** Number of active challenges completed. */
  completedCount: number;
  /** Total active challenges for the run. */
  totalCount: number;
  /** Ids of every challenge completed during the run. */
  completedChallengeIds: string[];
}

/**
 * Builds the run's challenge summary.
 *
 * Challenges are run-global in the engine (`state.activeChallenges` /
 * `state.challengesCompleted`), not per-seat, so this is shown once in the
 * Game State column rather than per player.
 */
export function buildGameOverChallengeSummary(state: MainStreetState): GameOverChallengeSummary {
  const items = (state.activeChallenges ?? []).map((active) => ({
    title: active.challenge.title,
    completed: active.completed,
  }));
  return {
    items,
    completedCount: items.filter((item) => item.completed).length,
    totalCount: items.length,
    completedChallengeIds: [...(state.challengesCompleted ?? [])],
  };
}
