/**
 * Main Street: Staff specialization — per-business buff application (T2,
 * CG-0MT4WXJDQ007H19S; parent CG-0MT1CIWSD003VBPK).
 *
 * Pure functions that translate employed staff specialization skills into
 * numeric buffs for income, reputation, ongoing costs, and incident
 * mitigation. The adjacency/engine wiring (I4, CG-0MT4WXV2J000M35M) folds
 * these buffs into `applyIncome` / `applyCommunitySpaceOngoingCosts` /
 * reputation and incident computations at call time.
 *
 * **Caching-safety contract:** these functions never mutate the state or the
 * engine's incremental-update caches (`currentIncome` / `currentRepPerTurn`,
 * CG-0MSVYPEZ90085SHE). They derive buffs from immutable profiles, so the
 * wiring can recompute them on demand without invalidating adjacency caches.
 *
 * Skill → effect mapping follows the CG-0MT1CIWSD003VBPK catalog:
 * - Income: skill-chef (+20% Food), skill-dj (+20% Entertainment),
 *   skill-sales-champion (+50 Commerce per turn); skill-networker and
 *   skill-tech-guru are adjacency-scoped and NOT part of the per-business
 *   income profile.
 * - Reputation: skill-community-builder (+10 all), skill-pr-strategist
 *   (+15 Service); skill-brand-ambassador is a +50% event-source
 *   multiplier (incidents/investments), exposed separately.
 * - Costs: skill-cost-cutter (-15% street-wide ongoing), skill-negotiator
 *   (-100 refresh), skill-operations-manager (-50 staff salary).
 * - Incidents: skill-quality-inspector (-30% coin), skill-compliance
 *   (-50 rep), skill-risk-manager (-15% probability), skill-security-
 *   consultant (theft/loss immunity on the home business).
 *
 * **Staff-type scope gate (MS-0MW4MSNWR00123OZ):** every skill takes effect
 * only from a member whose type matches the skill's scope. Business staff
 * (an `employedAtSlot` link) realise business-scope skills, scoped to their
 * business; management-company staff (no `employedAtSlot`) realise
 * management-company-scope skills, scoped to the player/street. The gate is
 * applied by the aggregation helpers ({@link getEmployedSpecializationSkills},
 * {@link getEmployedSpecializationSkillsForBusiness},
 * {@link getSalaryScopeSkills}), so a skill held cross-type is inert in every
 * consumer without per-consumer special-casing.
 *
 * @module
 */

import type { SynergyType, StaffCard } from './MainStreetCards';
import type { SpecializationSkill } from './MainStreetStaffSkills';
import { deserializeSkillIds } from './MainStreetStaffSkills';
import { roundInt } from './MainStreetDifficulty';
import type { MainStreetState } from './MainStreetState';
import type { GridDims } from './MainStreetAdjacencyGeometry';
import { resolveNeighbors } from './MainStreetAdjacencyGeometry';

// ── Buff Profiles ───────────────────────────────────────────

/** Immutable per-business inputs the buff functions read. */
export interface BusinessBuffProfile {
  /** Synergy types of the business (drives synergy-gated skills). */
  readonly synergyTypes: readonly SynergyType[];
  /** Per-turn income before skill buffs (baseIncome + upgrade incomeBonus). */
  readonly baseIncome: number;
  /**
   * Per-turn ongoing cost of this business (the value `applyIncome` /
   * `applyCommunitySpaceOngoingCosts` deducts). Only used to attribute
   * cost-cutter reductions; costs are never mutated here.
   */
  readonly ongoingCost: number;
}

/** Income buffs for one business. */
export interface IncomeSkillBuffs {
  /** Flat coins added per turn (e.g. Sales Champion +50). */
  readonly flat: number;
  /** Fractional multiplier on pre-skill income (0.2 = +20%). */
  readonly percent: number;
}

/** Reputation buffs for one business. */
export interface ReputationSkillBuffs {
  /** Flat reputation added per turn (e.g. Community Builder +10). */
  readonly flat: number;
}

/** Ongoing-cost buffs for one business. */
export interface OngoingCostSkillBuffs {
  /** Fraction of this business's ongoing cost removed (0.15 = -15%). */
  readonly reductionPct: number;
}

/** Incident-mitigation buffs aggregated for the street / home business. */
export interface IncidentSkillBuffs {
  /** Fraction of incident coin damage removed (0.3 = -30%). */
  readonly coinDamageReductionPct: number;
  /** Flat incident reputation damage removed (50). */
  readonly reputationDamageReductionFlat: number;
  /** Fraction of incident probability removed (0.15 = -15%). */
  readonly probabilityReductionPct: number;
  /** True when theft/loss incidents cannot target the home business. */
  readonly immuneToTheftLoss: boolean;
}

