#!/usr/bin/env bash
# Creates one git worktree + branch per parallel agent, next to this repo.
# Run it from anywhere inside the repo AFTER the Architect has committed the skeleton to main.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
name="$(basename "$repo_root")"
parent="$(dirname "$repo_root")"

if [ -n "$(git status --porcelain)" ]; then
  echo "Your working tree has uncommitted changes. Commit or stash them first." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is not installed. Install it first (see agents/RUN_GUIDE.md)." >&2
  exit 1
fi

areas=(editor sync databases search plugins desktop importers ci docs)

for area in "${areas[@]}"; do
  dir="$parent/$name-$area"
  if [ -d "$dir" ]; then
    echo "skip:  $dir already exists"
    continue
  fi
  git worktree add "$dir" -b "feat/$area"
  (cd "$dir" && pnpm install --frozen-lockfile)
  echo "ready: $dir  (branch feat/$area)"
done

echo
echo "All set. Start one Claude Code session in each folder: see agents/RUN_GUIDE.md, Phase 2."
