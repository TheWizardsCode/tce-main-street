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
  getStaffCardTemplates,
  resetTemplatesToDefault,
} from '../../src/MainStreetCards';
import { STAFF_SKILL_CATALOG } from '../../src/MainStreetStaffSkills';
import { SYNERGY_TYPE_NAMES } from '../../src/MainStreetCardsTypes';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const VITE_NODE_BIN = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'vite-node');
const DIAGRAM_CLI = 'src/scripts/card-diagrams-cli.ts';
const SYNERGIES_ARTEFACT = path.join(PROJECT_ROOT, 'docs/dev/assets/card-synergies.mmd');
const COMMUNITY_SPACES_ARTEFACT = path.join(
  PROJECT_ROOT,
  'docs/dev/assets/community-space-relationships.mmd',
);
const STAFF_ARTEFACT = path.join(PROJECT_ROOT, 'docs/dev/assets/staff-relationships.mmd');

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

// ── F2 — community-space relationship diagram ──────────────

describe('F2 — community-space relationship diagram', () => {
  const diagram = () => buildCardDiagram('community-spaces');

  it('shows all eight community-space cards as nodes', () => {
    const nodeIds = new Set(diagram().nodes.map((node) => node.id));
    for (const space of getCommunitySpaceTemplates()) {
      expect(nodeIds.has(space.id), `missing community-space node ${space.id}`).toBe(true);
    }
  });

  it('connects each community space to every one of its synergy types', () => {
    const edges = diagram().edges;
    const expected = getCommunitySpaceTemplates().reduce(
      (sum, card) => sum + card.synergyTypes.length,
      0,
    );
    const synergyEdges = edges.filter((edge) => edge.to.startsWith('synergy-'));
    expect(synergyEdges).toHaveLength(expected);
    const publicArt = edges
      .filter((edge) => edge.from === 'cs-public-art' && edge.to.startsWith('synergy-'))
      .map((edge) => edge.to)
      .sort();
    expect(publicArt).toEqual(['synergy-culture', 'synergy-entertainment']);
  });

  it('reaches every community-space upgrade via its target card', () => {
    const edges = diagram().edges;
    const upgradeTargets = edges.filter((edge) => edge.to.startsWith('upg-'));
    expect(upgradeTargets.map((edge) => `${edge.from}:${edge.to}`).sort()).toEqual([
      'cs-community-garden:upg-orchard',
      'cs-fountain:upg-grand-fountain',
      'cs-health-kiosk:upg-health-center',
      'cs-library:upg-community-hub',
      'cs-park:upg-garden',
      'cs-playground:upg-adventure-park',
    ]);
  });

  it('labels upgrades with newDisplayName and requiredLevel', () => {
    const d = diagram();
    const orchard = d.nodes.find((node) => node.id === 'upg-orchard');
    expect(orchard?.name).toBe('Orchard');
    const edge = d.edges.find((e) => e.from === 'cs-community-garden' && e.to === 'upg-orchard');
    expect(edge?.label).toContain('Orchard');
    expect(edge?.label).toContain('level 0');
  });

  it('records ongoing cost and buff fields where set', () => {
    const d = diagram();
    const park = d.nodes.find((node) => node.id === 'cs-park');
    expect(park?.detail).toContain('40');
    const hub = d.nodes.find((node) => node.id === 'upg-community-hub');
    expect(hub?.detail).toContain('rep +10');
    const orchard = d.nodes.find((node) => node.id === 'upg-orchard');
    expect(orchard?.detail).toContain('rep +5');
  });

  it('two builds are deeply equal and sorted', () => {
    const first = diagram();
    expect(first).toEqual(diagram());
    const nodeIds = first.nodes.map((node) => node.id);
    expect(nodeIds).toEqual([...nodeIds].sort());
    const edgeKeys = first.edges.map((edge) => `${edge.from}\u0000${edge.to}`);
    expect(edgeKeys).toEqual([...edgeKeys].sort());
  });

  it('is wired into --diagram and --diagram all', () => {
    expect(listDiagramIds()).toContain('community-spaces');
    expect(parseDiagramArgs(['--diagram', 'community-spaces']).diagrams).toEqual([
      'community-spaces',
    ]);
    expect(parseDiagramArgs([]).diagrams).toContain('community-spaces');
  });

  it('emits the same manifest through --format json', () => {
    const manifest = buildCardDiagramsManifest(['community-spaces']);
    expect(manifest.diagrams).toHaveLength(1);
    expect(manifest.diagrams[0].id).toBe('community-spaces');
    expect(manifest.diagrams[0].nodes).toEqual(diagram().nodes);
    expect(manifest.diagrams[0].edges).toEqual(diagram().edges);
  });

  it('the committed artefact matches regeneration byte-for-byte', () => {
    expect(fs.existsSync(COMMUNITY_SPACES_ARTEFACT)).toBe(true);
    const committed = fs.readFileSync(COMMUNITY_SPACES_ARTEFACT, 'utf-8');
    expect(renderDiagramMermaid(diagram()), REGEN_DIAGRAMS_HINT).toBe(committed);
  });
});

