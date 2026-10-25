#!/usr/bin/env node
/**
 * Fast-fail pre-check for the Playwright Chromium prerequisite.
 *
 * The unit suite includes browser-dependent tests — most notably
 * `tests/main-street/storyline-graph-svg.test.ts`, whose renderer calls
 * `chromium.launch()`. Playwright resolves its browser from a per-version
 * cache (`~/.cache/ms-playwright/chromium-<revision>`), so when `node_modules`
 * is refreshed ahead of the committed `package-lock.json` the suite dies with
 * an opaque unhandled error:
 *
 *     Error: browserType.launch: Executable doesn't exist at
 *       .../chromium_headless_shell-1248/.../chrome-headless-shell
 *
 * Wired as npm's `pretest` hook, this check turns that into a sub-second
 * failure that prints the exact remediation commands (MS-0MVJPV0BV000LSLW).
 *
 * Detection is launch-free and network-free: package resolution, one
 * `existsSync`, and an optional read of the committed lockfile version.
 *
 * Usage:
 *   npx tsx src/scripts/check-playwright-chromium.ts
 *
 * Exit code: 0 when the prerequisite is present, 1 when it is missing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** A prerequisite that can be missing for the Chromium-dependent tests. */
export type MissingPrereq = 'playwright' | 'chromium';

/** Injectable dependencies (defaults hit the real environment). */
export interface CheckDeps {
  /** Resolve a package specifier to a module path, or null when missing. */
  resolveModule?: (specifier: string) => string | null;
  /** Playwright's Chromium executable path, or null when unavailable. */
  chromiumExecutablePath?: () => string | null;
  /** Whether a filesystem path exists. */
  pathExists?: (path: string) => boolean;
  /** OS platform override (defaults to `process.platform`). */
  platform?: string;
  /** Installed `playwright` package version, or null when unknown. */
  installedPlaywrightVersion?: () => string | null;
  /** `playwright` version pinned by `package-lock.json`, or null when unknown. */
  lockfilePlaywrightVersion?: () => string | null;
}

/** Result of the prerequisite check. */
export interface CheckResult {
  /** True when every prerequisite is present. */
  ok: boolean;
  /** Prerequisites that are missing (empty when `ok`). */
  missing: MissingPrereq[];
  /** Playwright's expected Chromium binary path, when resolvable. */
  executablePath: string | null;
  /** Version of the installed `playwright` package, when known. */
  installedVersion: string | null;
  /** Version pinned by `package-lock.json`, when known. */
  lockfileVersion: string | null;
  /** True when the installed version differs from the lockfile's. */
  versionDrift: boolean;
}

const require = createRequire(import.meta.url);

/** Repository root, resolved from this script's location (`<root>/src/scripts/`). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PREREQ_LABELS: Record<MissingPrereq, string> = {
  playwright: 'Playwright package (`playwright` in devDependencies)',
  chromium: 'Playwright Chromium browser binary',
};

/** Resolve a package via `require.resolve`; null when not installed. */
function defaultResolveModule(specifier: string): string | null {
  try {
    return require.resolve(specifier);
  } catch {
    return null;
  }
}

/**
 * Playwright's `chromium.executablePath()` — the expected binary path,
 * computed from the browser registry without launching anything. Returns
 * null when the playwright package cannot be loaded.
 */
function defaultChromiumExecutablePath(): string | null {
  try {
    const { chromium } = require('playwright') as typeof import('playwright');
    return chromium.executablePath() ?? null;
  } catch {
    return null;
  }
}

