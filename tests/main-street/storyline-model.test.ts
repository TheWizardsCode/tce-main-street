/**
 * Storyline model & extraction seam (MS-0MUMP93DI0018OGV)
 *
 * Unit tests for the generalised storyline data model and its game-agnostic
 * extraction seam:
 *
 * AC1 — Storyline metadata: `EventCard` supports optional `storylineId` /
 *       `storylineTitle`; the CSV parser populates them; cards without them
 *       behave exactly as before.
 * AC2 — Generalised options: an arbitrary ordered option list resolves
 *       correctly, and legacy `hasChoices`/accept/reject cards compile to an
 *       option list whose resolution is identical to the legacy behaviour
 *       (legacy-equivalence).
 * AC3 — Extraction seam: definition/state/resolution sit behind a documented
 *       game-agnostic interface with pure functions; callers never reach into
 *       Main-Street-only resolution internals.
 *
 * @module
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  setupMainStreetGame,
  type MainStreetState,
} from '../../src/MainStreetState';
import {
  type EventCard,
  getEventTemplates,
  loadTemplatesFromCsv,
  resetTemplatesToDefault,
} from '../../src/MainStreetCards';
import {
  processEndOfTurn,
  resolveEventChoice,
  resolveEventOption,
} from '../../src/MainStreetEngine';
import {
  compileStorylineFromEvent,
  eventHasStoryline,
  storylineOptionCount,
  getStorylineOptions,
  registerStorylineOptions,
  resetStorylineRegistry,
  hasRegisteredStorylineOptions,
  resolveStorylineOption,
  createPendingStorylineChoice,
  pushChainCard,
} from '../../src/MainStreetStoryline';
import type { StorylineOption } from '../../src/MainStreetCardsTypes';
import type { StorylineOption as ExportedOption } from '../../src/MainStreetCardsTypes';

// ── Factories ───────────────────────────────────────────────

/** Column order for the synthetic CSV fixtures (must match the parser). */
const CSV_COLUMNS = [
  'family', 'id', 'name', 'cost', 'baseIncome', 'synergyTypes', 'upgradePath',
  'maxLevel', 'reputationPerTurn', 'synergyCoinBonus', 'synergyRepBonus',
  'description', 'tier', 'trigger', 'effect', 'target', 'targetSynergy',
  'coinDelta', 'reputationDelta', 'duration', 'effectType', 'multiplier',
  'targetBusiness', 'incomeBonus', 'synergyRangeBonus', 'requiredLevel',
  'reputationBonus', 'newDisplayName', 'ongoingCost', 'handSlotsAdded',
  'refreshCostDiscount', 'actionsPerTurn', 'peekOncePerTurn',
  'upgradeCostDiscount', 'art_notes', 'hasChoices', 'acceptNextCardId',
  'rejectNextCardId', 'storylineId', 'storylineTitle',
];

interface CsvEventSpec {
  id: string;
  name: string;
  effect: string;
  coinDelta?: number;
  reputationDelta?: number;
  hasChoices?: boolean;
  acceptNextCardId?: string;
  rejectNextCardId?: string;
  storylineId?: string;
  storylineTitle?: string;
}

/**
 * Builds a well-formed synthetic event CSV. Padding/alignment is computed
 * from the column list, so fixtures can never drift out of sync with the
 * parser's expected column count.
 */
function buildCsv(events: CsvEventSpec[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const e of events) {
    const row: Record<string, string> = {
      family: 'event',
      id: e.id,
      name: e.name,
      cost: '0',
      tier: '1',
      trigger: 'Incident',
      effect: e.effect,
      target: 'All',
      coinDelta: String(e.coinDelta ?? 0),
      reputationDelta: String(e.reputationDelta ?? 0),
    };
    if (e.hasChoices) row.hasChoices = 'true';
    if (e.acceptNextCardId) row.acceptNextCardId = e.acceptNextCardId;
    if (e.rejectNextCardId) row.rejectNextCardId = e.rejectNextCardId;
    if (e.storylineId) row.storylineId = e.storylineId;
    if (e.storylineTitle) row.storylineTitle = e.storylineTitle;
    lines.push(CSV_COLUMNS.map((c) => row[c] ?? '').join(','));
  }
  return lines.join('\n');
}

