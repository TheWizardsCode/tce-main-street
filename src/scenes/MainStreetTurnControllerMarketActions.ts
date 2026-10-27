/**
 * Main Street: Market / Card Click Actions
 *
 * Click handlers for business, event, upgrade, staff, market-refresh, peek,
 * and community-favour actions.
 *
 * @module
 */

import { playIllegalFeedback, matchesRequiredCard } from './MainStreetTurnControllerUtils';
import { flashError, flashConfirmation } from './MainStreetFeedback';

import { COMMON_SFX_KEYS, safePlaySound } from '@core-engine/SoundManager';
import { FONT_FAMILY } from '@ui/constants';
import { popTextOrIcon } from '@ui/popTextOrIcon';
import type { BusinessCard, EventCard, StaffCard, UpgradeCard } from '../MainStreetCards';
import { discardFromHandCommand, freeMarketRerollCommand, hireStaffCardCommand, moveEventToHandCommand, moveStaffCommand, moveToHandCommand, peekIncidentDeckCommand, refreshMarketCommand } from '../MainStreetCommands';
import { SFX_KEYS } from './MainStreetConstants';
// Import the concrete module (not the `src/ui` barrel) so Node unit tests that
// import this controller module do not pull in browser-only UI modules.
import { discardCard } from '@ui/discardCard';
import { executeAction } from '../MainStreetEngine';
import { turnLabel } from '../MainStreetFormatting';
import { canAddToHand, canPurchaseEvent, canPurchaseStaff, canRefreshMarket, canUseFreeMarketReroll } from '../MainStreetMarket';
import { hasPeekCapableStaff } from '../MainStreetStaffSkills';
import { canMoveStaffOnBusiness } from '../MainStreetEngineCommands';
import { buildMoveStaffAffordance } from './MainStreetHudTooltips';
import { addLog } from '../MainStreetState';
import { recordMainStreetEvent } from '../MainStreetTranscript';
import { getCurrentStep } from '../TutorialFlow';
import type { TutorialActionType } from '../TutorialFlow';
import type { MainStreetTurnControllerContext } from './MainStreetTurnControllerContext';

export function onBusinessCardClick(tcCtx: MainStreetTurnControllerContext, card: BusinessCard): void {

    const s = tcCtx.scene;
    if (s.uiPhase !== 'market') return;

    // Action economy (CG-0MSTOF1N5005PK2R): moving a market card to hand
    // costs the daily action — gate before the transfer animation so the
    // player gets immediate feedback instead of a mid-flight error.
    if (s.state.actionsRemaining <= 0) {
      flashError(s, 'No actions remaining this week. End your turn to start next week.');
      const containers0 = s.msRenderer?.getMarketRowCards?.();
      const cardIndex0 = s.state.market.cards.findIndex((c: any) => c.id === card.id);
      const target0 = containers0?.[cardIndex0] ?? null;
      playIllegalFeedback(target0, s);
      return;
    }

    // Tutorial gating: only allow select-business if it's the required action or tutorial is inactive
    const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('select-business' as TutorialActionType);
    if (check && !check.allowed) {
      flashError(s, check.reason ?? 'Complete the highlighted step first.');
      const containers1 = s.msRenderer?.getMarketRowCards?.();
      const cardIndex1 = s.state.market.cards.findIndex((c: any) => c.id === card.id);
      const target1 = containers1?.[cardIndex1] ?? null;
      playIllegalFeedback(target1, s);
      return;
    }

    // Tutorial: enforce specific card purchase if requiredCardId is set on the current step.
    // Uses prefix matching (template ID without copy number suffix) so any copy of the
    // required card template satisfies the requirement.
    const controller = (s as any).tutorialController as any;
    if (controller?.isActive) {
      const step = controller.currentStepIndex >= 0
        ? getCurrentStep(controller)
        : null;
      if (step?.requiredCardId && !matchesRequiredCard(card.id, step.requiredCardId)) {
        // Find the card name from the market for the error message
        const requiredCard = s.state.market.cards.find(
          (c: any) => matchesRequiredCard(c.id, step.requiredCardId!)
        );
        const requiredName = requiredCard?.name ?? 'the specified card';
        const msg = `This is not the card you should buy right now. Please buy ${requiredName} first.`;
        flashError(s, msg);
        const containers2 = s.msRenderer?.getMarketRowCards?.();
        const cardIndex2 = s.state.market.cards.findIndex((c: any) => c.id === card.id);
        const target2 = containers2?.[cardIndex2] ?? null;
        playIllegalFeedback(target2, s);
        return;
      }
    }

    s.selectMarketCardById(card.id);

    // Check hand capacity
    const handCheck = canAddToHand(s.state);
    if (!handCheck.legal) {
      // Illegal feedback (CG-0MSXKQVZC009AM9L): play sfx + shake on the market
      // card so the player immediately understands the action is blocked.
      const containers = s.msRenderer?.getMarketRowCards?.();
      const cardIndex = s.state.market.cards.findIndex((c: any) => c.id === card.id);
      const target = containers?.[cardIndex] ?? null;
      playIllegalFeedback(target, s);
      flashError(s, `Hand full: ${handCheck.reason ?? 'Place or sell a card first.'}`);
      return;
    }

    // ── Move to hand (1 action; cost paid at play) ────────────
    const sourceIndex = s.state.market.cards.findIndex((c: any) => c.id === card.id);
    const cardName = card.name;

    // Ensure stale hover tooltip is cleared
    s.tooltipManager?.hide();

    s.clearMarketSelection();
    s.uiPhase = 'animating';
    s.hiddenTransferSourceCardIds.add(card.id);
    s.refreshAll();

    const afterTransfer = () => {
      try {
        const cmd = moveToHandCommand(s.state, card.id);
        s.undoManager.execute(cmd);
        s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
        try { recordMainStreetEvent({ type: 'action', turn: s.state.turn, action: { type: 'move-to-hand', cardId: card.id }, description: cmd.description }); } catch (_) {}
        try { s.gameEvents?.emit('card:placed', { cardId: card.id }); } catch (_) {}
        flashConfirmation(s, `"${cardName}" moved to hand (1 action)!`);

        // No auto-selection (CG-0MSXIQIPJ000NDTL): the card rests in hand,
        // unselected. The player must explicitly click the hand card when
        // ready to place it. Record the card ID so that placing it stays
        // free (same-week move+place = 1 action) when the player selects it.
        s.pendingHandIndex = null;
        s.pendingHandJustMoved = false;
        s.justMovedHandCardId = card.id;
        s.uiPhase = 'market';
      } catch (e) {
        console.error('[MS] BuyBusinessToHand failed', e);
        playIllegalFeedback(s.actionContainer, s);
        flashError(s, `Error: ${(e as Error).message}`);
        s.uiPhase = 'market';
      }

      s.hiddenTransferSourceCardIds.delete(card.id);
      s.refreshAll();
      s.refreshStreetGrid();
      s.refreshActionButtons();

      // Tutorial: mark select-business step complete if active
      try {
        (s.msLifecycleManager as any).onTutorialActionComplete?.('select-business' as TutorialActionType);
      } catch (_) { /* ignore */ }
    };

    if (sourceIndex >= 0) {
      const handIndex = (s.state.hand ?? []).length;
      void s.animateTransferFromMarket({
        cardId: card.id,
        family: 'business',
        row: 'market',
        slotIndex: sourceIndex,
        // Animate to the exact resting position in the merged hand — the
        // HandView-predicted insertion position (single source of truth),
        // not a left-edge slot estimate that would make the card snap
        // sideways when the hand re-renders centred on handCenterX.
        destination: s.getBusinessHandInsertionPosition(handIndex),
      }).then(afterTransfer);
    } else {
      afterTransfer();
    }
  
}

