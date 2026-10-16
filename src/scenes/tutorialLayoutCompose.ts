/**
 * Tutorial layout composition for the Main Street tutorial overlay
 * (MS-0MV26MOWT004ZCQC).
 *
 * The tutorial highlight overlay resolves its zone rects by composing the base
 * shell layout with the scene-specific tutorial layout under the `sceneWins`
 * policy. Composition reports every zone-name collision as a developer
 * warning; the tutorial intentionally reuses `hand`, `endTurnButton` and
 * `incidentQueue`, so this module funnels every composition through
 * `reportTutorialLayoutIssue` — the documented overrides stay quiet while any
 * unexpected diagnostic is still surfaced.
 *
 * Pure (Phaser-free), so the boot-path resolution can be asserted directly by
 * unit tests without a browser.
 *
 * @module
 */

import { composeResolvedLayouts } from '@ui/screen-layout-compose';
import { parseScreenLayoutDocument } from '@ui/screen-layout-schema';
import { type LayoutViewport } from '@ui/screen-layout';

import baseLayout from '../layouts/main-street.layout.json';
import tutorialLayout from '../layouts/main-street-tutorial.layout.json';
import { reportTutorialLayoutIssue } from './tutorialLayoutIssues';

const baseParsed = parseScreenLayoutDocument(baseLayout);
if (!baseParsed.valid) {
  throw new Error(
    `Base layout is invalid: ${baseParsed.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
  );
}

const tutorialParsed = parseScreenLayoutDocument(tutorialLayout);
if (!tutorialParsed.valid) {
  throw new Error(
    `Tutorial layout is invalid: ${tutorialLayout ? tutorialLayout.id : '(unknown)'}: ${tutorialParsed.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
  );
}

/** The parsed base shell layout document. */
export const BASE_LAYOUT = baseParsed.layout;

/** The parsed tutorial scene layout document. */
export const TUTORIAL_LAYOUT = tutorialParsed.layout;

/**
 * Compose the base shell and tutorial layouts at the pixel layer.
 *
 * `sceneWins` keeps the documented tutorial overrides (`hand`,
 * `endTurnButton`, `incidentQueue`) in charge, and {@link reportTutorialLayoutIssue}
 * keeps those known collisions quiet while re-emitting everything else.
 */
export function composeTutorialLayout(
  viewport: LayoutViewport,
  dpr = 1,
): ReturnType<typeof composeResolvedLayouts> {
  return composeResolvedLayouts(
    BASE_LAYOUT,
    TUTORIAL_LAYOUT,
    viewport,
    dpr,
    { policy: 'sceneWins', reportIssue: reportTutorialLayoutIssue },
  );
}
