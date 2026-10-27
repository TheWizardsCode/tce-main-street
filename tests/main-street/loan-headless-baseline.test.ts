import { describe, expect, it } from 'vitest';
import {
  LOAN_HEADLESS_BASELINE_STRATEGY,
  runEndTurnHeadlessBaseline,
  runMonteCarloHeadlessBaseline,
} from './helpers/loanHeadlessBaseline';

/**
 * Golden baseline of today's headless simulation aggregates (work item
 * MS-0MVPWS45N008PR0X, first slice of the Bank Loans epic
 * MS-0MVL6DZI0000F6CG).
 *
 * Purpose: prove the loan feature leaves loans-off simulations byte-identical
 * to the pre-loan numbers (parent AC8). The values below are captured from
 * the current dev HEAD **before any loan code touches the closing sequence**;
 * they must not drift. Once loans land, the loans-off comparison test
 * exercises the same helper and asserts the same aggregates — any drift is
 * attributable to the slice that introduced it (see the captured golden
 * values in this item's comments).
 *
 * Determinism: every run uses the fixed seed list from the helper; no
 * wall-clock time and no unseeded RNG are involved. The whole file completes
 * in the low single-digit seconds.
 *
 * Loans-disabled note: `loansEnabled` does not exist yet, so these runs are
 * loans-off by construction. When the flag lands it must default to `false`
 * for headless/simulation configs; the later comparison test asserts that.
 */
describe('loan headless determinism baseline (pre-loan golden record)', () => {
  it('plain endTurnHeadless loop matches the recorded baseline', () => {
    const aggregates = runEndTurnHeadlessBaseline();

    expect(aggregates.gamesPlayed).toBe(5);
    expect(aggregates.wins).toBe(0);
    expect(aggregates.losses).toBe(5);
    expect(aggregates.bankruptcies).toBe(5);
    expect(aggregates.meanTurns).toBeCloseTo(9.6, 6);
    expect(aggregates.meanFinalScore).toBeCloseTo(289.2, 6);
  });

  it(`Monte Carlo batch runner (${LOAN_HEADLESS_BASELINE_STRATEGY}) matches the recorded baseline`, () => {
    const aggregates = runMonteCarloHeadlessBaseline();

    expect(aggregates.gamesPlayed).toBe(5);
    expect(aggregates.wins).toBe(1);
    expect(aggregates.losses).toBe(4);
    expect(aggregates.bankruptcies).toBe(4);
    expect(aggregates.meanTurns).toBeCloseTo(9, 6);
    expect(aggregates.meanFinalScore).toBeCloseTo(3328.6, 6);
  });

  it('reproduces the same plain-loop results from a fresh state (seed determinism)', () => {
    const first = runEndTurnHeadlessBaseline();
    const second = runEndTurnHeadlessBaseline();
    expect(second).toEqual(first);
  });
});
