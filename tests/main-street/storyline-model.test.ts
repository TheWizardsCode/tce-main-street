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
  serializeMainStreetState,
  deserializeMainStreetState,
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
import { resolveEventChoiceCommand } from '../../src/MainStreetCommands';
import { UndoRedoManager } from '@core-engine/UndoRedoManager';
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
  getPendingStorylineOptions,
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

// ── AC1/AC3/AC5: Callback conditions (draw-time filtering) ──

describe('AC1 — callback condition registration + draw-time filtering', () => {
  /**
   * Registers a three-option storyline and returns a state with the event
   * queued as the next incident.  The condition callbacks are supplied by
   * the caller so each test can exercise a distinct predicate.
   */
  function setupConditionState(
    seed: string,
    options: StorylineOption[],
  ): MainStreetState {
    const state = setupMainStreetGame({ seed, difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-cond', name: 'Condition Choice', effect: 'Lose 60 coins', coinDelta: -60, hasChoices: true, storylineId: 'arc-cond', storylineTitle: 'Conditions' },
      { id: 'evt-cond-a', name: 'Branch A', effect: 'Lose 10 coins', coinDelta: -10 },
      { id: 'evt-cond-b', name: 'Branch B', effect: 'Gain 20 coins', coinDelta: 20 },
    ]));
    registerStorylineOptions('evt-cond', options);
    const event = getEventTemplates().find((c) => c.id === 'evt-cond') as EventCard;
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...event, id: 'evt-cond-0' });
    return state;
  }

  const CONDITION_OPTIONS: StorylineOption[] = [
    {
      label: 'Always',
      successorId: 'evt-cond-a',
      effectPolicy: 'apply',
      condition: () => true,
    },
    {
      label: 'Never',
      successorId: 'evt-cond-b',
      effectPolicy: 'skip',
      condition: () => false,
    },
    {
      label: 'RichOnly',
      successorId: null,
      effectPolicy: 'skip',
      condition: (s) => s.resourceBank.coins > 1000,
    },
  ];

  it('omits options whose condition returns false and keeps true/undefined', () => {
    const state = setupConditionState('cond-filter', CONDITION_OPTIONS);
    const event = state.incidentDeck[0];

    // Default starting coins are below the RichOnly threshold, so only
    // "Always" (true) is presented; "Never" (false) and "RichOnly"
    // (derived-state false) are omitted.
    const options = getStorylineOptions(event, state);
    expect(options.map((o) => o.label)).toEqual(['Always']);
    expect(storylineOptionCount(event, state)).toBe(1);
  });

  it('includes a derived-state option once the predicate is satisfied', () => {
    const state = setupConditionState('cond-derived', CONDITION_OPTIONS);
    state.resourceBank.coins = 5000; // above the RichOnly threshold
    const event = state.incidentDeck[0];

    const options = getStorylineOptions(event, state);
    expect(options.map((o) => o.label)).toEqual(['Always', 'RichOnly']);
    expect(storylineOptionCount(event, state)).toBe(2);
  });

  it('an option without a condition is always included (legacy behaviour)', () => {
    const noConditions: StorylineOption[] = [
      { label: 'PlainA', successorId: null, effectPolicy: 'skip' },
      { label: 'PlainB', successorId: null, effectPolicy: 'skip' },
    ];
    const state = setupConditionState('cond-plain', noConditions);
    const event = state.incidentDeck[0];

    const options = getStorylineOptions(event, state);
    expect(options.map((o) => o.label)).toEqual(['PlainA', 'PlainB']);
    expect(storylineOptionCount(event, state)).toBe(2);
  });

  it('compilation without state does not evaluate conditions (inspection path)', () => {
    const state = setupConditionState('cond-nostate', CONDITION_OPTIONS);
    const event = state.incidentDeck[0];

    // Without state, all registered options are returned (validation/graph).
    const options = getStorylineOptions(event);
    expect(options.map((o) => o.label)).toEqual(['Always', 'Never', 'RichOnly']);
  });

  it('the condition callback receives the live MainStreetState', () => {
    let received: MainStreetState | null = null;
    const spyOptions: StorylineOption[] = [
      {
        label: 'Spy',
        successorId: null,
        effectPolicy: 'skip',
        condition: (s) => {
          received = s;
          return true;
        },
      },
    ];
    const state = setupConditionState('cond-spy', spyOptions);
    const event = state.incidentDeck[0];

    getStorylineOptions(event, state);
    expect(received).toBe(state);
    expect(received!.resourceBank).toBeDefined();
    expect(received!.resourceBank.coins).toBeTypeOf('number');
  });

  it('does not mutate the stored registry entry when filtering', () => {
    const state = setupConditionState('cond-nomutate', CONDITION_OPTIONS);
    const event = state.incidentDeck[0];

    getStorylineOptions(event, state);

    // Re-registering the same array shape still returns all three options
    // when inspected without state — proving filtering did not mutate the
    // registry's stored list in place.
    expect(getStorylineOptions(event).map((o) => o.label)).toEqual([
      'Always',
      'Never',
      'RichOnly',
    ]);
  });

  it('evaluates conditions at draw time, not resolution time', () => {
    // The presented option list is frozen when the pending choice is drawn;
    // mutating state after the draw (but before resolution) must not change
    // the frozen list.
    const state = setupConditionState('cond-drawtime', CONDITION_OPTIONS);
    processEndOfTurn(state); // draw -> pending choice with the frozen list
    const pending = state.pendingEventChoice!;
    expect(pending.options?.map((o) => o.label)).toEqual(['Always']);

    // Mutate state so RichOnly would now match — the frozen list is unchanged.
    state.resourceBank.coins = 9999;
    expect(pending.options?.map((o) => o.label)).toEqual(['Always']);
    expect(getPendingStorylineOptions(pending, state).map((o) => o.label)).toEqual([
      'Always',
    ]);

    // Resolution honours the frozen list: index 0 is still 'Always', and the
    // engine does not recompile against the mutated state.
    const res = resolveEventOption(state, 0);
    expect(res.pushedCard?.id).toContain('evt-cond-a');
  });

  it('the successor resolver still sees post-draw state at resolution time', () => {
    // Conditions freeze at draw time, but successorResolver is evaluated at
    // resolution time — so it observes mutations made between draw and
    // resolution (the player has already committed).
    const state = setupMainStreetGame({ seed: 'cond-succ-resolve', difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-frz', name: 'Frozen', effect: 'Lose 20 coins', coinDelta: -20 },
      { id: 'evt-frz-low', name: 'Low', effect: 'Lose 10 coins', coinDelta: -10 },
      { id: 'evt-frz-high', name: 'High', effect: 'Lose 15 coins', coinDelta: -15 },
    ]));
    registerStorylineOptions('evt-frz', [
      {
        label: 'Branch',
        successorId: null,
        effectPolicy: 'skip',
        condition: () => true,
        successorResolver: (s) => (s.resourceBank.coins > 1000 ? 'evt-frz-high' : 'evt-frz-low'),
      },
    ]);
    const event = getEventTemplates().find((c) => c.id === 'evt-frz') as EventCard;
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...event, id: 'evt-frz-0' });
    processEndOfTurn(state); // draw at low coins

    // Mutate state between draw and resolution: the resolver must see the
    // new balance and pick the high branch.
    state.resourceBank.coins = 5000;
    const res = resolveEventOption(state, 0);
    expect(res.pushedCard?.id).toContain('evt-frz-high');
  });
});

