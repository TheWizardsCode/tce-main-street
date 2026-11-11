/**
 * Main Street: Competitive staff ownership matrix (MS-0MWBCW80F007PJ5M)
 *
 * Parent: `MS-0MWBB146L005SU31` — *Player hired staff, staff went to AI
 * business*. This is the parent's test-first (tracer-bullet) child: it pins
 * the owned/unowned matrix as an executable specification **before** any
 * engine change, so the implementation children
 * (`MS-0MWBCWLZY001EA3W` placement gate, `MS-0MWBCWVYC007F6VJ` applicant
 * resolution, `MS-0MWBCX7MS00960BH` save repair) have a red→green contract.
 *
 * ## Matrix
 *
 * Every case runs against the competitive row (shared, owner-tagged street,
 * built on `buildHumanVsAis`) and, where meaningful, the single-player row
 * (`ownerTaggedGrid` absent → the ownership gate must stay a no-op):
 *
 * - **Applicant targeting** — a triggered applicant's `targetSlotIndex` is
 *   always a slot owned by the acting seat that has a free employment slot;
 *   when the acting seat owns no such business, no applicant appears.
 * - **Applicant chance** — `computeApplicantChance` ignores opponent-owned
 *   businesses' income/reputation.
 * - **Type-match pool** — an opponent-owned business does not unlock a
 *   specialist the acting seat cannot employ.
 * - **Placement** — `canPlaceStaffOnBusiness` / `placeStaffOnBusiness` reject
 *   an opponent-owned destination with the shared
 *   `That business belongs to <seat>.` reason.
 * - **Relocation** — `canMoveStaffOnBusiness` / `moveStaffOnBusiness` reject
 *   it and `buildMoveStaffAffordance` does not offer it as a destination.
 * - **Write-path guards** — `hireStaffApplicant` refuses to employ an
 *   applicant at an opponent-owned business even though it never runs the
 *   placement legality helper (`placeStaffOnBusiness` / `moveStaffOnBusiness`
 *   go through the gate itself, covered by the placement/relocation cases).
 * - **Save repair** — a save carrying player staff employed at another seat's
 *   business is repaired on load, keeps the member hired, logs the release,
 *   and is idempotent across repeated load/save round-trips.
 *
 * ## Red phase (`it.fails`)
 *
 * Per the repo's test-first tracer-bullet convention (see
 * `income-owner-flight-routing.test.ts`, `competitive-seat-anchors.test.ts`),
 * the cases that pin the *missing* ownership rules are authored **red-phase**
 * with `it.fails`: they FAIL against today's engine, and a passing `it.fails`
 * is the machine-checked record of that red baseline. The implementation
 * children flip each `it.fails` to a plain `it` as their slice lands — leaving
 * one as `it.fails` afterwards is itself a failure, so the matrix cannot go
 * stale. Cases that already hold today (every single-player regression) are
 * plain `it` so they keep protecting the unchanged behaviour through the
 * change.
 *
 * Determinism: every case uses a fixture seed and/or a stubbed `state.rng`;
 * no wall-clock reads, no unseeded randomness, no sleeps.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import {
  setupMainStreetGame,
  serializeMainStreetState,
  deserializeMainStreetState,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  createStaffDeck,
  type BusinessCard,
  type StaffCard,
  type SynergyType,
} from '../../src/MainStreetCards';
import {
  executeWeekStart,
  computeApplicantChance,
  resolveStaffApplicant,
  hireStaffApplicant,
  canPlaceStaffOnBusiness,
  placeStaffOnBusiness,
  canMoveStaffOnBusiness,
  moveStaffOnBusiness,
  getEmployedStaffCountAt,
} from '../../src/MainStreetEngine';
import { getSlotOwnerId } from '../../src/MainStreetAdjacencyOwner';
import { buildMoveStaffAffordance } from '../../src/scenes/MainStreetHudTooltips';
import { buildHumanVsAis } from './helpers/competitive-fixtures';

// ── Fixtures ────────────────────────────────────────────────

/** Deterministic business fixture; `id` includes the owner so saves are stable. */
function makeBusiness(
  slot: number,
  name: string,
  synergy: SynergyType[],
  baseIncome = 3,
): BusinessCard {
  return {
    family: 'business',
    id: `biz-own-${slot}`,
    name,
    cost: 3,
    baseIncome,
    synergyTypes: [...synergy],
    maxLevel: 0,
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    description: 'Staff ownership matrix fixture.',
    ongoingCost: 0,
    employedStaff: [],
  };
}

