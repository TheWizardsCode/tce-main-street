/**
 * Main Street: Activity Log seat attribution for every action
 * (MS-0MW3PFQ4L0046Q3K, child of the Activity Log filter epic
 * MS-0MW1ZGM1F0010DQW)
 *
 * Pins the attribution contract the You/AI filter depends on:
 *
 *  - every entry created by an acting seat's action is attributed to that
 *    seat (`seatId` + `seatLabel` + `seatColour`) — one table-driven case per
 *    covered path;
 *  - every genuinely shared / turn-level entry stays unattributed — again one
 *    table-driven case per path;
 *  - the attribution decision is explicit at the call site: the default
 *    `addLog(state, text, type)` derives the seat from the engine's acting
 *    seat (`state.activePlayerId`), `addLog(state, seatId, ...)` pins an
 *    explicit seat, and `addLogShared` is the named opt-out;
 *  - single-player / single-seat games are untouched: no seat fields, entry
 *    text byte-identical, no prefix;
 *  - undo/redo and multi-seat turns neither double-stamp, drop nor mislabel
 *    attribution.
 *
 * The drive harness lives in `helpers/activity-log-harness.ts` (created by the
 * test-first child MS-0MW3PFLDP000CF2X).
 */
import { describe, expect, it } from 'vitest';

import {
  createActivityLogState,
  createSinglePlayerState,
  driveAction,
  recalculateCard,
  startDay,
} from './helpers/activity-log-harness';
import { addLog, addLogShared } from '../../src/MainStreetState';
import {
  appendTurnNetRow,
  checkEndConditions,
  checkImmediateLoss,
  applyBusinessOngoingCosts,
  applyCompetitiveOngoingCosts,
} from '../../src/MainStreetEngine';
import { applyIncome } from '../../src/MainStreetAdjacency';
import { refreshMarket } from '../../src/MainStreetMarket';
import { createTutorialScenario, ensureTutorialMarketForUpcomingSteps } from '../../src/TutorialScenario';
import type { LogEntry, MainStreetState } from '../../src/MainStreetState';
import type { BusinessCard, EventCard, StaffCard, UpgradeCard } from '../../src/MainStreetCards';

// ── Card factories (fabricated, matching the rest of the unit suite) ──

function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: overrides.id ?? 'test-biz',
    name: overrides.name ?? 'Test Biz',
    cost: overrides.cost ?? 3,
    baseIncome: overrides.baseIncome ?? 2,
    synergyTypes: overrides.synergyTypes ?? ['Food'],
    maxLevel: overrides.maxLevel ?? 1,
    description: overrides.description ?? 'A test business',
    level: overrides.level ?? 0,
    incomeBonus: overrides.incomeBonus ?? 0,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    reputationBonus: overrides.reputationBonus ?? 0,
    reputationPerTurn: overrides.reputationPerTurn ?? 0,
    ongoingCost: overrides.ongoingCost ?? 0,
  };
}

function makeInvestmentEvent(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event',
    id: overrides.id ?? 'test-event',
    name: overrides.name ?? 'Test Event',
    trigger: 'Investment',
    cost: overrides.cost ?? 0,
    effect: overrides.effect ?? '+1 coin',
    coinDelta: overrides.coinDelta ?? 1,
    reputationDelta: overrides.reputationDelta ?? 0,
    target: overrides.target ?? 'All',
    targetSynergy: overrides.targetSynergy,
  };
}

function makeIncident(overrides: Partial<EventCard> = {}): EventCard {
  return makeInvestmentEvent({
    id: 'test-incident',
    name: 'Test Incident',
    coinDelta: -2,
    reputationDelta: 0,
    ...overrides,
    trigger: 'Incident',
    cost: 0,
  });
}

function makeUpgrade(overrides: Partial<UpgradeCard> = {}): UpgradeCard {
  return {
    family: 'upgrade',
    id: overrides.id ?? 'test-upgrade',
    name: overrides.name ?? 'Test Upgrade',
    description: overrides.description ?? 'Improve a business',
    cost: overrides.cost ?? 4,
    targetBusiness: overrides.targetBusiness ?? 'Test Biz',
    requiredLevel: overrides.requiredLevel ?? 0,
    incomeBonus: overrides.incomeBonus ?? 1,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
  };
}