/** Version of the installed `playwright` package, or null when unknown. */
function defaultInstalledPlaywrightVersion(): string | null {
  try {
    const pkg = require('playwright/package.json') as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Version of `playwright` pinned in the committed lockfile, or null when the
 * lockfile is missing/unreadable. Uses the resolved `node_modules/playwright`
 * entry so it reflects what `npm ci` would install.
 */
function defaultLockfilePlaywrightVersion(): string | null {
  try {
    const raw = readFileSync(resolve(REPO_ROOT, 'package-lock.json'), 'utf-8');
    const lock = JSON.parse(raw) as {
      packages?: Record<string, { version?: string }>;
    };
    return lock.packages?.['node_modules/playwright']?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Detect whether the Chromium prerequisite is present.
 * Launch-free and network-free.
 */
export function checkPlaywrightChromium(deps: CheckDeps = {}): CheckResult {
  const resolveModule = deps.resolveModule ?? defaultResolveModule;
  const pathExists = deps.pathExists ?? existsSync;
  const installedVersion =
    deps.installedPlaywrightVersion ?? defaultInstalledPlaywrightVersion;
  const lockfileVersion =
    deps.lockfilePlaywrightVersion ?? defaultLockfilePlaywrightVersion;

  const missing: MissingPrereq[] = [];
  let executablePath: string | null = null;

  if (!resolveModule('playwright')) {
    missing.push('playwright');
  } else {
    executablePath = (deps.chromiumExecutablePath ?? defaultChromiumExecutablePath)();
    if (!executablePath || !pathExists(executablePath)) {
      missing.push('chromium');
    }
  }

  const installed = installedVersion();
  const locked = lockfileVersion();

  return {
    ok: missing.length === 0,
    missing,
    executablePath,
    installedVersion: installed,
    lockfileVersion: locked,
    versionDrift: Boolean(installed && locked && installed !== locked),
  };
}

/**
 * Build the actionable remediation message for a failed (or drifted) check.
 * Includes the install, verify, and (on Linux) the system-dependencies
 * variant of `npx playwright install`.
 */
export function buildRemediationMessage(
  result: CheckResult,
  platform: string = process.platform,
): string {
  const lines: string[] = [];

  if (result.missing.length > 0) {
    lines.push(
      'Playwright Chromium prerequisite is missing — the unit suite contains',
      'browser-dependent tests and cannot run:',
      ...result.missing.map((m) => `  - ${PREREQ_LABELS[m]}`),
      ...(result.executablePath && result.missing.includes('chromium')
        ? [`  Expected binary: ${result.executablePath}`]
        : []),
      '',
    );
  }

  if (result.versionDrift) {
    lines.push(
      `Installed playwright@${result.installedVersion} does not match ` +
        `package-lock.json (${result.lockfileVersion}) — node_modules is out of ` +
        'sync with the lockfile.',
      'Reinstall exactly the locked dependency tree first:',
      '  npm ci',
      '',
    );
  }

  lines.push(
    'Install Playwright Chromium:',
    '  npx playwright install chromium',
  );
  if (platform === 'linux') {
    lines.push(
      '  npx playwright install --with-deps chromium   # Linux: also installs system libraries (may require sudo)',
    );
  }
  lines.push(
    '',
    'Verify the installation:',
    '  npx playwright install --list',
  );
  return lines.join('\n');
}

/**
 * Run the check and return the process exit code (0 = ready, 1 = missing).
 * The message goes to stderr by default so it survives stdout piping.
 */
export function runCheck(
  deps: CheckDeps = {},
  print: (msg: string) => void = (msg) => process.stderr.write(`${msg}\n`),
): number {
  const result = checkPlaywrightChromium(deps);

  if (result.ok) {
    if (result.versionDrift) {
      print(
        `WARNING: installed playwright@${result.installedVersion} differs from ` +
          `package-lock.json (${result.lockfileVersion}); run \`npm ci\` to realign.`,
      );
    }
    print(
      `Playwright Chromium prerequisite OK${result.executablePath ? `: ${result.executablePath}` : ''}`,
    );
    return 0;
  }

  print(buildRemediationMessage(result, deps.platform ?? process.platform));
  return 1;
}

function main(): void {
  process.exit(runCheck());
}

// Entry-point guard: run main() only when executed as a script, so the pure
// helpers can be imported by tests without side effects.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
