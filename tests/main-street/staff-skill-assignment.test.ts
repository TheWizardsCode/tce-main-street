/**
 * Main Street: Staff specialization — type-consistent skill assignment & RNG
 * tests (MS-0MW4MSNMJ006E9JH, refining T1 CG-0MT4WXGSB002CP0P, parent
 * CG-0MT1CIWSD003VBPK).
 *
 * Validates the deterministic, type-consistent assignment contract for staff
 * applicants:
 * - AC1: the 16 skills are classified into 8 business-scope and 8
 *   management-company-scope entries, readable through `getSkillScope`.
 * - AC2: business staff draw only business-scope skills; management-company
 *   staff draw only management-company-scope skills and always carry the Town
 *   Gossip baseline first. The baseline never enters a business-staff pool.
 * - AC3: stacking — no staff member holds more than 1 income-boost AND more
 *   than 1 reputation-boost beyond the baseline, inside the filtered pool.
 * - AC4: 1–3 skills assigned per staff applicant, for both types.
 * - AC5: determinism — the same seed yields the same assignment stream, and the
 *   dedicated stream is independent of the slice of the catalog drawn.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';

import { createSeededRng } from '@core-engine/SeededRng';
import { createStaffDeck } from '../../src/MainStreetCards';
import {
  assignSkillsToApplicant,
  assignSkillsToApplicants,
  BASELINE_SKILL_ID,
  STAFF_SKILL_CATALOG,
  getSkillScope,
  staffCardScope,
  type SkillCategory,
  type SkillScope,
  type SpecializationSkill,
} from '../../src/MainStreetStaffSkills';

// ── Helpers ─────────────────────────────────────────────────

/** Number of independent seeds sampled for statistical properties. */
const SAMPLE_SEEDS = 500;

const BUSINESS: SkillScope = 'business';
const MANAGEMENT_COMPANY: SkillScope = 'management-company';

/** The authoritative classification from docs/game/specialization-skills.md. */
const EXPECTED_SCOPES: Record<string, SkillScope> = {
  'skill-networker': BUSINESS,
  'skill-chef': BUSINESS,
  'skill-dj': BUSINESS,
  'skill-sales-champion': BUSINESS,
  'skill-tech-guru': BUSINESS,
  'skill-community-builder': BUSINESS,
  'skill-pr-strategist': BUSINESS,
  'skill-operations-manager': BUSINESS,
  'skill-town-gossip': MANAGEMENT_COMPANY,
  'skill-brand-ambassador': MANAGEMENT_COMPANY,
  'skill-cost-cutter': MANAGEMENT_COMPANY,
  'skill-negotiator': MANAGEMENT_COMPANY,
  'skill-quality-inspector': MANAGEMENT_COMPANY,
  'skill-risk-manager': MANAGEMENT_COMPANY,
  'skill-security-consultant': MANAGEMENT_COMPANY,
  'skill-compliance': MANAGEMENT_COMPANY,
};

/** Counts skills in `skills` that fall into `category`. */
function countCategory(skills: readonly SpecializationSkill[], category: SkillCategory): number {
  return skills.filter(s => s.category === category).length;
}

/** Builds `count` independent assignments for `scope`, one per seed in 0..count-1. */
function sampleAssignments(scope: SkillScope, count: number = SAMPLE_SEEDS): SpecializationSkill[][] {
  const samples: SpecializationSkill[][] = [];
  for (let seed = 0; seed < count; seed += 1) {
    samples.push(assignSkillsToApplicant(createSeededRng(seed), scope));
  }
  return samples;
}

/** Returns the ids of an assignment in catalog order (order-insensitive compare helper). */
function sortIds(skills: readonly SpecializationSkill[]): string[] {
  return skills.map(s => s.id).sort();
}

/** Every catalog id whose scope is `scope`. */
function catalogIdsFor(scope: SkillScope): string[] {
  return STAFF_SKILL_CATALOG.filter(s => s.scope === scope).map(s => s.id);
}

// ── AC1: scope classification ───────────────────────────────

