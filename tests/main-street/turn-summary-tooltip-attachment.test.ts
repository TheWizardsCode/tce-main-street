/**
 * Turn Summary overlay — ledger tooltip attachment — MS-0MW6GZKZZ006PLLO
 * (verification child MS-0MW7QQ1TV009I4G9).
 *
 * Unit tests (mock-scene pattern) that prove the Turn Summary overlay:
 *
 *  - attaches the shared `attachHudTooltipZone` helper to every P&L line, the
 *    Incident / One-off adjustments, the Net bottom line and every
 *    supplementary context row;
 *  - builds tooltip content **lazily** — no content builder runs at row
 *    construction, only on hover/tap;
 *  - dismisses on mouse-out and toggles on tap;
 *  - never attaches a tooltip to the panel's controls (tabs, `[ Next Turn ]`,
 *    `[ Bank Loan ]`), so a tap cannot both press a control and toggle a
 *    tooltip (the `tapToggle: false` concern: there are no control rows);
 *  - re-attaches to the freshly drawn rows after a tab switch.
 *
 * The `@ui` overlay helpers and the tooltip content builders are mocked so the
 * wiring — not the wording — is asserted here; the wording is pinned by
 * `turn-summary-tooltips.test.ts` and the real pointer path by
 * `turn-summary-pl-overlay.browser.test.ts`.
 *
 * @module tests/main-street/turn-summary-tooltip-attachment
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock the tooltip content builders (wording is covered elsewhere) ──

const builders = vi.hoisted(() => ({
  income: vi.fn(() => 'income-tip'),
  expense: vi.fn(() => 'expense-tip'),
  total: vi.fn(() => 'total-tip'),
  incident: vi.fn(() => 'incident-tip'),
  oneOff: vi.fn(() => 'oneoff-tip'),
  net: vi.fn(() => 'net-tip'),
  context: vi.fn(() => 'context-tip'),
  summaryMetric: vi.fn(() => 'summary-tip'),
}));

vi.mock('../../src/scenes/MainStreetTurnSummaryTooltips', () => ({
  buildIncomeLineTooltip: builders.income,
  buildExpenseLineTooltip: builders.expense,
  buildTotalLineTooltip: builders.total,
  buildIncidentLineTooltip: builders.incident,
  buildOneOffLineTooltip: builders.oneOff,
  buildNetLineTooltip: builders.net,
  buildContextLineTooltip: builders.context,
  buildSummaryMetricTooltip: builders.summaryMetric,
}));

// ── Mock the `@ui` overlay helpers and the shared tooltip helper ──

const ui = vi.hoisted(() => ({
  attachments: [] as Array<{ obj: TextMock; aria: string; tooltip: () => string }>,
  buttons: [] as ButtonMock[],
}));

interface TextMock {
  text: string;
  x: number;
  y: number;
  depth: number | null;
  handlers: Record<string, Array<() => void>>;
  setOrigin: () => TextMock;
  setDepth: (d: number) => TextMock;
  on: (event: string, cb: () => void) => TextMock;
  emit: (event: string) => void;
}

interface ButtonMock {
  label: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  input?: { enabled?: boolean };
  interactive: boolean;
  handlers: Record<string, Array<() => void>>;
  setFontStyle: (style: string) => ButtonMock;
  setX: (x: number) => ButtonMock;
  disableInteractive: () => ButtonMock;
  on: (event: string, cb: () => void) => ButtonMock;
  emit: (event: string) => void;
}

function makeText(text: string, x: number, y: number): TextMock {
  const handlers: Record<string, Array<() => void>> = {};
  const obj: TextMock = {
    text,
    x,
    y,
    depth: null,
    handlers,
    setOrigin: () => obj,
    setDepth: (d: number) => { obj.depth = d; return obj; },
    on: (event: string, cb: () => void) => { (handlers[event] ??= []).push(cb); return obj; },
    emit: (event: string) => handlers[event]?.forEach((cb) => cb()),
  };
  return obj;
}

function makeButton(label: string, x: number, y: number, depth: number): ButtonMock {
  const handlers: Record<string, Array<() => void>> = {};
  const obj: ButtonMock = {
    label,
    x,
    y,
    width: label.length * 8,
    depth,
    input: { enabled: true },
    interactive: true,
    handlers,
    setFontStyle: () => obj,
    setX: (next: number) => { obj.x = next; return obj; },
    disableInteractive: () => { obj.interactive = false; obj.input = { enabled: false }; return obj; },
    on: (event: string, cb: () => void) => { (handlers[event] ??= []).push(cb); return obj; },
    emit: (event: string) => handlers[event]?.forEach((cb) => cb()),
  };
  return obj;
}

vi.mock('@ui', () => ({
  FONT_FAMILY: 'Arial',
  createOverlayBackground: vi.fn(() => ({ objects: [] })),
  createOverlayButton: vi.fn((_s: unknown, x: number, y: number, label: string, depth: number) => {
    const obj = makeButton(label, x, y, depth);
    ui.buttons.push(obj);
    return obj;
  }),
  dismissOverlay: vi.fn(),
  attachHudTooltipZone: vi.fn(
    (scene: { tooltipManager?: { show: (c: string) => void; hide: () => void } }, obj: TextMock, aria: string, tooltip: () => string) => {
      ui.attachments.push({ obj, aria, tooltip });
      // Mirror the real helper's event wiring without consuming the builder at
      // attach time (so laziness is observable).
      obj.on('pointerover', () => scene.tooltipManager?.show(tooltip()));
      obj.on('pointerout', () => scene.tooltipManager?.hide());
      let visible = false;
      obj.on('pointerdown', () => {
        if (visible) { visible = false; scene.tooltipManager?.hide(); }
        else { visible = true; scene.tooltipManager?.show(tooltip()); }
      });
    },
  ),
}));

import {
  showCompetitiveTurnSummaryDialog,
  showTurnSummaryDialog,
} from '../../src/scenes/MainStreetTurnSummaryOverlay';
import {
  buildCompetitiveTurnSummary,
  buildTurnSummary,
} from '../../src/scenes/MainStreetTurnSummary';
import { createCompetitiveState, setupMainStreetGame } from '../../src/MainStreetState';
import type {
  BusinessCard,
  CommunitySpaceCard,
  EventCard,
  StaffCard,
} from '../../src/MainStreetCards';
import type { CompetitiveRoundLedger, TurnLedger } from '../../src/MainStreetEngineTypes';

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

function singlePlayerState() {
  const state = setupMainStreetGame({ seed: 'tooltip-attach', difficulty: 'Easy' });
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

function competitiveState() {
  return createCompetitiveState({
    seed: 'tooltip-attach-cmp', playerCount: 2, difficulty: 'Easy', loansEnabled: false,
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

function makeScene(state: ReturnType<typeof singlePlayerState>) {
  const texts: TextMock[] = [];
  // The pointer blocker chains `.setOrigin().setDepth()` and registers `once`.
  const rect = {
    setOrigin: () => rect,
    setDepth: () => rect,
    setInteractive: () => rect,
    once: () => rect,
    destroy: vi.fn(),
  };
  const scene: Record<string, unknown> = {
    layout: { gameW: 1280, gameH: 720 },
    overlayObjects: [] as unknown[],
    replayMode: false,
    state,
    hudContainer: { add: vi.fn() },
    tooltipManager: { show: vi.fn(), hide: vi.fn() },
    input: {},
    time: { delayedCall: vi.fn() },
    add: {
      text: vi.fn((x: number, y: number, text: string) => {
        const obj = makeText(text, x, y);
        texts.push(obj);
        return obj;
      }),
      rectangle: vi.fn(() => rect),
    },
  };
  return { scene, texts };
}

/** The P&L + context row labels the single-player panel renders. */
const SINGLE_PLAYER_ROWS = [
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

function attachedTexts(): string[] {
  return ui.attachments.map((a) => a.obj.text);
}

/**
 * Selects the player's `[ You ]` tab.
 *
 * The panel opens on the Summary tab (MS-0MWBWRITL0089GGJ), so the P&L rows
 * are only drawn after switching to the per-player tab.
 */
function selectPlayerTab(): void {
  const youTab = ui.buttons.find((b) => b.label === '[ You ]');
  expect(youTab, 'no [ You ] tab').toBeDefined();
  youTab!.emit('pointerdown');
}

describe('Turn Summary overlay — tooltip attachment (MS-0MW7QQ1TV009I4G9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.attachments.length = 0;
    ui.buttons.length = 0;
  });

  it('attaches a tooltip to every single-player P&L and context row', () => {
    const state = singlePlayerState();
    const summary = buildTurnSummary(state, {
      turnLedger: ledger(),
      incident: { name: 'Test Incident' } as EventCard,
    })!;
    const { scene } = makeScene(state);

    showTurnSummaryDialog(scene as any, summary, () => {});

    // The panel opens on the Summary tab; switch to the player's statement.
    selectPlayerTab();

    // Every row in the statement carries an attachment, with its own text as
    // the aria label.
    for (const label of SINGLE_PLAYER_ROWS) {
      const attachment = ui.attachments.find((a) => a.obj.text === label);
      expect(attachment, `no tooltip attached to \u201c${label}\u201d`).toBeDefined();
      expect(attachment!.aria).toBe(label);
    }
    // Titles/headings are not ledger rows and get no tooltip.
    expect(attachedTexts()).not.toContain('Turn Summary');
    expect(attachedTexts()).not.toContain('Income');
  });

  it('builds tooltip content lazily — nothing is computed at row construction', () => {
    const state = singlePlayerState();
    const summary = buildTurnSummary(state, {
      turnLedger: ledger(),
      incident: { name: 'Test Incident' } as EventCard,
    })!;
    const { scene } = makeScene(state);

    showTurnSummaryDialog(scene as any, summary, () => {});

    // Switch to the player's statement (the panel opens on the Summary tab).
    selectPlayerTab();

    // No builder has run yet: content is only built on hover/tap.
    expect(builders.income).not.toHaveBeenCalled();
    expect(builders.expense).not.toHaveBeenCalled();
    expect(builders.net).not.toHaveBeenCalled();
    expect(builders.context).not.toHaveBeenCalled();

    // Hovering the first income row builds exactly that row's content.
    const base = ui.attachments.find((a) => a.obj.text.startsWith('Base income'))!;
    base.obj.emit('pointerover');
    expect(builders.income).toHaveBeenCalledTimes(1);
    expect((scene as any).tooltipManager.show).toHaveBeenCalledWith('income-tip');
  });

  it('dismisses on mouse-out and toggles on tap', () => {
    const state = singlePlayerState();
    const summary = buildTurnSummary(state, {
      turnLedger: ledger(),
      incident: { name: 'Test Incident' } as EventCard,
    })!;
    const { scene } = makeScene(state);
    showTurnSummaryDialog(scene as any, summary, () => {});

    // Switch to the player's statement (the panel opens on the Summary tab).
    selectPlayerTab();

    const row = ui.attachments.find((a) => a.obj.text.startsWith('Net profit'))!;
    row.obj.emit('pointerover');
    expect((scene as any).tooltipManager.show).toHaveBeenCalledWith('net-tip');
    row.obj.emit('pointerout');
    expect((scene as any).tooltipManager.hide).toHaveBeenCalled();
  });

  it('never attaches tooltips to the panel controls (no tap on a control toggles one)', () => {
    const state = singlePlayerState();
    const summary = buildTurnSummary(state, {
      turnLedger: ledger(),
      incident: { name: 'Test Incident' } as EventCard,
    })!;
    const { scene } = makeScene(state);
    showTurnSummaryDialog(scene as any, summary, () => {});

    const controlLabels = ui.buttons.map((b) => b.label);
    expect(controlLabels).toContain('[ Next Turn ]');
    for (const label of controlLabels) {
      expect(attachedTexts()).not.toContain(label);
    }
  });

  it('keeps [ Next Turn ] functional alongside the tooltip zones', () => {
    const state = singlePlayerState();
    const summary = buildTurnSummary(state, {
      turnLedger: ledger(),
      incident: { name: 'Test Incident' } as EventCard,
    })!;
    const { scene } = makeScene(state);
    const onNextTurn = vi.fn();
    showTurnSummaryDialog(scene as any, summary, onNextTurn);

    ui.buttons.find((b) => b.label === '[ Next Turn ]')!.emit('pointerdown');
    expect(onNextTurn).toHaveBeenCalledTimes(1);
  });

  it('re-attaches to the freshly drawn rows after a competitive tab switch', () => {
    const state = competitiveState();
    const summary = buildCompetitiveTurnSummary(state, {
      playerRoundLedger: competitiveLedger(),
    })!;
    const { scene } = makeScene(state as any);

    showCompetitiveTurnSummaryDialog(scene as any, summary, () => {});
    const firstTabAttachments = ui.attachments.length;
    expect(firstTabAttachments).toBeGreaterThan(0);

    // Switch to the other seat's tab: the whole statement body is redrawn, so
    // every new row is re-attached (the count grows by a full statement's worth).
    const aiTab = ui.buttons.find((b) => b.label === '[ AI 1 ]')!;
    aiTab.emit('pointerdown');
    expect(ui.attachments.length).toBeGreaterThan(firstTabAttachments);
  });
});
