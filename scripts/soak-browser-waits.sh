#!/usr/bin/env bash
#
# soak-browser-waits.sh
#
# Soak harness proving the load-tolerant browser wait budgets adopted in
# tests/main-street/MainStreetScene.browser.test.ts (parent work item
# MS-0MVK2ACLN004VVIJ). Runs the project's canonical browser runner
# repeatedly and records per-run evidence, so "20 consecutive local runs
# pass, including at least one under imposed CPU load" is proven by a
# repeatable, policy-compliant soak instead of an anecdote.
#
# Each run invokes the real gate's runner (retry-once + hang bound, so the
# retry/hang semantics match the dev-push gate):
#
#   npx tsx core/scripts/vitest-run-with-retry.ts --project browser \
#     tests/main-street/MainStreetScene.browser.test.ts
#
# Behaviour:
#   * --runs N   consecutive runs (default 20), fail-fast on the first
#                failing run (that run's full output is printed and kept).
#   * --load     spin up $(nproc) CPU burners for the whole soak, record
#                load averages before/during/after, and tear the burners
#                down on exit (trap — also fires on SIGINT/SIGTERM).
#                SOAK_BURNERS overrides the count (default $(nproc); a
#                smaller count is the documented sub-nproc probe for a host
#                whose ambient load already exceeds one runnable task per
#                core — see docs/dev/testing.md "Measured envelope")
#                (SOAK_BURNERS must be >= 1 to take effect).
#   * A markdown summary of per-run wall time, pass/fail and peak load
#     average is written to
#     results/soak-browser-waits-<timestamp>.md (results/ is gitignored —
#     .gitignore line 78 — so the evidence file is a local artifact, and
#     the evidence itself is recorded on the work items).
#   * Exit code 0 only when every run passed; 1 on the first failing run.
#
# Env override:
#   SOAK_RUNNER_CMD="<cmd>" replaces the per-run command (harness
#   self-validation only — evidence runs always use the real runner).
#
# Usage:
#   scripts/soak-browser-waits.sh [--runs N] [--load]
#
set -uo pipefail

readonly PROG_NAME="$(basename "$0")"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DEFAULT_RUNS=20
RUNNER=(
  npx tsx core/scripts/vitest-run-with-retry.ts
  --project browser
  tests/main-street/MainStreetScene.browser.test.ts
)

RUNS="$DEFAULT_RUNS"
LOAD=0
RESULTS_DIR="$REPO_ROOT/results"

# Optional runner override for harness self-validation / maintenance: a
# single shell command string executed instead of the canonical browser
# runner (e.g. SOAK_RUNNER_CMD="bash -c 'exit 0'"). Not used by the soak
# evidence runs, which use the real gate runner.
if [[ -n "${SOAK_RUNNER_CMD:-}" ]]; then
  read -r -a RUNNER <<< "$SOAK_RUNNER_CMD"
fi

usage() {
  cat <<EOF
Usage: $PROG_NAME [--runs N] [--load]

Runs the canonical browser runner ($DEFAULT_RUNS times by default) as a
soak, optionally under \$(nproc) CPU burners, and writes a markdown summary
to results/soak-browser-waits-<timestamp>.md.

Options:
  --runs N      Number of consecutive runs (default $DEFAULT_RUNS)
  --load        Impose CPU load (\$(nproc) burners) for the whole soak
  -h, --help    Show this help and exit

Exit codes: 0 = every run passed; 1 = a run failed (or the harness errored);
2 = invalid arguments.
EOF
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runs)
      RUNS="${2:-}"
      shift 2
      ;;
    --runs=*)
      RUNS="${1#--runs=}"
      shift
      ;;
    --load)
      LOAD=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "$PROG_NAME: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! [[ "$RUNS" =~ ^[0-9]+$ ]] || [[ "$RUNS" -lt 1 ]]; then
  echo "$PROG_NAME: invalid --runs value '$RUNS' (expected a positive integer)" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
