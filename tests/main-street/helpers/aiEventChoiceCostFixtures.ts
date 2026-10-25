/**
 * Shared cost/extra-effect storyline-option fixtures for the cost-aware AI
 * event-choice harness verification (MS-0MVNU5HNV007R803).
 *
 * Registers a three-option list over the shipped `evt-tax` card so the AI
 * harnesses exercise both cost-gated and extra-effect options end-to-end
 * through the real draw → presented-list → transcript path:
 *
 * | Option                | Cost (`coins`) | Chain                       | Projected value |
 * |-----------------------|----------------|-----------------------------|-----------------|
 * | `Bribe the inspector` | 1 000 000      | terminal (severity 0)       | 1 000 000       |
 * | `Absorb the audit`    | —              | terminal + `extraEffect` +250 | −250          |
 * | `Fight the audit`     | —              | `evt-tax-inquiry` (severity 10 600) | 10 600 |
 *
 * The 1 000 000-coin bribe is unaffordable for the whole of every run, so the
 * draw-time affordability filter always drops it from the **presented** list.
 * It is also the safest chain, so a policy that scored the raw list would pick
 * it — a chosen `Bribe the inspector` label therefore proves the presented-list
 * contract was violated. `Fight the audit` escalates into the punitive inquiry,
 * so a chosen `Fight the audit` label proves the extra-effect term was ignored.
 * The only correct choice is `Absorb the audit`, which makes the harness
 * assertions sharp and content-independent.
 *
 * @module tests/main-street/helpers/aiEventChoiceCostFixtures
 */

import { getEventTemplates } from '../../../src/MainStreetCards';
import type { StorylineOption } from '../../../src/MainStreetCardsTypes';
import type { MainStreetState } from '../../../src/MainStreetState';
import { registerStorylineOptions } from '../../../src/MainStreetStoryline';

/** Shipped card the fixtures are registered over (a choice incident). */
export const COST_FIXTURE_EVENT_ID = 'evt-tax';

/** Cost-gated option label — never affordable, so never presented. */
export const COST_GATED_LABEL = 'Bribe the inspector';

/** Extra-effect option label — the only correct choice (value −250). */
export const EXTRA_EFFECT_LABEL = 'Absorb the audit';

/** Escalating option label — punishes a policy that ignores extra effects. */
export const ESCALATING_LABEL = 'Fight the audit';

/** The labels the draw-time filter always presents, in list order. */
export const PRESENTED_LABELS = [EXTRA_EFFECT_LABEL, ESCALATING_LABEL] as const;

/** Every label the raw (unfiltered) registered list contains. */
export const ALL_LABELS = [COST_GATED_LABEL, EXTRA_EFFECT_LABEL, ESCALATING_LABEL] as const;

/** The fixture option list as registered on {@link COST_FIXTURE_EVENT_ID}. */
export const COST_FIXTURE_OPTIONS: readonly StorylineOption[] = [
  {
    label: COST_GATED_LABEL,
    successorIds: [],
    effectPolicy: 'apply',
    cost: { coins: 1_000_000 },
  },
  {
    label: EXTRA_EFFECT_LABEL,
    successorIds: [],
    effectPolicy: 'apply',
    extraEffect: { coins: 250 },
  },
  {
    label: ESCALATING_LABEL,
    successorIds: ['evt-tax-inquiry'],
    effectPolicy: 'apply',
  },
];

/**
 * Registers the cost/extra-effect fixture options on {@link COST_FIXTURE_EVENT_ID}.
 * Call in the test body; `resetStorylineRegistry()` in `afterEach` clears it.
 */
export function registerAiCostFixtures(): void {
  registerStorylineOptions(COST_FIXTURE_EVENT_ID, [...COST_FIXTURE_OPTIONS]);
}

/**
 * Queues the fixture card as the next drawn incident (clearing the deck, the
 * same convention the storyline regression harness uses).
 *
 * @param state Game state whose incident deck is replaced (mutated).
 */
export function queueCostFixtureChoice(state: MainStreetState): void {
  const template = getEventTemplates().find((c) => c.id === COST_FIXTURE_EVENT_ID);
  if (!template) {
    throw new Error(`Shipped choice card ${COST_FIXTURE_EVENT_ID} not found`);
  }
  state.incidentDeck.length = 0;
  state.incidentDeck.push({ ...template, id: `${template.id}-0` });
}
