/**
 * Main Street: Competitive AI Strategy Tests
 *
 * Leaf CG-0MT5X3N79002S038 (epic CG-0MT5X3GMA007EG30): the balancing AI's
 * decision layer made ownership-aware and staff-free for shared-street play.
 *
 * AC1 — Ownership-aware scoring: placement/upgrade/event value is evaluated
 *        against the acting player's own resources and owned businesses, with
 *        the planning horizon derived from the acting player's own score.
 * AC2 — Competitive legal-action enumeration excludes staff actions
 *        (hire-staff, peek-incident-deck); single-player enumeration unchanged.
 * AC3 — Determinism: same seed + same strategy → identical action sequences.
 * AC4 — Single-player paths unchanged (N=1 falls back to the legacy helpers).
 */
import { describe, it, expect } from 'vitest';

import {
  createCompetitiveState,
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import { createSeededRng } from '@core-engine';
import {
  enumerateCompetitiveLegalActions,
  enumerateLegalActions,
  scoreCompetitiveAction,
  scoreAction,
  aiCompetitivePlanningHorizon,
  aiPlanningHorizon,
  computeCompetitiveEventValue,
  scoreCommunitySpacePlacement,
  isCompetitiveMode,
  bindCompetitiveSeat,
  restoreCompetitiveSeat,
  CompetitiveGreedyStrategy,
} from '../../src/MainStreetAiStrategy';
import {
  executeWeekStart,
  executeCompetitiveWeekStart,
  endCompetitiveMarketTurn,
  executeAction,
  updateCompetitiveScores,
  type PlayerAction,
} from '../../src/MainStreetEngine';
import type {
  BusinessCard,
  UpgradeCard,
  EventCard,
  StaffCard,
  CommunitySpaceCard,
} from '../../src/MainStreetCards';

// ── Fixtures ─────────────────────────────────────────────────

function compState(seed = 'comp-ai', playerCount = 2): MainStreetState {
  return createCompetitiveState({ seed, playerCount });
}

function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business' as const,
    id: overrides.id ?? 'test-biz',
    name: overrides.name ?? 'Test Biz',
    cost: overrides.cost ?? 100,
    baseIncome: overrides.baseIncome ?? 50,
    synergyTypes: overrides.synergyTypes ?? [],
    maxLevel: overrides.maxLevel ?? 1,
    description: overrides.description ?? 'A test business',
    level: overrides.level ?? 0,
    incomeBonus: overrides.incomeBonus ?? 0,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    reputationBonus: overrides.reputationBonus ?? 0,
    ongoingCost: overrides.ongoingCost ?? 0,
    ...overrides,
  } as BusinessCard;
}

function makeUpgrade(overrides: Partial<UpgradeCard> = {}): UpgradeCard {
  return {
    family: 'upgrade' as const,
    id: overrides.id ?? 'test-upgrade',
    name: overrides.name ?? 'Test Upgrade',
    targetBusiness: overrides.targetBusiness ?? 'Test Biz',
    cost: overrides.cost ?? 40,
    incomeBonus: overrides.incomeBonus ?? 60,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    description: overrides.description ?? 'A test upgrade',
    requiredLevel: overrides.requiredLevel ?? 0,
    ...overrides,
  } as UpgradeCard;
}

function makeEvent(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event' as const,
    id: overrides.id ?? 'evt-test',
    name: overrides.name ?? 'Test Event',
    trigger: overrides.trigger ?? 'Incident',
    cost: overrides.cost ?? 0,
    effect: overrides.effect ?? 'Test effect',
    target: overrides.target ?? 'All',
    coinDelta: overrides.coinDelta ?? 0,
    reputationDelta: overrides.reputationDelta ?? 0,
    ...overrides,
  } as EventCard;
}

function makeStaff(overrides: Partial<StaffCard> = {}): StaffCard {
  return {
    family: 'staff' as const,
    id: overrides.id ?? 'staff-test',
    name: overrides.name ?? 'Test Staff',
    cost: overrides.cost ?? 20,
    ongoingCost: overrides.ongoingCost ?? 10,
    handSlotsAdded: overrides.handSlotsAdded ?? 0,
    description: overrides.description ?? 'A test staff member',
    specializationSkillIds: overrides.specializationSkillIds ?? [],
    ...overrides,
  } as StaffCard;
}

