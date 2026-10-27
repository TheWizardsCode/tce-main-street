/**
 * Main Street: Drag-and-Drop Actions
 *
 * Drag-drop init, pick-up/drop validation, and business/upgrade drop handlers.
 *
 * @module
 */

import { playIllegalFeedback, matchesRequiredCard } from './MainStreetTurnControllerUtils';
import { flashError, flashConfirmation } from './MainStreetFeedback';

import { DEFAULT_DRAG_DISTANCE_THRESHOLD, createDragDropManager } from '@ui/dragDrop';
import type { DragDropPayload } from '@ui/dragDrop';
import { computeSynergyPairs } from '../MainStreetAdjacency';
import { buyAndPlaceBusinessCommand, buyAndPlaceUpgradeCommand } from '../MainStreetCommands';
import { canBuyAndPlaceUpgrade, canPlayUpgradeFromHand, canPurchaseBusiness, computeUpgradeDragPricing, upgradeDragVetoReason } from '../MainStreetMarket';
import { canPlaceFromHand } from '../MainStreetEngineCommands';
import {
  computeEffectiveBusinessPurchaseCost,
  computeBusinessPurchasePremium,
} from '../MainStreetStaffBuffs';
import { recordMainStreetEvent } from '../MainStreetTranscript';
import { getCurrentStep, isSynergyAdjacentPlacement } from '../TutorialFlow';
import type { TutorialActionType } from '../TutorialFlow';
import { computeDragTransferDuration } from './MainStreetConstants';
import type { MainStreetTurnControllerContext } from './MainStreetTurnControllerContext';

export function initDragDrop(tcCtx: MainStreetTurnControllerContext): void {

    const s = tcCtx.scene;
    if (s.dragDropManager) return;
    // Guard: in headless unit tests the scene may have no input plugin.
    if (!s.input || typeof s.input.on !== 'function') return;

    s.dragDropManager = createDragDropManager({
      scene: s,
      dragDistanceThreshold: DEFAULT_DRAG_DISTANCE_THRESHOLD,
      reducedMotion: !!s.settingsPanel?.reducedMotion,
      onDragStart: (payload) => {
        try { s.msRenderer?.showDragHighlights?.(payload?.data as string | undefined); } catch (_) { /* ignore */ }
      },
      onDragEnd: () => {
        try { s.msRenderer?.clearDragHighlights?.(); } catch (_) { /* ignore */ }
      },
      // Illegal-drag feedback (MS-0MVKT3TZF0091IHC AC4): keep the existing
      // shake + illegal-move SFX (reduced-motion aware, via the same helper
      // the click paths use) AND state the underlying legality reason in the
      // instruction text, reusing the LegalityResult wording rather than a
      // generic message. Applies to a vetoed pickup and a rejected drop.
      onIllegal: (payload) => {
        try {
          playIllegalFeedback(payload?.gameObject as any, s);
          const cardId = typeof payload?.data === 'string' ? payload.data : undefined;
          if (!cardId) return;
          const card = s.state.market.cards.find((c: any) => c.id === cardId);
          if (card?.family !== 'upgrade') return;
          // A rejected drop carries the target slot (`zoneData`), so its
          // reason comes from the drop gate's own LegalityResult; a vetoed
          // pickup has no slot yet and explains its own checks.
          const slot = typeof payload?.zoneData === 'number' ? payload.zoneData : undefined;
          const reason = upgradeDragVetoReason(s.state, cardId, slot);
flashError(s, reason);
        } catch (_) { /* illegal feedback must never crash the drag lifecycle */ }
      },
    });
  
}