/** Complete per-business buff bundle derived from the employed skill set. */
export interface PerBusinessSkillBuffs {
  readonly income: IncomeSkillBuffs;
  readonly reputation: ReputationSkillBuffs;
  readonly ongoingCosts: OngoingCostSkillBuffs;
  readonly incidents: IncidentSkillBuffs;
}

// ── Magic-numbers reference (balance docs CG-0MT1CIWSD003VBPK) ─

export const CHEF_INCOME_BOOST_PCT = 0.2;
export const DJ_INCOME_BOOST_PCT = 0.2;
export const SALES_CHAMPION_FLAT = 50;
export const COMMUNITY_BUILDER_REP = 10;
export const PR_STRATEGIST_REP = 15;
export const COST_CUTTER_ONGOING_PCT = 0.15;
export const NEGOTIATOR_REFRESH_DISCOUNT = 100;
export const OPERATIONS_MANAGER_SALARY_DISCOUNT = 50;
export const QUALITY_INSPECTOR_COIN_PCT = 0.3;
export const COMPLIANCE_REP_FLAT = 50;
export const RISK_MANAGER_PROBABILITY_PCT = 0.15;
export const BRAND_AMBASSADOR_REP_MULTIPLIER = 1.5;

/**
 * Base Tax Audit collection rate: 45% of banked coins. Mirrors the
 * `coinPercentDelta: -0.45` value on `evt-tax` in `card-data.csv`; the engine
 * reads the rate from the card, and this named constant is the single
 * reference site for the design value (tests assert the two agree).
 */
export const TAX_AUDIT_BASE_RATE = 0.45;

/**
 * Accountant-mitigated Tax Audit rate: 25% of banked coins. Mirrors the
 * `taxAuditRate: 0.25` value on `staff-accountant` in `card-data.csv`.
 */
export const TAX_AUDIT_ACCOUNTANT_RATE = 0.25;

// ── Per-business buff computation ───────────────────────────

/**
 * Computes the per-business buff bundle for one business from the employed
 * skill set. Pure: never mutates `profile` or any game state.
 *
 * Callers pass the gated per-business pool
 * ({@link getEmployedSpecializationSkillsForBusiness}), which carries only
 * business-scope skills from members employed at the business, so a
 * management-company-scope skill can never reach this fold
 * (MS-0MW4MSNWR00123OZ AC2/AC4).
 *
 * @param skills  Employed specialization skills (one or more staff members).
 * @param profile Immutable per-business inputs.
 * @returns The buff bundle to fold into income/reputation/cost computations.
 */
export function computePerBusinessSkillBuffs(
  skills: readonly SpecializationSkill[],
  profile: BusinessBuffProfile,
): PerBusinessSkillBuffs {
  const income = { flat: 0, percent: 0 };
  const reputation = { flat: 0 };
  const ongoingCosts = { reductionPct: 0 };
  const incidents = {
    coinDamageReductionPct: 0,
    reputationDamageReductionFlat: 0,
    probabilityReductionPct: 0,
    immuneToTheftLoss: false,
  };

  for (const skill of skills) {
    switch (skill.id) {
      // Category A: income boosts (per-business subset; networker/tech-guru
      // are adjacency-scoped and handled by their own helpers).
      case 'skill-chef':
        if (profile.synergyTypes.includes('Food')) income.percent += CHEF_INCOME_BOOST_PCT;
        break;
      case 'skill-dj':
        if (profile.synergyTypes.includes('Entertainment')) income.percent += DJ_INCOME_BOOST_PCT;
        break;
      case 'skill-sales-champion':
        if (profile.synergyTypes.includes('Commerce')) income.flat += SALES_CHAMPION_FLAT;
        break;
      // Category B: reputation boosts (per-business subset).
      case 'skill-community-builder':
        reputation.flat += COMMUNITY_BUILDER_REP;
        break;
      case 'skill-pr-strategist':
        if (profile.synergyTypes.includes('Service')) reputation.flat += PR_STRATEGIST_REP;
        break;
      // Category C: cost reductions (per-business subset: street-wide %).
      case 'skill-cost-cutter':
        ongoingCosts.reductionPct += COST_CUTTER_ONGOING_PCT;
        break;
      // Category D: incident mitigation.
      case 'skill-quality-inspector':
        incidents.coinDamageReductionPct += QUALITY_INSPECTOR_COIN_PCT;
        break;
      case 'skill-compliance':
        incidents.reputationDamageReductionFlat += COMPLIANCE_REP_FLAT;
        break;
      case 'skill-risk-manager':
        incidents.probabilityReductionPct += RISK_MANAGER_PROBABILITY_PCT;
        break;
      case 'skill-security-consultant':
        incidents.immuneToTheftLoss = true;
        break;
      // Default: no per-business application (baseline Town Gossip,
      // adjacency-scoped networker/tech-guru, event-scoped brand-ambassador,
      // refresh/salary cost skills negotiator & operations-manager).
      default:
        break;
    }
  }

  return { income, reputation, ongoingCosts, incidents };
}

