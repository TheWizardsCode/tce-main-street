/**
 * Regression guard for {@link hermeticGitEnv} (MS-0MVVOQPVY006G2ZE).
 *
 * The finish gate runs the suite with a temporary `GIT_INDEX_FILE`; fixture
 * git commands must not inherit it (or any other repository-relocating git
 * variable). These tests pin the strip list and the precedence rules of the
 * helper so the guard cannot be weakened silently.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GIT_REPO_OVERRIDE_VARS, hermeticGitEnv, hideGitRepoOverrides } from './git-fixture-env';

describe('hermeticGitEnv', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of GIT_REPO_OVERRIDE_VARS) {
      saved[key] = process.env[key];
      process.env[key] = `/inherited/${key.toLowerCase()}`;
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('removes every repository-relocating git variable', () => {
    const env = hermeticGitEnv();

    for (const key of GIT_REPO_OVERRIDE_VARS) {
      expect(env[key]).toBeUndefined();
    }
  });

  it('keeps unrelated environment (including git protocol toggles)', () => {
    process.env.GIT_ALLOW_PROTOCOL = 'file';
    process.env.GIT_TERMINAL_PROMPT = '0';
    try {
      const env = hermeticGitEnv();
      expect(env.GIT_ALLOW_PROTOCOL).toBe('file');
      expect(env.GIT_TERMINAL_PROMPT).toBe('0');
      expect(env.PATH).toBe(process.env.PATH);
    } finally {
      delete process.env.GIT_ALLOW_PROTOCOL;
      delete process.env.GIT_TERMINAL_PROMPT;
    }
  });

  it('applies caller-supplied overrides last', () => {
    const env = hermeticGitEnv({ GIT_ALLOW_PROTOCOL: 'file' });

    expect(env.GIT_ALLOW_PROTOCOL).toBe('file');
    expect(env.GIT_INDEX_FILE).toBeUndefined();
  });

  it('does not mutate process.env', () => {
    hermeticGitEnv({ GIT_DIR: '/elsewhere' });

    expect(process.env.GIT_INDEX_FILE).toBe('/inherited/git_index_file');
    expect(process.env.GIT_DIR).toBe('/inherited/git_dir');
  });

  it('hides the overrides from this process and restores them exactly', () => {
    const restore = hideGitRepoOverrides();

    for (const key of GIT_REPO_OVERRIDE_VARS) {
      expect(process.env[key]).toBeUndefined();
    }

    restore();

    for (const key of GIT_REPO_OVERRIDE_VARS) {
      expect(process.env[key]).toBe(`/inherited/${key.toLowerCase()}`);
    }
  });

  it('restores variables that were absent before hiding', () => {
    delete process.env.GIT_DIR;
    const restore = hideGitRepoOverrides();
    restore();

    expect(process.env.GIT_DIR).toBeUndefined();
    expect(process.env.GIT_INDEX_FILE).toBe('/inherited/git_index_file');
  });
});