export function canPickUpBusinessCard(tcCtx: MainStreetTurnControllerContext, cardId: string): boolean {

    const s = tcCtx.scene;
    if (s.uiPhase !== 'market') return false;
    // Action economy (CG-0MSTOF1N5005PK2R): dragging is a buy-and-place
    // action — no pickup when the daily action budget is spent.
    if (s.state.actionsRemaining <= 0) return false;
    const card = s.state.market.cards.find((c: any) => c.id === cardId);
    if (!card) return false;
    // Drag support covers business AND community-space cards (general change,
    // operator decision A for the T13 Library bug). Events/upgrades stay
    // click-only (they are not part of the drag-drop module's dev-row model).
    if (card.family !== 'business' && card.family !== 'community-space') return false;
    // Composite-parity buy-and-place price (CG-0MT24X0SX007RLHN): on GM
    // 2-action days the drag charges the LISTED cost (consuming 2 actions);
    // on a 1-action day it charges the +50% premium (consuming 1 action).
    // Check affordability against the applicable price, after the
    // street-wide Delivery Driver purchase discount (CG-0MUMCVH3N007KT1M).
    const price = s.state.actionsRemaining >= 2
      ? computeEffectiveBusinessPurchaseCost(s.state, card.cost)
      : computeBusinessPurchasePremium(s.state, card.cost);
    if (s.state.resourceBank.coins < price) return false;
    if (!s.state.streetGrid.some((slot: any) => slot === null)) return false;

    // Tutorial gating: only allow select-business if it is the required
    // action or the tutorial is inactive.
    const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('select-business' as TutorialActionType);
    if (check && !check.allowed) return false;

    // Tutorial: enforce specific card purchase if requiredCardId is set on
    // the current step (same prefix-matching rule as the click path).
    const controller = (s as any).tutorialController as any;
    if (controller?.isActive) {
      const step = controller.currentStepIndex >= 0
        ? getCurrentStep(controller)
        : null;
      if (step?.requiredCardId && !matchesRequiredCard(card.id, step.requiredCardId)) {
        return false;
      }
    }
    return true;
  
}

export function canDropBusinessCard(tcCtx: MainStreetTurnControllerContext, cardId: string, slotIndex: number): boolean {

    const s = tcCtx.scene;
    // Action economy (CG-0MSTOF1N5005PK2R): buy-and-place consumes the
    // daily action — no drop when the budget is spent. On GM 2-action days
    // the drag consumes BOTH actions (composite parity), so 2 must remain.
    if (s.state.actionsRemaining <= 0) return false;
    const legality = canPurchaseBusiness(s.state, cardId, slotIndex);
    if (!legality.legal) return false;

    // Composite-parity buy-and-place price (CG-0MT24X0SX007RLHN): on GM
    // 2-action days the drag charges the LISTED cost (2 actions consumed);
    // on a 1-action day it charges the +50% premium. Verify affordability
    // against the applicable price (not just the listed cost).
    const card = s.state.market.cards.find((c: any) => c.id === cardId);
    if (card && (card.family === 'business' || card.family === 'community-space')) {
      const price = s.state.actionsRemaining >= 2
        ? computeEffectiveBusinessPurchaseCost(s.state, card.cost)
        : computeBusinessPurchasePremium(s.state, card.cost);
      if (s.state.resourceBank.coins < price) return false;
    }

    const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('place-business' as TutorialActionType);
    if (check && !check.allowed) return false;

    // Tutorial: synergy adjacency for composite buy-and-place steps (T13).
    const controller = (s as any).tutorialController as any;
    if (controller?.isActive) {
      const step = controller.currentStepIndex >= 0
        ? getCurrentStep(controller)
        : null;
      if (step && !isSynergyAdjacentPlacement(step, s.state.streetGrid, slotIndex)) {
        return false;
      }
    }
    return true;
  
}

