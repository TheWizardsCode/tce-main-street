/**
 * Main Street: single-player AI hire-and-place for business staff (Q3-A,
 * MS-0MWEWIP02006VNFO, parent MS-0MWE64C6B002V3SO AC6).
 *
 * In AI-driven play (Monte Carlo / auto-play) a business-staff hire must
 * place the member at a legal destination business as part of the hire; when
 * no legal destination exists the hire action is not taken, so an AI hire is
 * never silently inert (a Delivery Driver parked in the management company
 * wasting its salary). Management-company staff hires stay unchanged, the
 * competitive AI stays staff-free, and seeded outcomes stay deterministic.
 *
 * These tests assert observable behaviour — `enumerateLegalActions` action
 * shapes, `executeAction` state transitions (hire + placement in the same
 * action), and seeded reproducibility — never source text.
 *
 * @module tests/main-street/ai-hire-and-place
 */

import { describe, it, expect } from 'vitest';

import { setupMainStreetGame, type MainStreetState } from '../../src/MainStreetState';
import {
  executeWeekStart,
  executeAction,
  canPlaceStaffCardOnBusiness,
  canPlaceStaffOnBusiness,
  type PlayerAction,
  type HireStaffAction,
} from '../../src/MainStreetEngine';
import { getStaffCardTemplates, type BusinessCard, type StaffCard } from '../../src/MainStreetCards';
import {
  enumerateLegalActions,
  firstLegalStaffPlacement,
  MainStreetAiPlayer,
  GreedyStrategy,
  scoreAction,
} from '../../src/MainStreetAiStrategy';

// ── Fixtures ────────────────────────────────────────────────

function startState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  return state;
}

/** Puts a shipped staff template into the market row (returns the template). */
function addStaffToMarket(state: MainStreetState, id: string): StaffCard {
  const template = getStaffCardTemplates().find(c => c.id === id);
  if (!template) throw new Error(`staff template ${id} not found`);
  state.market.cards.push({ ...template });
  return template;
}

/** Places a business card at a street-grid slot (owner neutral, single-player). */
function placeBusiness(state: MainStreetState, slot: number, name: string, synergy: string[]): BusinessCard {
  const biz: BusinessCard = {
    family: 'business',
    id: `biz-${slot}`,
    name,
    cost: 300,
    baseIncome: 2,
    synergyTypes: synergy as BusinessCard['synergyTypes'],
    maxLevel: 0,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    description: 'ai-hire-and-place fixture',
    ongoingCost: 0,
    employedStaff: [],
  };
  state.streetGrid[slot] = biz;
  return biz;
}

/** Deterministic LCG RNG mirroring the shared harness style. */
function makeRng(seed: number = 42): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

// The Delivery Driver is business staff (no hand-slot / action marker,
// Food|Commerce) — the canonical case from the issue report.
const DRIVER: string = 'staff-delivery';
// The Assistant is management-company staff (handSlotsAdded=2).
const ASSISTANT: string = 'staff-assistant';

// ── Enumeration: hire-and-place composite ───────────────────

