/**
 * Main Street: Bank Loans — save/load persistence, save schema v3
 * (Bank Loans epic MS-0MVL6DZI0000F6CG, persistence slice MS-0MVPWSE0E003QLKE).
 *
 * AC coverage (this slice):
 *   AC1 — active loans and a pending loan offer survive a save/load round-trip,
 *         and the save schema version is bumped to 3 with a migration.
 *   AC2 — pre-loan saves at schema version 2 load with no loans and unchanged
 *         behaviour (proven through the versioned `migrate` hook, not only by
 *         calling `deserializeMainStreetState` directly).
 *   AC3 — the round-trip and v2-migration tests cover loans and the pending
 *         offer, including the remaining repayment schedule — a mid-loan save
 *         resumes billing exactly the payments it had left.
 *
 * Also covered: the defensive restore rules the load relies on (malformed loan
 * entries are dropped instead of crashing the load, and `turnsRemaining` is
 * clamped to the loan's own `termTurns`).
 *
 * @module tests/main-street/MainStreetLoanSaveLoad
 */

import { describe, it, expect } from 'vitest';

import { deserializeWithVersion } from '@core-engine';

import {
  deserializeMainStreetState,
  serializeMainStreetState,
  setupMainStreetGame,
  type MainStreetSerializedState,
  type MainStreetState,
} from '../../src/MainStreetState';
import { activeLoanFor, acceptLoanOffer, executeWeekStart, maybeOfferBailout, takeLoan } from '../../src/MainStreetEngine';
import {
  DEFAULT_LOAN_OPTIONS,
  applyLoanRepayments,
  restoreActiveLoans,
  restorePendingLoanOffer,
} from '../../src/MainStreetLoans';
import {
  MAIN_STREET_CAMPAIGN_SCHEMA_VERSION,
  MAIN_STREET_SAVE_SCHEMA_VERSION,
  mainStreetStateSerializer,
} from '../../src/MainStreetSaveLoad';

// ── Helpers ─────────────────────────────────────────────────

/** Fresh single-player game armed in MarketPhase with no coins moving yet. */
function marketPhaseState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state, true);
  return state;
}

/** The serialized payload as untrusted, hand-editable data. */
function asRawPayload(state: MainStreetState): Record<string, unknown> {
  return serializeMainStreetState(state) as unknown as Record<string, unknown>;
}

/** One loan's full record, as persisted. */
function loanRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ownerId: 0,
    principal: 600,
    totalRepayment: 660,
    perTurnRepayment: 110,
    turnsRemaining: 6,
    termTurns: 6,
    takenOnTurn: 4,
    ...overrides,
  };
}

// ── Schema version and migration ────────────────────────────

describe('save schema v3', () => {
  it('bumps the run-checkpoint schema to 3 while leaving the campaign schema alone (AC1)', () => {
    expect(MAIN_STREET_SAVE_SCHEMA_VERSION).toBe(3);
    expect(mainStreetStateSerializer.schemaVersion).toBe(3);
    // Campaign progress is versioned independently (3 predates this slice).
    expect(MAIN_STREET_CAMPAIGN_SCHEMA_VERSION).toBe(3);
  });

  it('migrates a v2 payload to the empty loan state (AC2)', () => {
    const state = marketPhaseState('loan-save-v2-payload');
    const payload = asRawPayload(state);
    // A genuine v2 save predates the loan mechanic: neither field exists.
    delete payload.loans;
    delete payload.pendingLoanOffer;
    expect(payload).not.toHaveProperty('loans');
    expect(payload).not.toHaveProperty('pendingLoanOffer');

    const migrated = mainStreetStateSerializer.migrate!(
      payload as unknown as MainStreetSerializedState,
      2,
    ) as unknown as Record<string, unknown>;

    expect(migrated.loans).toEqual([]);
    expect(migrated.pendingLoanOffer).toBeNull();
  });

  it('loads a v2 save through the versioned path with no loans and unchanged behaviour (AC2)', () => {
    const state = marketPhaseState('loan-save-v2-load');
    const payload = asRawPayload(state);
    delete payload.loans;
    delete payload.pendingLoanOffer;

    // The strict version check would reject this payload without the hook.
    const restored = deserializeWithVersion(mainStreetStateSerializer, {
      schemaVersion: 2,
      data: payload as unknown as MainStreetSerializedState,
    });

    expect(restored.loans).toEqual([]);
    expect(restored.pendingLoanOffer).toBeNull();
    expect(activeLoanFor(restored, 0)).toBeUndefined();
    expect(restored.gameResult).toBe('playing');

    // Unchanged behaviour: the loan menu is still open and a loan taken after
    // the load repays on the normal schedule.
    const coinsBefore = restored.resourceBank.coins;
    const loan = takeLoan(restored, 0);
    expect(restored.resourceBank.coins).toBe(
      coinsBefore + DEFAULT_LOAN_OPTIONS[0].principal,
    );
    expect(loan.turnsRemaining).toBe(DEFAULT_LOAN_OPTIONS[0].termTurns);
    expect(applyLoanRepayments(restored)).toBe(-loan.perTurnRepayment);
  });

  it('leaves a v3 payload untouched when the migration hook runs', () => {
    const state = marketPhaseState('loan-save-v3-payload');
    const loan = takeLoan(state, 1);
    const payload = asRawPayload(state);

    const migrated = mainStreetStateSerializer.migrate!(
      payload as unknown as MainStreetSerializedState,
      3,
    ) as unknown as Record<string, unknown>;

    expect(migrated.loans).toEqual([loan]);
    expect(migrated).not.toHaveProperty('pendingLoanOffer');
  });
});