export function onEventCardClick(tcCtx: MainStreetTurnControllerContext, card: EventCard): void {

    const s = tcCtx.scene;
    if (s.uiPhase !== 'market') return;
    // Tutorial gating: only allow buy-event if it's the required action or tutorial is inactive
    const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('buy-event' as TutorialActionType);
    if (check && !check.allowed) {
      flashError(s, check.reason ?? 'Complete the highlighted step first.');
      const containersE = s.msRenderer?.getMarketRowCards?.();
      const cardIndexE = s.state.market.cards.findIndex((c: any) => c.id === card.id);
      const targetE = containersE?.[cardIndexE] ?? s.actionContainer ?? null;
      playIllegalFeedback(targetE, s);
      return;
    }

    // Tutorial: enforce specific event card purchase if requiredCardId is set.
    // Uses prefix matching (template ID without copy number suffix) so any copy of the
    // required card template satisfies the requirement.
    const evtController = (s as any).tutorialController as any;
    if (evtController?.isActive) {
      const step = evtController.currentStepIndex >= 0
        ? getCurrentStep(evtController)
        : null;
      if (step?.requiredCardId && !matchesRequiredCard(card.id, step.requiredCardId)) {
        const requiredCard = s.state.market.cards.find(
          (c: any) => matchesRequiredCard(c.id, step.requiredCardId!)
        );
        const requiredName = requiredCard?.name ?? 'the specified event card';
        const msg = `This is not the card you should buy right now. Please buy ${requiredName} first.`;
        flashError(s, msg);
        const containersE2 = s.msRenderer?.getMarketRowCards?.();
        const cardIndexE2 = s.state.market.cards.findIndex((c: any) => c.id === card.id);
        const targetE2 = containersE2?.[cardIndexE2] ?? s.actionContainer ?? null;
        playIllegalFeedback(targetE2, s);
        return;
      }
    }

    // Ensure stale hover tooltip is cleared when a card is played.
    s.tooltipManager?.hide();

    s.selectMarketCardById(card.id);

    const legality = canPurchaseEvent(s.state, card.id);
    if (!legality.legal) {
      const containersE3 = s.msRenderer?.getMarketRowCards?.();
      const cardIndexE3 = s.state.market.cards.findIndex((c: any) => c.id === card.id);
      const targetE3 = containersE3?.[cardIndexE3] ?? s.actionContainer ?? null;
      playIllegalFeedback(targetE3, s);
      flashError(s, `Cannot buy event: ${legality.reason ?? 'unknown'}`);
      return;
    }

    const sourceIndex = s.state.market.cards.findIndex((c: any) => c.id === card.id);

    s.uiPhase = 'animating';
    s.hiddenTransferSourceCardIds.add(card.id);
    s.refreshAll();

    const afterTransfer = (): void => {
      console.debug('[MS] onEventCardClick: attempting BuyEvent', { cardId: card.id, coinsBefore: s.state.resourceBank.coins, marketBefore: s.state.market.cards.map((c: any)=>c.id) });
      try {
        const cmd = moveEventToHandCommand(s.state, card.id);
        s.undoManager.execute(cmd);
        s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
        try { recordMainStreetEvent({ type: 'action', turn: s.state.turn, action: { type: 'buy-event', cardId: card.id }, description: cmd.description }); } catch (_) {}
        try { s.gameEvents?.emit('card:placed', { cardId: card.id }); } catch (_) {}
        flashConfirmation(s, `Moved event to hand (1 action): "${card.name}"`);
      } catch (e) {
        console.error('[MS] MoveEventToHand failed', e);
        playIllegalFeedback(s.actionContainer, s);
        flashError(s, `Error: ${(e as Error).message}`);
      }

      s.hiddenTransferSourceCardIds.delete(card.id);
      s.uiPhase = 'market';
      s.refreshAll();
      // Tutorial: mark buy-event step complete if active
      try {
        (s.msLifecycleManager as any).onTutorialActionComplete?.('buy-event' as TutorialActionType);
      } catch (_) { /* ignore */ }
    };

    if (sourceIndex >= 0) {
      const handIndex = (s.state.hand ?? []).length;
      void s.animateTransferFromMarket({
        cardId: card.id,
        family: 'event',
        row: 'market',
        slotIndex: sourceIndex,
        // Animate to the exact resting position of the appended hand card — the
        // merged HandView-predicted position (single source of truth), centred
        // on handCenterX rather than the left-anchored slot estimate.
        destination: s.getEventHandInsertionPosition(handIndex),
      }).then(afterTransfer);
    } else {
      afterTransfer();
    }
  
}

