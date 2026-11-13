/**
 * Main Street: business-staff row model specification
 * (MS-0MWCB2YH60070QEW, parent MS-0MWC952QU000HQ11).
 *
 * Pins the contract of the **not-yet-existing** pure model
 * (`src/MainStreetBusinessStaff.ts`, sibling item MS-0MWCB2Z20006R9FA)
 * before it is implemented, so the Manage Card's rows, salaries and lay-off
 * quote cannot drift from what the engine actually charges:
 *
 *   AC1  Rows: exactly one row per member employed at the slot
 *        (`employedAtSlot === slotIndex`), in hire order (`staffCards`
 *        order); the row resolves the member's effective salary through the
 *        engine helpers, clamps the lay-off coins at 0 and quotes reputation
 *        from the shared formula; each row is addressed by `memberId`.
 *   AC2  Quoted == charged: the confirm step's figures equal what
 *        `letGoStaffMember()` actually deducts when the lay-off runs on a
 *        cloned state — including a discounted-salary member whose effective
 *        salary differs from its raw `ongoingCost`.
 *   AC3  Membership: management-company staff (no `employedAtSlot`) never
 *        appear in a business's rows; a member employed at a different slot
 *        is excluded.
 *   AC4  Staleness: a row whose member id is no longer present in
 *        `state.staffCards` resolves to "gone" — no index is handed to
 *        `letGoStaffCommand` — instead of silently addressing a shifted
 *        index.
 *   AC5  Empty: `businessStaffIsEmpty(state, slotIndex)` is true and
 *        `buildBusinessStaffRows` returns `[]` when nobody is employed at
 *        the slot, and false / non-empty otherwise.
 *
 * The model module does not exist yet, so this suite fails for the right
 * reason (the module or its exports are absent) — the red pin that the model
 * item turns green.
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
import { letGoStaffMember } from '../../src/MainStreetEngine';
import { createStaffDeck, type BusinessCard, type StaffCard } from '../../src/MainStreetCards';
import { layOffReputationCost } from '../../src/MainStreetRoster';
import {
  buildBusinessStaffRows,
  businessStaffIsEmpty,
  buildLayOffConfirmContent,
} from '../../src/MainStreetBusinessStaff';

// ── Fixtures ────────────────────────────────────────────────

/** A business-staff member employed at the given slot (business staff by `employedAtSlot`). */
function businessMember(
  id: string,
  ongoingCost: number,
  slot = 0,
  skillIds: readonly string[] = [],
): StaffCard {
  const template = createStaffDeck(1)[0]!;
  return {
    ...template,
    id,
    name: id,
    specializationSkillIds: [...skillIds],
    ongoingCost,
    employedAtSlot: slot,
  };
}

/** A management-company member (no `employedAtSlot`). */
function managementMember(id: string, ongoingCost: number): StaffCard {
  const template = createStaffDeck(1)[0]!;
  return {
    ...template,
    id,
    name: id,
    specializationSkillIds: [],
    ongoingCost,
  };
}

/** Places a business at `slot` (capacity = `level + 1`, at least 1). */
function placeBusiness(state: MainStreetState, slot: number, level = 1): BusinessCard {
  const biz: BusinessCard = {
    family: 'business',
    id: `biz-staff-selection-${slot}`,
    name: `Manage Card Bistro ${slot}`,
    cost: 3,
    baseIncome: 2,
    synergyTypes: ['Food'],
    maxLevel: 2,
    level,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    description: 'Business-staff selection fixture.',
    ongoingCost: 1,
    employedStaff: [],
  };
  state.streetGrid[slot] = biz;
  return biz;
}

/**
 * The id-addressing contract the Manage Card applies on row click: resolve
 * the row's `memberId` against the live `state.staffCards`. `-1` means the
 * member is gone — no index is handed to `letGoStaffCommand`.
 */
function resolveRowToLiveIndex(state: MainStreetState, row: { memberId: string }): number {
  return state.staffCards.findIndex((m) => m.id === row.memberId);
}

// ── AC1 + AC3: membership, ordering, salary, clamp, quote, id ─

