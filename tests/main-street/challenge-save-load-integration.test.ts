/**
 * Main Street: Per-Seat Challenge Attribution Save/Load Integration
 *
 * Integration tests (child MS-0MV33TSK20076Q36 of epic MS-0MUWNTJIK009O6BZ)
 * exercising the REAL checkpoint pipeline — `SaveLoadStore` plus
 * `saveTurnStartCheckpoint` / `loadTurnStartCheckpoint` — rather than the bare
 * serializer. This verifies per-seat challenge attribution survives the same
 * persistence path the game uses, including the legacy fallback for saves that
 * predate attribution.
 *
 * Coverage:
 *  1. AC1 — a mixed human/AI completion set survives a real checkpoint
 *     round-trip with each completion's `completedBySeatId` intact.
 *  2. AC1 — per-seat scoring after load credits each seat only for its own
 *     completions (no cross-seat leakage).
 *  3. AC1 — a challenge completed after a load is attributed to the acting
 *     seat (guards against collapsing incomplete `undefined` to `null`).
 *  4. AC2 — a legacy attribution-free single-player checkpoint loads without
 *     error and keeps its global challenge scoring.
 *  5. AC2 — a legacy attribution-free competitive checkpoint loads without
 *     error and credits no seat (no misattribution).
 *
 * @module
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveLoadStore } from '@core-engine';

import {
  createCompetitiveState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  loadTurnStartCheckpoint,
  mainStreetStateSerializer,
  saveTurnStartCheckpoint,
} from '../../src/MainStreetSaveLoad';
import {
  CHALLENGE_TEMPLATES,
  evaluateChallenges,
  type ActiveChallenge,
} from '../../src/MainStreetChallenges';
import {
  computeScore,
  updateCompetitiveScores,
} from '../../src/MainStreetEngineScoring';

// ── localStorage mock (the checkpoint backend in the node test env) ─────────

function createLocalStorageMock(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
  };
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', undefined);
  vi.stubGlobal('localStorage', createLocalStorageMock());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── Helpers ─────────────────────────────────────────────────

/** Finds a challenge template by ID (throws if missing). */
function template(id: string): ActiveChallenge['challenge'] {
  const t = CHALLENGE_TEMPLATES.find(c => c.id === id);
  if (!t) throw new Error(`Challenge template '${id}' not found`);
  return t;
}

/** Replaces the active challenges with the given IDs (all incomplete). */
function activate(state: MainStreetState, ...ids: string[]): void {
  state.activeChallenges = ids.map(id => ({
    challenge: template(id),
    completed: false,
  }));
}

/** The `ActiveChallenge` record for a challenge id (throws if missing). */
function record(state: MainStreetState, id: string): ActiveChallenge {
  const ac = state.activeChallenges.find(c => c.challenge.id === id);
  if (!ac) throw new Error(`Active challenge '${id}' not found`);
  return ac;
}

/** A 2-seat competitive state: seat 0 is human, seat 1 is AI. */
function competitiveState(seed: string): MainStreetState {
  return createCompetitiveState({ seed, playerCount: 2 });
}

/**
 * Persists `state` as a legacy checkpoint: the real serialized shape with the
 * per-seat attribution field stripped from every active challenge, exactly as
 * a save written before MS-0MUWNTJIK009O6BZ would look.
 */
async function saveLegacyCheckpoint(store: SaveLoadStore, state: MainStreetState): Promise<void> {
  const data = mainStreetStateSerializer.serialize(state);
  for (const ac of data.activeChallenges) {
    delete (ac as { completedBySeatId?: number | null }).completedBySeatId;
  }
  await store.save(
    'run-checkpoint',
    'main-street',
    'turn-start',
    mainStreetStateSerializer.schemaVersion,
    { schemaVersion: mainStreetStateSerializer.schemaVersion, data },
  );
}

// ── AC1 · Real checkpoint round-trip preserves attribution ──

