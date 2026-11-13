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

import { afterEach, describe, expect, it, vi } from 'vitest';
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

/** An unassigned business-staff member (hired, never placed). */
function unassignedBusinessMember(id: string, name: string, ongoingCost: number): StaffCard {
  const chef = createStaffDeck(1).find(c => c.id.startsWith('staff-chef'))!;
  return { ...chef, id, name, specializationSkillIds: [], ongoingCost };
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

describe('Company Roster overlay — Staff Pile entry point', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  /** Boots with the given management staff, refreshes the pile and opens nothing. */
  async function bootWithPile(): Promise<any> {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;
    scene.state.staffCards = [
      managementMember('mgmt-a', 'Ada Assistant', 100),
      managementMember('mgmt-b', 'Bo Director', 250),
    ];
    scene.refreshAll();
    return scene;
  }

  it('a pointer-down on the Staff Pile opens the Company Roster', async () => {
    const scene = await bootWithPile();
    const hit = scene.staffPileHitArea as Phaser.GameObjects.Rectangle;
    expect(hit).toBeDefined();

    hit.emit('pointerdown');

    expect(overlayTexts(scene).map((o) => o.text)).toContain('Company Roster');
  });

  it('the hit area spans the whole compact pile zone', async () => {
    const scene = await bootWithPile();
    const hit = scene.staffPileHitArea as Phaser.GameObjects.Rectangle;
    const { staffPileY, staffPileH } = scene.layout as { staffPileY: number; staffPileH: number };
    const top = hit.y - hit.height / 2;
    const bottom = hit.y + hit.height / 2;

    // The catcher covers the whole pile zone top-to-bottom, so a press
    // anywhere on the compact fan opens the roster.
    expect(top).toBeLessThanOrEqual(staffPileY + 1);
    expect(bottom).toBeGreaterThanOrEqual(staffPileY + staffPileH - 1);
  });

  it('the hover tooltip still appears, and pressing the pile dismisses it', async () => {
    const scene = await bootWithPile();
    const hit = scene.staffPileHitArea as Phaser.GameObjects.Rectangle;
    const show = vi.spyOn(scene.tooltipManager, 'show');
    const hide = vi.spyOn(scene.tooltipManager, 'hide');

    hit.emit('pointerover');
    expect(show).toHaveBeenCalledTimes(1);

    hit.emit('pointerdown');
    expect(hide).toHaveBeenCalled();
    expect(overlayTexts(scene).map((o) => o.text)).toContain('Company Roster');
  });

  it('does not cover the hand row: the hit area stays right of the capacity slots', async () => {
    const scene = await bootWithPile();
    // Widen the hand so the capacity row sweeps right beneath the pile.
    scene.state.maxHandSize = 8;
    scene.refreshPlayerHand();

    const hit = scene.staffPileHitArea as Phaser.GameObjects.Rectangle;
    expect(hit).toBeDefined();
    const capacityRowRight =
      scene.layout.handCenterX + (8 * (scene.layout.handCardW + 8)) / 2;
    // The pile's clickable region starts at the capacity row's right edge, so
    // a hand-card click/drag beside it is delivered to the hand, not swallowed
    // here.
    expect(hit.x - hit.width / 2).toBeGreaterThanOrEqual(capacityRowRight - 1);
  });
});

describe('Company Roster overlay — pile → roster → lay-off end-to-end', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  /** The live Staff Pile count badge, or null when the pile is gone. */
  function pileCount(scene: any): number | null {
    const container = scene.staffPileContainer as Phaser.GameObjects.Container | undefined;
    if (!container) return null;
    const badge = (container as any).list.find(
      (o: any) => typeof o.getData === 'function' && o.getData('staffPileCount') !== undefined,
    );
    return badge ? badge.getData('staffPileCount') : null;
  }

  it('pile click opens, lay-offs refresh row/footer/pile, and the empty state closes the loop', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as any;
    scene.state.staffCards = [
      managementMember('mgmt-a', 'Ada Assistant', 100),
      managementMember('mgmt-b', 'Bo Director', 250),
    ];
    scene.state.resourceBank.coins = 5000;
    scene.state.resourceBank.reputation = 5000;
    scene.refreshAll();

    expect(pileCount(scene)).toBe(2);

    // 1. Open the roster from the Staff Pile.
    (scene.staffPileHitArea as Phaser.GameObjects.Rectangle).emit('pointerdown');
    expect(overlayTexts(scene).map((o) => o.text)).toContain('Company Roster');
    expect(overlayTexts(scene).map((o) => o.text)).toContain('Ada Assistant');

    // 2. Lay off the first member: row, footer and pile count refresh in place.
    findOverlayButton(scene, '[ Lay off ]').emit('pointerdown');
    findOverlayButton(scene, '[ Confirm ]').emit('pointerdown');
    expect(scene.state.staffCards.map((m: any) => m.id)).toEqual(['mgmt-b']);
    expect(overlayTexts(scene).map((o) => o.text)).not.toContain('Ada Assistant');
    expect(overlayTexts(scene).some((o) => o.text.includes('1 management-company staff'))).toBe(true);
    expect(pileCount(scene)).toBe(1);

    // 3. Lay off the last member: empty state, pile gone, no lingering hit area.
    findOverlayButton(scene, '[ Lay off ]').emit('pointerdown');
    findOverlayButton(scene, '[ Confirm ]').emit('pointerdown');
    expect(scene.state.staffCards).toHaveLength(0);
    expect(overlayTexts(scene).map((o) => o.text)).toContain(
      'No management-company staff employed.',
    );
    expect(scene.staffPileContainer).toBeUndefined();
    expect(scene.staffPileHitArea).toBeUndefined();
  });
});

describe('Company Roster overlay — assign affordance for unassigned business staff (MS-0MWEWIFNT001PUY0)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
  });

  it('offers [ Assign ] next to [ Lay off ] for an unassigned business-staff member', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as RosterScene;
    scene.state.staffCards = [unassignedBusinessMember('staff-chef-u', 'Chef Cole', 150)];

    scene.showCompanyRoster();

    const texts = overlayTexts(scene).map((o) => o.text);
    // The member is surfaced under the explicit *unassigned business staff*
    // group (MS-0MWEWIJGU005FWYI), with the assign affordance and a lay-off.
    expect(texts).toContain('Unassigned business staff');
    expect(texts).toContain('Chef Cole');
    expect(texts).toContain('[ Assign ]');
    expect(texts).toContain('[ Lay off ]');
  });

  it('never offers [ Assign ] for a management-company member', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as RosterScene;
    scene.state.staffCards = [managementMember('mgmt-a', 'Ada Assistant', 100)];

    scene.showCompanyRoster();

    const texts = overlayTexts(scene).map((o) => o.text);
    expect(texts).toContain('Ada Assistant');
    expect(texts).toContain('[ Lay off ]');
    expect(texts).not.toContain('[ Assign ]');
  });

  it('[ Assign ] dismisses the overlay and begins the assign flow for that member', async () => {
    game = await bootGame();
    const scene = game.scene.getScene('MainStreetScene') as RosterScene & { beginStaffMove: (id: string) => void };
    scene.state.staffCards = [unassignedBusinessMember('staff-chef-u', 'Chef Cole', 150)];
    scene.showCompanyRoster();

    const beginSpy = vi.spyOn(scene, 'beginStaffMove');
    findOverlayButton(scene, '[ Assign ]').emit('pointerdown');

    expect(beginSpy).toHaveBeenCalledWith('staff-chef-u');
    // The roster overlay is dismissed so the player can pick a destination.
    expect(scene.overlayObjects).toHaveLength(0);
  });
});
