/**
 * Main Street: Manage Card dialog browser tests (CG-0MTFWJUN5001F53Z)
 *
 * Verifies the street-card Manage dialog end to end in a real Phaser scene:
 *
 * 1. Clicking a non-sold street card during MarketPhase opens the dialog with
 *    [Sell] [Close] [Cancel], built through the shared overlay helpers
 *    (backdrop 199 / box 200 / interactive 201) and parented into the HUD
 *    container.
 * 2. [Close] commits the close: the card is removed from the grid into the
 *    discard pile, exactly one daily action is consumed, no coins change, the
 *    activity log gains an entry, `MainStreetAnimator.animateClose` fires, and
 *    the discard SFX plays.
 * 3. [Cancel] dismisses the dialog with no state change.
 * 4. Sold cards never open the dialog, and `animateClose` degrades safely in
 *    reduced-motion and replay/headless modes (resolves, no state mutation).
 *
 * The overlay presentation is non-blocking; the game state is committed
 * synchronously by `closeBusinessCommand` when [Close] is pressed.
 *
 * @module tests/main-street/manage-card-dialog.browser
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { createStaffDeck, getBusinessTemplates, type BusinessCard, type StaffCard } from '../../src/MainStreetCards';
import { computeStaffSalaryCost, getSalaryScopeSkills } from '../../src/MainStreetStaffBuffs';
import { layOffReputationCost } from '../../src/MainStreetRoster';

// ── Boot helpers (mirrors sell-demolition.browser.test.ts) ──

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();

  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);

  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: Phaser.CANVAS });
  await waitForScene(game, 'MainStreetScene');
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) {
    game.destroy(true, false);
  }
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

async function waitForCondition(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 25;
  const label = options.label ?? 'condition';
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

function makeBusiness(level = 0): BusinessCard {
  const tpl = getBusinessTemplates()[0];
  return {
    ...tpl,
    id: `manage-dialog-${tpl.id}`,
    family: 'business',
    level,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    appliedUpgrades: [],
  };
}

/** A job-applicant member employed at the given slot. */
function staffMember(id: string, name: string, slot = 0): StaffCard {
  return {
    ...createStaffDeck(1)[0]!,
    id,
    name,
    employedAtSlot: slot,
  };
}

/** The subset of MainStreetScene state/fields this suite touches. */
interface ManageScene extends Phaser.Scene {
  state: {
    streetGrid: Array<BusinessCard | null>;
    resourceBank: { coins: number; reputation: number };
    soldSlots: boolean[];
    discardPile: Array<{ id: string }>;
    activityLog: Array<{ text: string }>;
    actionsRemaining: number;
    phase: string;
    staffCards: StaffCard[];
  };
  overlayObjects: Phaser.GameObjects.GameObject[];
  hudContainer?: Phaser.GameObjects.Container;
  uiPhase: string;
  beginStaffMove?: (staffId: string) => void;
  refreshAll: () => void;
  undoManager?: {
    execute: (cmd: unknown) => void;
    undo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
  };
  msAnimator: {
    animateClose: (params: { slotIndex: number; cardId: string; family: string }) => Promise<void>;
  };
  msTurnController: { onSellCard: (slotIndex: number) => void };
  settingsPanel?: { _reducedMotion?: boolean };
}

/** All overlay text objects (buttons are Text objects with a `text` value). */
function overlayTexts(scene: ManageScene): Phaser.GameObjects.Text[] {
  return (scene.overlayObjects ?? []).filter(
    (o) => typeof (o as unknown as { text?: unknown }).text === 'string',
  ) as Phaser.GameObjects.Text[];
}

function findOverlayButton(scene: ManageScene, label: string): Phaser.GameObjects.Text {
  const btn = overlayTexts(scene).find((o) => o.text === label);
  if (!btn) {
    throw new Error(
      `Overlay button ${label} not found. Present: ${overlayTexts(scene).map((o) => o.text).join(', ')}`,
    );
  }
  return btn;
}

/**
 * Finds an overlay button at an exact depth — e.g. the confirm layer's
 * `[ Cancel ]` (204) distinct from the dialog's own `[ Cancel ]` (201).
 */
