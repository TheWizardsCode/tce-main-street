/**
 * Main Street: staff assign-flow & hire matrix
 * (MS-0MWEWICJY004TT47, parent MS-0MWE64C6B002V3SO).
 *
 * Deterministic test-first spec for the **assign-later** staff model (Q1-B):
 *
 *  - a business-staff hire from the general market row joins the staff pool
 *    **unassigned** — no `employedAtSlot`, no hire-time destination step,
 *    while management-company hire stays exactly as today;
 *  - the *Assign to business* flow reuses the shared placement predicate
 *    (`canPlaceStaffOnBusiness` ⇒ `staffMatchesBusiness` /
 *    `hasFreeEmploymentSlot` / `canActiveSeatActOnSlot`) and the action-free
 *    `placeStaffOnBusinessCommand` — every legality, the action economy,
 *    undo/redo and the save/load round-trips are pinned here;
 *  - the single-player AI / Monte-Carlo hire path places business staff at a
 *    legal destination as part of the hire, and skips the hire when no legal
 *    destination exists (Q3-A); the competitive AI stays staff-free.
 *
 * ## Red → green phase (repo tracer-bullet convention)
 *
 * See `income-owner-flight-routing.test.ts` / `hud-total-counting.test.ts`.
 * The cases pinning the *missing* behaviour are authored **red-phase** with
 * `it.fails`: today the assign affordance only targets employed members, and
 * the single-player AI hires business staff without placing them, so every
 * `it.fails` case genuinely fails now (the suite stays green because the
 * expected failure is the recorded red baseline). The implementing children —
 * MS-0MWEWIFNT001PUY0 (assign affordance) and MS-0MWEWIP02006VNFO (AI
 * hire-and-place) — flip each `it.fails` to a plain `it` as their slice
 * lands; leaving one as `it.fails` after the implementation ships is itself
 * a failure, so the matrix cannot go stale. Everything that already holds —
 * the hire flow, the predicate legality matrix, the action economy and the
 * round-trips — is pinned by plain `it` guards that keep protecting it.
 *
 * Determinism: every case uses a fixture seed, fixed coins/action budgets and
 * no wall-clock reads, unseeded randomness or sleeps.
 *
 * @module tests/main-street/staff-assign-affordance
 */

import { describe, it, expect } from 'vitest';
import { UndoRedoManager } from '@core-engine';

import {
  setupMainStreetGame,
  createCompetitiveState,
  serializeMainStreetState,
  deserializeMainStreetState,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  executeWeekStart,
  executeCompetitiveWeekStart,
  executeAction,
  canPlaceStaffOnBusiness,
  placeStaffOnBusiness,
  getEmployedStaffCountAt,
  type PlayerAction,
} from '../../src/MainStreetEngine';
import { purchaseStaffCard } from '../../src/MainStreetMarket';
import { letGoStaffCommand, placeStaffOnBusinessCommand } from '../../src/MainStreetCommands';
import { createStaffDeck, type StaffCard, type BusinessCard } from '../../src/MainStreetCards';
import { buildMoveStaffAffordance } from '../../src/scenes/MainStreetHudTooltips';
import { buildCompanyRoster } from '../../src/MainStreetRoster';
import { staffCardScope } from '../../src/MainStreetStaffSkills';
import {
  enumerateLegalActions,
  enumerateCompetitiveLegalActions,
} from '../../src/MainStreetAiStrategy';
import { buildHumanVsAis } from './helpers/competitive-fixtures';

// ── Fixtures ────────────────────────────────────────────────

let serial = 0;

/** Fresh single-player state with the day started (MarketPhase) and deep pockets. */
function freshState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  state.resourceBank.coins = 2000;
  return state;
}

/** Places a matching-friendly business fixture at a slot (no cache sync needed). */
function businessAt(
  state: MainStreetState,
  slot: number,
  name: string,
  synergy: string[],
): BusinessCard {
  const biz: BusinessCard = {
    family: 'business',
    id: `biz-${name.toLowerCase().replace(/\s+/g, '-')}-${slot}`,
    name,
    cost: 300,
    baseIncome: 2,
    synergyTypes: [...synergy] as BusinessCard['synergyTypes'],
    maxLevel: 0,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    description: 'Assign-flow fixture.',
    ongoingCost: 0,
    employedStaff: [],
  };
  state.streetGrid[slot] = biz;
  return biz;
}

/** A shipped staff template instance (id keeps the shipped `-0` suffix). */
function template(idPrefix: string): StaffCard {
  const card = createStaffDeck(1).find(c => c.id.startsWith(idPrefix));
  if (!card) throw new Error(`staff template ${idPrefix} not found`);
  return card;
}

