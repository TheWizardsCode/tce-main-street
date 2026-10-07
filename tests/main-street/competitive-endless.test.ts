/**
 * Main Street: Competitive Endless Continuation Tests
 *
 * Verifies the producer's Q4 "option to carry on in endless mode" beyond
 * the win threshold (CG-0MT5X3GMA007EG30 → CG-0MTIILU5V006GCN4).
 *
 * Design (mirrors the last-standing continue-solo offer):
 *   - Reaching `config.winThreshold` with `config.endlessMode === true`
 *     declares the winner but pauses with the endless-continuation offer:
 *     `gameResult` is `'win'` (or `'loss'` for a competitive AI win) and
 *     `endReason` is `'score_threshold_continue'`.
 *   - Accepting the offer via `continueAfterThreshold` returns `gameResult`
 *     to `'playing'` and keeps the `score_threshold_continue` marker so
 *     later EndChecks do not re-open the offer.
 *
 * AC1 — Explicit opt-in flag and the win/score/endReason/gameResult
 *       semantics across both single-player and competitive paths.
 * AC2 — Deterministic replay: same seed + same actions produce the same
 *       endless-mode outcome.
 * AC3 — Default behaviour unchanged: without the flag the threshold win
 *       still ends the game as before.
 */
import { describe, it, expect } from 'vitest';

import {
  setupMainStreetGame,
  createCompetitiveState,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  checkEndConditions,
  checkCompetitiveEndConditions,
  computeScore,
  continueAfterThreshold,
  processEndOfTurn,
  resolvePendingEventChoice,
  updateCompetitiveScores,
} from '../../src/MainStreetEngine';

// ── Helpers ─────────────────────────────────────────────────

function createState(
  options: {
    seed?: string;
    endlessMode?: boolean;
    playerCount?: number;
  } = {},
): MainStreetState {
  if (options.playerCount !== undefined) {
    return createCompetitiveState({
      seed: options.seed ?? 'endless-seed',
      playerCount: options.playerCount,
      endlessMode: options.endlessMode,
    });
  }
  return setupMainStreetGame({
    seed: options.seed ?? 'endless-seed',
    endlessMode: options.endlessMode,
  });
}

function setScoreAbove(state: MainStreetState): void {
  // Push current score above the threshold deterministically by bumping
  // resourceBank; the engine scores coins+rep(+challenges) each EndCheck.
  state.resourceBank.coins = state.config.winThreshold + 10;
  state.resourceBank.reputation = Math.max(1, state.resourceBank.reputation);
}

/**
 * Sets each competitive seat's derived score to the requested value while
 * keeping reputation positive so the seat-failure end condition does not fire
 * (MS-0MUVBH589001L7NL).
 */
function setCompetitiveScores(state: MainStreetState, scores: number[]): void {
  const bonus = state.challengesCompleted.length * state.config.challengeBonusPoints;
  const rep = 1;
  scores.forEach((desired, i) => {
    const neededCoins = desired - rep - bonus;
    state.players![i].coins = neededCoins;
    state.players![i].reputation = rep;
  });
  updateCompetitiveScores(state);
}

/** A 2-seat competitive state with a small, easy-to-cross threshold. */
function competitiveState(
  seed: string,
  endlessMode: boolean,
  threshold = 10,
): MainStreetState {
  const s = createCompetitiveState({ seed, playerCount: 2, endlessMode });
  s.config = { ...s.config, winThreshold: threshold };
  return s;
}

function stateSummary(state: MainStreetState): string {
  return `${state.gameResult}/${state.endReason ?? 'null'}/${state.finalScore}`;
}

// ── AC1: Endless-mode flag and threshold continuation ──────

