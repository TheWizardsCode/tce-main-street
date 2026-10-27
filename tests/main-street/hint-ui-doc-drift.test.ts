/**
 * Hint-UI documentation drift guard (MS-0MVPWQO3B008B574, parent AC5/AC9).
 *
 * The shipped game no longer has a hint subsystem: `MainStreetHint.ts`, the
 * Hint button/bar and the persistent instruction line were removed
 * (MS-0MVPWQLIH008R5M3 / MS-0MVPWQK3U003DIR6). Feedback routes through the
 * transient pop-text channel (`MainStreetFeedback.ts`) and the hand renders on
 * an opaque panel behind the capacity row (MS-0MVPWQIPZ002PHPD).
 *
 * This guard enforces two contracts:
 *
 *   1. **No stale hint-UI references** — the production docs (`docs/`,
 *      `src/`, root `README.md`) must not refer to the removed symbols as
 *      if they still existed. Deliberate *tombstone* mentions (removal
 *      documentation that says the symbol is gone) are allowed; the guard
 *      requires every occurrence of a forbidden token to sit on a line
 *      carrying an explicit removal marker ("removed", "no longer",
 *      "withdrawn", "superseded", "design intent …", "nothing —"). Historical
 *      planning records (`docs/dev/prd-milestone-*.md`) are excluded exactly
 *      as AC5's "historical CHANGELOG/dev-log entries excluded" carve-out
 *      intends — they are dated, already-bannered historical design docs.
 *
 *   2. **Docs match the shipped values** — the documented panel treatment
 *      (fill `0x1a1408` @ 0.85, 1 px `0x665544` border, `BOX_RADIUS`), the
 *      bottom-anchored hand and the feedback API are asserted against the
 *      shipped constants/layout so the docs cannot drift from the code.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BOX_RADIUS,
  BOX_STROKE,
  HAND_PANEL_DEPTH,
  HAND_PANEL_NAME,
  PANEL_FILL,
  PANEL_FILL_ALPHA,
  PANEL_STROKE_ALPHA,
} from '../../src/scenes/MainStreetConstants';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DOCS_ROOT = path.join(PROJECT_ROOT, 'docs');
const SRC_ROOT = path.join(PROJECT_ROOT, 'src');
const ROOT_README = path.join(PROJECT_ROOT, 'README.md');

/** Removed hint-UI symbols that must not be referenced as live features. */
const FORBIDDEN_TOKENS = [
  'hint bar',
  'HintBar',
  'instructionText',
  'instructionY',
  'hintButtonW',
  'Hint button',
  'MainStreetHint',
];

/**
 * Explicit removal markers. Every occurrence of a forbidden token must share
 * its line with one of these, so tombstone documentation ("X was removed")
 * passes while any live-feature reference fails.
 */
const REMOVAL_MARKERS =
  /removed|no longer|withdrawn|superseded|design intent|design-intent|not (currently )?surfaced|nothing —/i;

/** Historical planning records — AC5's historical carve-out. */
function isHistoricalPrd(file: string): boolean {
  return /prd-milestone-[^/]+\.md$/.test(path.basename(file));
}

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.json', '.ts', '.js', '.mjs', '.mmd', '.svg', '.txt', '.yaml', '.yml']);

function isTextFile(file: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(file).toLowerCase());
}

/** Recursively yield every text file under `dir`. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      // Generated docs-site artefacts — never documentation source.
      if (/[\\/]\.vitepress[\\/](dist|cache)$/.test(full)) continue;
      out.push(...walk(full));
    } else if (isTextFile(full)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every file the stale-symbol scan covers: `docs/` (excluding the historical
 * milestone PRDs), `src/` (source, READMEs) and the root `README.md`.
 */
function scannedFiles(): string[] {
  return [
    ...walk(DOCS_ROOT).filter((f) => !isHistoricalPrd(f)),
    ...walk(SRC_ROOT),
    ROOT_README,
  ];
}

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

/** Whitespace-normalised read: phrase assertions are line-wrap tolerant.
 * Markdown blockquote markers are stripped too, so a multi-line status note
 * reads as one continuous sentence.
 */
function norm(file: string): string {
  return read(file)
    .replace(/^\s*>\s?/gm, '')
    .replace(/\s+/g, ' ');
}

