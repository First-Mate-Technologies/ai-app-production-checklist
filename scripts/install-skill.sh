#!/usr/bin/env bash
# Installs the production-readiness and break-my-app skills for Claude Code or Codex.
# Copies local files only: no network, no sudo. Refuses to overwrite without --force.
#
#   scripts/install-skill.sh [claude|codex] [--project] [--force] [--skill production-readiness|break-my-app|all]
#
#   claude   -> ~/.claude/skills/<skill>   (--project: ./.claude/skills/...)
#   codex    -> ~/.agents/skills/<skill>   (--project: ./.agents/skills/...)
#   --skill  which skill to install (default: all)
set -euo pipefail

usage() {
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

tool=""
project=0
force=0
which_skill="all"
while [ $# -gt 0 ]; do
  case "$1" in
    claude|codex) tool="$1" ;;
    --project) project=1 ;;
    --force) force=1 ;;
    --skill)
      [ $# -ge 2 ] || { echo "--skill needs a value." >&2; usage 2; }
      which_skill="$2"; shift ;;
    --skill=*) which_skill="${1#--skill=}" ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown argument: $1" >&2; usage 2 ;;
  esac
  shift
done
[ -n "$tool" ] || { echo "Choose a target: claude or codex." >&2; usage 2; }
case "$which_skill" in
  production-readiness|break-my-app) skills="$which_skill" ;;
  all) skills="production-readiness break-my-app" ;;
  *) echo "Unknown skill: $which_skill (use production-readiness, break-my-app or all)." >&2; usage 2 ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
kit="$(cd "$here/.." && pwd)"
for s in $skills; do
  [ -f "$kit/skills/$s/SKILL.md" ] || { echo "Cannot find $kit/skills/$s/SKILL.md" >&2; exit 1; }
done

case "$tool" in
  claude) rel=".claude/skills" ;;
  codex) rel=".agents/skills" ;;
esac
if [ "$project" -eq 1 ]; then base="$PWD/$rel"; else base="${HOME:?HOME is not set}/$rel"; fi

# Check every destination first so a refusal leaves nothing half installed.
for s in $skills; do
  dest="$base/$s"
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    if [ "$force" -ne 1 ]; then
      echo "Already exists: $dest" >&2
      echo "Re-run with --force to replace it." >&2
      exit 1
    fi
  fi
done

install_one() {
  local s="$1" src="$kit/skills/$1" dest="$base/$1"
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    echo "Replacing $dest"
    rm -rf "$dest"
  fi
  echo "Installing the $s skill for $tool"
  echo "  from: $kit"
  echo "  to:   $dest"
  mkdir -p "$dest/references"
  cp "$src/SKILL.md" "$dest/SKILL.md"
  cp "$src/references/"*.md "$dest/references/"
  case "$s" in
    production-readiness)
      mkdir -p "$dest/scripts/scan"
      cp "$kit/CHECKLIST.md" "$dest/references/CHECKLIST.md"
      cp "$kit/sql/supabase-rls-audit.sql" "$dest/references/supabase-rls-audit.sql"
      cp "$kit/scan/cli.mjs" "$dest/scripts/scan/cli.mjs"
      cp -R "$kit/scan/lib" "$dest/scripts/scan/lib"
      # The scanner is ES modules and reads ../package.json for --version.
      printf '{\n  "name": "production-readiness-scanner",\n  "version": "%s",\n  "type": "module"\n}\n' \
        "$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$kit/package.json" | head -n1)" > "$dest/scripts/package.json"
      ;;
    break-my-app)
      mkdir -p "$dest/scripts"
      cp "$src/scripts/"*.mjs "$dest/scripts/"
      printf '{\n  "name": "break-my-app-scripts",\n  "type": "module"\n}\n' > "$dest/scripts/package.json"
      ;;
  esac
  echo "Done. Files:"
  (cd "$dest" && find . -type f | sort | sed 's/^/  /')
}

for s in $skills; do install_one "$s"; done
echo "Restart your agent if a skill does not appear."
case "$skills" in *production-readiness*) echo "Say \"is my app ready to launch?\" to use production-readiness." ;; esac
case "$skills" in *break-my-app*) echo "Say \"try to break my app and write test cases\" to use break-my-app." ;; esac
