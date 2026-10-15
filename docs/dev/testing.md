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
