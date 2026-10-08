/**
 * Main Street: Card Type Definitions
 *
 * All TypeScript interfaces, type aliases, and enums that define the five
 * card families (Business, CommunitySpace, Event, Upgrade, Staff), synergy
 * types, event targeting, incident balance state, and related discriminated
 * unions.
 *
 * @module
 */

import type { MainStreetState } from './MainStreetState';

// ── Synergy Types ───────────────────────────────────────────

/** Synergy types used by Business cards for adjacency bonuses. */
export type SynergyType = 'Food' | 'Culture' | 'Commerce' | 'Service' | 'Entertainment' | 'Health';

/**
 * All synergy type names, in a stable order. Useful for building
 * generalist staff `allowedBusinessTypes` lists and for CSV validation.
 */
export const SYNERGY_TYPE_NAMES: readonly SynergyType[] = [
  'Food',
  'Culture',
  'Commerce',
  'Service',
  'Entertainment',
  'Health',
] as const;

/**
 * The structural shape `staffMatchesBusiness` matches against: a placed
 * business or community-space card (both expose `name` and `synergyTypes`).
 */
export interface StaffBusinessTarget {
  readonly name: string;
  readonly synergyTypes?: readonly SynergyType[];
}

// ── Staff Specialization Skills ─────────────────────────────

/** Effect category a specialization skill belongs to (AC4 of CG-0MT1CIWSD003VBPK). */
export type SpecializationSkillCategory =
  | 'income-boost'
  | 'reputation-boost'
  | 'cost-reduction'
  | 'incident-mitigation';

/**
 * Categories tracked by the per-staff stacking cap: a staff member may hold
 * at most 1 income-boost AND at most 1 reputation-boost skill beyond the Town
 * Gossip baseline. Other categories (cost-reduction, incident-mitigation)
 * stack freely (AC4 / acceptance criteria of CG-0MT4WXQCN001G1LF).
 */
export const STACKED_SKILL_CATEGORIES: readonly SpecializationSkillCategory[] = [
  'income-boost',
  'reputation-boost',
] as const;

/**
 * A single specialization skill from the global pool.
 *
 * Skills are randomized once per game at start and locked for the full game;
 * they are stored in game state by id (strings) and resolved through the
 * catalog (`getSkill` in MainStreetStaffSkills). `category` doubles as the
 * stacking-tracked category for income/reputation boosts.
 */
export interface SpecializationSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Effect category; also the stacking-tracked category for income/reputation boosts. */
  readonly category: SpecializationSkillCategory;
  /**
   * Machine-readable effect hint consumed by buff wiring (MainStreetStaffBuffs,
   * I4 CG-0MT4WXV2J000M35M) and rendering/help text (I5 CG-0MT4WXX1Q00860VP).
   * Mirrors `description` in semantics; kept stable for serialized state.
   */
  readonly effect: string;
}

// ── Event & Card Family Types ───────────────────────────────

/** When an Event card resolves. */
export type EventTrigger = 'Investment' | 'Incident';

/** Scope of an Event card's effect. */
export type EventTarget = 'All' | 'SpecificSynergy' | 'RandomBusiness';

/** Discriminator for the card families (business, event, upgrade, community-space, staff). */
export type CardFamily = 'business' | 'event' | 'upgrade' | 'community-space' | 'staff';

// ── Card Interfaces ─────────────────────────────────────────

/**
 * A Business card placed on the street grid.
 * Generates base income + synergy bonuses each turn.
 */