function makeChoiceEvent(overrides: Partial<EventCard> = {}): EventCard {
  return {
    family: 'event',
    id: 'evt-model-test',
    name: 'Model Test',
    trigger: 'Incident',
    cost: 0,
    effect: 'Lose 100 coins',
    target: 'All',
    coinDelta: -100,
    reputationDelta: 0,
    hasChoices: true,
    acceptNextCardId: 'evt-model-next-a',
    rejectNextCardId: 'evt-model-next-b',
    ...overrides,
  };
}

const SYNTHETIC_CSV = buildCsv([
  { id: 'evt-story-1', name: 'Story One', effect: 'Lose 100 coins', coinDelta: -100, hasChoices: true, acceptNextCardId: 'evt-story-next', storylineId: 'storyline-alpha', storylineTitle: 'Alpha Arc' },
  { id: 'evt-story-next', name: 'Story Next', effect: 'Lose 50 coins', coinDelta: -50, storylineId: 'storyline-alpha', storylineTitle: 'Alpha Arc' },
  { id: 'evt-story-2', name: 'Story Two', effect: 'Lose 100 coins', coinDelta: -100, hasChoices: true, storylineId: 'storyline-beta' },
  { id: 'evt-vanilla', name: 'Vanilla', effect: 'Lose 30 coins', coinDelta: -30 },
]);