// ── AC2/AC3/AC5: Callback successors (resolution-time) ──────

describe('AC2 — callback successorResolver invoked at resolution time', () => {
  it('pushes the successor returned by the callback', () => {
    const state = setupMainStreetGame({ seed: 'succ-basic', difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-succ', name: 'Callback Successor', effect: 'Lose 20 coins', coinDelta: -20 },
      { id: 'evt-succ-a', name: 'Dynamic A', effect: 'Lose 10 coins', coinDelta: -10 },
      { id: 'evt-succ-b', name: 'Dynamic B', effect: 'Lose 15 coins', coinDelta: -15 },
    ]));
    const event: EventCard = {
      family: 'event', id: 'evt-succ', name: 'Callback Successor', trigger: 'Incident',
      cost: 0, effect: 'Lose 20 coins', target: 'All', coinDelta: -20, reputationDelta: 0,
    } as EventCard;

    const res = resolveStorylineOption(state, event, {
      label: 'Dynamic',
      successorId: 'evt-succ-a', // fallback that must be ignored
      effectPolicy: 'apply',
      successorResolver: () => 'evt-succ-b',
    });

    expect(res.pushedCard?.id).toContain('evt-succ-b');
    expect(state.incidentDeck.map((c) => c.id)).toContain(res.pushedCard!.id);
  });

  it('uses runtime state to choose the successor', () => {
    const state = setupMainStreetGame({ seed: 'succ-state', difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-succ2', name: 'State Successor', effect: 'Lose 20 coins', coinDelta: -20 },
      { id: 'evt-succ2-rich', name: 'Rich Branch', effect: 'Lose 10 coins', coinDelta: -10 },
      { id: 'evt-succ2-poor', name: 'Poor Branch', effect: 'Lose 15 coins', coinDelta: -15 },
    ]));
    const event: EventCard = {
      family: 'event', id: 'evt-succ2', name: 'State Successor', trigger: 'Incident',
      cost: 0, effect: 'Lose 20 coins', target: 'All', coinDelta: -20, reputationDelta: 0,
    } as EventCard;

    state.resourceBank.coins = 5000;
    const rich = resolveStorylineOption(state, event, {
      label: 'State',
      successorId: null,
      effectPolicy: 'skip',
      successorResolver: (s) => (s.resourceBank.coins > 1000 ? 'evt-succ2-rich' : 'evt-succ2-poor'),
    });
    expect(rich.pushedCard?.id).toContain('evt-succ2-rich');
  });

  it('a null return ends the chain (no card pushed)', () => {
    const state = setupMainStreetGame({ seed: 'succ-null', difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-succ3', name: 'Null Successor', effect: 'Lose 20 coins', coinDelta: -20 },
      { id: 'evt-succ3-x', name: 'Unused', effect: 'Lose 10 coins', coinDelta: -10 },
    ]));
    const event: EventCard = {
      family: 'event', id: 'evt-succ3', name: 'Null Successor', trigger: 'Incident',
      cost: 0, effect: 'Lose 20 coins', target: 'All', coinDelta: -20, reputationDelta: 0,
    } as EventCard;

    const deckBefore = state.incidentDeck.length;
    const res = resolveStorylineOption(state, event, {
      label: 'End',
      successorId: 'evt-succ3-x',
      effectPolicy: 'skip',
      successorResolver: () => null,
    });

    expect(res.pushedCard).toBeNull();
    expect(state.incidentDeck.length).toBe(deckBefore);
  });

  it('an undefined return ends the chain (no card pushed)', () => {
    const state = setupMainStreetGame({ seed: 'succ-undef', difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-succ4', name: 'Undef Successor', effect: 'Lose 20 coins', coinDelta: -20 },
    ]));
    const event: EventCard = {
      family: 'event', id: 'evt-succ4', name: 'Undef Successor', trigger: 'Incident',
      cost: 0, effect: 'Lose 20 coins', target: 'All', coinDelta: -20, reputationDelta: 0,
    } as EventCard;

    const res = resolveStorylineOption(state, event, {
      label: 'End',
      successorId: 'evt-succ4',
      effectPolicy: 'skip',
      successorResolver: () => undefined,
    });

    expect(res.pushedCard).toBeNull();
  });

  it('falls back to option.successorId when no resolver is present', () => {
    const state = setupMainStreetGame({ seed: 'succ-fallback', difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-succ5', name: 'Fallback', effect: 'Lose 20 coins', coinDelta: -20 },
      { id: 'evt-succ5-next', name: 'Static Next', effect: 'Lose 10 coins', coinDelta: -10 },
    ]));
    const event: EventCard = {
      family: 'event', id: 'evt-succ5', name: 'Fallback', trigger: 'Incident',
      cost: 0, effect: 'Lose 20 coins', target: 'All', coinDelta: -20, reputationDelta: 0,
    } as EventCard;

    const res = resolveStorylineOption(state, event, {
      label: 'Static',
      successorId: 'evt-succ5-next',
      effectPolicy: 'apply',
    });

    expect(res.pushedCard?.id).toContain('evt-succ5-next');
  });

  it('applies the effect policy before invoking the successor resolver', () => {
    const state = setupMainStreetGame({ seed: 'succ-order', difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-succ6', name: 'Order', effect: 'Lose 30 coins', coinDelta: -30 },
    ]));
    const event: EventCard = {
      family: 'event', id: 'evt-succ6', name: 'Order', trigger: 'Incident',
      cost: 0, effect: 'Lose 30 coins', target: 'All', coinDelta: -30, reputationDelta: 0,
    } as EventCard;
    const before = state.resourceBank.coins;
    let coinsSeenByResolver = -1;

    resolveStorylineOption(state, event, {
      label: 'Order',
      successorId: null,
      effectPolicy: 'apply',
      successorResolver: (s) => {
        coinsSeenByResolver = s.resourceBank.coins;
        return null;
      },
    });

    // The effect (lose 30 coins) has already been applied when the resolver
    // runs, so the resolver observes the post-effect balance.
    expect(coinsSeenByResolver).toBe(before - 30);
  });
});