describe('AC1: skill scope classification', () => {
  it('classifies exactly the documented 8 business / 8 management-company skills', () => {
    const actual = Object.fromEntries(STAFF_SKILL_CATALOG.map(s => [s.id, s.scope]));
    expect(actual).toEqual(EXPECTED_SCOPES);
    expect(catalogIdsFor(BUSINESS)).toHaveLength(8);
    expect(catalogIdsFor(MANAGEMENT_COMPANY)).toHaveLength(8);
  });

  it('exposes the classification through getSkillScope (and fails loudly on unknown ids)', () => {
    for (const [id, scope] of Object.entries(EXPECTED_SCOPES)) {
      expect(getSkillScope(id), id).toBe(scope);
    }
    expect(() => getSkillScope('skill-does-not-exist')).toThrow(/Unknown specialization skill id/);
  });

  it('derives card type from employedAtSlot, falling back to the template marker', () => {
    const deck = createStaffDeck(1);
    // Assistant grants a hand slot → management-company template.
    const managementTemplate = deck.find(c => c.id.startsWith('staff-assistant'))!;
    // Chef grants no hand slot or action → business-staff template.
    const businessTemplate = deck.find(c => c.id.startsWith('staff-chef'))!;

    expect(staffCardScope(managementTemplate)).toBe(MANAGEMENT_COMPANY);
    expect(staffCardScope(businessTemplate)).toBe(BUSINESS);
    // A present employedAtSlot always means business staff, whatever the template.
    expect(staffCardScope({ ...managementTemplate, employedAtSlot: 0 })).toBe(BUSINESS);
  });
});

// ── AC2: type-consistent draw ───────────────────────────────

describe('AC2: business staff draw only business-scope skills', () => {
  it('never draws a management-company-scope id or the Town Gossip baseline', () => {
    const managementIds = new Set(catalogIdsFor(MANAGEMENT_COMPANY));
    for (const skills of sampleAssignments(BUSINESS)) {
      for (const skill of skills) {
        expect(skill.scope, skill.id).toBe(BUSINESS);
        expect(managementIds.has(skill.id), `${skill.id} leaked into a business pool`).toBe(false);
      }
      expect(skills.some(s => s.id === BASELINE_SKILL_ID)).toBe(false);
    }
  });

  it('covers every business-scope skill and category (no dead pool entries)', () => {
    const seen = new Set<string>();
    for (const skills of sampleAssignments(BUSINESS)) {
      for (const s of skills) seen.add(s.id);
    }
    expect([...seen].sort()).toEqual(catalogIdsFor(BUSINESS).sort());

    const categories = new Set<string>();
    for (const skills of sampleAssignments(BUSINESS)) {
      for (const s of skills) categories.add(s.category);
    }
    // Business staff can hold income boosts, per-business reputation and the
    // Operations Manager salary discount; incident mitigation is player scope.
    expect(categories).toEqual(new Set(['income-boost', 'reputation-boost', 'cost-reduction']));
  });
});

describe('AC2: management-company staff draw only player-scope skills + baseline', () => {
  it('never draws a business-scope id', () => {
    const businessIds = new Set(catalogIdsFor(BUSINESS));
    for (const skills of sampleAssignments(MANAGEMENT_COMPANY)) {
      for (const skill of skills) {
        expect(skill.scope, skill.id).toBe(MANAGEMENT_COMPANY);
        expect(businessIds.has(skill.id), `${skill.id} leaked into a management-company pool`).toBe(false);
      }
    }
  });

  it('always carries the Town Gossip baseline first, exactly once', () => {
    for (const skills of sampleAssignments(MANAGEMENT_COMPANY)) {
      expect(skills[0]?.id).toBe(BASELINE_SKILL_ID);
      expect(skills.filter(s => s.id === BASELINE_SKILL_ID)).toHaveLength(1);
    }
  });

  it('covers every management-company-scope skill and category', () => {
    const seen = new Set<string>();
    const categories = new Set<string>();
    for (const skills of sampleAssignments(MANAGEMENT_COMPANY)) {
      for (const s of skills) {
        seen.add(s.id);
        categories.add(s.category);
      }
    }
    expect([...seen].sort()).toEqual(catalogIdsFor(MANAGEMENT_COMPANY).sort());
    expect(categories).toEqual(
      new Set(['reputation-boost', 'cost-reduction', 'incident-mitigation']),
    );
  });
});