// ── Staff-type scope gate (MS-0MW4MSNWR00123OZ) ─────────────
//
// The two-type model (GDD D.4.2/D.4.8) makes a specialization skill take
// effect ONLY from a member whose type matches the skill's scope:
//   - business staff (an `employedAtSlot` link) realise business-scope skills,
//     scoped to the employing business;
//   - management-company staff (no `employedAtSlot`) realise
//     management-company-scope skills, scoped to the player/street.
// The gate is applied in the aggregation helpers below — the single place
// every consumer reads skills from — so no consumer needs special-casing
// (AC4). A skill assigned cross-type (existing save / hand-built fixture) is
// therefore inert. Type is derived from `employedAtSlot` presence, so no new
// persisted field is needed (AC5).

/**
 * Resolves a staff card's locked skill roster, tolerating legacy/unknown ids.
 *
 * A stale/unknown skill id on a saved member must not break the income phase;
 * the member's skills are skipped (documented forward-compat path).
 */
function resolveCardSkills(card: StaffCard): SpecializationSkill[] {
  const ids = Array.isArray(card.specializationSkillIds) ? card.specializationSkillIds : [];
  try {
    return deserializeSkillIds(ids);
  } catch {
    return [];
  }
}

/**
 * True when a staff card is business staff: it carries an `employedAtSlot`
 * link. Management-company staff have no slot (the two-type model's runtime
 * determinant — GDD D.4.2/D.4.8; no persisted type field).
 */
export function isBusinessStaffCard(card: StaffCard): boolean {
  return card.employedAtSlot !== undefined;
}

/**
 * The management-company staff among the given members, in card order.
 *
 * Membership is the two-type model's own test — `!isBusinessStaffCard(card)`
 * — so nothing else (a persisted flag, a card-name list) can disagree with
 * the engine about who belongs to the management company
 * (MS-0MWBWKZ1G006IBH2).
 *
 * @param cards Staff members to filter (e.g. `state.staffCards`).
 * @returns Members with no `employedAtSlot`, in card order.
 */
export function selectManagementCompanyStaff(cards: readonly StaffCard[]): StaffCard[] {
  return cards.filter(card => !isBusinessStaffCard(card));
}

/**
 * Management-company-scope (player/street-scope) skills the given members can
 * realise. A skill takes effect only from a management-company member, i.e.
 * one with no `employedAtSlot`: a management-company-scope skill held by
 * business staff is inert (Cost Cutter, Negotiator, Brand Ambassador, the
 * four incident-mitigation skills and the Town Gossip baseline), and a
 * business-scope skill is never street-wide (MS-0MW4MSNWR00123OZ AC1).
 *
 * @param cards Staff members to aggregate (e.g. `state.staffCards`).
 * @returns The realisable management-company-scope skills, in card order.
 */
export function getStreetScopeSkills(cards: readonly StaffCard[]): SpecializationSkill[] {
  return cards.flatMap(card =>
    isBusinessStaffCard(card)
      ? []
      : resolveCardSkills(card).filter(skill => skill.scope === 'management-company'),
  );
}

/**
 * Business-scope skills of the given members. Callers pass the members
 * employed at ONE business (the per-business `employedStaff` source of truth,
 * falling back to `employedAtSlot` links), so membership itself establishes
 * the business-staff type; the gate here is the skill's scope — a
 * management-company-scope skill held by business staff is filtered out and
 * produces no per-business income, reputation or ongoing-cost buff
 * (MS-0MW4MSNWR00123OZ AC2).
 *
 * @param cards Members employed at one business.
 * @returns The realisable business-scope skills, in member order.
 */
export function getBusinessScopeSkills(cards: readonly StaffCard[]): SpecializationSkill[] {
  return cards.flatMap(card => resolveCardSkills(card).filter(skill => skill.scope === 'business'));
}

/**
 * Business-scope skills a member can realise for its own salary (the
 * Operations Manager discount): only business staff (an `employedAtSlot`
 * link) discount a business staffing cost, so a management-company member's
 * cross-type Operations Manager is inert (MS-0MW4MSNWR00123OZ AC3).
 *
 * @param card The member whose salary is being charged.
 * @returns The realisable business-scope skills (empty for company staff).
 */
export function getSalaryScopeSkills(card: StaffCard): SpecializationSkill[] {
  return isBusinessStaffCard(card) ? getBusinessScopeSkills([card]) : [];
}

// ── Business-staff per-business card buffs (GDD D.4.3/D.4.8) ─
//
// The card-level business-staff abilities (Baker, Chef, Barista, Florist,
// Mechanic, Event Planner, PR Officer, Marketing Consultant, Customer Service
// Rep, IT Specialist, Delivery Driver and the three incident roles) resolve
// **per business**: an effect either lands on the employing business (`own`)
// or on each of its 8-way neighbours (`adjacent`) — never street-wide
// (GDD D.4.8 §2). They are folded in at income/incident/purchase time and are
// never written into a card's cached `currentIncome` / `synergyRangeBonus`,
// so hiring or moving staff never leaves a stale cache
// (MS-0MW3JXF6U00753LB).

