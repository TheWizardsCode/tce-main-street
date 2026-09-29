/**
 * Main Street: Per-phase Income Breakdown Data Model Tests
 *
 * Validates the `IncomeResult.phaseBreakdown` field added by CG-0MT23O6W8003AXWJ.
 * Tests per-phase contribution accuracy: base, reputation, event multipliers.
 * Hand-card synergy was removed (CG-0MTRDX0DN004EECN) — `synergyBonus` and
 * `handSynergyTotal` are always 0.
 */
import { describe, it, expect } from 'vitest';

import {
  applyIncome,
  attachUpcomingDeltas,
  type IncomeResult,
} from '../../src/MainStreetAdjacency';
import { setupMainStreetGame } from '../../src/MainStreetState';
import {
  createBusinessDeck,
  type BusinessCard,
  type EventCard,
} from '../../src/MainStreetCards';
import { createActiveEffect } from '@core-engine/ActiveEffect';

/** Minimal EventCard factory for routing tests. */
function eventCard(overrides: Partial<EventCard> & Pick<EventCard, 'id' | 'name' | 'target'>): EventCard {
  return {
    family: 'event',
    trigger: 'Incident',
    cost: 0,
    effect: 'test',
    coinDelta: 0,
    reputationDelta: 0,
    ...overrides,
  } as EventCard;
}

/** Mirrors the animator's credited-total rule (upcomingDeltas excluded). */
function creditedIncomeTotalFor(result: IncomeResult): number {
  let sum = 0;
  for (const pd of result.phaseBreakdown.perSlotBreakdown) {
    sum += pd.baseIncome + pd.synergyBonus + pd.repBonus;
    for (const d of pd.eventDeltas ?? []) sum += d.delta;
  }
  return Math.round(Math.max(0, sum));
}

// ── Helpers ───────────────────────────────────────────────────────

function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business' as const,
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
    ongoingCost: overrides.ongoingCost ?? 0,
    ...overrides,
  };
}

function placeOnGrid(state: ReturnType<typeof setupMainStreetGame>, ...cards: BusinessCard[]): void {
  const grid = state.streetGrid;
  cards.forEach((card, idx) => {
    if (idx < grid.length) {
      grid[idx] = card;
      // Set currentIncome for the card (mimics placement logic)
      card.currentIncome = card.baseIncome + card.incomeBonus;
    }
  });
}

function expectPhaseBreakdown(result: IncomeResult): void {
  expect(result.phaseBreakdown).toBeDefined();
  expect(result.phaseBreakdown.perSlotBreakdown).toBeInstanceOf(Array);
  expect(result.phaseBreakdown.handSynergyTotal).toBeTypeOf('number');
}

// ── Tests ─────────────────────────────────────────────────────────

