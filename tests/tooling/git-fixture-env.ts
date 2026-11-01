/**
 * Hermetic environment for git fixtures (MS-0MVVOQPVY006G2ZE).
 *
 * Tests that build throw-away git repositories must not inherit the git
 * environment of the process that runs the suite. `implement.py finish` tests
 * the *would-be-commit tree* by exporting a temporary `GIT_INDEX_FILE` for the
 * duration of the suite, so a fixture that simply spreads `process.env` stages
 * its own files into our gate index instead of the fixture repository's index:
 *
 * - the fixture fails (`fatal: please make sure that the .gitmodules file is in
 *   the working tree` from `git submodule add`), and
 * - the gate discards the evidence (`gate evidence invalid: the temporary index
 *   changed while the suite ran`), so `finish` can never succeed.
 *
 * Fixtures therefore spawn git with {@link hermeticGitEnv}, which drops every
 * variable that relocates a repository, its index or its object store, while
 * keeping the caller's other settings (PATH, GIT_ALLOW_PROTOCOL for local
 * remotes, GIT_TERMINAL_PROMPT, …).
 *
 * The Python side of the same rule lives in `shared.git_sandbox.fixture_git_env()`.
 *
 * @module
 */

/**
 * Git environment variables that point a command at *another* repository, index
 * or object store. Any of them inherited from the suite's caller makes a
 * fixture operate on the caller's repository instead of the fixture's own.
 */
export const GIT_REPO_OVERRIDE_VARS = [
  'GIT_INDEX_FILE',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_QUARANTINE_PATH',
  'GIT_SHALLOW_FILE',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
] as const;

/**
 * Build an environment for spawning `git` inside a temporary fixture repo.
 *
 * @param extra Additional variables to set (applied after the strip, so they
 *   always win). Defaults to `{}`.
 * @returns A copy of `process.env` with every {@link GIT_REPO_OVERRIDE_VARS}
 *   entry removed, plus `extra`.
 */
export function hermeticGitEnv(
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if ((GIT_REPO_OVERRIDE_VARS as readonly string[]).includes(key)) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * Hide {@link GIT_REPO_OVERRIDE_VARS} from the *current* process.
 *
 * Fixture tests that call production git helpers (`submoduleIsDirty`,
 * `syncEngine`, `verifyEngine`, the engine-checkout preflight) cannot pass an
 * environment down: those helpers spawn `git` themselves with `process.env`.
 * Calling this in `beforeAll` and restoring in `afterAll` makes the fixture an
 * isolated repository even when the suite was started with a temporary
 * `GIT_INDEX_FILE` (the finish gate's would-be-commit tree).
 *
 * @returns A restore function that puts every hidden variable back.
 */
export function hideGitRepoOverrides(): () => void {
  const saved: Array<[string, string | undefined]> = [];
  for (const key of GIT_REPO_OVERRIDE_VARS) {
    saved.push([key, process.env[key]]);
    delete process.env[key];
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}