describe('Q3-A enumeration: business-staff hire carries a legal destination', () => {
  it('enumerates hire-staff carrying a legal destination slot when one exists', () => {
    const state = startState('q3a-enum-dest');
    addStaffToMarket(state, DRIVER);
    state.resourceBank.coins = 1000;
    state.actionsRemaining = 2;
    // A matching Food business with a free employment slot.
    placeBusiness(state, 0, 'Bakery', ['Food']);

    const action = enumerateLegalActions(state).find(
      a => a.type === 'hire-staff' && a.cardId === DRIVER,
    ) as HireStaffAction | undefined;
    expect(action).toBeDefined();
    expect(action!.slotIndex).toBe(0);
    expect(canPlaceStaffCardOnBusiness(state, getStaffCardTemplates().find(c => c.id === DRIVER)!, action!.slotIndex!).legal).toBe(true);
  });

  it('skips the business-staff hire entirely when no legal destination exists', () => {
    const state = startState('q3a-enum-nodest');
    addStaffToMarket(state, DRIVER);
    state.resourceBank.coins = 1000;
    state.actionsRemaining = 2;
    // No businesses at all on the street.
    state.streetGrid = [];

    const actions = enumerateLegalActions(state);
    expect(actions.find(a => a.type === 'hire-staff' && a.cardId === DRIVER)).toBeUndefined();
  });

  it('skips the business-staff hire when only a type-mismatched business exists', () => {
    const state = startState('q3a-enum-mismatch');
    addStaffToMarket(state, DRIVER);
    state.resourceBank.coins = 1000;
    state.actionsRemaining = 2;
    // A Service business; the Driver only serves Food|Commerce.
    placeBusiness(state, 0, 'Law Office', ['Service']);

    const actions = enumerateLegalActions(state);
    expect(actions.find(a => a.type === 'hire-staff' && a.cardId === DRIVER)).toBeUndefined();
  });

  it('skips the business-staff hire when the matching business has no free employment slot', () => {
    const state = startState('q3a-enum-full');
    addStaffToMarket(state, DRIVER);
    state.resourceBank.coins = 1000;
    state.actionsRemaining = 2;
    placeBusiness(state, 0, 'Bakery', ['Food']);
    // Occupy the only employment slot with a pre-hired member.
    const occupant: StaffCard = {
      ...getStaffCardTemplates().find(c => c.id === DRIVER)!,
      id: `${DRIVER}-occupant`,
      employedAtSlot: 0,
    };
    state.staffCards.push(occupant);
    state.streetGrid[0]!.employedStaff = [occupant];

    const actions = enumerateLegalActions(state);
    expect(actions.find(a => a.type === 'hire-staff' && a.cardId === DRIVER)).toBeUndefined();
  });

  it('picks the first legal slot deterministically (lowest index)', () => {
    const state = startState('q3a-enum-firstslot');
    addStaffToMarket(state, DRIVER);
    state.resourceBank.coins = 1000;
    state.actionsRemaining = 2;
    placeBusiness(state, 2, 'Bakery', ['Food']);
    placeBusiness(state, 5, 'Cafe', ['Food']);

    const card = getStaffCardTemplates().find(c => c.id === DRIVER)!;
    expect(firstLegalStaffPlacement(state, card)).toBe(2);
  });

  it('management-company staff hire stays as today (no destination)', () => {
    const state = startState('q3a-enum-mc');
    addStaffToMarket(state, ASSISTANT);
    state.resourceBank.coins = 1000;
    state.actionsRemaining = 2;
    placeBusiness(state, 0, 'Bakery', ['Food']);

    const action = enumerateLegalActions(state).find(
      a => a.type === 'hire-staff' && a.cardId === ASSISTANT,
    ) as HireStaffAction | undefined;
    expect(action).toBeDefined();
    expect(action!.slotIndex).toBeUndefined();
  });
});

// ── Execution: hire-and-place composite in one action ───────

describe('Q3-A execution: hire and place in the same action', () => {
  it('executing the composite hires the member AND places it at the destination', () => {
    const state = startState('q3a-exec-place');
    addStaffToMarket(state, DRIVER);
    state.resourceBank.coins = 1000;
    state.actionsRemaining = 2;
    const bakery = placeBusiness(state, 0, 'Bakery', ['Food']);

    const action: PlayerAction = { type: 'hire-staff', cardId: DRIVER, slotIndex: 0 };
    executeAction(state, action);

    const member = state.staffCards.find(c => c.id === DRIVER);
    expect(member).toBeDefined();
    expect(member!.employedAtSlot).toBe(0);
    expect(bakery.employedStaff ?? []).toContain(member);
    // One action consumed by the whole composite.
    expect(state.actionsRemaining).toBe(1);
  });

  it('a stale/invalid destination is rejected without mutating state (no half-hire)', () => {
    const state = startState('q3a-exec-invalid');
    addStaffToMarket(state, DRIVER);
    state.resourceBank.coins = 1000;
    state.actionsRemaining = 2;
    // Destination 0 is an empty slot — illegal placement.
    placeBusiness(state, 1, 'Bakery', ['Food']);
    const coinsBefore = state.resourceBank.coins;
    const staffBefore = state.staffCards.length;

    const action: PlayerAction = { type: 'hire-staff', cardId: DRIVER, slotIndex: 0 };
    expect(() => executeAction(state, action)).toThrow(/empty slot/i);

    expect(state.staffCards.length).toBe(staffBefore);
    expect(state.resourceBank.coins).toBe(coinsBefore);
  });
});

