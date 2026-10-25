/**
 * Card diagrams: deterministic documentation diagrams for the card model.
 *
 * Generalises the `storylines:graph` conventions (deterministic manifest →
 * committed Mermaid artefact + `--check` drift guard) to the non-storyline
 * datasets of `src/card-data.csv`:
 *
 *  - `synergies`         → businesses/community spaces ↔ synergy types
 *  - `staff`             → staff ↔ allowed targets + specialisation skills
 *  - `upgrades`          → upgrade chains rooted at the upgraded card
 *  - `community-spaces`  → community-space relationships
 *
 * Every builder is pure and deterministic: nodes and edges are sorted by id
 * and there is no RNG, timestamp or wall-clock input, so regenerating from the
 * same CSV always produces byte-identical output (AC5).
 *
 * The generator is dev tooling only — it adds no runtime dependency and never
 * mutates card data (read-only over `getBusinessTemplates` and friends).
 *
 * @module
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  getBusinessTemplates,
  getCommunitySpaceTemplates,
  getStaffCardTemplates,
  getUpgradeTemplates,
} from '../MainStreetCards';
import { getAllowedBusinessTypesForStaff } from '../MainStreetCardsUtils';
import { STAFF_SKILL_CATALOG } from '../MainStreetStaffSkills';
import { SYNERGY_TYPE_NAMES } from '../MainStreetCardsTypes';

// ── Manifest types ──────────────────────────────────────────

/** The diagram domains the CLI knows about. */
export type DiagramId = 'synergies' | 'staff' | 'upgrades' | 'community-spaces';

/** Visual category of a diagram node (drives the Mermaid shape). */
export type DiagramNodeKind =
  | 'business'
  | 'community-space'
  | 'synergy'
  | 'staff'
  | 'skill'
  | 'skill-category'
  | 'upgrade';

export interface DiagramNode {
  /** Stable, unique node id (card id or synthetic domain id). */
  readonly id: string;
  /** Human-readable display name. */
  readonly name: string;
  /** Visual category. */
  readonly kind: DiagramNodeKind;
  /** Optional informational detail line (e.g. costs/buffs), when set. */
  readonly detail?: string;
}

export interface DiagramEdge {
  /** Source node id. */
  readonly from: string;
  /** Target node id. */
  readonly to: string;
  /** Optional edge label (e.g. the synergy type or a cost). */
  readonly label?: string;
}

export interface CardDiagram {
  /** Diagram domain id. */
  readonly id: DiagramId;
  /** Human-readable title. */
  readonly title: string;
  /** Sorted nodes. */
  readonly nodes: readonly DiagramNode[];
  /** Sorted edges. */
  readonly edges: readonly DiagramEdge[];
}

export interface CardDiagramsManifest {
  /** Manifest schema version. */
  readonly version: number;
  /** Generator provenance (deterministic — no timestamp). */
  readonly source: string;
  /** Selected diagrams, in canonical domain order. */
  readonly diagrams: readonly CardDiagram[];
}

// ── Deterministic ordering ──────────────────────────────────

/** Compares two strings for deterministic (codepoint) ordering. */
function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sorts nodes by id and edges by (from, to, label). */
function sortDiagram(diagram: CardDiagram): CardDiagram {
  const nodes = [...diagram.nodes].sort((a, b) => byString(a.id, b.id));
  const edges = [...diagram.edges].sort((a, b) => {
    const from = byString(a.from, b.from);
    if (from !== 0) return from;
    const to = byString(a.to, b.to);
    if (to !== 0) return to;
    return byString(a.label ?? '', b.label ?? '');
  });
  return { ...diagram, nodes, edges };
}

// ── builders ────────────────────────────────────────────────

/** Synergy type node id, e.g. `synergy-food`. */
export function synergyNodeId(synergy: string): string {
  return `synergy-${synergy.toLowerCase()}`;
}

/**
 * Builds the card-synergy diagram: every business and community-space card as
 * a node, all six synergy types as nodes, and one edge per card↔synergy
 * membership.
 *
 * @returns The deterministic card-synergy diagram.
 */