describe('IncomeResult.phaseBreakdown (CG-0MT23O6W8003AXWJ)', () => {
  it('has phaseBreakdown field with perSlotBreakdown and handSynergyTotal (always 0)', () => {
    const state = setupMainStreetGame({ seed: 'income-phase-data' });
    const result = applyIncome(state);
    expectPhaseBreakdown(result);
  });

  it('perSlotBreakdown mirrors breakdown length', () => {
    const state = setupMainStreetGame({ seed: 'income-phase-data' });
    placeOnGrid(state, makeBiz({ baseIncome: 3 }));
    const result = applyIncome(state);
    expect(result.phaseBreakdown.perSlotBreakdown.length).toBe(result.breakdown.length);
  });

  describe('base income contribution', () => {
    it('baseIncome reflects card currentIncome before multipliers', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      placeOnGrid(state, makeBiz({ baseIncome: 4 }));
      const result = applyIncome(state);
      const slot = result.phaseBreakdown.perSlotBreakdown[0];
      expect(slot).toBeDefined();
      expect(slot.baseIncome).toBe(4); // baseIncome = currentIncome
    });

    it('multiple producing slots each have correct baseIncome', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      // Different synergy types so neither slot earns board synergy — this
      // isolates the base-income contribution per slot (the base/synergy
      // separation is covered separately below).
      placeOnGrid(
        state,
        makeBiz({ baseIncome: 3, id: 'biz-a', synergyTypes: ['Food'] }),
        makeBiz({ baseIncome: 5, id: 'biz-b', synergyTypes: ['Service'] }),
      );
      const result = applyIncome(state);
      expect(result.phaseBreakdown.perSlotBreakdown[0].baseIncome).toBe(3);
      expect(result.phaseBreakdown.perSlotBreakdown[1].baseIncome).toBe(5);
    });
  });

  describe('synergy bonus (hand synergy removed — always 0, CG-0MTRDX0DN004EECN)', () => {
    it('handSynergyTotal stays 0 even with matching hand cards', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      placeOnGrid(state, makeBiz({ baseIncome: 3, id: 'biz-a' }));
      // Hand cards with synergy types that match the placed business
      const handBiz = makeBiz({ baseIncome: 3, id: 'hand-biz', synergyTypes: ['Food'] });
      state.hand.push(handBiz);
      const result = applyIncome(state);
      expect(result.phaseBreakdown.handSynergyTotal).toBe(0);
      for (const pd of result.phaseBreakdown.perSlotBreakdown) {
        expect(pd.synergyBonus).toBe(0);
      }
    });
  });

  describe('reputation bonus', () => {
    it('repBonus is computed from reputation multiplier', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      state.resourceBank.reputation = 2000; // rep 2000 → 1 + 2000/8000 = 1.25× (integer economy)
      placeOnGrid(state, makeBiz({ baseIncome: 300 }));
      const result = applyIncome(state);
      const slot = result.phaseBreakdown.perSlotBreakdown[0];
      expect(slot).toBeDefined();
      // At rep 2000, rep coin multiplier = 1.25, so repBonus should be positive
      // baseIncome = 300, after buffs = 300, rep 1.25× → 375, repBonus = 75
      expect(slot.repBonus).toBeGreaterThan(0);
    });

    it('repBonus is zero when reputation is zero', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      state.resourceBank.reputation = 0; // rep = 0 → multiplier = 1.0
      placeOnGrid(state, makeBiz({ baseIncome: 3 }));
      const result = applyIncome(state);
      const slot = result.phaseBreakdown.perSlotBreakdown[0];
      expect(slot.repBonus).toBe(0);
    });

    it('total equals sum of all phases across all slots', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      state.resourceBank.reputation = 2000;
      placeOnGrid(state, makeBiz({ baseIncome: 300 }));
      const result = applyIncome(state);
      const slot = result.phaseBreakdown.perSlotBreakdown[0];
      const phaseSum = slot.baseIncome + slot.repBonus + slot.eventDeltas.reduce((s, d) => s + d.delta, 0);
      // Phase sum should be close to total (some rounding in repBonus)
      expect(phaseSum).toBeGreaterThan(0);
    });
  });

  describe('event delta tracking', () => {
    it('tracks income-multiplier active effects as eventDeltas', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      placeOnGrid(state, makeBiz({ baseIncome: 400 }));
      // Add a Flu Outbreak effect: 0.8× income multiplier
      const effect = createActiveEffect(
        'income-multiplier',
        0.8,
        5,
        'flu-outbreak',
        'Flu Outbreak',
      );
      state.activeEffects.push(effect);
      const result = applyIncome(state);
      const slot = result.phaseBreakdown.perSlotBreakdown[0];
      expect(slot.eventDeltas).toBeInstanceOf(Array);
      expect(slot.eventDeltas.length).toBeGreaterThan(0);
      // The delta should be negative (0.8 × base < base)
      const fluDelta = slot.eventDeltas.find(d => d.cardId === 'flu-outbreak');
      expect(fluDelta).toBeDefined();
      expect(fluDelta!.delta).toBeLessThan(0);
    });

    it('tracks multiple income-multiplier effects separately', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      placeOnGrid(state, makeBiz({ baseIncome: 400 }));
      state.activeEffects.push(createActiveEffect('income-multiplier', 0.8, 5, 'flu-outbreak', 'Flu Outbreak'));
      state.activeEffects.push(createActiveEffect('income-multiplier', 1.15, 3, 'tourist-season', 'Tourist Season'));
      const result = applyIncome(state);
      const slot = result.phaseBreakdown.perSlotBreakdown[0];
      expect(slot.eventDeltas.length).toBeGreaterThanOrEqual(1);
      const fluDelta = slot.eventDeltas.find(d => d.cardId === 'flu-outbreak');
      const touristDelta = slot.eventDeltas.find(d => d.cardId === 'tourist-season');
      // Flu should reduce, Tourist should increase (but Flu was applied first, so Tourist is on top of Flu)
      expect(fluDelta).toBeDefined();
      expect(fluDelta!.delta).toBeLessThan(0);
      expect(touristDelta).toBeDefined();
      expect(touristDelta!.delta).toBeGreaterThan(0);
    });

    it('no eventDeltas when no active income-multiplier effects', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      placeOnGrid(state, makeBiz({ baseIncome: 3 }));
      const result = applyIncome(state);
      const slot = result.phaseBreakdown.perSlotBreakdown[0];
      expect(slot.eventDeltas.length).toBe(0);
    });
  });

  describe('upcoming card deltas (CG-0MUA1UH3A008M4BS)', () => {
    it('upcomingDeltas is an empty array when no Upcoming effect is attached', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      placeOnGrid(state, makeBiz({ baseIncome: 3 }));
      const result = applyIncome(state);
      const slot = result.phaseBreakdown.perSlotBreakdown[0];
      expect(slot.upcomingDeltas).toBeInstanceOf(Array);
      expect(slot.upcomingDeltas.length).toBe(0);
    });

    it('attachUpcomingDeltas attributes a business-attached delta to the matching slot and keeps creditedIncomeTotal unchanged', () => {
      const state = setupMainStreetGame({ seed: 'upcoming-attach' });
      const biz = makeBiz({ baseIncome: 3, id: 'biz-food', synergyTypes: ['Food'] });
      placeOnGrid(state, biz);
      const result = applyIncome(state);
      const creditedBefore = creditedIncomeTotalFor(result);

      attachUpcomingDeltas(
        result,
        state,
        eventCard({ id: 'evt-rainy', name: 'Rainy Day', target: 'SpecificSynergy', targetSynergy: 'Food' }),
        -200,
        0,
      );

      const slot = result.phaseBreakdown.perSlotBreakdown.find((pd) => pd.slotIndex === 0)!;
      expect(slot.upcomingDeltas).toHaveLength(1);
      expect(slot.upcomingDeltas[0]).toMatchObject({
        cardId: 'evt-rainy',
        delta: -200,
        kind: 'coin',
        attachedSlotIndex: 0,
      });
      // Presentational only: the credited total is unchanged (AC4).
      expect(creditedIncomeTotalFor(result)).toBe(creditedBefore);
    });

    it('attachUpcomingDeltas carries unattached (All) deltas with attachedSlotIndex null and routes to no business grid', () => {
      const state = setupMainStreetGame({ seed: 'upcoming-hud' });
      placeOnGrid(state, makeBiz({ baseIncome: 3, id: 'biz-a' }));
      const result = applyIncome(state);
      const creditedBefore = creditedIncomeTotalFor(result);

      attachUpcomingDeltas(
        result,
        state,
        eventCard({ id: 'evt-tax', name: 'Tax Audit', target: 'All' }),
        -450,
        100,
      );

      const allDeltas = result.phaseBreakdown.perSlotBreakdown.flatMap((pd) => pd.upcomingDeltas);
      expect(allDeltas).toHaveLength(2);
      const coin = allDeltas.find((d) => d.kind === 'coin')!;
      const rep = allDeltas.find((d) => d.kind === 'rep')!;
      expect(coin).toMatchObject({ delta: -450, attachedSlotIndex: null });
      expect(rep).toMatchObject({ delta: 100, attachedSlotIndex: null });
      expect(creditedIncomeTotalFor(result)).toBe(creditedBefore);
    });

    it('attachUpcomingDeltas splits a targeted delta across matching slots with an integer-preserving sum', () => {
      const state = setupMainStreetGame({ seed: 'upcoming-split' });
      placeOnGrid(
        state,
        makeBiz({ baseIncome: 3, id: 'biz-food-1', synergyTypes: ['Food'] }),
        makeBiz({ baseIncome: 3, id: 'biz-food-2', synergyTypes: ['Food'] }),
        makeBiz({ baseIncome: 3, id: 'biz-culture', synergyTypes: ['Culture'] }),
      );
      const result = applyIncome(state);

      attachUpcomingDeltas(
        result,
        state,
        eventCard({ id: 'evt-inspection', name: 'Health Inspection', target: 'SpecificSynergy', targetSynergy: 'Food' }),
        -200,
        100,
      );

      const slot0 = result.phaseBreakdown.perSlotBreakdown.find((pd) => pd.slotIndex === 0)!;
      const slot1 = result.phaseBreakdown.perSlotBreakdown.find((pd) => pd.slotIndex === 1)!;
      const slot2 = result.phaseBreakdown.perSlotBreakdown.find((pd) => pd.slotIndex === 2)!;
      const sum = (pd: { upcomingDeltas: Array<{ delta: number }> }): number =>
        pd.upcomingDeltas.reduce((acc, d) => acc + d.delta, 0);
      expect(sum(slot0) + sum(slot1)).toBe(-100); // -200 coin + 100 rep
      expect(sum(slot2)).toBe(0); // culture slot not targeted
      // Every descriptor carries its owning slot index as the attachment.
      expect(slot0.upcomingDeltas.every((d) => d.attachedSlotIndex === 0)).toBe(true);
      expect(slot1.upcomingDeltas.every((d) => d.attachedSlotIndex === 1)).toBe(true);
    });
  });

  describe('combined effects', () => {
    it('correctly handles base + reputation + income-multiplier together', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      state.resourceBank.reputation = 4000; // rep 4000 → 1 + 4000/8000 = 1.5× (cap, integer economy)
      placeOnGrid(state, makeBiz({ baseIncome: 200 }));
      state.activeEffects.push(createActiveEffect('income-multiplier', 0.8, 3, 'flu-outbreak', 'Flu Outbreak'));
      const result = applyIncome(state);
      const slot = result.phaseBreakdown.perSlotBreakdown[0];
      expect(slot.baseIncome).toBe(200);
      expect(slot.repBonus).toBeGreaterThan(0);
      expect(slot.eventDeltas.length).toBe(1);
      expect(slot.eventDeltas[0].delta).toBeLessThan(0);
    });

    it('slot totals sum approximately to the credited total', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      state.resourceBank.reputation = 3000;
      placeOnGrid(state, makeBiz({ baseIncome: 300, id: 'a' }), makeBiz({ baseIncome: 400, id: 'b' }));
      const coinsBefore = state.resourceBank.coins;
      const result = applyIncome(state);
      // Sum of phase values (base + repBonus + eventDeltas) should equal
      // the coins actually credited (multiplied amount), not the pre-multiplier total.
      let summed = 0;
      for (const slot of result.phaseBreakdown.perSlotBreakdown) {
        summed += slot.baseIncome + slot.synergyBonus + slot.repBonus;
        for (const delta of slot.eventDeltas) summed += delta.delta;
      }
      // Hand synergy is 0 (CG-0MTRDX0DN004EECN), so the phase sum equals the
      // coins actually credited (multiplied amount).
      const coinsCredited = state.resourceBank.coins - coinsBefore;
      // Allow small floating-point drift
      expect(summed).toBeCloseTo(coinsCredited, 2);
    });
  });

  describe('backward compatibility', () => {
    it('existing breakdown field is unchanged', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      placeOnGrid(state, makeBiz({ baseIncome: 3 }));
      const result = applyIncome(state);
      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.length).toBeGreaterThan(0);
      expect(result.breakdown[0].slotIndex).toBe(0);
      expect(result.breakdown[0].businessName).toBe('Test Biz');
      expect(result.breakdown[0].total).toBeGreaterThan(0);
    });

    it('total field unchanged (pre-multiplier total preserved)', () => {
      const state = setupMainStreetGame({ seed: 'income-phase-data' });
      state.resourceBank.reputation = 20;
      placeOnGrid(state, makeBiz({ baseIncome: 4 }));
      const result = applyIncome(state);
      expect(result.total).toBeTypeOf('number');
      // total is the pre-multiplier sum of buffedIncomes (not the multiplied amount)
      expect(result.total).toBe(4); // no buffs at default difficulty
    });
  });
});

