import { sellBusinessCommand, closeBusinessCommand, letGoStaffCommand } from '../MainStreetCommands';
import { canCloseBusiness, canSellBusiness } from '../MainStreetMarket';
import { addLog } from '../MainStreetState';
import type { EventCard, StaffCard } from '../MainStreetCards';
import { SFX_KEYS } from './MainStreetConstants';
import { DIFFICULTY_NAMES } from '../MainStreetDifficulty';
import type { TurnResult } from '../MainStreetEngine';
import {
  FONT_FAMILY,
  CardPackListing,
  createOverlayBackground,
  createOverlayButton,
  dismissOverlay,
  enabledCardPackIds,
} from '@ui';
import {
  applyEnabledMainStreetPacks,
  getMainStreetCardPackLoadResult,
  resolveEnabledPackIds,
  toCardPackListingInput,
} from '../MainStreetCardPacks';
import { COMMON_SFX_KEYS, safePlaySound } from '@core-engine/SoundManager';
import { choiceDialogTitle, choiceDialogSubtitle } from '../MainStreetStorylineUi';
import { buildJournal, journalIsEmpty, journalTitle, choiceClarityLabels } from '../MainStreetStorylineJournal';
import {
  buildGameOverChallengeSummary,
  buildGameOverPlayerRows,
  formatEndReason,
} from './MainStreetGameOverSummary';
import { formatCompetitiveScoreboardBadge } from './MainStreetCompetitiveScoreboard';
import { buildMoveStaffAffordance } from './MainStreetHudTooltips';
import { TIER_DEFINITIONS, ORDERED_TIER_DEFINITIONS, highestUnlockedTier } from '../MainStreetTiers';
import {
  isBuyAndPlacePremiumDialogDismissed,
  setBuyAndPlacePremiumDialogDismissed,
} from '../MainStreetPrefs';
import { t, registerLocale } from '@core-engine/I18n';
import {
  UNDO_CHALLENGE_I18N_KEYS,
  UNDO_CHALLENGE_EN_BUNDLE,
} from '../i18n/undo-challenge-en';

// Default English strings are registered at module-load time (merges with the
// other Main Street 'en' bundles).
registerLocale('en', UNDO_CHALLENGE_EN_BUNDLE);

export class MainStreetOverlayContent {
  constructor(private readonly scene: any) {}

