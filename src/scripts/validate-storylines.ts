/**
 * Storyline static validator
 *
 * Validates the shipped storyline/choice card graph without starting a game.
 * The core validation is a **pure function** over a list of `EventCard`s so it
 * can be exercised against deliberately-broken fixtures in unit tests; the CLI
 * wrapper (bottom of this file) runs it against the typed CSV model.
 *
 * Failure classes (hard errors — exit non-zero):
 *  - `dangling-link`   — a `hasChoices` card links to a card id that does not exist.
 *  - `unknown-target`  — a registered option successor references a missing card.
 *  - `duplicate-id`    — two templates share the same id.
 *  - `invalid-option`  — an option has an empty label or an invalid effect policy.
 *  - `cycle-error`     — (opt-in) a cycle treated as invalid; not used by default.
 *
 * Informational findings (do not fail validation, AC4):
 *  - `cycle`           — a cycle in the choice graph (the shipped tax chain is
 *                        an intentional, first-class cycle).
 *  - `self-link`       — a card whose successor is itself (still a cycle).
 *  - `multi-storyline` — one storylineId used across disjoint card sets is fine;
 *                        reported only as an inventory summary.
 *
 * Cycles are a **first-class shape** (approved decision 2026-09-29): they are
 * reported for visibility but never fail validation unless explicitly requested
 * via `{ failOnCycle: true }`.
 *
 * @module
 */

import { readFileSync } from 'node:fs';
import type { EventCard, StorylineOption } from '../MainStreetCardsTypes';
import { getBaseTypeId, getEventTemplates, loadTemplatesFromCsv } from '../MainStreetCards';
import {
  getStorylineOptions,
} from '../MainStreetStoryline';

// ── Result types ────────────────────────────────────────────

export type StorylineIssueKind =
  | 'dangling-link'
  | 'unknown-target'
  | 'duplicate-id'
  | 'invalid-option'
  | 'cycle-error';

export type StorylineFindingKind = 'cycle' | 'self-link';

export interface StorylineIssue {
  readonly kind: StorylineIssueKind;
  /** The base card id the issue was found on. */
  readonly cardId: string;
  /** The offending link/target, when applicable. */
  readonly target?: string;
  /** Human-readable explanation (identifies the offending card/link). */
  readonly message: string;
}

export interface StorylineFinding {
  readonly kind: StorylineFindingKind;
  /** The cycle path of base card ids, e.g. ['evt-tax-error', 'evt-tax', 'evt-tax-inquiry']. */
  readonly path: readonly string[];
  readonly message: string;
}

export interface StorylineValidationOptions {
  /** When true, cycles are reported as hard errors instead of informational. */
  readonly failOnCycle?: boolean;
  /** Explicit option registry override (defaults to the global registry). */
  readonly getOptions?: (card: EventCard) => StorylineOption[];
}

export interface StorylineValidationResult {
  /** Hard errors — any entry means the storylines are invalid. */
  readonly issues: readonly StorylineIssue[];
  /** Informational findings (cycles etc.) — never fail validation by default. */
  readonly findings: readonly StorylineFinding[];
  /** True when there are no hard errors. */
  readonly valid: boolean;
  /** Count of cards that present a choice (hasChoices or registered options). */
  readonly choiceCardCount: number;
  /** Storyline ids observed, sorted. */
  readonly storylineIds: readonly string[];
}

// ── Pure validation ─────────────────────────────────────────

/**
 * Validates a list of event cards' storyline graph.
 *
 * @param cards   Event templates to validate (shipped CSV or a fixture).
 * @param opts    Validation options (cycle policy, option registry override).
 * @returns The validation result (issues, findings, summary).
 */