/** The grid dimensions the adjacency resolver should use for this state. */
function stateGridDims(state: MainStreetState): GridDims | undefined {
  return state.streetGridCols && state.streetGridRows
    ? { cols: state.streetGridCols, rows: state.streetGridRows }
    : undefined;
}

/**
 * The staff members employed at one street-grid slot.
 *
 * Reads the per-business `employedStaff` source of truth
 * (CG-0MTIOLY2A0092OT1) and falls back to `employedAtSlot` links for legacy
 * in-memory states / hand-built fixtures — the same semantics as
 * `getEmployedStaffForBusiness` and
 * {@link getEmployedSpecializationSkillsForBusiness}.
 */
function getMembersAtSlot(state: MainStreetState, slotIndex: number): StaffCard[] {
  const business = state.streetGrid[slotIndex];
  if (business && Array.isArray((business as { employedStaff?: unknown }).employedStaff)) {
    return (business as { employedStaff: StaffCard[] }).employedStaff;
  }
  return (state.staffCards ?? []).filter(card => card.employedAtSlot === slotIndex);
}

/** The 8-way neighbouring slot indices of `slotIndex` in this state's grid. */
function adjacentSlotIndices(state: MainStreetState, slotIndex: number): number[] {
  return resolveNeighbors(slotIndex, 1, stateGridDims(state));
}

/**
 * True when a business matches a staff effect's type filter.
 *
 * Both specific business names (e.g. `Flower Shop`) and synergy types (e.g.
 * `Commerce`) are valid filter tokens, matching `allowedBusinessTypes`
 * semantics. An empty/absent filter matches every business.
 */
function businessMatchesTypes(
  business: { readonly name?: string; readonly synergyTypes?: readonly string[] } | null | undefined,
  types: readonly string[] | undefined,
): boolean {
  if (!types || types.length === 0) return true;
  if (!business) return false;
  const wanted = types.map(t => t.toLowerCase());
  if (business.name && wanted.includes(business.name.toLowerCase())) return true;
  return (business.synergyTypes ?? []).some(synergy => wanted.includes(String(synergy).toLowerCase()));
}

/**
 * Per-business card buffs contributed by staff employed at (and around) one
 * street-grid slot (MS-0MW3JXF6U00753LB).
 *
 * `incomeFlat` / `reputationFlat` already include both sources:
 *  - the slot's own business-staff `own`-targeted effects, and
 *  - the `adjacent`-targeted effects of staff employed at the 8 neighbours,
 *    filtered by the effect's type list.
 */
export interface BusinessStaffBuffs {
  /** Flat coins per turn added to this business's income. */
  readonly incomeFlat: number;
  /** Fractional income boost (0.2 = +20%) on this business's cached income. */
  readonly incomePercent: number;
  /** Flat reputation per turn added to this business. */
  readonly reputationFlat: number;
  /** Fraction of this business's reputation per turn added (0.1 = +10%). */
  readonly reputationPercent: number;
  /** Extra synergy range (slots) for this business (IT Specialist +1). */
  readonly synergyRangeBonus: number;
  /**
   * Fraction of this business's ongoing cost removed (0.2 = −20%, the
   * Bookkeeper). Business-scope only: contributed by the slot's own
   * employees, never by a neighbour's staff (GDD D.4.3/D.4.8).
   */
  readonly ongoingCostReductionPct: number;
}

/** One business's incident mitigation contributed by its local cluster. */
export interface BusinessIncidentMitigation {
  /** Share of incident coin damage removed (0.1 = -10%). */
  readonly coinDamageReductionPct: number;
  /** Flat incident reputation damage removed (floored at 0 by the consumer). */
  readonly reputationDamageReductionFlat: number;
  /** Share of the incident draw averted for this business (0.1 = -10%). */
  readonly frequencyReductionPct: number;
}

/** A fresh zero-valued buff bundle (a slot with no business staff). */
function emptyBusinessStaffBuffs(): BusinessStaffBuffs {
  return {
    incomeFlat: 0,
    incomePercent: 0,
    reputationFlat: 0,
    reputationPercent: 0,
    synergyRangeBonus: 0,
    ongoingCostReductionPct: 0,
  };
}

/**
 * Computes the per-business card buffs for one street-grid slot
 * (MS-0MW3JXF6U00753LB).
 *
 * Reads `own`-targeted buffs from the slot's employees and `adjacent`-targeted
 * buffs from the 8 neighbours' employees (filtered by the effect's type list),
 * so a Barista employed next door adds coins to THIS business while a Barista
 * elsewhere on the street does not (GDD D.4.8 §2).
 *
 * Pure: never mutates state and consumes no RNG, so the income phase can
 * recompute it on demand without invalidating adjacency caches.
 *
 * @param state     Current game state (read-only).
 * @param slotIndex Street-grid slot index of the receiving business.
 * @returns The per-business buff bundle (zeroed when no staff contribute).
 */