/**
 * Places a business at a slot and, when the state is competitive, tags its
 * owner (`ownerTaggedGrid` stays in sync with `streetGrid`, as in real play).
 */
function placeBusinessAt(
  state: MainStreetState,
  slot: number,
  ownerId: number,
  name: string,
  synergy: SynergyType[],
  baseIncome = 3,
): BusinessCard {
  const biz = makeBusiness(slot, name, synergy, baseIncome);
  state.streetGrid[slot] = biz;
  if (state.ownerTaggedGrid) state.ownerTaggedGrid[slot] = { card: biz, ownerId };
  return biz;
}

let staffSerial = 0;
/**
 * Hires a staff template into `state.staffCards` with a unique id and no
 * specialisation skills (so no extra `state.rng` draws happen anywhere).
 */
function hire(state: MainStreetState, idPrefix: string): StaffCard {
  const tpl = createStaffDeck(1).find(c => c.id.startsWith(idPrefix));
  if (!tpl) throw new Error(`No staff template matching ${idPrefix}`);
  const card: StaffCard = {
    ...tpl,
    id: `${tpl.id}-own-${staffSerial++}`,
    specializationSkillIds: [],
  };
  state.staffCards.push(card);
  return card;
}

/** Builds a deck card (no side effects) for the applicant type-pool cases. */
function deckCard(idPrefix: string): StaffCard {
  const tpl = createStaffDeck(1).find(c => c.id.startsWith(idPrefix));
  if (!tpl) throw new Error(`No staff template matching ${idPrefix}`);
  return { ...tpl, id: `${tpl.id}-deck`, specializationSkillIds: [] };
}

/** Two-seat competitive state (human seat 0 + one AI) with the human acting. */
function competitiveState(seed: string): MainStreetState {
  const state = buildHumanVsAis(seed, 1, [
    [1000, 0],
    [1000, 0],
  ]);
  state.activePlayerId = 0;
  state.actionsRemaining = 3;
  expect(state.ownerTaggedGrid).toBeDefined();
  return state;
}

/** Single-player state in MarketPhase (no `ownerTaggedGrid`). */
function soloState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed });
  executeWeekStart(state);
  expect(state.ownerTaggedGrid).toBeUndefined();
  return state;
}

// ── Applicant targeting ─────────────────────────────────────

describe('applicant targeting: only the acting seat’s own businesses', () => {
  it.fails(
    'competitive: a triggered applicant targets a slot the acting seat owns',
    () => {
      const state = competitiveState('staff-own-target');
      // AI seat owns slot 0 (the first slot today's unfiltered picker sees);
      // the human seat owns slot 2.
      placeBusinessAt(state, 0, 1, 'Cafe', ['Food']);
      placeBusinessAt(state, 2, 0, 'Bakery', ['Food']);
      state.decks.staff = [deckCard('staff-customer-rep')];
      state.rng = () => 0; // roll 0 → trigger, picker index 0, deck index 0
      state.forcedStaffApplicant = false;

      resolveStaffApplicant(state);

      const pending = state.pendingApplicant;
      expect(pending).not.toBeNull();
      expect(pending!.targetSlotIndex).toBe(2);
      expect(getSlotOwnerId(state, pending!.targetSlotIndex)).toBe(0);
    },
  );

  it.fails(
    'competitive: no applicant appears when the acting seat owns no business with a free slot',
    () => {
      const state = competitiveState('staff-own-target-none');
      const aiBusiness = placeBusinessAt(state, 0, 1, 'Cafe', ['Food']);
      const ownBusiness = placeBusinessAt(state, 2, 0, 'Bakery', ['Food']);
      // Fill the acting seat's only business to capacity; the AI business
      // still has a free employment slot.
      const ownMember = hire(state, 'staff-chef');
      ownMember.employedAtSlot = 2;
      ownBusiness.employedStaff = [ownMember];
      expect(getEmployedStaffCountAt(state, 0)).toBe(0);
      expect(aiBusiness.employedStaff).toHaveLength(0);
      state.forcedStaffApplicant = true; // bypass the roll, not the eligibility guard

      resolveStaffApplicant(state);

      expect(state.pendingApplicant).toBeNull();
    },
  );

  it('single-player: a triggered applicant still targets the player’s own business', () => {
    const state = soloState('staff-own-target-solo');
    placeBusinessAt(state, 2, 0, 'Bakery', ['Food']);
    state.decks.staff = [deckCard('staff-customer-rep')];
    state.rng = () => 0;

    resolveStaffApplicant(state);

    expect(state.pendingApplicant).not.toBeNull();
    expect(state.pendingApplicant!.targetSlotIndex).toBe(2);
  });
});