export function validateStorylines(
  cards: readonly EventCard[],
  opts: StorylineValidationOptions = {},
): StorylineValidationResult {
  const issues: StorylineIssue[] = [];
  const findings: StorylineFinding[] = [];
  const optionGetter = opts.getOptions ?? ((c: EventCard) => getStorylineOptions(c));

  // ── Duplicate ids (raw, so template instances are not false positives) ──
  const seen = new Map<string, number>();
  for (const card of cards) {
    seen.set(card.id, (seen.get(card.id) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count > 1) {
      issues.push({
        kind: 'duplicate-id',
        cardId: id,
        message: `Duplicate card id "${id}" appears ${count} times.`,
      });
    }
  }

  // ── Known base ids (links reference base template ids) ──
  const knownIds = new Set(cards.map((c) => getBaseTypeId(c.id)));

  // ── Per-card link validation ──
  const choiceCards: EventCard[] = [];
  const storylineIds = new Set<string>();
  for (const card of cards) {
    const base = getBaseTypeId(card.id);
    if (card.storylineId) storylineIds.add(card.storylineId);

    const options = optionGetter(card);
    const isChoice = Boolean(card.hasChoices) || options.length > 0;
    if (!isChoice) continue;
    choiceCards.push(card);

    if (options.length === 0) {
      issues.push({
        kind: 'invalid-option',
        cardId: base,
        message: `Choice card "${base}" has no compiled storyline options.`,
      });
    }
    for (const option of options) {
      if (!option.label || option.label.trim() === '') {
        issues.push({
          kind: 'invalid-option',
          cardId: base,
          message: `Choice card "${base}" has an option with an empty label.`,
        });
      }
      if (option.effectPolicy !== 'apply' && option.effectPolicy !== 'skip') {
        issues.push({
          kind: 'invalid-option',
          cardId: base,
          message: `Choice card "${base}" option "${option.label}" has invalid effect policy "${String(option.effectPolicy)}".`,
        });
      }
      if (option.successorId) {
        const target = getBaseTypeId(option.successorId);
        if (!knownIds.has(target)) {
          issues.push({
            kind: 'dangling-link',
            cardId: base,
            target,
            message: `Choice card "${base}" option "${option.label}" links to unknown card "${target}".`,
          });
        }
      }
    }
  }

  // ── Cycle detection over the choice graph ──
  // Build an adjacency map of base id → successor base ids (only choice cards
  // can branch; terminal cards have no outgoing edges).
  const adjacency = new Map<string, string[]>();
  for (const card of choiceCards) {
    const base = getBaseTypeId(card.id);
    const next: string[] = [];
    for (const option of optionGetter(card)) {
      if (option.successorId) {
        const target = getBaseTypeId(option.successorId);
        if (knownIds.has(target)) next.push(target);
      }
    }
    if (next.length > 0) adjacency.set(base, next);
  }

  for (const cycle of findCycles(adjacency)) {
    const isSelf = cycle.length === 1;
    if (isSelf) {
      findings.push({
        kind: 'self-link',
        path: cycle,
        message: `Card "${cycle[0]}" links to itself (self-cycle).`,
      });
    } else {
      findings.push({
        kind: 'cycle',
        path: cycle,
        message: `Cycle detected: ${cycle.join(' -> ')} -> ${cycle[0]}`,
      });
    }
  }

  if (opts.failOnCycle) {
    for (const finding of findings) {
      issues.push({
        kind: 'cycle-error',
        cardId: finding.path[0] ?? '',
        message: finding.message,
      });
    }
  }

  return {
    issues,
    findings,
    valid: issues.length === 0,
    choiceCardCount: choiceCards.length,
    storylineIds: [...storylineIds].sort(),
  };
}

// ── Cycle detection (iterative DFS, reports each elementary cycle once) ──

/**
 * Finds cycles in a directed graph. Returns each distinct cycle as an array of
 * nodes in traversal order (the closing edge is implicit). Duplicate rotations
 * of the same cycle are collapsed.
 */
export function findCycles(adjacency: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const seenKeys = new Set<string>();
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<string, number>();
  const stack: string[] = [];

  const keyOf = (path: string[]): string => {
    // Rotate so the smallest node is first, then join — collapses rotations.
    if (path.length === 0) return '';
    let min = 0;
    for (let i = 1; i < path.length; i++) if (path[i] < path[min]) min = i;
    const rotated = [...path.slice(min), ...path.slice(0, min)];
    return rotated.join('|');
  };

  const visit = (node: string): void => {
    colour.set(node, GREY);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const c = colour.get(next) ?? WHITE;
      if (c === GREY) {
        // Found a cycle: slice the stack from the first occurrence of `next`.
        const start = stack.indexOf(next);
        const cycle = stack.slice(start);
        const k = keyOf(cycle);
        if (!seenKeys.has(k)) {
          seenKeys.add(k);
          cycles.push(cycle);
        }
      } else if (c === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    colour.set(node, BLACK);
  };

  for (const node of adjacency.keys()) {
    if ((colour.get(node) ?? WHITE) === WHITE) visit(node);
  }
  return cycles;
}

// ── Renderers ───────────────────────────────────────────────

/** Renders a human-readable report for CLI output. */
export function formatStorylineReport(result: StorylineValidationResult): string {
  const lines: string[] = [];
  lines.push('Storyline validation report');
  lines.push('===========================');
  lines.push(`Choice cards: ${result.choiceCardCount}`);
  lines.push(`Storylines: ${result.storylineIds.length > 0 ? result.storylineIds.join(', ') : '(none)'}`);
  lines.push('');
  if (result.issues.length > 0) {
    lines.push(`ERRORS (${result.issues.length}):`);
    for (const issue of result.issues) lines.push(`  ✗ [${issue.kind}] ${issue.message}`);
  } else {
    lines.push('ERRORS (0): none');
  }
  lines.push('');
  lines.push(`Informational findings (${result.findings.length}):`);
  if (result.findings.length === 0) {
    lines.push('  (none)');
  } else {
    for (const finding of result.findings) lines.push(`  ℹ [${finding.kind}] ${finding.message}`);
  }
  lines.push('');
  lines.push(result.valid ? 'RESULT: VALID' : 'RESULT: INVALID');
  return lines.join('\n');
}

/** Renders a stable JSON representation (for tooling/CI consumption). */
export function storylineReportToJson(result: StorylineValidationResult): string {
  return JSON.stringify(
    {
      valid: result.valid,
      choiceCardCount: result.choiceCardCount,
      storylineIds: result.storylineIds,
      issues: result.issues,
      findings: result.findings,
    },
    null,
    2,
  );
}

// ── CLI ─────────────────────────────────────────────────────

/**
 * Runs the validator against the currently-loaded template registry and
 * returns the process exit code (0 = valid, 1 = invalid).
 *
 * The registry is the typed CSV model, so validation reuses the parser rather
 * than re-reading the CSV by hand (AC2).
 */
export function runValidatorCli(argv: readonly string[] = process.argv.slice(2)): number {
  const asJson = argv.includes('--json');
  const failOnCycle = argv.includes('--fail-on-cycle');
  const csvArgIndex = argv.indexOf('--csv');
  const csvPath = csvArgIndex >= 0 ? argv[csvArgIndex + 1] : undefined;

  // `--csv <path>` validates a specific CSV through the typed parser/model,
  // used by the CLI exit-code tests to exercise deliberately broken fixtures.
  if (csvPath) {
    const csvText = readFileSync(csvPath, 'utf-8');
    loadTemplatesFromCsv(csvText);
  }

  const result = validateStorylines(getEventTemplates(), { failOnCycle });

  if (asJson) {
    console.log(storylineReportToJson(result));
  } else {
    console.log(formatStorylineReport(result));
  }
  return result.valid ? 0 : 1;
}

// Imported here to keep the pure-validation surface usable by fixtures that
// import the pure functions without needing the template registry.

// ── CLI entry is in validate-storylines-cli.ts ──────────────
// The pure validation surface lives here so tests can import it without
// triggering a CLI run. The npm script `validate:storylines` points at the
// thin CLI entry point (`src/scripts/validate-storylines-cli.ts`).