export function onDragDropBusiness(tcCtx: MainStreetTurnControllerContext, payload: DragDropPayload): void {

    const s = tcCtx.scene;
    const cardId = payload.data as string;
    const slotIndex = payload.zoneData as number;
    const sourceIndex = s.state.market.cards.findIndex((c: any) => c.id === cardId);
    const card = s.state.market.cards.find((c: any) => c.id === cardId);
    if (!card || sourceIndex < 0 || slotIndex == null) return;

    // The dragged container follows the pointer, so its position at drop
    // time IS the drop location. Capture it BEFORE refreshAll() recreates
    // the market card at its slot origin, then start the transfer
    // animation from there (not from the market row).
    const dropSource = { x: payload.gameObject?.x ?? 0, y: payload.gameObject?.y ?? 0 };

    const cardName = card.name;

    // Composite-parity pricing for the drag's move+place accounting:
    // premium applies only when the drag's own action leaves no action for
    // the placement step (last action on a 1-action day); on GM 2-action
    // days the placement consumes the remaining action at listed cost.
    const premiumApplies = s.state.actionsRemaining <= 1;
    const priceOverride = premiumApplies ? undefined : card.cost;
    const extraActions = premiumApplies ? 0 : 1;

    const startTransfer = (): void => {
      s.tooltipManager?.hide();
      s.clearMarketSelection();
      s.hiddenTransferSourceCardIds.add(cardId);
      s.uiPhase = 'animating';
      s.refreshAll();

      const afterTransfer = (): void => {
        // Capture synergy pairs before the placement mutates the grid so only
        // NEWLY formed pairs animate (pre-existing pairs never re-trigger).
        const beforePairs = computeSynergyPairs(s.state.streetGrid, s.state.soldSlots ?? [], tcCtx.streetPairDims());
        try {
          const cmd = buyAndPlaceBusinessCommand(s.state, cardId, slotIndex, priceOverride, extraActions);
          s.undoManager.execute(cmd);
          s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
          try { recordMainStreetEvent({ type: 'action', turn: s.state.turn, action: { type: 'buy-and-place', cardId, slotIndex }, description: cmd.description }); } catch (_) {}
          try { s.gameEvents?.emit('card:placed', { cardId, slotIndex }); } catch (_) {}
          flashConfirmation(s, premiumApplies
            ? `Placed "${cardName}" on slot ${slotIndex} (50% premium)`
            : `Placed "${cardName}" on slot ${slotIndex}`);
        } catch (e) {
          console.error('[MS] DragBuyBusiness failed', e);
          const msg = (e as Error).message;
          const container = s.msRenderer?.getMarketRowCards?.()?.[sourceIndex] ?? s.actionContainer ?? null;
          playIllegalFeedback(container, s);
    flashError(s, `Error: ${msg}`);
        }

        s.hiddenTransferSourceCardIds.delete(cardId);
        s.uiPhase = 'market';
        s.refreshAll();
        s.refreshStreetGrid();
        s.refreshActionButtons();
        // Synergy-formation animation for any new pairs (non-blocking).
        tcCtx.animateNewSynergyPairs(beforePairs);
        // Tutorial: mark place-business step complete if active
        try {
          (s.msLifecycleManager as any).onTutorialActionComplete?.('place-business' as TutorialActionType);
        } catch (_) { /* ignore */ }
      };

      if (sourceIndex >= 0) {
        // Transfer duration proportional to the drop-to-slot distance: a card
        // released next to its slot settles quickly instead of taking the
        // fixed 1500ms market→slot flight (click/AI flows keep 1500ms via the
        // shared default). See computeDragTransferDuration (CG-0MST2LS3E004BTPO).
        const destination = s.getStreetSlotCenter(slotIndex);
        const distancePx = Math.hypot(destination.x - dropSource.x, destination.y - dropSource.y);
        void s.animateTransferFromMarket({
          cardId,
          family: 'business',
          row: 'market',
          slotIndex: sourceIndex,
          source: dropSource,
          destination,
          duration: computeDragTransferDuration(distancePx),
        }).then(afterTransfer);
      } else {
        afterTransfer();
      }
    };

    if (premiumApplies) {
      // Explain dialog before confirming the premium drag (CG-0MT24X0SX007RLHN):
      // proceed → place at premium; cancel → the card returns to the market
      // row (no coins deducted, no action consumed).
      s.showBuyAndPlacePremiumDialog(cardName, startTransfer, () => {
        s.uiPhase = 'market';
        flashConfirmation(s, `"${cardName}" stays in the market — buy cancelled.`);
        try { s.msRenderer?.clearDragHighlights?.(); } catch (_) { /* ignore */ }
        s.refreshAll();
        s.refreshStreetGrid();
        s.refreshActionButtons();
      });
      return;
    }
    startTransfer();
  
}

