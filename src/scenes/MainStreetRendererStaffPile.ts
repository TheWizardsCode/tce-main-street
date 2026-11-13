/**
 * Main Street: Staff Pile rendering
 *
 * Draws the management company's own staff as a **Staff Pile**: a fanned stack
 * of small card faces (newest hire on top) with a count badge, and a small
 * portrait row beneath the stack. Hovering the pile shows the
 * management-company-only summary tooltip (`buildStaffPileTooltip`).
 *
 * ## Contract (MS-0MWBWKZ1G006IBH2)
 *
 * - **Derived, never persisted.** The pile is rebuilt from
 *   `state.staffCards`' management-company members on every hand refresh
 *   (`selectManagementCompanyStaff` → card type via `staffCardScope`, so a
 *   hired-but-unassigned business-staff member never reaches the pile —
 *   MS-0MWEWIJGU005FWYI). There is no layout state, save field or engine
 *   command behind it.
 * - **Empty state.** No management-company staff ⇒ nothing is drawn at all (no
 *   placeholder tile) — the pile simply does not exist.
 * - **Behind the hand.** {@link STAFF_PILE_DEPTH} sits below the hand panel
 *   ({@link HAND_PANEL_DEPTH}) and every hand card, so at a wide hand the panel
 *   covers the pile's right edge rather than the pile covering a playable card
 *   — and hand-card input is never intercepted.
 * - **One hit area, confined to the free band.** The only interactive object is
 *   a hover hit area clamped to the pile zone *and* to the left of the hand
 *   capacity row, so hand-card clicks, hand→street drags and market→hand drops
 *   are untouched. It carries the hover tooltip **and** a pointer-down hand-off
 *   that calls `renderer.onOpenCompanyRoster` — the pile itself carries no
 *   roster logic (MS-0MWC9PDQY003O0XQ).
 * - **Rebuilt, not accumulated.** Like `drawHandPanel()`, every call destroys
 *   the previous pile container before drawing, so repeated refreshes cannot
 *   leak game objects.
 *
 * Import graph: depends only on `MainStreetRendererContext` (type).
 *
 * @module
 */

import { FONT_FAMILY } from '@ui';
import { mainStreetRenderCardSvg } from '@ui/Renderer/adapters/MainStreetAdapter';
import type Phaser from 'phaser';

import type { StaffCard } from '../MainStreetCards';
import { selectManagementCompanyStaff } from '../MainStreetStaffBuffs';
import {
  BOX_RADIUS,
  BOX_STROKE,
  HAND_SLOT_PITCH_PAD,
  PANEL_FILL,
  PANEL_FILL_ALPHA,
  PANEL_STROKE_ALPHA,
  STAFF_PILE_CARD_H,
  STAFF_PILE_CARD_W,
  STAFF_PILE_DEPTH,
  STAFF_PILE_GAP_PX,
  STAFF_PILE_PANEL_PAD,
  STAFF_PILE_PORTRAIT_H,
  STAFF_PILE_PORTRAIT_W,
  STAFF_PILE_STACK_OFFSET_X,
  STAFF_PILE_STACK_OFFSET_Y,
  STAFF_PILE_STACK_SIZE,
} from './MainStreetConstants';
import type { MainStreetRendererContext } from './MainStreetRendererContext';
import { buildStaffPileTooltip } from './MainStreetHudTooltips';

/** Container name for the pile (tests and QA locate it by this name). */
export const STAFF_PILE_NAME = 'ms-staff-pile';

/** Name of the pile's hover hit area. */
export const STAFF_PILE_HIT_NAME = 'ms-staff-pile-hit';

/** Gap (px) between portraits in the portrait row. */
const PORTRAIT_GAP = 4;

/** Count-badge diameter (px). */
const BADGE_SIZE = 20;

/**
 * Destroy the current pile (container and every child object).
 *
 * Safe to call when no pile exists, so the draw path can start with it.
 */
