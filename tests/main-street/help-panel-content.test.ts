/**
 * Tests for the Main Street Help/Rules panel content.
 *
 * Asserts against the real production content exported by
 * `src/MainStreetHelpContent.ts` (consumed by the help panel), so the copy
 * cannot silently drift behind a private mirror (test-review C5).
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import {
  buildMainStreetHelpContent,
  REQUIRED_HELP_SECTION_HEADINGS,
  SYNERGY_HELP_ICONS,
  type HelpSectionContent,
} from '../../src/MainStreetHelpContent';

const CFG = { winThreshold: 120, challengesPerRun: 3 };
const helpContent = buildMainStreetHelpContent(CFG);

/** The author-controlled text of a section (body or custom-render paragraph). */
function bodyOf(section: HelpSectionContent): string {
  return section.body ?? section.synergyParagraph ?? '';
}

/** Collapses hard line breaks so phrase checks are wrap-insensitive. */
function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Counts author-controlled (newline-delimited) lines. The PRD's "<= 8 lines"
 * refers to author lines, not display word-wrapping which depends on panel
 * width.
 */
function countLines(body: string): number {
  return body.split('\n').filter((l) => l.trim().length > 0).length;
}

/**
 * PRD milestone 5 §6 targets `<= 8 lines` per section "where possible". Two
 * sections carry post-PRD mechanics copy and exceed that target; the ceilings
 * below guard against further growth while acknowledging the current content.
 * (Pre-existing help-content drift, recorded in MS-0MUMO3BDE000QDXJ.)
 */
const LINE_CEILINGS: Record<string, number> = {
  'How to Play': 11,
  'Turn Flow': 13,
};
const DEFAULT_LINE_CEILING = 8;

describe('Help/Rules panel content (PRD milestone 5)', () => {
  // ── Required Section Headings ──────────────────────────────

  it('contains all PRD-required section headings', () => {
    const headings = helpContent.map((s) => s.heading);
    for (const required of REQUIRED_HELP_SECTION_HEADINGS) {
      expect(headings).toContain(required);
    }
  });

  it('keeps the PRD-required headings in their relative order', () => {
    const requiredInOrder = helpContent
      .map((s) => s.heading)
      .filter((h) =>
        (REQUIRED_HELP_SECTION_HEADINGS as readonly string[]).includes(h),
      );
    expect(requiredInOrder).toEqual([...REQUIRED_HELP_SECTION_HEADINGS]);
  });

  it('documents the post-PRD Staff & Specialization Skills section', () => {
    expect(helpContent.map((s) => s.heading)).toContain('Staff & Specialization Skills');
  });

  it('gives every section non-empty content', () => {
    for (const section of helpContent) {
      expect(bodyOf(section).trim().length).toBeGreaterThan(0);
    }
  });

  // ── Line-Count Guardrails ─────────────────────────────────

  it.each(helpContent)('"$heading" stays within its line budget', (section) => {
    const ceiling = LINE_CEILINGS[section.heading] ?? DEFAULT_LINE_CEILING;
    expect(countLines(bodyOf(section))).toBeLessThanOrEqual(ceiling);
  });

  // ── English-Only Copy ─────────────────────────────────────

  it('all section text is English-only (no CJK, Cyrillic, etc.)', () => {
    const nonLatinRegex = /[\u4e00-\u9fff\u3040-\u30ff\u0400-\u04ff]/;
    for (const section of helpContent) {
      expect(nonLatinRegex.test(bodyOf(section))).toBe(false);
    }
  });

  // ── Content Quality ───────────────────────────────────────

  it('"Synergy and Placement" lists every synergy type', () => {
    expect(SYNERGY_HELP_ICONS.map((i) => i.label)).toEqual([
      'Food',
      'Culture',
      'Commerce',
      'Service',
      'Entertainment',
    ]);
  });

  it('"How to Play" mentions businesses, street, and score', () => {
    const body = normalise(bodyOf(helpContent.find((s) => s.heading === 'How to Play')!));
    expect(body).toContain('business');
    expect(body).toContain('street');
    expect(body).toContain('score');
  });

  it('"Card Types" mentions business, upgrade, event, and incident', () => {
    const body = normalise(bodyOf(helpContent.find((s) => s.heading === 'Card Types')!));
    expect(body).toContain('business');
    expect(body).toContain('upgrade');
    expect(body).toContain('event');
    expect(body).toContain('incident');
  });

  it('"Synergy and Placement" mentions adjacent and bonus', () => {
    const body = normalise(bodyOf(helpContent.find((s) => s.heading === 'Synergy and Placement')!));
    expect(body).toContain('adjacent');
    expect(body).toContain('bonus');
  });

  it('"Turn Flow" documents the weekly action economy', () => {
    const body = normalise(bodyOf(helpContent.find((s) => s.heading === 'Turn Flow')!));
    // One action per week, plus one per action-granting staff (Manager,
    // Director, General Manager); take-to-hand and play/place each cost 1
    // action, with a 1-action same-week composite.
    expect(body).toContain('end turn');
    expect(body).toContain('action-granting staff');
    expect(body).toContain('general manager');
    expect(body).toContain('manager');
    expect(body).toContain('director');
    expect(body).toContain('taking a card to hand costs 1 action');
    expect(body).toContain('same-week move + play/place pair costs 1 action total');
    // Cost-at-play is preserved: coins are not charged on take-to-hand.
    expect(body).toContain('not when taken to hand');
  });

  it('"Win / Loss Conditions" mentions bankruptcy and reputation', () => {
    const body = normalise(
      bodyOf(helpContent.find((s) => s.heading === 'Win / Loss Conditions')!),
    );
    expect(body).toContain('bankruptcy');
    expect(body).toContain('reputation');
    expect(body).toContain(String(CFG.winThreshold));
  });

  it('"Tools" mentions hint, undo, and research', () => {
    const body = normalise(bodyOf(helpContent.find((s) => s.heading === 'Tools')!));
    expect(body).toContain('hint');
    expect(body).toContain('undo');
    expect(body).toContain('research');
  });
});