// ── Applicant chance ────────────────────────────────────────

describe('applicant chance: opponent businesses do not raise the acting seat’s odds', () => {
  it.fails(
    'competitive: computeApplicantChance sums only the acting seat’s own businesses',
    () => {
      const state = competitiveState('staff-own-chance');
      placeBusinessAt(state, 0, 1, 'Cafe', ['Food'], 9); // opponent-owned, high income
      placeBusinessAt(state, 2, 0, 'Gym', ['Health'], 2); // acting seat-owned

      // Only the acting seat's own business contributes: 2, not 11.
      expect(computeApplicantChance(state)).toBe(2);
    },
  );

  it('single-player: computeApplicantChance still sums every placed business', () => {
    const state = soloState('staff-own-chance-solo');
    placeBusinessAt(state, 0, 0, 'Cafe', ['Food'], 9);
    placeBusinessAt(state, 2, 0, 'Gym', ['Health'], 2);

    expect(computeApplicantChance(state)).toBe(11);
  });
});

// ── Applicant type-match pool ───────────────────────────────

describe('applicant type pool: opponent businesses do not unlock an unusable specialist', () => {
  it.fails(
    'competitive: only specialists the acting seat can employ stay in the pool',
    () => {
      const state = competitiveState('staff-own-pool');
      placeBusinessAt(state, 0, 1, 'Cafe', ['Food'], 9); // AI-owned: unlocks the Chef
      placeBusinessAt(state, 2, 0, 'Gym', ['Health'], 3); // acting seat cannot employ a Chef
      const chef = deckCard('staff-chef'); // allowed: Cafe|Diner|Food|Delicatessen
      const generalist = deckCard('staff-customer-rep'); // allowed: all six types
      state.decks.staff = [chef, generalist];
      state.rng = () => 0; // roll 0 → trigger; picker index 0; deck index 0
      state.forcedStaffApplicant = false;

      resolveStaffApplicant(state);

      expect(state.pendingApplicant).not.toBeNull();
      expect(state.pendingApplicant!.card.id).toBe(generalist.id);
    },
  );

  it.fails(
    'competitive: no applicant appears when only an opponent business matches the deck',
    () => {
      const state = competitiveState('staff-own-pool-empty');
      placeBusinessAt(state, 0, 1, 'Cafe', ['Food'], 9);
      placeBusinessAt(state, 2, 0, 'Gym', ['Health'], 3);
      state.decks.staff = [deckCard('staff-chef')];
      state.rng = () => 0;
      state.forcedStaffApplicant = false;

      resolveStaffApplicant(state);

      expect(state.pendingApplicant).toBeNull();
    },
  );

  it('single-player: a specialist matching any deployed business stays available', () => {
    const state = soloState('staff-own-pool-solo');
    placeBusinessAt(state, 0, 0, 'Cafe', ['Food'], 3);
    const chef = deckCard('staff-chef');
    state.decks.staff = [chef];
    state.rng = () => 0;

    resolveStaffApplicant(state);

    expect(state.pendingApplicant).not.toBeNull();
    expect(state.pendingApplicant!.card.id).toBe(chef.id);
  });
});

// ── Placement ───────────────────────────────────────────────

describe('placement: opponent-owned destinations are rejected', () => {
  it.fails(
    'competitive: canPlaceStaffOnBusiness rejects an opponent-owned destination with the owner-naming reason',
    () => {
      const state = competitiveState('staff-own-place');
      placeBusinessAt(state, 0, 0, 'Bakery', ['Food']);
      placeBusinessAt(state, 2, 1, 'Diner', ['Food']);
      const chef = hire(state, 'staff-chef');

      const legality = canPlaceStaffOnBusiness(state, chef.id, 2);

      expect(legality.legal).toBe(false);
      expect((legality as { reason?: string }).reason ?? '').toMatch(
        /That business belongs to AI 1\./,
      );
    },
  );

  it.fails(
    'competitive: placeStaffOnBusiness throws and persists no employment at an opponent-owned business',
    () => {
      const state = competitiveState('staff-own-place-write');
      placeBusinessAt(state, 0, 0, 'Bakery', ['Food']);
      placeBusinessAt(state, 2, 1, 'Diner', ['Food']);
      const chef = hire(state, 'staff-chef');

      expect(() => placeStaffOnBusiness(state, chef.id, 2)).toThrow(
        /That business belongs to AI 1\./,
      );
      expect(state.staffCards.find(c => c.id === chef.id)!.employedAtSlot).toBeUndefined();
      expect(getEmployedStaffCountAt(state, 2)).toBe(0);
    },
  );

  it('single-player: the same destination stays legal and placeable', () => {
    const state = soloState('staff-own-place-solo');
    placeBusinessAt(state, 0, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 2, 0, 'Diner', ['Food']);
    const chef = hire(state, 'staff-chef');

    expect(canPlaceStaffOnBusiness(state, chef.id, 2).legal).toBe(true);
    placeStaffOnBusiness(state, chef.id, 2);
    expect(chef.employedAtSlot).toBe(2);
    expect(getEmployedStaffCountAt(state, 2)).toBe(1);
  });
});