// ── AC4/AC6: Legacy equivalence + AI compatibility ──────────

describe('AC4 — declarative path remains default with callbacks present', () => {
  it('options without callbacks behave identically to legacy compilation', () => {
    const card = makeChoiceEvent();
    const legacyOptions = getStorylineOptions(card);
    // No callbacks means no filtering — the full compiled list is returned
    // whether or not state is supplied.
    expect(legacyOptions).toEqual([
      { label: 'Accept', successorId: 'evt-model-next-a', effectPolicy: 'apply' },
      { label: 'Reject', successorId: 'evt-model-next-b', effectPolicy: 'skip' },
    ]);
  });

  it('a mixed option list keeps callback-free options regardless of state', () => {
    const state = setupMainStreetGame({ seed: 'mixed-default', difficulty: 'Medium' });
    const options: StorylineOption[] = [
      { label: 'Plain', successorId: null, effectPolicy: 'skip' },
      { label: 'Gated', successorId: null, effectPolicy: 'skip', condition: () => false },
    ];
    registerStorylineOptions('evt-mixed', options);
    const event = { family: 'event', id: 'evt-mixed', name: 'x', trigger: 'Incident', cost: 0, effect: 'x', target: 'All', coinDelta: 0, reputationDelta: 0 } as EventCard;

    const withState = getStorylineOptions(event, state);
    expect(withState.map((o) => o.label)).toEqual(['Plain']);
    const withoutState = getStorylineOptions(event);
    expect(withoutState.map((o) => o.label)).toEqual(['Plain', 'Gated']);
  });

  it('resolveEventOption still resolves a callback-free option list unchanged', () => {
    const state = setupMainStreetGame({ seed: 'mixed-resolve', difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-mixed2', name: 'Mixed Resolve', effect: 'Lose 40 coins', coinDelta: -40, hasChoices: true, acceptNextCardId: 'evt-mixed2-next', storylineId: 'arc-mixed' },
      { id: 'evt-mixed2-next', name: 'Mixed Next', effect: 'Lose 10 coins', coinDelta: -10 },
    ]));
    const event = getEventTemplates().find((c) => c.id === 'evt-mixed2') as EventCard;
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...event, id: 'evt-mixed2-0' });
    processEndOfTurn(state);

    const res = resolveEventOption(state, 0);
    expect(res.coinChange).toBe(-40);
    expect(res.pushedCard?.id).toContain('evt-mixed2-next');
  });
});

