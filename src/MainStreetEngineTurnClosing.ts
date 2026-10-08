/**
 * Main Street: Turn Closing and End Checks
 *
 * End-of-turn processing (deferred resource application, ongoing costs,
 * incident resolution, score updates), end-condition checks, and the
 * single-player/headless turn-closing paths.
 *
 * @module
 */

import { executeAction } from './MainStreetEngineActions';
import { applyBusinessOngoingCosts, applyCommunitySpaceOngoingCosts, applyStaffOngoingCosts, declineStaffApplicant } from './MainStreetEngineCommands';
import { executeWeekStart } from './MainStreetEngineWeekStart';
import { computeEventDeltas, resolveEvent } from './MainStreetEngineEvents';
import { decideEventChoice, effectiveWinThreshold, updateCompetitiveScores, updateScore } from './MainStreetEngineScoring';
import { EndOfTurnOptions, EventChoiceResolution, PendingEndOfTurnDeltas, PlayerAction, SinglePlayerTurnClosingContext, TurnResult } from './MainStreetEngineTypes';
import { decayActiveEffects } from '@core-engine/ActiveEffect';
import { applyIncome, attachUpcomingDeltas, updateNeighborsOnClose } from './MainStreetAdjacency';
import type { BusinessCard, EventCard } from './MainStreetCards';
import { isDurationEventCard, recordIncidentDraw, findConstrainedIncidentIndex } from './MainStreetCards';
import { evaluateChallenges } from './MainStreetChallenges';
import type { DifficultyName } from './MainStreetDifficulty';
import { replenishIncidentDeck } from './MainStreetMarket';
import { computeIncidentSkillBuffs, getEmployedSpecializationSkills } from './MainStreetStaffBuffs';
import type { MainStreetState } from './MainStreetState';
import { addLog, syncResourceBankToLedger, advanceWeek, describeEventEffects, classifyEffect } from './MainStreetState';
import { recordMainStreetEvent } from './MainStreetTranscript';
import {
  getPendingStorylineOptions,
  resolveStorylineOption,
  markChoiceResolved,
  recordStorylineResolution,
  eventHasStoryline,
  createPendingStorylineChoice,
} from './MainStreetStoryline';
import { storyUpdateLine } from './MainStreetStorylineUi';

/**
 * Resolves the front Incident event from the face-down incident deck
 * (front = next to resolve). Records the draw in the incident-draw balance
 * history so subsequent constrained draws (deck rebuilds) see the resolved
 * sequence. When the deck is exhausted, Incident cards from the event deck
 * / discards reshuffle back in. Returns the resolved event or null if no
 * incident is available.
 *
 * Deferred-mutation support (CG-0MTR72P14000VO6Q): when `opts.apply === false`
 * the resource deltas are computed but NOT applied to `state.resourceBank` —
 * they are reported via `opts.deltasOut` (filled in-place) for the caller to
 * apply after the end-of-turn animations complete. The headless/AI path keeps
 * the legacy immediate-apply behaviour.
 */
export function resolveIncident(
  state: MainStreetState,
  opts?: { apply?: boolean; deltasOut?: { coinChange: number; repChange: number } },
): EventCard | null {
  // Risk Manager: -15% incident probability (I4, CG-0MT4WXV2J000M35M). When
  // employed, each turn's incident draw is averted with probability
  // probabilityReductionPct; the deck is untouched so the averted card
  // resolves next turn. Consumes one main-RNG draw while employed
  // (deterministic per seed).
  const employed = getEmployedSpecializationSkills(state);
  const incidentBuffs = computeIncidentSkillBuffs(employed);
  if (incidentBuffs.probabilityReductionPct > 0 && state.rng() < incidentBuffs.probabilityReductionPct) {
    addLog(state, 'Risk Manager averted this week\'s incident.', 'neutral');
    return null;
  }

  // Deck exhausted: reshuffle incident cards back in from the event deck /
  // event discards (existing reshuffle convention).
  if (state.incidentDeck.length === 0) {
    replenishIncidentDeck(state);
  }
  if (state.incidentDeck.length === 0) return null;

  // Runtime constraint-aware selection: pick the next incident card from the
  // face-down pool using `findConstrainedIncidentIndex`. This replaces the
  // legacy pre-ordering (`orderIncidentDeck`) — the deck is shuffled once at
  // setup/reshuffle, then each draw picks the best constrained card by index
  // without consuming any RNG (deterministic from deck order). The current
  // week gates seasonal Incidents (CG-0MTT0K9RX0004QTE / F4): an out-of-season
  // windowed card is skipped, and -1 means no incident is eligible this turn.
  const idx = findConstrainedIncidentIndex(state.incidentDeck, state.incidentBalance, state.week);
  if (idx < 0) return null; // No Incident-trigger card eligible this week.

  // Remove the chosen card by index (deck remains face-down, player sees only
  // the resolved sequence).
  const event = state.incidentDeck.splice(idx, 1)[0]!;

  // Track the draw so the balance history mirrors the resolved sequence.
  recordIncidentDraw(state.incidentBalance, event);

  // Storyline/choice event interception (CG-0MTSHG8RP008E128 AC5 /
  // MS-0MUMP93DI0018OGV): when the drawn incident presents a choice (legacy
  // `hasChoices`, or an explicit registered option list), its effect is
  // DEFERRED — stash the drawn event as `pendingEventChoice` (unresolved) and
  // return null (no effect applied, no escalation yet). The caller
  // (processEndOfTurn) pauses with TurnResult.choicePending so the UI can
  // present the option dialog; resolveEventChoice/resolveEventOption applies
  // the chosen path later. The pending choice is created through the
  // game-agnostic extraction seam. A bare `storylineId` is descriptive
  // metadata only and does NOT intercept resolution.
  if (eventHasStoryline(event)) {
    const pending = createPendingStorylineChoice(event, state);
    if (pending) {
      state.pendingEventChoice = pending;
      addLog(state, `Incident: ${event.name} — a decision is required.`, 'neutral');
      return null;
    }
  }

  // Deferred-mutation path (CG-0MTR72P14000VO6Q): compute the resource
  // deltas without mutating state. The reputation multiplier uses the
  // caller-supplied post-income reputation when provided (income normally
  // lands before the incident phase), so the deferred path reproduces the
  // legacy per-turn results exactly.
  if (opts?.apply === false) {
    // Duration events mutate activeEffects (not resourceBank): resolve now so
    // the active effect applies from this turn onward (deferred mutation
    // covers resourceBank/finalScore only).
    if (isDurationEventCard(event)) {
      resolveEvent(state, event);
    }
    const deltas = computeEventDeltas(state, event);
    if (opts.deltasOut) {
      opts.deltasOut.coinChange = deltas.coinDelta;
      opts.deltasOut.repChange = deltas.repDelta;
    }
    addLog(
      state,
      `Incident: ${event.name} (${describeEventEffects(deltas.coinDelta, deltas.repDelta)})`,
      classifyEffect(deltas.coinDelta, deltas.repDelta),
    );
    return event;
  }

  const coinsBefore = state.resourceBank.coins;
  const repBefore = state.resourceBank.reputation;
  resolveEvent(state, event);
  const coinChange = state.resourceBank.coins - coinsBefore;
  const repChange = state.resourceBank.reputation - repBefore;
  addLog(
    state,
    `Incident: ${event.name} (${describeEventEffects(coinChange, repChange)})`,
    classifyEffect(coinChange, repChange),
  );

  return event;
}