export function canPickUpHandCard(tcCtx: MainStreetTurnControllerContext, cardId: string): boolean {

    const s = tcCtx.scene;
    const handIndex = (s.state.hand ?? []).findIndex((c: any) => c.id === cardId);
    const card = (s.state.hand ?? [])[handIndex];
    if (!card) return false;

    // Phase gate (MS-0MVK4E5M00021XEY): a drag may CONTINUE a pending
    // click-selection on the same card — clicking a hand card arms
    // `placing-from-hand` + `pendingHandIndex` (onHand*CardClick), and the
    // click-select-then-drag flow must not be vetoed at pickup. Every other
    // phase still vetoes, including `placing-from-hand` while a DIFFERENT
    // card (or no card) is pending: a drag can never hijack another
    // card's selection, and a plain unselected drag keeps the historical
    // market-phase-only rule.
    const isSelectedCard =
      s.uiPhase === 'placing-from-hand' && s.pendingHandIndex === handIndex;
    if (s.uiPhase !== 'market' && !isSelectedCard) return false;

    if (card.family === 'upgrade') {
      // Tutorial gating (apply-upgrade) — mirror of canPickUpUpgradeCard.
      const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('apply-upgrade' as TutorialActionType);
      if (check && !check.allowed) return false;
      // Action economy: a held upgrade costs one action to play; the same-week
      // composite (just moved to hand this turn) is free.
      const isSameWeek = s.state.justMovedUpgradeCardId != null && s.state.justMovedUpgradeCardId === card.id;
      if (!isSameWeek && s.state.actionsRemaining <= 0) return false;
      // AC1: veto pickup when NO eligible business exists on the street
      // (mirror of canPickUpUpgradeCard's hasEligibleTarget, evaluated through
      // the from-hand predicate which also covers ownership/affordability).
      const hasEligibleTarget = s.state.streetGrid.some((slot: any, index: number) =>
        slot !== null && canPlayUpgradeFromHand(s.state, handIndex, index).legal);
      if (!hasEligibleTarget) return false;
      return true;
    }

    // Hand drag support covers business AND community-space cards; event
    // cards in hand stay click-only (select-then-act) — out of drag scope.
    if (card.family !== 'business' && card.family !== 'community-space') return false;

    // Tutorial gating (place-business) — mirror of canDropBusinessCard.
    const checkB = (s.msLifecycleManager as any).isTutorialActionAllowed?.('place-business' as TutorialActionType);
    if (checkB && !checkB.allowed) return false;

    // AC2 action budget: a held card costs one action to place. The same-week
    // composite (just moved to hand this turn) may be placed at the +50%
    // premium with 0 actions — the exact click-path rule (premium dialog).
    const sameWeek = s.justMovedHandCardId != null && s.justMovedHandCardId === card.id;
    if (!sameWeek && s.state.actionsRemaining <= 0) return false;
    const premiumApplies = sameWeek && s.state.actionsRemaining <= 0;
    const premiumCost = premiumApplies
      ? computeBusinessPurchasePremium(s.state, card.cost)
      : undefined;
    // AC2: pickup is vetoed when no affordable empty slot exists.
    const hasAffordableEmptySlot = s.state.streetGrid.some((slot: any, index: number) =>
      slot === null && canPlaceFromHand(s.state, handIndex, index, premiumCost).legal);
    if (!hasAffordableEmptySlot) return false;
    return true;

}

export function canDropHandCard(tcCtx: MainStreetTurnControllerContext, cardId: string, slotIndex: number): boolean {

    const s = tcCtx.scene;
    const handIndex = (s.state.hand ?? []).findIndex((c: any) => c.id === cardId);
    const card = (s.state.hand ?? [])[handIndex];
    if (!card) return false;

    if (card.family === 'upgrade') {
      const isSameWeek = s.state.justMovedUpgradeCardId != null && s.state.justMovedUpgradeCardId === card.id;
      if (!isSameWeek && s.state.actionsRemaining <= 0) return false;
      const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('apply-upgrade' as TutorialActionType);
      if (check && !check.allowed) return false;
      return canPlayUpgradeFromHand(s.state, handIndex, slotIndex).legal;
    }

    // Hand business/community-space drop: only empty in-bounds slots are
    // valid targets (canPlaceFromHand also guards occupancy + affordability).
    if (card.family !== 'business' && card.family !== 'community-space') return false;
    if (slotIndex < 0 || slotIndex >= s.state.streetGrid.length) return false;
    if (s.state.streetGrid[slotIndex] !== null) return false;

    const checkB = (s.msLifecycleManager as any).isTutorialActionAllowed?.('place-business' as TutorialActionType);
    if (checkB && !checkB.allowed) return false;

    // Tutorial: synergy adjacency for placing-from-hand steps (T20 etc.).
    const controller = (s as any).tutorialController as any;
    if (controller?.isActive) {
      const step = controller.currentStepIndex >= 0
        ? getCurrentStep(controller)
        : null;
      if (step && !isSynergyAdjacentPlacement(step, s.state.streetGrid, slotIndex)) {
        return false;
      }
    }

    const sameWeek = s.justMovedHandCardId != null && s.justMovedHandCardId === card.id;
    if (!sameWeek && s.state.actionsRemaining <= 0) return false;
    const premiumApplies = sameWeek && s.state.actionsRemaining <= 0;
    const premiumCost = premiumApplies
      ? computeBusinessPurchasePremium(s.state, card.cost)
      : undefined;
    return canPlaceFromHand(s.state, handIndex, slotIndex, premiumCost).legal;

}