function findOverlayButtonAtDepth(scene: ManageScene, label: string, depth: number): Phaser.GameObjects.Text {
  const btn = overlayTexts(scene).find((o) => o.text === label && o.depth === depth);
  if (!btn) {
    throw new Error(
      `Overlay button ${label} at depth ${depth} not found. Present: ${overlayTexts(scene).map((o) => `${o.text}@${o.depth}`).join(', ')}`,
    );
  }
  return btn;
}

/** Places a fresh business card on the given slot and re-renders. */
function placeCard(scene: ManageScene, slotIndex: number, options: { level?: number } = {}): BusinessCard {
  const biz = makeBusiness(options.level ?? 0);
  scene.state.streetGrid[slotIndex] = biz;
  scene.state.resourceBank.coins = 50;
  scene.state.actionsRemaining = 1;
  scene.refreshAll();
  return biz;
}

describe('MainStreet Manage Card dialog', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    const moduleUrl = (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE_URL__;
    if (typeof moduleUrl === 'string' && moduleUrl.startsWith('blob:')) {
      URL.revokeObjectURL(moduleUrl);
    }

    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE__;
    delete (globalThis as unknown as Record<string, unknown>).__MAIN_STREET_TF_MODULE_URL__;
    delete (globalThis as unknown as Record<string, unknown>).__TF_PLAY_COUNT__;
    destroyGame(game);
    game = null;
  });

  it('opens [Sell] [Close] [Cancel] for a non-sold street card, HUD-parented at depth 201', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    placeCard(scene, 0);

    scene.msTurnController.onSellCard(0);

    const sellBtn = findOverlayButton(scene, '[ Sell ]');
    const closeBtn = findOverlayButton(scene, '[ Close ]');
    const cancelBtn = findOverlayButton(scene, '[ Cancel ]');

    for (const btn of [sellBtn, closeBtn, cancelBtn]) {
      expect(btn.depth).toBe(201);
      // AC1: every interactive element must be parented into hudContainer.
      expect(scene.hudContainer?.list.includes(btn)).toBe(true);
    }

    // Title reflects the Manage dialog, and the Close cost is explicit.
    expect(overlayTexts(scene).some((o) => o.text === 'Manage Card')).toBe(true);
    expect(
      overlayTexts(scene).some((o) => o.text.includes('costs 1 action')),
    ).toBe(true);

    // Depth convention: backdrop 199, visible box 200.
    const depths = (scene.overlayObjects ?? []).map((o) => (o as unknown as { depth?: number }).depth);
    expect(depths).toContain(199);
    expect(depths).toContain(200);

    // Cleanup: cancel so the dialog does not leak into later assertions.
    cancelBtn.emit('pointerdown');
    expect(scene.overlayObjects).toHaveLength(0);
  }, 30_000);

  it('[Close] removes the card, spends one action, logs, and triggers animateClose + discard SFX', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    const biz = placeCard(scene, 0);

    const coinsBefore = scene.state.resourceBank.coins;
    const discardBefore = scene.state.discardPile.length;
    const logBefore = scene.state.activityLog.length;

    // Spy on the close animation and the SFX (run the real implementation).
    const animator = scene.msAnimator;
    const originalClose = animator.animateClose.bind(animator);
    const closeCalls: Array<{ slotIndex: number; cardId: string; family: string }> = [];
    vi.spyOn(animator, 'animateClose').mockImplementation((params) => {
      closeCalls.push(params);
      return originalClose(params);
    });

    const soundManager = (scene as unknown as { soundManager?: { play: (key: string) => void } }).soundManager;
    const sfxCalls: string[] = [];
    if (soundManager) {
      vi.spyOn(soundManager, 'play').mockImplementation((key: string) => {
        sfxCalls.push(key);
      });
    }

    scene.msTurnController.onSellCard(0);
    findOverlayButton(scene, '[ Close ]').emit('pointerdown');

    // State committed synchronously by the command.
    expect(scene.state.streetGrid[0]).toBeNull();
    expect(scene.state.discardPile).toHaveLength(discardBefore + 1);
    expect(scene.state.discardPile[scene.state.discardPile.length - 1].id).toBe(biz.id);
    expect(scene.state.actionsRemaining).toBe(0);
    expect(scene.state.resourceBank.coins).toBe(coinsBefore);
    expect(scene.state.activityLog).toHaveLength(logBefore + 1);
    expect(scene.state.activityLog[scene.state.activityLog.length - 1].text).toContain(biz.name);
    expect(scene.overlayObjects).toHaveLength(0);

    // Animation fired with the closed slot's identity.
    await waitForCondition(() => closeCalls.length >= 1, { label: 'animateClose trigger' });
    expect(closeCalls[0].slotIndex).toBe(0);
    expect(closeCalls[0].cardId).toBe(biz.id);
    expect(closeCalls[0].family).toBe('business');

    // Discard SFX follows the demolition tween (~380ms) in full-motion mode.
    if (soundManager) {
      await waitForCondition(() => sfxCalls.includes('sfx-discard'), {
        timeoutMs: 5000,
        label: 'discard SFX',
      });
    }
  }, 30_000);

  it('[Cancel] dismisses the dialog with no state change', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    const biz = placeCard(scene, 0);

    const coinsBefore = scene.state.resourceBank.coins;
    const discardBefore = scene.state.discardPile.length;

    scene.msTurnController.onSellCard(0);
    findOverlayButton(scene, '[ Cancel ]').emit('pointerdown');

    expect(scene.overlayObjects).toHaveLength(0);
    expect(scene.state.streetGrid[0]?.id).toBe(biz.id);
    expect(scene.state.actionsRemaining).toBe(1);
    expect(scene.state.resourceBank.coins).toBe(coinsBefore);
    expect(scene.state.discardPile).toHaveLength(discardBefore);
  }, 30_000);

  it('renders no staff section when the managed card employs nobody', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    placeCard(scene, 0);
    scene.state.staffCards = [];
    scene.refreshAll();

    scene.msTurnController.onSellCard(0);

    // Empty-state behaviour (AC2): no rows, no [ Move ], no [ Lay off ], no
    // cost line — the section renders nothing at all.
    const labels = overlayTexts(scene).map((o) => o.text);
    expect(labels).not.toContain('[ Move ]');
    expect(labels).not.toContain('[ Lay off ]');
    expect(labels.some((t) => t.includes('Move: 1 action'))).toBe(false);
    expect(labels.some((t) => t.includes('Employed here'))).toBe(false);
  }, 30_000);

  it('[ Lay off ] → confirm quotes the exact coin/reputation cost, [ Confirm ] lays off (dialog stays open), [ Cancel ] changes nothing', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    placeCard(scene, 0);

    // Employ one job applicant at slot 0, with fewer coins than its salary so
    // the salary deduction clamps at 0 (never negative).
    const member = staffMember('manage-dialog-employed-member', 'Test Applicant', 0);
    scene.state.staffCards = [member];
    scene.state.resourceBank.reputation = 500;
    scene.state.resourceBank.coins = 0;
    scene.refreshAll();

    scene.msTurnController.onSellCard(0);

    // The dialog lists the member as its own row (with its own [ Move ]
    // and [ Lay off ]).
    const labels = overlayTexts(scene).map((o) => o.text);
    expect(labels).toContain('Test Applicant');
    expect(labels.filter((t) => t === '[ Move ]')).toHaveLength(1);
    expect(labels.filter((t) => t === '[ Lay off ]')).toHaveLength(1);
    const logBefore = scene.state.activityLog.length;

    // The employed member is the tier-1 Assistant (salary 100); the lay-off
    // reputation cost is max(100, ceil(100/100)*100) = 100.
    const salary = computeStaffSalaryCost(getSalaryScopeSkills(member), member.ongoingCost);
    const expectedRepCost = layOffReputationCost(salary);
    expect(expectedRepCost).toBe(100);
    const reputationBefore = scene.state.resourceBank.reputation;

    // The row's [ Lay off ] opens the confirm step quoting the member, the
    // coins (one turn's salary, clamped) and the shared reputation cost.
    findOverlayButton(scene, '[ Lay off ]').emit('pointerdown');
    const confirmTexts = overlayTexts(scene).map((o) => o.text);
    expect(confirmTexts).toContain('Lay off Test Applicant?');
    const costLine = confirmTexts.find((t) => t.includes("One turn's salary"));
    expect(costLine).toBeDefined();
    expect(costLine!).toContain('€100');
    expect(costLine!).toContain('−100');

    // [ Cancel ] in the confirm layer changes nothing and returns to the rows.
    const coinsBefore = scene.state.resourceBank.coins;
    findOverlayButtonAtDepth(scene, '[ Cancel ]', 204).emit('pointerdown');
    expect(scene.state.staffCards).toHaveLength(1);
    expect(scene.state.resourceBank.reputation).toBe(reputationBefore);
    expect(scene.state.resourceBank.coins).toBe(coinsBefore);
    expect(scene.state.activityLog).toHaveLength(logBefore);
    expect(overlayTexts(scene).map((o) => o.text)).toContain('Test Applicant');
    expect(overlayTexts(scene).some((o) => o.text === '[ Lay off ]')).toBe(true);

    // [ Confirm ] executes the lay-off through the command (undoable) and
    // keeps the dialog open, re-rendered in place.
    findOverlayButton(scene, '[ Lay off ]').emit('pointerdown');
    findOverlayButton(scene, '[ Confirm ]').emit('pointerdown');

    expect(scene.state.staffCards).toHaveLength(0);
    expect(scene.state.resourceBank.reputation).toBe(reputationBefore - expectedRepCost);
    expect(scene.state.resourceBank.coins).toBe(0);
    expect(scene.state.activityLog).toHaveLength(logBefore + 1);
    expect(scene.state.activityLog[scene.state.activityLog.length - 1].text).toContain('Laid off');
    expect(scene.state.activityLog[scene.state.activityLog.length - 1].text).toContain('coins');
    expect(scene.state.activityLog[scene.state.activityLog.length - 1].text).toContain('−100');
    // AC: the dialog stayed open after the lay-off and re-rendered in place.
    expect(scene.overlayObjects.length).toBeGreaterThan(0);
    expect(overlayTexts(scene).map((o) => o.text)).toContain('[ Sell ]');
    expect(overlayTexts(scene).map((o) => o.text)).toContain('[ Close ]');
    expect(overlayTexts(scene).map((o) => o.text)).toContain('[ Cancel ]');
  }, 30_000);

  it('two rows render two [ Lay off ] controls; the FIRST row\'s [ Lay off ] lays off the FIRST member (regression)', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    placeCard(scene, 0, { level: 1 }); // employment capacity level + 1 = 2

    const first = staffMember('manage-dialog-first', 'First Hire', 0);
    const second = staffMember('manage-dialog-second', 'Second Hire', 0);
    scene.state.staffCards = [first, second];
    scene.state.resourceBank.coins = 1000;
    scene.state.resourceBank.reputation = 500;
    scene.refreshAll();

    scene.msTurnController.onSellCard(0);

    const labels = overlayTexts(scene).map((o) => o.text);
    expect(labels.filter((t) => t === '[ Lay off ]')).toHaveLength(2);
    expect(labels.filter((t) => t === '[ Move ]')).toHaveLength(2);
    expect(labels).toContain('First Hire');
    expect(labels).toContain('Second Hire');

    // Click the FIRST row's [ Lay off ] (topmost control) — it must open the
    // confirm step for the FIRST member, never the newest hire.
    const firstLayOff = overlayTexts(scene)
      .filter((o) => o.text === '[ Lay off ]')
      .sort((a, b) => a.y - b.y)[0]!;
    firstLayOff.emit('pointerdown');
    expect(overlayTexts(scene).map((o) => o.text)).toContain('Lay off First Hire?');

    findOverlayButton(scene, '[ Confirm ]').emit('pointerdown');

    expect(scene.state.staffCards.map((m) => m.id)).toEqual(['manage-dialog-second']);
    // Dialog stays open, re-rendered: first row gone, second row remains.
    expect(overlayTexts(scene).map((o) => o.text)).not.toContain('First Hire');
    expect(overlayTexts(scene).map((o) => o.text)).toContain('Second Hire');
    expect(overlayTexts(scene).filter((o) => o.text === '[ Lay off ]')).toHaveLength(1);
  }, 30_000);

  it('after the last lay-off the staff section disappears in place while [ Sell ]/[ Close ]/[ Cancel ] keep working', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    placeCard(scene, 0, { level: 1 }); // two slots to lay off both members

    const first = staffMember('manage-dialog-last-a', 'Last A', 0);
    const second = staffMember('manage-dialog-last-b', 'Last B', 0);
    scene.state.staffCards = [first, second];
    scene.state.resourceBank.coins = 1000;
    scene.state.resourceBank.reputation = 500;
    scene.refreshAll();

    scene.msTurnController.onSellCard(0);
    // Capture the panel box (depth 200) to assert it shrinks as rows vanish.
    const readBox = () => (scene.overlayObjects.find(
      (o) => (o as unknown as { depth?: number }).depth === 200,
    ) as Phaser.GameObjects.Rectangle | undefined);
    const boxBefore = readBox();
    expect(boxBefore).toBeTruthy();
    const heightBefore = boxBefore!.height;
    const rowH = 34; // staffRowH from the dialog layout

    // Lay off each member through its row's confirm step.
    findOverlayButton(scene, '[ Lay off ]').emit('pointerdown');
    findOverlayButton(scene, '[ Confirm ]').emit('pointerdown');
    expect(scene.state.staffCards).toHaveLength(1);
    // Panel shrank to fit the remaining single row.
    expect(readBox()!.height).toBe(heightBefore - rowH);
    // Dialog still open; one row remains.
    expect(overlayTexts(scene).filter((o) => o.text === '[ Lay off ]')).toHaveLength(1);

    findOverlayButton(scene, '[ Lay off ]').emit('pointerdown');
    findOverlayButton(scene, '[ Confirm ]').emit('pointerdown');
    expect(scene.state.staffCards).toHaveLength(0);
    // Staff section gone: no rows, no [ Move ], no [ Lay off ], no cost line.
    const labels = overlayTexts(scene).map((o) => o.text);
    expect(labels).not.toContain('[ Move ]');
    expect(labels).not.toContain('[ Lay off ]');
    expect(labels.some((t) => t.includes('Move: 1 action'))).toBe(false);
    // The managed card's own controls still work.
    expect(labels).toContain('[ Sell ]');
    expect(labels).toContain('[ Close ]');
    expect(labels).toContain('[ Cancel ]');
    findOverlayButton(scene, '[ Cancel ]').emit('pointerdown');
    expect(scene.overlayObjects).toHaveLength(0);
  }, 30_000);

  it('a confirmed lay-off stays undoable: undo restores member, coins and reputation', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    placeCard(scene, 0);

    const member = staffMember('manage-dialog-undo', 'Undo Me', 0);
    scene.state.staffCards = [member];
    scene.state.resourceBank.coins = 1000; // enough to pay the salary
    scene.state.resourceBank.reputation = 500;
    scene.refreshAll();

    const salary = computeStaffSalaryCost(getSalaryScopeSkills(member), member.ongoingCost);
    const coinsBefore = scene.state.resourceBank.coins;
    const reputationBefore = scene.state.resourceBank.reputation;

    scene.msTurnController.onSellCard(0);
    findOverlayButton(scene, '[ Lay off ]').emit('pointerdown');
    findOverlayButton(scene, '[ Confirm ]').emit('pointerdown');

    expect(scene.state.staffCards).toHaveLength(0);
    expect(scene.state.resourceBank.coins).toBe(coinsBefore - salary);
    expect(scene.state.resourceBank.reputation).toBe(reputationBefore - layOffReputationCost(salary));

    scene.undoManager!.undo();

    expect(scene.state.staffCards.map((m) => m.id)).toEqual(['manage-dialog-undo']);
    expect(scene.state.resourceBank.coins).toBe(coinsBefore);
    expect(scene.state.resourceBank.reputation).toBe(reputationBefore);
  }, 30_000);

  it('a stale row (member already gone) flashes feedback instead of acting on a shifted index', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    placeCard(scene, 0, { level: 1 });

    const first = staffMember('manage-dialog-stale-a', 'Stale A', 0);
    const second = staffMember('manage-dialog-stale-b', 'Stale B', 0);
    scene.state.staffCards = [first, second];
    scene.state.resourceBank.coins = 1000;
    scene.state.resourceBank.reputation = 500;
    scene.refreshAll();

    scene.msTurnController.onSellCard(0);
    const logBefore = scene.state.activityLog.length;

    // Open the confirm step for the FIRST member's row.
    const firstLayOff = overlayTexts(scene)
      .filter((o) => o.text === '[ Lay off ]')
      .sort((a, b) => a.y - b.y)[0]!;
    firstLayOff.emit('pointerdown');
    expect(overlayTexts(scene).map((o) => o.text)).toContain('Lay off Stale A?');

    // The member is laid off elsewhere (e.g. an undo/command changed state)
    // while the confirm step is open: the row is now stale.
    scene.state.staffCards = [second];

    // [ Confirm ] must refuse with feedback (no log entry, no shifted-index
    // lay-off of Stale B) and re-render the section.
    findOverlayButton(scene, '[ Confirm ]').emit('pointerdown');

    expect(scene.state.staffCards.map((m) => m.id)).toEqual(['manage-dialog-stale-b']);
    expect(scene.state.activityLog).toHaveLength(logBefore);
    // Dialog stays open; re-rendered rows reflect the live staffCards.
    expect(overlayTexts(scene).map((o) => o.text)).not.toContain('Stale A');
    expect(overlayTexts(scene).map((o) => o.text)).toContain('Stale B');
    expect(overlayTexts(scene).filter((o) => o.text === '[ Lay off ]')).toHaveLength(1);
  }, 30_000);

  it('two employed members render two rows with two [ Move ] controls, in hire order, with both costs stated once', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    placeCard(scene, 0, { level: 1 }); // employment capacity level + 1 = 2

    const first = staffMember('manage-dialog-first', 'First Hire', 0);
    const second = staffMember('manage-dialog-second', 'Second Hire', 0);
    scene.state.staffCards = [first, second];
    scene.state.resourceBank.coins = 50;
    scene.state.resourceBank.reputation = 500;
    scene.refreshAll();

    scene.msTurnController.onSellCard(0);

    const labels = overlayTexts(scene).map((o) => o.text);
    // Exactly one row per member, one [ Move ] per row, hire order visible.
    expect(labels.filter((t) => t === '[ Move ]')).toHaveLength(2);
    expect(labels).toContain('First Hire');
    expect(labels).toContain('Second Hire');
    expect(labels.filter((t) => t.endsWith('/turn'))).toHaveLength(2);
    // Both affordance costs stated once in their own line (AC4).
    expect(
      labels.filter((t) => t.includes("Move: 1 action · Lay off: 1 turn's salary + reputation")),
    ).toHaveLength(1);

    // The rows are stacked in hire order (oldest hire at the top).
    const firstY = overlayTexts(scene).find((o) => o.text === 'First Hire')?.y ?? -1;
    const secondY = overlayTexts(scene).find((o) => o.text === 'Second Hire')?.y ?? -1;
    expect(firstY).toBeGreaterThanOrEqual(0);
    expect(secondY).toBeGreaterThan(firstY);
  }, 30_000);

  it("the first row's [ Move ] targets the first member (never the newest hire)", async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    placeCard(scene, 0, { level: 1 });

    scene.state.staffCards = [
      staffMember('manage-dialog-first', 'First Hire', 0),
      staffMember('manage-dialog-second', 'Second Hire', 0),
    ];
    scene.state.resourceBank.coins = 50;
    scene.state.resourceBank.reputation = 500;
    scene.refreshAll();

    const beginSpy = vi.spyOn(
      scene as unknown as { beginStaffMove: (staffId: string) => void },
      'beginStaffMove',
    );
    scene.msTurnController.onSellCard(0);

    const moves = overlayTexts(scene).filter((o) => o.text === '[ Move ]');
    expect(moves).toHaveLength(2);
    // First rendered [ Move ] belongs to the first (oldest) member.
    moves[0]!.emit('pointerdown');
    expect(beginSpy).toHaveBeenCalledWith('manage-dialog-first');
    // The move choreography dismisses the dialog and begins the relocation.
    expect(scene.overlayObjects).toHaveLength(0);
  }, 30_000);

  it('fits every row and button inside the panel at maximum employment capacity (level + 1 = 3)', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    placeCard(scene, 0, { level: 2 }); // employment capacity level + 1 = 3

    scene.state.staffCards = [
      staffMember('manage-dialog-cap-a', 'Cap A', 0),
      staffMember('manage-dialog-cap-b', 'Cap B', 0),
      staffMember('manage-dialog-cap-c', 'Cap C', 0),
    ];
    scene.state.resourceBank.coins = 50;
    scene.state.resourceBank.reputation = 500;
    scene.state.actionsRemaining = 3;
    scene.refreshAll();

    scene.msTurnController.onSellCard(0);

    const moves = overlayTexts(scene).filter((o) => o.text === '[ Move ]');
    expect(moves).toHaveLength(3);

    // Overlay box (depth 200) bounds — the panel is centred at gameH/2.
    const box = scene.overlayObjects.find(
      (o) => (o as unknown as { depth?: number }).depth === 200,
    ) as Phaser.GameObjects.Rectangle | undefined;
    expect(box).toBeTruthy();
    const boxTop = box!.y - box!.height / 2;
    const boxBottom = box!.y + box!.height / 2;

    // Every button — the rows' [ Move ]s, [ Lay off ] and the
    // sell/close/cancel row — sits fully inside the panel: no clipping.
    for (const btn of overlayTexts(scene).filter((o) => o.text.startsWith('['))) {
      expect(btn.y - btn.height / 2).toBeGreaterThanOrEqual(boxTop - 1);
      expect(btn.y + btn.height / 2).toBeLessThanOrEqual(boxBottom + 1);
    }

    // Rows stack below the sell/close/cancel row with no overlap: each
    // [ Move ] is strictly below the previous one.
    const sellBtn = findOverlayButton(scene, '[ Sell ]');
    for (const m of moves) {
      expect(m.y).toBeGreaterThan(sellBtn.y);
    }
    const ys = moves.map((m) => m.y);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
    }
  }, 30_000);

  it('[ Sell ], [ Close ] and [ Cancel ] keep working with staff rows present', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    placeCard(scene, 0, { level: 1 });
    scene.state.staffCards = [staffMember('manage-dialog-rows-card', 'Row Staff', 0)];
    scene.state.resourceBank.coins = 50;
    scene.state.resourceBank.reputation = 500;
    scene.refreshAll();

    // [ Cancel ]: dialog dismisses with no state change.
    scene.msTurnController.onSellCard(0);
    expect(overlayTexts(scene).filter((o) => o.text === '[ Move ]')).toHaveLength(1);
    findOverlayButton(scene, '[ Cancel ]').emit('pointerdown');
    expect(scene.overlayObjects).toHaveLength(0);
    expect(scene.state.streetGrid[0]).not.toBeNull();
    expect(scene.state.staffCards).toHaveLength(1);

    // [ Close ]: card removed, exactly one action spent.
    scene.msTurnController.onSellCard(0);
    findOverlayButton(scene, '[ Close ]').emit('pointerdown');
    expect(scene.state.streetGrid[0]).toBeNull();
    expect(scene.state.actionsRemaining).toBe(0);
    expect(scene.overlayObjects).toHaveLength(0);

    // [ Sell ]: card stays as an inert sold marker, refund credited once.
    placeCard(scene, 0, { level: 1 });
    scene.state.staffCards = [staffMember('manage-dialog-rows-sell', 'Sell Row Staff', 0)];
    scene.state.actionsRemaining = 1;
    scene.refreshAll();
    const coinsBefore = scene.state.resourceBank.coins;
    scene.msTurnController.onSellCard(0);
    findOverlayButton(scene, '[ Sell ]').emit('pointerdown');
    expect(scene.overlayObjects).toHaveLength(0);
    expect(scene.state.soldSlots[0]).toBe(true);
    expect(scene.state.streetGrid[0]).not.toBeNull(); // inert sold marker
    expect(scene.state.resourceBank.coins).toBeGreaterThan(coinsBefore);
  }, 30_000);

  it('sold cards open no dialog; animateClose degrades safely under reduced motion and replay', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as ManageScene;
    const biz = placeCard(scene, 0);

    // AC4: a sold card is never closeable and opens no Manage dialog.
    scene.state.soldSlots[0] = true;
    scene.refreshAll();
    scene.msTurnController.onSellCard(0);
    expect(scene.overlayObjects).toHaveLength(0);

    // AC5 (reduced motion): resolves with a sound-only fallback, no mutation.
    if (scene.settingsPanel) scene.settingsPanel._reducedMotion = true;
    await expect(
      scene.msAnimator.animateClose({ slotIndex: 0, cardId: biz.id, family: 'business' }),
    ).resolves.toBeUndefined();

    // AC5 (replay/headless): resolves immediately, no rendering or audio.
    (scene as unknown as { replayMode: boolean }).replayMode = true;
    await expect(
      scene.msAnimator.animateClose({ slotIndex: 0, cardId: biz.id, family: 'business' }),
    ).resolves.toBeUndefined();

    // The animator is presentation-only: the grid is untouched.
    expect(scene.state.streetGrid[0]?.id).toBe(biz.id);
  }, 30_000);
});
