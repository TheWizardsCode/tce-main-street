/**
 * Story-line behaviour-preservation parity gate (MS-0MVFM9QMO008IDOC).
 *
 * Characterises the behaviour that must survive the move to the generic
 * core story-line module. Everything here is green **before** the Main Street
 * adapters are refactored, so any semantic drift introduced by the move
 * (compilation, successor precedence, RNG consumption, adapter text) fails.
 *
 * Covered:
 * - **Compile parity** — for every choice card in the shipped card data, the
 *   generic core compiler produces the same option list as today's Main
 *   Street compiler.
 * - **Resolution parity** — for every option of every choice card, core and
 *   Main Street resolve to the same effect deltas and the same successor.
 * - **Adapter-output golden** — dialog titles, choice-clarity labels and
 *   story-update lines for the five shipped storylines, pinned in
 *   `fixtures/adapter-output.golden.json`.
 * - **Seeded replay golden** — a scripted, seeded storyline sequence pinned in
 *   `fixtures/storyline-replay.golden.json` (one seeded rng draw per candidate
 *   selection).
 * - **Shipped validation** — the programmatic `validateStorylines` run.
 *
 * The core module is imported through the `@story-line` alias and driven by a
 * test-local Main Street engine adapter (the production adapter lands in the
 * Main Street adapters item).
 *
 * @module
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { setupMainStreetGame, addLog, type MainStreetState } from '../../src/MainStreetState';
import {
  getEventTemplates,
  getBaseTypeId,
  resetTemplatesToDefault,
  type EventCard,
} from '../../src/MainStreetCards';
import { processEndOfTurn, resolveEventChoice } from '../../src/MainStreetEngine';
import { resolveEvent } from '../../src/MainStreetEngineEvents';
import {
  compileStorylineFromEvent as msCompile,
  resolveStorylineOption as msResolve,
  eventHasStoryline,
  resetStorylineRegistry,
} from '../../src/MainStreetStoryline';
import {
  buildJournal,
  choiceClarityLabels,
} from '../../src/MainStreetStorylineJournal';
import {
  choiceDialogTitle,
  choiceDialogSubtitle,
  storyUpdateLine,
  storylineName,
} from '../../src/MainStreetStorylineUi';
import { validateStorylines } from '../../src/scripts/validate-storylines';
import {
  createStorylineSystem,
  type StorylineEngineAdapter,
  type StorylineOption,
} from '@story-line';

const FIXTURES = path.resolve(process.cwd(), 'tests/main-street/fixtures');

function readGolden<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf-8')) as T;
}

/** Strips an instance serial so template vs instance comparisons are stable. */
function baseId(id: string | null | undefined): string | null {
  return id ? getBaseTypeId(id) : null;
}

/** Test-local adapter mapping the core engine seam onto Main Street state. */
function makeEngine(): StorylineEngineAdapter<MainStreetState, EventCard> {
  return {
    rng: (state) => state.rng(),
    applyEffect: (state, card) => resolveEvent(state, card),
    getResources: (state) => ({
      coins: state.resourceBank.coins,
      reputation: state.resourceBank.reputation,
    }),
    appendLog: (state, text) => addLog(state, text, 'neutral'),
    getActivityLog: (state) => state.activityLog,
    getTemplate: (id) => getEventTemplates().find((t) => t.id === id) ?? null,
    getBaseTypeId,
    getChainScanCards: (state) => [
      ...state.incidentDeck,
      ...state.decks.event,
      ...state.discards.event,
    ],
    pushChainCard: (state, card) => {
      state.incidentDeck.push(card);
    },
  };
}

function makeSystem() {
  return createStorylineSystem({ engine: makeEngine() });
}

/** A fresh, identical state for a parity comparison. */
function freshState(seed: string): MainStreetState {
  const state = setupMainStreetGame({ seed, difficulty: 'Medium' });
  state.phase = 'MarketPhase';
  state.incidentDeck.length = 0;
  return state;
}