describe('checkpoint save/load · per-seat attribution (AC1)', () => {
  it('round-trips a mixed human/AI completion set through the real checkpoint pipeline', async () => {
    const store = new SaveLoadStore();
    const state = competitiveState('ckpt-attribution-mixed');
    activate(state, 'ch-deep-pockets', 'ch-beloved-mayor');

    // The AI seat (1) completes Deep Pockets.
    state.resourceBank.coins = 3000;
    state.resourceBank.reputation = 0;
    evaluateChallenges(state.activeChallenges, state, 1);
    // The human seat (0) completes Beloved Mayor.
    state.resourceBank.coins = 0;
    state.resourceBank.reputation = 1000;
    evaluateChallenges(state.activeChallenges, state, 0);

    await saveTurnStartCheckpoint(store, state);
    const restored = await loadTurnStartCheckpoint(store);

    expect(restored).not.toBeNull();
    expect(record(restored!, 'ch-deep-pockets').completed).toBe(true);
    expect(record(restored!, 'ch-deep-pockets').completedBySeatId).toBe(1);
    expect(record(restored!, 'ch-beloved-mayor').completed).toBe(true);
    expect(record(restored!, 'ch-beloved-mayor').completedBySeatId).toBe(0);
    expect(restored!.challengesCompleted).toEqual(['ch-deep-pockets', 'ch-beloved-mayor']);
    // Template references are re-bound on load, not left as serialized IDs.
    expect(record(restored!, 'ch-deep-pockets').challenge).toBe(template('ch-deep-pockets'));
  });

  it('keeps per-seat scoring correct after a checkpoint load', async () => {
    const store = new SaveLoadStore();
    const state = competitiveState('ckpt-attribution-scoring');
    activate(state, 'ch-deep-pockets', 'ch-beloved-mayor');

    // Seat 1 completes Deep Pockets; seat 0 completes Beloved Mayor.
    state.resourceBank.coins = 3000;
    state.resourceBank.reputation = 0;
    evaluateChallenges(state.activeChallenges, state, 1);
    state.resourceBank.coins = 0;
    state.resourceBank.reputation = 1000;
    evaluateChallenges(state.activeChallenges, state, 0);

    await saveTurnStartCheckpoint(store, state);
    const restored = (await loadTurnStartCheckpoint(store))!;

    restored.players![0].coins = 100;
    restored.players![0].reputation = 10;
    restored.players![1].coins = 200;
    restored.players![1].reputation = 20;
    updateCompetitiveScores(restored);

    const bonus = restored.config.challengeBonusPoints;
    // Each seat gets exactly one own completion, never the other seat's.
    expect(restored.players![0].score).toBe(100 + 10 + bonus);
    expect(restored.players![1].score).toBe(200 + 20 + bonus);
  });

  it('attributes a challenge completed after a load to the acting seat', async () => {
    const store = new SaveLoadStore();
    const state = competitiveState('ckpt-attribution-after-load');
    activate(state, 'ch-deep-pockets');

    await saveTurnStartCheckpoint(store, state);
    const restored = (await loadTurnStartCheckpoint(store))!;
    // Still incomplete and unattributed after the round-trip.
    expect(record(restored, 'ch-deep-pockets').completedBySeatId).toBeUndefined();

    // Seat 1 completes it after the load; the attribution must be written now.
    restored.resourceBank.coins = 3000;
    expect(evaluateChallenges(restored.activeChallenges, restored, 1)).toEqual([
      'ch-deep-pockets',
    ]);
    expect(record(restored, 'ch-deep-pockets').completedBySeatId).toBe(1);
  });
});

// ── AC2 · Legacy attribution-free saves ─────────────────────

describe('checkpoint save/load · legacy fallback (AC2)', () => {
  it('loads a legacy single-player checkpoint and keeps global challenge scoring', async () => {
    const store = new SaveLoadStore();
    const state = setupMainStreetGame({ seed: 'ckpt-legacy-single' });
    activate(state, 'ch-deep-pockets');
    state.resourceBank.coins = 3000;
    evaluateChallenges(state.activeChallenges, state);

    await saveLegacyCheckpoint(store, state);
    const restored = (await loadTurnStartCheckpoint(store))!;

    // Loaded without error, completion retained, treated as global.
    expect(record(restored, 'ch-deep-pockets').completed).toBe(true);
    expect(record(restored, 'ch-deep-pockets').completedBySeatId).toBeNull();
    expect(restored.challengesCompleted).toEqual(['ch-deep-pockets']);
    // Single-player scoring is the run-global count × bonus (unchanged).
    expect(computeScore(restored)).toBe(
      restored.ledger.get('coins') +
        restored.ledger.get('reputation') +
        1 * restored.config.challengeBonusPoints,
    );
  });

  it('loads a legacy competitive checkpoint without crediting any seat', async () => {
    const store = new SaveLoadStore();
    const state = competitiveState('ckpt-legacy-competitive');
    activate(state, 'ch-deep-pockets');
    state.resourceBank.coins = 3000;
    evaluateChallenges(state.activeChallenges, state, 1);

    await saveLegacyCheckpoint(store, state);
    const restored = (await loadTurnStartCheckpoint(store))!;

    // Unattributed legacy completion → null, never guessed to a seat.
    expect(record(restored, 'ch-deep-pockets').completed).toBe(true);
    expect(record(restored, 'ch-deep-pockets').completedBySeatId).toBeNull();

    restored.players![0].coins = 50;
    restored.players![0].reputation = 5;
    restored.players![1].coins = 70;
    restored.players![1].reputation = 7;
    updateCompetitiveScores(restored);

    // No seat is credited with the unattributed legacy completion.
    expect(restored.players![0].score).toBe(50 + 5);
    expect(restored.players![1].score).toBe(70 + 7);
  });
});
