/**
 * Park reputation bonus (MS-0MVRDGNFU001DDQW).
 *
 * The Park (`cs-park`) was the only community space with no
 * `reputationPerTurn` while carrying the game's highest running cost
 * (40 coins/turn), so it read as a money pit. The producer decision
 * (2026-10-28) adds **+20 reputation per turn** and keeps the pricing
 * (cost 150 / ongoing 40) unchanged.
 *
 * The bonus is a data-only change: `reputationPerTurn` already flows into the
 * card tooltip, the per-turn reputation total and AI placement scoring from
 * `card-data.csv`, so these tests assert the value reaches those public paths
 * without any engine change (AC1, AC2).
 *
 * @module
 */

import { describe, expect, it } from 'vitest';

import { computeReputationPerTurn } from '../../src/MainStreetAdjacencyScoring';
import { createCommunitySpaceDeck, getCsvRows } from '../../src/MainStreetCards';
import { MEDIUM_PRESET } from '../../src/MainStreetDifficulty';
import { buildCardTooltipInfo } from '../../src/MainStreetFormatting';

/** The Park row as parsed from `src/card-data.csv`. */
function parkRow() {
  const row = getCsvRows().find(r => r.id === 'cs-park');
  expect(row, 'cs-park must exist in card-data.csv').toBeDefined();
  return row!;
}

/** A level-1 Park card instantiated from the CSV-backed templates. */
function parkCard() {
  const card = createCommunitySpaceDeck(1).find(c => c.name === 'Park');
  expect(card, 'the community-space deck must contain the Park').toBeDefined();
  return card!;
}

describe('Park reputation bonus (MS-0MVRDGNFU001DDQW)', () => {
  it('AC1: card data gives the Park +20 reputation per turn with pricing unchanged', () => {
    const row = parkRow();

    expect(Number(row.reputationPerTurn)).toBe(20);
    // Producer decision Q2 (2026-10-28): keep 150 / 40 — only the reputation
    // value changes.
    expect(Number(row.cost)).toBe(150);
    expect(Number(row.ongoingCost)).toBe(40);

    expect(parkCard().reputationPerTurn).toBe(20);
    expect(parkCard().cost).toBe(150);
    expect(parkCard().ongoingCost).toBe(40);
  });

  it('AC1: the description states the +20 reputation per turn in the shipped convention', () => {
    expect(parkRow().description).toContain('Provides +20 reputation per turn.');
  });

  it('AC2: the Park tooltip shows the +20 rep/turn line', () => {
    const tooltip = buildCardTooltipInfo(parkCard(), MEDIUM_PRESET);

    expect(tooltip).toContain('Reputation: +20/turn');
    // The tooltip must still surface the unchanged running cost.
    expect(tooltip).toContain('Ongoing cost: -40/turn');
  });

  it('AC2: the per-turn reputation total includes the Park contribution', () => {
    // computeReputationPerTurn is the engine path that credits passive
    // reputation each turn; a lone Park contributes exactly its base value.
    expect(computeReputationPerTurn([parkCard()])).toBe(20);
  });
});