/**
 * Maps a compiled option label to the transcript/state token.
 *
 * Legacy two-option choice cards (exactly [Accept, Reject]) keep the lowercase
 * `'accept'`/`'reject'` tokens so the transcript and pending-state shape is
 * unchanged from the pre-seam engine. Generalised storylines (any other option
 * list) record the full label, lower-cased for stable matching.
 */
function legacyLabelToToken(label: string, optionCount: number): string {
  const lower = label.toLowerCase();
  if (optionCount === 2 && (lower === 'accept' || lower === 'reject')) {
    return lower;
  }
  return label;
}

/**
 * Resolves the pending storyline incident by selecting the option at the
 * given index in the card's ordered option list (generalised API, AC2).
 *
 * The option list is compiled/registered through the game-agnostic extraction
 * seam ({@link getStorylineOptions}); the chosen option's effect policy is
 * applied and its successor (if any) is pushed onto the incident deck.
 * Records the decision in the transcript and marks the pending choice
 * resolved — the deferred closing (EndCheck → next week) is completed by
 * {@link finishDeferredEndOfTurn}.
 *
 * @param state       Current game state (mutated). Must have an unresolved choice.
 * @param optionIndex Index into the ordered option list (0-based).
 * @throws Error when no unresolved choice is pending or the index is invalid.
 */
export function resolveEventOption(
  state: MainStreetState,
  optionIndex: number,
): EventChoiceResolution {
  const pending = state.pendingEventChoice;
  if (!pending) {
    throw new Error('No pending event choice to resolve.');
  }
  if (pending.resolved) {
    throw new Error(`Event choice for ${pending.event.name} is already resolved.`);
  }
  const event = pending.event;
  // Use the draw-time frozen option snapshot when present so callback
  // conditions are never re-evaluated at resolution time (AC3); fall back
  // to recompiling for legacy pending choices without a snapshot.
  const options = getPendingStorylineOptions(pending, state);
  if (options.length > 0) {
    const option = options[optionIndex];
    if (!option) {
      throw new Error(
        `No storyline option at index ${optionIndex} for ${event.name} (has ${options.length}).`,
      );
    }
    const appliesEffect = option.effectPolicy === 'apply';
    if (!appliesEffect) {
      addLog(state, `Chose to reject: ${event.name} consequences refused.`, 'neutral');
    }

    const { pushedCard, coinChange, repChange } = resolveStorylineOption(state, event, option);

    if (appliesEffect) {
      // Show the ACTUAL applied delta (CG-0MTQ7W0ZX0059R3J AC6): for the
      // proportional Tax Audit this is the real percentage amount, e.g.
      // "Chose to accept: Tax Audit (-450 coins).", using the same
      // describeEventEffects formatting as the Incident: log lines.
      addLog(
        state,
        `Chose to accept: ${event.name} (${describeEventEffects(coinChange, repChange)}).`,
        classifyEffect(coinChange, repChange),
      );
    }
    syncResourceBankToLedger(state);

    // Transcript: recorded identically for player and AI. The legacy
    // accept/reject successor ids are preserved for backward compatibility.
    // Legacy two-option cards record the lowercase token ('accept'/'reject')
    // so the transcript shape is byte-for-byte identical to the pre-seam
    // engine; generalised multi-way storylines record the full option label.
    const transcriptOption = legacyLabelToToken(option.label, options.length);
    recordStorylineResolution(
      state,
      event,
      transcriptOption,
      event.acceptNextCardId ?? null,
      event.rejectNextCardId ?? null,
    );
    // Outcome feedback (MS-0MUMP96XH002SJ89 AC2): a concise narrative
    // "story update" tied to the storyline, when the card belongs to one.
    const update = storyUpdateLine(event, transcriptOption, coinChange, repChange);
    if (update) {
      addLog(state, update, classifyEffect(coinChange, repChange));
    }

    markChoiceResolved(pending, transcriptOption);
    return { event, option: transcriptOption, coinChange, repChange, pushedCard };
  }

  // Legacy fallback: an event staged as a pending choice without any compiled
  // option list (e.g. a synthetic non-choice card in an existing test, or a
  // legacy save hand-crafted into the pending state). Preserve the original
  // accept/reject semantics exactly: index 0 applies the effect, index 1
  // skips it, and the legacy successor ids drive the deck push.
  const appliesEffect = optionIndex === 0;
  if (!appliesEffect) {
    addLog(state, `Chose to reject: ${event.name} consequences refused.`, 'neutral');
  }
  const { pushedCard, coinChange, repChange } = resolveStorylineOption(state, event, {
    label: appliesEffect ? 'Accept' : 'Reject',
    successorId: appliesEffect ? event.acceptNextCardId : event.rejectNextCardId,
    effectPolicy: appliesEffect ? 'apply' : 'skip',
  });
  if (appliesEffect) {
    addLog(
      state,
      `Chose to accept: ${event.name} (${describeEventEffects(coinChange, repChange)}).`,
      classifyEffect(coinChange, repChange),
    );
  }
  syncResourceBankToLedger(state);
  recordStorylineResolution(
    state,
    event,
    appliesEffect ? 'accept' : 'reject',
    event.acceptNextCardId ?? null,
    event.rejectNextCardId ?? null,
  );
  // Outcome feedback (MS-0MUMP96XH002SJ89 AC2): story update when applicable.
  const fallbackUpdate = storyUpdateLine(
    event,
    appliesEffect ? 'accept' : 'reject',
    coinChange,
    repChange,
  );
  if (fallbackUpdate) {
    addLog(state, fallbackUpdate, classifyEffect(coinChange, repChange));
  }
  markChoiceResolved(pending, appliesEffect ? 'accept' : 'reject');
  return { event, option: appliesEffect ? 'accept' : 'reject', coinChange, repChange, pushedCard };
}

/**
 * Resolves a pending dual-choice incident (CG-0MTSHG8RP008E128 AC8/AC9).
 *
 * Accept applies the event's effect (via resolveEvent) then pushes the
 * `acceptNextCardId` escalation onto the incident deck. Reject skips the
 * effect entirely and pushes the `rejectNextCardId` escalation instead.
 *
 * This is a thin backward-compatible wrapper over {@link resolveEventOption}:
 * legacy choice cards compile to the ordered list [Accept, Reject] — index 0
 * applies the effect, index 1 skips it — so behaviour is byte-for-byte
 * equivalent to the previous inline handling, including the lowercase
 * `chosenOption` token stored on the pending state.
 *
 * @param state  Current game state (mutated). Must have a pending unresolved choice.
 * @param option The player's decision.
 * @throws Error when no unresolved choice is pending.
 */
export function resolveEventChoice(
  state: MainStreetState,
  option: 'accept' | 'reject',
): EventChoiceResolution {
  const pending = state.pendingEventChoice;
  if (!pending) {
    throw new Error('No pending event choice to resolve.');
  }
  if (pending.resolved) {
    throw new Error(`Event choice for ${pending.event.name} is already resolved.`);
  }
  const optionIndex = option === 'accept' ? 0 : 1;
  const result = resolveEventOption(state, optionIndex);
  // Preserve the legacy lowercase token on the pending state for backward
  // compatibility with existing snapshots/UI expectations.
  pending.chosenOption = option;
  return { ...result, option };
}

