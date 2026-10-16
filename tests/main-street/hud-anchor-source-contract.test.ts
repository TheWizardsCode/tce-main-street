/**
 * Main Street: HUD flight destination anchor source contract
 * (MS-0MUYT57J80021CWW AC2).
 *
 * The HUD render publishes one live anchor for the coin number and one for
 * the reputation number (`scene.hudCoinAnchor` / `scene.hudRepAnchor`);
 * every coin/reputation → HUD flight consumes those anchors through
 * `hudFlightTarget`. The legacy approximate coordinates (`gameW * 0.25 + 70`
 * for coins, `gameW * 0.5` for reputation) must exist in exactly ONE place —
 * the central fallback helpers `hudCoinFallback` / `hudRepFallback` in
 * `MainStreetConstants.ts`, used only before the first HUD render.
 *
 * This guard asserts that no HUD-flight destination literal remains in
 * `src/scenes/MainStreetAnimator*` — mirroring the repository's existing
 * source-contract guards (e.g. `terminology-guard.test.ts`). The two
 * documented NON-HUD `gameW * 0.5` uses are exempt: the `upcomingSource`
 * queue origin (`runIncomePhase`) and the centred phase label
 * (`showIncomePhaseLabel`).
 *
 * Behavioural coverage of the anchors themselves lives in
 * `hud-strip-layout.browser.test.ts` and the animator unit tests; this test
 * only enforces the structural AC2 property.
 *
 * @module tests/main-street/hud-anchor-source-contract
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

/** All `MainStreetAnimator*.ts` files (the AC2 literal-ban scope). */
function animatorFiles(): string[] {
  const dir = path.join(PROJECT_ROOT, 'src/scenes');
  return fs
    .readdirSync(dir)
    .filter((f) => /^MainStreetAnimator.+\.ts$/.test(f))
    .map((f) => path.join(dir, f))
    .sort();
}

/** Nearest enclosing `function` (or `export function`) name for a line. */
function enclosingFunction(lines: string[], index: number): string {
  for (let i = index; i >= 0; i--) {
    const m = /^(?:export\s+)?function\s+([A-Za-z0-9_]+)/.exec(lines[i]);
    if (m) return m[1];
  }
  return '';
}

const QUARTER_RE = /gameW\s*\*\s*0\.25/;
const HALF_RE = /gameW\s*\*\s*0\.5/;
/** The two documented NON-HUD `gameW * 0.5` uses (queue origin + phase label). */
const NON_HUD_EXEMPT_FNS = new Set(['runIncomePhase', 'showIncomePhaseLabel']);

describe('HUD flight destination anchor contract (MS-0MUYT57J80021CWW AC2)', () => {
  it('centralises the legacy fallback coordinates in MainStreetConstants and leaves no HUD-flight destination literals in the animators', () => {
    // The fallback live in exactly one place: the constants module.
    const constants = fs.readFileSync(
      path.join(PROJECT_ROOT, 'src/scenes/MainStreetConstants.ts'),
      'utf-8',
    );
    expect(constants).toContain('hudCoinFallback');
    expect(constants).toContain('hudRepFallback');
    expect(constants).toMatch(/gameW \* 0\.25 \+ 70/);
    expect(constants).toMatch(/gameW \* 0\.5/);

    const violations: string[] = [];
    for (const file of animatorFiles()) {
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        const offenders: string[] = [];
        if (QUARTER_RE.test(line)) offenders.push(`gameW * 0.25`);
        if (HALF_RE.test(line)) {
          const fn = enclosingFunction(lines, i);
          if (!NON_HUD_EXEMPT_FNS.has(fn)) {
            offenders.push(`gameW * 0.5 (enclosing ${fn || '<top-level>'}, non-exempt)`);
          }
        }
        for (const offender of offenders) {
          violations.push(`${path.basename(file)}:${i + 1} — ${line.trim()} (${offender})`);
        }
      });
    }
    expect(violations, `HUD-flight destination literals remaining in animators:\n${violations.join('\n')}`).toEqual([]);
  });

  it('routes every animator HUD destination through hudFlightTarget (the published-anchor consumer)', () => {
    const files = animatorFiles().filter((f) => !f.endsWith('Context.ts'));
    const lines = files.flatMap((f) => fs.readFileSync(f, 'utf-8').split('\n'));
    expect(lines.some((l) => l.includes('hudFlightTarget'))).toBe(true);
    // No animator may reach for the anchor raw fields without the shared
    // resolution helper's fallback semantics... except the incident reveal
    // which builds the bubble params directly from the resolved targets.
    const directReads = lines.filter((l) => /hudCoinAnchor|hudRepAnchor/.test(l));
    expect(directReads).toEqual([]);
  });
});
