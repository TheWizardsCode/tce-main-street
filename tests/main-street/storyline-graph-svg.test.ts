/**
 * Storyline graph per-page SVG render + drift guard (MS-0MUNB54KU005084C).
 *
 * Reopened scope: the combined graph was unreadable (71 nodes, 60 isolated,
 * laid out in one ~13,000px row). The render now emits one diagram per
 * storyline (one parent box per page) plus a compact standalone-incident
 * index.
 *
 * AC7 — Per-storyline pages: one committed SVG per storyline, each readable
 *       and scoped to that storyline's cards.
 * AC8 — Standalone-incident index: the non-storyline incidents are listed in a
 *       committed index/table (not boxes), drift-guarded against the manifest.
 * AC2/AC4 — Determinism and drift: re-rendering the pages reproduces the
 *       committed SVGs byte-for-byte; the render is deterministic.
 *
 * The renderer (`mermaid` + Playwright Chromium) is a devDependency only.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildStorylinePages,
  INCIDENT_INDEX_PATH,
  renderMermaidBatch,
} from '../../src/scripts/render-storyline-graph';
import {
  buildStandaloneIncidentIndex,
  buildStorylineManifest,
  renderIncidentIndexMarkdown,
} from '../../src/scripts/storyline-graph';
import { getEventTemplates } from '../../src/MainStreetCards';

const PROJECT_ROOT = resolve(__dirname, '../..');
const DOC_PATH = resolve(PROJECT_ROOT, 'docs/main-street/storylines.md');
const INCIDENT_INDEX_FILE = resolve(PROJECT_ROOT, INCIDENT_INDEX_PATH);

const EXPECTED_SLUGS = ['economy', 'health', 'labor', 'restaurant', 'tax'];

function readSvg(slug: string): string {
  return readFileSync(resolve(PROJECT_ROOT, `docs/main-street/storyline-graph-${slug}.svg`), 'utf-8');
}

function svgViewBoxWidth(svg: string): number {
  const match = svg.match(/viewBox="0 0 ([\d.]+) /);
  if (!match) throw new Error('SVG has no viewBox');
  return Number.parseFloat(match[1]);
}

describe('AC7 — one diagram per storyline, scoped and readable', () => {
  it('builds exactly one page per storyline with a stable slug and title', () => {
    const pages = buildStorylinePages();
    expect(pages.map((page) => page.slug)).toEqual(EXPECTED_SLUGS);
    const titles = Object.fromEntries(pages.map((page) => [page.slug, page.title]));
    expect(titles.tax).toBe('Tax Troubles');
    expect(titles.health).toBe('Public Health Crisis');
    expect(titles.economy).toBe('Economic Downturn');
    expect(titles.labor).toBe('Labour Unrest');
    expect(titles.restaurant).toBe('Restaurant Renaissance');
  });

  it('each page scopes its Mermaid source to that storyline only', () => {
    const bySlug = Object.fromEntries(buildStorylinePages().map((page) => [page.slug, page.mermaid]));
    // Tax page carries the whole tax cycle and nothing from other storylines.
    expect(bySlug.tax).toContain('evt_tax');
    expect(bySlug.tax).toContain('evt_tax_error');
    expect(bySlug.tax).toContain('evt_tax_inquiry');
    expect(bySlug.tax).not.toContain('evt_flu_outbreak');
    expect(bySlug.tax).not.toContain('evt_art_sale');
    // Health page carries the flu chain only.
    expect(bySlug.health).toContain('evt_flu_outbreak');
    expect(bySlug.health).toContain('evt_pandemic');
    expect(bySlug.health).not.toContain('evt_tax');
  });

  it('every page is committed as a well-formed SVG carrying its card labels', () => {
    for (const slug of EXPECTED_SLUGS) {
      const path = resolve(PROJECT_ROOT, `docs/main-street/storyline-graph-${slug}.svg`);
      expect(existsSync(path), `missing ${path}`).toBe(true);
      const svg = readSvg(slug);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    }
    expect(readSvg('tax')).toContain('Tax Audit');
    expect(readSvg('tax')).toContain('Inquiry Commission');
    expect(readSvg('health')).toContain('Flu Outbreak');
    expect(readSvg('health')).toContain('Pandemic');
  });

  it('each page is readable (bounded width) rather than the old 13,000px strip', () => {
    for (const slug of EXPECTED_SLUGS) {
      const width = svgViewBoxWidth(readSvg(slug));
      expect(width, `${slug} page is too wide to read`).toBeLessThan(1000);
    }
  });

  it('the canonical doc embeds every page and no longer embeds the combined SVG', () => {
    const doc = readFileSync(DOC_PATH, 'utf-8');
    for (const slug of EXPECTED_SLUGS) {
      expect(doc, `doc missing embed for ${slug}`).toContain(`./storyline-graph-${slug}.svg`);
    }
    expect(doc).not.toContain('./storyline-graph.svg)');
  });
});

describe('AC8 — standalone incidents are a compact index, not boxes', () => {
  it('indexes every non-storyline incident and no storyline card', () => {
    const manifest = buildStorylineManifest(getEventTemplates());
    const incidents = buildStandaloneIncidentIndex(manifest);
    expect(incidents.length).toBe(60);
    const ids = incidents.map((incident) => incident.id);
    expect(ids).toContain('evt-art-sale');
    expect(ids).not.toContain('evt-tax');
    expect(ids).not.toContain('evt-pandemic');
  });

  it('the committed index matches the manifest and is linked from the doc', () => {
    const manifest = buildStorylineManifest(getEventTemplates());
    const expected = renderIncidentIndexMarkdown(buildStandaloneIncidentIndex(manifest));
    expect(existsSync(INCIDENT_INDEX_FILE)).toBe(true);
    expect(readFileSync(INCIDENT_INDEX_FILE, 'utf-8')).toBe(expected);
    expect(readFileSync(DOC_PATH, 'utf-8')).toContain('./storyline-incident-index.md');
  });
});

describe('AC2/AC4 — committed pages match a re-render and the render is deterministic', () => {
  it('re-rendering reproduces every committed SVG byte-for-byte, deterministically', async () => {
    const pages = buildStorylinePages();
    const sources = Object.fromEntries(pages.map((page) => [page.slug, page.mermaid]));

    const first = await renderMermaidBatch(sources);
    const second = await renderMermaidBatch(sources);

    for (const page of pages) {
      const committed = readFileSync(resolve(PROJECT_ROOT, page.svgRelPath), 'utf-8');
      expect(first[page.slug], `drift in ${page.svgRelPath}`).toBe(committed);
      expect(second[page.slug], `non-deterministic render for ${page.slug}`).toBe(first[page.slug]);
    }
  }, 120_000);
});
