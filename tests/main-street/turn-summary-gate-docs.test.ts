/**
 * Turn Summary gate documentation drift guard (MS-0MW20KSEG001DH1X).
 *
 * The reduced-motion fix is a behaviour change whose only player-visible
 * description lives in prose, so the prose is pinned the way the sibling
 * documentation guards pin their slices (`turn-summary-bank-loan-docs.test.ts`,
 * `clipping-docs-drift.test.ts`): the shipped documents must describe the
 * shipped gate, and the stale claims they replaced must stay gone.
 *
 * Three passages describe this gate and all three are guarded here:
 *
 * 1. `docs/game/ux-visual-audio.md` → `### Turn Summary dialog and the closing
 *    gate`. It must say that reduced motion **is** gated, and must name both
 *    halves of the fix (`shouldGateTurnSummary()` has no reduced-motion guard;
 *    `endTurn()` takes the deferred closing path under reduced motion) — the
 *    second half is the one a future refactor is most likely to drop, silently
 *    restoring the bug even with the display guard removed.
 * 2. `docs/game/ux-visual-audio.md` → `### Reduced motion` (Accessibility).
 *    It used to list only the skipped animation families, which reads as
 *    "reduced motion suppresses the closing feedback" — the assumption behind
 *    the bug. It must state that dialogs are never suppressed.
 * 3. `docs/dev/testing.md` → `### Interaction gates`. Browser-test authors
 *    need the actionable rule: a reduced-motion end-of-turn test dismisses the
 *    dialog like any other single-player closing, or it polls a state the
 *    scene is deliberately holding.
 *
 * The behavioural contract itself (guard matrix, `endTurn` path selection, the
 * dialog appearing in a real scene) is asserted against the shipped code in
 * `turn-summary-gate.test.ts` and `turn-summary-dialog.browser.test.ts`; this
 * file never re-implements it — it only keeps the documentation aligned.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const UX_DOC = path.join(PROJECT_ROOT, 'docs/game/ux-visual-audio.md');
const TESTING_DOC = path.join(PROJECT_ROOT, 'docs/dev/testing.md');

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

/** The body of a `### <heading>` section, stopped at the next heading or rule. */
function markdownSection(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  expect(start, `documentation has no "${heading}" section`).toBeGreaterThanOrEqual(0);
  const rest = doc.slice(start + heading.length);
  const nextHeading = rest.search(/^#{2,3}\s/m);
  const nextRule = rest.search(/^---$/m);
  const stops = [nextHeading, nextRule].filter((index) => index !== -1);
  const end = stops.length > 0 ? Math.min(...stops) : rest.length;
  return rest.slice(0, end);
}

/** A section of the UX document, normalised. */
function uxSection(heading: string): string {
  return normalise(markdownSection(fs.readFileSync(UX_DOC, 'utf-8'), heading));
}

/** The browser-test gate rules of the testing document, normalised. */
function testingGatesSection(): string {
  return normalise(
    markdownSection(fs.readFileSync(TESTING_DOC, 'utf-8'), '### Interaction gates'),
  );
}

const GATE_SECTION = '### Turn Summary dialog and the closing gate';

describe('Turn Summary gate documentation — ux-visual-audio.md', () => {
  it('states that reduced motion is gated, not exempt', () => {
    const section = uxSection(GATE_SECTION);
    expect(section).toContain('reduced motion is gated too');
    // The rationale must be present, not just the verdict: the dialog is
    // instant-appearance, so suppressing it was never a reduced-motion need.
    expect(section).toContain('instant-appearance');
  });

  it('names both halves of the fix (display gate AND closing path)', () => {
    const section = uxSection(GATE_SECTION);
    // Half one: the display gate carries no reduced-motion guard.
    expect(section).toContain('shouldgateturnsummary()');
    expect(section).toContain('no reduced-motion guard');
    // Half two: the closing is actually deferred under reduced motion, which
    // is what gives the gate a result to gate on.
    expect(section).toContain('endturn()');
    expect(section).toContain('deferred closing path');
    expect(section).toContain('requiresdeferredclosing');
  });

  it('documents that the gating adds no wait and no new animation', () => {
    const section = uxSection(GATE_SECTION);
    expect(section).toContain('no new wait is added');
    expect(section).toContain('pacing under reduced motion is unchanged');
  });

  it('documents the instant-appearance + mute-respecting SFX contract', () => {
    const section = uxSection(GATE_SECTION);
    // AC4: the dialog never animates in and its SFX go through the shared
    // mute-aware helper, so there is no reduced-motion variant to build.
    expect(section).toContain('instant');
    expect(section).toContain('no fade-in');
    expect(section).toContain('safeplaysound');
    expect(section).toContain('mute');
  });

  it('no longer lists reduced motion among the modes that keep the auto-advance pacing', () => {
    const section = uxSection(GATE_SECTION);
    // The pre-fix scope sentence (reduced motion grouped with the ungated
    // modes) must not creep back.
    expect(section).not.toContain('reduced motion, the tutorial, replay/headless');
    // Tutorial / replay / competitive remain ungated and must still be named.
    expect(section).toContain('the tutorial, replay/headless');
    expect(section).toContain('competitive closings never present it');
  });

  it('points at the suites that pin the gate, and those suites exist', () => {
    const section = uxSection(GATE_SECTION);
    expect(section).toContain('guard matrix');
    expect(section).toContain('reduced-motion end-of-turn');

    // Link integrity: a named suite that no longer exists is dead guidance.
    for (const suite of [
      'tests/main-street/turn-summary-gate.test.ts',
      'tests/main-street/turn-summary-dialog.browser.test.ts',
    ]) {
      expect(section).toContain(suite);
      expect(fs.existsSync(path.join(PROJECT_ROOT, suite)), `${suite} is missing`).toBe(true);
    }
  });
});

/**
 * The Accessibility section is where a reader looks up "what does Reduced
 * Motion do?". Listing only the two skipped animation families reads as
 * "reduced motion suppresses the closing feedback" — the very assumption
 * behind the bug this work item fixes.
 */
describe('Reduced motion accessibility documentation — ux-visual-audio.md', () => {
  it('states that dialogs are never suppressed, naming the Turn Summary gate', () => {
    const section = uxSection('### Reduced motion');
    expect(section).toContain('dialogs are never suppressed');
    expect(section).toContain('turn summary');
    expect(section).toContain('[ next turn ]');
    // The distinction the fix rests on: animation vs information.
    expect(section).toContain('removes animation, not information');
  });
});

describe('Turn Summary gate documentation — docs/dev/testing.md', () => {
  it('tells browser-test authors that a reduced-motion end-of-turn is gated', () => {
    const section = testingGatesSection();
    expect(section).toContain('reduced motion is gated');
    // The actionable rule, not just the fact: dismiss the dialog.
    expect(section).toContain('reduced-motion end-of-turn test must dismiss the dialog');
  });

  it('no longer claims reduced motion keeps the auto-advance pacing', () => {
    const section = testingGatesSection();
    expect(section).not.toContain(
      'reduced-motion, tutorial, replay/headless and competitive closings are never gated',
    );
    // The genuinely ungated modes stay documented.
    expect(section).toContain('tutorial, replay/headless and competitive closings are never gated');
  });
});