export interface BusinessCard {
  readonly family: 'business';
  readonly id: string;
  readonly name: string;
  readonly cost: number;
  readonly baseIncome: number;
  readonly synergyTypes: readonly SynergyType[];
  readonly upgradePath?: string;
  readonly maxLevel: number;
  readonly description: string;
  /** Current upgrade level (starts at 0, incremented by upgrades). */
  level: number;
  /** Cumulative income bonus from applied upgrades. */
  incomeBonus: number;
  /** Cumulative synergy range extension from applied upgrades. */
  synergyRangeBonus: number;
  /**
   * Cumulative reputation bonus from applied upgrades.
   * Initialized to 0 for all cards.
   */
  reputationBonus: number;
  /**
   * Base reputation generated per turn by this business (without upgrades).
   * Integer values (×100, e.g. 20 for the Clinic).
   */
  reputationPerTurn?: number;
  /**
   * Coin synergy contribution per matching neighbor, as a fraction of the
   * neighbor's base income. Defaults to 0.5 (50% of base income per matching
   * adjacency) when undefined. Set to 0 to exclude this card from
   * contributing synergy to neighbors.
   */
  readonly synergyCoinBonus?: number;
  /**
   * Reputation synergy contribution per matching neighbor.
   * Defaults to 0 (no reputation from adjacency synergy) when undefined.
   */
  readonly synergyRepBonus?: number;
  /**
   * IDs of upgrade cards that have been applied to this business instance,
   * in application order. Used to enforce multi-level chain requirements and
   * to prevent the same branch being applied twice.
   *
   * Omitting this field is treated as an empty array.
   */
  appliedUpgrades?: string[];
  /**
   * Cumulative cost of all upgrade cards applied to this business instance.
   * Used for sell value calculation. Defaults to 0 for cards without upgrades.
   */
  totalUpgradeCost?: number;
  /**
   * Display name baked into the card's SVG face when the business has been
   * upgraded (CG-0MT24MHGZ0025O20). Set to the upgraded business name by
   * `purchaseUpgrade()` / `playUpgradeFromHand()` when an upgrade card is
   * applied. Falls back to `name` (the original business name) when the
   * business is at level 0 (un-upgraded). The overlay spec intentionally
   * carries NO name overlay — the name renders as part of the card image.
   */
  displayName?: string;

  /**
   * Current effective income per turn (base + upgrade bonus + synergy + same-type penalty).
   * Updated incrementally when neighbors are placed/sold, so the income phase
   * reads this cached value instead of recalculating from scratch every turn.
   * Undefined until the card is placed on the grid and recalculateCard is called.
   */
  currentIncome?: number;

  /**
   * Current effective reputation per turn (base repPerTurn + upgrade repBonus + synergy rep).
   * Updated incrementally when neighbors are placed/sold.
   * Undefined until the card is placed on the grid and recalculateCard is called.
   */
  currentReputationPerTurn?: number;

  /**
   * Ongoing per-turn cost for this business card.
   * Deducted from coins each income phase, whether the card is placed on the
   * street grid or held in hand. Mirrors StaffCard and CommunitySpaceCard.
   * Defaults to 0 for legacy cards with no CSV value.
   */
  readonly ongoingCost: number;

  /**
   * Staff members currently employed at this business slot
   * (CG-0MTIOLY2A0092OT1 AC2). The per-business employment source of truth;
   * `getEmployedStaffCountAt` reads this array (falling back to legacy
   * `staff.employedAtSlot` links for in-memory states that predate the
   * field). Kept in sync with each member's `employedAtSlot` by the hire /
   * lay-off paths and backfilled on deserialize.
   */
  employedStaff?: StaffCard[];
}

/**
 * An Event card that triggers a one-off effect.
 * Investment events are purchased and held until played; Incident events are drawn automatically.
 */
export interface EventCard {
  readonly family: 'event';
  readonly id: string;
  readonly name: string;
  readonly trigger: EventTrigger;
  readonly cost: number;
  readonly effect: string;
  readonly target: EventTarget;
  readonly targetSynergy?: SynergyType;
  readonly coinDelta: number;
  readonly reputationDelta: number;
  /**
   * Optional proportional coin effect, expressed as a signed fraction of the
   * player's banked coins at resolution time (e.g. `-0.45` = lose 45% of
   * `state.resourceBank.coins`). When present it takes precedence over
   * `coinDelta` for resolution and AI projection; `coinDelta` remains the
   * nominal value used for static severity ranking and as a fallback. The
   * loss is rounded to the nearest integer and clamped so the balance never
   * drops below 0. Absent on flat-delta events (backward compatible).
   *
   * Employed staff may lower the rate via {@link StaffCard.taxAuditRate}
   * (e.g. the Accountant: 45% -> 25%).
   */
  readonly coinPercentDelta?: number;
  /**
   * Optional week window for seasonal/holiday events.
   * When present, the card is only offerable/drawable when the current
   * game week falls within [availableWeekStart, availableWeekEnd] inclusive.
   * When undefined, the card is year-round (always available).
   */
  readonly availableWeekStart?: number;
  readonly availableWeekEnd?: number;
  /**
   * When true, the event presents a choice dialog (Accept / Reject) at
   * resolution time (AC2 CG-0MTSHG8RP008E128). Defaults to falsy / false
   * for backward compatibility — cards without this field are non-choice.
   */
  readonly hasChoices?: boolean;
  /**
   * When the player chooses Accept, this card ID is added to the incident
   * deck after the event's effect is applied. Null / absent ends the chain.
   */
  readonly acceptNextCardId?: string | null;
  /**
   * When the player chooses Reject, this card ID is added to the incident
   * deck (the event's effect is NOT applied). Null / absent ends the chain.
   */
  readonly rejectNextCardId?: string | null;
  /**
   * Optional storyline identifier — groups cards into a named story arc.
   * Absent means the card is not part of a storyline (legacy behaviour).
   * Cards sharing the same `storylineId` form one story arc.
   */
  readonly storylineId?: string | null;
  /**
   * Human-readable title for the storyline (displayed in journal/UI).
   * Optional; defaults to the storylineId when absent.
   */
  readonly storylineTitle?: string | null;
}

