/**
 * Turn Summary — ledger tooltip model and content — MS-0MW6GZKZZ006PLLO
 * (feature MS-0MW7QQ5BX002KGS0, verification MS-0MW7QQ1FD000RCA3).
 *
 * The canonical unit suite for the data-and-copy half of the ledger-tooltip
 * work. It proves that every figure a player can hover has a correct, localised
 * explanation derived from committed engine data.
 *
 *  - the P&L projection threads **per-business income** breakdowns from
 *    `IncomeResult.breakdown` / `phaseBreakdown.perSlotBreakdown`;
 *  - the P&L projection threads **per-card expense** breakdowns (staff /
 *    community / business) derived from the committed state the same way the
 *    engine's per-card cost helpers compute them;
 *  - the tooltip content builders present those breakdowns, the incident name
 *    and effect, the one-off reconciliation formula (documented fallback) and
 *    the net reconciliation formula;
 *  - supplementary context rows carry explanatory tooltips;
 *  - all copy is localisable through the shared `t()` / `registerLocale`
 *    system with English defaults registered at module load;
 *  - competitive per-seat income uses each seat's own breakdown and degrades
 *    gracefully when absent;
 *  - competitive per-seat expense breakdowns list each seat's own staff,
 *    community spaces and businesses (tracers, MS-0MWEGDMVZ005DQ32);
 *  - every addition is absent-safe (legacy/hand-built ledgers render) and
 *    touches no state and no RNG.
 *
 * The overlay wiring (`attachHudTooltipZone` attachment and interaction) is
 * verified by the browser suite (`turn-summary-pl-overlay.browser.test.ts`).
 *
 * ## Enhanced content contract (MS-0MWC90T19000JEA4)
 *
 * The end-of-turn tooltips are deepened from a single comma-joined
 * `Per item: A: +5, B: +7` line into a **one contributing item per line**
 * layout that shows each item's base value and every named modifier. This suite
 * pins the exact content contract the builder children
 * (MS-0MWC90TUH007CC8T / MS-0MWC90UOM006RAW6) implement, following the repo
 * test-first `it.fails` tracer-bullet convention (see
 * `turn-summary-pl-model.test.ts` and `competitive-per-seat-hand-capacity.test.ts`).
 *
 * Contract the builder children satisfy (the tracers are now plain `it`):
 *
 * 1. **Income rows** — `label: amount` then one `name: signed` line per
 *    contributing business. The Events row additionally lists each committed
 *    event effect as an indented `  effect: signed delta` line beneath its
 *    business.
 * 2. **Expense rows** — `label: amount` then one `name: signed` line per card.
 *    A staff item that carries modifiers adds an indented `  Base: signed`
 *    line and one indented `  <modifier>: signed` line per modifier (e.g.
 *    `  Operations Manager: +50`), reconciling `base + modifiers === coins`.
 *    The existing `Street-wide reduction` / `Limited by available coins` /
 *    `Total` reconciliation lines are kept.
 * 3. **Incident row** — the resolved incident's `name: Coins signed, Rep signed`
 *    headline, then `Base: Coins …, Rep …`, one `<modifier>: Coins …, Rep …`
 *    line per applied modifier, all reconciling to the committed deltas. The
 *    `null` note is unchanged.
 * 4. **Total rows** — `buildTotalLineTooltip` takes the section and enumerates
 *    one `line label: signed amount` per contributing line beneath the
 *    committed subtotal (replacing "The sum of the lines above").
 * 5. **Context rows** — closing coins shows `Day start + Net change = Closing`;
 *    reputation change shows its income/incident/one-off constituents; and
 *    businesses owned names the businesses (one per line). Score change keeps
 *    its prose. Every derivation is absent-safe: a context without the new
 *    fields keeps the existing explanatory prose.
 *
 * Guards that already hold today (absent-safe fallback, the incident `null`
 * note) stay plain `it` so they keep protecting the contract.
 *
 * @module tests/main-street/turn-summary-tooltips
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { MainStreetState } from '../../src/MainStreetState';
import { createCompetitiveState, setupMainStreetGame } from '../../src/MainStreetState';
import {
  getStaffCardTemplates,
  type BusinessCard,
  type CommunitySpaceCard,
  type EventCard,
  type StaffCard,
} from '../../src/MainStreetCards';
import { applyCompetitiveOngoingCosts } from '../../src/MainStreetEngineCommands';
import type {
  CompetitiveRoundLedger,
  OwnerRoundLedger,
  TurnLedger,
  TurnResult,
} from '../../src/MainStreetEngineTypes';
import type { IncomeResult, SlotIncome, SlotPhaseBreakdown } from '../../src/MainStreetAdjacency';
import {
  buildCompetitiveTurnSummary,
  buildPLFromCompetitiveRow,
  buildPLProjection,
  buildTurnSummary,
  expenseLineBreakdownForOwner,
  type PLStatementLine,
  type PLStatementSection,
} from '../../src/scenes/MainStreetTurnSummary';
import {
  LEDGER_TOOLTIP_I18N_KEYS,
  buildContextLineTooltip,
  buildExpenseLineTooltip,
  buildIncidentLineTooltip,
  buildIncomeLineTooltip,
  buildNetLineTooltip,
  buildOneOffLineTooltip,
  buildTotalLineTooltip,
} from '../../src/scenes/MainStreetTurnSummaryTooltips';
import { setLocale, registerLocale } from '@core-engine/I18n';

// ── Fixtures ─────────────────────────────────────────────────

function makeBusiness(name: string, ongoingCost: number): BusinessCard {
  return {
    family: 'business',
    id: `biz-${name}`,
    name,
    cost: 0,
    baseIncome: 0,
    synergyTypes: ['Food'],
    maxLevel: 1,
    description: 'Synthetic test business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost,
  } as BusinessCard;
}

function makeCommunitySpace(name: string, ongoingCost: number): CommunitySpaceCard {
  return {
    family: 'community-space',
    id: `cs-${name}`,
    name,
    cost: 0,
    baseIncome: 0,
    ongoingCost,
    synergyTypes: ['Culture'],
    maxLevel: 1,
    description: 'Synthetic test community space',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    reputationPerTurn: 0,
  } as CommunitySpaceCard;
}

function makeStaff(
  name: string,
  ongoingCost: number,
  specializationSkillIds: string[] = [],
  employedAtSlot?: number,
): StaffCard {
  return {
    family: 'staff',
    id: `stf-${name}`,
    name,
    cost: 0,
    ongoingCost,
    handSlotsAdded: 0,
    description: 'Synthetic test staff',
    specializationSkillIds,
    ...(employedAtSlot === undefined ? {} : { employedAtSlot }),
  } as StaffCard;
}

/**
 * A single-player state whose street grid and staff roster match the ledger
 * totals below, so the expense breakdown reconciles exactly:
 *
 *  business: Bakery (10) + Cafe (5) = 15
 *  community: Park (20) = 20
 *  staff: Clerk (100) + Manager (50) = 150
 */
function tooltipState(): MainStreetState {
  const state = setupMainStreetGame({ seed: 'turn-summary-ledger-tooltips', difficulty: 'Easy' });
  state.turn = 4;
  state.players = [];
  state.streetGrid = state.streetGrid.map(() => null);
  state.soldSlots = state.soldSlots.map(() => false);
  state.streetGrid[0] = makeBusiness('Bakery', 10);
  state.streetGrid[1] = makeBusiness('Cafe', 5);
  state.streetGrid[2] = makeCommunitySpace('Park', 20);
  state.staffCards = [makeStaff('Clerk', 100), makeStaff('Manager', 50)];
  state.weekStartCoins = 1000;
  state.weekStartRep = 10;
  state.weekStartScore = 20;
  state.resourceBank.coins = 990;
  state.resourceBank.reputation = 12;
  state.finalScore = 34;
  return state;
}

/** Income detail for Bakery + Cafe, including rep and event deltas. */
function incomeResult(): IncomeResult {
  const breakdown: SlotIncome[] = [
    { slotIndex: 0, businessName: 'Bakery', baseIncome: 50, synergyBonus: 5, total: 55 },
    { slotIndex: 1, businessName: 'Cafe', baseIncome: 30, synergyBonus: 2, total: 32 },
  ];
  const perSlotBreakdown: SlotPhaseBreakdown[] = [
    {
      slotIndex: 0,
      businessName: 'Bakery',
      baseIncome: 50,
      synergyBonus: 5,
      repBonus: 3,
      eventDeltas: [{ cardId: 'evt-flu', name: 'Flu', delta: -2 }],
      upcomingDeltas: [],
    },
    {
      slotIndex: 1,
      businessName: 'Cafe',
      baseIncome: 30,
      synergyBonus: 2,
      repBonus: 1,
      eventDeltas: [],
      upcomingDeltas: [],
    },
  ];
  return {
    total: 80,
    breakdown,
    handSynergyTotal: 0,
    phaseBreakdown: { perSlotBreakdown, handSynergyTotal: 0 },
    coinDelta: 80,
    repDelta: 4,
  };
}

/**
 * A ledger reconciling exactly with the fixture above:
 * income 89 (80 + 7 + 4 − 2) + expenses −185 + incident −20 + one-off −4 = net −120.
 */
function tooltipLedger(): TurnLedger {
  return {
    incomeByPhase: { base: 80, synergy: 7, reputation: 4, events: -2 },
    ongoingCosts: { staff: -150, community: -20, business: -15 },
    incidentCoinChange: -20,
    incidentRepChange: -1,
    oneOffDeltas: { coins: -4, reputation: 0 },
    netCoinChange: -120,
    netRepChange: 1,
    netScoreChange: 14,
    businessesOwned: { '0': 2 },
  };
}

