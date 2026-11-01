/**
 * Browser regression: banking hint re-arm on a new game (MS-0MV79JQ4H003E6BH).
 *
 * Bug: the contextual banking hint is one-shot and its persisted flag
 * (`bankingHintShownAt`, per-browser localStorage) was never cleared, so a
 * returning player who had ever seen the hint never saw it again in any later
 * new game — even though each playthrough's first bank should teach it.
 *
 * Fix: starting a new game (any mode) or starting the tutorial re-arms the
 * flag. These tests drive the real end-turn path and assert the hint overlay.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Phaser from 'phaser';
import { waitForScene } from '@core-tests/helpers/waitForScene';
import { getEventTemplates } from '../../src/MainStreetCards';
import { dismissTurnSummaryDialog } from './helpers/turn-summary-dialog';

const TUTORIAL_STATE_KEY = 'tce-main-street-tutorial-state';

function seedTutorialState(bankingHintShownAt: string | null): void {
  localStorage.setItem(TUTORIAL_STATE_KEY, JSON.stringify({
    schemaVersion: 1,
    status: 'not_seen',
    completedAt: null,
    lastStepId: null,
    bankingHintShownAt,
  }));
}

function readTutorialState(): any {
  const raw = localStorage.getItem(TUTORIAL_STATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

async function bootGame(): Promise<Phaser.Game> {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('tce-') || key.startsWith('main-street:')) localStorage.removeItem(key);
    }
  } catch { /* ignore */ }

  let container = document.getElementById('game-container');
  if (container) container.remove();
  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: Phaser.CANVAS, parent: 'game-container' });
  await waitForScene(game, 'MainStreetScene');
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
  try { localStorage.removeItem(TUTORIAL_STATE_KEY); } catch { /* ignore */ }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 15_000,
  pollMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

/** Force non-choice incidents so a completed turn never pauses on a dialog. */
function forceSafeIncidents(scene: any): void {
  const safeTemplates = getEventTemplates().filter((t) =>
    ['evt-award', 'evt-good-press', 'evt-graffiti-art', 'evt-street-cleaning'].includes(t.id),
  );
  scene.state.incidentDeck.length = 0;
  scene.state.incidentDeck.push(
    ...safeTemplates.map((t, i) => ({ ...t, id: `${t.id}-${i}` })),
    ...safeTemplates.map((t, i) => ({ ...t, id: `${t.id}-${i + 10}` })),
  );
}

/**
 * Put a choice incident at the top of the incident deck, backed by safe
 * (non-choice) incidents so only the first draw pauses for a dialog.
 */
function forceChoiceFirstIncident(scene: any): void {
  const choice = getEventTemplates().find((t: any) => (t as any).hasChoices === true);
  if (!choice) throw new Error('No choice event template found for the swallow regression');
  const safeTemplates = getEventTemplates().filter((t) =>
    ['evt-award', 'evt-good-press', 'evt-graffiti-art', 'evt-street-cleaning'].includes(t.id),
  );
  scene.state.incidentDeck.length = 0;
  scene.state.incidentDeck.push(
    { ...choice, id: `${choice.id}-0` },
    ...safeTemplates.map((t, i) => ({ ...t, id: `${t.id}-${i}` })),
    ...safeTemplates.map((t, i) => ({ ...t, id: `${t.id}-${i + 10}` })),
  );
}

/** Drive a real end-turn with one bankable action; return the hint tooltip. */
async function endTurnWithSpareAction(scene: any): Promise<Element | null> {
  try { scene?.tutorialOfferModal?.hide?.(); } catch { /* ignore */ }
  try { scene?.newGameOverlay?.hide?.(); } catch { /* ignore */ }
  scene.uiPhase = 'market';

  forceSafeIncidents(scene);
  scene.state.actionsRemaining = 1;
  scene.state.bankedActions = 0;
  const beforeTurn = scene.state.turn;
  scene.msTurnController.endTurn();
  // The Turn Summary gate (MS-0MVP46Q8X003419R) blocks the advance until
  // [ Next Turn ] is clicked; dismiss it so the turn-advance wait below is
  // unchanged, then the hint presents after the dialog on the closing tail.
  await dismissTurnSummaryDialog(scene, { timeoutMs: 15_000 });
  await waitFor(() => scene.state.turn > beforeTurn, 15_000);
  // Give the closing presentation a beat before reading the DOM.
  await new Promise((r) => setTimeout(r, 2500));
  return document.querySelector('.ms-tutorial-tooltip');
}