describe('AC5/AC4 — no stale hint-UI references in current docs', () => {
  it('finds at least one scanned file (guards the scan)', () => {
    expect(scannedFiles().length).toBeGreaterThan(50);
  });

  const violations = scannedFiles()
    .map((file) => ({ file, lines: read(file).split('\n') }))
    .flatMap(({ file, lines }) =>
      lines
        .map((line, i) => ({ line, index: i }))
        .filter(({ line }) => {
          const lower = line.toLowerCase();
          return FORBIDDEN_TOKENS.some((token) => lower.includes(token.toLowerCase()));
        })
        .filter(({ line }) => !REMOVAL_MARKERS.test(line))
        .map(({ line, index }) => ({ file, index: index + 1, line })),
    );

  it('bans every forbidden symbol outside an explicit removal marker', () => {
    // Rendered as `file:line: text` so a failure names the stale reference.
    const rendered = violations.map(
      (v) => `${path.relative(PROJECT_ROOT, v.file)}:${v.index}: ${v.line.trim()}`,
    );
    expect(rendered).toEqual([]);
  });
});

describe('AC1 — documented panel treatment matches the shipped constants', () => {
  const hex = (v: number): string => `0x${v.toString(16)}`;

  it('documents the shared opaque treatment with the constant-derived values', () => {
    const doc = read(path.join(DOCS_ROOT, 'game/ux-visual-audio.md'));
    const fillHex = hex(PANEL_FILL);
    const strokeHex = hex(BOX_STROKE);
    expect(fillHex).toBe('0x1a1408');
    expect(strokeHex).toBe('0x665544');
    expect(String(PANEL_FILL_ALPHA)).toBe('0.85');
    expect(String(PANEL_STROKE_ALPHA)).toBe('0.5');

    // Every shipped value named in the ux doc — if a constant changes, the doc
    // must be updated or this guard fails.
    expect(doc).toContain(fillHex);
    expect(doc).toContain(strokeHex);
    expect(doc).toContain(String(PANEL_FILL_ALPHA));
    expect(doc).toContain(`${BOX_RADIUS} px`);
    expect(doc).toContain('PANEL_FILL');
    expect(doc).toContain('PANEL_FILL_ALPHA');
  });

  it('documents the hand panel contract from the shipped constants', () => {
    const doc = read(path.join(DOCS_ROOT, 'game/ux-visual-audio.md'));
    const readme = read(path.join(SRC_ROOT, 'README.md'));
    expect(doc).toContain(HAND_PANEL_NAME); // `ms-hand-panel`
    expect(doc).toContain(HAND_PANEL_DEPTH.toString(10)); // -100
    expect(readme).toContain(HAND_PANEL_NAME);
    expect(readme).toContain(HAND_PANEL_DEPTH.toString(10));
  });
});

describe('AC4/AC5 — docs describe the bottom-anchored hand', () => {
  it('keeps the SLL hand zone in the viewport-bottom band', () => {
    const layout = JSON.parse(
      read(path.join(SRC_ROOT, 'layouts/main-street.layout.json')),
    ) as {
      zones: { hand: { anchors: { topLeft: { y: number } } } };
    };
    const handY = layout.zones.hand.anchors.topLeft.y;
    // Bottom band of the viewport (0.8+ of the 0..1 height), leaving room for
    // the action row below/around it.
    expect(handY).toBeGreaterThanOrEqual(0.8);
  });

  it('names the bottom anchoring and its own action-row anchor in the docs', () => {
    const doc = norm(path.join(DOCS_ROOT, 'game/ux-visual-audio.md'));
    expect(doc).toMatch(/bottom-anchored hand/i);
    expect(doc).toContain('main-street.layout.json');
    expect(doc).toMatch(/actionRow/i);
  });
});

describe('AC2/AC3 — hint feature documented as design intent only', () => {
  it('GDD § AI Strategy and Hint System states the hint feature is not surfaced', () => {
    const gdd = norm(path.join(DOCS_ROOT, 'game/the-build-gdd.md'));
    expect(gdd).toMatch(/design intent only/i);
    expect(gdd).toMatch(/not currently surfaced/i);
  });

  it('docs/dev/ai-strategy.md carries the no-shipped-consumer status note', () => {
    const dev = norm(path.join(DOCS_ROOT, 'dev/ai-strategy.md'));
    expect(dev).toMatch(/no shipped hint consumer/i);
    expect(dev).toMatch(/removed/i);
  });
});

describe('AC4 — feedback channel documented against the real API', () => {
  it('names the transient feedback entry points in the docs', () => {
    const doc = norm(path.join(DOCS_ROOT, 'game/ux-visual-audio.md'));
    const scenesReadme = norm(path.join(SRC_ROOT, 'scenes/README.md'));
    expect(doc).toContain('flashFeedback');
    expect(doc).toContain('flashError');
    expect(scenesReadme).toContain('flashFeedback');
  });

  it('documents the error/confirmation-pop, guidance/progress-drop taxonomy', () => {
    const doc = norm(path.join(DOCS_ROOT, 'game/ux-visual-audio.md'));
    expect(doc).toMatch(/error/);
    expect(doc).toMatch(/confirmation/);
    expect(doc).toMatch(/guidance/);
    expect(doc).toMatch(/progress/);
    expect(doc).toMatch(/dropped/i);
  });
});
