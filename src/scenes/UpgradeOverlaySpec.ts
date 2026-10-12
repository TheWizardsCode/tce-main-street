/**
 * Upgrade Overlay Spec – describes what visual overlays to render on top of
 * a BusinessCard when it has been upgraded (level > 0).
 *
 * This is a **pure data module** with no Phaser/runtime dependencies so it can
 * be unit-tested in a Node environment. It defines the contract between game
 * state (BusinessCard) and the rendering layer (MainStreetRenderer).
 *
 * ## How it fits into the rendering pipeline
 *
 * 1. `MainStreetRenderer.drawBusinessSlot()` renders the card SVG texture via
 *    `mainStreetRenderCardSvg()`. Upgraded businesses get a **display-name
 *    variant texture** so the upgraded name renders as part of the card image
 *    (CG-0MT24MHGZ0025O20).
 * 2. It then calls `applyUpgradeOverlays()`, which invokes
 *    `buildUpgradeOverlaySpec()` to get overlay specifications (level badge,
 *    top-left upgrade accent, income, reputation — the NAME is intentionally
 *    not part of this spec; it lives in the card face, and the outer border
 *    is the owner's seat colour rather than an upgrade border).
 * 3. The renderer creates Phaser Text/Graphics objects from the spec and adds
 *    them as children of the card's container.
 *
 * ## Extending
 *
 * To add a new overlay element:
 * 1. Add a field to `UpgradeOverlaySpec` and compute it in `buildUpgradeOverlaySpec()`.
 * 2. Handle the new field in `MainStreetRenderer.applyUpgradeOverlays()`.
 * 3. Add unit tests for the spec builder (no Phaser needed).
 *
 * @module UpgradeOverlaySpec
 */

import type { BusinessCard, CommunitySpaceCard } from '../MainStreetCards';

// ---------------------------------------------------------------------------
// Colour constants
// ---------------------------------------------------------------------------

/** Neutral prefix/separator colour for the two-tone cash line (CG-0MTDMOYOL008IQVO). */
export const CASH_LINE_NEUTRAL = '#dddddd';
/** Green income colour for the cash line. */
export const CASH_LINE_INCOME = '#44ff44';
/** Red ongoing-cost colour for the cash line. */
export const CASH_LINE_COST = '#ff6644';

/** Right-column origin for card overlays — left edge of the text column
 *  to the right of the 64×64 graphic (GRAPHIC_X 8 + GRAPHIC_W 64 + 8 gap).
 *  In card-local coords (0,0 = centre) this is -width/2 + 80. */
const TEXT_MIN_X_SVG = 80;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single coloured segment of a multi-tone text overlay. */
export interface OverlayTextSegmentSpec {
  text: string;
  /** Segment colour; defaults to the parent spec's `color` when unset. */
  color?: string;
}

/** Describes a text overlay to be rendered on top of a card. */
export interface OverlayTextSpec {
  text: string;
  x: number;
  y: number;
  fontSize?: string;
  color?: string;
  fontStyle?: string;
  /** Horizontal origin offset (0=left, 0.5=center, 1=right). Default 0. */
  originX?: number;
  /** Vertical origin offset (0=top, 0.5=center, 1=bottom). Default 0. */
  originY?: number;
  /**
   * Optional per-segment colouring (e.g. two-tone cash line). When present,
   * the renderer draws each segment as its own text object laid out
   * left-to-right, so colours can differ within a single line (CG-0MTDMOYOL008IQVO).
   */
  segments?: OverlayTextSegmentSpec[];
}

/**
 * Describes a filled corner accent for upgraded cards.
 *
 * The former full-card `upgradeBorder` is gone (F4 of MS-0MUWNTN8W006C7EF):
 * the placed card's outer frame now carries its owner's colour, so upgrade
 * state is indicated by the top-left level badge plus this small corner
 * accent. Coordinates are container-local (0,0 = card centre) and refer to the
 * accent's top-left corner, matching {@link OverlayTextSpec}.
 */
export interface OverlayAccentSpec {
  /** Left edge of the accent in container-local coordinates. */
  x: number;
  /** Top edge of the accent in container-local coordinates. */
  y: number;
  /** Accent width in pixels. */
  width: number;
  /** Accent height in pixels. */
  height: number;
  /** Filled accent colour (Phaser 24-bit integer). */
  color: number;
  /** Fill alpha (default 1). */
  alpha?: number;
}