function plInput(
  ledger: TurnLedger | undefined,
  income: IncomeResult | null = incomeResult(),
): Pick<TurnResult, 'turnLedger' | 'incident' | 'income'> {
  return {
    turnLedger: ledger,
    incident: { name: 'Flu Outbreak' } as EventCard,
    income,
  };
}

// ── Bookkeeper-reduced business (MS-0MWEQLYCH006NQ4M) ──────

/**
 * Employs the shipped Bookkeeper card at one street slot via the per-business
 * `employedStaff` source of truth (plus the single-player roster link), so
 * `computeBusinessOngoingCostReductionPct` sees the −20% it tests. The
 * instance carries no salary, so it never adds a staff-wages item to the
 * fixtures below.
 */
function employBookkeeper(state: MainStreetState, slot: number): StaffCard {
  const template = getStaffCardTemplates().find((card) => card.id === 'staff-bookkeeper');
  if (!template) throw new Error('staff-bookkeeper template not found');
  const member = { ...template, id: `${template.id}-${slot}`, ongoingCost: 0 } as StaffCard;
  member.employedAtSlot = slot;
  const business = state.streetGrid[slot]!;
  if (!Array.isArray(business.employedStaff)) business.employedStaff = [];
  business.employedStaff.push(member);
  state.staffCards.push(member);
  return member;
}

/**
 * A `tooltipState()` variant with the Bookkeeper employed at the Bakery
 * (slot 0), reducing that business's ongoing cost by 20%. The engine charges
 * the same reduction (`applyBusinessOngoingCosts` → `effectiveBusinessOngoingCost`
 * → `roundInt(cost × 0.8)`), so the committed business total is −21:
 *
 *  business: Bakery (20 → Bookkeeper −20% ⇒ 16) + Cafe (5) = 21
 *  community: Park (20) = 20
 *  staff: Clerk (100) + Manager (50) = 150
 */
function bookkeeperState(): MainStreetState {
  const state = tooltipState();
  state.streetGrid[0] = makeBusiness('Bakery', 20);
  employBookkeeper(state, 0);
  return state;
}

/**
 * The ledger {@link bookkeeperState} reconciles to exactly: Bakery 16
 * (Bookkeeper-reduced) + Cafe 5 = business −21. No Cost Cutter is employed,
 * so the nominal per-card sum (−25) exceeds the committed −21 by exactly the
 * Bookkeeper reduction (+4) — the residual the tooltip must expose as a named
 * modifier rather than a coin clamp.
 */
function bookkeeperLedger(): TurnLedger {
  return {
    ...tooltipLedger(),
    ongoingCosts: { staff: -150, community: -20, business: -21 },
    // income 89 + expenses −191 + incident −20 + one-off −4 = −126
    netCoinChange: -126,
  };
}

// ── Per-business income breakdown ────────────────────────────

describe('P&L model — per-business income breakdown (MS-0MW7QQ5BX002KGS0)', () => {
  it('base income line lists each business and its base contribution', () => {
    const state = tooltipState();
    const summary = buildTurnSummary(state, plInput(tooltipLedger()));
    expect(summary).not.toBeNull();

    const base = summary!.income.find((line) => line.phase === 'base');
    expect(base?.breakdown?.items).toEqual([
      { name: 'Bakery', coins: 50 },
      { name: 'Cafe', coins: 30 },
    ]);
  });

  it('synergy income line lists each business and its synergy contribution', () => {
    const state = tooltipState();
    const summary = buildTurnSummary(state, plInput(tooltipLedger()));
    const synergy = summary!.income.find((line) => line.phase === 'synergy');
    expect(synergy?.breakdown?.items).toEqual([
      { name: 'Bakery', coins: 5 },
      { name: 'Cafe', coins: 2 },
    ]);
  });

  it('reputation income line derives each business’s rep bonus', () => {
    const state = tooltipState();
    const summary = buildTurnSummary(state, plInput(tooltipLedger()));
    const rep = summary!.income.find((line) => line.phase === 'reputation');
    expect(rep?.breakdown?.items).toEqual([
      { name: 'Bakery', coins: 3 },
      { name: 'Cafe', coins: 1 },
    ]);
  });

  it('event income line sums each business’s event deltas', () => {
    const state = tooltipState();
    const summary = buildTurnSummary(state, plInput(tooltipLedger()));
    const events = summary!.income.find((line) => line.phase === 'events');
    // Only the Bakery has an event delta (-2); zero-item businesses are dropped.
    // The effect is enumerated by name with its signed delta
    // (MS-0MWC90RB7004BC4E), not only summed per business.
    expect(events?.breakdown?.items).toEqual([
      { name: 'Bakery', coins: -2, effects: [{ name: 'Flu', delta: -2 }] },
    ]);
  });

  it('omitting the income result leaves a statement with no income breakdowns (absent-safe)', () => {
    const state = tooltipState();
    const summary = buildTurnSummary(state, {
      turnLedger: tooltipLedger(),
      incident: { name: 'Flu Outbreak' } as EventCard,
    });
    expect(summary).not.toBeNull();
    expect(summary!.income.every((line) => line.breakdown === undefined)).toBe(true);
    // The committed coin totals are unchanged by the missing detail.
    expect(summary!.income.map((line) => line.coins)).toEqual([80, 7, 4, -2]);
  });
});

// ── Per-card expense breakdowns ──────────────────────────────

describe('P&L model — per-card expense breakdowns (MS-0MW7QQ5BX002KGS0)', () => {
  it('staff costs line lists each staff card’s charge', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const staff = projection!.expenses.lines.find((line) => line.key === 'staff');
    expect(staff?.breakdown?.items).toEqual([
      { name: 'Clerk', coins: -100, base: -100, modifiers: [] },
      { name: 'Manager', coins: -50, base: -50, modifiers: [] },
    ]);
  });

  it('community costs line lists each community space’s charge', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const community = projection!.expenses.lines.find((line) => line.key === 'community');
    expect(community?.breakdown?.items).toEqual([{ name: 'Park', coins: -20, base: -20 }]);
  });

  it('business costs line lists each business card’s running cost', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const business = projection!.expenses.lines.find((line) => line.key === 'business');
    expect(business?.breakdown?.items).toEqual([
      { name: 'Bakery', coins: -10, base: -10 },
      { name: 'Cafe', coins: -5, base: -5 },
    ]);
  });

  it('sold cards are excluded from the expense breakdown', () => {
    const state = tooltipState();
    state.soldSlots[2] = true; // the Park was sold
    const projection = buildPLProjection(state, plInput(tooltipLedger()));
    const community = projection!.expenses.lines.find((line) => line.key === 'community');
    expect(community?.breakdown).toBeUndefined();
  });

  it('a state with no placed cards yields no expense breakdowns', () => {
    const state = tooltipState();
    state.streetGrid = state.streetGrid.map(() => null);
    state.staffCards = [];
    const projection = buildPLProjection(state, plInput(tooltipLedger()));
    expect(projection!.expenses.lines.every((line) => line.breakdown === undefined)).toBe(true);
  });

  it('deriving the breakdown does not mutate the state', () => {
    const state = tooltipState();
    const before = JSON.stringify(state.streetGrid) + JSON.stringify(state.staffCards);
    buildPLProjection(state, plInput(tooltipLedger()));
    const after = JSON.stringify(state.streetGrid) + JSON.stringify(state.staffCards);
    expect(after).toBe(before);
  });
});

// ── Tooltip content ──────────────────────────────────────────

describe('ledger tooltip content (MS-0MW7QQ5BX002KGS0)', () => {
  it('the business-income tooltip names each business and its contribution', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const base = projection!.income.lines.find((line) => line.key === 'base')!;
    const tooltip = buildIncomeLineTooltip(base);
    expect(tooltip).toContain('Bakery: +50');
    expect(tooltip).toContain('Cafe: +30');
  });

  it('the staff-costs tooltip names each staff card and its cost', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const staff = projection!.expenses.lines.find((line) => line.key === 'staff')!;
    const tooltip = buildExpenseLineTooltip(staff);
    expect(tooltip).toContain('Clerk: -100');
    expect(tooltip).toContain('Manager: -50');
    // Per-item sum equals the committed total (no reduction/clamp in this fixture).
    expect(tooltip).toContain('Total: -150');
    expect(tooltip).not.toContain('Street-wide reduction');
  });

  it('the community-costs tooltip names each space and its cost', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const community = projection!.expenses.lines.find((line) => line.key === 'community')!;
    expect(buildExpenseLineTooltip(community)).toContain('Park: -20');
  });

  it('the business-costs tooltip names each business and its running cost', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const business = projection!.expenses.lines.find((line) => line.key === 'business')!;
    const tooltip = buildExpenseLineTooltip(business);
    expect(tooltip).toContain('Bakery: -10');
    expect(tooltip).toContain('Cafe: -5');
  });

  it('the expense tooltip reconciles a street-wide reduction to the committed total', () => {
    // Base per-item sum is -150; the ledger commits -120, i.e. a +30 reduction.
    const line = {
      key: 'staff',
      label: 'Staff wages',
      coins: -120,
      breakdown: {
        items: [{ name: 'Clerk', coins: -100 }, { name: 'Manager', coins: -50 }],
        streetReduction: 30,
      },
    };
    const tooltip = buildExpenseLineTooltip(line);
    expect(tooltip).toContain('Street-wide reduction: +30');
    expect(tooltip).not.toContain('Limited by available coins');
    expect(tooltip).toContain('Total: -120');
  });

  it('the expense tooltip reconciles a coins-clamp to the committed total', () => {
    // Base per-item sum is -150; the ledger commits -80, i.e. a +70 shortfall
    // (no street reduction applies in this line).
    const line = {
      key: 'staff',
      label: 'Staff wages',
      coins: -80,
      breakdown: { items: [{ name: 'Clerk', coins: -100 }, { name: 'Manager', coins: -50 }] },
    };
    const tooltip = buildExpenseLineTooltip(line);
    expect(tooltip).toContain('Limited by available coins: +70');
    expect(tooltip).toContain('Total: -80');
  });

  it('the incident tooltip shows the incident name and its coin/reputation effect', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const tooltip = buildIncidentLineTooltip(projection!.incident, 'Flu Outbreak');
    expect(tooltip).toContain('Flu Outbreak');
    expect(tooltip).toContain('Coins -20');
    expect(tooltip).toContain('Rep -1');
  });

  it('the incident tooltip explains when no incident was resolved', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const tooltip = buildIncidentLineTooltip(projection!.incident, null);
    expect(tooltip.toLowerCase()).toContain('no incident');
  });

  it('the one-off tooltip presents the reconciliation formula (documented fallback)', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const tooltip = buildOneOffLineTooltip(projection!);
    expect(tooltip).toContain('One-off =');
    // net -120 - income 89 - expenses -185 - incident -20 = -4
    expect(tooltip).toContain('= -4');
  });

  it('the net tooltip presents income + expenses + incident + one-off = net', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const tooltip = buildNetLineTooltip(projection!);
    expect(tooltip).toContain('Net =');
    expect(tooltip).toContain('income (+89)');
    expect(tooltip).toContain('expenses (-185)');
    expect(tooltip).toContain('incident (-20)');
    expect(tooltip).toContain('one-off (-4)');
    expect(tooltip).toContain('= -120');
  });

  it('supplementary context rows carry explanatory tooltips', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const keys = ['reputationChange', 'scoreChange', 'closingCoins', 'businessesOwned'] as const;
    for (const key of keys) {
      const tooltip = buildContextLineTooltip(key, projection!.context);
      expect(tooltip.length).toBeGreaterThan(0);
      expect(tooltip).not.toBe(key);
    }
  });
});

