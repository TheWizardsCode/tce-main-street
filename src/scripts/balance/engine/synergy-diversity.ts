/**
 * Synergy diversity (G4/HHI) report helpers.
 *
 * Pure, testable functions behind `synergy-diversity-report.ts`: per-difficulty
 * report assembly, dominance flagging (share > 40%), the markdown summary
 * table, and stable JSON formatting. Keeping the logic here lets the CLI stay
 * a thin wrapper that runs the canonical Monte Carlo profile.
 *
 * Parent work item: MS-0MUR9INHX001QCSE (C5 MS-0MVFR4RM20021KA4).
 *
 * @module
 */

import type { MonteCarloRunSummary } from '../../../MainStreetMonteCarlo';
import { computeSynergyDiversity } from './global-metrics';

/**
 * A synergy type is flagged as dominant when its share of all synergy-type
 * occurrences in a difficulty exceeds this threshold. A share of exactly 40%
 * is **not** dominant.
 */
export const SYNERGY_DOMINANCE_THRESHOLD = 0.4;

/** A single synergy type dominating one difficulty. */
export interface DominanceFinding {
  /** Difficulty the finding applies to (Easy / Medium / Hard). */
  difficulty: string;
  /** Dominant synergy type name. */
  synergyType: string;
  /** Share of synergy-type occurrences (0 to 1). */
  share: number;
}

/** G4 result for a single difficulty. */
export interface SynergyDiversityReportEntry {
  /** Difficulty label. */
  difficulty: string;
  /** Number of Monte Carlo runs in the difficulty. */
  runs: number;
  /** Herfindahl-Hirschman Index (0 to 10000). */
  hhi: number;
  /** Share of each synergy type (keyed by type name). */
  synergyTypeShares: Record<string, number>;
  /** Types whose share exceeds the dominance threshold (sorted). */
  dominantTypes: string[];
}

/** Monte Carlo runs grouped by difficulty. */
export interface SynergyDiversityRuns {
  difficulty: string;
  runs: readonly MonteCarloRunSummary[];
}

/** Canonical-profile metadata recorded alongside the report. */
export interface SynergyDiversityProfile {
  seeds: number;
  seedPrefix: string;
  maxTurns: number;
  strategy: string;
}

/** Full G4 report emitted by the CLI. */
export interface SynergyDiversityReport {
  /** Free-form label (e.g. `canonical`). */
  label: string;
  /** ISO timestamp of the run. */
  generatedAt: string;
  /** Full commit SHA the report was generated from (best-effort). */
  commitSha: string | null;
  /** Canonical profile metadata. */
  profile: SynergyDiversityProfile;
  /** One entry per difficulty. */
  entries: SynergyDiversityReportEntry[];
  /** One finding per dominant type/difficulty pair. */
  dominance: DominanceFinding[];
}

/**
 * Returns the synergy types whose share strictly exceeds `threshold`, sorted
 * alphabetically for deterministic output.
 */
export function findDominantTypes(
  synergyTypeShares: Record<string, number>,
  threshold: number = SYNERGY_DOMINANCE_THRESHOLD,
): string[] {
  return Object.entries(synergyTypeShares)
    .filter(([, share]) => share > threshold)
    .map(([type]) => type)
    .sort();
}

/**
 * Computes the G4 entry for one difficulty from its Monte Carlo runs.
 *
 * Returns a zero-HHI entry with empty shares when no run carries `finalGrid`
 * (graceful degradation, matching `computeSynergyDiversity`).
 */
export function buildSynergyDiversityEntry(
  difficulty: string,
  runs: readonly MonteCarloRunSummary[],
  synergyTypeMap: Record<string, readonly string[]>,
  threshold: number = SYNERGY_DOMINANCE_THRESHOLD,
): SynergyDiversityReportEntry {
  const result = computeSynergyDiversity([...runs], synergyTypeMap);
  const synergyTypeShares = result?.synergyTypeShares ?? {};
  return {
    difficulty,
    runs: runs.length,
    hhi: result?.hhi ?? 0,
    synergyTypeShares,
    dominantTypes: findDominantTypes(synergyTypeShares, threshold),
  };
}