export function onRefreshMarketClick(tcCtx: MainStreetTurnControllerContext): void {

    const s = tcCtx.scene;
    if (s.uiPhase !== 'market') return;

    const legality = canRefreshMarket(s.state);
    if (!legality.legal) {
      flashError(s, `Cannot research: ${legality.reason ?? 'unknown'}`);
      playIllegalFeedback(s.actionContainer, s);
      return;
    }

    s.uiPhase = 'animating';
    s.refreshAll();

    // Capture the outgoing row before the command replaces it — the swap
    // animation fades these cards out from their current slot positions.
    const outgoingRow = s.state.market.cards.slice();
    let refreshed = false;
    try {
      const cmd = refreshMarketCommand(s.state);
      s.undoManager.execute(cmd);
      s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
      try { recordMainStreetEvent({ type: 'action', turn: s.state.turn, action: { type: 'refresh-market' }, description: cmd.description }); } catch (_) {}
      flashConfirmation(s, 'Market researched');
      addLog(s.state, 'Researched market (via UI)', 'neutral');
      refreshed = true;
    } catch (e) {
      console.error('[MS] RefreshMarket failed', e);
      flashError(s, `Error: ${(e as Error).message}`);
    }

    s.uiPhase = 'market';
    s.refreshAll();
    // Market swap animation (only when the refresh actually succeeded).
    if (refreshed) tcCtx.animateMarketSwap('market', outgoingRow);
  
}

export function onFreeMarketRerollClick(tcCtx: MainStreetTurnControllerContext): void {

    const s = tcCtx.scene;
    if (s.uiPhase !== 'market') return;

    const legality = canUseFreeMarketReroll(s.state);
    if (!legality.legal) {
      flashError(s, `Cannot free re-roll: ${legality.reason ?? 'unknown'}`);
      playIllegalFeedback(s.actionContainer, s);
      return;
    }

    s.uiPhase = 'animating';
    s.refreshAll();

    // Capture the outgoing row before the command replaces it — the swap
    // animation fades these cards out from their current slot positions.
    const outgoingRow = s.state.market.cards.slice();
    let rerolled = false;
    try {
      const cmd = freeMarketRerollCommand(s.state);
      s.undoManager.execute(cmd);
      s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
      try { recordMainStreetEvent({ type: 'action', turn: s.state.turn, action: { type: 'free-market-reroll' }, description: cmd.description }); } catch (_) {}
      flashConfirmation(s, 'Investor free re-roll complete (coin-free)');
      rerolled = true;
    } catch (e) {
      console.error('[MS] FreeMarketReroll failed', e);
      flashError(s, `Error: ${(e as Error).message}`);
    }

    s.uiPhase = 'market';
    s.refreshAll();
    // Market swap animation (only when the re-roll actually succeeded).
    if (rerolled) tcCtx.animateMarketSwap('market', outgoingRow);
  
}

/**
 * Move-staff affordance (MS-0MUOSULQ700186PP AC2): begin a relocation by
 * entering the `moving-staff` phase. The label/tooltip and the 1-action-point
 * cost are produced by the pure {@link buildMoveStaffAffordance} builder so
 * the UI and the tests share one source of truth. Illegal starts (no actions,
 * no employed member, no legal destination) surface feedback and mutate
 * nothing.
 */
export function onMoveStaffClick(tcCtx: MainStreetTurnControllerContext, staffId: string): void {

    const s = tcCtx.scene;
    if (s.uiPhase !== 'market') return;

    const affordance = buildMoveStaffAffordance(s.state, staffId);
    if (!affordance.enabled) {
      flashError(s, affordance.tooltip.split('\n').slice(1).join(' '));
      playIllegalFeedback(s.actionContainer, s);
      return;
    }

    s.pendingStaffMoveId = affordance.staffId;
    s.uiPhase = 'moving-staff';
    s.refreshAll();
  
}

