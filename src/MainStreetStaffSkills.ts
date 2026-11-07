/**
 * Main Street: Staff specialization skills (CG-0MT1CIWSD003VBPK)
 *
 * Pure skill catalog + deterministic skill assignment for staff applicants.
 * Skills are randomized once at game start and locked for the full game
 * (established by CG-0MSTOATDU006UGAX); the assignment functions here produce
 * that locked roster from a seeded RNG so a given seed always yields the same
 * skills (same-seed ⇒ same-game determinism, mirroring the engine's shuffled
 * decks).
 *
 * Assignment rules (MS-0MW4MSNMJ006E9JH, refining AC3/AC4 of
 * CG-0MT1CIWSD003VBPK):
 * - Every staff applicant receives 1–3 skills.
 * - Skills are **type-consistent**: business staff draw only business-scope
 *   skills, management-company staff draw only management-company-scope
 *   skills. A skill's `scope` (see `getSkillScope`) must match the holder's
 *   staff type (GDD D.4.8: a skill is inert when the scopes differ).
 *   Assignment is one half of that invariant; the effect half is the
 *   staff-type scope gate at the aggregation site in `MainStreetStaffBuffs`
 *   (`getStreetScopeSkills` for player/street effects, `getBusinessScopeSkills`
 *   for per-business effects, `getSalaryScopeSkills` for the Operations
 *   Manager salary discount), so a cross-type skill from a legacy save is
 *   inert even though it can still be persisted.
 * - `skill-town-gossip` (the Town Gossip peek mechanic,
 *   CG-0MSXOW6GN008ZSMN) is the baseline skill on every management-company
 *   card and is never drawn into a business-staff pool.
 * - Stacking constraint: no staff member may hold more than 1 income-boost
 *   skill AND more than 1 reputation-boost skill simultaneously, preventing
 *   runaway stacking. The baseline Town Gossip is exempt from this cap — it is
 *   a fixed informational ability (peek) rather than a stacking boost, and
 *   exempting it keeps the reputation pool reachable.
 *
 * Staff type (GDD D.4.2/D.4.7/D.4.8): the type is a property of the card
 * template. At runtime a member carrying `employedAtSlot` is business staff and
 * one without is management-company staff. Cards in the deck and market row
 * are not employed yet, so `staffCardScope` falls back to the template marker
 * the GDD defines — `handSlotsAdded > 0` or `actionsPerTurn > 0` means
 * management-company staff, everything else business staff.
 *
 * Skills only modify computations through the buff helpers in
 * `MainStreetStaffBuffs` / adjacency wiring; this module stays free of engine
 * or state imports so it can be unit-tested headlessly.
 *
 * The canonical `SpecializationSkill` / `SpecializationSkillCategory` types
 * live in `MainStreetCards` (I2, CG-0MT4WXQCN001G1LF) and are re-exported
 * here for backward compatibility with earlier imports.
 *
 * @module
 */

import type { SpecializationSkill, SpecializationSkillCategory, SkillScope } from './MainStreetCards';
import type { MainStreetState } from './MainStreetState';
import { createSeededRng } from '@core-engine/SeededRng';

export type { SpecializationSkill, SpecializationSkillCategory, SkillScope } from './MainStreetCards';
export { STACKED_SKILL_CATEGORIES } from './MainStreetCards';

// ── Effect Categories (AC4) ─────────────────────────────────

/**
 * Effect category a specialization skill belongs to. Re-exported alias of the
 * canonical `SpecializationSkillCategory` from MainStreetCards (I2).
 */
export type SkillCategory = SpecializationSkillCategory;

/** Baseline skill on every management-company card. */
export const BASELINE_SKILL_ID = 'skill-town-gossip' as const;

/**
 * Category badge colors used by the market-card skill chips (I5,
 * CG-0MT4WXX1Q00860VP). Hex strings consumed directly by Phaser text
 * `backgroundColor`. Distinct per effect category for at-a-glance reads.
 */
export const STAFF_SKILL_CHIP_COLORS: Readonly<Record<SpecializationSkillCategory, string>> = {
  'income-boost': '#226633',
  'reputation-boost': '#334488',
  'cost-reduction': '#886622',
  'incident-mitigation': '#883333',
};

// ── Catalog (16 skills, 4 categories) ────────────────────────

