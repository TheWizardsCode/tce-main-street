/**
 * Guard on `.pi/test-config.json`'s `timeoutPerCommand` (MS-0MVTEVJBH003GE8W).
 *
 * ## Semantics (confirmed from the framework source)
 *
 * `timeoutPerCommand` bounds **each** command listed in `suiteCommands`, not
 * the aggregate list: `run_tests.py` resolves
 * `timeout = args.timeout or suite_timeout_per_command(project_root) or 600`
 * and applies it inside `run_suite` per command. The same value bounds the
 * `git push` step as well (`implement.py:_resolve_test_timeout`), so raising
 * it widens the push window too — an accepted consequence recorded on the
 * work item.
 *
 * ## Why a floor rather than a bare constant
 *
 * The full suite measured **2846.6 s** on this host while loaded (2x
 * oversubscription, `/tmp/ms0mvpy2-full.log`) against a declared 1800 s. The
 * finish gate therefore killed a healthy suite and reported the kill as an
 * unparsed failure (`reason: unknown`, `failures: []`). The value must stay at
 * or above that measurement plus headroom; this module is the single source
 * of the floor so the config, the guard and the documentation cannot drift
 * apart (`docs/dev/testing.md`, `docs/dev/build-and-release.md`).
 *
 * @module tests/tooling/test-config-timeout-guard
 */

/** Measured worst-case full-suite runtime on a loaded host, in seconds. */
export const MEASURED_WORST_CASE_SECONDS = 2846.6;

/** Headroom required above the measured worst case. */
export const REQUIRED_HEADROOM_RATIO = 0.26;

/**
 * Lowest acceptable `timeoutPerCommand`, in seconds.
 *
 * 2846.6 s + 26 % = 3586.7 s, rounded up to a whole minute: **3600 s**. The
 * accompanying test proves this actually covers the measurement, so lowering
 * the constant (rather than only the config) still fails.
 */
export const MINIMUM_TIMEOUT_PER_COMMAND_SECONDS = 3600;

/**
 * The full suite this repo declares, pinned so a config edit cannot quietly
 * shrink it: three commands covering the Node unit/unit-cli suites plus the
 * two browser entry points.
 */
export const EXPECTED_SUITE_COMMANDS = [
  'npm --silent test',
  'npx vitest run --project browser tests/main-street/MainStreetScene.browser.test.ts',
  'npx vitest run --project browser tests/e2e/main-street-no-console-errors.browser.test.ts',
] as const;

/**
 * The named `groups` entries this repo declares. They are the targeted-scope
 * mechanism the finish gate prefers before falling back to the full suite, so
 * an edit to `timeoutPerCommand` must not drop any of them.
 *
 * Adding a group deliberately means adding it here too — the list is a
 * deliberate pin, not a mirror that updates itself.
 */
export const EXPECTED_GROUP_NAMES = [
  'hand-bottom-anchor-browser',
  'tutorial-browser',
  'main-street-hud-count',
  'deselect-toggle-browser',
  'hand-drag-post-refresh',
  'upgrade-drag-browser',
  'main-street-overlay-dialogs',
  'hand-panel-browser',
  'pedestrians-scene-visibility-browser',
  'loan-hud-browser',
] as const;

/** The shape of `.pi/test-config.json` this guard inspects. */
export interface TestConfigLike {
  timeoutPerCommand?: unknown;
  suiteCommands?: unknown;
  groups?: unknown;
}

/** Outcome of inspecting a config value. */
export interface Verdict {
  ok: boolean;
  message: string;
}

const PASS: Verdict = { ok: true, message: '' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function headroomPercent(): number {
  return Math.round(REQUIRED_HEADROOM_RATIO * 100);
}

/**
 * Judge a config's `timeoutPerCommand` against the measured floor.
 *
 * Returns `{ ok: true, message: '' }` when the value leaves the suite enough
 * room, and a failing verdict naming the measurement, the headroom and the
 * floor otherwise.
 */
export function evaluateTimeoutPerCommand(config: TestConfigLike): Verdict {
  const value = config.timeoutPerCommand;
  const floor =
    `the full suite took ${MEASURED_WORST_CASE_SECONDS} s on a loaded host, ` +
    `so ${headroomPercent()} % headroom requires at least ` +
    `${MINIMUM_TIMEOUT_PER_COMMAND_SECONDS} s`;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      ok: false,
      message:
        `timeoutPerCommand is missing or not a number in .pi/test-config.json ` +
        `(got ${JSON.stringify(value)}): ${floor}.`,
    };
  }

  if (value < MINIMUM_TIMEOUT_PER_COMMAND_SECONDS) {
    return {
      ok: false,
      message:
        `timeoutPerCommand ${value} s is below the measured floor: ${floor}. ` +
        'A lower value kills a healthy suite and reports the kill as a code failure.',
    };
  }

  return PASS;
}

/**
 * Assert the config's structural invariants survive an edit to
 * `timeoutPerCommand`: the three-command full suite and all ten named groups.
 *
 * Returns an empty list when everything is present, otherwise one message per
 * problem found.
 */
export function structuralProblems(config: TestConfigLike): string[] {
  const problems: string[] = [];

  const suiteCommands = Array.isArray(config.suiteCommands)
    ? config.suiteCommands
    : null;
  if (suiteCommands === null) {
    problems.push(
      `suiteCommands must stay a list of the three full-suite commands ` +
        `(${EXPECTED_SUITE_COMMANDS.join(' | ')}).`,
    );
  } else if (
    suiteCommands.length !== EXPECTED_SUITE_COMMANDS.length ||
    EXPECTED_SUITE_COMMANDS.some((expected, index) => suiteCommands[index] !== expected)
  ) {
    problems.push(
      `suiteCommands must stay the three-command full suite ` +
        `(${EXPECTED_SUITE_COMMANDS.join(' | ')}), got ` +
        `${JSON.stringify(suiteCommands)}.`,
    );
  }

  if (!isRecord(config.groups)) {
    problems.push(
      `groups must stay an object with all ${EXPECTED_GROUP_NAMES.length} named ` +
        `groups (${EXPECTED_GROUP_NAMES.join(', ')}).`,
    );
    return problems;
  }

  const actualGroupNames = Object.keys(config.groups);
  const missing = EXPECTED_GROUP_NAMES.filter(
    (name) => !actualGroupNames.includes(name),
  );
  if (missing.length > 0) {
    problems.push(
      `groups lost ${missing.length} entr${missing.length === 1 ? 'y' : 'ies'} ` +
        `(${missing.join(', ')}); all ${EXPECTED_GROUP_NAMES.length} named groups ` +
        'must remain so targeted scope keeps working.',
    );
  }
  if (actualGroupNames.length !== EXPECTED_GROUP_NAMES.length) {
    problems.push(
      `groups must stay at ${EXPECTED_GROUP_NAMES.length} entries, got ` +
        `${actualGroupNames.length} (${actualGroupNames.join(', ')}).`,
    );
  }

  return problems;
}