describe('AC1 — Endless-mode opt-in flag', () => {
  it('defaults to endlessMode: false (existing behaviour unchanged)', () => {
    const s = createState({ endlessMode: undefined });
    expect(s.config.endlessMode).toBe(false);
  });

  it('respects explicit endlessMode: true', () => {
    const s = createState({ endlessMode: true });
    expect(s.config.endlessMode).toBe(true);
  });

  it('respects explicit endlessMode: false', () => {
    const s = createState({ endlessMode: false });
    expect(s.config.endlessMode).toBe(false);
  });

  it('threshold win ends the game when endlessMode is off (default)', () => {
    const s = createState({ endlessMode: false });
    setScoreAbove(s);

    const ended = checkEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('win');
    expect(s.endReason).toBe('score_threshold');
  });

  it('threshold opens the endless-continuation offer when endlessMode is on', () => {
    const s = createState({ endlessMode: true });
    setScoreAbove(s);

    const ended = checkEndConditions(s);

    // Winner declared: the overlay shows the "Enter Endless Mode" action.
    expect(ended).toBe(true);
    expect(s.gameResult).toBe('win');
    expect(s.endReason).toBe('score_threshold_continue');
  });

  it('continueAfterThreshold accepts the offer and resumes play', () => {
    const s = createState({ endlessMode: true, seed: 'endless-accept' });
    setScoreAbove(s);
    checkEndConditions(s); // opens the offer
    const turnBefore = s.turn;

    const accepted = continueAfterThreshold(s);

    expect(accepted).toBe(true);
    expect(s.gameResult).toBe('playing');
    // The winner-declared marker is kept so EndCheck does not re-open the offer.
    expect(s.endReason).toBe('score_threshold_continue');
    expect(s.turn).toBe(turnBefore + 1);
    expect(s.phase).toBe('WeekStart');
  });

  it('after accepting, checkEndConditions keeps playing and never re-offers', () => {
    const s = createState({ endlessMode: true });
    setScoreAbove(s);
    checkEndConditions(s);
    continueAfterThreshold(s);

    const ended = checkEndConditions(s);

    expect(ended).toBe(false);
    expect(s.gameResult).toBe('playing');
    expect(s.endReason).toBe('score_threshold_continue');
  });

  it('finalScore continues to accrue beyond the threshold after acceptance', () => {
    const s = createState({ endlessMode: true, seed: 'endless-accrue' });
    s.turn = 5;

    // First crossing + acceptance
    setScoreAbove(s);
    checkEndConditions(s);
    continueAfterThreshold(s);
    const scoreAtCrossing = s.finalScore;

    // Grow further
    s.resourceBank.coins += 25;
    checkEndConditions(s);

    expect(s.finalScore).toBeGreaterThan(scoreAtCrossing);
    expect(s.gameResult).toBe('playing');
    expect(s.endReason).toBe('score_threshold_continue');
  });

  it('continueAfterThreshold is a no-op when no endless offer is open', () => {
    const s = createState({ endlessMode: true });
    expect(continueAfterThreshold(s)).toBe(false);
    expect(s.gameResult).toBe('playing');
  });

  it('continueAfterThreshold is idempotent (never double-advances)', () => {
    const s = createState({ endlessMode: true });
    setScoreAbove(s);
    checkEndConditions(s);

    expect(continueAfterThreshold(s)).toBe(true);
    const afterFirst = s.turn;
    expect(continueAfterThreshold(s)).toBe(false);
    expect(s.turn).toBe(afterFirst);
  });

  it('a loss condition still ends the game even in endless mode', () => {
    // Bankruptcy is immediate-loss and must beat endless continuation
    const s = createState({ endlessMode: true });
    s.resourceBank.coins = -1;

    const ended = checkEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('loss');
    expect(s.endReason).toBe('bankruptcy');
  });

  it('bankruptcy after accepting the offer still ends the game', () => {
    const s = createState({ endlessMode: true });
    setScoreAbove(s);
    checkEndConditions(s);
    continueAfterThreshold(s);
    expect(s.gameResult).toBe('playing');

    s.resourceBank.coins = -1;
    s.resourceBank.reputation = 1000;

    const ended = checkEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('loss');
    expect(s.endReason).toBe('bankruptcy');
  });

  it('processEndOfTurn pauses at the threshold instead of advancing', () => {
    const s = createState({ endlessMode: true, seed: 'endless-turn' });
    s.resourceBank.coins = s.config.winThreshold + 50;
    s.resourceBank.reputation = 500;
    s.phase = 'MarketPhase';

    const result = processEndOfTurn(s);
    // Headless turn: if the drawn incident is a dual-choice event, resolve it
    // per the difficulty policy so the closing (EndCheck) still runs.
    if (s.pendingEventChoice && !s.pendingEventChoice.resolved) {
      resolvePendingEventChoice(s);
    }

    expect(result.gameResult).toBe('win');
    expect(s.gameResult).toBe('win');
    expect(s.endReason).toBe('score_threshold_continue');
    // The offer is open — the turn must not have advanced.
    expect(s.phase).toBe('EndCheck');

    // Accepting resumes the loop.
    expect(continueAfterThreshold(s)).toBe(true);
    expect(s.gameResult).toBe('playing');
    expect(s.phase).toBe('WeekStart');
  });

  it('computeScore keeps growing beyond the threshold in endless mode', () => {
    const s = createState({ endlessMode: true });
    // computeScore = coins + reputation + challenge bonus, so coins alone
    // at threshold-1 may already exceed threshold (rep>0). Zero rep and
    // force the before-score below threshold explicitly.
    s.resourceBank.coins = s.config.winThreshold - 1 - (s.resourceBank.reputation ?? 0);
    s.resourceBank.reputation = 0;
    const before = computeScore(s);
    expect(before).toBeLessThan(s.config.winThreshold);

    s.resourceBank.coins = s.config.winThreshold + 40;
    const after = computeScore(s);
    expect(after).toBeGreaterThan(s.config.winThreshold);
    expect(after).toBeGreaterThan(before);
  });
});

// ── AC1 (competitive): the actual N>=2 first-to-threshold path ──