export function buildSynergyDiagram(): CardDiagram {
  const nodes: DiagramNode[] = SYNERGY_TYPE_NAMES.map((synergy) => ({
    id: synergyNodeId(synergy),
    name: synergy,
    kind: 'synergy',
  }));
  const edges: DiagramEdge[] = [];

  const addCards = (
    cards: readonly { readonly id: string; readonly name: string; readonly synergyTypes: readonly string[] }[],
    kind: 'business' | 'community-space',
  ): void => {
    for (const card of cards) {
      nodes.push({ id: card.id, name: card.name, kind });
      for (const synergy of card.synergyTypes) {
        edges.push({ from: card.id, to: synergyNodeId(synergy), label: synergy });
      }
    }
  };

  addCards(getBusinessTemplates(), 'business');
  addCards(getCommunitySpaceTemplates(), 'community-space');

  return sortDiagram({
    id: 'synergies',
    title: 'Card synergies',
    nodes,
    edges,
  });
}

/**
 * Builds the community-space relationship diagram: every community-space card
 * as a node with one edge per synergy membership, plus each community-space
 * upgrade reachable via `targetBusiness` (labelled with `newDisplayName` and
 * `requiredLevel`, and carrying cost/buff details where set).
 *
 * @returns The deterministic community-space relationship diagram.
 */
export function buildCommunitySpacesDiagram(): CardDiagram {
  const spaces = getCommunitySpaceTemplates();

  const nodes: DiagramNode[] = spaces.map((space) => {
    const detailParts: string[] = [];
    if (space.ongoingCost > 0) detailParts.push(`ongoing ${space.ongoingCost} coins/turn`);
    if ((space.reputationPerTurn ?? 0) > 0) detailParts.push(`+${space.reputationPerTurn} rep/turn`);
    return {
      id: space.id,
      name: space.name,
      kind: 'community-space',
      detail: detailParts.length > 0 ? detailParts.join(' · ') : undefined,
    };
  });
  const edges: DiagramEdge[] = [];
  const usedSynergies = new Set<string>();

  for (const space of spaces) {
    for (const synergy of space.synergyTypes) {
      usedSynergies.add(synergy);
      edges.push({ from: space.id, to: synergyNodeId(synergy), label: synergy });
    }
    // One edge per community-space upgrade, labelled with the new display
    // name and the required level (informational; the node carries buffs/cost).
    const upgrades = getUpgradeTemplates().filter(
      (upgrade) => upgrade.targetBusiness === space.name,
    );
    for (const upgrade of upgrades) {
      nodes.push({
        id: upgrade.id,
        name: upgrade.newDisplayName ?? upgrade.name,
        kind: 'upgrade',
        detail: upgradeDetail(upgrade),
      });
      edges.push({
        from: space.id,
        to: upgrade.id,
        label: `${upgrade.newDisplayName ?? upgrade.name} · level ${upgrade.requiredLevel ?? 0}`,
      });
    }
  }

  for (const synergy of usedSynergies) {
    nodes.push({ id: synergyNodeId(synergy), name: synergy, kind: 'synergy' });
  }

  return sortDiagram({
    id: 'community-spaces',
    title: 'Community-space relationships',
    nodes,
    edges,
  });
}

/** Formats an upgrade's cost/buff fields compactly (empty when none set). */
function upgradeDetail(upgrade: {
  readonly cost: number;
  readonly incomeBonus: number;
  readonly reputationBonus?: number;
}): string | undefined {
  const parts: string[] = [`cost ${upgrade.cost}`];
  if (upgrade.incomeBonus > 0) parts.push(`income +${upgrade.incomeBonus}`);
  if ((upgrade.reputationBonus ?? 0) > 0) parts.push(`rep +${upgrade.reputationBonus}`);
  return parts.join(' · ');
}

