/**
 * Main Street: Activity Log filter baseline invariants (MS-0MW3PFLDP000CF2X)
 *
 * Present-day acceptance baseline for the Activity Log filter epic
 * (MS-0MW1ZGM1F0010DQW). This is the **test-first** child: every assertion
 * below pins behaviour that exists TODAY and must stay green while the
 * attribution and predicate children land on top of the shared harness
 * (`tests/main-street/helpers/activity-log-harness.ts`).
 *
 * Baseline invariants:
 *
 *  - turn headers carry no `seatId` and stay textually identical;
 *  - every acting-seat action entry is attributed to the acting seat
 *    (`seatId` + `seatLabel` + `seatColour`) — the per-path table lives in
 *    `activity-log-seat-attribution.test.ts`
 *    (MS-0MW3PFQ4L0046Q3K);
 *  - single-player (no roster) and single-seat entries carry no seat fields
 *    and render with no prefix (the renderer's prefix branch keys off
 *    `seatLabel && seatColour`; the browser harness pins the rendered
 *    absence separately in `activity-log-filter.browser.test.ts`);
 *  - every gameplay path the epic cares about is driveable through the
 *    harness and returns the entries it appended.
 *
 * Later children extend this file (and the harness) instead of copying boot
 * or state-setup code.
 */
import { describe, expect, it } from 'vitest';

import {
  createActivityLogState,
  createSinglePlayerState,
  driveAction,
  recalculateCard,
  startDay,
} from './helpers/activity-log-harness';
import type { LogEntry, MainStreetState } from '../../src/MainStreetState';
import { deserializeMainStreetState, serializeMainStreetState } from '../../src/MainStreetState';
import type { BusinessCard, EventCard, StaffCard, UpgradeCard } from '../../src/MainStreetCards';

// ── Card factories (fabricated, like the rest of the unit suite) ──

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

// ── Baseline invariants ─────────────────────────────────────

