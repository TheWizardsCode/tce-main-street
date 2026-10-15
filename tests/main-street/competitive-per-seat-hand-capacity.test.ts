/**
 * Main Street: per-seat hand capacity isolation in competitive play
 *
 * Test-first regression coverage for MS-0MV8LHN5U008B9JJ ("AI staff should
 * not give players bonus hand slots"). These tests pin the per-seat
 * hand-capacity contract for competitive mode:
 *
 *   * every competitive `PlayerRecord` owns its own hand capacity (a
 *     per-seat `maxHandSize`, initialised to the base 3);
 *   * `bindCompetitiveSeat` / `restoreCompetitiveSeat` round-trip that value
 *     onto / off the shared working `state.maxHandSize`, so hiring or laying
 *     off staff affects only the employing seat — today a single shared
 *     scalar leaks every bonus to every seat;
 *   * single-player behaviour is unchanged (base 3 plus staff
 *     `handSlotsAdded` via the existing shared `maxHandSize` path).
 *
 * The contract cases were authored **red-phase** (`it.fails`, per the repo's
 * test-first tracer-bullet convention) and flipped to plain `it` by the
 * implementing child (MS-0MV8PX4DV003LTFP) once per-seat binding lands; they
 * now hold as ordinary guards over that contract. Guards that already
 * held before the change stay plain `it` so they keep protecting it.
 *
 * Every scenario uses a seeded game state, and the bind/hire/layoff paths
 * asserted here draw no RNG values (layoff's random hand-card removal is
 * avoided by keeping the hands empty), so each assertion is deterministic.
 */
import { describe, expect, it } from 'vitest';

import {
  createCompetitiveState,
  setupMainStreetGame,
  type CompetitiveOpponentConfig,
  type MainStreetState,
  type PlayerRecord,
} from '../../src/MainStreetState';
import { bindCompetitiveSeat, restoreCompetitiveSeat } from '../../src/MainStreetAiStrategy';
import { purchaseStaffCard } from '../../src/MainStreetMarket';
import { layoffStaffCard } from '../../src/MainStreetEngine';
import { createStaffDeck, type StaffCard } from '../../src/MainStreetCards';

/** Base hand capacity every seat starts at (and single-player never leaves). */
const BASE_HAND_CAPACITY = 3;

/** Opponent config for a 2-seat human-vs-AI competitive state. */
const OPPONENTS: CompetitiveOpponentConfig[] = [
  { strategy: 'Greedy', difficulty: 'Medium' },
];

/**
 * Reads a seat's own hand capacity — the per-seat `maxHandSize` declared by
 * this contract and now landed by the implementing child. Read through an
 * `unknown` cast so the suite stays robust; absent (should not happen) falls
 * back to the base capacity.
 */
function seatCapacity(seat: PlayerRecord): number {
  const perSeat = (seat as unknown as { maxHandSize?: number }).maxHandSize;
  return typeof perSeat === 'number' ? perSeat : BASE_HAND_CAPACITY;
}

/**
 * Places a deterministic staff card into the general market row with the
 * requested `handSlotsAdded`. Card-data values are untouched — the fixture is
 * authored per test so the contract never depends on the seeded market draw.
 */
function staffInMarket(state: MainStreetState, id: string, handSlotsAdded: number): StaffCard {
  const [template] = createStaffDeck(1);
  const staff = { ...template, id, handSlotsAdded } as StaffCard;
  state.market.cards.push(staff);
  return staff;
}

/**
 * Binds the seat (arming its coins/hand/staff on the shared fields), hires
 * `card` from the market row, and leaves the seat bound for inspection. The
 * caller decides when to `restoreCompetitiveSeat`.
 */
function hireForSeat(state: MainStreetState, playerId: number, card: StaffCard): void {
  bindCompetitiveSeat(state, playerId);
  state.resourceBank.coins = card.cost;
  purchaseStaffCard(state, card.id);
}

