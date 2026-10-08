/**
 * Storyline graph / manifest export
 *
 * Generates a deterministic, machine-readable picture of the shipped storyline
 * graph from the typed CSV model (MS-0MUMP94S7008KTI0):
 *
 *  - `--format mermaid` → a Mermaid flowchart (committed as
 *    `docs/main-street/storyline-graph.mmd`).
 *  - `--format json`    → a storyline manifest (committed as
 *    `docs/main-street/storyline-manifest.json`) that validates against
 *    `schemas/main-street-storyline.schema.json`.
 *
 * Determinism: all ordering is derived from sorted card ids and there is no
 * RNG, timestamp or wall-clock input — regenerating from the same CSV always
 * produces byte-identical output (AC1, AC5).
 *
 * Cycles are a first-class shape (approved decision 2026-09-29): cycle edges
 * are marked in both formats (AC4).
 *
 * @module
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { EventCard, StorylineOption } from '../MainStreetCardsTypes';
import { getBaseTypeId, getEventTemplates } from '../MainStreetCards';
import { getStorylineOptions, registerStorylineOptions } from '../MainStreetStoryline';
import { findCycles } from './validate-storylines';

// ── Manifest types ──────────────────────────────────────────

export interface StorylineGraphNode {
  /** Base card id (no instance serial). */
  readonly id: string;
  /** Display name. */
  readonly name: string;
  /** Storyline id, or null when the card is not part of a storyline. */
  readonly storylineId: string | null;
  /** Storyline title, or null. */
  readonly storylineTitle: string | null;
  /** True when the card presents a choice (hasChoices or registered options). */
  readonly hasChoices: boolean;
  /** Number of options (0 for plain incidents). */
  readonly optionCount: number;
  /** Net coin effect (informational). */
  readonly coinDelta: number;
  /** Net reputation effect (informational). */
  readonly reputationDelta: number;
}

export interface StorylineGraphOption {
  /** Option label, e.g. "Accept". */
  readonly label: string;
  /** Successor base card id, or null when the chain ends. */
  readonly successorId: string | null;
  /** Whether the event's own effect applies. */
  readonly effectPolicy: 'apply' | 'skip';
}

export interface StorylineGraphEdge {
  /** Source base card id. */
  readonly from: string;
  /** Source option label. */
  readonly label: string;
  /** Target base card id, or null when the chain ends. */
  readonly to: string | null;
  /** True when this edge participates in a cycle. */
  readonly cycle: boolean;
}

export interface StorylineManifest {
  /** Manifest schema version. */
  readonly version: number;
  /** Generator provenance (deterministic — no timestamp). */
  readonly source: string;
  /** Sorted list of storyline ids present. */
  readonly storylineIds: readonly string[];
  /** Sorted graph nodes. */
  readonly nodes: readonly StorylineGraphNode[];
  /** Sorted graph edges. */
  readonly edges: readonly StorylineGraphEdge[];
  /** Detected cycles (first-class); each entry is a cycle path of base ids. */
  readonly cycles: readonly (readonly string[])[];
}

// ── Build ───────────────────────────────────────────────────

/** Compares two strings for deterministic (codepoint) ordering. */
function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Builds the storyline manifest from a list of event cards.
 *
 * @param cards Event templates (shipped CSV or a fixture).
 * @param opts  Optional token registry for storylines declared outside the CSV.
 * @returns A deterministic manifest.
 */
