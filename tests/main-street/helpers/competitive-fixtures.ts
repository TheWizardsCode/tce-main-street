/**
 * Main Street: Competitive end-condition test harness & fixtures.
 *
 * Deterministic test builder and assertion helpers for competitive
 * end-condition scenarios (per-seat failure, AI elimination,
 * last-standing win). Provides reusable fixtures consumed by
 * the per-seat evaluation, elimination, human-collapse, and
 * last-standing feature tests (MS-0MUVBH589001L7NL children).
 *
 * @module tests/main-street/helpers/competitive-fixtures
 */

import type { MainStreetState, OwnerTaggedSlot, PlayerRecord, SeatController } from '../../../src/MainStreetState';
import type { BusinessCard, CommunitySpaceCard } from '../../../src/MainStreetCards';
import { createCompetitiveState } from '../../../src/MainStreetState';
import {
  checkCompetitiveEndConditions,
  updateCompetitiveScores,
} from '../../../src/MainStreetEngine';
import type { DifficultyName } from '../../../src/MainStreetDifficulty';
import type { GameResult, EndReason } from '../../../src/MainStreetState';

// ── Types ─────────────────────────────────────────────────────

/**
 * Per-seat wallet override for the builder.
 */
export interface SeatWalletOverride {
  /** Index into `state.players` (0 = first seat). */
  playerId: number;
  /** Coins to set (after initialisation). */
  coins: number;
  /** Reputation to set (after initialisation). */
  reputation: number;
}

/**
 * Slot ownership override: assign a card and owner to a grid slot.
 */
export interface SlotOwnershipOverride {
  /** Grid slot index (0–GRID_SIZE-1). */
  slotIndex: number;
  /** Owner index — `null` means unowned (slot cleared). */
  ownerId: number | null;
  /** Card to place (or `null` to remove). */
  card: BusinessCard | CommunitySpaceCard | null;
}

/**
 * Per-seat terminal snapshot for end-condition assertions.
 */
export interface SeatSnapshot {
  playerId: number;
  coins: number;
  reputation: number;
  score: number;
  controller: SeatController | undefined;
  /** Whether this seat has been eliminated (absent = not eliminated). */
  eliminated: boolean;
}

/**
 * Result of evaluating competitive end-conditions.
 */
export interface EndConditionResult {
  ended: boolean;
  gameResult: GameResult | null;
  endReason: EndReason | null;
  competitiveWinnerId: number | null;
  /** Per-seat snapshots (refreshed scores). */
  seats: SeatSnapshot[];
  /** The state after evaluation. */
  state: MainStreetState;
}

/**
 * Options for building a deterministic competitive test state.
 */
export interface BuildCompetitiveStateOptions {
  /** Seed for deterministic deck/incident generation. */
  seed: string;
  /** Number of seats (default 2). */
  playerCount?: number;
  /** Per-seat wallet overrides. */
  seatWallets?: SeatWalletOverride[];
  /** Per-seat ownership overrides on the grid. */
  slotOverrides?: SlotOwnershipOverride[];
  /** Difficulty preset (default 'Medium'). */
  difficulty?: DifficultyName;
  /** Override `winThreshold` (default from config). */
  winThreshold?: number;
}

// ── Builders ──────────────────────────────────────────────────

/**
 * Builds a deterministic competitive state with per-seat wallet
 * overrides and optional slot ownership.
 *
 * The builder:
 * 1. Creates a competitive state from the seed.
 * 2. Applies per-seat coins/reputation overrides.
 * 3. Applies grid slot ownership overrides.
 * 4. Refreshes competitive scores.
 *
 * Determinism: same `BuildCompetitiveStateOptions` produces
 * deep-equal `state.players` coins/reputation/score and
 * `state.ownerTaggedGrid` card/ownerId — no reliance on
 * `Date.now()`, global RNG, or unordered iteration.
 *
 * @param opts - Construction options.
 * @returns A mutable `MainStreetState` ready for closing tests.
 */
