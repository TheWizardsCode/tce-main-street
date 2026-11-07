# AC1 verification: the finish gate commits the composition it tested

Verification record for **MS-0MVSB1OVW00178W6** AC1 (child **MS-0MVTEVK8S0078QC4**).
Verification only: no framework code is edited from this repository
(repository boundary, parent Q1=A). The framework fix this record verifies lives
in **SorraAgents**.

## What was verified

An item that does not change engine composition must never carry the
build-originated engine re-pin into its commit, and the composition the finish
gate tests must equal the composition the commit records. Concretely, for a
worktree whose committed `configs/engine-pin.json` lags the engine `dev` tip:

1. `npm run build` still runs `engine:sync`, which advances `./core` and
   rewrites/stages the pin plus the gitlink (pin policy preserved).
2. `implement.py finish` restores both paths to the pre-build (`HEAD`)
   composition before the gate runs, so the suite tests the composition the
   commit will record.
3. The resulting commit contains neither `configs/engine-pin.json` nor the
   `core` gitlink, and its recorded pin/gitlink equal the pre-commit `HEAD`
   values.
4. Every gate verdict records the composed engine SHA (resolved submodule
   checkout commit vs the gitlink the tree records) and the cache provenance
   (`cached` / `cache_entry` — suite ran versus cache-served).

## Framework change this record relies on (SorraAgents)

| Item | Landed as | Scope |
|---|---|---|
| `SA-0MVL2NH1G0094FA2` | nine children (`efc2dbdd0` … `b50ccedce`) | gate tests the would-be-commit tree (temporary index), verdict provenance (tree fingerprint + cache binding), abort invariants |
| `SA-0MVZE164P0048306` | **`2c81fdd96`** (`skill/implement/scripts/implement.py`, `skill/implement/tests/test_finish_gate_build_churn.py`, `docs/dev/implement-skill-reference.md`) | build-originated chain exclusion, composition restore before the gate, composed-engine SHA in every verdict |

Both are on the SorraAgents `dev` branch and merged into `main`; the installed
runtime copy at `~/.pi/agent/skills/implement` carries the change.

## Fixture proof (git fixture with a real submodule)

`skill/implement/tests/test_finish_gate_build_churn.py` builds a hermetic
game-repo fixture with a **real local submodule**: the seed commit records the
gitlink and pin at engine `v1`, then `_advance_engine()` moves the submodule
checkout to `v2` and rewrites/stages the pin — exactly the historical
`tce-main-street` shape, where the submodule checkout `HEAD` differs from the
recorded gitlink. Tests, in that file:

- `test_build_originated_pin_and_gitlink_are_not_committed` — the
  source-unchanged item's commit contains neither the pin nor the gitlink
  (`_committed_paths() == []`), the checkout is back at the recorded gitlink,
  and the working pin still records `v1`.
- `test_item_originated_composition_change_is_committed` — the exclusion is
  conditional on origin: a pin/gitlink already in the item's change set is
  committed.
- `test_tested_composition_equals_committed_composition` — the fixture suite
  asserts `submodule HEAD == recorded gitlink`, so a green verdict proves the
  restore ran **before** the gate.
- `test_verdict_and_comment_record_the_composed_engine_sha` — the gate
  attempt, the `build_churn` step and the completion comment all carry the
  composed engine SHA.
- `test_compute_git_state_still_sees_the_pin_content` — the cache key is not
  relaxed.
- `test_path_modified_by_the_item_and_the_build_is_never_restored`,
  `test_unrestorable_gitlink_fails_finish_closed`,
  `test_repo_without_submodules_is_unchanged` — mixed-path safety, fail-closed
  restore and the no-op for repositories without submodules.

## Live proof on this repository

Reproduced by running the framework's own finish sequence
(`run_build` → `_exclude_build_originated_churn` → `git_commit`, the exact
functions `phase_finish` uses) in a throwaway worktree of this repository
created at **`99489ad8`**, whose committed pin and gitlink (`21bedf7a`) lag the
engine `dev` tip (`2305f888`). The probe worktree was reset and removed
afterwards; nothing was pushed. Probe JSON: `/tmp/ms0mvtevk8-ac1-probe.json`;
build log: `/tmp/ms0mvtevk8-ac1-probe-run.log`.

| Stage | `configs/engine-pin.json` | `HEAD:core` | `core` checkout | `git status` |
|---|---|---|---|---|
| pre-build (`99489ad8`) | `21bedf7a` | `21bedf7a` | `21bedf7a` | clean + the item's docs file |
| after `npm run build` (exit 0) | `2305f888` | `21bedf7a` | `2305f888` | `M configs/engine-pin.json`, `M core` (staged by `engine:sync`) |
| after the composition exclusion | `21bedf7a` | `21bedf7a` | `21bedf7a` | only the item's docs file |

