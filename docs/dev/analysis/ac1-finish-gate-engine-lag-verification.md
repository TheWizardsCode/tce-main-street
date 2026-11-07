# AC1 verification: a failed build reports a lagging engine pin

Verification record for **MS-0MVZZ767V009KG3F** AC1 and its AC3 constraint
(child **MS-0MW06G151000YJJQ**). Verification only: no framework code is
edited from this repository (repository boundary, parent Q1=A). The framework
change this record verifies lives in **SorraAgents**.

## What was verified

When `configs/engine-pin.json` lags the engine tracked tip, `npm run build`
starts with `engine:sync`, which advances `./core` **before** `tsc --noEmit` /
`vite build` run. A build failure after that advance is now reported as an
engine-composition condition, naming both SHAs, instead of arriving as an
unexplained compile error. The published limitation this keeps honest is
[Testing § "Limitation: a lagging pin can fail the build before the
gate"](../testing.md#limitation-a-lagging-pin-can-fail-the-build-before-the-gate).

## Framework change (SorraAgents, read-only)

| Item | Landed as | `origin/dev` |
|---|---|---|
| `SA-0MW06FLFR009F0P4` — report a lagging engine pin when the build fails after `engine:sync` | **`e2e2d24ca`** | ancestor of `origin/dev` (`git merge-base --is-ancestor` → true) |

The installed runtime copy (`~/.pi/agent/skills/implement/scripts/implement.py`)
carries the change, so the finish run below executed the reporting code.

## Live proof on this repository

A throwaway worktree was created at **`a6ef0b7d`** (the recorded failing
probe), whose committed pin and gitlink are **`21bedf7a`** and whose source
still uses the engine's retired two-way choice flag (one of the five
identifiers tracked by `tests/main-street/legacy-choice-identifiers.test.ts`,
deliberately not spelled out here so that guard's allowlist stays empty).
`implement.py finish MS-0MW06G151000YJJQ --no-refactor` was run from that
worktree with the item's state file. `engine:sync` advanced the engine to the
then-current tracked tip **`8f40463d`**, `tsc --noEmit` failed, and finish
reported the lag.

Reproduction facts:

| Fact | Value |
|---|---|
| Probe worktree base | `a6ef0b7d` |
| Item's pinned engine (pre-build gitlink) | `21bedf7a8c25f68c98ccddd0ad6c96a09bb9e88a` |
| Engine tracked tip (composed engine the build compiled against) | `8f40463d084cbba490a72873a147802a2cb2137f` |
| Build exit code | `2` |
| Build log | `/tmp/ms-lag-probe-build.log` |
| Finish report JSON | `/tmp/ms-probe-finish.json` |

The build's stdout carried the advance and the pin rewrite:

```
engine:sync: core updated 21bedf7a8c → 8f40463d08
engine:sync: engine pin configs/engine-pin.json 21bedf7a8c → 8f40463d08 (staged with the core gitlink)
src/MainStreetStorylineContentAdapter.ts(88,5): error TS2353: Object literal may only specify known properties, and <retired-flag> does not exist in type 'ContentFieldMapping'.
```

### Finish report fragment

`report["steps"]["build"]["engine_lag"]` carries both SHAs — `advanced: true`
and one `submodules` entry whose `pinned_sha` and `composed_sha` are non-null
and different:

```json
{
  "submodules": [
    {
      "submodule": "core",
      "pinned_sha": "21bedf7a8c25f68c98ccddd0ad6c96a09bb9e88a",
      "composed_sha": "8f40463d084cbba490a72873a147802a2cb2137f",
      "advanced": true
    }
  ],
  "advanced": true
}
```

The same run exited `success: false` with `message: "Build failed (exit code
2)"` and the other build-step keys (`stdout`, `stderr`, `exit_code`,
`skipped`) unchanged — the field is additive.

### Build-failure comment

The run posted comment **`MS-C0MW2AD992007S1OT`** on the work item. It names
both SHAs, reproduces the `engine:sync` line from **stdout**, and includes the
stdout tail (the compile errors):

````
Build failed during finish phase (exit code 2).

**Engine advanced past the item's pin during the build.** The compile errors
below may come from engine APIs this item predates:
- core: build ran against engine 8f40463d084cbba490a72873a147802a2cb2137f; the item pinned 21bedf7a8c25f68c98ccddd0ad6c96a09bb9e88a — the advance is not part of this item's commit

**engine:sync output**
```
engine:sync: core updated 21bedf7a8c → 8f40463d08
engine:sync: engine pin configs/engine-pin.json 21bedf7a8c → 8f40463d08 (staged with the core gitlink)
```
````

The probe worktree was discarded after the run; nothing was pushed from it.

## No false diagnosis

The fixture tests in SorraAgents
`skill/implement/tests/test_finish_gate_engine_lag.py` (landed in `e2e2d24ca`)
pin both directions. Cited by path and name:

- positives — `::test_failed_build_after_engine_advance_reports_the_lag`,
  `::test_failed_build_comment_reproduces_the_engine_sync_line`
- negatives — `::test_failed_build_without_an_advance_reports_no_lag`,
  `::test_repo_without_submodules_reports_no_lag`,
  `::test_item_originated_composition_is_not_a_build_advance`,
  `::test_failed_advance_without_sync_output_is_handled`

A build failure with no advance (or a repo with no submodule) therefore
reports no engine-lag condition, and an item-originated composition change is
never reported as a build advance.

## AC3 constraint: no cache-key or pin-policy change

Commit `e2e2d24ca` touches exactly four files:

```
docs/dev/implement-skill-reference.md              |  56 +++
skill/implement/scripts/implement.py               | 188 ++++++++++-
skill/implement/tests/test_finish_gate_build_churn.py |  12 +-
skill/implement/tests/test_finish_gate_engine_lag.py  | 375 +++++++++++++++++++++
```

It does **not** touch `skill/test_cache.py` (`compute_git_state`, the cache
key), `core/scripts/engine-sync.mjs`, or the pin policy
(`CG-0MVO268500071BPI`). No verify-only / pinned-composition sync was
introduced — the reporting is additive and the build-time sync behaviour is
unchanged.

## Scope of this record

This record covers the framework reporting only. The build-churn exclusion and
the tested-composition guarantee are verified separately in
[AC1 verification: the finish gate commits the composition it
tested](ac1-finish-gate-composition-verification.md).