export function destroyStaffPile(renderer: MainStreetRendererContext): void {
  const s = renderer.scene;
  const container = s.staffPileContainer as Phaser.GameObjects.Container | undefined;
  if (container && container.active) {
    try {
      container.destroy(true);
    } catch {
      /* already torn down */
    }
  }
  s.staffPileContainer = undefined;
  s.staffPileHitArea = undefined;
}

/**
 * The pile zone clamped to the free band left of the hand capacity row.
 *
 * The pile zone is anchored against the left edge and is sized for the
 * starting hand; once `maxHandSize` grows the capacity row sweeps left beneath
 * it (the pile is drawn behind the hand panel, so the row stays visible). The
 * hover hit area is clamped to the free band so it can never sit over a hand
 * card slot.
 *
 * @returns The clamps resolved from layout + live capacity; `null` when the
 *          pile zone has no area (legacy layout without the zone).
 */
export function staffPileHitBounds(renderer: MainStreetRendererContext): {
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  const s = renderer.scene;
  const { staffPileX, staffPileY, staffPileW, staffPileH, handCenterX, handCardW } = s.layout;
  if (!(Number(staffPileW) > 0) || !(Number(staffPileH) > 0)) return null;

  const maxSlots = Math.max(0, Number(s.state?.maxHandSize) || 0);
  const capacityRowLeft = handCenterX - (maxSlots * (handCardW + HAND_SLOT_PITCH_PAD)) / 2;
  const right = Math.min(staffPileX + staffPileW, capacityRowLeft);
  const width = Math.max(0, right - staffPileX);
  if (width <= 0) return null;

  return { x: staffPileX, y: staffPileY, w: width, h: staffPileH };
}

/**
 * Draw (or clear) the Staff Pile.
 *
 * Rebuilt from `state.staffCards` on every call — the hand-refresh path calls
 * this next to `drawHandPanel()`, so hires, lay-offs and `maxHandSize` changes
 * are all reflected.
 */