export function buildCompetitiveState(opts: BuildCompetitiveStateOptions): MainStreetState {
  const {
    seed,
    playerCount = 2,
    seatWallets = [],
    slotOverrides = [],
    difficulty,
    winThreshold,
  } = opts;

  const state = createCompetitiveState({ seed, playerCount, difficulty });

  // Override winThreshold if specified.
  if (winThreshold !== undefined) {
    state.config = { ...state.config, winThreshold } as typeof state.config;
  }

  // Apply per-seat wallet overrides.
  for (const override of seatWallets) {
    const player = state.players![override.playerId];
    player.coins = override.coins;
    player.reputation = override.reputation;
  }

  // Apply grid slot ownership overrides.
  for (const override of slotOverrides) {
    const slot = state.ownerTaggedGrid![override.slotIndex];
    slot.ownerId = override.ownerId;
    slot.card = override.card;
  }

  updateCompetitiveScores(state);

  return state;
}

/**
 * Convenience builder: 1 human + N AI seats with per-seat
 * wallet overrides. Human seat is index 0 (controller = 'human');
 * all others default to 'ai'.
 *
 * @param seed       - Deterministic seed.
 * @param aiCount    - Number of AI seats (default 1).
 * @param wallets    - Per-seat [coins, reputation] for all N+1 seats.
 * @param winThreshold - Custom threshold (optional).
 */
export function buildHumanVsAis(
  seed: string,
  aiCount: number,
  wallets: Array<[coins: number, reputation: number]>,
  winThreshold?: number,
): MainStreetState {
  const playerCount = 1 + aiCount;
  if (wallets.length !== playerCount) {
    throw new Error(
      `buildHumanVsAis: expected ${playerCount} wallets for ${playerCount} seats, got ${wallets.length}`,
    );
  }

  const seatWallets: SeatWalletOverride[] = wallets.map(
    ([coins, reputation], i) => ({ playerId: i, coins, reputation }),
  );

  const state = buildCompetitiveState({
    seed,
    playerCount,
    seatWallets,
    winThreshold,
  });

  // Ensure seat 0 is human, others are AI.
  state.players![0].controller = 'human';
  for (let i = 1; i < playerCount; i++) {
    state.players![i].controller = 'ai';
  }

  return state;
}

/**
 * Builds a multi-AI competitive state (no human).
 * Useful for testing elimination when only AI seats exist.
 *
 * @param seed       - Deterministic seed.
 * @param aiCount    - Number of AI seats (default 2).
 * @param wallets    - Per-seat [coins, reputation].
 */
export function buildAiOnly(
  seed: string,
  aiCount: number,
  wallets: Array<[coins: number, reputation: number]>,
): MainStreetState {
  if (wallets.length !== aiCount) {
    throw new Error(
      `buildAiOnly: expected ${aiCount} wallets, got ${wallets.length}`,
    );
  }

  const seatWallets: SeatWalletOverride[] = wallets.map(
    ([coins, reputation], i) => ({ playerId: i, coins, reputation }),
  );

  const state = buildCompetitiveState({ seed, playerCount: aiCount, seatWallets });

  for (let i = 0; i < aiCount; i++) {
    state.players![i].controller = 'ai';
  }

  return state;
}

// ── Assertion helpers ─────────────────────────────────────────

/**
 * Evaluates competitive end-conditions and returns a structured
 * result with per-seat snapshots.
 *
 * This is the canonical assertion helper for end-condition tests:
 * given a state, it runs `checkCompetitiveEndConditions`, refreshes
 * scores, and returns an object whose fields are asserted in
 * acceptance criteria.
 */
export function evaluateEndConditions(state: MainStreetState): EndConditionResult {
  const ended = checkCompetitiveEndConditions(state);
  updateCompetitiveScores(state);

  const seats: SeatSnapshot[] = (state.players ?? []).map(p => ({
    playerId: p.playerId,
    coins: p.coins,
    reputation: p.reputation,
    score: p.score,
    controller: p.controller,
    eliminated: (p as PlayerRecord & { eliminated?: boolean }).eliminated === true,
  }));

  return {
    ended,
    gameResult: state.gameResult,
    endReason: state.endReason ?? null,
    competitiveWinnerId: state.competitiveWinnerId ?? null,
    seats,
    state,
  };
}

