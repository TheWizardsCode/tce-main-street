/**
 * Guard: `.pi/test-config.json` must keep `timeoutPerCommand` at or above the
 * measured loaded-host worst case (MS-0MVTEVJBH003GE8W).
 *
 * The finish gate bounds **each** `suiteCommands` entry — and the `git push`
 * step — by `timeoutPerCommand`. At 1800 s it killed a healthy full suite that
 * measured 2846.6 s on a loaded host and reported the kill as a code failure
 * (`reason: unknown`, `failures: []`). This test fails when the value is
 * lowered below the documented floor, and proves the guard actually guards by
 * running the same evaluation over fixture configs at 1800 s (fails) and
 * 3600 s (passes).
 *
 * The evaluation logic lives in `./test-config-timeout-guard` so the floor,
 * the measurement and the headroom are stated once.
 *
 * @module tests/tooling/test-config-timeout-guard.test
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  EXPECTED_GROUP_NAMES,
  EXPECTED_SUITE_COMMANDS,
  MEASURED_WORST_CASE_SECONDS,
  MINIMUM_TIMEOUT_PER_COMMAND_SECONDS,
  REQUIRED_HEADROOM_RATIO,
  evaluateTimeoutPerCommand,
  structuralProblems,
  type TestConfigLike,
} from './test-config-timeout-guard';

const REPO_ROOT = path.resolve(__dirname, '../..');
const CONFIG_RELATIVE_PATH = path.join('.pi', 'test-config.json');
const CONFIG_PATH = path.join(REPO_ROOT, CONFIG_RELATIVE_PATH);

function readConfig(configPath: string = CONFIG_PATH): TestConfigLike {
  return JSON.parse(fs.readFileSync(configPath, 'utf8')) as TestConfigLike;
}

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'test-config-timeout-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('the repository config', () => {
  it('sets timeoutPerCommand at or above the measured floor', () => {
    expect(evaluateTimeoutPerCommand(readConfig())).toEqual({ ok: true, message: '' });
  });

  it('is tracked, so every fresh worktree inherits the same value', () => {
    // `implement.py finish` reads `<worktree>/.pi/test-config.json`; a fresh
    // worktree only inherits tracked files.
    expect(fs.existsSync(CONFIG_PATH)).toBe(true);
    expect(readConfig().timeoutPerCommand).toBe(
      MINIMUM_TIMEOUT_PER_COMMAND_SECONDS,
    );
  });

  it('keeps the three-command full suite and all ten named groups', () => {
    const config = readConfig();

    expect(structuralProblems(config)).toEqual([]);
    expect(config.suiteCommands).toEqual([...EXPECTED_SUITE_COMMANDS]);
    expect(Object.keys(config.groups as Record<string, unknown>)).toHaveLength(
      EXPECTED_GROUP_NAMES.length,
    );
  });
});

describe('the documented floor', () => {
  it('covers the measured worst case with the required headroom', () => {
    expect(MEASURED_WORST_CASE_SECONDS).toBeCloseTo(2846.6, 1);
    expect(MINIMUM_TIMEOUT_PER_COMMAND_SECONDS).toBeGreaterThanOrEqual(
      MEASURED_WORST_CASE_SECONDS * (1 + REQUIRED_HEADROOM_RATIO),
    );
  });

  it('is stated in whole minutes so the documented value is unambiguous', () => {
    expect(MINIMUM_TIMEOUT_PER_COMMAND_SECONDS % 60).toBe(0);
  });
});

describe('evaluateTimeoutPerCommand', () => {
  it('fails a config still at the stale 1800 s value, naming the measurement and the floor', () => {
    const verdict = evaluateTimeoutPerCommand({ timeoutPerCommand: 1800 });

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('1800');
    expect(verdict.message).toContain('2846.6');
    expect(verdict.message).toContain('26 %');
    expect(verdict.message).toContain('3600');
  });

  it('passes a config at the floor', () => {
    expect(
      evaluateTimeoutPerCommand({
        timeoutPerCommand: MINIMUM_TIMEOUT_PER_COMMAND_SECONDS,
      }),
    ).toEqual({ ok: true, message: '' });
  });

  it('passes a config above the floor', () => {
    expect(evaluateTimeoutPerCommand({ timeoutPerCommand: 7200 }).ok).toBe(true);
  });

  it('fails when timeoutPerCommand is absent', () => {
    const verdict = evaluateTimeoutPerCommand({});

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('missing');
  });

  it('fails when timeoutPerCommand is not a number', () => {
    expect(evaluateTimeoutPerCommand({ timeoutPerCommand: '3600' }).ok).toBe(false);
    expect(
      evaluateTimeoutPerCommand({ timeoutPerCommand: Number.NaN }).ok,
    ).toBe(false);
  });
});

describe('guarding a fixture config on disk', () => {
  function writeFixture(config: TestConfigLike): string {
    const configPath = path.join(temporaryDirectory(), 'test-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
    return configPath;
  }

  it('rejects a fixture at 1800 s', () => {
    const configPath = writeFixture({
      ...readConfig(),
      timeoutPerCommand: 1800,
    });

    expect(evaluateTimeoutPerCommand(readConfig(configPath)).ok).toBe(false);
  });

  it('accepts a fixture at 3600 s', () => {
    const configPath = writeFixture({
      ...readConfig(),
      timeoutPerCommand: 3600,
    });

    expect(evaluateTimeoutPerCommand(readConfig(configPath))).toEqual({
      ok: true,
      message: '',
    });
  });
});

describe('structuralProblems', () => {
  const baseConfig = (): TestConfigLike => readConfig();

  it('reports a dropped full-suite command', () => {
    const config = baseConfig();
    const problems = structuralProblems({
      ...config,
      suiteCommands: (config.suiteCommands as string[]).slice(0, 2),
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('three-command full suite');
  });

  it('reports a partial suite even when the command count is unchanged', () => {
    const problems = structuralProblems({
      ...baseConfig(),
      suiteCommands: ['npm --silent test', 'npx vitest run --project unit', 'true'],
    });

    expect(problems[0]).toContain('three-command full suite');
    expect(problems[0]).toContain('MainStreetScene.browser.test.ts');
  });

  it('reports a dropped named group', () => {
    const config = baseConfig();
    const groups = { ...(config.groups as Record<string, unknown>) };
    delete groups['loan-hud-browser'];

    const problems = structuralProblems({ ...config, groups });

    expect(problems.some((problem) => problem.includes('loan-hud-browser'))).toBe(true);
  });

  it('reports a missing groups object', () => {
    const problems = structuralProblems({ ...baseConfig(), groups: undefined });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('groups must stay an object');
  });
});
