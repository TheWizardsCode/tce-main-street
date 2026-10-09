#!/usr/bin/env node

/**
 * Main Street Residential Pack — deterministic source-sprite generator.
 *
 * Produces the bespoke 1024×1024 card-face source sprites for the production
 * `main-street-residential-pack` under `src/sprites/`:
 *
 *   src/sprites/<Sprite>_1024_x_1024.png
 *
 * Each sprite is a hand-authored, project-owned (CC0) vector motif rendered
 * deterministically to PNG via `sharp` — no randomness, no external fonts, no
 * network access. Identical inputs always produce byte-identical output, so
 * the committed PNGs can be regenerated and diffed.
 *
 * The sprite base name is the name the art-map generator resolves the card to:
 *   - business / staff / community-space / event cards → the card name;
 *   - upgrade cards → the upgrade's `newDisplayName` (the mapping's preferred
 *     target), so each upgrade keeps its own bespoke art.
 *
 * Run after `packs/**​/cards.csv` changes, then regenerate the art map:
 *
 *   node src/scripts/generate-residential-pack-art.mjs
 *   node src/scripts/generate-main-street-card-art.mjs
 *
 * @see src/scripts/generate-main-street-card-art.mjs — builds card-art-map.json.
 * @see packs/main-street/main-street-residential-pack/cards.csv
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '..');
const SPRITES_DIR = path.join(SRC_DIR, 'sprites');

/** Side length (px) of a generated source sprite. */
export const SPRITE_SIZE = 1024;

/** Source sprite suffix — must match the art-map generator. */
export const SOURCE_SUFFIX = '_1024_x_1024.png';

/**
 * The pack's bespoke card art. One entry per card; `sprite` is the committed
 * file stem and `motif` returns the deterministic SVG body drawn over the
 * background. All colours are fixed literals so output is reproducible.
 */