// ── F3 — staff relationship diagram ─────────────────────────

describe('F3 — staff relationship diagram', () => {
  const diagram = () => buildCardDiagram('staff');

  it('shows every staff card as a node', () => {
    const nodeIds = new Set(diagram().nodes.map((node) => node.id));
    for (const staff of getStaffCardTemplates()) {
      expect(nodeIds.has(staff.id), `missing staff node ${staff.id}`).toBe(true);
    }
    expect(diagram().nodes.filter((node) => node.kind === 'staff')).toHaveLength(
      getStaffCardTemplates().length,
    );
  });

  it('connects each staff card to every synergy/business target it may serve', () => {
    const d = diagram();
    const targets = (from: string): string[] =>
      d.edges
        .filter((edge) => edge.from === from && !edge.to.startsWith('skill-category-'))
        .map((edge) => edge.to)
        .sort();
    // health-safety → Health only; chef → Cafe/Diner/Delicatessen/Food.
    expect(targets('staff-health-safety')).toEqual(['synergy-health']);
    expect(targets('staff-chef')).toEqual([
      'biz-cafe',
      'biz-delicatessen',
      'biz-diner',
      'synergy-food',
    ]);
  });

  it('does not emit edges for an empty allowed-target list (generalists keep all six)', () => {
    const d = diagram();
    // No staff node links to a synthetic placeholder.
    const targets = d.edges.map((edge) => edge.to);
    expect(targets.every((to) => !to.startsWith('unknown-'))).toBe(true);
    // A generalist (Assistant) reaches every synergy type.
    const assistant = d.edges
      .filter((edge) => edge.from === 'staff-assistant')
      .map((edge) => edge.to)
      .sort();
    expect(assistant).toEqual(
      SYNERGY_TYPE_NAMES.map((s) => `synergy-${s.toLowerCase()}`).sort(),
    );
  });

  it('shows every catalogue skill grouped under its category', () => {
    const d = diagram();
    const skillIds = new Set(
      d.nodes.filter((node) => node.kind === 'skill').map((node) => node.id),
    );
    for (const skill of STAFF_SKILL_CATALOG) {
      expect(skillIds.has(skill.id), `missing skill ${skill.id}`).toBe(true);
    }
    // Every catalogue skill is reachable from its category node.
    for (const skill of STAFF_SKILL_CATALOG) {
      const edge = d.edges.find(
        (e) => e.to === skill.id && e.from === `skill-category-${skill.category}`,
      );
      expect(edge, `missing category edge for ${skill.id}`).toBeDefined();
    }
    // The four category nodes exist.
    const categoryIds = d.nodes
      .filter((node) => node.kind === 'skill-category')
      .map((node) => node.id)
      .sort();
    expect(categoryIds).toEqual([
      'skill-category-cost-reduction',
      'skill-category-incident-mitigation',
      'skill-category-income-boost',
      'skill-category-reputation-boost',
    ]);
  });

  it('two builds are deeply equal and sorted', () => {
    const first = diagram();
    expect(first).toEqual(diagram());
    const nodeIds = first.nodes.map((node) => node.id);
    expect(nodeIds).toEqual([...nodeIds].sort());
  });

  it('is wired into --diagram, --diagram all and --format json', () => {
    expect(listDiagramIds()).toContain('staff');
    expect(parseDiagramArgs(['--diagram', 'staff']).diagrams).toEqual(['staff']);
    const manifest = buildCardDiagramsManifest(['staff']);
    expect(manifest.diagrams[0].id).toBe('staff');
    expect(manifest.diagrams[0].edges).toEqual(diagram().edges);
  });

  it('the committed artefact matches regeneration byte-for-byte', () => {
    expect(fs.existsSync(STAFF_ARTEFACT)).toBe(true);
    const committed = fs.readFileSync(STAFF_ARTEFACT, 'utf-8');
    expect(renderDiagramMermaid(diagram()), REGEN_DIAGRAMS_HINT).toBe(committed);
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

  it('writes the community-space diagram for --diagram community-spaces', () => {
    const out = path.join(tmpDir, 'community-spaces.mmd');
    const res = runDiagramCli(['--diagram', 'community-spaces', '--out', out]);
    expect(res.exitCode).toBe(0);
    expect(fs.readFileSync(out, 'utf-8')).toContain('cs_community_garden');
  });

  it('writes the staff diagram for --diagram staff', () => {
    const out = path.join(tmpDir, 'staff.mmd');
    const res = runDiagramCli(['--diagram', 'staff', '--out', out]);
    expect(res.exitCode).toBe(0);
    expect(fs.readFileSync(out, 'utf-8')).toContain('staff_chef');
    expect(fs.readFileSync(out, 'utf-8')).toContain('skill_category_income_boost');
  });
});