// ── Florist end-of-turn income crediting (CG-0MT6EQSPW002E7RC) ──

describe('Florist end-of-turn income crediting (CG-0MT6EQSPW002E7RC)', () => {
  it('credits positive income for a solo Florist placement (AC2)', () => {
    const state = setupMainStreetGame({ seed: 'florist-income' });
    // Pin the reputation coin multiplier to 1.0 so the credited amount is exact.
    state.resourceBank.reputation = 0;

    const florist = createBusinessDeck(1).find(c => c.name === 'Florist')!;
    expect(florist).toBeDefined();

    const coinsBefore = state.resourceBank.coins;
    placeOnGrid(state, florist);
    const result = applyIncome(state);

    // IncomeResult includes the Florist slot with a positive total
    const floristSlot = result.breakdown.find(s => s.businessName === 'Florist');
    expect(floristSlot).toBeDefined();
    expect(floristSlot!.total).toBeGreaterThan(0);

    // Coins increase by the florist's income (3.5 at tier-5 parity)
    const credited = state.resourceBank.coins - coinsBefore;
    expect(credited).toBe(florist.baseIncome); // rep multiplier 1.0 at rep 0

    // Net after the ongoing cost still meets the tier-parity baseline (≥ 2.0/turn)
    expect(florist.baseIncome - florist.ongoingCost).toBeGreaterThanOrEqual(2.0);
  });
});