export function onDragDropHandUpgrade(tcCtx: MainStreetTurnControllerContext, payload: DragDropPayload): void {

    const s = tcCtx.scene;
    const cardId = payload.data as string;
    const slotIndex = payload.zoneData as number;
    const handIndex = (s.state.hand ?? []).findIndex((c: any) => c.id === cardId);
    const card = (s.state.hand ?? [])[handIndex];
    if (!card || handIndex < 0 || slotIndex == null) return;
    if (card.family !== 'upgrade') return;

    // Post-drop source of truth: reuse the click-to-apply flow verbatim —
    // pre-flight eligibility + canPlayUpgradeFromHand, the hand→street
    // transfer animation, the undoable playUpgradeFromHandCommand, the
    // level-up burst, tutorial completion (same-week free / held = 1 action
    // handled inside the command).
    tcCtx.applyHandUpgradeToSlot(handIndex, slotIndex);

}

export function onDragDropHandBusiness(tcCtx: MainStreetTurnControllerContext, payload: DragDropPayload): void {

    const s = tcCtx.scene;
    const cardId = payload.data as string;
    const slotIndex = payload.zoneData as number;
    const handIndex = (s.state.hand ?? []).findIndex((c: any) => c.id === cardId);
    const card = (s.state.hand ?? [])[handIndex];
    if (!card || handIndex < 0 || slotIndex == null) return;
    if (card.family !== 'business' && card.family !== 'community-space') return;

    // Arm the pending hand-placement state exactly as a click on the card
    // would, then delegate to the shared onSlotClick hand branch — the
    // post-drop source of truth (pre-flight canPlaceFromHand, composite-
    // premium dialog when applicable, transfer, undoable
    // playBusinessFromHandCommand).
    s.pendingHandIndex = handIndex;
    s.pendingHandJustMoved = s.justMovedHandCardId != null && s.justMovedHandCardId === card.id;
    s.uiPhase = 'placing-from-hand';
    tcCtx.onSlotClick(slotIndex);

}

export function canPickUpUpgradeCard(tcCtx: MainStreetTurnControllerContext, cardId: string): boolean {

    const s = tcCtx.scene;
    if (s.uiPhase !== 'market') return false;
    // Drag-drop is a buy-and-place action — no pickup when the budget is spent.
    if (s.state.actionsRemaining <= 0) return false;
    const card = s.state.market.cards.find((c: any) => c.id === cardId);
    if (!card || card.family !== 'upgrade') return false;

    // Composite-parity pricing (MS-0MVKT3TZF0091IHC): the pickup gate reasons
    // about the SAME price the execution charges, resolved through the shared
    // helper (listed cost at ≥ 2 actions, discount-first premium at ≤ 1
    // action), and it never vetoes a pickup that some eligible target would
    // legally accept — including a target carrying a per-business upgrade
    // discount.
    const hasLegalDropTarget = s.state.streetGrid.some((slot: any, index: number) => {
      if (slot === null) return false;
      const pricing = computeUpgradeDragPricing(s.state, card, index);
      return canBuyAndPlaceUpgrade(s.state, cardId, index, pricing.price).legal;
    });
    if (!hasLegalDropTarget) return false;

    const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('apply-upgrade' as TutorialActionType);
    if (check && !check.allowed) return false;

    return true;
  
}

export function canDropUpgradeCard(tcCtx: MainStreetTurnControllerContext, cardId: string, slotIndex: number): boolean {

    const s = tcCtx.scene;
    if (s.state.actionsRemaining <= 0) return false;
    const card = s.state.market.cards.find((c: any) => c.id === cardId);
    if (!card || card.family !== 'upgrade') return false;

    // Composite-parity pricing: the drop-zone acceptance (canAccept and the
    // green/red highlights) prices the drop exactly as the command will —
    // listed cost at ≥ 2 actions, discount-first premium at ≤ 1 action.
    const pricing = computeUpgradeDragPricing(s.state, card, slotIndex);
    if (!canBuyAndPlaceUpgrade(s.state, cardId, slotIndex, pricing.price).legal) return false;

    const check = (s.msLifecycleManager as any).isTutorialActionAllowed?.('apply-upgrade' as TutorialActionType);
    if (check && !check.allowed) return false;

    return true;
  
}