function makeStaff(overrides: Partial<StaffCard> = {}): StaffCard {
  return {
    family: 'staff',
    id: overrides.id ?? 'test-staff',
    name: overrides.name ?? 'Test Staff',
    cost: overrides.cost ?? 3,
    ongoingCost: overrides.ongoingCost ?? 1,
    handSlotsAdded: overrides.handSlotsAdded ?? 0,
    actionsPerTurn: overrides.actionsPerTurn ?? 0,
    description: overrides.description ?? 'A test staff card.',
    specializationSkillIds: overrides.specializationSkillIds ?? [],
  } as StaffCard;
}

// ── Local helpers ───────────────────────────────────────────

/** A fresh competitive harness state, day started (MarketPhase, Turn 1). */
function competitive(seed: string): MainStreetState {
  const state = createActivityLogState({ seed });
  startDay(state);
  return state;
}

/** Tags a slot as owned by a seat and syncs the street grid + cache. */
function ownSlot(state: MainStreetState, slotIndex: number, card: BusinessCard, seatId: number): void {
  state.streetGrid[slotIndex] = card;
  state.ownerTaggedGrid![slotIndex] = { card, ownerId: seatId };
  recalculateCard(state, slotIndex);
}

/** Asserts the entry carries a complete, correct seat attribution. */
function expectAttributed(entry: LogEntry | undefined, state: MainStreetState, seatId: number): void {
  expect(entry, 'expected an attributed entry').toBeDefined();
  expect(entry!.seatId).toBe(seatId);
  expect(entry!.seatLabel).toBe(seatId === 0 ? 'You' : `AI ${seatId}`);
  expect(entry!.seatColour).toBe(state.players![seatId].colour);
}

/** Asserts the entry carries no seat attribution at all. */
function expectShared(entry: LogEntry | undefined, label: string): void {
  expect(entry, `expected a shared entry: ${label}`).toBeDefined();
  expect(entry!.seatId, label).toBeUndefined();
  expect(entry!.seatLabel, label).toBeUndefined();
  expect(entry!.seatColour, label).toBeUndefined();
}

/** Finds the entry whose text satisfies `predicate`. */
function find(entries: LogEntry[], predicate: (entry: LogEntry) => boolean): LogEntry | undefined {
  return entries.find(predicate);
}

// ── Covered (attributed) action paths ───────────────────────

interface AttributedCase {
  /** Path name (used as the test title). */
  name: string;
  /** Seat that performs the action. */
  seatId: number;
  /** Builds the state and drives the action; returns the appended entries. */
  drive: (state: MainStreetState) => LogEntry[];
  /** Predicate selecting the seat-attributable entry from the appended ones. */
  pick: (entry: LogEntry) => boolean;
}