/**
 * A Duration-based Event card that creates an ActiveEffect rather than
 * applying a one-shot coin/reputation delta.
 *
 * Extends EventCard with fields needed for duration-based modifiers:
 * - `duration`: number of turns the effect lasts
 * - `effectType`: discriminator for which aspect of the game is modified
 *   (e.g. 'income-multiplier', 'rep-multiplier')
 * - `multiplier`: the scalar value applied each turn (e.g. 0.8 for 80% income)
 */
export interface DurationEventCard extends EventCard {
  readonly duration: number;
  readonly effectType: string;
  readonly multiplier: number;
}

/**
 * An Upgrade card that enhances a specific Business card.
 *
 * Branching upgrades: multiple `UpgradeCard` entries may share the same
 * `targetBusiness` and `requiredLevel`, giving the player a choice of which
 * upgrade branch to take.
 *
 * Multi-level chains: set `requiredLevel > 0` so the card can only be applied
 * after the business has already been upgraded that many times.
 */
export interface UpgradeCard {
  readonly family: 'upgrade';
  readonly id: string;
  readonly name: string;
  readonly targetBusiness: string;
  readonly cost: number;
  readonly incomeBonus: number;
  readonly synergyRangeBonus: number;
  readonly description: string;
  /**
   * Minimum business level required before this upgrade may be applied.
   * 0 (default) = can be applied to the base (un-upgraded) business.
   * 1 = can only be applied after the business has been upgraded once, etc.
   *
   * Omitting this field is equivalent to setting it to 0.
   */
  readonly requiredLevel?: number;
  /**
   * Additional reputation generated per turn when this upgrade is applied.
   * Works like incomeBonus but for reputation instead of coins.
   * Integer values (×100, e.g. 10 for the Medical Center upgrade).
   */
  readonly reputationBonus?: number;
  /**
   * The new display name for the target business when this upgrade is applied.
   * This is the name baked into the card's SVG face when the business is
   * upgraded (e.g., "Patisserie" for an upgrade that turns a Bakery into a
   * Patisserie) — CG-0MT24MHGZ0025O20. Used by `purchaseUpgrade()`/`playUpgradeFromHand()`
   * to set the business's `displayName`, and by the SVG texture pipeline to
   * produce a display-name variant card face.
   */
  readonly newDisplayName?: string;
  /**
   * Optional relative draw weight used when the single-row market selects
   * which upgrade card to place in a slot (MS-0MUYK08I1004I19W).
   *
   * The effective base weight is `drawWeight ?? 1`, clamped at `0`. Weighted
   * selection activates only when at least one upgrade deck card declares a
   * weight; an undecorated deck keeps the legacy plain `pop()` draw and
   * consumes no extra RNG. At refill a declared card whose parent business is
   * on the street at its `requiredLevel` (and below `maxLevel`) additionally
   * receives the additive `UPGRADE_ELIGIBLE_DRAW_BONUS`, so a capstone surfaces
   * once its prerequisite chain is ready instead of being drawn — and
   * discarded — before it can be bought. The mechanism does NOT change the
   * 78-card deck size or its `shuffleArray` Fisher–Yates call count, which
   * preserves before/after attribution of seeded Monte Carlo runs.
   */
  readonly drawWeight?: number;
}

