/**
 * Unit tests for the Main Street card-art resolver and embedding
 * (CG-0MTORJ5FS006B0UN, CG-0MUCM36EQ008YP4R, CG-0MUBVL4H80061B1E).
 *
 * The 64×64 left-art graphic zone on every card face embeds a base64 bitmap
 * `data:` URI from `src/card-art-map.json` (generated
 * by `scripts/generate-main-street-card-art.mjs` from the 1024×1024 sprites in
 * `src/sprites/`). These tests verify the resolver, the
 * spelling-variant aliases, the fallback behaviour, the embedded bitmap
 * resolution/format, that both the runtime and static SVG generators
 * actually embed the art, and that every unique card in `card-data.csv`
 * resolves to a non-`Fallback` sprite (CG-0MUBVL4H80061B1E drift guard).
 *
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  getCardArtDataUri,
  hasDedicatedCardArt,
  resolveCardArtName,
  CARD_ART_FALLBACK,
  CARD_ART_SIZE,
  CARD_ART_RESOLUTION,
  CARD_ART_FORMAT,
  cardArtSpriteCount,
} from '../../src/MainStreetCardArt';
import {
  generateBusinessCardSvg,
  generateCardSvgFromCsvRow,
  generateEventCardSvg,
  generateUpgradeCardSvg,
  generateStaffCardSvg,
} from '../../src/scenes/MainStreetCardSvgGenerator';
import type {
  BusinessCard,
  EventCard,
  StaffCard,
  UpgradeCard,
} from '../../src/MainStreetCards';
// @ts-ignore: no declaration file for .mjs script — intentional
import { generateCardSvg, resolveCardArtDataUri } from '../../src/scripts/generate-main-street-card-svgs.mjs';
// @ts-ignore: no declaration file for .mjs script — intentional
import { buildAliasesFromCsv, buildMappingsFromCsv, listPackCsvPaths } from '../../src/scripts/generate-main-street-card-art.mjs';
import artMapJson from '../../src/card-art-map.json';

const ART_MAP = artMapJson as { version: number; aliases: Record<string, string>; art: Record<string, string>; fallback: string };

const SPRITES_DIR = path.resolve('src/sprites');
const ART_DATA_URI = /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/;
const EMBEDDED_IMAGE = /<image [^>]*href="data:image\/webp;base64,/;

/** Stems of every committed high-resolution source sprite. */
function sourceSpriteStems(): string[] {
  return fs
    .readdirSync(SPRITES_DIR)
    .filter((file) => /^.*_1024_x_1024\.png$/.test(file))
    .map((file) => file.replace(/_1024_x_1024\.png$/, ''));
}

/** Decode an embedded art data URI and report its bitmap dimensions. */
async function embeddedArtMeta(
  cardName: string,
): Promise<{ width?: number; height?: number; format?: string }> {
  const uri = getCardArtDataUri(cardName);
  const base64 = uri.slice(uri.indexOf(',') + 1);
  const meta = await sharp(Buffer.from(base64, 'base64')).metadata();
  return { width: meta.width, height: meta.height, format: meta.format };
}

