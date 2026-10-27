/**
 * Main Street: Bank Loans — model and `takeLoan` command tests
 * (Bank Loans epic MS-0MVL6DZI0000F6CG, slice MS-0MVPWS6WB008WP79).
 *
 * AC coverage (this slice):
 *   AC1 — a seat with no active loan can take a loan by choosing one option
 *         from the configured loan menu; the principal is credited to that
 *         seat's wallet immediately and the active loan is recorded.
 *   AC2 — taking a loan costs no action point: `actionsRemaining` (and
 *         `bankedActions`) are unchanged, asserted directly.
 *   AC3 — a seat that already holds an active loan cannot take another one;
 *         the attempt is rejected with a clear, user-facing reason and no
 *         resource change.
 *
 * The model surface asserted here (option table, rounding maths, config
 * defaults, one-active-loan lookup) is the foundation the later repayment /
 * bailout / HUD slices consume; its covering tests travelled with this slice
 * after the loss of the loan-model slice's commit (see the work-item
 * comment on MS-0MVPWS5JB007YSHB).
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, createCompetitiveState } from '../../src/MainStreetState';
import type { MainStreetState } from '../../src/MainStreetState';
import { bindCompetitiveSeat, restoreCompetitiveSeat } from '../../src/MainStreetAiStrategy';
import {
  executeAction,
  executeWeekStart,
  takeLoan,
  activeLoanFor,
} from '../../src/MainStreetEngine';
import { takeLoanCommand } from '../../src/MainStreetCommands';
import {
  DEFAULT_LOAN_OPTIONS,
  applyLoanPayment,
  buildActiveLoan,
  canTakeLoan,
  loanPerTurnRepayment,
  loanTotalRepayment,
  optionsFor,
} from '../../src/MainStreetLoans';
import { EASY_PRESET, HARD_PRESET, MEDIUM_PRESET } from '../../src/MainStreetDifficulty';
import { serializeMainStreetState, deserializeMainStreetState } from '../../src/MainStreetState';
import { UndoRedoManager } from '@core-engine/UndoRedoManager';

// ── Helpers ─────────────────────────────────────────────────

/** Fresh single-player game armed in MarketPhase (loans enabled). */
function marketPhaseState(seed = 'loans-command-test'): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state, true);
  return state;
}

/** Compact projection of the wallet state a refused loan must not touch. */
function walletSnapshot(state: MainStreetState) {
  return {
    coins: state.resourceBank.coins,
    reputation: state.resourceBank.reputation,
    ledgerCoins: state.ledger.get('coins'),
    logLength: state.activityLog.length,
    loans: state.loans.length,
  };
}

// ── Loan model: option table and repayment maths ─────────────

describe('loan model', () => {
  it('ships the configured default menu of 300/3, 600/6 and 1000/10', () => {
    expect(DEFAULT_LOAN_OPTIONS).toEqual([
      { principal: 300, termTurns: 3 },
      { principal: 600, termTurns: 6 },
      { principal: 1000, termTurns: 10 },
    ]);
  });

  it('repays the seed worked example 600/6 as 110 per turn and 660 total', () => {
    const total = loanTotalRepayment(600, 0.1);
    expect(total).toBe(660);
    expect(loanPerTurnRepayment(total, 6)).toBe(110);
  });

  it('applies flat interest per option and rounds to integer money', () => {
    // Every default option costs the same per turn at the default rate, so the
    // menu is a pure duration-vs-size trade-off.
    for (const option of DEFAULT_LOAN_OPTIONS) {
      const total = loanTotalRepayment(option.principal, 0.1);
      expect(total).toBe(Math.round(option.principal * 1.1));
      expect(loanPerTurnRepayment(total, option.termTurns)).toBe(110);
    }
    // Rounding: 350 × 1.1 = 385 exactly, 385 / 3 = 128.33 → 128.
    expect(loanTotalRepayment(350, 0.1)).toBe(385);
    expect(loanPerTurnRepayment(385, 3)).toBe(128);
  });

  it('enables loans in every difficulty preset with the default menu at 10%', () => {
    for (const preset of [EASY_PRESET, MEDIUM_PRESET, HARD_PRESET]) {
      expect(preset.loansEnabled).toBe(true);
      expect(preset.loanInterestRate).toBeCloseTo(0.1, 10);
      expect(preset.loanOptions).toEqual(DEFAULT_LOAN_OPTIONS);
    }
  });

  it('honours the setup loansEnabled override so headless runs can opt out', () => {
    expect(setupMainStreetGame({ seed: 'loans-on' }).config.loansEnabled).toBe(true);
    expect(
      setupMainStreetGame({ seed: 'loans-off', loansEnabled: false }).config.loansEnabled,
    ).toBe(false);
  });

  it('starts a fresh game with no loans and no pending offer', () => {
    const state = setupMainStreetGame({ seed: 'loans-empty' });
    expect(state.loans).toEqual([]);
    expect(state.pendingLoanOffer).toBeNull();
    expect(activeLoanFor(state, 0)).toBeUndefined();
  });

  it('resolves the configured menu from the game config', () => {
    const state = marketPhaseState();
    expect(optionsFor(state)).toEqual(DEFAULT_LOAN_OPTIONS);
  });
});

