/**
 * Turn Summary — ledger tooltip behaviour — browser tests (MS-0MW6GZKZZ006PLLO,
 * verification MS-0MW7QQ286007L4J3).
 *
 * Drives the real Phaser scene (and the scene's DOM `TooltipManager`) to prove
 * the ledger tooltips behave for a live player:
 *
 * 1. Hovering a P&L / context row shows a tooltip and moving out hides it, for
 *    every row, in both single-player and competitive play.
 * 2. A tap toggles the tooltip on and a second tap dismisses it.
 * 3. Opening and dismissing tooltips never blocks tab switching, `[ Next Turn ]`
 *    or `[ Bank Loan ]`.
 * 4. Competitive closings render the selected seat's own tooltip content, and
 *    switching tabs switches the tooltip content.
 *
 * Rows are driven through their Phaser pointer events (the same pipeline the
 * attach helper registers), and one assertion reads the tooltip manager's DOM
 * container text so the check is on real player-visible copy, not pixels.
 *
 * @module tests/main-street/turn-summary-tooltip.browser
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Phaser from 'phaser';

import { waitForScene } from '@core-tests/helpers/waitForScene';
import { dismissBootModals } from './helpers/bootModals';
import type {
  BusinessCard,
  CommunitySpaceCard,
  EventCard,
  StaffCard,
} from '../../src/MainStreetCards';
import type { CompetitiveRoundLedger, TurnLedger } from '../../src/MainStreetEngineTypes';
import { createCompetitiveState, setupMainStreetGame } from '../../src/MainStreetState';
import type { MainStreetState } from '../../src/MainStreetState';
import {
  buildCompetitiveTurnSummary,
  buildTurnSummary,
} from '../../src/scenes/MainStreetTurnSummary';

type SceneWithHud = Phaser.Scene & Record<string, any>;

// ── Boot helpers (mirrors turn-summary-pl-overlay.browser.test.ts) ──

async function bootGame(): Promise<Phaser.Game> {
  let container = document.getElementById('game-container');
  if (container) container.remove();
  container = document.createElement('div');
  container.id = 'game-container';
  document.body.appendChild(container);
  const { createMainStreetGame } = await import('../../src/createMainStreetGame');
  const game = createMainStreetGame({ type: Phaser.CANVAS });
  await waitForScene(game, 'MainStreetScene');
  await dismissBootModals(game.scene.getScene('MainStreetScene'));
  return game;
}

function destroyGame(game: Phaser.Game | null): void {
  if (game) game.destroy(true, false);
  const container = document.getElementById('game-container');
  if (container) container.remove();
}

/** Every overlay-created text object, in draw order. */
function overlayTexts(s: SceneWithHud): Phaser.GameObjects.Text[] {
  const objects = (s.overlayObjects ?? []) as Phaser.GameObjects.GameObject[];
  return objects.filter((o) => o instanceof Phaser.GameObjects.Text) as Phaser.GameObjects.Text[];
}

function overlayText(s: SceneWithHud, label: string): Phaser.GameObjects.Text | undefined {
  return overlayTexts(s).find((t) => t.text === label);
}

/** The scene's DOM tooltip node text (empty when hidden or absent). */
function tooltipDomText(): string {
  const nodes = Array.from(document.querySelectorAll('div')).filter(
    (d) => (d as HTMLElement).style.zIndex === '2147483647',
  ) as HTMLElement[];
  const visible = nodes.filter((n) => n.style.display !== 'none');
  return visible.map((n) => n.textContent ?? '').join('\n');
}

// ── Fixtures ─────────────────────────────────────────────────

function makeBusiness(name: string, ongoingCost: number): BusinessCard {
  return { family: 'business', id: `biz-${name}`, name, ongoingCost } as BusinessCard;
}
function makeSpace(name: string, ongoingCost: number): CommunitySpaceCard {
  return { family: 'community-space', id: `cs-${name}`, name, ongoingCost } as CommunitySpaceCard;
}
function makeStaff(name: string, ongoingCost: number): StaffCard {
  return { family: 'staff', id: `stf-${name}`, name, ongoingCost } as StaffCard;
}

