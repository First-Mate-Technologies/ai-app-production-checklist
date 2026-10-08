#!/usr/bin/env bash
# Installs the production-readiness skill for Claude Code or Codex.
# Copies local files only: no network, no sudo. Refuses to overwrite without --force.
#
#   scripts/install-skill.sh [claude|codex] [--project] [--force]
#
#   claude   -> ~/.claude/skills/production-readiness   (--project: ./.claude/skills/...)
#   codex    -> ~/.agents/skills/production-readiness   (--project: ./.agents/skills/...)
set -euo pipefail

usage() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

tool=""
project=0
force=0
for arg in "$@"; do
  case "$arg" in
    claude|codex) tool="$arg" ;;
    --project) project=1 ;;
    --force) force=1 ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage 2 ;;
  esac
done
[ -n "$tool" ] || { echo "Choose a target: claude or codex." >&2; usage 2; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
kit="$(cd "$here/.." && pwd)"
src="$kit/skills/production-readiness"
[ -f "$src/SKILL.md" ] || { echo "Cannot find $src/SKILL.md" >&2; exit 1; }

case "$tool" in
  claude) rel=".claude/skills" ;;
  codex) rel=".agents/skills" ;;
esac
if [ "$project" -eq 1 ]; then base="$PWD/$rel"; else base="${HOME:?HOME is not set}/$rel"; fi
dest="$base/production-readiness"

if [ -e "$dest" ] || [ -L "$dest" ]; then
  if [ "$force" -ne 1 ]; then
    echo "Already exists: $dest" >&2
    echo "Re-run with --force to replace it." >&2
    exit 1
  fi
  echo "Replacing $dest"
  rm -rf "$dest"
fi

echo "Installing the production-readiness skill for $tool"
echo "  from: $kit"
echo "  to:   $dest"
mkdir -p "$dest/references" "$dest/scripts/scan"
cp "$src/SKILL.md" "$dest/SKILL.md"
cp "$src/references/"*.md "$dest/references/"
cp "$kit/CHECKLIST.md" "$dest/references/CHECKLIST.md"
cp "$kit/sql/supabase-rls-audit.sql" "$dest/references/supabase-rls-audit.sql"
cp "$kit/scan/cli.mjs" "$dest/scripts/scan/cli.mjs"
cp -R "$kit/scan/lib" "$dest/scripts/scan/lib"
# The scanner is ES modules and reads ../package.json for --version.
printf '{\n  "name": "production-readiness-scanner",\n  "version": "%s",\n  "type": "module"\n}\n' \
  "$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$kit/package.json" | head -n1)" > "$dest/scripts/package.json"

echo "Done. Files:"
(cd "$dest" && find . -type f | sort | sed 's/^/  /')
echo "Restart your agent if the skill does not appear. Say \"is my app ready to launch?\" to use it."
