/**
 * Main Street: Human piggyback prompt — join fully or keep 50%
 *
 * F5 leaf MS-0MV8BG5OQ003XUJW of epic MS-0MUYC47EL005Z69H. Covers:
 *
 *  AC1 — when the human seat holds a pending piggyback decision, the scene
 *        presents a prompt carrying the exact 150% coin cost and the
 *        100%/50% reward shares; each option resolves through an undoable
 *        command (`resolvePiggybackCommand`, snapshot-first).
 *  AC2 — the prompt offers exactly two outcomes (never a decline/skip); an
 *        unaffordable join-fully is hidden and the automatic free-ride
 *        applies.
 *  AC3 — resolving the human decision continues the shared day (no stall)
 *        and the acting player's resolution already completed first.
 *  AC4 — scene/command-layer tests cover both outcomes; the terminology
 *        guard suite is exercised by the existing guard test.
 *
 * Fixtures set owner reputation to 0 so the reputation coin multiplier is 1
 * and expected credits are exact integer values.
 */
import { describe, it, expect, vi } from 'vitest';

import { UndoRedoManager } from '@core-engine/UndoRedoManager';

import {
  createCompetitiveState,
  type MainStreetState,
} from '../../src/MainStreetState';
import { bindCompetitiveSeat } from '../../src/MainStreetAiStrategy';
import type { EventCard } from '../../src/MainStreetCards';
import {
  canAffordPiggybackJoinFully,
  executeAction,
  findHumanSeatId,
  getNextPendingPiggybackSeat,
  hasPendingPiggyback,
  piggybackJoinFullyCost,
  projectPiggybackEventReward,
  resolveCompetitivePendingPiggyback,
} from '../../src/MainStreetEngine';
import { resolvePiggybackCommand } from '../../src/MainStreetCommands';
import {
  buildCompetitiveScoreboard,
  formatCompetitiveScoreboardRow,
} from '../../src/scenes/MainStreetCompetitiveScoreboard';
import {
  endCompetitiveTurnDay,
  runCompetitiveClosing,
} from '../../src/scenes/MainStreetTurnControllerCompetitive';
import {
  onPiggybackChoice,
  presentPiggybackDialog,
} from '../../src/scenes/MainStreetTurnControllerTurnFlow';

// ── Helpers ───────────────────────────────────────────────────────

/** A flat `All` organiser event with exact deterministic rewards. */
function eligibleAllEvent(
  coinDelta = 100,
  reputationDelta = 200,
  overrides: Partial<EventCard> = {},
): EventCard {
  return {
    family: 'event',
    id: 'evt-human-prompt',
    name: 'Eligible Gathering',
    trigger: 'Investment',
    target: 'All',
    effect: 'Test effect',
    cost: 300,
    coinDelta,
    reputationDelta,
    piggybackable: true,
    ...overrides,
  } as EventCard;
}

/** Competitive state: clean 1000-coin / 0-rep wallets, padded host bank. */
function compState(seed: string, playerCount: number): MainStreetState {
  const state = createCompetitiveState({ seed, playerCount });
  state.resourceBank.coins = 100000;
  state.resourceBank.reputation = 1000;
  for (const p of state.players!) {
    p.coins = 1000;
    p.reputation = 0;
  }
  state.phase = 'MarketPhase';
  state.actionsRemaining = 5;
  state.activePlayerId = 0;
  return state;
}

/**
 * An AI seat (seat 1) organises the eligible event, leaving the human seat
 * (0) with the pending piggyback decision. `paidCost` is the 300-coin listed
 * cost (charge 450).
 */
function raiseHumanDecision(state: MainStreetState): void {
  state.activePlayerId = 1;
  state.phase = 'MarketPhase';
  state.actionsRemaining = 5;
  bindCompetitiveSeat(state, 1);
  state.hand.push(eligibleAllEvent());
  executeAction(state, { type: 'play-event-from-hand', handIndex: state.hand.length - 1 });
}

/**
 * Fake scene surface `presentPiggybackDialog` / `onPiggybackChoice` need. The
 * scene is arranged as the production end-turn scene (replay/reduced-motion
 * so the closing presentation advances synchronously and the dialog is one
 * surface short of the real overlay manager).
 */