/**
 * A Staff card that increases hand capacity.
 * Staff cards are a new card family distinct from business/event/upgrade.
 * They do NOT occupy hand slots and have an ongoing per-turn coin cost.
 */
export interface StaffCard {
  readonly family: 'staff';
  readonly id: string;
  readonly name: string;
  readonly cost: number;
  readonly ongoingCost: number;
  readonly handSlotsAdded: number;
  readonly description: string;
  /**
   * Specialization skills randomized at game start (CG-0MT4WXSWG0023VR0,
   * parent CG-0MT1CIWSD003VBPK). Stored as stable catalog ids; resolved via
   * `getSkill`. Assigned once per card instance at setup and locked for the
   * full game. Absent (undefined) on legacy saves — treat as no skills.
   */
  specializationSkillIds?: string[];
  /**
   * Street-grid slot index of the deployed business this staff member is
   * employed at (CG-0MSTOATDU006UGAX). Per-business specialization buffs
   * (income/reputation) apply ONLY to this business; undefined = hand-slot
   * staff (existing mechanic) who contribute no per-business income/rep
   * buffs but whose street-wide skills still aggregate (cost cutter,
   * incidents, brand ambassador, negotiator, ops-manager salary).
   */
  employedAtSlot?: number;
  /**
   * Business names and/or synergy type names this staff member may serve
   * (CG-0MTIOLY2A0092OT1). Absent/empty = generalist (matches any business;
   * legacy hand-slot behaviour). Parsed from the `allowedBusinessTypes` CSV
   * column; both specific business names (e.g. `Cafe`) and synergy type
   * names (e.g. `Food`) are valid tokens.
   */
  readonly allowedBusinessTypes?: readonly string[];
  /**
   * Optional reputation granted per turn during the income phase
   * (e.g. the Socialite's +10 rep/turn ability — Group F,
   * CG-0MSQJ7VL9009JHF4).
   */
  readonly reputationPerTurn?: number;
  /**
   * Optional flat coin discount applied to each investment-row refresh
   * (e.g. the Accountant's "refresh costs 1 less" ability — Group F,
   * CG-0MSQJ7VL9009JHF4).
   */
  readonly refreshCostDiscount?: number;
  /**
   * Optional flat coin discount applied to buying an upgrade for the
   * business where this staff member is employed (e.g. the Financial
   * Advisor's "upgrade costs 100 less" ability — CG-0MTKMGL66004I0PC).
   * Scoped to the employing business (`employedAtSlot` / the business's
   * `employedStaff` list); discounts from multiple staff at the same
   * business stack additively and the effective upgrade cost is floored
   * at 0. Absent for staff without the ability (backward compatible).
   */
  readonly upgradeCostDiscount?: number;
  /**
   * Optional flat coin discount applied to business-card purchase cost,
   * summed street-wide across all hired staff (e.g. the Delivery Driver's
   * "reduces business card purchase cost by 50" ability —
   * CG-0MUMCVH3N007KT1M). Street-wide: every hired staff member's
   * `purchaseCostDiscount` is summed, clamped at 0. Absent for staff
   * without the ability (backward compatible).
   */
  readonly purchaseCostDiscount?: number;
  /**
   * Optional Tax Audit rate override, as a fraction of banked coins
   * (e.g. `0.25` for the Accountant's "tax losses reduced to 25%" ability).
   * When one or more employed staff define this, the lowest (most
   * player-favourable) value is used for proportional tax events instead of
   * the event's own `coinPercentDelta`. Absent for staff without the ability
   * (backward compatible).
   */
  readonly taxAuditRate?: number;
  /**
   * Optional additional actions granted per turn.
   * (e.g. the Manager, Director and General Manager each grant +1 action
   * per week — CG-0MSTOF1N5005PK2R, MS-0MTQ7S5EJ008MWD0).
   */
  readonly actionsPerTurn?: number;
  /**
   * Optional staff peek ability: once per turn, as an action, the player
   * may reveal the top card of the face-down incident deck and return it
   * face-down without resolving it (CG-0MSXOW6GN008ZSMN).
   */
  readonly peekOncePerTurn?: boolean;
  /**
   * Optional free market re-roll ability (the Investor, MS-0MTISBYLS009936W).
   * While at least one staff member with this flag is employed, the player may
   * perform one coin-free, action-free market re-roll per turn. Multiple such
   * staff do not stack (still one per turn). Absent for staff without the
   * ability (backward compatible).
   */
  readonly freeMarketRerollPerTurn?: boolean;
  /**
   * Optional relevance bias for the free market re-roll, as a fraction in
   * `[0, 1]` (the Investor's `0.75`, MS-0MTISBYLS009936W). On a biased draw,
   * each slot has this probability of being drawn from the pool relevant to
   * the business the staff member is employed at, with the remainder drawn
   * fully at random. Absent for staff without the ability (backward
   * compatible).
   */
  readonly marketRelevanceBias?: number;
}

