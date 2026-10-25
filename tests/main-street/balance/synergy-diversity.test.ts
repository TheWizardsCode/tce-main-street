import { describe, it, expect } from 'vitest';

/**
 * G4 synergy-diversity report contract (parent MS-0MUR9INHX001QCSE).
 *
 * These tests pin the pure helpers behind
 * `src/scripts/balance/synergy-diversity-report.ts`: per-difficulty report
 * assembly, >40% dominance flagging, the markdown summary table, and the
 * stable JSON key names.
 *
 * File references parent work item MS-0MUR9INHX001QCSE and child C4
 * (MS-0MVFR4QPY005OD6J).
 */
import {
  SYNERGY_DOMINANCE_THRESHOLD,
  assembleSynergyDiversityReport,
  buildSynergyDiversityEntry,
  findDominantTypes,
  formatDominanceWarnings,
  formatSynergyDiversityJson,
  formatSynergyDiversityMarkdown,
  type SynergyDiversityReport,
  type SynergyDiversityReportEntry,
  type SynergyDiversityRuns,
} from '../../../src/scripts/balance/engine/synergy-diversity';
import type { MonteCarloRunSummary } from '../../../src/MainStreetMonteCarlo';

/** Neutral run summary carrying only the fields G4 needs. */
function makeRun(finalGrid?: string[]): MonteCarloRunSummary {
  const base: MonteCarloRunSummary = {
    seed: 'test-001',
    result: 'win',
    endReason: 'score_threshold',
    finalScore: 150,
    finalCoins: 30,
    turns: 15,
    turnWhenGridHalf: null,
    turnWhenGridFull: null,
    noActionTurns: 0,
    cardsOwned: [],
    marketOffers: [],
    economyHistory: [],
  };
  return finalGrid ? { ...base, finalGrid } : base;
}

const TYPE_MAP: Record<string, string[]> = {
  'biz-food': ['Food'],
  'biz-food-2': ['Food'],
  'biz-culture': ['Culture'],
  'biz-dual': ['Food', 'Culture'],
};

function group(difficulty: string, grids: string[][]): SynergyDiversityRuns {
  return { difficulty, runs: grids.map(grid => makeRun(grid)) };
}

function entryFixture(
  difficulty: string,
  synergyTypeShares: Record<string, number>,
): SynergyDiversityReportEntry {
  return {
    difficulty,
    runs: 10,
    hhi: 3000,
    synergyTypeShares,
    dominantTypes: findDominantTypes(synergyTypeShares),
  };
}

function reportFixture(entries: SynergyDiversityReportEntry[]): SynergyDiversityReport {
  return {
    label: 'canonical',
    generatedAt: '2026-10-21T00:00:00.000Z',
    commitSha: 'abc1234',
    profile: {
      seeds: 200,
      seedPrefix: 'mc-balance',
      maxTurns: 60,
      strategy: 'greedy',
    },
    entries,
    dominance: assembleSynergyDiversityReport(entries).dominance,
  };
}

describe('synergy-diversity report assembly', () => {
  it('produces one entry per difficulty with HHI and type shares', () => {
    const groups = [
      group('Easy', [['biz-food', 'biz-food-2', 'biz-culture']]),
      group('Medium', [['biz-dual', 'biz-culture']]),
      group('Hard', [['biz-food']]),
    ];

    const report = assembleSynergyDiversityReport(
      groups.map(g => buildSynergyDiversityEntry(g.difficulty, g.runs, TYPE_MAP)),
    );

    expect(report.entries).toHaveLength(3);
    expect(report.entries.map(e => e.difficulty)).toEqual(['Easy', 'Medium', 'Hard']);

    const easy = report.entries[0];
    expect(easy.runs).toBe(1);
    // Easy: Food ×2, Culture ×1 → shares 2/3, 1/3 → HHI 0.5556 → 5556.
    expect(easy.hhi).toBe(5556);
    expect(easy.dominantTypes).toEqual(['Food']);
    expect(easy.synergyTypeShares.Food).toBeCloseTo(2 / 3, 3);
    expect(easy.synergyTypeShares.Culture).toBeCloseTo(1 / 3, 3);

    // Medium: dual (Food+Culture) + Culture → Food 1/3, Culture 2/3.
    const medium = report.entries[1];
    expect(medium.synergyTypeShares.Food).toBeCloseTo(1 / 3, 3);
    expect(medium.synergyTypeShares.Culture).toBeCloseTo(2 / 3, 3);
  });

  it('degrades to zero HHI and empty shares when no run carries finalGrid', () => {
    const entry = buildSynergyDiversityEntry('Easy', [makeRun()], TYPE_MAP);
    expect(entry).toEqual({
      difficulty: 'Easy',
      runs: 1,
      hhi: 0,
      synergyTypeShares: {},
      dominantTypes: [],
    });
  });
});

