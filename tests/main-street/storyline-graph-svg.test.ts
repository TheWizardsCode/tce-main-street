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
 * AC10 — Event detail data: the manifest exposes each event's description,
 *       trigger, tier, target, deltas (incl. proportional) and duration fields,
 *       and the option effect policy.
 * AC11 — Per-event detail tables: a generated table below each diagram.
 * AC12 — Drift guard: the committed tables match the regenerated ones.
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
  spliceGeneratedDetails,
} from '../../src/scripts/render-storyline-graph';
import {
  buildStandaloneIncidentIndex,
  buildStorylineManifest,
  describeEventImpact,
  renderIncidentIndexMarkdown,
  renderStorylineDetailsMarkdown,
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

describe('AC10 — the manifest exposes per-event detail', () => {
  const manifest = () => buildStorylineManifest(getEventTemplates());

  it('carries description, trigger, tier, target and proportional-coin fields', () => {
    const tax = manifest().nodes.find((node) => node.id === 'evt-tax')!;
    expect(tax.effect).toBe('Lose 45% of your banked coins.');
    expect(tax.trigger).toBe('Incident');
    expect(tax.tier).toBe(1);
    expect(tax.coinPercentDelta).toBeCloseTo(-0.45);
    expect(tax.coinDelta).toBe(-300);

    const strike = manifest().nodes.find((node) => node.id === 'evt-strike-service')!;
    expect(strike.target).toBe('SpecificSynergy');
    expect(strike.targetSynergy).toBe('Service');
  });

  it('carries duration fields for duration-based events', () => {
    const flu = manifest().nodes.find((node) => node.id === 'evt-flu-outbreak')!;
    expect(flu.duration).toBe(5);
    expect(flu.effectType).toBe('income-multiplier');
    expect(flu.multiplier).toBeCloseTo(0.8);
  });

  it('marks every option edge with its effect policy', () => {
    const edges = manifest().edges;
    expect(edges.find((e) => e.from === 'evt-flu-outbreak' && e.label === 'Accept')!.effectPolicy).toBe('apply');
    expect(edges.find((e) => e.from === 'evt-flu-outbreak' && e.label === 'Reject')!.effectPolicy).toBe('skip');
  });

  it('formats impact readably (percent, delta, duration, synergy)', () => {
    const nodes = manifest().nodes;
    expect(describeEventImpact(nodes.find((n) => n.id === 'evt-tax')!)).toContain('−45% of banked coins');
    expect(describeEventImpact(nodes.find((n) => n.id === 'evt-flu-outbreak')!)).toBe(
      'all businesses income ×0.8 for 5 turns',
    );
    expect(describeEventImpact(nodes.find((n) => n.id === 'evt-strike-service')!)).toContain(
      'target: Service businesses',
    );
  });
});

describe('AC11/AC12 — per-event detail tables below each diagram', () => {
  it('renders one row per event with description, impact and choice routing', () => {
    const manifest = buildStorylineManifest(getEventTemplates());
    const table = renderStorylineDetailsMarkdown(manifest, 'storyline-tax');
    expect(table).toContain('Tax Audit (`evt-tax`)');
    expect(table).toContain('Lose 45% of your banked coins.');
    expect(table).toContain('−45% of banked coins (nominal −300 coins)');
    expect(table).toContain('Reject: effect skipped → Inquiry Commission');
  });

  it('embeds a generated table below every storyline diagram', () => {
    const doc = readFileSync(DOC_PATH, 'utf-8');
    for (const slug of EXPECTED_SLUGS) {
      const imageIdx = doc.indexOf(`./storyline-graph-${slug}.svg)`);
      const beginIdx = doc.indexOf(`<!-- BEGIN GENERATED: storyline-details-${slug} -->`);
      const endIdx = doc.indexOf(`<!-- END GENERATED: storyline-details-${slug} -->`);
      expect(imageIdx, `missing diagram for ${slug}`).toBeGreaterThan(-1);
      expect(beginIdx, `missing detail marker for ${slug}`).toBeGreaterThan(imageIdx);
      expect(endIdx, `unterminated detail marker for ${slug}`).toBeGreaterThan(beginIdx);
    }
  });

  it('the committed doc matches the regenerated tables (drift guard)', () => {
    const manifest = buildStorylineManifest(getEventTemplates());
    const committed = readFileSync(DOC_PATH, 'utf-8');
    let expected = committed;
    for (const page of buildStorylinePages(manifest)) {
      expected = spliceGeneratedDetails(
        expected,
        page.slug,
        renderStorylineDetailsMarkdown(manifest, page.storylineId),
      );
    }
    expect(expected).toBe(committed);
  });
});