describe('banking hint re-arm on a new game (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('fires the hint on the first bank of a fresh profile', async () => {
    game = await bootGame();
    const scene: any = game.scene.getScene('MainStreetScene');
    await new Promise((r) => setTimeout(r, 500));

    const tooltip = await endTurnWithSpareAction(scene);
    expect(Boolean(tooltip), 'fresh profile should see the hint').toBe(true);
    expect(tooltip?.textContent).toContain('Bank your spare action');
    // The flag is now set (one-shot within the run).
    expect(readTutorialState()?.bankingHintShownAt).not.toBeNull();
  }, 60_000);

  it('re-arms a stale flag when a new game starts, so the returning player sees the hint', async () => {
    game = await bootGame();
    const scene: any = game.scene.getScene('MainStreetScene');
    await new Promise((r) => setTimeout(r, 500));

    // Simulate a returning browser: the hint fired in a previous game and the
    // flag persisted (it is per-browser and was never cleared before the fix).
    seedTutorialState('2026-10-01T00:00:00.000Z');

    // Starting a new game must re-arm the hint.
    scene.msLifecycleManager.applyNewGameSelection({ mode: 'single-player' });
    await waitFor(() => readTutorialState()?.bankingHintShownAt === null, 5_000);

    const tooltip = await endTurnWithSpareAction(scene);
    expect(Boolean(tooltip), 're-armed profile should see the hint').toBe(true);
    expect(tooltip?.textContent).toContain('Bank your spare action');
  }, 60_000);

  it('re-arms a stale flag when the tutorial starts, so the returning player sees the hint', async () => {
    const { bootGameWithTutorial, destroyGame: destroyTutorialGame } = await import(
      './helpers/main-street-tutorial-e2e',
    );
    game = await bootGameWithTutorial();
    const scene: any = game!.scene.getScene('MainStreetScene');

    // Returning browser: the hint fired in a previous game and the flag
    // persisted (never cleared before this fix). Seed it after boot — the
    // helper wiped storage during boot — but before clicking Start Tutorial.
    seedTutorialState('2026-10-01T00:00:00.000Z');
    expect(readTutorialState()?.bankingHintShownAt).not.toBeNull();

    // Click the tutorial offer's Start Tutorial button.
    const start = Date.now();
    let startBtn: any = null;
    while (Date.now() - start < 15_000) {
      startBtn = (scene as any)?.tutorialOfferModal?.overlayObjects?.find(
        (o: any) => o instanceof Phaser.GameObjects.Text && o.text === '[ Start Tutorial ]',
      ) ?? null;
      if (startBtn) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(startBtn, 'Start Tutorial button should appear').toBeTruthy();
    startBtn.emit('pointerdown', {
      x: startBtn.x, y: startBtn.y, worldX: startBtn.x, worldY: startBtn.y,
    });

    // Starting the tutorial re-arms the hint (MS-0MV79JQ4H003E6BH fix).
    await waitFor(() => readTutorialState()?.bankingHintShownAt === null, 5_000);
    expect(readTutorialState()?.bankingHintShownAt).toBeNull();
  }, 60_000);

  it('does not swallow the hint when the first bank turn pauses for an event choice', async () => {
    // Regression (MS-0MV79JQ4H003E6BH): the one-shot flag used to be persisted
    // when the turn ENDED, before the overlay was shown. A first-bank turn
    // that paused on an event-choice dialog therefore consumed the flag
    // without ever presenting the overlay — the hint was muted for the whole
    // playthrough ("still not firing" manual-review repro). The flag must
    // only be committed at actual presentation, and the armed hint must
    // survive the choice pause into the resumed closing.
    game = await bootGame();
    const scene: any = game.scene.getScene('MainStreetScene');
    await new Promise((r) => setTimeout(r, 500));

    forceChoiceFirstIncident(scene);
    scene.uiPhase = 'market';
    scene.state.actionsRemaining = 1;
    scene.state.bankedActions = 0;
    scene.msTurnController.endTurn();

    // The turn pauses for the choice dialog...
    await waitFor(
      () => Boolean(scene.state.pendingEventChoice) && !scene.state.pendingEventChoice.resolved,
      15_000,
    );
    // ...and the one-shot flag is NOT consumed yet (nothing has been shown).
    expect(readTutorialState()?.bankingHintShownAt ?? null).toBeNull();

    // Resolving the choice resumes the closing, which presents the armed hint.
    scene.msTurnController.onEventChoice('accept');
    await waitFor(() => Boolean(document.querySelector('.ms-tutorial-tooltip')), 30_000);
    const tooltip = document.querySelector('.ms-tutorial-tooltip');
    expect(tooltip?.textContent).toContain('Bank your spare action');
    // The hint is still one-shot within the playthrough once shown.
    expect(readTutorialState()?.bankingHintShownAt).not.toBeNull();
  }, 60_000);
});
