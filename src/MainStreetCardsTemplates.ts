/**
 * Main Street: Card Template Loading & Accessors
 *
 * Handles CSV import, parsing, template array management, and the
 * `get*Templates()` accessors. Module-level mutable state (`_csvRows`,
 * template arrays, lookup maps) is initialized from the bundled CSV at
 * module load time and can be replaced at runtime via `loadTemplatesFromCsv()`
 * when a saved checkpoint carries different card-data.csv content.
 *
 * @module
 */

import cardDataRaw from './card-data.csv?raw';
import { parseCsv } from '@core-engine/CsvLoader';
import { computeCsvChecksum } from './CsvChecksum';
import type {
  BusinessCard,
  CommunitySpaceCard,
  EventCard,
  DurationEventCard,
  UpgradeCard,
  StaffCard,
  StaffBuffTarget,
  StaffIncidentEffect,
  SynergyType,
  EventTrigger,
  EventTarget,
} from './MainStreetCardsTypes';

// ── Raw CSV & Checksum ──────────────────────────────────────

/**
 * The raw text content of card-data.csv, bundled at build time via Vite's `?raw` import.
 * Exported so that save-game serializers can embed the CSV data in checkpoints.
 */
export const CARD_DATA_RAW: string = cardDataRaw;

/**
 * Deterministic checksum of the current card-data.csv content.
 * Computed once at module load time from the Vite-imported raw CSV.
 * Used to detect when the CSV has changed between saves/loads.
 */
export const CSV_CHECKSUM: string = computeCsvChecksum(cardDataRaw);

/**
 * The CSV text currently backing the template arrays.
 *
 * Equal to {@link CARD_DATA_RAW} for the bundled base pool. When an entitled
 * card pack is active, `loadTemplatesFromCsv()` replaces it with the merged
 * `base + packs` CSV produced by the single merge entry point
 * (`mergeMainStreetCardPool`). Persisted as the save's `csvData` so a load
 * restores the exact same pool.
 */
let _activeCsv: string = cardDataRaw;

/**
 * Checksum of {@link _activeCsv}: the base {@link CSV_CHECKSUM} when no pack
 * is active, or the merged checksum when packs contribute rows.
 */
let _activeChecksum: string = CSV_CHECKSUM;

/**
 * Returns the CSV text currently backing the template arrays.
 *
 * Defaults to the bundled `card-data.csv`; returns the merged `base + packs`
 * CSV once a pack pool has been applied.
 */
export function getActiveCsvData(): string {
  return _activeCsv;
}

/**
 * Returns the checksum of {@link getActiveCsvData} (the merged checksum when
 * packs are active). Persisted as the save's `csvChecksum`.
 */
export function getActiveCsvChecksum(): string {
  return _activeChecksum;
}

/**
 * Replaces the active pool's csv text + checksum. Called by
 * `loadTemplatesFromCsv()` / `resetTemplatesToDefault()`; not part of the
 * public card-pack API.
 *
 * @internal
 */
export function setActiveCsv(csvData: string): void {
  _activeCsv = csvData;
  _activeChecksum = computeCsvChecksum(csvData);
}

// ── Mutable CSV Rows Container ──────────────────────────────

/** Mutable CSV rows container, initialized from the module-level import. */
let _csvRows: Record<string, string>[] = parseCsv(cardDataRaw);

/**
 * Returns the currently active parsed CSV rows.
 * Initially loaded from the bundled card-data.csv at module load time.
 * When a saved checkpoint carries different CSV data (mismatched checksum),
 * loadTemplatesFromCsv() replaces this with the saved CSV's rows.
 */
export function getCsvRows(): readonly Record<string, string>[] {
  return _csvRows;
}

// ── Template Arrays ─────────────────────────────────────────

/** All Business card templates parsed from the CSV. Mutable for runtime CSV reload support. */
let _BUSINESS_TEMPLATES: Omit<BusinessCard, 'family' | 'level' | 'incomeBonus' | 'synergyRangeBonus' | 'reputationBonus'>[] = [];