// ── Localisation ─────────────────────────────────────────────

describe('ledger tooltip localisation (MS-0MW7QQ5BX002KGS0)', () => {
  afterEach(() => {
    setLocale('en');
  });

  it('English defaults are registered at module load', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const tooltip = buildNetLineTooltip(projection!);
    // The default English copy is resolved (not the raw key).
    expect(tooltip).not.toContain(LEDGER_TOOLTIP_I18N_KEYS.netTitle);
    expect(tooltip).toContain('Net = income');
  });

  it('a registered locale overrides the English copy', () => {
    registerLocale('xx-test', {
      [LEDGER_TOOLTIP_I18N_KEYS.netTitle]: 'Nettoverlust',
      [LEDGER_TOOLTIP_I18N_KEYS.netFormula]:
        'Netto = Einnahmen ({income}) + Ausgaben ({expenses}) + Vorfall ({incident}) + Einmalig ({oneOff}) = {net}',
    });
    setLocale('xx-test');
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const tooltip = buildNetLineTooltip(projection!);
    expect(tooltip).toContain('Nettoverlust');
    expect(tooltip).toContain('Netto = Einnahmen');
  });
});

// ── One-off per-source attribution (MS-0MWBZDNH3006DXV7) ─────

describe('one-off per-source attribution tooltips (MS-0MWBZDNH3006DXV7)', () => {
  /** A ledger whose one-off residual (-4) is explained by the given sources. */
  const attributedLedger = (breakdown: TurnLedger['oneOffBreakdown']): TurnLedger => ({
    ...tooltipLedger(),
    oneOffBreakdown: breakdown,
  });

  it('lists each source with its signed amount and keeps the formula as a checksum', () => {
    const projection = buildPLProjection(
      tooltipState(),
      plInput(attributedLedger([
        { label: 'market-purchase', coins: -124, reputation: 0 },
        { label: 'market-sale', coins: 120, reputation: 0 },
      ])),
    )!;
    const tooltip = buildOneOffLineTooltip(projection);
    expect(tooltip).toContain('Market purchase: -124');
    expect(tooltip).toContain('Market sale: +120');
    // The reconciliation formula remains as the closing checksum line.
    expect(tooltip).toContain('One-off =');
    expect(tooltip).toContain('= -4');
    expect(tooltip.indexOf('Market purchase')).toBeLessThan(tooltip.indexOf('One-off ='));
  });

  it('renders reputation alongside coins for rep-bearing sources', () => {
    const projection = buildPLProjection(
      tooltipState(),
      plInput(attributedLedger([
        { label: 'community-favour', coins: -200, reputation: 1 },
        { label: 'event-play', coins: 196, reputation: 15 },
      ])),
    )!;
    const tooltip = buildOneOffLineTooltip(projection);
    expect(tooltip).toContain('Community Favour: Coins -200, Rep +1');
    expect(tooltip).toContain('Event play: Coins +196, Rep +15');
  });

  it('localises the source labels through the i18n system', () => {
    const previous = 'en';
    registerLocale('xx-oneoff', {
      [LEDGER_TOOLTIP_I18N_KEYS.oneOffSourcePurchase]: 'Einkauf',
      [LEDGER_TOOLTIP_I18N_KEYS.oneOffSourceSale]: 'Verkauf',
      [LEDGER_TOOLTIP_I18N_KEYS.oneOffTitle]: 'Einmalig',
    });
    setLocale('xx-oneoff');
    try {
      const projection = buildPLProjection(
        tooltipState(),
        plInput(attributedLedger([
          { label: 'market-purchase', coins: -124, reputation: 0 },
          { label: 'market-sale', coins: 120, reputation: 0 },
        ])),
      )!;
      const tooltip = buildOneOffLineTooltip(projection);
      expect(tooltip).toContain('Einmalig');
      expect(tooltip).toContain('Einkauf: -124');
      expect(tooltip).toContain('Verkauf: +120');
      expect(tooltip).not.toContain('Market purchase');
    } finally {
      setLocale(previous);
    }
  });

  it('renders unknown source labels verbatim (hand-built entries stay visible)', () => {
    const projection = buildPLProjection(
      tooltipState(),
      plInput(attributedLedger([{ label: 'custom-source', coins: -4, reputation: 0 }])),
    )!;
    const tooltip = buildOneOffLineTooltip(projection);
    expect(tooltip).toContain('custom-source: -4');
  });

  it('keeps the formula-only fallback when no breakdown is carried (absent-safe)', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()))!;
    const tooltip = buildOneOffLineTooltip(projection);
    expect(tooltip).toContain('One-off =');
    expect(tooltip).not.toContain('Market purchase');
  });
});

// ── Competitive per-seat parity ──────────────────────────────

/** A two-seat competitive state. */
function twoSeatState(): MainStreetState {
  return createCompetitiveState({
    seed: 'turn-summary-ledger-tooltips-cmp',
    playerCount: 2,
    difficulty: 'Easy',
    loansEnabled: false,
  });
}

/** A two-seat round ledger whose seats each reconcile exactly. */
function competitiveLedger(): CompetitiveRoundLedger {
  const seat = (ownerId: number, base: number, net: number) => ({
    ownerId,
    businessesOwned: ownerId + 1,
    incomeByPhase: { base, synergy: 0, reputation: 0, events: 0 },
    incomeTotal: base,
    ongoingCosts: { staff: 0, community: 0, business: 0 },
    dayStart: { coins: 10, reputation: 0, score: 0 },
    closing: { coins: 10 + net, reputation: 0, score: 0 },
    netCoinChange: net,
    netRepChange: 0,
    netScoreChange: 0,
    incidentCoinChange: 0,
    incidentRepChange: 0,
    oneOffDeltas: { coins: 0, reputation: 0 },
  });
  return { turn: 7, seats: [seat(0, 10, 10), seat(1, 20, 20)] };
}

/** A per-seat income result naming that seat's business. */
function seatIncome(ownerId: number, businessName: string, base: number): {
  ownerId: number;
  income: IncomeResult;
} {
  return {
    ownerId,
    income: {
      total: base,
      breakdown: [{ slotIndex: 0, businessName, baseIncome: base, synergyBonus: 0, total: base }],
      handSynergyTotal: 0,
      phaseBreakdown: {
        perSlotBreakdown: [{
          slotIndex: 0, businessName, baseIncome: base, synergyBonus: 0,
          repBonus: 0, eventDeltas: [], upcomingDeltas: [],
        }],
        handSynergyTotal: 0,
      },
    },
  };
}

/**
 * A two-seat competitive state whose human seat (0) owns the Bookkeeper-
 * reduced Bakery at slot 0 — the state the owner-filtered expense derivation
 * (MS-0MWEGDNAD009QDRO) reads to produce the seat's per-business items.
 */
function bookkeeperCompetitiveState(): MainStreetState {
  const state = twoSeatState();
  state.streetGrid = state.streetGrid.map(() => null);
  state.soldSlots = state.soldSlots.map(() => false);
  const bakery = makeBusiness('Bakery', 20);
  state.streetGrid[0] = bakery;
  state.ownerTaggedGrid![0] = { card: bakery, ownerId: 0 };
  employBookkeeper(state, 0);
  return state;
}

/**
 * The competitive round ledger for {@link bookkeeperCompetitiveState}: seat 0
 * commits business −16 (Bakery 20 − 20% Bookkeeper) against income +10, so
 * the seat's net change is −6 and its closing balance 4.
 */
function bookkeeperCompetitiveLedger(): CompetitiveRoundLedger {
  const ledger = competitiveLedger();
  ledger.seats[0] = {
    ...ledger.seats[0],
    incomeByPhase: { base: 10, synergy: 0, reputation: 0, events: 0 },
    incomeTotal: 10,
    ongoingCosts: { staff: 0, community: 0, business: -16 },
    netCoinChange: -6,
    closing: { coins: 4, reputation: 0, score: 0 },
  };
  return ledger;
}

