/**
 * Unit tests for MainStreetCardSvgGenerator — generates SVG strings
 * dynamically for BusinessCard and CommunitySpaceCard based on state.
 *
 * These tests run in any JS environment (no Phaser dependency).
 */

import { describe, it, expect } from 'vitest';
import {
  generateBusinessCardSvg,
  generateCardSvgFromCsvRow,
  replaceCardTitleInSvg,
} from '../../src/scenes/MainStreetCardSvgGenerator';
import { CARD_FACE_PALETTE, cardFaceBackground } from '../../src/MainStreetCards';
import type { BusinessCard, CommunitySpaceCard, SynergyType } from '../../src/MainStreetCards';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CARD_W = 140;
const CARD_H = 80;

function makeBiz(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: 'biz-test-0',
    name: 'Test Business',
    cost: 6,
    baseIncome: 1,
    synergyTypes: ['Food'],
    maxLevel: 2,
    description: 'A test business',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    ongoingCost: 0,
    appliedUpgrades: [],
    ...overrides,
  };
}

function makeCommunitySpace(overrides: Partial<CommunitySpaceCard> = {}): CommunitySpaceCard {
  return {
    family: 'community-space',
    id: 'cs-test-0',
    name: 'Test Community Space',
    cost: 4,
    baseIncome: 0,
    ongoingCost: 0,
    synergyTypes: ['Culture'],
    maxLevel: 1,
    description: 'A test community space',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    appliedUpgrades: [],
    ...overrides,
  };
}

