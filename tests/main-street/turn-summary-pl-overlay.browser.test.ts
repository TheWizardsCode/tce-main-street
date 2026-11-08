/**
 * Unified tabbed P&L Turn Summary overlay — browser tests
 * (MS-0MW5EQHFK005NXXM, parent MS-0MW4XULA90002OEY).
 *
 * Verifies the tabbed profit/loss statement in a real Phaser scene, in both
 * single-player and competitive play (producer answers Q1=A, Q2=A, Q3=A):
 *
 * 1. The statement renders the selected player's P&L lines — Income
 *    (base / synergy / reputation / events) with its total, Less: Operating
 *    expenses (staff / community / business) with its total, the Incident and
 *    One-off adjustments and the emphasised Net profit/loss bottom line — with
 *    the non-monetary figures (reputation/score change, closing balances and
 *    businesses owned) as supplementary context outside the P&L lines.
 * 2. The human ("You") tab is selected by default when the dialog opens.
 * 3. Selecting another player's tab switches the **whole** statement body to
 *    that player's figures, and the Left/Right arrow keys cycle the tabs.
 * 4. Single-player shows a single non-interactive "You" tab.
 * 5. Overlay conventions: backdrop 199 / box 200 / elements 201, every element
 *    parented into `hudContainer` and pushed into `s.overlayObjects`,
 *    dismissal via `[ Next Turn ]`, instant appearance (reduced-motion safe).
 * 6. `[ Next Turn ]` / `[ Bank Loan ]` remain functional, and the selected tab
 *    survives the in-place re-render after a loan take.
 *
 * The projection itself (sections, totals, reconciliation, tab model) is
 * unit-tested Phaser-free in `turn-summary-pl-model.test.ts`; this suite covers
 * the overlay rendering path only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { dismissBootModals } from './helpers/bootModals';
import type { EventCard } from '../../src/MainStreetCards';
import type { CompetitiveRoundLedger, TurnLedger } from '../../src/MainStreetEngineTypes';
import { createCompetitiveState, setupMainStreetGame } from '../../src/MainStreetState';
import type { MainStreetState } from '../../src/MainStreetState';
import { formatLoanObligation } from '../../src/MainStreetLoans';
import {
  LOAN_SELECTOR_CANCEL_LABEL,
  LOAN_SELECTOR_TITLE,
  LOANS_DISABLED_HINT,
  buildLoanSelectorModel,
  buildTurnSummaryLoanDescriptor,
} from '../../src/scenes/MainStreetLoanSelectorModel';
import {
  buildCompetitiveTurnSummary,
  buildTurnSummary,
} from '../../src/scenes/MainStreetTurnSummary';

/** Muted text colour the unavailable `[ Bank Loan ]` button renders in. */
const MUTED_BUTTON_COLOUR = '#6b6459';

// ── Boot helpers (mirrors turn-summary-dialog.browser.test.ts) ──

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();

  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: Phaser.CANVAS });
  await waitForScene(game, 'MainStreetScene');

  // The boot flow presents the blocking "New Game" selector, whose interactive
  // backdrop hit-tests above the panel's tab strip, so a synthetic press would
  // land on the backdrop instead of a tab. Poll for it (the modal decision runs
  // after the asynchronous campaign/checkpoint load) and dismiss it before any
  // pointer interaction.
  await dismissBootModals(game.scene.getScene('MainStreetScene'));
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

const GAME_W = 1280;
const GAME_H = 720;

/**
 * Dispatch a native DOM MouseEvent at canvas (game-world) coordinates.
 *
 * The tab strip is only genuinely usable if Phaser's own hit-testing resolves
 * the tab under the pointer — `emit('pointerdown')` bypasses the input manager
 * entirely and would hide a tab that cannot be clicked (MS-0MW4XULA90002OEY).
 */