// ── AC1: taking a loan ──────────────────────────────────────

describe('takeLoan — success path (AC1)', () => {
  it('credits the principal to the wallet and records the active loan', () => {
    const state = marketPhaseState();
    const coinsBefore = state.resourceBank.coins;
    const ledgerBefore = state.ledger.get('coins');

    const loan = takeLoan(state, 1); // 600 principal / 6 turns

    expect(state.resourceBank.coins).toBe(coinsBefore + 600);
    // Credited through the ledger path, not a bare wallet mutation.
    expect(state.ledger.get('coins')).toBe(ledgerBefore + 600);
    expect(state.loans).toHaveLength(1);
    expect(loan).toMatchObject({
      ownerId: 0,
      principal: 600,
      totalRepayment: 660,
      perTurnRepayment: 110,
      turnsRemaining: 6,
      termTurns: 6,
      takenOnTurn: state.turn,
    });
    expect(activeLoanFor(state, 0)).toEqual(loan);
  });

  it('writes an activity-log row describing the loan burden', () => {
    const state = marketPhaseState();
    const logBefore = state.activityLog.length;

    takeLoan(state, 2); // 1000 / 10

    expect(state.activityLog).toHaveLength(logBefore + 1);
    const row = state.activityLog[state.activityLog.length - 1];
    expect(row.text).toContain('bank loan');
    expect(row.text).toContain('1000');
    expect(row.text).toContain('110');
    expect(row.text).toContain('10 turns');
    expect(row.type).toBe('gain');
  });

  it('is reachable through the engine action dispatcher', () => {
    const state = marketPhaseState();
    const coinsBefore = state.resourceBank.coins;

    const result = executeAction(state, { type: 'take-loan', optionIndex: 0 });

    expect(result).toBeNull();
    expect(state.resourceBank.coins).toBe(coinsBefore + 300);
    expect(state.loans).toHaveLength(1);
    expect(state.loans[0]).toMatchObject({ principal: 300, termTurns: 3, turnsRemaining: 3 });
  });
});

// ── AC2: no action point cost ───────────────────────────────

describe('takeLoan — action-point neutrality (AC2)', () => {
  it('leaves actionsRemaining and bankedActions unchanged through the dispatcher', () => {
    const state = marketPhaseState();
    const actionsBefore = state.actionsRemaining;
    const bankedBefore = state.bankedActions;
    expect(actionsBefore).toBeGreaterThan(0);

    executeAction(state, { type: 'take-loan', optionIndex: 0 });

    expect(state.actionsRemaining).toBe(actionsBefore);
    expect(state.bankedActions).toBe(bankedBefore);
  });

  it('is still free when the daily action budget is already spent', () => {
    const state = marketPhaseState();
    state.actionsRemaining = 0;
    const coinsBefore = state.resourceBank.coins;

    // A loan must never be gated on remaining actions (it costs none).
    executeAction(state, { type: 'take-loan', optionIndex: 1 });

    expect(state.actionsRemaining).toBe(0);
    expect(state.resourceBank.coins).toBe(coinsBefore + 600);
    expect(state.loans).toHaveLength(1);
  });

  it('records no action consumption on the direct handler either', () => {
    const state = marketPhaseState();
    const actionsBefore = state.actionsRemaining;

    takeLoan(state, 1);

    expect(state.actionsRemaining).toBe(actionsBefore);
    expect(state.bankedActions).toBe(0);
  });
});