describe('competitive per-seat tooltip parity (MS-0MW7QQ65P006N3KA)', () => {
  it('each seat’s income lines carry that seat’s own breakdown', () => {
    const state = twoSeatState();
    const summary = buildCompetitiveTurnSummary(state, {
      playerRoundLedger: competitiveLedger(),
      playerIncome: [
        seatIncome(0, 'Human Bakery', 10),
        seatIncome(1, 'AI Cafe', 20),
      ],
    });
    expect(summary).not.toBeNull();

    const human = summary!.rows.find((row) => row.ownerId === 0)!;
    expect(human.income.find((line) => line.phase === 'base')?.breakdown?.items).toEqual([
      { name: 'Human Bakery', coins: 10 },
    ]);

    const ai = summary!.rows.find((row) => row.ownerId === 1)!;
    expect(ai.income.find((line) => line.phase === 'base')?.breakdown?.items).toEqual([
      { name: 'AI Cafe', coins: 20 },
    ]);
  });

  it('switching tabs switches the tooltip content to the selected seat', () => {
    const state = twoSeatState();
    const summary = buildCompetitiveTurnSummary(state, {
      playerRoundLedger: competitiveLedger(),
      playerIncome: [
        seatIncome(0, 'Human Bakery', 10),
        seatIncome(1, 'AI Cafe', 20),
      ],
    });
    const humanBase = buildPLFromCompetitiveRow(summary!.rows[0])
      .income.lines.find((line) => line.key === 'base')!;
    const aiBase = buildPLFromCompetitiveRow(summary!.rows[1])
      .income.lines.find((line) => line.key === 'base')!;
    expect(buildIncomeLineTooltip(humanBase)).toContain('Human Bakery: +10');
    expect(buildIncomeLineTooltip(aiBase)).toContain('AI Cafe: +20');
  });

  it('a seat ledger with no per-item income degrades to the category total', () => {
    const state = twoSeatState();
    const summary = buildCompetitiveTurnSummary(state, {
      playerRoundLedger: competitiveLedger(),
    });
    expect(summary).not.toBeNull();
    const human = summary!.rows.find((row) => row.ownerId === 0)!;
    const base = buildPLFromCompetitiveRow(human).income.lines.find((line) => line.key === 'base')!;
    expect(base.breakdown).toBeUndefined();
    const tooltip = buildIncomeLineTooltip(base);
    // The committed total is still shown, with an explanatory note.
    expect(tooltip).toContain('Base income: +10');
    expect(tooltip).not.toContain('Per business');
  });

  it('a seat’s one-off row carries its own per-source attribution (competitive parity)', () => {
    const ledger = competitiveLedger();
    // Seat 0's residual (net 10 − income 10 = 0) is explained by a purchase
    // and a sale that net to zero; seat 1 keeps no breakdown (absent-safe).
    ledger.seats[0].oneOffBreakdown = [
      { label: 'market-purchase', coins: -120, reputation: 0 },
      { label: 'market-sale', coins: 120, reputation: 0 },
    ];
    const state = twoSeatState();
    const summary = buildCompetitiveTurnSummary(state, { playerRoundLedger: ledger })!;
    const human = summary.rows.find((row) => row.ownerId === 0)!;

    const projection = buildPLFromCompetitiveRow(human);
    expect(projection.oneOff.breakdown).toEqual([
      { label: 'market-purchase', coins: -120, reputation: 0 },
      { label: 'market-sale', coins: 120, reputation: 0 },
    ]);
    const tooltip = buildOneOffLineTooltip(projection);
    expect(tooltip).toContain('Market purchase: -120');
    expect(tooltip).toContain('Market sale: +120');
    // The checksum line reconciles to this seat's committed residual.
    expect(tooltip).toContain('= 0');

    // Seat 1 carries no breakdown → the formula-only fallback.
    const ai = summary.rows.find((row) => row.ownerId === 1)!;
    const aiTooltip = buildOneOffLineTooltip(buildPLFromCompetitiveRow(ai));
    expect(aiTooltip).not.toContain('Market purchase');
    expect(aiTooltip).toContain('One-off =');
  });
});

// ── Competitive per-card expense breakdowns (MS-0MWEGDMVZ005DQ32) ──────────
//
// The parent epic **MS-0MWBZDVCH008P8X5** ("Per-card expense breakdowns on
// competitive Turn Summary seats") contract, green end-to-end: the
// owner-filtered derivation child (MS-0MWEGDNAD009QDRO) supplies per-card
// detail via `expenseLineBreakdownForOwner`, and this child
// (MS-0MWEGDNP300007WC) threads it into the competitive expense rows
// (`buildExpenseRows(seat.ongoingCosts, state, seat.ownerId)`), so each seat's
// rows carry its own staff, community-space and business cards. The cases
// below were authored red-phase with `it.fails` (the repo's test-first
// convention — see `competitive-per-seat-hand-capacity.test.ts`) and are now
// plain `it` since the threading landed. This block replaces the previous
// "competitive expense lines stay category-total only" assertion (parent AC5).
// Guards that already hold today — the fixture-ledger reconciliation and the
// absent-safe degradation of a legacy ledger — stay plain `it` so they keep
// protecting the contract.

/**
 * A two-seat competitive state whose per-seat staff and owner-tagged street
 * slots reconcile exactly with the engine's own `applyCompetitiveOngoingCosts`:
 *
 *  seat 0  staff: Pat the Manager (100, Operations Manager ⇒ −50),
 *                 Sam the Clerk (30)                     ⇒ −80
 *          community: Human Park (20)                     ⇒ −20
 *          business:  Human Bakery (10) + Human Cafe (5)  ⇒ −15
 *  seat 1  staff: Moe the Manager (90, Operations Manager ⇒ −40),
 *                 Ann the Accountant (30)                 ⇒ −70
 *          community: AI Museum (8)                       ⇒ −8
 *          business:  AI Arcade (15) + AI Gym (12)        ⇒ −27
 *
 * Sold slot 3 (Sold Emporium, cost 999) never incurs a running cost. No Cost
 * Cutter is employed, so no street-wide reduction or coins-clamp applies and
 * every item's charge sums exactly to its committed category total.
 *
 * @param hostStaff The shared (host) staff roster; drives the community /
 *                  business street-wide Cost Cutter reduction via
 *                  `getEmployedSpecializationSkills` (default: none).
 */
function competitiveExpenseState(hostStaff: StaffCard[] = []): MainStreetState {
  const state = createCompetitiveState({
    seed: 'turn-summary-competitive-expense-breakdowns',
    playerCount: 2,
    difficulty: 'Easy',
    loansEnabled: false,
  });
  // Competitive staff live per-seat (`players[i].staffCards`); the shared
  // roster only drives the host community/business reduction.
  state.staffCards = hostStaff;
  state.streetGrid = state.streetGrid.map(() => null);
  state.soldSlots = state.soldSlots.map(() => false);
  state.ownerTaggedGrid = state.ownerTaggedGrid!.map(() => ({ card: null, ownerId: null }));
  // Plenty of coins so `applyCompetitiveOngoingCosts` never clamps.
  state.players!.forEach((seat) => { seat.coins = 1000; });

  const place = (slotIndex: number, card: BusinessCard | CommunitySpaceCard, ownerId: number) => {
    state.streetGrid[slotIndex] = card;
    state.ownerTaggedGrid![slotIndex] = { card, ownerId };
  };
  place(0, makeBusiness('Human Bakery', 10), 0);
  place(1, makeCommunitySpace('Human Park', 20), 0);
  place(3, makeBusiness('Sold Emporium', 999), 0);
  state.soldSlots[3] = true;
  place(5, makeBusiness('Human Cafe', 5), 0);
  place(6, makeBusiness('AI Arcade', 15), 1);
  place(7, makeCommunitySpace('AI Museum', 8), 1);
  place(8, makeBusiness('AI Gym', 12), 1);

  state.players![0].staffCards = [
    makeStaff('Pat the Manager', 100, ['skill-operations-manager'], 0),
    makeStaff('Sam the Clerk', 30),
  ];
  state.players![1].staffCards = [
    makeStaff('Moe the Manager', 90, ['skill-operations-manager'], 8),
    makeStaff('Ann the Accountant', 30),
  ];
  return state;
}

/**
 * The committed round ledger for {@link competitiveExpenseState}, built from
 * the engine's own `applyCompetitiveOngoingCosts` so every seat's committed
 * category totals reconcile exactly with the fixture's staff and street grid.
 * The engine also deducts each seat's wallet in place (post-closing state).
 */
function competitiveExpenseLedger(state: MainStreetState): CompetitiveRoundLedger {
  const costs = applyCompetitiveOngoingCosts(state);
  const seat = (ownerId: number): OwnerRoundLedger => {
    const ongoing = costs.get(ownerId)!;
    const net = 10 + ongoing.staff + ongoing.community + ongoing.business;
    return {
      ownerId,
      // Two standing businesses per seat (sold slots excluded).
      businessesOwned: 2,
      incomeByPhase: { base: 10, synergy: 0, reputation: 0, events: 0 },
      incomeTotal: 10,
      ongoingCosts: { ...ongoing },
      dayStart: { coins: 1000, reputation: 0, score: 0 },
      closing: { coins: 1000 + net, reputation: 0, score: 0 },
      netCoinChange: net,
      netRepChange: 0,
      netScoreChange: 0,
      incidentCoinChange: 0,
      incidentRepChange: 0,
      oneOffDeltas: { coins: 0, reputation: 0 },
    };
  };
  return { turn: 7, seats: [seat(0), seat(1)] };
}