/** Offers one staff template in the general market row (the hire path). */
function offerInMarket(state: MainStreetState, idPrefix: string): StaffCard {
  const card: StaffCard = { ...template(idPrefix), specializationSkillIds: [] };
  state.market.cards = [{ ...card }];
  return card;
}

/** Pushes a hired-but-unassigned member into the staff pool (post-hire state). */
function hire(state: MainStreetState, idPrefix: string): StaffCard {
  const card: StaffCard = {
    ...template(idPrefix),
    id: `${template(idPrefix).id}-h${serial++}`,
    specializationSkillIds: [],
  };
  state.staffCards.push(card);
  return card;
}

// ── Q1-B: hire → unassigned ─────────────────────────────────

describe('Q1-B: business-staff hire joins the pool unassigned (no destination step)', () => {
  it('a business-staff hire from the general market row carries no employedAtSlot and no destination side effect', () => {
    const state = freshState('assign-hire-business');
    const barista = offerInMarket(state, 'staff-barista');
    state.resourceBank.coins = barista.cost + 50;

    purchaseStaffCard(state, barista.id);

    const member = state.staffCards.find(c => c.id === barista.id)!;
    expect(member).toBeDefined();
    // Q1-B: hired, but never placed at hire time.
    expect(member.employedAtSlot).toBeUndefined();
    // No business gained an employee as a side effect of the hire.
    expect(
      state.streetGrid.some(slot => slot && (slot.employedStaff ?? []).length > 0),
    ).toBe(false);
    // No hire-time destination step: nothing else in the state moved.
    expect(state.phase).toBe('MarketPhase');
    // The classification is card-type, not "has a slot": this member is
    // still business staff to the engine's own type rule.
    expect(staffCardScope(member)).toBe('business');
  });

  it('a management-company hire is unchanged (no destination, joins the company)', () => {
    const state = freshState('assign-hire-mgmt');
    const assistant = offerInMarket(state, 'staff-assistant');
    state.resourceBank.coins = assistant.cost + 50;
    const maxHandBefore = state.maxHandSize;

    purchaseStaffCard(state, assistant.id);

    const member = state.staffCards.find(c => c.id === assistant.id)!;
    expect(member.employedAtSlot).toBeUndefined();
    expect(staffCardScope(member)).toBe('management-company');
    // The hand-slot benefit is the hire's only effect (no placement).
    expect(state.maxHandSize).toBe(maxHandBefore + (assistant.handSlotsAdded ?? 0));
  });
});

// ── Assign legality matrix (the shared predicate) ────────────

describe('assign legality matrix — canPlaceStaffOnBusiness', () => {
  it('type match is legal (Chef → a Food business)', () => {
    const state = freshState('assign-legal-match');
    businessAt(state, 0, 'Bakery', ['Food']);
    const chef = hire(state, 'staff-chef');

    expect(canPlaceStaffOnBusiness(state, chef.id, 0).legal).toBe(true);
  });

  it('type mismatch is illegal with the shared reason (Barista → Hardware Store)', () => {
    const state = freshState('assign-legal-mismatch');
    businessAt(state, 0, 'Hardware Store', ['Service']);
    const barista = hire(state, 'staff-barista');

    const legality = canPlaceStaffOnBusiness(state, barista.id, 0);
    expect(legality.legal).toBe(false);
    expect((legality as { reason?: string }).reason ?? '').toMatch(/cannot work/);
  });

  it('no free employment slot is illegal (a level-0 business accepts one member)', () => {
    const state = freshState('assign-legal-full');
    businessAt(state, 0, 'Bakery', ['Food']);
    const baker = hire(state, 'staff-baker');
    const chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, baker.id, 0);
    expect(getEmployedStaffCountAt(state, 0)).toBe(1);

    const legality = canPlaceStaffOnBusiness(state, chef.id, 0);
    expect(legality.legal).toBe(false);
    expect((legality as { reason?: string }).reason ?? '').toMatch(/no free employment slots/);
  });

  it('an empty slot is illegal', () => {
    const state = freshState('assign-legal-empty');
    const chef = hire(state, 'staff-chef');

    expect(canPlaceStaffOnBusiness(state, chef.id, 0).legal).toBe(false);
  });

  it('no owned business at all ⇒ no legal destination anywhere', () => {
    const state = freshState('assign-legal-none');
    const chef = hire(state, 'staff-chef');

    const legalSlots = state.streetGrid
      .map((_, slot) => canPlaceStaffOnBusiness(state, chef.id, slot).legal)
      .filter(Boolean);
    expect(legalSlots).toEqual([]);
  });

  it('competitive: an opponent-owned destination is illegal with the shared ownership reason', () => {
    const state = buildHumanVsAis('assign-legal-opponent', 1, [
      [1000, 0],
      [1000, 0],
    ]);
    state.activePlayerId = 0;
    state.ownerTaggedGrid![0] = { card: businessAt(state, 0, 'Bakery', ['Food']), ownerId: 0 };
    state.ownerTaggedGrid![2] = { card: businessAt(state, 2, 'Diner', ['Food']), ownerId: 1 };
    const chef = hire(state, 'staff-chef');

    const legality = canPlaceStaffOnBusiness(state, chef.id, 2);
    expect(legality.legal).toBe(false);
    expect((legality as { reason?: string }).reason ?? '').toMatch(
      /That business belongs to AI 1\./,
    );
    // The same member's own business stays legal (the gate is per-destination).
    expect(canPlaceStaffOnBusiness(state, chef.id, 0).legal).toBe(true);
  });
});

