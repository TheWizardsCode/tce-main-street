/**
 * Tutorial layout-composition issue reporting (MS-0MV26MOWT004ZCQC).
 *
 * The tutorial layout (`main-street-tutorial.layout.json`) deliberately
 * overrides three base shell zones — `hand`, `endTurnButton` and
 * `incidentQueue` — under the `sceneWins` policy. This is the documented
 * alignment contract in `MainStreetTutorialHints.ts`: the tutorial zone rects
 * are the source of truth for the highlight overlay, and the naming reuse is
 * intentional.
 *
 * `composeResolvedLayouts()` treats every name collision as a developer
 * warning, so resolving the tutorial emitted three benign `Zone collision …`
 * warnings on every call and drowned out genuine diagnostics. This module
 * supplies the `reportIssue` hook that keeps the documented intentional
 * collisions quiet while still surfacing anything unexpected — the detection
 * itself is preserved, only the known noise is suppressed.
 *
 * @module
 */

import type { ComposeResolvedLayoutsIssue } from '@ui/screen-layout-compose';

/**
 * Zone names the tutorial layout deliberately overrides from the base shell
 * under the `sceneWins` policy.
 *
 * Kept in sync with the alignment-contract comment in
 * `MainStreetTutorialHints.ts`; the tutorial rects are the source of truth for
 * these tutorial highlights. Verified against both layout documents by
 * `tests/main-street/tutorial-console-cleanliness.test.ts`.
 */
export const TUTORIAL_INTENTIONAL_OVERRIDE_ZONES: ReadonlySet<string> = new Set([
  'hand',
  'endTurnButton',
  'incidentQueue',
]);

/**
 * Whether an issue is an expected collision from a documented tutorial
 * override zone (and therefore safe to keep quiet).
 */
export function isIntentionalTutorialOverride(
  issue: ComposeResolvedLayoutsIssue,
): boolean {
  return (
    issue.code === 'ZONE_COLLISION' &&
    typeof issue.zoneName === 'string' &&
    TUTORIAL_INTENTIONAL_OVERRIDE_ZONES.has(issue.zoneName)
  );
}

/**
 * `reportIssue` hook for the tutorial's `composeResolvedLayouts()` calls.
 *
 * Documented override collisions are ignored. Every other issue — a validation
 * error, a namespace collision, or a zone collision outside the documented
 * override set — is re-emitted to the console exactly as the composer's
 * default reporter would, so unexpected diagnostics stay visible.
 */
export function reportTutorialLayoutIssue(
  issue: ComposeResolvedLayoutsIssue,
): void {
  if (isIntentionalTutorialOverride(issue)) return;

  const log = issue.severity === 'error' ? console.error : console.warn;
  log(issue.message);
}
