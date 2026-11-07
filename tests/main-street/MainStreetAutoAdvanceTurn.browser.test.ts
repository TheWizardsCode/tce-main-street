/**
 * Auto-advance turn — browser tests (MS-0MW3O2ODT007ZJGL).
 *
 * End-to-end browser coverage for the *Auto advance turn* feature's
 * spent-last-action trigger and its mode guards, in a real Phaser scene
 * (parent AC5 guard behaviour and parent AC6a/d/e browser coverage):
 *
 * 1. **Auto-advance ends the turn exactly once** — spending the last action
 *    point with the setting enabled dispatches the identical `s.endTurn()`
 *    code path the End Turn button uses, fires at most once per turn (the
 *    scene latch suppresses a re-entrant trigger) and completes the day
 *    (income/incident/event-choice resolution + turn-summary gate when the
 *    closing defers — the same experience as clicking End Turn).
 *    *The turn-summary dialog itself is asserted deterministically by
 *    `turn-summary-dialog.browser.test.ts`; from a fresh boot state the
 *    end-of-turn closing is seed-dependent (a randomized event draw can
 *    make it immediate), so AC1 asserts the dispatch + day completion.*
 * 2. **Tutorial guard** — the trigger is suppressed while the tutorial is
 *    active on a non-`end-turn` action step (it honours
 *    `isTutorialActionAllowed('end-turn')`), and fires when the current step
 *    IS `end-turn`.
 * 3. **Competitive guard** — the trigger never fires while an AI seat is
 *    active (the human seat cannot act), and fires when the human seat is
 *    active.
 * 4. **Phase guard** — the trigger stays silent during every `uiPhase`
 *    where End Turn is not offered (`placing-from-hand`, `event-selected`,
 *    `applicant` — the exported `OUT_OF_ACTIONS_SILENT_PHASES` set), and
 *    fires back in the market phase.
 * 5. **Animation gate** — a real market→hand transfer: the trigger does NOT
 *    dispatch while the transfer animation is in flight (the hook only runs
 *    from the animation-completion callback), and fires exactly once after
 *    the animation completes.
 *
 * The trigger seam under test is `MainStreetScene.maybeRunOutOfActionsTrigger()`
 * (the post-action hook, MS-0MW3O2NBM001CLKW), driven through its public
 * scene API exactly as the action-completion sites call it; AC5 additionally
 * drives a real action through `scene.onBusinessCardClick()`.
 *
 * @module tests/main-street/MainStreetAutoAdvanceTurn.browser
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForCondition } from '@core-tests/helpers/waitForCondition';
import { waitForScene } from '@core-tests/helpers/waitForScene';
import { dismissBootModals } from './helpers/bootModals';
import { dismissTurnSummaryDialogIfPresent } from './helpers/turn-summary-dialog';
import { AUTO_ADVANCE_TURN_KEY } from '../../src/MainStreetPrefs';
import { TUTORIAL_STATE_STORAGE_KEY } from '../../src/TutorialState';
import { UNIFIED_TUTORIAL_STEPS } from '../../src/TutorialFlow';
import { OUT_OF_ACTIONS_SILENT_PHASES } from '../../src/scenes/MainStreetOutOfActions';
import { DRAG_TRANSFER_DURATION_MAX_MS } from '../../src/scenes/MainStreetConstants';
import { INCOME_COLLECTION_CAP_MS } from '../../src/scenes/MainStreetAnimatorTiming';
import { refillMarket } from '../../src/MainStreetMarket';

// ── Boot helpers (mirrors MainStreetOutOfActionsDialog.browser.test.ts) ──

type SceneHandle = Phaser.Scene & Record<string, any>;

/** Fixed starvation margin (ms) for waits racing INCOME_COLLECTION_CAP_MS. */
const END_TURN_STARVATION_MARGIN_MS = 24_000;

/** Seed the tutorial as skipped so the boot flow never activates it. */
function seedTutorialSkipped(): void {
  try {
    localStorage.setItem(
      TUTORIAL_STATE_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, status: 'skipped', completedAt: null, lastStepId: null }),
    );
  } catch {
    /* storage may be unavailable */
  }
}