export const RESIDENTIAL_PACK_ART = [
  {
    sprite: 'Neighbourhood Property Group',
    background: ['#1f3a5f', '#2c5f8a'],
    motif: `
      <g>
        <rect x="150" y="470" width="250" height="330" rx="12" fill="#f2c94c"/>
        <polygon points="130,470 275,360 420,470" fill="#c0392b"/>
        <rect x="200" y="540" width="70" height="90" fill="#7f8c8d"/>
        <rect x="300" y="540" width="60" height="60" fill="#7f8c8d"/>
        <rect x="560" y="420" width="300" height="380" rx="12" fill="#e8e2d0"/>
        <polygon points="540,420 710,300 880,420" fill="#b03a2e"/>
        <rect x="620" y="500" width="70" height="100" fill="#34495e"/>
        <rect x="730" y="500" width="70" height="100" fill="#34495e"/>
        <circle cx="512" cy="820" r="70" fill="#f1c40f"/>
        <rect x="505" y="760" width="14" height="120" fill="#7f6000"/>
        <circle cx="530" cy="790" r="20" fill="none" stroke="#7f6000" stroke-width="12"/>
      </g>`,
  },
  {
    sprite: 'Residential Solar Co-op',
    background: ['#0f3d3e', '#1a6b5f'],
    motif: `
      <g>
        <circle cx="700" cy="300" r="130" fill="#f9d423"/>
        <g stroke="#f9d423" stroke-width="18" stroke-linecap="round">
          <line x1="700" y1="120" x2="700" y2="60"/>
          <line x1="700" y1="540" x2="700" y2="480"/>
          <line x1="520" y1="300" x2="460" y2="300"/>
          <line x1="940" y1="300" x2="880" y2="300"/>
        </g>
        <rect x="180" y="520" width="440" height="300" rx="16" fill="#2c3e50"/>
        <g fill="#5dade2" stroke="#1b4f72" stroke-width="8">
          <rect x="220" y="560" width="170" height="110"/>
          <rect x="410" y="560" width="170" height="110"/>
          <rect x="220" y="690" width="170" height="110"/>
          <rect x="410" y="690" width="170" height="110"/>
        </g>
        <rect x="650" y="600" width="220" height="220" rx="10" fill="#e8e2d0"/>
        <polygon points="630,600 760,520 890,600" fill="#c0392b"/>
      </g>`,
  },
  {
    sprite: 'Community Home Repair',
    background: ['#5b2c06', '#8a5a20'],
    motif: `
      <g>
        <rect x="180" y="560" width="400" height="260" rx="24" fill="#c0392b"/>
        <rect x="180" y="560" width="400" height="70" rx="24" fill="#7b241c"/>
        <rect x="280" y="500" width="200" height="70" rx="16" fill="#7b241c"/>
        <rect x="330" y="430" width="100" height="80" rx="12" fill="#7b241c"/>
        <g fill="#f0f0f0">
          <rect x="250" y="680" width="260" height="18" rx="9"/>
          <rect x="250" y="730" width="260" height="18" rx="9"/>
        </g>
        <g transform="translate(660 300) rotate(35)">
          <rect x="0" y="0" width="60" height="380" rx="20" fill="#bdc3c7"/>
          <circle cx="30" cy="30" r="90" fill="none" stroke="#bdc3c7" stroke-width="55"/>
          <rect x="20" y="0" width="20" height="380" fill="#7f8c8d"/>
        </g>
      </g>`,
  },
  {
    sprite: 'Neighbourhood Block Party',
    background: ['#6a1b9a', '#9b59b6'],
    motif: `
      <g>
        <rect x="120" y="620" width="240" height="240" fill="#f2c94c"/>
        <polygon points="100,620 240,520 380,620" fill="#c0392b"/>
        <rect x="664" y="620" width="240" height="240" fill="#e8e2d0"/>
        <polygon points="644,620 784,520 924,620" fill="#b03a2e"/>
        <path d="M120 300 Q260 420 400 300 Q540 420 680 300 Q820 420 920 300" fill="none" stroke="#f1c40f" stroke-width="14"/>
        <g>
          <polygon points="180,300 240,300 210,370" fill="#e74c3c"/>
          <polygon points="320,360 380,360 350,430" fill="#27ae60"/>
          <polygon points="460,300 520,300 490,370" fill="#3498db"/>
          <polygon points="600,360 660,360 630,430" fill="#e67e22"/>
          <polygon points="740,300 800,300 770,370" fill="#e74c3c"/>
        </g>
        <g fill="#2c3e50">
          <circle cx="300" cy="760" r="40"/>
          <rect x="275" y="800" width="50" height="90" rx="20"/>
          <circle cx="420" cy="770" r="36"/>
          <rect x="398" y="806" width="44" height="80" rx="18"/>
          <circle cx="540" cy="760" r="40"/>
          <rect x="515" y="800" width="50" height="90" rx="20"/>
        </g>
      </g>`,
  },
  {
    sprite: 'Community Farmers Market',
    background: ['#1e5631', '#3d8b4a'],
    motif: `
      <g>
        <rect x="160" y="520" width="704" height="90" rx="14" fill="#c0392b"/>
        <rect x="160" y="610" width="704" height="40" fill="#7b241c"/>
        <g stroke="#7b241c" stroke-width="22" stroke-linecap="round">
          <line x1="200" y1="650" x2="200" y2="880"/>
          <line x1="824" y1="650" x2="824" y2="880"/>
        </g>
        <polygon points="140,520 880,520 800,380 220,380" fill="#e8e2d0"/>
        <g stroke="#c0392b" stroke-width="20">
          <line x1="260" y1="380" x2="260" y2="520"/>
          <line x1="420" y1="380" x2="420" y2="520"/>
          <line x1="580" y1="380" x2="580" y2="520"/>
          <line x1="740" y1="380" x2="740" y2="520"/>
        </g>
        <g>
          <circle cx="300" cy="480" r="34" fill="#e74c3c"/>
          <circle cx="390" cy="490" r="30" fill="#f39c12"/>
          <circle cx="470" cy="478" r="34" fill="#27ae60"/>
          <circle cx="560" cy="492" r="30" fill="#8e44ad"/>
          <circle cx="650" cy="480" r="34" fill="#e67e22"/>
          <ellipse cx="730" cy="488" rx="46" ry="26" fill="#f1c40f"/>
        </g>
      </g>`,
  },
  {
    sprite: 'Neighbourhood Watch Expansion',
    background: ['#17202a', '#2c3e50'],
    motif: `
      <g>
        <path d="M512 220 L760 320 L760 560 Q760 760 512 860 Q264 760 264 560 L264 320 Z" fill="#1b4f72" stroke="#5dade2" stroke-width="18"/>
        <path d="M512 300 L690 372 L690 552 Q690 700 512 776 Q334 700 334 552 L334 372 Z" fill="#2980b9"/>
        <g fill="#f1c40f">
          <circle cx="512" cy="470" r="46"/>
          <rect x="492" y="510" width="40" height="130" rx="18"/>
        </g>
        <g stroke="#f1c40f" stroke-width="16" stroke-linecap="round">
          <line x1="512" y1="470" x2="512" y2="380"/>
        </g>
        <g fill="#f9d423">
          <circle cx="200" cy="760" r="34"/>
          <rect x="180" y="700" width="40" height="90" rx="14" fill="#7f8c8d"/>
        </g>
      </g>`,
  },
  {
    sprite: 'Energy-Efficient Upgrade',
    background: ['#0b3d2e', '#12735a'],
    motif: `
      <g>
        <rect x="200" y="520" width="420" height="320" rx="14" fill="#e8e2d0"/>
        <polygon points="170,520 410,340 650,520" fill="#c0392b"/>
        <g fill="#5dade2" stroke="#1b4f72" stroke-width="8">
          <rect x="240" y="560" width="150" height="100"/>
          <rect x="420" y="560" width="150" height="100"/>
        </g>
        <rect x="300" y="720" width="90" height="120" fill="#34495e"/>
        <g transform="translate(690 300)">
          <circle cx="90" cy="90" r="90" fill="#f1c40f"/>
          <polygon points="70,20 130,20 90,90 140,90 60,190 80,105 30,105" fill="#e67e22"/>
        </g>
        <path d="M700 700 L700 840 M640 780 L700 840 L760 780" fill="none" stroke="#f1c40f" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
      </g>`,
  },
  {
    sprite: 'Smart Home',
    background: ['#1b2a41', '#34495e'],
    motif: `
      <g>
        <rect x="200" y="240" width="624" height="544" rx="40" fill="#0f1c2e" stroke="#5dade2" stroke-width="16"/>
        <rect x="250" y="300" width="524" height="424" rx="24" fill="#16324f"/>
        <g fill="#5dade2">
          <circle cx="330" cy="390" r="40"/>
          <circle cx="512" cy="390" r="40"/>
          <circle cx="694" cy="390" r="40"/>
        </g>
        <g fill="#f1c40f">
          <circle cx="330" cy="390" r="16"/>
          <circle cx="512" cy="390" r="16"/>
        </g>
        <g fill="#2ecc71">
          <rect x="290" y="500" width="444" height="26" rx="13"/>
          <rect x="290" y="560" width="300" height="26" rx="13"/>
        </g>
        <g fill="#e74c3c">
          <rect x="290" y="620" width="200" height="26" rx="13"/>
        </g>
        <circle cx="694" cy="620" r="34" fill="none" stroke="#e74c3c" stroke-width="14"/>
      </g>`,
  },
  {
    sprite: 'Community Gardener',
    background: ['#33691e', '#5b8c2a'],
    motif: `
      <g>
        <ellipse cx="512" cy="880" rx="360" ry="70" fill="#4e342e"/>
        <g stroke="#2e7d32" stroke-width="22" stroke-linecap="round">
          <path d="M512 820 L512 560"/>
          <path d="M512 660 Q430 600 380 620"/>
          <path d="M512 620 Q594 560 644 580"/>
        </g>
        <g fill="#66bb6a">
          <ellipse cx="360" cy="610" rx="80" ry="46" transform="rotate(-25 360 610)"/>
          <ellipse cx="664" cy="570" rx="80" ry="46" transform="rotate(25 664 570)"/>
          <ellipse cx="512" cy="500" rx="70" ry="90"/>
        </g>
        <g transform="translate(150 300)">
          <rect x="0" y="120" width="240" height="200" rx="40" fill="#1e88e5"/>
          <rect x="180" y="40" width="90" height="160" rx="30" fill="#1565c0"/>
          <path d="M270 90 L430 20 L430 100 L270 150 Z" fill="#1565c0"/>
          <g stroke="#90caf9" stroke-width="14" stroke-linecap="round">
            <line x1="430" y1="30" x2="470" y2="0"/>
            <line x1="440" y1="60" x2="490" y2="50"/>
            <line x1="430" y1="90" x2="470" y2="110"/>
          </g>
        </g>
      </g>`,
  },
  {
    sprite: 'Residential Community Centre',
    background: ['#4a235a', '#7d3c98'],
    motif: `
      <g>
        <rect x="180" y="480" width="664" height="360" rx="18" fill="#c0392b"/>
        <polygon points="150,480 512,300 874,480" fill="#7b241c"/>
        <rect x="420" y="620" width="184" height="220" rx="12" fill="#5d4037"/>
        <g fill="#f2c94c">
          <rect x="240" y="560" width="120" height="120" rx="12"/>
          <rect x="664" y="560" width="120" height="120" rx="12"/>
          <rect x="240" y="720" width="120" height="100" rx="12"/>
          <rect x="664" y="720" width="120" height="100" rx="12"/>
        </g>
        <rect x="320" y="360" width="384" height="90" rx="18" fill="#f1c40f"/>
        <g fill="#7b241c">
          <rect x="360" y="385" width="40" height="40"/>
          <rect x="440" y="385" width="40" height="40"/>
          <rect x="520" y="385" width="40" height="40"/>
          <rect x="600" y="385" width="40" height="40"/>
        </g>
        <g fill="#f5f5f5">
          <circle cx="300" cy="880" r="30"/>
          <circle cx="420" cy="880" r="30"/>
          <circle cx="604" cy="880" r="30"/>
          <circle cx="724" cy="880" r="30"/>
        </g>
      </g>`,
  },
];