describe('Activity Log filter baseline — headless harness (MS-0MW3PFLDP000CF2X)', () => {
  describe('turn headers stay seat-less; action entries are attributed', () => {
    it('startDay appends a seat-less Turn 1 turn header', () => {
      const state = createActivityLogState({ seed: 'baseline-header' });
      const entries = startDay(state);

      expect(entries).toHaveLength(1);
      expect(entries[0].type).toBe('turn-header');
      expect(entries[0].text).toBe('Turn 1');
      expect(entries[0].seatId).toBeUndefined();
      expect(entries[0].seatLabel).toBeUndefined();
      expect(entries[0].seatColour).toBeUndefined();
    });

    it('market-action appended entries carry the acting seat attribution', () => {
      // Every acting-seat action path is attributed to the seat that acted
      // (MS-0MW3PFQ4L0046Q3K AC1). The complete one-case-per-path table lives
      // in `activity-log-seat-attribution.test.ts`; this baseline spot-checks
      // the family the filter depends on most.
      const buy = competitive('baseline-buy');
      buy.players![0].coins = 5000;
      buy.activePlayerId = 0;
      const biz = buy.market.cards.find((c) => c.family === 'business')!;
      const buyEntries = driveAction(buy, { type: 'buy-business', cardId: biz.id, slotIndex: 0 }, { seatId: 0 });
      expect(buyEntries.length).toBeGreaterThan(0);
      for (const e of buyEntries) {
        expect(e.seatId, `buy-business: ${e.text}`).toBe(0);
        expect(e.seatLabel, `buy-business: ${e.text}`).toBe('You');
        expect(e.seatColour, `buy-business: ${e.text}`).toBe(buy.players![0].colour);
      }

      // move-to-hand
      const move = competitive('baseline-move');
      move.activePlayerId = 1;
      const mvBiz = move.market.cards.find((c) => c.family === 'business')!;
      const mvEntries = driveAction(move, { type: 'move-to-hand', cardId: mvBiz.id }, { seatId: 1 });
      expect(mvEntries.length).toBeGreaterThan(0);
      for (const e of mvEntries) {
        expect(e.seatId, `move-to-hand: ${e.text}`).toBe(1);
        expect(e.seatLabel, `move-to-hand: ${e.text}`).toBe('AI 1');
        expect(e.seatColour, `move-to-hand: ${e.text}`).toBe(move.players![1].colour);
      }

      // play-event: the per-owner "Investment" line carries the acting seat.
      const ev = competitive('baseline-event');
      ev.players![1].hand = [makeInvestmentEvent({ id: 'ev-1', name: 'Galaxy Fest', cost: 0, coinDelta: 3, reputationDelta: 2 })];
      ev.players![1].coins = 20;
      ev.activePlayerId = 1;
      const evEntries = driveAction(ev, { type: 'play-event', handIndex: 0 }, { seatId: 1 });
      const investmentLine = evEntries.find((e) => e.text.startsWith('Investment:'));
      expect(investmentLine).toBeDefined();
      expect(investmentLine!.seatId).toBe(1);
      expect(investmentLine!.seatLabel).toBe('AI 1');
      expect(investmentLine!.seatColour).toBe(ev.players![1].colour);
    });
  });

  describe('seat-attributed income / reputation entries carry full seat fields', () => {
    it('stamps income and Reputation-from-cards entries for an AI seat', () => {
      const state = competitive('baseline-seat-ai');
      ownSlot(state, 0, makeBiz({ id: 'inc-biz', name: 'Cafe', baseIncome: 3, reputationPerTurn: 2 }), 1);

      const entries = driveAction(state, { type: 'income' });

      // Owner 0 owns no slots, so its shared-day income phase logs a
      // seat-attributed `+0 coins` line first; the seat-1 line is the one the
      // invariant is about.
      const income = entries.find((e) => e.text.startsWith('Income:') && e.seatId === 1);
      expect(income).toBeDefined();
      expect(income!.seatId).toBe(1);
      expect(income!.seatLabel).toBe('AI 1');
      expect(income!.seatColour).toBe(state.players![1].colour);

      const rep = entries.find((e) => e.text.startsWith('Reputation from cards:'));
      expect(rep).toBeDefined();
      expect(rep!.seatId).toBe(1);
      expect(rep!.seatLabel).toBe('AI 1');
      expect(rep!.seatColour).toBe(state.players![1].colour);
    });

    it('stamps the human seat with seatId 0 and label "You"', () => {
      const state = competitive('baseline-seat-human');
      ownSlot(state, 0, makeBiz({ id: 'inc-human', name: 'Cafe', baseIncome: 3 }), 0);

      const entries = driveAction(state, { type: 'income' });
      const income = entries.find((e) => e.text.startsWith('Income:'));

      expect(income).toBeDefined();
      expect(income!.seatId).toBe(0);
      expect(income!.seatLabel).toBe('You');
      expect(income!.seatColour).toBe(state.players![0].colour);
    });

    it('the reputation drive path stamps seat fields', () => {
      const state = competitive('baseline-rep-path');
      const entries = driveAction(state, { type: 'reputation', playerId: 1, delta: 2 });

      expect(entries).toHaveLength(1);
      expect(entries[0].text).toContain('+2 reputation');
      expect(entries[0].seatId).toBe(1);
      expect(entries[0].seatLabel).toBe('AI 1');
      expect(entries[0].seatColour).toBe(state.players![1].colour);
      expect(state.players![1].reputation).toBeGreaterThan(0);
    });
  });

  describe('single-player (no roster) and single-seat entries carry no seat fields', () => {
    it('single-player (no roster): seat-arg calls stay seat-less and unprefixed', () => {
      const state = createSinglePlayerState('baseline-single');
      startDay(state);

      // The seat-arg reputation path stamps nothing without a roster.
      const rep = driveAction(state, { type: 'reputation', playerId: 0, delta: 2 });
      expect(rep).toHaveLength(1);
      expect(rep[0].seatId).toBeUndefined();
      expect(rep[0].seatLabel).toBeUndefined();
      expect(rep[0].seatColour).toBeUndefined();

      // Income stays seat-less too.
      state.streetGrid[0] = makeBiz({ id: 's-biz', name: 'Cafe', baseIncome: 3 });
      recalculateCard(state, 0);
      const income = driveAction(state, { type: 'income' }).find((e) => e.text.startsWith('Income:'));
      expect(income).toBeDefined();
      expect(income!.seatId).toBeUndefined();
      expect(income!.seatLabel).toBeUndefined();
      expect(income!.seatColour).toBeUndefined();

      // No seatLabel/seatColour means the renderer's prefix branch never
      // fires — the entry-level proxy for "renders with no prefix" (the
      // browser harness pins the rendered absence).
    });

    it('single-seat (playerCount 1): income entries carry no seat fields', () => {
      const state = createActivityLogState({ seed: 'baseline-one-seat', playerCount: 1 });
      startDay(state);
      state.streetGrid[0] = makeBiz({ id: 'os-biz', name: 'Cafe', baseIncome: 3 });
      recalculateCard(state, 0);

      const entries = driveAction(state, { type: 'income' });
      const income = entries.find((e) => e.text.startsWith('Income:'));
      expect(income).toBeDefined();
      expect(income!.seatId).toBeUndefined();
      expect(income!.seatLabel).toBeUndefined();
      expect(income!.seatColour).toBeUndefined();
    });
  });

  describe('driveability — every listed path appends log entries', () => {
    interface PathCase {
      name: string;
      seed: string;
      drive: (state: MainStreetState) => LogEntry[];
      assert?: (entries: LogEntry[], state: MainStreetState) => void;
    }

    const paths: PathCase[] = [
      {
        name: 'buy-business',
        seed: 'drive-buy',
        drive: (s) => {
          s.players![0].coins = 5000;
          const biz = s.market.cards.find((c) => c.family === 'business')!;
          return driveAction(s, { type: 'buy-business', cardId: biz.id, slotIndex: 0 }, { seatId: 0 });
        },
      },
      {
        name: 'play-business-from-hand',
        seed: 'drive-from-hand',
        drive: (s) => {
          s.players![0].coins = 5000;
          s.players![0].hand = [makeBiz({ id: 'dh-biz', name: 'Cafe', cost: 2 })];
          return driveAction(s, { type: 'play-business-from-hand', handIndex: 0, slotIndex: 1 }, { seatId: 0 });
        },
      },
      {
        name: 'buy-and-place',
        seed: 'drive-buy-place',
        drive: (s) => {
          s.players![0].coins = 5000;
          const biz = s.market.cards.find((c) => c.family === 'business')!;
          return driveAction(s, { type: 'buy-and-place', cardId: biz.id, slotIndex: 2 }, { seatId: 0 });
        },
      },
      {
        name: 'play-event',
        seed: 'drive-event',
        drive: (s) => {
          s.players![0].coins = 20;
          s.players![0].hand = [makeInvestmentEvent({ id: 'dv-ev', name: 'Fest', cost: 0, coinDelta: 3, reputationDelta: 2 })];
          return driveAction(s, { type: 'play-event', handIndex: 0 }, { seatId: 0 });
        },
        assert: (entries) => {
          expect(entries.some((e) => e.text.startsWith('Played event'))).toBe(true);
          expect(entries.some((e) => e.text.startsWith('Investment:'))).toBe(true);
        },
      },
      {
        name: 'move-to-hand',
        seed: 'drive-move',
        drive: (s) => {
          const biz = s.market.cards.find((c) => c.family === 'business')!;
          return driveAction(s, { type: 'move-to-hand', cardId: biz.id }, { seatId: 0 });
        },
      },
      {
        name: 'upgrade (buy-upgrade)',
        seed: 'drive-upgrade',
        drive: (s) => {
          ownSlot(s, 0, makeBiz({ id: 'du-biz', name: 'Bakery', maxLevel: 3 }), 0);
          s.market.cards = [makeUpgrade({ id: 'du-upg', name: 'Better Ovens', targetBusiness: 'Bakery' })];
          s.players![0].coins = 20;
          return driveAction(s, { type: 'buy-upgrade', cardId: 'du-upg', targetSlot: 0 }, { seatId: 0 });
        },
      },
      {
        name: 'hire (hire-staff)',
        seed: 'drive-hire',
        drive: (s) => {
          s.market.cards = [makeStaff({ id: 'du-staff', name: 'Helper', cost: 3 })];
          s.players![0].coins = 50;
          return driveAction(s, { type: 'hire-staff', cardId: 'du-staff' }, { seatId: 0 });
        },
      },
      {
        name: 'loan (take-loan)',
        seed: 'drive-loan',
        drive: (s) => driveAction(s, { type: 'take-loan', optionIndex: 0 }, { seatId: 0 }),
        assert: (entries) => {
          expect(entries.some((e) => e.text.startsWith('Took a bank loan'))).toBe(true);
        },
      },
      {
        name: 'bailout (bankruptcy offer)',
        seed: 'drive-bailout',
        drive: (s) => {
          s.turn = 2;
          s.players![1].coins = -8;
          return driveAction(s, { type: 'bailout', playerId: 1 });
        },
        assert: (entries) => {
          expect(entries.some((e) => e.text.startsWith('Bankruptcy bailout:'))).toBe(true);
        },
      },
      {
        name: 'income collection',
        seed: 'drive-income',
        drive: (s) => {
          ownSlot(s, 0, makeBiz({ id: 'di-biz', name: 'Cafe', baseIncome: 3 }), 1);
          return driveAction(s, { type: 'income' });
        },
        assert: (entries) => {
          expect(entries.some((e) => e.text.startsWith('Income:'))).toBe(true);
        },
      },
      {
        name: 'reputation change',
        seed: 'drive-rep',
        drive: (s) => driveAction(s, { type: 'reputation', playerId: 1, delta: 2 }),
        assert: (entries) => {
          expect(entries.some((e) => e.text.includes('reputation'))).toBe(true);
        },
      },
    ];

    it.each(paths)('$name returns the entries it appended', ({ seed, drive, assert }) => {
      const state = competitive(seed);
      const entries = drive(state);
      expect(entries.length).toBeGreaterThan(0);
      assert?.(entries, state);
    });
  });
});

// ── Save round-trip (MS-0MW3PFRV6003LJLD) ──────────────────

describe('Activity Log filter — scene state is never persisted (MS-0MW3PFRV6003LJLD)', () => {
  it('the serialised save data contains no logFilter key, and the round trip restores the log', () => {
    // `logFilter` lives on the scene (presentation-only, reset on scene
    // creation); the state serialiser must never write it into save data —
    // filtering is presentation-only and the view choice is never persisted.
    const state = createActivityLogState({ seed: 'save-roundtrip-filter' });
    startDay(state);
    state.players![0].coins = 5000;
    const biz = state.market.cards.find((c) => c.family === 'business')!;
    driveAction(state, { type: 'buy-business', cardId: biz.id, slotIndex: 0 }, { seatId: 0 });

    const serialised = serializeMainStreetState(state);
    expect(JSON.stringify(serialised)).not.toContain('logFilter');

    const restored = deserializeMainStreetState(serialised);
    expect((restored as unknown as Record<string, unknown>).logFilter).toBeUndefined();
    // The entries themselves survive the round trip (a filter test must not
    // lose data while the filter state is dropped).
    expect(restored.activityLog.length).toBe(state.activityLog.length);
    expect(restored.activityLog).toEqual(state.activityLog);
  });
});
