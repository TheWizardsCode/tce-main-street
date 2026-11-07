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
 * 1. **Upgrades** — each upgrade gets its **own** source sprite: a literal
 *    copy of its `targetBusiness` art named
 *    `<newDisplayName>_upgrade_level<requiredLevel>` (e.g. "Upgrade to
 *    Patisserie" → `Patisserie_upgrade_level0_1024_x_1024.png`). Until the
 *    copy exists the upgrade falls back to the target's sprite
 *    ("Upgrade to Patisserie" → "Bakery"). Copies that are still byte-for-byte
 *    identical to another sprite are embedded **once**: the generator records
 *    them in the map's `spriteAliases` table so the shared bitmap is not
 *    duplicated in `card-art-map.json`. Replacing a copy with bespoke art
 *    silently retires its `spriteAliases` entry on the next regeneration.
 * 2. **Events** — each event is aliased to a category sprite keyed by
 *    `(trigger, targetSynergy)` (e.g. "Rainy Day" → `Incident__None`).
 *    The generator expects a sprite named `<Trigger>__<Synergy>` for each
 *    category; missing category sprites are noted in the console output but
 *    the alias is still emitted (the resolver will fall through to `Fallback`
 *    until the sprite arrives).
 * 3. **Staff** — each staff card is aliased to its name (e.g. "Chef") — the
 *    producer must supply `Chef_1024_x_1024.png`.
 * 4. **Business / community-space** — aliased by name. The former duplicate
 *    names were split on 2026-09-29 (`Florist` business → `Flower Shop`,
 *    `Community Garden` event → `Garden Party`), so every unique card name now
 *    has its own art target.
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
 *   packs/<gameId>/<packId>/cards.csv   (production pack fragments)
 *
 * Outputs:
 *   src/card-art-map.json
 *
 * Usage:
 *   node src/scripts/generate-main-street-card-art.mjs
 *   node src/scripts/generate-main-street-card-art.mjs --copy-upgrades [--dry-run]
 *
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
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
  'Graffiti': 'Graffiti Art',
};

/** Sprite used when a card has no dedicated art. */
export const CARD_ART_FALLBACK = 'Fallback';

/**
 * Marker that distinguishes a per-upgrade art copy from a base sprite.
 *
 * Producer decision Q11 (2026-10-27, recorded on CG-0MUBVL4H80061B1E): each of
 * the 39 upgrade cards gets its **own** source sprite — a literal copy of its
 * `targetBusiness` art named `<newDisplayName>_upgrade_level<#>` — so an artist
 * can later replace or differentiate an individual upgrade without touching the
 * business it enhances. `#` is the upgrade's `requiredLevel` from
 * `card-data.csv` (0-based, the only level column the upgrade rows carry).
 */
export const UPGRADE_ART_MARKER = '_upgrade_level';

/** Matches a sprite base name that marks an upgrade art copy. */
const UPGRADE_COPY_RE = /_upgrade_level\d+$/;

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
 * Sprite base name of an upgrade's own (duplicated) art.
 *
 * Q11: `<newDisplayName>_upgrade_level<requiredLevel>`, e.g.
 * `Patisserie_upgrade_level0`. Returns an empty string when the row carries no
 * `newDisplayName` (nothing to name the copy after).
 *
 * @param {Record<string, string>} row - A `card-data.csv` upgrade row.
 * @returns {string} The copy's sprite base name (no `_1024_x_1024.png` suffix).
 */
export function upgradeArtSpriteName(row) {
  const displayName = (row.newDisplayName || '').trim();
  if (!displayName) return '';
  const level = (row.requiredLevel || '').trim() || '0';
  return `${displayName}${UPGRADE_ART_MARKER}${level}`;
}

/**
 * Build the complete CSV card-name -> sprite base-name mapping from
 * `card-data.csv`, with **no** filtering by which sprites exist.
 *
 * CG-0MUBVL4H80061B1E rules:
 * - Upgrades: `name` → its own `<newDisplayName>_upgrade_level<#>` copy when
 *   one exists, else `<newDisplayName>` when that sprite exists, else
 *   `targetBusiness` (the target's art is the copy's source).
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
 *   own-copy sprite, then an existing `newDisplayName` sprite, over the
 *   `targetBusiness` fallback, and events prefer their exact-name sprite over
 *   the `<trigger>__<synergy>` category sprite. This preserves the 35 existing
 *   dedicated event sprites (CG-0MUBVL4H80061B1E: "existing dedicated event art
 *   is retained").
 * @returns {Record<string, string>} card name -> intended sprite base name.
 */
