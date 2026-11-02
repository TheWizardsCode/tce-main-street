/**
 * Bank Loan button documentation drift guard (MS-0MVXYCKWL009N9CM, parent
 * MS-0MVPWSQMG004198C AC7).
 *
 * The documentation is this slice's deliverable, so the guard asserts the
 * shipped prose against the shipped behaviour rather than against a private
 * copy: the Turn Summary section must describe the enabled/disabled matrix,
 * the selector contents, the no-action-point / no-day-advance rules and
 * `[ Next Turn ]` as the only resume path — and the stale "always disabled /
 * coming in a future update" copy of MS-0MVP46AMO002SZUT must be gone.
 * §5.1 of the rules documentation must not keep the pre-MS-0MVXYCIU00053HL1
 * "MarketPhase only" claim, and the in-game help must name the mid-game entry
 * point so loans do not read as a bailout-only feature.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { buildMainStreetHelpContent, type HelpSectionContent } from '../../src/MainStreetHelpContent';

const UX_DOC = path.resolve(__dirname, '../../docs/game/ux-visual-audio.md');
const CORE_RULES = path.resolve(__dirname, '../../docs/game/core-rules-and-mechanics.md');

/** Collapses hard line breaks so phrase checks are wrap-insensitive. */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The body of a `### <heading>` section, stopped at the next `###`/`---`. */
function markdownSection(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  expect(start, `documentation has no "${heading}" section`).toBeGreaterThanOrEqual(0);
  const rest = doc.slice(start + heading.length);
  const nextHeading = rest.search(/^###\s/m);
  const nextRule = rest.search(/^---$/m);
  const stops = [nextHeading, nextRule].filter((index) => index !== -1);
  const end = stops.length > 0 ? Math.min(...stops) : rest.length;
  return rest.slice(0, end);
}

function helpBody(heading: string): string {
  const content = buildMainStreetHelpContent({ winThreshold: 120, challengesPerRun: 3 });
  const section = content.find((entry: HelpSectionContent) => entry.heading === heading);
  expect(section, `help content has no "${heading}" section`).toBeDefined();
  return section!.body ?? '';
}

describe('Turn Summary Bank Loan documentation (ux-visual-audio.md)', () => {
  const doc = fs.readFileSync(UX_DOC, 'utf-8');

  it('documents the enabled/disabled matrix for the [ Bank Loan ] button', () => {
    const section = normalise(markdownSection(doc, '### Turn Summary dialog and the closing gate'));
    // Enabled only when loans are on and the seat holds no active loan.
    expect(section).toContain('enabled/disabled matrix');
    expect(section).toContain('config.loansenabled');
    expect(section).toContain('active loan');
    // Every disabled case names its own reason.
    expect(section).toContain('loans disabled');
    expect(section).toContain('no configured');
    expect(section).toContain('outstanding obligation');
    expect(section).toContain('[ bank loan ]');
  });

  it('documents the selector contents and its cancel path', () => {
    const section = normalise(markdownSection(doc, '### Mid-game loan selector'));
    // One row per configured option, priced like the bailout dialog.
    expect(section).toContain('config.loanoptions');
    expect(section).toContain('per-turn repayment');
    expect(section).toContain('total repayment');
    expect(section).toContain('principal');
    expect(section).toContain('cancel');
  });

  it('states the loan costs no action point and does not advance the day', () => {
    const section = normalise(markdownSection(doc, '### Mid-game loan selector'));
    expect(section).toContain('costs no action point');
    expect(section).toContain('does not advance the day');
    expect(section).toContain('actionsremaining');
    expect(section).toContain('state.turn');
  });

  it('keeps [ Next Turn ] as the only resume path', () => {
    const summary = normalise(markdownSection(doc, '### Turn Summary dialog and the closing gate'));
    const selector = normalise(markdownSection(doc, '### Mid-game loan selector'));
    expect(summary).toContain('only way to resume the deferred closing');
    expect(summary).toContain('advances only on that click');
    expect(selector).toContain('[ next turn ]');
    expect(selector).toContain('exactly once');
  });

  it('no longer describes the button as always disabled or coming in a future update', () => {
    const section = normalise(markdownSection(doc, '### Turn Summary dialog and the closing gate'));
    expect(section).not.toContain('always disabled');
    expect(section).not.toContain('coming in a future update');
    expect(section).not.toContain('not available yet');
  });
});

describe('Bank loans rules documentation (core-rules-and-mechanics.md §5.1)', () => {
  const section = normalise(markdownSection(fs.readFileSync(CORE_RULES, 'utf-8'), '### 5.1 Bank loans'));

  it('names both entry points, including the End of Turn summary selector', () => {
    expect(section).toContain('two entry points');
    expect(section).toContain('end of turn summary');
    expect(section).toContain('bailout dialog');
  });

  it('no longer claims takeLoan is legal in the MarketPhase only', () => {
    expect(section).not.toContain('marketphase only');
    // The deferred-closing window and its explicit opt-in are documented.
    expect(section).toContain('allowduringclosing');
    expect(section).toContain('deferred-closing pause');
  });

  it('states the mid-game loan costs no action point and does not advance the day', () => {
    expect(section).toContain('costs no action point');
    expect(section).toContain('does not advance the day');
  });
});

describe('Bank Loans in-game help (MainStreetHelpContent.ts)', () => {
  it('names the mid-game [ Bank Loan ] entry point without contradicting the shipped rules', () => {
    const body = normalise(helpBody('Bank Loans'));
    expect(body).toContain('[ bank loan ] on the end of turn summary');
    // The rules the Button must not contradict.
    expect(body).toContain('no action point');
    expect(body).toContain('one loan at a time');
    expect(body).toContain('bailout');
  });
});