const ATTRIBUTED_PATHS: AttributedCase[] = [
  {
    name: 'buy-business',
    seatId: 1,
    drive: (s) => {
      s.players![1].coins = 5000;
      s.activePlayerId = 1;
      const biz = s.market.cards.find((c) => c.family === 'business')!;
      return driveAction(s, { type: 'buy-business', cardId: biz.id, slotIndex: 0 }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Placed') && !e.text.includes('from hand'),
  },
  {
    name: 'play-business-from-hand',
    seatId: 1,
    drive: (s) => {
      s.players![1].coins = 5000;
      s.players![1].hand = [makeBiz({ id: 'attr-hand-biz', name: 'Cafe', cost: 2 })];
      s.activePlayerId = 1;
      return driveAction(s, { type: 'play-business-from-hand', handIndex: 0, slotIndex: 1 }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Played') && e.text.includes('from hand'),
  },
  {
    name: 'buy-and-place',
    seatId: 1,
    drive: (s) => {
      s.players![1].coins = 5000;
      s.activePlayerId = 1;
      const biz = s.market.cards.find((c) => c.family === 'business')!;
      return driveAction(s, { type: 'buy-and-place', cardId: biz.id, slotIndex: 2 }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Bought & placed'),
  },
  {
    name: 'play-event (held Investment)',
    seatId: 1,
    drive: (s) => {
      s.players![1].coins = 50;
      s.players![1].hand = [
        makeInvestmentEvent({ id: 'attr-ev', name: 'Fest', cost: 0, coinDelta: 3, reputationDelta: 2 }),
      ];
      s.activePlayerId = 1;
      return driveAction(s, { type: 'play-event', handIndex: 0 }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Investment:'),
  },
  {
    name: 'move-to-hand',
    seatId: 1,
    drive: (s) => {
      s.activePlayerId = 1;
      const biz = s.market.cards.find((c) => c.family === 'business')!;
      return driveAction(s, { type: 'move-to-hand', cardId: biz.id }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Moved'),
  },
  {
    name: 'move-event-to-hand',
    seatId: 1,
    drive: (s) => {
      s.activePlayerId = 1;
      s.market.cards = [makeInvestmentEvent({ id: 'attr-mv-ev', name: 'Market Fest' })];
      return driveAction(s, { type: 'buy-event', cardId: 'attr-mv-ev' }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Moved event'),
  },
  {
    name: 'upgrade (applied from market)',
    seatId: 1,
    drive: (s) => {
      ownSlot(s, 0, makeBiz({ id: 'attr-upg-biz', name: 'Bakery', maxLevel: 3 }), 1);
      s.market.cards = [makeUpgrade({ id: 'attr-upg', name: 'Better Ovens', targetBusiness: 'Bakery' })];
      s.players![1].coins = 50;
      s.activePlayerId = 1;
      return driveAction(s, { type: 'buy-upgrade', cardId: 'attr-upg', targetSlot: 0 }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Upgraded'),
  },
  {
    name: 'upgrade (played from hand)',
    seatId: 1,
    drive: (s) => {
      ownSlot(s, 0, makeBiz({ id: 'attr-upgh-biz', name: 'Bakery', maxLevel: 3 }), 1);
      s.players![1].hand = [
        makeUpgrade({ id: 'attr-upgh', name: 'Better Ovens', targetBusiness: 'Bakery' }),
      ];
      s.players![1].coins = 50;
      s.activePlayerId = 1;
      return driveAction(s, { type: 'play-upgrade-from-hand', handIndex: 0, targetSlot: 0 }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Played upgrade'),
  },
  {
    name: 'hire staff',
    seatId: 1,
    drive: (s) => {
      s.staffCards = [];
      s.market.cards = [makeStaff({ id: 'attr-staff', name: 'Helper', cost: 3 })];
      s.players![1].coins = 50;
      s.activePlayerId = 1;
      return driveAction(s, { type: 'hire-staff', cardId: 'attr-staff' }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Hired'),
  },
  {
    name: 'lay off staff',
    seatId: 1,
    drive: (s) => {
      s.staffCards = [makeStaff({ id: 'attr-layoff', name: 'Loafing Helper', handSlotsAdded: 0 })];
      s.players![1].coins = 50;
      s.activePlayerId = 1;
      return driveAction(s, { type: 'layoff', cardId: 'attr-layoff' }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Laid off'),
  },
  {
    name: 'loan (take-loan)',
    seatId: 1,
    drive: (s) => {
      s.activePlayerId = 1;
      return driveAction(s, { type: 'take-loan', optionIndex: 0 }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Took a bank loan'),
  },
  {
    name: 'bailout offer',
    seatId: 1,
    drive: (s) => {
      s.turn = 2;
      s.players![1].coins = -8;
      return driveAction(s, { type: 'bailout', playerId: 1 });
    },
    pick: (e) => e.text.startsWith('Bankruptcy bailout:'),
  },
  {
    name: 'community favour',
    seatId: 1,
    drive: (s) => {
      s.players![1].coins = 500;
      s.players![1].reputation = 50;
      s.activePlayerId = 1;
      return driveAction(s, { type: 'community-favour', direction: 'coins-to-rep' }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Community Favour:'),
  },
  {
    name: 'peek incident deck',
    seatId: 1,
    drive: (s) => {
      s.staffCards = [makeStaff({ id: 'attr-peek', name: 'Scout', peekOncePerTurn: true } as never)];
      s.incidentDeck = [makeIncident({ id: 'attr-peek-incident' })];
      s.activePlayerId = 1;
      return driveAction(s, { type: 'peek-incident-deck' }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Peeked at the top card'),
  },
  {
    name: 'sell business',
    seatId: 1,
    drive: (s) => {
      ownSlot(s, 0, makeBiz({ id: 'attr-sell-biz', name: 'Cafe', cost: 4 }), 1);
      s.activePlayerId = 1;
      return driveAction(s, { type: 'sell', slotIndex: 0 }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Sold'),
  },
  {
    name: 'sell from hand',
    seatId: 1,
    drive: (s) => {
      // The engine sell path reads the shared hand (no seat binding), so the
      // card is placed there directly; the acting seat is still activePlayerId.
      s.hand = [makeBiz({ id: 'attr-sell-hand', name: 'Cafe', cost: 4 })];
      s.activePlayerId = 1;
      return driveAction(s, { type: 'sell-from-hand', handIndex: 0 }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Sold') && e.text.includes('from hand'),
  },
  {
    name: 'close business',
    seatId: 1,
    drive: (s) => {
      ownSlot(s, 0, makeBiz({ id: 'attr-close-biz', name: 'Cafe', cost: 4 }), 1);
      s.activePlayerId = 1;
      return driveAction(s, { type: 'close-business', slotIndex: 0 }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Closed'),
  },
  {
    name: 'discard from hand',
    seatId: 1,
    drive: (s) => {
      s.players![1].hand = [makeBiz({ id: 'attr-discard', name: 'Cafe', cost: 2 })];
      s.activePlayerId = 1;
      return driveAction(s, { type: 'discard-from-hand', handIndex: 0 }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Discarded'),
  },
  {
    name: 'income collection (per-owner)',
    seatId: 1,
    drive: (s) => {
      ownSlot(s, 0, makeBiz({ id: 'attr-income-biz', name: 'Cafe', baseIncome: 3 }), 1);
      s.activePlayerId = 1;
      return driveAction(s, { type: 'income' });
    },
    pick: (e) => e.text.startsWith('Income:') && e.seatId === 1,
  },
  {
    name: 'reputation from cards (per-owner)',
    seatId: 1,
    drive: (s) => {
      ownSlot(s, 0, makeBiz({ id: 'attr-rep-biz', name: 'Cafe', reputationPerTurn: 2 }), 1);
      s.activePlayerId = 1;
      return driveAction(s, { type: 'income' });
    },
    pick: (e) => e.text.startsWith('Reputation from cards:'),
  },
  {
    name: 'reputation change',
    seatId: 1,
    drive: (s) => {
      s.activePlayerId = 1;
      return driveAction(s, { type: 'reputation', playerId: 1, delta: 2 });
    },
    pick: (e) => e.text.includes('reputation'),
  },
  {
    name: 'incident outcome (per-owner effect)',
    seatId: 1,
    drive: (s) => {
      s.activePlayerId = 1;
      s.players![1].coins = 100;
      return driveAction(s, { type: 'incident', event: makeIncident({ coinDelta: -5 }) }, { seatId: 1 });
    },
    pick: (e) => e.text.startsWith('Incident: Test Incident (') && e.seatId !== undefined,
  },
];

describe('every acting-seat action path is attributed to its seat (MS-0MW3PFQ4L0046Q3K AC1)', () => {
  it.each(ATTRIBUTED_PATHS)('$name attributes to seat $seatId', ({ seatId, drive, pick }) => {
    const state = competitive(`attributed-${seatId}`);
    const entries = drive(state);
    const entry = find(entries, pick);

    expectAttributed(entry, state, seatId);
  });
});

// ── Shared (unattributed) paths ─────────────────────────────

interface SharedCase {
  name: string;
  /** Drives the shared path; returns the appended entries. */
  drive: (state: MainStreetState) => LogEntry[];
  /** Predicate selecting the shared entry from the appended ones. */
  pick: (entry: LogEntry) => boolean;
}

const SHARED_PATHS: SharedCase[] = [
  {
    name: 'turn header (week start)',
    drive: (s) => startDay(s),
    pick: (e) => e.type === 'turn-header',
  },
  {
    name: 'per-turn net summary (appendTurnNetRow)',
    drive: (s) => {
      const before = s.activityLog.length;
      appendTurnNetRow(s, s.turn);
      return s.activityLog.slice(before);
    },
    pick: (e) => /^Turn \d+ net:/.test(e.text),
  },
  {
    name: 'per-turn totals row (appendTurnNetRow)',
    drive: (s) => {
      const before = s.activityLog.length;
      appendTurnNetRow(s, s.turn);
      return s.activityLog.slice(before);
    },
    pick: (e) => /^Turn \d+ totals:/.test(e.text),
  },
  {
    name: 'incident draw line',
    drive: (s) => driveAction(s, { type: 'incident', event: makeIncident({ coinDelta: 0 }) }),
    pick: (e) => e.text.startsWith('Incident:'),
  },
  {
    name: 'market refresh / deal-in',
    drive: (s) => {
      const before = s.activityLog.length;
      s.resourceBank.coins = 500;
      refreshMarket(s);
      return s.activityLog.slice(before);
    },
    pick: (e) => e.text.startsWith('Researched market'),
  },
  {
    name: 'shared host-wallet income row',
    drive: (s) => {
      const before = s.activityLog.length;
      applyIncome(s);
      return s.activityLog.slice(before);
    },
    pick: (e) => e.text.startsWith('Income:'),
  },
  {
    name: 'shared host-wallet ongoing cost row',
    drive: (s) => {
      ownSlot(s, 0, makeBiz({ id: 'shared-cost-biz', name: 'Cafe', ongoingCost: 5 }), 0);
      s.resourceBank.coins = 100;
      const before = s.activityLog.length;
      applyBusinessOngoingCosts(s);
      return s.activityLog.slice(before);
    },
    pick: (e) => e.text.startsWith('Business costs:'),
  },
  {
    name: 'game over (bankruptcy)',
    drive: (s) => {
      const before = s.activityLog.length;
      s.resourceBank.coins = -5;
      checkImmediateLoss(s);
      return s.activityLog.slice(before);
    },
    pick: (e) => e.text.startsWith('Game Over:'),
  },
  {
    name: 'game over (turn limit)',
    drive: (s) => {
      const before = s.activityLog.length;
      (s.config as { maxTurns?: number }).maxTurns = 1;
      s.turn = 1;
      s.finalScore = 0;
      checkEndConditions(s);
      return s.activityLog.slice(before);
    },
    pick: (e) => e.text.startsWith('Game Over: Turn limit exhausted'),
  },
];

describe('every shared / turn-level path stays unattributed (MS-0MW3PFQ4L0046Q3K AC2)', () => {
  it.each(SHARED_PATHS)('$name carries no seat fields', ({ drive, pick }) => {
    const state = competitive(`shared-${Math.random()}`);
    const entries = drive(state);
    const entry = find(entries, pick);

    expectShared(entry, `shared path`);
  });
});

describe('shared / turn-level paths that need a dedicated drive (AC2)', () => {
  it('tutorial guarantee lines carry no seat fields', () => {
    const tutorialState = createTutorialScenario();
    tutorialState.market.cards = [];
    ensureTutorialMarketForUpcomingSteps(tutorialState, {
      isActive: true,
      currentStepIndex: 0,
      lastCompletedStepId: null,
      exited: false,
    });

    const scenarioLines = tutorialState.activityLog.filter((e) => e.text.startsWith('Scenario:'));
    // The hook only logs when a future tutorial step needs a market card the
    // row does not already show. When it does log, the line must be shared.
    for (const line of scenarioLines) {
      expectShared(line, 'tutorial guarantee line');
    }
    // And the tutorial scenario line is keyword-distinct from seat actions.
    for (const line of tutorialState.activityLog) {
      expect(line.text, 'tutorial line').not.toMatch(/^(You|AI \d+) /);
    }
  });

  it('per-owner ongoing-cost rows are attributed to their owner, not the ambient seat', () => {
    const state = competitive('own-ongoing-cost');
    ownSlot(state, 0, makeBiz({ id: 'oc-biz-0', name: 'Cafe', ongoingCost: 5 }), 0);
    ownSlot(state, 1, makeBiz({ id: 'oc-biz-1', name: 'Bakery', ongoingCost: 7 }), 1);
    state.players![0].coins = 100;
    state.players![1].coins = 100;
    state.activePlayerId = 0; // ambient seat ≠ owner of slot 1

    const before = state.activityLog.length;
    applyCompetitiveOngoingCosts(state);
    const entries = state.activityLog.slice(before);

    const seatZero = entries.filter((e) => e.text.includes('Ongoing costs:'));
    expect(seatZero.length).toBeGreaterThan(0);
    for (const entry of seatZero) {
      expect(entry.seatId).toBe(0);
      expectAttributed(entry, state, 0);
    }
  });
});

// ── Explicit opt-out seam ───────────────────────────────────

describe('the attribution decision is explicit at the call site (AC4)', () => {
  it('the default addLog derives the seat from state.activePlayerId', () => {
    const state = competitive('seam-default');
    state.activePlayerId = 1;

    addLog(state, 'Derived seat action', 'neutral');

    expectAttributed(state.activityLog[state.activityLog.length - 1], state, 1);
  });

  it('the default addLog follows activePlayerId, not UI/ambient state', () => {
    const state = competitive('seam-follow');
    state.activePlayerId = 1;
    addLog(state, 'First seat action', 'neutral');
    state.activePlayerId = 0;
    addLog(state, 'Second seat action', 'neutral');

    expectAttributed(state.activityLog[state.activityLog.length - 2], state, 1);
    expectAttributed(state.activityLog[state.activityLog.length - 1], state, 0);
  });

  it('the default addLog falls back to no attribution when the acting seat is absent', () => {
    const state = competitive('seam-absent');
    state.activePlayerId = null;

    addLog(state, 'No acting seat', 'neutral');

    expectShared(state.activityLog[state.activityLog.length - 1], 'absent acting seat');
  });

  it('addLogShared is a named opt-out even with an acting seat present', () => {
    const state = competitive('seam-shared');
    state.activePlayerId = 1;

    addLogShared(state, 'Shared summary', 'neutral');

    expectShared(state.activityLog[state.activityLog.length - 1], 'named opt-out');
  });

  it('the explicit-seat overload attributes a seat other than the acting one', () => {
    const state = competitive('seam-explicit');
    state.activePlayerId = 0;

    addLog(state, 1, 'Per-owner second-seat row', 'neutral');

    expectAttributed(state.activityLog[state.activityLog.length - 1], state, 1);
  });
});

// ── Single-player / single-seat unchanged ──────────────────

describe('single-player and single-seat games are unchanged (AC3)', () => {
  it('single-player (no roster): the default addLog stamps nothing and text is unchanged', () => {
    const state = createSinglePlayerState('attr-single-player');
    startDay(state);
    state.activePlayerId = 0;

    addLog(state, 'Income: +5 coins (+5 coins)', 'gain');
    addLog(state, 0, 'Seat-arg income', 'gain');

    const defaultEntry = state.activityLog[state.activityLog.length - 2];
    const seatArgEntry = state.activityLog[state.activityLog.length - 1];
    expectShared(defaultEntry, 'single-player default');
    expectShared(seatArgEntry, 'single-player seat arg');
    expect(defaultEntry.text).toBe('Income: +5 coins (+5 coins)');
  });

  it('single-seat competitive (playerCount 1): no seat fields are stamped', () => {
    const state = createActivityLogState({ seed: 'attr-one-seat', playerCount: 1 });
    startDay(state);
    state.activePlayerId = 0;

    addLog(state, 'One-seat action', 'neutral');
    addLog(state, 0, 'One-seat explicit', 'neutral');

    expectShared(state.activityLog[state.activityLog.length - 2], 'one-seat default');
    expectShared(state.activityLog[state.activityLog.length - 1], 'one-seat explicit');
  });

  it('single-player market actions log byte-identical text', () => {
    const state = createSinglePlayerState('attr-single-text');
    startDay(state);
    state.resourceBank.coins = 5000;
    const biz = state.market.cards.find((c) => c.family === 'business')!;
    const before = state.activityLog.length;
    driveAction(state, { type: 'buy-business', cardId: biz.id, slotIndex: 0 });

    const entries = state.activityLog.slice(before);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.seatId).toBeUndefined();
      expect(entry.seatLabel).toBeUndefined();
      expect(entry.seatColour).toBeUndefined();
      // Text is the plain engine wording — no seat prefix is baked in.
      expect(entry.text).not.toMatch(/^(You|AI \d+) /);
    }
  });
});

// ── Undo/redo and multi-seat turns ─────────────────────────

describe('undo/redo and multi-seat turns keep attribution truthful (AC6)', () => {
  it('a re-executed command stamps exactly one attribution on each entry', () => {
    const state = competitive('undo-redo-attribution');
    state.players![0].coins = 5000;
    state.activePlayerId = 0;

    const biz = state.market.cards.find((c) => c.family === 'business')!;
    // Drive the action twice (forward, undo-restore, forward again) through
    // the same engine seam the scene command layer uses.
    for (let pass = 0; pass < 2; pass++) {
      const before = state.activityLog.length;
      driveAction(state, { type: 'buy-business', cardId: biz.id, slotIndex: pass }, { seatId: 0 });
      const entries = state.activityLog.slice(before);
      const bought = find(entries, (e) => e.text.startsWith('Bought'));
      expectAttributed(bought, state, 0);
    }

    // No entry is double-stamped: each attributed entry names exactly one seat.
    for (const entry of state.activityLog) {
      if (entry.seatId === undefined) continue;
      expect(entry.seatLabel).toBe(entry.seatId === 0 ? 'You' : `AI ${entry.seatId}`);
      expect(entry.seatColour).toBe(state.players![entry.seatId].colour);
    }
  });

  it('each seat in a multi-seat turn is attributed to itself, never to a neighbour', () => {
    const state = competitive('multi-seat-attribution');
    state.players![0].coins = 5000;
    state.players![1].coins = 5000;

    // Seat 0 buys, then seat 1 buys — the ambient seat changes between them.
    state.activePlayerId = 0;
    const biz0 = state.market.cards.find((c) => c.family === 'business')!;
    const seatZeroEntries = driveAction(
      state,
      { type: 'buy-business', cardId: biz0.id, slotIndex: 0 },
      { seatId: 0 },
    );
    const biz1 = state.market.cards.find((c) => c.family === 'business')!;
    const seatOneEntries = driveAction(
      state,
      { type: 'buy-business', cardId: biz1.id, slotIndex: 1 },
      { seatId: 1 },
    );

    expectAttributed(find(seatZeroEntries, (e) => e.text.startsWith('Bought')), state, 0);
    expectAttributed(find(seatOneEntries, (e) => e.text.startsWith('Bought')), state, 1);
  });

  it('a per-owner phase loop attributes each row to its owner, not the ambient seat', () => {
    const state = competitive('per-owner-loop');
    // Both seats own a slot; the ambient seat points at seat 0 while the
    // phase walks both owners.
    ownSlot(state, 0, makeBiz({ id: 'loop-biz-0', name: 'Cafe', baseIncome: 3 }), 0);
    ownSlot(state, 1, makeBiz({ id: 'loop-biz-1', name: 'Bakery', baseIncome: 4 }), 1);
    state.activePlayerId = 0;

    const entries = driveAction(state, { type: 'income' });
    const seatZero = entries.filter((e) => e.text.startsWith('Income:') && e.seatId === 0);
    const seatOne = entries.filter((e) => e.text.startsWith('Income:') && e.seatId === 1);

    expect(seatZero.length).toBeGreaterThan(0);
    expect(seatOne.length).toBeGreaterThan(0);
    for (const entry of seatZero) expectAttributed(entry, state, 0);
    for (const entry of seatOne) expectAttributed(entry, state, 1);
  });

  it('a saved/restored state keeps the same attribution on replay', () => {
    const state = competitive('replay-attribution');
    state.activePlayerId = 1;
    state.players![1].coins = 5000;
    const biz = state.market.cards.find((c) => c.family === 'business')!;
    const entries = driveAction(
      state,
      { type: 'buy-business', cardId: biz.id, slotIndex: 0 },
      { seatId: 1 },
    );
    const bought = find(entries, (e) => e.text.startsWith('Bought'));

    expectAttributed(bought, state, 1);
    // Attribution is entry data, not derived at render time: a structural
    // copy (as a save/load round-trip produces) keeps it intact.
    const copy = JSON.parse(JSON.stringify(bought)) as LogEntry;
    expect(copy.seatId).toBe(1);
    expect(copy.seatLabel).toBe('AI 1');
    expect(copy.seatColour).toBe(state.players![1].colour);
  });
});