Build output (the pin policy in action — `npm run build` still syncs):

```
engine:sync: core updated 21bedf7a8c → 2305f888d0
engine:sync: engine pin configs/engine-pin.json 21bedf7a8c → 2305f888d0 (staged with the core gitlink)
```

Composition-exclusion step of the finish report:

```json
{
  "baseline_dirty_paths": [],
  "build_originated": ["configs/engine-pin.json", "core"],
  "item_modified_during_build": [],
  "restored": [
    {"path": "configs/engine-pin.json", "kind": "file", "restored": true},
    {"path": "core", "kind": "submodule", "restored": true, "commit": "21bedf7a8c25f68c98ccddd0ad6c96a09bb9e88a"}
  ],
  "excluded_from_commit": ["configs/engine-pin.json", "core"],
  "restore_failed": [],
  "success": true,
  "composed_engine": {
    "submodules": [
      {
        "submodule": "core",
        "commit": "21bedf7a8c25f68c98ccddd0ad6c96a09bb9e88a",
        "recorded_gitlink": "21bedf7a8c25f68c98ccddd0ad6c96a09bb9e88a",
        "source": "HEAD",
        "matches_recorded": true
      }
    ],
    "composition": "submodules"
  }
}
```

Resulting commit `75b59d36` (parent `99489ad8`) contains **only** the item's
documentation file:

```
 docs/dev/analysis/ac1-finish-gate-composition-verification.md | 3 +++
 1 file changed, 3 insertions(+)
```

and its recorded composition equals the pre-commit `HEAD` values — pin and
gitlink both `21bedf7a8c25f68c98ccddd0ad6c96a09bb9e88a`, i.e. no
`engine:sync` churn in the commit.

Scope of this probe: it exercises the build, the exclusion and the commit. It
does not push or mutate the work item, and it does not run the gate suite —
those execute in this item's own `implement.py finish`, whose verdict JSON
(composed engine SHA plus cache provenance) is recorded on the work item.

## Cache key unchanged (no relaxation)

`compute_git_state` (`skill/test_cache.py`) is still `HEAD` plus the content of
every dirty path: the SorraAgents fix `2c81fdd96` does not touch
`skill/test_cache.py` at all (its most recent change is `9abe47edb`, a
different item), and
`test_compute_git_state_still_sees_the_pin_content` pins the behaviour. A
pin/gitlink write therefore still changes the cache key, and
`SA-0MVCTZRZD004CE3L` remains the guard against a green entry recorded against
a different engine being served.

## Pin policy (no regression)

- `npm run build` still starts with `engine:sync` (probe log above) and leaves
  the pin and the gitlink coherent at the engine tip — the finish gate restores
  them only inside its own commit path.
- `build:release` still starts with `engine:verify`; `engine:sync` is
  unchanged (canonical in Tableau-Card-Engine).
- `tests/main-street/engine-submodule-sync.test.ts` remains the release
  pin-contract guard and passes in this item's finish gate (full-suite scope:
  a documentation-only change has no changed-scope subset — see
  `changed_scope_selection`).

## Observations and limits

- A lagging pin can make the *build itself* fail before the gate: at
  `a6ef0b7d` (pinned `21bedf7a`, source still using the engine's pre-rename
  two-way choice flag — one of the five retired legacy identifiers tracked by
  `tests/main-street/legacy-choice-identifiers.test.ts`, deliberately not
  spelled out here so that guard's empty allowlist stays empty), `engine:sync`
  advanced the engine past the rename and `tsc --noEmit` failed. That is a
  pre-existing property of syncing at build time, not of the exclusion (which
  runs after a successful build); the probe therefore used `99489ad8`, which
  is compatible with the engine tip. The condition, its stdout diagnostic and
  the two remedies are now published in
  [Testing § "Limitation: a lagging pin can fail the build before the
  gate"](../testing.md#limitation-a-lagging-pin-can-fail-the-build-before-the-gate)
  so this record is no longer its only description. The finish report and the
  build-failure comment now name both SHAs for this condition — verified live in
  [AC1 verification: a failed build reports a lagging engine
  pin](ac1-finish-gate-engine-lag-verification.md).
- The exclusion is conditional on origin: a pin/gitlink the item itself
  changed before the build is committed, never restored.
- Restore is fail-closed: an unrestorable gitlink refuses finish with an
  actionable message instead of committing a composition the item did not
  originate.