/** The base two-seat expense fixture (no reductions, no clamp). */
function competitiveExpenseFixture(): { state: MainStreetState; ledger: CompetitiveRoundLedger } {
  const state = competitiveExpenseState();
  const ledger = competitiveExpenseLedger(state);
  return { state, ledger };
}

/**
 * {@link competitiveExpenseState} extended with Cost Cutter staff so the
 * street-wide reduction (and later clamp) reconciliation lines apply:
 *
 *  - seat 0 employs Courtney the Cutter (management-company cost-cutter, zero
 *    salary ⇒ never listed): owner-scoped staff reduction 15%
 *    (`roundInt(80 × 0.85) = 68` ⇒ committed staff −68, reduction +12);
 *  - the host roster gains a Cost Cutter: community/business reduction 15%
 *    (Park 20 ⇒ −17/+3; Bakery 10 + Cafe 5 ⇒ −13/+2);
 *  - seat 1's staff carry no management-company skill ⇒ **no** staff reduction
 *    (the host Cost Cutter never reduces staff — owner scope only), while its
 *    community/business DO reduce (Museum 8 ⇒ −7/+1; Arcade 15 + Gym 12
 *    ⇒ −23/+4).
 */
function competitiveReductionFixture(): { state: MainStreetState; ledger: CompetitiveRoundLedger } {
  const state = competitiveExpenseState([
    makeStaff('Host Cutter', 0, ['skill-cost-cutter']),
  ]);
  state.players![0].staffCards.push(makeStaff('Courtney the Cutter', 0, ['skill-cost-cutter']));
  const ledger = competitiveExpenseLedger(state);
  return { state, ledger };
}

/** The same seat shape with NO derivable per-card detail (empty roster/grid). */
function competitiveAbsentSafeFixture(): { state: MainStreetState; ledger: CompetitiveRoundLedger } {
  const state = competitiveExpenseState();
  state.streetGrid = state.streetGrid.map(() => null);
  state.ownerTaggedGrid = state.ownerTaggedGrid!.map(() => ({ card: null, ownerId: null }));
  state.players!.forEach((seat) => { seat.staffCards = []; });
  // A legacy/hand-built ledger predates per-card detail yet still commits
  // category totals that must render (absent-safe degradation).
  const ledger: CompetitiveRoundLedger = {
    turn: 7,
    seats: [
      {
        ownerId: 0, businessesOwned: 0,
        incomeByPhase: { base: 10, synergy: 0, reputation: 0, events: 0 }, incomeTotal: 10,
        ongoingCosts: { staff: -100, community: -20, business: -15 },
        dayStart: { coins: 1000, reputation: 0, score: 0 },
        closing: { coins: 875, reputation: 0, score: 0 },
        netCoinChange: -125, netRepChange: 0, netScoreChange: 0,
        incidentCoinChange: 0, incidentRepChange: 0,
        oneOffDeltas: { coins: 0, reputation: 0 },
      },
      {
        ownerId: 1, businessesOwned: 0,
        incomeByPhase: { base: 10, synergy: 0, reputation: 0, events: 0 }, incomeTotal: 10,
        ongoingCosts: { staff: -80, community: -5, business: -10 },
        dayStart: { coins: 1000, reputation: 0, score: 0 },
        closing: { coins: 915, reputation: 0, score: 0 },
        netCoinChange: -85, netRepChange: 0, netScoreChange: 0,
        incidentCoinChange: 0, incidentRepChange: 0,
        oneOffDeltas: { coins: 0, reputation: 0 },
      },
    ],
  };
  return { state, ledger };
}

/** Renders a seat's expense tooltip for one category through the PL projection. */
function competitiveExpenseTooltip(
  summary: NonNullable<ReturnType<typeof buildCompetitiveTurnSummary>>,
  ownerId: number,
  category: 'staff' | 'community' | 'business',
): string {
  const row = summary.rows.find((candidate) => candidate.ownerId === ownerId)!;
  const line = buildPLFromCompetitiveRow(row).expenses.lines
    .find((candidate) => candidate.key === category)!;
  return buildExpenseLineTooltip(line);
}

describe('competitive per-card expense breakdowns (MS-0MWEGDMVZ005DQ32)', () => {
  // The fixture-level guards below hold today: they pin the committed totals
  // the engine derives from the fixture, so the `it.fails` tracers below
  // assert against numbers verified to match `applyCompetitiveOngoingCosts`.

  it('the fixture ledger reconciles with the engine’s own attribution', () => {
    const { ledger } = competitiveExpenseFixture();
    expect(ledger.seats[0].ongoingCosts).toEqual({ staff: -80, community: -20, business: -15 });
    expect(ledger.seats[1].ongoingCosts).toEqual({ staff: -70, community: -8, business: -27 });
  });

  it('the reduction fixture ledger reconciles with the engine’s attribution', () => {
    const { ledger } = competitiveReductionFixture();
    // Seat 0's staff reduce via its own Cost Cutter (80 ⇒ 68); both seats'
    // community/business reduce via the host Cost Cutter.
    expect(ledger.seats[0].ongoingCosts).toEqual({ staff: -68, community: -17, business: -13 });
    expect(ledger.seats[1].ongoingCosts).toEqual({ staff: -70, community: -7, business: -23 });
  });

  // ── Model: per-seat per-card derivation ──

  it('lists each seat’s own staff cards with base salary and named modifiers', () => {
    const { state, ledger } = competitiveExpenseFixture();
    const summary = buildCompetitiveTurnSummary(state, { playerRoundLedger: ledger })!;
    const staff = (ownerId: number) =>
      summary.rows.find((row) => row.ownerId === ownerId)!.expenses
        .find((line) => line.category === 'staff')!;

    expect(staff(0).breakdown).toEqual({
      items: [
        { name: 'Pat the Manager', coins: -50, base: -100, modifiers: [{ name: 'Operations Manager', coins: 50 }] },
        { name: 'Sam the Clerk', coins: -30, base: -30, modifiers: [] },
      ],
    });
    expect(staff(1).breakdown).toEqual({
      items: [
        { name: 'Moe the Manager', coins: -40, base: -90, modifiers: [{ name: 'Operations Manager', coins: 50 }] },
        { name: 'Ann the Accountant', coins: -30, base: -30, modifiers: [] },
      ],
    });
  });

  it('lists each seat’s owned community spaces and businesses with base ongoing costs', () => {
    const { state, ledger } = competitiveExpenseFixture();
    const summary = buildCompetitiveTurnSummary(state, { playerRoundLedger: ledger })!;
    const expenses = (ownerId: number) =>
      summary.rows.find((row) => row.ownerId === ownerId)!.expenses;

    expect(expenses(0).find((line) => line.category === 'community')!.breakdown).toEqual({
      items: [{ name: 'Human Park', coins: -20, base: -20 }],
    });
    expect(expenses(0).find((line) => line.category === 'business')!.breakdown).toEqual({
      items: [
        { name: 'Human Bakery', coins: -10, base: -10 },
        { name: 'Human Cafe', coins: -5, base: -5 },
      ],
    });
    expect(expenses(1).find((line) => line.category === 'community')!.breakdown).toEqual({
      items: [{ name: 'AI Museum', coins: -8, base: -8 }],
    });
    expect(expenses(1).find((line) => line.category === 'business')!.breakdown).toEqual({
      items: [
        { name: 'AI Arcade', coins: -15, base: -15 },
        { name: 'AI Gym', coins: -12, base: -12 },
      ],
    });
  });

  it('never lists another seat’s staff, spaces or businesses (no cross-seat leakage)', () => {
    const { state, ledger } = competitiveExpenseFixture();
    const summary = buildCompetitiveTurnSummary(state, { playerRoundLedger: ledger })!;
    const names = (ownerId: number) =>
      summary.rows
        .find((row) => row.ownerId === ownerId)!
        .expenses.flatMap((line) => line.breakdown?.items.map((item) => item.name) ?? []);

    const seat0 = names(0);
    const seat1 = names(1);
    expect(seat0).toEqual(['Pat the Manager', 'Sam the Clerk', 'Human Park', 'Human Bakery', 'Human Cafe']);
    expect(seat1).toEqual(['Moe the Manager', 'Ann the Accountant', 'AI Museum', 'AI Arcade', 'AI Gym']);
    expect(seat0).not.toContain('Moe the Manager');
    expect(seat0).not.toContain('AI Museum');
    expect(seat1).not.toContain('Pat the Manager');
    expect(seat1).not.toContain('Human Bakery');
    // Sold slots incur no running cost and never appear in a breakdown.
    expect([...seat0, ...seat1]).not.toContain('Sold Emporium');
  });

  it('threads each seat’s expense breakdown through the PL projection', () => {
    const { state, ledger } = competitiveExpenseFixture();
    const summary = buildCompetitiveTurnSummary(state, { playerRoundLedger: ledger })!;
    const projection = buildPLFromCompetitiveRow(summary.rows.find((row) => row.ownerId === 0)!);
    expect(projection.expenses.lines.find((line) => line.key === 'staff')!.breakdown).toEqual({
      items: [
        { name: 'Pat the Manager', coins: -50, base: -100, modifiers: [{ name: 'Operations Manager', coins: 50 }] },
        { name: 'Sam the Clerk', coins: -30, base: -30, modifiers: [] },
      ],
    });
    expect(projection.expenses.lines.find((line) => line.key === 'community')!.breakdown).toEqual({
      items: [{ name: 'Human Park', coins: -20, base: -20 }],
    });
    expect(projection.expenses.lines.find((line) => line.key === 'business')!.breakdown).toEqual({
      items: [
        { name: 'Human Bakery', coins: -10, base: -10 },
        { name: 'Human Cafe', coins: -5, base: -5 },
      ],
    });
  });

  // ── Tooltip: rendered per-card text ──

  it('renders the per-card detail in the expense tooltip, one card per line', () => {
    const { state, ledger } = competitiveExpenseFixture();
    const summary = buildCompetitiveTurnSummary(state, { playerRoundLedger: ledger })!;
    expect(competitiveExpenseTooltip(summary, 0, 'staff')).toBe(
      'Staff wages: -80\n'
      + 'Pat the Manager: -50\n'
      + '  Base: -100\n'
      + '  Operations Manager: +50\n'
      + 'Sam the Clerk: -30\n'
      + 'Total: -80',
    );
    expect(competitiveExpenseTooltip(summary, 0, 'community')).toBe(
      'Community spaces: -20\nHuman Park: -20\nTotal: -20',
    );
    expect(competitiveExpenseTooltip(summary, 0, 'business')).toBe(
      'Business costs: -15\nHuman Bakery: -10\nHuman Cafe: -5\nTotal: -15',
    );
    expect(competitiveExpenseTooltip(summary, 1, 'staff')).toBe(
      'Staff wages: -70\n'
      + 'Moe the Manager: -40\n'
      + '  Base: -90\n'
      + '  Operations Manager: +50\n'
      + 'Ann the Accountant: -30\n'
      + 'Total: -70',
    );
  });

  // ── Reconciliation: Cost Cutter reduction and coins clamp ──

  it('reconciles the breakdowns through the Cost Cutter reduction lines', () => {
    const { state, ledger } = competitiveReductionFixture();
    const summary = buildCompetitiveTurnSummary(state, { playerRoundLedger: ledger })!;

    // Staff: the owner-scoped reduction (seat 0's own Courtney the Cutter).
    expect(competitiveExpenseTooltip(summary, 0, 'staff')).toBe(
      'Staff wages: -68\n'
      + 'Pat the Manager: -50\n'
      + '  Base: -100\n'
      + '  Operations Manager: +50\n'
      + 'Sam the Clerk: -30\n'
      + 'Street-wide reduction: +12\n'
      + 'Total: -68',
    );
    // Community/business: the host-scoped reduction.
    expect(competitiveExpenseTooltip(summary, 0, 'community')).toBe(
      'Community spaces: -17\nHuman Park: -20\nStreet-wide reduction: +3\nTotal: -17',
    );
    expect(competitiveExpenseTooltip(summary, 0, 'business')).toBe(
      'Business costs: -13\nHuman Bakery: -10\nHuman Cafe: -5\nStreet-wide reduction: +2\nTotal: -13',
    );
    // Seat 1's staff carry no management-company skill: the host Cost Cutter
    // reduces community/business but NEVER staff (owner scope only).
    expect(competitiveExpenseTooltip(summary, 1, 'staff')).toBe(
      'Staff wages: -70\n'
      + 'Moe the Manager: -40\n'
      + '  Base: -90\n'
      + '  Operations Manager: +50\n'
      + 'Ann the Accountant: -30\n'
      + 'Total: -70',
    );
    expect(competitiveExpenseTooltip(summary, 1, 'community')).toBe(
      'Community spaces: -7\nAI Museum: -8\nStreet-wide reduction: +1\nTotal: -7',
    );
    expect(competitiveExpenseTooltip(summary, 1, 'business')).toBe(
      'Business costs: -23\nAI Arcade: -15\nAI Gym: -12\nStreet-wide reduction: +4\nTotal: -23',
    );
  });

  it('renders the coins-clamp line when the committed total sits below the reduced cost', () => {
    const { state, ledger } = competitiveReductionFixture();
    // The engine clamps each family to the coins available: a seat with only
    // −40 coins available for staff is charged 40 despite owing the reduced 68,
    // and the tooltip reconciles the derivable −80/+12 to that committed −40.
    ledger.seats[0].ongoingCosts!.staff = -40;
    ledger.seats[0].netCoinChange = 10 - 40 - 17 - 13;
    ledger.seats[0].closing = { coins: 1000 + ledger.seats[0].netCoinChange, reputation: 0, score: 0 };
    const summary = buildCompetitiveTurnSummary(state, { playerRoundLedger: ledger })!;
    expect(competitiveExpenseTooltip(summary, 0, 'staff')).toBe(
      'Staff wages: -40\n'
      + 'Pat the Manager: -50\n'
      + '  Base: -100\n'
      + '  Operations Manager: +50\n'
      + 'Sam the Clerk: -30\n'
      + 'Street-wide reduction: +12\n'
      + 'Limited by available coins: +28\n'
      + 'Total: -40',
    );
  });

  // ── Absent-safe degradation (holds today, plain `it`) ──

  it('a legacy ledger with no derivable detail degrades to the committed totals plus the note', () => {
    const { state, ledger } = competitiveAbsentSafeFixture();
    const summary = buildCompetitiveTurnSummary(state, { playerRoundLedger: ledger })!;
    const human = summary.rows.find((row) => row.ownerId === 0)!;
    for (const line of human.expenses) {
      expect(line.breakdown).toBeUndefined();
      const tooltip = buildExpenseLineTooltip(
        buildPLFromCompetitiveRow(human).expenses.lines
          .find((candidate) => candidate.key === line.category)!,
      );
      expect(tooltip).toContain(`${line.label}: ${line.coins}`);
      expect(tooltip).toContain('Operating expenses');
    }
    // The committed category totals themselves are unchanged by the missing detail.
    expect(human.expenses.map((line) => line.coins)).toEqual([-100, -20, -15]);
  });
});