// ── Relocation ──────────────────────────────────────────────

describe('relocation: opponent-owned destinations are rejected and never offered', () => {
  it.fails(
    'competitive: canMoveStaffOnBusiness rejects an opponent-owned destination',
    () => {
      const state = competitiveState('staff-own-move');
      placeBusinessAt(state, 0, 0, 'Bakery', ['Food']);
      placeBusinessAt(state, 2, 1, 'Diner', ['Food']);
      const chef = hire(state, 'staff-chef');
      placeStaffOnBusiness(state, chef.id, 0);

      const legality = canMoveStaffOnBusiness(state, chef.id, 2);

      expect(legality.legal).toBe(false);
      expect((legality as { reason?: string }).reason ?? '').toMatch(
        /That business belongs to AI 1\./,
      );
    },
  );

  it.fails(
    'competitive: moveStaffOnBusiness throws and keeps the member at its own business',
    () => {
      const state = competitiveState('staff-own-move-write');
      placeBusinessAt(state, 0, 0, 'Bakery', ['Food']);
      placeBusinessAt(state, 2, 1, 'Diner', ['Food']);
      const chef = hire(state, 'staff-chef');
      placeStaffOnBusiness(state, chef.id, 0);

      expect(() => moveStaffOnBusiness(state, chef.id, 2)).toThrow(
        /That business belongs to AI 1\./,
      );
      expect(state.staffCards.find(c => c.id === chef.id)!.employedAtSlot).toBe(0);
      expect(getEmployedStaffCountAt(state, 0)).toBe(1);
      expect(getEmployedStaffCountAt(state, 2)).toBe(0);
    },
  );

  it.fails(
    'competitive: buildMoveStaffAffordance excludes opponent-owned destinations but keeps the acting seat’s own',
    () => {
      const state = competitiveState('staff-own-affordance');
      placeBusinessAt(state, 0, 0, 'Bakery', ['Food']);
      placeBusinessAt(state, 2, 1, 'Diner', ['Food']); // opponent-owned
      placeBusinessAt(state, 3, 0, 'Diner', ['Food']); // acting seat-owned
      const chef = hire(state, 'staff-chef');
      placeStaffOnBusiness(state, chef.id, 0);

      const affordance = buildMoveStaffAffordance(state, chef.id);

      expect(affordance.destinationSlots).not.toContain(2);
      expect(affordance.destinationSlots).toContain(3);
    },
  );

  it('single-player: the same relocation stays legal and is offered', () => {
    const state = soloState('staff-own-move-solo');
    placeBusinessAt(state, 0, 0, 'Bakery', ['Food']);
    placeBusinessAt(state, 2, 0, 'Diner', ['Food']);
    const chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, chef.id, 0);

    expect(canMoveStaffOnBusiness(state, chef.id, 2).legal).toBe(true);
    expect(buildMoveStaffAffordance(state, chef.id).destinationSlots).toContain(2);
    moveStaffOnBusiness(state, chef.id, 2);
    expect(state.staffCards.find(c => c.id === chef.id)!.employedAtSlot).toBe(2);
  });
});

// ── Write-path guard ────────────────────────────────────────

describe('write-path guard: the applicant hire path names the real owner', () => {
  it.fails(
    'competitive: hireStaffApplicant refuses an applicant targeted at an opponent-owned business',
    () => {
      const state = competitiveState('staff-own-hire-guard');
      placeBusinessAt(state, 0, 0, 'Bakery', ['Food']);
      placeBusinessAt(state, 2, 1, 'Diner', ['Food']); // opponent-owned, free slot
      const applicant = deckCard('staff-chef');
      state.pendingApplicant = { card: applicant, targetSlotIndex: 2 };

      expect(() => hireStaffApplicant(state)).toThrow(/AI 1/);
      expect(getEmployedStaffCountAt(state, 2)).toBe(0);
      expect(state.staffCards.some(c => c.id === applicant.id)).toBe(false);
    },
  );
});

