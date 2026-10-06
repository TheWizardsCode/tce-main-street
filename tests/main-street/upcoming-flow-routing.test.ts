/**
 * Main Street: Upcoming coin/reputation flow routing (CG-0MUA1UH3A008M4BS).
 *
 * Verifies the routing decision for Upcoming-card coin and reputation deltas
 * (AC1–AC3): business-attached effects use the affected business card as the
 * actor; unattached (`target = All`) effects use the Upcoming panel as the
 * actor; direction follows the incident-reveal sign rule uniformly for coins
 * and reputation — **gain = actor → HUD resource**, **loss = HUD resource →
 * actor** (producer manual review 2026-10-01: a card that gives coins or
 * reputation flows from the card to the HUD; one that costs flows from the HUD
 * to the card).
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
    // Producer manual review (2026-10-01): "If the card gives coins or
    // reputation then they should flow from the card to the HUD. If they cost
    // coins or reputation then it flows from the HUD to the card." For an
    // attached effect the actor is the affected business card.
    it('coin gain flows from the affected business card to the HUD coin counter (card → HUD)', () => {
      const route = resolveDeltaFlow({ delta: 300, attachedSlotIndex: 2 }, geometry);
      expect(route.attached).toBe(true);
      expect(route.kind).toBe('coin');
      expect(route.from).toEqual(SLOT);
      expect(route.to).toEqual(HUD_COIN);
      // Never accumulated on the business grid (the original bug).
      expect(route.to).not.toEqual(SLOT);
    });

    it('coin loss flows from the HUD coin counter to the affected business card (HUD → card)', () => {
      const route = resolveDeltaFlow({ delta: -300, attachedSlotIndex: 2 }, geometry);
      expect(route.attached).toBe(true);
      expect(route.from).toEqual(HUD_COIN);
      expect(route.to).toEqual(SLOT);
    });

    it('uses the business card as the actor even when no grid target is supplied by the caller (slot 0 is still attached)', () => {
      // attachedSlotIndex 0 is a valid business attachment (not falsy-coerced
      // to unattached).
      const route = resolveDeltaFlow({ delta: 100, attachedSlotIndex: 0 }, geometry);
      expect(route.attached).toBe(true);
      expect(route.from).toEqual(SLOT);
      expect(route.to).toEqual(HUD_COIN);
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

    it('covers the full {gain, loss} × {attached, unattached} matrix for coins', () => {
      const cases: Array<{ delta: number; attachedSlotIndex: number | null; expectFrom: object; expectTo: object }> = [
        // Attached: gain card → HUD coin; loss HUD coin → card.
        { delta: 100, attachedSlotIndex: 1, expectFrom: SLOT, expectTo: HUD_COIN },
        { delta: -100, attachedSlotIndex: 1, expectFrom: HUD_COIN, expectTo: SLOT },
        // Unattached: gain Upcoming → HUD coin; loss HUD coin → Upcoming.
        { delta: 100, attachedSlotIndex: null, expectFrom: UPCOMING, expectTo: HUD_COIN },
        { delta: -100, attachedSlotIndex: null, expectFrom: HUD_COIN, expectTo: UPCOMING },
      ];
      for (const c of cases) {
        const route = resolveDeltaFlow({ delta: c.delta, kind: 'coin', attachedSlotIndex: c.attachedSlotIndex }, geometry);
        expect(route.from).toEqual(c.expectFrom);
        expect(route.to).toEqual(c.expectTo);
      }
    });

    it('never accumulates an attached coin gain on the business grid (producer rejection regression)', () => {
      // The exact failure the producer reported: a positive coin delta drawn
      // as Upcoming → business grid. The gain must flow card → HUD coin.
      for (const attachedSlotIndex of [0, 2, null] as const) {
        const route = resolveDeltaFlow({ delta: 250, kind: 'coin', attachedSlotIndex }, geometry);
        expect(route.to).toEqual(HUD_COIN);
        expect(route.to).not.toEqual(SLOT);
      }
    });
  });

  describe('AC3: reputation parity', () => {
    // Regression for the producer's rejection of the first attempt
    // (2026-09-29): "Reputation from events in the upcoming pile still flows
    // from HUD to card when it should go card to hud (increasing
    // reputation)." Reputation has no on-card grid, so a gain must flow from
    // the actor (business card / Upcoming panel) TO the HUD reputation
    // counter, matching the incident-reveal convention.
    it('attached reputation gain flows from the business card to the HUD reputation counter (card → HUD)', () => {
      const route = resolveDeltaFlow({ delta: 100, kind: 'rep', attachedSlotIndex: 3 }, geometry);
      expect(route.kind).toBe('rep');
      expect(route.attached).toBe(true);
      expect(route.from).toEqual(SLOT);
      expect(route.to).toEqual(HUD_REP);
      // Never routed to the business card as a gain destination (the original
      // bug: an increase was drawn as HUD → card).
      expect(route.to).not.toEqual(SLOT);
    });

    it('attached reputation loss flows from the HUD reputation counter to the business card (HUD → card)', () => {
      const route = resolveDeltaFlow({ delta: -100, kind: 'rep', attachedSlotIndex: 3 }, geometry);
      expect(route.from).toEqual(HUD_REP);
      expect(route.to).toEqual(SLOT);
    });

    it('unattached reputation gain flows from the Upcoming panel to the HUD reputation counter (card → HUD)', () => {
      const route = resolveDeltaFlow({ delta: 100, kind: 'rep', attachedSlotIndex: null }, geometry);
      expect(route.attached).toBe(false);
      expect(route.kind).toBe('rep');
      expect(route.from).toEqual(UPCOMING);
      expect(route.to).toEqual(HUD_REP);
      expect(route.to).not.toEqual(HUD_COIN);
    });

    it('unattached reputation loss flows from the HUD reputation counter to the Upcoming panel (HUD → card)', () => {
      const route = resolveDeltaFlow({ delta: -100, kind: 'rep', attachedSlotIndex: null }, geometry);
      expect(route.from).toEqual(HUD_REP);
      expect(route.to).toEqual(UPCOMING);
    });

    it('covers the full {gain, loss} × {attached, unattached} matrix for reputation', () => {
      const cases: Array<{ delta: number; attachedSlotIndex: number | null; expectFrom: object; expectTo: object }> = [
        // Attached: gain card → HUD; loss HUD → card.
        { delta: 100, attachedSlotIndex: 1, expectFrom: SLOT, expectTo: HUD_REP },
        { delta: -100, attachedSlotIndex: 1, expectFrom: HUD_REP, expectTo: SLOT },
        // Unattached: gain Upcoming → HUD; loss HUD → Upcoming.
        { delta: 100, attachedSlotIndex: null, expectFrom: UPCOMING, expectTo: HUD_REP },
        { delta: -100, attachedSlotIndex: null, expectFrom: HUD_REP, expectTo: UPCOMING },
      ];
      for (const c of cases) {
        const route = resolveDeltaFlow({ delta: c.delta, kind: 'rep', attachedSlotIndex: c.attachedSlotIndex }, geometry);
        expect(route.from).toEqual(c.expectFrom);
        expect(route.to).toEqual(c.expectTo);
      }
    });

    it('never routes an increasing reputation from the HUD into a business card (producer rejection regression)', () => {
      // The exact failure the producer saw: a positive reputation delta drawn
      // as HUD → card. Assert the HUD is the *destination* for gains, for
      // both attached and unattached deltas.
      for (const attachedSlotIndex of [0, 2, null] as const) {
        const route = resolveDeltaFlow({ delta: 250, kind: 'rep', attachedSlotIndex }, geometry);
        expect(route.to).toEqual(HUD_REP);
        expect(route.from).not.toEqual(HUD_REP);
      }
    });
  });

  it('a zero delta is treated as a (no-op) gain and never targets a business card', () => {
    const unattached = resolveDeltaFlow({ delta: 0, attachedSlotIndex: null }, geometry);
    expect(unattached.from).toEqual(UPCOMING);
    expect(unattached.to).toEqual(HUD_COIN);

    const attached = resolveDeltaFlow({ delta: 0, attachedSlotIndex: 3 }, geometry);
    expect(attached.from).toEqual(SLOT);
    expect(attached.to).toEqual(HUD_COIN);
  });
});
