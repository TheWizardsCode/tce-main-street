/**
 * Main Street: Visible obligation — HUD readout and activity log
 * (Bank Loans epic MS-0MVL6DZI0000F6CG, child MS-0MVPWSCRD004A6Z4).
 *
 * AC coverage:
 *   AC1/AC2 — the activity log records the loan when it is taken (amount,
 *             per-turn repayment and term) and every repayment as an expense
 *             line, so the debt burden is never hidden.
 *   AC3     — the pure obligation label (`turns left` + per-turn amount) is
 *             what the single-player HUD strip and every competitive
 *             scoreboard row render.
 *   AC4     — the readout is hidden when no loan is active or loans are
 *             disabled (the helpers return `null`, so nothing is rendered).
 *
 * The Phaser-free helpers are asserted here; the actual HUD widgets (single
 * player strip + competitive scoreboard) are covered by
 * `tests/main-street/MainStreetLoanHud.browser.test.ts`.
 *
 * @module tests/main-street/loan-hud
 */

import { describe, it, expect } from 'vitest';

import { createCompetitiveState, setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import { executeWeekStart, takeLoan } from '../../src/MainStreetEngine';
import {
  applyLoanRepayments,
  buildActiveLoan,
  formatLoanObligation,
  formatLoanObligationCompact,
  hudLoanReadout,
} from '../../src/MainStreetLoans';
import {
  buildCompetitiveScoreboard,
  formatCompetitiveScoreboardRow,
} from '../../src/scenes/MainStreetCompetitiveScoreboard';

// ── Helpers ─────────────────────────────────────────────────

/** Fresh single-player game armed in MarketPhase (loans enabled). */
function marketPhaseState(seed = 'loan-hud-test'): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state, true);
  return state;
}

// ── Obligation formatting (AC3) ─────────────────────────────

describe('loan obligation labels', () => {
  it('formats turns left and per-turn amount for the HUD', () => {
    expect(formatLoanObligation({ perTurnRepayment: 110, turnsRemaining: 6 }))
      .toBe('Loan: 110 coins/turn, 6 turns left');
  });

  it('uses the singular "turn" for the final instalment', () => {
    expect(formatLoanObligation({ perTurnRepayment: 128, turnsRemaining: 1 }))
      .toBe('Loan: 128 coins/turn, 1 turn left');
  });

  it('formats a compact variant for the per-seat scoreboard rows', () => {
    expect(formatLoanObligationCompact({ perTurnRepayment: 110, turnsRemaining: 6 }))
      .toBe('Loan: 110/turn, 6 left');
  });
});

// ── Readout visibility (AC4) ────────────────────────────────

describe('hudLoanReadout visibility', () => {
  it('returns null when the seat holds no loan', () => {
    const state = marketPhaseState();
    expect(state.loans).toEqual([]);
    expect(hudLoanReadout(state)).toBeNull();
  });

  it('returns the obligation label for the active loan', () => {
    const state = marketPhaseState();
    takeLoan(state, 1); // 600 principal / 6 turns → 110 per turn

    expect(hudLoanReadout(state)).toBe('Loan: 110 coins/turn, 6 turns left');
  });

  it('returns null when loans are disabled, even with a stale loan record', () => {
    const state = marketPhaseState();
    state.loans = [buildActiveLoan(state, { principal: 600, termTurns: 6 })];

    state.config = { ...state.config, loansEnabled: false };
    expect(hudLoanReadout(state)).toBeNull();
  });

  it('resolves the obligation per seat in a competitive game', () => {
    const state = createCompetitiveState({ seed: 'loan-hud-competitive-readout', playerCount: 2 });
    state.loans = [buildActiveLoan(state, { principal: 600, termTurns: 6 }, 1)];

    expect(hudLoanReadout(state, 1)).toBe('Loan: 110 coins/turn, 6 turns left');
    expect(hudLoanReadout(state, 0)).toBeNull();
  });
});

// ── Competitive scoreboard rows (AC3/AC4) ───────────────────

describe('competitive scoreboard loan obligation', () => {
  it('marks only the seats that hold a loan', () => {
    const state = createCompetitiveState({ seed: 'loan-hud-competitive-rows', playerCount: 2 });
    state.loans = [buildActiveLoan(state, { principal: 600, termTurns: 6 }, 1)];

    const rows = buildCompetitiveScoreboard(state);
    const bySeat = new Map(rows.map((row) => [row.playerId, row]));

    expect(bySeat.get(1)?.loanObligation).toBe('Loan: 110/turn, 6 left');
    expect(bySeat.get(0)?.loanObligation).toBeUndefined();

    // The rendered row keeps the coin/reputation/score readout intact and
    // appends the obligation beside it.
    expect(formatCompetitiveScoreboardRow(bySeat.get(1)!))
      .toContain('Loan: 110/turn, 6 left');
    expect(formatCompetitiveScoreboardRow(bySeat.get(1)!))
      .toContain(`${bySeat.get(1)!.coins}c ${bySeat.get(1)!.reputation}r ${bySeat.get(1)!.score}pt`);
    expect(formatCompetitiveScoreboardRow(bySeat.get(0)!)).not.toContain('Loan:');
  });

  it('omits every loan marker when loans are disabled', () => {
    const state = createCompetitiveState({
      seed: 'loan-hud-competitive-disabled',
      playerCount: 2,
      loansEnabled: false,
    });
    state.loans = [buildActiveLoan(state, { principal: 600, termTurns: 6 }, 1)];

    const rows = buildCompetitiveScoreboard(state);
    expect(rows.every((row) => row.loanObligation === undefined)).toBe(true);
    expect(rows.every((row) => !formatCompetitiveScoreboardRow(row).includes('Loan:'))).toBe(true);
  });
});

// ── Activity log rows (AC1/AC2) ─────────────────────────────

describe('activity log loan rows', () => {
  it('records principal, per-turn repayment and term when the loan is taken', () => {
    const state = marketPhaseState();

    takeLoan(state, 1); // 600 over 6 turns at 110/turn

    const row = state.activityLog[state.activityLog.length - 1];
    expect(row.type).toBe('gain');
    expect(row.text).toContain('bank loan');
    expect(row.text).toContain('600');
    expect(row.text).toContain('110');
    expect(row.text).toContain('6 turns');
  });

  it('records each repayment as an expense line with the remaining term', () => {
    const state = marketPhaseState();
    takeLoan(state, 1);

    applyLoanRepayments(state);

    const first = state.activityLog[state.activityLog.length - 1];
    expect(first.type).toBe('loss');
    expect(first.text).toContain('Loan repayment');
    expect(first.text).toContain('-110 coins');
    expect(first.text).toContain('5 turns left');
  });

  it('announces the final instalment as repaid in full and stops logging', () => {
    const state = marketPhaseState();
    takeLoan(state, 1);

    for (let i = 0; i < 5; i++) applyLoanRepayments(state);
    const finalRow = state.activityLog[state.activityLog.length - 1];
    expect(finalRow.text).toContain('1 turn left');

    applyLoanRepayments(state); // sixth payment retires the loan
    const retirementRow = state.activityLog[state.activityLog.length - 1];
    expect(retirementRow.text).toContain('Loan repayment');
    expect(retirementRow.text).toContain('loan repaid in full');
    expect(state.loans).toEqual([]);

    const logLength = state.activityLog.length;
    applyLoanRepayments(state); // no loan left → nothing to log
    expect(state.activityLog).toHaveLength(logLength);
  });
});