/**
 * Resolves a pending dual-choice incident using the difficulty-based policy
 * (from `state.config.difficultyName`, or an explicit override) and completes
 * the deferred closing (EndCheck → next week). Headless/AI turns never stall:
 * executeFullTurn, MainStreetAiPlayer.playGame and the Monte Carlo harness
 * call this automatically. Records the decision via resolveEventChoice
 * (identical transcript shape to a player choice).
 *
 * @param state      Current game state (mutated). No-op when nothing pending.
 * @param difficulty Optional override; defaults to state.config.difficultyName.
 * @returns The completed closing TurnResult, or null when nothing was pending.
 */
export function resolvePendingEventChoice(
  state: MainStreetState,
  difficulty?: DifficultyName,
): TurnResult | null {
  const pending = state.pendingEventChoice;
  if (!pending || pending.resolved) return null;
  const option = decideEventChoice(state, pending.event, difficulty ?? state.config.difficultyName);
  resolveEventChoice(state, option);
  return finishDeferredEndOfTurn(state);
}

/**
 * Processes the end of the MarketPhase (after player clicks End Turn).
 * Runs through all remaining phases automatically:
 *   InvestmentResolution -> IncomePhase -> IncidentPhase -> EndCheck
 *
 * @param state Current game state.
 * @param opts  Optional deferred-mutation option (see {@link EndOfTurnOptions}).
 * @returns TurnResult with income, incident, game result, and pending deltas.
 */
export function processEndOfTurn(state: MainStreetState, opts?: EndOfTurnOptions): TurnResult {
  // Deferred-mutation mode: `apply:false` is passed down to the income /
  // cost / incident helpers so they compute deltas without mutating
  // resourceBank; the closing tail is deferred to finishDeferredTurnClosing.
  const deferred = opts?.deferResourceApplication === true;
  const applyOpts = deferred ? { apply: false as const } : undefined;
  // Net end-of-turn resource deltas accumulated for TurnResult (legacy mode
  // derives them from pre/post state diffs instead).
  let pendingCoinDelta = 0;
  let pendingRepDelta = 0;
  const coinsAtTurnStart = state.resourceBank.coins;
  const repAtTurnStart = state.resourceBank.reputation;
  const scoreAtTurnStart = state.finalScore;

  // AC7 (CG-0MTSHG8RP008E128): while a dual-choice incident is pending and
  // unresolved, the closing sequence must NOT proceed to IncomePhase — the
  // player's decision comes first. Returns a choicePending result instead of
  // throwing so stray/re-entrant end-turn calls stay deterministic.
  if (state.pendingEventChoice && !state.pendingEventChoice.resolved) {
    return {
      income: null,
      incident: null,
      incidentCoinChange: 0,
      incidentRepChange: 0,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges: [],
      choicePending: true,
      pendingCoinDelta: 0,
      pendingRepDelta: 0,
      pendingScoreDelta: 0,
    };
  }
  if (state.phase !== 'MarketPhase') {
    throw new Error(`Cannot end turn during ${state.phase}. Must be in MarketPhase.`);
  }

  // Auto-decline pending applicant at end of turn (CG-0MSTOATDU006UGAX).
  // If the player didn't respond to the applicant, decline automatically.
  const pending = (state as any).pendingApplicant;
  if (pending) {
    declineStaffApplicant(state);
  }

  // The turn being summarised by the net row (turn is incremented below on
  // a continuing game, so capture it before that happens).
  const turnEnded = state.turn;

  // Phase: InvestmentResolution
  // Held Investment events are NO LONGER auto-resolved. The player must
  // actively play them by clicking during the MarketPhase. Unplayed events
  // persist across turns.
  state.phase = 'InvestmentResolution';

  // Check for immediate loss before income (e.g. coins already < 0 from
  // purchases, or rep already <= 0 at turn > 1). The game-over banner is
  // emitted first, then the per-turn net row as the final entry so the
  // summary remains the authoritative closing record even on premature
  // exits (CG-0MTJP6XU5009KN5L fixes inverted ordering).
  if (checkImmediateLoss(state)) {
    appendTurnNetRow(state, turnEnded);
    return {
      income: null,
      incident: null,
      incidentCoinChange: 0,
      incidentRepChange: 0,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges: [],
      choicePending: false,
      pendingCoinDelta: 0,
      pendingRepDelta: 0,
      pendingScoreDelta: 0,
    };
  }

  // Phase: IncomePhase
  state.phase = 'IncomePhase';
  const income = applyIncome(state, applyOpts);

  // Apply staff card ongoing costs (Multi-Use Card Economy)
  const staffDelta = applyStaffOngoingCosts(state, applyOpts);

  // Apply community space ongoing costs (reputation-asset cards, e.g. Library)
  const communityDelta = applyCommunitySpaceOngoingCosts(state, applyOpts);

  // Apply business card ongoing costs (street-placed cards only)
  const businessDelta = applyBusinessOngoingCosts(state, applyOpts);

  // Phase: IncidentPhase
  state.phase = 'IncidentPhase';
  // Capture the incident's own resource deltas (negative = loss) for the
  // incident-reveal presentation (dramatic sting + damage feedback). In
  // deferred mode the deltas are computed without mutation via
  // resolveIncident's `deltasOut`; in legacy mode they are derived from the
  // pre/post state diff.
  const incidentDeltasOut = deferred ? { coinChange: 0, repChange: 0 } : null;
  const coinsBeforeIncident = state.resourceBank.coins;
  const repBeforeIncident = state.resourceBank.reputation;
  const incident = resolveIncident(
    state,
    deferred ? { apply: false, deltasOut: incidentDeltasOut ?? undefined } : undefined,
  );
  const incidentCoinChange = deferred
    ? incidentDeltasOut!.coinChange
    : state.resourceBank.coins - coinsBeforeIncident;
  const incidentRepChange = deferred
    ? incidentDeltasOut!.repChange
    : state.resourceBank.reputation - repBeforeIncident;

  // Upcoming-card flow metadata (CG-0MUA1UH3A008M4BS): decorate the income
  // phase breakdown with the incident's coin/reputation deltas, tagged by
  // attachment (source `EventCard.target`), so the phased `upcoming` animation
  // can route each flow to the affected business card or the HUD totals.
  // Presentational only — never changes `state`, the transcript, or the
  // credited totals (`creditedIncomeTotal` excludes `upcomingDeltas`).
  if (incident) {
    try {
      attachUpcomingDeltas(income, state, incident, incidentCoinChange, incidentRepChange);
    } catch { /* presentation-only — never break the closing */ }
  }

  if (deferred) {
    pendingCoinDelta =
      (income?.coinDelta ?? 0) + staffDelta + communityDelta + businessDelta + incidentCoinChange;
    pendingRepDelta = (income?.repDelta ?? 0) + incidentRepChange;
  }

  // Dual-choice pause (CG-0MTSHG8RP008E128 AC7): when the drawn incident set a
  // `pendingEventChoice` (resolveIncident deferred the effect), stop the closing
  // sequence BEFORE EndCheck and return choicePending so the UI presents the
  // Accept/Reject dialog. The deferred closing then runs via resolveEventChoice
  // (apply the path) + finishDeferredEndOfTurn (EndCheck → next week).
  if (state.pendingEventChoice && !state.pendingEventChoice.resolved) {
    // Deferred mode: the income deltas are NOT yet in state — the scene
    // applies them (applyEndOfTurnDeltas) when presenting the dialog so the
    // paused turn's income matches the legacy UX (income lands at pause).
    return {
      income,
      incident: null,
      incidentCoinChange: 0,
      incidentRepChange: 0,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges: [],
      choicePending: true,
      pendingCoinDelta,
      pendingRepDelta,
      pendingScoreDelta: 0,
      // The paused turn's income deltas are un-applied in deferred mode — the
      // scene applies them (idempotently) so the income lands when the turn
      // pauses, exactly as in the legacy UX.
      requiresDeferredClosing: true,
    };
  }

  // Deferred mode (CG-0MTR72P14000VO6Q): the turn's resource deltas are
  // returned un-applied; the scene runs the closing tail via
  // finishDeferredTurnClosing after the income / incident animations land.
  // gameResult / finalScore stay at their pre-turn values (the closing
  // recomputes them post-application).
  if (deferred) {
    return {
      income,
      incident,
      incidentCoinChange,
      incidentRepChange,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges: [],
      choicePending: false,
      pendingCoinDelta,
      pendingRepDelta,
      pendingScoreDelta: 0, // challenges evaluated at closing (safety net; normally completed per-action)
      requiresDeferredClosing: true,
    };
  }

  // EndCheck + decay + challenges + advance (shared with the deferred path).
  const closed = runSinglePlayerTurnClosing(state, {
    income,
    incident,
    incidentCoinChange,
    incidentRepChange,
    turnEnded,
  });
  // Legacy mode: derive the end-of-turn deltas from the applied state.
  closed.pendingCoinDelta = state.resourceBank.coins - coinsAtTurnStart;
  closed.pendingRepDelta = state.resourceBank.reputation - repAtTurnStart;
  closed.pendingScoreDelta = state.finalScore - scoreAtTurnStart;
  return closed;
}

