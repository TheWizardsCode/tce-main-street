# Startup Context Budget — tce-main-street

This repository commits a startup-context budget in
`docs/dev/context-budget.thresholds.json` and enforces it at push time through the
committed `.githooks/pre-push` gate (copied from the engine core).

## What the gate measures

| Component | What it counts |
|-----------|----------------|
| `global_agents` | the global `AGENTS_GLOBAL.md` ruleset |
| `project_agents` | this repository's `AGENTS.md` |
| `skills_prose` | the frontmatter `description` prose of `skill/*/SKILL.md` (with `--include-hidden`) |
| `total` | the sum of the components above |

## Activating the hooks in a fresh clone

`core.hooksPath` is **local git config**, so a fresh clone still needs one
activation step before the committed hooks run:

```bash
git config core.hooksPath .githooks   # or run the framework install_pi.sh
```

## Refreshing the budget

Any commit that changes `AGENTS.md` (or skills prose) must refresh the
thresholds in the same commit:

```bash
./scripts/refresh-context-thresholds.sh          # write refreshed thresholds
./scripts/refresh-context-thresholds.sh --check  # verify only
```

The gate is fail-open only when the measurement tooling or the thresholds
file is absent; with both present a regression fails the push.