// ── Owner-filtered expense breakdown derivation (MS-0MWEGDNAD009QDRO) ──────
//
// The model half of the parent epic: `expenseLineBreakdownForOwner` derives
// ONE owner's per-card breakdown from that owner's own committed cards, and
// the single-player `expenseLineBreakdown` delegates to it (owner 0), so
// single-player output is unchanged. These assertions pin the derivation
// directly at the model level; the threading into competitive rows is the
// sibling child MS-0MWEGDNP300007WC (whose tracers sit in the block above).

describe('owner-filtered expense breakdown derivation (MS-0MWEGDNAD009QDRO)', () => {
  it('derives each seat’s staff breakdown from its own staffCards, base + named modifiers', () => {
    const { state } = competitiveExpenseFixture();
    expect(expenseLineBreakdownForOwner(state, 0, 'staff')).toEqual({
      breakdown: {
        items: [
          { name: 'Pat the Manager', coins: -50, base: -100, modifiers: [{ name: 'Operations Manager', coins: 50 }] },
          { name: 'Sam the Clerk', coins: -30, base: -30, modifiers: [] },
        ],
      },
    });
    expect(expenseLineBreakdownForOwner(state, 1, 'staff')).toEqual({
      breakdown: {
        items: [
          { name: 'Moe the Manager', coins: -40, base: -90, modifiers: [{ name: 'Operations Manager', coins: 50 }] },
          { name: 'Ann the Accountant', coins: -30, base: -30, modifiers: [] },
        ],
      },
    });
  });

  it('derives community and business breakdowns owner-filtered from the street grid', () => {
    const { state } = competitiveExpenseFixture();
    expect(expenseLineBreakdownForOwner(state, 0, 'community')).toEqual({
      breakdown: { items: [{ name: 'Human Park', coins: -20, base: -20 }] },
    });
    expect(expenseLineBreakdownForOwner(state, 0, 'business')).toEqual({
      breakdown: {
        items: [
          { name: 'Human Bakery', coins: -10, base: -10 },
          { name: 'Human Cafe', coins: -5, base: -5 },
        ],
      },
    });
    expect(expenseLineBreakdownForOwner(state, 1, 'community')).toEqual({
      breakdown: { items: [{ name: 'AI Museum', coins: -8, base: -8 }] },
    });
    expect(expenseLineBreakdownForOwner(state, 1, 'business')).toEqual({
      breakdown: {
        items: [
          { name: 'AI Arcade', coins: -15, base: -15 },
          { name: 'AI Gym', coins: -12, base: -12 },
        ],
      },
    });
  });

  it('never lists another seat’s cards or sold slots (no cross-seat leakage)', () => {
    const { state } = competitiveExpenseFixture();
    const names = (ownerId: number) =>
      (['staff', 'community', 'business'] as const).flatMap((category) =>
        expenseLineBreakdownForOwner(state, ownerId, category).breakdown
          ?.items.map((item) => item.name) ?? []);
    expect(names(0)).toEqual([
      'Pat the Manager', 'Sam the Clerk', 'Human Park', 'Human Bakery', 'Human Cafe',
    ]);
    expect(names(1)).toEqual([
      'Moe the Manager', 'Ann the Accountant', 'AI Museum', 'AI Arcade', 'AI Gym',
    ]);
    // Sold slots incur no running cost and never appear in a breakdown.
    expect(names(0)).not.toContain('Sold Emporium');
    expect(names(1)).not.toContain('Sold Emporium');
  });

  it('applies the owner-scoped staff reduction and host-scoped community/business reduction', () => {
    const { state } = competitiveReductionFixture();
    // Seat 0's own Cost Cutter (owner scope) reduces only its staff.
    expect(expenseLineBreakdownForOwner(state, 0, 'staff')).toEqual({
      breakdown: {
        items: [
          { name: 'Pat the Manager', coins: -50, base: -100, modifiers: [{ name: 'Operations Manager', coins: 50 }] },
          { name: 'Sam the Clerk', coins: -30, base: -30, modifiers: [] },
        ],
        streetReduction: 12,
      },
    });
    // Seat 1's staff carry no Cost Cutter: the HOST's never reduces staff.
    expect(expenseLineBreakdownForOwner(state, 1, 'staff')).toEqual({
      breakdown: {
        items: [
          { name: 'Moe the Manager', coins: -40, base: -90, modifiers: [{ name: 'Operations Manager', coins: 50 }] },
          { name: 'Ann the Accountant', coins: -30, base: -30, modifiers: [] },
        ],
      },
    });
    // Community/business reduce via the shared host staff set for every seat.
    expect(expenseLineBreakdownForOwner(state, 0, 'community')).toEqual({
      breakdown: {
        items: [{ name: 'Human Park', coins: -20, base: -20 }],
        streetReduction: 3,
      },
    });
    expect(expenseLineBreakdownForOwner(state, 1, 'business')).toEqual({
      breakdown: {
        items: [
          { name: 'AI Arcade', coins: -15, base: -15 },
          { name: 'AI Gym', coins: -12, base: -12 },
        ],
        streetReduction: 4,
      },
    });
  });

  it('the single-player breakdown delegates to the owner-0 derivation unchanged', () => {
    const state = tooltipState();
    const projection = buildPLProjection(state, plInput(tooltipLedger()))!;
    for (const category of ['staff', 'community', 'business'] as const) {
      const line = projection.expenses.lines.find((candidate) => candidate.key === category)!;
      expect(expenseLineBreakdownForOwner(state, 0, category)).toEqual({
        breakdown: line.breakdown,
      });
    }
  });

  it('is absent-safe for an unknown owner and for empty sources', () => {
    const { state } = competitiveExpenseFixture();
    // An unknown owner (roster exists, id out of range): no breakdown, never a throw.
    for (const category of ['staff', 'community', 'business'] as const) {
      expect(expenseLineBreakdownForOwner(state, 999, category)).toEqual({});
    }
    // A roster-less state with no cards and no grid yields no breakdown either.
    const empty = tooltipState();
    empty.streetGrid = empty.streetGrid.map(() => null);
    empty.staffCards = [];
    for (const category of ['staff', 'community', 'business'] as const) {
      expect(expenseLineBreakdownForOwner(empty, 0, category)).toEqual({});
    }
  });
});

