/**
 * Reputation-source re-tune contract (MS-0MUR9IMN60093HIE).
 *
 * After the five-turn payback rebalance (MS-0MUQ50I1Y000B6L3) reduced business
 * `baseIncome` ~2.4×, reputation collapse became the dominant Medium loss mode
 * (69% of losses, PRD §G5 band 20–40%). This contract pins the evidence-led
 * re-tune that restores the band: every **positive** business and
 * community-space `reputationPerTurn` is scaled **×4**, negative sources are
 * left untouched, and the Community Favour conversion rates are unchanged
 * (measured ineffective for the greedy AI; see
 * `docs/main-street/reputation-retune-evidence.md`).
 *
 * Acceptance criteria covered:
 *   (AC2) The re-tune is confined to the named reputation levers — no engine
 *         rules and no Community Favour rate changes.
 *   (AC5) The tuned card values and the Community Favour invariants are
 *         asserted so future rebalances cannot silently regress.
 *
 * @module
 */

import { describe, it, expect } from 'vitest';

import { getBusinessTemplates, getCommunitySpaceTemplates } from '../../src/MainStreetCards';
import { DIFFICULTY_PRESETS } from '../../src/MainStreetDifficulty';

/**
 * Pre-retune (`card-data.csv` at commit `8b8fe46`) reputation-per-turn values.
 * The re-tune multiplies every positive entry by 4 and keeps negatives as-is.
 */
const PRE_RETUNE_BUSINESS_REP: Record<string, number> = {
  'biz-bakery': 5,
  'biz-diner': 5,
  'biz-bookshop': 5,
  'biz-hardware': 5,
  'biz-pawnshop': -10,
  'biz-boutique': 5,
  'biz-laundromat': 5,
  'biz-barbershop': 8,
  'biz-arcade': 5,
  'biz-cinema': 8,
  'biz-cafe': 10,
  'biz-food-truck': 5,
  'biz-gallery': 25,
  'biz-spa': 25,
  'biz-florist': 10,
  'biz-clinic': 40,
  'biz-private-clinic': 25,
  'biz-pharmacy': 10,
  'biz-juice-bar': 8,
  'biz-yoga-studio': 12,
  'biz-physio': 15,
  'biz-tailor': 8,
  'biz-gym': 12,
  'biz-dentist': 20,
  'biz-toy-store': 8,
  'biz-music-store': 12,
  'biz-delicatessen': 8,
  'biz-craft-shop': 8,
  'biz-hotel': 30,
  'biz-teahouse': 10,
  'biz-charity-shop': 15,
};

const PRE_RETUNE_COMMUNITY_SPACE_REP: Record<string, number> = {
  'cs-park': 0,
  'cs-library': 10,
  'cs-playground': 5,
  'cs-community-garden': 10,
  'cs-fountain': 10,
  'cs-health-kiosk': 15,
  'cs-shelter': 15,
  'cs-public-art': 20,
};

const RETUNE_MULTIPLIER = 4;

/** Expected post-retune value: positives scale ×4, non-positives are unchanged. */
function expectedRetuned(pre: number): number {
  return pre > 0 ? pre * RETUNE_MULTIPLIER : pre;
}

describe('Reputation-source re-tune contract (MS-0MUR9IMN60093HIE)', () => {
  it('scales every positive business reputationPerTurn ×4, leaving negatives unchanged', () => {
    const templates = getBusinessTemplates();
    expect(templates).toHaveLength(Object.keys(PRE_RETUNE_BUSINESS_REP).length);

    for (const t of templates) {
      const pre = PRE_RETUNE_BUSINESS_REP[t.id];
      expect(pre, `no pre-retune baseline recorded for ${t.id}`).toBeDefined();
      expect(t.reputationPerTurn ?? 0).toBe(expectedRetuned(pre));
    }
  });

  it('scales every positive community-space reputationPerTurn ×4, leaving zero unchanged', () => {
    const templates = getCommunitySpaceTemplates();
    expect(templates).toHaveLength(Object.keys(PRE_RETUNE_COMMUNITY_SPACE_REP).length);

    for (const t of templates) {
      const pre = PRE_RETUNE_COMMUNITY_SPACE_REP[t.id];
      expect(pre, `no pre-retune baseline recorded for ${t.id}`).toBeDefined();
      expect(t.reputationPerTurn ?? 0).toBe(expectedRetuned(pre));
    }
  });

  it('pins the reputation anchors that dominate passive recovery', () => {
    const business = getBusinessTemplates();
    const community = getCommunitySpaceTemplates();
    const rep = (list: readonly { id: string; reputationPerTurn?: number }[], id: string) =>
      list.find(t => t.id === id)?.reputationPerTurn;

    // Anchors quoted in the work item / evidence artefact.
    expect(rep(business, 'biz-bakery')).toBe(20);
    expect(rep(business, 'biz-cafe')).toBe(40);
    expect(rep(business, 'biz-gallery')).toBe(100);
    expect(rep(business, 'biz-hotel')).toBe(120);
    expect(rep(business, 'biz-clinic')).toBe(160);
    expect(rep(community, 'cs-library')).toBe(40);
    expect(rep(community, 'cs-playground')).toBe(20);
    expect(rep(community, 'cs-public-art')).toBe(80);
  });

  it('leaves the Community Favour conversion rates unchanged on every preset', () => {
    // The re-tune deliberately does NOT touch Community Favour: the greedy AI
    // scores coins-to-rep at 1 and treats it as a fallback, so reducing
    // `favourCoinsToRepCost` moved the Medium split by <2 pp (measured).
    for (const [name, preset] of Object.entries(DIFFICULTY_PRESETS)) {
      expect(preset.favourCoinsToRepCost, `${name}: favourCoinsToRepCost`).toBe(200);
      expect(preset.favourRepToCoinsRepCost, `${name}: favourRepToCoinsRepCost`).toBe(200);
      expect(preset.favourRepToCoinsCoinGain, `${name}: favourRepToCoinsCoinGain`).toBe(300);
    }
  });
});