/**
 * Completes a pending move-staff relocation (MS-0MUOSULQ700186PP AC2) via
 * `moveStaffCommand` (exactly 1 action point, undoable). An illegal
 * destination keeps the `moving-staff` phase so the player can retry, with
 * no action spent and no state mutation.
 */
export function onMoveStaffDestinationClick(tcCtx: MainStreetTurnControllerContext, slotIndex: number): void {

    const s = tcCtx.scene;
    if (s.uiPhase !== 'moving-staff') return;
    const staffId = s.pendingStaffMoveId as string | null;
    if (!staffId) return;

    const legality = canMoveStaffOnBusiness(s.state, staffId, slotIndex);
    if (!legality.legal) {
      flashError(s, legality.reason ?? 'Cannot move staff there.');
      playIllegalFeedback(s.actionContainer, s);
      return;
    }

    let moved = false;
    try {
      const cmd = moveStaffCommand(s.state, staffId, slotIndex);
      s.undoManager.execute(cmd);
      s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
      try { recordMainStreetEvent({ type: 'action', turn: s.state.turn, action: { type: 'move-staff', staffId, slotIndex }, description: cmd.description }); } catch (_) {}
      flashConfirmation(s, `Staff moved to slot ${slotIndex} (-1 action).`);
      moved = true;
    } catch (e) {
      console.error('[MS] MoveStaff failed', e);
      flashError(s, `Error: ${(e as Error).message}`);
    }

    s.pendingStaffMoveId = null;
    s.uiPhase = 'market';
    s.refreshAll();
    if (moved) s.refreshStreetGrid();
    s.refreshActionButtons();
  
}

/** Cancels a pending move-staff relocation, returning to the market phase. */
export function cancelStaffMove(tcCtx: MainStreetTurnControllerContext): boolean {

    const s = tcCtx.scene;
    if (s.uiPhase !== 'moving-staff') return false;
    s.pendingStaffMoveId = null;
    s.uiPhase = 'market';
    flashConfirmation(s, 'Staff move cancelled.');
    s.refreshAll();
    return true;
  
}

export function onPeekClick(tcCtx: MainStreetTurnControllerContext): void {

    const s = tcCtx.scene;
    if (s.uiPhase !== 'market') return;

    if (s.state.actionsRemaining <= 0) {
      flashError(s, 'No actions remaining this week. End your turn to start next week.');
      playIllegalFeedback(s.actionContainer, s);
      return;
    }
    if (s.state.peekUsedThisTurn) {
      flashError(s, 'You have already peeked at the incident deck this turn.');
      playIllegalFeedback(s.actionContainer, s);
      return;
    }
    if (!hasPeekCapableStaff(s.state)) {
      flashError(s, 'No staff member with the peek ability is employed.');
      playIllegalFeedback(s.actionContainer, s);
      return;
    }
    if (s.state.incidentDeck.length === 0) {
      flashError(s, 'The incident deck is empty \u2014 nothing to peek at.');
      playIllegalFeedback(s.actionContainer, s);
      return;
    }

    s.uiPhase = 'animating';
    try {
      const cmd = peekIncidentDeckCommand(s.state);
      s.undoManager.execute(cmd);
      s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
      try {
        recordMainStreetEvent({
          type: 'action',
          turn: s.state.turn,
          action: { type: 'peek-incident-deck' },
          description: cmd.description,
        });
      } catch (_) { /* transcript disabled */ }
    } catch (e) {
      console.error('[MS] Peek failed', e);
      flashError(s, `Error: ${(e as Error).message}`);
      s.uiPhase = 'market';
      s.refreshAll();
      return;
    }

    const peeked = s.state.revealedPeekedCard;
    if (!peeked) {
      // Empty-deck no-op: nothing to reveal.
      s.uiPhase = 'market';
      s.refreshAll();
      return;
    }

    s.msAnimator.animatePeekReveal({
      cardId: peeked.id,
      cardName: peeked.name,
      from: s.msRenderer.getFrontIncidentCardCenter(),
      onComplete: () => {
        s.state.revealedPeekedCard = null;
        s.uiPhase = 'market';
        flashConfirmation(s, 
          `${turnLabel(s.state.config, s.state.turn)} -- Peeked: ${peeked.name} (returned face-down)`,
        );
        s.refreshAll();
      },
    });
  
}