describe('AC6 — AI decision path selects only from presented options', () => {
  it('resolveEventChoice with filtered list picks the available option', () => {
    const state = setupMainStreetGame({ seed: 'ai-callback', difficulty: 'Easy' });
    state.phase = 'MarketPhase';
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-ai-cb', name: 'AI Callback', effect: 'Lose 50 coins', coinDelta: -50, hasChoices: true, storylineId: 'arc-ai' },
      { id: 'evt-ai-cb-a', name: 'AI Branch A', effect: 'Gain 100 coins', coinDelta: 100 },
      { id: 'evt-ai-cb-b', name: 'AI Branch B', effect: 'Lose 200 coins', coinDelta: -200 },
    ]));
    registerStorylineOptions('evt-ai-cb', [
      { label: 'Good', successorId: 'evt-ai-cb-a', effectPolicy: 'apply', condition: () => true },
      { label: 'Bad', successorId: 'evt-ai-cb-b', effectPolicy: 'apply', condition: () => false },
    ]);
    const event = getEventTemplates().find((c) => c.id === 'evt-ai-cb') as EventCard;
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...event, id: 'evt-ai-cb-0' });
    processEndOfTurn(state); // draws the card → pending choice

    // AI returns 'accept' → resolveEventChoice → resolveEventOption(0).
    // Only 'Good' is in the filtered list at index 0.
    resolveEventChoice(state, 'accept');

    // Branch A was pushed (the 'Good' branch).
    const pushedId = state.incidentDeck[0].id;
    expect(pushedId).toContain('evt-ai-cb-a');
    expect(pushedId).not.toContain('evt-ai-cb-b');
  });
});