function makeSceneHarness(state: MainStreetState) {
  const dialogCalls: any[] = [];
  const scene: any = {
    state,
    uiPhase: 'market',
    activeSeatId: 0,
    celebratedChallengeIds: new Set<string>(),
    pendingApplicant: null,
    justMovedHandCardId: null,
    hintUsedThisTurn: false,
    hintedCardId: null,
    hintedSlotIndex: null,
    // NOT replay: the interactive piggyback dialog must be presented. The
    // closing tail advances synchronously via reduced motion instead.
    replayMode: false,
    settingsPanel: { reducedMotion: true },
    tutorialController: { isActive: false },
    msLifecycleManager: {
      isTutorialActionAllowed: () => ({ allowed: true }),
      onTutorialActionComplete: () => {},
    },
    msRenderer: { getFrontIncidentCardCenter: () => ({ x: 0, y: 0 }) },
    msAnimator: {
      animateWeekBanner: () => {},
      animateIncidentReveal: () => {},
      animateIncomePhases: () => {},
    },
    cardSvgLoadPromise: new Promise<void>(() => {}),
    prewarmVisibleCardTextures: () => {},
    refreshAll: () => {},
    refreshActionButtons: () => {},
    refreshUndoRedoButtons: () => {},
    refreshLog: () => {},
    time: {
      now: 0,
      delayedCall: (_ms: number, cb: () => void) => {
        cb();
        return {};
      },
    },
    layout: { gameW: 800, gameH: 600 },
    msOverlayManager: {
      showPiggybackDialog: (info: any, onJoin: () => void, onKeep: () => void) => {
        dialogCalls.push({ info, onJoin, onKeep });
      },
    },
    undoManager: new UndoRedoManager(),
  };
  const tcCtx: any = {
    scene,
    startTurnPhase: vi.fn(),
    handleGameOver: vi.fn(),
    onSaveCheckpoint: vi.fn(),
    presentPiggybackDialog: () => presentPiggybackDialog(tcCtx),
    onPiggybackChoice: (join: boolean) => onPiggybackChoice(tcCtx, join),
  };
  const instructions = (): string[] => (scene.feedbackHistory ?? []).map((e: any) => String(e.text));
  return { scene, tcCtx, dialogCalls, instructions };
}

// ── AC1: command layer — join fully / keep 50% — undoable ─────────