/** Places a card at a slot and tags its owner (mirrors engine placement). */
function place(state: MainStreetState, card: BusinessCard, slot: number, ownerId: number): void {
  state.streetGrid[slot] = card;
  state.ownerTaggedGrid![slot] = { card, ownerId };
}

/** Pads both players' wallets so acquisitions stay affordable. */
function padWallets(state: MainStreetState, amount: number): void {
  for (const p of state.players ?? []) p.coins += amount;
}

function makeCommunitySpace(
  overrides: Partial<CommunitySpaceCard> = {},
): CommunitySpaceCard {
  return {
    family: 'community-space' as const,
    id: overrides.id ?? 'test-space',
    name: overrides.name ?? 'Test Community Space',
    cost: overrides.cost ?? 300,
    baseIncome: 0,
    synergyTypes: overrides.synergyTypes ?? [],
    maxLevel: overrides.maxLevel ?? 1,
    description: overrides.description ?? 'A test community space',
    level: overrides.level ?? 0,
    incomeBonus: overrides.incomeBonus ?? 0,
    synergyRangeBonus: overrides.synergyRangeBonus ?? 0,
    reputationBonus: overrides.reputationBonus ?? 0,
    ongoingCost: overrides.ongoingCost ?? 0,
    ...overrides,
  } as CommunitySpaceCard;
}

/**
 * Competitive state with an empty street, empty market/hand and funded seats.
 * `activePlayerId` is seat 0, so the acting seat's owned slots are the ones
 * tagged `0` with `place(...)`.
 */
function emptyCompetitiveBoard(seed: string, playerCount = 2): MainStreetState {
  const state = createCompetitiveState({ seed, playerCount });
  executeCompetitiveWeekStart(state);
  state.streetGrid = new Array(state.streetGrid.length).fill(null);
  state.ownerTaggedGrid = state.ownerTaggedGrid!.map(() => ({
    card: null,
    ownerId: null,
  }));
  state.market.cards = [];
  state.hand = [];
  state.activePlayerId = 0;
  padWallets(state, 2000);
  return state;
}

// ── AC1: Ownership-aware scoring ─────────────────────────────

describe('AC1 — Ownership-aware planning horizon', () => {
  it('uses the acting player\'s own score, not the shared wallet', () => {
    const s = compState('ac1-horizon');
    s.players![0].coins = 10;
    s.players![1].coins = s.config.winThreshold - 100;
    updateCompetitiveScores(s);

    const h0 = aiCompetitivePlanningHorizon(s, 0);
    const h1 = aiCompetitivePlanningHorizon(s, 1);

    // Far from the threshold → larger horizon; near it → smaller.
    expect(h0).toBeGreaterThan(h1);
    expect(h0).toBeGreaterThanOrEqual(5);
    expect(h1).toBeGreaterThanOrEqual(5);
    expect(h0).toBeLessThanOrEqual(25);
  });

  it('defaults to the active player', () => {
    const s = compState('ac1-active');
    s.players![0].coins = 10;
    s.players![1].coins = s.config.winThreshold - 100;
    updateCompetitiveScores(s);
    s.activePlayerId = 1;
    expect(aiCompetitivePlanningHorizon(s)).toBe(aiCompetitivePlanningHorizon(s, 1));
  });

  it('N=1 competitive states use the legacy shared-wallet horizon (AC4)', () => {
    const seed = 'ac1-n1-horizon';
    const single = createCompetitiveState({ seed, playerCount: 1 });
    expect(isCompetitiveMode(single)).toBe(false);
    expect(aiCompetitivePlanningHorizon(single)).toBe(aiPlanningHorizon(single));
  });
});

