/**
 * README genre-description drift guard (MS-0MV87XZR00010HIV).
 *
 * The README's opening description is the first thing a prospective player or
 * contributor reads, so it must state the game's true genre. Main Street is an
 * **economic city builder** in which the player develops the **commercial hub
 * of a city** — not a shop-management / small-business game (see
 * `docs/game/core-rules-and-mechanics.md` §1, town planner revitalising
 * a street grid).
 *
 * This guard fails when the stale "small-business engine-builder" framing
 * creeps back into the opener, when the corrected genre framing is dropped, or
 * when the single-game-distribution framing of the repository is lost.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const README_PATH = path.join(PROJECT_ROOT, 'README.md');

function read(file?: string): string {
  return fs.readFileSync(file ?? README_PATH, 'utf-8');
}

/**
 * Extracts the README's opening description paragraph — the block that begins
 * with "Main Street is".
 */
function openingDescription(readme: string): string {
  const opener = readme.split(/\n{2,}/).find((block) => block.startsWith('Main Street is'));
  return opener ?? '';
}

/** Stale genre framing that must not describe the game. */
const STALE_FRAMING = [
  'small-business',
  'small business',
  'engine-builder',
  'engine builder',
  'shop management',
  'shop-management',
];

function staleFramingIn(text: string): string[] {
  const lower = text.toLowerCase();
  return STALE_FRAMING.filter((phrase) => lower.includes(phrase));
}

describe('AC1/AC2 — the README opener states the correct genre', () => {
  it('extracts a non-empty opening description (guards the parser)', () => {
    expect(openingDescription(read()).length).toBeGreaterThan(0);
  });

  it('presents Main Street as an economic city builder developing a commercial hub', () => {
    const opener = openingDescription(read()).toLowerCase();
    expect(opener).toContain('economic city builder');
    expect(opener).toContain('commercial hub');
  });

  it('does not frame Main Street as a shop-management / small-business game', () => {
    expect(staleFramingIn(openingDescription(read()))).toEqual([]);
    // The stale framing is confined to no part of the README at all.
    expect(staleFramingIn(read())).toEqual([]);
  });
});

describe('AC3 — the single-game-distribution framing is retained', () => {
  it('keeps the Tableau Card Engine single-game distribution and the core-owned Gym', () => {
    const opener = openingDescription(read());
    expect(opener).toContain('Tableau Card Engine');
    expect(opener).toContain('single-game distribution');
    expect(opener).toContain('Main Street');
    expect(opener).toContain('Gym');
  });
});

describe('AC4 — the guard detects stale framing (drift protection)', () => {
  it('flags a README rewound to the old small-business wording', () => {
    const mutated = read().replace(
      /an economic city builder played card by card, in which the player develops the\s+commercial hub of a city/,
      'a small-business engine-builder played card by card on a shared high street',
    );
    expect(mutated).not.toBe(read());
    expect(staleFramingIn(mutated)).not.toEqual([]);
  });
});
