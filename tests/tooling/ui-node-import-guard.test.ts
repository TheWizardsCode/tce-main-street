/**
 * Node-environment regression guard: the `@ui/shakeIllegalMove` import chain
 * must stay Phaser-free for node consumers (unit tests).
 *
 * Regression (MS-0MVQO6N34007DHP8): at engine tip `34e0ab6d` (and its
 * successor `19f30ac7`), `shakeIllegalMove` gained a runtime dependency on
 * the reason-toast view (`./illegalMoveToastView`), which reaches
 * `./Renderer/index`; that file value-imports Phaser (`import Phaser from
 * 'phaser'`, runtime use such as `new Phaser.Geom.Rectangle`). Under node,
 * Phaser's device detection touches `window` at module scope
 * (`phaser/src/device/OS.js`), so the whole chain dies at collection with
 * `ReferenceError: window is not defined` — killing 23 unit suites in this
 * repo, because every scene (`src/scenes/*`) reaches `@ui/shakeIllegalMove`.
 *
 * The engine-side fix is tracked upstream as CG-0MVQQ2M8E003FQMZ ("@ui barrel
 * statically imports Phaser") and is consumed here via re-pin
 * (MS-0MVRAH4BZ0073U1T, child of MS-0MVQO6N34007DHP8). This guard is what
 * proves the re-pin fixed the chain: green at the pre-fix `0409c1eb` pin, red
 * at the unfixed tip. (The `0409c1eb` hold is **retired** — the pin now tracks
 * the engine `dev` tip; see `docs/dev/build-and-release.md`.)
 *
 * DO NOT "fix" a red guard by adding a Vitest module mock for Phaser (or for
 * the `@ui` subpath) — that would hide the regression instead of catching it
 * (parent AC3 forbids per-file mock shims). The 22 existing test files that
 * mock Phaser do so for *active* Phaser behaviour and are unaffected.
 *
 * The guard deliberately value-imports the real module with no mocks: if the
 * chain re-imports Phaser, the suite fails at collection with
 * `window is not defined` before a single assertion runs.
 *
 * @module tests/tooling/ui-node-import-guard
 */
import { expect, it } from 'vitest';
import { shakeIllegalMove } from '@ui/shakeIllegalMove';

it('@ui/shakeIllegalMove loads under node with real Phaser resolution (no mocks) and exports the routine as a function', () => {
  expect(typeof shakeIllegalMove).toBe('function');
});
