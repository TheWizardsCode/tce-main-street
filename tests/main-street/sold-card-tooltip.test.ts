/**
 * Sold-Card Tooltip Test
 *
 * Guards the sold-card tooltip copy through the production tooltip builder.
 *
 * The sold-business semantics (CG-0MT5XUE2200047IJ, CG-0MTFS4PP40064GHE):
 * a sold business produces 0 income/reputation for itself, but still acts
 * as a synergy anchor for adjacent businesses. The tooltip must reflect
 * that — it must NOT claim synergy stops.
 *
 * @module
 */
import { describe, it, expect } from 'vitest';

import {
  formatSoldCardTooltip,
  SOLD_CARD_TOOLTIP_SYNERGY_LINE,
} from '../../src/MainStreetFormatting';

describe('Main Street sold-card tooltip (CG-0MTFS4PP40064GHE)', () => {
  it('names the sold card in the tooltip', () => {
    expect(formatSoldCardTooltip({ name: 'The Diner' })).toContain('Sold: The Diner');
  });

  it('states the sold card still provides synergy to adjacent businesses', () => {
    expect(formatSoldCardTooltip({ name: 'The Diner' })).toContain(
      SOLD_CARD_TOOLTIP_SYNERGY_LINE,
    );
    expect(SOLD_CARD_TOOLTIP_SYNERGY_LINE).toContain(
      'still provides synergy to adjacent businesses',
    );
  });

  it('no longer claims synergy stops for a sold card', () => {
    expect(formatSoldCardTooltip({ name: 'The Diner' })).not.toContain(
      'no longer produces income or synergy',
    );
  });
});