/** All Community Space card templates parsed from the CSV. Mutable for runtime CSV reload support. */
let _COMMUNITY_SPACE_TEMPLATES: Omit<CommunitySpaceCard, 'family' | 'level' | 'incomeBonus' | 'synergyRangeBonus' | 'reputationBonus'>[] = [];

/** All Event card templates parsed from the CSV. Mutable for runtime CSV reload support. */
let _EVENT_TEMPLATES: EventCard[] = [];

/** All Upgrade card templates parsed from the CSV. Mutable for runtime CSV reload support. */
let _UPGRADE_TEMPLATES: UpgradeCard[] = [];

/** All Staff card templates parsed from the CSV. Mutable for runtime CSV reload support. */
let _STAFF_CARD_TEMPLATES: StaffCard[] = [];

/** Mutable map from card template ID to display name. Updated by rebuildTemplateArrays(). */
let _CARD_TEMPLATE_NAMES: Map<string, string> = new Map();

/** Mutable map from card template ID to tier number. Updated by rebuildTemplateArrays(). */
let _CARD_TIER_MAP: Map<string, string> = new Map();

// ── CSV Reload ──────────────────────────────────────────────

/**
 * Reloads all module-level card template arrays from the given CSV string.
 *
 * This allows the deserializer to use saved checkpoint CSV data when the
 * bundled card-data.csv has changed, ensuring card templates match the
 * saved game state. After a new game setup, resetTemplatesToDefault()
 * restores the bundled import.
 *
 * @param csvData  Raw CSV string (same format as card-data.csv).
 */
export function loadTemplatesFromCsv(csvData: string): void {
  setActiveCsv(csvData);
  _csvRows = parseCsv(csvData);
  rebuildTemplateArrays(_csvRows);
}

/**
 * Resets all module-level card template arrays to their original
 * values from the bundled card-data.csv import.
 */
export function resetTemplatesToDefault(): void {
  setActiveCsv(cardDataRaw);
  _csvRows = parseCsv(cardDataRaw);
  rebuildTemplateArrays(_csvRows);
}

/**
 * Rebuilds the template arrays from the currently active pool CSV.
 *
 * Equivalent to {@link resetTemplatesToDefault} when no card pack is active;
 * when a merged `base + packs` pool has been applied, it keeps that pool
 * instead of dropping back to the bundled base. `setupMainStreetGame()` calls
 * this so a fresh run still deals cards from the active pack pool after a
 * previous load overrode the bundled CSV.
 */
export function resetTemplatesToActivePool(): void {
  _csvRows = parseCsv(_activeCsv);
  rebuildTemplateArrays(_csvRows);
}

// ── Template Rebuild ────────────────────────────────────────

/**
 * Rebuilds the module-level BUSINESS_TEMPLATES, COMMUNITY_SPACE_TEMPLATES,
 * EVENT_TEMPLATES, UPGRADE_TEMPLATES arrays from the given parsed CSV rows.
 * Also rebuilds derived lookup maps (CARD_TEMPLATE_NAMES, CARD_TIER_MAP).
 */