export function onCommunityFavourClick(tcCtx: MainStreetTurnControllerContext, direction: 'coins-to-rep' | 'rep-to-coins'): void {

    const s = tcCtx.scene;
    if (s.uiPhase !== 'market') return;

    // Tutorial gating: the community-favour action is only allowed while the
    // active step requires it; any other attempt surfaces the standard
    // illegal-move feedback.
    const tutorialCheck = (s.msLifecycleManager as any)?.isTutorialActionAllowed?.('community-favour' as TutorialActionType);
    if (tutorialCheck && !tutorialCheck.allowed) {
      flashError(s, tutorialCheck.reason ?? 'Complete the highlighted step first.');
      playIllegalFeedback(s.actionContainer, s);
      return;
    }

    const config = s.state.config;
    const cost = direction === 'coins-to-rep' ? config.favourCoinsToRepCost : config.favourRepToCoinsRepCost;
    const resource = direction === 'coins-to-rep' ? s.state.resourceBank.coins : s.state.resourceBank.reputation;
    const resourceName = direction === 'coins-to-rep' ? 'coins' : 'reputation';

    // ── Guards (mirror the button disabled states) — surface, don't fail silently ──
    if (s.state.favourUsedThisTurn) {
      flashError(s, 'You have already used Community Favour this turn.');
      playIllegalFeedback(s.actionContainer, s);
      return;
    }
    if (resource < cost) {
      flashError(s, 
        `Not enough ${resourceName} for Community Favour (need ${cost}, have ${resource}).`,
      );
      playIllegalFeedback(s.actionContainer, s);
      return;
    }

    s.uiPhase = 'animating';
    try {
      executeAction(s.state, { type: 'community-favour', direction });

      // Animated + sounded feedback: UI click SFX and a pop-up summary.
      safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
      const reducedMotion = s.settingsPanel?.reducedMotion ?? false;
      const summary = s.add.text(
        s.layout.gameW / 2,
        s.layout.actionY - 40,
        direction === 'coins-to-rep' ? 'Community Favour: 2c → 1r' : 'Community Favour: 2r → 3c',
        {
          fontSize: '14px',
          fontStyle: 'bold',
          color: '#ffdd88',
          fontFamily: FONT_FAMILY,
        },
      ).setOrigin(0.5).setDepth(500);
      void popTextOrIcon({
        scene: s,
        target: summary,
        duration: 1400,
        riseY: 26,
        scale: 1.15,
        reducedMotion,
      });

      try {
        recordMainStreetEvent({
          type: 'action',
          turn: s.state.turn,
          action: { type: 'community-favour', direction },
          description: `Community Favour (${direction}) executed`,
        });
      } catch (_) { /* transcript disabled */ }
    } catch (e) {
      // Engine rejected the exchange — surface standard illegal feedback.
      console.error('[MS] Community Favour failed', e);
      flashError(s, `Error: ${(e as Error).message}`);
      playIllegalFeedback(s.actionContainer, s);
      s.uiPhase = 'market';
      s.refreshAll();
      return;
    }

    s.uiPhase = 'market';
    s.refreshAll();

    // Tutorial: mark the community-favour step complete after a successful
    // exchange (mirrors how other action-gated steps advance).
    try {
      (s.msLifecycleManager as any)?.onTutorialActionComplete?.('community-favour' as TutorialActionType);
    } catch (_) { /* ignore */ }
  
}

export function onUpgradeCardClick(tcCtx: MainStreetTurnControllerContext, card: UpgradeCard): void {

    const s = tcCtx.scene;
    if (s.uiPhase !== 'market') return;

    // Action economy (CG-0MT3IYSRL001VVUP): buying an upgrade follows the
    // business two-step flow — the market click only MOVES the card to hand
    // and spends the daily action; applying it to a business is a separate,
    // explicit step. Gate before the transfer so the player gets immediate
    // feedback instead of a mid-flight error.
    if (s.state.actionsRemaining <= 0) {
      flashError(s, 'No actions remaining this week. End your turn to start next week.');
      const containersNoActions = s.msRenderer?.getMarketRowCards?.();
      const cardIndexNoActions = s.state.market.cards.findIndex((c: any) => c.id === card.id);
      playIllegalFeedback(containersNoActions?.[cardIndexNoActions] ?? s.actionContainer ?? null, s);
      return;
    }

    // Tutorial gating: only allow apply-upgrade if it's the required action or tutorial is inactive
    const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('apply-upgrade' as TutorialActionType);
    if (check && !check.allowed) {
      flashError(s, check.reason ?? 'Complete the highlighted step first.');
      const containersU = s.msRenderer?.getMarketRowCards?.();
      const cardIndexU = s.state.market.cards.findIndex((c: any) => c.id === card.id);
      const targetU = containersU?.[cardIndexU] ?? s.actionContainer ?? null;
      playIllegalFeedback(targetU, s);
      return;
    }

    // Ensure stale hover tooltip is cleared when a card is played.
    s.tooltipManager?.hide();

    // Hand capacity is the only constraint — coins are charged at play time,
    // mirroring the business cost-at-play deferral model.
    const handCheck = canAddToHand(s.state);
    if (!handCheck.legal) {
      const containers = s.msRenderer?.getMarketRowCards?.();
      const cardIndex = s.state.market.cards.findIndex((c: any) => c.id === card.id);
      playIllegalFeedback(containers?.[cardIndex] ?? s.actionContainer ?? null, s);
      flashError(s, `Hand full: ${handCheck.reason ?? 'Place or sell a card first.'}`);
      return;
    }

    const sourceIndex = s.state.market.cards.findIndex((c: any) => c.id === card.id);

    s.selectMarketCardById(card.id);
    s.clearMarketSelection();
    s.uiPhase = 'animating';
    s.hiddenTransferSourceCardIds.add(card.id);
    s.refreshAll();

    const afterTransfer = (): void => {
      try {
        const cmd = moveToHandCommand(s.state, card.id);
        s.undoManager.execute(cmd);
        s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
        try { recordMainStreetEvent({ type: 'action', turn: s.state.turn, action: { type: 'move-to-hand', cardId: card.id }, description: cmd.description }); } catch (_) {}
        try { s.gameEvents?.emit('card:placed', { cardId: card.id }); } catch (_) {}

        // No auto-selection (mirrors CG-0MSXIQIPJ000NDTL for business cards):
        // the upgrade rests in the hand, unselected. `justMovedUpgradeCardId`
        // (set by moveToHand) makes the later play a free same-week composite.
        s.pendingHandIndex = null;
        s.pendingHandJustMoved = false;
        s.uiPhase = 'market';
      } catch (e) {
        console.error('[MS] MoveUpgradeToHand failed', e);
        playIllegalFeedback(s.actionContainer, s);
        flashError(s, `Error: ${(e as Error).message}`);
        s.uiPhase = 'market';
      }

      s.hiddenTransferSourceCardIds.delete(card.id);
      s.refreshAll();
      s.refreshStreetGrid();
      s.refreshActionButtons();
    };

    if (sourceIndex >= 0) {
      const handIndex = (s.state.hand ?? []).length;
      void s.animateTransferFromMarket({
        cardId: card.id,
        family: 'upgrade',
        row: 'market',
        slotIndex: sourceIndex,
        destination: s.getBusinessHandInsertionPosition(handIndex),
      }).then(afterTransfer);
    } else {
      afterTransfer();
    }
  
}