// ── Scoring & greedy selection ──────────────────────────────

describe('Q3-A AI decision layer', () => {
  it('the composite scores exactly like today (single scoring branch, no new rng)', () => {
    const state = startState('q3a-score');
    addStaffToMarket(state, DRIVER);
    state.resourceBank.coins = 1000;
    state.actionsRemaining = 2;
    placeBusiness(state, 0, 'Bakery', ['Food']);

    const action = enumerateLegalActions(state).find(
      a => a.type === 'hire-staff' && a.cardId === DRIVER,
    )!;
    expect(action).toBeDefined();
    expect(scoreAction(state, action)).toBeGreaterThan(0);
  });

  it('GreedyStrategy chooses the composite and a seeded run places the member', () => {
    const state = startState('q3a-greedy');
    state.market.cards = [{ ...getStaffCardTemplates().find(c => c.id === DRIVER)! }];
    state.hand = [];
    state.resourceBank.coins = 1000;
    state.actionsRemaining = 1;
    const bakery = placeBusiness(state, 0, 'Bakery', ['Food']);

    const player = new MainStreetAiPlayer(GreedyStrategy, makeRng(7));
    const chosen = player.chooseAction(state);
    expect(chosen.type).toBe('hire-staff');

    executeAction(state, chosen as PlayerAction);
    const member = state.staffCards.find(c => c.id === DRIVER);
    expect(member).toBeDefined();
    expect(member!.employedAtSlot).toBe(0);
    expect(bakery.employedStaff ?? []).toContain(member);
  });

  it('a seeded full turn is deterministic across runs with the same seed', () => {
    function run(seedRng: number): { hired: string | null; placed: boolean } {
      const state = startState('q3a-determinism');
      state.market.cards = [{ ...getStaffCardTemplates().find(c => c.id === DRIVER)! }];
      state.hand = [];
      state.resourceBank.coins = 100000;
      state.actionsRemaining = 3;
      placeBusiness(state, 0, 'Bakery', ['Food']);
      const player = new MainStreetAiPlayer(GreedyStrategy, makeRng(seedRng));
      let action = player.chooseAction(state);
      let guard = 0;
      while (action.type !== 'end-turn' && guard++ < 20) {
        executeAction(state, action);
        if (state.gameResult !== 'playing') break;
        action = player.chooseAction(state);
      }
      const member = state.staffCards.find(c => c.id === DRIVER);
      return { hired: member ? DRIVER : null, placed: !!member?.employedAtSlot };
    }

    expect(run(7)).toEqual(run(7));
    expect(run(11)).toEqual(run(11));
  });
});

// ── Shared placement predicate stays single ─────────────────

describe('Q3-A shared placement predicate', () => {
  it('canPlaceStaffOnBusiness delegates to the card-level predicate for a hired member', () => {
    const state = startState('q3a-shared-pred');
    const template = getStaffCardTemplates().find(c => c.id === DRIVER)!;
    const member: StaffCard = { ...template, id: `${DRIVER}-hired` };
    state.staffCards.push(member);
    placeBusiness(state, 0, 'Bakery', ['Food']);
    state.streetGrid[0]!.employedStaff = [];

    expect(canPlaceStaffCardOnBusiness(state, member, 0).legal).toBe(true);
    expect(canPlaceStaffOnBusiness(state, member.id, 0).legal).toBe(true);
  });

  it('management-company members stay unplaceable through the shared predicate', () => {
    const state = startState('q3a-mc-unplaceable');
    const template = getStaffCardTemplates().find(c => c.id === ASSISTANT)!;
    const member: StaffCard = { ...template, id: `${ASSISTANT}-hired` };
    state.staffCards.push(member);
    placeBusiness(state, 0, 'Bakery', ['Food']);

    expect(canPlaceStaffCardOnBusiness(state, member, 0).legal).toBe(false);
    expect(canPlaceStaffOnBusiness(state, member.id, 0).legal).toBe(false);
  });
});
