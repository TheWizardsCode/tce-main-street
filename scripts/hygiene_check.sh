#!/usr/bin/env bash
#
# hygiene_check.sh
#
# READ-ONLY host-hygiene detector for worktree / memory / dev-server pressure
# (MS-0MVS0FNLH003VBMW). It reports; it never prunes, never deletes, never
# kills. The approval-gated follow-up procedure lives in
# docs/dev/testing.md § "Host-pressure hygiene runbook".
#
# The three questions it answers:
#
#   1. Worktree inventory — which directories under `.worklog/worktrees/` are
#      *registered* git worktrees (`git worktree list`) and which are
#      *orphaned* leftovers? Each orphan is classified:
#        * `safe-to-prune`  — empty, or contains only the documented
#                             cwd-anchor placeholders an agent writes so a dead
#                             shell's cwd still resolves;
#        * `needs-review`   — contains anything else (a stale checkout, a
#                             broken `.git` link, unknown files): a human must
#                             decide, never this script.
#      Orphans whose path is the current working directory of a *live*
#      process are reported as `in_use` — removing those breaks that shell.
#   2. Memory / swap pressure — `free -m` + `swapon --show`, graded
#      ok/warning/critical (thresholds documented below).
#   3. Dev servers — `vite` dev/preview server processes with age, RSS, cwd
#      and ownership (main checkout / registered worktree / orphaned worktree
#      / stale path), plus listeners on the dev (3000) and preview (4173)
#      ports. `vitest` and `vite-node` runs are not servers and are excluded.
#
# Exit status: 0 always (a report is a successful run; read `warnings`/JSON to
# judge health), 2 on a usage error, 1 when a required input cannot be read.
#
# Usage:
#   scripts/hygiene_check.sh [--json] [--repo-root PATH] [--proc-root PATH]
#                            [--stale-server-hours N] [--help]
#
# Options:
#   --json                 machine-readable output (stable schema, see below)
#   --repo-root PATH       repository to inspect (default: this script's repo)
#   --proc-root PATH       procfs mount to read process cwd from (default /proc)
#   --stale-server-hours N a dev server older than N hours is flagged `stale`
#                          (default 4)
#   --help                 this text
#
# JSON schema (stable keys; consumers parse by key, not position):
#   { "generated_at", "repo_root", "worktrees": { "worktrees_dir",
#       "registered": [{path,head,branch}], "registered_count",
#       "directory_count", "orphaned": [{name,path,classification,entries,
#       in_use,in_use_pids}], "orphaned_count", "safe_to_prune_count",
#       "needs_review_count" },
#     "memory": { "mem_total_mb", "mem_available_mb", "swap_total_mb",
#       "swap_used_mb", "swap_used_pct", "pressure" },
#     "dev_servers": { "port_listeners": [{port,listening}], "processes":
#       [{pid,age_s,rss_mb,cwd,kind,owner,stale,command}], "process_count",
#       "orphaned_count", "stale_count" },
#     "warnings": [ ... ] }
#
# Test seams (used by tests/tooling/hygiene-check.test.ts only). Each replaces
# one external command with a fixture file, so classification is testable
# without touching the host:
#   HYGIENE_WORKTREE_LIST_FILE  replaces `git worktree list --porcelain`
#   HYGIENE_FREE_FILE           replaces `free -m`
#   HYGIENE_SWAPON_FILE         replaces `swapon --show`
#   HYGIENE_PS_FILE             replaces `ps -eo pid=,etimes=,rss=,args=`
#   HYGIENE_SS_FILE             replaces `ss -ltn`
#
# Pressure thresholds (graded from swap use, then memory headroom):
#   critical — swap >= 90 % used, or available RAM < 5 % of total
#   warning  — swap >= 50 % used, or available RAM < 15 % of total
#   ok       — otherwise
#
set -uo pipefail

readonly PROG_NAME="$(basename "$0")"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# cwd-anchor placeholders an agent writes after `git worktree remove` so a
# dead session's shell cwd still resolves. A directory holding only these is
# an inert leftover, safe to prune.
readonly PLACEHOLDER_NAMES=$'.cwd-placeholder\n.cwd-anchor\n.keep\n.recover_cwd\n__session_recreate__.tmp'

readonly DEV_PORT=3000
readonly PREVIEW_PORT=4173

