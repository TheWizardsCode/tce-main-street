# Testing

Main Street runs its suites with [Vitest](https://vitest.dev/). Two projects
are defined in `vite.config.ts`:

| Project | Test files | Environment |
|---------|-----------|-------------|
| `unit` | `tests/**/*.test.ts` (excludes `*.browser.test.ts`) | Node |
| `browser` | `tests/**/*.browser.test.ts` | Headless Chromium (Playwright) |

```bash
npm test                                                        # unit suite
npx vitest run --project browser                                # full browser suite
npx vitest run --project browser tests/e2e/<name>.browser.test.ts   # a single file
```

The `browser` project runs serially (`fileParallelism: false`) because the
headless Chromium/GPU context is shared; keep browser tests free of cross-file
state.

## Import shared helpers through the core aliases

The engine and its shared test helpers live in the `core` git submodule
(`core/tests/…`), **not** in this repository's `tests/` tree. Import them
through the path aliases returned by `resolveCoreAliases()` in
`core/scripts/vite-game-discovery-plugin.ts`, for example:

```ts
import { waitForScene } from '@core-tests/helpers/waitForScene';
```

Do **not** use a relative path such as `../helpers/waitForScene`: there is no
`tests/helpers/` directory in this repository, so the import cannot be resolved
at collection time. Vitest then reports the whole file as a suite import
failure —

```
Failed to import test file tests/e2e/<name>.browser.test.ts:
Failed to resolve import "../helpers/waitForScene"
```

— and every test in that file is lost, not just one. Use a core alias for any
core-owned module; the full map is:

| Alias | Resolves to |
|-------|-------------|
| `@core-engine` | `core/src/core-engine` |
| `@card-system` | `core/src/card-system` |
| `@rule-engine` | `core/src/rule-engine` |
| `@ui` | `core/src/ui` |
| `@ai` | `core/src/ai` |
| `@balance-cards` | `core/src/balance-cards` |
| `@core-scripts` | `core/scripts` |
| `@core-tests` | `core/tests` |
| `@core-gym` | `core/example-games/gym` |

A stale relative helper import in
`tests/e2e/main-street-cheat-smoke.browser.test.ts` was corrected to the
`@core-tests` alias in MS-0MV1HAUPR004REDJ; the file header keeps a short note
so the failure mode is not reintroduced.

## Troubleshooting: ENOSPC (`System limit for number of file watchers reached`)

A full-suite run that fails with `ENOSPC: System limit for number of file
watchers reached` from vite-node CLI subprocesses (spawned by the `unit-cli`
tests) is an **environmental** failure, not a test-code or product-code defect.

The commit under test typically passes the full suite via independent gates
(implement finish + pre-push hook); all individual tests pass when run in
isolation. The trigger is host inotify-watch exhaustion: orphaned long-running
processes (e.g. a hung `npx vitest run --project browser` from a dead session)
plus several long-lived `vite --host` dev servers can consume most of
`fs.inotify.max_user_watches` (default 65536). Each additional worktree adds
recursive watchers on the project root, so with many sibling worktrees a
full-suite run trips the limit mid-collection.

Diagnosis and remediation (no code changes required):

1. Check the watch budget: `cat /proc/sys/fs/inotify/max_user_watches`.
2. Find the top consumers — per-process inotify watch counts can be derived
   from `/proc/<pid>/fdinfo/<fd>` entries of type `anon_inode:inotify`.
3. Kill the orphaned consumer(s) once confirmed hung (parent session dead,
   e.g. `ppid=1`, no output for hours).
4. Re-run the suite; it should be green.

Reference work item: MS-0MVA50KJN009X30C.