export function drawStaffPile(renderer: MainStreetRendererContext): void {
  const s = renderer.scene;
  destroyStaffPile(renderer);

  const { staffPileX, staffPileY, staffPileW, staffPileH } = s.layout;
  if (!(Number(staffPileW) > 0) || !(Number(staffPileH) > 0)) return;

  const members = selectManagementCompanyStaff((s.state?.staffCards ?? []) as StaffCard[]);
  // Empty state: no management-company staff ⇒ no pile, no placeholder tile.
  if (members.length === 0) return;

  const container = s.add.container(0, 0);
  container.setName(STAFF_PILE_NAME);
  container.setDepth(STAFF_PILE_DEPTH);

  // ── Panel: the pile's visual home ───────────────────────────────
  // Same treatment as the hand panel so the bottom band reads as one
  // surface family (shared PANEL_FILL / BOX_STROKE / BOX_RADIUS tokens).
  const panel = s.add.graphics();
  panel.fillStyle(PANEL_FILL, PANEL_FILL_ALPHA);
  panel.fillRoundedRect(staffPileX, staffPileY, staffPileW, staffPileH, BOX_RADIUS);
  panel.lineStyle(1, BOX_STROKE, PANEL_STROKE_ALPHA);
  panel.strokeRoundedRect(staffPileX, staffPileY, staffPileW, staffPileH, BOX_RADIUS);
  panel.setName(`${STAFF_PILE_NAME}-panel`);
  container.add(panel);

  // ── Card-face stack: oldest of the shown slice first, newest on top ──
  // `state.staffCards` keeps hire order, so the tail is the newest hire and
  // drawing it last puts it on top of the fan.
  const shownStack = members.slice(-STAFF_PILE_STACK_SIZE);
  const stackLeft = staffPileX + STAFF_PILE_PANEL_PAD;
  const stackTop = staffPileY + STAFF_PILE_PANEL_PAD;
  shownStack.forEach((member, index) => {
    const cardContainer = s.add.container(
      stackLeft + STAFF_PILE_CARD_W / 2 + index * STAFF_PILE_STACK_OFFSET_X,
      stackTop + STAFF_PILE_CARD_H / 2 + index * STAFF_PILE_STACK_OFFSET_Y,
    );
    mainStreetRenderCardSvg(s, cardContainer, member.id, STAFF_PILE_CARD_W, STAFF_PILE_CARD_H);
    cardContainer.setData('staffPileCardId', member.id);
    container.add(cardContainer);
  });

  // ── Count badge over the top-right corner of the stack ─────────
  const topCardIndex = Math.max(0, shownStack.length - 1);
  const badgeX =
    stackLeft + STAFF_PILE_CARD_W + topCardIndex * STAFF_PILE_STACK_OFFSET_X - BADGE_SIZE / 4;
  const badgeY = stackTop + topCardIndex * STAFF_PILE_STACK_OFFSET_Y + BADGE_SIZE / 4;
  const badge = s.add.rectangle(badgeX, badgeY, BADGE_SIZE, BADGE_SIZE, 0x1a2f55, 0.95);
  badge.setStrokeStyle(1, 0xffffff, 0.8);
  badge.setName(`${STAFF_PILE_NAME}-badge`);
  container.add(badge);
  const badgeText = s.add
    .text(badgeX, badgeY, `${members.length}`, {
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#ffffff',
      fontFamily: FONT_FAMILY,
    })
    .setOrigin(0.5);
  badgeText.setData('staffPileCount', members.length);
  container.add(badgeText);

  // ── Portrait row beneath the stack ─────────────────────────────
  // One portrait per member that fits the zone width; the count badge still
  // reports the full roster when the row cannot show everyone.
  const rowTop = stackTop + STAFF_PILE_CARD_H + STAFF_PILE_GAP_PX + STAFF_PILE_PORTRAIT_H / 2;
  const zoneInnerW = staffPileW - STAFF_PILE_PANEL_PAD * 2;
  const perRow = Math.max(
    1,
    Math.floor((zoneInnerW + PORTRAIT_GAP) / (STAFF_PILE_PORTRAIT_W + PORTRAIT_GAP)),
  );
  members.slice(0, perRow).forEach((member, index) => {
    const portrait = s.add.container(
      stackLeft + STAFF_PILE_PORTRAIT_W / 2 + index * (STAFF_PILE_PORTRAIT_W + PORTRAIT_GAP),
      rowTop,
    );
    mainStreetRenderCardSvg(s, portrait, member.id, STAFF_PILE_PORTRAIT_W, STAFF_PILE_PORTRAIT_H);
    portrait.setData('staffPilePortraitId', member.id);
    container.add(portrait);
  });

  // ── Hover tooltip + click hand-off: the pile's interactions ─────
  // Skipped in replay mode, matching the hand/business card tooltips, so
  // playback shows no hover or click affordances. Pointer-down hands off to
  // the Company Roster through the renderer context — the pile carries no
  // roster logic of its own (MS-0MWC9PDQY003O0XQ).
  const hitBounds = staffPileHitBounds(renderer);
  if (!s.replayMode && hitBounds) {
    const hit = s.add.rectangle(
      hitBounds.x + hitBounds.w / 2,
      hitBounds.y + hitBounds.h / 2,
      hitBounds.w,
      hitBounds.h,
      0x000000,
      0.001,
    );
    hit.setName(STAFF_PILE_HIT_NAME);
    hit.setInteractive({ useHandCursor: false });
    hit.on('pointerover', () => {
      const info = buildStaffPileTooltip(s.state);
      if (!info) return;
      s.tooltipManager?.show(info, hit.x, hit.y - hitBounds.h / 2);
    });
    hit.on('pointerout', () => {
      s.tooltipManager?.hide();
    });
    hit.on('pointerdown', () => {
      s.tooltipManager?.hide();
      renderer.onOpenCompanyRoster?.();
    });
    container.add(hit);
    s.staffPileHitArea = hit;
  }

  s.staffPileContainer = container;
}