describe('AC1 — resolvePiggybackCommand is snapshot-based and undoable', () => {
  it('join fully: exact 150% charge, 100% own-board reward, no action spent', () => {
    const state = compState('pb-prompt-cmd-join', 2);
    raiseHumanDecision(state);
    const humanId = findHumanSeatId(state);
    expect(humanId).toBe(0);
    expect(getNextPendingPiggybackSeat(state)).toBe(humanId);
    const actionBudgetBefore = state.players![humanId].actionBudget;
    const undo = new UndoRedoManager();

    const cmd = resolvePiggybackCommand(state, humanId, true);
    undo.execute(cmd);

    expect(piggybackJoinFullyCost(300)).toBe(450);
    expect(state.players![humanId].coins).toBe(1000 - 450 + 100); // 650
    expect(state.players![humanId].reputation).toBe(200);
    expect(state.players![humanId].actionBudget).toBe(actionBudgetBefore);
    expect(hasPendingPiggyback(state)).toBe(false);
  });

  it('undo restores the wallet and re-opens the unresolved pending decision', () => {
    const state = compState('pb-prompt-cmd-undo', 2);
    raiseHumanDecision(state);
    const humanId = findHumanSeatId(state);
    const undo = new UndoRedoManager();

    const cmd = resolvePiggybackCommand(state, humanId, true);
    undo.execute(cmd);
    expect(state.players![humanId].coins).toBe(650);
    expect(state.players![humanId].reputation).toBe(200);

    undo.undo();
    expect(state.players![humanId].coins).toBe(1000);
    expect(state.players![humanId].reputation).toBe(0);
    expect(hasPendingPiggyback(state)).toBe(true);
    expect(state.pendingPiggyback!.decisions[0].resolved).toBe(false);
    expect(state.pendingPiggyback!.decisions[0].chosenJoin).toBeNull();
  });

  it('keep 50%: automatic free-ride, no charge, nothing spent; undo restores', () => {
    const state = compState('pb-prompt-cmd-keep', 2);
    raiseHumanDecision(state);
    const humanId = findHumanSeatId(state);
    const undo = new UndoRedoManager();

    const cmd = resolvePiggybackCommand(state, humanId, false);
    undo.execute(cmd);

    expect(state.players![humanId].coins).toBe(1000 + 50); // 50% of 100 coins
    expect(state.players![humanId].reputation).toBe(100); // 50% of 200 rep
    expect(hasPendingPiggyback(state)).toBe(false);

    undo.undo();
    expect(state.players![humanId].coins).toBe(1000);
    expect(state.players![humanId].reputation).toBe(0);
    expect(hasPendingPiggyback(state)).toBe(true);
  });

  it('unaffordable join-fully falls back to the free-ride — never a partial charge', () => {
    const state = compState('pb-prompt-cmd-unafford', 2);
    raiseHumanDecision(state);
    const humanId = findHumanSeatId(state);
    state.players![humanId].coins = 100; // human cannot afford the 450 charge
    expect(canAffordPiggybackJoinFully(state, humanId, 300)).toBe(false);
    const undo = new UndoRedoManager();

    const cmd = resolvePiggybackCommand(state, humanId, true);
    undo.execute(cmd);

    // Free-ride applied (50% of 100 coins = 50), never the partial charge.
    expect(state.players![humanId].coins).toBe(100 + 50);
    expect(state.players![humanId].reputation).toBe(100);
    // The solo decision resolved (the pending set cleared) and never charged
    // a partial 450.
    expect(hasPendingPiggyback(state)).toBe(false);
  });
});

// ── AC1/AC2: scene prompt numbers + exactly-two-outcomes surface ──

describe('AC1/AC2 — presentPiggybackDialog presents the exact cost and reward shares', () => {
  it('carries the exact 150% charge and the 100%/50% reward projections', () => {
    const state = compState('pb-prompt-dialog', 2);
    raiseHumanDecision(state);
    const { tcCtx, dialogCalls } = makeSceneHarness(state);

    tcCtx.presentPiggybackDialog();

    expect(dialogCalls).toHaveLength(1);
    const { info } = dialogCalls[0];
    expect(info.affordable).toBe(true);
    expect(info.charge).toBe(450);
    expect(info.fullReward).toEqual({ scale: 1, coins: 100, reputation: 200, matchCount: 0 });
    expect(info.halfReward).toEqual({ scale: 0.5, coins: 50, reputation: 100, matchCount: 0 });
    expect(info.event.id).toBe('evt-human-prompt');
  });

  it('projects rewards through the shared engine helper (exact shares)', () => {
    const state = compState('pb-prompt-projection', 2);
    raiseHumanDecision(state);
    const humanId = findHumanSeatId(state);
    const pending = state.pendingPiggyback!;
    const full = projectPiggybackEventReward(state, pending.event, humanId, 1.0);
    const half = projectPiggybackEventReward(state, pending.event, humanId, 0.5);
    expect(full.coins).toBe(100);
    expect(half.coins).toBe(50);
    expect(full.reputation).toBe(200);
    expect(half.reputation).toBe(100);
  });

  it('marks the join-fully option unaffordable (hidden) when the charge is out of reach', () => {
    const state = compState('pb-prompt-dialog-unafford', 2);
    state.players![0].coins = 100;
    raiseHumanDecision(state);
    const { tcCtx, dialogCalls } = makeSceneHarness(state);

    tcCtx.presentPiggybackDialog();

    expect(dialogCalls).toHaveLength(1);
    expect(dialogCalls[0].info.affordable).toBe(false);
    expect(dialogCalls[0].info.charge).toBe(450);
  });

  it('offers exactly two callbacks — join fully and keep 50% — never a decline/skip', () => {
    const state = compState('pb-prompt-two-outcomes', 2);
    raiseHumanDecision(state);
    const { tcCtx, dialogCalls } = makeSceneHarness(state);

    tcCtx.presentPiggybackDialog();

    expect(dialogCalls).toHaveLength(1);
    const { onJoin, onKeep } = dialogCalls[0];
    expect(typeof onJoin).toBe('function');
    expect(typeof onKeep).toBe('function');
  });

  it('is a no-op when the human seat has no pending decision', () => {
    const state = compState('pb-prompt-none', 2);
    const { tcCtx, dialogCalls } = makeSceneHarness(state);
    tcCtx.presentPiggybackDialog();
    expect(dialogCalls).toHaveLength(0);
  });
});