export function computeBusinessStaffBuffs(
  state: MainStreetState,
  slotIndex: number,
): BusinessStaffBuffs {
  const self = state.streetGrid[slotIndex];
  let incomeFlat = 0;
  let incomePercent = 0;
  let reputationFlat = 0;
  let reputationPercent = 0;
  let synergyRangeBonus = 0;
  let ongoingCostReductionPct = 0;
  let hasAny = false;

  for (const member of getMembersAtSlot(state, slotIndex)) {
    if ((member.incomeBonusTarget ?? 'own') === 'own') {
      if (member.incomeBonus) {
        incomeFlat += member.incomeBonus;
        hasAny = true;
      }
    }
    if (member.incomePercent) {
      incomePercent += member.incomePercent;
      hasAny = true;
    }
    if ((member.reputationBonusTarget ?? 'own') === 'own') {
      if (member.reputationBonus) {
        reputationFlat += member.reputationBonus;
        hasAny = true;
      }
    }
    if (member.reputationPercent) {
      reputationPercent += member.reputationPercent;
      hasAny = true;
    }
    if (member.synergyRangeBonus) {
      synergyRangeBonus += member.synergyRangeBonus;
      hasAny = true;
    }
    if (member.ongoingCostReduction) {
      ongoingCostReductionPct += member.ongoingCostReduction;
      hasAny = true;
    }
  }

  for (const neighbourIndex of adjacentSlotIndices(state, slotIndex)) {
    for (const member of getMembersAtSlot(state, neighbourIndex)) {
      if (member.incomeBonus && member.incomeBonusTarget === 'adjacent') {
        if (businessMatchesTypes(self, member.incomeBonusTypes)) {
          incomeFlat += member.incomeBonus;
          hasAny = true;
        }
      }
      if (member.reputationBonus && member.reputationBonusTarget === 'adjacent') {
        reputationFlat += member.reputationBonus;
        hasAny = true;
      }
    }
  }

  if (!hasAny) return emptyBusinessStaffBuffs();
  return { incomeFlat, incomePercent, reputationFlat, reputationPercent, synergyRangeBonus, ongoingCostReductionPct };
}

/**
 * Fraction of one business's ongoing cost removed by the business staff
 * employed **at that business** (the Bookkeeper's −20%, GDD D.4.3).
 *
 * Own-business scope only: staff employed at the 8-way neighbours never reduce
 * this business's running cost, so hiring a Bookkeeper next door does not help.
 * The returned fraction is clamped to `[0, 1]` so it can be composed with the
 * street-wide Cost Cutter reduction without driving a cost negative.
 *
 * Pure: never mutates state and consumes no RNG, so the ongoing-cost phase can
 * call it on demand.
 *
 * @param state     Current game state (read-only).
 * @param slotIndex Street-grid slot index of the business paying the cost.
 * @returns Fraction of that business's ongoing cost removed (`0` when none).
 */
export function computeBusinessOngoingCostReductionPct(
  state: MainStreetState,
  slotIndex: number,
): number {
  const total = getMembersAtSlot(state, slotIndex).reduce(
    (sum, member) => sum + (member.ongoingCostReduction ?? 0),
    0,
  );
  return Math.max(0, Math.min(1, total));
}

/**
 * Incident mitigation contributed to one business by business staff
 * (Security Guard, Maintenance Worker, Health & Safety Inspector — GDD D.4.3).
 *
 * `own`-scoped effects apply only from the business's OWN employees;
 * `cluster`-scoped effects also apply from staff employed at its 8-way
 * neighbours. Management-company incident skills are a separate (street-wide)
 * fold and are not included here.
 *
 * Pure: never mutates state and consumes no RNG.
 *
 * @param state     Current game state (read-only).
 * @param slotIndex Street-grid slot index of the protected business.
 * @returns The mitigation bundle (zeroed when no staff protect the business).
 */
export function computeBusinessIncidentMitigation(
  state: MainStreetState,
  slotIndex: number,
): BusinessIncidentMitigation {
  let coinDamageReductionPct = 0;
  let reputationDamageReductionFlat = 0;
  let frequencyReductionPct = 0;

  const apply = (member: StaffCard): void => {
    const effect = member.incidentEffect;
    if (!effect) return;
    if (effect.kind === 'coin') coinDamageReductionPct += effect.amount;
    else if (effect.kind === 'reputation') reputationDamageReductionFlat += effect.amount;
    else frequencyReductionPct += effect.amount;
  };

  for (const member of getMembersAtSlot(state, slotIndex)) apply(member);
  for (const neighbourIndex of adjacentSlotIndices(state, slotIndex)) {
    for (const member of getMembersAtSlot(state, neighbourIndex)) {
      if (member.incidentEffect?.target === 'cluster') apply(member);
    }
  }

  return { coinDamageReductionPct, reputationDamageReductionFlat, frequencyReductionPct };
}