// ── AC3: one active loan per seat ───────────────────────────

describe('takeLoan — one active loan per seat (AC3)', () => {
  it('rejects a second loan with a clear reason and changes nothing', () => {
    const state = marketPhaseState();
    takeLoan(state, 0);
    const before = walletSnapshot(state);

    expect(() => takeLoan(state, 1)).toThrow(/one loan at a time/i);

    expect(walletSnapshot(state)).toEqual(before);
    expect(state.loans).toHaveLength(1);
    expect(state.loans[0].principal).toBe(300);
  });

  it('surfaces the rejection through the dispatcher as well', () => {
    const state = marketPhaseState();
    executeAction(state, { type: 'take-loan', optionIndex: 0 });
    const before = walletSnapshot(state);

    expect(() => executeAction(state, { type: 'take-loan', optionIndex: 2 })).toThrow(
      /one loan at a time/i,
    );
    expect(walletSnapshot(state)).toEqual(before);
  });

  it('enforces the rule per seat: another seat may still take a loan', () => {
    const state = createCompetitiveState({ seed: 'loans-two-seats', playerCount: 2 });
    executeWeekStart(state);
    // Seat 0 takes a loan while it is the active seat (ownerId resolves from
    // `activePlayerId`, exactly as the competitive turn driver sets it).
    state.activePlayerId = 0;
    bindCompetitiveSeat(state, 0);
    takeLoan(state, 1);
    restoreCompetitiveSeat(state, 0);
    const seat0Coins = state.players![0].coins;

    // Seat 1 then takes its own loan: the rule is per seat, not global.
    state.activePlayerId = 1;
    bindCompetitiveSeat(state, 1);
    takeLoan(state, 0);
    restoreCompetitiveSeat(state, 1);

    expect(state.loans.map((loan) => loan.ownerId).sort()).toEqual([0, 1]);
    expect(state.players![0].coins).toBe(seat0Coins);
  });

  it('reports the one-active-loan rule as illegal without mutating state', () => {
    const state = marketPhaseState();
    expect(canTakeLoan(state, 0).legal).toBe(true);

    takeLoan(state, 0);
    const legality = canTakeLoan(state, 0);

    expect(legality.legal).toBe(false);
    expect(legality.legal === false && legality.reason).toMatch(/one loan at a time/i);
  });
});

// ── Refusals: unknown option, disabled config, pending offer, phase ──