/**
 * Clears a pending hand-card selection and returns the scene to the market
 * phase — the shared cleanup for the action-bar **Cancel** button and for
 * re-clicking an already-selected hand card (toggle-off,
 * MS-0MV767QTO008JUDJ).
 *
 * Behaviourally identical to Cancel: the card remains in the hand, the
 * selection border and any market-row selection are cleared, the same-week
 * move trackers are reset, the hint bar returns to the standard market
 * instruction, and no action/coin/log/undo side effects occur.
 */
export function cancelHandSelection(tcCtx: MainStreetTurnControllerContext): void {

    const s = tcCtx.scene;
    s.pendingHandIndex = null;
    s.pendingHandJustMoved = false;
    s.justMovedHandCardId = null;
    if (s.state) s.state.justMovedUpgradeCardId = null;

    // Clear any market-row selection (Cancel parity) before returning.
    if (typeof s.clearMarketSelection === 'function') s.clearMarketSelection();

    s.uiPhase = 'market';

    // Drop the hand selection highlight (null clears every border).
    if (s.msRenderer && typeof s.msRenderer.updateBusinessHandSelection === 'function') {
      s.msRenderer.updateBusinessHandSelection(null);
    }


    s.refreshAll();
  
}

export function onHandUpgradeCardClick(tcCtx: MainStreetTurnControllerContext, index: number): void {

    const s = tcCtx.scene;
    const hand = s.state.hand ?? [];
    if (index < 0 || index >= hand.length) return;
    if (hand[index].family !== 'upgrade') return;

    // Tutorial gating: only allow apply-upgrade if it's the required action
    // or the tutorial is inactive.
    const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('apply-upgrade' as TutorialActionType);
    if (check && !check.allowed) {
      flashError(s, check.reason ?? 'Complete the highlighted step first.');
      const handSpriteGating = s.msRenderer?.handView?.getSpriteAt?.(index) as any;
      playIllegalFeedback(handSpriteGating ?? s.actionContainer, s);
      return;
    }

    // Same-week composite (just moved from the market this turn) applies the
    // upgrade without a second action; an upgrade held from a previous day
    // costs one action.
    const isSameWeek = s.state.justMovedUpgradeCardId === hand[index]?.id;

    // Re-clicking the already-selected upgrade toggles it off (Cancel parity,
    // MS-0MV767QTO008JUDJ). Switching to a different card is still allowed.
    if (s.uiPhase === 'placing-from-hand' && s.pendingHandIndex !== null) {
      if (s.pendingHandIndex === index) {
        cancelHandSelection(tcCtx);
        return;
      }
      s.pendingHandIndex = index;
      s.pendingHandJustMoved = isSameWeek;
      s.refreshAll();
      if (s.msRenderer && typeof s.msRenderer.updateBusinessHandSelection === 'function') {
        s.msRenderer.updateBusinessHandSelection(index);
      }
      return;
    }

    if (s.uiPhase !== 'market') return;

    s.tooltipManager?.hide();

    s.pendingHandIndex = index;
    s.pendingHandJustMoved = isSameWeek;
    s.uiPhase = 'placing-from-hand';
    s.refreshAll();

    if (s.msRenderer && typeof s.msRenderer.updateBusinessHandSelection === 'function') {
      s.msRenderer.updateBusinessHandSelection(index);
    }
  
}

