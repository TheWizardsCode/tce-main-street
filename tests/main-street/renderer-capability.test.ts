/**
 * Main Street: core renderer-capability probe (MS-0MVU03TF9003W55I).
 *
 * This repo consumes the engine through the composed `./core` submodule, so
 * "the engine now has renderer-aware clipping" is an *assumption* until it is
 * asserted against the tree this repo actually builds and tests. This probe is
 * that assertion, and it is deliberately **fail-first**: against the previous
 * pin (`f0b5b9e9`, core v0.1.22) `src/ui/ContainerClip.ts` does not exist, the
 * four core clip sites still construct a Canvas-only `GeometryMask`, and
 * `renderMainTs()` still emits `type: Phaser.CANVAS` — so every case below
 * fails. It passes only once `./core` carries core
 * `CG-0MVTMITW7002VF0I` (helper `CG-0MVTQ3UZL004YO8O`, migrations
 * `CG-0MVTQ3VL4002RB1D` / `CG-0MVTQ3W58004XN92`, scaffold
 * `CG-0MVTQ3WPV003ZECA`).
 *
 * Why it matters: Phaser 4 removed `GameObject.setMask` support under WebGL
 * (`GeometryMask` is Canvas-only; the call logs a warning and returns), so a
 * Canvas-only core clip silently renders **unclipped** in a WebGL boot — and
 * the generated launcher reverted every re-scaffolded game repo to Canvas.
 *
 * Scope: the probe asserts the *capability* the downstream steps consume. It
 * does not boot Phaser, does not touch `src/` of this repo, and leaves the
 * Canvas-pinned browser tests untouched.
 *
 * @module tests/main-street/renderer-capability
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { renderMainTs } from '@core-scripts/game-repo-scaffold';

/**
 * The ContainerClip module is loaded lazily: at the pre-migration pin it does
 * not exist, and a probe whose red state is a module-resolution crash tells a
 * maintainer nothing about the other two capabilities. Importing per-test keeps
 * every missed capability a distinct, readable failure.
 */
type ContainerClipModule = typeof import('../../core/src/ui/ContainerClip');

