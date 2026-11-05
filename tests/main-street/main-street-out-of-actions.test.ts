/**
 * Main Street: post-action out-of-actions trigger unit tests
 *
 * Verifies the shared post-action out-of-actions trigger
 * (`src/scenes/MainStreetOutOfActions.ts`) introduced for the Auto advance
 * turn feature (MS-0MW1ZDI8Z006GPFY):
 *
 *  - once-per-turn latch (AC "at most once per turn"),
 *  - animation/audio completion gate (AC "after animations/audio complete"),
 *  - auto-advance invoking the same end-turn code path as the End Turn button,
 *  - mode guards (tutorial, non-human competitive seats, disallowed uiPhase).
 *
 * The trigger is a pure decision over an injected state plus a thin
 * orchestrator that dispatches to `tcCtx.endTurn()` — the exact method the
 * End Turn button handler calls — so all four acceptance criteria are
 * unit-testable in Node without a Phaser scene.
 *
 * @module
 */

import { describe, it, expect, vi } from 'vitest';

import type { MainStreetTurnControllerContext } from '../../src/scenes/MainStreetTurnControllerContext';
import {
  OUT_OF_ACTIONS_SILENT_PHASES,
  runOutOfActionsTrigger,
  runPostActionOutOfActionsHook,
  shouldFireOutOfActionsTrigger,
  type OutOfActionsTriggerState,
} from '../../src/scenes/MainStreetOutOfActions';

// ── Helpers ─────────────────────────────────────────────────

/** Builds a fully-passing trigger state; override one guard per test. */
function createTriggerState(
  overrides: Partial<OutOfActionsTriggerState> = {},
): OutOfActionsTriggerState {
  return {
    latchFired: false,
    zeroActions: true,
    presentationComplete: true,
    autoAdvanceEnabled: true,
    endTurnAllowed: null,
    humanSeatTurn: true,
    uiPhase: 'market',
    ...overrides,
  };
}

/** A turn-context stub whose only behaviour is the endTurn spy. */
function createTurnContext(): {
  tcCtx: MainStreetTurnControllerContext;
  endTurn: ReturnType<typeof vi.fn>;
} {
  const endTurn = vi.fn();
  // The trigger depends only on `endTurn()` from the context (hub-and-spoke:
  // helper modules never reach into other helpers), so a partial cast is a
  // faithful test double for the auto-advance path.
  const tcCtx = { endTurn } as unknown as MainStreetTurnControllerContext;
  return { tcCtx, endTurn };
}

// ── Decision: lattice, gates and guards ─────────────────────

describe('shouldFireOutOfActionsTrigger', () => {
  it('fires when every guard passes out of actions in the market phase', () => {
    expect(shouldFireOutOfActionsTrigger(createTriggerState())).toBe(true);
  });

  it('does not fire when the once-per-turn latch is already set', () => {
    // AC: the trigger fires at most once per turn — a second zero-action
    // detection in the same turn must be ignored.
    expect(shouldFireOutOfActionsTrigger(createTriggerState({ latchFired: true }))).toBe(false);
  });

  it('does not fire unless the player is out of actions', () => {
    expect(shouldFireOutOfActionsTrigger(createTriggerState({ zeroActions: false }))).toBe(false);
  });

  it('does not fire before the action animations and audio complete', () => {
    // AC: never mid-animation — the trigger waits for the animations AND
    // audio of the action that spent the last action point.
    expect(shouldFireOutOfActionsTrigger(createTriggerState({ presentationComplete: false }))).toBe(false);
  });

  it('is suppressed during the tutorial unless the current step allows end-turn', () => {
    const inTutorial = { allowed: false, reason: 'Complete the highlighted step first.' };
    expect(shouldFireOutOfActionsTrigger(createTriggerState({ endTurnAllowed: inTutorial }))).toBe(false);
  });

  it('fires during the tutorial when the current step is end-turn', () => {
    expect(shouldFireOutOfActionsTrigger(createTriggerState({ endTurnAllowed: { allowed: true } }))).toBe(true);
  });

  it('treats an absent tutorial gate (not in tutorial) as allowed', () => {
    expect(shouldFireOutOfActionsTrigger(createTriggerState({ endTurnAllowed: undefined }))).toBe(true);
  });

  it('is suppressed while it is not the human seat\u2019s turn', () => {
    // AC: never during non-human seats in competitive play.
    expect(shouldFireOutOfActionsTrigger(createTriggerState({ humanSeatTurn: false }))).toBe(false);
  });

  it.each(['placing-from-hand', 'event-selected', 'applicant'])(
    'is suppressed while End Turn is not offered (uiPhase %s)',
    (uiPhase) => {
      // The three phases named in the feature AC must never fire.
      expect(shouldFireOutOfActionsTrigger(createTriggerState({ uiPhase }))).toBe(false);
    },
  );

  it('silences exactly the phases the feature AC names', () => {
    expect([...OUT_OF_ACTIONS_SILENT_PHASES].sort()).toEqual([
      'applicant',
      'event-selected',
      'placing-from-hand',
    ]);
  });
});

// ── Orchestrator: auto-advance invokes the End Turn path ─────