/** The global specialization-skill pool (locked at game start). */
export const STAFF_SKILL_CATALOG: readonly SpecializationSkill[] = [
  // Category A: Income Boosts (business-staff scope)
  { id: 'skill-networker', name: 'Networker', category: 'income-boost', scope: 'business', description: '+20 coins per adjacent business synergy (passive).', effect: 'adjacency-coin-bonus' },
  { id: 'skill-chef', name: 'Chef de Cuisine', category: 'income-boost', scope: 'business', description: '+20% income from Food businesses.', effect: 'income-percent-food' },
  { id: 'skill-dj', name: 'DJ', category: 'income-boost', scope: 'business', description: '+20% income from Entertainment businesses.', effect: 'income-percent-entertainment' },
  { id: 'skill-sales-champion', name: 'Sales Champion', category: 'income-boost', scope: 'business', description: '+50 coins per turn from Commerce businesses.', effect: 'income-flat-commerce' },
  { id: 'skill-tech-guru', name: 'Tech Guru', category: 'income-boost', scope: 'business', description: 'Unlocks +1 synergy range for Entertainment businesses.', effect: 'synergy-range-entertainment' },
  // Category B: Reputation Boosts
  { id: 'skill-town-gossip', name: 'Town Gossip', category: 'reputation-boost', scope: 'management-company', description: 'Peek at the top incident-deck card once per turn (baseline).', effect: 'peek-incident-deck' },
  { id: 'skill-community-builder', name: 'Community Builder', category: 'reputation-boost', scope: 'business', description: '+10 reputation per turn from all businesses.', effect: 'reputation-flat-all' },
  { id: 'skill-brand-ambassador', name: 'Brand Ambassador', category: 'reputation-boost', scope: 'management-company', description: '+50% reputation gain from incidents and investments.', effect: 'reputation-multiplier-sources' },
  { id: 'skill-pr-strategist', name: 'PR Strategist', category: 'reputation-boost', scope: 'business', description: '+15 reputation per turn from Service businesses.', effect: 'reputation-flat-service' },
  // Category C: Cost Reductions
  { id: 'skill-cost-cutter', name: 'Cost Cutter', category: 'cost-reduction', scope: 'management-company', description: '-15% ongoing costs for the entire street (flagged for extra balance testing).', effect: 'ongoing-cost-street-pct' },
  { id: 'skill-negotiator', name: 'Negotiator', category: 'cost-reduction', scope: 'management-company', description: '-100 cost on business card refreshes.', effect: 'refresh-cost-flat' },
  { id: 'skill-operations-manager', name: 'Operations Manager', category: 'cost-reduction', scope: 'business', description: '-50 salary cost for this employed staff member.', effect: 'salary-flat' },
  // Category D: Incident Mitigation (management-company scope)
  { id: 'skill-quality-inspector', name: 'Quality Inspector', category: 'incident-mitigation', scope: 'management-company', description: '-30% coin damage from all incidents.', effect: 'incident-coin-damage-pct' },
  { id: 'skill-risk-manager', name: 'Risk Manager', category: 'incident-mitigation', scope: 'management-company', description: 'Reduces incident probability by 15%.', effect: 'incident-probability-pct' },
  { id: 'skill-security-consultant', name: 'Security Consultant', category: 'incident-mitigation', scope: 'management-company', description: 'Immunity to theft/loss incidents on the home business.', effect: 'incident-theft-immunity' },
  { id: 'skill-compliance', name: 'Compliance Officer', category: 'incident-mitigation', scope: 'management-company', description: 'Reduces incident reputation damage by 50.', effect: 'incident-rep-damage-flat' },
];

/** O(1) lookup of a specialization skill by id. */
export function getSkill(skillId: string): SpecializationSkill {
  const skill = STAFF_SKILL_CATALOG.find(s => s.id === skillId);
  if (!skill) {
    throw new Error(`Unknown specialization skill id: ${skillId}`);
  }
  return skill;
}

/**
 * Returns the staff type a skill takes effect from (MS-0MW4MSNMJ006E9JH).
 *
 * The classification is the "16 skills by staff type" table in
 * `docs/game/specialization-skills.md`: eight business-scope skills and eight
 * management-company-scope skills. Assigning a skill to a member of the other
 * type would create an effect it can never realise (GDD D.4.8).
 *
 * @param skillId Catalog skill id (see {@link getSkill}).
 * @returns The skill's scope (`'business'` or `'management-company'`).
 * @throws Error when the id is not in the catalog.
 */
export function getSkillScope(skillId: string): SkillScope {
  return getSkill(skillId).scope;
}