export function buildMappingsFromCsv(csvPath, knownSprites) {
  const has = (name) => (knownSprites ? knownSprites.has(name) : false);
  const mappings = {};
  // Accept a single CSV path (base pool) or several (base + pack fragments);
  // later sources win, which is fine because pack card names are namespaced
  // and unique across the base pool and packs.
  const csvPaths = Array.isArray(csvPath) ? csvPath : [csvPath];

  for (const sourcePath of csvPaths) {
    const rows = readCsvRows(sourcePath);
    for (const row of rows) {
      const family = row.family;
      const name = row.name;

      if (SPELLING_ALIASES[name]) {
        mappings[name] = SPELLING_ALIASES[name];
        continue;
      }

      if (family === 'upgrade') {
        // CG-0MUBVL4H80061B1E / Q11: prefer the upgrade's own duplicated art
        // (`<newDisplayName>_upgrade_level<#>`), then a `newDisplayName`
        // sprite, and only then the target business's art.
        const ownCopy = upgradeArtSpriteName(row);
        const displayName = (row.newDisplayName || '').trim();
        const target = (row.targetBusiness || '').trim();
        if (ownCopy && has(ownCopy)) {
          mappings[name] = ownCopy;
        } else if (displayName && has(displayName)) {
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
  'Graffiti': 'Graffiti Art',
};

/** Base names of every committed 1024×1024 sprite, sorted for deterministic output. */
export function listSpriteNames(spritesDir = SPRITES_DIR) {
  return fs
    .readdirSync(spritesDir)
    .filter((f) => f.endsWith(SOURCE_SUFFIX))
    .map((f) => f.slice(0, -SOURCE_SUFFIX.length))
    .sort();
}

/**
 * Map every sprite whose source bytes duplicate another sprite's onto the
 * canonical sprite that is embedded in `card-art-map.json`.
 *
 * Q11 duplicates each upgrade's `targetBusiness` art into a per-upgrade file.
 * Those copies are byte-for-byte identical until an artist differentiates
 * them, so embedding each one separately would inflate the map by ~0.4 MB of
 * duplicate base64 for no visual change. Instead the generator embeds the
 * **canonical** sprite once and records `{"<copy>": "<canonical>"}` here; both
 * consumers apply the same one-step redirect before the art lookup. Replacing
 * a copy with bespoke art changes its bytes, so the entry disappears on the
 * next regeneration and the card embeds its own bitmap — no hand-editing.
 *
 * The canonical sprite of a duplicate group is chosen deterministically: a
 * base sprite (one whose name does not carry the upgrade-copy marker) wins
 * over an upgrade copy, then the lexicographically first name wins.
 *
 * @param {string} [spritesDir] - Directory holding `<Name>_1024_x_1024.png`.
 * @returns {Record<string, string>} duplicate sprite base name -> canonical.
 */
export function buildDuplicateSpriteAliases(spritesDir = SPRITES_DIR) {
  const groups = new Map();
  for (const name of listSpriteNames(spritesDir)) {
    const bytes = fs.readFileSync(path.join(spritesDir, `${name}${SOURCE_SUFFIX}`));
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    const members = groups.get(digest);
    if (members) members.push(name);
    else groups.set(digest, [name]);
  }

  const aliases = {};
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ordered = [...members].sort((a, b) => {
      const rank = (name) => (UPGRADE_COPY_RE.test(name) ? 1 : 0);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
    const [canonical, ...duplicates] = ordered;
    for (const duplicate of duplicates) aliases[duplicate] = canonical;
  }
  return aliases;
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
 * upgrades (own copy / target-dup), events (category), and
 * staff/business/community-space (direct), and records `spriteAliases` for
 * source sprites that duplicate another sprite's bytes (the Q11 upgrade copies)
 * so a shared bitmap is embedded once.
 *
 * @returns {Promise<{ sprites: number, mapPath: string, totalBytes: number }>}
 */
export async function regenerateCardArt() {
  const names = listSpriteNames();
  const knownSprites = new Set(names);
  // Q11: per-upgrade copies are byte-identical to their target's art, so the
  // map embeds the canonical sprite once and redirects the copy to it.
  const spriteAliases = buildDuplicateSpriteAliases();
  /** The sprite whose bitmap is embedded for `name`. */
  const embeddedKey = (name) => spriteAliases[name] ?? name;
  /** Whether `name` renders dedicated art (directly or via a redirect). */
  const rendersArt = (name) => knownSprites.has(embeddedKey(name));

  // CG-0MUBVL4H80061B1E: build aliases from the base pool CSV only (upgrades,
  // events, staff, etc.).
  // F6 (MS-0MV26K321003MWO0): the base map is base-pool only. Production pack
  // CSVs are no longer read here, so pack art can never be baked into the base
  // map — pack art travels with the pack (`assets/<cardId>.png`, inlined at
  // boot through the core loader) and resolves via the pack-art registry.
  const csvPaths = [CSV_PATH];
  const csvMappings = buildMappingsFromCsv(csvPaths, knownSprites);
  const csvAliases = buildAliasesFromCsv(csvPaths, knownSprites);

  // Embed art only for sprites the base pool resolves to, plus the fallback.
  // Any other committed sprite (e.g. a pack's bespoke source art) is
  // deliberately excluded, so the base map is not a hidden pack dependency.
  const embeddedSpriteNames = [
    ...new Set(
      [
        ...Object.values(csvMappings),
        ...Object.values(csvAliases),
        CARD_ART_FALLBACK,
      ].map(embeddedKey),
    ),
  ].filter((target) => knownSprites.has(target));

  const art = {};
  for (const name of embeddedSpriteNames) {
    const artBytes = await encodeArt(path.join(SPRITES_DIR, `${name}${SOURCE_SUFFIX}`));
    art[name] = `data:image/webp;base64,${artBytes.toString('base64')}`;
  }

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
    version: 4,
    artSize: ART_SIZE,
    artResolution: ART_RESOLUTION,
    format: 'webp',
    fallback: CARD_ART_FALLBACK,
    aliases: mergedAliases,
    spriteAliases,
    art,
  };

  fs.writeFileSync(MAP_PATH, JSON.stringify(map, null, 2) + '\n');

  const totalBytes = Object.values(art).reduce((n, uri) => n + uri.length, 0);

  // Log coverage summary. "Coverage" counts unique card names whose intended
  // mapping target renders art (directly or through a spriteAliases redirect);
  // the remainder are pending producer art.
  const allNames = new Set(Object.keys(csvMappings));
  const coveredNames = Object.keys(csvMappings).filter((n) => rendersArt(csvMappings[n]));
  const missingTargets = new Set(
    Object.values(csvMappings).filter((target) => !rendersArt(target)),
  );
  console.log(
    `Generated art map for ${embeddedSpriteNames.length} sprites at ${ART_RESOLUTION}x${ART_RESOLUTION} ` +
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

  return { sprites: embeddedSpriteNames.length, mapPath: MAP_PATH, totalBytes };
}

/**
 * Plan the per-upgrade art copies (Q11).
 *
 * Every upgrade gets its own source sprite — a literal copy of its
 * `targetBusiness` art named `<newDisplayName>_upgrade_level<requiredLevel>` —
 * so an artist can later differentiate that individual upgrade. An upgrade
 * whose target art is still pending from the producer cannot be copied yet; it
 * keeps mapping to the (art-less) target and is reported as `targetMissing`.
 *
 * The plan is derived from `card-data.csv`, so it is deterministic and is the
 * single source of truth for both {@link createUpgradeArtCopies} and the drift
 * guard in `tests/main-street/card-art.test.ts`.
 *
 * @param {string} [csvPath] - Absolute path to `card-data.csv`.
 * @param {string} [spritesDir] - Directory holding `<Name>_1024_x_1024.png`.
 * @returns {Array<{ cardName: string, sprite: string, target: string,
 *   targetMissing: boolean, exists: boolean }>} One entry per upgrade row.
 */
export function planUpgradeArtCopies(csvPath = CSV_PATH, spritesDir = SPRITES_DIR) {
  const known = new Set(listSpriteNames(spritesDir));
  return readCsvRows(csvPath)
    .filter((row) => row.family === 'upgrade')
    .map((row) => {
      const sprite = upgradeArtSpriteName(row);
      const target = (row.targetBusiness || '').trim();
      return {
        cardName: row.name,
        sprite,
        target,
        targetMissing: !known.has(target),
        exists: Boolean(sprite) && known.has(sprite),
      };
    });
}

/**
 * Create the missing per-upgrade art copies (Q11) from their target's art.
 *
 * A copy is a **byte-for-byte** duplicate of `<targetBusiness>_1024_x_1024.png`
 * so git stores the bytes once and {@link buildDuplicateSpriteAliases} keeps the
 * embedded map free of duplicate base64. Existing files are never overwritten —
 * a copy that an artist has already differentiated is left alone.
 *
 * @param {{ csvPath?: string, spritesDir?: string, dryRun?: boolean }} [options]
 * @returns {{ created: string[], skipped: string[], pending: string[] }} Sprite
 *   names created, copies already present, and upgrades whose target art is
 *   still pending from the producer.
 */
export function createUpgradeArtCopies(
  { csvPath = CSV_PATH, spritesDir = SPRITES_DIR, dryRun = false } = {},
) {
  const created = [];
  const skipped = [];
  const pending = [];
  for (const plan of planUpgradeArtCopies(csvPath, spritesDir)) {
    if (plan.targetMissing) {
      pending.push(`${plan.cardName} (target ${plan.target})`);
      continue;
    }
    if (plan.exists) {
      skipped.push(plan.sprite);
      continue;
    }
    if (!dryRun) {
      fs.copyFileSync(
        path.join(spritesDir, `${plan.target}${SOURCE_SUFFIX}`),
        path.join(spritesDir, `${plan.sprite}${SOURCE_SUFFIX}`),
      );
    }
    created.push(plan.sprite);
  }
  return { created, skipped, pending };
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  const copyUpgrades = process.argv.includes('--copy-upgrades');
  Promise.resolve()
    .then(() => {
      if (!copyUpgrades) return null;
      const dryRun = process.argv.includes('--dry-run');
      const result = createUpgradeArtCopies({ dryRun });
      console.log(
        `Upgrade art copies${dryRun ? ' (dry run)' : ''}: ${result.created.length} ` +
          `${dryRun ? 'to create' : 'created'}, ${result.skipped.length} already present, ` +
          `${result.pending.length} pending producer art`,
      );
      if (result.pending.length > 0) {
        console.log(`  pending: ${result.pending.join(', ')}`);
      }
      return null;
    })
    .then(() => regenerateCardArt())
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