// ── Action economy ──────────────────────────────────────────

describe('assign action economy via placeStaffOnBusinessCommand', () => {
  it('initial placement of an unassigned member is action-free', () => {
    const state = freshState('assign-actions-free');
    businessAt(state, 0, 'Bakery', ['Food']);
    const baker = hire(state, 'staff-baker');
    state.actionsRemaining = 1;

    const mgr = new UndoRedoManager();
    mgr.execute(placeStaffOnBusinessCommand(state, baker.id, 0));

    expect(state.staffCards.find(c => c.id === baker.id)!.employedAtSlot).toBe(0);
    expect(state.actionsRemaining).toBe(1);
  });

  it('relocating an employed member costs exactly 1 action', () => {
    const state = freshState('assign-actions-relocate');
    businessAt(state, 0, 'Bakery', ['Food']);
    businessAt(state, 1, 'Diner', ['Food']);
    const baker = hire(state, 'staff-baker');
    placeStaffOnBusiness(state, baker.id, 0);
    state.actionsRemaining = 1;

    const mgr = new UndoRedoManager();
    mgr.execute(placeStaffOnBusinessCommand(state, baker.id, 1));

    expect(state.staffCards.find(c => c.id === baker.id)!.employedAtSlot).toBe(1);
    expect(state.actionsRemaining).toBe(0);
  });

  it('an illegal assign spends nothing (action kept, member unassigned)', () => {
    const state = freshState('assign-actions-illegal');
    businessAt(state, 0, 'Hardware Store', ['Service']);
    const barista = hire(state, 'staff-barista');
    state.actionsRemaining = 1;

    const mgr = new UndoRedoManager();
    expect(() => mgr.execute(placeStaffOnBusinessCommand(state, barista.id, 0))).toThrow(
      /cannot work/,
    );

    expect(state.staffCards.find(c => c.id === barista.id)!.employedAtSlot).toBeUndefined();
    expect(getEmployedStaffCountAt(state, 0)).toBe(0);
    expect(state.actionsRemaining).toBe(1);
  });
});

// ── The assign affordance (red-phase: MS-0MWEWIFNT001PUY0) ──

describe('the assign affordance for unassigned business staff (MS-0MWEWIFNT001PUY0)', () => {
  it('offers an unassigned member with a legal destination as a place/assign target', () => {
    const state = freshState('assign-affordance-legal');
    businessAt(state, 0, 'Bakery', ['Food']);
    const baker = hire(state, 'staff-baker');
    state.actionsRemaining = 3;

    const affordance = buildMoveStaffAffordance(state, baker.id);

    // Today the shared affordance only considers employed members, so an
    // unassigned member is invisible (staffId null, no destinations, not
    // enabled). The assign child reuses the derivation while accepting
    // unplaced members — then, and only then, this pin holds.
    expect(affordance.staffId).toBe(baker.id);
    expect(affordance.destinationSlots).toEqual([0]);
    expect(affordance.enabled).toBe(true);
  });

  it('stays unassigned with nothing spent when no legal destination exists (Q2-B)', () => {
    const state = freshState('assign-affordance-none');
    businessAt(state, 0, 'Hardware Store', ['Service']);
    const barista = hire(state, 'staff-barista');
    state.actionsRemaining = 3;

    // No matching business ⇒ no destination is offered and nothing is spent.
    expect(buildMoveStaffAffordance(state, barista.id).enabled).toBe(false);
    expect(buildMoveStaffAffordance(state, barista.id).destinationSlots).toEqual([]);
    expect(canPlaceStaffOnBusiness(state, barista.id, 0).legal).toBe(false);
    expect(state.resourceBank.coins).toBe(2000);
    expect(state.staffCards.find(c => c.id === barista.id)!.employedAtSlot).toBeUndefined();
  });
});

