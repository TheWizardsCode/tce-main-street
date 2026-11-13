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
import type {
  BusinessCard,
  CommunitySpaceCard,
  EventCard,
  StaffCard,
} from '../../src/MainStreetCards';
import type {
  CompetitiveRoundLedger,
  TurnLedger,
  TurnResult,
} from '../../src/MainStreetEngineTypes';
import type { IncomeResult, SlotIncome, SlotPhaseBreakdown } from '../../src/MainStreetAdjacency';
import {
  buildCompetitiveTurnSummary,
  buildPLFromCompetitiveRow,
  buildPLProjection,
  buildTurnSummary,
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

  it('competitive expense lines stay category-total only (no invented per-item costs)', () => {
    const state = twoSeatState();
    const summary = buildCompetitiveTurnSummary(state, {
      playerRoundLedger: competitiveLedger(),
      playerIncome: [seatIncome(0, 'Human Bakery', 10)],
    });
    const human = summary!.rows.find((row) => row.ownerId === 0)!;
    for (const line of human.expenses) {
      expect(line.breakdown).toBeUndefined();
    }
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