// ── Save repair ─────────────────────────────────────────────

describe('save repair: cross-seat employment is released on load', () => {
  it.fails(
    'competitive: a save carrying player staff at another seat’s business is repaired on load',
    () => {
      const state = competitiveState('staff-own-save-repair');
      placeBusinessAt(state, 0, 0, 'Bakery', ['Food']);
      const opponentBusiness = placeBusinessAt(state, 2, 1, 'Diner', ['Food']);
      // Legacy invalid state: the player's hired member employed at the AI's
      // business (exactly the bug this parent fixes).
      const chef = hire(state, 'staff-chef');
      chef.employedAtSlot = 2;
      opponentBusiness.employedStaff = [chef];
      expect(getEmployedStaffCountAt(state, 2)).toBe(1);

      const restored = deserializeMainStreetState(serializeMainStreetState(state));

      const member = restored.staffCards.find(c => c.id === chef.id);
      expect(member).toBeDefined();
      // Released from the opponent's business...
      expect(member!.employedAtSlot).toBeUndefined();
      expect(getEmployedStaffCountAt(restored, 2)).toBe(0);
      // ...but still the player's hired staff, with the release logged.
      expect(restored.staffCards.some(c => c.id === chef.id)).toBe(true);
      expect(
        restored.activityLog.some(entry => entry.text.includes(member!.name)),
      ).toBe(true);
    },
  );

  it.fails(
    'competitive: the load-time repair is idempotent across repeated round-trips',
    () => {
      const state = competitiveState('staff-own-save-repair-idempotent');
      placeBusinessAt(state, 0, 0, 'Bakery', ['Food']);
      const opponentBusiness = placeBusinessAt(state, 2, 1, 'Diner', ['Food']);
      const chef = hire(state, 'staff-chef');
      chef.employedAtSlot = 2;
      opponentBusiness.employedStaff = [chef];

      const once = deserializeMainStreetState(serializeMainStreetState(state));
      const member = once.staffCards.find(c => c.id === chef.id)!;
      expect(member.employedAtSlot).toBeUndefined();
      const repairEntries = once.activityLog.filter(entry =>
        entry.text.includes(member.name),
      );
      expect(repairEntries).toHaveLength(1);

      const twice = deserializeMainStreetState(serializeMainStreetState(once));
      const twiceMember = twice.staffCards.find(c => c.id === chef.id)!;
      expect(twiceMember.employedAtSlot).toBeUndefined();
      expect(getEmployedStaffCountAt(twice, 2)).toBe(0);
      expect(
        twice.activityLog.filter(entry => entry.text.includes(twiceMember.name)),
      ).toHaveLength(1);
    },
  );

  it('single-player: employed staff round-trip unchanged (no repair)', () => {
    const state = soloState('staff-own-save-solo');
    const business = placeBusinessAt(state, 0, 0, 'Bakery', ['Food']);
    const chef = hire(state, 'staff-chef');
    placeStaffOnBusiness(state, chef.id, 0);
    const logLengthBefore = state.activityLog.length;

    const restored = deserializeMainStreetState(serializeMainStreetState(state));

    const member = restored.staffCards.find(c => c.id === chef.id)!;
    expect(member.employedAtSlot).toBe(0);
    expect(getEmployedStaffCountAt(restored, 0)).toBe(1);
    expect(((restored.streetGrid[0] as BusinessCard).employedStaff ?? []).length).toBe(1);
    expect(business.employedStaff).toHaveLength(1);
    expect(restored.activityLog).toHaveLength(logLengthBefore);
  });
});

// ── Determinism ─────────────────────────────────────────────

describe('determinism: the whole matrix is seeded', () => {
  it('the competitive applicant scenario produces the same result on repeated runs', () => {
    function run(seed: string): { slot: number; id: string } | null {
      const state = competitiveState(seed);
      placeBusinessAt(state, 0, 1, 'Cafe', ['Food'], 9);
      placeBusinessAt(state, 2, 0, 'Bakery', ['Food'], 2);
      state.decks.staff = [deckCard('staff-customer-rep')];
      state.rng = () => 0;
      state.forcedStaffApplicant = false;
      resolveStaffApplicant(state);
      return state.pendingApplicant
        ? {
            slot: state.pendingApplicant.targetSlotIndex,
            id: state.pendingApplicant.card.id,
          }
        : null;
    }

    expect(run('staff-own-determinism')).toEqual(run('staff-own-determinism'));
  });
});