// ── Undo/redo ──────────────────────────────────────────────

describe('assign is undoable and redoable', () => {
  it('undo restores the unassigned state; redo re-places the member', () => {
    const state = freshState('assign-undo');
    businessAt(state, 0, 'Bakery', ['Food']);
    const baker = hire(state, 'staff-baker');
    state.actionsRemaining = 1;

    const mgr = new UndoRedoManager();
    mgr.execute(placeStaffOnBusinessCommand(state, baker.id, 0));
    expect(state.staffCards.find(c => c.id === baker.id)!.employedAtSlot).toBe(0);
    expect(state.actionsRemaining).toBe(1); // free initial placement

    mgr.undo();
    // Snapshot restore replaces the state arrays — re-query by id.
    expect(state.staffCards.find(c => c.id === baker.id)!.employedAtSlot).toBeUndefined();
    expect(getEmployedStaffCountAt(state, 0)).toBe(0);
    expect(state.actionsRemaining).toBe(1);

    mgr.redo();
    expect(state.staffCards.find(c => c.id === baker.id)!.employedAtSlot).toBe(0);
    expect(getEmployedStaffCountAt(state, 0)).toBe(1);
    expect(state.actionsRemaining).toBe(1);
  });
});

// ── Lay-off stays available (AC3) ──────────────────────────

describe('lay-off stays available for unassigned business staff (MS-0MWEWIFNT001PUY0)', () => {
  it('dismisses an unassigned member from the roster surface with the same quoted cost as other doors', () => {
    const state = freshState('assign-layoff-unassigned');
    const baker = hire(state, 'staff-baker');

    // Today the roster classifies by runtime assignment, so the unassigned
    // member appears as a row; the row quotes the shared salary-scaled cost.
    const row = buildCompanyRoster(state).rows.find(r => r.memberId === baker.id)!;
    expect(row).toBeDefined();
    const coinsBefore = state.resourceBank.coins;
    const reputationBefore = state.resourceBank.reputation;

    const mgr = new UndoRedoManager();
    mgr.execute(letGoStaffCommand(state, row.staffIndex));

    expect(state.staffCards.some(c => c.id === baker.id)).toBe(false);
    expect(state.resourceBank.coins).toBe(Math.max(0, coinsBefore - row.layOffCoins));
    expect(state.resourceBank.reputation).toBe(Math.max(0, reputationBefore - row.layOffReputation));

    // Undo restores the member and the quoted costs.
    mgr.undo();
    expect(state.staffCards.some(c => c.id === baker.id)).toBe(true);
    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.resourceBank.reputation).toBe(reputationBefore);
    // The member remains unassigned (never placed by the lay-off round-trip).
    expect(state.staffCards.find(c => c.id === baker.id)!.employedAtSlot).toBeUndefined();
  });
});

// ── Save/load round-trips ──────────────────────────────────

describe('assign save/load round-trips', () => {
  it('a save with an assigned member round-trips identically', () => {
    const state = freshState('assign-save-assigned');
    businessAt(state, 0, 'Bakery', ['Food']);
    const baker = hire(state, 'staff-baker');
    placeStaffOnBusiness(state, baker.id, 0);

    const restored = deserializeMainStreetState(serializeMainStreetState(state));
    const member = restored.staffCards.find(c => c.id === baker.id)!;

    expect(member.employedAtSlot).toBe(0);
    expect(getEmployedStaffCountAt(restored, 0)).toBe(1);
  });

  it('a save with an unassigned business-staff member round-trips identically', () => {
    const state = freshState('assign-save-unassigned');
    const baker = hire(state, 'staff-baker');

    const restored = deserializeMainStreetState(serializeMainStreetState(state));
    const member = restored.staffCards.find(c => c.id === baker.id)!;

    expect(restored.staffCards).toHaveLength(1);
    expect(member.employedAtSlot).toBeUndefined();
    expect(getEmployedStaffCountAt(restored, 0)).toBe(0);
  });

  it('a legacy save with unassigned business staff loads unchanged and stays assignable', () => {
    const state = freshState('assign-save-legacy');
    businessAt(state, 0, 'Bakery', ['Food']);
    const baker = hire(state, 'staff-baker');

    const payload = serializeMainStreetState(state) as unknown as Record<string, unknown>;
    // A pre-assign-later save never carried the field on the member at all.
    for (const card of payload.staffCards as Array<Record<string, unknown>>) {
      delete card.employedAtSlot;
    }

    const restored = deserializeMainStreetState(
      payload as unknown as ReturnType<typeof serializeMainStreetState>,
    );
    const member = restored.staffCards.find(c => c.id === baker.id)!;

    // Loads unchanged: still hired, still unassigned — never silently
    // placed or cleared by the load.
    expect(member).toBeDefined();
    expect(member.employedAtSlot).toBeUndefined();
    expect(getEmployedStaffCountAt(restored, 0)).toBe(0);
    // And it remains assignable through the shared predicate.
    expect(canPlaceStaffOnBusiness(restored, member.id, 0).legal).toBe(true);
  });
});