JSON=0
REPO_ROOT="$SCRIPT_DIR/.."
PROC_ROOT="/proc"
STALE_SERVER_HOURS=4

usage() { sed -n '2,/^set -uo pipefail/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//;$d'; }

while [ "$#" -gt 0 ]; do
  case "$1" in
    --json) JSON=1 ;;
    --repo-root) shift; REPO_ROOT="${1:-}" ;;
    --proc-root) shift; PROC_ROOT="${1:-}" ;;
    --stale-server-hours) shift; STALE_SERVER_HOURS="${1:-}" ;;
    --help|-h) usage; exit 0 ;;
    *) echo "$PROG_NAME: unknown argument '$1' (try --help)" >&2; exit 2 ;;
  esac
  shift
done

[ -d "$REPO_ROOT" ] || { echo "$PROG_NAME: repo root '$REPO_ROOT' is not a directory" >&2; exit 1; }
REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)"
case "$STALE_SERVER_HOURS" in
  ''|*[!0-9]*) echo "$PROG_NAME: --stale-server-hours expects a non-negative integer" >&2; exit 2 ;;
esac
readonly REPO_ROOT PROC_ROOT STALE_SERVER_HOURS

WORKTREES_DIR="$REPO_ROOT/.worklog/worktrees"

# ── input gathering (read-only; test seams override the commands) ──────────

worktree_list_out() {
  if [ -n "${HYGIENE_WORKTREE_LIST_FILE:-}" ]; then
    cat "$HYGIENE_WORKTREE_LIST_FILE"
  else
    git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null
  fi
}

free_out() {
  if [ -n "${HYGIENE_FREE_FILE:-}" ]; then cat "$HYGIENE_FREE_FILE"; else free -m; fi
}

swapon_out() {
  if [ -n "${HYGIENE_SWAPON_FILE:-}" ]; then cat "$HYGIENE_SWAPON_FILE"; else swapon --show 2>/dev/null; fi
}

ps_out() {
  if [ -n "${HYGIENE_PS_FILE:-}" ]; then
    cat "$HYGIENE_PS_FILE"
  else
    ps -eo pid=,etimes=,rss=,args= 2>/dev/null
  fi
}

ss_out() {
  if [ -n "${HYGIENE_SS_FILE:-}" ]; then cat "$HYGIENE_SS_FILE"; else ss -ltn 2>/dev/null; fi
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/ }"
  s="${s//$'\n'/ }"
  s="${s//$'\r'/ }"
  printf '%s' "$s"
}