// ── Round-trip: an active loan ──────────────────────────────

describe('active loan round-trip (AC1, AC3)', () => {
  it('preserves the remaining turns and the per-turn amount across a reload', () => {
    const state = marketPhaseState('loan-save-roundtrip');
    const loan = takeLoan(state, 1); // 600 / 6 → 660 total → 110 per turn
    applyLoanRepayments(state); // first payment: 5 turns left
    const coinsAtSave = state.resourceBank.coins;

    const payload = serializeMainStreetState(state);
    expect(payload.loans).toHaveLength(1);

    const restored = deserializeMainStreetState(payload);

    expect(restored.loans).toEqual([{ ...loan, turnsRemaining: 5 }]);
    expect(activeLoanFor(restored, 0)).toEqual({ ...loan, turnsRemaining: 5 });
    expect(restored.loans[0]).toMatchObject({
      ownerId: 0,
      principal: 600,
      totalRepayment: 660,
      perTurnRepayment: 110,
      turnsRemaining: 5,
      termTurns: 6,
    });
    // The wallet is not re-credited (or re-charged) by the load.
    expect(restored.resourceBank.coins).toBe(coinsAtSave);
    expect(restored.pendingLoanOffer).toBeNull();
  });

  it('resumes a mid-loan save with exactly the payments it had left (AC3)', () => {
    const state = marketPhaseState('loan-save-midterm');
    takeLoan(state, 0); // 300 / 3 → three payments of 110
    const coinsAfterLoan = state.resourceBank.coins;

    applyLoanRepayments(state); // payment 1 of 3
    const coinsAtSave = state.resourceBank.coins;

    const restored = deserializeMainStreetState(serializeMainStreetState(state));
    expect(restored.loans[0].turnsRemaining).toBe(2);
    expect(restored.resourceBank.coins).toBe(coinsAtSave);

    // Two payments remain, at the same fixed amount, then the loan retires.
    expect(applyLoanRepayments(restored)).toBe(-110);
    expect(restored.loans[0].turnsRemaining).toBe(1);
    expect(applyLoanRepayments(restored)).toBe(-110);
    expect(restored.loans).toEqual([]);
    // Nothing further is billed after the term.
    expect(applyLoanRepayments(restored)).toBe(0);

    expect(restored.resourceBank.coins).toBe(coinsAfterLoan - 3 * 110);
  });

  it('omits the loan fields from a loan-free save so its payload stays small', () => {
    const state = marketPhaseState('loan-save-empty');
    const payload = asRawPayload(state);

    expect(payload).not.toHaveProperty('loans');
    expect(payload).not.toHaveProperty('pendingLoanOffer');

    const restored = deserializeMainStreetState(payload as unknown as MainStreetSerializedState);
    expect(restored.loans).toEqual([]);
    expect(restored.pendingLoanOffer).toBeNull();
  });
});

// ── Round-trip: the pending bailout offer ───────────────────

describe('pending loan offer round-trip (AC1)', () => {
  it('keeps a raised bankruptcy offer pending across a reload and resolvable (AC1)', () => {
    const state = marketPhaseState('loan-save-pending-offer');
    state.resourceBank.coins = -25;
    expect(maybeOfferBailout(state)).toBe(true);
    const offer = state.pendingLoanOffer;
    expect(offer).not.toBeNull();

    const restored = deserializeMainStreetState(serializeMainStreetState(state));

    // Owner, reason and menu round-trip verbatim.
    expect(restored.pendingLoanOffer).toEqual(offer);
    expect(restored.pendingLoanOffer).toEqual({
      ownerId: 0,
      reason: 'bankruptcy',
      options: DEFAULT_LOAN_OPTIONS.map((option) => ({ ...option })),
    });
    expect(restored.loans).toEqual([]);

    // The loaded offer is still actionable: accepting it credits the largest
    // presented option (the AI/headless policy) and records the loan.
    const coinsBefore = restored.resourceBank.coins;
    const loan = acceptLoanOffer(restored);
    expect(restored.pendingLoanOffer).toBeNull();
    expect(loan.principal).toBe(Math.max(...DEFAULT_LOAN_OPTIONS.map((o) => o.principal)));
    expect(restored.resourceBank.coins).toBe(coinsBefore + loan.principal);
    expect(activeLoanFor(restored, 0)).toEqual(loan);
  });

  it('round-trips an offer alongside an active loan held by another seat', () => {
    const state = marketPhaseState('loan-save-offer-and-loan');
    // A hand-built (but well-formed) save: seat 0 holds a loan while seat 1
    // waits on an offer — the two fields must not interfere on restore.
    const raw = asRawPayload(state);
    raw.loans = [loanRecord({ ownerId: 0 })];
    raw.pendingLoanOffer = {
      ownerId: 1,
      reason: 'bankruptcy',
      options: [{ principal: 300, termTurns: 3 }],
    };

    const restored = deserializeMainStreetState(raw as unknown as MainStreetSerializedState);

    expect(restored.loans).toHaveLength(1);
    expect(restored.loans[0]).toMatchObject({ ownerId: 0, principal: 600, turnsRemaining: 6 });
    expect(restored.pendingLoanOffer).toEqual({
      ownerId: 1,
      reason: 'bankruptcy',
      options: [{ principal: 300, termTurns: 3 }],
    });
  });
});

