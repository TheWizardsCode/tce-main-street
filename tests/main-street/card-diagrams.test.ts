/**
 * Card diagrams (MS-0MVBF41VH005TSWE): generator core, CLI and the
 * card-synergy diagram.
 *
 * AC1 — Deterministic node/edge manifest builders plus Mermaid (and on-demand
 *       JSON) renderers, driven by the `docs:diagrams` CLI with
 *       `--diagram/--format/--out/--check`.
 * AC2 — The CLI is exercised under `vite-node`: write, `--check` up to date,
 *       `--check` drift and per-diagram selection.
 * AC3 — Every business (31) and community-space (8) card appears as a node,
 *       all six synergy types appear, and there is one edge per card↔synergy
 *       membership.
 * AC4 — `docs/dev/assets/card-synergies.mmd` is committed and regenerates
 *       byte-for-byte; a drift guard fails when it differs.
 * AC5 — Determinism: two builds are deeply equal, output is sorted and carries
 *       no timestamp/RNG/wall-clock input.
 *
 * @module
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildCardDiagram,
  buildCardDiagramsManifest,
  parseDiagramArgs,
  renderDiagramMermaid,
  serializeCardDiagramsManifest,
  listDiagramIds,
} from '../../src/scripts/card-diagrams';
import {
  getBusinessTemplates,
  getCommunitySpaceTemplates,
  resetTemplatesToDefault,
} from '../../src/MainStreetCards';
import { SYNERGY_TYPE_NAMES } from '../../src/MainStreetCardsTypes';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const VITE_NODE_BIN = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'vite-node');
const DIAGRAM_CLI = 'src/scripts/card-diagrams-cli.ts';
const SYNERGIES_ARTEFACT = path.join(PROJECT_ROOT, 'docs/dev/assets/card-synergies.mmd');

/**
 * Shown in every drift-assertion failure so a stale artefact is trivial to fix
 * without reading the source.
 */
const REGEN_DIAGRAMS_HINT =
  'Committed card diagram is stale — regenerate and commit it with:\n' +
  '  npm run docs:diagrams';

