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
});