/** Complete overlay specification for a BusinessCard. */
export interface UpgradeOverlaySpec {
  /** Level badge text (e.g. "Lvl 2"), null for base cards. */
  levelBadge: OverlayTextSpec | null;
  /**
   * Top-left corner accent marking an upgraded card, null for base cards.
   * Replaces the former full-card `upgradeBorder` (F4 of
   * MS-0MUWNTN8W006C7EF) as the upgrade indicator, now that the outer card
   * frame carries the owner's colour.
   */
  levelAccent: OverlayAccentSpec | null;
  /** Combined cash line (e.g. "+230 / -75"), null when income and cost are both 0.
   *  Replaces the former separate income/cost overlays (CG-0MTCP76MP0088TQW). */
  cashLine: OverlayTextSpec | null;
  /** Per-turn reputation text (e.g. "+20/turn"), null when total reputation is 0. */
  reputationText: OverlayTextSpec | null;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build an overlay specification for a BusinessCard based on its current
 * upgrade state. Returns specs for the level badge, the top-left upgrade
 * accent, the combined cash line and the reputation line.
 *
 * Base cards (level === 0) get `null` for all overlay fields — the renderer
 * skips overlay creation entirely. Upgraded cards (level > 0) get the level
 * badge, the corner accent, and any non-zero cash/reputation lines populated
 * for visual distinction.
 *
 * Note: the upgraded business NAME is intentionally NOT part of the overlay
 * spec (since CG-0MT24MHGZ0025O20 review): it is baked into the card's SVG
 * face as a display-name variant texture by the renderer/texture manager, so
 * it renders as part of the card image like the base name.
 *
 * @param biz - The BusinessCard to generate overlays for.
 * @param width - Card display width in pixels.
 * @param height - Card display height in pixels.
 * @returns An UpgradeOverlaySpec describing all overlays to render.
 */
export function buildUpgradeOverlaySpec(
  biz: BusinessCard | CommunitySpaceCard,
  width: number,
  height: number,
): UpgradeOverlaySpec {
  const isUpgraded = biz.level > 0;
  const totalIncome = biz.baseIncome + biz.incomeBonus;
  const totalReputation = (biz.reputationPerTurn ?? 0) + (biz.reputationBonus ?? 0);

  // Level badge: top-left corner, only for upgraded cards
  // Container origin is at card centre, so subtract width/2 and height/2
  // to convert from absolute-card to container-local coordinates.
  const levelBadge: OverlayTextSpec | null = isUpgraded
    ? {
        text: `Lvl ${biz.level}`,
        x: Math.round(-width / 2 + 4),
        y: Math.round(4 - height / 2),
        fontSize: '10px',
        color: '#ffdd44',
        fontStyle: 'bold',
        originX: 0,
      }
    : null;

  // Top-left corner accent (F4 of MS-0MUWNTN8W006C7EF): the upgrade indicator
  // that replaces the former full-card `upgradeBorder`. It sits behind the
  // level badge text at the card's top-left corner, so upgrade state stays
  // legible now that the outer frame is reserved for the owner's colour.
  const levelAccent: OverlayAccentSpec | null = isUpgraded
    ? {
        x: Math.round(-width / 2),
        y: Math.round(-height / 2),
        width: 30,
        height: 16,
        color: 0xffaa22,
        alpha: 0.92,
      }
    : null;

  // Combined cash line: "+{income} / -{cost}" (CG-0MTCP76MP0088TQW).
  // The former "Cash: " prefix was removed by manual review
  // (CG-0MTORJ5FS006B0UN); the two-tone green/red colouring conveys the
  // meaning without it.
  // Replaces separate income and ongoing-cost overlays that visually overlapped.
  // Shown only when totalIncome > 0 OR ongoingCost > 0.
  // Format: integers without decimals, fractions up to 2 decimal places with
  // trailing zeros stripped (e.g. 0.75, 0.5, not 0.8 or 0.750).
  // Two-tone rendering (CG-0MTDMOYOL008IQVO): income green (#44ff44),
  // ongoing cost red (#ff6644), separator neutral (#dddddd). The
  // renderer draws each segment as its own text object side-by-side.
  const cashLine: OverlayTextSpec | null = (totalIncome > 0 || biz.ongoingCost > 0)
    ? (() => {
        const fmt = (n: number): string =>
          Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
        const hasIncome = totalIncome > 0;
        const hasCost = biz.ongoingCost > 0;
        const parts: string[] = [];
        const segments: OverlayTextSegmentSpec[] = [];
        if (hasIncome) {
          parts.push(`+${fmt(totalIncome)}`);
          segments.push({ text: `+${fmt(totalIncome)}`, color: CASH_LINE_INCOME });
        }
        if (hasCost) {
          parts.push(`-${fmt(biz.ongoingCost)}`);
          if (hasIncome) segments.push({ text: ' / ', color: CASH_LINE_NEUTRAL });
          segments.push({ text: `-${fmt(biz.ongoingCost)}`, color: CASH_LINE_COST });
        }
        const text = parts.join(' / ');
        // Right-column, left-anchored at TEXT_MIN_X (never inside the
        // 64×64 graphic at SVG x < 72). In centre-origin coords: -w/2 + 80.
        return {
          text,
          segments,
          x: Math.round(-width / 2 + TEXT_MIN_X_SVG),
          y: Math.round(-height * 0.04),
          fontSize: '11px',
          color: CASH_LINE_NEUTRAL,
          fontStyle: 'bold',
          originX: 0,
          originY: 0.5,
        };
      })()
    : null;

  // Reputation text: left-aligned below income. Shown for any non-zero
  // reputation — including negative values such as the Pawn Shop penalty
  // (CG-0MUAYBA0L000XLK3). Container origin is at card centre; the sign is
  // carried by the number itself. The zero-check uses the raw total (not the
  // rounded value) so the historical `+0/turn` output for fractional legacy
  // values is preserved.
  const reputationText: OverlayTextSpec | null = totalReputation !== 0
    ? {
        text: `${totalReputation > 0 ? '+' : ''}${Math.round(totalReputation)}/turn`,
        x: Math.round(-width / 2 + TEXT_MIN_X_SVG),
        y: Math.round(height * 0.1),
        fontSize: '11px',
        color: '#88bbff',
        fontStyle: 'bold',
        originX: 0,
        originY: 0.5,
      }
    : null;

  // Name overlay — REMOVED (CG-0MT24MHGZ0025O20 manual review): the upgraded
  // name is baked into the card's SVG texture as a display-name variant, not
  // rendered as a Phaser overlay. The card face therefore shows the upgraded
  // name as a part of the card image, exactly like the base name.

  return { levelBadge, levelAccent, cashLine, reputationText };
}
