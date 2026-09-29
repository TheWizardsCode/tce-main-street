#!/usr/bin/env node

/**
 * Main Street Card Art Map Generator
 *
 * Builds `src/card-art-map.json` from the committed
 * high-resolution card sprites
 * (`src/sprites/<Name>_1024_x_1024.png`) and the CSV
 * (`src/card-data.csv`). The map is consumed by both the runtime TS generator
 * (`MainStreetCardArt.ts`) and the static SVG generator
 * (`scripts/generate-main-street-card-svgs.mjs`).
 *
 * CG-0MTORJ5FS006B0UN (producer manual review): every card's 64×64 art zone
 * shows the card's art from the sprites folder.
 *
 * CG-0MUBVL4H80061B1E (CG-0MUBVL4H80061B1E): the generator now reads
 * `card-data.csv` and applies the following mapping rules so that **every
 * unique card name** resolves to a non-`Fallback` sprite:
 *
 * 1. **Upgrades** — each upgrade's `newDisplayName` is aliased to its
 *    `targetBusiness` sprite (e.g. "Upgrade to Patisserie" → "Bakery").
 * 2. **Events** — each event is aliased to a category sprite keyed by
 *    `(trigger, targetSynergy)` (e.g. "Rainy Day" → `Incident__None`).
 *    The generator expects a sprite named `<Trigger>__<Synergy>` for each
 *    category; missing category sprites are noted in the console output but
 *    the alias is still emitted (the resolver will fall through to `Fallback`
 *    until the sprite arrives).
 * 3. **Staff** — each staff card is aliased to its name (e.g. "Chef") — the
 *    producer must supply `Chef_1024_x_1024.png`.
 * 4. **Business / community-space** — aliased by name; duplicates (Florist,
 *    Community Garden) share the same sprite, which is acceptable per the
 *    work item.
 *
 * CG-0MUCM36EQ008YP4R: the *embedded* bitmap is now 256×256, downscaled from
 * the 1024×1024 source art, instead of a 64×64 thumbnail. The 64×64 art zone
 * is a layout dimension expressed in SVG user units — it is *not* the render
 * resolution. Because Phaser rasterises the card SVG at up to 4× quality
 * scale (`rasteriseSvgToTexture`, `qualityScale = Math.max(4, dpr)`), a 64×64
 * bitmap was stretched to 256×256 device pixels and appeared pixelated. A
 * 256×256 source fills the zone at 1:1 and stays crisp.
 *
 * Why a base64 map? The card SVGs are rasterised by Phaser from a `data:` URI,
 * where external image references do not resolve — so the art must travel
 * inline with the SVG. The map keeps the generated SVGs self-contained.
 *
 * Why WebP rather than PNG? At 256×256 the source art is detailed enough that
 * a 256-colour indexed PNG costs ~5.3 MB of base64 across all 63 sprites,
 * which would more than double the bundled app. Lossy WebP at quality 90
 * costs ~0.5 MB — smaller than the previous 64×64 PNG map (~0.34 MB) despite
 * carrying 16× the pixels — and Chromium (browser + Electron), Firefox and
 * Safari all decode WebP inside SVG `<image>`. The committed 1024×1024 sprites
 * remain the source of truth.
 *
 * Inputs:
 *   src/sprites/<Name>_1024_x_1024.png
 *   src/card-data.csv
 *
 * Outputs:
 *   src/card-art-map.json
 *
 * Usage:
 *   node scripts/generate-main-street-card-art.mjs
 *
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * The source directory that holds the card data, art map and sprites.
 *
 * In the standalone game repo this script lives at `<repo>/src/scripts/`, so
 * `../..` resolves to `<repo>/src`. In the (historical) merged monorepo layout
 * it lived at `<repo>/example-games/main-street/scripts/`, where `../..`
 * resolves to `<repo>/example-games/main-street`. Both layouts keep
 * `card-data.csv`, `card-art-map.json` and `sprites/` together, so anchoring
 * on `../..` makes the generator portable across the split.
 */
const SRC_DIR = path.resolve(__dirname, '..');
const SPRITES_DIR = path.join(SRC_DIR, 'sprites');
const MAP_PATH = path.join(SRC_DIR, 'card-art-map.json');
const CSV_PATH = path.join(SRC_DIR, 'card-data.csv');

/** Source sprite suffix — the committed high-resolution art is the truth. */
const SOURCE_SUFFIX = '_1024_x_1024.png';

/**
 * Side length (in SVG user units) of the square card-art *zone* on a card
 * face. This is a layout dimension and must stay in sync with
 * `GRAPHIC_W`/`GRAPHIC_H` in `MainStreetCardSvgGenerator.ts` and
 * `scripts/generate-main-street-card-svgs.mjs`.
 */
const ART_SIZE = 64;

/**
 * Side length (px) of the embedded art *bitmap*. Independent of the 64×64
 * zone: the bitmap is drawn into the zone and downsampled by the SVG
 * rasteriser. 256 covers the 4× quality scale (`Math.max(4, dpr)`) at 1:1.
 */