function rebuildTemplateArrays(rows: Record<string, string>[]): void {
  // Rebuild template arrays from parsed CSV rows
  const bizTemplates = rows
    .filter(r => r.family === 'business')
    .map(r => ({
      id: r.id,
      name: r.name,
      cost: Number(r.cost) || 0,
      baseIncome: Number(r.baseIncome) || 0,
      synergyTypes: (r.synergyTypes || '').split('|').filter(Boolean) as unknown as SynergyType[],
      upgradePath: r.upgradePath || undefined,
      maxLevel: Number(r.maxLevel) || 0,
      reputationPerTurn: r.reputationPerTurn ? Number(r.reputationPerTurn) : undefined,
      synergyCoinBonus: r.synergyCoinBonus !== undefined && r.synergyCoinBonus !== '' ? Number(r.synergyCoinBonus) : undefined,
      synergyRepBonus: r.synergyRepBonus !== undefined && r.synergyRepBonus !== '' ? Number(r.synergyRepBonus) : undefined,
      ongoingCost: Number(r.ongoingCost) || 0,
      description: r.description,
    }));

  const csTemplates = rows
    .filter(r => r.family === 'community-space')
    .map(r => ({
      id: r.id,
      name: r.name,
      cost: Number(r.cost) || 0,
      baseIncome: Number(r.baseIncome) || 0,
      ongoingCost: Number(r.ongoingCost) || 0,
      synergyTypes: (r.synergyTypes || '').split('|').filter(Boolean) as unknown as SynergyType[],
      upgradePath: r.upgradePath || undefined,
      maxLevel: Number(r.maxLevel) || 0,
      reputationPerTurn: r.reputationPerTurn ? Number(r.reputationPerTurn) : undefined,
      synergyCoinBonus: r.synergyCoinBonus !== undefined && r.synergyCoinBonus !== '' ? Number(r.synergyCoinBonus) : undefined,
      synergyRepBonus: r.synergyRepBonus !== undefined && r.synergyRepBonus !== '' ? Number(r.synergyRepBonus) : undefined,
      description: r.description,
    }));

  const evtTemplates: EventCard[] = rows
    .filter(r => r.family === 'event')
    .map(r => {
      // Parse optional week-window columns (CG-0MTT0K9RX0004QTE / F1)
      const ws = r.availableWeekStart ? Number(r.availableWeekStart) : undefined;
      const we = r.availableWeekEnd ? Number(r.availableWeekEnd) : undefined;
      // Parse the arbitrary multi-outcome `options` encoding
      // (MS-0MV8KQJR30007JL5). Stored as the raw trimmed cell; compilation in
      // MainStreetStoryline decodes it. A non-empty cell is what makes the
      // card a choice node — it is the only choice encoding in the model.
      const options = r.options !== undefined ? r.options.trim() : '';
      // Parse the per-card piggyback-eligibility flag (MS-0MV8BFOVB000HM0W / F1).
      // Spread only when true so older templates / saves keep the field absent.
      const piggybackable = r.piggybackable
        ? r.piggybackable.trim().toLowerCase() === 'true'
        : undefined;
      // Parse storyline metadata (MS-0MUMP93DI0018OGV / AC1)
      const storylineId = r.storylineId ? r.storylineId.trim() || null : undefined;
      const storylineTitle = r.storylineTitle ? r.storylineTitle.trim() || null : undefined;
      // Optional proportional coin effect (CG-0MTQ7W0ZX0059R3J): signed
      // fraction of banked coins (e.g. -0.45 for the Tax Audit). Absent on
      // flat-delta events.
      const coinPercentDelta = r.coinPercentDelta !== undefined && r.coinPercentDelta !== ''
        ? Number(r.coinPercentDelta)
        : undefined;
      const base: EventCard = {
        family: 'event',
        id: r.id,
        name: r.name,
        cost: Number(r.cost) || 0,
        trigger: r.trigger as EventTrigger,
        effect: r.effect,
        target: r.target as EventTarget,
        targetSynergy: (r.targetSynergy || undefined) as SynergyType | undefined,
        coinDelta: Number(r.coinDelta) || 0,
        reputationDelta: Number(r.reputationDelta) || 0,
        ...(ws !== undefined && we !== undefined
          ? { availableWeekStart: ws, availableWeekEnd: we }
          : {}),
        ...(piggybackable === true ? { piggybackable: true } : {}),
        ...(options !== '' ? { options } : {}),
        ...(storylineId !== undefined ? { storylineId } : {}),
        ...(storylineTitle !== undefined ? { storylineTitle } : {}),
        ...(coinPercentDelta !== undefined && Number.isFinite(coinPercentDelta)
          ? { coinPercentDelta }
          : {}),
      };
      if (r.duration) {
        return {
          ...base,
          duration: Number(r.duration),
          effectType: r.effectType,
          multiplier: Number(r.multiplier) || 0,
        } as DurationEventCard;
      }
      return base;
    });

  const upgTemplates: UpgradeCard[] = rows
    .filter(r => r.family === 'upgrade')
    .map(r => ({
      family: 'upgrade',
      id: r.id,
      name: r.name,
      targetBusiness: r.targetBusiness,
      cost: Number(r.cost) || 0,
      incomeBonus: Number(r.incomeBonus) || 0,
      synergyRangeBonus: Number(r.synergyRangeBonus) || 0,
      description: r.description,
      requiredLevel: r.requiredLevel ? Number(r.requiredLevel) : undefined,
      reputationBonus: r.reputationBonus ? Number(r.reputationBonus) : undefined,
      newDisplayName: r.newDisplayName || undefined,
      // Market upgrade draw weight (MS-0MUYK08I1004I19W): absent/empty ⇒
      // undefined ⇒ baseline weight 1 at refill time.
      drawWeight:
        r.drawWeight !== undefined && r.drawWeight !== ''
          ? Number(r.drawWeight)
          : undefined,
    }));

  // Assign to the mutable module-level variables
  _BUSINESS_TEMPLATES.length = 0;
  _BUSINESS_TEMPLATES.push(...bizTemplates);
  _COMMUNITY_SPACE_TEMPLATES.length = 0;
  _COMMUNITY_SPACE_TEMPLATES.push(...csTemplates);
  _EVENT_TEMPLATES.length = 0;
  _EVENT_TEMPLATES.push(...evtTemplates);
  _UPGRADE_TEMPLATES.length = 0;
  _UPGRADE_TEMPLATES.push(...upgTemplates);

  // Rebuild derived lookup maps
  _CARD_TEMPLATE_NAMES.clear();
  for (const t of bizTemplates) _CARD_TEMPLATE_NAMES.set(t.id, t.name);
  for (const t of csTemplates) _CARD_TEMPLATE_NAMES.set(t.id, t.name);
  for (const t of evtTemplates) _CARD_TEMPLATE_NAMES.set(t.id, t.name);
  for (const t of upgTemplates) _CARD_TEMPLATE_NAMES.set(t.id, t.name);
  // Staff templates are also first-class cards in the general market
  // (CG-0MT3KZNQB0053K55); register them in the display-name lookup.
  for (const row of rows) {
    if (row.family === 'staff' && row.id) {
      _CARD_TEMPLATE_NAMES.set(row.id, row.name);
    }
  }

  _CARD_TIER_MAP.clear();
  for (const row of rows) {
    if (row.tier && row.tier.trim() !== '') {
      _CARD_TIER_MAP.set(row.id, row.tier.trim());
    }
  }

  // Rebuild STAFF_CARD_TEMPLATES
  _STAFF_CARD_TEMPLATES.length = 0;
  const staffRows = rows.filter(r => r.family === 'staff');
  for (const r of staffRows) {
    _STAFF_CARD_TEMPLATES.push({
      family: 'staff',
      id: r.id,
      name: r.name,
      cost: Number(r.cost) || 0,
      ongoingCost: Number(r.ongoingCost) || 0,
      handSlotsAdded: Number(r.handSlotsAdded) || 0,
      description: r.description,
      allowedBusinessTypes: (r.allowedBusinessTypes || '').split('|').filter(Boolean),
      reputationPerTurn: r.reputationPerTurn ? Number(r.reputationPerTurn) : undefined,
      refreshCostDiscount: r.refreshCostDiscount ? Number(r.refreshCostDiscount) : undefined,
      // Per-business upgrade discount (Financial Advisor, CG-0MTKMGL66004I0PC).
      upgradeCostDiscount: r.upgradeCostDiscount ? Number(r.upgradeCostDiscount) : undefined,
      // Legacy street-wide purchase discount (Delivery Driver, CG-0MUMCVH3N007KT1M).
      // Shipped cards use the placement-scoped `staffAdjacentPurchaseDiscount`
      // instead (MS-0MW3JXF6U00753LB); kept for legacy saves/fixtures.
      purchaseCostDiscount: r.purchaseCostDiscount ? Number(r.purchaseCostDiscount) : undefined,
      taxAuditRate: r.taxAuditRate !== undefined && r.taxAuditRate !== '' ? Number(r.taxAuditRate) : undefined,
      actionsPerTurn: r.actionsPerTurn ? Number(r.actionsPerTurn) : undefined,
      peekOncePerTurn: r.peekOncePerTurn ? Number(r.peekOncePerTurn) > 0 : undefined,
      // Free market re-roll ability + relevance bias (Investor, MS-0MTISBYLS009936W).
      freeMarketRerollPerTurn: r.freeMarketRerollPerTurn
        ? Number(r.freeMarketRerollPerTurn) > 0
        : undefined,
      marketRelevanceBias: r.marketRelevanceBias !== undefined && r.marketRelevanceBias !== ''
        ? Number(r.marketRelevanceBias)
        : undefined,
      // Per-business staff card effect (GDD D.4.3/D.4.8, MS-0MW3JXF6U00753LB).
      // The machine-readable spec rides in the row's `effect` column (staff
      // rows carry no human-readable event effect text), so the base CSV keeps
      // its existing column set — card packs are validated against that exact
      // header (core CardPackMerge), so adding columns would reject every pack.
      ...parseStaffEffect(r.effect),
    });
  }
}