describe('takeLoan — refusals leave resources untouched', () => {
  it('rejects an option index outside the configured menu', () => {
    const state = marketPhaseState();
    const before = walletSnapshot(state);

    expect(() => takeLoan(state, 99)).toThrow(/unknown loan option 99/i);

    expect(walletSnapshot(state)).toEqual(before);
  });

  it('rejects a negative option index', () => {
    const state = marketPhaseState();
    const before = walletSnapshot(state);

    expect(() => takeLoan(state, -1)).toThrow(/unknown loan option/i);

    expect(walletSnapshot(state)).toEqual(before);
  });

  it('rejects loans when the config disables them', () => {
    const state = marketPhaseState();
    state.config = { ...state.config, loansEnabled: false };
    const before = walletSnapshot(state);

    expect(() => takeLoan(state, 0)).toThrow(/loans are disabled/i);

    expect(walletSnapshot(state)).toEqual(before);
  });

  it('rejects a loan while the seat has an unresolved pending offer', () => {
    const state = marketPhaseState();
    state.pendingLoanOffer = {
      ownerId: 0,
      reason: 'bankruptcy',
      options: [...DEFAULT_LOAN_OPTIONS],
    };
    const before = walletSnapshot(state);

    expect(() => takeLoan(state, 0)).toThrow(/offer is awaiting your decision/i);

    expect(walletSnapshot(state)).toEqual(before);
  });

  it('ignores a pending offer addressed to a different seat', () => {
    const state = createCompetitiveState({ seed: 'loans-offer-other-seat', playerCount: 2 });
    executeWeekStart(state);
    state.pendingLoanOffer = {
      ownerId: 1,
      reason: 'bankruptcy',
      options: [...DEFAULT_LOAN_OPTIONS],
    };
    state.activePlayerId = 0;
    const coinsBefore = state.players![0].coins;

    takeLoan(state, 0);

    expect(state.loans).toHaveLength(1);
    expect(state.loans[0].ownerId).toBe(0);
    expect(state.players![0].coins).toBe(coinsBefore + 300);
  });

  it('rejects a loan outside the market phase', () => {
    const state = setupMainStreetGame({ seed: 'loans-wrong-phase' });
    const before = walletSnapshot(state);

    expect(() => takeLoan(state, 0)).toThrow(/market phase/i);

    expect(walletSnapshot(state)).toEqual(before);
  });

  it('rejects a loan once the game is over', () => {
    const state = marketPhaseState();
    state.gameResult = 'loss';
    const before = walletSnapshot(state);

    expect(() => takeLoan(state, 0)).toThrow(/game is over/i);

    expect(walletSnapshot(state)).toEqual(before);
  });
});

// ── Competitive wallet routing ──────────────────────────────

describe('takeLoan — competitive seat wallets', () => {
  it('credits a bound seat in both the shared wallet and its record', () => {
    const state = createCompetitiveState({ seed: 'loans-bound-seat', playerCount: 2 });
    executeWeekStart(state);
    bindCompetitiveSeat(state, 0);
    const sharedBefore = state.resourceBank.coins;
    const recordBefore = state.players![0].coins;

    takeLoan(state, 1);

    expect(state.resourceBank.coins).toBe(sharedBefore + 600);
    expect(state.players![0].coins).toBe(recordBefore + 600);
    // The shared mirror and the record stay in step across the bind pair.
    restoreCompetitiveSeat(state, 0);
    expect(state.players![0].coins).toBe(recordBefore + 600);
  });

  it('credits an unbound seat record without inflating another seat wallet', () => {
    const state = createCompetitiveState({ seed: 'loans-unbound-seat', playerCount: 2 });
    executeWeekStart(state);
    // At rest: seat 1 holds no bind, the shared wallet still mirrors seat 0.
    const seat0Coins = state.players![0].coins;
    const seat1Coins = state.players![1].coins;
    state.activePlayerId = 1;

    takeLoan(state, 0);

    expect(state.players![1].coins).toBe(seat1Coins + 300);
    expect(state.players![0].coins).toBe(seat0Coins);
    expect(state.loans[0].ownerId).toBe(1);
  });
});

// ── Undo / redo ─────────────────────────────────────────────

describe('takeLoanCommand — reversible command', () => {
  it('undo removes the loan and restores the wallet, redo re-applies it', () => {
    const state = marketPhaseState();
    const coinsBefore = state.resourceBank.coins;
    const actionsBefore = state.actionsRemaining;
    const logBefore = state.activityLog.length;

    const mgr = new UndoRedoManager();
    mgr.execute(takeLoanCommand(state, 1));

    expect(state.resourceBank.coins).toBe(coinsBefore + 600);
    expect(state.loans).toHaveLength(1);
    expect(state.activityLog).toHaveLength(logBefore + 1);

    mgr.undo();
    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.loans).toEqual([]);
    expect(state.activityLog).toHaveLength(logBefore);
    expect(state.actionsRemaining).toBe(actionsBefore);
    expect(activeLoanFor(state, 0)).toBeUndefined();

    mgr.redo();
    expect(state.resourceBank.coins).toBe(coinsBefore + 600);
    expect(state.loans).toHaveLength(1);
    expect(state.loans[0].principal).toBe(600);
  });

  it('does not consume an action on undo/redo round-trip', () => {
    const state = marketPhaseState();
    const actionsBefore = state.actionsRemaining;
    const mgr = new UndoRedoManager();

    mgr.execute(takeLoanCommand(state, 0));
    mgr.undo();
    mgr.redo();

    expect(state.actionsRemaining).toBe(actionsBefore);
  });
});