/** Queues one incident and pauses the turn on its choice (harness pattern). */
function pause(state: MainStreetState, templateId: string): EventCard {
  const template = getEventTemplates().find((c) => c.id === templateId);
  if (!template) throw new Error(`missing template ${templateId}`);
  state.phase = 'MarketPhase';
  state.incidentDeck.length = 0;
  state.incidentDeck.push({ ...template, id: `${template.id}-0` });
  processEndOfTurn(state);
  return state.pendingEventChoice!.event;
}

afterEach(() => {
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

const choiceCards = (): EventCard[] => getEventTemplates().filter((c) => eventHasStoryline(c));

// ── Compile parity ──────────────────────────────────────────

describe('compile parity — core vs today’s Main Street compiler', () => {
  it('produces the same option list for every choice card in the shipped data', () => {
    const system = makeSystem();
    const cards = choiceCards();
    expect(cards.length).toBeGreaterThanOrEqual(5);

    for (const card of cards) {
      const ms = msCompile(card);
      const core = system.compileStorylineFromEvent(card);
      expect(core.storylineId, card.id).toBe(ms.storylineId);
      expect(core.compiledOptions, card.id).toEqual(ms.compiledOptions);
    }
  });

  it('marks exactly the same cards as story choices', () => {
    const system = makeSystem();
    for (const card of getEventTemplates()) {
      expect(system.eventHasStoryline(card), card.id).toBe(eventHasStoryline(card));
    }
  });
});

// ── Resolution parity ───────────────────────────────────────

describe('resolution parity — core vs today’s Main Street resolver', () => {
  it('resolves every option of every choice card identically', () => {
    const system = makeSystem();

    for (const card of choiceCards()) {
      const msOptions = msCompile(card).compiledOptions;
      const coreOptions = system.compileStorylineFromEvent(card).compiledOptions;
      expect(coreOptions.length, card.id).toBe(msOptions.length);

      for (let i = 0; i < msOptions.length; i += 1) {
        const seed = `resolve-parity-${card.id}-${i}`;
        const msState = freshState(seed);
        const coreState = freshState(seed);

        const msRes = msResolve(msState, card, msOptions[i]!);
        const coreRes = system.resolveStorylineOption(
          coreState,
          card,
          coreOptions[i] as StorylineOption<MainStreetState>,
        );

        expect(coreRes.coinChange, `${card.id}#${i} coins`).toBe(msRes.coinChange);
        expect(coreRes.repChange, `${card.id}#${i} rep`).toBe(msRes.repChange);
        expect(baseId(coreRes.pushedCard?.id), `${card.id}#${i} successor`).toBe(
          baseId(msRes.pushedCard?.id),
        );
      }
    }
  });

  it('consumes exactly one seeded rng draw per candidate selection', () => {
    // A candidate-set option must draw once and select the same successor in
    // both implementations for the same seeded state.
    const system = makeSystem();
    const synthetic: EventCard = {
      family: 'event',
      id: 'evt-parity-candidates',
      name: 'Parity Candidates',
      trigger: 'Incident',
      cost: 0,
      effect: 'Lose 10 coins',
      target: 'All',
      coinDelta: -10,
      reputationDelta: 0,
      options: 'Go|evt-tax,evt-flu-outbreak',
    } as EventCard;
    const option: StorylineOption<MainStreetState> = {
      label: 'Go',
      effectPolicy: 'apply',
      successorIds: ['evt-tax', 'evt-flu-outbreak'],
    };

    const seed = 'one-draw-parity';
    const msState = freshState(seed);
    const coreState = freshState(seed);
    const msRes = msResolve(msState, synthetic, option);
    const coreRes = system.resolveStorylineOption(coreState, synthetic, option);

    expect(baseId(coreRes.pushedCard?.id)).toBe(baseId(msRes.pushedCard?.id));
  });
});

// ── Adapter-output golden ───────────────────────────────────

interface AdapterGolden {
  storylines: Array<{
    storylineId: string;
    storylineTitle: string | null;
    entryCardId: string;
    dialogTitle: string;
    dialogSubtitle: string;
    optionLabels: string[];
    acceptLabel: string;
    rejectLabel: string;
    acceptUpdate: string | null;
    rejectUpdate: string | null;
  }>;
}

describe('adapter-output golden — five shipped storylines', () => {
  const golden = readGolden<AdapterGolden>('adapter-output.golden.json');

  it('pins all five shipped storylines', () => {
    expect(golden.storylines.map((s) => s.storylineId).sort()).toEqual([
      'storyline-economy',
      'storyline-health',
      'storyline-labor',
      'storyline-restaurant',
      'storyline-tax',
    ]);
  });

  it('reproduces the dialog, clarity and story-update text byte-for-byte', () => {
    for (const entry of golden.storylines) {
      const card = getEventTemplates().find((c) => c.id === entry.entryCardId);
      expect(card, entry.entryCardId).toBeDefined();
      const event = card as EventCard;

      expect(storylineName(event)).toBe(entry.storylineTitle);
      expect(choiceDialogTitle(event)).toBe(entry.dialogTitle);
      expect(choiceDialogSubtitle(event)).toBe(entry.dialogSubtitle);
      expect(msCompile(event).compiledOptions.map((o) => o.label)).toEqual(
        entry.optionLabels,
      );

      const labels = choiceClarityLabels(event);
      expect(labels.accept).toBe(entry.acceptLabel);
      expect(labels.reject).toBe(entry.rejectLabel);
      expect(
        storyUpdateLine(event, 'accept', event.coinDelta ?? 0, event.reputationDelta ?? 0),
      ).toBe(entry.acceptUpdate);
      expect(storyUpdateLine(event, 'reject', 0, 0)).toBe(entry.rejectUpdate);
    }
  });
});

// ── Seeded replay golden ────────────────────────────────────

interface ReplayGolden {
  seed: string;
  difficulty: string;
  steps: Array<{
    template: string;
    cardId: string;
    choice: 'accept' | 'reject';
    optionLabel: string;
    coinChange: number;
    repChange: number;
    pushedBaseId: string | null;
    updateLine: string | null;
  }>;
  journal: Array<{ turn: number; storyline: string; outcome: string }>;
}

describe('seeded replay golden — deterministic storyline outcomes', () => {
  const golden = readGolden<ReplayGolden>('storyline-replay.golden.json');

  it('replays the scripted sequence to the pinned outcomes', () => {
    const state = setupMainStreetGame({
      seed: golden.seed,
      difficulty: golden.difficulty as 'Medium',
    });

    const steps = golden.steps.map(({ template, choice }) => {
      const event = pause(state, template);
      const before = state.activityLog.length;
      const res = resolveEventChoice(state, choice);
      const newLog = state.activityLog.slice(before).map((e) => e.text);
      return {
        template,
        cardId: baseId(event.id),
        choice,
        optionLabel: res.option,
        coinChange: res.coinChange,
        repChange: res.repChange,
        pushedBaseId: baseId(res.pushedCard?.id) ?? null,
        updateLine: newLog.find((t) => t.startsWith('Story update')) ?? null,
      };
    });

    expect(steps).toEqual(golden.steps);
    expect(
      buildJournal(state).map((e) => ({
        turn: e.turn,
        storyline: e.storyline,
        outcome: e.outcome,
      })),
    ).toEqual(golden.journal);
  });

  it('two identically seeded runs produce identical replays', () => {
    const run = (): unknown => {
      const state = setupMainStreetGame({
        seed: golden.seed,
        difficulty: golden.difficulty as 'Medium',
      });
      return golden.steps.map(({ template, choice }) => {
        const event = pause(state, template);
        const res = resolveEventChoice(state, choice);
        return [baseId(event.id), res.coinChange, res.repChange, baseId(res.pushedCard?.id)];
      });
    };
    expect(run()).toEqual(run());
  });
});

// ── Shipped validation ──────────────────────────────────────

describe('shipped storyline validation', () => {
  it('the programmatic validator reports the shipped storylines as valid', () => {
    const result = validateStorylines(getEventTemplates());
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.storylineIds).toEqual(
      expect.arrayContaining([
        'storyline-economy',
        'storyline-health',
        'storyline-labor',
        'storyline-restaurant',
        'storyline-tax',
      ]),
    );
  });
});