/**
 * Boot a real Main Street game with the auto-advance preference seeded.
 *
 * Reduced motion is forced ON so end-of-turn choreography resolves
 * deterministically and the trigger's tutorial gate stays inactive (the
 * AC5 animation-gate test re-enables the real transfer tween on its own
 * game boot).
 */
async function bootGame(autoAdvancePref?: boolean): Promise<Phaser.Game> {
  try {
    if (autoAdvancePref === undefined) {
      localStorage.removeItem(AUTO_ADVANCE_TURN_KEY);
    } else {
      localStorage.setItem(AUTO_ADVANCE_TURN_KEY, autoAdvancePref ? 'true' : 'false');
    }
  } catch {
    /* ignore — the preference is best-effort */
  }
  seedTutorialSkipped();

  let container = document.getElementById('game-container');
  if (container) container.remove();
  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: Phaser.CANVAS, parent: 'game-container' });
  await waitForScene(game, 'MainStreetScene');
  const s = game.scene.getScene('MainStreetScene') as SceneHandle;

  // Deterministic scene: reduced-motion resolves end-of-turn choreography
  // synchronously; the tutorial controller stays inactive so the trigger's
  // mode guards start from the neutral state.
  if (s.settingsPanel) s.settingsPanel._reducedMotion = true;
  const tutorialController = s.tutorialController;
  if (tutorialController) tutorialController.isActive = false;

  // The boot flow answers the tutorial offer (seeded skipped) and then
  // presents the blocking New Game selector — dismiss it before interacting.
  await dismissBootModals(s);
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
  try {
    localStorage.removeItem(AUTO_ADVANCE_TURN_KEY);
    localStorage.removeItem(TUTORIAL_STATE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ── Scene probe helpers ──

function hudTexts(s: SceneHandle): Phaser.GameObjects.Text[] {
  const list = s.hudContainer?.list;
  if (!list) return [];
  return list.filter(
    (c: Phaser.GameObjects.GameObject) => c instanceof Phaser.GameObjects.Text,
  ) as Phaser.GameObjects.Text[];
}

function hudText(s: SceneHandle, label: string): Phaser.GameObjects.Text | undefined {
  return hudTexts(s).find((t) => t.text === label);
}

/**
 * Drive the spent-last-action trigger moment exactly as the scene's
 * action-completion sites do: the player is out of actions, the latch has
 * not fired this turn, and the scene is in a phase where End Turn is offered.
 */
function spendLastActionMoment(s: SceneHandle): void {
  s.uiPhase = 'market';
  s.outOfActionsLatchFired = false;
  s.state.actionsRemaining = 0;
  s.maybeRunOutOfActionsTrigger();
}

// ── Tests ──────────────────────────────────────────────────

describe('Main Street auto-advance turn (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('ends the turn exactly once when the last action is spent, completing the day (AC1)', async () => {
    game = await bootGame(true); // auto-advance enabled
    const s = game.scene.getScene('MainStreetScene') as SceneHandle;
    const turnBefore = s.state.turn;

    // Spy with call-through: the trigger must dispatch the identical
    // endTurn() path the End Turn button uses, so the real flow still runs.
    const endTurnSpy = vi.spyOn(s, 'endTurn');

    spendLastActionMoment(s);

    // The trigger fired exactly once and latched the once-per-turn guard.
    expect(endTurnSpy).toHaveBeenCalledTimes(1);
    expect(s.outOfActionsLatchFired).toBe(true);

    // At most once per turn: a repeated zero-action detection does not
    // re-enter endTurn (no double advance, no re-entrant end-turn).
    s.maybeRunOutOfActionsTrigger();
    expect(endTurnSpy).toHaveBeenCalledTimes(1);

    // Same effect as clicking End Turn: the day completes and the
    // turn-summary gate is presented (dismiss it and any event choice to
    // let the next day start).
    await waitForCondition(
      () => {
        if (s.state.turn === turnBefore + 1) return true;
        const reject = hudText(s, 'Reject');
        if (reject) reject.emit('pointerdown');
        dismissTurnSummaryDialogIfPresent(s);
        return false;
      },
      {
        capMs: INCOME_COLLECTION_CAP_MS,
        floorMs: END_TURN_STARVATION_MARGIN_MS,
        label: 'auto-advance completes the turn',
      },
    );

    expect(s.state.turn).toBe(turnBefore + 1);

    // `state.turn` increments inside the closing, *before* the deferred
    // closing tail starts the new day — so the once-per-turn latch is still
    // set here (it is exactly what prevents a second, re-entrant advance in
    // this window). Wait for the day start to release it, proving the latch
    // is re-armed for the next turn rather than stuck on.
    await waitForCondition(() => s.outOfActionsLatchFired === false, {
      capMs: INCOME_COLLECTION_CAP_MS,
      floorMs: END_TURN_STARVATION_MARGIN_MS,
      label: 'once-per-turn latch released at the new day start',
    });
  }, 60_000);

  it('suppresses auto-advance during the tutorial unless the current step is end-turn (AC2)', async () => {
    game = await bootGame(true);
    const s = game.scene.getScene('MainStreetScene') as SceneHandle;

    // Activate the tutorial controller on a NON-end-turn action step
    // (T3 requires select-business): the trigger must not fire.
    const nonEndTurnStep = UNIFIED_TUTORIAL_STEPS.findIndex(
      (step) => step.requiredAction === 'select-business',
    );
    expect(nonEndTurnStep).toBeGreaterThanOrEqual(0);
    s.tutorialController = {
      isActive: true,
      currentStepIndex: nonEndTurnStep,
      lastCompletedStepId: null,
      exited: false,
    };

    const endTurnSpy = vi.spyOn(s, 'endTurn').mockImplementation(() => {});

    spendLastActionMoment(s);

    // The live tutorial gate denies end-turn on this step, so the trigger
    // is suppressed: no dispatch, latch untouched.
    expect((s.msLifecycleManager as any).isTutorialActionAllowed('end-turn').allowed).toBe(false);
    expect(endTurnSpy).not.toHaveBeenCalled();
    expect(s.outOfActionsLatchFired).toBe(false);

    // Move to an end-turn step (T6 requires end-turn): the guard lifts and
    // the spent-last-action trigger fires.
    const endTurnStep = UNIFIED_TUTORIAL_STEPS.findIndex(
      (step) => step.requiredAction === 'end-turn',
    );
    expect(endTurnStep).toBeGreaterThanOrEqual(0);
    s.tutorialController = { ...s.tutorialController, currentStepIndex: endTurnStep };

    spendLastActionMoment(s);

    expect((s.msLifecycleManager as any).isTutorialActionAllowed('end-turn').allowed).toBe(true);
    expect(endTurnSpy).toHaveBeenCalledTimes(1);
    expect(s.outOfActionsLatchFired).toBe(true);
  }, 30_000);

  it('never fires for AI seats in competitive play, only on the human seat (AC3)', async () => {
    game = await bootGame(true);
    const s = game.scene.getScene('MainStreetScene') as SceneHandle;

    // Boot straight into a competitive game (2 seats: human + 1 AI).
    s.msLifecycleManager.applyNewGameSelection({
      mode: 'competitive',
      opponents: [{ strategy: 'Greedy', difficulty: 'Medium' }],
    });
    await waitForCondition(() => (s.state?.players?.length ?? 0) === 2, {
      timeoutMs: 20_000,
      label: 'competitive roster active',
    });

    const endTurnSpy = vi.spyOn(s, 'endTurn').mockImplementation(() => {});

    // AI seat 1 is active: the human seat cannot act, so the trigger stays
    // silent.
    s.state.activePlayerId = 1;
    spendLastActionMoment(s);
    expect(endTurnSpy).not.toHaveBeenCalled();
    expect(s.outOfActionsLatchFired).toBe(false);

    // Human seat 0 active: the seat guard lifts and the trigger fires.
    s.state.activePlayerId = 0;
    spendLastActionMoment(s);
    expect(endTurnSpy).toHaveBeenCalledTimes(1);
    expect(s.outOfActionsLatchFired).toBe(true);
  }, 30_000);

  it('stays silent during uiPhase values where End Turn is not offered (AC4)', async () => {
    game = await bootGame(true);
    const s = game.scene.getScene('MainStreetScene') as SceneHandle;
    const endTurnSpy = vi.spyOn(s, 'endTurn').mockImplementation(() => {});

    // The exported silent-phase set covers placing-from-hand, event-selected
    // and applicant; every one must suppress the trigger.
    expect(OUT_OF_ACTIONS_SILENT_PHASES.length).toBeGreaterThan(0);
    for (const phase of OUT_OF_ACTIONS_SILENT_PHASES) {
      s.uiPhase = phase;
      s.outOfActionsLatchFired = false;
      s.state.actionsRemaining = 0;
      s.maybeRunOutOfActionsTrigger();
      expect(endTurnSpy, `phase ${phase}`).not.toHaveBeenCalled();
      expect(s.outOfActionsLatchFired, `phase ${phase}`).toBe(false);
    }

    // Back in the market phase (End Turn offered) the trigger fires.
    s.uiPhase = 'market';
    s.outOfActionsLatchFired = false;
    s.state.actionsRemaining = 0;
    s.maybeRunOutOfActionsTrigger();
    expect(endTurnSpy).toHaveBeenCalledTimes(1);
    expect(s.outOfActionsLatchFired).toBe(true);
  }, 30_000);

  it('waits for the last action’s animation to complete before firing (AC5)', async () => {
    game = await bootGame(true);
    const s = game.scene.getScene('MainStreetScene') as SceneHandle;

    // The animation gate is only observable when the transfer tween really
    // runs: `bootGame` forces reduced motion ON for determinism, so this test
    // turns it back OFF (the animation then really plays).
    s.settingsPanel._reducedMotion = false;
    expect(s.settingsPanel.reducedMotion).toBe(false);

    const endTurnSpy = vi.spyOn(s, 'endTurn').mockImplementation(() => {});

    // Prepare to spend the last action point through a real market→hand
    // transfer: one action left, a business card available in the market.
    s.uiPhase = 'market';
    s.outOfActionsLatchFired = false;
    s.state.actionsRemaining = 1;
    s.state.resourceBank.coins = 2000; // plenty of coins — cost is paid at play

    // Deal the market row deterministically. The market populates
    // ASYNCHRONOUSLY during boot (the established MainStreetScene.browser
    // pattern races it — see its 'market populated at boot' waits), so wait
    // for the boot deal first, then top up with `refillMarket` (a safe
    // top-up that guarantees at least one business card once the decks are
    // live) before finding the card the transfer needs.
    await waitForCondition(
      () => (s.state.market.cards ?? []).length > 0,
      { timeoutMs: 20_000, label: 'market populated at boot' },
    );
    refillMarket(s.state);
    s.refreshAll();
    const business = s.state.market.cards.find((c: any) => c.family === 'business');
    expect(business).toBeDefined();
    const animCountBefore = s.getTransferAnimationCountForTest();
    s.onBusinessCardClick(business);

    // The transfer animation is now in flight, but the post-action trigger
    // has NOT dispatched: the hook is only invoked from the
    // animation-completion callback, never mid-animation, and the action
    // itself is only spent once the animation resolves.
    await waitForCondition(() => s.getTransferAnimationCountForTest() > animCountBefore, {
      label: 'transfer animation started',
    });
    expect(endTurnSpy).not.toHaveBeenCalled();
    expect(s.state.actionsRemaining).toBe(1);

    // Once the transfer animation completes, the trigger fires exactly once.
    await waitForCondition(() => endTurnSpy.mock.calls.length === 1, {
      capMs: DRAG_TRANSFER_DURATION_MAX_MS,
      label: 'auto-advance after transfer animation completes',
    });
    expect(s.state.actionsRemaining).toBe(0);
    expect(s.outOfActionsLatchFired).toBe(true);
  }, 60_000);
});