function dispatchMouse(type: string, worldX: number, worldY: number): void {
  const canvas = document.querySelector('#game-container canvas') as HTMLCanvasElement;
  expect(canvas).toBeTruthy();
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.x + (worldX / GAME_W) * rect.width;
  const clientY = rect.y + (worldY / GAME_H) * rect.height;
  canvas.dispatchEvent(
    new MouseEvent(type, {
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
    }),
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(
  predicate: () => boolean,
  label: string,
  timeoutMs = 5_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await wait(25);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** The world-space centre of an overlay text (buttons are centre-origin). */
function centreOf(obj: Phaser.GameObjects.Text): { x: number; y: number } {
  const matrix = obj.getWorldTransformMatrix();
  return { x: matrix.tx, y: matrix.ty };
}

/**
 * Simulate a plain click (mousedown + mouseup, no movement) through the real
 * Phaser pointer pipeline at an overlay text's centre.
 *
 * Phaser resolves the top-most pointer target from each camera's render list,
 * which only contains the objects drawn in the previous frame. A panel that was
 * drawn in the current frame is therefore not clickable until it has rendered
 * once, so the caller waits for the target to enter the render list first.
 */
async function clickOverlayText(s: SceneWithHud, obj: Phaser.GameObjects.Text): Promise<void> {
  await waitForCondition(
    () => (s.cameras.main.renderList as Phaser.GameObjects.GameObject[]).includes(obj),
    `the panel to render before clicking \u201c${obj.text}\u201d`,
  );
  const { x, y } = centreOf(obj);
  dispatchMouse('mousedown', x, y);
  await wait(30);
  dispatchMouse('mouseup', x, y);
}

/**
 * Waits until `label`'s tab is the bold (selected) one. On timeout it reports
 * the pointer pipeline's state, so a press that never lands is diagnosable
 * from the failure message alone (no re-run with extra logging).
 */
async function waitForSelectedTab(s: SceneWithHud, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (overlayText(s, label)?.style.fontStyle === 'bold') return;
    await wait(25);
  }
  const tab = overlayText(s, label);
  const renderList = s.cameras.main.renderList as Phaser.GameObjects.GameObject[];
  throw new Error(
    `Timed out waiting for the "${label}" tab to become the selected (bold) tab: `
    + JSON.stringify({
      topMostUnderPointer: (s.input._temp as any[]).map((o) => o.text ?? o.type),
      tabInRenderList: tab ? renderList.includes(tab) : null,
      tabRenderIndex: tab ? renderList.indexOf(tab) : null,
      tabLocalPointer: tab ? [tab.input?.localX, tab.input?.localY] : null,
      pointer: [s.input.activePointer.x, s.input.activePointer.y],
      renderedButtons: overlayTexts(s).filter((t) => t.text.startsWith('[')).map((t) => t.text),
    }),
  );
}

type SceneWithHud = Phaser.Scene & Record<string, any>;

function hudTexts(s: SceneWithHud): Phaser.GameObjects.Text[] {
  const list = s.hudContainer?.list;
  if (!list) return [];
  return list.filter(
    (c: Phaser.GameObjects.GameObject) => c instanceof Phaser.GameObjects.Text,
  ) as Phaser.GameObjects.Text[];
}

/**
 * Finds a text element created by the overlay itself (present in
 * `s.overlayObjects`), so an assertion can never be satisfied by an unrelated
 * HUD label that happens to share the same string.
 */
function overlayText(s: SceneWithHud, label: string): Phaser.GameObjects.Text | undefined {
  const objects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
  return objects.find(
    (o) => o instanceof Phaser.GameObjects.Text && (o as Phaser.GameObjects.Text).text === label,
  ) as Phaser.GameObjects.Text | undefined;
}

/** Every text element the overlay itself created, in draw order. */
function overlayTexts(s: SceneWithHud): Phaser.GameObjects.Text[] {
  const objects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
  return objects.filter(
    (o) => o instanceof Phaser.GameObjects.Text,
  ) as Phaser.GameObjects.Text[];
}

// ── Fixtures ─────────────────────────────────────────────────

/**
 * A single-player state whose wallet equals the statement's closing balances
 * (day-start 1000 / 10 / 20 + net −10 / +2 / +14).
 */
function singlePlayerState(): MainStreetState {
  const state = setupMainStreetGame({ seed: 'turn-summary-pl-overlay', difficulty: 'Easy' });
  state.turn = 7;
  state.players = [];
  state.weekStartCoins = 1000;
  state.weekStartRep = 10;
  state.weekStartScore = 20;
  state.resourceBank.coins = 990;
  state.resourceBank.reputation = 12;
  state.finalScore = 34;
  return state;
}

/**
 * A hand-built, internally consistent single-player ledger. Income (+140) +
 * expenses (−80) + incident (−40) + one-off (−30) balances the net (−10).
 */
function makeLedger(): TurnLedger {
  return {
    incomeByPhase: { base: 120, synergy: 30, reputation: 10, events: -20 },
    ongoingCosts: { staff: -50, community: -20, business: -10 },
    incidentCoinChange: -40,
    incidentRepChange: -2,
    oneOffDeltas: { coins: -30, reputation: 4 },
    netCoinChange: -10,
    netRepChange: 2,
    netScoreChange: 14,
    businessesOwned: { '0': 3 },
  };
}

/** Builds the single-player summary through the real model. */
function makeSinglePlayerSummary(state: MainStreetState) {
  const summary = buildTurnSummary(state, {
    turnLedger: makeLedger(),
    incident: { name: 'Test Incident' } as EventCard,
  });
  expect(summary).not.toBeNull();
  return summary!;
}

/** A two-seat competitive state with seat colours assigned. */
function twoSeatState(loansEnabled = false): MainStreetState {
  return createCompetitiveState({
    seed: 'turn-summary-pl-overlay-cmp',
    playerCount: 2,
    difficulty: 'Easy',
    loansEnabled,
  });
}

/**
 * A hand-built competitive round ledger whose seats reconcile exactly
 * (income + expenses + incident + one-off === net, per seat).
 */
function makeCompetitiveLedger(): CompetitiveRoundLedger {
  return {
    turn: 7,
    seats: [
      {
        ownerId: 0,
        businessesOwned: 3,
        incomeByPhase: { base: 12, synergy: 4, reputation: 2, events: -1 },
        incomeTotal: 17,
        ongoingCosts: { staff: -3, community: -1, business: -2 },
        dayStart: { coins: 40, reputation: 2, score: 10 },
        closing: { coins: 49, reputation: 3, score: 13 },
        netCoinChange: 9,
        netRepChange: 1,
        netScoreChange: 3,
        incidentCoinChange: -2,
        incidentRepChange: -1,
        oneOffDeltas: { coins: 0, reputation: 1 },
      },
      {
        ownerId: 1,
        businessesOwned: 2,
        incomeByPhase: { base: 8, synergy: 0, reputation: 1, events: 0 },
        incomeTotal: 9,
        // A seat that spent nothing still shows all three expense rows at 0.
        ongoingCosts: { staff: 0, community: 0, business: 0 },
        dayStart: { coins: 18, reputation: 0, score: 0 },
        closing: { coins: 23, reputation: 0, score: 5 },
        netCoinChange: 5,
        netRepChange: 0,
        netScoreChange: 5,
        incidentCoinChange: 0,
        incidentRepChange: 0,
        oneOffDeltas: { coins: -4, reputation: 0 },
      },
    ],
  };
}

/** Builds the competitive summary through the real Phaser-free builder. */
function makeCompetitiveSummary(state: MainStreetState) {
  const summary = buildCompetitiveTurnSummary(state, {
    playerRoundLedger: makeCompetitiveLedger(),
    incident: null,
  });
  expect(summary).not.toBeNull();
  return summary!;
}

/**
 * A hand-built three-seat competitive ledger: seat 0 is the human, seats 1 and
 * 2 are AI. Each seat reconciles (income + expenses + incident + one-off ===
 * net) and each has a distinct net, so the statement body identifies the seat.
 */
function makeThreeSeatLedger(): CompetitiveRoundLedger {
  const seat = (ownerId: number, base: number, net: number) => ({
    ownerId,
    businessesOwned: ownerId + 1,
    incomeByPhase: { base, synergy: 0, reputation: 0, events: 0 },
    incomeTotal: base,
    ongoingCosts: { staff: 0, community: 0, business: 0 },
    dayStart: { coins: 10, reputation: 0, score: 0 },
    closing: { coins: 10 + net, reputation: 0, score: 0 },
    netCoinChange: net,
    netRepChange: 0,
    netScoreChange: 0,
    incidentCoinChange: 0,
    incidentRepChange: 0,
    oneOffDeltas: { coins: 0, reputation: 0 },
  });
  return {
    turn: 7,
    seats: [seat(0, 10, 10), seat(1, 20, 20), seat(2, 30, 30)],
  };
}

/** Builds the three-seat competitive state + summary through the real builders. */
function threeSeatSummary() {
  const state = createCompetitiveState({
    seed: 'turn-summary-pl-overlay-three',
    playerCount: 3,
    difficulty: 'Easy',
  });
  const summary = buildCompetitiveTurnSummary(state, {
    playerRoundLedger: makeThreeSeatLedger(),
    incident: null,
  });
  expect(summary).not.toBeNull();
  return summary!;
}

/** Every P&L / context line of the human seat's competitive statement. */
const HUMAN_STATEMENT = [
  'Base income: +12',
  'Synergy income: +4',
  'Reputation income: +2',
  'Event income: -1',
  'Total income: +17',
  'Staff wages: -3',
  'Community spaces: -1',
  'Business costs: -2',
  'Total operating expenses: -6',
  'Incident: Coins -2, Rep -1',
  'One-off: Coins 0, Rep +1',
  'Net profit/loss: +9',
  'Reputation change: +1 · Score change: +3',
  'Closing coins: 49 · Closing Rep 3 · Score 13',
  'Businesses owned: 3',
];

/** Every P&L / context line of the AI 1 seat's competitive statement. */
const AI_STATEMENT = [
  'Base income: +8',
  'Synergy income: 0',
  'Reputation income: +1',
  'Event income: 0',
  'Total income: +9',
  'Staff wages: 0',
  'Community spaces: 0',
  'Business costs: 0',
  'Total operating expenses: 0',
  'Incident: Coins 0, Rep 0',
  'One-off: Coins -4, Rep 0',
  'Net profit/loss: +5',
  'Reputation change: 0 · Score change: +5',
  'Closing coins: 23 · Closing Rep 0 · Score 5',
  'Businesses owned: 2',
];

/** Asserts every line of `lines` is rendered by the overlay (and reports gaps). */
function expectStatement(s: SceneWithHud, lines: readonly string[]): void {
  const missing = lines.filter((line) => overlayText(s, line) === undefined);
  expect(missing).toEqual([]);
}

describe('Main Street tabbed P&L Turn Summary overlay (browser)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('renders the selected player’s P&L statement with the overlay conventions, instantly', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const state = singlePlayerState();
    const summary = makeSinglePlayerSummary(state);

    s.showTurnSummaryDialog(summary, () => {}, buildTurnSummaryLoanDescriptor(s.state));

    // Instant appearance (no fade-in choreography to await).
    const title = overlayText(s, 'Turn Summary');
    expect(title).toBeDefined();
    expect(title!.depth).toBe(201);
    expect(overlayText(s, 'Day 7')).toBeDefined();

    // ── The statement's sections, lines and totals ──────────────
    expect(overlayText(s, 'Income')).toBeDefined();
    expect(overlayText(s, 'Less: Operating expenses')).toBeDefined();
    expectStatement(s, [
      'Base income: +120',
      'Synergy income: +30',
      'Reputation income: +10',
      'Event income: -20',
      'Total income: +140',
      'Staff wages: -50',
      'Community spaces: -20',
      'Business costs: -10',
      'Total operating expenses: -80',
      'Incident: Coins -40, Rep -2',
      'One-off: Coins -30, Rep +4',
    ]);

    // ── Emphasised Net profit/loss bottom line ──────────────────
    const net = overlayText(s, 'Net profit/loss: -10');
    expect(net).toBeDefined();
    expect(net!.depth).toBe(201);
    expect(net!.style.fontStyle).toBe('bold');
    expect(net!.style.fontSize).toBe('18px');
    // A loss reads red; the line reconciles with the ledger's net change.
    expect(net!.style.color).toBe('#ff8888');

    // ── Supplementary context (non-monetary figures) ────────────
    expectStatement(s, [
      'Reputation change: +2 · Score change: +14',
      'Closing coins: 990 · Closing Rep 12 · Score 34',
      'Businesses owned: 3',
      'Incident drawn: Test Incident',
    ]);

    // ── Overlay conventions: 199/200/201 + HUD parenting ────────
    const overlayObjects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
    const depths = overlayObjects.map((o) => (o as any).depth);
    expect(depths).toContain(199);
    expect(depths).toContain(200);
    const texts = overlayTexts(s);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text.depth).toBe(201);
      expect(hudTexts(s)).toContain(text);
    }

    // ── Both actions are interactive ────────────────────────────
    expect(overlayText(s, '[ Next Turn ]')!.input?.enabled).toBe(true);
    expect(overlayText(s, '[ Bank Loan ]')!.input?.enabled).toBe(true);

    // Dismissal releases every tracked object.
    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect(overlayText(s, 'Turn Summary')).toBeUndefined();
    expect((s.overlayObjects ?? []).length).toBe(0);
  }, 30_000);

  it('opens on the human tab in competitive play and switches the whole statement on tab selection', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const state = twoSeatState();
    const summary = makeCompetitiveSummary(state);
    const [humanColour, aiColour] = (state.players ?? []).map((player) => player.colour ?? '');

    s.showCompetitiveTurnSummaryDialog(summary, () => {});

    // ── Human tab selected by default; a button per seat ────────
    const humanTab = overlayText(s, '[ You ]');
    const aiTab = overlayText(s, '[ AI 1 ]');
    expect(humanTab).toBeDefined();
    expect(aiTab).toBeDefined();
    // Every tab is drawn in the button form `[ Label ]` in **both** states, so
    // the way back to the player's own statement is always a visible button
    // (the gap the producer rejected MS-0MW4XULA90002OEY for). Selection is
    // signalled by weight, not by being the only bracketed label.
    expect(overlayText(s, 'You')).toBeUndefined();
    expect(overlayText(s, 'AI 1')).toBeUndefined();
    expect(humanTab!.style.fontStyle).toBe('bold');
    expect(aiTab!.style.fontStyle).not.toBe('bold');
    // Both seat tabs are real pointer targets.
    expect(humanTab!.input?.enabled).toBe(true);
    expect(aiTab!.input?.enabled).toBe(true);
    // Reused seat colours, not an ad-hoc palette.
    expect(humanTab!.style.color).toBe(humanColour);
    expect(aiTab!.style.color).toBe(aiColour);
    expect(humanColour).not.toBe(aiColour);
    // The selected (bold) label's whole width is inside its own hit area.
    const selectedHitArea = humanTab!.input?.hitArea as { width: number };
    expect(selectedHitArea.width).toBeGreaterThanOrEqual(humanTab!.width);

    // The default statement is the human seat's own figures.
    expectStatement(s, HUMAN_STATEMENT);
    expect(overlayText(s, 'Net profit/loss: +9')).toBeDefined();
    // …and the AI seat's figures are nowhere on screen yet.
    for (const line of AI_STATEMENT) {
      expect(overlayText(s, line)).toBeUndefined();
    }

    // ── Selecting the AI tab (real pointer) switches the whole body ──
    await clickOverlayText(s, aiTab!);
    await waitForSelectedTab(s, '[ AI 1 ]');
    expectStatement(s, AI_STATEMENT);
    expect(overlayText(s, 'Net profit/loss: +5')).toBeDefined();
    // The human seat's figures are gone — the body really switched.
    for (const line of HUMAN_STATEMENT) {
      expect(overlayText(s, line)).toBeUndefined();
    }

    // ── Switching back restores the human statement ─────────────
    // The regression the producer found (MS-0MW4XULA90002OEY): after
    // selecting the AI tab there must still be a **button** for the player's
    // own statement — a bracketed, enabled, non-selected control.
    const youTab = overlayText(s, '[ You ]');
    expect(youTab).toBeDefined();
    expect(youTab!.style.fontStyle).not.toBe('bold');
    expect(youTab!.input?.enabled).toBe(true);
    await clickOverlayText(s, youTab!);
    await waitForSelectedTab(s, '[ You ]');
    expectStatement(s, HUMAN_STATEMENT);

    // ── Hovering a tab is visible feedback (a real pointer affordance) ──
    const unselected = overlayText(s, '[ AI 1 ]')!;
    expect(unselected.style.color).toBe(aiColour);
    unselected.emit('pointerover');
    expect(unselected.style.color).not.toBe(aiColour);
    unselected.emit('pointerout');
    expect(unselected.style.color).toBe(aiColour);

    // Exactly one action pair survives every re-render.
    expect(overlayTexts(s).filter((t) => t.text === '[ Next Turn ]')).toHaveLength(1);
    expect(overlayTexts(s).filter((t) => t.text === '[ Bank Loan ]')).toHaveLength(1);
    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect((s.overlayObjects ?? []).length).toBe(0);
  }, 30_000);

  it('switches from any AI seat back to the player\u2019s own statement (real pointer)', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const summary = threeSeatSummary();

    s.showCompetitiveTurnSummaryDialog(summary, () => {});

    // One button per seat, in seat order, human first and selected.
    const youTab = overlayText(s, '[ You ]');
    const ai1Tab = overlayText(s, '[ AI 1 ]');
    const ai2Tab = overlayText(s, '[ AI 2 ]');
    expect(youTab).toBeDefined();
    expect(ai1Tab).toBeDefined();
    expect(ai2Tab).toBeDefined();
    expect(youTab!.style.fontStyle).toBe('bold');

    // Adjacent tab targets never overlap: each neighbour's centre is clear of
    // the other's box, so a press can never land on the wrong management
    // company's statement.
    const youCentre = centreOf(youTab!);
    const ai1Centre = centreOf(ai1Tab!);
    const ai2Centre = centreOf(ai2Tab!);
    expect(ai1Centre.x - youCentre.x).toBeGreaterThan(youTab!.width / 2);
    expect(ai2Centre.x - ai1Centre.x).toBeGreaterThan(ai1Tab!.width / 2);

    // Walk out to the last AI seat by pointer, then back to the player's own.
    await clickOverlayText(s, ai1Tab!);
    await waitForSelectedTab(s, '[ AI 1 ]');
    expect(overlayText(s, 'Net profit/loss: +20')).toBeDefined();

    await clickOverlayText(s, overlayText(s, '[ AI 2 ]')!);
    await waitForSelectedTab(s, '[ AI 2 ]');
    expect(overlayText(s, 'Net profit/loss: +30')).toBeDefined();

    // The human tab is still a visible, enabled button — press it to return.
    const backToYou = overlayText(s, '[ You ]');
    expect(backToYou).toBeDefined();
    expect(backToYou!.input?.enabled).toBe(true);
    await clickOverlayText(s, backToYou!);
    await waitForSelectedTab(s, '[ You ]');
    expect(overlayText(s, 'Net profit/loss: +10')).toBeDefined();

    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect((s.overlayObjects ?? []).length).toBe(0);
  }, 30_000);

  it('cycles the players’ tabs with the Left/Right arrow keys', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const summary = makeCompetitiveSummary(twoSeatState());

    s.showCompetitiveTurnSummaryDialog(summary, () => {});
    expect(overlayText(s, '[ You ]')).toBeDefined();

    const press = (key: string): void => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    };

    // Right → the AI seat's statement.
    press('ArrowRight');
    expect(overlayText(s, '[ AI 1 ]')).toBeDefined();
    expectStatement(s, AI_STATEMENT);

    // Left → back to the human seat.
    press('ArrowLeft');
    expect(overlayText(s, '[ You ]')).toBeDefined();
    expectStatement(s, HUMAN_STATEMENT);

    // Left wraps around to the last tab.
    press('ArrowLeft');
    expect(overlayText(s, '[ AI 1 ]')).toBeDefined();

    // The keyboard handler is released with the panel: after dismissal the
    // arrows no longer redraw anything.
    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect((s.overlayObjects ?? []).length).toBe(0);
    press('ArrowRight');
    expect((s.overlayObjects ?? []).length).toBe(0);
  }, 30_000);

  it('shows a single non-interactive “You” tab in single-player', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const summary = makeSinglePlayerSummary(singlePlayerState());

    s.showTurnSummaryDialog(summary, () => {}, buildTurnSummaryLoanDescriptor(s.state));

    // Exactly one tab, rendered as the selected `[ You ]` tab.
    const tabs = overlayTexts(s).filter((t) => t.text === '[ You ]' || t.text === 'You');
    expect(tabs).toHaveLength(1);
    expect(tabs[0].text).toBe('[ You ]');
    // …and it is presentational only: no pointer input, nothing to switch to.
    expect(tabs[0].input?.enabled).toBeFalsy();

    // Arrow keys are inert in single-player (no second tab exists).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(overlayText(s, '[ You ]')).toBeDefined();
    expect(overlayTexts(s).filter((t) => t.text === '[ You ]')).toHaveLength(1);
    expectStatement(s, ['Total income: +140', 'Net profit/loss: -10']);

    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
  }, 30_000);

  it('keeps [ Next Turn ] and [ Bank Loan ] functional', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const summary = makeSinglePlayerSummary(singlePlayerState());

    // ── Enabled Bank Loan fires its seam exactly once per press ──
    const onNextTurn = vi.fn();
    const onBankLoanAction = vi.fn();
    s.showTurnSummaryDialog(
      summary,
      onNextTurn,
      buildTurnSummaryLoanDescriptor(s.state),
      onBankLoanAction,
    );
    const bankLoanBtn = overlayText(s, '[ Bank Loan ]')!;
    expect(bankLoanBtn.input?.enabled).toBe(true);
    expect(bankLoanBtn.style.color).not.toBe(MUTED_BUTTON_COLOUR);
    bankLoanBtn.emit('pointerdown');
    expect(onBankLoanAction).toHaveBeenCalledTimes(1);
    // The press swaps the panel for the mid-game loan selector, and the seam
    // never resumes the closing by itself.
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeDefined();
    expect(overlayText(s, '[ Next Turn ]')).toBeUndefined();
    expect(onNextTurn).not.toHaveBeenCalled();
    // Cancel re-presents the statement with no state change.
    overlayText(s, LOAN_SELECTOR_CANCEL_LABEL)!.emit('pointerdown');
    expect(overlayText(s, '[ Next Turn ]')).toBeDefined();
    expectStatement(s, ['Total income: +140', 'Net profit/loss: -10']);

    // ── A disabled Bank Loan is muted, inert and explained ───────
    (s.state.config as unknown as { loansEnabled: boolean }).loansEnabled = false;
    s.showTurnSummaryDialog(summary, onNextTurn, buildTurnSummaryLoanDescriptor(s.state));
    const disabledBtn = overlayText(s, '[ Bank Loan ]')!;
    expect(disabledBtn.input?.enabled).toBeFalsy();
    expect(disabledBtn.style.color).toBe(MUTED_BUTTON_COLOUR);
    expect(overlayText(s, LOANS_DISABLED_HINT)).toBeDefined();
    disabledBtn.emit('pointerdown');
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeUndefined();

    // ── [ Next Turn ] dismisses and resumes the closing exactly once ──
    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect(onNextTurn).toHaveBeenCalledTimes(1);
    expect((s.overlayObjects ?? []).length).toBe(0);
  }, 30_000);

  it('preserves the selected tab across the in-place re-render after a loan take', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const liveState = twoSeatState(true);
    const summary = makeCompetitiveSummary(liveState);
    expect(summary.loanDescriptor.enabled).toBe(true);

    // The selector/take and the post-take re-render all read the scene's LIVE
    // state, so drive it with the same competitive state the summary was built
    // from, parked in the deferred-closing pause.
    s.state = liveState;
    s.state.phase = 'IncidentPhase';
    const result = { playerRoundLedger: makeCompetitiveLedger() } as any;

    const onBankLoanAction = vi.fn();
    let nextTurnCalls = 0;
    s.showCompetitiveTurnSummaryDialog(
      summary,
      () => { nextTurnCalls += 1; },
      onBankLoanAction,
      result,
    );

    // Select the AI seat's tab first: that selection must survive the take.
    overlayText(s, '[ AI 1 ]')!.emit('pointerdown');
    expect(overlayText(s, '[ AI 1 ]')!.style.fontStyle).toBe('bold');
    expectStatement(s, AI_STATEMENT);

    overlayText(s, '[ Bank Loan ]')!.emit('pointerdown');
    // The seam is keyed to the human seat, exactly once per press.
    expect(onBankLoanAction).toHaveBeenCalledTimes(1);
    expect(onBankLoanAction).toHaveBeenCalledWith(0);
    expect(overlayText(s, LOAN_SELECTOR_TITLE)).toBeDefined();

    // Confirm the first configured option: the take books to the human seat,
    // spends no action point and does not advance the day.
    const model = buildLoanSelectorModel(s.state);
    expect(model.rows.length).toBeGreaterThan(0);
    const actionsBefore = s.state.actionsRemaining;
    const turnBefore = s.state.turn;
    overlayText(s, model.rows[0].label)!.emit('pointerdown');

    expect(s.state.loans?.[0]?.ownerId).toBe(0);
    expect(s.state.actionsRemaining).toBe(actionsBefore);
    expect(s.state.turn).toBe(turnBefore);
    expect(nextTurnCalls).toBe(0);

    // The panel re-rendered in place, still on the AI seat's tab, with the
    // freshly booked obligation disabling [ Bank Loan ] and explaining why.
    expect(overlayText(s, 'Turn Summary')).toBeDefined();
    expect(overlayText(s, '[ AI 1 ]')!.style.fontStyle).toBe('bold');
    // The player's own statement is still a visible, enabled button.
    expect(overlayText(s, '[ You ]')!.input?.enabled).toBe(true);
    expectStatement(s, AI_STATEMENT);
    expect(overlayText(s, '[ Bank Loan ]')!.input?.enabled).toBeFalsy();
    expect(
      overlayText(s, formatLoanObligation(s.state.loans![0])),
    ).toBeDefined();

    // [ Next Turn ] still resumes the shared day, exactly once.
    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect(nextTurnCalls).toBe(1);
    expect((s.overlayObjects ?? []).length).toBe(0);
  }, 30_000);

  it('attaches hover/tap tooltips to every ledger row and dismisses them cleanly (MS-0MW6GZKZZ006PLLO)', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;

    // A state with one business + one staff card, so the expense breakdowns
    // derive per-item costs, and an income result with a per-business breakdown.
    const state = singlePlayerState();
    state.streetGrid[0] = {
      family: 'business', id: 'biz-bakery', name: 'Bakery', ongoingCost: 10,
    } as any;
    state.staffCards = [
      { family: 'staff', id: 'stf-clerk', name: 'Clerk', ongoingCost: 50 } as any,
    ];
    const income = {
      total: 140,
      breakdown: [{ slotIndex: 0, businessName: 'Bakery', baseIncome: 120, synergyBonus: 30, total: 150 }],
      handSynergyTotal: 0,
      phaseBreakdown: {
        perSlotBreakdown: [{
          slotIndex: 0, businessName: 'Bakery', baseIncome: 120, synergyBonus: 30,
          repBonus: 10, eventDeltas: [], upcomingDeltas: [],
        }],
        handSynergyTotal: 0,
      },
    };
    const summary = buildTurnSummary(state, {
      turnLedger: makeLedger(),
      incident: { name: 'Test Incident' } as EventCard,
      income,
    })!;
    expect(summary).not.toBeNull();

    const show = vi.spyOn(s.tooltipManager!, 'show');
    const hide = vi.spyOn(s.tooltipManager!, 'hide');
    let nextTurnCalls = 0;

    s.showTurnSummaryDialog(summary, () => { nextTurnCalls += 1; }, buildTurnSummaryLoanDescriptor(s.state));

    const lastShown = (): string => {
      const calls = show.mock.calls;
      return String(calls[calls.length - 1]?.[0] ?? '');
    };

    // Every monetary line and context row carries a tooltip listener.
    const rows = [
      'Base income: +120',
      'Synergy income: +30',
      'Reputation income: +10',
      'Event income: -20',
      'Total income: +140',
      'Staff wages: -50',
      'Community spaces: -20',
      'Business costs: -10',
      'Total operating expenses: -80',
      'Incident: Coins -40, Rep -2',
      'One-off: Coins -30, Rep +4',
      'Net profit/loss: -10',
      'Reputation change: +2 · Score change: +14',
      'Closing coins: 990 · Closing Rep 12 · Score 34',
      'Businesses owned: 3',
      'Incident drawn: Test Incident',
    ];
    for (const label of rows) {
      const row = overlayText(s, label);
      expect(row, `missing row \u201c${label}\u201d`).toBeDefined();
      expect(row!.listenerCount('pointerover'), `no tooltip on \u201c${label}\u201d`).toBeGreaterThan(0);
      expect(row!.listenerCount('pointerout'), `no dismiss on \u201c${label}\u201d`).toBeGreaterThan(0);
    }

    // Hovering an income row surfaces the per-business breakdown lazily.
    const baseRow = overlayText(s, 'Base income: +120')!;
    baseRow.emit('pointerover');
    expect(show).toHaveBeenCalled();
    expect(lastShown()).toContain('Bakery: +120');
    baseRow.emit('pointerout');
    expect(hide).toHaveBeenCalled();

    // Hovering a cost row surfaces the per-card breakdown.
    const staffRow = overlayText(s, 'Staff wages: -50')!;
    staffRow.emit('pointerover');
    expect(lastShown()).toContain('Clerk: -50');

    // The net and one-off rows explain their reconciliation formulas.
    overlayText(s, 'Net profit/loss: -10')!.emit('pointerover');
    expect(lastShown()).toContain('Net =');
    overlayText(s, 'One-off: Coins -30, Rep +4')!.emit('pointerover');
    expect(lastShown()).toContain('One-off =');

    // [ Next Turn ] still works — the tooltip zones never block the buttons.
    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect(nextTurnCalls).toBe(1);
    expect((s.overlayObjects ?? []).length).toBe(0);
  }, 30_000);
});
