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
} from '../../src/scenes/MainStreetTurnSummary';
import {
  LEDGER_TOOLTIP_I18N_KEYS,
  buildContextLineTooltip,
  buildExpenseLineTooltip,
  buildIncidentLineTooltip,
  buildIncomeLineTooltip,
  buildNetLineTooltip,
  buildOneOffLineTooltip,
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

function makeStaff(name: string, ongoingCost: number): StaffCard {
  return {
    family: 'staff',
    id: `stf-${name}`,
    name,
    cost: 0,
    ongoingCost,
    handSlotsAdded: 0,
    description: 'Synthetic test staff',
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
    expect(events?.breakdown?.items).toEqual([{ name: 'Bakery', coins: -2 }]);
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
      { name: 'Clerk', coins: -100 },
      { name: 'Manager', coins: -50 },
    ]);
  });

  it('community costs line lists each community space’s charge', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const community = projection!.expenses.lines.find((line) => line.key === 'community');
    expect(community?.breakdown?.items).toEqual([{ name: 'Park', coins: -20 }]);
  });

  it('business costs line lists each business card’s running cost', () => {
    const projection = buildPLProjection(tooltipState(), plInput(tooltipLedger()));
    const business = projection!.expenses.lines.find((line) => line.key === 'business');
    expect(business?.breakdown?.items).toEqual([
      { name: 'Bakery', coins: -10 },
      { name: 'Cafe', coins: -5 },
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
});

// ── Exact content strings (verification MS-0MW7QQ1FD000RCA3) ──

describe('ledger tooltip exact content strings (MS-0MW7QQ1FD000RCA3)', () => {
  function projection() {
    return buildPLProjection(tooltipState(), plInput(tooltipLedger()))!;
  }

  it('business-income tooltip is exactly the label, amount and per-business list', () => {
    const base = projection().income.lines.find((line) => line.key === 'base')!;
    expect(buildIncomeLineTooltip(base)).toBe(
      'Base income: +80\nPer business: Bakery: +50, Cafe: +30',
    );
  });

  it('staff-costs tooltip is exactly the label, per-card list and total', () => {
    const staff = projection().expenses.lines.find((line) => line.key === 'staff')!;
    expect(buildExpenseLineTooltip(staff)).toBe(
      'Staff wages: -150\nPer item: Clerk: -100, Manager: -50\nTotal: -150',
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