# Live process cwds, binned by worktree directory name, built with a single
# `find` (no fork per process) from the procfs mount. A cwd *inside* a
# candidate (e.g. `<orphan>/src`) bins to the candidate as well, so a shell
# sitting in a subdirectory of a leftover directory is still reported.
declare -A CWD_PIDS_BY_WTNAME=()
load_proc_cwds() {
  [ -d "$PROC_ROOT" ] || return 0
  local path target pid rest name
  while IFS=$'\t' read -r path target; do
    pid="${path#"$PROC_ROOT"/}"
    pid="${pid%%/*}"
    [ -n "$target" ] || continue
    case "$target" in
      "$WORKTREES_DIR"/*)
        rest="${target#"$WORKTREES_DIR"/}"
        name="${rest%%/*}"
        CWD_PIDS_BY_WTNAME["$name"]="${CWD_PIDS_BY_WTNAME[$name]:-}${CWD_PIDS_BY_WTNAME[$name]:+,}$pid"
        ;;
    esac
  done < <(find "$PROC_ROOT" -maxdepth 2 -name cwd -type l -printf '%p\t%l\n' 2>/dev/null)
}

# ── worktree inventory ─────────────────────────────────────────────────────

declare -a REGISTERED_PATHS=()
declare -a REGISTERED_JSON=()
declare -A REGISTERED_LOOKUP=()

# Append one porcelain entry to the registered lists.
_flush_registered() {
  [ -n "${REGP_PATH:-}" ] || return 0
  local real="$REGP_PATH"
  if [ -d "$real" ]; then real="$(cd "$real" && pwd -P)"; fi
  REGISTERED_PATHS+=("$real")
  REGISTERED_LOOKUP["$real"]=1
  REGISTERED_JSON+=("{\"path\":\"$(json_escape "$real")\",\"head\":\"$(json_escape "${REGP_HEAD:-}")\",\"branch\":\"$(json_escape "${REGP_BRANCH:-}")\"}")
  REGP_PATH=""; REGP_HEAD=""; REGP_BRANCH=""
}

collect_registered() {
  local line
  REGP_PATH=""; REGP_HEAD=""; REGP_BRANCH=""
  while IFS= read -r line; do
    case "$line" in
      "worktree "*) _flush_registered; REGP_PATH="${line#worktree }" ;;
      "HEAD "*) REGP_HEAD="${line#HEAD }" ;;
      "branch "*) REGP_BRANCH="${line#branch }" ;;
      "") _flush_registered ;;
    esac
  done < <(worktree_list_out; echo)
  _flush_registered
}

# Classify one candidate directory: `safe-to-prune` when empty or placeholder
# only, otherwise `needs-review`. Sets CANDS / CAND_CLASS / CAND_INUSE.
classify_directory() {
  local dir="$1"
  local -a entries=()
  local entry name
  shopt -s nullglob dotglob
  for entry in "$dir"/*; do
    entries+=("$(basename "$entry")")
  done
  shopt -u nullglob dotglob

  CAND_ENTRIES_JSON=""
  local e
  for e in "${entries[@]:-}"; do
    [ -n "$e" ] || continue
    if [ -n "$CAND_ENTRIES_JSON" ]; then CAND_ENTRIES_JSON+=","; fi
    CAND_ENTRIES_JSON+="\"$(json_escape "$e")\""
  done

  CAND_CLASS="safe-to-prune"
  for e in "${entries[@]:-}"; do
    [ -n "$e" ] || continue
    if [ "$e" = "." ] || [ "$e" = ".." ]; then continue; fi
    if ! printf '%s\n' "$PLACEHOLDER_NAMES" | grep -qxF -- "$e"; then
      CAND_CLASS="needs-review"
      break
    fi
  done

  CAND_INUSE_PIDS="${CWD_PIDS_BY_WTNAME[$(basename "$dir")]:-}"
}

collect_orphans() {
  local dir name real
  local -a names=()
  if [ -d "$WORKTREES_DIR" ]; then
    shopt -s nullglob
    for dir in "$WORKTREES_DIR"/*/; do
      names+=("$(basename "$dir")")
    done
    shopt -u nullglob
  fi
  ORPHAN_COUNT=0
  SAFE_COUNT=0
  REVIEW_COUNT=0
  DIRECTORY_COUNT="${#names[@]}"
  ORPHAN_JSON=""
  ORPHAN_WARNINGS=()

  for name in "${names[@]:-}"; do
    [ -n "$name" ] || continue
    dir="$WORKTREES_DIR/$name"
    real="$(cd "$dir" && pwd -P)"
    if [ -n "${REGISTERED_LOOKUP[$real]:-}" ]; then continue; fi

    classify_directory "$real"
    ORPHAN_COUNT=$((ORPHAN_COUNT + 1))
    [ "$CAND_CLASS" = "safe-to-prune" ] && SAFE_COUNT=$((SAFE_COUNT + 1))
    [ "$CAND_CLASS" = "needs-review" ] && REVIEW_COUNT=$((REVIEW_COUNT + 1))

    local inuse=false
    local pids_json="[]"
    if [ -n "$CAND_INUSE_PIDS" ]; then
      inuse=true
      pids_json="[$(printf '%s' "$CAND_INUSE_PIDS" | tr ',' '\n' | sort -n | sed 's/.*/"&"/' | paste -sd ',' -)]"
      ORPHAN_WARNINGS+=("orphaned worktree directory '$name' is the cwd of live process(es) $CAND_INUSE_PIDS — do not remove")
    fi
    ORPHAN_JSON+="${ORPHAN_JSON:+,}{\"name\":\"$(json_escape "$name")\",\"path\":\"$(json_escape "$real")\",\"classification\":\"$CAND_CLASS\",\"entries\":[$CAND_ENTRIES_JSON],\"in_use\":$inuse,\"in_use_pids\":$pids_json}"
  done
}

# ── memory / swap pressure ─────────────────────────────────────────────────

mem_total_mb=0 mem_available_mb=0 swap_total_mb=0 swap_used_mb=0
swap_used_pct=0 pressure="ok"

