/**
 * Main Street: Company Roster overlay browser tests (MS-0MWC1T8K2000DWZA).
 *
 * Verifies the Company Roster overlay in a real Phaser scene:
 *  - opening renders the title and one row per management-company member with
 *    the model's salary text, while business staff never appear;
 *  - the footer count/total match `buildCompanyRoster()`;
 *  - an empty team shows the explicit empty-state text;
 *  - the overlay is suppressed in `replayMode`;
 *  - `[ Close ]` removes every overlay object.
 *
 * The overlay is non-blocking; it is opened directly through the scene entry
 * point (`showCompanyRoster`) — the pile click wiring is a sibling item.
 *
 * @module tests/main-street/company-roster.browser
 */

import { afterEach, describe, expect, it } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { createStaffDeck, type StaffCard } from '../../src/MainStreetCards';

// ── Boot helpers (mirrors manage-card-dialog.browser.test.ts) ──

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
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

/** The subset of MainStreetScene state/fields this suite touches. */
interface RosterScene extends Phaser.Scene {
  state: {
    staffCards: StaffCard[];
    resourceBank: { coins: number; reputation: number };
    activityLog: Array<{ text: string }>;
  };
  overlayObjects: Phaser.GameObjects.GameObject[];
  hudContainer?: Phaser.GameObjects.Container;
  replayMode?: boolean;
  undoManager: {
    execute: (cmd: unknown) => void;
    undo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
  };
  showCompanyRoster: () => void;
  refreshAll: () => void;
}

/** All overlay text objects (buttons are Text objects with a `text` value). */
function overlayTexts(scene: RosterScene): Phaser.GameObjects.Text[] {
  return (scene.overlayObjects ?? []).filter(
    (o) => typeof (o as unknown as { text?: unknown }).text === 'string',
  ) as Phaser.GameObjects.Text[];
}

function findOverlayButton(scene: RosterScene, label: string): Phaser.GameObjects.Text {
  const btn = overlayTexts(scene).find((o) => o.text === label);
  if (!btn) {
    throw new Error(
      `Overlay button ${label} not found. Present: ${overlayTexts(scene).map((o) => o.text).join(', ')}`,
    );
  }
  return btn;
}

/** A management-company member (no `employedAtSlot`) with a given salary. */
function managementMember(id: string, name: string, ongoingCost: number): StaffCard {
  return {
    ...createStaffDeck(1)[0]!,
    id,
    name,
    specializationSkillIds: [],
    ongoingCost,
  };
}

/** A business-staff member (employed at a slot). */
function businessMember(id: string, name: string, ongoingCost: number): StaffCard {
  return { ...managementMember(id, name, ongoingCost), employedAtSlot: 0 };
}

describe('Company Roster overlay', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('renders the title and one row per management member, excluding business staff', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as RosterScene;
    scene.state.staffCards = [
      managementMember('mgmt-a', 'Ada Assistant', 100),
      businessMember('biz-b', 'Bob Barista', 200),
      managementMember('mgmt-c', 'Cleo Director', 250),
    ];

    scene.showCompanyRoster();

    const texts = overlayTexts(scene).map((o) => o.text);
    expect(texts).toContain('Company Roster');
    // Rows present with the model's salary text.
    expect(texts).toContain('Ada Assistant');
    expect(texts).toContain('Cleo Director');
    expect(texts).toContain('€100/turn');
    expect(texts).toContain('€250/turn');
    // Business staff never appear.
    expect(texts).not.toContain('Bob Barista');
    expect(texts).not.toContain('€200/turn');
  });

  it('footer states the member count and total per-turn salary', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as RosterScene;
    scene.state.staffCards = [
      managementMember('mgmt-a', 'Ada', 100),
      managementMember('mgmt-b', 'Bo', 250),
    ];

    scene.showCompanyRoster();

    const footer = overlayTexts(scene).find((o) => o.text.includes('management-company staff'));
    expect(footer).toBeDefined();
    expect(footer!.text).toContain('2 management-company staff');
    expect(footer!.text).toContain('€350');
  });

  it('shows the explicit empty state when the team is empty', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as RosterScene;
    scene.state.staffCards = [];

    scene.showCompanyRoster();

    const texts = overlayTexts(scene).map((o) => o.text);
    expect(texts).toContain('No management-company staff employed.');
    // And the footer still reports zero.
    expect(texts.some((t) => t.includes('0 management-company staff'))).toBe(true);
  });

  it('draws nothing in replayMode', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as RosterScene;
    scene.state.staffCards = [managementMember('mgmt-a', 'Ada', 100)];
    scene.replayMode = true;

    scene.showCompanyRoster();

    expect(scene.overlayObjects).toHaveLength(0);
  });

  it('[ Close ] dismisses the overlay and clears every overlay object', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as RosterScene;
    scene.state.staffCards = [managementMember('mgmt-a', 'Ada', 100)];

    scene.showCompanyRoster();
    expect(scene.overlayObjects.length).toBeGreaterThan(0);

    findOverlayButton(scene, '[ Close ]').emit('pointerdown');

    expect(scene.overlayObjects).toHaveLength(0);
  });
});