describe('AC1/AC3: buildBusinessStaffRows membership, ordering and row figures', () => {
  it('returns exactly one row per member employed at the slot, in hire order', () => {
    const state = setupMainStreetGame({ seed: 'biz-staff-rows-membership' });
    placeBusiness(state, 0, 1); // capacity 2 — the case needs no more
    state.staffCards = [
      managementMember('mgmt-outside', 50),
      businessMember('biz-first', 120, 0),
      businessMember('biz-second', 250, 0),
      businessMember('biz-other-slot', 300, 2),
    ];

    const rows = buildBusinessStaffRows(state, 0);

    // Exactly the slot-0 members, oldest hire first (staffCards order);
    // management-company staff and a member of another slot never appear.
    expect(rows.map((r) => r.memberId)).toEqual(['biz-first', 'biz-second']);
    expect(rows.some((r) => r.memberId === 'mgmt-outside')).toBe(false);
    expect(rows.some((r) => r.memberId === 'biz-other-slot')).toBe(false);
  });

  it('exposes the full row contract for each member', () => {
    const state = setupMainStreetGame({ seed: 'biz-staff-rows-contract' });
    placeBusiness(state, 0, 1);
    state.staffCards = [businessMember('biz-row', 100, 0)];

    const [row] = buildBusinessStaffRows(state, 0);

    expect(row).toMatchObject({
      memberId: 'biz-row',
      name: 'biz-row',
      roleSummary: expect.any(String),
      salary: expect.any(Number),
      layOffCoins: expect.any(Number),
      layOffReputation: expect.any(Number),
    });
    expect(row.roleSummary.length).toBeGreaterThan(0);
  });

  it('resolves each row salary through the engine helpers (discount applied)', () => {
    const state = setupMainStreetGame({ seed: 'biz-staff-rows-salary' });
    placeBusiness(state, 0, 1);
    // The Operations Manager discount (−50) is business-scoped, so the
    // business-staff member's effective salary differs from its raw cost.
    state.staffCards = [
      businessMember('biz-ops', 300, 0, ['skill-operations-manager']),
      businessMember('biz-plain', 150, 0),
    ];

    const rows = buildBusinessStaffRows(state, 0);

    expect(rows[0]!.salary).toBe(250); // 300 − 50 Operations Manager
    expect(rows[0]!.salary).not.toBe(300); // differs from the raw ongoingCost
    expect(rows[1]!.salary).toBe(150);
  });

  it('clamps the lay-off coins at 0 alongside a clamped salary', () => {
    const state = setupMainStreetGame({ seed: 'biz-staff-rows-clamp' });
    placeBusiness(state, 0, 1);
    state.staffCards = [
      businessMember('biz-zero', 0, 0),
      businessMember('biz-discounted-zero', 40, 0, ['skill-operations-manager']),
    ];

    const rows = buildBusinessStaffRows(state, 0);

    for (const row of rows) {
      expect(row.salary).toBeGreaterThanOrEqual(0);
      expect(row.layOffCoins).toBe(Math.max(0, row.salary));
    }
  });

  it('quotes layOffReputation from the shared formula, never re-derived', () => {
    const state = setupMainStreetGame({ seed: 'biz-staff-rows-reputation' });
    placeBusiness(state, 0, 1);
    state.staffCards = [
      businessMember('biz-zero', 0, 0),
      businessMember('biz-mid', 150, 0),
      businessMember('biz-high', 500, 0),
    ];

    const rows = buildBusinessStaffRows(state, 0);

    for (const row of rows) {
      expect(row.layOffReputation).toBe(layOffReputationCost(row.salary));
    }
    expect(rows.map((r) => r.layOffReputation)).toEqual([100, 200, 500]);
  });

  it('carries the shared role/benefit summary in every row', () => {
    const state = setupMainStreetGame({ seed: 'biz-staff-rows-role' });
    placeBusiness(state, 0, 1);
    state.staffCards = [
      {
        ...businessMember('biz-role', 100, 0),
        description: 'Adds +2 hand slots.',
      },
    ];

    const [row] = buildBusinessStaffRows(state, 0);

    expect(row.roleSummary).toContain('Adds +2 hand slots.');
  });
});

// ── AC2: quoted == charged (engine-first on a cloned state) ─