function loadContainerClip(): Promise<ContainerClipModule> {
  return import('../../core/src/ui/ContainerClip');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
/** The composed engine checkout this repo builds against (`git submodule core`). */
const CORE_ROOT = path.join(REPO_ROOT, 'core');

/** The core-owned clip sites the Core WebGL migration had to convert. */
const CORE_CLIP_SITES = [
  'src/ui/HelpPanel.ts',
  'src/ui/Overlay.ts',
  'src/ui/SettingsPanel.ts',
  'example-games/gym/scenes/GymOverlayUiScene.ts',
] as const;

/**
 * Canvas-only clipping constructions. Before
 * `CG-0MVTMITW7002VF0I` each core clip site built one of these directly and
 * handed it to `setMask`, which is a no-op under the WebGL renderer.
 */
const CANVAS_ONLY_CLIP_CONSTRUCTIONS = [
  /new\s+Phaser\.Display\.Masks\.GeometryMask\s*\(/,
  /\.createGeometryMask\s*\(/,
];

/** Read a file from the composed `./core` tree. */
function readCoreFile(relativePath: string): string {
  return fs.readFileSync(path.join(CORE_ROOT, relativePath), 'utf-8');
}

/** Minimal Canvas-renderer scene/target pair, with call recording. */
function canvasClipHarness(): {
  scene: Parameters<ContainerClipModule['createContainerClip']>[0];
  target: Parameters<ContainerClipModule['createContainerClip']>[1];
  calls: { setMask: unknown[]; clearMask: number; maskDestroyed: number };
  mask: { destroy: () => void };
} {
  const calls = { setMask: [] as unknown[], clearMask: 0, maskDestroyed: 0 };
  const mask = {
    destroy: () => {
      calls.maskDestroyed += 1;
    },
  };
  const graphics = {
    clear: () => {},
    fillStyle: () => {},
    fillRect: () => {},
    createGeometryMask: () => mask,
    destroy: () => {},
  };
  const scene = {
    // Phaser.CANVAS === 1 — the renderer branch `createContainerClip` reads.
    renderer: { type: 1 },
    add: { graphics: () => graphics },
  };
  const target = {
    setMask: (candidate: unknown) => {
      calls.setMask.push(candidate);
    },
    clearMask: () => {
      calls.clearMask += 1;
    },
  };

  return {
    scene: scene as unknown as Parameters<ContainerClipModule['createContainerClip']>[0],
    target: target as unknown as Parameters<ContainerClipModule['createContainerClip']>[1],
    calls,
    mask,
  };
}

describe('core ContainerClip capability (CG-0MVTQ3UZL004YO8O)', () => {
  it('ships src/ui/ContainerClip.ts in the composed ./core tree', () => {
    expect(fs.existsSync(path.join(CORE_ROOT, 'src', 'ui', 'ContainerClip.ts'))).toBe(true);
  });

  it('exports createContainerClip as a function', async () => {
    const { createContainerClip } = await loadContainerClip();

    expect(typeof createContainerClip).toBe('function');
  });

  it('returns a clip exposing setRect, clear and destroy', async () => {
    const { createContainerClip } = await loadContainerClip();
    const { scene, target } = canvasClipHarness();

    const clip = createContainerClip(scene, target);

    expect(typeof clip.setRect).toBe('function');
    expect(typeof clip.clear).toBe('function');
    expect(typeof clip.destroy).toBe('function');
    // Renderer-aware: the mechanism is chosen from the scene's renderer type.
    expect(clip.renderer).toBe('canvas');
  });

  it('applies, moves and clears the clip on the target container', async () => {
    const { createContainerClip } = await loadContainerClip();
    const { scene, target, calls, mask } = canvasClipHarness();

    const clip = createContainerClip(scene, target, { x: 0, y: 0, w: 100, h: 50 });
    expect(clip.active).toBe(true);
    expect(clip.rect).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(calls.setMask).toContain(mask);

    clip.setRect({ x: 10, y: 20, w: 30, h: 40 });
    expect(clip.rect).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(clip.active).toBe(true);

    clip.clear();
    expect(clip.active).toBe(false);
    expect(calls.clearMask).toBeGreaterThan(0);
  });

  it('destroys its mask resources once (idempotent)', async () => {
    const { createContainerClip } = await loadContainerClip();
    const { scene, target, calls } = canvasClipHarness();

    const clip = createContainerClip(scene, target, { x: 0, y: 0, w: 10, h: 10 });
    clip.destroy();
    clip.destroy();

    expect(calls.maskDestroyed).toBe(1);
    expect(clip.active).toBe(false);
  });
});

describe('core clip sites are renderer-aware (CG-0MVTQ3VL4002RB1D, CG-0MVTQ3W58004XN92)', () => {
  it.each(CORE_CLIP_SITES)('%s no longer constructs a Canvas-only GeometryMask', (clipSite) => {
    const source = readCoreFile(clipSite);

    for (const canvasOnly of CANVAS_ONLY_CLIP_CONSTRUCTIONS) {
      expect(source).not.toMatch(canvasOnly);
    }
    // Migrated, not merely deleted: the site now goes through the shared helper.
    expect(source).toMatch(/createContainerClip\s*\(/);
  });
});

describe('scaffold launcher renderer (CG-0MVTQ3WPV003ZECA)', () => {
  it('renderMainTs() emits type: Phaser.AUTO and never Phaser.CANVAS', () => {
    const mainTs = renderMainTs();

    expect(mainTs).toMatch(/type:\s*Phaser\.AUTO/);
    expect(mainTs).not.toMatch(/Phaser\.CANVAS/);
  });
});
