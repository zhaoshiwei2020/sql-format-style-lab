#!/usr/bin/env bash
# Blocks internal identifiers (table/db names, cluster domains, business
# words) from entering this public repo's git history.
#
# Modes:
#   tools/check-privacy.sh          -> checks staged additions (pre-commit use)
#   tools/check-privacy.sh --all    -> checks every git-tracked file
#
# Patterns live in .privacy-denylist.local (gitignored, maintained per-machine,
# never itself committed). If that file is missing, this check is a no-op —
# every clone is expected to populate its own denylist locally.

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
denylist="$repo_root/.privacy-denylist.local"

if [[ ! -f "$denylist" ]]; then
  echo "check-privacy: no .privacy-denylist.local found — skipping (nothing to check against)."
  exit 0
fi

mode="staged"
if [[ "${1:-}" == "--all" ]]; then
  mode="all"
fi

hit=0

check_line() {
  local pattern="$1"
  local file="$2"
  local line="$3"
  if grep -Eq -- "$pattern" <<<"$line"; then
    local truncated="${line:0:120}"
    echo "HIT [$pattern] $file: $truncated"
    hit=1
  fi
}

if [[ "$mode" == "staged" ]]; then
  # Walk the staged diff, tracking current file + only newly added lines (+).
  current_file=""
  while IFS= read -r diff_line; do
    if [[ "$diff_line" == +++\ b/* ]]; then
      current_file="${diff_line#+++ b/}"
      continue
    fi
    if [[ "$diff_line" == \+* && "$diff_line" != +++* ]]; then
      added="${diff_line#+}"
      while IFS= read -r pattern; do
        [[ -z "$pattern" ]] && continue
        check_line "$pattern" "$current_file" "$added"
      done < "$denylist"
    fi
  done < <(git diff --cached -U0 -- .)
else
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    [[ ! -f "$repo_root/$file" ]] && continue
    while IFS= read -r pattern; do
      [[ -z "$pattern" ]] && continue
      # grep -n so we can report file:line; -I skips binaries.
      while IFS=: read -r lineno content; do
        [[ -z "$lineno" ]] && continue
        check_line "$pattern" "$file:$lineno" "$content"
      done < <(grep -InE -- "$pattern" "$repo_root/$file" 2>/dev/null || true)
    done < "$denylist"
  done < <(git -C "$repo_root" ls-files | grep -v '^\.git/')
fi

if [[ "$hit" -ne 0 ]]; then
  exit 1
fi

exit 0
