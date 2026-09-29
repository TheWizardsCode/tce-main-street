/**
 * Main Street: Upcoming coin/reputation flow routing (CG-0MUA1UH3A008M4BS).
 *
 * Verifies the routing decision for Upcoming-card coin and reputation deltas
 * (AC1–AC3): business-attached effects flow between the Upcoming source and
 * the affected business card; unattached (`target = All`) effects flow to the
 * HUD totals; direction follows the sign (gain lands on the actor, loss leaves
 * it); reputation follows the same rules as coins.
 *
 * `resolveDeltaFlow` is pure, so these are fast unit assertions on flight
 * start/end points and direction — the AC1/AC2/AC3 verification.
 *
 * @module tests/main-street/upcoming-flow-routing
 */

import { describe, it, expect } from 'vitest';

import { resolveDeltaFlow } from '../../src/scenes/MainStreetAnimatorContext';
import type { DeltaFlowGeometry } from '../../src/scenes/MainStreetAnimatorContext';

const UPCOMING = { x: 500, y: 600 };
const SLOT = { x: 120, y: 200 };
const HUD_COIN = { x: 390, y: 50 };
const HUD_REP = { x: 640, y: 50 };

const geometry: DeltaFlowGeometry = {
  upcomingSource: UPCOMING,
  slotCenter: SLOT,
  hudCoin: HUD_COIN,
  hudRep: HUD_REP,
};

describe('resolveDeltaFlow — Upcoming delta routing (CG-0MUA1UH3A008M4BS)', () => {
  describe('AC1: business-attached routing (source target = SpecificSynergy / RandomBusiness)', () => {
    it('gain lands on the affected business card (Upcoming → card)', () => {
      const route = resolveDeltaFlow({ delta: 300, attachedSlotIndex: 2 }, geometry);
      expect(route.attached).toBe(true);
      expect(route.kind).toBe('coin');
      expect(route.from).toEqual(UPCOMING);
      expect(route.to).toEqual(SLOT);
    });

    it('loss leaves the affected business card (card → Upcoming)', () => {
      const route = resolveDeltaFlow({ delta: -300, attachedSlotIndex: 2 }, geometry);
      expect(route.attached).toBe(true);
      expect(route.from).toEqual(SLOT);
      expect(route.to).toEqual(UPCOMING);
    });

    it('routes through the business grid even when no grid target is supplied by the caller (slot 0 is still attached)', () => {
      // attachedSlotIndex 0 is a valid business attachment (not falsy-coerced
      // to unattached).
      const route = resolveDeltaFlow({ delta: 100, attachedSlotIndex: 0 }, geometry);
      expect(route.attached).toBe(true);
      expect(route.to).toEqual(SLOT);
    });
  });

  describe('AC2: unattached routing (source target = All → HUD totals)', () => {
    it('coin gain lands on the HUD coin counter (Upcoming → HUD coin)', () => {
      const route = resolveDeltaFlow({ delta: 200, attachedSlotIndex: null }, geometry);
      expect(route.attached).toBe(false);
      expect(route.kind).toBe('coin');
      expect(route.from).toEqual(UPCOMING);
      expect(route.to).toEqual(HUD_COIN);
      // Never routed via a business grid.
      expect(route.to).not.toEqual(SLOT);
    });

    it('coin loss leaves the HUD coin counter (HUD coin → Upcoming)', () => {
      const route = resolveDeltaFlow({ delta: -200, attachedSlotIndex: null }, geometry);
      expect(route.attached).toBe(false);
      expect(route.from).toEqual(HUD_COIN);
      expect(route.to).toEqual(UPCOMING);
    });

    it('an omitted attachedSlotIndex is treated as unattached (HUD)', () => {
      const route = resolveDeltaFlow({ delta: 200 }, geometry);
      expect(route.attached).toBe(false);
      expect(route.to).toEqual(HUD_COIN);
    });
  });

  describe('AC3: reputation parity', () => {
    it('attached reputation gain lands on the business card', () => {
      const route = resolveDeltaFlow({ delta: 100, kind: 'rep', attachedSlotIndex: 3 }, geometry);
      expect(route.kind).toBe('rep');
      expect(route.attached).toBe(true);
      expect(route.from).toEqual(UPCOMING);
      expect(route.to).toEqual(SLOT);
    });

    it('attached reputation loss leaves the business card', () => {
      const route = resolveDeltaFlow({ delta: -100, kind: 'rep', attachedSlotIndex: 3 }, geometry);
      expect(route.from).toEqual(SLOT);
      expect(route.to).toEqual(UPCOMING);
    });

    it('unattached reputation gain lands on the HUD reputation counter', () => {
      const route = resolveDeltaFlow({ delta: 100, kind: 'rep', attachedSlotIndex: null }, geometry);
      expect(route.attached).toBe(false);
      expect(route.kind).toBe('rep');
      expect(route.from).toEqual(UPCOMING);
      expect(route.to).toEqual(HUD_REP);
      expect(route.to).not.toEqual(HUD_COIN);
    });

    it('unattached reputation loss leaves the HUD reputation counter', () => {
      const route = resolveDeltaFlow({ delta: -100, kind: 'rep', attachedSlotIndex: null }, geometry);
      expect(route.from).toEqual(HUD_REP);
      expect(route.to).toEqual(UPCOMING);
    });

    it('covers the full {gain, loss} × {attached, unattached} matrix for reputation', () => {
      const cases: Array<{ delta: number; attachedSlotIndex: number | null; expectFrom: object; expectTo: object }> = [
        { delta: 100, attachedSlotIndex: 1, expectFrom: UPCOMING, expectTo: SLOT },
        { delta: -100, attachedSlotIndex: 1, expectFrom: SLOT, expectTo: UPCOMING },
        { delta: 100, attachedSlotIndex: null, expectFrom: UPCOMING, expectTo: HUD_REP },
        { delta: -100, attachedSlotIndex: null, expectFrom: HUD_REP, expectTo: UPCOMING },
      ];
      for (const c of cases) {
        const route = resolveDeltaFlow({ delta: c.delta, kind: 'rep', attachedSlotIndex: c.attachedSlotIndex }, geometry);
        expect(route.from).toEqual(c.expectFrom);
        expect(route.to).toEqual(c.expectTo);
      }
    });
  });

  it('a zero delta is treated as a (no-op) gain and never targets the business card when unattached', () => {
    const route = resolveDeltaFlow({ delta: 0, attachedSlotIndex: null }, geometry);
    expect(route.from).toEqual(UPCOMING);
    expect(route.to).toEqual(HUD_COIN);
  });
});