describe('Per-seat hand capacity isolation (MS-0MV8PX0Y70006PIW)', () => {
  describe('AC1 — hiring staff for one seat increases only that seat\'s capacity', () => {
    it(
      'a staff bonus earned by seating 0 is invisible to the other seats',
      () => {
        const state = createCompetitiveState({ seed: 'ac1-hire-seat0', playerCount: 2, opponents: OPPONENTS });

        // Seat 0 hires a +1 staff card while bound.
        hireForSeat(state, 0, staffInMarket(state, 'ac1-staff-0', 1));
        expect(state.maxHandSize).toBe(BASE_HAND_CAPACITY + 1);
        restoreCompetitiveSeat(state, 0);

        // Seat 0's own capacity grew…
        expect(seatCapacity(state.players![0])).toBe(BASE_HAND_CAPACITY + 1);
        // …and the opponent seat is untouched when it takes the shared fields.
        bindCompetitiveSeat(state, 1);
        expect(state.maxHandSize).toBe(BASE_HAND_CAPACITY);
        restoreCompetitiveSeat(state, 1);

        // Mirror direction: an AI hire is equally invisible to the human seat.
        hireForSeat(state, 1, staffInMarket(state, 'ac1-staff-1', 1));
        expect(state.maxHandSize).toBe(BASE_HAND_CAPACITY + 1);
        restoreCompetitiveSeat(state, 1);
        bindCompetitiveSeat(state, 0);
        expect(state.maxHandSize).toBe(BASE_HAND_CAPACITY + 1);
      },
    );
  });

  describe('AC2 — laying off staff for one seat decreases only that seat\'s capacity', () => {
    it(
      'laying off a seat\'s staff returns only that seat to base, other seats keep their bonus',
      () => {
        const state = createCompetitiveState({ seed: 'ac2-layoff', playerCount: 2, opponents: OPPONENTS });

        // Both seats grow their own capacity (+1 each).
        hireForSeat(state, 0, staffInMarket(state, 'ac2-staff-0', 1));
        restoreCompetitiveSeat(state, 0);
        hireForSeat(state, 1, staffInMarket(state, 'ac2-staff-1', 1));
        restoreCompetitiveSeat(state, 1);

        // Alternating binds expose each seat's own grown value.
        bindCompetitiveSeat(state, 0);
        expect(state.maxHandSize).toBe(BASE_HAND_CAPACITY + 1);
        restoreCompetitiveSeat(state, 0);

        // Seat 0 lays off its own staff: only seat 0 drops back to base — the
        // shared scalar, still holding seat 1's bonus, must not resist.
        bindCompetitiveSeat(state, 0);
        layoffStaffCard(state, 'ac2-staff-0');
        expect(state.maxHandSize).toBe(BASE_HAND_CAPACITY);
        restoreCompetitiveSeat(state, 0);
        expect(seatCapacity(state.players![0])).toBe(BASE_HAND_CAPACITY);

        // Seat 1 keeps its own +1 untouched.
        bindCompetitiveSeat(state, 1);
        expect(state.maxHandSize).toBe(BASE_HAND_CAPACITY + 1);
      },
    );

    it(
      'a seat whose layoff would drop below base floors at the minimum of 2, independently of other seats',
      () => {
        const state = createCompetitiveState({ seed: 'ac2-min-two', playerCount: 2, opponents: OPPONENTS });

        // Seat 1 grows its capacity to 7, so the shared scalar can no longer
        // act as seat 0's base.
        hireForSeat(state, 1, staffInMarket(state, 'ac2-gm', 4));
        restoreCompetitiveSeat(state, 1);

        // Seat 0 lays off a +4 staff: base 3 − 4 floors at the 2 minimum —
        // never at seat 1's inflated shared value.
        bindCompetitiveSeat(state, 0);
        state.staffCards.push({ ...staffInMarket(state, 'ac2-big-0', 4) });
        layoffStaffCard(state, 'ac2-big-0');
        expect(state.maxHandSize).toBe(2);
        restoreCompetitiveSeat(state, 0);
        expect(seatCapacity(state.players![0])).toBe(2);
      },
    );
  });

  describe('AC3 — bind/restore round-trips each seat\'s own capacity', () => {
    it(
      'alternating seats each observe their own capacity across bind/restore cycles',
      () => {
        const state = createCompetitiveState({ seed: 'ac3-roundtrip', playerCount: 2, opponents: OPPONENTS });

        hireForSeat(state, 0, staffInMarket(state, 'ac3-staff-0', 1));
        restoreCompetitiveSeat(state, 0);
        hireForSeat(state, 1, staffInMarket(state, 'ac3-staff-1', 2));
        restoreCompetitiveSeat(state, 1);

        bindCompetitiveSeat(state, 0);
        expect(state.maxHandSize).toBe(BASE_HAND_CAPACITY + 1);
        restoreCompetitiveSeat(state, 0);

        bindCompetitiveSeat(state, 1);
        expect(state.maxHandSize).toBe(BASE_HAND_CAPACITY + 2);
        restoreCompetitiveSeat(state, 1);

        // A further bind of seat 0 still sees seat 0's own value — seat 1's
        // larger bonus must not stick to it across the round-trip.
        bindCompetitiveSeat(state, 0);
        expect(state.maxHandSize).toBe(BASE_HAND_CAPACITY + 1);
      },
    );
  });

  describe('AC5 — single-player behaviour is unchanged (guards that hold today)', () => {
    it('binding is a no-op in single-player and the shared capacity stays base 3', () => {
      const state = setupMainStreetGame({ seed: 'ac5-single-player' });
      expect(state.players).toBeUndefined();
      bindCompetitiveSeat(state, 0);
      expect(state.maxHandSize).toBe(BASE_HAND_CAPACITY);
    });

    it('single-player capacity stays base 3 plus the seat\'s staff handSlotsAdded', () => {
      const state = setupMainStreetGame({ seed: 'ac5-single-player-hire' });
      hireForSeat(state, 0, staffInMarket(state, 'ac5-staff', 3));
      expect(state.maxHandSize).toBe(BASE_HAND_CAPACITY + 3);
    });
  });

  describe('AC6 — guards that already hold today stay green', () => {
    it('binding an unmodified competitive seat exposes the base capacity on the shared field', () => {
      const state = createCompetitiveState({ seed: 'ac6-bind-base', playerCount: 2, opponents: OPPONENTS });
      bindCompetitiveSeat(state, 0);
      expect(state.maxHandSize).toBe(BASE_HAND_CAPACITY);
    });
  });
});