/** Community Space card placed on the street grid, parallel to BusinessCard. */
export interface CommunitySpaceCard {
  readonly family: 'community-space';
  readonly id: string;
  readonly name: string;
  readonly cost: number;
  readonly baseIncome: number;
  /**
   * Ongoing per-turn coin cost paid each IncomePhase (e.g. the Library costs
   * 25 coins/turn to run). Defaults to 0 for community spaces without a
   * running cost. Mirrors the StaffCard `ongoingCost` mechanic.
   */
  readonly ongoingCost: number;
  readonly synergyTypes: readonly SynergyType[];
  readonly upgradePath?: string;
  readonly maxLevel: number;
  readonly description: string;
  /** Current upgrade level (starts at 0, incremented by upgrades). */
  level: number;
  /** Cumulative income bonus from applied upgrades. */
  incomeBonus: number;
  /** Cumulative synergy range extension from applied upgrades. */
  synergyRangeBonus: number;
  /**
   * Cumulative reputation bonus from applied upgrades.
   * Initialized to 0 for all cards.
   */
  reputationBonus: number;
  /**
   * Base reputation generated per turn by this community space (without upgrades).
   * Integer values (×100, e.g. 20).
   */
  reputationPerTurn?: number;
  /**
   * Coin synergy contribution per matching neighbor, as a fraction of the
   * neighbor's base income. Defaults to 0.5 (50% of base income per matching
   * adjacency) when undefined. Set to 0 to exclude this card from
   * contributing synergy to neighbors.
   */
  readonly synergyCoinBonus?: number;
  /**
   * Reputation synergy contribution per matching neighbor.
   * Defaults to 0 (no reputation from adjacency synergy) when undefined.
   */
  readonly synergyRepBonus?: number;
  /**
   * IDs of upgrade cards that have been applied to this community space instance,
   * in application order.
   *
   * Omitting this field is treated as an empty array.
   */
  appliedUpgrades?: string[];

  /**
   * Current effective income per turn (base + upgrade bonus + synergy + same-type penalty).
   * Updated incrementally when neighbors are placed/sold.
   * Undefined until the card is placed on the grid and recalculateCard is called.
   */
  currentIncome?: number;

  /**
   * Current effective reputation per turn (base repPerTurn + upgrade repBonus + synergy rep).
   * Updated incrementally when neighbors are placed/sold.
   * Undefined until the card is placed on the grid and recalculateCard is called.
   */
  currentReputationPerTurn?: number;
  /**
   * Display name baked into the card's SVG face when the community space has
   * been upgraded (CG-0MT24MHGZ0025O20). Set to the upgraded name by
   * `purchaseUpgrade()` / `playUpgradeFromHand()` when an upgrade card is
   * applied. Falls back to `name` (the original name) when the community
   * space is at level 0 (un-upgraded).
   */
  displayName?: string;
  /**
   * Staff members currently employed at this community-space slot — mirrors
   * `BusinessCard.employedStaff` (CG-0MTIOLY2A0092OT1). Community spaces are
   * valid employment targets for the applicant mechanic, so they carry the
   * same per-business employed list.
   */
  employedStaff?: StaffCard[];
}

/** Union of all card types in Main Street. */
export type AnyCard = BusinessCard | CommunitySpaceCard | EventCard | DurationEventCard | UpgradeCard | StaffCard;

// ── Incident Balance Types ──────────────────────────────────

/**
 * Polarity of an Incident card's net effect (`coinDelta + reputationDelta`).
 * Used by the constrained incident-draw system to bound luck streaks.
 */
export type IncidentPolarity = 'good' | 'bad' | 'neutral';

/** A run of consecutive same-polarity drawn incidents (good/bad only; neutral breaks runs). */
export interface IncidentPolarityRun {
  polarity: 'good' | 'bad';
  length: number;
}