const ART_RESOLUTION = 256;

/** Lossy WebP quality for the embedded art (see module docs for the rationale). */
const ART_WEBP_QUALITY = 90;

/**
 * CSV card-name -> sprite base-name overrides for spelling variants that
 * differ between the content CSV and the art files. Everything else falls
 * back to an exact name match (or the Fallback sprite).
 */
export const CARD_ART_ALIASES = {
  'Community Renovation': 'Community Rennovation',
  'Labor Shortage': 'Labour Shortage',
  'Neighborhood Watch': 'Neighbourhood Watch',
  'Physiotherapy': 'Physiotherapist',
  'Graffiti': 'Graffiti Art',
};

/** Sprite used when a card has no dedicated art. */
export const CARD_ART_FALLBACK = 'Fallback';

// ---------------------------------------------------------------------------
// CSV helpers (CG-0MUBVL4H80061B1E)
// ---------------------------------------------------------------------------

/** Minimal CSV parser — reads card-data.csv and returns rows as objects. */
function readCsvRows(csvPath) {
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  const rows = [];
  // Handle quoted fields properly
  for (let i = 1; i < lines.length; i++) {
    const row = {};
    let field = '';
    let inQuotes = false;
    let hIdx = 0;
    for (let j = 0; j < lines[i].length; j++) {
      const ch = lines[i][j];
      if (inQuotes) {
        if (ch === '"' && lines[i][j + 1] === '"') {
          field += '"';
          j++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          field += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          row[headers[hIdx]] = field;
          field = '';
          hIdx++;
        } else {
          field += ch;
        }
      }
    }
    row[headers[hIdx]] = field;
    rows.push(row);
  }
  return rows;
}

/**
 * Build the complete CSV card-name -> sprite base-name mapping from
 * `card-data.csv`, with **no** filtering by which sprites exist.
 *
 * CG-0MUBVL4H80061B1E rules:
 * - Upgrades: `name` → `targetBusiness` (duplicate the target's art).
 * - Events: `name` → `<trigger>__<targetSynergy>` category sprite.
 * - Staff / business / community-space: `name` → `name` (direct).
 * - Pre-existing spelling aliases are preserved.
 *
 * Returning the unfiltered mapping lets the drift guard assert that **every**
 * card is mapped, even while its sprite is still pending from the producer.
 *
 * @param {string} csvPath - Absolute path to `card-data.csv`.
 * @param {Set<string>} [knownSprites] - Sprite base names present on disk. When
 *   supplied, a card that already has dedicated art keeps it: upgrades prefer an
 *   existing `newDisplayName` sprite over the `targetBusiness` fallback, and
 *   events prefer their exact-name sprite over the `<trigger>__<synergy>`
 *   category sprite. This preserves the 35 existing dedicated event sprites
 *   (CG-0MUBVL4H80061B1E: "existing dedicated event art is retained").
 * @returns {Record<string, string>} card name -> intended sprite base name.
 */
export function buildMappingsFromCsv(csvPath, knownSprites) {
  const has = (name) => (knownSprites ? knownSprites.has(name) : false);
  const mappings = {};
  const rows = readCsvRows(csvPath);

  for (const row of rows) {
    const family = row.family;
    const name = row.name;

    if (SPELLING_ALIASES[name]) {
      mappings[name] = SPELLING_ALIASES[name];
      continue;
    }

    if (family === 'upgrade') {
      // CG-0MUBVL4H80061B1E: prefer the upgrade's own display-name sprite
      // (a duplicate of the target's art); fall back to the target's art.
      const displayName = row.newDisplayName;
      const target = row.targetBusiness;
      if (displayName && has(displayName)) {
        mappings[name] = displayName;
      } else if (target) {
        mappings[name] = target;
      }
    } else if (family === 'event') {
      // CG-0MUBVL4H80061B1E: keep an existing dedicated event sprite; only the
      // art-less events fall back to the (trigger, targetSynergy) category.
      if (has(name)) {
        mappings[name] = name;
      } else {
        const trigger = row.trigger || '';
        const synergy = row.targetSynergy || '';
        mappings[name] = `${trigger}__${synergy}`;
      }
    } else {
      // Staff / business / community-space: direct name match.
      mappings[name] = name;
    }
  }

  return mappings;
}

/**
 * Build the `aliases` map written into `card-art-map.json`.
 *
 * The full CSV mapping is filtered to targets whose sprite is present, so the
 * generated map never points at a missing image. When the producer adds a
 * sprite, regeneration picks up the alias automatically.
 *
 * @param {string} csvPath - Absolute path to `card-data.csv`.
 * @param {Set<string>} knownSprites - Sprite base names present on disk.
 * @returns {Record<string, string>} card name -> sprite base name.
 */
export function buildAliasesFromCsv(csvPath, knownSprites) {
  const mappings = buildMappingsFromCsv(csvPath, knownSprites);
  const aliases = {};
  for (const [csvName, spriteName] of Object.entries(mappings)) {
    if (knownSprites.has(spriteName)) {
      aliases[csvName] = spriteName;
    }
  }
  return aliases;
}