/** Parse card-data.csv and return the set of unique card names. */
function uniqueCardNames(): Set<string> {
  const text = fs.readFileSync(path.resolve('src/card-data.csv'), 'utf8');
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  const nameIdx = headers.indexOf('name');
  const names = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let cur = '';
    let inQ = false;
    for (let j = 0; j < lines[i].length; j++) {
      const ch = lines[i][j];
      if (inQ) {
        if (ch === '"' && lines[i][j + 1] === '"') {
          cur += '"';
          j++;
        } else if (ch === '"') {
          inQ = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === ',') {
        values.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    values.push(cur);
    if (nameIdx >= 0 && nameIdx < values.length && values[nameIdx]) {
      names.add(values[nameIdx]);
    }
  }
  return names;
}

function makeBusiness(overrides: Partial<BusinessCard> = {}): BusinessCard {
  return {
    family: 'business',
    id: 'biz-bakery',
    name: 'Bakery',
    cost: 300,
    baseIncome: 230,
    synergyTypes: ['Food'],
    maxLevel: 2,
    description: 'Provides warm pastries.',
    level: 0,
    incomeBonus: 0,
    synergyRangeBonus: 0,
    reputationBonus: 0,
    reputationPerTurn: 5,
    ongoingCost: 0,
    appliedUpgrades: [],
    ...overrides,
  };
}

describe('MainStreetCardArt — constants and map', () => {
  it('keeps a 64×64 art zone and a separate 256×256 embedded bitmap', () => {
    expect(CARD_ART_SIZE).toBe(64);
    expect(CARD_ART_RESOLUTION).toBe(256);
    expect(CARD_ART_FORMAT).toBe('webp');
  });

  it('embeds self-contained WebP data URIs (SVG faces are rasterised from a data: URI)', () => {
    expect(getCardArtDataUri('Bakery')).toMatch(ART_DATA_URI);
    expect(getCardArtDataUri('Local Festival')).toMatch(ART_DATA_URI);
  });

  it('decodes every embedded sprite to 256×256 WebP (regression guard against 64×64 art)', async () => {
    const stems = sourceSpriteStems();
    expect(stems.length).toBeGreaterThan(0);

    for (const stem of stems) {
      const meta = await embeddedArtMeta(stem);
      expect(meta.format, `${stem} should be WebP`).toBe('webp');
      expect(meta.width, `${stem} width`).toBe(CARD_ART_RESOLUTION);
      expect(meta.height, `${stem} height`).toBe(CARD_ART_RESOLUTION);
    }
  });
});

describe('MainStreetCardArt — name resolution', () => {
  it('resolves the exact card name to its sprite', () => {
    expect(resolveCardArtName('Bakery')).toBe('Bakery');
    expect(hasDedicatedCardArt('Bakery')).toBe(true);
  });

  it('falls back to the generic Fallback sprite for unknown cards', () => {
    expect(resolveCardArtName('This Card Does Not Exist')).toBe(CARD_ART_FALLBACK);
    expect(hasDedicatedCardArt('This Card Does Not Exist')).toBe(false);
    expect(getCardArtDataUri('This Card Does Not Exist')).toBe(
      getCardArtDataUri(CARD_ART_FALLBACK),
    );
  });

  it('resolves the spelling-variant aliases used by card-data.csv', () => {
    // CSV names differ from the sprite filenames (typo / US-vs-UK spelling).
    expect(resolveCardArtName('Community Renovation')).toBe('Community Rennovation');
    expect(resolveCardArtName('Labor Shortage')).toBe('Labour Shortage');
    expect(resolveCardArtName('Neighborhood Watch')).toBe('Neighbourhood Watch');
    // Physiotherapy alias removed — Physiotherapist now resolves via exact CSV→sprite match.
    expect(resolveCardArtName('Physiotherapist')).toBe('Physiotherapist');
    expect(hasDedicatedCardArt('Community Renovation')).toBe(true);
  });
});

describe('MainStreetCardArt — sprite coverage', () => {
  it('has an entry for every 1024×1024 source sprite on disk (drift guard)', () => {
    const stems = sourceSpriteStems();

    expect(stems.length).toBeGreaterThan(0);
    for (const stem of stems) {
      expect(
        hasDedicatedCardArt(stem),
        `card-art-map.json is missing an entry for sprite "${stem}"`,
      ).toBe(true);
    }
  });

  it('reports the number of generated sprites', () => {
    expect(cardArtSpriteCount()).toBe(sourceSpriteStems().length);
  });
});

describe('CG-0MUBVL4H80061B1E — CSV drift guard', () => {
  const CSV_PATH = path.resolve('src/card-data.csv');
  const KNOWN_SPRITES = new Set(sourceSpriteStems());
  const MAPPINGS = buildMappingsFromCsv(CSV_PATH, KNOWN_SPRITES) as Record<string, string>;

  /**
   * Sprite targets that are still pending from the producer (MS-0MTSAWSME004BH6S
   * "Add images for all cards"). This set may only shrink as art lands: a new
   * card that maps to an art-less target outside this set fails the guard, and
   * the art-less card count may never grow. Emptying this set is the final step
   * of CG-0MUBVL4H80061B1E (AC 1-5).
   *
   * Producer-owned art production (MS-0MTISBYLS009936W Q2): when a card lands
   * before its 1024×1024 sprite, its mapping target is recorded here as the
   * producer-approved pending-art entry so the drift guard still passes. Recent
   * additions: `Charity Shop` (MS-0MUAYBAHW007RMSL) and `Investor`
   * (MS-0MUOSUM7200624OB).
   */
  const PENDING_ART_TARGETS = new Set<string>([
    'Accountant',
    'Apprentice',
    'Assistant',
    'Baker',
    'Barista',
    'Bookkeeper',
    'Cafe',
    'Charity Shop',
    'Chef',
    'Community Shelter',
    'Customer Service Rep',
    'Delivery Driver',
    'Director',
    'Event Planner',
    'Executive',
    'Financial Advisor',
    'Florist',
    'General Manager',
    'Health & Safety Inspector',
    'Health Kiosk',
    'IT Specialist',
    'Incident__',
    'Incident__Culture',
    'Incident__Entertainment',
    'Incident__Food',
    'Incident__Health',
    'Incident__Service',
    'Investment__',
    'Investment__Commerce',
    'Investment__Entertainment',
    'Investment__Food',
    'Investment__Health',
    'Investment__Service',
    'Investor',
    'Laundromat',
    'Library',
    'Lookout',
    'Maintenance Worker',
    'Manager',
    'Marketing Consultant',
    'Mechanic',
    'PR Officer',
    'Park',
    'Playground',
    'Public Art',
    'Security Guard',
    'Socialite',
    'Town Fountain',
  ]);

  /** Baseline of art-less cards: may only shrink as the producer's art lands.
   *  80 after the 2026-10-08 Investor staff addition (MS-0MTISBYLS009936W): the
   *  new staff card ships without dedicated art and uses the generic fallback
   *  until the producer supplies a 1024×1024 sprite (MS-0MUOSUM7200624OB).
   *  Was 79 after the 2026-09-29 Charity Shop addition (MS-0MUAYBAHW007RMSL). */
  const BASELINE_UNRESOLVED_CARDS = 80;

  it('maps every unique card name in card-data.csv', () => {
    const names = uniqueCardNames();
    expect(names.size).toBeGreaterThan(0);

    const unmapped = [...names].filter((name) => !MAPPINGS[name]);
    expect(unmapped, `unmapped card(s): ${unmapped.join(', ')}`).toEqual([]);
  });

  it('applies the documented per-family mapping rules', () => {
    // Upgrade -> its targetBusiness art (duplicated under newDisplayName).
    expect(MAPPINGS['Upgrade to Patisserie']).toBe('Bakery');
    // Art-less event -> (trigger, targetSynergy) category sprite.
    expect(MAPPINGS['Rainy Day']).toBe('Incident__Food');
    // Existing dedicated event art is retained (not category-overridden).
    expect(MAPPINGS['Tax Audit']).toBe('Tax Audit');
    // Pre-existing spelling aliases are preserved.
    expect(MAPPINGS['Community Renovation']).toBe('Community Rennovation');
    // Staff / business / community-space map directly.
    expect(MAPPINGS['Chef']).toBe('Chef');
  });

  it('resolves every card to dedicated art or a documented pending-art target', () => {
    const unresolved = Object.entries(MAPPINGS)
      .filter(([name, target]) => !hasDedicatedCardArt(name) && !PENDING_ART_TARGETS.has(target))
      .map(([name, target]) => `${name} -> ${target}`);
    expect(
      unresolved,
      `${unresolved.length} card(s) map to an undocumented art-less target: ${unresolved.join(', ')}`,
    ).toEqual([]);
  });

  it('does not grow the art-less card count beyond the documented baseline', () => {
    const unresolvedCount = Object.keys(MAPPINGS).filter(
      (name) => !hasDedicatedCardArt(name),
    ).length;
    expect(unresolvedCount).toBeLessThanOrEqual(BASELINE_UNRESOLVED_CARDS);
  });

  it('committed card-art-map.json aliases match a fresh generator run (reproducibility)', () => {
    // MS-0MV0M5BHH0020WFY: the generator reads the base pool plus the
    // production pack fragments, so the fresh run must use the same inputs.
    const csvPaths = [CSV_PATH, ...listPackCsvPaths()];
    const expected = buildAliasesFromCsv(csvPaths, KNOWN_SPRITES) as Record<string, string>;
    expect(ART_MAP.aliases).toEqual(expected);
  });

  it('runtime and static consumers resolve every card to identical art (AC7)', () => {
    for (const name of uniqueCardNames()) {
      // Both consumers read the same card-art-map.json and apply the same
      // alias lookup, so their resolved data URI must match exactly.
      expect(
        resolveCardArtDataUri(name),
        `static generator diverges from the runtime resolver for "${name}"`,
      ).toBe(getCardArtDataUri(name));
    }
  });

  it('card-art-map.json version is 3 (CG-0MUBVL4H80061B1E CSV-driven)', () => {
    expect(ART_MAP.version).toBe(3);
  });
});


describe('Runtime SVG generator embeds the 256×256 card art', () => {
  it('business card SVG embeds the sprite image + rounded clip-path', () => {
    const svg = generateBusinessCardSvg(makeBusiness());
    expect(svg).toMatch(EMBEDDED_IMAGE);
    expect(svg).toContain('clip-path="url(#ms-art-clip-biz-bakery)"');
    expect(svg).toContain('<clipPath id="ms-art-clip-biz-bakery">');
  });

  it('event, upgrade and staff card SVGs embed the sprite image', () => {
    const event: EventCard = {
      family: 'event',
      id: 'evt-local-festival',
      name: 'Local Festival',
      trigger: 'Investment',
      cost: 250,
      effect: '+200 Rep',
      target: 'All',
      coinDelta: 0,
      reputationDelta: 200,
    };
    const upgrade: UpgradeCard = {
      family: 'upgrade',
      id: 'upg-patisserie',
      name: 'Upgrade to Patisserie',
      targetBusiness: 'Bakery',
      cost: 400,
      incomeBonus: 0,
      synergyRangeBonus: 0,
      description: 'Upgrade a bakery.',
    };
    const staff: StaffCard = {
      family: 'staff',
      id: 'stf-assistant',
      name: 'Assistant',
      cost: 350,
      ongoingCost: 50,
      handSlotsAdded: 1,
      description: 'A helpful assistant.',
    };

    for (const svg of [
      generateEventCardSvg(event),
      generateUpgradeCardSvg(upgrade),
      generateStaffCardSvg(staff),
    ]) {
      expect(svg).toMatch(EMBEDDED_IMAGE);
      expect(svg).toContain('<clipPath id="ms-art-clip-');
    }
  });

  it('falls back to the Fallback sprite (still an embedded image) for cards with no dedicated art', () => {
    const svg = generateBusinessCardSvg(
      makeBusiness({ id: 'biz-unknown', name: 'Nonexistent Card' }),
    );
    expect(svg).toMatch(EMBEDDED_IMAGE);
    expect(svg).toContain(getCardArtDataUri(CARD_ART_FALLBACK));
  });

  it('CSV-row fallback generator embeds the sprite image + clip-path', () => {
    const svg = generateCardSvgFromCsvRow({
      id: 'biz-bakery',
      name: 'Bakery',
      family: 'business',
      cost: '300',
    });
    expect(svg).toMatch(EMBEDDED_IMAGE);
    expect(svg).toContain('<clipPath id="ms-art-clip-biz-bakery">');
  });
});

describe('Static SVG generator embeds the 256×256 card art', () => {
  it('embeds the sprite image + clip-path for a known card', () => {
    const svg = generateCardSvg({
      id: 'biz-bakery',
      name: 'Bakery',
      family: 'business',
      synergies: ['Food'],
      cost: 300,
      trigger: null,
    });
    expect(svg).toMatch(EMBEDDED_IMAGE);
    expect(svg).toContain('<clipPath id="ms-art-clip-biz-bakery">');
  });

  it('uses the Fallback sprite when a card has no dedicated art', () => {
    const svg = generateCardSvg({
      id: 'biz-unknown',
      name: 'Nonexistent Card',
      family: 'business',
      synergies: [],
      cost: 100,
      trigger: null,
    });
    expect(svg).toContain(getCardArtDataUri(CARD_ART_FALLBACK));
  });
});