/**
 * Derives a staff card's type for skill assignment (MS-0MW4MSNMJ006E9JH).
 *
 * The GDD's two-type model (D.4.2/D.4.8) makes staff type a property of the
 * card template with `employedAtSlot` as the runtime determinant: a member
 * carrying a slot is business staff, one without is management-company staff.
 * Deck and market-row cards are not employed yet, so for those the template
 * marker the GDD defines decides (D.4.7): `handSlotsAdded > 0` or
 * `actionsPerTurn > 0` is management-company staff, everything else is
 * business staff. A present `employedAtSlot` always wins, so a hired member is
 * classified by its actual assignment.
 *
 * @param card A staff card (or the fields needed to classify it).
 * @returns The card's staff type as a skill scope.
 */
export function staffCardScope(card: {
  readonly employedAtSlot?: number;
  readonly handSlotsAdded?: number;
  readonly actionsPerTurn?: number;
}): SkillScope {
  if (card.employedAtSlot !== undefined) return 'business';
  if ((card.handSlotsAdded ?? 0) > 0 || (card.actionsPerTurn ?? 0) > 0) return 'management-company';
  return 'business';
}

// ── Serialization (I2, CG-0MT4WXQCN001G1LF) ─────────────────

/**
 * True when an employed staff member can peek at the incident deck: either
 * the Lookout's `peekOncePerTurn` ability (CG-0MSXOW6GN008ZSMN) or the Town
 * Gossip baseline specialization skill (`skill-town-gossip`, parent epic
 * CG-0MT1CIWSD003VBPK). Consolidates the peek gates used by the engine,
 * AI, renderer, and turn controller.
 *
 * The Town Gossip baseline is a management-company-scope skill, so it only
 * enables the peek from a management-company member (no `employedAtSlot`);
 * a business-staff member holding it is inert (MS-0MW4MSNWR00123OZ AC1). The
 * Lookout's own `peekOncePerTurn` ability is not a specialization skill and
 * is unaffected by staff type.
 */
export function hasPeekCapableStaff(state: {
  staffCards?: readonly {
    peekOncePerTurn?: boolean;
    specializationSkillIds?: readonly string[];
    employedAtSlot?: number;
  }[];
}): boolean {
  return (state.staffCards ?? []).some(
    card =>
      card.peekOncePerTurn === true ||
      (card.employedAtSlot === undefined &&
        Array.isArray(card.specializationSkillIds) &&
        card.specializationSkillIds.includes(BASELINE_SKILL_ID)),
  );
}

/**
 * Collapses a skill set to its stable id list for persistence. Skills travel
 * in saved state as plain ids (version-safe: catalogs evolve, stored ids do
 * not) and are resolved back through `getSkill` on load. Compatible with the
 * SaveLoadStore versioned-serialization convention — unknown ids fail loudly
 * rather than silently corrupting the roster.
 *
 * @param skills Skills to persist (e.g. an applicant's assigned skills).
 * @returns Stable id array suitable for JSON serialization.
 */
export function serializeSkillIds(skills: readonly SpecializationSkill[]): string[] {
  return skills.map(s => s.id);
}

/**
 * Restores a skill set from persisted ids, validating each id against the
 * current catalog.
 *
 * @param raw Persisted value (expected: array of skill ids).
 * @returns Resolved skill objects in stored order.
 * @throws Error when the payload is not an array or contains unknown ids.
 */
export function deserializeSkillIds(raw: unknown): SpecializationSkill[] {
  if (!Array.isArray(raw)) {
    throw new Error(`Invalid specialization skill state: expected an array, got ${typeof raw}`);
  }
  return raw.map(id => getSkill(String(id)));
}

// ── Game-start randomization (I3, CG-0MT4WXSWG0023VR0) ─────

/**
 * Derivation salt separating the skill-assignment RNG stream from the main
 * game RNG stream (deck shuffles, market draws, challenge selection). Using a
 * dedicated stream keeps `state.rngCalls` and every seed-dependent deck
 * ordering unchanged, so the wider suite's seeded fixtures stay stable.
 */
const SKILL_RNG_SALT = 0x5eed;

/**
 * Assigns specialization skills to every staff card instance in a new game:
 * the staff deck pool and the staff cards currently face-up in the market
 * row. Called once at set-up (CG-0MT4WXSWG0023VR0); assignments are locked
 * for the whole game — hires, discards, and market refills never re-roll
 * them (CG-0MSTOATDU006UGAX).
 *
 * Determinism: a dedicated `createSeededRng` stream derived from the game's
 * numeric seed produces the same assignments for the same seed (same seed ⇒
 * same game), without perturbing the main RNG stream.
 *
 * Skills are drawn from the pool matching the card's staff type: business
 * staff receive business-scope skills, management-company staff receive
 * management-company-scope skills plus the Town Gossip baseline
 * (MS-0MW4MSNMJ006E9JH). A skill assigned this way can always resolve from
 * its holder (GDD D.4.8).
 *
 * @param state Initialized game state (decks + market already assembled).
 */
