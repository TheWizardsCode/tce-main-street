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
  buildGameOverStatSeries,
  formatEndReason,
} from './MainStreetGameOverSummary';
import type { CompetitiveTurnSummary, TurnSummary } from './MainStreetTurnSummary';
import {
  showCompetitiveTurnSummaryDialog as showTabbedCompetitiveTurnSummaryDialog,
  showTurnSummaryDialog as showTabbedTurnSummaryDialog,
} from './MainStreetTurnSummaryOverlay';
import { createStatsChart, destroyStatsChart } from './MainStreetStatsChart';
import {
  type LoanSelectorModel,
  type TurnSummaryLoanDescriptor,
} from './MainStreetLoanSelectorModel';
import {
  showLoanOfferDialog as renderLoanOfferDialog,
  showLoanSelectorDialog as renderLoanSelectorDialog,
  type LoanSelectorDialogHandlers,
} from './MainStreetLoanOverlay';
import type { LoanOfferModel } from './MainStreetLoanOverlayModel';
import { showLoanPayoffDialog as renderLoanPayoffDialog } from './MainStreetLoanPayoffOverlay';
import type { LoanPayoff } from '../MainStreetLoans';
import { formatCompetitiveScoreboardBadge } from './MainStreetCompetitiveScoreboard';
import { buildMoveStaffAffordance, HUD_TOOLTIP_I18N_KEYS } from './MainStreetHudTooltips';
import { staffCardScope } from '../MainStreetStaffSkills';
import { buildBusinessStaffRows, type BusinessStaffRow } from '../MainStreetBusinessStaff';
import { buildCompanyRoster, buildLayOffConfirmContent, type CompanyRosterRow } from '../MainStreetRoster';
import { formatCoins } from './MainStreetLoanRowModel';
import { TIER_DEFINITIONS, ORDERED_TIER_DEFINITIONS, highestUnlockedTier } from '../MainStreetTiers';
import {
  isBuyAndPlacePremiumDialogDismissed,
  setAutoAdvanceTurnEnabled,
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
 * Tears down the game-over overlay immediately before `scene.restart()`.
 *
 * `dismissOverlay` already destroys every object (which detaches it from
 * `hudContainer`), but `scene.restart()` rebuilds the HUD container and Phaser
 * reuses the scene instance, so the restart must not depend on a partially
 * failed destroy loop. This helper:
 *
 * 1. detaches each object from its parent container first, so a restart that
 *    rebuilds `hudContainer` can never strand an orphaned child;
 * 2. calls the shared {@link dismissOverlay} with the full overlay-object
 *    array (each object is destroyed exactly once on the happy path);
 * 3. falls back to a per-object, idempotent destroy if the shared loop throws,
 *    so one already-destroyed object cannot block the restart;
 * 4. clears the bookkeeping array before the restart.
 *
 * Kept game-over-local (rather than changing the shared `dismissOverlay`) so
 * every other overlay keeps its existing teardown semantics
 * (MS-0MW6H5R340033GJJ).
 */
function teardownGameOverOverlay(scene: any): void {
  const objects = Array.isArray(scene.overlayObjects) ? scene.overlayObjects : [];

  // 1. Detach first: destroying an object normally removes it from its parent,
  //    but detaching explicitly makes the teardown independent of that detail.
  for (const obj of objects) {
    try {
      const parent = (obj as any)?.parentContainer;
      if (parent && typeof parent.remove === 'function') {
        parent.remove(obj, false);
      }
    } catch (_) {
      /* presentation-only teardown */
    }
  }

  // 2. Shared destroy loop over the full array (the contract AC3 pins).
  try {
    dismissOverlay(objects);
  } catch (_) {
    // 3. Idempotent fallback: a double-destroy must never block the restart.
    for (const obj of objects) {
      try {
        (obj as any)?.destroy?.();
      } catch (_) {
        /* already destroyed */
      }
    }
  }

  // 4. Clear bookkeeping before the restart.
  scene.overlayObjects = [];
}

export class MainStreetOverlayContent {
  constructor(private readonly scene: any) {}

  /**
   * Shows the Game Over overlay as a three-column panel
   * (epic MS-0MUWDL0V40041USM; Stats column MS-0MVSHZ1JU0083ASL).
   *
   * Layout:
   * - Top band: the title (`You Win!` / `Game Over`) and the plain-language
   *   end-reason headline, spanning all columns.
   * - Left **Game State** column: one row per player (label, coins,
   *   reputation, score and any failure/elimination badge) followed by the
   *   run's challenges met — a per-seat breakdown in competitive mode (each
   *   seat credited only with its own completions) or the historic single
   *   list in single-player.
   * - Middle **Summary** column: the retained score breakdown, the final
   *   `Cash at end of turn` figure, a `[ View detailed stats ]` link, challenge
   *   details, tier-unlock notifications, tier + campaign stats, the
   *   difficulty selector and the Play Again / Menu buttons anchored at the
   *   panel bottom.
   * - Right **Stats** column: five end-of-game line charts (profit per turn,
   *   cash, businesses, staff and reputation at end of turn) fed from the pure
   *   {@link buildGameOverStatSeries} model.
   *
   * The body is read-only (never mutates committed `state`) and reuses the
   * pure summary model ({@link buildGameOverPlayerRows},
   * {@link buildGameOverChallengeSummary}, {@link formatEndReason},
   * {@link buildGameOverStatSeries}). Overlay conventions follow AGENTS.md UI
   * best practices: `createOverlayBackground` / `createOverlayButton` from
   * `@ui`, all elements parented into `s.hudContainer`, depths 199 (backdrop) /
   * 200 (box) / 201 (interactive), everything pushed into `s.overlayObjects`.
   * No animation is added here, so the overlay is reduced-motion safe, and
   * headless/replay mode returns early.
   */
  public showGameOverOverlay(
    result: TurnResult,
    newlyUnlockedTiers: string[] = [],
  ): void {
    const s = this.scene;
    if (s.replayMode) return; // headless/replay: never present UI

    // Capture the scene generation so a lazy stats-chart handle that resolves
    // after a restart is destroyed rather than attached to the fresh run
    // (MS-0MW6H5R340033GJJ).
    const generationAtOpen: number = s.sceneRestartGeneration;

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
    // Final "Cash at end of turn" line rendered directly after the score
    // breakdown (MS-0MVAMU6OM008GJPV AC8).
    const cashLineH = 26;
    // "[ View detailed stats ]" affordance linking the Summary to the Stats
    // column (MS-0MVSHZ1JU0083ASL AC3/AC4).
    const viewStatsH = 22;
    const detailsH = challengeLineCount > 0 ? 24 + challengeLineCount * 20 : 0;
    const controlsH = 88; // difficulty row + buttons
    const rightContentH =
      26 + breakdownH + cashLineH + viewStatsH + detailsH + tierUnlockH + campaignH;
    const rightTotalH = rightContentH + controlsH;

    // ── Third “Stats” column geometry (five stacked charts) ─────
    const statsHeaderH = 26;
    const statsChartH = 84;
    const statsChartGap = 10;
    const statsColumnH =
      statsHeaderH + 5 * statsChartH + 4 * statsChartGap;

    const topBandH = 92;
    const panelPad = 24;
    const colGap = 20;
    // Widen to three columns while staying inside the 1280×720 viewport.
    const panelW = Math.min(1200, s.layout.gameW - 40);
    const colW = (panelW - panelPad * 2 - colGap * 2) / 3;
    const bodyH = Math.max(leftTotalH, rightTotalH, statsColumnH);
    const margin = 16;
    const maxPanelH = s.layout.gameH - 2 * margin;
    const panelH = Math.min(topBandH + bodyH + panelPad, maxPanelH);
    const panelTop = s.layout.gameH / 2 - panelH / 2;
    const panelLeft = s.layout.gameW / 2 - panelW / 2;
    const leftX = panelLeft + panelPad;
    const rightX = leftX + colW + colGap;
    const statsX = rightX + colW + colGap;
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

    // Cash at end of turn (MS-0MVAMU6OM008GJPV AC8): the run's final recorded
    // cash, rendered directly after the score breakdown. `buildGameOverStatSeries`
    // is pure and read-only, so the committed state is never mutated.
    const statSeries = buildGameOverStatSeries(s.state);
    const cashLine = s.add.text(
      rightX, cursorY,
      `Cash at end of turn: ${Math.round(statSeries.finalCash)}`,
      { fontSize: '15px', color: '#ffcc44', fontFamily: FONT_FAMILY },
    ).setOrigin(0, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(cashLine);
    s.overlayObjects.push(cashLine);
    cursorY += cashLineH;

    // Link to the detailed Stats column (AC3/AC4): a keyboard-activatable
    // affordance that adds a static focus frame around the Stats column —
    // no tween/rAF and no mutation of committed `state`.
    let statsFocused = false;
    const viewStatsLink = s.add.text(
      rightX, cursorY, '[ View detailed stats ]',
      { fontSize: '13px', color: '#88ccff', fontFamily: FONT_FAMILY },
    ).setOrigin(0, 0).setDepth(201).setInteractive();
    if (s.hudContainer) s.hudContainer.add(viewStatsLink);
    s.overlayObjects.push(viewStatsLink);
    viewStatsLink.on('pointerdown', () => {
      if (statsFocused) return;
      statsFocused = true;
      const frame = s.add.rectangle(
        statsX + colW / 2,
        bodyTop + statsColumnH / 2,
        colW + 16,
        statsColumnH + 8,
        0xffcc44,
        0,
      )
        .setStrokeStyle(2, 0xffcc44, 1)
        .setOrigin(0.5)
        .setDepth(201);
      if (s.hudContainer) s.hudContainer.add(frame);
      s.overlayObjects.push(frame);
    });
    cursorY += viewStatsH;

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
      // Restart-safe teardown (MS-0MW6H5R340033GJJ): detach + destroy every
      // game-over object, clear the bookkeeping array, then restart. A late
      // stats-chart or campaign-progress callback is discarded by the
      // scene-generation guard instead of being attached to the fresh run.
      teardownGameOverOverlay(s);
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

    // ── Third “Stats” column: five end-of-game graphs (AC1/AC2) ──
    // Headed `Stats`, to the right of `Summary`. Each chart is fed from the
    // pure `buildGameOverStatSeries` model; the DOM chart layer is created by
    // `createStatsChart`, which returns null in replay/headless mode. Chart
    // handles join `overlayObjects` so the existing `dismissOverlay` teardown
    // removes every canvas. If the overlay is dismissed before a lazy chart
    // import resolves, the late handle is destroyed instead of leaking.
    const statsHeader = s.add.text(statsX, bodyTop, 'Stats', {
      fontSize: '16px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
    }).setOrigin(0, 0).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(statsHeader);
    s.overlayObjects.push(statsHeader);

    const statsObjectsAtOpen = s.overlayObjects;
    const statSeriesList = [
      statSeries.profit,
      statSeries.cash,
      statSeries.businesses,
      statSeries.staff,
      statSeries.reputation,
    ];
    let chartY = bodyTop + statsHeaderH;
    for (const series of statSeriesList) {
      void createStatsChart(
        s,
        { x: statsX, y: chartY, width: colW, height: statsChartH },
        {
          title: series.label,
          labels: series.points.map((point) => String(point.turn)),
          values: series.points.map((point) => point.value),
        },
      ).then((handle) => {
        if (!handle) return;
        // A late resolution belongs to the previous scene generation once the
        // scene has restarted: destroy the handle instead of attaching it to
        // the new scene (MS-0MW6H5R340033GJJ).
        if (s.sceneRestartGeneration !== generationAtOpen) {
          destroyStatsChart(handle);
          return;
        }
        if (s.overlayObjects === statsObjectsAtOpen) statsObjectsAtOpen.push(handle);
        else destroyStatsChart(handle);
      }).catch((error) => {
        // A chart failure must never break the overlay's presentation.
        console.warn('[stats-chart] failed to render chart', error);
      });
      chartY += statsChartH + statsChartGap;
    }
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
   * dialog lists each member in its own row offering `[ Move ]` and
   * `[ Lay off ]`. A row's `[ Lay off ]` opens a quoted confirm step (member
   * name, one turn's salary clamped at 0 coins and the shared reputation
   * cost) before executing through `letGoStaffCommand`; the dialog stays
   * open and re-renders the rows in place, shrinking the panel to fit
   * (MS-0MWCB36A8002NKBX).
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

    const panelW = 520;
    // Row-per-member staff section (MS-0MWC952QU000HQ11): the panel sizes
    // itself from the member count — the fixed sell/close/cancel block plus
    // the cost line, one row per member (rowH each) with its own [ Move ] and
    // [ Lay off ]. A confirmed lay-off re-renders the rows in place and
    // shrinks the panel to fit the remaining rows (MS-0MWCB36A8002NKBX).
    // No member → nothing renders (today's empty state) and the panel keeps
    // its 360px height.
    const staffRows = buildBusinessStaffRows(s.state, slotIndex);
    const staffRowH = 34;            // one member row (name/role/salary + buttons)
    const costLineTop = 300;         // cost line, below the buttons block (bottom ≈ 297)
    const rowsTop = costLineTop + 24; // first member row top, relative to panelY
    const panelPad = 20;             // breathing room below the last row's buttons
    let panelH = staffRows.length > 0
      ? rowsTop + staffRows.length * staffRowH + panelPad
      : 360;
    const panelY = s.layout.gameH / 2 - panelH / 2;
    const centerX = s.layout.gameW / 2;
    const panelLeft = centerX - panelW / 2;
    const panelRight = centerX + panelW / 2;

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
          }).then(() => {
            // Post-action out-of-actions hook (MS-0MW3O2NBM001CLKW): the
            // close demolition animation and audio have completed — if it
            // spent the last action point, fire the auto-advance / dialog
            // trigger (the Manage-Card overlay is already dismissed).
            s.maybeRunOutOfActionsTrigger?.();
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

    // ── Employed staff section (MS-0MWCB35QG0030XU6) ────────────────
    // One row per member employed at this slot, in hire order (oldest first),
    // from the shared model (`buildBusinessStaffRows`) — never the newest
    // hire. Each row shows the member's name, role/benefit summary, effective
    // per-turn salary and its own `[ Move ]`; a single cost line states both
    // affordance costs so neither is hidden behind a tooltip. The section is
    // built by `renderStaffSection()` so the per-row lay-off item
    // (MS-0MWCB36A8002NKBX) can tear down and rebuild it in place from the
    // same code path.
    let staffObjects: Phaser.GameObjects.GameObject[] = [];
    const clearStaffSection = () => {
      const set = new Set(staffObjects);
      s.overlayObjects = s.overlayObjects.filter((obj: any) => !set.has(obj));
      staffObjects.forEach((obj) => obj.destroy());
      staffObjects = [];
    };
    const addStaffObject = (obj: Phaser.GameObjects.GameObject) => {
      staffObjects.push(obj);
      s.overlayObjects.push(obj);
    };

    // Confirmed lay-offs rebuild the rows in place; the panel shrinks to fit
    // the remaining members while its top edge (and everything anchored to
    // it) stays put (MS-0MWCB36A8002NKBX AC3).
    const resizePanelTo = (rowCount: number) => {
      const next = rowCount > 0 ? rowsTop + rowCount * staffRowH + panelPad : 360;
      if (next === panelH || !overlay.box) return;
      panelH = next;
      overlay.box.setSize(panelW, panelH);
      overlay.box.y = panelY + panelH / 2;
    };

    // ── Confirm layer (MS-0MWCB36A8002NKBX) ───────────────────────────
    // A quoted confirm step floats over the rows (kept visible beneath it),
    // built from the shared `buildLayOffConfirmContent` — member name, one
    // turn's salary in coins and the reputation cost, never recomputed here.
    let confirmObjects: Phaser.GameObjects.GameObject[] = [];
    const clearConfirm = () => {
      const set = new Set(confirmObjects);
      s.overlayObjects = s.overlayObjects.filter((obj: any) => !set.has(obj));
      confirmObjects.forEach((obj) => obj.destroy());
      confirmObjects = [];
    };
    const addConfirmObject = (obj: Phaser.GameObjects.GameObject) => {
      confirmObjects.push(obj);
      s.overlayObjects.push(obj);
    };

    /** Opens the quoted confirm step for exactly this member's row. */
    const showLayOffConfirm = (row: BusinessStaffRow) => {
      clearConfirm();
      const copy = buildLayOffConfirmContent(row);
      const cW = 440;
      const cH = 210;
      const cX = centerX;
      const cY = s.layout.gameH / 2 - cH / 2;
      const cOverlay = createOverlayBackground(
        s, { depth: 202, alpha: 0.5 }, { width: cW, height: cH, color: 0x000000, alpha: 1.0, depth: 203 },
      );
      for (const obj of cOverlay.objects) addConfirmObject(obj);

      const confirmTitle = s.add.text(cX, cY + 26, copy.title, {
        fontSize: '18px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
        align: 'center', wordWrap: { width: cW - 60 },
      }).setOrigin(0.5).setDepth(204);
      if (s.hudContainer) s.hudContainer.add(confirmTitle);
      addConfirmObject(confirmTitle);

      const costLine = s.add.text(
        cX, cY + 78,
        copy.body,
        { fontSize: '14px', color: '#ddccbb', fontFamily: FONT_FAMILY, align: 'center', lineSpacing: 6 },
      ).setOrigin(0.5, 0).setDepth(204);
      if (s.hudContainer) s.hudContainer.add(costLine);
      addConfirmObject(costLine);

      const confirmBtn = createOverlayButton(s, cX - 90, cY + cH - 44, '[ Confirm ]', 204);
      if (s.hudContainer) s.hudContainer.add(confirmBtn);
      addConfirmObject(confirmBtn);
      confirmBtn.on('pointerdown', () => {
        // Re-resolve the row's member id against the CURRENT staffCards, so a
        // stale row (member already gone, e.g. after an undo) flashes feedback
        // and re-renders instead of acting on a shifted index (AC4).
        const index = ((s.state.staffCards ?? []) as StaffCard[]).findIndex((m) => m.id === row.memberId);
        if (index === -1) {
          flashError(s, `Cannot lay off ${row.name}: no longer employed here.`);
          safePlaySound(s, COMMON_SFX_KEYS.ILLEGAL_MOVE);
          clearConfirm();
          renderStaffSection();
          s.refreshAll();
          return;
        }
        let laidOff = false;
        try {
          const cmd = letGoStaffCommand(s.state, index);
          if (s.undoManager) {
            s.undoManager.execute(cmd);
          } else {
            cmd.execute();
          }
          // Quote the charges actually applied — not hard-coded −1/−1
          // (MS-0MWCB36A8002NKBX AC5).
          addLog(
            s.state,
            `Laid off ${row.name} (−${formatCoins(row.layOffCoins)} coins, −${row.layOffReputation} reputation)`,
            'loss',
          );
          flashConfirmation(
            s,
            `Laid off ${row.name} (−${formatCoins(row.layOffCoins)} coins, −${row.layOffReputation} reputation)`,
          );
          laidOff = true;
        } catch (e) {
          console.error('[LayOff] Failed:', e);
          flashError(s, `Error laying off: ${(e as Error).message}`);
        }

        clearConfirm();
        // The dialog stays open: rebuild the rows in place (the laid-off
        // member's row disappears and the panel shrinks to fit) and refresh
        // the world + undo buttons (AC3).
        renderStaffSection();
        s.refreshAll();
        s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
        // Discard SFX on success, illegal-move on failure.
        safePlaySound(s, laidOff ? SFX_KEYS.DISCARD : COMMON_SFX_KEYS.ILLEGAL_MOVE);
      });

      const cancelBtn = createOverlayButton(s, cX + 90, cY + cH - 44, '[ Cancel ]', 204);
      if (s.hudContainer) s.hudContainer.add(cancelBtn);
      addConfirmObject(cancelBtn);
      cancelBtn.on('pointerdown', () => {
        safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
        clearConfirm(); // no state change — rows reappear untouched
      });
    };

    const renderStaffSection = () => {
      clearStaffSection();
      const rows = buildBusinessStaffRows(s.state, slotIndex);
      resizePanelTo(rows.length);
      if (rows.length === 0) return; // nobody employed: render nothing

      // Both affordance costs, stated once (AC4) — Move is 1 action, Lay off
      // is 1 turn's salary + reputation.
      const costLine = s.add.text(
        centerX, panelY + costLineTop,
        "Move: 1 action · Lay off: 1 turn's salary + reputation",
        { fontSize: '12px', color: '#ffcc88', fontFamily: FONT_FAMILY, align: 'center' },
      ).setOrigin(0.5).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(costLine);
      addStaffObject(costLine);

      // One row per member, hire order. Each row's [ Move ] targets that
      // row's member id (AC3) and its [ Lay off ] opens the quoted confirm
      // step for that member only — never the newest hire
      // (MS-0MWCB36A8002NKBX).
      rows.forEach((row, index) => {
        const y = panelY + rowsTop + index * staffRowH;

        const nameText = s.add.text(panelLeft + 20, y, row.name, {
          fontSize: '14px', fontStyle: 'bold', color: '#ffdd99', fontFamily: FONT_FAMILY,
          wordWrap: { width: 110 },
        }).setOrigin(0, 0).setDepth(201);
        if (s.hudContainer) s.hudContainer.add(nameText);
        addStaffObject(nameText);

        const roleText = s.add.text(panelLeft + 134, y, row.roleSummary, {
          fontSize: '11px', color: '#ddccbb', fontFamily: FONT_FAMILY,
          wordWrap: { width: 92 },
        }).setOrigin(0, 0).setDepth(201);
        if (s.hudContainer) s.hudContainer.add(roleText);
        addStaffObject(roleText);

        const salaryText = s.add.text(panelRight - 204, y, `${formatCoins(row.salary)}/turn`, {
          fontSize: '13px', color: '#ffe08a', fontFamily: FONT_FAMILY, align: 'right',
        }).setOrigin(1, 0).setDepth(201);
        if (s.hudContainer) s.hudContainer.add(salaryText);
        addStaffObject(salaryText);

        // Per-row [ Move ] (AC3): begins relocation of *this* member. The
        // hover tooltip lists that member's legal destinations, from the
        // shared affordance builder (MS-0MUOSULQ700186PP).
        const moveBtn = createOverlayButton(s, panelRight - 130, y + 8, '[ Move ]', 201);
        if (s.hudContainer) s.hudContainer.add(moveBtn);
        addStaffObject(moveBtn);
        moveBtn.on('pointerover', () => {
          const affordance = buildMoveStaffAffordance(s.state, row.memberId);
          s.tooltipManager?.show(affordance.tooltip, moveBtn.x, moveBtn.y);
        });
        moveBtn.on('pointerout', () => s.tooltipManager?.hide());
        moveBtn.on('pointerdown', () => {
          dismissOverlay(s.overlayObjects);
          s.overlayObjects = [];
          s.beginStaffMove(row.memberId);
        });

        // Per-row [ Lay off ] (MS-0MWCB36A8002NKBX): opens the confirm step
        // for THIS member, quoted from the shared builder.
        const layOffBtn = createOverlayButton(s, panelRight - 56, y + 8, '[ Lay off ]', 201);
        if (s.hudContainer) s.hudContainer.add(layOffBtn);
        addStaffObject(layOffBtn);
        layOffBtn.on('pointerdown', () => {
          safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
          showLayOffConfirm(row);
        });
      });
    };

    renderStaffSection();
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
   * Shows the out-of-actions explainer dialog (MS-0MW3O2O0V00042E5).
   *
   * Reached through the scene's post-action out-of-actions trigger
   * (`MainStreetScene.maybeRunOutOfActionsTrigger`, MS-0MW3O2NBM001CLKW)
   * when the player spends their last action point and the **Auto advance
   * turn** setting is off (the default). Explains the zero-action state,
   * offers `[ End Turn ]` (the identical `s.endTurn()` code path the HUD End
   * Turn button uses), a `[ Dismiss ]` affordance that returns the player to
   * the market phase with End Turn still available, and an unchecked
   * checkbox (`[ ] Automatically end my turn when I run out of actions`)
   * that persists the Auto advance turn preference immediately when ticked
   * — so the next out-of-actions moment auto-advances instead.
   *
   * Overlay pattern compliance (AGENTS.md UI Best Practices): backdrop
   * depth 199 / box 200 / elements 201, all parented into `s.hudContainer`
   * and registered in `s.overlayObjects` so they dismiss as a unit. No
   * animations — reduced-motion safe by construction. Never stacks on top
   * of an already-open modal overlay (the trigger also fires at most once
   * per turn via the shared latch).
   */
  public showOutOfActionsDialog(): void {
    const s = this.scene;
    // Non-intrusive: never open on top of another modal overlay.
    if (s.overlayObjects && s.overlayObjects.length > 0) return;

    const panelW = 440;
    const panelH = 250;
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

    // Title
    const titleText = s.add.text(
      s.layout.gameW / 2, panelY + 25,
      'No Actions Left',
      { fontSize: '20px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY },
    ).setOrigin(0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(titleText);
    s.overlayObjects.push(titleText);

    // Explanation body: no action points left, employed staff grant extra
    // action points, break for the weekend with End Turn.
    const bodyText = s.add.text(
      s.layout.gameW / 2, panelY + 70,
      'You have no action points left.\n' +
        'Some kinds of employed staff grant extra action points, and you can ' +
        'still buy and place a card this turn at a premium price.\n' +
        'Press End Turn to break for the weekend.',
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

    // Auto-advance checkbox (unchecked by default — the dialog only shows
    // while the setting is off). Ticking it persists the preference
    // immediately so the next out-of-actions moment auto-advances.
    let autoAdvanceOn = false;
    const checkLabel = s.add.text(
      s.layout.gameW / 2, panelY + 162,
      '[ ] Automatically end my turn when I run out of actions',
      { fontSize: '14px', color: '#ccbbaa', fontFamily: FONT_FAMILY },
    ).setOrigin(0.5).setDepth(201).setInteractive({ useHandCursor: true });
    if (s.hudContainer) s.hudContainer.add(checkLabel);
    checkLabel.on('pointerdown', () => {
      autoAdvanceOn = !autoAdvanceOn;
      checkLabel.setText(
        autoAdvanceOn
          ? '[x] Automatically end my turn when I run out of actions'
          : '[ ] Automatically end my turn when I run out of actions',
      );
      setAutoAdvanceTurnEnabled(autoAdvanceOn);
    });
    s.overlayObjects.push(checkLabel);

    // End Turn button — the identical `s.endTurn()` code path the HUD End
    // Turn button uses.
    const endTurnBtn = createOverlayButton(
      s, s.layout.gameW / 2 - 110, panelY + 212,
      '[ End Turn ]', 201,
    );
    if (s.hudContainer) s.hudContainer.add(endTurnBtn);
    endTurnBtn.on('pointerdown', () => {
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
      s.endTurn();
    });
    s.overlayObjects.push(endTurnBtn);

    // Dismiss affordance — leaves the player in the market phase with the
    // HUD End Turn button still available.
    const dismissBtn = createOverlayButton(
      s, s.layout.gameW / 2 + 40, panelY + 212,
      '[ Dismiss ]', 201,
    );
    if (s.hudContainer) s.hudContainer.add(dismissBtn);
    dismissBtn.on('pointerdown', () => {
      dismissOverlay(s.overlayObjects);
      s.overlayObjects = [];
    });
    s.overlayObjects.push(dismissBtn);
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
   * Shows the bankruptcy bailout loan offer dialog (MS-0MVPWSBLG006YMBA).
   *
   * One button per presented loan option (each labelled with its principal,
   * per-turn and total repayment and term) plus a Decline action. Rendering
   * lives in {@link module:scenes/MainStreetLoanOverlay}, which follows the
   * event-choice overlay conventions: `createOverlayBackground` /
   * `createOverlayButton` from `@ui`, every element parented into
   * `s.hudContainer`, depths 199/200/201, every object pushed into
   * `s.overlayObjects`, `safePlaySound` for SFX and instant appearance
   * (reduced-motion safe).
   *
   * @param model      The presentation model (built Phaser-free by
   *                   `buildLoanOfferModel`).
   * @param onAccept   Called with the chosen row's index.
   * @param onDecline  Called when the player declines (the run ends).
   */
  public showLoanOfferDialog(
    model: LoanOfferModel,
    onAccept: (optionIndex: number) => void,
    onDecline: () => void,
  ): void {
    renderLoanOfferDialog(this.scene, model, { onAccept, onDecline });
  }

  /**
   * Shows the mid-game loan selector (MS-0MVXYCJVU000QBK1, parent
   * MS-0MVPWSQMG004198C).
   *
   * The shipped bailout renderer in its `select` mode: one button per
   * configured `config.loanOptions` entry — each labelled with its principal,
   * per-turn repayment, total repayment and term, exactly as the bailout dialog
   * prices the same menu — plus a Cancel action that only closes the dialog.
   *
   * Overlay conventions are the renderer's
   * ({@link module:scenes/MainStreetLoanOverlay}): `createOverlayBackground` /
   * `createOverlayButton` from `@ui`, every element parented into
   * `s.hudContainer`, depths 199/200/201, every object tracked in
   * `s.overlayObjects`, `safePlaySound` for the button SFX, instant appearance
   * (reduced-motion safe) and never presented in replay/headless.
   *
   * @param model    The presentation model (built Phaser-free by
   *                 `buildLoanSelectorModel`).
   * @param handlers Confirm / cancel callbacks; the confirm dispatch
   *                 (`takeLoan`) is wired by `showTurnSummaryDialog`.
   * @param error    The engine's refusal reason from a rejected confirm, or
   *                 absent — drawn as an extra red line so the dialog can stay
   *                 open and say why the loan was not taken
   *                 (MS-0MVXYCKFE000VF76).
   */
  public showLoanSelectorDialog(
    model: LoanSelectorModel,
    handlers: LoanSelectorDialogHandlers,
    error?: string | null,
  ): void {
    renderLoanSelectorDialog(this.scene, model, handlers, error);
  }

  /**
   * Shows the loan payoff congratulation dialog (MS-0MW3SN2LK00537GN, parent
   * MS-0MW1ZJDVE000MUID).
   *
   * Presented when the seat's final scheduled repayment retires a loan, so the
   * milestone is noticed and the stopped weekly deduction is explained. The
   * copy is the Phaser-free {@link buildLoanPayoffContent} model's output — the
   * renderer invents no string — and the model's presentation gate decides
   * whether anything is drawn (never in `replayMode`/headless runs, never for a
   * non-human seat, never when the same closing ended the run).
   *
   * Overlay conventions are the renderer's
   * ({@link module:scenes/MainStreetLoanPayoffOverlay}): `createOverlayBackground`
   * / `createOverlayButton` from `@ui`, every element parented into
   * `s.hudContainer`, depths 199/200/201, every object tracked in
   * `s.overlayObjects`, `safePlaySound` for the button SFX, instant appearance
   * (reduced-motion safe) and a single dismiss action that resumes the
   * interrupted flow exactly once.
   *
   * @param payoff    The retired loan, as reported on `TurnResult.loanPayoffs`.
   * @param onDismiss Called exactly once when the player dismisses the dialog.
   * @returns Whether the dialog was presented; `false` when the copy model's
   *          gate suppressed it (replay/headless, non-human seat, run ended), in
   *          which case `onDismiss` is never called and the caller continues the
   *          flow itself.
   */
  public showLoanPayoffDialog(payoff: LoanPayoff, onDismiss: () => void): boolean {
    return renderLoanPayoffDialog(this.scene, payoff, onDismiss);
  }

  /**
   * Shows the unified tabbed P&L Turn Summary dialog (parent
   * MS-0MW4XULA90002OEY, child MS-0MW5ER6HC000HVQ8).
   *
   * Presented after the end-of-turn animations complete (gated into the
   * deferred closing by MS-0MVP46Q8X003419R). The panel is one **tabbed
   * profit/loss statement for the management company**: a tab strip (one tab
   * per player, the human `You` tab selected by default; a single
   * non-interactive `You` tab in single-player) plus the selected player's
   * statement — Income (base / synergy / reputation / events) with a total,
   * Less: Operating expenses (staff / community / business) with a total, the
   * Incident and One-off adjustments and an emphasised Net profit/loss bottom
   * line — with the non-monetary figures (reputation/score change, closing
   * balances and businesses owned) as supplementary context outside the P&L
   * lines.
   *
   * `[ Next Turn ]` is the primary action and resumes the closing flow via
   * {@link onNextTurn}. `[ Bank Loan ]` follows the pre-computed
   * {@link loanDescriptor} (MS-0MVXYCICT0051LU7, wired by
   * MS-0MVXYCJCK006UE62): interactive — normal colour, `UI_CLICK` SFX, one
   * {@link onBankLoanAction} call per press — exactly when the descriptor is
   * enabled, otherwise muted and inert with the descriptor's reason-specific
   * hint and **no** hint line at all when it is enabled.
   *
   * Pressing the enabled `[ Bank Loan ]` swaps the panel for the mid-game loan
   * selector (MS-0MVXYCJVU000QBK1). Confirming an option takes the loan
   * (MS-0MVXYCKFE000VF76) through the undo stack (AP-neutral and reversible —
   * no action point is spent and the day never advances), then the panel is
   * re-presented from the **same** {@link result} against the post-take state,
   * **preserving the selected tab**, so the newly recorded obligation shows up
   * as the disabled `[ Bank Loan ]` hint. `[ Next Turn ]` remains the only way
   * to resume the deferred closing either way.
   *
   * Overlay pattern compliance (AGENTS.md UI Best Practices):
   * `createOverlayBackground` + `createOverlayButton` from `@ui`; ALL elements
   * are parented into `s.hudContainer`; depths 199 (backdrop) / 200 (box) /
   * 201 (elements); instant appearance (no fade-in — reduced-motion safe);
   * SFX via `safePlaySound`; tabs operable by pointer and by the Left/Right
   * arrow keys. Dismissal resets `s.overlayObjects`.
   *
   * @param summary          The turn's rendered summary model.
   * @param onNextTurn       Called when the player clicks [ Next Turn ].
   * @param loanDescriptor   Loans availability for the acting seat, built by
   *                          the Turn Summary gate from the live state. Optional
   *                          so existing call sites keep working; absent (a
   *                          legacy/hand-built state) means disabled with no
   *                          hint, because no reason is known.
   * @param onBankLoanAction Invoked exactly once per press of the enabled
   *                          `[ Bank Loan ]` button; the loans feature hangs
   *                          its selector off this seam.
   * @param result            The closed turn's result the summary was built
   *                          from (`turnLedger` + `incident`). Supplied so a
   *                          post-take refresh can rebuild the summary from the
   *                          **same** result against the live state; absent (a
   *                          hand-built dialog) the supplied summary is re-used
   *                          unchanged and only the loans descriptor refreshes.
   */
  public showTurnSummaryDialog(
    summary: TurnSummary,
    onNextTurn: () => void,
    loanDescriptor?: TurnSummaryLoanDescriptor,
    onBankLoanAction?: () => void,
    result?: Pick<TurnResult, 'turnLedger' | 'incident'>,
  ): void {
    showTabbedTurnSummaryDialog(
      this.scene,
      summary,
      onNextTurn,
      loanDescriptor,
      onBankLoanAction,
      result,
    );
  }

  /**
   * Shows the unified tabbed P&L Turn Summary dialog for a competitive closing
   * (parent MS-0MVO1SFCM000ZLBI, child MS-0MW5ER6HC000HVQ8).
   *
   * The same tabbed statement as {@link showTurnSummaryDialog}, with one
   * **interactive** tab per non-eliminated seat (in seat order, each in its own
   * `resolveSeatColour` colour) and the human `You` tab selected by default;
   * selecting another seat's tab (by pointer or the Left/Right arrow keys)
   * switches the whole statement body to that seat's figures.
   *
   * `[ Next Turn ]` resumes the shared day via {@link onNextTurn}.
   * `[ Bank Loan ]` mirrors the single-player button (MS-0MW4YUHOU00474HZ):
   * interactive in normal colour exactly when the human seat's descriptor
   * (`summary.loanDescriptor`) says it may borrow, muted and inert with the
   * reason-specific hint otherwise. Pressing the enabled button invokes
   * {@link onBankLoanAction} with the human seat id, swaps the panel for the
   * per-seat mid-game loan selector, and re-presents the **same** `TurnResult`
   * panel after the take with the selected tab preserved.
   *
   * Overlay conventions are the renderer's
   * ({@link module:scenes/MainStreetTurnSummaryOverlay}): `hudContainer`
   * parenting, depths 199/200/201, every element tracked in
   * `s.overlayObjects`, instant appearance (reduced-motion safe) and
   * `safePlaySound` for the SFX.
   *
   * @param summary          The per-seat model built from the round ledger (its
   *                          `humanSeatId` + `loanDescriptor` drive the
   *                          button).
   * @param onNextTurn       Called when the player clicks [ Next Turn ].
   * @param onBankLoanAction Per-seat loans seam, invoked with the human seat id
   *                          once per press of the **enabled** `[ Bank Loan ]`
   *                          button. Optional so headless/hand-built callers
   *                          (which never enable the button) stay unchanged.
   * @param result           The closed round's result the summary was built
   *                          from (`playerRoundLedger`), so a post-take refresh
   *                          can re-render the same `TurnResult` panel from the
   *                          live state exactly like the single-player dialog.
   */
  public showCompetitiveTurnSummaryDialog(
    summary: CompetitiveTurnSummary,
    onNextTurn: () => void,
    onBankLoanAction?: (seatId?: number) => void,
    result?: Pick<TurnResult, 'playerRoundLedger'> & { incident?: TurnResult['incident'] },
  ): void {
    showTabbedCompetitiveTurnSummaryDialog(
      this.scene,
      summary,
      onNextTurn,
      onBankLoanAction,
      result,
    );
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
   * Shows the **Company Roster** overlay (MS-0MWC1T8K2000DWZA).
   *
   * Lists every management-company staff member with their role/benefit
   * summary and effective per-turn salary, plus a footer stating the member
   * count and the team's total per-turn salary. Rows and totals come only from
   * {@link buildCompanyRoster}, so the overlay never does its own salary
   * arithmetic, and an explicit empty state replaces an empty panel.
   *
   * Each row offers `[ Lay off ]`, which opens a confirm step quoting the
   * model's coin and reputation cost for that member (never recomputed here).
   * `[ Confirm ]` runs {@link letGoStaffCommand} through the scene's undo
   * manager (so the lay-off stays undoable) and rebuilds the rows + footer in
   * place; `[ Cancel ]` changes nothing. The dialog stays open across a
   * lay-off and shows the empty state when the last member leaves.
   *
   * Overlay pattern compliance: `createOverlayBackground` +
   * `createOverlayButton` from @ui; ALL elements parented into `s.hudContainer`;
   * depths 199 (backdrop) / 200 (box) / 201 (interactive). No animations
   * (reduced-motion safe). Cleanup on dismissal resets `s.overlayObjects`.
   *
   * @param onClose Called after the overlay is dismissed.
   */
  public showCompanyRosterDialog(onClose?: () => void): void {
    const s = this.scene;
    if (s.replayMode) return; // headless/replay: never present UI

    const MAX_ROWS = 10;
    const ROW_H = 42;
    const panelW = 560;
    const centerX = s.layout.gameW / 2;
    const panelLeft = centerX - panelW / 2;
    const panelRight = centerX + panelW / 2;

    // Size the panel for the initial roster (at least one content row so the
    // empty state has room). The height stays fixed so an in-place refresh
    // after a lay-off never resizes the panel under the player's pointer.
    const initial = buildCompanyRoster(s.state);
    const contentRows = Math.max(1, Math.min(initial.count, MAX_ROWS) + (initial.count > MAX_ROWS ? 1 : 0));
    const panelH = Math.max(260, 64 + contentRows * ROW_H + 122);
    const panelY = s.layout.gameH / 2 - panelH / 2;

    const boxConfig = { width: panelW, height: panelH, color: 0x000000, alpha: 1.0, depth: 200 };
    const overlay = createOverlayBackground(s, { depth: 199, alpha: 0.6 }, boxConfig);
    s.overlayObjects.push(...overlay.objects);

    const titleText = s.add.text(centerX, panelY + 24, t(HUD_TOOLTIP_I18N_KEYS.companyRosterTitle), {
      fontSize: '20px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
      align: 'center', wordWrap: { width: panelW - 60 },
    }).setOrigin(0.5).setDepth(201);
    if (s.hudContainer) s.hudContainer.add(titleText);
    s.overlayObjects.push(titleText);

    // Dynamic objects (rows, footer, confirm step) are tracked so a lay-off can
    // rebuild the roster in place while the static frame (backdrop, title,
    // [ Close ]) stays put.
    let dynamic: Phaser.GameObjects.GameObject[] = [];
    const clearDynamic = () => {
      const set = new Set(dynamic);
      s.overlayObjects = s.overlayObjects.filter((obj: any) => !set.has(obj));
      dynamic.forEach((obj) => obj.destroy());
      dynamic = [];
    };
    const addDynamic = (obj: Phaser.GameObjects.GameObject) => {
      dynamic.push(obj);
      s.overlayObjects.push(obj);
    };

    // ── Confirm step (Q2: real coins + reputation, so quote before firing) ──
    let confirm: Phaser.GameObjects.GameObject[] = [];
    const clearConfirm = () => {
      const set = new Set(confirm);
      s.overlayObjects = s.overlayObjects.filter((obj: any) => !set.has(obj));
      confirm.forEach((obj) => obj.destroy());
      confirm = [];
    };
    const addConfirm = (obj: Phaser.GameObjects.GameObject) => {
      confirm.push(obj);
      s.overlayObjects.push(obj);
    };

    const showConfirm = (row: CompanyRosterRow) => {
      clearConfirm();
      clearDynamic(); // hide the roster rows behind the confirm step

      const cW = 440;
      const cH = 210;
      const cX = centerX;
      const cY = s.layout.gameH / 2 - cH / 2;
      const cOverlay = createOverlayBackground(
        s, { depth: 202, alpha: 0.5 }, { width: cW, height: cH, color: 0x000000, alpha: 1.0, depth: 203 },
      );
      for (const obj of cOverlay.objects) addConfirm(obj);

      // Copy comes from the shared builder (MS-0MWCB2Z20006R9FA) — the same
      // single source the business-staff rows use, so the two doors can never
      // drift (MS-0MWCB36A8002NKBX).
      const confirmCopy = buildLayOffConfirmContent(row);
      const confirmTitle = s.add.text(cX, cY + 26, confirmCopy.title, {
        fontSize: '18px', fontStyle: 'bold', color: '#ffcc44', fontFamily: FONT_FAMILY,
        align: 'center', wordWrap: { width: cW - 60 },
      }).setOrigin(0.5).setDepth(204);
      if (s.hudContainer) s.hudContainer.add(confirmTitle);
      addConfirm(confirmTitle);

      const costLine = s.add.text(
        cX, cY + 78,
        confirmCopy.body,
        { fontSize: '14px', color: '#ddccbb', fontFamily: FONT_FAMILY, align: 'center', lineSpacing: 6 },
      ).setOrigin(0.5, 0).setDepth(204);
      if (s.hudContainer) s.hudContainer.add(costLine);
      addConfirm(costLine);

      const confirmBtn = createOverlayButton(s, cX - 90, cY + cH - 44, '[ Confirm ]', 204);
      if (s.hudContainer) s.hudContainer.add(confirmBtn);
      addConfirm(confirmBtn);
      confirmBtn.on('pointerdown', () => {
        safePlaySound(s, SFX_KEYS.DISCARD);
        try {
          const cmd = letGoStaffCommand(s.state, row.staffIndex);
          if (s.undoManager) {
            s.undoManager.execute(cmd);
          } else {
            cmd.execute();
          }
          addLog(
            s.state,
            `Laid off ${row.name} (−${formatCoins(row.layOffCoins)} salary, −${row.layOffReputation} reputation)`,
            'loss',
          );
          flashConfirmation(s, `Laid off ${row.name}`);
        } catch (e) {
          console.error('[CompanyRoster] Lay-off failed:', e);
          flashError(s, `Error laying off: ${(e as Error).message}`);
        }
        clearConfirm();
        // Refresh the world (Staff Pile stack/count) and rebuild the rows in
        // place — the dialog stays open (AC3).
        s.refreshAll();
        s.refreshUndoRedoButtons(s.undoManager.canUndo(), s.undoManager.canRedo());
        renderContent();
      });

      const cancelBtn = createOverlayButton(s, cX + 90, cY + cH - 44, '[ Cancel ]', 204);
      if (s.hudContainer) s.hudContainer.add(cancelBtn);
      addConfirm(cancelBtn);
      cancelBtn.on('pointerdown', () => {
        safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
        clearConfirm();
        renderContent(); // no state change — rows simply reappear
      });
    };

    const renderContent = () => {
      clearDynamic();
      const roster = buildCompanyRoster(s.state);

      if (roster.count === 0) {
        const emptyText = s.add.text(
          centerX, panelY + 100, t(HUD_TOOLTIP_I18N_KEYS.companyRosterEmpty),
          { fontSize: '14px', color: '#bbaa88', fontFamily: FONT_FAMILY, align: 'center', lineSpacing: 4 },
        ).setOrigin(0.5, 0).setDepth(201);
        if (s.hudContainer) s.hudContainer.add(emptyText);
        addDynamic(emptyText);
      } else {
        roster.rows.slice(0, MAX_ROWS).forEach((row, index) => {
          const y = panelY + 64 + index * ROW_H;
          // *Assign to business* affordance (MS-0MWEWIFNT001PUY0): a roster
          // row whose member is an unassigned business-staff member (business
          // card type, never placed) gets the Assign action next to Lay off.
          const member = s.state.staffCards[row.staffIndex];
          const isUnassignedBusinessStaff =
            !!member && member.employedAtSlot == null && staffCardScope(member) === 'business';

          const nameText = s.add.text(panelLeft + 20, y, row.name, {
            fontSize: '14px', fontStyle: 'bold', color: '#ffdd99', fontFamily: FONT_FAMILY,
            wordWrap: { width: 120 },
          }).setOrigin(0, 0).setDepth(201);
          if (s.hudContainer) s.hudContainer.add(nameText);
          addDynamic(nameText);

          const roleText = s.add.text(panelLeft + 146, y, row.roleSummary, {
            fontSize: '11px', color: '#ddccbb', fontFamily: FONT_FAMILY,
            // Rows with both buttons get a narrower role field (mirrors the
            // Manage-Card row layout).
            wordWrap: { width: isUnassignedBusinessStaff ? 100 : 190 },
          }).setOrigin(0, 0).setDepth(201);
          if (s.hudContainer) s.hudContainer.add(roleText);
          addDynamic(roleText);

          const salaryText = s.add.text(
            (isUnassignedBusinessStaff ? panelRight - 204 : panelRight - 118),
            y,
            `${formatCoins(row.salary)}/turn`,
            {
              fontSize: '13px', color: '#ffe08a', fontFamily: FONT_FAMILY, align: 'right',
            },
          ).setOrigin(1, 0).setDepth(201);
          if (s.hudContainer) s.hudContainer.add(salaryText);
          addDynamic(salaryText);

          // Per-row [ Assign ] (MS-0MWEWIFNT001PUY0): begins the free
          // initial placement of THIS unassigned member. The hover tooltip
          // lists the member's legal destinations from the shared affordance
          // builder.
          if (isUnassignedBusinessStaff) {
            const assignBtn = createOverlayButton(s, panelRight - 130, y + 8, '[ Assign ]', 201);
            if (s.hudContainer) s.hudContainer.add(assignBtn);
            addDynamic(assignBtn);
            assignBtn.on('pointerover', () => {
              const affordance = buildMoveStaffAffordance(s.state, row.memberId);
              s.tooltipManager?.show(affordance.tooltip, assignBtn.x, assignBtn.y);
            });
            assignBtn.on('pointerout', () => s.tooltipManager?.hide());
            assignBtn.on('pointerdown', () => {
              safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
              dismissOverlay(s.overlayObjects);
              s.overlayObjects = [];
              s.beginStaffMove(row.memberId);
            });
          }

          const layOffBtn = createOverlayButton(s, panelRight - 56, y + 8, '[ Lay off ]', 201);
          if (s.hudContainer) s.hudContainer.add(layOffBtn);
          addDynamic(layOffBtn);
          layOffBtn.on('pointerdown', () => {
            safePlaySound(s, COMMON_SFX_KEYS.UI_CLICK);
            showConfirm(row);
          });
        });

        if (roster.rows.length > MAX_ROWS) {
          const moreText = s.add.text(
            centerX, panelY + 64 + MAX_ROWS * ROW_H,
            `…and ${roster.rows.length - MAX_ROWS} more`, {
              fontSize: '12px', fontStyle: 'italic', color: '#998877', fontFamily: FONT_FAMILY,
            },
          ).setOrigin(0.5, 0).setDepth(201);
          if (s.hudContainer) s.hudContainer.add(moreText);
          addDynamic(moreText);
        }
      }

      const footer = s.add.text(
        centerX, panelY + panelH - 84,
        t(HUD_TOOLTIP_I18N_KEYS.companyRosterFooter, {
          count: roster.count,
          total: formatCoins(roster.totalSalary),
        }),
        { fontSize: '13px', color: '#ffe08a', fontFamily: FONT_FAMILY, align: 'center', wordWrap: { width: panelW - 60 } },
      ).setOrigin(0.5, 0).setDepth(201);
      if (s.hudContainer) s.hudContainer.add(footer);
      addDynamic(footer);
    };

    renderContent();

    const closeBtn = createOverlayButton(
      s, centerX, panelY + panelH - 40, '[ Close ]', 201,
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
