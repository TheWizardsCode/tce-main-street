/**
 * Storyline graph per-page SVG render + drift guard (MS-0MUNB54KU005084C).
 *
 * AC7  — Per-storyline pages: one committed SVG per storyline, scoped and readable.
 * AC8  — Standalone-incident index: non-storyline incidents in a committed index.
 * AC10 — Event detail data: the manifest exposes each event's description,
 *        trigger, tier, target, deltas (incl. proportional) and duration
 *        fields, plus the option effect policy.
 * AC11 — Per-event detail tables: generated below each diagram.
 * AC12 — Drift guard: committed tables/docs match the regenerated ones.
 * AC13 — Per-storyline documents: one Markdown file per storyline.
 * AC14 — Assets folder: SVGs live under docs/main-street/assets/.
 * AC15 — Readable boxes: brief description + impact inside each box.
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
  DOC_INDEX_KEY,
  INCIDENT_INDEX_PATH,
  renderMermaidBatch,
  renderStorylineDoc,
  renderStorylineDocIndex,
  spliceGeneratedSection,
} from '../../src/scripts/render-storyline-graph';
import {
  buildStandaloneIncidentIndex,
  buildStorylineManifest,
  describeEventImpact,
  describeEventImpactCompact,
  nodeLabel,
  renderIncidentIndexMarkdown,
  renderStorylineDetailsMarkdown,
} from '../../src/scripts/storyline-graph';
import { getEventTemplates } from '../../src/MainStreetCards';

const PROJECT_ROOT = resolve(__dirname, '../..');
const DOC_PATH = resolve(PROJECT_ROOT, 'docs/main-street/storylines.md');
const INCIDENT_INDEX_FILE = resolve(PROJECT_ROOT, INCIDENT_INDEX_PATH);
const ASSET_PATH = (slug: string): string =>
  resolve(PROJECT_ROOT, `docs/main-street/assets/storyline-graph-${slug}.svg`);
const STORYLINE_DOC_PATH = (slug: string): string =>
  resolve(PROJECT_ROOT, `docs/main-street/storylines/${slug}.md`);

const EXPECTED_SLUGS = ['economy', 'health', 'labor', 'restaurant', 'tax'];

function readAsset(slug: string): string {
  return readFileSync(ASSET_PATH(slug), 'utf-8');
}

function svgViewBoxWidth(svg: string): number {
  const match = svg.match(/viewBox="0 0 ([\d.]+) /);
  if (!match) throw new Error('SVG has no viewBox');
  return Number.parseFloat(match[1]);
}

const manifest = () => buildStorylineManifest(getEventTemplates());

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
    expect(bySlug.tax).toContain('evt_tax');
    expect(bySlug.tax).toContain('evt_tax_error');
    expect(bySlug.tax).not.toContain('evt_flu_outbreak');
    expect(bySlug.tax).not.toContain('evt_art_sale');
    expect(bySlug.health).toContain('evt_flu_outbreak');
    expect(bySlug.health).not.toContain('evt_tax');
  });

  it('each page is readable (bounded width) rather than the old 13,000px strip', () => {
    for (const slug of EXPECTED_SLUGS) {
      const width = svgViewBoxWidth(readAsset(slug));
      expect(width, `${slug} page is too wide to read`).toBeLessThan(1000);
    }
  });
});

describe('AC14 — SVGs live under the docs assets folder', () => {
  it('every page is committed as a well-formed SVG in docs/main-street/assets', () => {
    for (const page of buildStorylinePages()) {
      expect(page.svgRelPath).toBe(`docs/main-street/assets/storyline-graph-${page.slug}.svg`);
      expect(existsSync(ASSET_PATH(page.slug)), `missing ${page.svgRelPath}`).toBe(true);
      const svg = readAsset(page.slug);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    }
    expect(readAsset('tax')).toContain('Tax Audit');
    expect(readAsset('health')).toContain('Pandemic');
  });

  it('no rendered SVG remains at the old docs root path', () => {
    for (const slug of EXPECTED_SLUGS) {
      expect(existsSync(resolve(PROJECT_ROOT, `docs/main-street/storyline-graph-${slug}.svg`))).toBe(
        false,
      );
    }
  });
});

describe('AC15 — each box carries a brief description and the game-state impact', () => {
  it('labels include the name, id, brief description and compact impact', () => {
    const nodes = manifest().nodes;
    const tax = nodes.find((node) => node.id === 'evt-tax')!;
    expect(nodeLabel(tax)).toContain('Tax Audit');
    expect(nodeLabel(tax)).toContain('evt-tax');
    expect(nodeLabel(tax)).toContain('Lose 45% of your banked coins.');
    expect(describeEventImpactCompact(tax)).toContain('−45% coins');

    const flu = nodes.find((node) => node.id === 'evt-flu-outbreak')!;
    expect(describeEventImpactCompact(flu)).toBe('×0.8 income · 5 turns');
  });

  it('the committed SVGs contain the brief description and impact text', () => {
    expect(readAsset('health')).toContain('All businesses generate 80% income for 5 turns.');
    expect(readAsset('health')).toContain('×0.8 income · 5 turns');
    expect(readAsset('labor')).toContain('target: Service');
  });
});

describe('AC8 — standalone incidents are a compact index, not boxes', () => {
  it('indexes every non-storyline incident and no storyline card', () => {
    const incidents = buildStandaloneIncidentIndex(manifest());
    expect(incidents.length).toBe(60);
    const ids = incidents.map((incident) => incident.id);
    expect(ids).toContain('evt-art-sale');
    expect(ids).not.toContain('evt-tax');
    expect(ids).not.toContain('evt-pandemic');
  });

  it('the committed index matches the manifest and is linked from the doc', () => {
    const expected = renderIncidentIndexMarkdown(buildStandaloneIncidentIndex(manifest()));
    expect(existsSync(INCIDENT_INDEX_FILE)).toBe(true);
    expect(readFileSync(INCIDENT_INDEX_FILE, 'utf-8')).toBe(expected);
    expect(readFileSync(DOC_PATH, 'utf-8')).toContain('./storyline-incident-index.md');
  });
});

describe('AC13 — one document per storyline, separated from storylines.md', () => {
  it('each storyline has its own document with its diagram and detail table', () => {
    for (const page of buildStorylinePages()) {
      expect(page.docRelPath).toBe(`docs/main-street/storylines/${page.slug}.md`);
      expect(existsSync(STORYLINE_DOC_PATH(page.slug)), `missing ${page.docRelPath}`).toBe(true);
      const doc = readFileSync(STORYLINE_DOC_PATH(page.slug), 'utf-8');
      expect(doc).toContain(`# ${page.title}`);
      expect(doc).toContain(`../assets/storyline-graph-${page.slug}.svg`);
      expect(doc).toContain('| Event | Description | Trigger / tier / cost |');
    }
  });

  it('storylines.md links to every storyline doc and no longer embeds the diagrams', () => {
    const doc = readFileSync(DOC_PATH, 'utf-8');
    for (const slug of EXPECTED_SLUGS) {
      expect(doc, `doc missing link to ${slug}`).toContain(`./storylines/${slug}.md`);
      // The combined SVG and per-storyline embeds are gone from the canonical doc.
      expect(doc).not.toContain(`./assets/storyline-graph-${slug}.svg)`);
    }
  });
});

describe('AC10 — the manifest exposes per-event detail', () => {
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

describe('AC11/AC12 — detail tables and generated docs are drift-guarded', () => {
  it('renders one row per event with description, impact and choice routing', () => {
    const table = renderStorylineDetailsMarkdown(manifest(), 'storyline-tax');
    expect(table).toContain('Tax Audit (`evt-tax`)');
    expect(table).toContain('Lose 45% of your banked coins.');
    expect(table).toContain('−45% of banked coins (nominal −300 coins)');
    expect(table).toContain('Reject: effect skipped → Inquiry Commission');
  });

  it('the committed storyline documents match the regenerated documents', () => {
    const m = manifest();
    for (const page of buildStorylinePages(m)) {
      const expected = renderStorylineDoc(page, renderStorylineDetailsMarkdown(m, page.storylineId));
      expect(readFileSync(STORYLINE_DOC_PATH(page.slug), 'utf-8')).toBe(expected);
    }
  });

  it('the committed doc index matches the regenerated index (drift guard)', () => {
    const m = manifest();
    const committed = readFileSync(DOC_PATH, 'utf-8');
    const expected = spliceGeneratedSection(committed, DOC_INDEX_KEY, renderStorylineDocIndex(m, buildStorylinePages(m)));
    expect(expected).toBe(committed);
  });
});

describe('AC2/AC4 — committed assets match a re-render and the render is deterministic', () => {
  it('re-rendering reproduces every committed SVG byte-for-byte, deterministically', async () => {
    const pages = buildStorylinePages();
    const sources = Object.fromEntries(pages.map((page) => [page.slug, page.mermaid]));

    const first = await renderMermaidBatch(sources);
    const second = await renderMermaidBatch(sources);

    for (const page of pages) {
      const committed = readFileSync(ASSET_PATH(page.slug), 'utf-8');
      expect(first[page.slug], `drift in ${page.svgRelPath}`).toBe(committed);
      expect(second[page.slug], `non-deterministic render for ${page.slug}`).toBe(first[page.slug]);
    }
  }, 120_000);
});