describe('AC1 — Own-resource scoring', () => {
  it('scores the same placement differently for each player\'s own horizon', () => {
    const s = compState('ac1-own-resources');
    const business = makeBiz({ id: 'biz-hand', baseIncome: 100, cost: 40 });
    // Identical card at hand index 0 for both players.
    s.players![0].hand = [business];
    s.players![1].hand = [{ ...business }];
    s.players![0].coins = 100;
    s.players![1].coins = 100;
    s.players![0].score = 0;
    s.players![1].score = s.config.winThreshold - 100;

    const action: PlayerAction = { type: 'play-business-from-hand', handIndex: 0, slotIndex: 0 };
    const farScore = scoreCompetitiveAction(s, action, 0);
    const nearScore = scoreCompetitiveAction(s, action, 1);

    expect(farScore).toBeGreaterThan(nearScore);
  });

  it('restricts upgrade targets to the acting player\'s own businesses', () => {
    const s = compState('ac1-upgrade-ownership');
    padWallets(s, 500);
    s.market.cards.push(
      makeUpgrade({ id: 'upg-bakery', targetBusiness: 'Bakery', cost: 30 }),
    );
    // P1 owns the Bakery; P0 owns an unrelated business.
    place(s, makeBiz({ id: 'bakery', name: 'Bakery', level: 0, maxLevel: 1 }), 0, 1);
    place(s, makeBiz({ id: 'cafe', name: 'Cafe', level: 0, maxLevel: 1 }), 1, 0);

    const p0UpgradeActions = enumerateCompetitiveLegalActions(s, 0).filter(
      a => a.type === 'buy-upgrade' && a.cardId === 'upg-bakery',
    );
    const p1UpgradeActions = enumerateCompetitiveLegalActions(s, 1).filter(
      a => a.type === 'buy-upgrade' && a.cardId === 'upg-bakery',
    );

    expect(p0UpgradeActions).toHaveLength(0);
    expect(p1UpgradeActions).toHaveLength(1);
    expect(p1UpgradeActions[0]).toMatchObject({ targetSlot: 0 });
  });

  it('values an event using only the acting player\'s own matching businesses', () => {
    const s = compState('ac1-event-value');
    place(s, makeBiz({ id: 'f1', synergyTypes: ['Food'] }), 0, 0);
    place(s, makeBiz({ id: 'f2', synergyTypes: ['Food'] }), 1, 0);
    place(s, makeBiz({ id: 'f3', synergyTypes: ['Food'] }), 2, 1);

    const synergy = makeEvent({
      id: 'evt-synergy',
      target: 'SpecificSynergy',
      targetSynergy: 'Food',
      coinDelta: 100,
      reputationDelta: 5,
    });

    // P0 has 2 matching businesses; P1 has 1.
    expect(computeCompetitiveEventValue(s, synergy, 0)).toBe(100 * 2 + 5);
    expect(computeCompetitiveEventValue(s, synergy, 1)).toBe(100 * 1 + 5);

    // Street-wide (All) credits the full delta to both owners.
    const all = makeEvent({ id: 'evt-all', target: 'All', coinDelta: 50, reputationDelta: 2 });
    expect(computeCompetitiveEventValue(s, all, 0)).toBe(52);
    expect(computeCompetitiveEventValue(s, all, 1)).toBe(52);

    // Duration events are board-wide (host-applied) → no per-owner value.
    const duration = { ...makeEvent({ id: 'evt-dur', target: 'All', coinDelta: 30 }), duration: 2 };
    expect(computeCompetitiveEventValue(s, duration as EventCard, 0)).toBe(0);
  });
});

// ── AC2: Staff-free competitive enumeration ──────────────────

describe('AC2 — Competitive enumeration excludes staff actions', () => {
  it('never offers hire-staff even when a staff card is affordable', () => {
    const s = compState('ac2-hire');
    padWallets(s, 1000);
    s.market.cards.push(makeStaff({ id: 'staff-affordable', cost: 20 }));

    const actions = enumerateCompetitiveLegalActions(s, 0);
    expect(actions.some(a => a.type === 'hire-staff')).toBe(false);
  });

  it('never offers peek-incident-deck even with peek-capable staff', () => {
    const s = compState('ac2-peek');
    padWallets(s, 1000);
    s.players![0].staffCards = [
      makeStaff({ id: 'peek-staff', specializationSkillIds: ['peek-incident-deck'] }),
    ];

    const actions = enumerateCompetitiveLegalActions(s, 0);
    expect(actions.some(a => a.type === 'peek-incident-deck')).toBe(false);
  });

  it('single-player enumeration still offers hire-staff (unchanged)', () => {
    const single = setupMainStreetGame({ seed: 'ac2-single-staff' });
    executeWeekStart(single);
    single.resourceBank.coins = 1000;
    single.market.cards.push(makeStaff({ id: 'staff-market', cost: 20 }));

    const actions = enumerateLegalActions(single);
    expect(actions.some(a => a.type === 'hire-staff')).toBe(true);
  });
});