// ── Staff per-business card-effect spec ─────────────────────

/** The per-business card buffs parsed out of a staff row's `effect` spec. */
interface ParsedStaffEffect {
  incomeBonus?: number;
  incomeBonusTarget?: StaffBuffTarget;
  incomeBonusTypes?: string[];
  incomePercent?: number;
  reputationBonus?: number;
  reputationBonusTarget?: StaffBuffTarget;
  reputationPercent?: number;
  synergyRangeBonus?: number;
  adjacencyPurchaseDiscount?: number;
  incidentEffect?: StaffIncidentEffect;
}

/** Parses a pipe-separated business/synergy type list (`Commerce|Culture`). */
function parseStaffTypeList(raw: string | undefined): string[] | undefined {
  const types = (raw ?? '').split('|').map(part => part.trim()).filter(Boolean);
  return types.length > 0 ? types : undefined;
}

/** Converts a spec percentage (`20`) into a fraction (`0.2`). */
function staffFraction(percent: number): number {
  return percent / 100;
}

/**
 * Parses a staff card's per-business effect spec from the row's `effect`
 * column (GDD D.4.3/D.4.8, MS-0MW3JXF6U00753LB).
 *
 * Grammar — `dimension:<scope>:<amount>[:<types>]`, percentages written as
 * whole numbers for readability:
 *
 * | spec | meaning |
 * |------|---------|
 * | `income:own:25` | +25 coins/turn to the employing business |
 * | `income:adjacent:20:Food` | +20 coins/turn to each adjacent Food business |
 * | `income:percent:20` | +20% income to the employing business |
 * | `reputation:own:15` | +15 reputation/turn to the employing business |
 * | `reputation:adjacent:10` | +10 reputation/turn to each adjacent business |
 * | `reputation:percent:10` | +10% reputation for the employing business |
 * | `synergy-range:1` | +1 synergy range for the employing business |
 * | `purchase-discount:adjacent:50` | −50 coins on businesses placed adjacent |
 * | `incident-coin:<own\|cluster>:10` | −10% incident coin damage |
 * | `incident-reputation:<own\|cluster>:50` | −50 incident reputation damage |
 * | `incident-frequency:<own\|cluster>:10` | −10% incident frequency |
 *
 * A blank or malformed spec yields no buffs (the safe default) rather than
 * throwing: a bad data cell must never break the income/incident phase. The
 * two-type test suite asserts every shipped card's parsed effect, so a
 * malformed spec fails the build rather than silently doing nothing.
 */