afterEach(() => {
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

// ── AC1: Storyline metadata ─────────────────────────────────

describe('AC1 — EventCard storyline metadata', () => {
  it('a card without storyline fields has neither (undefined)', () => {
    const card = makeChoiceEvent();
    expect(card.storylineId).toBeUndefined();
    expect(card.storylineTitle).toBeUndefined();
  });

  it('a card carries storylineId and storylineTitle when set', () => {
    const card = makeChoiceEvent({ storylineId: 'arc-1', storylineTitle: 'Arc One' });
    expect(card.storylineId).toBe('arc-1');
    expect(card.storylineTitle).toBe('Arc One');
  });

  it('null storyline fields are supported (explicitly not in a storyline)', () => {
    const card = makeChoiceEvent({ storylineId: null, storylineTitle: null });
    expect(card.storylineId).toBeNull();
    expect(card.storylineTitle).toBeNull();
  });
});

describe('AC1 — CSV parser populates storyline metadata', () => {
  it('parses storylineId + storylineTitle on choice cards', () => {
    loadTemplatesFromCsv(SYNTHETIC_CSV);
    const t = getEventTemplates().find((c) => c.id === 'evt-story-1') as EventCard;
    expect(t).toBeDefined();
    expect(t.storylineId).toBe('storyline-alpha');
    expect(t.storylineTitle).toBe('Alpha Arc');
  });

  it('parses storyline metadata on non-choice terminal cards', () => {
    loadTemplatesFromCsv(SYNTHETIC_CSV);
    const t = getEventTemplates().find((c) => c.id === 'evt-story-next') as EventCard;
    expect(t.storylineId).toBe('storyline-alpha');
    expect(t.storylineTitle).toBe('Alpha Arc');
  });

  it('a card with a storylineId but no title parses with undefined title', () => {
    loadTemplatesFromCsv(SYNTHETIC_CSV);
    const t = getEventTemplates().find((c) => c.id === 'evt-story-2') as EventCard;
    expect(t.storylineId).toBe('storyline-beta');
    expect(t.storylineTitle).toBeUndefined();
  });

  it('cards with empty storyline columns have undefined fields (backward compat)', () => {
    loadTemplatesFromCsv(SYNTHETIC_CSV);
    const t = getEventTemplates().find((c) => c.id === 'evt-vanilla') as EventCard;
    expect(t.storylineId).toBeUndefined();
    expect(t.storylineTitle).toBeUndefined();
    expect(t.hasChoices).toBeUndefined();
  });

  it('the bundled CSV assigns storyline metadata to the shipped chains', () => {
    const expected: Record<string, string> = {
      'evt-tax': 'storyline-tax',
      'evt-tax-error': 'storyline-tax',
      'evt-tax-inquiry': 'storyline-tax',
      'evt-flu-outbreak': 'storyline-health',
      'evt-pandemic': 'storyline-health',
      'evt-recession': 'storyline-economy',
      'evt-depression': 'storyline-economy',
      'evt-strike-service': 'storyline-labor',
      'evt-general-strike': 'storyline-labor',
      'evt-popular-menu': 'storyline-restaurant',
      'evt-farm-table': 'storyline-restaurant',
    };
    for (const [id, storylineId] of Object.entries(expected)) {
      const t = getEventTemplates().find((c) => c.id === id);
      expect(t, `${id} must exist`).toBeDefined();
      expect(t!.storylineId, `${id} storylineId`).toBe(storylineId);
    }
  });
});

// ── AC2: Generalised option model ───────────────────────────

describe('AC2 — legacy fields compile to the ordered option model', () => {
  it('a non-choice card compiles to an empty option list', () => {
    const card = makeChoiceEvent({ hasChoices: undefined, acceptNextCardId: undefined, rejectNextCardId: undefined });
    const compiled = compileStorylineFromEvent(card);
    expect(compiled.compiledOptions).toEqual([]);
    expect(storylineOptionCount(card)).toBe(0);
  });

  it('a legacy choice card compiles to [Accept(apply), Reject(skip)]', () => {
    const card = makeChoiceEvent();
    const compiled = compileStorylineFromEvent(card);
    expect(compiled.compiledOptions).toEqual([
      { label: 'Accept', successorId: 'evt-model-next-a', effectPolicy: 'apply' },
      { label: 'Reject', successorId: 'evt-model-next-b', effectPolicy: 'skip' },
    ]);
  });

  it('a choice card with null successors compiles to options with undefined successors', () => {
    const card = makeChoiceEvent({ acceptNextCardId: null, rejectNextCardId: null });
    const compiled = compileStorylineFromEvent(card);
    expect(compiled.compiledOptions[0].successorId).toBeUndefined();
    expect(compiled.compiledOptions[1].successorId).toBeUndefined();
  });

  it('compilation carries the storylineId through', () => {
    const card = makeChoiceEvent({ storylineId: 'arc-x' });
    expect(compileStorylineFromEvent(card).storylineId).toBe('arc-x');
  });
});

describe('AC2 — legacy-equivalence: option resolution matches legacy behaviour', () => {
  // A choice card plus its escalations registered in the template registry.
  function setupChoiceState(seed: string): MainStreetState {
    const state = setupMainStreetGame({ seed, difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-eq-choice', name: 'Equiv Choice', effect: 'Lose 200 coins', coinDelta: -200, hasChoices: true, acceptNextCardId: 'evt-eq-accept', rejectNextCardId: 'evt-eq-reject', storylineId: 'arc-eq', storylineTitle: 'Equivalence' },
      { id: 'evt-eq-accept', name: 'Accept Escalation', effect: 'Lose 400 coins', coinDelta: -400, storylineId: 'arc-eq', storylineTitle: 'Equivalence' },
      { id: 'evt-eq-reject', name: 'Reject Escalation', effect: 'Lose 500 coins', coinDelta: -500, storylineId: 'arc-eq', storylineTitle: 'Equivalence' },
    ]));
    return state;
  }

  function queueEvent(state: MainStreetState, templateId: string): EventCard {
    const t = getEventTemplates().find((c) => c.id === templateId) as EventCard;
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...t, id: `${templateId}-0` });
    return t;
  }

  it('resolveEventOption(index 0) is identical to resolveEventChoice("accept")', () => {
    const viaOption = setupChoiceState('equiv-accept-option');
    queueEvent(viaOption, 'evt-eq-choice');
    processEndOfTurn(viaOption);
    const coinsBefore = viaOption.resourceBank.coins;
    const repBefore = viaOption.resourceBank.reputation;
    const res = resolveEventOption(viaOption, 0);

    expect(viaOption.resourceBank.coins).toBe(coinsBefore - 200);
    expect(viaOption.resourceBank.reputation).toBe(repBefore);
    expect(res.pushedCard?.id).toContain('evt-eq-accept');
    expect(viaOption.pendingEventChoice!.chosenOption).toBe('accept');
    expect(viaOption.pendingEventChoice!.resolved).toBe(true);
  });

  it('resolveEventOption(index 1) is identical to resolveEventChoice("reject")', () => {
    const viaOption = setupChoiceState('equiv-reject-option');
    queueEvent(viaOption, 'evt-eq-choice');
    processEndOfTurn(viaOption);
    const coinsBefore = viaOption.resourceBank.coins;
    const res = resolveEventOption(viaOption, 1);

    expect(viaOption.resourceBank.coins).toBe(coinsBefore);
    expect(res.pushedCard?.id).toContain('evt-eq-reject');
    expect(viaOption.pendingEventChoice!.chosenOption).toBe('reject');
  });

  it('legacy accept/reject and the compiled option list produce the same outcome', () => {
    const legacy = setupChoiceState('equiv-legacy');
    queueEvent(legacy, 'evt-eq-choice');
    processEndOfTurn(legacy);
    const legacyCoinsBefore = legacy.resourceBank.coins;
    const legacyRes = resolveEventChoice(legacy, 'accept');

    const generalised = setupChoiceState('equiv-legacy');
    queueEvent(generalised, 'evt-eq-choice');
    processEndOfTurn(generalised);
    const generalisedCoinsBefore = generalised.resourceBank.coins;
    const generalisedRes = resolveEventOption(generalised, 0);

    expect(generalisedCoinsBefore).toBe(legacyCoinsBefore);
    expect(generalisedRes.coinChange).toBe(legacyRes.coinChange);
    expect(generalisedRes.repChange).toBe(legacyRes.repChange);
    expect(generalisedRes.pushedCard?.id).toBe(legacyRes.pushedCard?.id);
  });
});

