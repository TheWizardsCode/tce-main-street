/**
 * Unified tabbed P&L Turn Summary documentation drift guard
 * (MS-0MW5ERPLV004WZHR, parent MS-0MW4XULA90002OEY).
 *
 * The documentation is this slice's deliverable, so the guard asserts the
 * shipped prose against the shipped code rather than a private copy: the three
 * Turn Summary sections of `docs/game/ux-visual-audio.md` must describe the
 * unified tabbed profit/loss overlay, its P&L line structure and the
 * per-player tab model, and the flat layouts they replaced must stay gone.
 *
 * The behavioural contract itself (statement sections, reconciliation, tab
 * default/selection/persistence) is asserted against the shipped code in
 * `turn-summary-pl-model.test.ts` and `turn-summary-pl-overlay.browser.test.ts`;
 * this file only keeps the prose and the code anchors it names aligned. The
 * shared gate/competitive prose stays guarded by
 * `turn-summary-gate-docs.test.ts` and the loan prose by
 * `turn-summary-bank-loan-docs.test.ts` — not re-pinned here.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const UX_DOC = path.join(PROJECT_ROOT, 'docs/game/ux-visual-audio.md');

const MODEL_SECTION = '### Turn Summary panel model (turn-ledger summary)';
const DIALOG_SECTION = '### Turn Summary dialog and the closing gate';
const COMPETITIVE_SECTION =
  '### Competitive Turn Summary panel (per-seat round rows, MS-0MVRNV9Y8008IKGK)';

/**
 * Collapses hard line breaks and strips Markdown emphasis/code markers so a
 * phrase check is wrap- and formatting-insensitive.
 */
function normalise(text: string): string {
  return text
    .replace(/[`*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The normalised body of a `### <heading>` section, stopped at the next heading or rule. */
function section(heading: string): string {
  const doc = fs.readFileSync(UX_DOC, 'utf-8');
  const start = doc.indexOf(heading);
  expect(start, `documentation has no "${heading}" section`).toBeGreaterThanOrEqual(0);
  const rest = doc.slice(start + heading.length);
  const nextHeading = rest.search(/^#{2,3}\s/m);
  const nextRule = rest.search(/^---$/m);
  const stops = [nextHeading, nextRule].filter((index) => index !== -1);
  const end = stops.length > 0 ? Math.min(...stops) : rest.length;
  return normalise(rest.slice(0, end));
}

/** Reads a source file as normalised text. */
function source(relativePath: string): string {
  return normalise(fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf-8'));
}

describe('Turn Summary P&L model documentation — ux-visual-audio.md', () => {
  it('documents the P&L projection and its tab model', () => {
    const model = section(MODEL_SECTION);
    expect(model).toContain('buildplprojection');
    expect(model).toContain('buildpltabs');
    // The tab shape the overlay consumes, so a reader can map tabs to players.
    expect(model).toContain('isdefault');
    expect(model).toContain('ishuman');
  });

  it('documents the statement line structure in presentation order', () => {
    const model = section(MODEL_SECTION);
    for (const phrase of [
      'income',
      'base / synergy / reputation / events',
      'total income',
      'less: operating expenses',
      'staff / community / business',
      'total operating expenses',
      'incident',
      'one-off',
      'net profit/loss',
    ]) {
      expect(model, `missing "${phrase}"`).toContain(phrase);
    }
    // Order matters: the statement reads income → expenses → adjustments → net.
    const order = [
      'total income',
      'total operating expenses',
      'adjustments follow',
      'net profit/loss',
    ].map((phrase) => model.indexOf(phrase));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('states the reconciliation identity the displayed lines satisfy', () => {
    const model = section(MODEL_SECTION);
    expect(model).toContain(
      'income.total + expenses.total + incident.coins + oneoff.coins',
    );
    expect(model).toContain('net.coins');
  });

  it('keeps the non-monetary figures as supplementary context', () => {
    const model = section(MODEL_SECTION);
    expect(model).toContain('supplementary context');
    // The three figures the producer moved OUT of the monetary lines (Q2=A).
    for (const phrase of ['reputation', 'score', 'closing', 'businesses owned']) {
      expect(model, `missing "${phrase}"`).toContain(phrase);
    }
  });

  it('names the code anchors it documents', () => {
    const model = source('src/scenes/MainStreetTurnSummary.ts');
    expect(model).toContain('export function buildplprojection(');
    expect(model).toContain('export function buildpltabs(');
    expect(model).toContain('export function buildplfromcompetitiverow(');
  });
});

describe('Unified tabbed overlay documentation — ux-visual-audio.md', () => {
  it('replaces the flat layout with one tabbed panel for both modes', () => {
    const dialog = section(DIALOG_SECTION);
    expect(dialog).toContain('unified tabbed');
    expect(dialog).toContain('presentturnsummarypanel()');
    // The stale two-column description must stay gone.
    expect(dialog).not.toContain('two columns');
  });

  it('documents the tab strip: human default, single non-interactive You tab', () => {
    const dialog = section(DIALOG_SECTION);
    expect(dialog).toContain('tab strip');
    expect(dialog).toContain('human (you) tab is selected by default');
    expect(dialog).toContain('non-interactive');
    expect(dialog).toContain('you');
    // Switching a tab redraws the whole statement, not just the tab chrome.
    expect(dialog).toContain('whole');
  });

  it('documents keyboard tab switching', () => {
    const dialog = section(DIALOG_SECTION);
    expect(dialog).toContain('left/right');
    expect(dialog).toContain('arrow');
    expect(dialog).toContain('cycle');
  });

  it('documents that the selected tab survives the post-loan-take re-render', () => {
    const dialog = section(DIALOG_SECTION);
    expect(dialog).toContain('preserving the selected tab');
  });

  it('names the renderer both entry points delegate to', () => {
    const dialog = section(DIALOG_SECTION);
    expect(dialog).toContain('mainstreetoverlaycontent.showturnsummarydialog()');
    expect(dialog).toContain('showcompetitiveturnsummarydialog()');
    expect(dialog).toContain('src/scenes/mainstreetturnsummaryoverlay.ts');
    expect(source('src/scenes/MainStreetTurnSummaryOverlay.ts')).toContain(
      'export function presentturnsummarypanel(',
    );
  });
});

describe('Competitive portion of the tabbed overlay — ux-visual-audio.md', () => {
  it('documents the per-player tabs and tab switching', () => {
    const competitive = section(COMPETITIVE_SECTION);
    expect(competitive).toContain('tab per non-eliminated seat');
    expect(competitive).toContain('buildpltabsfromcompetitivesummary');
    expect(competitive).toContain('buildplfromcompetitiverow');
    expect(competitive).toContain('switches the whole statement body');
  });

  it('documents the competitive side as the same overlay, not a second layout', () => {
    const competitive = section(COMPETITIVE_SECTION);
    expect(competitive).toContain('competitive portion of the same');
    expect(competitive).toContain('unified tabbed p&l overlay');
    // The stale five-text-lines-per-seat block must stay gone.
    expect(competitive).not.toContain('five text lines');
  });

  it('documents the selected tab surviving a competitive loan re-render', () => {
    const competitive = section(COMPETITIVE_SECTION);
    expect(competitive).toContain('preserving the selected tab');
  });
});