// ── AC3: resolution continues the shared day (no stall) ───────────

describe('AC3 — resolving the human decision continues the shared day', () => {
  it('onPiggybackChoice(join) resolves via the command; the exact join premium shows vs free-ride', () => {
    // Two identical states (same seed → identical closing incident/income):
    // the only difference is the human's join-vs-free-ride choice.
    const build = () => {
      const state = compState('pb-prompt-continue-join', 2);
      raiseHumanDecision(state);
      state.phase = 'InvestmentResolution';
      state.incidentDeck = []; // deterministic closing in both branches
      return state;
    };
    const joinState = build();
    const rideState = build();
    const { tcCtx: joinCtx } = makeSceneHarness(joinState);
    const { tcCtx: rideCtx } = makeSceneHarness(rideState);

    // The acting player's resolution completed at play time — before the
    // piggyback prompt — and remains authoritative in both branches.
    const actingCoins = joinState.players![1].coins;
    const actingRep = joinState.players![1].reputation;

    joinCtx.onPiggybackChoice(true);
    rideCtx.onPiggybackChoice(false);

    // Join fully paid the exact 150% charge (450) and earned the 100% reward
    // (100c/200r) versus the free-ride 50% (50c/100r): join is exactly
    // −450 + 50 = −400 coins and +100 reputation ahead after the identical
    // shared closing (same incident/income in both branches, deck cleared).
    expect(joinState.players![0].coins).toBe(rideState.players![0].coins - 400);
    expect(joinState.players![0].reputation).toBe(rideState.players![0].reputation + 100);
    // Exact tallies: join 650c/200r, free-ride 1050c/100r (1000 − 450 + 100
    // vs 1000 + 50; 0 + 200 vs 0 + 100).
    expect(joinState.players![0].coins).toBe(650);
    expect(joinState.players![0].reputation).toBe(200);
    expect(rideState.players![0].coins).toBe(1050);
    expect(rideState.players![0].reputation).toBe(100);
    // Both branches cleared the pending set and the day advanced — no stall.
    expect(hasPendingPiggyback(joinState)).toBe(false);
    expect(hasPendingPiggyback(rideState)).toBe(false);
    expect(joinState.players![1].coins).toBe(actingCoins); // acting seat untouched by the human's choice
    expect(joinState.players![1].reputation).toBe(actingRep);
    if (joinState.gameResult === 'playing') {
      expect(joinState.phase).toBe('WeekStart');
    }
  });

  it('onPiggybackChoice(keep) applies the free-ride and never stalls', () => {
    const state = compState('pb-prompt-continue-keep', 2);
    raiseHumanDecision(state);
    state.phase = 'InvestmentResolution';
    state.incidentDeck = []; // deterministic closing (no incident delta)
    const { tcCtx } = makeSceneHarness(state);

    tcCtx.onPiggybackChoice(false);

    // The automatic 50% share: exactly +50 coins / +100 rep from 1000c/0r.
    expect(state.players![0].coins).toBe(1050);
    expect(state.players![0].reputation).toBe(100);
    expect(hasPendingPiggyback(state)).toBe(false);
    if (state.gameResult === 'playing') {
      expect(state.phase).toBe('WeekStart');
    }
  });

  it('runCompetitiveClosing pauses while the human decision is unresolved (no auto-settle)', () => {
    const state = compState('pb-prompt-pause', 2);
    raiseHumanDecision(state);
    state.phase = 'InvestmentResolution';

    const closing = runCompetitiveClosing(state);

    expect(closing).not.toBeNull();
    expect(closing!.piggybackPending).toBe(true);
    // Nothing applied while paused: the human wallet is untouched.
    expect(state.players![0].coins).toBe(1000);
    expect(hasPendingPiggyback(state)).toBe(true);
  });

  it('headless callers (resolveCompetitivePendingPiggyback) still auto-settle AI seats', () => {
    const state = compState('pb-prompt-headless', 3);
    // Seat 0 plays the event; seats 1 and 2 (AI) are invited. The reward
    // value (400c + 200r = 600) exceeds the 450 charge, so the F4 policy
    // joins on both seats — deterministic without an incident delta.
    state.incidentDeck = [];
    state.activePlayerId = 0;
    bindCompetitiveSeat(state, 0);
    state.hand.push(eligibleAllEvent(400, 200));
    executeAction(state, { type: 'play-event-from-hand', handIndex: state.hand.length - 1 });
    state.phase = 'InvestmentResolution';

    const result = resolveCompetitivePendingPiggyback(state);

    expect(result).not.toBeNull();
    expect(hasPendingPiggyback(state)).toBe(false);
    // Both AI seats were auto-settled via the join-fully tier (policy): paid
    // the exact 450 charge and earned the 100% own-board reward — the sim
    // never stalls and the human seat was free of a pending prompt.
    expect(state.players![1].coins).toBe(1000 - 450 + 400);
    expect(state.players![1].reputation).toBe(200);
    expect(state.players![2].coins).toBe(1000 - 450 + 400);
    expect(state.players![2].reputation).toBe(200);
  });
});

