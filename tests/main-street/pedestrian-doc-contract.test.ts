/**
 * Pedestrian layer lifecycle/attach contract guard (MS-0MVRMI1EQ002I24K).
 *
 * The ambient reputation crowd hangs off three integration points: it is
 * re-attached **last** by `MainStreetRendererStreet.refreshStreetGrid`, its
 * population is raised **only** from the HUD refresh path
 * (`animateHudValueChanges` → `syncPedestrianPopulation` → `setPopulation`),
 * and it renders nothing under Reduced Motion / replay. Those links are
 * documented in `docs/game/ux-visual-audio.md` § *Ambient street pedestrians
 * (reputation crowd)* and summarised in `src/scenes/README.md`, so a renderer
 * or boot-path change cannot silently drop the crowd again.
 *
 * This file keeps the written contract and the code anchors it names from
 * drifting apart. Runtime behaviour is asserted by the scene-level guard
 * `tests/main-street/pedestrians-scene-visibility.browser.test.ts`
 * (MS-0MVRMHTW6006KQKI); nothing here replaces that behaviour test.
 *
 * @module
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');

const UX_DOC = 'docs/game/ux-visual-audio.md';
const SCENES_README = 'src/scenes/README.md';
const RENDERER_STREET = 'src/scenes/MainStreetRendererStreet.ts';
const LIFECYCLE_MANAGER = 'src/scenes/MainStreetLifecycleManagerLifecycle.ts';
const ANIMATOR_INCOME = 'src/scenes/MainStreetAnimatorIncome.ts';

function read(rel: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, rel), 'utf-8');
}

/** Whitespace-normalised read so assertions survive markdown line wrapping. */
function norm(rel: string): string {
  return read(rel).replace(/\s+/g, ' ');
}

describe('docs/game/ux-visual-audio.md — pedestrian lifecycle contract', () => {
  const doc = norm(UX_DOC);

  it('keeps the section heading the rest of the docs cross-reference', () => {
    expect(doc).toContain('Ambient street pedestrians (reputation crowd');
  });

  it('names the owning module and the construction sites', () => {
    expect(doc).toContain('src/scenes/MainStreetPedestrians.ts');
    expect(doc).toContain('MainStreetPedestrians');
    expect(doc).toContain('MainStreetLifecycleManagerLifecycle');
    expect(doc).toMatch(/construction sites/i);
    expect(doc).toMatch(/pre-reset helper block/i);
    expect(doc).toMatch(/post-scaffolding block/i);
  });

  it('states that a street rebuild destroys the layer and must re-attach it last', () => {
    expect(doc).toContain('refreshStreetGrid');
    expect(doc).toContain('removeAll(true)');
    expect(doc).toContain('attachToStreet');
    // The ordering requirement is the whole point of the contract.
    expect(doc).toMatch(/must stay last/i);
    // Rebuilds preserve the crowd rather than resetting it.
    expect(doc).toMatch(/re-parents the \*\*existing\*\* figures/i);
  });

  it('states that population is reconciled only from the HUD path', () => {
    expect(doc).toContain('animateHudValueChanges');
    expect(doc).toContain('syncPedestrianPopulation');
    expect(doc).toContain('setPopulation(pedestrianCount(reputation))');
    expect(doc).toMatch(/only.+path that raises/i);
  });

  it('states which modes render nothing', () => {
    expect(doc).toContain('shouldRenderPedestrians');
    expect(doc).toMatch(/Reduced Motion/);
    expect(doc).toMatch(/replay\/headless/);
    expect(doc).toMatch(/replayMode/);
  });

  it('records the regression and the reproducible failure shape (root-cause note)', () => {
    expect(doc).toContain('MS-0MVRDVVH4001048Q');
    expect(doc).toMatch(/root cause note/i);
    expect(doc).toMatch(/no integration defect/i);
    expect(doc).toContain('pedestrians-scene-visibility.browser.test.ts');
    expect(doc).toContain('MS-0MVRMHTW6006KQKI');
  });

  it('has replaced the old thin "Lifecycle:" bullet', () => {
    expect(doc).not.toContain('Lifecycle: the layer is created with the scene');
  });
});

describe('src/scenes/README.md — layer ownership and attach hook', () => {
  const readme = norm(SCENES_README);

  it('names the pedestrian layer, its owning module and its attach hook', () => {
    expect(readme).toContain('MainStreetPedestrians');
    expect(readme).toContain('src/scenes/MainStreetPedestrians.ts');
    expect(readme).toMatch(/owning module/i);
    expect(readme).toContain('refreshStreetGrid');
    expect(readme).toContain('attachToStreet');
  });

  it('links to the authoritative contract in the UX doc', () => {
    expect(readme).toContain('docs/game/ux-visual-audio.md');
    expect(readme).toContain('Ambient street pedestrians (reputation crowd');
    expect(readme).toContain('MS-0MVRMI1EQ002I24K');
  });
});

describe('documented code anchors still exist', () => {
  it('keeps the rebuild attach hook after the container teardown', () => {
    const source = read(RENDERER_STREET);
    const teardown = source.indexOf('streetContainer.removeAll(true)');
    const attach = source.indexOf('s.msPedestrians?.attachToStreet?.()');
    expect(teardown).toBeGreaterThan(-1);
    expect(attach).toBeGreaterThan(teardown);
  });

  it('keeps both pedestrian construction sites in the lifecycle manager', () => {
    const matches = read(LIFECYCLE_MANAGER).match(/new MainStreetPedestrians\(s\)/g) ?? [];
    expect(matches).toHaveLength(2);
  });

  it('keeps the HUD-path population reconciliation', () => {
    const source = read(ANIMATOR_INCOME);
    expect(source).toContain('syncPedestrianPopulation(s, reputation)');
    expect(source).toContain('setPopulation?.(pedestrianCount(reputation))');
  });

  it('references the documented contract from the attach hook and construction sites', () => {
    const contract = 'docs/game/ux-visual-audio.md';
    expect(read(RENDERER_STREET)).toContain(contract);
    expect(read(LIFECYCLE_MANAGER)).toContain(contract);
    expect(read(ANIMATOR_INCOME)).toContain(contract);
  });
});
