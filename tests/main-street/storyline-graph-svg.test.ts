/**
 * Storyline graph SVG render + drift guard (MS-0MUNB54KU005084C).
 *
 * AC1 — Rendered artefact: the committed `storyline-graph.svg` is a portable
 *       SVG that is viewable without a Mermaid-aware renderer (it carries the
 *       card names/ids as SVG text).
 * AC2 — Reproducible render step: rendering the committed `.mmd` is
 *       deterministic (byte-identical on re-run).
 * AC4 — Drift guard: re-rendering the committed `.mmd` matches the committed
 *       SVG byte-for-byte; a stale image fails the check.
 *
 * The renderer (`mermaid` + Playwright Chromium) is a devDependency only.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { renderMermaidToSvg } from '../../src/scripts/render-storyline-graph';

const PROJECT_ROOT = resolve(__dirname, '../..');
const MERMAID_SOURCE = resolve(PROJECT_ROOT, 'docs/main-street/storyline-graph.mmd');
const SVG_ARTEFACT = resolve(PROJECT_ROOT, 'docs/main-street/storyline-graph.svg');

describe('AC1 — the committed storyline graph SVG is a portable artefact', () => {
  it('exists and is a well-formed SVG document', () => {
    expect(existsSync(SVG_ARTEFACT)).toBe(true);
    const svg = readFileSync(SVG_ARTEFACT, 'utf-8');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('carries card names and ids as text so it is readable without Mermaid', () => {
    const svg = readFileSync(SVG_ARTEFACT, 'utf-8');
    // Choice card, plain incident and escalation card from the shipped graph.
    expect(svg).toContain('Tax Audit');
    expect(svg).toContain('evt-tax');
    expect(svg).toContain('Pandemic');
    // The intentional tax cycle appears as graph edges.
    expect(svg).toContain('evt_tax_inquiry');
    expect(svg).toContain('evt_tax_error');
  });
});

describe('AC2/AC4 — the committed SVG matches a re-render of the committed .mmd', () => {
  it('re-rendering the committed .mmd reproduces the committed SVG byte-for-byte', async () => {
    const mermaidSource = readFileSync(MERMAID_SOURCE, 'utf-8');
    const committed = readFileSync(SVG_ARTEFACT, 'utf-8');

    const rendered = await renderMermaidToSvg(mermaidSource);

    expect(rendered).toBe(committed);
  }, 60_000);

  it('rendering the same .mmd twice is deterministic (byte-identical)', async () => {
    const mermaidSource = readFileSync(MERMAID_SOURCE, 'utf-8');

    const first = await renderMermaidToSvg(mermaidSource);
    const second = await renderMermaidToSvg(mermaidSource);

    expect(first).toBe(second);
  }, 60_000);
});