// ── Defensive restore ───────────────────────────────────────

describe('defensive restore', () => {
  it('drops malformed loan entries instead of failing the load', () => {
    const state = marketPhaseState('loan-save-malformed');
    const raw = asRawPayload(state);
    raw.loans = [
      loanRecord(), // the only valid entry
      null,
      'not-a-loan',
      42,
      {},
      loanRecord({ ownerId: 1, termTurns: 0 }), // zero-turn loan
      loanRecord({ ownerId: 2, turnsRemaining: Number.NaN }),
      loanRecord({ ownerId: 3, principal: -100 }),
      loanRecord({ ownerId: 6, takenOnTurn: 'turn-4' }),
      loanRecord({ ownerId: 0, principal: 300 }), // second loan for seat 0
    ];

    const restored = deserializeMainStreetState(raw as unknown as MainStreetSerializedState);

    // One loan per seat survives: the first well-formed entry for seat 0.
    expect(restored.loans).toHaveLength(1);
    expect(restored.loans[0]).toMatchObject({
      ownerId: 0,
      principal: 600,
      perTurnRepayment: 110,
      turnsRemaining: 6,
    });
  });

  it('clamps turnsRemaining to the loan term and retires an exhausted loan', () => {
    const state = marketPhaseState('loan-save-clamp');
    const raw = asRawPayload(state);
    raw.loans = [
      loanRecord({ ownerId: 0, turnsRemaining: 99 }),
      loanRecord({ ownerId: 1, turnsRemaining: 0 }),
      loanRecord({ ownerId: 2, turnsRemaining: -3 }),
    ];

    const restored = deserializeMainStreetState(raw as unknown as MainStreetSerializedState);

    // Seat 0 is clamped to its 6-turn term; seats 1/2 have nothing left to pay.
    expect(restored.loans).toHaveLength(1);
    expect(restored.loans[0]).toMatchObject({ ownerId: 0, turnsRemaining: 6, termTurns: 6 });
  });

  it('drops an unusable pending offer instead of stalling the closing', () => {
    const state = marketPhaseState('loan-save-bad-offer');
    const raw = asRawPayload(state);
    raw.pendingLoanOffer = { ownerId: 'seat-one', reason: 'bankruptcy', options: [] };

    const restored = deserializeMainStreetState(raw as unknown as MainStreetSerializedState);
    expect(restored.pendingLoanOffer).toBeNull();

    raw.pendingLoanOffer = { ownerId: 0, reason: 'bankruptcy', options: [] };
    const noOptions = deserializeMainStreetState(raw as unknown as MainStreetSerializedState);
    expect(noOptions.pendingLoanOffer).toBeNull();

    raw.pendingLoanOffer = { ownerId: 0, reason: 'unknown-reason', options: [{ principal: 300, termTurns: 3 }] };
    const unknownReason = deserializeMainStreetState(raw as unknown as MainStreetSerializedState);
    expect(unknownReason.pendingLoanOffer).toBeNull();
  });

  it('drops unusable menu options but keeps the offer resolvable', () => {
    const state = marketPhaseState('loan-save-partial-offer');
    const raw = asRawPayload(state);
    raw.pendingLoanOffer = {
      ownerId: 0,
      reason: 'bankruptcy',
      options: [
        { principal: 0, termTurns: 3 },
        { principal: 300, termTurns: 0 },
        null,
        { principal: 600, termTurns: 6 },
      ],
    };

    const restored = deserializeMainStreetState(raw as unknown as MainStreetSerializedState);

    expect(restored.pendingLoanOffer?.options).toEqual([{ principal: 600, termTurns: 6 }]);
    expect(acceptLoanOffer(restored).principal).toBe(600);
  });

  it('restores nothing from a missing or non-array loans value', () => {
    expect(restoreActiveLoans(undefined)).toEqual([]);
    expect(restoreActiveLoans(null)).toEqual([]);
    expect(restoreActiveLoans('loans')).toEqual([]);
    expect(restoreActiveLoans({ 0: loanRecord() })).toEqual([]);
    expect(restorePendingLoanOffer(undefined)).toBeNull();
    expect(restorePendingLoanOffer('pendingLoanOffer')).toBeNull();
  });
});