/** Render the deterministic 1024×1024 SVG for one card definition. */
export function renderCardArtSvg(card) {
  const [top, bottom] = card.background;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SPRITE_SIZE}" height="${SPRITE_SIZE}" viewBox="0 0 ${SPRITE_SIZE} ${SPRITE_SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${top}"/>
      <stop offset="1" stop-color="${bottom}"/>
    </linearGradient>
  </defs>
  <rect width="${SPRITE_SIZE}" height="${SPRITE_SIZE}" fill="url(#bg)"/>
  <rect x="40" y="40" width="944" height="944" rx="60" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="10"/>
  ${card.motif.trim()}
</svg>`;
}

/**
 * Generate every residential pack source sprite into `src/sprites/`.
 *
 * Deterministic: the SVG is fixed per card and `sharp` renders identical
 * inputs to identical bytes, so re-running is a no-op on an unchanged tree.
 *
 * @param {{ spritesDir?: string }} [options] - Output directory override (tests).
 * @returns {Promise<{ count: number, sprites: string[], spritesDir: string }>}
 */
export async function generateResidentialPackArt(options = {}) {
  const spritesDir = options.spritesDir || SPRITES_DIR;
  fs.mkdirSync(spritesDir, { recursive: true });
  const sprites = [];
  for (const card of RESIDENTIAL_PACK_ART) {
    const svg = renderCardArtSvg(card);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const filePath = path.join(spritesDir, `${card.sprite}${SOURCE_SUFFIX}`);
    fs.writeFileSync(filePath, png);
    sprites.push(card.sprite);
  }
  return { count: sprites.length, sprites, spritesDir };
}

const isMain = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isMain) {
  generateResidentialPackArt()
    .then((r) => {
      console.log(
        `Generated ${r.count} residential pack source sprite(s) in ${path.relative(process.cwd(), r.spritesDir)}`,
      );
    })
    .catch((err) => {
      console.error('Residential pack art generation failed:', err);
      process.exit(1);
    });
}
