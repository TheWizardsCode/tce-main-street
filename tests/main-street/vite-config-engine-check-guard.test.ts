/**
 * Engine-checkout preflight wiring drift guard (MS-0MVO26G5H0054SNV).
 *
 * The gate lives in two auto-generated/owned places:
 *
 * 1. `vite.config.ts` (engine-owned `core/scripts/game-repo-scaffold.ts`
 *    regenerates it) registers the precheck as the root `test.globalSetup` —
 *    the one config-level hook every Vitest invocation inherits (`npm test`,
 *    the changed-scope gate's direct `npx vitest run <files>`, the dev-push
 *    browser gate). It is a documented LOCAL SURGICAL ADDITION, exactly like
 *    the `CLI_TEST_FILES`/`unit-cli` project held by
 *    `vitest-cli-project-isolation.test.ts`.
 * 2. `package.json` exposes the same code path as `npm run engine:check` for
 *    manual/CI diagnosis.
 *
 * A re-scaffold drops both. These tests read the real files (not a copy) and
 * fail loudly when either wiring line disappears, so the gate cannot
 * silently stop applying to any test run.
 *
 * @module tests/main-street/vite-config-engine-check-guard
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'vite.config.ts');
const PACKAGE_PATH = path.join(PROJECT_ROOT, 'package.json');

const PRECHECK_GLOBAL_SETUP = "globalSetup: ['./tests/tooling/engine-checkout-precheck.ts']";
const PRECHECK_MODULE = 'tests/tooling/engine-checkout-precheck.ts';

describe('vite.config.ts — engine-checkout preflight wiring (AC1)', () => {
  const config = fs.readFileSync(CONFIG_PATH, 'utf8');

  it('registers the precheck as the root test.globalSetup', () => {
    expect(config).toContain(PRECHECK_GLOBAL_SETUP);
  });

  it('documents the wiring as a LOCAL SURGICAL ADDITION with this work item', () => {
    expect(config).toMatch(/Engine-checkout preflight \(MS-0MVO26G5H0054SNV\)/);
    expect(config).toContain('LOCAL SURGICAL');
  });

  it('references the guarded module path so the hook and its file stay in sync', () => {
    expect(config).toContain(PRECHECK_MODULE);
  });
});

describe('package.json — engine:check script (AC1)', () => {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8')) as {
    scripts?: Record<string, string>;
  };

  it('exposes the manual/CI invocation on the same code path', () => {
    expect(pkg.scripts?.['engine:check']).toBe(`tsx ${PRECHECK_MODULE}`);
  });

  it('keeps the pretest hook untouched (Playwright Chromium check still runs first)', () => {
    expect(pkg.scripts?.['pretest']).toBe('tsx src/scripts/check-playwright-chromium.ts');
  });
});
