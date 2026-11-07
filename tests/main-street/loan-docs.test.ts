/**
 * Loan documentation drift guard (MS-0MVPWSFDN000QJXB, parent AC2;
 * loan-payoff notification MS-0MW3SN7XG003VPUM).
 *
 * The rules documentation is the deliverable for the Bank Loans documentation
 * slice, so the guard asserts the shipped copy against the shipped loan code
 * rather than against a private copy of the numbers: the documented loan menu
 * must match `DEFAULT_LOAN_OPTIONS` and the documented per-turn / total
 * repayment must equal `MainStreetLoans`' own arithmetic. Re-balancing the
 * default menu without updating `docs/game/core-rules-and-mechanics.md` fails
 * here instead of silently shipping stale rules.
 *
 * It also pins the **loan payoff notification** prose (§5.1 of the rules, the
 * dialog section of `ux-visual-audio.md` and the README summary), so the
 * shipped announcement — once per retired loan, after the closing animations
 * and before the End of Turn summary, debt free / weekly amount no longer
 * deducted / total repaid, presentation-only and human-seat-only in
 * competitive play — cannot drift out of the documentation.
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
const UX_DOC = path.resolve(__dirname, '../../docs/game/ux-visual-audio.md');
const README = path.resolve(__dirname, '../../README.md');

/** Collapses hard line breaks / casing so phrase checks are wrap-insensitive. */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The body of a `### <heading>` (or `## <heading>`) section, stopped at the next heading. */
function headingSection(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  expect(start, `documentation has no "${heading}" section`).toBeGreaterThanOrEqual(0);
  const rest = doc.slice(start + heading.length);
  const next = rest.search(/^#{2,3}\s/m);
  return next === -1 ? rest : rest.slice(0, next);
}

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

  it('states the loan payoff notification rule', () => {
    const section = normalise(loanSection());
    // Announced once per retired loan, after the closing animations and before
    // the End of Turn summary.
    expect(section).toContain('payoff notification');
    expect(section).toContain('once per retired loan');
    expect(section).toContain('after the closing animations');
    expect(section).toContain('before the end of turn summary');
    // The dialog's three facts.
    expect(section).toContain('debt free');
    expect(section).toContain('no longer deducted');
    expect(section).toContain('total repaid');
    // Presentation only: no state, log, save or RNG change.
    expect(section).toContain('presentation-only');
    expect(section).toContain('no rng');
    expect(section).toContain('written to or read from a save');
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

describe('Loan payoff dialog documentation (ux-visual-audio.md)', () => {
  const doc = fs.readFileSync(UX_DOC, 'utf-8');
  const section = normalise(headingSection(doc, '### Loan payoff congratulation dialog'));

  it('names the renderer, the copy model and the turn-flow sequencer', () => {
    expect(section).toContain('mainstreetloanpayoffoverlay');
    expect(section).toContain('showloanpayoffdialog');
    expect(section).toContain('mainstreetloanpayoffmodel');
    expect(section).toContain('buildloanpayoffcontent');
    expect(section).toContain('shouldpresentloanpayoff');
    expect(section).toContain('presentloanpayoffdialogs');
    expect(section).toContain('turnresult.loanpayoffs');
  });

  it('states when the dialog appears and what dismissing it resumes', () => {
    expect(section).toContain('once per retired loan');
    expect(section).toContain('after the closing animations');
    expect(section).toContain('before the end of turn summary');
    expect(section).toContain('next-week');
    expect(section).toContain('game-over overlay');
  });

  it('states the copy it renders from the model', () => {
    expect(section).toContain('debt free');
    expect(section).toContain('no longer deducted');
    expect(section).toContain('repaid over');
    expect(section).toContain('continue');
  });

  it('states the overlay conventions, single dismiss action and reduced-motion safety', () => {
    expect(section).toContain('createoverlaybackground');
    expect(section).toContain('createoverlaybutton');
    expect(section).toContain('s.hudcontainer');
    expect(section).toContain('199/200/201');
    expect(section).toContain('s.overlayobjects');
    expect(section).toContain('single dismiss action');
    expect(section).toContain('exactly once');
    expect(section).toContain('reduced-motion safe');
    expect(section).toContain('no fade-in');
  });

  it('states the replayMode and human-seat-only competitive gating', () => {
    expect(section).toContain('replaymode');
    expect(section).toContain('ishumanseatcredit');
    expect(section).toContain('human seat');
    expect(section).toContain('ai seat');
  });
});

describe('Loan payoff notification documentation (README.md)', () => {
  const section = normalise(headingSection(fs.readFileSync(README, 'utf-8'), '## Loan payoff notification'));

  it('summarises the announcement without contradicting the rules', () => {
    expect(section).toContain('retired loan');
    expect(section).toContain('once');
    expect(section).toContain('debt free');
    expect(section).toContain('no longer deducted');
    expect(section).toContain('end of turn summary');
    expect(section).toContain('presentation-only');
  });
});