  /**
   * Shows the Game Over overlay as a two-column panel (epic MS-0MUWDL0V40041USM).
   *
   * Layout:
   * - Top band: the title (`You Win!` / `Game Over`) and the plain-language
   *   end-reason headline, spanning both columns.
   * - Left **Game State** column: one row per player (label, coins,
   *   reputation, score and any failure/elimination badge) followed by the
   *   run's challenges met.
   * - Right **Summary** column: the retained score breakdown, challenge
   *   details, tier-unlock notifications, tier + campaign stats, the
   *   difficulty selector and the Play Again / Menu buttons anchored at the
   *   panel bottom.
   *
   * The body is read-only (never mutates committed `state`) and reuses the
   * pure summary model ({@link buildGameOverPlayerRows},
   * {@link buildGameOverChallengeSummary}, {@link formatEndReason}). Overlay
   * conventions follow AGENTS.md UI best practices: `createOverlayBackground` /
   * `createOverlayButton` from `@ui`, all elements parented into
   * `s.hudContainer`, depths 199 (backdrop) / 200 (box) / 201 (interactive),
   * everything pushed into `s.overlayObjects`. No animation is added here, so
   * the overlay is reduced-motion safe, and headless/replay mode returns early.
   */
  public showGameOverOverlay(
    result: TurnResult,
    newlyUnlockedTiers: string[] = [],
  ): void {
    const s = this.scene;
    if (s.replayMode) return; // headless/replay: never present UI

    s.uiPhase = 'game-over';
    s.refreshAll();

    const isWin = result.gameResult === 'win';
    const title = isWin ? 'You Win!' : 'Game Over';
    const color = isWin ? '#44ff44' : '#ff4444';

    // ── Model inputs (pure, read-only) ──────────────────────────
    // Per-player rows (PlayerRecord in competitive mode, the shared wallet in
    // single-player), the run-global challenge summary and the explicit
    // end-reason headline.
    const playerRows = buildGameOverPlayerRows(s.state);
    const challengeSummary = buildGameOverChallengeSummary(s.state);
    const endReasonHeadline = formatEndReason(s.state);

    const activeChallenges = s.state.activeChallenges ?? [];
    const challengeLineCount = activeChallenges.length;
    const completedChallenges = s.state.challengesCompleted ?? [];

    // ── Content heights ─────────────────────────────────────────
    // Tier unlock notifications (conditional)
    let tierUnlockH = 0;
    if (newlyUnlockedTiers.length > 0) {
      tierUnlockH += 26; // section header
      tierUnlockH += newlyUnlockedTiers.length * 36; // tier name line + count line + spacing per tier
      tierUnlockH += 8; // bottom padding
    }
    // Current tier + campaign stats (always shown when campaign exists)
    const campaignH = s.campaign ? 80 : 0; // tier indicator + stat lines + spacing

    const rowH = 26;
    const leftPlayersH = 26 + playerRows.length * rowH; // "Game State" header + rows
    const leftChallengesH = 20 + 22 + 20 + challengeSummary.totalCount * 20; // gap + header + met line + items
    const leftTotalH = leftPlayersH + leftChallengesH;

    const breakdownH = 108;
    const detailsH = challengeLineCount > 0 ? 24 + challengeLineCount * 20 : 0;
    const controlsH = 88; // difficulty row + buttons
    const rightContentH = 26 + breakdownH + detailsH + tierUnlockH + campaignH;
    const rightTotalH = rightContentH + controlsH;

    const topBandH = 92;
    const panelPad = 24;
    const colGap = 24;
    const panelW = 900;
    const colW = (panelW - panelPad * 2 - colGap) / 2;
    const bodyH = Math.max(leftTotalH, rightTotalH);
    const panelH = topBandH + bodyH + panelPad;
    const panelTop = s.layout.gameH / 2 - panelH / 2;
    const panelLeft = s.layout.gameW / 2 - panelW / 2;
    const leftX = panelLeft + panelPad;
    const rightX = leftX + colW + colGap;
    const bodyTop = panelTop + topBandH;

    // Overlay background & box (backdrop 199 / box 200).
    const boxConfig = {
      width: panelW,
      height: panelH,
      color: 0x000000,
      alpha: 1.0,
      depth: 200,
    };
    const overlay = createOverlayBackground(
      s,
      { depth: 199, alpha: 0.75 },
      boxConfig,
    );
    if (overlay.box) {
      // Position box center at panel top + panel height / 2
      overlay.box.y = panelTop + panelH / 2;
    }
    s.overlayObjects.push(...overlay.objects);

    // Game-over feedback (AGENTS.md rule 8): win → confetti burst + victory
    // fanfare; loss → low sting + brief board dim pulse. Non-blocking; the
    // animator skips itself in replay/headless mode and plays sound only
    // under reduced motion.
    s.msAnimator?.animateGameOver({
      win: isWin,
      width: s.layout.gameW,
      height: s.layout.gameH,
    });

    // ── Top band: title + explicit end-reason headline ──────────
    const titleText = s.add.text(s.layout.gameW / 2, panelTop + 32, title, {
      fontSize: '34px', fontStyle: 'bold', color, fontFamily: FONT_FAMILY,
    }).setOrigin(0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(titleText);
    s.overlayObjects.push(titleText);

    const reasonText = s.add.text(s.layout.gameW / 2, panelTop + 70, endReasonHeadline, {
      fontSize: '18px', color: '#ccbbaa', fontFamily: FONT_FAMILY, align: 'center',
    }).setOrigin(0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(reasonText);
    s.overlayObjects.push(reasonText);

    // ── Left "Game State" column ────────────────────────────────
    const leftHeader = s.add.text(leftX, bodyTop, 'Game State', {
      fontSize: '16px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    }).setOrigin(0, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(leftHeader);
    s.overlayObjects.push(leftHeader);

    let leftY = bodyTop + 26;
    for (const row of playerRows) {
      const badge = formatCompetitiveScoreboardBadge(row);
      const line = `${row.label}: ${row.coins}c  ${row.reputation}r  ${row.score}pt`
        + (badge ? `  — ${badge}` : '');
      const rowColor = row.badge ? '#ff8888' : (row.isHuman ? '#ddccbb' : '#bbaa99');
      const rowText = s.add.text(leftX, leftY, line, {
        fontSize: '14px', color: rowColor, fontFamily: FONT_FAMILY,
      }).setOrigin(0, 0).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(rowText);
      s.overlayObjects.push(rowText);
      leftY += rowH;
    }

    // Challenges met (run-global in the engine).
    leftY += 20;
    const challengesHeader = s.add.text(leftX, leftY, 'Challenges', {
      fontSize: '16px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    }).setOrigin(0, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(challengesHeader);
    s.overlayObjects.push(challengesHeader);
    leftY += 22;

    const metLine = challengeSummary.totalCount > 0
      ? `Met: ${challengeSummary.completedCount} / ${challengeSummary.totalCount}`
      : `Completed: ${completedChallenges.length}`;
    const challengesMet = s.add.text(leftX, leftY, metLine, {
      fontSize: '13px', color: '#ddccbb', fontFamily: FONT_FAMILY,
    }).setOrigin(0, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(challengesMet);
    s.overlayObjects.push(challengesMet);
    leftY += 20;

    for (const item of challengeSummary.items) {
      const icon = item.completed ? '\u2713' : '\u2717'; // checkmark or cross
      const itemColor = item.completed ? '#44ff44' : '#ff6666';
      const itemText = s.add.text(leftX, leftY, `${icon}  ${item.title}`, {
        fontSize: '13px', color: itemColor, fontFamily: FONT_FAMILY,
      }).setOrigin(0, 0).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(itemText);
      s.overlayObjects.push(itemText);
      leftY += 20;
    }

    // ── Right "Summary" column (retained content) ───────────────
    const rightHeader = s.add.text(rightX, bodyTop, 'Summary', {
      fontSize: '16px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    }).setOrigin(0, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(rightHeader);
    s.overlayObjects.push(rightHeader);

    let cursorY = bodyTop + 26;

    // Score breakdown (retained; kept as one joined multi-line text).
    const { coins, reputation } = s.state.resourceBank;
    const challenges = completedChallenges.length;
    const cfg = s.state.config;
    const lines = [
      // Integer economy — whole-number display (CG-0MTIO1M15001E9Y6).
      `Coins: ${Math.round(coins)}`,
      `Reputation: ${Math.round(reputation)}`,
      `Challenges: ${challenges} (x${cfg.challengeBonusPoints} = ${challenges * cfg.challengeBonusPoints})`,
      `Final Score: ${Math.round(result.finalScore)}`,
    ];
    const breakdown = s.add.text(rightX, cursorY, lines.join('\n'), {
      fontSize: '15px', color: '#ddccbb', fontFamily: FONT_FAMILY,
      align: 'left', lineSpacing: 6,
    }).setOrigin(0, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(breakdown);
    s.overlayObjects.push(breakdown);
    cursorY += breakdownH;

    // Per-challenge details (retained).
    if (challengeLineCount > 0) {
      const sectionTitle = s.add.text(rightX, cursorY, 'Challenge Details:', {
        fontSize: '14px', fontStyle: 'bold', color: '#aa9977', fontFamily: FONT_FAMILY,
      }).setOrigin(0, 0).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(sectionTitle);
      s.overlayObjects.push(sectionTitle);
      cursorY += 22;

      for (const ac of activeChallenges) {
        const done = ac.completed;
        const icon = done ? '\u2713' : '\u2717'; // checkmark or cross
        const lineColor = done ? '#44ff44' : '#ff6666';
        const challengeLine = s.add.text(rightX, cursorY, `${icon}  ${ac.challenge.title}`, {
          fontSize: '13px', color: lineColor, fontFamily: FONT_FAMILY,
        }).setOrigin(0, 0).setDepth(201);
        if (s.hudContainer) s.hudContainer.add(challengeLine);
        s.overlayObjects.push(challengeLine);
        cursorY += 20;
      }
    }

    // ── Meta-progression: Tier Unlock Notifications (retained) ──
    if (newlyUnlockedTiers.length > 0) {
      cursorY += 8;
      const unlockHeader = s.add.text(rightX, cursorY, 'Tier Unlocked!', {
        fontSize: '14px', fontStyle: 'bold', color: '#44ff44', fontFamily: FONT_FAMILY,
      }).setOrigin(0, 0).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(unlockHeader);
      s.overlayObjects.push(unlockHeader);
      cursorY += 22;

      for (const tierId of newlyUnlockedTiers) {
        const def = TIER_DEFINITIONS[tierId];
        if (!def) continue;

        // Find the milestone record to determine the trigger type
        const milestone = s.campaign?.milestoneHistory.find(
          (m: any) => m.tierId === tierId,
        );
        const triggerLabel = milestone?.triggerType === 'challenge'
          ? '(via challenges)' : '(via reputation)';

        const tierLine = s.add.text(
          rightX, cursorY,
          `NEW: Tier ${def.order} - ${def.name} ${triggerLabel}`,
          { fontSize: '13px', color: '#88ff88', fontFamily: FONT_FAMILY },
        ).setOrigin(0, 0).setDepth(201);
        if (s.hudContainer) s.hudContainer.add(tierLine);
        s.overlayObjects.push(tierLine);
        cursorY += 20;

        // Show count of new cards added by this tier
        const cardCount = def.newCardIds.length;
        const countLine = s.add.text(
          rightX, cursorY,
          `  + ${cardCount} new card${cardCount === 1 ? '' : 's'}`,
          { fontSize: '12px', color: '#aaddaa', fontFamily: FONT_FAMILY },
        ).setOrigin(0, 0).setDepth(201);
        if (s.hudContainer) s.hudContainer.add(countLine);
        s.overlayObjects.push(countLine);
        cursorY += 16;
      }
    }

    // ── Meta-progression: Current Tier + Campaign Stats (retained) ──
    if (s.campaign) {
      cursorY += 8;
      const highest = highestUnlockedTier(s.campaign.unlockedTiers);
      const tierCount = ORDERED_TIER_DEFINITIONS.length;
      const tierLabel = highest
        ? `Current Tier: ${highest.order} / ${tierCount} - ${highest.name}`
        : 'Current Tier: --';
      const tierIndicator = s.add.text(rightX, cursorY, tierLabel, {
        fontSize: '14px', fontStyle: 'bold', color: '#ddbb88', fontFamily: FONT_FAMILY,
      }).setOrigin(0, 0).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(tierIndicator);
      s.overlayObjects.push(tierIndicator);
      cursorY += 22;

      const winRate = s.campaign.totalRuns > 0
        ? Math.round((s.campaign.totalWins / s.campaign.totalRuns) * 100)
        : 0;
      const statsLines = [
        `Runs: ${s.campaign.totalRuns}  |  Wins: ${s.campaign.totalWins}  (${winRate}%)`,
        `High Score: ${Math.round(s.campaign.highestScore)}  |  Best Rep: ${s.campaign.persistentReputation}`,
      ];
      const statsText = s.add.text(rightX, cursorY, statsLines.join('\n'), {
        fontSize: '13px', color: '#bbaa99', fontFamily: FONT_FAMILY,
        align: 'left', lineSpacing: 4,
      }).setOrigin(0, 0).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(statsText);
      s.overlayObjects.push(statsText);
    }

    // ── Controls anchored at the panel bottom ───────────────────
    const diffY = panelTop + panelH - 58;
    const diffLabel = s.add.text(
      rightX, diffY,
      `Difficulty: ${s.selectedDifficulty}`,
      { fontSize: '14px', color: '#ccbbaa', fontFamily: FONT_FAMILY },
    ).setOrigin(0, 0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(diffLabel);
    s.overlayObjects.push(diffLabel);

    const cycleBtn = s.add.text(
      rightX + colW, diffY,
      '[ Change ]',
      { fontSize: '14px', color: '#ffdd88', fontFamily: FONT_FAMILY },
    ).setOrigin(1, 0.5).setDepth(201).setInteractive({ useHandCursor: true });
    cycleBtn.on('pointerdown', () => {
      const idx = DIFFICULTY_NAMES.indexOf(s.selectedDifficulty);
      s.selectedDifficulty = DIFFICULTY_NAMES[(idx + 1) % DIFFICULTY_NAMES.length];
      diffLabel.setText(`Difficulty: ${s.selectedDifficulty}`);
    });
    if (s.hudContainer) s.hudContainer.add(cycleBtn);
    s.overlayObjects.push(cycleBtn);

    // Buttons (positioned relative to panel bottom). Two continuation offers
    // can be open at game over:
    //   - Last-standing (`endReason === 'last_standing'`) presents
    //     [ Continue Solo ] (MS-0MUVQRCQJ00737UV AC4).
    //   - Endless mode (`endReason === 'score_threshold_continue'`) presents
    //     [ Enter Endless Mode ] so the player can keep building beyond the
    //     threshold (CG-0MTIILU5V006GCN4).
    const btnY = panelTop + panelH - 28;
    const centerX = s.layout.gameW / 2;
    const canContinueSolo = s.state.endReason === 'last_standing';
    const canEnterEndless = s.state.endReason === 'score_threshold_continue';
    const hasContinuationOffer = canContinueSolo || canEnterEndless;

    if (canEnterEndless) {
      const endlessBtn = createOverlayButton(
        s, centerX - 200, btnY,
        '[ Enter Endless Mode ]', 201,
      );
      endlessBtn.on('pointerdown', () => {
        dismissOverlay(s.overlayObjects);
        s.overlayObjects = [];
        // Resume play via the scene's turn controller. Idempotent: the
        // controller is a no-op unless the endless offer is still open.
        s.msTurnController?.continueEndlessMode?.();
      });
      if (s.hudContainer) s.hudContainer.add(endlessBtn);
      s.overlayObjects.push(endlessBtn);
    }

    if (canContinueSolo) {
      const continueBtn = createOverlayButton(
        s, centerX - 200, btnY,
        '[ Continue Solo ]', 201,
      );
      continueBtn.on('pointerdown', () => {
        dismissOverlay(s.overlayObjects);
        s.overlayObjects = [];
        // Resume play via the scene's turn controller. Idempotent: the
        // controller is a no-op unless the last-standing offer is still open.
        s.msTurnController?.continueCompetitiveLastStanding?.();
      });
      if (s.hudContainer) s.hudContainer.add(continueBtn);
      s.overlayObjects.push(continueBtn);
    }

    const playAgainBtn = createOverlayButton(
      s, hasContinuationOffer ? centerX : centerX - 110, btnY,
      '[ Play Again ]', 201,
    );
    playAgainBtn.on('pointerdown', () => {
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      s.scene.restart();
    });
    if (s.hudContainer) s.hudContainer.add(playAgainBtn);
    s.overlayObjects.push(playAgainBtn);

    const menuBtn = createOverlayButton(
      s, hasContinuationOffer ? centerX + 200 : centerX + 110, btnY,
      '[ Menu ]', 201,
    );
    menuBtn.on('pointerdown', () => {
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      s.scene.start('GameSelectorScene');
    });
    if (s.hudContainer) s.hudContainer.add(menuBtn);
    s.overlayObjects.push(menuBtn);
  }
  /**
   * Shows the Manage Card overlay for a card on the street grid.
   *
   * Presents card info, the sell refund, and [Sell] [Close] [Cancel] buttons.
   * Sell keeps its existing free/refund behaviour (the card stays on the grid
   * as an inert sold marker). Close spends exactly one daily action, grants no
   * coins, and removes the card from the street entirely so the slot becomes
   * placeable again — the action cost is charged by `closeBusinessCommand`
   * through the shared `consumeAction` enforcement point.
   *
   * All text/buttons are parented into `hudContainer` and use the overlay
   * depth convention (backdrop 199, box 200, interactive 201).
   *
   * When the card employs staff (job applicants, CG-0MSTOATDU006UGAX) the
   * dialog also lists them and offers `[ Lay off ]`, which charges 1 turn's
   * salary (clamped at 0 coins) + 1 reputation through `letGoStaffCommand`.
   *
   * @param slotIndex The grid slot index of the card to manage.
   * @param cardName  Display name of the card.
   * @param refund    Calculated sell refund amount in coins (Sell only).
   * @param info      Detailed card info text for display.
   */
  public showSellConfirmation(
    slotIndex: number,
    cardName: string,
    refund: number,
    info: string,
  ): void {
    const s = this.scene;

    // Staff employed at this street card (CG-0MSTOATDU006UGAX): surfaced here
    // so the player can actually let a member go. Their index in
    // `state.staffCards` is what `letGoStaffCommand` expects.
    const allStaff: StaffCard[] = (s.state.staffCards ?? []) as StaffCard[];
    const employedStaff = allStaff
      .map((member, index) => ({ member, index }))
      .filter(({ member }) => member.employedAtSlot === slotIndex);

    const panelW = 480;
    // Extra height for the employed-staff row when it is present.
    const panelH = employedStaff.length > 0 ? 410 : 360;
    const panelY = s.layout.gameH / 2 - panelH / 2;
    const centerX = s.layout.gameW / 2;

    // Overlay background with semi-transparent backdrop
    const boxConfig = {
      width: panelW,
      height: panelH,
      color: 0x000000,
      alpha: 1.0,
      depth: 200,
    };
    const overlay = createOverlayBackground(
      s,
      { depth: 199, alpha: 0.6 },
      boxConfig,
    );
    s.overlayObjects.push(...overlay.objects);

    // Title
    const titleText = s.add.text(centerX, panelY + 24, 'Manage Card', {
      fontSize: '22px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    }).setOrigin(0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(titleText);
    s.overlayObjects.push(titleText);

    // Card info text
    const infoText = s.add.text(centerX, panelY + 58, info, {
      fontSize: '13px',
      color: '#ddccbb',
      fontFamily: FONT_FAMILY,
      align: 'center',
      lineSpacing: 4,
    }).setOrigin(0.5, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(infoText);
    s.overlayObjects.push(infoText);

    // Sale value highlight (Sell only — Close grants no coins)
    const saleValueText = s.add.text(centerX, panelY + 186, `Sale value: +€${refund}`, {
      fontSize: '20px', fontStyle: 'bold', color: '#44ff44', fontFamily: FONT_FAMILY,
    }).setOrigin(0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(saleValueText);
    s.overlayObjects.push(saleValueText);

    // Close cost line — makes the 1-action / no-coins cost explicit
    const closeCostText = s.add.text(
      centerX, panelY + 214,
      'Close: costs 1 action, no refund — removes the card and frees the slot.',
      { fontSize: '12px', color: '#ffcc88', fontFamily: FONT_FAMILY, align: 'center' },
    ).setOrigin(0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(closeCostText);
    s.overlayObjects.push(closeCostText);

    // Sell button — existing free/refund behaviour, unchanged
    const sellBtn = createOverlayButton(
      s, centerX - 150, panelY + 265,
      '[ Sell ]', 201,
    );
    if (s.hudContainer) s.hudContainer.add(sellBtn);
    sellBtn.on('pointerdown', () => {
      // Defensive ownership/legality guard (MS-0MUVPGA3A001TGGT): the dialog
      // is only opened for an owned, sellable slot, but guard the handler too
      // so a stale overlay can never sell an opponent's business.
      const sellLegality = canSellBusiness(s.state, slotIndex, false);
      if (!sellLegality.legal) {
        safePlaySound(s, COMMON_SFX_KEYS.ILLEGAL_MOVE);
        s.instructionText?.setText(`Cannot sell: ${sellLegality.reason ?? 'unknown'}`);
        dismissOverlay(s.overlayObjects);
        s.overlayObjects = [];
        s.refreshAll();
        return;
      }

      // Execute the sell
      let sold = false;
      try {
        const cmd = sellBusinessCommand(s.state, slotIndex);
        // Execute via undo manager if available, otherwise direct
        if (s.undoManager) {
          s.undoManager.execute(cmd);
        } else {
          cmd.execute();
        }
        addLog(s.state, `Sold ${cardName} from slot ${slotIndex} for +${refund} coins`, 'gain');
        s.instructionText?.setText(`Sold ${cardName} for +€${refund}`);
        sold = true;
      } catch (e) {
        console.error('[Sell] Failed:', e);
        s.instructionText?.setText(`Error selling: ${(e as Error).message}`);
      }

      // Dismiss the overlay
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      s.refreshAll();
      // The sale (when it succeeded) added a command to the undo stack —
      // refresh the HUD buttons so Undo becomes clickable (CG-0MT5Y4DL8000AKKZ).
      s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
      // Sell demolition + refund coin fly when the sale succeeded
      // (presentation-only; the dimmed SOLD state renders synchronously
      // above and the animator's snapshot reveals it after the demolition).
      if (sold) {
        const soldCard = s.state.streetGrid[slotIndex];
        try {
          void s.msAnimator.animateSell({
            slotIndex,
            refund,
            cardId: soldCard?.id ?? '',
            family: soldCard?.family === 'community-space' ? 'community-space' : 'business',
          });
        } catch (_) {
          // presentation-only — ignore
        }
      }
    });
    s.overlayObjects.push(sellBtn);

    // Close button — 1 action, no coins, removes the card from the street
    const closeBtn = createOverlayButton(
      s, centerX, panelY + 265,
      '[ Close ]', 201,
    );
    if (s.hudContainer) s.hudContainer.add(closeBtn);
    closeBtn.on('pointerdown', () => {
      let closed = false;
      let failureReason = 'unknown';
      let closedCardId = '';
      let closedFamily: 'business' | 'community-space' = 'business';
      try {
        const legality = canCloseBusiness(s.state, slotIndex, false);
        if (!legality.legal) {
          failureReason = legality.reason ?? 'unknown';
        } else {
          // Capture identity before the card is removed from the grid.
          const cardNow = s.state.streetGrid[slotIndex];
          closedCardId = cardNow?.id ?? '';
          closedFamily = cardNow?.family === 'community-space' ? 'community-space' : 'business';

          const cmd = closeBusinessCommand(s.state, slotIndex);
          if (s.undoManager) {
            s.undoManager.execute(cmd);
          } else {
            cmd.execute();
          }
          s.instructionText?.setText(`Closed ${cardName} (−1 action)`);
          closed = true;
        }
      } catch (e) {
        console.error('[Close] Failed:', e);
        failureReason = (e as Error).message;
      }

      // Dismiss the overlay
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      s.refreshAll();
      // A successful close added a command to the undo stack — refresh the
      // HUD buttons (CG-0MT5Y4DL8000AKKZ).
      s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());

      if (closed) {
        // Demolition (card to discard) — no refund coin fly for a close.
        try {
          void s.msAnimator.animateClose({
            slotIndex,
            cardId: closedCardId,
            family: closedFamily,
          });
        } catch (_) {
          // presentation-only — ignore
        }
      } else {
        // Illegal close (no actions, sold, empty, wrong phase): auditable
        // feedback with no state mutation.
        safePlaySound(s, COMMON_SFX_KEYS.ILLEGAL_MOVE);
        s.instructionText?.setText(`Cannot close: ${failureReason}`);
      }
    });
    s.overlayObjects.push(closeBtn);

    // Cancel button
    const cancelBtn = createOverlayButton(
      s, centerX + 150, panelY + 265,
      '[ Cancel ]', 201,
    );
    if (s.hudContainer) s.hudContainer.add(cancelBtn);
    cancelBtn.on('pointerdown', () => {
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      s.instructionText?.setText('Cancelled.');
    });
    s.overlayObjects.push(cancelBtn);

    // ── Employed staff / lay-off (CG-0MSTOATDU006UGAX) ──────────────
    // Only rendered when somebody is actually employed here — no empty row
    // and no button otherwise. Laying off the most recently hired member
    // costs 1 turn's salary (clamped at 0 coins) + 1 reputation.
    if (employedStaff.length > 0) {
      const names = employedStaff.map(({ member }) => member.name).join(', ');
      const staffLine = s.add.text(
        centerX, panelY + 305,
        `Employed here: ${names}\nMove: costs 1 action. Lay off: costs 1 turn's salary + 1 reputation.`,
        { fontSize: '12px', color: '#ffcc88', fontFamily: FONT_FAMILY, align: 'center' },
      ).setOrigin(0.5).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(staffLine);
      s.overlayObjects.push(staffLine);

      // Move-staff affordance (MS-0MUOSULQ700186PP AC2): begins a relocation
      // targeting the most recently hired member (same convention as Lay off).
      // The 1-action cost is stated on the button and in the line above.
      const moveStaffBtn = createOverlayButton(s, centerX - 110, panelY + 352, '[ Move staff (1 action) ]', 201);
      if (s.hudContainer) s.hudContainer.add(moveStaffBtn);
      const moveTarget = employedStaff[employedStaff.length - 1];
      // Hover tooltip (MS-0MUOSULQ700186PP AC2): states the 1-action cost and
      // the legal destination businesses, from the pure affordance builder.
      moveStaffBtn.on('pointerover', () => {
        const affordance = buildMoveStaffAffordance(s.state, moveTarget.member.id);
        s.tooltipManager?.show(affordance.tooltip, moveStaffBtn.x, moveStaffBtn.y);
      });
      moveStaffBtn.on('pointerout', () => s.tooltipManager?.hide());
      moveStaffBtn.on('pointerdown', () => {
        dismissOverlay(s.overlayObjects);
        s.overlayObjects = [];
        s.beginStaffMove(moveTarget.member.id);
      });
      s.overlayObjects.push(moveStaffBtn);

      const layOffBtn = createOverlayButton(s, centerX + 110, panelY + 352, '[ Lay off ]', 201);
      if (s.hudContainer) s.hudContainer.add(layOffBtn);
      layOffBtn.on('pointerdown', () => {
        const target = employedStaff[employedStaff.length - 1];
        let laidOff = false;
        try {
          const cmd = letGoStaffCommand(s.state, target.index);
          if (s.undoManager) {
            s.undoManager.execute(cmd);
          } else {
            cmd.execute();
          }
          addLog(
            s.state,
            `Laid off ${target.member.name} (−1 salary, −1 reputation)`,
            'loss',
          );
          s.instructionText?.setText(`Laid off ${target.member.name} (−1 reputation)`);
          laidOff = true;
        } catch (e) {
          console.error('[LayOff] Failed:', e);
          s.instructionText?.setText(`Error laying off: ${(e as Error).message}`);
        }

        dismissOverlay(s.overlayObjects);
        s.overlayObjects = [];
        s.refreshAll();
        // A successful lay-off added a command to the undo stack — refresh
        // the HUD buttons (CG-0MT5Y4DL8000AKKZ).
        s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());

        // The member leaves the business: discard SFX, illegal-move feedback
        // on failure. Presentation-only — state is already committed above.
        safePlaySound(s, laidOff ? SFX_KEYS.DISCARD : COMMON_SFX_KEYS.ILLEGAL_MOVE);
      });
      s.overlayObjects.push(layOffBtn);
    }
  }

  /**
   * Shows the buy-and-play premium explainer dialog.
   *
   * Fires when a same-turn buy-and-play (click composite or drag) will incur
   * the +50% premium because no action is available (CG-0MT24X0SX007RLHN).
   * Explains the rule, offers Proceed / Cancel, and a persisted "Don't show
   * this again" checkbox (localStorage, mirroring SettingsStore patterns).
   *
   * @param cardName Display name of the card being placed.
   * @param onProceed Callback invoked when the player proceeds (placement
   *                  continues at the premium price).
   * @param onCancel  Callback invoked when the player cancels (placement
   *                  aborts, no coins deducted).
   */
  public showBuyAndPlacePremiumDialog(
    cardName: string,
    onProceed: () => void,
    onCancel: () => void,
  ): void {
    const s = this.scene;
    if (isBuyAndPlacePremiumDialogDismissed()) {
      // Preference persisted: dialog does not fire, placement proceeds.
      onProceed();
      return;
    }

    const panelW = 440;
    const panelH = 250;
    const panelY = s.layout.gameH / 2 - panelH / 2;

    // Overlay background with semi-transparent backdrop (depth 199 backdrop,
    // 200 box, 201 elements — UI Best Practices, AGENTS.md).
    const boxConfig = {
      width: panelW,
      height: panelH,
      color: 0x000000,
      alpha: 1.0,
      depth: 200,
    };
    const overlay = createOverlayBackground(
      s,
      { depth: 199, alpha: 0.6 },
      boxConfig,
    );
    s.overlayObjects.push(...overlay.objects);

    // Title
    const titleText = s.add.text(s.layout.gameW / 2, panelY + 25, 'Buy & Place Premium', {
      fontSize: '20px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    }).setOrigin(0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(titleText);
    s.overlayObjects.push(titleText);

    // Explanation body
    const bodyText = s.add.text(s.layout.gameW / 2, panelY + 75,
      `Placing "${cardName}" in the same turn costs 50% more because you have no actions left.`,
      {
        fontSize: '14px',
        color: '#ddccbb',
        fontFamily: FONT_FAMILY,
        align: 'center',
        lineSpacing: 4,
        wordWrap: { width: panelW - 60 },
      },
    ).setOrigin(0.5, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(bodyText);
    s.overlayObjects.push(bodyText);

    // "Don't show this again" checkbox (toggleable text button)
    let dontShowAgain = false;
    const checkLabel = s.add.text(
      s.layout.gameW / 2, panelY + 145,
      '[ ] Don\'t show this again',
      { fontSize: '14px', color: '#ccbbaa', fontFamily: FONT_FAMILY },
    ).setOrigin(0.5).setDepth(201).setInteractive({ useHandCursor: true });
    if (s.hudContainer) s.hudContainer.add(checkLabel);
    checkLabel.on('pointerdown', () => {
      dontShowAgain = !dontShowAgain;
      checkLabel.setText(dontShowAgain ? '[x] Don\'t show this again' : '[ ] Don\'t show this again');
    });
    s.overlayObjects.push(checkLabel);

    // Proceed button
    const proceedBtn = createOverlayButton(
      s, s.layout.gameW / 2 - 110, panelY + 195,
      '[ Proceed ]', 201,
    );
    if (s.hudContainer) s.hudContainer.add(proceedBtn);
    proceedBtn.on('pointerdown', () => {
      if (dontShowAgain) setBuyAndPlacePremiumDialogDismissed(true);
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      onProceed();
    });
    s.overlayObjects.push(proceedBtn);

    // Cancel button
    const cancelBtn = createOverlayButton(
      s, s.layout.gameW / 2 + 40, panelY + 195,
      '[ Cancel ]', 201,
    );
    if (s.hudContainer) s.hudContainer.add(cancelBtn);
    cancelBtn.on('pointerdown', () => {
      if (dontShowAgain) setBuyAndPlacePremiumDialogDismissed(true);
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      onCancel();
    });
    s.overlayObjects.push(cancelBtn);
  }

  /**
   * Shows the undo-challenge warning dialog (CG-0MU37CKRR008252I).
   *
   * Presented by `performUndo` when the command about to be undone completed
   * one or more challenges, whose completions would be revoked. Offers
   * "Keep Completed" (aborts the undo entirely — no state change) and
   * "Undo Anyway" (proceeds with the undo, revoking the completions).
   *
   * Overlay pattern compliance (AGENTS.md UI Best Practices):
   * `createOverlayBackground` + `createOverlayButton`; ALL elements are
   * parented into `s.hudContainer`; depths 199 (backdrop) / 200 (box) /
   * 201 (interactive). No animations, so reduced motion is inherently
   * respected.
   *
   * @param challengeTitles Titles of the challenges that would be revoked.
   * @param onConfirm       Called when the player chooses "Undo Anyway".
   * @param onCancel        Called when the player chooses "Keep Completed".
   */
  public showUndoChallengeWarningDialog(
    challengeTitles: string[],
    onConfirm: () => void,
    onCancel: () => void,
  ): void {
    const s = this.scene;
    const panelW = 460;
    const lineH = 22;
    const panelH = 210 + challengeTitles.length * lineH;
    const panelY = s.layout.gameH / 2 - panelH / 2;

    const boxConfig = { width: panelW, height: panelH, color: 0x000000, alpha: 1.0, depth: 200 };
    const overlay = createOverlayBackground(s, { depth: 199, alpha: 0.6 }, boxConfig);
    s.overlayObjects.push(...overlay.objects);

    const titleText = s.add.text(
      s.layout.gameW / 2, panelY + 25,
      t(UNDO_CHALLENGE_I18N_KEYS.title),
      { fontSize: '20px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY },
    ).setOrigin(0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(titleText);
    s.overlayObjects.push(titleText);

    const bodyText = s.add.text(
      s.layout.gameW / 2, panelY + 65,
      t(UNDO_CHALLENGE_I18N_KEYS.body),
      {
        fontSize: '14px',
        color: '#ddccbb',
        fontFamily: FONT_FAMILY,
        align: 'center',
        lineSpacing: 4,
        wordWrap: { width: panelW - 60 },
      },
    ).setOrigin(0.5, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(bodyText);
    s.overlayObjects.push(bodyText);

    challengeTitles.forEach((title, index) => {
      const itemText = s.add.text(
        s.layout.gameW / 2, panelY + 108 + index * lineH,
        t(UNDO_CHALLENGE_I18N_KEYS.item, { title }),
        { fontSize: '14px', color: '#ffdd88', fontFamily: FONT_FAMILY },
      ).setOrigin(0.5).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(itemText);
      s.overlayObjects.push(itemText);
    });

    const buttonY = panelY + panelH - 42;

    const keepBtn = createOverlayButton(
      s, s.layout.gameW / 2 - 110, buttonY,
      `[ ${t(UNDO_CHALLENGE_I18N_KEYS.keep)} ]`, 201,
    );
    if (s.hudContainer) s.hudContainer.add(keepBtn);
    keepBtn.on('pointerdown', () => {
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      onCancel();
    });
    s.overlayObjects.push(keepBtn);

    const confirmBtn = createOverlayButton(
      s, s.layout.gameW / 2 + 60, buttonY,
      `[ ${t(UNDO_CHALLENGE_I18N_KEYS.confirm)} ]`, 201,
    );
    if (s.hudContainer) s.hudContainer.add(confirmBtn);
    confirmBtn.on('pointerdown', () => {
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      onConfirm();
    });
    s.overlayObjects.push(confirmBtn);
  }

  /**
   * Shows the dual-choice incident dialog (CG-0MTSHG8RP008E128).
   *
   * Presented when `processEndOfTurn` pauses with `choicePending` after a
   * `hasChoices` incident was drawn (IncidentPhase). The player decides
   * whether to Accept (the event's stated consequence applies) or Reject
   * (the consequence is refused; an unknown escalation card is added to the
   * incident deck). No preview of the escalation is shown — only the two
   * buttons (AC13). Accepting or rejecting an incident is FREE (no action
   * cost) — the player is forced to respond, not choosing to engage.
   *
   * Overlay pattern compliance (AGENTS.md UI Best Practices):
   * createOverlayBackground + createOverlayButton from @ui; ALL elements are
   * parented into `s.hudContainer`; depths 199 (backdrop) / 200 (box) /
   * 201 (elements). Dialog appears instantly (no fade-in — reduced-motion
   * safe); button SFX plays through safePlaySound (respects mute/volume).
   * Cleanup on dismissal resets `s.overlayObjects`.
   *
   * @param event    The pending choice event (effect deferred).
   * @param onAccept Called when the player accepts the consequence.
   * @param onReject Called when the player refuses the consequence.
   */
  public showEventChoiceDialog(
    event: EventCard,
    onAccept: () => void,
    onReject: () => void,
  ): void {
    const s = this.scene;
    if (s.replayMode) return; // headless/replay: never present UI

    const panelW = 500;
    const panelH = 300;
    const panelY = s.layout.gameH / 2 - panelH / 2;

    // Overlay background with semi-transparent backdrop (199 / 200 / 201).
    const boxConfig = {
      width: panelW,
      height: panelH,
      color: 0x000000,
      alpha: 1.0,
      depth: 200,
    };
    const overlay = createOverlayBackground(
      s,
      { depth: 199, alpha: 0.6 },
      boxConfig,
    );
    s.overlayObjects.push(...overlay.objects);

    // Title: the storyline name when available (fallback: the card name), so
    // the player knows which arc they are in (MS-0MUMP96XH002SJ89 AC1).
    const titleText = s.add.text(s.layout.gameW / 2, panelY + 22, choiceDialogTitle(event), {
      fontSize: '21px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
      align: 'center',
      wordWrap: { width: panelW - 60 },
    }).setOrigin(0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(titleText);
    s.overlayObjects.push(titleText);

    // Subtitle: the specific incident within the storyline (omitted for legacy
    // choice cards without a storyline).
    const subtitle = choiceDialogSubtitle(event);
    if (subtitle) {
      const subtitleText = s.add.text(s.layout.gameW / 2, panelY + 50, subtitle, {
        fontSize: '14px', fontStyle: 'italic', color: '#bbaa88', fontFamily: FONT_FAMILY,
        align: 'center', wordWrap: { width: panelW - 60 },
      }).setOrigin(0.5).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(subtitleText);
      s.overlayObjects.push(subtitleText);
    }

    // Body: what Accept does (the card's stated effect). No preview of the
    // escalation either way — rejecting keeps the consequence unknown.
    const bodyText = s.add.text(
      s.layout.gameW / 2, panelY + 78,
      `An incident has occurred.\nAccept: ${event.effect}\nReject: refuse this consequence — a different event will replace it.`,
      {
        fontSize: '13px',
        color: '#ddccbb',
        fontFamily: FONT_FAMILY,
        align: 'center',
        lineSpacing: 4,
        wordWrap: { width: panelW - 70 },
      },
    ).setOrigin(0.5, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(bodyText);
    s.overlayObjects.push(bodyText);

    // Choice clarity (MS-0MUMP97LQ006PP1D AC3): explanatory labels describing
    // the consequence semantics (apply vs skip). They deliberately never name
    // the escalation card — the tension is preserved.
    const clarity = choiceClarityLabels(event);
    const acceptClarity = s.add.text(s.layout.gameW / 2, panelY + 158, clarity.accept, {
      fontSize: '12px', color: '#99cc99', fontFamily: FONT_FAMILY,
      align: 'center', wordWrap: { width: panelW - 60 },
    }).setOrigin(0.5, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(acceptClarity);
    s.overlayObjects.push(acceptClarity);

    const rejectClarity = s.add.text(s.layout.gameW / 2, panelY + 190, clarity.reject, {
      fontSize: '12px', color: '#cc9988', fontFamily: FONT_FAMILY,
      align: 'center', wordWrap: { width: panelW - 60 },
    }).setOrigin(0.5, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(rejectClarity);
    s.overlayObjects.push(rejectClarity);

    // Accept button — label carries the event name per AC14: "Service Workers
    // Strike (Accept)". Accepting is the safe path (no escalation).
    const acceptBtn = createOverlayButton(
      s, s.layout.gameW / 2 - 145, panelY + panelH - 45,
      `${event.name} (Accept)`, 201,
      { fontSize: '13px', color: '#88ff88', hoverColor: '#aaffaa' },
    );
    if (s.hudContainer) s.hudContainer.add(acceptBtn);
    acceptBtn.on('pointerdown', () => {
      // Button SFX always plays (reduced motion keeps sound).
      safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      onAccept();
    });
    s.overlayObjects.push(acceptBtn);

    // Reject button — bare "Reject": the player accepts an unknown
    // consequence may follow (AC15).
    const rejectBtn = createOverlayButton(
      s, s.layout.gameW / 2 + 145, panelY + panelH - 45,
      'Reject', 201,
      { fontSize: '13px', color: '#ffaa88', hoverColor: '#ffccaa' },
    );
    if (s.hudContainer) s.hudContainer.add(rejectBtn);
    rejectBtn.on('pointerdown', () => {
      safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      onReject();
    });
    s.overlayObjects.push(rejectBtn);
  }

  /**
   * Shows the storyline journal overlay (MS-0MUMP97LQ006PP1D).
   *
   * Lists past storyline choices and their outcomes (from the activity log's
   * story-update lines), most recent first, with a sensible empty state before
   * any choice has been made.
   *
   * Overlay pattern compliance: `createOverlayBackground` + `createOverlayButton`
   * from @ui; ALL elements are parented into `s.hudContainer`; depths 199
   * (backdrop) / 200 (box) / 201 (interactive). No animations (reduced-motion
   * safe). Cleanup on dismissal resets `s.overlayObjects`.
   *
   * @param onClose Called after the overlay is dismissed.
   */
  public showStorylineJournalDialog(onClose?: () => void): void {
    const s = this.scene;
    if (s.replayMode) return; // headless/replay: never present UI

    const entries = buildJournal(s.state);
    const empty = journalIsEmpty(s.state);
    const maxRows = 10;
    const rowH = 34;
    const shown = entries.slice(0, maxRows);
    const panelW = 560;
    const panelH = Math.max(240, 150 + Math.max(1, shown.length) * rowH);
    const panelY = s.layout.gameH / 2 - panelH / 2;

    const boxConfig = { width: panelW, height: panelH, color: 0x000000, alpha: 1.0, depth: 200 };
    const overlay = createOverlayBackground(s, { depth: 199, alpha: 0.6 }, boxConfig);
    s.overlayObjects.push(...overlay.objects);

    const titleText = s.add.text(s.layout.gameW / 2, panelY + 24, journalTitle(s.state), {
      fontSize: '20px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
      align: 'center', wordWrap: { width: panelW - 60 },
    }).setOrigin(0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(titleText);
    s.overlayObjects.push(titleText);

    if (empty) {
      // Empty state (AC2) — shown before any storyline choice is made.
      const emptyText = s.add.text(
        s.layout.gameW / 2, panelY + 100,
        'No storyline choices yet.\nYour decisions will appear here as the story unfolds.',
        { fontSize: '14px', color: '#bbaa88', fontFamily: FONT_FAMILY, align: 'center', lineSpacing: 4 },
      ).setOrigin(0.5, 0).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(emptyText);
      s.overlayObjects.push(emptyText);
    } else {
      shown.forEach((entry, index) => {
        const y = panelY + 64 + index * rowH;
        const storyline = s.add.text(20, y, entry.storyline, {
          fontSize: '13px', fontStyle: 'bold', color: '#ffdd99', fontFamily: FONT_FAMILY,
          wordWrap: { width: 180 },
        }).setOrigin(0, 0).setDepth(201);
        if (s.hudContainer) s.hudContainer.add(storyline);
        s.overlayObjects.push(storyline);

        const outcome = s.add.text(210, y, `[Day ${entry.turn}] ${entry.outcome}`, {
          fontSize: '13px', color: '#ddccbb', fontFamily: FONT_FAMILY,
          wordWrap: { width: panelW - 240 },
        }).setOrigin(0, 0).setDepth(201);
        if (s.hudContainer) s.hudContainer.add(outcome);
        s.overlayObjects.push(outcome);
      });
      if (entries.length > maxRows) {
        const moreText = s.add.text(
          s.layout.gameW / 2, panelY + 64 + maxRows * rowH,
          `…and ${entries.length - maxRows} earlier`, {
            fontSize: '12px', fontStyle: 'italic', color: '#998877', fontFamily: FONT_FAMILY,
          },
        ).setOrigin(0.5, 0).setDepth(201);
        if (s.hudContainer) s.hudContainer.add(moreText);
        s.overlayObjects.push(moreText);
      }
    }

    const closeBtn = createOverlayButton(
      s, s.layout.gameW / 2, panelY + panelH - 40, '[ Close ]', 201,
    );
    if (s.hudContainer) s.hudContainer.add(closeBtn);
    closeBtn.on('pointerdown', () => {
      safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      onClose?.();
    });
    s.overlayObjects.push(closeBtn);
  }

  /**
   * Shows the **Card Packs** overlay (F9 / CG-0MUZIS4KZ003R1HP).
   *
   * Renders the reusable, SLL-positioned core `CardPackListing` over the packs
   * discovered at boot ({@link getMainStreetCardPackLoadResult}). Each row shows
   * its installed/unlocked/locked state; locked and incompatible packs are
   * read-only, entitled packs carry an enable/disable control.
   *
   * Toggling re-merges and re-applies the game's card pool immediately
   * ({@link applyEnabledMainStreetPacks}) and persists the enabled set as the
   * new-game preference — so the pool refreshes consistently rather than
   * requiring a restart. A toggle that would strand a card currently in play
   * is refused in place with an explanatory hint. The overlay adds no
   * animation, so reduced motion is honoured by construction, and every
   * interaction plays through `safePlaySound` so mute/volume still apply.
   */
  public showCardPacksDialog(): void {
    const s = this.scene;
    if (s.replayMode) return;

    const load = getMainStreetCardPackLoadResult();
    let enabledIds = resolveEnabledPackIds(load);

    // Modal backdrop (depth 199). The listing draws its own SLL panel and is
    // parented above it (depth 201), matching the overlay depth convention.
    const overlay = createOverlayBackground(s, { depth: 199, alpha: 0.6 });
    s.overlayObjects.push(...overlay.objects);

    const listing = new CardPackListing(s, {
      result: toCardPackListingInput(load, enabledIds),
      onToggle: (state) => {
        const nextIds = enabledCardPackIds(state);
        const outcome = applyEnabledMainStreetPacks(load, nextIds, {
          state: s.state,
        });
        if (!outcome.applied) {
          // Refused (a live card needs the pack): revert the rendered toggle
          // and explain the refusal without changing the pool.
          safePlaySound(s, COMMON_SFX_KEYS.ILLEGAL_MOVE);
          listing.setResult(toCardPackListingInput(load, enabledIds));
          s.instructionText?.setText?.(
            outcome.reason ?? 'That pack cannot be disabled right now.',
          );
          return;
        }
        safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
        enabledIds = outcome.enabledPackIds;
      },
      onClose: () => this.closeCardPacksDialog(listing),
    });

    const container = listing.gameObject;
    container.setDepth(201);
    if (s.hudContainer) s.hudContainer.add(container);
    s.overlayObjects.push(container);
  }

  /** Dismiss the Card Packs overlay and release its listing objects. */
  private closeCardPacksDialog(listing: CardPackListing): void {
    const s = this.scene;
    safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
    listing.destroy();
    dismissOverlay(s.overlayObjects);
    s.overlayObjects = [];
  }
}