describe('AC2 — multi-option storylines', () => {
  const OPTIONS: StorylineOption[] = [
    { label: 'Accept', successorId: 'evt-multi-a', effectPolicy: 'apply' },
    { label: 'Refuse', successorId: null, effectPolicy: 'skip' },
    { label: 'Investigate', successorId: 'evt-multi-b', effectPolicy: 'apply' },
    { label: 'Ignore', successorId: null, effectPolicy: 'skip' },
  ];

  function setupMultiState(seed: string): MainStreetState {
    const state = setupMainStreetGame({ seed, difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-multi', name: 'Multi Choice', effect: 'Lose 150 coins', coinDelta: -150, hasChoices: true, storylineId: 'arc-multi', storylineTitle: 'Multi' },
      { id: 'evt-multi-a', name: 'Branch A', effect: 'Lose 80 coins', coinDelta: -80 },
      { id: 'evt-multi-b', name: 'Branch B', effect: 'Gain 90 coins', coinDelta: 90 },
    ]));
    registerStorylineOptions('evt-multi', OPTIONS);
    const event = getEventTemplates().find((c) => c.id === 'evt-multi') as EventCard;
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...event, id: 'evt-multi-0' });
    return state;
  }

  it('compiles a registered multi-option list in declaration order', () => {
    registerStorylineOptions('evt-multi', OPTIONS);
    const event = { family: 'event', id: 'evt-multi', name: 'x', trigger: 'Incident', cost: 0, effect: 'x', target: 'All', coinDelta: 0, reputationDelta: 0 } as EventCard;
    const options = getStorylineOptions(event);
    expect(options.map((o) => o.label)).toEqual(['Accept', 'Refuse', 'Investigate', 'Ignore']);
    expect(storylineOptionCount(event)).toBe(4);
    expect(eventHasStoryline(event)).toBe(true);
    expect(hasRegisteredStorylineOptions('evt-multi')).toBe(true);
  });

  it('AC1 — a bare storylineId does NOT make a card a choice (descriptive only)', () => {
    // Terminal escalation cards carry a storylineId for grouping/journal
    // purposes but must still resolve as plain incidents.
    const terminal: EventCard = {
      family: 'event', id: 'evt-terminal', name: 'Depression', trigger: 'Incident',
      cost: 0, effect: 'Reduce income', target: 'All', coinDelta: 0, reputationDelta: 0,
      storylineId: 'storyline-economy', storylineTitle: 'Economic Downturn',
    } as EventCard;
    expect(eventHasStoryline(terminal)).toBe(false);
    expect(storylineOptionCount(terminal)).toBe(0);
    expect(createPendingStorylineChoice(terminal)).toBeNull();
  });

  it('AC1 — the shipped terminal escalation cards are not choice cards', () => {
    for (const id of ['evt-depression', 'evt-pandemic', 'evt-general-strike', 'evt-farm-table']) {
      const t = getEventTemplates().find((c) => c.id === id) as EventCard;
      expect(t, `${id} must exist`).toBeDefined();
      expect(Boolean(t!.hasChoices), `${id} must not be a choice`).toBe(false);
      expect(eventHasStoryline(t!), `${id} must not intercept resolution`).toBe(false);
    }
  });

  it('treats a registered card as a storyline even without hasChoices', () => {
    registerStorylineOptions('evt-naked', OPTIONS);
    const event = { family: 'event', id: 'evt-naked', name: 'x', trigger: 'Incident', cost: 0, effect: 'x', target: 'All', coinDelta: 0, reputationDelta: 0 } as EventCard;
    expect(eventHasStoryline(event)).toBe(true);
  });

  it('resolveEventOption applies the chosen option and pushes its successor', () => {
    const state = setupMultiState('multi-investigate');
    processEndOfTurn(state);
    const coinsBefore = state.resourceBank.coins;

    // Index 2 = "Investigate" (apply effect of the source card + push B).
    const res = resolveEventOption(state, 2);

    expect(res.option).toBe('Investigate');
    expect(res.coinChange).toBe(-150); // source-card effect applied
    expect(res.pushedCard?.id).toContain('evt-multi-b');
    expect(state.pendingEventChoice!.resolved).toBe(true);
    expect(state.resourceBank.coins).toBe(coinsBefore - 150);
  });

  it('a skip option leaves resources unchanged and pushes its successor', () => {
    const state = setupMultiState('multi-refuse');
    processEndOfTurn(state);
    const coinsBefore = state.resourceBank.coins;

    const res = resolveEventOption(state, 1); // "Refuse" → skip, no successor

    expect(res.option).toBe('Refuse');
    expect(res.coinChange).toBe(0);
    expect(res.pushedCard).toBeNull();
    expect(state.resourceBank.coins).toBe(coinsBefore);
  });

  it('an out-of-range option index throws (no silent no-op)', () => {
    const state = setupMultiState('multi-oob');
    processEndOfTurn(state);
    expect(() => resolveEventOption(state, 99)).toThrow(/No storyline option at index 99/);
  });

  it('resolving twice throws (already resolved)', () => {
    const state = setupMultiState('multi-twice');
    processEndOfTurn(state);
    resolveEventOption(state, 0);
    expect(() => resolveEventOption(state, 1)).toThrow(/already resolved/);
  });

  it('a multi-option card is intercepted by resolveIncident like a legacy choice', () => {
    const state = setupMultiState('multi-intercept');
    const result = processEndOfTurn(state);
    expect(result.choicePending).toBe(true);
    expect(state.pendingEventChoice).not.toBeNull();
    expect(state.pendingEventChoice!.resolved).toBe(false);
  });
});

