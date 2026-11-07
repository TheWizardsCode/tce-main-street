/**
 * Out-of-actions dialog — browser tests (MS-0MW3O2NO5007S53Y).
 *
 * Covers the parent *Auto advance turn* epic's dialog-facing acceptance
 * criteria in a real Phaser scene (parent AC6b/c — the dialog appearing when
 * the setting is off, the checkbox persisting the preference and the panel
 * toggle reflecting it; parent AC3/AC4 behaviour of the dialog itself):
 *
 * 1. **Dialog appears when the setting is off** — spending the last action
 *    point with auto-advance disabled opens the explainer dialog (title,
 *    End Turn / Dismiss affordances, unchecked enable checkbox), rendered at
 *    the established overlay depths (backdrop 199 / box 200 / elements 201),
 *    and the once-per-turn latch suppresses a duplicate.
 * 2. **Checkbox persists the preference** — ticking it writes the stored
 *    preference immediately, and the next zero-action moment auto-advances
 *    (End Turn dispatch) instead of re-showing the dialog.
 * 3. **End Turn button works** — clicking it dismisses the dialog and runs
 *    the same `s.endTurn()` path as the HUD button, completing the turn.
 * 4. **Dismiss returns to market** — the player stays in the market phase
 *    with the HUD End Turn button still available.
 * 5. **Panel toggle reflects the setting** — the Settings panel renders the
 *    *Auto advance turn* extra toggle reading the persisted preference
 *    (OFF → ON on flip, ON when pre-enabled), and flipping it persists.
 *
 * The trigger seam under test is `MainStreetScene.maybeRunOutOfActionsTrigger()`
 * (the post-action hook, MS-0MW3O2NBM001CLKW), driven through its public
 * scene API exactly as the action-completion sites call it.
 *
 * @module tests/main-street/MainStreetOutOfActionsDialog.browser
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForCondition } from '@core-tests/helpers/waitForCondition';
import { waitForScene } from '@core-tests/helpers/waitForScene';
import { dismissBootModals } from './helpers/bootModals';
import { dismissTurnSummaryDialogIfPresent } from './helpers/turn-summary-dialog';
import { AUTO_ADVANCE_TURN_KEY, isAutoAdvanceTurnEnabled } from '../../src/MainStreetPrefs';
import { TUTORIAL_STATE_STORAGE_KEY } from '../../src/TutorialState';

// ── Dialog surface (must match MainStreetOverlayContent.showOutOfActionsDialog) ──

const DIALOG_TITLE = 'No Actions Left';
const CHECKBOX_OFF = '[ ] Automatically end my turn when I run out of actions';
const CHECKBOX_ON = '[x] Automatically end my turn when I run out of actions';
const END_TURN_BUTTON = '[ End Turn ]';
const DISMISS_BUTTON = '[ Dismiss ]';
const PANEL_TOGGLE_LABEL = 'Auto advance turn';

// ── Boot helpers (mirrors event-choice-dialog.browser.test.ts) ──

type SceneHandle = Phaser.Scene & Record<string, any>;

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
  // tutorial guard never suppresses it.
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

/** Walk a container and collect every text label (including nested). */
function collectLabels(container: Phaser.GameObjects.Container | undefined): string[] {
  const labels: string[] = [];
  const walk = (obj: Phaser.GameObjects.GameObject): void => {
    if (obj instanceof Phaser.GameObjects.Text) {
      if (typeof obj.text === 'string' && obj.text.length > 0) labels.push(obj.text);
      return;
    }
    const inner = obj as Phaser.GameObjects.Container;
    if (inner.type === 'Container' && Array.isArray(inner.list)) inner.list.forEach(walk);
  };
  (container?.list ?? []).forEach(walk);
  return labels;
}

/** Find every Text object whose content matches, recursing into containers. */
function findTextObjects(
  container: Phaser.GameObjects.Container,
  text: string,
): Phaser.GameObjects.Text[] {
  const results: Phaser.GameObjects.Text[] = [];
  const visit = (c: Phaser.GameObjects.Container) => {
    c.each((child: Phaser.GameObjects.GameObject) => {
      if (child instanceof Phaser.GameObjects.Text && child.text === text) {
        results.push(child);
      } else if (child instanceof Phaser.GameObjects.Container) {
        visit(child);
      }
    });
  };
  visit(container);
  return results;
}

/**
 * Opens the dialog through the public trigger seam: spend the last action
 * point (live budget 0) with auto-advance disabled and run the post-action
 * hook exactly as the action-completion sites do.
 */
function openOutOfActionsDialog(s: SceneHandle): void {
  s.state.actionsRemaining = 0;
  s.outOfActionsLatchFired = false;
  s.uiPhase = 'market';
  s.maybeRunOutOfActionsTrigger();
}