collect_memory() {
  local free_text
  free_text="$(free_out)"
  read -r mem_total_mb mem_available_mb swap_total_mb swap_used_mb < <(
    printf '%s\n' "$free_text" | awk '
      /^Mem:/  { mt = $2; ma = $NF }
      /^Swap:/ { st = $2; su = $3 }
      END      { printf "%d %d %d %d\n", mt + 0, ma + 0, st + 0, su + 0 }'
  )
  case "$mem_total_mb$mem_available_mb$swap_total_mb$swap_used_mb" in
    ''|*[!0-9]*) echo "$PROG_NAME: cannot parse memory figures from 'free -m'" >&2; exit 1 ;;
  esac
  [ "$swap_total_mb" -gt 0 ] && swap_used_pct=$(( swap_used_mb * 100 / swap_total_mb ))
  local avail_pct=100
  [ "$mem_total_mb" -gt 0 ] && avail_pct=$(( mem_available_mb * 100 / mem_total_mb ))

  if [ "$swap_used_pct" -ge 90 ] || [ "$avail_pct" -lt 5 ]; then
    pressure="critical"
  elif [ "$swap_used_pct" -ge 50 ] || [ "$avail_pct" -lt 15 ]; then
    pressure="warning"
  else
    pressure="ok"
  fi
}

# ── dev servers ────────────────────────────────────────────────────────────

is_dev_server_command() {
  local cmd="$1"
  # Test runners are not servers; `sh -c`/`npm run` wrappers are the server's
  # parent shells, not the memory holder, so only the real process is reported.
  [[ "$cmd" == *vitest* ]] && return 1
  [[ "$cmd" == *vite-node* ]] && return 1
  [[ "$cmd" =~ ^(/[^ ]*/)?(sh|bash|npm|npx)[[:space:]] ]] && return 1
  [[ "$cmd" =~ (^|[[:space:]/])vite([[:space:]]|$) ]]
}