/**
 * Applies pending end-of-turn deltas to `state.resourceBank` and
 * `state.finalScore` (CG-0MTR72P14000VO6Q).
 *
 * This is the single point of application for deferred mutations —
 * called by the headless path immediately after `processEndOfTurn()`,
 * and by the scene layer after end-of-turn animations complete.
 *
 * @param state  Current game state (mutated in-place).
 * @param deltas  The pending deltas to apply (from `TurnResult`).
 */
export function applyEndOfTurnDeltas(
  state: MainStreetState,
  deltas: PendingEndOfTurnDeltas,
): void {
  // Apply coin and reputation deltas to the resource bank.
  state.resourceBank.coins += deltas.pendingCoinDelta ?? 0;
  state.resourceBank.reputation += deltas.pendingRepDelta ?? 0;
  // Sync the ledger to keep it consistent with resourceBank.
  syncResourceBankToLedger(state);
  // Update the score to reflect the new resource values.
  updateScore(state);
}

/**
 * Computes and appends the per-turn net summary row to the activity log:
 * the effective (post-mitigation) coin/reputation deltas for the turn just
 * played, measured against the day-start snapshot (CG-0MT5W7UJJ0065MEZ AC3).
 *
 * @param state     Current game state (mutated in-place — appends to the log).
 * @param turnEnded The turn number the row summarises (the turn just played).
 */
export function appendTurnNetRow(state: MainStreetState, turnEnded: number): void {
  // Fall back to the current resources if no snapshot exists (defensive:
  // processEndOfTurn is only reachable from MarketPhase, i.e. after a
  // day start, so the snapshot is normally always present).
  const startCoins = state.weekStartCoins ?? state.resourceBank.coins;
  const startRep = state.weekStartRep ?? state.resourceBank.reputation;
  const startScore = state.weekStartScore ?? state.finalScore;
  const deltaCoins = state.resourceBank.coins - startCoins;
  const deltaRep = state.resourceBank.reputation - startRep;
  const deltaScore = state.finalScore - startScore;

  // Delta summary line: Turn N net: +X coins, +Y rep (score: +Z)
  addLog(
    state,
    `Turn ${turnEnded} net: ${describeEventEffects(deltaCoins, deltaRep)} (score: ${deltaScore > 0 ? '+' : ''}${deltaScore})`,
    classifyEffect(deltaCoins, deltaRep),
  );

  // Totals line: Turn N: X coins, Y rep, Z score
  addLog(
    state,
    `Turn ${turnEnded} totals: ${Math.round(state.resourceBank.coins)} coins, ${Math.round(state.resourceBank.reputation)} rep, ${state.finalScore} score`,
    'neutral',
  );
}

export function checkEndConditions(state: MainStreetState): boolean {
  // First check immediate loss conditions
  if (checkImmediateLoss(state)) return true;

  // Compute current score
  updateScore(state);

  // Win: all challenges complete (only if there are active challenges)
  if (
    state.activeChallenges.length > 0 &&
    state.activeChallenges.every(ac => ac.completed)
  ) {
    state.gameResult = 'win';
    state.endReason = 'all_challenges';
    addLog(state, 'Victory: All challenges completed!', 'gain');
    return true;
  }

  // Score threshold — endless-mode branch (CG-0MTIILU5V006GCN4)
  if (state.finalScore >= state.config.winThreshold) {
    if (state.config.endlessMode) {
      // Already declared and accepted: keep playing. `score_threshold_continue`
      // is the "winner declared but still playing" marker; once the player
      // accepts the offer `gameResult` is `'playing'` and scoring continues.
      if (state.endReason === 'score_threshold_continue') {
        return false;
      }
      // First crossing: declare the win and open the endless-continuation
      // offer. Play pauses here so the end-game overlay can present the
      // "Enter Endless Mode" action; accepting it calls
      // `continueAfterThreshold`, declining leaves the declared win.
      state.gameResult = 'win';
      state.endReason = 'score_threshold_continue';
      addLog(
        state,
        `Victory: Score threshold reached (${state.finalScore} pts) — enter endless mode to keep playing.`,
        'gain',
      );
      return true;
    }
    // Non-endless (default): threshold wins end the game.
    state.gameResult = 'win';
    state.endReason = 'score_threshold';
    addLog(state, `Victory: Score threshold reached (${state.finalScore} pts)`, 'gain');
    return true;
  }

  // Turn limit reached (opt-in: only fires when a config explicitly sets
  // maxTurns; default presets are unlimited, CG-0MSLXJCHH001DLIO).
  //
  // Accepted stalemate behaviour: with no turn limit and no deck-exhaustion
  // end condition, a player who keeps coins >= 0 and reputation > 0 can pass
  // turns indefinitely without winning — passive play simply never reaches
  // the score threshold. This is a deliberate design choice (no forced end);
  // the turn-based end path remains available to opt-in configs.
  if (state.config.maxTurns !== undefined && state.turn >= state.config.maxTurns) {
    // Turn-limit victory: positive reputation and coins >= 0
    if (state.resourceBank.reputation > 0 && state.resourceBank.coins >= 0) {
      state.gameResult = 'win';
      state.endReason = 'turn_limit_victory';
      addLog(state, `Victory: Survived ${state.config.maxTurns} turns (${state.finalScore} pts)`, 'gain');
      return true;
    }

    // Turn exhaustion: no win condition met
    state.gameResult = 'loss';
    state.endReason = 'turn_exhaustion';
    addLog(state, `Game Over: Turn limit exhausted`, 'loss');
    return true;
  }

  return false;
}

// ── Full Turn Execution ─────────────────────────────────────