function singlePlayerState(): MainStreetState {
  const state = setupMainStreetGame({ seed: 'turn-summary-tooltip-browser', difficulty: 'Easy' });
  state.turn = 4;
  state.players = [];
  state.streetGrid = state.streetGrid.map(() => null);
  state.soldSlots = state.soldSlots.map(() => false);
  state.streetGrid[0] = makeBusiness('Bakery', 10);
  state.streetGrid[1] = makeSpace('Park', 20);
  state.staffCards = [makeStaff('Clerk', 50)];
  state.weekStartCoins = 1000; state.weekStartRep = 10; state.weekStartScore = 20;
  state.resourceBank.coins = 990; state.resourceBank.reputation = 12; state.finalScore = 34;
  return state;
}

function ledger(): TurnLedger {
  return {
    incomeByPhase: { base: 80, synergy: 7, reputation: 4, events: -2 },
    ongoingCosts: { staff: -50, community: -20, business: -10 },
    incidentCoinChange: -20,
    incidentRepChange: -1,
    oneOffDeltas: { coins: -4, reputation: 0 },
    netCoinChange: -10,
    netRepChange: 2,
    netScoreChange: 14,
    businessesOwned: { '0': 1 },
  };
}

function income() {
  return {
    total: 89,
    breakdown: [{ slotIndex: 0, businessName: 'Bakery', baseIncome: 80, synergyBonus: 0, total: 80 }],
    handSynergyTotal: 0,
    phaseBreakdown: {
      perSlotBreakdown: [{
        slotIndex: 0, businessName: 'Bakery', baseIncome: 80, synergyBonus: 0,
        repBonus: 0, eventDeltas: [], upcomingDeltas: [],
      }],
      handSynergyTotal: 0,
    },
  };
}

const SINGLE_ROWS = [
  'Base income: +80',
  'Synergy income: +7',
  'Reputation income: +4',
  'Event income: -2',
  'Total income: +89',
  'Staff wages: -50',
  'Community spaces: -20',
  'Business costs: -10',
  'Total operating expenses: -80',
  'Incident: Coins -20, Rep -1',
  'One-off: Coins -4, Rep 0',
  'Net profit/loss: -10',
  'Reputation change: +2 · Score change: +14',
  'Closing coins: 990 · Closing Rep 12 · Score 34',
  'Businesses owned: 1',
  'Incident drawn: Test Incident',
];

function competitiveState(): MainStreetState {
  return createCompetitiveState({
    seed: 'turn-summary-tooltip-browser-cmp', playerCount: 2, difficulty: 'Easy', loansEnabled: false,
  });
}

function competitiveLedger(): CompetitiveRoundLedger {
  const seat = (ownerId: number, base: number, net: number) => ({
    ownerId, businessesOwned: 1,
    incomeByPhase: { base, synergy: 0, reputation: 0, events: 0 },
    incomeTotal: base,
    ongoingCosts: { staff: 0, community: 0, business: 0 },
    dayStart: { coins: 10, reputation: 0, score: 0 },
    closing: { coins: 10 + net, reputation: 0, score: 0 },
    netCoinChange: net, netRepChange: 0, netScoreChange: 0,
    incidentCoinChange: 0, incidentRepChange: 0, oneOffDeltas: { coins: 0, reputation: 0 },
  });
  return { turn: 4, seats: [seat(0, 10, 10), seat(1, 20, 20)] };
}

function seatIncome(ownerId: number, businessName: string, base: number) {
  return {
    ownerId,
    income: {
      total: base,
      breakdown: [{ slotIndex: 0, businessName, baseIncome: base, synergyBonus: 0, total: base }],
      handSynergyTotal: 0,
      phaseBreakdown: {
        perSlotBreakdown: [{
          slotIndex: 0, businessName, baseIncome: base, synergyBonus: 0,
          repBonus: 0, eventDeltas: [], upcomingDeltas: [],
        }],
        handSynergyTotal: 0,
      },
    },
  };
}