export function onStaffCardClick(tcCtx: MainStreetTurnControllerContext, card: StaffCard): void {

    const s = tcCtx.scene;
    if (s.uiPhase !== 'market') return;

    // Tutorial gating: only allow hire-staff if it's the required action or
    // the tutorial is inactive.
    const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('hire-staff' as TutorialActionType);
    if (check && !check.allowed) {
      flashError(s, check.reason ?? 'Complete the highlighted step first.');
      const containersS = s.msRenderer?.getMarketRowCards?.();
      const cardIndexS = s.state.market.cards.findIndex((c: any) => c.id === card.id);
      const targetS = containersS?.[cardIndexS] ?? s.actionContainer ?? null;
      playIllegalFeedback(targetS, s);
      return;
    }

    // Ensure stale hover tooltip is cleared when a card is hired.
    s.tooltipManager?.hide();

    s.selectMarketCardById(card.id);

    const legality = canPurchaseStaff(s.state, card.id);
    if (!legality.legal) {
      const containers = s.msRenderer?.getMarketRowCards?.();
      const cardIndex = s.state.market.cards.findIndex((c: any) => c.id === card.id);
      const target = containers?.[cardIndex] ?? s.actionContainer ?? null;
      playIllegalFeedback(target, s);
      flashError(s, `Cannot hire: ${legality.reason ?? 'unknown'}`);
      return;
    }

    const sourceIndex = s.state.market.cards.findIndex((c: any) => c.id === card.id);

    s.uiPhase = 'animating';
    s.hiddenTransferSourceCardIds.add(card.id);
    s.refreshAll();

    const afterTransfer = (): void => {
      console.debug('[MS] onStaffCardClick: attempting HireStaff', { cardId: card.id, coinsBefore: s.state.resourceBank.coins, marketBefore: s.state.market.cards.map((c: any) => c.id) });
      let hired = false;
      try {
        const cmd = hireStaffCardCommand(s.state, card.id);
        s.undoManager.execute(cmd);
        s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
        try { recordMainStreetEvent({ type: 'action', turn: s.state.turn, action: { type: 'hire-staff', cardId: card.id }, description: cmd.description }); } catch (_) {}
        try { s.gameEvents?.emit('card:placed', { cardId: card.id }); } catch (_) {}
        flashConfirmation(s, `Hired "${card.name}" (+${card.handSlotsAdded} hand slots)`);
        // Lightweight notification for the hire (popup above the hand).
        try {
          void popTextOrIcon({ scene: s, x: s.layout.handCenterX, y: s.layout.handY, label: `Hired ${card.name}` });
        } catch (_) {}
        hired = true;
      } catch (e) {
        console.error('[MS] HireStaff failed', e);
        playIllegalFeedback(s.actionContainer, s);
        flashError(s, `Error: ${(e as Error).message}`);
      }

      s.hiddenTransferSourceCardIds.delete(card.id);
      s.uiPhase = 'market';
      s.refreshAll();

      // Tutorial: mark hire-staff step complete if active.
      if (hired) {
        try {
          (s.msLifecycleManager as any).onTutorialActionComplete?.('hire-staff' as TutorialActionType);
        } catch (_) {}
      }
    };

    if (sourceIndex >= 0) {
      void s.animateTransferFromMarket({
        cardId: card.id,
        family: 'staff',
        row: 'market',
        slotIndex: sourceIndex,
        // The hired staff member joins the player's side: fly to the hand
        // region (the card is then removed from the row on refresh).
        destination: { x: s.layout.handCenterX, y: s.layout.handY + (s.layout.handCardH ?? 0) / 2 },
      }).then(afterTransfer);
    } else {
      afterTransfer();
    }
  
}

export function onHandBusinessCardClick(tcCtx: MainStreetTurnControllerContext, index: number): void {

    const s = tcCtx.scene;
    const hand = s.state.hand ?? [];
    if (index < 0 || index >= hand.length) return;

    // Event cards are played (via onPlayHeldEvent), never placed on the street.
    if (hand[index].family === 'event') return;
    // Upgrade cards are applied to a business via onHandUpgradeCardClick
    // (CG-0MT3IYSRL001VVUP) — never placed on the street like a business.
    if (hand[index].family === 'upgrade') {
      tcCtx.onHandUpgradeCardClick(index);
      return;
    }

    // Tutorial gating: only allow if it's the required action or tutorial is inactive
    const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('select-hand-card' as any);
    if (check && !check.allowed) {
      flashError(s, check.reason ?? 'Complete the highlighted step first.');
      const handSpriteH = s.msRenderer?.handView?.getSpriteAt?.(index) as any;
      playIllegalFeedback(handSpriteH ?? s.actionContainer, s);
      return;
    }

    // When already in placing-from-hand, re-clicking the same business card
    // toggles the selection off (Cancel parity, MS-0MV767QTO008JUDJ);
    // clicking a different card switches the selection as before.
    if (s.uiPhase === 'placing-from-hand' && s.pendingHandIndex !== null) {
      if (s.pendingHandIndex === index) {
        cancelHandSelection(tcCtx);
        return;
      }
      s.pendingHandIndex = index;
      // Placing is free only if the selected card is the one just moved from
      // the market this turn (CG-0MSXIQIPJ000NDTL); any other hand card costs
      // an action (pendingHandJustMoved derived from justMovedHandCardId).
      s.pendingHandJustMoved = s.justMovedHandCardId === hand[index]?.id;
      s.refreshAll();
      // Update the selection highlight via the renderer
      if (s.msRenderer && typeof s.msRenderer.updateBusinessHandSelection === 'function') {
        s.msRenderer.updateBusinessHandSelection(index);
      }
      return;
    }

    // Only respond during market phase
    if (s.uiPhase !== 'market') return;

    // Ensure stale hover tooltip is cleared
    s.tooltipManager?.hide();

    s.pendingHandIndex = index;
    // Placing is free only if the selected card is the one just moved from
    // the market this turn (CG-0MSXIQIPJ000NDTL); any other hand card costs
    // an action.
    s.pendingHandJustMoved = s.justMovedHandCardId === hand[index]?.id;
    s.uiPhase = 'placing-from-hand';
    s.refreshAll();

    // Update the selection highlight
    if (s.msRenderer && typeof s.msRenderer.updateBusinessHandSelection === 'function') {
      s.msRenderer.updateBusinessHandSelection(index);
    }

    // Tutorial: mark select-hand-card step complete if active
    try {
      (s.msLifecycleManager as any).onTutorialActionComplete?.('select-hand-card' as any);
    } catch (_) { /* ignore */ }
  
}