/** Extract the level-badge `<text>` element from a generated card SVG. */
function extractLevelBadgeText(svg: string): string {
  const match = svg.match(/<text[^>]*>Lvl \d+<\/text>/);
  if (!match) throw new Error('level badge <text> element not found');
  return match[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateBusinessCardSvg - base cards (level === 0)', () => {
  it('should include the card name as title', () => {
    const biz = makeBiz({ name: 'Bakery', level: 0 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).toContain('Bakery');
  });

  it('should show income text with Income: prefix when baseIncome > 0', () => {
    const biz = makeBiz({ baseIncome: 2, level: 0 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).toContain('Income: +2/turn');
  });

  it('should omit income text when total income is 0', () => {
    const biz = makeBiz({ baseIncome: 0, incomeBonus: 0, level: 0 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).not.toContain('+0/turn');
    expect(svg).not.toContain('Income: +0/turn');
  });

  it('should show reputation text when reputationPerTurn > 0', () => {
    const biz = makeBiz({ reputationPerTurn: 20, level: 0 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).toContain('+20/turn');
  });

  it('should omit reputation text when total reputation is 0', () => {
    const biz = makeBiz({ baseIncome: 1, level: 0 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).not.toMatch(/reputation.*0\.0\/turn/);
    expect(svg).not.toMatch(/\+0\.0\/turn/);
  });

  it('should not show level badge for base cards', () => {
    const biz = makeBiz({ level: 0 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).not.toContain('Lvl 0');
  });

  it('should include cost value formatted with the currency symbol', () => {
    const biz = makeBiz({ cost: 6, level: 0 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).toContain('>€6<');
  });

  it('should include synergy icon', () => {
    const biz = makeBiz({ synergyTypes: ['Food'], level: 0 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).toContain('Food icon');
  });
});

describe('generateBusinessCardSvg - upgraded cards (level > 0)', () => {
  it('should show the upgraded display name as the baked card title (CG-0MT24MHGZ0025O20)', () => {
    // Base name stays "Bakery" (readonly identity); displayName carries the
    // upgraded name. The card face must bake in the upgraded name.
    const biz = makeBiz({ name: 'Bakery', displayName: 'Patisserie', level: 1 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).toContain('Patisserie');
    expect(svg).not.toContain('>Bakery</text>');
    expect(svg).toContain('aria-label="Patisserie"');
  });

  it('should fall back to the base name when displayName is unset', () => {
    const biz = makeBiz({ name: 'Bakery', level: 1 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).toContain('>Bakery</text>');
  });

  it('should show updated name on upgrade', () => {
    const biz = makeBiz({ name: 'Patisserie', level: 1 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).toContain('Patisserie');
  });

  it('should show level badge for upgraded cards at the top-left', () => {
    const biz = makeBiz({ level: 2 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    const badge = extractLevelBadgeText(svg);
    expect(badge).toContain('Lvl 2');
    // Top-left contract: left inset (x="8") and left-anchored text.
    expect(badge).toMatch(/x="8"/);
    expect(badge).toContain('text-anchor="start"');
    expect(badge).not.toContain('text-anchor="end"');
  });

  it('should show combined income (base + bonus)', () => {
    const biz = makeBiz({ baseIncome: 1, incomeBonus: 2, level: 1 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).toContain('Income: +3/turn');
  });

  it('should show combined reputation (base + bonus)', () => {
    const biz = makeBiz({ reputationPerTurn: 20, reputationBonus: 10, level: 1 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).toContain('+30/turn');
  });

  it('should show cost value formatted with the currency symbol', () => {
    const biz = makeBiz({ cost: 4, level: 1 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).toContain('>€4<');
  });
});

describe('generateBusinessCardSvg - community space cards', () => {
  it('should include community space name', () => {
    const cs = makeCommunitySpace({ name: 'Park', level: 0 });
    const svg = generateBusinessCardSvg(cs, CARD_W, CARD_H);
    expect(svg).toContain('Park');
  });

  it('should show income for community spaces with income', () => {
    const cs = makeCommunitySpace({ baseIncome: 1, level: 0 });
    const svg = generateBusinessCardSvg(cs, CARD_W, CARD_H);
    expect(svg).toContain('Income: +1/turn');
  });

  it('should show reputation for community spaces with reputation', () => {
    const cs = makeCommunitySpace({ reputationPerTurn: 10, level: 0 });
    const svg = generateBusinessCardSvg(cs, CARD_W, CARD_H);
    expect(svg).toContain('+10/turn');
  });

  it('should show the level badge at the top-left when upgraded', () => {
    const cs = makeCommunitySpace({ level: 1, baseIncome: 1 });
    const svg = generateBusinessCardSvg(cs, CARD_W, CARD_H);
    const badge = extractLevelBadgeText(svg);
    expect(badge).toContain('Lvl 1');
    expect(badge).toMatch(/x="8"/);
    expect(badge).toContain('text-anchor="start"');
    expect(badge).not.toContain('text-anchor="end"');
  });
});

describe('generateBusinessCardSvg - formatting', () => {
  it('should format integer reputation without decimal', () => {
    const biz = makeBiz({ reputationPerTurn: 100, level: 0 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).toContain('+100/turn');
    expect(svg).not.toContain('+100.0/turn');
  });

  // After the ×100 integer economy (CG-0MTIO1M15001E9Y6), all reputation
  // values are integers — no fractional reputation exists in the data.
  // The previous test "format fractional reputation with one decimal"
  // has been removed as fractional reputation is no longer supported.

  it('should produce valid SVG with proper XML structure', () => {
    const biz = makeBiz({ level: 0 });
    const svg = generateBusinessCardSvg(biz, CARD_W, CARD_H);
    expect(svg).toContain('<?xml version="1.0"');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });
});

describe('generateBusinessCardSvg - synergy face colouring (MS-0MUZH51PU007POJ4)', () => {
  const paletteEntries = Object.entries(CARD_FACE_PALETTE).filter(
    ([key]) => key !== 'default',
  ) as Array<[SynergyType, string]>;

  it('colours a single-synergy face with that synergy\'s palette colour', () => {
    for (const [synergy, colour] of paletteEntries) {
      const svg = generateBusinessCardSvg(makeBiz({ synergyTypes: [synergy] }));
      expect(svg, synergy).toContain(`rx="6" ry="6" fill="${colour}"`);
      expect(svg, synergy).not.toContain('fill="#2f2f2f"');
    }
  });

  it('splits a two-synergy bridge face into horizontal top/bottom bands', () => {
    const svg = generateBusinessCardSvg(
      makeBiz({ id: 'biz-bridge', synergyTypes: ['Food', 'Culture'] }),
    );
    // Rounded clip preserves the corners; neither band bleeds past them.
    expect(svg).toContain('ms-face-clip-biz-bridge');
    expect(svg).toContain('clip-path="url(#ms-face-clip-biz-bridge)"');
    // 140×80 card → two 140×40 bands.
    expect(svg).toContain('<rect x="0" y="0" width="140" height="40" fill="#5D4037" />');
    expect(svg).toContain('<rect x="0" y="40" width="140" height="40" fill="#1565C0" />');
    // No single-tone neutral/rounded face for a bridge card.
    expect(svg).not.toContain('rx="6" ry="6" fill="#2f2f2f"');
  });

  it('orders the bands by synergyTypes order (top = first entry)', () => {
    const svg = generateBusinessCardSvg(
      makeBiz({ id: 'biz-reversed', synergyTypes: ['Culture', 'Food'] }),
    );
    expect(svg).toContain('<rect x="0" y="0" width="140" height="40" fill="#1565C0" />');
    expect(svg).toContain('<rect x="0" y="40" width="140" height="40" fill="#5D4037" />');
  });

  it('renders both synergy icons for a bridge card (colour is not the only cue)', () => {
    const svg = generateBusinessCardSvg(makeBiz({ synergyTypes: ['Food', 'Culture'] }));
    expect(svg).toContain('Food icon');
    expect(svg).toContain('Culture icon');
  });

  it('keeps the neutral face and no split when a card has zero synergy types', () => {
    const svg = generateBusinessCardSvg(makeBiz({ synergyTypes: [] }));
    expect(svg).toContain('rx="6" ry="6" fill="#2f2f2f"');
    expect(svg).not.toContain('ms-face-clip-');
  });

  it('degrades safely to the first colour when more than two synergy types are present', () => {
    const svg = generateBusinessCardSvg(
      makeBiz({ id: 'biz-tri', synergyTypes: ['Food', 'Culture', 'Health'] }),
    );
    expect(svg).not.toContain('ms-face-clip-biz-tri');
    expect(svg).toContain('rx="6" ry="6" fill="#5D4037"');
  });
});

describe('generateCardSvgFromCsvRow - synergy face colouring (MS-0MUZH51PU007POJ4)', () => {
  it('colours a single-synergy CSV-row business face with the palette colour', () => {
    const svg = generateCardSvgFromCsvRow({
      id: 'biz-bakery',
      name: 'Bakery',
      family: 'business',
      cost: '300',
      synergyTypes: 'Food',
    });
    expect(svg).toContain('rx="6" ry="6" fill="#5D4037"');
    expect(svg).not.toContain('fill="#2f2f2f"');
  });

  it('splits a bridge CSV row top/bottom in synergyTypes order', () => {
    const svg = generateCardSvgFromCsvRow({
      id: 'biz-cafe',
      name: 'Cafe',
      family: 'business',
      cost: '700',
      synergyTypes: 'Food|Culture',
    });
    expect(svg).toContain('ms-face-clip-biz-cafe');
    expect(svg).toContain('<rect x="0" y="0" width="140" height="40" fill="#5D4037" />');
    expect(svg).toContain('<rect x="0" y="40" width="140" height="40" fill="#1565C0" />');
  });

  it('renders both synergy icons for a bridge CSV row', () => {
    const svg = generateCardSvgFromCsvRow({
      id: 'biz-cafe',
      name: 'Cafe',
      family: 'business',
      cost: '700',
      synergyTypes: 'Food|Culture',
    });
    expect(svg).toContain('Food icon');
    expect(svg).toContain('Culture icon');
  });

  it('uses the bright first-synergy accent for the graphic/header of synergy cards', () => {
    const svg = generateCardSvgFromCsvRow({
      id: 'biz-bakery',
      name: 'Bakery',
      family: 'business',
      cost: '300',
      synergyTypes: 'Food',
    });
    expect(svg).toContain('#e67e22'); // synergyColor('Food') bright accent (TS lowercase-hex convention)
  });

  it('leaves event family faces on their existing family colour', () => {
    const svg = generateCardSvgFromCsvRow({
      id: 'evt-rainy',
      name: 'Rainy Day',
      family: 'event',
      cost: '0',
      trigger: 'Incident',
    });
    expect(svg).toContain('fill="#2B3A67"');
  });
});

describe('cardFaceBackground - palette resolver (MS-0MUZH51PU007POJ4)', () => {
  it('resolves zero, single, bridge and >2 synergy inputs', () => {
    expect(cardFaceBackground([])).toEqual({ fill: '#2f2f2f', split: null });
    expect(cardFaceBackground(undefined)).toEqual({ fill: '#2f2f2f', split: null });
    expect(cardFaceBackground(['Food'])).toEqual({ fill: '#5D4037', split: null });
    expect(cardFaceBackground(['Food', 'Culture'])).toEqual({
      fill: '#5D4037',
      split: { top: '#5D4037', bottom: '#1565C0' },
    });
    const tri = cardFaceBackground(['Food', 'Culture', 'Health']);
    expect(tri.split).toBeNull();
    expect(tri.fill).toBe('#5D4037');
  });
});

describe('replaceCardTitleInSvg - display-name variant faces (CG-0MT24MHGZ0025O20)', () => {
  it('replaces the baked title text with the display name', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" aria-label="Bakery"><text x="70" y="19" fill="#fff">Bakery</text></svg>';
    const variant = replaceCardTitleInSvg(svg, 'Patisserie');
    expect(variant).toContain('>Patisserie</text>');
    expect(variant).not.toContain('>Bakery</text>');
    expect(variant).toContain('aria-label="Patisserie"');
  });

  it('does not touch non-title text nodes (cost badge etc.)', () => {
    const svg = '<svg aria-label="Bakery"><text x="70" y="19">Bakery</text><text x="124" y="60">3</text></svg>';
    const variant = replaceCardTitleInSvg(svg, 'Patisserie');
    expect(variant).toContain('>3</text>');
    expect(variant).toContain('>Patisserie</text>');
  });

  it('escapes special characters in the display name', () => {
    const svg = '<svg aria-label="Bakery"><text x="70" y="19">Bakery</text></svg>';
    const variant = replaceCardTitleInSvg(svg, 'Tom & Jerry\'s Café');
    expect(variant).toContain('>Tom &amp; Jerry\'s Café</text>');
  });

  it('returns the input unchanged when empty', () => {
    expect(replaceCardTitleInSvg('', 'Patisserie')).toBe('');
  });
});