describe('AC1 — Competitive first-to-threshold honours endlessMode', () => {
  it('defaults off so the competitive match still ends at the threshold', () => {
    const s = competitiveState('comp-default', false);
    setCompetitiveScores(s, [12, 5]);

    const ended = checkCompetitiveEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('win');
    expect(s.endReason).toBe('score_threshold');
    expect(s.competitiveWinnerId).toBe(0);
  });

  it('opens the continuation offer when the human wins the threshold', () => {
    const s = competitiveState('comp-human', true);
    setCompetitiveScores(s, [12, 5]);

    const ended = checkCompetitiveEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('win');
    expect(s.endReason).toBe('score_threshold_continue');
    expect(s.competitiveWinnerId).toBe(0);
  });

  it('opens the continuation offer as a loss when an AI seat wins the threshold', () => {
    const s = competitiveState('comp-ai', true);
    setCompetitiveScores(s, [5, 12]);

    const ended = checkCompetitiveEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('loss');
    expect(s.endReason).toBe('score_threshold_continue');
    expect(s.competitiveWinnerId).toBe(1);
  });

  it('continueAfterThreshold resumes competitive play and never re-offers', () => {
    const s = competitiveState('comp-continue', true);
    setCompetitiveScores(s, [12, 5]);
    checkCompetitiveEndConditions(s);

    expect(continueAfterThreshold(s)).toBe(true);
    expect(s.gameResult).toBe('playing');
    expect(s.endReason).toBe('score_threshold_continue');

    // Subsequent EndChecks keep playing without re-opening the offer even
    // though the threshold is still crossed.
    const ended = checkCompetitiveEndConditions(s);
    expect(ended).toBe(false);
    expect(s.gameResult).toBe('playing');
  });

  it('the competitive default path is unchanged when the flag is off', () => {
    const s = competitiveState('comp-off', false);
    setCompetitiveScores(s, [5, 12]);

    const ended = checkCompetitiveEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('loss');
    expect(s.endReason).toBe('score_threshold');
    expect(s.competitiveWinnerId).toBe(1);
  });
});

// ── AC2: Deterministic replay ───────────────────────────────

describe('AC2 — Deterministic replay of the endless-mode outcome', () => {
  it('same seed and same actions produce the same single-player outcome', () => {
    const build = (seed: string): MainStreetState => {
      const s = createState({ seed, endlessMode: true });
      s.resourceBank.coins = s.config.winThreshold + 10;
      checkEndConditions(s);
      continueAfterThreshold(s);
      return s;
    };

    const a = build('det-endless');
    const b = build('det-endless');

    expect(stateSummary(a)).toBe(stateSummary(b));
    expect(a.gameResult).toBe('playing');
    expect(a.endReason).toBe('score_threshold_continue');
  });

  it('same seed and same actions produce the same competitive outcome', () => {
    const build = (seed: string): MainStreetState => {
      const s = competitiveState(seed, true);
      setCompetitiveScores(s, [12, 5]);
      checkCompetitiveEndConditions(s);
      continueAfterThreshold(s);
      return s;
    };

    const a = build('det-comp');
    const b = build('det-comp');

    expect(stateSummary(a)).toBe(stateSummary(b));
    expect(a.gameResult).toBe('playing');
    expect(a.competitiveWinnerId).toBe(0);
  });

  it('the threshold-crossing offer is reproducible across calls', () => {
    const s = createState({ seed: 'det-signal', endlessMode: true });
    s.resourceBank.coins = s.config.winThreshold + 5;

    checkEndConditions(s);
    const first = stateSummary(s);
    // A second EndCheck while the offer is open must not mutate the signal.
    checkEndConditions(s);
    const second = stateSummary(s);

    expect(first).toBe(second);
  });
});

// ── AC3: Default behaviour unchanged (threshold still wins) ─

describe('AC3 — Default path (no endless flag) still ends at the threshold', () => {
  it('a fresh state without the flag wins at the threshold', () => {
    const s = createState({ seed: 'default-path', endlessMode: undefined });
    setScoreAbove(s);

    const ended = checkEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('win');
    expect(s.endReason).toBe('score_threshold');
  });

  it('processEndOfTurn ends the game at the threshold on the default path', () => {
    const s = createState({ seed: 'default-turn', endlessMode: false });
    s.resourceBank.coins = s.config.winThreshold + 50;
    s.resourceBank.reputation = 500;
    s.phase = 'MarketPhase';

    const result = processEndOfTurn(s);

    expect(result.gameResult).toBe('win');
    expect(s.gameResult).toBe('win');
    expect(s.endReason).toBe('score_threshold');
  });

  it('all_challenges still wins regardless of endlessMode', () => {
    const s = createState({ endlessMode: true });
    // Complete all active challenges
    for (const ac of s.activeChallenges) ac.completed = true;
    if (s.activeChallenges.length === 0) return; // defensive — config usually selects >= 1

    const ended = checkEndConditions(s);

    expect(ended).toBe(true);
    expect(s.gameResult).toBe('win');
    expect(s.endReason).toBe('all_challenges');
  });
});