describe('AC2: the confirm quote equals what letGoStaffMember charges', () => {
  it('charges exactly the row layOffCoins / layOffReputation for a discounted-salary member', () => {
    const state = setupMainStreetGame({ seed: 'biz-staff-quoted-charged' });
    placeBusiness(state, 0, 1);
    state.resourceBank.coins = 5000;
    state.resourceBank.reputation = 5000;
    state.staffCards = [
      businessMember('biz-dc', 300, 0, ['skill-operations-manager']), // effective salary 250
      businessMember('biz-plain', 150, 0),
    ];

    const rows = buildBusinessStaffRows(state, 0);
    const discounted = rows.find((r) => r.memberId === 'biz-dc')!;

    // Engine-first: run the lay-off on a clone and compare deltas with the quote.
    const clone = deserializeMainStreetState(serializeMainStreetState(state));
    const liveIndex = resolveRowToLiveIndex(clone, discounted);
    expect(liveIndex).toBeGreaterThanOrEqual(0);
    const before = {
      coins: clone.resourceBank.coins,
      reputation: clone.resourceBank.reputation,
    };
    letGoStaffMember(clone, liveIndex);
    const coinsCharged = before.coins - clone.resourceBank.coins;
    const reputationCharged = before.reputation - clone.resourceBank.reputation;

    // The discounted salary differs from the raw ongoing cost, and the engine
    // deducted exactly the row's effective-salary figures.
    expect(discounted.salary).not.toBe(300);
    expect(discounted.salary).toBe(250);
    expect(coinsCharged).toBe(discounted.layOffCoins);
    expect(reputationCharged).toBe(discounted.layOffReputation);
    expect(discounted.layOffReputation).toBe(layOffReputationCost(discounted.salary));
  });

  it('charges exactly the quoted figures for a plain member too', () => {
    const state = setupMainStreetGame({ seed: 'biz-staff-quoted-plain' });
    placeBusiness(state, 0, 1);
    state.resourceBank.coins = 5000;
    state.resourceBank.reputation = 5000;
    state.staffCards = [
      businessMember('biz-a', 400, 0),
      businessMember('biz-b', 90, 0),
    ];

    for (const row of buildBusinessStaffRows(state, 0)) {
      const clone = deserializeMainStreetState(serializeMainStreetState(state));
      const liveIndex = resolveRowToLiveIndex(clone, row);
      const before = {
        coins: clone.resourceBank.coins,
        reputation: clone.resourceBank.reputation,
      };
      letGoStaffMember(clone, liveIndex);
      expect(before.coins - clone.resourceBank.coins).toBe(row.layOffCoins);
      expect(before.reputation - clone.resourceBank.reputation).toBe(row.layOffReputation);
    }
  });

  it('the engine clamps the coin deduction at 0 while the row quotes the real salary', () => {
    const state = setupMainStreetGame({ seed: 'biz-staff-quoted-clamp' });
    placeBusiness(state, 0, 1);
    state.resourceBank.coins = 30; // less than the member's salary
    state.resourceBank.reputation = 5000;
    state.staffCards = [businessMember('biz-expensive', 500, 0)];

    const [row] = buildBusinessStaffRows(state, 0);
    expect(row.layOffCoins).toBe(500);
    expect(row.layOffReputation).toBe(layOffReputationCost(500));

    letGoStaffMember(state, 0);
    expect(state.resourceBank.coins).toBe(0); // clamped — never negative
    expect(state.resourceBank.reputation).toBe(5000 - 500);
  });

  it('the confirm content quotes the member name, coins and reputation from the row', () => {
    const state = setupMainStreetGame({ seed: 'biz-staff-quoted-content' });
    placeBusiness(state, 0, 1);
    state.staffCards = [businessMember('biz-confirm', 250, 0)];

    const [row] = buildBusinessStaffRows(state, 0);
    const content = buildLayOffConfirmContent(row);
    expect(content).toMatchObject({ title: expect.any(String), body: expect.any(String) });

    // The quoted figures are the row's own economics — the same numbers the
    // engine deducts (quoted == charged).
    expect(content.title).toContain('biz-confirm');
    expect(content.body).toContain(String(row.layOffCoins));
    expect(content.body).toContain(String(row.layOffReputation));
    expect(row.layOffCoins).toBe(250);
    expect(row.layOffReputation).toBe(300);
  });
});

// ── AC4: id-addressing and staleness ───────────────────────

describe('AC4: rows address members by id and stale ids resolve to gone', () => {
  it('a row whose member id is gone resolves to "gone" — never a shifted index', () => {
    const state = setupMainStreetGame({ seed: 'biz-staff-stale' });
    placeBusiness(state, 0, 1);
    state.staffCards = [
      businessMember('biz-first', 120, 0),
      businessMember('biz-second', 200, 0),
    ];

    const rowsBefore = buildBusinessStaffRows(state, 0);
    expect(rowsBefore.map((r) => r.memberId)).toEqual(['biz-first', 'biz-second']);

    // Lay off the first member: the second shifts from live index 1 to 0.
    letGoStaffMember(state, 0);

    // A stale row for the removed member no longer exists in staffCards — an
    // id lookup yields no live index, so no index reaches letGoStaffCommand.
    const staleRow = rowsBefore.find((r) => r.memberId === 'biz-first')!;
    expect(resolveRowToLiveIndex(state, staleRow)).toBe(-1);
    // The shifted positional index would have addressed the WRONG member.
    expect(state.staffCards[0]!.id).toBe('biz-second');

    // A freshly rebuilt row for the survivor still id-addressed correctly.
    const rowsAfter = buildBusinessStaffRows(state, 0);
    const survivorRow = rowsAfter.find((r) => r.memberId === 'biz-second')!;
    const liveIndex = resolveRowToLiveIndex(state, survivorRow);
    expect(liveIndex).toBe(0);
    // And letting the survivor go through its live index works end-to-end.
    const beforeCoins = state.resourceBank.coins;
    letGoStaffMember(state, liveIndex);
    expect(state.resourceBank.coins).toBe(beforeCoins - survivorRow.layOffCoins);
  });
});

// ── AC5: the empty case ────────────────────────────────────

describe('AC5: businessStaffIsEmpty and the empty rows case', () => {
  it('is true and yields [] when nobody is employed at the slot', () => {
    const state = setupMainStreetGame({ seed: 'biz-staff-empty' });
    placeBusiness(state, 0, 1);
    state.staffCards = [managementMember('mgmt-only', 100)];

    expect(businessStaffIsEmpty(state, 0)).toBe(true);
    expect(buildBusinessStaffRows(state, 0)).toEqual([]);
  });

  it('is false and non-empty when a member is employed at the slot', () => {
    const state = setupMainStreetGame({ seed: 'biz-staff-not-empty' });
    placeBusiness(state, 0, 1);
    state.staffCards = [businessMember('biz-only', 100, 0)];

    expect(businessStaffIsEmpty(state, 0)).toBe(false);
    expect(buildBusinessStaffRows(state, 0)).toHaveLength(1);
  });
});
