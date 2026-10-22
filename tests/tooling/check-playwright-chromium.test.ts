/**
 * Fast-fail Playwright Chromium prerequisite check (MS-0MVJPV0BV000LSLW).
 *
 * The unit suite contains browser-dependent tests (notably
 * `storyline-graph-svg.test.ts`, which calls `chromium.launch()` through the
 * storyline graph renderer). When the Chromium binary for the *installed*
 * Playwright version is absent — typically because `node_modules` was
 * refreshed ahead of the committed `package-lock.json` — the suite dies with
 * an opaque "Unhandled Error: browserType.launch: Executable doesn't exist"
 * instead of telling the operator what to run.
 *
 * `src/scripts/check-playwright-chromium.ts` is wired as the npm `pretest`
 * hook so the failure is fast and actionable. These tests exercise the check's
 * behaviour through its injectable dependency seam plus the package.json
 * wiring contract, so no real browser launch is required.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildRemediationMessage,
  checkPlaywrightChromium,
  runCheck,
} from '../../src/scripts/check-playwright-chromium';

const REPO_ROOT = process.cwd();

/** A dependency set describing a fully healthy environment. */
function healthyDeps(overrides: Record<string, unknown> = {}) {
  return {
    resolveModule: () => '/repo/node_modules/playwright/index.js',
    chromiumExecutablePath: () => '/cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
    pathExists: () => true,
    platform: 'linux',
    installedPlaywrightVersion: () => '1.64.1',
    lockfilePlaywrightVersion: () => '1.64.1',
    ...overrides,
  };
}

describe('checkPlaywrightChromium', () => {
  it('reports ok when the Playwright package and its Chromium binary are present', () => {
    const result = checkPlaywrightChromium(healthyDeps());

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.executablePath).toContain('chromium-1248');
    expect(result.versionDrift).toBe(false);
  });

  it('flags a missing Chromium binary even when the Playwright package resolves', () => {
    const result = checkPlaywrightChromium(
      healthyDeps({ pathExists: () => false }),
    );

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['chromium']);
    // The package itself is fine — only the browser build is absent.
    expect(result.executablePath).toContain('chromium-1248');
  });

  it('flags a missing Playwright package and does not consult the filesystem', () => {
    const pathExists = vi.fn(() => true);
    const result = checkPlaywrightChromium(
      healthyDeps({ resolveModule: () => null, pathExists }),
    );

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['playwright']);
    expect(pathExists).not.toHaveBeenCalled();
  });

  it('detects node_modules/lockfile version drift', () => {
    const result = checkPlaywrightChromium(
      healthyDeps({
        installedPlaywrightVersion: () => '1.64.1',
        lockfilePlaywrightVersion: () => '1.63.0',
      }),
    );

    // Drift alone is a warning signal, not a missing prerequisite.
    expect(result.ok).toBe(true);
    expect(result.versionDrift).toBe(true);
    expect(result.installedVersion).toBe('1.64.1');
    expect(result.lockfileVersion).toBe('1.63.0');
  });

  it('treats an unreadable lockfile version as unknown rather than drift', () => {
    const result = checkPlaywrightChromium(
      healthyDeps({ lockfilePlaywrightVersion: () => null }),
    );

    expect(result.ok).toBe(true);
    expect(result.versionDrift).toBe(false);
  });
});

describe('buildRemediationMessage', () => {
  it('names the missing Chromium binary and the exact install command', () => {
    const message = buildRemediationMessage(
      checkPlaywrightChromium(healthyDeps({ pathExists: () => false })),
      'linux',
    );

    expect(message).toContain('Playwright Chromium browser binary');
    expect(message).toContain('npx playwright install chromium');
    // Linux also needs the system-library variant.
    expect(message).toContain('npx playwright install --with-deps chromium');
    expect(message).toContain('npx playwright install --list');
  });

  it('omits the Linux system-library variant on other platforms', () => {
    const message = buildRemediationMessage(
      checkPlaywrightChromium(healthyDeps({ pathExists: () => false })),
      'darwin',
    );

    expect(message).toContain('npx playwright install chromium');
    expect(message).not.toContain('--with-deps');
  });

  it('explains version drift and suggests npm ci', () => {
    const message = buildRemediationMessage(
      checkPlaywrightChromium(
        healthyDeps({
          installedPlaywrightVersion: () => '1.64.1',
          lockfilePlaywrightVersion: () => '1.63.0',
        }),
      ),
      'linux',
    );

    expect(message).toContain('playwright@1.64.1');
    expect(message).toContain('package-lock.json');
    expect(message).toContain('npm ci');
    expect(message).toContain('npx playwright install chromium');
  });
});

describe('runCheck', () => {
  it('returns 0 and prints an OK line for a healthy environment', () => {
    const print = vi.fn();
    const code = runCheck(healthyDeps(), print);

    expect(code).toBe(0);
    expect(print).toHaveBeenCalledTimes(1);
    expect(print.mock.calls[0][0]).toMatch(/OK/i);
  });

  it('returns 1 and prints remediation when the Chromium binary is missing', () => {
    const print = vi.fn();
    const code = runCheck(healthyDeps({ pathExists: () => false }), print);

    expect(code).toBe(1);
    expect(print.mock.calls[0][0]).toContain('npx playwright install chromium');
  });
});

describe('npm pretest wiring', () => {
  it('runs the prerequisite check before the unit suite', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts.pretest).toBeDefined();
    expect(packageJson.scripts.pretest).toContain(
      'src/scripts/check-playwright-chromium.ts',
    );
    // `npm test` is the gate command; pretest must not be bypassed by it.
    expect(packageJson.scripts.test).toContain('vitest-run-with-retry');
  });
});