/**
 * Discards the selected hand card for reputation equal to its coin cost
 * (clamped at 0) — the player-facing [Discard] control in the End Turn slot
 * (CG-0MTQ7KUVF009ELQK). Action-free, no confirmation dialog.
 *
 * The discard is undoable via `discardFromHandCommand`; the card animates out
 * of the hand with the discard SFX (reduced-motion respected) before the
 * command executes. A tutorial-disallowed discard shows illegal-move feedback
 * and mutates nothing.
 */
/**
 * Selects a held event card (select-then-act flow, CG-0MUEQ1BF000770B3):
 * clicking an event card highlights it and switches to the `event-selected`
 * phase, where the action bar offers [Play] (preserving the one-click
 * `play-event` behaviour) and [Discard].
 */
export function onHandEventCardClick(
  tcCtx: MainStreetTurnControllerContext,
  index: number,
): void {

    const s = tcCtx.scene;
    const hand = s.state.hand ?? [];
    if (index < 0 || index >= hand.length) return;
    const card = hand[index];
    if (!card || card.family !== 'event') return;
    if (s.uiPhase !== 'market' && s.uiPhase !== 'event-selected') return;

    // Re-clicking the already-selected held event toggles it off (Cancel
    // parity, MS-0MV767QTO008JUDJ) instead of re-affirming the selection.
    if (s.uiPhase === 'event-selected' && s.pendingHandIndex === index) {
      cancelHandSelection(tcCtx);
      return;
    }

    s.pendingHandIndex = index;
    s.pendingHandJustMoved = false;
    s.uiPhase = 'event-selected';
    s.refreshAll();
    if (s.msRenderer && typeof s.msRenderer.updateBusinessHandSelection === 'function') {
      s.msRenderer.updateBusinessHandSelection(index);
    }
  
}

export function onDiscardHandCard(
  tcCtx: MainStreetTurnControllerContext,
  handIndex: number | null,
): void {

    const s = tcCtx.scene;
    if (handIndex === null || handIndex === undefined) return;
    if (
      s.uiPhase !== 'placing-from-hand' &&
      s.uiPhase !== 'event-selected' &&
      s.uiPhase !== 'market'
    ) return;
    const hand = s.state.hand ?? [];
    const card = hand[handIndex];
    if (!card) return;

    // Tutorial gating: a discard must never bypass the required tutorial step.
    const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('discard-from-hand' as any);
    if (check && !check.allowed) {
      flashError(s, check.reason ?? 'Complete the highlighted step first.');
      const blockedSprite = s.msRenderer?.handView?.getSpriteAt?.(handIndex) as any;
      playIllegalFeedback(blockedSprite ?? s.actionContainer, s);
      return;
    }

    const reducedMotion = s.settingsPanel?.reducedMotion ?? false;
    const sprite = s.msRenderer?.handView?.getSpriteAt?.(handIndex) as any;

    const finishDiscard = () => {
      try {
        const cmd = discardFromHandCommand(s.state, handIndex);
        s.undoManager.execute(cmd);
        s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
        try {
          recordMainStreetEvent({
            type: 'action',
            turn: s.state.turn,
            action: { type: 'discard-from-hand', handIndex },
            description: cmd.description,
          });
        } catch (_) { /* transcript disabled */ }
        const repCost = card.cost ?? 0;
        flashConfirmation(s, 
          repCost > 0
            ? `Discarded "${card.name}" (-${repCost} rep).`
            : `Discarded "${card.name}" (no reputation cost).`,
        );
      } catch (e) {
        playIllegalFeedback(s.actionContainer, s);
        flashError(s, `Error: ${(e as Error).message}`);
      }
      // Return to the market phase with no selection (AC1).
      s.pendingHandIndex = null;
      s.pendingHandJustMoved = false;
      s.justMovedHandCardId = null;
      s.clearMarketSelection();
      s.uiPhase = 'market';
      s.refreshAll();
      s.refreshActionButtons();
    };

    if (sprite) {
      s.uiPhase = 'animating';
      discardCard({
        scene: s,
        target: sprite,
        offsetY: 30,
        duration: 400,
        reducedMotion,
        destroyAfter: false,
        gameEvents: s.gameEvents,
        cardId: card.id,
        soundManager: s.soundManager ?? null,
        sfx: { start: SFX_KEYS.DISCARD },
      });
      s.time.delayedCall(reducedMotion ? 0 : 400, finishDiscard);
    } else {
      // No hand sprite available (headless/edge): still audible, apply now.
      try { s.soundManager?.play(SFX_KEYS.DISCARD); } catch (_) { /* ignore */ }
      finishDiscard();
    }
  
}
