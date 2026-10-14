#!/usr/bin/env node

/**
 * Deterministic fake pack-art fixture generator.
 *
 * Produces one committed 256×256 PNG per asset declared by the production
 * `main-street-residential-pack`, at:
 *
 *   tests/main-street/helpers/fixtures/pack-art/<cardId>.png
 *
 * These fixtures are *fake* pack assets: they let the pack-art test harness
 * (`../packArt.ts`) exercise transport/registry/degradation paths without the
 * network or the real production art. The filename stem is the card id, which
 * is the Option A mapping (`<cardId>.png`) the pack-art registry consumes.
 *
 * Rendering is deterministic — each fixture is a project-owned vector motif
 * produced from a fixed hash of its card id, rendered by `sharp`; identical
 * inputs always produce byte-identical output, so the committed PNGs can be
 * regenerated and diffed:
 *
 *   node tests/main-street/helpers/fixtures/pack-art/generate-fixtures.mjs
 *
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Pack id whose declared assets name the fixtures. */
export const FIXTURE_PACK_ID = 'main-street-residential-pack';

/** Side length (px) of every fixture. */
export const FIXTURE_SIZE = 256;

/** Fixed palette used to colour the deterministic motifs. */
const PALETTE = [
  '#e74c3c',
  '#f39c12',
  '#f1c40f',
  '#2ecc71',
  '#1abc9c',
  '#3498db',
  '#9b59b6',
  '#e67e22',
];

/** Fixed gradient backgrounds, cycled by declaration order. */
const BACKGROUNDS = [
  ['#1f3a5f', '#2c5f8a'],
  ['#0f3d3e', '#1a6b5f'],
  ['#5b2c06', '#8a5a20'],
  ['#6a1b9a', '#9b59b6'],
  ['#1e5631', '#3d8b4a'],
  ['#17202a', '#2c3e50'],
  ['#0b3d2e', '#12735a'],
  ['#1b2a41', '#34495e'],
  ['#33691e', '#5b8c2a'],
  ['#4a235a', '#7d3c98'],
];

/** Walk up from *start* until the repo root (`packs/manifest.json`) is found. */
export function findRepoRoot(start = HERE) {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'packs', 'manifest.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        'Could not locate repository root (no packs/manifest.json found).',
      );
    }
    dir = parent;
  }
}

/** FNV-1a hash of a string → unsigned 32-bit integer. */
function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Deterministic linear congruential generator seeded by *seed*. */
function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Card ids declared by the production residential pack, in manifest order. */
export function listFixtureCardIds(repoRoot = findRepoRoot()) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'packs', 'manifest.json'), 'utf-8'),
  );
  const entry = manifest.packs?.find((pack) => pack.id === FIXTURE_PACK_ID);
  if (!entry) {
    throw new Error(`Pack "${FIXTURE_PACK_ID}" is not declared in packs/manifest.json.`);
  }
  return (entry.assets ?? []).map((asset) =>
    path.basename(asset, path.extname(asset)),
  );
}

/** Render the deterministic 256×256 SVG motif for one card id. */
export function renderFixtureSvg(cardId, index) {
  const [top, bottom] = BACKGROUNDS[index % BACKGROUNDS.length];
  const random = lcg(hashString(cardId));
  const shapes = [];
  for (let count = 0; count < 8; count += 1) {
    const cx = Math.round(random() * FIXTURE_SIZE);
    const cy = Math.round(random() * FIXTURE_SIZE);
    const radius = Math.round(16 + random() * 46);
    const colour = PALETTE[Math.floor(random() * PALETTE.length)];
    const opacity = (0.4 + random() * 0.4).toFixed(2);
    shapes.push(
      `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${colour}" fill-opacity="${opacity}"/>`,
    );
  }
  shapes.push(
    `<rect x="${Math.round(random() * FIXTURE_SIZE)}" y="${Math.round(random() * FIXTURE_SIZE)}" width="${Math.round(40 + random() * 80)}" height="${Math.round(30 + random() * 60)}" rx="10" fill="#ffffff" fill-opacity="0.35"/>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FIXTURE_SIZE}" height="${FIXTURE_SIZE}" viewBox="0 0 ${FIXTURE_SIZE} ${FIXTURE_SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
  </defs>
  <rect width="${FIXTURE_SIZE}" height="${FIXTURE_SIZE}" fill="url(#bg)"/>
  ${shapes.join('\n  ')}
</svg>`;
}

/**
 * Generate every fixture into *options.outDir* (default: this directory).
 *
 * @param {{ outDir?: string, repoRoot?: string, cardIds?: string[] }} [options]
 * @returns {Promise<{ count: number, cardIds: string[], outDir: string }>}
 */
export async function generatePackArtFixtures(options = {}) {
  const outDir = options.outDir ?? HERE;
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const cardIds = options.cardIds ?? listFixtureCardIds(repoRoot);
  fs.mkdirSync(outDir, { recursive: true });
  for (let index = 0; index < cardIds.length; index += 1) {
    const cardId = cardIds[index];
    const svg = renderFixtureSvg(cardId, index);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    fs.writeFileSync(path.join(outDir, `${cardId}.png`), png);
  }
  return { count: cardIds.length, cardIds, outDir };
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  generatePackArtFixtures()
    .then((result) => {
      console.log(
        `Generated ${result.count} pack-art fixture(s) in ${path.relative(process.cwd(), result.outDir)}`,
      );
    })
    .catch((error) => {
      console.error('Pack-art fixture generation failed:', error);
      process.exit(1);
    });
}