describe('Company Roster overlay — lay off confirm step', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  /** Boots a scene with one salary-250 member and rich resources, then opens the roster. */
  async function openWithDirector(): Promise<RosterScene> {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as RosterScene;
    scene.state.staffCards = [managementMember('mgmt-bo', 'Bo Director', 250)];
    scene.state.resourceBank.coins = 1000;
    scene.state.resourceBank.reputation = 500;
    scene.showCompanyRoster();
    return scene;
  }

  it('the confirm step quotes the model name, coin cost and reputation cost', async () => {
    const scene = await openWithDirector();

    findOverlayButton(scene, '[ Lay off ]').emit('pointerdown');

    const texts = overlayTexts(scene).map((o) => o.text);
    expect(texts).toContain('Lay off Bo Director?');
    const cost = texts.find((t) => t.includes("One turn's salary"));
    expect(cost).toBeDefined();
    // Salary 250 → coins €250, reputation max(100, ceil(250/100)*100) = 300.
    expect(cost!).toContain('€250');
    expect(cost!).toContain('−300');
    // Confirm/Cancel are offered.
    expect(texts).toContain('[ Confirm ]');
    expect(texts).toContain('[ Cancel ]');
  });

  it('[ Cancel ] changes nothing and restores the rows', async () => {
    const scene = await openWithDirector();
    const coinsBefore = scene.state.resourceBank.coins;
    const reputationBefore = scene.state.resourceBank.reputation;
    const staffBefore = scene.state.staffCards.map((m) => m.id);

    findOverlayButton(scene, '[ Lay off ]').emit('pointerdown');
    findOverlayButton(scene, '[ Cancel ]').emit('pointerdown');

    expect(scene.state.resourceBank.coins).toBe(coinsBefore);
    expect(scene.state.resourceBank.reputation).toBe(reputationBefore);
    expect(scene.state.staffCards.map((m) => m.id)).toEqual(staffBefore);
    // Rows and the lay-off affordance are back.
    expect(overlayTexts(scene).map((o) => o.text)).toContain('Bo Director');
    expect(overlayTexts(scene).some((o) => o.text === '[ Lay off ]')).toBe(true);
  });

  it('[ Confirm ] lays off the member, charges the quoted cost and refreshes in place', async () => {
    const scene = await openWithDirector();

    findOverlayButton(scene, '[ Lay off ]').emit('pointerdown');
    findOverlayButton(scene, '[ Confirm ]').emit('pointerdown');

    // Member removed, quoted costs charged.
    expect(scene.state.staffCards).toHaveLength(0);
    expect(scene.state.resourceBank.coins).toBe(1000 - 250);
    expect(scene.state.resourceBank.reputation).toBe(500 - 300);

    // The dialog stayed open and refreshed: row gone, empty state shown,
    // footer reports zero.
    const texts = overlayTexts(scene).map((o) => o.text);
    expect(texts).toContain('No management-company staff employed.');
    expect(texts).not.toContain('Bo Director');
    expect(texts.some((t) => t.includes('0 management-company staff'))).toBe(true);
    // [ Close ] still available (no reopen needed).
    expect(texts).toContain('[ Close ]');
  });

  it('after the final lay-off the empty state replaces the row list', async () => {
    const scene = await openWithDirector();

    findOverlayButton(scene, '[ Lay off ]').emit('pointerdown');
    findOverlayButton(scene, '[ Confirm ]').emit('pointerdown');

    expect(overlayTexts(scene).map((o) => o.text)).toContain(
      'No management-company staff employed.',
    );
  });

  it('a confirmed lay-off is undoable: undo restores member, coins and reputation', async () => {
    const scene = await openWithDirector();

    findOverlayButton(scene, '[ Lay off ]').emit('pointerdown');
    findOverlayButton(scene, '[ Confirm ]').emit('pointerdown');
    expect(scene.state.staffCards).toHaveLength(0);

    scene.undoManager.undo();

    expect(scene.state.staffCards.map((m) => m.id)).toEqual(['mgmt-bo']);
    expect(scene.state.resourceBank.coins).toBe(1000);
    expect(scene.state.resourceBank.reputation).toBe(500);

    // Reopening the roster shows the restored row.
    findOverlayButton(scene, '[ Close ]').emit('pointerdown');
    scene.showCompanyRoster();
    expect(overlayTexts(scene).map((o) => o.text)).toContain('Bo Director');
  });
});