// ── Tests ──────────────────────────────────────────────────

describe('Main Street out-of-actions dialog (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('opens the dialog when the setting is off and the last action is spent (AC1)', async () => {
    game = await bootGame(false);
    const s = game.scene.getScene('MainStreetScene') as SceneHandle;

    openOutOfActionsDialog(s);

    await waitForCondition(
      () => Boolean(hudText(s, END_TURN_BUTTON) && hudText(s, CHECKBOX_OFF)),
      { timeoutMs: 10_000, label: 'out-of-actions dialog visible' },
    );

    // Content: title, End Turn / Dismiss affordances, unchecked checkbox.
    expect(hudText(s, DIALOG_TITLE)).toBeDefined();
    expect(hudText(s, CHECKBOX_OFF)).toBeDefined();
    expect(hudText(s, DISMISS_BUTTON)).toBeDefined();

    // Overlay pattern compliance: elements at depth 201, interactive, and
    // the backdrop (199) + box (200) registered in overlayObjects.
    const endTurn = hudText(s, END_TURN_BUTTON)!;
    const dismiss = hudText(s, DISMISS_BUTTON)!;
    const checkbox = hudText(s, CHECKBOX_OFF)!;
    for (const element of [hudText(s, DIALOG_TITLE)!, endTurn, dismiss, checkbox]) {
      expect(element.depth).toBe(201);
    }
    // Interactive affordances are clickable; the checkbox is unchecked by
    // default (the dialog only shows while the setting is off).
    for (const element of [endTurn, dismiss, checkbox]) {
      expect(element.input?.enabled).toBe(true);
    }
    const overlayObjects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
    const depths = overlayObjects.map(
      (o) => (o as Phaser.GameObjects.GameObject & { depth?: number }).depth,
    );
    expect(depths).toContain(199);
    expect(depths).toContain(200);
    expect(depths.filter((d) => d === 201).length).toBeGreaterThanOrEqual(4);

    // The dialog is the not-auto-advancing path: the turn has not moved.
    expect(isAutoAdvanceTurnEnabled()).toBe(false);

    // Once-per-turn latch: a repeated trigger fires no duplicate dialog.
    s.maybeRunOutOfActionsTrigger();
    expect(hudTexts(s).filter((t) => t.text === CHECKBOX_OFF)).toHaveLength(1);
    expect(s.outOfActionsLatchFired).toBe(true);
    expect(s.uiPhase).toBe('market');
  }, 30_000);

  it('persists the preference when the checkbox is ticked and auto-advances on the next zero-action event (AC2)', async () => {
    game = await bootGame(false);
    const s = game.scene.getScene('MainStreetScene') as SceneHandle;

    openOutOfActionsDialog(s);
    await waitForCondition(() => Boolean(hudText(s, CHECKBOX_OFF)), {
      timeoutMs: 10_000,
      label: 'out-of-actions dialog visible',
    });

    // Tick the checkbox: the preference is persisted immediately.
    hudText(s, CHECKBOX_OFF)!.emit('pointerdown');
    expect(hudText(s, CHECKBOX_ON)).toBeDefined();
    expect(isAutoAdvanceTurnEnabled()).toBe(true);
    expect(localStorage.getItem(AUTO_ADVANCE_TURN_KEY)).toBe('true');

    // Dismiss; then simulate the next turn (the day-start latch reset) and
    // spend the last action again: auto-advance now dispatches End Turn and
    // the dialog is NOT re-presented.
    hudText(s, DISMISS_BUTTON)!.emit('pointerdown');
    await waitForCondition(() => (s.overlayObjects?.length ?? 1) === 0, {
      timeoutMs: 10_000,
      label: 'dialog dismissed',
    });

    s.outOfActionsLatchFired = false; // startTurnPhase resets this each day
    s.state.actionsRemaining = 0;
    const endTurnSpy = vi.spyOn(s, 'endTurn');
    s.maybeRunOutOfActionsTrigger();

    expect(endTurnSpy).toHaveBeenCalledTimes(1);
    expect(s.outOfActionsLatchFired).toBe(true);
    expect(hudText(s, CHECKBOX_ON)).toBeUndefined();
    expect(hudText(s, CHECKBOX_OFF)).toBeUndefined();
  }, 30_000);

  it('completes the turn when the dialog End Turn button is pressed (AC3)', async () => {
    game = await bootGame(false);
    const s = game.scene.getScene('MainStreetScene') as SceneHandle;

    openOutOfActionsDialog(s);
    await waitForCondition(() => Boolean(hudText(s, END_TURN_BUTTON)), {
      timeoutMs: 10_000,
      label: 'out-of-actions dialog visible',
    });

    const turnBefore = s.state.turn;
    hudText(s, END_TURN_BUTTON)!.emit('pointerdown');

    // The dialog's End Turn runs the identical `s.endTurn()` path the HUD
    // button uses: advance through any end-of-turn presentation gates
    // (event choice, turn summary) until the next day starts.
    await waitForCondition(
      () => {
        if (s.state.turn === turnBefore + 1) return true;
        const reject = hudText(s, 'Reject');
        if (reject) reject.emit('pointerdown');
        dismissTurnSummaryDialogIfPresent(s);
        return false;
      },
      { timeoutMs: 45_000, label: 'day advances after dialog End Turn' },
    );

    expect(s.state.turn).toBe(turnBefore + 1);

    // The dialog is gone along with the turn.
    await waitForCondition(
      () => Boolean(!hudText(s, CHECKBOX_OFF) && !hudText(s, CHECKBOX_ON) && (s.overlayObjects?.length ?? 1) === 0),
      { timeoutMs: 10_000, label: 'dialog dismissed by End Turn' },
    );
  }, 60_000);

  it('Dismiss returns to the market phase with End Turn still available (AC4)', async () => {
    game = await bootGame(false);
    const s = game.scene.getScene('MainStreetScene') as SceneHandle;

    openOutOfActionsDialog(s);
    await waitForCondition(() => Boolean(hudText(s, DISMISS_BUTTON)), {
      timeoutMs: 10_000,
      label: 'out-of-actions dialog visible',
    });

    hudText(s, DISMISS_BUTTON)!.emit('pointerdown');

    await waitForCondition(
      () => (s.overlayObjects?.length ?? 1) === 0 && !hudText(s, CHECKBOX_OFF),
      { timeoutMs: 10_000, label: 'dialog dismissed' },
    );

    // Still in the market phase, nothing advanced.
    expect(s.state.phase).toBe('MarketPhase');
    expect(s.uiPhase).toBe('market');
    expect(isAutoAdvanceTurnEnabled()).toBe(false);

    // The HUD End Turn button remains available.
    const actionLabels = collectLabels(s.actionContainer);
    expect(actionLabels).toContain('End Turn');
  }, 30_000);

  it('renders the settings panel toggle OFF and flips (and persists) it (AC5)', async () => {
    game = await bootGame(false);
    const s = game.scene.getScene('MainStreetScene') as SceneHandle;

    s.settingsPanel.open();
    const panel = s.settingsPanel as any;
    const views = (panel._extraToggleViews ?? []) as Array<{
      label: Phaser.GameObjects.Text;
      statusText: Phaser.GameObjects.Text;
      hitArea: Phaser.GameObjects.Zone;
    }>;

    // One game-supplied toggle, labelled, reading the persisted preference.
    expect(views).toHaveLength(1);
    expect(views[0].label.text).toBe(PANEL_TOGGLE_LABEL);
    expect(findTextObjects(panel.container, PANEL_TOGGLE_LABEL)).toHaveLength(1);
    expect(views[0].statusText.text).toBe('OFF');

    // Flip the toggle: the preference is persisted and the panel reflects it.
    views[0].hitArea.emit('pointerdown');
    await waitForCondition(() => views[0].statusText.text === 'ON', {
      timeoutMs: 5_000,
      label: 'auto-advance toggle ON',
    });
    expect(isAutoAdvanceTurnEnabled()).toBe(true);
    expect(localStorage.getItem(AUTO_ADVANCE_TURN_KEY)).toBe('true');
  }, 30_000);

  it('opens the panel showing ON when the preference is already enabled (AC5)', async () => {
    game = await bootGame(true);
    const s = game.scene.getScene('MainStreetScene') as SceneHandle;

    s.settingsPanel.open();
    const panel = s.settingsPanel as any;
    const views = (panel._extraToggleViews ?? []) as Array<{
      statusText: Phaser.GameObjects.Text;
      hitArea: Phaser.GameObjects.Zone;
    }>;

    // The stored preference is reflected on open.
    expect(views).toHaveLength(1);
    expect(views[0].statusText.text).toBe('ON');

    // Flipping off persists the opt-out.
    views[0].hitArea.emit('pointerdown');
    await waitForCondition(() => views[0].statusText.text === 'OFF', {
      timeoutMs: 5_000,
      label: 'auto-advance toggle OFF',
    });
    expect(isAutoAdvanceTurnEnabled()).toBe(false);
    expect(localStorage.getItem(AUTO_ADVANCE_TURN_KEY)).toBe('false');
  }, 30_000);
});
