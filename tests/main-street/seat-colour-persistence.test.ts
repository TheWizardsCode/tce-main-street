/**
 * Main Street: Seat colour persistence tests
 *
 * Feature F2 (MS-0MV34KGVO001GRNP) of epic MS-0MUWNTN8W006C7EF — verify that
 * competitive setup assigns a distinct colour-blind-safe colour to every seat
 * and that the assignment round-trips through save/load unchanged:
 *
 *   AC2 — `createCompetitiveState` assigns a palette colour to each seat.
 *   AC3/AC4 — serialization/deserialization preserve the per-seat colour.
 *   AC5 — single-player (one human seat) needs no colour assignment.
 *   AC6 — assign → save → load → colours identical.
 *
 * The colour derivation is a dedicated seeded stream, so it must stay
 * deterministic per seed without consuming the main gameplay RNG.
 */
import { describe, expect, it } from 'vitest';

import {
  createCompetitiveState,
  deserializeMainStreetState,
  serializeMainStreetState,
  setupMainStreetGame,
  type CompetitiveOpponentConfig,
  type MainStreetSerializedState,
  type MainStreetState,
} from '../../src/MainStreetState';
import { SEAT_COLOUR_PALETTE } from '../../src/MainStreetSeatColours';

const OPPONENTS: CompetitiveOpponentConfig[] = [
  { strategy: 'Random', difficulty: 'Easy' },
  { strategy: 'BankingGreedy', difficulty: 'Hard' },
];

/** Every seat of a competitive state. */
function seats(state: MainStreetState) {
  return state.players ?? [];
}

/** Palette colours of the requested seats, in seat order. */
function seatColours(state: MainStreetState): (string | undefined)[] {
  return seats(state).map((seat) => seat.colour);
}

/** Fresh competitive state with the standard three seats. */
function threeSeatState(seed: string): MainStreetState {
  return createCompetitiveState({ seed, playerCount: 3, opponents: OPPONENTS });
}

// ── AC2 — assignment during competitive setup ───────────────

describe('AC2 — createCompetitiveState assigns seat colours', () => {
  it('gives every competitive seat a distinct palette colour', () => {
    const state = threeSeatState('seat-colour-assign');

    const colours = seatColours(state);
    expect(colours).toHaveLength(3);
    for (const colour of colours) {
      expect(colour).toBeDefined();
      expect(SEAT_COLOUR_PALETTE).toContain(colour);
    }
    expect(new Set(colours).size).toBe(colours.length);
  });

  it('colours the human seat as well as every AI seat', () => {
    const state = threeSeatState('seat-colour-human');

    expect(state.players![0].controller).toBe('human');
    expect(state.players![0].colour).toBeDefined();
    for (const seat of state.players!.slice(1)) {
      expect(seat.controller).toBe('ai');
      expect(seat.colour).toBeDefined();
      expect(seat.colour).not.toBe(state.players![0].colour);
    }
  });

  it('is deterministic for a given seed', () => {
    const first = threeSeatState('seat-colour-determinism');
    const second = threeSeatState('seat-colour-determinism');

    expect(seatColours(second)).toEqual(seatColours(first));
  });

  it('does not consume the main gameplay RNG (rngCalls independent of seat count)', () => {
    // A dedicated seeded stream derives the colours, so adding seats must not
    // advance the main RNG relative to a same-seed game with fewer seats.
    const twoSeat = createCompetitiveState({ seed: 'seat-colour-rng', playerCount: 2 });
    const fourSeat = createCompetitiveState({ seed: 'seat-colour-rng', playerCount: 4 });

    expect(fourSeat.rngCalls).toBe(twoSeat.rngCalls);
  });
});

// ── AC5 — single-player has no colour assignment ────────────

describe('AC5 — single-player needs no seat colour', () => {
  it('leaves colour unassigned for a one-seat competitive game', () => {
    const state = createCompetitiveState({ seed: 'seat-colour-solo', playerCount: 1 });

    expect(state.players).toHaveLength(1);
    expect(state.players![0].controller).toBe('human');
    expect(state.players![0].colour).toBeUndefined();
  });

  it('creates no seats (and so no colours) for single-player setup', () => {
    const state = setupMainStreetGame({ seed: 'seat-colour-single', difficulty: 'Medium' });

    expect(state.players).toBeUndefined();
  });
});

// ── AC3/AC4/AC6 — save/load round-trip ──────────────────────

describe('AC3/AC4/AC6 — seat colours survive save/load', () => {
  it('round-trips every seat colour unchanged', () => {
    const state = threeSeatState('seat-colour-round-trip');
    const restored = deserializeMainStreetState(serializeMainStreetState(state));

    expect(seatColours(restored)).toEqual(seatColours(state));
    expect(restored.players).toHaveLength(3);
  });

  it('round-trips the full player records byte-identically (colour included)', () => {
    const state = threeSeatState('seat-colour-round-trip-bytes');
    const restored = deserializeMainStreetState(serializeMainStreetState(state));

    expect(JSON.stringify(restored.players)).toBe(JSON.stringify(state.players));
  });

  it('re-derives colours for a legacy competitive save that lacks them', () => {
    const state = threeSeatState('seat-colour-legacy');
    const saved = JSON.parse(
      JSON.stringify(serializeMainStreetState(state)),
    ) as MainStreetSerializedState & { players: Array<Record<string, unknown>> };
    for (const player of saved.players) {
      delete player.colour;
    }

    const restored = deserializeMainStreetState(saved as MainStreetSerializedState);

    // The defensive fallback restores the same deterministic assignment.
    expect(seatColours(restored)).toEqual(seatColours(state));
  });

  it('fills only the missing colours, leaving existing ones untouched', () => {
    const state = threeSeatState('seat-colour-partial');
    state.players![0].colour = '#123456';
    const saved = JSON.parse(
      JSON.stringify(serializeMainStreetState(state)),
    ) as MainStreetSerializedState & { players: Array<Record<string, unknown>> };
    delete saved.players[1].colour;

    const restored = deserializeMainStreetState(saved as MainStreetSerializedState);

    expect(restored.players![0].colour).toBe('#123456');
    expect(restored.players![1].colour).toBeDefined();
    expect(restored.players![1].colour).toBe(state.players![1].colour);
  });
});
