#!/bin/sh
# Opt-in pre-push reminder for the Main Street storyline validator.
#
# Installs a NON-BLOCKING reminder into this checkout's local pre-push hook so
# that `npm run validate:storylines` is run (and its result shown) before a
# push. This is deliberately opt-in:
#
#   * it is never installed automatically;
#   * it does not block a push (a failure is printed as a warning only), so an
#     unrelated push never depends on the validator passing;
#   * it is local to the checkout (`.git/hooks`), not committed, so it does not
#     affect other clones or CI.
#
# Usage:
#   sh src/scripts/install-storylines-pre-push.sh            # install
#   sh src/scripts/install-storylines-pre-push.sh --remove   # uninstall
#
# The reminder invokes `npm run validate:storylines` and prints its output. If
# the validator cannot run (e.g. dependencies not installed) the push still
# proceeds.
set -e

MARKER="# storyline-pre-push-reminder"
REMINDER_BLOCK="\
${MARKER}
if [ -f package.json ] && command -v npm >/dev/null 2>&1; then
  echo 'storylines: running validate:storylines (opt-in reminder, non-blocking)...' >&2
  npm run --silent validate:storylines || echo 'storylines: validator reported issues (non-blocking reminder)' >&2
fi"

# Resolve the hooks directory (respect an existing core.hooksPath, else .git/hooks).
hooks_path="$(git config --get core.hooksPath 2>/dev/null || true)"
if [ -n "$hooks_path" ]; then
  # core.hooksPath is repo-relative unless absolute.
  case "$hooks_path" in
    /*) hooks_dir="$hooks_path" ;;
    *)  hooks_dir="$(git rev-parse --show-toplevel)/$hooks_path" ;;
  esac
else
  git_dir="$(git rev-parse --git-common-dir 2>/dev/null || echo .git)"
  case "$git_dir" in
    /*) hooks_dir="$git_dir/hooks" ;;
    *)  hooks_dir="$(git rev-parse --show-toplevel)/$git_dir/hooks" ;;
  esac
fi

hook_file="$hooks_dir/pre-push"
mkdir -p "$hooks_dir"

if [ "$1" = "--remove" ]; then
  if [ -f "$hook_file" ] && grep -q "$MARKER" "$hook_file"; then
    # Delete the marker line and the 4 lines that follow it.
    tmp="$(mktemp)"
    awk -v marker="$MARKER" '
      $0 == marker { skip = 5; next }
      skip > 0 { skip--; next }
      { print }
    ' "$hook_file" > "$tmp"
    mv "$tmp" "$hook_file"
    chmod +x "$hook_file"
    echo "storylines: pre-push reminder removed from $hook_file"
  else
    echo "storylines: no pre-push reminder found in $hook_file"
  fi
  exit 0
fi

if [ -f "$hook_file" ] && grep -q "$MARKER" "$hook_file"; then
  echo "storylines: pre-push reminder already installed in $hook_file"
  exit 0
fi

if [ ! -f "$hook_file" ]; then
  printf '#!/bin/sh\n' > "$hook_file"
fi
# Append the reminder (idempotent thanks to the marker check above).
printf '\n%s\n' "$REMINDER_BLOCK" >> "$hook_file"
chmod +x "$hook_file"
echo "storylines: opt-in pre-push reminder installed in $hook_file"
echo "storylines: it is non-blocking; remove it with: sh src/scripts/install-storylines-pre-push.sh --remove"