export function assignStaffApplicantSkills(state: MainStreetState): void {
  const skillRng = createSeededRng(state.numericSeed ^ SKILL_RNG_SALT);
  const assign = (card: {
    specializationSkillIds?: string[];
    employedAtSlot?: number;
    handSlotsAdded?: number;
    actionsPerTurn?: number;
  }): void => {
    card.specializationSkillIds = serializeSkillIds(
      assignSkillsToApplicant(skillRng, staffCardScope(card)),
    );
  };

  for (const card of state.decks.staff) {
    assign(card);
  }
  for (const card of state.market.cards) {
    if (card.family === 'staff') {
      assign(card as {
        specializationSkillIds?: string[];
        employedAtSlot?: number;
        handSlotsAdded?: number;
        actionsPerTurn?: number;
      });
    }
  }
}

// ── Deterministic Assignment (AC3/AC4) ───────────────────────

/** The stacking cap: at most one income-boost AND at most one reputation-boost beyond baseline. */
const MAX_INCOME_BOOST = 1;
const MAX_REPUTATION_BOOST = 1;

/**
 * Assigns specialization skills to a single staff applicant using a seeded
 * RNG (`() => number` in [0, 1), e.g. `createSeededRng`) and a staff type
 * scope.
 *
 * The draw is type-consistent (MS-0MW4MSNMJ006E9JH): every skill is drawn
 * from the catalog entries whose `scope` matches `scope`, and a
 * management-company draw always starts with the Town Gossip baseline. The
 * per-member stacking caps still hold inside the filtered pool.
 *
 * Every draw decision consumes exactly one `rng()` call in a fixed order, so
 * the same RNG stream always produces the same skill set (and order).
 *
 * @param rng Seeded RNG; the same stream yields identical assignments.
 * @param scope Staff type of the member being assigned (`'business'` or
 *   `'management-company'`). Use {@link staffCardScope} to derive it from a card.
 * @returns 1–3 skills, all of the member's scope; management-company rosters
 *   always include the Town Gossip baseline first.
 */
export function assignSkillsToApplicant(rng: () => number, scope: SkillScope): SpecializationSkill[] {
  const skills: SpecializationSkill[] = [];
  const remaining = STAFF_SKILL_CATALOG.filter(s => s.scope === scope);

  // The Town Gossip baseline is management-company scope only: it is never
  // drawn into a business-staff pool.
  const baseline =
    scope === 'management-company' ? remaining.find(s => s.id === BASELINE_SKILL_ID) : undefined;
  if (baseline) {
    skills.push(baseline);
    remaining.splice(remaining.indexOf(baseline), 1);
  }

  // 1..3 total skills: management-company draws add to the baseline, business
  // draws (which have no baseline) fill all 1–3 slots from the business pool.
  const total = 1 + Math.floor(rng() * 3);
  const toDraw = scope === 'management-company' ? total - 1 : total;

  // Candidates remain eligible while the stacking cap allows their category.
  let incomeBoost = 0;
  let reputationBoost = 0;

  for (let i = 0; i < toDraw && remaining.length > 0; i += 1) {
    const candidates = remaining.filter(s => {
      if (s.category === 'income-boost' && incomeBoost >= MAX_INCOME_BOOST) return false;
      if (s.category === 'reputation-boost' && reputationBoost >= MAX_REPUTATION_BOOST) return false;
      return true;
    });
    if (candidates.length === 0) break;

    const idx = Math.floor(rng() * candidates.length);
    const picked = candidates[idx];
    skills.push(picked);
    if (picked.category === 'income-boost') incomeBoost += 1;
    if (picked.category === 'reputation-boost') reputationBoost += 1;
    remaining.splice(remaining.indexOf(picked), 1);
  }

  return skills;
}

/**
 * Assigns specialization skills to `count` staff applicants from a shared
 * seeded RNG stream (game-start roster generation).
 *
 * @param rng Seeded RNG shared across applicants.
 * @param count Number of applicants to generate.
 * @param scope Staff type of every generated applicant.
 * @returns One skill set per applicant, in roster order.
 */
export function assignSkillsToApplicants(
  rng: () => number,
  count: number,
  scope: SkillScope,
): SpecializationSkill[][] {
  const roster: SpecializationSkill[][] = [];
  for (let i = 0; i < count; i += 1) {
    roster.push(assignSkillsToApplicant(rng, scope));
  }
  return roster;
}