/**
 * Strongest per-business incident-frequency reduction among `slotIndices`
 * (the Health & Safety Inspector's -10%, GDD D.4.3).
 *
 * The incident resolver draws ONE avert roll per turn, so the strongest
 * protector among the incident's candidate businesses decides it — several
 * inspectors never stack into multiple rolls. Pure; consumes no RNG.
 *
 * @param state       Current game state (read-only).
 * @param slotIndices Candidate businesses the incident could hit.
 * @returns Fraction of the draw averted (`0` when no business protects itself).
 */
export function computeIncidentFrequencyReduction(
  state: MainStreetState,
  slotIndices: readonly number[],
): number {
  return slotIndices.reduce(
    (max, slot) => Math.max(max, computeBusinessIncidentMitigation(state, slot).frequencyReductionPct),
    0,
  );
}

/**
 * Flat purchase discount for placing a business at `slotIndex`, contributed by
 * Delivery Drivers employed at the 8 neighbouring businesses
 * (GDD D.4.3: "-50 coins on the purchase cost of any business placed adjacent
 * to its own business").
 *
 * Clamped at 0, mirroring the legacy street-wide aggregation it replaces.
 *
 * @param state     Current game state (read-only).
 * @param slotIndex Street-grid slot receiving the new business.
 * @returns Non-negative flat coin discount for this placement.
 */
export function computeAdjacentPurchaseDiscount(
  state: MainStreetState,
  slotIndex: number,
): number {
  let total = 0;
  for (const neighbourIndex of adjacentSlotIndices(state, slotIndex)) {
    for (const member of getMembersAtSlot(state, neighbourIndex)) {
      total += member.adjacencyPurchaseDiscount ?? 0;
    }
  }
  return Math.max(0, total);
}

// ── Street / engine-level buff helpers ──────────────────────

/**
 * Flattens the management-company-scope specialization skills of every
 * management-company staff member (hired cards in `state.staffCards` with no
 * `employedAtSlot`) into one skill list — the STREET-WIDE aggregation used for
 * buffs that are not business-scoped (cost-cutter, incident mitigation,
 * brand-ambassador, negotiator). Skills are read from the card's locked
 * `specializationSkillIds` (I3); members without the field (legacy saves /
 * hand-built fixtures) contribute nothing.
 *
 * The staff-type gate lives here (see {@link getStreetScopeSkills}), so a
 * business-staff member's management-company-scope skill never leaks a
 * player/street effect, and per-business buffs use
 * {@link getEmployedSpecializationSkillsForBusiness} instead
 * (MS-0MW4MSNWR00123OZ AC1/AC4).
 */
export function getEmployedSpecializationSkills(state: MainStreetState): SpecializationSkill[] {
  return getStreetScopeSkills(state.staffCards ?? []);
}

/**
 * Flattens the business-scope specialization skills of ONLY the staff
 * member(s) employed at the given street-grid slot. Per-business
 * income/reputation buffs in `applyIncome` are derived from this per-slot
 * pool, so a Chef employed at one Food business never buffs another Food
 * business elsewhere on the street, and management-company-scope skills held
 * by business staff are filtered out (CG-0MSTOATDU006UGAX /
 * CG-0MU3BTTWT0025VPL / MS-0MW4MSNWR00123OZ AC2).
 *
 * Reads the per-business employed-staff source of truth
 * (`business.employedStaff`, CG-0MTIOLY2A0092OT1 AC2) and falls back to
 * `employedAtSlot` links for in-memory states that predate the field
 * (legacy saves / hand-built fixtures) — the same semantics as
 * `getEmployedStaffForBusiness` (backward compatibility, AC5).
 *
 * @param state     Current game state.
 * @param slotIndex Street-grid slot index of the target business.
 * @returns The realisable business-scope skills at that slot (empty when none).
 */
export function getEmployedSpecializationSkillsForBusiness(
  state: MainStreetState,
  slotIndex: number,
): SpecializationSkill[] {
  const business = state.streetGrid[slotIndex];
  const members =
    business && Array.isArray((business as { employedStaff?: unknown }).employedStaff)
      ? (business as { employedStaff: StaffCard[] }).employedStaff
      : (state.staffCards ?? []).filter(card => card.employedAtSlot === slotIndex);
  return getBusinessScopeSkills(members);
}

/**
 * Incident-mitigation buffs aggregated street-wide, independent of any
 * single business profile (all incident skills are profile-agnostic). Used by
 * the incident resolution path (I4).
 */