function parseStaffEffect(raw: string | undefined): ParsedStaffEffect {
  const parts = (raw ?? '').split(':').map(part => part.trim());
  if (parts.length < 2) return {};
  const [kind, scope] = parts;

  if (kind === 'synergy-range') {
    const range = Number(scope);
    return Number.isFinite(range) ? { synergyRangeBonus: range } : {};
  }

  const amount = Number(parts[2]);
  if (!Number.isFinite(amount) || amount < 0) return {};

  switch (kind) {
    case 'income':
      if (scope === 'percent') return { incomePercent: staffFraction(amount) };
      if (scope !== 'own' && scope !== 'adjacent') return {};
      return {
        incomeBonus: amount,
        incomeBonusTarget: scope,
        incomeBonusTypes: scope === 'adjacent' ? parseStaffTypeList(parts[3]) : undefined,
      };
    case 'reputation':
      if (scope === 'percent') return { reputationPercent: staffFraction(amount) };
      if (scope !== 'own' && scope !== 'adjacent') return {};
      return { reputationBonus: amount, reputationBonusTarget: scope };
    case 'purchase-discount':
      return scope === 'adjacent' ? { adjacencyPurchaseDiscount: amount } : {};
    case 'incident-coin':
    case 'incident-reputation':
    case 'incident-frequency': {
      if (scope !== 'own' && scope !== 'cluster') return {};
      const incidentKind = kind === 'incident-coin'
        ? 'coin'
        : kind === 'incident-reputation' ? 'reputation' : 'frequency';
      const magnitude = incidentKind === 'reputation' ? amount : staffFraction(amount);
      return { incidentEffect: { kind: incidentKind, amount: magnitude, target: scope } };
    }
    default:
      return {};
  }
}