owner_of_cwd() {
  local cwd="$1" p best=""
  if [ -z "$cwd" ] || [ ! -d "$cwd" ]; then echo "stale-path"; return; fi
  # Longest registered prefix wins: the main checkout is itself "registered",
  # so a plain prefix test would mislabel every worktree under it.
  for p in "${REGISTERED_PATHS[@]:-}"; do
    [ -n "$p" ] || continue
    if [ "$cwd" = "$p" ] || [[ "$cwd" == "$p"/* ]]; then
      if [ "${#p}" -gt "${#best}" ]; then best="$p"; fi
    fi
  done
  # A cwd under the worktrees dir is only "registered" when a *registered*
  # worktree (not the checkout that contains it) is the longest match.
  case "$cwd" in
    "$WORKTREES_DIR"/*)
      if [ -n "$best" ] && [ "$best" != "$REPO_ROOT" ]; then
        echo "registered-worktree"
      else
        echo "orphaned-worktree"
      fi
      return
      ;;
  esac
  if [ -n "$best" ]; then
    if [ "$best" = "$REPO_ROOT" ]; then echo "main-checkout"; else echo "registered-worktree"; fi
    return
  fi
  echo "external"
}

DEV_JSON="" DEV_COUNT=0 DEV_ORPHAN_COUNT=0 DEV_STALE_COUNT=0
collect_dev_servers() {
  local pid age rss rest cmd cwd owner kind stale rss_mb
  local stale_after=$(( STALE_SERVER_HOURS * 3600 ))
  while IFS=$'\t' read -r pid age rss cmd; do
    [ -n "${pid:-}" ] || continue
    case "$pid$age$rss" in ''|*[!0-9]*) continue ;; esac
    is_dev_server_command "$cmd" || continue

    cwd=""
    if [ -L "$PROC_ROOT/$pid/cwd" ]; then
      cwd="$(readlink "$PROC_ROOT/$pid/cwd" 2>/dev/null || true)"
    fi
    owner="$(owner_of_cwd "$cwd")"
    kind="dev"
    [[ "$cmd" == *preview* ]] && kind="preview"
    stale=false
    [ "$age" -ge "$stale_after" ] && [ "$STALE_SERVER_HOURS" -gt 0 ] && stale=true
    rss_mb=$(( rss / 1024 ))

    DEV_COUNT=$(( DEV_COUNT + 1 ))
    case "$owner" in orphaned-worktree|stale-path) DEV_ORPHAN_COUNT=$(( DEV_ORPHAN_COUNT + 1 )) ;; esac
    [ "$stale" = true ] && DEV_STALE_COUNT=$(( DEV_STALE_COUNT + 1 ))
    DEV_JSON+="${DEV_JSON:+,}{\"pid\":$pid,\"age_s\":$age,\"rss_mb\":$rss_mb,\"cwd\":\"$(json_escape "$cwd")\",\"kind\":\"$kind\",\"owner\":\"$owner\",\"stale\":$stale,\"command\":\"$(json_escape "$(printf '%s' "$cmd" | cut -c1-160)")\"}"
  done < <(
    # Normalise `ps` rows to "pid<TAB>etimes<TAB>rss<TAB>args" (fixtures already are).
    ps_out | awk '{ if (NF >= 4) { pid=$1; age=$2; rss=$3; $1=""; $2=""; $3=""; sub(/^[ \t]+/, ""); printf "%s\t%s\t%s\t%s\n", pid, age, rss, $0 } }'
  )

  LISTENERS_JSON=""
  local port listening
  for port in "$DEV_PORT" "$PREVIEW_PORT"; do
    listening=false
    if printf '%s\n' "$(ss_out)" | grep -qE "[:.]$port[[:space:]]"; then listening=true; fi
    LISTENERS_JSON+="${LISTENERS_JSON:+,}{\"port\":$port,\"listening\":$listening}"
  done
}

# ── report ─────────────────────────────────────────────────────────────────

load_proc_cwds
collect_registered
collect_orphans
collect_memory
collect_dev_servers

WARNINGS_JSON=""
WARNINGS=()
add_warning() {
  WARNINGS+=("$1")
  WARNINGS_JSON+="${WARNINGS_JSON:+,}\"$(json_escape "$1")\""
}

if [ "$ORPHAN_COUNT" -gt 0 ]; then
  add_warning "$ORPHAN_COUNT orphaned worktree director(ies) under .worklog/worktrees ($SAFE_COUNT safe-to-prune, $REVIEW_COUNT needs-review) — see docs/dev/testing.md"
fi
for w in "${ORPHAN_WARNINGS[@]:-}"; do [ -n "$w" ] && add_warning "$w"; done
case "$pressure" in
  critical) add_warning "memory pressure CRITICAL: swap ${swap_used_pct}% used, ${mem_available_mb} MB RAM available" ;;
  warning) add_warning "memory pressure WARNING: swap ${swap_used_pct}% used, ${mem_available_mb} MB RAM available" ;;
esac
if [ "$DEV_ORPHAN_COUNT" -gt 0 ]; then
  add_warning "$DEV_ORPHAN_COUNT dev server process(es) whose cwd is an orphaned worktree or a stale path — triage before restarting"
fi
if [ "$DEV_STALE_COUNT" -gt 0 ]; then
  add_warning "$DEV_STALE_COUNT dev server process(es) older than ${STALE_SERVER_HOURS}h — confirm you still own them"
fi

GENERATED_AT="$(date -Is)"

if [ "$JSON" -eq 1 ]; then
  printf '{\n'
  printf '  "generated_at": "%s",\n' "$GENERATED_AT"
  printf '  "repo_root": "%s",\n' "$(json_escape "$REPO_ROOT")"
  printf '  "worktrees": {\n'
  printf '    "worktrees_dir": "%s",\n' "$(json_escape "$WORKTREES_DIR")"
  printf '    "registered": [%s],\n' "$(IFS=,; printf '%s' "${REGISTERED_JSON[*]:-}")"
  printf '    "registered_count": %d,\n' "${#REGISTERED_PATHS[@]}"
  printf '    "directory_count": %d,\n' "$DIRECTORY_COUNT"
  printf '    "orphaned": [%s],\n' "$ORPHAN_JSON"
  printf '    "orphaned_count": %d,\n' "$ORPHAN_COUNT"
  printf '    "safe_to_prune_count": %d,\n' "$SAFE_COUNT"
  printf '    "needs_review_count": %d\n' "$REVIEW_COUNT"
  printf '  },\n'
  printf '  "memory": {"mem_total_mb": %d, "mem_available_mb": %d, "swap_total_mb": %d, "swap_used_mb": %d, "swap_used_pct": %d, "pressure": "%s"},\n' \
    "$mem_total_mb" "$mem_available_mb" "$swap_total_mb" "$swap_used_mb" "$swap_used_pct" "$pressure"
  printf '  "dev_servers": {\n'
  printf '    "port_listeners": [%s],\n' "${LISTENERS_JSON:-}"
  printf '    "processes": [%s],\n' "$DEV_JSON"
  printf '    "process_count": %d,\n' "$DEV_COUNT"
  printf '    "orphaned_count": %d,\n' "$DEV_ORPHAN_COUNT"
  printf '    "stale_count": %d\n' "$DEV_STALE_COUNT"
  printf '  },\n'
  printf '  "warnings": [%s]\n' "$WARNINGS_JSON"
  printf '}\n'
  exit 0
fi

echo "Host hygiene report — $REPO_ROOT"
echo "generated: $GENERATED_AT"
echo
echo "Worktrees (.worklog/worktrees)"
echo "  registered git worktrees : ${#REGISTERED_PATHS[@]}"
echo "  directories present      : $DIRECTORY_COUNT"
echo "  orphaned (unregistered)  : $ORPHAN_COUNT (safe-to-prune $SAFE_COUNT, needs-review $REVIEW_COUNT)"
if [ "$ORPHAN_COUNT" -gt 0 ]; then
  # Loop tolerant of a final line without a trailing newline (`read` returns
  # non-zero at EOF while still populating the variable).
  while IFS= read -r entry || [ -n "$entry" ]; do
    [ -n "$entry" ] || continue
    name="$(printf '%s' "$entry" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')"
    cls="$(printf '%s' "$entry" | sed -n 's/.*"classification":"\([^"]*\)".*/\1/p')"
    inuse="$(printf '%s' "$entry" | sed -n 's/.*"in_use":\([a-z]*\).*/\1/p')"
    printf '    - %s [%s]%s\n' "$name" "$cls" "$([ "$inuse" = true ] && echo ' IN USE — do not remove')"
  done < <(printf '%s' "$ORPHAN_JSON" | sed 's/},{/}\n{/g')
fi
echo
echo "Memory"
echo "  RAM   : ${mem_available_mb} MB available of ${mem_total_mb} MB"
echo "  swap  : ${swap_used_mb} MB used of ${swap_total_mb} MB (${swap_used_pct}%)"
echo "  grade : $pressure"
if [ -n "$(swapon_out)" ]; then
  echo "  devices:"
  printf '%s\n' "$(swapon_out)" | sed 's/^/    /'
fi
echo
echo "Dev servers"
echo "  processes: $DEV_COUNT (orphaned $DEV_ORPHAN_COUNT, stale $DEV_STALE_COUNT)"
if [ "$DEV_COUNT" -gt 0 ]; then
  while IFS= read -r entry || [ -n "$entry" ]; do
    [ -n "$entry" ] || continue
    pid="$(printf '%s' "$entry" | sed -n 's/.*"pid":\([0-9]*\).*/\1/p')"
    owner="$(printf '%s' "$entry" | sed -n 's/.*"owner":"\([^"]*\)".*/\1/p')"
    age="$(printf '%s' "$entry" | sed -n 's/.*"age_s":\([0-9]*\).*/\1/p')"
    rss="$(printf '%s' "$entry" | sed -n 's/.*"rss_mb":\([0-9]*\).*/\1/p')"
    printf '    - pid %s  %ss  %sMB  %s\n' "$pid" "$age" "$rss" "$owner"
  done < <(printf '%s' "$DEV_JSON" | sed 's/},{/}\n{/g')
fi
echo "  ports: 3000=$([ -n "$(printf '%s' "$LISTENERS_JSON" | grep -o '"port":3000,"listening":true')" ] && echo listening || echo closed) 4173=$([ -n "$(printf '%s' "$LISTENERS_JSON" | grep -o '"port":4173,"listening":true')" ] && echo listening || echo closed)"
echo
if [ "${#WARNINGS[@]}" -eq 0 ]; then
  echo "Warnings: none"
else
  echo "Warnings:"
  for w in "${WARNINGS[@]}"; do echo "  - $w"; done
fi
echo
echo "This script is read-only. The approval-gated cleanup procedure is in"
echo "docs/dev/testing.md § Host-pressure hygiene runbook."