/** Stable node id for an allowed-target business name (slugified). */
function businessNodeId(name: string): string {
  return `biz-token-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/**
 * Builds the staff relationship diagram: every staff card as a node with one
 * edge to each synergy type or named business it may serve (resolved through
 * `getAllowedBusinessTypesForStaff`), plus the specialisation-skill catalogue
 * grouped under its category nodes (one node per skill, reachable from its
 * category).
 *
 * @returns The deterministic staff relationship diagram.
 */
export function buildStaffDiagram(): CardDiagram {
  const staffCards = getStaffCardTemplates();
  const businessByName = new Map(getBusinessTemplates().map((b) => [b.name, b.id]));
  const spaceByName = new Map(getCommunitySpaceTemplates().map((c) => [c.name, c.id]));
  const synergySet = new Set<string>(SYNERGY_TYPE_NAMES);

  const nodes: DiagramNode[] = staffCards.map((staff) => ({
    id: staff.id,
    name: staff.name,
    kind: 'staff',
    detail: staff.ongoingCost > 0 ? `ongoing ${staff.ongoingCost} coins/turn` : undefined,
  }));
  const edges: DiagramEdge[] = [];
  const targetNodes = new Map<string, DiagramNode>();

  /** Adds a staff→target edge, creating the target node on first use. */
  const addTarget = (staffId: string, token: string): void => {
    let target: DiagramNode;
    if (synergySet.has(token)) {
      const id = synergyNodeId(token);
      target = targetNodes.get(id) ?? { id, name: token, kind: 'synergy' };
    } else {
      const businessId = businessByName.get(token) ?? spaceByName.get(token);
      if (businessId) {
        target = targetNodes.get(businessId) ?? { id: businessId, name: token, kind: 'business' };
      } else {
        const id = businessNodeId(token);
        target = targetNodes.get(id) ?? { id, name: token, kind: 'business' };
      }
    }
    if (!targetNodes.has(target.id)) targetNodes.set(target.id, target);
    edges.push({ from: staffId, to: target.id, label: token });
  };

  for (const staff of staffCards) {
    for (const token of getAllowedBusinessTypesForStaff(staff)) {
      addTarget(staff.id, token);
    }
  }

  // Skill catalogue: one node per skill grouped under its category.
  const categories = new Set(STAFF_SKILL_CATALOG.map((skill) => skill.category));
  for (const category of categories) {
    const id = `skill-category-${category}`;
    nodes.push({ id, name: category.replace(/-/g, ' '), kind: 'skill-category' });
  }
  for (const skill of STAFF_SKILL_CATALOG) {
    nodes.push({ id: skill.id, name: skill.name, kind: 'skill' });
    edges.push({
      from: `skill-category-${skill.category}`,
      to: skill.id,
      label: skill.effect,
    });
  }

  nodes.push(...targetNodes.values());

  return sortDiagram({
    id: 'staff',
    title: 'Staff relationships & specialisations',
    nodes,
    edges,
  });
}

/** Fields of an upgrade card needed to build the chain diagram. */
interface UpgradeLike {
  readonly id: string;
  readonly name: string;
  readonly targetBusiness: string;
  readonly cost: number;
  readonly incomeBonus: number;
  readonly reputationBonus?: number;
  readonly newDisplayName?: string;
  readonly requiredLevel?: number;
}

/**
 * Resolves the parent of a multi-level upgrade inside its target's chain: the
 * highest-income upgrade exactly one level lower (ties broken by id). This is
 * the deterministic rule that reproduces the four shipped level-2 chains:
 * Bread Factory → Grand Bakehouse, Fast Food → Restaurant,
 * IMAX → Multiplex, Resort Spa → Luxury Retreat.
 *
 * @returns The parent upgrade, or null for a level-0 (root-branch) upgrade.
 */
function findUpgradeParent(
  chain: readonly UpgradeLike[],
  upgrade: UpgradeLike,
): UpgradeLike | null {
  const level = upgrade.requiredLevel ?? 0;
  if (level === 0) return null;
  const candidates = chain.filter((candidate) => (candidate.requiredLevel ?? 0) === level - 1);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if (b.incomeBonus !== a.incomeBonus) return b.incomeBonus - a.incomeBonus;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0]!;
}

/**
 * Builds the upgrade chain diagram: each upgradeable business/community space
 * as a chain root, each level-0 upgrade branching directly from it, and each
 * multi-level upgrade succeeding its level-1 step (so the level-2 gate is
 * visible). Upgrade nodes are labelled with `newDisplayName` and carry
 * cost/income/reputation detail.
 *
 * @returns The deterministic upgrade chain diagram.
 */
export function buildUpgradeDiagram(): CardDiagram {
  const cards = [...getBusinessTemplates(), ...getCommunitySpaceTemplates()];
  const cardByName = new Map(cards.map((card) => [card.name, card]));
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const cardKindById = new Map<string, 'business' | 'community-space'>([
    ...getBusinessTemplates().map((card) => [card.id, 'business'] as const),
    ...getCommunitySpaceTemplates().map((card) => [card.id, 'community-space'] as const),
  ]);
  const chainByCardId = new Map<string, UpgradeLike[]>();

  for (const upgrade of getUpgradeTemplates()) {
    const card = cardByName.get(upgrade.targetBusiness);
    if (!card) continue;
    const chain = chainByCardId.get(card.id) ?? [];
    chain.push(upgrade);
    chainByCardId.set(card.id, chain);
  }

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  for (const [cardId, chain] of chainByCardId) {
    const card = cardsById.get(cardId)!;
    nodes.push({
      id: card.id,
      name: card.name,
      kind: cardKindById.get(cardId) ?? 'business',
      detail: card.maxLevel > 0 ? `max level ${card.maxLevel}` : undefined,
    });
    for (const upgrade of chain) {
      nodes.push({
        id: upgrade.id,
        name: upgrade.newDisplayName ?? upgrade.name,
        kind: 'upgrade',
        detail: upgradeDetail(upgrade),
      });
      const parent = findUpgradeParent(chain, upgrade);
      edges.push({
        from: parent ? parent.id : cardId,
        to: upgrade.id,
        label: `${upgrade.newDisplayName ?? upgrade.name} · level ${upgrade.requiredLevel ?? 0}`,
      });
    }
  }

  return sortDiagram({
    id: 'upgrades',
    title: 'Upgrade chains',
    nodes,
    edges,
  });
}

/**
 * Registry of diagram builders. Domains are added here as their builders land
 * (F2–F4); `listDiagramIds()` is the source of truth for the CLI's default
 * `all` selection.
 */
const DIAGRAM_BUILDERS: Partial<Record<DiagramId, () => CardDiagram>> = {
  synergies: buildSynergyDiagram,
  'community-spaces': buildCommunitySpacesDiagram,
  staff: buildStaffDiagram,
  upgrades: buildUpgradeDiagram,
};

/** Canonical domain order (`--diagram all` and the JSON manifest). */
const DIAGRAM_ORDER: readonly DiagramId[] = [
  'synergies',
  'staff',
  'upgrades',
  'community-spaces',
];

/**
 * Returns the diagram domains that have a registered builder, in canonical
 * order.
 *
 * @returns The available diagram ids.
 */
export function listDiagramIds(): DiagramId[] {
  return DIAGRAM_ORDER.filter((id) => DIAGRAM_BUILDERS[id] !== undefined);
}

/**
 * Builds one diagram by domain id.
 *
 * @param id The diagram domain.
 * @returns The deterministic diagram.
 * @throws When the domain has no registered builder yet.
 */
export function buildCardDiagram(id: DiagramId): CardDiagram {
  const builder = DIAGRAM_BUILDERS[id];
  if (!builder) {
    throw new Error(
      `card-diagrams: diagram "${id}" is not available yet (available: ${listDiagramIds().join(', ')})`,
    );
  }
  return builder();
}

/**
 * Builds the combined manifest for the selected diagrams, in canonical order.
 *
 * @param ids The selected diagram ids (defaults to every registered domain).
 * @returns The deterministic manifest.
 */
export function buildCardDiagramsManifest(
  ids: readonly DiagramId[] = listDiagramIds(),
): CardDiagramsManifest {
  const selected = new Set(ids);
  return {
    version: 1,
    source:
      'Generated from src/card-data.csv via the typed card model (deterministic; do not hand-edit).',
    diagrams: DIAGRAM_ORDER.filter((id) => selected.has(id)).map((id) => buildCardDiagram(id)),
  };
}

/** Serialises the manifest to stable, pretty-printed JSON (trailing newline). */
export function serializeCardDiagramsManifest(manifest: CardDiagramsManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

// ── Mermaid rendering ───────────────────────────────────────

/** Escapes a Mermaid node id (the grammar only accepts simple ids). */
function mermaidId(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, '_');
}

/** Escapes a Mermaid edge label (quotes + angle brackets). */
function mermaidLabel(label: string): string {
  return label.replace(/"/g, "'");
}

/**
 * Renders one diagram as a Mermaid flowchart.
 *
 * Node shapes encode the kind (cards rounded, synergy types circular, staff
 * and upgrades rectangular) so a diagram is readable on its own. Node and edge
 * order follow the manifest's sorted order (deterministic).
 *
 * @param diagram The diagram to render.
 * @returns The Mermaid document (trailing newline).
 */
export function renderDiagramMermaid(diagram: CardDiagram): string {
  const lines: string[] = [];
  lines.push('%%{ init: { "flowchart": { "curve": "basis" } } }%%');
  lines.push('flowchart LR');
  lines.push('');
  lines.push(`  %% ${diagram.title} — generated from src/card-data.csv; do not hand-edit.`);
  lines.push('');

  for (const node of diagram.nodes) {
    const id = mermaidId(node.id);
    const detail = node.detail ? `<br/>${node.detail}` : '';
    const label = mermaidLabel(`${node.name}<br/>${node.id}${detail}`);
    const shape = nodeShape(node.kind, id, label);
    lines.push(`  ${shape}`);
  }

  if (diagram.edges.length > 0) lines.push('');

  for (const edge of diagram.edges) {
    const from = mermaidId(edge.from);
    const to = mermaidId(edge.to);
    const label = edge.label ? `|${mermaidLabel(edge.label)}|` : '';
    lines.push(`  ${from} -->${label} ${to}`);
  }

  lines.push('');
  return lines.join('\n');
}

/** Returns the Mermaid declaration for a node, shaped by its kind. */
function nodeShape(kind: DiagramNodeKind, id: string, label: string): string {
  switch (kind) {
    case 'synergy':
      return `${id}(("${label}"))`;
    case 'staff':
    case 'skill':
    case 'skill-category':
    case 'upgrade':
      return `${id}["${label}"]`;
    case 'business':
    case 'community-space':
    default:
      return `${id}("${label}")`;
  }
}

// ── CLI ─────────────────────────────────────────────────────

/** Output format for the CLI. */
export type DiagramFormat = 'mermaid' | 'json';

export interface DiagramCliOptions {
  /** Selected diagram ids, in canonical order. */
  readonly diagrams: readonly DiagramId[];
  /** Output format. */
  readonly format: DiagramFormat;
  /** Explicit output path (single artefact / manifest). */
  readonly out?: string;
  /** Drift-guard mode: compare instead of write. */
  readonly check: boolean;
}

/** All domain ids accepted by `--diagram`, whether implemented or not. */
const ALL_DIAGRAM_IDS: readonly DiagramId[] = DIAGRAM_ORDER;

/** Default committed artefact path per diagram (Mermaid). */
const MERMAID_ARTEFACTS: Record<DiagramId, string> = {
  synergies: 'docs/dev/assets/card-synergies.mmd',
  staff: 'docs/dev/assets/staff-relationships.mmd',
  upgrades: 'docs/dev/assets/upgrade-chains.mmd',
  'community-spaces': 'docs/dev/assets/community-space-relationships.mmd',
};

/** Default JSON manifest path (on-demand, not committed). */
const JSON_ARTEFACT = 'docs/dev/assets/card-diagrams.json';

/**
 * Parses CLI args for the diagram generator.
 *
 * @param argv Raw CLI arguments (without the script name).
 * @returns The parsed options.
 * @throws When `--diagram` names an unknown domain.
 */
export function parseDiagramArgs(argv: readonly string[]): DiagramCliOptions {
  const diagramIdx = argv.indexOf('--diagram');
  const rawDiagram = diagramIdx >= 0 ? argv[diagramIdx + 1] : 'all';
  let diagrams: DiagramId[];
  if (rawDiagram === 'all') {
    diagrams = listDiagramIds();
  } else if (ALL_DIAGRAM_IDS.includes(rawDiagram as DiagramId)) {
    diagrams = [rawDiagram as DiagramId];
  } else {
    throw new Error(
      `card-diagrams: unknown --diagram "${rawDiagram}" (expected all|${ALL_DIAGRAM_IDS.join('|')})`,
    );
  }

  const fmtIdx = argv.indexOf('--format');
  const rawFormat = fmtIdx >= 0 ? argv[fmtIdx + 1] : 'mermaid';
  const format: DiagramFormat = rawFormat === 'json' ? 'json' : 'mermaid';
  const outIdx = argv.indexOf('--out');
  const out = outIdx >= 0 ? argv[outIdx + 1] : undefined;
  return { diagrams, format, out, check: argv.includes('--check') };
}

/** Writes `content` to `outPath`, creating parent directories as needed. */
function writeArtefact(outPath: string, content: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content, 'utf-8');
}

/**
 * Runs the diagram CLI: builds the selected diagrams and either writes the
 * artefacts or (with `--check`) compares them against the committed files.
 *
 * Mermaid mode writes one file per selected diagram (default
 * `docs/dev/assets/<name>.mmd`); JSON mode writes a single manifest. `--out`
 * is only valid when it resolves to a single artefact.
 *
 * @returns Process exit code (0 = success / no drift, 1 = drift or bad args).
 */
export function runDiagramCli(argv: readonly string[] = process.argv.slice(2)): number {
  let opts: DiagramCliOptions;
  try {
    opts = parseDiagramArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }

  if (opts.diagrams.length === 0) {
    process.stderr.write('card-diagrams: no diagrams selected (no builders registered)\n');
    return 1;
  }

  try {
    if (opts.format === 'json') {
      const manifest = buildCardDiagramsManifest(opts.diagrams);
      const content = serializeCardDiagramsManifest(manifest);
      const outPath = resolve(process.cwd(), opts.out ?? JSON_ARTEFACT);
      return writeOrCheck(outPath, content, opts.check, 'card-diagrams');
    }

    // Mermaid: one artefact per selected diagram.
    if (opts.out && opts.diagrams.length > 1) {
      process.stderr.write(
        'card-diagrams: --out is only supported for a single diagram with --format mermaid\n',
      );
      return 1;
    }

    let exitCode = 0;
    for (const id of opts.diagrams) {
      const content = renderDiagramMermaid(buildCardDiagram(id));
      const outPath = resolve(process.cwd(), opts.out ?? MERMAID_ARTEFACTS[id]);
      const code = writeOrCheck(outPath, content, opts.check, 'card-diagrams');
      if (code !== 0) exitCode = code;
    }
    return exitCode;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

/**
 * Writes `content` to `outPath`, or with `check` compares it against the
 * committed file and reports drift/missing artefacts on stderr.
 *
 * @returns 0 when written/up to date, 1 on drift or a missing artefact.
 */
function writeOrCheck(
  outPath: string,
  content: string,
  check: boolean,
  toolName: string,
): number {
  if (check) {
    if (!existsSync(outPath)) {
      process.stderr.write(`${toolName}: missing committed artefact ${outPath}\n`);
      return 1;
    }
    const existing = readFileSync(outPath, 'utf-8');
    if (existing !== content) {
      process.stderr.write(
        `${toolName}: drift detected in ${outPath} — regenerate with \`npm run docs:diagrams\`\n`,
      );
      return 1;
    }
    process.stdout.write(`${toolName}: ${outPath} is up to date\n`);
    return 0;
  }

  writeArtefact(outPath, content);
  process.stdout.write(`${toolName}: wrote ${outPath}\n`);
  return 0;
}