// ── AC2/AC3: Callback semantics across save/load and undo ───

describe('callback semantics survive save/load and undo', () => {
  /** Registers a callback storyline and draws it as a pending choice. */
  function setupCallbackPending(seed: string): MainStreetState {
    const state = setupMainStreetGame({ seed, difficulty: 'Medium' });
    state.phase = 'MarketPhase';
    loadTemplatesFromCsv(buildCsv([
      { id: 'evt-persist', name: 'Persist Callback', effect: 'Lose 30 coins', coinDelta: -30, hasChoices: true, storylineId: 'arc-persist' },
      { id: 'evt-persist-low', name: 'Low Branch', effect: 'Lose 10 coins', coinDelta: -10 },
      { id: 'evt-persist-high', name: 'High Branch', effect: 'Lose 15 coins', coinDelta: -15 },
    ]));
    registerStorylineOptions('evt-persist', [
      {
        label: 'Branch',
        successorId: 'evt-persist-low',
        effectPolicy: 'skip',
        condition: () => true,
        successorResolver: (s) => (s.resourceBank.coins > 1000 ? 'evt-persist-high' : 'evt-persist-low'),
      },
    ]);
    const event = getEventTemplates().find((c) => c.id === 'evt-persist') as EventCard;
    state.incidentDeck.length = 0;
    state.incidentDeck.push({ ...event, id: 'evt-persist-0' });
    processEndOfTurn(state);
    return state;
  }

  it('serialisation drops the runtime-only option snapshot', () => {
    const state = setupCallbackPending('persist-serialize');
    expect(state.pendingEventChoice!.options).toHaveLength(1);

    const saved = serializeMainStreetState(state);
    // The serialised form never carries callbacks (they are functions).
    expect(saved.pendingEventChoice).not.toBeNull();
    expect((saved.pendingEventChoice as { options?: unknown }).options).toBeUndefined();
  });

  it('a loaded save recompiles the option list from the runtime registry', () => {
    const state = setupCallbackPending('persist-reload');
    const saved = serializeMainStreetState(state);
    const loaded = deserializeMainStreetState(saved);

    // The snapshot is gone after load…
    expect(loaded.pendingEventChoice!.options).toBeUndefined();
    // …but the registry still supplies the (callback-equipped) option list,
    // so resolution works via the recompile fallback.
    loaded.resourceBank.coins = 5000;
    const res = resolveEventOption(loaded, 0);
    expect(res.pushedCard?.id).toContain('evt-persist-high');
  });

  it('undo restores an unresolved callback choice that still resolves', () => {
    const state = setupCallbackPending('persist-undo');
    const coinsBefore = state.resourceBank.coins;
    const deckBefore = state.incidentDeck.length;
    const undo = new UndoRedoManager();

    // effectPolicy 'skip' → no coin change; successorResolver picks the low
    // branch at the default (draw-time) balance.
    const cmd = resolveEventChoiceCommand(state, 'accept');
    undo.execute(cmd);
    expect(state.resourceBank.coins).toBe(coinsBefore);
    expect(state.incidentDeck.length).toBe(deckBefore + 1);
    expect(state.incidentDeck[state.incidentDeck.length - 1].id).toContain('evt-persist-low');

    // Undo restores the unresolved pending choice (snapshot stripped).
    undo.undo();
    expect(state.pendingEventChoice!.resolved).toBe(false);
    expect(state.pendingEventChoice!.chosenOption).toBeNull();
    expect(state.pendingEventChoice!.options).toBeUndefined();
    expect(state.incidentDeck.length).toBe(deckBefore);
    expect(state.resourceBank.coins).toBe(coinsBefore);

    // Redo re-applies the callback successor (recompiled from the registry).
    undo.redo();
    expect(state.pendingEventChoice!.resolved).toBe(true);
    expect(state.incidentDeck[state.incidentDeck.length - 1].id).toContain('evt-persist-low');
  });
});
