import { sellBusinessCommand, closeBusinessCommand, letGoStaffCommand } from '../MainStreetCommands';
import { canCloseBusiness, canSellBusiness } from '../MainStreetMarket';
import { addLog } from '../MainStreetState';
import { flashError, flashConfirmation } from './MainStreetFeedback';
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
  getMainStreetPurchasablePackIds,
  purchaseMainStreetCardPack,
  resolveEnabledPackIds,
  toCardPackListingInput,
} from '../MainStreetCardPacks';
import { COMMON_SFX_KEYS, safePlaySound } from '@core-engine/SoundManager';
import { choiceDialogTitle, choiceDialogSubtitle } from '../MainStreetStorylineUi';
import { buildJournal, journalIsEmpty, journalTitle } from '../MainStreetStorylineJournal';
import { getStorylineOptions } from '../MainStreetStoryline';
import {
  buildGameOverChallengeSummary,
  buildGameOverPlayerRows,
  formatEndReason,
} from './MainStreetGameOverSummary';
import type { TurnSummary } from './MainStreetTurnSummary';
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

/**
 * Formats a signed integer for dialog rows as `+N` / `-N` / `0`. Coins are
 * whole numbers (integer economy, CG-0MTIO1M15001E9Y6), so no rounding is
 * applied here.
 */