describe('synergy-diversity dominance flagging', () => {
  it('flags a share strictly greater than 40%', () => {
    expect(findDominantTypes({ Food: 0.39, Culture: 0.61 })).toEqual(['Culture']);
    expect(findDominantTypes({ Food: 0.75, Culture: 0.25 })).toEqual(['Food']);
  });

  it('does not flag a share of exactly 40%', () => {
    expect(SYNERGY_DOMINANCE_THRESHOLD).toBe(0.4);
    expect(findDominantTypes({ Food: 0.4, Culture: 0.3, Commerce: 0.3 })).toEqual([]);
  });

  it('reports one finding per dominant type and difficulty', () => {
    const entries = [
      entryFixture('Easy', { Food: 0.5, Culture: 0.5 }),
      entryFixture('Medium', { Food: 0.45, Culture: 0.3, Commerce: 0.25 }),
      entryFixture('Hard', { Food: 0.2, Culture: 0.2 }),
    ];

    const findings = assembleSynergyDiversityReport(entries).dominance;

    expect(findings).toHaveLength(3);
    expect(findings.map(f => `${f.difficulty}:${f.synergyType}`)).toEqual([
      'Easy:Culture',
      'Easy:Food',
      'Medium:Food',
    ]);
    expect(findings[2].share).toBeCloseTo(0.45, 3);
  });

  it('emits no findings when no type dominates', () => {
    const entries = [entryFixture('Easy', { Food: 0.3, Culture: 0.3, Commerce: 0.4 })];
    expect(assembleSynergyDiversityReport(entries).dominance).toEqual([]);
    expect(formatDominanceWarnings(assembleSynergyDiversityReport(entries).dominance)).toEqual([]);
  });

  it('emits one warning line per dominant finding', () => {
    const entries = [
      entryFixture('Easy', { Food: 0.45, Culture: 0.55 }),
      entryFixture('Hard', { Food: 0.55, Culture: 0.45 }),
    ];

    const warnings = formatDominanceWarnings(
      assembleSynergyDiversityReport(entries).dominance,
    );

    expect(warnings).toHaveLength(4);
    for (const warning of warnings) {
      expect(warning).toContain('WARNING');
      expect(warning).toContain('40');
    }
    expect(warnings.some(w => w.includes('Food') && w.includes('Hard'))).toBe(true);
  });
});

describe('synergy-diversity markdown', () => {
  it('renders a summary table with one row per difficulty and dominance highlighting', () => {
    const report = reportFixture([
      entryFixture('Easy', { Food: 0.5, Culture: 0.3, Commerce: 0.2 }),
      entryFixture('Medium', { Food: 0.1, Culture: 0.45, Commerce: 0.45 }),
    ]);

    const markdown = formatSynergyDiversityMarkdown(report);

    expect(markdown).toContain('# Synergy diversity (G4/HHI) — canonical');
    expect(markdown).toContain('200 seeds');
    expect(markdown).toContain('60 max turns');
    expect(markdown).toContain('greedy');
    // Header carries every observed type and the HHI column.
    expect(markdown).toMatch(/\| Difficulty \| Runs \| HHI \|/);
    for (const type of ['Food', 'Culture', 'Commerce']) {
      expect(markdown).toContain(`| ${type} `);
    }
    // One row per difficulty.
    expect(markdown).toMatch(/\| Easy \| 10 \|/);
    expect(markdown).toMatch(/\| Medium \| 10 \|/);
    // Dominant shares are highlighted.
    expect(markdown).toContain('⚠ Food');
    expect(markdown).toContain('⚠ Culture');
    // One warning line per finding: Food@Easy, Culture@Medium, Commerce@Medium.
    const warningLines = markdown
      .split('\n')
      .filter(line => line.includes('WARNING'));
    expect(warningLines).toHaveLength(3);
  });
});

describe('synergy-diversity JSON shape', () => {
  it('exposes stable key names for the --json output', () => {
    const report = reportFixture([entryFixture('Easy', { Food: 0.5, Culture: 0.5 })]);

    const parsed = JSON.parse(formatSynergyDiversityJson(report));

    expect(Object.keys(parsed).sort()).toEqual([
      'commitSha',
      'dominance',
      'entries',
      'generatedAt',
      'label',
      'profile',
    ]);
    expect(Object.keys(parsed.profile).sort()).toEqual([
      'maxTurns',
      'seedPrefix',
      'seeds',
      'strategy',
    ]);
    expect(Object.keys(parsed.entries[0]).sort()).toEqual([
      'difficulty',
      'dominantTypes',
      'hhi',
      'runs',
      'synergyTypeShares',
    ]);
    expect(Object.keys(parsed.dominance[0]).sort()).toEqual([
      'difficulty',
      'share',
      'synergyType',
    ]);
  });
});
