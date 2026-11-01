/**
 * Main Street: Turn Controller Context Interface
 *
 * The public surface the controller exposes to its helper modules. Helper
 * modules depend ONLY on this type (never on each other) — hub-and-spoke, no
 * cycles.
 *
 * @module
 */

import type { BusinessCard, EventCard, UpgradeCard, StaffCard } from '../MainStreetCards';
import type { SynergyPair } from '../MainStreetAdjacency';
import type { TurnResult } from '../MainStreetEngine';
import type { DragDropPayload } from '@ui/dragDrop';

export interface MainStreetTurnControllerContext {
  readonly scene: any;
  onSaveCheckpoint: (() => void) | null;
  onGameEnd: (() => void) | null;
  startTurnPhase(skipMarketRefill?: boolean, suppressWeekBanner?: boolean): void;
  endTurn(): void;
  finishTurnPresentation(result: TurnResult, pendingBankingHint: boolean, ): void;
  handleGameOver(result: TurnResult): void;
  presentEventChoiceDialog(): void;
  onEventChoice(option: 'accept' | 'reject' | number): void;
  /**
   * Presents the human piggyback decision prompt (join fully / keep 50%) when
   * the shared competitive closing pauses on the human seat (F5 of
   * MS-0MUYC47EL005Z69H).
   */
  presentPiggybackDialog(): void;
  /**
   * Presents the open bankruptcy bailout loan offer and waits for the seat's
   * decision (MS-0MVPWSBLG006YMBA single-player, shared by the competitive
   * seat pause in MS-0MVPWSAMH005LV9R).
   *
   * @param result The paused `TurnResult` that carries `pendingLoanOffer`.
   * @returns `true` when an offer was (or already is) presented, `false` when
   *          there is no offer to show (headless/replay).
   */
  presentLoanOfferDialog(result: TurnResult): boolean;
  /**
   * Resolves the human seat's pending piggyback decision via an undoable
   * command and continues the shared day (F5 of MS-0MUYC47EL005Z69H).
   * @param join True to join fully, false to keep the 50% free-ride.
   */
  onPiggybackChoice(join: boolean): void;
  onPlayHeldEvent(handIndex?: number): void;
  performUndo(): void;
  performRedo(): void;
  onBusinessCardClick(card: BusinessCard): void;
  initDragDrop(): void;
  canPickUpBusinessCard(cardId: string): boolean;
  canDropBusinessCard(cardId: string, slotIndex: number): boolean;
  onDragDropBusiness(payload: DragDropPayload): void;
  canPickUpUpgradeCard(cardId: string): boolean;
  canDropUpgradeCard(cardId: string, slotIndex: number): boolean;
  onDragDropUpgrade(payload: DragDropPayload): void;
  canPickUpHandCard(cardId: string): boolean;
  canDropHandCard(cardId: string, slotIndex: number): boolean;
  onDragDropHandUpgrade(payload: DragDropPayload): void;
  onDragDropHandBusiness(payload: DragDropPayload): void;
  hasPendingTargeting(): boolean;
  cancelPendingPlacement(): boolean;
  streetPairDims(): { cols: number; rows: number } | undefined;
  onSlotClick(slotIndex: number): void;
  onEventCardClick(card: EventCard): void;
  onRefreshMarketClick(): void;
  onFreeMarketRerollClick(): void;
  onMoveStaffClick(staffId: string): void;
  onMoveStaffDestinationClick(slotIndex: number): void;
  cancelStaffMove(): boolean;
  onPeekClick(): void;
  onCommunityFavourClick(direction: 'coins-to-rep' | 'rep-to-coins'): void;
  animateMarketDealIn(row: 'market'): void;
  animateMarketSwap(row: 'market', outgoingRow: Array<{ id: string; family: 'business' | 'community-space' | 'event' | 'upgrade' }>, ): void;
  animateNewSynergyPairs(beforePairs: SynergyPair[]): void;
  onUpgradeCardClick(card: UpgradeCard): void;
  onHandUpgradeCardClick(index: number): void;
  applyHandUpgradeToSlot(handIndex: number, slotIndex: number): void;
  onStaffCardClick(card: StaffCard): void;
  onHandBusinessCardClick(index: number): void;
  onHandEventCardClick(index: number): void;
  onDiscardHandCard(handIndex: number | null): void;
  onSellCard(slotIndex: number): void;
}
