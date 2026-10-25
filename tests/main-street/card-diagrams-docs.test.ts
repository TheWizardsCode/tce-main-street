/**
 * Card diagrams documentation drift guard (MS-0MVBF47EA007XWO5)
 *
 * AC1 — `docs/game/card-diagrams.md` documents each of the four generated
 *       diagrams and the regeneration workflow (`docs:diagrams`,
 *       per-diagram selection, `--check`).
 * AC2 — `docs/game/card-catalog.md`, `docs/game/storylines.md` and
 *       `src/README.md` cross-link the guide.
 * AC3 — The guide records that the `.mmd` artefacts are generated (never
 *       hand-edited) and that `src/card-data.csv` is the data source.
 *
 * The test fails when the guide, its cross-links, or a referenced artefact is
 * removed or renamed, so the documentation cannot drift away from the
 * generator.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const GUIDE_PATH = path.join(PROJECT_ROOT, 'docs/game/card-diagrams.md');
const CARD_CATALOG_PATH = path.join(PROJECT_ROOT, 'docs/game/card-catalog.md');
const STORYLINES_PATH = path.join(PROJECT_ROOT, 'docs/game/storylines.md');
const SRC_README_PATH = path.join(PROJECT_ROOT, 'src/README.md');

/** The four generated diagrams and their committed Mermaid artefacts. */
const DIAGRAMS = [
  { id: 'synergies', artefact: 'docs/dev/assets/card-synergies.mmd' },
  { id: 'staff', artefact: 'docs/dev/assets/staff-relationships.mmd' },
  { id: 'upgrades', artefact: 'docs/dev/assets/upgrade-chains.mmd' },
  { id: 'community-spaces', artefact: 'docs/dev/assets/community-space-relationships.mmd' },
] as const;

function read(file: string): string {
  return fs.readFileSync(file, 'utf-8');
}

describe('card diagrams documentation', () => {
  it('the guide exists', () => {
    expect(fs.existsSync(GUIDE_PATH)).toBe(true);
  });

  it('documents every diagram and its committed artefact', () => {
    const guide = read(GUIDE_PATH);
    for (const diagram of DIAGRAMS) {
      expect(guide, `missing --diagram ${diagram.id}`).toContain(diagram.id);
      expect(guide, `missing artefact ${diagram.artefact}`).toContain(diagram.artefact);
      expect(
        fs.existsSync(path.join(PROJECT_ROOT, diagram.artefact)),
        `artefact ${diagram.artefact} must exist`,
      ).toBe(true);
    }
  });

  it('documents the regeneration workflow and the drift guard', () => {
    const guide = read(GUIDE_PATH);
    expect(guide).toContain('npm run docs:diagrams');
    expect(guide).toContain('--diagram');
    expect(guide).toContain('--format json');
    expect(guide).toContain('--check');
    // The drift guard's contract is documented with its exit codes.
    expect(guide).toMatch(/exit `?1`?/i);
  });

  it('records that the artefacts are generated and the CSV is the data source', () => {
    const guide = read(GUIDE_PATH);
    expect(guide).toContain('src/card-data.csv');
    expect(guide).toMatch(/never hand-edited|do not hand-edit|generated/i);
  });

  it('is cross-linked from the card catalog, storylines guide and src README', () => {
    for (const source of [CARD_CATALOG_PATH, STORYLINES_PATH, SRC_README_PATH]) {
      expect(read(source), `${path.basename(source)} must link card-diagrams.md`).toContain(
        'card-diagrams.md',
      );
    }
  });
});