/**
 * Runtime-mutable state governing constrained Incident draws.
 *
 * Incidents live in a hidden face-down deck (CG-0MSTOATDP000JNHH); deck
 * order is arranged at build/reshuffle time so the sequence of incidents
 * the player actually resolves is constrained by two limits:
 *
 * - `repeatSpacing` (N): a card name cannot reappear within the last
 *   `N - 1` drawn cards (e.g. N=3 blocks a card drawn at position 1 from
 *   reappearing at positions 2 or 3).
 * - `maxStreak` (M): never more than M consecutive same-polarity cards
 *   (good = net > 0, bad = net < 0). Neutral cards (net == 0) break runs.
 *
 * Both limits are mutable at runtime via `setIncidentBalanceLimits` in
 * `MainStreetState.ts`; changes affect subsequent rebuilds only.
 */
export interface IncidentBalanceState {
  /** Repeat-spacing window N (>= 1, default 3). */
  repeatSpacing: number;
  /** Max consecutive same-polarity (good/bad) cards M (>= 1, default 2). */
  maxStreak: number;
  /**
   * Names of recently drawn incidents, most recent first, bounded to
   * `MAX_TRACKED_INCIDENT_HISTORY` entries. The selector uses only the
   * most recent `repeatSpacing - 1` names for the repeat window, so
   * increasing N at runtime works up to the stored history depth.
   */
  recentNames: string[];
  /**
   * Current same-polarity run among recently drawn incidents.
   * `null` when the last drawn card was neutral or nothing has been drawn.
   */
  polarityRun: IncidentPolarityRun | null;
}

/** Default repeat-spacing window for constrained incident draws. */
export const DEFAULT_INCIDENT_REPEAT_SPACING = 3;

/** Default max consecutive same-polarity (good/bad) incidents. */
export const DEFAULT_INCIDENT_MAX_STREAK = 2;

/**
 * Cap on tracked recent incident names. The selector consumes only the most
 * recent `repeatSpacing - 1` entries, so runtime increases of N work up to
 * this depth; beyond it the constraint degrades gracefully (uses all history).
 */
export const MAX_TRACKED_INCIDENT_HISTORY = 10;

// ── Generalised option model (extraction seam types) ─────────

/**
 * A single option within a storyline's ordered option list.
 * The engine resolves options sequentially (in declaration order) until the
 * player selects one.
 */
export interface StorylineOption {
  /** Human-readable label for the option (e.g. "Accept", "Reject", "Investigate"). */
  readonly label: string;
  /** The card ID to push when this option is chosen. Null / absent ends the chain. */
  readonly successorId: string | null | undefined;
  /** Whether the event's intrinsic effect applies when this option is chosen. */
  readonly effectPolicy: 'apply' | 'skip';
  /**
   * Optional runtime condition evaluated at draw time.
   * If the callback returns `false` the option is omitted from the presented
   * option list.  Evaluated once when the option list is compiled (at draw
   * time), never at resolution.
   *
   * **Contract:** must be a pure function — no observable side effects.
   * Mutating state inside a condition callback is undefined behaviour.
   *
   * @readonly
   */
  readonly condition?: (state: MainStreetState) => boolean;
  /**
   * Optional runtime successor resolver evaluated at resolution time.
   * When present, the callback is invoked and its return value is used as
   * the pushed successor card ID instead of `option.successorId`.
   * Returns `null` or `undefined` to end the chain (no card pushed).
   *
   * **Contract:** must be a pure function — no observable side effects.
   *
   * @readonly
   */
  readonly successorResolver?: (state: MainStreetState) => string | null | undefined;
}

/**
 * A compiled storyline definition extracted from a card's legacy
 * hasChoices / acceptNextCardId / rejectNextCardId fields, or from
 * explicit storyline metadata.
 *
 * Legacy compilation:
 * - `hasChoices: false` → compiledOptions is empty (non-choice card).
 * - `hasChoices: true` → two options:
 *   1. label="Accept", successorId=acceptNextCardId, effectPolicy="apply"
 *   2. label="Reject", successorId=rejectNextCardId, effectPolicy="skip"
 */
export interface CompiledStoryline {
  /** The storyline identifier this definition belongs to. Null for non-storyline cards. */
  readonly storylineId: string | null;
  /** Ordered list of options; empty for non-choice cards. */
  readonly compiledOptions: StorylineOption[];
}