// ── AC3: Deterministic action sequences ──────────────────────

describe('AC3 — Deterministic competitive replay', () => {
  /** Compact, comparable signature of an action. */
  function signature(action: PlayerAction): string {
    const a = action as unknown as Record<string, unknown>;
    return [
      a.type,
      a.cardId ?? '',
      a.slotIndex ?? '',
      a.handIndex ?? '',
      a.targetSlot ?? '',
      a.direction ?? '',
    ].join(':');
  }

  /**
   * Plays one shared day of MarketPhases with the competitive greedy
   * strategy, binding/restoring each player's seat around every action so
   * the engine's shared fields track the acting wallet. Returns the recorded
   * action signatures. Stops before the shared closing phases so the
   * comparison isolates the AI decision sequence.
   */
  function playSharedMarketWeek(
    state: MainStreetState,
    rng: () => number,
    configureAfterWeekStart?: (state: MainStreetState) => void,
  ): string[] {
    executeCompetitiveWeekStart(state);
    configureAfterWeekStart?.(state);
    const recorded: string[] = [];
    const n = state.players!.length;

    for (let playerId = 0; playerId < n; playerId++) {
      state.activePlayerId = playerId;
      let guard = 0;
      for (;;) {
        bindCompetitiveSeat(state, playerId);
        const action = CompetitiveGreedyStrategy.chooseAction(state, rng);
        recorded.push(`P${playerId}=${signature(action)}`);
        if (action.type === 'end-turn') break;
        expect(guard++).toBeLessThan(16);
        executeAction(state, action);
        restoreCompetitiveSeat(state, playerId);
      }
      endCompetitiveMarketTurn(state);
    }
    return recorded;
  }

  function run(seed: string): string[] {
    const state = createCompetitiveState({ seed, playerCount: 2 });
    padWallets(state, 2000);
    return playSharedMarketWeek(state, createSeededRng(987654321));
  }

  /**
   * Like {@link run}, but seeds the street with one owner-tagged business per
   * seat so the competitive placement path queries `getSlotOwnerId` while it
   * decides. Determinism must not depend on ownership lookups.
   */
  function runWithOwnerTaggedStreet(seed: string): string[] {
    const state = createCompetitiveState({ seed, playerCount: 2 });
    padWallets(state, 2000);
    return playSharedMarketWeek(state, createSeededRng(987654321), s => {
      s.streetGrid = new Array(s.streetGrid.length).fill(null);
      s.ownerTaggedGrid = s.ownerTaggedGrid!.map(() => ({ card: null, ownerId: null }));
      place(
        s,
        makeBiz({ id: 'det-p0-food', name: 'P0 Food', baseIncome: 120, synergyTypes: ['Food'] }),
        4,
        0,
      );
      place(
        s,
        makeBiz({ id: 'det-p1-food', name: 'P1 Food', baseIncome: 120, synergyTypes: ['Food'] }),
        6,
        1,
      );
    });
  }

  it('same seed + same strategy produces identical action sequences', () => {
    const a = run('det-competitive-42');
    const b = run('det-competitive-42');

    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    // Both players acted within the shared day.
    expect(a.some(sig => sig.startsWith('P0='))).toBe(true);
    expect(a.some(sig => sig.startsWith('P1='))).toBe(true);
  });

  it('a different seed still produces a valid, terminating sequence', () => {
    const actions = run('det-competitive-other');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.filter(sig => sig.includes('end-turn')).length).toBe(2);
  });

  it('an owner-tagged street produces identical sequences for the same seed', () => {
    const a = runWithOwnerTaggedStreet('det-ownership-42');
    const b = runWithOwnerTaggedStreet('det-ownership-42');

    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });
});

// ── AC4: Single-player paths unchanged ───────────────────────