// ── AC3: stacking constraint inside the filtered pool ───────

describe('AC3: stacking constraint holds within each type-filtered pool', () => {
  it('business staff never hold >1 income-boost and >1 reputation-boost', () => {
    for (const skills of sampleAssignments(BUSINESS)) {
      expect(countCategory(skills, 'income-boost')).toBeLessThanOrEqual(1);
      expect(countCategory(skills, 'reputation-boost')).toBeLessThanOrEqual(1);
    }
  });

  it('management-company staff never hold >1 income-boost and >1 reputation-boost beyond baseline', () => {
    for (const skills of sampleAssignments(MANAGEMENT_COMPANY)) {
      expect(countCategory(skills, 'income-boost')).toBeLessThanOrEqual(1);
      const beyondBaseline = skills.filter(s => s.id !== BASELINE_SKILL_ID);
      expect(countCategory(beyondBaseline, 'reputation-boost')).toBeLessThanOrEqual(1);
    }
  });

  it('does not over-restrict: a 3-skill 1 income + 1 reputation business member is reachable', () => {
    const found = sampleAssignments(BUSINESS, SAMPLE_SEEDS * 10).some(
      skills =>
        skills.length === 3 &&
        countCategory(skills, 'income-boost') === 1 &&
        countCategory(skills, 'reputation-boost') === 1,
    );
    expect(found).toBe(true);
  });
});

// ── AC4: 1–3 skills per staff applicant ─────────────────────

describe('AC4: skill count per staff applicant is in [1..3] for both types', () => {
  for (const scope of [BUSINESS, MANAGEMENT_COMPANY] as const) {
    it(`${scope} assignments never fall outside 1–3 and reach every size`, () => {
      const sizes = new Set<number>();
      for (const skills of sampleAssignments(scope)) {
        expect(skills.length).toBeGreaterThanOrEqual(1);
        expect(skills.length).toBeLessThanOrEqual(3);
        sizes.add(skills.length);
      }
      expect(sizes).toEqual(new Set([1, 2, 3]));
    });
  }
});

// ── AC5: determinism ────────────────────────────────────────

describe('AC5: seeded RNG determinism', () => {
  for (const scope of [BUSINESS, MANAGEMENT_COMPANY] as const) {
    it(`${scope}: same seed produces the same skill set (and order)`, () => {
      const first = assignSkillsToApplicant(createSeededRng(7), scope);
      const second = assignSkillsToApplicant(createSeededRng(7), scope);
      expect(second.map(s => s.id)).toEqual(first.map(s => s.id));
    });

    it(`${scope}: same seed produces an identical assignment stream across many applicants`, () => {
      const first = assignSkillsToApplicants(createSeededRng(99), 40, scope);
      const second = assignSkillsToApplicants(createSeededRng(99), 40, scope);
      expect(second.map(a => a.map(s => s.id))).toEqual(first.map(a => a.map(s => s.id)));
    });

    it(`${scope}: different seeds produce varied assignments`, () => {
      const distinct = new Set(
        sampleAssignments(scope, 100).map(sortIds).map(ids => ids.join('|')),
      );
      expect(distinct.size).toBeGreaterThanOrEqual(2);
    });
  }

  it('the draw pool is selected by scope, not by the RNG stream', () => {
    // Same seed, different type ⇒ different (type-consistent) pools.
    const business = assignSkillsToApplicant(createSeededRng(1234), BUSINESS);
    const management = assignSkillsToApplicant(createSeededRng(1234), MANAGEMENT_COMPANY);
    expect(business.every(s => s.scope === BUSINESS)).toBe(true);
    expect(management.every(s => s.scope === MANAGEMENT_COMPANY)).toBe(true);
    expect(management.map(s => s.id)).not.toEqual(business.map(s => s.id));
  });
});