/**
 * Assembles a report from per-difficulty entries and derives the dominance
 * findings. Findings are ordered by difficulty then by synergy type.
 */
export function assembleSynergyDiversityReport(
  entries: readonly SynergyDiversityReportEntry[],
  threshold: number = SYNERGY_DOMINANCE_THRESHOLD,
): { entries: SynergyDiversityReportEntry[]; dominance: DominanceFinding[] } {
  const dominance: DominanceFinding[] = [];
  for (const entry of entries) {
    for (const synergyType of findDominantTypes(entry.synergyTypeShares, threshold)) {
      dominance.push({
        difficulty: entry.difficulty,
        synergyType,
        share: entry.synergyTypeShares[synergyType] ?? 0,
      });
    }
  }
  return { entries: [...entries], dominance };
}

/**
 * Formats one warning line per dominance finding (for stderr and markdown).
 */
export function formatDominanceWarnings(
  findings: readonly DominanceFinding[],
  threshold: number = SYNERGY_DOMINANCE_THRESHOLD,
): string[] {
  return findings.map(
    finding =>
      `WARNING: synergy type "${finding.synergyType}" dominates ` +
      `${finding.difficulty} with a ${(finding.share * 100).toFixed(1)}% share ` +
      `(> ${(threshold * 100).toFixed(0)}%).`,
  );
}

/** Union of all synergy types across entries, sorted alphabetically. */
function collectSynergyTypes(entries: readonly SynergyDiversityReportEntry[]): string[] {
  const types = new Set<string>();
  for (const entry of entries) {
    for (const type of Object.keys(entry.synergyTypeShares)) types.add(type);
  }
  return [...types].sort();
}

/** Renders a share as a percentage, highlighting dominant values. */
function formatShare(share: number, dominant: boolean): string {
  const value = `${(share * 100).toFixed(1)}%`;
  return dominant ? `⚠ ${value}` : value;
}

/**
 * Renders the report as markdown: profile metadata, a per-difficulty summary
 * table (HHI plus every observed synergy type share, dominant values
 * highlighted), and one warning line per dominance finding.
 */
export function formatSynergyDiversityMarkdown(
  report: SynergyDiversityReport,
  threshold: number = SYNERGY_DOMINANCE_THRESHOLD,
): string {
  const { profile } = report;
  const types = collectSynergyTypes(report.entries);

  const header = ['Difficulty', 'Runs', 'HHI', ...types, 'Dominant types'];
  const align = ['---', '---:', '---:', ...types.map(() => '---:'), '---'];
  const rows = report.entries.map(entry => {
    const dominant = new Set(entry.dominantTypes);
    const cells = [
      entry.difficulty,
      String(entry.runs),
      String(entry.hhi),
      ...types.map(type => formatShare(entry.synergyTypeShares[type] ?? 0, dominant.has(type))),
      entry.dominantTypes.length > 0
        ? entry.dominantTypes.map(type => `⚠ ${type}`).join(', ')
        : '—',
    ];
    return `| ${cells.join(' | ')} |`;
  });

  const warnings = formatDominanceWarnings(report.dominance, threshold);

  return [
    `# Synergy diversity (G4/HHI) — ${report.label}`,
    '',
    `- Generated: ${report.generatedAt}`,
    `- Commit: ${report.commitSha ?? 'unknown'}`,
    `- Profile: ${profile.seeds} seeds, prefix \`${profile.seedPrefix}\`, ` +
      `${profile.maxTurns} max turns, ${profile.strategy}`,
    `- Dominance threshold: > ${(threshold * 100).toFixed(0)}% share of synergy-type occurrences`,
    '',
    `| ${header.join(' | ')} |`,
    `| ${align.join(' | ')} |`,
    ...rows,
    '',
    '## Dominance warnings',
    '',
    ...(warnings.length > 0 ? warnings.map(line => `- ${line}`) : ['- None.']),
    '',
  ].join('\n');
}

/** Stable JSON representation used by `--json` and the `--out` artefact. */
export function formatSynergyDiversityJson(report: SynergyDiversityReport): string {
  return JSON.stringify(report, null, 2);
}