describe('AC4 — N=1 falls back to the legacy single-player helpers', () => {
  it('enumerateCompetitiveLegalActions(N=1) equals enumerateLegalActions', () => {
    const state = createCompetitiveState({ seed: 'ac4-enum', playerCount: 1 });
    executeWeekStart(state);
    expect(isCompetitiveMode(state)).toBe(false);
    expect(enumerateCompetitiveLegalActions(state, 0)).toEqual(enumerateLegalActions(state));
  });

  it('scoreCompetitiveAction(N=1) equals scoreAction for every legal action', () => {
    const state = createCompetitiveState({ seed: 'ac4-score', playerCount: 1 });
    executeWeekStart(state);
    const legal = enumerateLegalActions(state);
    expect(legal.length).toBeGreaterThan(0);
    for (const action of legal) {
      expect(scoreCompetitiveAction(state, action, 0)).toBe(scoreAction(state, action));
    }
  });
});

// ── Ownership-aware placement scoring (MS-0MUZFVJTK005YK48) ──
//
// Red phase (test-first, MS-0MUZFVJTK005YK48): the ownership-aware
// competitive placement value is delivered by the dependent feature item
// MS-0MUZFVLVS007S56L, so the assertions that depend on `own − opponent`
// scoring are expected to fail until it lands. Like the per-seat closing
// contract item (MS-0MUYFX8V3005VEOG), red-phase assertions use `it.fails` so
// the suite stays green; the implementation item flips them to `it`.

/** A neighbouring business that anchors synergy for a space placed at slot 3. */
const PLACEMENT_SLOT = 3;
const NEIGHBOUR_SLOT = 4;

/** An income-producing neighbouring business with one synergy type. */
function anchorBusiness(id: string, synergy: BusinessCard['synergyTypes'][number], baseIncome = 400): BusinessCard {
  return makeBiz({
    id,
    name: id,
    baseIncome,
    synergyTypes: [synergy],
  });
}

describe('AC2 — an opponent-only community space is rejected', () => {
  it.fails('scores an opponent-only anchor at or below zero', () => {
    const state = emptyCompetitiveBoard('opp-only-score');
    // The only synergy anchor is owned by another seat.
    place(state, anchorBusiness('cinema', 'Entertainment'), NEIGHBOUR_SLOT, 1);
    const space = makeCommunitySpace({ id: 'park', synergyTypes: ['Entertainment'] });

    const score = scoreCommunitySpacePlacement(
      state,
      space,
      PLACEMENT_SLOT,
      aiCompetitivePlanningHorizon(state, 0),
    );
    expect(score).toBeLessThanOrEqual(0);
  });

  it.fails('greedy does not buy or play the opponent-only space', () => {
    const state = emptyCompetitiveBoard('opp-only-greedy');
    state.market.cards = [
      makeCommunitySpace({ id: 'park', synergyTypes: ['Entertainment'] }),
    ];
    place(state, anchorBusiness('cinema', 'Entertainment'), NEIGHBOUR_SLOT, 1);

    const action = CompetitiveGreedyStrategy.chooseAction(state, createSeededRng(1));
    // Acquiring the card into hand is allowed; spending coins to place it on
    // the street is not.
    expect(action.type).not.toBe('buy-business');
  });
});

describe('AC3 — a self-beneficial placement is preserved', () => {
  it('scores an own-anchored community space above zero', () => {
    const state = emptyCompetitiveBoard('own-only-score');
    place(state, anchorBusiness('cinema', 'Entertainment'), NEIGHBOUR_SLOT, 0);
    const space = makeCommunitySpace({ id: 'park', synergyTypes: ['Entertainment'] });

    const score = scoreCommunitySpacePlacement(
      state,
      space,
      PLACEMENT_SLOT,
      aiCompetitivePlanningHorizon(state, 0),
    );
    expect(score).toBeGreaterThan(0);
  });

  it('greedy still selects the own-anchored community space', () => {
    const state = emptyCompetitiveBoard('own-only-greedy');
    state.market.cards = [
      makeCommunitySpace({ id: 'park', synergyTypes: ['Entertainment'] }),
    ];
    place(state, anchorBusiness('cinema', 'Entertainment'), NEIGHBOUR_SLOT, 0);

    const action = CompetitiveGreedyStrategy.chooseAction(state, createSeededRng(1));
    expect(action.type).toBe('buy-business');
    expect((action as { cardId: string }).cardId).toBe('park');
  });
});

