/**
 * Unit tests for scripts/generate-main-street-card-svgs.mjs — the Node.js
 * CLI that generates static card SVGs from card-data.csv.
 *
 * These tests verify:
 * - Staff cards retain baked `-X/turn` cost text (CG-0MTDMOYOL008IQVO: AC-4)
 * - Business/community-space cards do NOT have baked cost text (AC-1)
 * - Staff card details (hand slots, peek) are rendered correctly
 *
 * @module
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { generateBusinessCardSvg, generateCardSvgFromCsvRow } from '../../src/scenes/MainStreetCardSvgGenerator';
import { CARD_FACE_PALETTE as TS_CARD_FACE_PALETTE } from '../../src/MainStreetCards';
// @ts-ignore: no declaration file for .mjs script — intentional
import {
  generateCardSvg as generateCardSvgMjs,
  regenerateCardSvgs,
  CARD_FACE_PALETTE as MJS_CARD_FACE_PALETTE,
  // @ts-ignore: no declaration file for .mjs script — intentional
} from '../../src/scripts/generate-main-street-card-svgs.mjs';

// ---------------------------------------------------------------------------
// TS/mjs palette + render-path agreement (AC1/AC4/AC5, MS-0MUZH51PU007POJ4)
// ---------------------------------------------------------------------------

/** The unique bridge cards (exactly two synergy types) in card-data.csv. */
const BRIDGE_CARD_IDS = [
  'biz-cafe',
  'biz-food-truck',
  'biz-gallery',
  'biz-spa',
  'biz-florist',
  'biz-juice-bar',
  'biz-yoga-studio',
  'biz-physio',
  'biz-teahouse',
  'cs-public-art',
];

/** Extract the face background markup (single rect or two-band `<g>`) from an SVG. */
function extractFaceMarkup(svg: string): string {
  const split = svg.match(/<g clip-path="url\(#ms-face-clip-[^"]*\)">[\s\S]*?<\/g>/);
  if (split) return split[0];
  const single = svg.match(/<rect x="0" y="0" width="140" height="80" rx="6" ry="6" fill="#[0-9a-fA-F]{6}" \/>/);
  return single ? single[0] : '';
}

/** Read a CSV column for a given row id (split on commas is safe: no commas in
 *  the id / synergyTypes fields). */
function csvFieldForId(id: string, column: string): string {
  const text = readFileSync(resolve('src/card-data.csv'), 'utf8');
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  const col = headers.indexOf(column);
  const idCol = headers.indexOf('id');
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(',');
    if (fields[idCol] === id) return fields[col] ?? '';
  }
  return '';
}

describe('MS-0MUZH51PU007POJ4 — TS and mjs face palettes agree', () => {
  it('the mjs duplicate of CARD_FACE_PALETTE matches the canonical TS palette', () => {
    expect(MJS_CARD_FACE_PALETTE).toEqual(TS_CARD_FACE_PALETTE);
  });
});

describe('MS-0MUZH51PU007POJ4 — mjs generator synergy face colouring', () => {
  it('colours a single-synergy static card face with the palette colour', () => {
    const svg = generateCardSvgMjs({
      id: 'biz-bakery',
      name: 'Bakery',
      family: 'business',
      cost: 300,
      synergies: ['Food'],
      trigger: null,
    });
    expect(svg).toContain('rx="6" ry="6" fill="#5D4037"');
    expect(svg).not.toContain('fill="#2f2f2f"');
  });

  it('splits a bridge static card into top/bottom palette bands', () => {
    const svg = generateCardSvgMjs({
      id: 'biz-cafe',
      name: 'Cafe',
      family: 'business',
      cost: 700,
      synergies: ['Food', 'Culture'],
      trigger: null,
    });
    expect(svg).toContain('ms-face-clip-biz-cafe');
    expect(svg).toContain('<rect x="0" y="0" width="140" height="40" fill="#5D4037" />');
    expect(svg).toContain('<rect x="0" y="40" width="140" height="40" fill="#1565C0" />');
    expect(svg).toContain('Food icon');
    expect(svg).toContain('Culture icon');
  });

  it('keeps the neutral face for zero-synergy business cards', () => {
    const svg = generateCardSvgMjs({
      id: 'biz-none',
      name: 'No Synergy',
      family: 'business',
      cost: 100,
      synergies: [],
      trigger: null,
    });
    expect(svg).toContain('rx="6" ry="6" fill="#2f2f2f"');
  });
});

