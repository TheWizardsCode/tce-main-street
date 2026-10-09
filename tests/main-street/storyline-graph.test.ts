/**
 * Storyline graph / manifest export (MS-0MUMP94S7008KTI0)
 *
 * AC1 — Export CLI: `--format mermaid` and `--format json` succeed against the
 *       shipped CSV and emit deterministic output.
 * AC2 — Committed artefact: generated graph/manifest is committed and
 *       regenerable via `npm run storylines:graph`.
 * AC3 — JSON schema: the emitted manifest validates against
 *       `schemas/main-street-storyline.schema.json` (ajv).
 * AC4 — Cycle marking: the shipped tax cycle is a marked cycle edge in both
 *       formats.
 * AC5 — Drift test: regenerating from `src/card-data.csv` matches the
 *       committed artefact byte-for-byte.
 *
 * @module
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Ajv from 'ajv';

import {
  buildStorylineManifest,
  renderMermaid,
  serializeManifest,
  parseGraphArgs,
  type StorylineManifest,
} from '../../src/scripts/storyline-graph';
import { getEventTemplates, resetTemplatesToDefault } from '../../src/MainStreetCards';
import { resetStorylineRegistry } from '../../src/MainStreetStoryline';
import type { EventCard } from '../../src/MainStreetCardsTypes';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const VITE_NODE_BIN = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'vite-node');
const GRAPH_CLI = 'src/scripts/storyline-graph-cli.ts';
const MERMAID_ARTEFACT = path.join(PROJECT_ROOT, 'docs/main-street/storyline-graph.mmd');
const JSON_ARTEFACT = path.join(PROJECT_ROOT, 'docs/main-street/storyline-manifest.json');

/**
 * Shown in every drift-assertion failure so a stale graph/manifest is trivial
 * to fix without reading the source.
 */
const REGEN_GRAPH_HINT =
  'Committed storyline graph/manifest is stale — regenerate and commit it with:\n' +
  '  npm run storylines:graph -- --format mermaid\n' +
  '  npm run storylines:graph -- --format json';
const SCHEMA_PATH = path.join(PROJECT_ROOT, 'schemas/main-street-storyline.schema.json');

function makeEvent(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event',
    id: 'evt-x',
    name: 'X',
    trigger: 'Incident',
    cost: 0,
    effect: 'x',
    target: 'All',
    coinDelta: -10,
    reputationDelta: 0,
    ...overrides,
  } as EventCard;
}

function runGraphCli(args: string[], timeoutMs = 180_000): { stdout: string; stderr: string; exitCode: number } {
  const res = spawnSync(VITE_NODE_BIN, [GRAPH_CLI, ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    env: { ...process.env },
  });
  return {
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    exitCode: res.status ?? (res.signal ? 1 : 0),
  };
}