// ── AC4: scoreboard HUD marker for a pending human decision ────────

describe('AC4 — competitive HUD surfaces a pending piggyback decision', () => {
  it('marks the human seat row as having a pending decision', () => {
    const state = compState('pb-prompt-hud', 2);
    raiseHumanDecision(state);
    const rows = buildCompetitiveScoreboard(state);
    const human = rows.find((r) => r.playerId === findHumanSeatId(state))!;
    expect(human.piggybackPending).toBe(true);
    expect(formatCompetitiveScoreboardRow(human)).toContain('decision');
  });

  it('no pending decision → no marker (formats unchanged)', () => {
    const state = compState('pb-prompt-hud-clean', 2);
    const rows = buildCompetitiveScoreboard(state);
    const human = rows.find((r) => r.playerId === findHumanSeatId(state))!;
    expect(human.piggybackPending).toBe(false);
    // Seat 0 is the active seat by default → the active-seat ▶ prefix.
    expect(formatCompetitiveScoreboardRow(human)).toBe('▶ You: 1000c 0r 0pt');
  });
});

// ── AC4: end-to-end scene walk (drive → prompt → resume) ──────────

describe('AC4 — endCompetitiveTurnDay presents the prompt before the shared closing', () => {
  it('when the human seat is pending, the day pauses on the prompt (no auto-settle)', () => {
    const state = compState('pb-prompt-endday', 2);
    raiseHumanDecision(state); // seat 1 organised; human seat pending
    state.phase = 'InvestmentResolution';
    const { tcCtx, dialogCalls } = makeSceneHarness(state);

    endCompetitiveTurnDay(tcCtx);

    // A prompt is presented instead of the shared closing being auto-settled;
    // the day stays paused on the human decision.
    expect(dialogCalls).toHaveLength(1);
    expect(hasPendingPiggyback(state)).toBe(true);
    expect(state.players![0].coins).toBe(1000); // nothing applied yet
  });

  it('the prompt callback resolves and the shared day then completes', () => {
    const state = compState('pb-prompt-endday-resolve', 2);
    raiseHumanDecision(state);
    state.phase = 'InvestmentResolution';
    const { tcCtx, dialogCalls } = makeSceneHarness(state);

    endCompetitiveTurnDay(tcCtx);
    expect(dialogCalls).toHaveLength(1);

    // The player keeps the automatic 50% share → the day continues.
    dialogCalls[0].onKeep();
    expect(hasPendingPiggyback(state)).toBe(false);
    if (state.gameResult === 'playing') {
      expect(state.phase).toBe('WeekStart');
    }
  });
});