describe('MS-0MUZH51PU007POJ4 — all three render paths agree on face colouring', () => {
  it('dynamic, CSV-row and static paths emit identical face markup for a bridge card', () => {
    const dynamic = generateBusinessCardSvg({
      family: 'business',
      id: 'biz-bridge',
      name: 'Bridge',
      cost: 700,
      baseIncome: 0,
      synergyTypes: ['Food', 'Culture'],
      maxLevel: 1,
      description: 'x',
      level: 0,
      incomeBonus: 0,
      synergyRangeBonus: 0,
      reputationBonus: 0,
      ongoingCost: 0,
      appliedUpgrades: [],
    });
    const csv = generateCardSvgFromCsvRow({
      id: 'biz-bridge',
      name: 'Bridge',
      family: 'business',
      cost: '700',
      synergyTypes: 'Food|Culture',
    });
    const staticSvg = generateCardSvgMjs({
      id: 'biz-bridge',
      name: 'Bridge',
      family: 'business',
      cost: 700,
      synergies: ['Food', 'Culture'],
      trigger: null,
    });

    const faces = [extractFaceMarkup(dynamic), extractFaceMarkup(csv), extractFaceMarkup(staticSvg)];
    expect(faces[0], 'dynamic face').not.toBe('');
    expect(new Set(faces).size, faces.join('\n---\n')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Shipped static SVGs — synergy face colouring regression guard
// ---------------------------------------------------------------------------

describe('MS-0MUZH51PU007POJ4 — shipped static SVGs reflect the face colouring', () => {
  it('every bridge card ships with a two-tone split and both synergy icons', () => {
    regenerateCardSvgs();

    const svgDir = resolve(
      process.cwd(),
      'public/assets/games/main-street/svg/cards',
    );

    for (const id of BRIDGE_CARD_IDS) {
      const svg = readFileSync(resolve(svgDir, `${id}.svg`), 'utf8');
      expect(svg, id).toContain(`ms-face-clip-${id}`);
      expect(svg, id).toContain('<rect x="0" y="0" width="140" height="40"');
      expect(svg, id).toContain('<rect x="0" y="40" width="140" height="40"');
      const iconCount =
        (svg.match(/class="ms-synergy-icon"/g) || []).length +
        (svg.match(/class="ms-synergy-fallback"/g) || []).length;
      expect(iconCount, `${id} icons`).toBeGreaterThanOrEqual(2);
    }
  });

  it('every single-synergy business card ships with its palette face, never the neutral face', () => {
    regenerateCardSvgs();

    const svgDir = resolve(
      process.cwd(),
      'public/assets/games/main-street/svg/cards',
    );

    for (const id of BRIDGE_CARD_IDS) {
      // sanity: bridge ids are the only two-type business/community-space rows
      expect((csvFieldForId(id, 'synergyTypes').split('|').filter(Boolean)).length, id).toBe(2);
    }

    // Walk the CSV so the guard tracks the data, not a hard-coded list.
    const text = readFileSync(resolve('src/card-data.csv'), 'utf8');
    const lines = text.trim().split('\n');
    const headers = lines[0].split(',');
    const idCol = headers.indexOf('id');
    const synergyCol = headers.indexOf('synergyTypes');
    for (let i = 1; i < lines.length; i++) {
      const fields = lines[i].split(',');
      const id = fields[idCol];
      const types = (fields[synergyCol] || '').split('|').filter(Boolean);
      if (!id || !(id.startsWith('biz-') || id.startsWith('cs-')) || types.length !== 1) continue;
      const svg = readFileSync(resolve(svgDir, `${id}.svg`), 'utf8');
      const expectedColour = TS_CARD_FACE_PALETTE[types[0]];
      expect(svg, id).toContain(`rx="6" ry="6" fill="${expectedColour}"`);
      expect(svg, id).not.toContain('fill="#2f2f2f"');
      expect(svg, id).not.toContain('ms-face-clip-');
    }
  });
});

// ---------------------------------------------------------------------------
// MJS generator — staff card baked cost text (AC-4: fix for previous regression)
// ---------------------------------------------------------------------------

describe('MJS SVG generator — staff card baked cost text', () => {
  it('should include -X/turn text for staff cards (CG-0MTDMOYOL008IQVO)', () => {
    const svg = generateCardSvgMjs({
      id: 'staff-test',
      name: 'Test Staff',
      family: 'staff',
      cost: 3,
      synergies: [],
      trigger: null,
      ongoingCost: 100,
      handSlotsAdded: 1,
      peekOncePerTurn: null,
    });
    expect(svg).toContain('-100/turn');
    expect(svg).toContain('#ff8844'); // orange cost colour
  });

  it('should include hand slots text for staff cards', () => {
    const svg = generateCardSvgMjs({
      id: 'staff-test',
      name: 'Test Staff',
      family: 'staff',
      cost: 3,
      synergies: [],
      trigger: null,
      ongoingCost: 100,
      handSlotsAdded: 2,
      peekOncePerTurn: null,
    });
    expect(svg).toContain('+2 slots');
    expect(svg).toContain('#88bbff'); // blue slots colour
  });

  it('should include peek text for staff cards with peekOncePerTurn', () => {
    const svg = generateCardSvgMjs({
      id: 'staff-test',
      name: 'Test Staff',
      family: 'staff',
      cost: 3,
      synergies: [],
      trigger: null,
      ongoingCost: 100,
      handSlotsAdded: 1,
      peekOncePerTurn: 1,
    });
    expect(svg).toContain('peek 1/turn');
    expect(svg).toContain('#ffcc66'); // gold peek colour
  });

  it('should NOT include ongoing-cost text for business cards', () => {
    const svg = generateCardSvgMjs({
      id: 'biz-test',
      name: 'Test Business',
      family: 'business',
      cost: 6,
      synergies: ['Food'],
      trigger: null,
      ongoingCost: 50,
      handSlotsAdded: 0,
      peekOncePerTurn: null,
    });
    expect(svg).not.toContain('-50/turn');
    expect(svg).not.toContain('#ff8844');
  });

  it('should NOT include ongoing-cost text for community-space cards', () => {
    const svg = generateCardSvgMjs({
      id: 'cs-test',
      name: 'Test Space',
      family: 'community-space',
      cost: 4,
      synergies: ['Culture'],
      trigger: null,
      ongoingCost: 25,
      handSlotsAdded: 0,
      peekOncePerTurn: null,
    });
    expect(svg).not.toContain('-25/turn');
    expect(svg).not.toContain('#ff8844');
  });

  it('should NOT include staff text for event cards', () => {
    const svg = generateCardSvgMjs({
      id: 'evt-test',
      name: 'Test Event',
      family: 'event',
      cost: 5,
      synergies: [],
      trigger: 'Incident',
      ongoingCost: null,
      handSlotsAdded: null,
      peekOncePerTurn: null,
    });
    expect(svg).not.toContain('/turn');
  });
});

// ---------------------------------------------------------------------------
// MJS generator — static SVG files contain staff cost text (regression guard)
// ---------------------------------------------------------------------------

describe('MJS SVG generator — shipped static SVGs retain staff cost text', () => {
  it('should regenerate SVGs and verify staff-*.svg contain -X/turn text (CG-0MTDMOYOL008IQVO)', () => {
    regenerateCardSvgs();

    const svgDir = resolve(
      process.cwd(),
      'public/assets/games/main-street/svg/cards',
    );
    const staffSvgs = readdirSync(svgDir)
      .filter(name => name.startsWith('staff-') && name.endsWith('.svg'));

    expect(staffSvgs.length).toBeGreaterThan(0);

    for (const svgName of staffSvgs) {
      const svgContent = readFileSync(resolve(svgDir, svgName), 'utf8');
      // All staff cards should have ongoing cost text in the static SVGs
      expect(svgContent).toMatch(/-[0-9]+\/turn/);
      expect(svgContent).toContain('#ff8844');
    }
  });

  it('should NOT have -X/turn text in business/community-space static SVGs', () => {
    regenerateCardSvgs();

    const svgDir = resolve(
      process.cwd(),
      'public/assets/games/main-street/svg/cards',
    );

    const bizSvgs = readdirSync(svgDir)
      .filter(name => name.startsWith('biz-') && name.endsWith('.svg'));
    const csSvgs = readdirSync(svgDir)
      .filter(name => name.startsWith('cs-') && name.endsWith('.svg'));

    for (const svgName of [...bizSvgs, ...csSvgs]) {
      const svgContent = readFileSync(resolve(svgDir, svgName), 'utf8');
      expect(svgContent).not.toMatch(/-[0-9.]+\/turn/);
      expect(svgContent).not.toContain('#ff8844');
    }
  });
});

// ---------------------------------------------------------------------------
// CSV-row generator — staff baked cost text (TS fallback path)
// ---------------------------------------------------------------------------

describe('TS CSV-row SVG generator — staff baked cost text', () => {
  it('should include -X/turn text for staff cards from CSV row (CG-0MTDMOYOL008IQVO)', () => {
    const row: Record<string, string> = {
      id: 'staff-test-csv',
      name: 'Test Staff',
      family: 'staff',
      cost: '3',
      ongoingCost: '1',
    };
    const svg = generateCardSvgFromCsvRow(row);
    expect(svg).toContain('-1/turn');
    expect(svg).toContain('#ff8844');
  });

  it('should include hand slots text for staff cards from CSV row', () => {
    const row: Record<string, string> = {
      id: 'staff-test-csv',
      name: 'Test Staff',
      family: 'staff',
      cost: '3',
      ongoingCost: '1',
      handSlotsAdded: '2',
    };
    const svg = generateCardSvgFromCsvRow(row);
    expect(svg).toContain('+2 slots');
  });
});