/**
 * Executes the WeekStart phase:
 * - Increments turn counter (except turn 1).
 * - Refills the market (unless skipMarketRefill is true, e.g., checkpoint resume).
 * - Transitions to MarketPhase.
 *
 * @param state             Current game state (mutated in-place).
 * @param skipMarketRefill  When true, skips refillMarket. Used during
 *                          checkpoint resume to preserve saved market state.
 */

/**
 * Checks for immediate loss conditions (can happen mid-turn).
 * - Bankruptcy: coins < 0
 * - Reputation collapse: reputation <= 0 (but not on turn 1 where it starts at 0)
 *
 * @returns true if a loss condition was detected and set.
 */
export function checkImmediateLoss(state: MainStreetState): boolean {
  if (state.resourceBank.coins < 0) {
    state.gameResult = 'loss';
    state.endReason = 'bankruptcy';
    updateScore(state);
    addLog(state, `Game Over: Bankruptcy (coins: ${state.resourceBank.coins})`, 'loss');
    return true;
  }

  // Reputation collapse: only after turn 1 (reputation starts at 0)
  if (state.turn > 1 && state.resourceBank.reputation <= 0) {
    state.gameResult = 'loss';
    state.endReason = 'reputation_collapse';
    updateScore(state);
    addLog(state, `Game Over: Reputation collapse (rep: ${state.resourceBank.reputation})`, 'loss');
    return true;
  }

  return false;
}

/**
 * Per-seat competitive failure reason (mirrors the single-player
 * {@link checkImmediateLoss} loss conditions).
 */
export type CompetitiveSeatFailureReason = 'bankruptcy' | 'reputation_collapse';

/** A single competitive seat's failure, attributed to that seat only. */
export interface CompetitiveSeatFailure {
  /** Owner index (index into `state.players`). */
  playerId: number;
  /** Which loss condition the seat hit. */
  reason: CompetitiveSeatFailureReason;
}

/**
 * Evaluates competitive end-condition failures **per seat** rather than from
 * the shared `state.resourceBank` scratch mirror.
 *
 * In competitive mode `bindCompetitiveSeat` / `restoreCompetitiveSeat` mirror
 * the acting seat into the shared bank but never reset it, so at closing time
 * `state.resourceBank` holds the **last-acting** (usually AI) wallet. Reading
 * it for game-over decisions therefore ended the whole game when an AI seat
 * collapsed — even when the human seat was healthy (MS-0MUVBH589001L7NL).
 *
 * Thresholds match the single-player semantics:
 * - `coins < 0` — bankruptcy (any turn); there is **no** `coins == 0` end
 *   condition.
 * - `reputation <= 0` — reputation collapse, only after turn 1 (reputation
 *   starts at 0 on turn 1).
 *
 * @param state Current game state (read-only).
 * @returns The failing seat(s) with their reason; empty for single-player
 *          state (no `players[]`) or when every seat is solvent.
 */
export function checkCompetitiveSeatFailure(state: MainStreetState): CompetitiveSeatFailure[] {
  if (!state.players || state.players.length === 0) return [];
  const failures: CompetitiveSeatFailure[] = [];
  for (const player of state.players) {
    // Eliminated seats are already out of play — they no longer fail.
    if (player.eliminated) continue;
    if (player.coins < 0) {
      failures.push({ playerId: player.playerId, reason: 'bankruptcy' });
    } else if (state.turn > 1 && player.reputation <= 0) {
      failures.push({ playerId: player.playerId, reason: 'reputation_collapse' });
    }
  }
  return failures;
}

/**
 * Closes every street slot owned by a seat as a **direct grid/discard
 * operation**: no action cost and no wallet change. The card (if any) is
 * pushed to the unified discard pile, the slot is emptied, the
 * `ownerTaggedGrid` tag is cleared and neighbouring income/reputation/synergy
 * caches are recalculated so the cancelled cards no longer contribute.
 *
 * @param state    Current game state (mutated in-place).
 * @param playerId Owner index whose businesses are being closed.
 * @returns The number of cards actually removed from the grid.
 */
export function closeEliminatedSeatBusinesses(
  state: MainStreetState,
  playerId: number,
): number {
  if (!state.ownerTaggedGrid) return 0;
  let closed = 0;
  for (let slotIndex = 0; slotIndex < state.ownerTaggedGrid.length; slotIndex++) {
    const tag = state.ownerTaggedGrid[slotIndex];
    if (!tag || tag.ownerId !== playerId) continue;

    const card = state.streetGrid[slotIndex];
    if (card !== null) {
      // Remove the card entirely (including sold inert anchors) so it no
      // longer contributes income, reputation or adjacency synergy.
      state.discardPile.push(card as unknown as BusinessCard);
      state.streetGrid[slotIndex] = null;
      state.soldSlots[slotIndex] = false;
      updateNeighborsOnClose(state, slotIndex);
      closed += 1;
    }
    state.ownerTaggedGrid[slotIndex] = { card: null, ownerId: null };
  }
  return closed;
}

/**
 * Eliminates a competitive seat (MS-0MUVQRBVI0015AB2): marks it
 * `eliminated = true` and closes its owned businesses/community spaces.
 * Idempotent — a seat already eliminated is a no-op.
 *
 * @param state    Current game state (mutated in-place).
 * @param playerId Owner index to eliminate.
 * @returns The number of businesses closed (0 when already eliminated).
 */
export function eliminateCompetitiveSeat(
  state: MainStreetState,
  playerId: number,
): number {
  const player = state.players?.[playerId];
  if (!player || player.eliminated) return 0;
  player.eliminated = true;
  const closed = closeEliminatedSeatBusinesses(state, playerId);
  addLog(
    state,
    `AI ${playerId} eliminated — ${closed} business${closed === 1 ? '' : 'es'} closed`,
    'loss',
  );
  return closed;
}

/**
 * The human seat's owner index (resolved via `controller === 'human'`), or
 * `-1` when no human seat exists. Used so last-standing does not hard-code
 * seat 0 (MS-0MUVQRCQJ00737UV AC7).
 */
export function findHumanSeatId(state: MainStreetState): number {
  const players = state.players ?? [];
  const idx = players.findIndex(p => p.controller === 'human');
  return idx;
}

/**
 * Declares the human the winner by last-standing when every AI seat has been
 * eliminated (MS-0MUVQRCQJ00737UV).
 *
 * Idempotent: once `endReason` is `last_standing` / `last_standing_continue`
 * the win is not re-declared (and the continue-solo offer is not re-shown on
 * every subsequent closing). Returns `true` when the win was declared.
 */
export function checkLastStanding(state: MainStreetState): boolean {
  if (!state.players || state.players.length === 0) return false;
  // Already declared / already continued — never re-declare (AC5).
  if (state.endReason === 'last_standing' || state.endReason === 'last_standing_continue') {
    return false;
  }
  // Any surviving AI seat means the game is not yet last-standing.
  const aiRemaining = state.players.some(
    p => p.controller === 'ai' && !p.eliminated,
  );
  if (aiRemaining) return false;
  // Only a game that started with AI opponents can end by last-standing
  // (a single-human N=1 competitive state must keep its legacy behaviour).
  const hadAi = state.players.some(p => p.controller === 'ai');
  if (!hadAi) return false;
  const humanId = findHumanSeatId(state);
  if (humanId < 0) return false;
  const human = state.players[humanId];
  if (!human || human.eliminated) return false;

  state.gameResult = 'win';
  state.endReason = 'last_standing';
  state.competitiveWinnerId = humanId;
  addLog(state, `Victory: Player ${humanId} wins by last standing!`, 'gain');
  return true;
}