export function onDragDropUpgrade(tcCtx: MainStreetTurnControllerContext, payload: DragDropPayload): void {

    const s = tcCtx.scene;
    const cardId = payload.data as string;
    const slotIndex = payload.zoneData as number;
    const sourceIndex = s.state.market.cards.findIndex((c: any) => c.id === cardId);
    const card = s.state.market.cards.find((c: any) => c.id === cardId);
    if (!card || sourceIndex < 0 || slotIndex == null) return;

    // The dragged container follows the pointer, so its position at drop time
    // IS the drop location — capture it before refreshAll() rebuilds the row.
    const dropSource = { x: payload.gameObject?.x ?? 0, y: payload.gameObject?.y ?? 0 };
    const cardName = card.name;

    // Composite-parity pricing (MS-0MVKT3TZF0091IHC): resolve the price and
    // action spend ONCE through the shared helper that also drives both
    // gates, then pass them to the undoable command unchanged.
    const pricing = computeUpgradeDragPricing(s.state, card, slotIndex);
    const priceOverride = pricing.premiumApplies ? undefined : pricing.price;

    const startTransfer = (): void => {
      s.tooltipManager?.hide();
      s.clearMarketSelection();
      s.hiddenTransferSourceCardIds.add(cardId);
      s.uiPhase = 'animating';
      s.refreshAll();

      const afterTransfer = (): void => {
        try {
          const cmd = buyAndPlaceUpgradeCommand(s.state, cardId, slotIndex, priceOverride, pricing.extraActions);
          s.undoManager.execute(cmd);
          s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
          try { recordMainStreetEvent({ type: 'action', turn: s.state.turn, action: { type: 'buy-and-place-upgrade', cardId, slotIndex }, description: cmd.description }); } catch (_) {}
          try { s.gameEvents?.emit('card:placed', { cardId, slotIndex }); } catch (_) {}
          flashConfirmation(s, pricing.premiumApplies
            ? `Applied "${cardName}" to slot ${slotIndex} (50% premium)`
            : `Applied "${cardName}" to slot ${slotIndex} (listed price)`);
        } catch (e) {
          console.error('[MS] DragBuyAndPlaceUpgrade failed', e);
          const container = s.msRenderer?.getMarketRowCards?.()?.[sourceIndex] ?? s.actionContainer ?? null;
          playIllegalFeedback(container, s);
    flashError(s, `Error: ${(e as Error).message}`);
        }

        s.hiddenTransferSourceCardIds.delete(cardId);
        s.uiPhase = 'market';
        s.refreshAll();
        s.refreshStreetGrid();
        s.refreshActionButtons();
        try {
          (s.msLifecycleManager as any).onTutorialActionComplete?.('apply-upgrade' as TutorialActionType);
        } catch (_) { /* ignore */ }
      };

      const destination = s.getStreetSlotCenter(slotIndex);
      const distancePx = Math.hypot(destination.x - dropSource.x, destination.y - dropSource.y);
      void s.animateTransferFromMarket({
        cardId,
        family: 'upgrade',
        row: 'market',
        slotIndex: sourceIndex,
        source: dropSource,
        destination,
        duration: computeDragTransferDuration(distancePx),
      }).then(afterTransfer);
    };

    if (pricing.premiumApplies) {
      // ≤ 1 action → premium explainer dialog before purchase, matching the
      // business drag (CG-0MT24X0SX007RLHN). Proceed commits; Cancel returns
      // the card to the market row with no coins and no actions spent. The
      // persisted "Don't show this again" preference is honoured by the
      // dialog itself.
      s.showBuyAndPlacePremiumDialog(cardName, startTransfer, () => {
        s.uiPhase = 'market';
        flashConfirmation(s, `"${cardName}" stays in the market — buy cancelled.`);
        try { s.msRenderer?.clearDragHighlights?.(); } catch (_) { /* ignore */ }
        s.refreshAll();
        s.refreshStreetGrid();
        s.refreshActionButtons();
      });
      return;
    }
    startTransfer();
  
}