// ── Exact content strings (verification MS-0MW7QQ1FD000RCA3) ──

describe('ledger tooltip exact content strings (MS-0MW7QQ1FD000RCA3)', () => {
  function projection() {
    return buildPLProjection(tooltipState(), plInput(tooltipLedger()))!;
  }

  it('business-income tooltip is exactly the label, amount and per-business list', () => {
    const base = projection().income.lines.find((line) => line.key === 'base')!;
    // One contributing business per line — never a comma-joined
    // `Per business: Bakery: +50, Cafe: +30` line (MS-0MWC90T19000JEA4).
    expect(buildIncomeLineTooltip(base)).toBe(
      'Base income: +80\nBakery: +50\nCafe: +30',
    );
  });

  it('staff-costs tooltip is exactly the label, per-card list and total', () => {
    const staff = projection().expenses.lines.find((line) => line.key === 'staff')!;
    // One staff member per line — never a comma-joined `Per item:` line.
    expect(buildExpenseLineTooltip(staff)).toBe(
      'Staff wages: -150\nClerk: -100\nManager: -50\nTotal: -150',
    );
  });

  it('incident tooltip is exactly the title and the name/effect line', () => {
    const p = projection();
    expect(buildIncidentLineTooltip(p.incident, 'Flu Outbreak')).toBe(
      'Incident\nFlu Outbreak: Coins -20, Rep -1',
    );
    expect(buildIncidentLineTooltip(p.incident, null)).toBe(
      'Incident\nNo incident was resolved this turn.',
    );
  });

  it('net tooltip is exactly the reconciliation identity', () => {
    expect(buildNetLineTooltip(projection())).toBe(
      'Net profit/loss\nNet = income (+89) + expenses (-185) + incident (-20) + one-off (-4) = -120',
    );
  });
});

// ── Enhanced content contract (MS-0MWC90T19000JEA4) ──────────

/** Formats a signed integer exactly as the tooltip builders do (`+N`/`-N`/`0`). */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** The main projection the content-contract assertions read. */
function contractProjection() {
  return buildPLProjection(tooltipState(), plInput(tooltipLedger()))!;
}

/**
 * A projection whose staff member carries the Operations Manager salary
 * discount, so a staff item explains its charge as `base + modifier`:
 *
 *  Pat the Manager: base −100, discount +50 ⇒ charged −50.
 *  Sam the Clerk:   base −20, no modifier   ⇒ charged −20.
 *  Category total:  −70.
 */
function staffModifierProjection() {
  const state = tooltipState();
  state.staffCards = [
    makeStaff('Pat the Manager', 100, ['skill-operations-manager'], 0),
    makeStaff('Sam the Clerk', 20, [], 1),
  ];
  const ledger: TurnLedger = {
    ...tooltipLedger(),
    ongoingCosts: { staff: -70, community: -20, business: -15 },
    // income 89 + expenses −105 + incident −20 + one-off −4 = −40
    netCoinChange: -40,
  };
  return buildPLProjection(state, plInput(ledger))!;
}

/**
 * A projection whose resolved incident is mitigated by two named
 * management-company skills: Quality Inspector (−30% coin damage) and Brand
 * Ambassador (+50% reputation gain). Base −100 coins / +4 rep ⇒ committed
 * −70 coins / +6 rep.
 */
function incidentModifierProjection() {
  const state = tooltipState();
  state.staffCards = [
    makeStaff('Quinn the Inspector', 0, ['skill-quality-inspector']),
    makeStaff('Alex the Ambassador', 0, ['skill-brand-ambassador']),
  ];
  const incident = {
    family: 'event',
    id: 'evt-test-mitigated-incident',
    name: 'Test Incident',
    trigger: 'Incident',
    cost: 0,
    effect: 'synthetic test incident',
    target: 'All',
    coinDelta: -100,
    reputationDelta: 4,
  } as EventCard;
  const ledger: TurnLedger = {
    ...tooltipLedger(),
    // income 89 + expenses −185 + incident −70 + one-off −4 = −170
    incidentCoinChange: -70,
    incidentRepChange: 6,
    netCoinChange: -170,
    netRepChange: 5,
  };
  return buildPLProjection(state, { turnLedger: ledger, incident, income: incomeResult() })!;
}

