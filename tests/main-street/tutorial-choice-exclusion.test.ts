/**
 * Tutorial: Choice Events Excluded (CG-0MTT7FO7I009295E / parent
 * CG-0MTSHG8RP008E128; options-only guard migrated by MS-0MVZNR9U70068PL3)
 *
 * Verifies that the tutorial never surfaces choice incidents. Choice-ness is
 * read from the compiled option model (a CSV `options` encoding or a
 * registered option list) — the options-only replacement for the removed
 * two-way flag:
 *
 * 1. The standard tutorial scenario's incident deck contains only templates
 *    that compile to no choice (empty option list) — the tutorial deck is
 *    scripted from the event pool, so any choice card added to content is
 *    structurally excluded from the tutorial path (producer decision
 *    2026-09-08 Q2 — no choice events in the tutorial; no teaching step is
 *    added).
 * 2. Building a tutorial scenario that pins a card compiling to a choice
 *    fails fast (regression guard): the scenario builder throws instead of
 *    silently shipping a pending choice into the step flow.
 *
 * @module
 */
import { describe, it, expect, afterEach } from 'vitest';

import {
  createTutorialScenario,
  STANDARD_TUTORIAL_SCENARIO,
} from '../../src/TutorialScenario';
import {
  getEventTemplates,
  resetTemplatesToDefault,
} from '../../src/MainStreetCards';
import {
  createPendingStorylineChoice,
  getStorylineOptions,
  resetStorylineRegistry,
} from '../../src/MainStreetStoryline';

afterEach(() => {
  resetTemplatesToDefault();
  resetStorylineRegistry();
});

describe('AC1 — tutorial incident deck excludes choice events', () => {
  it('every incident pinned by the standard tutorial scenario compiles to no choice', () => {
    const templates = new Map(getEventTemplates().map((t) => [t.id, t]));
    for (const templateId of STANDARD_TUTORIAL_SCENARIO.incidentDeck) {
      const template = templates.get(templateId);
      expect(template, `template ${templateId} must exist`).toBeDefined();
      expect(
        getStorylineOptions(template!),
        `tutorial incident ${templateId} must not compile to an option list`,
      ).toHaveLength(0);
      expect(
        createPendingStorylineChoice(template!),
        `tutorial incident ${templateId} must not create a pending choice`,
      ).toBeNull();
    }
    // The scenario actually builds (guard sanity).
    const state = createTutorialScenario();
    expect(state.pendingEventChoice).toBeNull();
  });
});

describe('AC2 — regression guard: a choice event in the tutorial deck fails fast', () => {
  it('createTutorialScenario throws when a pinned incident compiles to a choice', () => {
    // Retrofit an options encoding onto an existing tutorial-pinned template
    // (restored by afterEach → resetTemplatesToDefault). The scenario builder
    // must fail fast instead of shipping a pending choice into the tutorial's
    // scripted step flow.
    const award = getEventTemplates().find((t) => t.id === 'evt-award')!;
    (award as { options?: string }).options = 'Accept|;Reject|';

    const badScenario: typeof STANDARD_TUTORIAL_SCENARIO = {
      ...STANDARD_TUTORIAL_SCENARIO,
      incidentDeck: ['evt-award'],
    };
    expect(() => createTutorialScenario(badScenario)).toThrow(/compiles to a choice/);
  });

  it('the thrown error names the compiled option labels', () => {
    const award = getEventTemplates().find((t) => t.id === 'evt-award')!;
    (award as { options?: string }).options = 'Take the deal|;Walk away|';

    const badScenario: typeof STANDARD_TUTORIAL_SCENARIO = {
      ...STANDARD_TUTORIAL_SCENARIO,
      incidentDeck: ['evt-award'],
    };
    expect(() => createTutorialScenario(badScenario)).toThrow(/Take the deal, Walk away/);
  });
});