/**
 * Accepts the continue-solo offer after a last-standing win
 * (MS-0MUVQRCQJ00737UV). Resumes play at the next shared week with
 * `gameResult = 'playing'` and `endReason = 'last_standing_continue'`,
 * mirroring the endless-mode `score_threshold_continue` continuation.
 *
 * Idempotent — a no-op unless the offer is open (`endReason ===
 * 'last_standing'`).
 *
 * @returns `true` when play resumed, `false` when no offer was open.
 */
export function continueAfterLastStanding(state: MainStreetState): boolean {
  if (state.endReason !== 'last_standing') return false;
  state.gameResult = 'playing';
  state.endReason = 'last_standing_continue';
  // Advance to the next shared week so the resumed day starts cleanly
  // (mirrors finishCompetitiveClosingTail's continue branch).
  state.turn += 1;
  advanceWeek(state);
  const bankable = Math.min(state.actionsRemaining, 1);
  state.bankedActions = Math.min(2, (state.bankedActions ?? 0) + bankable);
  state.phase = 'WeekStart';
  state.activePlayerId = Math.max(0, findHumanSeatId(state));
  addLog(state, 'Continuing solo after last-standing win.', 'neutral');
  return true;
}

/**
 * Accepts the endless-continuation offer after the score threshold is
 * reached with `config.endlessMode === true` (CG-0MTIILU5V006GCN4).
 *
 * Resumes play at the next shared week with `gameResult = 'playing'` while
 * keeping `endReason = 'score_threshold_continue'` as the winner-declared
 * marker so later EndChecks do not re-open the offer. Mirrors
 * {@link continueAfterLastStanding} (the continue-solo path).
 *
 * Idempotent — a no-op unless the offer is open (`endReason ===
 * 'score_threshold_continue'`).
 *
 * @returns `true` when play resumed, `false` when no offer was open.
 */
export function continueAfterThreshold(state: MainStreetState): boolean {
  if (state.endReason !== 'score_threshold_continue') return false;
  // Idempotent: once accepted `gameResult` is `'playing'`; never advance twice.
  if (state.gameResult === 'playing') return false;
  state.gameResult = 'playing';
  // Advance to the next shared week so the resumed day starts cleanly
  // (mirrors continueAfterLastStanding).
  state.turn += 1;
  advanceWeek(state);
  const bankable = Math.min(state.actionsRemaining, 1);
  state.bankedActions = Math.min(2, (state.bankedActions ?? 0) + bankable);
  state.phase = 'WeekStart';
  state.activePlayerId = Math.max(0, findHumanSeatId(state));
  addLog(state, 'Continuing in endless mode after the threshold win.', 'neutral');
  return true;
}

/**
 * Applies the competitive per-seat failure evaluation to the game result.
 *
 * A failing **human** seat keeps the existing single-player loss semantics
 * (`gameResult = 'loss'` with `bankruptcy` / `reputation_collapse`). A failing
 * **AI** seat is eliminated (marked `eliminated` and its businesses closed)
 * and does **not** end the game; when the last AI is eliminated the human is
 * declared the winner by last-standing.
 *
 * @param state Current game state (mutated on a human failure / AI elimination).
 * @returns `true` when the game ended / a win was declared, `false` otherwise.
 */
export function resolveCompetitiveSeatFailures(state: MainStreetState): boolean {
  const failures = checkCompetitiveSeatFailure(state);
  if (failures.length === 0) {
    // No new failures — but a prior elimination may have left the human as the
    // last seat standing (idempotent: returns false once already declared).
    return checkLastStanding(state);
  }

  // A human seat failure keeps the existing single-player loss semantics.
  const humanFailure = failures.find(
    failure => state.players![failure.playerId].controller !== 'ai',
  );
  if (humanFailure) {
    state.gameResult = 'loss';
    state.endReason = humanFailure.reason;
    updateScore(state);
    const label = humanFailure.reason === 'bankruptcy' ? 'Bankruptcy' : 'Reputation collapse';
    addLog(state, `Game Over: ${label} (Player ${humanFailure.playerId})`, 'loss');
    return true;
  }

  // AI seat failure(s): eliminate the seat(s) and let the survivors play on.
  for (const failure of failures) {
    eliminateCompetitiveSeat(state, failure.playerId);
  }
  // Declare last-standing if no AI seats survive (idempotent).
  return checkLastStanding(state);
}

/**
 * Checks for end-of-turn win/loss conditions (at EndCheck phase).
 *
 * Win conditions (checked in order):
 * 1. All challenges complete (activeChallenges.length > 0 and all completed)
 * 2. Score threshold: finalScore >= config.winThreshold — unless endless
 *    mode is enabled (`config.endlessMode === true`, CG-0MTIILU5V006GCN4).
 *    In endless mode the threshold declares the win and opens the endless-
 *    continuation offer: `gameResult` is `'win'` and `endReason` is
 *    `score_threshold_continue` until the player accepts the offer via
 *    {@link continueAfterThreshold}, at which point `gameResult` returns to
 *    `'playing'` and scoring continues.
 * 3. Turn limit (opt-in): turn >= config.maxTurns with positive reputation and
 *    coins >= 0 — only fires when a config explicitly sets `maxTurns`
 *    (default presets impose no turn limit, CG-0MSLXJCHH001DLIO).
 *
 * Loss conditions:
 * 1. Bankruptcy (already checked by checkImmediateLoss)
 * 2. Reputation collapse (already checked)
 * 3. Turn exhaustion (opt-in): turn >= config.maxTurns and no win condition
 *    met — only fires when a config explicitly sets `maxTurns`.
 *
 * @returns true when the game ends, or when endless mode pauses at the
 *          threshold to offer continuation; false while play continues
 *          after the offer is accepted.
 */

/**
 * Competitive EndCheck — first to threshold (CG-0MT5X3GMA007EG30).
 *
 * Scores every PlayerRecord via per-owner coins+rep+challenges; the
 * shared ledger/finalScore is kept in sync as max-per-player so headless
 * consumers still read one score. The first player whose per-owner score
 * reaches `config.winThreshold` wins in player-index order (lowest index
 * wins on a tie in the same EndCheck). The winner is stored as
 * `competitiveWinnerId`.
 *
 * Endless mode (`config.endlessMode === true`, CG-0MTIILU5V006GCN4): the first
 * player to reach the threshold is declared the winner but the game pauses
 * with the endless-continuation offer (`endReason = 'score_threshold_continue'`)
 * instead of ending. Accepting via {@link continueAfterThreshold} returns
 * `gameResult` to `'playing'` and scoring continues; the marker is kept so
 * later EndChecks do not re-open the offer.
 *
 * In single-player (no players[]), delegates to the legacy checkEndConditions.
 */
