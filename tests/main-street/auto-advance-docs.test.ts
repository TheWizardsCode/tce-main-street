/**
 * Auto advance turn documentation drift guard (MS-0MW3O2P3H008QT0H).
 *
 * The **Auto advance turn** feature (parent MS-0MW1ZDI8Z006GPFY) is
 * player-visible only through its documentation: its default, persistence
 * key and behaviour live in `docs/game/ux-visual-audio.md` (settings toggle
 * inventory), `docs/game/core-rules-and-mechanics.md` §6.0 (action economy)
 * and the README. This guard pins those shipped claims to the shipped code
 * the way the sibling documentation guards pin their slices
 * (`loan-docs.test.ts`, `investor-docs.test.ts`): the documented default /
 * storage key must match the actual `MainStreetPrefs` preference, and the
 * documented out-of-actions behaviour must describe both branches (auto
 * end-turn vs the explainer dialog).
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { AUTO_ADVANCE_TURN_KEY } from '../../src/MainStreetPrefs';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const UX_DOC = path.join(PROJECT_ROOT, 'docs/game/ux-visual-audio.md');
const CORE_RULES = path.join(PROJECT_ROOT, 'docs/game/core-rules-and-mechanics.md');
const README = path.join(PROJECT_ROOT, 'README.md');

/** Collapses hard line breaks, strips blockquote markers and Markdown emphasis/code markers. */
function normalise(text: string): string {
  return text
    .replace(/[`*>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The body of a `### <heading>` section, stopped at the next heading. */
function markdownSection(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  expect(start, `documentation has no "${heading}" section`).toBeGreaterThanOrEqual(0);
  const rest = doc.slice(start + heading.length);
  const nextHeading = rest.search(/^#{2,3}\s/m);
  const end = nextHeading === -1 ? rest.length : nextHeading;
  return rest.slice(0, end);
}

describe('Auto advance turn documentation — ux-visual-audio.md settings toggle inventory', () => {
  it('has a Settings toggles section that inventories the Auto advance turn toggle', () => {
    const doc = normalise(fs.readFileSync(UX_DOC, 'utf-8'));
    expect(doc).toContain('settings toggles');
    expect(doc).toContain('auto advance turn');
    // The toggle page is a real `### Auto advance turn` section.
    expect(fs.readFileSync(UX_DOC, 'utf-8')).toContain('### Auto advance turn');
  });

  it('documents the stored default as off', () => {
    const section = normalise(markdownSection(fs.readFileSync(UX_DOC, 'utf-8'), '### Auto advance turn'));
    expect(section).toContain('default: off');
    expect(section).toContain('default');
  });

  it('documents the persistence location matching the shipped preference key', () => {
    const section = normalise(markdownSection(fs.readFileSync(UX_DOC, 'utf-8'), '### Auto advance turn'));
    expect(section).toContain(AUTO_ADVANCE_TURN_KEY.toLowerCase());
    expect(section).toContain('localstorage');
    expect(section).toContain('mainstreetprefs');
  });

  it('documents both behaviour branches (auto end-turn and the explainer dialog)', () => {
    const section = normalise(markdownSection(fs.readFileSync(UX_DOC, 'utf-8'), '### Auto advance turn'));
    // On: identical End Turn code path.
    expect(section).toContain('end turn');
    // Off: the out-of-actions explainer dialog with its End Turn path.
    expect(section).toContain('no actions left');
    // The dialog's enable checkbox persists the preference immediately.
    expect(section).toContain('checkbox');
  });

  it('documents the once-per-turn latch and the mode guards', () => {
    const section = normalise(markdownSection(fs.readFileSync(UX_DOC, 'utf-8'), '### Auto advance turn'));
    expect(section).toContain('at most once per turn');
    expect(section).toContain('tutorial');
  });
});

describe('Auto advance turn documentation — core-rules-and-mechanics.md §6.0', () => {
  it('documents the out-of-actions behaviour in the action economy section', () => {
    const doc = fs.readFileSync(CORE_RULES, 'utf-8');
    const section = normalise(markdownSection(doc, '### 6.0 Action Economy (weekly action budget)'));
    expect(section).toContain('auto advance turn');
    expect(section).toContain('last action point');
    expect(section).toContain('end turn');
  });

  it('documents both branches and the guards in the action economy section', () => {
    const doc = fs.readFileSync(CORE_RULES, 'utf-8');
    const section = normalise(markdownSection(doc, '### 6.0 Action Economy (weekly action budget)'));
    expect(section).toContain('no actions left');
    expect(section).toContain('automatically');
    expect(section).toContain('localstorage');
    expect(section).toContain(AUTO_ADVANCE_TURN_KEY.toLowerCase());
    expect(section).toContain('default');
  });
});

describe('Auto advance turn documentation — README', () => {
  it('documents the setting in the README', () => {
    const readme = normalise(fs.readFileSync(README, 'utf-8'));
    expect(readme).toContain('auto advance turn');
  });
});