/** Pre-existing spelling-variant aliases (preserved across generations). */
const SPELLING_ALIASES = {
  'Community Renovation': 'Community Rennovation',
  'Labor Shortage': 'Labour Shortage',
  'Neighborhood Watch': 'Neighbourhood Watch',
  'Physiotherapy': 'Physiotherapist',
  'Graffiti': 'Graffiti Art',
};

/** Base names of every committed 1024×1024 sprite, sorted for deterministic output. */
export function listSpriteNames() {
  return fs
    .readdirSync(SPRITES_DIR)
    .filter((f) => f.endsWith(SOURCE_SUFFIX))
    .map((f) => f.slice(0, -SOURCE_SUFFIX.length))
    .sort();
}

/**
 * Downscale a committed 1024×1024 sprite to the embedded art resolution and
 * re-encode it as lossy WebP.
 *
 * @param {string} filePath - Absolute path to the source sprite.
 * @returns {Promise<Buffer>} The WebP bytes.
 */
export async function encodeArt(filePath) {
  return sharp(filePath)
    .resize(ART_RESOLUTION, ART_RESOLUTION, { fit: 'cover', kernel: 'lanczos3' })
    .webp({ quality: ART_WEBP_QUALITY })
    .toBuffer();
}

/**
 * Regenerate `card-art-map.json` from the committed 1024×1024 sprites and
 * `card-data.csv`.
 *
 * CG-0MUBVL4H80061B1E: the generator reads the CSV to build aliases for
 * upgrades (target-dup), events (category), and staff/business/community-space
 * (direct). The alias map is merged with any pre-existing spelling aliases
 * defined in {@link SPELLING_ALIASES}.
 *
 * @returns {Promise<{ sprites: number, mapPath: string, totalBytes: number }>}
 */
export async function regenerateCardArt() {
  const names = listSpriteNames();
  const knownSprites = new Set(names);
  const art = {};

  for (const name of names) {
    const artBytes = await encodeArt(path.join(SPRITES_DIR, `${name}${SOURCE_SUFFIX}`));
    art[name] = `data:image/webp;base64,${artBytes.toString('base64')}`;
  }

  // CG-0MUBVL4H80061B1E: build aliases from CSV (upgrades, events, staff, etc.)
  const csvMappings = buildMappingsFromCsv(CSV_PATH, knownSprites);
  const csvAliases = buildAliasesFromCsv(CSV_PATH, knownSprites);

  // Merge: CSV aliases take precedence, then spelling aliases for coverage.
  const mergedAliases = { ...csvAliases };
  // Add spelling aliases even when the sprite doesn't exist yet (they resolve
  // through the target, which may also be missing — the resolver falls through
  // to Fallback).
  for (const [csvName, target] of Object.entries(SPELLING_ALIASES)) {
    if (!(csvName in mergedAliases)) {
      mergedAliases[csvName] = target;
    }
  }

  const map = {
    version: 3,
    artSize: ART_SIZE,
    artResolution: ART_RESOLUTION,
    format: 'webp',
    fallback: CARD_ART_FALLBACK,
    aliases: mergedAliases,
    art,
  };

  fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + '\n');

  const totalBytes = Object.values(art).reduce((n, uri) => n + uri.length, 0);

  // Log coverage summary. "Coverage" counts unique card names whose intended
  // mapping target has committed art; the remainder are pending producer art.
  const allNames = new Set(Object.keys(csvMappings));
  const coveredNames = Object.keys(csvMappings).filter((n) => knownSprites.has(csvMappings[n]));
  const missingTargets = new Set(
    Object.values(csvMappings).filter((target) => !knownSprites.has(target)),
  );
  console.log(
    `Generated art map for ${names.length} sprites at ${ART_RESOLUTION}x${ART_RESOLUTION} ` +
      `(drawn into a ${ART_SIZE}x${ART_SIZE} zone); ` +
      `map: ${path.relative(SRC_DIR, MAP_PATH)} (${Math.round(totalBytes / 1024)} KB of base64)`,
  );
  console.log(
    `Card coverage: ${coveredNames.length}/${allNames.size} unique card names resolve to dedicated art`,
  );
  if (missingTargets.size > 0) {
    console.log(
      `Pending producer art (${missingTargets.size} sprite targets): ${[...missingTargets].sort().join(', ')}`,
    );
  }

  return { sprites: names.length, mapPath: MAP_PATH, totalBytes };
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  regenerateCardArt()
    .then((r) => {
      console.log(
        `Generated art map for ${r.sprites} sprites at ${ART_RESOLUTION}x${ART_RESOLUTION} ` +
          `(drawn into a ${ART_SIZE}x${ART_SIZE} zone); ` +
          `map: ${path.relative(SRC_DIR, r.mapPath)} (${Math.round(r.totalBytes / 1024)} KB of base64)`,
      );
    })
    .catch((err) => {
      console.error('Card art generation failed:', err);
      process.exit(1);
    });
}