export function checkCompetitiveEndConditions(state: MainStreetState): boolean {
  if (!state.players || state.players.length === 0) {
    return checkEndConditions(state);
  }

  if (resolveCompetitiveSeatFailures(state)) return true;

  updateCompetitiveScores(state);

  // The human seat index (or -1 when none). A win by any other seat is a
  // loss for the human player (MS-0MUX6PMCE002I6HO AC1).
  const humanIdx = findHumanSeatId(state);

  // Win: all challenges complete — shared milestone; lowest-index player takes it.
  if (
    state.activeChallenges.length > 0 &&
    state.activeChallenges.every(ac => ac.completed)
  ) {
    const winnerIdx = 0;
    const isHumanWin = winnerIdx === humanIdx;
    state.gameResult = isHumanWin ? 'win' : 'loss';
    state.endReason = 'all_challenges';
    state.competitiveWinnerId = winnerIdx;
    addLog(
      state,
      `${isHumanWin ? 'Victory' : 'Defeat'}: All challenges completed! (Player ${winnerIdx})`,
      isHumanWin ? 'gain' : 'loss',
    );
    return true;
  }

  const effectiveThreshold = effectiveWinThreshold(state);
  for (let i = 0; i < state.players.length; i++) {
    if (state.players[i].score >= effectiveThreshold) {
      const isHumanWin = i === humanIdx;
      // Endless mode: declare the first-to-threshold winner but pause with
      // the endless-continuation offer instead of ending the match.
      if (state.config.endlessMode) {
        if (state.endReason === 'score_threshold_continue') {
          return false;
        }
        state.gameResult = isHumanWin ? 'win' : 'loss';
        state.endReason = 'score_threshold_continue';
        state.competitiveWinnerId = i;
        addLog(
          state,
          `${isHumanWin ? 'Victory' : 'Defeat'}: Player ${i} reached threshold (${effectiveThreshold} pts, score ${state.players[i].score}) — enter endless mode to keep playing.`,
          isHumanWin ? 'gain' : 'loss',
        );
        return true;
      }
      state.gameResult = isHumanWin ? 'win' : 'loss';
      state.endReason = 'score_threshold';
      state.competitiveWinnerId = i;
      addLog(
        state,
        `${isHumanWin ? 'Victory' : 'Defeat'}: Player ${i} reached threshold (${effectiveThreshold} pts, score ${state.players[i].score})`,
        isHumanWin ? 'gain' : 'loss',
      );
      return true;
    }
  }

  if (state.config.maxTurns !== undefined && state.turn >= state.config.maxTurns) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < state.players.length; i++) {
      if (state.players[i].score > bestScore) {
        bestScore = state.players[i].score;
        bestIdx = i;
      }
    }
    if (
      bestIdx !== -1 &&
      state.players[bestIdx].reputation > 0 &&
      state.players[bestIdx].coins >= 0
    ) {
      const isHumanWin = bestIdx === humanIdx;
      state.gameResult = isHumanWin ? 'win' : 'loss';
      state.endReason = 'turn_limit_victory';
      state.competitiveWinnerId = bestIdx;
      addLog(
        state,
        `${isHumanWin ? 'Victory' : 'Defeat'}: Player ${bestIdx} survived ${state.config.maxTurns} turns (${bestScore} pts)`,
        isHumanWin ? 'gain' : 'loss',
      );
      return true;
    }
    state.gameResult = 'loss';
    state.endReason = 'turn_exhaustion';
    state.competitiveWinnerId = null;
    addLog(state, 'Game Over: Turn limit exhausted', 'loss');
    return true;
  }

  return false;
}

/** Recomputes every PlayerRecord.score and syncs the shared ledger/finalScore. */

/**
 * Ends the current MarketPhase for a HEADLESS / AI / test turn and returns
 * the completed result (CG-0MTT7FC7A000AA58 Q1).
 *
 * Wraps processEndOfTurn and, when the drawn incident was a dual-choice event
 * (result.choicePending), automatically resolves the choice via the
 * difficulty-based policy (config.difficultyName) and completes the deferred
 * closing — so headless sims never stall waiting for dialog input.
 * Interactive callers (the scene's TurnController) use processEndOfTurn
 * directly: they present the Accept/Reject dialog and resolve via
 * resolveEventChoice + finishDeferredEndOfTurn.
 *
 * @param state Current game state (mutated). Must be in MarketPhase.
 * @returns The completed turn result (choicePending is always false).
 */
export function endTurnHeadless(state: MainStreetState): TurnResult {
  const result = processEndOfTurn(state);
  if (!result.choicePending) return result;
  const finished = resolvePendingEventChoice(state);
  if (!finished) return result;
  // Surface the income that was already applied in the paused turn; the
  // deferred closing (finish) reports income null.
  return { ...finished, income: result.income };
}

/**
 * Runs a complete turn cycle:
 * 1. WeekStart (refill market)
 * 2. Execute all player actions
 * 3. Process end of turn (events, income, night, end check)
 *
 * This is a convenience function for headless/AI gameplay.
 *
 * @param state   Current game state.
 * @param actions List of player actions to execute during MarketPhase.
 * @returns TurnResult.
 */
export function executeFullTurn(
  state: MainStreetState,
  actions: PlayerAction[],
): TurnResult {
  // WeekStart
  executeWeekStart(state);

  // Execute player actions, accumulating any challenges completed mid-turn
  // by per-action evaluation (CG-0MU37CKRR008252I).
  const midTurnCompleted: string[] = [];
  for (const action of actions) {
    if (action.type === 'end-turn') break;
    executeAction(state, action);
    if (state._newlyCompletedThisAction?.length) {
      midTurnCompleted.push(...state._newlyCompletedThisAction);
    }
  }

  // Process end of turn (headless: auto-resolves any dual-choice incident)
  const result = endTurnHeadless(state);

  // Surface mid-turn completions through the TurnResult so headless/AI
  // callers observe the same completion set as the interactive scene. The
  // end-of-turn safety net only reports *additional* (closing-phase)
  // completions, so the union is de-duplicated defensively.
  if (midTurnCompleted.length > 0) {
    result.newlyCompletedChallenges = [
      ...new Set([...midTurnCompleted, ...result.newlyCompletedChallenges]),
    ];
  }

  return result;
}

/**
 * Completes the deferred closing of a single-player turn after a dual-choice
 * incident was resolved (CG-0MTSHG8RP008E128).
 *
 * Precondition: `state.pendingEventChoice` is set with `resolved === true`
 * (resolveEventChoice was called). Consumes the pending choice (clears it) and
 * runs the post-incident closing tail (immediate-loss check, EndCheck, decay,
 * challenges, end conditions, next-day advance, net row).
 *
 * @param state Current game state (mutated).
 * @returns The final turn result for the UI.
 */
export function finishDeferredEndOfTurn(state: MainStreetState): TurnResult {
  const pending = state.pendingEventChoice;
  if (!pending || !pending.resolved) {
    throw new Error('finishDeferredEndOfTurn requires a resolved pending event choice.');
  }
  const turnEnded = state.turn;
  // Consume the pending choice: the incident event is out of the deck (drawn),
  // its effect applied (accept) or refused (reject), and the escalation (if
  // any) is already on the deck top — nothing remains deferred.
  state.pendingEventChoice = null;
  return runSinglePlayerTurnClosing(state, {
    income: null, // income for this turn was already applied & presented
    incident: null, // the incident consequence was presented by resolveEventChoice
    incidentCoinChange: 0,
    incidentRepChange: 0,
    turnEnded,
  });
}