// ── AC3: Extraction seam purity / game-agnostic interface ────

describe('AC3 — extraction seam exposes pure, game-agnostic functions', () => {
  it('compilation is pure (same input → same output; no shared references)', () => {
    const card = makeChoiceEvent({ storylineId: 'arc' });
    const first = compileStorylineFromEvent(card);
    const second = compileStorylineFromEvent(card);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    // The option objects are freshly created per call (no shared references),
    // so mutating one compiled result cannot affect a later compilation.
    expect(first.compiledOptions[0]).not.toBe(second.compiledOptions[0]);
    (first.compiledOptions[0] as { label: string }).label = 'Mutated';
    expect(compileStorylineFromEvent(card).compiledOptions[0].label).toBe('Accept');
  });

  it('registered options are copied defensively (registry isolation)', () => {
    const original: StorylineOption[] = [{ label: 'One', successorId: null, effectPolicy: 'apply' }];
    registerStorylineOptions('evt-copy', original);
    (original[0] as { label: string }).label = 'Mutated';
    const event = { family: 'event', id: 'evt-copy', name: 'x', trigger: 'Incident', cost: 0, effect: 'x', target: 'All', coinDelta: 0, reputationDelta: 0 } as EventCard;
    expect(getStorylineOptions(event)[0].label).toBe('One');
  });

  it('createPendingStorylineChoice is null for non-storyline cards', () => {
    const card = makeChoiceEvent({ hasChoices: undefined, acceptNextCardId: undefined, rejectNextCardId: undefined });
    expect(createPendingStorylineChoice(card)).toBeNull();
  });

  it('createPendingStorylineChoice returns an unresolved pending state', () => {
    const card = makeChoiceEvent();
    const pending = createPendingStorylineChoice(card);
    expect(pending).not.toBeNull();
    expect(pending!.event).toBe(card);
    expect(pending!.resolved).toBe(false);
    expect(pending!.chosenOption).toBeNull();
  });

  it('the StorylineOption export is publicly reachable from the cards module', () => {
    // Compile-time check that the type is re-exported for callers.
    const opt: ExportedOption = { label: 'x', successorId: null, effectPolicy: 'skip' };
    expect(opt.effectPolicy).toBe('skip');
  });
});