now_ms() {
  # Milliseconds since epoch, derived from ONE date invocation (a single
  # timespec, so seconds and nanoseconds are consistent). uutils coreutils
  # ignores the %3N truncation width and emits full nanoseconds, so
  # decompose explicitly; the leading-zero safe 10# forces decimal arithmetic
  # (bash would read "08x" as octal otherwise).
  local raw s ns
  raw="$(date +%s%N)"
  s="${raw:0:10}"
  ns="${raw:10}"
  printf '%s' $(( s * 1000 + 10#${ns:0:3} ))
}

# 1-minute load average (first field of /proc/loadavg).
loadavg() { awk '{print $1}' /proc/loadavg; }

# Wall-clock difference in seconds, one decimal place. Integer arithmetic on
# the ms timestamps first: 13-digit values exceed awk's double precision, so
# subtracting them directly in awk yields nonsense (even negative) results.
elapsed_secs() {
  local t0="$1" t1="$2" ms
  ms=$(( t1 - t0 ))
  printf '%d.%d' $(( ms / 1000 )) $(( (ms % 1000) / 100 ))
}

# ---------------------------------------------------------------------------
# CPU burners + load sampler (teared down via the EXIT trap)
# ---------------------------------------------------------------------------
BURNER_PIDS=()
SAMPLER_PID=""
SAMPLER_FILE=""

start_load() {
  local cores
  # $(nproc) burners by default, so the imposed load genuinely saturates the
  # host. SOAK_BURNERS exists so the harness self-validation can run a cheap
  # 2-burner load without perturbing a shared build host, and so an evidence
  # run can probe a sub-nproc load on a host that other suites already keep
  # oversubscribed (docs/dev/testing.md "Measured envelope").
  cores="${SOAK_BURNERS:-$(nproc)}"
  BURNERS_STARTED="$cores"
  echo "[soak] imposing load: $cores CPU burner(s)"
  for ((i = 0; i < cores; i++)); do
    yes >/dev/null &
    BURNER_PIDS+=("$!")
  done
}

stop_load() {
  if [[ ${#BURNER_PIDS[@]} -gt 0 ]]; then
    kill "${BURNER_PIDS[@]}" 2>/dev/null || true
    wait "${BURNER_PIDS[@]}" 2>/dev/null || true
    BURNER_PIDS=()
  fi
}

start_sampler() {
  SAMPLER_FILE="$(mktemp "${TMPDIR:-/tmp}/soak-load-XXXXXX")"
  (
    while true; do
      printf '%s %s\n' "$(now_ms)" "$(loadavg)" >>"$SAMPLER_FILE"
      sleep 1
    done
  ) &
  SAMPLER_PID=$!
}

stop_sampler() {
  if [[ -n "$SAMPLER_PID" ]]; then
    kill "$SAMPLER_PID" 2>/dev/null || true
    wait "$SAMPLER_PID" 2>/dev/null || true
    SAMPLER_PID=""
  fi
}

cleanup() {
  stop_load
  stop_sampler
  if [[ -n "$SAMPLER_FILE" && -f "$SAMPLER_FILE" ]]; then
    rm -f "$SAMPLER_FILE"
  fi
}
trap cleanup EXIT

# Peak load average sampled within the [t0, t1] window (ms timestamps).
# Falls back to the most recent sample at or before t1 when the window is
# shorter than the sampling interval (no sample landed inside it), so a fast
# run still reports the prevailing load instead of a misleading 0.00.
peak_load_since() {
  local t0="$1" t1="$2"
  [[ -n "$SAMPLER_FILE" && -f "$SAMPLER_FILE" ]] || { echo "0.00"; return; }
  awk -v t0="$t0" -v t1="$t1" '
    # Coerce to numbers explicitly: 13-digit values arrive as strings and a
    # bare comparison would be lexicographic in some awk implementations.
    ($1 + 0) >= (t0 + 0) && ($1 + 0) <= (t1 + 0) {
      if (($2 + 0) > max) max = $2 + 0
    }
    ($1 + 0) <= (t1 + 0) { last = $2 + 0 }
    END {
      if (max == "") max = (last == "" ? 0 : last)
      printf "%.2f", max
    }
  ' "$SAMPLER_FILE"
}

# ---------------------------------------------------------------------------
# Summary (markdown written to results/soak-browser-waits-<ts>.md)
# ---------------------------------------------------------------------------
write_summary() {
  local t1_now peak_during
  : "${LOAD_AFTER:=$(loadavg)}"
  t1_now="$(now_ms)"
  peak_during="$(peak_load_since "$SOAK_T0" "$t1_now")"
  {
    echo "# Browser-wait soak: tests/main-street/MainStreetScene.browser.test.ts"
    echo
    echo "- Timestamp: $(date)"
    echo "- Host: $(hostname), $(nproc) cores"
    echo "- Mode: $MODE"
    echo "- Runs: $RUNS (${PASSED} passed, ${FAILED:-0} failed)"
    echo "- Command: ${RUNNER[*]}"
    echo "- Load average before: $LOAD_BEFORE, during-peak: $peak_during, after: $LOAD_AFTER"
    if [[ "$LOAD" -eq 1 ]]; then
      echo "- CPU burners: ${BURNERS_STARTED:-?}"
      echo "- Load average after run(s), before burner teardown: ${LOAD_AFTER_RUNS:-n/a}"
    fi
    echo
    echo "| Run | Status | Wall (s) | Peak load |"
    echo "|-----|--------|----------|-----------|"
    for ((i = 1; i <= RUNS; i++)); do
      echo "| $i | ${run_status[$i]:-?} | ${run_wall[$i]:-?} | ${run_peak[$i]:-?} |"
    done
    echo
    if [[ "${FAILED:-0}" -gt 0 ]]; then
      echo "Result: **FAILED** on run $((PASSED + 1)) — see $run_log for the full output."
    else
      echo "Result: **all $RUNS runs passed.**"
    fi
  } >"$SUMMARY_FILE"
  echo "[soak] summary written: $SUMMARY_FILE"
}

# ---------------------------------------------------------------------------
# Main soak loop
# ---------------------------------------------------------------------------
TS="$(date +%Y%m%d-%H%M%S)"
SUMMARY_FILE="$RESULTS_DIR/soak-browser-waits-$TS.md"
mkdir -p "$RESULTS_DIR"

NPROC="$(nproc)"
MODE="quiet"
LOAD_BEFORE="$(loadavg)"
SOAK_T0="$(now_ms)"

if [[ "$LOAD" -eq 1 ]]; then
  MODE="load"
  start_load
fi
start_sampler
# Give the sampler a moment to land its first reading inside the soak window.
sleep 1

PASSED=0
FAILED=0
run_wall=()
run_peak=()
run_status=()

echo "[soak] mode=$MODE runs=$RUNS cores=$NPROC load_before=$LOAD_BEFORE command=${RUNNER[*]}"

for ((i = 1; i <= RUNS; i++)); do
  run_t0="$(now_ms)"
  run_log="$RESULTS_DIR/soak-browser-waits-$TS-run-$i.log"
  echo "[soak] run $i/$RUNS start load=$(loadavg)"
  if ! "${RUNNER[@]}" >"$run_log" 2>&1; then
    run_t1="$(now_ms)"
    wall="$(elapsed_secs "$run_t0" "$run_t1")"
    peak="$(peak_load_since "$run_t0" "$run_t1")"
    run_status[$i]="FAIL"
    run_wall[$i]="$wall"
    run_peak[$i]="$peak"
    FAILED=1
    echo "[soak] run $i/$RUNS FAILED (wall ${wall}s, peak load $peak) — aborting"
    echo "[soak] --- output from failing run ($run_log) ---"
    cat "$run_log"
    echo "[soak] --- end of failing run output ---"
    PASSED=$((i - 1))
    write_summary
    exit 1
  fi
  run_t1="$(now_ms)"
  wall="$(elapsed_secs "$run_t0" "$run_t1")"
  peak="$(peak_load_since "$run_t0" "$run_t1")"
  run_status[$i]="PASS"
  run_wall[$i]="$wall"
  run_peak[$i]="$peak"
  PASSED=$i
  rm -f "$run_log"   # keep only on failure (above) for triage
  echo "[soak] run $i/$RUNS pass (wall ${wall}s, peak load $peak)"
done

if [[ "$LOAD" -eq 1 ]]; then
  LOAD_AFTER_RUNS="$(loadavg)"
  stop_load
fi
LOAD_AFTER="$(loadavg)"

write_summary
echo "[soak] all $RUNS runs passed (mode=$MODE) — summary: $SUMMARY_FILE"
exit 0
