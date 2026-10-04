/**
 * Main Street: Turn Controller (thin orchestrator)
 *
 * Thin class: every method delegates to a free function in a per-concern
 * helper module (TurnFlow / MarketActions / PlaceSell / DragDrop /
 * Animation). Helper modules depend only on
 * `MainStreetTurnControllerContext`, so there are no cycles.
 *
 * @module
 */

import type { MainStreetTurnControllerContext } from './MainStreetTurnControllerContext';
import type { BusinessCard, EventCard, UpgradeCard, StaffCard } from '../MainStreetCards';
import type { SynergyPair } from '../MainStreetAdjacency';
import type { TurnResult } from '../MainStreetEngine';
import type { DragDropPayload } from '@ui/dragDrop';
import { startTurnPhase, endTurn, finishTurnPresentation, handleGameOver, presentEventChoiceDialog, onEventChoice, onPlayHeldEvent, performUndo, performRedo } from './MainStreetTurnControllerTurnFlow';
import { onBusinessCardClick, onEventCardClick, onRefreshMarketClick, onPeekClick, onCommunityFavourClick, onUpgradeCardClick, onHandUpgradeCardClick, onStaffCardClick, onHandBusinessCardClick, onHandEventCardClick, onDiscardHandCard } from './MainStreetTurnControllerMarketActions';
import { onSlotClick, onSellCard, applyHandUpgradeToSlot, hasPendingTargeting, cancelPendingPlacement, streetPairDims } from './MainStreetTurnControllerPlaceSell';
import { initDragDrop, canPickUpBusinessCard, canDropBusinessCard, onDragDropBusiness, canPickUpUpgradeCard, canDropUpgradeCard, onDragDropUpgrade } from './MainStreetTurnControllerDragDrop';
import { animateMarketDealIn, animateMarketSwap, animateNewSynergyPairs } from './MainStreetTurnControllerAnimation';
import { canHumanSeatAct } from './MainStreetTurnControllerCompetitive';

export type { MainStreetTurnControllerContext } from './MainStreetTurnControllerContext';

export class MainStreetTurnController implements MainStreetTurnControllerContext {
  public onSaveCheckpoint: (() => void) | null = null;
  public onGameEnd: (() => void) | null = null;

  constructor(public readonly scene: any) {}

  public startTurnPhase(skipMarketRefill: boolean = false, suppressWeekBanner: boolean = false): void {
    startTurnPhase(this, skipMarketRefill, suppressWeekBanner);
  }

  public endTurn(): void {
    endTurn(this);
  }

  public finishTurnPresentation(
    result: TurnResult,
    pendingBankingHint: boolean,
  ): void {
    finishTurnPresentation(this, result, pendingBankingHint);
  }

  public handleGameOver(result: TurnResult): void {
    handleGameOver(this, result);
  }

  public presentEventChoiceDialog(): void {
    presentEventChoiceDialog(this);
  }

  public onEventChoice(option: 'accept' | 'reject'): void {
    onEventChoice(this, option);
  }

  public onPlayHeldEvent(handIndex?: number): void {
    onPlayHeldEvent(this, handIndex);
  }

  public performUndo(): void {
    performUndo(this);
  }

  public performRedo(): void {
    performRedo(this);
  }

  public onBusinessCardClick(card: BusinessCard): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onBusinessCardClick(this, card);
  }

  public initDragDrop(): void {
    initDragDrop(this);
  }

  public canPickUpBusinessCard(cardId: string): boolean {
    return canPickUpBusinessCard(this, cardId);
  }

  public canDropBusinessCard(cardId: string, slotIndex: number): boolean {
    return canDropBusinessCard(this, cardId, slotIndex);
  }

  public onDragDropBusiness(payload: DragDropPayload): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onDragDropBusiness(this, payload);
  }

  public canPickUpUpgradeCard(cardId: string): boolean {
    return canPickUpUpgradeCard(this, cardId);
  }

  public canDropUpgradeCard(cardId: string, slotIndex: number): boolean {
    return canDropUpgradeCard(this, cardId, slotIndex);
  }

  public onDragDropUpgrade(payload: DragDropPayload): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onDragDropUpgrade(this, payload);
  }

  public hasPendingTargeting(): boolean {
    return hasPendingTargeting(this);
  }

  public cancelPendingPlacement(): boolean {
    return cancelPendingPlacement(this);
  }

  public streetPairDims(): { cols: number; rows: number } | undefined {
    return streetPairDims(this);
  }

  public onSlotClick(slotIndex: number): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onSlotClick(this, slotIndex);
  }

  public onEventCardClick(card: EventCard): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onEventCardClick(this, card);
  }

  public onRefreshMarketClick(): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onRefreshMarketClick(this);
  }

  public onPeekClick(): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onPeekClick(this);
  }

  public onCommunityFavourClick(direction: 'coins-to-rep' | 'rep-to-coins'): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onCommunityFavourClick(this, direction);
  }

  public animateMarketDealIn(row: 'market'): void {
    animateMarketDealIn(this, row);
  }

  public animateMarketSwap(
    row: 'market',
    outgoingRow: Array<{ id: string; family: 'business' | 'community-space' | 'event' | 'upgrade' }>,
  ): void {
    animateMarketSwap(this, row, outgoingRow);
  }

  public animateNewSynergyPairs(beforePairs: SynergyPair[]): void {
    animateNewSynergyPairs(this, beforePairs);
  }

  public onUpgradeCardClick(card: UpgradeCard): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onUpgradeCardClick(this, card);
  }

  public onHandUpgradeCardClick(index: number): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onHandUpgradeCardClick(this, index);
  }

  public applyHandUpgradeToSlot(handIndex: number, slotIndex: number): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    applyHandUpgradeToSlot(this, handIndex, slotIndex);
  }

  public onStaffCardClick(card: StaffCard): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onStaffCardClick(this, card);
  }

  public onHandBusinessCardClick(index: number): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onHandBusinessCardClick(this, index);
  }

  public onHandEventCardClick(index: number): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onHandEventCardClick(this, index);
  }

  public onDiscardHandCard(handIndex: number | null): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onDiscardHandCard(this, handIndex);
  }

  public onSellCard(slotIndex: number): void {
    if (!canHumanSeatAct(this.scene.state)) return;
    onSellCard(this, slotIndex);
  }
}