afterEach(() => {
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

// ── AC1: deterministic build ────────────────────────────────

describe('AC1 — manifest build is deterministic', () => {
  it('two builds from the same cards are deeply equal and stable-ordered', () => {
    const cards = [
      makeEvent({ id: 'evt-b', hasChoices: true, rejectNextCardId: 'evt-c' }),
      makeEvent({ id: 'evt-a', hasChoices: true, acceptNextCardId: 'evt-c' }),
      makeEvent({ id: 'evt-c' }),
    ];
    const first = buildStorylineManifest(cards);
    const second = buildStorylineManifest([...cards].reverse());
    expect(first).toEqual(second);
    // Nodes and edges are sorted deterministically.
    expect(first.nodes.map((n) => n.id)).toEqual(['evt-a', 'evt-b', 'evt-c']);
  });

  it('contains no timestamp / wall-clock fields', () => {
    const manifest = buildStorylineManifest(getEventTemplates());
    const asText = JSON.stringify(manifest);
    expect(asText).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no ISO timestamps
  });

  it('serialises with a stable trailing newline', () => {
    const s = serializeManifest(buildStorylineManifest(getEventTemplates()));
    expect(s.endsWith('\n')).toBe(true);
    expect(s).not.toContain('generatedAt');
  });

  it('parses CLI args (format/out/check)', () => {
    expect(parseGraphArgs(['--format', 'json'])).toMatchObject({ format: 'json' });
    expect(parseGraphArgs(['--format', 'mermaid'])).toMatchObject({ format: 'mermaid' });
    expect(parseGraphArgs([])).toMatchObject({ format: 'mermaid' });
    expect(parseGraphArgs(['--format', 'json', '--check'])).toMatchObject({ format: 'json', check: true });
    expect(parseGraphArgs(['--out', 'x.json', '--format', 'json'])).toMatchObject({ out: 'x.json' });
  });
});

// ── AC4: cycle marking ──────────────────────────────────────

describe('AC4 — the shipped tax cycle is a marked cycle edge', () => {
  it('the manifest reports the tax cycle and marks cycle edges', () => {
    const manifest = buildStorylineManifest(getEventTemplates());
    expect(manifest.cycles).toHaveLength(1);
    expect([...manifest.cycles[0]].sort()).toEqual(['evt-tax', 'evt-tax-error', 'evt-tax-inquiry']);

    const cycleEdges = manifest.edges.filter((e) => e.cycle);
    expect(cycleEdges.length).toBe(3);
    for (const edge of cycleEdges) {
      expect(['evt-tax', 'evt-tax-error', 'evt-tax-inquiry']).toContain(edge.from);
      expect(['evt-tax', 'evt-tax-error', 'evt-tax-inquiry']).toContain(edge.to);
    }
  });

  it('non-cycle storyline edges are not marked', () => {
    const manifest = buildStorylineManifest(getEventTemplates());
    const fluEdge = manifest.edges.find((e) => e.from === 'evt-flu-outbreak' && e.to === 'evt-pandemic');
    expect(fluEdge).toBeDefined();
    expect(fluEdge!.cycle).toBe(false);
  });

  it('the mermaid output marks cycle edges with a thickened arrow', () => {
    const mermaid = renderMermaid(buildStorylineManifest(getEventTemplates()));
    // Cycle edges use `==>`.
    expect(mermaid).toMatch(/evt_tax ==>\|Reject\| evt_tax_inquiry/);
    expect(mermaid).toMatch(/evt_tax_inquiry ==>\|Accept\| evt_tax_error/);
    expect(mermaid).toMatch(/evt_tax_error ==>\|Reject\| evt_tax/);
    // Non-cycle edges remain `-->`.
    expect(mermaid).toMatch(/evt_flu_outbreak -->\|Reject\| evt_pandemic/);
  });

  it('the mermaid output renders choice cards as diamonds and plain cards as rounded', () => {
    const mermaid = renderMermaid(buildStorylineManifest(getEventTemplates()));
    expect(mermaid).toMatch(/evt_tax\{"Tax Audit/);
    expect(mermaid).toMatch(/evt_depression\("Depression/);
  });
});

// ── AC3: JSON schema ────────────────────────────────────────

describe('AC3 — manifest validates against the committed JSON schema', () => {
  it('the generated manifest is valid per the schema', () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const manifest = buildStorylineManifest(getEventTemplates());
    const ok = validate(manifest);
    expect(validate.errors, JSON.stringify(validate.errors, null, 2)).toBeNull();
    expect(ok).toBe(true);
  });

  it('the schema rejects a malformed manifest (missing nodes)', () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    expect(validate({ version: 1, source: 'x', storylineIds: [], edges: [], cycles: [] })).toBe(false);
  });

  it('the schema rejects an edge with an unknown extra property', () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const manifest = buildStorylineManifest(getEventTemplates()) as unknown as Record<string, unknown>;
    const bad = {
      ...manifest,
      edges: [{ from: 'a', label: 'Accept', to: null, cycle: false, extra: true }],
    };
    expect(validate(bad)).toBe(false);
  });
});

// ── AC2 + AC5: committed artefacts and drift ─────────────────

describe('AC2/AC5 — committed artefacts match the regenerated output', () => {
  it('the committed mermaid artefact matches regeneration', () => {
    expect(fs.existsSync(MERMAID_ARTEFACT)).toBe(true);
    const committed = fs.readFileSync(MERMAID_ARTEFACT, 'utf-8');
    const regenerated = renderMermaid(buildStorylineManifest(getEventTemplates()));
    expect(regenerated, REGEN_GRAPH_HINT).toBe(committed);
  });

  it('the committed JSON manifest matches regeneration', () => {
    expect(fs.existsSync(JSON_ARTEFACT)).toBe(true);
    const committed = fs.readFileSync(JSON_ARTEFACT, 'utf-8');
    const regenerated = serializeManifest(buildStorylineManifest(getEventTemplates()));
    expect(regenerated, REGEN_GRAPH_HINT).toBe(committed);
  });

  it('the committed manifest parses and carries the expected shape', () => {
    const manifest = JSON.parse(fs.readFileSync(JSON_ARTEFACT, 'utf-8')) as StorylineManifest;
    expect(manifest.version).toBe(1);
    expect(manifest.storylineIds).toEqual([
      'storyline-economy',
      'storyline-health',
      'storyline-labor',
      'storyline-restaurant',
      'storyline-tax',
    ]);
    expect(manifest.edges.length).toBe(14);
  });
});

// ── AC1: CLI end-to-end ─────────────────────────────────────

describe('AC1 — export CLI via vite-node', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tce-storyline-graph-'));

  it('writes a mermaid file to --out', () => {
    const out = path.join(tmpDir, 'graph.mmd');
    const res = runGraphCli(['--format', 'mermaid', '--out', out]);
    expect(res.exitCode).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.readFileSync(out, 'utf-8')).toContain('flowchart TD');
  });

  it('writes a JSON manifest to --out', () => {
    const out = path.join(tmpDir, 'manifest.json');
    const res = runGraphCli(['--format', 'json', '--out', out]);
    expect(res.exitCode).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(out, 'utf-8')) as StorylineManifest;
    expect(manifest.version).toBe(1);
  });

  it('--check exits 0 when the committed artefact is current', () => {
    const res = runGraphCli(['--format', 'json', '--check']);
    expect(res.exitCode).toBe(0);
  });

  it('--check exits non-zero when the artefact drifts', () => {
    const out = path.join(tmpDir, 'drifted.json');
    fs.writeFileSync(out, '{}\n', 'utf-8');
    const res = runGraphCli(['--format', 'json', '--out', out, '--check']);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain('drift');
  });
});