/**
 * Runs the closing tail of a deferred-mutation turn (CG-0MTR72P14000VO6Q).
 *
 * `processEndOfTurn(state, { deferResourceApplication: true })` computes the
 * turn's resource deltas WITHOUT applying them and defers the closing.
 * After the end-of-turn animations complete (income collection + incident
 * reveal), the scene applies the deltas exactly once (income/incident
 * animation completion, or immediately when none run) and then calls this
 * to, in a single step:
 *
 *  1. evaluate challenges against the post-delta state (a challenge such as
 *     "accumulate 3000 coins" must see the income land first) — this is the
 *     end-of-turn **safety net**; challenges are normally completed
 *     immediately after the action that satisfies them
 *     (CG-0MU37CKRR008252I), so this pass reports only closing-phase
 *     (Income / Incident) completions,
 *  2. run the immediate-loss check and EndCheck (game-over evaluation — AC4),
 *  3. advance to the next week when the game continues,
 *  4. append the per-turn net summary row.
 *
 * PRECONDITION: the pending deltas have ALREADY been applied to
 * `state.resourceBank` (via `applyEndOfTurnDeltas`) by the caller before
 * invoking this — otherwise EndCheck / challenge evaluation would read
 * pre-turn values. Returns the FINAL TurnResult (gameResult / finalScore /
 * newlyCompleted / pendingScoreDelta all computed). Callers pass the result
 * returned by `processEndOfTurn` so income/incident data flows through.
 *
 * @param state  Current game state (mutated: phases, turn, challenges).
 * @param result The deferred result from `processEndOfTurn(state, { deferResourceApplication: true })`.
 * @returns The completed closing TurnResult for the UI.
 */
export function finishDeferredTurnClosing(
  state: MainStreetState,
  result: TurnResult,
): TurnResult {
  const turnEnded = state.turn;

  // Phase: EndCheck
  state.phase = 'EndCheck';

  // 2. Decay active effects (decrement turnsRemaining, remove expired).
  const decayResult = decayActiveEffects(state.activeEffects);
  state.activeEffects = decayResult.active;
  for (const expired of decayResult.expired) {
    addLog(state, `${expired.description} has expired.`, 'neutral');
    recordMainStreetEvent({
      type: 'info',
      turn: state.turn,
      message: `${expired.description} has expired.`,
    });
  }

  // 3. Evaluate challenges against the post-delta state (end-of-turn safety
  //    net; the per-action pass has already completed anything the player's
  //    actions satisfied, so this reports only closing-phase completions —
  //    mirrors the legacy closing where income lands before evaluation).
  const newlyCompletedChallenges = evaluateChallenges(state.activeChallenges, state);
  const pendingScoreDelta =
    newlyCompletedChallenges.length * state.config.challengeBonusPoints;

  // Immediate-loss check after the deltas are applied (mirrors the legacy
  // post-incident check). Banner emitted first, then the net row.
  if (checkImmediateLoss(state)) {
    appendTurnNetRow(state, turnEnded);
    return {
      ...result,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges,
      choicePending: false,
      pendingScoreDelta,
    };
  }

  // 4. EndCheck (game-over evaluation — AC4: runs after the animations and
  //    post-application, never while animations are in flight).
  checkEndConditions(state);

  // 5. If the game continues, advance to the next turn.
  if (state.gameResult === 'playing') {
    state.turn += 1;
    advanceWeek(state);

    // ── Action Banking (CG-0MT3IOPZB005LNAR) ─────────────
    // Bank unused base actions (at most 1 per day) up to the cap of 2.
    // Staff-derived actions (e.g. General Manager +1) never bank;
    // only the base-action portion remains bankable.
    const bankable = Math.min(state.actionsRemaining, 1);
    state.bankedActions = Math.min(2, (state.bankedActions ?? 0) + bankable);

    state.phase = 'WeekStart';
  }

  // 6. Per-turn net summary row — the final log entry of a completed turn
  //    (CG-0MT5W7UJJ0065MEZ AC3). Reads the post-delta resources.
  appendTurnNetRow(state, turnEnded);

  return {
    ...result,
    gameResult: state.gameResult,
    finalScore: state.finalScore,
    newlyCompletedChallenges,
    choicePending: false,
    pendingScoreDelta,
  };
}

// ── Headless Choice Policy (CG-0MTT7FC7A000AA58 Q1 / CG-0MTSHG8RP008E128) ──
// The Accept/Reject decision for a pending dual-choice incident lives HERE (in
// the engine) rather than in the AI strategy module so headless convenience
// turns (executeFullTurn, MainStreetAiPlayer.playGame, the Monte Carlo
// harness) can resolve a pending choice without importing the AI module (which
// would be circular). MainStreetAiStrategy re-exports these symbols so its
// public API (and tests importing it) is unchanged.

/**
 * Runs the closing tail of a single-player turn from the post-incident point:
 * immediate-loss check, EndCheck, active-effect decay, challenge evaluation,
 * end conditions, next-day advance, and the per-turn net summary row.
 *
 * @param state Current game state (mutated in-place).
 * @param ctx   Closing context (income/incident/deltas/turnEnded).
 * @returns The turn result for the UI.
 */
function runSinglePlayerTurnClosing(
  state: MainStreetState,
  ctx: SinglePlayerTurnClosingContext,
): TurnResult {
  const { income, incident, incidentCoinChange, incidentRepChange, turnEnded } = ctx;

  // Check for immediate loss after incident. Banner is emitted first,
  // then the per-turn net row as the final entry (mirrors the pre-income
  // ordering fix above and keeps the net row as the canonical closing
  // record; CG-0MTJP6XU5009KN5L).
  if (checkImmediateLoss(state)) {
    appendTurnNetRow(state, turnEnded);
    return {
      income,
      incident,
      incidentCoinChange,
      incidentRepChange,
      gameResult: state.gameResult,
      finalScore: state.finalScore,
      newlyCompletedChallenges: [],
      choicePending: false,
    };
  }

  // Phase: EndCheck
  state.phase = 'EndCheck';

  // Decay active effects (decrement turnsRemaining, remove expired)
  const decayResult = decayActiveEffects(state.activeEffects);
  state.activeEffects = decayResult.active;
  for (const expired of decayResult.expired) {
    addLog(state, `${expired.description} has expired.`, 'neutral');
    recordMainStreetEvent({
      type: 'info',
      turn: state.turn,
      message: `${expired.description} has expired.`,
    });
  }

  // Evaluate challenges before checking end conditions (so score includes any
  // new bonus points). This is the end-of-turn safety net: challenges are
  // normally completed per-action (CG-0MU37CKRR008252I).
  const newlyCompletedChallenges = evaluateChallenges(state.activeChallenges, state);

  checkEndConditions(state);

  // If game continues, advance to next turn
  if (state.gameResult === 'playing') {
    state.turn += 1;
    advanceWeek(state);

    // ── Action Banking (CG-0MT3IOPZB005LNAR) ─────────────
    // Bank unused base actions (at most 1 per day) up to the cap of 2.
    // Staff-derived actions (e.g. General Manager +1) never bank;
    // only the base-action portion remains bankable.
    const bankable = Math.min(state.actionsRemaining, 1);
    state.bankedActions = Math.min(2, (state.bankedActions ?? 0) + bankable);

    state.phase = 'WeekStart';
  }

  // Per-turn net summary row — the final log entry of a completed turn
  // (CG-0MT5W7UJJ0065MEZ AC3).
  appendTurnNetRow(state, turnEnded);

  return {
    income,
    incident,
    incidentCoinChange,
    incidentRepChange,
    gameResult: state.gameResult,
    finalScore: state.finalScore,
    newlyCompletedChallenges,
    choicePending: false,
  };
}