export function buildStorylineManifest(
  cards: readonly EventCard[],
  opts: { getOptions?: (card: EventCard) => StorylineOption[] } = {},
): StorylineManifest {
  const optionGetter = opts.getOptions ?? ((c: EventCard) => getStorylineOptions(c));

  // De-duplicate by base id, keeping the first occurrence; sort for stability.
  const byBase = new Map<string, EventCard>();
  for (const card of cards) {
    const base = getBaseTypeId(card.id);
    if (!byBase.has(base)) byBase.set(base, card);
  }
  const bases = [...byBase.keys()].sort(byString);

  const storylineIds = new Set<string>();
  const nodes: StorylineGraphNode[] = [];
  const edges: StorylineGraphEdge[] = [];

  for (const base of bases) {
    const card = byBase.get(base)!;
    if (card.storylineId) storylineIds.add(card.storylineId);
    const options = optionGetter(card);
    const hasChoices = Boolean(card.hasChoices) || options.length > 0;

    nodes.push({
      id: base,
      name: card.name,
      storylineId: card.storylineId ?? null,
      storylineTitle: card.storylineTitle ?? null,
      hasChoices,
      optionCount: options.length,
      coinDelta: card.coinDelta,
      reputationDelta: card.reputationDelta,
    });

    for (const option of options) {
      edges.push({
        from: base,
        label: option.label,
        to: option.successorId ? getBaseTypeId(option.successorId) : null,
        cycle: false, // marked after cycle detection below
      });
    }
  }

  // ── Cycle detection (over the choice graph) ──
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!edge.to) continue;
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }
  const cycles = findCycles(adjacency)
    .map((cycle) => [...cycle].sort(byString))
    .sort((a, b) => byString(a.join('|'), b.join('|')));

  // A cycle edge is any edge whose endpoints both lie on the same cycle path.
  const cycleNodeSets = cycles.map((c) => new Set(c));
  const markedEdges = edges.map((edge) => {
    const to = edge.to;
    if (!to) return edge;
    const inCycle = cycleNodeSets.some((set) => set.has(edge.from) && set.has(to));
    return inCycle ? { ...edge, cycle: true } : edge;
  });

  // Deterministic edge ordering: from, then label, then to.
  markedEdges.sort((a, b) => {
    const from = byString(a.from, b.from);
    if (from !== 0) return from;
    const label = byString(a.label, b.label);
    if (label !== 0) return label;
    return byString(a.to ?? '', b.to ?? '');
  });

  return {
    version: 1,
    source: 'Generated from src/card-data.csv via the typed storyline model (deterministic).',
    storylineIds: [...storylineIds].sort(byString),
    nodes,
    edges: markedEdges,
    cycles,
  };
}