// ── Persistence of the loan record ──────────────────────────

describe('loan persistence', () => {
  it('round-trips an active loan through save/load', () => {
    const state = marketPhaseState('loans-save-load');
    const loan = takeLoan(state, 1);
    const coinsAfter = state.resourceBank.coins;

    const loaded = deserializeMainStreetState(serializeMainStreetState(state));

    expect(loaded.loans).toEqual([loan]);
    expect(activeLoanFor(loaded, 0)).toEqual(loan);
    expect(loaded.resourceBank.coins).toBe(coinsAfter);
    expect(loaded.pendingLoanOffer).toBeNull();
  });

  it('loads a pre-loan save with no loans and unchanged behaviour', () => {
    const state = marketPhaseState('loans-legacy-save');
    const serialized = serializeMainStreetState(state) as unknown as Record<string, unknown>;
    // Simulate a schema-v2 (pre-loan) save: the loan fields do not exist.
    delete serialized.loans;
    delete serialized.pendingLoanOffer;

    const loaded = deserializeMainStreetState(serialized as never);

    expect(loaded.loans).toEqual([]);
    expect(loaded.pendingLoanOffer).toBeNull();
    expect(loaded.gameResult).toBe('playing');
    expect(activeLoanFor(loaded, 0)).toBeUndefined();
    // Loans remain takeable after loading a legacy save.
    const coinsBefore = loaded.resourceBank.coins;
    takeLoan(loaded, 0);
    expect(loaded.resourceBank.coins).toBe(coinsBefore + 300);
  });
});

// ── Retirement: termTurns payments, then nothing more ───────

describe('applyLoanPayment (retirement after termTurns)', () => {
  it('retires a 3-turn loan exactly on the third payment', () => {
    const state = setupMainStreetGame({ seed: 'loans-retire' });
    const loan = buildActiveLoan(state, DEFAULT_LOAN_OPTIONS[0]);

    const after1 = applyLoanPayment(loan);
    expect(after1).not.toBeNull();
    expect(after1!.turnsRemaining).toBe(2);

    const after2 = applyLoanPayment(after1!);
    expect(after2!.turnsRemaining).toBe(1);

    const after3 = applyLoanPayment(after2!);
    expect(after3).toBeNull();
  });

  it('applies exactly six payments to a 600/6 loan, then retires it', () => {
    const state = setupMainStreetGame({ seed: 'loans-retire-2' });
    let loan: ReturnType<typeof buildActiveLoan> | null =
      buildActiveLoan(state, DEFAULT_LOAN_OPTIONS[1]);
    let paymentsApplied = 0;
    while (loan !== null) {
      loan = applyLoanPayment(loan);
      paymentsApplied += 1;
    }
    // 600/6 → six payments of 110, then retirement (no seventh deduction).
    expect(paymentsApplied).toBe(6);
  });

  it('changes only the turn counter, leaving the pre-computed money untouched', () => {
    const state = setupMainStreetGame({ seed: 'loans-retire-3' });
    const loan = buildActiveLoan(state, DEFAULT_LOAN_OPTIONS[2]);
    const after = applyLoanPayment(loan)!;

    expect(after).toMatchObject({
      ownerId: loan.ownerId,
      principal: loan.principal,
      totalRepayment: loan.totalRepayment,
      perTurnRepayment: loan.perTurnRepayment,
      termTurns: loan.termTurns,
    });
    expect(after.turnsRemaining).toBe(loan.turnsRemaining - 1);
  });
});