/**
 * Asserts that the end-condition result matches expected values.
 * Useful for targeted assertions in smoke tests.
 */
export function expectEndCondition(
  result: EndConditionResult,
  expected: Partial<{
    ended: boolean;
    gameResult: GameResult | null;
    endReason: EndReason | null;
    competitiveWinnerId: number | null;
  }>,
): void {
  if (expected.ended !== undefined) expect(result.ended).toBe(expected.ended);
  if (expected.gameResult !== undefined) expect(result.gameResult).toBe(expected.gameResult);
  if (expected.endReason !== undefined) expect(result.endReason).toBe(expected.endReason);
  if (expected.competitiveWinnerId !== undefined)
    expect(result.competitiveWinnerId).toBe(expected.competitiveWinnerId);
}

/**
 * Asserts that a specific seat has the given wallet values.
 */
export function expectSeatWallet(
  seats: SeatSnapshot[],
  playerId: number,
  expectedCoins: number,
  expectedReputation: number,
): void {
  const seat = seats.find(s => s.playerId === playerId);
  if (!seat) throw new Error(`Seat ${playerId} not found in snapshots`);
  expect(seat.coins).toBe(expectedCoins);
  expect(seat.reputation).toBe(expectedReputation);
}

/**
 * Asserts that a specific seat's elimination flag matches the expectation.
 */
export function expectSeatEliminated(
  seats: SeatSnapshot[],
  playerId: number,
  expected: boolean,
): void {
  const seat = seats.find(s => s.playerId === playerId);
  if (!seat) throw new Error(`Seat ${playerId} not found in snapshots`);
  expect(seat.eliminated).toBe(expected);
}

// ── Determinism helpers ───────────────────────────────────────

/**
 * Deep-compares two competitive states' observable player fields
 * (coins, reputation, score) and owner-tagged grid slots.
 * Used to verify builder determinism.
 */
export function statesAreEquivalent(
  s1: MainStreetState,
  s2: MainStreetState,
): boolean {
  if (s1.players?.length !== s2.players?.length) return false;
  if ((s1.ownerTaggedGrid?.length ?? 0) !== (s2.ownerTaggedGrid?.length ?? 0)) return false;

  for (let i = 0; i < (s1.players?.length ?? 0); i++) {
    const a = s1.players![i];
    const b = s2.players![i];
    if (a.coins !== b.coins || a.reputation !== b.reputation || a.score !== b.score) return false;
  }

  for (let i = 0; i < (s1.ownerTaggedGrid?.length ?? 0); i++) {
    const a = s1.ownerTaggedGrid![i] as OwnerTaggedSlot;
    const b = s2.ownerTaggedGrid![i] as OwnerTaggedSlot;
    if (a.ownerId !== b.ownerId) return false;
    if (a.card?.id !== b.card?.id) return false;
  }

  return true;
}

// ── Utility ───────────────────────────────────────────────────

/**
 * Returns `true` when the given state has competitive mode active
 * (`state.players` present and non-empty).
 */
export function isCompetitiveMode(state: MainStreetState): boolean {
  return state.players !== null && state.players !== undefined && state.players.length > 0;
}

/**
 * Finds the human seat index by scanning `controller === 'human'`.
 * Returns `-1` if no human seat is found.
 */
export function findHumanSeat(state: MainStreetState): number {
  const idx = state.players?.findIndex(p => p.controller === 'human') ?? -1;
  return idx;
}

/**
 * Count AI seats (controller === 'ai' or controller absent and N > 1).
 */
export function countAiSeats(state: MainStreetState): number {
  return (state.players ?? []).filter(p => p.controller === 'ai').length;
}

/**
 * Count non-eliminated seats. (The `eliminated` field is optional; absent
 * means `false`.)
 */
export function countActiveSeats(state: MainStreetState): number {
  return (state.players ?? []).filter(p => !(p as PlayerRecord & { eliminated?: boolean }).eliminated).length;
}
