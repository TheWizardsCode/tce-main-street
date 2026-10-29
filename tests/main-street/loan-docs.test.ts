/**
 * Loan documentation drift guard (MS-0MVPWSFDN000QJXB, parent AC2).
 *
 * The rules documentation is the deliverable for the Bank Loans documentation
 * slice, so the guard asserts the shipped copy against the shipped loan code
 * rather than against a private copy of the numbers: the documented loan menu
 * must match `DEFAULT_LOAN_OPTIONS` and the documented per-turn / total
 * repayment must equal `MainStreetLoans`' own arithmetic. Re-balancing the
 * default menu without updating `docs/game/core-rules-and-mechanics.md` fails
 * here instead of silently shipping stale rules.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  DEFAULT_LOAN_INTEREST_RATE,
  DEFAULT_LOAN_OPTIONS,
  loanPerTurnRepayment,
  loanTotalRepayment,
} from '../../src/MainStreetLoans';

const CORE_RULES = path.resolve(__dirname, '../../docs/game/core-rules-and-mechanics.md');

/** The `### 5.1 Bank loans` section body (start of the next top-level rule). */
function loanSection(): string {
  const doc = fs.readFileSync(CORE_RULES, 'utf-8');
  const start = doc.indexOf('### 5.1 Bank loans');
  expect(start, 'core-rules-and-mechanics.md has no "§5.1 Bank loans" section').toBeGreaterThanOrEqual(0);
  const end = doc.indexOf('\n---', start);
  return end === -1 ? doc.slice(start) : doc.slice(start, end);
}

interface DocumentedMenuRow {
  principal: number;
  termTurns: number;
  perTurn: number;
  total: number;
}

/**
 * Parses the loan-menu table rows (`| Small | 300 coins | 3 weeks | 110 coins | 330 coins |`).
 *
 * The documented rows are read defensively (missing values are `NaN`) so a
 * malformed or deleted row fails the comparison below rather than throwing.
 */
function documentedMenuRows(section: string): DocumentedMenuRow[] {
  return section
    .split('\n')
    .filter((line) => /^\|\s*(Small|Medium|Large)\s*\|/.test(line))
    .map((line) => {
      const coins = [...line.matchAll(/(\d+)\s*coins/g)].map((m) => Number(m[1]));
      const term = line.match(/(\d+)\s*weeks/);
      return {
        principal: coins[0],
        termTurns: term ? Number(term[1]) : Number.NaN,
        perTurn: coins[1],
        total: coins[2],
      };
    });
}

describe('Bank loans rules documentation (§5.1 of core-rules-and-mechanics.md)', () => {
  it('documents exactly the shipped default loan menu', () => {
    const rows = documentedMenuRows(loanSection());
    expect(rows.map((row) => [row.principal, row.termTurns])).toEqual(
      DEFAULT_LOAN_OPTIONS.map((option) => [option.principal, option.termTurns]),
    );
  });

  it('states the repayment figures the loan arithmetic derives', () => {
    for (const row of documentedMenuRows(loanSection())) {
      const total = loanTotalRepayment(row.principal, DEFAULT_LOAN_INTEREST_RATE);
      expect(row.total, `total repayment for ${row.principal}`).toBe(total);
      expect(row.perTurn, `per-turn repayment for ${row.principal}`).toBe(
        loanPerTurnRepayment(total, row.termTurns),
      );
    }
  });

  it('states the flat-interest maths with the 600 / 6 → 110 worked example', () => {
    const section = loanSection();
    expect(section).toContain('round(principal × (1 + loanInterestRate))');
    expect(section).toContain('round(totalRepayment / termTurns)');
    expect(section).toContain('round(600 × 1.10) = 660');
    expect(section).toMatch(/round\(660 \/ 6\) = 110/);
    expect(section.toLowerCase()).toContain('no compounding');
  });

  it('states the one-loan, no-action-cost, unclamped-repayment and bailout rules', () => {
    const section = loanSection().toLowerCase();
    expect(section).toContain('one active loan per player');
    expect(section).toContain('no action cost');
    expect(section).toContain('never clamped');
    expect(section).toContain('bailout');
    expect(section).toContain('at most one offer per seat per turn');
    // AI policy and the loans-off no-op that keeps headless baselines identical.
    expect(section).toContain('largest');
    expect(section).toContain('loansenabled');
  });
});