describe('AC3 — a mixed placement is discounted', () => {
  it.fails('scores a mixed own/opponent anchor below the identical own-only anchor', () => {
    const ownBiz = anchorBusiness('own-food', 'Food', 200);
    const oppBiz = anchorBusiness('opp-culture', 'Culture', 200);
    const space = makeCommunitySpace({ id: 'community-hub', synergyTypes: ['Food', 'Culture'] });

    // Two anchors adjacent to the placement slot, one per synergy type so the
    // neighbours do not interact with each other.
    const ownOnly = emptyCompetitiveBoard('mixed-anchor');
    place(ownOnly, ownBiz, NEIGHBOUR_SLOT, 0);
    place(ownOnly, oppBiz, 8, 0);
    const ownOnlyScore = scoreCommunitySpacePlacement(
      ownOnly,
      space,
      PLACEMENT_SLOT,
      aiCompetitivePlanningHorizon(ownOnly, 0),
    );

    const mixed = emptyCompetitiveBoard('mixed-anchor');
    place(mixed, ownBiz, NEIGHBOUR_SLOT, 0);
    place(mixed, oppBiz, 8, 1);
    const mixedScore = scoreCommunitySpacePlacement(
      mixed,
      space,
      PLACEMENT_SLOT,
      aiCompetitivePlanningHorizon(mixed, 0),
    );

    expect(mixedScore).toBeLessThan(ownOnlyScore);
  });
});

describe('AC4 — an ordinary business charges the opponent benefit it anchors', () => {
  /**
   * Scores the same ordinary business placement at slot 3 next to an identical
   * neighbour whose only difference is the owner tag.
   */
  function ordinaryPlacementScore(neighbourOwnerId: number): number {
    const state = emptyCompetitiveBoard('ordinary-diff');
    const card = makeBiz({
      id: 'shop',
      name: 'Shop',
      baseIncome: 100,
      cost: 50,
      synergyTypes: ['Food'],
    });
    state.market.cards = [card];
    place(state, anchorBusiness('diner', 'Food', 200), NEIGHBOUR_SLOT, neighbourOwnerId);
    return scoreCompetitiveAction(
      state,
      { type: 'buy-business', cardId: card.id, slotIndex: PLACEMENT_SLOT } as PlayerAction,
      0,
    );
  }

  it.fails('reduces the score by the synergy it anchors for an opponent', () => {
    expect(ordinaryPlacementScore(1)).toBeLessThan(ordinaryPlacementScore(0));
  });

  it('keeps the ordinary business action positive (still eligible)', () => {
    expect(ordinaryPlacementScore(1)).toBeGreaterThan(0);
  });
});

describe('AC5 — single-player scoring is unchanged (N=1)', () => {
  it('ignores owner tags when the state is not competitive', () => {
    const seed = 'n1-ownership';
    const neighbour = anchorBusiness('cinema', 'Entertainment');
    const space = makeCommunitySpace({ id: 'park', synergyTypes: ['Entertainment'] });

    // N=1 competitive states carry an `ownerTaggedGrid` but are not
    // competitive; the ownership-aware branch must not trigger. The neighbour
    // is deliberately tagged to a non-acting seat.
    const n1 = createCompetitiveState({ seed, playerCount: 1 });
    executeWeekStart(n1);
    n1.streetGrid = new Array(n1.streetGrid.length).fill(null);
    n1.market.cards = [];
    place(n1, neighbour, NEIGHBOUR_SLOT, 1);

    // The equivalent state built through the single-player setup (no tags).
    const single = setupMainStreetGame({ seed });
    executeWeekStart(single);
    single.streetGrid = new Array(single.streetGrid.length).fill(null);
    single.streetGrid[NEIGHBOUR_SLOT] = neighbour;

    const horizon = aiPlanningHorizon(single);
    expect(isCompetitiveMode(n1)).toBe(false);
    expect(scoreCommunitySpacePlacement(n1, space, PLACEMENT_SLOT, horizon)).toBe(
      scoreCommunitySpacePlacement(single, space, PLACEMENT_SLOT, horizon),
    );
  });
});