export function computeIncidentSkillBuffs(skills: readonly SpecializationSkill[]): IncidentSkillBuffs {
  const incidents = {
    coinDamageReductionPct: 0,
    reputationDamageReductionFlat: 0,
    probabilityReductionPct: 0,
    immuneToTheftLoss: false,
  };
  for (const skill of skills) {
    switch (skill.id) {
      case 'skill-quality-inspector':
        incidents.coinDamageReductionPct += QUALITY_INSPECTOR_COIN_PCT;
        break;
      case 'skill-compliance':
        incidents.reputationDamageReductionFlat += COMPLIANCE_REP_FLAT;
        break;
      case 'skill-risk-manager':
        incidents.probabilityReductionPct += RISK_MANAGER_PROBABILITY_PCT;
        break;
      case 'skill-security-consultant':
        incidents.immuneToTheftLoss = true;
        break;
      default:
        break;
    }
  }
  return incidents;
}

/**
 * Street-wide ongoing-cost reduction (Cost Cutter, -15%). Flagged AC5 for
 * additional balance testing because it scales with every earned card.
 */
export function computeStreetOngoingCostReductionPct(
  skills: readonly SpecializationSkill[],
): number {
  return skills.filter(s => s.id === 'skill-cost-cutter').length * COST_CUTTER_ONGOING_PCT;
}

/** Flat discount on each business-card refresh (Negotiator, -100). */
export function computeRefreshCostDiscount(skills: readonly SpecializationSkill[]): number {
  return skills.filter(s => s.id === 'skill-negotiator').length * NEGOTIATOR_REFRESH_DISCOUNT;
}

/**
 * Flat coin discount on business-card purchases for a placement at
 * `slotIndex`.
 *
 * Two sources, both clamped at 0:
 *  1. the placement-scoped {@link computeAdjacentPurchaseDiscount} — the
 *     two-type delivery effect (a Delivery Driver discounts businesses placed
 *     next to its own business, GDD D.4.3);
 *  2. the legacy street-wide `purchaseCostDiscount` sum, retained only for
 *     legacy saves/fixtures that still carry the deprecated field. No shipped
 *     card sets it any more (MS-0MW3JXF6U00753LB).
 *
 * Callers that do not know the destination slot (pure affordability
 * projections) omit `slotIndex`; they then see only the legacy discount, so
 * they never promise a discount the placement path will not grant.
 *
 * Pure: never mutates state and consumes no RNG.
 *
 * @param state     Current game state.
 * @param slotIndex Optional target placement slot (enables the adjacency
 *                  discount).
 * @returns Non-negative flat coin discount for a business-card purchase.
 */
export function computePurchaseCostDiscount(state: MainStreetState, slotIndex?: number): number {
  const legacy = (state.staffCards ?? []).reduce(
    (sum, card) => sum + (card.purchaseCostDiscount ?? 0),
    0,
  );
  const adjacent = slotIndex === undefined ? 0 : computeAdjacentPurchaseDiscount(state, slotIndex);
  return Math.max(0, legacy + adjacent);
}

/**
 * Effective base coin cost of acquiring/placing a business or
 * community-space card at `slotIndex`, after the placement's purchase
 * discount (GDD D.4.3 / MS-0MW3JXF6U00753LB). The result is floored at 0.
 *
 * This is the single shared source of truth for the click (`purchaseBusiness`),
 * drag (`buyAndPlaceBusiness`) and deferred from-hand
 * (`playBusinessFromHand`) acquisition paths, including the UI affordability
 * pre-gates, so every path charges the same price.
 *
 * Pure: never mutates state and consumes no RNG.
 *
 * @param state      Current game state.
 * @param listedCost Listed card cost.
 * @param slotIndex  Optional target placement slot (enables the adjacency
 *                   discount).
 */
export function computeEffectiveBusinessPurchaseCost(
  state: MainStreetState,
  listedCost: number,
  slotIndex?: number,
): number {
  return Math.max(0, listedCost - computePurchaseCostDiscount(state, slotIndex));
}

/**
 * Effective +50% drag/composite premium on a business or community-space
 * card placed at `slotIndex`, after the purchase discount. Per the
 * discount-first ordering rule (CG-0MTKMGL66004I0PC), the discount is applied
 * to the base cost BEFORE the premium.
 *
 * Pure: never mutates state and consumes no RNG.
 */
export function computeBusinessPurchasePremium(
  state: MainStreetState,
  listedCost: number,
  slotIndex?: number,
): number {
  return Math.ceil(computeEffectiveBusinessPurchaseCost(state, listedCost, slotIndex) * 1.5 * 2) / 2;
}