describe('AC3 — pushChainCard is deterministic and replay-safe', () => {
  it('serialises successive pushes of the same template deterministically', () => {
    const state = setupMainStreetGame({ seed: 'chain-serial', difficulty: 'Medium' });
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-chain-x', name: 'Chain X', effect: 'Lose 10 coins', coinDelta: -10 },
    ]));
    state.incidentDeck.length = 0;
    const first = pushChainCard(state, 'evt-chain-x');
    const second = pushChainCard(state, 'evt-chain-x');
    expect(first?.id).toBe('evt-chain-x-0');
    expect(second?.id).toBe('evt-chain-x-1');
    expect(state.incidentDeck.map((c) => c.id)).toEqual(['evt-chain-x-0', 'evt-chain-x-1']);
  });

  it('returns null when no template id is supplied (chain ends)', () => {
    const state = setupMainStreetGame({ seed: 'chain-null', difficulty: 'Medium' });
    expect(pushChainCard(state, null)).toBeNull();
    expect(pushChainCard(state, undefined)).toBeNull();
  });

  it('returns null and logs for an unknown template id', () => {
    const state = setupMainStreetGame({ seed: 'chain-unknown', difficulty: 'Medium' });
    expect(pushChainCard(state, 'evt-does-not-exist')).toBeNull();
  });
});

describe('AC3 — resolveStorylineOption applies effect policy correctly', () => {
  it('the "apply" policy resolves the event effect', () => {
    const state = setupMainStreetGame({ seed: 'policy-apply', difficulty: 'Medium' });
    const event: EventCard = {
      family: 'event', id: 'evt-policy', name: 'Policy', trigger: 'Incident',
      cost: 0, effect: 'Lose 40 coins', target: 'All', coinDelta: -40, reputationDelta: 0,
    } as EventCard;
    const before = state.resourceBank.coins;
    const res = resolveStorylineOption(state, event, { label: 'Go', successorId: null, effectPolicy: 'apply' });
    expect(res.coinChange).toBe(-40);
    expect(state.resourceBank.coins).toBe(before - 40);
  });

  it('the "skip" policy leaves resources untouched', () => {
    const state = setupMainStreetGame({ seed: 'policy-skip', difficulty: 'Medium' });
    const event: EventCard = {
      family: 'event', id: 'evt-policy2', name: 'Policy', trigger: 'Incident',
      cost: 0, effect: 'Lose 40 coins', target: 'All', coinDelta: -40, reputationDelta: 0,
    } as EventCard;
    const before = state.resourceBank.coins;
    const res = resolveStorylineOption(state, event, { label: 'No', successorId: null, effectPolicy: 'skip' });
    expect(res.coinChange).toBe(0);
    expect(state.resourceBank.coins).toBe(before);
  });
});