describe('ledger tooltip enhanced content contract (MS-0MWC90T19000JEA4)', () => {
  // ── Multi-line layout: one contributing item per line ──
  it('every income row lists one contributing business per line', () => {
    const projection = contractProjection();
    const expected: Record<string, string> = {
      base: 'Base income: +80\nBakery: +50\nCafe: +30',
      synergy: 'Synergy income: +7\nBakery: +5\nCafe: +2',
      reputation: 'Reputation income: +4\nBakery: +3\nCafe: +1',
    };
    for (const [key, want] of Object.entries(expected)) {
      const line = projection.income.lines.find((candidate) => candidate.key === key)!;
      const tooltip = buildIncomeLineTooltip(line);
      expect(tooltip, key).toBe(want);
      expect(tooltip, key).not.toContain('Per business:');
    }
  });

  it('the Events row enumerates each event effect beneath its business', () => {
    const events = contractProjection().income.lines.find((line) => line.key === 'events')!;
    expect(buildIncomeLineTooltip(events)).toBe(
      'Event income: -2\nBakery: -2\n  Flu: -2',
    );
    // The effect deltas explain (and sum to) the business's contribution.
    const item = events.breakdown!.items[0];
    expect(item.effects!.reduce((total, effect) => total + effect.delta, 0)).toBe(item.coins);
  });

  it('every expense row lists one contributing card per line', () => {
    const projection = contractProjection();
    const staff = projection.expenses.lines.find((line) => line.key === 'staff')!;
    const community = projection.expenses.lines.find((line) => line.key === 'community')!;
    const business = projection.expenses.lines.find((line) => line.key === 'business')!;
    expect(buildExpenseLineTooltip(staff)).toBe(
      'Staff wages: -150\nClerk: -100\nManager: -50\nTotal: -150',
    );
    expect(buildExpenseLineTooltip(community)).toBe(
      'Community spaces: -20\nPark: -20\nTotal: -20',
    );
    expect(buildExpenseLineTooltip(business)).toBe(
      'Business costs: -15\nBakery: -10\nCafe: -5\nTotal: -15',
    );
    for (const line of [staff, community, business]) {
      expect(buildExpenseLineTooltip(line)).not.toContain('Per item:');
    }
  });

  // ── Per-item base ± named modifiers ─────────────────────
  it('a staff item shows its base salary and each named modifier', () => {
    const staff = staffModifierProjection().expenses.lines.find((line) => line.key === 'staff')!;
    expect(buildExpenseLineTooltip(staff)).toBe(
      'Staff wages: -70\n'
      + 'Pat the Manager: -50\n'
      + '  Base: -100\n'
      + '  Operations Manager: +50\n'
      + 'Sam the Clerk: -20\n'
      + 'Total: -70',
    );
  });

  it('an item with no base/modifier detail keeps the plain one-line item (absent-safe)', () => {
    // Community/business items carry `base === coins` and no modifiers, so the
    // plain `Name: cost` line already states the base ongoing cost.
    const business = contractProjection().expenses.lines.find((line) => line.key === 'business')!;
    const items = business.breakdown!.items;
    expect(items.every((item) => item.base === item.coins)).toBe(true);
    expect(items.every((item) => (item.modifiers ?? []).length === 0)).toBe(true);
  });

  // ── Incident modifiers ──────────────────────────────────
  it('the incident tooltip shows the base effect and each applied modifier', () => {
    const incident = incidentModifierProjection().incident;
    expect(buildIncidentLineTooltip(incident, 'Test Incident')).toBe(
      'Incident\n'
      + 'Test Incident: Coins -70, Rep +6\n'
      + 'Base: Coins -100, Rep +4\n'
      + 'Quality Inspector: Coins +30, Rep 0\n'
      + 'Brand Ambassador: Coins 0, Rep +2',
    );
    // base + every modifier reconciles to the committed incident deltas.
    const detail = incident.detail!;
    expect(detail.base.coins + detail.modifiers.reduce((total, modifier) => total + modifier.coins, 0))
      .toBe(incident.coins);
    expect(detail.base.reputation
      + detail.modifiers.reduce((total, modifier) => total + modifier.reputation, 0))
      .toBe(incident.reputation);
  });

  it('the incident null note is unchanged', () => {
    const projection = contractProjection();
    expect(buildIncidentLineTooltip(projection.incident, null)).toBe(
      'Incident\nNo incident was resolved this turn.',
    );
  });

  // ── Total-row enumeration ───────────────────────────────
  it('the total income tooltip enumerates each contributing line and reconciles', () => {
    // The builder takes the section so it can list the section's own lines.
    const buildTotal = buildTotalLineTooltip as unknown as (section: PLStatementSection) => string;
    const income = contractProjection().income;
    const tooltip = buildTotal(income);
    expect(tooltip).toBe(
      'Total income: +89\n'
      + 'Base income: +80\n'
      + 'Synergy income: +7\n'
      + 'Reputation income: +4\n'
      + 'Event income: -2',
    );
    expect(tooltip).not.toContain('The sum of the lines above.');
    // The enumerated lines reconcile to the committed subtotal.
    expect(income.lines.reduce((total, line) => total + line.coins, 0)).toBe(income.total);
  });

  it('the total expenses tooltip enumerates each contributing line and reconciles', () => {
    const buildTotal = buildTotalLineTooltip as unknown as (section: PLStatementSection) => string;
    const expenses = contractProjection().expenses;
    expect(buildTotal(expenses)).toBe(
      'Total operating expenses: -185\n'
      + 'Staff wages: -150\n'
      + 'Community spaces: -20\n'
      + 'Business costs: -15',
    );
    expect(expenses.lines.reduce((total, line) => total + line.coins, 0)).toBe(expenses.total);
  });

  // ── Supplementary context derivations ───────────────────
  it('closing coins shows day start + net change = closing', () => {
    const projection = contractProjection();
    const context = projection.context;
    expect(buildContextLineTooltip('closingCoins', context)).toBe(
      'Closing coins\n'
      + `Day start: ${signed(context.dayStartCoins!)}\n`
      + `Net change: ${signed(projection.net.coins)}\n`
      + `Closing: ${signed(context.closingCoins)}`,
    );
    expect(context.dayStartCoins! + projection.net.coins).toBe(context.closingCoins);
  });

  it('reputation change shows its income, incident and one-off constituents', () => {
    const projection = contractProjection();
    const context = projection.context;
    const parts = context.reputationParts!;
    expect(buildContextLineTooltip('reputationChange', context)).toBe(
      'Reputation change\n'
      + `Income: ${signed(parts.income)}\n`
      + `Incident: ${signed(parts.incident)}\n`
      + `One-off: ${signed(parts.oneOff)}\n`
      + `Total: ${signed(context.reputationChange)}`,
    );
    expect(parts.income + parts.incident + parts.oneOff).toBe(context.reputationChange);
  });

  it('businesses owned names the businesses, one per line', () => {
    const projection = contractProjection();
    const context = projection.context;
    expect(buildContextLineTooltip('businessesOwned', context)).toBe(
      ['Businesses owned', ...context.businessNames!].join('\n'),
    );
    expect(context.businessNames!.length).toBe(context.businessesOwned);
  });

  it('score change keeps its explanatory prose', () => {
    const tooltip = buildContextLineTooltip('scoreChange', contractProjection().context);
    expect(tooltip).toContain('Score change');
    expect(tooltip).toContain('final score');
  });

  // ── Absent-safe degradation ─────────────────────────────
  it('an income line with no breakdown degrades to the committed total plus the note', () => {
    const projection = buildPLProjection(tooltipState(), {
      turnLedger: tooltipLedger(),
      incident: { name: 'Flu Outbreak' } as EventCard,
    })!;
    const base = projection.income.lines.find((line) => line.key === 'base')!;
    expect(base.breakdown).toBeUndefined();
    expect(buildIncomeLineTooltip(base)).toBe(
      'Base income: +80\nBusiness income — how each owned business contributes.',
    );
  });

  it('an expense line with no breakdown degrades to the committed total plus the note', () => {
    const tooltip = buildExpenseLineTooltip({ key: 'staff', label: 'Staff wages', coins: -150 });
    expect(tooltip).toBe(
      'Staff wages: -150\nOperating expenses — what each item costs you.',
    );
  });

  it('a context row without derivations keeps its explanatory prose (absent-safe)', () => {
    const legacyContext = {
      reputationChange: 1,
      scoreChange: 14,
      closingCoins: 880,
      businessesOwned: 2,
    };
    expect(buildContextLineTooltip('closingCoins', legacyContext)).toBe(
      'Closing coins\nYour coin balance at the end of the day (day start + net change).',
    );
    expect(buildContextLineTooltip('reputationChange', legacyContext)).toBe(
      'Reputation change\nThe day’s net reputation change, after income, incidents and one-offs.',
    );
    expect(buildContextLineTooltip('businessesOwned', legacyContext)).toBe(
      'Businesses owned\nBusinesses standing on the street at closing (sold slots excluded).',
    );
  });
});

// ── Bookkeeper-reduced business expense breakdown (MS-0MWEQLYCH006NQ4M) ──

/**
 * The engine charges `effectiveBusinessOngoingCost` (Bookkeeper −20% per
 * business, GDD D.4.3) while `expenseLineBreakdown`'s business branch shows
 * the card's raw `ongoingCost`, so today the residual is mislabelled "limited
 * to the coins available". These cases pin the corrected contract (parent
 * MS-0MWEGF4V6007ZGRP) and are authored **red-phase** with `it.fails` per the
 * repo's test-first tracer-bullet convention (see `turn-summary-pl-model.test.ts`
 * and `competitive-per-seat-hand-capacity.test.ts`): each body asserts the exact
 * contract and is expected to fail until the implementing child
 * (MS-0MWEQN2R2007GQG0 — and MS-0MWEGDNAD009QDRO for the competitive seat's
 * per-item detail) flips it to a plain `it`. Leaving any as `it.fails` once it
 * passes is itself a failure, so the suite cannot go stale.
 *
 * The expected post-fix breakdown for the Bookkeeper-reduced Bakery:
 *
 *  Bakery: base −20, coins −16, modifier `Bookkeeper: +4`
 *  Cafe:   base −5,  coins −5,  (no modifier)
 *  sum(items) + streetReduction === line.coins (−21) — no clamp line.
 */
describe('Bookkeeper-reduced business expense breakdown (MS-0MWEQLYCH006NQ4M)', () => {
  /** The single-player business-costs line for the Bookkeeper fixture. */
  const businessLine = (): PLStatementLine =>
    buildPLProjection(bookkeeperState(), plInput(bookkeeperLedger()))!
      .expenses.lines.find((line) => line.key === 'business')!;

  it.fails('exposes the Bookkeeper reduction as a named modifier with base + modifier === coins', () => {
    const items = businessLine().breakdown!.items;
    expect(items).toHaveLength(2);
    const bakery = items.find((item) => item.name === 'Bakery')!;
    expect(bakery.base).toBe(-20);
    expect(bakery.coins).toBe(-16);
    expect(bakery.modifiers).toEqual([{ name: 'Bookkeeper', coins: 4 }]);
    // base + sum(modifiers) === coins holds for every business item.
    for (const item of items) {
      const modifierSum = (item.modifiers ?? [])
        .reduce((total, modifier) => total + modifier.coins, 0);
      expect(item.base! + modifierSum).toBe(item.coins);
    }
  });

  it.fails('reconciles exactly to the committed total with no spurious clamp line', () => {
    const line = businessLine();
    const streetReduction = line.breakdown?.streetReduction ?? 0;
    const itemSum = line.breakdown!.items.reduce((total, item) => total + item.coins, 0);
    expect(itemSum + streetReduction).toBe(line.coins);
  });

  it.fails('the tooltip names the Bookkeeper discount and omits the limited-by-coins line', () => {
    const line = businessLine();
    const tooltip = buildExpenseLineTooltip(line);
    expect(tooltip).toContain('Bakery: -16');
    expect(tooltip).toContain('Bookkeeper: +4');
    expect(tooltip).not.toContain('Limited by available coins');
    expect(tooltip).toContain('Total: -21');
  });

  it.fails('a competitive seat shows the same Bookkeeper modifier on its business line', () => {
    const state = bookkeeperCompetitiveState();
    const summary = buildCompetitiveTurnSummary(state, {
      playerRoundLedger: bookkeeperCompetitiveLedger(),
    });
    expect(summary).not.toBeNull();
    const human = summary!.rows.find((row) => row.ownerId === 0)!;
    const business = buildPLFromCompetitiveRow(human).expenses.lines
      .find((line) => line.key === 'business')!;
    const items = business.breakdown!.items;
    expect(items).toHaveLength(1);
    const bakery = items[0];
    expect(bakery.name).toBe('Bakery');
    expect(bakery.base).toBe(-20);
    expect(bakery.coins).toBe(-16);
    expect(bakery.modifiers).toEqual([{ name: 'Bookkeeper', coins: 4 }]);
    const streetReduction = business.breakdown?.streetReduction ?? 0;
    const itemSum = items.reduce((total, item) => total + item.coins, 0);
    expect(itemSum + streetReduction).toBe(business.coins);
    const tooltip = buildExpenseLineTooltip(business);
    expect(tooltip).toContain('Bookkeeper: +4');
    expect(tooltip).not.toContain('Limited by available coins');
    expect(tooltip).toContain('Total: -16');
  });
});
