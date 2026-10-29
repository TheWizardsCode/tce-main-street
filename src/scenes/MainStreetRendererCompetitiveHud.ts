/**
 * Main Street: Competitive HUD Rendering
 *
 * Renders the per-player scoreboard and active-seat indicator for competitive
 * mode (child MS-0MUTU8J9T0034OT7 of epic MS-0MUTTVR5K002ZDUP).
 *
 * The default HUD shows the shared `state.resourceBank`, which is bound to the
 * active seat — misleading in competitive mode. This module renders every
 * seat's own coins/reputation/score from `state.players`, highlights the active
 * seat and visually distinguishes the human seat from the AI seats.
 *
 * Scope is deliberately minimal (producer Q1): no owner-coloured street
 * rendering, shared-market phase affordances or action SFX (those remain with
 * `MS-0MTIILOLR002ZU9K`). The row-model builder lives in the Phaser-free
 * {@link module:./MainStreetCompetitiveScoreboard}; only
 * {@link renderCompetitiveScoreboard} touches the scene.
 *
 * @module
 */

import { FONT_FAMILY, markHudTransient } from '@ui';
import { HUD_BAR_HEIGHT_PX } from './MainStreetConstants';
import type { MainStreetRendererContext } from './MainStreetRendererContext';
import {
  buildCompetitiveScoreboard,
  formatCompetitiveScoreboardRow,
  type CompetitiveScoreboardRow,
} from './MainStreetCompetitiveScoreboard';

export {
  buildCompetitiveScoreboard,
  formatCompetitiveScoreboardRow,
  type CompetitiveScoreboardRow,
} from './MainStreetCompetitiveScoreboard';

/**
 * Renders the per-player scoreboard above the HUD strip: one cell per seat,
 * evenly distributed, each drawn in its own persisted seat colour (F5 of
 * MS-0MUWNTN8W006C7EF) so a seat reads as the same colour here, in the
 * activity-log prefix (F3) and on its placed-card border (F4). The active seat
 * is additionally bold and prefixed with `▶`, so the indicator uses the active
 * seat's colour without relying on colour alone. Transient HUD objects, so they
 * are removed by `clearTransientHud` on the next refresh.
 */

/**
 * Neutral fallback text colour for a row with no resolved seat colour.
 *
 * Competitive rows always carry a seat colour (see
 * {@link CompetitiveScoreboardRow.colour}); this only guards a malformed or
 * single-seat roster, so it is deliberately not a seat colour.
 */
const NEUTRAL_ROW_COLOUR = '#ffffff';
export function renderCompetitiveScoreboard(renderer: MainStreetRendererContext): void {
  const s = renderer.scene;
  const rows: CompetitiveScoreboardRow[] = buildCompetitiveScoreboard(s.state);
  if (rows.length === 0) return;

  const { hudLeft, hudWidth, hudY } = s.layout;
  const rowY = hudY - HUD_BAR_HEIGHT_PX / 2 - 4;
  const colWidth = hudWidth / rows.length;

  rows.forEach((row, index) => {
    const x = hudLeft + colWidth * index + colWidth / 2;
    const colour = row.colour ?? NEUTRAL_ROW_COLOUR;
    const text = markHudTransient(
      s.add
        .text(x, rowY, formatCompetitiveScoreboardRow(row), {
          fontSize: '13px',
          fontStyle: row.isActive ? 'bold' : 'normal',
          color: colour,
          fontFamily: FONT_FAMILY,
          // The per-seat loan obligation (MS-0MVPWSCRD004A6Z4) lengthens a row,
          // so wrap inside the seat's own cell instead of spilling into the
          // neighbouring seat's readout.
          align: 'center',
          wordWrap: { width: Math.max(60, Math.floor(colWidth) - 12) },
        })
        .setOrigin(0.5, 1),
    );
    text.setName('competitive-scoreboard-row');
    text.setData('playerId', row.playerId);
    text.setData('active', row.isActive);
    text.setData('human', row.isHuman);
    s.hudContainer.add(text);
  });
}