/**
 * Flat coin discount applied to buying an upgrade for the business at
 * `slotIndex`, summing the `upgradeCostDiscount` of every staff member
 * employed there (e.g. the Financial Advisor's "upgrade costs 100 less"
 * ability — CG-0MTKMGL66004I0PC).
 *
 * This is the per-business counterpart of the street-wide refresh / salary
 * discounts: the discount applies ONLY to the business where the staff
 * member is employed, and never leaks street-wide (the same scoping rule as
 * per-business income/reputation buffs, CG-0MSTOATDU006UGAX). Multiple members
 * at the same business stack additively and the total is floored at 0 — the
 * same aggregation and clamp semantics as `refreshMarketCost`'s staff
 * `refreshCostDiscount` sum.
 *
 * Reads the per-business employed-staff source of truth
 * (`business.employedStaff`) and falls back to `employedAtSlot` links for
 * legacy in-memory states (identical to
 * `getEmployedSpecializationSkillsForBusiness`).
 *
 * Pure: never mutates state and consumes no RNG.
 *
 * @param state     Current game state.
 * @param slotIndex Street-grid slot index of the business being upgraded.
 * @returns Non-negative flat coin discount for an upgrade at that slot.
 */
export function computeUpgradeCostDiscount(state: MainStreetState, slotIndex: number): number {
  const business = state.streetGrid[slotIndex];
  const members =
    business && Array.isArray((business as { employedStaff?: unknown }).employedStaff)
      ? (business as { employedStaff: StaffCard[] }).employedStaff
      : (state.staffCards ?? []).filter(card => card.employedAtSlot === slotIndex);
  const total = members.reduce((sum, card) => sum + (card.upgradeCostDiscount ?? 0), 0);
  return Math.max(0, total);
}

/**
 * Effective proportional-tax rate after employed-staff overrides
 * (CG-0MTQ7W0ZX0059R3J). The event supplies the base rate (e.g. the Tax
 * Audit's 45%); any employed staff member with a `taxAuditRate` (e.g. the
 * Accountant's 25%) overrides it, and the lowest (most player-favourable)
 * override wins. The result is clamped to [0, 1].
 *
 * @param staffCards Currently employed staff (`state.staffCards`).
 * @param baseRate   The event's own rate (a positive fraction).
 */
export function computeTaxAuditRate(
  staffCards: readonly StaffCard[],
  baseRate: number,
): number {
  let rate = Number.isFinite(baseRate) ? baseRate : 0;
  for (const card of staffCards ?? []) {
    const override = card.taxAuditRate;
    if (typeof override === 'number' && Number.isFinite(override)) {
      rate = Math.min(rate, override);
    }
  }
  return Math.max(0, Math.min(1, rate));
}

/**
 * Positive coin loss a proportional-tax effect collects from `coins` at
 * `rate`: rounded to the nearest integer (shared integer-economy primitive)
 * and clamped to the balance so the result can never drive coins below 0
 * (AC3 of CG-0MTQ7W0ZX0059R3J). Pure; consumes no RNG.
 *
 * @param coins Current banked coin balance.
 * @param rate  Positive fraction of the balance to collect (clamped to [0,1]).
 * @returns Non-negative integer magnitude of the loss.
 */
export function computeProportionalCoinLoss(coins: number, rate: number): number {
  if (!Number.isFinite(coins) || coins <= 0) return 0;
  const effectiveRate = Math.max(0, Math.min(1, Number.isFinite(rate) ? rate : 0));
  return Math.min(coins, roundInt(coins * effectiveRate));
}

/**
 * Flat salary discount for THIS employed staff member (Operations Manager, -50).
 *
 * The caller supplies the member's realisable skills — use
 * {@link getSalaryScopeSkills} to gate them by staff type: the discount is a
 * business-staff effect and never applies from a management-company member
 * (MS-0MW4MSNWR00123OZ AC3).
 */
export function computeStaffSalaryDiscount(skills: readonly SpecializationSkill[]): number {
  return skills.filter(s => s.id === 'skill-operations-manager').length * OPERATIONS_MANAGER_SALARY_DISCOUNT;
}

/**
 * A staff member's ongoing salary after the Operations Manager discount
 * (clamped at 0). Pass {@link getSalaryScopeSkills}' output so a cross-type
 * Operations Manager is inert (MS-0MW4MSNWR00123OZ AC3).
 */
export function computeStaffSalaryCost(
  skills: readonly SpecializationSkill[],
  baseSalary: number,
): number {
  return Math.max(0, baseSalary - computeStaffSalaryDiscount(skills));
}

/** Multiplier on reputation gains from incidents & investments (Brand Ambassador, +50%). */
export function computeReputationGainMultiplier(skills: readonly SpecializationSkill[]): number {
  return skills.some(s => s.id === 'skill-brand-ambassador') ? BRAND_AMBASSADOR_REP_MULTIPLIER : 1;
}

/** Extra synergy range for Entertainment businesses (Tech Guru, +1). */
export function computeEntertainmentSynergyRangeBoost(skills: readonly SpecializationSkill[]): number {
  return skills.filter(s => s.id === 'skill-tech-guru').length;
}

/** Flat coins per adjacent matching synergy (Networker, +20 per adjacency). */
export function computeAdjacencyCoinBonus(skills: readonly SpecializationSkill[]): number {
  return skills.filter(s => s.id === 'skill-networker').length * 20;
}