/** Serialises a manifest to stable, pretty-printed JSON (trailing newline). */
export function serializeManifest(manifest: StorylineManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// ── Mermaid rendering ───────────────────────────────────────

/** Escapes a Mermaid node label (quotes + angle brackets). */
function mermaidId(base: string): string {
  // Mermaid ids must be simple; replace characters that break the grammar.
  return base.replace(/[^A-Za-z0-9_]/g, '_');
}

/**
 * Renders the storyline graph as a Mermaid flowchart.
 *
 * Choice cards render as diamonds, plain incidents as rounded rectangles.
 * Edges are labelled with the option label; cycle edges use a thickened
 * (\`==>\`) arrow so intentional cycles are visible at a glance (AC4).
 * Deterministic: node and edge order follow the manifest's sorted order.
 */
export function renderMermaid(manifest: StorylineManifest): string {
  const lines: string[] = [];
  lines.push('%%{ init: { "flowchart": { "curve": "basis" } } }%%');
  lines.push('flowchart TD');

  // Nodes
  for (const node of manifest.nodes) {
    const id = mermaidId(node.id);
    const label = `${node.name}<br/>${node.id}`;
    if (node.hasChoices) {
      lines.push(`  ${id}{"${label}"}`);
    } else {
      lines.push(`  ${id}("${label}")`);
    }
  }
  lines.push('');

  // Edges
  for (const edge of manifest.edges) {
    const arrow = edge.cycle ? '==>' : '-->';
    const from = mermaidId(edge.from);
    if (edge.to) {
      const to = mermaidId(edge.to);
      lines.push(`  ${from} ${arrow}|${edge.label}| ${to}`);
    } else {
      // Terminal option — render an explicit end node so the shape is visible.
      const endId = `${from}_${edge.label.replace(/[^A-Za-z0-9_]/g, '_')}_end`;
      lines.push(`  ${endId}(["end"])`);
      lines.push(`  ${from} ${arrow}|${edge.label}| ${endId}`);
    }
  }

  // Cycle legend (informational)
  if (manifest.cycles.length > 0) {
    lines.push('');
    lines.push('  %% Intentional cycle(s):');
    for (const cycle of manifest.cycles) {
      lines.push(`  %% ${cycle.join(' -> ')} -> ${cycle[0]}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

// ── Per-storyline views (MS-0MUNB54KU005084C reopened) ───────

/**
 * Restricts a manifest to a single storyline's cards (its parent incident and
 * the chain it links to). Used to render one readable diagram per storyline
 * (one parent box per page) instead of the unreadable combined graph.
 *
 * @param manifest    The full storyline manifest.
 * @param storylineId The storyline id to keep (e.g. `storyline-tax`).
 * @returns A manifest containing only that storyline's nodes, edges and cycles.
 */
export function filterManifestByStoryline(
  manifest: StorylineManifest,
  storylineId: string,
): StorylineManifest {
  const nodeIds = new Set(
    manifest.nodes.filter((node) => node.storylineId === storylineId).map((node) => node.id),
  );
  const nodes = manifest.nodes.filter((node) => nodeIds.has(node.id));
  const edges = manifest.edges.filter(
    (edge) => nodeIds.has(edge.from) && (edge.to === null || nodeIds.has(edge.to)),
  );
  const cycles = manifest.cycles.filter((cycle) => cycle.every((id) => nodeIds.has(id)));
  return { ...manifest, storylineIds: [storylineId], nodes, edges, cycles };
}

/** A standalone incident (not part of any storyline chain). */
export interface StandaloneIncident {
  readonly id: string;
  readonly name: string;
}

/**
 * Returns the incidents that belong to no storyline chain (no storyline id and
 * no graph edges). These are listed as a compact index rather than drawn as
 * boxes — the box layout is what made the combined graph unreadable.
 *
 * @param manifest The full storyline manifest.
 * @returns The standalone incidents, in manifest (sorted) order.
 */
export function buildStandaloneIncidentIndex(
  manifest: StorylineManifest,
): StandaloneIncident[] {
  const linked = new Set<string>();
  for (const edge of manifest.edges) {
    linked.add(edge.from);
    if (edge.to) linked.add(edge.to);
  }
  return manifest.nodes
    .filter((node) => !node.storylineId && !linked.has(node.id))
    .map((node) => ({ id: node.id, name: node.name }));
}

/**
 * Renders the standalone-incident index as a committed Markdown document.
 *
 * @param incidents The standalone incidents (from `buildStandaloneIncidentIndex`).
 * @returns A deterministic Markdown document (trailing newline).
 */
export function renderIncidentIndexMarkdown(
  incidents: readonly StandaloneIncident[],
): string {
  const lines = [
    '# Main Street: standalone incidents',
    '',
    '> Generated from `src/card-data.csv` by `npm run storylines:graph:svg`. These',
    '> incidents are not part of any storyline chain, so they are listed here as a',
    '> compact index rather than drawn as boxes in the storyline diagrams.',
    '',
    '| Incident | Card id |',
    '|----------|---------|',
  ];
  for (const incident of incidents) {
    lines.push(`| ${incident.name.replace(/\|/g, '\\|')} | \`${incident.id}\` |`);
  }
  return `${lines.join('\n')}\n`;
}

// ── CLI ─────────────────────────────────────────────────────

export interface StorylineGraphCliOptions {
  readonly format: 'mermaid' | 'json';
  readonly out?: string;
  readonly check?: boolean;
}

/** Parses CLI args for the graph exporter. */
export function parseGraphArgs(argv: readonly string[]): StorylineGraphCliOptions {
  const fmtIdx = argv.indexOf('--format');
  const rawFormat = fmtIdx >= 0 ? argv[fmtIdx + 1] : 'mermaid';
  const format = rawFormat === 'json' ? 'json' : 'mermaid';
  const outIdx = argv.indexOf('--out');
  const out = outIdx >= 0 ? argv[outIdx + 1] : undefined;
  return { format, out, check: argv.includes('--check') };
}

const DEFAULT_MERMAID_OUT = 'docs/main-street/storyline-graph.mmd';
const DEFAULT_JSON_OUT = 'docs/main-street/storyline-manifest.json';

/**
 * Runs the export CLI: builds the manifest and either writes the artefact or
 * (with `--check`) compares it against the committed file for drift.
 *
 * @returns Process exit code (0 = success / no drift, 1 = drift).
 */
export function runGraphCli(argv: readonly string[] = process.argv.slice(2)): number {
  const opts = parseGraphArgs(argv);
  const manifest = buildStorylineManifest(getEventTemplates());
  const content = opts.format === 'mermaid' ? renderMermaid(manifest) : serializeManifest(manifest);
  const defaultOut = opts.format === 'mermaid' ? DEFAULT_MERMAID_OUT : DEFAULT_JSON_OUT;
  const outPath = resolve(process.cwd(), opts.out ?? defaultOut);

  if (opts.check) {
    if (!existsSync(outPath)) {
      process.stderr.write(`storyline-graph: missing committed artefact ${outPath}\n`);
      return 1;
    }
    const existing = readFileSync(outPath, 'utf-8');
    if (existing !== content) {
      process.stderr.write(
        `storyline-graph: drift detected in ${outPath} — regenerate with ` +
          `\`npm run storylines:graph -- --format ${opts.format}\`\n`,
      );
      return 1;
    }
    process.stdout.write(`storyline-graph: ${outPath} is up to date\n`);
    return 0;
  }

  writeFileSync(outPath, content, 'utf-8');
  process.stdout.write(`storyline-graph: wrote ${outPath}\n`);
  return 0;
}

// Re-exported so callers/tests can seed an explicit option registry before
// exporting (storylines declared outside the CSV).
export { registerStorylineOptions };