describe('runOutOfActionsTrigger auto-advance path', () => {
  it('invokes endTurn() — the exact End Turn button path — when enabled', () => {
    const { tcCtx, endTurn } = createTurnContext();

    const fired = runOutOfActionsTrigger(tcCtx, createTriggerState());

    // AC: with the setting enabled the trigger produces the same result as
    // clicking End Turn — it calls the identical `tcCtx.endTurn()`.
    expect(fired).toBe(true);
    expect(endTurn).toHaveBeenCalledTimes(1);
  });

  it('never re-invokes endTurn() once the latch is set, even on repeated zero-action detections', () => {
    const { tcCtx, endTurn } = createTurnContext();
    const state = createTriggerState();

    expect(runOutOfActionsTrigger(tcCtx, state)).toBe(true);
    // The caller records the latch after the first fire (scene-owned flag);
    // a second detection in the same turn must be ignored.
    expect(runOutOfActionsTrigger(tcCtx, createTriggerState({ latchFired: true }))).toBe(false);
    expect(endTurn).toHaveBeenCalledTimes(1);
  });

  it('waits for the action animations and audio to complete before ending the turn', () => {
    const { tcCtx, endTurn } = createTurnContext();

    // Mid-animation detection: the trigger must hold until the presentation
    // completes rather than ending the turn underneath the playing animation.
    expect(runOutOfActionsTrigger(tcCtx, createTriggerState({ presentationComplete: false }))).toBe(false);
    expect(endTurn).not.toHaveBeenCalled();

    // Once the animation/audio completes, the same detection fires.
    expect(runOutOfActionsTrigger(tcCtx, createTriggerState())).toBe(true);
    expect(endTurn).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the player still has actions', () => {
    const { tcCtx, endTurn } = createTurnContext();

    expect(runOutOfActionsTrigger(tcCtx, createTriggerState({ zeroActions: false }))).toBe(false);
    expect(endTurn).not.toHaveBeenCalled();
  });

  it('never ends the turn under the tutorial, non-human seats or disallowed uiPhases', () => {
    const { tcCtx, endTurn } = createTurnContext();

    expect(runOutOfActionsTrigger(tcCtx, createTriggerState({ endTurnAllowed: { allowed: false } }))).toBe(false);
    expect(runOutOfActionsTrigger(tcCtx, createTriggerState({ humanSeatTurn: false }))).toBe(false);
    expect(runOutOfActionsTrigger(tcCtx, createTriggerState({ uiPhase: 'placing-from-hand' }))).toBe(false);
    expect(endTurn).not.toHaveBeenCalled();
  });
});

// ── Orchestrator: dialog seam (setting off) ─────────────────

describe('runOutOfActionsTrigger dialog path', () => {
  it('does not invoke endTurn() with the setting off; opens the explainer dialog instead', () => {
    const { tcCtx, endTurn } = createTurnContext();
    const showDialog = vi.fn();

    const fired = runOutOfActionsTrigger(
      tcCtx,
      createTriggerState({ autoAdvanceEnabled: false }),
      { showDialog },
    );

    expect(fired).toBe(true);
    expect(endTurn).not.toHaveBeenCalled();
    expect(showDialog).toHaveBeenCalledTimes(1);
  });

  it('fires the dialog only once per turn per the latch', () => {
    const { tcCtx } = createTurnContext();
    const showDialog = vi.fn();

    const state = createTriggerState({ autoAdvanceEnabled: false });
    expect(runOutOfActionsTrigger(tcCtx, state, { showDialog })).toBe(true);
    expect(runOutOfActionsTrigger(tcCtx, createTriggerState({ autoAdvanceEnabled: false, latchFired: true }), { showDialog })).toBe(false);
    expect(showDialog).toHaveBeenCalledTimes(1);
  });
});

// ── Wiring hook: post-action scene seam ────────────────────

/** Builds a fully-passing wiring input; override one value per test. */
function createWiring(overrides: Partial<Parameters<typeof runPostActionOutOfActionsHook>[0]> = {}) {
  return {
    latchFired: false,
    actionsRemaining: 0,
    uiPhase: 'market',
    autoAdvanceEnabled: true,
    endTurnAllowed: null,
    humanSeatTurn: true,
    endTurn: vi.fn(),
    showDialog: vi.fn(),
    ...overrides,
  };
}

describe('runPostActionOutOfActionsHook (scene wiring)', () => {
  it('fires endTurn() when the last action was spent at an action-completion site', () => {
    const wiring = createWiring();

    const fired = runPostActionOutOfActionsHook(wiring);

    // The hook is the wiring every action-completion site calls after the
    // animation/audio gate; it derives zeroActions from the live budget and
    // treats the call site itself as presentation-complete.
    expect(fired).toBe(true);
    expect(wiring.endTurn).toHaveBeenCalledTimes(1);
    expect(wiring.showDialog).not.toHaveBeenCalled();
  });

  it('does not fire when the last action has not been spent', () => {
    const wiring = createWiring({ actionsRemaining: 1 });

    expect(runPostActionOutOfActionsHook(wiring)).toBe(false);
    expect(wiring.endTurn).not.toHaveBeenCalled();
  });

  it('returns false and does not dispatch when the once-per-turn latch is set', () => {
    const wiring = createWiring({ latchFired: true });

    expect(runPostActionOutOfActionsHook(wiring)).toBe(false);
    expect(wiring.endTurn).not.toHaveBeenCalled();
  });

  it('dispatches the dialog seam instead of endTurn() when auto-advance is off', () => {
    const wiring = createWiring({ autoAdvanceEnabled: false });

    expect(runPostActionOutOfActionsHook(wiring)).toBe(true);
    expect(wiring.endTurn).not.toHaveBeenCalled();
    expect(wiring.showDialog).toHaveBeenCalledTimes(1);
  });

  it('honours the mode guards through the wiring (tutorial / uiPhase / seat)', () => {
    const wiring = createWiring({ endTurnAllowed: { allowed: false } });
    expect(runPostActionOutOfActionsHook(wiring)).toBe(false);
    expect(runPostActionOutOfActionsHook(createWiring({ uiPhase: 'placing-from-hand' }))).toBe(false);
    expect(runPostActionOutOfActionsHook(createWiring({ humanSeatTurn: false }))).toBe(false);
    expect(wiring.endTurn).not.toHaveBeenCalled();
  });
});