// ── Template Accessors ──────────────────────────────────────

/** Returns the currently active Business card template arrays. */
export function getBusinessTemplates(): typeof _BUSINESS_TEMPLATES {
  return _BUSINESS_TEMPLATES;
}

/** Returns the currently active Community Space card template arrays. */
export function getCommunitySpaceTemplates(): typeof _COMMUNITY_SPACE_TEMPLATES {
  return _COMMUNITY_SPACE_TEMPLATES;
}

/** Returns the currently active Event card template arrays. */
export function getEventTemplates(): EventCard[] {
  return _EVENT_TEMPLATES;
}

/** Returns the currently active Upgrade card template arrays. */
export function getUpgradeTemplates(): UpgradeCard[] {
  return _UPGRADE_TEMPLATES;
}

/** Returns the currently active Staff card templates. */
export function getStaffCardTemplates(): StaffCard[] {
  return _STAFF_CARD_TEMPLATES;
}

// Initialize all template arrays from the bundled CSV
rebuildTemplateArrays(_csvRows);

// ── Deprecated (kept for backward compatibility) ────────────

/**
 * @deprecated Use getCsvRows() instead.
 * Kept for backward compatibility. This reference is set at module init time
 * and will NOT update after loadTemplatesFromCsv() is called. Consumers
 * should use getCsvRows() for the live value.
 */
export const CSV_ROWS: readonly Record<string, string>[] = _csvRows;

/**
 * @deprecated Use getStaffCardTemplates() instead.
 * Kept for backward compatibility with existing test code.
 */
export const STAFF_CARD_TEMPLATES: StaffCard[] = _STAFF_CARD_TEMPLATES;

// ── Lookup Maps (Read-only references) ──────────────────────

/**
 * Read-only map from card template ID (e.g. `'biz-cafe'`) to its display name
 * (e.g. `'Cafe'`). Updated at runtime when loadTemplatesFromCsv() is called.
 */
export const CARD_TEMPLATE_NAMES: ReadonlyMap<string, string> = _CARD_TEMPLATE_NAMES;

/**
 * Read-only map from card template ID (e.g. `'biz-cafe'`) to its tier number
 * (as a numeric string, e.g. `'1'` through `'12'`).
 */
export const CARD_TIER_MAP: ReadonlyMap<string, string> = _CARD_TIER_MAP;
