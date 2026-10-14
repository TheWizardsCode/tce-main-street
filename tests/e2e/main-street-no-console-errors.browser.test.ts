/**
 * Main Street startup console-error regression tests.
 *
 * Ensures that starting Main Street does not produce console errors —
 * particularly the `drawImage(null)` crash that occurred when cached Phaser
 * textures were cleared with a yield point before rasterisation could replace
 * them.
 *
 * The test boots a full Phaser game in a browser environment, captures all
 * console.error / console.warn calls during startup, and asserts that no
 * unexpected errors occurred.
 *
 * This file was extracted from the core `tableau-card-engine` repo, where it
 * also covered the Golf and Beleaguered Castle example games. Those games do
 * not ship in the Main Street repo (see MS-0MUTU19SF007791K: the stale
 * `../../example-games/*` and `../helpers/waitForScene` imports left the file
 * unloadable), so only the Main Street boot coverage is retained here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Phaser from 'phaser';
import { page } from '@vitest/browser/context';
import { waitForScene } from '@core-tests/helpers/waitForScene';
import { destroyGame } from '../main-street/helpers/main-street-tutorial-e2e';

const SCENE_LOAD_TIMEOUT = 30_000;

let game: Phaser.Game | null = null;
let errorSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let capturedErrors: string[] = [];
let capturedWarns: string[] = [];

/** Clean up stale DOM canvases and the game container. */
function cleanDom(): void {
  document.querySelectorAll('canvas').forEach((el) => el.remove());
  const existing = document.getElementById('game-container');
  if (existing) existing.remove();
}

/** Create a fresh DOM container for the game. */
function createContainer(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);
  return container;
}

/** Boot a Main Street game and wait for its async setup to settle. */
async function bootMainStreetGame(): Promise<Phaser.Game> {
  cleanDom();
  createContainer();

  const { createMainStreetGame } = await import(
    '../../src/createMainStreetGame'
  );

  const newGame = createMainStreetGame({
    type: Phaser.CANVAS,
    parent: 'game-container',
    width: 1280,
    height: 720,
  });

  await waitForScene(newGame, 'MainStreetScene', SCENE_LOAD_TIMEOUT);

  // Wait for async SVG loading, campaign load, and prewarm to complete
  const scene = newGame.scene.getScene('MainStreetScene') as any;
  if (scene?.cardSvgLoadPromise) {
    await scene.cardSvgLoadPromise;
  }
  const campaignPromise = scene?._campaignLoadPromise;
  if (campaignPromise) {
    await campaignPromise;
  }

  // Extra settle time for SVG rasterisation, render loop, and post-prewarm refresh
  await new Promise((r) => setTimeout(r, 500));

  return newGame;
}

/** Set up console spies before each test. */
function setupConsoleSpies(): void {
  capturedErrors = [];
  capturedWarns = [];

  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    capturedErrors.push(args.map((a: any) => String(a)).join(' '));
  });
  warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
    capturedWarns.push(args.map((a: any) => String(a)).join(' '));
  });
}

/** Tear down console spies and destroy the game after each test. */
async function teardown(): Promise<void> {
  errorSpy?.mockRestore();
  warnSpy?.mockRestore();
  await destroyGame(game);
  game = null;
}

/**
 * Known benign console.error patterns that are pre-existing issues unrelated
 * to the texture fix. These should not cause a test failure.
 */
const BENIGN_ERROR_PATTERNS = [
  /Unable to decode audio data/i,
  /Failed to process file/i,
  /favicon\.ico/i,
];

/** Filter a captured error string against benign patterns. */
function isBenignError(msg: string): boolean {
  return BENIGN_ERROR_PATTERNS.some((pat) => pat.test(msg));
}

/** Assert that no unexpected console.errors occurred during startup. */
function assertNoUnexpectedErrors(gameName: string): void {
  const unexpected = capturedErrors.filter((e) => !isBenignError(e));

  if (capturedErrors.length > 0) {
    console.info(`[${gameName}] All captured console.error:`, JSON.stringify(capturedErrors, null, 2));
    console.info(`[${gameName}] Unexpected errors:`, JSON.stringify(unexpected, null, 2));
  }
  if (capturedWarns.length > 0) {
    console.info(`[${gameName}] Captured console.warn:`, JSON.stringify(capturedWarns, null, 2));
  }

  expect(
    unexpected,
    `${gameName} should have no unexpected console.error during startup`,
  ).toHaveLength(0);

  // Specifically check for the drawImage(null) crash
  for (const err of unexpected) {
    expect(err).not.toContain('drawImage');
    expect(err).not.toContain('canvasData');
    expect(err).not.toContain('Cannot read properties of null');
  }
}

// ── Tests ────────────────────────────────────────────────

describe('Main Street startup — no console errors', () => {
  beforeEach(() => setupConsoleSpies());
  afterEach(async () => teardown());

  it('starts without drawImage / null texture errors', async () => {
    game = await bootMainStreetGame();

    await page.screenshot({
      path: `__screenshots__/main-street-no-console-errors/startup.png`,
    });

    assertNoUnexpectedErrors('MainStreet');
  });
});