function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

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
   *   run's challenges met — a per-seat breakdown in competitive mode (each
   *   seat credited only with its own completions) or the historic single
   *   list in single-player.
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
    // Competitive mode renders one line per seat (each listing only that seat's
    // completions); single-player keeps one line per active challenge.
    const challengeLines = challengeSummary.seats?.length ?? challengeSummary.totalCount;
    const leftChallengesH = 20 + 22 + 20 + challengeLines * 20; // gap + header + met line + lines
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

    // Challenges met. `completedCount` / `totalCount` stay run-global (the
    // union across seats); in competitive mode the lines below are a per-seat
    // breakdown (MS-0MUWNTJIK009O6BZ, Q3 = A).
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

    if (challengeSummary.seats) {
      // Competitive mode: one line per seat listing only the challenges that
      // seat personally completed, so an AI seat's completions are never
      // presented as the human's. A seat with none shows an em dash.
      for (const seat of challengeSummary.seats) {
        const titles = seat.completedTitles.length > 0
          ? seat.completedTitles.join(', ')
          : '\u2014'; // em dash: no completions attributed to this seat
        const seatColor = seat.isHuman ? '#ddccbb' : '#bbaa99';
        const seatText = s.add.text(leftX, leftY, `${seat.label}: ${titles}`, {
          fontSize: '13px', color: seatColor, fontFamily: FONT_FAMILY,
        }).setOrigin(0, 0).setDepth(201);
        if (s.hudContainer) s.hudContainer.add(seatText);
        s.overlayObjects.push(seatText);
        leftY += 20;
      }
    } else {
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
        flashError(s, `Cannot sell: ${sellLegality.reason ?? 'unknown'}`);
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
        flashConfirmation(s, `Sold ${cardName} for +€${refund}`);
        sold = true;
      } catch (e) {
        console.error('[Sell] Failed:', e);
        flashError(s, `Error selling: ${(e as Error).message}`);
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
          flashConfirmation(s, `Closed ${cardName} (−1 action)`);
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
        flashError(s, `Cannot close: ${failureReason}`);
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
      flashConfirmation(s, 'Cancelled.');
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
          flashConfirmation(s, `Laid off ${target.member.name} (−1 reputation)`);
          laidOff = true;
        } catch (e) {
          console.error('[LayOff] Failed:', e);
          flashError(s, `Error laying off: ${(e as Error).message}`);
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
   * Shows the storyline choice dialog (CG-0MTSHG8RP008E128; reworked for the
   * arbitrary multi-outcome model in MS-0MV8KQSF1004E53Y).
   *
   * Presented when `processEndOfTurn` pauses with `choicePending` after a
   * choice incident was drawn (IncidentPhase). The player picks one of the
   * node's **labelled options** (any count ≥ 1) — no hard-coded Accept/Reject
   * buttons. Every CSV-authored option applies the event's own effect (Q4=B)
   * and then draws a candidate successor; the dialog never previews the
   * escalation. Choosing an option is FREE (no action cost) — the player is
   * forced to respond.
   *
   * Overlay pattern compliance (AGENTS.md UI Best Practices):
   * createOverlayBackground + createOverlayButton from @ui; ALL elements are
   * parented into `s.hudContainer`; depths 199 (backdrop) / 200 (box) /
   * 201 (elements). Dialog appears instantly (no fade-in — reduced-motion
   * safe); button SFX plays through safePlaySound (respects mute/volume).
   * Cleanup on dismissal resets `s.overlayObjects`.
   *
   * @param event    The pending choice event (effect deferred).
   * @param onChoose Called with the chosen option's index.
   */
  public showEventChoiceDialog(
    event: EventCard,
    onChoose: (optionIndex: number) => void,
  ): void {
    const s = this.scene;
    if (s.replayMode) return; // headless/replay: never present UI

    const options = getStorylineOptions(event);
    const count = Math.max(options.length, 1);
    const panelW = 500;
    const rowH = 46;
    const panelH = 170 + count * rowH;
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

    // Title: the storyline name when available (fallback: the card name).
    const titleText = s.add.text(s.layout.gameW / 2, panelY + 22, choiceDialogTitle(event), {
      fontSize: '21px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
      align: 'center',
      wordWrap: { width: panelW - 60 },
    }).setOrigin(0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(titleText);
    s.overlayObjects.push(titleText);

    // Subtitle: the specific incident within the storyline.
    const subtitle = choiceDialogSubtitle(event);
    if (subtitle) {
      const subtitleText = s.add.text(s.layout.gameW / 2, panelY + 50, subtitle, {
        fontSize: '14px', fontStyle: 'italic', color: '#bbaa88', fontFamily: FONT_FAMILY,
        align: 'center', wordWrap: { width: panelW - 60 },
      }).setOrigin(0.5).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(subtitleText);
      s.overlayObjects.push(subtitleText);
    }

    // Body: the incident's stated consequence. The escalation is never
    // previewed.
    const bodyText = s.add.text(
      s.layout.gameW / 2, panelY + 78,
      `An incident has occurred.\n${event.effect}`,
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

    // One button per labelled option (arbitrary count). The consequence
    // applies whichever option the player picks (CSV content is all
    // effectPolicy 'apply'); the dialog only ever shows the labels.
    options.forEach((option, index) => {
      const btn = createOverlayButton(
        s,
        s.layout.gameW / 2,
        panelY + 108 + index * rowH,
        option.label,
        201,
        { fontSize: '14px', color: '#aaddff', hoverColor: '#cceeff' },
      );
      if (s.hudContainer) s.hudContainer.add(btn);
      btn.on('pointerdown', () => {
        // Button SFX always plays (reduced motion keeps sound).
        safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
        dismissOverlay(s.overlayObjects);
        s.overlayObjects = [];
        onChoose(index);
      });
      s.overlayObjects.push(btn);
    });

    // Footer: the player must choose — picking is free.
    const footerText = s.add.text(
      s.layout.gameW / 2, panelY + 108 + count * rowH,
      'Choosing is free — the consequence applies regardless.',
      {
        fontSize: '12px', color: '#999988', fontFamily: FONT_FAMILY,
        align: 'center', wordWrap: { width: panelW - 70 },
      },
    ).setOrigin(0.5, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(footerText);
    s.overlayObjects.push(footerText);
  }

  /**
   * Shows the Turn Summary dialog (MS-0MVP46AMO002SZUT).
   *
   * Presented after the end-of-turn animations complete (gated into the
   * deferred closing by MS-0MVP46Q8X003419R). Renders the turn just closed
   * from the Phaser-free {@link buildTurnSummary} model (child
   * MS-0MVP45WBA001GAVY): businesses owned, per-phase income, per-category
   * ongoing expenses, incident and one-off deltas, the net change and the
   * closing balances. `[ Next Turn ]` is the primary action and resumes the
   * closing flow via {@link onNextTurn}; `[ Bank Loan ]` is **always**
   * rendered disabled with an explanatory hint, behind the
   * `onBankLoanAction` seam that MS-0MVL6DZI0000F6CG (Bank Loans) will
   * replace — it is never shown enabled by this item.
   *
   * Overlay pattern compliance (AGENTS.md UI Best Practices):
   * `createOverlayBackground` + `createOverlayButton` from `@ui`; ALL
   * elements are parented into `s.hudContainer`; depths 199 (backdrop) /
   * 200 (box) / 201 (elements). Instant appearance (no fade-in —
   * reduced-motion safe); `[ Next Turn ]` plays its SFX via `safePlaySound`
   * (mute/volume respected). Dismissal resets `s.overlayObjects`.
   *
   * @param summary          The turn's rendered summary model.
   * @param onNextTurn       Called when the player clicks [ Next Turn ].
   * @param onBankLoanAction Wiring seam for MS-0MVL6DZI0000F6CG; never
   *                          invoked while loans are unimplemented.
   */
  public showTurnSummaryDialog(
    summary: TurnSummary,
    onNextTurn: () => void,
    onBankLoanAction?: () => void,
  ): void {
    const s = this.scene;
    if (s.replayMode) return; // headless/replay: never present UI

    // Wiring seam retained for MS-0MVL6DZI0000F6CG (Bank Loans). The button
    // stays disabled in this item, so the callback is deliberately never
    // invoked here.
    void onBankLoanAction;

    const centerX = s.layout.gameW / 2;
    const panelW = 640;
    const panelH = 560;
    const panelX = centerX - panelW / 2;
    const panelY = s.layout.gameH / 2 - panelH / 2;
    const leftX = panelX + 32;
    const rightX = panelX + 344;
    const colTop = panelY + 92;

    // Backdrop 199 / box 200 (createOverlayBackground), elements 201 below.
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

    /** Adds a depth-201 element, parenting it into the HUD container. */
    const addText = (
      x: number,
      y: number,
      text: string,
      style: Record<string, unknown>,
      originX = 0,
      originY = 0,
    ): void => {
      const obj = s.add.text(x, y, text, style)
        .setOrigin(originX, originY)
        .setDepth(201);
      if (s.hudContainer) s.hudContainer.add(obj);
      s.overlayObjects.push(obj);
    };

    // ── Title band ────────────────────────────────────────────────
    addText(centerX, panelY + 30, 'Turn Summary', {
      fontSize: '24px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    }, 0.5);
    addText(centerX, panelY + 60, `Day ${summary.turn}`, {
      fontSize: '15px', color: '#bbaa88', fontFamily: FONT_FAMILY,
    }, 0.5);

    // ── Left column: income, expenses, businesses owned ──────────
    let y = colTop;
    addText(leftX, y, 'Income', {
      fontSize: '15px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    });
    y += 22;
    for (const row of summary.income) {
      addText(leftX, y, `${row.label}: ${formatSigned(row.coins)}`, {
        fontSize: '13px', color: row.coins < 0 ? '#ff8888' : '#ddccbb', fontFamily: FONT_FAMILY,
      });
      y += 20;
    }
    addText(leftX, y, `Income total: ${formatSigned(summary.incomeTotal)}`, {
      fontSize: '13px', fontStyle: 'bold', color: '#ddccbb', fontFamily: FONT_FAMILY,
    });
    y += 28;
    addText(leftX, y, 'Expenses', {
      fontSize: '15px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    });
    y += 22;
    for (const row of summary.expenses) {
      // Ongoing costs are signed (zero or negative) — render them as-is.
      addText(leftX, y, `${row.label}: ${formatSigned(row.coins)}`, {
        fontSize: '13px', color: '#ff8888', fontFamily: FONT_FAMILY,
      });
      y += 20;
    }
    addText(leftX, y, `Expenses total: ${formatSigned(summary.expensesTotal)}`, {
      fontSize: '13px', fontStyle: 'bold', color: '#ddccbb', fontFamily: FONT_FAMILY,
    });
    y += 28;
    addText(leftX, y, `Businesses owned: ${summary.humanOwner?.businessesOwned ?? 0}`, {
      fontSize: '13px', color: '#ddccbb', fontFamily: FONT_FAMILY,
    });

    // ── Right column: incident, one-off, net, closing ─────────────
    let ry = colTop;
    addText(rightX, ry, 'Incident', {
      fontSize: '15px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    });
    ry += 22;
    addText(rightX, ry,
      `${summary.incidentName ?? 'No incident'} — Coins ${formatSigned(summary.incident.coins)}, Rep ${formatSigned(summary.incident.reputation)}`,
      {
        fontSize: '13px', color: '#ddccbb', fontFamily: FONT_FAMILY,
        wordWrap: { width: panelW - (rightX - panelX) - 32 },
      },
    );
    ry += 30;
    addText(rightX, ry, 'One-off changes', {
      fontSize: '15px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    });
    ry += 22;
    addText(rightX, ry,
      `Coins ${formatSigned(summary.oneOff.coins)}, Rep ${formatSigned(summary.oneOff.reputation)}`,
      {
        fontSize: '13px', color: '#ddccbb', fontFamily: FONT_FAMILY,
      },
    );
    ry += 30;
    addText(rightX, ry, 'Net change', {
      fontSize: '15px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    });
    ry += 22;
    addText(rightX, ry,
      `Coins ${formatSigned(summary.net.coins)}, Rep ${formatSigned(summary.net.reputation)}, Score ${formatSigned(summary.net.score)}`,
      {
        fontSize: '13px', color: '#ddccbb', fontFamily: FONT_FAMILY,
      },
    );
    ry += 30;
    addText(rightX, ry, 'Closing balances', {
      fontSize: '15px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    });
    ry += 22;
    addText(rightX, ry,
      `Coins ${summary.closing.coins}, Rep ${summary.closing.reputation}, Score ${summary.closing.score}`,
      {
        fontSize: '13px', color: '#ddccbb', fontFamily: FONT_FAMILY,
      },
    );

    // ── Actions ───────────────────────────────────────────────────
    const btnY = panelY + panelH - 60;

    // Primary action: resumes the deferred closing flow via onNextTurn.
    const nextTurnBtn = createOverlayButton(
      s, centerX - 120, btnY,
      '[ Next Turn ]', 201,
    );
    if (s.hudContainer) s.hudContainer.add(nextTurnBtn);
    nextTurnBtn.on('pointerdown', () => {
      safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      onNextTurn();
    });
    s.overlayObjects.push(nextTurnBtn);

    // [ Bank Loan ] is always rendered disabled (AC4): muted colour, no
    // interactivity, and an explanatory hint. The onBankLoanAction seam above
    // is what MS-0MVL6DZI0000F6CG (Bank Loans) replaces to enable it.
    const bankLoanBtn = createOverlayButton(
      s, centerX + 120, btnY,
      '[ Bank Loan ]', 201,
      { color: '#6b6459', hoverColor: '#6b6459' },
    );
    bankLoanBtn.disableInteractive();
    if (s.hudContainer) s.hudContainer.add(bankLoanBtn);
    s.overlayObjects.push(bankLoanBtn);

    addText(centerX, panelY + panelH - 24,
      'Bank loans are not available yet — coming in a future update.', {
        fontSize: '12px', color: '#998877', fontFamily: FONT_FAMILY, align: 'center',
        wordWrap: { width: panelW - 60 },
      }, 0.5);
  }

  /**
   * Shows the human piggyback decision prompt (F5 of MS-0MUYC47EL005Z69H).
   *
   * Presented when the human seat holds a pending piggyback decision raised
   * after another active seat organised an eligible event. The player decides
   * whether to **join fully** (pay exactly `round(1.5 × paidCost)` coins for
   * a 100% share — no action point spent) or **keep the automatic 50%
   * free-ride** share. There is NO decline/skip option: the 50% share is
   * always applied, so the prompt offers exactly the two outcomes, and an
   * unaffordable join-fully is hidden (the free-ride applies instead).
   *
   * Overlay pattern compliance (AGENTS.md UI Best Practices):
   * createOverlayBackground + createOverlayButton from @ui; ALL elements are
   * parented into `s.hudContainer`; depths 199 (backdrop) / 200 (box) /
   * 201 (elements). Dialog appears instantly (no fade-in — reduced-motion
   * safe); button SFX plays through safePlaySound (respects mute/volume).
   * Cleanup on dismissal resets `s.overlayObjects`.
   *
   * @param info     The exact prompt data (event, 150% charge, affordability,
   *                 100%/50% reward projections) from the turn controller.
   * @param onJoin   Called when the player chooses to join fully.
   * @param onKeep   Called when the player keeps the 50% free-ride.
   */
  public showPiggybackDialog(
    info: {
      event: EventCard;
      charge: number;
      affordable: boolean;
      fullReward: { coins: number; reputation: number };
      halfReward: { coins: number; reputation: number };
    },
    onJoin: () => void,
    onKeep: () => void,
  ): void {
    const s = this.scene;
    if (s.replayMode) return; // headless/replay: never present UI

    const panelW = 520;
    const panelH = 340;
    const panelY = s.layout.gameH / 2 - panelH / 2;

    const boxConfig = {
      width: panelW,
      height: panelH,
      color: 0x000000,
      alpha: 1.0,
      depth: 200,
    };
    const overlay = createOverlayBackground(s, { depth: 199, alpha: 0.6 }, boxConfig);
    s.overlayObjects.push(...overlay.objects);

    // Title: the event name — the exact thing the player is piggybacking on.
    const titleText = s.add.text(
      s.layout.gameW / 2, panelY + 24,
      `${info.event.name} — piggyback`,
      {
        fontSize: '21px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
        align: 'center', wordWrap: { width: panelW - 60 },
      },
    ).setOrigin(0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(titleText);
    s.overlayObjects.push(titleText);

    const joinCoins = Math.round(info.fullReward.coins);
    const joinRep = Math.round(info.fullReward.reputation);
    const rideCoins = Math.round(info.halfReward.coins);
    const rideRep = Math.round(info.halfReward.reputation);

    // Body: the exact 150% coin cost and the reward shares (AC1).
    const bodyText = s.add.text(
      s.layout.gameW / 2, panelY + 64,
      `Another seat organised this event. You already hold the automatic 50% share.\n\n` +
        `Join fully: pay ${info.charge} coins (no action used) for a 100% share of the rewards — ` +
        `+${joinCoins} coins / +${joinRep} reputation.\n\n` +
        `Keep the 50% share: nothing to pay — +${rideCoins} coins / +${rideRep} reputation.`,
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

    // Two outcomes only — never a decline/skip (AC2).
    if (info.affordable) {
      const joinBtn = createOverlayButton(
        s, s.layout.gameW / 2 - 150, panelY + panelH - 52,
        `Join fully — ${info.charge} coins`, 201,
        { fontSize: '13px', color: '#88ff88', hoverColor: '#aaffaa' },
      );
      if (s.hudContainer) s.hudContainer.add(joinBtn);
      joinBtn.on('pointerdown', () => {
        safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
        dismissOverlay(s.overlayObjects);
        s.overlayObjects = [];
        onJoin();
      });
      s.overlayObjects.push(joinBtn);

      const keepBtn = createOverlayButton(
        s, s.layout.gameW / 2 + 150, panelY + panelH - 52,
        'Keep 50% share', 201,
        { fontSize: '13px', color: '#99ccff', hoverColor: '#bbddff' },
      );
      if (s.hudContainer) s.hudContainer.add(keepBtn);
      keepBtn.on('pointerdown', () => {
        safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
        dismissOverlay(s.overlayObjects);
        s.overlayObjects = [];
        onKeep();
      });
      s.overlayObjects.push(keepBtn);
    } else {
      // Unaffordable join-fully: the option is hidden — only the free-ride
      // outcome remains and it applies automatically (AC2).
      const noteText = s.add.text(
        s.layout.gameW / 2, panelY + panelH - 106,
        `Joining fully needs ${info.charge} coins — you cannot afford it this week.\nThe automatic 50% share (${rideCoins}c / ${rideRep}r) applies.`,
        {
          fontSize: '12px', color: '#cc9988', fontFamily: FONT_FAMILY,
          align: 'center', wordWrap: { width: panelW - 70 },
        },
      ).setOrigin(0.5, 0).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(noteText);
      s.overlayObjects.push(noteText);

      const keepBtn = createOverlayButton(
        s, s.layout.gameW / 2, panelY + panelH - 52,
        'Continue with my 50% share', 201,
        { fontSize: '13px', color: '#99ccff', hoverColor: '#bbddff' },
      );
      if (s.hudContainer) s.hudContainer.add(keepBtn);
      keepBtn.on('pointerdown', () => {
        safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
        dismissOverlay(s.overlayObjects);
        s.overlayObjects = [];
        onKeep();
      });
      s.overlayObjects.push(keepBtn);
    }
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

    let load = getMainStreetCardPackLoadResult();
    let enabledIds = resolveEnabledPackIds(load);

    // Modal backdrop (depth 199). The listing draws its own SLL panel and is
    // parented above it (depth 201), matching the overlay depth convention.
    const overlay = createOverlayBackground(s, { depth: 199, alpha: 0.6 });
    s.overlayObjects.push(...overlay.objects);

    const purchasablePackIds = getMainStreetPurchasablePackIds();

    const listing = new CardPackListing(s, {
      result: toCardPackListingInput(load, enabledIds),
      purchasablePackIds,
      onPurchase: (packId) => {
        // Dev/QA simulated purchase — scoped to the pack's own reward rule, so
        // no other reward is collateral-unlocked. Re-discover and re-render so
        // the newly unlocked pack becomes enable-able.
        safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
        void purchaseMainStreetCardPack(packId).then((outcome) => {
          if (!outcome.purchased) {
            flashError(s,
              outcome.reason ?? 'That pack could not be unlocked.',
            );
            return;
          }
          const freshLoad = outcome.load ?? getMainStreetCardPackLoadResult();
          // Refresh the captured discovery result so a subsequent toggle merges
          // against the *unlocked* pool, not the stale locked one.
          if (freshLoad) load = freshLoad;
          enabledIds = resolveEnabledPackIds(freshLoad);
          listing.setResult(toCardPackListingInput(freshLoad, enabledIds));
        });
      },
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
          flashError(s,
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