function runDiagramCli(
  args: string[],
  timeoutMs = 180_000,
): { stdout: string; stderr: string; exitCode: number } {
  const res = spawnSync(VITE_NODE_BIN, [DIAGRAM_CLI, ...args], {
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
});

// ── AC1/AC5: deterministic manifest build ───────────────────

describe('AC1/AC5 — manifest build is deterministic', () => {
  it('two builds from the same data are deeply equal', () => {
    const first = buildCardDiagram('synergies');
    const second = buildCardDiagram('synergies');
    expect(first).toEqual(second);
  });

  it('parses CLI args (diagram/format/out/check)', () => {
    expect(parseDiagramArgs(['--diagram', 'synergies'])).toMatchObject({
      diagrams: ['synergies'],
      format: 'mermaid',
      check: false,
    });
    expect(parseDiagramArgs(['--format', 'json'])).toMatchObject({ format: 'json' });
    expect(parseDiagramArgs([])).toMatchObject({ format: 'mermaid', check: false });
    expect(parseDiagramArgs(['--check'])).toMatchObject({ check: true });
    expect(parseDiagramArgs(['--out', 'x.mmd', '--diagram', 'synergies'])).toMatchObject({
      out: 'x.mmd',
    });
    // Default selection is every registered diagram.
    expect(parseDiagramArgs([]).diagrams).toEqual(listDiagramIds());
  });

  it('rejects an unknown --diagram value with an actionable message', () => {
    expect(() => parseDiagramArgs(['--diagram', 'nope'])).toThrow(/nope/);
  });

  it('serialises the JSON manifest with a stable trailing newline', () => {
    const json = serializeCardDiagramsManifest(buildCardDiagramsManifest(['synergies']));
    expect(json.endsWith('\n')).toBe(true);
    expect(json).not.toContain('generatedAt');
  });

  it('contains no timestamp / wall-clock fields', () => {
    const manifest = buildCardDiagramsManifest(['synergies']);
    const asText = JSON.stringify(manifest);
    expect(asText).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no ISO timestamps
  });
});

// ── AC3: card-synergy diagram content ───────────────────────

describe('AC3 — card-synergy diagram content', () => {
  it('every business and community-space card appears as a node', () => {
    const diagram = buildCardDiagram('synergies');
    const nodeIds = new Set(diagram.nodes.map((node) => node.id));
    for (const business of getBusinessTemplates()) {
      expect(nodeIds.has(business.id), `missing business node ${business.id}`).toBe(true);
    }
    for (const space of getCommunitySpaceTemplates()) {
      expect(nodeIds.has(space.id), `missing community-space node ${space.id}`).toBe(true);
    }
    expect(diagram.nodes).toHaveLength(
      getBusinessTemplates().length + getCommunitySpaceTemplates().length + SYNERGY_TYPE_NAMES.length,
    );
  });

  it('all six synergy types appear as nodes', () => {
    const diagram = buildCardDiagram('synergies');
    const nodeIds = new Set(diagram.nodes.map((node) => node.id));
    for (const synergy of SYNERGY_TYPE_NAMES) {
      expect(nodeIds.has(`synergy-${synergy.toLowerCase()}`), `missing ${synergy}`).toBe(true);
    }
  });

  it('emits exactly one edge per card↔synergy membership', () => {
    const diagram = buildCardDiagram('synergies');
    const expected =
      getBusinessTemplates().reduce((sum, card) => sum + card.synergyTypes.length, 0) +
      getCommunitySpaceTemplates().reduce((sum, card) => sum + card.synergyTypes.length, 0);
    expect(diagram.edges).toHaveLength(expected);
  });

  it('connects representative multi-synergy cards to each of their types', () => {
    const diagram = buildCardDiagram('synergies');
    const targets = (from: string): string[] =>
      diagram.edges
        .filter((edge) => edge.from === from)
        .map((edge) => edge.to)
        .sort();

    expect(targets('biz-cafe')).toEqual(['synergy-culture', 'synergy-food']);
    expect(targets('cs-public-art')).toEqual(['synergy-culture', 'synergy-entertainment']);
  });

  it('sorts nodes and edges deterministically', () => {
    const diagram = buildCardDiagram('synergies');
    const nodeIds = diagram.nodes.map((node) => node.id);
    expect(nodeIds).toEqual([...nodeIds].sort());
    const edgeKeys = diagram.edges.map((edge) => `${edge.from}\u0000${edge.to}`);
    expect(edgeKeys).toEqual([...edgeKeys].sort());
  });

  it('renders a Mermaid flowchart containing the cards and synergy types', () => {
    const mermaid = renderDiagramMermaid(buildCardDiagram('synergies'));
    expect(mermaid).toContain('flowchart LR');
    expect(mermaid).toMatch(/biz_cafe/);
    expect(mermaid).toMatch(/synergy_food/);
    expect(mermaid).toMatch(/biz_cafe -->\|Food\| synergy_food/);
  });
});

// ── AC4: committed artefact and drift guard ─────────────────

describe('AC4 — committed artefact matches regeneration', () => {
  it('the committed mermaid artefact matches regeneration byte-for-byte', () => {
    expect(fs.existsSync(SYNERGIES_ARTEFACT)).toBe(true);
    const committed = fs.readFileSync(SYNERGIES_ARTEFACT, 'utf-8');
    const regenerated = renderDiagramMermaid(buildCardDiagram('synergies'));
    expect(regenerated, REGEN_DIAGRAMS_HINT).toBe(committed);
  });
});

// ── AC1/AC2: CLI end-to-end ─────────────────────────────────

describe('AC1/AC2 — diagrams CLI via vite-node', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tce-card-diagrams-'));

  it('writes a Mermaid file to --out for a selected diagram', () => {
    const out = path.join(tmpDir, 'synergies.mmd');
    const res = runDiagramCli(['--diagram', 'synergies', '--out', out]);
    expect(res.exitCode).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.readFileSync(out, 'utf-8')).toContain('flowchart LR');
  });

  it('writes a JSON manifest to --out', () => {
    const out = path.join(tmpDir, 'diagrams.json');
    const res = runDiagramCli(['--diagram', 'synergies', '--format', 'json', '--out', out]);
    expect(res.exitCode).toBe(0);
    const manifest = JSON.parse(fs.readFileSync(out, 'utf-8'));
    expect(manifest.version).toBe(1);
    expect(manifest.diagrams).toHaveLength(1);
    expect(manifest.diagrams[0].id).toBe('synergies');
  });

  it('--check exits 0 when the committed artefact is current', () => {
    const res = runDiagramCli(['--diagram', 'synergies', '--check']);
    expect(res.exitCode).toBe(0);
  });

  it('--check exits non-zero when the artefact drifts', () => {
    const out = path.join(tmpDir, 'drifted.mmd');
    fs.writeFileSync(out, 'flowchart LR\n', 'utf-8');
    const res = runDiagramCli(['--diagram', 'synergies', '--out', out, '--check']);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain('drift');
  });

  it('--check exits non-zero when the artefact is missing', () => {
    const out = path.join(tmpDir, 'missing.mmd');
    const res = runDiagramCli(['--diagram', 'synergies', '--out', out, '--check']);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain('missing');
  });

  it('rejects an unknown --diagram value with a non-zero exit', () => {
    const res = runDiagramCli(['--diagram', 'nope']);
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain('nope');
  });
});
