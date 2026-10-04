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
 * evenly distributed, with the active seat bold/green and the human seat
 * coloured distinctly from the AI seats. Transient HUD objects, so they are
 * removed by `clearTransientHud` on the next refresh.
 */
export function renderCompetitiveScoreboard(renderer: MainStreetRendererContext): void {
  const s = renderer.scene;
  const rows: CompetitiveScoreboardRow[] = buildCompetitiveScoreboard(s.state);
  if (rows.length === 0) return;

  const { hudLeft, hudWidth, hudY } = s.layout;
  const rowY = hudY - HUD_BAR_HEIGHT_PX / 2 - 4;
  const colWidth = hudWidth / rows.length;

  rows.forEach((row, index) => {
    const x = hudLeft + colWidth * index + colWidth / 2;
    const colour = row.isActive ? '#aaffaa' : row.isHuman ? '#ffcc44' : '#88bbff';
    const text = markHudTransient(
      s.add
        .text(x, rowY, formatCompetitiveScoreboardRow(row), {
          fontSize: '13px',
          fontStyle: row.isActive ? 'bold' : 'normal',
          color: colour,
          fontFamily: FONT_FAMILY,
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