// ── Single-player AI / Monte-Carlo hire-and-place (red-phase: MS-0MWEWIP02006VNFO) ──

describe('single-player AI hire-and-place for business staff (MS-0MWEWIP02006VNFO)', () => {
  /** One staff card in the row; a matching (or non-matching) business at slot 0. */
  function aiHireState(
    seed: string,
    idPrefix: string,
    withMatchingBusiness: boolean,
  ): MainStreetState {
    const state = freshState(seed);
    state.hand = [];
    state.actionsRemaining = 1;
    businessAt(state, 0, withMatchingBusiness ? 'Bakery' : 'Hardware Store',
      withMatchingBusiness ? ['Food'] : ['Service']);
    const card = offerInMarket(state, idPrefix);
    state.resourceBank.coins = card.cost + 50;
    return state;
  }

  it.fails('a business-staff hire places the member at a legal destination as part of the hire', () => {
    const state = aiHireState('ai-hire-place', 'staff-barista', true);
    const hireAction = enumerateLegalActions(state).find(
      (a): a is PlayerAction =>
        a.type === 'hire-staff' && (a as { cardId?: string }).cardId === 'staff-barista-0',
    );
    expect(hireAction).toBeDefined();

    executeAction(state, hireAction!);

    // The member ends up EMPLOYED at the (only) legal destination — today it
    // is hired unassigned and the salary is silently wasted (Q3-A).
    const member = state.staffCards.find(c => c.id === 'staff-barista-0')!;
    expect(member.employedAtSlot).toBe(0);
    expect(getEmployedStaffCountAt(state, 0)).toBe(1);
    expect(state.actionsRemaining).toBe(0); // one hire action, placement included
  });

  it.fails('a business-staff hire is not taken when no legal destination exists', () => {
    const state = aiHireState('ai-hire-skip', 'staff-barista', false);

    // Barista (Cafe/Food) cannot work anywhere on this board — the hire must
    // be skipped so an AI hire is never silently inert. Today the hire-staff
    // action is offered unconditionally.
    const hireAction = enumerateLegalActions(state).find(
      (a): a is PlayerAction =>
        a.type === 'hire-staff' && (a as { cardId?: string }).cardId === 'staff-barista-0',
    );
    expect(hireAction).toBeUndefined();
  });

  it('management-company hire in AI play stays available with no destination', () => {
    const state = aiHireState('ai-hire-mgmt', 'staff-assistant', false);
    const hireAction = enumerateLegalActions(state).find(
      (a): a is PlayerAction =>
        a.type === 'hire-staff' && (a as { cardId?: string }).cardId === 'staff-assistant-0',
    );
    expect(hireAction).toBeDefined();

    executeAction(state, hireAction!);
    expect(state.staffCards.some(c => c.id === 'staff-assistant-0')).toBe(true);
    expect(state.staffCards.find(c => c.id === 'staff-assistant-0')!.employedAtSlot).toBeUndefined();
  });

  it('the competitive AI stays staff-free (no staff actions enumerated)', () => {
    const state = createCompetitiveState({ seed: 'ai-comp-staff-free', playerCount: 2 });
    executeCompetitiveWeekStart(state);
    state.market.cards = [template('staff-assistant')];
    for (const p of state.players ?? []) p.coins += 2000;

    const actions = enumerateCompetitiveLegalActions(state, 0);
    expect(actions.some(a => (a as PlayerAction).type === 'hire-staff')).toBe(false);
    expect(actions.some(a => (a as PlayerAction).type === 'peek-incident-deck')).toBe(false);
  });
});