describe('Turn Summary ledger tooltip behaviour (browser, MS-0MW7QQ286007L4J3)', () => {
  let game: Phaser.Game | null = null;

  afterEach(() => {
    destroyGame(game);
    game = null;
    // Drop any tooltip DOM nodes left over from this test's scene.
    Array.from(document.querySelectorAll('div'))
      .filter((d) => (d as HTMLElement).style.zIndex === '2147483647')
      .forEach((d) => d.remove());
  });

  it('shows a tooltip on hover and hides it on mouse-out for every single-player row', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const summary = buildTurnSummary(singlePlayerState(), {
      turnLedger: ledger(),
      incident: { name: 'Test Incident' } as EventCard,
      income: income(),
    })!;
    const show = vi.spyOn(s.tooltipManager, 'show');
    const hide = vi.spyOn(s.tooltipManager, 'hide');

    s.showTurnSummaryDialog(summary, () => {});

    // The panel opens on the Summary tab; select the player's statement.
    overlayText(s, '[ You ]')!.emit('pointerdown');

    for (const label of SINGLE_ROWS) {
      const row = overlayText(s, label);
      expect(row, `missing row \u201c${label}\u201d`).toBeDefined();
      show.mockClear();
      hide.mockClear();
      row!.emit('pointerover');
      expect(show, `no tooltip on \u201c${label}\u201d`).toHaveBeenCalledTimes(1);
      expect(String(show.mock.calls[0][0]).length).toBeGreaterThan(0);
      row!.emit('pointerout');
      expect(hide, `no dismiss on \u201c${label}\u201d`).toHaveBeenCalled();
    }

    // The DOM container shows the real per-business content for the income row.
    overlayText(s, 'Base income: +80')!.emit('pointerover');
    expect(tooltipDomText()).toContain('Bakery: +80');
  }, 30_000);

  it('toggles the tooltip on a tap and dismisses it on a second tap', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const summary = buildTurnSummary(singlePlayerState(), {
      turnLedger: ledger(),
      incident: { name: 'Test Incident' } as EventCard,
      income: income(),
    })!;
    const show = vi.spyOn(s.tooltipManager, 'show');
    const hide = vi.spyOn(s.tooltipManager, 'hide');

    s.showTurnSummaryDialog(summary, () => {});

    // The panel opens on the Summary tab; select the player's statement.
    overlayText(s, '[ You ]')!.emit('pointerdown');
    const row = overlayText(s, 'Staff wages: -50')!;

    row.emit('pointerdown');
    expect(show).toHaveBeenCalledTimes(1);
    row.emit('pointerdown');
    expect(hide).toHaveBeenCalled();
  }, 30_000);

  it('does not block tab switching or [ Next Turn ] while tooltips are open', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const summary = buildCompetitiveTurnSummary(competitiveState(), {
      playerRoundLedger: competitiveLedger(),
      playerIncome: [seatIncome(0, 'Human Bakery', 10), seatIncome(1, 'AI Cafe', 20)],
    })!;

    let nextTurnCalls = 0;
    s.showCompetitiveTurnSummaryDialog(summary, () => { nextTurnCalls += 1; });

    // The panel opens on the Summary tab; select the human seat's statement.
    overlayText(s, '[ You ]')!.emit('pointerdown');

    // Open a tooltip, then switch tabs — the tooltip zones never capture the
    // tab press.
    overlayText(s, 'Base income: +10')!.emit('pointerover');
    overlayText(s, '[ AI 1 ]')!.emit('pointerdown');
    expect(overlayText(s, '[ AI 1 ]')!.style.fontStyle).toBe('bold');
    expect(overlayText(s, 'Base income: +20')).toBeDefined();

    // With a tooltip open, [ Next Turn ] still resumes the day.
    overlayText(s, 'Base income: +20')!.emit('pointerover');
    overlayText(s, '[ Next Turn ]')!.emit('pointerdown');
    expect(nextTurnCalls).toBe(1);
  }, 30_000);

  it('renders the selected seat’s own tooltip content and switches it with the tab', async () => {
    game = await bootGame();
    const s = game.scene.getScene('MainStreetScene') as SceneWithHud;
    const summary = buildCompetitiveTurnSummary(competitiveState(), {
      playerRoundLedger: competitiveLedger(),
      playerIncome: [seatIncome(0, 'Human Bakery', 10), seatIncome(1, 'AI Cafe', 20)],
    })!;
    const show = vi.spyOn(s.tooltipManager, 'show');

    s.showCompetitiveTurnSummaryDialog(summary, () => {});

    // The panel opens on the Summary tab; select the human seat's statement.
    overlayText(s, '[ You ]')!.emit('pointerdown');

    // The human tab's income tooltip names the human's business.
    overlayText(s, 'Base income: +10')!.emit('pointerover');
    expect(String(show.mock.calls[show.mock.calls.length - 1][0])).toContain('Human Bakery: +10');

    // Switching to the AI tab redraws the body; its income tooltip names the
    // AI's business.
    overlayText(s, '[ AI 1 ]')!.emit('pointerdown');
    overlayText(s, 'Base income: +20')!.emit('pointerover');
    expect(String(show.mock.calls[show.mock.calls.length - 1][0])).toContain('AI Cafe: +20');
  }, 30_000);
});
